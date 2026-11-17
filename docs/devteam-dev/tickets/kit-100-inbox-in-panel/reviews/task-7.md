# Task 7 review, pass 1

- Reviewer: fresh task-review subagent (Sonnet 5.5); has not seen the build
- Reviewed: 05da4f5..7831e9dc0322c0afeeb107177a8c99cbfeb0b31b

Read the task brief, report and the diff; checked thDraw, thButton, tlRefresh, tlHeld and the viewer hello for the named risk (tab count against the button's). Did not re-run tests.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | quality | docs/devteam/dashboard/index.html:8010 | Viewer hello calls thButton() only, so the Inbox tab count follows hello via the next thDraw (tlRefresh every 5 s, viewer). It stays stale only while focus sits inside #th-tabs (tlHeld), as the Threads tab count already does. Optional fix: call thDraw() after thButton() in hello. | wont-fix: the tab follows within 5 s on the viewer's threads poll, and holds only while focus is in the tab strip, as the Threads tab's count already does |

Verdict: APPROVE 7831e9dc0322c0afeeb107177a8c99cbfeb0b31b
