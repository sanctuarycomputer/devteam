# kit-208 verification

Local runs: `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- node --test --test-concurrency=2 test/multirepo-home.test.mjs`
(the only test file in touches; ruling m-20261115-183216730: nothing else runs on the box), exit code read directly.
At 8298e95f2af60354a4858f0580684d8a0ee9a633: exit 0, 12 pass, 0 fail (the tmux-guarded worker launch ran).
Each new test was first run against the previous commit's `devteam.mjs` and failed (the red step).

| Done-when | Command | Result |
|---|---|---|
| 1. A repo link setting (`records: "home"`) makes worker, check-ticket, merge and review-worktree read and write a link ticket's records under home's `project/tickets/<id>/` on home's ticket branch; the default stays as today | the multirepo-home tests "the setting …", "check-ticket reads them …", "the worker's records worktree and prompt, review-worktree's records checkout, timeline, and --remove", "a parked worker is settled only once …"; the default path: the unchanged multirepo tests in CI | pass at 8298e95 (local); CI run 43758118181 success at 8298e95 (the default-path multirepo tests included) |
| 2. merge checks the records in home at the reviewed head and refuses if they are missing | multirepo-home "merge checks the records at one pinned sha …" (no records refused; origin vs local pinning both ways; verdict at both heads) and "check-ticket reads them …" (merge --dry-run refusals: link-folder file, footprint, missing `- Records:`) | pass at 8298e95 |
| 3. A test: a link with records in home merges a ticket whose PR changes only product files, and its records are in home | multirepo-home "merge checks the records at one pinned sha and lands them first; a half-done merge says so and a retry finishes it once": console's main gets only `src/main.js`, home's main gets spec, plan, verification and reviews; the half-done merge and its retry (ruling m-20261115-185317950) | pass at 8298e95 |
| 4. test.yml passes on every job; no file is added | CI on PR #273 (`gh run view <id> --json conclusion,jobs`); `git diff --name-status origin/main...HEAD -- . ':!docs/devteam-dev'` shows only M lines | CI run 43758118181 at 8298e95: conclusion success, all 8 kit jobs (18/20/22/24 × chain/rest) success; no file added: only `M docs/devteam/scripts/devteam.mjs`, `M test/multirepo-home.test.mjs` |

## CI

- Code head 8298e95f2af60354a4858f0580684d8a0ee9a633: the final-1b and final-2b fixes, with origin/main merged in at 0f859bc (kit-213; it touches neither file of this ticket). Commits after it are records only.
- `gh run view 43758118181 --json headSha,conclusion,jobs`: headSha 8298e95…, conclusion success; jobs kit (18|20|22|24, chain|rest) all success, first attempt.
- `devteam.mjs gate ci -- gh run watch 43758118181 --exit-status`: exit 0.
- Earlier heads: run 43755384416 at 0f859bc (8/8 after re-running kit (22, rest), a dashboard.test.mjs flake this change doesn't touch); 43754504396 at 03308f4 and 43752481891 at b2974d1, 8/8. Dashboard flakes on Node 22 rest logged as observations (o-20261115-192726892 and flaky:dashboard-node22-rest).
