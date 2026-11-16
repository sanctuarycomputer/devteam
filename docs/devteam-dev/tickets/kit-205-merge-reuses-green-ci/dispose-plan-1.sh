#!/bin/sh
# Fill plan-1's and spec-2's dispositions through dispose.sh.
set -eu
S="$(dirname "$0")/dispose.sh"
sh "$S" plan-1.md P1-1 'fixed: the row reads green first, then [run(test), failed(test)] (T1 test 3)'
sh "$S" plan-1.md P1-2 'fixed: the chain-step run is dropped (Global constraints says CI is its only evidence); new T1 test 12 pins the first-read refusal (failing, pending) on the box'
sh "$S" plan-1.md P1-3 'fixed: review focus 1 corrected (lowercase is uppercased, green); rows added to test 3 for conclusion null, no status (both pending) and lowercase success (covered); empty state reads PENDING in rollupState'
sh "$S" plan-1.md P1-4 'fixed: the coverage decision runs git diff -z --name-only --no-renames itself; null base or null diff gives "cannot tell what the PR changes" (T1 Step 3)'
sh "$S" plan-1.md P1-5 'fixed: TL;DR names forgeCoverage(coveredBy, rollup, ignored) and the docs clauses; supervisor.md in scope per m-20261115-204936899'
sh "$S" plan-1.md P1-6 'fixed: gh(views) resets counter, log and marker; rows call setGate (F.lines, committed and pushed); gate lines counted before and after; log assertions by regex'
sh "$S" plan-1.md P1-7 'fixed: both branches lowercase the state in the why'
sh "$S" plan-1.md P1-8 'fixed: the shape check runs first, whatever fresh is; test 9 covers it with forge git too'
sh "$S" plan-1.md P1-9 'fixed: test 2 is a real merge asserting the act names (test); tests 4-7 assert gateLines() +1'
sh "$S" plan-1.md P1-10 'fixed: review focus 4 says chores never reach the gate block (unchanged), no test claimed'
sh "$S" plan-1.md P1-11 'fixed: no pr.number gives "no PR to read"'
sh "$S" spec-2.md F2-1 'fixed in the plan (the spec stays as approved): a null merge base or a failed diff covers nothing, "cannot tell what the PR changes" (plan T1 Step 3)'
sh "$S" spec-2.md F2-2 'wont-fix: layout only; editing spec.md after this APPROVE would void it for no change in meaning'
