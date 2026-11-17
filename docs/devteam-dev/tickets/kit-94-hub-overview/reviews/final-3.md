# Final review, pass 3

- Reviewer: final-reviewer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: eda370a8afc256711e2647de318daad16e8c35aa

Run on an export of eda370a (Node 24.14.1, concurrency 1): "the Overview: a header, then two cards a row with the standard head" passes. Both shared blocks (`devteam-layout`, `devteam-shell-js`) are byte-identical to index.html's (same md5 from start to end marker). index.html, shell.md, gateway.test.mjs and operator-threads.hub.test.mjs are unchanged against 6a4043c.

Pass 2's dispositions hold. Each fix in 837ab8f, undone in a scratch copy, turns that test red. Without `closeMenu()` in `paintOverview`, "closed by the redraw, focus on its ⋯" fails. Without the `fromMenu` refocus, the same assertion fails. Without `closeMenu()` in `showOnly`, the test times out on "alpha's dashboard, no menu". The code matches the spec: a redraw closes the ⋯ menu (spec "closes on Escape, an outside click or a redraw"; Edge cases "an open ⋯ menu closes"). Focus goes back to that menu's own ⋯ only when focus was inside the menu: `fromMenu` is read before `closeMenu()`, and the refocus runs only when `at` is null. Focus anywhere else is left alone. Because the menu now lasts at most 10 s and every press repaints, pass 2's stray-Escape path (F2-1) is gone. A change of view closes it (F2-2).

Cold review against spec.md, plan.md's Review focus and verification.md found no Critical or Important issue. Review focus 1 (confirm, busy, error and focus across a redraw), 2 (Escape on both confirms) and 5 (view names) are implemented and tested. 3 (odd hellos) is tested in vm and on the fixture card "old". 4 (390px) is tested, and shots/ shows it. The machine switch's Park counts N = running + draining, and that matches `post`'s park filter. Settings takes Passkeys and Previews only from `secure()` URLs, and they go in as `href`/text. The only innerHTML is `fleetSwitch(...)`, which escapes its input. The executor's rulings are sound. The Task 5 page-CSS ruling puts the Settings link inside `.fleet-switch`, which T5-1 already records. These deferred minors stay acceptable: F4, T1-2-1..3, T2-3, T3-2, T3-3, T3-6, T3-2-2, T3-2-3, T4-6, T5-1, T5-2. Each is a test gap or a cosmetic issue, and none gives a hub user wrong behaviour.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F3-1 | Minor | F2-1's disposition ("focus elsewhere stays; the test now asserts both") | test/hub-overview.test.mjs:457-462 (the "keyboard elsewhere" case) | That case puts focus on gamma's name, inside `#ov-body`, so `at` wins whatever `fromMenu` holds. The mutant `menuPop ? menuPop.dataset.root : null`, which drops the "focus was inside the menu" check, passes the test. The code is correct. The untested path is focus outside `#ov-body` while the menu is open, for example on a header tab. A regression there would pull the keyboard to ⋯ on the 10 s redraw. A case that focuses a tab, repaints and expects the tab to keep focus would close the gap. | deferred (minor): a test gap; the code is right (a header-tab focus case to add with kit-87's delta pass if code changes) |

Verdict: APPROVE eda370a8afc256711e2647de318daad16e8c35aa
