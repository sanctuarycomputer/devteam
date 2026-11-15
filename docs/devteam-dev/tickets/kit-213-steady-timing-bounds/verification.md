# kit-213 steady timing bounds: verification

Code at fe944433e07627797f83ab043734a1d59b0a4b42 (test/bounds.test.mjs from 68bed83, test/speed.test.mjs from 766e71e; nothing outside this folder has changed since). Local runs are on the box (Node 18.20.4, 32 cores, load about 10), through `run-file.sh`: its own HOME, every `DEVTEAM_*` unset, `DEVTEAM_HUB_PORT=4791`, `nice`, `timeout 600`, `--test-concurrency=2`, one file at a time. Every check is judged by its exit code.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | Every bound is a count or a same-process ratio, with no absolute ms limit left | The table below. `grep -n "Date.now\|ms <\|< base +" test/bounds.test.mjs test/speed.test.mjs` | Every bound is listed before and after. The grep exits 1 (no match) |
| 2 | Both files pass 3 repeats beside 4 CPU burners on a CI runner | `sh docs/devteam-dev/tickets/kit-213-steady-timing-bounds/stress.sh` (= `gh workflow run test-stress.yml --ref ticket/kit-213-steady-timing-bounds -f files="test/bounds.test.mjs test/speed.test.mjs" -f repeat=3 -f load=4`, then `gh run watch`/`gh run view --json conclusion`) | Run [43750016923](https://github.com/sanctuarycomputer/devteam/actions/runs/43750016923) at fe94443: `gh run view 43750016923 --json conclusion` gives `success`, and stress.sh exited 0. Summary below |
| 3 | Each bound fails at 10x | `TMPDIR=<scratch> sh docs/devteam-dev/tickets/kit-213-steady-timing-bounds/tenx.sh <logdir> b1-time b1-count b2 b2b b3 b4 b5` (each patch in `slow-kit.sh`, applied to a scratch copy, never committed) | Every patch exits 1 on its own bound's assertion (the 10x table below) |
| 4 | test.yml green on every job at the PR head | `sh docs/devteam-dev/tickets/kit-213-steady-timing-bounds/ci.sh <log>` (= `devteam.mjs gate ci -- gh run watch <id> --exit-status`, unpiped, then `gh run view <id> --json conclusion,jobs`) | Run [43750392546](https://github.com/sanctuarycomputer/devteam/actions/runs/43750392546) at e33e9e5 (PR #272): gate ci exit 0; conclusion `success`; 8 of 8 jobs success: kit (18/20/22/24, chain) and kit (18/20/22/24, rest). Commits after e33e9e5 change only this ticket's folder; the final head's run is confirmed in the merge request |
| 5 | After hooks stop before they remove; a throwing step skips nothing | `sh slow-kit.sh hooks-last` / `hooks-first`, then `sh check-hooks.sh <copy> last` / `first` | Both checks exit 0 (below) |

Local runs at fe94443's code: `run-file.sh test/bounds.test.mjs` three times, exit 0 each. Ratios, in run order:

| Run | coverage (< 10) | lookups (< 4) | questions (< 4.5) | search (< 8) |
|---|---|---|---|---|
| 1 | 3.51 | 0.97 | 2.83 | 4.65 |
| 2 | 4.57 | 0.96 | 2.30 | 4.06 |
| 3 | 3.39 | 0.89 | 2.49 | 3.49 |

`run-file.sh test/speed.test.mjs` twice, exit 0 each (8 of 8 pass).

The stress run's summary (`summary: 2 files, concurrency 4`; seconds, result):

| File | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| test/bounds.test.mjs | 22.6 ok | 21.6 ok | 20.0 ok |
| test/speed.test.mjs | 35.3 ok | 34.8 ok | 35.3 ok |

The ratios it printed under load (CI: Node 24, 4 vCPU, 4 burners):

| Run | coverage (< 10) | lookups (< 4) | questions (< 4.5) | search (< 8) |
|---|---|---|---|---|
| 1 | 3.45 | 0.95 | 2.05 | 4.04 |
| 2 | 3.31 | 0.99 | 2.10 | 3.81 |
| 3 | 3.09 | 0.99 | 2.09 | 4.19 |

No bound was loosened.

## Every bound, before and after (done-when 1)

Before is at 003d993 (main's version); after is at fe94443.

| # | Before | After |
|---|---|---|
| B1 | bounds:27 `ms < 500`, the best of 3 coverage runs | bounds:38 and :73 `once()`: 31 globs, 31 distinct, compiled in the whole test (count), after the first `coverage()` and at the test's end. That is six `coverage()` runs in all (the first and five timed; spec-2 F2-1: the spec's "six more" should read "five more") plus 900 `ownersOf` asks. bounds:48 `c.x < 10`: `coverage()` over plain RegExps written in the test (ratio). bounds:45 is the reference as an oracle |
| B2 | bounds:32 `ms2 < 500` (asks and lookups together) | bounds:58 no path asked twice, bounds:59 `asked.length <= folders.size` (1,809), counts |
| B2b | (in bounds:32) | bounds:70 `l.x < 4`: 20 rounds of the 5,000 `suggest()` lookups over the same walk up a plain Map (ratio). bounds:66 is the answers as an oracle |
| B3 | bounds:59 `ms < base + 1500` (200 questions) | bounds:98 `r.x < 4.5`: `questions --json` over `goal list` on 2,000 questions, best of 5 interleaved (ratio) |
| B4 | bounds:81 `ms < base + 1000` | bounds:119 `r.x < 8`: `search` over `knowledge --status accepted`, best of 3 interleaved (ratio) |
| B5 | speed:187 `Date.now() - t0 < 15000` | speed:197 `held.every(alive)`: every `send-keys` the fake tmux started is still running at the reply (order, a count of ended ones = 0) |
| B6 | speed `refresh`/`peek` `<= 2 * 4`, `a[0] === a[1]`, `a[0] <= 12` | unchanged (speed:243, :246, :250, :251), already counts |

Hang guards, not bounds, left as they are, because none decides pass or fail on a healthy run: speed:170 `{ timeout: 120000 }`, speed:237 `{ timeout: 600000 }`, speed:192 `AbortSignal.timeout(60000)`, `until()`'s default wait, and `startDashboard().stop()`'s wait in `test/lib/kit.mjs`.

**B3 detects a slowdown of the Inbox read as a whole, not of ranking alone** (ruling m-20261115-185641944-supervisor). `inboxRanks` is a few percent of `questions --json`'s own work. Made 10x slower on its own it moves the ratio from about 2.4 to about 3.6 on the box, under the 4.5 bound. A slowdown in ranking alone, short of a blow-up many times larger, is below what this bound detects.

## Each bound fails at 10x (done-when 3)

Each row is one run of `tenx.sh` with that patch on a fresh scratch copy of fe94443's tests and kit. The test is the affected one (`--test-name-pattern`). The message is the test's own assertion.

| Patch | Exact change in the copy | Exit | Failing assertion |
|---|---|---|---|
| b1-time | `coverage()`: `for (let k = 0; k < 9; k++) ownersIn(p, L, null);` before `const owners = ownersIn(p, L, count);` | 1 | `coverage of 50k paths x 30 globs took 1174 ms against 43 ms, 27.25x … (bound 10x)` |
| b1-count | `globToRegex`: `const hit = globCache.get(g);` → `const hit = null;`, and `globMatcher`: `let m = matcherCache.get(entry);` → `let m;` | 1 | `each glob compiled once in the process, not per call or per path: 27186 compiled (after six coverage runs and 900 owner asks)` |
| b2 | `ownerSuggestions`: `if (who === undefined) who = ownerOf(p);` → `{ for (let k = 0; k < 9; k++) ownerOf(p); who = ownerOf(p); }` | 1 | `no path asked twice` |
| b2b | the closure `ownerSuggestions` returns walks up 9 extra times before its real walk | 1 | `100,000 suggestion lookups took 224 ms against 23 ms, 9.85x … (bound 4x)` (9.85 is over 1.5 × 4, as plan-2 P2-1 asked) |
| b3 | `cmdQuestions` starts with `for (let k = 0; k < 9; k++) rankQuestions(questionsNow());` | 1 | `reading and ranking 2,000 questions took 1143 ms against 149 ms, 7.65x … (bound 4.5x)` |
| b4 | `cmdSearch`: `for (let k = 0; k < 9; k++) searchRank(searchIndex(docs), q, { limit });` before the real one | 1 | `search took 7579 ms against 347 ms, 21.82x … (bound 8x)` |
| b5 | `nudgeSupervisor`: the line `if (REPLY_FD !== null) return void queuedNudges.push(line);` removed (it types before the reply) | 1 | `replied with send-keys 1204231 already ended, of 1204231` (tmux's 30 s limit killed it before the reply) |

## After hooks (done-when 5)

`check-hooks.sh` runs the dashboard test in the patched copy. It requires the test to fail with the patch's error, then for every printed pid `ps -p` must exit 1. No process may have the dashboard's pid as its process group, and none may end with it as an argument (the watcher). For `first`, the test's folder must be gone.

| Patch | The step made to throw | Printed pids | Result |
|---|---|---|---|
| hooks-last | the folder removal (the last step) | dashboard 1212978, send-keys 1213288 and 1213404 | test exit 1; every pid gone; group 1212978 and its watcher: none left; `check-hooks last: ok` (exit 0) |
| hooks-first | writing `release` (the first step, before the stop) | dashboard 1213876, send-keys 1214040 | test exit 1; every pid gone; group and watcher: none left; the folder removed; `check-hooks first: ok` (exit 0) |

The git-processes test's fixtures each clean up in their own step of the same helper. A fixture is registered for cleanup as soon as it is made, so a later fixture's setup throwing can't leak it.
