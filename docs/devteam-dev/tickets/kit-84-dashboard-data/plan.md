# kit-84-dashboard-data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## TL;DR

- Seven tasks. Six each add one block of derived data to `devteam.mjs`, with one `test()` in `test/dashboard-data.test.mjs`, and nothing new is stored.
- T1 adds class names (`CLASS_WORDS`, `className`, `class_name` and `class_words`, and the learning-mark label). T2 adds `held_by` and the `blocked-without-question` finding. T3 adds `threads` to hello and data.
- T4 adds `upkeep_days`. T5 adds the `governance` command and `GET /api/governance`. T6 adds `settings_all`, with secrets shown by construction. T7 re-records the G1 `dashboard-data` golden under the supervisor's ruling.
- Every test drives the CLI (`dashboard-data`, `hello --json`, `metrics --json`, `governance --json`) on a throwaway fixture. One dashboard server, in T5, checks both HTTP routes.
- Runs on this box are one file, `node test/run.mjs --concurrency 2 test/dashboard-data.test.mjs`, through `devteam.mjs gate test`. CI is the gate.
- Build starts only after kit-81 and kit-208 have merged and approve-plan is recorded (m-20261115-194943086-supervisor).
- No one-way doors. The existing `blocked` (high) finding and the G1 goldens stay byte-for-byte.

**Goal:** the `/api/data`, hello and `/api/governance` fields that the dashboard overhaul's page tickets draw from.

**Architecture:** pure read functions in `devteam.mjs` placed beside the code they derive from. `dashboardData()`, `collectOoda()`, `cmdHello()` and `collectMetrics()` call them. The new `governance` command is wired into `COMMANDS`, `OPERATOR_READS` and a dashboard route that runs it, as `/api/timeline` does.

**Tech stack:** Node 18+ built-ins, `node:test`, and the kit's `test/lib/kit.mjs` fixtures (`threadsFixture`, `fleetFixture`, `dashboardOnFreePort`).

**Spec:** `docs/devteam-dev/tickets/kit-84-dashboard-data/spec.md`, at its approved commit. Read it with this plan.

## Global constraints

- Files: only `docs/devteam/scripts/devteam.mjs` and `test/dashboard-data.test.mjs` (this ticket's folder aside), plus `test/fixtures/g1/dashboard-data.txt` as ruled in m-20261115-201425507-supervisor. Task 7 re-records it, adding fields only.
- Nothing is written by any read. Each test asserts this for the log (`docs/devteam/run/log`), comparing bytes before and after.
- No class id ever reaches a display field. The comparison is case-insensitive, and the match is on whole words (spec §2).
- No credential reaches `settings_all` (spec §6, the show kinds).
- Days are UTC, each keyed by `starts_at` (ISO midnight; G1's `untimed` drops `*_at`), the last 14, oldest first.
- `blocked` (high) and `blocked-on-owner` keep their text and conditions (pinned by `test/lib/chain.mjs` ~3180-3240).
- Test runs on the box: only `test/dashboard-data.test.mjs`, at `--concurrency 2`, through `gate`. Never the full suite. Never judge a run through a pipe.

## Review Focus

1. **A project with no `upstream_base` and no `strategy.md`, the commonest new adoption.** Governance still lists every file with `differs: null` and "not written yet", and never throws. T5 test, case "no sync".
2. **A `/api/data` read on a log where a merge act's refs are empty or not a chore** (older lines, a `merge-word` for a plan). `upkeep_days` skips the line and doesn't throw. T4 test, the case "an act with no refs".
3. **A supervisor class with uppercase or digits** (`decide --class Rollback2`). `className` falls back without throwing, and the name contains no id. T1 test.
4. **A ticket blocked and parked with its goal.** No `blocked-without-question`. T2 test.
5. **A settings value of the wrong type** (`agent_command: 42`, `max_active_tickets: "lots"` in the working tree). The show kinds still produce `null` (withheld), never the raw value and never a throw. T6 test.

---

## The test file: shared shape

`test/dashboard-data.test.mjs` imports `{ test } from 'node:test'`, `assert from 'node:assert/strict'`, `fs`, `path`, `{ execFileSync }` from `node:child_process`, and `{ threadsFixture, fleetFixture, line, write, json, dashboardOnFreePort, PORTS }` from `./lib/kit.mjs`. The test's own helper is `handLine`, so it doesn't clash with kit.mjs's `line`.

Each task adds one top-level `test('<name>', { timeout: 300000 }, async (t) => …)`. Each test builds its own fixture and registers its `F.done()` in `t.after`, with a guarded undo list as in `test/question-links-moved.test.mjs`.

Helpers at the top of the file, written in T1 and reused after:

- `data(F)`: `json(F.ok(F.old, ['dashboard-data']))`, the same JSON `/api/data` serves.
- `logBytes(F)`: a `Map` of each `docs/devteam/run/log/*.jsonl` to its bytes. A test asserts it is equal before and after its reads.
- `handLine(F, by, o, agoMs, file?)` (P1-1, P2-1): writes one log line by hand, with an explicit, unique id. `agoMs` is how long ago, the same sense `F.hand` uses. `F.hand` itself makes ids only for thread, turn, question and observation lines, so this helper doesn't call it; it writes the line in `F.hand`'s format.
  - `at = Math.floor(Date.now() - agoMs)`, a whole millisecond (P3-1). While `at` is in the module's `used` set, it adds 1 ms, so a line written later never sorts earlier. Then it adds `at` to `used`. Callers keep lines at least a minute from now, so the few added milliseconds never reach the future.
  - `id = ${PREFIX[o.type]}-${stamp(new Date(at))}-${by}`, with `PREFIX = { act: 'a', phase: 'h', message: 'm', decision: 'd', observation: 'o' }`. `stamp` is a copy, in the test, of the one-line `stamp` inside `threadsFixture` (`kit.mjs` ~150), which is not exported (P3-2). Plan-2 confirmed these shapes pass log-check.
  - It appends kit.mjs's `line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: new Date(at).toISOString(), by })` to `F.logDir/(file ?? \`${by}-${yyyy-mm of at}.jsonl\`)`.
  - So each line's `at` is the one asked for, give or take a few tie-break milliseconds, and no two lines share an id.
- `dayAt(d)` (P1-12): a time inside UTC day `d` back from today that is never in the future.
  - For `d ≥ 1`, it is that day's UTC midnight plus 30 minutes.
  - For `d = 0`, it is `day0 + Math.floor((Date.now() - day0) / 2)`, which lies inside today even just after midnight. T4 writes its day-0 lines in the order it expects them, and the tie-break keeps that order.

---

### Task 1: Plain names for every kind of decision

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`:
  - beside `ladder()`/`RUNG` (~1105-1124): `CLASS_WORDS`, `className`, `RUNG_PLAIN`;
  - `collectOoda()` (~11776-11826): `class_name` on rows, and the `learning_marks` label;
  - `dashboardData()` (~11828): `class_words` and `class_name` on `questions`.
- Test: `test/dashboard-data.test.mjs`, test "every kind of decision has a plain name, and no class id shows".

**Interfaces:**
- Produces:
  - `CLASS_WORDS: Readonly<Record<string,string>>`
  - `className(c: string|null|undefined): string|null`, which is null for a null or undefined class
  - `withClassName(row)`, which returns `{ ...row, class_name: className(row.class) }`

- [ ] **Step 1: Write the failing test.** Fixture: `threadsFixture('class-words')`. Then:
  - `F.sup(['decide', '--class', 'rename-column', '--', 'renamed a column'])`.
  - `F.sup(['decide', '--class', 'Rollback2', '--', 'rolled back'])` (accepted, checked in plan-1).
  - an `ask` with `--class goal-change`;
  - `F.sup(['act', '--class', 'add-ticket', '--refs', 'x', '--', 'added x'])`.
  - **A rung change** (P1-3): an `ask --class new-feature --question "Start x?" --recommendation yes`, answered by the owner with `answer <qid> "yes" --autonomy 3`. `ooda.learning_marks` then has a `rung` mark for `new-feature`.
  - **A rule row** (P1-3): `F.owner(['knowledge', 'add', '--kind', 'fact', '--statement', 'x builds with make', '--scope', 'project', '--owner'])`. `ooda.decisions` then has a `kind: 'rule'` row.

  The class set the test builds:
  - the constitution's `json devteam` block, parsed from `docs/devteam/governance/constitution.md`: `classes` keys, `constitutional`, `owner_only`;
  - every quoted string in a `class:` expression, `cls = ` and `OWNER_ACTS` in `docs/devteam/scripts/devteam.mjs`. Regex per line: lines matching `/\bclass: |\bconst cls = |OWNER_ACTS = /`, then take `/'([a-z][a-z0-9]*(?:-[a-z0-9]+)+)'/g`;
  - the template expansions `fleet-drain`, `fleet-park`, `fleet-undrain`, `fleet-unpark`;
  - `owner-setting`, `settings-edit`.
  - Minus `NOT_CLASSES` (P1-6). The scan also picks up words that sit on a `class:` line but aren't classes; the test lists each with its reason:
    - `let-go`: a goal hold;
    - `owner-decision`: a question kind;
    - `owner-only`: a reason;
    - `goal-definition`: a question kind;
    - `chore-registry`: a ref.

    Any further false hit found while building goes on this list with its reason; a real class never does.

  Assertions:
  - `for (const c of set) assert.ok(d.class_words[c], \`no plain name for ${c}\`)`.
  - **The display rule.** `noId(name)` must hold for:
    - every value of `d.class_words` (P1-15);
    - each non-null `class_name` of a known class in `d.ooda.classes` (values), `d.ooda.trust`, `d.ooda.decisions`, `d.ooda.acts`, `d.ooda.answered` and `d.questions`;
    - each `d.ooda.learning_marks[].label` of kind `rung`. The test also asserts that at least one such mark exists and reads `"<CLASS_WORDS['new-feature']> to decides and tells you"`.

    `noId` is true when, for every id in `set` (the known classes; P1-2):
    - `name.toLowerCase() !== id.toLowerCase()`, and
    - `!new RegExp(\`(^|[^a-z0-9-])${id}($|[^a-z0-9-])\`, 'i').test(name)`.
  - The made-up classes are checked by exact value, not by `noId` (P1-2). The decision with class `rename-column` reads `'Unnamed kind (rename column)'`, and `Rollback2` reads `'Unnamed kind (rollback2)'`. The spec's rule is that a bare id never shows. The made-up id inside "Unnamed kind (…)" is that rule's own fallback (spec §2).
  - A rule row (`kind: 'rule'`) exists and has `class_name: null`.
  - **The self-test.** The fixture holds its own copy of the kit (`F.old/docs/devteam/scripts/devteam.mjs`). Delete the `'goal-order':` line from that copy's `CLASS_WORDS` and run `dashboard-data` again. The test's own check, `missingNames(set, d.class_words)`, then returns `['goal-order']`. Restore the copy afterwards.
  - `logBytes` is unchanged.
- [ ] **Step 2: Run it.** `node /data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs gate test -- node test/run.mjs --concurrency 2 test/dashboard-data.test.mjs`. Expected: FAIL, because `d.class_words` is undefined.
- [ ] **Step 3: Implement.**
  - `CLASS_WORDS` has one entry for every class in the test's set. Each is in sentence case, describes the kind of decision, and contains no id. Examples: `'new-feature': "Starting a feature you haven't asked for"`, `'merge-word': 'Merging a ticket'`, `'merge-chore': 'Merging a chore'`, `'fleet-park': 'Parking the whole fleet'`, `'goal-order': 'Putting the goals in order'`, `'owner-setting': 'Asking for a setting'`, `'settings-edit': 'Changing one of its own settings'`.
  - `className(c)` returns `CLASS_WORDS[c]`; else ``Unnamed kind (${String(c).toLowerCase().replace(/-/g, ' ')})``; null or undefined gives `null`. Freeze the map.
  - `RUNG_PLAIN = { 1: 'asks you first', 2: 'asks, goes ahead at a deadline', 3: 'decides and tells you' }` (the design's level words).
  - In `collectOoda`:
    - `classes`: `class_name` on each entry;
    - `trust`, `decisions`, `acts`, `answered`: map through `withClassName`;
    - the rung `learning_marks` label: ``${className(t.class)} to ${RUNG_PLAIN[e.rung]}``.
  - In `dashboardData`: `class_words: CLASS_WORDS`, and `questions` through `withClassName`.
- [ ] **Step 4: Run it.** Same command. Expected: PASS, exit 0.
- [ ] **Step 5: Commit.** `git commit -m "kit-84 T1: plain names for every kind of decision"`, then the task review `reviews/task-1.md`.

### Task 2: held_by and blocked-without-question

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`:
  - `heldByMap()`, near `rankQuestions` (~8635);
  - `dashboardData()`: `tickets`, `planners`;
  - `collectMetrics()`: the phase loop (~11431-11440), and the planner block after it.
- Test: test "each blocked item names the question holding it".

**Interfaces:**
- Produces: `heldByMap(): Map<string /* ticket id or 'plan-<feature>' */, string /* qid */>`. It is built once per call from `rankQuestions(questions().filter(open && goal_hold !== 'let-go'))`, in rank order, keeping the first qid per item:
  - a ticket from `q.ticket` and each id in `q.blocks`;
  - a planner from its `waiting_on_owner` filtered to that same open set.
- Gating: the planner and ticket findings below test `!H.has(id)`, the same `held_by`, not `ownerQs` (P1-7). `H = heldByMap()` is computed once in `collectMetrics`.
- Consumes: `planners()`, `deriveStatus()`.

- [ ] **Step 1: Write the failing test.** Fixture `threadsFixture('held-by')`, which gives the goal `F.goal`.
  - Add a feature: `F.sup(['feature', 'add', 'hb-work', '--json', JSON.stringify({ title: 'HB', goals: [F.goal], stories: [{ id: 'HB-S1', text: 'x', release: 'v1.0.0' }] })])`.
  - Add four tickets `app-01-a`, `app-02-b`, `app-03-c` and `app-04-d` the way `g1Outputs` adds them: component `app`, feature `hb-work`, serving `HB-S1`. Below they are t-a to t-d.
  - For the parked case (P1-4), a second goal `g2` (`goal add` with the fixture's goal arguments, title "Other"), feature `hb-other` serving it, and ticket `app-05-e` (t-e) in it.

  Then:
  - `qa`: an `ask` with `--blocks t-a`, stake 3 and urgency 3.
  - `qb`: an `ask` with `--ticket t-b`.
  - `qa2`: an `ask` with `--blocks t-a`, stake 1 and urgency 1, so it ranks after `qa`.
  - **A planner whose goal has an open question** (P1-13, the spec's case).
    - `const { goal: g3, question: qg } = F.approval()` makes a goal up for approval with an open goal-approval question.
    - A branch `plan/hb-plan` in `F.old` with one commit. The commit adds `docs/devteam/project/log/plan-hb-plan.jsonl` holding one feature line, `{ v: 1, id: 'hb-plan', type: 'feature', op: 'new', at, by: 'plan-hb-plan', title: 'HB plan', goals: [g3], stories: [] }`.
    - It isn't on main, so `plannersNow` lists it with `goals: [g3]`, and `waiting_on_owner` holds `qg`.

  Assert in `dashboard-data`:
  - `tickets` `t-a.held_by === qa`, `t-b === qb`, `t-c === null`;
  - the planner row's `held_by` is `qg`.
  - Answer `qa` with `F.owner(['answer', qa, 'yes'])`, then `t-a.held_by === qa2`. Withdraw `qa2`, then `null`.

  Findings (`metrics --json`):
  - `handLine(F, 't-c', { type: 'phase', to: 'blocked' }, 5 * 60000, 't-c.jsonl')`. A finding `{ severity: 'medium', kind: 'blocked-without-question', subject: 't-c' }` appears. Its suggestion matches `/ask --blocks t-c/` and `/answer its blocked message/`.
  - `handLine(F, 't-d', { type: 'phase', to: 'blocked' }, 2 * 3600000, 't-d.jsonl')`. `blocked` (high) is raised for `t-d`, and `blocked-without-question` is not.
  - An `ask --blocks t-c`: no `blocked-without-question` for `t-c`.
  - t-e blocked 5 minutes ago while g2 runs: `blocked-without-question` is raised for t-e (P2-3). Then `goal hold <g2> park --owner`: it is no longer raised for t-e (P1-4). The existing `blocked` finding needs an hour, so it isn't raised either; it isn't this ticket's to change.
  - The planner: `F.sup(['withdraw', qg, '--reason', 'test'])` (P2-2: `answer` refuses a goal-approval question), so it holds nothing. Then `handLine(F, 'plan-hb-plan', { type: 'message', kind: 'blocked', to: 'supervisor', text: 'need a ruling' }, 60000)` raises `blocked-without-question` with subject `plan-hb-plan`.
  - `logBytes` is unchanged across the reads.
- [ ] **Step 2: Run it.** Expected: FAIL, because `held_by` is undefined.
- [ ] **Step 3: Implement.**
  - `heldByMap` as in the interface.
  - In `dashboardData`: `tickets: deriveStatus().map((r) => ({ ...r, held_by: H.get(r.id) ?? null }))`, and `planners` the same keyed on `plan-${p.feature}`.
  - In `collectMetrics`'s phase loop, add after the `blocked` line:

    ```
    else if (p.phase === 'blocked' && h < 1 && !H.has(id) && live(id)) add('medium', 'blocked-without-question', id, `blocked for ${Math.round(h * 60)} min with no open owner question naming it`, `if it waits on the owner, ask (ask --blocks ${id}); otherwise answer its blocked message so it can move`)
    ```

    `live(id)` is a ticket that is active, unmerged, and whose `ticketMode` is not `park` or `let-go`.
  - After the loop, for each planner with `waiting_on_supervisor.some((m) => m.kind === 'blocked')` and no `H.get(key)`: `add('medium', 'blocked-without-question', key, 'blocked with no open owner question naming it', <same hint with key>)`.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** "kit-84 T2: held_by and blocked-without-question", then `reviews/task-2.md`.

### Task 3: Threads by state

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`:
  - `threadCounts()`, beside `openThreadCount` (~6244);
  - `cmdHello` (~18781): `r.threads`;
  - `dashboardData()`: `threads`.
- Test: test "threads by state, in the hello and the data".

**Interfaces:**
- Produces: `threadCounts(): { you: number, waiting: number, ready: number }`, over `threadViews(readLog().objects)` with status open. A thread counts as `ready` if `v.ready`; else as `you` if `v.waiting === 'owner'`; else as `waiting`.

- [ ] **Step 1: Write the failing test.** Fixture `threadsFixture('thread-counts')`, using `F.hand` for timed turns (thread and turn ids are its own):
  - T1: the owner's turn, then the supervisor's `thread reply`, so it is the owner's move.
  - T2: the owner's turn only, so it waits on the supervisor.
  - T3: the owner's turn, the supervisor's reply, then `thread ready T3 --outcome "done"`.
  - T4: resolved by the owner.

  Assert:
  - `json(F.ok(F.old, ['hello', '--json'])).threads` deep-equals `{ you: 1, waiting: 1, ready: 1 }`;
  - `data(F).threads` deep-equals the same;
  - `logBytes` is unchanged.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** as in the interface. Add `threads: threadCounts()` to `cmdHello`'s `r`, after `inbox`, and to `dashboardData`.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** "kit-84 T3: threads by state in hello and data", then `reviews/task-3.md`.

### Task 4: Upkeep's days

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`:
  - `upkeepDays(now = Date.now())`, after `isRecordKeeping` (~10760);
  - `dashboardData()`: `upkeep_days`.
- Test: test "Upkeep's last 14 days, from a log with known answers".

**Interfaces:**
- Produces: `upkeepDays(now?: number): Array<{ starts_at: string /* ISO UTC midnight */, items: Array<{ kind: 'chore'|'kit-sync'|'ci-fix'|'retro', ref: string, words: string, at: string }>, failed: boolean }>`.
- Consumes: `logObjects('act')`, `logObjects('observation')`, `tickets()`, `isRecordKeeping`, `CHORES`.

- [ ] **Step 1: Write the failing test.** Fixture `threadsFixture('upkeep-days')`. Write supervisor acts `{ type: 'act', class, what, refs, reversible: false }` and observations with `handLine(F, 'supervisor', …, Date.now() - dayAt(d))`, so each has its own id:
  - day 0: `merge-chore` `chore-tidy` twice (two lines, two ids: the code's dedupe is what is tested); `merge-chore` `chore-docs`; `merge-chore` `chore-log`;
  - day 2: `merge-chore` `chore-devteam-sync-v0.9.0`;
  - day 3: `merge-chore` `chore-ci-fix-node24`;
  - day 5: an observation `{ source: 'supervisor', subject: 'project', kind: 'retro', detail: 'r' }`, and `merge-chore` `chore-retro-<date>`;
  - day 6: `merge-word` refs `[<a chores-feature ticket id>]`. The ticket is added with feature `chores`, kind `chore` and notes;
  - day 7: `merge-chore` with `refs: []` (Review Focus 2);
  - day 15: `merge-chore` `chore-old`.

  Assertions on `data(F).upkeep_days`:
  - its length is 14, and `.at(-1).starts_at` is today's UTC midnight, as an ISO string;
  - day 0's items, as `[kind, ref, words]`, deep-equal `[['chore', 'chore-tidy', 'Merged chore tidy'], ['chore', 'chore-docs', 'Merged chore docs']]`, in `at` order. The duplicate tidy and the log chore are absent;
  - day 2 is `kit-sync`, "Kit synced to v0.9.0";
  - day 3 is `ci-fix`, "CI fix ci-fix-node24", with `failed: true`, and every other day `failed: false`;
  - day 5 has exactly one item, `retro`;
  - day 6 is `chore`, "Merged <title>";
  - day 7 is `[]`, a quiet day;
  - no item has ref `chore-old`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Days: `day0 = Date.UTC(y, m, d)` of `now`, giving 14 dates from `day0 - 13·864e5` to `day0`.
  - Acts by `supervisor`:
    - For `merge-chore`, the ref is `refs[0]`, skipped unless it matches `/^chore-(.+)$/`. Slug rules, in this order:
      - `isRecordKeeping` or `/^retro-/`: skip;
      - `/^devteam-sync-(.+)$/`: kit-sync;
      - `/^(ci-fix|devteam-workflow)/`: ci-fix, and the day is failed;
      - anything else: chore.
    - For `merge-word`, the ref is a ticket in `CHORES`: chore, "Merged <title>".
  - A supervisor `retro` observation: retro.
  - Dedupe on `date|kind|ref`. Sort each day's items by `at`.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** "kit-84 T4: upkeep_days", then `reviews/task-4.md`.

### Task 5: The governance listing

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`:
  - `governanceView()` and `cmdGovernance()`, after `strategyState` (~4835);
  - `COMMANDS`: `governance: cmdGovernance`;
  - `HELP`: one line under "Observe and orient", next to `timeline` (P1-8): `governance [--json]   the kit's governance and process files and the project's strategy and exterior: title, last change, changed here`. Not added to `OPERATOR_READS`: the spec doesn't ask it.
  - the dashboard routes (~15084): `GET /api/governance`, which runs `['governance', '--json']`.
- Test: test "the governance listing, read-only, with what changed here".

**Interfaces:**
- Produces: `governanceView(): { files: Array<{ group: 'governance'|'process'|'project', path: string, title: string, last_change: string /* ISO or '—' */, differs: boolean|null, written: boolean, state: 'not written yet'|'changed here'|null }> }`.
- Algorithm (the one non-obvious part):
  - Kit files: `git ls-tree --name-only <main> -- <kitRel>/governance/ <kitRel>/process/`, using the existing `kitRel` (P1-14), filtered to `*.md` and sorted. With no main, `fs.readdirSync(path.join(repoRoot, kitRel, …))`.
  - Project: `${projectRel}/strategy.md` and `${projectRel}/exterior.md`. `written` comes from `git cat-file -e`, or from disk.
  - One walk: `git log --first-parent --diff-merges=first-parent --format=%x00%H %cI --name-only <main> -- <all paths> <projectRel>/settings.md`. On a git without `--diff-merges`, retry with `-m --first-parent`. Parse it into commits in order, each with its files; the first commit seen per path is that path's newest.
  - Shallow: read the file named by `git rev-parse --git-path shallow`, if it exists, into a set of shas. A file whose newest commit is in it, or that has none, gets `last_change: '—'`.
  - Sync commits: each walk commit touching `settings.md` where `releaseParts(settingsAt(c, { orNull: true })?.upstream_base)` is set, and different from `settingsAt(`${c}^1`, { orNull: true })?.upstream_base` (a missing parent counts as null).
  - `differs` (kit rows):
    - `null` when there is no sync commit, or the file's newest commit is unknown or shallow;
    - else `!syncs.has(newest)`.
  - Title: the first line matching `/^# (.+)/` in the file's text at main, or on disk. Failing that, the file name without `.md`. A missing project file gets "Strategy" or "Exterior" (spec §1).
- [ ] **Step 1: Write the failing test.** Use `fleetFixture` with a fresh init: a fixture function in the test, `govFixture(name, upstreamBase)`. It makes a temp repo, copies the kit, runs `init --name x --upstream-base v0.1.0` (or with no base), then commits and pushes.
  - Case A, `v0.1.0`:
    - All rows: the groups in order; a governance file `constitution.md` with title `Constitution` (its real heading), `differs: false`, and `last_change` an ISO string; project rows for strategy and exterior with `written: false` and "not written yet".
    - Edit `governance/quality.md` and commit. That row reads `differs: true`, "changed here".
    - A second sync commit sets `upstream_base` `v0.2.0` and changes `process/worker.md`. quality still reads `true`, and worker reads `false`.
    - Write `strategy.md` and commit. It reads `written: true` with its title.
  - Cases B and C share one fixture (P1-15): init with no `--upstream-base`, and with `--project` naming `docs/elsewhere` (a global flag). The project rows' paths start `docs/elsewhere/`, and every kit row reads `differs: null` (Review Focus 1).
  - Case D, shallow: `git clone --depth 1 file://<origin> neu`, then `governance --json` in `neu`. Every `last_change` is `'—'`, and every kit `differs` is `null`.
  - HTTP: one `dashboardOnFreePort(caseA, env)`, with the env `question-links-moved.test.mjs` uses (its own `DEVTEAM_HUB_PORT`, `DEVTEAM_PORT_BASE`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`). `GET /api/governance` deep-equals the CLI's JSON. `GET /api/data` answers 200 with `class_words`, `threads`, `upkeep_days` and `settings_all`; `held_by` is checked in T2 (P1-14).
  - `logBytes` is unchanged.
- [ ] **Step 2: Run it.** Expected: FAIL, unknown command `governance`.
- [ ] **Step 3: Implement** as above. `cmdGovernance` prints JSON with `--json`; else one line per row: ``${group.padEnd(10)} ${path}  ${state ?? ''}``.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** "kit-84 T5: governance listing and /api/governance", then `reviews/task-5.md`.

### Task 6: Every kit setting

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`:
  - `SETTINGS_READ_ONLY_HERE`, `SETTINGS_KEYS`, `SETTINGS_WORDS`, `SETTING_SHAPES`, `shownAs` and `settingsAll()`, after `OWNER_SETTINGS` (~604);
  - `dashboardData()`: `settings_all`.
- Test: test "every kit setting, grouped, named, with no secret shown".

**Interfaces:**
- Produces:
  - `SETTINGS_READ_ONLY_HERE = ['sensor_scrub']`
  - `SETTINGS_KEYS`, frozen. Ruling m-20261115-201932691 calls this "the same list loadSettings uses". It is built from the two maps `loadSettings` reads, `SETTINGS_DEFAULTS` (its defaults) and `OWNER_SETTINGS` (the keys it pins to main), plus `SETTINGS_READ_ONLY_HERE`:
    ```
    [...new Set([...Object.keys(SETTINGS_DEFAULTS), ...Object.keys(OWNER_SETTINGS), ...SETTINGS_READ_ONLY_HERE])]
    ```
    It has 44 keys today. `settingsAll` walks it, so a key added to either map shows up with no other edit.
  - `SETTINGS_WORDS: Record<key, [group, name, description, show: 'value'|'names'|'count'|'hidden']>`
  - `settingsAll(): Array<{ key, group, name, description, shown, value, withheld?, local?, local_withheld?, set, default, owner_only, source? }>`.
    - The order: the entries in `SETTINGS_WORDS` order (its groups in the order below), then any `SETTINGS_KEYS` key missing from `SETTINGS_WORDS`, in key order.
    - A missing key reads `{ group: 'Other', name: 'Unnamed setting (<key>)', description: '', shown: 'hidden', value: null }` (P1-10).
- `shownAs(key, kind, v)`:
  - `value`: `SETTING_SHAPES[key](v) && strings(v).every((s) => !UNSAFE_TEXT.test(s) && scrubText(s) === s) ? v : WITHHELD`. `strings(v)` collects every string in `v`, keys included (spec-5 F5-1: release branches and paths, and autonomy class names, too). When it is `WITHHELD`, the entry gets `value: null` and `withheld: true`.
  - `names`: `isObj(v) ? Object.keys(v) : []`. Each key name also goes through the scrub check; a name that fails reads `'[withheld]'`.
  - `count`: `Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0`.
  - `hidden`: `null`.
- `SETTING_SHAPES` is a `Record<key, (v) => boolean>`, one entry for each of the 29 `value` keys:
  - `num` (`v === null || Number.isFinite(v)`) for the caps, minutes, hours, days, ceiling, port and `incident_slots`;
  - `typeof v === 'boolean'` for `merge_admin`;
  - `['github', 'git'].includes(v)` for `forge`;
  - `['merge', 'squash', 'rebase'].includes(v)` for `merge_method`;
  - `['adopt', 'ask'].includes(v)` for `upstream_sync`;
  - `releaseProblem(v) === null` for `release` (it refuses any key beyond `branch`, or beyond `on` and `paths`);
  - `v === null || /^v\d+\.\d+\.\d+$/.test(v)` for `upstream_base`;
  - `v === null || NAME.test(v)`, with `NAME = /^[A-Za-z0-9._\/-]{1,100}$/`, for `main_branch`, `tmux_session` and `project`;
  - a list of one-line strings (`typeof s === 'string' && s.length <= 100 && !UNSAFE_TEXT.test(s)`) for `usage_sources`, `ignored_checks`, `worktree_files` and `worker_denied_commands`;
  - for `autonomy_ceilings`: an object whose keys match `/^[a-z0-9-]{1,60}$/` and whose values are among 1, 2 and 3.

  Each default in `SETTINGS_DEFAULTS` passes its shape. The test asserts this for all 29.
- `value` and `set`:
  - `m = settingsAt(mainRef(), { orNull: true })`, or `null` with no main;
  - the raw block: `rawMain = parsed JSON of main's settings block` (`set` is `Object.hasOwn(rawMain, key)`);
  - with `m === null`: `loadSettings()` and `source: 'working tree'`.
  - `local`: the main checkout's own settings file, parsed, shown the same way. Present only when `canonical(shown local) !== canonical(shown main)`.
  - `default` (P1-10):
    - `value`, `names` and `count` keys: `shownAs(key, kind, SETTINGS_DEFAULTS[key] ?? (kind === 'value' ? null : {}))`.
    - The five hidden commands (`agent_command`, `resume_command`, `agent_trust_command`, `usage_command`, `worktree_setup`): their raw kit default, a kit constant.
    - `upstream_repo` and the 'Other' fallback: `null`.
  - `local` goes through `shownAs` too. A withheld local reads `local: null` and `local_withheld: true`.
- The words, in this order. Each line gives key | show | name | description.

  **Fleet and capacity**
  - `max_active_tickets` | value | Workers at once, in all | the most tickets with a worker running at the same time
  - `max_active_per_component` | value | Workers at once, per component | the most workers at the same time within one component
  - `max_active_planners` | value | Planners at once | the most planners running together; none means no cap
  - `machine_memory_ceiling` | value | Memory ceiling | share of the machine's memory at or above which a new worker or planner waits
  - `tick_minutes` | value | Supervisor tick | how often the supervisor looks over everything when nothing wakes it
  - `stale_after_minutes` | value | Silent session after | minutes without a sign of life before a worker counts as stuck
  - `tmux_session` | value | Terminal session name | the tmux session the windows live in; none means one named after the project
  - `dashboard_port` | value | Dashboard port | where this dashboard listens; none means a free port in the hub's range

  **Agents and sessions**
  - `agent_command` | hidden | Agent command | what starts each worker, planner and the supervisor
  - `resume_command` | hidden | Resume command | what brings a stopped session back on its own conversation
  - `agent_trust_command` | hidden | Folder-trust answer | a command run before each agent starts so it trusts its worktree; empty runs nothing
  - `worker_denied_commands` | value | Commands workers may not run | patterns refused in every worker and planner
  - `worktree_setup` | hidden | Worktree setup | a command run in each new worktree after its files are copied
  - `worktree_files` | value | Files copied into worktrees | untracked files each worktree needs, copied from the main checkout
  - `usage_command` | hidden | Usage command | a command that reports spend for a harness the kit can't read
  - `usage_sources` | value | Usage sources | which agents' own logs spend is read from
  - `model_prices` | names | Model prices | prices for models the kit has none for, or overrides

  **Merging and checks**
  - `gates` | names | Checks before merge | the commands that must pass at a ticket's head before it merges
  - `ignored_checks` | value | Ignored forge checks | forge checks merge doesn't wait for
  - `slow_gate_minutes` | value | Slow check after | minutes a check may take before it's flagged slow
  - `main_branch` | value | Main branch | the branch work merges into
  - `merge_method` | value | Merge method | how PRs land: a merge commit, squash or rebase
  - `merge_admin` | value | Merge past branch protection | whether merge uses admin rights where the forge requires a review the author can't give
  - `forge` | value | Forge | where PRs live: GitHub, or plain git
  - `autonomy_ceilings` | value | Autonomy ceilings | the highest level the supervisor may reach for a kind of decision, below the kit's
  - `hold_review_days` | value | Parked goal review | days a goal stays parked before the owner is asked about it again

  **Questions and findings**
  - `question_default_after_hours` | value | A default applies after | hours before a question with a default takes it
  - `finding_ack_hours` | value | A finding set aside for | hours a set-aside finding stays quiet, unless its subject changes

  **Upstream and releases**
  - `upstream_repo` | hidden | Kit source | where new devteam releases come from
  - `upstream_base` | value | Kit release in use | the devteam release this project runs
  - `upstream_sync` | value | Kit updates | adopt each release on its own, or ask you first
  - `upstream_check_hours` | value | Check for kit releases every | hours between checks for a new devteam release
  - `release` | value | How a release reaches production | a tag, a production branch, or every merge to main

  **Production**
  - `sensors` | names | Sensors | the production signals the supervisor reads
  - `sensor_defaults` | names | Sensor defaults | settings every sensor starts from
  - `sensor_scrub` | count | Sensor scrub patterns | extra patterns scrubbed from what sensors bring back
  - `remediations` | names | Remediations | the reviewed scripts that may restart, scale or roll back production
  - `incident_slots` | value | Incident fixes past the cap | fix tickets that may run beyond the worker cap, so an incident never waits
  - `secret_commands` | count | Commands a secret may be sent to | command prefixes a secret's sink may run, as you

  **Rhythm**
  - `retro_every_days` | value | Retro every | days between retrospectives
  - `research_every_days` | value | Research every | days between research spikes on new tools and practice

  **Project and links**
  - `project` | value | Project name | this project's name on the hub and in its public links
  - `components` | names | Components | the parts of the work, each with its own lines of files
  - `links` | names | Linked repos and resources | the repos and resources this project works in or reads

  `release` is a `value` key, checked with `releaseProblem`. Any other shape is withheld.

- [ ] **Step 1: Write the failing test.** Fixture `fleetFixture('settings-all')`. On main, settings set:
  - `max_active_tickets: 3`;
  - `agent_command: 'claude --token ghp_PLANTED1'`, and the same for `resume_command`, `agent_trust_command`, `usage_command` and `worktree_setup`;
  - `gates: { test: { cmd: 'TOKEN=PLANTED2 npm test' } }`;
  - `upstream_repo: 'https://user:PLANTED3@example.com/PLANTED4/kit.git'`;
  - a link with url `https://example.com/?key=PLANTED5`;
  - `sensors: { web: { kind: 'http', url: 'https://example.com/PLANTED6' } }`;
  - `sensor_defaults: { params: { token: 'PLANTED7' } }`;
  - `remediations: { restart: { script: 'x.mjs', params: { key: 'PLANTED8' } } }`;
  - `sensor_scrub: ['PLANTED9']`;
  - `release: { branch: 'production', token: 'PLANTED11' }`;
  - `tmux_session: 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'` (36 characters). `tmux_session`, not `main_branch` (P1-11): a token there would break `mainRef()`;
  - `secret_commands: ['gh secret set PLANTED10']`;
  Commit and push. One fixture serves every case (P1-15). The working-tree edits come after, in turn, each restored before the next:
  - (a) `max_active_tickets: 4`;
  - (b) `agent_command: 42` and `max_active_tickets: 'lots'` (Review Focus 5);
  - (c) `release: { branch: 'main\u202e' }` (a bidi override).

  Assertions on `data(F).settings_all`:
  - **Keys** (P1-9). They equal the union of `SETTINGS_DEFAULTS`' keys, `OWNER_SETTINGS`' keys and `sensor_scrub`. The test reads the keys from the source by regex, not by evaluating it (`KIT_UPSTREAM` is an identifier):
    - `SETTINGS_DEFAULTS`: lines matching `/^  ([a-z_]+):/` between `const SETTINGS_DEFAULTS = {` and the next `^};`;
    - `OWNER_SETTINGS`: every `/\b([a-z_]+): '/` between `const OWNER_SETTINGS = {` and `^};`.

    The size of the set is 44.
  - **Reads.** Every `loadSettings\(\)\.([a-z_]+)` and `settingsAt\([^)]*\)\??\.([a-z_]+)` match in the source is in the set. plan-1 counted 72 sites, all in it, so the test keeps no exception list. Its reach is the spec's (§6, F3-3).
  - **Order.** Groups appear in the order listed above.
  - **Max.** `max_active_tickets` has `value: 3`, `set: true`, `local: 4`, `default: 5`, `owner_only: null`.
  - **Gates.** `gates` has `owner_only: 'gate-change'` and `value: ['test']`.
  - **Count.** `sensor_scrub` has `value: 1`.
  - **Agent command.** `agent_command` has `value: null`, `set: true`, and `default: 'claude --dangerously-skip-permissions'`.
  - **No credential.** `JSON.stringify(settings_all)` contains none of `PLANTED1` through `PLANTED11`, nor the `ghp_` string.
  - **Withheld.** `release` and `tmux_session` read `withheld: true` and `value: null`.
  - **Working tree (a).** `max_active_tickets` reads `local: 4`.
  - **Working tree (b).** No throw. `agent_command.local` is absent or `null`, and `max_active_tickets` reads `local: null, local_withheld: true`.
  - **Working tree (c).** `release` reads `local: null, local_withheld: true`.
  - **Defaults** (P1-5, P2-4). The test parses main's settings block itself (`git show main:docs/devteam/project/settings.md`, the same regex), giving `mainKeys`.
    - Every entry's `set` equals `mainKeys.has(key)`.
    - Every `value` key not in `mainKeys` is not withheld, and its `value` deep-equals `SETTINGS_DEFAULTS[key]`.
  - **Wrong type.** In the `agent_command: 42` case, no throw and no `42` under it.
  - **Words.** Each entry has a non-empty name and description; no description is longer than 140 characters or has a newline.
  - **Self-test.** Remove `tick_minutes:` from `SETTINGS_WORDS` in the fixture's own kit copy (`F.old/docs/devteam/scripts/devteam.mjs`), and restore it afterwards. On that copy, `dashboard-data` still exits 0, so the owner's page never breaks on a new key. The entry reads `{ group: 'Other', name: 'Unnamed setting (tick_minutes)', shown: 'hidden', value: null }`, and the test's words check fails, naming the key (asserted: the missing set is `['tick_minutes']`). A missing name hides the value rather than guessing a show kind, so a new key can't leak.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** as in the interface and words above. `rawMain` comes from `git show <main>:<projectRel>/settings.md`, through the same block regex as `settingsAt`.
- [ ] **Step 4: Run it.** Expected: PASS.
- [ ] **Step 5: Commit.** "kit-84 T6: settings_all", then `reviews/task-6.md`.

### Task 7: The G1 golden (ruled m-20261115-201425507-supervisor)

**Files:**
- Modify: `test/fixtures/g1/dashboard-data.txt`.

- [ ] **Step 1: Re-record it.** Run only the G1 test (P1-15): `DEVTEAM_G1_RECORD=1 node --test --test-name-pattern '^G1' test/components.test.mjs`, through `gate test`. `components.test.mjs` isn't a touched file, so nothing else in it runs on the box.
- [ ] **Step 2: Read the diff.** Recording rewrites all 13 goldens. `git diff --stat test/fixtures/g1/` must list only `dashboard-data.txt` (P2-5). Any other file changed means an output moved: stop and find why. Then `git diff test/fixtures/g1/dashboard-data.txt` adds only these fields:
  - `class_words` and `class_name` keys;
  - `held_by` on tickets and planners;
  - `threads`, `upkeep_days` (with no `starts_at` and no dates) and `settings_all`;
  - the `learning_marks` label words, if the fixture has rung marks.

  It removes and changes nothing else. A date, a temp path or a port in it means a new field isn't stable: fix the field, never the golden.
- [ ] **Step 3: Run it again, without RECORD.** The same G1 test, once. Expected: PASS. CI runs it again as part of the full suite.
- [ ] **Step 4: Commit.** "kit-84 T7: G1 golden carries the new dashboard-data fields (ruled m-20261115-201425507)", then `reviews/task-7.md`.

### Finishing (worker.md §8)

- Merge `origin/main`. Run the one file again through `gate test`. Then `gate ci`, confirming the run's conclusion with `gh run view`.
- Write `verification.md`: one row per done-when, each with its test name, the command, the result and the commit.
- Open the PR with a `## One-way doors` section reading "None.". Get the final review from a fresh subagent with the spec and the diff. Run `check-ticket`, then send the merge-request.

## Rulings

- m-20261115-194943086-supervisor: plan ahead. Build nothing until the dependencies merge and approve-plan is recorded. Run only the touched file at `--test-concurrency=2`.
- m-20261115-195732788-supervisor: the settings scope, as Task 6.
- m-20261115-201932691-supervisor: approve-spec at e3d2a80. done_when 5: recurring checks move to kit-168. done_when 6: `settings_all` covers every setting the kit reads, 44 today, taken from loadSettings' own list (`SETTINGS_KEYS`, T6).
- m-20261115-201425507-supervisor: `test/fixtures/g1/dashboard-data.txt` is in the touches. Re-record only the new fields; the PR's diff of it shows additions only, and the final reviewers check that (Task 7).
