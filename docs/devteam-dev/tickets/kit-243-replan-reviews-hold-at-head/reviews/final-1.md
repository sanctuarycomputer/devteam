# Final review, pass 1

- Reviewer: final-reviewer (fresh subagent, claude-opus)
- Reviewed: 015d6c2e89ebc36fc5c87b0b56089371a3115689 (the whole branch)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec acceptance 6 ("--plan can't weaken anything") | devteam.mjs cmdValidate, `planFeature = typeof flags.plan === 'string' ? flags.plan : branchFeature` | On a `plan/<fid>` branch, an explicit `--plan` string replaces the branch name rather than adding to it: `validate --strict --plan nosuch` and `validate --strict --plan=` (empty string) on a stale re-plan branch both exit 0 (probed in a scratch copy of the test), where plain `validate --strict` exits 1. Not reachable through check-pr/merge (they pass the branch's own feature, and a detached head has no branch name), so the merge gate is not weakened; only a hand-run validate can be. Falling back on an empty string (`flags.plan \|\| branchFeature` for strings), or checking both names, would close it. |  |
| F2 | Minor | spec acceptance 6 | test/kit.test.mjs, new test | The test covers check-pr's `--plan` path but not the fallbacks spec 6 names (valueless `--plan`, a wrong name, another landed feature staying history); they were checked by hand in this review (below), not by a test. Suggestion. | wont-fix the reviewer's suggestion: the fallbacks were probed by hand in this review; the gate path (check-pr --plan) has its test, and the fallbacks change nothing the gate relies on |

Checked, no issue found:
- The new test passes at the head: `timeout 900 node --test --test-concurrency=2 --test-name-pattern='re-plan branch' test/kit.test.mjs`, exit 0, pass 1, fail 0.
- The test fails without the fix (scratch detached worktree at 015d6c2e, removed after): mutant m1 (`head` condition reverted to `!landed`) fails at the re-plan stale `validate --strict` assertion (kit.test.mjs:1278); mutant m2 (`'--plan', feature` removed from checkPr) fails at the re-plan stale check-pr assertion (kit.test.mjs:1280). Both exit 1.
- (b) valueless `--plan`: the parser makes it `true`; on the branch it falls back to the branch name (probe: status 1, both stale messages); `--plan cards x` (array) falls back the same way (status 1). Detached, valueless `--plan` and no `--plan` both behave as before the change (status 0), which is the old behaviour, not a regression; check-pr always passes a value.
- (a) wrong name: detached with `--plan cards` the re-plan is checked (status 1, both messages); a wrong name only moves which landed feature is head-checked (see F1 for the on-branch override).
- (c) ticket PRs: checkPr returns for `ticket/` branches before the plan block, so `--plan` never reaches them; chore PRs never run validate. No workflow or other caller runs `validate --strict` (grep of devteam.mjs, .github, docs).
- (d) stale reviews passing: on a re-plan, `verdictHolds(old, head)` lists the branch's own non-merge commits since the old review excluding main (`^main`), so any planner change (log, tickets, design) voids it; main's merge commits in between are only accepted when their other parents are on main and the branch's own diff is unchanged or each merge is git's clean merge. A review file added at an old ancestor sha still fails onlyRecords. A legitimate first plan, a re-plan with fresh reviews, and a re-plan with no change of its own pass; a plan branch that merged main in is judged by the unchanged verdictHolds rules, as a first plan's.
- A re-plan now needs fresh design and graph reviews whenever anything but records changed (same as a first plan, spec TL;DR "Same errors, same messages"); that is intended.
- TL;DR check: still `landed ? null : tldrGap(...)`, off for a landed design (spec, out of scope). Sink: unchanged (`onPlanBranch() && !flags.strict ? warnings : errors`); detached check-pr is strict, so errors.
- The id-block warning still uses only the branch name (`pf = branchFeature`), unchanged behaviour; detached it is skipped as before.
- Help text line updated for `--plan <feature>`; planning.md §174 and quality.md's `merge --plan` line remain accurate.
- Diff scope against origin/main: devteam.mjs (15 lines, cmdValidate and checkPr only), the test, and ticket records; the status/metrics hunks in the 9431d7da diff come from main's merge, not this ticket.
- CI: verification.md records run 43900399313 success at c84d351; 015d6c2 adds only verification.md.

Verdict: APPROVE 015d6c2e89ebc36fc5c87b0b56089371a3115689
