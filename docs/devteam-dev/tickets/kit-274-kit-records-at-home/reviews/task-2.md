# Task review: T2

- Reviewer: task-reviewer-3 (fresh subagent, claude-opus)
- Reviewed: 1482442135b45c40c19ef008234063d220c4e6fc (T2, diff since 9ce912ac)
- Model: strong

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Suggestion | spec A7 ("`prompt worker <id>` ... ends with the default") | test/multirepo-home.test.mjs, left-in-link test, `assert.match(wp, /keep this ticket's records under ...in this repo\./)` | The regex has no `$` anchor, so it checks that the default line appears, not that the prompt ends with it as A7 says. The `doesNotMatch(/Keep its records/)` assertion already catches the home prompt (mutation M1 went red), so this is a precision gap and not a hole. | wont-fix: the doesNotMatch on the home line catches the home prompt (M1 red); the default line is the prompt's last sentence by construction |

Scope checked:

- Only `docs/devteam/scripts/devteam.mjs` (2 comment lines at checkTicket's WORKTREE case, F3) and `test/multirepo-home.test.mjs` changed.
- In existing tests, the setting test has one added line: `homeRecords(F, 'console-01-a', { 'spec.md': '# spec\n' }, { push: false })` before "a plan in the link doesn't count". Its assertion and everything after it are unchanged, as A8/S3 say. The only other edit to existing lines is the T1-added `warnings()` regex. It is now anchored to the full line (`^devteam: warning: ... once merged$`), which is F2.
- A7 has all its checks. The review-worktree `records:` check is still there from T1. The others are prompt worker default and not home, approve-plan succeeding on the link's plan (leftInLink's `okIn` act for console-06-f) and then refused once home has a spec-only folder, the real `merge` landing `src/<id>.js` and the link's spec on console trunk with nothing under home's `origin/main`, and timeline `spec` with `repo: 'console'`.

Runs (node v18.20.4, env -u TMUX, one at a time):

- `--test-name-pattern 'left in the link'` at 1482442: pass 1, fail 0.
- `--test-name-pattern 'the setting'` at 1482442: pass 1, fail 0.

Mutations (scratch detached worktree at 1482442 under run/reviews/kit-274/, removed after each run):

- M1: worker prompt home branch forced (`recordsInHomeId(id)` replaced by `true`). The left-in-link test FAILS at the prompt assertion (the home prompt is printed). RED.
- M2: approve-plan reads the ticket's repo (`recordsRepo` replaced by `repoOfTicketId`). FAILS at the console-06-f refusal (err `''`, the act succeeded from the link). RED.
- M3: timeline drops the `repo` field. FAILS at `repo` (expected 'console'). RED.

The merge-landing assertions (console trunk has code and spec, home has nothing) were not mutated because the budget was three runs. They are direct `ls-tree` reads of the remote refs that the merge writes, so they can fail.

Verdict: APPROVE 1482442135b45c40c19ef008234063d220c4e6fc
