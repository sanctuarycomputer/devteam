#!/bin/sh
# kit-213: dispositions for spec-1 and plan-1.
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-213-steady-timing-bounds
cd "$(git rev-parse --show-toplevel)"
# dispose reads docs/devteam/project/tickets/<id>/reviews: a temporary link there, removed after
L=docs/devteam/project/tickets/$T
made_project=0; made_tickets=0
[ -d docs/devteam/project ] || made_project=1
[ -d docs/devteam/project/tickets ] || made_tickets=1
cleanup() {
  [ -L "$L" ] && rm "$L"
  [ "$made_tickets" = 1 ] && rmdir docs/devteam/project/tickets 2>/dev/null
  [ "$made_project" = 1 ] && rmdir docs/devteam/project 2>/dev/null
  return 0
}
trap cleanup EXIT
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$T" "$L"
node "$D" dispose $T spec-1.md F1-1 "fixed: the count is asserted after the first coverage() and again at the test's end, after six more coverage() runs and 900 ownersOf asks; the 10x patch turns off globCache and matcherCache both (spec B1 row, edge case)"
node "$D" dispose $T spec-1.md F1-2 "fixed: new B2b, a ratio of 20 rounds of the 5,000 suggest() lookups to the same walk up a plain Map built in the test (< 4), answers asserted equal first; patch b2b"
node "$D" dispose $T spec-1.md F1-3 "fixed: fixture grows to 2,000 questions (normal 2.35-2.63, the command's read-and-rank 10x gives 8.3; bound 4.5); margins restated with real figures per bound; the bound is on the Inbox read, not inboxRanks alone (a few percent of it), stated in the edge case and put to the supervisor"
node "$D" dispose $T spec-1.md F1-4 "fixed: check 5 also requires no process with the dashboard's pid as pgid and no watcher naming it"
node "$D" dispose $T spec-1.md F1-5 "fixed: a second patch makes the first step throw; the stop and the removal are shown to still run"
node "$D" dispose $T spec-1.md F1-6 "fixed: edge case 'What B5 rests on' states both"
node "$D" dispose $T plan-1.md P1-1 "fixed: b1-count turns off both caches and the count spans every call in the test"
node "$D" dispose $T plan-1.md P1-2 "fixed: B2b ratio and patch b2b"
node "$D" dispose $T plan-1.md P1-3 "fixed: Task 4 re-measures a loosened bound's 10x ratio on CI (a throwaway branch with the patch); B3's room is now 1.7x above and 1.85x below"
node "$D" dispose $T plan-1.md P1-4 "fixed: the path is typing, the pids held"
node "$D" dispose $T plan-1.md P1-5 "fixed: hooks-first patch and check-hooks.sh's group and watcher checks"
node "$D" dispose $T plan-1.md P1-6 "fixed: each test takes (t)"
