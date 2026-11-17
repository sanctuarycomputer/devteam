# kit-274-kit-records-at-home: verification

Code head: see the final pass below (pass 1 was at `70f9e788bd524e493c3cacd8c5c219d0111ec100`, main merged at
b182838e). Local runs: node 18.20.4, one file at a time,
`env -u TMUX -u TMUX_PANE timeout 1500 node --test --test-concurrency=2 <file>`.

| Done-when | Command | Result |
|---|---|---|
| 1. worker.md says where a link ticket's records go (repo by default, home with `records: "home"`) | `grep -n 'records: "home"' docs/devteam/process/worker.md` | pass: line 9, §1 "A ticket in another repo", one sentence (T3, task-3 APPROVE) |
| 2. transition rule: records left in the link pass check-ticket, check-pr and merge with a warning; home wins once home has records; stale verdict and missing records on each side | `node --test test/multirepo-home.test.mjs` (new test "records in home: a ticket whose records were left in the link merges from there until home has some" covers A2, A2b, A2c, A3–A7, plus home's main alone (final-1 F1) and merge/check-pr at the PR head (final-1 F2); the setting test covers A8; the new "records \"repo\" (the default)" test pins the default (final-1 F3)) | pass: 14/14 at 70f9e78; 15/15 after the final-1 fixes (row below). Mutations in task-1 (9: 8 red; the one green is the warn-once guard, F1 wont-fix) and task-2 (3, all red) |
| 2 (A8). existing link and records tests unchanged but for the setting test's home-wins line | `node --test test/multirepo-landing.test.mjs`, and the whole of test/multirepo-home.test.mjs above | pass: 7/7 and 14/14 at 70f9e78 |
| 2 (CI). the whole suite | `devteam.mjs gate ci -- sh /data/home/code/devteam-dev/scripts/devteam-ci-green.sh 70f9e788bd524e493c3cacd8c5c219d0111ec100` | pass: test.yml run 44022492020, all 17 jobs succeeded (first attempt: kit (22, chrome 2/2) failed on test/dashboard-peek.test.mjs "a scrim click and Escape close the peek", a timing assertion outside this change; rerun of the failed job passed; observation o-20261117-051819008) |
| 3. no docs/superpowers/ in the kit; its copy is in devteam-dev first | `git ls-tree -r --name-only HEAD -- docs/superpowers \| wc -l`; `sh docs/devteam/run/t4check.sh` (each of the 35 blobs equals devteam-dev `origin/main:docs/devteam/project/designs/superpowers/<path>`, ruling m-20261117-044852436) | pass: 0 files at 70f9e78; 35 checked, 0 mismatched (devteam-dev main 266895901, T4, task-4 APPROVE) |
| 4. no new file or folder in the kit outside test/ | `git diff --name-status --diff-filter=A origin/main...HEAD` | pass: only files under this ticket's records folder `docs/devteam-dev/tickets/kit-274-kit-records-at-home/`, where the prompt puts them; the supervisor's copy-and-delete chore moves them out (spec, Rollout note) |

Notes:
- plan-2 P2-1: T1's first red was inside `leftInLink`'s approve-plan (`no plan.md for console-01-a on ticket/console-01-a`), as predicted, not the `no records … in home` line the plan named.
- plan-2 P2-2: T4 also reworded one comment in `devteam.mjs` that cited a deleted superpowers spec, and its review checked all 35 files.
- T1 also made review-worktree decide at its sha. The plan had put that in T2, but A2b, which is in T1, needs it (task-1: fine).
- Not deferred: nothing here needs beta. The settings flip (`links.devteam-kit.records: "home"`) and the docs/devteam-dev copy-and-delete are the supervisor's, after merge.

## After final review pass 1

final-1 (CHANGES) F1-F3 and final-1b (APPROVE) F1-F4 fixed, F5 wont-fix (dispositions in the records). New cases' mutations, each run alone (`--test-name-pattern 'left in the link|records "repo"'`): home's-main check removed, red; merge deciding by the views form, red; check-pr deciding by the views form, red; `recordsHomeSetting` always true, red. The whole file and CI at the new head: code head `f896eb38cc4f3e3812b06192837bb037be6e2d09` (main merged); test/multirepo-home.test.mjs 15/15 locally; CI test.yml run 44034160823, all 17 jobs succeeded (`gate ci` logged at that sha). Later commits change only this records folder.
