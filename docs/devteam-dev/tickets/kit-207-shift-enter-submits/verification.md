# kit-207-shift-enter-submits: verification

At commit `3bb181914377c50bc960b2afec9a79ab2db34850` (the code is unchanged since `ee8f1d4`; later commits add only this ticket's records). Browser tests ran on the box with Node 22 (`/usr/local/bin/node`) and Chrome, each test alone at `--test-concurrency=2`, as the box rule says.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | In a question card's note box, Shift+Enter presses that card's Answer (the which-choice step kept); in a thread's reply box, Shift+Enter sends; plain Enter makes a new line; nothing is sent while IME composition is active | `devteam.mjs gate test -- /usr/local/bin/node --test --test-concurrency=2 --test-name-pattern='threads on the dashboard page' test/dashboard.test.mjs`: subtests "Shift+Enter in the thread box sends once; …" and "Shift+Enter in a question box presses its Answer: …" | pass 34, fail 0 (gate test passed in 99.6 s). RED first for each: before Task 1, plain Enter sent the thread box's words (`'' !== 'kept line one\n'`); before Task 2, no which-choice ask came (timed out) |
| 1 | kit-203's which-choice step unchanged | `… --test-name-pattern='^a typed answer on a question with choices asks which choice' test/dashboard.test.mjs` | pass 8, fail 0 |
| 2 | Every copy of a question card (Inbox and thread), every thread reply box, and the new-thread box | the same threads test: the Inbox copy `#q-<id>` and the thread copy `#t-q-<id>` answered by Shift+Enter; the dock's New thread sent by Shift+Enter (the dock subtest) | pass |
| 2 | The ten earlier sends from the thread box, now Shift+Enter | `… --test-name-pattern` set in turn to `threads on the dashboard page`, `^presses: the page answers before the server`, `^Shift over an artifact`, `^Shift over a preview, through the relay` | 33/33, 6/6, 16/16, 18/18 at Task 1 (`f190cf4`) |
| 3 | A test covers both boxes: Shift+Enter submits once (no double post on key repeat), Enter adds a newline | the two new subtests: plain Enter with `\r` adds `\n` and posts nothing; a lone `autoRepeat` Shift+Enter in a box with words posts nothing and adds no `\n`; Shift+Enter then a repeat → exactly one post (the fixture's `window.__posts`) and one turn / one answer, still one after 2.5 s | pass |
| 4 | test.yml passes on every job; no file is added | `devteam.mjs gate ci -- gh run watch 43675442804 --exit-status`; `git diff --name-only --diff-filter=A origin/main` | 8/8 jobs success at `3bb1819` (gate ci passed in 437.6 s); the only added files are under `docs/devteam-dev/tickets/kit-207-shift-enter-submits/` |

Nothing is deferred to beta.

Not driven by a test, read by the reviewers: a review card's note box presses Send it back, a secret card's presses Reply, and Alt or Meta takes the same early return as Ctrl (task-1 T1, task-2).
