# Spec review, pass 4

- Reviewer: spec-reviewer (fresh subagent, pass 4 cold confirm, claude-opus-5-5)
- Reviewed: f7003be3de59bac71ba0e09c4fec39dd2cab06c5 (spec.md)

I read the spec at f7003be, the pass-3 diff (`git diff 27d6209 f7003be`), spec-1 and spec-3 with their dispositions, `ticket show kit-48-box-pins-command` (the top-level done_when), and quality.md §3. I also grepped `cloud/Dockerfile` for `^\s*#\s*hold\b` (any case) and found no match.

The pass-3 findings are fixed:
- spec-3 F1: verify problem 8 now covers every hold problem the Holds paragraph names: an empty reason, a line matching `^\s*#\s*hold\b` that is not exactly `# hold: <reason>`, and a hold not directly above a tool's `ARG <P>_VERSION=`. `check` and `bump` refuse on problems 1-5, 7 and 8, so both now refuse on all of them. Acceptance 2 adds the cases: `bump` exits 1 with the file byte-identical, and `check` exits 2. Both exit codes match the `check` and `bump` sections.
- spec-3 F2: the hold pattern is now `^\s*#\s*hold\b`, both in Holds and in problem 8. An indented `  # hold: x` is not exactly `# hold: <reason>`, so it is flagged rather than ignored.

The earlier findings (spec-1 F1-F9, spec-2 F1-F3) are untouched by this diff. The spec still restates every done-when faithfully and can be built. The wider hold pattern matches nothing in the real Dockerfile, so done-when 2's "verify exits 0 on the kit's cloud/Dockerfile" still holds. One small overlap does not change what gets built: problem 4 leaves out "`# hold:` lines", so a malformed hold line that names a version can also show up as a stray. It is already a problem-8 failure, so the exit status is the same.

Values and refusals:
- P1 harness-agnostic: no harness is involved. Passes.
- P2 nothing project-specific: box-pins acts only on the file it is given. Passes.
- P3 decide and report: the calls are made and marked. Passes.
- P4 owner-only asks: none asked. Passes.
- P5 adversarial for authority: no authority is touched. I tried the hold path again (malformed, indented, misplaced), and each one refuses in verify, check and bump. Passes.
- P6 simple, names what isn't defended: it does. Passes.
- R1 no self-widening: nothing writes log or owner lines. Passes.
- R2 plain owner-facing words: the output is for the supervisor and CI. Passes.

No findings.

Verdict: APPROVE f7003be3de59bac71ba0e09c4fec39dd2cab06c5
