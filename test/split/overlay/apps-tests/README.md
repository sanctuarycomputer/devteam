# apps-tests (kit-984)

In the tree, the kit's own tests that read the old pages read the built apps instead (`apps@1`, `cutover-tree@1`). Each patch owns one test file, and each test file has its entry in `test/split/ledger/tests/`.

- `patches/dashboard.kit-watch.test.mjs.patch`: in "a dashboard page file restarts it too", the page appended to is `docs/devteam/apps/dashboard/index.html` (its folder made first), and the second restart is for `docs/devteam/apps/hub/index.html` in place of a new stylesheet. The kit watch watches each build's route `index.html` (apps-serve's `kitWatched`).
- `patches/dashboard.kit-watch-pane.test.mjs.patch`: in "a failed respawn listens again on the old code", the same append to `docs/devteam/apps/dashboard/index.html`.

**When it goes stale** (a regular PR changes one of these tests on main): the parity run reports the patch and voids the entry (its `source_sha256`). Remake the patch from an edited copy at HEAD (`git diff -U3 --full-index`), and write the entry again with both hashes. `test/split-apps-serve.test.mjs` K1 checks both.
