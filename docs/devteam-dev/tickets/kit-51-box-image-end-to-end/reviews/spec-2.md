# Spec review, pass 2

- Reviewer: spec-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: dd195773a4d742b8d591d5820da6413a33ff4dd2 (spec.md, the fix for spec-1)

I read only `git diff e8f3463 dd19577 -- spec.md`, the surrounding spec, and the lines of `cloud/Dockerfile` the fix cites.

- F1: fixed. Step 3 now uses `grep -F` on the text and compares the line's tail exactly after the `<time> [<pid>] ` prefix. The edge-case sentence now names the dashboard log's line as the one exception to whole-line matching.
- F2: fixed. Step 3 adds `mkdir -p docs` before `cp -R`, and names the repo `/data/home/code/e2e` outright, both for the path and for the `tmux new-window -c` argument. No `~` is left in the commands typed on the runner.
- F3: fixed. The "What changes" preamble now requires every check to capture a command's whole output into a variable before grepping it, so a `grep -q` that stops early never fails its writer under pipefail.
- F4: fixed. Step 6 names `/data/home/box.log`, `/data/home/.devteam/hub-4320.log` (the hub runs with `HOME='$HOME'`, Dockerfile:403) and `/data/home/code/e2e/docs/devteam/run/dashboard.log`, and runs `tmux list-windows -a` as dev. The failure and cleanup steps do not use `box.sh`, and each command ends in `|| true`.
- F5: fixed. The edge case now says hub_window runs right after the operator block (Dockerfile:405), before `mise install` (472) and boot.sh (482). It also says hub_wait (483) and the dashboards come after boot.sh. This matches the Dockerfile.
- F6: fixed. The kill and the 5 s poll now run inside one `docker exec`, so the budget times the hub's restart and not docker's overhead.

The diff adds no new Critical or Important problem. It adds one Minor gap, below.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | spec § What changes (shared helpers in `$RUNNER_TEMP/box.sh`), step 5 first bullet | spec.md step 5, first bullet | The poll now runs inside the container, where the lsof/cmdline and list helpers that `box.sh` defines on the runner cannot be sourced. Say how the in-container loop gets them: feed `box.sh` plus the loop to `docker exec -i -u dev box bash -s` on stdin, or inline them in that one script. Otherwise an implementer may write a second, different copy of the holder check. | fixed in plan.md (IN_BOX: the in-container checks written once, run by the runner helpers and the T2 loop) |

Verdict: APPROVE dd195773a4d742b8d591d5820da6413a33ff4dd2
