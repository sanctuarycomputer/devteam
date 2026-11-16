#!/bin/sh
# kit-84: dispositions for plan-3.
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-84-dashboard-data
R=plan-3.md
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
d P3-1 "fixed: at is floored to a whole millisecond before the tie check, and a tie adds 1 ms, so ids are unique and write order holds; dayAt(0) is whole milliseconds"
d P3-2 "fixed: the plan says the test copies threadsFixture's one-line stamp, which kit.mjs doesn't export"
