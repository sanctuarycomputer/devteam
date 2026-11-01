# The log

The record of how the project runs: what was observed, what was learned from it, what was decided and by whom, what was done, and what was corrected. It is the loop made explicit:

| Step | What it is here | Objects |
|---|---|---|
| **Goals** | what the work is for; planning chains backwards from them (`planning.md` §0) | `goal` |
| **Observe** | metrics, findings, readings, and meta observations about the graph, the code and the project | `observation`, `phase` |
| **Orient** | recurring observations promoted into knowledge, and problems with a lifecycle | `knowledge`, `problem` |
| **Decide** | questions to the owner, and the trust ladder that decides when to ask (`governance/autonomy.md`) | `question` |
| **Act** | what the supervisor did, and corrections of it | `act`, `correction`, `seen` |

Learning closes the loop: an outcome is an observation that refers back to the acts, questions or goals that caused it, and corrections change trust, knowledge and context (§4).

Rules and doctrine stay in markdown, where people read and edit them. Records go in the log, where scripts write and fold them. Human rulings stay in `project/decisions.md`, where they are diffs someone can review.

## 1. Objects

One JSON object per line. Every line has an envelope: `v` (1), `id`, `type`, `op`, `at`, `by`. `op: "new"` creates an object; `op: "set"` with the same id changes some of its fields. Nothing is ever edited or deleted: a change is a new line, and current state is computed by folding the lines (`constitution.md` §2, compute state). Ids look like `q-20261031-141502123-supervisor`: a type letter, the time, the writer. The full field list is in [`schema/log.schema.json`](../schema/log.schema.json).

| Type | Fields that matter | Written by |
|---|---|---|
| `goal` | title, outcome, measure (description, target, unit, direction), horizon, non_goals, constraints, preconditions, priority, status draft / ready / met / abandoned | supervisor drafts; only the owner moves it out of draft |
| `observation` | subject, kind, detail, severity 0-4, valence -2..+2, source_key (to dedupe), refs, fix_hint, measure | anyone |
| `phase` | from, to, cumulative usd and tokens | a worker at each phase change (`heartbeat --phase`), the supervisor for its own cost |
| `knowledge` | kind fact / lesson / preference / constraint / pointer, statement, scope, confidence 0..1, valence, evidence, status candidate / accepted / stale / retired | supervisor or owner |
| `problem` | title, realized (an issue) or not (a risk), severity 0-4, threatens (goal ids), status open / owned / mitigating / resolved, assigned_to | supervisor; the owner may change it |
| `question` | kind, class, why_asked, recommendation, confidence, default, blocks, evidence; the owner's answer, autonomy direction and standing rule | supervisor asks; the owner answers (`questions.md`) |
| `act` | class, scope, what, rung, approved_by, reversible, refs | supervisor |
| `correction` | act, reason, severity, repair undo / fix-ticket / none | owner, or the supervisor at a retro |
| `seen` | upto: the owner has read the act feed up to this time | owner |

Scales (severity, valence, confidence, priority) are numbers; labels are derived for display. Sets that grow (decision classes, reasons, observation kinds) live in tables, not in the schema. An **outcome** is an observation with kind `outcome` and refs to what caused it. A **goal reading** is an observation with kind `reading`, the goal as subject and a measure. A **retro** is recorded as an observation with kind `retro`: its two-line summary, the path of the retro file, and refs to what it produced (`improvement.md` §3.1).

## 2. Observe

- **Workers** record a phase line at every phase change (`worker.md` §4) and observations about their ticket when something is worth knowing beyond it: `devteam.mjs observe --subject <component|gate|ticket> --kind slow-test --detail "auth suite takes 40s" --valence -1`.
- **The supervisor** records metrics findings each tick (`observe-metrics`, deduped to once a day per finding), goal readings at each retro (`goal reading`), outcomes of trials and decisions, and anything it notices about the graph itself: estimates that missed, tickets added after a feature was approved, design changes that planning should have caught.
- Reviewers write nothing to the log. A `CHANGES` verdict is already in the review record, and the metrics read it from there.

## 3. Orient

- `devteam.mjs orient` lists **recurring signals**: three or more observations (or corrections) on the same key, from at least two writers or on at least two days, that no knowledge entry or problem refers to yet.
- For each one the supervisor decides: a **lesson** (`knowledge add --kind lesson --scope component:api --evidence <ids>`), a **problem** (`problem add`), or nothing (the signal is noise; say so with an observation). Positive signals become lessons to keep doing.
- **Knowledge** starts as a candidate. The supervisor or the owner accepts it. What the owner writes or sets (a standing rule, an acceptance) the supervisor can't change; it asks. Only accepted entries are used: `make-worker.sh` appends the accepted knowledge whose scope matches the ticket's component or feature (or the whole project) to the worker's prompt, and the supervisor reads `knowledge --for <class>` before deciding in a class. Retire entries that stop being true; mark them stale when unsure.
- **Problems** are things that are wrong or could go wrong, with a lifecycle. A risk that happens is the same problem with `realized` set. Link the goals it threatens. Work to fix a problem is a chore ticket that names it in its notes.

## 4. Act, and how corrections are used

The supervisor logs each decision as an act: `devteam.mjs act --class <c> [--scope s] [--approved <qid>] -- "<what>"`. For a ladder class the command checks the rung first and refuses (logging nothing) when the supervisor may not act alone (`autonomy.md` §2). For the supervisor's own classes it just records.

The owner corrects an act from the dashboard (or `devteam.mjs correct <act-id> --reason "…"`); the supervisor records corrections it finds at a retro with `--retro`. A correction does six things:

1. **Trust:** a correction of an act in a ladder class drops the whole class to rung 1 and resets its clean count (`autonomy.md` §6).
2. **Repair:** the supervisor undoes a reversible act, or makes a fix ticket, and says which on the correction.
3. **Learning:** corrections cluster in `orient` by class and scope; three of them make a lesson or a problem.
4. **Context:** that lesson, once accepted, goes into the prompt of the next session working in that scope, so the correction changes behaviour, not just a number.
5. **Visibility:** the dashboard shows correction counts beside the ladder.
6. **Evidence:** a trust question lists the corrections since the class last dropped.

## 5. Where it lives

- **Live:** `run/log/<file>.jsonl` (gitignored, in the main checkout, shared by every worktree through `DEVTEAM_RUN`). Every line lands here the moment it is written, under a short lock, so concurrent writers never interleave.
- **Durable:** `project/log/<file>.jsonl`, in git. The supervisor runs `devteam.mjs log-sync` once a day (and before merging a plan that names a newly approved goal, since CI's `validate` reads only the durable log). It copies the live files onto branch `chore-log` in its own worktree and opens the log-only PR, which it merges like any other once CI passes. Under strict branch protection, update that PR after the tick's ticket merges, then merge it last.
- **One file per writer:** `owner-YYYY-MM.jsonl`, `supervisor-YYYY-MM.jsonl`, `<ticket-id>.jsonl`, `plan-<feature>.jsonl`. Readers merge all files and sort by time. Per file, they read whichever copy extends the other.
- **CI** (`check-pr`, in the `merge-word` job): only branch `chore-log` may change `project/log/`, only there, and only by appending. Every added line must be valid, written by the file's writer, allowed by the authority table below, in time order, not dated after the commit, and, in a monthly file, dated in its month; a writer's new file can't start before the end of its older ones. Any other PR that touches the log fails.
- **Order and ids:** each append takes the file's lock, catches the live file up with main's copy if main is ahead, and stamps a time just after the file's last line, so ids are unique and lines stay in order even if the clock steps back. A half-written last line (a crash) is dropped.
- **Repair:** if a bad line ever reaches `project/log` (`validate` reports it as a warning; it never blocks other PRs), the owner removes it in a PR merged with an admin override, the one case where a log line is edited, and records why in `project/decisions.md`.

### Authority

| Writer | May create | May change |
|---|---|---|
| owner | goal, correction, knowledge, observation, seen | question answers (answer, autonomy, standing rule), goal (any field, including status), knowledge, problem |
| supervisor | question, observation, knowledge, problem, act, correction, goal (draft), phase (its own cost) | question status (withdrawn or defaulted), reason and recorded_in; knowledge and problem fields; goal fields while the goal is a draft. Never a field the owner wrote. |
| planner | observation | nothing |
| worker | phase, observation | nothing |

When two writers set the same field, the higher one wins whatever the timestamps say: owner, then supervisor, then planner, then worker. The creator of an object holds its fields at the creator's rank, so the supervisor can't rewrite an owner's standing rule or goal. An owner's answer stands even if the supervisor applied the default later. Goal readings count only from the supervisor or the owner.

### What this protects and what it doesn't

Every session runs as the same user, so nothing stops a determined agent from writing to another writer's live file. The log makes such a write visible rather than impossible: owner lines record whether they came from the dashboard or the command line, owner commands refuse to run where `DEVTEAM_ROLE` is set, the log-only PR shows every added line, and `devteam.mjs log-check` lists every line the fold ignored. The hard walls are where they always were (`autonomy.md` §7).

## 6. Commands

| Command | For |
|---|---|
| `log [--type t] [--by w] [--id x] [--json]` | the folded objects |
| `log-check` | validate every line; list lines the fold ignored |
| `log-sync [--dry-run]` | supervisor: the daily log-only PR |
| `observe …`, `observe-metrics` | record observations |
| `orient` | recurring signals waiting to be explained |
| `knowledge …`, `problem …` | orient |
| `ask`, `answer`, `withdraw`, `questions`, `recorded` | decide (`questions.md`) |
| `act`, `correct`, `seen`, `trust` | act, and the ladder (`autonomy.md`) |
| `goal …` | goals and their readiness (`planning.md` §0) |
