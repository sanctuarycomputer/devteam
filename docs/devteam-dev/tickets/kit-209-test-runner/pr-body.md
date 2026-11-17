One command runs the kit's tests: `node test/run.mjs [file…]`. Each file runs in a process of its own, at a low default concurrency, with a watchdog that kills a hung file's whole process tree and names the file. Groups and weighted shards are for CI (kit-215 builds the sharded `test.yml` on them).

## What changes

- **`test/run.mjs`** (new; flags documented in its top comment). Built-ins only, Node 18.15 to 24.
  - Each file runs as `node --test --test-reporter=tap <file>` in a process group of its own, with `TMPDIR` set to a scratch folder (`/tmp/dtr-…`) and `DEVTEAM_TEST_SHARED_TMP` naming the shared temp dir. Its TAP is printed whole under a `# <file>` header, then a summary (file, seconds, result, concurrency). It exits 0 only when every file's process exited 0.
  - `--concurrency n` (default `DEVTEAM_TEST_CONCURRENCY`, else 2); `alone` files run first, one at a time.
  - `--file-timeout s`: by default 600 s for `kit.test.mjs` (the chain) and for `dashboard.test.mjs` until kit-210 splits it, 300 s otherwise. A file over 5/6 of its timeout is flagged `near timeout`. No `--test-timeout` is passed to node.
  - **Cleanup**, on a timeout and on SIGINT, SIGTERM or SIGHUP:
    1. Stop the file's tree with SIGSTOP, found by parent pid (this reaches detached children), re-snapshotting until no new pid appears.
    2. SIGKILL only the pids it stopped that still show stopped, children first and the root last, and resume anything it stopped and didn't kill.
    3. Kill the tmux servers whose sockets are under the scratch folder.
    4. Remove the folder.

    It prints `timed out: <file> after <s> s (last test finished: <name>)` or `interrupted`. A file that ends on its own gets steps 3 and 4.
  - **A tmux shim of the runner's own**, in the shared dir behind `lib/kit.mjs`'s per-file shim, refuses tmux to a process whose private tmux folder is gone. So a process that outlives its file can never reach the machine's own tmux server. `lib/kit.mjs` is unchanged.
  - `--group chain|alone|chrome|rest[,…]` (by rule, read from the files), `--shard i/n` (greedy on `test/timings.json`, median weight if unlisted), `--list`, `--repeat n`, `--timings out.json`.
- **`test/lib/ports.mjs`, `test/lib/cli-runner.mjs`**: the port locks and the compile cache live in `DEVTEAM_TEST_SHARED_TMP` when it is set (else the temp dir, as before). `ports.mjs` exports `LOCK_DIR`.
- **`test/timings.json`** (new): each file's weight from main's run 43691440933 at 23b0cdd. That is every `test/*.test.mjs` at the merge base. `run.test.mjs`, new here, takes the median until kit-217 refreshes the file.
- **`test/run.test.mjs`** and **`test/fixtures/run/`**: the runner's tests. Fixtures are `*.mjs`, never `*.test.mjs`, so no discovery runs them.

`test.yml`, the README and `operator.md` are unchanged here: kit-215 and kit-218 move them to the runner.

## How to verify

- `node test/run.mjs test/search.test.mjs`: its TAP, then a summary, and exit 0.
- `node test/run.mjs --list` and `node test/run.mjs --list --shard 1/2`: the plan, with groups and timeouts, and nothing run.
- `node --test --test-concurrency=2 test/run.test.mjs`: the runner's own tests (exit codes, per-file temp, shim, ports, cleanup by pid, timeout, SIGINT/SIGTERM, groups, shards, repeat, timings). About 15 to 45 s.
- The records (spec, plan, reviews, verification) are in `docs/devteam-dev/tickets/kit-209-test-runner/`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
