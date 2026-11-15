# Task review, task 1, pass 1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: 68bed83397e43dade615ab7b7d19efdd8ec7f2a7 (test/bounds.test.mjs: B1 to B4 as counts and same-process ratios)

What I checked, against spec B1 to B4, done-when 1 and plan Task 1:

- The counting proxy. It is installed through the context's own `Function` (`coverage.constructor`), so `globToRegex`'s `new RegExp` (a global lookup made at call time) goes through it. Regex literals and the species constructor used by `split` and `replace` still resolve to the original `%RegExp%`, so they are not counted. The 31 sources are distinct (30 component globs and `docs/devteam/**`). The end-of-test `once()` runs after 1 + 5 `coverage()` calls, the 900 `ownersOf` asks and the two literal suggestion checks. Mutation (scratch copy, `globCache.get(g)` -> `null` and `matcherCache.get(entry)` -> nothing): the coverage test fails on the count with `27186 compiled (after six coverage runs and 900 owner asks)`, not on a timeout (exit 1).
- The coverage reference and oracle. The hand-written regexes match the output of `globToRegex` for each glob (`**/` -> `.*`, `*` -> `[^/]*`, `{x,y}` -> `(x|y)`, `.` escaped). It uses none of the kit's code. It asks every path of every regex, and `deepEqual(ref(), [...cov.unowned])` holds. The copy is needed because `cov.unowned` belongs to the context's realm.
- `ratio`. It alternates reference and workload, keeps the best of n of each, uses hrtime, and reports `x = w / r`. A zero reference would give Infinity and fail, not pass.
- B2 count: the 1,809 folders are each ancestor of each owned path. B2b: `firstHere` and `ownerHere` give the kit's owner (the first matching component). The answers are compared before timing, and both sides are context-realm arrays (from `cov.unowned.map`), so the strict `deepEqual` compares like with like.
- B3 and B4 are interleaved CLI ratios (best of 5, best of 3), and the fixture holds 2,000 questions as the spec says. Each test reports its figures with `t.diagnostic`.
- No absolute millisecond bound remains: `hrtime` appears only inside `msOf`, and there is no `Date.now`, `ms <` or `< base +`.
- Unmodified run: `run-file.sh test/bounds.test.mjs` exited 0 (coverage 3.41x, lookups 0.99x, questions 2.35x, search 3.73x).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Suggestion | none (readability) | test/bounds.test.mjs:50 | The comment says each owned path is asked "only for a folder not yet indexed". The assertions check something weaker: no path is asked twice, and there are at most `folders.size` asks. The comment could say what is actually asserted. | |
| T1-2 | Suggestion | none (readability) | test/bounds.test.mjs:26 | "so the loader is the kit's as it is" is hard to follow. "so test/lib/kit.mjs's loader is unchanged" would say what it means. | |

Verdict: APPROVE 68bed83397e43dade615ab7b7d19efdd8ec7f2a7
