# Task 1 review, pass 1

- Reviewer: task-reviewer 1 (fresh subagent, claude-opus-5-5)
- Reviewed: 83ea4218d893cbd3bbec5c206ae085ddaccf248d (test/kit.test.mjs)

The new top-level test matches spec check 2 and plan Task 1 step by step. It runs on its own `threadsFixture('prompt-file')` and is skipped without tmux. It replaces the existing `"agent_command": "true", "resume_command": "true"` pair rather than inserting a second one (plan review F1). It writes 64 distinct 3,500-byte accepted `lesson` lines with explicit unique `k-…-supervisor` ids. The agent is a stand-in node script, not `claude`. The planner is launched fresh, its window is killed on the fixture's tmux server (`F.env()`), and then it is relaunched with `--resume`. For each launch the test checks:
- the prompt file is over 200 KiB and holds the knowledge block (Lesson 0 to Lesson 63);
- the agent got exactly one argument, under 1 KB, and every argument is under 131,072 bytes;
- that argument equals the pointer text exactly and names an absolute path;
- the agent read the whole file.

The wait stops early with the pane's text when the pane shows `Argument list too long`. Cleanup kills the fixture's tmux server and calls `F.done()` in a `finally`.

I checked that the test catches the defect, in a scratch worktree at 6f426be (since removed):
- At the head commit the test passes.
- With the worker/planner site reverted to `"$(cat '${promptFile}')"`, it fails with `-bash: /usr/bin/env: Argument list too long`.
- With the pointer kept for fresh launches and `$(cat …)` used only on resume, it fails in the same way. The stack shows `started` called from line 637, the `await started(2, target)` of the resume half, so the resume assertion catches it on its own.

I ran only the pattern-filtered test, as instructed.

One portability nit: the exact `first` equality builds the expected path from the fixture's own, non-realpath'd path. On a macOS machine, `/var` is a symlink to `/private/var`, so the kit's `mainRoot` (from git and `process.cwd()`) would be the realpath and the exact match would fail locally. CI runs only on ubuntu, so this does not block. The suite already tolerates the same case at line 221.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T1-1 | minor | quality (portable tests) | test/kit.test.mjs:623 (`assert.equal(call.first, …${prompt}…)`) | The expected pointer uses `path.join(F.old, …)`, not the realpath. Under a symlinked tmpdir (macOS `/var` → `/private/var`) the kit names `/private/var/…` and the exact match fails when run locally. Line 221 already accepts either `[p, fs.realpathSync(p)]`. CI (ubuntu-only) is unaffected. Suggest comparing against both forms, or `fs.realpathSync(prompt)`. | fixed: in ba9296b, the pointer is matched against the path and its realpath |

Verdict: APPROVE 83ea4218d893cbd3bbec5c206ae085ddaccf248d
