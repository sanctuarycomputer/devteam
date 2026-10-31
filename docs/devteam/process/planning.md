# Planning

How an owner direction becomes a validated **work graph**: a set of node files, one per future PR, with explicit dependencies, contracts, file footprints and machine-checkable done-whens. The graph is what the supervisor schedules from and what every worker orients by. If the graph is wrong, everything downstream is wrong, so planning is reviewed as hard as code.

Planning is run by the supervisor, or by a planner session the supervisor spawns. It sits above [`item-lifecycle.md`](item-lifecycle.md) (which runs one node) and feeds [`supervisor.md`](supervisor.md) (which runs many).

## 1. The pipeline

| Stage | Input | Output | Exit criterion |
|---|---|---|---|
| P0 intake | owner direction | problem statement in the column plan §0 | owner confirms the statement (one question) |
| P1 research | problem statement, codebase | `project/designs/<slug>.research.md` | every open technical unknown is either answered or listed |
| P2 design | research | `project/designs/<slug>.md` | design review APPROVE (`review.md`); owner answers on any one-way door |
| P3 stories | design | column plan §1 | every goal in the design maps to at least one story |
| P4 decomposition | design + stories | `project/graph/<id>.json` files + column plan §2 to §4 | `devteam.mjs validate` passes |
| P5 graph review | the graph | review record `graph-1.md` | review APPROVE |
| P6 landing | approved graph | a merged `chore-plan-<column>` PR | supervisor approves; nodes become schedulable |

Each stage's output is committed on a `plan/<column>` branch as it is produced, so a crashed planner resumes from files, not memory. The whole column lands as one PR at P6.

Questions to the owner go through the inbox ([`questions.md`](questions.md)) with a recommendation attached. Planning does not stall on a question that has a reversible default: it records the default, proceeds, and lets the owner overrule.

## 2. P0 to P1: intake and research

- **Intake** turns the direction into: the problem in two or three sentences, who it is for, what success looks like in observable terms, explicit non-goals, and hard constraints (deadlines, budgets, platforms). If any of these is unknown, ask; don't infer product intent.
- **Research** surveys the existing system before designing: what exists that this touches, what contracts are already in place, what prior decisions in `project/decisions.md` constrain it, and what external facts (library capabilities, API limits) the design depends on. Research cites file paths and links. It does not design.

## 3. P2: the system design

Written from [`templates/design.md`](../templates/design.md). Required sections:

1. Context and goals, non-goals.
2. **Components and boundaries**: each component that changes, and what it owns.
3. **Contracts**: every interface that crosses a component boundary, with its shape and versioning. These become contract nodes.
4. **Data**: new or changed persistence, each with its tier from `code-style.md` §4, and its migration and rollback-safety.
5. **Failure modes**: what happens when each dependency is slow, down or wrong.
6. **Security and PII**: what new data is collected, who can read it, how it is erased.
7. **Alternatives considered**, and why they lost.
8. **One-way doors**: listed explicitly; each becomes an owner question.
9. **Risks and unknowns** that survive research; each becomes a spike node or an owner question.

The design says *what* and *why*. It does not contain tasks.

## 4. P3: stories

- Stories live once, in the column plan §1, numbered `<COL>-S1`, `<COL>-S2` and so on, where `<COL>` is the column's short uppercase code.
- Actor first. Where a reviewer must check behaviour, use EARS form: *When ⟨trigger⟩, the ⟨system⟩ shall ⟨response⟩.*
- Each story has acceptance criteria that can be checked end to end. These become the done-whens of the story's integration node.

## 5. P4: decomposition into the graph

Write one JSON file per node in `project/graph/`, following [`schema/node.schema.json`](../schema/node.schema.json). The column plan §2 lists the node ids in a table; it does not repeat their content.

### Node fields

| Field | Meaning |
|---|---|
| `id` | `<component>-<NN>-<slug>`. `NN` is the next free number for that component. Numbers never move and are never reused. |
| `title` | One line a user of the product could read. Becomes the PR title after the id. |
| `column` | The column's slug. |
| `component` | The component (service, package, app) the node changes. One node changes one component, except contract nodes. |
| `kind` | `contract`, `build`, `integration`, `chore` or `spike`. |
| `size` | `S` or `M` (limits in rule D1). |
| `risk` | `normal` or `high`. |
| `serves` | Story ids this node advances. |
| `depends_on` | Node ids that must be **merged** before this node starts its build stage. |
| `contracts` | `provides` and `consumes`: contract file paths with version. |
| `touches` | Globs of the files this node is allowed to change. |
| `done_when` | List of checks. Each names a command, test or observable result. |
| `one_way_doors` | Plain-language list; empty if none. |
| `superseded_by` | Set only when re-planning replaces this node. |

### Decomposition rules

These are normative. `validate` enforces the ones marked **(gate)**; the graph reviewer checks the rest.

- **D1 One node, one reviewable PR.** `S` is up to about 400 changed lines of non-test code; `M` up to about 1,000. Anything bigger is split. There is no `L`.
- **D2 Contract first.** Every interface that crosses a component boundary, or that two parallel nodes both depend on, gets its own `kind: contract` node. It lands the interface definition, its version, and a fake or stub that consumers can build against. Consumers depend on the **contract node**, not on the provider's build node. This rule is what creates parallelism; apply it aggressively.
- **D3 Real dependencies only.** `depends_on` means "cannot start building until that is merged". Preference, tidiness or "it would be nice to go first" is not a dependency. **(gate: every referenced id exists; no cycles)**
- **D4 Disjoint footprints.** Two nodes that could run at the same time (neither reaches the other through `depends_on`) must have non-overlapping `touches`. If they overlap, add a real dependency, extract the shared part into a contract or chore node, or merge them. **(gate)**
- **D5 Checkable done-whens.** Every done-when names how it is checked: a test name, a command and its expected output, or a measurable observation. "Works correctly" is not a done-when. **(gate: each done-when is non-empty and the list is non-empty)**
- **D6 Full coverage.** Every story is served by at least one node; every node serves at least one story, except `chore` and `spike` nodes, which state their reason in `notes`. **(gate)**
- **D7 One integration node per cross-component story.** Its done-whens are the story's acceptance criteria, checked end to end, and it depends on every node that serves the story.
- **D8 Risk is assigned, not guessed.** `risk: high` for anything touching authentication, authorization, payments, PII, migrations, CI or release configuration, or listing a one-way door. **(gate: a node with one-way doors must be high risk)**
- **D9 Spikes are timeboxed and produce knowledge.** A spike's output is a document under `project/designs/`, not merged domain code. Nodes that depend on a spike's answer depend on the spike.
- **D10 Vertical over horizontal.** Within a component, prefer a node that delivers a thin working slice over one that builds a whole layer nobody can exercise yet.
- **D11 Short critical path.** After decomposition, run `devteam.mjs waves`. If the critical path is long relative to the number of nodes, look for dependencies that a contract node could break.

### Spec-ahead

A node may enter its spec and plan stages while its dependencies are unmerged; only its **build** stage waits for `depends_on`. The binding's concurrency caps (`max_active_nodes`, `max_active_per_component`) bound how many nodes are in any stage at once.

## 6. P5: graph review

The graph gets an adversarial review like code (`review.md`), using this checklist:

- hidden dependencies: two nodes that will in fact need each other's code;
- footprints that are too broad (`src/**`) to make D4 meaningful;
- nodes over size, or nodes so small their review costs more than their content;
- missing contract nodes at a boundary;
- done-whens that cannot fail;
- stories with no integration node;
- risk under-assigned;
- one-way doors not listed in the design or not yet answered by the owner.

## 7. P6: landing

- The supervisor approves the graph after an APPROVE review and a green `validate`, and merges the `chore-plan-<column>` PR.
- The root roadmap (if the project keeps one) gains one dated paragraph naming the column and its node count.
- From this point, nodes whose dependencies are met appear in `devteam.mjs ready`.

## 8. Re-planning

Triggers: a worker raises a design-change question the supervisor rules needs graph changes; a spike's answer changes the design; a contract changes; the owner changes direction.

- Re-planning is a `chore-replan-<column>-<n>` PR that edits the graph. It is reviewed like P5.
- Node ids are never reused. A replaced node keeps its file with `superseded_by` set; `validate` ignores superseded nodes for scheduling.
- A node already in flight that the re-plan affects gets a supervisor ruling, recorded in its spec.

## 9. Stage tracking: derive it, don't record it

Every stage of every node is computed by `devteam.mjs status` from files, branches, PRs and tags. Nobody maintains a status field by hand.

| Stage | Derived from |
|---|---|
| planned | node file exists on `main`, not superseded |
| ready | every `depends_on` node is merged |
| spec'd | `project/nodes/<id>/spec.md` with `Status: approved` |
| planned-in-detail | `plan.md` with `Status: approved` |
| building | branch `node/<id>` exists, not merged |
| in review | a review record for stage `final` exists |
| merged | `node/<id>` is reachable from `main` (merge commit) |
| released | `git tag --contains <merge-sha>` matches `v*` (not `-rc`) |

Live facts that git cannot know (phase within a stage, heartbeat, cost) come from `run/` and are shown alongside, never stored in tracked files.

## 10. The column plan

`project/columns/<column>.md`, from [`templates/column-plan.md`](../templates/column-plan.md). Sections:

0. **Header**: status, the commit it was read against, the design it implements, owner answers it rests on.
1. **Stories** (P3).
2. **Nodes**: a table of node ids, kinds, sizes and stories served. The node files hold the detail.
3. **Waves and critical path**: pasted output of `devteam.mjs waves`.
4. **Gaps**: what a pause or descope would leave broken.
5. **Owner questions**: each keeps its answer and date once given.
6. **Release map**: which release each story is expected in.
7. **Rulings log**: dated column-level rulings.
8. **Supersessions**: what this column replaces.

**Anti-duplication:** the column plan holds no node prose, no done-whens, no spec or plan content and no live state. The design says what; the column plan says the breakdown, stories and release map; node files own each PR's contract; node folders own each PR's spec, plan and evidence.
