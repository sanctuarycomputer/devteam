# kit-214 steady Chrome tests: spec

Ticket: `kit-214-steady-chrome-tests` (feature `tests-light`, serves TESTS-S3, size S, risk normal). Depends on kit-216 (`test-stress.yml`), merged at 1769b43.

## Intent

The Chrome-driven dashboard tests fail most merges on `kit (22, rest)`, and a re-run passes them. A failure there should mean the dashboard is broken, not that the runner was slow. This ticket fixes the causes found in CI's logs, makes the dashboard files' teardown unable to leave a process behind, and takes the fixed timer waits out of the tests that failed.

## Rulings

- m-20261115-181143331-supervisor: priority is the Node 22 rest flakes in test/dashboard.test.mjs ('ready 5,000 times', pins) and test/pane-question.test.mjs:493 (now `test/pane-question.answer.test.mjs:140`); see o-20261115-072522062 and o-20261115-170119646. Prove each fix with kit-216's test-stress.yml. Trial a-20261115-074130886: one combined spec and plan review. Lessons k-20261115-174344487 (now k-20261115-182656232), k-20261115-080753394 and k-20261115-164245020 go in every brief.
- m-20261115-181403894-supervisor (answering m-20261115-181343212): `test/pane-question.answer.test.mjs` and `test/lib/pane-question-fixture.mjs` are in touches. Done-when 5 excludes `test/dashboard.test.mjs` (kit-210 splits it, after this ticket) and is measured on test.yml's Node 24 rest job (there is no chrome job). Each teardown step runs on its own (its own try/finally or after hook), and done-when 1's test proves Chrome is gone after a throw.
- m-20261115-185043423-supervisor (answering m-20261115-185020730): `.github/workflows/test-stress.yml` is in touches. Add a `node` input, `type: choice`, with options 20, 22 and 24 and default 24. It reaches the job only through `with:`/`env:`, never inlined into `run:` text. The schedule keeps 24. Every limit kit-216 set stays: `contents: read`, no secrets, the concurrency group, the timeouts, and schedule and dispatch as the only triggers. Quote the Node 22 stress run in verification.md.
- m-20261115-182700815-supervisor: k-20261115-182656232 replaces k-20261115-174344487: never cap node or the test runner with `prlimit --as` (Node, Wasm and the Chrome it starts need the address space); cap only non-Node probes; `timeout` on everything.

## What CI shows (evidence)

From the failed jobs of test.yml in the last 300 runs, including the failed first attempts of re-run runs (`gh run view <id> --attempt <n>`). Every Chrome-file failure is on Node 22.

| Class | Seen | Cause (found) |
|---|---|---|
| A. Whole-file cancel: `cancelledByParent`, "Promise resolution is still pending but the event loop has already resolved", starting at one Chrome test and taking every later test in the file | ~8 jobs (dashboard.test.mjs at 'presses', 'pins', 'the viewer', 'Shift over an artifact', 'the Loop') | `openChrome().close()` sends SIGTERM, then SIGKILL after 3 s, and resolves on the Chrome process's `exit` event. The process and its stderr are `unref()`ed at start. When Chrome is slow to act on SIGTERM (a loaded runner), the 3 s timer fires, and from then nothing holds the event loop while `close()` waits for `exit`. Node finds the loop empty and cancels the file. All five subtests of 'presses' passed in 43689334561 before the parent was cancelled: its after hooks were running. Reproduced on the box (Node 22.23): open Chrome, SIGSTOP it, `await close()`: the process exits 13, "unsettled top-level await". |
| B. Hook failure, then a 600 s hang | 2 jobs (dashboard-owner-action, runs 43744144857 and 43736923328) | `t.after` hooks run in the order they were registered, and the first that throws stops the rest. The folder removal is registered first, so it runs while the dashboard still writes into it (ENOTEMPTY). `dash.stop()` and `chrome.close()` never run, and the live dashboard holds the file open until `--test-timeout` (600 s). |
| C. 'a page that says ready 5,000 times' fails "5,000 readies drawn 3 times" | 2 jobs | It counts every `tlDraw` call over a window that includes two fixed 300 ms sleeps. The page's 300 ms poll and its threads read also redraw, so a slow runner gets a third draw that has nothing to do with the readies. |
| D. 'a question that goes as the key is sent' (pane-question) gets 200, not 409 | 1 job | Timing. The dashboard waits `DEVTEAM_PANE_ANSWER_DELAY_MS` (2.5 s) between its last look and the key. The test sleeps 300 ms, posts again, sleeps 900 ms and then presses Escape. On a slow runner the Escape lands after the key. |
| E. Typing: "timed out: 1 polls" in every subtest | 7 first attempts, the latest about job 1324086xxxxx; none since | Not reproduced (on the box, plain and with 2 burners on 2 pinned cores, Node 22). The fixed 300 ms sleep in its radio subtest goes (done-when 2). The stress run is the evidence that it holds. If it comes back, it gets an observation, not a guess. |

Why only Node 22 (F1-4): not known. Classes A and B are not version-specific as written (the SIGSTOP repro is deterministic on any Node that has WebSocket). A guess, not a finding: on Node 24, Chrome acts on SIGTERM inside 3 s more often, or the child's exit is delivered differently. The fixes don't depend on the version. The proof covers Node 22 (done-when 3), and the teardown test runs on 22 and 24 in test.yml.

## Acceptance checks (the done-whens)

1. **No Chrome left after a throw.** A new file, `test/dashboard-teardown.test.mjs` (Chrome-driven, imports `./lib/chrome.mjs`), runs a child test file that it writes into its own temp folder. The child opens Chrome through `lib/chrome.mjs`, opens a page, prints Chrome's pid (the process group `openChrome` started; `openChrome()` now returns `pid`), and throws mid-page. A second case does the same with Chrome stopped (SIGSTOP) before the throw, which is class A's slow SIGTERM made certain. After the child exits, the parent checks that no process is left in that group (`process.kill(-pid, 0)` fails with ESRCH, polled for up to 5 s while the kernel reaps). The second case also checks that the child's later test ran: `# pass 1`, `# fail 1`, `# cancelled 0`. The group check is the done-when itself, but it also passes at main: chrome.mjs already SIGKILLs the group when the file's process exits. The SIGSTOP case's TAP counts are what tell main from the fix, and verification.md says so (F1-7). The child runs in its own process group (spawned detached, with a 120 s timer). On a timeout, the parent kills that group, and every group the child printed, before it fails, so a regression leaves nothing behind (P1-1). *Check:* the file passes on Node 22 and 24 in test.yml. Before the fix (lib/chrome.mjs at main), the SIGSTOP case fails: it is run once against main's chrome.mjs to show the test catches class A, and the result is quoted.
2. **No fixed delays in the tests that failed.** In these tests, every `await new Promise((r) => setTimeout(r, N))` (and the `settle()` helper built on one) is replaced by a wait on state (a soon/until poll on DOM or log state, a count of the page's own polls or reads, a message round trip, or two animation frames):
   - presses: `test/dashboard.test.mjs` 'presses: the page answers before the server, and a refusal puts it back' (it has none; its failure was class A);
   - typing: 'typing in the dashboard: a refresh never takes the field, the caret or the scroll, and holding it can't wedge' (the radio subtest's 300 ms);
   - threads: 'threads on the dashboard page: Shift and point, the card, the pins and the dock' (`settle()` 2.5 s, four uses; the drawer subtest's 200 ms);
   - viewer reload: "the viewer's reload button says when a newer version is ready, and the press loads it" (two 3 s waits);
   - and, from the ruling: 'pins on an artifact: …' (its 'ready 5,000 times' subtest's two 300 ms) and `test/pane-question.answer.test.mjs` 'a question that goes as the key is sent: …' (300 ms, 900 ms, and the dashboard's 2.5 s delay).

   *Check:* verification.md lists each by name and file. A grep of each test's body at the PR head finds no `setTimeout(r, <n>)` or `setTimeout(w, <n>)` wait. Timers inside page-side fixture scripts (POLL_FAST and the like) are the page's, not the test's waits.
3. **5 repeats under load.** Every `test/dashboard*.test.mjs` that imports `lib/chrome.mjs` (at this head: `dashboard.test.mjs`, `dashboard-answers`, `-measure`, `-owner-action`, `-shell`, and the new `-teardown`) passes `gh workflow run test-stress.yml --ref ticket/kit-214-steady-chrome-tests -f files="<those>" -f repeat=5 -f load=2`. *Check:* run id and conclusion (`gh run view --json conclusion`), and the summary table, quoted. The same dispatch runs again with `-f node=22` (F1-4; ruling m-20261115-185043423). Both runs are quoted, and both are green. Also, `test/pane-question.answer.test.mjs` runs at repeat 5, load 2, on Node 22 and on 24.
4. **test.yml green.** Every job is green at the PR head. *Check:* run id and per-job conclusions, from `gh run view --json jobs`, never from a log excerpt.
5. **Time.** On the `kit (24, rest)` job at the PR head, each of those files except `test/dashboard.test.mjs` takes under 60 s, and no test in them over 30 s. *Check:* that job's log uses the spec reporter, which prints `✔ <test> (<n>ms)` per test and no time per file (F1-5). For each file, the check quotes each top-level test's time and their sum (top-level tests in a file run one at a time, so the sum is the file's test time), plus the file's wall seconds from done-when 3's stress run summary (run.mjs, under load: an upper bound). At main: answers 15.0 s, measure 8.7 s, owner-action 22.7 s. A file over gets split or sped up in this ticket.
6. **Teardown stops everything, each step on its own.** Every test in `test/dashboard*.test.mjs` that registers more than one teardown step uses a single helper, `cleanup(t)`, exported from `test/lib/chrome.mjs`. It returns `later(fn)`, and runs the steps last-registered first, each in its own try. The first error is thrown once all have run. So a removal registered first runs after every stop, and one step that throws skips none of the others. The tests that already did this by hand (`const undo = []`) use the helper too. *Check:* in `test/dashboard-teardown.test.mjs`, a child test starts a real dashboard (`dashboardOnFreePort`), Chrome and a page, a plain child process (`node -e` holding a timer), and an http server. It registers, in this order: the folder removal, made to throw ENOTEMPTY, then the stops. The parent checks by pid that the dashboard's process group, Chrome's group and the child are all gone, and that the child file ended (no 600 s hang). A grep at the PR head finds no test in those files with two or more bare `t.after(` calls.

## Design

### lib/chrome.mjs

- `close()`: re-`ref()` the Chrome process when closing starts, so the wait for its `exit` holds the event loop. Keep the 3 s SIGTERM→SIGKILL step. Add a bound: if no `exit` comes 5 s after the SIGKILL, finish anyway. `done()` always calls `proc.unref()` and removes its `exit` listener, so on the bound path the process handle no longer holds the loop (F1-1). The bound's timer is ref'd, so the loop stays up until it fires. The teardown test covers it: a child SIGSTOPs Chrome, then removes the `exit` listeners from its ChildProcess (so `exit` never reaches `close()`), and calls `close()`. The child checks that `close()` resolves within 10 s, and the parent checks that the file ended by itself with nothing cancelled. For this, `openChrome()` also returns the ChildProcess as `proc`, for tests.
- `newPage()`: when the page's WebSocket closes or errors, reject every call still waiting, with an error that says so (and Chrome's exit code or signal if it has gone). A test then fails with a cause, not a 30 s "no answer" or an empty loop.
- `openChrome()` returns `pid` (the leader of Chrome's process group), for done-when 1's check.
- `cleanup(t)`: the teardown helper (done-when 6), with the same contract as `test/lib/pane-question-fixture.mjs`'s `cleanup`. The fixture's copy becomes a re-export of chrome.mjs's, so there is one (F1-9a).

### test-stress.yml

A `node` input under `workflow_dispatch` (`type: choice`, options `'20'`, `'22'`, `'24'`, default `'24'`). setup-node takes `node-version: ${{ inputs.node || '24' }}` in `with:`, which is not `run:` text, so a scheduled run (no inputs) gets 24. The stress step gets `NODE: ${{ inputs.node || '24' }}` in `env:` and puts `node $NODE` into its summary title. `run:` text holds no `${{`. Nothing else in the file changes. *Check:* the diff, kit-216's `${{`-in-`run:` check script (its ticket folder) run on the new file, and actionlint.

### Dashboard files

- Mechanical: in each test with two or more teardown steps, `const later = cleanup(t);` and `t.after(` → `later(`; `undo` stacks → `later`. Order of registration is kept, and the helper reverses it.
- Class C ('ready 5,000 times'): hold the page's poll and threads answers still (`window.__still()`, POLL_FAST's own) for the measured window, so only the readies can call `tlDraw`; `__stir()` after. Replace each 300 ms "beat" with a round trip through the frame: post a marker to the artifact and wait for its `heard` echo. Messages from one window to another arrive in order, so anything the page posted to the lens before the marker has been heard by the time the echo comes back. The "the tab answered in under 5,000 ms" stopwatch stays: it is the bound the test is about. (Its failures were the draw count, not the stopwatch.)
- typing radio: the 300 ms becomes "scroll at rest". After the space, wait (in the page) until `scrollY` has been unchanged for 10 consecutive animation frames, giving up after 3 s. A smooth scroll moves on every frame until it ends, so a scroll in progress can't read as at rest. Then `jumped` is compared (F1-3).
- threads `settle()`: becomes `ticks(8)`: the page's own polls (`window.__polls`, every 300 ms under POLL_FAST), counted 8 past the value at the call. That is about 2.4 s of the page's own time, the window `settle()` gave, now measured in the page's ticks instead of the test's clock (F1-6).
- threads drawer 200 ms: becomes one animation-frame pair after the move. Then it checks that the cursor is hidden.
- viewer reload 3 s: "nothing reloaded by itself" after the page's own next check has landed and a frame load could have followed (F1-2). The test adds a fetch wrapper of its own that records each read's url, start order and when its body was read. On the dashboard it waits for `/api/data` reads (the read whose fingerprint drives the outline, `load()` → `avFpSeen`) that started after the outline showed and whose body has been read. In the viewer tab it waits for `/api/view?` checks that meet the same two conditions. In both, it waits for two such reads, not one. A reload the first one set off has then had a whole 10 s tick to load its frame and say `ready`, which `__titles` records. Then it checks `__titles`. The wait is about 20 s, longer than the 3 s it replaces.

### pane-question.answer:140 (class D)

The dashboard runs `tmux` from its PATH. The test gives that dashboard (only) a PATH whose first entry is a folder holding a `tmux` wrapper script. The wrapper passes every call through to the tmux that PATH found before, except the first call with `send-keys` and `-l` as whole arguments (the digit) while an `armed` file exists. That call writes `waiting` and waits until `go` exists, polling every 50 ms and giving up after 8 s, under the dashboard's own 10 s tmux timeout (F1-8). Then it passes through. The test:

1. posts the answer and waits until `waiting` exists, so the dashboard is between its last look and the key;
2. posts the second answer: 409 "another answer is on its way" (no 300 ms guess);
3. presses Escape in the pane and waits until the pane shows its input box (the fixture's next screen);
4. writes `go`, and the first answer comes back 409 "may not have landed …".

`DEVTEAM_PANE_ANSWER_DELAY_MS` is no longer set by this test. The kit keeps the variable (removing it is outside touches), and an observation asks for its removal (F1-9b).

## Contracts

None provided or consumed. `test/lib/chrome.mjs` gains `pid`, `proc` and `cleanup`, all additive. Its other callers (`browser-view-page`, `hub-overview`, `hub-measure`, `operator-threads.hub`, `next-step.strategy`, `pane-question.answer`, `run.test.mjs`) get the `close()` fix and need no change.

## Edge cases

- Chrome already gone when `close()` starts: `done()` runs at once (unchanged).
- A Chrome that never reports `exit` after SIGKILL: the 5 s bound ends `close()`, `done()` unrefs the process, and the loop is held only until then.
- The SIGSTOP case: SIGKILL ends a stopped process, so its group goes. The child then removes the profile folder.
- The tmux wrapper must not block a held line typed after a success. It blocks only the first `send-keys -l` and removes `armed` before waiting.
- `__still()` held across a `tell()`: `tell` needs no poll, only messages, so it isn't blocked.
- On Node 18 and 20, `canDrive` is false (no global WebSocket), so the teardown file's Chrome cases skip. Its non-Chrome parts (the child process and http server stops) still run.

## Out of scope

- Splitting `test/dashboard.test.mjs` (kit-210), and its time.
- The other fixed sleeps in dashboard.test.mjs, in tests that didn't fail (11 s at :1126, 1.5 s at :1301, 1 s at :1957, :4007, :4011, :4118). They get an observation for kit-210.
- Chrome-driven files outside `test/dashboard*` (hub-overview, browser-view-page, operator-threads.hub, next-step.strategy): they get the lib fix, nothing else.
- Removing `DEVTEAM_PANE_ANSWER_DELAY_MS` from the kit.
