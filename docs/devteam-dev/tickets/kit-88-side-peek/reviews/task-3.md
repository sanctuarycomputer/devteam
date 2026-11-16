# Task review: Task 3 "Nothing permanent in a peek"

- Reviewer: task-3-reviewer (fresh subagent, claude-sonnet-5-5)
- Range: 940d0457..b6dc4089
- Verdict: APPROVE b6dc4089

I read the diff, the spec (§2.3, §2.2 routes, §3 AC4/5, §5) and the code around each named risk. I ran no tests; the report's gate runs are unverified by me. Every index.html hunk is at line 2380 or later outside lines 46-206 and 1077-1349, so neither `devteam-layout` nor `devteam-shell-js` changed. Files changed are all in touches.

## Checks

- Writes reachable from a peek: `[data-know]` is now drawn only by the Inbox card (index.html:5465) and the owner-action card uses `data-oa-know`; `data-overrule` and `data-overrule-send` are drawn only by `answeredCard` when not `inPeek` (2391). `restsOn` (4367, called from `openDecision` at 4398) and `openQuestion` (4738) are the only peek callers and both pass `inPeek: true`. The remaining writers in a peek are `holdControl` (3011), `data-correct-send` (3367, 3412) and the impact form (4222), all on the allow-list.
- Fetch stub: the page has no XHR, `sendBeacon` or cached `fetch` reference, so the stub on `window.fetch` sees every write.
- `[data-thread-on]`: one delegated listener (5932). `THREAD_KIND` maps `q` to `question`, and the lesson button uses `lesson:<id>`, the same ref a Shift+click on the card draws. The test checks each button's draft ref equals its attribute, in every kind.
- `[data-answered-go]`: the listener opens `#answered-wrap`, scrolls `#a-<qid>` and focuses its Overrule. `#answered` renders every answered question (5477, no slice), so a long list still has the card. The test asserts the open fold, the focused element and the card in view.
- Open question: asserted `#inbox` and `#q-<id>` in view with no peek.
- Owner-action: the positive control posts `{ id: KP, status: 'retired' }`, and the new test beside it checks `TL.draft.subject.ref === 'lesson:KB'` with no `/api/knowledge` post. kit-244's waits and `redrawnWithout` are untouched in the diff.
- Navigation cards (`[data-ticket]`, `[data-open]`): kept out of the loop and clicked once per kind afterwards, with a move-and-no-write assertion, as the controller ruled.

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| N1 | Minor | quality §3 (a test must be able to fail on the defect it guards) | test/dashboard-peek.test.mjs:~644-657 | The no-write loop never asserts it clicked at least one control. The allow-list plus the navigation exclusion is broad; if every kind's remaining controls matched it, the loop would pass with zero clicks. Today the specific checks (no `[data-overrule]`, no `[data-know]`, Retire it) cover the known cases, but a future new write control that matches no selector is only caught if the loop reaches it. Fix: count clicked controls and assert the total is above zero (or that a known non-allowed control, such as a `[data-oa]`-free plain button, was reached). | fixed a1510c7: the no-write loop asserts it clicked at least one control |
| N2 | Minor | spec §2.3 | test/dashboard-peek.test.mjs:~655 | The loop indexes `querySelectorAll(...)[i]` fresh per click; a click that redraws the drawer body can shift indices so a control is skipped silently. Unlikely given the settle and the unchanged-peek assertion, noted only. | fixed a1510c7: controls collected once, keyed by focusKey plus index |
