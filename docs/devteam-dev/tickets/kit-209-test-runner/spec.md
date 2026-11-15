# kit-209-test-runner: spec

One command runs the kit tests: `node test/run.mjs`, a file per process, a watchdog per file, groups and weighted shards.

Feature `tests-light` (story TESTS-S1), design `project/designs/devteam-s-tests-are-light-fast-and-easy-.md` in devteam-dev (the "One runner" and "Cleanup" sections are this ticket). Risk high: once kit-215 lands, this exit code decides every kit merge, and it kills process trees on shared machines.

## Intent

Today the documented way to run the kit's tests is `node --test --test-concurrency=8` over every file. That loads a shared box, and a hung file holds a CI job until its 30-minute limit, with nothing naming it. The runner makes a local run light by default (2 files at once), kills a hung file's whole tree within its watchdog, names the file and the last test it finished, and gives CI groups and weighted shards (kit-215 builds the layout on them).

## Approaches

| | Approach | Verdict |
|---|---|---|
| A | `node --test --test-shard` plus `--test-timeout` | not on Node 18; `--test-timeout` is per file on 20/22 and per test on 24 (it would time out `kit.test.mjs`'s one top-level test); no tree kill, no tmux cleanup |
| B | **A small runner in `test/run.mjs`: a `node --test --test-reporter=tap <file>` child per file, its own watchdog, cleanup by process tree, tmux socket and scratch folder** | **chosen** (the design's decision) |
| C | Run tests in parallel inside each file | rejected by the design: the files share hubs, fixtures and port offsets |

## What gets built

**`test/run.mjs`** (Node built-ins only, Node 18 to 24; flags documented in the comment at its top):

- `node test/run.mjs [file…]` runs the named files, or every `test/*.test.mjs` (directly under `test/`). Each file runs as `node --test --test-reporter=tap <file>` (exactly that argv after `node`, built by an exported `childArgs(file)`) in its own child, with cwd at the repo root, spawned `detached: true` so it has a process group of its own and only the runner sees a terminal's signals. No `--test-timeout` is passed: the file watchdog is the hang guard. `--test-reporter` needs Node 18.15 or later; that is the floor, said in the top comment.
- **Output.** A file ends when its child emits `exit` (not when its stdout closes: something holding the pipe can't turn a pass into a timeout); its remaining output is read for up to 2 s after. A file's TAP is buffered and printed whole when it ends, under a header line naming the file, so files running side by side don't interleave. The run ends with a summary: a header line with the file count and the concurrency (`concurrency 2`), then a table with a row per file (and per run, under `--repeat`): file, seconds, result. Result is `ok`, `failed (exit N)`, `failed (signal SIGx)`, `timed out`, plus `near timeout` when the file took over 5/6 of its timeout, and the run number under `--repeat`. Each failing file is also named on a `failed: <file>` line.
- **Exit code.** 0 only when every chosen file's child exited 0 on every run. Non-zero for a failing test, a file that throws on import, a file whose process exits non-zero with every test passing, a timeout, an interrupt, a bad flag or a named file that doesn't exist (exit 2 for usage errors).
- **Concurrency.** `--concurrency n` over `DEVTEAM_TEST_CONCURRENCY` over 2. Files in the `alone` group run one at a time before any other file of the invocation.
- **Per-file temp.** Each file's child gets `TMPDIR` = a fresh scratch folder (`mkdtemp` of `/tmp/dtr-` when `/tmp` is a writable directory, else of `os.tmpdir()`), and `DEVTEAM_TEST_SHARED_TMP` = the shared temp dir: the parent's own `DEVTEAM_TEST_SHARED_TMP` when set (a run nested in a run shares its parent's), else `os.tmpdir()`.
- **Shared tmux shim.** Once per run, `run.mjs` writes its own shim to `<shared>/devteam-test-tmux-shim-run-<hash>/tmux` (written to a temp name and renamed, never removed; skipped when it already holds the marker). Same refusal rule as `lib/kit.mjs`'s: it execs the real tmux only while `TMUX_TMPDIR` matches `*/dt-tmux-*` and is an existing directory, else prints `tmux refused: TMUX_TMPDIR (…) is not an existing private test directory` and exits 1. The real tmux is the first `tmux` on `PATH` that isn't a shim (by the marker). Its directory goes first on each child's `PATH`; `lib/kit.mjs` then puts its per-file shim in front at import, so a test process sees kit's shim, then the runner's, then the real tmux. `lib/kit.mjs` is unchanged.
- **Watchdog and cleanup.** `--file-timeout s` sets every file's timeout. Without it: 600 s for `chain`, 600 s for files in a short list in `run.mjs` (today `test/dashboard.test.mjs`; kit-210 removes it), 300 s for the rest. When a file's timeout passes, the runner cleans it up and records `timed out: <file> after <s> s (last test finished: <name>)`, where `<name>` is from the last `ok`/`not ok` line its TAP printed (`none` when there was none). Cleanup, in order:
  1. **Tree.** Only while the child hasn't emitted `exit` (once it has, its pid may be reaped and reused, and no walk runs). The child's own pid is stopped first (SIGSTOP). Then snapshot `ps -A -o pid=,ppid=,stat=`, and SIGSTOP every pid whose parent is a pid this walk has stopped (this reaches detached children with process groups of their own); snapshot again and repeat until a snapshot finds no new pid. Then SIGKILL exactly the pids this walk stopped that the final snapshot still shows stopped (state `T`): a stopped process can't exit, so its pid can't have been reused. The walk is an exported function, `stopTree(root, { snapshot, signal })`, with the snapshot and the signal sender injectable for tests.
  2. **tmux.** A hand-written walk of the scratch folder (`readdir` with `withFileTypes`, descending only into real directories, never a symlink; recursive `readdir` is Node 18.17+) finds `isSocket()` entries whose real path is still under the scratch folder; each gets `<real tmux> -S <socket> kill-server`, with a short timeout.
  3. **Folder.** Remove the scratch folder.

  A file that ends on its own gets steps 2 and 3. On SIGINT, SIGTERM or SIGHUP (a dropped ssh session: detached children no longer die with the terminal), `run.mjs` starts no more files, cleans up every running file with steps 1 to 3, prints `interrupted`, and exits non-zero (128 + the signal's number). A runner killed with SIGKILL leaves its files running; nothing can catch that.
- **Groups.** `--group a[,b…]` keeps the files in any of the named groups, by rule: `chain` is `kit.test.mjs`; `alone` is a list in `run.mjs` (today `bounds.test.mjs`); `chrome` is a file whose source imports `./lib/chrome.mjs` (an `import … from './lib/chrome.mjs'` or `import('./lib/chrome.mjs')`); `rest` is every other file. An unknown group name is a usage error.
- **Shards.** `--shard i/n`, n from 1 to 4, i from 1 to n (else a usage error). The chosen files are dealt greedily: heaviest first (ties by path), each to the shard with the least total weight so far (ties to the lowest index). Weights come from `test/timings.json`; a file it doesn't list gets the median of the listed weights of the chosen files (or 1 when there are none). The shard's files run in that order, heaviest first.
- **`--list`** prints each chosen file (after groups and shard) with its group and timeout, and runs nothing.
- **`--repeat n`** runs every chosen file n times (all files' run 1, then run 2, …). A failure on any run fails the run, and its row names the run.
- **`--timings out.json`** writes `{ "run": <$GITHUB_RUN_ID or null>, "files": { "test/<f>.test.mjs": <wall seconds> } }`, the shape `test/timings.json` has (with `repeat`, the longest of a file's runs).
- **Importable.** The pure parts (`groupOf`, `shard`, `parseTap`'s last-finished name, the option parser) are exported, and the command runs only when `run.mjs` is the entry point, compared by real path (`fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)`: a checkout reached through a symlink must still run, never exit 0 having run nothing), so `run.test.mjs` can test them directly.

**`test/lib/ports.mjs`, `test/lib/cli-runner.mjs`.** Each reads `process.env.DEVTEAM_TEST_SHARED_TMP || os.tmpdir()` for its shared folder (port locks; compile cache). `cli-runner.mjs` reads it at startup, before it swaps in the env a test passes. `ports.mjs` also exports the lock folder as `LOCK_DIR`, so a test can see where the lock is. No other change.

**`test/timings.json`.** `{ "run": "<id>", "source": "<how it was read>", "files": { … } }`: seconds per file for every `test/*.test.mjs` at main, from every job's log of a CI run on main no older than 43670286370. Node prints no per-file line when it runs many files, so the script (kept in this ticket's folder, `timings-from-ci.mjs`) matches each top-level test's name to the file that declares it, sums that file's top-level `duration_ms`, and takes the largest across jobs; it lists any name it can't match and any file it has no time for, and both lists must be empty. "Every file at main" is checked at the merge by re-running the script's file list against the merged tree (a verification row), never by a permanent test: a new file must never break the suite.

**`test/run.test.mjs` and `test/fixtures/run/`.** Fixtures are named `*.mjs`, never `*.test.mjs`, so no discovery picks them up: a passing file, a failing one, one that throws on import, one that exits non-zero with every test passing, one that fails only on its second run (a counter in a dir the test names by env), a hanging one (a passing test first, then a detached child in its own group and a tmux server started through `lib/kit.mjs`, their pids written out, then a hang), one that leaves a survivor (a grandchild orphaned before cleanup that waits for its scratch folder to go, then runs `tmux -V`, writes its exit code and stderr, and exits; it also exits on its own after 30 s: it is outside the tree, so nothing else ends it), and a port fixture (imports `lib/ports.mjs`, writes `LOCK_DIR` and its block, holds a moment). `run.test.mjs` aims to finish in under 40 s on CI (the 60 s per-file cap), with margins on any timing assertion that hold on a loaded runner.

## Acceptance checks (the done-whens)

1. `node test/run.mjs test/search.test.mjs` prints its TAP under the file name, a summary (file, seconds, result, concurrency) and exits 0; on Node 18, 20, 22 and 24 (local runs of `run.test.mjs` on each, and CI).
2. Exit code: non-zero, naming the file, for the failing, throwing and exit-non-zero fixtures; 0 only when every child exited 0.
3. Per-file temp: a fixture sees `TMPDIR` under `/tmp/dtr-` and `DEVTEAM_TEST_SHARED_TMP` = the real temp dir. With a fresh folder as `DEVTEAM_TEST_SHARED_TMP` given to `run.mjs` (which passes its parent's value down): the port fixture's `LOCK_DIR` is `<shared>/devteam-kit-ports` and its `<block>.lock` there holds its pid while it runs, with no `devteam-kit-ports` in its scratch folder; on Node 22.1+, a `runNode` call whose env has a different `TMPDIR` writes its compile cache under `<shared>/devteam-kit-compile-cache` (both fail on today's code); two port fixtures at once claim distinct blocks.
4. Shim: the runner's shim is in the shared dir, behind kit's per-file shim on a child's `PATH`; `lib/kit.mjs` is unchanged; after a timed-out file's scratch folder is removed, the survivor's `tmux` call exits 1 with `tmux refused`.
5. Timeout: `stopTree` with scripted snapshots stops every pid (the root first) before any SIGKILL, stops and kills a pid that first appears in a later snapshot, ends on the first snapshot with no new pid, and never kills a pid the final snapshot doesn't show stopped. The hanging fixture under `--file-timeout 5` is stopped, killed (it and its detached child dead by pid), its tmux server dead (by pid, and `has-session` fails), its folder gone, and `timed out: <file> after 5 s (last test finished: <the passing test>)` printed; exit non-zero.
6. SIGINT to `run.mjs`'s process group (as a terminal sends it), and SIGTERM to its pid, during the hanging fixture: same cleanup by pid, `interrupted`, non-zero exit. A file ending on its own has its tmux servers killed and folder removed.
7. Defaults: `--list` shows 600 s for `kit.test.mjs` and `dashboard.test.mjs`, 300 s for others; a file past 5/6 of its timeout is flagged `near timeout`; `childArgs(f)` is exactly `['--test', '--test-reporter=tap', f]`; concurrency `--concurrency` over `DEVTEAM_TEST_CONCURRENCY` over 2, shown in the summary.
8. Entry point: `run.mjs` run through a symlinked path runs a failing fixture and exits non-zero. Groups and shards: `kit.test.mjs` chain, `bounds.test.mjs` alone, `dashboard.test.mjs` chrome, `search.test.mjs` rest; `--shard i/n` for n=1..4 covers each chosen file exactly once (union of `--list` outputs), greedy on weights, median for unlisted, refuses `0/2` and `3/2`; `--list` runs none; `--repeat 3` names the failing run; `--timings` writes the shape.
9. `test/timings.json` lists every `test/*.test.mjs` at main, with its run id; `test.yml` green on every job at the PR head.

## Edge cases

- A file that exits between a snapshot and its SIGSTOP: its children reparent; they were in the snapshot already (if seen) and are stopped by pid. One never seen is orphaned outside the tree: it is refused tmux (the shared shim) and loses its temp files, but may run on. That is the design's stated limit.
- `ps` fails (no `ps`): the runner still SIGKILLs the child itself and removes the folder, and says the tree walk failed.
- No tmux on the machine: step 2 is skipped; the shim, like `lib/kit.mjs`'s, refuses (exit 1) when `TMUX_TMPDIR` is not a live private dir, and otherwise execs `tmux-not-installed` (exit 127). The tmux parts of the timeout and survivor checks skip when tmux is missing.
- Nested runs (`run.test.mjs` under `run.mjs`): the shared dir passes down, so port locks and shims stay shared.
- `--shard` with more shards than files: an empty shard runs nothing and exits 0.
- Kill only pids this walk stopped and still sees stopped: never a process group by number, never by name.
- TAP: the last-finished name is the deepest last `ok`/`not ok` line's description, `# SKIP`/`# TODO` directives stripped, never a per-file wrapper's line (a description equal to the file's path).

## Out of scope

README and `operator.md` (kit-218); `test.yml` (kit-215); splitting files (kit-210 to kit-212); `lib/kit.mjs`; Windows.

## Contracts

None provided or consumed across components (the design: no interface crosses a component boundary).

## Rulings

None yet.
