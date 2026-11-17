# kit-172 Implementation Plan

## TL;DR

- Add `artifactVersions(slug)` and the `artifact versions <slug> [--json]` subcommand to `docs/devteam/scripts/devteam.mjs`, next to `artifact describe`. It lists:
  - the drafts, from `draftArtifacts()` filtered to the slug, newest first;
  - then main's version and the earlier ones, from one first-parent `git log --raw -t` over the artifact's folder.

  Trees without `artifact.json` are dropped, and so are repeated trees. The list is capped at 200 versions, and exit 3 means there is nothing.
- Add `GET /api/artifact-versions?slug=` to the dashboard server, next to `/api/view`. It runs that subcommand in a child process, with one shared job per slug. It answers 403 to a `sec-fetch-site` header that is present and not `same-origin`, 400 to a bad slug, 404 when the subcommand exits 3, and 500 on any other failure.
- Nothing changes in how artifacts are served. Every listed tree is one `/artifact/tree/<id>/<slug>/` already serves, under the same sandbox.
- Test first, in the new `test/artifact-versions.test.mjs`. It uses a `threadsFixture` with real git history and a real dashboard.
  - T1 checks the subcommand's JSON (spec A1, A2, A5, A7, and A6's exit 3).
  - T2 adds the route, and checks that the endpoint's answer equals the CLI's and that every listed url is served under the sandbox (A3, A4, A6).
- Then mutations M1–M5 in verification, and CI `test.yml` green at the head as the gate.
- Risks:
  - a draft folder without its own `.git` reporting main's HEAD (guarded by `--show-toplevel`, A2);
  - a cap on commits instead of on versions (A7);
  - an unservable tree listed (A5).

> For agentic workers: use superpowers:subagent-driven-development (or executing-plans). Steps are checkboxes.

**Goal:** the viewer can ask for an artifact's versions (draft, landed, earlier by date) and frame each read-only.
**Spec:** `docs/devteam-dev/tickets/kit-172-artifact-versions/spec.md` (approve-spec m-20261117-122514221-supervisor at 0ebbd0d3).
**Architecture:** a pure-read CLI subcommand computes the list. The dashboard route only runs it, as `/api/view` runs `artifact describe`.
**Tech stack:** Node, `node:test`, git. No dependencies.

## Rulings and spec-review carry-overs

- approve-spec at 0ebbd0d3 (m-20261117-122514221-supervisor).
- **S2-1:** the spec's "What exists today" bullet says `run` shares concurrent asks. That is wrong. `run` (devteam.mjs ~16062) is a plain `execFile` wrapper. The route's own `describing` map (~16068) does the sharing, and T2 copies that map as `versioning`.
- **S2-2:** the one-job-per-slug sharing is **untested by design**. A child-process count would depend on timing and could flake. A6 checks only that concurrent asks agree.

## Global Constraints

- Change only `docs/devteam/scripts/devteam.mjs`, `test/artifact-versions.test.mjs`, and this ticket's folder.
- Leave the serving code alone: no change to the `/artifact/` route, `artifactTreeOk`, `artifactAt` or `artifactCsp`.
- The JSON shape is exactly the spec's: `{ slug, versions: [...], truncated }`.
  - A draft entry is `{ kind: 'draft', at, worktree, commit, time, fp, url }`.
  - A main entry is `{ kind: 'landed' | 'earlier', at: 'tree:<id>', tree, commit, time, url }`.
  - `time` is ISO 8601: `%cI` for main's entries, and the draft's `updated_at`.
- Cap: `ARTIFACT_VERSIONS_MAX = 200` landed+earlier entries, counted after the filters.
- Running tests on the box:
  - Run only `test/artifact-versions.test.mjs`, from a script file: `env -u TMUX HOME="$(mktemp -d)" timeout 600 node --test --test-concurrency=2 test/artifact-versions.test.mjs`.
  - Never run the full suite or `tmux kill-server`.
  - Kill a dashboard a test starts in `cleanup` (the fixture's `later`).

## Review Focus

1. **A draft in a plain folder under `.worktrees/`** (no `.git`, as the existing tests make drafts): its `commit` must be `null`, not main's HEAD. Tested in T1 (A2).
2. **A revert to an older tree:** listed once, at its newest commit. Tested in T1 (A5b, A7).
3. **A folder deleted on main:** there is no `landed`, but history is kept and still served. Tested in T1 (A5c) and T2 (served).
4. **A `sec-fetch-site` header missing:** must still answer 200 (curl, the gateway's loopback). Tested in T2 (A6).
5. **Paths with spaces or odd names in an artifact folder** don't matter, since only the folder's own `040000` line is parsed. The parse must match the path exactly (`=== folder`), not a prefix, or `viewer-mock-2` would leak into `viewer-mock`. Tested in T1: A1 lands a sibling `viewer-mock-2` once, and it must not appear.

---

### Task 1: `artifactVersions` and `artifact versions`

**Model:** strong. New logic over git output, with edge cases.

**Files:**
- Create: `test/artifact-versions.test.mjs`
- Modify: `docs/devteam/scripts/devteam.mjs`:
  - after `artifactTreeOkSync` (~8300): add `artifactVersions`;
  - the `artifact` command (~8483): add `versions` after `describe`, and add it to the usage `die` (~8497);
  - the help text (~21701): add one line.

**Interfaces:**
- Produces: `const ARTIFACT_VERSIONS_MAX = 200;` and `function artifactVersions(slug) -> { slug, versions, truncated } | null`. It returns null when there is no draft and no main version at all. `artifact versions <slug> [--json]`: exit 0 with the JSON (`--json`) or plain lines; exit 3 with `<slug>: no versions`; exit 1 (die) on a bad slug.

- [ ] **Step 1: Write the failing tests** in `test/artifact-versions.test.mjs`.
  - Imports: `node:test`, `assert/strict`, `fs`, `path`, and from `./lib/kit.mjs` `{ threadsFixture, write, freePort, startDashboard, until }`, plus `cleanup` from `./lib/chrome.mjs`, as `dashboard.test.mjs` does.
  - Local helpers:
    - `landArtifact(F, slug, files)`, copied from `dashboard.test.mjs:395`, returns `{ tree, commit }`: the folder's tree, and `rev-parse HEAD` after the push.
    - `cliVersions(F, slug)` returns `JSON.parse(F.owner(['artifact', 'versions', slug, '--json']))`.
    - `mock(n)` gives VIEWER_MOCK-shaped files whose `index.html` contains `v${n}`.
  - Tests, with the spec's assertions:
    - `'versions: landed then earlier by date, each with its commit and time'` (A1):
      - Land v1. Make an unrelated commit (a file outside `artifacts/`). Land v2. Land a sibling `viewer-mock-2` once. Land v3.
      - `versions` deep-equals `[landed v3, earlier v2, earlier v1]` on `kind`, `tree`, `commit`, `at` (`tree:${tree}`) and `url` (`/artifact/tree/${tree}/viewer-mock/`).
      - Each `time === F.g(['log','-1','--format=%cI',commit], F.old)`, and the times are non-increasing.
      - No entry's commit is the unrelated commit or `viewer-mock-2`'s, and `truncated === false`.
    - `'versions: the draft first, with its worktree and its own commit'` (A2), exactly as in the spec's A2:
      - `demo-01-draft` is a `git init` checkout with one commit. Its `commit` equals `rev-parse HEAD` there.
      - `demo-02-plain` is a plain folder, back-dated an hour with `fs.utimesSync`. Its `commit` is `null`.
      - The drafts are ordered newest first. Touching `demo-02-plain` to now+60 s flips the order.
      - A copy equal to main's gives no draft. Removing the worktrees gives no drafts.
    - `'versions: only servable, deduped, and kept after a delete'` (A5 a–c), as in the spec.
    - `'versions: capped at 200 versions, not commits'` (A7):
      - Make 201 local commits of `long-mock`, each writing `index.html` = `v${i}`. Between i=100 and i=101, add one commit that writes back v99's exact files. Push once.
      - Expect: `versions.length === 200`, `truncated === true`, and the last entry's tree is v2's (the `HEAD:` tree recorded after the v2 commit).
    - `'artifact versions: exit 3 when there is nothing'` (A6, the CLI part): `F.run(F.old, ['artifact','versions','no-such']).status === 3` (`threadsFixture` spreads `fleetFixture`'s `run(cwd, args)`; git calls are `F.g(args, cwd)`).

- [ ] **Step 2: Run it and see it fail**
  - Run the Global Constraints command from a script file.
  - Expected: every test FAILS with `usage: artifact new …` (an unknown subcommand dies with status 1).

- [ ] **Step 3: Implement `artifactVersions(slug)`**
  - Drafts:
    - `draftArtifacts().filter((a) => a.slug === slug)`, sorted by `updated_at` descending.
    - For each draft, `root = draftWorktree(a.at)`. Then `commit = git(['rev-parse','--show-toplevel'], root) === root ? git(['rev-parse','HEAD'], root) : null`. Compare real paths: `draftWorktree` returns the real path, so compare it with the `realpathSync` of the toplevel.
  - Main's entries:
    - `ref = mainRef()`. If there is a ref, run one `git log --format=%x01%H %cI --raw --no-abbrev -t -m --first-parent --no-renames <ref> -- <ARTIFACTS_REL>/<slug>`.
    - Split it on `\x01`. In each chunk, the header is `<sha> <iso>`. Find the line whose path is exactly the folder and whose mode is `040000`, and take its new tree. Skip the chunk when there is no such line or the new tree is all zeros.
    - Dedupe by tree, keeping the first (newest).
  - Filter to trees with `artifact.json`, using one `spawnSync('git', ['cat-file','--batch-check'], { cwd: mainRoot, input: trees.map((t) => `${t}:artifact.json`).join('\n') + '\n' })`. A line ending in ` missing` drops that tree.
  - `nowTree = treeNow(git(treeFolderArgs(ref, slug).now, mainRoot))`.
    - The entry whose tree is `nowTree` is `landed`. Put it first among main's entries, in its own log position.
    - All others are `earlier`.
    - Main's tree is always the folder's newest log entry, so this keeps log order.
  - Take `.slice(0, ARTIFACT_VERSIONS_MAX)`, and set `truncated` when more remained.
  - Return null if there are no drafts and no main entries.

- [ ] **Step 4: Wire the subcommand** after `describe`:
  - `slug` must pass `LINK_ID`, else die with `usage: artifact versions <slug> [--json]`.
  - `artifactVersions(slug) ?? die(\`${slug}: no versions\`, 3)`.
  - `--json` prints `json(r)`. Otherwise print one line per version: `draft <worktree> <time>` or `<kind> <tree12> <commit12> <time>`.
  - Add `| artifact versions <slug> [--json]` to the usage line.
  - Add this help line under describe: `artifact versions <slug> [--json]   an artifact's versions: its drafts, main's, then earlier ones by date (the dashboard's /api/artifact-versions reads it)`.

- [ ] **Step 5: Run and see it pass.** Expected: 5 tests pass, 0 fail, 0 skipped.

- [ ] **Step 6: Commit** `kit-172 T1: artifact versions`, then log `devteam.mjs phase build --task T1`. Task review: `reviews/task-1.md`.

### Task 2: `GET /api/artifact-versions` and serving every listed version

**Model:** fast. Wiring a route to the given subcommand, on the `/api/view` pattern, plus HTTP assertions.

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`: the dashboard server, right after the `/api/view` block (~16648), and a `const versioning = new Map()` beside `describing` (~16068).
- Modify: `test/artifact-versions.test.mjs`.

**Interfaces:**
- Consumes: `artifact versions <slug> --json` from T1 (exit 0 JSON, exit 3 none).
- Produces: `GET /api/artifact-versions?slug=<slug>`, which answers:

  | Answer | When |
  |---|---|
  | 200, the CLI's JSON | the subcommand succeeds |
  | 404 `{ error: \`no versions of ${slug}\` }` | the subcommand exits 3 |
  | 400 `{ error: 'bad slug' }` | the slug fails `LINK_ID` |
  | 403 `{ error: "not for another site's page" }` | a `sec-fetch-site` header is present and not `same-origin` |
  | 500 `{ error: 'the versions could not be read' }` | any other failure |

- [ ] **Step 1: Write the failing tests.**
  - Start a dashboard on a free port, as `dashboard.test.mjs:1165` does: `startDashboard(F.old, F.env({}), ['--port', String(port)])`, then `until(... /dashboard on http:\/\/127\.0\.0\.1:${port}\b/ ...)`.
  - Add `apiVersions(B, slug, headers)`.
  - In A1, A2 and A5, assert after each CLI read that `await (await fetch(\`${B}/api/artifact-versions?slug=${slug}\`)).json()` deep-equals `cliVersions`. Start the dashboard in each of those tests.
  - New test `'a listed version is served read-only at its url, under the artifact sandbox'` (A3, A4):
    - Use A1's history plus `demo-01-draft`.
    - For each entry:
      - `fetch(B + url)` is 200, and its text is that version's `index.html`: `v${n}` for trees, the draft's disk text for the draft.
      - Its `content-security-policy` includes `sandbox allow-scripts`.
      - With its own folder URL replaced by `/artifact/main/viewer-mock/`'s, the policy equals main's.
      - `x-frame-options` is null.
    - `fetch(B + url, { method: 'POST' })` status is not 200.
  - New test `'/api/artifact-versions: guards'` (A6):
    - `?slug=Bad_Slug` gives 400, and no slug gives 400.
    - `?slug=no-such` gives 404 with an `error`.
    - `sec-fetch-site: cross-site` gives 403. `same-origin` and no header give 200.
    - Three concurrent `fetch`es all give the same JSON.

- [ ] **Step 2: Run and see it fail.** Expected: the new and extended tests FAIL with a 404 from the server's catch-all on `/api/artifact-versions`. T1's CLI-only assertions still pass.

- [ ] **Step 3: Implement the route** after `/api/view`:
  - Copy that route's `sec-fetch-site` check exactly.
  - `slug = u.searchParams.get('slug') ?? ''`. It must pass `LINK_ID`, else 400.
  - `let job = versioning.get(slug)`. If there is none, start `run(['artifact','versions',slug,'--json'], { timeout: 12000 }).finally(() => versioning.delete(slug))` and store it.
  - Map the outcome: `r.ok` gives 200 with `r.stdout`, `r.code === 3` gives 404, anything else 500.

- [ ] **Step 4: Run and see it pass.** Expected: all 7 tests pass, 0 fail, 0 skipped.

- [ ] **Step 5: Commit** `kit-172 T2: /api/artifact-versions`, then log the phase. Task review: `reviews/task-2.md`.

### Verification (after T2)

Run each mutation, see the named test go red, and revert it. Record each red output in `verification.md`.

| Mutation | Change | Expected red |
|---|---|---|
| M1 | drop the drafts | A2 |
| M2 | add `-n`, `String(ARTIFACT_VERSIONS_MAX)` to the log and remove the post-filter slice | A7 (199 ≠ 200) |
| M3 | skip the `artifact.json` filter | A5a |
| M4 | delete the route's `sec-fetch-site` check | A6 (403) |
| M5 | build every tree `url` as `/artifact/main/<slug>/` | A3 (wrong bytes for v1, v2) |

Then merge `origin/main` and push. Record `devteam.mjs gate ci -- gh run watch <run> --exit-status`, redirected to a file, never piped. Cite `gh run view <run> --json conclusion` at the head.
