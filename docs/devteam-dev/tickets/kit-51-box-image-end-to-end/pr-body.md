The box-image workflow now boots the image it builds and checks the whole BOXHUB chain from inside it: the image's own hub, a current dashboard leaving the hub's port alone, the versions, and the hub coming back. Feature `box-latest-hub` (BOXHUB-S1, S2); ticket kit-51-box-image-end-to-end (risk high: CI config). It lands after kit-49 and kit-50.

## What it does

`.github/workflows/box-image.yml` is the only file changed. Its `build` job keeps the build and the no-boot smoke step. After them, in the same job, every step runs under `bash -eo pipefail`, which is now the job's default shell:

- **boot the built image.** `docker run` with the real entrypoint (`devteam-box`), `DEVTEAM_PUBLIC_URL=https://box.test`, and a throwaway `box-data` volume on `/data`. It waits up to 120 s for `/healthz` and fails at once if the container stops. It reads `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` from the container and requires a `vX.Y.Z` release and a non-empty tool list. Then it writes the shared checks to `$RUNNER_TEMP/box.sh`.
- **the image's hub.** Run as dev through `docker exec`, it checks three things:
  - `/instances.json` on 127.0.0.1:4320 answers `hub: 1`, the image's release as `kit`, and `image: true`;
  - tmux window `home:hub` exists;
  - `lsof -nP -iTCP:4320 -sTCP:LISTEN` names a single pid, and that pid's argv is `… /opt/devteam/kit/scripts/devteam.mjs hub …`.
- **a dashboard beside it.** It makes a throwaway repo, `/data/home/code/e2e`, holding a copy of the image's own kit, and runs `init` and a first commit. It starts the repo's dashboard in a tmux window, the same way the boot does. Then it checks three things:
  - `run/dashboard.log` has kit-46's line `hub: left to the image (DEVTEAM_IMAGE_HUB=4320)`;
  - 4320 is still held by the same hub pid;
  - the list names the repo.
- **the versions show.** `docker logs` has the gateway's `image: <release>` line. `box-status` prints both `machine: hub 4320 up, kit <release> (image)` and `machine: box <release>: <tool> <version>, …`, with every tool in `DEVTEAM_BOX_TOOLS`, in order. Both matches are whole-line.
- **the hub comes back.**
  - The hub's pid is killed, and within 5 s (timed inside the container) the list answers again and a new pid holds 4320 as the image's hub.
  - Then window `home:hub` is closed. It is gone at once, back within 90 s (the minute loop), and the hub answers again.
- **what the box said** (on failure): the container's log, `box.log`, the hub's log, the dashboard's log and dev's tmux windows. **clean up** (always): the container and the volume.

Every check captures a command's whole output before matching it, so under pipefail a `grep -q` that stops early can't fail the command writing to it. The checks that run inside the box are written once (`IN_BOX` in `box.sh`); the runner's helpers and the kill loop both use that text. `/box.json`'s passkey-gated `image` field stays with kit-50's unit test; its source is checked here without a passkey, through the gateway's start line and `box-status`.

No file is added outside this ticket's records (`docs/devteam-dev/tickets/kit-51-box-image-end-to-end/`).

## How to verify

- The `box-image` check on this PR: each of the new steps is green. The log shows the release, the hub's pid, the two `box-status` lines, and "the hub is back as pid …".
- The `test` check on this PR (nothing in the kit changed).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
