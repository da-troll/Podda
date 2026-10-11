const { Pool } = require('pg');

const pool = new Pool();

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Session table (connect-pg-simple)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" VARCHAR NOT NULL COLLATE "default",
        "sess" JSON NOT NULL,
        "expire" TIMESTAMPTZ(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    // Users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        display_name VARCHAR(100),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        email VARCHAR(255) UNIQUE,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    // Migrations: add columns that may not exist on older installs
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE`);

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS channel_sort VARCHAR(10) NOT NULL DEFAULT 'newest'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS channel_hide_completed BOOLEAN NOT NULL DEFAULT FALSE`);

    // Podcasts (shared across users)
    await client.query(`
      CREATE TABLE IF NOT EXISTS podcasts (
        id SERIAL PRIMARY KEY,
        feed_url TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        description TEXT,
        artwork_url TEXT,
        link TEXT,
        language VARCHAR(10),
        last_fetched TIMESTAMPTZ,
        last_build_date TIMESTAMPTZ,
        error_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Episodes
    await client.query(`
      CREATE TABLE IF NOT EXISTS episodes (
        id SERIAL PRIMARY KEY,
        podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
        guid TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        audio_url TEXT NOT NULL,
        audio_type VARCHAR(50),
        audio_length BIGINT,
        duration INTEGER,
        pub_date TIMESTAMPTZ,
        artwork_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(podcast_id, guid)
      );
      CREATE INDEX IF NOT EXISTS idx_episodes_podcast_pubdate ON episodes(podcast_id, pub_date DESC);
    `);

    // Subscriptions (user <-> podcast)
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
        subscribed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, podcast_id)
      );
    `);

    // Listen progress (per user per episode)
    await client.query(`
      CREATE TABLE IF NOT EXISTS listen_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        played_at TIMESTAMPTZ,
        play_count INTEGER DEFAULT 0,
        completed_at TIMESTAMPTZ,
        UNIQUE(user_id, episode_id)
      );
      CREATE INDEX IF NOT EXISTS idx_progress_user ON listen_progress(user_id);
    `);

    // Play queue (ordered per user)
    await client.query(`
      CREATE TABLE IF NOT EXISTS queue (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, episode_id)
      );
      CREATE INDEX IF NOT EXISTS idx_queue_user_position ON queue(user_id, position);
    `);

    // Playlists (manual and smart)
    await client.query(`
      CREATE TABLE IF NOT EXISTS playlists (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        is_smart BOOLEAN DEFAULT FALSE,
        rules JSONB,
        sort_order VARCHAR(20) DEFAULT 'manual',
        auto_remove_completed BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
    `);

    // Playlist episodes (manual playlist ordering)
    await client.query(`
      CREATE TABLE IF NOT EXISTS playlist_episodes (
        id SERIAL PRIMARY KEY,
        playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(playlist_id, episode_id)
      );
      CREATE INDEX IF NOT EXISTS idx_playlist_episodes_order ON playlist_episodes(playlist_id, position);
    `);

    // Feedback
    await client.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        topic TEXT NOT NULL,
        details TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
    `);

    // Announcements (admin-created notifications for all users)
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        body VARCHAR(1000),
        type VARCHAR(20) DEFAULT 'info',
        starts_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS announcement_dismissals (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
        dismissed_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, announcement_id)
      );
    `);

    // HIVE-1178: per-channel settings (NULL = follow the account default),
    // remember-scroll defaults and saved scroll anchors.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS remember_scroll BOOLEAN NOT NULL DEFAULT FALSE`);
    await client.query(`ALTER TABLE playlists ADD COLUMN IF NOT EXISTS remember_scroll BOOLEAN`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS channel_settings (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
        sort VARCHAR(10),
        hide_completed BOOLEAN,
        remember_scroll BOOLEAN,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, podcast_id)
      );
      CREATE TABLE IF NOT EXISTS scroll_positions (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        scope VARCHAR(10) NOT NULL,
        target_id INTEGER NOT NULL,
        sort VARCHAR(10) NOT NULL,
        episode_id INTEGER NOT NULL,
        anchor_index INTEGER NOT NULL DEFAULT 0,
        offset_px INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, scope, target_id, sort)
      );
    `);

    await client.query('COMMIT');
    console.log('[podda] Database schema initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[podda] Database init failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  initDB,
};
