# COMPAT: apps/dashboard

The compatibility surface of `apps/dashboard` (`apps-src@1`, `apps/dashboard/APPS.md`): what the kit's tests at kit `8ea96ace0c03ef1cbfe427e6255b9b142968f925` read of `index.html`, `canvas.html`, `browser.html`, which the app keeps until the cutover. Written once by `node apps/dashboard/scripts/compat-scan.mjs --base 8ea96ace0c03ef1cbfe427e6255b9b142968f925`, which `--check` re-runs; port tickets don't edit it, and an item a later test adds is a carry-over.

A scan, not a parser. It reads each test's string, template and regex literals (code a test runs in the page is a string to it) and keeps only what the page itself has. Its limits: an id or class the page builds from a variable is matched by its fixed prefix only (listed as `prefix*`); a text is a literal of 4 or more characters, with a capital or a space, on a line that reads the page, found in the page's source; a name built at run time is not seen. A view is the port that owns the page lines where the item is written, by the line ranges in `apps/dashboard/scripts/compat-scan.mjs` (lines at kit `3088ac1e`); an item more than one view writes belongs to the page's root view, which holds the shared parts.

## Counts

| page | route | tests that open it | tests that slice it | globals | ids | classes | roles | texts |
|---|---|---|---|---|---|---|---|---|
| `index.html` | `/` | 97 | 34 | 116 | 145 | 297 | 10 | 367 |
| `canvas.html` | `/view/canvas/` | 16 | 0 | 0 | 27 | 32 | 3 | 18 |
| `browser.html` | `/browser/` | 9 | 0 | 0 | 19 | 1 | 0 | 14 |

## Globals: `index.html`

Each is on `window`, registered once by the view named: a function with `expose()` (`src/shared/compat.ts`), a value (a table or a constant the page declares at its top level) by plain assignment. `test/apps-compat.test.mjs` reports each function that is not a function on `window`, and each value that is missing.

| item | kind | view | read by |
|---|---|---|---|
| `artNameLink` | function | words | `test/dashboard.artifact-threads.test.mjs` |
| `artSrc` | function | viewer | `test/artifact-notes-viewer.test.mjs` |
| `askDraw` | function | thread | `test/artifact-notes-press.test.mjs` |
| `avShowMe` | function | viewer | `test/artifact-notes-viewer.test.mjs` |
| `avStep` | function | viewer | `test/artifact-notes-viewer.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs` |
| `bindDbTable` | function | shell | `test/dashboard-peek.test.mjs` |
| `burnup` | function | board | `test/dashboard-board-progress.test.mjs` |
| `closedGoalCardHtml` | function | goals | `test/dashboard-overview-goals.test.mjs` |
| `dbTable` | function | shell | `test/dashboard-shell.test.mjs` |
| `drawFleet` | function | goals | `test/dashboard-pages.test.mjs` |
| `drawHeld` | function | data | `test/dashboard.presses.test.mjs` |
| `drawPills` | function | attachments | `test/dashboard-measure.test.mjs` |
| `drawSettings` | function | settings | `test/dashboard-pages.test.mjs` |
| `empty` | function | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs` |
| `esc` | function | shell | `test/dashboard-peek-artifacts.test.mjs` |
| `fleetSwitch` | function | shell | `test/dashboard-shell.test.mjs` |
| `fmtDate` | function | shell | `test/dashboard-board-progress.test.mjs` |
| `focusKey` | function | peeks | `test/dashboard-peek.test.mjs` |
| `forecast` | function | board | `test/dashboard-board-progress.test.mjs` |
| `goalState` | function | goals | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs` |
| `goalSteps` | function | shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs` |
| `govListed` | function | autonomy | `test/dashboard-autonomy.test.mjs` |
| `heartbeat` | function | shell | `test/dashboard-shell.test.mjs` |
| `hideDrawer` | function | data | `test/dashboard-shell.test.mjs` |
| `holdState` | function | review | `test/dashboard-pages.test.mjs` |
| `hostHere` | function | library | `test/dashboard-terminal-tabs.test.mjs` |
| `inboxCount` | function | data | `test/dashboard-inbox-panel.test.mjs` |
| `leaveArtifact` | function | viewer | `test/artifact-notes-press.test.mjs` |
| `list` | function | peeks | `test/hub-overview.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `load` | function | data | `test/dashboard-goals-reorder.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/dashboard.threads-answered.test.mjs` |
| `loadFleet` | function | settings | `test/dashboard-pages.test.mjs` |
| `loadGovernance` | function | autonomy | `test/dashboard-autonomy.test.mjs` |
| `matchedWords` | function | loop | `test/dashboard.presses.test.mjs` |
| `NEXT_ID` | function | overview | `test/dashboard-overview-goals.test.mjs` |
| `norm` | function | words | `test/dashboard-question-peek.test.mjs` |
| `OPENERS` | function | peeks | `test/dashboard-peek.test.mjs` |
| `openGoal` | function | peek-kinds | `test/dashboard-overview-goals.test.mjs` |
| `openQuestion` | function | peek-kinds | `test/dashboard-question-peek.test.mjs` |
| `openSensor` | function | autonomy | `test/dashboard-peek.test.mjs` |
| `peekFor` | function | peeks | `test/dashboard-peek.test.mjs` |
| `peekIsOpen` | function | peeks | `test/dashboard-inbox-panel.test.mjs` |
| `peekKey` | function | peeks | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-peek.test.mjs` |
| `pillsOf` | function | board | `test/dashboard-board-progress.test.mjs` |
| `press` | function | data | `test/dashboard.loop-goals.test.mjs` |
| `PROGRESS_CHART` | function | board | `test/dashboard-board-progress.test.mjs` |
| `props` | function | shell | `test/dashboard-shell.test.mjs` |
| `qcardOf` | function | attachments | `test/dashboard-question-peek.test.mjs` |
| `questionCard` | function | words | `test/dashboard.presses.test.mjs` |
| `redraw` | function | peeks | `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs` |
| `redrawNow` | function | data | `test/dashboard-answers.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard-pages.test.mjs` |
| `refreshDrawer` | function | peeks | `test/dashboard-peek.test.mjs` |
| `render` | function | data | `test/dashboard-pages.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/org-access.view.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `renderBoard` | function | board | `test/dashboard-board-progress.test.mjs` |
| `renderGoals` | function | goals | `test/dashboard-goals-reorder.test.mjs` |
| `renderJobs` | function | settings | `test/recurring-jobs-page.test.mjs` |
| `renderLibrary` | function | library | `test/library-card-menu.test.mjs` |
| `renderProgress` | function | board | `test/dashboard-board-progress.test.mjs` |
| `route` | function | data | `test/artifact-handover-reminder.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/session-threads.test.mjs` |
| `saveLimit` | function | settings | `test/dashboard-pages.test.mjs` |
| `shellPages` | function | shell | `test/recurring-jobs-page.test.mjs` |
| `showArtifact` | function | viewer | `test/artifact-live-reload.guards.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/artifact-pages.test.mjs`, `test/dashboard-library.viewer.test.mjs` |
| `showTab` | function | data | `test/dashboard.threads-resolve.test.mjs` |
| `spark` | function | autonomy | `test/dashboard-overview-goals.test.mjs` |
| `statusPill` | function | shell | `test/dashboard-overview-goals.test.mjs` |
| `storedRows` | function | peeks | `test/dashboard-peek.test.mjs` |
| `tabBar` | function | shell | `test/dashboard-shell.test.mjs` |
| `tButton` | function | threads-panel | `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `tCardState` | function | threads-core | `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `tCounts` | function | threads-panel | `test/artifact-handover-reminder.test.mjs` |
| `termPaint` | function | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `termTab` | function | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `tFrameOn` | function | threads-core | `test/artifact-pages.test.mjs` |
| `thGo` | function | threads-panel | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/artifact-viewer-close.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-terminal-tabs.test.mjs`, `test/dashboard-threads-sidebar.test.mjs` |
| `thInPanelId` | function | threads-panel | `test/dashboard-autonomy.test.mjs` |
| `thRoute` | function | threads-panel | `test/dashboard-threads-sidebar.test.mjs` |
| `thRow` | function | threads-panel | `test/artifact-handover-reminder.test.mjs` |
| `thWidth` | function | threads-panel | `test/dashboard-terminal-tabs.test.mjs` |
| `tKey` | function | threads-core | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs` |
| `tlAct` | function | thread | `test/dashboard.viewer.test.mjs` |
| `tlCardBody` | function | thread | `test/artifact-notes-viewer.test.mjs` |
| `tlClose` | function | threads-panel | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.viewer.test.mjs`, `test/thread-per-subject.test.mjs` |
| `tlDraw` | function | thread | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tLensMessage` | function | threads-core | `test/artifact-pages.test.mjs` |
| `tlGoTo` | function | threads-panel | `test/dashboard.preview.test.mjs` |
| `tlHitAt` | function | threads-panel | `test/dashboard-threads-sidebar.test.mjs` |
| `tlHome` | function | threads-panel | `test/dashboard-inbox-panel.test.mjs` |
| `tlInboxHome` | function | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-terminal-tabs.test.mjs` |
| `tlInPanel` | function | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-terminal-tabs.test.mjs` |
| `tlOpen` | function | threads-panel | `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.preview.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs`, `test/org-access.attribution.test.mjs` |
| `tlPinMode` | function | threads-panel | `test/artifact-notes-viewer.test.mjs`, `test/artifact-viewer-escape.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-inbox-panel.test.mjs` |
| `tlPins` | function | thread | `test/dashboard.threads-resolve.test.mjs` |
| `tlRefresh` | function | threads-panel | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs` |
| `tlRelay` | function | threads-panel | `test/operator-threads.hub.test.mjs` |
| `tlRowOf` | function | threads-panel | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `tlSeenAt` | function | thread | `test/dashboard.threads-resolve.test.mjs` |
| `tlSend` | function | thread | `test/artifact-notes-viewer.test.mjs`, `test/session-threads.test.mjs` |
| `tlShowing` | function | threads-panel | `test/autonomy-suggestions.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `tlStart` | function | threads-panel | `test/artifact-notes-viewer.test.mjs`, `test/autonomy-suggestions.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/org-access.view.test.mjs` |
| `tlTargetRect` | function | threads-panel | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `tOverlay` | function | threads-core | `test/artifact-handover-reminder.test.mjs` |
| `tPendingThread` | function | threads-core | `test/artifact-handover-reminder.test.mjs` |
| `tPlace` | function | threads-core | `test/artifact-notes-viewer.test.mjs` |
| `tsFrame` | function | thread | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/artifact-pages.test.mjs`, `test/artifact-viewer-box.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs`, `test/fixtures/artifact-viewer/harness.mjs` |
| `tsPins` | function | threads-panel | `test/dashboard.artifact-threads.test.mjs` |
| `tsPost` | function | thread | `test/dashboard.preview.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs` |
| `tsRect` | function | threads-panel | `test/artifact-viewer-box.test.mjs`, `test/dashboard.artifact-threads.test.mjs` |
| `tsSubject` | function | thread | `test/artifact-notes-viewer.test.mjs`, `test/artifact-pages.test.mjs` |
| `tState` | function | thread | `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `tSubjectAt` | function | threads-core | `test/dashboard-autonomy.test.mjs` |
| `tsWatch` | function | threads-panel | `test/dashboard.artifact-threads.test.mjs` |
| `tWhere` | function | threads-core | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `viewerBoot` | function | data | `test/dashboard.viewer.test.mjs` |
| `viewOnly` | function | shell | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-press.test.mjs` |
| `viewToast` | function | shell | `test/artifact-handover-reminder.test.mjs` |
| `when` | function | words | `test/dashboard-overview-goals.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `words` | function | words | `test/session-threads.test.mjs` |

## Ids: `index.html`

| item | view | read by |
|---|---|---|
| `a-*` | words | `test/dashboard-attachments.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-peek.test.mjs` |
| `acts-feed` | loop | `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs` |
| `answered` | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/org-access.attribution.test.mjs` |
| `answered-sum` | threads-panel | `test/dashboard-inbox-panel.test.mjs` |
| `answered-wrap` | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.presses.test.mjs` |
| `artifact-view` | viewer | `test/artifact-live-reload.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/artifact-viewer-box.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek-artifacts.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.viewer.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs`, `test/lib/dashboard-library-fixture.mjs` |
| `ask-inbox` | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/pane-question.answer.page.test.mjs` |
| `ask-threads` | threads-panel | `test/dashboard-threads-sidebar.test.mjs`, `test/pane-question.answer.page.test.mjs` |
| `av-ask` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-pages.test.mjs`, `test/dashboard.artifact-threads.test.mjs` |
| `av-ask-h` | viewer | `test/artifact-close-ask.test.mjs` |
| `av-ask-hand` | viewer | `test/artifact-close-ask.test.mjs` |
| `av-ask-later` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-pages.test.mjs`, `test/dashboard.artifact-threads.test.mjs` |
| `av-ask-tx` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-close-ask.test.mjs` |
| `av-close` | viewer | `test/artifact-live-reload.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs` |
| `av-filter` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `av-frame` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-live-reload.main-place.test.mjs`, `test/artifact-live-reload.test.mjs`, `test/artifact-reload-removed.test.mjs`, `test/artifact-remote.chrome.test.mjs`, `test/artifact-viewer-aim.test.mjs`, `test/artifact-viewer-box.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-peek-artifacts.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.reload.test.mjs`, `test/dashboard.viewer.test.mjs`, `test/fast-threads-e2e.test.mjs`, `test/lib/artifact-live.mjs`, `test/lib/dashboard-library-fixture.mjs` |
| `av-handover` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-close-ask.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `av-held` | viewer | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs` |
| `av-hint` | viewer | `test/dashboard.viewer.test.mjs` |
| `av-img` | attachments | `test/dashboard-attachments.test.mjs` |
| `av-kind` | viewer | `test/dashboard-library.viewer.test.mjs` |
| `av-next` | viewer | `test/artifact-notes-viewer.test.mjs` |
| `av-note` | viewer | `test/artifact-live-reload.test.mjs`, `test/artifact-viewer-box.test.mjs`, `test/artifact-viewer-close.history.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.viewer.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs` |
| `av-notes` | viewer | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `av-over` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-viewer-box.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs` |
| `av-pins` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/artifact-pages.test.mjs`, `test/artifact-viewer-box.test.mjs`, `test/artifact-viewer-escape.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs` |
| `av-project` | viewer | `test/dashboard.viewer.test.mjs` |
| `av-pub` | library | `test/dashboard-library.viewer.test.mjs` |
| `av-pub-menu` | library | `test/dashboard-library.viewer.test.mjs` |
| `av-reload` | viewer | `test/artifact-live-reload.guards.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard.reload.test.mjs` |
| `av-remind` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `av-remind-hand` | viewer | `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `av-remind-later` | viewer | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs` |
| `av-run` | viewer | `test/dashboard-library.viewer.test.mjs` |
| `av-shot` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `av-stage` | viewer | `test/artifact-notes-viewer.test.mjs`, `test/artifact-viewer-box.test.mjs`, `test/dashboard-attachments.test.mjs` |
| `av-step` | viewer | `test/artifact-notes-viewer.test.mjs` |
| `av-stepn` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `av-tab` | viewer | `test/dashboard-library.viewer.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs` |
| `av-title` | viewer | `test/dashboard-attachments.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.viewer.test.mjs` |
| `av-ver` | viewer | `test/artifact-versions-order.test.mjs`, `test/dashboard-library.viewer.test.mjs` |
| `av-vers` | viewer | `test/dashboard-library.viewer.test.mjs`, `test/lib/dashboard-library-fixture.mjs` |
| `av-where` | viewer | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.viewer.test.mjs` |
| `av-with` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `awareness` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-measure.test.mjs` |
| `board` | board | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-viewer-aim.test.mjs`, `test/artifact-viewer-escape.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.typing.test.mjs`, `test/org-access.view.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `board-cols` | board | `test/dashboard-board-progress.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.typing.test.mjs` |
| `burnup` | board | `test/dashboard-board-progress.test.mjs`, `test/dashboard-measure.test.mjs` |
| `decisions-feed` | loop | `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/thread-per-subject.test.mjs` |
| `down-banner` | overview | `test/dashboard-overview-goals.test.mjs` |
| `drawer` | peeks | `test/artifact-viewer-box.test.mjs`, `test/artifact-viewer-close.history.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek-artifacts.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/next-step.strategy.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `drawer-bar-title` | peeks | `test/dashboard-autonomy.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/recurring-dashboard.test.mjs` |
| `drawer-body` | peeks | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/next-step.strategy.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-failures.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `drawer-close` | peeks | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs` |
| `e-*` | shell | `test/dashboard-attachments.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/library-card-menu.test.mjs` |
| `e-ava` | viewer | `test/artifact-close-ask.test.mjs` |
| `e-avn` | viewer | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `e-avr` | viewer | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `e-goal-order` | goals | `test/dashboard-goals-reorder.test.mjs` |
| `e-tl` | threads-panel | `test/artifact-notes-viewer.test.mjs`, `test/dashboard.threads-card.test.mjs` |
| `efficiency` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-measure.test.mjs` |
| `fff` | shell | `test/artifact-notes-press.test.mjs`, `test/browser-handover.close.test.mjs`, `test/browser.test.mjs`, `test/pull-refresh.test.mjs` |
| `fleet-left-pop` | goals | `test/dashboard-pages.test.mjs` |
| `forecast` | board | `test/dashboard-board-progress.test.mjs`, `test/dashboard-measure.test.mjs` |
| `goals` | goals | `test/dashboard-attachments.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-server.test.mjs`, `test/hub-overview.test.mjs`, `test/next-step.strategy.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/supervisor-thread-new.test.mjs`, `test/thread-per-subject.test.mjs` |
| `goals-list` | goals | `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/next-step.strategy.test.mjs` |
| `governance` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-shell.test.mjs` |
| `held` | shell | `test/dashboard.typing.test.mjs` |
| `inbox-btn` | shell | `test/dashboard-pages.test.mjs` |
| `inbox-btn-n` | shell | `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.typing.test.mjs` |
| `incidents` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-peek.test.mjs` |
| `jobs` | settings | `test/dashboard-autonomy.test.mjs`, `test/dashboard-measure.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `knowledge` | loop | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/dashboard.presses.test.mjs` |
| `legend` | board | `test/dashboard-board-progress.test.mjs` |
| `lib-grid` | library | `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-measure.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/library-card-menu.test.mjs` |
| `lib-top` | library | `test/artifact-remote.chrome.test.mjs`, `test/dashboard-library.test.mjs` |
| `library` | library | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-live-reload.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/artifact-pages.test.mjs`, `test/artifact-remote.chrome.test.mjs`, `test/artifact-versions-order.test.mjs`, `test/artifact-viewer-box.test.mjs`, `test/artifact-viewer-close.history.test.mjs`, `test/artifact-viewer-close.test.mjs`, `test/artifact-viewer-escape.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.viewer.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs`, `test/fixtures/artifact-viewer/harness.mjs`, `test/lib/artifact-live.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/project-hosts-e2e.test.mjs` |
| `loop` | loop | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/dashboard.threads-server.test.mjs`, `test/thread-per-subject.test.mjs` |
| `loop-tabs` | loop | `test/dashboard-loop.test.mjs`, `test/dashboard-pages.test.mjs` |
| `monitoring` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-shell.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `n-awareness` | shell | `test/dashboard-autonomy.test.mjs` |
| `n-jobs` | shell | `test/recurring-jobs-page.test.mjs` |
| `n-library` | shell | `test/dashboard-library.test.mjs` |
| `n-sensors` | shell | `test/dashboard-autonomy.test.mjs` |
| `n-trust` | shell | `test/dashboard-autonomy.test.mjs` |
| `observations` | loop | `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.loop-goals.test.mjs` |
| `overview` | overview | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-terminal-tabs.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/hub-measure.test.mjs`, `test/hub-overview.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `p-q-` | peek-kinds | `test/dashboard-board-progress.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `page-title` | shell | `test/dashboard-efficiency.test.mjs`, `test/dashboard-pages.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `planners` | board | `test/dashboard-board-progress.test.mjs` |
| `progress` | board | `test/artifact-viewer-close.history.test.mjs`, `test/artifact-viewer-escape.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs` |
| `pull-refresh` | overview | `test/pull-refresh.test.mjs` |
| `pv-frame` | viewer | `test/artifact-viewer-box.test.mjs`, `test/dashboard.preview.test.mjs` |
| `q-` | data | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/next-step.strategy.test.mjs` |
| `q-*` | review | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs` |
| `questions` | threads-panel | `test/browser-e2e.test.mjs`, `test/dashboard-answers.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.presses.test.mjs`, `test/dashboard.typing.test.mjs`, `test/next-step.strategy.test.mjs`, `test/org-access.view.test.mjs` |
| `retros` | settings | `test/dashboard-autonomy.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-shell.test.mjs` |
| `review-view` | review | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs` |
| `saving` | shell | `test/dashboard.presses.test.mjs` |
| `scrim` | peeks | `test/dashboard-attachments.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-resolve.test.mjs` |
| `settings` | settings | `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard.threads-server.test.mjs`, `test/hub-overview.test.mjs`, `test/project-hosts-e2e.test.mjs`, `test/settings-fleet-offline.test.mjs`, `test/thread-per-subject.test.mjs` |
| `side-fleet` | shell | `test/dashboard-pages.test.mjs` |
| `side-state` | shell | `test/dashboard-pages.test.mjs` |
| `stale` | shell | `test/dashboard-attachments.test.mjs`, `test/dashboard.typing.test.mjs` |
| `th-body` | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard.typing.test.mjs` |
| `th-card-slot` | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs` |
| `th-close` | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-terminal-tabs.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/next-step.strategy.test.mjs`, `test/pane-question.answer.page.test.mjs` |
| `th-inbox` | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/dashboard.typing.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `th-pane` | threads-panel | `test/dashboard-autonomy.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `th-tabs` | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-terminal-tabs.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/pane-question.answer.page.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `th-wide` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `threads` | threads-panel | `test/dashboard-answers.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-terminal-tabs.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/dashboard.presses.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/dashboard.typing.test.mjs`, `test/dashboard.viewer.test.mjs`, `test/next-step.strategy.test.mjs`, `test/pane-question.answer.page.test.mjs`, `test/pull-refresh.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `tip` | board | `test/dashboard-board-progress.test.mjs` |
| `tl` | threads-panel | `test/dashboard-measure.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.presses.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/hub-measure.test.mjs`, `test/hub-overview.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-c-acts` | threads-panel | `test/dashboard-threads-sidebar.test.mjs` |
| `tl-c-ask` | threads-panel | `test/artifact-notes-press.test.mjs` |
| `tl-c-bytes` | threads-panel | `test/dashboard.threads-card.test.mjs` |
| `tl-c-ctx` | threads-panel | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `tl-c-note` | thread | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-c-ready` | threads-panel | `test/dashboard.threads-resolve.test.mjs` |
| `tl-c-spin` | threads-panel | `test/thread-responding.test.mjs` |
| `tl-c-state` | threads-panel | `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/dashboard.presses.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/session-threads.test.mjs`, `test/thread-responding.test.mjs` |
| `tl-c-text` | threads-panel | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/autonomy-suggestions.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.viewer.test.mjs`, `test/hub-overview.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/org-access.view.test.mjs`, `test/session-threads.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `tl-c-title` | threads-panel | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-c-turns` | threads-panel | `test/dashboard-attachments.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.presses.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/session-threads.test.mjs`, `test/thread-responding.test.mjs` |
| `tl-card` | shell | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/dashboard.viewer.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs`, `test/fixtures/artifact-viewer/harness.mjs`, `test/operator-threads.hub.test.mjs`, `test/session-threads.test.mjs`, `test/thread-per-subject.test.mjs`, `test/thread-responding.test.mjs` |
| `tl-chip` | threads-panel | `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-cursor` | threads-panel | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/thread-per-subject.test.mjs` |
| `tl-hl` | threads-panel | `test/dashboard-autonomy.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard.artifact-threads.test.mjs` |
| `tl-list` | threads-panel | `test/artifact-annotations-e2e.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `tl-outcome` | thread | `test/dashboard.threads-resolve.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `tl-pinbtn` | threads-panel | `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-pins` | threads-panel | `test/dashboard-efficiency.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `trust` | autonomy | `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-shell.test.mjs` |
| `tt-peek` | peeks | `test/artifact-viewer-box.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.viewer.test.mjs` |
| `unassigned` | goals | `test/dashboard-overview-goals.test.mjs` |
| `view-only` | shell | `test/hub-overview.test.mjs`, `test/org-access.view.test.mjs` |
| `view-only-toast` | shell | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/org-access.view.test.mjs` |
| `w-features` | board | `test/dashboard-board-progress.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs` |
| `w-releases` | board | `test/dashboard-board-progress.test.mjs`, `test/dashboard-peek.test.mjs` |
| `w-stories` | board | `test/dashboard-peek.test.mjs` |
| `w-throughput` | board | `test/dashboard-board-progress.test.mjs` |
| `w-throughput-note` | board | `test/dashboard-board-progress.test.mjs` |
| `w-waves` | board | `test/dashboard-board-progress.test.mjs`, `test/dashboard-peek.test.mjs` |
| `when` | shell | `test/dashboard-pages.test.mjs`, `test/org-access.view.test.mjs` |

## Ids: `canvas.html`

| item | view | read by |
|---|---|---|
| `banner` | canvas | `test/canvas-editing.components.test.mjs`, `test/canvas-editing.test.mjs` |
| `capNote` | canvas | `test/canvas-pins.test.mjs` |
| `ffffff` | canvas | `test/canvas-editing.tools.test.mjs` |
| `layers` | canvas | `test/canvas-cursors.others.test.mjs`, `test/canvas-cursors.test.mjs`, `test/canvas-editing.components.test.mjs`, `test/canvas-editing.drag.test.mjs`, `test/canvas-editing.panel.test.mjs`, `test/canvas-editing.test.mjs`, `test/canvas-editing.tools.test.mjs`, `test/canvas-editor-tools.multi.test.mjs`, `test/canvas-editor-tools.paste.test.mjs`, `test/canvas-editor-tools.resize.test.mjs`, `test/canvas-editor-tools.test.mjs`, `test/canvas-editor.test.mjs`, `test/canvas-pins.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `msg` | canvas | `test/canvas-editing.drag.test.mjs`, `test/canvas-editor.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `narrowNote` | canvas | `test/canvas-editor.test.mjs` |
| `others` | canvas-presence | `test/canvas-cursors.others.test.mjs`, `test/lib/canvas-cursors-fixture.mjs` |
| `pageAdd` | canvas | `test/canvas-editor-tools.test.mjs` |
| `pages` | canvas | `test/canvas-editing.components.test.mjs`, `test/canvas-editing.drag.test.mjs`, `test/canvas-editing.test.mjs`, `test/canvas-editor-tools.test.mjs`, `test/canvas-editor.test.mjs`, `test/canvas-sync.drag.test.mjs`, `test/canvas-sync.test.mjs`, `test/canvas-sync.undo.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `pageSel` | canvas | `test/canvas-cursors.others.test.mjs`, `test/canvas-editing.components.test.mjs`, `test/canvas-editor.test.mjs` |
| `pinBar` | canvas | `test/canvas-pins.test.mjs` |
| `pinCard` | canvas-presence | `test/canvas-pins.test.mjs` |
| `pins` | canvas-presence | `test/canvas-pins.test.mjs` |
| `pinSend` | canvas-presence | `test/canvas-pins.test.mjs` |
| `pinText` | canvas-presence | `test/canvas-pins.test.mjs` |
| `pinTool` | canvas | `test/canvas-pins.test.mjs` |
| `props` | canvas | `test/canvas-cursors.others.test.mjs`, `test/canvas-editing.components.test.mjs`, `test/canvas-editing.drag.test.mjs`, `test/canvas-editing.panel.test.mjs`, `test/canvas-editing.test.mjs`, `test/canvas-editing.tools.test.mjs`, `test/canvas-editor-tools.test.mjs`, `test/canvas-editor.test.mjs`, `test/canvas-sync.undo.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `repoChip` | canvas | `test/canvas-editor.test.mjs` |
| `stage` | canvas | `test/canvas-cursors.others.test.mjs`, `test/canvas-editing.tools.test.mjs`, `test/canvas-editor.test.mjs`, `test/canvas-pins.test.mjs` |
| `surface` | canvas | `test/canvas-cursors.others.test.mjs`, `test/canvas-editing.components.test.mjs`, `test/canvas-editing.drag.test.mjs`, `test/canvas-editing.panel.test.mjs`, `test/canvas-editing.test.mjs`, `test/canvas-editing.tools.test.mjs`, `test/canvas-editor-tools.multi.test.mjs`, `test/canvas-editor-tools.paste.test.mjs`, `test/canvas-editor-tools.resize.test.mjs`, `test/canvas-editor-tools.test.mjs`, `test/canvas-editor.test.mjs`, `test/canvas-pins.test.mjs`, `test/canvas-sync.drag.test.mjs`, `test/canvas-sync.test.mjs`, `test/canvas-sync.undo.test.mjs`, `test/lib/canvas-cursors-fixture.mjs`, `test/lib/canvas-fixture.mjs` |
| `title` | canvas | `test/canvas-editor.test.mjs` |
| `toast` | canvas | `test/canvas-editing.components.test.mjs`, `test/canvas-editing.drag.test.mjs`, `test/canvas-editing.test.mjs`, `test/canvas-editor-tools.multi.test.mjs`, `test/canvas-editor-tools.paste.test.mjs`, `test/canvas-sync.drag.test.mjs`, `test/canvas-sync.test.mjs`, `test/canvas-sync.undo.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `tools` | canvas | `test/canvas-cursors.test.mjs`, `test/canvas-editing.components.test.mjs`, `test/canvas-editing.test.mjs`, `test/canvas-editing.tools.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `zoomFit` | canvas | `test/canvas-editor.test.mjs` |
| `zoomIn` | canvas | `test/canvas-cursors.others.test.mjs`, `test/canvas-editor-tools.resize.test.mjs`, `test/canvas-editor.test.mjs` |
| `zoomOut` | canvas | `test/canvas-editing.tools.test.mjs`, `test/canvas-editor.test.mjs` |
| `zoomPct` | canvas | `test/canvas-editor.test.mjs` |

## Ids: `browser.html`

| item | view | read by |
|---|---|---|
| `addr` | browser | `test/browser-view-page.input.test.mjs`, `test/browser-view-page.test.mjs`, `test/lib/browser-view-page-fixture.mjs` |
| `again` | browser | `test/browser-view-page.test.mjs` |
| `area` | browser | `test/browser-view-page.test.mjs` |
| `ask` | browser | `test/browser-dialogs.handover.test.mjs`, `test/browser-view-page.test.mjs` |
| `ask-from` | browser | `test/browser-view-page.test.mjs` |
| `ask-said` | browser | `test/browser-dialogs.handover.test.mjs` |
| `ask-text` | browser | `test/browser-view-page.test.mjs` |
| `ask-yes` | browser | `test/browser-dialogs.handover.test.mjs`, `test/browser-view-page.test.mjs` |
| `back` | browser | `test/browser-view-page.input.test.mjs`, `test/browser-view-page.test.mjs` |
| `bye` | browser | `test/browser-view-page.test.mjs` |
| `cancel` | browser | `test/browser-view-page.input.test.mjs` |
| `chip` | browser | `test/browser-dialogs.handover.test.mjs`, `test/browser-view-page.test.mjs` |
| `confirm` | browser | `test/browser-view-page.input.test.mjs`, `test/browser-view-page.test.mjs` |
| `foot` | browser | `test/browser-view-page.test.mjs` |
| `forget` | browser | `test/browser-view-page.input.test.mjs`, `test/browser-view-page.test.mjs` |
| `note` | browser | `test/browser-view-page.test.mjs` |
| `screen` | browser | `test/browser-view-page.input.test.mjs`, `test/browser-view-page.test.mjs`, `test/lib/browser-view-page-fixture.mjs` |
| `signout` | browser | `test/browser-view-page.input.test.mjs`, `test/browser-view-page.test.mjs` |
| `waiting` | browser | `test/browser-view-page.test.mjs` |

## Classes: `index.html`

| item | view | read by |
|---|---|---|
| `act-head` | autonomy | `test/dashboard-peek.test.mjs` |
| `acts` | shell | `test/hub-overview.test.mjs` |
| `amber` | shell | `test/dashboard-library.test.mjs`, `test/hub-overview.test.mjs` |
| `app` | shell | `test/dashboard.viewer.test.mjs` |
| `ask` | thread | `test/dashboard-inbox-panel.test.mjs`, `test/pane-question.answer.page.test.mjs`, `test/presence-lens.test.mjs` |
| `ask-q` | thread | `test/dashboard-inbox-panel.test.mjs` |
| `att` | shell | `test/dashboard-board-progress.test.mjs` |
| `att-pill` | attachments | `test/dashboard-attachments.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-question-peek.test.mjs` |
| `att-q` | board | `test/dashboard-board-progress.test.mjs` |
| `attrs` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/next-step.strategy.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `attrs-h` | shell | `test/recurring-dashboard.test.mjs` |
| `av-ask-in` | viewer | `test/artifact-close-ask.test.mjs` |
| `av-bar` | viewer | `test/artifact-notes-press.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/org-access.view.test.mjs` |
| `av-kind` | shell | `test/dashboard-library.viewer.test.mjs` |
| `av-open` | shell | `test/dashboard-library.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs` |
| `av-pub-wrap` | viewer | `test/artifact-notes-press.test.mjs` |
| `av-ver-wrap` | viewer | `test/artifact-notes-press.test.mjs` |
| `aw-parts` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `b` | autonomy | `test/artifact-remote.test.mjs`, `test/canvas-pins.test.mjs` |
| `badge` | shell | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.preview.test.mjs`, `test/hub-overview.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/recurring-dashboard.test.mjs`, `test/settings-fleet-offline.test.mjs` |
| `bars` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `blocked` | board | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/hub-overview.test.mjs` |
| `board` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-peek.test.mjs` |
| `board-peek` | shell | `test/dashboard-board-progress.test.mjs` |
| `by` | thread | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `c2` | shell | `test/dashboard-overview-goals.test.mjs` |
| `c3` | shell | `test/dashboard-overview-goals.test.mjs` |
| `c6` | shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `card` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard.presses.test.mjs`, `test/hub-overview.test.mjs`, `test/next-step.strategy.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-failures.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `card-head` | shell | `test/dashboard-answers.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek-artifacts.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/hub-overview.test.mjs`, `test/library-card-menu.test.mjs`, `test/next-step.strategy.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-failures.test.mjs`, `test/recurring-jobs-page.test.mjs`, `test/settings-fleet-offline.test.mjs` |
| `cards` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-shell.test.mjs` |
| `cell` | shell | `test/dashboard-shell.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `check` | threads-panel | `test/artifact-notes-viewer.test.mjs` |
| `chip-name` | attachments | `test/dashboard-attachments.test.mjs` |
| `chip-next` | shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-question-peek.test.mjs` |
| `choice` | words | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/dashboard.threads-questions.test.mjs` |
| `choices` | words | `test/dashboard-overview-goals.test.mjs` |
| `click` | shell | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/artifact-remote.chrome.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek-artifacts.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/dashboard.presses.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/dashboard.viewer.test.mjs`, `test/hub-overview.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/project-hosts-e2e.test.mjs`, `test/pull-refresh.test.mjs`, `test/session-threads.test.mjs` |
| `closes` | words | `test/next-step.strategy.test.mjs` |
| `col` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard.typing.test.mjs` |
| `com` | shell | `test/dashboard-host-links.test.mjs` |
| `confirm` | shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs` |
| `count` | shell | `test/dashboard-efficiency.test.mjs` |
| `ctx` | shell | `test/dashboard-peek.test.mjs` |
| `db-t` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `diagram` | peek-kinds | `test/dashboard-peek.test.mjs` |
| `diagram-wrap` | peeks | `test/dashboard-peek.test.mjs` |
| `dim` | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `done` | shell | `test/artifact-live-reload.guards.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard.threads-questions.test.mjs` |
| `dot` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs`, `test/hub-overview.test.mjs` |
| `dragging` | goals | `test/dashboard-goals-reorder.test.mjs` |
| `drawer` | peeks | `test/dashboard-terminal-tabs.test.mjs` |
| `drawer-body` | peeks | `test/dashboard-peek.test.mjs` |
| `drawer-head` | peeks | `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs` |
| `drop-over` | shell | `test/dashboard-attachments.test.mjs` |
| `dropbox` | attachments | `test/artifact-notes-press.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-question-peek.test.mjs` |
| `dtitle` | peeks | `test/dashboard-autonomy.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/recurring-dashboard.test.mjs` |
| `dtype` | peeks | `test/dashboard-autonomy.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-peek.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/recurring-dashboard.test.mjs` |
| `e` | words | `test/dashboard-inbox-panel.test.mjs` |
| `eff-obs` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `eff-src` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `empty` | shell | `test/browser-e2e.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-threads-sidebar.test.mjs` |
| `end` | shell | `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs` |
| `err` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/hub-overview.test.mjs`, `test/settings-fleet-offline.test.mjs` |
| `extra` | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard.typing.test.mjs`, `test/lib/dashboard-library-fixture.mjs` |
| `fail` | shell | `test/dashboard-peek.test.mjs` |
| `file-chip` | attachments | `test/dashboard-attachments.test.mjs`, `test/dashboard-measure.test.mjs` |
| `filters` | board | `test/dashboard-board-progress.test.mjs` |
| `fit` | autonomy | `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-measure.test.mjs` |
| `flaky` | shell | `test/dashboard-peek.test.mjs` |
| `fleet-switch` | shell | `test/artifact-notes-press.test.mjs`, `test/dashboard-pages.test.mjs`, `test/hub-overview.test.mjs` |
| `foot` | shell | `test/hub-overview.test.mjs` |
| `fp-row` | autonomy | `test/dashboard-peek.test.mjs` |
| `from-thread` | shell | `test/dashboard-question-peek.test.mjs`, `test/dashboard.artifact-threads.test.mjs` |
| `g12` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs` |
| `gate-dot` | shell | `test/dashboard-peek.test.mjs` |
| `ghost` | shell | `test/dashboard-peek.test.mjs` |
| `goal` | goals | `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `goal-grip` | goals | `test/dashboard-goals-reorder.test.mjs` |
| `goal-next` | shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs` |
| `gone` | attachments | `test/dashboard-attachments.test.mjs` |
| `good` | shell | `test/dashboard-library.test.mjs`, `test/dashboard-pages.test.mjs` |
| `grow` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-overview-goals.test.mjs` |
| `handed` | threads-panel | `test/artifact-notes-viewer.test.mjs` |
| `heartbeat` | shell | `test/dashboard-overview-goals.test.mjs` |
| `high` | shell | `test/dashboard-library.test.mjs`, `test/dashboard-peek.test.mjs` |
| `hit` | board | `test/dashboard-board-progress.test.mjs` |
| `hot` | shell | `test/dashboard-autonomy.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `html` | shell | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-close-ask.test.mjs`, `test/artifact-pages.test.mjs`, `test/artifact-viewer-aim.test.mjs`, `test/validate-parts.test.mjs` |
| `icon-check` | threads-panel | `test/artifact-notes-viewer.test.mjs` |
| `icon-external-link` | shell | `test/dashboard-library.test.mjs` |
| `icon-globe` | library | `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs` |
| `icon-inbox` | shell | `test/dashboard-board-progress.test.mjs` |
| `icon-info` | overview | `test/dashboard-overview-goals.test.mjs` |
| `icon-layout-dashboard` | viewer | `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs` |
| `icon-link` | library | `test/dashboard-library.test.mjs` |
| `in-dock` | thread | `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs` |
| `in-panel` | shell | `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs` |
| `inc` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `k` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `kv` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-peek.test.mjs`, `test/next-step.strategy.test.mjs` |
| `l` | overview | `test/canvas-pins.test.mjs` |
| `language-exterior` | peek-kinds | `test/dashboard-exterior.test.mjs` |
| `lbl` | shell | `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/hub-overview.test.mjs` |
| `learning` | shell | `test/dashboard-loop.test.mjs` |
| `legend` | shell | `test/dashboard-efficiency.test.mjs` |
| `lib-body` | library | `test/dashboard-library.test.mjs`, `test/library-card-menu.test.mjs` |
| `lib-by` | library | `test/dashboard-library.test.mjs` |
| `lib-card` | library | `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/library-card-menu.test.mjs` |
| `lib-drift` | library | `test/dashboard-library.test.mjs` |
| `lib-for` | library | `test/dashboard-library.test.mjs` |
| `lib-menu-note` | library | `test/library-card-menu.test.mjs` |
| `lib-menu-pub` | library | `test/library-card-menu.test.mjs` |
| `lib-meta` | library | `test/dashboard-library.test.mjs` |
| `lib-pub` | library | `test/library-card-menu.test.mjs` |
| `lib-tab` | library | `test/dashboard-library.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs` |
| `lib-thumb` | library | `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/library-card-menu.test.mjs` |
| `lib-title` | library | `test/artifact-remote.chrome.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/library-card-menu.test.mjs` |
| `lib-wt` | library | `test/dashboard-library.test.mjs` |
| `limit` | settings | `test/dashboard-pages.test.mjs` |
| `lineage` | peek-kinds | `test/dashboard-peek.test.mjs`, `test/dashboard.loop-goals.test.mjs` |
| `lineage-list` | loop | `test/dashboard.loop-goals.test.mjs` |
| `lineage-node` | shell | `test/dashboard.loop-goals.test.mjs` |
| `linkish` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-peek.test.mjs` |
| `links` | shell | `test/browser-e2e.test.mjs`, `test/dashboard-peek.test.mjs` |
| `loading` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/next-step.strategy.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `loop-intro` | loop | `test/dashboard-loop.test.mjs` |
| `lvl` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-measure.test.mjs` |
| `lvls` | autonomy | `test/dashboard-measure.test.mjs` |
| `lw` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `main` | shell | `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-resolve.test.mjs` |
| `md` | shell | `test/components.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/next-step.strategy.test.mjs`, `test/self-plain.test.mjs`, `test/split-parity.test.mjs`, `test/validate-parts.test.mjs` |
| `measure` | shell | `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/recurring-dashboard.test.mjs` |
| `medium` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-peek.test.mjs` |
| `menu` | words | `test/dashboard-board-progress.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/library-card-menu.test.mjs` |
| `meta` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/org-access.attribution.test.mjs`, `test/session-threads.test.mjs` |
| `meter` | board | `test/dashboard-peek.test.mjs` |
| `mini` | shell | `test/dashboard-efficiency.test.mjs`, `test/dashboard-peek.test.mjs` |
| `mosaic` | overview | `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs` |
| `msg` | shell | `test/dashboard-pages.test.mjs`, `test/hub-overview.test.mjs` |
| `muted` | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.artifact-threads.test.mjs` |
| `n` | shell | `test/artifact-handover-reminder.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/hub-overview.test.mjs` |
| `nav` | shell | `test/artifact-handover-reminder.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `next` | words | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs` |
| `nl` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-pages.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `no-shell` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs` |
| `nogoal` | board | `test/dashboard-board-progress.test.mjs` |
| `none` | shell | `test/recurring-jobs-page.test.mjs` |
| `now` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs` |
| `nums` | peek-kinds | `test/dashboard-peek.test.mjs` |
| `ok` | threads-panel | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs` |
| `on` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `ov-goal` | overview | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `ov-goals` | overview | `test/hub-overview.test.mjs` |
| `ov-head` | overview | `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `ov-pill` | overview | `test/dashboard-overview-goals.test.mjs` |
| `overlay-open` | shell | `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs` |
| `owner` | threads-panel | `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/org-access.attribution.test.mjs`, `test/thread-responding.test.mjs` |
| `page` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `pagebar` | shell | `test/dashboard-attachments.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/dashboard.typing.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/pane-question.answer.page.test.mjs`, `test/pull-refresh.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `part` | shell | `test/gateway.test.mjs` |
| `peek-open` | peeks | `test/dashboard-autonomy.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-terminal-tabs.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `ph` | peeks | `test/dashboard-peek.test.mjs` |
| `phase-strip` | peeks | `test/dashboard-peek.test.mjs` |
| `picked` | data | `test/dashboard.threads-questions.test.mjs` |
| `pill` | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/hub-overview.test.mjs` |
| `pill-name` | attachments | `test/dashboard-attachments.test.mjs` |
| `pill-size` | attachments | `test/dashboard-attachments.test.mjs` |
| `pill-why` | attachments | `test/dashboard-attachments.test.mjs`, `test/dashboard-measure.test.mjs` |
| `pills` | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-question-peek.test.mjs` |
| `pinchip` | threads-panel | `test/dashboard-threads-sidebar.test.mjs` |
| `pl-head` | goals | `test/dashboard-board-progress.test.mjs` |
| `plain` | shell | `test/dashboard-library.viewer.test.mjs` |
| `planners` | board | `test/dashboard-board-progress.test.mjs` |
| `plcard` | goals | `test/dashboard-board-progress.test.mjs` |
| `pop` | words | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/artifact-viewer-box.test.mjs`, `test/autonomy-suggestions.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/gateway.test.mjs` |
| `props` | shell | `test/dashboard-question-peek.test.mjs` |
| `psect` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek-artifacts.test.mjs`, `test/dashboard-peek.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-failures.test.mjs` |
| `psect-body` | peeks | `test/dashboard-autonomy.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `pulse` | shell | `test/dashboard-shell.test.mjs` |
| `q` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/hub-overview.test.mjs` |
| `qcard` | shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.threads-questions.test.mjs` |
| `qref` | words | `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs` |
| `r` | shell | `test/canvas-pins.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/hub-overview.test.mjs` |
| `ready-blocker` | settings | `test/dashboard-pages.test.mjs`, `test/settings-fleet-offline.test.mjs` |
| `ready-card` | settings | `test/dashboard-pages.test.mjs`, `test/settings-fleet-offline.test.mjs` |
| `ready-pending` | settings | `test/dashboard-pages.test.mjs` |
| `rec` | words | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard.loop-goals.test.mjs` |
| `red` | shell | `test/dashboard-shell.test.mjs` |
| `refused` | words | `test/dashboard-measure.test.mjs` |
| `reviewing` | review | `test/dashboard-pages.test.mjs` |
| `row` | board | `test/dashboard-board-progress.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.loop-goals.test.mjs` |
| `row-inline` | shell | `test/artifact-notes-press.test.mjs`, `test/dashboard-inbox-panel.test.mjs` |
| `rowline` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs` |
| `rows` | shell | `test/dashboard-library.viewer.test.mjs` |
| `rulebox` | words | `test/dashboard-inbox-panel.test.mjs` |
| `score` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `score-w` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `sec` | shell | `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/hub-overview.test.mjs` |
| `sec-b` | shell | `test/dashboard-autonomy.test.mjs` |
| `secret` | words | `test/artifact-remote.test.mjs`, `test/dashboard-overview-goals.test.mjs` |
| `secrets` | words | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs` |
| `seg` | shell | `test/dashboard-pages.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/hub-overview.test.mjs` |
| `sensor-card` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-measure.test.mjs` |
| `sensor-rows` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `set` | shell | `test/hub-overview.test.mjs` |
| `set-desc` | settings | `test/dashboard-pages.test.mjs`, `test/hub-overview.test.mjs` |
| `set-key` | settings | `test/dashboard-pages.test.mjs`, `test/hub-overview.test.mjs` |
| `set-label` | settings | `test/dashboard-pages.test.mjs` |
| `set-name` | settings | `test/dashboard-pages.test.mjs`, `test/dashboard.threads-server.test.mjs` |
| `set-row` | settings | `test/dashboard-pages.test.mjs`, `test/hub-overview.test.mjs`, `test/project-hosts-e2e.test.mjs` |
| `set-val` | settings | `test/dashboard-pages.test.mjs` |
| `settings` | shell | `test/dashboard-pages.test.mjs` |
| `sheet` | thread | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `shell` | shell | `test/dashboard-shell.test.mjs`, `test/dashboard-terminal-tabs.test.mjs` |
| `side` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.typing.test.mjs`, `test/org-access.view.test.mjs`, `test/pull-refresh.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `sign` | loop | `test/dashboard-loop.test.mjs` |
| `small` | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-peek.test.mjs` |
| `sort` | shell | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-pages.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `spark` | autonomy | `test/dashboard-peek.test.mjs` |
| `sparkline` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-overview-goals.test.mjs` |
| `spinning` | overview | `test/pull-refresh.test.mjs` |
| `split` | autonomy | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-viewer-box.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/library-card-menu.test.mjs` |
| `stale` | shell | `test/artifact-live-reload.guards.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard.reload.test.mjs` |
| `stat` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-overview-goals.test.mjs` |
| `stats` | overview | `test/dashboard-overview-goals.test.mjs` |
| `status-trail` | peek-kinds | `test/dashboard-peek.test.mjs` |
| `step-sub` | shell | `test/dashboard-overview-goals.test.mjs` |
| `stepper` | settings | `test/dashboard-pages.test.mjs` |
| `steps` | shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs` |
| `stuck` | shell | `test/dashboard-board-progress.test.mjs` |
| `sub` | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs` |
| `sugg-go` | autonomy | `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `sugg-i` | autonomy | `test/autonomy-suggestions.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-measure.test.mjs` |
| `sugg-n` | autonomy | `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `sum` | overview | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `t` | shell | `test/artifact-live-reload.test.mjs`, `test/canvas-pins.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/hub-overview.test.mjs` |
| `tabbar` | shell | `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard.threads-card.test.mjs` |
| `tag` | shell | `test/dashboard-inbox-panel.test.mjs` |
| `tc-head` | board | `test/dashboard-board-progress.test.mjs` |
| `tcard` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-peek.test.mjs` |
| `term-ask` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `term-box` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `term-hint` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `term-plain` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `term-screen` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `term-state` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `term-wrap` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `th` | threads-panel | `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/hub-overview.test.mjs` |
| `th-row` | threads-panel | `test/dashboard-measure.test.mjs`, `test/dashboard-threads-sidebar.test.mjs` |
| `th-s` | threads-panel | `test/dashboard-threads-sidebar.test.mjs` |
| `th-shot` | viewer | `test/artifact-notes-viewer.test.mjs` |
| `th-st` | threads-panel | `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-pins.test.mjs` |
| `th-w` | threads-panel | `test/dashboard-threads-sidebar.test.mjs` |
| `th-where` | threads-panel | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-threads-sidebar.test.mjs` |
| `threads` | threads-panel | `test/artifact-handover-reminder.test.mjs` |
| `threads-head` | threads-panel | `test/dashboard-terminal-tabs.test.mjs`, `test/dashboard-threads-sidebar.test.mjs` |
| `threads-open` | shell | `test/artifact-handover-reminder.test.mjs`, `test/dashboard-answers.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-terminal-tabs.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/dashboard.presses.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/dashboard.typing.test.mjs`, `test/next-step.strategy.test.mjs`, `test/pane-question.answer.page.test.mjs`, `test/pull-refresh.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `title-link` | shell | `test/dashboard-peek.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/next-step.strategy.test.mjs` |
| `tl` | shell | `test/dashboard-peek.test.mjs` |
| `tl-addr` | thread | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs` |
| `tl-aiming` | threads-panel | `test/dashboard.threads-card.test.mjs` |
| `tl-card` | threads-panel | `test/dashboard-inbox-panel.test.mjs` |
| `tl-compose` | threads-panel | `test/artifact-notes-press.test.mjs` |
| `tl-ctx` | threads-panel | `test/dashboard.threads-card.test.mjs` |
| `tl-marked` | threads-panel | `test/dashboard-pages.test.mjs` |
| `tl-nview` | thread | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `tl-pin` | viewer | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-q` | thread | `test/dashboard.threads-questions.test.mjs` |
| `tl-ready` | thread | `test/dashboard.threads-resolve.test.mjs` |
| `tl-shot` | viewer | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `tl-shot-cap` | viewer | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `tl-text` | thread | `test/artifact-notes-viewer.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-turn` | thread | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/org-access.attribution.test.mjs`, `test/session-threads.test.mjs`, `test/thread-responding.test.mjs` |
| `tl-turns` | threads-panel | `test/artifact-notes-press.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `tl-wd` | thread | `test/artifact-notes-viewer.test.mjs` |
| `tl-words` | thread | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs` |
| `tldr` | peeks | `test/dashboard-peek.test.mjs` |
| `top` | words | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/browser-dialogs.handover.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/hub-overview.test.mjs`, `test/lib/artifact-live.mjs`, `test/next-step.strategy.test.mjs`, `test/pull-refresh.test.mjs` |
| `top-why` | words | `test/next-step.strategy.test.mjs` |
| `trust-card` | autonomy | `test/autonomy-suggestions.test.mjs`, `test/dashboard-measure.test.mjs` |
| `tt` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/pane-question.answer.page.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `tw` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `tx` | shell | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/dashboard-shell.test.mjs` |
| `untrusted` | peek-kinds | `test/dashboard-peek.test.mjs` |
| `upkeep` | goals | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `ver-pill` | viewer | `test/dashboard-library.viewer.test.mjs` |
| `view-only` | shell | `test/artifact-close-ask.test.mjs`, `test/hub-overview.test.mjs`, `test/org-access.view.test.mjs` |
| `viewbar` | peek-kinds | `test/dashboard-peek.test.mjs` |
| `viewer` | shell | `test/artifact-viewer-box.test.mjs`, `test/dashboard-attachments.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.preview.test.mjs`, `test/dashboard.reload.test.mjs`, `test/dashboard.viewer.test.mjs`, `test/fixtures/artifact-viewer/harness.mjs` |
| `wait` | threads-panel | `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-pins.test.mjs` |
| `waiting` | shell | `test/artifact-annotations-e2e.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-exterior.test.mjs`, `test/dashboard-goals-reorder.test.mjs`, `test/dashboard-loop.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek-artifacts.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/fixtures/artifact-notes-viewer/kit.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/library-card-menu.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-failures.test.mjs`, `test/recurring-jobs-page.test.mjs`, `test/settings-fleet-offline.test.mjs` |
| `wave-goals` | board | `test/dashboard-board-progress.test.mjs` |
| `why` | words | `test/dashboard-inbox-panel.test.mjs`, `test/next-step.strategy.test.mjs` |
| `xh` | board | `test/dashboard-board-progress.test.mjs` |
| `xterm` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `you` | threads-panel | `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-pins.test.mjs` |

## Classes: `canvas.html`

| item | view | read by |
|---|---|---|
| `bar` | canvas | `test/canvas-editor.test.mjs` |
| `clabel` | canvas | `test/canvas-editor.test.mjs` |
| `cursor` | canvas-presence | `test/lib/canvas-cursors-fixture.mjs` |
| `cursor-name` | canvas-presence | `test/lib/canvas-cursors-fixture.mjs` |
| `draft` | canvas | `test/canvas-editing.tools.test.mjs`, `test/canvas-editor-tools.resize.test.mjs`, `test/canvas-editor-tools.test.mjs` |
| `fnote` | canvas-panels | `test/canvas-editing.components.test.mjs` |
| `handle` | canvas-editing | `test/canvas-editor-tools.resize.test.mjs` |
| `ic` | canvas-panels | `test/canvas-editor.test.mjs` |
| `layer` | canvas-panels | `test/canvas-cursors.others.test.mjs`, `test/canvas-cursors.test.mjs`, `test/canvas-editing.components.test.mjs`, `test/canvas-editing.drag.test.mjs`, `test/canvas-editing.panel.test.mjs`, `test/canvas-editing.test.mjs`, `test/canvas-editor-tools.multi.test.mjs`, `test/canvas-editor-tools.paste.test.mjs`, `test/canvas-editor-tools.resize.test.mjs`, `test/canvas-editor-tools.test.mjs`, `test/canvas-editor.test.mjs`, `test/canvas-pins.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `left` | canvas | `test/canvas-editing.tools.test.mjs`, `test/canvas-editor.test.mjs`, `test/canvas-pins.test.mjs` |
| `nm` | canvas-panels | `test/canvas-editing.components.test.mjs`, `test/canvas-editing.panel.test.mjs`, `test/canvas-editor-tools.paste.test.mjs`, `test/canvas-editor.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `note` | canvas | `test/canvas-editing.components.test.mjs`, `test/canvas-editing.panel.test.mjs`, `test/canvas-editor.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `panel` | canvas | `test/canvas-editor.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `pen` | canvas-history | `test/canvas-editing.tools.test.mjs` |
| `pin` | canvas-presence | `test/canvas-pins.test.mjs` |
| `pinning` | canvas-presence | `test/canvas-pins.test.mjs` |
| `placeholder` | canvas | `test/canvas-editor.test.mjs` |
| `prow` | canvas | `test/lib/canvas-fixture.mjs` |
| `ptitle` | canvas | `test/lib/canvas-fixture.mjs` |
| `public` | canvas | `test/canvas-editor.test.mjs` |
| `repo-name` | canvas | `test/canvas-editor.test.mjs` |
| `repo-vis` | canvas | `test/canvas-editor.test.mjs` |
| `right` | canvas | `test/canvas-editing.tools.test.mjs`, `test/canvas-editor.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `sel` | canvas-panels | `test/canvas-editing.components.test.mjs`, `test/canvas-editor-tools.test.mjs`, `test/canvas-editor.test.mjs` |
| `space` | canvas-panels | `test/canvas-editor.test.mjs` |
| `stage-top` | canvas | `test/canvas-pins.test.mjs` |
| `tag` | canvas-presence | `test/lib/canvas-cursors-fixture.mjs` |
| `text` | canvas-presence | `test/canvas-pins.test.mjs` |
| `turn` | canvas-presence | `test/canvas-pins.test.mjs` |
| `v` | canvas-panels | `test/canvas-editing.components.test.mjs`, `test/canvas-editor.test.mjs` |
| `who` | canvas-presence | `test/canvas-pins.test.mjs` |
| `zoom` | canvas | `test/canvas-editor.test.mjs`, `test/canvas-pins.test.mjs` |

## Classes: `browser.html`

| item | view | read by |
|---|---|---|
| `down` | browser | `test/browser-view-page.test.mjs` |

## Roles: `index.html`

| item | view | read by |
|---|---|---|
| `alertdialog` | viewer | `test/artifact-close-ask.test.mjs` |
| `button` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard.threads-server.test.mjs`, `test/gateway.test.mjs` |
| `img` | shell | `test/canvas-note-anchor.test.mjs`, `test/dashboard-board-progress.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-pins.test.mjs` |
| `link` | shell | `test/artifact-handover-reminder.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard.threads-server.test.mjs` |
| `listbox` | viewer | `test/dashboard-library.viewer.test.mjs` |
| `option` | library | `test/lib/dashboard-library-fixture.mjs` |
| `status` | shell | `test/artifact-handover-reminder.test.mjs`, `test/thread-responding.test.mjs` |
| `tab` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-terminal-tabs.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-answered.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-pins.test.mjs`, `test/dashboard.threads-questions.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/hub-overview.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/pane-question.answer.page.test.mjs`, `test/project-hosts-e2e.test.mjs`, `test/pull-refresh.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `tablist` | shell | `test/dashboard-shell.test.mjs` |
| `tabpanel` | shell | `test/dashboard-shell.test.mjs` |

## Roles: `canvas.html`

| item | view | read by |
|---|---|---|
| `button` | canvas-panels | `test/canvas-editing.test.mjs` |
| `status` | canvas | `test/canvas-editing.test.mjs` |
| `toolbar` | canvas | `test/canvas-editing.tools.test.mjs` |

## Texts: `index.html`

| item | view | read by |
|---|---|---|
| `1 file dropped` | attachments | `test/dashboard-attachments.test.mjs` |
| `A check` | peek-kinds | `test/recurring-failures.test.mjs` |
| `a command that only looks, in a clean checkout of main` | peek-kinds | `test/recurring-dashboard.test.mjs` |
| `a goal` | shell | `test/dashboard-library.test.mjs`, `test/dashboard.threads-server.test.mjs` |
| `a question` | shell | `test/dashboard-board-progress.test.mjs` |
| `a suggestion` | threads-core | `test/autonomy-suggestions.test.mjs` |
| `Active` | shell | `test/dashboard-board-progress.test.mjs` |
| `Add a note` | shell | `test/dashboard-inbox-panel.test.mjs` |
| `Agreed with you` | shell | `test/dashboard-autonomy.test.mjs` |
| `All features` | board | `test/dashboard-board-progress.test.mjs` |
| `All goals` | board | `test/dashboard-board-progress.test.mjs`, `test/dashboard-library.test.mjs` |
| `All jobs` | peek-kinds | `test/recurring-jobs-page.test.mjs` |
| `All kinds` | board | `test/dashboard-library.test.mjs` |
| `always on` | goals | `test/dashboard-overview-goals.test.mjs` |
| `an action` | threads-core | `test/dashboard.threads-server.test.mjs` |
| `Answer` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-question-peek.test.mjs` |
| `Answer it here` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `Answer it in the Inbox` | shell | `test/dashboard-question-peek.test.mjs`, `test/dashboard.threads-resolve.test.mjs` |
| `Answer questions on the dashboard.` | threads-panel | `test/dashboard-inbox-panel.test.mjs` |
| `Answered:` | shell | `test/dashboard.typing.test.mjs` |
| `Approve` | shell | `test/dashboard.goals.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/gateway.test.mjs`, `test/goal-approval-choices.test.mjs` |
| `Approved` | shell | `test/dashboard-overview-goals.test.mjs` |
| `ArrowDown` | shell | `test/artifact-notes-press.test.mjs` |
| `ArrowLeft` | shell | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-shell.test.mjs`, `test/gateway.test.mjs` |
| `ArrowRight` | shell | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-shell.test.mjs`, `test/gateway.test.mjs` |
| `Asked` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `asks you first` | words | `test/dashboard-inbox-panel.test.mjs` |
| `at a usage limit` | shell | `test/gateway.test.mjs`, `test/hub-overview.test.mjs` |
| `At most` | shell | `test/dashboard-autonomy.test.mjs` |
| `Autonomous` | shell | `test/ooda-learning.test.mjs` |
| `Autonomy` | shell | `test/dashboard-overview-goals.test.mjs` |
| `autonomy score` | overview | `test/dashboard-overview-goals.test.mjs` |
| `Awareness` | shell | `test/dashboard-autonomy.test.mjs` |
| `awareness score` | overview | `test/dashboard-overview-goals.test.mjs` |
| `Awareness Score` | shell | `test/dashboard-autonomy.test.mjs` |
| `Back to the threads` | threads-panel | `test/dashboard-threads-sidebar.test.mjs` |
| `Backlog` | board | `test/dashboard-board-progress.test.mjs` |
| `Being fixed` | peek-kinds | `test/recurring-dashboard.test.mjs` |
| `Board` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-question-peek.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard.threads-server.test.mjs` |
| `Building` | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `Built` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Built in` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Burn-up` | board | `test/dashboard-board-progress.test.mjs` |
| `cache reads` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `cache reads of input tokens` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `cache writes` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Can’t right now` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-owner-action.test.mjs` |
| `changed since` | shell | `test/dashboard-efficiency.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.artifacts.test.mjs` |
| `Check now` | settings | `test/dashboard-pages.test.mjs` |
| `Checks before merge` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `Choose Approve, Refine or Let go.` | data | `test/dashboard.loop-goals.test.mjs` |
| `chore, by a worker` | peek-kinds | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `chore, by the supervisor` | peek-kinds | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Chores in flight` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Chrome` | terminal | `test/artifact-annotations-e2e.test.mjs` |
| `Click the page, then hold Shift to point at something` | viewer | `test/dashboard.viewer.test.mjs` |
| `Close without handing over?` | viewer | `test/artifact-close-ask.test.mjs` |
| `Commit history` | overview | `test/dashboard-overview-goals.test.mjs` |
| `Complete` | board | `test/dashboard-board-progress.test.mjs` |
| `Confirm let go` | shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard-peek.test.mjs`, `test/dashboard-question-peek.test.mjs` |
| `Copied` | data | `test/dashboard-peek.test.mjs` |
| `Copy ID` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-peek.test.mjs` |
| `Copy public link` | library | `test/library-card-menu.test.mjs` |
| `Correct` | shell | `test/dashboard-loop.test.mjs` |
| `Corrected` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-peek.test.mjs` |
| `Correction sent` | data | `test/next-step.strategy.test.mjs` |
| `costly ticket` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Created` | peeks | `test/dashboard-peek.test.mjs` |
| `critical path` | board | `test/dashboard-board-progress.test.mjs` |
| `Dark` | viewer | `test/artifact-notes-viewer.test.mjs` |
| `Decide` | shell | `test/ooda-lineage.test.mjs` |
| `decides, then tells you` | words | `test/dashboard-inbox-panel.test.mjs` |
| `Decision` | shell | `test/dashboard-inbox-panel.test.mjs` |
| `Defined` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Defining` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Diagram` | library | `test/dashboard-library.test.mjs`, `test/dashboard-peek-artifacts.test.mjs` |
| `Docs` | library | `test/dashboard-library.test.mjs` |
| `Done` | shell | `test/browser-handover.close.test.mjs`, `test/browser-handover.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-owner-action.test.mjs` |
| `Done: kept` | words | `test/dashboard-owner-action.test.mjs` |
| `Done: retired` | words | `test/dashboard-owner-action.test.mjs` |
| `down since` | shell | `test/dashboard-library.test.mjs` |
| `Drain` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Drawn by` | library | `test/dashboard-library.viewer.test.mjs` |
| `Efficiency` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `efficiency score` | overview | `test/dashboard-overview-goals.test.mjs` |
| `Efficiency Score` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Enter` | shell | `test/artifact-notes-press.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/browser-dialogs.handover-end.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-shell.test.mjs`, `test/fast-threads-e2e.test.mjs` |
| `Error` | shell | `test/dashboard-library.viewer.test.mjs` |
| `Escape` | shell | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-loop.test.mjs` |
| `escaped defects` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Every` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Every fleet` | shell | `test/hub-overview.test.mjs` |
| `Every view` | board | `test/dashboard-board-progress.test.mjs` |
| `Everything` | shell | `test/dashboard-board-progress.test.mjs` |
| `Evidence` | peek-kinds | `test/dashboard-loop.test.mjs` |
| `Explain something that keeps happening` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `Exterior` | peek-kinds | `test/dashboard-exterior.test.mjs` |
| `Failing means` | shell | `test/recurring-dashboard.test.mjs` |
| `Fails in a row` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Features` | shell | `test/dashboard-board-progress.test.mjs` |
| `File` | shell | `test/dashboard-library.test.mjs` |
| `Files` | shell | `test/dashboard-autonomy.test.mjs` |
| `Findings` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `Fingerprints` | shell | `test/dashboard-autonomy.test.mjs` |
| `Fixing` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `Flaky tests` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `Fleet and capacity` | settings | `test/dashboard-pages.test.mjs` |
| `Forget` | shell | `test/dashboard-library.test.mjs`, `test/library-card-menu.test.mjs` |
| `Fresh` | peek-kinds | `test/components.test.mjs` |
| `Friday` | peek-kinds | `test/fast-threads-e2e.test.mjs` |
| `From main` | viewer | `test/artifact-notes-viewer.test.mjs` |
| `From the supervisor` | shell | `test/supervisor-thread-new.test.mjs` |
| `Fully blocked` | shell | `test/hub-overview.test.mjs` |
| `Given to` | peek-kinds | `test/dashboard-loop.test.mjs` |
| `Goal` | shell | `test/recurring-dashboard.test.mjs` |
| `Goals` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/dashboard.threads-server.test.mjs` |
| `Goes to` | shell | `test/dashboard-loop.test.mjs` |
| `Governance` | shell | `test/dashboard-autonomy.test.mjs` |
| `HEAD` | shell | `test/artifact-versions.test.mjs`, `test/gateway.test.mjs`, `test/hub-overview.test.mjs`, `test/lib/dashboard-library-fixture.mjs`, `test/library-card-menu.test.mjs`, `test/multirepo-views.test.mjs`, `test/org-access.view.test.mjs`, `test/split-parity.test.mjs` |
| `Held` | shell | `test/session-threads.test.mjs` |
| `Held because` | shell | `test/dashboard-overview-goals.test.mjs` |
| `held down: an escaped defect this week` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `high risk` | board | `test/dashboard-board-progress.test.mjs` |
| `History` | peeks | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek-artifacts.test.mjs`, `test/dashboard-peek.test.mjs`, `test/recurring-failures.test.mjs` |
| `Hold` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Home` | shell | `test/dashboard-shell.test.mjs` |
| `Hours by phase` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `hours per merged point` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `How it changes` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `Inbox` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-shell.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/hub-overview.test.mjs` |
| `Incidents` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `Include routine acts` | board | `test/dashboard-loop.test.mjs` |
| `Informed` | shell | `test/dashboard-loop.test.mjs`, `test/ooda-learning.test.mjs` |
| `Investigating` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `Jobs` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Keep it` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-owner-action.test.mjs` |
| `Keep the prompt cache` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Kind` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Kind of decision` | shell | `test/dashboard-autonomy.test.mjs` |
| `Kit sync` | peek-kinds | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Landed on main` | library | `test/dashboard-library.viewer.test.mjs` |
| `Last` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Last changed` | peeks | `test/dashboard-peek.test.mjs` |
| `Last run` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Learn` | shell | `test/ooda-lineage.test.mjs` |
| `Learn from a fixed incident` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `Left` | shell | `test/dashboard-question-peek.test.mjs` |
| `let go` | shell | `test/dashboard-owner-action.test.mjs` |
| `Let go` | shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard.goals.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/goal-approval-choices.test.mjs` |
| `Library` | shell | `test/dashboard-inbox-panel.test.mjs` |
| `Library item` | peeks | `test/dashboard-library.viewer.test.mjs` |
| `Link` | library | `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs` |
| `Loading…` | shell | `test/dashboard-copy.test.mjs` |
| `Loop` | threads-core | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard.threads-resolve.test.mjs`, `test/dashboard.threads-server.test.mjs` |
| `Loop, Decide` | threads-core | `test/dashboard-efficiency.test.mjs` |
| `Loop, Observe` | threads-core | `test/dashboard.threads-server.test.mjs` |
| `low cache hits` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Merged` | shell | `test/dashboard-board-progress.test.mjs` |
| `merged points` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Message` | shell | `test/dashboard-threads-sidebar.test.mjs` |
| `Met?` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Milestones` | shell | `test/dashboard-board-progress.test.mjs` |
| `Mixed` | shell | `test/hub-overview.test.mjs` |
| `Mock` | shell | `test/artifact-remote.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/dashboard-shell.test.mjs` |
| `Move down` | goals | `test/dashboard-goals-reorder.test.mjs` |
| `Move up` | goals | `test/dashboard-goals-reorder.test.mjs` |
| `Moving` | shell | `test/hub-overview.test.mjs` |
| `Needs orienting` | shell | `test/dashboard-loop.test.mjs` |
| `Needs you` | shell | `test/dashboard-overview-goals.test.mjs` |
| `New thread` | threads-panel | `test/dashboard-threads-sidebar.test.mjs` |
| `Next` | shell | `test/dashboard-overview-goals.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Next retro` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `No reason given` | peek-kinds | `test/dashboard-overview-goals.test.mjs` |
| `no subject` | threads-core | `test/artifact-note-shots.test.mjs`, `test/dashboard.threads-server.test.mjs` |
| `None` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-copy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-library.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/project-hosts-e2e.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `None this week` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `not answering` | shell | `test/dashboard.artifacts.test.mjs`, `test/gateway.test.mjs` |
| `Not answering` | shell | `test/hub-overview.test.mjs` |
| `Not done yet` | words | `test/dashboard-owner-action.test.mjs` |
| `not found` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-library.viewer.test.mjs`, `test/devteam-mjs-regions.test.mjs` |
| `not in the log` | peeks | `test/artifact-note-shots.test.mjs` |
| `Not oriented yet` | loop | `test/ooda-lineage.test.mjs` |
| `Not public` | library | `test/dashboard-library.viewer.test.mjs` |
| `not run yet` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Not the published version: this is the one on main` | data | `test/dashboard.viewer.test.mjs` |
| `not yet` | shell | `test/dashboard.presses.test.mjs` |
| `Not yet` | thread | `test/dashboard.threads-resolve.test.mjs` |
| `not yet: you answered in your own words, which the supervisor reads` | loop | `test/dashboard.presses.test.mjs` |
| `Notes` | shell | `test/artifact-notes-cli.test.mjs`, `test/dashboard-library.viewer.test.mjs` |
| `Nothing` | shell | `test/gateway.test.mjs` |
| `Nothing measured: spend shows only what agents reported` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Nothing to click here. With account rotation set up` | thread | `test/dashboard-inbox-panel.test.mjs` |
| `nothing to do` | peek-kinds | `test/recurring-dashboard.test.mjs` |
| `Noticed` | shell | `test/recurring-jobs-page.test.mjs` |
| `Numbers` | overview | `test/dashboard-overview-goals.test.mjs`, `test/gateway.test.mjs` |
| `Observation` | shell | `test/dashboard.loop-goals.test.mjs` |
| `Observations` | shell | `test/dashboard-autonomy.test.mjs` |
| `Observations it made` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `Observe` | shell | `test/ooda-lineage.test.mjs` |
| `often late` | peek-kinds | `test/recurring-dashboard.test.mjs` |
| `On the critical path: it delays the goal` | board | `test/dashboard-board-progress.test.mjs` |
| `Only corrected` | board | `test/dashboard-loop.test.mjs` |
| `Open` | shell | `test/dashboard-autonomy.test.mjs`, `test/supervisor-thread-new.test.mjs` |
| `Open in a new tab` | shell | `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.preview.test.mjs` |
| `Open in new tab` | viewer | `test/dashboard.artifact-threads.test.mjs` |
| `Open in side peek` | words | `test/dashboard-library.test.mjs`, `test/dashboard-peek.test.mjs` |
| `open questions` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Open the dashboard in its own tab` | shell | `test/dashboard.viewer.test.mjs` |
| `Open the review` | review | `test/dashboard-inbox-panel.test.mjs` |
| `Order` | words | `test/dashboard-inbox-panel.test.mjs` |
| `Orient` | shell | `test/dashboard-loop.test.mjs`, `test/ooda-lineage.test.mjs` |
| `Overrule` | shell | `test/dashboard-inbox-panel.test.mjs` |
| `Overview` | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-threads-sidebar.test.mjs`, `test/hub-overview.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `Park` | shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `Parked` | shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `picked it up.` | threads-core | `test/artifact-notes-viewer.test.mjs` |
| `Plan` | shell | `test/session-threads.test.mjs` |
| `Planned` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Planners` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Planning` | shell | `test/dashboard-board-progress.test.mjs` |
| `Points per week` | board | `test/dashboard-board-progress.test.mjs` |
| `Post` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs` |
| `POST` | shell | `test/artifact-versions.test.mjs`, `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard.artifact-threads.test.mjs`, `test/dashboard.instances.test.mjs`, `test/dashboard.presses.test.mjs`, `test/dashboard.threads-server.test.mjs`, `test/gateway.test.mjs`, `test/operator-threads.hub.test.mjs`, `test/org-access.attribution.test.mjs`, `test/pane-question.answer.test.mjs` |
| `Preview` | shell | `test/dashboard-library.test.mjs` |
| `Process` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `Progress` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-pages.test.mjs`, `test/dashboard-peek-artifacts.test.mjs` |
| `Project` | shell | `test/dashboard-autonomy.test.mjs` |
| `Proposed by the supervisor` | thread | `test/artifact-notes-viewer.test.mjs` |
| `Proposed job` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Proposed jobs` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Public` | library | `test/dashboard-library.test.mjs`, `test/dashboard-library.viewer.test.mjs` |
| `Public · update available` | library | `test/dashboard-library.viewer.test.mjs` |
| `Public on this box` | library | `test/dashboard-library.test.mjs` |
| `Publish` | library | `test/library-card-menu.test.mjs` |
| `Published` | library | `test/dashboard-library.viewer.test.mjs` |
| `px wide` | viewer | `test/dashboard-board-progress.test.mjs` |
| `Rated` | words | `test/dashboard-inbox-panel.test.mjs` |
| `Read it first` | shell | `test/artifact-notes-viewer.test.mjs` |
| `Reading the threads…` | threads-panel | `test/dashboard-copy.test.mjs` |
| `Ready` | shell | `test/dashboard-board-progress.test.mjs` |
| `Ready to move?` | settings | `test/dashboard-pages.test.mjs` |
| `Recent runs` | peek-kinds | `test/recurring-dashboard.test.mjs` |
| `Record` | shell | `test/dashboard-peek.test.mjs` |
| `recurring signal` | shell | `test/dashboard-loop.test.mjs` |
| `Recurring signal` | shell | `test/dashboard.loop-goals.test.mjs` |
| `Refine` | shell | `test/dashboard.goals.test.mjs`, `test/dashboard.loop-goals.test.mjs`, `test/goal-approval-choices.test.mjs` |
| `Registered by` | shell | `test/recurring-dashboard.test.mjs` |
| `Registry attestation` | goals | `test/dashboard-overview-goals.test.mjs` |
| `Released` | board | `test/dashboard-board-progress.test.mjs` |
| `Releases` | shell | `test/dashboard-board-progress.test.mjs` |
| `Reload to view this preview` | viewer | `test/dashboard.preview.test.mjs` |
| `Remove` | attachments | `test/hub-overview.test.mjs` |
| `Reopen` | thread | `test/dashboard-threads-sidebar.test.mjs` |
| `Reply` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-threads-sidebar.test.mjs` |
| `Research` | peek-kinds | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Resolved` | shell | `test/artifact-notes-viewer.test.mjs`, `test/dashboard-autonomy.test.mjs` |
| `Restore` | shell | `test/library-card-menu.test.mjs` |
| `Restore all` | library | `test/dashboard.artifacts.test.mjs` |
| `Result` | shell | `test/recurring-dashboard.test.mjs` |
| `Retire it` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-owner-action.test.mjs` |
| `Retire lessons nobody is given` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `Retro` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Review` | shell | `test/dashboard-board-progress.test.mjs` |
| `Review page` | library | `test/dashboard-library.test.mjs` |
| `reviews passed the first time` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Runs` | shell | `test/recurring-dashboard.test.mjs` |
| `Runs as` | shell | `test/recurring-dashboard.test.mjs` |
| `Score` | shell | `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `Select and copy` | data | `test/dashboard-peek.test.mjs` |
| `Self` | shell | `test/components.test.mjs`, `test/dashboard-exterior.test.mjs` |
| `Send` | shell | `test/dashboard-inbox-panel.test.mjs`, `test/dashboard-overview-goals.test.mjs` |
| `Send it back` | review | `test/dashboard-inbox-panel.test.mjs` |
| `Sending…` | threads-core | `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-viewer.test.mjs`, `test/dashboard.presses.test.mjs` |
| `Senses` | autonomy | `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs` |
| `Sensors` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Sent` | shell | `test/operator-threads.hub.test.mjs` |
| `Sent to the responder.` | threads-core | `test/responder-routing.test.mjs` |
| `Sent.` | threads-core | `test/dashboard.threads-server.test.mjs`, `test/thread-responding.test.mjs`, `test/thread-undelivered.test.mjs` |
| `Set aside` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `Set by` | shell | `test/recurring-dashboard.test.mjs` |
| `Settings` | shell | `test/hub-overview.test.mjs` |
| `Shift` | shell | `test/artifact-notes-viewer.test.mjs`, `test/dashboard.threads-card.test.mjs`, `test/dashboard.threads-server.test.mjs` |
| `Shift+click it and say so in a thread` | shell | `test/dashboard-library.viewer.test.mjs` |
| `Showing main` | thread | `test/artifact-notes-viewer.test.mjs` |
| `Signal` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Since` | shell | `test/dashboard-autonomy.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `Slowest tests` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `Spec` | board | `test/question-doc-link.test.mjs` |
| `Stage` | shell | `test/dashboard-peek.test.mjs` |
| `Start` | shell | `test/dashboard-library.viewer.test.mjs` |
| `State` | shell | `test/dashboard-library.viewer.test.mjs` |
| `Status` | shell | `test/dashboard-loop.test.mjs`, `test/dashboard-overview-goals.test.mjs`, `test/dashboard-peek.test.mjs`, `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Stop` | shell | `test/dashboard-library.viewer.test.mjs` |
| `Stories` | shell | `test/dashboard-board-progress.test.mjs` |
| `Strategy` | peek-kinds | `test/dashboard-exterior.test.mjs` |
| `stuck on a prompt` | shell | `test/dashboard-board-progress.test.mjs`, `test/dashboard-overview-goals.test.mjs` |
| `Suggestion` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Suggestions` | autonomy | `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `Supervisor` | shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs` |
| `Terminal` | terminal | `test/hub-overview.test.mjs` |
| `Test` | autonomy | `test/hub-overview.test.mjs` |
| `TEXTAREA` | shell | `test/dashboard.typing.test.mjs` |
| `the dashboard` | shell | `test/dashboard.threads-server.test.mjs` |
| `The design` | shell | `test/dashboard.loop-goals.test.mjs`, `test/gateway.test.mjs`, `test/question-doc-link.test.mjs` |
| `the published version` | shell | `test/dashboard-library.viewer.test.mjs`, `test/dashboard.viewer.test.mjs` |
| `the question` | shell | `test/dashboard-terminal-tabs.test.mjs` |
| `The shell ended.` | terminal | `test/dashboard-terminal-tabs.test.mjs` |
| `the supervisor` | shell | `test/dashboard-autonomy.test.mjs`, `test/dashboard-loop.test.mjs` |
| `The supervisor is stopped at a usage limit` | thread | `test/dashboard-inbox-panel.test.mjs` |
| `The technical wording` | data | `test/dashboard-inbox-panel.test.mjs` |
| `this week` | shell | `test/dashboard-autonomy.test.mjs` |
| `Threads` | shell | `test/dashboard-threads-sidebar.test.mjs`, `test/operator-threads.hub.test.mjs` |
| `Ticket` | shell | `test/supervisor-thread-new.test.mjs` |
| `Title` | shell | `test/dashboard-overview-goals.test.mjs`, `test/dashboard-shell.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `Tokens` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `Tokens by phase` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Took` | shell | `test/recurring-dashboard.test.mjs` |
| `Trust` | shell | `test/autonomy-suggestions.test.mjs`, `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `trust score` | overview | `test/dashboard-overview-goals.test.mjs` |
| `Trust Score` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `Trusted` | shell | `test/ooda-learning.test.mjs` |
| `Under` | peek-kinds | `test/dashboard-peek.test.mjs` |
| `Unexplained for` | shell | `test/dashboard.loop-goals.test.mjs` |
| `Unpublish` | library | `test/dashboard-library.viewer.test.mjs`, `test/library-card-menu.test.mjs` |
| `Updated` | library | `test/dashboard-library.viewer.test.mjs` |
| `Upkeep` | shell | `test/dashboard-overview-goals.test.mjs` |
| `usage limit` | shell | `test/dashboard-board-progress.test.mjs` |
| `USD by model` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `USD by phase` | autonomy | `test/dashboard-autonomy.test.mjs`, `test/dashboard-efficiency.test.mjs` |
| `Use a smaller model where it fits` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `View only` | shell | `test/hub-overview.test.mjs`, `test/org-access.view.test.mjs` |
| `View only: you can look at everything on this box. Buttons that would change something are greyed out.` | shell | `test/hub-overview.test.mjs` |
| `View only: you can look, but not change anything` | shell | `test/artifact-close-ask.test.mjs`, `test/artifact-handover-reminder.test.mjs`, `test/artifact-notes-press.test.mjs`, `test/hub-overview.test.mjs` |
| `waiting on the supervisor` | threads-panel | `test/responder-routing.test.mjs` |
| `waiting on you` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Waiting on you` | shell | `test/dashboard-overview-goals.test.mjs`, `test/hub-overview.test.mjs` |
| `waits for Upkeep` | peek-kinds | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `Waste` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Watching` | autonomy | `test/dashboard-autonomy.test.mjs` |
| `Waves` | shell | `test/dashboard-board-progress.test.mjs` |
| `Weekly` | loop | `test/gateway.test.mjs` |
| `What did it teach?` | loop | `test/dashboard-loop.test.mjs` |
| `What it covers` | shell | `test/dashboard-overview-goals.test.mjs` |
| `What it does` | shell | `test/recurring-dashboard.test.mjs` |
| `What it is about` | shell | `test/ooda-lineage.test.mjs` |
| `What it may propose` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `What it read` | shell | `test/dashboard-autonomy.test.mjs` |
| `What it saw` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `What should change?` | review | `test/dashboard-inbox-panel.test.mjs` |
| `What the loop noticed` | shell | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `When` | shell | `test/dashboard-autonomy.test.mjs`, `test/recurring-dashboard.test.mjs` |
| `Where` | shell | `test/dashboard-library.viewer.test.mjs` |
| `Where it goes` | autonomy | `test/dashboard-efficiency.test.mjs` |
| `Where it sits` | shell | `test/dashboard.loop-goals.test.mjs` |
| `Whose` | shell | `test/supervisor-thread-new.test.mjs` |
| `Why it matters` | shell | `test/dashboard-overview-goals.test.mjs` |
| `Why you` | shell | `test/dashboard-inbox-panel.test.mjs` |
| `withdrawn by the supervisor` | words | `test/dashboard-inbox-panel.test.mjs` |
| `Words` | thread | `test/artifact-note-shots.test.mjs` |
| `Workers` | shell | `test/dashboard-overview-goals.test.mjs` |
| `workers active` | overview | `test/dashboard-overview-goals.test.mjs` |
| `Workers at once, in all` | settings | `test/dashboard.threads-server.test.mjs` |
| `yes: you went with its recommendation` | loop | `test/dashboard.presses.test.mjs` |
| `you said Yes · being registered` | peek-kinds | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `you said Yes · being stopped` | peek-kinds | `test/recurring-dashboard.test.mjs`, `test/recurring-jobs-page.test.mjs` |
| `your answer` | shell | `test/dashboard-autonomy.test.mjs` |
| `Your answer` | shell | `test/supervisor-thread-new.test.mjs` |

## Texts: `canvas.html`

| item | view | read by |
|---|---|---|
| `Base` | canvas-editing | `test/canvas-editing.components.test.mjs` |
| `Content-Type` | canvas | `test/canvas-editor.test.mjs`, `test/lib/canvas-fixture.mjs` |
| `Delete layers` | canvas-panels | `test/canvas-editor-tools.test.mjs` |
| `Delete page` | canvas | `test/canvas-editor-tools.test.mjs` |
| `Image` | canvas | `test/canvas-editor-tools.paste.test.mjs` |
| `Move page up` | canvas | `test/canvas-editor-tools.test.mjs` |
| `New thread on a deleted layer` | canvas-presence | `test/canvas-pins.test.mjs` |
| `on a deleted layer` | canvas-presence | `test/canvas-pins.test.mjs` |
| `Page name` | canvas | `test/canvas-editor-tools.test.mjs` |
| `pageSel` | canvas | `test/canvas-editor.test.mjs` |
| `Rename page` | canvas | `test/canvas-editor-tools.test.mjs` |
| `Saved` | canvas | `test/canvas-sync.test.mjs` |
| `Select a layer to see what it is.` | canvas | `test/canvas-editing.panel.test.mjs`, `test/canvas-editor.test.mjs` |
| `strokeWidth` | canvas | `test/canvas-editing.panel.test.mjs` |
| `Text` | canvas | `test/canvas-editing.tools.test.mjs` |
| `This page is empty.` | canvas | `test/canvas-editing.components.test.mjs`, `test/canvas-editing.drag.test.mjs`, `test/canvas-editor.test.mjs` |
| `Watching: editing needs a wider screen.` | canvas | `test/canvas-editor.test.mjs` |
| `zoomIn` | canvas-panels | `test/canvas-editor.test.mjs` |

## Texts: `browser.html`

| item | view | read by |
|---|---|---|
| `Cancel` | browser | `test/browser-view-page.test.mjs` |
| `Connecting…` | browser | `test/browser-view-page.test.mjs` |
| `Done` | browser | `test/browser-handover.close.test.mjs`, `test/browser-handover.test.mjs` |
| `Enter` | browser | `test/browser-dialogs.handover-end.test.mjs`, `test/browser-view-page.input.test.mjs`, `test/browser-view-page.test.mjs` |
| `Leave` | browser | `test/browser-view-page.test.mjs` |
| `Live` | browser | `test/browser-view-page.test.mjs` |
| `Not connected: not sent.` | browser | `test/browser-view-page.test.mjs` |
| `Not connected: nothing was signed out.` | browser | `test/browser-view-page.test.mjs` |
| `Only http and https addresses open here.` | browser | `test/browser-view-page.input.test.mjs` |
| `Reconnecting…` | browser | `test/browser-view-page.test.mjs` |
| `Shift` | browser | `test/browser-view-page.input.test.mjs` |
| `Stay` | browser | `test/browser-view-page.test.mjs` |
| `That address is too long.` | browser | `test/browser-view-page.input.test.mjs` |
| `That paste is too long to send.` | browser | `test/browser-view-page.input.test.mjs` |

## The poll

The data loop calls `setInterval(…, POLL_MS)` with `POLL_MS` exactly `10000` (`src/shared/poll.ts`): these tests replace `setInterval` for that one value to poll faster.

- `test/browser-e2e.test.mjs`
- `test/dashboard-answers.test.mjs`
- `test/dashboard-attachments.test.mjs`
- `test/dashboard-board-progress.test.mjs`
- `test/dashboard-goals-reorder.test.mjs`
- `test/dashboard-inbox-panel.test.mjs`
- `test/dashboard-loop.test.mjs`
- `test/dashboard-measure.test.mjs`
- `test/dashboard-overview-goals.test.mjs`
- `test/dashboard-owner-action.test.mjs`
- `test/dashboard-threads-sidebar.test.mjs`
- `test/dashboard.reload.test.mjs`
- `test/fixtures/artifact-viewer/harness.mjs`
- `test/lib/dashboard-library-fixture.mjs`
- `test/pull-refresh.test.mjs`
- `test/recurring-dashboard.test.mjs`
- `test/recurring-failures.test.mjs`
- `test/recurring-jobs-page.test.mjs`
- `test/thread-per-subject.test.mjs`

These count the page's `/api/data` reads through `window.__polls`, set by the test's own `fetch` wrapper, so each poll must be one `fetch` of `/api/data`:

- `test/autonomy-suggestions.test.mjs`
- `test/dashboard-answers.test.mjs`
- `test/dashboard-autonomy.test.mjs`
- `test/dashboard-goals-reorder.test.mjs`
- `test/dashboard-overview-goals.test.mjs`
- `test/dashboard-owner-action.test.mjs`
- `test/dashboard-question-peek.test.mjs`
- `test/dashboard.presses.test.mjs`
- `test/dashboard.threads-answered.test.mjs`
- `test/dashboard.threads-card.test.mjs`
- `test/dashboard.threads-pins.test.mjs`
- `test/dashboard.threads-questions.test.mjs`
- `test/dashboard.threads-resolve.test.mjs`
- `test/dashboard.typing.test.mjs`

## Slices (`node:vm`)

Each runs page code under `node:vm`: a marked block it slices, or the declarations of the names it takes; the port moves them to `src/lib/` and the test, ported, imports `lib-dist/`.

| test | page | blocks | names |
|---|---|---|---|
| `test/artifact-kind.test.mjs` | `index.html` | `library-items`, `preview-cards` | `diagram`, `libraryItems`, `libraryKeep` |
| `test/autonomy-suggestions.test.mjs` | `index.html` | `threads-core` | `tKey`, `tlClose`, `tlShowing`, `tlStart` |
| `test/awareness-data.test.mjs` | `index.html` | `learning` | n/a |
| `test/box-memory-e2e.test.mjs` | `hub.html` | `box-memory` | `memoryView` |
| `test/canvas-note-anchor.test.mjs` | `index.html` | n/a | `T_ANCHOR_CAPS`, `empty`, `tFrameSpot`, `tKey` |
| `test/components.test.mjs` | `index.html` | `css-acts`, `css-base`, `css-board`, `css-chrome`, `css-common`, `css-efficiency`, `css-frame`, `css-goals`, `css-goals-old`, `css-inbox`, `css-library`, `css-loop`, `css-loop-tabs`, `css-misc`, `css-overview`, `css-peek`, `css-planners`, `css-progress`, `css-review`, `css-settings`, `css-shell`, `css-threads`, `css-viewer`, `css-viewer-bar`, `html-board`, `html-drawer`, `html-efficiency`, `html-goals`, `html-health`, `html-library`, `html-loop`, `html-overview`, `html-pagebar`, `html-progress`, `html-retros`, `html-review`, `html-sensors`, `html-settings`, `html-side`, `html-threads`, `html-tl`, `html-trust`, `html-viewer`, `html-viewer-bar`, `learning`, `ooda-act`, `ooda-decide`, `ooda-learning`, `ooda-observe`, `ooda-orient`, `ooda-trust` | `renderGoals`, `renderOoda` |
| `test/dashboard-board-progress.test.mjs` | `index.html` | `board-filter` | `PROGRESS_CHART`, `burnup`, `empty`, `fmtDate`, `forecast`, `pillsOf`, `renderBoard`, `renderProgress` |
| `test/dashboard-copy.test.mjs` | `index.html` | `css-loop`, `css-loop-tabs`, `html-loop`, `ooda-act`, `ooda-decide`, `ooda-learning`, `ooda-observe`, `ooda-orient` | `DEC_KIND`, `decideRows`, `effNone`, `howItChanges`, `learningSection`, `openAct`, `openDecision`, `openLesson`, `qblock`, `renderDecisions` |
| `test/dashboard-host-links.test.mjs` | `index.html` | `hello-pulse`, `preview-cards`, `public-states` | `load`, `previewHere`, `previewUrl`, `publicHere`, `publicState` |
| `test/dashboard-inbox-panel.test.mjs` | `index.html` | `shell-routes`, `threads-core` | `inboxCount`, `list`, `peekIsOpen`, `peekKey`, `tlClose`, `tlHome`, `tlInPanel`, `tlInboxHome`, `tlPinMode`, `tlRefresh` |
| `test/dashboard-loop.test.mjs` | `index.html` | `css-loop-tables`, `html-loop`, `loop-tables`, `ooda-act`, `ooda-decide`, `ooda-learning`, `ooda-observe`, `ooda-orient` | `DEC_KIND`, `decideRows`, `howItChanges`, `list`, `openAct`, `openDecision`, `openLesson`, `renderDecisions` |
| `test/dashboard-overview-goals.test.mjs` | `index.html`, `hub.html` | `devteam-layout`, `devteam-shell-js`, `goal-block`, `goal-peek`, `hello-pulse`, `score-of` | `NEXT_ID`, `choicesOf`, `closedGoalCardHtml`, `goalBlock`, `goalState`, `goalSteps`, `heartbeat`, `heartbeatDays`, `helloLoad`, `openGoal`, `ovMosaic`, `scoreAt`, `scoreOf`, `spark`, `statusPill`, `thGo`, `when` |
| `test/dashboard-peek-artifacts.test.mjs` | `index.html` | `library-items`, `peek-artifacts`, `preview-cards` | `diagram`, `esc` |
| `test/dashboard-peek.test.mjs` | `index.html` | `devteam-layout`, `devteam-shell-js`, `learning`, `peeks` | `OPENERS`, `bindDbTable`, `focusKey`, `openSensor`, `peekFor`, `peekKey`, `redraw`, `refreshDrawer`, `route`, `storedRows`, `tlClose` |
| `test/dashboard-shell.test.mjs` | `index.html`, `hub.html` | `devteam-layout`, `devteam-shell-js`, `shell-routes` | `$`, `bindDbTable`, `bindFleetSwitch`, `bindTabBar`, `closeTarget`, `dbTable`, `escHtml`, `fleetSwitch`, `goalSteps`, `headFor`, `heartbeat`, `hideDrawer`, `list`, `nextSort`, `parseHead`, `peekHead`, `props`, `registerPage`, `rememberedFilters`, `render`, `route`, `saveFilters`, `shellPages`, `sortRows`, `stampFor`, `statusPill`, `tabBar`, `tabPanel`, `tabSelected`, `tabStep`, `withPage` |
| `test/dashboard.artifacts.test.mjs` | `index.html` | `preview-cards`, `public-states` | `press` |
| `test/dashboard.goals.test.mjs` | `index.html` | n/a | `choicesOf` |
| `test/dashboard.instances.test.mjs` | `index.html` | n/a | `list` |
| `test/dashboard.threads-server.test.mjs` | `index.html` | `threads-core` | `parseSettingView`, `route`, `tAnchor`, `tArtPath`, `tBox`, `tBytes`, `tCardState`, `tCut`, `tFit`, `tFrameOn`, `tFrameTitle`, `tGoRoute`, `tKey`, `tLensMessage`, `tLine`, `tPins`, `tPlace`, `tSubjectAt`, `tUncap`, `tUnread`, `tWhere` |
| `test/devteam-mjs-regions.test.mjs` | `index.html` | n/a | `$` |
| `test/gateway.test.mjs` | `index.html`, `hub.html` | n/a | `box`, `list`, `press`, `term` |
| `test/goal-approval-choices.test.mjs` | `index.html` | n/a | `choicesOf` |
| `test/hub-overview.test.mjs` | `index.html`, `hub.html` | `box-line`, `hub-overview` | `boxAlertNow`, `draw`, `findBox`, `lessBox`, `list`, `overviewCard`, `ownAlert`, `paintOvTab`, `paintOverview`, `paintSettings`, `paintTab` |
| `test/multirepo-views.test.mjs` | `index.html` | `peeks` | `openFile`, `peekOf` |
| `test/ooda-learning.test.mjs` | `index.html` | `learning`, `ooda-learning` | n/a |
| `test/ooda-lineage.test.mjs` | `index.html` | `loop-place` | `lineageList` |
| `test/plain-questions.test.mjs` | `index.html` | n/a | `NUMBERED`, `esc`, `inlineList`, `linkify`, `qblock`, `qinline`, `qtext` |
| `test/question-doc-link.test.mjs` | `index.html` | n/a | `esc`, `fileHref`, `linkOf`, `linkify`, `repoDocHref`, `ticketMap`, `tlink` |
| `test/responder-routing.test.mjs` | `index.html` | `threads-core` | `list`, `route`, `tlSend`, `words` |
| `test/self-plain.test.mjs` | `index.html` | n/a | `words` |
| `test/session-threads.test.mjs` | `index.html` | `threads-core` | `list`, `route`, `tlSend`, `words` |
| `test/thread-per-subject.test.mjs` | `index.html` | n/a | `list`, `tFrameSpot`, `tKey`, `tlClose` |
| `test/thread-responding.test.mjs` | `index.html` | `threads-core` | n/a |
| `test/thread-undelivered.test.mjs` | `index.html` | `threads-core` | n/a |
| `test/validate-parts.test.mjs` | `index.html`, `hub.html` | `devteam-layout` | `draw`, `post` |

## Tests by view

Every test above, with the views it needs (the port plan's view names): its page's root view, and the view of every item it reads. A fixture's views count for each test that uses it.

| test | opens | slices | views |
|---|---|---|---|
| `test/artifact-annotations-e2e.test.mjs` | `index.html` | n/a | shell, data, words, board, peeks, review, viewer, library, threads-panel, thread, terminal |
| `test/artifact-close-ask.test.mjs` | `index.html` | n/a | shell, data, words, board, autonomy, peeks, viewer, library, threads-panel, thread |
| `test/artifact-handover-reminder.test.mjs` | `index.html` | n/a | shell, data, words, board, autonomy, peeks, viewer, library, threads-core, threads-panel, thread |
| `test/artifact-kind.test.mjs` | `index.html` | `index.html` | shell, data, peeks, library |
| `test/artifact-live-reload.guards.test.mjs` | `index.html` | n/a | shell, data, words, viewer, library |
| `test/artifact-live-reload.main-place.test.mjs` | `index.html` | n/a | shell, data, words, viewer, library |
| `test/artifact-live-reload.test.mjs` | `index.html` | n/a | shell, data, words, viewer, library |
| `test/artifact-note-shots.test.mjs` | `index.html` | n/a | shell, data, peeks, threads-core, thread |
| `test/artifact-notes-cli.test.mjs` | `index.html` | n/a | shell, data |
| `test/artifact-notes-press.test.mjs` | `index.html` | n/a | shell, data, words, board, peeks, review, viewer, attachments, library, threads-core, threads-panel, thread |
| `test/artifact-notes-viewer.test.mjs` | `index.html` | n/a | shell, data, words, board, peeks, review, viewer, library, threads-core, threads-panel, thread |
| `test/artifact-pages.test.mjs` | `index.html` | n/a | shell, data, board, peeks, viewer, library, threads-core, threads-panel, thread |
| `test/artifact-reload-removed.test.mjs` | `index.html` | n/a | shell, data, words, viewer, library |
| `test/artifact-remote.chrome.test.mjs` | `index.html` | n/a | shell, data, viewer, library |
| `test/artifact-remote.test.mjs` | `index.html` | n/a | shell, data, words, autonomy |
| `test/artifact-versions-order.test.mjs` | `index.html` | n/a | shell, data, peeks, viewer, library |
| `test/artifact-versions.test.mjs` | `index.html` | n/a | shell, data |
| `test/artifact-viewer-aim.test.mjs` | `index.html` | n/a | shell, data, board, peeks, viewer, library, threads-panel, thread |
| `test/artifact-viewer-box.test.mjs` | `index.html` | n/a | shell, data, words, board, autonomy, peeks, viewer, library, threads-panel, thread |
| `test/artifact-viewer-close.history.test.mjs` | `index.html` | n/a | shell, data, board, peeks, viewer, library, threads-panel, thread |
| `test/artifact-viewer-close.test.mjs` | `index.html` | n/a | shell, data, board, peeks, viewer, library, threads-panel, thread |
| `test/artifact-viewer-escape.test.mjs` | `index.html` | n/a | shell, data, board, peeks, viewer, library, threads-panel, thread |
| `test/autonomy-suggestions.test.mjs` | `index.html` | `index.html` | shell, data, words, autonomy, threads-core, threads-panel |
| `test/awareness-data.test.mjs` | n/a | `index.html` | shell, data, loop |
| `test/box-memory-e2e.test.mjs` | `index.html` | n/a | shell, data |
| `test/browser-dialogs.handover-end.test.mjs` | `index.html`, `browser.html` | n/a | shell, data, browser |
| `test/browser-dialogs.handover.test.mjs` | `index.html`, `browser.html` | n/a | shell, data, words, browser |
| `test/browser-dialogs.test.mjs` | `index.html`, `browser.html` | n/a | shell, data, browser |
| `test/browser-e2e.test.mjs` | `index.html` | n/a | shell, data, threads-panel |
| `test/browser-handover.close.test.mjs` | `browser.html`, `index.html` | n/a | shell, data, browser |
| `test/browser-handover.test.mjs` | `browser.html`, `index.html` | n/a | shell, data, browser |
| `test/browser-view-page.input.test.mjs` | `browser.html` | n/a | browser |
| `test/browser-view-page.test.mjs` | `browser.html` | n/a | browser |
| `test/browser-view.lifecycle.test.mjs` | `browser.html`, `index.html` | n/a | shell, data, browser |
| `test/browser-view.test.mjs` | `browser.html`, `index.html` | n/a | shell, data, browser |
| `test/browser.test.mjs` | `index.html` | n/a | shell, data |
| `test/canvas-cursors.others.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels, canvas-presence |
| `test/canvas-cursors.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels, canvas-presence |
| `test/canvas-editing.components.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels, canvas-editing |
| `test/canvas-editing.drag.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels |
| `test/canvas-editing.panel.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels |
| `test/canvas-editing.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels |
| `test/canvas-editing.tools.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels, canvas-history |
| `test/canvas-editor-tools.multi.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels |
| `test/canvas-editor-tools.paste.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels |
| `test/canvas-editor-tools.resize.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels, canvas-editing |
| `test/canvas-editor-tools.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels |
| `test/canvas-editor.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels |
| `test/canvas-note-anchor.test.mjs` | n/a | `index.html` | shell, data, threads-core |
| `test/canvas-pins.test.mjs` | `index.html`, `canvas.html` | n/a | shell, data, overview, autonomy, canvas, canvas-panels, canvas-presence |
| `test/canvas-sync.drag.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels |
| `test/canvas-sync.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels |
| `test/canvas-sync.undo.test.mjs` | `canvas.html` | n/a | canvas, canvas-panels |
| `test/chrome-no-answer.test.mjs` | `index.html` | n/a | shell, data, board, peeks, viewer, library, threads-panel, thread |
| `test/components.test.mjs` | n/a | `index.html` | shell, data, words, overview, goals, board, autonomy, settings, loop, peeks, peek-kinds, review, viewer, library, threads-panel |
| `test/dashboard-answers.test.mjs` | `index.html` | n/a | shell, data, threads-panel |
| `test/dashboard-attachments.test.mjs` | `index.html` | n/a | shell, data, words, goals, peeks, viewer, attachments, threads-panel, thread |
| `test/dashboard-autonomy.test.mjs` | `index.html` | n/a | shell, data, overview, board, autonomy, settings, loop, peeks, threads-core, threads-panel |
| `test/dashboard-board-progress.test.mjs` | `index.html` | `index.html` | shell, data, words, overview, goals, board, autonomy, peeks, peek-kinds, viewer |
| `test/dashboard-copy.test.mjs` | n/a | `index.html` | shell, data, words, autonomy, loop, peeks, peek-kinds, threads-panel |
| `test/dashboard-efficiency.test.mjs` | `index.html` | n/a | shell, data, overview, autonomy, loop, threads-core, threads-panel |
| `test/dashboard-exterior.test.mjs` | `index.html` | n/a | shell, data, words, overview, autonomy, peeks, peek-kinds |
| `test/dashboard-goals-reorder.test.mjs` | `index.html` | n/a | shell, data, words, goals, viewer, threads-panel |
| `test/dashboard-host-links.test.mjs` | n/a | `index.html` | shell, data, overview, library |
| `test/dashboard-inbox-panel.test.mjs` | `index.html` | `index.html` | shell, data, words, overview, goals, board, autonomy, loop, peeks, peek-kinds, review, viewer, threads-core, threads-panel, thread |
| `test/dashboard-library.test.mjs` | `index.html` | n/a | shell, data, words, overview, goals, board, peeks, viewer, library |
| `test/dashboard-library.viewer.test.mjs` | `index.html` | n/a | shell, data, words, peeks, viewer, library |
| `test/dashboard-loop.test.mjs` | `index.html` | `index.html` | shell, data, board, autonomy, loop, peeks, peek-kinds, library, threads-panel |
| `test/dashboard-measure.test.mjs` | `index.html` | n/a | shell, data, words, overview, goals, board, autonomy, settings, loop, peeks, attachments, library, threads-panel |
| `test/dashboard-overview-goals.test.mjs` | `index.html` | `index.html` | shell, data, words, overview, goals, autonomy, peeks, peek-kinds, threads-panel |
| `test/dashboard-owner-action.test.mjs` | `index.html` | n/a | shell, data, words, peeks, threads-panel |
| `test/dashboard-owner-origin.test.mjs` | `index.html` | n/a | shell, data |
| `test/dashboard-pages.test.mjs` | `index.html` | n/a | shell, data, words, overview, goals, board, autonomy, settings, loop, peeks, peek-kinds, review, viewer, library, threads-panel |
| `test/dashboard-peek-artifacts.test.mjs` | `index.html` | `index.html` | shell, data, peeks, viewer, library |
| `test/dashboard-peek.test.mjs` | `index.html` | `index.html` | shell, data, words, goals, board, autonomy, loop, peeks, peek-kinds, review, viewer, library, threads-panel |
| `test/dashboard-question-peek.test.mjs` | `index.html` | n/a | shell, data, words, board, peeks, peek-kinds, attachments, threads-panel |
| `test/dashboard-shell.test.mjs` | `index.html` | `index.html` | shell, data, words, overview, goals, board, autonomy, settings, loop, peeks, library, threads-panel |
| `test/dashboard-teardown.test.mjs` | `index.html` | n/a | shell, data |
| `test/dashboard-terminal-tabs.test.mjs` | `index.html` | n/a | shell, data, overview, peeks, library, threads-panel, terminal |
| `test/dashboard-threads-sidebar.test.mjs` | `index.html` | n/a | shell, data, words, overview, goals, board, peeks, viewer, threads-panel, thread |
| `test/dashboard.artifact-threads.test.mjs` | `index.html` | n/a | shell, data, words, goals, loop, peeks, viewer, library, threads-panel, thread |
| `test/dashboard.artifacts.test.mjs` | n/a | `index.html` | shell, data, library |
| `test/dashboard.goals.test.mjs` | n/a | `index.html` | shell, data, words |
| `test/dashboard.instances.test.mjs` | n/a | `index.html` | shell, data, peeks |
| `test/dashboard.loop-goals.test.mjs` | `index.html` | n/a | shell, data, words, board, loop, peeks, peek-kinds, threads-panel |
| `test/dashboard.presses.test.mjs` | `index.html` | n/a | shell, data, words, loop, threads-core, threads-panel |
| `test/dashboard.preview.test.mjs` | `index.html` | n/a | shell, data, words, viewer, library, threads-panel, thread |
| `test/dashboard.reload.test.mjs` | `index.html` | n/a | shell, data, viewer |
| `test/dashboard.threads-answered.test.mjs` | `index.html` | n/a | shell, data, goals, peeks, threads-panel |
| `test/dashboard.threads-card.test.mjs` | `index.html` | n/a | shell, data, goals, peeks, threads-panel, thread |
| `test/dashboard.threads-pins.test.mjs` | `index.html` | n/a | shell, data, goals, peeks, viewer, threads-panel, thread |
| `test/dashboard.threads-questions.test.mjs` | `index.html` | n/a | shell, data, words, goals, peeks, threads-panel, thread |
| `test/dashboard.threads-resolve.test.mjs` | `index.html` | n/a | shell, data, goals, loop, peeks, viewer, threads-core, threads-panel, thread |
| `test/dashboard.threads-server.test.mjs` | n/a | `index.html` | shell, data, goals, settings, loop, threads-core |
| `test/dashboard.typing.test.mjs` | `index.html` | n/a | shell, data, board, threads-panel |
| `test/dashboard.viewer.test.mjs` | `index.html` | n/a | shell, data, peeks, viewer, library, threads-panel, thread |
| `test/devteam-mjs-regions.test.mjs` | n/a | `index.html` | shell, data |
| `test/fast-threads-e2e.test.mjs` | `index.html` | n/a | shell, data, peek-kinds, viewer |
| `test/fixtures/artifact-notes-viewer/kit.mjs` | fixture | fixture | shell, review, viewer, library, threads-core, threads-panel, thread |
| `test/fixtures/artifact-viewer/harness.mjs` | fixture | fixture | shell, board, peeks, viewer, library, threads-panel, thread |
| `test/gateway.test.mjs` | `index.html` | `index.html` | shell, data, words, overview, loop, peeks |
| `test/goal-approval-choices.test.mjs` | n/a | `index.html` | shell, data, words |
| `test/hub-measure.test.mjs` | `index.html` | n/a | shell, data, overview, threads-panel |
| `test/hub-overview.test.mjs` | `index.html` | `index.html` | shell, data, words, overview, goals, board, autonomy, settings, peeks, attachments, threads-panel, terminal |
| `test/lib/artifact-live.mjs` | fixture | fixture | words, viewer, library |
| `test/lib/artifact-remote-fixture.mjs` | fixture | fixture |  |
| `test/lib/browser-handover-fixture.mjs` | fixture | fixture |  |
| `test/lib/browser-view-fixture.mjs` | fixture | fixture |  |
| `test/lib/browser-view-page-fixture.mjs` | fixture | fixture | browser |
| `test/lib/canvas-cursors-fixture.mjs` | fixture | fixture | canvas, canvas-presence |
| `test/lib/canvas-fixture.mjs` | fixture | fixture | canvas, canvas-panels |
| `test/lib/dashboard-library-fixture.mjs` | fixture | `index.html` | shell, data, peeks, viewer, library |
| `test/lib/pane-question-fixture.mjs` | fixture | fixture |  |
| `test/lib/terminal-server-fixture.mjs` | fixture | fixture |  |
| `test/library-card-menu.test.mjs` | `index.html` | n/a | shell, data, words, autonomy, library |
| `test/multirepo-views.test.mjs` | n/a | `index.html` | shell, data, peeks, peek-kinds |
| `test/next-step.strategy.test.mjs` | `index.html` | n/a | shell, data, words, goals, peeks, threads-panel |
| `test/ooda-learning.test.mjs` | n/a | `index.html` | shell, data, loop |
| `test/ooda-lineage.test.mjs` | n/a | `index.html` | shell, data, loop |
| `test/operator-threads.hub.test.mjs` | `index.html` | n/a | shell, data, overview, viewer, threads-panel, thread |
| `test/org-access.attribution.test.mjs` | `index.html` | n/a | shell, data, threads-panel, thread |
| `test/org-access.view.test.mjs` | `index.html` | n/a | shell, data, board, viewer, threads-panel |
| `test/pane-question.answer.esc-refused.test.mjs` | `index.html` | n/a | shell, data |
| `test/pane-question.answer.esc.test.mjs` | `index.html` | n/a | shell, data |
| `test/pane-question.answer.page.test.mjs` | `index.html` | n/a | shell, data, threads-panel, thread |
| `test/pane-question.answer.test.mjs` | `index.html` | n/a | shell, data |
| `test/pane-question.held.test.mjs` | `index.html` | n/a | shell, data |
| `test/plain-questions.test.mjs` | n/a | `index.html` | shell, data, words |
| `test/presence-lens.test.mjs` | `index.html` | n/a | shell, data, thread |
| `test/project-hosts-e2e.test.mjs` | `index.html` | n/a | shell, data, overview, settings, peeks, library |
| `test/pull-refresh.test.mjs` | `index.html` | n/a | shell, data, words, overview, threads-panel |
| `test/question-doc-link.test.mjs` | n/a | `index.html` | shell, data, words, board |
| `test/recurring-dashboard.test.mjs` | `index.html` | n/a | shell, data, words, goals, board, peeks, peek-kinds |
| `test/recurring-failures.test.mjs` | `index.html` | n/a | shell, data, loop, peeks, peek-kinds |
| `test/recurring-jobs-page.test.mjs` | `index.html` | n/a | shell, data, autonomy, settings, peeks, peek-kinds |
| `test/responder-routing.test.mjs` | n/a | `index.html` | shell, data, words, peeks, threads-core, threads-panel, thread |
| `test/self-plain.test.mjs` | n/a | `index.html` | shell, data, words |
| `test/session-threads.test.mjs` | `index.html` | `index.html` | shell, data, words, peeks, threads-core, threads-panel, thread |
| `test/settings-fleet-offline.test.mjs` | `index.html` | n/a | shell, data, settings |
| `test/split-parity.test.mjs` | `index.html` | n/a | shell, data |
| `test/supervisor-thread-new.test.mjs` | `index.html` | n/a | shell, data, goals, threads-panel, thread |
| `test/terminal-floor.test.mjs` | `index.html` | n/a | shell, data |
| `test/thread-per-subject.test.mjs` | `index.html` | `index.html` | shell, data, goals, settings, loop, peeks, threads-core, threads-panel |
| `test/thread-responding.test.mjs` | `index.html` | `index.html` | shell, data, threads-core, threads-panel, thread |
| `test/thread-undelivered.test.mjs` | n/a | `index.html` | shell, data, threads-core |
| `test/validate-parts.test.mjs` | n/a | `index.html` | shell, data |

### Views no item maps a test to

No test reads an item only this view writes. Its port's done-whens name tests by the behaviour they check; those named for the view are listed.

| view | tests named for it |
|---|---|
| canvas-sync | `test/canvas-sync.drag.test.mjs`, `test/canvas-sync.test.mjs`, `test/canvas-sync.undo.test.mjs` |
