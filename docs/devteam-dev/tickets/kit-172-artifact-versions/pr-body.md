The artifact viewer's version dropdown (kit-92; owner thread t-20261115-020154848-owner) needs a list of an artifact's versions. This adds that list. Every version in it can already be served, so nothing changes in how artifacts are served.

- **`artifact versions <slug> [--json]`** is a new subcommand in `devteam.mjs`, next to `artifact describe`. It lists, in this order:
  - the artifact's drafts, newest first: one per worktree whose copy differs from main's, each with its worktree and `url` `/artifact/wt/<wt>/<slug>/`. A draft's `commit` is the worktree's own `HEAD`. It is `null` when the folder isn't a git checkout of its own, rather than main's `HEAD`;
  - the version landed on main;
  - earlier versions, newest first, taken from one first-parent `git log --raw -t` over the folder. Each has its tree, the commit that landed it, that commit's time, and `url` `/artifact/tree/<tree>/<slug>/`.
- Trees without `artifact.json` can't be served, so they are left out, and a tree that comes back (a revert) is listed once. The list holds at most 200 versions, counted after those filters; `truncated` says when there were more.
- The exit code is 3 when there is nothing at all. A git failure exits 1, so it never looks like "no versions".
- **`GET /api/artifact-versions?slug=`** sits beside `/api/view`. It runs that subcommand in a child process, with one shared run per slug. It answers:
  - 200 with the subcommand's JSON;
  - 404 when there is nothing;
  - 400 for a bad slug;
  - 403 when a `sec-fetch-site` header is present and is not `same-origin`;
  - 500 for any other failure.
- Every listed tree is one `/artifact/tree/<id>/` already serves, under the artifact's usual sandbox. The `/artifact/` route, `artifactTreeOk` and `artifactCsp` are unchanged.

The JSON shape is in `docs/devteam-dev/tickets/kit-172-artifact-versions/spec.md` (Approach). The viewer should read that shape.

## How to verify

- `node --test --test-concurrency=2 test/artifact-versions.test.mjs` passes 8 tests (0 skipped). They run against a real git history and a real dashboard, and cover acceptance rows A1–A7 of the spec.
- Mutations M1–M9 each turn the test they target red: see `docs/devteam-dev/tickets/kit-172-artifact-versions/verification.md`.

## One-way doors

None.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
