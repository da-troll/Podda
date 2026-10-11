const { Router } = require('express');
const { requireAdmin } = require('../auth.cjs');
const db = require('../db.cjs');
const router = Router();

// HIVE-1180: every user's devices, most recent first (admin only).
router.get('/', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.username, u.display_name AS "displayName", d.device_id AS "deviceId", d.platform,
        d.app_version AS "appVersion", d.web_version AS "webVersion", d.user_agent AS "userAgent",
        d.update_check_at AS "updateCheckAt", d.update_check_result AS "updateCheckResult",
        d.update_check_detail AS "updateCheckDetail", d.first_seen AS "firstSeen", d.last_seen AS "lastSeen"
      FROM client_devices d JOIN users u ON u.id = d.user_id
      ORDER BY u.username, d.last_seen DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error('[devices] list error:', err.message);
    res.status(500).json({ error: 'Failed to load devices' });
  }
});

module.exports = router;
