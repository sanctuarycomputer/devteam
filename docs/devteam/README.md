# devteam

A kit a project materializes into `docs/devteam/` and owns. It runs a supervised fleet of coding-agent sessions that takes broad goals, turns them into a graph of tickets, and plows through it with superpowers, under one owner, with adversarial review before every merge and a loop that keeps improving the fleet itself.

**Agents start here.** Read this file, then the one doc for your role. Do not read every doc up front.

| You are | Read |
|---|---|
| Setting up a repo (new or existing) | Setup, below |
| The **supervisor** | [`process/supervisor.md`](process/supervisor.md) |
| A **worker** on one ticket | [`process/worker.md`](process/worker.md) |
| A **planner** turning a goal into a design, roadmap and graph | [`process/planning.md`](process/planning.md) |
| A **reviewer** | [`governance/quality.md`](governance/quality.md) §3 |
| The **owner**, deciding what to delegate | [`governance/constitution.md`](governance/constitution.md) §2 |

## Two loops

**Goal → design → roadmap → graph → tickets.** The owner states broad goals. The supervisor interviews until each is unambiguous. A design per goal (superpowers' brainstorming, shaped by the constitution and the code style). The design becomes a roadmap: features, each with stories and a target release. Features become a graph of tickets, each one PR. Workers run each ticket with superpowers; the supervisor schedules, reviews and merges. When every goal is met, new goals.

**Observe, orient, decide, act.** Every supervisor tick: what sessions report, the metrics and what workers notice become observations; recurring observations become knowledge and problems, and accepted knowledge goes into the next prompts; the supervisor decides what it may and asks the owner the rest through the questions inbox, saying why; it logs every decision as an act the owner can correct, and a correction takes trust back and becomes a lesson. Retros across tickets and features gather the corrections and learnings.

Everything structured is an event in one append-only log. Everything prose is markdown.

## Vocabulary

- **owner**: the human. Goals, one-way doors, production, the rules.
- **supervisor**: one long-lived session, the technical PM. Plans or makes planners, makes workers, rules, merges. Writes no production code.
- **worker**: one session for one ticket, in its own git worktree and tmux window, running superpowers.
- **planner**: a session that turns one goal into a design, a feature and tickets on a `plan/<feature>` branch.
- **reviewer**: any session or subagent that did not write the work. Default verdict: not approved.

The work, largest to smallest:

- **goal**: an outcome with a measure, a target and a date. Owner-approved. Everything serves one.
- **design**: how the system changes for a goal. `project/designs/<goal>.md`. `project/designs/architecture.md` is the whole system now.
- **feature**: a slice of the roadmap serving a goal: the goal preconditions it makes true, its **stories** (user-facing outcomes checked end to end) and each story's target **release**.
- **ticket**: one reviewable PR, run by one worker. Ids like `api-07-session-tokens`. A **task** is one step of its plan. A **wave** is the tickets that can run in parallel; the **graph** is all of it with its dependencies.
- **roadmap**: goals in order with their features, releases and estimated weeks. Computed (`devteam.mjs roadmap`), never written.

## Layout

```
docs/devteam/
  README.md
  governance/constitution.md   who decides what, the trust ladder, principles, one-way doors
  governance/code-style.md     the code doctrine
  governance/quality.md        definition of done, gates, reviews, merging, releases
  process/planning.md          goal → design → roadmap → graph
  process/supervisor.md        the tick, questions, messages, the log, improvement, retros
  process/worker.md            one ticket with superpowers
  schema/log.schema.json       every event type and who may write what
  scripts/devteam.mjs          the one script (node, no dependencies)
  dashboard/index.html
  project/                     this project's content; upstream never touches it
    settings.md                only what this project changes
    designs/architecture.md    the whole system now, updated by every plan PR
    designs/<goal>.md          one design per goal
    log/<writer>.jsonl         the durable log
    tickets/<id>/              spec.md, plan.md, verification.md, reviews/ (written by superpowers)
    reviews/<feature>/, reviews/<design>/   graph and design review records
    retros/<date>.md
  run/                         gitignored: the live log, prompts
```

## The log

One JSON object per line, validated against `schema/log.schema.json` on write. Eleven types: `goal`, `feature`, `ticket`, `phase`, `gate`, `message`, `observation`, `knowledge`, `problem`, `question`, `act`. A `new` line creates a thing; a `set` line changes fields on it; nothing is ever edited. Current state is the fold of every line in time order, and when two writers set the same field the higher rank wins: owner, then supervisor, then planner, then worker.

One file per writer. A planner writes `project/log/plan-<feature>.jsonl` in its own worktree, so a plan lands only through its reviewed PR. Everyone else writes `run/log/<writer>.jsonl` the moment something happens, and the supervisor mirrors those into `project/log/` with the `chore-log` PR (`log-sync`, every tick; merged daily). Readers merge every file. `devteam.mjs log`, `log-check` and `history` read it; the dashboard and the roadmap are computed from it.

## Setup

"Use sanctuarycomputer/devteam to set up a fleet in this repo" means, for the agent doing it:

1. Copy `docs/devteam/` from the newest release tag of the upstream repo (not `main`), except `project/` and `run/`.
2. `node docs/devteam/scripts/devteam.mjs init --upstream-base <tag> [--agent claude] [--github]`. It creates `project/`, the `.gitignore` entries and the `AGENTS.md` pointer; `--agent claude` writes the deny rules and stop hook into `.claude/settings.json`; `--github` writes a one-job workflow that makes GitHub require `check-pr` on every PR (the supervisor runs the same checks itself; this only makes the forge refuse a merge that skipped them).
3. Fill `project/settings.md`: components and stacks, `agent_command`, and the `gates` map (name → command) the supervisor runs before every merge. Infer what you can from the repo; ask the owner the rest in one batch.
4. Existing codebase: write `project/designs/architecture.md` from the code (components, contracts, persistence, dependencies, distance from the code rules, hotspots, tests, work in flight). New repo: leave the headings.
5. **Raise the floor first.** For every gate in `quality.md` §2 and every Law in `code-style.md` the repo doesn't yet enforce (lint, format, types, tests in CI, coverage, dead code, duplication, secrets, lockfile), add a chore ticket: `devteam.mjs ticket add <component>-NN-<slug> --json '{…, "kind": "chore", "feature": "chores", "serves": [], "notes": "turns on <gate>"}'`. Gates that fail on existing code go on in **ratchet** mode (`quality.md` §2). The fleet's first work is its own quality floor.
6. Commit the kit, settings and architecture doc as one `chore-devteam-bootstrap` PR, then `devteam.mjs log-sync` for the tickets.
7. Start: `tmux new-session -s devteam -n supervisor`, `export DEVTEAM_ROLE=supervisor`, then your agent with `"$(node docs/devteam/scripts/devteam.mjs prompt supervisor)"`. In another terminal, `node docs/devteam/scripts/devteam.mjs dashboard` and open the address.
8. The supervisor asks the owner for goals and the loop begins.

Requirements: git, tmux, Node 20+, the GitHub CLI, one agent CLI (Claude Code, Codex, OpenCode or similar) with [superpowers](https://github.com/obra/superpowers) installed.

## Commands

`node docs/devteam/scripts/devteam.mjs help` lists them all. The ones each role lives in:

| Who | Commands |
|---|---|
| supervisor | `status`, `ready`, `worker`, `planner`, `merge`, `ask`, `act`, `questions`, `messages`, `observe-metrics`, `orient`, `knowledge`, `problem`, `goal`, `roadmap`, `retro`, `log-sync`, `chore` |
| worker | `ticket show`, `phase`, `gate`, `send`, `messages`, `check-ticket`, `observe` |
| planner | `feature add`, `ticket add`, `validate`, `waves`, `send` |
| owner | `answer`, `correct`, `goal approve`, and the dashboard |
| anyone | `log`, `history`, `whoami`, `settings`, `help` |

## Which rule wins

1. The owner's explicit instruction.
2. Enforcing configuration (lint, gates, branch protection). Where a doc and a config disagree, the config is right and the doc is a bug.
3. `project/settings.md`.
4. `governance/`.
5. `process/`.
6. The framework's conventions, then the agent's judgment.

## Upgrading devteam

`settings.upstream_base` records the release this project materialized from. On its improvement loop the supervisor lists newer releases of `upstream_repo`, reads each release's What, Why and Migration, and asks the owner per release whether to adopt, adapt or skip each change (`process/supervisor.md` §9). Changes land as a `chore-devteam-sync-<tag>` PR that never touches `project/` or `run/`. Improvements this project makes to the kit that other projects would want go back upstream as PRs, with nothing from `project/` or `run/` in them.
