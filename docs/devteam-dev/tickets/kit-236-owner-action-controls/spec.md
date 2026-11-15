# kit-236: Owner-action cards carry the owner's own controls for the records they name, and an answer button never stands in for the act

Story DCL-S5 (feature `dashboard-cleanup`, design `project/designs/a-cleaner-more-consistent-dashboard.md`). Depends on `kit-82` (merged, #255: the refused answer stays on its card, `REFUSED`, `answerPress(..., { stays })`).

## Why

Twice the owner answered an owner-action question with its recommendation and nothing changed: `q-20261115-010630233` ("Do all four", observation `o-20261115-020103235`) and `q-20261115-064835172` ("Do both on the dashboard", `o-20261115-072712136`). Both asked the owner to retire knowledge (and let go a goal) on other pages. On the card, `choicesOf()` puts a recommendation in as the first, marked choice, and for an owner-action a recommendation (or any `choices`/`options`) replaces Done / Can't right now, so it reads as a button that does the job. It posts an answer; nothing is retired.

## How it works today (`docs/devteam/dashboard/index.html`)

- `choicesOf(q)` (~1222): for `owner-action` with no choices, options or secrets, the list is Done / Can't right now; a `recommendation` not among the labels is unshifted as a choice and marked `rec`.
- `questionCard(q, …, copy)` (~1288) draws the choices as radios and the button `Send` (`[data-answer]`); the click handler (~5641) posts `{ action: 'answer', body: { id, answer, … } }` through `answerPress`. `needsWhich(q)` asks "which choice do your words mean" when words are typed with no pick on a question with a recommendation.
- Knowledge: the Knowledge drawer's `Retire it` and the Inbox lesson card's `Keep it` / `Retire it` are `[data-know][data-status]`, posting `{ action: 'knowledge', body: { id, status } }` through `press('k:<id>', …)` (~5679). Its `apply` removes the button's whole `.card`, so it can't be reused on a question card as is.
- Goals: the goal hold bar's `Let go` (`[data-hold-id][data-mode="let-go"]`, ~5455) turns into `Confirm let go` for 6 s, then posts `{ action: 'goal-decide', body: { id, verdict: 'let-go' } }` through `press('g:<id>', { overlay: holdOverlay(id, 'let-go'), … })`.
- `/api/data` carries `ooda.knowledge` (every candidate, the latest 60 others, never a retired one) and `ooda.goals` (every goal, with `status` and `updates`). A record not in the data is read with `peekOf('lesson', id)` (`/api/peek`, cached in `PEEKS`), whose `record.fields.status` and `record.set_by.status.at` give its status and when it was set.
- Questions carry no `refs` field. The ids a question names live in `evidence`, `blocks`, `goal`, and (since `ask` refuses a kit id in the question itself) in its `context` text, as `q-20261115-064835172` did.

## What changes (one file of product code: `docs/devteam/dashboard/index.html`)

1. **The records a card names.** `oaRecords(q)`, for an `owner-action` question without secrets: the distinct ids, in order of first appearance, from `q.evidence`, `q.blocks`, `q.goal`, then every match in `q.context` of the knowledge id shape `k-\d{8}-\d{9}-[a-z0-9-]+` or the goal id shape `g-\d{8}-\d{9}-[a-z0-9-]+`, kept only when the id is knowledge (`k-`) or a goal (`g-`). Ids of other kinds (observations, problems, tickets) are left alone.
2. **Each named record's state** (`oaState(q, id)`), computed on every render:
   - knowledge: from `DATA.ooda.knowledge` if there, else `peekOf('lesson', id)` (`record.fields.status`, `record.set_by.status.at`; while it loads: "checking…"; a 404: "no such record", no control).
     - `retired` → done, "Retired".
     - `accepted`, set (its latest `updates[]` entry with a `status`, or `set_by.status.at`) after `q.asked_at` → done, "Kept".
     - otherwise (accepted before the ask, or candidate) → not done; controls: `Retire it`, and for an owner lesson (`ownerLesson(k)`: candidate, `for_owner`) also `Keep it` first, as the Inbox lesson card has.
   - goal: from `DATA.ooda.goals`. `abandoned` → done, "Let go". Otherwise → not done; control `Let go`, which becomes `Confirm let go` on the first press (6 s, as the hold bar), and posts on the second. A goal not in the data: "no such record", no control.
3. **The card draws them.** On an owner-action card (both copies: the Inbox's and a thread's), between the context/links and the choices, a block `[data-oa-recs]` with one row `[data-oa-rec="<id>"]` per named record: what it is (`Rule` for knowledge with its statement, `Goal` with its title, each a link to its drawer), then either its done state (`[data-oa-done]`, a `good` badge, no button) or its controls, then its own error line. Controls are `button[data-oa-know="<id>"][data-status="retired|accepted"]` and `button[data-oa-goal="<id>"]`.
   - `data-oa-know` posts exactly what the Knowledge page posts, `{ action: 'knowledge', body: { id, status } }`, through `press('k:<id>', …)` with an overlay that sets that entry's status in `ooda.knowledge` (so the row shows done at once) and agrees once the raw data no longer has it at its old status. Its `apply` disables the button ("Retiring…" / "Saving…"); it never removes the card. On success the record's cached peek is dropped and fetched again, so a record that leaves the data (retired) reads its new status.
   - `data-oa-goal` posts exactly what the hold bar posts, `{ action: 'goal-decide', body: { id, verdict: 'let-go' } }`, through `press('g:<id>', { overlay: holdOverlay(id, 'let-go'), … })`.
   - A refusal writes `Not saved: <reason>` into the row's error line (`press()`'s transient line, as on the Knowledge page).
4. **Done and Can't right now, always.** For an owner-action without secrets, `choicesOf()` returns exactly Done / Can't right now: the `recommendation` is never unshifted as a choice, and a question's own `choices` / `options` never replace the two. `needsWhich()` is false for owner-action (there is no recommended choice to ask about).
   - The recommendation is shown as a line of text, `[data-oa-suggest]`: "Suggested: <recommendation>". A question's own `choices` / `options` labels, if any, are shown in the same way as text ("Ways to do it: a; b"), never as buttons.
5. **Done waits for the act.** Pressing Send with Done picked, while one or more named records are not done (state 2), posts nothing: beside each such record's row the card shows `not done yet` (`[data-oa-notdone]`), kept in page memory (`NOT_DONE`, question id → ids) so a redraw keeps it, until the next Send press on that question or the record is done (a done row draws no such mark). A record still loading ("checking…") counts as not done. Can't right now, or words with no pick, post as today; a card naming no records posts Done as today.

## Acceptance checks (the done-whens)

All in a new `test/dashboard-owner-action.test.mjs`, real headless Chrome through `test/lib/chrome.mjs`'s `openChrome` over a real dashboard (`dashboardOnFreePort`) on a `bareProject` (skipped without `canDrive`), its own hub port and port base, `CLAUDE_CONFIG_DIR` / `CODEX_HOME` in its temp dir. Posts go to the real server (no stub), recorded by a fetch wrapper (`window.__posts`); the 10 s refresh at 300 ms.

Records made with the real CLI: an accepted lesson `KA` (supervisor, `knowledge add`, then `knowledge set --status accepted`), a lesson `KR` retired before the ask, an owner lesson `KO` (candidate, `--for-owner`), a goal `G`, a goal `GL` let go before the ask (`goal decide let-go --owner` as the owner). One owner-action question `Q` with `--recommendation "Do all three"`, `--evidence KA KR GL`, and `KO`, `G` written in its `--context`.

1. **Controls post the pages' own actions.** `Q`'s card has a row per named record. `KA`'s row has `Retire it` (`[data-oa-know][data-status="retired"]`); `KO`'s has `Keep it` and `Retire it`; `G`'s has `Let go`. Pressing `KA`'s `Retire it` records a POST to `/api/knowledge` whose body is `{ id: KA, status: 'retired' }`, the body the Knowledge drawer's `Retire it` posts (the positive control: the test presses that drawer's `Retire it` for a second accepted lesson `KB` and sees `{ id: KB, status: 'retired' }`); the server applies it (the CLI's `knowledge` list shows `KA` retired); the row then shows `Retired` with no button, still after polls (the record has left `ooda.knowledge`, so this reads the peek). Pressing `G`'s `Let go` once shows `Confirm let go` and posts nothing; pressing again records `/api/goal-decide` with `{ id: G, verdict: 'let-go' }`, the hold bar's body, and the row shows `Let go` done.
2. **Done and Can't right now; Done waits.** Before any press, the card's answer radios are exactly `Done` and `Can’t right now`; no radio or button carries "Do all three"; `[data-oa-suggest]` reads `Suggested: Do all three`. Picking Done and pressing Send while `KO` is still a candidate records no `/api/answer`, and `KO`'s row shows `not done yet` (still after a redraw); the rows already done show none. After `KO` is kept (its `Keep it`), Done and Send post `/api/answer` with `answer: 'Done'`.
3. **Already done shows done.** From the first render, `KR`'s row shows `Retired` and `GL`'s `Let go`, each `[data-oa-done]` with no button in the row.

`test/dashboard.test.mjs` and `test/dashboard-answers.test.mjs` are not changed; any owner-action fixture there keeps passing (checked by reading them: none relies on a recommendation being an owner-action choice; confirmed in the plan).

## Contracts

None provided. Consumed, unchanged: `/api/data` (`questions[].evidence|blocks|goal|context|asked_at|recommendation`, `ooda.knowledge[]`, `ooda.goals[]`), `/api/peek?kind=lesson` (`record.fields.status`, `record.set_by.status.at`), `/api/knowledge`, `/api/goal-decide`, `/api/answer`.

## Edge cases

- A named goal is the question's own `goal`: the server drops a let-go goal's questions from the Inbox, and `holdOverlay` does too, so the card leaves; that is the server's rule, unchanged.
- The same record named twice (evidence and context): one row.
- An id in the context that isn't a known record (a typo, a record pruned): "no such record", no control; it doesn't block Done (nothing the owner can do on the card). A peek that fails transiently: "checking…", counted as not done; it retries on the next refresh.
- Two copies (Inbox and thread): both draw the rows from the same state; button presses use keys per record (`k:<id>`, `g:<id>`), so a press on either is one post; error lines are per copy (`e-<pre>oa-<qid>-<rid>`).
- A knowledge press the server refuses: the overlay is undone, the button comes back, `Not saved: …` in the row.
- An owner-action with secrets: unchanged (no rows; Post / Reply / Can't).
- A moved link (`links_moved`, kit-82): Send stays disabled; the record controls stay live (they change the records, not the answer).

## Out of scope

- The server: no `refs` field on questions, no change to `ask` (the supervisor's own lesson `k-20261115-072713887` already says no `--recommendation` on owner-action).
- Controls for other record kinds (tickets, sensors, problems).
- Applying the act from the answer text.

## Rulings

- `m-20261115-074646713-supervisor`: trial `a-20261115-074130886`: spec and plan first, one combined review (`reviews/spec-1.md`, `reviews/plan-1.md`) from one fresh session, then ask approve-spec and approve-plan together. Keep the running-text width rule in mind (it cites `k-20261114-214208399`, which the owner replaced with `k-20261114-214823656`: running text no wider than half the 12-column grid; the new rows are short lines on a card, which already sits in the grid). Attach light and dark screenshots at phone and desktop widths before the final review.
