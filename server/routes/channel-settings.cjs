const { Router } = require('express');
const { requireAuth } = require('../auth.cjs');
const db = require('../db.cjs');
const router = Router();
router.use(requireAuth);

// Per-channel overrides. Every field is tri-state: a value, or null to follow
// the account default in /api/preferences.
const FIELDS = {
  sort: { column: 'sort', valid: (v) => ['newest', 'oldest', 'shortest', 'longest'].includes(v) },
  hideCompleted: { column: 'hide_completed', valid: (v) => typeof v === 'boolean' },
  rememberScroll: { column: 'remember_scroll', valid: (v) => typeof v === 'boolean' },
};
const SELECT = 'sort, hide_completed AS "hideCompleted", remember_scroll AS "rememberScroll"';
const EMPTY = { sort: null, hideCompleted: null, rememberScroll: null };

function podcastId(req) {
  const id = Number(req.params.podcastId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

router.get('/:podcastId', async (req, res) => {
  const id = podcastId(req);
  if (!id) return res.status(400).json({ error: 'Invalid podcast' });
  try {
    const result = await db.query(`SELECT ${SELECT} FROM channel_settings WHERE user_id = $1 AND podcast_id = $2`, [req.session.userId, id]);
    res.json(result.rows[0] || EMPTY);
  } catch {
    res.status(500).json({ error: 'Failed to load channel settings' });
  }
});

// Partial update: only the keys present change; null resets a key to default.
router.put('/:podcastId', async (req, res) => {
  const id = podcastId(req);
  if (!id) return res.status(400).json({ error: 'Invalid podcast' });
  const keys = Object.keys(req.body || {});
  if (!keys.length || keys.some((k) => !Object.hasOwn(FIELDS, k) || (req.body[k] !== null && !FIELDS[k].valid(req.body[k]))))
    return res.status(400).json({ error: 'Invalid channel settings' });
  const columns = keys.map((k) => FIELDS[k].column);
  const values = keys.map((k) => req.body[k]);
  try {
    const result = await db.query(
      `INSERT INTO channel_settings (user_id, podcast_id, ${columns.join(', ')})
       VALUES ($1, $2, ${columns.map((_, i) => `$${i + 3}`).join(', ')})
       ON CONFLICT (user_id, podcast_id) DO UPDATE SET ${columns.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = NOW()
       RETURNING ${SELECT}`,
      [req.session.userId, id, ...values],
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(404).json({ error: 'Podcast not found' });
    res.status(500).json({ error: 'Failed to save channel settings' });
  }
});

router.delete('/:podcastId', async (req, res) => {
  const id = podcastId(req);
  if (!id) return res.status(400).json({ error: 'Invalid podcast' });
  try {
    await db.query('DELETE FROM channel_settings WHERE user_id = $1 AND podcast_id = $2', [req.session.userId, id]);
    res.json(EMPTY);
  } catch {
    res.status(500).json({ error: 'Failed to reset channel settings' });
  }
});

module.exports = router;
