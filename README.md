# devteam

A kit a project copies into `docs/devteam/` and owns. It runs a supervised fleet of coding-agent sessions that takes broad goals, turns them into a graph of tickets, and plows through it with [superpowers](https://github.com/obra/superpowers), under one owner, with adversarial review before every merge and a loop that keeps improving the fleet itself.

Eleven files: three governance docs, three process docs, one schema, one script, one dashboard and its two helpers for review pages. Once adopted, agents are routed by a section `init` adds to the project's `AGENTS.md`; there is no second README.

```
docs/devteam/
  governance/constitution.md   who decides what, the trust ladder, principles, one-way doors, which rule wins
  governance/quality.md        definition of done, gates, the review standard, merging, releases
  governance/code-style.md     the code doctrine
  process/planning.md          goal → design → milestones → roadmap → graph
  process/supervisor.md        the tick as observe / orient / decide / act, questions, messages, the log, retros
  process/worker.md            one ticket with superpowers
  schema/log.schema.json       the eleven event types and who may write what
  scripts/devteam.mjs          the one script (node, no dependencies)
  dashboard/index.html         the owner's page
  dashboard/devteam-ui.css     the dashboard's look, for an agent's review page (served to it, nothing else)
  dashboard/devteam-ui.js      a review page's bridge to the dashboard, and a few components
  project/                     this project's content; upstream never touches it
    settings.md                only what this project changes
    designs/architecture.md    the whole system now, updated by every plan PR
    designs/<goal>.md          one design per goal, the spine; a feature's own design when it's planned
    log/<writer>.jsonl         the durable log
    tickets/<id>/              spec.md, plan.md, verification.md, reviews/ (written by superpowers), questions/ (its review pages and the owner's results)
    questions/<slug>/, questions/<qid>/   review pages the supervisor drew, and the owner's result.json for each, copied in by review result --commit; never changed once landed
    reviews/<feature>/, reviews/<design>/   graph and design review records
    retros/<date>.md
  run/                         gitignored: the live log, prompts
```

## How it runs

**Roles.** The **owner** is the human: goals, one-way doors, production, the rules. The **supervisor** is the owner's foreground agent session in the terminal: it plans or makes planners, makes workers, rules, merges, and writes no production code. A **worker** is one session for one ticket, in its own git worktree and tmux window, running superpowers. A **planner** turns one goal into a design, a feature and tickets on a `plan/<feature>` branch. A **reviewer** is any session or subagent that did not write the work; its default verdict is not approved.

**Two loops.** Goal → design → roadmap → graph → tickets: the supervisor interviews the owner until each goal is unambiguous, writes a design per goal (the spine that keeps many loops coherent), orders it into milestones, plans one milestone at a time into features with stories and releases, then into a graph of tickets, each one PR. Goals are meant to be large; the forecast says what one costs, and nothing splits it. Observe, orient, decide, act: every supervisor tick, what sessions report becomes observations; recurring observations become knowledge and problems; the supervisor decides what it may and asks the owner everything else through the questions inbox, saying why; every decision is an act the owner can correct, and a correction takes trust back and becomes a lesson. Retros gather the corrections and learnings across tickets and features.

**One log.** Everything structured is a line in one append-only JSON Lines log, validated against `schema/log.schema.json` on write and folded by timestamp with authority rules (owner > supervisor > planner > worker). State is computed from the log plus git; nothing else is stored. One file per writer: planners write `project/log/plan-<feature>.jsonl` in their worktree, so a plan lands only through its reviewed PR; everyone else writes `run/log/<writer>.jsonl` live, and the supervisor mirrors those into `project/log/` with the `chore-log` PR.

## Setup

"Use github.com/sanctuarycomputer/devteam to set up a fleet in this repo" means, for the agent doing it:

1. Read the repo's own rules first: `CONTRIBUTING`, any AI or agent policy, `AGENTS.md`/`CLAUDE.md`, CI config. If they forbid autonomous agents (some projects do), stop and tell the owner: devteam can still run on a private fork, but nothing goes upstream without a human writing it. Everything they require goes into the settings in step 3.
2. Copy `docs/devteam/` from the newest release tag of this repo (not `main`), except `project/` and `run/`.
3. `node docs/devteam/scripts/devteam.mjs init --upstream-base <tag> [--github]`. It creates `project/`, the `.gitignore` entries and the devteam section of `AGENTS.md` (and an `@AGENTS.md` import in `CLAUDE.md` where one exists, since Claude Code reads only that); `--github` writes a one-job workflow that makes GitHub require `check-pr` on every PR (the supervisor's `merge` runs the same checks and the gates itself; this only makes the forge refuse a merge that skipped them).
4. Fill `project/settings.md` (`init` sets `main_branch` from the remote's default branch): components and stacks, `agent_command`, the `gates` map (name → command) the supervisor runs before every merge, `worktree_files`, the gitignored files a fresh worktree needs to boot (a Rails `config/master.key`, a `.env`), and `worktree_setup`, the command that makes it runnable (`npm ci`), both applied to every worker, planner and gate checkout, and `forge: "git"` if the remote has no `gh`. Record anything the repo already does differently from `governance/` (a release branch, its own CI) in the settings; the settings win. Infer what you can from the repo; ask the owner the rest in one batch.
5. Run `devteam.mjs gate --all` on `main`. Every gate that fails there is a toolchain to fix, a gate to set to `"mode": "ratchet"`, or a chore ticket.
6. Existing codebase: write `project/designs/architecture.md` from the code (components, contracts, persistence, dependencies, distance from the code rules, hotspots, tests, work in flight). New repo: leave the headings.
7. **Raise the floor first.** For every gate in `quality.md` §2 and every Law in `code-style.md` the repo doesn't yet enforce (lint, format, types, tests in CI, coverage, dead code, duplication, secrets, lockfile, and an encrypted secret store per `code-style.md` §10 if the repo has none), add a chore ticket: `devteam.mjs ticket add <component>-NN-<slug> --json '{…, "kind": "chore", "feature": "chores", "serves": [], "notes": "turns on <gate>"}'`. Gates that fail on existing code go on in **ratchet** mode (`quality.md` §2). The fleet's first work is its own quality floor.
8. Commit the kit, settings and architecture doc as one `chore-devteam-bootstrap` PR, then `devteam.mjs log-sync` for the tickets.
9. Start the supervisor. It is the owner's foreground session in the main checkout, never a background, headless or tmux-detached one. **If an agent session did this setup, that session becomes the supervisor:** it reads the prompt from `node docs/devteam/scripts/devteam.mjs prompt supervisor` and follows it in place; it does not launch a second agent. If the owner did the setup by hand, they start the agent in their terminal with `DEVTEAM_ROLE=supervisor` in its environment (`DEVTEAM_ROLE=supervisor claude "$(node docs/devteam/scripts/devteam.mjs prompt supervisor)"`), inside tmux if they want workers' messages typed into its pane as they happen. Agent CLIs such as Claude Code don't keep shell state between commands, so an `export` inside the session doesn't stick: a session already running prefixes each devteam command with `DEVTEAM_ROLE=supervisor`. Run the dashboard where it outlives the session (a tmux window, or another terminal): `node docs/devteam/scripts/devteam.mjs dashboard`, and open the address.
10. The supervisor asks the owner for goals and the loop begins. To tell a session something from your own terminal as yourself, `node docs/devteam/scripts/devteam.mjs send <supervisor|ticket-id> "…" --owner`; answers to questions go through the inbox.

Requirements: git, tmux (for the workers), Node 18+ (the project's own pinned Node is fine: asdf, nvm and the dashboard all run the script with it), the GitHub CLI, one agent CLI (Claude Code, Codex, OpenCode or similar) with superpowers installed.

### Moving the fleet to another machine

The fleet stops cleanly and picks up elsewhere: every session pushes its work and leaves a handoff note on its branch, the log lands on main, and the new machine starts from a clone (`process/supervisor.md` §12).

**On the old machine**, tell the supervisor to drain (for example: "Drain the fleet; I'm moving it to my new laptop"). It runs:

```
DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs drain --reason "moving to a new laptop"
DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs drain --status    # until "ready to move: yes"
DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs log-sync          # then land the log:
DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs merge --chore log
```

`drain --status` ends with the new machine's checklist, generated from the settings: which `worktree_files` and secret keys to copy, which logins, which tools.

**On the new machine**, in this order:

```
git clone <repo-url> && cd <repo>
asdf install                                  # the versions in .tool-versions, if the repo pins them
gh auth login                                 # and log in to the agent CLI (claude: run it once, /login), with superpowers
# copy each worktree_files entry and secret key from the checklist over a secure channel (never git or chat)
tmux new -s supervisor
DEVTEAM_ROLE=supervisor claude "$(node docs/devteam/scripts/devteam.mjs prompt supervisor)"
```

That is step 9's start, unchanged: the supervisor's prompt sees the drain and opens with what to do, so it runs `undrain` (which rebuilds `run/log` from the landed log, records the undrain and prints each drained session's restart command), restarts the drained workers and planners (each gets its handoff note in its prompt), and then the dashboard is restarted where it outlives the session:

```
tmux new-window -d -n dashboard 'node docs/devteam/scripts/devteam.mjs dashboard'
```

## Upgrading a project

`settings.upstream_base` records the release a project materialized from. On its improvement loop the project's supervisor lists newer releases, reads each release's What, Why and Migration, and asks the owner per release whether to adopt, adapt or skip each change (`process/supervisor.md` §9). Changes land as a `chore-devteam-sync-<tag>` PR that never touches `project/` or `run/`. Improvements a project makes to the kit that other projects would want come back here as PRs (`upstream-pr` on the trust ladder), written generically, with nothing from `project/` or `run/`.

## Contributing

Changes land on `main` through PRs. `node --test` (the kit test in `test/`) must pass. A release is a `vX.Y.Z` tag on `main` with a GitHub Release whose notes have three sections, because projects' supervisors read them to decide what to fold in:

- **What** changed, by file or area;
- **Why**, the reason a project would want it (a change without a why gets skipped);
- **Migration**, anything a project must do, such as a new settings field or a renamed flag. "None" if nothing.

```
gh release create vX.Y.Z --target main --title vX.Y.Z --notes-file notes.md
```
