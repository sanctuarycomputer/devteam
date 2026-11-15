#!/bin/sh
# Fill task-1 dispositions with devteam.mjs dispose, through a temporary link to the path it expects.
set -eu
K=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-215-sharded-test-yml
cd "$(git rev-parse --show-toplevel)"
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$T" "docs/devteam/project/tickets/$T"
trap 'rm -f "docs/devteam/project/tickets/${T:?}"; rmdir docs/devteam/project/tickets docs/devteam/project 2>/dev/null || true' EXIT
d() { timeout 60 node "$K" dispose "$T" "$1" "$2" "$3"; }
d task-1.md T1-1 "fixed: a comment above the kit job's name says why it is there"
d task-1.md T1-2 "wont-fix the harness is a local proof of the coverage step's script; CI's coverage step reads only the jobs' own lists, so a drift in the harness can't hide a gap in CI, and the final review checks its rows against the matrix"
