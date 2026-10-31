# devteam

Engineering governance and process for building software with a supervised fleet of AI-agent sessions (and humans), in any stack, with any agent CLI.

**Agents start here.** Read this file, then the one doc for your role (below). Do not read every doc up front; each one links the next thing you need.

## Your role

| You are | Read next |
|---|---|
| Setting devteam up in a repo for the first time | [`process/bootstrap.md`](process/bootstrap.md) |
| The **supervisor** (the one coordinating session) | [`process/supervisor.md`](process/supervisor.md) |
| A **worker** spawned for one graph node | [`process/worker.md`](process/worker.md) |
| A **reviewer** asked to review a stage | [`governance/review.md`](governance/review.md) |
| A **planner** turning an owner direction into a graph | [`process/planning.md`](process/planning.md) |
| Folding in a new upstream devteam release (the supervisor checks on its loop) | [`process/upstream-sync.md`](process/upstream-sync.md) |

## Vocabulary

- **owner**: the human accountable for the project. Owns one-way doors, product calls and releases to production.
- **supervisor**: one long-lived session acting as technical PM/CTO. Plans, rules, gives the merge word, writes no production code.
- **worker**: one session bound to one graph node, in its own git worktree and tmux window. Decides for itself whether to use subagents inside its node.
- **reviewer**: any session or subagent that did not author the work under review.
- **column**: a feature area owned end to end. One design, one column plan, many nodes. The reserved column `chores` holds chore and spike nodes that belong to no plan.
- **node**: one unit of the work graph. **One node is one reviewable PR.** Nodes have ids like `api-07-session-tokens`.
- **binding**: a project-specific decision the doctrine leaves open (services, persistence tiers, release rings, agent command). Lives in `project/binding.md`.

## Layout

```
docs/devteam/
  README.md            this file
  governance/          the rules: what must be true (owner-tweakable)
  process/             the procedures: how work moves (owner-tweakable)
  templates/           skeletons agents fill instead of inventing structure
  schema/              JSON schemas for graph nodes, questions, events
  scripts/             zero-dependency tools (Node 20+, bash)
  project/             THIS project's content; created at bootstrap, never touched by upstream sync
    binding.md         the project's answers to every open decision
    designs/           <slug>.md system designs
    columns/           <column>.md column plans
    graph/             <node-id>.json, the work graph (tracked, compiled by planning)
    nodes/<node-id>/   spec.md, plan.md, reviews/, verification.md for each node
    decisions.md       cross-cutting rulings, dated
    upstream-log.md    upstream releases considered and what was adopted, adapted or skipped
  run/                 live runtime state (gitignored): questions, heartbeats, events
```

**Governance vs process.** Governance states what must be true (code doctrine, gates, what counts as a review, CI and release policy). Process states how work moves (planning, the supervisor loop, the worker loop, the question inbox). When a process step and a governance rule seem to conflict, governance wins and the process doc is a bug.

## Precedence

1. The owner's explicit instruction.
2. Enforcing configuration (lint, CI, branch protection). Where a doc and a config disagree, the config is the source of truth and the doc is a bug.
3. `project/binding.md` (the project's resolved answers).
4. `governance/`.
5. `process/`.
6. The framework's conventions.
7. The agent's own judgment.

## Requirements

git, tmux, Node 20+ (scripts use only built-ins), the GitHub CLI, one agent CLI (Claude Code, Codex, OpenCode or similar), and a CI runner. Superpowers is recommended for the worker loop but not required; [`process/item-lifecycle.md`](process/item-lifecycle.md) spells out every step either way.

## Scripts

`node docs/devteam/scripts/devteam.mjs help` lists every command. The ones each role uses most:

| Command | Who | What |
|---|---|---|
| `validate` | planner, CI | check the graph against the planning rules |
| `waves`, `ready`, `status` | supervisor, planner | parallel waves and critical path; what can start; derived stage of every node |
| `check-node <id>`, `check-pr` | worker, CI | definition of done and the mechanical merge-word check at an exact head |
| `ask`, `answer`, `questions`, `sync-questions`, `recorded` | everyone | the question inbox |
| `heartbeat`, `event`, `history`, `whoami` | worker, supervisor | live state, the event log, orientation |
| `notes <from> [<to>]`, `binding` | supervisor | story-grouped release notes; the project's settings |
| `bash docs/devteam/scripts/spawn-node.sh <id> [--resume]` | supervisor | worktree, tmux window and agent for a node (`--planner <column>` for a planner) |
| `bash docs/devteam/scripts/stop-hook.sh` | worker's agent | refuses to stop while the run state is stale |
