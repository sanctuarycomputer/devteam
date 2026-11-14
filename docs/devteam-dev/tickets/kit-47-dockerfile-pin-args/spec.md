# kit-47-dockerfile-pin-args: spec

Every box tool pinned as Dockerfile `ARG`s (gh from its release tarball), with the release and tool versions exposed as `ENV`. Feature `box-latest-hub`, stories BOXHUB-S1, BOXHUB-S3. Design: home's `project/designs/the-cloud-box-always-runs-the-latest-hub.md`, "The Dockerfile's pins and `ENV` (kit-47)". Touches `cloud/Dockerfile` only. risk: high.

## Why

Today Claude Code and claude-swap are `ARG`s, ttyd, mise and uv are literals inside their `RUN` lines, and gh comes unpinned from cli.github.com's apt repo. kit-48's `box-pins` reads and rewrites the pins, and kit-50 shows them on the hub, so every pin needs one machine-readable place and the image needs to say what it is.

## What changes in `cloud/Dockerfile`

1. **The first apt layer** loses the gh keyring download, the `github-cli.list` line and the second `apt-get update && apt-get install gh`. The rest of the package list stays (gnupg included: the pgdg layer and owners' shells may use it).
2. **One tool layer per tool, all after the two apt layers**, in this order: ttyd, gh, mise, uv, claude-swap, Claude Code. Rarely bumped first, most often bumped (Claude Code) last, so a Claude Code bump rebuilds only its own layer and what follows. uv and claude-swap, one `RUN` today, split into two, so a claude-swap bump doesn't fetch uv again (claude-swap's layer still runs `uv` from the uv layer).
3. **Each layer's pins are `ARG`s just above its `RUN`**, one `ARG` per line, named `<TOOL>_VERSION` and, for a downloaded binary (ttyd, gh, mise, uv), `<TOOL>_SHA256_X86_64` and `<TOOL>_SHA256_AARCH64`. Tool names: `TTYD`, `GH`, `MISE`, `UV`, `CLAUDE_SWAP`, `CLAUDE_CODE`. The `RUN` picks the sum by `uname -m` from the two `ARG`s and builds the URL from `_VERSION`; no version or sum is written anywhere else in the file.
4. **gh from its tarball**: `https://github.com/cli/cli/releases/download/v$GH_VERSION/gh_${GH_VERSION}_linux_<amd64|arm64>.tar.gz`, checked with `sha256sum -c`, and only `bin/gh` extracted to `/usr/local/bin/gh` (`tar -xzf … -C /usr/local --strip-components=1 gh_…/bin/gh`). The tarball is `gh_<v>_linux_<arch>/{bin/gh,share/man/…,LICENSE}` (inspected for 2.104.0); the man pages are left out, as the slim image has no man.
5. **A comment above the first pin `ARG`** states the naming rule, that `devteam.mjs box-pins` reads and rewrites these lines, and the hold convention: a line `# hold: <reason>` directly above a tool's `_VERSION` `ARG` makes `box-pins check` report it as held and `bump` leave it. (A Dockerfile comment is only a whole line starting with `#`; a trailing `# …` on the `ARG` line would be part of the instruction, so the hold goes on the line above.) It also replaces the old "These pins are bumped by editing them here and redeploying" line.
6. **At the very end**, just before `VOLUME /data`, after every tool layer and every `COPY`, so a new stamp rebuilds nothing:
   ```
   ARG DEVTEAM_RELEASE=v0.51.0
   ENV DEVTEAM_KIT_RELEASE=$DEVTEAM_RELEASE \
       DEVTEAM_BOX_TOOLS="claude-code=$CLAUDE_CODE_VERSION claude-swap=$CLAUDE_SWAP_VERSION gh=$GH_VERSION ttyd=$TTYD_VERSION mise=$MISE_VERSION uv=$UV_VERSION"
   ```
   The image is one stage, so every `ARG` is in scope there. `DEVTEAM_IMAGE_HUB` is not set (kit-49).

## The pins (today's)

| ARG | value | source |
|---|---|---|
| `TTYD_VERSION` | `1.7.7` | as in the file |
| `TTYD_SHA256_X86_64` / `_AARCH64` | `8a217c96…4f55` / `b38acadd…4165` | as in the file |
| `GH_VERSION` | `2.104.0` | `gh release view --repo cli/cli` (latest, 2026-11-12) |
| `GH_SHA256_X86_64` / `_AARCH64` | `98cb101a…c24e` / `cb34cefc…69e3` | `gh_2.104.0_checksums.txt`, re-hashed from the downloaded tarballs |
| `MISE_VERSION` | `v2026.10.17` | as in the file (leading `v`, as mise's tags and `mise --version` have it) |
| `MISE_SHA256_X86_64` / `_AARCH64` | `fe6dd17e…fe8a` / `e9090414…809b` | as in the file |
| `UV_VERSION` | `0.13.7` | as in the file |
| `UV_SHA256_X86_64` / `_AARCH64` | `c5221ff4…6d83` / `71279f8d…7dc` | as in the file |
| `CLAUDE_SWAP_VERSION` | `1.0.0` | as in the file |
| `CLAUDE_CODE_VERSION` | `2.1.307` | as in the file |

`GH_VERSION` has no leading `v` (gh's assets and `gh --version` don't); the URL adds the tag's `v`.

## Contract provided

The box image's `ENV` `DEVTEAM_KIT_RELEASE` (`vX.Y.Z`) and `DEVTEAM_BOX_TOOLS` (`name=version` pairs, space-separated, in the order above: claude-code, claude-swap, gh, ttyd, mise, uv) and the pin `ARG` names, documented by the comment above the `ARG`s. Consumers: kit-48 (reads/rewrites the `ARG` lines, one per line, `ARG NAME=value`; the hold line directly above), kit-49, kit-50, kit-51. `DEVTEAM_IMAGE_HUB` is named here but set by kit-49.

## Acceptance checks (the done-whens)

1. Pins only through `ARG`s with the names above, each just above its layer, every tool layer after the apt layers; a grep of `cloud/Dockerfile` for each version and each sum finds it exactly once, on its `ARG` line; the comment states the naming rule and the hold convention.
2. gh installs from its release tarball checked against its sum, at `/usr/local/bin/gh`; no `cli.github.com` or `githubcli` line remains.
3. `ARG DEVTEAM_RELEASE=v0.51.0`, `ENV DEVTEAM_KIT_RELEASE` and `ENV DEVTEAM_BOX_TOOLS` after every tool layer; no `DEVTEAM_IMAGE_HUB`.
4. The `box-image` workflow is green on the PR, and verification.md quotes the done-when's `docker run … sh -c '…'` output showing the pinned versions. No docker on this machine, so the output comes from CI: a temporary probe commit on `box-image.yml`, reverted before the merge request (Rulings).
5. The values are the table above; `git diff --stat origin/main` lists `cloud/Dockerfile` and this ticket's records only.

## Edge cases

- An arch other than x86_64/aarch64: each binary layer fails the build with "no <tool> for <arch>", as today.
- `ARG`s declared before a `RUN` are in its environment, so a changed pin invalidates its layer and every later `RUN`; that's what the ordering is for. The release stamp is after everything.
- Build-time `ARG`s are not in the running container; only the two `ENV`s are.
- The ttyd probe `RUN` near the kit `COPY` still finds `ttyd` at `/usr/local/bin`.

## Out of scope

- `box-pins` (kit-48), the boot/hub/`DEVTEAM_IMAGE_HUB` (kit-49), showing versions (kit-50), CI changes (kit-49, kit-51).
- `docs/devteam/scripts/devteam.mjs:12477` mentions `2.1.307` in a comment as an example of what tmux shows; it's outside `touches` and not a pin. The "no literal anywhere else" check is over `cloud/Dockerfile`, as `box-pins verify` (design) checks it.
- Bumping any pin other than gh's (the done-when holds today's).

## Rulings

- m-20261114-213717043-supervisor (decision d-20261114-213713246-supervisor), on m-20261114-213703705-kit-47-dockerfile-pin-args: one temporary probe commit adds the done-when's `docker run … --version` line to `box-image.yml`'s smoke step; verification.md quotes its CI log with the run URL; the probe is reverted before the merge request, and the final diff is `cloud/Dockerfile` only (plus this ticket's records).
