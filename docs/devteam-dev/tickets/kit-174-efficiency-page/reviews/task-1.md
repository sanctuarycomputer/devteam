# Task 1 review, pass 1 (the fixture, the in-page data rewrite, and anchors)

- Reviewer: task-1 reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: d7e91d3eb1a4787b695004c717d29a8b494927e0 (Task 1 only). The scaffold test was run once on Node 22 from a `git archive` of this commit, because the worktree held uncommitted Task 2 tests: exit 0, `# pass 2`, `# fail 0`, `# skipped 0`. Mutation check: with the rewrite's `efficiency` replace/delete line removed, the test still passed (exit 0, `# pass 2`). See T1-1.

Checked and found sound. The fixture holds every value listed under the plan's Task 1 "Fixture values": weeks[3] empty with `first_pass: 1`; weeks[10] scores 67; this week's defect and no-defect parts and scores; `score`, `parts` and `best`; weeks[11] at 41 and 6.8; `spec` missing from weeks 0 to 2 and 4 to 5; `observe`; the `metrics`-only keys and output tokens; the acknowledged and open findings; the waste, including the null id; the suggestions, including the unknown kind the plan asks for; and `unpriced_models`. It carries the same field names as `efficiencyData` and `effThread` matches `threadView`. The no-defect week matches `scoreWeeks` exactly (0.81, 0.74, 72). The suggestions are ranked by `usd` and the smaller-model one meets kit-173's 90% condition (97%).

`dataRewriteInit` does what the plan's Interfaces say:
- It replaces or deletes `efficiency`.
- It shallow-merges `metrics` and `metrics.cost`.
- It appends the threads to `/api/threads`' `threads`.
- It records non-GET writes, `error` events and `unhandledrejection` events.
- It changes only the 10 s poll (`setInterval(load, 10000)`) to 300 ms.
- It passes the signal through, keeps the status and headers that `loadNow` reads (`x-devteam-*`), and passes every other request through untouched.

`load()` gives a fresh document each time: it removes the old script, adds the new one, then loads about:blank and then the dashboard. Every claim in notes/anchors.md matches index.html:
- the loop that registers each page with `registerPage`
- `SHELL_ROUTES_PAGES` in the `shell-routes` block
- `PAGE_COUNT_ID`
- `T_SECTIONS` with `trust: 'Trust Ladder'`
- `.sec` (layout line 98) sets its own two-column grid, and as the later rule of equal specificity it overrides `.g12` (line 70)
- `#health` is still its own page and holds the four spend cards
- `T_SETTING_VIEW`, `parseSettingView` and `tlSettingOf`, as used by `tSubjectAt`, `tlStart`, `tlTargetRect`, `tlReveal`, `tlRoute` and `subjectHead`
- `parseHead`, which drops a state key the page doesn't take

The rulings are sound and within touches. One reading of notes/anchors.md: "`tWhere` reads `Efficiency`" describes a change still to come, since today a `#efficiency?…` view reads "the dashboard". The plan asked for the re-anchor in this file's opening paragraph. It went to notes/anchors.md instead, which is right, since this record is the reviewer's.

The helpers were written before the scaffold first ran. Here that only means no red run was seen. A red run would only have shown a missing export, so the real gap is the one in T1-1, which the mutation found.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Minor | plan Task 1 step 2 and Interfaces ("replaces `/api/data`'s `efficiency` with `fx.efficiency` (or deletes it when null)"); quality.md §3 Scoped | test/dashboard-efficiency.test.mjs:55 | `d.efficiency.weeks.length === 12` passes without the rewrite: the server's own kit-173 `efficiency` always has 12 weeks. With the replace/delete line removed, the test still passes. Only the `metrics.cost` merge is proven (`gpt-x`). The delete path (`efficiency: false`) isn't run either. Later tasks' value assertions would catch a regression, so this doesn't block. Assert a value only the fixture has (for example `best.usd_per_point === 33.2` or `score.this_week === 31`) and `efficiencyFixture({ efficiency: false })` giving no `efficiency`. | Fixed in the Task 2 commit: the scaffold asserts best.usd_per_point 33.2 (fixture-only) and that efficiency null deletes the field. |
| T1-2 | Minor | plan Task 1 Fixture values ("every week is one kit-173 can emit") | test/lib/kit.mjs:574-588 (`efficiencyFixture`) | Some fields the plan left to the worker are in states `efficiencyData`/`scoreWeeks` can't emit. (a) `first_pass` 0.44, 0.47, ... with `first_passes: 5`: kit-173 gives `r2((n - bad) / n)`, so only multiples of 0.2 are possible. (b) `cache_read_share` 0.5 to 0.64, while the same week's `tokens_by_phase` (input n·1e5, cache_read n·2e5, cache_write n·2e4) gives 0.625 every week. Kit-173 computes both from the same items. (c) Weekly `score` and `parts` for weeks 0 to 10 aren't `scoreWeeks`' output. Week 6 is the best on both axes, yet its parts are 0.7/0.7, and each score differs from round(100·mean(parts)), e.g. week 0 is 55 against 61. No test fails because of this, since the page computes nothing, but the fixture's comment claims otherwise. Make them consistent, or narrow the comment. | Fixed: the fixture's comment now says the weeks have kit-173's shape and null rules, with numbers picked for the page's checks (the page computes nothing). |
| T1-3 | Minor | plan Task 1 Fixture values (its own "every week is one kit-173 can emit" against its listed defect values) | test/lib/kit.mjs:577-578 | The defect-week parts `{ spend: 0.16, time: 0.15 }` and score 31 are set by the plan, but `scoreWeeks` can't give them with these weeks. For an escaped-defect week, spend and time are the lowest raw values of the other scored weeks: 33.2/64 = 0.52 and 5/8.4 = 0.60, for a score of 58. The worker followed the plan, so this is a plan inconsistency to note to the supervisor. It doesn't block, since the page only formats what it is given. | No change: the plan's values; the page formats what it is given, so the inconsistency can't show. Noted for the supervisor in the review request. |

Verdict: APPROVE d7e91d3eb1a4787b695004c717d29a8b494927e0
