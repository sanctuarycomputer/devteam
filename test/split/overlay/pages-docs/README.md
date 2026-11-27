# pages-docs (kit-898)

The tree drops the old pages, and the kit's README names the CLI's new paths (`cutover-tree@1`).

- **The old pages are deleted:** `docs/devteam/dashboard/` `index.html`, `hub.html`, `canvas.html`, `browser.html`, `devteam-ui.js` and `devteam-ui.css`. Every test still reading them fails into the parity report.
  - `files/` writes each one empty, and `patches/delete-pages.patch` deletes the six empty files.
  - `git apply` deletes a file only when the patch carries all of its text. The empty stand-ins let the deletion apply whatever the page holds at the commit, so it never goes stale as the pages change on main.
- **`patches/readme.patch`:** where the README names `devteam.mjs`'s code (the layout list and the release paragraph's `IMAGE_RUNS`), it names the shim, the entry and the modules (`docs/devteam/scripts/lib/<module>.mjs`). A README edit to those lines makes it stale. Remake it with `git diff -U1 --full-index` from an edited copy: the test reads the full index line to tell a drifted README from a broken patch.
- `delete-pages.patch` is one patch: if another area writes one of the pages, that page's stand-in conflicts, the patch fails, and all six pages stay (reported stale).
- `test/split-pages-docs.test.mjs` checks both.
