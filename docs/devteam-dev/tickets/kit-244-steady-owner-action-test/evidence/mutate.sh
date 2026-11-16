#!/bin/sh
# Done-when 3: let Done through while a record is unchanged (the dashboard's Done gate never holds),
# run the owner-action test once on Node 22, and restore the dashboard. Prints the mutation's diff and
# the test's failures. Run from the worktree root. Never commit the mutated file.
# Usage: sh docs/devteam-dev/tickets/kit-244-steady-owner-action-test/evidence/mutate.sh [node]
set -eu
NODE="${1:-/usr/local/bin/node}"
F="docs/devteam/dashboard/index.html"
git diff --quiet -- "$F" || { echo "refusing: $F has uncommitted changes"; exit 2; }
trap 'git checkout -- "$F"' EXIT
OLD='if (open.length) { NOT_DONE.set(id, open); oaPaint(); return; }'
NEW='if (false \&\& open.length) { NOT_DONE.set(id, open); oaPaint(); return; }'
[ "$(grep -cF "$OLD" "$F")" = 1 ] || { echo "the gate line is not found once"; exit 2; }
sed -i "s/if (open.length) { NOT_DONE.set(id, open); oaPaint(); return; }/$NEW/" "$F"
echo "## mutation"
git diff -U0 -- "$F" | grep '^[-+][^-+]'
echo "## test"
timeout 300 "$NODE" --test --test-concurrency=2 test/dashboard-owner-action.test.mjs 2>&1 | grep -E "^ *(not )?ok |error:|^# (pass|fail)" | sed -E 's/port [0-9]+/port N/g; s/[0-9]{5}-[0-9]{5}/A-B/g; s/127\.0\.0\.1:[0-9]+/127.0.0.1:N/g' || true
