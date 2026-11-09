# Public artifacts: an owner can publish a landed artifact to anyone

Date: 2026-11-09. Builds on `2026-11-05-artifacts-design.md` (artifacts and the Library) and the cloud gateway (`cloud/gateway.mjs`). It replaces that spec's non-goal "No hosted sharing" with a narrow, owner-controlled form of it.

## Goal

The owner can make a landed artifact readable by anyone, with no sign-in, at a stable address on their cloud box:

```
https://public.<box>/<project>/<slug>/
```

- **Immediate.** Publishing is one click in the dashboard's Library. No PR, no merge.
- **Durable.** Whether an artifact is published is a line in the log, so it moves with the fleet like everything else (`fleet park` lands the log; `fleet unpark` rebuilds it).
- **Pinned.** The public sees exactly the bytes the owner published. A later change to the artifact on main doesn't reach the public until the owner publishes again.
- **Verified by the gateway.** Every process on the box can listen on a dashboard port, so the gateway never vouches for bytes it was not told about by the owner. It serves a public file only when its sha256 matches a pin list it recorded from an owner-authenticated request.

## Non-goals

- **Drafts are never public.** Only an artifact landed on main can be published.
- **No public index.** `public.<box>/` and `public.<box>/<project>/` list nothing.
- **No new authority for agents.** Publishing and unpublishing are the owner's alone. The supervisor, planners and workers can't publish, and nothing an agent writes widens what the gateway serves.
- **No hosting off the box.** Public pages are served by the owner's box. A box that is down serves nothing.
- **Nothing changes for local use** beyond the Library buttons and the kit route; without a gateway, `/public/…` is reachable only on the loopback dashboard like every other route.

## Design

### 1. The record: an owner `act` of class `artifact-publish`

Publishing writes one owner line:

```json
{ "type": "act", "class": "artifact-publish", "what": "publish", "refs": ["artifact:index-greenpoint"],
  "artifact": "index-greenpoint", "tree": "<git tree id of the artifact's folder on main>", "by": "owner", "channel": "dashboard" }
```

Unpublishing writes the same with `"what": "unpublish"` and no `tree`. The newest `artifact-publish` act for a slug wins (sorted as `fold` sorts: `at`, then file, then line).

Schema and authority changes:

- `log.schema.json`: `act` gains `artifact` (the slug, `LINK_ID`) and `tree` (`^[0-9a-f]{40}([0-9a-f]{24})?$`). `x-authority.new.owner` gains `act`.
- `integrity()`: an owner-created `act` is accepted only with `class: "artifact-publish"`, `what` in `publish | unpublish`, `artifact` set, and `tree` set exactly when `what` is `publish`. Any other owner act is refused. A non-owner `act` of class `artifact-publish` is refused ("artifact-publish is the owner's").
- `constitution.md`: `artifact-publish` joins `owner_only`, with one sentence in "Three kinds of decision".
- `calls()` and `decisionRecords()` skip acts whose `created_by` is `owner`. Publishing is not a supervisor call and earns or costs no trust.

### 2. The kit

**Commands.**

- `artifact publish <slug> --owner`: refuses unless `<slug>` is landed on `mainRef()` and passes `artifactProblems` on its tree entries. Records the folder's tree id (`git rev-parse <mainRef>:<ARTIFACTS_REL>/<slug>`). Publishing an already-published slug whose tree hasn't changed is a no-op with a message; with a changed tree it re-pins.
- `artifact unpublish <slug> --owner`: refuses when the slug isn't published.
- Both refuse without `--owner` (`ownerWriter()`, so they die under any `DEVTEAM_ROLE`).
- `artifacts` (and `--json`) shows each published slug's pinned tree and whether main has moved on since (`stale`).

**Dashboard action.** `ACTIONS['artifact-publish'] = (b) => LINK_ID.test(b.slug) && ['publish','unpublish'].includes(b.op) ? ['artifact', b.op, b.slug, '--owner'] : null`, under the same host, origin and content-type checks as `goal-hold`.

**Library.** `describeArtifact` for a landed artifact gains `published: { tree, at, stale } | null`. The landed card shows:

- **Publish** when not published;
- **Published** with **Update** (only when `stale`), **Copy link** and **Unpublish** when published.

The link is `https://public.<box>/<project>/<slug>/`. The page derives `<box>` from its own address when it is served through the gateway (`location.hostname` is `<port>.<box>`); on a loopback dashboard it shows the path part and says it is served by the cloud box.

**Route `GET|HEAD /public/<slug>/<rel>`.** Raw-path matched like `/artifact/`, same `okHost`, same `artifactPathOk`, same trailing-slash redirect and `index.html` default. Serves `git cat-file blob <tree>:<rel>` from the pinned tree, so the bytes never follow main. 404 when the slug isn't published, the path isn't in the tree, or the tree is no longer reachable (main's history was rewritten). Headers as for `/artifact/` with `frame-ancestors 'none'` and `self` the request's own `/public/<slug>/`.

**Route `GET /public.json`.** The pin list for this instance, built from the pinned trees (cached by tree id under `run/cache/`):

```json
{ "public": 1, "project": "stacksbot",
  "artifacts": [ { "slug": "index-greenpoint", "tree": "…", "files": { "index.html": { "sha256": "…", "size": 51234 } } } ] }
```

`project` is `loadSettings().project` (the name `helloBody()` already reports). It is only answered on `okHost` with `sec-fetch-site` absent or `same-origin`, like the dashboard's data.

### 3. The gateway

**A new name.** `PUBLIC = <scheme>//public.<box>`, `publicHost`, beside `TERM`. Covered by the existing `*.box` DNS and certificate. `public` can't collide with an instance name, which is all digits.

**Pins, in the gateway's own store.** `state.json` gains `pins: { "<project>": { port, at, artifacts: { "<slug>": { tree, files: { "<rel>": { sha256, size } } } } } }`.

- **Recorded only from an owner-authenticated request.** When the gateway proxies a signed-in request on an instance name, and it is either a successful `POST /api/artifact-publish` or a `GET /api/data` (at most once a minute per port), it fetches `/public.json` from that same port as a same-origin loopback request and replaces that project's pins with the answer, recording the port.
- The trust in the pin list is the trust the owner already gives the dashboard they are looking at: it comes from the port they are signed in to and using.
- An unpublish removes the slug at the next refresh, which the unpublish POST itself triggers.
- **Validation.** `public.json` is parsed with a size cap (1 MB), `project` must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, slugs `LINK_ID`, rels `artifactPathOk`, sha256 64 hex, size within the artifact limits. Anything malformed leaves the existing pins alone and is logged.
- **After a box move** the new box's gateway starts with no pins. Public links come back the first time the owner opens that project's dashboard on the new box (its `/api/data` refreshes the pins). The publish record itself arrived with the log.

**Serving `public.<box>`.** Before the cookie and session handling:

- `GET` and `HEAD` only, else 405. Service-worker requests 403, as for instances.
- Path `/<project>/<slug>/<rel>` (raw path; `..`, `%2e`, `%5c` and `\` refused). `/<project>/<slug>` redirects to the trailing slash. `/` and `/<project>/` are 404.
- Look up the pin. 404 when the project, slug or file isn't pinned.
- Fetch `http://127.0.0.1:<pin.port>/public/<slug>/<rel>` with a loopback host header, no cookie, no forwarded headers. Buffer at most the pinned size. 502 "this page has changed since it was published" when the status isn't 200, the length differs, or the sha256 doesn't match. Nothing unverified is ever sent.
- Respond with the gateway's own headers only: `content-type` from the gateway's copy of the kit's extension map, `content-length`, `cache-control: no-cache`, `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, HSTS, and the gateway's own CSP: the artifact policy (CDN list duplicated from the kit, a test asserts they match) with `self` set to `https://public.<box>/<project>/<slug>/`, `frame-ancestors 'none'` and the same `sandbox` directive. No `set-cookie`, ever.
- The incoming `Cookie` header is never forwarded, and the owner's session cookie (domain-wide) is ignored on this name.

## What closes the port risk

An impostor listening on a dashboard port can, at most, serve the exact bytes the owner pinned (anything else fails the sha256 check) or nothing (502). It can't add files, change files or make an unpublished artifact public. The only moment a port is trusted is while the owner is signed in and using it, which is the trust the gateway already extends today.

## Testing

- **Kit (chain tests, `test/lib/chain.mjs`):** publish refuses a draft, an unlanded slug, a broken artifact, and any caller without `--owner`; publish writes an owner act with the tree; republish with the same tree is a no-op; `/public/<slug>/` serves pinned bytes after main changes the artifact; 404 after unpublish and for paths outside the tree; `/public.json` lists sha256s that match the bytes; `published.stale` in the Library data; a supervisor `act --class artifact-publish` is refused; owner acts are absent from `calls()` and `decisionRecords()`.
- **Schema:** an owner act of any other class is refused by `integrity()`.
- **Gateway (`test/gateway.test.mjs`):** no pin → 404; owner publish through the gateway → anonymous GET 200 with the gateway's CSP and no `set-cookie`; HEAD works, POST 405; an upstream that changes the bytes after pinning → 502; a path not in the pin → 404; the cookie isn't forwarded; unpublish → 404; `/api/data` refresh is throttled per port; malformed `public.json` leaves pins unchanged; `public.<box>/` and `/<project>/` are 404; the gateway's CDN list matches the kit's.

## Docs

`README.md` (tree comment, Artifacts paragraph, the cloud section's names and gateway bullet), `process/supervisor.md` §Artifacts (publishing is the owner's; never put anything in an artifact you wouldn't publish), `constitution.md`, `log.schema.json` descriptions, `cloud/Dockerfile` header names, the kit's `HELP`, and this spec replaces the artifacts spec's "No hosted sharing" line with a pointer here.
