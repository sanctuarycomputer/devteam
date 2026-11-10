# Public artifacts: an owner can publish a landed artifact to anyone

Date: 2026-11-09. Builds on `2026-11-05-artifacts-design.md` (artifacts and the Library) and the cloud gateway (`cloud/gateway.mjs`). It replaces that spec's non-goal "No hosted sharing" with a narrow, owner-controlled form of it.

## Goal

The owner can make a landed artifact readable by anyone, with no sign-in, at a stable address on their cloud box:

```
https://public.<box>/<project>/<slug>/
```

- **Immediate.** Publishing is a click in the Library and a confirm on the gateway's own page. No PR, no merge.
- **Durable.** Each publish and unpublish is an owner line in the log, so the record moves with the fleet. On a new box, the Library shows what was published and isn't live there yet, and one confirm page lists all of it, each item for the owner to tick.
- **Pinned.** The public sees exactly the bytes the owner confirmed. A later change to the artifact on main reaches the public only when the owner publishes again ("Update").
- **Only the owner, only through the gateway's own page.** Every process on the box runs as the owner's user: it can write log lines, take a dashboard port, and run script on that port's origin with the owner's session cookie. So nothing on an instance's name can publish. Publishing happens only on a page the gateway serves itself on the box's name, from bytes it holds, after the owner confirms what they are publishing.

## Non-goals

- **Drafts are never public.** Only an artifact landed on main can be published.
- **No public index.** `public.<box>/` and `public.<box>/<project>/` list nothing.
- **No new authority for agents.** Agents can't publish, can't change what is published, and can't make the gateway serve anything it didn't verify at the owner's confirm. An agent that forges log lines changes, at most, what the Library *says*, and the Library takes "live" from the gateway, not the log.
- **No automatic restore after a box move.** Restoring is one owner confirm, for the reason above.
- **Nothing public without a gateway.** On a laptop, the Library shows publish state and says publishing happens on the cloud box.

## Design

### 1. The record: an owner `act` of class `artifact-publish`

When the gateway completes a publish, it has the kit write one owner line:

```json
{ "type": "act", "class": "artifact-publish", "what": "publish", "refs": ["artifact:pricing-mock"],
  "artifact": "pricing-mock", "tree": "<git tree id of the artifact's folder that was published>", "by": "owner", "channel": "dashboard" }
```

Unpublishing writes the same with `"what": "unpublish"` and no `tree`. For each slug the newest line (fold order: `at`, file, line) is its recorded state.

The log line is the durable **record** of the owner's intent. It is not what the gateway serves from, and the gateway never reads it: a forged line can't make anything public.

Schema and authority:

- `log.schema.json`: `act` gains `artifact` (the slug, `LINK_ID` pattern) and `tree` (`^[0-9a-f]{40}([0-9a-f]{24})?$`). `x-authority.new.owner` gains `act`. The `act` description says owner acts exist and are only `artifact-publish`.
- `integrity()`: an owner-created `act` is accepted only with `class: "artifact-publish"`, `what` in `publish | unpublish`, `artifact` set, and `tree` set exactly when `what` is `publish`. Any other owner act is refused. A non-owner act of class `artifact-publish` is refused ("artifact-publish is the owner's").
- `constitution.md`: `artifact-publish` joins `owner_only`, with a sentence in "Three kinds of decision".
- Consumers of acts that assume the supervisor wrote them skip owner acts (`created_by === 'owner'`): `calls()`, `decisionRecords()`, and the dashboard's acts view (the `actAuthority` list in `dashboardData`). `correct` refuses an owner-created act. Publishing earns or costs no trust and isn't a supervisor call.

### 2. The kit

**`artifact publish <slug> --owner --tree <t>` / `artifact unpublish <slug> --owner`.** Write the line above. Both use `ownerWriter()`, so they die under any `DEVTEAM_ROLE`. `publish` refuses unless `--tree` equals the tree of `<slug>` on `mainRef()` and that tree passes `artifactProblems`; it does not fetch (the gateway's call must return quickly, and the manifest it confirmed was read from the same `mainRef()`). `unpublish` refuses a slug whose recorded state isn't `publish`. Run by hand on the box, they record intent only and say so: the gateway's confirm page is what makes a page public.

**Dashboard action.** `ACTIONS['artifact-publish'] = (b) => LINK_ID.test(b.slug ?? '') && (b.op === 'unpublish' || (b.op === 'publish' && TREE.test(b.tree ?? ''))) ? ['artifact', b.op, b.slug, '--owner', ...(b.op === 'publish' ? ['--tree', b.tree] : [])] : null`, under the same host, origin and content-type checks as `goal-hold`. Only the gateway calls it on a cloud box (§3), and the Library's Forget; the Library has no button that publishes.

Those checks stop another site's page. They don't stop a process on the box: the route has no way to see who is asking, and a request with no `Origin` and no `sec-fetch-*` is exactly what the gateway's own loopback call looks like. That holds for every owner route (`answer`, `goal-hold`, `fleet` and the rest), which is why agents can only be kept out of a publish by what the gateway checks, not by this route. A line written this way is identical to a real one, `channel: "dashboard"` included, so nothing downstream may treat a record as proof the owner published. It can make the Library ask, and never makes the gateway serve anything (§ Why this closes the port risk).

**`GET /public-manifest/<slug>`.** `okHost`, and refused when `sec-fetch-site` is present and not `same-origin` (the gateway's loopback request sends none). For a slug landed on `mainRef()` whose tree passes `artifactProblems`:

```json
{ "public": 1, "project": "acme-site", "slug": "pricing-mock", "title": "…", "summary": "…",
  "root": "/srv/acme-site", "tree": "<tree id>",
  "files": { "index.html": { "sha256": "…", "size": 51234, "mode": "100644" } },
  "recorded": { "tree": "<tree id>", "at": "…" } }
```

- `files` comes from `git ls-tree -r -l <tree>` and `git cat-file blob` of each, hashed with sha256, cached by tree id under `run/cache/`. Each file carries its git `mode`, `100644` or `100755` (the gateway recomputes the tree id, and a mode is part of it); any other mode is refused. A tree holding a submodule is refused ("a submodule isn't served").
- `project` is `settings.project`. Publishing needs it set explicitly (the folder-name fallback `helloBody()` uses would change every public URL on a re-clone): the kit refuses with 409 and the fix ("set project in settings.md") when it is unset or doesn't match `^[a-z0-9][a-z0-9._-]{0,62}$`.
- `root` is the main checkout's realpath, the same value the hub lists; the gateway binds a project to it.
- `recorded`, present when the log's newest line for the slug is a publish, is that line's `tree` and date. It is part of the manifest the owner confirms and is never relied on.
- 404 for a draft, an unknown slug or a broken artifact (with the reason).

**Library.** Each landed row gains `tree` (from `landedArtifacts`' `ls-tree`). Publish state is computed where the Library rows are assembled (`dashboardData`), never inside `describeArtifact` or its tree-keyed cache: `published: { tree, at, channel } | null` from the newest owner `artifact-publish` line. The card shows the line's date and channel beside its state; neither tells a real line from a forged one (§2). When `tree` differs from main's, the card warns that main has changed since it was published, and a Not live card offers **Review main's version** in place of **Restore**.

The page also reads `x-devteam-public` from the `/api/data` response: the gateway's whole public map, `{ "<project>": { "port", "root", "artifacts": { "<slug>": "<tree>" } } }`, set by the gateway (§3). It is absent on a laptop. The Library matches on its own project and root (it knows both), so a port change doesn't confuse it, and it shows "Public from instance <port>" when another port last published it. For a landed card:

| log says | gateway serves | card shows |
|---|---|---|
| not published | — | **Publish** |
| published | same tree as main | **Public** · Copy link · Unpublish |
| published | a different tree than main | **Public** · **Update** · Copy link · Unpublish |
| published, same tree as main | nothing | **Not live on this box** · Restore · Forget |
| published, tree differs from main | nothing | **Not live on this box**, with a warning · Review main's version · Forget |
| not published | something | **Public** (the gateway is the truth) · Unpublish |

- On a laptop (no header), cards say **Published** or nothing, and a note says publishing happens on the cloud box.
- **Publish**, **Update** and **Restore** open `https://<box>/public/publish?port=<p>&slug=<s>` in a new tab (`rel="noopener noreferrer"`, so the opener can't later redirect that tab). **Restore all** (shown above the list when any card is "Not live"; **Review all**, with a warning, when any of them differs from main) opens the same page with every such slug (`&slug=a&slug=b`). **Unpublish** opens `https://<box>/public/unpublish?port=<p>&slug=<s>`.
- **Forget** records `unpublish` through the kit's own action (no gateway change; the page is already not live), for a line the owner doesn't want to restore.
- The page derives `<box>` and `<p>` from its own address: through the gateway, `location.hostname` is `<p>.<box>`.

### 3. The gateway

**Names.** `PUBLIC = <scheme>//public.<box>` and `publicHost`, beside `TERM`. Covered by the existing `*.box` DNS and certificate; it can't collide with an instance name, which is all digits.

**The store.** Published bytes live under the gateway's own directory, content-addressed: `<dir>/public/blobs/<sha256>`. `state.json` gains:

```json
"public": { "<project>": { "root": "/home/box/acme-site", "port": 4322, "artifacts": { "<slug>": { "tree": "…", "title": "…", "at": "…", "files": { "<rel>": { "sha256": "…", "size": 51234 } } } } } }
```

- A project is bound to its instance's `root`; `port` is where it was last seen.
- **One writer at a time.** Every `/public/*` mutation runs through one in-process queue (a promise chain). Nothing that waits on an instance's bytes runs inside it: a publish item fetches its manifest and files and verifies them first, within one budget for the whole item (120 s; each request gets the lesser of its 15 s deadline and what is left), and is refused when that runs out. Inside the queue: check the binding and the cap again against fresh state, write blobs as `<sha256>.<pid>.<random>.tmp` then rename, then load, mutate and save `state.json` with no `await` in between, then garbage-collect blobs that the just-saved state doesn't reference.
- Total public bytes (the sum of unique blob sizes) are capped by `DEVTEAM_PUBLIC_MAX` (default 500 MB; a value that isn't a positive number stops the gateway at startup); a publish that would pass it is refused before anything is written.

**`GET https://<box>/public/publish?port=<p>&slug=<s>[&slug=…]`** (box name, signed-in owner, `PAGE_CSP`, the gateway's own page):

- `<p>` must be in the instance block, each slug `LINK_ID`, at most 50 slugs.
- The gateway fetches `http://127.0.0.1:<p>/public-manifest/<slug>` as a loopback request with no `origin` or `sec-fetch-*` headers (as `hubList` does), with a 15 s deadline for the whole response, and validates it: size cap 2 MB, `project` pattern, `root` an absolute path, slug equal to the one asked, `tree` 40 or 64 hex, at most 2000 files, each rel passing the kit's `artifactPathOk`, `sha256` 64 hex, sizes within the artifact limits (8 MB a file, 25 MB an artifact).
- It renders, per slug: a checkbox, the project, the slug, the title, the file count and total size, the root as the instance reports it, every file by name, the public URL it will have, and one of **not on this box**, **already public at this version** or **an update** (the gateway serves this slug with another tree). An update says what changed against the gateway's copy, file by file. These labels come only from the gateway's own state, never from the query string.
- **The tick follows the gateway's copy.** An item is ticked only when the gateway holds a copy for this project and root. **Not on this box** is unticked, whether or not the log claims it was published, and its page says so. The gateway can't tell a restore from a first publish, since both reach it from a link on an instance, so it uses neither word for what it can't check. The manifest may carry `recorded: { tree, at }`, the log's newest publish of that slug: the page quotes it as what the instance's log says ("published on <date> at tree <t>; this is tree <u>, what main holds now"), never as proof. It can't show what changed from a tree it holds no copy of, and says that too. Every value is HTML-escaped. The Publish button has no autofocus.
- **Project binding.** When the project is bound to a different `root`, the page says so ("<project> is published from <old root>; this instance is <root>") and the item carries an explicit "move it" checkbox, unchecked. Without it, that item is refused. A different port with the same `root` is not a move; the gateway just updates `port`.
- A "move it" names the other pages of the old checkout that come down with it ("move it (its 1 other page from /srv/one comes down: m2)"), and carries the old root it showed as `movedFrom`; the POST refuses a move when the project is now bound to any other root ("this project moved since you looked; reload the page"). A move's result is never an update.
- Each item carries `manifest: <sha256 of the canonical JSON of the manifest it rendered>`. The Publish button posts the checked items, `{ port, items: [{ slug, manifest, move, movedFrom }] }`, with `fetch` (the page's own script; `form-action 'none'` stays).

**`POST https://<box>/public/publish`.** The existing rule already refuses any non-GET whose `Origin` isn't the box. Signed-in owner only. For each item:

1. Fetch the manifest again from `<p>`; refuse when its canonical sha256 differs from the confirmed `manifest` ("this changed since you looked; reload the page"). That binds the project, root, title, tree and every file to what the owner saw. Then check the binding.
2. Fetch each file from `http://127.0.0.1:<p>/artifact/main/<slug>/<rel>` (no cookie, loopback headers, the same 15 s deadline), streaming with the manifest's size as a hard limit, and check its sha256.
3. Compute the git blob ids and the tree id of the folder from the bytes and paths (git's object format, sha1 or sha256 by the length of `tree`) and refuse unless it equals `tree`. The record then names a tree git can check against main.
4. Write each blob, then ask the kit to record it: `POST http://127.0.0.1:<p>/api/artifact-publish {op:'publish', slug, tree}` as a loopback request with `content-type: application/json` and no `origin`. If the kit refuses, the item is refused and its new blobs are dropped.
5. Then update `state.json` (binding the project to `root`, `port` = `<p>`) and garbage-collect.

Any failure refuses that item only; nothing from it is kept.

The response lists each item's result and public URL; the page shows them.

**`GET /public/unpublish?port=<p>&slug=<s>` (or `?project=<n>&slug=<s>` from the gateway's own list) and `POST /public/unpublish`.** Same shape: a gateway page that confirms, then a POST that removes the slug from `state.json` and garbage-collects. Taking a page down never waits on an instance. When the request named a port, the gateway also records the unpublish there, but only after that port's `/public-manifest` (or, for a slug no longer on main, its hello) names the same project and root; otherwise it says the record wasn't written and the Library's **Forget** clears it.

**`GET https://<box>/public/`.** A gateway page listing what is public on this box, per project, with each URL and an Unpublish link. Every `/public/*` page refuses a `sec-fetch-dest` other than `document`, so another site's frame can't make the gateway fetch manifests.

**`x-devteam-public`.** When the gateway proxies a signed-in `GET /api/data` on an instance, it adds this header with its whole public map (`{ project: { port, root, artifacts: { slug: tree } } }`, at most 32 KB; past that, only the requesting project's entry). The gateway removes any such header the upstream sent.

**Serving `public.<box>`.** This branch comes first in the request handler, before the Origin and cookie checks:

- Only `GET` and `HEAD`; anything else 405 with `allow: GET, HEAD`. Service-worker requests 403.
- The raw path is `/<project>/<slug>/<rel>`, and `rel` must pass the kit's `artifactPathOk` (no `%`, no dot-segments, no dotfiles). `/<project>/<slug>` gets a 302 (`cache-control: no-store`) to the trailing slash only when that artifact is published, else 404. `/`, `/<project>/` and anything unpublished are 404. A trailing `/` means `index.html`.
- The file is streamed from `<dir>/public/blobs/<sha256>`, with only the gateway's headers:
  - `content-type` from the gateway's own extension map (the kit's `ARTIFACT_TYPES`, duplicated; a test compares them), `application/octet-stream` otherwise;
  - `content-length`; `etag: "<sha256>"`, answering 304 when any strong tag in `if-none-match` matches (or it is `*`); `cache-control: public, max-age=60`;
  - HEAD sends the headers without opening the blob. No range requests, as in the kit;
  - `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, HSTS;
  - the gateway's own CSP: the kit's artifact policy (CDN list duplicated; a test compares it with the kit's) with `self` being `https://public.<box>/<project>/<slug>/`, `frame-ancestors 'none'`, and the same `sandbox allow-scripts allow-forms allow-modals allow-pointer-lock` directive. Without `allow-same-origin` the page runs as an opaque origin, so it can't read or write the box's cookies.
- No `set-cookie`, ever, and the incoming `cookie` header is ignored. Nothing on this name talks to an instance.

## Why this closes the port risk

- **Pages on an instance's name can't publish.** The only publish path is a POST whose `Origin` is the box's own name, from a page whose bytes the gateway holds. Script on an instance's origin, the owner's cookie or not, can't make one.
- **The owner sees what they confirm.** The confirm page shows the project, slug, title, size, destination URL and every file by name, and the POST is bound to the sha256 of the exact manifest shown, so nothing about it can change in between. The tree id is recomputed from the bytes.
- **A project is bound to a checkout, as the instance reports it.** Another instance that reports a different `root` needs the owner's explicit "move it", which is unchecked by default. `root` is self-reported: whatever holds the port can claim the bound root and publish as that project if the owner confirms, which is why every item shows the root it reports.
- **Forged log lines can only make the Library ask.** A forged publish line can make a card say "Not live", and it looks just like a real one. The confirm page labels every item from the gateway's own state, leaves unticked what it holds no copy of, and names every file, so a line the owner never wrote can't get a page public without the owner reading and ticking it.
- **After a publish nothing on the box is trusted again.** The public is served from the gateway's own verified copy. Taking the port, rewriting main or forging log lines changes nothing that is served.
- **Remaining trust:** at the moment of the confirm, the owner trusts the instance they clicked from to be the project it says it is. That is the trust the owner already gives the dashboard they are using, and the confirm page names the project, port and reported root so a surprise is visible.

## Box moves

The record moves with the log, as every owner line does: `log-sync` and `merge --chore log` land it before the move, and `fleet unpark` rebuilds it. The gateway's directory doesn't move. On the new box the Library shows each published artifact as **Not live on this box**, with **Restore all** above them (or **Review all** when any differs from main). The confirm page lists every one, unticked, since the new box holds no copy of what was published; what goes up is what main holds now. The Library and the page each say when that differs from the tree on record. Neither can show what changed: the box has no copy of the old version. Republishing from the old tree instead isn't offered: the old bytes are reachable only through history and would bypass the "landed on main now" rule.

## Delivery

One PR, in two commit groups: the kit (schema, `integrity`, commands, `/public-manifest`, `ACTIONS`, consumers, Library `published` and `tree`) and then the gateway (store, queue, routes, serving, header, Library cloud states). The Library's cloud states land with the gateway because they read its header.

## Testing

- **Kit (`test/lib/chain.mjs`):**
  - `artifact publish` refuses a draft, an unlanded slug, a broken artifact, a `--tree` that isn't main's, and any caller without `--owner` or with `DEVTEAM_ROLE` set; it writes the owner act with the tree.
  - `unpublish` refuses an unpublished slug.
  - `/public-manifest/<slug>` lists sha256s that match `/artifact/main/` bytes; 404 for drafts; 409 for a bad project name; refused cross-site.
  - Library data carries `published` and changes after publish and unpublish with the artifact's bytes unchanged (the cache doesn't hide it).
  - `act --class artifact-publish` by the supervisor is refused; an owner act of another class is refused by `integrity()`; owner acts are absent from `calls()`, `decisionRecords()` and the dashboard acts view; `correct` refuses one.
- **Gateway (`test/gateway.test.mjs`)**, against a real kit dashboard with a landed artifact:
  - The confirm page needs a session; it shows the project, slug, root, file names and URL, escaped.
  - The review's repro: an owner publishes at T1, main changes, and a local `POST /api/artifact-publish` writes a line for an artifact the owner never published. On a new box both items are unticked, explained, name their files and never say "restore"; nothing is public until the owner ticks one.
  - A POST from an instance origin is refused (403), and so is one without a session.
  - After a confirm, `public.<box>/<project>/<slug>/` answers anonymously with the bytes, the gateway's CSP, an etag, and no `set-cookie`. HEAD works, 304 on `if-none-match`, POST 405, the cookie isn't forwarded.
  - The kit has an owner act for it.
  - An upstream that serves different bytes than its manifest says is refused at publish, and nothing is stored.
  - After a publish, killing the kit (or replacing it with an impostor on the port) changes nothing that is served.
  - A manifest changed between page and POST (title, project, a file) is refused.
  - A manifest whose `tree` doesn't match the bytes is refused.
  - Two concurrent publishes of different slugs both end up served; an unpublish racing a publish leaves no dangling blob and no missing one.
  - Publishing the same project from another root is refused without "move it" and works with it; the same root on a new port just updates the port.
  - Unpublish → 404, and its blobs are gone.
  - `public.<box>/` and `/<project>/` are 404; `/<project>/<slug>` redirects only when published.
  - `x-devteam-public` is set on `/api/data` and an upstream copy of it is dropped.
  - The size cap refuses.
  - The gateway's CDN list and type map match the kit's.

## Docs

`README.md` (the tree comment, the Artifacts paragraph, the cloud section's names and gateway bullet, the deploy-gate note), `process/supervisor.md` §Artifacts (publishing is the owner's; nothing in an artifact you wouldn't publish), `constitution.md`, `log.schema.json` descriptions, the `cloud/Dockerfile` header names, the kit's `HELP`. The artifacts spec's "No hosted sharing" line points here.
