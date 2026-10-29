// node --test server/auth.test.cjs  (HIVE-1526: Authentik gate + Bearer identity)
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');
const session = require('express-session');
const { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } = require('jose');
const { createIdentityResolver, requireAuth, peerAllowed, same } = require('./auth.cjs');
const { verifyBearer, ISSUER, AUDIENCE } = require('./oidc.cjs');
const { describeClient } = require('./client-tracker.cjs');

const GATE = 'g'.repeat(43);
const USERS = { 'uid-daniel': { id: 1, is_admin: true }, 'uid-pappa': { id: 2, is_admin: false } };

let keys, jwks, otherKeys;
test.before(async () => {
  keys = await generateKeyPair('RS256');
  otherKeys = await generateKeyPair('RS256');
  jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256' }] });
});
const token = (claims = {}, { key = keys.privateKey, exp = '5m', iss = ISSUER, aud = AUDIENCE } = {}) =>
  new SignJWT({ ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setAudience(aud)
    .setSubject(claims.sub ?? 'uid-pappa').setIssuedAt().setExpirationTime(exp).sign(key);

// The real middleware order from index.cjs: resolver, then express-session only when unresolved.
function server({ verify } = {}) {
  const writes = [];
  class CountingStore extends session.MemoryStore { set(sid, s, cb) { writes.push(sid); super.set(sid, s, cb); } }
  const app = express();
  app.use('/api', createIdentityResolver({ gateToken: GATE, lookup: async (uid) => USERS[uid] || null, verify: verify || ((t) => verifyBearer(t, { jwks })) }));
  const sessionMiddleware = session({ store: new CountingStore(), name: 'podda.sid', secret: 's', resave: false, saveUninitialized: false });
  app.use((req, res, next) => (req.authentikResolved ? next() : sessionMiddleware(req, res, next)));
  app.post('/api/legacy-login', (req, res) => { req.session.userId = 2; res.json({ ok: true }); });
  app.get('/api/me', requireAuth, (req, res) => res.json({ userId: req.session.userId, isAdmin: req.session.isAdmin, method: req.authMethod || 'cookie' }));
  return new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve({ s, writes, port: s.address().port })); });
}
function call(port, path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null, cookie: res.headers['set-cookie'] }));
    });
    r.on('error', reject); r.end();
  });
}

test('gate + linked uid: that user, no session row, no Set-Cookie', async () => {
  const { s, writes, port } = await server();
  const r = await call(port, '/api/me', { 'x-podda-gate': GATE, 'x-authentik-uid': 'uid-daniel' });
  s.close();
  assert.deepStrictEqual([r.status, r.body], [200, { userId: 1, isAdmin: true, method: 'authentik-web' }]);
  assert.strictEqual(r.cookie, undefined);
  assert.strictEqual(writes.length, 0);
});

test('gate without X-authentik-Uid is 401 and never falls back to a legacy cookie', async () => {
  const { s, port } = await server();
  const login = await call(port, '/api/legacy-login', {}, 'POST');
  const cookie = login.cookie[0].split(';')[0];
  const r = await call(port, '/api/me', { 'x-podda-gate': GATE, cookie });
  const control = await call(port, '/api/me', { cookie });
  s.close();
  assert.strictEqual(r.status, 401);
  assert.deepStrictEqual([control.status, control.body.method], [200, 'cookie']); // the cookie itself is good
});

test('gate or Bearer for an unlinked Authentik user is 403 not_linked', async () => {
  const { s, port } = await server();
  const web = await call(port, '/api/me', { 'x-podda-gate': GATE, 'x-authentik-uid': 'uid-stranger' });
  const mob = await call(port, '/api/me', { authorization: `Bearer ${await token({ sub: 'uid-stranger' })}` });
  s.close();
  for (const r of [web, mob]) assert.deepStrictEqual([r.status, r.body.error], [403, 'not_linked']);
});

test('a wrong gate value is ignored (no identity, the legacy path decides)', async () => {
  const { s, port } = await server();
  const r = await call(port, '/api/me', { 'x-podda-gate': 'h'.repeat(43), 'x-authentik-uid': 'uid-daniel' });
  s.close();
  assert.strictEqual(r.status, 401);
});

test('Bearer valid: that user, no session row, no Set-Cookie', async () => {
  const { s, writes, port } = await server();
  const r = await call(port, '/api/me', { authorization: `Bearer ${await token({ sub: 'uid-pappa' })}` });
  s.close();
  assert.deepStrictEqual([r.status, r.body], [200, { userId: 2, isAdmin: false, method: 'authentik-oidc' }]);
  assert.strictEqual(r.cookie, undefined);
  assert.strictEqual(writes.length, 0);
});

test('Bearer faults are 401: expired, wrong audience, wrong issuer, foreign key, garbage', async () => {
  const { s, port } = await server();
  const bad = [
    await token({}, { exp: Math.floor(Date.now() / 1000) - 120 }),
    await token({}, { aud: 'clawdash-mobile' }),
    await token({}, { iss: 'https://auth.trollefsen.com/application/o/other/' }),
    await token({}, { key: otherKeys.privateKey }),
    'not.a.jwt',
  ];
  const got = [];
  for (const t of bad) got.push((await call(port, '/api/me', { authorization: `Bearer ${t}` })).status);
  s.close();
  assert.deepStrictEqual(got, [401, 401, 401, 401, 401]);
});

test('JWKS unreachable is 503, never 401 (the phone keeps its refresh token)', async () => {
  const down = async () => { throw new TypeError('fetch failed'); };
  const v = await verifyBearer(await token(), { jwks: down });
  assert.deepStrictEqual(v, { ok: false, unavailable: true });
  const timeout = async () => { const e = new Error('timeout'); e.code = 'ERR_JWKS_TIMEOUT'; throw e; };
  assert.strictEqual((await verifyBearer(await token(), { jwks: timeout })).unavailable, true);
  const { s, port } = await server({ verify: (t) => verifyBearer(t, { jwks: down }) });
  const r = await call(port, '/api/me', { authorization: `Bearer ${await token()}` });
  s.close();
  assert.strictEqual(r.status, 503);
});

test('the legacy cookie path still works and still stores its session (the counter is live)', async () => {
  const { s, writes, port } = await server();
  const login = await call(port, '/api/legacy-login', {}, 'POST');
  s.close();
  assert.ok(login.cookie?.[0].startsWith('podda.sid='));
  assert.strictEqual(writes.length, 1);
});

test('peer allowlist: loopback and Docker bridges only', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '172.17.0.1', '::ffff:172.18.0.5', '172.31.255.1']) assert.ok(peerAllowed(ip), ip);
  for (const ip of ['100.64.0.7', '172.15.0.1', '172.32.0.1', '10.0.0.1', '192.168.1.2', '::ffff:203.0.113.7', '', undefined]) assert.ok(!peerAllowed(ip), String(ip));
});

test('same(): constant-time compare that refuses empty or different lengths', () => {
  assert.ok(same('abc', 'abc'));
  assert.ok(!same('abc', 'abd') && !same('abc', 'abcd') && !same('', '') && !same(undefined, 'x') && !same('x', undefined));
});

test('device id for an Authentik request without a session id: stable per uid + user agent', () => {
  const key = (uid, ua) => describeClient({ 'user-agent': ua }, `authentik:${uid}:${ua}`).deviceId;
  assert.strictEqual(key('u1', 'A'), key('u1', 'A'));
  assert.notStrictEqual(key('u1', 'A'), key('u2', 'A'));
  assert.notStrictEqual(key('u1', 'A'), key('u1', 'B'));
});
