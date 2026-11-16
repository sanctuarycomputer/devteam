#!/bin/sh
# Run a race repro from the worktree root: repro-race.test.mjs.txt (main's order: the press lands where
# the note was before the answered cards left) or, with "fixed", repro-fixed.test.mjs.txt (the fixed
# test's order: settle, then measure). The file is copied into test/ so its ./lib imports resolve, run
# once, removed, and its REPRO lines and result are written to evidence/repro-<variant>.txt.
# Usage: sh docs/devteam-dev/tickets/kit-244-steady-owner-action-test/evidence/repro.sh [race|fixed] [node]
set -eu
VARIANT="${1:-race}"
NODE="${2:-/usr/local/bin/node}"
case "$VARIANT" in race|fixed) ;; *) echo "variant is race or fixed"; exit 2 ;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="test/zz-repro-kit244.test.mjs"
OUT="$HERE/repro-$VARIANT.txt"
cp "$HERE/repro-$VARIANT.test.mjs.txt" "$DEST"
trap 'rm -f "${DEST:?}"' EXIT
timeout 300 "$NODE" --test "$DEST" 2>&1 | grep -E "REPRO|error:|^# (pass|fail)" | sed -E 's/port [0-9]+/port N/g; s/[0-9]{5}-[0-9]{5}/A-B/g; s/127\.0\.0\.1:[0-9]+/127.0.0.1:N/g' > "$OUT" || true
cat "$OUT"
