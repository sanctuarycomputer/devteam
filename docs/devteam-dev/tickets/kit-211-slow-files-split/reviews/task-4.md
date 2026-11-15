# Task review: T4 pane-question

- Reviewer: task-reviewer 4 (fresh subagent, claude-opus-5-5)
- Reviewed: 2f1b48f4ef8bd811747054c81eca08e8b611109e (test/pane-question.{parse,held,answer}.test.mjs and test/lib/pane-question-fixture.mjs)

## What I read and ran

- Read spec.md (Shape, the split, fixed waits, After hooks) and plan.md (T4, T6), base `test/pane-question.test.mjs` at e8022ac, the four files at 2f1b48f, and edits.mjs's `pane-question` entries.
- **Reproduce.** In a private `git archive 2f1b48f` copy, I put back the base file and deleted the three parts and the fixture. Then I ran `split.mjs pane-question` (parse takes `fns, screen, idle, bash, REAL, RULE, DASH`; held takes `tick, age`; answer takes `acts`; 5 + 5 + 6 tests, the fixture has 0) and `edits.mjs pane-question` (10 edits). All four files are byte-identical to 2f1b48f (`cmp`).
- **Nothing lost.** I compared sorted line counts of the base against the four files joined together. The only base lines missing at the head are:
  - the edited hook and `dash(t, …)` lines (10 `t.after(() => F.done())`, 1 `d.stop`, 1 `live.kill`, 1 `chrome.close`, 6 `dash(t, …)` calls and the `dash` signature);
  - the recomputed import lines;
  - the two-line file header, rewritten as the headers of the new files;
  - blank lines and lone `}`.

  No assertion line is gone.
- **The edits.** All 13 of the base's `t.after` hooks are accounted for:
  - In held, 4 `F.done` hooks become `const later = cleanup(t); later(() => F.done())`, and `live.kill` goes through `later`.
  - In answer, 6 `F.done` hooks change the same way. `dash(later, …)` registers `later(() => d.stop())`, and `chrome.close` goes through `later`.
  - In every test, `F.done` is the first `later`, so it runs last.
  - "what the card cannot answer" keeps its try/finally.
  - The import edits add only `cleanup`.
  - Nothing outside the spec and plan's list is changed.
- **cleanup(t) semantics on node:test (Node 18.20.4).** I ran a scratch test with three `later`s: the first throws, the second is async and throws, the third succeeds. They ran in the order `chrome,stop,done`: reverse order, each awaited, all three ran. The test failed with the first error thrown in run order (`stop failed`). The fixture's code is the plan's, verbatim.
- `names.mjs e8022ac 2f1b48f pane-question`: 16 tests at the base and 16 at the head (answer 6, held 5, parse 5), "diff: none".
- `lint.mjs` (eslint 9, no-undef and no-unused-vars) over the four head files: no problems, exit 0. Over the base file: no problems either, so nothing was already unused.
- **Each part stands alone.**
  - parse imports only `./lib/kit.mjs` (`kit`, `testDir`) and holds its own parser preamble, as the spec says.
  - The fixture's only module-level side effect is the `./lib/kit.mjs` import (`write`): its port block, tmux dir and env, which each part's process gets on its own. Everything else in the fixture is `const` or `function` definitions.
  - Every fixture export is used by two or more parts, or by the fixture itself:
    - `menuPane`, `heldFor`, `logLines` and `cleanup` by held and answer;
    - `nap` by held and by `menuPane`;
    - `heldDirOf` by held and by `heldFor`;
    - `AGENT` by `menuPane`.
  - The fixture has no test bodies.
  - No fixture imports `./lib/chrome.mjs`. Only answer imports it, which is right, because it has the Chrome test.
  - No test reads state that another part's test set.
- **Results.** local-run-1.log (at 662bbfd):
  - parse passes 5/5 in 0.2 s;
  - held passes 5/5 in 45.3 s;
  - answer fails 5 tests and skips the Chrome test, with no Chrome, in 7.6 s.

  The answer failures are 403s where 400 and 200 are expected ("on a box the owner answers only through the box's gateway"). That fits observation o-20261115-163506710: the dashboard reads the real box's files, and the tests fail at the base as well. CI is where they're judged (ruling m-20261115-165039090).
- **One part alone.** I ran answer once:
  - how: `nice -n 10 node --test --test-concurrency=2`, own TMPDIR, `DEVTEAM_*` and `TMUX*` unset, test/ equal to 2f1b48f;
  - what happened: on this box the first test waited out a 120 s `until()` instead of failing in 1.4 s, because I didn't go through run.mjs. That is the environment, not the split;
  - the hooks: once it failed, its dashboard process was gone and its `devteam-pane-route-*` folder was removed. So `d.stop()` and then `F.done()` ran after a failing test;
  - why I stopped it: the rest would have taken about 10 more minutes on a shared box;
  - afterwards: no process names my TMPDIR in its args or its environment.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| M1 | Minor | quality §3 (readability) | test/pane-question.held.test.mjs, "a claim nobody is working…", inside the `for` loop | The base's `const later = F.run(F.old, ['send', …, \`${name} later\`, …])` now shadows the test's `const later = cleanup(t)`. It's safe today, because no `later(…)` is called inside the loop. But a stop added there later would call a result object and throw a TypeError. Renaming one of them, say the send result to `sentLater`, would be a further named edit. | wont-fix: safe as the reviewer says (no later() call inside that loop); renaming the base's own variable would be an edit the spec doesn't name |
| N1 | Note | spec "After hooks" | test/lib/pane-question-fixture.mjs `cleanup` | The spec says "the first `later` registers one `t.after`". The code (the plan's, verbatim) registers it when `cleanup(t)` is called. Every caller calls `later` right after `cleanup(t)`, so the behaviour is the same. No change needed. | wont-fix: same behaviour, as the reviewer says; the plan's code is what runs |

Verdict: APPROVE 2f1b48f4ef8bd811747054c81eca08e8b611109e
