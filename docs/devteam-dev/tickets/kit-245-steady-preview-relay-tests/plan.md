# kit-245 steady preview relay tests: plan

## TL;DR

- Test-only change in `test/gateway.test.mjs`, plus one node choice (`'18'`) in `.github/workflows/test-stress.yml`. `cloud/gateway.mjs` is unchanged.
- New helpers beside `previewSetup`: `devServer(server, S, host)` takes the port from the server's own `listening` address (port 0) and never one the gateway refuses. `previewReady(S, name, port)` waits on the owner's `/dev/` page until the row says `answers`, for up to 10 s.
- The two flaky tests use them before their first asserted request. A 503 there fails with the ports and the `/dev/` rows.
- Mutations are shown red locally on the two tests alone (`--test-name-pattern`, `--test-concurrency=2`), then reverted.
- Evidence: four test-stress dispatches, node 18, repeat 5, with the links in verification.md and the PR. CI `test.yml` is the gate.
- No contract, no one-way door.

## Rulings

- m-20261116-163456898-supervisor: lighter depth. No spec, plan or task reviews; full final review.
- m-20261116-164040398-supervisor: test-stress.yml: add `'18'` only, keep the repeat cap at 5, and run four dispatches.

## Tasks

### T1: the helpers and the two tests

- Model: strong
- `test/gateway.test.mjs`, after `previewRow`:
  - `async function devServer(srv, S, host = '127.0.0.1')`: `listen(0, host)`, awaiting `listening` or `error`. If the port is `S.gw.ttydPort`, `HUB`, or in `P..P+24`, close and listen again (at most 5 tries; then `assert.fail` naming the ports). Returns the port.
  - `async function previewReady(S, name, port)`: for up to 10 s, `GET /dev/` on the box name with the session, until its body has `<b>${name}</b>` with `port ${port}` and `answers`. On timeout, `assert.fail` with the dev port, `ttydPort`, `HUB`, `P` and the `/dev/` body text (tags stripped, capped at 1500 characters).
  - `previewSetup` returns `ttydPort` through `gw`, as it already does. No change there.
- Test 'a preview: the owner reaches…': `dev` uses `devServer`, and `devPort` comes from it. Keep the asserted unauthenticated requests as they are (the `hub.hits` check depends on them coming first). Before the first session request, `await gw.g.pollPush(); await previewReady(S, 'cool-tiger', devPort)`. Since the `hub.hits` count is taken before the anonymous requests and checked right after them, the ready wait goes after that check. In the `::1` block: keep `freePort()` plus `listen(v6Port, '::1')` (edge case in the spec), then after `pollPush`, `await previewReady(S, 'cool-owl', v6Port)`. The `v6:` assertion's message names the port.
- Test 'a preview's WebSocket…': `dev` uses `devServer`. After `pollPush`, `await previewReady(S, 'cool-tiger', devPort)`. The first `c.status` assertion's message carries the ports.
- Check: run the two tests alone on node 18, 5 times. They must pass, and the file must pass once whole (it's the one file touched).

### T2: test-stress.yml node 18

- Model: fast
- Add `'18'` to `inputs.node.options`, and say so in the header comment's line on Node majors. Nothing else.

### T3: mutations (shown, not committed)

- Model: fast
- (a) Edit `cloud/gateway.mjs` locally so `previewHost` and `proxyPreview` try `['::1']` only. Run the two tests: both fail, at `previewReady` (named ports). Revert. (b) In `previewUpgrade`, drop the two `pipeline` calls that relay frames: the ws test fails at `a frame comes back`. Revert. Record the commands and outputs in verification.md.

### T4: evidence

- Push the branch. Run `gh workflow run test-stress.yml --ref ticket/kit-245-steady-preview-relay-tests -f files=test/gateway.test.mjs -f repeat=5 -f node=18` four times, one after another (the workflow's concurrency group queues them). Confirm each conclusion and link all four. Run the CI gate through `devteam.mjs gate ci -- <the real command>`.
