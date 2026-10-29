#!/usr/bin/env node
// HIVE-1526: link existing Podda users to their Authentik identity IN PLACE (users.authentik_uid).
// No users.id changes, so every user-keyed row stays where it is; the script proves that by
// counting each user's rows in every user-keyed table before and after, inside one transaction.
//
//   node scripts/migrate-authentik-users.cjs --link terje=<hashed_user_id> --link daniel=<...>
//   ... --apply      commit (without it: a dry run that rolls back)
//
// The mapping is explicit: Podda and Authentik usernames differ (Podda "terje" is Authentik
// "pappa"), and runtime auth matches users.authentik_uid only, never a username. The uid is the
// provider's "hashed user ID" subject (HIVE-1525), the same string as X-authentik-Uid and the
// mobile token's sub. Run scripts/backup-pre-authentik.sh first. Running it twice changes nothing
// the second time. Needs the authentik_uid column, which the deployed server adds at boot.
require('dotenv').config({ path: process.env.PODDA_ENV || '/opt/apps/podda/.env', quiet: true });

// Every table that holds a user's rows (db.cjs), with how to count one user's rows in it.
const COUNTS = {
  subscriptions: 'SELECT count(*) FROM subscriptions WHERE user_id = $1',
  listen_progress: 'SELECT count(*) FROM listen_progress WHERE user_id = $1',
  queue: 'SELECT count(*) FROM queue WHERE user_id = $1',
  playlists: 'SELECT count(*) FROM playlists WHERE user_id = $1',
  playlist_episodes: 'SELECT count(*) FROM playlist_episodes pe JOIN playlists p ON p.id = pe.playlist_id WHERE p.user_id = $1',
  scroll_positions: 'SELECT count(*) FROM scroll_positions WHERE user_id = $1',
  channel_settings: 'SELECT count(*) FROM channel_settings WHERE user_id = $1',
  client_devices: 'SELECT count(*) FROM client_devices WHERE user_id = $1',
  feedback: 'SELECT count(*) FROM feedback WHERE user_id = $1',
  announcement_dismissals: 'SELECT count(*) FROM announcement_dismissals WHERE user_id = $1',
  announcements: 'SELECT count(*) FROM announcements WHERE created_by = $1',
};

function parseLinks(argv) {
  const links = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--link') continue;
    const m = /^([^=\s]+)=(\S+)$/.exec(argv[i + 1] || '');
    if (!m) throw new Error(`--link needs <podda_username>=<authentik_uid>, got "${argv[i + 1] || ''}"`);
    links.push({ username: m[1], uid: m[2] });
  }
  if (!links.length) throw new Error('nothing to link: pass --link <podda_username>=<authentik_uid>');
  if (new Set(links.map((l) => l.username.toLowerCase())).size !== links.length) throw new Error('a username is linked twice');
  if (new Set(links.map((l) => l.uid)).size !== links.length) throw new Error('one authentik_uid is given to two users');
  return links;
}

async function countsFor(client, userId) {
  const out = {};
  for (const [t, sql] of Object.entries(COUNTS)) out[t] = Number((await client.query(sql, [userId])).rows[0].count);
  return out;
}

// Runs inside the caller's client; commits only with apply. Returns a report; throws on any refusal.
async function linkUsers(client, links, { apply = false, log = console.log } = {}) {
  const col = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'authentik_uid'`);
  if (!col.rowCount) throw new Error('users.authentik_uid does not exist yet: deploy the HIVE-1526 server first (it adds the column at boot)');
  await client.query('BEGIN');
  try {
    const report = [];
    for (const { username, uid } of links) {
      const u = await client.query('SELECT id, username, authentik_uid FROM users WHERE LOWER(username) = LOWER($1) FOR UPDATE', [username]);
      if (u.rowCount !== 1) throw new Error(`Podda user "${username}": ${u.rowCount} rows, need exactly 1`);
      const row = u.rows[0];
      const taken = await client.query('SELECT username FROM users WHERE authentik_uid = $1 AND id <> $2', [uid, row.id]);
      if (taken.rowCount) throw new Error(`authentik_uid for "${username}" is already linked to "${taken.rows[0].username}"`);
      if (row.authentik_uid && row.authentik_uid !== uid) throw new Error(`"${username}" is already linked to a different authentik_uid; refusing to overwrite`);
      const before = await countsFor(client, row.id);
      const changed = row.authentik_uid !== uid;
      if (changed) await client.query('UPDATE users SET authentik_uid = $1 WHERE id = $2', [uid, row.id]);
      const after = await countsFor(client, row.id);
      const same = Object.keys(before).every((t) => before[t] === after[t]);
      if (!same) throw new Error(`row counts moved for "${username}": ${JSON.stringify({ before, after })}`);
      report.push({ username: row.username, id: row.id, changed, counts: after });
      log(`${changed ? 'link' : 'already linked'}: ${row.username} (users.id ${row.id}); rows unchanged: ${Object.entries(after).map(([t, n]) => `${t} ${n}`).join(', ')}`);
    }
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    log(apply ? 'COMMITTED' : 'DRY RUN: rolled back (pass --apply to commit)');
    return report;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

if (require.main === module) {
  (async () => {
    const links = parseLinks(process.argv.slice(2));
    const { Client } = require('pg');
    const client = new Client();
    await client.connect();
    try { await linkUsers(client, links, { apply: process.argv.includes('--apply') }); } finally { await client.end(); }
  })().catch((err) => { console.error(`migrate-authentik-users: ${err.message}`); process.exit(1); });
}

module.exports = { linkUsers, parseLinks, COUNTS };
