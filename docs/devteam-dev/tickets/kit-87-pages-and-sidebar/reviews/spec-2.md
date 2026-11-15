# Spec review, pass 2

- Reviewer: spec-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: 068abc12314c86d19fcbef85aedb5102a98cdf76 (spec.md; cold confirm of spec-1)

Read: spec-1; the spec diff `bbcb146..068abc1`; the ticket's fields (`ticket show`: done_when 1-6, touches with `test/dashboard-shell.test.mjs`, depends_on `kit-83`, `kit-85`, `kit-86`, `kit-214`); `kit-84`'s `settings_all` and `kit-85`'s allowlist and null done-whens; `shell.md` §4-§6 (the talk/ and q cold homes); the mock at `3cb8d6b` (Settings view l.1333, `SETTINGS_ALL`, `settingsAll()`); today's `index.html` (`fleetSwitch`/`bindFleetSwitch`, `parseHead`/`stampFor`/`closeTarget`, `SHELL_ROUTES`, `route()`, `openQuestion`, `leaveReview`, `showTab`/`devteam.tab`, `tlSection`, `tlHome`, `tlTargetRect`, `tlGoTo`, `tlClose`); `test/dashboard-shell.test.mjs` 380-415; `test/lib/measure.mjs` (`view`, `page-top`). Checked the interim redirects against `parseHead` (exact-key lookup before link detection, so `overview?th=inbox` and `loop/orient` redirect as written; `#governance` falls to Overview), and the new history rules against Back.

spec-1 findings:
- F1 resolved: the test is in touches, `SHELL_ROUTES` is edited in place with interim markers, `route()` keeps its kind text; the listed test changes match lines 381, 404, 410.
- F2 resolved: `main`, `.seg`, `.card`, `.card-head`, `.card.small .card-head`, `.side .foot` fenced; `.main` and `<main class="page">` named; sections stay `<main>`'s children.
- F3 resolved: a state line of the page's own under the switch, with `fleet.reason`.
- F4 resolved: the global `[data-fleet]` branch and `check` go; one request per press asserted.
- F5 resolved: each stepper's pending value, busy and error survive the redraw; acceptance 3 checks it.
- F6 resolved: `q/` for an open question is replaced by `#inbox`; Back test 2e.
- F7 partly resolved: sections, legacy page views, pins and `tlClose` are covered, but the talk/ route's history is left open (F2-1).
- F8 resolved: arriving on Settings calls `loadFleet(true)`; `fetch=1` asserted.
- F9 resolved by rulings `-195734279`, `-195755200`, `-200302629`; one placement left loose (F2-2).
- F10 resolved: a `view` no element has skips `page-top` silently (measure.mjs l.82), as the spec says.
- F11-F16 resolved as dispositioned (history.length +1 and Back; Drain, Run held/running, Park asserted; review cold-closes to `#inbox`; Run without confirm recorded; header lists all four; `devteam.tab` goes).
- F17 resolved: `.main { display: contents }` below 900px, rows ordered.

Values and refusals (`project/strategy.md`): owner-asked UI on the priority-1 goal. W1-W2: no owner questions. W3: fleet state stays visible (state line in the sidebar, the switch and state on Settings below 900px). P5: Save posts `owner-setting` only on an owner click through `kit-85`'s channel, which keeps the refusals; the final review should still try the hub `postMessage` path. R1, R2: not crossed (plain words; the page can only post what the owner presses).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Important | shell.md §6 (talk opens over its thread's subject page); done_when 1 and 2 (Back returns to the previous page); spec-1 F6, F7 | spec §5 "Going to a subject", "Closing a thread card"; acceptance 2f | A `talk/` link clicked on Goals is stamped by `stampFor` with the page it was clicked on (Goals), yet §5 says the card opens over the subject's page, reached by tlGoTo going there "by the router". If that is a page head pushed from inside the talk/ route (the natural reading, as `location.hash = '#board'`), Back from Board lands on the talk/ entry, which pushes `#board` again: the same Back trap spec-1 F6 fixed for `q/`. A reload of the talk/ entry also has a stamp that disagrees with the page shown. And closing by replace, when the card was opened from Board in the visit, leaves Board twice in history. Fix: say that on a talk/ route the entry's stamp page is set to the subject's page (`withPage`, `replaceState`, no new entry) and that page shows under the card; that only tlGoTo from outside a route (the list in the thread layer) pushes the page head; that closing follows `closeTarget` like a peek (Back when opened in the visit, else replace with the subject's page); and extend 2f: clicked on Goals, Back after closing (or Back with the card open) returns to Goals, and a reload reopens it over Board. | |
| F2-2 | Minor | done_when 6 ("lists every entry of settings_all under its group headings as the mock at main shows"); mock 3cb8d6b l.1333-1338 | spec §8 "The two worker limits", "Every setting" | "The two worker limits appear here as their controls (above), not twice" can be read as the controls living in their own block outside the "Fleet and capacity" group, which then lists every entry but those two, against done_when 6 and acceptance 6. The mock draws the stepper in its Fleet section and also lists both keys read-only in the group. The mock's Fleet section also has Memory ceiling and Kit rows, which the spec moves to the group list without saying so. Fix: say the two controls are drawn as the rows of `max_active_tickets` and `max_active_per_component` inside the "Fleet and capacity" group (or list them in the group read-only as the mock does), and record under Calls made that the Fleet section's Memory ceiling and Kit rows are the group rows. | |

Verdict: CHANGES 068abc12314c86d19fcbef85aedb5102a98cdf76
