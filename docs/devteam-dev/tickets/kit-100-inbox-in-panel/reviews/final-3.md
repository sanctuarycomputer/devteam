# Final review: kit-100 inbox in panel (pass 3)

- Reviewer: kit-100 final reviewer (fresh subagent of the supervisor, not the author; model claude-opus-5-5)
- Reviewed: 08a7c9acc109563971d27b2440360931eabfc4ed

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

No Critical, Important or Minor findings at this head. F5 (final-1) and F2-3 (final-2) stay as already disposed: acceptable, not blocking.

## What I checked

**Scope since final-2 (ab2fa28).**
- `6466a5b` merges origin/main (d9253c2: kit-274, v0.64.2 prep). origin/main is an ancestor of the head, so the branch is up to date.
- `91f3a6a` is F2-1's fix: `index.html` (+`TH.front`, set by `inboxGo` and consumed by `thShow`) and one new subtest. `08a7c9a` changes records only (verification.md, and the disposition cell in the kit copy of final-2.md).
- The PR's own changes against main are still `index.html`, `test/lib/kit.mjs`, `test/browser/dev-links.mjs`, 11 test files (one of them new, under `test/`) and the ticket's records. All are in touches, with no new file outside `test/`.
- The PR body still has `## One-way doors` / None. The worktree is clean.

**F2-1 verified.**
- My 720 probe on `#goals?th=inbox`: Answered list, then the defaulted question's `#q/` link. The peek opens on top (`th-under-peek`).
- "How it changes" then clears the mark. The panel is on top at the drawer's centre and at the tab bar, and the focus is on the defaulted card's Overrule box, which can now be seen.
- At 1440 the panel stays beside the peek, as before.
- Mutations on the new subtest "an Inbox road from a peek over the panel, at 900px and below":
  - removing the `thShow` clear line: fails;
  - removing `TH.front = true` in `inboxGo`: fails.

  Both time out at "How it changes: the panel on Inbox on top, the focused Overrule box seen".
- A stale `TH.front` was my concern. Probe at 720: an `inboxGo()` while already on the Inbox tab leaves `TH.front` false. A later peek from the Inbox tab still opens on top of the panel, and is still on top 11 s later across a redraw and a threads poll.

**The main merge broke nothing in kit-100's tests.** I ran every test file the PR modifies on the box, each command under 170 s, under the shared lock, sliced by name and skip patterns where a file runs longer. The box's load average reached 61 during the run; three commands hit their timeout and were rerun in smaller slices. No orphans were left.
- `dashboard-inbox-panel`: all 9 subtests and the 2 vm tests pass, run as 1–5 and then 6–9.
- `dashboard.test.mjs`: the four tests the PR changes pass. "presses", "a typed answer…" and "typing in the dashboard" ran together. "threads on the dashboard page" was covered in slices that each pass every subtest they run: all 33 subtests passed across the slices, each run with the earlier subtests it needs for setup. Earlier slices that left out a needed setup subtest failed only on that missing state (`window.__keys` and the thread question), and the right slice then passed.
- `dashboard-peek`: 'the frame' 16; 'the peeks' 4 + 1 + 2 + 1; 'rows and cards', the dbTable test and the label test, 12. All pass.
- `dashboard-threads-sidebar`: all 8 tests pass.
- `dashboard-measure`: all 4 tests pass, including the Inbox at three sizes.
- `dashboard-shell` 16, `dashboard-pages` (all 6 tests), `dashboard-answers` and `dashboard-owner-action`, `next-step.strategy` (all 6), and `pane-question.answer` (all 12): all pass.
- The touches that the PR doesn't modify (gateway, multirepo-views, ooda-*, plain-questions, fleet-park, multirepo-landing, `test/lib/chain.mjs`) were not run. `test/browser/dev-links.mjs` is a hand-run script.

**CI.** `gh pr checks 321` at 08a7c9a shows 17/17 pass (run 44059750704). The PR is MERGEABLE, CLEAN.

**Carried from final-1 and final-2, still holding.**
- §2.9 Esc mirrors kit-241's `paneEscCancels` with its four hint fixtures.
- 0cfa580: a viewer over a review is on top with its × reachable.
- page-top at 1440 only, as verification.md states.
- The four-tab overflow is acceptable to ship (o-20261117-053019024).

Verdict: APPROVE 08a7c9acc109563971d27b2440360931eabfc4ed
