const { Router } = require('express');
const db = require('../db.cjs');
const { requireAuth } = require('../auth.cjs');

const router = Router();

// Paginated channel episodes: sort and filter before pagination.
router.get('/podcast/:podcastId', requireAuth, async (req, res) => {
  let query;
  try {
    const podcastId = Number(req.params.podcastId);
    if (!Number.isSafeInteger(podcastId) || podcastId <= 0) throw new Error('Invalid podcast');
    query = require('../channel-query.cjs').channelQuery(req.query, req.session.userId, podcastId);
  } catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    const { cte, where, params, limit, offset } = query;
    const result = await db.query(`${cte} SELECT * FROM ranked WHERE ${where} ORDER BY channel_rank LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]);
    const count = await db.query(`${cte} SELECT COUNT(*) FROM ranked WHERE ${where}`, params);
    res.json({ episodes: result.rows.map(({ channel_rank, ...episode }) => episode), total: Number(count.rows[0].count) });
  } catch (err) {
    console.error('[episodes] List error:', err.message);
    res.status(500).json({ error: 'Failed to fetch episodes' });
  }
});

// GET /api/episodes/recent — recent episodes across all subscriptions
router.get('/recent', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

  try {
    const result = await db.query(`
      SELECT e.*,
        p.title AS podcast_title,
        p.artwork_url AS podcast_artwork_url,
        p.author AS podcast_author,
        lp.position AS listen_position,
        lp.completed AS listen_completed
      FROM episodes e
      JOIN subscriptions s ON s.podcast_id = e.podcast_id AND s.user_id = $1
      JOIN podcasts p ON p.id = e.podcast_id
      LEFT JOIN listen_progress lp ON lp.episode_id = e.id AND lp.user_id = $1
      ORDER BY e.pub_date DESC NULLS LAST
      LIMIT $2
    `, [req.session.userId, limit]);

    res.json(result.rows);
  } catch (err) {
    console.error('[episodes] Recent error:', err.message);
    res.status(500).json({ error: 'Failed to fetch recent episodes' });
  }
});

// GET /api/episodes/:id — single episode detail
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT e.*,
        p.title AS podcast_title,
        p.artwork_url AS podcast_artwork_url,
        p.author AS podcast_author,
        lp.position AS listen_position,
        lp.completed AS listen_completed
      FROM episodes e
      JOIN podcasts p ON p.id = e.podcast_id
      LEFT JOIN listen_progress lp ON lp.episode_id = e.id AND lp.user_id = $1
      WHERE e.id = $2
    `, [req.session.userId, parseInt(req.params.id)]);

    if (!result.rows[0]) return res.status(404).json({ error: 'Episode not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch episode' });
  }
});

module.exports = router;
