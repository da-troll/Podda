// node --test scripts/migrate-authentik-users.test.cjs  (HIVE-1526)
// Runs against Podda's Postgres (PODDA_ENV, default /opt/apps/podda/.env) but touches only
// session-local TEMP tables: pg_temp comes first on the search_path, so the script's unqualified
// table names hit fixtures, never the live rows. Skips when no database is configured.
require('dotenv').config({ path: process.env.PODDA_ENV || '/opt/apps/podda/.env', quiet: true });
const test = require('node:test');
const assert = require('node:assert');
const { Client } = require('pg');
const { linkUsers, parseLinks, COUNTS } = require('./migrate-authentik-users.cjs');

const quiet = { log: () => {} };
let client;
test.before(async () => {
  if (!process.env.PGDATABASE) return;
  client = new Client();
  await client.connect();
  for (const t of ['users', ...Object.keys(COUNTS)]) await client.query(`CREATE TEMP TABLE ${t} (LIKE public.${t} INCLUDING DEFAULTS)`);
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS authentik_uid VARCHAR(255) UNIQUE');
  await client.query(`INSERT INTO users (id, username, password_hash, is_admin) VALUES (1, 'daniel', 'x', true), (2, 'terje', 'x', false), (3, 'nadine', 'x', false)`);
  await client.query(`INSERT INTO subscriptions (user_id, podcast_id) SELECT 2, g FROM generate_series(1, 6) g`);
  await client.query(`INSERT INTO listen_progress (user_id, episode_id, position) SELECT 2, g, 10 FROM generate_series(1, 40) g`);
  await client.query(`INSERT INTO playlists (id, user_id, name) VALUES (7, 2, 'p')`);
  await client.query(`INSERT INTO playlist_episodes (playlist_id, episode_id, position) VALUES (7, 1, 0), (7, 2, 1)`);
});
test.after(async () => { await client?.end(); });
const uids = async () => (await client.query('SELECT username, authentik_uid FROM users ORDER BY id')).rows.map((r) => `${r.username}=${r.authentik_uid}`);

test('parseLinks: explicit pairs, no duplicates either way', () => {
  assert.deepStrictEqual(parseLinks(['--link', 'terje=u2', '--link', 'daniel=u1']), [{ username: 'terje', uid: 'u2' }, { username: 'daniel', uid: 'u1' }]);
  assert.throws(() => parseLinks([]), /nothing to link/);
  assert.throws(() => parseLinks(['--link', 'terje']), /needs/);
  assert.throws(() => parseLinks(['--link', 'a=u', '--link', 'b=u']), /two users/);
  assert.throws(() => parseLinks(['--link', 'a=u', '--link', 'A=v']), /twice/);
});

test('dry run, apply, re-run, refusals', { skip: !process.env.PGDATABASE && 'no database configured' }, async () => {
  const links = [{ username: 'terje', uid: 'uid-pappa' }, { username: 'daniel', uid: 'uid-daniel' }];
  await linkUsers(client, links, quiet);
  assert.deepStrictEqual(await uids(), ['daniel=null', 'terje=null', 'nadine=null'], 'a dry run commits nothing');

  const r = await linkUsers(client, links, { ...quiet, apply: true });
  assert.deepStrictEqual(await uids(), ['daniel=uid-daniel', 'terje=uid-pappa', 'nadine=null']);
  const t = r.find((x) => x.username === 'terje');
  assert.deepStrictEqual([t.id, t.changed, t.counts.subscriptions, t.counts.listen_progress, t.counts.playlists, t.counts.playlist_episodes], [2, true, 6, 40, 1, 2]);

  const again = await linkUsers(client, links, { ...quiet, apply: true });
  assert.ok(again.every((x) => !x.changed), 'the second run changes nothing');

  await assert.rejects(linkUsers(client, [{ username: 'nadine', uid: 'uid-pappa' }], { ...quiet, apply: true }), /already linked to "terje"/);
  await assert.rejects(linkUsers(client, [{ username: 'terje', uid: 'uid-other' }], { ...quiet, apply: true }), /refusing to overwrite/);
  // atomic: a valid link followed by an unknown user commits neither
  await assert.rejects(linkUsers(client, [{ username: 'nadine', uid: 'uid-nadine' }, { username: 'pappa', uid: 'uid-x' }], { ...quiet, apply: true }), /"pappa": 0 rows/);
  assert.deepStrictEqual(await uids(), ['daniel=uid-daniel', 'terje=uid-pappa', 'nadine=null']);
  const live = new Client(); await live.connect();
  // works before and after the column exists on the live table
  const pub = await live.query(`SELECT count(*) FROM public.users u WHERE to_jsonb(u)->>'authentik_uid' LIKE 'uid-%'`);
  await live.end();
  assert.strictEqual(Number(pub.rows[0].count), 0, 'the live users table never got a fixture uid');
});
