# Task review: Task 5 "Every row and card opens its record"

- Reviewer: task-5-reviewer (fresh subagent, claude-opus-5-5)
- Range: 31e887e0..69a46cb1
- Verdict: CHANGES

I read the diff, spec §2.5 and §5, the brief and the report, then checked each named risk once against the page source and the test. I ran no tests, so the report's runs are unverified by me. The index.html hunks are at ~441-472, ~1824 onward and ~2283 onward, all outside `devteam-layout` (46-206) and `devteam-shell-js` (1090-1362). hub.html has no diff. Only index.html and test/dashboard-peek.test.mjs changed, and both are in touches. The fixture is unchanged.

## Checks

- **Inner controls.** The `[data-open]` click handler (index.html:5042) now excludes `summary, details`, so a click anywhere inside the open `.pop` is the menu's own. Copy ID and Open in side peek are `button`s, which were already excluded. The removed `[data-ticket]` branch was the only consumer of `data-ticket` as a navigation hook (`data-ticket` is now drawn only at index.html:1901). Without that removal, a click on the ⋯ of a ticket card would have navigated. The test covers the summary on a ticket card and a goal card, Let go, and a link to another record.
- **Enter.** The one handler (index.html:1699) acts only when `e.target` matches `[data-open][tabindex]`. Enter on a focused link or `summary` inside a card keeps its native action, and the card does not open. Ticket, incident and goal cards get `role=button tabindex=0`. Progress rows get `role=link tabindex=0`.
- **Loop and Sensors cards with no Enter.** §2.5 ties `tabindex=0, role=button` to the cards it adds (ticket, incident, goal). AC6 names ticket cards and Progress rows. Loop cards stay reachable by keyboard through their record link and their ⋯. I accept this reading and raise no finding.
- **One ⋯ per card.** The goal card keeps only its `cardHead` menu, which gains `open`. `cardMenu` goes only on cards with no `cardHead`. The feed cards put Correct and the menu in `.card-side`, grid column 2, so the 2-column `.feed .card` grid is not disturbed. The observe, orient and lesson containers are not `.feed`, so the float applies there.
- **No Open link.** The goal card's `Open` is gone. The test asserts zero `a` reading "Open" in every `[data-open]` card and in every `.card.goal`.
- **Copy ID.** Every `cardMenu(kind, id)` copies the raw record id. For decisions, the id in the `open` hash is always `r.id` (index.html:3424), so the menu kind and id match the card's own peek.
- **Looks.** The `button.tcard` rules are re-keyed to `.tcard:not(.inert)`, as the controller ruled.
  - Specificity goes from (0,1,1) to (0,2,0), so the re-keyed rules still beat `.tcard` and `.tcard.blocked`.
  - The `box-sizing: border-box` added to the first rule reproduces the UA box-sizing a button had.
  - The global `button` rule (index.html:348) set only properties that `button.tcard` or `.tcard` already overrode, so the div loses nothing.
  - The test's literals are right: padding `8px 10px` and border-radius `6px` come from `.tcard` (index.html:475), and the rest come from the old `button.tcard` rule.
- **dbTable fixture.** The fixture never calls `bindDbTable` itself. Its `h2` starts as `kit-1`, and the test removes `peek-open` first. So `kit-2` and `kit-10` together with `peek-open` can only come from the test's `onOpen`. The check is real.
- **peekFor.** It is asserted against `peekHashes` for all 20 `OPENERS()` keys and opened through `route()` (`DRAWER.kind === k`). The file literal is asserted as Q3 requires.
- **Navigation budget.** Every navigation in the new test goes through `on()`, which checks `__navn` against the budget first, or follows one.
- **The button-to-div change.** It leaves one existing check vacuous (F1).

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | spec §5 (peek inside a peek), AC4 | test/dashboard-peek.test.mjs:946 | The "no permanent action" test clicks a card inside each peek to check that the peek moves and nothing is written. It finds that card with `#drawer-body :is(button, input, select, textarea, form):is([data-ticket], [data-open])`. After this commit, no `button` (nor input/select/textarea/form) carries `data-ticket` or `data-open` anywhere on the page: the goal peek's ticket cards (index.html:4044 → 1901) are now `div`s. So `nav` is `null` for every kind, and `if (nav !== null)` passes silently. The report admits this. Failure scenario: a later change makes a ticket card inside a goal peek write, or stop opening its ticket. No test sees it, because the new 'rows and cards' test clicks cards only on pages and never inside a drawer. Fix: select `#drawer-body :is(${NAV})`, and assert that at least one kind (the goal peek) found a card to click. | fixed 5c879df: NAV cards inside #drawer-body clicked per kind, peek moves, no writes, goal kind asserted |
| F2 | Minor | spec §2.5 (title opens it) | index.html:3386, 3431, 4175 | On act, decision and sensor-feed observation cards, the link to the card's own record is the timestamp in `.meta`, not the title (`act-head`). The test's `title` check (test/dashboard-peek.test.mjs:537) accepts any `a[href]` equal to the card's own hash, so it cannot tell a title link from any other self-link. Report item 7 states the deviation. Each card still opens on a click, on Open in side peek and on that link. | fixed 5c879df: titled() makes the title the own-record link on act, decision, sensor-feed, Observe and lesson cards; test requires a.title-link |
| F3 | Minor | spec §2.5 (focus, `tabindex=0`) | index.html:331-332 | The goal cards are newly focusable (`role=button tabindex=0`) but have no `:focus-visible` rule. `.tcard` (index.html:460) and `.row[data-open]` (index.html:472) do. The goal card falls back to the UA focus ring, which does not match the page's blue ring. | fixed 5c879df: .card[data-open]:focus-visible ring as .tcard |

Verdict: CHANGES 69a46cb12899be00c50239c0da66f6bb69249808
