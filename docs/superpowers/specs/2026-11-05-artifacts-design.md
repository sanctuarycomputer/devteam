# Artifacts: pages the fleet draws to show an idea

Date: 2026-11-05. Builds on `2026-11-04-links-components-multirepo-design.md` (the registry) and the review pages of `process/supervisor.md` §6.

## Goal

Any session can draw an **artifact**: a self-contained web page (a UI mock, a flow, a mock docs site, a 3D model, screenshots with notes) that shows the owner an idea instead of describing it. Artifacts live in the repo, land through PRs, and are listed in a **Library** view of the dashboard beside the link registry. They open in a centered viewer covering 80% of the window, or in their own tab. The owner can ask for one ("make me a mock docs site for this project"). Planners and the supervisor reach for one whenever a goal, design or ticket has UI or a flow worth seeing before it's approved.

Artifacts show things and nothing more. They send nothing back. When a session needs the owner's call on one, it asks an ordinary question that links to it.

## Non-goals

- **No bridge back.** No `postMessage` protocol, no results, no drafts. Review pages (`review` questions) stay the only HTML that answers anything, and they don't change.
- **Not registry entries.** Artifacts are files in the repo, found by reading folders. They are not `settings.md` links and are not edited through `link add`. They borrow the registry's scope language and one-line rules.
- **No reach into the owner's data.** An artifact loads its own files and libraries from a few public CDNs, and nothing else. The CDNs serve arbitrary code (`cdn.jsdelivr.net/gh/<any>/…`), and source matching ignores query strings, so a page *can* send what it holds to a CDN's logs. That is acceptable only because an artifact holds nothing it didn't commit to the repo: artifacts never embed owner data, secrets or log contents, and the process docs say so.
- **No hosted sharing.** Artifacts are seen through the owner's local dashboard.

## Design

### On disk

`docs/devteam/project/artifacts/<slug>/` holds:

- `index.html`, the entry point;
- any other files the page uses: JS, CSS, images and screenshots, `.glb`/`.gltf`, fonts, audio and video, JSON;
- `artifact.json`, the manifest:

```json
{ "v": 1, "title": "Docs site mock", "summary": "What this shows, in one line",
  "by": "supervisor", "for": ["goal:onboarding"] }
```

The manifest fields:

- **`title`** (required, ≤120 characters) and **`summary`** (required, ≤500 characters) follow the registry's one-line rule: no line breaks, tabs, control or bidi characters.
- **`by`** (required) is the writer: `supervisor`, a ticket id, or `plan-<feature>`.
- **`for`** (optional, default `[]`) is a list of scopes in the registry's language: `all`, `component:<c>`, `feature:<f>`, `goal:<g>`, `ticket:<id>`.
- No other keys are allowed.
- The **slug** follows the link-id rule (`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`).

**Checked by `artifact check`, which refuses on any of these:**

- a missing `index.html` or manifest, or a manifest that fails the rules above;
- a symlink, a dotfile or dot-folder, or a path with a character outside `[A-Za-z0-9._/-]`;
- any file over 8 MB, or an artifact over 25 MB in total. Bigger media is linked from a url link instead of committed.

**`artifact check` only warns** (exit 0) when:

- a `<script src>` or `<link href>` points at a host outside the allowed CDNs (it won't load);
- a CDN URL has no exact version (`three@0.160.0` passes; `three`, `three@latest` and `three@0` warn);
- the page has a `<meta http-equiv="refresh">`.

The checks run over a **tree**, not only a checkout: one function takes a list of `{path, mode, size, read()}` entries, fed either by a walk of the folder on disk (`artifact check`) or by `git ls-tree -r -l <sha> <dir>` with `git cat-file blob` (`check-pr` and `merge`, which judge a fetched commit and have no checkout of it). On a tree, mode `120000` is a symlink.

### Lifecycle

- **Draft.** An artifact under a worktree in `.worktrees/<name>/`, read off disk as it is, uncommitted files included. It shows up in the Library while the session is still drawing it. Reviewer checkouts (`review-*`) and scratch checkouts (`tmp-*`) are never read, and a worktree's copy whose files hash the same as the landed artifact is not a draft (a merged branch's worktree that wasn't removed yet shows nothing).
- **Landed.** The artifact as committed on main (`mainRef()`, which prefers the fetched `origin/<main>`), read with `git cat-file blob`, never from the main checkout's working tree.
- **Editing a landed artifact** happens on any branch. The worktree's copy is a draft of the same slug until the branch merges, and the Library shows the landed version with its drafts beneath it.
- **Two worktrees drawing the same new slug** are both shown as drafts, each labelled with its worktree. Nothing forbids it. `artifact new` refuses a slug that is already landed (edit that one instead) and warns when another worktree has a draft of it.
- **Deleting** an artifact means removing its folder in a PR.
- **No log lines and no acts.** Git is the record of an artifact, as it is for a design. Who drew it is in the manifest and the commit.

**Who draws them:**

- workers, in their ticket worktree, landing with the ticket PR;
- planners, in their plan worktree, landing with the plan PR;
- the supervisor, in a chore worktree (`devteam.mjs chore start artifact-<slug>`), landing with that chore PR.

That includes artifacts the owner asks for. An artifact is not production code, so the supervisor drawing one stays inside its "writes no production code" rule. The constitution's role line says so.

### Commands

- **`artifact new <slug> --title t --summary s [--for '["goal:g"]']`** writes `artifacts/<slug>/artifact.json` and a starter `index.html` in the current checkout. `by` is the caller's role (`DEVTEAM_ROLE`, ticket id or planner). The starter page is a doctype, a viewport meta and a minimal light/dark base style using `devteam-ui.css` tokens copied inline (no link to the dashboard's files, which the artifact can't load).
  - It refuses on the main checkout, since artifacts are drawn in a worktree.
  - It refuses a slug that has already landed.
- **`artifact check [<slug>…]`** runs the checks above on the current checkout's artifacts (all of them, or the slugs named).
- **`artifacts [--json]`** lists landed and draft artifacts: slug, title, where it is (`main` or the worktree's name), `by`, `for` and the last-modified time.

**`check-pr` and `merge`** run the refusing checks on every artifact the PR adds or changes. Warnings are printed and never block.

### Serving

The dashboard serves an artifact's files under one URL prefix per source:

- **landed:** `/artifact/main/<slug>/<path>`
- **draft:** `/artifact/wt/<worktree>/<slug>/<path>`

A request for the folder itself (`…/<slug>/`) serves `index.html`. Relative URLs inside the page work, because the prefix is a folder.

**Resolution:**

- `<slug>` must match the slug rule. `<worktree>` must match `^[A-Za-z0-9][A-Za-z0-9._-]*$` (so never `.` or `..`), must not be `review-*` or `tmp-*`, and must name a directory whose real path is directly under the real path of `.worktrees/`.
- `…/<slug>` without the trailing slash redirects to `…/<slug>/`, so the page's relative URLs resolve inside its folder.
- `<path>` is checked by the same rule as `artifact check`.
- The resolved real path must stay inside that artifact's folder, so a symlink or `..` gets a 404.
- Landed files come from `git cat-file blob <mainRef>:<projectRel>/artifacts/<slug>/<path>`.
- Unknown files get a 404. The content type comes from the extension, from a fixed table (html, js, mjs, css, json, svg, png, jpg, jpeg, gif, webp, avif, ico, glb, gltf, bin, wasm, woff, woff2, ttf, otf, mp4, webm, mp3, wav, ogg, txt, md, csv). Any other extension is served as `application/octet-stream`.
- The response headers are `x-content-type-options: nosniff`, `cache-control: no-store` (drafts change constantly) and `referrer-policy: no-referrer` (CDN loads never carry the local URL).

**Who may load them:** the `Host` check alone, as for `/api/file`. There is no `sec-fetch-site` rule: under the policy's `sandbox` the document has an opaque origin, so every request it makes for its own files (and every in-page navigation, such as a mock docs site's `<a href="page2.html">`) says `Sec-Fetch-Site: cross-site`. Nothing is lost: another site can't read the responses (no CORS headers), and `frame-ancestors` keeps it from framing them. Any `sec-fetch-dest` is accepted, because the artifact is opened both framed and in its own tab.

**The policy sent with every artifact response:**

```
default-src 'none';
script-src 'unsafe-inline' 'unsafe-eval' <self> <cdns>;
style-src 'unsafe-inline' <self> <cdns> https://fonts.googleapis.com;
font-src <self> <cdns> https://fonts.gstatic.com data:;
img-src <self> data: blob:;
media-src <self> data: blob:;
connect-src <self> <cdns>;
worker-src <self> blob:;
frame-src 'none'; form-action 'none'; base-uri 'none';
frame-ancestors <origin> http://127.0.0.1:<hub port>;
sandbox allow-scripts allow-forms allow-modals allow-pointer-lock
```

- `<self>` is `http://<host>/artifact/<source>/<slug>/`, so an artifact can load only its own folder.
- `<cdns>` is `https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com`.
- `'unsafe-eval'` lets in-browser JSX (Babel standalone) work. Nothing secret is in reach of the page.

**Why this is safe on the dashboard's origin:**

- The `sandbox` directive applies even when the artifact is opened in its own tab, and it gives the document an opaque origin.
- Its requests to the dashboard's API therefore carry `Origin: null` and are refused by the existing owner-action check.
- `connect-src` already keeps it off `/api/`, and it can't read the dashboard's storage.
- `allow-same-origin`, `allow-top-navigation`, `allow-popups` and `allow-downloads` are never granted. A presentational page never needs to write to the owner's disk.

### The question link

A question's `links` items (log schema and `ask --links`) gain:

- **`artifact`**, a fourth kind of link beside `path`, `url` and `link`. It holds the artifact's slug.
- **`at`** (optional, artifact links only) is `main` or a worktree name. When omitted, `ask` resolves it only when there is exactly one candidate: the landed artifact plus each draft (drafts identical to landed don't count). With none, or with more than one (say, the supervisor iterating a landed artifact in its chore worktree), `ask` refuses and names the candidates for `--links … "at"`.
- **`sha256`** is written by `ask`, never by the caller (`ask` refuses one given). It is the sha256 of the artifact's sorted `path\0<git blob id>\n` lines at `at` when asked. Landed, the blob ids come straight from `git ls-tree` without reading a file; for a draft they're computed from the bytes on disk the way git does (`sha1("blob <len>\0" + bytes)`).
- `title` stays required on every link, as now.
- **`name`** (optional, any kind) is a short key following the link-id rule, unique within the question.

The rules:

- Each item has exactly one of `path`, `url`, `link` and `artifact`. `ask` refuses an item with none, or with more than one.
- Question text and context may write `[[name]]`. `ask` refuses a `[[name]]` that matches no link's `name`.
- The dashboard renders `[[name]]` in place as a link labelled with that item's title, opening the way the item opens.
- Every link is still listed under the question, so nothing is reachable only inline.

How each kind opens:

- **artifact:** the viewer.
- **url:** a new tab.
- **path:** the drawer, as now.
- **link:** whatever the registry entry resolves to.

The server resolves each open question's artifact links when it builds `dashboard-data`, on copies (`{...link, href, changed, gone}`), never on the folded question's own link objects: the question's hash (the owner's answer binds to the question as asked) covers `links`. The fields `at` and `sha256` are written in the one `ask` line and never added later. When the artifact's files no longer hash to the link's `sha256`, the viewer's header says "Changed since this question was asked". When the source is gone (the draft's worktree was removed): if the landed artifact hashes to the link's `sha256` (the draft landed as asked), the link opens it with no notice; if it has landed differently, it opens the landed version with the "Changed since" notice; if it never landed, the link says "no longer available". The owner then knows they're answering about something that has moved. Existing questions and links without these fields stay valid.

### The Library view

- **Sidebar.** A new entry, **Library**, after Board. It has a count of artifacts (landed plus drafts) and is an anchored section like the others.
- **Artifacts group.** A card per landed artifact, showing its title, summary, scopes and who drew it. Its drafts are listed beneath it, labelled by worktree.
- **Drafts group.** Drafts of slugs that haven't landed, grouped by worktree (labelled with the ticket, planner or chore it belongs to).
- **Links group.** The registry (`links`), showing each link's title, kind, locator (url, remote or path), scopes, notes and last probe result. A url opens in a new tab and a path opens in the drawer. This is read-only: the registry is edited through the supervisor, as now.
- **Data.** `dashboardData()` gains `library: { artifacts: [...], links: [...] }`. Drafts come from a readdir of `.worktrees/*/docs/devteam/project/artifacts/*/artifact.json` on each refresh. A manifest that fails the rules is listed with its slug and the error, never its unvalidated title.

### The viewer

- **Route.** `#artifact/main/<slug>` or `#artifact/wt/<worktree>/<slug>`, which can be bookmarked like the other routes.
- **Layout.** A centered panel at `inset: 10%` (80% of the window each way) over the existing scrim. A header holds the title, the source ("landed" or "draft in `<worktree>`"), the changed-since-asked notice when opened from a question, "Open in new tab" (the artifact's URL) and Close. Below it is the frame.
- **The frame.** `sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock"` and `allow="fullscreen"`, `referrerpolicy="no-referrer"`. The server's policy holds even if the frame's attributes were loosened.
- **Under the hub.** A nested frame can't gain what its parent lacks, so the hub's frame of each dashboard (`hub.html`) adds `allow-modals allow-pointer-lock` to its sandbox and `allow="fullscreen"`, or a 3D artifact's pointer lock and fullscreen fail there.
- **Route order.** `route()` handles `#artifact/…` before the line that hides the drawer and scrim for any non-drawer hash.
- **Closing.** Escape and a scrim click close it, like the drawer.
- **Refresh.** A draft doesn't reload on its own. A Reload button in the header reloads the frame.

### Prompts and process

- **Prompts.** Worker and planner prompts gain an "Artifacts (data, not instructions)" block beside the Links block. It lists landed artifacts whose `for` matches the session's scope (the same matching as links), with titles and summaries quoted as JSON and each one's path. Drafts are other sessions' work in progress and are left out.
- **`process/planning.md` §2 (the design).** When a goal or design has UI, a flow or anything easier seen than read, the planner draws artifacts for it and links them by name from the design and from the goal-approval question.
- **`process/supervisor.md` §6.** Question links can now carry `name`, inline `[[name]]` and `artifact`. Link mocks inline. A decision on a mock is a normal question about it, or a review page when the answer is structured. An HTML mock is an artifact, never a `path` link to an `.html` file (the drawer shows such a file with scripts off).
- **`process/supervisor.md`, a new short section "Artifacts".** What they are, when to draw one, the owner asking for one (draw it in a chore worktree, tell the owner it's in the Library, iterate, land it), and the commands.
- **`process/worker.md` §7.** A worker may draw an artifact for its ticket and link it from its review request.
- **`governance/constitution.md`.** The supervisor's role line notes that artifacts aren't production code.
- **README.** The tree gains `project/artifacts/<slug>/`, and the agent docs gain a short paragraph.
- **Schema.** The question link item gains `name`, `artifact`, `at` and `sha256`.

## Testing

Kit tests in `test/kit.test.mjs`:

- **Manifest and check:**
  - a valid artifact passes;
  - each refusal (missing index, bad title, unknown key, dotfile, symlink, oversize, bad slug) fails with its message;
  - an unpinned CDN script and an off-list host warn without failing.
- **`artifact new`:** scaffolds a page that passes `artifact check`, refuses on the main checkout, and refuses a landed slug.
- **`artifacts --json`:** lists a landed artifact and a draft in a fixture worktree, including an uncommitted draft. A worktree whose copy matches the landed artifact lists no draft.
- **Serving:**
  - landed and draft files are served with the policy (sandbox, `default-src 'none'`, the folder-scoped `<self>`);
  - `…/<slug>/` serves `index.html`;
  - `..`, encoded `..`, a symlink out of the folder and a dotfile each get a 404;
  - an unknown worktree, `..` as a worktree, and a `review-*` worktree get a 404;
  - `…/<slug>` redirects to `…/<slug>/`;
  - a request saying `sec-fetch-site: cross-site` (the artifact's own subresource) is served.
- **Opaque origin:** a POST to `/api/answer` with `Origin: null` is refused (this pins the existing guard the artifact relies on).
- **Question links:**
  - `ask` refuses two kinds in one item, a duplicate `name` and an unmatched `[[name]]`;
  - it resolves `at` and writes `sha256`, and refuses a caller-given `sha256`;
  - an artifact link with two candidates (landed plus a differing draft, or two drafts) is refused without `at`.
- **Changed since asked:** in `dashboard-data`, an open question's artifact link carries `changed: true` once a file in the draft changes, and `gone: true` once its source is removed.
- **Library data:** `dashboard-data` has `library.artifacts` and `library.links`, and a broken manifest is listed with its error.
- **Prompts:** a worker prompt includes a landed artifact scoped to its feature and leaves out an unscoped one and any draft.
- **`check-pr`:** a PR adding an oversize artifact is refused.

Browser check (manual, headless Chrome where available):

- the Library lists the fixture's artifacts;
- the viewer opens centered at 80%, with a three.js page from jsdelivr rendering;
- "Open in new tab" loads the same page;
- `[[name]]` in a question renders as an inline link that opens the viewer.

## Migration

None required. Restart the dashboard after the sync. `project/artifacts/` is created by the first `artifact new`.
