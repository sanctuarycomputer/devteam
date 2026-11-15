## Summary

A new worktree is a folder the agent has never run in, and Claude Code 2.1 stops at its folder-trust dialog there, even with `--dangerously-skip-permissions` (one worker on another fleet sat 8 h there). The dialog now reads `Quick safety check: …` / `❯ No, exit` / `Yes, I trust this folder`, with no numbers, so none of the kit's prompt patterns matched it and the window was never flagged.

- **The finding.** A new pattern, `PANE_TRUST`, matches a folder-trust dialog (`Quick safety check:` and `Yes, I trust this folder` at a line start, after an optional box edge, cursor or number; `Do you trust this folder` and similar). It counts only when nothing on the pane is busy, so the same words shown as an agent's own output don't count. The metrics pass then raises `blocked-prompt` for the worker or planner, naming the dialog's line, within one tick. The limit-relaunch check reads it too.
- **The pre-trust hook.** New setting `agent_trust_command` (default empty). The kit runs it before it types a worker's or planner's agent command, fresh or resumed, in the worktree, with `DEVTEAM_WORKTREE` set to the worktree's real path. Its output goes to stderr. If it fails or runs past 60 s the kit warns and launches anyway, and the finding still catches the dialog. The kit writes no harness config itself. The comment by the default gives the Claude Code example: set `projects[$DEVTEAM_WORKTREE].hasTrustDialogAccepted` in `~/.claude.json`, atomically.
- **The owner's.** `agent_trust_command` is `governance-edit`, the same as `agent_command`: `merge` refuses a PR that changes it unless it has the owner's answer. `governance/quality.md` §4 lists it (ruling m-20261115-071339001-supervisor).

## How to verify

`node --test --test-concurrency=2 --test-name-pattern='folder-trust' test/kit.test.mjs` (needs tmux; about 10 s)

A stand-in agent (not `claude`) shows the captured dialog unless the hook has named its folder, the way Claude Code behaves. The test checks these cases:
- One `metrics --json` raises `blocked-prompt` for `plan-big`, naming `Quick safety check:`.
- The dialog inside a box and a numbered option also raise it.
- A mention mid-line does not, and neither does the dialog under a busy line.
- With the hook set, it ran in the worktree with the worktree's real path, its output appeared only on stderr, the agent started trusted, and no finding was raised.
- A failing hook warns, the launch goes on, and the finding comes back.
- A chore that changes the setting is refused with `changes owner settings: agent_trust_command (governance-edit)` and passes with a `governance-edit` answer.

On main the test fails at its first check: there is no finding for the dialog.

Records: `docs/devteam-dev/tickets/kit-233-worktree-trust/` (spec, plan, reviews, verification).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
