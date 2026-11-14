# kit-203: a typed answer asks which choice it means — plan

## TL;DR

- One task: the dashboard page (`docs/devteam/dashboard/index.html`) and its test (`test/dashboard.test.mjs`); `devteam.mjs` is not touched, so `matched` and `doorAgreed` stay as they are.
- Pressing Answer with words and no pick, on a card that has choices and a recommendation (any kind but goal approval, review, secrets), posts nothing and shows an inline ask on that copy of the card: one button per choice, then None of them.
- A choice posts `"<label> — <words>"`; None posts the words alone; the words are that card's note when the button is pressed.
- The ask lives in page memory (`ASKS`, per question, with the copy it is on) so an Inbox redraw keeps it; a radio pick takes it away; posting clears it; a refused post brings the card back without it.
- The Answer handler's body is reused for the ask's buttons, so the standing rule, next-time rung and seen hash go with either.
- Tested first: a new Chrome test in `test/dashboard.test.mjs` on three one-way doors (Something else; nothing picked; the note emptied under the ask) and a thread copy of a card, checking the log's answer and `matched` through `questions --all --json`.
- Risk: the ask lost or duplicated on a redraw, shown on the wrong copy, or a post with empty words; the test checks all three.

> **For agentic workers:** executed inline with superpowers:executing-plans and test-driven-development.

**Goal:** the owner says which choice their typed words mean before the answer is posted.
**Architecture:** one more piece of card state (`ASKS`), drawn by `questionCard`, set and cleared by the existing click handler.
**Tech stack:** the dashboard's single-file vanilla JS; tests in `node:test` driving headless Chrome over CDP (`test/lib/chrome.mjs`).
**Spec:** `docs/devteam-dev/tickets/kit-203-door-answer-picks-a-choice/spec.md`

## Global constraints

- Only `docs/devteam/dashboard/index.html` and `test/dashboard.test.mjs` change (touches); no file is added outside this ticket's records.
- Running text in the ask stays short (≤ 39ch a line: the owner's typography rule).
- Copy (exact): heading `Which choice do your words mean?`; last button `None of them` with detail `Post my words as they are.`; the recommended choice carries the card's `Recommended` tag.

## Review focus

1. A redraw while the ask shows: the Inbox card keeps it, never shows two. (Tested.)
2. The note emptied after the ask showed, then a choice pressed: nothing posted, the ask goes, the existing error shows. (Tested: subtest 6.)
3. The thread's copy of a card: an ask raised there stays there, and the Inbox card doesn't show it. (Tested at the render: subtest 7 calls `questionCard` in the page for both copies.)
4. A refused post from the ask: the card back with the words and the original pick, no ask. (`answerPress`'s existing restore; `ASKS` is deleted before the post.)
5. A label holding `"` or `<`: the ask's buttons carry the label through `esc` and read it back from `value`, never from text.

---

### Task 1: the inline ask

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (CSS near `.choice` ~243; state beside `picks` ~1224; `questionCard` ~1276; click handler: the `input[data-pick]` branch ~5439 and the `[data-answer]` branch ~5525)
- Test: `test/dashboard.test.mjs` (a new top-level test after the `presses` test, ports `PORTS + 63` and `PORTS + 64`)

**Interfaces (inside index.html):**
- `const ASKS = {}`: `ASKS[qid] = 'q' | 't'`, the copy the ask is on (Inbox card `q-<id>`, thread card `t-q-<id>`).
- `needsWhich(q) -> boolean`: `!!q && !!q.recommendation && choicesOf(q).length > 0 && !['goal-approval', 'review'].includes(q.kind) && !(q.secrets || []).length`.
- `whichAsk(q, list) -> string`: the ask's HTML, `<div class="which" data-which-for="<id>">`, a `<p>` with the heading, then one `<button type="button" class="choice…" data-which="<id>" value="<label>">` per `list` entry (in `choicesOf` order, `rec` class and `Recommended` tag as on the card), then `<button … data-which="<id>" data-which-none value="">` for None.
- `questionCard` draws `whichAsk` just above `.row-inline` when `ASKS[q.id] === (copy ? 't' : 'q')`.

- [ ] **Step 0: The owner's notes**

Check `devteam.mjs messages` and `history kit-203-door-answer-picks-a-choice` for notes on artifact door-answer-pick; apply any to the copy and layout below and record them under Rulings. None by plan approval: build as written (m-20261114-221051654-supervisor).

- [ ] **Step 1: Write the failing test**

`test('a typed answer on a question with choices asks which choice it means, on the card, before posting', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, …)`, set up like the `presses` test (bareProject, `dt` helper, `dashboardOnFreePort`, Chrome at 1100×800, `POLL_FAST`, `#questions`). Three doors:
`D1 = dt(['ask', '--kind', 'one-way-door', '--question', 'Keep the sales data?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--recommendation', 'Yes'], SUP)`, `D2` the same with question `Open the box?`, `D3` with `Turn it on?`. (If `ask` needs a `--ticket`/`--goal` for a door, add the fixture's goal.)

Subtests and assertions:
1. `Something else and words: the ask, and nothing posted` — click D1's `input[data-pick][value="__other"]`, type `agreed, keep it` in its `textarea[data-q]`, click `[data-answer]`. Assert `[data-which-for="D1"]` exists in the Inbox card with buttons whose values are `['Yes', 'No', '']`, the `Yes` button has the `Recommended` tag, `SAVING === 0` (no post in flight), the card's text has no `Answered:`, and, after `polls(2)`, `questions --id D1` still says open.
2. `the ask survives a redraw` — `await polls(2)`; assert exactly one `[data-which-for="D1"]` in `#questions`.
3. `a radio pick takes it away` — click D1's `value="No"` radio; assert no `[data-which-for="D1"]`; click `__other` again, then `[data-answer]`; assert the ask is back.
4. `a choice in the ask posts "<label> — <words>", matched` — click `button[data-which="D1"][value="Yes"]`; `until` the log's D1 (from `questions --all --json`) has `answer === 'Yes — agreed, keep it'` and `matched === true`.
5. `a note with nothing picked asks too; None posts the words alone` — type `not sure yet` in D2's note, click `[data-answer]`; assert `[data-which-for="D2"]`; click `button[data-which="D2"][data-which-none]`; `until` D2's `answer === 'not sure yet'` and `matched === false`.
6. `the note emptied under the ask: nothing posted` — on a third door D3 (`Turn it on?`), type `ok`, click `[data-answer]` (ask shows), set the note to empty (`value = ''` and an `input` event), click `button[data-which="D3"][value="Yes"]`; assert no `[data-which-for="D3"]`, `#e-D3` says `Pick a choice or write an answer.`, `SAVING === 0`, and after `polls(2)` D3 is still open.
7. `an ask raised on a thread's copy stays on that copy` — in the page, put a thread copy of D3 into the document the way a thread draws it: a `<div data-test-copy>` appended inside the page's own `#tl` holding `questionCard(q, DATA.ooda, {}, true)` (q = D3 from `DATA.questions`); type `ok` in that copy's `textarea[data-q]` and click its `button[data-answer]` (real clicks). Assert `#t-q-D3 [data-which-for="D3"]` exists and `#q-D3 [data-which-for="D3"]` doesn't, after `polls(2)` too (the Inbox redraw draws it on the Inbox copy only when `ASKS[D3] === 'q'`). Remove that div after.

- [ ] **Step 2: Run it and see it fail**

Run: `/usr/local/bin/node --test --test-name-pattern 'asks which choice' test/dashboard.test.mjs`
Expected: subtest 1 fails (no `[data-which-for]`; D1 answered `agreed, keep it`).

- [ ] **Step 3: Implement**

- CSS: `.which { margin: 8px 0; }`, `.which p { margin: 0 0 6px; font-weight: 600; }`, `.which .choice { grid-template-columns: minmax(0, 1fr); width: 100%; }`.
- `ASKS`, `needsWhich`, `whichAsk` as in Interfaces; `questionCard` draws it.
- Pick branch: on any `input[data-pick]`, `delete ASKS[id]` and remove every `[data-which-for="<id>"]`.
- Answer branch: match `[data-answer], button[data-which]`; `id = btn.dataset.answer ?? btn.dataset.which`; `chose = btn.dataset.which !== undefined ? btn.value : null`. When `chose !== null`, `picked = chose` (empty for None). Words are the card's note as now. If `chose !== null && !note`: delete the ask (state and DOM on that card), show `Pick a choice or write an answer.`, return. If `chose === null && !picked && note && !goalId && needsWhich(q)`: set `ASKS[id] = card.id.startsWith('t-') ? 't' : 'q'`, insert `whichAsk(q, choicesOf(q))` before that card's `.row-inline` if not there, clear the error, return. Otherwise `delete ASKS[id]` and post as today.

- [ ] **Step 4: Run it and see it pass**

Run the Step 2 command; expected: every subtest passes. Then the suite as test.yml runs it, through the recorder: `devteam.mjs gate test -- /usr/local/bin/node --test --test-concurrency=8 test/kit.test.mjs`, `… -- /usr/local/bin/node --test test/bounds.test.mjs`, and `… -- /usr/local/bin/node --test --test-concurrency=8 <every other test/*.test.mjs>`; all pass (the CI matrix's other Node versions are checked on the PR).

- [ ] **Step 5: Commit**

`git add docs/devteam/dashboard/index.html test/dashboard.test.mjs && git commit -m "kit-203: a typed answer asks which choice it means"`; task review into `reviews/task-1.md`.

## Rulings

- m-20261114-220752354-supervisor: spec approved; draw a small clickable mock (artifact door-answer-pick: one Inbox door card with the real choices, own words, the inline ask, each pick and None) before building; plan meanwhile, build only after the owner's notes. The build follows whatever the owner's notes change in the mock's wording or layout.
- m-20261114-221051654-supervisor: the mock landed in home (chore-artifact-door-answer-pick); the uncommitted copy here is deleted. Wait for the owner's notes; if none have come by the time this plan is approved, build. Step 0 below.
