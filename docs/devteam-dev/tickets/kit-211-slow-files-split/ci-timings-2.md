# kit-211: each split file alone on a CI runner (done-whens 2-3)

Ruling m-20261115-165039090 (option A): judged alone on a CI runner. Workflow `.github/workflows/kit-211-timing.yml` (temporary, deleted before the final review), run **43738924102**, job 132887567541, ubuntu-latest, Node 24, at **0814373fbbf5bae9c556bf903e4036a3c8d65e3c** (the merge of origin/main): `node test/run.mjs --concurrency 1` over the 18 files. Wall = the runner's per-file seconds (process start-up and preamble included); per test = each top-level test's `duration_ms` from its TAP (`tapdur.mjs`). An earlier run at 2f1b48f (43738132662) gave the same picture (slowest file 38.7 s, slowest test 23.6 s).

- test/machine.box-pins.test.mjs: wall 10.4 s (ok), 25 tests, sum 10.1 s, longest 1.7 s
- test/machine.box.test.mjs: wall 36.8 s (ok), 14 tests, sum 33.9 s, longest 11.6 s
- test/machine.hub-records.test.mjs: wall 14.2 s (ok), 3 tests, sum 14.0 s, longest 8.4 s
- test/machine.run-folder.test.mjs: wall 26.4 s (ok), 6 tests, sum 26.2 s, longest 21.0 s
- test/machine.status.test.mjs: wall 34.3 s (ok), 5 tests, sum 34.1 s, longest 20.7 s
- test/machine.tell.test.mjs: wall 19.4 s (ok), 4 tests, sum 19.2 s, longest 7.7 s
- test/next-step.order.test.mjs: wall 14.2 s (ok), 5 tests, sum 14.0 s, longest 5.6 s
- test/next-step.rank.test.mjs: wall 12.4 s (ok), 5 tests, sum 12.3 s, longest 4.8 s
- test/next-step.strategy.test.mjs: wall 16.1 s (ok), 6 tests, sum 15.9 s, longest 4.4 s
- test/recovery.recover.test.mjs: wall 18.2 s (ok), 16 tests, sum 18.0 s, longest 2.1 s
- test/recovery.relaunch.test.mjs: wall 13.7 s (ok), 8 tests, sum 13.6 s, longest 2.6 s
- test/recovery.restart.test.mjs: wall 22.3 s (ok), 11 tests, sum 22.1 s, longest 4.7 s
- test/pane-question.answer.test.mjs: wall 22.1 s (ok), 6 tests, sum 22.0 s, longest 5.5 s
- test/pane-question.held.test.mjs: wall 12.8 s (ok), 5 tests, sum 12.7 s, longest 3.4 s
- test/pane-question.parse.test.mjs: wall 0.1 s (ok), 5 tests, sum 0.0 s, longest 0.0 s
- test/operator-threads.hub.test.mjs: wall 23.2 s (ok), 4 tests, sum 23.0 s, longest 16.2 s
- test/operator-threads.pane.test.mjs: wall 16.5 s (ok), 8 tests, sum 16.4 s, longest 5.4 s
- test/operator-threads.store.test.mjs: wall 31 s (ok), 7 tests, sum 11.0 s, longest 3.7 s
tests over 30 s: 0; files over 60 s wall: 0

## Every test, per file, slowest first

### test/machine.box-pins.test.mjs: wall 10.4 s (ok), 25 tests, sum 10.1 s, longest 1.7 s

| s | test |
|---|---|
| 1.7 | verify names what it found, where (task-1 review) |
| 1.2 | check: stale wins over unknown; no release, bad JSON and a timeout are unknown (task-2 review) |
| 1.1 | bump writes nothing that would not verify, says a failed download in its own words, and bumps a symlink's target (task-3 review) |
| 0.8 | box-pins check: one line per tool; stale exits 1; held, current; --json the same |
| 0.6 | box-pins verify names each problem and exits 1 |
| 0.4 | bump writes nothing when an upstream fails, or a digest disagrees |
| 0.4 | verify takes a hold above the _VERSION ARG, and refuses one with no reason, misplaced or misspelled |
| 0.3 | installed runs from a repo that is no project, never looks a tool up on PATH, and names a pin given twice (task-4 review) |
| 0.3 | bump keeps the file's mode, and writes nothing when nothing changes |
| 0.3 | installed exits 1 naming the tool that differs, or is missing |
| 0.3 | box-pins verify: ok on the kit's own Dockerfile; exit 2 with none |
| 0.3 | check sends GH_TOKEN to the GitHub API, and nowhere else |
| 0.3 | check reports an unreachable upstream as unknown, and junk as unknown, never raw |
| 0.3 | box-pins bump --release v9.9.9 sets each unheld tool to latest with the assets' real sums |
| 0.2 | bump and check refuse a malformed hold |
| 0.2 | bump refuses a --release older than the stamp, and needs one |
| 0.2 | box-pins installed reads each tool by its image path and claude-swap from the image's tool dir |
| 0.2 | check on a broken file exits 2 with its problems, in --json too |
| 0.2 | verify does not count another tool's own ARG as a stray literal |
| 0.2 | bump --dry-run prints the change and leaves the file byte-identical |
| 0.2 | bump downloads nothing for a tool already current |
| 0.2 | bump sends no token with a download |
| 0.2 | check ignores a GitHub prerelease and a draft, and takes the highest release, not the newest entry |
| 0.1 | help names box-pins and says only the top package of npm and PyPI tools is pinned |
| 0.1 | installed without DEVTEAM_BOX_TOOLS exits 2 |

### test/machine.box.test.mjs: wall 36.8 s (ok), 14 tests, sum 33.9 s, longest 11.6 s

| s | test |
|---|---|
| 11.6 | a repo on a kit from before recover comes back from the box's list, the way the box always brought it back |
| 6.5 | --force skips a sibling whichever sorts first, and never on the list's word |
| 5.9 | the box's list: a repo that couldn't start stays listed, two at once start one, and a current kit uses its own recover |
| 3.3 | a repo on a kit from before recover: status and tell go by the pane its kit noted, bare as that kit writes it |
| 2.2 | after the first deploy, a supervisor only an older image's ages still named stays stopped |
| 2.1 | the boot waits for the hub at most DEVTEAM_HUB_WAIT_SECONDS, and notes it gave up |
| 1.8 | a pane noted moments ago counts as the supervisor starting only if it started at the repo's root |
| 0.4 | hub_window makes home:hub on a real tmux even when another session has a window named home |
| 0.2 | box-deploy refuses a release whose stamp isn't its tag, before it reads the hook |
| 0.1 | the box's boot starts the image's hub in home:hub, from the image's kit, with nothing from tmux's environment |
| 0.0 | the box's boot keeps the list in the form recover reads |
| 0.0 | the minute loop recreates home:hub only when it is gone |
| 0.0 | the box's boot forgets every repo's noted pane and its mark |
| 0.0 | the boot's hub lines sit where the boot needs them |

### test/machine.hub-records.test.mjs: wall 14.2 s (ok), 3 tests, sum 14.0 s, longest 8.4 s

| s | test |
|---|---|
| 8.4 | a session's dashboard doesn't record its project; a plain one and the supervisor's do |
| 2.9 | a scratch or session-run kit never registers with the machine's hub; a real project root still does |
| 2.7 | stray hub records under a temp or scratchpad root are ignored, and status names each once |

### test/machine.run-folder.test.mjs: wall 26.4 s (ok), 6 tests, sum 26.2 s, longest 21.0 s

| s | test |
|---|---|
| 21.0 | a worker's run folder gets nothing from the incident's own test, run as it was: a worker's DEVTEAM_RUN, no DEVTEAM_HOME |
| 2.1 | a kit takes a run folder inside its home, however it is reached: its own, a symlink, one not made yet, a worktree's, a run folder that is it |
| 1.2 | a kit refuses a run folder outside its home: a worker's DEVTEAM_RUN leaked into a fixture's kit writes nothing there, and says why |
| 1.1 | a worker on a repo link keeps every command it uses: cwd in the link's worktree, DEVTEAM_HOME and DEVTEAM_RUN home's |
| 0.8 | a kit copied into a home's tree without a repo of its own refuses to run against that home |
| 0.1 | importing the test helper leaves no session's DEVTEAM_* or tmux in the environment, only the harness's own knobs |

### test/machine.status.test.mjs: wall 34.3 s (ok), 5 tests, sum 34.1 s, longest 20.7 s

| s | test |
|---|---|
| 20.7 | status says at a glance what a check-in needs, and reads no pane it needn't |
| 7.3 | each read the operator may run writes nothing |
| 3.9 | the kit lets a box operator look, and nothing else |
| 1.8 | alert reaches the hub, by hello, and clears |
| 0.3 | status says the machine's own CPU and memory caps, not the host's |

### test/machine.tell.test.mjs: wall 19.4 s (ok), 4 tests, sum 19.2 s, longest 7.7 s

| s | test |
|---|---|
| 7.7 | tell types into a supervisor, marked as not the owner, and only when its pane can take it |
| 4.9 | what a pane is at, from what is on it |
| 4.5 | status names the hub's kit, or says it is no hub, or down |
| 2.2 | tell and status find a project the machine recorded, outside any --in folder |

### test/next-step.order.test.mjs: wall 14.2 s (ok), 5 tests, sum 14.0 s, longest 5.6 s

| s | test |
|---|---|
| 5.6 | the order is computed: a goal judged again, a ticket merged, a goal parked, a default; urgency 3 needs something behind it |
| 3.9 | goal impact: the supervisor judges, the owner corrects with a value, and that value stands |
| 2.6 | owner-actions: stake is what cannot go ahead without it, so the ones that stop workers come first (scenario B) |
| 1.1 | a default about to fire keeps its place: not halved, above the ordinary questions, and it says so |
| 0.9 | the floor: 170 unrated questions bury no one-way door, owner action or blocking question, and an unrated top is no "next best step" |

### test/next-step.rank.test.mjs: wall 12.4 s (ok), 5 tests, sum 12.3 s, longest 4.8 s

| s | test |
|---|---|
| 4.8 | a question that settles others ranks above them: stake 3, same goal or feature, and only open ones count |
| 3.5 | the formula: impact × stake × urgency, plus the tickets held up; the reason says why |
| 1.8 | the owner gives the settling answer: a finding until the supervisor withdraws each, its own act |
| 1.6 | a new rating never reopens an answered question, and the hash the owner saw still answers |
| 0.7 | settles-if names a choice however it is cased, as an answer does |

### test/next-step.strategy.test.mjs: wall 16.1 s (ok), 6 tests, sum 15.9 s, longest 4.4 s

| s | test |
|---|---|
| 4.4 | the strategy is the owner's: no PR changes project/strategy.md without an answered strategy-change question |
| 3.3 | the Inbox shows the order: the next best step on top with its reason, what an answer closes, and the owner's own value for a goal |
| 3.1 | findings: no strategy, an unrated question once rating has begun, ratings that are all 3 |
| 2.1 | the strategy answer is bound to the text: ask pins the draft, merge refuses any other |
| 1.6 | next prints the top of the Inbox and why; an unrated project prints as it always did |
| 1.4 | ratings are said to be the supervisor's, an impact that isn't a level is none, and the history shows a re-rate |

### test/recovery.recover.test.mjs: wall 18.2 s (ok), 16 tests, sum 18.0 s, longest 2.1 s

| s | test |
|---|---|
| 2.1 | recover --machine: every repo recorded on the machine, with each repo's own answer, a sibling skipped |
| 1.4 | recover: a dead machine with no tmux server brings the supervisor back on its exact conversation, with the permissions it had, once |
| 1.4 | recover: a parked or drained fleet stays stopped; --force starts it |
| 1.4 | the tick after an upgrade: a bare pane record whose agent runs as the supervisor is marked and kept up; one whose agent doesn't is no pane |
| 1.3 | recover: a live supervisor gets no second one, in tmux or in a terminal, even with --force |
| 1.3 | recover: the log is no evidence of being up, and the flag is dropped only for someone at a laptop with evidence |
| 1.2 | recover: two at once on one repo start one supervisor |
| 1.2 | a supervisor that can't be restarted: the finding and fleet status give the exact command |
| 1.1 | recover: one the owner stopped stays stopped, whether a tick saw it or not; --force starts it |
| 1.1 | recover: the start is claimed before a window opens, and taken back if nothing started |
| 1.0 | recover: a tick during a start does not read it as stopped, and one after the window does |
| 0.9 | recover: a stale record stays stopped, a record from the future does too, and nothing wedges |
| 0.8 | on Linux a boot is named by the kernel's boot id and init's start, so neither a reboot nor a redeploy is missed |
| 0.7 | the supervisor's own command in a tmux pane counts only under an agent, never from a shell |
| 0.7 | recover: only the Claude Code harness resumes exactly, and the other says so |
| 0.4 | recover --here: a supervisor from a plain terminal comes back in this one |

### test/recovery.relaunch.test.mjs: wall 13.7 s (ok), 8 tests, sum 13.6 s, longest 2.6 s

| s | test |
|---|---|
| 2.6 | the race: a supervisor's --resume right after the tick's relaunch leaves it alone; the tick right after the supervisor's finds the window |
| 2.5 | the key guard: a window closed in a session older than its launch stays closed; a session newer than the launch brings it back |
| 2.0 | the caps: one per 10 minutes, 3 in 6 hours per session, then restart-gave-up; attempts age out |
| 1.6 | what a crash leaves behind: a stale lock and a mangled record neither stop nor wedge a relaunch |
| 1.5 | --if-gone: refuses a live window, with nothing typed; two at once, one window |
| 1.4 | a machine that died: the tmux session gone, a worker and a planner come back, one a tick, with or without cswap |
| 1.1 | held, parked, done, merged and superseded sessions, and a removed worktree, are left alone |
| 0.9 | no tmux server at all (a reboot): the session is missing, so it is relaunched |

### test/recovery.restart.test.mjs: wall 22.3 s (ok), 11 tests, sum 22.1 s, longest 4.7 s

| s | test |
|---|---|
| 4.7 | the restart keeps the permissions the running supervisor had: no flag it wasn't started with, and the command it prints suggests none |
| 4.2 | the supervisor is not restarted when its pane is split, in the wrong directory, or there is no conversation to resume; a non-Claude resume_c |
| 3.3 | a person at the pane: a half-typed line or a recently active client leaves it alone, and a re-check that finds nothing costs no attempt |
| 2.6 | a parked or drained fleet's supervisor stays stopped, as recover leaves it |
| 2.4 | an ad-hoc agent at the banner in the recorded pane is left alone when the supervisor's own transcript is not at a limit, or its process is n |
| 2.0 | a supervisor stopped at a limit is restarted on its exact conversation, no key to the old process, once the account has room and has settled |
| 0.9 | the supervisor's restarts share the caps: past 3 in 6 hours it is left alone and reported |
| 0.8 | not onto a full account: a known-full active account waits for room |
| 0.7 | a tmux server the tick starts keeps no session markers, so windows opened there can run owner commands |
| 0.5 | --if-gone, its window made but nothing typed: says that, not that an old process has gone |
| 0.0 | (skipped) a process that can't be read: refused, reported, nothing spent |

### test/pane-question.answer.test.mjs: wall 22.1 s (ok), 6 tests, sum 22.0 s, longest 5.5 s

| s | test |
|---|---|
| 5.5 | a menu whose digit only moves the cursor gets the Enter; one that takes no digit, or whose cursor is on it already, is left as it is, and sa |
| 5.4 | the dashboard page: the card at the top of the Inbox and in the dock, the terminal's words as text, at phone width; its buttons wait a secon |
| 4.0 | a question that goes as the key is sent: the digit in the input box is not an answer; it is logged as one that may not have landed, and noth |
| 3.0 | one click is one answer: the same question asked again at once (a retry, two calls in parallel) gets no Enter |
| 2.4 | the dashboard: an answer only from its own page, with that page's token for that question, only a digit, only to the question showing |
| 1.7 | on a box an answer needs the gateway's signature for that press, once: every agent there can send the dashboard any header |

### test/pane-question.held.test.mjs: wall 12.8 s (ok), 5 tests, sum 12.7 s, longest 3.4 s

| s | test |
|---|---|
| 3.4 | a claim nobody is working goes back as it was: its process gone, or alive but silent for a minute (a pid can be anyone's); one being worked  |
| 2.7 | what the card cannot answer is said as it is: a dialog with no numbers, one taller than the pane, the usage-limit menu, a pane that is not t |
| 2.4 | a message for a pane that is asking is held, not typed; no command answers the question; answered at the terminal, the held lines are typed  |
| 2.4 | held lines wait for the input box: a second prompt holds them again, an agent with no box gets them after two minutes, and one a day old is  |
| 1.8 | held lines are typed once each, in the order they came, however many processes look at once |

### test/pane-question.parse.test.mjs: wall 0.1 s (ok), 5 tests, sum 0.0 s, longest 0.0 s

| s | test |
|---|---|
| 0.0 | a Claude Code permission menu, as its terminal showed it (2.1.325): the whole dialog, each option, the one under the cursor |
| 0.0 | the card never shows less than the click agrees to: nothing dropped, cut or collapsed, and a dialog that cannot be shown whole has no button |
| 0.0 | another account's artifact: the consent prompt, boxed or not, with the cursor on either option; the digest is the dialog's, not the cursor's |
| 0.0 | a dialog the card cannot answer still holds what is typed: no numbers, Enter to confirm, a usage-limit menu, a menu the parse misses |
| 0.0 | what is no question holds nothing: a list in a reply, numbered code, a diff, a busy agent, a draft in the input box, a menu a program printe |

### test/operator-threads.hub.test.mjs: wall 23.2 s (ok), 4 tests, sum 23.0 s, longest 16.2 s

| s | test |
|---|---|
| 16.2 | the Overview in Chrome: the Threads dock, a pin on what it is about across redraws, the operator's reply as text, a phone |
| 3.8 | the hub takes the owner's turns only from its own page, within its caps, and starts the laptop's operator on the first |
| 2.8 | on a box the hub takes a press only with the gateway's signature: a local program with the page's own headers is refused |
| 0.3 | on a box the standalone hub takes a press only as the gateway signed it, once, from the hub's own page; a signed one reaches the operator |

### test/operator-threads.pane.test.mjs: wall 16.5 s (ok), 8 tests, sum 16.4 s, longest 5.4 s

| s | test |
|---|---|
| 5.4 | start-once holds under a C locale, with the window renamed, and when tmux gives no answer |
| 3.1 | a laptop's operator is started once: by the first words or by start, in its own session, with operator.md as its prompt |
| 2.4 | an owner turn becomes one line in the operator's pane, and only at its prompt |
| 1.9 | inside tmux, list, show and reply are the operator's only from its own pane |
| 1.3 | on a box the operator is window 0 of home: typed into when it is there, never started when it is not |
| 1.1 | turns sent at the same moment each arrive whole: text then Enter, never text, text, Enter, Enter |
| 0.8 | a start's note from a kit that did not name its tmux server is never taken for another session's pane |
| 0.2 | settings that can't be read fail the start before its lock is taken |

### test/operator-threads.store.test.mjs: wall 31 s (ok), 7 tests, sum 11.0 s, longest 3.7 s

| s | test |
|---|---|
| 3.7 | who may write what: the owner starts, says and closes; only the operator replies; no session in a fleet reads or writes |
| 3.2 | on a box the owner's verbs take only a press the box's gateway signed, and show says which turns it signed |
| 1.9 | the store: a thread, its turns, closed and opened again, kept beside the operator in no repo |
| 1.9 | what is kept is checked: a turn's size, a title of one line, a subject of the Overview's own shape |
| 0.2 | on a box an owner verb run with an idle stdin pipe is refused at once, never left waiting |
| 0.1 | a box keeps them in ~/operator, on the disk that outlives a deploy |
| 0.1 | DEVTEAM_BOX=off turns the box's files off only for a throwaway home: at the account's own home a box stays a box |

