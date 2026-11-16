# Task review: Task 2 "Properties first, How it changes, History last", pass 2

- Reviewer: task-2-reviewer-2 (fresh subagent, claude-sonnet-5-5)
- Scope: fix round 3cd3dd4c..166b45e2 (b2c183bd only adds the pass-1 record)

I read the fix diff and the report addenda and ran no tests. No hunk is inside the `devteam-layout` (index.html:46-206) or `devteam-shell-js` (1077-1349) blocks; every index.html hunk is at line 3380 or later.

## Verdicts on the findings

- **F1 ADDRESSED.** `DECIDE_SHOWN` and `decideRows` (index.html:3383-3386) hold the limit and the default filters (no routine acts, any writer, any class), and `renderDecisions` slices with the same constant (3400). `howItChanges('decision')` offers Correct only for a call in `decideRows` (3629-3631). The fixture has 81 later calls (kit.mjs:754). The new test "may correct" (dashboard-peek.test.mjs:594) checks the 80th (Correct) and the 81st (Start a thread) on both the tab and the peek, and that decisionNotMine is past the window.
- **F2 ADDRESSED.** `keyTip` has no label fallback (index.html:3475), `props()` draws no `title` for an empty tip (1180), and the "every key has a tooltip" assertion can now fail. The vm test (dashboard-peek.test.mjs:659) asserts the list of opener labels with no KEY_TIPS entry is empty, with sanity checks that the scan finds known labels and more than 60.
- **F3 ADDRESSED (untested).** `fromRecord` (index.html:3615) reads `fields.corrected` and `set_by.corrected.by` from the peek's record for acts (3622) and decisions (3629). The opener passes `record: r` (3592). No test covers a correction held only on the record (see N1).
- **F4 ADDRESSED.** `open()` (dashboard-peek.test.mjs:~510) counts re-sets and records the hashes read in between, and fails on more than 2 with the count in the message. It reports any re-set through `t.diagnostic`.
- **Follow-up A ADDRESSED.** The test counts its own navigations (`__navn`) and starts a fresh visit past NAV_BUDGET 120, and `open()` fails on more than 2 re-sets.
- **Follow-up B ACCEPTED.** I checked each point against `peekShow` and `peekHide` (index.html:3765-3796):
  - Reopen during the slide-out: `peekShow` calls `PEEK_HIDE.cancel()` first, which clears `timer` and `net` and removes the `transitionrun`, `transitionend` and `transitioncancel` listeners.
  - Double hide: a second non-immediate `peekHide` returns while `PEEK_HIDE` is set. An immediate one cancels first.
  - `hide()` cancels `PEEK_HIDE` first, so a late timer or event cannot fire it twice.
  - Scrim and scroll lock: `hide()` is unchanged. It still keeps the scrim and overflow when `overlay-open` is set. The net only fires when `peek-open` is absent.
  - Listener leak: every path ends in `cancel()`, which removes all three listeners, so nothing accumulates across cycles.
  - Reduced motion (`dur` 0) hides at once.
  - The new test stops both end events, expects hiding at or after `dur`+900, and expects closed.

## New findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| N1 | Minor | quality §3 (a test must be able to fail on the defect it guards) | test/dashboard-peek.test.mjs (no case); index.html:3615 | `fromRecord` (F3) has no test. The fixture's corrected act is in `DATA.ooda`, so the row path always answers and `fromRecord` is never exercised. Failure: a typo in the record path ships green, and an old corrected call reads "Start a thread" or "Correct, on its row". Cover it by dropping the call from `DATA.ooda` (as the fixture's old decision already is) and correcting it, or by injecting `DATA`. | |
| N2 | Minor | spec §2.2 | index.html:3615 | When `set_by.corrected` is missing, `by` is undefined and `who(undefined)` gives "Corrected by undefined: …". The `correct` command always writes it, so this is theoretical. | |

F5 stays carried to Task 4.

Verdict: APPROVE 166b45e2f2931fc61ac35337fcdeaa8046308bc8 (task level; N1 and N2 are Minor and need no re-review)
