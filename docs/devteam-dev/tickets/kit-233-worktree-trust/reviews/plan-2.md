# Plan review, pass 2

- Reviewer: plan-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: fa8af84e708acc303867ee25b0bdbe29881a01da (plan.md, diff since e00f958, and the whole file)

I read the diff against plan-1's findings, the whole plan, the spec and the ticket (its touches plus quality.md by ruling m-20261115-071339001). I checked the plan against the code at the committed head: kit-232's test, the last one in test/kit.test.mjs; `threadsFixture` in test/lib/kit.mjs, where `F.run(args, role)` returns `{ status, out, err }` from `F.old`, `F.sup` returns stdout only, and `F.env` merges the role object over `process.env`; `choreOf` in approvals.test.mjs; and in devteam.mjs, `PANE_WAITS`, `PANE_CODE`, `PANE_BUSY`, `paneWaitingIn`, `limitStop`, `loadSettings`'s read of owner settings from main, the merge owner-settings check and `--title`/`--body-file` under forge git, and the worker and planner launch (seedWorktree, then withLock, kill-window, resume).

Each plan-1 disposition holds in the revised plan:

- **F1:** step 6 now replaces the key's one value, then commits and pushes to main. The note now says steps 2, 5 and 6 commit to main and step 7 only pushes a branch. `loadSettings` then reads `exit 3` from `origin/main` (or `origin/HEAD`), so the hook fails as the step expects.
- **F2:** steps 5 and 6 go through `F.run` with role supervisor and assert on stderr. Building the value with `JSON.stringify` is not spelled out, but valid JSON in the block calls for it anyway.
- **F3:** `LANG` travels in the role or env of every tmux and kit call, not on `process.env`. The darwin value is gone (see F2-2).
- **F4:** the chore branch now comes from `worktree add -b … origin/main`, so `F.old` stays on main. A dry run under forge git with `--title`/`--body-file` reaches `changes owner settings: agent_trust_command (governance-edit)`.
- **F5:** the `❯ 1.` case is kept as a regression guard, with a comment.
- **F6:** verification.md is to say that `limitStop` is untested here.
- **F7:** the reference is now "§4, line 130".

What I checked holds. The hook placement (after `seedWorktree`, before `withLock`) gives the agent its trust before the window opens. The hook runs with cwd `wt`, and dash computes `$PWD` with getcwd, because the inherited `PWD` is `F.old`, not `wt`. Since the test compares real paths, either way would match. The stand-in's `process.cwd()` is physical, so its `trusted` comparison against `fs.realpathSync` is sound. On an 80x24 pane, the typed lines plus the dialog of about 11 rows fit in the bottom 15 non-empty lines, and the first matching row starts `Quick safety check:`.

Nothing blocks. Below are two waits that are still implicit, a dropped detail from F3, and the record gap.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | Test not flaky (quality.md §3, buildable as written) | Task 1 steps 5 and 6 | Step 3 waits with `until` for the dialog text in the pane, and step 4 waits for each variant's last line, before `metrics`. Steps 5 and 6 only "wait for a new line" in calls.jsonl. The stand-in appends to calls.jsonl before it prints, so a `metrics` run straight after can capture a pane tmux has not drawn yet. In step 6 the expected finding would then be missing at random. In step 5 "no blocked-prompt" would pass on an empty pane and prove nothing. Step 6 should wait for `Yes, I trust this folder` in the pane, and step 5 for `ready`, before `metrics`, as step 3 does. | fixed: the test waits for each launch's last screen line in the pane (ready, Enter to confirm) before metrics |
| F2-2 | Minor | Test not environment-dependent | Task 1, the note after step 8 | The plan sets `LANG: 'C.UTF-8'` on every platform. plan-1 F3 and the repo's own convention (machine.test.mjs:15, operator-threads.test.mjs:17) use `en_US.UTF-8` on darwin. CI runs ubuntu only, so CI passes. On a Mac, though, the `❯` and `│` cases would rely on a locale macOS may not have under that name. Use the same expression those files use. | fixed: en_US.UTF-8 on darwin, C.UTF-8 elsewhere, as the other tmux tests do |
| F2-3 | Minor | Record complete (quality.md §3 "The record", §1 item 4) | reviews/plan-1.md, every row | fa8af84's message says "dispositions", but every Disposition cell in plan-1.md is empty, including F1's (Important). The plan fixes each finding, but `check-ticket` fails while an Important finding lacks a disposition. Fill them with `devteam.mjs dispose kit-233-worktree-trust plan-1.md F<n> "…"`. Filling the cells does not void plan-1's verdict or this one. | fixed: plan-1 cells filled (the earlier fill missed their two-space cells) |
| F2-4 | Suggestion | Clarity | Task 1 step 5 | The step says "Settings `agent_trust_command` set to `sh <trust.sh>`", but the fixture's block has no such key yet. Say that the key is added to the parsed json block, with `JSON.stringify` for the value, as kit-232 does for `agent_command`. Step 6 can then replace that key's value. | fixed: the test adds the key after resume_command with JSON.stringify |

Verdict: APPROVE fa8af84e708acc303867ee25b0bdbe29881a01da
