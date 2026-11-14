# kit-47-dockerfile-pin-args: plan

## TL;DR

- One file changes: `cloud/Dockerfile`. Everything else is this ticket's records.
- T1 rewrites the tool layers: six tools, each with its pin `ARG`s just above its own `RUN`, after the apt layers, in the order ttyd, gh, mise, uv, claude-swap, Claude Code. gh comes from its release tarball, and `/usr/bin/gh` is a symlink to it.
- T1 also puts `ARG DEVTEAM_RELEASE=v0.52.0` and the two `ENV`s just before `VOLUME /data`.
- T1's check is a static one, `verify-pins.sh`, a script in the ticket folder that greps for each literal and checks layer order. No docker runs on this machine.
- T2 adds a temporary probe step to `box-image.yml` (ruling m-20261114-213717043-supervisor). CI builds the image on both arches if the runner offers them, or on x86_64 only, and prints the done-when's versions. verification.md quotes the log with the run URL.
- T3 reverts the probe. The final diff is `cloud/Dockerfile` plus records; `box-image` and `test.yml` are green at the head.
- Spec: `spec.md` beside this file.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native; three small sequential tasks on one file).

**Goal:** the box image pins every tool through `ARG`s and says its release and tool versions in `ENV`.
**Architecture:** one-stage Dockerfile; pins as `ARG`s right above the layer that uses them; stamp last.
**Tech stack:** Dockerfile (BuildKit, syntax 1.7), POSIX sh, GitHub Actions.
**Spec:** `docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/spec.md`.

## Global constraints

- Only `cloud/Dockerfile` in the final diff (plus `docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/`).
- Pin values exactly as spec "The pins (today's)"; gh 2.104.0 with sums `98cb101ad87dbbd3f6b2f2bfcbd43197ccd07643140121d8a9cfaa91eadbc24e` (x86_64) and `cb34cefc6f4e77b90731374a2b737516bb8f3033c6ca46aa949e5344f68069e3` (aarch64).
- Shape per tool: prose comment lines, optional `# hold: <reason>`, `ARG <TOOL>_VERSION=`, then, for the four downloaded binaries only (ttyd, gh, mise, uv), `ARG <TOOL>_SHA256_X86_64=` and `ARG <TOOL>_SHA256_AARCH64=`, then the `RUN`. claude-swap and Claude Code have `_VERSION` alone (spec-2 F2-1). One `ARG` per line, unquoted.
- `DEVTEAM_BOX_TOOLS` order: claude-code, claude-swap, gh, ttyd, mise, uv. No `DEVTEAM_IMAGE_HUB`.

## Review focus

1. Existing boxes' `~/.gitconfig` names `/usr/bin/gh`: the symlink must exist and run (T2 probe prints `/usr/bin/gh --version`).
2. aarch64 (Render may build on either): each binary layer's `case` must map `aarch64` to the right asset name and sum; `verify-pins.sh` checks every `case` arm reads `$<TOOL>_SHA256_AARCH64`, and the T2 probe builds `--platform linux/arm64` when the runner can (QEMU via `docker/setup-qemu-action`), otherwise it's noted as unbuilt in verification.md.
3. `uv` on dev's PATH is mise's on the box: the probe calls `/usr/local/bin/uv` as well as `uv`.
4. A typo in a variable name (`$GH_VERSOIN`) expands to empty and the download 404s at build time, not before: `verify-pins.sh` checks every `$<TOOL>_…` reference names a declared `ARG`.
5. The ttyd probe `RUN` near the kit `COPY` still runs (the `box-image` build proves it).

---

### Task 1: the pins in `cloud/Dockerfile`

**Files:** Modify `cloud/Dockerfile:41-46` (apt layer), `:69-103` (tool layers), the end (before `VOLUME /data`). Test: `docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/verify-pins.sh` (a record-folder script, not a product file).

**Produces:** the `ARG` names and `ENV`s in spec "Contract provided".

- [ ] **Step 1: write `verify-pins.sh <dockerfile>`**, exit 0 or exit 1 naming each failure. It checks:
  - each of the 14 values in spec's table (6 versions incl. `v2026.10.17`, 8 sums) occurs in the file exactly once, on a line `ARG <NAME>=<value>` with the table's name;
  - each `ARG` named `*_SHA256_*` has 64 lowercase hex;
  - no `cli.github.com`, `githubcli`, or `install … gh` in an apt line; `DEVTEAM_IMAGE_HUB` absent;
  - each `$NAME`/`${NAME}` with NAME ending `_VERSION` or containing `_SHA256_` is a declared `ARG`;
  - line order: the last `apt-get install` line < every tool `ARG` line < `ARG DEVTEAM_RELEASE=v0.52.0` < the `ENV DEVTEAM_KIT_RELEASE=$DEVTEAM_RELEASE` instruction < `VOLUME /data`, and the `ENV` contains `DEVTEAM_BOX_TOOLS="claude-code=$CLAUDE_CODE_VERSION claude-swap=$CLAUDE_SWAP_VERSION gh=$GH_VERSION ttyd=$TTYD_VERSION mise=$MISE_VERSION uv=$UV_VERSION"`;
  - the comment above the first pin `ARG` contains `<TOOL>_VERSION` and `# hold:`.
- [ ] **Step 2: run it on today's file**: `sh verify-pins.sh cloud/Dockerfile` → exit 1, naming the missing `ARG`s (ttyd, mise, uv, gh) and the gh apt lines.
- [ ] **Step 3: edit `cloud/Dockerfile`** per spec "What changes" 1–6:
  - apt layer: drop the keyring `curl`, the `echo deb … github-cli.list` and `apt-get update && apt-get install … gh` lines.
  - the pins comment block (naming rule, `box-pins` reads and rewrites them, the `# hold: <reason>` line above `_VERSION`, why the order) replaces "These pins are bumped by editing them here and redeploying."
  - ttyd: `ARG`s, URL `…/download/$TTYD_VERSION/ttyd.$(uname -m)`; `case` arms `x86_64) sum=$TTYD_SHA256_X86_64`, `aarch64) sum=$TTYD_SHA256_AARCH64`.
  - gh: `ARG`s; `case` `x86_64) arch=amd64; sum=$GH_SHA256_X86_64`, `aarch64) arch=arm64; sum=$GH_SHA256_AARCH64`; `curl -fsSL -o /tmp/gh.tgz "https://github.com/cli/cli/releases/download/v$GH_VERSION/gh_${GH_VERSION}_linux_$arch.tar.gz"`, `sha256sum -c`, `tar -xzf /tmp/gh.tgz --no-same-owner -C /usr/local --strip-components=1 "gh_${GH_VERSION}_linux_$arch/bin/gh"`, `rm /tmp/gh.tgz`, `chmod 755 /usr/local/bin/gh`, `ln -sf /usr/local/bin/gh /usr/bin/gh`. A comment says why the link exists (`~/.gitconfig`'s credential helper on the volume).
  - mise: `ARG`s; URL `…/download/$MISE_VERSION/mise-$MISE_VERSION-linux-$arch`.
  - uv: its own `RUN` (download, check, extract to `/usr/local/bin`, `rm`).
  - claude-swap: its own `RUN`, the existing `uv tool install` line and `chmod -R a+rX /opt/uv`.
  - Claude Code: moved last of the tool layers, as is.
  - before `VOLUME /data`: spec §6's `ARG`/`ENV` with `v0.52.0`, and a comment that the release-prep PR sets it.
- [ ] **Step 4: run** `sh verify-pins.sh cloud/Dockerfile` → exit 0; `sh -n` on every `RUN` isn't possible statically, so read the diff once against the spec.
- [ ] **Step 5: gate** `devteam.mjs gate ci -- sh "$DEVTEAM_HOME/scripts/devteam-ci-green.sh"` after push (T2 pushes); task review `reviews/task-1.md` by a fresh subagent; commit `kit-47: pin every box tool as Dockerfile ARGs`.

### Task 2: the probe in CI (temporary)

**Files:** Modify `.github/workflows/box-image.yml` (temporary, by ruling m-20261114-213717043-supervisor).

- [ ] **Step 1:** after the existing smoke step add `- run: docker run --rm --entrypoint sh box -c '<the done-when's command>; /usr/bin/gh --version; /usr/local/bin/uv --version; ls -l /usr/local/bin/gh /usr/bin/gh'`. If `docker/setup-qemu-action` is usable, a second job builds `--platform linux/arm64` and runs the same command; otherwise note aarch64 as unbuilt.
- [ ] **Step 2:** commit `kit-47: TEMPORARY probe (reverted before merge)`, push, open the PR (draft) so `box-image` runs; watch it with `gh run watch`.
- [ ] **Step 3:** expect: `v0.52.0`; `claude-code=2.1.307 claude-swap=1.0.0 gh=2.104.0 ttyd=1.7.7 mise=v2026.10.17 uv=0.13.7`; `2.1.307 (Claude Code)`; `gh version 2.104.0`; `ttyd version 1.7.7-…`; `2026.10.17 …`; `uv 0.13.7`; `claude-swap v1.0.0`; `/usr/bin/gh -> /usr/local/bin/gh`, root-owned. A failure goes through systematic-debugging back into T1.
- [ ] **Step 4:** write `verification.md` with the quoted log and run URL; commit.

### Task 3: revert the probe, finish

- [ ] **Step 1:** `git revert` the probe commit; `git diff --stat origin/main` lists `cloud/Dockerfile` and records only.
- [ ] **Step 2:** push; `box-image` and `test.yml` green at the head (gate ci); verification.md's rows at the named commit.
- [ ] **Step 3:** worker.md §8: merge `origin/main`, PR body with `## One-way doors` `None.`, final reviews `final-1.md` and `final-1b.md` (risk high: two from other sessions, by `review-request`), `check-ticket`, `merge-request`.

## Rulings

- m-20261114-213717043-supervisor: temporary probe commit on `box-image.yml`, reverted before the merge request; final diff `cloud/Dockerfile` only.
- m-20261114-214136480-supervisor: `ARG DEVTEAM_RELEASE=v0.52.0`.
