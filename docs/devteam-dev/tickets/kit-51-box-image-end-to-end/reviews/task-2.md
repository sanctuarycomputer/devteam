# Task review, task 2, pass 1

- Reviewer: task-2-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: a421989c042c3ae79c827f2dfc63e75ea55210c4 (.github/workflows/box-image.yml, Task 2 and task-1's fixes)

Scope: `git diff b980d71 a421989 -- .github/workflows/box-image.yml`, held to spec.md step 5 (DW4), the Notes on killing the hub's window, and plan.md Task 2. I also checked task-1's F1-F4 fixes. Box-image run 43681773657 (green) was read from its log.

What I checked:

- **The run.** Every step passed. The DW4 step printed `the hub is back as pid 811` (HUBPID was 160) 1.4 s after the step began, and that time includes `docker exec`. The rest of the step's 56 s is the minute loop bringing back `home:hub`, well inside the 90 s budget. Every step, the pre-existing ones included, ran under `/usr/bin/bash --noprofile --norc -e -o pipefail {0}`.
- **Local checks.** The YAML parses (ruby 3.4.12) and `defaults.run.shell` is `bash`. I ran `shellcheck -s bash -S warning` on each extracted `run:` body. The only hit is SC1090 on `. "$BOX_SH"`, the known non-constant source. The in-box DW4 body, extracted on its own, is clean.
- **Vacuity, by mutating the kill loop** with stubbed `list_in`, `holder_in` and `kill`. When the holder is still HUBPID (the hub never came back), the loop exits 1. It also exits 1 when the holder fails the cmdline check (back as a non-hub) and when the list fails the hub, kit or image check. It exits 0 only for a new pid that passes both checks. `kill` failing (wrong user, gone pid) leaves the old pid as holder, so the loop fails closed. HUBPID can't be empty here, because step 2 exports it only after `holder` succeeds. The window half: `if has_hub_window; then …; exit 1; fi` fails if `kill-window` didn't remove it. If the window never comes back, `until_ok 90` fails. `list_ok` and `holder` then check what answers. The spec's Notes accept a lingering image hub after the window is closed, so not comparing pids there follows the spec.
- **The 5 s deadline.** It uses `date +%s%N`, measured in the box from just after `kill`, not a count of rounds. It is checked only before each poll starts, though. See F1.
- **set -e traps.** The in-box `bash -c` has no `-e`. Its control flow is explicit (`if …; then exit 0`, then `exit 1`). On the runner, the helpers run only inside `until`/`if` conditions or with `||`. `left()` returns its own status, and `until_ok 5 … left || { dx cat "$log"; exit 1; }` dumps the log and fails. No `!` is used.
- **Quoting.** `dx env HUBPID="$HUBPID" bash -c "$IN_BOX"'…'`: HUBPID is expanded on the runner into env's argv. The appended body is single-quoted on the runner, so `"$HUBPID"`, `$p` and `$end` expand in the box. REL reaches `list_in` through `dx`'s `-e REL`. `exit` inside the body leaves only the box shell, and `dx` passes its status back.
- **`defaults.run.shell: bash`** adds pipefail and `--noprofile --norc`. The pre-existing smoke step is one `docker run … sh -ec '…'`, and every pipe in it runs inside the container's `sh`, so the runner's pipefail doesn't touch them. `docker build`, the failure dump and the cleanup have no runner-side pipes, and every command in the dump and cleanup still has `|| true`.
- **Task-1's Minors.** F1: `list_in` uses `--max-time 2`. F2: the /healthz curl has `--max-time 5`, so the 120 s deadline is checked at least every ~6 s. F3: job-level `shell: bash`, confirmed in the log. F4: the `hub: left to the image` line is polled for 5 s with the exact suffix match kept. All four are fixed as dispositioned.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec step 5 (within 5 s) | DW4 step, the in-box kill loop | The deadline is checked only before a poll starts. A poll that starts at 4.9 s can still succeed: `list_in`'s curl can run up to 2 s, then node and `holder_in`'s lsof run after it. That counts as a pass. With a `list_in` stub that sleeps 2 s, the loop exits 0 at 6.4 s. To fail, the new hub has to be listening before 5 s but answer late, so the gap is narrow, but the bound is not a true wall-clock bound. Re-read `date +%s%N` after a successful poll and pass only if it is still before `end`. | fixed in 83fd9be |

Verdict: APPROVE a421989c042c3ae79c827f2dfc63e75ea55210c4
