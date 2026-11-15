# Spec review, pass 3

- Reviewer: spec-reviewer 3 (fresh subagent, claude-opus-5-5)
- Reviewed: 2cd1166362fb5ebad28a64b1f8718872e0d3fdd8 (spec.md)

I read pass 2's record (spec-2.md) and `git diff 4ccbdc2 2cd1166 -- spec.md`. For N1 I read `SHELLS` (L15207) and `resolvePane` (L15225-L15246) in devteam.mjs at 2cd1166, the "has a live agent" refusal (L15850, which refuses only when `resolvePane` returns no problem), the base test at e8022ac `test/recovery.test.mjs` L210-L232, and `STUB_SHELL` (L22-L26: a `#!/bin/sh` script that `exec`s `/bin/sh -i`). I also glanced at the L224 edit in edits.mjs to see that it matches the spec.

- N1: fixed. The poll now waits for `pane_current_command` to match `-?(sh|bash|dash|zsh)`. That set is a subset of `SHELLS`, and the check uses the same leading-`-` rule as `resolvePane`, so whenever the poll passes, the next `--resume` sees "no agent", not "has a live agent". The stub's own name (`stubshell`) and tmux's forked child fail the poll, as they should. `F.run` starts a fresh process, so `paneTable`'s cache can't serve a stale row. The edit in edits.mjs matches the spec.
- N2: fixed. L942 now has its own "Kept, a settle with no state to poll" line with a reason, separate from the waits for nothing to happen.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| M1 | Minor | consistency (outside spec.md) | plan.md L41 (new in 2cd1166) | The plan still says L224 becomes `until()` the pane's `pane_current_command` "isn't `node`". That is the poll N1 rejected. The spec and edits.mjs have the right poll, so the spec is not affected, but the plan contradicts both. Bring L41 into line with the spec. | |

Verdict: APPROVE 2cd1166362fb5ebad28a64b1f8718872e0d3fdd8
