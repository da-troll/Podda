// HIVE-1173 UI probe: channel filters sheet, Preferences link, matched header
// controls, spotlight hint, playlist settings sheet, What's New.
// Serves a local build at the live origin and lets /api through to production,
// logged in as the scratch user from qa-user.cjs. Run:
//   QA_PW_FILE=$S/qa.pw node scripts/qa/qa-user.cjs create
//   npx vite build --outDir $S/dist
//   PW=<path to playwright-core/index.mjs> CHROME=<chromium binary> S=$S \
//     node scripts/qa/filters-sheet.mjs $S/dist $S/shots
//   node scripts/qa/qa-user.cjs delete
// Exits non-zero on any FAIL.
const { chromium } = await import(process.env.PW || 'playwright-core');
import fs from 'fs'; import path from 'path';
const S = process.env.S, DIST = process.argv[2], OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const pw = fs.readFileSync(process.env.QA_PW_FILE || S + '/qa.pw', 'utf8');
const ORIGIN = 'https://podda.trollefsen.com';
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
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
const settle = async (p) => { await p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity)); await p.waitForTimeout(300); };
for (const [label, viewport, mobile] of [['390', { width: 412, height: 915 }, true], ['1280', { width: 1280, height: 860 }, false]]) {
  const c = await ctx(viewport, mobile); const p = await c.newPage();
  await p.goto(ORIGIN + '/');
  const r = await p.evaluate(async (pw) => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'qa-hive1173', password: pw }) })).status, pw);
  check(`${label} login`, r === 200, String(r));
  await p.evaluate(() => { localStorage.setItem('podda:last-seen-version', '1.2.2'); localStorage.setItem('podda:hint-channel-settings-v1', '1'); for (const k of ['podda:swipe-hint-v1', 'podda:hint-sidebar-swipe-v1', 'podda:hint-mini-expand-v1']) localStorage.setItem(k, '1'); });
  await p.goto(ORIGIN + '/#podcast/3'); await p.reload();
  await p.waitForSelector('[data-hint="channel-filters"]');
  const hint = await p.waitForSelector('.hint-spotlight', { timeout: 5000 }).catch(() => null);
  check(`${label} hint spotlight rendered`, !!hint);
  if (hint) {
    await settle(p);
    const [hb, fb] = [await hint.boundingBox(), await p.locator('[data-hint="channel-filters"]').boundingBox()];
    const inside = hb.x <= fb.x && hb.y <= fb.y && hb.x + hb.width >= fb.x + fb.width && hb.y + hb.height >= fb.y + fb.height;
    check(`${label} spotlight surrounds Filters`, inside, JSON.stringify({ hb, fb }));
    const tap = await p.locator('.hint-gesture-touch-dot').boundingBox();
    const cx = tap.x + tap.width / 2, cy = tap.y + tap.height / 2;
    check(`${label} tap dot on Filters bottom edge, label clear`, cx > fb.x && cx < fb.x + fb.width && Math.abs(cy - (fb.y + fb.height)) < 2, `${cx},${cy}`);
    // pixel: button area is not dimmed, area outside is
    await p.screenshot({ path: `${OUT}/${label}-1-hint.png` });
    await p.click('.hint-overlay');
  }
  await p.waitForSelector('.hint-overlay', { state: 'detached' });
  const sb = await p.locator('.episode-list-header-actions .sort-select').boundingBox();
  const fb = await p.locator('.filters-btn').boundingBox();
  check(`${label} sort height == filters height`, Math.abs(sb.height - fb.height) < 0.5, `${sb.height} vs ${fb.height}`);
  check(`${label} no hide-completed outside sheet`, (await p.locator('.episode-list-header >> text=Hide completed').count()) === 0);
  await p.screenshot({ path: `${OUT}/${label}-2-header.png` });
  const listTopBefore = await p.locator('.episode-list').evaluate(e => e.getBoundingClientRect().top);
  await p.click('.filters-btn');
  await p.waitForSelector('.sheet'); await settle(p);
  const listTopOpen = await p.locator('.episode-list').evaluate(e => e.getBoundingClientRect().top);
  check(`${label} list not pushed by sheet`, Math.abs(listTopOpen - listTopBefore) < 1, `${listTopBefore} -> ${listTopOpen}`);
  check(`${label} sheet is dialog`, (await p.locator('.sheet[role=dialog][aria-modal=true]').count()) === 1);
  // 1.2.2 (HIVE-1178): Hide completed moved to channel settings (the gear).
  check(`${label} Filters sheet has no Hide completed control`, !(await p.locator('.sheet label > span').allInnerTexts()).some(t => /hide completed/i.test(t)));
  const link = p.locator('.sheet a.text-link');
  const linkInfo = await link.evaluate(a => ({ text: a.textContent, color: getComputedStyle(a).color, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(), tag: a.tagName }));
  check(`${label} Preferences link`, linkInfo.text === 'Preferences' && linkInfo.color === 'rgb(99, 102, 241)', JSON.stringify(linkInfo));
  const selFont = await p.locator('.sheet select').first().evaluate(e => [getComputedStyle(e).fontSize, e.getBoundingClientRect().height]);
  check(`${label} sheet selects large`, parseFloat(selFont[0]) >= 16 && selFont[1] >= 52, JSON.stringify(selFont));
  await p.screenshot({ path: `${OUT}/${label}-3-sheet.png` });
  await p.locator('.sheet select').first().selectOption('unplayed');
  await p.click('.sheet-footer >> text=Done');
  await p.waitForSelector('.sheet', { state: 'detached' });
  const badge = await p.locator('.filters-btn-count').textContent().catch(() => null);
  check(`${label} badge counts an active filter`, badge === '1', String(badge));
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/${label}-4-badge.png` });
  // Escape closes, Android back event closes
  await p.click('.filters-btn'); await p.waitForSelector('.sheet');
  const cancelled = await p.evaluate(() => !window.dispatchEvent(new CustomEvent('podda:backpressed', { cancelable: true })));
  await p.waitForSelector('.sheet', { state: 'detached' });
  check(`${label} back closes sheet + cancels nav`, cancelled);
  await p.click('.filters-btn'); await p.waitForSelector('.sheet');
  await p.click('.sheet a.text-link');
  await p.waitForFunction(() => location.hash === '#settings');
  check(`${label} Preferences link navigates`, true);
  await p.goto(ORIGIN + '/#playlists'); await p.waitForTimeout(800);
  const pl = await p.evaluate(async () => (await (await fetch('/api/playlists')).json()));
  const plId = (pl.playlists || pl)[0]?.id;
  await p.goto(ORIGIN + `/#playlist/${plId}`);
  await p.click('[aria-label="Playlist settings"]'); await p.waitForSelector('.sheet'); await settle(p);
  await p.screenshot({ path: `${OUT}/${label}-5-playlist-sheet.png` });
  check(`${label} playlist settings in sheet`, (await p.locator('.sheet >> text=Auto-hide completed episodes').count()) === 1);
  await p.keyboard.press('Escape'); await p.waitForSelector('.sheet', { state: 'detached' });
  // restore toggle state is irrelevant (scratch user). What's New sheet:
  await p.evaluate(() => localStorage.removeItem('podda:last-seen-version')); await p.reload();
  await p.waitForSelector('.whatsnew-sheet'); await settle(p);
  const wn = await p.locator('.whatsnew-sheet').innerText();
  check(`${label} whats-new 1.2.2, no lock-screen`, wn.includes('v1.2.2') && !/lock.?screen/i.test(wn));
  await p.screenshot({ path: `${OUT}/${label}-6-whatsnew.png` });
  await c.close();
}
await browser.close();
console.log(results.join('\n'));
if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
