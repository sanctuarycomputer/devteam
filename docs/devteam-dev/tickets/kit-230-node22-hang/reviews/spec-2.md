# Spec review, pass 2

- Reviewer: spec-confirm (fresh subagent, claude-opus)
- Reviewed: 2e7fb12ba4f22fc065f034c2c39b9ecfbb31f871

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F2-1 | Important | done-when 1 ("its name is in the log"); acceptance 1 | spec.md "Healthy step times" bullet, last sentence | "The 600 s per-file limit fires first on 20, 22 and 24, so the file is named before the step is stopped" is wrong on two counts. (a) Node 24 has no per-file limit. The spec's own per-major bullet says 24 caps only top-level tests and never ends a file whose tests have finished while a child holds it open, which is this hang. (b) On 20 and 22 the per-file timer starts when the file starts, not when the step starts. The rest step runs 43 files at `--test-concurrency=8`, and hub-overview is the 14th. A file that starts more than 120 s into the step hits the 720 s step limit before its own 600 s limit. In that case Node's runner never names it. This sentence is the spec's reason that 12 minutes is enough, and it is false. As written, the failure-only listing is what names the file on every major, not "where the flag exists". Fix either way. (1) Make the step limit longer than 600 s plus the latest healthy file start, for example `timeout-minutes: 20`. That still fits the 30-minute job: the rest part is bounds (under 10 s) plus rest, and the chain part is one step. (2) Keep 12, drop the claim, and say that the listing is what names the file on every major. Then make sure acceptance 1 and verification.md don't count on Node's `not ok - <file>` line. | |
| F2-2 | Minor | acceptance 1, third sub-bullet | spec.md acceptance 1; test/lib/chrome.mjs:23 | "A leaked dashboard, hub or Chrome names its test by its tmp folder" holds for dashboards (their argv is `<tmp>/devteam-hub-ov-…/docs/devteam/scripts/devteam.mjs dashboard`) and for hubs. It does not hold for Chrome, whose only folder is a generic `devteam-chrome-…` profile. Two things make the claim sound. First, the listing must be unfiltered, so that the hung test file's own `node … test/<file>.test.mjs` process is listed too. Second, the spec should say why these processes are still alive at that step. The actions/runner source (src/Runner.Sdk/ProcessInvoker.cs: `kill(_proc.Id, …)` for SIGINT and SIGTERM, then `_proc.Kill()` in `NixKillProcessTree`) signals only the step's shell. So the `node --test` runner, its file processes and their detached children all outlive a step timeout and are cleaned up only when the job completes. That fact holds up the listing design and should be cited. | |
| F2-3 | Suggestion | none | spec.md Approach A ("a step registered after that hook has started runs at once") | Once the single `t.after` has finished, nothing awaits a step that is run at once. If it rejects, the rejection lands after the test has ended, so Node reports it as an asynchronous error after the test and fails the file. Say that a late step's error is caught and reported (for example logged), or folded into the first error when the hook is still running. | |

Notes on F1 to F7, diff-only:

- **F1:** resolved. The flag is on 20, 22 and 24 only, set through a matrix value. Node 18's rejection is recorded.
- **F2:** resolved in intent. The step limit and the failure-only listing bound Node 24. I checked the runner source: a step timeout leaves the detached groups, and the file processes themselves, alive for a later `if: failure()` step, and a step timeout counts as a failure. Its reasoning has the flaw in F2-1.
- **F3:** resolved and correct. chrome.mjs:37-38 unrefs Chrome and its stderr. `startDashboard` (kit.mjs:465) refs the process and its pipes. `p`, `q` and the `other` server (hub-overview.test.mjs:148, 202, 204) are open handles.
- **F4:** resolved, and the edge case is listed. See F2-3.
- **F5:** resolved. The helper test is committed.
- **F6:** resolved. m-20261115-050850201 (the design-change), m-20261115-050956047 (its ruling, approving the touches and sending the pattern to tests-light) and m-20261115-051541126 (on design-change m-20261115-051533609) are all in the log and match their citations.
- **F7:** resolved. A 30 s per-step bound is above `stop()`'s roughly 20 s worst case.

Other checks:

- `--test-timeout=600000` on Node 24 per top-level test is safe. The longest top-level test is kit.test.mjs at about 180 s. Tests with their own `timeout` (at most 480000 in hub-overview) override the default.
- 720 s over the recorded 429 s is about 1.7×, which is adequate margin on its own. I could not re-check 429 s against CI, because the `gh` query was denied, so I take the recorded figure as given.
- Values and refusals: unchanged from pass 1, and nothing in the diff crosses one.

Verdict: CHANGES 2e7fb12ba4f22fc065f034c2c39b9ecfbb31f871
