The Inbox-order browser test (`test/next-step.strategy.test.mjs`, "the Inbox shows the order: …") now waits on the page's own signals in the goal drawer, so `timed out waiting for the owner's value` stops flaking (main run 43904665122, `kit (24, chrome 1/2)`, attempt 1).

## The cause

The subtest opened the goal drawer and waited only for the "Wrong?" button to exist. The drawer is drawn twice: at once from the data the page has, while the goal's record (`/api/peek`, a CLI spawn on the server) is on its way, and again when the record lands. The record's rows (its stored fields, `Created`, `Last changed`) go into the attributes list above "Why it matters", which pushes "Wrong?" down about 250 px. That redraw comes from `fetchPeek` → `redraw()`, which is held only while a drawer field has focus, never by a recent press.

`p.click` measures the button, then presses at that point in a later CDP call. When the record lands between the two, the press hits one of the new rows. The form stays hidden, the test sets values on the hidden form, Send is clicked at nothing, no correction is sent, and `goal show` keeps level 3 until `until` gives up. On a loaded runner the CLI spawn behind the peek is slow enough to land in that window.

Reproduced deterministically: `evidence/repro.sh race` holds the page's `/api/peek` answers, measures "Wrong?" as `p.click` does, lets the record land, and presses at the measured point. The button moved from y=246 to y=494, the point is on the `Created` row, the form stays hidden, and the subtest fails with `timed out waiting for the owner's value` (`evidence/repro-race.txt`). Waiting for the record first, then measuring, passes (`evidence/repro-fixed.txt`).

kit-88 (merged first) added a wait for the drawer's slide-in to come to rest. That is a different move, and it doesn't cover this one: at this branch's merge of main (a7a13a8), the repro waits for the drawer at rest, measures, lets the record land, and the button moves from y=246 to y=415. The press lands on "Start a thread", and the subtest times out the same way (`evidence/repro-race-a7a13a8.txt`; the fixed order passes, `evidence/repro-fixed-a7a13a8.txt`). Both waits stay.

## The fix (test only)

- Before "Wrong?": wait for the drawer drawn with its record: its `Created` row there (a load pending or failed draws a `Record` row instead) and no `.loading` left. Then kit-88's wait for the drawer at rest, as merged.
- After "Wrong?": wait for the form open with its reason field focused. That is the click's own effect, and the focus is what holds the drawer's and the page's redraws while the values go in.
- After Send: wait for `Correction sent`, or the button reading `Change it` once a refresh has redrawn the drawer with the owner's value; then the server value as before.

No sleep, retry or longer timeout.

## How to verify

- Stress (test-stress.yml, `files=test/next-step.strategy.test.mjs`, `repeat=5`, `node=24`, one after another): STRESS_RUNS
- Mutation (`evidence/mutate.sh`, reverted, never committed): drawing the Inbox's questions reversed (`[...d.questions].reverse().map(…)` in `render()`) makes `not ok 6`, at l.252 (`the kit's order, and the lesson to keep after the questions`); subtests 1–5 ok. Output in `evidence/mutation.txt`:

```
MUTATION
```

- Locally: `node --test --test-concurrency=2 test/next-step.strategy.test.mjs` passes (three gate runs on Node 22).

Records: `docs/devteam-dev/tickets/kit-246-steady-inbox-order-test/` (spec, plan, reviews, verification, evidence).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
