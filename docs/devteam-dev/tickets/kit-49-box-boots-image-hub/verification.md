# kit-49 verification

At `5b4ff5bfba67189de6b277ae16b74131a45c8e4d` (ticket/kit-49-box-boots-image-hub; the code is as of `fb7ad8d`, and later commits add only this ticket's records). Locally: node v18.20.4, tmux 3.3a, this box (no Docker). Per the box load rule (m-20261115-030118730-supervisor), only `test/machine.test.mjs` was run here; GitHub CI runs the whole suite and is the gate.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | `ENV DEVTEAM_IMAGE_HUB=4320`; `home:hub` before the dashboard loop, the restart loop, the `env -u` wrapper and root PATH, cwd `$HOME`; the wait of at most `${DEVTEAM_HUB_WAIT_SECONDS:-15}` s with a note in `~/box.log`; the minute loop recreating the window, and session `home` when it is gone | `node --test --test-concurrency=2 --test-name-pattern="hub\|boot\|minute loop" test/machine.test.mjs` (with `DEVTEAM_*` unset) | pass 9, fail 0 (the five kit-49 boot tests, plus the existing hub/boot ones). The window is made right after the `home` session, and the wait runs right before the dashboard loop (test "the boot's hub lines sit where the boot needs them"). See note A on the wrapper. |
| 2 | `test/machine.test.mjs` pulls the lines from `cloud/Dockerfile` and runs them with a fake tmux and curl: wrapper and root PATH, the give-up after `DEVTEAM_HUB_WAIT_SECONDS=1` with a note, `--release` from `DEVTEAM_KIT_RELEASE`, a missing `home` session recreated, the minute loop's line only when `list-windows` lacks `hub`; passes in CI | as row 1, and CI `test` on PR #245 | Local: pass. The real-tmux case was mutation-checked: with `'=home'` (no colon), "hub_window makes home:hub on a real tmux…" fails with `create window failed: index 0 in use`; restored. Task reviewers also mutation-checked the wait's `sleep 1`, `grep -qx`, the wait guard (including leading zeros) and the release guard; each made a test fail. CI: see row 7. |
| 3 | box-image's smoke runs `box-pins installed` in the built image and fails on a mismatch, and checks `DEVTEAM_IMAGE_HUB` is 4320; green on this PR | GitHub `box-image` on PR #245 | success at `7140dae` (run 43674419658) and at `fb7ad8d` (run 43674679293), the head's code. `box-pins installed` exits 1 on a mismatch, and the step is `sh -ec`, so a mismatch fails it. |
| 4 | box-deploy's inputs are every path the Dockerfile copies; `box-pins verify --release <tag>` runs before HOOK is read, and a mismatch refuses naming `box-pins bump --release <tag>`; every existing rule stays | the step's shell taken from `.github/workflows/box-deploy.yml` and run as Actions runs it: `bash --noprofile --norc -eo pipefail`, `HOOK` unset, cwd this checkout (script below) | `TAG=v0.52.0`: `box-pins verify: ok, 6 tools, release v0.52.0` / `no RENDER_DEPLOY_HOOK secret: no box to deploy`, **exit 0**. `TAG=v0.0.1`: `box-pins verify: DEVTEAM_RELEASE is v0.52.0, not v0.0.1` / `refusing v0.0.1: cloud/Dockerfile isn't stamped and pinned for it; run box-pins bump --release v0.0.1 in a release-prep PR, merge it, and publish the release again`, **exit 1**. `inputs=(cloud docs/devteam)`. The job's `if` (this repository, not a prerelease), `environment: box`, the on-main check and the nothing-changed skip are unchanged. The test "box-deploy refuses a release whose stamp isn't its tag, before it reads the hook" asserts all of this, and that every `COPY` source is under an input. |
| 5 | README's "The deploy gate" names the new inputs, the stamp refusal, and that every release restarts the box; operator.md on `machine: hub 4320 DOWN` / `kit ?`, the log, the window, the stopgap | read | README: inputs `cloud/` and `docs/devteam/`, the refusal naming `box-pins bump --release <tag>`, "every release now restarts the box"; the operator paragraph says the image's kit is the latest release's. operator.md, under Checking in: the healthy line, and what isn't it (`DOWN`, `kit ?`, a kit without `(image)`, `not a hub`); read `~/.devteam/hub-4320.log` and tell the owner; the box recreates `home:hub` itself; the stopgap (the owner's call) with `DEVTEAM_IMAGE_HUB` unset. Task 3 reviews: CHANGES, then APPROVE twice. |
| 6 | BOXHUB-S3 end to end: `box-pins verify` exits 0, `box-pins bump --release v9.9.9 --dry-run` exits 0 printing the planned change, `git status --porcelain` empty; no file added | below | exit 0; exit 0 with the plan below; empty. `git diff --diff-filter=A origin/main...HEAD` lists only files under `docs/devteam-dev/tickets/kit-49-box-boots-image-hub/`. |
| 7 | (gate) `test/machine.test.mjs` whole, and CI | `devteam.mjs gate test -- node --test --test-concurrency=2 test/machine.test.mjs`; CI `test` | See note B. |

## Row 6, as run

```
$ node docs/devteam/scripts/devteam.mjs box-pins verify
box-pins verify: ok, 6 tools, release v0.52.0
exit 0
$ node docs/devteam/scripts/devteam.mjs box-pins bump --release v9.9.9 --dry-run
CLAUDE_CODE_VERSION 2.1.307 -> 2.1.325
CLAUDE_SWAP_VERSION 1.0.0 -> 1.1.0
MISE_VERSION v2026.10.17 -> v2026.11.8
MISE_SHA256_X86_64 fe6dd17e68e09682b31d2e7bb7bb755d22636ac1af5d94621e300f2ca9e9fe8a -> 32b6abe844efa43d37d7ac4ed21d2ec41e9479d66feb19b0db8d2c548cd6e36d
MISE_SHA256_AARCH64 e90904144ba4377c5fbe385f429830282c68f3b4f9c690bf6c5a2ae9b74a809b -> 0de1450dcc3f838e372e05e8c5231423760ad3f22d14275ef340bc0a250303ce
UV_VERSION 0.13.7 -> 0.13.8
UV_SHA256_X86_64 c5221ff41b7892bfc223543883600125f6a47fe845093e0f5bdff4f359196d83 -> 5acfd9177cfecf0bf87578f059728215ccc884388988f55f7a65041b57387d91
UV_SHA256_AARCH64 71279f8d3c67241e807b9d8db872d1bf541579fb9f08b7d1eb1682196d1e57dc -> 74f2f5c6024d397481db228db8fc25eed420db192243f88438c118e7e013e585
DEVTEAM_RELEASE v0.52.0 -> v9.9.9
--dry-run: nothing written
exit 0
$ git status --porcelain
(nothing)
```

(Run with `DEVTEAM_HOME`, `DEVTEAM_RUN`, `DEVTEAM_TICKET` and `DEVTEAM_ROLE` unset: a worker's environment names home's kit, and this checkout's kit refuses it.)

## Row 4's script

```sh
#!/bin/sh
# Runs box-deploy.yml's deploy step shell, as Actions runs it, with HOOK unset, for a tag.
cd "$1" || exit 2
awk '/^        run: \|$/{f=1;next} f&&/^          /{sub(/^          /,"");print;next} f&&/^$/{print;next} f{exit}' .github/workflows/box-deploy.yml > "$2/step.sh"
[ -s "$2/step.sh" ] || { echo "no step extracted"; exit 2; }
env -u HOOK -u DEVTEAM_HOME -u DEVTEAM_RUN -u DEVTEAM_TICKET -u DEVTEAM_ROLE TAG="$3" bash --noprofile --norc -eo pipefail "$2/step.sh"
```

## Notes

**A. The wrapper is a superset of the done-when's.** The done-when's `/usr/bin/env -u NODE_OPTIONS -u NODE_PATH -u NODE_REPL_EXTERNAL_MODULE PATH=/usr/local/bin:/usr/bin:/bin` is all there. Five more settings were added: `-u DEVTEAM_HOME -u DEVTEAM_RUN -u DEVTEAM_PROJECT -u DEVTEAM_HUB_PORT` (spec-1 F8) and `HOME='<dev's home>'` (task-1 F3). A pane takes its environment from the tmux server, which anything on the box can change, so these keep the image's hub on its own home and port. spec.md acceptance 1 and plan.md's Global Constraints show the command without `HOME`, which task-1 added (task-1-2 F2-1). The release, too, is expanded when the window is made, and only when it is plainly `vN.N.N`.

**B. Load-sensitive failures, not this change.**
- Here, on this box at load 16 to 24, whole-file runs of `test/machine.test.mjs` twice failed the untouched test "status names the hub's kit, or says it is no hub, or down". Its drip case has an 8000 ms bound and took 11763 ms. That test passes alone, and passes in every filtered run that includes the kit-49 tests. The whole file on `origin/main` passed (48/48) at lower load, and a whole-file run with kit-49's real-tmux test skipped failed the same way. That test's runtime tracked load: 38 s on main, then 46 s and 73 s on this branch. kit-49 changes no `devteam.mjs`. Recorded as observation o-20261115-032924222. A controlled pair settles it. The whole file was run back to back, first on `origin/main` and then on this branch, with only a line added in each copy that prints the drip time. `origin/main`, started at load 78, **failed** that test (drip 10893 ms, 47 pass / 1 fail). This branch, started at load 4, **passed** all 54 (drip 4952 ms).
- CI at `fb7ad8d`: `kit (22, rest)` failed in `test/dashboard.test.mjs` ("Promise resolution is still pending but the event loop has already resolved", from "every item the dashboard draws says what it is" on). That file isn't touched here, passed on node 18, 20 and 24 at the same commit, and passed on every job at `7140dae`. Recorded as o-20261115-041216407; the failed job was re-run.
- The recorded gate (`devteam.mjs gate test -- node --test --test-concurrency=2 test/machine.test.mjs`, with `DEVTEAM_*` unset) at `5b4ff5b`, the code of `fb7ad8d`, on the clean file: **gate exit 0, 54 tests, 54 pass, 0 fail** (load about 12); and again after merging `origin/main` (kit-61, which touches none of this ticket's files), at `5be56b6`: **gate exit 0, 54/54**. CI at the head this PR is merged at is the gate; the merge request names its run.

## Deferred

- The image's boot end to end, in a running container (lsof on 4320, `/instances.json` carrying the image's release, a dashboard stepping back, the hub killed and the port taken back): kit-51, which boots the built image in CI. This box has no Docker. What is verified here is each boot line run alone, plus the image build and smoke in CI.
- A real deploy: it runs only on a published release.
