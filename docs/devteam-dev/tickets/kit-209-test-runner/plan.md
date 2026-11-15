# kit-209 test runner: implementation plan

## TL;DR

- One new file, `test/run.mjs`, with its test `test/run.test.mjs` and fixtures in `test/fixtures/run/` (named `*.mjs`, never `*.test.mjs`). Small changes in `test/lib/ports.mjs` and `test/lib/cli-runner.mjs`, and data in `test/timings.json`.
- Five tasks: the shared temp dir in the libs (T1); the runner's pure parts and `--list` (T2); running files with per-file temp, the shim, output, exit codes, repeat and timings (T3); the watchdog, the tree kill, tmux and folder cleanup, and signals (T4); `test/timings.json` from CI (T5).
- The kill rule: SIGKILL only pids this walk stopped that a snapshot still shows stopped (stat `T…`), in reverse stop order with the root last. No walk runs once the child has exited.
- Every child runs `detached: true`, and the runner handles SIGINT, SIGTERM and SIGHUP. The tests' own teardown kills a pid only after checking it is still the fixture's process.
- Tests run on Node 18, 20, 22 and 24 locally, one file at a time, with `DEVTEAM_*` unset. Never the full suite (the ruling below); CI is the gate.
- Execution is inline (executing-plans) with TDD and a fresh-subagent review per task (`reviews/task-<n>.md`). The final review comes from two other sessions (risk high).
- The task steps below are the whole plan. The amendments to the spec are folded into them, and listed at the end with the finding behind each.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `node test/run.mjs [files]` runs each kit test file in its own process with a watchdog, cleans up what it leaves, and groups and shards files for CI.

**Architecture:** One ES module with exported pure functions (option parsing, grouping, sharding, TAP reading, tree walk, socket walk, summary rows) and a `main()` that runs only when the module is the entry point (by real path). Each file is a `node --test --test-reporter=tap <file>` child in its own process group, with `TMPDIR` set to a scratch folder and a shared dir for what outlives it.

**Tech Stack:** Node 18.15+ built-ins only (`node:child_process`, `node:fs`, `node:os`, `node:path`, `node:crypto`, `node:url`, `node:stream`, `node:test`), `ps`, `tmux` when present.

**Spec:** `docs/devteam-dev/tickets/kit-209-test-runner/spec.md` (approved at 6862b5a, ruling m-20261115-070004373-supervisor), the design in devteam-dev `project/designs/devteam-s-tests-are-light-fast-and-easy-.md`. Where this plan's amendments (last section) differ from the spec, the amendment wins.

## Rulings

- m-20261115-070004373-supervisor: approve-spec at 6862b5a. On this box, run only the test files you touch, with `--test-concurrency=2` and the `DEVTEAM_*` variables unset; never the full suite. Each local run is `env -u DEVTEAM_RUN -u DEVTEAM_TICKET -u DEVTEAM_ROLE -u DEVTEAM_HOME -u DEVTEAM_SUPERVISOR -u DEVTEAM_FEATURE <node> --test --test-concurrency=2 test/run.test.mjs`.

## Global Constraints

- Node 18.15 to 24, built-ins only. No dependency, and no `fs.readdirSync(…, { recursive })`.
- Files are named by their path from the repo root, `test/<name>.test.mjs`. The root is `fs.realpathSync(path.resolve(<dir of run.mjs>, '..'))`, and the child's cwd is the root.
- Defaults: `--file-timeout` is 600 s for `chain` and for `LONG` (`{ 'test/dashboard.test.mjs': 600 }`, with the comment "until kit-210 splits it"), 300 s otherwise. Concurrency is `--concurrency` over `DEVTEAM_TEST_CONCURRENCY` over 2. `ALONE = ['test/bounds.test.mjs']`. A file is near timeout at seconds > timeout × 5/6. `--shard` n is 1..4.
- Exact strings: `timed out: <file> after <s> s (last test finished: <name|none>)`, `interrupted`, `failed: <file> (<reason>)`, and the shim's `tmux refused: TMUX_TMPDIR ($TMUX_TMPDIR) is not an existing private test directory`.
- Exit codes: 0 when everything passed, 1 on any failure or timeout, 2 on a usage error, 128 + the signal number on an interrupt.
- Kill only pids the walk stopped and a snapshot still shows stopped. Never kill a group by number (the runner's tests excepted: they kill the runner's group only while its leader, their own child, hasn't exited), and never a process by name. Act only on sockets whose real path is under the scratch folder.
- The top comment of `run.mjs` documents every flag.
- `lib/kit.mjs` is not changed (a verification row, never a test).
- `run.test.mjs` finishes in under 45 s; each spawn of the runner in it has a 60 s deadline.

## Review Focus

1. **A file named `./test/x.test.mjs`, by an absolute path, or through a symlink.** It is named `test/x.test.mjs` and runs once. T2: `parseArgs` normalizes, and the test passes each form.
2. **A named file that doesn't exist, or one outside `test/`.** A missing one is a usage error (exit 2, naming it), never a silent pass. One outside `test/` runs under its real absolute path, grouped by its source. T2 test.
3. **`--shard 2/2` on a one-file list.** That shard is empty: exit 0 with `no files`. T3 test.
4. **A file that prints a lot (MBs of TAP).** It must not block on a full pipe or lose output. T3 reads the output as it comes, and a fixture printing 2 MB passes.
5. **The runner started from another cwd, or through a symlinked checkout.** It still finds `test/` and runs. T3: cwd `/`, through a symlink, a failing fixture fails.

---

### Task 1: the shared temp dir in the test libs

**Files:**
- Modify: `test/lib/ports.mjs` (the `dir` line, now exported as `LOCK_DIR`; the top comment)
- Modify: `test/lib/cli-runner.mjs` (read the shared dir at startup)
- Test: `test/run.test.mjs` (created here)

**Interfaces:**
- Produces: `export const LOCK_DIR = path.join(process.env.DEVTEAM_TEST_SHARED_TMP || os.tmpdir(), 'devteam-kit-ports')` in `ports.mjs`. `cli-runner.mjs` sets `const shared = process.env.DEVTEAM_TEST_SHARED_TMP || os.tmpdir()` before its env swap, and its compile cache is `path.join(shared, 'devteam-kit-compile-cache')`.

- [ ] **Step 1: write the failing tests** in `test/run.test.mjs`:
  - `ports.mjs keeps its locks in DEVTEAM_TEST_SHARED_TMP`: make fresh dirs `S` and `T`. Spawn `node --input-type=module -e "<import LOCK_DIR and PORTS from the ports.mjs file URL; print { LOCK_DIR, PORTS, pid, lock: the text of LOCK_DIR/<(PORTS-20000)/100>.lock }>"` with `DEVTEAM_TEST_SHARED_TMP=S` and `TMPDIR=T`. Assert `LOCK_DIR === S/devteam-kit-ports`, that the lock held the child's pid, and that `T/devteam-kit-ports` doesn't exist.
  - `cli-runner keeps its compile cache in DEVTEAM_TEST_SHARED_TMP` (skipped unless `module.enableCompileCache` exists): spawn a node with `DEVTEAM_TEST_SHARED_TMP=S` and `DEVTEAM_TEST_COLD` removed from its env (it would bypass the warm runner) that imports `lib/cli.mjs` and calls `runNode(<a one-line script in S>, [], { env: { ...process.env, TMPDIR: T2 } })`. Assert `S/devteam-kit-compile-cache` exists and `T2/devteam-kit-compile-cache` doesn't.
  - Each spawn is `spawnSync` with `timeout: 30000`.
- [ ] **Step 2:** run them. Both fail: there is no `LOCK_DIR`, and the cache lands under `T2`.
- [ ] **Step 3:** make the two changes.
- [ ] **Step 4:** they pass on Node 18 and 24, and `test/search.test.mjs` still passes.
- [ ] **Step 5:** commit, then the review `reviews/task-1.md`.

### Task 2: the runner's pure parts and `--list`

**Files:**
- Create: `test/run.mjs`
- Test: `test/run.test.mjs`

**Interfaces (all exported from `test/run.mjs`):**
- `ROOT`, `ALONE`, `LONG`, `class UsageError extends Error`.
- `parseArgs(argv: string[], env: object, root = ROOT) -> { files: string[] ([] means all), groups: string[]|null, shard: {i,n}|null, list: bool, repeat: number, timings: string|null, concurrency: number, fileTimeout: number|null }`. It throws `UsageError` on an unknown flag, a bad number, an unknown group, a shard with n outside 1..4 or i outside 1..n, or a named file that doesn't exist. A file is `path.relative(root, fs.realpathSync(arg))` (split on `path.sep`, joined with `/`) when that doesn't start with `..`, else its real absolute path. Duplicates are dropped.
- `groupOf(rel: string, src: string) -> 'chain'|'alone'|'chrome'|'rest'`. It is `chain` when `path.basename(rel) === 'kit.test.mjs'` and the file is directly under `test/`, and `alone` when `rel` is in `ALONE`. It is `chrome` when `src` matches `/^\s*import\b[^;]*?['"]\.\/lib\/chrome\.mjs['"]/m` or `/\bimport\(\s*['"]\.\/lib\/chrome\.mjs['"]\s*\)/`. Otherwise it is `rest`.
- `timeoutOf(rel, group, override: number|null) -> seconds`; `nearTimeout(seconds, timeout) -> bool`.
- `weightsFor(files, timingsFiles: object) -> Map<rel, number>`: a file's listed weight, else the median of the chosen files' listed weights, else 1.
- `shard(files, weights: Map, n) -> string[][]`: greedy, heaviest first (ties by path), each to the lightest shard (ties to the lowest index). Each shard keeps that order.
- `planRun(opts, root = ROOT) -> [{ file, group, timeout }]`: every `test/*.test.mjs` under root (or `opts.files`), filtered by `opts.groups`, then the shard, then `alone` first, keeping the shard's order otherwise.
- `lastFinished(tap: string, file: string) -> string|null` (amendment A2).
- `childArgs(file) -> ['--test', '--test-reporter=tap', file]`.
- `rowFor({ file, run, seconds, result, timeout, repeat }) -> string`: the summary row, `file  seconds  result`, with `, near timeout` added past 5/6 and ` (run k)` when `repeat > 1`.
- `isEntry(argv1, metaUrl) -> bool`: `fs.realpathSync(argv1) === fileURLToPath(metaUrl)`, false when `argv1` is missing or doesn't resolve.
- CLI: `--list` prints one line per planned file, `<file>  <group>  <timeout> s`, runs nothing, and exits 0.

- [ ] **Step 1: write the failing tests**:
  - `groups by rule`: `groupOf` over the real sources puts `kit.test.mjs` in chain, `bounds.test.mjs` in alone, `dashboard.test.mjs` in chrome and `search.test.mjs` in rest. A source with `import('./lib/chrome.mjs')` is chrome; one naming it only in a comment (`// see ./lib/chrome.mjs`) is rest. `planRun({ groups: ['chain', 'alone'] })` over all files gives exactly `test/bounds.test.mjs` and `test/kit.test.mjs`, bounds first.
  - `shards cover each file once and balance`: weights `{a:10, b:9, c:5, d:4, e:1}` into 2 shards give `[[a, d, e], [b, c]]`. For n = 1..4 over the real file list and the real `test/timings.json` (`{}` until T5), the shards' union equals the list, with no duplicates. An unlisted file gets the median of the listed weights.
  - `parseArgs`: `--shard 0/2`, `--shard 3/2`, `--shard 1/5`, `--group nope`, `--concurrency 0`, `--bogus` and a missing file each throw `UsageError`. `--group chain,alone` gives `groups: ['chain', 'alone']`. Concurrency is 2 by default, 3 with `DEVTEAM_TEST_CONCURRENCY=3`, and 4 with `--concurrency 4` over that. `./test/search.test.mjs`, its absolute path and its path through a symlink to the root all give `test/search.test.mjs`, once (Review Focus 1, 2).
  - `timeouts and rows`: `timeoutOf` gives 600 for chain and for dashboard, 300 for search, and 7 for any file with an override of 7. `rowFor` with seconds 251 and timeout 300 has `near timeout`; with 249 it doesn't; with `repeat: 3, run: 2` it has `(run 2)`.
  - `lastFinished`: over a TAP sample with nested subtests, a `# SKIP` line and a wrapper line naming the file, it gives the description of the last finished line in output order. With no `ok` lines it gives null.
  - `childArgs` is exactly `['--test', '--test-reporter=tap', f]`.
  - `--list` (spawned with a 60 s deadline): `--list test/kit.test.mjs test/bounds.test.mjs test/dashboard.test.mjs test/search.test.mjs` prints bounds first, the four lines with 300, 600, 600 and 300 s, and exits 0. `--shard 1/2 --list` and `--shard 2/2 --list` over every file together list each file once. `--shard 3/2` exits 2.
- [ ] **Step 2:** they fail (no module).
- [ ] **Step 3:** write `test/run.mjs`: the top comment with every flag and the Node 18.15 floor, the exports above, and a `main()` that handles only `--list` so far, behind `if (isEntry(process.argv[1], import.meta.url))`. Each `UsageError` prints its message and exits 2.
- [ ] **Step 4:** they pass on Node 18 and 24.
- [ ] **Step 5:** commit, then the review `reviews/task-2.md`.

### Task 3: running the files

**Files:**
- Modify: `test/run.mjs`
- Create: `test/fixtures/run/pass.mjs`, `fail.mjs`, `throws.mjs`, `exit-nonzero.mjs`, `flaky.mjs`, `env.mjs`, `ports.mjs`, `ports-2.mjs`, `tmux-ends.mjs`, `loud.mjs`, `out.mjs` (the fixtures' shared helper: `put(name, obj)` writes JSON to `DTR_FIXTURE_OUT/<name>` via a temp name and a rename)
- Test: `test/run.test.mjs`

**Interfaces:**
- Consumes: T2's exports.
- Produces:
  - `sharedDir(env) -> string`: `env.DEVTEAM_TEST_SHARED_TMP || os.tmpdir()`.
  - `scratchDir() -> string`: `mkdtempSync('/tmp/dtr-')` when `/tmp` is a writable directory, else `mkdtempSync(path.join(os.tmpdir(), 'dtr-'))`.
  - `realTmux(PATH) -> string`: the first `tmux` on PATH that is an executable file without the marker, or `''`.
  - `ensureShim(shared, PATH) -> dir`. The dir is `<shared>/devteam-test-tmux-shim-run-<uid>-<sha1(text), 12 hex>`, and the shim is `tmux` in it, with the spec's text and the real tmux path (or `tmux-not-installed`). The dir is made with `mkdirSync(dir, { mode: 0o755 })` then `chmodSync(dir, 0o755)` (a umask of 002 would leave it group-writable), and the shim is written to a temp name in it, `chmodSync(tmp, 0o755)`, then renamed. An existing dir and shim are reused only when both are owned by `process.getuid()`, neither is writable by group or others, and the shim holds the marker. Otherwise the runner exits 2 with `unsafe shim at <path>: not this user's, or writable by others` (it never writes elsewhere, so it never leaks).
  - `socketsUnder(dir) -> string[]`: a hand walk. `readdirSync(d, { withFileTypes: true })` descends only into `isDirectory()` entries (Dirent's type is never a followed symlink) and collects `isSocket()` entries whose `realpathSync` starts with `realpathSync(dir) + '/'`.
  - `drain(stream, ms) -> Promise<void>`: it resolves on the stream's `end` or `close`, or after `ms`, whichever comes first.
  - `cleanupAfter(entry)` (steps 2 and 3): when `realTmux` is `''`, step 2 is skipped; otherwise for each socket, `spawnSync(realTmux, ['-S', s, 'kill-server'], { timeout: 5000 })`, then `rmSync(entry.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })`.
  - A running file is `{ file, run, child, dir, out: Buffer[], start, exited: false, timer }`.
- Fixtures read `DTR_FIXTURE_OUT` (a folder the test makes) for their outputs; the runner passes its env through.
- In `run.test.mjs`: `runRunner(args, { env, cwd, deadline = 60000, detached = true, umask })` -> Promise<{ code, signal, stdout, stderr, child }>` spawns `process.execPath test/run.mjs …`. If the deadline passes, it kills the runner's group (`process.kill(-child.pid, 'SIGKILL')`, only while `child.exitCode === null && child.signalCode === null`) and rejects. `env` defaults to `process.env` with `DTR_FIXTURE_OUT` set.

- [ ] **Step 1: write the failing tests:**
  - `a passing file`: `run.mjs test/search.test.mjs` exits 0. It prints its TAP after a `# test/search.test.mjs` header, then a summary with `concurrency 2` and the row `test/search.test.mjs  <s>  ok` (done-when 1).
  - `exit codes`: `fail.mjs`, `throws.mjs` and `exit-nonzero.mjs` (every test passes, then `process.exitCode = 3`) each exit 1, with `failed: test/fixtures/run/<f>.mjs (…)`. `pass.mjs` alone exits 0, and `pass.mjs fail.mjs` together exits 1 (done-when 2).
  - `per-file temp and the shim`: `env.mjs` imports `lib/kit.mjs`, then `put`s its `TMPDIR`, `DEVTEAM_TEST_SHARED_TMP` and `PATH`. Run with a fresh `S` as `DEVTEAM_TEST_SHARED_TMP`: `TMPDIR` starts with `/tmp/dtr-` (when `/tmp` is writable) and is gone afterwards. The shared value is `S`. PATH's first entry is kit's shim (under `TMPDIR`), and its second is `S/devteam-test-tmux-shim-run-<uid>-…`, whose `tmux` holds the marker. A second run reuses that dir, and so does a third started under `umask 002` (`runRunner`'s `umask` option runs it through `sh -c 'umask 002; exec "$0" "$@"'`) (done-whens 3, 4).
  - `the default shared dir`: with `DEVTEAM_TEST_SHARED_TMP` removed from the env and `TMPDIR=X` (a fresh dir), `env.mjs` sees `X` as the shared dir.
  - `two files at once claim distinct port blocks`: `ports.mjs`, and `ports-2.mjs` (one line, `import './ports.mjs'`), run at `--concurrency 2` with `S` shared. Each `put`s `{ LOCK_DIR, PORTS, pid }` under its own pid and waits until `S/devteam-kit-ports` holds two locks (up to 10 s). Both report `LOCK_DIR = S/devteam-kit-ports` and distinct `PORTS`, and neither scratch folder has a `devteam-kit-ports` (done-when 3).
  - `a file that ends on its own`: `tmux-ends.mjs` (skipped without tmux) starts `tmux new-session -d -s e 'sleep 60'` with `TMUX_TMPDIR` set to its own `mkdtemp(os.tmpdir()/dt-tmux-)`, which kit's exit hook doesn't know. It `put`s the server pid, the socket and its `os.tmpdir()`, and exits 0. Afterwards the pid is dead (polled, below) and the folder is gone (done-when 6, part).
  - `--repeat 3 names the failing run`: `flaky.mjs` keeps a counter in `DTR_FIXTURE_OUT` and fails only on its second run. The run exits 1, and its summary has three rows, the failing one marked `(run 2)` (done-when 8).
  - `--timings`: `--timings <out>` over `pass.mjs` writes `{ run, files: { 'test/fixtures/run/pass.mjs': <number> } }` (done-when 8).
  - `--list runs nothing`: `--list test/fixtures/run/env.mjs` exits 0, and no output file appears.
  - `a loud file`: `loud.mjs` prints 2 MB in one test and passes; the run exits 0 (Review Focus 4).
  - `from another cwd, through a symlink`: with a symlink `L -> <root>`, `node L/test/run.mjs L/test/fixtures/run/fail.mjs` from cwd `/` exits 1 and names `test/fixtures/run/fail.mjs` (Review Focus 5).
  - `an empty shard`: `--shard 2/2 test/fixtures/run/pass.mjs` exits 0 and prints `no files` (Review Focus 3).
  - `drain`: on a `PassThrough` that never ends, `drain(s, 200)` resolves in under 1.2 s.
  - Dead means `kill(pid, 0)` throws ESRCH, or `ps -o stat= -p <pid>` shows `Z`. `deadSoon(pid)` polls that every 100 ms for up to 5 s.
- [ ] **Step 2:** they fail.
- [ ] **Step 3:** implement `main()`. It plans the run, ensures the shim, and runs the `alone` files one at a time, then the rest at `concurrency`, for runs 1..repeat. Each child is `spawn(process.execPath, childArgs(file), { cwd: ROOT, env: { ...process.env, TMPDIR: dir, DEVTEAM_TEST_SHARED_TMP: shared, PATH: shimDir + path.delimiter + PATH }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })`, with stdout and stderr pushed into `out` as they come. On `exit` it:
  - sets `exited`;
  - `clearTimeout(timer)`;
  - awaits `drain` of both pipes (2000 ms), then `destroy()`s them;
  - runs `cleanupAfter`;
  - records the seconds and the result (`ok`, `failed (exit N)`, `failed (signal SIGx)`), unless the watchdog or an interrupt already set it (`entry.result`, kept: a killed file stays `timed out`, never `failed (signal SIGKILL)`);
  - prints the header and the output.

  Then it prints the summary (`summary: <n> files, concurrency <c>`, or `no files`), each `rowFor`, the `failed:` lines and the `--timings` file, and sets the exit code.
- [ ] **Step 4:** they pass on Node 18, 20, 22 and 24.
- [ ] **Step 5:** commit, then the review `reviews/task-3.md`.

### Task 4: the watchdog, cleanup and signals

**Files:**
- Modify: `test/run.mjs`
- Create: `test/fixtures/run/hang.mjs`, `test/fixtures/run/survivor.mjs`
- Test: `test/run.test.mjs`

**Interfaces:**
- Produces:
  - `snapshot() -> Map<pid, { ppid, stat }>`, from `spawnSync('ps', ['-A', '-o', 'pid=,ppid=,stat='], { timeout: 5000 })`. It throws when `ps` fails.
  - `stopTree(root, { snapshot, signal, now = Date.now, sleep }) -> { stopped: number[], killed: number[], unstopped: number[] }`. Without both `snapshot` and `signal` it uses the real ones; with exactly one of them it throws. `signal(pid, sig)` swallows ESRCH.
  - `cleanup(entry, why)`: if `!entry.exited`, `stopTree(entry.child.pid)`. If `ps` fails, it sends SIGKILL to the child alone and prints `tree walk failed: <error>`. Then `cleanupAfter(entry)`.
  - The `stopTree` algorithm (amendments A1 and A4):

    ```
    stop(root); stopped = [root]
    loop (at most 2 s after the first round with no new pid):
      snap = snapshot()
      fresh = pids in snap whose ppid is in stopped and that aren't in stopped yet
      stop each fresh pid, append it to stopped, remember its ppid; if fresh was non-empty, continue
      if every stopped pid present in snap has a stat starting with 'T' or 'Z': break
      sleep(20)
    final = the last snap
    killed = reversed(stopped) filtered to pids present in final with a stat starting with 'T'
             and the same ppid as when stopped (the root: any); SIGKILL each in that order
    unstopped = stopped pids present in final with a stat starting with neither 'T' nor 'Z'
                (reported in the runner's output, never killed); a zombie has already exited
    ```
- The watchdog: `entry.timer = setTimeout(…, timeout × 1000)` when a file starts. When it fires: `cleanup`, the result `timed out`, and the `timed out: …` line from `lastFinished(out, file)`.
- Signals: handlers for `SIGINT`, `SIGTERM` and `SIGHUP`. Each stops scheduling, runs `cleanup` on every running file, prints `interrupted`, and calls `process.exit(128 + os.constants.signals[sig])`.
- Test teardown (P2-2): `pids.json` records, for each pid, the `args` that `ps -o args= -p <pid>` showed when it started. A `t.after` hook kills a pid only if it is alive and `ps -o args=` still shows those exact args. It kills a socket's server with `<realTmux> -S <socket> kill-server` only when the socket is under `/tmp/dtr-` or the test's `S`. It kills the runner's group only as `runRunner` does.

- [ ] **Step 1: write the failing tests:**
  - `stopTree with scripted snapshots`: the pids are 9,000,001 and up, above Linux's limit of 4,194,304, and the signal stub records calls and never calls `process.kill`. The root R has child A; B, A's child, first appears in snapshot 2; A shows `S` in snapshot 2 and `Tl` in snapshot 3. The log is SIGSTOP R, A, B, all before any SIGKILL, then SIGKILL B, A, R. A pid whose parent was never stopped is never signalled. A stopped pid missing from the final snapshot, one showing `Ss` there (listed in `unstopped`), one showing `Z` (not listed, and the walk doesn't spin its 2 s on it) and one whose ppid changed since it was stopped are never killed. `stopTree(1, { snapshot })` without `signal` throws.
  - `a hung file is killed with its tree, and a survivor is refused tmux`: `hang.mjs` runs a passing test, `first passes`. Its second test:
    - imports `lib/kit.mjs`;
    - spawns `node -e "setTimeout(()=>{},60000)//dtr-fixture"` with `detached: true`;
    - when `hasTmux`, starts `tmux new-session -d -s h 'sleep 60'`;
    - when `DTR_SURVIVOR=1`, starts `survivor.mjs` through a parent node that exits at once, so the survivor is orphaned before cleanup;
    - `put`s `pids.json`: `{ file, detached, server, socket, scratch: os.tmpdir() }`, each pid with its args;
    - waits, exiting by itself after 60 s.

    The survivor waits for its `TMPDIR` to go (polling, giving up after 30 s), runs `tmux -V` with its env, `put`s `survivor.json` (`{ status, stderr }`) and exits. Run with `--file-timeout 5` and `DTR_SURVIVOR=1`. The run exits 1 well within its deadline. It prints `timed out: test/fixtures/run/hang.mjs after 5 s (last test finished: first passes)`, and the summary's row for it says `timed out`. The file, detached and server pids are dead (`deadSoon`). `tmux -S <socket> has-session` fails. The scratch folder is gone. `survivor.json` appears within 10 s with status 1 and `tmux refused` in its stderr (done-whens 4, 5).
  - `SIGINT to the runner's group` and `SIGTERM to the runner`: `runRunner` starts the runner `detached: true`. Once `pids.json` exists, and only while the runner hasn't exited (else the test fails), the test sends `process.kill(-runner.pid, 'SIGINT')` (in the other test, `process.kill(runner.pid, 'SIGTERM')`). The run prints `interrupted` and exits 130 (143). The file, detached and server pids are dead, and the folder is gone (done-when 6).
- [ ] **Step 2:** they fail. `runRunner`'s deadline and the teardown clean up the fixtures while there is no watchdog yet.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** they pass on Node 18, 20, 22 and 24, and `run.test.mjs` takes under 45 s here on each (time it, note it).
- [ ] **Step 5:** commit, then the review `reviews/task-4.md`.

### Task 5: `test/timings.json`

**Files:**
- Create: `test/timings.json`
- Modify: `docs/devteam-dev/tickets/kit-209-test-runner/timings-from-ci.mjs` (the ambiguous-name list)

- [ ] **Step 1:** find the newest green `test.yml` push run on main that has every `test/*.test.mjs` at the merge base (`gh run list -R sanctuarycomputer/devteam -w test.yml -b main -e push -s success`), and download every job's log to the scratchpad (`gh run view --job <id> --log`).
- [ ] **Step 2:** the script also lists each name declared at top level in two files as `ambiguous: <name> (<files>)`, and assigns it to neither.
- [ ] **Step 3:** make a scratch checkout of the merge base (`git worktree add --detach <scratchpad>/base origin/main`, removed after), run `node …/timings-from-ci.mjs <run> <scratchpad>/base <logs…> > test/timings.json`. stderr must list no unmatched name, no ambiguous name (or each one gets a verification row with its time) and no file without a time.
- [ ] **Step 4:** T2's shard test now runs over the real weights. `node test/run.mjs --list --shard i/2` for i = 1 and 2 shows the split; note each shard's total weight in verification.md.
- [ ] **Step 5:** commit, then the review `reviews/task-5.md`.

### Then

Verification (`verification.md`): a row per done-when at a named commit, with `devteam.mjs gate test -- <node> --test --test-concurrency=2 test/run.test.mjs` for each major. Rows also cover `lib/kit.mjs` unchanged (`git diff --quiet <merge base> -- test/lib/kit.mjs`), every file in `test/timings.json` at the merge, and `run.test.mjs`'s time on each major from CI. Then finish (worker.md §8), with two final reviews from other sessions (`send supervisor … --kind review-request`).

## Amendments to the spec

Each binds the task named.

- **A1 (spec review F2-1, plan review P1-5; T4).** SIGKILL goes in reverse stop order, which puts children before parents and the root last. A parent killed first can make the kernel SIGCONT an orphaned stopped group, and a child could then exit and free its pid before its own SIGKILL.
- **A2 (F2-2; T2).** The last-finished name is the description on the last `ok`/`not ok` line in output order (any indent), with `# SKIP`/`# TODO` stripped. It skips a line whose description is the file's own path.
- **A3 (F2-3; T5).** On Node 18, 20 and 22, the top-level TAP lines (`ok N - <name>` at column 0) carry `duration_ms`. Run 43685419235's Node 18 and 22 rest logs had no per-file wrapper line, and every name matched. Node 24's log uses the spec reporter and adds nothing (`source` says so). A name two files declare is listed as ambiguous and assigned to neither.
- **A4 (P1-3, P2-3; T4).** Signals land asynchronously, so `stopTree` re-snapshots (every 20 ms, for at most 2 s) until no new pid appears and every stopped pid shows `T…`. A pid found in a later round is stopped and walked like the rest. SIGKILL reaches only stopped pids that the final snapshot shows `T…`. A stopped pid that never shows `T` is reported as `unstopped`, not killed.
- **A5 (P1-9, P2-6).** The survivor runs inside the timed-out hang run. The time budget is 45 s (the spec said 40 s), and the time on each major is recorded from CI.
- **A6 (P1-10, P2-6; T3).** The shim's dir name carries the uid, `devteam-test-tmux-shim-run-<uid>-<hash>`. The runner reuses an existing shim only when it is this user's and not writable by others, and otherwise refuses with exit 2.
- **A7 (P1-1, P2-2; T3, T4).** Every runner spawn in the tests has a 60 s deadline. Teardown kills a pid only when its args still match the fixture's, and the runner's group only while the runner hasn't exited. Fixtures end by themselves within 60 s.
- **A9 (P3-1; T5).** "Every `test/*.test.mjs` at main" is read at the merge base: `test/timings.json` lists every file there. `test/run.test.mjs`, which this PR adds, gets the median weight until kit-217 refreshes the file from a run on main that has it (the design: "a file not listed gets the median weight").
- **A10 (P3-2, P3-3, P3-4, P3-5, P3-6; T3, T4).** The shim's dir and file get explicit modes. A watchdog's `timed out` is never overwritten. Step 2 is skipped without tmux. A zombie counts as stopped for the loop, but is never killed or reported. The final kill also needs the ppid recorded at stop.
- **A8 (P1-2).** That `lib/kit.mjs` is unchanged is a verification row, never a test.

## Rulings after plan approval

- m-20261115-072318670-supervisor: approve-plan at 26d78ac. P4-4: "at main" means the merge base; `test/run.test.mjs` takes the median weight until kit-217 refreshes `test/timings.json` (noted in verification.md). Run only the files touched, at `--test-concurrency=2`.
- Plan review 4's Minors are handled in the build: P4-1, a pid stopped by the walk that shows `T` whose recorded parent is absent from the final snapshot is killed too (it is still stopped, so still ours); P4-2, the first, creating run is the `umask 002` one, and the test asserts mode 0755 on the dir and the shim; P4-3, the merge base is `git merge-base HEAD origin/main`; P4-4, the ruling above; P4-5, step 2 runs only with tmux, step 3 always.
- Task 3 review T3-4: the spec's "something holding the pipe can't turn a pass into a timeout" holds for the runner's own pipe only. `node --test <file>` itself waits for its test process's stdout to close (the reviewer measured 8 s for a detached `sleep 8` holding it, on Node 18, 22 and 24, with or without the runner). The runner can't change that; such a file runs until the holder exits or its watchdog fires, and the `timed out` line then names its last finished test. Recorded here, not fixed.
- Task 3 review T3-9: `node --test` may break a long output line where its chunks split (Node 18 and 24 both do, without the runner), so the loud-file test counts characters, not whole lines.
- m-20261115-081721807-supervisor (re o-20261115-081716305, the port-lock leak): the runner frees the port locks of the pids it SIGKILLs (`freeLocks`, after they are gone), and it is tested both ways: a fixture SIGKILLed by the runner leaves no lock (the hang, SIGINT and SIGTERM tests), and a lock whose owner is alive is never freed (`freeLocks frees only…`).
