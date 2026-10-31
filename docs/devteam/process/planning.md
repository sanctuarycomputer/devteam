# Planning

How an owner direction becomes a validated **work graph**: a set of ticket files, one per future PR, with explicit dependencies, contracts, file footprints and machine-checkable done-whens. The graph is what the supervisor schedules from and what every worker orients by. If the graph is wrong, everything downstream is wrong, so planning is reviewed as hard as code.

Planning is run by the supervisor, or by a planner session the supervisor makes. It sits above [`ticket-lifecycle.md`](ticket-lifecycle.md) (which runs one ticket) and feeds [`supervisor.md`](supervisor.md) (which runs many).

## 0. Goals: where the chain starts

Planning works backwards from a goal: what must be true for the outcome to happen, which features make those things true, which stories and tickets make the features. So the chain needs a goal at its root, and the goal has to be unambiguous before anything is planned from it.

- **The owner states the goals.** The supervisor can draft one from what the owner says (`devteam.mjs goal add --title … --outcome …`), but it can't invent one, and only the owner approves it (`goal approve`, or the dashboard). Keep three to five goals active.
- **A goal is ready** when it has: an outcome (what is true for users or the business), a measure with a numeric target, unit and direction, a horizon date, at least one non-goal, the preconditions that must hold for the outcome, a priority distinct from the other goals, and a baseline reading (`goal reading <id> --value n`). `devteam.mjs goal check` lists what's missing.
- **The readiness interview.** While a goal has gaps, the supervisor asks one `goal-definition` question per goal listing every gap as a form, records the answers on the draft (`goal set`), and repeats until `goal check` is clean and no ambiguity remains in its judgment (undefined terms, two readings of the measure, conflicts with another goal). Then the owner approves it.
- **Coverage.** Once a goal is ready, every feature plan names the goals it serves (`- Goals: g-…`) and the preconditions it makes true (`- Preconditions: g-…#1`). `goal check` lists any precondition with no feature; each becomes a feature to plan, a spike, or a question. `validate` fails an approved feature that names no ready goal.
- **Readings.** The supervisor records a reading at each retro, from CI, metrics or releases where the measure allows. On track or behind is computed from the readings, the target and the horizon, never stored.
- **Changing a goal** after approval is the owner's (class `goal-change`, owner-only in `autonomy.md`).

## 1. The pipeline

| Stage | Input | Output | Exit criterion |
|---|---|---|---|
| P0 intake | owner direction and the ready goal(s) it serves (§0) | problem statement in the feature plan §0, with its `Goals:` and `Preconditions:` lines | owner confirms the statement (one owner question, asked by the supervisor) |
| P1 research | problem statement, codebase | `project/designs/<slug>.research.md` | every open technical unknown is either answered or listed |
| P2 design | research | `project/designs/<slug>.md` | `project/reviews/<feature>/design-<n>.md` APPROVE; owner answers on any one-way door |
| P3 stories | design | feature plan §1 | every goal in the design maps to at least one story |
| P4 decomposition | design + stories | `project/graph/<id>.json` files + feature plan §2 to §4 | `devteam.mjs validate` passes |
| P5 graph review | the graph | `project/reviews/<feature>/graph-<n>.md` | review APPROVE |
| P6 landing | approved graph | a merged `chore-plan-<feature>` PR | supervisor approves; tickets become schedulable |

Each stage's output is committed on a `plan/<feature>` branch as it is produced, so a crashed planner resumes from files, not memory. The whole feature lands as one PR at P6.

A planner messages the supervisor ([`messages.md`](messages.md)) with a recommendation attached. The supervisor answers, or asks the owner ([`questions.md`](questions.md)) when the decision is the owner's (product intent, one-way doors). Planning does not stall on a question that has a reversible default: it records the default, proceeds, and lets the owner overrule.

## 2. P0 to P1: intake and research

- **Intake** turns the direction into: the problem in two or three sentences, who it is for, what success looks like in observable terms, explicit non-goals, and hard constraints (deadlines, budgets, platforms). If any of these is unknown, ask; don't infer product intent.
- **Research** starts from `project/designs/baseline.md` if the project has one (`bootstrap.md` §5.1) and surveys the existing system before designing: what exists that this touches, what contracts are already in place, what prior decisions in `project/decisions.md` constrain it, and what external facts (library capabilities, API limits) the design depends on. Research cites file paths and links. It does not design.

## 3. P2: the system design

Written from [`templates/design.md`](../templates/design.md). Required sections:

1. Context and goals, non-goals.
2. **Components and boundaries**: each component that changes, and what it owns.
3. **Contracts**: every interface that crosses a component boundary, with its shape and versioning. These become contract tickets.
4. **Data**: new or changed persistence, each with its tier from `code-style.md` §4, and its migration and rollback-safety.
5. **Failure modes**: what happens when each dependency is slow, down or wrong.
6. **Security and PII**: what new data is collected, who can read it, how it is erased.
7. **Alternatives considered**, and why they lost.
8. **One-way doors**: listed explicitly; each becomes an owner question.
9. **Risks and unknowns** that survive research; each becomes a spike ticket or an owner question.

The design says *what* and *why*. It does not contain tasks.

## 4. P3: stories

- Stories live once, in the feature plan §1, numbered `<FEAT>-S1`, `<FEAT>-S2` and so on, where `<FEAT>` is the feature's short uppercase code.
- Actor first. Where a reviewer must check behaviour, use EARS form: *When ⟨trigger⟩, the ⟨system⟩ shall ⟨response⟩.*
- Each story has acceptance criteria that can be checked end to end. These become the done-whens of the story's integration ticket.

## 5. P4: decomposition into the graph

Write one JSON file per ticket in `project/graph/`, following [`schema/ticket.schema.json`](../schema/ticket.schema.json). The feature plan §2 lists the ticket ids in a table; it does not repeat their content.

### Ticket fields

| Field | Meaning |
|---|---|
| `id` | `<component>-<NN>-<slug>`. `NN` is the next free number for that component. Numbers never move and are never reused. |
| `title` | One line a user of the product could read. Becomes the PR title after the id. |
| `feature` | The feature's slug. Chore and spike tickets that belong to no feature plan use the reserved feature `chores`, which needs no plan file. |
| `component` | The component (service, package, app) the ticket changes. One ticket changes one component, except contract tickets. |
| `kind` | `contract`, `build`, `integration`, `chore` or `spike`. |
| `size` | `S` or `M` (limits in rule D1). |
| `risk` | `normal` or `high`. |
| `serves` | Story ids this ticket advances. |
| `depends_on` | Ticket ids that must be **merged** before this ticket starts its build stage. |
| `contracts` | `provides` and `consumes`: contract file paths with version. |
| `touches` | Globs of the files this ticket is allowed to change. |
| `done_when` | List of checks. Each names a command, test or observable result. |
| `one_way_doors` | Plain-language list; empty if none. |
| `superseded_by` | Set only when re-planning replaces this ticket. |

### Decomposition rules

These are normative. `validate` enforces the ones marked **(gate)**; the graph reviewer checks the rest.

- **D1 One ticket, one reviewable PR.** `S` is up to about 400 changed lines of non-test code; `M` up to about 1,000. Anything bigger is split. There is no `L`.
- **D2 Contract first.** Every interface that crosses a component boundary, or that two parallel tickets both depend on, gets its own `kind: contract` ticket. It lands the interface definition, its version, and a fake or stub that consumers can build against. Consumers depend on the **contract ticket**, not on the provider's build ticket. This rule is what creates parallelism; apply it aggressively.
- **D3 Real dependencies only.** `depends_on` means "cannot start building until that is merged". Preference, tidiness or "it would be nice to go first" is not a dependency. **(gate: every referenced id exists; no cycles)**
- **D4 Disjoint footprints.** Two tickets that could run at the same time (neither reaches the other through `depends_on`) must have non-overlapping `touches`. If they overlap, add a real dependency, extract the shared part into a contract or chore ticket, or merge them. **(gate)**
- **D5 Checkable done-whens.** Every done-when names how it is checked: a test name, a command and its expected output, or a measurable observation. "Works correctly" is not a done-when. **(gate: each done-when is non-empty and the list is non-empty)**
- **D6 Full coverage.** Every story is served by at least one ticket; every ticket serves at least one story, except `chore` and `spike` tickets, which state their reason in `notes`. **(gate)**
- **D7 One integration ticket per cross-component story.** Its done-whens are the story's acceptance criteria, checked end to end, and it depends on every ticket that serves the story.
- **D8 Risk is assigned, not guessed.** `risk: high` for anything touching authentication, authorization, payments, PII, migrations, CI or release configuration, or listing a one-way door. **(gate: a ticket with one-way doors must be high risk)**
- **D9 Spikes are timeboxed and produce knowledge.** A spike's output is a document under `project/designs/`, not merged domain code. Tickets that depend on a spike's answer depend on the spike.
- **D10 Vertical over horizontal.** Within a component, prefer a ticket that delivers a thin working slice over one that builds a whole layer nobody can exercise yet.
- **D11 Short critical path.** After decomposition, run `devteam.mjs waves`. If the critical path is long relative to the number of tickets, look for dependencies that a contract ticket could break.

### Plan-ahead

A ticket may enter its spec and plan stages while its dependencies are unmerged; only its **build** stage waits for `depends_on`. The settings' concurrency caps (`max_active_tickets`, `max_active_per_component`) bound how many tickets are in any stage at once.

## 6. P5: graph review

The graph gets an adversarial review like code (`review.md`), using this checklist:

- hidden dependencies: two tickets that will in fact need each other's code;
- footprints that overlap work still in flight outside devteam (the baseline's In flight table);
- footprints that are too broad (`src/**`) to make D4 meaningful;
- tickets over size, or tickets so small their review costs more than their content;
- missing contract tickets at a boundary;
- done-whens that cannot fail;
- stories with no integration ticket;
- risk under-assigned;
- one-way doors not listed in the design or not yet answered by the owner.

## 7. P6: landing

- The supervisor sets the feature plan to `Status: approved` after an APPROVE graph review and a green `validate`, and merges the `chore-plan-<feature>` PR. (`validate` refuses an approved feature plan without approved design and graph reviews.)
- The root roadmap (if the project keeps one) gains one dated paragraph naming the feature and its ticket count.
- From this point, tickets whose dependencies are met appear in `devteam.mjs ready`.

## 8. Re-planning

Triggers: a worker sends a design-change message the supervisor rules needs graph changes; a spike's answer changes the design; a contract changes; the owner changes direction.

- Re-planning is a `chore-replan-<feature>-<n>` PR that edits the graph. It is reviewed like P5.
- Ticket ids are never reused. A replaced ticket keeps its file with `superseded_by` set; `validate` ignores superseded tickets for scheduling.
- A ticket already in flight that the re-plan affects gets a supervisor ruling, recorded in its spec.

## 9. Stage tracking: compute it, don't record it

Every stage of every ticket is computed by `devteam.mjs status` from files, branches and tags. Nobody maintains a status field by hand. Before a ticket merges, its folder exists only on its branch, so `status` reads it from the branch tip (the local `ticket/<id>` branch, which every worktree shares, or `origin/ticket/<id>`).

| Stage | Computed from |
|---|---|
| planned | ticket file exists on `main`, not superseded |
| ready | every `depends_on` ticket is merged |
| spec'd | `project/tickets/<id>/spec.md` with `Status: approved` |
| planned-in-detail | `plan.md` with `Status: approved` |
| building | branch `ticket/<id>` exists, plan approved, every dependency merged |
| in review | a review record for stage `final` exists |
| merged | `ticket/<id>` is reachable from `main` (merge commit) |
| released | `git tag --contains <merge-sha>` matches `v*` (not `-rc`) |

Live facts that git cannot know (phase within a stage, heartbeat, cost) come from `run/` and the log, and are shown alongside, never stored in ticket or plan files.

## 10. The feature plan

`project/features/<feature>.md`, from [`templates/feature-plan.md`](../templates/feature-plan.md). Sections:

0. **Header**: status, the goals it serves and the goal preconditions it makes true (§0), the commit it was read against, the design it implements, owner answers it rests on.
1. **Stories** (P3).
2. **Tickets**: a table of ticket ids, kinds, sizes and stories served. The ticket files hold the detail.
3. **Waves and critical path**: pasted output of `devteam.mjs waves`.
4. **Gaps**: what a pause or descope would leave broken.
5. **Owner questions**: each keeps its answer and date once given.
6. **Release map**: which release each story is expected in.
7. **Rulings log**: dated feature-level rulings.
8. **Supersessions**: what this feature replaces.

**Anti-duplication:** the feature plan holds no ticket prose, no done-whens, no spec or plan content and no live state. The design says what; the feature plan says the breakdown, stories and release map; ticket files own each PR's contract; ticket folders own each PR's spec, plan and evidence.
