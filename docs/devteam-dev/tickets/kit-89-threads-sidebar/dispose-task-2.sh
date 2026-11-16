#!/bin/sh
# kit-89: dispositions for task-2.
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
f=task-2.md
node $D dispose $T $f T2-1 "fixed: 5596b79, thBack drops a + draft first; thApply keeps a draft over the route's thread; test step added"
node $D dispose $T $f T2-2 "fixed: 5596b79, the card clamped left of the open panel; 960px test"
node $D dispose $T $f T2-3 "fixed: 5596b79, wording says the Threads panel"
