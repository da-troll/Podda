// HIVE-1526 probe: the web client's auth handling, against a built dist and a MOCK API (no
// database, no live server). Usage: node scripts/qa/hive1526-web-auth-probe.mjs <dist-dir>
//  - 403 not_linked: the static "not set up" screen, no reload
//  - 401 on a protected call (proxy cookie gone): exactly one reload per 60 s, never a loop
//  - opaqueredirect (proxy session expired, Caddy redirects /api): one reload
//  - legacy password login: a wrong password shows the error and does NOT reload
//  - Authentik web sign-out goes to the outpost sign_out
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PW || '/home/eve/projects/nightly-mvps/2026-10-23-knitspo/node_modules/playwright');

const DIST = process.argv[2];
if (!DIST || !fs.existsSync(path.join(DIST, 'index.html'))) { console.error('usage: <dist-dir with index.html>'); process.exit(2); }
const USER = { id: 2, username: 'terje', displayName: 'Terje', firstName: null, lastName: null, email: null, isAdmin: false };
let scenario = 'linked';
const hits = [];
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    hits.push(`${req.method} ${u.pathname}`);
    if (scenario === 'not_linked') return json(res, 403, { error: 'not_linked', message: 'Your account is not set up in Podda.' });
    if (u.pathname === '/api/auth/me') {
      if (scenario === 'logged-out') return json(res, 200, null);
      return json(res, 200, { ...USER, authMethod: scenario === 'authentik' ? 'authentik-web' : 'password' });
    }
    if (u.pathname === '/api/auth/login') return json(res, 401, { error: 'Invalid credentials' });
    if (u.pathname === '/api/auth/logout') return json(res, 200, { ok: true });
    if (scenario === 'cookie-gone') return json(res, 401, { error: 'Not authenticated' });
    if (scenario === 'proxy-expired') { res.writeHead(302, { location: 'https://auth.example/flow' }); return res.end(); }
    if (u.pathname === '/api/preferences') return json(res, 200, { channelSort: 'newest', channelHideCompleted: false, rememberScroll: false });
    return json(res, 200, []);
  }
  if (u.pathname === '/whats-new.json') return json(res, 200, null); // no What's new sheet over the screens
  if (u.pathname.startsWith('/outpost.goauthentik.io/')) { hits.push(`GET ${u.pathname}`); res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<p>signed out</p>'); }
  const f = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname);
  if (f.startsWith(DIST) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type }); return fs.createReadStream(f).pipe(res);
  }
  res.writeHead(200, { 'content-type': 'text/html' }); fs.createReadStream(path.join(DIST, 'index.html')).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) fails++; };
const b = await chromium.launch();
async function page(s) {
  scenario = s; hits.length = 0;
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  let loads = 0; p.on('load', () => { loads++; });
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  return { p, ctx, loads: () => loads };
}

{ const { p, ctx, loads } = await page('not_linked');
  check(await p.getByText('Your account is not set up in Podda.').isVisible(), 'not_linked: the static screen shows');
  await p.waitForTimeout(2000);
  check(loads() === 1, `not_linked: no reload (page loads: ${loads()})`);
  await p.getByRole('button', { name: 'Sign out' }).click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(500);
  check(p.url().includes('/outpost.goauthentik.io/sign_out'), 'not_linked: Sign out goes to the Authentik outpost');
  await ctx.close(); }

{ const { p, ctx, loads } = await page('linked');
  check(loads() === 1 && !(await p.getByText('Your account is not set up').count()), 'linked: the app loads once, no reload');
  await ctx.close(); }

{ const { ctx, loads } = await page('cookie-gone');
  await new Promise((r) => setTimeout(r, 2500));
  check(loads() === 2, `401 on protected calls: exactly one reload, then it stops (page loads: ${loads()})`);
  await ctx.close(); }

{ const { ctx, loads } = await page('proxy-expired');
  await new Promise((r) => setTimeout(r, 2500));
  check(loads() === 2, `opaqueredirect on /api: one reload, guarded (page loads: ${loads()})`);
  await ctx.close(); }

{ const { p, ctx, loads } = await page('logged-out');
  await p.getByLabel('Username').fill('terje'); await p.getByLabel('Password').fill('wrong');
  await p.getByRole('button', { name: 'Sign in', exact: true }).click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(1500);
  check(await p.getByText('Invalid credentials').isVisible(), 'legacy login: a wrong password shows the error');
  check(loads() === 1, `legacy login: a wrong password does not reload (page loads: ${loads()})`);
  check(!(await p.getByRole('button', { name: 'Sign in with Authentik' }).count()), 'legacy login on the web: no Authentik button (the app build provides it)');
  await ctx.close(); }

for (const [s2, wantOutpost] of [['authentik', true], ['linked', false]]) {
  const { p, ctx } = await page(s2);
  await p.goto(BASE + '#settings', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Sign out' }).click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(800);
  const atOutpost = p.url().includes('/outpost.goauthentik.io/sign_out');
  check(atOutpost === wantOutpost, wantOutpost ? 'Authentik web user: Settings > Sign out ends at the outpost sign_out'
    : 'password user: Settings > Sign out stays a local logout (no outpost)');
  await ctx.close();
}

await b.close(); server.close();
console.log(fails ? `RESULT FAIL (${fails})` : 'RESULT PASS');
process.exit(fails ? 1 : 0);
