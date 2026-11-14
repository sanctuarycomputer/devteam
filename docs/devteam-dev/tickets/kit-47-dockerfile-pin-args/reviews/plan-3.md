# Plan review, pass 3 (cold confirm)

- Reviewer: plan-confirmer-3 (fresh subagent, claude-opus-5-5)
- Reviewed: 625c108c6a8e7267b4f8830e9df876e9a7d6938b (plan.md, diff since 207b5cf)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P3-1 | Suggestion | | plan.md Task 1 Step 3, uv bullet | The new Block shape rule requires a `#` comment on the line right above every `_VERSION` `ARG`. ttyd, gh, mise, Claude Code and claude-swap have prose comments today, but uv is a new block, and its Step 3 bullet doesn't mention one. `verify-pins.mjs` would catch a missing comment, so this costs at most one loop. Add "a prose comment above its `ARG`s" to the uv bullet. | noted: the uv block gets its own prose comment in the build; verify-pins.mjs enforces it |
| P3-2 | Suggestion | | plan.md Task 2 Step 1 vs Rulings | Step 1 still reads as conditional ("If the supervisor approves it ... With no yes by the push ..."), but the Rulings section records the yes (m-20261114-214839590-supervisor). The two agree, but Step 1 could just say the matrix is approved and drop the fallback. | noted: the Rulings section governs; T2 builds on both runners |

Earlier findings checked:

- P2-1 (pass 2, Important): fixed. Block shape is now checked "on raw physical lines, not parsed instructions": the `ARG` lines are consecutive with no blank or comment line between them, the next line starts with `RUN `, a `#` comment sits directly above `_VERSION`, there is no trailing `\`, and the tool order holds. This matches spec "What changes" 3. It is compatible with Step 3's "doc block ends with a blank line or prose", because each tool's own prose comment sits between the doc block and its `_VERSION` (ttyd's comment is kept, per its bullet).
- P2-2 (pass 2, Minor): fixed. The request is m-20261114-214823090-kit-47-dockerfile-pin-args, a review-request to the supervisor asking for the native arm runner, never QEMU, with the deferral fallback stated. The answer is m-20261114-214839590-supervisor: yes, in the temporary probe only. Both are cited in Task 2 Step 1 and in Rulings, and verification.md records the id. The probe is still reverted in T3, so the final diff stays inside ruling m-20261114-213717043-supervisor (`cloud/Dockerfile` only).
- P2-3 (pass 2, Suggestion): fixed. Review focus is numbered 1 to 6.
- P2-4 (pass 2, Suggestion): fixed. Step 2 adds the mutation that puts a comment line between two of gh's `ARG`s.
- P2 (pass 1, partly open): now fully fixed, through P2-1.
- P3 (pass 1, partly open): now fully fixed. The request was sent and approved, and the arm matrix uses a native runner, never QEMU.

The diff adds no new Critical or Important issue. The `box-image.yml` build job has no publish step, so a two-leg `runs-on` matrix doesn't conflict, and T3's revert removes it.

Verdict: APPROVE 625c108c6a8e7267b4f8830e9df876e9a7d6938b
