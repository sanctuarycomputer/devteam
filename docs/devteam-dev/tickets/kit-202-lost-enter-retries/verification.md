# kit-202 verification

Code head verified: `4f28e3f4a9baf89a42859429fa0f0558d9e63c4f` (PR #282, draft). Commits after it add only this ticket's records.

| # | Done-when | Command | Result |
|---|---|---|---|
| 1 | A pane whose input still holds the typed text, while only the footer or background-agent lines change between ticks, gets its second and third Enter | `env -u DEVTEAM_TICKET -u DEVTEAM_ROLE -u DEVTEAM_RUN -u DEVTEAM_SUPERVISOR -u DEVTEAM_HOME -u DEVTEAM_FEATURE timeout 600 node --test --test-concurrency=2 test/accounts.supervisor.test.mjs` (through `devteam.mjs gate test`) | `ok 4 - the supervisor's own pane: a lost Enter is pressed again while only the harness chrome changes, never into a busy pane`; pass 4, fail 0. The new test covers a Claude Code-shaped pane in the shape of /data/home/tmp/sb-pane.txt and a boxless pane. Between presses their footer, agent list (timers, tokens, an extra agent) and shell count change, and the shell count finally goes away. Each pane gets Enter 1, 2 and 3, then stops. On the old code (c66ca02 over main's devteam.mjs) it fails: `timed out waiting for Enter 2 of 3`. |
| 2 | The existing accounts test that ends the rescue when a reply appears below an echoed line still passes unchanged | same run; `git diff origin/main -- test/accounts.supervisor.test.mjs` | `ok 3 - the supervisor's own pane: a lost Enter is pressed, at most three times, never into a prompt, never while it works`; the diff to the test file has additions only (0 removed lines). |
| 3 | No Enter is ever pressed while a menu or busy marker shows (existing guards kept) | same run | The existing "left alone" cases pass unchanged (thinking, a y/n prompt, a menu). The new cases pass too: busy only in the footer, and a spinner above seven agent lines. Both get no key and keep their record. The guard now reads all 15 captured lines (before: the bottom 8). Mutation check in task-1.md: narrowing it back fails the test. |
| 4 | test.yml passes on every job; no file is added | `devteam.mjs gate ci -- gh run watch 43773870169 --exit-status --interval 60`; `git diff --stat origin/main` | Gate ci passed in 318.4s. Run 43773870169 at headSha 4f28e3f is `success` on all 17 jobs (kit 18/20/22/24 × chain, rest 1/2, rest 2/2, chrome 1/2 and 2/2, and tests). Outside this ticket's records, the diff changes only `docs/devteam/scripts/devteam.mjs` and `test/accounts.supervisor.test.mjs`, and adds no file. |

The extra coverage added for task review T1-2 also has a mutation check. With the no-cut line removed from `paneBody`, the test fails: `timed out waiting for Enter 1 of 3`.

Nothing is deferred to beta.
