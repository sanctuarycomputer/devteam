# kit-212 done-when 1: names at the base and the head

`node names.mjs de07a84 38399c8 accounts`, exit 0:

```
## accounts

base de07a84: test/accounts.test.mjs (25 tests)
head 38399c8: test/accounts.leaving.test.mjs, test/accounts.restart-guards.test.mjs, test/accounts.restart.test.mjs, test/accounts.rotation.test.mjs, test/accounts.supervisor.test.mjs, test/accounts.untrusted.test.mjs (25 tests)

test/accounts.leaving.test.mjs: 7
test/accounts.restart-guards.test.mjs: 4
test/accounts.restart.test.mjs: 3
test/accounts.rotation.test.mjs: 6
test/accounts.supervisor.test.mjs: 3
test/accounts.untrusted.test.mjs: 2

sorted names at the head:
  a stopped supervisor: reported, in tmux or not, with or without cswap, and never typed into
  accounts-tick: off, or no cswap, touches nothing; a tick under tmux leaves the supervisor pane alone
  files any agent could write can stop nothing
  leaving a full account: cswap's state is read from where cswap keeps it on this platform
  leaving a full account: never onto a slot auto has quarantined, and a state file that makes no sense quarantines nothing
  leaving a full account: not on unknown usage, an old reading, no room, no claim, or after cswap moved
  leaving a full account: not once another dashboard has taken the claim over
  leaving a full account: on an expired token with a full last reading, and on a plain full one
  leaving a full account: the enabled account with the most room is named, and staying put is reported
  restarting: 3 times in 6 hours at most, then left alone and reported, until the attempts age out
  restarting: a banner alone; never another prompt, a busy pane, a parked session, a window that is not a session; once in 10 minutes
  restarting: a process that ignores the hangup gets a SIGTERM, and only it
  restarting: a refusal or a failing worktree_setup leaves the old session running
  restarting: a session at the limit menu is relaunched on the active account, no key reaching the menu, once there is room
  restarting: never on text that only reads like a limit, another harness, a finished session, or a per-model limit
  restarting: only a session the supervisor launched, in its own worktree, in one pane, with no background shells
  rotation: runs cswap auto --once with no strategy of its own, reads its events whatever the exit code, and raises findings
  starting a session: a warning on a full active account, never a refusal, and only on fresh news
  supervisor-session: the supervisor's own conversation, read from disk, and nothing rather than a guess
  the claim: a stale, a future-dated or a mangled one holds nothing, and a live one does
  the claim: of several ticks at once only one rotates, and the rest of the interval stays quiet
  the dashboard: rotation needs no hub, one dashboard does it per interval, and another picks it up; every one looks after its own panes
  the restart record is untrusted, and a crash's lock can't wedge it
  the supervisor's own pane: a lost Enter is pressed, at most three times, never into a prompt, never while it works
  what the accounts say: only known-full accounts are exhausted, and room means every window it has

diff: none

```

Base list (`git show de07a84:test/accounts.test.mjs`, sorted):

```
sorted names at the head:
  a stopped supervisor: reported, in tmux or not, with or without cswap, and never typed into
  accounts-tick: off, or no cswap, touches nothing; a tick under tmux leaves the supervisor pane alone
  files any agent could write can stop nothing
  leaving a full account: cswap's state is read from where cswap keeps it on this platform
  leaving a full account: never onto a slot auto has quarantined, and a state file that makes no sense quarantines nothing
  leaving a full account: not on unknown usage, an old reading, no room, no claim, or after cswap moved
  leaving a full account: not once another dashboard has taken the claim over
  leaving a full account: on an expired token with a full last reading, and on a plain full one
  leaving a full account: the enabled account with the most room is named, and staying put is reported
  restarting: 3 times in 6 hours at most, then left alone and reported, until the attempts age out
  restarting: a banner alone; never another prompt, a busy pane, a parked session, a window that is not a session; once in 10 minutes
  restarting: a process that ignores the hangup gets a SIGTERM, and only it
  restarting: a refusal or a failing worktree_setup leaves the old session running
  restarting: a session at the limit menu is relaunched on the active account, no key reaching the menu, once there is room
  restarting: never on text that only reads like a limit, another harness, a finished session, or a per-model limit
  restarting: only a session the supervisor launched, in its own worktree, in one pane, with no background shells
  rotation: runs cswap auto --once with no strategy of its own, reads its events whatever the exit code, and raises findings
  starting a session: a warning on a full active account, never a refusal, and only on fresh news
  supervisor-session: the supervisor's own conversation, read from disk, and nothing rather than a guess
  the claim: a stale, a future-dated or a mangled one holds nothing, and a live one does
  the claim: of several ticks at once only one rotates, and the rest of the interval stays quiet
  the dashboard: rotation needs no hub, one dashboard does it per interval, and another picks it up; every one looks after its own panes
  the restart record is untrusted, and a crash's lock can't wedge it
  the supervisor's own pane: a lost Enter is pressed, at most three times, never into a prompt, never while it works
  what the accounts say: only known-full accounts are exhausted, and room means every window it has

```
