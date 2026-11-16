# kit-88 verification

## Rulings

- `m-20261115-201807510-supervisor`: approve-spec and approve-plan at 2b72bbb. Build once kit-87 has merged.
- `m-20261116-114038672-supervisor` / `m-20261116-114044055-supervisor`: dependencies kit-87 (a1cb222) and kit-244 (b2f3be0) are in; main was merged at a9fcc43 (main 7cae923) before the correction that kit-174 had not landed yet. Build proceeds on that base; main is merged again once the supervisor confirms kit-174 is in.
- `m-20261116-120336185-supervisor`: kit-174 merged; main merged again at e885935.
- `m-20261116-122746609-supervisor`: `test/dashboard-shell.test.mjs` and `test/dashboard-pages.test.mjs` added to touches. The shell test's no-shell list drops `drawer` and `scrim`; the pages test's `peekOver` waits for the drawer's own end state.
- `m-20261116-173310948-supervisor`: `test/next-step.strategy.test.mjs` added to touches; one wait at :265 only (kit-246 fixes a different race there and merges after kit-88).
- `m-20261115-195457593-supervisor`: `test/dashboard-owner-action.test.mjs` in touches; the peek's Retire it starts a thread and posts nothing, beside the moved positive control (KP on the Inbox).

## Departures from the spec (worker's rulings, each in the build ledger and a task review)

- **Milestone and wave IDs** keep today's routing keys (`<goal>:<n>`, `<n>`), not §2.2's `<goal>/M<n>` and `<feature>/wave-<n>`: waves span features, and Copy ID copies what routes. (task-2)
- **"May correct" a decision** means its row is one the Decide tab draws (the shared `DECIDE_SHOWN`, 80), so "Correct, on its row" always lands on a row with a Correct. Spec §2.2 says "today's `mine`"; every row is the supervisor's, so `mine` means "has a row". (task-2 F1)
- **The Inbox mirror `#tt-peek`** hides at 840px and below, not 760px: between 761 and 840px it would be clipped by the 720px peek. The done-when's "hidden below 760px" still holds. (task-1 F1)
- **The measure's peek entries** point `view` at `#no-such-view`, as kit-87's page entries do (`test/dashboard-measure.test.mjs:24`): the pages under the peek are not converted yet and fail page-top below 900px on kit-87's nav row. Spec §2.6 has page-top judge the page under the peek; every other check runs on every peek at all three sizes. (task-6)
- **Decision "What it cites"**: the design's inventory lists it, but today's `openDecision` never drew it; §2.4 keeps what today draws, so it is asserted on acts only. (task-4)
- **Ticket Links**: the row came out empty with real data before kit-88 (the shared formatter only knew a question's link objects); a ticket-only formatter shows the link ids. (task-4-2)
- **Beyond the brief, kept**: a closing peek lets clicks through (`pointer-events: none` when not `peek-open`); peekHide asks `getAnimations()` at once and keeps a safety net at `--dur` + 1000ms, fixing a race where the drawer vanished mid-slide under load; a focused property key keeps its focus across the 10-second redraw; titles are the own-record link on act, decision, sensor-feed, Observe and lesson cards.

## Done-when

Local runs: Node 22 (`/usr/local/bin/node`), each file alone at `--test-concurrency=2` through `devteam.mjs gate`, judged by exit code. Subtest names are from `test/dashboard-peek.test.mjs`.

| # | Done-when | Evidence | Result |
|---|---|---|---|
| 1 | Opening a peek moves its transform from off-screen to 0 over --dur with --ease, closing reverses it before it hides; under reduced motion nothing transitions | "it slides in and out on the shell frame" (running CSSTransition: transform, 280ms, `cubic-bezier(0.32, 0.72, 0, 1)`; slide-out `transitionrun` while shown, then hidden); "reduced motion: nothing slides, and close hides at once"; "reopen during close stays open"; "a redraw does not re-slide"; "a scrim click and Escape close the peek"; "a slide out that sends neither end nor cancel still hides" | pass |
| 2 | The peek's header and the page bar are each --bar-h tall with bottom borders level; × at the header's right edge; the top-right button left of the peek (hidden below 760px) | "the header and the page bar are level; the × is --panel-pad in"; "a long title stays on one line in the header"; "the top-right button stays reachable beside the peek" (1440x900 left of the peek, above the scrim, mirrors `.tt` and its click; 800x800 and 720x800 not rendered) | pass |
| 3 | Every peek's header shows its type's icon (TYPE_META) before the type chip | "the header names the kind: its icon, then its type chip" | pass |
| 4 | Every peek kind starts with a properties table: ID first, a tooltip on every key, keys in mono, no rule above the first row, How it changes, History at the bottom; only the allowed writes; settled questions read-only; an open question opens the Inbox at its card | "the fixture draws every kind"; "properties first"; "every opener label has a tip in KEY_TIPS"; "may correct: only a call whose row the Decide tab draws"; "How it changes from the record, and past the Answered list"; "notFound and loading keep the frame"; "no permanent action" (stubbed fetch, every control clicked, allow-list); "an answered card is anchored once" | pass |
| 5 | Every peek keeps every detail and widget today's opener renders (one assertion per inventory item); Retire it opens a thread; Overrule on the Inbox's Answered card | "every detail stays: the peek inventory, item by item" (263 rows, 10 injected through `PEEKS`/`DATA` with a why each); "no permanent action"; `test/dashboard-owner-action.test.mjs` (Inbox Retire it posts `{ id: KP, status: 'retired' }`; the lesson peek's Retire it drafts `lesson:<id>` and posts nothing) | pass |
| 6 | On the shell fixture a click or Enter on a dbTable row opens its peek; on today's pages a click or Enter on a ticket card or a Progress row opens its peek; a card's title opens it, and Open in side peek in its ⋯ menu, which also has Copy ID; no card has an Open link | "rows and cards: a dbTable row opens its record on the shell fixture"; "Board: a ticket card opens on a click and on Enter"; "Progress: a row opens on a click and on Enter"; "every record card: one ⋯ …"; "a card opens on its title, on Open in side peek, and on a click on itself"; "Copy ID copies the id; copy refused says Select and copy"; "inner controls keep their click"; "peekFor: every opener kind's hash, opened through route()" | pass |
| 7 | The peek's scrim is --backdrop with a 4px backdrop blur | "the scrim is the block's backdrop" (`rgba(0, 0, 0, 0.7)`, `blur(4px)`); "the shared scrim …"; "a preview over the scrim …" | pass |
| 8 | test/dashboard-measure.test.mjs passes with one peek of each kind at 1440x900, 720x800 and 390x844 on every check | `PEEKS_MEASURED`: all 20 `OPENERS()` kinds, a second dashboard on a `peekFixture` project, ready after the slide (see Departures for `view`) | pass, 2/2 |

## Gate runs

| File | Command | Result |
|---|---|---|
| test/dashboard-peek.test.mjs | `devteam.mjs gate peek -- timeout 840 /usr/local/bin/node --test --test-concurrency=2 test/dashboard-peek.test.mjs` at b653a63 (main merged) | exit 0: pass 37, fail 0, skipped 0 |
| test/dashboard-shell.test.mjs | `gate shell -- …` at b653a63 | exit 0: pass 16 |
| test/fleet-park.test.mjs | `gate fleet-park -- …` at b653a63 (main changed it) | exit 0: pass 4 |
| test/dashboard-measure.test.mjs | `gate measure -- …` at 4f4c8f1 | exit 0: pass 2 |
| test/dashboard.test.mjs | `gate -- …` at 157b0ba | exit 0: pass 157 |
| test/dashboard-pages.test.mjs | at 5c879df | exit 0: pass 6 |
| test/dashboard-owner-action.test.mjs | at b6dc408 | exit 0: pass 6 |
| test/gateway, multirepo-views, ooda-learning, ooda-lineage, plain-questions, fleet-park, multirepo-landing, kit (imports test/lib/chain.mjs; its route-order pin holds) | at 157b0ba, each alone | exit 0: 73, 9, 5, 10, 3, 4, 7, 102; nothing skipped |

`peekFixture` builds in 6–11.5 s (timed in the measure test).

| test/next-step.strategy.test.mjs | `gate next-step -- …` at 1183847 | exit 0: pass 6 |

## CI

| Run | Head | Conclusion |
|---|---|---|
| 43918286200 | d584b55 | failure: `test/next-step.strategy.test.mjs:265` ("timed out waiting for the owner's value", Node 22 and 24) clicked the goal peek's Wrong? mid-slide. Ruling `m-20261116-173310948-supervisor` added the file to touches; the fix is one wait for the drawer at rest before that click (1183847). Every other job green, including dashboard-peek, dashboard-measure, dashboard-shell and dashboard-pages. |
| 43919676315 | 1183847 | success (`gh run view 43919676315 --json conclusion,headSha`) |

Commits after 1183847 change only this ticket's records.
