# kit-236: Owner-action cards carry the owner's own controls for the records they name, and an answer button never stands in for the act

Story DCL-S5 (feature `dashboard-cleanup`, design `project/designs/a-cleaner-more-consistent-dashboard.md`). Depends on `kit-82` (merged, #255: the refused answer stays on its card, `REFUSED`, `answerPress(..., { stays })`).

## Why

Twice the owner answered an owner-action question with its recommendation and nothing changed: `q-20261115-010630233` ("Do all four", observation `o-20261115-020103235`) and `q-20261115-064835172` ("Do both on the dashboard", `o-20261115-072712136`). Both asked the owner to retire knowledge (and let go a goal) on other pages. On the card, `choicesOf()` puts a recommendation in as the first, marked choice, and for an owner-action a recommendation (or any `choices`/`options`) replaces Done / Can't right now, so it reads as a button that does the job. It posts an answer; nothing is retired.

## How it works today (`docs/devteam/dashboard/index.html`)

- `choicesOf(q)` (~1222): for `owner-action` with no choices, options or secrets, the list is Done / Can't right now; a `recommendation` not among the labels is unshifted as a choice and marked `rec`. `openQuestion` (~3438, the drawer of an answered question) lists `choicesOf(q)` too.
- `questionCard(q, …, copy)` (~1288) draws the choices as radios and the button `Send` (`[data-answer]`); the click handler (~5641) posts `{ action: 'answer', body: { id, answer, … } }` through `answerPress`. `needsWhich(q)` asks "which choice do your words mean" when words are typed with no pick on a question with a recommendation.
- Knowledge: the Knowledge drawer's `Retire it` and the Inbox lesson card's `Keep it` / `Retire it` are `[data-know][data-status]`, posting `{ action: 'knowledge', body: { id, status } }` through `press('k:<id>', …)` (~5679). Its `apply` removes the button's whole `.card`, so it can't be reused on a question card as is.
- Goals: the goal hold bar's `Let go` (`[data-hold-id][data-mode="let-go"]`, ~5455) turns into `Confirm let go` for 6 s, held only on the button element, then posts `{ action: 'goal-decide', body: { id, verdict: 'let-go' } }` through `press('g:<id>', { overlay: holdOverlay(id, 'let-go'), onOk: loadFleet, … })`.
- `/api/data` carries `ooda.knowledge` (every candidate, the latest 60 others, never a retired one) and `ooda.goals` (every goal, with `status` and `updates`). A record not in the data is read with `peekOf('lesson', id)` (`/api/peek`, cached in `PEEKS`), whose `record.fields.status` and `record.set_by.status.at` give its status and when it was set. `fetchPeek` ends with `redraw()`, which redraws only an open drawer.
- A thread's copy of a question card is redrawn only when `tlCard`'s signature changes (~4758) and nothing in the turns has focus.
- Questions carry no `refs` field. `ask` refuses a kit id in the question itself; `evidence` holds what the question rests on (the kit's own owner-actions put observation ids there), and `--goal` is asked for on every question, for the goal it serves. The incident question that named its records (`q-20261115-064835172`) named them in `context`.

## What changes (one file of product code: `docs/devteam/dashboard/index.html`)

1. **The records a card names: the ids in its context.** `oaRecords(q)`, for an open `owner-action` question without secrets: the distinct matches in `q.context`, in order, of the knowledge id shape `k-\d{8}-\d{9}-[a-z0-9]+(-[a-z0-9]+)*` or the goal id shape `g-…` (same form). The context is where the asker says what to do; `evidence` (what the question rests on), `goal` (the goal it serves) and `blocks` are not read, so a cited rule or the question's own goal never gets a control or holds Done. This is the ticket's "refs": the ids the question names for the owner to act on.
2. **Each named record's state** (`oaState(q, id)`), on every render. Page memory `OA_SET` (record id → `{ status, at }`) holds a press the page sent and the server accepted or is still sending; it is read before the data, and dropped once the data or the peek shows that status, or on a refusal.
   - knowledge, from `OA_SET`, else `DATA.ooda.knowledge`, else `peekOf('lesson', id)` (`record.fields.status`, `record.set_by.status.at`; while it loads: "checking…"; a 404: "no such record", no control). Its label is its `plain` words when set (an owner lesson's), else its statement.
     - `retired` → done, "Retired".
     - `accepted`, with its status set after `q.asked_at` (from `OA_SET`, its latest `updates[]` entry with a `status`, or `set_by.status.at`) → done, "Kept".
     - otherwise (`accepted` before the ask, `candidate`, `stale`) → not done; control `Retire it`, and for an owner lesson (`ownerLesson(k)`: candidate, `for_owner`) `Keep it` first, as the Inbox lesson card has.
   - goal, from `DATA.ooda.goals` (with `OA_SET`). `abandoned` → done, "Let go"; `met` → done, "Met" (nothing to let go). Otherwise (any other status, `restoring` included) → not done; control `Let go`. A goal not in the data: "no such record", no control.
   - A record "no such record" or "checking…" draws no control. "No such record" never holds Done; "checking…" does (see 5).
3. **The card draws them.** On an owner-action card (both copies: the Inbox's and a thread's), after the context and links and before the choices, a block `[data-oa-recs]` with one row `[data-oa-rec="<id>"]` per named record: `Rule` or `Goal`, its words as a link to its drawer, then its done state (`[data-oa-done]`, a `good` badge, no button) or its controls, then the `not done yet` mark (5), then its own error line `e-<pre>oa-<qid>-<rid>`.
   - `button[data-oa-know="<id>"][data-status="retired|accepted"]` posts exactly what the Knowledge page posts, `{ action: 'knowledge', body: { id, status } }`, through `press('k:<id>', …)`. Its `apply` sets `OA_SET` (`{ status, at: now }`) and redraws (the row shows done at once, on both copies); it never removes the card. On a refusal, `OA_SET`'s entry goes and `press()` writes `Not saved: <reason>` in the row's error line. On success the record's cached peek is dropped and fetched again.
   - `button[data-oa-goal="<id>"]` is `Let go`. The first press puts `g:<id>` in page memory `OA_CONFIRM` (until 6 s later) and redraws: the button now reads `Confirm let go` (class `confirm`), and stays so across polls and redraws until the 6 s pass (a timer redraws then). A press while confirming posts exactly what the hold bar posts, `{ action: 'goal-decide', body: { id, verdict: 'let-go' } }`, through `press('g:<id>', { overlay: holdOverlay(id, 'let-go'), apply: redraw, onOk: loadFleet })`, with `OA_SET` set to `abandoned` until the data agrees.
   - A peek a row asked for redraws the cards when it lands (`fetchPeek` redraws the Inbox and thread card when the key is one `oaState` asked for), not only an open drawer.
   - The thread card's signature (~4758) gains each named record's drawn state (`done` label or controls), `OA_CONFIRM` and `NOT_DONE` for its questions, so a thread copy redraws when they change. A mark set by a press is also written straight into every copy of the card, as kit-82's Dismiss does, so a focused Send in a thread still shows it.
4. **Done and Can't right now, always.** For an open owner-action without secrets, `choicesOf()` returns exactly Done / Can't right now: the `recommendation` is never unshifted as a choice, and a question's own `choices` / `options` never replace the two. `needsWhich()` is false for owner-action. An answered question's drawer (`openQuestion`) keeps the list as asked (today's `choicesOf`, for any question not open), so the record shows what the owner saw.
   - The recommendation is shown as a line of text, `[data-oa-suggest]`: "Suggested: <recommendation>". A question's own `choices` / `options` labels, if any, are shown the same way ("Ways to do it: a; b"), never as buttons.
5. **Done waits for the act.** Pressing Send with Done picked, while one or more named records are not done (state 2, "checking…" included), posts nothing the first time: beside each such row the card shows `not done yet` (`[data-oa-notdone]`), and above Send a line (`[data-oa-anyway]`): "Some of these are unchanged. Change them above, or press Send again to answer Done anyway (say why in the note)." This is kept in page memory (`NOT_DONE`, question id → the ids), so a redraw keeps it. A second Send with Done picked while `NOT_DONE` holds the same set (no named record changed) posts Done as today: the owner decided to leave a record as it is, and said so knowingly. The marks go when a mark's record is done (a done row draws none), when the pick changes, or when the answer posts. Can't right now, or words with no pick, post as today; a card naming no records posts Done as today.

## Acceptance checks (the done-whens)

All in a new `test/dashboard-owner-action.test.mjs`, real headless Chrome through `test/lib/chrome.mjs`'s `openChrome` over a real dashboard (`dashboardOnFreePort`) on a `bareProject` (skipped without `canDrive`), its own hub port and port base, `CLAUDE_CONFIG_DIR` / `CODEX_HOME` in its temp dir. Posts go to the real server (no stub), recorded by a fetch wrapper (`window.__posts`); the 10 s refresh at 300 ms.

Records made with the real CLI: accepted lessons `KA`, `KB`, `KE` (supervisor, `knowledge add`, then `knowledge set --status accepted`), a lesson `KR` retired before the ask, an owner lesson `KO` (candidate, `--for-owner --plain`), goals `G`, `GB`, `GQ`, and `GL` let go before the ask (`goal decide <GL> let-go --owner`, no role). A thread `T`; in it, one owner-action question `Q` (`thread ask`) with `--recommendation "Do all four"`, `--goal GQ`, `--evidence KE`, and `KA`, `KR`, `KO`, `G`, `GL` written in its `--context`. A second owner-action `Q2` with `--goal GQ`, `--evidence KE` and no ids in its context.

1. **Controls post the pages' own actions.** `Q`'s Inbox card has a row per id in its context and no row for `KE` or `GQ`. `KA`'s row has `Retire it` (`[data-oa-know][data-status="retired"]`); `KO`'s has `Keep it` and `Retire it`, labelled with `KO`'s plain words; `G`'s has `Let go`. Pressing `KA`'s `Retire it` records a POST to `/api/knowledge` with body `{ id: KA, status: 'retired' }`; the positive control: the Knowledge drawer's `Retire it` for `KB` (`#lesson/<KB>`) records `{ id: KB, status: 'retired' }`, the same shape. The CLI then shows `KA` retired; the row shows `Retired`, no button, still after three polls (now from the peek). Pressing `G`'s `Let go` once shows `Confirm let go`, still after two polls, and posts nothing; pressing it again records `/api/goal-decide` with `{ id: G, verdict: 'let-go' }`; the positive control: `GB`'s goal drawer hold bar `Let go`, then `Confirm let go`, records `{ id: GB, verdict: 'let-go' }`. `G`'s row shows `Let go` done.
2. **Done and Can't right now; Done waits.** Before any press, `Q`'s answer radios are exactly `Done` and `Can’t right now`; no radio, button or choice label carries "Do all four"; `[data-oa-suggest]` reads `Suggested: Do all four`. Picking Done and pressing Send while `KA`, `KO` and `G` are not done records no `/api/answer` (after a poll), and each of those rows shows `not done yet` (still after a redraw), with `[data-oa-anyway]` above Send; `KR` and `GL` rows show none. The thread copy of `Q` (the thread `T` open) shows the same rows and the same marks. Once every named record is done (check 1, and `KO`'s `Keep it` posting `{ id: KO, status: 'accepted' }`, row `Kept`), Done and Send post `/api/answer` with `answer: 'Done'` on the first press. `Q2` (only a cited rule and its own goal) draws no rows, and Done and Send post at once. A third owner-action `Q3` naming an accepted lesson `KC` in its context: Done, Send shows `not done yet`; Send again posts `/api/answer` `Done` (the way out).
3. **Already done shows done.** `KR`'s row shows `Retired` and `GL`'s `Let go`, each `[data-oa-done]` with no button in the row, once the page has polled (`KR` is read by its peek).

`test/dashboard.test.mjs` and `test/dashboard-answers.test.mjs` are not changed (their only owner-action has secrets, which this leaves alone); each is run once at the end.

## Contracts

None provided. Consumed, unchanged: `/api/data` (`questions[].context|asked_at|recommendation|choices|options|status`, `ooda.knowledge[]`, `ooda.goals[]`), `/api/peek?kind=lesson` (`record.fields.status`, `record.set_by.status.at`), `/api/knowledge`, `/api/goal-decide`, `/api/answer`.

## Edge cases

- A named goal that is also the question's own `goal`: let go, the server drops the goal's questions from the Inbox, and `holdOverlay` does too, so the card leaves. The server's rule, unchanged.
- The same id twice in the context: one row.
- An id in the context that isn't a record: "no such record", no control, doesn't hold Done. A transient peek failure: "checking…", holds the first Done; retries on the next refresh.
- Two copies (Inbox and thread): one `OA_SET`, `OA_CONFIRM`, `NOT_DONE`; presses keyed per record (`k:<id>`, `g:<id>`), so a press on either copy is one post; error lines per copy.
- A press the server refuses: `OA_SET` entry gone, the controls come back, `Not saved: …` in the row (transient, as on the Knowledge page).
- A record older than the 60 in the data: `OA_SET` keeps the row done until the refetched peek says so.
- An owner-action with secrets: unchanged (no rows; Post / Reply / Can't).
- A moved link (`links_moved`, kit-82): Send stays disabled; the record controls stay live.

## Out of scope

- The server: no `refs` field on questions, no change to `ask` (the supervisor's own lesson `k-20261115-072713887` already says no `--recommendation` on owner-action; a lesson to put the records' ids in `--context` is the supervisor's to write).
- Controls for other record kinds (tickets, sensors, problems), and a `Keep it` for an accepted rule or a goal (leaving one as it is is the second Send).
- Applying the act from the answer text.

## Review 1 (`reviews/spec-1.md`), how each finding was settled

F1, F2: records are the ids in the context only (§1). F3: the second Send answers Done anyway, said beside Send (§5). F4: the thread signature and direct marks (§3). F5: `OA_CONFIRM` in page memory (§3). F6, F11: `OA_SET` (§2). F7: a peek a row asked for redraws the cards (§3). F8: `stale`, `met`, `restoring` (§2). F9: `openQuestion` keeps the list as asked (§4). F10: check 2 reworded. F12: the hold bar positive control (check 1). F13: `plain` words (§2).

## Rulings

- `m-20261115-074646713-supervisor`: trial `a-20261115-074130886`: spec and plan first, one combined review (`reviews/spec-1.md`, `reviews/plan-1.md`) from one fresh session, then ask approve-spec and approve-plan together. Keep the running-text width rule in mind (it cites `k-20261114-214208399`, which the owner replaced with `k-20261114-214823656`: running text no wider than half the 12-column grid; the new rows are short lines on a card, which already sits in the grid). Attach light and dark screenshots at phone and desktop widths before the final review.
