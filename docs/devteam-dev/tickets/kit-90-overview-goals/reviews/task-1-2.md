# Task 1 review, pass 2 (cold confirm, diff-only)

- Reviewer: task-1 pass-2 reviewer (fresh subagent, claude-sonnet)
- Reviewed: b0a10a0 (fix diff 291a01a..b0a10a0)
- delta-3 F1: not yet in scope (Task 3)

| Pass-1 id | Status |
|---|---|
| T1-1 | ADDRESSED: the two rules are now `border-color: color-mix(in srgb, var(--red) 45%, var(--line))` (full) and `... var(--amber) 55% ...` (partial), verbatim; the outlines are gone. No source assertion was added (see T1-2-1). |
| T1-2 | ADDRESSED: a `ticket`-only open question case; mutation removing the `q.ticket` branch fails (rc=1). |
| T1-3 | ADDRESSED: an answered question case with blocks, ticket and held_by; mutation removing `q.status === 'open'` fails (rc=1). |
| T1-4 | ADDRESSED: released and superseded cases; mutations narrowing the stage list to `merged`, and to `merged, released`, both fail (rc=1). |
| T1-5 | ADDRESSED: the unreachable `let-go` test is removed with a reason comment (a let-go hold exists only on an abandoned goal, which returns earlier); the park branch stays and is tested. |

Shell blocks: the fix diff has hunks only at index.html ~941 (page style, outside `devteam-layout` 46-206) and ~3028 (goal-block); `devteam-shell-js` untouched.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-2-1 | Suggestion | pass-1 T1-1 ("add a check that reads them") | test/dashboard-overview-goals.test.mjs | The CSS rules have no source assertion, so a revert to outlines would pass. Brief Task 1 does not require one; the pass-1 fix text offered it as an example. Not blocking. |  |

Verdict: APPROVE b0a10a0aaf3acefae438b0fd9a4eef0a370d1ec4
