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

All in `test/kit.test.mjs`, one new tmux-gated test against a `threadsFixture`, three tickets in
one component, each silent 2 hours (hand-written phase lines), default `stale_after_minutes` (30):

1. **Held** (`held` set, last phase `starting`, a window running, so it is held, not stopped):
   - `metrics --json` has no `stale-worker` for it;
   - `status` shows no `STALE` on its row and shows `HELD: <reason>`;
   - `ready --json`: not in `active`, not in `active_per_component`; `active workers: N/…` in the
     text output does not count it.
2. **Stopped launch** (last phase `starting`, no window, no worktree, not held):
   - `status` shows `not started` on its row (no `STALE`); `status --json` row has `not_started: true`;
   - no `stale-worker` for it;
   - not counted in `ready`'s `active` / `active_per_component`; it is listed in `ready` again;
   - `worker <id>` starts it as a fresh launch: exit 0, prints `made worker <id>`, writes a new
     `starting` phase line, makes its worktree; afterwards status no longer says `not started`.
3. **Real stuck worker** (last phase `build`, its window present, silent 2 h): `stale-worker` high
   as today, `STALE` in status, counted in `active` and `active_per_component`.

CI's `kit` job runs this file; the gate is CI green at the head.

## Behaviour changes (devteam.mjs)

- New helper `stoppedLaunch(id)`, beside `activeWorker`.
- New helper `countsAsWorker(t)`: `activeWorker(t.id) && !isHeld(t) && !stoppedLaunch(t.id)`.
  Used for `ready`'s `active` (so `active workers` and `active_per_component`) and for
  `observe-metrics`' `active` count (idle-capacity, memory-full wording).
- `ready` and the metrics' `ready` list skip a ticket with a worker only when that worker isn't a
  stopped launch: a stopped launch is listed again (or under `held` if held), so idle-capacity
  can suggest starting it.
- `stale-worker` skips a held ticket and a stopped launch.
- `deriveStatus` adds `not_started: true` to a stopped launch's row only (no new key on other
  rows, so the G1 goldens are unchanged). `status` prints `[not started: no window or worktree]`
  for it, and for a held ticket with a phase prints `HELD: <reason>` where `STALE` would go.

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

## Out of scope

- The dashboard's rendering (`dashboard/index.html`, not in touches); it reads the same rows.
- `liveSessions` and park rulings.

## Rulings

- m-20261115-171704216-supervisor: trial a-20261115-074130886 (size S): spec and plan first, one
  combined review, ask approve-spec and approve-plan together. Reviewers and probes follow
  k-20261115-080753394 (own HOME, hub port away from 4320, DEVTEAM_* unset) and
  k-20261115-164245020 (judge by exit code). Multi-step shell as script files; no rm -rf of a path
  from a file or command substitution; only touched test files, at --test-concurrency=2.
