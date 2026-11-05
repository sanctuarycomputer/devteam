# devteam hub: one page for every instance on a machine

Date: 2026-11-04. Status: design approved in conversation, awaiting the owner's review of this spec.

## Goal

When one or more devteam instances run on a machine, `http://127.0.0.1:4320` lists them. Each instance appears as a card whose button is its repo root path, and the button opens that instance's own dashboard, served by that repo's own kit (which may be a different release, or a local copy of the kit). Later, the same hub page is the root of a hosted deployment (fly.io, Render). This spec builds the local hub and keeps the hosted case in mind; it does not build the hosted case.

## Non-goals

- No hostname. `devteam.local` was considered and dropped: an `/etc/hosts` line needs sudo, and mDNS publishes the machine's LAN address. The hub is a fixed loopback port.
- No machine-wide state. There is no registry file, no `~/.devteam/`, no heartbeat. An instance is listed exactly when it answers.
- No proxying. The hub never relays a dashboard's pages or API. Each dashboard stays on its own origin.
- No hosted deployment. Exposing a dashboard beyond loopback changes who counts as the owner. That needs authentication, which is a trust-model decision for the owner and a later spec.

## Why the hub only links

The dashboard trusts a request because it reaches loopback. It allows only a `Host` of `127.0.0.1:<port>` or `localhost:<port>` (the DNS-rebinding guard), and owner actions must be same-origin. If the hub proxied every dashboard under one origin, a page from one project could call another project's owner API. So each card links to `http://127.0.0.1:<port>/`, the instance's own origin. The hub has no POST routes, holds no state, and can do nothing for the owner.

## Design

### 1. Each instance gets its own port and tmux session

These are prerequisites, and they also fix today's collisions: two projects sharing the `devteam` tmux session, where window names like `plan-<feature>` or `dashboard` clash and `send <id>` could type into the other project's worker, and two dashboards fighting over 4321.

- **Port.** `dashboard_port` defaults to `null`. With an explicit number, the dashboard uses that and nothing else. With `null`:
  1. If `run/dashboard-port` holds a port and it is free, use it. This keeps the owner's bookmark stable.
  2. Otherwise, scan 4321–4345 (as in §3). Take the port after the highest one that answers as devteam, skipping any port that something else holds.
  3. If that runs past 4345, take the lowest free port in the range.
  4. If all 25 are taken, stop with a message naming the range and saying how to pin a port.
  5. Save the chosen port to `run/dashboard-port`.
- **Pinned outside the range.** A pinned port outside 4321–4345 works, but the dashboard warns once at start that the hub won't list it.
- **tmux session.** `tmux_session` defaults to `null`, meaning use the session saved in `run/tmux-session`. If none is saved, use `devteam-<project name>` (the project name from `init --name`, slugged) and save it.
- **Migration, so a running fleet keeps what it has.** When the setting is `null` and `run/tmux-session` doesn't exist yet:
  - If a tmux session named `devteam` exists with a window named after one of this project's live sessions (a ticket id or `plan-<feature>`), save `devteam`.
  - Likewise for the port: when the setting is `null`, `run/dashboard-port` doesn't exist, and this project's dashboard is answering on 4321 (its `/api/hello` returns this repo root), save 4321.

  Stacks therefore keeps `devteam` and 4321 with no change. A new project gets `devteam-<name>` and the next free port.
- **Machine-local files.** `run/dashboard-port` and `run/tmux-session` join `RUN_KNOWN`. Both are machine-local, so `fleet status` neither blocks a move on them nor lists them to copy. A new machine picks its own.
- **Every command uses the resolved session name** (`worker`, `planner`, `send`, metrics, the pane checks), via one helper, never the raw setting. `supervisor.md` §11's dashboard restart command names the project's session (`devteam.mjs settings --get tmux_session` resolves it).

### 2. `/api/hello`

Each dashboard answers `GET /api/hello`:

```json
{ "devteam": 1, "root": "/Users/…/stacks", "name": "stacks", "port": 4321,
  "kit": "v0.18.1", "inbox": 3, "fleet": { "mode": "run", "workers": 4 } }
```

- `kit` is `settings.upstream_base` (such as `v0.18.1`), with `+local` appended when the kit that is running differs from the kit committed on the project's main: the kit's files outside `project/` and `run/`, compared by git blob. That happens with uncommitted edits, a branch's kit, or `DEVTEAM_OWN_KIT=1`. It is computed once, at start, offline, and is never compared with upstream over the network.
- `inbox` is the number of open owner questions. `fleet.mode` is `run`, `drain` or `park`. `fleet.workers` is the number of live worker and planner sessions.
- It is built from the dashboard's most recent `/api/data` result, which the dashboard already computes and caches. `/api/hello` never recomputes (on a long log that takes 13–47 s). Before the first result exists, `inbox` and `fleet` are `null`.
- It sits behind the same `Host` guard as every dashboard route, so only `127.0.0.1:<port>` and `localhost:<port>` get an answer.

### 3. The hub

- **Who serves it.** Every `devteam.mjs dashboard` process also tries to listen on `127.0.0.1:4320`. The one that succeeds serves the hub. The others retry every 30 s, so when the hub's dashboard exits, another takes over within 30 s. Nothing is installed, and the hub disappears when no dashboard runs.
- **If 4320 is held by something else** (a `GET /instances.json` there doesn't return a devteam hub's shape), the dashboard logs once that the hub port is taken and stops retrying until it restarts.
- **The scan.** On each request for `/` or `/instances.json`, the hub probes `http://127.0.0.1:<p>/api/hello` for every p in 4321–4345, all at once, each with a 300 ms timeout. Closed ports refuse instantly, so a scan takes well under a second. A port counts when it answers 200 with JSON whose `devteam` is 1. Answers with an unknown higher `devteam` value are listed with only their `root` and `port`. The scan runs on the hub server, so the owner's browser never sends requests to the other ports, and no page on another site can make it probe them.
- **Routes.** `GET /` is a self-contained page in the dashboard's look (`devteam-ui.css`), which polls `GET /instances.json` every 10 s. `GET /instances.json` returns the scan as `{ "hub": 1, "instances": [...] }`, sorted by root. Every other path and method is a 404 or 405.
- **Host guard.** The hub answers only to a `Host` of `127.0.0.1:4320` or `localhost:4320`.
- **The card.** Shows the repo root as the button (linking to `http://127.0.0.1:<port>/`, the target opening in the same tab), the project name, the kit version (badged when it carries `+local`), the Inbox count (highlighted when above 0), and the fleet state (mode, worker count).
- **Versions.** The hub's page comes from whichever kit won 4320. Instances running other kit versions still list correctly, because `/api/hello` is versioned (`devteam: 1`) and tiny. A newer field an older hub doesn't know is ignored.

### 4. Errors and edges

- An instance that is starting answers with `inbox: null`. Its card shows "starting" instead of counts.
- A dashboard on a pinned port outside the range is not listed. Its own start-up warning says so.
- Anything else answering `/api/hello` in the range with `devteam: 1` is listed. That's acceptable: a local process could already read the owner's files, and a card is only a link.
- A slow instance (over 300 ms) is left out of that scan and reappears on the next poll.

### 5. Later: the hosted hub (not built here)

On a hosted machine, the same hub page is the deployment's root, and instances are reached through it. That requires an authentication layer in front of both the hub and every dashboard, because "it reached me" no longer means "it is the owner". It probably also requires a proxy with one origin per instance (subdomains). The owner decides that trust model in its own spec. Nothing here blocks it: `/api/hello` and `/instances.json` are the contract.

## Testing (kit test, in fixtures, never against a live fleet)

- Two fixture projects start dashboards. Each takes its own port by the "+1" rule (the second gets the first's port plus 1), saves it, and reuses it on restart. Each gets its own tmux session, `devteam-<name>`.
- A port in the range held by a plain listener is skipped.
- A dashboard pinned outside the range warns.
- The hub on 4320 lists both instances with root, kit, inbox and fleet.
  - One instance runs from a modified kit copy and shows `+local`.
  - Killing the hub's dashboard moves the hub to the other within 30 s. The test uses a shortened retry interval through an env var, only in tests.
- The hub refuses a foreign `Host` and has no POST routes.
- `/api/hello` doesn't recompute: it returns `null` counts before the first data result.
- Migration: a project with a live log and a `devteam` tmux session holding its window saves `devteam`, and one answering on 4321 saves 4321.
- The tests use ports outside the real range (an env override for the range base), so a test never collides with, or lists, a real instance on the machine.

## Migration (for the release notes)

None for a running project. A project with a live fleet keeps its tmux session `devteam` and its dashboard port, both saved on first start. New projects get `devteam-<name>` and the next free port in 4321–4345. The owner's new bookmark is `http://127.0.0.1:4320`.
