# kit-85 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry out this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- The owner's Save becomes one `owner-setting` act (`key`, `value`, `at`). It changes no file and no git, and comes only from the owner channel. On a box it also needs the gateway's signature under its own domain string.
- Two keys, `max_active_tickets` and `max_active_per_component`. Each takes an integer from 1 to 20, or `null` (no limit). Every reader of either cap treats `null` as unlimited.
- `loadSettings` pins both keys to main, so the value in force is main's alone. The supervisor changes them only through `settings set` in the settings chore, then `chore pr settings` and `merge --chore settings`.
- `metrics` raises `owner-setting-unlanded` until main has the owner's value, or until a landed supervisor edit made without `--for` overrides it.
- `/api/data.asked_settings` gives each key's value in force, with one label from the design's five.
- Task 0 waits for `kit-84` to merge and merges main, then reuses its `CLASS_WORDS`, `mainRef()` and settings view. Then six tasks: allowlist and pin; the act; the route and the gateway; `settings set`; the finding and the label; verification and the PR.
- Tests: `test/owner-setting.test.mjs` (new) and `test/gateway.test.mjs`. Run each alone with `--test-concurrency=2`; CI is the gate.

**Goal:** implement the spec at `docs/devteam-dev/tickets/kit-85-owner-setting-workers/spec.md`.

**Architecture:** all kit logic lives in `docs/devteam/scripts/devteam.mjs`, beside the code it extends:
- the allowlist next to `OWNER_SETTINGS`;
- the act next to `pane answered`;
- the route in `cmdDashboard`'s POST handler, beside `isPane`;
- `settings set` in `cmdSettings`;
- the finding in metrics;
- the label in `dashboardData`.

The gateway gets one more signer and a signed route. The log schema gets three act properties (`key`, `value`, `for`).

**Tech stack:** Node ESM, with `node:test` and `node:assert/strict` only. No dependencies.

**Spec:** `docs/devteam-dev/tickets/kit-85-owner-setting-workers/spec.md`. Home's design §Maximum parallel workers is the source.

## Global constraints

- Allowlist: `OWNER_ASKABLE = ['max_active_tickets', 'max_active_per_component']`. A value is `Number.isInteger(v) && v >= 1 && v <= 20`, or `null`. In argv, `null` is written `none`.
- Act classes: `owner-setting` (owner) and `settings-edit` (supervisor). `CLASS_WORDS` (from `kit-84`, which already lists both) names them "Asking for a setting" and "Changing one of its own settings"; this ticket adds them only if `kit-84` merged without them.
- Gateway domain string: `devteam-owner-setting-v1\n<port>\n<ts>\n<nonce>\n<sha256(body)>`.
- Pin warning, verbatim: `<keys> here differs from main; it applies as on main, so change it with settings set in the settings chore`.
- Labels, verbatim:
  - `Set by you`
  - `Set by the supervisor (you asked for <N|no limit>)`
  - `Saved; applies once the supervisor lands it`
  - `The kit's default`
  - `Set by the supervisor`

  `shown` is `"<n>"` or `"No limit"`.
- Finding: kind `owner-setting-unlanded`, severity `medium`, subject `<key>`.
- Tests run one file at a time: `node --test --test-concurrency=2 test/<file>`. Never the full suite on the box.
- Shell work with redirects or rm goes in script files under the ticket folder.

## Review focus

1. **A `null` cap reaching arithmetic.** `active < null` is false, so idle-capacity would never fire. Task 1 adds a test that `ready --json` and `metrics` give the right answers with `null`.
2. **A string `"7"` or `true` in the HTTP body.** A string can't reach argv as `"7"`. Task 3's route test sends each. It also sends the raw text `{"key":"max_active_tickets","value":7.0}`, which JSON.parse reads as 7 and which is accepted; the test asserts the 200 and `value 7`.
3. **A replayed signed body after the dashboard restarts,** when its in-memory nonces are gone. The CLI checks the log's `owner-setting` acts for the nonce (Task 3 test).
4. **`settings set` leaving the rest of `settings.md` unchanged:** the gates' key order and other keys stay byte-identical. Task 4 test: a diff shows only the one line.
5. **A settings chore that already holds another change** (a link edit) when `settings set` runs. It must add to the file, not overwrite it (Task 4 test).

---

### Task 0: Start from kit-84 (plan-1 P1-2)

- [ ] Wait until `kit-84-dashboard-data` is merged and the supervisor has recorded approve-plan. Then `git fetch origin && git merge origin/main`.
- [ ] Read what `kit-84` landed:
  - `CLASS_WORDS`: whether it has both names;
  - `mainRef()`;
  - the settings view (`settings_all`, or whatever it named it, including how it tells a set key from a default).
- [ ] Record in this plan's Rulings and calls the names this plan then uses in place of its own:
  - Task 5's `mainSettingsRaw()` is replaced by kit-84's settings view where it gives "set on main" per key, else built on `mainRef()`;
  - Task 2's `CLASS_WORDS` step becomes an assertion only.

  Commit the plan.
- [ ] **Fixture notes** for every task (plan-1 P1-13):
  - `monoFixture` with `F.lines(F.STD)` first, so `ready` lists tickets (it holds every ticket while main has files no component line owns);
  - tickets added with `ticket add` as SUP, component `web`;
  - between two settings-chore cycles, `git worktree remove .worktrees/chore-settings` and `git branch -D chore-settings` after each merge, so `chore start settings` starts fresh from main.

### Task 1: The allowlist, the pin, and `null` in every reader

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`:
  - beside `OWNER_SETTINGS` (~599);
  - `loadSettings` (~728);
  - `cmdReady` (~3829–3841);
  - forecast `slots` (~10301);
  - metrics idle-capacity and memory-full (~11568–11571).
- Create: `test/owner-setting.test.mjs`, using `monoFixture` from `test/lib/kit.mjs`.

**Interfaces (produces):**
- `const OWNER_ASKABLE = ['max_active_tickets', 'max_active_per_component']`
- `askableProblem(key, value) -> string|null`. It returns null when `key` is allowlisted and `value` is valid. Otherwise it returns the reason:
  - for an `OWNER_SETTINGS` key: `"<key> is the owner's own setting: it changes through a PR with the owner's answer"`;
  - for `links`: `"links change through link set and link land"`;
  - for any other key: `"<key> is not a setting the owner asks for here; only max_active_tickets, max_active_per_component"`;
  - for a bad value: `"<key> is a whole number from 1 to 20, or none (no limit)"`.
- `parseAskable(arg: string) -> number|null|undefined`. `'none'` gives `null`, `/^(?:[1-9]|1\d|20)$/` gives the number, and anything else gives `undefined`.
- `capOf(v) -> number` (`v === null ? Infinity : v`).

- [ ] **Step 1: Failing tests.**
  - `'the allowlist and OWNER_SETTINGS never overlap'`. Read both from the kit's source with a regex on `const OWNER_SETTINGS = {` and `const OWNER_ASKABLE = [`. Assert an empty intersection, and that `links` is in neither.
  - `'max_active_* apply as on main: a working-tree edit in the main checkout is ignored, and named once'`.
    - `edit()` sets `max_active_tickets: 3` and `max_active_per_component: 1` in `old`'s working tree (not committed).
    - `settings --get max_active_tickets` prints main's value.
    - stderr matches `/max_active_tickets, max_active_per_component here differs from main; it applies as on main, so change it with settings set in the settings chore/`.
    - The warning shows once per process: a single command shows it once.
    - Committed and pushed, the value applies.
  - `'null means no limit wherever a cap is read'` (plan-1 P1-3). With main holding `max_active_tickets: null` and `max_active_per_component: null`, `incident_slots: 1`, an open incident, a ready fix ticket and two ready tickets in one component, one worker counted active in it (a `phase build` line and the window faked as in `fleetFixture`'s active-worker helpers):
    - `ready` prints `active workers: 1 (no limit)`, with no `(+1 for fix tickets)` and no `(component at cap)`;
    - `ready --json`'s `caps.max_active_tickets` is `null`;
    - `metrics --json` has exactly one `idle-capacity` finding, the plain one (`/ready/` in the subject, not `/fix ready/`), with `no limit` in its detail and not `null`;
    - with `DEVTEAM_MEMINFO` making memory full (as `memory-ceiling.test.mjs` does), the `memory-full` finding is raised, and its detail says `no limit`;
    - the goal forecast (`goal show <g> --json`'s forecast) with `null` equals the forecast with `max_active_tickets` set to the goal's open-ticket count;
    - and the same fixture with `max_active_tickets: 1` raises the fix-ready idle-capacity line, a control proving the test reaches it.
- [ ] **Step 2: Run, and expect failures.** `node --test --test-concurrency=2 test/owner-setting.test.mjs`.
- [ ] **Step 3: Implement.**
  - In `loadSettings`, pin `OWNER_ASKABLE` keys like `OWNER_SETTINGS`, but warn on a separate line in the words above. Keep the existing owner-settings warning for its own keys. Each line has its own once-guard (`DEVTEAM_QUIET_SETTINGS` for the owner line, `DEVTEAM_QUIET_ASKABLE` for this one), so both print when both kinds differ (plan-1 P1-7). The test covers that case: `gates` and `max_active_tickets` both edited, both lines shown once.
  - Readers use `capOf()`:
    - `ready` prints `${n}/${cap}`, or `${n} (no limit)`;
    - the component mark uses `capOf(s.max_active_per_component)`;
    - both idle-capacity lines and memory-full use `capOf`; the detail says `no limit` in place of `/null`;
    - `ready`'s `(+N for fix tickets)` suffix shows only with a finite cap;
    - forecast `slots = s.max_active_tickets === null ? Math.max(1, <the goal's open, unmerged ticket count>) : Math.max(1, s.max_active_tickets)`.
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit.** `kit-85: T1 allowlist, main pin and no-limit readers`.

### Task 2: The `owner-setting` act and its fence

**Files:**
- `devteam.mjs`:
  - `OWNER_ACTS` (~786);
  - validate's act rules (~1216–1219);
  - a new `cmdOwnerSetting` beside `cmdPane`;
  - `COMMANDS`;
  - `HELP`;
  - `CLASS_WORDS` (kit-84's map).
- `log.schema.json`: act properties `key` (string), `value` (integer 1..20 or null), `for` (act id string); `at` is the envelope's. Update the act description and `proof`'s description.
- Test: `test/owner-setting.test.mjs`.

**Interfaces:**
- Consumes `askableProblem` and `parseAskable` (Task 1).
- Produces the CLI `owner-setting <key> <1..20|none>`. Before writing, it calls `ownerWriter('the owner asks for a setting on the dashboard\'s Settings page; you change your own with settings set in the settings chore')`, then the channel rule: `DEVTEAM_CHANNEL === 'dashboard' || process.stdin.isTTY`, else the spec's reason. Then `askableProblem`. It writes `{ type: 'act', class: 'owner-setting', key, value, what, refs: [], reversible: true, proof? }` and prints the id.
- Produces `ownerSettingActs(key) -> act[]` (oldest first) and `latestOwnerSetting(key) -> act|null`.

- [ ] **Step 1: Failing tests.**
  - `'owner-setting writes one owner act and touches no file or git'`.
    - Snapshot `git status --porcelain` and a hash of every tracked file.
    - Run `owner-setting max_active_tickets 7` with `DEVTEAM_CHANNEL=dashboard`.
    - Exactly one new log line: `class owner-setting`, `by owner`, `channel dashboard`, `key`, `value 7`, and the envelope's `at`, with no other `at`.
    - The snapshot is unchanged.
    - `none` writes `value: null`.
  - `'owner-setting refuses, writes nothing and names why'`. Each case is checked by log line count and stderr regex:
    - `DEVTEAM_ROLE=worker`, matching `/DEVTEAM_ROLE=worker/`;
    - the supervisor's pane through `DEVTEAM_SUPERVISOR` (`TMUX=x`, `TMUX_PANE=%9`, `DEVTEAM_SUPERVISOR=%9`), matching `/supervisor's session/`;
    - the supervisor's marked pane (plan-1 P1-9): `run/supervisor-pane` and `run/supervisor-pane-role` both hold `%9`, with `TMUX=x`, `TMUX_PANE=%9` and no `DEVTEAM_SUPERVISOR`, matching `/recorded as the supervisor's/`;
    - `max_active_planners`, matching `/not a setting the owner asks for/`;
    - each `OWNER_SETTINGS` key, matching `/owner's own setting/`;
    - `links`;
    - `0`, `21` and `7.5`, matching `/whole number from 1 to 20/`;
    - no `DEVTEAM_CHANNEL` and a piped stdin (an agent's shell), matching `/on the dashboard's Settings page or in their own terminal/`.
  - `'validate takes proof on owner-setting and pane-answer only'`. Append raw lines (`line()` helper) to the fixture's log:
    - an owner `owner-setting` act with `proof: {...}` gives `log-check` exit 0;
    - a `goal-order` act with `proof` gives non-zero, matching `/proof is the gateway's signature/`;
    - an `owner-setting` act by `supervisor` is refused (`/owner-setting is the owner's/`);
    - an owner `owner-setting` act with value `21`, `0` or `"7"`, or key `Bad Key`, is refused; one with key `max_active_planners` (well formed, off today's allowlist) passes (plan-1 P1-12: validate checks shape, not the allowlist).
  - `'CLASS_WORDS names both classes'`: through what `kit-84` exposes (its test reads the map; this test does the same), check the two names verbatim. This is an assertion on `kit-84`'s map; it is written first and must pass at the merge with main.
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement.**
  - Add `'owner-setting'` to `OWNER_ACTS`.
  - The validate rule for an owner `owner-setting` act: `key` matches `/^[a-z][a-z0-9_]{0,63}$/`, `value` is `null` or an integer from 1 to 20, and there is no `artifact` or `tree`.
  - Widen the proof rule to `['pane-answer', 'owner-setting'].includes(o.class)`.
  - Add the schema properties.
  - `CLASS_WORDS`: only if `kit-84` merged without the two names, add them.
  - `what`: `asked for max_active_tickets 7` (or `… no limit`).
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit.** `kit-85: T2 the owner-setting act`.

### Task 3: The route and the gateway's signature

**Files:**
- `devteam.mjs`:
  - `cmdDashboard`'s POST handler (~15215): `isOwnerSetting` beside `isPane`, strict same-origin;
  - a new `ownerSettingSigned` and `ownerSettingProofProblem` beside `paneProofProblem`;
  - `cmdOwnerSetting`'s box check.
- `cloud/gateway.mjs`:
  - `export function ownerSettingSignature(privateKeyPem, port, body, ts = Date.now(), nonce = b64u(crypto.randomBytes(24)))`;
  - generalise `panePost(req, res, port, own)` into `signedPost(req, res, port, own, route, signer)`;
  - the dispatch at ~2006 signs `POST /api/owner-setting` too.
- Tests: `test/owner-setting.test.mjs` and `test/gateway.test.mjs`.

**Interfaces:**
- Route behaviour:
  1. JSON body, at most 512 bytes.
  2. `isObj(b)`, its keys exactly `key` and `value`, `typeof b.key === 'string'`, and `b.value === null || Number.isInteger(b.value)`; else 400 `missing or invalid fields: { key, value }`.
  3. `askableProblem`; else 400 with that reason.
  4. If `threadsNeedGateway()`: the gateway headers, `ownerSettingProofProblem({ port, ts, nonce, sig, body })`, and an in-memory `ownerSettingNonces` map; else 403 `not saved: on a box the owner saves settings only through the box's gateway (<why>)`.
  5. `runAction(['owner-setting', key, value === null ? 'none' : String(value)], { input: proof ? JSON.stringify({ proof }) : null })`.
  6. 200 `{ ok, out }` or 400 `{ error }`.
- CLI box check: when `threadsNeedGateway()`, read `{ proof }` from stdin. Refuse unless all of these hold:
  - `ownerSettingProofProblem(proof)` is null;
  - the signed body is exactly `{key, value}`, equal to the arguments;
  - `proof.port === ownDashboardPort()`, a new helper: the last `started on http://127.0.0.1:<port>` in `run/dashboard.log`, else `run/dashboard-port` (the reading at ~13980 moves into it and is used there too); else `that signature is for another dashboard`;
  - no `owner-setting` act in the log has that nonce.

  The reason reads `owner-setting: on a box the owner saves settings only on the dashboard through the box's gateway, which signs the press, and <why>`. The act keeps `proof`.

- [ ] **Step 1: Failing tests (`owner-setting.test.mjs`).**
  - `'POST /api/owner-setting from the page runs owner-setting'`.
    - `startDashboard` on a free port, with `own = { origin, 'sec-fetch-site': 'same-origin' }`.
    - Posting `{key:'max_active_tickets', value:7}` gives 200 and one act, `channel dashboard`; `{value:null}` gives one act with value null.
    - Refused with nothing written:
      - no headers, Origin alone, Sec-Fetch-Site alone, and a cross-site origin (403 each);
      - `text/plain` (403);
      - values `0`, `21`, `7.5`, `"7"` and `true` (400 each, with a reason);
      - every `OWNER_SETTINGS` key (400, `/owner's own setting/`), read from the kit's source as in Task 1 (plan-1 P1-8);
      - the raw text `{"key":"max_active_tickets","value":7.0}`: 200, `value 7`;
      - key `nope` (400).
  - `'on a box the save needs the gateway's owner-setting signature, once'`. Following the pane-answer box test (`DEVTEAM_GATEWAY_THREAD_KEY`, `DEVTEAM_PUBLIC_URL`):
    - unsigned gives 403;
    - signed by another key, another port, another body, or too old gives 403;
    - a `paneSignature` over the same body and port gives 403 (domain separation);
    - `ownerSettingSignature` gives 200, and the act's `proof.nonce` is the header's;
    - the same headers again give 403, `/used already/`;
    - the CLI run with the act's proof on stdin is refused, `/taken already/`;
    - the CLI with no stdin on a box is refused;
    - the CLI with the gateway's valid, fresh proof for another body is refused: signed `{key:'max_active_tickets', value:9}` run as `owner-setting max_active_tickets 7`, and signed for `max_active_per_component` run for `max_active_tickets`, each matching `/signed another/` (plan-1 P1-5);
    - the CLI with a valid proof for another port is refused (`/another dashboard/`); the dashboard is started with `--port`, so this also proves the port comes from `dashboard.log` (plan-1 P1-1);
    - a body with an extra field, or over 512 bytes, gets 400 and writes nothing;
    - `log-check` gives 0.
  - In `gateway.test.mjs`, beside the pane-answer block (~397):
    - `POST /api/owner-setting` through the gateway gives upstream headers signed under `devteam-owner-setting-v1` for that port and body, and the browser's forged signature headers are replaced;
    - the signature does not verify under the `devteam-pane-answer-v1` bytes, and the reverse;
    - the route needs the session (401 without the cookie);
    - other requests stay unsigned. The existing assertion at `test/gateway.test.mjs:406` ("nothing else an instance gets is signed") is rewritten to allow exactly the two signed routes (plan-1 P1-11);
    - the gateway keeps no nonces, so the replay test lives in `owner-setting.test.mjs` (above), and `verification.md` says so.
- [ ] **Step 2: Run both files.** Expect FAIL.
- [ ] **Step 3: Implement** as in the interfaces. The gateway's body cap and error texts follow `panePost`'s.
- [ ] **Step 4: Run both files.** Expect PASS.
- [ ] **Step 5: Commit.** `kit-85: T3 the route and the gateway's owner-setting signature`.

### Task 4: `settings set` in the settings chore

**Files:**
- `devteam.mjs`:
  - `cmdSettings` (~18824);
  - `OPERATOR_SUBCOMMANDED` gains `'settings'` (~19811);
  - `HELP`.
- Test: `test/owner-setting.test.mjs`.

**Interfaces:**
- Consumes `askableProblem`, `parseAskable` and `latestOwnerSetting` (Tasks 1 and 2).
- Produces `settings set <key> <1..20|none> [--for <act-id>]`:
  1. `supervisorOnly('settings set')`. Workers and planners die there; the operator dies at the dispatcher, because `settings set` is not in `OPERATOR_READS`.
  2. `askableProblem`.
  3. `wt = <mainRoot>/.worktrees/chore-settings`, which must be a worktree, else `no worktree .worktrees/chore-settings; devteam.mjs chore start settings`.
  4. With `--for`:
     - the act exists, is an owner `owner-setting` act and has the same key, else `--for names the owner's owner-setting act for <key>`;
     - it is the latest for the key, else `a newer request <id> asks for <v>`;
     - its value equals this one, else `the owner asked for <v>; --for applies exactly that`.
  5. `setSettingsKey(file, key, value)` (below).
  6. Log `{ type: 'act', class: 'settings-edit', key, value, ...(for ? { for: id, refs: [id] } : { refs: [] }), what: 'set <key> to <v> in the settings chore', reversible: true }` by `supervisor`.
  7. Print the file's path and the next commands.
- `setSettingsKey(file: string, key: string, value: number|null) -> void` (plan-1 P1-6). Before editing, it dies if `jsonDuplicateKeys(block)` is undefined (the block isn't JSON) or lists any repeated key. Then:
  - if the key is at top level, its value text is replaced: the regex `"<key>"\s*:\s*(null|-?\d+(\.\d+)?)` must match exactly once;
  - else, for an empty block (`{}` with optional whitespace), the text becomes `{\n  "<key>": <v>\n}`;
  - else `\n  "<key>": <v>,` is inserted after the opening `{`.

  Afterwards it re-parses, and dies, writing nothing, unless `jsonDuplicateKeys` lists none, the key equals the value, and every other top-level key is canonical-equal to before.

- [ ] **Step 1: Failing tests.**
  - `'settings set applies the owner's act in the settings chore, and lands through merge --chore'`:
    1. Run `owner-setting max_active_tickets 7` (owner) and take the act id.
    2. Run `chore start settings` as SUP, then `settings set max_active_tickets 7 --for <id>` (SUP, cwd `old`). The chore worktree's `settings.md` now has 7, and `git diff` there shows one changed or added line. The main checkout's file is unchanged.
    3. A `settings-edit` act has `for` = id and refs [id].
    4. `settings set max_active_tickets 6 --for <id>` is refused (`/asked for 7/`).
    5. `settings set links …` (`/link set and link land/`) and every `OWNER_SETTINGS` key are refused.
    6. Write the PR file as `link-edits.test.mjs` does. `chore pr settings --title "settings: max_active_tickets 7"`, then `merge --chore settings` exits 0. `git show origin/main:<settings>` has 7, and a `merge-chore` act with refs `chore-settings` exists.
  - `'settings set is the supervisor's alone'`: `DEVTEAM_ROLE=worker`, `planner` and `operator` are each refused with nothing written. The operator matches `/the operator only reads/`.
  - `'settings set adds to a chore that holds other edits'` (review focus 4 and 5):
    - the chore worktree first gets an unrelated key edit and a reordered `gates` object in the file;
    - after `settings set max_active_per_component none`, those bytes are unchanged, and the key reads `null`.
  - `'settings set without the chore worktree'` is refused, naming `chore start settings`.
  - `'settings set refuses a settings block it can't edit safely'`: a block that repeats `max_active_tickets` is refused (`/repeats/`) and the file is unchanged; an empty block `{}` gets `{"max_active_tickets": 4}`, valid JSON.
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement** as in the interfaces.
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit.** `kit-85: T4 settings set in the settings chore`.

### Task 5: The finding and the label

**Files:**
- `devteam.mjs`:
  - a new `askedSettingView(key) -> { value, shown, label, asked, act }` near `dashboardData`;
  - `dashboardData()` gains `asked_settings`;
  - metrics adds the finding (~11570).
- Test: `test/owner-setting.test.mjs`.

**Interfaces:**
- `mainSettingsRaw() -> object|null`: main's settings block without defaults, so the code can tell "not set" from set. It is built on `kit-84`'s `mainRef()` or its settings view, per Task 0's note; no second ref resolver.
- `landedOverride(key, sinceIso) -> act|null`: the newest supervisor `settings-edit` without `for`, for `key`, newer than `sinceIso`, whose value equals main's value, with a `merge-chore` act with refs `['chore-settings']` newer than it. This is the design's rule; it reads no commit but main (spec: "A settings-edit has landed"; plan-1 P1-4, spec-2 F2-1, F2-2).
- `askedSettingView(key)` (`asked` is always present: the act's value, or `null` with `act: null`):
  - `value` is main's value (`loadSettings()[key]`, which is pinned);
  - `act = latestOwnerSetting(key)`;
  - the label:
    - with no act: `The kit's default` when `mainSettingsRaw()` lacks the key, else `Set by the supervisor`;
    - with an act whose value equals main's (canonical): `Set by you`;
    - with a `landedOverride(key, act.created_at)`: `Set by the supervisor (you asked for <shown(act.value)>)`, where `shown(null)` inside the parenthesis reads `no limit`;
    - otherwise: `Saved; applies once the supervisor lands it`.
- The finding fires for each key whose label is `Saved; …`. Its detail is `the owner asked for <key> <v> (<act id>); main has <v'>`. Its fix lists the four commands with the act's id and value, then: `while Upkeep is drained or parked, chore start and merge --chore refuse, so the value waits until Upkeep runs (or --force, logged)`. When `goalMode(upkeepOrVirtual()) !== 'run'`, the fix leads with `Upkeep is <holdWords>: `.

- [ ] **Step 1: Failing tests.** One fixture, walked through these states; at each, `metrics --json` and `dashboard-data` (or `/api/data`) are read:
  1. No act, key not on main: `The kit's default`, no finding.
  2. No act, main sets 4: `Set by the supervisor`.
  3. The owner asks for 7: `Saved; applies once the supervisor lands it`; the finding (medium), whose fix matches `/chore start settings/`, `/settings set max_active_tickets 7 --for <id>/`, `/chore pr settings --title/`, `/merge --chore settings/` and `/waits until Upkeep runs/`.
  4. A `settings set max_active_tickets 3` without `--for`, in the chore, not merged: still `Saved…`, the finding still there.
  5. That chore merged (main has 3): `Set by the supervisor (you asked for 7)`, no finding.
  6. The owner asks for 3: `Set by you`.
  7. The owner asks for none, then the supervisor lands none `--for`: `Set by you`, `shown` is `No limit`, no finding.
  8. Upkeep parked (`goal hold upkeep park --owner`) and a new ask: the fix begins `Upkeep is parked`.
  9. A no-op override (plan-1 P1-4): with main at 3 and the owner asking for 5, the supervisor runs `settings set max_active_tickets 3` without `--for` (the file is unchanged) and lands the settings chore (another key's edit rides along). The label is `Set by the supervisor (you asked for 5)`, and there is no finding: the supervisor deliberately kept 3.
  10. An override that never merged clears nothing: a `settings set … 5` without `--for`, chore not merged, while main holds 3 and the owner asked for 6. Still `Saved…`, with the finding (this is state 4's rule; checked here once more after state 9's merge, so the override from state 9 doesn't count for the newer act).
- [ ] **Step 2: Run.** Expect FAIL.
- [ ] **Step 3: Implement** as in the interfaces.
- [ ] **Step 4: Run.** Expect PASS.
- [ ] **Step 5: Commit.** `kit-85: T5 the owner-setting-unlanded finding and the Settings label`.

### Task 6: Verification and the PR

- [ ] Merge `origin/main`. Run `test/owner-setting.test.mjs`, `test/gateway.test.mjs` and `test/pane-question.answer.test.mjs` (which shares the proof code) through `devteam.mjs gate`, one at a time, at `--test-concurrency=2`.
- [ ] Push, and get CI's conclusion from `gh run view`, never a log excerpt.
- [ ] Write `verification.md`: one row per done-when, with its command and result at a named sha.
- [ ] Write the PR body, `docs/devteam-dev/tickets/kit-85-owner-setting-workers/pr-body.md`, with:
  - a summary and how to verify;
  - `## Migration`: `max_active_tickets` and `max_active_per_component` now apply as they are on main, so a value changed in the working tree and never merged goes back to main's on upgrade. Land it through the settings chore to keep it (`chore start settings`, `settings set`, `chore pr settings`, `merge --chore settings`). This release also changes `cloud/gateway.mjs`, so the box redeploys at release;
  - `## One-way doors`: `None.`
- [ ] Get two final reviews from other sessions (`send supervisor … --kind review-request`), then `check-ticket`, then `merge-request`.
