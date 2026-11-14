# Plan review, pass 2

- Reviewer: plan-confirmer (fresh subagent, claude-opus-5-5)
- Reviewed: 3bda3d34180ef7cc3082a60233a87ca647d5ff1d (cold confirm of pass 1's fixes, diff-only)

Pass-1 findings checked against `git diff HEAD~1 -- plan.md`:
- F1 fixed: subtest 6 empties the note under the ask, presses `Yes`, and asserts no ask, the `#e-<id>` error, `SAVING === 0` and still open after `polls(2)`. Step 3's guard (`chose !== null && !note` → error, return) comes before the post. The error string matches the existing one (index.html ~5530). For the Inbox copy the error span is `e-${pre}${id}` with `pre = ''` (~1314), so `#e-<D3>` resolves.
- F2 fixed: Step 4 runs the three test.yml jobs (test.yml lines 47, 50, 54) through `gate test`.
- F3 fixed: Step 0 and the second ruling.
- F4 fixed, partly (see P3): subtest 7 checks the render for both copies.
- F5 fixed, partly (see P4): `SAVING === 0` and the `polls(2)` open check were added. `SAVING` is the top-level `let` at ~3731, and `press` increments it synchronously (~3745), so the check works.
- F6 fixed: TL;DR bullet 1 now names the test file.

The code the new subtests use exists: `questionCard(q, o, reasonText, copy = false)` (~1273), `DATA.ooda` and `o.classes` (used at ~1278), and the `reasonText` object (~4047, so passing `{}` is fine). The page script is a classic top-level script, so `ASKS`, `SAVING`, `DATA` and `questionCard` can be reached from CDP evaluate. No new conflict with the spec or the ticket's done-when.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P1 | Important | quality.md §6 ("a TL;DR that says something the plan doesn't do is an Important finding") | TL;DR bullets 6 and 7 | The revision made two TL;DR bullets out of date. Bullet 6 says the test runs "on two one-way doors (Something else, and nothing picked)", but subtest 6 now adds a third door, D3, for the emptied-note case, and subtest 7 adds a render check of both copies. Bullet 7 says "the empty case is guarded in code", but Review focus 2 now says it is tested (subtest 6). Fix: e.g. bullet 6 "three one-way doors (Something else, nothing picked, note emptied under the ask) plus a render check that the ask draws only on its own copy"; bullet 7 "the test checks the redraw and the empty case". | fixed |
| P2 | Minor | plan internal consistency (quality.md §6, a plan says what will be built) | Task 1 Step 1, fixture line | Step 1 still says "Two doors:" and defines only D1 and D2, while subtest 6 uses D3 ("on a third door D3 (`Turn it on?`)"). Add D3 to the fixture list so the worker creates it with the others, before Chrome loads, and it shows in the first draw. | fixed |
| P3 | Minor | spec "The ask belongs to one copy of the card … The other copy never shows it"; pass-1 F4 | Subtest 7; Step 3 Answer branch | Subtest 7 sets `ASKS[D3]` by hand, so it tests only the draw rule. It never tests the handler's `card.id.startsWith('t-') ? 't' : 'q'`, which is the code that picks the copy. If that is wrong (e.g. it reads the button's card, or the id of `#questions`), the ask jumps to the other copy and subtest 7 still passes. Pass 1 suggested a click on `#t-q-<id>` in the existing threads fixture (~3138). That, or one subtest clicking Answer inside a thread copy, would close this. Not blocking: the failure is display-only and nothing gets posted. | fixed |
| P4 | Minor | pass-1 F5 ("assert the card is not `.done` / has no `Answered:`") | Subtest 1 | Half of F5 was dropped: there is no assertion that the card is not marked answered. `SAVING === 0` plus open after `polls(2)` covers the log. A wrong optimistic `markAnswered` with no post would still pass. Add `!card.classList.contains('done')` (or no `Answered:`). | fixed |

Verdict: CHANGES 3bda3d34180ef7cc3082a60233a87ca647d5ff1d
