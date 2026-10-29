const { Router } = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const db = require('./db.cjs');
const { verifyBearer } = require('./oidc.cjs');

const router = Router();

// Constant-time string compare; timingSafeEqual throws on unequal lengths, so check them first.
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// HIVE-1526: Authentik identity, resolved BEFORE express-session (index.cjs).
// - Web: Caddy's forward_auth injects X-Podda-Gate (the shared token) and X-authentik-Uid.
// - Mobile: Authorization: Bearer <podda-mobile access token>, verified against JWKS.
// Both match users.authentik_uid ONLY (hashed_user_id subject mode on both providers, so the web
// Uid and the token's sub are the same string). A resolved request gets a plain, unsaved
// req.session, so it writes no session row and sends no Set-Cookie. Neither header: the legacy
// podda.sid cookie path, until Phase 6 (HIVE-1529).
const NOT_AUTH = { error: 'Not authenticated' };
const NOT_LINKED = { error: 'not_linked', message: 'Your account is not set up in Podda.' };
const GATE_FILE = process.env.PODDA_GATE_TOKEN_FILE || '/home/eve/.config/podda/gate.token';

function readGateToken() {
  if (process.env.PODDA_GATE_TOKEN) return process.env.PODDA_GATE_TOKEN.trim();
  try { return fs.readFileSync(GATE_FILE, 'utf8').trim(); } catch { return ''; } // no token: the gate path is off
}

const UID_TTL_MS = 60 * 1000;
const uidCache = new Map(); // authentik_uid -> { at, user | null }
async function userByAuthentikUid(uid) {
  const hit = uidCache.get(uid);
  if (hit && Date.now() - hit.at < UID_TTL_MS) return hit.user;
  const { rows } = await db.query('SELECT id, is_admin FROM users WHERE authentik_uid = $1', [uid]);
  const user = rows[0] || null;
  uidCache.set(uid, { at: Date.now(), user });
  return user;
}

function createIdentityResolver({ gateToken = readGateToken(), lookup = userByAuthentikUid, verify = verifyBearer } = {}) {
  return async function resolveAuthentikIdentity(req, res, next) {
    const gate = req.get('x-podda-gate');
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '')?.[1];
    let uid, method;
    if (gate && same(gate, gateToken)) {
      uid = req.get('x-authentik-uid');
      if (!uid) return res.status(401).json(NOT_AUTH); // gated but anonymous: never the legacy cookie
      method = 'authentik-web';
    } else if (bearer) {
      const v = await verify(bearer);
      if (!v.ok) return v.unavailable
        ? res.status(503).json({ error: 'Auth service temporarily unavailable' })
        : res.status(401).json(NOT_AUTH);
      uid = v.sub;
      method = 'authentik-oidc';
    } else {
      return next();
    }
    let user;
    try { user = await lookup(uid); } catch (err) {
      console.error('[auth] authentik lookup error:', err.message);
      return res.status(500).json({ error: 'Internal server error' });
    }
    if (!user) return res.status(403).json(NOT_LINKED);
    req.authentikResolved = true;
    req.authMethod = method;
    req.authentikUid = uid;
    req.session = { userId: user.id, isAdmin: user.is_admin, destroy: (cb) => cb?.() };
    next();
  };
}

// Second layer behind the listener bind (HIVE-1464): loopback and the Docker bridges only.
function peerAllowed(ip) {
  const a = String(ip || '').replace(/^::ffff:/, '');
  if (a === '::1' || a.startsWith('127.')) return true;
  const m = /^172\.(\d{1,3})\./.exec(a);
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

// Auth middleware — attach to routes that need login
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const result = await db.query(
      'SELECT id, username, display_name, first_name, last_name, email, password_hash, is_admin FROM users WHERE username = $1',
      [username]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user.id;
    req.session.isAdmin = user.is_admin;
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      isAdmin: user.is_admin,
    });
  } catch (err) {
    console.error('[auth] Login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('podda.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
// Returns 200 with null when not authenticated (avoids browser console errors on initial load).
// 401 is reserved for protected endpoints via requireAuth middleware.
router.get('/me', async (req, res) => {
  if (!req.session.userId) {
    return res.json(null);
  }

  try {
    const result = await db.query(
      'SELECT id, username, display_name, first_name, last_name, email, is_admin FROM users WHERE id = $1',
      [req.session.userId]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      isAdmin: user.is_admin,
      authMethod: req.authMethod || 'password', // the web logs out of Authentik too when it signed in there
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

function requireAdmin(req, res, next) {
  // Session-based admin
  if (req.session.userId && req.session.isAdmin) return next();
  // API key for headless access
  const apiKey = req.headers['x-api-key'];
  if (same(apiKey, process.env.ANNOUNCEMENTS_API_KEY)) return next();
  return res.status(403).json({ error: 'Admin access required' });
}

module.exports = { router, requireAuth, requireAdmin, createIdentityResolver, peerAllowed, same, NOT_LINKED };
