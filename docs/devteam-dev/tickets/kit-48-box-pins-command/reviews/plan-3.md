# Plan review, pass 3

- Reviewer: plan-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: e369ea4594cc6279eee48725ad1207c746e86e23 (plan.md, against spec.md as approved in spec-4)

I read the whole plan at e369ea4, pass 2's record and its fix diff (1698fde..e369ea4), pass 1's record, `ticket show kit-48-box-pins-command` (the top-level done_when set), quality.md §3 and §6, and cloud/Dockerfile's pin ARGs (77-133, 519) and every line naming a hold.

What holds:
- plan-2 F1: `pinsCopy` now drops every line matching `/^\s*#\s*hold\b/i` before the test's `edit`, so a real hold in cloud/Dockerfile can't stack a second hold in T3, turn T2's "stale for all six" into `held`, or break T1's mise hold cases. Each test adds its own hold after the drop, so T1's hold cases (including the misplaced one above `# ttyd, the web terminal` and `# Hold: x`) and T3's malformed-hold case still see what they put there. The Dockerfile's instruction comment (line 71, `#   To hold a tool back, ...`) doesn't match the pattern, so the drop doesn't touch it, and the real-file `verify` case is unaffected.
- plan-2 F2: T2 now says each test spawns with `pinsAsync` (T1), which resolves on a non-zero exit.
- plan-2 F3: `safe` is listed under T1's Produces only. T4 consumes it from T1.
- The fixes add no behaviour. The plan is still coherent. Every interface a task consumes is produced by an earlier task (`readPins`'s line indexes go to `bumpPins`, `latestOf`'s release goes to T3's assets, `BOX_TOOLS.run/parse` goes to T4). Every file is inside touches (`docs/devteam/scripts/devteam.mjs`, `test/machine.test.mjs`).
- Each done-when has a test. DW1 is the fixture server plus T1's exit-2 case. DW2 is T1's cases. DW3 is T2. DW4 is T3. DW5 is T4 (image path, wrong shims first on PATH, uv gated on `UV_TOOL_DIR`, cwd no repo). DW6 is T5, and no file is added. DW7 is `pinsEnv` in T1–T5.
- The TL;DR matches the tasks: five tasks in order, `pinsEnv`, fixed test pins, all-or-nothing write, and the digest cross-check.

Values and refusals: checked at the spec stage (spec-1 to spec-4). The plan adds no behaviour beyond the approved spec.

No findings.

Verdict: APPROVE e369ea4594cc6279eee48725ad1207c746e86e23
