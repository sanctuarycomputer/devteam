# kit-85: the owner sets the worker limits from the dashboard

Ticket `kit-85-owner-setting-workers` (risk high, two final reviewers). Design: home's `project/designs/a-cleaner-more-consistent-dashboard.md` §Maximum parallel workers, §Data, §Failure modes, §Security and PII. Depends on `kit-84-dashboard-data` (it adds `CLASS_WORDS` and the class names in `/api/data`); build waits for its merge and the supervisor's approve-plan.

## Why

The owner wants to say how many workers run at once from the Settings page, without editing a file. `max_active_tickets` and `max_active_per_component` are the supervisor's own settings, not the owner's (`OWNER_SETTINGS`), so the owner's Save is a **request**: one owner line in the log. The supervisor applies it through its settings chore, and a finding nags until main has it. The value in force is always main's, so the fleet, the Settings row and the finding all read one value. The label never shows a value as the owner's that the owner didn't choose (strategy R1). Normal use or a confused agent can't write the owner line (P5).

## Rulings

- `m-20261115-194946908-supervisor`: plan ahead; spec and plan now, build only once `kit-84` has merged and approve-plan is recorded. Run only the touched test files, at `--test-concurrency=2`.
- `m-20261115-195216608-supervisor` (owner, thread `t-20261115-194652602-owner`): worker limits default to none. This ticket also covers `max_active_per_component`. Both keys take `null`, meaning no limit (`kit-86` makes no limit the kit's default). See the last done-when.
- `m-20261115-195248110-supervisor` (re my design-change `m-20261115-195205585`): `cloud/gateway.mjs` and `test/gateway.test.mjs` join the touches. The gateway signs `POST /api/owner-setting` under its own domain string. Tests show that a pane-answer signature can't pass as an owner-setting one (and the reverse), and that a replayed signature is refused. Risk stays high, with two finals. The PR body says that a gateway change redeploys the box at release.

## Touches

`docs/devteam/scripts/devteam.mjs`, `docs/devteam/schema/log.schema.json`, `cloud/gateway.mjs`, `test/owner-setting.test.mjs`, `test/gateway.test.mjs`. Not `index.html`: the Settings page control is `kit-87`'s. This ticket gives it the route and the `/api/data` field.

## Acceptance checks (the done-whens, restated)

Every check below is in `test/owner-setting.test.mjs` unless it says `gateway.test.mjs`.

1. **The save.** `POST /api/owner-setting {"key":"max_active_tickets","value":7}` from the dashboard channel (same-origin headers, JSON) runs `owner-setting max_active_tickets 7` as the owner. That writes exactly one log line, an act of class `owner-setting` with `key`, `value` and `at`, by `owner`, with channel `dashboard`. `git status` and every tracked file are byte-identical before and after.
2. **Refusals.** Each one writes nothing (the log's line count is unchanged) and names its reason:
   - `DEVTEAM_ROLE` set (CLI);
   - the supervisor's pane (CLI, `TMUX`/`TMUX_PANE` with the marked pane);
   - no same-origin header (route, 403);
   - a key off the allowlist (route and CLI);
   - any `OWNER_SETTINGS` key (route and CLI; every key is tried);
   - values `0`, `21` and `7.5`, and `"7"` as a JSON string (route); `0`, `21` and `7.5` (CLI).
3. **`settings set`.** `settings set max_active_tickets 7 --for <act-id>` writes `.worktrees/chore-settings/<projectRel>/settings.md` and logs a `settings-edit` act citing the act. With the same `--for` it refuses `6`. `settings set` refuses `links` and every `OWNER_SETTINGS` key. A test asserts that the allowlist and `OWNER_SETTINGS` don't overlap. `chore pr settings --title …` then `merge --chore settings` lands it, and main's `settings.md` then has 7.
4. **The finding.** `metrics` raises `owner-setting-unlanded` (medium) while main's value differs from the latest `owner-setting` act's.
   - It clears when main has that value, or when a `settings-edit` without `--for`, newer than the act, has landed on main.
   - It does not clear for an edit in an unmerged worktree.
   - The fix hint names `chore start settings`, `settings set <key> <v> --for <act>`, `chore pr settings --title …` and `merge --chore settings`, and says the value waits while Upkeep is held.
5. **Migration.** The PR body has a `## Migration` section: `max_active_tickets` (and now `max_active_per_component`) apply as they are on main, so a value changed in the working tree and never merged goes back to main's on upgrade. Land it through the settings chore to keep it. The body also says that the gateway change redeploys the box at release.
6. **Pinning and proof.**
   - `loadSettings` pins both keys to main's `settings.md`, as it pins `OWNER_SETTINGS`. A working-tree edit in the main checkout doesn't take effect, and the one-time warning names it in its own words.
   - `validate` accepts `proof` on an `owner-setting` act and still refuses it on every other act but `pane-answer`.
   - On a box (`threadsNeedGateway()`), a save without the gateway's owner signature is refused, both at the route and at the CLI.
   - `gateway.test.mjs`: the gateway signs `/api/owner-setting` under `devteam-owner-setting-v1`. A pane-answer signature fails the owner-setting check and the reverse, and a replayed nonce is refused.
7. **The label.** `/api/data` reports main's value (the one in force) with one label. The test has one case for each:
   - "Set by you" while main's value equals the latest owner act's, whoever applied it;
   - "Set by the supervisor (you asked for N)" while it differs and a landed `settings-edit` without `--for` is newer than the act;
   - "Saved; applies once the supervisor lands it" otherwise;
   - with no `owner-setting` act: "The kit's default" when main's `settings.md` doesn't set the key, else "Set by the supervisor".

   Also in this check:
   - `settings set` is refused for workers, planners and the operator (`DEVTEAM_ROLE=operator`);
   - `owner-setting` is in `OWNER_ACTS` and `log.schema.json`;
   - `owner-setting` ("Asking for a setting") and `settings-edit` ("Changing one of its own settings") have `CLASS_WORDS` names.
8. **No limit.**
   - The allowlist holds `max_active_tickets` and `max_active_per_component`. Each takes `null` (no limit), at the route, the CLI (`none`) and `settings set` (`none`), so the owner can set a limit and later clear it.
   - `/api/data` shows `null` as "No limit".
   - Every place that reads either cap treats `null` as unlimited.
   - The control's No limit option is `kit-87`'s to draw, against this ticket's route and field.

## Contracts

### Provided

- **Route** `POST /api/owner-setting`, body `{ key, value }`. `key` is one of `OWNER_ASKABLE`. `value` is a JSON integer from 1 to 20, or `null`. Strict same-origin, as for pane-answer: `Sec-Fetch-Site: same-origin` and `Origin` equal to the host. The content type is JSON. The body is at most 20000 bytes.
  - On a box it also needs the gateway headers `x-devteam-gateway-{ts,nonce,sig}`, which are verified, and each nonce is taken once.
  - Replies: 200 `{ ok: true, out }`; 400 or 403 `{ error: "<reason>" }`. `kit-87` shows the error as "Not saved: <reason>".
- **CLI** `owner-setting <key> <1..20|none>` (the owner's: `ownerWriter`).
  - On a box it reads `{ proof }` on stdin and checks it again: the signature, its age, that the signed body's key and value equal the arguments, and that no `owner-setting` act holds the nonce already.
  - It writes `{ type: 'act', class: 'owner-setting', key, value, at, what: 'asked for <key> <n|no limit>', refs: [], reversible: true, proof? }`, where `at` equals the line's `created_at`. It prints the act id.
- **CLI** `settings set <key> <1..20|none> [--for <act-id>]` (supervisor only; refused for the operator, workers and planners). It writes the key into `.worktrees/chore-settings/<projectRel>/settings.md` and refuses when that worktree doesn't exist ("chore start settings first").
  - With `--for`, the act must be an owner `owner-setting` act for the same key and the latest one for that key, and the value must equal the act's.
  - It logs `{ type: 'act', class: 'settings-edit', key, value, for?, refs: [actId?], what, reversible: true }` by `supervisor`.
  - Plain `settings` and `settings --get` are unchanged.
- **`/api/data`** gains `asked_settings: { <key>: { value, shown, label, asked, act } }` for each allowlisted key:
  - `value` is main's value (the one in force);
  - `shown` is "7" or "No limit";
  - `label` is one of the five texts above;
  - `asked` is the latest owner act's value, or `undefined` when there is none (`null` means the owner asked for no limit);
  - `act` is that act's id, or `null`.

  `caps` stays as it is.
- **The finding** `owner-setting-unlanded` (medium), one per key, with the subject being the key.
- **Gateway:** `ownerSettingSignature(privateKeyPem, port, body, ts, nonce)`, exported, signs `devteam-owner-setting-v1\n<port>\n<ts>\n<nonce>\n<sha256(body)>`. The gateway's instance proxy signs `POST /api/owner-setting` as it does `/api/pane-answer`, after the session check, and replaces any signature headers the browser sent.
- **Log schema:** `owner-setting` in the act description. `key`, `value` (integer or null), `at` and `for` become act properties; `proof`'s description now names owner-setting.

### Consumed

- `ownerWriter`, `ownerActionEnv`, `supervisorOnly`, `OPERATOR_READS` and `OPERATOR_SUBCOMMANDED`, `settingsAt`, `loadSettings`, `chore start|pr`, `merge --chore` (its `merge-chore` act, refs `chore-settings`), `goalMode(upkeepOrVirtual())`, `threadsNeedGateway`, `gatewayThreadKey`, and the metrics `add()` finding builder.
- `CLASS_WORDS` from `kit-84` (built after it merges).

## Decisions left to me (my calls, open to correction)

- **The allowlist** is `OWNER_ASKABLE = { max_active_tickets, max_active_per_component }`, each an integer from 1 to 20 or `null`. The design gave 1–20 for one key, and I use the same range for the second.
- **`at` is written explicitly**, equal to `created_at`, because the done-when names it as a field. The schema adds it.
- **`settings set` always writes into the settings chore's worktree,** whatever the cwd. This makes "never a working-tree edit" structural: there is no path that edits the main checkout's file. The edit is a targeted text change to the one top-level key (inserted when absent), then re-parsed and checked, so the rest of the block (gate order included) stays byte-identical.
- **`--for` must name the latest owner act for the key.** Applying a superseded request would leave the finding raised and the label saying "Saved", which is misleading. It is refused with the newer act's id.
- **A `settings-edit` has landed** when main's `settings.md` holds its value and a `merge-chore` act with refs `chore-settings` is newer than the edit (the design's rule).
- **The fix hint always carries the Upkeep sentence:** "while Upkeep is drained or parked, chore start and merge --chore refuse, so the value waits until Upkeep runs (or --force, logged)". It leads with that sentence when Upkeep is held now.
- **`null` in the readers:**
  - `ready` prints "active workers: 3 (no limit)" and never marks a component at cap;
  - metrics' idle-capacity and memory-full treat the cap as unlimited;
  - the goal forecast's slot count with no limit is the number of open tickets in flight, at least 1.
- **The pinned keys' warning** is its own line, in the design's words: "max_active_tickets here differs from main; it applies as on main, so change it with settings set in the settings chore". Both keys are named when both differ. Before `settings.md` is on main (adoption), the working tree applies, as today.
- **The labels are full sentences** ("Set by you"), matching the mock's row. The done-whens' fragments are their lowercase cores; the test matches the full text.
- **Proof on the CLI** comes on stdin as `{ proof }`, and the route passes it there. This is pane answered's pattern, so it never appears in argv.

## Edge cases

- Two tabs save different values: each writes its act, and the latest is compared.
- The owner asks for the value already in force: the act is written, and the label is "Set by you".
- The owner asks for no limit and main holds `null` explicitly: they are equal, and the label is "Set by you". Main without the key, under `kit-86`'s default `null`, is also equal (main's value includes the defaults).
- The supervisor's `settings-edit` sits in a worktree that never merged: it doesn't count, and the finding stays.
- A `settings-edit` without `--for` lands, then the owner asks again: the newer act wins, and the finding is raised again.
- An `owner-setting` act with no chore landed is inert: nothing reads it as the value.
- A body that isn't JSON, nested too deep or over 20 KB gets a 400 and writes nothing.
- On a box: a signature for another port, an old timestamp (over `OPERATOR_PROOF_MS`), a nonce used before (in memory, and in the log for the CLI), a pane-answer signature, or a body whose key or value differs from the arguments. Each is refused.

## Out of scope

- The Settings page control and its No limit option (`kit-87`).
- The kit default changing to no limit, and the edits to supervisor.md §5 and planning.md (`kit-86`).
- Any merge check on these keys: they are the supervisor's.
- Defending against an agent that forges a same-origin request on a laptop, or that is the owner's Unix user (P6, as `/api/answer` today).
