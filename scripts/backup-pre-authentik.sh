#!/usr/bin/env bash
# HIVE-1526: off-box dump of Podda's database before the Authentik user link
# (scripts/migrate-authentik-users.cjs). Run it right before the link, as eve.
#
#  1. pg_dump -Fc of the podda database. The PG* settings are read from Podda's .env inside this
#     script (the box's secret guard refuses `source .env` on a command line).
#  2. drive-archive.sh uploads it to Drive Backups/ClawOS/Podda and proves an md5 round trip.
#  3. The Drive copy is downloaded once more and opened with pg_restore --list: it must list the
#     data of every user-keyed table. Bytes that moved are not yet a restorable dump.
#  4. Every local copy is deleted on exit (/tmp is RAM). The Drive copy stays until Phase 6
#     acceptance (HIVE-1529) deletes it.
#
# Restore (Daniel or eve, into a scratch database first):
#   gog drive download <id> --out x.dump && pg_restore --list x.dump && pg_restore -d <db> x.dump
set -euo pipefail
ENV_FILE=${PODDA_ENV:-/opt/apps/podda/.env}
ARCHIVE=/home/eve/workspaces/shared/scripts/drive-archive/drive-archive.sh
DEST=ClawOS/Podda
TABLES="users subscriptions listen_progress queue playlists playlist_episodes scroll_positions channel_settings client_devices feedback announcement_dismissals"

while IFS='=' read -r k v; do
  case "$k" in PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE) v=${v%\"}; v=${v#\"}; export "$k=$v" ;; esac
done < "$ENV_FILE"
[ -n "${PGDATABASE:-}" ] || { echo "backup: no PGDATABASE in $ENV_FILE" >&2; exit 2; }

TMP=$(mktemp -d /tmp/podda-pre-authentik.XXXXXX)
trap 'rm -rf "$TMP"' EXIT
DUMP="$TMP/podda-pre-authentik-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg_dump -Fc -f "$DUMP"
check() {  # <dump> <label>: every user-keyed table's data is in it
  local list; list=$(pg_restore --list "$1")
  for t in $TABLES; do
    grep -q " TABLE DATA public $t " <<<"$list" || { echo "backup: $2 has no data for $t" >&2; exit 4; }
  done
  echo "$2: pg_restore --list shows data for all $(wc -w <<<"$TABLES") user tables"
}
check "$DUMP" "local dump"

OUT=$("$ARCHIVE" "$DUMP" --dest "$DEST" --apply)
echo "$OUT"
FID=$(sed -n 's/^drive id *: *//p' <<<"$OUT")
[ -n "$FID" ] || { echo "backup: drive-archive gave no file id" >&2; exit 5; }

# the same gog setup drive-archive.sh uses
export PATH="/home/linuxbrew/.linuxbrew/bin:$PATH" XDG_CONFIG_HOME=/home/eve/.config
GOG_KEYRING_PASSWORD="$(cat /home/eve/.config/gogcli/.keyring-password 2>/dev/null || true)"
export GOG_KEYRING_PASSWORD
gog -a "${GOG_ACCOUNT:-daniel.tollefsen@gmail.com}" drive download "$FID" --out "$TMP/readback.dump" >/dev/null 2>&1
check "$TMP/readback.dump" "Drive copy"
echo "BACKUP OK: Backups/$DEST/$(basename "$DUMP") (drive id $FID); local copies removed"
