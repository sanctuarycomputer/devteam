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

- `node test/run.mjs [file…]` runs the named files, or every `test/*.test.mjs` (directly under `test/`). Each file runs as `node --test --test-reporter=tap <file>` in its own child, with cwd at the repo root. No `--test-timeout` is passed: the file watchdog is the hang guard.
- **Output.** A file's TAP is buffered and printed whole when it ends, under a header line naming the file, so files running side by side don't interleave. The run ends with a summary: a header line with the file count and the concurrency (`concurrency 2`), then a table with a row per file (and per run, under `--repeat`): file, seconds, result. Result is `ok`, `failed (exit N)`, `timed out`, plus `near timeout` when the file took over 5/6 of its timeout, and the run number under `--repeat`. Each failing file is also named on a `failed: <file>` line.
- **Exit code.** 0 only when every chosen file's child exited 0 on every run. Non-zero for a failing test, a file that throws on import, a file whose process exits non-zero with every test passing, a timeout, an interrupt, a bad flag or a named file that doesn't exist (exit 2 for usage errors).
- **Concurrency.** `--concurrency n` over `DEVTEAM_TEST_CONCURRENCY` over 2. Files in the `alone` group run one at a time before any other file of the invocation.
- **Per-file temp.** Each file's child gets `TMPDIR` = a fresh scratch folder (`mkdtemp` of `/tmp/dtr-` when `/tmp` is a writable directory, else of `os.tmpdir()`), and `DEVTEAM_TEST_SHARED_TMP` = the shared temp dir: the parent's own `DEVTEAM_TEST_SHARED_TMP` when set (a run nested in a run shares its parent's), else `os.tmpdir()`.
- **Shared tmux shim.** Once per run, `run.mjs` writes its own shim to `<shared>/devteam-test-tmux-shim-run-<hash>/tmux` (written to a temp name and renamed, never removed; skipped when it already holds the marker). Same refusal rule as `lib/kit.mjs`'s: it execs the real tmux only while `TMUX_TMPDIR` matches `*/dt-tmux-*` and is an existing directory, else prints `tmux refused: TMUX_TMPDIR (…) is not an existing private test directory` and exits 1. The real tmux is the first `tmux` on `PATH` that isn't a shim (by the marker). Its directory goes first on each child's `PATH`; `lib/kit.mjs` then puts its per-file shim in front at import, so a test process sees kit's shim, then the runner's, then the real tmux. `lib/kit.mjs` is unchanged.
- **Watchdog and cleanup.** `--file-timeout s` sets every file's timeout. Without it: 600 s for `chain`, 600 s for files in a short list in `run.mjs` (today `test/dashboard.test.mjs`; kit-210 removes it), 300 s for the rest. When a file's timeout passes, the runner cleans it up and records `timed out: <file> after <s> s (last test finished: <name>)`, where `<name>` is from the last `ok`/`not ok` line its TAP printed (`none` when there was none). Cleanup, in order:
  1. **Tree.** Snapshot `ps -A -o pid=,ppid=`, take every descendant of the child (by parent pid; this reaches detached children with process groups of their own), and send each SIGSTOP. Snapshot again, and again, adding new descendants of any known pid and stopping them, until a snapshot finds no new pid. Then SIGKILL them all.
  2. **tmux.** Every socket under the scratch folder (a recursive walk) gets `<real tmux> -S <socket> kill-server`, with a short timeout.
  3. **Folder.** Remove the scratch folder.

  A file that ends on its own gets steps 2 and 3. On SIGINT or SIGTERM, `run.mjs` starts no more files, cleans up every running file with steps 1 to 3, prints `interrupted`, and exits non-zero (130 or 143).
- **Groups.** `--group a[,b…]` keeps the files in any of the named groups, by rule: `chain` is `kit.test.mjs`; `alone` is a list in `run.mjs` (today `bounds.test.mjs`); `chrome` is a file whose source imports `./lib/chrome.mjs` (an `import … from './lib/chrome.mjs'` or `import('./lib/chrome.mjs')`); `rest` is every other file. An unknown group name is a usage error.
- **Shards.** `--shard i/n`, n from 1 to 4, i from 1 to n (else a usage error). The chosen files are dealt greedily: heaviest first (ties by path), each to the shard with the least total weight so far (ties to the lowest index). Weights come from `test/timings.json`; a file it doesn't list gets the median of the listed weights of the chosen files (or 1 when there are none). The shard's files run in that order, heaviest first.
- **`--list`** prints each chosen file (after groups and shard) with its group and timeout, and runs nothing.
- **`--repeat n`** runs every chosen file n times (all files' run 1, then run 2, …). A failure on any run fails the run, and its row names the run.
- **`--timings out.json`** writes `{ "run": <$GITHUB_RUN_ID or null>, "files": { "test/<f>.test.mjs": <wall seconds> } }`, the shape `test/timings.json` has (with `repeat`, the longest of a file's runs).
- **Importable.** The pure parts (`groupOf`, `shard`, `parseTap`'s last-finished name, the option parser) are exported, and the command runs only when `run.mjs` is the entry point, so `run.test.mjs` can test them directly.

**`test/lib/ports.mjs`, `test/lib/cli-runner.mjs`.** Each reads `process.env.DEVTEAM_TEST_SHARED_TMP || os.tmpdir()` for its shared folder (port locks; compile cache). `cli-runner.mjs` reads it at startup, before it swaps in the env a test passes. No other change.

**`test/timings.json`.** `{ "run": "<id>", "source": "<how it was read>", "files": { … } }`: wall seconds per file for every `test/*.test.mjs` at main, from the `duration_ms` of each file's top-level TAP line in a CI run on main no older than 43670286370 (the slowest of the Node majors per file). The script that extracts it is kept in this ticket's folder.

**`test/run.test.mjs` and `test/fixtures/run/`.** Fixtures are named `*.mjs`, never `*.test.mjs`, so no discovery picks them up: a passing file, a failing one, one that throws on import, one that exits non-zero with every test passing, one that fails only on its second run (a counter in a dir the test names by env), a hanging one (a passing test first, then a detached child in its own group and a tmux server started through `lib/kit.mjs`, their pids written out, then a hang), one that leaves a survivor (a grandchild orphaned before cleanup, which later runs `tmux` and writes its exit code and stderr), and a port fixture (claims a block, writes it, holds a moment).

## Acceptance checks (the done-whens)

1. `node test/run.mjs test/search.test.mjs` prints its TAP under the file name, a summary (file, seconds, result, concurrency) and exits 0; on Node 18, 20, 22 and 24 (local runs of `run.test.mjs` on each, and CI).
2. Exit code: non-zero, naming the file, for the failing, throwing and exit-non-zero fixtures; 0 only when every child exited 0.
3. Per-file temp: a fixture sees `TMPDIR` under `/tmp/dtr-` and `DEVTEAM_TEST_SHARED_TMP` = the real temp dir; ports.mjs's lock dir and cli-runner's compile cache use the shared dir (cli-runner read before the env swap); two port fixtures at once claim distinct blocks.
4. Shim: the runner's shim is in the shared dir, behind kit's per-file shim on a child's `PATH`; `lib/kit.mjs` is unchanged; after a timed-out file's scratch folder is removed, the survivor's `tmux` call exits 1 with `tmux refused`.
5. Timeout: the hanging fixture under `--file-timeout 5` is stopped, killed (it and its detached child dead by pid), its tmux server dead (by pid, and `has-session` fails), its folder gone, and `timed out: <file> after 5 s (last test finished: <the passing test>)` printed; exit non-zero.
6. SIGINT and SIGTERM to `run.mjs` during the hanging fixture: same cleanup by pid, `interrupted`, non-zero exit. A file ending on its own has its tmux servers killed and folder removed.
7. Defaults: `--list` shows 600 s for `kit.test.mjs` and `dashboard.test.mjs`, 300 s for others; a file past 5/6 of its timeout is flagged `near timeout`; no `--test-timeout` in the child's argv; concurrency `--concurrency` over `DEVTEAM_TEST_CONCURRENCY` over 2, shown in the summary.
8. Groups and shards: `kit.test.mjs` chain, `bounds.test.mjs` alone, `dashboard.test.mjs` chrome, `search.test.mjs` rest; `--shard i/n` for n=1..4 covers each chosen file exactly once (union of `--list` outputs), greedy on weights, median for unlisted, refuses `0/2` and `3/2`; `--list` runs none; `--repeat 3` names the failing run; `--timings` writes the shape.
9. `test/timings.json` lists every `test/*.test.mjs` at main, with its run id; `test.yml` green on every job at the PR head.

## Edge cases

- A file that exits between a snapshot and its SIGSTOP: its children reparent; they were in the snapshot already (if seen) and are stopped by pid. One never seen is orphaned outside the tree: it is refused tmux (the shared shim) and loses its temp files, but may run on. That is the design's stated limit.
- `ps` fails (no `ps`): the runner still SIGKILLs the child itself and removes the folder, and says the tree walk failed.
- No tmux on the machine: step 2 is skipped; the shim prints its refusal for any call.
- Nested runs (`run.test.mjs` under `run.mjs`): the shared dir passes down, so port locks and shims stay shared.
- `--shard` with more shards than files: an empty shard runs nothing and exits 0.
- Kill only pids found under the child: never a process group by number, never by name.

## Out of scope

README and `operator.md` (kit-218); `test.yml` (kit-215); splitting files (kit-210 to kit-212); `lib/kit.mjs`; Windows.

## Contracts

None provided or consumed across components (the design: no interface crosses a component boundary).

## Rulings

None yet.
