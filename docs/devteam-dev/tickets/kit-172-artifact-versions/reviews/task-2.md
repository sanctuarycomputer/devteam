# kit-172 task review: T2 (`GET /api/artifact-versions`, serving every listed version)

- Reviewer: fresh subagent (opus), not the author

I read the T2 brief, the implementer's report (and checked each of its claims against the code), and the review diff 54eb7dbe..589e79f2. I also read the approved spec (Approach §2, A3, A4, A5(c), A6, A7) and the plan's Rulings (S2-2). In `devteam.mjs` I read the code around the change: `git()` (~146), `treeFolderArgs`, `treeNow`, `treeInHistory`, `artifactCsp`, the `/artifact/` route's header line, `run`, `describing`, and the `/api/view` and `/api/threads` routes. In the tests I read `cleanup` (`test/lib/chrome.mjs`) and `startDashboard` (`test/lib/kit.mjs`). I ran no tests. The controller's re-run (7 pass, 0 fail, 0 skipped) left me no doubt that needed one.

What holds:

- **Scope.** Only `docs/devteam/scripts/devteam.mjs` and `test/artifact-versions.test.mjs` change. The serving code (`/artifact/` route, `artifactTreeOk`, `artifactAt`, `artifactCsp`) is untouched.
- **Route.**
  - It sits right after `/api/view`, and `versioning` is declared beside `describing` with a matching comment.
  - The `sec-fetch-site` check is a copy of `/api/view`'s: no header passes, and any other value than `same-origin` gives 403 with the exact text.
  - `slug ?? ''` is tested against `LINK_ID`, so no slug gives 400 `{ error: 'bad slug' }`.
  - There is one job per slug, `timeout: 12000`, and `.finally(() => versioning.delete(slug))`, the same as `describing`.
  - `r.ok` gives 200 with the CLI's stdout, `code === 3` gives 404 `no versions of ${slug}`, and anything else (a timeout's SIGKILL, a spawn failure, exit 1) gives 500 `the versions could not be read`. That is the brief's table word for word.
- **T1-1 fix.**
  - `git()` returns `execFileSync(...).replace(/\n$/, '')` and returns null only in its catch. So a successful empty read is `''`, and null means only that git failed.
  - `treeFolderArgs(...).now` is `ls-tree <ref> -- <folder>`. For a path missing at the ref, that exits 0 with empty output, so it gives `''`, `treeNow('')` gives null, and there is no `landed`. A5(c) runs that path (the folder deleted on main) and passes, so the distinction is exercised.
  - Both nulls (`log`, `ls-tree`) now `die` (exit 1), which the route maps to 500, never 404.
  - The `?? ''` on the log is gone, so a failed log can no longer be read as "no history".
- **Tests.** Each row is asserted and would fail if its behaviour broke:
  - **A1, A2, A5, A7:**
    - Each starts a dashboard and deep-equals the endpoint's JSON with `cliVersions` after the CLI reads. A2 checks with drafts present and again after they are gone.
    - `cleanup` runs its steps in reverse, so `d.stop()` runs before `F.done()`. No dashboard outlives its fixture.
  - **A3:**
    - Every entry, the draft included, is fetched. Each must be 200 with its own version's `index.html`: v3, v2, v1 for the trees and the draft's disk text.
    - M5 (every tree url pointing at main) would serve v3 for v2 and v1, so this goes red.
    - The `/artifact/tree/${tree}/<slug>/` url shape is asserted in A1 through `mainEntry`, and the endpoint deep-equals that.
    - A POST to every url is asserted not to be 200.
  - **A4:**
    - `self` in `artifactCsp` is `${base}<folder>/`, so swapping `B + url` (without its slash) for main's folder is a real substitution, not a vacuous one.
    - The swapped policy must equal main's, it must contain `sandbox allow-scripts`, and `x-frame-options` must be null.
  - **A5(c):** after the delete, every listed url is fetched and must be 200 with its own bytes (mock 1, 3, 2, in list order).
  - **A6:**
    - Each guard is checked: 400 for a bad slug and for no slug, 404 with a string `error`, 403 for cross-site, and 200 for same-origin and for no header.
    - Three concurrent asks give one body, and it equals the CLI's.
    - Job sharing is untested by design (S2-2).
- **Report.** Its claims match the code.

| ID | Severity | Rule/spec cited | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-1 | Minor | spec A6 "Fails when … a missing artifact looks like a server error, **or the reverse**"; review T1-1 | `test/artifact-versions.test.mjs`; `devteam.mjs` `artifactVersions`'s two new `die`s and the route's 500 branch | **The failure side is unasserted.** No test makes git fail and checks for exit 1 at the CLI or 500 at the endpoint. The T1-1 fix can be reverted (`?? ''` restored), or the route can map every non-ok to 404, and every test stays green. The 404 side is asserted, but "the reverse" is not. Inducing a git failure in a fixture is awkward (for example, a corrupt object or a `GIT_DIR` the child can't read), so this need not block. Fix, if wanted: add a verification.md mutation that shows it, or a test that breaks the fixture's object store and asserts the CLI exits 1 and the endpoint answers 500 `{ error: 'the versions could not be read' }`. | |
| T2-2 | Nit | file style (no dead code) | `test/artifact-versions.test.mjs`, A3/A4 test | `mainCsp.replaceAll(\`${B}/artifact/main/viewer-mock/\`.replace(/\/$/, ''), \`${B}/artifact/main/viewer-mock\`)` replaces a string with itself, so it is a no-op. Compare with `mainCsp` directly. `want = [...r.versions.map(...)]` spreads a fresh array for no reason. Neither changes what is asserted. | |

Verdict: APPROVE 589e79f2beffc064859842552fc80fef9ee52042
