Splits the five slow test files into 18 files of one subject each, so that no file takes over 60 s and no test over 30 s on its own on a CI runner (story TESTS-S2). It also fixes the after hooks in pane-question and operator-threads, so a failed folder removal can no longer leave a dashboard, Chrome or a child running.

## What changed

- `test/machine.test.mjs` becomes `machine.{run-folder,status,tell,hub-records,box,box-pins}.test.mjs`. `next-step`, `recovery`, `pane-question` and `operator-threads` each become three files, `test/<name>.<subject>.test.mjs`. Each has a `test/lib/<name>-fixture.mjs` that holds only the code two or more of its files share (ruling m-20261115-161102170). Each file runs on its own.
- Every test moved byte for byte, using `split.mjs` (in the ticket folder). There are 143 tests before and after, with the same names. The hand changes are all listed in `edits.mjs`:
  - The incident test's child now runs `machine.status.test.mjs`. That test dropped from 95.6 s on one main run and 62 s on another to 21.0 s alone.
  - The status test makes two fewer `machine status` calls. Each dropped call re-read a state that another call had already read, and every assertion stays.
  - Five fixed waits are now `until()` polls on the state they waited for.
  - pane-question and operator-threads get `cleanup(t)`, which runs a test's stops last-registered first, each on its own, so the folder removal runs after every stop.

## How to verify

Records are in `docs/devteam-dev/tickets/kit-211-slow-files-split/`:

- Names: `node names.mjs e8022ac HEAD machine next-step recovery pane-question operator-threads` (`names-1.md`).
- Timing: each file alone on a CI runner (Node 24, run 43738924102). The slowest file takes 36.8 s and the slowest test 21.0 s (`ci-timings-2.md`). This was measured with a temporary workflow that has since been deleted, so the net diff has none (rulings m-20261115-165039090 and m-20261115-165102445). Under test.yml's concurrency 8 the whole job runs 1.7 to 2× slower, so its per-test times measure contention (`ci-timings-1.md`).
- Hooks: `probe-run.mjs` makes `rmSync` throw (`probe-1.md`). At the base, dashboards, Chrome, a child and the standalone hub are left running. At the head, nothing is.
- Every test.yml job passes at the head.

Not in this PR, because these files are outside the touches: `test/timings.json` weights (kit-215), and the comments in `test/lib/ports.mjs` and `test/accounts.test.mjs` that name the old files.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
