# kit-172: An artifact's versions: the draft, the landed one and earlier ones by date, each servable read-only

**Ticket:** kit-172-artifact-versions (build, S, risk normal; serves DCL-S6). **Why:** the owner's thread t-20261115-020154848-owner asks for a version dropdown in the artifact viewer's bar (design `a-cleaner-more-consistent-dashboard.md` lines 335–337; `kit-92` draws it). This ticket is the data behind that dropdown: one read that lists an artifact's versions, newest first, each one with an address the viewer can frame. The owner's later rule, t-20261117-015412930-owner, says that opening an artifact always shows its latest draft, and that main's version and older ones are reached from this list. So the list puts the draft first.

## What exists today (read at 74652466)

- `/artifact/main/<slug>/…` serves main's tree. `/artifact/wt/<worktree>/<slug>/…` serves a draft off its worktree's disk. `/artifact/tree/<id>/<slug>/…` serves an artifact folder's tree by id. All three use the artifact policy (`artifactCsp`: `sandbox allow-scripts`, frame-ancestors this dashboard and the hub), at `devteam.mjs` ~16757.
- `artifactTreeOk(id, slug)` accepts a tree id only if the tree has `artifact.json` at its top and it is, or once was, `<slug>`'s folder on main. It checks this with `git log --raw -t -m --first-parent` over the folder (`treeFolderArgs`). So **every past version on main's first-parent history is already servable**. What is missing is a way to *list* them.
- `draftArtifacts()` lists each worktree's copy of an artifact that differs from main's (by fingerprint). `landedArtifacts()` lists main's.
- `/api/view` runs `artifact describe … --json` in a child process (`run`, which shares one run between concurrent asks, with a 12 s timeout), so a git walk never blocks the dashboard's server; the route's own `describing` map shares one run between concurrent asks for the same thing (`run` itself is a plain `execFile` wrapper). It is same-origin only.

## Approach

There is one sensible way, and it follows the `describe` / `/api/view` pattern:

1. **`artifact versions <slug> [--json]`**, a new subcommand in `devteam.mjs` (in the `artifact` command, the usage line and the help text). It prints:

   ```json
   { "slug": "viewer-mock", "versions": [
     { "kind": "draft",   "at": "demo-01-draft", "worktree": "demo-01-draft", "commit": "<worktree HEAD sha>", "time": "<ISO, newest file's mtime>", "fp": "<fingerprint>", "url": "/artifact/wt/demo-01-draft/viewer-mock/" },
     { "kind": "landed",  "at": "tree:<id>", "tree": "<id>", "commit": "<main commit that landed it>", "time": "<that commit's committer time, ISO>", "url": "/artifact/tree/<id>/viewer-mock/" },
     { "kind": "earlier", "at": "tree:<id>", "tree": "<id>", "commit": "…", "time": "…", "url": "/artifact/tree/<id>/viewer-mock/" }
   ] }
   ```

   - **Drafts:** `draftArtifacts()`, filtered to this slug. A worktree whose copy equals main's is not a draft (that rule already exists). When several worktrees hold a draft, all are listed, newest `time` first. `commit` is the worktree's own `HEAD`, because a draft's files may be uncommitted on disk. It is null when the worktree is not a git checkout of its own: `git rev-parse --show-toplevel` run in the worktree must print the worktree's real path, or the commit is null. Otherwise git walks up to the main checkout and would report main's `HEAD` (a plain folder under `.worktrees/`, as the existing tests make drafts, has no `.git`). `time` is the draft's `updated_at`.
   - **Landed and earlier:** one `git log --format=%x01%H %cI --raw --no-abbrev -t -m --first-parent --no-renames <mainRef> -- <ARTIFACTS_REL>/<slug>`. This is the walk `artifactTreeOk` already uses, plus the commit and time. From each commit the code keeps the folder's own `040000` line, and from that line the new tree (the version that commit put on main). A commit that deleted the folder (an all-zero new tree) adds no version. The first remaining entry whose tree is main's tree now (`ls-tree`) is **landed**. Every other entry is **earlier**, in log order (first-parent order is the order versions landed on main, newest first). A tree that appears twice (a revert) is listed once, at its newest commit. The landed tree is never listed again as earlier.
   - **Only servable versions are listed.** A tree without `artifact.json` at its top (from before the artifact had a manifest) can't be served at `/artifact/tree/`, so it is left out. One `git cat-file --batch-check` over `<tree>:artifact.json` checks every tree at once.
   - Every listed tree passes `artifactTreeOk` by construction: it is the folder's tree now, or a new tree in that same log. So the `url` the list gives is the address `/artifact/tree/` already serves, under the same sandbox. This ticket adds no new way of serving anything.
   - Exit 3 when there is nothing (no draft, nothing on main now or in its history). Bad slug: die (exit 1).
   - Plain output, one line per version: `draft demo-01-draft <time>`, `landed <tree12> <commit12> <time>`, `earlier …`.

2. **`GET /api/artifact-versions?slug=<slug>`** in the dashboard server, next to `/api/view`. It is same-origin only, as `/api/view`: a `sec-fetch-site` header that is present and not `same-origin` gets 403 (no header, as from curl or the gateway's loopback, is allowed). A slug that fails `LINK_ID` gets 400. Otherwise it runs `artifact versions <slug> --json` through `run` (timeout 12000), with one shared job per slug while it runs, as `describing` does. The answer is 200 with the JSON, 404 `{error}` on exit 3, and 500 `{error: 'the versions could not be read'}` otherwise. The answer is `cache-control: no-store` (what `send` sets).

The other ways I considered, and why they don't fit:

- **Computing in-process in the server.** `draftArtifacts` and `landedArtifacts` are synchronous, so a long history would stall every other request. That is the reason `/api/view` already uses a child process.
- **Folding versions into `/api/data`.** That would run one git walk per artifact on every dashboard refresh, for a list that only the open viewer needs.
- **Serving versions by commit** (`/artifact/at/<commit>/`). Decision 12 (`artifactAt`'s comment) rules it out: `<commit>:<path>` reaches any committed file. The tree id is the safe address, and it already exists.

## Acceptance checks

The done-when is one sentence covering several behaviours. Each gets its own check in `test/artifact-versions.test.mjs`. The fixture is `threadsFixture` plus a local `landArtifact`: a commit and push to `origin/main`, returning the folder's tree id, as `dashboard.test.mjs` does. A real dashboard runs on a free port. Gate: the file passes in CI (`test.yml`, every job green at the head). On the box it runs alone, at `--test-concurrency=2`.

| # | Done-when part | Check | Fails when |
|---|---|---|---|
| A1 | lists the version landed on main, then earlier versions by date from the commits that touched the artifact, each with its commit and time | Land `viewer-mock` three times (v1, v2, v3), with an unrelated commit between v1 and v2 that does not touch the folder. `GET /api/artifact-versions?slug=viewer-mock` → 200. Its `versions` is exactly `[landed v3, earlier v2, earlier v1]`. The kinds are right. Each `tree` equals `rev-parse <commit>:<folder>` for the commit that landed it. Each `commit` equals that landing commit's sha (`rev-parse HEAD` after each push). Each `time` equals `git log -1 --format=%cI <commit>`, and times are non-increasing. The unrelated commit appears nowhere. | the landed version is missing or wrong; the order is not newest first; a commit or time is wrong or missing; commits that didn't touch the folder are listed |
| A2 | lists the draft (with its worktree) when one is open | Write a changed copy under `.worktrees/demo-01-draft/<ARTIFACTS_REL>/viewer-mock/`, and make the worktree root `.worktrees/demo-01-draft` a git checkout of its own (`git init` there, plus one commit). `versions[0]` is `{kind:'draft', at:'demo-01-draft', worktree:'demo-01-draft', url:'/artifact/wt/demo-01-draft/viewer-mock/'}`, with `commit` = `rev-parse HEAD` in that worktree root (not main's) and an ISO `time`. Landed and earlier follow, unchanged. Add a second changed copy in a plain folder `.worktrees/demo-02-plain/…` (no `.git`) whose files are older (`utimes` an hour back). The drafts are `[demo-01-draft, demo-02-plain]`, newest `time` first, and demo-02-plain's `commit` is `null`, not main's HEAD. Touch demo-02-plain's files to now+1 min: the order flips. Remove demo-02-plain. Then make the draft's files identical to main's: no draft entry. Then remove the worktree: no draft entry. | the draft is missing, not first, or lacks its worktree; a copy equal to main's is listed as a draft |
| A3 | a version is served read-only by its folder's tree id at /artifact/tree/<id>/ | For every `landed`/`earlier` entry, `GET <url>` returns 200 and the bytes that version committed (v1's `index.html` text for v1, and so on), and `url === /artifact/tree/${tree}/viewer-mock/`. The draft's `url` returns its disk bytes. A `POST` to a version `url` is not 200 (the route is GET only), so nothing can be written. | a listed version can't be served, or serves another version's bytes; a url isn't the tree-id address |
| A4 | with the artifact's usual sandbox | For each version `url`, the `content-security-policy` contains `sandbox allow-scripts`, and with the folder part taken out it is identical to `/artifact/main/viewer-mock/`'s policy (same directives). There is no `x-frame-options`. | a version is served under any other policy, or without the sandbox |
| A5 | only listed, servable versions (edge) | In order: (a) land `old-mock` without `artifact.json` (index.html only), then with it. Its list is one `landed` entry and no `earlier`. (b) On `viewer-mock` after A1, re-land v1's exact files (a revert). The list is `[landed T1 at the revert commit, earlier T3, earlier T2]`, so T1 appears once. (c) Delete `viewer-mock`'s folder on main and push. The list has no `landed`, and is `[earlier T1, earlier T3, earlier T2]`; each url is still served 200. | an unservable tree is listed (its url would 404); a revert duplicates an entry; a deleted folder hides its history |
| A6 | the endpoint's guards (edge) | `slug=Bad_Slug` or no slug → 400. `slug=no-such` → 404 `{error}`. `sec-fetch-site: cross-site` → 403; `sec-fetch-site: same-origin` and no header → 200. Three concurrent asks all return the same body. `devteam.mjs artifact versions viewer-mock --json` prints the same JSON as the endpoint; `artifact versions no-such` exits 3. | the read leaks to another site's page; a missing artifact looks like a server error, or the reverse |
| A7 | the 200-version cap (edge) | Land `long-mock` 201 times with a different `index.html` each (local commits, one push), and between the 100th and 101st, one more commit that puts back the 99th's exact files (a revert, so 202 folder commits but 201 distinct trees, one of them twice). The answer has exactly 200 landed+earlier entries, `truncated: true`, and its last entry is the oldest's successor (version 2), not version 1. A cap on commits (`git log -n 200`) would give 199 after dedupe and fail. `viewer-mock`'s answer has `truncated: false`. | the cap counts commits rather than versions, cuts the newest instead of the oldest, or is missing |

Every check calls the real endpoint against a real git history. If `artifact versions` or the route is removed, every row fails (404 from the server's catch-all, or a non-zero exit). The verify phase shows each row red under a mutation (M1–M4 in the plan).

## Contracts

None provided or consumed by name. The JSON shape above is the one `kit-92`'s dropdown will read. The design (line 337) names only the endpoint and the `/artifact/tree/<id>/` address, and both are kept as named. `kit-92` is not merged; this spec is the shape it should read.

## Edge cases

- **A shallow clone** stops the walk short. The older versions it can't see aren't listed, and `artifactTreeOk` already refuses them.
- **A long history.** The landed and earlier entries together are capped at the newest 200 *versions*, counted after the zero-tree, `artifact.json` and dedupe filters (not a `git log -n` cap on commits). When more exist, the answer carries `"truncated": true`; otherwise `truncated` is false. Drafts are not counted. A cap keeps the child's output and the dropdown bounded. A7 checks it.
- **No main yet** (`mainRef()` null): only drafts are listed; with no drafts, exit 3.
- **A broken manifest at some version** is still listed. The list says only where versions are. `describe` / `/api/view` says what each one is.
- **A worktree excluded by `draftWorktree`** (`review-*`, `tmp-*`, or not directly under `.worktrees/`) is never listed: `draftArtifacts` already applies the rule.

## Out of scope

- The dropdown, its labels, and which version the viewer opens first (`kit-92`; the owner's rule t-20261117-015412930-owner is for that ticket).
- Any change to how `/artifact/*` serves files, or to `artifactTreeOk`.
- Titles per version (`/api/view` with `at=tree:<id>` gives them on demand).

## Rulings

None yet.
