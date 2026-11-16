Fixes the flaky owner-action Chrome test: 'Done goes through once every record is done; never while one is unchanged' failed with `timed out: the note focused` on CI (kit-202, kit-241 run 43804955902 attempt 1, #268, the daily test-stress run).

## The cause

`p.click` (test/lib/chrome.mjs) works in two steps. One CDP evaluate scrolls the control to the middle and measures it, and later `Input.dispatchMouseEvent` presses at that point. An answered question's card doesn't leave the Inbox when it is answered. It shows as its "Answered" note until the next redraw removes it, and that redraw moves every card below it up the page (143 px here).

When that redraw fell between `p.click`'s measure and its press, the press on Q3's note landed below it, on the Inbox's "Answered (1)" section. Nothing was focused and nothing threw, so the test waited 20 s for focus and failed. Q2's and Q3's other clicks had the same exposure.

Reproduced at main: `docs/devteam-dev/tickets/kit-244-steady-owner-action-test/evidence/repro-race.txt`, from `evidence/repro.sh race`. That run holds the page's data reads, so the redraw lands between the two steps every time.

## The fix

Test-only, in `test/dashboard-owner-action.test.mjs`. Before the next card's clicks, the subtest waits for two of the page's own signals:
- the answered card is gone from the Inbox;
- `#answered-sum` reads one more than it did at the subtest's start. That count comes from the server's answered list, so the redraw of data that lists the answer has happened, and nothing above Q3 moves after it.

No sleep, retry or longer timeout was added. With the same held reads but this order, the press lands on the note: `evidence/repro-fixed.txt`.

## How to verify

- Stress (done-when 2): test-stress.yml on this branch with `files=test/dashboard-owner-action.test.mjs`, `node=22`, `repeat=5` (the workflow's maximum), run four times, one after another, for 20 repeats. Runs, all successful: [43826419937](https://github.com/sanctuarycomputer/devteam/actions/runs/43826419937), [43826595672](https://github.com/sanctuarycomputer/devteam/actions/runs/43826595672) (at 8636a1f), [43826814063](https://github.com/sanctuarycomputer/devteam/actions/runs/43826814063), [43826989988](https://github.com/sanctuarycomputer/devteam/actions/runs/43826989988) (at 01fd1ef; it differs from 8636a1f only in one comment's wording). 20 of 20 passed on Node v22.23.4 with 0 skipped.
- Mutation (done-when 3): `sh docs/devteam-dev/tickets/kit-244-steady-owner-action-test/evidence/mutate.sh` lets Done through on Q3 while its record is unchanged. It skips the dashboard's Done gate for that question only and restores the file afterwards. Subtests 1 to 4 pass. Subtest 5 fails at l.190, `timed out: not done yet` (`evidence/mutation.txt`):
  ```
  -      if (open.length) { NOT_DONE.set(id, open); oaPaint(); return; }
  +      if (open.length && !/look at one rule/.test(qv.question)) { NOT_DONE.set(id, open); oaPaint(); return; }
  not ok 5 - Done goes through once every record is done; never while one is unchanged
    error: `timed out: not done yet; ...`
  ```
- Locally: `node --test test/dashboard-owner-action.test.mjs` on Node 22 (Node 18 skips the Chrome cases).

Records: `docs/devteam-dev/tickets/kit-244-steady-owner-action-test/` (spec, plan, reviews, verification).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
