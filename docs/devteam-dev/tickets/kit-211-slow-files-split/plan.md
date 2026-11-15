# kit-211 plan

## TL;DR

- Five test files become 18 parts, `test/<name>.<subject>.test.mjs`, plus five `test/lib/<name>-fixture.mjs` files that hold only the code two or more parts share (ruling m-20261115-161102170).
- `split.mjs` (this folder) makes every split mechanically. Each test moves byte for byte, in order, and imports are recomputed with eslint, so no test or assertion can be dropped by hand. `names.mjs` proves it (143 tests before and after).
- Every hand change after the split is an exact replacement in `edits.mjs`. Those changes are the incident test's target file, two merged `machine status` reads, five fixed waits turned into `until()` polls, and the cleanup hooks.
- pane-question and operator-threads get `cleanup(t)` in their fixtures: stops run last-registered first, each in its own try/catch, so `F.done()` runs after every stop.
- `probe.mjs` and `probe-run.mjs` (this folder) prove the hooks. `rmSync` is made to throw. Before any exit listener runs, they check every process the test started, by pid and by its folders, at the base and at the head. Then they clean up whatever was left.
- Locally each part runs alone, one at a time, niced. CI is the gate for the 60 s and 30 s caps, read from the Node 24 job's per-test durations.
- If a test is over 30 s on CI, the numbers and options go to the supervisor before any test is split.

## Rulings

- m-20261115-161102170-supervisor: the five fixture files are in the touches. Fixtures hold only shared preamble, with no test bodies. Each part runs alone. The total test count is unchanged.
- m-20261115-162630812-supervisor: approve-spec at 2cd1166.

## Files

All inside the touches: `test/{machine,next-step,recovery,pane-question,operator-threads}*.test.mjs` and `test/lib/{…}-fixture.mjs`. Removed: the five original files. Tools and records live in `docs/devteam-dev/tickets/kit-211-slow-files-split/`.

## Tasks

Each task: run `split.mjs <name>` on the base's file, then `edits.mjs <name>`, then `lint.mjs` on the files it made. Its only `no-unused-vars` should be the ones already in the base: machine's `unlisted` and `sib`, and next-step's `run` (in its fixture). Then run each part alone through the gate recorder:

`devteam.mjs gate test -- node test/run.mjs --concurrency 1 <parts…>`

The runner gives each file its own process and `TMPDIR`. Run under `nice`, one task's parts at a time. Commit, then get a task review (`reviews/task-<n>.md`, a fresh subagent).

### T1 machine (6 parts)

- Split as in the spec. Edits: the incident child targets `test/machine.status.test.mjs`; the status test's two merged reads; machine L455 (the tick-child poll by `ps`) and L1022 (the `session_created` poll).
- Check: the six parts pass alone. Record each part's time and the incident and status test times.

### T2 next-step (3 parts)

- Split (`REL_STRATEGY` stays in `strategy`; `raw` is shared). No edits. The Chrome test is in `next-step.strategy`, which imports `./lib/chrome.mjs` itself.
- Check: the three parts pass alone (the Chrome test runs where Chrome is found, and skips otherwise, as before).

### T3 recovery (3 parts)

- Split. Edits: L130 becomes `until()` the clock's second is past the session's `session_created`. L138 becomes `until()` it is past the launch's (`now`'s) second. L224 becomes `until()` the pane's `pane_current_command` is `sh`, `bash`, `dash` or `zsh` (a leading `-` allowed), not merely other than `node` (spec review N1). Each keeps the comment saying why it waits.
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
- Edits: in `hubFixture`, `t.after(async () => { await dash.stop(); tmuxSh(kill-session) })` becomes two `later`s, registered as kill-session then `dash.stop()`, so they run in the base's order: the dashboard first. `hubFixture(t, …)` takes the test's `later`, and each hub test makes one with `cleanup(t)`. The Chrome test's `t.after(() => chrome.close())` and `t.after(() => p.close())` become `later`s. In the standalone hub test, the `rmSync(imageKit)`, `a.kill()` and hub-group hooks become `later`s in the same order, so the removal runs last.
- Check: the three parts pass alone.

### T6 the hook probe

- `probe.mjs` is a preload: `node --import ./probe.mjs --test-name-pattern <re> <file>` (Node 22, which has `--import`, a WebSocket for the Chrome tests, and a name pattern without `--test`). It:
  - makes `fs.rmSync` throw for a path matching `PROBE_THROW`, the fixture folders (`devteam-pane-*-`, `devteam-image-kit-`);
  - notes the folders the test makes with `fs.mkdtempSync`: those matching `PROBE_THROW`, and every `dt-tmux-` folder after the first, which is lib/kit.mjs's for the whole file;
  - notes every child the test process starts (`spawn`, `execFile`, `fork`, `exec`, with `syncBuiltinESMExports()`);
  - wraps `process.emit`, so that on `'exit'`, before any exit listener runs, it lists every live process that is a noted child, or whose args or environment (`/proc/<pid>/environ`) name a noted folder. That covers a tmux server by its `TMUX_TMPDIR`, the agents in its panes, and a dashboard's children by their `HOME` (plan review I1). It writes them, with a summary line, to `PROBE_OUT`.
- `probe-run.mjs` runs each test that has after hooks alone, once at the base (the original file, written temporarily as `test/zz-probe-base-<name>.test.mjs` and removed afterwards) and once at the head (its part). It builds each name pattern in node, `^` plus the name with regex characters escaped, so nothing is quoted through a shell (M4). Each run has its own `TMPDIR`, and `DEVTEAM_*` and `TMUX*` unset. After each run it kills every reported process and its process group, looks again by the run's folders, and kills and reports anything still there (I2). It prints one row per test: whether the base is expected to leave processes, then the base and the head (children started, how many left, what).
- Expected at the base, where the change matters (M3): every pane-question dashboard test (`F.done()` was registered before `d.stop()`), the claims test (`live`), and the standalone hub test (`rmSync(imageKit)` before `a.kill()` and the hub's kill). The hubFixture tests remove no folder in their hooks, so they show the same at the base and the head; they're run to show the head leaves nothing.
- Check: `probe-run.mjs` exits 0. That requires every run to have run its one test, the head to leave nothing for every test, and the base to leave something for each test expected to.

### T7 verify and finish

- `names.mjs e8022ac HEAD machine next-step recovery pane-question operator-threads` gives the lists and diff for verification.md.
- Merge `origin/main`. If main changed one of the five original files, the merge is a modify/delete conflict. Then take main's version of that file, re-run `split.mjs` and `edits.mjs` on it, and re-run `names.mjs` against the merged base (M5). Re-run T1 to T5's checks, and record each part's local time from the runner's summary, its start-up and preamble included, next to its CI sum (spec AC2, M6). Push, open the PR, and read the Node 24 job's per-test durations (`durations.mjs` style, from the job log) into a per-part table. If any part's sum is over 50 s or any test is over 30 s, stop and act as the spec says (re-split the part; or, for a test, ask the supervisor). Every test.yml job must be green at the head (done-when 5).
- `verification.md`: a row per done-when with its command and result at the named commit, the fixed-wait list, and the probe table.
- Final review from a fresh subagent that hasn't seen the build; then `check-ticket`; then the merge request.
