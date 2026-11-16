#!/bin/sh
# Run the race repro (repro-race.test.mjs.txt) from the worktree root: it is copied into test/ so its
# ./lib imports resolve, run once on Node 22, and removed. Prints its REPRO lines and the result.
# Usage: sh docs/devteam-dev/tickets/kit-244-steady-owner-action-test/evidence/repro.sh [node]
set -eu
NODE="${1:-/usr/local/bin/node}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="test/zz-repro-kit244.test.mjs"
cp "$HERE/repro-race.test.mjs.txt" "$DEST"
trap 'rm -f "${DEST:?}"' EXIT
timeout 300 "$NODE" --test "$DEST" 2>&1 | grep -E "REPRO|error:|^# (pass|fail)" || true
