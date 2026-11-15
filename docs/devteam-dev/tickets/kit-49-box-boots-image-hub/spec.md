# kit-49: the box boots the image's hub before any dashboard, keeps it up, and deploys every release whose stamp matches

Feature `box-latest-hub` (BOXHUB-S1, S2, S3); design `project/designs/the-cloud-box-always-runs-the-latest-hub.md` (home), sections "The boot, in order (kit-49)" and "Failure modes". Risk high (boot and release/deploy config). Depends on kit-46 (`devteam.mjs hub`), kit-47 (pin ARGs, `ENV DEVTEAM_KIT_RELEASE`/`DEVTEAM_BOX_TOOLS`), kit-48 (`box-pins`): all merged on the kit's main (dffa8c5).

## What and why

The owner: "When we boot the cloud image, we should always boot the LATEST devteam hub in the image (not a hub served by a subproject)." kit-46 made a hub that runs alone, and dashboards step back when `DEVTEAM_IMAGE_HUB` names their hub port. This ticket switches it on: the image sets the variable, the boot starts the image's hub first and keeps it up, and every release deploys the box (refusing one whose Dockerfile stamp isn't its tag), so the image's hub is the latest release's.

## Acceptance checks (the done-whens)

1. **Boot.** `cloud/Dockerfile` has `ENV DEVTEAM_IMAGE_HUB=4320`. `devteam-dev` creates tmux window `home:hub` before the dashboard loop, running, with cwd `$HOME`:
   `while :; do /usr/bin/env -u NODE_OPTIONS -u NODE_PATH -u NODE_REPL_EXTERNAL_MODULE PATH=/usr/local/bin:/usr/bin:/bin /usr/local/bin/node /opt/devteam/kit/scripts/devteam.mjs hub --release '<DEVTEAM_KIT_RELEASE>'; sleep 1; done`.
   Before the dashboard loop, it waits at most `${DEVTEAM_HUB_WAIT_SECONDS:-15}` s for `http://127.0.0.1:$DEVTEAM_IMAGE_HUB/instances.json` to answer `hub: 1`; if none comes, it notes it in `~/box.log` and goes on. The 60 s loop recreates `home:hub` when `tmux list-windows -t home` lacks it, and starts session `home` with the hub as its window when the session is gone.
2. **Test.** `test/machine.test.mjs` pulls the hub lines out of `cloud/Dockerfile` and runs them under `sh` with a fake `tmux`, `curl` (and `timeout`) first on PATH, asserting: the window command carries the `env -u` wrapper and root PATH; `--release` carries `DEVTEAM_KIT_RELEASE`'s value; cwd is `$HOME`, the window is `home:hub`; with `DEVTEAM_HUB_WAIT_SECONDS=1` and a curl that never answers, the wait gives up within a few seconds with a note in `box.log`; with a curl answering `{"hub":1,…}` it returns at once with no note; a missing `home` session is created with `new-session -d -s home -n hub`; the minute loop's line recreates the window only when `list-windows` lacks `hub`. Plus: the window line sits before the dashboard loop and the wait between them, and the ENV line exists. Passes in CI.
3. **Smoke.** `box-image.yml`'s smoke step runs `node /opt/devteam/kit/scripts/devteam.mjs box-pins installed` in the built image (fails the step on a mismatch: it exits 1) and checks `echo $DEVTEAM_IMAGE_HUB` prints `4320`. The workflow is green on this PR.
4. **Deploy gate.** `box-deploy.yml`'s `inputs` are `(cloud docs/devteam)`, every path the Dockerfile copies. Before it reads `HOOK`, the step runs `node docs/devteam/scripts/devteam.mjs box-pins verify --release "$TAG"` (`TAG` = `github.event.release.tag_name`) and on failure prints a refusal naming `box-pins bump --release <tag>` and exits 1. Every existing rule stays: this repository, not a prerelease, the commit on main, the `box` environment, the nothing-changed skip. Shown in verification.md by running the step's shell locally, HOOK unset: matching tag prints "no RENDER_DEPLOY_HOOK", exit 0; mismatched tag prints the refusal, exit 1. (My addition: a test in `test/machine.test.mjs` does the same from the workflow file, so CI keeps it true.)
5. **Docs.** README's "The deploy gate" names the new inputs, the stamp refusal, and that every release now restarts the box (and the sentence saying a kit-only release doesn't restart it goes). `operator.md` (On a box / Checking in) says: when `box-status` prints `machine: hub 4320 DOWN` or `kit ?`, read `~/.devteam/hub-4320.log` and tell the owner; the box recreates the window itself; as a stopgap, one project's dashboard started with `DEVTEAM_IMAGE_HUB` unset serves the hub from that project's kit.
6. **BOXHUB-S3 end to end** at this PR's head: `box-pins verify` exits 0, `box-pins bump --release v9.9.9 --dry-run` exits 0 printing the planned change, `git status --porcelain` empty afterwards, quoted in verification.md. No file is added (beyond this ticket's records).

## How (my calls, within the design)

- **Order in `devteam-dev`.** The window starts right after the `home` session is made (the operator block), so the hub warms up while `boot.sh` runs (up to 120 s of Postgres); the wait goes right before the dashboard loop. Both are "before the dashboard loop", and the wait usually costs nothing.
- **The release is expanded when the window is made**, not left as `"$DEVTEAM_KIT_RELEASE"` for the pane's shell: a pane's environment is the tmux server's global environment, which any agent on the box can change (`tmux set-environment -g`); devteam-dev's own environment is the image's. The value is reduced to `[v0-9.]` before it goes into the command, so nothing in it can break the quoting; `hub` refuses anything not `vX.Y.Z` (kit-46).
- **Helpers on one line each** (`hub_window() { … }`, `hub_wait() { … }`), as the existing tests pull single lines: the test pulls them by prefix and runs them. `hub_window` makes the window in `=home` if the session exists, else `new-session -d -s home -n hub`. Each tmux call has `timeout 20`, as the minute loop's do.
- **The wait** is deadline-based (`date +%s`), curl `--max-time 1`, and checks the body for `"hub":1` followed by `,` or `}` (what `JSON.stringify` writes); no jq, so the test needs nothing extra.
- **The minute loop's line** goes first in the loop body, before the `list-panes … || continue` (so it runs even when no other session exists): `timeout 20 tmux list-windows -t =home -F '#{window_name}' 2>/dev/null | grep -qx hub || hub_window`.
- **Window name stays `hub`**: `-n` turns tmux's automatic-rename off for that window.
- **box-deploy** gets `actions/setup-node` (node 22, the image's) before the step, since the step now runs the kit; the refusal line: `refusing <tag>: cloud/Dockerfile isn't stamped and pinned for it; run box-pins bump --release <tag> in a release-prep PR, merge it, and publish the release again`, after verify's own lines.
- The Dockerfile comment above `COPY docs/devteam /opt/devteam/kit` ("as of the last release that changed this image") changes to say every release deploys it.

## Contracts consumed

- `hub: 1` list with top-level `kit` (comment above `startHub`, devteam.mjs): the wait reads `hub: 1` only.
- The image ENV names and pin ARGs (cloud/Dockerfile): `DEVTEAM_KIT_RELEASE` on the command line, `DEVTEAM_IMAGE_HUB` for the port.
- `box-pins verify [--release]` (exit 0/1, prints `DEVTEAM_RELEASE is X, not Y`), `installed` (exit 1 on a mismatch), `bump --release --dry-run`.

None provided.

## Edge cases

- Hub never answers (port held by something else, crash loop): the wait ends with a note; dashboards still step back (the ENV), and box-status shows DOWN / not a hub; operator.md says what to do.
- `home` session killed: the minute loop makes it again with the hub; ttyd's `new-session -A -s home` attaches to it.
- `home:hub` closed or its loop killed: recreated within a minute.
- tmux not answering: each call times out at 20 s; nothing is created.
- `DEVTEAM_KIT_RELEASE` empty or odd: the hub serves with no release and says so (kit-46); the boot doesn't fail.
- A release cut without its prep PR: box-deploy refuses before reading the hook; the box stays on the last release.

## Out of scope

- Booting the built image end to end in CI (kit-51); the versions line on the hub page and box-status (kit-50); the playbook's release steps (supervisor chore after merge).
- `box-image.yml`'s `paths` (unchanged).
- The Dockerfile's header comment saying the `box` environment needs approval (contradicts the README; not this ticket's).

## Testing load

Per the supervisor's box load rule (m-20261115-030118730-supervisor): only `test/machine.test.mjs`, alone, `--test-concurrency=2`; CI runs the full suite and is the gate.

## Rulings

- m-20261115-030118730-supervisor: never run the full suite locally; only touched test files, one at a time, `--test-concurrency=2`; tell reviewers the same.
