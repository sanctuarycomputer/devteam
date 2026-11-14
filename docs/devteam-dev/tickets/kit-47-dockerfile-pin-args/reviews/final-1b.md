# kit-47 final review (track B)

- Reviewer: final-b (fresh subagent of the supervisor, claude-sonnet)
- Reviewed: b33b6e4c5b36d196ff4ed01b0bf75ca84301e86b

| Id | Severity | Rule cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec acceptance 3 (suggestion, does not block) | cloud/Dockerfile:519-521 | The late `ARG DEVTEAM_RELEASE` sits after all COPY/RUN, so a stamp bump rebuilds only the ENV metadata layer. As specified. No change needed; noted only because a mistaken later COPY after it would silently bust nothing and hide the ordering rule (verify-pins.mjs checks it). | deferred (Minor): non-blocking, per the supervisor (m-20261114-220924213-supervisor) |

No Critical or Important finding.

## What I checked and how

Worktree: `review-worktree kit-47-dockerfile-pin-args b33b6e4c... --name b`, read there; removed at the end. No docker here, no kit test run.

- **Diff scope.** `git diff origin/main...b33b6e4 --name-only` outside the ticket folder is `cloud/Dockerfile` only. The probe commit's `box-image.yml` change is fully reverted (`git diff 5fc4370 b33b6e4 -- cloud/Dockerfile` empty; only box-image.yml differs, the revert).
- **Shell in each RUN.** Read every changed RUN: `case` arms set `sum`/`arch` from the right ARG per arch, `*)` exits 1; the `&&` chains carry `set -e` behaviour (a failed curl, sha256sum -c or tar aborts the build); `sum=$X` unquoted is safe (64 hex). Variable names: every `$..._VERSION` and `$..._SHA256_...` reference names a declared ARG (GH, TTYD, MISE, UV, CLAUDE_SWAP, CLAUDE_CODE); no duplicate ARG names; none expand empty, confirmed by the CI build fetching the real URLs (gh URL in the log shows v2.104.0, gh_2.104.0_linux_$arch).
- **gh.** `tar -xzf ... --no-same-owner -C /usr/local --strip-components=1 gh_<v>_linux_$arch/bin/gh` lands `/usr/local/bin/gh`; chmod 755; tarball removed in the same RUN; `/usr/bin/gh` symlink kept (existing ~/.gitconfig credential helper). gh apt source fully removed: the keyring curl, `github-cli.list` and the second `apt-get update/install gh` are gone, and a grep for `cli.github.com|githubcli` finds nothing outside ticket records. gnupg stays in the apt list (used by the pgdg layer).
- **Layer order.** apt layer, pgdg/big apt layer, then ttyd, gh, mise, uv, claude-swap, Claude Code (each with its ARGs right above), then user setup and all COPYs/RUNs, with `ARG DEVTEAM_RELEASE` and the ENV at the very end (lines 519-521) before `VOLUME`. Last COPY is at line 324, last RUN well before 519. The ENV expands DEVTEAM_RELEASE and all six version ARGs, all in scope (single stage). `DEVTEAM_IMAGE_HUB` absent.
- **uv / claude-swap.** uv extracts to `/usr/local/bin` as before; claude-swap RUN keeps `UV_PYTHON_INSTALL_DIR=/opt/uv/python UV_TOOL_DIR=/opt/uv/tools UV_TOOL_BIN_DIR=/usr/local/bin` and `chmod -R a+rX /opt/uv` unchanged from main; the split into two RUNs does not change where either lands. CI shows `claude-swap v1.0.0` and `cswap` listed, and `uv` at `/usr/local/bin`.
- **verification.md vs CI.** `gh run view 43645429250`: conclusion success, head 5fc4370, jobs `build (ubuntu-latest)` and `build (ubuntu-24.04-arm)` both success. The log output matches every quoted line on both arches: v0.52.0, the DEVTEAM_BOX_TOOLS string, `2.1.307 (Claude Code)`, `gh version 2.104.0`, `ttyd version 1.7.7-40e79c7`, mise `2026.10.17 linux-x64`/`linux-arm64`, `uv 0.13.7`, `claude-swap v1.0.0`, `/usr/bin/gh -> /usr/local/bin/gh` and `-rwxr-xr-x 1 root root` for gh. Nothing overstated; the arm runner is native (not QEMU). The ttyd probe RUN (line 154) passed as part of the build.
- **Pins.** Values match the spec table; the design snippet's names and ENV format match.

Not independently verified: the gh sums against the upstream checksums file (the CI `sha256sum -c` passing on both arches proves them); `devteam.mjs gate ci` at the final head (revert and verification commits touch only box-image.yml back to main's state and the ticket folder, so Dockerfile build coverage at 5fc4370 stands).

Verdict: APPROVE b33b6e4c5b36d196ff4ed01b0bf75ca84301e86b
