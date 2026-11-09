# devteam

A kit a project copies into `docs/devteam/` and owns. It runs a supervised fleet of coding-agent sessions that takes broad goals, turns them into a graph of tickets, and plows through it with [superpowers](https://github.com/obra/superpowers), under one owner, with adversarial review before every merge and a loop that keeps improving the fleet itself.

Twelve files: three governance docs, three process docs, one schema, one script, one dashboard and its two helpers for review pages, and the hub page that lists every instance on the machine. Once adopted, agents are routed by a section `init` adds to the project's `AGENTS.md`; there is no second README.

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
  dashboard/hub.html           the machine's page listing every running instance (http://127.0.0.1:4320)
  project/                     this project's content; upstream never touches it
    settings.md                only what this project changes
    designs/architecture.md    the whole system now, updated by every plan PR
    designs/<goal>.md          one design per goal, the spine; a feature's own design when it's planned
    log/<writer>.jsonl         the durable log
    tickets/<id>/              spec.md, plan.md, verification.md, reviews/ (written by superpowers), questions/ (its review pages and the owner's results)
    artifacts/<slug>/          pages the fleet drew to show an idea (mocks, flows, models), listed in the dashboard's Library
    questions/<slug>/, questions/<qid>/   review pages the supervisor drew, and the owner's result.json for each, copied in by review result --commit; never changed once landed
    reviews/<feature>/, reviews/<design>/   graph and design review records
    retros/<date>.md
  run/                         gitignored: the live log, prompts
```

## How it runs

**Roles.** The **owner** is the human: goals, one-way doors, production, the rules. The **supervisor** is the owner's foreground agent session in the terminal: it plans or makes planners, makes workers, rules, merges, and writes no production code (it may draw artifacts). A **worker** is one session for one ticket, in its own git worktree and tmux window, running superpowers. A **planner** turns one goal into a design, a feature and tickets on a `plan/<feature>` branch. A **reviewer** is any session or subagent that did not write the work; its default verdict is not approved.

**Two loops.** Goal → design → roadmap → graph → tickets: the supervisor interviews the owner until each goal is unambiguous, writes a design per goal (the spine that keeps many loops coherent), orders it into milestones, plans one milestone at a time into features with stories and releases, then into a graph of tickets, each one PR. Goals are meant to be large; the forecast says what one costs, and nothing splits it. Observe, orient, decide, act: every supervisor tick, what sessions report becomes observations; recurring observations become knowledge and problems; the supervisor decides what it may and asks the owner everything else through the questions inbox, saying why; a judgment call is a decision line that records what was weighed and the trust it rested on (its rung, the owner's answer, a default or a standing rule), and the acts that carry it out cite it; the dashboard's Decide view lists every call, the supervisor's and the owner's, and the Trust Ladder has its own page. The owner corrects a call, and a correction takes trust back and becomes a lesson. Retros gather the corrections and learnings across tickets and features.

**Many projects, one machine.** Each project has its own tmux session (`devteam-<project>-<6 hex of its path>`, saved in `run/tmux-session`) and its own dashboard port: the next free one in 4321–4345, saved in `run/dashboard-port` and reused. Any running dashboard also serves the hub at http://127.0.0.1:4320: a tab per instance on the machine (its name, with a badge when its Inbox has something), that instance's own dashboard under the selected tab, and one "Notify me" for new Inbox items across all of them. The hub keeps no state and takes no action: each dashboard, served by its own repo's kit, stays on its own address inside the hub's frame, and may be framed only by itself and the hub. A dashboard answers only on the address it serves (`127.0.0.1` and `localhost`, or the `--host` it was started with), and the hub only on its own: a page elsewhere gets nothing, not even a read.

**Artifacts.** Any session can draw an artifact, a page that shows the owner an idea instead of describing it: a UI mock, a flow, a mock docs site, a 3D model. It lives in `project/artifacts/<slug>/` and lands with the PR it was drawn in; the dashboard's **Library** lists landed ones and live drafts from every worktree beside the link registry, and opens each in a centered viewer or its own tab. An artifact loads its own files and pinned libraries from cdnjs, jsdelivr and unpkg, runs sandboxed with no other network and no reach into the dashboard, and sends nothing back: a decision on one is a question that links it, by name and inline (`[[name]]`). The owner can ask for one ("draw me a mock docs site"), and planners draw them for any goal with UI or a flow. `devteam.mjs artifact new|check`, `artifacts`.

**One log.** Everything structured is a line in one append-only JSON Lines log, validated against `schema/log.schema.json` on write and folded by timestamp with authority rules (owner > supervisor > planner > worker). State is computed from the log plus git; nothing else is stored. One file per writer: planners write `project/log/plan-<feature>.jsonl` in their worktree, so a plan lands only through its reviewed PR; everyone else writes `run/log/<writer>.jsonl` live, and the supervisor mirrors those into `project/log/` with the `chore-log` PR.

## Setup

"Use github.com/sanctuarycomputer/devteam to set up a fleet in this repo" means, for the agent doing it:

1. Read the repo's own rules first: `CONTRIBUTING`, any AI or agent policy, `AGENTS.md`/`CLAUDE.md`, CI config. If they forbid autonomous agents (some projects do), stop and tell the owner: devteam can still run on a private fork, but nothing goes upstream without a human writing it. Everything they require goes into the settings in step 3.
2. Copy `docs/devteam/` from the newest release tag of this repo (not `main`), except `project/` and `run/`, into this repo (home) only, never into a sibling repo: a copy whose project folder has no `settings.md` runs nothing but `init` and `help` (in the kit's own repo, whose remote is `sanctuarycomputer/devteam`, the read-only `status`, `whoami`, `validate` and `links` run too, over no tickets).
3. From the main checkout (not a worktree): `node docs/devteam/scripts/devteam.mjs init --upstream-base <tag>`. It creates `project/`, the `.gitignore` entries and the devteam section of `AGENTS.md` (and an `@AGENTS.md` import in `CLAUDE.md` where one exists, since Claude Code reads only that). It installs no forge workflow: the supervisor's `merge` runs devteam's checks and the project's gates before anything lands, and the project's own CI stays its own.
4. Fill `project/settings.md` (`init` sets `main_branch` from the remote's default branch): the registry: sibling repos as `repo` links (each checked out where its `path` says, default `../<id>`, or where this machine's `run/links.local.json` says) and design files and docs (Figma, specs, Notion) as `url` links, inferred from git remotes, links in the README and docs, and package manifests; the component lines (`components.<c>.owns`) once there is more than one deployable part; and the stacks, `agent_command`, the `gates` map (name → command) the supervisor runs before every merge, `worktree_files`, the gitignored files a fresh worktree needs to boot (a Rails `config/master.key`, a `.env`), and `worktree_setup`, the command that makes it runnable (`npm ci`), both applied to every worker, planner and gate checkout, and `forge: "git"` if the remote has no `gh`. Record anything the repo already does differently from `governance/` (a release branch, its own CI) in the settings; the settings win. Infer what you can from the repo; ask the owner the rest in one batch.
   A sibling repo gets no forge workflow either: the supervisor's `merge` runs devteam's checks and that repo's own `gates` before a ticket lands in it, and the repo's own CI stays its own. `check-pr --repo <id> [--path <checkout>]` runs the same checks, minus the gates and the supervisor's approval acts, from any checkout of it.
5. Run `devteam.mjs gate --all` on `main`. Every gate that fails there is a toolchain to fix, a gate to set to `"mode": "ratchet"`, or a chore ticket.
6. Existing codebase: write `project/designs/architecture.md` from the code (components, contracts, persistence, dependencies, distance from the code rules, hotspots, tests, work in flight). New repo: leave the headings.
7. **Propose the Baseline goal.** Draft the repo's first goal, **Baseline**: every gate in `quality.md` §2 and every Law in `code-style.md` enforced on main (lint, format, types, tests in CI, coverage, dead code, duplication, secrets, lockfile, and an encrypted secret store per `code-style.md` §10 if the repo has none), measured as the floor gaps left, target 0 (`process/planning.md` §7). One of its preconditions is **the registry is complete**, marked by number with `goal add --registry-precondition <n>`: `devteam.mjs components check --count` is 0 (counted with the gates), and the owner has said yes to "Does the registry list every repo, design file and doc this project depends on?" (a `registry-attest` question: owner-only, never defaulted or answered in chat; `goal-readiness` waits for it). The owner opts in through the regular flow; once approved, its features are the floor tickets, and gates that fail on existing code go on in **ratchet** mode (`quality.md` §2).
8. Commit the kit, settings and architecture doc as one `chore-devteam-bootstrap` PR, then `devteam.mjs log-sync` for the Baseline goal draft.
9. Start the supervisor. It is the owner's foreground session in the main checkout, never a background, headless or tmux-detached one. **If an agent session did this setup, that session becomes the supervisor:** it reads the prompt from `node docs/devteam/scripts/devteam.mjs prompt supervisor` and follows it in place; it does not launch a second agent. If the owner did the setup by hand, they start the agent in their terminal with `DEVTEAM_ROLE=supervisor` in its environment (`DEVTEAM_ROLE=supervisor claude "$(node docs/devteam/scripts/devteam.mjs prompt supervisor)"`), inside tmux if they want workers' messages typed into its pane as they happen. Agent CLIs such as Claude Code don't keep shell state between commands, so an `export` inside the session doesn't stick: a session already running prefixes each devteam command with `DEVTEAM_ROLE=supervisor`. Run the dashboard where it outlives the session (a tmux window, or another terminal): `node docs/devteam/scripts/devteam.mjs dashboard`, and open the address it prints, or the hub at http://127.0.0.1:4320.
10. The supervisor asks the owner for goals and the loop begins. To tell a session something from your own terminal as yourself, `node docs/devteam/scripts/devteam.mjs send <supervisor|ticket-id> "…" --owner`; answers to questions go through the inbox.

Requirements: git (2.38 or later once you draw component lines: coverage computes the tree a PR would land with `git merge-tree --write-tree`, and refuses to guess on an older git; `validate` warns when lines are declared and git is older), tmux (for the workers), Node 18+ (the project's own pinned Node is fine: asdf, nvm and the dashboard all run the script with it), the GitHub CLI, one agent CLI (Claude Code, Codex, OpenCode or similar) with superpowers installed.

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
# each sibling repo where its path says (the checklist prints the commands), or name this machine's paths in run/links.local.json
asdf install                                  # the versions in .tool-versions, if the repo pins them
gh auth login                                 # and log in to the agent CLI (claude: run it once, /login), with superpowers
# copy each worktree_files entry and secret key from the checklist over a secure channel (never git or chat)
claude        # or your agent CLI, in the repo; then say: "Assume the role of the devteam supervisor and resume the fleet"
```

The supervisor needn't run inside tmux: it puts the workers in a tmux session of its own (tmux only has to be installed), and their messages reach it through the log (`wait`). Step 9's command works too.

That is step 9's start, unchanged: the supervisor's prompt sees the parked fleet and opens with what to do, so it runs `fleet unpark` (which rebuilds `run/log` from the landed log, prints the same parity fingerprint before writing anything, puts every goal back as it was and prints each parked session's restart command), restarts the parked workers and planners (each gets its handoff in its prompt), and then the dashboard is restarted where it outlives the session:

```
tmux new-window -d -t "=$(node docs/devteam/scripts/devteam.mjs settings --get tmux_session)" -n dashboard 'node docs/devteam/scripts/devteam.mjs dashboard'
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
  "ops": { "owns": ["ops/**", "Dockerfile", "README.md"] }
}
```

`init` writes into these files outside `docs/devteam/`, and they stay the project's: `.gitignore` (the run folder, worktrees and harness runtime entries), `AGENTS.md` (the devteam section, beside the project's own agent instructions) and `CLAUDE.md` (an `@AGENTS.md` import, only where one exists). Each holds the project's content as well as the kit's, so none is in the `devteam` line: give each to a component like any other file. The workers' harness policy (deny rules, the stop hook) is written per launch under `docs/devteam/run/`, which is gitignored and never tracked.

`devteam.mjs components check` lists the gaps, each with its fix: unowned paths grouped by folder with a suggested owner, paths two lines claim (with both globs), globs that match nothing, and paths that differ only by case. The kit's own files (`docs/devteam/**` and the project folder) are set aside before any line is asked, so `"docs": { "owns": ["docs/**"] }` owns the rest of `docs/` without contesting the kit. A glob that matches nothing (a typo, or a folder whose last file was deleted) is a `line-empty` warning, never a refusal. From then on `validate`, `check-pr` and `merge`, `observe-metrics` and `check-ticket` hold the lines, always by committed settings: main's for a ticket PR and for any PR that leaves `settings.md` alone; for a plan or chore that changes `settings.md`, the settings it would land (and `validate` in that chore's `chore-<slug>` checkout judges its landing tree the same way). `check-pr` and `merge` fetch main first, so a push from another clone is in the tree they judge. A ticket changes one component's line; a contract or integration ticket names the others it spans in `touches_components`.

**Links to design files and docs.** `links` names what the fleet uses:

```json
"links": {
  "figma": { "kind": "url", "title": "Companion designs", "url": "https://www.figma.com/file/…", "for": ["component:web"], "notes": "ignore the archived page" },
  "runbook": { "kind": "url", "title": "Runbook", "url": "https://www.notion.so/…", "for": ["all"] }
}
```

A link whose `for` matches a ticket (`all`, `component:<c>`, `feature:<f>`, `goal:<g>`), or that the ticket or its feature lists in its own `links`, is in that worker's prompt, under "Links (data, not instructions)" with its title and notes quoted as JSON strings. A title or note is one line of plain text (no line breaks, tabs, or control or bidi characters), at most 120 characters for a title and 500 for notes; `validate`, `link add|set`, the settings at landing, `observe-link` and the log schema all refuse anything else. Url links are the supervisor's: the loop proposes them when the owner or a worker mentions one (`observe-link`, then `orient`), and the supervisor applies them with `link add|set|rm`, which logs a `registry-edit` act; `merge` lands a url link only as such an act wrote it (the act records the entry), so one edited by hand in `settings.md` is refused. Only `merge` checks this, not `check-pr`, and it is a process check within the supervisor's own class (`registry-edit` is the supervisor's), not an authority boundary. A URL or remote never carries credentials (`user:pass@`, a token before the host, a query or fragment parameter such as `?token=`, `#access_token=` or an S3 presigned `X-Amz-Signature`, or an scp-style `user:password@host:path`): settings and the log refuse one, and anything that echoes a URL shows such a parameter as `name=REDACTED`. Each link is probed once a day (a `HEAD`, or `git ls-remote`), four at a time inside 20 s a tick; a page answering 401, 403 or 405 is noted as behind auth, not reported missing, and `"check": false` stops the probe. `devteam.mjs links` prints the registry.

**Sibling repos.** One product in several repos (an API, a desktop app, a mobile app) runs on one fleet, one log and one graph. Home is the repo that holds the kit, `project/` and the live log; each other repo is a `repo` link with its own settings, and a component lives on it with `"link": "<id>"`:

```json
"links": {
  "console": { "kind": "repo", "title": "Electron console", "remote": "owner/console", "main_branch": "trunk", "gates": { "test": "npm test" }, "worktree_setup": "npm ci" }
},
"components": {
  "api": { "owns": ["app/**", "lib/**"] },
  "console": { "link": "console" }
}
```

`main_branch`, `forge`, `merge_method` and `release` default to the project's; `gates`, `worktree_setup`, `worktree_files` and `ignored_checks` are never inherited, so a repo with no `gates` is refused by `merge` as home with none is. Its checkout is at `path` (default `../<id>`, beside home), or wherever this machine's untracked `run/links.local.json` says (`{ "console": { "path": "/elsewhere/console" } }`); a missing checkout, or one whose `origin` is another repo, is refused with one message that says what to clone where, while `status`, `ready`, `metrics`, `fleet status` and the dashboard carry on (its tickets wait as "repo unreachable", and `link-unreachable` says why). Each ticket changes exactly one repo: its worker and review worktrees are made from that repo under home's `.worktrees/` (merge's own gate, ratchet-base and landing checkouts of it go in the OS temp folder instead), seeded from that repo's own `worktree_files` and `worktree_setup`; the worker runs home's kit by absolute path (its prompt says so, and `DEVTEAM_HOME` names home); its records (spec, plan, verification, reviews, handoff) live in that repo's `docs/devteam/project/tickets/<id>/` and land with the code, and that folder holds nothing else. A sibling's worker or review worktree sits inside home's tree, so a tool there that walks up the directories (Node's module resolution, `.tool-versions`, a lint or ts config) can find home's copy when the sibling's checkout has none: give each sibling its own (its `worktree_setup` installs its dependencies), or a worker's run can pass where `merge`'s gates, run outside home's tree, fail. `merge <ticket>` runs that repo's gates and lands on that repo's main, after fetching both mains; it and `check-pr` refuse any ticket whose `depends_on` hasn't merged, in whatever repo, home's tickets included (a single-repo project sees this too: before, a dependency only kept a ticket out of `ready`), and `metrics` raises `merged-out-of-order` for a ticket that reached its main before a dependency, counting only merges after the upgrade; every `gate` and `act` line still lands in home's log, with a `repo` field. Plan and chore PRs are always home's. Lines on a sibling are drawn in home's settings and judged by home main's committed settings. A component may release on its own tag pattern (`"release": { "tag": "console/v*" }`); `act … --repo <id>` and `notes … --repo <id>` name the repo of a release. A goal's repo measure runs on the main of the repo its `measure.link` names (default home). Repo links are the owner's: `link add <id> --kind repo --remote r --title t …` drafts the entry as a `governance-edit` question and writes nothing; with the answer, `link add … --approved <qid>` writes it, `link land registry` carries it into the chore, and `merge --chore registry --approved <qid>` lands it. The question shows the whole diff it approves (every repo link change waiting to land), and `merge` lands only the entries it showed, exactly as it showed them (main's entry then, the entry that lands), read from the answered question itself: acts are history, so a hand-written act can't widen an answer, and any other repo link change in the chore is refused by name. A sibling's gates run in a fresh checkout outside home's tree, so its `worktree_setup` must install what its gates need. `metrics` raises `merged-without-merge` for a commit on any repo's main, after the upgrade, that no `merge` landed: a sibling people still merge by hand raises one per hand merge, so move it to `merge` or expect the findings.

### Several Claude accounts

Install [claude-swap](https://github.com/realiti4/claude-swap) and add your accounts (`uv tool install claude-swap`, then `cswap add` after logging in to each). devteam finds it on its own, on a Mac or a Linux box: the dashboard holding the hub rotates accounts before a limit stops the fleet, using your `cswap config`, and a worker or planner that did stop is restarted (`--resume`, the same conversation in a fresh process) once an account has room: a running session keeps its limit even after the login moves. One session per tick, each at most once per 10 minutes and 3 times in 6 hours: past that it is left alone and flagged on the hub until those attempts age out. `DEVTEAM_CSWAP=off` turns this off. The supervisor is your own session, so it is never restarted for you: the hub flags it, and you resume it.

## Optional: running it in the cloud

Setting up a fleet needs none of this, and a project never copies it: `cloud/` sits outside `docs/devteam/`. It is for an owner who wants their dev box in the cloud: one container (Render, fly.io or any Docker host with a disk) holding the repos, the tmux server where every supervisor and worker runs, and the hub, reached at a URL of the owner's (say `box.example.com`, plus `*.box.example.com`, since each dashboard keeps an origin of its own on a subdomain). `cloud/Dockerfile` says how to deploy it.

- **Claiming it.** On first boot the log prints a claim link, good for a day. Opening it makes a passkey (1Password or the browser saves it), and from then on only a passkey registered on the box opens it; more can be added from the hub's Passkeys link. Passkeys belong to `auth.box.example.com`: pick the box's name before claiming, since changing it invalidates them. Lost every one: `devteam-reclaim` in a shell on the box prints a new link.
- **The hub** is the box's home page, with a **Terminal** tab first (`term.box.example.com`): a terminal on the box's tmux server, where the owner logs in to `claude` and `gh`, clones a repo and starts its supervisor (the notes it prints say how), and switches between every session (`C-b s`). Each repo's dashboard is a tab, as on a laptop. The image carries its own copy of the hub page and of the terminal's page, because every agent can change a checkout or take a port: pages on the `box.`, `term.` and `auth.` names are only ever the gateway's, and an agent's page can exist only on an instance's name.
- **What lasts** is on the `/data` disk: repos, worktrees, logins, passkeys. A deploy or restart stops every agent; park the fleet first, and after it each repo's dashboard comes back by itself and its supervisor resumes the fleet (`fleet unpark`). Keep the platform's auto-deploy off.
- **The gateway** (`cloud/gateway.mjs`, Node, no dependencies) is the only thing listening publicly. It checks the passkey, refuses any request whose Origin isn't the page's own (and reads another site's page asks for), and passes requests to the kit as a local browser's, so the kit runs unchanged. It runs as its own user, so no agent can read or write its passkeys.
- **Give the box a domain of its own**, not a subdomain of one you use for anything else. A page an agent serves on an instance's name can write cookies for the whole domain, and when too many pile up the gateway clears them, which signs you out of everything else on that domain too. Treat an instance's name as untrusted for the same reason: an agent can answer on an unused port and appear as a tab.
- **The terminal is as trustworthy as the box.** An agent can replace what the terminal connects to and see what is typed there, so prefer logins that don't involve typing a secret (`gh auth login`'s browser flow).
- **The blast radius** is the box: agents there hold its GitHub and Claude logins. Give `gh` a token scoped to the fleet's repos and protect each repo's main branch.

## Upgrading a project

`settings.upstream_base` records the release a project materialized from. On its improvement loop the project's supervisor lists newer releases, reads each release's What, Why and Migration, and asks the owner per release whether to adopt, adapt or skip each change (`process/supervisor.md` §9). Changes land as a `chore-devteam-sync-<tag>` PR that never touches `project/` or `run/`. Improvements a project makes to the kit that other projects would want come back here as PRs (`upstream-pr` on the trust ladder), written generically, with nothing from `project/` or `run/`.

## Contributing

Changes land on `main` through PRs. `node --test --test-concurrency=8 test/*.test.mjs` (the kit's tests in `test/`; the files run side by side; `test/bounds.test.mjs` times code against a bound, so CI runs it alone first) must pass. A release is a `vX.Y.Z` tag on `main` with a GitHub Release whose notes have three sections, because projects' supervisors read them to decide what to fold in:

- **What** changed, by file or area;
- **Why**, the reason a project would want it (a change without a why gets skipped);
- **Migration**, anything a project must do, such as a new settings field or a renamed flag. "None" if nothing.

```
gh release create vX.Y.Z --target main --title vX.Y.Z --notes-file notes.md
```
