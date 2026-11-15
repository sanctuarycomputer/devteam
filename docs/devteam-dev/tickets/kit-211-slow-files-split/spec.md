# kit-211: machine, next-step, recovery, pane-question and operator-threads tests: no file over 60 s alone on CI, no test over 30 s

Feature `tests-light` (stories TESTS-S1, TESTS-S2), design `project/designs/devteam-s-tests-are-light-fast-and-easy-.md` (in devteam-dev): "Splitting the long files" and "After hooks".

## Why

These five files are among the longest after `dashboard.test.mjs` and `accounts.test.mjs`. On test.yml run 43698914484 (main, 8f0a374, Node 24 `rest` job; per-test durations from its spec log, summed per file by top-level test name):

| file | tests | sum on CI | longest test |
|---|---|---|---|
| machine.test.mjs | 57 | 222.4 s | 62.0 s, "a worker's run folder gets nothing from the incident's own test…" |
| next-step.test.mjs | 16 | 95.7 s | 14.8 s |
| operator-threads.test.mjs | 19 | 86.5 s | 19.5 s (Chrome) |
| recovery.test.mjs | 35 | 77.6 s | 8.1 s |
| pane-question.test.mjs | 16 | 61.3 s | 7.7 s |

A file's tests run one after another, so its wall time is about that sum. test.yml still runs the `rest` files 8 at a time with `node --test`, and kit-215 moves it to `test/run.mjs` later. This ticket doesn't touch test.yml, so the per-file and per-test numbers are read from that job as it is.

## Acceptance checks (the done-whens)

1. **No test dropped.** For each of the five files, the sorted top-level test names across its split files at the PR head equal the names in the file at the base. `verification.md` quotes both lists and their diff, made by a script kept in this ticket folder (`names.mjs`). The done-when allows one exception: a test split into parts to get under 30 s, listed against its parts with every assertion kept. Ruling m-20261115-161102170 adds that the total test count equals the count before the split (143), and it makes no exception. So this ticket splits no test. If CI shows a test over 30 s that only a split would fix, I ask the supervisor how the ruling reads before splitting it (see The incident test).
2. **Every resulting file is under 60 s of wall time** on the Node 24 job at the PR head, quoted from the CI log. That job's spec reporter runs the files concurrently and prints no per-file time, so a file's time is the sum of its top-level tests' durations, as in the Why table. The sum leaves out process start-up and the part's preamble: a tmux server, a port claim, git inits, and for `machine.box-pins` one kit copy. Measured locally, that is about 1 to 3 s per part. So the target is a sum of 50 s or less per part, with each part's preamble time from a local run quoted next to it.
3. **No test in them is over 30 s** on that job. The 62 s (95.6 s on an earlier run) incident test is under 30 s or split, with its assertions kept.
4. **Fixed waits replaced** in these files become `until()` polls on the state waited for, and `verification.md` lists each one.
5. **test.yml is green** on every job at the PR head.
6. **After hooks.** In `test/operator-threads*.test.mjs` and `test/pane-question*.test.mjs`, the `t.after` hooks stop what their test started (dashboards, Chrome, tmux, child processes) before they remove its folders (`F.done()`, `rmSync`). Each stop runs on its own, so one that throws can't skip the rest. This is shown once by making the folder removal throw: no process that test started is left, checked by pid. The `try/finally` blocks in operator-threads stop only through `spawnSync('tmux', …)` (`a.kill()`, `kill-session`, `kill-pane`), which returns a status and never throws, so they stay as they are.

## Rulings

- m-20261115-161102170-supervisor (re m-20261115-161050711): five new files are in the touches, `test/lib/{machine,next-step,recovery,pane-question,operator-threads}-fixture.mjs`. Each holds only the preamble its parts share, with no test bodies. Each split file still runs on its own (`node --test test/<part>.test.mjs`). The total test count equals the count before the split.

## Tools (this folder)

- `split.mjs` with `split-plan.mjs` and `chunks.mjs` makes each split. Each test moves byte for byte, with the comment lines above it, in its original order. Imports are recomputed with eslint's `no-undef`/`no-unused-vars` (`lint.mjs`, run against any eslint 9 checkout; the kit has no dependencies). The tool refuses to write if a file has an undefined name.
- `edits.mjs` holds every change made to a part after the split, as exact replacements. The diff from the moved text is that list and nothing else.
- `names.mjs` is done-when 1's comparison.

## Design

### Shape

- Each `test/<name>.test.mjs` is replaced by `test/<name>.<subject>.test.mjs` files, named the way kit-210 names its dashboard split. The original file is removed. Every part matches the ticket's `test/<name>*.test.mjs` touches.
- What the parts share moves to `test/lib/<name>-fixture.mjs`: the imports the helpers need, the env scrubbing, the temp dir, the stubs on PATH, the file's tmux server setup, and the helper functions (`repo`, `agent`, `fixture`, `machine`, `seat`, …). These are module-level side effects, and each part is its own process, so each part gets its own copy, as each file does today. Each part still imports `./lib/kit.mjs` itself (through its fixture), so it claims its own port block.
- Code that only one part uses stays in that part, not the fixture. `split.mjs` moves any top-level statement whose names only one part needs, and that the fixture itself doesn't use, to the top of that part. For machine, that keeps the box-pins setup (`pinsRepo` with its git init and kit copy, `imageKit`, the fake upstreams) in `machine.box-pins`, and the old-kit helpers (`OLD`, `tagsMissing`, `skipOld`) and box-recover helpers in `machine.box`. It also keeps the run-folder decoys in `machine.run-folder`, and the pane-question parser (`fns`, `screen`, `idle`, `bash`, `REAL`) in `pane-question.parse`. `kitAt` stays shared, because the fixture's `repo({ tag })` uses it. So neither the other parts nor the incident child pay for that setup.
- A fixture never imports `./lib/chrome.mjs`. `run.mjs` puts a file in the `chrome` group when the file itself imports it, so only the parts with a Chrome test import it, directly.
- Test bodies move verbatim, except for the changes named below (merged identical reads, waits, hooks, and the incident test's target file). The comments that sit between tests go with the tests they describe.

### The split (estimates from the Why run's per-test sums)

machine (222 s) → six files:
- `machine.run-folder` (env helper, incident, run folder refused/taken, repo-link worker, copied kit): about 33 s, with the incident test at about 20 s (below).
- `machine.status` ("status says at a glance", CPU/memory caps, each operator read writes nothing, box operator looks only, alert): about 32 s.
- `machine.tell` (what a pane is at, tell, tell+status find a recorded project, status names the hub's kit): about 39 s.
- `machine.hub-records` (scratch kit never registers, a session's dashboard doesn't record, stray hub records): about 21 s once the dashboard test's fixed waits go (below).
- `machine.box` (repos on old kits through the box's list, `--force`, the boot's list/panes/hub lines, hub_window, box-deploy, after the first deploy, a pane noted moments ago): about 32 s.
- `machine.box-pins` (every box-pins test): about 7 s.

next-step (96 s) → three files: `next-step.rank` (formula, settles others, settling answer, new rating, settles-if), about 31 s; `next-step.order` (order computed, owner-actions, goal impact, default about to fire, the floor), about 33 s; `next-step.strategy` (findings, strategy answer bound, ratings said, strategy is the owner's, next prints, the Inbox in Chrome), about 32 s.

recovery (78 s) → three files: `recovery.relaunch` (dead machine, no tmux server, key guard, held/parked left alone, --if-gone, the race, the caps, crash leftovers), about 27 s; `recovery.restart` (full account, limit restart, not restarted when…, shared caps, ad-hoc agent, unreadable process, permissions kept, parked fleet, person at the pane, tick-started server, --if-gone nothing typed), about 34 s; `recovery.recover` (the exact command, every `recover:` test, the tick after an upgrade, the supervisor's command under an agent, the Linux boot id), about 17 s.

pane-question (61 s) → three files: `pane-question.parse` (the five parser tests, no tmux), about 0 s; `pane-question.held` (held lines, the race, claims, the input box wait, what the card cannot answer), about 29 s; `pane-question.answer` (the dashboard route, the digit and Enter, one click one answer, the key as it vanishes, the box signature, the page in Chrome), about 32 s.

operator-threads (87 s) → three files: `operator-threads.store` (DEVTEAM_BOX=off, the store, ~/operator, who may write, what is kept, the box's signed verbs, idle stdin), about 29 s; `operator-threads.pane` (owner turn to pane, window 0 on a box, laptop start once, start-once under C locale, unreadable settings, list/show/reply from its pane, simultaneous turns, a start's note without its server), about 28 s; `operator-threads.hub` (the hub's own page and caps, the box hub's signature, the Overview in Chrome, the standalone hub), about 29 s.

If the PR's CI shows a part over 60 s or a test over 30 s, that part or test is split again before the merge request. These groups are estimates.

### The incident test (62 s, done-when 3)

It runs "status says at a glance" in a child `node --test --test-name-pattern 'status says at a glance' <file>`, with a worker's env and a decoy run folder, and checks nothing lands there. Its time is the child's status test. Loading the other 56 tests costs the child about 0.3 s (spec review F1, measured), and the parent has already fetched the old tags while it loaded. Locally, at the box's load of about 11, the split's incident test takes 25.5 s and the status test alone takes 25.9 s. The 62 s against 22 s on CI is therefore load on that run, not setup. The plan:

- The child runs `test/machine.status.test.mjs`, which loads only that part's preamble. The pattern, the TAP checks (`# pass 1`, `# fail 0`, one `ok` for the test, every other one `# SKIP test name does not match pattern`) and the decoy check stay as they are.
- The status test drops two of its ten `machine status` calls. Each costs about 4 s locally and 2 s on CI. Each dropped call repeats a read of a state another call already read. "daily review done" and "new-knowledge=1" now read one call's output. The alert is raised before the "dash=9/DOWN, not behind" read, so that one call also carries "hub … DOWN; alert: …". Every assertion stays. Locally the test goes from 38 s to 26 s.
- On CI I expect about 18 s for the status test and about 20 s for the incident test. If either is over 30 s on the PR's run, I send the supervisor the numbers and two options before changing anything: split the status test in two, with the incident child's pattern naming the part that writes the owner's rule (done-when 1 allows this, the ruling's count doesn't), or cut more `machine status` calls. My recommendation is the first.

### Fixed waits (done-when 4)

Every fixed wait in the five files, by line in the file at the base (e8022ac, before the split):

Replaced with `until()` on the state waited for:
- machine L455, "a session's dashboard doesn't record its project": after each dashboard stops, a 1.5 s sleep let a tick child started just before the stop finish (7 dashboards, 10.5 s). It becomes `until()` no process runs `<repo>/docs/devteam/scripts/devteam.mjs accounts-tick`, read from `ps -A -ww -o args=` (Linux and macOS).
- machine L1022, "hub_window makes home:hub…": a 1.1 s sleep so the next session is created a second after `home`. It becomes `until()` the clock's second is past `home`'s `session_created`.
- recovery L130 and L138, "the key guard": 1.1 s sleeps so a launch and a session fall in different seconds. L130 becomes `until()` the clock's second is past the session's `session_created`. L138 becomes `until()` it is past the launch's second.
- recovery L224, "the race": 0.2 s after `respawn-pane -k` for the agent's window to be a shell again. It becomes `until()` the pane's `pane_current_command` is a shell the kit knows (`sh`, `bash`, `dash` or `zsh`, a leading `-` allowed). It is not enough that the command is no longer `node`: the stub shell's own name shows for a moment before it execs `/bin/sh -i` (spec review N1).

Kept. Each of these waits to see that nothing happens (no second agent, no key, no read), and there is no state to poll for the absence of an event:
- machine L768 and L846 (0.3 s): no second claude after recover is run again.
- recovery L196 and L211 (0.5 s): one agent, not two. L220 (0.3 s): nothing typed into a live agent. L638 and L853 (0.3 s): no second supervisor.
- pane-question L280 (0.5 s): nothing typed over a claim touched just now. L301 (0.3 s): nothing typed into the second prompt. L580 (0.3 s): a click while the buttons wait answers nothing.
- operator-threads L436 and L488 (1.5 s): one agent and one window after concurrent starts. L970 (0.5 s): nothing typed into another session's pane. L944 (5 s): no thread read while a project's dashboard shows.

Kept, a settle with no state to poll: operator-threads L942 (0.8 s) lets reads already in flight land before the count is taken. Whether a fetch is still in flight shows nowhere the test can read.

Kept, timed against an injected delay with no state to poll: pane-question L502 (0.3 s) and L507 (0.9 s), in "a question that goes as the key is sent". The dashboard holds its answer for `DEVTEAM_PANE_ANSWER_DELAY_MS=2500`. The first wait lets the first answer reach the dashboard before the second click. The second lets its looks pass before the Escape, which must land before the key. Neither moment shows outside the dashboard, except by sending another answer, which would change what the test checks.

pane-question L173 is already a poll (`nap(100)` in a loop with a cap) and stays.

### After hooks (done-when 6)

`test/lib/pane-question-fixture.mjs` and `test/lib/operator-threads-fixture.mjs` each export `cleanup(t)`. It returns `later(fn)`, and the first `later` registers one `t.after` that runs the registered fns in reverse order, awaiting each in its own try/catch, then rethrows the first error. A test registers its folder removal first, so it runs last, after every stop:
- pane-question: `t.after(() => F.done())`, `dash()`'s `t.after(() => d.stop())`, `live.kill()` and `chrome.close()` all go through `later`. "what the card cannot answer" (try/finally `F.done()`, nothing else started) stays as it is.
- operator-threads: the hub test's single hook `async () => { await dash.stop(); tmuxSh(kill-session) }` becomes two `later`s. The standalone hub's `rmSync(imageKit)`, `a.kill()` and the hub group kill go through `later` with the removal first. The Chrome test's `chrome.close()` and `p.close()` too.

Shown once (verification, not a kept test). Each test with such hooks is run alone (`--test-name-pattern`) under a preload, `node --import <probe> --test <file>`. The preload:
- makes `fs.rmSync` throw for paths under the test's fixture folders;
- logs the pid of every child the test process spawns, wrapping `child_process.spawn`/`execFile`, with `syncBuiltinESMExports()` so named imports see the wraps;
- wraps `process.emit` so that on `'exit'` it checks every logged pid with `kill -0` before any exit listener runs. That matters because `lib/kit.mjs` prepends an `'exit'` listener that kills leftover dashboards, and `lib/chrome.mjs` adds one for Chrome. Checked after them, the base and the head would look the same (spec review F3).

It also lists any process whose args name the test's fixture folder. The probe is kept in this ticket folder. It runs first at the base, where processes should be left, and then at the head, where none should be. A file that doesn't exit under the probe counts as processes left, killed after 120 s.

## Contracts

None provided or consumed: test files and test-only helpers.

## Edge cases

- A part run on its own (`node --test test/<part>.test.mjs`) must pass. Nothing may depend on a test in another part having run first. The machine `latestRelease` file and the `home` records are per process, so they are already per part.
- Test names must stay byte-identical. `names.mjs` reads them from the sources at the base and at the head.
- macOS: `ps -A -ww -o args=` works on both; `session_created` is in tmux 2.x and 3.x.
- The chrome group: only `next-step.strategy`, `pane-question.answer` and `operator-threads.hub` import `./lib/chrome.mjs`.

## Out of scope

- test.yml, `run.mjs` and `test/timings.json`. Stale weights cost balance only, and the new files weigh the median until kit-215 or a refresh records them.
- The `test/lib/ports.mjs` layout comment ("+10/11 next-step's dashboard (next-step.test.mjs; pinned)") and a comment in `accounts.test.mjs` that names `recovery.test.mjs`. Both are outside the touches, so I'll tell the supervisor; kit-210 rewrites the layout comment.
- Making `machine status` itself faster (kit code).
