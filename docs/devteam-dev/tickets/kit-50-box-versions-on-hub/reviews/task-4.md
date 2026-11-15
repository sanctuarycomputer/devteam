# Task review, Task 4, pass 1

- Reviewer: task-reviewer (fresh subagent, claude-opus-5-5)
- Reviewed: ddddd2fcc0b6f09e40d5afd6e4bcf4c02b32f2c7 (a63703c..ddddd2f)

## What I ran

- Read `git diff a63703c ddddd2f` against plan Task 4, spec §4 and acceptance 4 and 5. The range holds `boxStatusLine` plus its two-line call in `machineStatus` (devteam.mjs), the new test and the Task 3 source assertions (test/hub-overview.test.mjs), the two disposition cells in reviews/task-3.md (nothing else in that file changed), and six PNGs under look/ (1100x320 renders, all valid; I looked at project-light.png: the line sits on its own row with the amber part).
- `boxStatusLine` uses the same parse as `cloud/gateway.mjs` `boxImage`: trim, both empty gives null, `/\s+/`, first `=`, `i > 0`, the token regex `^[\w.+-]{1,64}$` on both halves, first duplicate kept, `?` for a bad release. The line goes out right after the hub line. Isolation: `hubMachine` gives a temp HOME/cwd and clears `BOX_VARS`. Its port PORTS+96 is used nowhere else in test/. The test checks `git status --porcelain` before and after.
- `node --test --test-concurrency=2 --test-name-pattern='machine status prints the box line|box line' test/hub-overview.test.mjs`: 3 pass, 0 fail. Whole file once: 14 pass, 1 skipped, 0 fail (37 s). The worktree was clean afterwards.
- `node --test --test-concurrency=2 --test-name-pattern='status names the hub|machine status|status' test/machine.test.mjs`: 5 pass, 0 fail (101 s). This box exports `DEVTEAM_KIT_RELEASE` and `DEVTEAM_BOX_TOOLS`, so the box line was present in the tests that don't clear them, and they still passed.
- Mutants, run in a `git clone --shared` scratch copy at ddddd2f, never in the worktree. Killed: out() dropped; box line moved before the hub line; token regex unanchored; raw release instead of `?`; no trim; last duplicate kept; `,` join; version check dropped; name check dropped; `!rel || !pins`. In hub.html, killed: amber class dropped; `.ov-box` flex-basis rule dropped; amber colour rule dropped. Survived: `if (!rel) return null` (F1) and `split(' ')` (F2).

## Findings

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Low | quality.md §3 (tests pin the claim) | test/hub-overview.test.mjs, 'machine status prints the box line…' | Spec §4 says a missing release with tools set prints `machine: box ?: …`. No case sets `DEVTEAM_BOX_TOOLS` without `DEVTEAM_KIT_RELEASE`, so the mutant `if (!rel) return null` survives: that machine would print no line. The code is right today. Acceptance 4 doesn't ask for this case, so it doesn't block. Cheap to close: `status({ DEVTEAM_BOX_TOOLS: 'gh=2.83.0' }).next === 'machine: box ?: gh 2.83.0'`. | fixed (tools-only case added) |
| F2 | Info | spec §4 (same parse as boxImage) | same test | Every case separates pairs with a single space, so `split(' ')` in place of `split(/\s+/)` survives. The Dockerfile's ENV uses single spaces, so this is harmless in practice. | fixed (a tab between pairs in that case) |
| F3 | Info | brief's premise | test/machine.test.mjs | Only 'status names the hub's kit…' clears the box vars. The other machine-status tests (L457, L526, L660) inherit them from `baseEnv`. They use line-anchored `/m` matches that the box line can't satisfy or break, and they pass on this box with the vars set. Nothing to change. | noted: nothing to change |

Verdict: APPROVE ddddd2fcc0b6f09e40d5afd6e4bcf4c02b32f2c7
