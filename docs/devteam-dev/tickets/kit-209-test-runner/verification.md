# kit-209-test-runner: verification

At commit **652457fcb6a706d3429b2e260d65ded2c914dbc9**: the branch with final review 1 and 1b's fixes, merged with main at f6d12a0, the merge base. Local runs follow the box rule (ruling m-20261115-070004373-supervisor): only the files this ticket touches, one at a time, at `--test-concurrency=2`, with the `DEVTEAM_*` variables unset. GitHub CI runs the full suite and is the gate.

- **Local gates:** `docs/devteam-dev/tickets/kit-209-test-runner/gates.sh <out>` records `devteam.mjs gate test-run-node<v>` and `gate test-search-node<v>` for each major.
- **Other checks:** `docs/devteam-dev/tickets/kit-209-test-runner/checks.sh`.
- **Node versions:** 18.20.4, 20.19.6, 22.23.4 and 24.22.3 (mise installs).

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | `node test/run.mjs test/search.test.mjs` runs it as `node --test --test-reporter=tap` in its own child, prints its TAP under the file name and a summary table (file, seconds, result, concurrency), and exits 0, on Node 18 to 24 with built-ins only | `gate test-search-node<v> -- <node v> test/run.mjs test/search.test.mjs`, v = 18, 20, 22, 24. The argv is pinned by the test `childArgs`, the output shape by `a passing file` | exit 0 on all four. Output starts `# test/search.test.mjs` / `TAP version 13`, with 7 `ok` lines, then `summary: 1 file, concurrency 2` and `test/search.test.mjs  9.1 / 8.5 / 8.4 / 8.8  ok`. `run.mjs` imports only `node:` modules |
| 2 | Exit code: non-zero, naming the file, for a fixture with a failing test, one that throws on import, and one that exits non-zero with every test passing; 0 only when every child exited 0 | `run.test.mjs` › `exit codes`. It also covers a failing `todo` test, whose TAP says `not ok` while its file exits 0: the run exits 0, so the exit code is what decides | pass on 18, 20, 22, 24 (below) |
| 3 | Per-file temp: TMPDIR is a scratch folder per file (mkdtemp `/tmp/dtr-`); DEVTEAM_TEST_SHARED_TMP is the real temp dir, where `lib/ports.mjs` keeps its locks and `lib/cli-runner.mjs` its compile cache (read before the env swap); two files at once claim distinct port blocks | `run.test.mjs` › `ports.mjs keeps its locks…`, `cli-runner keeps its compile cache…` (needs Node 22.1+, so skipped on 18 and 20), `per-file temp and the shim`, `the default shared dir`, `two files at once claim distinct port blocks` | pass on all four; the compile-cache test runs on 22 and 24 |
| 4 | Shim: `run.mjs` writes its own tmux shim (same refusal rule and marker) once to the shared dir, never removed, behind `lib/kit.mjs`'s per-file shim on each child's PATH; `lib/kit.mjs` unchanged; after a scratch folder is removed, a surviving fixture process's tmux call is refused | `run.test.mjs` › `per-file temp and the shim` (PATH order, marker, mode 0755 under umask 002, reuse), `an unsafe shim is refused…`, `a file never sees the TMUX of the session…`, `a hung file is killed…, and a survivor is refused tmux` (the survivor's `tmux -V` exits 1 with `tmux refused`). `git diff --quiet f6d12a0 -- test/lib/kit.mjs` | pass on all four; `lib/kit.mjs` unchanged since the merge base: yes |
| 5 | Timeout: a hanging fixture with a detached child and a tmux server is, after `--file-timeout 5`, stopped, re-snapshotted, killed, its tmux servers killed, its folder removed, and `timed out: <file> after 5 s (last test finished: <name>)` printed; nothing alive after (by pid); the run exits non-zero | `run.test.mjs` › `a hung file is killed…`. It prints `timed out: test/fixtures/run/hang.mjs after 5 s (last test finished: first passes)`; the file, the detached child and the tmux server are dead by pid; `has-session` fails; the folder is gone; the file's port lock is freed; exit 1. The `stopTree` scripted tests cover the rest: SIGSTOP first, then SIGKILL children first and the root last; re-snapshots; zombies; a parent that died mid-walk; a pid it may not signal; ps failing partway; SIGCONT for what isn't killed | pass on all four |
| 6 | SIGINT or SIGTERM to `run.mjs` cleans up every running file the same way, prints `interrupted`, and exits non-zero (by pid); a file that ends on its own has its tmux servers killed and folder removed | `run.test.mjs` › `SIGINT to the runner's group…` (exit 130), `SIGTERM to the runner…` (exit 143), `a file that ends on its own…` (run, not skipped, also under `run.mjs` itself: final review F1) | pass on all four |
| 7 | Defaults: `--file-timeout` 600 s for chain, 300 s otherwise, 600 s for files in a short list until split (`dashboard.test.mjs`); "near timeout" past 5/6; no `--test-timeout` passed; `--concurrency` over `DEVTEAM_TEST_CONCURRENCY` over 2 | `checks.sh`: `node test/run.mjs --list` prints kit 600, dashboard 600, bounds 300, search 300, hub-overview 300. `run.test.mjs` › `timeouts and rows`, `childArgs` (exactly `['--test', '--test-reporter=tap', f]`), `parseArgs` (2, env 3, flag 4; `--file-timeout` capped at 86400) | as stated; pass on all four |
| 8 | Groups and shards: `--group` takes a comma list of chain, alone, chrome, rest; `--shard i/n` (n=1..4) covers each chosen file once, greedy on `test/timings.json`, median if unlisted, refuses i outside 1..n; `--list` runs none; `--repeat 3` reports the failing run; `--timings out.json` writes wall seconds in timings.json's shape | `checks.sh`: `--shard i/n` for n = 1, 2, 3, 4 lists every one of the 49 files exactly once; `--shard 3/2` exits 2. `run.test.mjs` › `groups by rule`, `shards cover each file once and balance`, `alone files run first…`, `--list prints the plan and runs nothing`, `--list runs nothing`, `--repeat 3 names the failing run`, `--timings writes wall seconds`, `--timings keeps the longest…`, `an empty shard` | as stated; pass on all four |
| 9 | `test/timings.json` weighs every `test/*.test.mjs` at main, from CI run 43670286370 or later (run id in the file); test.yml green on every job at the PR head | `checks.sh`: the file lists exactly the 48 `test/*.test.mjs` at the merge base f6d12a0. Its source is run 43691440933, a green push run on main at 23b0cdd with the same file set. CI: `devteam.mjs gate ci -- gh pr checks 257 --watch` | file: yes. CI at 652457f: run 43696900688 green on all 8 jobs; `gate ci` passed in 456.9 s on attempt 2 (below) |

## Local runs of `test/run.test.mjs` (gates `test-run-node<v>`) at 652457f

| Node | Pass | Fail | Skipped | Time |
|---|---|---|---|---|
| 18.20.4 | 37 | 0 | 1 (compile cache, Node 22.1+) | 15.3 s |
| 20.19.6 | 37 | 0 | 1 (same) | 14.7 s |
| 22.23.4 | 38 | 0 | 0 | 15.1 s |
| 24.22.3 | 38 | 0 | 0 | 15.3 s |

`run.test.mjs` also ran under `run.mjs` itself, with `DEVTEAM_TEST_CONCURRENCY=3`: 38 pass, 0 skipped. That is final review F1 and F2's case. The test file as it was at 3bc9d6d skipped the tmux test and failed `a passing file` there.

Across this ticket's runs the box's load ranged from 6 to 54, and the same file took up to 49 s at the high end. After every run, `ps` showed no fixture process (`hang.mjs`, `dtr-fixture`, `survivor.mjs`), and `/data/home/tmp/devteam-kit-ports` held no lock of a killed pid.

## CI at 652457f (run 43696900688, `devteam.mjs gate ci -- gh pr checks 257 --watch`)

| Job | Result | Time | `run.test.mjs` in it |
|---|---|---|---|
| kit (18, chain) | pass | 2m52s | |
| kit (18, rest) | pass | 6m9s | 25.2 s |
| kit (20, chain) | pass | 3m46s | |
| kit (20, rest) | pass | 5m47s | 24.3 s |
| kit (22, chain) | pass | 3m50s | |
| kit (22, rest) | pass (attempt 2) | 7m22s | 28.2 s |
| kit (24, chain) | pass | 2m48s | |
| kit (24, rest) | pass | 7m41s | not printed as TAP (Node 24's spec reporter) |

- **The `run.test.mjs` times** are the sum of its top-level tests' `duration_ms` in each job's log, read with `timings-from-ci.mjs`. Each is under the 45 s budget and the 60 s per-file cap. In CI, `run.test.mjs` shares the runner with 8 files at once.
- **Attempt 1 of `kit (22, rest)` failed in `dashboard.test.mjs`.** The failing test was "presses: the page answers before the server", with "Promise resolution is still pending but the event loop has already resolved", and the file's 39 later tests were then cancelled by their parent. That is one of the known flaky Chrome tests on main (the design; kit-214 steadies them). This PR touches no file `dashboard.test.mjs` imports, and the same job passed at 7f12392 and c8eaf08. It is logged as observation o-20261115-090600330, and only that job was re-run.
- **An earlier head, 7f12392,** was green on all 8 jobs on the first attempt (run 43694836147).

## Rulings and notes

- **Merge base, not main's tip** (m-20261115-072318670-supervisor, P4-4): "at main" means the merge base. `test/run.test.mjs`, new here, isn't in `test/timings.json` and takes the median weight until kit-217 refreshes the file.
- **The `a passing file` test** runs `test/browser-contract.test.mjs`, the quickest real kit file, to keep `run.test.mjs` inside its time budget. Done-when 1's exact command on `search.test.mjs` is the gate row above.
- **Port locks** (o-20261115-081716305, m-20261115-081721807-supervisor): the runner frees the port locks of the pids it SIGKILLs, and never a lock whose owner is alive. Both are tested: the hang, SIGINT and SIGTERM tests check that the killed file's lock is gone. `freeLocks frees only…` covers live owners, including pid 1, which answers EPERM.
- **A pipe held open** (T3-4): `node --test <file>` itself waits for its test process's stdout to close. A leftover that holds it keeps the file running until its watchdog, and the runner can't change that.
- **What the kill rule doesn't defend** (final review B1): a pid that exits and is reused by an unrelated process in the milliseconds between a snapshot and its SIGSTOP. That takes a wrap of pid_max (4,194,304 here), and stopTree's comment names it.
- **Deferred to beta:** nothing.
