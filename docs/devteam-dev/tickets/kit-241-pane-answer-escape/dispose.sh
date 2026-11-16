#!/bin/sh
# usage: dispose.sh <record.md> <F-id> <disposition> [<F-id> <disposition> ...]
set -e
T=kit-241-pane-answer-escape
W=/data/home/code/devteam-dev/.worktrees/$T
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
cd "$W"
[ -e docs/devteam/project ] && { echo "docs/devteam/project exists; not linking" >&2; exit 1; }
cleanup() { rm -f "docs/devteam/project/tickets/$T"; rmdir docs/devteam/project/tickets docs/devteam/project 2>/dev/null || true; }
trap cleanup EXIT
mkdir -p docs/devteam/project/tickets
ln -s "$W/docs/devteam-dev/tickets/$T" "docs/devteam/project/tickets/$T"
rec="$1"; shift
while [ $# -ge 2 ]; do node "$D" dispose "$T" "$rec" "$1" "$2"; shift 2; done
