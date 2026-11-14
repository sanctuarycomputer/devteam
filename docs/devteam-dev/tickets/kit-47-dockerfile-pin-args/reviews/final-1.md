# Final review, pass 1

- Reviewer: final-a (fresh subagent of the supervisor, claude-opus)
- Reviewed: b33b6e4c5b36d196ff4ed01b0bf75ca84301e86b (the whole branch, kit PR #237)

| Id | Severity | Rule cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Suggestion | none (taste) | cloud/Dockerfile, uv layer `tar -xzf /tmp/uv.tgz …` | uv's tarball is extracted without `--no-same-owner`, so `/usr/local/bin/uv` and `uvx` are owned by uid 1001 (`runner/docker` in the tarball), unlike gh. This was true before the ticket and the line only moved. uid 1001 is unused (dev is 1000, gw is 990), so nothing can exploit it today. It could be aligned with gh's layer in a later ticket. | deferred (Suggestion): uv extraction is unchanged from main; a later ticket can add --no-same-owner |

No Critical, Important or Minor findings.

## What I checked and how

All of this ran in the detached review worktree `.worktrees/review-kit-47-b33b6e4c-a` at b33b6e4.

- **Rules and inputs read:** quality.md §3; the ticket's spec.md, plan.md and verification.md; the reviews spec-1, spec-2, plan-1, plan-2, plan-3 and task-1, where every Critical and Important finding has a disposition and the latest spec, plan and task verdicts are APPROVE; the design section "The Dockerfile's pins and `ENV` (kit-47)"; and the full diff `git diff origin/main...b33b6e4 -- cloud/Dockerfile`.
- **Upstream sums:** I downloaded each asset from its GitHub release with curl and hashed it with `sha256sum`:
  - ttyd 1.7.7: `ttyd.x86_64` gives 8a217c96…4f55 and `ttyd.aarch64` gives b38acadd…4165. Both equal the release's SHA256SUMS.
  - gh v2.104.0: `gh_2.104.0_linux_amd64.tar.gz` gives 98cb101a…c24e and `linux_arm64` gives cb34cefc…69e3. Both equal `gh_2.104.0_checksums.txt`. `gh release view --repo cli/cli` reports v2.104.0 as the latest release (2026-11-12).
  - mise v2026.10.17: `mise-v2026.10.17-linux-x64` gives fe6dd17e…fe8a and `linux-arm64` gives e9090414…809b. Both equal the release's SHASUMS256.txt.
  - uv 0.13.7: `uv-x86_64-unknown-linux-gnu.tar.gz` gives c5221ff4…6d83 and the aarch64 tarball gives 71279f8d…57dc. Both equal the per-asset `.sha256` files.
  - Every full 64-hex value equals its `ARG` in the Dockerfile.
- **Case arms:** each `x86_64)` arm reads `$<TOOL>_SHA256_X86_64` and each `aarch64)` arm reads `_AARCH64`. The asset names are right: ttyd `ttyd.$(uname -m)`; gh `amd64`/`arm64`, with the tag's `v` added in the URL only; mise `x64`/`arm64`, with `MISE_VERSION` carrying the `v`, which reproduces the old URL; uv `uv-$(uname -m)-unknown-linux-gnu`. All four downloads are checked with `sha256sum -c`.
- **gh tarball and the `/usr/bin/gh` link:**
  - I listed the tarball: it holds `gh_2.104.0_linux_<arch>/bin/gh`, the man pages and LICENSE, all owned by runner.
  - I ran the Dockerfile's exact `tar -xzf … --no-same-owner -C <dir> --strip-components=1 gh_2.104.0_linux_amd64/bin/gh` into scratch. It extracted only `bin/gh`, which runs as `gh version 2.104.0`, and a symlink to it runs too.
  - The layer ends `chmod 755 /usr/local/bin/gh && ln -sf /usr/local/bin/gh /usr/bin/gh`. The CI probe shows `/usr/bin/gh -> /usr/local/bin/gh`, with `/usr/bin/gh --version` = 2.104.0 and `/usr/local/bin/gh` root-owned at 755, on both arches.
  - No `cli.github.com` or `githubcli` line remains, and nothing else in the repo names `/usr/bin/gh`.
- **CI run 43645429250:**
  - `gh run view --json`: workflow box-image, event pull_request, headSha 5fc4370 (the probe commit), conclusion success. Both jobs passed: `build (ubuntu-latest)` and `build (ubuntu-24.04-arm)`.
  - The log shows that both jobs checked out and built `bc82898`, "Merge 5fc4370 into cca0976". cca0976 is today's `origin/main`. I fetched bc82898: `git diff bc82898 b33b6e4 -- cloud/Dockerfile` is empty, and so is `git diff 5fc4370 b33b6e4 -- cloud/Dockerfile`. So the Dockerfile that was built is byte-identical to this head's.
  - The log prints `x86_64` and `aarch64` respectively. Each job then prints `v0.52.0`; `claude-code=2.1.307 claude-swap=1.0.0 gh=2.104.0 ttyd=1.7.7 mise=v2026.10.17 uv=0.13.7`; `2.1.307 (Claude Code)`; `gh version 2.104.0`; `ttyd version 1.7.7-40e79c7`; `2026.10.17 linux-x64` or `linux-arm64`; `uv 0.13.7 (<arch>-unknown-linux-gnu)`; `claude-swap v1.0.0`; and the `ls -l` lines. This matches verification.md exactly.
  - At this head, `gh pr checks 237` shows the box-image `build` and every `kit` job passing.
- **Final diff scope:** `git diff origin/main...b33b6e4 --name-only` lists only `cloud/Dockerfile` outside `docs/devteam-dev/tickets/kit-47-dockerfile-pin-args/`. The probe's `box-image.yml` change is reverted (8aab455) and absent from the diff.
- **Nothing project-specific in the kit:** the Dockerfile diff names no project, home or instance. The records path `docs/devteam-dev/` comes from the link's configured `project` in home's settings.md, as worker.md prescribes for a ticket in another repo.
- **Contract for kit-48 (spec "What changes" 3, 5 and 6):**
  - Tool order is ttyd, gh, mise, uv, claude-swap, Claude Code, all after the two apt layers.
  - Each block is the prose comment, then `ARG <TOOL>_VERSION`, then `_SHA256_X86_64` and `_SHA256_AARCH64` (binaries only), then the `RUN`. Values are unquoted, one per line, and the sums are 64 lowercase hex.
  - The comment above the first pin states the naming rule, that `box-pins` reads and rewrites the lines, and the `# hold: <reason>` line-above convention. The old "bumped by editing" line is gone.
  - `ARG DEVTEAM_RELEASE=v0.52.0` comes after the last COPY, then `ENV DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS` in the spec's order, then `VOLUME /data`. No `DEVTEAM_IMAGE_HUB` is set.
  - v0.52.1 has since shipped, but the spec and ruling m-20261114-214136480 fix v0.52.0, and the release-prep PR sets the stamp.
  - uv and claude-swap are split into two layers, and claude-swap's layer still uses the uv installed in the layer before it.
- **Literal counts:** I ran `verify-pins.mjs cloud/Dockerfile`, which reported "14 pins, release v0.52.0, all checks pass", exit 0. I ran `mutate-pins.sh`, and all 8 mutations were caught, exit 0. Each version and sum occurs exactly once, on its `ARG` line.
- **Kit tests:** I ran `test/machine.test.mjs`, the only test that reads `cloud/Dockerfile`, with the DEVTEAM_* variables unset and a temporary TMUX_TMPDIR: 16/16 passed. No workflow or script passes build-args that collide with the new `ARG` names.

Verdict: APPROVE b33b6e4c5b36d196ff4ed01b0bf75ca84301e86b
