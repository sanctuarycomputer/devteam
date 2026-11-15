#!/usr/bin/env bash
# Fills the Disposition cells of spec-1 and plan-1 (pass-1 reviews) with devteam dispose, through a
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
for id in F1-1 F1-2 F1-3 F1-4 F1-5 F1-6; do node "$D" dispose "$T" spec-1.md "$id" fixed; done
for id in P1-1 P1-2 P1-3 P1-4 P1-5 P1-6; do node "$D" dispose "$T" plan-1.md "$id" fixed; done
