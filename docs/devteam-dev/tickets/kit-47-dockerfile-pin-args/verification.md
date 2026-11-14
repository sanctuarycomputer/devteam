# kit-47-dockerfile-pin-args: verification

The static rows were run at `45d5e166518d0d4cc92d87f8e59b59037a6de6a0`, after `origin/main` was merged. `cloud/Dockerfile` there is byte-identical to the probe commit `5fc437051ce016983fc856cfdb84141e0563a5f2` (`git diff --stat 5fc4370 HEAD -- cloud/Dockerfile` is empty), so the probe's build stands for this head.

The probe was a temporary commit by ruling m-20261114-213717043-supervisor. It added a native arm runner to `box-image.yml`'s build matrix (ruling m-20261114-214839590-supervisor) and the done-when's `docker run` line to its smoke steps. It is reverted at `git log --grep 'Revert "kit-47: TEMPORARY probe'`, and `git diff origin/main...HEAD --name-only` outside this folder is `cloud/Dockerfile` alone.

`verify-pins.mjs` and `mutate-pins.sh` are ticket records, like this file: checks of this ticket, kept beside it. They are not product files (done-when 5's "no file is added").

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | Pins only through `<TOOL>_VERSION` / `_SHA256_X86_64` / `_SHA256_AARCH64` ARGs, each just above its layer, all after the apt layers; no version or sum as a literal anywhere else; the comment states the naming rule and `# hold: <reason>` | `node docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/verify-pins.mjs cloud/Dockerfile`; `sh docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/mutate-pins.sh`; `grep -cF <value> cloud/Dockerfile` for each of the 14 values | `14 pins, release v0.52.0, all checks pass`, exit 0. All 8 mutations are caught (exit 0). Each value counts 1, on its own `ARG` line (below) |
| 2 | gh from its release tarball, checked against its sum, at `/usr/local/bin/gh`, replacing the apt repo and keyring | `grep -cE 'cli\.github\.com\|githubcli\|DEVTEAM_IMAGE_HUB' cloud/Dockerfile`; the probe's `gh --version` and `ls -l` | `0`. Both arches show `gh version 2.104.0 (2026-11-12)`, with `/usr/local/bin/gh` owned by root at mode 755 and `/usr/bin/gh -> /usr/local/bin/gh` |
| 3 | `ARG DEVTEAM_RELEASE`, `ENV DEVTEAM_KIT_RELEASE`, `ENV DEVTEAM_BOX_TOOLS` after every tool layer; no `DEVTEAM_IMAGE_HUB` | `verify-pins.mjs` (order: every COPY and RUN before the stamp, then the ENV, then `VOLUME /data`); the probe's `echo`s | Pass. Both arches print `v0.52.0` and `claude-code=2.1.307 claude-swap=1.0.0 gh=2.104.0 ttyd=1.7.7 mise=v2026.10.17 uv=0.13.7`. The value is v0.52.0, not the done-when's v0.51.0, by ruling m-20261114-214136480-supervisor |
| 4 | The box-image workflow (build and its existing smoke step) is green; the PR quotes the `docker run` showing the pinned versions | box-image run [43645429250](https://github.com/sanctuarycomputer/devteam/actions/runs/43645429250) at `5fc4370` | `build (ubuntu-latest)` success and `build (ubuntu-24.04-arm)` success, the existing smoke step included. Output below |
| 5 | Today's versions and sums; gh at its current release with its published sums; no file added | Values against the spec table; `gh release view --repo cli/cli` (v2.104.0 latest, 2026-11-12); sums from `gh_2.104.0_checksums.txt`, re-hashed from the downloaded tarballs; `git diff origin/main...HEAD --name-only` | All match. The only file outside this ticket's records is `cloud/Dockerfile` |

`box-image` and `test.yml` at the final pushed head are checked by `devteam.mjs gate ci` and `check-ticket` before the merge request.

## Literal counts (`grep -cF` in `cloud/Dockerfile`, at 45d5e16)

```
1 2.1.307: 133:ARG CLAUDE_CODE_VERSION=2.1.307
1 1.0.0: 128:ARG CLAUDE_SWAP_VERSION=1.0.0
1 2.104.0: 90:ARG GH_VERSION=2.104.0
1 1.7.7: 77:ARG TTYD_VERSION=1.7.7
1 v2026.10.17: 104:ARG MISE_VERSION=v2026.10.17
1 0.13.7: 116:ARG UV_VERSION=0.13.7
1 8a217c96…4f55: 78:ARG TTYD_SHA256_X86_64
1 b38acadd…4165: 79:ARG TTYD_SHA256_AARCH64
1 98cb101a…c24e: 91:ARG GH_SHA256_X86_64
1 cb34cefc…69e3: 92:ARG GH_SHA256_AARCH64
1 fe6dd17e…fe8a: 105:ARG MISE_SHA256_X86_64
1 e9090414…809b: 106:ARG MISE_SHA256_AARCH64
1 c5221ff4…6d83: 117:ARG UV_SHA256_X86_64
1 71279f8d…57dc: 118:ARG UV_SHA256_AARCH64
```

## The probe's output (box-image run 43645429250)

The command, as the done-when gives it plus four lines: `uname -m` first, then `/usr/bin/gh --version; /usr/local/bin/uv --version; ls -l …` after it. It ran as `docker run --rm --entrypoint sh box -ec '…'`.

`build (ubuntu-latest)`, job 132601995113:

```
x86_64
v0.52.0
claude-code=2.1.307 claude-swap=1.0.0 gh=2.104.0 ttyd=1.7.7 mise=v2026.10.17 uv=0.13.7
2.1.307 (Claude Code)
gh version 2.104.0 (2026-11-12)
https://github.com/cli/cli/releases/tag/v2.104.0
ttyd version 1.7.7-40e79c7
2026.10.17 linux-x64 (2026-10-21)
mise WARN  mise version 2026.11.8 available
mise WARN  To update, run mise self-update
uv 0.13.7 (x86_64-unknown-linux-gnu)
claude-swap v1.0.0
- claude-swap
- cswap
gh version 2.104.0 (2026-11-12)
https://github.com/cli/cli/releases/tag/v2.104.0
uv 0.13.7 (x86_64-unknown-linux-gnu)
lrwxrwxrwx 1 root root       17 Nov 14 21:57 /usr/bin/gh -> /usr/local/bin/gh
-rwxr-xr-x 1 root root 41083040 Nov 12 18:52 /usr/local/bin/gh
```

`build (ubuntu-24.04-arm)`, job 132601994893:

```
aarch64
v0.52.0
claude-code=2.1.307 claude-swap=1.0.0 gh=2.104.0 ttyd=1.7.7 mise=v2026.10.17 uv=0.13.7
2.1.307 (Claude Code)
gh version 2.104.0 (2026-11-12)
https://github.com/cli/cli/releases/tag/v2.104.0
ttyd version 1.7.7-40e79c7
2026.10.17 linux-arm64 (2026-10-20)
mise WARN  mise version 2026.11.8 available
mise WARN  To update, run mise self-update
uv 0.13.7 (aarch64-unknown-linux-gnu)
claude-swap v1.0.0
- claude-swap
- cswap
gh version 2.104.0 (2026-11-12)
https://github.com/cli/cli/releases/tag/v2.104.0
uv 0.13.7 (aarch64-unknown-linux-gnu)
lrwxrwxrwx 1 root root       17 Nov 14 21:57 /usr/bin/gh -> /usr/local/bin/gh
-rwxr-xr-x 1 root root 38142112 Nov 12 18:53 /usr/local/bin/gh
```

Line by line against the pins, on both arches:

| Line | Expected | Got |
|---|---|---|
| `$DEVTEAM_KIT_RELEASE` | `v0.52.0` | `v0.52.0` |
| `$DEVTEAM_BOX_TOOLS` | `claude-code=2.1.307 claude-swap=1.0.0 gh=2.104.0 ttyd=1.7.7 mise=v2026.10.17 uv=0.13.7` | the same |
| `claude --version` | 2.1.307 | `2.1.307 (Claude Code)` |
| `gh --version` | 2.104.0 | `gh version 2.104.0 (2026-11-12)` |
| `ttyd --version` | 1.7.7 | `ttyd version 1.7.7-40e79c7` |
| `mise --version` | v2026.10.17 | `2026.10.17 linux-x64` / `linux-arm64` |
| `uv --version` | 0.13.7 | `uv 0.13.7` (and `/usr/local/bin/uv`, the same) |
| `uv tool list` | claude-swap 1.0.0 | `claude-swap v1.0.0` |
| `/usr/bin/gh --version` | 2.104.0, via the link | `gh version 2.104.0` |
| `ls -l` | `/usr/local/bin/gh` root-owned; `/usr/bin/gh` a link to it | as expected |

mise's own warning says 2026.11.8 is out. The done-when holds today's pin, v2026.10.17, and bringing pins current is kit-48's `box-pins check` and `bump` (BOXHUB-S3).
