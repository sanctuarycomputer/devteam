# kit-82 Implementation Plan

## TL;DR

- One product file, `docs/devteam/dashboard/index.html`; one new test file, `test/dashboard-answers.test.mjs`; one assertion moved in `test/dashboard.test.mjs` (~500).
- Task 1: a refused answer is kept per question in `REFUSED` and drawn on the card (`[data-refused]`, Dismiss) until dismissed, re-pressed, accepted or closed.
- Task 2: a question with `links_moved` says which page changed, first on its card (`[data-links-moved]`), and its Answer and which-choice buttons are disabled.
- `press()` gains `onError`; `answerPress()` gains `{ stays = true }`; `reviewDecline` passes `{ stays: false }` and keeps today's line.
- The new test drives real headless Chrome over a real dashboard, stubbing only `/api/answer` (409) and `/api/data` (`links_moved` on Q2) in the page.
- Tests run here one file at a time at `--test-concurrency=2` with `/usr/local/bin/node` (22); CI is the gate.
- Review cards stay out of scope (known gap, follow-up offered).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a refused answer stays visible on its card until dismissed, and a question whose linked page moved says so and cannot be answered.

**Architecture:** page memory (`REFUSED`, a `Map` beside `drafts`/`picks`) read by `questionCard()` on every render; `links_moved` read straight from the data on every render. No server change.

**Tech Stack:** the dashboard's single-file vanilla JS; `node:test` with `test/lib/chrome.mjs` (DevTools Protocol) and `test/lib/kit.mjs`.

**Spec:** `docs/devteam-dev/tickets/kit-82-answers-stay-visible/spec.md` (approved by spec-2 at 2946a14).

## Global Constraints

- Refusal line text: `Not saved: <reason>` (reason = what `press()` computes today: `[out.error, out.out].filter(Boolean).join(' · ')`, or `the server answered <status>`, or `could not send: …`).
- Moved-link text: `<titles> changed since this was asked; the supervisor will ask again`; gone-only: `<titles> is no longer available; the supervisor will ask again`; no flagged pinned link: `q.links_moved` as sent.
- Pinned: `l.artifact !== undefined && l.sha256` (server's `pinnedArtifact`). Titles escaped with `esc`.
- Every file changed is in the ticket's touches.
- Tests on this box: one file at a time, `--test-concurrency=2`, Node 22 (`/usr/local/bin/node`); never the full suite.

## Review Focus

1. The same question drawn twice (Inbox and a thread card): both show the refusal; Dismiss on either clears both. The thread copy is rebuilt by `tlCardBody` only when its signature (`sig`, index.html ~4729) changes and focus is not inside its turns, so Task 1 adds `REFUSED.get(q.id)?.n ?? null` and Task 2 adds the data's `links_moved` (`(DATA?.questions || []).find((x) => x.id === q.id)?.links_moved ?? null`: the thread view's own question copy, from `threadQuestion`, never carries it) to each question's entry in that signature, and Dismiss also removes every `[data-refused="<id>"]` node directly (a focused Dismiss inside the turns would block the rebuild). Covered by code review only: the test opens no thread.
2. A refusal followed by a successful answer: no stale line when the card comes back (onOk deletes). Covered by Task 1's code; the existing dashboard.test.mjs "an answer" subtest exercises the ok path.
3. A refused review send-back: `#e-rv` still shows `Not saved:` (unchanged path). Pinned by code review: `reviewDecline` passes `{ stays: false }`.
4. Shift+Enter on a moved-link card: posts nothing (disabled button ignores `click()`). Task 2 test.
5. A reason with HTML in it: escaped. Task 1's stub reason includes `<b>x</b>` and the test asserts the text contains it literally.

## Rulings

- approve-spec at dd09e1d (`m-20261115-065510452-supervisor`), which asks to keep the owner's running-text width rule for visible copy. The rule it cites (k-20261114-214208399) was replaced by k-20261114-214823656: running text no wider than half the 12-column grid at full desktop width, no ch cap. Both new lines (`[data-refused]`, `[data-links-moved]`) sit inside `.qcard`, already capped at `max-width: var(--measure)` (index.html ~230); neither adds its own width.
- approve-plan at 7180f49 (`m-20261115-070641604-supervisor`): before the final review, attach dashboard screenshots in light and dark, at phone and desktop widths, of a refused answer staying visible on its card. They go in `screenshots/` in this folder, taken with headless Chrome over the same stubbed refusal as the test, and are named in verification.md.
- From spec-2: the refusal line's Dismiss is the card's only Dismiss (F2); the test names Q1 (choices, refused) and Q2 (links_moved) by id (F3); review cards with moved links are a known gap, out of scope, follow-up offered in the merge request (F1).

---

### Task 1: A refused answer stays on its card

**Files:**
- Modify: `docs/devteam/dashboard/index.html` — `press()` (~3799), `answerPress()` (~3881), `questionCard()` (~1294, the row at ~1336), `reviewDecline()` (~1963), `render()` (~4096, prune), `tlCardBody()`'s `sig` (~4729, add `REFUSED.get(q.id)?.n ?? null`), the click handler (~5520-5660, Dismiss)
- Modify: `test/dashboard.test.mjs:500`
- Create: `test/dashboard-answers.test.mjs`

**Interfaces:**
- Produces: `const REFUSED = new Map()` (question id → `{ reason: string, n: number }`, `n` from a page-wide `let REFUSALS = 0` counter, `++REFUSALS` per refusal, so a second refusal with the same reason still changes the thread card's signature); `press(key, { …, onError })` where `onError(error: string)` runs after `undo` and before `redrawNow()`, and when given `press()` skips writing `#e-<errId>`; `answerPress(id, card, errId, text, build, { stays = true } = {})`; DOM `<p class="err refused" data-refused="<id>">Not saved: <reason> <button class="ghost" data-dismiss-refused="<id>">Dismiss</button></p>` drawn just before the card's `.row-inline`.
- Produces for Task 2: the test file's setup (`setup()` returning `{ p, soon, polls, Q1, Q2, dt }`; `soon` is the file's own copy of dashboard.test.mjs's file-local `soonIn`, and `polls` its own, never imported) and the init script with the `/api/data` rewrite hook `window.__moved` (Q2's id; Task 2 fills the rewrite).

- [ ] **Step 1: Write the failing test** `test/dashboard-answers.test.mjs`, one top-level `test('answers: a refusal stays on its card, and a moved link disables Answer', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, …)` with subtests. Setup as the presses test (dashboard.test.mjs ~431-455): temp base, env with `DEVTEAM_HUB_PORT: PORTS + 58`, `DEVTEAM_PORT_BASE: PORTS + 59`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, role vars deleted; `bareProject(base, 'answers')`; `Q1 = ask --question 'Ship it?' --choices '[{"label":"Yes"},{"label":"No"}]'`, `Q2 = ask --question 'Which colour?' --choices '[{"label":"Red"},{"label":"Blue"}]'`; `dashboardOnFreePort`; `openChrome`; init script, in this order inside one IIFE: `setInterval` 10000 → 300; `__polls`; layer 1 (stub): `/api/answer` POST → `new Response(JSON.stringify({ error: 'the mock <b>moved</b>' }), { status: 409, headers: { 'content-type': 'application/json' } })`; `/api/data` → when `window.__rewrite` is set and `r.ok`, `new Response(JSON.stringify(window.__rewrite(await r.json())), { status: r.status, statusText: r.statusText, headers: r.headers })` (keeping the `x-devteam-*` headers `loadNow` reads), else `r` as it came; layer 2 (recorder): POSTs to `/api/` pushed to `window.__posts`. Subtest "refused":
  - pick `No` on Q1, type `not this week` in its note, click its `[data-answer]` (no `__still`/`__quiet` guard is needed: Q1 stays first, Q2's rewrite applies from the first read, and a pointerdown holds draws until release, so a poll never moves what is clicked; don't add sleeps if it flakes, find the move);
  - `soon` `__posts.some(x => x.url === '/api/answer' && JSON.parse(x.body).id === Q1)`;
  - `soon` the Q1 card's `[data-refused]` textContent matches `/^Not saved: the mock <b>moved<\/b>/`;
  - `redrawNow()` ×3 then the line is still there; blur the note (`document.activeElement.blur()`), tag the card (`card.__old = 1`), `polls(3)`, `soon` the card has no `__old` and the line is still there;
  - the `No` radio is checked and the note's value is `not this week`;
  - click `[data-dismiss-refused]`; the line is gone in every copy; after `polls(2)` still gone.
- [ ] **Step 2: Run it to see it fail** — `/usr/local/bin/node --test --test-concurrency=2 test/dashboard-answers.test.mjs`; expected FAIL waiting for `[data-refused]`.
- [ ] **Step 3: Implement** in index.html: `REFUSED` beside `ANSWERED`; `press()`'s `onError`; `answerPress()` sets `REFUSED.delete(id)` in `apply`, `REFUSED.delete(id)` in `onOk`, `onError: (e) => REFUSED.set(id, { reason: e, n: ++REFUSALS })` unless `stays === false`; `reviewDecline` passes `{ stays: false }`; `questionCard()` draws the line (escaped) when `REFUSED.has(q.id)`; `render()` prunes an id once it is in neither `d.questions` nor an open question of `TL.threads` (the rule `ANSWERED`'s prune at ~4114 uses); the click handler's `[data-dismiss-refused]` deletes, removes every `[data-refused="<id>"]` node, and calls `redrawNow()`; `tlCardBody`'s `sig` gains `REFUSED.get(q.id)?.n ?? null` per question. CSS: `.refused` margin only (reuses `.err`).
- [ ] **Step 4: Move dashboard.test.mjs:500** to `soon(\`/Not saved:/.test(${card(Q2)}?.querySelector('[data-refused]')?.textContent ?? '')\`, 'the refusal, on the card')`.
- [ ] **Step 5: Run both files**, one at a time: `gate test -- /usr/local/bin/node --test --test-concurrency=2 test/dashboard-answers.test.mjs`, then the same for `test/dashboard.test.mjs`; expected PASS.
- [ ] **Step 6: Commit** `kit-82: task 1: a refused answer stays on its card`.

### Task 2: A moved link shows first and disables Answer

**Files:**
- Modify: `docs/devteam/dashboard/index.html` — `questionCard()` (head line, `[data-answer]`), `whichAsk()` (~1238, its buttons), `tlCardBody()`'s `sig` (~4729, add the data's `links_moved`, looked up by id in `DATA.questions`)
- Modify: `test/dashboard-answers.test.mjs`

**Interfaces:**
- Consumes: Task 1's setup and `__rewrite` hook.
- Produces: `movedLine(q): string` (empty when `!q.links_moved`) drawn as `<p class="moved" data-links-moved>…</p>` straight after `cardHead(...)`; `[data-answer]` and `button[data-which]` get `disabled title="<sentence>"` when `q.links_moved`.

- [ ] **Step 1: Write the failing subtest** "a moved link": before navigation the init script's `__rewrite` sets, on the question whose id is `window.__moved` (set to Q2 via the init script source), `links_moved: '<Q2> links the artifact moving, which changed since it was asked; ask again about the page as it is now'` and `links: [{ name: 'moving', artifact: 'moving', title: 'The moving mock', sha256: 'a'.repeat(64), at: 'main', href: '#artifact/main/moving', changed: true }]`. Assertions on Q2's card:
  - `card.querySelector('.card-head').nextElementSibling` has `data-links-moved` and textContent `The moving mock changed since this was asked; the supervisor will ask again`;
  - `[data-answer]` is `disabled`;
  - click the note, type `later`, value is `later`;
  - count `__posts` for `/api/answer` with id Q2 (0), press Shift+Enter in the note (`p.key('Enter', 8)`), `polls(1)`, count still 0;
  - Q1's `[data-answer]` is not disabled (positive control on the same page).
- [ ] **Step 2: Run, see it fail** (no `[data-links-moved]`).
- [ ] **Step 3: Implement** `movedLine(q)` per Global Constraints (pinned filter, changed titles joined `, `, else gone titles, else `q.links_moved`), place it after `cardHead`, disable `[data-answer]`; `whichAsk(q, list)` reads `q.links_moved` itself and draws its `button[data-which]` disabled with the same title, so both its callers (`questionCard` ~1335 and the click handler's insert ~5620) agree; `tlCardBody`'s `sig` gains `(DATA?.questions || []).find((x) => x.id === q.id)?.links_moved ?? null` (the same lookup `tlQuestion` uses; `t.questions` never carries it).
- [ ] **Step 4: Run** `gate test -- /usr/local/bin/node --test --test-concurrency=2 test/dashboard-answers.test.mjs`; PASS. Re-run `test/dashboard.test.mjs` once.
- [ ] **Step 5: Commit** `kit-82: task 2: a moved link shows first and disables Answer`.

## Out of scope

- Review cards (`reviewCard`, the review panel): the server refuses a moved-link answer on them too, but a review pins its page through `review.page`, so a pinned `links` entry is rare. Known gap; a follow-up is offered in the merge request.
- The other test files in touches: not expected to change.
