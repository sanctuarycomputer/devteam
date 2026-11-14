# kit-47-dockerfile-pin-args: plan

## TL;DR

- One file changes: `cloud/Dockerfile`. Everything else is this ticket's records.
- T1 rewrites the tool layers: six tools, each with its pin `ARG`s just above its own `RUN`, after the apt layers, in the order ttyd, gh, mise, uv, claude-swap, Claude Code. gh comes from its release tarball, and `/usr/bin/gh` is a symlink to it.
- T1 also puts `ARG DEVTEAM_RELEASE=v0.52.0` and the two `ENV`s just before `VOLUME /data`.
- T1's check is static: `verify-pins.mjs`, a record in the ticket folder (not a product file). It checks the literals, the case arms, each tool's block shape and the layer order. No docker runs on this machine.
- T2 adds a temporary probe step to `box-image.yml` (ruling m-20261114-213717043-supervisor). CI builds the image, on x86_64 and, if the supervisor approves, a native arm runner, and prints the done-when's versions. verification.md quotes the log with the run URL.
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
2. aarch64 (Render may build on either): each binary layer's `case` must map `aarch64` to the right asset name and sum. `verify-pins.mjs` checks each arm's sum variable and `arch=` value (plan-1 P1). The T2 probe runs on a native `ubuntu-24.04-arm` runner if the supervisor approves it, never under QEMU (plan-1 P3). Otherwise verification.md marks aarch64 as deferred to beta.
3. `uv` on dev's PATH is mise's on the box: the probe calls `/usr/local/bin/uv` as well as `uv`.
4. A typo in a variable name (`$GH_VERSOIN`) expands to empty and the download 404s at build time, not before: `verify-pins.mjs` checks every `$<TOOL>_…` reference names a declared `ARG`, and every declared pin `ARG` is used.
6. kit-48 reads a `# hold:` line above a `_VERSION` as a hold: today nothing is held, so the doc comment's example never sits directly above an `ARG` (plan-1 P5).
5. The ttyd probe `RUN` near the kit `COPY` still runs (the `box-image` build proves it).

---

### Task 1: the pins in `cloud/Dockerfile`

**Files:** Modify `cloud/Dockerfile:41-46` (apt layer), `:69-103` (tool layers), the end (before `VOLUME /data`). Test: `docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/verify-pins.mjs`. It is a ticket record, not a product file, and verification.md says so for done-when 5 (plan-1 P8).

**Produces:** the `ARG` names and `ENV`s in spec "Contract provided".

- [ ] **Step 1: write `node docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/verify-pins.mjs <dockerfile>`**. It exits 0, or exits 1 printing each failure on its own line. It parses the file into instructions (joining `\` continuations) and checks:
  - **Literals (fixed-string, plan-1 P4).** Each of the 14 values in the spec's table occurs exactly once as a substring, on its `ARG <NAME>=<value>` line. That is 6 versions (`v2026.10.17` included) and 8 sums.
  - **Sums.** Each `*_SHA256_*` value is 64 lowercase hex.
  - **gh's apt source is gone.** No `cli.github.com`, no `githubcli`, and no ` gh` package in an `apt-get install`. `DEVTEAM_IMAGE_HUB` is absent.
  - **References.** Every `$NAME` or `${NAME}` ending `_VERSION` or containing `_SHA256_` names a declared `ARG`. Every declared pin `ARG` is referenced in the `RUN` that follows its block.
  - **Case arms (plan-1 P1).** In each binary tool's `RUN`, the `x86_64)` arm sets `sum=$<TOOL>_SHA256_X86_64` and the `aarch64)` arm sets `sum=$<TOOL>_SHA256_AARCH64`. Where an `arch=` is set: mise `x64`/`arm64`, gh `amd64`/`arm64`.
  - **Block shape (plan-1 P2).** For each tool, in the spec's order (TTYD, GH, MISE, UV, CLAUDE_SWAP, CLAUDE_CODE), its `ARG` lines are contiguous: `_VERSION`, then `_SHA256_X86_64` and `_SHA256_AARCH64` for the four binaries. The very next instruction is a `RUN`. Each tool's block starts after the previous tool's `RUN`.
  - **No hold (plan-1 P5).** No line directly above a `_VERSION` `ARG` starts with `# hold:`.
  - **Order.**
    - The last `apt-get install` instruction comes before the first pin `ARG`.
    - The last tool `RUN` comes before `ARG DEVTEAM_RELEASE=v0.52.0`.
    - Every `COPY` and every `RUN` comes before that `ARG`.
    - Next comes the `ENV` with `DEVTEAM_KIT_RELEASE=$DEVTEAM_RELEASE` and `DEVTEAM_BOX_TOOLS="claude-code=$CLAUDE_CODE_VERSION claude-swap=$CLAUDE_SWAP_VERSION gh=$GH_VERSION ttyd=$TTYD_VERSION mise=$MISE_VERSION uv=$UV_VERSION"`, then `VOLUME /data`.
  - **Doc comment.** The comment block above the first pin `ARG` mentions `<TOOL>_VERSION`, `_SHA256_X86_64`, `_SHA256_AARCH64` and `# hold: <reason>`.
- [ ] **Step 2: run it on today's file**: `node …/verify-pins.mjs cloud/Dockerfile`. Expect exit 1, naming the missing `ARG`s (ttyd, mise, uv, gh) and the gh apt lines. Then mutate a scratch copy of the finished file (in T1 step 4) to check that each new rule fires: swap an aarch64 sum, move the stamp above a `COPY`, add a `# hold:` line.
- [ ] **Step 3: edit `cloud/Dockerfile`** per spec "What changes" 1–6:
  - **apt layer:** drop the keyring `curl`, the `echo deb … github-cli.list` line, and `apt-get update && apt-get install … gh`.
  - **The pins comment block** (the naming rule, that `box-pins` reads and rewrites the pins, the `# hold: <reason>` line above `_VERSION`, why this order) replaces "These pins are bumped by editing them here and redeploying." It ends with a blank line or prose, never a `# hold:` line, before the first `ARG`.
  - **ttyd:** `ARG`s; URL `…/download/$TTYD_VERSION/ttyd.$(uname -m)`; `case` arms `x86_64) sum=$TTYD_SHA256_X86_64` and `aarch64) sum=$TTYD_SHA256_AARCH64`. The prose comment above the `ARG`s drops "1.7.7".
  - **gh:** `ARG`s; `case` arms `x86_64) arch=amd64; sum=$GH_SHA256_X86_64` and `aarch64) arch=arm64; sum=$GH_SHA256_AARCH64`. Then:
    - `curl -fsSL -o /tmp/gh.tgz "https://github.com/cli/cli/releases/download/v$GH_VERSION/gh_${GH_VERSION}_linux_$arch.tar.gz"`
    - `sha256sum -c`
    - `tar -xzf /tmp/gh.tgz --no-same-owner -C /usr/local --strip-components=1 "gh_${GH_VERSION}_linux_$arch/bin/gh"`
    - `rm /tmp/gh.tgz`, `chmod 755 /usr/local/bin/gh`, `ln -sf /usr/local/bin/gh /usr/bin/gh`

    A comment says why the link exists: the credential helper in `~/.gitconfig` on the volume names `/usr/bin/gh`.
  - **mise:** `ARG`s; URL `…/download/$MISE_VERSION/mise-$MISE_VERSION-linux-$arch`.
  - **uv:** its own `RUN` (download, check, extract to `/usr/local/bin`, `rm`).
  - **claude-swap:** its own `RUN`, with the existing `uv tool install` line and `chmod -R a+rX /opt/uv`.
  - **Claude Code:** moved to be the last tool layer, otherwise unchanged.
  - **Before `VOLUME /data`:** spec §6's `ARG` and `ENV` with `v0.52.0`, and a comment that the release-prep PR sets it.
- [ ] **Step 4: run** `node …/verify-pins.mjs cloud/Dockerfile` and expect exit 0. Run the three mutations from step 2 on scratch copies; each must exit 1 naming its rule.
- [ ] **Step 5:** commit `kit-47: pin every box tool as Dockerfile ARGs` (with `verify-pins.mjs`). Then a task review, `reviews/task-1.md`, by a fresh subagent. The CI gate runs after T2's push (plan-1 P7).

### Task 2: the probe in CI (temporary)

**Files:** Modify `.github/workflows/box-image.yml` (temporary, by ruling m-20261114-213717043-supervisor).

- [ ] **Step 1:** after the existing smoke step, add one `run: |` step. It runs `docker run --rm --entrypoint sh box -ec` with the done-when's command, then `/usr/bin/gh --version; /usr/local/bin/uv --version; ls -l /usr/local/bin/gh /usr/bin/gh`. `-e` makes a missing binary fail the step (plan-1 P6). If the supervisor approves it, the build job's `runs-on` also gets a matrix of `[ubuntu-latest, ubuntu-24.04-arm]`, a native arm runner and never QEMU (plan-1 P3). If not, verification.md marks aarch64 as deferred to beta: Render builds the box on x86_64 today.
- [ ] **Step 2:** commit `kit-47: TEMPORARY probe (reverted before merge)`, push, open the PR (draft) so `box-image` runs; watch it with `gh run watch`.
- [ ] **Step 3:** expect: `v0.52.0`; `claude-code=2.1.307 claude-swap=1.0.0 gh=2.104.0 ttyd=1.7.7 mise=v2026.10.17 uv=0.13.7`; `2.1.307 (Claude Code)`; `gh version 2.104.0`; `ttyd version 1.7.7-…`; `2026.10.17 …`; `uv 0.13.7`; `claude-swap v1.0.0`; `/usr/bin/gh -> /usr/local/bin/gh`, root-owned. A failure goes through systematic-debugging back into T1.
- [ ] **Step 4:** write `verification.md`. It quotes the log and gives the run URL, and has one row per expected line, compared one by one. Commit it.

### Task 3: revert the probe, finish

- [ ] **Step 1:** `git revert` the probe commit; `git diff --stat origin/main` lists `cloud/Dockerfile` and records only.
- [ ] **Step 2:** push; `box-image` and `test.yml` green at the head (gate ci); verification.md's rows at the named commit.
- [ ] **Step 3:** worker.md §8: merge `origin/main`, PR body with `## One-way doors` `None.`, final reviews `final-1.md` and `final-1b.md` (risk high: two from other sessions, by `review-request`), `check-ticket`, `merge-request`.

## Rulings

- m-20261114-213717043-supervisor: temporary probe commit on `box-image.yml`, reverted before the merge request; final diff `cloud/Dockerfile` only.
- m-20261114-214136480-supervisor: `ARG DEVTEAM_RELEASE=v0.52.0`.
