#!/bin/sh
# Fill spec-1/plan-1 dispositions with devteam.mjs dispose, through a temporary link to the path it expects.
set -eu
K=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-240-relaunch-work-in-progress-first
cd "$(git rev-parse --show-toplevel)"
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$T" "docs/devteam/project/tickets/$T"
trap 'rm -f "docs/devteam/project/tickets/${T:?}"; rmdir docs/devteam/project/tickets docs/devteam/project 2>/dev/null || true' EXIT
d() { timeout 60 node "$K" dispose "$T" "$1" "$2" "$3"; }
d spec-1.md F1 "fixed: a later relaunch cut short by the tick's own timeout gives its claim back (releaseRestart) and is tried first next tick; supervisor.md's 100 s sentence reworded (plan T3, T4)"
d spec-1.md F2 "fixed: the dirty check is its own spawnSync with a 10 s timeout"
d spec-1.md F3 "fixed: previews dropped from the tier rule"
d plan-1.md P1 "fixed: the key guard and crash tests run their multi-session ticks with memory full"
d plan-1.md P2 "fixed: five sessions, one not due second; tick 1 relaunches exactly 3, tick 2 the fourth"
d plan-1.md P3 "fixed: message and thread lines appended inline with m-/t- ids to the right files; the question through ask"
d plan-1.md P4 "fixed: a planner:<feature> thread case, and a required case where withdrawn/resolved planners fall to tier 1"
d plan-1.md P5 "fixed: T4 rewords the 100 s sentence"
d plan-1.md P6 "wont-fix: the limit-restart tests live in test/accounts.*, outside touches; one predicate, exercised by the relaunch test (plan T1)"
d plan-1.md P7 "fixed: spawnSync with timeout 10000"
d plan-1.md P8 "fixed: T5 runs recovery.restart and accounts.* once each at concurrency 2"
