#!/bin/bash
# dispose.sh <record.md> <id>=<disposition>...: fill review dispositions through a temporary link at the path dispose expects
set -euo pipefail
cd /data/home/code/devteam-dev/.worktrees/kit-214-steady-chrome-tests
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
ID=kit-214-steady-chrome-tests
L=docs/devteam/project/tickets
undo() { rm -f "$L/$ID"; rmdir "$L" 2>/dev/null || true; rmdir docs/devteam/project 2>/dev/null || true; }
trap undo EXIT
mkdir -p "$L"
ln -s "$PWD/docs/devteam-dev/tickets/$ID" "$L/$ID"
rec="$1"; shift
for kv in "$@"; do node "$D" dispose "$ID" "$rec" "${kv%%=*}" "${kv#*=}"; done
