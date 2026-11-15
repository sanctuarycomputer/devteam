#!/bin/sh
# kit-86: dispositions for spec-1 and plan-1.
set -e
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
K=kit-86-default-ten-workers
cd "$(git rev-parse --show-toplevel)"
# dispose reads docs/devteam/project/tickets/<id>/reviews: a temporary link there, removed after
L=docs/devteam/project/tickets/$K
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
ln -s "$PWD/docs/devteam-dev/tickets/$K" "$L"
node "$D" dispose $K spec-1.md F1-1 "fixed: test/kit.test.mjs added to touches (m-20261115-200152909), spec item 7"
node "$D" dispose $K spec-1.md F1-2 "fixed: spec rewritten to consume kit-85's capOf and words; kit-86 adds only default, missing/invalid, status/hello, index line, goldens, docs"
node "$D" dispose $K spec-1.md F1-3 "fixed: check 4 now bans raw comparison/arithmetic beside the key (not all reads) plus output has no /null or /undefined"
node "$D" dispose $K spec-1.md F1-4 "fixed: every metrics read on a fake cgroup under the ceiling"
node "$D" dispose $K spec-1.md F1-5 "fixed: reads settings JSON for key present and null"
node "$D" dispose $K spec-1.md F1-6 "fixed: an invalid value counts as 0 (never wider) and fails validate"
node "$D" dispose $K spec-1.md F1-7 "fixed: all three phrases in checks 5 and 6"
node "$D" dispose $K spec-1.md F1-8 "fixed: 3 ready tickets, suggestion names all"
node "$D" dispose $K spec-1.md F1-9 "fixed: check 3 states limit 9 (memory-full) and limit 3 (neither)"
node "$D" dispose $K plan-1.md P1-1 "fixed: T4 has kit.test.mjs:827 and :853"
node "$D" dispose $K plan-1.md P1-2 "fixed: fake cgroup on every metrics, worker and planner call"
node "$D" dispose $K plan-1.md P1-3 "fixed: T1 greps the whole kit and tests, records kit-85 as landed, design-change plus phase blocked for files outside touches"
node "$D" dispose $K plan-1.md P1-4 "fixed: Case A reads settings JSON"
node "$D" dispose $K plan-1.md P1-5 "fixed: forecast text and memory-full arithmetic are kit-85's capOf now; Case F bans raw arithmetic"
node "$D" dispose $K plan-1.md P1-6 "fixed: settings set max_active_tickets none in T5 and spec check 6/7"
node "$D" dispose $K plan-1.md P1-7 "fixed: Case E asserts planner refusal and metrics for limits none, 9 and 3"
node "$D" dispose $K plan-1.md P1-8 "fixed: T5 covers supervisor.md:118, planning.md:45, the goalForecast comment"
