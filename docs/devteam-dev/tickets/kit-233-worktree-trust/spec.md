# kit-233-worktree-trust: spec

## Problem

A fresh worktree is a folder the agent has never run in. Claude Code (2.1.325 on this box) then puts
up its folder-trust dialog and waits, `--dangerously-skip-permissions` or not. Captured here in a
private tmux server, the pane's text is:

```
 Accessing workspace:
 /…/fresh-dir
 Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source project, or work from your team). If not, take a moment to review what's in this
 folder first.
 Claude Code'll be able to read, edit, and execute files here.
 Security guide
 ❯ No, exit
   Yes, I trust this folder
 Enter to confirm · Esc to cancel
```

None of `PANE_WAITS`' prompt patterns matches it: the options carry no `1.` (so `❯\s*1\.\s*Yes` misses),
and the wording is no longer "Do you trust the files". So no `blocked-prompt` finding is raised, the
log shows the session at `starting`, and it sits there unseen until it goes stale (mothership
companion-134: 8 h; devteam-dev kit-46/47, o-20261114-213556652).

## Change

1. **The finding.** `PANE_WAITS`' `prompt` pattern also matches a folder-trust dialog, in words not
   tied to one harness's version:
   - a line that starts (after an optional box edge `│`, a `❯` cursor and an `N.` number) with
     `Yes, I trust this folder` (or `directory`, `workspace`);
   - a line that starts `Quick safety check:`;
   - `Do you trust the (files|contents) …` / `Do you trust this (folder|directory|workspace)`, beside the
     existing `Do you trust the files`.
   The two new anchored forms are anchored to the line start so prose an agent writes about trust
   (this ticket's own pane) does not match mid-line. `paneWaitingIn` then returns the first matching line,
   and the metrics pass raises `blocked-prompt` for the worker (`subject` its ticket id) or planner
   (`plan-<feature>`) with `waiting on a prompt in its pane: "<line>"`, as for any prompt: the same
   pass, so within one tick. The detail names the dialog (`Quick safety check: …`, the first line of the
   dialog in the pane's bottom 15).
2. **The pre-trust hook.** A new setting, `agent_trust_command` (default `''`, a string): a shell command
   the kit runs before it types the agent's command into a worker's or planner's window, fresh or resumed,
   with `cwd` the worktree and `DEVTEAM_WORKTREE` set to the worktree's absolute path (plus the env
   `worktree_setup` gets). It is how a project whose harness keeps trust in a known config entry marks
   the worktree trusted, so the dialog never appears. For Claude Code that entry is
   `projects["<dir>"].hasTrustDialogAccepted: true` in `~/.claude.json` (`$CLAUDE_CONFIG_DIR/.claude.json`
   when set); the comment by the default gives that as the example, and the kit itself writes no harness
   config (P1). The hook:
   - runs only when set (empty: nothing runs; the finding is the only defence);
   - runs once per launch, after `seedWorktree`, before the launch lock and the typed lines;
   - has a 60 s timeout; a failure or timeout warns (`agent_trust_command failed in <wt>: …; if the agent
     asks whether to trust its folder, the blocked-prompt finding shows it`) and the launch goes on,
     since the finding still catches the dialog;
   - is owner-only, `governance-edit` like `agent_command` (it runs on every launch and decides what the
     agent trusts), pending the supervisor's ruling on m-20261115-071257437 (see Rulings).

## Acceptance checks (the done-whens)

| # | Done-when | Check |
|---|---|---|
| 1 | The metrics pass raises blocked-prompt (naming the session and the dialog line) when a session's pane shows a folder-trust prompt, within one tick | New test in `test/kit.test.mjs` on its own `threadsFixture`, skipped without tmux: `agent_command` is a stand-in node script written at test time that prints the captured Claude Code 2.1 dialog text and waits; `planner big --goal …` launches it; one `metrics --json` (one pass, so one tick) has a `blocked-prompt` finding with `subject` `plan-big` and a detail naming the dialog line (`Quick safety check:`). A unit-level check of the pattern on the trust lines: `Yes, I trust this folder`, `❯ 1. Yes, I trust this folder`, `│ Quick safety check: …` match; a mid-line mention (`the dialog says Yes, I trust this folder`) does not |
| 2 | With `agent_trust_command` set, the kit runs it before launch for the worktree, so the dialog never appears; with none, only the finding | Same test file: with `agent_trust_command` a stand-in that writes `$DEVTEAM_WORKTREE` and its `cwd` to a file, and the stand-in agent showing the dialog only when that file does not name its own cwd (as Claude Code does), a planner launch: the file names the planner's worktree (absolute), the agent recorded it trusted at its start, and `metrics --json` has no `blocked-prompt` for `plan-big`. A failing hook (`exit 3`) warns and still launches. Check 1 is the no-hook case |
| 3 | Tests for both | Checks 1 and 2 |
| 4 | test.yml passes on every job; no file is added | GitHub CI green at the head; `git diff --name-status origin/main` shows M for the touched files and A only for this ticket's records |

## Contracts

None provided or consumed. A new setting with a default: a project that sets nothing sees no change but
the finding.

## Edge cases

- A worker or a planner: both are read through `paneWaitingIn`, the planner through `planners()`, the
  worker through `paneWaiting` (only while it is active: phase `starting` counts). The test launches a
  planner (the threadsFixture has no ticket); the worker branch is the same function.
- The pane is narrow and the long line wraps: `Quick safety check:` starts its first row, and
  `Yes, I trust this folder` is short, so either matches.
- The dialog's own `Enter to confirm · Esc to cancel` is already not "busy" (`PANE_BUSY` lookbehind), so
  nothing changes for the limit check.
- A resume into an existing worktree runs the hook again: a hook is expected to be idempotent (setting a
  flag that is already set).
- The hook's own output goes to the launcher's stderr, as `worktree_setup`'s does.
- Concurrent writers of `~/.claude.json` (running Claude Code sessions rewrite it): the project's hook
  owns that risk; the comment says to write it atomically.

## Out of scope

- Answering the dialog by typing into the pane: the kit only reads panes for findings (supervisor.md §11).
- The supervisor's own `recover` and the operator launch: the ticket names workers and planners; the
  operator already says to answer the dialog by hand.
- Setting `agent_trust_command` in devteam-dev's or any project's settings: the owner's (governance-edit).

## Rulings

None yet. Pending: m-20261115-071257437 (owner-only, and quality.md in touches).
