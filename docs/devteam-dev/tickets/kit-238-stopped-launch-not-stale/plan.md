# kit-238 plan

## TL;DR

- One helper `stoppedLaunch(id)`: last phase `starting`, no tmux window, no worktree.
- One helper `countsAsWorker(t)`: active, not held, not a stopped launch; used for every cap count.
- `stale-worker` skips held tickets and stopped launches; a real stuck worker is unchanged.
- `status` prints `not started` for a stopped launch and `HELD: <why>` instead of `STALE` for a held ticket.
- `ready` lists a stopped launch again, so `worker <id>` starts it fresh (already works; tested).
- One new tmux-gated test in `test/kit.test.mjs`, written first (red), then the code (green).
- Files: `docs/devteam/scripts/devteam.mjs`, `test/kit.test.mjs` only.

## Tasks

### T1: the failing test (`test/kit.test.mjs`)

New `test('a held ticket or a stopped launch is not a stuck worker …', { skip: hasTmux ? false : 'no tmux' })`
after the folder-trust test:

1. `threadsFixture('stopped-launch')`; `feature add` a feature for `F.goal`; `ticket add` three
   tickets `w-01-held`, `w-02-stopped`, `w-03-stuck`, component `web`, no dependencies.
2. Hand-write (`F.hand(id, { type: 'phase', from: null, to: … }, 2h)`) a `starting` line for
   held and stopped, and `starting` then `build` for stuck. `ticket set w-01-held --json '{"held":"waits for the cap"}'`.
3. Read the session name from `whoami` (`tmux_session=`); `tmux new-session -d -s <s> -n w-03-stuck 'sleep 600'`
   and `new-window -n w-01-held 'sleep 600'` (fixture's own TMUX_TMPDIR). No window and no
   worktree for w-02-stopped.
4. Assert, per the spec's acceptance checks: `metrics --json` stale-worker subjects are exactly
   `[w-03-stuck]` among the three; `status` lines (held: `HELD: waits for the cap`, no STALE;
   stopped: `not started`, no STALE; stuck: `STALE`); `status --json` `not_started` true only on
   w-02; `ready --json` `active` contains w-03 only (of the three), `active_per_component.web === 1`,
   `ready` ids include w-02-stopped, `held` includes w-01-held; text `active workers: 1/`.
5. `F.sup(['worker', 'w-02-stopped'])` matches `/made worker w-02-stopped/`; its worktree exists;
   its last phase line is a fresh `starting`; `status` row no longer says `not started`.
6. `finally`: kill the fixture's tmux server, `F.done()`.

Run: `node --test --test-concurrency=2 --test-name-pattern='stopped launch' test/kit.test.mjs` via
`devteam.mjs gate test`; expect failure (red) on the stale-worker / status / ready asserts.

### T2: the code (`docs/devteam/scripts/devteam.mjs`)

1. After `activeWorker` (`:2780`): `stoppedLaunch(id)` and `countsAsWorker(t)`, with a comment.
2. `deriveStatus` (`:3303`): `...(w?.phase === 'starting' && stoppedLaunch(t.id) ? { not_started: true } : {})`.
3. `cmdStatus` (`:3842`): `not_started` row prints `  [not started: no window or worktree]`; a held
   row with a phase prints ` HELD: <reason>` before the STALE check, and never STALE.
4. `cmdReady` (`:3797`): skip only `activeWorker && !stoppedLaunch`; `active = ts.values().filter(countsAsWorker)`.
5. `observe-metrics`: `ready` filter (`:11478`) uses `!(activeWorker && !stoppedLaunch)`; `active`
   (`:11524`) uses `countsAsWorker`; `stale-worker` condition (`:11440`) adds
   `!isHeld(ts.get(id)) && !stoppedLaunch(id)`.

Run the T1 test again (green), then the other touched-file tests are the same file (one run).
`node --check docs/devteam/scripts/devteam.mjs`. Full suite is CI's.

## Verification

`verification.md`: a row per done-when with the gate command and result at a named commit, plus
the CI run id and conclusion at the head (`gh run view`, never a log excerpt).

## Risks

- G1 goldens (`components.test.mjs`): untouched because `not_started` is added only to a
  stopped launch's row and no G1 ticket has a `starting` phase. CI confirms.
- Timing: hand-written lines 2 h old against a 30-minute threshold; no clock races.
