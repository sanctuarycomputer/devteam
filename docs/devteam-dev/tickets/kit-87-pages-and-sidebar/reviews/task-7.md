# Task 7 review

- Reviewer: task-reviewer 7 (fresh subagent, claude-opus-5-5)
- Reviewed: 63e6e59f086cf45ee67454d2293cf09ea7cbbf14 (74d7efb..63e6e59)

Read the task brief (with P3-1..P3-3), spec §8's thread-target paragraphs, the implementer's report and the whole diff 74d7efbb..63e6e59f. Spec: tSubjectAt gives `{ kind: 'page', view: '#settings?key=<key>', quote: <name> }` (no `at`) and the title "Setting · <name> (<key>)" before the generic spot rule; parseSettingView sits in threads-core and is exported to the vm harness; tWhere names the setting from the quote with no DOM read (P3-1); "changed since" stays item-only since `now` is still tlHome(s) (P3-2); tlShow and tlStart carry the row as `el` (P3-3); tlStart reuses an open thread with the same view, for setting rows only; tlTargetRect, the pin corner, the "not on the page now" note and the dock's `gone` use settingRow(key); tlReveal scrolls the row; T6-2 derives the interim label from SET_SAVED_LABEL (all lower case, so limitAsked's comparison still holds). Focused checks outside the diff: (1) the mark's lifecycle: every path that clears TL.open (tlClose for × and Escape, tlLeave, the resolve press, the dock's new-thread, tlCard's vanished-thread branch) is followed by or runs inside tlDraw, and tlMarkRow derives the key from a thread actually found in TL.threads, so no stale mark is left; the pin and the dock open through tlOpen, which redraws, and the dock goes through tlGoTo to #settings then tlReveal; (2) no new top-level name (SET_MARK, settingRow, settingRowHtml, parseSettingView, T_SETTING_VIEW, tlSettingOf, tlMarkRow) appears in the devteam-shell-js block; (3) the server's subjectProblem takes a page subject without `at`, and the view is at most 78 bytes against the 200-byte cap. The frozen blocks are untouched; the Chrome test waits on conditions only. No test was re-run; the report's runs (dashboard-pages 6/6, dashboard.test.mjs all but the known #46 Copy-link failure) were taken as given.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| - | - | - | - | none | |

Verdict: APPROVE 63e6e59f086cf45ee67454d2293cf09ea7cbbf14
