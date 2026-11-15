# Task review: T2 next-step

- Reviewer: task-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: 2f1b48f4ef8bd811747054c81eca08e8b611109e (test/next-step.{rank,order,strategy}.test.mjs and test/lib/next-step-fixture.mjs)

Read: spec.md (the next-step split at L58, the chrome group at L120, out-of-touches notes at L124-125), plan.md (T2, Tasks preamble), quality.md §3, split.mjs, split-plan.mjs (`next-step` entry), edits.mjs, lint.mjs, the base `test/next-step.test.mjs` at e8022ac, the three parts and the fixture at 2f1b48f, test/run.mjs's chrome grouping and timings use, local-run-1.log.

Ran:

1. Reproduce: `git archive 2f1b48f` into a private `mktemp -d`, base `test/next-step.test.mjs` restored from e8022ac, the three parts and fixture deleted, then `split.mjs next-step` (rank 184 lines/5 tests, order 210/5, strategy 281/6, fixture 39/0; base file removed) and `edits.mjs next-step` ("next-step: 0 edits"). `cmp` against 2f1b48f: all four files byte-identical. `test/next-step.test.mjs` is absent at 2f1b48f.
2. edits.mjs has no `next-step` key (entries only for machine, recovery, pane-question, operator-threads), as plan T2 says ("No edits"). Only `next-step.strategy` imports `./lib/chrome.mjs` (static import, so run.mjs's CHROME_STATIC puts it in the chrome group). The fixture does not import it, so rank and order stay out of that group. This matches spec L120.
3. `names.mjs e8022ac 2f1b48f next-step`: 16 tests before and after (order 5, rank 5, strategy 6), "diff: none". The grouping matches spec L58 and split-plan.mjs.
4. `lint.mjs` over the four files: only `test/lib/next-step-fixture.mjs:13:20 no-unused-vars 'run'`. The base has the same one (`base.mjs:16:20 'run'`), as the plan expects. No `no-undef`.
5. Verbatim check, independent of split.mjs: the sorted multiset of non-import, non-export, non-blank lines of parts+fixture equals the base's, apart from the header comments (the base's 3-line header becomes the fixture's 3-line comment plus a one-line comment per part). No line was dropped or duplicated. The `assert` line count is 199 in the base and 201 across the parts, the extra two being the two added `import assert` lines.
6. Standalone: every test builds its own `fixture(<name>)` and calls `F.done()` in `finally`. The only module-level state in the fixture is `rawN` (the counter for `raw()` ids and minutes). No test depends on its value: ids are per-fixture and never hard-coded, and the ratings test only `flush()`es an empty `raw`. In order, floor still runs before default, as in the base. The only top-level code left in a part is `REL_STRATEGY`, in strategy (plan T2). The findings test reads it before its declaration line, but only inside the test body, which runs after module evaluation. The local run below shows that test passing first in its file. The fixture holds `SUP`, `fixture`, `yesNo` and `raw`, each used by two or more parts, and no test bodies (ruling m-20261115-161102170).
7. Results: local-run-1.log (at 662bbfd; `git diff 662bbfd 2f1b48f -- test/` touches only operator-threads.hub) shows each part alone, Node 18, passing: order 5/5 in 19.7 s, rank 5/5 in 18.3 s, strategy 5 pass + the Chrome test skipped ("needs Chrome and a Node with WebSocket", the same skip as at base) in 20.6 s. I didn't rerun a part.
8. Leftover references to the old file: `test/lib/ports.mjs` L16 comment and `test/timings.json` (`test/next-step.test.mjs`). Both are outside the touches and named in spec L124-125, so no finding.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

Verdict: APPROVE 2f1b48f4ef8bd811747054c81eca08e8b611109e
