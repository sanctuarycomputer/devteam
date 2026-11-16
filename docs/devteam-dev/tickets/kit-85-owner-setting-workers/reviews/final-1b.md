# Final review, pass 1 (track b)

- Reviewer: reviewer-b (fresh subagent, claude-opus-5-5, own session; not the author, not final-1's reviewer)
- Reviewed: 831e23040870990841ad760927a5d371db20e423 (the whole branch against merge base 7cd8a3aa with origin/main; code and tests as at 514aa91, the two later commits add records only)

What I checked:
- The diff to `devteam.mjs`, `cloud/gateway.mjs`, `log.schema.json`, `test/gateway.test.mjs`, `test/lib/chain.mjs`, `test/owner-setting.test.mjs`, the spec, the plan's build rulings, the task reviews, verification.md and pr-body.md, against every done_when in `ticket show`.
- Forging the owner line. I traced the CLI (`ownerWriter`, then the channel/TTY fence, then the allowlist, and on a box proof, port, exact body and log nonce), the route (strict same-origin, JSON, at most 512 bytes, exactly `{key, value}`, the in-memory nonce, then `ownerChild` under `ownerActionEnv`) and the gateway (`SIGNED_POSTS` signs only after the session check and replaces browser-sent signature headers; the `devteam-owner-setting-v1` domain is separate from pane-answer). I found no path that lets normal use or a confused agent (an agent shell with `DEVTEAM_ROLE`, the supervisor's pane, or a non-TTY stdin without the dashboard channel) write the act. Deliberately setting `DEVTEAM_CHANNEL=dashboard` is the P6 fence the spec accepts.
- `settings set`. It is supervisor-only, the operator is refused through `OPERATOR_SUBCOMMANDED`, and it writes only into the chore worktree on branch `chore-settings`. The text edit is re-parsed, with the duplicate-key and every-other-key-canonical checks. A nested occurrence of the key, or one inside a string, can't be edited by mistake: the post-check refuses it. `--for` must name the latest act with the same value.
- The pin and the readers. `loadSettings` and `settingsAt` both carry `SETTINGS_DEFAULTS`, so an unset key doesn't warn spuriously. Every cap reader goes through `loadSettings` and #277's `capOf`.
- The label (R1) and the finding. Both come from `askedSettingsView`, which reads main through `mainRef()`. `askedMemo` is per process, and the dashboard runs `dashboard-data` as a child, so it is never stale across requests.
- CI: `gh run view 43793564433` gives `conclusion: success`, `headSha: 514aa9121c3f71eb0a0063e3e823846474509afb`, matching verification.md. The commits since 514aa91 touch only verification.md and final-brief.md.
- Local runs, one file at a time at concurrency 2, with no DEVTEAM_* set, a scratch HOME and DEVTEAM_HUB_PORT=4417: `test/owner-setting.test.mjs` exited 0 (16/16), and `test/gateway.test.mjs` exited 0 (73/73).
- Mutations, each in a scratch worktree with `test/owner-setting.test.mjs` run on it, all killed (exit 1):
  - the CLI port check dropped;
  - the CLI log-nonce check dropped;
  - the route nonce check dropped;
  - the channel/TTY fence dropped;
  - "edit newer than the act" dropped from `landedOverride`;
  - the signed-value comparison dropped;
  - the askable pin in `loadSettings` dropped;
  - the owner-setting proof verified under pane-answer's bytes;
  - the "latest act" check in `settings set` dropped.

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec §Decisions ("An edit that never merged clears nothing") | docs/devteam/scripts/devteam.mjs:12744 | `landedOverride` takes any `chore-settings` merge newer than the edit as the edit landing. It doesn't check that the merge carried the edit. Scenario: the supervisor runs a no-op `settings set max_active_tickets 3` (main already 3) in a chore after the owner asks for 5. That worktree is then removed unmerged. A later, separate settings chore (say, for `gates`) merges. The label becomes "Set by the supervisor (you asked for 5)" and the finding clears, though the edit itself never merged. The text stays truthful about the value in force, and main holds what the supervisor chose, so it doesn't block. | wont-fix here: a follow-up, which the supervisor bundles into a chore (m-20261116-031715539). The label stays true about the value in force, as the record says |

Verdict: APPROVE 831e23040870990841ad760927a5d371db20e423
