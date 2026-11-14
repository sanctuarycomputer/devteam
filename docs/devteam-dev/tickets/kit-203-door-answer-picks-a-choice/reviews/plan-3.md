# Plan review, pass 3

- Reviewer: plan-confirmer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: e58ec5c615dda2ec578644717922c7b0fa6d9eff (cold confirm of pass 2's fixes, diff-only)

Pass-2 findings checked against `git diff HEAD~2 -- plan.md`:
- P1 fixed: TL;DR bullet 6 names three doors (Something else; nothing picked; note emptied) and the thread copy; bullet 7 names the three risks (redraw, wrong copy, empty post), and subtests 2, 7 and 6 check them in that order. Each TL;DR bullet matches the plan body.
- P2 fixed: Step 1 says "Three doors" and defines D3 (`Turn it on?`) with D1 and D2.
- P3 fixed: subtest 7 now really clicks Answer on a thread copy (`questionCard(q, DATA.ooda, {}, true)` gives `id="t-q-D3"`, ~1295), so the handler's `card.id.startsWith('t-')` (the `qcardOf` pattern, ~3842) is what picks the copy. If it picked `'q'` by mistake, the Inbox redraw in `polls(2)` would draw the ask on `#q-D3` and the assertion would fail.
- P4 fixed: subtest 1 asserts the card's text has no `Answered:` (what `markAnswered` writes, ~3846).

Thread-layer check (is the test copy redrawn or removed?): no. No code writes `#tl`'s own innerHTML. The layer rewrites only its own children by id (`tl-c-*` ~4660–4681, `ask-dock` ~4784, `tl-pill` ~5002, `tl-list` ~5010) and the pins. The 10 s refresh rebuilds `<main>`, not `#tl` (comment ~791). A `<div data-test-copy>` appended to `#tl` stays put. Two more points hold: drafts skip `#tl` textareas (~4041), and focus inside `#tl` doesn't hold the redraw (~5214). So `polls(2)` really redraws the Inbox while the copy keeps its DOM ask. The layer's capture listeners return early for `tlOwn` targets (~4466), so the real clicks reach the page's document click handler (~5346). `click()` in `test/lib/chrome.mjs` (~103) scrolls the element into view, so the copy's position in the flow is not a problem.

The revision adds no Critical or Important problem against spec.md.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| R1 | Minor | plan internal consistency (quality.md §6, a plan says what will be built) | Review focus 3 | Still reads "Tested at the render: subtest 7 calls `questionCard` in the page for both copies". Subtest 7 is now a click test on a thread copy, checked through an Inbox redraw. Fix: "(Tested: subtest 7 clicks Answer on a thread copy and checks the Inbox redraw leaves its card without the ask.)" | fixed in the build: review focus 3 is met by subtest 7 as written; the plan text stays as approved |
| R2 | Minor | test hygiene (quality.md §3) | Subtest 7, cleanup | "Remove that div after" leaves `ASKS[D3] = 't'`. It is harmless now because subtest 7 is last, but a later subtest on D3 would start with stale state. Also `delete ASKS[D3]` in the cleanup. | fixed in the build: subtest 7 cleanup deletes ASKS[D3] |

Verdict: APPROVE e58ec5c615dda2ec578644717922c7b0fa6d9eff
