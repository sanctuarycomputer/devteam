# kit-233-worktree-trust: verification

At commit `051fefcb319670d583815f42a5449254d94f40ab` (later commits change only this ticket's records). Local runs on the box with Node 18.20.4, with only the touched test file, at `--test-concurrency=2`, as the box rule says. CI runs the whole suite on Node 18, 20, 22 and 24.

The dialog in the test is the real one. Claude Code 2.1.325 was started in a fresh folder in a private tmux server and its pane was captured: `Quick safety check: …`, `❯ No, exit`, `Yes, I trust this folder`, `Enter to confirm · Esc to cancel`, with no numbered options.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | The metrics pass raises blocked-prompt (naming the session and the dialog line) when a session's pane shows a folder-trust prompt, within one tick | `devteam.mjs gate test -- node --test --test-concurrency=2 --test-name-pattern='folder-trust' test/kit.test.mjs` | Pass: 1, fail: 0 (gate test passed). One `metrics --json` returns `blocked-prompt` with `subject` `plan-big` and detail `waiting on a prompt in its pane: "Quick safety check: …`. The boxed and numbered forms raise it too. A mid-line mention and the dialog under a busy line do not. **Red first:** at task 1 (`fe6adbc`, before the change) the test failed with `a folder-trust dialog is a blocked prompt`; the task-1 reviewer also confirmed this in a separate worktree |
| 2 | For harnesses whose trust is a known config entry, the kit marks the worktree trusted before launch via a settings hook; with no hook, only the finding | the same test | With `agent_trust_command` set, the hook ran in the worktree with `DEVTEAM_WORKTREE` equal to its real path. Its output went to stderr only. The stand-in agent started trusted, showed no dialog, and no finding was raised. A failing hook (`exit 3`) warned `agent_trust_command failed` and the launch went on; the dialog and the finding came back. With no hook (the first case), only the finding. The Claude Code example is in the comment by the default |
| 3 | Tests for both, and (ruling m-20261115-071339001) merge refuses an unapproved change to the setting | the same test | `merge --chore trust --dry-run` on a chore that changes `agent_trust_command` is refused with `changes owner settings: agent_trust_command (governance-edit)`, and passes with an answered `governance-edit` question as `--approved`. The final-1 reviewer broke the code in a scratch copy four ways, and each made the test fail: the not-busy check dropped, the line-start anchor removed, the hook's output sent to stdout, the setting removed from `OWNER_SETTINGS` |
| 4 | test.yml passes on every job; no file is added | `devteam.mjs gate ci -- gh run watch <test run at the head> --exit-status`; `git diff --name-status origin/main...HEAD` | See the CI line below. Outside `docs/devteam-dev/tickets/kit-233-worktree-trust/`, the only changes are `M docs/devteam/governance/quality.md`, `M docs/devteam/scripts/devteam.mjs` and `M test/kit.test.mjs` |

Not covered by a test (reviews task-1 F1 and F2, final-1 F1 and F2):
- The realpath. CI is Linux, where the fixture's path has no symlink, so `wt` and `realPath(wt)` are the same there. The code passes `realPath(wt)`.
- The hook's 60 s timeout path.
- `limitStop` reading `PANE_TRUST`. It can only hold a limit relaunch back, and that check already counted `Enter to confirm`.

Nothing is deferred to beta. No project's settings set `agent_trust_command` yet. Setting it is the owner's call (`governance-edit`).
