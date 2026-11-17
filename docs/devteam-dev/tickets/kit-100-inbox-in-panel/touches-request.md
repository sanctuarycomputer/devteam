# kit-100: files outside touches

Each asserts the interim Inbox page that kit-100 ends (added by kit-87, kit-88 or kit-89). Assertions are kept except where they assert that interim.

| File | Why |
|---|---|
| test/dashboard-shell.test.mjs | the SHELL_ROUTES table test: `inbox` in pages, `<page>?th=inbox -> inbox`, `questions -> inbox`, each marked "until kit-100" |
| test/dashboard-pages.test.mjs | kit-87: the nav lists Inbox; each nav item opens a page; `.tt`'s target |
| test/dashboard-threads-sidebar.test.mjs | kit-89 AC1: `#overview?th=inbox` opens the Inbox page; `threadsTabs.list()` is three tabs; `.tt` opens `th=open`; the Inbox page's copy of a thread's question |
| test/dashboard-peek.test.mjs | kit-88: a defaulted question's How it changes link goes to the Inbox page's Answered card |
| test/pane-question.answer.test.mjs | kit-89 moved its dock check to "`.tt` opens Threads, `#ask-threads`"; `.tt` now opens the Inbox tab |
| test/next-step.strategy.test.mjs | asserts the Inbox heading's sub-line (`#inbox h2 .sub`); the panel tab has no heading (its label says Inbox; the mock draws none; design: heading sub-lines go) |
| test/browser/dev-links.mjs | hand-run script; `.tt` now opens the Inbox tab, so it clicks Threads after |
| test/dashboard-answers.test.mjs, test/dashboard-owner-action.test.mjs | navigation-only, and only if the `#questions` redirect isn't enough (the ids `#questions`, `#ask-inbox`, `#answered-wrap` stay, in the panel) |
