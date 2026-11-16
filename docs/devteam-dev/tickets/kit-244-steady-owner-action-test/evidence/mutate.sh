#!/bin/sh
# Done-when 3: let Done through on Q3 ('Please look at one rule') while its record is unchanged, by
# skipping the dashboard's Done gate for that question only (the earlier subtests still hold Q's Done,
# so the target subtest is the first to meet the mutation), run the owner-action test once on Node 22,
# restore the dashboard, and write the diff and the test's results to evidence/mutation.txt.
# Run from the worktree root. Never commit the mutated file.
# Usage: sh docs/devteam-dev/tickets/kit-244-steady-owner-action-test/evidence/mutate.sh [node]
set -eu
NODE="${1:-/usr/local/bin/node}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/mutation.txt"
F="docs/devteam/dashboard/index.html"
git diff --quiet -- "$F" || { echo "refusing: $F has uncommitted changes"; exit 2; }
trap 'git checkout -- "$F"' EXIT
OLD='if (open.length) { NOT_DONE.set(id, open); oaPaint(); return; }'
[ "$(grep -cF "$OLD" "$F")" = 1 ] || { echo "the gate line is not found once"; exit 2; }
sed -i "s/if (open.length) { NOT_DONE.set(id, open); oaPaint(); return; }/if (open.length \&\& !\/look at one rule\/.test(qv.question)) { NOT_DONE.set(id, open); oaPaint(); return; }/" "$F"
{
  echo "## mutation (reverted after the run)"
  git diff -U0 -- "$F" | grep '^[-+][^-+]'
  echo "## test"
  timeout 300 "$NODE" --test --test-concurrency=2 test/dashboard-owner-action.test.mjs 2>&1 | grep -E "^ *(not )?ok |error:|^# (pass|fail)" | sed -E 's/port [0-9]+/port N/g; s/[0-9]{5}-[0-9]{5}/A-B/g; s/127\.0\.0\.1:[0-9]+/127.0.0.1:N/g' || true
} > "$OUT"
cat "$OUT"
