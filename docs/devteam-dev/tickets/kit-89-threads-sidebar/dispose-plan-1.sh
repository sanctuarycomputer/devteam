#!/bin/sh
# kit-89: dispositions for plan-1.
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
f=plan-1.md
node $D dispose $T $f P1-1 "fixed: T1 subtest 'the counts as threads move' (blue, grey, none; tab with no number)"
node $D dispose $T $f P1-2 "fixed: T2 step 4 changes ~1881 to the dock's absence and #threads present; T4 adds #tt-peek"
node $D dispose $T $f P1-3 "fixed: both files ruled into touches (m-20261115-205924178); T1 updates dashboard-pages AC 1a, T4 dashboard-peek's moved lines; all four files run in every task"
node $D dispose $T $f P1-4 "fixed: T5 step 5 writes reviews/task-5.md"
node $D dispose $T $f P1-5 "fixed: T2 a floating row assigns one head (subject page with th and t); the test checks history.length +1 and Back"
node $D dispose $T $f P1-6 "fixed: T3 step 1 adds bad values, closing a floating card, Back after the arrow, a resolved t after reload, a floating t not stored"
node $D dispose $T $f P1-7 "fixed: T3 step 1 checks focus: Escape on the list and x return it to .tt, .tt focuses the selected tab"
node $D dispose $T $f P1-8 "fixed: T1 right edge moves 380; T4 no Inbox button in the viewer; T2 waits past a redraw and a poll"
node $D dispose $T $f P1-9 "fixed: T1 copies goalArgs' list"
node $D dispose $T $f P1-10 "fixed: T4 in /view/ thGo toggles threads-open on body itself"
node $D dispose $T $f P1-11 "fixed: Global Constraints name the one command for every run (timeout 900, --test-concurrency=2)"
node $D dispose $T $f P1-12 "fixed: TL;DR has a risk bullet"
