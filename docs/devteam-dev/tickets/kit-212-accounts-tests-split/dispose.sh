#!/usr/bin/env bash
# kit-212: fill review dispositions with devteam's dispose, through a link at the path it expects.
#   bash dispose.sh <record.md> <id> "<disposition>" [<id> "<disposition>"]...
set -euo pipefail
id=kit-212-accounts-tests-split
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
rec="$1"; shift
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$id" "docs/devteam/project/tickets/$id"
cleanup() { rm -f "docs/devteam/project/tickets/$id"; rmdir docs/devteam/project/tickets docs/devteam/project 2>/dev/null || true; }
trap cleanup EXIT
while [ $# -ge 2 ]; do node "$D" dispose "$id" "$rec" "$1" "$2"; shift 2; done
