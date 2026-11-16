## Summary

On 2026-11-16, two of `test/gateway.test.mjs`'s preview tests got a 503 from the gateway on Node 18, about six minutes apart (runs 43902612544 and 43904665122). Both passed on rerun.

**Why Node 18 got 503s: unexplained.** This is what the evidence supports.

- **Not a server that wasn't up yet.** The dev servers were already waited for (`listen`'s callback).
- **Not a timer.** The tests took 8 ms and 41 ms.
- **The gateway sent both 503s itself.** Either its preview map lacked the name right after `pollPush`, or its connect to 127.0.0.1 failed (any error for the socket test; an error other than ECONNREFUSED for the `::1` POST, which skips the `::1` retry).
- **Candidates, none confirmed:**
  - **A dev port equal to the gateway's never-bound terminal port.** The gateway drops such a preview from its map. It fits both failures, but `freePort()` handed back that port 0 times in 2000 tries here, so two hits six minutes apart would be improbable.
  - **For the `::1` POST only:** another process listening on 127.0.0.1 at the number `freePort()` had just freed.
  - **A transient loopback connect error on a busy runner.** The Node 18 and 20 shards also run the chrome group.
  - Another process holding the port before the dev server bound it doesn't fit: the old `listen` would have thrown EADDRINUSE, not led to a 503.
- **Not reproduced here:** 13 Node 18 runs, including the file beside its CI neighbours on 4 pinned cores. These two are the only preview-test failures in the last 150 `test.yml` runs.

So the change rules out the first candidate by construction, and makes any recurrence name its cause: the probe's failure message gives the ports and the gateway's own `/dev/` rows (`answers` or `not answering`).

- Both tests' dev servers listen on port 0 and take the port from their own `listening` address (`devServer`), never one the gateway refuses.
- Before anything is asserted, one probe goes through the relay (`previewReady`). It must get the app's own body on the first try, with no second hub read. It is **never retried**, so it can't hide a gateway defect. A failure names the dev, terminal, hub and instance ports and the gateway's own `/dev/` rows.
- In the ws test, a frame that never comes back fails after 5 s instead of hanging the file. The first socket is closed in `finally`.
- `test-stress.yml` takes `node: 18`.

`cloud/gateway.mjs` is unchanged.

## How to verify

- The two tests: `node --test --test-concurrency=2 --test-name-pattern="^a preview(:|'s WebSocket)" test/gateway.test.mjs`.
- Mutations, red then restored: `sh docs/devteam-dev/tickets/kit-245-steady-preview-relay-tests/evidence/mutate.sh` (output in `evidence/mutate.out`).
  - (a) The relay tries `::1` only: both tests fail at the probe, with the ports and `/dev/` saying `not answering`.
  - (b) The dev server's frames are not relayed back: the ws test fails with "no frame came back within 5 s".
- Stress, Node 18, `test/gateway.test.mjs`, 4 × repeat 5, every repeat green: [43914660700](https://github.com/sanctuarycomputer/devteam/actions/runs/43914660700), [43914676121](https://github.com/sanctuarycomputer/devteam/actions/runs/43914676121), [43915098070](https://github.com/sanctuarycomputer/devteam/actions/runs/43915098070), [43915346068](https://github.com/sanctuarycomputer/devteam/actions/runs/43915346068).

Records: `docs/devteam-dev/tickets/kit-245-steady-preview-relay-tests/`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
