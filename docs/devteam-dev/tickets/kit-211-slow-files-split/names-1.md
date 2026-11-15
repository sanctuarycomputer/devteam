# kit-211 done-when 1: test names, base e8022ac against 0814373

```
## machine

base e8022ac: test/machine.test.mjs (57 tests)
head 0814373: test/machine.box-pins.test.mjs, test/machine.box.test.mjs, test/machine.hub-records.test.mjs, test/machine.run-folder.test.mjs, test/machine.status.test.mjs, test/machine.tell.test.mjs (57 tests)

test/machine.box-pins.test.mjs: 25
test/machine.box.test.mjs: 14
test/machine.hub-records.test.mjs: 3
test/machine.run-folder.test.mjs: 6
test/machine.status.test.mjs: 5
test/machine.tell.test.mjs: 4

sorted names at the head:
  --force skips a sibling whichever sorts first, and never on the list's word
  a kit copied into a home's tree without a repo of its own refuses to run against that home
  a kit refuses a run folder outside its home: a worker's DEVTEAM_RUN leaked into a fixture's kit writes nothing there, and says why
  a kit takes a run folder inside its home, however it is reached: its own, a symlink, one not made yet, a worktree's, a run folder that is itself a symlink
  a pane noted moments ago counts as the supervisor starting only if it started at the repo's root
  a repo on a kit from before recover comes back from the box's list, the way the box always brought it back
  a repo on a kit from before recover: status and tell go by the pane its kit noted, bare as that kit writes it
  a scratch or session-run kit never registers with the machine's hub; a real project root still does
  a session's dashboard doesn't record its project; a plain one and the supervisor's do
  a worker on a repo link keeps every command it uses: cwd in the link's worktree, DEVTEAM_HOME and DEVTEAM_RUN home's
  a worker's run folder gets nothing from the incident's own test, run as it was: a worker's DEVTEAM_RUN, no DEVTEAM_HOME
  after the first deploy, a supervisor only an older image's ages still named stays stopped
  alert reaches the hub, by hello, and clears
  box-deploy refuses a release whose stamp isn't its tag, before it reads the hook
  box-pins bump --release v9.9.9 sets each unheld tool to latest with the assets' real sums
  box-pins check: one line per tool; stale exits 1; held, current; --json the same
  box-pins installed reads each tool by its image path and claude-swap from the image's tool dir
  box-pins verify names each problem and exits 1
  box-pins verify: ok on the kit's own Dockerfile; exit 2 with none
  bump --dry-run prints the change and leaves the file byte-identical
  bump and check refuse a malformed hold
  bump downloads nothing for a tool already current
  bump keeps the file's mode, and writes nothing when nothing changes
  bump refuses a --release older than the stamp, and needs one
  bump sends no token with a download
  bump writes nothing that would not verify, says a failed download in its own words, and bumps a symlink's target (task-3 review)
  bump writes nothing when an upstream fails, or a digest disagrees
  check ignores a GitHub prerelease and a draft, and takes the highest release, not the newest entry
  check on a broken file exits 2 with its problems, in --json too
  check reports an unreachable upstream as unknown, and junk as unknown, never raw
  check sends GH_TOKEN to the GitHub API, and nowhere else
  check: stale wins over unknown; no release, bad JSON and a timeout are unknown (task-2 review)
  each read the operator may run writes nothing
  help names box-pins and says only the top package of npm and PyPI tools is pinned
  hub_window makes home:hub on a real tmux even when another session has a window named home
  importing the test helper leaves no session's DEVTEAM_* or tmux in the environment, only the harness's own knobs
  installed exits 1 naming the tool that differs, or is missing
  installed runs from a repo that is no project, never looks a tool up on PATH, and names a pin given twice (task-4 review)
  installed without DEVTEAM_BOX_TOOLS exits 2
  status names the hub's kit, or says it is no hub, or down
  status says at a glance what a check-in needs, and reads no pane it needn't
  status says the machine's own CPU and memory caps, not the host's
  stray hub records under a temp or scratchpad root are ignored, and status names each once
  tell and status find a project the machine recorded, outside any --in folder
  tell types into a supervisor, marked as not the owner, and only when its pane can take it
  the boot waits for the hub at most DEVTEAM_HUB_WAIT_SECONDS, and notes it gave up
  the boot's hub lines sit where the boot needs them
  the box's boot forgets every repo's noted pane and its mark
  the box's boot keeps the list in the form recover reads
  the box's boot starts the image's hub in home:hub, from the image's kit, with nothing from tmux's environment
  the box's list: a repo that couldn't start stays listed, two at once start one, and a current kit uses its own recover
  the kit lets a box operator look, and nothing else
  the minute loop recreates home:hub only when it is gone
  verify does not count another tool's own ARG as a stray literal
  verify names what it found, where (task-1 review)
  verify takes a hold above the _VERSION ARG, and refuses one with no reason, misplaced or misspelled
  what a pane is at, from what is on it

diff: none

## next-step

base e8022ac: test/next-step.test.mjs (16 tests)
head 0814373: test/next-step.order.test.mjs, test/next-step.rank.test.mjs, test/next-step.strategy.test.mjs (16 tests)

test/next-step.order.test.mjs: 5
test/next-step.rank.test.mjs: 5
test/next-step.strategy.test.mjs: 6

sorted names at the head:
  a default about to fire keeps its place: not halved, above the ordinary questions, and it says so
  a new rating never reopens an answered question, and the hash the owner saw still answers
  a question that settles others ranks above them: stake 3, same goal or feature, and only open ones count
  findings: no strategy, an unrated question once rating has begun, ratings that are all 3
  goal impact: the supervisor judges, the owner corrects with a value, and that value stands
  next prints the top of the Inbox and why; an unrated project prints as it always did
  owner-actions: stake is what cannot go ahead without it, so the ones that stop workers come first (scenario B)
  ratings are said to be the supervisor's, an impact that isn't a level is none, and the history shows a re-rate
  settles-if names a choice however it is cased, as an answer does
  the Inbox shows the order: the next best step on top with its reason, what an answer closes, and the owner's own value for a goal
  the floor: 170 unrated questions bury no one-way door, owner action or blocking question, and an unrated top is no "next best step"
  the formula: impact × stake × urgency, plus the tickets held up; the reason says why
  the order is computed: a goal judged again, a ticket merged, a goal parked, a default; urgency 3 needs something behind it
  the owner gives the settling answer: a finding until the supervisor withdraws each, its own act
  the strategy answer is bound to the text: ask pins the draft, merge refuses any other
  the strategy is the owner's: no PR changes project/strategy.md without an answered strategy-change question

diff: none

## recovery

base e8022ac: test/recovery.test.mjs (35 tests)
head 0814373: test/recovery.recover.test.mjs, test/recovery.relaunch.test.mjs, test/recovery.restart.test.mjs (35 tests)

test/recovery.recover.test.mjs: 16
test/recovery.relaunch.test.mjs: 8
test/recovery.restart.test.mjs: 11

sorted names at the head:
  --if-gone, its window made but nothing typed: says that, not that an old process has gone
  --if-gone: refuses a live window, with nothing typed; two at once, one window
  a machine that died: the tmux session gone, a worker and a planner come back, one a tick, with or without cswap
  a parked or drained fleet's supervisor stays stopped, as recover leaves it
  a person at the pane: a half-typed line or a recently active client leaves it alone, and a re-check that finds nothing costs no attempt
  a process that can't be read: refused, reported, nothing spent
  a supervisor stopped at a limit is restarted on its exact conversation, no key to the old process, once the account has room and has settled
  a supervisor that can't be restarted: the finding and fleet status give the exact command
  a tmux server the tick starts keeps no session markers, so windows opened there can run owner commands
  an ad-hoc agent at the banner in the recorded pane is left alone when the supervisor's own transcript is not at a limit, or its process is not the supervisor
  held, parked, done, merged and superseded sessions, and a removed worktree, are left alone
  no tmux server at all (a reboot): the session is missing, so it is relaunched
  not onto a full account: a known-full active account waits for room
  on Linux a boot is named by the kernel's boot id and init's start, so neither a reboot nor a redeploy is missed
  recover --here: a supervisor from a plain terminal comes back in this one
  recover --machine: every repo recorded on the machine, with each repo's own answer, a sibling skipped
  recover: a dead machine with no tmux server brings the supervisor back on its exact conversation, with the permissions it had, once
  recover: a live supervisor gets no second one, in tmux or in a terminal, even with --force
  recover: a parked or drained fleet stays stopped; --force starts it
  recover: a stale record stays stopped, a record from the future does too, and nothing wedges
  recover: a tick during a start does not read it as stopped, and one after the window does
  recover: one the owner stopped stays stopped, whether a tick saw it or not; --force starts it
  recover: only the Claude Code harness resumes exactly, and the other says so
  recover: the log is no evidence of being up, and the flag is dropped only for someone at a laptop with evidence
  recover: the start is claimed before a window opens, and taken back if nothing started
  recover: two at once on one repo start one supervisor
  the caps: one per 10 minutes, 3 in 6 hours per session, then restart-gave-up; attempts age out
  the key guard: a window closed in a session older than its launch stays closed; a session newer than the launch brings it back
  the race: a supervisor's --resume right after the tick's relaunch leaves it alone; the tick right after the supervisor's finds the window
  the restart keeps the permissions the running supervisor had: no flag it wasn't started with, and the command it prints suggests none
  the supervisor is not restarted when its pane is split, in the wrong directory, or there is no conversation to resume; a non-Claude resume_command is left alone
  the supervisor's own command in a tmux pane counts only under an agent, never from a shell
  the supervisor's restarts share the caps: past 3 in 6 hours it is left alone and reported
  the tick after an upgrade: a bare pane record whose agent runs as the supervisor is marked and kept up; one whose agent doesn't is no pane
  what a crash leaves behind: a stale lock and a mangled record neither stop nor wedge a relaunch

diff: none

## pane-question

base e8022ac: test/pane-question.test.mjs (16 tests)
head 0814373: test/pane-question.answer.test.mjs, test/pane-question.held.test.mjs, test/pane-question.parse.test.mjs (16 tests)

test/pane-question.answer.test.mjs: 6
test/pane-question.held.test.mjs: 5
test/pane-question.parse.test.mjs: 5

sorted names at the head:
  a Claude Code permission menu, as its terminal showed it (2.1.325): the whole dialog, each option, the one under the cursor
  a claim nobody is working goes back as it was: its process gone, or alive but silent for a minute (a pid can be anyone's); one being worked is left alone
  a dialog the card cannot answer still holds what is typed: no numbers, Enter to confirm, a usage-limit menu, a menu the parse misses
  a menu whose digit only moves the cursor gets the Enter; one that takes no digit, or whose cursor is on it already, is left as it is, and said so; a dialog with no numbers is never answered from here
  a message for a pane that is asking is held, not typed; no command answers the question; answered at the terminal, the held lines are typed in order, once
  a question that goes as the key is sent: the digit in the input box is not an answer; it is logged as one that may not have landed, and nothing held is typed
  another account's artifact: the consent prompt, boxed or not, with the cursor on either option; the digest is the dialog's, not the cursor's
  held lines are typed once each, in the order they came, however many processes look at once
  held lines wait for the input box: a second prompt holds them again, an agent with no box gets them after two minutes, and one a day old is let go and logged
  on a box an answer needs the gateway's signature for that press, once: every agent there can send the dashboard any header
  one click is one answer: the same question asked again at once (a retry, two calls in parallel) gets no Enter
  the card never shows less than the click agrees to: nothing dropped, cut or collapsed, and a dialog that cannot be shown whole has no buttons
  the dashboard page: the card at the top of the Inbox and in the dock, the terminal's words as text, at phone width; its buttons wait a second; a click answers; a dialog with no numbers has no buttons
  the dashboard: an answer only from its own page, with that page's token for that question, only a digit, only to the question showing
  what is no question holds nothing: a list in a reply, numbered code, a diff, a busy agent, a draft in the input box, a menu a program printed
  what the card cannot answer is said as it is: a dialog with no numbers, one taller than the pane, the usage-limit menu, a pane that is not the supervisor's

diff: none

## operator-threads

base e8022ac: test/operator-threads.test.mjs (19 tests)
head 0814373: test/operator-threads.hub.test.mjs, test/operator-threads.pane.test.mjs, test/operator-threads.store.test.mjs (19 tests)

test/operator-threads.hub.test.mjs: 4
test/operator-threads.pane.test.mjs: 8
test/operator-threads.store.test.mjs: 7

sorted names at the head:
  DEVTEAM_BOX=off turns the box's files off only for a throwaway home: at the account's own home a box stays a box
  a box keeps them in ~/operator, on the disk that outlives a deploy
  a laptop's operator is started once: by the first words or by start, in its own session, with operator.md as its prompt
  a start's note from a kit that did not name its tmux server is never taken for another session's pane
  an owner turn becomes one line in the operator's pane, and only at its prompt
  inside tmux, list, show and reply are the operator's only from its own pane
  on a box an owner verb run with an idle stdin pipe is refused at once, never left waiting
  on a box the hub takes a press only with the gateway's signature: a local program with the page's own headers is refused
  on a box the operator is window 0 of home: typed into when it is there, never started when it is not
  on a box the owner's verbs take only a press the box's gateway signed, and show says which turns it signed
  on a box the standalone hub takes a press only as the gateway signed it, once, from the hub's own page; a signed one reaches the operator
  settings that can't be read fail the start before its lock is taken
  start-once holds under a C locale, with the window renamed, and when tmux gives no answer
  the Overview in Chrome: the Threads dock, a pin on what it is about across redraws, the operator's reply as text, a phone
  the hub takes the owner's turns only from its own page, within its caps, and starts the laptop's operator on the first
  the store: a thread, its turns, closed and opened again, kept beside the operator in no repo
  turns sent at the same moment each arrive whole: text then Enter, never text, text, Enter, Enter
  what is kept is checked: a turn's size, a title of one line, a subject of the Overview's own shape
  who may write what: the owner starts, says and closes; only the operator replies; no session in a fleet reads or writes

diff: none

```
