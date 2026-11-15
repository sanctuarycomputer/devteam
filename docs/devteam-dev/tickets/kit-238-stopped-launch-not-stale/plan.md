# kit-238 plan

## TL;DR

- One helper `stoppedLaunch(id)`: last phase `starting`, no worktree, no tmux window (checked in that order).
- One helper `countsAsWorker(t)`: active, not held, not a stopped launch; used for every cap count.
- `stale-worker` skips held tickets and stopped launches; a real stuck worker is unchanged.
- `status`: `HELD: <why>` for a held ticket (never STALE), else `not started` for a stopped launch.
- `worker <id>` treats a stopped launch as a new start (drain, coverage-gap and memory gates apply).
- One new test in `test/kit.test.mjs`, written first (red), then the code (green).
- Files: `docs/devteam/scripts/devteam.mjs`, `test/kit.test.mjs` only.

## Tasks

### T1: the failing test (`test/kit.test.mjs`)

New `test('a held ticket or a stopped launch is not a stuck worker …')` after the folder-trust
test. Not tmux-gated as a whole: the no-session checks run everywhere; the window parts run under
`if (hasTmux)`.

1. `threadsFixture('stopped-launch')`; `feature add` a feature whose goal is `F.goal`; `ticket add`
   four tickets in component `web`, no dependencies: `w-01-held`, `w-02-stopped`, `w-03-stuck`,
   `w-04-held-stopped`.
2. Hand-write (`F.hand(id, { type: 'phase', from: null, to: … }, 2h)`) a `starting` line for 01, 02
   and 04, and `starting` then `build` for 03. `ticket set <id> --json '{"held":"waits for the cap"}'`
   for 01 and 04.
3. **Before any tmux session exists** (the "no session" branch): `status --json` has
   `not_started: true` on 02 and 04 only; `metrics --json` has no `stale-worker` for 02 or 04;
   `status` prints `not started` on 02's row and `HELD: waits for the cap` on 04's, no STALE on
   either; `ready --json` lists 02 in `ready`, 04 under `held`, and neither in `active`.
4. **With tmux** (`if (hasTmux)`): read the session name from `whoami` (`tmux_session=`);
   `tmux new-session -d -s <s> -n w-03-stuck 'sleep 600'` and `new-window -n w-01-held 'sleep 600'`
   (the fixture's own TMUX_TMPDIR). Then assert:
   - `stale-worker` subjects among the four are exactly `[w-03-stuck]`, severity high;
   - `status`: 01 `HELD: waits for the cap`, no STALE; 02 `not started`; 03 `STALE`; 04 `HELD: …`;
   - `status --json`: `not_started` true on 02 and 04 only;
   - `ready --json`: `active` holds 03 alone of the four, `active_per_component.web === 1`; `held`
     holds 01 and 04; `ready` ids include 02; text output `active workers: 1/`.
5. **The relaunch** (with tmux): `goal hold <F.goal> drain --reason test`; `worker w-02-stopped`
   fails with `draining goal … starts nothing new`; `goal hold <F.goal> run`; `worker w-02-stopped`
   matches `/made worker w-02-stopped/`; its worktree exists; its last phase line is a fresh
   `starting`; its `status` row no longer says `not started`.
6. `finally`: kill the fixture's tmux server, `F.done()`.

Run (red): `devteam.mjs gate test -- node --test --test-concurrency=2 --test-name-pattern='stopped launch' test/kit.test.mjs`,
judged by its exit code.

### T2: the code (`docs/devteam/scripts/devteam.mjs`)

1. After `activeWorker` (`:2780`): `stoppedLaunch(id)` (phase `starting`, then
   `!fs.existsSync(path.join(mainRoot, '.worktrees', id))`, then
   `/^no tmux (session|window)/.test(resolvePane(tmuxTarget(id)).problem ?? '')`) and
   `countsAsWorker(t)`, with a comment.
2. `deriveStatus` (`:3303`): `...(w?.phase === 'starting' && stoppedLaunch(t.id) ? { not_started: true } : {})`.
3. `cmdStatus` (`:3842`): precedence prompt-waiting, then ` HELD: <reason>` (a held row with a
   phase, never STALE), then `  [not started: no window or worktree]` for `not_started`, then
   STALE / WAITING ON SUPERVISOR as today.
4. `cmdReady` (`:3797`): skip a ticket for its worker only when `countsAsWorker(t)`, so held
   tickets reach the `held` branch and an unheld stopped launch reaches `ready`;
   `active = [...ts.values()].filter(countsAsWorker)`.
5. `observe-metrics`: `ready` filter (`:11478`) uses `!(activeWorker(t.id) && !stoppedLaunch(t.id))`;
   `active` (`:11524`) uses `countsAsWorker`; `stale-worker` (`:11440`) adds
   `!isHeld(ts.get(id)) && !stoppedLaunch(id)`.
6. `makeSession` (`:15897`): `const ranBefore = role === 'worker' && !!lastPhaseOf(id) && !stoppedLaunch(id)`;
   the coverage-gap guard is `!ranBefore` and `started` is `ranBefore` for a worker, so `ran`
   follows.

Run the T1 command again (green, by exit code). `node --check docs/devteam/scripts/devteam.mjs`.
The full suite is CI's.

## Verification

`verification.md`: a row per done-when with the gate command and result at a named commit, plus
the CI run id and conclusion at the head (`gh run view`, never a log excerpt).

## Risks

- G1 goldens (`components.test.mjs`): untouched. `not_started` goes only on a stopped launch's
  row, and `stoppedLaunch` returns at its first check for G1's tickets (no `starting` phase), so
  no tmux call either. CI confirms.
- `memory-ceiling.test.mjs` (~63-71) and `multirepo-tickets.test.mjs` (~209) go through the same
  `started`/`ran` lines. Their sessions keep a window or a worktree, or a phase other than
  `starting`, so they aren't stopped launches and behave as before. I'll run both files once
  (each alone, --test-concurrency=2) since T2.6 touches their path.
- Timing: hand-written lines 2 h old against a 30-minute threshold; no clock races.

## Rulings

- m-20261115-171704216-supervisor: see spec.md, Rulings.
