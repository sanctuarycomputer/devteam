# kit-240 verification

At `d7905c7a84b3c9cb6e7881923db83da9283ca6a0` (the code as pushed; later commits add only records).

| Done-when | Command | Result |
|---|---|---|
| 1. the order: work in progress (uncommitted changes, a planner the owner waits on, a worker in build) before workers idle on a dependency; ties keep launch order | `devteam.mjs gate test -- node --test --test-concurrency=2 test/recovery.relaunch.test.mjs`, tests 9 and 10 ("the order: …") | pass. Mutations (scratch copies, task reviews): the `.git` guard removed, the unanswered check removed, `waiting_on_owner` removed and the open-thread filter removed each fail test 9 or 10 |
| 2. a ticket with a held field is not relaunched (`held()` reads `isHeld`) | same run, test 4 ("held (a held ticket too) …") | pass; with the `isHeld` clause removed it fails (task-1 review) |
| 3. under the memory ceiling up to 3 a tick, each under the restart record and caps; at or over it 1 | same run, tests 11 ("up to 3 a tick …"), 1 ("one a tick at the memory ceiling"), 12 (`worktree_setup`: a later relaunch needs the full 100 s; passed-over sessions are not claimed) | pass. Mutations (task-3 review): cap always 3 fails tests 1, 3, 8, 9, 10; cap always 1 fails 11; the 100 s rule dropped fails 12 |
| 4. supervisor.md §11's relaunch bullet says the order, that a held ticket stays down, and the per-tick count | `git show d7905c7:docs/devteam/process/supervisor.md`, §11 "After a dead machine" | present; reviewed in task-4 |
| whole file, no regressions | same run | 12 pass, 0 fail, exit 0 |
| neighbouring tick tests (plan-1 P8) | `node --test --test-concurrency=2` on each of test/recovery.restart.test.mjs and test/accounts.{leaving,restart-guards,restart,rotation,supervisor,untrusted}.test.mjs, one at a time (at 6c95eaa; d7905c7 adds only the PR body) | all exit 0: 10, 7, 4, 3, 6, 4, 2 pass, 0 fail |
| CI (the gate) | `devteam.mjs gate ci -- gh run watch 43861205206 --exit-status`; `gh run view 43861205206 --json conclusion,headSha` | gate passed in 295.3 s; `{"conclusion":"success","headSha":"d7905c7a84b3c9cb6e7881923db83da9283ca6a0"}` |

Nothing is deferred to beta: the relaunch after a real machine stop is the same `accounts-tick` path the tests drive with real tmux.
