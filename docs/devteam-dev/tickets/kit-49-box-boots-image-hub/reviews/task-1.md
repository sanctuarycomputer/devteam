# Task review, pass 1: task 1 (the boot starts and keeps the image's hub)

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: 8baa8aee8458beb20bfdbdeb38ca1529464e4f1e (task 1)

## What I checked

I read `git show 8baa8ae` against plan.md Task 1, its Global Constraints and Review Focus, and spec.md, and read the whole `devteam-dev` heredoc around the new lines. I ran only `test/machine.test.mjs`, filtered (`--test-name-pattern="hub|boot|minute loop"`, `--test-concurrency=2`). Load was 8 to 18. Every selected test passed, the five new ones too. `status names the hub's kit, or says it is no hub, or down` also passed in that run, after the new tests had run.

**Shell (dash, which is `/bin/sh` here and in the image).**
- The `case *[!v0-9.]*` pattern turns away a newline or any other character before grep sees the value. An empty value falls through to `grep -xE`, which fails, so `hub_rel` ends up empty. grep's exit status is harmless because the script has no `set -e`.
- `'$hub_rel'` inside the double-quoted `hub_cmd` can only ever hold `vN.N.N` or nothing, so the quoting can't be broken.
- `return` inside `while` inside a function is POSIX.
- The new names (`hub_rel`, `hub_cmd`, `hub_w`, `hub_end`) don't clash with `c`, `s`, `r`, `k`, `up`, `p`, `n`, `panes` or `ask`. In the minute loop, `hub_window` runs in the backgrounded subshell anyway.
- The heredoc is `<<'EOF'`, so Docker expands no `$`.
- `ENV DEVTEAM_IMAGE_HUB=4320` reaches `devteam-dev`, because `as_dev`'s `env` keeps the environment. It reaches the dashboards' panes through the tmux server's environment. The hub's `HUB_PORT` defaults to 4320, and `cmdHub` doesn't step back.
- shellcheck 0.11.0 (`-s sh`) on the extracted script reports nothing on the new lines.
- One hole, F1: the `$(( ))` guard misses leading zeros.

**tmux.**
- `has-session -t =home` and `list-windows -t =home` are session targets with an exact match.
- `new-window -t '=home:'` names the session and lets tmux pick the next index.
- `-n` turns automatic-rename off for the window, so `grep -qx hub` keeps matching.
- `new-session -d` from the background loop needs no terminal.
- When the tmux server is gone, `has-session` fails and `new-session` runs, which is Review Focus 4 and is tested.

**Tests.** I mutated `cloud/Dockerfile` in place, ran the named test, then restored it from a copy. `git status --porcelain` was empty afterwards. Each mutation failed its test:

| Mutation | Test that failed |
|---|---|
| `'=home:'` → `'=home'` | #25, the real-tmux test (Review Focus 1, the author's result confirmed) |
| drop `sleep 1;` in `hub_wait` | #22 (curl count, Review Focus 3) |
| `grep -qx hub` → `grep -q hub` | #23 (`hubby`) |
| drop the wait-seconds `case` | #22 (`15s`) |
| drop the release `case` | #21 (the two-line release, Review Focus 2) |

The fakes follow the file's conventions: one bin dir first on PATH, calls split by `\x1f`, and `sh` resolves to dash. The real-tmux test runs on the test server through `baseEnv`. It swaps the node command for `sleep 600; :` and asserts that the swap happened, so no real hub binds 4320. It also checks that the other session is left alone. One oddity, not a finding: `cmd.replace(r.home, s.home)` in test 1 does nothing, because the command doesn't contain `$HOME`.

**The whole-file flake.** kit-49 changes no `devteam.mjs`. Within one file, the new tests run in sequence before that test, and they leave nothing running: the real-tmux test kills both of its sessions in `finally`, and the others are short `sh` runs. That test also passed in this filtered run right after them. I put the flake down to load, not to kit-49.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | Important | plan.md Task 1 Interfaces ("so a bad value can't make `$(( ))` kill devteam-dev before the dashboards and ttyd"); cloud/Dockerfile `hub_wait`. `case $hub_w in ''\|*[!0-9]*)` passes `08` and `09`. dash then fails the arithmetic with "Illegal number: 08" and the non-interactive shell exits. I ran the `note`/`hub_wait` lines under `sh` with `DEVTEAM_HUB_WAIT_SECONDS=08`: the next command never ran. That kills `devteam-dev` before the dashboards, box-recover, the minute loop and ttyd. `010` reads as octal (8 s). Fix: also refuse a leading zero (`''\|*[!0-9]*\|0?*) hub_w=15`), and add `08` to the test's bad-value case. || Fixed: the guard also refuses a leading zero (0?*); the test covers 15s, 08, 010, -1; a mutation without 0?* fails it. |
| F2 | Suggestion | No rule cited. The boot's bare `hub_window` adds a second hub window if `home` already holds one, for example when `devteam-dev` is run by hand on a live box. Each extra window spawns node about once a second against a taken port. Running the call as the minute loop's guarded line (`list-windows … \| grep -qx hub \|\| hub_window`) would cost nothing. || Fixed: the boot runs the same guarded line as the minute loop; the order test asserts both lines are the same. |
| F3 | Suggestion | spec "How": env drops what would "point the hub at another home". The pane's `HOME` still comes from the tmux server's global environment, which any agent can change, and the hub's state and log follow `os.homedir()`. The window command is fixed by Global Constraints, so this is noted, not asked for. The spec's P6 already admits a dev-user agent can take the port. || Fixed: the wrapper sets HOME to devteam-dev's own, expanded when the window is made; asserted in the test. |

Verdict: CHANGES 8baa8aee8458beb20bfdbdeb38ca1529464e4f1e
