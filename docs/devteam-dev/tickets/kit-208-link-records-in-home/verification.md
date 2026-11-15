# kit-208 verification

Local runs: `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- node --test --test-concurrency=2 test/multirepo-home.test.mjs`
(the only test file in touches; ruling m-20261115-183216730: nothing else runs on the box), exit code read directly.
At c55ddd0ae09f1052b194a45c505f665e780c62ca: exit 0, 13 pass, 0 fail (the tmux-guarded worker launch ran).
Each new test was first run against the previous commit's `devteam.mjs` and failed (the red step).

| Done-when | Command | Result |
|---|---|---|
| 1. A repo link setting (`records: "home"`) makes worker, check-ticket, merge and review-worktree read and write a link ticket's records under home's `project/tickets/<id>/` on home's ticket branch; the default stays as today | the multirepo-home tests "the setting …", "check-ticket reads them …", "the worker's records worktree and prompt, review-worktree's records checkout, timeline, and --remove", "a parked worker is settled only once …"; the default path: the unchanged multirepo tests in CI | pass at c55ddd0 (local); CI run 43763014700 success at c55ddd0 (the default-path multirepo tests included) |
| 2. merge checks the records in home at the reviewed head and refuses if they are missing | multirepo-home "merge checks the records at one pinned sha …" (no records refused; origin vs local pinning both ways; verdict at both heads) and "check-ticket reads them …" (merge --dry-run refusals: link-folder file, footprint, missing `- Records:`) | pass at c55ddd0 |
| 3. A test: a link with records in home merges a ticket whose PR changes only product files, and its records are in home | multirepo-home "merge checks the records at one pinned sha and lands them first; a half-done merge says so and a retry finishes it once": console's main gets only `src/main.js`, home's main gets spec, plan, verification and reviews; the half-done merge and its retry (ruling m-20261115-185317950) | pass at c55ddd0 |
| 4. test.yml passes on every job; no file is added | CI on PR #273 (`gh run view <id> --json conclusion,jobs`); `git diff --name-status origin/main...HEAD -- . ':!docs/devteam-dev'` shows only M lines | CI run 43763014700 at c55ddd0: conclusion success, all 8 kit jobs (18/20/22/24 × chain/rest) success; no file added: only `M docs/devteam/scripts/devteam.mjs`, `M test/multirepo-home.test.mjs` |

## CI

- Code head c55ddd0ae09f1052b194a45c505f665e780c62ca: the final-1b, final-2b, final-3b, final-3 and final-4b fixes, with origin/main merged in at 0f859bc (kit-213; it touches neither file of this ticket). Commits after it are records only.
- `gh run view 43763014700 --json headSha,conclusion,jobs`: headSha a2dbe9f… (c55ddd0 plus the final-4 record), conclusion success; jobs kit (18|20|22|24, chain|rest) all success.
- `devteam.mjs gate ci -- gh run watch 43763014700 --exit-status`: exit 0. (A gate ci line just before it failed with no run id: it was started before GitHub created the run; no test failed.)
- Earlier heads: 43761286639 at 1db2215, 43758118181 at 8298e95, 43755384416 at 0f859bc (after re-running a dashboard.test.mjs flake on kit (22, rest)), 43754504396 at 03308f4, 43752481891 at b2974d1: each 8/8. Dashboard flakes on Node 22 rest logged as observations.
- Mutations (scratch copies, restored): removing any one of landedRecordsHeads' checks alone (brought in by its merge, ancestry, footprint, tree) fails a test: the first three "a hand-made merge borrowing the records subject…", the tree check the in-folder evil merge in the half-done test.
