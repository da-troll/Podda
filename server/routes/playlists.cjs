const { Router } = require('express');
const db = require('../db.cjs');
const { requireAuth } = require('../auth.cjs');

const router = Router();

// ── Smart Playlist Rule Engine ─────────────────────────────

/**
 * Converts JSONB rules to SQL WHERE clauses + params.
 * Returns { where: string, params: any[], nextParam: number }
 * Assumes $1 = user_id is already bound. nextParam starts at 2.
 */
function buildSmartWhere(rules, userId) {
  const conditions = [];
  const params = [userId];
  let p = 2; // next param index

  // Podcast inclusion filter
  if (rules.podcasts && rules.podcasts.length > 0) {
    conditions.push(`e.podcast_id = ANY($${p})`);
    params.push(rules.podcasts);
    p++;
  }

  // Podcast exclusion filter
  if (rules.exclude_podcasts && rules.exclude_podcasts.length > 0) {
    conditions.push(`e.podcast_id != ALL($${p})`);
    params.push(rules.exclude_podcasts);
    p++;
  }

  // If no podcast filter specified, default to subscribed podcasts only
  if ((!rules.podcasts || rules.podcasts.length === 0) && (!rules.exclude_podcasts || rules.exclude_podcasts.length === 0)) {
    conditions.push(`EXISTS (SELECT 1 FROM subscriptions s WHERE s.podcast_id = e.podcast_id AND s.user_id = $1)`);
  }

  // Episode status filter
  if (rules.status && rules.status !== 'any') {
    if (rules.status === 'unplayed') {
      conditions.push(`(lp.id IS NULL OR (lp.position = 0 AND lp.completed = false))`);
    } else if (rules.status === 'in-progress') {
      conditions.push(`(lp.position > 0 AND lp.completed = false)`);
    } else if (rules.status === 'played') {
      conditions.push(`lp.completed = true`);
    }
  }

  // Release date filter
  if (rules.released_after && rules.released_after !== 'any') {
    const intervalMap = {
      '24h': '24 hours',
      '3d': '3 days',
      '7d': '7 days',
      '14d': '14 days',
      '30d': '30 days',
    };
    const interval = intervalMap[rules.released_after];
    if (interval) {
      conditions.push(`e.pub_date >= NOW() - INTERVAL '${interval}'`);
    }
  }

  // Duration filters
  if (rules.duration_min != null) {
    conditions.push(`e.duration >= $${p}`);
    params.push(rules.duration_min);
    p++;
  }
  if (rules.duration_max != null) {
    conditions.push(`e.duration <= $${p}`);
    params.push(rules.duration_max);
    p++;
  }

  return {
    where: conditions.length > 0 ? conditions.join(' AND ') : 'true',
    params,
  };
}

function getSortClause(sortOrder, isSmart) {
  if (!isSmart && sortOrder === 'manual') return 'pe.position ASC';
  if (sortOrder === 'newest') return 'e.pub_date DESC NULLS LAST';
  if (sortOrder === 'oldest') return 'e.pub_date ASC NULLS LAST';
  if (sortOrder === 'shortest') return 'e.duration ASC NULLS LAST';
  if (sortOrder === 'longest') return 'e.duration DESC NULLS LAST';
  // Default for smart playlists
  return 'e.pub_date DESC NULLS LAST';
}

// ── Routes ─────────────────────────────────────────────────

// GET /api/playlists — list user's playlists with episode counts + total duration
router.get('/', requireAuth, async (req, res) => {
  try {
    // Get all playlists
    const plResult = await db.query(
      'SELECT * FROM playlists WHERE user_id = $1 ORDER BY updated_at DESC',
      [req.session.userId]
    );

    // Enrich each with episode count + total duration
    const playlists = [];
    for (const pl of plResult.rows) {
      let count = 0;
      let duration = 0;

      if (pl.is_smart && pl.rules) {
        const { where, params } = buildSmartWhere(pl.rules, req.session.userId);
        const completedFilter = pl.auto_remove_completed ? 'AND COALESCE(lp.completed, false) = false' : '';
        const stats = await db.query(`
          SELECT COUNT(*)::int AS cnt, COALESCE(SUM(e.duration), 0)::int AS dur
          FROM episodes e
          LEFT JOIN listen_progress lp ON lp.episode_id = e.id AND lp.user_id = $1
          WHERE ${where} ${completedFilter}
        `, params);
        count = stats.rows[0].cnt;
        duration = stats.rows[0].dur;
      } else {
        const completedFilter = pl.auto_remove_completed ? 'AND COALESCE(lp.completed, false) = false' : '';
        const stats = await db.query(`
          SELECT COUNT(*)::int AS cnt, COALESCE(SUM(e.duration), 0)::int AS dur
          FROM playlist_episodes pe
          JOIN episodes e ON e.id = pe.episode_id
          LEFT JOIN listen_progress lp ON lp.episode_id = e.id AND lp.user_id = $1
          WHERE pe.playlist_id = $2 ${completedFilter}
        `, [req.session.userId, pl.id]);
        count = stats.rows[0].cnt;
        duration = stats.rows[0].dur;
      }

      playlists.push({ ...pl, episode_count: count, total_duration: duration });
    }

    res.json(playlists);
  } catch (err) {
    console.error('[playlists] List error:', err.message);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// POST /api/playlists — create playlist
router.post('/', requireAuth, async (req, res) => {
  const { name, is_smart, rules, sort_order, auto_remove_completed } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  // Smart playlists default to 'newest' if no sort_order given
  const effectiveSort = sort_order || (is_smart ? 'newest' : 'manual');

  try {
    const result = await db.query(`
      INSERT INTO playlists (user_id, name, is_smart, rules, sort_order, auto_remove_completed)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      req.session.userId,
      name.trim(),
      is_smart || false,
      rules ? JSON.stringify(rules) : null,
      effectiveSort,
      auto_remove_completed !== false,
    ]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[playlists] Create error:', err.message);
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

// PUT /api/playlists/:id — update playlist
router.put('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, rules, sort_order, auto_remove_completed } = req.body;
  // remember_scroll is tri-state: true/false, or null to follow the account default.
  const hasRememberScroll = Object.hasOwn(req.body, 'remember_scroll');
  if (hasRememberScroll && req.body.remember_scroll !== null && typeof req.body.remember_scroll !== 'boolean')
    return res.status(400).json({ error: 'Invalid remember_scroll' });

  try {
    const result = await db.query(`
      UPDATE playlists
      SET name = COALESCE($3, name),
          rules = COALESCE($4, rules),
          sort_order = COALESCE($5, sort_order),
          auto_remove_completed = COALESCE($6, auto_remove_completed),
          remember_scroll = CASE WHEN $7 THEN $8::boolean ELSE remember_scroll END,
          updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `, [id, req.session.userId, name?.trim() || null, rules ? JSON.stringify(rules) : null, sort_order || null, auto_remove_completed, hasRememberScroll, hasRememberScroll ? req.body.remember_scroll : null]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[playlists] Update error:', err.message);
    res.status(500).json({ error: 'Failed to update playlist' });
  }
});

// DELETE /api/playlists/:id — delete playlist
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const result = await db.query(
      'DELETE FROM playlists WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[playlists] Delete error:', err.message);
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

// GET /api/playlists/:id/episodes — get episodes for a playlist
router.get('/:id/episodes', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const pl = await db.query(
      'SELECT * FROM playlists WHERE id = $1 AND user_id = $2',
      [id, req.session.userId]
    );
    if (pl.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const playlist = pl.rows[0];
    const orderClause = getSortClause(playlist.sort_order, playlist.is_smart);
    const completedFilter = playlist.auto_remove_completed
      ? 'AND COALESCE(lp.completed, false) = false'
      : '';

    let result;

    if (playlist.is_smart && playlist.rules) {
      // Smart playlist: live query from rules
      const { where, params } = buildSmartWhere(playlist.rules, req.session.userId);
      result = await db.query(`
        SELECT e.*,
          p.title AS podcast_title,
          p.artwork_url AS podcast_artwork_url,
          p.author AS podcast_author,
          lp.position AS listen_position,
          lp.completed AS listen_completed,
          lp.updated_at AS progress_updated_at
        FROM episodes e
        JOIN podcasts p ON p.id = e.podcast_id
        LEFT JOIN listen_progress lp ON lp.episode_id = e.id AND lp.user_id = $1
        WHERE ${where} ${completedFilter}
        ORDER BY ${orderClause}
      `, params);
    } else {
      // Manual playlist: from junction table
      result = await db.query(`
        SELECT e.*,
          p.title AS podcast_title,
          p.artwork_url AS podcast_artwork_url,
          p.author AS podcast_author,
          lp.position AS listen_position,
          lp.completed AS listen_completed,
          lp.updated_at AS progress_updated_at,
          pe.position AS playlist_position
        FROM playlist_episodes pe
        JOIN episodes e ON e.id = pe.episode_id
        JOIN podcasts p ON p.id = e.podcast_id
        LEFT JOIN listen_progress lp ON lp.episode_id = e.id AND lp.user_id = $2
        WHERE pe.playlist_id = $1
          ${completedFilter}
        ORDER BY ${orderClause}
      `, [id, req.session.userId]);
    }

    res.json({ playlist, episodes: result.rows });
  } catch (err) {
    console.error('[playlists] Episodes error:', err.message);
    res.status(500).json({ error: 'Failed to fetch playlist episodes' });
  }
});

// POST /api/playlists/:id/episodes — add episode(s) to manual playlist
router.post('/:id/episodes', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { episode_ids } = req.body;

  if (!Array.isArray(episode_ids) || episode_ids.length === 0) {
    return res.status(400).json({ error: 'episode_ids array required' });
  }

  try {
    const pl = await db.query(
      'SELECT id, is_smart FROM playlists WHERE id = $1 AND user_id = $2',
      [id, req.session.userId]
    );
    if (pl.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });
    if (pl.rows[0].is_smart) return res.status(400).json({ error: 'Cannot add episodes to smart playlists' });

    const maxPos = await db.query(
      'SELECT COALESCE(MAX(position), -1) AS max_pos FROM playlist_episodes WHERE playlist_id = $1',
      [id]
    );
    let pos = maxPos.rows[0].max_pos + 1;

    const added = [];
    for (const epId of episode_ids) {
      try {
        await db.query(`
          INSERT INTO playlist_episodes (playlist_id, episode_id, position)
          VALUES ($1, $2, $3)
          ON CONFLICT (playlist_id, episode_id) DO NOTHING
        `, [id, epId, pos]);
        added.push(epId);
        pos++;
      } catch (e) {
        // skip invalid episode IDs
      }
    }

    await db.query('UPDATE playlists SET updated_at = NOW() WHERE id = $1', [id]);
    res.json({ ok: true, added: added.length });
  } catch (err) {
    console.error('[playlists] Add episodes error:', err.message);
    res.status(500).json({ error: 'Failed to add episodes' });
  }
});

// DELETE /api/playlists/:id/episodes/:episodeId — remove episode from manual playlist
router.delete('/:id/episodes/:episodeId', requireAuth, async (req, res) => {
  const playlistId = parseInt(req.params.id);
  const episodeId = parseInt(req.params.episodeId);

  try {
    const pl = await db.query(
      'SELECT id FROM playlists WHERE id = $1 AND user_id = $2',
      [playlistId, req.session.userId]
    );
    if (pl.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });

    await db.query(
      'DELETE FROM playlist_episodes WHERE playlist_id = $1 AND episode_id = $2',
      [playlistId, episodeId]
    );
    await db.query('UPDATE playlists SET updated_at = NOW() WHERE id = $1', [playlistId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[playlists] Remove episode error:', err.message);
    res.status(500).json({ error: 'Failed to remove episode' });
  }
});

// PUT /api/playlists/:id/reorder — reorder manual playlist
router.put('/:id/reorder', requireAuth, async (req, res) => {
  const playlistId = parseInt(req.params.id);
  const { episode_ids } = req.body;

  if (!Array.isArray(episode_ids)) {
    return res.status(400).json({ error: 'episode_ids array required' });
  }

  try {
    const pl = await db.query(
      'SELECT id, is_smart FROM playlists WHERE id = $1 AND user_id = $2',
      [playlistId, req.session.userId]
    );
    if (pl.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });
    if (pl.rows[0].is_smart) return res.status(400).json({ error: 'Cannot reorder smart playlists' });

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < episode_ids.length; i++) {
        await client.query(
          'UPDATE playlist_episodes SET position = $1 WHERE playlist_id = $2 AND episode_id = $3',
          [i, playlistId, episode_ids[i]]
        );
      }
      await client.query('UPDATE playlists SET updated_at = NOW() WHERE id = $1', [playlistId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[playlists] Reorder error:', err.message);
    res.status(500).json({ error: 'Failed to reorder playlist' });
  }
});

// POST /api/playlists/:id/queue — inject playlist episodes into queue (play next / play last)
router.post('/:id/queue', requireAuth, async (req, res) => {
  const playlistId = parseInt(req.params.id);
  const { mode } = req.body;

  if (!['next', 'last'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "next" or "last"' });
  }

  try {
    const pl = await db.query(
      'SELECT * FROM playlists WHERE id = $1 AND user_id = $2',
      [playlistId, req.session.userId]
    );
    if (pl.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });

    const playlist = pl.rows[0];
    const orderClause = getSortClause(playlist.sort_order, playlist.is_smart);
    const completedFilter = playlist.auto_remove_completed
      ? 'AND COALESCE(lp.completed, false) = false'
      : '';

    let episodes;

    if (playlist.is_smart && playlist.rules) {
      const { where, params } = buildSmartWhere(playlist.rules, req.session.userId);
      episodes = await db.query(`
        SELECT e.id AS episode_id
        FROM episodes e
        LEFT JOIN listen_progress lp ON lp.episode_id = e.id AND lp.user_id = $1
        WHERE ${where} ${completedFilter}
        ORDER BY ${orderClause}
      `, params);
    } else {
      episodes = await db.query(`
        SELECT pe.episode_id
        FROM playlist_episodes pe
        JOIN episodes e ON e.id = pe.episode_id
        LEFT JOIN listen_progress lp ON lp.episode_id = e.id AND lp.user_id = $2
        WHERE pe.playlist_id = $1
          ${completedFilter}
        ORDER BY ${orderClause}
      `, [playlistId, req.session.userId]);
    }

    if (episodes.rows.length === 0) {
      return res.json({ ok: true, added: 0 });
    }

    const episodeIds = episodes.rows.map(r => r.episode_id);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      if (mode === 'last') {
        const maxPos = await client.query(
          'SELECT COALESCE(MAX(position), -1) AS max_pos FROM queue WHERE user_id = $1',
          [req.session.userId]
        );
        let pos = maxPos.rows[0].max_pos + 1;
        for (const epId of episodeIds) {
          await client.query(`
            INSERT INTO queue (user_id, episode_id, position)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, episode_id) DO NOTHING
          `, [req.session.userId, epId, pos]);
          pos++;
        }
      } else {
        await client.query(`
          UPDATE queue SET position = position + $2
          WHERE user_id = $1 AND position > 0
        `, [req.session.userId, episodeIds.length]);

        for (let i = 0; i < episodeIds.length; i++) {
          await client.query(`
            INSERT INTO queue (user_id, episode_id, position)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, episode_id) DO UPDATE SET position = $3
          `, [req.session.userId, episodeIds[i], i + 1]);
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ ok: true, added: episodeIds.length });
  } catch (err) {
    console.error('[playlists] Queue inject error:', err.message);
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

module.exports = router;
