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

**Two loops.** Goal → design → roadmap → graph → tickets: the supervisor interviews the owner until each goal is unambiguous, writes a design per goal (the spine that keeps many loops coherent), orders it into milestones, plans one milestone at a time into features with stories and releases, then into a graph of tickets, each one PR. Goals are meant to be large; the forecast says what one costs, and nothing splits it. Observe, orient, decide, act: every supervisor tick, what sessions report becomes observations; recurring observations become knowledge and problems; the supervisor decides what it may and asks the owner everything else through the questions inbox, saying why; a judgment call is a decision line that records what was weighed and the trust it rested on (its rung, the owner's answer, a default or a standing rule), and the acts that carry it out cite it; the dashboard's Decide view lists every call, the supervisor's and the owner's, and the Trust Ladder has its own page. The owner corrects a call, and a correction takes trust back and becomes a lesson. Retros gather the corrections and learnings across tickets and features.

**One log.** Everything structured is a line in one append-only JSON Lines log, validated against `schema/log.schema.json` on write and folded by timestamp with authority rules (owner > supervisor > planner > worker). State is computed from the log plus git; nothing else is stored. One file per writer: planners write `project/log/plan-<feature>.jsonl` in their worktree, so a plan lands only through its reviewed PR; everyone else writes `run/log/<writer>.jsonl` live, and the supervisor mirrors those into `project/log/` with the `chore-log` PR.

## Setup

"Use github.com/sanctuarycomputer/devteam to set up a fleet in this repo" means, for the agent doing it:

1. Read the repo's own rules first: `CONTRIBUTING`, any AI or agent policy, `AGENTS.md`/`CLAUDE.md`, CI config. If they forbid autonomous agents (some projects do), stop and tell the owner: devteam can still run on a private fork, but nothing goes upstream without a human writing it. Everything they require goes into the settings in step 3.
2. Copy `docs/devteam/` from the newest release tag of this repo (not `main`), except `project/` and `run/`.
3. `node docs/devteam/scripts/devteam.mjs init --upstream-base <tag> [--github]`. It creates `project/`, the `.gitignore` entries and the devteam section of `AGENTS.md` (and an `@AGENTS.md` import in `CLAUDE.md` where one exists, since Claude Code reads only that); `--github` writes a one-job workflow that makes GitHub require `check-pr` on every PR (the supervisor's `merge` runs the same checks and the gates itself; this only makes the forge refuse a merge that skipped them).
4. Fill `project/settings.md` (`init` sets `main_branch` from the remote's default branch): the registry: sibling repos as `repo` links and design files and docs (Figma, specs, Notion) as `url` links, inferred from git remotes, links in the README and docs, and package manifests; the component lines (`components.<c>.owns`) once there is more than one deployable part; and the stacks, `agent_command`, the `gates` map (name → command) the supervisor runs before every merge, `worktree_files`, the gitignored files a fresh worktree needs to boot (a Rails `config/master.key`, a `.env`), and `worktree_setup`, the command that makes it runnable (`npm ci`), both applied to every worker, planner and gate checkout, and `forge: "git"` if the remote has no `gh`. Record anything the repo already does differently from `governance/` (a release branch, its own CI) in the settings; the settings win. Infer what you can from the repo; ask the owner the rest in one batch.
5. Run `devteam.mjs gate --all` on `main`. Every gate that fails there is a toolchain to fix, a gate to set to `"mode": "ratchet"`, or a chore ticket.
6. Existing codebase: write `project/designs/architecture.md` from the code (components, contracts, persistence, dependencies, distance from the code rules, hotspots, tests, work in flight). New repo: leave the headings.
7. **Propose the Baseline goal.** Draft the repo's first goal, **Baseline**: every gate in `quality.md` §2 and every Law in `code-style.md` enforced on main (lint, format, types, tests in CI, coverage, dead code, duplication, secrets, lockfile, and an encrypted secret store per `code-style.md` §10 if the repo has none), measured as the floor gaps left, target 0 (`process/planning.md` §7). One of its preconditions is **the registry is complete**: `devteam.mjs components check --count` is 0 (counted with the gates), and the owner has said yes to "Does the registry list every repo, design file and doc this project depends on?". The owner opts in through the regular flow; once approved, its features are the floor tickets, and gates that fail on existing code go on in **ratchet** mode (`quality.md` §2).
8. Commit the kit, settings and architecture doc as one `chore-devteam-bootstrap` PR, then `devteam.mjs log-sync` for the Baseline goal draft.
9. Start the supervisor. It is the owner's foreground session in the main checkout, never a background, headless or tmux-detached one. **If an agent session did this setup, that session becomes the supervisor:** it reads the prompt from `node docs/devteam/scripts/devteam.mjs prompt supervisor` and follows it in place; it does not launch a second agent. If the owner did the setup by hand, they start the agent in their terminal with `DEVTEAM_ROLE=supervisor` in its environment (`DEVTEAM_ROLE=supervisor claude "$(node docs/devteam/scripts/devteam.mjs prompt supervisor)"`), inside tmux if they want workers' messages typed into its pane as they happen. Agent CLIs such as Claude Code don't keep shell state between commands, so an `export` inside the session doesn't stick: a session already running prefixes each devteam command with `DEVTEAM_ROLE=supervisor`. Run the dashboard where it outlives the session (a tmux window, or another terminal): `node docs/devteam/scripts/devteam.mjs dashboard`, and open the address.
10. The supervisor asks the owner for goals and the loop begins. To tell a session something from your own terminal as yourself, `node docs/devteam/scripts/devteam.mjs send <supervisor|ticket-id> "…" --owner`; answers to questions go through the inbox.

Requirements: git, tmux (for the workers), Node 18+ (the project's own pinned Node is fine: asdf, nvm and the dashboard all run the script with it), the GitHub CLI, one agent CLI (Claude Code, Codex, OpenCode or similar) with superpowers installed.

### Holding goals, and moving the fleet

Every goal, and the built-in Upkeep goal that owns chores, has a toggle on the dashboard: **Run**, **Drain** (nothing new starts; what's running finishes and merges), **Park** (sessions commit their work, push, leave a handoff commit and stop) and **Let go** (reversible). The strip at the top of the dashboard holds or resumes every goal at once and says whether the fleet can move (`process/supervisor.md` §12).

**Moving to another machine.** On the old one, park the fleet from the dashboard, or tell the supervisor ("Park the fleet; I'm moving it to my new laptop"). Fleet drain works too, more slowly: every ticket in flight finishes first. It runs:

```
DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs fleet park --reason "moving to a new laptop"
# once every session is parked, its own handoff, pushed as a tag:
DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs handoff --supervisor < note.md
DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs fleet status     # what's left; repeat until "ready to move: yes"
DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs observe-spend    # then land the log:
DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs log-sync
DEVTEAM_ROLE=supervisor node docs/devteam/scripts/devteam.mjs merge --chore log
```

Anything needed for 1:1 parity is in git; only secrets travel by hand. So `fleet status` also blocks on files left in `run/`, worktrees with unpushed work, the owner's unfinished review drafts, and agent memory outside the repo that isn't folded into knowledge or the supervisor's handoff. When it's ready it prints a parity fingerprint of the log, and the new machine's checklist (which `worktree_files` and secret keys to copy, which logins, which tools).

**On the new machine**, in this order:

```
git clone <repo-url> && cd <repo>
asdf install                                  # the versions in .tool-versions, if the repo pins them
gh auth login                                 # and log in to the agent CLI (claude: run it once, /login), with superpowers
# copy each worktree_files entry and secret key from the checklist over a secure channel (never git or chat)
claude        # or your agent CLI, in the repo; then say: "Assume the role of the devteam supervisor and resume the fleet"
```

The supervisor needn't run inside tmux: it puts the workers in a tmux session of its own (tmux only has to be installed), and their messages reach it through the log (`wait`). Step 9's command works too.

That is step 9's start, unchanged: the supervisor's prompt sees the parked fleet and opens with what to do, so it runs `fleet unpark` (which rebuilds `run/log` from the landed log, prints the same parity fingerprint before writing anything, puts every goal back as it was and prints each parked session's restart command), restarts the parked workers and planners (each gets its handoff in its prompt), and then the dashboard is restarted where it outlives the session:

```
tmux new-window -d -n dashboard 'node docs/devteam/scripts/devteam.mjs dashboard'
```

### Links, components and other repos

Three shapes, from nothing to add upward.

**A single repo.** Nothing to add. `components` may stay `{}` or hold labels a project wrote for itself (`{"api": {"stack": "rails"}}`); labels draw no lines.

**A monorepo.** Give each deployable part a line: `components.<c>.owns`, the globs of the files it owns. Once any component carries `owns` (or `link`, `shared` or `release`), every tracked file belongs to exactly one line; the kit's own files (`docs/devteam/**` and the project folder) are the computed `devteam` line and are never declared. Lines must not overlap:

```json
"components": {
  "api": { "owns": ["app/**", "lib/**", "config/*.yml", "config/initializers/**"] },
  "routes": { "owns": ["config/routes.rb"] },
  "web": { "owns": ["web/**"] },
  "ops": { "owns": [".github/**", "README.md", ".gitignore", "AGENTS.md"] }
}
```

`devteam.mjs components check` lists the gaps: unowned paths grouped by folder with a suggested owner, paths two lines claim, globs that match nothing, and paths that differ only by case. From then on `validate`, `check-pr` and `merge`, `observe-metrics` and `check-ticket` hold the lines, always by the settings committed on main. A ticket changes one component's line; a contract or integration ticket names the others it spans in `touches_components`.

**Links to design files and docs.** `links` names what the fleet uses:

```json
"links": {
  "figma": { "kind": "url", "title": "Companion designs", "url": "https://www.figma.com/file/…", "for": ["component:web"], "notes": "ignore the archived page" },
  "runbook": { "kind": "url", "title": "Runbook", "url": "https://www.notion.so/…", "for": ["all"] }
}
```

A link whose `for` matches a ticket (`all`, `component:<c>`, `feature:<f>`, `goal:<g>`), or that the ticket or its feature lists in its own `links`, is in that worker's prompt. Url links are the supervisor's: the loop proposes them when the owner or a worker mentions one (`observe-link`, then `orient`), and the supervisor applies them with `link add|set|rm`. `"check": false` keeps a page behind a login from being probed. `devteam.mjs links` prints the registry.

Sibling repos are `repo` links (`{ "kind": "repo", "title": "Console", "remote": "owner/console" }`, with an optional `path` and per-repo settings). They are accepted and validated now, and are the owner's like the settings they carry; they host components and tickets from the next release.

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
