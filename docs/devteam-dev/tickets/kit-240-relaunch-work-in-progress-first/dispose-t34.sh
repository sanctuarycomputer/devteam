#!/bin/sh
# Fill task-3/task-4 dispositions with devteam.mjs dispose, through a temporary link to the path it expects.
set -eu
K=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-240-relaunch-work-in-progress-first
cd "$(git rev-parse --show-toplevel)"
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$T" "docs/devteam/project/tickets/$T"
trap 'rm -f "docs/devteam/project/tickets/${T:?}"; rmdir docs/devteam/project/tickets docs/devteam/project 2>/dev/null || true' EXIT
d() { timeout 60 node "$K" dispose "$T" "$1" "$2" "$3"; }
d task-3.md T3-1 "fixed: the comment above RESTART_* says the per-relaunch budget and the 30 s / 100 s rule"
d task-3.md T3-2 "fixed: the worktree_setup test's second session is a planner, so hasWorktreeSetup's home branch runs"
d task-3.md T3-3 "fixed: hasWorktreeSetup is read only while tries < cap"
d task-4.md T4-1 "fixed: §11 says a restart earlier in the same tick counts toward the 3"
