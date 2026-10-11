const test = require('node:test');
const assert = require('node:assert');
const { describeClient, versionFromCode } = require('./client-tracker.cjs');

test('version codes map to versions', () => {
  assert.strictEqual(versionFromCode(10202), '1.2.2');
  assert.strictEqual(versionFromCode(10100), '1.1.0');
  assert.strictEqual(versionFromCode(49), '1.0.49');
  assert.strictEqual(versionFromCode('x'), null);
});

test('new Android app: version, device and update check from headers', () => {
  const c = describeClient({
    'x-podda-app': 'android/10203', 'x-podda-web': '1.2.3', 'x-podda-device': 'abcd1234-ef56',
    'x-podda-update-check': '2026-10-11T13:00:00.000Z;fetch-error;TypeError: Failed to fetch',
    'user-agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) Chrome/140',
  }, 'sid');
  assert.deepStrictEqual(
    { ...c, updateCheck: { ...c.updateCheck, at: c.updateCheck.at.toISOString() } },
    { deviceId: 'abcd1234-ef56', platform: 'android-app', appVersion: '1.2.3', webVersion: '1.2.3',
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) Chrome/140',
      updateCheck: { at: '2026-10-11T13:00:00.000Z', result: 'fetch-error', detail: 'TypeError: Failed to fetch' } });
});

test('old Android app without headers is still the app, keyed by session', () => {
  const a = describeClient({ 'user-agent': 'Dalvik/2.1.0 (Linux; U; Android 14; SM-A546B)' }, 'sid-1');
  assert.strictEqual(a.platform, 'android-app');
  assert.strictEqual(a.appVersion, null);
  assert.match(a.deviceId, /^session-[0-9a-f]{16}$/);
  assert.notStrictEqual(a.deviceId, describeClient({}, 'sid-2').deviceId);
});

test('desktop browser is web; junk headers are ignored', () => {
  const c = describeClient({
    'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/141', 'x-podda-app': 'ios/1', 'x-podda-device': '../../etc',
    'x-podda-web': '1.2', 'x-podda-update-check': 'not-a-date;banner',
  }, 'sid');
  assert.strictEqual(c.platform, 'web');
  assert.strictEqual(c.appVersion, null);
  assert.strictEqual(c.webVersion, null);
  assert.strictEqual(c.updateCheck, null);
  assert.match(c.deviceId, /^session-/);
});
