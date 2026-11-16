# Task review: Task 5 "Every row and card opens its record", pass 2

- Reviewer: task-5-rereviewer (fresh subagent, claude-sonnet-5-5)
- Scope: fix round 68c4450f..5c879dfe
- Reviewed: 5c879dfe519dbd58f1284957864042c9d06cb063

I read the fix diff, the report's "Fix round 1", the previous review and spec §2.5. I ran no tests. The hunks in index.html are at ~332 (CSS), ~2299 (`titled`) and ~3353-4180 (Loop, Decide and Sensors renderers); none is inside `devteam-layout` (46-206) or `devteam-shell-js` (1090-1362). Only index.html and test/dashboard-peek.test.mjs changed.

## Finding verdicts

- F1 ADDRESSED (test/dashboard-peek.test.mjs:947-957). The selector is now `#drawer-body :is(${NAV})`, picks the first `[data-open]` that names another record, and clicks it. It then asserts the hash, `DRAWER.kind` and the drawer's visibility, that `[DRAWER.kind, DRAWER.id]` moved off the original record, and that no non-GET request was recorded. It records `navClicked` and asserts the goal peek is in it (line ~957), so the check can no longer pass vacuously.
- F2 ADDRESSED (index.html:2299 `titled`; 3354, 3371, 3389, 3433, 4180). The title is the link on act, decision and sensor-feed cards. `titled` wraps only the runs outside existing `<a>` elements, so a ticket, question or subject link inside a title keeps its own target. The extension to Observe and lesson cards turned only own-record links (the timestamp, or the badge) into plain text or into the title link. No link to a different record was lost: `subjectLink` and `linkify` output sits inside the title and keeps its anchors. On a Decide row the `.meta` still holds `evidence` and `under` (index.html:3436), so the evidence link to its act survives. The report says the test's first stricter clause failed on exactly this and was dropped. The title check (test ~1212) requires `a.title-link`, outside the menu, own-record only, not in `.meta`.
- F3 ADDRESSED (index.html:334). `.card[data-open]:focus-visible` uses the same 2px blue ring as `.tcard`.
- Controller ruling ADDRESSED. Loop (observe, signal, incident, problem, lesson, act, decision) and Sensors cards carry `role="button" tabindex="0"`. The one keydown handler (index.html:1701) acts only when `e.target` matches `[data-open][tabindex]`, so Enter on an inner link is left to the link. The new test (~1255-1278) asserts the role and tabindex on every card, Enter on the card, and Enter on a link not default-prevented, then that a click goes to the link's own target.

## New findings

None.

## Notes (not findings)

- A title that is made only of links (no text outside an anchor) would get no `title-link`; the card would still open on a click and from Open in side peek. The heads in `actView` all have leading text, so this is latent only.
- The Loop and Sensors Enter test covers the Observe and Sensors cards only; the signal, problem, lesson, act and decision cards share the same attribute pattern and handler.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE 5c879dfe519dbd58f1284957864042c9d06cb063
