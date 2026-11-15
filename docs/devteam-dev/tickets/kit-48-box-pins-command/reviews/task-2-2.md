# Task review, Task 2, pass 2 (cold confirm)

- Reviewer: task-reviewer pass 2 (fresh subagent, claude-opus-5-5)
- Reviewed: da58913d768b5bbb0b178fb92f856726c993f3d4

I read `git show da58913 -- docs/devteam/scripts/devteam.mjs test/machine.test.mjs` and checked it against pass 1's findings and dispositions (task-2.md), plan.md Task 2 and spec.md. I ran the `check|verify|bump` tests from a `git archive da58913` copy on Node v18.20.4. 20 passed and 0 failed. I also probed by hand:
- `box-pins verify` on the real `cloud/Dockerfile` says `ok, 6 tools, release v0.52.0` and exits 0. mise's `v2026.10.17` and the other real pins pass the new plain-version check.
- `UV_VERSION=0.13.7-rc1` gives `uv's UV_VERSION 0.13.7-rc1 is not a plain version`. A trailing space gives `?` through `safe`, and an empty pin still gives `is empty` (not both). `check` on the rc1 file refuses with exit 2 before any fetch.
- With a probe server and `DEVTEAM_PINS_TIMEOUT_MS=1500`, a server that never answers and a server that sends headers then stalls its body both give `uv: unknown unreachable (timed out)`, with exit 3.
- The stricter fixture accepts what the real code sends. The only npm tool, `@anthropic-ai/claude-code`, is sent as `%2f`. GitHub is sent `per_page=30` and `accept: application/vnd.github+json`. I mutated the scratch copy twice: dropping the `%2f` encoding fails 7 tests (check and bump), and deleting the new verify problem fails the verify test.

Each fix checked against its disposition:
- F1 holds. A timeout reads `unreachable (timed out)` as our own words, outside `safe`. Other codes still go through `safe`.
- F2 holds. The new problem is in `readPins`, so verify reports it and check and bump refuse on it. It is tested.
- F3 holds. The new test has gh stale alongside three unknowns and asserts exit 1 for the text run and the `--json` run.
- F4 holds. The answer and the body share one deadline (`res.text()` under the same signal), and I confirmed this by probe. No test covers a stalled body, since the fixture's `hang` never sends headers. The fix is small and the probe confirms it, so I raise nothing.
- F5 holds. The fixture refuses a request without `%2f`, without `per_page=30` or without the accept header. `no release`, `bad JSON` and a timeout are tested.
- F6 does not match its record (F6-2). The code and T3 use `latestOf(tool)`, which is fine. But I found no ruling for it, either in plan.md's Rulings or in `docs/devteam/project/log/`, and plan.md:117 still says `latestOf(tool, pinned)`.

Nothing new broke.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F6-2 | Suggestion | | plan.md:117 (Task 2 Interfaces); task-2.md F6 disposition | F6's disposition says "ledgered as a ruling", but no such ruling is in plan.md `## Rulings` or in the log (a grep for `latestOf` under `docs/devteam/project/` finds nothing), and the plan still gives the signature `latestOf(tool, pinned)`. The code is right. Either add the ruling line to plan.md's Rulings, or correct the disposition so it says where the note went. | fixed: the builder rulings are now in plan.md's Rulings section (the ledger was git-ignored) |

Verdict: APPROVE da58913d768b5bbb0b178fb92f856726c993f3d4
