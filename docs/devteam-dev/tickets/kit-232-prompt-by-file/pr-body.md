## Summary

Workers, planners and fresh supervisors were started as `<agent_command> "$(cat '<prompt file>')"`, which makes the whole prompt one argument. Linux caps one argument at 128 KB (MAX_ARG_STRLEN). A worker whose prompt carried a large knowledge block (134 KB) never started: the shell printed `Argument list too long` in its window, and nothing raised it.

Now each launch passes one short, plain-words argument that names the prompt file by its absolute path and says to read all of it and follow it. The prompt file is written exactly as before.

- Worker and planner launches, fresh and `--resume` (a resume writes the same full prompt).
- `recover` and `legacyRecover` when they start a supervisor fresh.
- Unchanged: the supervisor's resume messages (`RECOVER_MESSAGE`, `LEGACY_RECOVER_MESSAGE`) still go inline word for word, and how a resume continues its session is unchanged (ruling m-20261115-064239382-supervisor).
- No Claude-specific flag, so this works for any `agent_command`.

## How to verify

`node --test --test-concurrency=2 --test-name-pattern='short pointer to the prompt file' test/kit.test.mjs`

The new test gives a planner over 200 KB of accepted knowledge and launches it through a stand-in agent (not `claude`), fresh and then with `--resume`. It asserts that the agent got exactly one argument under 1 KB and no argument reached 131,072 bytes, that the argument names the prompt file by absolute path, and that the agent read the whole file. On main it fails with the incident itself: `/usr/bin/env: Argument list too long`.

Records: `docs/devteam-dev/tickets/kit-232-prompt-by-file/` (spec, plan, reviews, verification).

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
