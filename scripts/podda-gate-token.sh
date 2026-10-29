#!/usr/bin/env bash
# HIVE-1526: create Podda's gate token once: the shared secret Caddy sends as X-Podda-Gate
# (hub .env PODDA_GATE_TOKEN, HIVE-1527) and server/auth.cjs reads at boot. Never prints it.
#
#   scripts/podda-gate-token.sh            create if missing (an existing token is kept)
#   scripts/podda-gate-token.sh --rotate   replace it; then `systemctl --user restart podda`
#                                          and give Daniel the hub .env step again
set -euo pipefail
F=${PODDA_GATE_TOKEN_FILE:-/home/eve/.config/podda/gate.token}
umask 077
mkdir -p "$(dirname "$F")"
if [ -s "$F" ] && [ "${1:-}" != "--rotate" ]; then
  echo "kept: $F ($(stat -c '%a %U' "$F"), $(wc -c <"$F") bytes)"
  exit 0
fi
openssl rand -hex 32 > "$F.new"
mv "$F.new" "$F"
echo "wrote: $F ($(stat -c '%a %U' "$F"), $(wc -c <"$F") bytes)"
