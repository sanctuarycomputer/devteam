# Spec review, pass 2

- Reviewer: spec-reviewer 1 (fresh subagent, claude-opus-5-5)
- Reviewed: d241d904a9edfa034d96b64ccae92ea537c414c2 (spec.md)

I read `git diff 0830761 d241d90` on spec.md and the dispositions in reviews/spec-1.md, and checked each fix against the code I read in pass 1. F1 holds. The counter now writes only in a process whose argv has `dashboard-data`. The server starts that child as `node devteam.mjs dashboard-data`, and `hello --json --pane`, the background ticks, `ask`, `answer` and `metrics` never carry that word, so hello's reads every 10 s no longer reach the count. F2 holds. `DEVTEAM_DATA_WAIT_MS=600000` is longer than the child's own 120 s timeout, so a GET made after `lastData` exists waits for its own run instead of getting the last run's data. Asserting that no GET has `x-devteam-stale` and reading the counter after each GET returns make each GET exactly one finished run. F3 and F4 hold. The env now matches dashboard.test.mjs, `NODE_OPTIONS` is appended and set in the dashboard's env only, the drafts are flat, and the regex is anchored at `/artifacts/<slug>$`. The counts are right. The baseline GET runs after the drafts exist and before any question, so the Library reads each draft once (1). After both questions are asked, it is 2 per slug, since both questions are open. A second resolution makes it 3. F5 holds. §2 and Contracts now say that null covers `defaulted` and means "not checked". The diff adds nothing else: the three changes are confined to The change §2, check 1 and Contracts, and checks 2 and 3 and the edge cases are as I approved them in substance in pass 1. I found nothing new.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE d241d904a9edfa034d96b64ccae92ea537c414c2
