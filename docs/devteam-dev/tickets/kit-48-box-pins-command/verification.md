# kit-48-box-pins-command: verification

At commit `3bd1bc38d0c2a92c75ef7c606357a6b5ac798d2f` (ticket/kit-48-box-pins-command), on the cloud box (Node 18.20.4), and in CI on PR #241.

Local gate (every row's tests): `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- <script>`, the script running `env -u DEVTEAM_RUN -u DEVTEAM_HOME -u DEVTEAM_ROLE -u DEVTEAM_TICKET -u DEVTEAM_FEATURE TMUX_TMPDIR=$(mktemp -d) node --test test/machine.test.mjs` (m-20261115-004401439-supervisor). Result: **48 tests, 48 pass, 0 fail** (184 s), the existing 23 unchanged among them.

| # | Done-when | Command / test | Result |
|---|---|---|---|
| 1 | `test/machine.test.mjs` passes in CI with no network: an in-process server stands in for npm, PyPI and GitHub through `DEVTEAM_PINS_*`, against a temporary Dockerfile copy named with `--dockerfile`; with no `cloud/Dockerfile`, `verify` says so and exits 2 | local gate above; tests 24–43 use `upstream(t)` (one `http` server on 127.0.0.1:0) and `pinsCopy()`; test 24 `box-pins verify: ok on the kit's own Dockerfile; exit 2 with none`. CI: `gh pr checks 241` at this head (test.yml, all eight `kit` jobs and `build`) | pass (local and CI) |
| 2 | `verify` exits 0 on the kit's `cloud/Dockerfile`, and 1 naming the problem for a bad sum, a missing arch sum, a version literal outside its ARG, a bad `DEVTEAM_RELEASE`, `--release v1.2.3` mismatched | tests 24, 25, 26, 27, 28; and live: `node docs/devteam/scripts/devteam.mjs box-pins verify` → `box-pins verify: ok, 6 tools, release v0.52.0` (exit 0), `verify --release v0.52.0` exit 0 | pass |
| 3 | `check` prints one line per tool (current, stale, held, unknown), exits 1 with one stale and 0 when all current or held, ignores GitHub prereleases, an unreachable upstream is unknown, `--json` the same | tests 29–34 (prerelease and draft entries with plain tags; a closed port; a stalled answer; `--json` for both shapes). Live: `box-pins check` → `claude-code: stale 2.1.307 -> 2.1.325`, `claude-swap: stale 1.0.0 -> 1.1.0`, `gh: current 2.104.0`, `ttyd: current 1.7.7`, `mise: stale v2026.10.17 -> v2026.11.8` (the drift kit-47 observed), `uv: stale 0.13.7 -> 0.13.8`, exit 1 | pass |
| 4 | `bump --release v9.9.9` sets every unheld tool to the fixture's latest with each arch's sum the asset's real hash, sets the stamp, leaves a `# hold:` tool unchanged; `--dry-run` leaves the file byte-identical; an upstream failure writes nothing | tests 35–43. Live: `box-pins bump --release v0.52.1 --dry-run` downloaded and hashed mise's and uv's real assets (GitHub digests cross-checked), printed 9 changed ARGs and `--dry-run: nothing written`, exit 0; `git diff --quiet cloud/Dockerfile` held | pass |
| 5 | `installed` calls each tool by its image path, never through PATH; claude-swap from `UV_TOOL_DIR=/opt/uv/tools uv tool list`; fake binaries with the real `--version` texts, a mise-shim `uv` first on PATH, a fake `uv` listing claude-swap only with the image's tool dir; exit 0 on a match, 1 naming the differing tool; from a folder that is no repo | tests 44–47 (kit copied to a non-repo folder, cwd no repo; also from a `git init` folder with no settings.md, and `DEVTEAM_BOX_BIN=.`). Live on this box (its image is kit-47's): `box-pins installed` from `/tmp` → six matching lines, exit 0 | pass |
| 6 | the `KIT_VIEWS` comment amended; help says only the top package of npm and PyPI tools is pinned; no file added | test 48 `help names box-pins …`; `git diff --stat --diff-filter=A origin/main...HEAD` lists only files under `docs/devteam-dev/tickets/kit-48-box-pins-command/`; `git diff --stat origin/main...HEAD -- . ':!docs/devteam-dev'` → only `docs/devteam/scripts/devteam.mjs` and `test/machine.test.mjs` | pass |
| 7 | every test added clears `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE`, `DEVTEAM_BOX_TOOLS` from the env it passes, setting them only where it means to, so it passes on the box as in CI | every new test spawns the kit through `pinsEnv(…)` (deletes those three, `DEVTEAM_PINS_*`, `DEVTEAM_BOX_BIN`, `GH_TOKEN`, `GITHUB_TOKEN`, `UV_TOOL_DIR`); only the `installed` tests set `DEVTEAM_BOX_TOOLS`. The local gate ran on the box, whose ENV sets all three | pass |

## CI

PR #241, head `3bd1bc38d0c2a92c75ef7c606357a6b5ac798d2f`: every job green. test.yml run 43666447843: `kit (18|20|22|24, chain|rest)`, all eight pass; box-image run 43666447829: `build` pass.

## Not run here

- Nothing is deferred to beta. `box-image.yml` running `box-pins installed` in the built image is kit-49's; kit-51 boots the image end to end.
