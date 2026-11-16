# Task review, T4, pass 3

- Reviewer: task-reviewer-9 (fresh subagent, claude-opus-5-5)
- Reviewed: 61a950830ae8ac04c737ae0f446010b7e7b2ddb1 (T4 pass-2 fixes)

Run from a `git archive 61a9508` export, Node 24.14.1, `--test-concurrency=1 --test-name-pattern="^Settings" test/hub-overview.test.mjs`: 4 pass, 0 fail, 0 skipped (the box test ran).

Pass 2's dispositions, each checked by undoing the fix in a scratch copy (one run each):

- T4-2-1 (tab order): with `ovTab.tabIndex = key === OVERVIEW ? 0 : -1` restored, the laptop test fails at its new assertion (`[-1, 'false']` against `[0, 'false']`). With `roots.indexOf(selected)` restored in the tabs' keydown, the laptop test fails with "timed out waiting for the project after the Overview" (ArrowRight from index -1 lands on the Overview, not the project). True and tested.
- T4-2-2 (a link's focus): with `a.dataset.k = \`settings:${words}\`` removed from `link()`, the box test fails at "Manage keeps focus". True and tested.

Against spec.md "The hub's Settings" ("No tab is selected while it shows; the Overview tab goes back"): under Settings every tab's `aria-selected` is false and only the Overview tab has `tabIndex` 0; at the Overview, the Terminal or a project, exactly the selected tab has `tabIndex` 0 (the Overview tab's new `|| key === SETTINGS` is the only change, so no two tabs are at 0 outside Settings). The arrows from the Overview, the Terminal and a project are unchanged (`selected` is used as before when it isn't Settings); under Settings ArrowLeft/Right move as from the Overview, so on a box ArrowLeft goes to the Terminal, as it does from the Overview. Space on the focused Overview tab under Settings returns to the Overview (tested). No regressions found.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE 61a950830ae8ac04c737ae0f446010b7e7b2ddb1
