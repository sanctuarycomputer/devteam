# Task 5 review
- Reviewer: fresh subagent of the kit-89 worker
- Spec compliance: ✅ three measure entries (panel, panel+card, floating card) with ready waits, opts.inbox/view matching nothing (AC8), localStorage cleared per load; T4-1, T4-3, pane-question flake carried fixes done; all files within touches
- Quality: approved: measure untouched, page CSS not altered, existing assertions kept (navigation/waits only), the one index.html change is outside layout/shell-js/threads-core and small

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T5-1 | Minor | tests assert behaviour | test/dashboard-measure.test.mjs THREADS_PAGES | The three entries' ready predicates are long inline strings; fine, but the second reuses a fixed class/parent check (`#th-card-slot > #tl-card.in-panel`) that couples to markup. Acceptable, no change required. | wont-fix: the ready wait names the in-panel card by its built ids on purpose; it is what the entry measures |

Note on test/operator-threads.hub.test.mjs: it navigates to `http://127.0.0.1:${HUB}/` (the hub's own page, hub.html, which still has `id="tl-pill"`, count 1) and drives the hub's dock; index.html no longer has `tl-pill` (count 0). It is not affected by this ticket, so no touch or ruling is needed. The report's concern is moot.

Verdict: APPROVE c695ec51f585915dba2cf14a791dda66e2e8e193
