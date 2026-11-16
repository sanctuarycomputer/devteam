#!/bin/sh
# Done-when 3: break the Inbox order by drawing the dashboard's open questions reversed, run the
# next-step test file once, restore the dashboard, and write the diff and the results to
# evidence/mutation.txt. Run from the worktree root. Never commit the mutated file.
# Usage: sh docs/devteam-dev/tickets/kit-246-steady-inbox-order-test/evidence/mutate.sh [node]
set -eu
NODE="${1:-/usr/local/bin/node}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/mutation.txt"
F="docs/devteam/dashboard/index.html"
git diff --quiet -- "$F" || { echo "refusing: $F has uncommitted changes"; exit 2; }
OLD='d.questions.map((q) => questionCard(q, o, reasonText))'
[ "$(grep -cF "$OLD" "$F")" = 1 ] || { echo "the Inbox's draw line is not found once"; exit 2; }
trap 'git checkout -- "$F"' EXIT
sed -i 's/d\.questions\.map((q) => questionCard(q, o, reasonText))/[...d.questions].reverse().map((q) => questionCard(q, o, reasonText))/' "$F"
{
  echo "## mutation (reverted after the run)"
  git diff -U0 -- "$F" | grep '^[-+][^-+]' | cut -c1-160
  echo "## test"
  timeout 900 "$NODE" --test --test-concurrency=2 test/next-step.strategy.test.mjs 2>&1 | grep -E "^ *(not )?ok |error:|expected|actual|^ *- |^ *\+ |^# (pass|fail)" | sed -E 's/port [0-9]+/port N/g; s/127\.0\.0\.1:[0-9]+/127.0.0.1:N/g; s/q-[0-9]{8}-[0-9]{9}-[a-z0-9-]+/q-…/g' || true
} > "$OUT"
cat "$OUT"
