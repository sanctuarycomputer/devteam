The Inbox moves out of the nav and into the side panel as its first tab, beside every page (story DCL-S4, after kit-87, kit-88, kit-89, kit-94 and kit-241).

## What changes (docs/devteam/dashboard/index.html)

- **The element moves, it isn't redrawn.** The old `<section id="inbox">` becomes `#th-inbox` in kit-89's `#th-body`. It keeps every child id, so `render()`, the cards and their handlers are unchanged. Its heading is removed.
- **The tab.** The Inbox tab registers first, so the tabs are Inbox, Threads, Supervisor, Shell. Its count is `inboxCount()`, drawn red, and the top-right button, the tab and the title all read it.
- **The URL and the roads.** `th=inbox` opens the tab, and every road into the Inbox lands there:
  - the button;
  - `#q/<id>`;
  - old `#inbox` and `#questions` (now redirects to `overview?th=inbox`);
  - in-page Inbox links (no redirect hop; a peek stays open);
  - a review's cold close.

  The nav item and the `inbox` page are gone.
- **Threads on questions.** Their home is the Inbox tab. Their pins are fixed and drawn above the panel, and the floating card sits 10px left of it. Above 900px, Shift+click works inside `#th-inbox`; at 900px and below, the card shows over the panel. Old Inbox-page spots open the tab with no pin.
- **Typing is kept.** kit-89's `#threads` exceptions (redraw hold, draft keeping, presses) now exclude `#th-inbox`. Escape in an Inbox text field closes nothing. Reviews open full size above the panel.
- **The /view/ tab** shows one line, "Answer questions on the dashboard.", linking to `/#overview?th=inbox`, with hello's count. The button there opens on Threads (ruling m-20261115-230458641).

## Added after approve-spec: please check against m-20261116-041710126

Spec §2.9 and AC5's Esc bullet came after approve-spec, by supervisor ruling m-20261116-041710126. They add an Esc button on the terminal's prompt card:

- `askEscCancels(hint)` mirrors kit-241's `paneEscCancels` exactly.
- The button shows only where the hint says "Esc to cancel" and never "Esc to exit" or "Esc to quit".
- It is armed exactly as the options are, and posts exactly `{ digest, escape: true, token }`.
- It is tested with kit-241's four hints, in the page and in `vm`.
- `devteam.mjs` is unchanged.

## The measure: page-top at 1440 only

The new `#settings?th=inbox` entry in `test/dashboard-measure.test.mjs` judges every check on the Inbox at 1440, 720 and 390. `page-top` is judged only at 1440. That is the known kit-wide skip, o-20261116-111831635: kit-87's nav row puts every shell page 104px below the bar under 900px. A follow-up ticket measures page-top at 720 and 390 (ruling m-20261117-051515268).

## How to verify

- `test/dashboard-inbox-panel.test.mjs` (new; headless Chrome, Node 22) covers AC1 to AC5 and AC9.
- `test/dashboard-measure.test.mjs` covers AC6.
- AC8 is the migrated suite: `dashboard.test.mjs`, `dashboard-pages`, `dashboard-shell`, `dashboard-threads-sidebar`, `dashboard-peek`, `pane-question.answer`, `next-step.strategy`, `dashboard-answers`, `dashboard-owner-action` and `test/browser/dev-links.mjs`.
- `docs/devteam-dev/tickets/kit-100-inbox-in-panel/verification.md` has a row per done-when, the AC7 inventory checklist and the screenshots.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
