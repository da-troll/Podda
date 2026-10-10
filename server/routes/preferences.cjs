const { Router } = require('express');
const { requireAuth } = require('../auth.cjs');
const db = require('../db.cjs');
const router = Router();
router.use(requireAuth);
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT channel_sort AS "channelSort", channel_hide_completed AS "channelHideCompleted" FROM users WHERE id = $1',
      [req.session.userId],
    );
    if (!result.rows[0])
      return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to load preferences' });
  }
});
router.put('/', async (req, res) => {
  const { channelSort, channelHideCompleted } = req.body;
  if (
    !['newest', 'oldest'].includes(channelSort) ||
    typeof channelHideCompleted !== 'boolean'
  )
    return res.status(400).json({ error: 'Invalid preferences' });
  try {
    const result = await db.query(
      'UPDATE users SET channel_sort = $2, channel_hide_completed = $3 WHERE id = $1 RETURNING channel_sort AS "channelSort", channel_hide_completed AS "channelHideCompleted"',
      [req.session.userId, channelSort, channelHideCompleted],
    );
    if (!result.rows[0])
      return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});
module.exports = router;
