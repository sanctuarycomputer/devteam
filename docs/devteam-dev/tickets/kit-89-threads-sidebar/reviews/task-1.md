# Task 1 review
- Reviewer: fresh subagent of the kit-89 worker
- Spec compliance: ✅ (§2.1–§2.3 and §2.6 as far as T1 owns them: the panel markup, tabs, split, rows and marks, button counts and words, `thGo`/`thHead`/`thRoute`, `tlOwn`/`holding()`/draft keeping/`tlHitAt`, the dock removed; AC1 and AC3's T1 parts asserted in the new file; the two plan-allowed deviations are reported)
- Quality: approved (blocks and threads-core byte-identical base→head, every file in touches, refreshes held under focus/press, change-of-view draws skip unchanged HTML; only Minor findings)

Checks run (one per named risk):
- Shared blocks / threads-core untouched: `devteam-layout`, `devteam-shell-js`, `threads-core` extracted at 7118fece and 0d7140ac, sha1 identical for each.
- Files only from touches: home kit's `ticket show` lists all seven changed files (pane-question, pages, peek, dev-links included).
- Dock leftovers: no `tlDock`, `tl-pill`, `tl-panel`, `ask-dock`, `tl-dock`, `tl-resolved`, `TL.list`, `TL.pill`, `TL_DOT` remain in index.html.
- Closed panel reachable by keyboard: the block's `.threads` rule sets `visibility: hidden` while closed (index.html:194), so the closed panel's buttons are out of the tab order.
- Button `title` fallback: the markup's original `title="Open questions"` (index.html:913) is what `thButton` falls back to, so no flip-flop with kit-87.
- Red count in `aria-label` stays fresh: `inboxTitle` (the only writer of `#inbox-btn-n`) is followed by `thDraw()` in both `drawOrHold` branches.
- `route()` split: its callers are `goHead(…, {replace})`, `hashchange` (behind `DATA`) and the first `drawOrHold`; all run after `TH` is defined; a nested redirect draws twice, harmlessly.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Minor | Tests assert behaviour | test/dashboard-threads-sidebar.test.mjs:228 | `window.__threadsQueue.length >= 0` is always true; only `TL.pend.length > 0` carries the check. Assert the queue is non-empty (a read is actually held) so Review Focus 4 proves "before the held read lands". | wont-fix in T1, Minor: T2's implementer makes the check __threadsQueue.length > 0 (ledger) |
| T1-2 | Minor | Ruling m-20261115-210541487 (one navigation line) | test/browser/dev-links.mjs:559-562 | Three lines changed rather than one (open, Resolved, selector); needed by the new split, but the ruling's scope is exceeded, and the `stepOk` text still says "the dock lists it under Resolved". Note it to the supervisor or reword the step. | wont-fix: the approved plan's T5 names both dev-links lines (~559, ~560); T2 rewords the step message |
| T1-3 | Minor | Migrated tests change only navigation | test/dashboard.test.mjs:2587 | Pin is pressed by `element.click()` on a button inside the closed, `visibility: hidden` panel, a path the owner can't take; the brief said close the viewer, then `.tt`. Reported by the implementer; T4 must restore the `#tt-peek` path. | wont-fix in T1, Minor: T4 restores the real path through #tt-peek, as its plan step says |
| T1-4 | Minor | Quality | docs/devteam/dashboard/index.html:6736 | `catch (e) { html = \`error: ${e}\` }` writes an exception's text into the pane and swallows it (no console, no banner); either let it throw into the existing draw error path or log it. | wont-fix in T1, Minor: T2 adds console.error beside the panel's error line |
| T1-5 | Minor | Spec §2.9 | docs/devteam/dashboard/index.html:5948 | Escape narrowed to `#tl` as the spec says, but nothing yet handles Escape with focus in the panel (spec: close the in-panel thread, else the panel); before, Escape from a dock row closed the floating card. Make sure a later task (T2) owns it. | wont-fix in T1, Minor: panel Escape is T2's (spec §2.9), in its plan step |
| T1-6 | Minor | Spec §2.2 words | docs/devteam/dashboard/index.html:6716 | The `aria-label` says "N open questions" from `#inbox-btn-n`, which `inboxTitle` fills with questions plus owner lessons; a lesson is counted as a question in the accessible name. Pre-existing count, new wording. | wont-fix in T1, Minor: T2 counts questions only in the label, or says 'waiting on you' |

Verdict: APPROVE 0d7140acdbd202184efc89619ba87227a9f52863
