# kit-51: the built box image, end to end in CI

Ticket: `kit-51-box-image-end-to-end` (feature `box-latest-hub`, serves BOXHUB-S1 and S2, risk high: CI config). Touches `.github/workflows/box-image.yml` only. No file is added.

## Why

kit-49 made the box's boot start the machine's hub from the image's own kit (tmux window `home:hub`, brought back by the minute loop); kit-46 made a dashboard step back from the port the image names (`DEVTEAM_IMAGE_HUB`); kit-50 put the image's release and tool pins in front of the owner (the gateway's start line, `/box.json`, `box-status`). Each has unit tests against pieces. Nothing yet boots the built image and checks the whole chain. Until this lands, the first real check is a release deploying to the owner's live box.

## What changes

`box-image.yml`'s `build` job keeps its build and its no-boot smoke check, and gains steps after them, in the same job, that boot the image and check it from inside. Every shell step runs under `bash -euo pipefail`. The helpers the steps share (run as dev, read the list, find the port's holder, wait for a condition) are written once by the first new step to `$RUNNER_TEMP/box.sh` and sourced by the rest. The steps:

1. **Boot.** `docker run -d --name box` with the image's real entrypoint (none overridden), `-e DEVTEAM_PUBLIC_URL=https://box.test` (a name, https: the gateway refuses an IP or plain http), `-v <a fresh named volume>:/data`, and `-p 127.0.0.1:8080:8080`. Wait up to 120 s for `curl -fsS http://127.0.0.1:8080/healthz` from the runner, failing early if the container exits. Read `REL=$DEVTEAM_KIT_RELEASE` and `TOOLS=$DEVTEAM_BOX_TOOLS` from the container (`docker exec box printenv`), and require REL to be `vX.Y.Z` and TOOLS to be non-empty, so no check below passes against an empty value.
2. **The image's hub (DW1).** Waiting up to 60 s (dev's side starts after the gateway answers), as dev (`docker exec -u dev -e HOME=/data/home box …`):
   - `curl -fsS http://127.0.0.1:4320/instances.json` parsed with the image's node: `hub === 1`, `kit === REL`, `image === true`;
   - `tmux list-windows -t =home -F '#{window_name}'` has a line `hub`;
   - `lsof -nP -iTCP:4320 -sTCP:LISTEN -t` gives one pid, and that pid's `/proc/<pid>/cmdline` has argv[1] `/opt/devteam/kit/scripts/devteam.mjs` and argv[2] `hub` (the `-t` only trims lsof's output to the pid).
3. **A current dashboard leaves the port alone (DW2).** As dev, a throwaway repo `~/code/e2e`: `git init -b main`, `cp -R /opt/devteam/kit docs/devteam` (the image's own kit), `node docs/devteam/scripts/devteam.mjs init --name e2e`, a first commit (identity given with `-c`). Its dashboard starts the way the boot starts one: `tmux new-window -d -t '=home:' -n e2e-dash -c ~/code/e2e "while :; do /usr/local/bin/node docs/devteam/scripts/devteam.mjs dashboard; sleep 5; done"`, so it has the tmux server's environment, which carries the image's ENV. Waiting up to 60 s for `docs/devteam/run/dashboard.log` to say `started on`, then:
   - the log has the line `hub: left to the image (DEVTEAM_IMAGE_HUB=4320)` (fixed string match);
   - 4320's holder passes step 2's lsof/cmdline check, with the same pid as before the dashboard started;
   - within 15 s, `/instances.json`'s `instances` has an entry whose `root` is `/data/home/code/e2e`.
4. **The versions show (DW3).**
   - `docker logs box` has the line `image: $REL` (whole line, `grep -qxF`);
   - `box-status`, as dev, prints the line `machine: hub 4320 up, kit $REL (image)` (whole line), and the line `machine: box $REL: <n1> <v1>, <n2> <v2>, …` built from TOOLS in its order (whole line, so every tool is in it).
5. **The hub comes back (DW4).**
   - Kill the hub's pid (as dev, `kill`). Within 5 s (polled every 0.2 s): `/instances.json` answers hub 1 with kit REL and image true, and 4320's holder passes the lsof/cmdline check with a pid that is not the killed one.
   - `tmux kill-window -t '=home:hub'`; check the window is gone; within 90 s (the minute loop sleeps 60 s) the window `hub` is back, and then within 15 s `/instances.json` answers as above and the holder check passes.
6. **On failure** (`if: failure()`): print `docker logs box`, and as root inside the container `~/box.log`, `~/.devteam/hub-4320.log`, the e2e dashboard log, and `tmux list-windows -a`, so a red run says where it stopped. **Always**: `docker rm -f box` and remove the volume.

The `on.pull_request.paths` filter already lists `.github/workflows/box-image.yml`, so this PR runs it.

## Acceptance checks (the done-whens)

- **DW1** box-image.yml runs the built image with its real entrypoint (devteam-box, DEVTEAM_PUBLIC_URL set to a test name, a throwaway /data volume), waits for /healthz, and then inside the container (docker exec as dev): /instances.json on 127.0.0.1:4320 answers hub 1 with kit equal to $DEVTEAM_KIT_RELEASE and image true, tmux window home:hub exists, and `lsof -nP -iTCP:4320 -sTCP:LISTEN` names a pid whose /proc/<pid>/cmdline runs /opt/devteam/kit/scripts/devteam.mjs hub. Check: steps 1 and 2 pass in the box-image run on this PR.
- **DW2** the same job adopts a throwaway repo in ~/code whose kit is the image's own docs/devteam, starts its dashboard, and asserts its run/dashboard.log has `hub: left to the image (DEVTEAM_IMAGE_HUB=4320)`, that 4320's holder is still the image's hub, and that /instances.json lists that instance. Check: step 3 passes.
- **DW3** `docker logs` has `image: <release>` equal to $DEVTEAM_KIT_RELEASE, and `box-status` as dev prints `machine: hub 4320 up, kit <release> (image)` and `machine: box <release>: …` with every tool in $DEVTEAM_BOX_TOOLS. Check: step 4 passes.
- **DW4** kill the hub process: within 5 s /instances.json answers again and 4320's holder is again the image's hub; kill window home:hub: back within 90 s; the box-image workflow is green on this PR. Check: step 5 passes and the run is green at the PR's head.

## Contracts consumed

- The hub list `hub: 1` with top-level `kit` (and `image: true` from the box's boot), comment above `startHub` in `docs/devteam/scripts/devteam.mjs`.
- The image ENV `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE`, `DEVTEAM_BOX_TOOLS` and the pin ARGs (`cloud/Dockerfile`).
- The gateway's start line `image: <release>` (`cloud/gateway.mjs`); `/box.json`'s `image` field is passkey-gated and stays with kit-50's unit test (ticket notes).
- `box-status`'s lines `machine: hub <port> up, kit <rel> (image)` and `machine: box <rel>: <name> <version>, …` (`hubLine`, `boxStatusLine`).

Nothing is provided.

## Edge cases

- **dev's side starts after /healthz.** The gateway answers first; the hub comes up later (after the operator block, boot.sh's `box-pg 17`, and `mise install` in the background). Hence the 60 s wait for the list rather than one read.
- **The operator window runs `claude` with no login.** It sits at a login prompt; nothing here reads it.
- **`mise install` reaches the network in the background.** It is not waited on, and nothing here needs its tools (the steps use `/usr/local/bin/node`).
- **The list caches its scan 2 s,** so the instance check waits up to 15 s rather than reading once.
- **Killing the hub's window** sends the pane a hangup; if the old node lingered on the port, the new hub's retry would fail the "holder" part. The check asserts the holder after the window is back, so a lingering process that isn't the image's hub fails it; a lingering image hub still answers correctly, which is all DW4 asks of the window.
- **No assertion passes on an empty value:** REL and TOOLS are required non-empty first, and every match is whole-line, fixed-string.

## Out of scope

- Any change to the image, the gateway or the kit; a fix found needed is a `design-change` message to the supervisor, not an edit here.
- `/box.json`'s passkey-gated `image` field (kit-50's unit test).
- Booting the image anywhere but GitHub CI (no docker on the box).

## Rulings

- m-20261115-051035503-supervisor: run only touched test files at --test-concurrency=2; the image build and boot run in GitHub CI, not on the box (no docker there). This ticket touches no test file; local checks are YAML parse and shellcheck of the step scripts.
