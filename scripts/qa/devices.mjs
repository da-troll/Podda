// HIVE-1180 probe: the server records each device's client + version + last
// update check. Three clients against one scratch user:
//   web build (headers from src/api.ts), an old app with no headers (only a
//   WebView user agent), and the new app's native fetch interceptor +
//   update checker (bundled from podda-mobile) with a failing, then a newer,
//   version file. Then the admin view lists all three.
//   PW=<playwright-core/index.mjs> CHROME=<chromium> QA_PW_FILE=<file> NATIVE_JS=<iife bundle> \
//     API=http://localhost:3593 node scripts/qa/devices.mjs <dist> <shots>
// NATIVE_JS: echo "export { installFetchInterceptor } from './fetchInterceptor'; export { checkForUpdate } from './updateChecker';" \
//   | (cd <podda-mobile>/src/native && npx esbuild --bundle --format=iife --global-name=PoddaNative --sourcefile=entry.ts)
// Halfway the probe writes <shots>/ready and waits for <shots>/admin: the
// harness makes the scratch user an admin (the devices view is admin only).
const { chromium } = await import(process.env.PW || 'playwright-core');
import fs from 'fs'; import path from 'path';
const [DIST, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'https://podda.trollefsen.com', API = process.env.API;
const VERSION_URL = 'https://clawdash.trollefsen.com/media/podda-app-version.json';
const pw = fs.readFileSync(process.env.QA_PW_FILE, 'utf8');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
const browser = await chromium.launch({ executablePath: process.env.CHROME });
let versionFile = 'abort';
async function ctx(opts = {}) {
  const c = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, ...opts });
  await c.route(VERSION_URL + '**', r => versionFile === 'abort' ? r.abort('connectionrefused')
    : r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '9.9.9', versionCode: versionFile, url: 'x' }) }));
  await c.route(ORIGIN + '/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api')) {
      if (!API) return route.continue();
      return route.fulfill({ response: await route.fetch({ url: API + u.pathname + u.search }) });
    }
    let f = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    return route.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] || 'application/octet-stream' });
  });
  const p = await c.newPage();
  await p.goto(ORIGIN + '/');
  const status = await p.evaluate(async (pw) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'qa-hive1173', password: pw }) })).status, pw);
  return { c, p, status };
}
const devices = (p) => p.evaluate(async () => { const r = await fetch('/api/admin/devices'); return { status: r.status, rows: r.ok ? await r.json() : null }; });
const mine = (rows) => rows.filter(r => r.username === 'qa-hive1173');

// 1. Web build
const web = await ctx();
check('web login', web.status === 200);
await web.p.reload(); await web.p.waitForTimeout(2500);
const webDevice = await web.p.evaluate(() => localStorage.getItem('podda:device-id'));
check('non-admin gets 403 on devices', (await devices(web.p)).status === 403);

// 2. Old app: WebView user agent, no Podda headers
const old = await ctx({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-A546B Build/UP1A; wv) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36' });
check('old-app login', old.status === 200);
await old.p.evaluate(() => fetch('/api/podcasts'));

// 3. New app: native interceptor + update checker
const app = await ctx({ userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 11 Pro XL; wv) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36' });
await app.p.addScriptTag({ content: fs.readFileSync(process.env.NATIVE_JS, 'utf8') });
await app.p.evaluate(() => { window.PODDA_CONFIG = { serverUrl: location.origin }; PoddaNative.installFetchInterceptor(); localStorage.setItem('podda:device-id', 'qa-native-device-1'); });
await app.p.evaluate(() => PoddaNative.checkForUpdate());           // version file unreachable
await app.p.evaluate(() => fetch('/api/podcasts', { headers: { 'X-Podda-Device': 'qa-native-device-1' } }));
await app.p.waitForTimeout(600);
fs.writeFileSync(path.join(OUT, 'ready'), '1');
while (!fs.existsSync(path.join(OUT, 'admin'))) await new Promise(r => setTimeout(r, 200));
await web.p.evaluate(async (pw) => { await fetch('/api/auth/logout', { method: 'POST' }); await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'qa-hive1173', password: pw }) }); }, pw);
const failed = mine((await devices(web.p)).rows || []).find(r => r.deviceId === 'qa-native-device-1');
check('unreachable version file recorded as a failed check', failed?.updateCheckResult === 'fetch-error' && !!failed.updateCheckDetail, JSON.stringify(failed && { r: failed.updateCheckResult, d: failed.updateCheckDetail }));
versionFile = 99999;                                               // newer version published
await app.p.evaluate(() => PoddaNative.checkForUpdate());
check('banner shown for a newer version', await app.p.evaluate(() => !!document.getElementById('podda-update-banner')));
await app.p.evaluate(() => fetch('/api/podcasts', { headers: { 'X-Podda-Device': 'qa-native-device-1' } }));
await app.p.waitForTimeout(600);

const { status, rows } = await devices(web.p);
check('admin gets devices', status === 200, String(status));
const list = mine(rows || []);
const w = list.find(r => r.deviceId === webDevice);
check('web device recorded with web version', w?.platform === 'web' && /^\d+\.\d+\.\d+$/.test(w.webVersion ?? ''), JSON.stringify(w && { p: w.platform, v: w.webVersion }));
const o = list.find(r => r.platform === 'android-app' && r.appVersion === null && /SM-A546B/.test(r.userAgent ?? ''));
check('old app recorded as Android app, version unknown', !!o && o.deviceId.startsWith('session-'), JSON.stringify(o && { id: o.deviceId, v: o.appVersion }));
const n = list.find(r => r.deviceId === 'qa-native-device-1');
check('new app version from its build', n?.platform === 'android-app' && n.appVersion === '1.2.2', JSON.stringify(n && { p: n.platform, v: n.appVersion }));
check('new app last update check = banner', n?.updateCheckResult === 'banner' && /latest 99999/.test(n.updateCheckDetail ?? ''), JSON.stringify(n && { r: n.updateCheckResult, d: n.updateCheckDetail }));
await web.p.evaluate(() => { localStorage.setItem('podda:last-seen-version', '9.9.9'); for (const k of ['podda:hint-sidebar-swipe-v1', 'podda:hint-mini-expand-v1']) localStorage.setItem(k, '1'); });
await web.p.goto(ORIGIN + '/#settings'); await web.p.reload();
const heading = web.p.locator('h2', { hasText: /^Devices$/ });
await heading.waitFor(); await web.p.waitForTimeout(800);
await web.p.evaluate(() => { const v = (document.querySelector('.whatsnew-backdrop')); if (v) v.remove(); });
await heading.scrollIntoViewIfNeeded();
await web.p.screenshot({ path: `${OUT}/devices.png`, fullPage: false });
const card = await web.p.locator('.settings-section', { has: heading }).innerText();
check('card shows the failed-then-banner phone', /Android app 1\.2\.2/.test(card) && /update banner shown/.test(card), '');
check('card shows the old app', /version unknown, before 1\.2\.3/.test(card));
check('card times carry a zone', /\d{2}:\d{2} [A-Z]{2,5}/.test(card));
await browser.close();
console.log(results.join('\n'));
if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
