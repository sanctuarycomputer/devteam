#!/bin/sh
# Fill spec-2/plan-2 dispositions with devteam.mjs dispose, through a temporary link to the path it expects.
set -eu
K=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-240-relaunch-work-in-progress-first
cd "$(git rev-parse --show-toplevel)"
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$T" "docs/devteam/project/tickets/$T"
trap 'rm -f "docs/devteam/project/tickets/${T:?}"; rmdir docs/devteam/project/tickets docs/devteam/project 2>/dev/null || true' EXIT
d() { timeout 60 node "$K" dispose "$T" "$1" "$2" "$3"; }
d spec-2.md F2-1 "fixed: no claim is given back any more; a later relaunch starts only with the full 100 s when its repo has a worktree_setup, so the record and caps are as today"
d spec-2.md F2-2 "fixed: with nothing released, a killed setup keeps today's 10-minute wait before any retry"
d spec-2.md F2-3 "fixed: the release design and its restartPane claim are gone from the spec"
d plan-2.md F2-1 "fixed: the cut-short test is gone; the worktree_setup test asserts exactly one relaunch a tick and no claim for the others"
d plan-2.md F2-2 "fixed: T3 and T4 follow the new rule"
d plan-2.md F2-3 "fixed: no DEVTEAM_RESTART_TICK_MS knob, so SWITCH_LATEST_MS is untouched"
