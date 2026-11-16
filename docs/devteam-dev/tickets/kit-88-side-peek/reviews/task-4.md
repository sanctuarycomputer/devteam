# Task review: Task 4 "Every detail stays"

- Reviewer: task-4-reviewer (fresh subagent, claude-sonnet-5-5)
- Range: a56cf4f9..a1510c74
- Verdict: CHANGES

I read the diff, the design's inventory (line 292 and its sub-list) and the page code for the file, thread and ticket openers. I ran no tests; the report's runs are unverified by me. The only index.html hunk is at ~3604 (outside lines 46-206 and 1077-1349), so neither `devteam-layout` nor `devteam-shell-js` changed. Files are inside touches.

## Checks

- Inventory against the design, bullet by bullet: ticket, goal, feature/story/release/wave/milestone, act/decision, lesson/knowledge, problem/incident, signal...planner, question and sensor each have a row per item. The file bullet does not (F1). "What it cites" is on acts only, per the controller's ruling. "Its class now" is on the decision (the opener that draws it, index.html:4396).
- Thread "opened one marked": `.card.qcard` is exactly what `openThread` gives the opened message, so the row can fail.
- Carried: F5 (past the 80: record, read-only, thread start, no write), N1 (`fromRecord` with the row absent), N2 (no "by undefined", guard at index.html:3613), task-3 N1 (total clicked asserted at least 1; the file's Rendered/Raw and Copy ID make it real) and N2 (list taken once, keyed by `focusKey` plus index) are all present and can fail.
- Injected rows: each patches PEEKS or DATA, redraws and reads in one page turn, so the read is of the page's rendering of the patch, not the patch against itself. Each carries a `why`.
- Determinism: dates are relative to one T0 or fixed strings; `$2.40` is 1.25+0.75+0.40; gate and sample values are arithmetic on the index. No random ids.

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | spec §2.4 (one assertion per inventory item); design line 292, "file" bullet | test/dashboard-peek.test.mjs:688-694 (the `file` rows) | The file bullet lists: sanitized markdown **with its diagrams**; **images**; **sandboxed HTML and PDF with Open in a new tab**; Rendered / Raw **remembered in `devteam.mdview`**. The table has rows for Version, Commits, the view bar, Rendered, Raw, rendered h1 and History only. A peek that dropped the diagram rendering (index.html:3885, 4808), the image branch, the `<iframe sandbox>` plus "Open in a new tab" link (4769) or the stored view (4776, 6961) would pass. Failure scenario: the HTML/PDF viewer is lost in the restyle and the inventory test stays green. The fixture has no html, pdf or image file and no mermaid block, so it needs them (all files committed on main; `peek-mock` is an artifact, not a file route). The inject route is not needed. | fixed 5ce6a97: md with mermaid, png, html, pdf in the fixture; rows for diagram, image, sandboxed html/pdf with Open in a new tab, devteam.mdview kept after reopen and reload |
| F2 | Minor | spec §2.4 | test/dashboard-peek.test.mjs:~640 (`stored:<type>`) | `want` is built by the page's own `storedRows` and compared to the dt list. A field `storedRows` silently drops passes. The per-field `dt:` rows cover ticket, goal, feature, act and decision by name; lesson, problem, question and the incident are only covered through `stored:`. Fix: list the record's own field names in the test (or assert `want` is at least the fields the fixture wrote). | fixed 5ce6a97: literal field rows for lesson, problem, question, incident |
| F3 | Minor | quality §3 (a test must fail on the defect it guards) | test/dashboard-peek.test.mjs:~600 `preconditions with "no plan yet"`, `dt:Preconditions >> ol .badge` | Any badge in the list matches; the item is the words "no plan yet" (index.html:3537). Use `text:no plan yet`. The same for `Your verdicts >> text:Approve`, which a bare button label would also satisfy. | fixed 5ce6a97: exact text no plan yet and the verdict's own element |
| F4 | Minor | spec §2.4 | test/lib/kit.mjs ticket `links`; goal `approved` | Two injected rows look fillable by the kit: `links` needs only a `links` entry in the fixture's `settings.md` (it already edits that file for sensors), and `approved` is a `goal set --approved` after an answered goal-change question. Fixing them would drop two injections and test the real path. Not blocking: spec §2.4 allows injection with a stated reason, and the other ten reasons stand. | fixed 5ce6a97: ticket links and goal approved made through the kit |
| F5 | Minor | plan: the fixture must not slow T6 | test/lib/kit.mjs | The fixture now adds about 15 `dt` spawns, three git branches and 336 sample lines per use (the report says the measure test was not run on it). Not a defect here; T6 should time `peekFixture` once. | |

## Verdict

CHANGES: F1 is an inventory item set (four bullets of the file peek) with no assertion, against the spec's one-per-item rule. F2-F5 are Minor.
