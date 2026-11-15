# kit-238 verification

Code at `db7be547cecf4b638bba9d46c0fde550dce64729`; test as extended for task-1 at `4369b23733ab289a5af7317fa39d3bf0d3ebb941`. Every local run below went through
`devteam.mjs gate test`, one test file at a time, at `--test-concurrency=2`. Each ran isolated
(its own HOME, `DEVTEAM_HUB_PORT=4987`, every `DEVTEAM_*` unset, under `timeout` and a 3 GB memory
scope) and was judged by its exit code. The full suite is CI's.

| Done-when | Command | Result |
|---|---|---|
| 1. A held ticket raises no stale-worker, shows no STALE (it shows its hold), and doesn't count toward the cap or `active workers` | `node --test --test-concurrency=2 --test-name-pattern='stopped launch' test/kit.test.mjs` (test "a held ticket or a stopped launch is not a stuck worker; a real stuck one still is"; tickets w-01-held, with a live window, and w-04-held-stopped) | pass 1, fail 0, exit 0 (gate test passed). Red before the code at 16dc1cf: exit 1, failing at `not_started` (kit.test.mjs:801). |
| 2. A stopped launch (last phase `starting`, no window, no worktree) shows `not started`, raises no stale-worker, counts toward neither, and `worker <id>` starts it again as a fresh launch | same run (w-02-stopped): checked with no tmux session, then with one. A draining goal refuses `worker` (new start); with the goal running, `worker` prints `made worker`, makes the worktree and writes a fresh `starting` line | pass, exit 0 |
| 2a. A starting worker whose worktree is here is no stopped launch; idle capacity counts the same workers | same run (w-05-worktree, component api: worktree, no window): stale-worker, not `not_started`, in `active`; idle-capacity says `2/5 workers active` and offers w-02-stopped. Mutations at 4369b23, each alone: deleting the worktree check in `stoppedLaunch`, or reverting the metrics active count to `activeWorker`, turns the run red (exit 1) | pass, exit 0 (gate test passed) |
| 3. A real stuck worker (window present, silent past `stale_after_minutes`) still raises stale-worker | same run (w-03-stuck, `build`, silent 2 h, window running): stale-worker high, `[build, …m STALE]`, in `active` and `active_per_component.web === 1` | pass, exit 0 |
| `makeSession`'s `started`/`ran` paths unchanged for sessions that ran | `node --test --test-concurrency=2 test/memory-ceiling.test.mjs`; `… test/multirepo-tickets.test.mjs` | pass 1 / fail 0, exit 0; pass 8 / fail 0, exit 0 |
| G1 goldens unchanged (`status`, `ready`, `dashboard-data`, `metrics`) | `node --test --test-concurrency=2 test/components.test.mjs` | pass 7 / fail 0, exit 0 |
| CI, every job green at the head | GitHub Actions `test.yml` on the PR | pending: filled in from `gh run view` once the PR runs |

## The liveSessions residual (out of scope, ruling m-20261115-175404088-supervisor)

`liveSessions()` still counts a stopped launch as a live session: `activeWorker` and `isActive`
hold, and the window test there only matters for a superseded ticket. It feeds the following, and
nothing else:

- **Holds (drain and park).** `holdView`: a draining goal reads `draining`, never `drained`, while
  it holds a stopped launch, and a parking goal reads `parking`. `holdFindings` uses the same list,
  so the drain-finished finding doesn't come.
- **Park rulings.** `sendParkRulings` would send a `Park:` ruling to the stopped launch: a logged
  message typed into no window. `restartCommands` only takes parked sessions, so it isn't affected.
- **Fleet move.** `fleetStatus` (`fleet status`, `fleet move`'s readiness) lists it as a session
  to settle. `fleetUndo` lists it the same way. `hostClaimBody` keeps the fleet's `drain` from
  releasing the host claim while any live session isn't parked. So **a stopped launch keeps a
  draining fleet from handing its host claim to a new machine.** This is the sharpest effect.
- **Not the memory ceiling.** `memoryFull` reads the machine's cgroup and host memory, not the
  session list.
- **Not the hub.** No hub registration or heartbeat reads `liveSessions`.

A follow-up that makes `liveSessions` skip a stopped launch (`stoppedLaunch`, which this ticket
adds) would fix all of the above. Recorded as o-20261115-173454907.
