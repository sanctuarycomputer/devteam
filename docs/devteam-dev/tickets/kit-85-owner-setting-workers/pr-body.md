The owner sets how many workers run at once from the dashboard's Settings page (home's design, §Maximum parallel workers). `max_active_tickets` and `max_active_per_component` remain the supervisor's own settings, not the owner's. So the owner's Save is a request: one owner act in the log. The supervisor lands it through its settings chore, and a finding stays raised until main has the value.

- **The request.** `owner-setting <key> <1..20|none>` writes one `owner-setting` act (`key`, `value`, `null` for no limit), now one of the owner's four act classes, and touches no file. Who can run it:
  - It refuses an agent session (`DEVTEAM_ROLE`) and the supervisor's pane.
  - It runs only on the dashboard's channel or in the owner's own terminal (a TTY stdin).
  - It takes only `OWNER_ASKABLE` (the two keys), never an `OWNER_SETTINGS` key or `links`.
  - `validate` checks the act's shape, not today's allowlist. It accepts `proof` on `owner-setting` as well as `pane-answer`.
- **The route.** `POST /api/owner-setting` takes exactly `{ key, value }`, at most 512 bytes, strict same-origin, and runs the command.
- **On a box, only the gateway's signature.**
  - The gateway signs `/api/owner-setting` under its own domain, `devteam-owner-setting-v1`, as it signs `/api/pane-answer`. A signature for one never passes for the other.
  - The route takes each nonce once in memory. The command checks the signature again, and that the signed body is exactly its arguments. It also checks that the signature is for this checkout's dashboard port (the last `started on` in `run/dashboard.log`, else `run/dashboard-port`), and that no `owner-setting` act holds the nonce already. That last check holds across dashboard restarts.
- **`settings set <key> <1..20|none> [--for <act-id>]`** is the supervisor's alone: workers and planners are refused, and so is the operator, through `OPERATOR_SUBCOMMANDED`.
  - It writes only `.worktrees/chore-settings`, on branch `chore-settings`.
  - The edit is a text edit of the one key at the block's own offset, re-parsed and checked, so the gate order and every other key stay byte for byte.
  - `--for` must name the owner's latest act for that key, with the same value.
  - It logs a `settings-edit` act (the supervisor's own act, ruling m-20261115-200302226 (c)).
- **One value in force.** Both keys now apply as main has them, as the owner's settings do. A working-tree edit is ignored, and a one-time warning of its own names it.
- **No limit everywhere.** `null` reads as no limit in every cap reader: `ready`, the component mark, both idle-capacity lines, memory-full and the goal forecast (its slots are then the goal's open tickets).
- **The label and the finding.** `/api/data.asked_settings[key]` is `{ value, shown, label, asked, act }`.
  - `label` is one of: "Set by you", "Set by the supervisor (you asked for N)", "Saved; applies once the supervisor lands it", "The kit's default" or "Set by the supervisor".
  - The override label needs a supervisor `settings-edit` without `--for`, newer than the request, of main's value, with a settings-chore merge newer than the edit. Only main is read.
  - `owner-setting-unlanded` (medium) is raised while the label is "Saved…". Its fix names the four commands and says the value waits while Upkeep is held.

The UI (the Settings row, its control and No limit) is kit-87's. `index.html:4667` is kit-86's (ruling m-20261115-200302226 (a), (b)).

## How to verify

- `node --test --test-concurrency=2 test/owner-setting.test.mjs`, run on a throwaway HOME (on a box, `boxFilesOff`), covers every done-when.
- `node --test --test-concurrency=2 test/gateway.test.mjs` checks the gateway's owner-setting signature, domain separation and the session check.
- `node --test --test-concurrency=2 test/pane-question.answer.test.mjs` covers the pane-answer proof, which now shares the check with the owner's Save.
- CI (test.yml) runs the full suite. See `docs/devteam-dev/tickets/kit-85-owner-setting-workers/verification.md` for the run and each done-when's evidence.

## Migration

`max_active_tickets` and `max_active_per_component` now apply as they are on main. A value changed in a checkout's working tree and never merged goes back to main's on upgrade, with a one-time warning naming it. To keep it, land it through the settings chore: `chore start settings`, `settings set <key> <n|none>`, `chore pr settings --title "…"`, `merge --chore settings`.

This release also changes `cloud/gateway.mjs` (it signs `/api/owner-setting`), so the box redeploys at release.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
