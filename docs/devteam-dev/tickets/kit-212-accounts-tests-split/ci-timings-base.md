# kit-212: accounts.test.mjs on the base's test.yml run

test.yml run 43753735288, job "kit (24, rest)" (132933162946), main at de07a84, Node 24, all files 8 at a time (node --test --test-concurrency=8). `bash joblog.sh 43753735288 "kit (24, rest)" <log>` then `node specdur.mjs <log>`, in source order:

| s | test |
|---|---|
| 2.4 | accounts-tick: off, or no cswap, touches nothing; a tick under tmux leaves the supervisor pane alone |
| 6.2 | rotation: runs cswap auto --once with no strategy of its own, reads its events whatever the exit code, and raises findings |
| 6.2 | restarting: a session at the limit menu is relaunched on the active account, no key reaching the menu, once there is room |
| 6.6 | restarting: a banner alone; never another prompt, a busy pane, a parked session, a window that is not a session; once in 10 minutes |
| 3.7 | restarting: a refusal or a failing worktree_setup leaves the old session running |
| 6.2 | restarting: only a session the supervisor launched, in its own worktree, in one pane, with no background shells |
| 4.5 | restarting: a process that ignores the hangup gets a SIGTERM, and only it |
| 16.6 | restarting: 3 times in 6 hours at most, then left alone and reported, until the attempts age out |
| 23.7 | the restart record is untrusted, and a crash's lock can't wedge it |
| 9.0 | a stopped supervisor: reported, in tmux or not, with or without cswap, and never typed into |
| 4.6 | supervisor-session: the supervisor's own conversation, read from disk, and nothing rather than a guess |
| 5.0 | what the accounts say: only known-full accounts are exhausted, and room means every window it has |
| 23.2 | restarting: never on text that only reads like a limit, another harness, a finished session, or a per-model limit |
| 4.6 | files any agent could write can stop nothing |
| 1.9 | the claim: of several ticks at once only one rotates, and the rest of the interval stays quiet |
| 3.2 | the claim: a stale, a future-dated or a mangled one holds nothing, and a live one does |
| 1.8 | leaving a full account: on an expired token with a full last reading, and on a plain full one |
| 1.9 | leaving a full account: the enabled account with the most room is named, and staying put is reported |
| 5.3 | leaving a full account: never onto a slot auto has quarantined, and a state file that makes no sense quarantines nothing |
| 2.1 | leaving a full account: cswap's state is read from where cswap keeps it on this platform |
| 5.4 | leaving a full account: not on unknown usage, an old reading, no room, no claim, or after cswap moved |
| 1.0 | leaving a full account: not once another dashboard has taken the claim over |
| 4.9 | starting a session: a warning on a full active account, never a refusal, and only on fresh news |
| 4.5 | the dashboard: rotation needs no hub, one dashboard does it per interval, and another picks it up; every one looks after its own panes |
| 14.5 | the supervisor's own pane: a lost Enter is pressed, at most three times, never into a prompt, never while it works |

25 tests, sum 169.1 s
