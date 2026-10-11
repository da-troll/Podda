require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const compression = require('compression');
const path = require('path');
const bcrypt = require('bcrypt');

const db = require('./db.cjs');
const { router: authRouter, requireAuth } = require('./auth.cjs');
const { router: podcastRouter } = require('./routes/podcasts.cjs');
const episodeRouter = require('./routes/episodes.cjs');
const playerRouter = require('./routes/player.cjs');
const searchRouter = require('./routes/search.cjs');
const historyRouter = require('./routes/history.cjs');
const playlistRouter = require('./routes/playlists.cjs');
const { pollFeeds } = require('./poller.cjs');
const feedbackRouter = require('./routes/feedback.cjs');
const announcementRouter = require('./routes/announcements.cjs');

const app = express();
const PORT = process.env.PORT || 3150;

if (!process.env.SESSION_SECRET) {
  console.error('[podda] SESSION_SECRET is required in .env');
  process.exit(1);
}

app.set('trust proxy', 1);

// Middleware
app.use(compression());
app.use(express.json({ limit: '2mb' }));

// Sessions
app.use(session({
  store: new pgSession({
    pool: db.pool,
    tableName: 'session',
  }),
  name: 'podda.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));

// API routes
app.use('/api/auth', authRouter);
app.use('/api/preferences', require('./routes/preferences.cjs'));
app.use('/api/channel-settings', require('./routes/channel-settings.cjs'));
app.use('/api/scroll', require('./routes/scroll.cjs'));
app.use('/api/podcasts', podcastRouter);
app.use('/api/episodes', episodeRouter);
app.use('/api/progress', playerRouter);
app.use('/api/search', searchRouter);
app.use('/api/history', historyRouter);
app.use('/api/playlists', playlistRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/announcements', announcementRouter);

// Serve static frontend
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Admin user seeding
async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;

  try {
    const result = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      const hash = await bcrypt.hash(password, 10);
      await db.query(
        'INSERT INTO users (username, password_hash, display_name, is_admin) VALUES ($1, $2, $3, true)',
        [username, hash, username]
      );
      console.log(`[podda] Seeded admin user: ${username}`);
    }
  } catch (err) {
    console.error('[podda] Failed to seed admin:', err.message);
  }
}

// Start
async function start() {
  try {
    await db.initDB();
    await seedAdmin();

    app.listen(PORT, () => {
      console.log(`[podda] Server running on port ${PORT}`);
    });

    // Start background RSS poller (every 30 min)
    // Run once on startup (after a short delay), then every 30 min
    setTimeout(pollFeeds, 10000);
    setInterval(pollFeeds, 30 * 60 * 1000);

  } catch (err) {
    console.error('[podda] Failed to start:', err);
    process.exit(1);
  }
}

start();
