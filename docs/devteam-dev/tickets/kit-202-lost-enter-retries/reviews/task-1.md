# Task 1 review, pass 1

- Reviewer: reviewer-task-1 (fresh subagent, claude-opus-5-5)
- Reviewed: c66ca02351035c17e0f997eb4954348daeeb62fb

Diff read: c66ca02 against its parent, test/accounts.supervisor.test.mjs only, 55 added lines. `git diff 34ad10d 799e381 -- test/` has no removed lines, so the existing tests are unedited.

The new test is the one plan.md Task 1 names, with the same helpers (`fixture('sup-chrome')`, `pane`, `deliver`, `later`) and the same `step` shape. It checks each redraw's own `\r` and the record's `tries` (1, then 2, then gone), then "never a fourth". Panes A, B and C, the three boxless panes, and busy cases 3(a) and 3(b) match the plan line for line. The record is cleared between the busy cases.

Red: with c66ca02's test and the pre-fix devteam.mjs, the file fails 3 pass / 1 fail at `timed out waiting for Enter 2 of 3` (step B), as the plan expects.

Mutations, run against 799e381's code in a scratch worktree, with this test unchanged:

| Mutation | Result |
|---|---|
| old `lines.slice(-8)` digest | fails: Enter 2 of 3 |
| `paneNorm` without the shell-phrase stripping | fails: Enter 2 of 3 |
| busy guard narrowed back to `lines.slice(-8)` | fails: left alone, a spinner above a long agent list |
| no footer cut below the last rule | fails: Enter 2 of 3 |
| no `PANE_TOKENS` filter | fails: Enter 2 of 3 |
| busy guard removed | fails: left alone, busy in the footer (and the existing test fails too) |
| tail looked for only in `lines.slice(-8)` | **passes** (survives) |
| the "text below the last rule: no cut" line removed | **passes** (survives) |

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Minor | plan.md Task 1, case 3 ("It stays in the test to guard the widened tail window"); spec Problem ("a long agent list can also push the input itself out of the bottom 8 lines") | test/accounts.supervisor.test.mjs, busy loop | Case 3(b) only asserts `s.keys() === ''`. A tail window narrowed back to the bottom 8 reads the text as submitted, drops the record and presses nothing, so the case still passes. The mutation survived. So the test doesn't guard the tail window, though the plan says it does. Adding `assert.ok(fs.existsSync(sent), ...)` after the tick in the busy loop would kill the mutation: busy keeps the record, "submitted" drops it. It would also make the negative check independent of how fast a stray key reaches the stand-in. | fixed in 76be28f: each busy case also asserts the record is kept |
| T1-2 | Minor | spec Edge cases ("A rule in the output with no input box under it: the text is below that rule, so nothing is cut") | test/accounts.supervisor.test.mjs, new test | No pane has a rule with the typed text below it, so paneBody's no-cut branch is never exercised. Removing that line survives. A regression there would read stuck text as submitted and silently end the rescue. The spec's acceptance checks don't require this case, so it is Minor. A boxless step whose output holds a `─` rule above `> ${text}` would cover it. | fixed in 76be28f: a pane with a rule above the text gets its Enter; removing the no-cut line now fails the test (checked) |

Verdict: APPROVE c66ca02351035c17e0f997eb4954348daeeb62fb
