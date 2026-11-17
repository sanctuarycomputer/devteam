#!/bin/sh
# Fill task-2 dispositions with devteam.mjs dispose, through a temporary link to the path it expects.
set -eu
K=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-240-relaunch-work-in-progress-first
cd "$(git rev-parse --show-toplevel)"
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$T" "docs/devteam/project/tickets/$T"
trap 'rm -f "docs/devteam/project/tickets/${T:?}"; rmdir docs/devteam/project/tickets docs/devteam/project 2>/dev/null || true' EXIT
d() { timeout 60 node "$K" dispose "$T" "$1" "$2" "$3"; }
d task-2.md T2-1 "fixed: the main checkout gets an untracked file in the order test; with the .git guard removed the test fails (mutation run)"
d task-2.md T2-2 "fixed: demo-66 (blocked, answered) and demo-67 (blocked then a later info) come back in tier 1; with the unanswered/last-message checks replaced the test fails (mutation run)"
d task-2.md T2-3 "fixed: demo-68 in phase blocked comes back last"
d task-2.md T2-4 "fixed: planner p9 with a thread on planner:plan-p9 comes back in tier 0"
