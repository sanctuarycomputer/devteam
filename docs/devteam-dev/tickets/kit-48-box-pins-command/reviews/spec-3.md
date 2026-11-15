# Spec review, pass 3

- Reviewer: spec-reviewer (fresh subagent, pass 3 cold confirm, claude-opus-5-5)
- Reviewed: 27d62097a199be158316f37fb2fe5a6ed5739642 (spec.md)

I read the spec at 27d6209, the pass-2 diff (`git diff 738801e 27d6209`), spec-1 and spec-2 with their dispositions, `ticket show kit-48-box-pins-command` (the top-level done_when), the design's kit-48 section, Failure modes and Testing, quality.md §3, and `cloud/Dockerfile` 60-136 and 515-525.

The earlier findings are fixed:
- spec-1 F1-F9 stay fixed at 27d6209. Pass 2 confirmed them, and the pass-2 diff touches none of them.
- spec-2 F1: the Holds paragraph now makes any `^#\s*hold\b` line that is not exactly `# hold: <reason>` a verify problem. Acceptance 2 adds a `# Hold: x` case.
- spec-2 F2: bump step 2 now follows redirects and sends no auth header. Acceptance 4's fixture answers each download with a 302.
- spec-2 F3: a stray's problem line now names its line number and the text matched.

The spec still follows every done-when, and it can be built. The exit codes stay consistent with the done-when, as pass 2 reasoned. Nothing in the Dockerfile matches `^#\s*hold\b`, so the real file still verifies.

One problem was there before pass 2, and the pass-2 fix widened it. The hold-shape problems are defined only in the Holds paragraph. The numbered list that `check` and `bump` cite by number does not include them. That is F1.

Values and refusals:
- P1 harness-agnostic: no harness is involved. Passes.
- P2 nothing project-specific: box-pins acts only on the file it is given. Passes.
- P3 decide and report: the calls are made and marked. Passes.
- P4 owner-only asks: none asked. Passes.
- P5 adversarial for authority: no authority is touched. I tried the hold path again (F1). Passes.
- P6 simple, names what isn't defended: it does. Passes.
- R1 no self-widening: nothing writes log or owner lines. Passes.
- R2 plain owner-facing words: the output is for the supervisor and CI. Passes.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Important | ruling m-20261115-004401439; done-when 4 ("leaves a `# hold:` tool unchanged"); spec-1 F2, spec-2 F1; spec, Holds ("Either way a hold the owner meant can't be silently ignored and the tool moved by bump") | spec, verify problem 8 ("`# hold:` with no reason"); check ("any verify structure problem (1-5, 7, 8)"); bump step 1 ("problems 1-5, 7, 8 above") | Two kinds of hold line are verify problems only in the Holds paragraph: one not directly above a `_VERSION` `ARG`, and one not exactly `# hold: <reason>`. Neither is in the numbered list. Item 8 covers only an empty reason. `check` and `bump` decide whether to refuse by citing list numbers. So an implementation that follows the list makes `verify` fail on `# Hold: x`, which Acceptance 2 tests, while `check` still reports gh stale and `bump` moves it. No acceptance case runs `check` or `bump` against a bad hold line, so the tests can't catch this. That is spec-1 F2's failure again, and it is the one thing the Holds paragraph says must not happen. Fix: change item 8 to "any hold problem in Holds above: an empty reason, a `^#\s*hold\b` line (any case) that is not exactly `# hold: <reason>`, or one not directly above a tool's `ARG <P>_VERSION=`". Add a case in Acceptance 4: `bump` refuses with a `# Hold: x` directly above `ARG GH_VERSION=` and leaves the file byte-identical. Optionally add the same case for `check`, which should exit 2. | fixed: problem 8 now covers every hold problem; acceptance adds bump (exit 1, byte-identical) and check (exit 2) on '# Hold: x' |
| F2 | Suggestion | spec, Holds (`^#\s*hold\b`) | spec, Holds and problem 8 | BuildKit treats a line with whitespace before its `#` as a comment too. So `  # hold: x` matches neither `^#\s*hold\b` nor the exact form, and it is silently ignored. Consider `^\s*#\s*hold\b` for the problem match, so an indented hold is at least flagged. | fixed: the pattern is ^\s*#\s*hold\b |

Verdict: CHANGES 27d62097a199be158316f37fb2fe5a6ed5739642
