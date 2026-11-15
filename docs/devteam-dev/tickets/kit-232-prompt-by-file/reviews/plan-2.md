# Plan review, pass 2

- Reviewer: plan-reviewer 2 (fresh subagent, claude-opus-5-5)
- Reviewed: d54762c9df84b164d8449149d8b2f49eb1b8b166 (plan.md, diff since 60e4f58)

All five pass-1 dispositions hold for the revised plan, and I checked them against the code.

- **F1:** test/lib/kit.mjs:111 writes `"agent_command": "true", "resume_command": "true"` as one contiguous string. Step 2 now replaces that exact pair, builds the value with `JSON.stringify(\`${process.execPath} ${agent}\`)`, and commits and pushes in `F.old` with the given `F.g` calls. `threadsFixture` spreads `...F`, so `g` and `old` are available.
- **F2:** `typeNow` is a module-scope `const` at devteam.mjs:15192. Putting `promptPointer` beside it makes it visible to `recoverOne`, `legacyRecover` and the launch.
- **F3:** The launch prints `${resume ? 'resumed' : 'made'} ${role} ${name} in ${session}:${name} at ${wt}` (devteam.mjs:15814), and the planner's `name` is `plan-${id}`. So the plan's `made planner plan-big in <session>:plan-big` prefix is accurate. `threadsFixture`'s `env()` keeps the fixture's own `TMUX_TMPDIR`, so `kill-window -t =<session>:plan-big` and `capture-pane` reach the right tmux server.
- **F4:** The early stop on `Argument list too long` is specified.
- **F5:** `lens` is taken from `process.argv.slice(2)`. The lazy `/\/\S*?\.txt/` matches from the pointer's first `/` and stops before the trailing period.

The Rulings entry agrees with Task 2. Worker and planner, fresh and `--resume`, both get the pointer. `recoverOne` and `legacyRecover` keep the inline `$(cat …)` when `id` is set, and fall back to the pointer otherwise. The test resumes the planner and asserts on that resume's argv.

The revision adds no Critical or Important problem. One Minor wording leftover is below.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Minor | Plan consistent with itself | "On main …" paragraph after Task 1 step 6 | The paragraph still says that on main "the wait times out". Since the F4 fix, the wait stops early and fails with the pane's `Argument list too long` text, so the paragraph should say that. It does not block building the plan. | wont-fix the plan stays as approved; the red run on main recorded in verification.md shows the early failure with the pane text |

Verdict: APPROVE d54762c9df84b164d8449149d8b2f49eb1b8b166
