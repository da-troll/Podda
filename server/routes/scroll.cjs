const { Router } = require('express');
const { requireAuth } = require('../auth.cjs');
const db = require('../db.cjs');
const router = Router();
router.use(requireAuth);

// Saved scroll anchors: the episode at the top of the list, per channel or
// playlist and per sort order (a position under another order means nothing).
const SORTS = ['manual', 'newest', 'oldest', 'shortest', 'longest'];
const int = (v, min) => (Number.isSafeInteger(v) && v >= min ? v : null);

function key(req) {
  const scope = req.params.scope;
  const targetId = int(Number(req.params.targetId), 1);
  const sort = req.method === 'GET' ? req.query.sort : req.body?.sort;
  if (!['podcast', 'playlist'].includes(scope) || !targetId || !SORTS.includes(sort)) return null;
  return [req.session.userId, scope, targetId, sort];
}

router.get('/:scope/:targetId', async (req, res) => {
  const k = key(req);
  if (!k) return res.status(400).json({ error: 'Invalid scroll key' });
  try {
    const result = await db.query(
      'SELECT episode_id AS "episodeId", anchor_index AS "index", offset_px AS "offset" FROM scroll_positions WHERE user_id = $1 AND scope = $2 AND target_id = $3 AND sort = $4',
      k,
    );
    res.json(result.rows[0] || null);
  } catch {
    res.status(500).json({ error: 'Failed to load scroll position' });
  }
});

router.put('/:scope/:targetId', async (req, res) => {
  const k = key(req);
  const { episodeId, index, offset } = req.body || {};
  if (!k || !int(episodeId, 1) || int(index, 0) === null || !Number.isSafeInteger(offset) || Math.abs(offset) > 1e6)
    return res.status(400).json({ error: 'Invalid scroll position' });
  try {
    await db.query(
      `INSERT INTO scroll_positions (user_id, scope, target_id, sort, episode_id, anchor_index, offset_px)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, scope, target_id, sort) DO UPDATE
       SET episode_id = $5, anchor_index = $6, offset_px = $7, updated_at = NOW()`,
      [...k, episodeId, index, offset],
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to save scroll position' });
  }
});

module.exports = router;
