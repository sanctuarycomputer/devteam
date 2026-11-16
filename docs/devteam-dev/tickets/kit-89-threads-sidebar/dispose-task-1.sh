#!/bin/sh
# kit-89: dispositions for task-1.
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-89-threads-sidebar
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
f=task-1.md
node $D dispose $T $f T1-1 "wont-fix in T1, Minor: T2's implementer makes the check __threadsQueue.length > 0 (ledger)"
node $D dispose $T $f T1-2 "wont-fix: the approved plan's T5 names both dev-links lines (~559, ~560); T2 rewords the step message"
node $D dispose $T $f T1-3 "wont-fix in T1, Minor: T4 restores the real path through #tt-peek, as its plan step says"
node $D dispose $T $f T1-4 "wont-fix in T1, Minor: T2 adds console.error beside the panel's error line"
node $D dispose $T $f T1-5 "wont-fix in T1, Minor: panel Escape is T2's (spec §2.9), in its plan step"
node $D dispose $T $f T1-6 "wont-fix in T1, Minor: T2 counts questions only in the label, or says 'waiting on you'"
