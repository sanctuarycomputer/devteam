# kit-84-dashboard-data: spec

Dashboard data: the governance listing, plain names for every kind of decision, what holds each item that needs the owner, Upkeep's days, and every kit setting.

- Feature: dashboard-cleanup (stories DCL-S6, DCL-S7); design `project/designs/a-cleaner-more-consistent-dashboard.md` (home): Board, Autonomy pages, Goals page (Upkeep's heartbeat), the hub card head, How a governance file changes, Data, Failure modes.
- Touches: `docs/devteam/scripts/devteam.mjs`, `test/dashboard-data.test.mjs`. Nothing else.
- Depends on: kit-81 (merged), kit-208 (in review). Build waits for both and approve-plan (m-20261115-194943086-supervisor).
- Reference: the mock at home main 3cb8d6b, `project/artifacts/dashboard-cleanup/` (`UPKEEP_DAYS`, `heartbeat`, `HUB_THREADS`, the Governance page, `SETTINGS_ALL` on Settings).

## Why

The overhaul's page tickets (kit-87 onward, kit-93, kit-94) each draw from data that doesn't exist yet. This ticket adds it, derived on read and stored nowhere, so each page ticket only draws. Each new field has one consumer in the same component, and its contract is this ticket's tests (design, Contracts).

## What is built

### 1. The governance listing

- A new read command `governance [--json]` and a route `GET /api/governance`. The dashboard runs the command, as `/api/record` and `/api/timeline` do, behind the same Host and relay checks as every route.
- It returns `{ files: [...] }` in this order:
  1. `group: 'governance'`: every `<kitRel>/governance/*.md`, by name;
  2. `group: 'process'`: every `<kitRel>/process/*.md`, by name;
  3. `group: 'project'`: `<projectRel>/strategy.md`, then `<projectRel>/exterior.md`. `projectRel` follows `--project`.
- Each row is `{ group, path, title, last_change, differs, written, state }`:
  - `path`: relative to the repo.
  - `title`: the file's first `# ` heading; else its name without `.md`; for a missing project file, "Strategy" or "Exterior".
  - `last_change`: the ISO commit time of the newest first-parent commit on main that touched the file. It is `"—"` when no commit on main touched it, or when that commit is a shallow boundary (listed in the file `git rev-parse --git-path shallow` names, so its real history is cut off).
  - `written`: whether the file exists. Kit rows always exist.
  - `differs` (kit rows only; always `null` on project rows, which are the project's own):
    - `false` when the newest first-parent commit on main that touched the file is a **sync commit**;
    - `true` when another commit touched it after that;
    - `null` when main has no sync commit at all, or the file's newest commit can't be read (shallow).
    - A **sync commit** is a first-parent commit on main where `settings.md`'s `upstream_base` went from its parent's value to a different release tag (`vX.Y.Z`). That covers init with `--upstream-base`, and every sync ("kit files verbatim from the tag; upstream_base vX", as devteam-dev's history shows). Init's `"upstream_base": null` isn't one.
    - Why per file (F1-1): an adopt sync copies only the files upstream changed. So a file edited here and untouched by the next release still holds the local text after that sync. Its newest commit is then the local edit, so it still reads `true`.
    - What this misses: a sync PR that also carried a local edit to a file (with the owner's answer) reads `false` for that file. That is accepted and said in the code.
    - Rejected: fetching the upstream tag (a network call on every 10 s read), and comparing with the running kit on disk (that is `kitVersion`'s `+local`, not local divergence).
  - `state`, the words the page shows: `"not written yet"` when not written; `"changed here"` when `differs` is true; else `null`.
- It reads from main where the project is in the repo and main exists, as `strategyState` does; otherwise from the working tree, with `last_change` `"—"` and `differs` `null`.
- Cost (F1-10): each request is a fresh process, so nothing is cached in memory. It makes one `git log --first-parent --diff-merges=first-parent --name-only` walk of main limited to the listed paths plus `settings.md`. Each file's first appearance gives its newest commit. The `settings.md` commits in the same walk are the sync candidates, and each is checked with `settingsAt(c)` against `settingsAt(c^1)` (a handful). One `ls-tree` for each of the two folders.

### 2. Plain names for every kind of decision

- One `CLASS_WORDS` map in `devteam.mjs`, beside `ladder()` and `RUNG`. It maps a class id to a plain-English name for that kind of decision, in sentence case: "Starting a feature you haven't asked for", "Merging a ticket", and so on.
- **Every class** is the union of:
  - the constitution's `json devteam` block: `classes`, `constitutional`, `owner_only`;
  - every class the kit writes or shows itself, literal or computed: `merge-word`, `approve-feature-plan`, `merge-chore`, `fleet-drain`/`-park`/`-undrain`/`-unpark`, `goal-order`, `goal-change`, `goal-approval`, `goal-met`, `goal-hold`, `add-ticket`, `replan-within-feature`, `pane-answer`, `artifact-publish`, and the rest. Each owner act class in `OWNER_ACTS` is included.
  - kit-85's new act classes `owner-setting` ("Asking for a setting") and `settings-edit` ("Changing one of its own settings"). They are named here so kit-85 only uses them (design: "get CLASS_WORDS names").
- `className(c)` returns `CLASS_WORDS[c]`. For a class the supervisor made up (`decide --class`, `ask --class`), it returns "Unnamed kind (<its words, hyphens as spaces>)". So no bare id ever shows, a one-word id included, and the gap is visible (F1-11).
- In `/api/data`:
  - `class_words` at the top level: the whole map.
  - `class_name` on every row that carries a `class`: `ooda.classes` (each entry), `ooda.trust`, `ooda.decisions`, `ooda.acts`, `ooda.answered`, and the top-level `questions`. A row with no class (a rule row, most questions) has `class_name: null` (F1-9).
  - `ooda.learning_marks[].label` for a rung change reads "<className> to <rung in words>", for example "Merging a ticket to decides and tells you", in place of `` `${t.class} to rung N` `` (F1-6).
  - These are the fields meant for display.
- The rule: a display name is never a class id, compared case-insensitively. It never contains a hyphenated class id, and never contains a one-word class id as a whole word.

### 3. What holds each item that needs the owner

- `held_by` on every ticket row (top-level `tickets`) and planner row (`planners`) in `/api/data`: the id of the open question holding it, or `null`.
  - A ticket is held by an open question that the Inbox counts (not on a let-go goal) whose `ticket` is the ticket or whose `blocks` names it.
  - A planner is held by one of its `waiting_on_owner` questions, with let-go ones filtered out as for tickets (F1-12).
  - With several, the first in Inbox order (`rankQuestions`) wins: the one the owner would answer first.
- **`blocked-without-question`** (medium) in `metrics` (F1-2, F1-3):
  - **Tickets.** `metrics` already raises `blocked` (high) once a ticket has been in phase `blocked` for an hour with no owner question naming it. That stays as it is, and the chain test pins it. The new finding covers the first hour of the same condition: a ticket in phase `blocked` under an hour, with `held_by` null. So one blocked item carries one finding at a time: medium at once, then `blocked` (high) after an hour. With a question, neither is raised, and `blocked-on-owner` keeps its meaning.
  - **Planners.** A planner can't log phase `blocked` (`cmdPhase` refuses every planner phase but `parked`). It says it is blocked with a `blocked` message to the supervisor. So a planner is blocked when its `waiting_on_supervisor` holds a `blocked` message, and the finding is raised when its `held_by` is null too. It has no grace, because it shows only while the message is unanswered.
  - Subject: the ticket id, or `plan-<feature>`. Fix hint: "if it waits on the owner, ask (ask … --blocks <id>); otherwise answer its blocked message so it can move".
  - Not raised for a superseded or merged ticket, or a ticket on a parked or let-go goal (it waits by choice).

### 4. Threads by state, in the hello and `/api/data`

- `threads: { you, waiting, ready }` counts the open threads from `threadViews`. Each thread counts once:
  - `ready`: the supervisor proposed resolving it and the owner has said nothing since (`view.ready`);
  - else `you`: its newest turn is the supervisor's, so it is the owner's move (`view.waiting === 'owner'`);
  - else `waiting`: it waits on the supervisor.
- **Read marks** (F1-4): the page keeps per-browser read marks in `localStorage` (`devteam.thread.seen`; `tUnread`, index.html ~4962, ~5621). The server and the hub can't see those, and the done-when says nothing new is stored. So `you` counts every open thread whose newest turn is the supervisor's: a reply the owner hasn't answered, read or not. The page can narrow its own count with its marks. The hub can't, so its tab shows the server's count.
- One function serves both `hello --json` (which the hub reads through `/api/hello`) and `/api/data`.

### 5. Upkeep's days

- `/api/data` gains `upkeep_days`: the last 14 UTC days, oldest first and today last. Each day is `{ date: 'YYYY-MM-DD', items: [{ kind, ref, words, at }], failed }`. A quiet day has `items: []` and `failed: false`.
- Items:
  - `chore`, from a supervisor `merge-chore` act whose ref is `chore-<slug>`. Its words are "Merged chore <slug>".
    - Left out: record-keeping chores (`isRecordKeeping`: `log`, the handoffs, `secret-*`), which aren't upkeep, and `retro-*` chores, whose retro is counted once as `retro` (F1-7).
  - `chore`, from a `merge-word` act on a ticket in Upkeep's `chores` feature. Its ref is the ticket id, and its words "Merged <ticket title>".
  - `kit-sync`, from a `merge-chore` of `devteam-sync-<tag>`. Its words are "Kit synced to <tag>".
  - `ci-fix`, from a `merge-chore` whose slug starts `ci-fix` or `devteam-workflow` (the kit's CI-fix rule, `CI_RULE_SCOPES`). Its words are "CI fix <slug>", and it sets the day's `failed`.
  - `retro`, from a supervisor `retro` observation. Its ref is the observation id, and its words "Retro".
- Each item counts once: a second merge act for the same ref on the same day is dropped.
- **Recurring checks are not in this ticket.** The ticket's note (m-20261115-004047034-plan-recurring-upkeep) gives them to whichever of this ticket and kit-168 lands second.
  - kit-168 exists only on `plan/recurring-upkeep`. Its `recurring-run` line needs a `status` field the log schema doesn't have yet, and that schema is outside these touches. So this ticket lands first, and kit-168 adds `kind: 'check'` items and their `failed` by the agreed rule. The item shape takes them unchanged.
  - The done-when's "recurring checks run" and "when a recurring check failed" are asked of the supervisor as a `done_when` amendment, or a ruling, in the spec review request (F1-8).

### 6. Every kit setting (scope added: m-20261115-195732788-supervisor; owner, thread t-20261115-194652602-owner)

- `/api/data` gains `settings_all`: one entry for every setting the kit reads. It is built from the code, so a key added later shows with no list to keep in step.
  - The keys are those of `SETTINGS_DEFAULTS` (41 today), plus the owner settings with no default entry: `gates` and `remediations`, from `OWNER_SETTINGS`. That makes 43.
  - The done-when says "all 42". The mock's 42 are the 41 plus `gates`. `remediations` is a real setting too (the owner's, `governance-edit`, read by `ask --remediations` and merge), so it is listed under Production. I flag the count in the review request.
- Each entry is `{ key, group, name, description, value, set, default, owner_only }`:
  - `group`, `name`, `description` come from one `SETTINGS_WORDS` map beside `SETTINGS_DEFAULTS`: `{ key: [group, name, description] }`.
    - The groups and words are the mock's (`SETTINGS_ALL` at 3cb8d6b), in its order: Fleet and capacity, Agents and sessions, Merging and checks, Questions and findings, Upstream and releases, Production, Rhythm, Project and links.
    - `remediations` is added to Production: "Remediations", "the reviewed scripts that may restart, scale or roll back production".
    - Each description is one line.
  - `value`: the value in force, from main's `settings.md` (`settingsAt(mainRef())`, defaults filled in), or `loadSettings()` where main has none. `set` says whether main's file sets the key at all.
  - `default`: the kit's default (`SETTINGS_DEFAULTS[key]`; `{}` for `gates` and `remediations`). The kit's defaults are reported as the code has them. Changing a default (the mock's "no limit" for worker caps) is another ticket's.
  - `owner_only`: the class from `OWNER_SETTINGS` (for example `'gate-change'`), or `null`.
  - `settings_all` keeps the mock's order: groups in order, keys in `SETTINGS_WORDS` order.
- **Secrets are never shown, only their names.**
  - `links`, `sensors` and `remediations` show only their entry names (`value: ['devteam-kit', …]`). A link's locator, a sensor's URL and a remediation's params can carry a credential.
  - Every other value is shown as `settings` shows it, with no credential in it.
  - The test plants a credential-looking string in a link's URL, a sensor URL and a remediation, and asserts it appears nowhere in `settings_all`.
- The test fails if a key in `SETTINGS_DEFAULTS` or `OWNER_SETTINGS` has no `SETTINGS_WORDS` entry, naming it. The test also checks the reverse: a `SETTINGS_WORDS` key that the kit doesn't read is a stale name, and it fails.

## Acceptance checks (the done-whens, restated)

All of these are in `test/dashboard-data.test.mjs`, green in CI at the PR head.

1. **The governance listing.** Built on a fixture project initialised with `--upstream-base v0.1.0`. `GET /api/governance` lists each `governance/*.md`, then each `process/*.md`, then strategy and exterior under the project folder. Each row has a path, title, last change and `differs`.
   - An untouched kit file reads `differs: false`.
   - A file edited on main after the sync commit reads `true` and "changed here".
   - After a second sync commit that changes another file but not this one, the edited file still reads `true` (F1-1). The other file reads `false`.
   - With `--project` naming another folder, the project rows follow it.
   - With no `strategy.md` or `exterior.md`, each is listed with `written: false` and "not written yet".
   - In a `--depth 1` clone, `last_change` is `"—"`.
   - With no sync commit (initialised with `upstream_base` null), `differs` is `null`.
2. **Class names.**
   - The class set is the constitution block, plus every quoted class in the kit's `class:` expressions, `OWNER_ACTS`, the decision rows and the `fleet-…` templates (the test scans `devteam.mjs`), plus `owner-setting` and `settings-edit`. Every class in it has a `class_words` entry. A test that deletes one entry from a copy of the kit sees the check fail with its id.
   - Every non-null `class_name` in `ooda.classes`, `ooda.trust`, `ooda.decisions`, `ooda.acts`, `ooda.answered` and `questions` breaks the no-id rule nowhere. The same goes for `ooda.learning_marks[].label`.
   - A made-up class reads "Unnamed kind (…)".
3. **held_by.**
   - Three tickets: one named by an open question's `blocks`, one by its `--ticket`, one by neither. Their `held_by` are that qid, that qid, and `null`.
   - With two questions holding one ticket, the first in Inbox order wins. Once it is answered, the other holds it. Once both are answered, `held_by` is `null`.
   - A planner whose goal has an open question carries that question.
   - `metrics` raises `blocked-without-question` (medium, with the hint) for a ticket just blocked with no question. It doesn't raise it once a question blocks the ticket. A ticket blocked over an hour shows `blocked` (high) and not this finding.
   - A planner with an unanswered `blocked` message and no question raises the finding.
4. **Threads.** The fixture has four threads: one where the supervisor spoke last, one where the owner did, one with a ready proposal, and one resolved. `hello --json` and `/api/data` both carry `threads: { you: 1, waiting: 1, ready: 1 }`. Reading them changes no file in the log.
5. **Upkeep's days.** A fixture log with known answers has, on known days:
   - two chores merged, one of them twice on the same day;
   - a kit sync;
   - a CI fix;
   - a retro, with its `retro-*` chore merge;
   - a record-keeping `log` chore;
   - a chores-feature ticket merged;
   - a line 15 days old.

   `upkeep_days` has 14 days with today last, and each day's items are as expected. The CI-fix day has `failed: true`. The retro counts once. The log chore and the old line are absent. A quiet day is empty.
6. **Every setting.**
   - `settings_all` has one entry for each key in `SETTINGS_DEFAULTS` and `OWNER_SETTINGS`, in group order, each with key, group, name, description, value, set, default and owner_only.
   - A value set on main shows with `set: true`. A working-tree-only edit doesn't show.
   - Owner settings carry their class.
   - No planted credential appears anywhere in `settings_all`.
   - A missing or stale `SETTINGS_WORDS` entry fails with its key.

## Contracts

- Provided: `GET /api/governance` and `governance --json`; in `/api/data`, `class_words`, `class_name`, `held_by`, `threads`, `upkeep_days` and `settings_all`; `threads` in `hello --json`; the finding `blocked-without-question`. None is a versioned contract: the design says each is defined by its provider ticket's tests.
- Consumed: `threadViews`, `rankQuestions`, `questions()`, `deriveStatus`, `planners`, `ladder()`, the merge acts as `merge` writes them, `settingsAt`, `SETTINGS_DEFAULTS` and `OWNER_SETTINGS`.

## Edge cases

- **No main yet, or a home whose project isn't in the repo.** Governance reads the working tree, with `last_change` `"—"` and `differs` `null`. `settings_all` uses `loadSettings()`.
- **A class id that is an ordinary word** ("drain", "recovery"). The check works on whole words, so "Draining the fleet" passes.
- **A question on a let-go goal.** It holds nothing, for tickets and planners alike.
- **A thread with no turns.** It counts as `you`, as `threadView` already says.
- **Clock.** Days are UTC, as the hello's pulse counts them. The page labels them in local time.
- **A `git` without `--diff-merges`** (before 2.31). The walk falls back to `--first-parent -m`, which gives the same first-parent diffs.

## Out of scope

- Any page drawing (kit-87, kit-90, kit-91, kit-93, kit-94).
- Recurring checks in `upkeep_days` (kit-168, above).
- The Autonomy Score (`autonomy`, kit-98) and suggestions (kit-99).
- The `owner-setting` act (kit-85). Only its class name is here.
- Changing any setting's default.
- Read marks on the server.

## Rulings

- m-20261115-194943086-supervisor: plan ahead, writing and reviewing the spec and plan now. Build nothing until the dependencies merge and approve-plan is recorded. Briefs carry lessons k-20261115-182656232, k-20261115-080753394 and k-20261115-164245020, and the scripts-in-files rule. Run only the touched files, at --test-concurrency=2.
- m-20261115-195732788-supervisor: scope added from the owner (thread t-20261115-194652602): every kit setting on the Settings page. The new last done-when and the mock at main 3cb8d6b are folded in as §6.
- m-20261115-004047034-plan-recurring-upkeep (in the ticket's notes): whichever of kit-84 and kit-168 lands second adds recurring runs to `upkeep_days`.
