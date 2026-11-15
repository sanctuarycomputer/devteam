#!/bin/sh
# Fill spec-1's dispositions. Run from the worktree root.
set -eu
D=/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs
T=kit-205-merge-reuses-green-ci
R=docs/devteam-dev/tickets/$T/reviews/spec-1.md
node "$D" dispose "$T" "$R" F1-1 'fixed: under "ci" every entry must be SUCCESS (SKIPPED/NEUTRAL are not coverage); Out of scope names that "ci" cannot see a check that never reported; D2 test SUCCESS+SKIPPED (spec The change 4, D2, Out of scope)'
node "$D" dispose "$T" "$R" F1-2 'fixed: a PR that changes any file under .github/ between the merge base and the head covers nothing; merge says why and the gate runs; D2 test (spec The change 2, D2)'
node "$D" dispose "$T" "$R" F1-3 'fixed: spec Docs names quality.md L24, L121 and supervisor.md L127; asked as m-20261115-204658302'
node "$D" dispose "$T" "$R" F1-4 'fixed: D2 says pending/failed come from a green first read and a differing re-read; D1 names the vehicle (a real multiFixture sibling ticket merge with a fake gh)'
node "$D" dispose "$T" "$R" F1-5 'fixed: one shared helper classifies entries for both reads, rules spelled out (spec The change 4)'
node "$D" dispose "$T" "$R" F1-6 'fixed: re-read by PR number; truncation noted in Edge cases with the list form preferred'
node "$D" dispose "$T" "$R" F1-7 'fixed: Edge cases notes show release lists only gates that ran; the act names covered ones; view unchanged'
