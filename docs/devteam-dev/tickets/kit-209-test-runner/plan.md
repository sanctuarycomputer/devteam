# kit-209 test runner: implementation plan

## TL;DR

- One new file, `test/run.mjs`, plus its test `test/run.test.mjs` and fixtures in `test/fixtures/run/` (named `*.mjs`, never `*.test.mjs`); two one-line changes in `test/lib/ports.mjs` and `test/lib/cli-runner.mjs`; data in `test/timings.json`.
- Five tasks: the shared temp dir in the libs (T1); the runner's pure parts and `--list` (T2); running files with per-file temp, the shim, output, exit codes, repeat and timings (T3); the watchdog, tree kill, tmux and folder cleanup, signals (T4); `test/timings.json` from CI (T5).
- The kill rule: only pids this walk stopped and the final snapshot still shows stopped, killed deepest first, the root last; no walk once the child has exited.
- Every child is `detached: true`; the runner handles SIGINT, SIGTERM and SIGHUP.
- Tests run on Node 18, 20, 22 and 24 locally (mise installs), one file at a time at the default concurrency, never the full suite (the box rule); CI is the gate.
- Execution: inline (executing-plans) with TDD, a fresh-subagent review per task (`reviews/task-<n>.md`); the final review comes from two other sessions (risk high).
- Spec amendments from spec review 2 (F2-1 to F2-3) are below and bind the tasks.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `node test/run.mjs [files]` runs each kit test file in its own process with a watchdog, cleans up what it leaves, and groups and shards files for CI.

**Architecture:** One ES module with exported pure functions (option parsing, grouping, sharding, TAP reading, tree walk, socket walk) and a `main()` that runs only when the module is the entry point (by real path). Each file is a `node --test --test-reporter=tap <file>` child in its own process group, with `TMPDIR` set to a scratch folder and a shared dir for what outlives it.

**Tech Stack:** Node 18.15+ built-ins only (`node:child_process`, `node:fs`, `node:os`, `node:path`, `node:crypto`, `node:url`, `node:test`), `ps`, `tmux` when present.

**Spec:** `docs/devteam-dev/tickets/kit-209-test-runner/spec.md` (approved by spec review 2 at 1ffb807), the design in devteam-dev `project/designs/devteam-s-tests-are-light-fast-and-easy-.md`.

## Spec amendments (spec review 2)

- **F2-1** (as refined by plan review P1-5). SIGKILL goes in reverse stop order: the walk stops breadth-first from the root, so reversed, children go before parents and the root is last. A parent killed first can make the kernel SIGCONT an orphaned stopped group, and a child could then exit and free its pid before its own SIGKILL.
- **F2-2.** The last-finished name is the description on the last `ok`/`not ok` line in output order (any indent), with `# SKIP`/`# TODO` stripped, skipping a line whose description is the file's own path (a per-file wrapper).
- **F2-3.** `test/timings.json` per major: Node 18, 20 and 22 jobs print TAP whose top-level lines (`ok N - <name>` at column 0) carry `duration_ms`. Run 43685419235's Node 18 and 22 rest logs have no per-file wrapper line: the script matched every name, with none unmatched. Node 24's log uses the spec reporter, has no `duration_ms`, and adds nothing; `source` says so. A name declared at top level in two files is ambiguous: the script lists it and assigns it to neither, and the ambiguous list must be empty like the others, or each ambiguous name gets a row in verification.md with its time.

## Rulings

- m-20261115-070004373-supervisor: approve-spec at 6862b5a. On this box, run only the test files touched, with `--test-concurrency=2` and the `DEVTEAM_*` variables unset (`env -u DEVTEAM_RUN -u DEVTEAM_TICKET -u DEVTEAM_ROLE -u DEVTEAM_HOME -u DEVTEAM_SUPERVISOR …`); never the full suite.

## Plan review 1 changes

- **P1-1.** Every runner call in `run.test.mjs` goes through one helper, `runRunner(args, { env, deadline = 60 s })`. It spawns the runner `detached: true`, and on its deadline, and in a `t.after` hook either way, it kills the runner's group, every pid in `DTR_FIXTURE_OUT/pids.json`, and each socket listed there with `<real tmux> -S <socket> kill-server` (only sockets under `/tmp/dtr-` or the shared dir the test made). Fixtures end themselves: `hang.mjs` exits after 60 s, its detached child after 60 s, its tmux pane runs `sleep 60`, and the survivor after 30 s.
- **P1-2.** The check that `lib/kit.mjs` is unchanged is a verification.md row (`git diff --quiet <merge base> -- test/lib/kit.mjs`), never a test.
- **P1-3.** Signals land asynchronously. Once no new pid appears, `stopTree` re-snapshots (every 20 ms, up to 2 s) until every stopped pid still present shows a stat starting with `T` (`T`, `Tl`, `T+`…). It then SIGKILLs every stopped pid still present whose stat starts with `T`, plus any present whose parent in that snapshot is a stopped pid, so none is left stopped. Unit tests use real stat strings (`Tl`, `Ss`) and a pid that shows `S` in one snapshot and `T` in the next.
- **P1-4.** The scripted `stopTree` tests use pids above 4,000,000 (over Linux's `pid_max` limit), and a signal stub that never calls `process.kill`.
- **P1-5.** See F2-1 above.
- **P1-6.** A pid counts as dead when `kill(pid, 0)` throws ESRCH or `ps -o stat= -p <pid>` shows `Z`. Dead checks poll that every 100 ms for up to 5 s. Fixtures write their JSON to a temp name, then rename it.
- **P1-7.** `parseArgs` normalizes a file argument by `fs.realpathSync(arg)` relative to `fs.realpathSync(root)`. A file outside the root keeps its real absolute path.
- **P1-8.** Added tests: the summary row (`rowFor({ file, seconds, result, timeout, run })`, a pure export) carries `near timeout` past 5/6; `--group chain,alone` keeps exactly kit and bounds; `--list` over `env.mjs` writes no output file; with no `DEVTEAM_TEST_SHARED_TMP` and `TMPDIR=X`, `env.mjs` sees `X` as the shared dir; `drain(stream, ms)` (exported) resolves within ms + 1 s on a stream that never ends.
- **P1-9.** The survivor runs inside the same timed-out hang run, so there is one 5 s timeout and two signal runs. The budget is 45 s; verification.md records `run.test.mjs`'s time on each major from CI.
- **P1-10.** `ensureShim` accepts an existing shim only when its file and directory are owned by `process.getuid()` and are not writable by group or others. The directory name carries the uid: `devteam-test-tmux-shim-run-<uid>-<hash>`. Otherwise it writes a fresh one at a `mkdtemp` path.

## Global Constraints

- Node 18.15 to 24, built-ins only; no dependency, no `fs.readdirSync(…, { recursive })`, no `util.parseArgs` edge flags past 18.
- Files are named by their path from the repo root, `test/<name>.test.mjs`; the child's cwd is the repo root (`path.resolve(<dir of run.mjs>, '..')`).
- Defaults: `--file-timeout` 600 s for `chain` and `LONG` (`{ 'test/dashboard.test.mjs': 600 }`, comment "kit-210 removes it"), 300 s otherwise; concurrency `--concurrency` over `DEVTEAM_TEST_CONCURRENCY` over 2; `ALONE = ['test/bounds.test.mjs']`; near timeout is seconds > 5/6 × timeout; `--shard` n is 1..4.
- Exact strings: `timed out: <file> after <s> s (last test finished: <name|none>)`, `interrupted`, `failed: <file> (<reason>)`, the shim's `tmux refused: TMUX_TMPDIR ($TMUX_TMPDIR) is not an existing private test directory`.
- Exit codes: 0 all ok; 1 any failure or timeout; 2 usage error; 128 + signal number on interrupt.
- Kill only pids this walk stopped and still sees stopped; never a group by number or a process by name; act only on sockets whose real path is under the scratch folder.
- The top comment of `run.mjs` documents every flag.
- `lib/kit.mjs` is not changed.

## Review Focus

1. **A file whose name is given as `./test/x.test.mjs` or an absolute path.** The runner should name it `test/x.test.mjs` and run it once. T2: `parseArgs` normalizes, and a test passes both forms.
2. **A named file that doesn't exist, or a file outside `test/`.** A missing one is a usage error (exit 2, naming it), never a silent pass. A file outside `test/` runs, grouped by its source. T2 test.
3. **`--shard 1/2` on a list with one file.** One shard has it and the other is empty: exit 0 with "no files" in its summary. T2 test (shard output) and T3 (an empty run exits 0).
4. **A file that prints a lot (MBs of TAP).** It must not block on a full pipe or be lost. T3: the child's output is read as it comes, into an array of chunks, never left unread. Test: a fixture printing 2 MB passes.
5. **The runner run from another cwd, or through a symlinked checkout.** It should still find `test/` and run. T3: a test runs it with cwd `/` through a symlink to the worktree and sees a failing fixture fail.

---

### Task 1: the shared temp dir in the test libs

**Files:**
- Modify: `test/lib/ports.mjs` (the `dir` line; export `LOCK_DIR`)
- Modify: `test/lib/cli-runner.mjs` (read the shared dir at startup)
- Test: `test/run.test.mjs` (created here)

**Interfaces:**
- Produces: `export const LOCK_DIR` from `ports.mjs` = `path.join(process.env.DEVTEAM_TEST_SHARED_TMP || os.tmpdir(), 'devteam-kit-ports')`. `cli-runner.mjs` computes `const shared = process.env.DEVTEAM_TEST_SHARED_TMP || os.tmpdir()` before its env swap, and its compile cache is `path.join(shared, 'devteam-kit-compile-cache')`.

- [ ] **Step 1: failing tests** in `test/run.test.mjs`:
  - `ports.mjs keeps its locks in DEVTEAM_TEST_SHARED_TMP`: a fresh `S = mkdtemp`; spawn `node --input-type=module -e "import {LOCK_DIR,PORTS} from '<ports.mjs url>'; console.log(JSON.stringify({LOCK_DIR,PORTS,pid:process.pid, lock: fs.readFileSync(...)}))"` with env `DEVTEAM_TEST_SHARED_TMP=S`, `TMPDIR=<another fresh dir T>`; assert `LOCK_DIR === S/devteam-kit-ports`, the lock file named for its block held its pid, and `T/devteam-kit-ports` doesn't exist.
  - `cli-runner keeps its compile cache in DEVTEAM_TEST_SHARED_TMP` (skip unless `module.enableCompileCache` exists): spawn a node that imports `lib/cli.mjs`, calls `runNode(<a tiny script>, [], { env: { ...process.env, TMPDIR: T2 } })` with its own env `DEVTEAM_TEST_SHARED_TMP=S`; assert `S/devteam-kit-compile-cache` exists and `T2/devteam-kit-compile-cache` doesn't.
- [ ] **Step 2:** run `node --test test/run.test.mjs`; both fail (no `LOCK_DIR`; the cache under `T2`).
- [ ] **Step 3:** make the two changes. Update the comment at the top of `ports.mjs` to name `DEVTEAM_TEST_SHARED_TMP`.
- [ ] **Step 4:** the tests pass on Node 18 and 24 (`~/.local/share/mise/installs/node/<v>/bin/node --test test/run.test.mjs`), and `node --test test/search.test.mjs` still passes.
- [ ] **Step 5:** commit; review `reviews/task-1.md`.

### Task 2: the runner's pure parts and `--list`

**Files:**
- Create: `test/run.mjs`
- Test: `test/run.test.mjs`

**Interfaces (all exported from `test/run.mjs`):**
- `class UsageError extends Error`
- `parseArgs(argv: string[], env: object) -> { files: string[] (repo-relative; [] = all), groups: string[]|null, shard: {i,n}|null, list: bool, repeat: number, timings: string|null, concurrency: number, fileTimeout: number|null }`. Throws `UsageError` on an unknown flag, a bad number, an unknown group, a shard outside n 1..4 or i 1..n, or a named file that doesn't exist.
- `groupOf(rel: string, src: string) -> 'chain'|'alone'|'chrome'|'rest'`: chain if `rel === 'test/kit.test.mjs'`; alone if in `ALONE`; chrome if `src` matches `/^\s*import\b[^;]*?['"]\.\/lib\/chrome\.mjs['"]/m` or `/\bimport\(\s*['"]\.\/lib\/chrome\.mjs['"]\s*\)/`; else rest.
- `timeoutOf(rel, group, override: number|null) -> seconds`.
- `nearTimeout(seconds, timeout) -> bool` (seconds > timeout × 5/6).
- `weightsFor(files, timingsFiles: object) -> Map<rel, number>`: listed weight, else the median of the chosen files' listed weights, else 1.
- `shard(files, weights: Map, n) -> string[][]`: greedy, heaviest first (ties by path), to the lightest shard (ties to the lowest index); each shard keeps that order.
- `planRun(opts, root) -> [{ file, group, timeout }]`: all `test/*.test.mjs` (or `opts.files`), filtered by groups, then the shard, then ordered `alone` first (keeping shard order otherwise).
- `lastFinished(tap: string, file: string) -> string|null` (amendment F2-2).
- `childArgs(file) -> ['--test', '--test-reporter=tap', file]`.
- `isEntry(argv1, metaUrl) -> bool`: real-path comparison, false when `argv1` is missing.
- CLI: `--list` prints one line per planned file, `<file>  <group>  <timeout> s`, and exits 0.

- [ ] **Step 1: failing tests**:
  - `groups by rule`: `groupOf` on the real sources gives `kit.test.mjs` chain, `bounds.test.mjs` alone, `dashboard.test.mjs` chrome, `search.test.mjs` rest; a source with `import('./lib/chrome.mjs')` is chrome; one with the import only in a comment (`// see ./lib/chrome.mjs`) is rest.
  - `shards cover each file once and balance`: weights `{a:10,b:9,c:5,d:4,e:1}` into 2 gives `[[a,d,e],[b,c]]`; for n = 1..4 over the real file list with the real `test/timings.json` (or `{}` before T5), the shards' union equals the list with no duplicates; an unlisted file gets the median of the listed weights.
  - `parseArgs`: `--shard 0/2`, `--shard 3/2`, `--shard 1/5`, `--group nope`, `--concurrency 0` and a missing file throw `UsageError`; concurrency 2 by default, `DEVTEAM_TEST_CONCURRENCY=3` gives 3, and `--concurrency 4` over it gives 4; `./test/search.test.mjs` and its absolute path both give `test/search.test.mjs` (Review Focus 1, 2).
  - `timeouts`: `timeoutOf` gives 600 for chain and dashboard, 300 for search, and 7 for any file with an override of 7; `nearTimeout(251, 300)` is true and `nearTimeout(249, 300)` false.
  - `lastFinished`: over a TAP sample with nested subtests, a `# SKIP` line and a wrapper line naming the file, it gives the last finished line's description in output order; `none` when there are no `ok` lines (null).
  - `childArgs` is exactly `['--test', '--test-reporter=tap', f]`.
  - `--list`: `node test/run.mjs --list test/kit.test.mjs test/bounds.test.mjs test/dashboard.test.mjs test/search.test.mjs` prints bounds first and the four lines with `600 s`, `300 s`, `600 s`, `300 s`, and exits 0; `--shard 1/2 --list` and `--shard 2/2 --list` over every file together list each once; exit 2 for `--shard 3/2`.
- [ ] **Step 2:** they fail (no module).
- [ ] **Step 3:** write `test/run.mjs`: the top comment with every flag (the spec's list, Node 18.15 floor), the exports above, and `main()` handling `--list` only for now, behind `if (isEntry(process.argv[1], import.meta.url))`.
- [ ] **Step 4:** they pass on Node 18 and 24.
- [ ] **Step 5:** commit; review `reviews/task-2.md`.

### Task 3: running the files

**Files:**
- Modify: `test/run.mjs`
- Create: `test/fixtures/run/pass.mjs`, `fail.mjs`, `throws.mjs`, `exit-nonzero.mjs`, `flaky.mjs`, `env.mjs`, `ports.mjs`, `ports-2.mjs`, `tmux-ends.mjs`, `loud.mjs`
- Test: `test/run.test.mjs`

**Interfaces:**
- Consumes: T2's exports.
- Produces: `sharedDir(env) -> string` (`env.DEVTEAM_TEST_SHARED_TMP || os.tmpdir()`); `scratchDir() -> string` (`mkdtempSync('/tmp/dtr-')` if `/tmp` is a writable directory, else `mkdtempSync(path.join(os.tmpdir(), 'dtr-'))`); `ensureShim(shared, PATH) -> dir` (the spec's shim at `<shared>/devteam-test-tmux-shim-run-<sha1(text) 12 hex>/tmux`, written to a temp name and renamed, skipped when the marker is there); `realTmux(PATH) -> string` (first non-shim `tmux` on PATH, or ''); `socketsUnder(dir) -> string[]`; `cleanupAfter(entry)` (steps 2 and 3: kill each socket's server with `realTmux -S <s> kill-server`, a 5 s timeout, then `rmSync(dir, { recursive, force, maxRetries: 5 })`). Each running file is `{ file, run, child, dir, out: Buffer[], start, exited }`.
- Fixtures read `DTR_FIXTURE_OUT` (a folder the test makes) for their outputs; the runner passes its env through.

- [ ] **Step 1: failing tests** (each spawns `node test/run.mjs …` with `DTR_FIXTURE_OUT` set):
  - `a passing file`: `node test/run.mjs test/search.test.mjs` exits 0, prints its TAP after a `# test/search.test.mjs` header, and a summary with `concurrency 2` and a row `test/search.test.mjs  <s>  ok` (done-when 1).
  - `exit codes`: each of `fail.mjs`, `throws.mjs`, `exit-nonzero.mjs` (every test passes, then `process.exitCode = 3`) exits non-zero with `failed: test/fixtures/run/<f>.mjs`; `pass.mjs` alone exits 0; `pass.mjs fail.mjs` together exits non-zero (done-when 2).
  - `per-file temp and the shim`: `env.mjs` writes its `TMPDIR`, `DEVTEAM_TEST_SHARED_TMP` and `PATH` (after importing `lib/kit.mjs`). Run with a fresh `S` as `DEVTEAM_TEST_SHARED_TMP`: `TMPDIR` starts `/tmp/dtr-` (when `/tmp` is writable) and is gone after; the shared value is `S`; PATH's first entry is kit's shim (under `TMPDIR`) and the second is `S/devteam-test-tmux-shim-run-…`, whose `tmux` holds the marker; (that `test/lib/kit.mjs` is unchanged is a verification row, P1-2) (done-whens 3, 4).
  - `two files at once claim distinct port blocks`: `ports.mjs` and `ports-2.mjs` (a one-line fixture that imports `./ports.mjs`, so the runner sees two files) at `--concurrency 2` with `S` shared; each writes its result under `DTR_FIXTURE_OUT` named by its own pid; both report `LOCK_DIR = S/devteam-kit-ports`, distinct `PORTS`, and each saw the other's lock while it held its own (both wait until two locks exist, up to 10 s) (done-when 3).
  - `a file that ends on its own`: `tmux-ends.mjs` (skips without tmux) starts a server under its own `mkdtemp(os.tmpdir()/dt-tmux-)` (kit's exit hook doesn't know it), writes the server pid and its scratch folder, and exits 0; afterwards the pid is dead and the folder gone (done-when 6, part).
  - `--repeat 3 names the failing run`: `flaky.mjs` fails only when its counter (in `DTR_FIXTURE_OUT`) reads 2; the run exits non-zero and its summary has three rows, the failing one marked `run 2` (done-when 8).
  - `--timings`: `--timings <out>` over `pass.mjs` writes `{ run, files: { 'test/fixtures/run/pass.mjs': <number> } }` (done-when 8).
  - `a loud file`: `loud.mjs` prints 2 MB in one test and passes; the run exits 0 (Review Focus 4).
  - `from another cwd, through a symlink`: a symlink `L -> <repo root>`; `node L/test/run.mjs L/test/fixtures/run/fail.mjs` with cwd `/` exits non-zero naming the file (spec check 8 entry point; Review Focus 5).
  - `an empty shard`: `--shard 2/2 test/fixtures/run/pass.mjs` exits 0 and says `no files` (Review Focus 3).
- [ ] **Step 2:** they fail.
- [ ] **Step 3:** implement `main()`: plan, ensure the shim, run `alone` files one at a time, then the rest at `concurrency`, for runs 1..repeat; each child `spawn(process.execPath, childArgs(file), { cwd: root, env: { ...process.env, TMPDIR: dir, DEVTEAM_TEST_SHARED_TMP: shared, PATH: `${shimDir}:${PATH}` }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })`; on `exit`, read the rest of stdout/stderr for up to 2 s, run `cleanupAfter`, record `{ seconds, result }` (`ok`, `failed (exit N)`, `failed (signal SIGx)`), print its header and output. Then the summary, `failed:` lines, `--timings`, exit code.
- [ ] **Step 4:** they pass on Node 18, 20, 22, 24.
- [ ] **Step 5:** commit; review `reviews/task-3.md`.

### Task 4: watchdog, cleanup and signals

**Files:**
- Modify: `test/run.mjs`
- Create: `test/fixtures/run/hang.mjs`, `test/fixtures/run/survivor.mjs`
- Test: `test/run.test.mjs`

**Interfaces:**
- Produces: `snapshot() -> Map<pid, { ppid, stat }>` (from `ps -A -o pid=,ppid=,stat=`; throws when `ps` fails); `stopTree(root, { snapshot, signal }) -> { stopped: number[], killed: number[] }` (the spec's step 1 with amendment F2-1; `signal(pid, sig)` swallows ESRCH); `cleanup(entry, why)`: if `!entry.exited`, `stopTree(entry.child.pid)` (on a `ps` failure, SIGKILL the child alone and print that the walk failed), then `cleanupAfter(entry)`.
- The watchdog: a `setTimeout(timeout × 1000)` per running file; when it fires, `cleanup`, and the result `timed out`, with the `timed out: …` line from `lastFinished`.
- Signals: `SIGINT`, `SIGTERM`, `SIGHUP` handlers: stop scheduling, `cleanup` every running file, print `interrupted`, `process.exit(128 + os.constants.signals[sig])`.

- [ ] **Step 1: failing tests**:
  - `stopTree with scripted snapshots`: snapshots `[{1:{ppid:0}, 10:{ppid:1}}, {…, 11:{ppid:10}}, {…, 12:{ppid:11}}, same again]` with stats `T` for every stopped pid; the signal log is SIGSTOP 1, 10, 11, 12 (each before any SIGKILL), then SIGKILL 12, 11, 10, 1 (deepest first, root last); a pid the final snapshot doesn't show, or shows as not `T`, is never killed; a pid whose parent was never stopped is never stopped.
  - `a hung file is killed with its tree`: `hang.mjs` (a passing test `first passes`, then a test that imports `lib/kit.mjs`, spawns `node -e "setInterval(()=>{},1e3)"` with `detached: true`, starts `tmux new-session -d -s h 'sleep 600'` (when `hasTmux`), writes `{ file: process.pid, detached, server, socket, scratch: os.tmpdir() }` to `DTR_FIXTURE_OUT/pids.json`, and waits forever) under `--file-timeout 5`: the run exits 1 within 20 s; it prints `timed out: test/fixtures/run/hang.mjs after 5 s (last test finished: first passes)`; the file, detached and server pids are dead; `tmux -S <socket> has-session` fails; the scratch folder is gone (done-when 5).
  - `a survivor is refused tmux`: `hang.mjs` with `DTR_SURVIVOR=1` also starts `survivor.mjs` through a parent that exits at once (so it is orphaned before cleanup); the survivor waits for its `TMPDIR` to go (up to 30 s, then exits), runs `tmux -V`, writes `{ status, stderr }` to `DTR_FIXTURE_OUT/survivor.json` and exits; after the run, that file appears within 10 s with status 1 and `tmux refused` in stderr (done-when 4).
  - `SIGINT to the runner's group` and `SIGTERM to the runner`: the runner started `detached: true`; once `pids.json` exists, `process.kill(-runner.pid, 'SIGINT')` (and in the other test `process.kill(runner.pid, 'SIGTERM')`); the run prints `interrupted`, exits 130 (143), and the file, detached and server pids are dead and the folder gone (done-when 6).
- [ ] **Step 2:** they fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** they pass on Node 18, 20, 22, 24; `run.test.mjs` takes under 45 s here (time it on each, note it).
- [ ] **Step 5:** commit; review `reviews/task-4.md`.

### Task 5: `test/timings.json`

**Files:**
- Create: `test/timings.json`
- Keep: `docs/devteam-dev/tickets/kit-209-test-runner/timings-from-ci.mjs`

- [ ] **Step 1:** pick the newest green `test.yml` run on main that includes every `test/*.test.mjs` at the merge base (`gh run list -R sanctuarycomputer/devteam -w test.yml -b main -e push -s success`); download every job's log (`gh run view --job <id> --log`) to the scratchpad.
- [ ] **Step 2:** `node docs/devteam-dev/tickets/kit-209-test-runner/timings-from-ci.mjs <run> . <logs…> > test/timings.json`; stderr must list no unmatched name, no ambiguous name (amendment F2-3: add the ambiguous check to the script) and no file without a time.
- [ ] **Step 3:** T2's shard test now runs over the real weights; `node test/run.mjs --list --shard i/2` for i = 1, 2 shows the split; note each shard's total weight in verification.md.
- [ ] **Step 4:** commit; review `reviews/task-5.md`.

### Then

Verification (`verification.md`, a row per done-when at a named commit, with `devteam.mjs gate test -- <node> --test test/run.test.mjs` per major), finish (worker.md §8), and two final reviews from other sessions (`send supervisor … --kind review-request`).
