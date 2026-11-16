#!/bin/sh
# Fill spec-2/plan-2 dispositions with devteam.mjs dispose, through a temporary link to the path it expects.
set -eu
K=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-215-sharded-test-yml
cd "$(git rev-parse --show-toplevel)"
mkdir -p docs/devteam/project/tickets
ln -s "$PWD/docs/devteam-dev/tickets/$T" "docs/devteam/project/tickets/$T"
trap 'rm -f "docs/devteam/project/tickets/${T:?}"; rmdir docs/devteam/project/tickets docs/devteam/project 2>/dev/null || true' EXIT
d() { timeout 60 node "$K" dispose "$T" "$1" "$2" "$3"; }
d spec-2.md S2-1 "wont-fix in the approved text (an edit voids the verdict); the build does it: no comment in test.yml names the flag, so the grep counts only real use (Task 1)"
d plan-2.md P2-1 "wont-fix in the approved text (an edit voids the verdict); the build does it: the shellcheck disable goes inside each multi-line run script that uses RUN_ARGS (list step too), and the coverage step uses printf over test/*.test.mjs, not ls; actionlint must exit 0 (Task 1 step 3)"
d plan-2.md P2-2 "wont-fix in the approved text (an edit voids the verdict); the build does it: comments say the runner's file watchdog is the hang guard without naming the node flag"
d plan-2.md P2-3 "wont-fix in the approved text (an edit voids the verdict); the build does it: Task 2 step 1 pushes and does not wait; ci-green is read at the revert head after step 3"
d plan-2.md P2-4 "wont-fix no change needed: a superseded run's tests job counts as shown when it is failure or cancelled, never skipped"
d plan-2.md P2-5 "wont-fix the TL;DR stays where it is in this approved plan; later plans put it right under the title"
