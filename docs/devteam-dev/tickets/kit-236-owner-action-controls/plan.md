# kit-236 plan: owner-action cards carry the named records' own controls

## TL;DR

- One product file, `docs/devteam/dashboard/index.html`; one new test, `test/dashboard-owner-action.test.mjs` (both in `touches`).
- T1 writes the whole test first, red against main (the spec's three checks, over the real server; posts recorded, not stubbed).
- T2: Done / Can't right now always on an owner-action; the recommendation and any choices become a text line; no "which choice" ask.
- T3: the named records (`oaRecords`, `oaState`), their rows on the card, and the `data-oa-know` / `data-oa-goal` controls posting the Knowledge and hold-bar bodies.
- T4: Done waits: `NOT_DONE` page memory, `not done yet` beside each open record, no post.
- Gates: only the touched test files, one at a time, `--test-concurrency=2`, through `devteam.mjs gate test`; CI is the gate (`gate ci -- <real command>`).
- Screenshots in light and dark, phone and desktop, before the final review (ruling m-20261115-074646713).

## Files

- `docs/devteam/dashboard/index.html` (changed: `choicesOf`, `needsWhich`, `questionCard`, the click handler, new helpers next to `choicesOf`, a few CSS lines for `.oa-recs`).
- `test/dashboard-owner-action.test.mjs` (new).
- Records under `docs/devteam-dev/tickets/kit-236-owner-action-controls/` (spec, plan, reviews, verification, screenshots and their `shoot.mjs`).

## T1: the test, red

`test/dashboard-owner-action.test.mjs`, modelled on `test/dashboard-answers.test.mjs` (its own init script: 10 s refresh at 300 ms, `__polls`, a fetch wrapper pushing every POST to `/api/` onto `window.__posts`, no stub; its own `soonIn`). Ports `PORTS + 44` (hub) and `PORTS + 45` (base): free in `test/` at the time of writing (`grep -ho "PORTS + [0-9]*" test`); re-checked after merging main.

Setup with the real CLI in a `bareProject` (role per command as the kit requires; checked as the test is written):
- `KA`, `KB`: `knowledge add --kind fact --statement …` (supervisor), then `knowledge set <id> --status accepted`.
- `KR`: added, then `knowledge set <id> --status retired`.
- `KO`: `knowledge add … --for-owner --plain …` (a candidate waiting for the owner).
- `G`, `GL`: `goal add` (as in `test/approvals.test.mjs`); `GL` let go with `goal decide <GL> let-go --owner` (or the owner role the command wants).
- `Q`: `ask --kind owner-action --question 'Please tidy three records' --context '… <KO> … <G> …' --recommendation 'Do all three' --evidence <KA> <KR> <GL>` (supervisor). If `ask` refuses any of these flags on an owner-action, the plan stops and asks (no server change is in scope).

Subtests, in order (each the spec's check):
1. *already done* (check 3): rows for `KR` and `GL` have `[data-oa-done]` reading `Retired` / `Let go` and no `button`.
2. *answers* (check 2, first half): radios `input[data-pick]` values are exactly `['Done', 'Can’t right now']`; no element in the card whose text is `Do all three` is a `button`, `input` or `label.choice`; `[data-oa-suggest]` text is `Suggested: Do all three`.
3. *Done waits* (check 2): pick Done, press `[data-answer]`; after a poll, no `/api/answer` in `__posts`; `[data-oa-rec="<KO>"] [data-oa-notdone]` reads `not done yet`; also on `KA` and `G` (not done yet), and on none of `KR`, `GL`; still there after `redrawNow()`.
4. *controls* (check 1): `KA` Retire it → `/api/knowledge` body `{ id: KA, status: 'retired' }`; row shows `Retired` (`[data-oa-done]`), and still after 3 polls (now from the peek); the CLI (`knowledge --status retired` or `knowledge show`) has `KA` retired. Positive control: open `#lesson/<KB>`, press the drawer's `[data-know="<KB>"][data-status="retired"]`, the recorded body is `{ id: KB, status: 'retired' }` (same keys and shape). `G` Let go: first press → button text `Confirm let go`, no `/api/goal-decide` posted; second → `/api/goal-decide` body `{ id: G, verdict: 'let-go' }`; row shows `Let go` done. `KO` Keep it → `/api/knowledge` `{ id: KO, status: 'accepted' }`; row `Kept`.
5. *Done goes through* (check 2, last): every row done; pick Done, Send → `/api/answer` with `answer: 'Done'`; the card leaves the Inbox.

Run it against main's dashboard first: subtests 1–5 fail (no rows), the setup passes. Commit: `kit-236: the owner-action card test (red)`.

## T2: Done and Can't right now, always

- `choicesOf(q)`: `const oa = q.kind === 'owner-action' && !(q.secrets || []).length;` If `oa`: return the two fixed choices, none `rec` (the recommendation and `q.choices` / `q.options` are not choices). Everything else unchanged.
- `needsWhich(q)`: false when `q.kind === 'owner-action'`.
- `oaSuggest(q)`: `[data-oa-suggest]` `<p class="meta">` "Suggested: <rec>" (escaped), and, when the question has its own choices/options, a second line `Ways to do it: a; b`. Drawn in `questionCard` just before the choices, for `oa` only.
- Run T1's file: subtest 2 passes.

## T3: the named records and their controls

Helpers beside `choicesOf`:
- `const K_ID = /\bk-\d{8}-\d{9}-[a-z0-9-]+/g`, `G_ID` likewise; `oaRecords(q)` as spec §1 (trailing punctuation is excluded by the character class; a trailing `-` is trimmed).
- `oaState(q, id)` → `{ kind: 'knowledge'|'goal', label, title, done: null|'Retired'|'Kept'|'Let go', missing, loading, owner }` as spec §2. The status-set time of a knowledge entry in the data: the last `updates[]` entry with a `status`, else `created_at`; from a peek: `record.set_by?.status?.at ?? record.created_at`.
- `oaRows(q, pre)`: the `[data-oa-recs]` block; each row: `<span class="oa-what">Rule|Goal: <a class="linkish" href="#lesson/…|#goal/…">…</a></span>`, then the done badge (`<span class="badge good" data-oa-done>…</span>`) or the buttons (`ghost`), then `NOT_DONE` mark if set (T4), then `<span class="err" id="e-${pre}oa-${qid}-${rid}">`.
- `questionCard`: `${oa ? oaSuggest(q) + oaRows(q, pre) : ''}` after the links and before the choices.
- Click handler, before the `[data-answer]` branch:
  - `[data-oa-know]`: `press('k:<id>', { build: () => ({ action: 'knowledge', body: { id, status } }), overlay: { data: set status on that entry (adding nothing when absent), agrees: raw has no entry with that id at its old status }, apply: disable all `[data-oa-know="<id>"]` buttons with "Retiring…" / "Saving…", onOk: PEEKS.delete(peekKey('lesson', id)) then fetchPeek, errId: `${pre}oa-${qid}-${id}` })`.
  - `[data-oa-goal]`: the same two-press confirm as the hold bar (class `confirm`, text `Confirm let go`, 6 s back to `Let go`); the second press: `press('g:<id>', { build: () => ({ action: 'goal-decide', body: { id, verdict: 'let-go' } }), overlay: holdOverlay(id, 'let-go'), apply: () => { redrawNow(); redraw(); }, errId })`.
- CSS: `.oa-recs` a small list (`display: grid; gap`), each row `display: flex; flex-wrap: wrap; gap; align-items: baseline`, so it never sticks out on a phone.
- A retired record leaves `ooda.knowledge`; its peek is fetched by `peekOf` during render, which redraws when it lands.
- Run T1's file: subtests 1 and 4 pass.

## T4: Done waits for the act

- `const NOT_DONE = new Map()` (qid → Set of record ids).
- In the `[data-answer]` branch, after the existing validation and before `answerPress`: if the question is `oa` and `picked === 'Done'`, the open records (`oaRecords(qv).filter((r) => { const s = oaState(qv, r); return !s.done && !s.missing; })`) are non-empty → `NOT_DONE.set(id, new Set(open))`, `redrawNow()`, return (no post). Any Send press on that question first clears its entry.
- `oaRows` draws `<span class="err" data-oa-notdone>not done yet</span>` on a row that is in `NOT_DONE.get(qid)` and not done.
- At render, entries for questions no longer open are pruned (as kit-82 does for `REFUSED`).
- Run T1's file: all subtests pass. Then `test/dashboard-answers.test.mjs` and `test/dashboard.test.mjs`, one at a time at `--test-concurrency=2`, through `devteam.mjs gate test`.

## Review records

`reviews/task-<n>.md` per task (a fresh subagent per review, `governance/quality.md` §3), final `reviews/final-1.md` from a reviewer that has not seen the build.

## Risks

- `ask` may refuse `--recommendation` or ids in `--context` on an owner-action, or `goal decide` may need a different role in a bare project: found in T1, adjusted in the test only; a needed server change stops the plan (design-change message).
- A peek per named record not in the data: a handful of spawns, cached; refetched only on success of a press.

## Rulings

- `m-20261115-074646713-supervisor` (as the spec's Rulings).
