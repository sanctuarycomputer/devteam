# Final review, pass 1 (track b)

- Reviewer: final-b (fresh subagent of the supervisor, claude-sonnet)
- Reviewed: 47fff63fec60c849d389a2b19c61f8ccb153294b

| Id | Severity | Rule cited | Where | Finding | Disposition |
|----|----------|------------|-------|---------|-------------|
| B1 | Minor | spec DW4 (green at the PR's head) | PR 247 checks | At review time the box-image run 43682851074 and test run 43682851096 on 47fff63 were still in progress (pending). The commits since e430783 add only records, and the runs at e430783 (43682276306, 43682276230) are green, so this is not a defect. The merge needs both green at the head. | wont-fix deferred (Minor, per supervisor m-20261115-055425612) |
| B2 | Minor | spec step 6 | box-image.yml "what the box said" | The failure dump was not exercised by this green run, so its output was not seen. The paths it reads were checked against the kit and Dockerfile (`~/.devteam/hub-<port>.log`, `~/box.log`) and each command ends `|| true`. | wont-fix deferred (Minor, per supervisor m-20261115-055425612) |

No Critical or Important finding.

## What I checked

- Read spec.md, verification.md, the kit-51 part of the design, and the whole diff outside docs/devteam-dev. Only `.github/workflows/box-image.yml` changes (137 added lines); the only added files are under the ticket folder. No project-specific text in the kit diff (no `sanctuary` or `devteam-dev`).
- Run 43682276306 at e430783, success. The job ran 05:43:14 to 05:47:25, about 4 m 11 s, under the 45 min timeout; 0 `##[error]` lines.
  - DW1: the boot step read REL `v0.52.0` and the non-empty TOOLS; the hub step passed (list, window, holder) and `HUBPID: 157` appears in later steps' env.
  - DW2: the dashboard step ran `init --name e2e` and passed. A step passes only when its `left` check, the holder-still-157 check and the list check all pass (`set -e`, `until_ok`).
  - DW3: box-status printed `machine: hub 4320 up, kit v0.52.0 (image)` and `machine: box v0.52.0: claude-code 2.1.307, claude-swap 1.0.0, gh 2.104.0, ttyd 1.7.7, mise v2026.10.17, uv 0.13.7`, which is TOOLS in its order. The `image: $REL` docker-logs match is the step's first check and it passed.
  - DW4: `the hub is back as pid 700` at 1.7 s after the kill; the window-kill, window-back (56 s) and holder checks passed (step ended 05:47:18).
  - Cleanup ran (`docker rm -f box`, `docker volume rm box-data`, each `|| true`, `if: always()`).
- Read the workflow logic: `bash -euo pipefail`, whole-output capture before grep, the in-container 5 s timer, `=home` exact tmux targets, the argv[1]/argv[2] check from /proc cmdline, and the `${l#*] }` tail compare. I found no logic hole that makes a check pass on empty or wrong input.
- The test.yml and box-image runs at the head 47fff63 were pending; see B1.

Verdict: APPROVE 47fff63fec60c849d389a2b19c61f8ccb153294b
