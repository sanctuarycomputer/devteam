# kit-236 plan: owner-action cards carry the named records' own controls

## TL;DR

- One product file, `docs/devteam/dashboard/index.html`; one new test, `test/dashboard-owner-action.test.mjs` (both in `touches`).
- T1 writes the whole test first, red against main (the spec's three checks, over the real server; posts recorded, not stubbed; a thread copy too).
- T2: Done / Can't right now always on an open owner-action; the recommendation and any choices become a text line; no "which choice" ask; answered questions' drawers unchanged.
- T3: the records named in the context (`oaRecords`, `oaState`), their rows, `OA_SET` / `OA_CONFIRM` page memory, the `data-oa-know` / `data-oa-goal` controls posting the Knowledge and hold-bar bodies, peeks redrawing cards, `oaPaint()` writing every press into every copy, the thread signature.
- T4: Done waits: `NOT_DONE`, `not done yet` beside each open record, never a post; the way out is Can't right now with a note.
- Gates: only the touched test files, one at a time, `--test-concurrency=2`, through `devteam.mjs gate test`; CI is the gate (`gate ci -- <real command>`).
- Screenshots in light and dark, phone and desktop, before the final review (ruling m-20261115-074646713).

## Files

- `docs/devteam/dashboard/index.html` (changed: `choicesOf`, `needsWhich`, `questionCard`, `openQuestion`'s call, `fetchPeek`, `tlCard`'s signature, the click handler, new helpers beside `choicesOf`, a few CSS lines for `.oa-recs`).
- `test/dashboard-owner-action.test.mjs` (new).
- Records under `docs/devteam-dev/tickets/kit-236-owner-action-controls/` (spec, plan, reviews, verification, screenshots and their `shoot.mjs`).

## T1: the test, red

`test/dashboard-owner-action.test.mjs`, modelled on `test/dashboard-answers.test.mjs` (its own init script: 10 s refresh at 300 ms, `__polls`, a fetch wrapper pushing every POST to `/api/` onto `window.__posts`, no stub; its own `soonIn`). Ports `PORTS + 44` (hub) and `PORTS + 45` (base), free in `test/` (checked by review 1); re-checked after merging main.

Setup with the real CLI in a `bareProject` (roles as review 1 ran them):
- `KA`, `KB`, `KC`, `KE`: `knowledge add --kind fact --statement …` (supervisor), then `knowledge set <id> --status accepted`.
- `KR`: added, then `knowledge set <id> --status retired`.
- `KO`: `knowledge add … --for-owner --plain …` (a candidate waiting for the owner).
- `G`, `GT`, `GB`, `GQ`, `GL`: `goal add` (as in `test/approvals.test.mjs`); `GL` let go with `goal decide <GL> let-go --owner`, no role.
- `T`: `thread new` (owner). `Q`: `thread ask <T> --kind owner-action --question 'Please tidy five records' --context '… <KA> … <KR> … <KO> … <G> … <GT> … <GL> …' --recommendation 'Do all four' --goal <GQ> --evidence <KE>` (supervisor). `Q2`: `ask --kind owner-action --goal <GQ> --evidence <KE>`, context with no ids. `Q3`: `ask --kind owner-action`, context naming `KC`.

Subtests, in order:
1. *answers* (check 2, first part): `Q`'s radios are exactly `['Done', 'Can’t right now']`; no `button`, `input` or `label.choice` in the card has text `Do all four`; `[data-oa-suggest]` is `Suggested: Do all four`; rows are exactly `[KA, KR, KO, G, GT, GL]` (none for `KE`, `GQ`); `KO`'s row shows its plain words.
2. *already done* (check 3): after a poll, `KR` and `GL` rows have `[data-oa-done]` `Done: retired` / `Done: let go` and no `button`.
3. *Done waits* (check 2): pick Done, Send; after a poll, no `/api/answer` for `Q`; `not done yet` on `KA`, `KO`, `G`, `GT` rows and not on `KR`, `GL`; `[data-oa-anyway]` shown; still after `redrawNow()`. Open thread `T` (`#talk/<T>` or the thread card as `dashboard.test.mjs` opens one): its copy of `Q` shows the same rows and marks.
4. *controls* (check 1): `KA` Retire it → `/api/knowledge` body `{ id: KA, status: 'retired' }`; row `Done: retired` at once, still after 3 polls; `knowledge --status retired` (CLI) lists `KA`. Positive control: `#lesson/<KB>`, the drawer's `[data-know="<KB>"][data-status="retired"]` → `{ id: KB, status: 'retired' }`. `G` Let go: first press → `Confirm let go`, still after 2 polls, no `/api/goal-decide`; second → `{ id: G, verdict: 'let-go' }`; row `Done: let go`. Thread copy (thread `T` open): `GT`'s `Let go` pressed on the thread copy shows `Confirm let go` there at once (no poll), second press → `{ id: GT, verdict: 'let-go' }`; `KO`'s `Keep it` pressed on the thread copy → `{ id: KO, status: 'accepted' }`, and both copies' `KO` rows read `Done: kept` before the next poll (checked with `__polls` unchanged). Positive control: `#goal/<GB>`, the hold bar's `[data-hold-id="<GB>"][data-mode="let-go"]` twice → `{ id: GB, verdict: 'let-go' }`. `KO` stays `Done: kept` after a poll.
5. *Done goes through* (check 2): every row of `Q` done; pick Done, Send once → `/api/answer` for `Q` with `answer: 'Done'`. `Q2`: no rows; Done, Send → posted at once. `Q3`: Done, Send → no post, `not done yet` on `KC`; two more fast Sends (two `click()` in one evaluate) → still no `/api/answer` after a poll; click Can't right now → marks gone at once; type a note, Send → `/api/answer` `Can’t right now — <note>`.

Run against main's dashboard: subtests fail, setup passes. Commit: `kit-236: the owner-action card test (red)`. If any setup command is refused, adjust the test only; a needed server change stops the plan (design-change message).

## T2: Done and Can't right now, always

- `choicesOf(q)`: `const oa = q.kind === 'owner-action' && !(q.secrets || []).length && q.status === 'open'` (questions in `DATA.questions` are open; `openQuestion`'s answered ones are not, so its list stays as asked). If `oa`: return the two fixed choices, none `rec`.
- `needsWhich(q)`: false for `owner-action`.
- `oaSuggest(q)`: `<p class="meta" data-oa-suggest>Suggested: <rec></p>` (escaped) when there is a recommendation, and `Ways to do it: a; b` when the question has its own choices/options. Drawn in `questionCard` just before the choices, for `oa` only.
- Run T1's file: subtest 1's answer part passes.

## T3: the named records and their controls

Helpers beside `choicesOf`:
- `const OA_ID = /\b[kg]-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*/g`; `oaRecords(q)` = distinct matches in `q.context` for `oa` questions, else `[]`.
- `OA_SET = new Map()` (id → `{ status, at }`), `OA_CONFIRM = new Map()` (goal id → until), `OA_PEEKS = new Set()` (peek keys rows asked for).
- `oaState(q, id)` → `{ kind, words, href, done, loading, missing, owner }` per spec §2. Knowledge status time: `OA_SET` `at`, else the last `updates[]` entry with a `status`, else `created_at`; from a peek, `record.set_by?.status?.at ?? record.created_at`. `OA_SET` entries are dropped here once the data/peek shows the same status.
- `oaRows(q, pre)`: the `[data-oa-recs]` block (spec §3), buttons `ghost`, `Confirm let go` with class `confirm` while `OA_CONFIRM.get(id) > Date.now()`.
- `questionCard`: `${oa ? oaSuggest(q) + oaRows(q, pre) : ''}` after the links and before the choices.
- `oaPaint()`: for every `[data-qcard]` of an `oa` question in the DOM (Inbox and thread; `pre` from its id), replace its `[data-oa-recs]` and `[data-oa-anyway]` with freshly drawn ones (`oaRows`, `oaAnyway`). Called by every row press (`apply`, `undo`), the Done check, the pick handler and the confirm timer.
- `fetchPeek`: after it stores, if `OA_PEEKS.has(k)`, `redrawNow()` as well as `redraw()`.
- `tlCard` signature: append, per question, `oaSig(q)` = JSON of each row's drawn state, `NOT_DONE.get(id)`, and the confirms of its goals.
- Click handler, before the `[data-answer]` branch:
  - `[data-oa-know]`: `press('k:<id>', { build: () => ({ action: 'knowledge', body: { id, status } }), apply: () => { OA_SET.set(id, { status, at: now }); oaPaint(); }, undo: () => { OA_SET.delete(id); oaPaint(); }, onOk: () => { PEEKS.delete(peekKey('lesson', id)); fetchPeek('lesson', id); }, errId })`.
  - `[data-oa-goal]`: not confirming → `OA_CONFIRM.set(id, Date.now() + 6000)`, `setTimeout(oaPaint, 6050)`, `oaPaint()`, return. Confirming → `OA_CONFIRM.delete(id)`, `press('g:<id>', { build: () => ({ action: 'goal-decide', body: { id, verdict: 'let-go' } }), overlay: holdOverlay(id, 'let-go'), apply: () => { OA_SET.set(id, { status: 'abandoned', at: now }); oaPaint(); redrawNow(); redraw(); }, undo: () => { OA_SET.delete(id); oaPaint(); }, onOk: () => loadFleet(), errId })`.
- CSS: `.oa-recs` (`display: grid; gap`), each row `display: flex; flex-wrap: wrap; gap; align-items: baseline`, so nothing sticks out on a phone.
- Run T1's file: subtests 1, 2 and 4 pass.

## T4: Done waits for the act

- `NOT_DONE = new Map()` (qid → ids).
- In the `[data-answer]` branch, after the existing validation and before `answerPress`: if `oa` and `picked === 'Done'`: `open` = rows not done and not missing. If `open` is non-empty: `NOT_DONE.set(id, open)`, `oaPaint()`, return; never a post, however often Send is pressed. Otherwise `NOT_DONE.delete(id)` and post as today.
- The pick handler (~5547, on click): when the picked value is not `Done`, `NOT_DONE.delete(qid)` and `oaPaint()`; picking Done again leaves the marks.
- At render, entries for questions no longer open are pruned (as kit-82 does for `REFUSED`).
- `oaRows` draws `<span class="err" data-oa-notdone>not done yet</span>` on a row in `NOT_DONE.get(qid)` and not done; `oaAnyway(q)` draws `[data-oa-anyway]` above the button row while `NOT_DONE.has(qid)` and some row is still not done (an empty placeholder element otherwise, so `oaPaint` has a place to write).
- Run T1's file: all subtests pass. Then `test/dashboard-answers.test.mjs` and `test/dashboard.test.mjs`, one at a time at `--test-concurrency=2`, through `devteam.mjs gate test`.

## Review records

`reviews/task-<n>.md` per task (a fresh subagent per review, `governance/quality.md` §3), final `reviews/final-1.md` from a reviewer that has not seen the build.

## Review 1 (`reviews/plan-1.md`), how each finding was settled

P1: setup follows the spec (ids in context; `Q2` with only `--goal` and `--evidence` posts Done at once). P2: `OA_CONFIRM`, survives polls (subtest 4). P3: the thread signature and a thread-copy check (subtest 3). P4: `fetchPeek` redraws cards; subtest 2 waits a poll. P5, P7: `OA_SET` and the status table. P6: `onOk: loadFleet`. P8: the hold bar positive control.

## Review 2 (`reviews/plan-2.md`), how each finding was settled

P1: `oaPaint()` writes every press into every copy; subtest 4 presses on the thread copy and checks before a poll. P2: no bypass; subtest 5 checks fast repeated Sends post nothing, and the way out is Can't right now with a note. P3: the pick handler (on click) clears the marks only for a pick other than Done, and repaints.

## Rulings

- `m-20261115-074646713-supervisor` (as the spec's Rulings).
