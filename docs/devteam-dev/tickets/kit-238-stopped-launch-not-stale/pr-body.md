A held ticket, or a launch stopped before it ran, is no longer read as a stuck session.

kit-211 was stopped a minute after launch for the component cap (its window closed, its worktree removed), then held. On every sweep it read as `starting, 109m STALE`, raised a high `stale-worker`, and counted toward `active workers` and `max_active_per_component`, so kit-83 showed "(component at cap)" with two kit sessions live.

## What changes (`docs/devteam/scripts/devteam.mjs`)

- `stoppedLaunch(id)`: last phase `starting`, no worktree at `.worktrees/<id>`, no tmux window (checked in that order, so tmux is asked last). A live launch always has its worktree before its window and its `starting` line, so it never matches.
- `countsAsWorker(t)`: active, not held, not a stopped launch. `ready`'s `active` / `active_per_component` and the metrics' active count (idle-capacity, memory-full) use it.
- `stale-worker` skips held tickets and stopped launches. A real stuck worker is unchanged.
- `status`: a held unfinished ticket shows `HELD: <reason>` (never STALE). A stopped launch shows `[not started: no window or worktree]`, and its JSON row gets `not_started: true` (only that row, so the G1 goldens keep their shape).
- `ready` lists held tickets under `held` and a stopped launch as ready again, and idle-capacity offers it.
- `worker <id>` treats a stopped launch as a new start: the drain, coverage-gap and memory-ceiling gates apply to it.

Out of scope, by ruling: `liveSessions` (holds, park rulings, fleet move, the host claim) still counts a stopped launch. `verification.md` lists what it feeds.

## How to verify

- `node --test --test-concurrency=2 --test-name-pattern='stopped launch' test/kit.test.mjs`. Five tickets: held with a window, stopped, real stuck, held and stopped, and a starting worker with a worktree. The no-tmux part runs without tmux. It failed before the code and passes after it, and two mutations of the code each turn it red.
- `test/components.test.mjs` (G1), `test/memory-ceiling.test.mjs` and `test/multirepo-tickets.test.mjs` pass unchanged.
- CI, `test.yml`, every job.

Records (spec, plan, reviews, verification): `docs/devteam-dev/tickets/kit-238-stopped-launch-not-stale/` on this branch.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
