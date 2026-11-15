#!/bin/sh
# kit-205: fill one disposition. usage: dispose.sh <record.md> <F-id> "<disposition>"
# dispose reads docs/devteam/project/tickets/<id>/reviews: a temporary link there, removed after.
set -eu
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-205-merge-reuses-green-ci
cd "$(git rev-parse --show-toplevel)"
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
node "$D" dispose "$T" "$1" "$2" "$3"
