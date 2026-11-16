`merge` no longer re-runs a gate the forge's CI already ran green at the exact head, when the owner says it may. A gate in `settings.gates` (home's or a repo link's) can carry `"covered_by": "ci"` (every check the forge reports) or `"covered_by": ["<check name>", …]` (those checks). Before running such a gate, `merge` reads the PR again by number. If the head is still the sha it is landing and every one of those checks is complete and SUCCESS, it doesn't run the gate. It prints `gate <name> not run here: the forge's checks ran it green at <sha> (<checks>)`, writes no `gate` line, and names the gate and its checks in the merge act.

It runs the gate as today, and says why, when:
- a check is pending, failed, missing, skipped or neutral (under `"ci"`, every check counts, ignored ones included; for a list, every entry of each named check, so an old failed attempt beside a new green one is not covered);
- the head moved, or the PR can't be read again, or there is no PR;
- the PR changes anything under `.github/` (a `pull_request` workflow runs the PR's own workflow files, so it can't vouch for itself), or its changes can't be listed;
- the forge is `git` (no checks);
- `covered_by` has a shape it doesn't know (with a warning).

Without `covered_by`, every gate runs exactly as before. `covered_by` is the owner's gate field (gate-change): adding it to an existing gate needs the owner's answer, and a gate the supervisor adds alone can't carry it. `quality.md` §2 documents it; the lines in `quality.md` and `supervisor.md` that said merge runs every gate now name the exception.

The forge-check reading is one helper, `rollupState`, shared by merge's existing pending/failing check and the new `forgeCoverage`, so the two reads can't drift.

Doesn't defend against: a forge that reports green for a run it didn't do; under `"ci"`, a check that never reported (the list form catches that).

## How to verify

- `sh docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/run-tests.sh` runs this ticket's tests (`test/kit.test.mjs`, names holding `covered_by`), isolated, at `--test-concurrency=2`.
- `mutate-t1.sh` and `mutate-t2.sh` in the same folder show the tests catch the mutations the task reviews named (a list judging only the last entry of a name; the supervisor allowed to add or edit `covered_by`).
- Records: `docs/devteam-dev/tickets/kit-205-merge-reuses-green-ci/` (spec, plan, reviews, verification).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
