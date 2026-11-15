# kit-51 plan: the built box image, end to end in CI

## TL;DR

- One file changes: `.github/workflows/box-image.yml`. Its `build` job keeps its build and its no-boot smoke check, then boots the image and checks it from inside, in the same job.
- T1: boot, then the image's hub (DW1), a current dashboard leaving the port alone (DW2), and the versions (DW3).
- T2: the hub comes back after a kill and after its window is closed (DW4), plus a failure dump and cleanup that always run.
- Shared shell helpers are written once to `$RUNNER_TEMP/box.sh` and sourced. Every check reads a command's whole output first and then matches it. Never `cmd | grep -q` under pipefail (spec-1 F3).
- Local checks only (no docker on the box): the YAML parses, and shellcheck passes on every `run:` body pulled out of it. The real test is the box-image run on the PR. The PR opens as a draft after T1, so each task is proved by its own CI run.
- No kit, image or gateway change. If a check finds the image wrong, that goes to the supervisor as a `design-change`.

**Spec:** `docs/devteam-dev/tickets/kit-51-box-image-end-to-end/spec.md` (approved stages and rulings there).

## Global constraints

- Touches only `.github/workflows/box-image.yml`. No file is added to the repo (`$RUNNER_TEMP/box.sh` lives on the runner).
- Every new step uses `shell: bash` with `set -euo pipefail` at the top of its body (`defaults.run.shell: bash -euo pipefail {0}` on the job is fine).
- Paths inside the container are absolute: `/data/home/...` (spec-1 F2/F4).
- Matches are fixed-string, whole-line (`grep -qxF` on a captured variable via `<<<"$out"`). The one exception is the dashboard.log line: its tail after `<time> [<pid>] ` is compared exactly (spec-1 F1).
- Budgets: /healthz 120 s; hub up 60 s; dashboard `started on` 60 s; instance listed 15 s; hub back after kill 5 s (polled inside one `docker exec`, every 0.2 s); window back 90 s, then hub answering 15 s.

## Review focus

1. **A check that passes vacuously.** REL is required to match `^v[0-9]+\.[0-9]+\.[0-9]+$` and TOOLS to be non-empty before any check uses them. The new-pid check after the kill requires the pid to differ from the killed one.
2. **pipefail against an early-exiting reader** (box-status streams its output for seconds). Every check captures output first. In T1, the reviewer greps the yml for `| grep -q` and finds none.
3. **docker exec's user and env.** The helper `dx` runs `docker exec -u dev -e HOME=/data/home box`. tmux then reaches dev's server (`/tmp/tmux-1000`), and lsof sees dev's processes.
4. **A step that fails before box.sh exists.** The failure-dump and cleanup steps don't source it and never fail themselves.
5. **Timing under load** (mise install and the operator's claude running): each wait is a poll with a deadline, never a single read or a fixed sleep. The one exception is the explicit "window is gone" check, made right after kill-window.

---

### Task 1: boot, hub, dashboard, versions (DW1, DW2, DW3)

**Files:** Modify `.github/workflows/box-image.yml` (append steps to job `build`, after the existing smoke `run`).

**Interfaces (produces, in `$RUNNER_TEMP/box.sh`; the step that writes it also exports `BOX_SH` to `$GITHUB_ENV`, and `REL`, `TOOLS` and `HUBPID` go there too):**
- `dx <args…>`: `docker exec -u dev -e HOME=/data/home -e REL="$REL" box "$@"`
- `until_ok <seconds> <what> <cmd…>`: reruns cmd every 1 s until it exits 0. Past the deadline it prints `timed out after <s>s: <what>` and returns 1.
- `IN_BOX`: a shell variable holding the text of the in-container checks, the only place they are written (spec-2 F2-1). Each runner helper and T2's in-container loop runs it as `dx bash -c "$IN_BOX"'; <fn> …' _` with `-e REL`. It defines:
  - `list_in [root]`: `curl -fsS --max-time 2 http://127.0.0.1:4320/instances.json`, read whole into a variable and checked by `/usr/local/bin/node -e`. It succeeds iff `hub===1 && kit===process.env.REL && image===true`, and, when `root` is given, `instances` has an entry with that `root`.
  - `holder_in`: the pid from `lsof -nP -iTCP:4320 -sTCP:LISTEN -t`, which must be exactly one line. It succeeds and prints the pid iff that pid's `/proc/<pid>/cmdline`, split on NUL, has argv[1] `/opt/devteam/kit/scripts/devteam.mjs` and argv[2] `hub`.
- `list_ok [root]` and `holder`: the runner's wrappers for `list_in` and `holder_in`.
- `has_hub_window`: `out=$(dx tmux list-windows -t =home -F '#{window_name}')`, then `grep -qxF hub <<<"$out"`.

- [ ] **Step 1:** Write the steps:
  1. `boot`: `docker volume create box-data`; `docker run -d --name box -e DEVTEAM_PUBLIC_URL=https://box.test -v box-data:/data -p 127.0.0.1:8080:8080 box`. Wait 120 s for `curl -fsS http://127.0.0.1:8080/healthz`; fail at once if `docker inspect -f '{{.State.Running}}' box` isn't `true`. Read REL and TOOLS with `docker exec box printenv` and validate them (review focus 1). Write box.sh.
  2. `the image's hub (DW1)`: `until_ok 60 'the hub answers' list_ok`; `has_hub_window`; `HUBPID=$(holder)`, exported.
  3. `a current dashboard leaves the port alone (DW2)`. In one `dx sh -ec '…'`: `mkdir -p /data/home/code/e2e && cd` there; `git init -q -b main`; `mkdir -p docs`; `cp -R /opt/devteam/kit docs/devteam`; `node docs/devteam/scripts/devteam.mjs init --name e2e`; `git add -A`; `git -c user.name=e2e -c user.email=e2e@box.test commit -qm e2e`. Then `dx tmux new-window -d -t '=home:' -n e2e-dash -c /data/home/code/e2e "while :; do /usr/local/bin/node docs/devteam/scripts/devteam.mjs dashboard; sleep 5; done"`. Run `until_ok 60` until the dashboard.log has `started on`. Then assert the log has a line whose text after the first `] ` is exactly `hub: left to the image (DEVTEAM_IMAGE_HUB=4320)`. Assert `holder` equals `$HUBPID`. Finally, `until_ok 15 'the list names e2e' list_ok /data/home/code/e2e`.
  4. `the versions show (DW3)`: `logs=$(docker logs box 2>&1)`, then `grep -qxF "image: $REL"`. `st=$(dx box-status)`. Assert `st` has the whole line `machine: hub 4320 up, kit $REL (image)`, and the whole line `machine: box $REL: ` followed by TOOLS turned from `n=v n=v` into `n v, n v` in order.
- [ ] **Step 2:** Check locally. `node -e` parses the yml with a YAML parser if one is at hand, or `python3 -c 'import yaml'` if PyYAML is present; otherwise check the indentation by eye and rely on GitHub's parse. Then extract each `run:` body to the scratchpad and run `shellcheck -s bash` on it. Expect no errors; any warnings are fixed or justified in a comment.
- [ ] **Step 3:** Commit (`kit-51 T1: boot the built image; its hub, a dashboard beside it, the versions`). Push, open the PR as a draft, and watch the box-image run. **Pass:** steps 1–4 green. If a check is red because the image is wrong (not the check), stop and send a `design-change` to the supervisor.
- [ ] **Step 4:** Task review `reviews/task-1.md` (fresh subagent), with the run's URL and result in the request.

### Task 2: the hub comes back; failure dump; cleanup (DW4)

**Files:** Modify `.github/workflows/box-image.yml` (steps after T1's).

**Interfaces:** Consumes T1's `box.sh` helpers and `HUBPID`, `REL`.

- [ ] **Step 1:** Write the steps:
  5. `the hub comes back (DW4)`. In one `dx bash -c "$IN_BOX"'; …'`, with HUBPID and REL passed in by `-e`: `kill "$HUBPID"`, then poll every 0.2 s for 25 rounds (5 s). Each round: `list_in` succeeds and `holder_in` prints a pid other than HUBPID. Exit 1 if no round passes. Then `dx tmux kill-window -t '=home:hub'`, assert `! has_hub_window` once, `until_ok 90 'the minute loop brings back home:hub' has_hub_window`, then `until_ok 15 'the hub answers again' list_ok`, and assert `holder` succeeds.
  6. `on failure, what the box said`, with `if: failure()` and no box.sh: `docker logs box`, then `docker exec box cat` on `/data/home/box.log`, `/data/home/.devteam/hub-4320.log` and `/data/home/code/e2e/docs/devteam/run/dashboard.log`, then `docker exec -u dev -e HOME=/data/home box tmux list-windows -a`. Each is followed by `|| true`.
  7. `clean up`, with `if: always()`: `docker rm -f box || true; docker volume rm box-data || true`.
- [ ] **Step 2:** Local checks as in T1, step 2.
- [ ] **Step 3:** Commit (`kit-51 T2: the hub comes back after a kill and a closed window`). Push and watch the run. **Pass:** the whole box-image job is green.
- [ ] **Step 4:** Task review `reviews/task-2.md`.

## Verification

`verification.md`: one row per done-when, naming the box-image run (URL, head SHA, conclusion) and the step that proves it. The local shellcheck and YAML results go in as well.
