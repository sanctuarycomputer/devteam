# kit-46-standalone-hub: spec

A hub that runs on its own (`devteam.mjs hub`), and dashboards that leave the hub to the image when its `ENV` says so.

Feature `box-latest-hub`, stories BOXHUB-S1 and BOXHUB-S2. Design: home's `project/designs/the-cloud-box-always-runs-the-latest-hub.md` (the `devteam.mjs (kit-46)` part, Contracts, Testing). Risk high: this moves the server that takes the owner's thread presses (P5).

## Why

The owner: "When we boot the cloud image, we should always boot the LATEST devteam hub in the image (not a hub served by a subproject)." Today every dashboard races for 127.0.0.1:4320, so on the box whichever project starts first serves the hub from its own kit (observed: v0.50.4 while v0.51.0 was out). This ticket gives the kit a hub that runs alone, from the image's kit, and makes dashboards on this release step aside when the image says it serves the hub. kit-49 wires it into the boot; kit-47 adds the `ENV` lines.

## What changes (all in `docs/devteam/scripts/devteam.mjs` unless named)

1. **`devteam.mjs hub [--release vX.Y.Z]`**, a machine-wide command (added to the `machineWide` list beside `machine` and `operator-thread`, so it runs from a folder that is no repo and no project). It runs `startHub`'s server alone:
   - logs to stderr and to `~/.devteam/hub-<HUB_PORT>.log`; before each write, a log at or over 1 MB (with the line) is renamed to `hub-<port>.log.1` and started afresh, so the file never passes 1 MB;
   - installs the uncaughtException, unhandledRejection and SIGTERM/SIGINT/SIGHUP handlers that `cmdDashboard` installs (one shared helper now, so the two can't drift): a crash logs its stack and exits 1, a signal logs `stopped by <SIG>` and exits 0;
   - keeps itself alive and retries every `DEVTEAM_HUB_RETRY_MS` (default 30000, as today) whatever holds the port; a holder that isn't a hub is logged once (`hub: port <port> is held by something that isn't a devteam hub; retrying every <n> s`), not at every retry;
   - writes nothing under its cwd or any `run/` folder; owner actions (`operator-thread …`) run with its cwd, as `box-thread`'s do.
2. **`/instances.json` gains a top-level `kit`**, computed once when the hub starts:
   - `hub --release vX.Y.Z`: `kit` is that release and the list carries `image: true`;
   - `hub` without `--release`, and a dashboard's hub: `kitVersion()` where there is a project (`settings.md` exists), else `null`; no `image` field.
   - No hub reads `DEVTEAM_KIT_RELEASE`. Only the boot (kit-49) passes `--release`.
   - The comment above `startHub` states the list's rule: additive changes keep `hub: 1`, anything else bumps it; and documents `kit` and `image`.
3. **`cmdDashboard` skips `startHub`** when `DEVTEAM_IMAGE_HUB`, read as a number, equals its `HUB_PORT`, and writes exactly one line to `run/dashboard.log`: `hub: left to the image (DEVTEAM_IMAGE_HUB=<port>)`. Unset, empty or another port: the hub is served as before, and no such line.
4. **`machine status`'s hub line** asks `/instances.json` (Host `127.0.0.1:<port>`, `sec-fetch-site: same-origin`, 3 s) and prints exactly one of:
   - `machine: hub <port> up, kit <release> (image)` (hub 1, `kit` a string, `image` true)
   - `machine: hub <port> up, kit <release>` (hub 1, `kit` a string)
   - `machine: hub <port> up, kit ?` (hub 1, no usable `kit`: an older hub, or `null`)
   - `machine: hub <port> up, not a hub` (an answer that isn't `hub: 1` JSON)
   - `machine: hub <port> DOWN` (no answer)
   followed by the unchanged `; alert: …` suffix. The release is printed only if it matches `^[\w.+-]{1,64}$` (else `?`): it comes off the network and goes to a terminal.
5. **README.md**'s "Many projects, one machine" paragraph: on a box whose image sets `DEVTEAM_IMAGE_HUB`, the image serves the hub and dashboards don't; the gap left is that an older project kit can take the port while the image's hub restarts. `hub` is listed in the help text.

## Contracts

- **Provides:** the hub list `hub: 1` with a top-level `kit` (string or `null`) and, only for `hub --release`, `image: true`. Additive. Documented in the comment above `startHub`.
- **Consumes:** the box image `ENV` names `DEVTEAM_IMAGE_HUB` (read here) and `DEVTEAM_KIT_RELEASE` (deliberately never read by a hub), per the design's Contracts section; kit-47 lands the Dockerfile comment. `DEVTEAM_BOX_TOOLS` is not read here.

## Acceptance checks (the done-whens, restated)

1. `test/hub-overview.test.mjs`, fixture ports only: `hub --release v9.9.9`, run from a temp folder that is no git repo and no project, answers `GET /instances.json` with `hub: 1`, the fixture instance(s), `kit: 'v9.9.9'`, `image: true`, and leaves no `docs/devteam/run` (no `docs` at all) under its cwd. `hub` without `--release`, with `DEVTEAM_KIT_RELEASE=v9.9.9` in its env, answers `kit: null` and no `image`. A dashboard's hub, with `DEVTEAM_KIT_RELEASE` set, answers `kit` equal to that project's `hello --json` `kit` and no `image`.
2. Same file: with `DEVTEAM_IMAGE_HUB=<fixture hub port>` a dashboard never listens on the hub port and writes exactly one `hub: left to the image (DEVTEAM_IMAGE_HUB=<port>)` line to its `run/dashboard.log`; with it unset, or `4320` while the hub port is a fixture port, the dashboard serves its hub and writes no such line.
3. Same file: port held by another hub: `hub` stays up, retries every `DEVTEAM_HUB_RETRY_MS`, and takes the port once the holder exits. Held by a non-hub: logged once to `~/.devteam/hub-<port>.log` (test `HOME`), keeps retrying, takes the port once it frees. A log pre-filled to just under 1 MB stays at or under 1 MB after the hub writes. A SIGTERM to the hub leaves `stopped by SIGTERM` in that log.
4. `test/operator-threads.test.mjs`: a standalone hub in box mode (`DEVTEAM_PUBLIC_URL`, `DEVTEAM_GATEWAY_THREAD_KEY`, this file's gateway key) refuses with 403 an `/operator/thread-new` POST without a gateway signature, one reusing a nonce, and one with a foreign Origin; a correctly signed one returns 200 and its line is typed into the fixture operator's pane (session `home`, window 0).
5. `test/machine.test.mjs`: each of the five hub lines above asserted exactly, against in-process fixture servers on the test's hub port, and the alert suffix unchanged.
6. Every existing test in `test/dashboard.test.mjs`, `test/hub-overview.test.mjs`, `test/operator-threads.test.mjs` and `test/machine.test.mjs` passes unchanged, in CI and on the box.
7. README as in 5 above; no file added (see Rulings/notes: the ticket's own records are the exception).
8. Every test added deletes `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` from the env it passes and sets them only where it means to.

## Edge cases

- `--release` given empty or not `vX.Y.Z` (e.g. the boot's `"$DEVTEAM_KIT_RELEASE"` on an image without it): the hub logs the problem once and serves with `kit: null` and no `image`. It never exits for it: exiting would put the boot's restart loop into a 1 s crash loop with no hub at all (the design's anti-goal "a box with no hub"). My call.
- `DEVTEAM_IMAGE_HUB` that isn't a number (`"yes"`, `" "`): treated as unset.
- A standalone hub whose holder answers slowly (`unsure`): retried, as today.
- The non-hub log line is written once per run of non-hub holding; if a hub then takes the port and later a non-hub again, logged once more (state flips). Simple and bounded.
- A dashboard's hub keeps today's behaviour exactly: stops trying on a non-hub holder, its retry timer unref'd.
- `machine status` against an `/instances.json` that is huge: read capped at 64 KB, then `not a hub`.

## Out of scope

- The boot, the `home:hub` window, the minute loop and `ENV DEVTEAM_IMAGE_HUB` (kit-49); the Dockerfile `ARG`s/`ENV` (kit-47); `hub.html`'s versions line, `/box.json`'s `image`, the gateway's fallback `down` (kit-50); `box-pins` (kit-48).
- operator.md (not in touches).

## Rulings and notes

- No rulings or answers in `history` or `messages` at spec time.
- "No file is added" (done-when 7): the ticket's records under `docs/devteam-dev/tickets/kit-46-standalone-hub/` are added files, as the worker prompt directs; I read the done-when as covering everything outside the ticket's records folder, and the review request says so.
