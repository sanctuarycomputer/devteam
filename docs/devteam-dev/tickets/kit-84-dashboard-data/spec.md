# kit-84-dashboard-data: spec

Dashboard data: the governance listing, plain names for every kind of decision, what holds each item that needs the owner, and Upkeep's days.

- Feature: dashboard-cleanup (stories DCL-S6, DCL-S7); design `project/designs/a-cleaner-more-consistent-dashboard.md` (home), sections Board, Autonomy pages, Goals page (Upkeep's heartbeat), the hub card head, Data, Failure modes.
- Touches: `docs/devteam/scripts/devteam.mjs`, `test/dashboard-data.test.mjs`. Nothing else.
- Depends on: kit-81 (merged, `links_moved`), kit-208 (link records in home; in review). Build waits for both and approve-plan (ruling m-20261115-194943086-supervisor).
- Reference: the mock at home main, `project/artifacts/dashboard-cleanup/` (`UPKEEP_DAYS`, `heartbeat`, `HUB_THREADS`, the Governance page).

## Why

The dashboard overhaul's page tickets (kit-87 onward, kit-93, kit-94) each draw from data that does not exist yet. This ticket adds that data, derived on read and stored nowhere, so each page ticket only draws. Every new field has one consumer in the same component; the contract is this ticket's tests (design, Contracts).

## What is built

### 1. The governance listing

- New read command `governance [--json]` and route `GET /api/governance` (the dashboard runs the command, as `/api/record` and `/api/timeline` do; same Host and relay checks as every route).
- It returns `{ files: [...] }` in three groups, in this order:
  - `governance`: every `<kitRel>/governance/*.md`, by name;
  - `process`: every `<kitRel>/process/*.md`, by name;
  - `project`: `<projectRel>/strategy.md`, then `<projectRel>/exterior.md`, following `--project` (projectRel).
- Each row: `{ group, path, title, last_change, differs, written }`.
  - `path`: repo-relative.
  - `title`: the file's first `# ` heading, else its file name without `.md`.
  - `last_change`: the ISO commit time of the newest commit on main that touched the file, or `"—"` when there is none on main or that commit is a shallow boundary (listed in `.git/shallow`, whose true history is cut off).
  - `differs`: for kit files, `true`/`false` against the kit's copy (below); `null` when there is no kit copy to compare with. Always `null` for the project rows (they are the project's, not the kit's).
  - `written`: `true` when the file exists; a project row whose file is missing has `written: false`, `title` "Strategy" / "Exterior", `last_change` `"—"` and the display word "not written yet" in `state`. Kit rows always exist.
  - `state`: the display words: `"not written yet"`, `"changed here"` (differs true), or `null`.
- Read from main (as `strategyState` does) where the project is in the repo and main exists; else from the working tree.
- **The kit's copy** (my call, for the reviewer to check): the file as it was at the newest commit on main that changed `upstream_base` in `settings.md`. Every sync commit is "kit files verbatim from the tag; upstream_base vX" (checked: devteam-dev's log), and init sets it first, so that commit holds the release's bytes, offline. `differs` is `main's blob !== that commit's blob`. No such commit (no `upstream_base`, the kit repo itself, or history too shallow to reach it): `null`. Rejected: fetching the upstream tag (a network call on every 10 s read) and comparing with the running kit on disk (that is `kitVersion`'s `+local`, not local divergence).
- Cost: one `git log` per file plus one for the sync commit, cached per main sha for the life of the process (the dashboard runs it per request, so one call is a handful of git reads).

### 2. Plain names for every kind of decision

- One `CLASS_WORDS` map in `devteam.mjs`, beside `ladder()` and `RUNG`: class id → a plain-English name for a kind of decision ("Starting a feature you haven't asked for", "Merging a ticket", …), sentence case, no class id or hyphenated token in it.
- **Every class** means: every class in the constitution's ` ```json devteam ` block (`classes`, `constitutional`, `owner_only`), every class the kit writes itself (each `class: '…'` literal and computed class in `devteam.mjs`: `merge-word`, `approve-feature-plan`, `merge-chore`, `fleet-drain`, `fleet-park`, `fleet-undrain`, `fleet-unpark`, `goal-order`, `goal-approval`, `goal-change`, `goal-met`, `add-ticket`, `replan-within-feature`, `pane-answer`, …), and kit-85's two new act classes `owner-setting` ("Asking for a setting") and `settings-edit` ("Changing one of its own settings"), named here so kit-85 only uses them (design: "get CLASS_WORDS names").
- `className(c)`: `CLASS_WORDS[c]`, else a fallback for a class the supervisor made up with `decide --class` or `ask --class`: its words with hyphens as spaces, first letter capitalised ("Rename a column"), so no id text shows even then.
- `/api/data` carries:
  - `class_words`: the whole map;
  - `class_name` on every row that carries a class: `classes` (each entry), `trust`, `decisions`, `acts`, `questions`, `answered`. These are "the fields meant for display".
- The test fails if any class in the set above has no `CLASS_WORDS` entry, and if any `class_name` equals or contains a class id.

### 3. What holds each item that needs the owner

- Every ticket row (`tickets`, from `deriveStatus`) and planner row (`planners`) in `/api/data` gains `held_by`: the id of the open question holding it, or `null`.
  - A ticket is held by an open question (not on a let-go goal, as the Inbox counts) whose `ticket` is the ticket or whose `blocks` names it.
  - A planner is held by one of its `waiting_on_owner` questions.
  - More than one: the first in Inbox order (`rankQuestions`), so it is the one the owner would answer first.
  - Only open questions: answered, defaulted and withdrawn ones hold nothing.
- `metrics` raises `blocked-without-question` (medium) for:
  - an active, unmerged ticket whose worker's phase is `blocked` and whose `held_by` is null;
  - a planner whose newest phase line is `blocked` and whose `held_by` is null.
  - Subject: the ticket id, or `plan-<feature>`. Fix hint: "ask the owner what it waits on (ask … --blocks <id>), or answer its blocked message so it can unblock".
  - Not raised for a parked or superseded ticket, or a ticket on a parked or let-go goal (it waits by choice).

### 4. Threads by state, in the hello and `/api/data`

- `threads: { you, waiting, ready }`, counted from today's thread data (`threadViews`) over open threads; each open thread counts once:
  - `ready`: the supervisor proposed resolving it and the owner said nothing since (`view.ready`);
  - else `you`: the owner's move: its newest turn is the supervisor's (`view.waiting === 'owner'`);
  - else `waiting`: waiting on the supervisor (`view.waiting === 'supervisor'`).
- **Read marks:** the done-when names "a reply they haven't read". The kit keeps no read marks today (neither the log nor the page; checked `devteam.mjs` and `index.html`), and nothing new is stored, so `you` counts every open thread whose newest turn is the supervisor's: a reply the owner hasn't answered. If a read mark lands later it narrows `you` in one place. Flagged in the review request.
- In `hello --json` (what the hub reads through `/api/hello`) and `/api/data`, the same function.

### 5. Upkeep's days

- `/api/data` `upkeep_days`: the last 14 UTC days, oldest first, today last. Each `{ date: 'YYYY-MM-DD', items: [{ kind, ref, words, at }], failed }`; a quiet day has `items: []`, `failed: false`.
- Items:
  - `chore`: a `merge-chore` act by the supervisor, ref `chore-<slug>`, words "Merged chore <slug>". Record-keeping chores (`isRecordKeeping`: `log`, the handoffs, `secret-*`) are not upkeep and are left out. Also a merged ticket in Upkeep's chores feature (`merge-word` act on a ticket whose feature is `chores`).
  - `kit-sync`: a `merge-chore` of `devteam-sync-<tag>`, words "Kit synced to <tag>".
  - `ci-fix`: a `merge-chore` of `ci-fix…` or `devteam-workflow…` (the kit's own CI-fix rule, `CI_RULE_SCOPES`), words "CI fix <slug>"; it sets the day's `failed`.
  - `retro`: a supervisor `retro` observation, words "Retro".
- Each act once: a merge act repeated for the same ref on the same day counts once.
- **Recurring checks are not in this ticket.** The ticket's note (m-20261115-004047034-plan-recurring-upkeep) gives them to whichever of this ticket and kit-168 lands second. kit-168 is on `plan/recurring-upkeep`, not landed, and its `recurring-run` line needs a `status` field the log schema doesn't have yet (outside these touches). So this ticket lands first, and kit-168 adds `kind: 'check'` items and their `failed` from the agreed rule. The item shape takes them with no change. Flagged in the review request.

## Acceptance checks (the done-whens, restated)

All in `test/dashboard-data.test.mjs`, green in CI at the PR head.

1. **Governance listing.** A fixture project: `GET /api/governance` lists each `governance/*.md`, `process/*.md`, then strategy and exterior under the project folder; each with path, title, last change and differs.
   - A kit file edited on main after the sync commit reads `differs: true` and `state: "changed here"`; an untouched one `false`.
   - With `--project` naming another folder, the project rows follow it.
   - No `strategy.md` or `exterior.md`: listed, `written: false`, "not written yet".
   - In a shallow clone (depth 1), `last_change` is `"—"`.
2. **Class names.** Every class in the constitution block, every class literal the kit writes (the test scans `devteam.mjs` for `class: '…'`, the merge classes and the `fleet-…` templates), `owner-setting` and `settings-edit` has a `class_words` entry; a missing one fails with its id. Every `class_name` in `classes`, `trust`, `decisions`, `acts`, `questions`, `answered` is a string that is no class id and contains none; a made-up class falls back to its words.
3. **held_by.** A ticket named by an open question's `blocks`, one by `--ticket`, one with none: `held_by` is the qid, the qid, `null`; with two holding, the first in Inbox order; after the answer, `null`. A planner waiting on the owner carries its question. `metrics` raises `blocked-without-question` (medium, with the hint) for a blocked ticket with no question, and not once a question blocks it.
4. **Threads.** Fixture threads: one where the supervisor spoke last, one where the owner did, one with a ready proposal and one resolved: `hello --json` and `/api/data` both carry `threads: { you: 1, waiting: 1, ready: 1 }`. No file in the run folder or log changes from reading them.
5. **Upkeep's days.** A fixture log with known answers: chores merged, a kit sync, a CI fix and a retro on known days, a record-keeping `log` chore, and a line 15 days old. `upkeep_days` has 14 days, today last, each day's items as expected, the CI-fix day `failed: true`, the log chore and the old line absent, a quiet day empty.

## Contracts

- Provided (no versioned contract; the design says each field is defined by this ticket's tests): `GET /api/governance` and `governance --json`; `/api/data` `class_words`, `class_name`, `held_by`, `threads`, `upkeep_days`; `hello --json` `threads`; finding `blocked-without-question`.
- Consumed: `threadViews`, `rankQuestions`, `questions()`, `deriveStatus`, `planners`, `ladder()`, the merge acts as `merge` writes them.

## Edge cases

- A repo with no main yet, or a home whose project is not in the repo: governance reads the working tree; `last_change` `"—"`, `differs` null.
- A class id that is also an ordinary word ("drain", "recovery"): the containment check is on whole hyphenated ids and on single-word ids only as the whole name, so "Draining the fleet" passes.
- A question holding a ticket on a let-go goal: not counted (the Inbox hides it), so the ticket reads `null`.
- A thread with no turns (not reachable through `thread new`, possible by hand): counted as `you`, as `threadView` already says.
- Clock: days are UTC, as the hello's pulse counts them; the page labels them in local time.

## Out of scope

- Any page drawing (kit-87, kit-90, kit-91, kit-93, kit-94).
- Recurring checks in `upkeep_days` (kit-168, above).
- The Autonomy Score data (`autonomy`, kit-98) and suggestions (kit-99).
- The `owner-setting` act itself (kit-85); only its class name is here.
- Read marks for threads.

## Rulings

- m-20261115-194943086-supervisor: plan ahead; write and review spec and plan now, build nothing until dependencies merge and approve-plan is recorded; briefs carry lessons k-20261115-182656232, k-20261115-080753394, k-20261115-164245020 and the scripts-in-files rule; run only touched files at --test-concurrency=2.
- m-20261115-004047034-plan-recurring-upkeep (in the ticket's notes): whichever of kit-84 and kit-168 lands second adds recurring runs to `upkeep_days`.
