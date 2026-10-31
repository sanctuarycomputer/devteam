# Bootstrap

How devteam gets materialized into a project repo, and how the first session gets from "nothing" to a running fleet. You (the agent) do every step; you ask the owner only where marked. Bootstrapping into a repo that already has code, contributors and a history is the common case; §5 covers what changes.

## 1. Materialize

1. Copy `docs/devteam/` from the latest upstream release (the newest `vX.Y.Z` tag with a GitHub Release, not `main`) into the project at `docs/devteam/`, **except** `project/` and `run/`.
2. Make sure `docs/devteam/.gitignore` contains `run/`.
3. Create `docs/devteam/project/` from the templates:
   - `settings.md` from [`templates/settings.md`](../templates/settings.md)
   - `decisions.md` from [`templates/decisions.md`](../templates/decisions.md)
   - `upstream-log.md` from [`templates/upstream-log.md`](../templates/upstream-log.md), with a first row recording the release tag you copied (this is the base for `upstream-sync.md`)
   - empty `designs/`, `features/`, `graph/`, `tickets/`, `reviews/` folders (each with a `.gitkeep`)
4. Create or update the repo root `AGENTS.md` from [`templates/AGENTS.md`](../templates/AGENTS.md). If an `AGENTS.md` exists, append the devteam section rather than replacing it. If a `CLAUDE.md` exists and is not already a symlink, add a line to it pointing at `AGENTS.md`; otherwise create `CLAUDE.md` as a symlink to `AGENTS.md`.
5. Add `.worktrees/` to the root `.gitignore`.
6. Add the CI jobs from [`templates/github/devteam.yml`](../templates/github/devteam.yml) (adapt to the project's CI if it is not GitHub Actions), and list `devteam-validate` and `merge-word` as required checks in the intended branch rules (`ci.md` §3).
7. Where the agent CLI supports deny rules, configure workers to be denied `worker_denied_commands` in the settings (for example in the agent's project settings file). Record what was configured in the settings.

Commit all of this as one `chore-devteam-bootstrap` PR.

## 2. Fill the settings

Survey the repo first (languages, frameworks, components, existing CI, existing lint config, deploy targets). Fill every field you can infer. Then **ask the owner** only what you could not infer, as one batch of questions with your recommended answers:

- components and their stacks;
- persistence tier per domain (`code-style.md` §4) for any domain that already exists;
- one-way doors specific to this project;
- release rings, release actors, and whether `-rc` tags may be automated (`release.md` §3);
- `agent_command` and `resume_command`; `max_active_tickets`;
- shared resources that need slots, if any;
- how the owner wants to be notified.

Record each answer in the settings with its date. (During bootstrap there is no supervisor yet, so you ask the owner directly, in the conversation or in one batch of question files with `--from supervisor`.)

## 3. Turn on the day-one gates

For each component's stack, add the root gates from `quality-gates.md` §2 that are missing, using the tools in §3 of that file unless the settings choose others. Autofix first. List each in the gate table in the settings with the CI step that runs it.

Do not fix the whole codebase in this PR. If a gate fails on existing code, turn it on in **ratchet** mode (§5.3) and add one ticket per component to bring it to green: a graph file with `"kind": "chore"`, `"feature": "chores"` (the reserved feature that needs no plan), empty `serves`, and `notes` saying which gate it clears. Record the debt in the Known debt section of the settings. `validate` must pass on the bootstrap PR.

## 4. Start

1. Start the tmux session named in the settings with the supervisor in window 0: `tmux new-session -s devteam -n supervisor`, then launch the agent with the prompt in [`templates/supervisor-prompt.md`](../templates/supervisor-prompt.md).
2. Start the dashboard if the project uses one (`settings.md` names its command).
3. The supervisor reads [`supervisor.md`](supervisor.md) and, with no graph yet, begins [`planning.md`](planning.md) at P0 by asking the owner what to build.

## 5. Adopting into an existing codebase

An established repo differs from a new one in four ways. Handle each before the first feature is planned.

### 5.1 Write a baseline

Planning designs changes against a picture of the system. For a new repo that picture is empty; for an existing one, write it once, from [`templates/baseline.md`](../templates/baseline.md), to `project/designs/baseline.md`:

- components, what each owns, and how they talk to each other;
- the contracts that already exist, explicit or implied (APIs, schemas, events, shared tables), with where each is defined;
- persistence per domain and its tier as it stands;
- how far the code is from `code-style.md`: per component, which Laws it already meets, which it violates and roughly how widely;
- hotspots: the files most changed and most depended on, which will make footprints overlap;
- tests and CI as they stand: what is covered, what is flaky, how long the suite takes.

The baseline is reviewed like a design (`project/reviews/baseline/design-1.md`). During bootstrap there is no supervisor yet, so the bootstrapping agent approves it; the first supervisor re-reads it on startup and raises anything it disagrees with. Every later design's research (planning P1) starts from it and updates it in the same planning PR when it changes something the baseline describes.

### 5.2 Account for work already in flight

Open PRs, active branches and tracker tickets are work the graph doesn't know about. For each:

- **finish it outside devteam** if it is close to done: list it in the baseline's "In flight" table with the files it changes. Planning must not schedule a ticket whose `touches` overlap those files until it merges or is abandoned;
- **adopt it** if it is early: once a feature plan covers it, write a ticket for it in that feature, rename or recreate the branch as `ticket/<id>`, and let it continue through the ticket lifecycle from whichever stage its files support. Until then, list it under In flight like finished-outside work. (Only `chore` and `spike` tickets may use the `chores` feature, so cleanup and investigation branches can be adopted there straight away.)
- **close it** if it is stale: ask the owner first (one batched question).

Tracker tickets (issues, tickets) are inputs to planning, not tickets. A planner reads them at P0 and P1.

### 5.3 Ratchet, don't rewrite

The code rules (`code-style.md`) apply in full to **new and changed code**. Existing violations are recorded, not fixed on sight:

- **Ratchet mode** for a gate: record the current violation count per component in the Known debt section of the settings. The gate fails if the count goes up, or if a file a PR changes has a violation in a line it changed. It never fails on untouched legacy code.
- A worker that needs to change legacy code inside its `touches` brings the lines it changes up to the code rules and leaves the rest alone. A larger cleanup is its own ticket.
- Each gate moves from ratchet to enforced when its chore ticket lands, and the gate table in the settings say so.
- Structural Laws that legacy code violates widely (functional core, result values) apply at **module boundaries a ticket creates or changes**. The baseline says where the old structure is; designs say how new code wraps it.

### 5.4 Start narrow

Old codebases have broad hotspots, so early footprints overlap and few tickets can run in parallel. Start with `max_active_tickets` at 2 or 3. Plan the first feature with contract tickets that carve stable interfaces around the hotspots; those are what let later features parallelize. Raise the cap when `devteam.mjs waves` shows real width.

### 5.5 Existing process docs

If the repo has its own process docs (a `PROCESS.md`, a code style guide, ADRs), do not delete them. Instead:

- list each existing rule and map it to the devteam doc that covers it;
- where they agree, link from the old doc to the devteam one;
- where they conflict, ask the owner which wins, and record the answer as an edit to the losing doc (`constitution.md` §4);
- record anything devteam lacks as a project-specific rule in the settings.
