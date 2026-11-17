# kit-172-artifact-versions: final review, pass 1

- Reviewer: kit-172 final reviewer
- Reviewed: 0e2823d413c142eb01e899dd424f075a4e0c0690

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| F1 | Minor | spec "Approach" 1 (landed and earlier: the first-parent walk); quality.md §3 "Scoped" | `test/artifact-versions.test.mjs` | No test covers a `--no-ff` merge or a folder rename on main. The code handles both: my probe found the merge listed at the merge commit with the side branch's final tree, the side-only tree unlisted and served 404, and a renamed folder listed as `landed` under the new slug and `earlier` under the old slug. Nothing fails if a later change breaks these cases. | wont-fix the reviewer's probe shows a --no-ff merge and a folder rename both listed correctly; a test for them would change code after final-1's APPROVE |
| F2 | Minor | spec "Acceptance checks" gate (test.yml, every job green at the head) | PR #325 checks | At the head, `test.yml` was still pending (only kit (20, rest 1/2) had passed). `box-image` / `build` failed on a network flake: curl exit 18 fetching the postgresql.org key during `docker build`. The PR does not touch `cloud/`. The cited green run, 44088102894 at 96132e79, has the same code: only `verification.md` changed since then. The merge should still wait for the head's `test.yml` to go green and for a rerun of `box-image`. | fixed box-image runs again at the head that adds this record (the network flake was curl 18 on postgresql.org); the merge request cites that run green |

## What I checked

- **Done-when, at the head.** I ran `test/artifact-versions.test.mjs` alone (flock, `--test-concurrency=2`, scrubbed env): 8 pass, 0 fail, exit 0. I mapped rows A1–A7 to the tests. They cover the draft first with its worktree and its own commit (null for a plain folder), landed then earlier with commit and committer time, the tree-id URL served 200 with each version's bytes, `sandbox allow-scripts` and no `x-frame-options`, the 200-version cap, and the guards.
- **Security.**
  - A listed tree comes from the same `git log --raw -t -m --first-parent --no-renames <main> -- <folder>` walk as `artifactTreeOk`, with an exact match on the folder path and a `040000` mode, plus an `artifact.json` check. So every listed tree passes the existing serving guard. Serving is unchanged: the `/artifact/tree/` route still runs `artifactTreeOk` on every request.
  - Probe: another slug's tree, the root tree and a commit id under `/artifact/tree/<id>/viewer-mock/` each got 404. So did a tree that existed only on a side branch.
  - The slug is checked against `LINK_ID` in both the route and the CLI. Probe: `..`, `..%2F..%2Fetc`, `viewer-mock%2F..`, `%00`, `%2e%2e`, uppercase and `a/b` each got 400.
  - Worktree names come only from `draftArtifacts` (`draftWorktree`'s `WT_NAME`, the realpath parent check, `review-*`/`tmp-*` excluded, `draftDirOk`'s symlink check). The draft commit is null unless `rev-parse --show-toplevel` resolves to the worktree itself.
  - Every served version I probed (landed, earlier, merged, renamed) carried `sandbox allow-scripts` and no `x-frame-options`.
  - The API's top-level keys are exactly `slug`, `truncated` and `versions`. Main entries have exactly `at`, `commit`, `kind`, `time`, `tree` and `url`; drafts add `worktree` and `fp`, as the spec says. Errors are generic, and the route is same-origin only (403 when `sec-fetch-site` is cross-site).
- **Correctness.** A draft equal to main's copy is left out (`draftArtifacts`' fingerprint rule; A2 tests it). Drafts are sorted by newest `updated_at`; main's entries are in first-parent order, deduped at their newest commit, with an all-zero tree (a deletion) skipped. In my probe, merges listed at the merge commit and renames listed under both slugs, as described in F1. A failed git read exits 1, so the route answers 500, not 404.
- **Mutations.** Each was applied with a string swap and restored with `git checkout`; `git diff --quiet` was clean after each.
  - M2 (cap on commits): the cap test went red.
  - M3 (`artifact.json` filter skipped): A5 went red on a deep-equal.
  - M4 (the route's `sec-fetch-site` check removed): guards went red, `200 !== 403`.
  - My own O1 (the route's `LINK_ID` check removed): guards went red, `500 !== 400`.
  - My own O2 (`startsWith(folder)` with the `break` kept): it survived. It is an equivalent mutant: the pathspec matches only at path-component boundaries, and `-t` prints the folder's own tree line before its subtrees. M7 (no `break`) is the case the worker's test bites.
- **Owner rule (no new files).** The only new files are `test/artifact-versions.test.mjs` and files under `docs/devteam-dev/tickets/kit-172-artifact-versions/` (`docs/devteam-dev/tickets/` exists on main). `devteam.mjs` was edited in place. No Critical.
- **CI.** `gh pr checks 325`: see F2. Run 44088102894 succeeded at 96132e79, and `git diff 96132e79..HEAD` touches only `verification.md`.
- WT left clean at 0e2823d4. My probe test and scripts are in the session scratch (`k172-1/`), outside the repo.

Verdict: APPROVE 0e2823d413c142eb01e899dd424f075a4e0c0690
