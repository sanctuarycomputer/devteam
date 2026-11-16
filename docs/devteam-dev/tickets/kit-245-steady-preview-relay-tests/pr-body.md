## Summary

On 2026-11-16, two of `test/gateway.test.mjs`'s preview tests got a 503 from the gateway on Node 18, about six minutes apart (runs 43902612544 and 43904665122). Both passed on rerun.

**Why Node 18 got 503s: likely, not proven.** The dev servers were already waited for (`listen`'s callback), so this was not a request racing a server that wasn't up yet. The 503s are the gateway's own. Either its preview map lacked the name right after `pollPush`, or its connect to 127.0.0.1 failed. The tests took 8 ms and 41 ms, so no timer fired. The most likely cause is the tests' own port choice. `freePort()` binds a port, closes it, and hands back the number; the dev server binds it later. In between, on a 4-core runner where the Node 18 and 20 shards also run the chrome group, the port is anyone's. It can also be one the gateway refuses a preview (its never-bound terminal port). Neither failure reproduced here: 13 Node 18 runs, including the file beside its CI neighbours on 4 pinned cores. Only these two failures appear in the last 150 `test.yml` runs. So the change also makes any recurrence name its cause.

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
- Stress, Node 18, `test/gateway.test.mjs`, 4 × repeat 5: links in `verification.md`.

Records: `docs/devteam-dev/tickets/kit-245-steady-preview-relay-tests/`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
