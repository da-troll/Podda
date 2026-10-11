const crypto = require('crypto');
const db = require('./db.cjs');

// HIVE-1180: remember which client (Android app or web) and which version each
// user last used, per device, plus the device's last update-check result, so
// "did X get the update?" is a lookup. Old app builds send no headers; their
// WebView or native-HTTP user agent still marks them as the Android app.

const WRITE_EVERY_MS = 60 * 1000;
const lastWrite = new Map(); // `${userId}:${deviceId}` -> { at, check }

function versionFromCode(code) {
  const n = Number(code);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  // Version codes are major*10000 + minor*100 + patch (1.2.2 -> 10202).
  return n >= 10000 ? `${Math.floor(n / 10000)}.${Math.floor(n / 100) % 100}.${n % 100}` : `1.0.${n}`;
}

const clip = (v, n) => (typeof v === 'string' && v.length ? v.slice(0, n) : null);

function describeClient(headers, sessionId) {
  const ua = clip(headers['user-agent'], 300) || '';
  const app = /^android\/(\d{1,7})$/.exec(headers['x-podda-app'] || '');
  const device = headers['x-podda-device'];
  const check = /^([0-9T:.\-Z]{10,30});([a-z-]{1,20});?(.{0,200})$/.exec(headers['x-podda-update-check'] || '');
  return {
    deviceId: /^[A-Za-z0-9-]{8,64}$/.test(device || '')
      ? device
      : `session-${crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 16)}`,
    platform: app || /; wv\)|Dalvik\//.test(ua) ? 'android-app' : 'web',
    appVersion: app ? versionFromCode(app[1]) : null,
    webVersion: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(headers['x-podda-web'] || '') ? headers['x-podda-web'] : null,
    userAgent: ua || null,
    updateCheck: check && !Number.isNaN(Date.parse(check[1]))
      ? { at: new Date(check[1]), result: check[2], detail: check[3] || null }
      : null,
  };
}

function trackClient(req, res, next) {
  next();
  const userId = req.session?.userId;
  if (!userId) return;
  const c = describeClient(req.headers, req.sessionID);
  const key = `${userId}:${c.deviceId}`;
  const prev = lastWrite.get(key);
  const checkSig = c.updateCheck ? `${c.updateCheck.at.toISOString()};${c.updateCheck.result}` : '';
  if (prev && Date.now() - prev.at < WRITE_EVERY_MS && prev.check === checkSig) return;
  lastWrite.set(key, { at: Date.now(), check: checkSig });
  db.query(
    `INSERT INTO client_devices (user_id, device_id, platform, app_version, web_version, user_agent,
       update_check_at, update_check_result, update_check_detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (user_id, device_id) DO UPDATE SET
       platform = $3, app_version = COALESCE($4, client_devices.app_version),
       web_version = COALESCE($5, client_devices.web_version), user_agent = $6,
       update_check_at = COALESCE($7, client_devices.update_check_at),
       update_check_result = COALESCE($8, client_devices.update_check_result),
       update_check_detail = CASE WHEN $8::text IS NULL THEN client_devices.update_check_detail ELSE $9 END,
       last_seen = NOW()`,
    [userId, c.deviceId, c.platform, c.appVersion, c.webVersion, c.userAgent,
      c.updateCheck?.at ?? null, c.updateCheck?.result ?? null, c.updateCheck?.detail ?? null],
  ).catch((err) => console.error('[clients] track error:', err.message));
}

module.exports = { trackClient, describeClient, versionFromCode };
