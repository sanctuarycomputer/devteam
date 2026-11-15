# kit-230-node22-hang: spec

The Node 22 rest job never hangs to its 30-minute limit: a per-test timeout names the hanging test, and that test is fixed.

## What was found

- **Which test.** In the cancelled `kit (22, rest)` jobs on 07f7d1b (job 132671175371) and fb7ad8d (job 132695312582), the TAP output stops after `test/host-claim.test.mjs`. The runner prints files in order, and the next file is `test/hub-overview.test.mjs`. At the cancel, both jobs still had the Chrome test's processes alive: Chrome and its helpers (plus the two `cat` relays from the `google-chrome` wrapper), both dashboards and their watchers. Passing jobs leave no orphans.
- **Reproduced locally** on Node 22.23.4 with only that test (`--test-name-pattern=Overview.in.Chrome`), about 1 run in 10. The test fails with `failureType: 'hookFailed'`, `ENOTEMPTY: directory not empty, rmdir '<tmp>/devteam-hub-ov-…'` at `hub-overview.test.mjs:130`, and the file's process then never exits: 20 s later it and both dashboard watchers are still running.
- **Cause.** `t.after` hooks run in the order they were registered, and a hook that throws skips every later hook. That holds on Node 18, 20, 22 and 24, checked with a three-hook probe. The Chrome test registers `rmSync(base)` first, then `a.stop()`, `b.stop()`, `chrome.close()` and the page closes. So the folder is removed while both dashboards are still writing into it. When that removal throws, nothing is stopped, and the dashboards' and Chrome's pipes keep the test process alive indefinitely. A child holding an open pipe keeps a test file alive on both 22 and 24, so the hang isn't specific to 22. It shows on 22 (and could on 24) because only those majors have the global `WebSocket` the Chrome test needs; on 18 and 20 it is skipped.
- **The same order is in the file's hub tests.** `hubMachine` and `imageKit` register their folder's removal before `startHubCmd`, `startDashboard` or the spawned dashboard registers its stop. A throwing removal there would leave a hub or dashboard running the same way.
- **On `--test-timeout`** (supervisor rulings m-20261115-050252206 and m-20261115-050643117, and measured here on 22.23.4): on Node 18 to 22 it caps each whole test file's process, and the runner kills that process at the limit, naming the file (`not ok - <file>`, `test timed out after N ms`). On Node 24 it also caps each top-level test, and kit.test.mjs is one top-level test of about 180 s. The longest file, dashboard.test.mjs, takes about 400 s. So the value must exceed that on every version: 600000.

## Acceptance checks (the done-whens)

1. Every `node --test` run in test.yml's `kit` job (the chain, the bounds file, the rest) passes `--test-timeout=600000`. A file still running after 10 minutes is killed and named in the log, well inside the job's 30-minute limit. Check: read the workflow. On the PR's CI, every job still passes, so no legitimate file reaches the limit.
2. The hanging test is fixed, and the cause is in the PR. Every test in `test/hub-overview.test.mjs` cleans up through one ordered cleanup:
   - steps run last-registered-first, so processes are stopped before the folders they write into are removed;
   - every step runs even if an earlier one throws;
   - the first error is rethrown, so the test still fails on a real cleanup error.

   Check: a run of the file on Node 22 passes. A temporary injected failure in the first-registered step (removing `base`) still leaves no dashboard, hub, watcher or Chrome process alive, and the file exits. It is shown once in verification and not committed.
3. Three consecutive CI runs of the job on the PR pass, and no other job slows (job durations compared against the recent main runs in verification.md).
4. No file outside `test/` and `.github/workflows/test.yml` changes, apart from this ticket's records under `docs/devteam-dev/tickets/kit-230-node22-hang/`.

## Approaches considered

- **A. An ordered cleanup local to the file (chosen).** One `cleanup(t)` helper in hub-overview.test.mjs. On first use it registers a single `t.after` that runs the steps registered so far in reverse, each in its own try/catch, then rethrows the first error. The helpers and tests register through it instead of calling `t.after` directly. This fixes the order and the skipping for every test in the file, and changes nothing outside it.
- **B. Make the removal never throw (try/catch around `rmSync`).** Later hooks would run, but the folder is still removed before the processes stop, so it's left behind in tmp, and a different throwing hook would still skip the rest.
- **C. Register the removal after the stops.** This fixes this order but stays fragile: a test that fails before reaching that line never removes its folder, and any other throwing hook still skips the rest.
- **D. A shared helper in `test/lib/kit.mjs`, used by every file with the pattern** (dashboard, speed and operator-threads tests too). That is the full fix, but it is outside this ticket's touches and overlaps other tickets on those files. It is proposed as a follow-up (design-change m-20261115-050850201).

## Contracts

None provided or consumed: test code and CI configuration only.

## Edge cases

- A test that fails before Chrome or a dashboard starts: only the steps registered so far run.
- `chrome.close()` and `stop()` are already idempotent and bounded (SIGKILL fallbacks), so running every step can't hang.
- The cleanup must not wait on a process that is already gone: the existing stop helpers check `exitCode` and `signalCode` first.

## Out of scope

- The same pattern in dashboard.test.mjs, speed.test.mjs and operator-threads.test.mjs (follow-up).
- Replacing the runner (the tests-light goal, kit-209 to kit-218).

## Rulings

- m-20261115-044739898 (supervisor): touches start as `.github/workflows/test.yml` only; name the hanging test file in a design-change. Sent as m-20261115-050850201 (`test/hub-overview.test.mjs`); its ruling is pending.
- m-20261115-050252206 (supervisor): on Node 20 and 22, `--test-timeout` applies per file; set it above the longest file, for example 600000.
- m-20261115-050643117 (supervisor): on Node 24 it also caps a top-level test; use 600000 on every version, never less.
