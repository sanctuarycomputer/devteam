# kit-208 verification

Local runs: `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- node --test --test-concurrency=2 test/multirepo-home.test.mjs`
(the only test file in touches; ruling m-20261115-183216730: nothing else runs on the box), exit code read directly.
At b2974d1a11bfb1e91c18ba62f5a28460bbd54cd1: exit 0, 11 pass, 0 fail (the tmux-guarded worker launch ran).
Each new test was first run against the previous commit's `devteam.mjs` and failed (the red step).

| Done-when | Command | Result |
|---|---|---|
| 1. A repo link setting (`records: "home"`) makes worker, check-ticket, merge and review-worktree read and write a link ticket's records under home's `project/tickets/<id>/` on home's ticket branch; the default stays as today | the multirepo-home tests "the setting …", "check-ticket reads them …", "the worker's records worktree and prompt, review-worktree's records checkout, timeline, and --remove", "a parked worker is settled only once …"; the default path: the unchanged multirepo tests in CI | pass at b2974d1 (local); CI run 43752481891 success at b2974d1 (the default-path multirepo tests included) |
| 2. merge checks the records in home at the reviewed head and refuses if they are missing | multirepo-home "merge checks the records at one pinned sha …" (no records refused; origin vs local pinning both ways; verdict at both heads) and "check-ticket reads them …" (merge --dry-run refusals: link-folder file, footprint, missing `- Records:`) | pass at b2974d1 |
| 3. A test: a link with records in home merges a ticket whose PR changes only product files, and its records are in home | multirepo-home "merge checks the records at one pinned sha and lands them first; a half-done merge says so and a retry finishes it once": console's main gets only `src/main.js`, home's main gets spec, plan, verification and reviews; the half-done merge and its retry (ruling m-20261115-185317950) | pass at b2974d1 |
| 4. test.yml passes on every job; no file is added | CI on PR #273 (`gh run view <id> --json conclusion,jobs`); `git diff --name-status origin/main...HEAD -- . ':!docs/devteam-dev'` shows only M lines | CI run 43752481891 at b2974d1: conclusion success, all 8 kit jobs (18/20/22/24 × chain/rest) success; no file added: only `M docs/devteam/scripts/devteam.mjs`, `M test/multirepo-home.test.mjs` |

## CI

- Code head b2974d1a11bfb1e91c18ba62f5a28460bbd54cd1 (no code or test change after it; later commits are records only).
- `gh run view 43752481891 --json headSha,conclusion,jobs`: headSha b2974d1…, conclusion success; jobs kit (18|20|22|24, chain|rest) all success.
- `devteam.mjs gate ci -- gh run watch 43752481891 --exit-status`: exit 0 (gate line in the log).
- An earlier run, 43751152745 at 7ced60b, failed only kit (22, rest) on "the dashboard measure: every listed page at three sizes" (cancelledByParent, an event-loop flake in a dashboard test this change doesn't touch); observation o-20261115-192726892. The runs since are green.
