# Final review, pass 1

- Reviewer: kit-98-autonomy-score-data's worker session (fresh to kit-85's build, claude-opus-5-5)
- Reviewed: 831e23040870990841ad760927a5d371db20e423 (the whole branch, `git diff origin/main...HEAD`; code and tests unchanged since 514aa91, later commits are verification.md and final-brief.md only)

Read: spec.md, plan.md's "Rulings and calls (build)", verification.md, pr-body.md, the diff of `devteam.mjs`, `cloud/gateway.mjs`, `log.schema.json`, `test/owner-setting.test.mjs`, `test/gateway.test.mjs`, `test/lib/chain.mjs` and the G1 golden.

Ran, in `review-worktree` at this sha, one file at a time, `--test-concurrency=2`, every `DEVTEAM_*` unset, a throwaway HOME, `DEVTEAM_HUB_PORT=4377`:
- `test/owner-setting.test.mjs`: 16 pass, 0 fail.
- `test/gateway.test.mjs`: 73 pass, 0 fail.

Mutations, one at a time, in a scratch worktree at this sha (removed after), each run against its own test:

| Mutation | Result |
|---|---|
| CLI on a box: drop the signed-body equals arguments check | killed |
| CLI on a box: drop the dashboard-port check | killed |
| CLI on a box: drop the log nonce check | killed |
| route: drop the in-memory nonce check | killed |
| CLI: drop the dashboard-channel-or-TTY fence | killed |
| route: drop the exact `{key, value}` keys check | killed |
| validate: drop the owner-setting value-shape check | killed |
| label: drop "settings-edit newer than the act" | killed |
| `settings set --for`: drop "the latest act for the key" | killed |
| `loadSettings`: drop the askable pin | killed |
| gateway: sign `/api/owner-setting` with `paneSignature` | killed |
| CLI: accept a pane-answer signature as an owner-setting one | killed |
| label: accept a settings-edit that has `--for` as an override | survived, but the two can't be told apart: an edit with `--for` lands the act's own value, so "Set by you" is picked first. And a newer act makes the edit older than it. |
| `settings set --for`: drop "an owner `owner-setting` act" (keep only "same key") | survived (F2) |
| `setSettingsKey`: drop the re-parse check (`if (!same) die`) | survived (F3) |

The focus areas hold. An agent on a box needs a fresh gateway signature under `devteam-owner-setting-v1`, for this port and exactly this key and value, with its nonce unused in memory and in the log. The route and the CLI each refuse otherwise, and the gateway replaces any forged headers. Off a box, the CLI fence stops the confused case; deliberate forgery is P6, as the spec says. `settings set` writes only the settings chore's worktree, on its own branch, at the block's own offset. The landed rule and the five labels match the spec and its rulings.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec §Acceptance 5 (PR body), ruling m-20261116-021912584 | docs/devteam-dev/tickets/kit-85-owner-setting-workers/pr-body.md ("No limit everywhere") | The PR body says that under no limit the goal forecast's slots "are then the goal's open tickets". After the #277 merge, `goalForecast` uses `FORECAST_WIDTH` (8) (devteam.mjs:10945), and the ruling says that reader and the other no-cap readers are #277's. The bullet credits this PR with readers it no longer owns and describes the forecast wrongly. Say instead that the pin brings main's `null` to #277's readers. | fixed: the PR body's no-limit line now names #277's reader; applied to PR #285's body through check-ticket --body-file, not committed, so the verdicts hold (m-20261116-031715539) |
| F2 | Minor | spec §Contracts `settings set` ("With `--for`, the act must be an owner `owner-setting` act for the same key") | docs/devteam/scripts/devteam.mjs:19954 | No test pins the class and owner parts of `--for`'s check. With only the key compared, `--for` can name the supervisor's own `settings-edit` (which carries `key`) whenever no owner act exists for the key, and every test still passes. The log would then claim the edit landed a request that doesn't exist. Add a refusal case: `--for` naming a `settings-edit` act, and a non-owner act. | wont-fix here: a follow-up, which the supervisor bundles into a chore (m-20261116-031715539). The tests are prepared (the --for refusals for a settings-edit and an owner act of another class; mutation-checked) |
| F3 | Minor | spec §Contracts `settings set`, "The check after the edit" (spec-1 F1-10: "Otherwise nothing is written") | docs/devteam/scripts/devteam.mjs:19927 | No test reaches the re-parse check: every refusal in "settings set refuses a settings block it can't edit safely" is caught earlier (duplicate keys, the one-plain-number count). It is reachable. A block whose top-level value is a string (`"max_active_tickets": "5"`) and that holds the key once more in a nested object matches the regex once, at the nested copy. Only `same` then stops a wrong edit. Add that case, asserting that the file is byte-identical and that no `settings-edit` is logged. | wont-fix here: a follow-up, which the supervisor bundles into a chore (m-20261116-031715539). The test is prepared (nested key under a top-level string reaches the re-parse check, file byte-identical, no act; mutation-checked) |

Verdict: APPROVE 831e23040870990841ad760927a5d371db20e423
