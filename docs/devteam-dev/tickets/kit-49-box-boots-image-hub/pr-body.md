The box boots the image's own hub before any dashboard, keeps it up, and deploys every release whose `cloud/Dockerfile` stamp matches its tag. Feature `box-latest-hub` (BOXHUB-S1, S2, S3); ticket kit-49-box-boots-image-hub (risk high). The last ticket on BOXHUB-S3; the playbook's release steps follow as a supervisor chore.

## What it does

- **`cloud/Dockerfile`:** `ENV DEVTEAM_IMAGE_HUB=4320`, so dashboards on this release or later leave the hub's port alone (kit-46). `devteam-dev` makes tmux window `home:hub` right after the `home` session (`hub_window`), running `devteam.mjs hub --release <the image's release>` from `/opt/devteam/kit` in a restart loop, cwd `$HOME`, under `/usr/bin/env -u NODE_OPTIONS -u NODE_PATH -u NODE_REPL_EXTERNAL_MODULE -u DEVTEAM_HOME -u DEVTEAM_RUN -u DEVTEAM_PROJECT -u DEVTEAM_HUB_PORT PATH=/usr/local/bin:/usr/bin:/bin`. Before the dashboards, `hub_wait` gives it `${DEVTEAM_HUB_WAIT_SECONDS:-15}` s to answer `hub: 1` on `/instances.json`, then notes it in `~/box.log` and goes on. The minute loop recreates `home:hub` when it's gone, and the `home` session with it.
  - The release is expanded when the window is made, and only when it is plainly `vN.N.N` (else `''`): a pane's environment is the tmux server's, which anything on the box can change.
  - `new-window -t '=home:'`, with the colon: a bare `=home` is first a window named `home` in the current session.
- **`box-deploy.yml`:** before it reads the hook, `box-pins verify --release "$TAG"`; a mismatch refuses, naming `box-pins bump --release <tag>`. Inputs are `cloud` and `docs/devteam` (all the Dockerfile copies). Every existing rule stays.
- **`box-image.yml`:** the smoke step runs `box-pins installed` in the image and checks `DEVTEAM_IMAGE_HUB` is `4320`.
- **README** ("The deploy gate", the operator paragraph): new inputs, the stamp refusal, every release restarts the box. **`operator.md`:** what to do on `machine: hub 4320 DOWN` or `kit ?`.

No file is added outside this ticket's records (`docs/devteam-dev/tickets/kit-49-box-boots-image-hub/`).

## How to verify

- `node --test test/machine.test.mjs`: the boot's hub lines are pulled out of `cloud/Dockerfile` and run under `sh` with a fake `tmux`, `curl` and `timeout`; one case uses real tmux (on the test's own server) with another session holding a window named `home`; the deploy step's shell is pulled out of `box-deploy.yml` and run from this checkout against the stamped tag and `v0.0.1`.
- The box-image job on this PR builds the image and runs the smoke step.
- `verification.md` in the ticket folder: a row per done-when, with commands and output.

## What this doesn't defend against

- An agent on the box runs as `dev`, the hub's own user: it can kill the image's hub and take the port in the second before the loop restarts it. The hub page and `box-status` then show a project's kit, not the image's (kit-50).
- A `list-windows` that fails for a moment can add a second hub window; it only retries the port.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
