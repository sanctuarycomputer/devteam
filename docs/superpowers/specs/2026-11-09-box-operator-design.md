# The box operator

## Goal
A devteam cloud box (`cloud/`) has one agent session that looks after the machine rather than a
repo: the **operator**, window 0 of tmux session `home`, the first thing the Terminal tab shows.
It starts automatically at boot, brings the supervisors back after a deploy, and keeps the fleet
moving. It exists only on a box: the kit runs without it, and adopting projects never get it.

## What it does
- Clones repos into `~/code`, and their siblings where their settings say.
- Adopts devteam in a new repo by opening `sup-<repo>` and launching setup there (README Setup: the
  session that does the setup becomes the supervisor). It never does the setup in its own context.
- Starts the supervisors (`box-supervisors`).
- Each tick, reads the box (`box-status`) and sees that each repo is moving: supervisor alive and
  not stuck at a prompt or limit, kit versions in step, gates runnable, disk and memory healthy.
- When a repo can't start or run on the box, it finds out why. A fix inside `$HOME` (`mise`, a
  `~/.box/boot.sh` line, a global tool) it makes. A fix the image or kit needs it opens as a PR
  on upstream devteam, and tells the owner that repo is blocked until a release carries it.
- Opens kit improvements it sees across supervisors as upstream PRs, written generically.

## What it must not do
It is an operator, not an authority. The chain stays owner > supervisor > planner > worker.
No answering Inbox questions, approving, merging, tagging, releasing, or writing to any repo's
devteam log. No instructions to workers; a supervisor directs its own. Enforced by:
`DEVTEAM_ROLE=operator` (the kit's owner commands refuse any set role) and a `--settings` deny
list (`gh pr merge`, `gh release`, `gh api`, `gh secret`, `git tag`, pushes to main). Those are
guard rails, not a sandbox: the operator is the same Unix user as every agent. The prompt says so.

## Boot
Owner's decision: the operator is what starts automatically, and nothing falls back if it can't
start ("lets just assume the operator always starts"). So `devteam-dev` no longer resumes
supervisors itself. It:
1. Saves the list of supervisors that were up (`~/.devteam-supervisors`) to `.boot`, only when the
   list is non-empty, so a boot that never got as far as resuming doesn't lose it to the next.
2. Runs what it runs today (locks, dashboards, `~/.box/boot.sh`, ttyd).
3. Creates `home` with window 0 `operator` in `~/operator` and window 1 `shell`.
4. Starts Claude Code in window 0 with `DEVTEAM_ROLE=operator`: `--continue` if `~/operator` has a
   conversation, else fresh, with a first message to read `/opt/devteam/operator.md` and run
   `box-supervisors`. First boot needs the owner to log in there.
5. Types a tick into window 0 every 30 minutes, only while Claude is running in it.

## box-supervisors [--all] [--dry-run]
One line per folder in `~/code` with the kit, saying what it did and why. Default (restore): starts
those in the boot list whose fleet isn't parked or drained. `--all`: every adopted repo, parked
included (starting a supervisor never unparks). Skips: a repo with the kit but no
`project/settings.md`; a **sibling** (its normalized origin is a `repo` link of another adopted
repo, unless that link is mutual); a supervisor already running. Resumes the supervisor's own
conversation (`supervisor-session`, the repo's `resume_command`), else starts fresh with
`agent_command` and `prompt supervisor`. Its first message names any `worktree_files` missing here,
and tells the supervisor to ask for them in the Inbox with `--secrets` and `file:<path>` before
starting a worker. The boot list is consumed when a restore has run. Safe to run again.

## box-status
A read-only digest for each tick. Box: disk, memory, load. Each adopted repo: supervisor up or
down, fleet mode, kit version, Inbox count, missing `worktree_files`, tools `mise` lacks.

## Files
`cloud/operator.md`, `cloud/operator-settings.json`, `cloud/box-supervisors`, `cloud/box-status`,
all copied read-only into the image; `cloud/Dockerfile`; `README.md`; `test/box-supervisors.test.mjs`.

## Not in this
A box-level Inbox (the operator reports in its window and `~/operator/NOTES.md`).
