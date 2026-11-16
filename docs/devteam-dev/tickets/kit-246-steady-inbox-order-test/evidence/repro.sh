#!/bin/sh
# Run the kit-246 repro from the worktree root: race (main's order: Wrong? measured before the goal's
# record lands) or fixed (the fixed test's order: the record drawn, then measured). The repro is copied
# into test/ so its ./lib imports resolve, run once, removed, and its REPRO lines and result are
# written to evidence/repro-<variant>.txt.
# Usage: sh docs/devteam-dev/tickets/kit-246-steady-inbox-order-test/evidence/repro.sh [race|fixed] [node]
set -eu
VARIANT="${1:-race}"
NODE="${2:-/usr/local/bin/node}"
case "$VARIANT" in race|fixed) ;; *) echo "variant is race or fixed"; exit 2 ;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="test/zz-repro-kit246.test.mjs"
OUT="$HERE/repro-$VARIANT.txt"
cp "$HERE/repro.test.mjs.txt" "$DEST"
trap 'rm -f "${DEST:?}"' EXIT
trap 'exit 130' INT TERM HUP
REPRO_VARIANT="$VARIANT" timeout 900 "$NODE" --test "$DEST" 2>&1 | grep -E "REPRO|error:|^# (pass|fail)" | sed -E 's/port [0-9]+/port N/g; s/127\.0\.0\.1:[0-9]+/127.0.0.1:N/g' > "$OUT" || true
cat "$OUT"
