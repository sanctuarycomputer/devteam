# apps-serve (kit-984)

In the tree, the CLI's servers serve the built apps (`apps@1` Serving, `page-seam@1`). A build is at `docs/devteam/apps/<app>/`: the parity run copies each `apps/<app>/out/` there, built at the root. In a package from R on, it is the installed package's own folder. Nothing in `createGateway` or the route functions changes. The gateway's hub is `kit-1021`'s area.

- **`overrides/`**, each pinned to the declaration at the commit it was written against:
  - `servePage`: the dashboard's `/`, `/index.html`, `/view/artifact/<id>` and `/view/preview/<name>` serve the dashboard build's `index.html`. The laptop hub's `/` serves the hub build's, and `browserViewServer`'s `/` serves the dashboard build's `browser/index.html`. Each keeps today's whole policy with `script-src 'self'` plus that route's hashes from `csp-hashes.json`, and `style-src` with `'self'` added (the browser view's is `'self'` alone). The hub also gets `font-src 'self'` and `img-src 'self' data:`.
    - With no build, the route is a 503 notice.
    - With a bad `csp-hashes.json`, the route is a 500.
  - `pageVersion`: `x-devteam-page` is the first 16 hex of the sha256 of the build's route `index.html`.
  - `servePageAsset`: the rest of the export, through `serveAppFiles`, only for requests no route took.
    - On the dashboard, the review helpers come from the build's `review/` (the app's `public/review/`), and reserved first segments (`api`, `upload`, `public`, `review`, `view`, `browser`, `artifact`, `public-manifest`, `presence`) are never served from the export.
    - On the hub, every file.
    - On the browser view, `/_next/…` only.
  - `kitWatched`: the kit watch watches each build's route `index.html` (a rebuild changes it) in place of `dashboard/*`.
  - `IMAGE_RUNS`: `apps/hub/**` and `apps/dashboard/src/shared/**` replace `hub.html` in `files`, and `serveAppFiles` joins `parts`, so a change to the hub or to the code it shares is a minor.
- **`patches/`**, each made with `git diff -U3 --full-index` from an edited copy:
  - `gitignore.patch`: `docs/devteam/.gitignore` ignores `apps/`;
  - `devteam-mjs-kitwatched.patch`: the tree's `docs/devteam/scripts/devteam.mjs` is still the whole script until the entry cutover, and the kit-watch tests run it, so its `kitWatched` is the override's text too (ruling `a-20261127-064041006-supervisor`). W2 holds the two equal. It goes stale when the lines around `kitWatched` change on main; remake it as the others, from the override's text;
  - `devteam-mjs-servepage.patch` (kit-1035): for the same reason, every tree test that starts the CLI runs that whole script, so its `servePage`, `pageVersion` and `servePageAsset` are the overrides' text too, each with its own comment and without the pin line. Without the patch, its dashboard and hub `/` are a 500 and the browser daemon dies on the deleted `dashboard/browser.html`. W3 holds the three declarations equal to the overrides, and M1-M3 run its dashboard, hub and browser daemon. It goes stale when the lines around those declarations change on main; remake it as the others, from the overrides' text;
  - `box-image-yml.patch`: the path filter names both folders in place of `hub.html`;
  - `test-yml.patch`: a `build-apps` job (Node 24) builds both apps once, and every `kit` shard needs it and places `out/` and `lib-dist/` before it runs (a shard that places no build fails there).
- The policy builder is written twice, inside `servePage` and inside `servePageAsset`, between `// policy builder start` and `// policy builder end`. An override replaces one declaration, so there is no shared helper. `test/split-apps-serve.test.mjs` A3 holds the two copies equal.

**When it goes stale** (a regular PR changes one of these declarations, `.gitignore`, `box-image.yml`, `test.yml` or the lines around `kitWatched` in `devteam.mjs` on main):
- The parity run reports it, and `test/split-apps-serve.test.mjs` skips the checks that read it, naming the drift.
- To re-pin an override, merge main and look at the declaration's new text. Carry the change into the override, then set its pin to 64 zeros, split, and copy the `it is now sha256:<x>` value from the stale report.
- To remake a patch, edit a copy of the file at HEAD and run `git diff -U3 --full-index`.

**The area `apps-tests`** (this ticket's too, one patch per test file, each with its entry in `test/split/ledger/tests/`): `dashboard.kit-watch.test.mjs` appends to `docs/devteam/apps/dashboard/index.html` (its folder made first) and writes `docs/devteam/apps/hub/index.html` in place of a new stylesheet, expecting `kit files changed (apps/…/index.html)`. `dashboard.kit-watch-pane.test.mjs` makes the same append. When one goes stale (that test changed on main), remake its patch from an edited copy at HEAD and write its entry again with both hashes. K1 checks both.

The tree's own tests that pin today's `IMAGE_RUNS` text or today's page policies fail in the tree. Each is a carry-over ticket, never an edit here (`cutover-tree@1`).

`test/split-apps-serve.test.mjs` checks all of it.
