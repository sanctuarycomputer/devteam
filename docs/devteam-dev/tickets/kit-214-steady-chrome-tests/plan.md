# kit-214 steady Chrome tests: plan

## TL;DR

- Two causes in `test/lib/chrome.mjs` account for most `kit (22, rest)` failures: `close()` lets the event loop empty while it waits for Chrome's exit (the whole file is cancelled), and FIFO `t.after` hooks let a throwing folder removal skip the stops (a 600 s hang).
- Task 1 fixes `close()`, rejects waiting CDP calls when the page socket closes, returns `pid`, and adds `cleanup(t)`. A new `test/dashboard-teardown.test.mjs` proves both (done-whens 1 and 6), and fails against main's chrome.mjs.
- Task 2 moves every multi-step teardown in `test/dashboard*.test.mjs` onto `cleanup(t)` (mechanical, order kept).
- Task 3 replaces the fixed sleeps in the failing tests with waits on state: typing, threads, viewer reload, pins 'ready 5,000 times' (with the poll held still).
- Task 4 makes pane-question.answer:140 deterministic with a gated `tmux` wrapper on the dashboard's PATH.
- Task 5 is the proof: test-stress.yml (5 repeats, load 2) on the branch, test.yml green, times from the Node 24 rest job.
- Local runs: only the touched files, one at a time, `--test-concurrency=2`, Node 22 at `/usr/local/bin/node`, under `timeout` (no `prlimit --as`).

## Rulings

See spec.md § Rulings (m-20261115-181143331, m-20261115-181403894, m-20261115-182700815). All are folded into the tasks below.

## Global constraints

- Files: only `test/lib/chrome.mjs`, `test/dashboard*.test.mjs`, `test/pane-question.answer.test.mjs`, `test/lib/pane-question-fixture.mjs`, and this ticket's folder.
- Each task is TDD where a test can fail first: write or adjust the test, see it fail for the reason expected, then fix.
- Local test runs: `timeout 600 /usr/local/bin/node --test --test-concurrency=2 <one file>` (or `--test-name-pattern`), saved to a file. The exit code is checked (`echo $?`), never a piped tail. Never the full suite.
- Gates: `node $DT gate test -- …` for the local file runs, and `gate ci` for the CI check, run through the real command.
- Shell with rm, redirects or nested quotes goes in a script file under the ticket's scratch, and `rm -rf` only as `"${S:?}/…"`.
- Reviewer briefs carry k-20261115-182656232, k-20261115-080753394 and k-20261115-164245020.

## Review focus

- Does `close()` hold the loop only while it needs to, and always end (the 5 s bound)?
- Is the mechanical teardown conversion order-preserving, and does it change nothing else?
- Does each replaced wait check the same thing the sleep allowed time for (no weakened assertion)?
- Is the tmux wrapper invisible to everything but the one `send-keys -l`?

### Task 1: lib/chrome.mjs, and the teardown test

Files: `test/lib/chrome.mjs`, `test/dashboard-teardown.test.mjs` (new).

1. Write `test/dashboard-teardown.test.mjs`. Each case writes a child test file into `fs.mkdtempSync(os.tmpdir()/devteam-teardown-)`, importing `lib/chrome.mjs` and `lib/kit.mjs` by absolute file URL. It runs the file with `spawnSync(process.execPath, ['--test', '--test-reporter=tap', child], { timeout: 120000 })`, reads the pids the child printed (`PIDS {json}` lines in its stdout, as TAP comments), and checks:
   - **thrown mid-page** (skip unless `canDrive`): Chrome opened, a page navigated to `data:text/html,…`, `throw`. Then Chrome's group is gone (ESRCH within 5 s), and the child failed with exactly 1 failure.
   - **thrown with Chrome slow to stop** (skip unless `canDrive`): as above, with `process.kill(chromePid, 'SIGSTOP')` before the throw, and a second test after it that passes. Then the group is gone, and the TAP says `# pass 1`, `# fail 1`, `# cancelled 0`, child exit 1 (not a timeout).
   - **removal throws first** (skip unless `canDrive`; done-when 6): `bareProject` + `dashboardOnFreePort`, Chrome and a page, `spawn(node, ['-e', 'setInterval(() => {}, 1000)'])`, `http.createServer().listen(0)`, all through `later` from `cleanup(t)`. The removal is registered first and throws an ENOTEMPTY error. After the child exits (well inside 120 s): the dashboard's group, Chrome's group and the child pid are all gone, and the only failure the child reports is the ENOTEMPTY.
   - **cleanup's contract** (always runs): a child with three `later` steps, the second throwing. All three ran, in reverse order, and the error is the thrown one.
   - The child's env: own HOME (mkdtemp), `DEVTEAM_HUB_PORT`/`DEVTEAM_PORT_BASE` from `PORTS` (a block of its own: claim offsets in this file's header comment, per test/lib/ports.mjs's rule), and every `DEVTEAM_*` and `TMUX*` unset.
2. Run it against main's chrome.mjs (with `cleanup`/`pid` stubbed in a scratch copy): the SIGSTOP case fails (cancelled or hung to the spawn timeout). Quote the result in verification.md.
3. Implement in chrome.mjs: `proc.ref()` at the start of `close()`; the 5 s post-SIGKILL bound; `ws.onclose`/`onerror` after open reject all of `waiting` with `Chrome's page connection closed (code …)`; `pid: proc.pid` in the return; export `cleanup(t)`.
4. Run the file (Node 22): green. Run one existing Chrome file, `dashboard-owner-action.test.mjs`: green.
5. Review `reviews/task-1.md`.

### Task 2: teardown on cleanup(t) across dashboard*.test.mjs

Files: `test/dashboard.test.mjs`, `test/dashboard-answers.test.mjs`, `test/dashboard-measure.test.mjs`, `test/dashboard-owner-action.test.mjs`, `test/dashboard-shell.test.mjs`.

1. A node script in the ticket folder (`convert.mjs`, kept for review) rewrites each top-level `test(` body with two or more `t.after(` calls, or an `undo` stack. It inserts `const later = cleanup(t);` before the first teardown line, replaces `t.after(` and `undo.push(` with `later(`, and drops the `const undo = []` and the hand-written reversing `t.after` lines. It prints every test it changed. It refuses (exit 1) on a pattern it doesn't know (an `st.after` in a subtest, a `t.after` inside a nested function), which is then done by hand.
2. Add `cleanup` to each file's `./lib/chrome.mjs` import.
3. Check the diff by eye: only those lines changed. `git diff --stat`, plus a grep: no test with ≥2 bare `t.after(`.
4. Run each of the four small files (Node 22): green. dashboard.test.mjs runs once in Task 3's run.
5. Review `reviews/task-2.md`.

### Task 3: waits on state in the failing tests

File: `test/dashboard.test.mjs`.

1. **pins 'ready 5,000 times'**: before the flood, `await p.ev('window.__still()')`, and `__stir()` in a finally. Add `const heard = async (tag) => { post {probe: tag} to the frame; await soon(window.__own has heard with data.probe === tag) }`, and replace both 300 ms sleeps with `await heard(<unique>)`. Keep the asserts as they are (draws ≤ 2, resolves unchanged, one resolve on the next load).
2. **typing radio**: `setTimeout(r, 300)` → `p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')`.
3. **threads**: `settle` → `ticks = async (n = 2) => { const at = await p.ev('window.__polls'); await soon(\`window.__polls >= ${at + n}\`, \`${n} polls\`); }`, at its four call sites. Drawer 200 ms → two animation frames.
4. **viewer reload**: dashboard subtest: `const n = await p.ev("__asked.filter((u) => u === '/api/threads').length")`, then `soonData(… > n)` in place of the 3 s. Viewer subtest: the same with `u.startsWith('/api/view?')` and `soonView`.
5. Run dashboard.test.mjs (Node 22, `--test-concurrency=2`, niced, pinned to 2 cores): green. Then the four changed tests by `--test-name-pattern` with `DEVTEAM_TEST_READ_DELAY_MS=600`: green.
6. Review `reviews/task-3.md`.

### Task 4: pane-question.answer:140 deterministic

Files: `test/pane-question.answer.test.mjs` (and `test/lib/pane-question-fixture.mjs` only if the wrapper is shared; planned as local to the test).

1. In the test: `const real = spawnSync('sh', ['-c', 'command -v tmux'], { env: F.env(), encoding: 'utf8' }).stdout.trim()`. Write `<F.base>/gate/tmux` (mode 755): a `/bin/sh` script that, when `$GATE/armed` exists and the arguments hold `send-keys` and `-l`, removes `armed`, touches `waiting`, polls for `go` (every 0.05 s, at most 400 times), then `exec "$REAL" "$@"`; otherwise `exec "$REAL" "$@"` at once. Pass the dashboard `PATH=<gate>:<F.env().PATH>`, plus `GATE` and `REAL`.
2. The steps of spec § pane-question, each wait an `until` on a file or the pane. The asserts are unchanged except that the two sleeps and `DEVTEAM_PANE_ANSWER_DELAY_MS` go.
3. Run the file (Node 22): green, 3 times.
4. Review `reviews/task-4.md`.

### Task 5: proof

1. Merge `origin/main`, push, open the PR (title `kit-214-steady-chrome-tests: Chrome-driven dashboard tests wait on the page, not on timers, and leave no Chrome behind`).
2. `gh workflow run test-stress.yml --ref ticket/kit-214-steady-chrome-tests -f files="test/dashboard.test.mjs test/dashboard-answers.test.mjs test/dashboard-measure.test.mjs test/dashboard-owner-action.test.mjs test/dashboard-shell.test.mjs test/dashboard-teardown.test.mjs" -f repeat=5 -f load=2`, plus one run of `test/pane-question.answer.test.mjs` (repeat 5, load 2). Wait for completion (Monitor, no polling loop). Conclusion from `gh run view --json conclusion`.
3. test.yml at the head: every job's conclusion. From the `kit (24, rest)` log, each listed file's top-level `duration_ms` and its slowest test.
4. verification.md: a row per done-when, with command, result and sha. Then the final review (`reviews/final-1.md`, a fresh subagent that hasn't seen the build), `check-ticket`, and the merge-request.

## Verification

verification.md has one row per done-when (1–6) and a row for the ruling's pane-question fix, each with the exact command or run id, its result, and the commit.
