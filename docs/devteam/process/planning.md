# Planning

How a goal becomes a design, the design a roadmap, and the roadmap a graph of tickets the supervisor can schedule. Planning is reviewed as hard as code: if the graph is wrong, everything after it is wrong.

```
goal (owner) → design, the spine (per goal) → milestones → features, each with stories and releases (the roadmap) → tickets (the graph) → workers
```

A feature is what other teams call an epic: stories, many PRs, one reviewed plan. There is no separate epic level.

The supervisor plans itself or makes a planner (`devteam.mjs planner <feature>`), a session in its own worktree on branch `plan/<feature>`. Everything a planner produces lands through one reviewed PR: the design, the architecture update, the review records, and `project/log/plan-<feature>.jsonl` holding the feature and its tickets. Nothing is schedulable until that PR merges.

When its goal is parked, let go, or the fleet is parked (`supervisor.md` §12), a planner does what `worker.md` §9 says, recording its handoff on `plan/<feature>` with `devteam.mjs handoff`; `phase parked` is the one phase a planner logs.

## 1. Goals

The owner states the goals, in whatever words. The supervisor drafts them (`devteam.mjs goal add --title … --outcome …`), interviews until each is fully defined, has its design written and reviewed (§2), and then asks the owner to approve the goal **on its design**. Only the owner decides. Keep three to five active.

**Goals are meant to be ambitious.** A goal is the unit the fleet stays aligned on across many loops and PRs: weeks or months of work, many features, many workers. Never split a goal to make it fit one loop; a goal one loop could meet is a ticket or a feature. What keeps a large goal workable is its spine (§2), its milestones, and planning one milestone at a time.

A goal moves through (its toggle, below, is separate): **defining** (gaps, `goal-definition` questions) → **designing** (fully defined; the spine is written and reviewed and its milestones are on the goal) → **awaiting approval** (a `goal-approval` question in the inbox, the design linked) → **ready** (approved; the current milestone's features and tickets are planned from the design) → **met**, or **abandoned** if the owner lets it go.

A goal is **fully defined** when it has: an outcome (what is true for users or the business when it's met), a measure with a numeric target, unit, direction and source (below), at least one non-goal, the preconditions that must hold for the outcome, a priority distinct from the other goals, and a baseline reading (`goal reading <id> --run`; an owner-read goal starts at 0). `devteam.mjs goal check` lists what's missing.

**The measure is what the fleet can move and read.** A goal is met in the dev cycle: by merging PRs, read without waiting on anyone outside it. The business result the goal is for (fewer manual fixes a month, a backlog another team works through) stays in the outcome, as the reason, and never gates met. Test each measure: can the fleet move this number by merging PRs, and read it without a human outside the dev cycle doing their job? If the number depends on another team's work, or on production time passing, the measure is an owner question instead. Each measure names its **source**:

- **repo**: `measure.check` is a command whose last line of output is the number, and the kit runs it on a checkout of main (`goal reading <id> --run`), recording main's sha. Nobody types the number. Example: the model files over 300 lines, counted from the code. In a project with sibling repos, `measure.link` names the repo whose main it runs on (`goal set <id> --link <repo>`; default home), seeded from that repo's settings.
- **prod**: `measure.check` is a read-only command against production, run from the main checkout (`goal reading <id> --run`), recording what it printed. Example: a read-only query counting the records the new feature handles. Read-only is the owner's to judge when they approve the goal; the command never changes data. A check is the supervisor's command, so it always runs as the supervisor, even when `goal status <id> met` runs it from the owner's terminal or the dashboard: owner commands refuse it, and anything it writes is the supervisor's.
- **owner**: `measure.question` is a yes/no question, such as "Have you validated invoice sync on a drifted invoice in production?". Its target is 1, its unit `attested`, and it starts at 0. When the work is merged, the supervisor asks it (`ask --class goal-met --goal <id> --question "…" --recommendation yes`; `goal-met` is owner-only, never defaulted and never answered in chat), and records the owner's yes with `goal reading <id> --approved <qid>`, one reading per answer. The owner can also record it directly (`goal reading <id> --value 1 --owner`).

Readings that don't match the source don't count, however they were written: a repo reading without a commit on main, a prod reading not marked as its check's (it keeps what the check printed, for the owner to compare), an owner goal's reading without the owner's yes. What gates met is checked where it can be: a repo goal's check runs again on main, and an owner goal needs the owner's own answer; a prod reading stays the supervisor's report of a run. `goal status <id> met` reads a repo goal's check again on main and an owner goal's yes, and refuses when they don't say met (`--force` is the owner's override). A running goal with no source keeps its readings as before; `goal check` lists the missing source, and the supervisor asks the owner for one with a `goal-change` question.

**Dates come from the owner, or from the forecast.** A horizon on a goal, or a `by` on a milestone, is set only when the owner states a real deadline (a launch, a contract, an event); then it is theirs. The supervisor never proposes one: agents are bad at guessing durations, and a fleet's pace (hours to days per ticket) is not a person's. When it will happen is what `goal forecast` computes from the measured rate; ask for no date in a goal-definition question. A date that turns out not to be a real deadline is cleared: `--horizon none`, or `"by": null` in a milestone (on a goal past draft, through a goal-change question with that `--change`).

**Milestones.** The design orders the outcome into milestones, and the supervisor records them on the goal (`goal set <id> --milestones '[…]'`) before asking for approval (on a goal already past draft, through an answered goal-change question that carries the exact change: `ask --class goal-change --goal <id> --change '{"milestones": […]}' --recommendation …`, then `goal set <id> --approved <qid>`, which applies that change and nothing else). Each milestone is a usable slice, not a layer: a `title`, a `target` on the goal's measure (moving toward the goal's target; the last one is the goal's target), the `preconditions` it makes true (each precondition in exactly one milestone), a `by` date only if the owner gave one (within the horizon, if any), and `tickets`, a rough count of the PRs it takes. A goal one feature can meet has one milestone. `goal check` lists milestone gaps; `ask --kind goal-approval` and `goal decide … approve` refuse while there are any. Milestones are referred to as `<goal-id>@<n>`.

**Planning rolls a milestone at a time.** The current milestone is the first one the latest reading hasn't reached. Only its preconditions need features before work starts; a later milestone's are planned once it becomes current, with what the earlier ones taught (accepted knowledge, the retro, the measured rate). `goal check` lists them as later, not as gaps; `validate` warns when a feature serves only a later milestone, which is right only when the current milestone's critical path needs it. When a milestone is met, take a reading, re-read the spine against what was built (anything that drifted is a design change or an owner question), and plan the next milestone's features.

**The forecast.** `devteam.mjs goal forecast <id>` computes, per milestone, the work left (points of planned tickets, or the milestone's `tickets` estimate where nothing is planned), the waves to reach it at the current worker slots, and an ETA where the fleet has a measured rate, flagging a milestone past its date and a goal past its horizon. A goal-approval question carries it in its context automatically. When the forecast misses the horizon, the approval says so and recommends one of: move the horizon, add worker slots, cut scope into non-goals, or reorder the milestones. Splitting the goal is not one of them. `goal show` and the roadmap carry the forecast; on track or behind is measured against the line through each dated milestone, so a slip shows at the first milestone, not at the horizon.

**Plan goals in parallel.** Every goal that needs planning gets a planner at once (`max_active_planners` caps it only if the project sets one). The one reason to hold a goal back is that its design depends on another goal's design (the same boundary, contract or data is being decided there): record it with `goal set <id> --plan-after <g-id> --reason "…"`; it lapses when that goal is approved, and the owner sees it on the goal.

**The readiness interview.** While a goal has gaps, or any ambiguity in the supervisor's judgment (an undefined term, two readings of the measure, a conflict with another goal), the supervisor asks one `goal-definition` question per goal listing every gap as a form, records the answers (`goal set`), and repeats until `goal check` is clean. Changing an approved goal is the owner's (`goal-change`, owner-only): the supervisor asks a `goal-change` question with `--goal <id>` and the exact change as `--change '{…}'` (the owner's card shows "Approving sets: …"), and once the owner answers with the recommendation, applies it with `goal set <id> --approved <qid>`: that change exactly, once.

**Settle the design's decisions first.** Every decision the design leaves to the owner (scope, who may see or change what, what is out, any choice between approaches the owner should make) is its own inbox question, asked while designing, with `--goal <g-id>`, the design linked, `--choices` and a recommendation. A decision that touches authentication, authorization, payments, PII or anything else hard to undo is a `one-way-door` question. Record each answer in the design's **Owner decisions** section with its question id. Never bundle open decisions into the approval: `ask --kind goal-approval` refuses while any question with that `--goal` is still open.

**Approval, on the design.** Once the design is reviewed and its decisions are settled, ask: `ask --kind goal-approval --goal <g-id> --question "Approve <goal> built this way?" --context "<the approach in three sentences: what gets built, what's left out, the milestones>" --links '[{"title":"The design","path":"docs/devteam/project/designs/<slug>.md","ref":"plan/<feature>"}]'`. The owner answers on the dashboard (or `goal decide <g-id> approve|refine|let-go --notes "…"`):
- **Approve.** The goal is ready; plan the current milestone's features and tickets from the design, taking the owner's notes into account.
- **Refine.** The notes say what to change. Rework the design with them (record how each note was addressed in the design), have it reviewed again, and ask a new `goal-approval` question. The goal stays a draft until then.
- **Let go.** The goal is abandoned; stop any planning for it and say what was dropped.

`goal approve` without a `goal-approval` question refuses: a goal is approved on its approach, not before one exists.

**Holds: run, drain, park, let go.** Every goal has a toggle on the dashboard (or `goal hold <id> run|drain|park [--reason "…"]`; the owner adds `--owner` in a terminal). A hold is separate from the goal's status, so a draft and a ready goal can both be held, and the goal keeps its step.
- **Run**: normal.
- **Drain**: nothing new starts for it (no planner, no worker that hasn't run yet, no idle-planning or idle-capacity finding); work already running carries on, merges, and a parked session may resume to finish. It shows **draining**, then **drained** once nothing of it is running.
- **Park**: its sessions get a park ruling (commit WIP, push, record a handoff, `phase parked`, stop; `worker.md` §9); nothing starts; its ticket merges wait (`merge` refuses without `--force`, logged). Its track and forecast stand still (no ETA, not "behind"), and it leaves the queue other goals' dates are computed from. Its questions stay open, labelled, and don't count as the owner falling behind.
- **Let go** (`goal decide <id> let-go`): the goal is abandoned; its sessions park and its open questions leave the inbox. It is reversible: `goal decide <id> restore` brings it back with the status it had, parked, and its questions return.

A plan PR still lands while its goal is held: landing a plan starts nothing. Work belongs to goals: a ticket to its feature's goals (when it serves several, it runs under the least restrictive of them, leaving out goals already met), a planner to the goal it plans (`planner <feature> --goal <g-id>` until its feature line or a question names one), a chore to **Upkeep** (§7). The owner sets and releases any hold. The supervisor may drain a running goal, with a reason (an act of class `goal-hold`, which the owner can correct), and release only a drain it set; it parks a single goal only by asking the owner. A whole-fleet hold is a shorthand for every goal at once (`supervisor.md` §12).

**Readings.** At each retro the supervisor takes a reading the way the measure's source says: `goal reading <id> --run` for repo and prod, the owner's goal-met answer for owner (asked once the work it waits on is merged, not at every retro). On track or behind is computed from the readings, the target and the horizon.

## 2. The design

Designs come at two levels.

**The goal's design is the spine.** One per goal at `project/designs/<goal-slug>.md` (the slug `goal check` prints), written once the goal is fully defined and before the owner approves it; until the plan PR lands, link it from its plan branch. It is what keeps PR 40 and PR 400 of one goal coherent: the boundaries, the contracts, the data, the one-way doors and the milestones are decided here once, and every feature builds inside them. It stays at that level; the detail of a feature is written when that feature is planned. Write it with superpowers' **brainstorming**, saving there instead of its default location, opening with a `## TL;DR` (`quality.md` §6); boundaries, contracts and sequences are clearest as Mermaid diagrams. It must cover what brainstorming already asks for (intent and why; goals, non-goals, anti-goals; constraints; the approaches considered and the one chosen; what's decided and what's left to the builder) plus:

- the reverse chain: for each precondition of the goal, why it must hold, what says it doesn't yet, and which feature will make it hold;
- components and boundaries, and every contract that crosses one (each becomes a contract ticket). Draw component lines in `architecture.md` §1 and in `settings.components`: every tracked file in exactly one line; generated and vendored folders belong to a line like anything else;
- data: new or changed persistence with its tier (`code-style.md` §4), migrations and rollback safety;
- failure modes, security and PII;
- one-way doors, each an owner question before any plan is approved (one answered here, with `--goal`, can approve a ticket's plan when its plan review says the plan stays inside it; constitution.md §4);
- **Owner decisions**: each decision the owner made for this design, with the question id that settled it (§1); none may be left open when approval is asked;
- risks and unknowns that survive, each a spike ticket or a question;
- the milestones, in order, each with its target, the preconditions it makes true, its date if any and a size in tickets (recorded on the goal, §1);
- what changes in `project/designs/architecture.md`, applied to that file in the same PR, with a row in its Changed by table.

**A feature's design** is written when the feature is planned, at `project/designs/<feature>.md`, named in the feature's `design` field, and reviewed like any design. It links the spine by path (`validate` checks the citation) and works inside it: a feature design that needs to change a boundary, a contract or a decision the spine made is a design change (`approve-design-change`), or an owner question for a one-way door, never a quiet divergence. A feature small enough to need nothing beyond the spine may name the spine as its design.

The design is shaped by the constitution and the code style: it chooses the option that keeps a rollback, that makes a gate possible, that fits the doctrine's structure. Research starts from `architecture.md` and the accepted knowledge (`devteam.mjs knowledge --for <feature>`), and cites file paths. The design is reviewed (`project/reviews/<goal-slug>/design-1.md`, `quality.md` §3) before any feature is written from it.

## 3. The roadmap: features, stories, releases

A feature is one `feature` line in the log, written by the planner in its worktree:

```
devteam.mjs feature add sign-in --json '{
  "title": "Sign-in",
  "goals": ["g-20261101-093000123-supervisor"],
  "preconditions": ["g-20261101-093000123-supervisor#1", "g-20261101-093000123-supervisor#3"],
  "design": "project/designs/users-sign-in-securely.md",
  "stories": [
    { "id": "SIGNIN-S1", "text": "When a user submits valid credentials, the system signs them in.", "release": "v0.1.0" },
    { "id": "SIGNIN-S2", "text": "When a user forgets their password, they can reset it by email.", "release": "v0.2.0" }
  ]
}'
```

- **Stories** are user-facing outcomes, each checked end to end by an integration ticket (D7). Ids are `<FEAT>-S<n>`.
- **Releases** are the tag each story is expected in. The roadmap and the dashboard read them; the release notes record where a story landed.
- **Preconditions** are `<goal-id>#<n>`, the goal's preconditions this feature makes true. `goal check` lists any precondition no feature covers; each becomes a feature, a spike or a question.
- The reserved feature `chores` holds `chore` and `spike` tickets that belong to no plan and needs no feature line.

`devteam.mjs roadmap` renders all of it: goals by priority, each with unplanned preconditions, its features (points done, stories done, waves left, releases, questions they wait on) and an estimated week, from goal-priority order at the current rate, never sooner than remaining waves times the median cycle time. It is computed; nobody maintains it.

## 4. The graph: tickets

One `ticket` line per future PR:

```
devteam.mjs ticket add api-07-session-tokens --json '{
  "title": "Session tokens expire after 12 hours",
  "feature": "sign-in", "component": "api", "kind": "build", "size": "S", "risk": "high",
  "serves": ["SIGNIN-S1"], "depends_on": ["api-01-session-contract"],
  "contracts": { "consumes": ["docs/contracts/session.md@1.0"] },
  "touches": ["api/src/domain/session/**", "api/test/session/**"],
  "done_when": ["session_expiry_test passes in CI", "a token older than 12h is refused with 401 (integration test)"],
  "one_way_doors": [],
  "notes": ""
}'
```

| Field | Meaning |
|---|---|
| id | `<component>-<NN>-<slug>`; a planner takes `NN` in order from the block of numbers `planner <feature>` reserved for its feature (it is in the prompt; `prompt planner <feature>` shows it again), because planners run in parallel and can't see each other's numbers; ask the supervisor for another block rather than going past it. Without a planner, `NN` is the next free number. `validate` on the plan branch warns about a number outside the block, and `merge --plan` refuses an id already on main. Numbers never move or get reused |
| title | one line a user could read; it becomes the PR title after the id |
| feature, component | the feature slug; the one component this ticket changes (a contract or integration ticket may name more in `touches_components`) |
| kind | `contract`, `build`, `integration`, `chore`, `spike` |
| size | `S` (up to about 400 changed non-test lines) or `M` (about 1,000). There is no L. |
| risk | `normal` or `high` |
| serves, depends_on | story ids it advances; ticket ids that must be **merged** before its build starts |
| contracts | `provides` and `consumes`, contract paths with versions |
| touches | globs of the files it may change |
| touches_components | on a contract or integration ticket, other components in the same repo its touches may fall in; the only way to touch a `shared` component besides that component's own tickets |
| links | registry links its worker needs; a feature's `links` reach every one of its tickets |
| done_when | checks, each naming a test, a command and its output, or a measurable observation |
| one_way_doors, superseded_by, notes | as named; `notes` says why a chore or spike serves no story |

**Rules.** `validate` enforces the ones marked (gate); the graph reviewer checks the rest.

- **D1 One ticket, one reviewable PR.** Split anything over M.
- **D2 Contract first.** Every interface that crosses a component boundary, or that two parallel tickets both depend on, gets a `contract` ticket that lands the definition, its version and a fake. Consumers depend on the contract ticket, not the provider's build. This is what creates parallelism; apply it hard. A contract may span two lines in one repo with `touches_components`. **Across repos**, a contract is a `contract` ticket in the provider's repo (the definition, its version, a fake or recorded fixtures), plus in each consumer repo a ticket that `depends_on` it and vendors the fake. There are no multi-repo tickets.
- **D3 Real dependencies only.** `depends_on` means "cannot build until merged". (gate: every id exists, no cycles)
- **D4 Disjoint footprints.** Tickets that can run at the same time have non-overlapping `touches` (footprints overlap only within a repo: the same path in two repos is two files); otherwise add a real dependency, extract the shared part, or merge them. (gate) A ticket's merge gate fails only for its own graph problems: an overlap between two other tickets, or another ticket's error (a D3 dependency on a plan that reached main after the branch did), comes from the live graph, not the branch, so there it's a warning, and the supervisor fixes it in the graph (its own `validate` still fails on it).
- **D5 Checkable done-whens.** "Works correctly" is not one. (gate: non-empty, each at least ten characters)
- **D6 Full coverage.** Every story is served; every ticket serves a story, except chores and spikes, which say why in `notes`. (gate)
- **D7 One integration ticket per story that spans components**, whose done-whens are the story's acceptance checked end to end, depending on every ticket that serves it. A story served in more than one repo is split per repo, with the end-to-end check in the ticket that lands last (it depends on all the others); `validate --strict` errors otherwise.
- **D8 Risk is assigned, not guessed.** `high` for auth, authorization, payments, PII, migrations, CI or release config, or any one-way door. (gate: one-way doors force high)
- **D9 Spikes are timeboxed and produce a document** under `project/designs/`, not merged domain code.
- **D10 Vertical over horizontal.** Prefer a thin working slice to a whole layer nobody can exercise.
- **D11 Short critical path.** Run `devteam.mjs waves`; if the path is long relative to the ticket count, find a dependency a contract ticket could break.

A ticket may spec and plan while its dependencies are unmerged (plan-ahead); only its build waits.

## 5. Review and landing

1. `devteam.mjs validate` passes in the planner's worktree (reviews still missing show as warnings).
2. A non-author reviews the graph (`project/reviews/<feature>/graph-1.md`): consistency with the goal's spine (its boundaries, contracts, data and decisions) and with the milestone the feature serves, hidden dependencies, footprints that overlap work in flight (the architecture doc's In flight table), footprints too broad for D4 to mean anything, tickets over size, missing contract tickets, done-whens that can't fail, stories with no integration ticket, risk under-assigned, one-way doors not yet answered, `architecture.md` not updated. The verdict names the commit that holds the ticket lines; any later commit that changes anything but review records voids it (`validate --strict` checks this).
3. Commit everything and open the PR titled `plan-<feature>: <summary>`; message the supervisor (`devteam.mjs send supervisor "<feature> graph review passed" --kind review-request`).
4. The supervisor reads the design and the graph, then `devteam.mjs merge --plan <feature>`, which checks `validate --strict` at the head, both reviews holding, and that the PR touches no log file but its own. The merge is the approval; the tickets appear in `devteam.mjs ready`.

## 6. Re-planning

When a design change, a failed spike or a correction changes the graph: the supervisor sets the affected tickets (`ticket set <id> --json '{"superseded_by": …}'`, new `depends_on`, `touches`) and adds replacements; each such command logs its act (`replan-within-feature`, `add-ticket`); a ticket already in flight gets a ruling recorded in its spec. Ids are never reused. A re-plan big enough to need review goes through a new `plan/<feature>-<n>` branch like a first plan. Once the supervisor has set a field on a ticket, planners can no longer change that field; later re-plans of it are the supervisor's.

## 7. The Baseline goal, Upkeep, and existing codebases

**Baseline.** Bootstrap proposes the first goal, and the owner opts in through the regular flow (definition, design, approval): **Baseline**, the repo meeting the kit's floor. Its outcome: every gate in `quality.md` §2 and every Law in `code-style.md` enforced on main. Its measure: the floor gaps, the gates and Laws not yet enforced, counted from `gate --all` and the settings, direction down, target 0. Its preconditions group the gaps (format and lint, types, tests in CI, coverage, dead code and duplication, secrets and lockfile, an encrypted secret store); its milestones order them; its features are the floor tickets, each saying in `notes` which gate it turns on. Gates that fail on existing code start in ratchet mode. The owner may decline it, or hold it, like any goal. Its preconditions also include **the registry is complete**, marked on the goal by number (`goal add|set --registry-precondition <n>`, the field `registry_precondition`; `none` clears it, and past draft it changes only through a `goal-change` like any goal field): (a) the repo-checkable floor gaps, counted with the gates (`components check --count`: unowned, owned twice, a component whose link is not a repo link, a glob that matches nothing); (b) the owner's yes to "Does the registry list every repo, design file and doc this project depends on?". Only the owner knows what is missing, so (b) is attested like an owner-read measure (§1): the owner's own yes, from the dashboard or their terminal, never a count. Ask it in its own owner-only class: `ask --class registry-attest --goal <Baseline> --question "Does the registry list every repo, design file and doc this project depends on?" --recommendation yes` (no `--default`: `ask` refuses one, and `answer --from-chat` refuses the class, as for `goal-met`). A `goal-readiness` decision or act names exactly one goal, by its id, in `--refs`; anything else (no refs, an id that is not a goal, two goals) is refused. `act --class goal-readiness` (alone or carrying out a decision) refuses for a goal with a `registry_precondition` until the owner has answered such a question about that goal with yes; the check reads the field, not the precondition's wording, so a precondition phrased this way without the marker is not held by it. The wording still raises a flag: on a goal with no `registry_precondition`, a precondition that says both "registry" and "complete" (any case) is a definition gap in `goal check`, so the goal can't be approved until the field is set (`goal set <g> --registry-precondition <n>`). The flag never satisfies anything. The goal's card on the dashboard and its goal-approval question's context show the field and where the attestation stands (not asked, open, answered). A no (with what is missing) means fix the registry and ask again.

**Upkeep.** Work that serves no goal of the owner's belongs to the built-in **Upkeep** goal: the reserved `chores` feature (chores, spikes, CI fixes), and the supervisor's upkeep (retros, research, kit syncs, the improvement loop's trials and proposals, trust and lesson suggestions). It has no measure, design, milestones or place in the forecast, can't be let go, and has the same toggle as any goal (`goal hold upkeep …`); its line is made the first time it is held. While it is drained or parked, no chore ticket's worker, upkeep chore (`chore start`) or improvement act starts. Two things never stop: observing (metrics, findings, readings), so a held fleet still notices what it should; and keeping the record (`log-sync`, `merge --chore log`, posted secrets).

Adopting an existing codebase: write `architecture.md` from the code; list work already in flight in its table and keep new footprints off those files; start `max_active_tickets` at 2 or 3, since old hotspots make footprints overlap, and raise it when `waves` shows real width; plan the first feature with contract tickets that carve stable interfaces around the hotspots; where the repo has its own process docs, map each rule to the devteam doc that covers it, link where they agree, ask the owner where they conflict.
