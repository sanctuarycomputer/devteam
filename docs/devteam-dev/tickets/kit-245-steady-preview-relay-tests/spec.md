# kit-245 steady preview relay tests: spec

## What happened

Two `kit (18, rest 1/2)` failures, both at kit-243's head, about six minutes apart on 2026-11-16, and both passed on rerun:

- Run 43902612544 (kit-243 PR), test 57 `a preview: the owner reaches the dev server…`, `test/gateway.test.mjs:2191`: the POST to `cool-owl` (the dev server bound to `::1` alone) got `503 this preview is not available right now` where `v6:{"a":1}` was expected. The test took 41 ms.
- Run 43904665122 (main after #303), test 59 `a preview's WebSocket is relayed…`, `:2341`: the first upgrade got 503 where 101 was expected. The test took 7.9 ms.

## What the investigation found (and ruled out)

- **The dev servers are not on a timer already.** Every dev server in both tests is `await`ed on its own `listen` callback before the first request (`dev`, `v6`, `inst`). So the ticket's premise, a first request racing a dev server that isn't listening yet, does not hold as written.
- **The 503s are the gateway's own.** That body comes only from `previewUnavailable` (`cloud/gateway.mjs:1189`). The upgrade's 503 comes from three places: the name missing from the map, `previewHost` finding nothing on 127.0.0.1 or ::1, or the store throwing. The store writes by rename in the same process, so it can't throw here. Both failures are therefore one of two things: (a) the gateway's map lacked the name right after `await pollPush()`, or (b) the gateway's connect to 127.0.0.1 errored (for the ws test, any error; for the `::1` case, an error other than ECONNREFUSED, which skips the `::1` retry).
- **Not a slow machine firing a timer.** 7.9 ms and 41 ms rule out `previewHost`'s 300 ms timeout and the hub's deadlines.
- **Rare and clustered.** In the last 150 `test.yml` runs (every failed or rerun one, first attempts), these two are the only preview-test failures. Both were on Node 18, shard rest 1/2, at the same code, within the hour. The runner image was the same (ubuntu-26.04 20261111.196.1) on both and on earlier passing jobs. kit-243 changed only `test/kit.test.mjs` (chain group) and `devteam.mjs`, nothing in this shard's path.
- **Not reproduced locally** on Node 18.20.4 (the CI version line): 10 runs of the whole file, plus 3 runs of `run.mjs` with gateway.test.mjs beside its five CI neighbours (landing, ooda-signals, credentials, components, link-edits), `--concurrency 4`, pinned to 4 cores (taskset), on a box at load ~30. Zero failures.
- Probes on Node 18: no response emits `close` before `end` in 3000 hub-style reads (hubList would read that as "no list"). `freePort()` never handed back the never-bound `ttydPort` in 2000 tries (the gateway drops a preview whose port equals `ttydPort`).

**Superseded after final review pass 1 (F1):** the PR now calls the cause unexplained and names the candidates. The paragraph below is the pre-review reading, kept as it was. Its "port is anyone's" leg doesn't fit: a squatter on the port would have made the old `listen` throw EADDRINUSE, not led to a 503.

**What the PR will say about why Node 18 got 503s:** the most likely cause is the tests' own port choice. `freePort()` binds a port, closes it, and returns the number, and the dev server binds that number later. In between, the port is anyone's. On a 4-core runner with Chrome and other kit tests opening sockets alongside, another listener on 127.0.0.1 or a collision with a port the gateway refuses (its never-bound `ttydPort`, the hub, the instance block) takes the preview out of the map or sends the connect elsewhere. Node 18 and 20 are the shards that also run the chrome group, so they are the busiest. This is an inference: it matches both symptoms (an immediate 503, a first request only), but it is not proven, and the PR says so. The fix below removes that window and makes any recurrence name its cause.

## Acceptance checks (the done-whens)

1. Both preview tests start their dev servers on a port the OS assigns at `listen` (port 0), and take the port from the server's own `listening` address. That is the server's own ready signal: there is no window in which the port is unbound. Before the first asserted request, each test waits on the gateway's own view, bounded by `until`: the owner's `/dev/` page lists the name as `answers`, which means the map holds the name and `previewHost` connected. No sleep or timer anywhere. A failed wait, or a 503 on a first request, fails with a message that names the dev port, the gateway's `ttydPort`, the hub port and the `/dev/` rows. The PR names the likely cause above, and says it is likely, not proven.
2. test-stress.yml gains `'18'` in its node choices (ruling below). Four dispatches on `test/gateway.test.mjs`, `repeat=5`, `node=18`, all green: 20 runs, each linked in the PR.
3. Mutations, each shown red in the PR and then reverted: (a) `previewHost`'s and `proxyPreview`'s host list cut to `['::1']` (the relay never reaches a 127.0.0.1 dev server), which fails both tests; (b) `previewUpgrade` no longer pipes frames, which fails the ws test. Both are run locally on the two tests alone.

## Contracts

None provided or consumed: tests and a workflow input only. `cloud/gateway.mjs` is not changed.

## Edge cases

- The `::1` server: it can't take port 0 and be sure 127.0.0.1 is free on the same number. It keeps `freePort()` (the probe on 127.0.0.1), binds `::1`, and is then checked through `/dev/` (`answers` via `::1`). If 127.0.0.1 is taken on that number in between, the probe's message says so (the row answers, but the POST's body isn't `v6:`).
- A dev port that equals `ttydPort`, or falls in the hub port or the instance block: re-listen until it doesn't (bounded, at most 5 tries). These are the ports the gateway refuses by design, so a test may not pick one.
- `/dev/` itself refreshes the map, which doesn't change what the ws test asserts: "no refresh on an upgrade" is still asserted for `never-heard`.

## Out of scope

- Any change to `cloud/gateway.mjs`. If the diagnostics later show a gateway bug, it gets a ticket of its own.
- The other flaky test (kit-246).

## Rulings

- m-20261116-163456898-supervisor: lighter review depth under trial a-20261116-152814133. No separate spec, plan or task reviews; the supervisor reads both in full; full final review. Build after approve-plan; merge after kit-88.
- m-20261116-164040398-supervisor: `.github/workflows/test-stress.yml` is in touches. Add `'18'` to the node choices only, keep the repeat cap at 5, and run four dispatches (done-when 2 amended).
