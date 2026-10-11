// HIVE-1178 probe: channel settings (sticky order, hide completed, remember
// scroll), auto-load + Show all, playlist scroll memory, API compatibility.
// Same harness as filters-sheet.mjs: a local build served at the live origin,
// /api sent to API (default: production) as the scratch user from qa-user.cjs.
//   PW=<playwright-core/index.mjs> CHROME=<chromium> QA_PW_FILE=<file> [API=http://localhost:3593] \
//     node scripts/qa/channel-settings.mjs <dist> <shots>
// Exits non-zero on any FAIL.
const { chromium } = await import(process.env.PW || 'playwright-core');
import fs from 'fs'; import path from 'path';
const [DIST, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const pw = fs.readFileSync(process.env.QA_PW_FILE, 'utf8');
const ORIGIN = 'https://podda.trollefsen.com', API = process.env.API;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const c = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await c.route(ORIGIN + '/**', async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith('/api')) {
    if (!API) return route.continue();
    const res = await route.fetch({ url: API + u.pathname + u.search });
    return route.fulfill({ response: res });
  }
  let f = path.join(DIST, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  return route.fulfill({ body: fs.readFileSync(f), contentType: types[path.extname(f)] || 'application/octet-stream' });
});
const p = await c.newPage();
const api = (url, method = 'GET', body) => p.evaluate(async ([url, method, body]) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}, [url, method, body]);
const scroller = () => p.locator('.main-content');
const topAnchor = () => p.evaluate(() => {
  const c = document.querySelector('.main-content'); const top = c.getBoundingClientRect().top;
  for (const r of c.querySelectorAll('[data-episode-id]')) { const b = r.getBoundingClientRect(); if (b.bottom > top + 1) return { id: Number(r.dataset.episodeId), offset: Math.round(b.top - top) }; }
  return null;
});
const rows = () => p.locator('.episode-list [data-episode-id]').count();
const openChannel = async (id) => { await p.goto(ORIGIN + '/#library'); await p.waitForTimeout(300); await p.goto(ORIGIN + `/#podcast/${id}`); await p.waitForSelector('.episode-list [data-episode-id]'); await p.waitForTimeout(1200); };

await p.goto(ORIGIN + '/');
check('login', (await api('/api/auth/login', 'POST', { username: 'qa-hive1173', password: pw })).status === 200);
await p.evaluate(() => { localStorage.setItem('podda:last-seen-version', '1.2.2'); for (const k of ['podda:swipe-hint-v1', 'podda:hint-sidebar-swipe-v1', 'podda:hint-mini-expand-v1', 'podda:hint-channel-filters-v2']) localStorage.setItem(k, '1'); });
await p.reload();
const pid = (await api('/api/podcasts')).json.find?.(x => /rest is history/i.test(x.title))?.id ?? 3;

// API: validation and backward compatibility (pre-1.2.2 apps send no rememberScroll)
check('old-client preferences PUT', (await api('/api/preferences', 'PUT', { channelSort: 'newest', channelHideCompleted: false })).status === 200);
check('bad channel sort 400', (await api(`/api/channel-settings/${pid}`, 'PUT', { sort: 'random' })).status === 400);
check('unknown key 400', (await api(`/api/channel-settings/${pid}`, 'PUT', { evil: true })).status === 400);
check('bad scroll 400', (await api(`/api/scroll/podcast/${pid}`, 'PUT', { sort: 'newest', episodeId: -1, index: 0, offset: 0 })).status === 400);
check('fresh channel settings all null', JSON.stringify((await api(`/api/channel-settings/${pid}`)).json) === '{"sort":null,"hideCompleted":null,"rememberScroll":null}');

// Gear hint (first channel open after the filters hint was seen)
await openChannel(pid);
const gearHint = await p.$('.hint-spotlight');
if (gearHint) {
  const [hb, gb] = [await gearHint.boundingBox(), await p.locator('[data-hint="channel-settings"]').boundingBox()];
  check('gear hint spotlights the gear', hb.x <= gb.x && hb.x + hb.width >= gb.x + gb.width);
  await p.screenshot({ path: `${OUT}/1-gear-hint.png` });
  await p.click('.hint-overlay');
} else check('gear hint spotlights the gear', false, 'no hint');
const header = await p.locator('.episode-list-header-actions').boundingBox();
check('header fits one row at 412px', header.height < 50 && header.x + header.width <= 412, JSON.stringify(header));
await p.screenshot({ path: `${OUT}/2-header.png` });

// Auto-load and Show all
check('no Load more button', (await p.locator('text=/Load more/').count()) === 0);
const before = await rows();
await scroller().evaluate(e => { e.scrollTop = e.scrollHeight; });
await p.waitForFunction((n) => document.querySelectorAll('.episode-list [data-episode-id]').length > n, before, { timeout: 8000 }).catch(() => {});
check('scrolling auto-loads the next page', (await rows()) > before, `${before} -> ${await rows()}`);
await p.click('text=Show all');
await p.waitForFunction(() => !document.querySelector('.text-link-muted'), null, { timeout: 15000 }).catch(() => {});
const total = Number((await p.locator('.episode-list-header > span').innerText()).match(/(\d+) episodes/)?.[1]);
check('Show all loads the whole channel', (await rows()) === total && total > 200, `${await rows()} of ${total}`);

// Sticky order from the header
await scroller().evaluate(e => { e.scrollTop = 0; });
await p.selectOption('.episode-list-header-actions .sort-select', 'oldest');
await p.waitForTimeout(800);
check('order saved for channel', (await api(`/api/channel-settings/${pid}`)).json.sort === 'oldest');
await openChannel(pid);
check('order sticks on reopen', (await p.locator('.episode-list-header-actions .sort-select').inputValue()) === 'oldest');
await p.selectOption('.episode-list-header-actions .sort-select', 'newest');
await p.waitForTimeout(800);
check('choosing the default order stores null', (await api(`/api/channel-settings/${pid}`)).json.sort === null);

// Settings sheet: Hide completed moved here; Filters no longer has it
await p.click('.filters-btn'); await p.waitForSelector('.sheet');
check('Filters sheet has no Hide completed control', !(await p.locator('.sheet label > span').allInnerTexts()).some(t => /hide completed/i.test(t)));
await p.keyboard.press('Escape'); await p.waitForSelector('.sheet', { state: 'detached' });
await p.click('[data-hint="channel-settings"]'); await p.waitForSelector('.sheet'); await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/3-settings-sheet.png` });
const labels = await p.locator('.sheet label > span').allInnerTexts();
check('settings sheet rows', JSON.stringify(labels) === JSON.stringify(['Episode order', 'Hide completed episodes', 'Remember scroll position']), JSON.stringify(labels));
check('defaults named in options', (await p.locator('.sheet select').nth(2).locator('option').first().innerText()) === 'Default (Off)');
await p.locator('.sheet select').nth(1).selectOption('true');
await p.locator('.sheet select').nth(2).selectOption('true');
await p.waitForTimeout(800);
const cs = (await api(`/api/channel-settings/${pid}`)).json;
check('settings saved', cs.hideCompleted === true && cs.rememberScroll === true, JSON.stringify(cs));
await p.click('.sheet-footer >> text=Done');

// Remember scroll: go deep (past page 1), leave, come back
const ids = [];
for (let offset = 0; offset < 800; offset += 200)
  ids.push(...(await api(`/api/episodes/podcast/${pid}?limit=200&offset=${offset}&sort=newest&hideCompleted=true&status=any&released_after=any`)).json.episodes.map(e => e.id));
await p.evaluate(async () => { const c = document.querySelector('.main-content'); for (let i = 0; i < 12; i++) { c.scrollTop += 1400; await new Promise(r => setTimeout(r, 250)); } });
await p.waitForTimeout(600);
const saved = await topAnchor();
const savedIdx = ids.indexOf(saved.id);
await openChannel(pid);
await p.waitForTimeout(800);
const restored = await topAnchor();
check('scroll restored past the first page', savedIdx >= 50 && restored.id === saved.id && Math.abs(restored.offset - saved.offset) <= 2, JSON.stringify({ savedIdx, saved, restored }));
await p.screenshot({ path: `${OUT}/4-restored.png` });

// The saved episode becomes hidden (played + Hide completed): land on the next one
await api(`/api/history/${saved.id}/mark-played`, 'POST');
await openChannel(pid);
await p.waitForTimeout(800);
const next = await topAnchor();
check('hidden anchor lands on the next visible episode', next.id === ids[savedIdx + 1], JSON.stringify({ expect: ids[savedIdx + 1], got: next.id }));
await api(`/api/history/${saved.id}/mark-unplayed`, 'POST');

// Changing the order at the top of the page and leaving at once (no scroll
// event) must not save the old order's top episode under the new order
// (ponytail finding 1).
await scroller().evaluate(e => { e.scrollTop = 0; }); await p.waitForTimeout(500);
const topNewest = (await topAnchor()).id;
await p.selectOption('.episode-list-header-actions .sort-select', 'oldest');
await p.waitForTimeout(300);
await p.goto(ORIGIN + '/#library'); await p.waitForTimeout(800);
const anchorBefore = topNewest;
const crossSaved = (await api(`/api/scroll/podcast/${pid}?sort=oldest`)).json;
check('no cross-order save after a sort change', crossSaved?.episodeId !== anchorBefore, JSON.stringify({ anchorBefore, crossSaved }));
await api(`/api/scroll/podcast/${pid}`, 'PUT', { sort: 'oldest', episodeId: 1, index: 0, offset: 0 }).catch(() => {});
await api(`/api/channel-settings/${pid}`, 'PUT', { sort: null });
await openChannel(pid);

// Filters reset when leaving (they are per visit)
await p.click('.filters-btn'); await p.waitForSelector('.sheet');
await p.locator('.sheet select').first().selectOption('unplayed');
await p.click('.sheet-footer >> text=Done');
await openChannel(pid);
check('filters reset after leaving', (await p.locator('.filters-btn-count').count()) === 0);

// Remember scroll off (default) starts at the top
await api(`/api/channel-settings/${pid}`, 'DELETE');
await p.evaluate(async () => { const c = document.querySelector('.main-content'); c.scrollTop = 3000; await new Promise(r => setTimeout(r, 400)); });
await openChannel(pid);
check('off: opens at the top', (await scroller().evaluate(e => e.scrollTop)) === 0);
check('reset clears overrides', JSON.stringify((await api(`/api/channel-settings/${pid}`)).json) === '{"sort":null,"hideCompleted":null,"rememberScroll":null}');

// Playlist scroll memory
const pl = (await api('/api/playlists')).json; const plId = (pl.playlists || pl)[0].id;
check('playlist remember_scroll saved', (await api(`/api/playlists/${plId}`, 'PUT', { remember_scroll: true })).json?.remember_scroll === true);
await p.goto(ORIGIN + `/#playlist/${plId}`); await p.waitForSelector('.episode-list [data-episode-id], [data-episode-id]'); await p.waitForTimeout(1200);
await p.evaluate(async () => { const c = document.querySelector('.main-content'); for (let i = 0; i < 6; i++) { c.scrollTop += 1500; await new Promise(r => setTimeout(r, 250)); } });
await p.waitForTimeout(500);
const plSaved = await topAnchor();
await p.goto(ORIGIN + '/#library'); await p.waitForTimeout(400);
await p.goto(ORIGIN + `/#playlist/${plId}`); await p.waitForSelector('[data-episode-id]'); await p.waitForTimeout(1500);
const plRestored = await topAnchor();
check('playlist scroll restored', plRestored.id === plSaved.id && Math.abs(plRestored.offset - plSaved.offset) <= 2, JSON.stringify({ plSaved, plRestored }));
check('playlist remember_scroll null resets', (await api(`/api/playlists/${plId}`, 'PUT', { remember_scroll: null })).json?.remember_scroll === null);
await p.click('[aria-label="Playlist settings"]'); await p.waitForSelector('.sheet'); await p.waitForTimeout(400);
await p.screenshot({ path: `${OUT}/5-playlist-sheet.png` });
await browser.close();
console.log(results.join('\n'));
if (results.some(r => r.startsWith('FAIL'))) process.exit(1);
