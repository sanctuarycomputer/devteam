# Account rotation with cswap: design

Owner-approved 2026-11-09.

## Goal

When `cswap` (claude-swap) is installed, on a Mac or on a cloud Linux box, devteam uses it without any setup, so a fleet keeps working across the owner's accounts instead of stopping at a usage limit. On 2026-11-07 every fleet on one machine stopped at a weekly limit, and nothing on the hub said so.

## Behaviour

**A command does the work.** `devteam.mjs accounts-tick [--rotate]` is supervisor-only, by an inline check: `supervisorOnly` would record the dashboard's pane as the supervisor's. Every dashboard runs it every 60 s (`DEVTEAM_ACCOUNTS_MS`), one run at a time, with `DEVTEAM_ROLE=supervisor` in its environment, never as the owner. That keeps the kit's rule that only the supervisor acts on a pane, and a fake `cswap` dropped in `~/.local/bin` by an agent gets no owner identity. Every dashboard passes `--rotate`, and a machine-wide claim decides which one rotates (below); the hub plays no part, so a dashboard on an older kit or a dead one can't stop it.

**Detection, every tick.** `DEVTEAM_CSWAP=off`: none. Another value: that path or command. Unset: `cswap` on PATH, then `~/.local/bin/cswap`, and only when the hub port is the default 4320, so a test or fixture dashboard on its own hub port can never touch real accounts. The test library also sets `DEVTEAM_CSWAP=off`.

**Rotation (`--rotate`).** Runs `cswap auto --once --json`, with no strategy flags, so the owner's `cswap config` applies (default `best` at 90%). 45 s timeout. Stdout is one JSON event per line; unknown events are ignored. `switch` is logged. `all-exhausted` sets `exhausted`. Exit codes 2 and 3 are normal, so events are read whatever the status; a failure changes nothing and is logged once. `needs_login` (rows with `usageStatus: relogin_required`) and `exhausted` (no enabled account has room) are read from `cswap list --json` every tick, because cswap reports a quarantine only once.

**The claim.** `~/.devteam/accounts-rotate-<hub port>.json`, in the home directory because dashboards can have different `TMPDIR`s. A tick with `--rotate` takes it under a lock and runs `cswap auto --once` only if it got it. It goes stale at 90% of the tick interval, so a crash holds it for under a minute; one dated in the future or unreadable holds nothing. A lost claim means no rotation this tick and is logged.

**Leaving a full account.** `cswap auto --once` holds on an active account whose token expired while idle: the hold is per process, so with `--once` it never ends. After `auto`, if it didn't switch and the active account is known full (`usageStatus: ok` at a limit, or `token_expired` with a `lastGoodUsage` window at 100 that can't have reset yet, by `resetsAt` or else by the reading's age), and another enabled account has room, the tick runs `cswap switch --strategy best --json`. It renews the claim first and gives up if another dashboard has taken over. `best` needs the active account's usage, so on an expired token it answers `usage-unavailable`; the tick then runs `cswap switch <number>` on the account with the most room. Usage merely unknown never switches, and with no room nothing happens and `accounts-exhausted` reports it, counting a last-known-full account.

**Restarting a stopped session.** (Revised after v0.23.0: a running Claude Code session met the same limit banner after the login moved to an account with room, so typing a continue message never worked. The pane's process is now replaced with a shell, `tmux respawn-pane -k`, and the session relaunched as `worker|planner <id> --resume` would; nothing is typed into the old process, Escape included. The replacement happens inside the relaunch (`--replace-agent`), after every refusal and after `worktree_setup`, so a failed relaunch leaves the old session running. Only a one-pane window started in `.worktrees/<name>` that the supervisor's log shows it launched (and, for a worker, whose ticket started) is restarted, never one with background shells; one session per tick. `run/accounts-resumed.json` holds each session's restart times: at most one per 10 minutes and 3 in any 6 hours, past which it is left alone and listed in `run/accounts.json`'s `restart_gave_up` (a high `restart-gave-up` finding) until those attempts expire. The supervisor is reported only.) Original design: Needs cswap. `cswap list --json`: the row with `active: true` has room when `usageStatus` is `ok` and every window in `usage` has a numeric `pct` below 100. Without room, nothing is touched. With room, in a tick that didn't just switch (a macOS session holds the old login for about 30 s), for each of this project's windows (`ourWindows`; a session that is parked, done, merged or let go is skipped), and for the supervisor when it has a recorded pane:

- the pane has a live agent (`resolvePane`) and is not busy;
- its last 15 lines (code-like lines excepted, `PANE_CODE`) end on Claude Code's own limit banner (anchored: `You've hit your … limit · resets`, nothing the agent said after it) or show the limit menu in its real layout; prose quoting either, and another harness's limit message, do not count; a `prompt` match leaves it alone;
- no resume of that pane in the last 10 minutes (`run/accounts-resumed.json`, written before anything is typed);
- if the limit menu shows (`Stop and wait for limit to reset`), send `Escape`, wait 1 s, capture again, and go on only if the menu is gone. **Enter or a digit is never sent to the menu: its third item is "Switch to usage credits", which spends money.** Any other menu is left alone;
- type a one-line continue message with `typeInto`.

**A supervisor stopped at a limit.** Works with or without cswap. A supervisor with a recorded pane that resolves is resumed as above. Unless it was resumed in this tick, the supervisor's transcript in the main checkout (`CLAUDE_CONFIG_DIR` or `~/.claude`, `projects/<slug>/*.jsonl`, the last 1 MB) is read: the newest of the last five that the kit started as the supervisor or that ran `DEVTEAM_ROLE=supervisor node …` commands (run, not quoted), and no other. If its last assistant line has `error: "rate_limit"` and is under seven days old (the longest a limit lasts), `supervisor_limit` holds that line's time and message.

**Visibility.** Each tick writes `run/accounts.json`: `{ at, cswap, active, active_no_room, exhausted, needs_login, restart_gave_up, supervisor_limit, resumed }`. Read only when `at` is under 10 minutes old:
- metrics findings: `accounts-exhausted` (high), `account-needs-login` (medium, one per account), `supervisor-at-limit` (high);
- `hello` carries `alert` when the supervisor is stopped; the hub tab shows it;
- `worker` and `planner` warn before launching when `active_no_room` is set, and never refuse.

`supervisor.md` says this happens, and the dashboard now clears limit stops only when cswap reports room.

## Limits

- A dashboard on an older kit rotates by its own rule, without the claim, until it is restarted.
- cswap and the menu text are Claude Code's. Other harnesses are not resumed.
- A supervisor outside tmux can only be warned about.
- `cloud/Dockerfile` (#121) installs cswap with `uv`, because it needs Python 3.12; done there.

## Tests

A stand-in `cswap` script, on a test's own hub port, in `test/accounts.test.mjs`:
- one dashboard per interval calls `auto --once --json` whichever holds the hub, a stale or future-dated claim is taken over, and `off` calls nothing;
- a full account with an expired token is left, while unknown usage or no room is not;
- `switch`, `all-exhausted` and `account-quarantined` reach `run/accounts.json` and findings, and old data is ignored;
- no room leaves a stopped pane alone; room resumes it once inside 10 minutes; the menu gets Escape and never Enter or a digit; a pane with another prompt is left alone;
- a transcript ending on `rate_limit` raises the finding and `hello.alert`, and a supervisor pane in tmux is resumed instead.
