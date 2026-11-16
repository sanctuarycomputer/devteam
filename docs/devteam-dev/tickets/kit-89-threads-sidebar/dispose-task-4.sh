#!/bin/sh
# kit-89: dispositions for task-4.
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
f=task-4.md
node $D dispose $T $f T4-1 "wont-fix in T4, Minor: T5 adds the red count to the /view/ button's aria-label"
node $D dispose $T $f T4-2 "wont-fix: counts via .tt and kit-88's copier meet §2.8's outcome (one writer); said in verification.md"
node $D dispose $T $f T4-3 "wont-fix in T4, Minor: T5 runs the 720x800 overlay check with the viewer up"
node $D dispose $T $f T4-4 "wont-fix: same exposure as T3-3, same page only; noted in verification.md"
