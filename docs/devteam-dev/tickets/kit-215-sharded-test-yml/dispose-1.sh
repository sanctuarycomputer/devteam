#!/bin/sh
# Fill spec-1/plan-1 dispositions with devteam.mjs dispose, through a temporary link to the path it expects.
set -eu
K=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-215-sharded-test-yml
cd "$(git rev-parse --show-toplevel)"
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$T" "docs/devteam/project/tickets/$T"
trap 'rm -f "docs/devteam/project/tickets/${T:?}"; rmdir docs/devteam/project/tickets docs/devteam/project 2>/dev/null || true' EXIT
d() { timeout 60 node "$K" dispose "$T" "$1" "$2" "$3"; }
d spec-1.md S1-1 "fixed: acceptance 5 runs the coverage step's own script, extracted from test.yml, on real lists and on a duplicate, a missing file and a missing major (coverage-step.sh)"
d spec-1.md S1-2 "fixed: the ps step runs on failure() or cancelled()"
d spec-1.md S1-3 "fixed: retention-days 7 and overwrite: true"
d spec-1.md S1-4 "fixed: the tests job section says why always(), not !cancelled()"
d plan-1.md P1-1 "fixed: Task 2 step 3 fixes the order (push, supersede with the failing commit, let it finish, revert); no empty commit"
d plan-1.md P1-2 "fixed: Task 1 step 1 is coverage-step.sh, the extracted step on four cases"
d plan-1.md P1-3 "fixed: checkout, download and coverage each if: always(); lists/list-<node>-<key>/list.txt named"
d plan-1.md P1-4 "fixed: shellcheck SC2086 disabled on the two run lines; actionlint by its install path"
d plan-1.md P1-5 "fixed: the group keys a PR run on its number"
d plan-1.md P1-6 "fixed: S1-2 and S1-3 carried into Task 1 step 2"
