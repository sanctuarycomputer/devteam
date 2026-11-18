# Final review, pass 2

- Reviewer: fresh opus subagent (claude-opus-5-5), cold confirm; not the author or the fixer, had not seen the build
- Reviewed: `git diff 69016e01..01230e93` (3 files, 126 insertions, 12 deletions), read and run in the detached tree `.worktrees/review-kit-90-01230e93-final1`; then the records-only head `bdab5149`, which adds only `verification.md` on top of 01230e93

## Pass-1 findings

- **F1 (Important), closed.** `closedGoalCardHtml` now writes `esc(cap(m.description || 'the measure'))`. The goals fixture gives g4 (met) the measure `<img src=x id=probe-xss>`, and the Chrome test checks that the Met card's `.goal-next` shows it as text and that no `#probe-xss` element exists. Mutation: with `esc` removed in place, "goals: tabs…" fails on `the measure description as text` (rc=1). Restored. I spot-checked the fixer's sweep of the 60 `${` lines added in `git diff ff262b5b..01230e93 -- docs/devteam/dashboard/index.html`. Every log-sourced value is passed through `esc`, `linkify`, `tlink`, `qlink`, `dlink`, `encodeURIComponent` or `fmtDay` (which escapes). The raw `${s.next}` values come from `goalState`/`goalStateOf`, and those escape each log field (notes, reason, titles, values) where they are built. What is left raw is internal: tones, keys, counts and labels written in the code.
- **F2 (Minor), closed.** A new `hello-pulse` marker block wraps `HELLO`/`helloLoad` and `ovMosaic`. There is one lazily made `Intl.DateTimeFormat` (`OV_DAY_FMT`). The mosaic is memoised on `${new Date().toDateString()}|${JSON.stringify(xs)}`. The cell labels depend only on today's local date and the cleaned activity, and the key holds both, so a day rollover or a changed activity misses the memo and redraws. The vm test checks both cases (Nov 17 → Nov 18; one changed count) and checks that the formatter is built only once. `helloLoad` redraws Overview only when `JSON.stringify(h)` changed. A changed answer (state working → waiting, or an answer → a failed ask) redraws, so the pill still updates. An unchanged answer skips only the hello-driven extra draw, and `render` still draws Overview on every poll.
- **F3 (Minor), closed.** "goals: tabs…" now injects a planner on g1's feature that is waiting at a prompt. It asserts g1's `#planner/pay` link "planner on Pay by card", the "stuck on a prompt" badge, and no planner link on g0/g2/g3/g6. g6 is created with `--registry-precondition 1`, and the test asserts "Registry attestation: precondition 1, not asked" on g6 only.
- **F4 (Minor), closed.** `helloLoad` takes `seq = ++HELLO_SEQ` and drops any answer whose seq is no longer current. The vm test lets a later ask answer before an earlier one and checks that the older answer neither overwrites `HELLO` nor redraws. Mutation: with the guard line removed in place, the helloLoad test fails (rc=1). Restored.
- **F5 (Suggestion), closed.** The settings area now scrolls Run into view with `scrollIntoView({ block: 'center' })` and no press, waits for `STEADY`, reads `at0`, presses Run, and asserts `place() === at0` ("pressing Run on a running fleet leaves the switch where it was"). Drain's check is unchanged.

## Other checks

- Frozen blocks: `devteam-layout` (sha1 b373f3c2…) and `devteam-shell-js` (sha1 be14ac71…) hash the same at 69016e01 and 01230e93. The diff touches only lines 3470 and 5780–5830 of index.html. "the shell blocks are untouched" in dashboard-shell passes.
- Runs, one file at a time, Node v22.23.4, throwaway HOME, TMUX and the listed `DEVTEAM_*` unset, `--test-concurrency=2`:
  - test/dashboard-overview-goals.test.mjs: rc=0, 12 pass, 0 fail, 0 skipped
  - test/dashboard-pages.test.mjs: rc=0, 6 pass, 0 fail, 0 skipped
  - test/dashboard-shell.test.mjs: rc=0, 16 pass, 0 fail, 0 skipped
- After the mutations I restored the tree with `git checkout --`; `git status` is clean.

## The head, bdab5149

- `git diff --stat 01230e93 bdab5149` shows only `docs/devteam-dev/tickets/kit-90-overview-goals/verification.md` (+18 −2). No code or test changed, so the runs above still hold at the head.
- I checked the verification.md edit against what I confirmed:
  - The commit for each fix matches `git log`: F1 b6e2b88f, F2 d342a49f, F3 f8d54531, F4 45da205b, F5 01230e93.
  - CI run 44188200962 is completed, conclusion success, attempt 1, headSha 01230e93bc47633e4b3e5b6482dae6533a657757 (`gh run view`).
  - The local counts for overview-goals 12, shell 16 and pages 6 match my runs.
  - The F1 and F4 claims that each test fails without its fix match my mutations.
  - I did not rerun F2's timing numbers or the other three files' counts. They are the fixer's own measurements and are labelled as such.

## Findings

| ID | Severity | Where | Finding | Disposition |
|---|---|---|---|---|

Verdict: APPROVE bdab51496f8897464f2338b21220b65ba24e0ac4
