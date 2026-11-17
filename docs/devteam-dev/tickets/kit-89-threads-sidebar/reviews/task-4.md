# Task 4 review
- Reviewer: fresh subagent of the kit-89 worker
- Spec compliance: ✅ (§2.7 is built as written: `av-open` on the `.shell` `<body>` in openArtifact/openPreview, cleared in closeArtifact; the mirror sits at the top right above the viewer, over a peek too, and is hidden at 900px and below; `.threads` z 23; `--av-right` uses the spec's rule verbatim. §2.8 is built: the `/view/` band and its inset, the mirror at every width, `tlInPanel`'s "not this stage's" branch, hello's `inbox`. The §2.5 carry under the viewer is built and tested. The tests cover AC4 and AC9 in full. The one way to the counts that differs from §2.8's wording gives the same result (T4-2))
- Quality: approved (small, well-placed changes outside the shared blocks; the tests assert behaviour, including a RED check of the carry; only Minor notes)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T4-1 | Minor | Spec AC3 (the label carries the counts); a11y | docs/devteam/dashboard/index.html:6865, 7843 | In `/view/` the button shows hello's red count, but `thButton`'s `aria-label` counts questions from `DATA`, which `/view/` never has. So a screen reader hears only the thread counts while the button shows a red "1". Saying "Inbox: N waiting, …" from hello's `inbox` there would close the gap. Not one of AC9's checks. | wont-fix in T4, Minor: T5 adds the red count to the /view/ button's aria-label |
| T4-2 | Minor | Spec §2.8 "Who draws the counts" | docs/devteam/dashboard/index.html:6850 (thButton), 1484-1500 (kit-88 observer), 7843 | §2.8 says `thDraw()` writes `#tt-peek` directly in `/view/`. Here it writes `.tt` (inside the hidden `.app`, which still exists), and kit-88's MutationObserver copies the content, label and title. Judged as meeting the spec's outcome: one writer, the same mirror path as the dashboard, the counts from `TL.threads` and hello, and no `/api/data`. AC9 asserts the result. Worth a line in verification.md or the spec's §7, so the whole-branch review doesn't flag the wording. | wont-fix: counts via .tt and kit-88's copier meet §2.8's outcome (one writer); said in verification.md |
| T4-3 | Minor | Spec AC4 ("at 720x800 the panel overlays") | test/dashboard-threads-sidebar.test.mjs:833-837 | The 720x800 overlay check (left 0, probe 0) runs with no viewer up. §2.7 says that below 900px the panel overlays the viewer, and that case isn't asserted directly. With the viewer up at 720 the mirror is hidden, so the panel would have to be opened first and the viewer after. The CSS has the same width rules either way, so the risk is low. | wont-fix in T4, Minor: T5 runs the 720x800 overlay check with the viewer up |
| T4-4 | Minor | Robustness (same exposure as T3-3) | docs/devteam/dashboard/index.html:5090-5095 | If the viewer's frame has pushed its own entries, `leaveArtifact`'s `history.back()` moves the frame, not the hash. Then no parent popstate or hashchange clears `TH_CARRY`, and it waits for the next route. `thCarry` applies only on the same page, so the worst case is stale `th`/`t` from the viewer's page head on a later route to that page. The implementer raised it; noted only. | wont-fix: same exposure as T3-3, same page only; noted in verification.md |

Checks made (one each):
- Shared blocks: every diff hunk in index.html lies outside `devteam-layout` (46–206), `devteam-shell-js` (1142–1414) and `threads-core` (5676–5943).
- Files: the three changed files are in the ticket's touches (`ticket show`). `dashboard-peek.test.mjs` and `dashboard-pages.test.mjs` are unchanged, so kit-87/88 assertions are kept.
- `.shell` is `<body>` (index.html:926), so `av-open` on `<body>` matches §2.7's "on the `.shell` element".
- Escape with focus in the panel and the viewer up: the threads keydown handler is a window capture listener that calls `stopImmediatePropagation` (index.html:6019), so the document handler's `leaveArtifact` doesn't also run (§2.9).
- The red count in `/view/` is not overwritten: `thButton` never touches `#inbox-btn-n`, and the only other writer, `inboxTitle`, needs `DATA`.
- `tlInPanel`'s `/view/` branch reads the right subject fields (artifact `slug`, preview `name`), as `tsSubject` builds them (index.html:7214–7216).
- Viewer over a peek, then ×: `thCarry` lands on the peek's link head through `thHead()` (`history.state.page`), so the panel's keys go to the peek's page head.
- Precedence: `.viewer #artifact-view:not([hidden])` beats the ≤900px `#artifact-view:not([hidden]) { inset: 8px }`, and `.viewer #tt-peek { display: inline-flex }` beats kit-88's ≤840px `display: none`.

Changed assertions, judged against the spec:
- dashboard.test.mjs "landed": the stage's `top 0 / height innerHeight` became `top 49 / innerHeight - 49`. §2.8 requires this (`inset: var(--bar-h) 0 0`). Accepted.
- dashboard.test.mjs pin-mode subtest: Pin is now reached through `#tt-peek` above the viewer (T1-3 carried), and the pin-mode assertions are unchanged. Accepted.

Verdict: APPROVE 23bbae41646301701dfae07f1be56a5f1b48a117
