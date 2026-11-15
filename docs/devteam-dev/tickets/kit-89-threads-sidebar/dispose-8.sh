#!/bin/sh
# kit-89: dispositions for spec-8 and plan-7.
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
f=spec-8.md
node $D dispose $T $f S8-1 "wont-fix here, Minor at the approving pass; settled in build T2/T3: a focus removed by any pane draw, Back from the composer included, goes to the current thread's row (§2.9's), else the selected tab; §2.1 read with §4's exception"
node $D dispose $T $f S8-2 "wont-fix here, Minor at the approving pass; settled in build T2: a + draft's head row shows 'New thread' as its title"
f=plan-7.md
node $D dispose $T $f P7-1 "wont-fix here, Minor at the approving pass; settled in build T2: Interfaces read as Step 3 (#tl-c-title and [data-tl-close] hidden, #tl-c-acts shown); Resolve pressed as two clicks ([data-tl-resolve-go])"
node $D dispose $T $f P7-2 "wont-fix here, Minor at the approving pass; settled in build T2: ~3509 opens X through the route; its check widened to '#tl img, #threads img'"
