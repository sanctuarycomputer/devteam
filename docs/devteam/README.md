# devteam

Engineering governance and process for building software with a supervised fleet of AI-agent sessions (and humans), in any stack, with any agent CLI.

**Agents start here.** Read this file, then the one doc for your role (below). Do not read every doc up front; each one links the next thing you need.

## Your role

| You are | Read next |
|---|---|
| Setting devteam up in a repo for the first time | [`process/bootstrap.md`](process/bootstrap.md) |
| The **supervisor** (the one coordinating session) | [`process/supervisor.md`](process/supervisor.md) |
| A **worker** made for one ticket | [`process/worker.md`](process/worker.md) |
| A **reviewer** asked to review a stage | [`governance/review.md`](governance/review.md) |
| A **planner** turning an owner direction into a graph | [`process/planning.md`](process/planning.md) |
| Improving the fleet, the roadmap and devteam itself (the supervisor, on its loop) | [`process/improvement.md`](process/improvement.md) |

## Vocabulary

- **owner**: the human accountable for the project. Owns one-way doors, product calls and releases to production.
- **supervisor**: one long-lived session acting as technical PM/CTO. Plans, rules, gives the merge word, writes no production code.
- **worker**: one session bound to one ticket, in its own git worktree and tmux window. Decides for itself whether to use subagents inside its ticket.
- **reviewer**: any session or subagent that did not author the work under review.
- **settings**: a project-specific answer to a question devteam leaves open (services, persistence tiers, release rings, agent command). Lives in `project/settings.md`.

The work, from largest to smallest:

- **feature**: a feature area owned end to end, such as "sign-in". One design, one feature plan, many tickets. The reserved feature `chores` holds chore and spike tickets that belong to no plan.
- **story**: a user-facing outcome inside a feature, with acceptance criteria checked end to end. Ids like `SIGNIN-S1`. Tickets declare which stories they serve.
- **ticket**: **one reviewable PR**, run by one worker. Ids like `api-07-session-tokens`.
- **task**: one step in a ticket's plan, built test-first.
- **wave**: the tickets that can run in parallel once the previous wave merges. Computed from dependencies (`devteam.mjs waves`), not a timebox.
- **graph**: the structure across all of it. Tickets and their dependencies, plus the live state of the fleet working them.

## Layout

```
docs/devteam/
  README.md            this file
  governance/          the rules: what must be true (owner-tweakable)
  process/             the procedures: how work moves (owner-tweakable)
  templates/           skeletons agents fill instead of inventing structure
  dashboard/           the owner's dashboard page, served by scripts/dashboard.mjs
  schema/              JSON schemas for tickets, questions, events
  scripts/             zero-dependency tools (Node 20+, bash)
  project/             THIS project's content; created at bootstrap, never touched by upstream sync
    settings.md         the project's answers to every open decision
    designs/           <slug>.md system designs (and baseline.md when adopting an existing codebase)
    features/          <feature>.md feature plans
    graph/             <ticket-id>.json, the work graph (tracked, written by planning)
    tickets/<id>/      spec.md, plan.md, reviews/, verification.md for each ticket
    reviews/<feature>/ design and graph review records
    decisions.md       cross-cutting rulings, dated
    improvement/       metrics snapshots, research notes and improvement proposals
    upstream-log.md    upstream releases considered and what was adopted, adapted or skipped
  run/                 live runtime state (gitignored): owner questions, heartbeats, the event log (incl. messages)
```

**How sessions talk.** Workers, planners and the supervisor send each other one-line messages typed into each other's tmux panes ([`process/messages.md`](process/messages.md)). Only the supervisor talks to the owner, by asking questions ([`process/questions.md`](process/questions.md)).

**Governance vs process.** Governance states what must be true (code rules, gates, what counts as a review, CI and release policy). Process states how work moves (planning, the supervisor loop, the worker loop, the question inbox). When a process step and a governance rule seem to conflict, governance wins and the process doc is a bug.

## Which rule wins

1. The owner's explicit instruction.
2. Enforcing configuration (lint, CI, branch protection). Where a doc and a config disagree, the config is the source of truth and the doc is a bug.
3. `project/settings.md` (the project's resolved answers).
4. `governance/`.
5. `process/`.
6. The framework's conventions.
7. The agent's own judgment.

## Requirements

git, tmux, Node 20+ (scripts use only built-ins), the GitHub CLI, one agent CLI (Claude Code, Codex, OpenCode or similar), and a CI runner. Superpowers is recommended for the worker loop but not required; [`process/ticket-lifecycle.md`](process/ticket-lifecycle.md) spells out every step either way.

## Scripts

`node docs/devteam/scripts/devteam.mjs help` lists every command. The ones each role uses most:

| Command | Who | What |
|---|---|---|
| `validate` | planner, CI | check the graph against the planning rules |
| `waves`, `ready`, `status` | supervisor, planner | parallel waves and critical path; what can start; computed stage of every ticket |
| `check-ticket <id>`, `check-pr` | worker, CI | definition of done and the automatic merge-word check at an exact head |
| `send`, `messages` | everyone | messages between sessions |
| `ask`, `questions`, `sync-questions`, `recorded` | supervisor | questions to the owner |
| `answer` | owner | answering the supervisor's questions |
| `heartbeat`, `event`, `history`, `whoami` | worker, supervisor | live state, the event log, catching up on history |
| `gate <name> -- <cmd>` | worker | run a gate and record its time, result and tests |
| `metrics`, `dashboard-data` | supervisor | time and cost by phase, gate health, findings; data for the dashboard |
| `node docs/devteam/scripts/dashboard.mjs` | owner | the dashboard: questions to answer, blockers, tickets, analytics |
| `notes <from> [<to>]`, `settings` | supervisor | story-grouped release notes; the project's settings |
| `bash docs/devteam/scripts/make-worker.sh <id> [--resume]` | supervisor | worktree, tmux window and agent for a ticket (`--planner <feature>` for a planner) |
| `bash docs/devteam/scripts/stop-hook.sh` | worker's agent | refuses to stop while the run state is stale |
