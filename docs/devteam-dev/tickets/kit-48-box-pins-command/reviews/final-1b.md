# Final review, pass 1, track b

- Reviewer: final-b (fresh subagent of the supervisor, claude-sonnet)
- Reviewed: ee9607c4031bd702f8c5ba4641731fa5b81787d1

| Id | Severity | Rule cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec "unknown <why>" (check) | docs/devteam/scripts/devteam.mjs `unreachable()` | A refused connection (base `http://127.0.0.1:1`) reads `unknown unreachable (TypeError)` on Node 22: the error code is not found on `e.cause`, so the why names the error class, not ECONNREFUSED. Still unknown, exit 3, correct; just a less useful word. | deferred (Minor): the line still says unreachable and the exit is right; naming the code on Node 22 is a follow-up |

## What I checked (in the detached tree at the exact sha, Node v22.23.4)

- Diff touches only `docs/devteam/scripts/devteam.mjs` and `test/machine.test.mjs`; the only added files are under `docs/devteam-dev/tickets/kit-48-box-pins-command/`. `test/machine.test.mjs` has 0 removed lines, so the existing 23 tests are unchanged.
- verify on the kit's real `cloud/Dockerfile`: `ok, 6 tools, release v0.52.0`, exit 0 (also `--release v0.52.0`). `--release v1.2.3`: `DEVTEAM_RELEASE is v0.52.0, not v1.2.3`, exit 1. `--release 1.2`: usage, exit 1. No mode or unknown mode: usage, exit 1. `--dockerfile /nonexist`: the spec's message, exit 2. Broken copies: sum `ABC` (not 64 lowercase hex), a missing GH aarch64 sum, `DEVTEAM_RELEASE=0.52`: each exit 1 naming the problem. `# Hold: x` above GH_VERSION: verify exit 1, check exit 2, bump exit 1 with the file md5 unchanged. A valid `# hold: reason`: verify ok, check prints `gh: held <reason>`.
- check: with every base refused, six `unknown` lines, exit 3; `--json` has `box_pins: 1`. Live against the real upstreams: claude-code, claude-swap, mise and uv stale, gh and ttyd current (exit 1 per verification.md; `--json` shape seen).
- bump: live `--release v0.52.1 --dry-run` downloaded and hashed mise and uv, printed 9 ARG changes and `--dry-run: nothing written`, exit 0, `cmp` shows the file byte-identical. `--release v0.51.0` refused as older, nothing written. By reading: atomic temp-and-rename with mode, verify-before-write, no auth on downloads, all-or-nothing.
- installed: fake binaries at `DEVTEAM_BOX_BIN` run from `/`, with `DEVTEAM_RUN=/nowhere` (exemption works): six matching lines, exit 0; uv pinned 0.13.8: `uv: installed 0.13.7, pinned 0.13.8`, exit 1; no `DEVTEAM_BOX_TOOLS`: spec message, exit 2. The fake uv lists claude-swap only when `UV_TOOL_DIR=/opt/uv/tools`, so the code passes it and runs absolute paths.
- Help block has one line per mode plus the "only the top package of the npm and PyPI tools is pinned" sentence; the KIT_VIEWS comments are amended (`box-pins bump` writes the Dockerfile) and `box-pins` is in `KIT_VIEWS`; `installed` is in `machineWide`.
- Node 18-24: only `fetch`, `AbortSignal.timeout` (17.3+), `spawnSync`, regex lookbehind; nothing newer. (I ran on 22; the author's gate ran on 18.20.4 and CI covers 18/20/22/24.)
- Nothing project-specific in the kit code.
- PR #241 head is ee9607c; its body has a "What this doesn't defend against" section whose first line says a compromised upstream release would be pinned and the reviewed release-prep PR is the check.
- Tests, run as instructed: 48 tests, 47 pass. Test 23 (existing, `status names the hub's kit...`) failed once with "status waited 12872 ms on a server that drips" while I was running other node commands concurrently; it passed alone on rerun (1/1). It is a timing test on code this diff does not change; treated as load flake, not a finding. All 25 box-pins tests (24-48) passed.

No Critical or Important finding.

Verdict: APPROVE ee9607c4031bd702f8c5ba4641731fa5b81787d1
