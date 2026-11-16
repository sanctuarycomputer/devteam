# kit-212 done-whens 2-3: each part on test.yml's Node 24 rest job at the PR head

PR #278, test.yml run **43762624100**, job "kit (24, rest)" (132960585675), at **85b6447f276106ed7036cb339e019edef39127ff**, Node 24, all rest files 8 at a time (test.yml unchanged). Conclusion: success, all 8 jobs. `bash joblog.sh 43762624100 "kit (24, rest)" <log>`, then `node specdur.mjs <log> test/accounts.<part>.test.mjs` per part. A part's figure is the sum of its top-level tests' times as the spec reporter prints them (it prints no per-file time; ruling m-20261115-210355679).

## test/accounts.rotation.test.mjs

| s | test |
|---|---|
| 1.7 | accounts-tick: off, or no cswap, touches nothing; a tick under tmux leaves the supervisor pane alone |
| 4.3 | rotation: runs cswap auto --once with no strategy of its own, reads its events whatever the exit code, and raises findings |
| 3.7 | what the accounts say: only known-full accounts are exhausted, and room means every window it has |
| 1.8 | the claim: of several ticks at once only one rotates, and the rest of the interval stays quiet |
| 2.7 | the claim: a stale, a future-dated or a mangled one holds nothing, and a live one does |
| 4.3 | the dashboard: rotation needs no hub, one dashboard does it per interval, and another picks it up; every one looks after its own panes |

6 tests, sum 18.6 s

## test/accounts.leaving.test.mjs

| s | test |
|---|---|
| 1.6 | leaving a full account: on an expired token with a full last reading, and on a plain full one |
| 1.5 | leaving a full account: the enabled account with the most room is named, and staying put is reported |
| 5.0 | leaving a full account: never onto a slot auto has quarantined, and a state file that makes no sense quarantines nothing |
| 1.7 | leaving a full account: cswap's state is read from where cswap keeps it on this platform |
| 5.0 | leaving a full account: not on unknown usage, an old reading, no room, no claim, or after cswap moved |
| 1.1 | leaving a full account: not once another dashboard has taken the claim over |
| 4.1 | starting a session: a warning on a full active account, never a refusal, and only on fresh news |

7 tests, sum 20.0 s

## test/accounts.restart.test.mjs

| s | test |
|---|---|
| 4.9 | restarting: a session at the limit menu is relaunched on the active account, no key reaching the menu, once there is room |
| 5.0 | restarting: a banner alone; never another prompt, a busy pane, a parked session, a window that is not a session; once in 10 minutes |
| 26.3 | restarting: never on text that only reads like a limit, another harness, a finished session, or a per-model limit |

3 tests, sum 36.2 s

## test/accounts.restart-guards.test.mjs

| s | test |
|---|---|
| 3.2 | restarting: a refusal or a failing worktree_setup leaves the old session running |
| 5.5 | restarting: only a session the supervisor launched, in its own worktree, in one pane, with no background shells |
| 3.8 | restarting: a process that ignores the hangup gets a SIGTERM, and only it |
| 14.8 | restarting: 3 times in 6 hours at most, then left alone and reported, until the attempts age out |

4 tests, sum 27.2 s

## test/accounts.untrusted.test.mjs

| s | test |
|---|---|
| 18.9 | the restart record is untrusted, and a crash's lock can't wedge it |
| 6.0 | files any agent could write can stop nothing |

2 tests, sum 24.9 s

## test/accounts.supervisor.test.mjs

| s | test |
|---|---|
| 5.1 | a stopped supervisor: reported, in tmux or not, with or without cswap, and never typed into |
| 3.2 | supervisor-session: the supervisor's own conversation, read from disk, and nothing rather than a guess |
| 14.9 | the supervisor's own pane: a lost Enter is pressed, at most three times, never into a prompt, never while it works |

3 tests, sum 23.3 s

