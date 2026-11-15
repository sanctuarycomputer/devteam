# Plan review, pass 2

- Reviewer: spec-plan-reviewer-2 (fresh subagent, claude-opus-5-5)
- Reviewed: 70c0094a4e88b9ccda396ef9dc0eeba6801fbb0f (plan.md, diff since 003d993)

Earlier findings:

- P1-1: fixed. `b1-count` replaces both `const hit = globCache.get(g);` and `let m = matcherCache.get(entry);`. Each text occurs exactly once in devteam.mjs, so the substitution script's exactly-once check holds. The end-of-test count runs after the 900 `ownersOf` asks, and each ask recompiles every glob when the caches are off, so the test fails on the count and not on the ratio. Compiling 31 regexes per `coverage()` call does not change the timing.
- P1-2: fixed. Task 1 adds B2b (a ratio, `x < 4`, with an oracle first), and Task 3 adds a `b2b` patch on the closure's walk.
- P1-3: fixed. Task 4 measures a loosened bound's 10x ratio again on CI, on a throwaway branch with the patch applied, which must fail on that bound.
- P1-4: fixed. `typing` is the file path and `held` is the pid array.
- P1-5: fixed. There are now two patches, `hooks-last` and `hooks-first`. `check-hooks.sh` checks the pids, the process group, the watcher, and (for `hooks-first`) that the folder is gone, and it is judged by its exit code.
- P1-6: fixed. Each test takes `(t)`.

TL;DR (quality.md §6): 7 bullets, and they match the tasks. The ratio figures (< 10, < 4, < 4.5, < 8), the two hook patches and the CI re-measure all agree with Tasks 1 to 4. Touches are still limited to the two test files plus this folder.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| P2-1 | Suggestion | | plan.md:80 (Task 3 b2b), spec.md:26 (B2b row) | The spec's margin rule (at least 1.5x under the 10x ratio) has not yet been checked for B2b: its 10x ratio is "measured in T3". Task 3 could record that ratio and confirm it is at least 6 (1.5 x 4), not just that the test fails. | |

Verdict: APPROVE 70c0094a4e88b9ccda396ef9dc0eeba6801fbb0f
