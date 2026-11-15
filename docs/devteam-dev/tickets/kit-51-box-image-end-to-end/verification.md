# kit-51 verification

At `e4307836ea5b00f1691eccafcccc3d2df76519c1` (ticket/kit-51-box-image-end-to-end, `origin/main` merged in; later commits add only this ticket's records). The box has no docker (ruling m-20261115-051035503-supervisor), so the image is built and booted only in GitHub CI. CI is the gate: box-image run 43682276306 and test run 43682276230 both passed on this commit. They were recorded with `devteam.mjs gate ci -- gh pr checks 247 --watch` (passed in 426.5 s).

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | The built image runs with its real entrypoint, `DEVTEAM_PUBLIC_URL` set to a test name, and a throwaway /data volume; /healthz is waited for. Then, run as dev inside the box: /instances.json answers `hub` 1, `kit` = $DEVTEAM_KIT_RELEASE and `image` true; window home:hub exists; lsof's 4320 pid runs `/opt/devteam/kit/scripts/devteam.mjs hub` | box-image steps "boot the built image" and "the image's hub answers, in window home:hub, from the image's kit", run 43682276306 | success. REL `v0.52.0` was read from the container and required to be vX.Y.Z; the hub was pid 157 (HUBPID: 157 in the step env). |
| 2 | A throwaway repo in ~/code on the image's kit, with its dashboard started: its dashboard.log has `hub: left to the image (DEVTEAM_IMAGE_HUB=4320)`, 4320 is still the image's hub, and the list names the repo | step "a dashboard on the image's kit leaves the hub's port alone", same run | success in 2 s: the line was present, the holder was still pid 157, and the list named `/data/home/code/e2e`. |
| 3 | `docker logs` has `image: <release>`; `box-status` as dev prints `machine: hub 4320 up, kit <release> (image)` and `machine: box <release>: …` with every tool | step "the versions show (the gateway's start line, box-status)", same run | success. Whole-line matches. Printed: `machine: hub 4320 up, kit v0.52.0 (image)` and `machine: box v0.52.0: claude-code 2.1.307, claude-swap 1.0.0, gh 2.104.0, ttyd 1.7.7, mise v2026.10.17, uv 0.13.7`. |
| 4 | After the hub is killed, /instances.json answers again within 5 s and 4320 is the image's hub again; after window home:hub is killed, it is back within 90 s; box-image is green on this PR | step "the hub comes back when it dies and when its window closes", same run | success. `the hub is back as pid 700` printed 1.7 s into the step (the 5 s is timed inside the container, and checked again after each successful poll). The window was gone right after kill-window and back within 56 s of the step's start, followed by the list and holder checks. Whole job: success. |

## Local checks (the box: no docker)

- The workflow parses with a real YAML parser: `ruby -ryaml` (3.4.12) prints ok.
- `shellcheck -s bash -S warning` passes on each `run:` body, on `box.sh` as the boot step writes it, and on the `IN_BOX` text, 11 files in all. The info-level SC2016 notes are on in-box text that is single-quoted on purpose.
- The in-box checks were run against a real `hub --release v0.52.0` on spare port 5520, with port and kit path substituted:
  - `list_in` passes, and fails on a wrong REL and on an unlisted root;
  - `holder_in` prints the hub's pid, and fails on a wrong argv[1];
  - the kill loop, against the hub in a restart loop, saw it back in about 1.5 s.
- No test file is touched, so no test was run here. The `test` workflow on this commit passed (8 jobs).
- `git diff --diff-filter=A origin/main...HEAD` lists only files under `docs/devteam-dev/tickets/kit-51-box-image-end-to-end/`.

Nothing is deferred to beta.
