# kit-240 relaunch work in progress first: plan

## TL;DR

- Three changes in `cmdAccountsTick` / `sessionsToRelaunch` (`docs/devteam/scripts/devteam.mjs`): held tickets stay down, gone sessions come back in tiers (work in progress, then the rest, then workers idle on a dependency), up to 3 a tick under the memory ceiling.
- Tests in `test/recovery.relaunch.test.mjs` only, TDD, one task per change; the fixture file stays as it is.
- `supervisor.md` §11's relaunch bullet rewritten to match.
- Build starts only on the supervisor's word, after kit-202, kit-239 and kit-86 merge and approve-plan is recorded; merge `origin/main` first.
- Local runs: only `test/recovery.relaunch.test.mjs`, `--test-concurrency=2`, with `timeout`; CI (`test.yml`) is the gate.
- No contract, no one-way door.

## Rulings

- m-20261115-225726341-supervisor: depends_on also has kit-239 and kit-86. Build waits for the supervisor's word (and every depends_on merged).

## Tasks

Every file below is in the ticket's touches. Run the test file as `timeout 600 node --test --test-concurrency=2 test/recovery.relaunch.test.mjs` (through `devteam.mjs gate test -- …`).

### T1: a held ticket is not relaunched

- Test (red first): in the existing "held, parked, done, merged and superseded…" test, add `F.worker('demo-18-held', { extra: { held: 'waiting on PR #9' } })` before the first tick, and assert it is not in `F.relaunched()` after the undrain tick either (the undrain tick relaunches only `demo-17-live`).
- Code: `held` in `cmdAccountsTick` gains `|| isHeld(tickets().get(name) ?? {})`. Update the comment on `sessionsToRelaunch` ("not held" now includes the ticket's held field).
- The limit-restart loop shares `held`; no test for it here: the limit-restart tests live in `test/accounts.*.test.mjs`, outside touches (plan-1 P6). The predicate is one function, exercised by the relaunch test.
- Review record `reviews/task-1.md`.

### T2: the order

- Test (red first), new test "the order: work in progress first, sessions idle on a dependency last; ties keep the launch order". With memory full (`DEVTEAM_MEMINFO` → a file in `F.base` with MemTotal 8 GB, MemAvailable 0.5 GB; one relaunch a tick, so each tick shows the next in order), launches in this log order:
  1. `demo-60-idle`: last phase `awaiting-word`;
  2. `demo-61-blocked`: last phase `spec`, and a `message` line it sent (kind `blocked`, to supervisor) appended inline to `run/log/demo-61-blocked.jsonl` with an `m-…-demo-61-blocked` id, unanswered;
  3. `demo-62-plain`: last phase `spec`;
  4. `demo-63-build`: last phase `build`;
  5. `demo-64-dirty`: last phase `awaiting-word`, its worktree a `git init` checkout with an untracked file;
  6. planner `p6`: an open question whose links name `plan/p6`, made with `ask` as the supervisor (the CLI writes a valid `q-` line);
  7. planner `p7`: an open thread with an artifact subject `{ kind: 'artifact', slug: 'mock', at: 'plan-p7' }`;
  8. planner `p8`: an open thread with item subject `{ kind: 'item', ref: 'planner:p8' }`;
  9. `demo-65-plain2`: last phase `plan`.
  Thread lines (`t-` ids, `channel: 'cli'`) are appended inline to the owner's month file (`run/log/owner-YYYY-MM.jsonl`), or made with `thread new … --subject` as the owner (`DEVTEAM_ROLE` unset) if the CLI takes a subject; never through `F.logLine`, whose `h-` ids only phase lines accept (plan-1 P3).
  Expected relaunch order across 9 ticks, read from each tick's `relaunched <name>` line: `demo-63-build, demo-64-dirty, plan-p6, plan-p7, plan-p8` (tier 0, launch order), `demo-62-plain, demo-65-plain2` (tier 1), `demo-60-idle, demo-61-blocked` (tier 2).
  Required second case (plan-1 P4), a fresh fixture with memory full: planners `q1` (question, then withdrawn with `question … withdraw` or the CLI's equivalent) and `q2` (thread on `planner:q2`, then resolved), launched before a worker `demo-70-build` in build: the order is `demo-70-build` first, then `plan-q1`, `plan-q2` (both tier 1, launch order).
- Code: `relaunchTier(name, role, launch)` next to `sessionsToRelaunch`, returning 0, 1 or 2 per the spec; `sessionsToRelaunch` maps found → tier and sorts stably. The dirty check: `fs.existsSync(path.join(wt, '.git'))` then `spawnSync('git', ['status', '--porcelain'], { cwd: wt, timeout: 10000 })`, dirty when it exits 0 with output (anything else counts as clean; plan-1 P7, spec-1 F2). Planner waiting: `planners().find((p) => p.feature === launch[1])?.waiting_on_owner?.length` or an open `threadViews(readLog().objects)` thread whose subject is item `planner:<feature>` / `planner:plan-<feature>`, or artifact `at === name`; no preview rule (spec-1 F3). Idle: `lastPhaseOf(name)?.to` in `blocked`, `awaiting-word`, or the worker's last sent message (`logObjects('message')`, `created_by === name`, by time) has kind `blocked` and isn't in `handledMessages()`.
- Review record `reviews/task-2.md`.

### T3: up to 3 a tick under the ceiling, a later one only with the time it may need

- Test (red first), memory files written into `F.base`: full = MemTotal 8 GB, MemAvailable 0.5 GB; under = MemAvailable 6 GB.
  - The first test ("a machine that died…") runs its ticks with memory full and keeps `one relaunch per tick`.
  - New test "up to 3 a tick under the memory ceiling" (plan-1 P2): five gone workers launched in order `demo-80-a`, `demo-81-notdue` (its restart record has an attempt a minute ago), `demo-82-b`, `demo-83-c`, `demo-84-d`; no `worktree_setup`. Under the ceiling, tick 1 relaunches exactly `demo-80-a, demo-82-b, demo-83-c` (`state().relaunched`), passing over `demo-81-notdue`; tick 2 relaunches `demo-84-d`; `demo-81-notdue` comes back in neither, and its restart record still holds only its one attempt.
  - New test "with a worktree_setup, a later relaunch needs the full 100 s": settings `worktree_setup` is `sleep 12` (so the first relaunch alone leaves under 100 s of the 110 s tick); three gone workers, under the ceiling. Tick 1 relaunches exactly one (the first in order); the other two have no entry in the restart record (not claimed). Tick 2 relaunches exactly the next. (About 25 s of wall time, no CPU.)
  - Existing tests that see two gone sessions at once (plan-1 P1) run with memory full so their one-a-tick assertions hold: "the key guard" (its last tick), "what a crash leaves behind" (its ticks after demo-51-m is added). Their subject isn't the count.
- Code: `tried` → `tries` (a number). `budget(cap = 1, need = RESTART_MIN_MS)` returns 0 when `tries >= cap` or the time left is under `need`, else `Math.min(RESTART_CHILD_MS, left)`. The supervisor restart and limit restarts call `budget()` (unchanged behaviour). The relaunch loop computes `const cap = memoryFull() ? 1 : 3` once, when `sessionsToRelaunch` found anything, and calls `budget(cap, tries && hasSetup(name, launch) ? RESTART_CHILD_MS : RESTART_MIN_MS)`, where `hasSetup` reads the session's repo's `settings.worktree_setup` (worker: `repoOfTicket(tickets().get(name))`; planner: `repo('home')`; a throw counts as true). No new environment knob, no released claims (plan-2 F2-1, F2-3 gone with the design). The comment "one relaunch a tick" updated.
- Review record `reviews/task-3.md`.

### T4: supervisor.md §11

- Rewrite the "After a dead machine" bullet: "… relaunches each session the kit launched that isn't held (its goal parked or let go, its ticket held, or the fleet drained), parked, done, merged or superseded …, work in progress first (uncommitted changes in its worktree, a planner the owner waits on through a thread or question, a worker in build), sessions idle on a dependency (blocked or awaiting word) last, launch order otherwise; up to 3 a tick while the machine's memory is under `machine_memory_ceiling`, 1 at or over it, sharing the restart record and caps above". Reword "the relaunch has 100 s": each relaunch has 100 s when its repo has a `worktree_setup` (a later one in a tick starts only if 100 s are left; else it waits for the next tick), so a slow setup means one a tick (plan-1 P5). Keep the rest of the bullet.
- Review record `reviews/task-4.md` (may share one record with T3 if reviewed together; then one file per task anyway, citing the same commit).

### T5: verify and finish

- Merge `origin/main`, re-run the test file; run `test/recovery.restart.test.mjs` and `test/accounts.*.test.mjs` once each, one at a time at `--test-concurrency=2` (they drive the same tick; plan-1 P8), and if one breaks, a `design-change` for touches; `node --check docs/devteam/scripts/devteam.mjs`; `devteam.mjs validate`.
- `verification.md`: one row per done-when, command, result, commit; CI evidence via `devteam.mjs gate ci -- gh run watch …` on the pushed head (memory: run, never type, the CI gate).
- PR, final review from a fresh reviewer (`reviews/final-1.md`), `check-ticket`, `merge-request`.
