# kit-172 verification

## Done-when

> test/artifact-versions.test.mjs passes in CI: GET /api/artifact-versions?slug= lists the draft (with its worktree) when one is open, the version landed on main, then earlier versions by date from the commits that touched the artifact, each with its commit and time; a version is served read-only by its folder's tree id at /artifact/tree/<id>/, as the kit serves a past version today, with the artifact's usual sandbox

| Part (spec row) | Test in `test/artifact-versions.test.mjs` | Command | Result, commit |
|---|---|---|---|
| landed, then earlier by date, each with its commit and time (A1) | `versions: landed then earlier by date, each with its commit and time` | `env -u TMUX HOME="$(mktemp -d)" timeout 900 node --test --test-concurrency=2 test/artifact-versions.test.mjs` (Node 18.20.4) | 8 pass, 0 fail, 0 skipped at 6c35aed4, and again after merging origin/main at e0fb6e25 |
| the draft, with its worktree, when one is open (A2) | `versions: the draft first, with its worktree and its own commit` | same | same |
| served read-only by tree id at `/artifact/tree/<id>/` (A3) | `a listed version is served read-only at its url, under the artifact sandbox` | same | same |
| with the artifact's usual sandbox (A4) | same test | same | same |
| only servable versions, deduped, kept after a delete (A5) | `versions: only servable, deduped, and kept after a delete` | same | same |
| the endpoint's guards (A6) | `/api/artifact-versions: guards`, `artifact versions: exit 3 when there is nothing`, `a git failure is an error, never "no versions"…` | same | same |
| the 200-version cap (A7) | `versions: capped at 200 versions, not commits` | same | same |
| passes in CI | the whole suite, `test.yml` | `devteam.mjs gate ci -- gh run watch 44088102894 --exit-status` | see CI below |

## Mutations

Each mutation is a string swap in `docs/devteam/scripts/devteam.mjs`, applied to the tree at 6c35aed4. The test file was run once per mutation, and the source was restored with `git checkout` after each run (`git diff --quiet` was clean at the end). The runner is in the session scratch, `kit172-mut/mut.mjs` and `run-all.sh`; the swaps are listed here.

| # | Mutation | Red (tests failing / 8) | Failure |
|---|---|---|---|
| M1 | drafts dropped (`[].filter(...)` in place of `draftArtifacts()`) | A2; A3 | deep-equal on the drafts |
| M2 | cap on commits: `-n 200` on the log, and the slice after the filters removed | A7 | `199 !== 200` |
| M3 | `artifact.json` filter skipped (`if (false)`) | A5 | deep-equal: an unservable tree listed |
| M4 | the route's `sec-fetch-site` check deleted | A6 guards | `200 !== 403` |
| M5 | every tree `url` built as `/artifact/main/<slug>/` | A1; A5; A3 | deep-equal on urls, and wrong bytes |
| M6 | `artifactCsp` without `sandbox allow-scripts` (existing serving code, mutated only to show A4 bites) | A3/A4 | `…: sandboxed` |
| M7 | prefix, last-match parse (`startsWith(folder)`, no `break`): plan-3 P3-1 | A1; A3 | deep-equal: v2 listed at its `img/` subtree |
| M8 | T1-1 reverted: a failed `git log` read is an empty history | git-failure test | `devteam: viewer-mock: no versions` (exit 3, not 1) |
| M9 | the route answers 404 for every failure | git-failure test | deep-equal: 404 where 500 `the versions could not be read` is expected |

## CI

`devteam.mjs gate ci -- gh run watch 44088102894 --exit-status` exited 0 (gate ci passed in 288.4 s). `gh run view 44088102894 --json conclusion,headSha` gives `{"conclusion":"success","headSha":"96132e790bf73754367408a641ff7f6566ee91f2"}`: the full `test.yml`, every job green, at 96132e79, which carries all of this ticket's code. Commits after it change only this ticket's records.
