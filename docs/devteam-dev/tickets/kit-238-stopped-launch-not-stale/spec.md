# kit-238: a stopped or held launch isn't a stuck session

## Problem

kit-211 was launched, stopped a minute later for the component cap (its window closed, its
worktree removed), then held. Its last phase line stayed `starting`, so on every sweep:

- `status` printed `starting, 109m STALE`;
- `observe-metrics` raised a high `stale-worker`;
- `ready` counted it in `active workers` and in `max_active_per_component`, so kit-83 read as
  "(component at cap)" with only two kit sessions live.

All three read "is this ticket's worker active" as "its last phase isn't done or parked"
(`activeWorker`, `devteam.mjs:2780`), which a held ticket or a launch that never ran also satisfy.

## Terms

- **Held ticket**: `isHeld(t)` (the ticket's `held` field is a non-empty reason). The supervisor
  set it on purpose (`supervisor.md` §9: "a session you deliberately leave … carries the reason").
- **Stopped launch**: the ticket's last phase is `starting`, there is no tmux window named after
  it in the project's session (or no session, or no tmux), and no worktree at
  `<home>/.worktrees/<id>`. A live launch can never look like this: `makeSession` makes the
  worktree and the window before it writes the `starting` line, and the worker's own phase lines
  replace `starting` once it runs.

## Acceptance checks (the done-whens)

All in `test/kit.test.mjs`, one new test against a `threadsFixture`, four tickets in one
component, each silent 2 hours (hand-written phase lines), default `stale_after_minutes` (30).
The no-tmux-session checks (2, 4) run before any tmux session exists and whether tmux is installed
or not; the parts that need windows run only with tmux:

1. **Held** (`held` set, last phase `starting`, a window running, so it is held, not stopped):
   - `metrics --json` has no `stale-worker` for it;
   - `status` shows no `STALE` on its row and shows `HELD: <reason>`;
   - `ready --json`: not in `active`, not in `active_per_component`, listed under `held`;
     `active workers: N/…` in the text output does not count it.
2. **Stopped launch** (last phase `starting`, no window, no worktree, not held):
   - `status` shows `not started` on its row (no `STALE`); `status --json` row has `not_started: true`;
   - no `stale-worker` for it;
   - not counted in `ready`'s `active` / `active_per_component`; it is listed in `ready` again;
   - `worker <id>` treats it as a new start, not one that ran: with its goal draining
     (`goal hold <g> drain`) it is refused without `--force` (drain starts nothing new); with the
     goal running again, it starts: exit 0, prints `made worker <id>`, writes a new `starting`
     phase line, makes its worktree; afterwards status no longer says `not started`.
3. **Real stuck worker** (last phase `build`, its window present, silent 2 h): `stale-worker` high
   as today, `STALE` in status, counted in `active` and `active_per_component`.
4. **Held and stopped** (kit-211's own shape: held, last phase `starting`, no window, no
   worktree): no `stale-worker`; status shows `HELD: <reason>` (the hold wins over `not started`
   on the line, no `STALE`), and its JSON row still has `not_started: true`; not in `active`,
   listed under `ready`'s `held`.

CI's `kit` job runs this file; the gate is CI green at the head.

## Behaviour changes (devteam.mjs)

- New helper `stoppedLaunch(id)`, beside `activeWorker`. It checks the cheap things first (last
  phase `starting`, then no worktree) and asks tmux last, so tickets without a `starting` phase
  (all of G1's) never call tmux.
- New helper `countsAsWorker(t)`: `activeWorker(t.id) && !isHeld(t) && !stoppedLaunch(t.id)`.
  Used for `ready`'s `active` (so `active workers` and `active_per_component`) and for
  `observe-metrics`' `active` count (idle-capacity, memory-full wording).
- `ready` skips a ticket because it has a worker only when `countsAsWorker` holds: a held ticket
  (with or without a live window) is listed under `held`, and a stopped launch that isn't held is
  listed again as ready. The metrics' `ready` list (idle-capacity) skips one only when its worker
  is active and not a stopped launch (held tickets are already left out there).
- `stale-worker` skips a held ticket and a stopped launch.
- `makeSession` (`worker <id>`): a stopped launch is a new start, not a session that ran.
  `started` and `ran` become `lastPhaseOf(id) && !stoppedLaunch(id)`, and the coverage-gap guard
  runs for it too. So a draining goal refuses it without `--force`, a repo with coverage gaps
  refuses it, and `--resume` doesn't skip the memory ceiling.
- `deriveStatus` adds `not_started: true` to a stopped launch's row only (no new key on other
  rows, so the G1 goldens are unchanged). `status` prints, in order of precedence: a pane
  waiting on a prompt (unchanged), then `HELD: <reason>` for a held ticket with a phase (never
  `STALE`), then `[not started: no window or worktree]` for a stopped launch, then STALE as today.

## Contracts

None provided or consumed beyond the existing `status --json` / `ready --json` shapes, which only
gain the optional `not_started` key on a stopped launch's row.

## Edge cases

- tmux not installed: `resolvePane` says "no tmux session", which counts as no window; the
  worktree check still has to agree before a launch is called stopped.
- Held ticket whose worker is alive in its window: it doesn't count and isn't stale (the
  done-when says held, unconditionally); a prompt waiting in its pane still shows (unchanged).
- A launch in progress always has a worktree, so it is never a stopped launch.
- `agent-exited` already needs a window, so it never fires for a stopped launch (unchanged).
- Planners: out of scope (`stale-planner` already skips parked planners).
- Moved fleet: a ticket whose log says `starting` reaches a new machine with no worktree or window
  there. It reads as `not started`, leaves the caps and stale-worker, and `worker <id>` (a new
  start) continues from `origin/ticket/<id>`, as `makeSession` already does. That is intended:
  nothing of it runs on this machine.
- A ticket in a linked repo: its worktree is still `<home>/.worktrees/<id>` (`makeSession`
  makes it there), so the definition checks that path, not the linked repo's root.

## Out of scope

- The dashboard's rendering (`dashboard/index.html`, not in touches); it reads the same rows.
- `liveSessions` (park rulings, drain, fleet move). Known residual: a stopped launch still counts
  as a live session there, so a draining goal holding one doesn't read `drained`, and `fleet
  move` and the fleet-drain check still list it. "Not started" here means it is out of the caps,
  stale-worker and STALE, not out of every session list. A follow-up ticket can carry it; I'll
  raise it with the supervisor as an observation.

## Rulings

- m-20261115-171704216-supervisor: trial a-20261115-074130886 (size S): spec and plan first, one
  combined review, ask approve-spec and approve-plan together. Reviewers and probes follow
  k-20261115-080753394 (own HOME, hub port away from 4320, DEVTEAM_* unset) and
  k-20261115-164245020 (judge by exit code). Multi-step shell as script files; no rm -rf of a path
  from a file or command substitution; only touched test files, at --test-concurrency=2.
