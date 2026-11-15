# kit-240 relaunch work in progress first: plan

## TL;DR

- Three changes in `cmdAccountsTick` / `sessionsToRelaunch` (`docs/devteam/scripts/devteam.mjs`): held tickets stay down, gone sessions come back in tiers (work in progress, then the rest, then workers idle on a dependency), up to 3 a tick under the memory ceiling.
- Tests in `test/recovery.relaunch.test.mjs` only, TDD, one task per change; the fixture file stays as it is.
- `supervisor.md` §11's relaunch bullet rewritten to match.
- Build starts only after kit-202 merges and approve-plan is recorded; merge `origin/main` first.
- Local runs: only `test/recovery.relaunch.test.mjs`, `--test-concurrency=2`, with `timeout`; CI (`test.yml`) is the gate.
- No contract, no one-way door.

## Rulings

(none yet)

## Tasks

Every file below is in the ticket's touches. Run the test file as `timeout 600 node --test --test-concurrency=2 test/recovery.relaunch.test.mjs` (through `devteam.mjs gate test -- …`).

### T1: a held ticket is not relaunched

- Test (red first): in the existing "held, parked, done, merged and superseded…" test, add `F.worker('demo-18-held', { extra: { held: 'waiting on PR #9' } })` before the first tick, and assert it is not in `F.relaunched()` after the undrain tick either (the undrain tick relaunches only `demo-17-live`).
- Code: `held` in `cmdAccountsTick` gains `|| isHeld(tickets().get(name) ?? {})`. Update the comment on `sessionsToRelaunch` ("not held" now includes the ticket's held field).
- Review record `reviews/task-1.md`.

### T2: the order

- Test (red first), new test "the order: work in progress first, sessions idle on a dependency last; ties keep the launch order". With memory full (`DEVTEAM_MEMINFO` → a file in `F.base` with MemTotal 8 GB, MemAvailable 0.5 GB; one relaunch a tick, so each tick shows the next in order), launches in this log order:
  1. `demo-60-idle`: last phase `awaiting-word`;
  2. `demo-61-blocked`: last phase `spec`, last message it sent kind `blocked`, unanswered;
  3. `demo-62-plain`: last phase `spec`;
  4. `demo-63-build`: last phase `build`;
  5. `demo-64-dirty`: last phase `awaiting-word`, its worktree a `git init` checkout with an untracked file;
  6. planner `p6`: an open question whose links name `plan/p6` (`{ ref: 'plan/p6' }`), logged by the supervisor;
  7. planner `p7`: an open thread with an artifact subject `{ kind: 'artifact', slug: 'mock', at: 'plan-p7' }` (logged as the owner writes threads; if the fixture can't write an owner line directly, `thread new` run with the owner's writer, as other thread tests do);
  8. `demo-65-plain2`: last phase `plan`.
  Expected relaunch order across 8 ticks, read from each tick's `relaunched <name>` line: `demo-63-build, demo-64-dirty, plan-p6, plan-p7` (tier 0, launch order), `demo-62-plain, demo-65-plain2` (tier 1), `demo-60-idle, demo-61-blocked` (tier 2). Also: with the question answered/withdrawn and the thread resolved, a planner falls to tier 1 (one more small case, or covered by `plan-p*` in tier 1 in a second fixture if simpler).
- Code: `relaunchTier(name, role, launch)` next to `sessionsToRelaunch`, returning 0, 1 or 2 per the spec; `sessionsToRelaunch` maps found → tier and sorts stably. The dirty check: `fs.existsSync(path.join(wt, '.git'))` then `git(['status', '--porcelain'], wt)` non-empty (null on failure counts as clean). Planner waiting: `planners().find((p) => p.feature === launch[1])?.waiting_on_owner?.length` or an open `threadViews(readLog().objects)` thread whose subject is item `planner:<feature>` / `planner:plan-<feature>`, or artifact `at === name`, or preview name owned by it (only if a preview record names its session; else left out). Idle: `lastPhaseOf(name)?.to` in `blocked`, `awaiting-word`, or the worker's last sent message (`logObjects('message')`, `created_by === name`, by time) has kind `blocked` and isn't in `handledMessages()`.
- Review record `reviews/task-2.md`.

### T3: up to 3 a tick under the ceiling

- Test (red first): the first test ("a machine that died…") runs its first tick with memory full and keeps `one relaunch per tick`; then a second fixture (or the same with three sessions) under the ceiling (`DEVTEAM_MEMINFO` → MemAvailable 6 GB of 8) relaunches 3 of 4 gone sessions in one tick (`state().relaunched.length === 3`) and the fourth on the next. And caps still hold: one of the four with a fresh restart record (`write(F.restartsFile, …)` an attempt a minute ago) is skipped, not counted.
- Code: `tried` → `tries` (a number); `budget(cap = 1)` returns 0 when `tries >= cap` or the time left is under `RESTART_MIN_MS`; the supervisor restart and limit restarts call `budget()` (cap 1, unchanged behaviour); the relaunch loop computes `const cap = memoryFull() ? 1 : 3` once, when `sessionsToRelaunch` found anything, and calls `budget(cap)`. The comment "one relaunch a tick" updated.
- Review record `reviews/task-3.md`.

### T4: supervisor.md §11

- Rewrite the "After a dead machine" bullet: "… relaunches each session the kit launched that isn't held (its goal parked or let go, its ticket held, or the fleet drained), parked, done, merged or superseded …, work in progress first (uncommitted changes in its worktree, a planner the owner waits on through a thread or question, a worker in build), sessions idle on a dependency (blocked or awaiting word) last, launch order otherwise; up to 3 a tick while the machine's memory is under `machine_memory_ceiling`, 1 at or over it, sharing the restart record and caps above". Keep the rest of the bullet.
- Review record `reviews/task-4.md` (may share one record with T3 if reviewed together; then one file per task anyway, citing the same commit).

### T5: verify and finish

- Merge `origin/main`, re-run the test file; `node --check docs/devteam/scripts/devteam.mjs`; `devteam.mjs validate`.
- `verification.md`: one row per done-when, command, result, commit; CI evidence via `devteam.mjs gate ci -- gh run watch …` on the pushed head (memory: run, never type, the CI gate).
- PR, final review from a fresh reviewer (`reviews/final-1.md`), `check-ticket`, `merge-request`.
