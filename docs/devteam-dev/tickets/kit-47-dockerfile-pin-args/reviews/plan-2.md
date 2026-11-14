# Plan review, pass 2 (cold confirm)

- Reviewer: plan-confirmer (fresh subagent, claude-opus-5-5)
- Reviewed: 207b5cfc93a6f7d7338b3acbfd9e37b37155ea50 (plan.md, diff since 8e559c3)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Important | spec "What changes" 3 ("One shape per tool, for kit-48's parser: ... then `# hold:` ... then `ARG <TOOL>_VERSION` ... `_SHA256_X86_64` ... `_SHA256_AARCH64`, then the `RUN`"; "one `ARG` per line"); plan-1 P2 ("no blank or comment line between them") | plan.md Task 1 Step 1, "Block shape" (with the Step 1 preamble "parses the file into instructions") | The fix for P2 checks contiguity at the instruction level. Comments and blank lines are not instructions, so a `# …` or blank line between `ARG X_VERSION` and `ARG X_SHA256_X86_64`, or between the last `ARG` and the `RUN`, still passes. Pass 1 named this exact case, and kit-48 parses lines, not instructions. Fix: state that the block is checked on raw lines. The `_VERSION`, sum `ARG` and `RUN` lines are consecutive physical lines, the only line allowed directly above `_VERSION` is a comment (prose, or a `# hold:` line when held), and each `ARG` is one physical line with no `\` continuation. | fixed: Block shape checked on raw physical lines (T1 step 1) |
| P2-2 | Minor | plan-1 P3 disposition ("asked of the supervisor"); ruling m-20261114-213717043-supervisor (covers only the smoke-step line) | plan.md Task 2 Step 1 | The arm matrix depends on "if the supervisor approves it", but no step sends the request, and the log has no such message yet (`history` shows none after 21:43Z). Add a step before T2 Step 2: send the request with `devteam.mjs` (the matrix on `runs-on`, which goes past the ruling's one line), say what happens if there is no answer by the push (x86_64 only, aarch64 deferred to beta), and record the ruling's id in verification.md. | fixed: asked in m-20261114-214823090-kit-47-dockerfile-pin-args; T2 step 1 says the no-answer path and records the id |
| P2-3 | Suggestion | | plan.md Review focus | The items are numbered 1, 2, 3, 4, 6, 5. Renumber them. | fixed: renumbered |
| P2-4 | Suggestion | | plan.md Task 1 Steps 2 and 4 | The mutations cover P1, the stamp order and P5, but not block shape. Add one that puts a comment line between two of a tool's `ARG`s. It would also prove P2-1's fix. | fixed: comment-between-ARGs mutation added (T1 step 2/4) |

Pass-1 findings:

- P1: confirmed fixed. "Case arms" checks each arm's sum variable and the `arch=` values for mise and gh, and "References" requires every declared pin `ARG` to be used by its `RUN`. A mutation (a swapped aarch64 sum) proves it.
- P2: not fully fixed. The tool order, `ARG` before `RUN`, "every `COPY` and `RUN` before the stamp" and stamp → `ENV` → `VOLUME` are now checked. Line-level contiguity (no blank or comment line inside a block) is not. See P2-1.
- P3: confirmed fixed in the plan: a native `ubuntu-24.04-arm` runner, never QEMU, and a decision rule with verification.md recording either outcome. The request to the supervisor is not yet a step. See P2-2.
- P4: confirmed fixed (a fixed-string substring count on the `ARG` line).
- P5: confirmed fixed (the "No hold" check, and the comment block never ends on a hold line).
- P6: confirmed fixed (`run: |`, `sh -ec`, and a per-line comparison in verification.md).
- P7: confirmed fixed (the repo-root path in Step 1, and Step 5 now commits, then the task review, then the gate after T2's push). Later steps shorten the path to `…/verify-pins.mjs`, which is acceptable.
- P8: confirmed fixed (verification.md states that `verify-pins.mjs` is a record, for done-when 5).

The diff adds no other Critical or Important issue. The move from sh to mjs is consistent across the TL;DR, Review focus and Task 1. Dropping "1.7.7" from the ttyd prose comment keeps that literal unique.

Verdict: CHANGES 207b5cfc93a6f7d7338b3acbfd9e37b37155ea50
