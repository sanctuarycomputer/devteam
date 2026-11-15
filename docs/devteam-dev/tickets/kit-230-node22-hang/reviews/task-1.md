# Task 1 review, pass 1

- Reviewer: task-reviewer (fresh subagent, claude-opus)
- Reviewed: f0763b62bbc7d9659159a701da073d085f2e8045

Scope: `git diff 83c4eab f0763b62 -- test/hub-overview.test.mjs`, checked against plan Task 1 (Interfaces for `runSteps`, `cleanup`, `defer`; Steps 1 and 3) and spec acceptance check 2.

What I checked and found correct:
- **No `t.after` left behind.** The only `t.after` left is the one inside `defer`. All 17 earlier call sites now go through `defer`, and each step's body is unchanged.
- **Ordering across helpers is right in every test.** Folder removals from `hubMachine` and `imageKit` are added before the processes that use them (`imageKit(t)` is evaluated as an argument, before `startHubCmd` or `spawn` adds its kill), so they run last. In "waits out another hub" the run order is h2, s2, M2 rm, h1, s1, M1 rm, imageKit rm. In the Chrome test it is q, other, p, chrome, b, a, then base. The holder skips a server the body already closed (`s.listening`).
- **A step that throws synchronously is caught.** `Promise.resolve().then(step)` turns it into a rejection, so it counts and the remaining steps still run.
- **A step that never settles is bounded.** The timer is ref'd and cleared in `finally`. `Promise.race` attaches a handler to both the step and the limit, so a step that rejects after its timeout raises no unhandled rejection. `runSteps` never rejects, so the late promises can't leave unhandled rejections either.
- **A step added after `run()` finished runs and reports on stderr.** Probe output: `cleanup after the test: after`.
- **`defer` keeps one cleanup per test.** It uses a `WeakMap` keyed by `t`, registers `t.after` once, and every test makes its first `defer` call synchronously, before any await.
- **The four cleanup tests pass on Node 22.23.4** (4/4, 0.4 s). Mutations they catch: dropping `.reverse()` fails test 1, and not awaiting late steps fails test 3.
- **Comment density and style match the file.** The comments say why, as code-style §"comment the why" asks.

I did not run the whole file, because the author's 22 and 24 runs cover the integration and the finding below is in the helper's logic. Scratch probes are at `/data/home/tmp/claude-1000/-data-home-code-devteam-dev--worktrees-kit-230-node22-hang/69c57cfc-b26d-4c6b-bc2e-efff81ad2b1e/scratchpad/helpers.mjs` (as committed) and `.../scratchpad/fixed.mjs` (with the fix).

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Important | plan Task 1 Interfaces, `cleanup`: "then awaits any late steps"; "An `add` while `run` is running … `run` awaits it" | test/hub-overview.test.mjs:47, `for (let i = 0; i < late.length; i++) first ??= await late[i];` | `??=` short-circuits. Once a main step has failed, `await late[i]` is never evaluated. `run()` then returns and the hook ends while late steps are still running, and their errors are dropped: they are not thrown and not written to stderr. This breaks the Interface in exactly the case it exists for: a test times out, a removal throws ENOTEMPTY, and the body then adds a process's stop. Probe on Node 22: a main step throws and adds a late 200 ms step. `run` rejects after 0 ms with `late done? false`, and the step finishes only later. With `{ const e = await late[i]; first ??= e; }`, `run` rejects after 201 ms with `late done? true`. No committed test covers a main error together with a late step. Add one to the "added while cleanup runs" test (a main step that throws and adds a slow late step: assert `run` rejects with the main error only after the late step has finished), and check that it fails against the current line. | fixed: each late step awaited before first ??= e; the added-while-running test now covers an earlier failure (RED before, GREEN after) |
| T1-2 | Minor | spec acceptance check 2, "Every test in `test/hub-overview.test.mjs` cleans up through one ordered cleanup" | test/hub-overview.test.mjs:497-526 ("a dashboard leaves the hub to the image …") | This test's dashboards are stopped by its own `try/finally` (`a.d.stop()`, `r.d.stop()`), not through `defer`, while its folders are removed through `defer` (`hubMachine`). If the 480 s timeout fires during an `until`, the cleanup removes the folders while that dashboard is still alive and writing into them. That is the ordering this ticket fixes, and it can raise ENOTEMPTY. The `finally` stops the dashboard only later. This is older code and the plan's site list didn't name it, but the spec says every test. Either add `defer(t, () => d.stop())` in `run` (`stop` is idempotent), or record why the `finally` is enough. | fixed: run() in that test defers d.stop() right after starting it; its finally stays (stop is idempotent) |

Verdict: CHANGES f0763b62bbc7d9659159a701da073d085f2e8045
