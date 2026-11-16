#!/bin/sh
# kit-84: dispositions for plan-2.
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-84-dashboard-data
R=plan-2.md
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
d() { node "$D" dispose "$T" "$R" "$1" "$2"; }
d P2-1 "fixed: handLine takes agoMs as F.hand does, fixes one at, breaks ties on at itself, and writes the line directly (id built from that at), so the line's at is the one asked for"
d P2-2 "fixed: the planner's question is withdrawn (answer refuses a goal-approval question)"
d P2-3 "fixed: t-e raises the finding while g2 runs, and not after the park"
d P2-4 "fixed: the test parses main's settings keys itself; set must equal membership, and only unset value keys must show their defaults"
d P2-5 "fixed: Step 2 checks git diff --stat lists only dashboard-data.txt before reading its diff"
