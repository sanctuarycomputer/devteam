# apps-gateway (kit-1021)

In the tree, the box's gateway serves the built hub app (`apps@1` Serving in the gateway, `page-seam@1`). Nothing in `createGateway` changes: this area overrides exactly page-seam@1's three gateway names, which the gateway manifest puts in `cloud/gateway/assets.mjs`. Each override uses only names that module already has (`env`, `here`, `fs`, `path`, `alphaServe`, `alphaCsp`, `alphaHashes`), so no import changes. The CLI's pages are `apps-serve`'s area (kit-984).

- **`overrides/`**, each pinned to the declaration at the commit it was written against, none naming a source (each name is declared once, in `cloud/gateway.mjs`):
  - `gatewayHubPage`: the hub is a folder, the first non-empty string of `DEVTEAM_HUB_APP`, `opts.hubApp` and `<gateway dir>/../docs/devteam/apps/hub/`, made absolute. It returns `{ dir }`, reads nothing and never throws. `opts.hubPage` and `DEVTEAM_HUB_PAGE` aren't read in the tree.
  - `serveGatewayHub`: the hub route (`/`, `/index.html`) sends the build's `index.html`, read on each request, under `alphaCsp(hubCsp, <the / hashes>)`: `script-src 'self'` and the hashes, `style-src 'self' 'unsafe-inline'`, `font-src 'self'` after `img-src`. The headers are main's, in main's order, with `content-length`.
    - No folder or no `index.html` (ENOENT): 503, apps@1's notice, under the policy with no hashes.
    - An `index.html` whose real path is outside the folder's or isn't a regular file, any other read error, or a `csp-hashes.json` `alphaHashes` refuses: 500 `this page could not be read`, with no policy.
  - `serveGatewayAsset`: the rest of the export, for a signed-in GET on the box's name that no route took, by the gateway's copy of the static rules (`alphaServe`, at the root). An html file gets its own route's hashes. Every answer carries `x-frame-options: DENY`, no referrer and the box's HSTS. A path with no file is the gateway's own 404, byte for byte as at main (alphaServe's 404 is never sent).
- **Reserved first segments.** A request whose first segment (decoded once, any case) is one of the gateway's own is never served from the build: `.devteam`, `alpha.json`, `api`, `auth`, `box.json`, `build`, `c`, `dev`, `instances.json`, `manifest.webmanifest`, `memory.json`, `next`, `operator`, `public`, `push`, `sw.js`, `token`, `upload`, `w`. Some of those route families pass paths on to the last 404, so without the list a build file named like them would answer for a gateway route. When main adds a route under a new first segment that lets some paths through to the 404, add the segment to the list in `serveGatewayAsset.mjs` (and re-pin nothing: the list is the override's own text).
- No rules, no files, no patches. This ticket's test patches are in `apps-tests/`, each with its entry in `test/split/ledger/tests/`.

**When it goes stale** (a regular PR changes one of the three declarations in `cloud/gateway.mjs` on main):
- The parity run reports it, and `test/split-apps-gateway.test.mjs` skips its checks, naming the drift.
- To re-pin an override, merge main and look at the declaration's new text. Carry the change into the override, then set its pin to 64 zeros, split, and copy the `it is now sha256:<x>` value from the stale report into line 1.

`test/split-apps-gateway.test.mjs` checks all of it.
