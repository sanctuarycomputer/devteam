# `apps-src@1`

- Version: 1
- Between: the contract (this file, both app skeletons, `COMPAT.md`) and every port of a view of `index.html`, `hub.html`, `canvas.html` or `browser.html` into `apps/dashboard` and `apps/hub`.
- Inside: `apps@1` (the apps' place in the package) and `alpha-build@1` (what `npm run build` leaves in `out/`).
- Checked by: `test/apps-build.test.mjs` (this file's parts, the layout, the build, `lib-dist/`) and `test/apps-compat.test.mjs` (`COMPAT.md` and the built pages).

A change to anything below is a new version, `apps-src@2`, in a ticket of its own, with one exception: a shell ticket adds, within version 1, the export list of each view stub it creates (The view stubs' exports). Changing or removing an entry of a list already here is a new version.

## Layout

Each app, `apps/dashboard/` and `apps/hub/`, holds:

| file | what it is |
|---|---|
| `package.json` | `private`, `devDependencies` only, each pinned exactly and published at least 7 days before it was pinned; the same pins in both apps. Its `build` script: `next build && node ../dashboard/scripts/csp-hashes.mjs out && node ../dashboard/scripts/lib-build.mjs`. |
| `package-lock.json` | lockfile version 3; both apps lock the same packages at the same versions. Installed with `npm ci --ignore-scripts`. |
| `.gitignore` | `node_modules/`, `.next/`, `out/`, `lib-dist/`, `next-env.d.ts` |
| `next.config.mjs` | `output: 'export'`, `trailingSlash: true`, `basePath` from `DEVTEAM_BASE_PATH` (empty when unset), images unoptimized, the base path passed to the page as `process.env.DEVTEAM_BASE_PATH`, and `turbopack.root` at `apps/` (so the hub can import the dashboard's `src/shared/`). |
| `tsconfig.json` | the pages' types, in the form `next build` writes it back (committed that way, so a build leaves it unchanged). |
| `tsconfig.lib.json` | `src/lib/**/*.ts` (and in the dashboard `src/shared/**/*.ts`) compiled to ES2020 modules for Node, with ES2020's and the DOM's types and no `jsx`. |
| `src/app/` | the routes (Next's App Router): `layout.tsx`, a `page.tsx` per route, `not-found.tsx`, `app.css`. |
| `src/views/<view>/` | a view's components, `index.tsx` (or `.ts`) first. |
| `src/lib/<module>.ts` | logic with no React and no DOM at import, which `node:vm` tests test today. |
| `COMPAT.md` | the app's compatibility surface (below). |

The dashboard also holds `src/shared/` (shared code), `APPS.md` (this file) and `scripts/`:

- `scripts/csp-hashes.mjs <out>`: the hash step. It reads each exported page as the HTML parser does and writes `out/csp-hashes.json`, `{ "v": 1, "pages": { "<route>": ["sha256-…", …] } }`, one entry per `index.html` keyed by its route without the base path (`/`, `/view/canvas/`), each inline script's hash once. A page it can't read (a script or a tag that never ends) fails the build (exit 1). It also prints each page's inline styles, which a route under `style-src 'self'` must not have.
- `scripts/lib-build.mjs`: `tsc -p tsconfig.lib.json` into a fresh `lib-dist/`, then `lib-dist/package.json` `{"type":"module"}` so Node 18 loads the files as modules. An app with no module yet gets the marker alone.
- `scripts/compat-scan.mjs`: writes both `COMPAT.md` files from the tests at a base, and checks them and the root stubs (`--check`).

**`lib-dist/` keeps `src/`'s folders**: `src/lib/<module>.ts` compiles to `lib-dist/lib/<module>.js`, and `src/shared/<module>.ts` to `lib-dist/shared/<module>.js`. A ported `node:vm` test imports `apps/<app>/lib-dist/lib/<module>.js`. Every `.ts` file in `src/shared/` and `src/lib/` imports no React and touches no DOM at import: it may use `window` or `document` inside a function (the lib compile has the DOM's types), but importing it on Node must not throw, which `test/apps-build.test.mjs` checks for every module in `lib-dist/`. A `.ts` file importing a `.tsx` file fails the lib compile (no `jsx`), and one importing React or Next fails `test/apps-build.test.mjs`: components are `.tsx`, the pages' alone.

Nothing else is directly under `apps/`.

Build, from a clean checkout, on Node 24:

```sh
cd apps/dashboard && npm ci --ignore-scripts && npm run build   # then the same in apps/hub
DEVTEAM_BASE_PATH=/next npm run build                           # the alpha's build, served under /next
```

The pages run the React that Next vendors for the App Router (`next/dist/compiled/react`), not the `react` package the app pins; the pin is for the types and the tools.

## Routes

| app | route | exported as | root view | served at (by `page-seam@1`) |
|---|---|---|---|---|
| `apps/dashboard` | `/` | `index.html` | `shell` | `/`, hash routed as today, and `/view/artifact/<id>`, `/view/preview/<name>` |
| `apps/dashboard` | `/view/canvas/` | `view/canvas/index.html` | `canvas` | `/view/canvas/<slug>` |
| `apps/dashboard` | `/browser/` | `browser/index.html` | `browser` | the browser view server's `/` |
| `apps/hub` | `/` | `index.html` | `hub-shell` | `/` |

No other route. Each route's `page.tsx` renders its root view's `index.tsx` and nothing else. `/browser/` has no inline style: its policy is `style-src 'self'`.

## Paths

Every read of `location.pathname` goes through `appPath()` in `src/shared/paths.ts`:

```ts
export const BASE_PATH: string;                                   // the build's base path: '' or '/next'
export function appPath(pathname?: string, base?: string): string; // pathname without the base path
```

`appPath()` takes `location.pathname` and `BASE_PATH` by default. It strips the base path only where it is a whole leading segment (`/next/view/canvas/x` → `/view/canvas/x`, `/next` and `/next/` → `/`, `/nextish` unchanged) and gives `/` for an empty path. So a check on the path, such as the viewer's `/view/artifact/` or the canvas's slug, holds under `/next` and at the root. A link the page writes into its own markup is root-relative, like `/api/...` (see API calls), or is made with Next's `<Link>`, which adds the base path.

## The view stubs

The contract creates each route's root view as a stub: `src/views/shell/`, `src/views/canvas/`, `src/views/browser/` (the dashboard) and `src/views/hub-shell/` (the hub). A stub's default export renders `<main className="view-stub" data-view="<view>"><h1><view></h1></main>`.

Below it, each root stub exports, typed, every function another view of its page calls from it. Each is

```ts
export function <name>(..._args: unknown[]): never {
  throw new Error('not ported: <view>');
}
```

until the view's port replaces the folder. A port that needs one imports it from the stub. The shell tickets (`shell`, `hub-shell`, `canvas`) create, the same way, a stub `src/views/<view>/index.tsx` (or `.ts`) for every other view of their page, mounted from a fixed path, with the functions other views call from it. A port replaces only its own folder.

The lists below are the scan's (`node apps/dashboard/scripts/compat-scan.mjs --base <base> --stubs` prints the export blocks; `--check` fails when a stub's exported functions differ from them). A function is listed when a line owned by another view of the same page calls it, by its name, at the base.

## Shared code

`apps/dashboard/src/shared/` holds what more than one view or both apps use: the layout CSS and tokens, the shell, the router, the thread layer and the plain-words helpers, as the ports move them in; and from this contract `paths.ts`, `compat.ts`, `poll.ts` and `back-link.tsx`.

The hub imports it as `@shared/<module>` (its `tsconfig.json` maps `@shared/*` to `../dashboard/src/shared/*`; Turbopack's root is `apps/`). The hub holds no copy: there is no `apps/hub/src/shared/`.

## API calls

Every call a page makes to its server is root-absolute: the dashboard's `/api/...` and `/upload` as today, and the hub's `/box.json`, `/instances.json`, `/operator/<action>`, `/operator/threads`, `/push/subscribe` and `/push/test`, which `hub.html` writes relative today. The servers answer them at the origin's root only; under `/next` a relative `box.json` would resolve to `/next/box.json`, which the export folder answers 404. So one build works under `/next` and at the root. Only the page's own files (`_next/`, the routes) carry the base path, which Next adds.

## Third-party code

The pages load code from other origins today: the dashboard's `marked`, DOMPurify, Lucide, mermaid and xterm from jsdelivr, and the Geist fonts from Google Fonts. In the apps, a port either bundles each one (an exact-pinned `devDependency` in both apps, under the same 7-day cooldown, imported by the view) or names its origin in that route's policy beside `'self'` and the hashes. Never a loosening: no `'unsafe-inline'` or `'unsafe-eval'` in `script-src`, no scheme or wildcard source. A dependency the app adds is a change to this file's Layout (the same pins in both apps).

## The compatibility surface

What the kit's tests read of a page stays readable after its port, until the cutover:

- **Globals.** `src/shared/compat.ts`:

  ```ts
  export function expose(name: string, fn: (...args: never[]) => unknown, target?: object): void;
  ```

  sets `window[name] = fn` (or on `target`) once. It throws when the window already holds the name itself (a second registration, or one of its own properties), when the name is not an identifier, or when `fn` is not a function. A name the window only inherits is shadowed: Chrome's `window.when` comes from `EventTarget.prototype`, and the pages' own top-level `const when`, which a test calls as `when(…)`, is registered over it. Every global `COMPAT.md` lists as a function is registered with it by the view that owns it, at the top level of its module: evaluated once per page load, before a test can call it (a global that opens a view, such as `showArtifact`, exists before the view mounts), and never again on a remount. A function that needs a component's state reads it through a module-level ref the component sets. A global listed as a value (`let`/`const` state a test reads or sets) is kept by its view on `window` under the same name, set the same way. With no window (the build prerendering a page on Node) `expose()` registers nothing.
- **The poll.** `src/shared/poll.ts` exports `POLL_MS = 10000`, passed directly to `setInterval(fn, POLL_MS)`: tests speed the poll up by wrapping `setInterval` and matching the delay `10000`.
- **`window.__polls`** is counted by the data loop, as today.
- **Ids, classes, roles and texts** that `COMPAT.md` lists stay on the element its view renders, with the same text.

## COMPAT.md

One per app, `apps/dashboard/COMPAT.md` and `apps/hub/COMPAT.md`, written once by this contract with `node apps/dashboard/scripts/compat-scan.mjs --base <base>` from the tests at its base. Each lists every global, id, class, role and text a test reads of the app's pages, the poll, each test that slices page code under `node:vm`, and the files reading each item, and ends with **Tests by view**: each test file and the views it needs, in the port plan's view names:

- the dashboard: `shell`, `data`, `words`, `overview`, `goals`, `board`, `autonomy`, `settings`, `loop`, `peeks`, `peek-kinds`, `review`, `viewer`, `attachments`, `library`, `threads-core`, `threads-panel`, `thread`, `terminal`; `canvas`, `canvas-panels`, `canvas-sync`, `canvas-editing`, `canvas-history`, `canvas-presence`; `browser`;
- the hub: `hub-shell`, `hub-overview`, `hub-settings`, `hub-threads`.

Port tickets don't edit it. An item a later regular test adds is a carry-over, named in that test's ticket. The files, as written (`test/apps-compat.test.mjs` checks each against its hash, so an edit is a new version of this contract):

- `apps/dashboard/COMPAT.md`: sha256 `392fd85d60295befca3f609ca83decacef2486f08e53735ef4bd58b9f3022bab`
- `apps/hub/COMPAT.md`: sha256 `332a5fccaeb6db3a76f8f8310fa24daba307d4797e332b330f638880e76d314e`

`--check` re-runs the scan at the same base and fails on any difference, in either file or in a root stub's exports.

## The back link

Each app's layout renders `src/shared/back-link.tsx` on every page. Under a base path (the alpha at `/next`) it is

```html
<a class="alpha-back" id="alpha-back" href="/">Back to the stable page</a>
```

the alpha's own way back to the stable page (`alpha@1`), styled by `app.css` (no inline style). At the root it renders nothing. It is decided at build time from the base path, so the exported HTML and the hydrated page agree.

## Test changes

- They live in the overlay area `test/split/overlay/apps-tests/`: `files/test/<name>` for a replaced test file, `patches/<name>.patch` for a changed one.
- Each test file belongs to exactly one ticket, and its ledger entry, `test/split/ledger/tests/<test file>.json`, is written in that ticket.
- A ported `node:vm` test keeps its file name, test names and cases, and imports from `apps/<app>/lib-dist/lib/<module>.js` (or `lib-dist/shared/`) in place of slicing the page.
- The entry's hash covers the test's final text in the tree, after every overlay area (the `tests/` area applies after `apps-tests/`), and is checked against a PR diff touching the overlay path that produces it.
- This contract adds two tests on main, `test/apps-build.test.mjs` and `test/apps-compat.test.mjs`. Each skips, saying why, where no app is built, so CI on main is unaffected; the parity run, which builds both apps, runs them.

## The view stubs' exports

### `apps/dashboard/src/views/shell/index.tsx`

The shell view (index.html at 8ea96ace). Its 34 functions other views call:

- `bindDbTable`: line 1688; called by autonomy
- `bindFleetSwitch`: line 1761; called by settings
- `bindTabBar`: line 1634; called by autonomy, goals, threads-panel
- `closeTarget`: line 1899; called by peeks, threads-panel
- `dbTable`: line 1677; called by autonomy
- `decSubject`: line 2028; called by loop
- `dur`: line 2031; called by autonomy, peeks
- `empty`: line 2053; called by attachments, autonomy, board, data, goals, library, peek-kinds, peeks, review, terminal, threads-panel, viewer
- `esc`: line 1956; called by attachments, autonomy, board, data, goals, library, loop, overview, peek-kinds, peeks, review, settings, terminal, thread, threads-panel, viewer, words
- `fleetSwitch`: line 1748; called by settings
- `fmtDate`: line 2032; called by board, loop, overview, peek-kinds, peeks
- `goalSteps`: line 1710; called by goals
- `headFor`: line 1874; called by autonomy, board, data, goals, threads-panel, viewer
- `heartbeat`: line 1720; called by goals, peek-kinds
- `isDone`: line 2033; called by board, peek-kinds, peeks
- `nextSort`: line 1676; called by autonomy
- `parseHead`: line 1846; called by autonomy, board, data, goals, threads-panel, viewer
- `pct`: line 2034; called by autonomy, board, overview
- `props`: line 1706; called by autonomy, library, peek-kinds, peeks
- `rememberedFilters`: line 1905; called by board
- `saveFilters`: line 1914; called by board
- `sectionPage`: line 1991; called by threads-panel
- `shellPages`: line 1784; called by peeks
- `shellText`: line 1591; called by loop
- `showPage`: line 1975; called by data
- `stampFor`: line 1883; called by data
- `statusPill`: line 1744; called by overview
- `storedFilters`: line 1904; called by board
- `subj`: line 2026; called by autonomy, board, data, goals, library, loop, review, words
- `tabBar`: line 1602; called by autonomy, goals, threads-panel
- `ttPeekPlace`: line 2016; called by data, peeks, threads-panel
- `viewOnly`: line 9567; called by data
- `viewToast`: line 9529; called by viewer
- `withPage`: line 1897; called by board, threads-panel

### `apps/dashboard/src/views/canvas/index.tsx`

The canvas view (canvas.html at 8ea96ace). Its 33 functions other views call:

- `$`: line 298; called by canvas-history, canvas-panels
- `clamp`: line 520; called by canvas-editing, canvas-history, canvas-panels, canvas-presence
- `color`: line 570; called by canvas-panels
- `drawPage`: line 1042; called by canvas-panels, canvas-sync
- `fail`: line 334; called by canvas-presence
- `finite`: line 519; called by canvas-editing, canvas-history, canvas-panels
- `font`: line 601; called by canvas-history, canvas-panels
- `fontWords`: line 605; called by canvas-panels
- `frameOk`: line 340; called by canvas-presence, canvas-sync
- `getPath`: line 685; called by canvas-editing, canvas-history, canvas-panels
- `hideMsg`: line 329; called by canvas-panels, canvas-sync
- `imageFile`: line 654; called by canvas-history
- `imagesSettled`: line 504; called by canvas-panels
- `isObj`: line 299; called by canvas-history, canvas-panels, canvas-presence, canvas-sync
- `isRef`: line 521; called by canvas-panels
- `kidsOf`: line 684; called by canvas-editing, canvas-history, canvas-panels, canvas-sync
- `layout`: line 825; called by canvas-panels
- `mark`: line 758; called by canvas-panels
- `nodeOf`: line 683; called by canvas-editing, canvas-history, canvas-panels, canvas-presence, canvas-sync
- `own`: line 300; called by canvas-editing, canvas-history, canvas-panels, canvas-presence, canvas-sync
- `pageById`: line 366; called by canvas-editing, canvas-history, canvas-panels, canvas-sync
- `pageName`: line 367; called by canvas-history, canvas-panels
- `pages`: line 365; called by canvas-history, canvas-panels
- `pathOk`: line 634; called by canvas-history
- `pick`: line 533; called by canvas-editing, canvas-panels
- `ref`: line 557; called by canvas-panels
- `renderPages`: line 403; called by canvas-panels, canvas-presence, canvas-sync
- `renderPageSel`: line 489; called by canvas-presence, canvas-sync
- `setState`: line 323; called by canvas-panels, canvas-presence
- `showMsg`: line 324; called by canvas-panels, canvas-sync
- `showRepo`: line 346; called by canvas-presence
- `size`: line 768; called by canvas-panels
- `token`: line 536; called by canvas-sync

### `apps/dashboard/src/views/browser/index.tsx`

The browser view (browser.html at 8ea96ace). No other view calls a function of it.


### `apps/hub/src/views/hub-shell/index.tsx`

The hub-shell view (hub.html at 8ea96ace). Its 7 functions other views call:

- `bindFleetSwitch`: line 682; called by hub-overview
- `fleetSwitch`: line 669; called by hub-overview
- `frameFor`: line 982; called by hub-overview
- `hubAddr`: line 1432; called by hub-threads
- `select`: line 964; called by hub-overview
- `setFleet`: line 1137; called by hub-overview
- `tlHash`: line 1337; called by hub-threads

