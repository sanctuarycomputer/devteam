# package-release (kit-969)

The tree publishes layout 2, and deploys the box only after the publish (`cutover-tree@1`, `alpha-build@1`, kit-package-dist decision 11). This area owns every release file of the tree: the root `package.json`, `.github/workflows/release.yml`, `.github/workflows/box-deploy.yml` and `test/release/package-check.mjs`. The three patches are made with `git diff --full-index` from an edited copy, so the test can tell a file that drifted on main from a broken patch.

- **`patches/package-json.patch`:** `"devteam": { "layout": 2 }` and `bin { "devteam": "docs/devteam/scripts/cli.mjs" }`; `dependencies` stays `{}`.
- **`patches/release-yml.patch`:**
  - the build job builds each app a second time with `DEVTEAM_BASE_PATH` empty, from a fresh `out/`, and uploads it as the artifact `apps`;
  - check and publish download `apps` and pass `--apps` to the package check, which puts it in `docs/devteam/apps/<app>/`;
  - a `deploy` job, after `publish`, calls `box-deploy.yml` as a reusable workflow. The called workflow sees this run's release event, payload and commit, and gets `RENDER_DEPLOY_HOOK` passed by name (GitHub gives a called workflow an environment's secret only when the caller passes it);
  - a pull request that changes `box-deploy.yml` runs this workflow too.
- **`patches/box-deploy-yml.patch`:**
  - `workflow_call` is its only trigger, so a minor deploys once, after the publish;
  - its concurrency moves to the job;
  - a patch release's minor counts as deployed by a `box-deploy.yml` run (a minor before R) or by a `release.yml` run's `deploy / deploy` job, never by a run that only published;
  - a minor that fails its stamp check is told to cut the next minor: its package is already published, and npm never takes a version twice.
- **`files/test/release/package-check.mjs`**, written whole: `--apps <dir>` is checked like `--alpha` and staged in `docs/devteam/apps/<app>/`; a layout-2 `package.json` may carry exactly that `bin`; a layout-1 one still refuses any `bin`, and `--apps`.
  - It is a file under `test/`, so the parity run judges it as a differing test. `test/split/ledger/tests/release/package-check.mjs.json` accepts it: its `sha256` is this copy's, its `source_sha256` main's text it was made from.
  - When main changes the file, the entry is void and the parity run says so. Remake the copy from main's file with the same changes, and the entry's two hashes, in a ticket that touches both.
- The tree's own tests that pin today's release files (`test/release-workflow.test.mjs` R1, R3 to R7b; `test/machine.box.test.mjs`'s box-deploy cases) fail in the tree. Each is a carry-over ticket, never an edit here (`cutover-tree@1`, F6-4).
- When a file drifts on main and its patch no longer applies, the patch is reported stale. Remake it: edit a copy of the file at HEAD, then `git diff -U3 --full-index` (`-U1` for `package.json`).
- `test/split-release.test.mjs` checks all of it.
