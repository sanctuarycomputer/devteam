The bounds in `test/bounds.test.mjs` and `test/speed.test.mjs` now hold on a loaded machine and still catch a real slowdown. Each one is either a count of operations, or a ratio against a reference workload timed in the same process just before it, so load slows both sides. No wall-clock limit is left. The cleanup in `speed.test.mjs` now stops what a test started before it removes the test's folders, and a step that throws can't skip the rest.

- **coverage:** counts every glob compiled across the whole test: 31, each compiled once. Its time is a ratio against the same matching done with plain RegExps written in the test (< 10x).
- **owner suggestions:** counts the owner asks. No path is asked twice, and there is at most one ask per folder holding an owned path. The 5,000 lookups are a ratio against the same walk up a plain Map (< 4x).
- **Inbox order:** `questions --json` against `goal list` on 2,000 questions (< 4.5x). This bounds the whole Inbox read, not ranking alone (supervisor ruling m-20261115-185641944).
- **search:** `search` against `knowledge --status accepted` (< 8x).
- **dashboard reply:** the 15 s limit is replaced by an order check. Every `send-keys` the fake tmux started must still be running when the reply arrives.
- **cleanup in speed.test.mjs:** a `cleanup()` helper runs the stops first and the folder removals last. Each step runs even if an earlier one throws, and the first error is thrown at the end.

## How to verify

- Stress run on this branch, both files, 3 repeats beside 4 CPU burners: https://github.com/sanctuarycomputer/devteam/actions/runs/43750016923 (success).
- `docs/devteam-dev/tickets/kit-213-steady-timing-bounds/verification.md` covers:
  - every bound before and after;
  - each bound failing under a 10x patch (`tenx.sh`, `slow-kit.sh`);
  - the after-hook checks (`check-hooks.sh`).
- Locally: `node --test --test-concurrency=2 test/bounds.test.mjs`, then `test/speed.test.mjs`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
