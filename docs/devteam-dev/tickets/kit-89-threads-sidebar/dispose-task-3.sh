#!/bin/sh
# kit-89: dispositions for task-3.
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
f=task-3.md
node $D dispose $T $f T3-1 "fixed: 28e1734, pins open in place again (spec §2.4); kit-87's three pin assertions as at 3983aba"
node $D dispose $T $f T3-2 "fixed: 28e1734, the store applied right after the stamp, before a talk/ route; test added"
node $D dispose $T $f T3-3 "fixed: 28e1734, TH_CARRY cleared on a non-routing hashchange and a popstate on the peek's hash"
