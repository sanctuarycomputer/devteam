# Bootstrap

How devteam gets materialized into a project repo, and how the first session gets from "nothing" to a running fleet. You (the agent) do every step; you ask the owner only where marked.

## 1. Materialize

1. Copy this upstream's `docs/devteam/` into the project at `docs/devteam/`, **except** `project/` and `run/`. Keep `VERSION` as it is; it records the upstream release you copied.
2. Create `docs/devteam/.gitignore` containing `run/` (if the upstream copy lacks it).
3. Create `docs/devteam/project/` from the templates:
   - `binding.md` from [`templates/binding.md`](../templates/binding.md)
   - `decisions.md` from [`templates/decisions.md`](../templates/decisions.md)
   - `upstream-log.md` from [`templates/upstream-log.md`](../templates/upstream-log.md), with a first line recording the materialized version
   - empty `designs/`, `columns/`, `graph/`, `nodes/` folders (each with a `.gitkeep`)
4. Create or update the repo root `AGENTS.md` from [`templates/AGENTS.md`](../templates/AGENTS.md). If an `AGENTS.md` exists, append the devteam section rather than replacing it. If a `CLAUDE.md` exists and is not already a symlink, add a line to it pointing at `AGENTS.md`; otherwise create `CLAUDE.md` as a symlink to `AGENTS.md`.
5. Add `.worktrees/` to the root `.gitignore`.
6. Add the CI job from [`templates/github/devteam.yml`](../templates/github/devteam.yml) (adapt to the project's CI if it is not GitHub Actions).

Commit all of this as one `chore-devteam-bootstrap` PR.

## 2. Fill the binding

Survey the repo first (languages, frameworks, components, existing CI, existing lint config, deploy targets). Fill every field you can infer. Then **ask the owner** only what you could not infer, as one batch of questions with your recommended answers:

- components and their stacks;
- persistence tier per domain (`code-style.md` §4) for any domain that already exists;
- one-way doors specific to this project;
- release rings, release actors, and whether `-rc` tags may be automated (`release.md` §3);
- `agent_command` and `resume_command`; `max_active_nodes`;
- shared resources that need slots, if any;
- how the owner wants to be notified.

Record each answer in the binding with its date.

## 3. Commission the day-one floor

For each component's stack, add the root gates from `quality-gates.md` §2 that are missing, using the tools in §3 of that file unless the binding chose others. Autofix first. Each gate is listed in the binding's commissioning table with the CI step that runs it.

Do not fix the whole codebase in this PR. If a gate fails on existing code, commission it in **report-only** mode, add a `chore-` node per component to bring it to green, and record the debt in the binding.

## 4. Start

1. Start the tmux session named in the binding with the supervisor in window 0: `tmux new-session -s devteam -n supervisor`, then launch the agent with the prompt in [`templates/supervisor-prompt.md`](../templates/supervisor-prompt.md).
2. Start the dashboard if the project uses one (`binding.md` names its command).
3. The supervisor reads [`supervisor.md`](supervisor.md) and, with no graph yet, begins [`planning.md`](planning.md) at P0 by asking the owner what to build.

## 5. Adopting into a repo that already has a process

If the repo has its own process docs (a `PROCESS.md`, a code style guide, ADRs), do not delete them. Instead:

- list each existing rule and map it to the devteam doc that covers it;
- where they agree, link from the old doc to the devteam one;
- where they conflict, ask the owner which wins, and record the answer as an edit to the losing doc (`constitution.md` §4);
- record anything devteam lacks as a project-specific rule in the binding.
