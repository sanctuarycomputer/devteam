#!/usr/bin/env bash
# Fills the Disposition cells of task-1 with devteam dispose, through a
# temporary link at the path dispose expects (docs/devteam/project/tickets/<id>), removed after.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-216-daily-stress-run
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
for id in T1-1 T1-2 T1-3 T1-4 T1-6; do node "$D" dispose "$T" task-1.md "$id" fixed; done
node "$D" dispose "$T" task-1.md T1-5 "wont-fix: ruling m-20261115-171703191 forbids rm -rf of a path from a command substitution, which a mktemp -d result is; mkdir -m 700 of a pid-named path fails closed if the path exists"
