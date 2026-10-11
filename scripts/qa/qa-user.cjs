// Scratch user for scripts/qa probes: node qa-user.cjs create|delete
// Reads DB settings from PODDA_ROOT/.env (default /opt/apps/podda).
const ROOT = process.env.PODDA_ROOT || '/opt/apps/podda';
require(ROOT + '/node_modules/dotenv').config({ path: ROOT + '/.env' });
const { Pool } = require(ROOT + '/node_modules/pg');
const bcrypt = require(ROOT + '/node_modules/bcrypt');
const crypto = require('crypto'); const fs = require('fs');
const pool = new Pool(); const U = 'qa-hive1173';
(async () => {
  if (process.argv[2] === 'delete') {
    const r = await pool.query('DELETE FROM users WHERE username=$1', [U]);
    console.log('deleted', r.rowCount);
  } else {
    const pw = crypto.randomBytes(18).toString('base64url');
    const h = await bcrypt.hash(pw, 10);
    const u = await pool.query("INSERT INTO users (username,password_hash,display_name,is_admin) VALUES ($1,$2,'QA',false) RETURNING id", [U, h]);
    const id = u.rows[0].id;
    const p = await pool.query("SELECT id,title FROM podcasts WHERE title ILIKE '%rest is history%' LIMIT 1");
    await pool.query('INSERT INTO subscriptions (user_id,podcast_id) VALUES ($1,$2)', [id, p.rows[0].id]);
    await pool.query("INSERT INTO playlists (user_id,name,is_smart,rules,sort_order) VALUES ($1,'QA smart',true,$2,'newest')", [id, JSON.stringify({ podcasts: [p.rows[0].id] })]);
    fs.writeFileSync(process.env.QA_PW_FILE, pw, { mode: 0o600 });
    console.log('created user', id, 'podcast', p.rows[0].id, p.rows[0].title);
  }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
