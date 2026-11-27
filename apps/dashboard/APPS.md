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
| `package.json` | `private`, `devDependencies` only, each pinned exactly and published at least 7 days before it was pinned; the same pins in both apps. Its `build` script: `next build && node ../dashboard/scripts/csp-hashes.mjs out && node ../dashboard/scripts/lib-build.mjs` (the hub's); the dashboard's writes the design-system page's catalog first: `node ../dashboard/scripts/ui-catalog.mjs && next build && node ../dashboard/scripts/csp-hashes.mjs out && node ../dashboard/scripts/lib-build.mjs`, and it has `dev` (`next dev`) with `predev` (`node ../dashboard/scripts/ui-catalog.mjs`). |
| `package-lock.json` | lockfile version 3; both apps lock the same packages at the same versions. Installed with `npm ci --ignore-scripts`. |
| `.gitignore` | `node_modules/`, `.next/`, `out/`, `lib-dist/`, `next-env.d.ts`; the dashboard's also `src/views/design-system/catalog.gen.ts` (generated) |
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
- `scripts/ui-catalog.mjs`: writes the design-system page's catalog from `src/shared/ui/`, and with `--duplicates` prints the duplicates scan (`apps-src@2`, below).

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
| `apps/dashboard` | `/` | `index.html` | `shell` (`design-system` at `#design-system`) | `/`, hash routed as today, and `/view/artifact/<id>`, `/view/preview/<name>` |
| `apps/dashboard` | `/view/canvas/` | `view/canvas/index.html` | `canvas` | `/view/canvas/<slug>` |
| `apps/dashboard` | `/browser/` | `browser/index.html` | `browser` | the browser view server's `/` |
| `apps/hub` | `/` | `index.html` | `hub-shell` | `/` |

No other route. Each route's `page.tsx` renders its root view's `index.tsx` and nothing else, but `/`'s, which renders the shell through the design-system gate (`src/views/design-system/gate.tsx`, `apps-src@2`): loaded at `#design-system` or `#design-system/<name>` on the app's `/` (`appPath()`), the page shows the design-system view in the shell's place. The page is a hash on `/`, not a route of its own. `/browser/` has no inline style: its policy is `style-src 'self'`.

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

until the view's port replaces the folder. A port that needs one imports it from the stub. A stub's first line is exactly `// apps-src@1 view stub: <view>`; that line is what marks the file a stub, and a port removes it. The shell tickets (`shell`, `hub-shell`, `canvas`) create, the same way and with that first line, a stub `src/views/<view>/index.tsx` (or `.ts`) for every other view of their page, mounted from a fixed path, with the functions other views call from it, listed by the rule below at this contract's base `8ea96ace`; each adds its stubs' lists to this file, under the version-1 exception (Version). A port replaces only its own folder.

A ported view's `index.tsx` (or `.ts`) still exports every name its list gives, each as a top-level `export function`, `export const` or `export let` in that file (a re-export such as `export { esc } from './esc'` is not counted), with the same call shape; it may export more.

The lists below are the scan's (`node apps/dashboard/scripts/compat-scan.mjs --base 8ea96ace --stubs` prints the root stubs' export blocks). `--check` fails while a file still has the stub line and its exported functions differ from its list, and once ported when any listed name is missing from them. A function is listed when a line owned by another view of the same page calls it, by its name, at the base.

**The shell's cycle (kit-988).** The shell imports every dashboard view to mount it, and a ported view imports its shell names from `../shell`. Each name the shell exports is a hoisted `export function` that delegates to modules importing no view, so a view may call it anywhere, at its top level too. A view reads or assigns the shell's page state (`DATA`, `INBOX_D`, `PAGE_VERSION`, `PUBLIC`, `PREVIEWS`, `drafts`) only as `shell.<name>` from `../shell/state`, and calls `viewer()` where `index.html` reads `VIEWER`.

## Shared code

`apps/dashboard/src/shared/` holds what more than one view or both apps use: the layout CSS and tokens, the shell, the router, the thread layer and the plain-words helpers, as the ports move them in; and from this contract `paths.ts`, `compat.ts`, `poll.ts` and `back-link.tsx`.

`apps/dashboard/src/shared/ui/` holds the shared UI components (`apps-src@2`, below), one per file with its specimens beside it; the hub imports one as `@shared/ui/<name>`.

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

  sets `window[name] = fn` (or on `target`) once. It throws when the window already holds the name itself (a second registration, or one of its own properties), when the name is not an identifier, or when `fn` is not a function. A name the window only inherits is shadowed: Chrome's `window.when` comes from `EventTarget.prototype`, and the pages' own top-level `const when`, which a test calls as `when(…)`, is registered over it. Every global `COMPAT.md` lists as a function is registered with it by the view that owns it, at the top level of its module: evaluated once per page load, before a test can call it (a global that opens a view, such as `showArtifact`, exists before the view mounts), and never again on a remount. A function that needs a component's state reads it through a module-level ref the component sets. A global listed as a value (`let`/`const` state a test reads or sets, such as the hub's `box` and `term`, which the page reassigns) is defined by its view at the top level of its module, once, as `Object.defineProperty(window, name, { get, set, configurable: false })` over the module's own variable, so a test reads the current value and a test's assignment reaches the view. With no window (the build prerendering a page on Node) `expose()` registers nothing.
- **The poll.** `src/shared/poll.ts` exports `POLL_MS = 10000`, passed directly to `setInterval(fn, POLL_MS)`: tests speed the poll up by wrapping `setInterval` and matching the delay `10000`.
- **`window.__polls`** is counted by the data loop, as today.
- **Ids, classes, roles and texts** that `COMPAT.md` lists stay on the element its view renders, with the same text.

## COMPAT.md

One per app, `apps/dashboard/COMPAT.md` and `apps/hub/COMPAT.md`, written once by this contract with `node apps/dashboard/scripts/compat-scan.mjs --base <base>` from the tests at its base. Each lists every global, id, class, role and text a test reads of the app's pages, the poll, each test that slices page code under `node:vm`, and the files reading each item, and ends with **Tests by view**: each test file and the views it needs, in the port plan's view names:

- the dashboard: `shell`, `data`, `words`, `overview`, `goals`, `board`, `autonomy`, `settings`, `loop`, `peeks`, `peek-kinds`, `review`, `viewer`, `attachments`, `library`, `threads-core`, `threads-panel`, `thread`, `terminal`; `canvas`, `canvas-panels`, `canvas-sync`, `canvas-editing`, `canvas-history`, `canvas-presence`; `browser`;
- the hub: `hub-shell`, `hub-overview`, `hub-settings`, `hub-threads`.

Port tickets don't edit it. An item a later regular test adds is a carry-over, named in that test's ticket. The files, as written (`test/apps-compat.test.mjs` checks each against its hash, so an edit is a new version of this contract):

- `apps/dashboard/COMPAT.md`: sha256 `d8ebee942e52a127e0259ae5f58d0910fb6381cb454fc0ab383f899c971a9cff`
- `apps/hub/COMPAT.md`: sha256 `5de826cc8444a7cd05d52532f5d30765e3392a13d7f33c5ef70247c072eb9282`

`--check` re-runs the scan at the same base and fails on any difference in either file, or in a root stub's exports as The view stubs says.

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

## `apps-src@2`

- Version: 2 (this section, with the Layout, Routes and Shared code parts it changes; every other part of the file is version 1's and holds).
- Between: the design-system page (`kit-1040`) and every port, the components' tickets and the sweeps after it.
- Checked by: `test/apps-design-system.test.mjs`, and `test/apps-build.test.mjs` (the dashboard's build string).

**The page.** `/#design-system` on the dashboard's `/`, linked from nowhere: no tab, side-bar entry, `SHELL_ROUTES` entry or link names it. `src/app/page.tsx` renders `<Root><Shell /></Root>`. The gate (`src/views/design-system/gate.tsx`) reads the page's address once, at load: at `#design-system`, or any hash that starts with `#design-system/`, with `appPath()` `/`, the shell's server-rendered markup is left unhydrated (its Suspense boundary waits on a promise that never settles, so no effect of the shell or of a view inside it runs: no data loop, no `/api/` call, no poll, no socket), and the view (`src/views/design-system/index.tsx`), loaded by a dynamic `import()` into a chunk `/` never fetches, takes its place. Anywhere else the gate renders the shell as before. A view's module starts no work at its top level (a fetch, a poll, a socket, a listener; registering a global is not work): it starts in an effect, so a page that never hydrates it runs none of it. The page shows the tokens (every custom property a `:root` rule of the page's stylesheets defines, media rules included, with its value read at run time; colours as swatches) and every component of the catalog with its specimens, its file and its props' names, each under the anchor `#design-system/<name>` (a page loaded at an anchor scrolls to it), with a filter by name and an event list. It follows the system theme, as the dashboard does.

**Components.** `apps/dashboard/src/shared/ui/` holds only:

- `<name>.tsx` (`<name>` in kebab-case): one component, its default export; its props as `export type <Pascal>Props = { … }` or `export interface <Pascal>Props { … }`, whose members the page lists;
- `<name>.specimens.tsx` beside it: `export const specimens: Specimen[]`, at least one, each `{ title: string; note?: string; render: (on: On) => ReactNode }` (from `src/views/design-system/specimen.ts`: `type On = (event: string) => (...args: unknown[]) => void`, `type Specimen = { title: string; note?: string; render: (on: On) => ReactNode }`): one per state worth seeing (default, empty, long text, disabled, error, each variant). `on('<event>')` is the only handler a specimen passes its component, and it only appends `<name> · <title> <event>` to the page's event list;
- `<name>.css`, when the component has CSS of its own, imported by `<name>.tsx`. A component whose classes are in the shared layout CSS uses them as they are.

The page is `src/app/page.tsx` and `src/views/design-system/`. Outside it, a specimens file names the page in one line only, its type's import, `import type { Specimen } from '../../views/design-system/specimen';` (`On` is `Parameters<Specimen['render']>[0]`), and no other file names it. Only the catalog imports specimens.

**The catalog.** `node scripts/ui-catalog.mjs [--ui <dir>] [--out <file>]` (defaults `src/shared/ui/` and `src/views/design-system/catalog.gen.ts`, gitignored) writes the catalog: it imports every `<name>.specimens.tsx`, alphabetically, and lists `CatalogEntry[]`, each `{ name, file, props, specimens }` (`file` repo-relative, `specimens: Specimen[]`), so `next build` type-checks every specimen. It writes only when the text changes, through a temporary file. The `build` script runs it before `next build`, and `predev` before `next dev`, so a new component is only its own files. Its guards, in order; the first refusal ends the run (exit 1, naming the file and why) and nothing is written:

1. an unknown option, or one without its value: exit 2 with the usage;
2. a missing folder: an empty catalog;
3. each entry of the folder is a file named `<name>.tsx`, `<name>.specimens.tsx` or `<name>.css`, `<name>` in kebab-case; anything else (a subfolder, a `.ts` helper, `Foo.tsx`) is refused;
4. per name, alphabetically: specimens or CSS with no component; a component with no specimens file; a specimens file with no `export const specimens`; a specimens file whose `export const specimens … =` isn't an array literal whose first element is an object (`[{`), or whose code has no `title:` or no `render:` / `render(`. The check is a lint over the text, not a parser: it reads it with comments and string bodies blanked (a quote pairs with the next one on its line, so an apostrophe in JSX text blanks up to the next quote on that line). So write the array out, each specimen as `{ title: …, render: (on) => … }` (not the shorthand `render`), not `= LIST.map(…)`; `next build`'s type check of the catalog is the rest.

A component whose props type it can't find lists no props (not a refusal).

**The duplicates scan.** `node scripts/ui-catalog.mjs --duplicates [--apps <dir>]` (default `apps/`) prints `.<class>: <file>, <file>…`, one line per class, sorted by class, its files sorted, for each class defined in the apps' CSS (any `.css` under either app's `src/`) that is one of the classes of the `className` (static: `"…"` or `{'…'}`, each class of it counted) of a JSX tree's outermost element (or a fragment's direct child element) in two or more view folders: `<app>/src/views/<view>/` and `<app>/src/shared/<module>/` other than `ui/` (a `.tsx` directly under `src/shared/` is a module of its own; one directly under `src/views/` isn't counted), each app's folders its own (the dashboard's `views/x` and the hub's `views/x` are two). Elements in `src/shared/ui/` aren't counted: rendering a component is the cure. With none it prints `No duplicates.` It always exits 0: its output is the sweeps' work list and their check.

**The rule for the ports.** Parity and `COMPAT.md` come first. A port renders a control from `src/shared/ui/` only where the catalog at its base has a component whose output is exactly the view's markup for it: the same elements, classes, ids, `data-*` attributes, roles and text. Where it differs, or there is no such component, the port keeps the view's own markup and marks it `// ui-candidate: <name>` for the sweeps. A port adds no file to `src/shared/ui/` and changes no component there.

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

### `apps/dashboard/src/views/attachments/index.tsx`

The attachments view (index.html at 8ea96ace). Its 13 functions other views call:

- `avUploadOff`: line 8558; called by viewer
- `chipsHtml`: line 8433; called by thread, words
- `drawPills`: line 8313; called by thread
- `dropBox`: line 8312; called by threads-panel, words
- `filesWords`: line 8330; called by data, thread
- `isFilled`: line 8447; called by thread, words
- `markAnswered`: line 8632; called by data, review
- `moveAttach`: line 8322; called by thread
- `putAttach`: line 8345; called by data, thread
- `qcardOf`: line 8631; called by data, words
- `seenHash`: line 8621; called by data, review, viewer
- `sendable`: line 8333; called by data, thread
- `takeAttach`: line 8339; called by data, thread

### `apps/dashboard/src/views/autonomy/index.tsx`

The autonomy view (index.html at 8ea96ace). Its 17 functions other views call:

- `bindPageTables`: line 2300; called by loop, peek-kinds, settings
- `effNum`: line 2110; called by overview
- `fpRow`: line 5797; called by peek-kinds
- `govBlockAt`: line 2572; called by threads-core, threads-panel
- `loadGovernance`: line 2526; called by data
- `navCounts`: line 2282; called by data
- `openClass`: line 2455; called by data, peeks
- `openSensor`: line 5854; called by data, peeks
- `pageTable`: line 2296; called by loop, peek-kinds, settings
- `renderAwareness`: line 2513; called by data
- `renderEfficiency`: line 2089; called by data
- `renderGovernance`: line 2556; called by data
- `renderMonitoring`: line 5840; called by data
- `renderTrust`: line 2421; called by data
- `retroCards`: line 2690; called by data
- `spark`: line 2115; called by overview
- `suggPageOf`: line 2479; called by threads-panel

### `apps/dashboard/src/views/board/index.tsx`

The board view (index.html at 8ea96ace). Its 15 functions other views call:

- `attLine`: line 2940; called by goals
- `boardCols`: line 2946; called by peek-kinds, peeks
- `burnup`: line 2753; called by peeks
- `drawFilterPage`: line 3063; called by data, overview
- `drawFilters`: line 3023; called by data
- `filterHead`: line 3074; called by data
- `filtersNow`: line 2988; called by library, loop
- `filterTickets`: line 2719; called by peek-kinds
- `forecast`: line 2731; called by overview, peeks
- `meterRow`: line 2830; called by peeks
- `needsAttention`: line 2897; called by goals
- `pillsOf`: line 2936; called by goals
- `renderBoard`: line 3086; called by data
- `renderProgress`: line 3110; called by data
- `setFilters`: line 3010; called by overview

### `apps/dashboard/src/views/data/index.tsx`

The data view (index.html at 8ea96ace). Its 17 functions other views call:

- `answerPress`: line 8273; called by review
- `cardFields`: line 8222; called by review
- `drawOrHold`: line 12284; called by settings
- `goHead`: line 8020; called by peeks, threads-panel
- `inboxCount`: line 12389; called by shell, threads-panel
- `inboxTitle`: line 12401; called by shell, threads-panel
- `letGo`: line 12270; called by goals
- `load`: line 12322; called by library, overview, peek-kinds, peeks
- `ownerLesson`: line 12383; called by peek-kinds, words
- `press`: line 8183; called by goals, review, settings, thread, viewer
- `putBackCard`: line 8225; called by review
- `redrawNow`: line 8174; called by goals, settings
- `render`: line 9589; called by autonomy, settings, shell
- `route`: line 8056; called by shell, viewer
- `showHead`: line 8027; called by threads-panel
- `staleNote`: line 12371; called by library, shell
- `typingIn`: line 12256; called by peeks, threads-panel, viewer

### `apps/dashboard/src/views/goals/index.tsx`

The goals view (index.html at 8ea96ace). Its 16 functions other views call:

- `activeGoalOrder`: line 4742; called by data
- `ago`: line 4878; called by autonomy, overview, peek-kinds, threads-core
- `drawFleet`: line 4388; called by data, settings
- `fleetLeftPlace`: line 4361; called by settings, shell
- `fleetMode`: line 4337; called by settings
- `fleetStateLine`: line 4340; called by settings
- `goalBlock`: line 4200; called by overview
- `goalState`: line 4227; called by overview, peek-kinds
- `goalStepsOf`: line 4303; called by overview, peek-kinds
- `heartbeatDays`: line 4222; called by peek-kinds
- `holdConfirming`: line 4307; called by data
- `holdControl`: line 4308; called by peek-kinds
- `moveGoal`: line 4764; called by data
- `plannerCards`: line 4883; called by board
- `planningFor`: line 4877; called by peek-kinds
- `renderGoals`: line 4672; called by data, loop

### `apps/dashboard/src/views/library/index.tsx`

The library view (index.html at 8ea96ace). Its 15 functions other views call:

- `avKindDraw`: line 9240; called by attachments, viewer
- `avPopsClose`: line 9261; called by attachments, viewer
- `avPubDraw`: line 9310; called by attachments, viewer
- `avRunDraw`: line 9326; called by attachments, viewer
- `avRunErr`: line 9335; called by attachments, viewer
- `avVerDraw`: line 9248; called by viewer
- `hostHere`: line 8654; called by terminal
- `openLib`: line 9171; called by data, peeks
- `pageHello`: line 8644; called by terminal
- `PEEK_ART_CTX`: line 8888; called by peek-kinds
- `peekArtifacts`: line 8859; called by peek-kinds
- `peekArtSection`: line 8876; called by peek-kinds
- `previewHere`: line 8663; called by words
- `previewLinkHtml`: line 8677; called by words
- `renderLibrary`: line 8894; called by board, data, overview

### `apps/dashboard/src/views/loop/index.tsx`

The loop view (index.html at 8ea96ace). Its 10 functions other views call:

- `correctBtn`: line 5004; called by peeks
- `decideRows`: line 4973; called by peeks
- `fromWords`: line 6467; called by peek-kinds
- `lineageList`: line 6506; called by peek-kinds
- `lineChart`: line 5632; called by autonomy, peek-kinds, peeks
- `loopPlace`: line 6487; called by peek-kinds
- `matchedWords`: line 4950; called by peek-kinds
- `recordHref`: line 6484; called by peek-kinds
- `renderLoop`: line 5088; called by board
- `renderOoda`: line 4900; called by data

### `apps/dashboard/src/views/overview/index.tsx`

The overview view (index.html at 8ea96ace). Its 3 functions other views call:

- `helloLoad`: line 9405; called by data
- `NEXT_ID`: line 9398; called by words
- `renderOverview`: line 9457; called by data

### `apps/dashboard/src/views/peek-kinds/index.tsx`

The peek-kinds view (index.html at 8ea96ace). Its 33 functions other views call:

- `hoursWords`: line 6560; called by loop
- `openAct`: line 6330; called by data, peeks
- `openBuiltin`: line 6129; called by data, peeks
- `openDecision`: line 6367; called by data, peeks
- `openFeature`: line 6259; called by data, peeks
- `openFile`: line 6770; called by data, peeks, review
- `openGoal`: line 6195; called by data, peeks
- `openJob`: line 6069; called by data, peeks
- `openLearning`: line 6606; called by data, peeks
- `openLesson`: line 6431; called by data, peeks
- `openMilestone`: line 6312; called by data, peeks
- `openObservation`: line 6561; called by data, peeks
- `openPlanner`: line 6692; called by data, peeks
- `openProblem`: line 6653; called by data, peeks
- `openQuestion`: line 6714; called by data, peeks
- `openRelease`: line 6283; called by data, peeks
- `openRetro`: line 6397; called by data, peeks
- `openSignal`: line 6582; called by data, peeks
- `openStory`: line 6276; called by data, peeks
- `openThread`: line 6672; called by data, peeks
- `openTicket`: line 5891; called by data, peeks
- `openWave`: line 6304; called by data, peeks
- `recEvery`: line 5956; called by settings
- `recKind`: line 5965; called by settings
- `recLast`: line 5969; called by settings
- `recList`: line 5944; called by settings
- `recNext`: line 5967; called by settings
- `recProposals`: line 5977; called by settings
- `recWord`: line 5949; called by settings
- `refetchFile`: line 6759; called by peeks
- `renderMermaid`: line 6867; called by peeks
- `retroDate`: line 6386; called by autonomy
- `signalTitle`: line 6581; called by loop

### `apps/dashboard/src/views/peeks/index.tsx`

The peeks view (index.html at 8ea96ace). Its 36 functions other views call:

- `attrRow`: line 5176; called by autonomy, library, peek-kinds
- `attrs`: line 5288; called by autonomy, peek-kinds
- `closeDrawer`: line 5517; called by data
- `decisionTitle`: line 5205; called by peek-kinds
- `depGraph`: line 5607; called by peek-kinds
- `designBlock`: line 5619; called by peek-kinds
- `diagram`: line 5599; called by peek-kinds
- `drawerFor`: line 5529; called by autonomy, library, peek-kinds
- `fetchPeek`: line 5381; called by data, peek-kinds
- `fmtDay`: line 5203; called by autonomy, peek-kinds
- `fmtObj`: line 5191; called by autonomy, peek-kinds
- `focusBack`: line 5441; called by board, data, words
- `focusMark`: line 5436; called by board, data, words
- `gateTable`: line 5761; called by peek-kinds
- `historySection`: line 5584; called by autonomy, peek-kinds
- `howItChanges`: line 5320; called by peek-kinds
- `list`: line 5200; called by attachments, autonomy, goals, library, peek-kinds, review, settings, shell, threads-panel, viewer, words
- `loadSchemaDocs`: line 5127; called by data
- `notFound`: line 5739; called by autonomy, library, peek-kinds
- `peekFor`: line 5416; called by board, viewer
- `peekHide`: line 5487; called by data, review
- `peekIsOpen`: line 5476; called by data, viewer
- `peekKey`: line 5373; called by autonomy, data, library, peek-kinds
- `peekOf`: line 5374; called by autonomy, peek-kinds, words
- `phaseStrip`: line 5741; called by peek-kinds
- `progressBlock`: line 5724; called by peek-kinds
- `psect`: line 5307; called by autonomy, library, peek-kinds
- `redraw`: line 5425; called by data, peek-kinds
- `refreshDrawer`: line 5400; called by data
- `reviewList`: line 5625; called by peek-kinds
- `share`: line 5202; called by autonomy, shell
- `showDrawer`: line 5450; called by autonomy, library, peek-kinds
- `spendChart`: line 5779; called by peek-kinds
- `threadOn`: line 5313; called by peek-kinds
- `uniq`: line 5738; called by peek-kinds
- `unitOf`: line 5204; called by peek-kinds

### `apps/dashboard/src/views/review/index.tsx`

The review view (index.html at 8ea96ace). Its 13 functions other views call:

- `closeReview`: line 3922; called by data
- `emptyVal`: line 3745; called by peeks
- `fleetMoveReady`: line 4191; called by goals
- `holdState`: line 4192; called by goals, peek-kinds
- `lsDel`: line 3743; called by thread
- `lsGet`: line 3741; called by data, thread, viewer
- `lsSet`: line 3742; called by data, thread, viewer
- `openReview`: line 3868; called by data
- `renderReviewPreview`: line 4021; called by data
- `reviewAnswer`: line 4138; called by data
- `reviewCard`: line 3752; called by words
- `reviewDecline`: line 4165; called by data
- `sitesKey`: line 4079; called by data

### `apps/dashboard/src/views/settings/index.tsx`

The settings view (index.html at 8ea96ace). Its 3 functions other views call:

- `drawSettings`: line 4563; called by data, shell, thread
- `loadFleet`: line 4459; called by data, shell
- `renderJobs`: line 6150; called by data

### `apps/dashboard/src/views/terminal/index.tsx`

The terminal view (index.html at 8ea96ace). Its 4 functions other views call:

- `isTermTab`: line 11862; called by threads-panel
- `termRender`: line 11930; called by threads-panel
- `termSync`: line 11948; called by threads-panel
- `termTabsOff`: line 11878; called by threads-panel

### `apps/dashboard/src/views/thread/index.tsx`

The thread view (index.html at 8ea96ace). Its 18 functions other views call:

- `askDraw`: line 10834; called by threads-panel
- `askSet`: line 10843; called by threads-panel
- `askShown`: line 10807; called by data
- `avFrameLoad`: line 11756; called by viewer
- `thAdopt`: line 11597; called by threads-panel
- `tlCard`: line 10731; called by data, threads-panel
- `tlDraftPrune`: line 10724; called by threads-panel
- `tlDraw`: line 10780; called by threads-panel, viewer
- `tlHeld`: line 11102; called by threads-panel
- `tlMarkRow`: line 10782; called by threads-panel
- `tlPins`: line 11117; called by data, shell, threads-panel
- `tlPinsInto`: line 11143; called by threads-panel
- `tlReplace`: line 10713; called by threads-panel
- `tsFrame`: line 11648; called by threads-panel, viewer
- `tsOn`: line 11649; called by threads-panel, viewer
- `tsPost`: line 11652; called by threads-panel, viewer
- `tsRaise`: line 11657; called by attachments, threads-panel
- `tState`: line 11168; called by threads-panel

### `apps/dashboard/src/views/threads-core/index.tsx`

The threads-core view (index.html at 8ea96ace). Its 22 functions other views call:

- `parseSettingView`: line 9738; called by threads-panel
- `parseSuggView`: line 9744; called by autonomy, threads-panel
- `suggView`: line 9743; called by autonomy
- `tArtPath`: line 10051; called by thread
- `tBytes`: line 9729; called by autonomy, thread
- `tCardState`: line 9864; called by thread
- `tCut`: line 9730; called by autonomy, loop, threads-panel
- `tFit`: line 9827; called by threads-panel
- `tFrameOn`: line 10068; called by threads-panel, viewer
- `tFrameTitle`: line 10058; called by thread
- `tGoRoute`: line 10039; called by threads-panel
- `tKey`: line 9966; called by thread, threads-panel, viewer
- `tLanded`: line 9999; called by threads-panel
- `tLensMessage`: line 10012; called by thread
- `tLine`: line 9735; called by attachments, autonomy, loop, thread, threads-panel
- `tOverlay`: line 9982; called by threads-panel
- `tPendId`: line 9998; called by thread, threads-panel
- `tPendingTurn`: line 9978; called by thread
- `tPins`: line 9969; called by thread, threads-panel, viewer
- `tPlace`: line 9943; called by thread
- `tSubjectAt`: line 9749; called by autonomy, threads-panel
- `tWhere`: line 9952; called by threads-panel

### `apps/dashboard/src/views/threads-panel/index.tsx`

The threads-panel view (index.html at 8ea96ace). Its 47 functions other views call:

- `dataAnswered`: line 10532; called by thread
- `inboxAt`: line 10270; called by data
- `inboxGo`: line 10262; called by data
- `inboxTyping`: line 10097; called by data
- `inInbox`: line 10089; called by thread
- `tArtFpNow`: line 10502; called by thread
- `tHad`: line 10948; called by thread
- `thBack`: line 11561; called by thread
- `thButton`: line 11236; called by data
- `thCarry`: line 11438; called by data
- `thDraw`: line 11259; called by data, terminal, thread
- `thEscapePage`: line 11522; called by data
- `thFreshness`: line 11432; called by data
- `thGo`: line 11314; called by shell, thread
- `thOpenRow`: line 11576; called by thread
- `thRemember`: line 11414; called by data
- `thRoute`: line 11347; called by data
- `thWidth`: line 11536; called by terminal, thread
- `tlCardFrame`: line 10507; called by thread
- `tlClose`: line 10912; called by data, thread
- `tlCtx`: line 10512; called by thread
- `tlCursor`: line 10119; called by thread
- `tlEl`: line 10085; called by thread
- `tlFloating`: line 10101; called by data, thread
- `tlHide`: line 10147; called by attachments, thread
- `tlHome`: line 10283; called by thread
- `tlInboxHome`: line 10293; called by thread
- `tlInPanel`: line 11541; called by thread
- `tlLeave`: line 10438; called by data
- `tlMark`: line 10127; called by thread
- `tlOpen`: line 10929; called by data, thread, viewer
- `tlOwn`: line 10090; called by thread
- `tlPinMode`: line 10154; called by attachments, thread
- `tlRef`: line 10518; called by thread
- `tlRefresh`: line 10875; called by data, thread, viewer
- `tlRelay`: line 10904; called by thread
- `tlRoute`: line 10405; called by data
- `tlRowOf`: line 10308; called by thread
- `tlSection`: line 10103; called by autonomy
- `tlSettingOf`: line 10303; called by thread
- `tlShowing`: line 10098; called by attachments, thread
- `tlStart`: line 10214; called by autonomy, loop, thread
- `tlSuggOf`: line 10306; called by thread
- `tlTargetRect`: line 10309; called by thread
- `tlVisible`: line 10304; called by thread
- `tsPins`: line 10486; called by attachments, thread, viewer
- `tsWatch`: line 10473; called by thread

### `apps/dashboard/src/views/viewer/index.tsx`

The viewer view (index.html at 8ea96ace). Its 23 functions other views call:

- `artSrc`: line 6920; called by library
- `artViewer`: line 6922; called by library, words
- `avFpSeen`: line 7009; called by data
- `avFreshFrame`: line 6903; called by attachments
- `avHeader`: line 6910; called by library
- `avHint`: line 6993; called by attachments
- `avNotes`: line 7241; called by thread
- `avRecipient`: line 7726; called by threads-core
- `avShowMe`: line 7607; called by thread, threads-panel
- `avStep`: line 7327; called by shell, thread
- `closeArtifact`: line 7913; called by attachments, data
- `leaveArtifact`: line 7959; called by data, thread
- `openArtifact`: line 7201; called by data, threads-panel
- `openPreview`: line 7180; called by data, threads-panel
- `previewInfo`: line 7178; called by data
- `pvViewer`: line 7115; called by library
- `showArtifact`: line 6951; called by data, library
- `showPreview`: line 7131; called by data
- `tNoteState`: line 7234; called by thread, threads-core, threads-panel
- `tsBar`: line 7117; called by data, thread
- `tsForget`: line 6933; called by attachments, thread
- `tShot`: line 7631; called by thread, threads-panel
- `tsSet`: line 6939; called by attachments

### `apps/dashboard/src/views/words/index.tsx`

The words view (index.html at 8ea96ace). Its 49 functions other views call:

- `actUnder`: line 3171; called by peek-kinds
- `actView`: line 3225; called by loop, peek-kinds, peeks
- `allQuestions`: line 3135; called by peek-kinds
- `answeredCard`: line 3646; called by data, peek-kinds
- `approvedBy`: line 3178; called by peek-kinds, peeks
- `artHref`: line 3553; called by library, threads-panel, viewer
- `authorityWords`: line 3158; called by loop, peek-kinds
- `cap`: line 3128; called by autonomy, board, data, goals, overview, peek-kinds, peeks, review, viewer
- `cardHead`: line 3521; called by autonomy, data, goals, review, settings
- `cardMenu`: line 3515; called by autonomy, board
- `choicesOf`: line 3273; called by data, peek-kinds
- `dlink`: line 3169; called by peek-kinds, peeks, threads-panel
- `featureTitle`: line 3139; called by board, peek-kinds
- `fileHref`: line 3526; called by library, peeks
- `flink`: line 3140; called by board, library, peek-kinds, peeks
- `glink`: line 3146; called by peek-kinds, peeks, threads-panel
- `goalOf`: line 3144; called by board, peek-kinds
- `isOa`: line 3297; called by data
- `keepSecretDrafts`: line 3418; called by data
- `linkify`: line 3180; called by autonomy, data, library, loop, peek-kinds, peeks, settings, thread
- `linkOf`: line 3560; called by peek-kinds, peeks, review
- `menuOf`: line 3513; called by library
- `milestonesOf`: line 3145; called by board, peek-kinds
- `mlink`: line 3147; called by peek-kinds, peeks
- `nextChip`: line 3455; called by review
- `nextTime`: line 3435; called by review
- `oaConfirming`: line 3318; called by data
- `oaOpen`: line 3351; called by data
- `oaPaint`: line 3373; called by data, peeks
- `oaSig`: line 3388; called by thread
- `oaState`: line 3320; called by data
- `qblock`: line 3613; called by peek-kinds, review, thread
- `qinline`: line 3589; called by peek-kinds, review, thread
- `qlink`: line 3138; called by goals, loop, peek-kinds, peeks, threads-panel
- `qplain`: line 3644; called by review
- `questionCard`: line 3456; called by data, peek-kinds, thread
- `rankWhy`: line 3439; called by review
- `restoreSecretDrafts`: line 3424; called by data
- `rlink`: line 3142; called by board, peek-kinds, peeks
- `scopeWords`: line 3156; called by data, loop, peek-kinds, peeks
- `slink`: line 3141; called by board, peek-kinds, peeks
- `subjectLink`: line 3155; called by peeks
- `ticketMap`: line 3134; called by autonomy, board, library, peek-kinds, peeks, thread, viewer
- `tlink`: line 3137; called by peek-kinds, peeks, review, threads-panel
- `toB64`: line 3432; called by data
- `when`: line 3124; called by autonomy, board, data, goals, library, loop, peek-kinds, peeks, review, settings, shell, thread, threads-core
- `who`: line 3136; called by autonomy, data, loop, peek-kinds, peeks, review, thread, threads-core, viewer
- `wlink`: line 3143; called by board, peek-kinds
- `words`: line 3129; called by autonomy, board, goals, library, loop, overview, peek-kinds, peeks, review, shell, thread, threads-core, threads-panel, viewer

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

