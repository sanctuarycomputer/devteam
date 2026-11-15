# kit-230-node22-hang: spec

The Node 22 rest job never hangs to its 30-minute limit: a per-test timeout names the hanging test, and that test is fixed.

## What was found

- **Which test.** In the cancelled `kit (22, rest)` jobs on 07f7d1b (job 132671175371) and fb7ad8d (job 132695312582), the TAP output stops after `test/host-claim.test.mjs`. The runner prints files in order, and the next file is `test/hub-overview.test.mjs`. At the cancel, both jobs still had the Chrome test's processes alive: Chrome and its helpers (plus the two `cat` relays from the `google-chrome` wrapper), both dashboards and their watchers. Passing jobs leave no orphans.
- **Reproduced locally** on Node 22.23.4 with only that test (`--test-name-pattern=Overview.in.Chrome`), about 1 run in 10. The test fails with `failureType: 'hookFailed'`, `ENOTEMPTY: directory not empty, rmdir '<tmp>/devteam-hub-ov-…'` at `hub-overview.test.mjs:130`, and the file's process then never exits: 20 s later it and both dashboard watchers are still running.
- **Cause.** `t.after` hooks run in the order they were registered, and a hook that throws skips every later hook. That holds on Node 18, 20, 22 and 24, checked with a three-hook probe. The Chrome test registers `rmSync(base)` first, then `a.stop()`, `b.stop()`, `chrome.close()` and the page closes. So the folder is removed while both dashboards are still writing into it. When that removal throws, nothing is stopped, and what was left open keeps the test process alive indefinitely: the two dashboards' stdout and stderr pipes (`startDashboard` in test/lib/kit.mjs refs both the process and its pipes), the DevTools WebSockets `p` and `q`, and the `other` HTTP server. Chrome itself is unref'd (test/lib/chrome.mjs:37-38) and doesn't hold the process, but it survives because nothing kills it. A child holding an open pipe keeps a test file alive on both 22 and 24, so the hang isn't specific to 22. It shows on 22 (and could on 24) because only those majors have the global `WebSocket` the Chrome test needs; on 18 and 20 it is skipped.
- **The same order is in the file's hub tests.** `hubMachine` and `imageKit` register their folder's removal before `startHubCmd`, `startDashboard` or the spawned dashboard registers its stop. A throwing removal there would leave a hub or dashboard running the same way.
- **On `--test-timeout`, per major** (probed with a file whose test passes but leaves a child holding a pipe open, the shape of this hang):
  - **Node 18.20.4:** rejects the flag (`bad option`, exit 9), and `--test-force-exit` too.
  - **Node 20.19.6 and 22.23.4:** the flag caps each whole file's process; at the limit the runner kills it and names the file (`not ok - <file>`, `test timed out after N ms`).
  - **Node 24.14.1:** it caps each top-level test (supervisor m-20261115-050643117: kit.test.mjs is one of about 180 s), but never ends a file whose tests have finished while a child holds it open.
  - `--test-force-exit` ends such a file on 20 to 24, but the run passes, so the leak is hidden.
  - The longest file, dashboard.test.mjs, takes about 400 s, so the value is 600000 where the flag exists.
- **Healthy step times** (the last 15 green test.yml runs): the slowest test step is 429 s (`kit (24, rest)`); the slowest chain step is 236 s (`kit (18, chain)`); bounds takes under 10 s. A 12-minute step limit (720 s) clears the slowest by about 1.7×, and the 600 s per-file limit fires first on 20, 22 and 24, so the file is named before the step is stopped.

## Acceptance checks (the done-whens)

1. A hung test ends the job in minutes on every major, and the log names it (ruling m-20261115-051541126):
   - every `node --test` step in the `kit` job (chain, bounds, rest) passes `--test-timeout=600000` on Node 20, 22 and 24, through a matrix value, and nothing on 18, which rejects the flag;
   - every test step has `timeout-minutes: 12`, on every major;
   - a step that runs only on failure lists the processes still alive (pid, age, command), so a leaked dashboard, hub or Chrome names its test by its tmp folder;
   - no `--test-force-exit`.

   Check: on the PR's CI every job passes (Node 18 accepts the steps; no healthy file reaches either limit). The per-major behaviour above is recorded in verification.md from the probes.
2. The hanging test is fixed, and the cause is in the PR. Every test in `test/hub-overview.test.mjs` cleans up through one ordered cleanup:
   - steps run last-registered-first, so processes are stopped before the folders they write into are removed;
   - every step runs even if an earlier one throws;
   - the first error is rethrown, so the test still fails on a real cleanup error.

   Check: a run of the file on Node 22 passes. A committed test in the file calls the helper with a throwing first step and checks the order, that every step ran, and that the first error is rethrown. A temporary injected failure in the Chrome test's first-registered step (removing `base`) still leaves no dashboard, hub, watcher or Chrome process alive, and the file exits; that is shown once in verification and not committed.
3. Three consecutive CI runs of the job on the PR pass, and no other job slows (job durations compared against the recent main runs in verification.md).
4. No file outside `test/` and `.github/workflows/test.yml` changes, apart from this ticket's records under `docs/devteam-dev/tickets/kit-230-node22-hang/`.

## Approaches considered

- **A. An ordered cleanup local to the file (chosen).** One `cleanup(t)` helper in hub-overview.test.mjs. On first use it registers a single `t.after` that runs the steps registered so far in reverse, each in its own try/catch, then rethrows the first error. A step registered after that hook has started runs at once (a `t.after` added then would never run), and each step is bounded by a timeout of its own (30 s), so one that never settles can't block the rest. The helpers and tests register through it instead of calling `t.after` directly. This fixes the order and the skipping for every test in the file, and changes nothing outside it.
- **B. Make the removal never throw (try/catch around `rmSync`).** Later hooks would run, but the folder is still removed before the processes stop, so it's left behind in tmp, and a different throwing hook would still skip the rest.
- **C. Register the removal after the stops.** This fixes this order but stays fragile: a test that fails before reaching that line never removes its folder, and any other throwing hook still skips the rest.
- **D. A shared helper in `test/lib/kit.mjs`, used by every file with the pattern** (dashboard, speed and operator-threads tests too). That is the full fix, but it is outside this ticket's touches and overlaps other tickets on those files. Ruled out of this ticket: the supervisor gives that pattern to the tests-light goal (m-20261115-050956047).

## Contracts

None provided or consumed: test code and CI configuration only.

## Edge cases

- A test that fails before Chrome or a dashboard starts: only the steps registered so far run.
- `chrome.close()` and `stop()` are already idempotent and bounded (SIGKILL fallbacks); the 30 s per-step bound keeps that true for any later step.
- A test that times out while its body is still running: the body can still register steps after cleanup has started, so those run at once rather than being dropped.
- The cleanup must not wait on a process that is already gone: the existing stop helpers check `exitCode` and `signalCode` first.

## Out of scope

- The same pattern in dashboard.test.mjs, speed.test.mjs and operator-threads.test.mjs (to tests-light, m-20261115-050956047).
- Replacing the runner (the tests-light goal, kit-209 to kit-218).

## Rulings

- m-20261115-044739898 (supervisor): touches start as `.github/workflows/test.yml` only; name the hanging test file in a design-change.
- m-20261115-050956047 (supervisor, on design-change m-20261115-050850201): `test/hub-overview.test.mjs` added to touches; this ticket now follows kit-50 (its build waits for kit-50's merge). Fix only that file; the pattern in the dashboard, speed and operator-threads tests goes to tests-light.
- m-20261115-050252206 (supervisor): on Node 20 and 22, `--test-timeout` applies per file; set it above the longest file, for example 600000.
- m-20261115-050643117 (supervisor): on Node 24 it also caps a top-level test; never less than 600000.
- m-20261115-051541126 (supervisor, on design-change m-20261115-051533609, after spec review F1/F2): `--test-timeout=600000` on 20, 22 and 24 only; `timeout-minutes: 12` on every test step; a failure-only step listing leftover processes; no `--test-force-exit`. Confirm 12 minutes clears the slowest healthy job on every major with margin (done above: 429 s max).
