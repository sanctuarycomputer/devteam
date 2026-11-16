# Task review, T1, pass 2

- Reviewer: task-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: ae9e8e221bd1fba08422d110deade19303875e66 (T1: e608692..ae9e8e2)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-2-1 | Minor | spec line 68 ("its `title` lists each held goal and why when the hello names them, else the counts") | test/hub-overview.test.mjs, 'the partly-held pill' | No case has `held` as an array that names no goal (`[]`, or only entries without a string `title`). The code falls back to the counts, as it should, but the mutant `title: Array.isArray(g.held) ? named.join('\n') : …` (an empty title) passes all four rules tests. Possibly add `heldPill({ goals: { run: 1, drain: 0, park: 1, held: [{ mode: 'park' }] } }).title` → `'1 parked, 0 draining'`. | deferred (minor): the code falls back correctly; a test case to add in the final fix pass if any |
| T1-2-2 | Minor | spec line 68; plan Task 1 `heldPill` (`"<title>: <why>"`, or the mode without a why) | hub.html `heldPill`, the `named` filter | A held entry with `title: ''` (or a title that `tLine` turns to nothing, e.g. only spaces or control characters) passes the filter and gives a line `": <why>"`. An empty `why` falls back to the mode, but no test covers that: the mutant that drops `&& h.why` survives. Possibly filter on `tLine(h.title, 200)` being non-empty, and add a `why: ''` case. | deferred (minor): an all-blank title is not a hello any project sends; noted for the final pass |
| T1-2-3 | Minor | spec line 25 ("the open questions, when more than 0"); plan Task 1 `tabCounts` ("q = inbox when it is an integer > 0") | test/hub-overview.test.mjs, 'tab counts' | No case passes a negative whole-number inbox, so the mutant `Number.isInteger(inbox) ? inbox : 0` survives (it would give `q: -1`). Possibly add `tabCounts(-1, null).q` → `0`. | deferred (minor): the code reads q only when >0; noted for the final pass |

Pass 1's dispositions checked on a scratch copy of ae9e8e2, outside the worktree:
- T1-1 is true. The new case `tabCounts(0, { you: 1, waiting: 2, ready: 0 }).th` → `you` kills pass 1's mutant (testing `waiting` before `you`): 3 pass, 1 fail.
- T1-2 is true. A held entry with no why and no string mode reads `<title>: held`, and that is tested. The mutant that goes back to the raw `h.mode` is killed.
- T1-3 is true. `machineMode` filters to run, drain and park before it counts or takes the mode, and `['run', 'nope', null]` tests it. Two mutants are killed: one that drops the filter, and one that computes the mode from the unfiltered `modes`.

Checked afresh and found sound:
- None of the block's names (`wholeN`, `tabCounts`, `heldPill`, `machineMode`, `HUB_VIEWS`, `hubKey`) is declared anywhere else in the page's one script.
- `tLine` (line 1095) is defined after the block, but it is only called at paint time, so there is no TDZ hazard. The same holds for `HUB_VIEWS`/`hubKey` against `keyOf`.
- `keyOf` behaves as before for twins. As before, it shows `-undefined` until `hexOf` resolves.
- The reserved names change `draw()`'s and `hashchange`'s `keyOf(o) === want` lookups as the plan intends: a project named `terminal` on a laptop no longer captures `#terminal`. The gateway's push links are noted as a follow-up in plan Notes.
- Two survivors are equivalent: dropping `!total` (two counts above 0 already imply a total above 0), and `includes(name)` vs `includes(String(name))` (names are strings).
- The baseline rules tests pass 4/4 on ae9e8e2. The fix commit touches nothing inside `devteam-shell-js` or `devteam-layout`.

Verdict: APPROVE ae9e8e221bd1fba08422d110deade19303875e66
