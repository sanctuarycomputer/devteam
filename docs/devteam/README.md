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
| Keeping the record: observations, knowledge, problems, acts (the supervisor, every tick) | [`process/log.md`](process/log.md) |
| The **owner**, deciding what to delegate | [`governance/autonomy.md`](governance/autonomy.md) |

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

Above all of it sits the **goal**: an outcome the owner wants, with a measure, a target and a date. Features name the goals they serve.

Three kinds of plan, each answering one question:

- **goal plan** (`project/goals/<id>.md`): why this goal, and the chain from its outcome back to the features that make it true.
- **architecture** (`project/designs/architecture.md`): how the whole system works now; each feature's **design** (`project/designs/<slug>.md`) says how one feature will change it.
- **roadmap**: what's next and roughly when. Computed from goal priorities, feature plans, release maps and throughput (`devteam.mjs roadmap`, and the dashboard), never written by hand.

The loop's record ([`process/log.md`](process/log.md)):

- **observation**: something noticed: a metric finding, a slow test, a goal reading, the outcome of a decision.
- **knowledge**: what has been learned from recurring observations (a lesson, a fact, an owner preference), with a confidence and evidence. Accepted knowledge goes into the prompts of the sessions it applies to.
- **problem**: something wrong (an issue) or that could go wrong (a risk), with a lifecycle.
- **question**: the supervisor asking the owner, saying why it needed them.
- **act**: a decision the supervisor made. **correction**: the owner (or a retro) saying an act was wrong.
- **trust ladder**: which of the owner's decisions the supervisor may make alone, earned class by class ([`governance/autonomy.md`](governance/autonomy.md)).

## How it fits together

Two loops. **Planning works backwards from goals:** the owner states the goals, the supervisor interviews the owner until each is unambiguous, and planning breaks each into the preconditions that must hold, the features that make them hold, and stories and tickets, until each ticket is one PR whose dependencies are known (`process/planning.md`). **Running works forwards in short cycles**, each tick of the supervisor's loop:

- **observe**: metrics, findings, goal readings and what workers notice become observations;
- **orient**: recurring observations become knowledge or problems; accepted knowledge shapes the next prompts;
- **decide**: the supervisor decides what it may, and asks the owner the rest, saying why; the owner's answers can widen what it may decide next time;
- **act**: workers build; the supervisor's decisions are logged as acts the owner can correct, and corrections take trust back and teach.

The improvement loop (`process/improvement.md`) tunes the cycle itself. All of it is recorded in an append-only log, one file per writer, in git ([`process/log.md`](process/log.md)).

## Layout

```
docs/devteam/
  README.md            this file
  governance/          the rules: what must be true (owner-tweakable)
  process/             the procedures: how work moves (owner-tweakable)
  templates/           skeletons agents fill instead of inventing structure
  dashboard/           the owner's dashboard page, served by scripts/dashboard.mjs
  schema/              JSON schemas for tickets, run state, events and log lines
  scripts/             zero-dependency tools (Node 20+, bash)
  project/             THIS project's content; created at bootstrap, never touched by upstream sync
    settings.md         the project's answers to every open decision
    designs/           architecture.md (the whole system now) and <slug>.md (one per feature)
    goals/             <goal-id>.md: the reverse chain for each goal, in prose
    features/          <feature>.md feature plans
    graph/             <ticket-id>.json, the work graph (tracked, written by planning)
    tickets/<id>/      spec.md, plan.md, reviews/, verification.md for each ticket
    reviews/<feature>/ design and graph review records
    decisions.md       cross-cutting rulings, dated
    log/               the durable log: <writer>.jsonl, one JSON object per line (process/log.md)
    improvement/       retros/<date>.md (each with its numbers) and research/ notes
    upstream-log.md    upstream releases considered and what was adopted, adapted or skipped
  run/                 live runtime state (gitignored): heartbeats, session messages, and log/ (the live log, synced daily into project/log)
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
| `ask`, `questions`, `withdraw`, `recorded` | supervisor | questions to the owner |
| `answer`, `correct`, `seen`, `goal approve` | owner | answering (and how to handle the next one), correcting an act, approving a goal; usually from the dashboard |
| `goal`, `observe`, `orient`, `knowledge`, `problem`, `act`, `trust` | supervisor (workers: `observe`) | the loop: goals, observations, knowledge, problems, acts, the trust ladder |
| `log`, `log-check`, `log-sync` | supervisor, CI | read and check the log; the daily log-only PR |
| `roadmap`, `retro`, `goal plan`, `chore-pr` | supervisor | the computed roadmap; drafting and recording retros; goal plans; PRs for supervisor-written files |
| `heartbeat`, `event`, `history`, `whoami` | worker, supervisor | live state, the event log, catching up on history |
| `gate <name> -- <cmd>` | worker | run a gate and record its time, result and tests |
| `metrics`, `dashboard-data` | supervisor | time and cost by phase, gate health, findings; data for the dashboard |
| `node docs/devteam/scripts/dashboard.mjs` | owner | the dashboard: goals, questions to answer, burn-up and forecast, board, observations, knowledge and problems, the trust ladder, the act feed with corrections, analytics |
| `notes <from> [<to>]`, `settings` | supervisor | story-grouped release notes; the project's settings |
| `bash docs/devteam/scripts/make-worker.sh <id> [--resume]` | supervisor | worktree, tmux window and agent for a ticket (`--planner <feature>` for a planner) |
| `bash docs/devteam/scripts/stop-hook.sh` | worker's agent | refuses to stop while the run state is stale |
