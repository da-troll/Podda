// HIVE-1528 popup probe: the v1.2.3 "Sign in with Google" sheet, against a built dist and a MOCK API.
// Usage: node scripts/qa/google-link-popup.mjs <dist-dir> [shot-dir]
//  - the sheet shows the title, the bullets and a CTA link to the Authentik link-Google URL (new tab)
//  - "Not now" dismisses it and it stays gone after a reload (last-seen 1.2.3)
//  - control: a release-notes json with no cta still shows "What's new in vX" and "Got it", no CTA
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.PW || '/home/eve/projects/nightly-mvps/2026-10-23-knitspo/node_modules/playwright');

const DIST = process.argv[2];
const SHOTS = process.argv[3];
if (!DIST || !fs.existsSync(path.join(DIST, 'index.html'))) { console.error('usage: <dist-dir with index.html> [shot-dir]'); process.exit(2); }
const LINK = 'https://auth.trollefsen.com/if/flow/podda-authentication/?next=%2Fsource%2Foauth%2Flogin%2Fgoogle%2F';
const USER = { id: 2, username: 'terje', displayName: 'Terje', firstName: null, lastName: null, email: null, isAdmin: false, authMethod: 'authentik-web' };
let whatsNew = null; // null = serve the dist's own whats-new.json
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) {
    if (u.pathname === '/api/auth/me') return json(res, 200, USER);
    if (u.pathname === '/api/preferences') return json(res, 200, { channelSort: 'newest', channelHideCompleted: false, rememberScroll: false });
    return json(res, 200, []);
  }
  if (u.pathname === '/whats-new.json' && whatsNew) return json(res, 200, whatsNew);
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
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {});
const b = await chromium.launch();

for (const [w, h] of [[390, 844], [1440, 900]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle' });
  const sheet = p.locator('.whatsnew-sheet');
  await sheet.waitFor({ timeout: 5000 }).catch(() => {});
  await settled(p);
  check(await p.getByRole('heading', { name: 'Sign in with Google' }).isVisible(), `${w}: title shows`);
  check((await sheet.locator('li').count()) === 3, `${w}: three lines of copy`);
  const cta = sheet.getByRole('link', { name: 'Link my Google account' });
  check(await cta.isVisible(), `${w}: CTA button shows`);
  check((await cta.getAttribute('href')) === LINK, `${w}: CTA goes to the Authentik link-Google URL`);
  check((await cta.getAttribute('target')) === '_blank', `${w}: CTA opens a new tab / the system browser`);
  const box = await sheet.boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= w + 0.5 && box.y + box.height <= h + 0.5, `${w}: sheet inside the viewport`);
  check(await p.evaluate(() => document.documentElement.scrollWidth) <= w, `${w}: no horizontal scroll`);
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, `google-link-popup-${w}.png`) });
  await sheet.getByRole('button', { name: 'Not now' }).click();
  check(!(await sheet.count()), `${w}: Not now closes it`);
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  check(!(await p.locator('.whatsnew-sheet').count()), `${w}: stays gone after a reload`);
  await ctx.close();
}

{ // control: an ordinary release-notes json renders exactly as before
  whatsNew = { version: '9.9.9', date: '2026-01-01', bullets: ['Something new.'] };
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.locator('.whatsnew-sheet').waitFor({ timeout: 5000 }).catch(() => {});
  check(await p.getByRole('heading', { name: "What's new in v9.9.9" }).isVisible(), 'control: release notes keep their default title');
  check(await p.getByRole('button', { name: 'Got it' }).isVisible() && !(await p.locator('.whatsnew-cta').count()), 'control: Got it, no CTA');
  await ctx.close();
}

await b.close(); server.close();
console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
process.exit(fails ? 1 : 0);
