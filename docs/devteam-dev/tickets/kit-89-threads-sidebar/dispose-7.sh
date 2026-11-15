#!/bin/sh
# kit-89: dispositions for spec-7 and plan-6.
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
f=spec-7.md
node $D dispose $T $f S7-1 "fixed: §2.4 only #tl-c-title and [data-tl-close] hidden in the panel; #tl-c-acts (Resolve, Reopen) shown"
node $D dispose $T $f S7-2 "fixed: §4 words typed after Send carry from pending-N to the real id"
node $D dispose $T $f S7-3 "fixed: §4 a focus removed by a pane draw goes to the current row, else the selected tab"
node $D dispose $T $f S7-4 "fixed: §4 at 900px and below Pin closes the panel first"
f=plan-6.md
node $D dispose $T $f P6-1 "fixed: T2 presses Resolve in the panel; T3 clicks Reopen"
node $D dispose $T $f P6-2 "fixed: T2 Step 3 carries the pending-N words"
node $D dispose $T $f P6-3 "fixed: ~3509 added to the [data-tl-back] migration"
node $D dispose $T $f P6-4 "fixed: T2 checks the focus on G's row after its click"
