// HIVE-1176 type-scale probe: rendered text sizes and tap targets on every page
// at 412px dpr2 (phone), plus a 1280px check that desktop did not change.
// Same harness as filters-sheet.mjs (local build at the live origin, /api to
// production, scratch user from qa-user.cjs). Run:
//   QA_PW_FILE=$S/qa.pw node scripts/qa/qa-user.cjs create
//   npx vite build --outDir $S/dist
//   PW=<playwright-core/index.mjs> CHROME=<chromium> S=$S node scripts/qa/type-scale.mjs $S/dist $S/shots
//   node scripts/qa/qa-user.cjs delete
// Exits non-zero on any FAIL.
const { chromium } = await import(process.env.PW || 'playwright-core');
import fs from 'fs'; import path from 'path';
const S = process.env.S, DIST = process.argv[2], OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url))).version;
const pw = fs.readFileSync(process.env.QA_PW_FILE || S + '/qa.pw', 'utf8');
const ORIGIN = 'https://podda.trollefsen.com';
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
// Phone floors (Material: body 16sp, secondary 14sp, caption 12sp; touch 48dp, 44 accepted).
const MIN_TEXT = 12, MIN_BODY = 15, MIN_TAP = 44;
// Text that is allowed under MIN_TEXT: count badges on icons.
// Primary reading text: titles, row labels, body copy. Must reach MIN_BODY.
const PRIMARY = '.episode-title, .podcast-card-title, .playlist-card-name, .page-header h1, .settings-row > span, .empty-state-card p';
const TINY_OK = '.nav-badge, .queue-badge, .badge, [class*="badge"]';
const browser = await chromium.launch({ executablePath: process.env.CHROME });

async function ctx(viewport, mobile) {
  const c = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  await c.route(ORIGIN + '/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith('/api') || u.pathname.startsWith('/auth')) return route.continue();
    let f = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
    return route.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] || 'application/octet-stream' });
  });
  return c;
}

// Every visible element that owns a non-empty text node, with its rendered px size,
// and every visible control with its box.
const measure = (TINY_OK) => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const text = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('svg')) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    if (!own) continue;
    text.push({ px: parseFloat(getComputedStyle(el).fontSize), tiny: !!el.closest(TINY_OK), sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''), t: own.slice(0, 30) });
  }
  const taps = [];
  for (const el of document.querySelectorAll('button, select, input:not([type=hidden]), [role=button], [role=switch], a[href]')) {
    if (!vis(el)) continue;
    // A control inside a larger tappable label/row inherits that row's target.
    const host = el.closest('label, .sheet-toggle') || el;
    const r = host.getBoundingClientRect();
    taps.push({ w: Math.round(r.width), h: Math.round(r.height), sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''), t: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24) });
  }
  return { root: parseFloat(getComputedStyle(document.documentElement).fontSize), text, taps };
};

const c = await ctx({ width: 412, height: 915 }, true); const p = await c.newPage();
await p.goto(ORIGIN + '/');
const r = await p.evaluate(async (pw) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'qa-hive1173', password: pw }) })).status, pw);
check('412 login', r === 200, String(r));
await p.evaluate((v) => { localStorage.setItem('podda:last-seen-version', v); for (const k of ['podda:hint-channel-settings-v1', 'podda:hint-channel-filters-v2', 'podda:swipe-hint-v1', 'podda:hint-sidebar-swipe-v1', 'podda:hint-mini-expand-v1']) localStorage.setItem(k, '1'); }, VERSION);
const pl = await p.evaluate(async () => (await (await fetch('/api/playlists')).json()));
const plId = (pl.playlists || pl)[0]?.id;
const pods = await p.evaluate(async () => (await (await fetch('/api/podcasts')).json()));
const podId = (pods.podcasts || pods)[0]?.id;
check('412 scratch user has a podcast', !!podId, String(podId));
const pages = ['library', `podcast/${podId}`, 'discover', 'playlists', `playlist/${plId}`, 'history', 'settings'];
const dump = {};
for (const pg of pages) {
  await p.goto(ORIGIN + '/#' + pg); await p.reload(); await p.waitForTimeout(1500);
  for (const sel of ['.hint-overlay', '.whatsnew-sheet']) if (await p.locator(sel).count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(400); }
  const m = await p.evaluate(measure, TINY_OK);
  dump[pg] = m;
  await p.screenshot({ path: `${OUT}/412-${pg.replace('/', '-')}.png` });
  const small = m.text.filter(x => !x.tiny && x.px < MIN_TEXT);
  check(`412 #${pg} no text under ${MIN_TEXT}px`, small.length === 0, small.slice(0, 5).map(x => `${x.sel}=${x.px}px "${x.t}"`).join(' | '));
  const primary = await p.evaluate((sel) => [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().height > 0).map(e => ({ c: e.className, px: parseFloat(getComputedStyle(e).fontSize) })), PRIMARY);
  const lowP = primary.filter(x => x.px < MIN_BODY);
  check(`412 #${pg} primary text >= ${MIN_BODY}px`, primary.length > 0 && lowP.length === 0, `n=${primary.length} ` + lowP.slice(0, 4).map(x => `${x.c}=${x.px}`).join(' | '));
  const badTaps = m.taps.filter(x => x.h < MIN_TAP && x.w >= 1);
  check(`412 #${pg} tap targets >= ${MIN_TAP}px tall`, badTaps.length === 0, badTaps.slice(0, 6).map(x => `${x.sel} ${x.w}x${x.h} "${x.t}"`).join(' | '));
}
check('412 root font-size > 15px', dump.library.root > 15, String(dump.library.root));
await c.close();

// Desktop must keep its scale.
const d = await ctx({ width: 1280, height: 860 }, false); const q = await d.newPage();
await q.goto(ORIGIN + '/');
await q.evaluate(async (pw) => fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'qa-hive1173', password: pw }) }), pw);
await q.evaluate((v) => localStorage.setItem('podda:last-seen-version', v), VERSION);
await q.goto(ORIGIN + '/#podcast/' + podId); await q.reload(); await q.waitForTimeout(1500);
const dm = await q.evaluate(measure, TINY_OK);
check('1280 root font-size == 15px', dm.root === 15, String(dm.root));
const ep = await q.evaluate(() => { const b = [...document.querySelectorAll('.btn-icon, .episode-play-btn, .cl-action-btn')].find(e => e.getBoundingClientRect().height > 0); return b ? b.getBoundingClientRect().height : null; });
check('1280 icon buttons unchanged (36px)', ep === 36, String(ep));
await q.screenshot({ path: `${OUT}/1280-podcast.png` });
await d.close();
await browser.close();
fs.writeFileSync(`${OUT}/measure.json`, JSON.stringify(dump, null, 1));
console.log(results.join('\n'));
if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
