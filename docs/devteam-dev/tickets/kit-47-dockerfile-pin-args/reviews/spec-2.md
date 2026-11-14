# Spec review, pass 2 (cold confirm)

- Reviewer: spec-confirmer (fresh subagent, claude-opus-5-5)
- Reviewed: 74f27fc5a984d4664f40bd888e83aacfa094719b (spec.md, diff since 5c1272c)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | kit-48 contract (one shape per tool) | spec.md "What changes" 3, "One shape per tool" | The shape lists `ARG <TOOL>_SHA256_X86_64` and `_AARCH64` for every tool. The sentence before it limits sums to downloaded binaries, so claude-swap and Claude Code have only `_VERSION` before their `RUN`. Add "(downloaded binaries only)" after the two sum lines so kit-48's parser doesn't expect them for all six. | fixed: plan.md Global constraints says sums for the four downloaded binaries only (spec left as approved) |

## Pass-1 findings

- **F1 (Critical): confirmed fixed.** "What changes" 4 keeps `/usr/bin/gh` as a symlink to `/usr/local/bin/gh` and explains why: the `~/.gitconfig` credential helper lives on `/data`. There is a new edge-case line, and acceptance 2 requires the symlink plus `/usr/bin/gh --version` in the probe output. `/usr/local/bin` comes before `/usr/bin` in PATH, so plain `gh` still resolves to the new binary.
- **F2 (Minor): confirmed fixed.** The spec now says `v0.52.0` in "What changes" 6 and acceptance 3. Rulings quotes m-20261114-214136480-supervisor, which I checked with `record`: it approves v0.52.0 under a-20261114-214130871-supervisor, in reply to the worker's design-change message m-20261114-214122043.
- **F3 (Minor): confirmed fixed.** The spec adds `tar --no-same-owner`, and acceptance 2 adds "root-owned".
- **F4 (Minor): confirmed fixed.** The tarball goes to `/tmp` and is removed in the same `RUN`.
- **F5 (Minor): confirmed fixed.** The order of comment, hold line, `_VERSION`, x86_64 sum, aarch64 sum and `RUN` is now fixed, values are unquoted, and sums are 64 lowercase hex. F2-1 is a small wording gap in that new text.
- **F6 (Minor): confirmed fixed.** The supervisor's act a-20261114-214130871-supervisor is in the log and records the hold-line-above convention for kit-48.
- **F7 (Suggestion): confirmed fixed.** "What changes" 3 now says "comments included" and names the ttyd comment.

The diff adds no Critical or Important issue. The extra `/usr/bin/gh --version` line goes in the temporary probe commit that ruling m-20261114-213717043 already allows, so the final diff is still `cloud/Dockerfile` only.

Verdict: APPROVE 74f27fc5a984d4664f40bd888e83aacfa094719b
