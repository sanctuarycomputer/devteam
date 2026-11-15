# kit-214 steady Chrome tests: plan

## TL;DR

- Two causes in `test/lib/chrome.mjs` account for most `kit (22, rest)` failures: `close()` lets the event loop empty while it waits for Chrome's exit (the whole file is cancelled), and FIFO `t.after` hooks let a throwing folder removal skip the stops (a 600 s hang).
- Task 1 fixes `close()`, rejects waiting CDP calls when the page socket closes, returns `pid`, and adds `cleanup(t)`. A new `test/dashboard-teardown.test.mjs` proves both (done-whens 1 and 6), and fails against main's chrome.mjs.
- Task 2 moves every multi-step teardown in `test/dashboard*.test.mjs` onto `cleanup(t)` (mechanical, order kept).
- Task 3 replaces the fixed sleeps in the failing tests with waits on state: typing, threads, viewer reload, pins 'ready 5,000 times' (with the poll held still).
- Task 4 makes pane-question.answer:140 deterministic with a gated `tmux` wrapper on the dashboard's PATH.
- Task 5 adds test-stress.yml's `node` input (ruling m-20261115-185043423). Task 6 is the proof: stress runs (5 repeats, load 2) on Node 22 and 24, test.yml green, and the times.
- Local runs: only the touched files, one at a time, `--test-concurrency=2`, Node 22 at `/usr/local/bin/node`, under `timeout` (no `prlimit --as`).

## Rulings

See spec.md § Rulings (m-20261115-181143331, m-20261115-181403894, m-20261115-185043423, m-20261115-182700815). All are folded into the tasks below. Review spec-1 and plan-1 findings are folded in, each marked with its id.

## Global constraints

- Files: only `test/lib/chrome.mjs`, `test/dashboard*.test.mjs`, `test/pane-question.answer.test.mjs`, `test/lib/pane-question-fixture.mjs`, `.github/workflows/test-stress.yml`, and this ticket's folder.
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

1. Write `test/dashboard-teardown.test.mjs`. Each case writes a child test file into `fs.mkdtempSync(os.tmpdir()/devteam-teardown-)`, importing `lib/chrome.mjs` and `lib/kit.mjs` by absolute file URL. It runs the file with `spawn(process.execPath, ['--test', '--test-reporter=tap', child], { detached: true })`, a process group of its own. A 120 s timer SIGKILLs that group on a timeout. The case's `cleanup` SIGKILLs it again, and every group or pid the child printed, after the checks, so a regression leaves nothing behind (P1-1). It reads the pids the child printed (`# PIDS {json}` lines in its stdout) and checks:
   - **thrown mid-page** (skip unless `canDrive`): Chrome opened, a page navigated to `data:text/html,…`, `throw`. Then Chrome's group is gone (ESRCH within 5 s), and the child failed with exactly 1 failure.
   - **thrown with Chrome slow to stop** (skip unless `canDrive`): as above, with `process.kill(chromePid, 'SIGSTOP')` before the throw, and a second test after it that passes. Then the group is gone, and the TAP says `# pass 1`, `# fail 1`, `# cancelled 0`, child exit 1 (not a timeout).
   - **no exit ever reported** (skip unless `canDrive`; F1-1/P1-2/P2-1): Chrome SIGSTOPped, then `const closing = chrome.close(); chrome.proc.removeAllListeners('exit'); await closing` (removed after the call, since `close()` adds its listener when called). `close()` resolves in at least 6 s and under 10 s (the bound ends it at about 8 s, the 3 s SIGKILL plus 5 s; an exit would end it at about 3 s; P3-1), and a second test after it passes: `# pass 2`, `# cancelled 0`, and the file ends well inside the timer.
   - **removal throws first** (skip unless `canDrive`; done-when 6): `bareProject` + `dashboardOnFreePort`, Chrome and a page, `spawn(node, ['-e', 'setInterval(() => {}, 1000)'])`, `http.createServer().listen(0)`, all through `later` from `cleanup(t)`. The removal is registered first and throws an ENOTEMPTY error. After the child exits (well inside 120 s): the dashboard's group, Chrome's group and the child pid are all gone, and the only failure the child reports is the ENOTEMPTY.
   - **cleanup's contract** (always runs): a child with three `later` steps, the second throwing. All three ran, in reverse order, and the error is the thrown one.
   - The child's env: own HOME (mkdtemp), `DEVTEAM_HUB_PORT`/`DEVTEAM_PORT_BASE` from `PORTS` (a block of its own: claim offsets in this file's header comment, per test/lib/ports.mjs's rule), and every `DEVTEAM_*` and `TMUX*` unset.
2. Run it against main's chrome.mjs (with `cleanup`/`pid`/`proc` stubbed in a scratch copy): the SIGSTOP case fails, with `# cancelled 1` or a hang to the timer. Quote the result in verification.md. Note there that the group check passes at main too (the exit handler kills the group), so the TAP counts are the evidence for class A (P1-7). Also record what the no-exit case does at main: it fails, because `close()` never resolves and the loop empties, so the file's next test is cancelled (P3-3).
3. Implement in chrome.mjs: `proc.ref()` at the start of `close()`; the 5 s post-SIGKILL bound; `done()` calls `proc.unref()` and removes its `exit` listener (P1-2); `ws.onclose` after open rejects all of `waiting` with `Chrome's page connection closed (code …)`; `pid: proc.pid, proc` in the return; export `cleanup(t)`. `test/lib/pane-question-fixture.mjs` re-exports `cleanup` from chrome.mjs instead of its own copy (F1-9a).
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
2. **typing radio** (P1-4): `setTimeout(r, 300)` → `p.ev(atRest)`. `atRest` is a page-side promise that resolves once `scrollY` has been unchanged for 10 consecutive animation frames, giving up after 3 s. Mutation check, in a scratch copy: make the radio's space reach the page, so it scrolls. The test must then fail.
3. **threads** (P1-9): `settle` → `ticks(8)` (`const at = await p.ev('window.__polls'); await soon(\`window.__polls >= ${at + 8}\`, …)`), about 2.4 s of the page's own polls, at its four call sites. Drawer 200 ms → two animation frames after the move: the cursor is set in the pointer handler, which has run before the next frame.
4. **viewer reload** (P1-3): a test-local init script wraps `fetch`, recording `{ u, n, landed }` per read in `window.__reads2` (`n` is the start order; `landed` is set when `text()` or `json()` resolves). Dashboard subtest: take `n0` = the reads so far when the outline shows; wait (soonData, 45 s) until two `/api/data` reads with `n > n0` have landed; then `said('v2') === 0`. Viewer subtest: the same with `/api/view?` and soonView (37 s each).
5. Run dashboard.test.mjs (Node 22, `--test-concurrency=2`, niced, pinned to 2 cores): green. Then the four changed tests by `--test-name-pattern` with `DEVTEAM_TEST_READ_DELAY_MS=600`: green.
6. Review `reviews/task-3.md`.

### Task 4: pane-question.answer:140 deterministic

Files: `test/pane-question.answer.test.mjs` (and `test/lib/pane-question-fixture.mjs` only if the wrapper is shared; planned as local to the test).

1. In the test: `const real = spawnSync('sh', ['-c', 'command -v tmux'], { env: F.env(), encoding: 'utf8' }).stdout.trim()`. Write `<F.base>/gate/tmux` (mode 755): a `/bin/sh` script that, when `$GATE/armed` exists and `send-keys` and `-l` are each one of its arguments (whole words, matched by looping over `"$@"`), removes `armed`, touches `waiting`, and polls for `go` every 0.05 s, at most 160 times (8 s, under the dashboard's 10 s tmux timeout). If it gives up, it touches `gave-up`. Then it runs `exec "$REAL" "$@"`. Any other call runs `exec "$REAL" "$@"` at once (P2-2). The test asserts that `gave-up` doesn't exist right after `await answering`, before the status asserts, so a gate that gave up fails as "the gate gave up", not as 200 versus 409 (F2-2, P3-2). Pass the dashboard `PATH=<gate>:<F.env().PATH>`, plus `GATE` and `REAL`.
2. The steps of spec § pane-question, each wait an `until` on a file or the pane. The asserts are unchanged except that the two sleeps and `DEVTEAM_PANE_ANSWER_DELAY_MS` go.
3. Run the file (Node 22): green, 3 times.
4. Review `reviews/task-4.md`.

### Task 5: test-stress.yml's node input

File: `.github/workflows/test-stress.yml`.

1. Add `node` under `workflow_dispatch.inputs` (`type: choice`, `options: ['20', '22', '24']`, `default: '24'`, a description). setup-node: `node-version: ${{ inputs.node || '24' }}`. Stress step `env:` gains `NODE: ${{ inputs.node || '24' }}`, and `STRESS_TITLE` includes `node $NODE`. Nothing else changes.
2. Run kit-216's `${{`-in-`run:` check script (`docs/devteam-dev/tickets/kit-216-daily-stress-run/`) on the file: clean. Run actionlint (pinned, as kit-216 did): exit 0.
3. Review `reviews/task-5.md`.

### Task 6: proof

1. Merge `origin/main`, push, open the PR (title `kit-214-steady-chrome-tests: Chrome-driven dashboard tests wait on the page, not on timers, and leave no Chrome behind`).
2. `gh workflow run test-stress.yml --ref ticket/kit-214-steady-chrome-tests -f files="test/dashboard.test.mjs test/dashboard-answers.test.mjs test/dashboard-measure.test.mjs test/dashboard-owner-action.test.mjs test/dashboard-shell.test.mjs test/dashboard-teardown.test.mjs test/pane-question.answer.test.mjs" -f repeat=5 -f load=2 -f node=22`, and the same with `-f node=24` (P1-5). The workflow's concurrency group serializes them. Wait with Monitor, not a polling loop. Take the conclusion from `gh run view --json conclusion`, and quote both summaries.
3. test.yml at the head: every job's conclusion. From the `kit (24, rest)` log (spec reporter), each listed file's top-level tests' `(<n>ms)` and their sum, and from step 2's Node 24 summary each file's wall seconds (P1-6).
4. verification.md: a row per done-when, with command, result and sha. Then the final review (`reviews/final-1.md`, a fresh subagent that hasn't seen the build), `check-ticket`, and the merge-request.

## Verification

verification.md has one row per done-when (1–6) and a row for the ruling's pane-question fix, each with the exact command or run id, its result, and the commit.
