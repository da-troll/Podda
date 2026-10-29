// HIVE-1526: live probe of the Authentik identity paths on the running server (default :18892).
// Reads the gate token from its file inside the script, never on a command line. Read-only:
// GET /api/auth/me and one POST /api/auth/login with a wrong password. Exit 1 on any FAIL.
//   node scripts/qa/hive1526-live-probe.cjs daniel=<uid> [terje=<uid> ...]
require('dotenv').config({ path: process.env.PODDA_ENV || '/opt/apps/podda/.env', quiet: true });
const fs = require('fs');
const { Client } = require('pg');

const BASE = process.env.PODDA_URL || 'http://127.0.0.1:18892';
const GATE = fs.readFileSync(process.env.PODDA_GATE_TOKEN_FILE || '/home/eve/.config/podda/gate.token', 'utf8').trim();
const links = process.argv.slice(2).map((a) => a.split('='));
let fails = 0;
const check = (name, ok, got) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` (got ${got})`}`); if (!ok) fails++; };

async function me(headers, path = '/api/auth/me') {
  const r = await fetch(`${BASE}${path}`, { headers });
  return { status: r.status, cookie: r.headers.get('set-cookie'), body: await r.json().catch(() => null) };
}

(async () => {
  const db = new Client();
  await db.connect();
  const sessions = async () => Number((await db.query('SELECT count(*) FROM session')).rows[0].count);
  const before = await sessions();

  let r = await me({});
  check('no headers: /me -> 200 null (legacy anonymous)', r.status === 200 && r.body === null, `${r.status} ${JSON.stringify(r.body)}`);
  r = await me({}, '/api/playlists');
  check('no headers: /api/playlists -> 401', r.status === 401, r.status);
  for (const [name, uid] of links) {
    const { rows } = await db.query('SELECT id FROM users WHERE username = $1', [name]);
    r = await me({ 'X-Podda-Gate': GATE, 'X-authentik-Uid': uid });
    check(`gate + ${name} uid -> 200 as users.id ${rows[0]?.id}, authentik-web, no Set-Cookie`,
      r.status === 200 && r.body?.id === rows[0]?.id && r.body?.authMethod === 'authentik-web' && !r.cookie,
      `${r.status} ${JSON.stringify(r.body)} cookie=${!!r.cookie}`);
  }
  r = await me({ 'X-Podda-Gate': GATE, 'X-authentik-Uid': links.at(-1)?.[1] }, '/api/playlists');
  check(`gate + ${links.at(-1)?.[0]} uid: /api/playlists -> 200 array`, r.status === 200 && Array.isArray(r.body), r.status);
  r = await me({ 'X-Podda-Gate': GATE });
  check('gate without uid -> 401', r.status === 401, r.status);
  r = await me({ 'X-Podda-Gate': GATE, 'X-authentik-Uid': 'f'.repeat(64) });
  check('gate + unlinked uid -> 403 not_linked', r.status === 403 && r.body?.error === 'not_linked', `${r.status} ${JSON.stringify(r.body)}`);
  r = await me({ 'X-Podda-Gate': 'x'.repeat(GATE.length), 'X-authentik-Uid': links[0]?.[1] || 'x' }, '/api/playlists');
  check('forged gate + real uid: /api/playlists -> 401 (headers ignored)', r.status === 401, r.status);
  r = await me({ Authorization: 'Bearer not-a-jwt' });
  check('Bearer garbage -> 401', r.status === 401, r.status);
  // Well-formed but unsigned-by-Authentik token: needs a live JWKS fetch; 401 means the auth server
  // answered and the signature failed, 503 would mean JWKS was unreachable.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const fake = `${b64({ alg: 'RS256', kid: 'nope' })}.${b64({ sub: links[0]?.[1], exp: 9999999999 })}.${'A'.repeat(43)}`;
  r = await me({ Authorization: `Bearer ${fake}` });
  check('Bearer with a foreign signature -> 401 (JWKS reachable)', r.status === 401, r.status);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'daniel', password: 'wrong-hive1526-probe' }),
  });
  check('legacy login route alive (wrong password -> 401)', login.status === 401, login.status);

  const after = await sessions();
  check(`session rows unchanged by the probe (${before} -> ${after})`, after === before, after - before);
  await db.end();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('probe error:', e.message); process.exit(2); });
