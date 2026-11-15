#!/bin/sh
# kit-89: dispositions for spec-5 and plan-4.
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
f=spec-5.md
node $D dispose $T $f S5-1 "fixed: §2.1 Redraws: a change of view draws at once and places the focus; only refreshes are held while focused"
node $D dispose $T $f S5-2 "fixed: §2.5 the store applies when the page head in force (under a link, the one beneath) has no keys; freshness read before kit-87 stamps"
node $D dispose $T $f S5-3 "fixed: §2.5 only the Threads part of the route re-runs when the first read lands"
node $D dispose $T $f S5-4 "fixed: §2.6 in-dock bottom 16px; hidden at 900px and below while the panel is open"
node $D dispose $T $f S5-5 "fixed: §2.1 #ask-threads shows with the list only"
f=plan-4.md
node $D dispose $T $f P4-1 "fixed: T1 Step 3 follows the two redraw kinds; T1 and T2 assert where the focus goes"
node $D dispose $T $f P4-2 "fixed: T2 Files lists dashboard.test.mjs, ~3338 moved to the in-panel card"
node $D dispose $T $f P4-3 "fixed: T3 re-runs only the Threads part; the held test checks the store unchanged"
