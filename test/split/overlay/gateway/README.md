# The gateway's overlay area (kit-894)

`test/split/manifest-gateway.json` splits `cloud/gateway.mjs` into `cloud/gateway/base.mjs`, `assets.mjs`,
`server.mjs` and `pages.mjs`. `server.mjs` holds only `createGateway`, which is one declaration of about 2,750
lines, so this manifest's cap is 3,000. Every other module stays under 2,000. The manifest's `templates` names
`CLIENT` and `PAGES`: the browser code in their templates starts at column 0, so the kit's `fileParts` reads it
as declarations, and verify accepts those lines only inside these two.

This area makes the tree's gateway run from its modules:

- `rules.mjs`
  - `here`: `here` is the entry's folder, where `hub.html` and `ttyd.html` sit beside `gateway.mjs` on the box.
  - `gateway-source`: writes `test/lib/gateway-source.mjs`, the gateway's source as the single file had it,
    read from the tree's modules.
  - `entry`: `cloud/gateway.mjs` becomes the entry. It holds the source's header, loads every module in the
    manifest's order, and re-exports exactly what the single file exported. It also runs the command line,
    moved out of `PAGES`'s module, so its main-module check is the entry's own.
  - `test-reads`: each test's read of the gateway's text goes through `gatewaySource()`. The rewrite is
    `rewireGatewayReads`, exported for kit-893's rule, which rewires the CLI's reads in the same files.
- `patches/dockerfile-gateway-modules.patch`: the image copies `cloud/gateway/` beside `gateway.mjs`.

`test/split-gateway.test.mjs` checks all of it.
