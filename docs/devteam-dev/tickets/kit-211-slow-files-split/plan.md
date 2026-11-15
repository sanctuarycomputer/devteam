# kit-211 plan

## TL;DR

- Five test files become 18 parts, `test/<name>.<subject>.test.mjs`, plus five `test/lib/<name>-fixture.mjs` files that hold only the code two or more parts share (ruling m-20261115-161102170).
- `split.mjs` (this folder) makes every split mechanically. Each test moves byte for byte, in order, and imports are recomputed with eslint, so no test or assertion can be dropped by hand. `names.mjs` proves it (143 tests before and after).
- Every hand change after the split is an exact replacement in `edits.mjs`. Those changes are the incident test's target file, two merged `machine status` reads, five fixed waits turned into `until()` polls, and the cleanup hooks.
- pane-question and operator-threads get `cleanup(t)` in their fixtures: stops run last-registered first, each in its own try/catch, so `F.done()` runs after every stop.
- `probe.mjs` (this folder) proves the hooks. It makes `rmSync` throw, then checks every spawned pid before any exit listener runs, at the base and at the head.
- Locally each part runs alone, one at a time, niced. CI is the gate for the 60 s and 30 s caps, read from the Node 24 job's per-test durations.
- If a test is over 30 s on CI, the numbers and options go to the supervisor before any test is split.

## Rulings

- m-20261115-161102170-supervisor: the five fixture files are in the touches. Fixtures hold only shared preamble, with no test bodies. Each part runs alone. The total test count is unchanged.

## Files

All inside the touches: `test/{machine,next-step,recovery,pane-question,operator-threads}*.test.mjs` and `test/lib/{…}-fixture.mjs`. Removed: the five original files. Tools and records live in `docs/devteam-dev/tickets/kit-211-slow-files-split/`.

## Tasks

Each task: run `split.mjs <name>` on the base's file, then `edits.mjs <name>`, then `lint.mjs` on the files it made. Its only `no-unused-vars` should be the ones already in the base (machine: `unlisted`, `sib`). Then run each part alone through the gate recorder:

`devteam.mjs gate test -- node test/run.mjs --concurrency 1 <parts…>`

The runner gives each file its own process and `TMPDIR`. Run under `nice`, one task's parts at a time. Commit, then get a task review (`reviews/task-<n>.md`, a fresh subagent).

### T1 machine (6 parts)

- Split as in the spec. Edits: the incident child targets `test/machine.status.test.mjs`; the status test's two merged reads; machine L455 (the tick-child poll by `ps`) and L1022 (the `session_created` poll).
- Check: the six parts pass alone. Record each part's time and the incident and status test times.

### T2 next-step (3 parts)

- Split (`REL_STRATEGY` stays in `strategy`; `raw` is shared). No edits. The Chrome test is in `next-step.strategy`, which imports `./lib/chrome.mjs` itself.
- Check: the three parts pass alone (the Chrome test runs where Chrome is found, and skips otherwise, as before).

### T3 recovery (3 parts)

- Split. Edits: L130 becomes `until()` the clock's second is past the session's `session_created`. L138 becomes `until()` it is past the launch's (`now`'s) second. L224 becomes `until()` the pane's `pane_current_command` isn't `node`. Each keeps the comment saying why it waits.
- Check: the three parts pass alone.

### T4 pane-question (3 parts) and its hooks

- Split. Add `cleanup(t)` to `test/lib/pane-question-fixture.mjs`:

  ```js
  // A test's stops, run last-registered first, each on its own: a removal registered first runs
  // after every stop, and one stop that throws skips none of the others (node runs t.after hooks
  // in order and stops at the first that throws). The first error is thrown once all have run.
  function cleanup(t) {
    const fns = [];
    t.after(async () => {
      let first = null;
      for (const f of fns.reverse()) { try { await f(); } catch (e) { first ??= e; } }
      if (first) throw first;
    });
    return (f) => { fns.push(f); };
  }
  ```

- Edits: every `t.after(() => F.done())` becomes `const later = cleanup(t); later(() => F.done());`. `t.after(() => live.kill())` and `t.after(() => chrome.close())` become `later(…)`. `dash(t, …)` becomes `dash(later, …)`, and its `t.after(() => d.stop())` becomes `later(() => d.stop())`. "what the card cannot answer" (try/finally, no dashboard) stays.
- Check: the three parts pass alone.

### T5 operator-threads (3 parts) and its hooks

- Split (the hub's `ask` and `hubFixture` stay in `hub`). Add the same `cleanup(t)` to `test/lib/operator-threads-fixture.mjs`.
- Edits: in `hubFixture`, `t.after(async () => { await dash.stop(); tmuxSh(kill-session) })` becomes two `later`s. `hubFixture(t, …)` takes the test's `later`, and each hub test makes one with `cleanup(t)`. The Chrome test's `t.after(() => chrome.close())` and `t.after(() => p.close())` become `later`s. In the standalone hub test, the `rmSync(imageKit)`, `a.kill()` and hub-group hooks become `later`s in the same order, so the removal runs last.
- Check: the three parts pass alone.

### T6 the hook probe

- `probe.mjs`, a preload (`node --import ./probe.mjs --test --test-name-pattern <t> <file>`):
  - `PROBE_THROW` is a path prefix (the test's fixture base, matched as a prefix of any path under `os.tmpdir()` named for the fixture). `fs.rmSync` throws for any path under it.
  - It wraps `child_process.spawn`, `execFile` and `fork`, logging each child's pid and args, then calls `syncBuiltinESMExports()`.
  - It wraps `process.emit` so that on `'exit'` it writes every logged pid still alive (`process.kill(pid, 0)`) to `PROBE_OUT`, before any exit listener runs.
- `probe.sh` runs it per test, for every pane-question and operator-threads test with an after hook: at the base (the original file) and at the head (its part). It kills any file still running after 120 s and counts that as left. It prints a table, test by base by head, of the pids left.
- Check: the head shows none left for every test. The base shows what was left (expected for the dashboard, Chrome and child tests).

### T7 verify and finish

- `names.mjs e8022ac HEAD machine next-step recovery pane-question operator-threads` gives the lists and diff for verification.md.
- Merge `origin/main` and re-run T1 to T5's checks. Push, open the PR, and read the Node 24 job's per-test durations (`durations.mjs` style, from the job log) into a per-part table. If any part's sum is over 50 s or any test is over 30 s, stop and act as the spec says (re-split the part; or, for a test, ask the supervisor).
- `verification.md`: a row per done-when with its command and result at the named commit, the fixed-wait list, and the probe table.
- Final review from a fresh subagent that hasn't seen the build; then `check-ticket`; then the merge request.
