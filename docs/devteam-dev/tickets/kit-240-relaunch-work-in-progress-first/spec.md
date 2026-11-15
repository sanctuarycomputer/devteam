# kit-240 relaunch work in progress first: spec

Ticket: `kit-240-relaunch-work-in-progress-first` (chore, feature `chores`, component `kit`, size S, risk normal). Depends on `kit-202-lost-enter-retries` (not merged yet: build waits for it). Touches `docs/devteam/scripts/devteam.mjs`, `test/recovery.relaunch.test.mjs`, `docs/devteam/process/supervisor.md`.

## Intent

After a machine stop, `accounts-tick` brings gone sessions back through `sessionsToRelaunch`, which walks `lastLaunches()` in log order, one relaunch a tick. On the v0.57.0 restart that brought back workers idle on dependencies first, one a minute, and the dashboard planner (four owner threads waiting on its mock edits) about ten minutes in; and it relaunched kit-86, whose ticket was held (for PR #277), because `held()` doesn't read the ticket's `held` field. This ticket orders the relaunch by work in progress, keeps held tickets down, and lets one tick bring back up to 3 sessions while the machine has memory to spare.

## Rulings

(none yet)

## Acceptance checks (the done-whens)

1. `test/recovery.relaunch.test.mjs`: with several gone sessions, `sessionsToRelaunch` orders them so a session with uncommitted changes in its worktree, a planner with an owner thread or question waiting on its feature, or a worker in `build` comes before a worker idle on a dependency (last phase `blocked` or `awaiting-word`, or an unanswered `blocked` message as the last it sent); ties keep today's order (the order of `lastLaunches()`).
2. The same file: a ticket with a non-empty `held` field is not relaunched. `held()` in `cmdAccountsTick` checks the ticket's held field (`isHeld`) as well as phase, merge, goal hold and drain.
3. The same file: when the machine's memory is below `machine_memory_ceiling`, one accounts tick relaunches up to 3 gone sessions instead of 1, each still under the restart record and caps (`claimRestart`); at or over the ceiling it relaunches 1.
4. `supervisor.md` §11's relaunch bullet says the order (work in progress first, sessions idle on a dependency last), that a held ticket stays down, and the per-tick count.

## Design

### Order: three tiers, stable within each

`sessionsToRelaunch` keeps its filters and returns the found list sorted by a tier, stable (Array.prototype.sort is stable), so ties keep `lastLaunches()` order:

- **Tier 0, work in progress**, any of:
  - **uncommitted changes**: the worktree `.worktrees/<name>` is a git checkout of its own (it has a `.git` entry; a plain directory would otherwise read the enclosing repo's status) and `git status --porcelain` there, run with its own 10 s timeout (`spawnSync`; the kit's `git()` has none), prints anything (tracked changes or untracked files);
  - **a planner the owner waits on**: role `planner` and either its `planners()` row has a non-empty `waiting_on_owner` (open questions on its goals or linking its plan branch, as the planner row already computes), or an open thread (`threadViews`, status `open`) whose subject points at it: an item subject `planner:<feature>` (what the dashboard's planner card gives) or `planner:plan-<feature>`, or an artifact subject drawn in its worktree (`subject.at === 'plan-<feature>'`). Previews are left out: a preview record doesn't name the session that runs it. Once the question is answered or withdrawn and the thread resolved, the planner falls back to tier 1;
  - **a worker in build**: role `worker` and its last phase (`lastPhaseOf`) is `build`.
- **Tier 2, idle on a dependency**: role `worker`, not tier 0, and its last phase is `blocked` or `awaiting-word`, or the last message it sent is kind `blocked` and unanswered (`handledMessages()` lacks its id).
- **Tier 1**: everything else.

Tier 0 wins over tier 2: a worker in `awaiting-word` with uncommitted changes comes back early.

The tiering is a separate pure-ish function (`relaunchTier(name, role, launch)`) so it can be read alone; it runs only on sessions already found (the expensive bits, one `git status` and the planner/thread folds, are paid only when something is gone).

### Held tickets

`held` in `cmdAccountsTick` gains `|| isHeld(tickets().get(name) ?? {})`. The same predicate guards the limit restarts (`restartPane` loop), so a held ticket's session stopped at a usage limit is also left as it is: held means nothing runs for it.

### Per-tick count

Today one boolean `tried` makes `budget()` return 0 after the first attempt of any kind. It becomes a count of attempts this tick (`tries`). The supervisor restart and the limit restarts keep today's rule (0 once any attempt was made). The relaunch loop gets its own budget: 0 once `tries` reaches the cap, where the cap is 1 when `memoryFull()` says the machine is at or over its ceiling and 3 otherwise (including when memory can't be read: `memoryFull()` never blocks on not knowing, as `worker` and `planner` already treat it). The cap is read once, only when there is something to relaunch. Each relaunch still goes through `claimRestart` (one per session per 10 minutes, 3 in 6 hours) and needs at least `RESTART_MIN_MS` (30 s) left of the tick's `RESTART_TICK_MS` (110 s), so three relaunches never push a tick past the dashboard's 120 s limit.

**A shortened relaunch costs no attempt (spec-1 F1).** The first relaunch of a tick gets the full `RESTART_CHILD_MS` (100 s) as today; a later one gets only what is left (30 to 100 s), and a resume whose `worktree_setup` is slower would be killed by the tick's own timeout. When the child was killed by that timeout (`spawnSync`'s `error.code === 'ETIMEDOUT'` or `signal === 'SIGKILL'` with no exit status) and its budget was under `RESTART_CHILD_MS`, `relaunchGone` gives the claim back (`releaseRestart`, as `restartPane` already does for a claim nothing came of), reports `cut-short` (counted as an attempt this tick, so the loop stops, but not in the record), and logs the `session-relaunched` observation saying it was cut short and left for the next tick. That next tick tries it first in its tier with the full 100 s. A relaunch killed with the full 100 s stays a spent attempt, as today. supervisor.md's "the relaunch has 100 s" sentence says this.

An attempt counts as today: `relaunchGone` returning `relaunched`, `failed` or `left` counts; `null` (not due) and `gave-up` don't.

## Contracts

None provided or consumed beyond the kit's own log and `accounts.json` (`relaunched` may now hold up to 3 names, in relaunch order).

## Edge cases

- Worktree not a git checkout (tests, a half-made worktree): never "uncommitted", no git call.
- `git status` fails or passes its 10 s timeout: treated as clean.
- A planner with no plan row (filtered already by `sessionsToRelaunch`).
- Thread subject `planner:plan-<feature>` (the session name) also matches, in case a page names it so.
- A supervisor restart or limit restart earlier in the tick counts towards the cap: a tick never does more than 3 restarts in all, and with memory full never more than 1, as today.
- The existing first test ("one relaunch per tick") becomes the full-memory case (`DEVTEAM_MEMINFO` pointed at a full machine), and gains the under-the-ceiling case (both in one tick).

## Out of scope

- Changing the restart record, its caps, or the limit restarts' one-per-tick rule.
- Ordering limit restarts (`restartPane`).
- A setting for the per-tick count.
- `test/lib/recovery-fixture.mjs` (not in touches): the tests build what they need inline.
