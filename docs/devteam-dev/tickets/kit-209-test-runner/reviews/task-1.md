# Task 1 review, pass 1

- Reviewer: task-reviewer-1 (fresh subagent, claude-opus-5-5)
- Reviewed: 4fc5f34f63c31f84ea19d5ceefa8861082ce0300 (Task 1, the diff since 6e11130)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | Important | spec "test/lib/ports.mjs, test/lib/cli-runner.mjs" ("`cli-runner.mjs` reads it at startup, before it swaps in the env a test passes"); quality.md §3 "Scoped" (mutate where a test can't prove a property) | `test/run.test.mjs:48` (the `runNode` env in `cli-runner keeps its compile cache in DEVTEAM_TEST_SHARED_TMP`) | No test proves the shared dir is read before the env swap. The test's `runNode` env is `{ ...process.env, TMPDIR: T2 }`, and `process.env` already holds `DEVTEAM_TEST_SHARED_TMP=S`, so the request's env names S too. Mutation: moving `const shared = ...` in `cli-runner.mjs` to after `Object.assign(process.env, r.env)` still passes on Node 24 (both tests ok). Many kit tests pass a hand-built env without `DEVTEAM_TEST_SHARED_TMP`, and under that mutation their compile cache would land in each file's scratch TMPDIR. Fix: give `runNode` an env with no `DEVTEAM_TEST_SHARED_TMP`, e.g. `{ PATH: process.env.PATH, TMPDIR: T2 }`. Checked in a scratch copy: with that change the test passes on the real code and fails on the mutation. | fixed |
| T1-2 | Minor | quality.md §2 "Comments and readability" | `test/lib/ports.mjs:3` | The edited top-comment line is 153 columns, and the rest of the paragraph wraps near 100. The paragraph needs rewrapping. | fixed |

Checked and found sound:
- Interfaces: `ports.mjs` exports `LOCK_DIR = path.join(process.env.DEVTEAM_TEST_SHARED_TMP \|\| os.tmpdir(), 'devteam-kit-ports')`, and `dir` is that value. `cli-runner.mjs` sets `shared` at module top, before the env swap, and the compile cache is `path.join(shared, 'devteam-kit-compile-cache')`. These match the plan.
- `cli.mjs` spawns the warm runner with no `env`, so the runner inherits the test process's `DEVTEAM_TEST_SHARED_TMP`.
- No other behaviour in the libs changed. The diff under `test/lib/` is those lines and the comments. When the variable is unset, the cache now goes to the runner's startup temp dir and not to the request's `TMPDIR`. The spec asks for this.
- Runs via `t.sh` (`test/run.test.mjs` only). Node 18: 1 pass, 1 skip (no `enableCompileCache`). Node 22: 2 pass. Node 24: 2 pass.
- Mutations, each in a scratch copy on Node 24. LOCK_DIR back to `os.tmpdir()`: test 1 fails. `dir` back to `os.tmpdir()` with LOCK_DIR correct: test 1 fails. Cache back to `os.tmpdir()`: test 2 fails. `shared` ignoring the variable: test 2 fails. Read moved after the swap: survives (T1-1).

Verdict: CHANGES
