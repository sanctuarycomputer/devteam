# Task review: Task 1 "The frame slides", pass 1

- Reviewer: task-1-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: daea800b195a175be290c92f18c36ba18e11a957..cd513e75130aca6be5b72239b1b6d28f46316eae (Task 1)

Checked against spec §2.1 and §5, the task brief, and the carried decisions R1–R3.

- **Blocks:** `devteam-layout` and `devteam-shell-js` hash the same in index.html and hub.html, and no diff hunk falls inside the markers.
- **Hidden writes:** no `$('drawer').hidden =` or `$('scrim').hidden =` write is left outside `peekShow`/`peekHide`. The scrim writes in the viewer, preview and review paths stay as they were.
- **chain.mjs pin:** `chain.mjs:3787` still finds the artifact route (682) before `if (!$('drawer').hidden)` (3231). That substring is still in `hideDrawer`.
- **Shell test slice:** `dashboard-shell.test.mjs:394` slices `route()` up to the literal `function hideDrawer()`, which is still there.
- **The two outside-touches failures** are accurately described:
  - `dashboard-shell.test.mjs:131` lists `drawer` and `scrim` among the ids that must carry `no-shell`.
  - `dashboard-pages.test.mjs:169` `peekOpen` checks only `hidden === false` before its `#drawer-close` clicks.

Named risks I traced:

- **Close then reopen within `--dur`:** `peekShow` cancels the pending hide and its `transitionend`/`transitioncancel` listeners before the reversed transition can fire them. Tested at 100ms.
- **The 10s refresh:** `refreshDrawer` returns when `DRAWER.kind` is null, which `closeDrawer`, `hideDrawer` and `openReview` all set. With `peek-open` already set, `showDrawer` takes `opening = false`, so nothing slides and focus is kept.
- **Shared scrim, R1:**
  - `closeArtifact` clears `overlay-open` only when `!RV`, and `closeReview` only when `!AV`.
  - When the viewer is closed with Back over a review, route reaches `openReview`, which returns early because the key is the same. So the test's `overlay-open` assertion would catch an unconditional clear.
  - A pending hide never drops the scrim or the scroll lock while `overlay-open` is set.
- **Mirror, R2/R3:** the `[id]` attributes are stripped and the test asserts a single `#inbox-btn-n`. The mirror fades over `--dur`/`--ease`. It is not hittable when hidden (`visibility: hidden; pointer-events: none`) and is `display: none` at ≤760px. Its click delegates to `.pagebar .tt`.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec §2.1 (top-right button "clear of the scrim", hidden only below 760px) | docs/devteam/dashboard/index.html:605,609 | `right: calc(min(720px, 100vw) + var(--header-pad))` with the drawer 720px wide leaves the mirror's right edge at `innerWidth - 736px`, which is 24px at a 760px window. So from 761px up to about 736px plus the button's width (roughly 820px), `#tt-peek` is partly off the left edge of the window. The owner sees a clipped button. This is the spec's geometry, not an implementer error. Fix: either raise the media query to `max-width: calc(736px + button width)` (about 840px) or clamp with `max(…)`. This needs a supervisor ruling because the spec names 760. | |
| F2 | Minor | spec §2.1 (`top` level with `.tt`) | docs/devteam/dashboard/index.html:605 | `top: calc((var(--bar-h) - 1px - 28px) / 2)` hard-codes `.tt`'s rendered height. If the block's `.tt` height or font changes, the mirror drifts from level. The test catches this only at 1440×900. Fix: name the 28px as the button height in a comment or token, or centre with `height: calc(var(--bar-h) - 1px)` and `align-items: center` on a wrapper. | |
| F3 | Minor | spec §2.1 (overlay-open for "the artifact viewer, a preview and a review"); brief Step 2 | test/dashboard-peek.test.mjs:282-327, 329-385 | These paths have no test: `#preview/` setting and clearing `overlay-open` (`openPreview` adds it at index.html:4837, and it is cleared through `closeArtifact`); a peek closed by a scrim click or by Escape (only the × is driven); and `#tt-peek` not being hit-testable when no peek is open (the test asserts "not seen", not `elementFromPoint`). The code paths read right. A regression in them would pass. | |
| F4 | Suggestion | n/a (pre-existing) | test/dashboard-peek.test.mjs:302-305, 324-326 | The test works around a pre-existing defect with a fresh visit per viewer case. Once the viewer's frame has loaded a page in a visit, `history.back()` from a later viewer or review moves the iframe's joint-history entry, not the hash, so it does not close. This diff did not cause it (`closeArtifact` only removed `src` before too), but it is a real owner-facing failure. Suggest a ticket for it. | |

No Critical or Important finding. The frame matches spec §2.1 and §5 as far as T1 reaches. R1–R3 are built in and each one is tested.

Verdict: APPROVE cd513e75130aca6be5b72239b1b6d28f46316eae
