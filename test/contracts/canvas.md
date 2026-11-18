# The design canvas

Contracts `canvas-doc@1` (the document, `canvas.json`) and `canvas@1` (the `/canvas` socket and the `/api/canvas/…` routes). `test/canvas-contract.test.mjs` holds this document, its fixtures (`test/fixtures/canvas/`) and its fake server and rules as code (`test/lib/canvas-fake.mjs`, §14) to one another: the tables under the `###` headings below are read by the test and compared with the code's tables both ways, so a row missing on either side, or a class, default, code or number that differs, fails it.

Sizes are bytes of UTF-8; a KB is 1024 bytes and an MB is 1048576. Characters are code points.

## 1. Consumers and providers

Provided by `canvas.mjs` (the document's rules, the exporters, the importer) and the dashboard server's canvas sessions (the socket and the routes), later tickets of the design `a-design-canvas-designers-can-work-in.md`. Used by the editor page, the CLI's `canvas` commands (`show`, `apply`, `checkout`, `take`, `land`), the exporters (web, tokens, spec, SwiftUI) and the Figma importer. The fake (§14) and the fixtures stand in for the server in every canvas test until the real one exists, and the real server's tickets replay the same fixtures.

Version: `canvas: 1` in the document and in `welcome`; additive changes only, anything else bumps it. The reader's half of additive: a reader ignores keys and message kinds it doesn't know. The exact shapes below are what a writer sends; the fixtures and the fake hold to them exactly.

Consumes `presence@1` (`test/contracts/presence.md`): its §2 to §4 (the handshake and guards, frames, close codes, who you are), by reference; its `at` and `move` for cursors on a canvas (§9); `cutName` and `ID_RE` imported from its fake. Nothing in `presence@1` changes. Documents `artifact-notes@1`'s node anchor (§10) without changing that contract's code.

## 2. The document: canvas-doc@1

A folder is a canvas when it holds `canvas.json`; `artifact.json` is unchanged, and images are files under `images/`. The document is exactly `{ "canvas": 1, "rev": <integer ≥ 0>, "tokens": {…}, "pages": [ … ], "nodes": { … } }`:

- **Pages**: 1 to 100, each exactly `{ "id", "name", "children" }`, `name` of the `name` class, `children` the ordered ids of its top-level nodes. A page is not a node and `page` is not a node type.
- **Nodes** are a flat map by id. Every node has `type` and `parent` (a page id, or a `frame` or `component` id); `frame` and `component` also have `children` (ordered ids), and no other type has the key. A node holds no `id` key: its key in `nodes` is its id. The tree is exact: each node's parent exists and lists it once, each listed child exists and names that parent, every node is reached from a page.
- **Ids** are 1 to 40 of `[A-Za-z0-9_-]`, unique across pages and nodes. Whoever makes a node names it `<prefix>-<counter>`, the prefix 6 random base-36 characters chosen once per page load or command run.
- **Types**: `frame`, `text`, `rect`, `ellipse`, `vector`, `image`, `component`, `instance`. A `component` never sits inside another component, at any depth (instances of other components may). Depth counts a page's children as 1; at most 100.
- **Properties are dotted paths** (`layout.gap`, `size.w`), stored nested (`"layout": { "gap": 12 }`), so last-writer-wins applies per real property. Map entries are paths too: `props.<name>`, `variants.<name>`, `variants.<name>.<id>.<prop>`, `overrides.<id>.<prop>`, so two people overriding different nodes of one instance don't overwrite each other. The whole maps (`props`, `variants`, `overrides`) are settable too, for an importer or a `take` that replaces them. An override's properties are stored as flat dotted keys, `"overrides": { "k1-2": { "layout.gap": 4, "text": "Hi" } }`, and `overrides.k1-2.layout.gap` addresses one: an id holds no dot, so the path splits at its second dot (`variants.<name>.<id>.<prop>` at its third).
- **Defaults**: a property not stored has its default (the Properties table). A default of absent means nothing is shown or exported for it. Setting a property whose default is absent (a map entry, `figma`) to null removes it; an override's id map (`overrides.<id>`, `variants.<name>.<id>`) left empty by that goes too, never the variant or a map above it. A required property (`path`, `src`, `component`) can't be removed, and an `add` without it is `shape`.
- **x and y** are allowed on any node and place it only under a parent whose `layout.mode` is `none`: elsewhere they are kept and take no effect, so a `move` or a mode change never cascades. The exporters list nodes placed by hand as loose by their parent's mode.

### Properties

`every` is every node type. `absent`: no default (nothing stored means nothing set); `required`: the node must hold it.

| Type | Property | Class | Default |
|---|---|---|---|
| every | `name` | `name` | `""` |
| every | `visible` | `bool` | `true` |
| every | `opacity` | `opacity` | `1` |
| every | `x` | `dim` | `0` |
| every | `y` | `dim` | `0` |
| every | `size.w` | `sizing` | `"hug"` |
| every | `size.h` | `sizing` | `"hug"` |
| every | `figma` | `figmaId` | absent |
| `frame`, `component`, `rect`, `ellipse`, `vector` | `fill` | `paint` | `null` |
| `frame`, `component`, `rect`, `ellipse`, `vector` | `stroke` | `paint` | `null` |
| `frame`, `component`, `rect`, `ellipse`, `vector` | `strokeWidth` | `len` | `0` |
| `frame`, `component`, `rect`, `image` | `radius` | `len` | `0` |
| `frame`, `component` | `clip` | `bool` | `false` |
| `frame`, `component` | `layout.mode` | `enum`: `none`, `row`, `column`, `grid` | `"none"` |
| `frame`, `component` | `layout.gap` | `len` | `0` |
| `frame`, `component` | `layout.padding` | `padding` | `[0, 0, 0, 0]` |
| `frame`, `component` | `layout.align` | `enum`: `start`, `center`, `end`, `stretch` | `"start"` |
| `frame`, `component` | `layout.justify` | `enum`: `start`, `center`, `end`, `between` | `"start"` |
| `frame`, `component` | `layout.wrap` | `bool` | `false` |
| `frame`, `component` | `layout.columns` | `tracks` | `[]` |
| `frame`, `component` | `layout.rows` | `tracks` | `[]` |
| `component` | `props` | `propDefs` | `{}` |
| `component` | `props.<name>` | `propDef` | absent |
| `component` | `variants` | `variants` | `{}` |
| `component` | `variants.<name>` | `variant` | absent |
| `component` | `variants.<name>.<id>.<prop>` | `override` | absent |
| `text` | `text` | `text` | `""` |
| `text` | `font` | `font` | `{ "family": "sans", "size": 16, "weight": 400, "lineHeight": 1.4 }` |
| `text` | `color` | `color` | `"#000000"` |
| `text` | `align` | `enum`: `left`, `center`, `right`, `justify` | `"left"` |
| `vector` | `path` | `pathData` | required |
| `image` | `src` | `imageSrc` | required |
| `image` | `fit` | `enum`: `cover`, `contain`, `fill` | `"cover"` |
| `instance` | `component` | `componentRef` | required |
| `instance` | `variant` | `variantName` | `null` |
| `instance` | `props` | `propValues` | `{}` |
| `instance` | `props.<name>` | `propValue` | absent |
| `instance` | `overrides` | `overrides` | `{}` |
| `instance` | `overrides.<id>.<prop>` | `override` | absent |

### Value classes

The allow-list: every value is checked against its class before it is applied, and anything outside is refused `value`. A `$ref` is exactly `{ "$ref": "<token path>" }`; whether it resolves, to a token of the right type and range, is the `refs` rule's (`ref`).

| Class | Rule |
|---|---|
| `color` | `#rgb`, `#rrggbb` or `#rrggbbaa`, or a `$ref` to a `color` token |
| `paint` | a `color`, or null |
| `dim` | a finite number −100000..100000, or a `$ref` to a `dimension` token in that range |
| `len` | a finite number 0..100000, or a `$ref` to a `dimension` token in that range (sizes, gap, padding, radius, stroke width: a negative token used as a len is `ref`) |
| `opacity` | a number 0..1 |
| `padding` | exactly four lens, in CSS order: top, right, bottom, left |
| `sizing` | `"hug"`, `"fill"` or a len (fixed) |
| `tracks` | an array of at most 64 tracks, each a number 0..100000, `"auto"` or `"<n>fr"` with n 1..999 |
| `font` | a `$ref` to a `typography` token, or exactly `{ "family", "size", "weight", "lineHeight" }`: family `sans`, `serif`, `mono` or a `fontFamily` ref; size 1..1000 or a `dimension` ref in that range; weight 100..900 by 100 or a `fontWeight` ref; lineHeight 0.5..10 or a `number` ref in that range |
| `pathData` | a string of the SVG path commands `M L H V C S Q T A Z` (either case), numbers, spaces and commas, starting with a move, at most 65536 bytes |
| `imageSrc` | `images/<16 hex>.<ext>`, the hex lower case and the ext `png`, `jpg`, `webp` or `gif`, naming a file in the folder's `images/`; never a URL, `data:` or SVG |
| `name` | a string of at most 200 characters, well-formed (no lone surrogate) |
| `text` | a string of at most 10000 characters, well-formed (no lone surrogate) |
| `figmaId` | 1 to 100 of `[A-Za-z0-9:;_-]` |
| `bool` | `true` or `false` |
| `enum` | one of the words the Class column lists for that property |
| `componentRef` | a node id; the `refs` rule requires a `component` |
| `variantName` | null, or a name of `[A-Za-z][A-Za-z0-9_]{0,39}`; the `refs` rule requires one of the component's variants |
| `propDefs` | an object from prop names (`[A-Za-z][A-Za-z0-9_]{0,39}`) to propDefs |
| `propDef` | exactly `{ "type", "default", "target" }`: `type` `"text"` or `"bool"`; `default` a `text` for a text prop, a bool for a bool prop; `target` exactly `{ "id", "prop" }`, `prop` `"text"` for a text prop and `"visible"` for a bool prop |
| `propValues` | an object from prop names to propValues |
| `propValue` | a `text` or a bool; the `refs` rule requires the component's prop of that name and type |
| `variants` | an object from variant names (`[A-Za-z][A-Za-z0-9_]{0,39}`) to variants |
| `variant` | an object from node ids to objects of overrides, `{ "<prop>": <override> }` |
| `overrides` | an object from node ids to objects of overrides, `{ "<prop>": <override> }` |
| `override` | a value of its target property's own class; the `refs` rule requires the target to be a descendant of the component and the property one of that node's type that may be overridden |

### Components and resolution order

- `props.<name>` (a name of `[A-Za-z][A-Za-z0-9_]{0,39}`, at most 32) is `{ "type": "text"|"bool", "default", "target": { "id": <a descendant>, "prop": "text"|"visible" } }`: a text prop aimed at a `text` node's `text`, a bool prop at any descendant's `visible`. `variants.<name>` (the same identifier, at most 32) maps descendant ids to `{ <prop>: <value> }`.
- An override (a variant's or an instance's) names a descendant of the component and a property of that node's type, never `name`, `figma` (names stay design-time, so no override carries a name) nor a component's or instance's own `component`, `variant`, `props`, `variants` or `overrides`. An override that doesn't resolve is `ref`, so ops within one edit may still set an override before its node is added.
- An instance's `props.<name>` is a value of the component's prop type (a bool for a text prop is `ref`); `variant` names one of its variants or is null. An instance never sits inside the component it names, directly or through other instances (`cycle`).
- **Resolution order**: an instance shows its component's tree with, for each descendant property, the base value, then the default of a prop aimed at it, then the chosen variant's override, then the instance's override, then the instance's prop value aimed at it; the last that is present wins. A prop's default always applies to an instance, so an instance with no prop value shows the default, never the base. A component's own tree on the canvas shows its base values: a prop's default applies to instances only. Overrides reach only the component's own descendants (an instance inside it can be overridden as a node, by its common properties, not inside). `resolve(doc, instanceId)` in the fake computes it; `doc-every-type.json` holds a conflict on one property (`button-label`'s `text`, seen through instance `buy`) at all five levels.

### Free text

The fields hostile content may fill and every renderer and exporter must treat as text: page and node `name`, `text`, a text prop's `default`, an instance's text prop value, and a `text` override on a variant or an instance. Everything else is a checked value or an identifier. `freeTexts(doc)` lists them, each with its kind (`page-name`, `node-name`, `text`, `prop-default`, `prop-value`, `variant-text`, `override-text`). `hostile.json` fills every one with each of `HOSTILE_MARKERS`.

### Tokens

DTCG 2025.10, six types. Tokens are nested groups whose segments are 1 to 40 of `[A-Za-z0-9_-]`, at most 8 deep and 1000 tokens; a token is exactly `{ "$type", "$value" }`, any other object a group. A path is either a token or a group, never both. Values are a subset of 2025.10's, so the tokens export is valid 2025.10 unchanged. No aliases inside tokens: a token's value is literal, so a `$ref` resolves in one step.

### Token types

| $type | $value |
|---|---|
| `color` | `{ "colorSpace": "srgb", "components": [r, g, b], "alpha"?, "hex"? }`, each component and `alpha` 0..1, `hex` `#rrggbb` |
| `dimension` | `{ "value": −100000..100000, "unit": "px" }` |
| `fontFamily` | `"sans"`, `"serif"` or `"mono"` |
| `fontWeight` | 100..900 by 100 |
| `number` | a finite number |
| `typography` | exactly `{ "fontFamily", "fontSize", "fontWeight", "letterSpacing", "lineHeight" }`, as literals: `fontFamily` and `fontWeight` as their types, `fontSize` and `letterSpacing` dimensions, `lineHeight` a finite number |

### Document rules

Validity is whole-document. `docErrors(doc, { images, folderBytes })` lists every way a document isn't valid, as `{ rule, code, where, message }`, in the table's order (`images` the file names under `images/`, null to skip the file check; `folderBytes` every byte of the folder but `canvas.json`). An edit's end state is refused with the code of the first rule that fails.

| Rule | Code | What |
|---|---|---|
| `top` | `shape` | exactly `{ canvas: 1, rev, tokens, pages, nodes }`, `rev` an integer ≥ 0 |
| `page-shape` | `shape` | each page exactly `{ id, name, children }`, `children` an array of ids |
| `node-shape` | `shape` | each node an object with a known `type` and a `parent`; `children` an array of ids on a frame or component, absent on every other type |
| `id-form` | `value` | page and node ids 1 to 40 of `[A-Za-z0-9_-]` |
| `id-unique` | `exists` | ids unique across pages and nodes |
| `tree` | `parent` | each node's parent exists, is a page or a container, and lists it once; each listed child exists and names that parent; every node reached from a page |
| `keys` | `prop` | a node's keys are its type's properties (groups `layout` and `size` holding only theirs) and no `id` |
| `required` | `shape` | `path` on a vector, `src` on an image, `component` on an instance |
| `classes` | `value` | every value in its class (an override in its target property's class) |
| `tokens` | `value` | segments, groups and tokens of the six types, values literal |
| `refs` | `ref` | tokens of the right type and range, components, prop targets, prop values, override targets and properties, variant names, image files resolve |
| `components` | `parent` | a component never inside another, at any depth |
| `instance-cycle` | `cycle` | an instance never inside the component it names, directly or through other instances |
| `limits` | `limit` | at least one page; nodes, pages, tokens, token depth, depth, props, variants, override entries, `canvas.json`'s bytes and the folder's (§7) |

### Document limits

`canvas.json` at most 5 MB as written (`JSON.stringify(doc, null, 2)` plus a newline) and 20000 nodes; the folder within 25 MB, counting `canvas.json`, `images/` and the folder's other files (`index.html`, `artifact.json`): the server keeps them in the count and refuses an edit that would pass it. 100 pages, 1000 tokens 8 deep, depth 100, 1000 entries per override map, 32 props, 32 variants. Every number is in §7's table.

## 3. The socket: canvas@1

`GET /canvas?slug=<slug>` with a WebSocket upgrade on a project's dashboard server, the slug as the kit's artifact slug, `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. The handshake, guards, frame rules, close codes and person headers are presence@1 §2 to §4's, with `/canvas` as the path, and this contract's limits (§7) in place of presence@1 §7's. Refused, before any upgrade, in presence@1 §2's order, then the slug: host, relay mark, path, upgrade, origin, person headers, slug (a request breaking two guards gets the earlier one's status). After them, a slug missing, malformed, not open for editing (no `chore-canvas-<slug>` worktree), or landed (closed by `canvas land`) is 404; main is read-only and needs no socket.

**Frames.** As presence@1 §2 and §3: client frames masked, every protocol error 1002 from the header, every data message one JSON object in one text message, at most 16 frames, the size checked on each frame header before its payload is read. One exception: a server message over 256 KB is fragmented, a text frame then continuations, each of at most 256 KB (§7), since a local apply's `ops` may pass a frame; `openCanvas` (§14) joins them.

**State.** A canvas has a `rev`, kept in `canvas.json` and raised by one for every edit applied. An open session has a `session` id, 16 of `[0-9a-z]`, made each time a session opens (so after every restart). A canvas with no open session has the id its next session will use, made when the last session ended, so `GET /api/canvas/doc` always names one. A canvas is open from its first connection until its last closes. A restart reads back the last saved `rev`, so a `rev` above it can be reused for a different edit; the `session` id is what tells a page so.

**The page's State rule** (the design's): a page loads the document over HTTP, opens the socket and gets `welcome` with the `session` and current `rev`; it drops any `ops` at or below the `rev` it loaded. On any reconnect whose `session` differs from the one it loaded, or whose `rev` is below the highest it has seen, the page reloads the document over HTTP and resends every edit of its own above the last `saved`, acked or not, as the same `client` and `seq`; the new session judges them afresh. A reconnect to the same session resends only its unacked edits. A page that loaded between two sessions sees a different id at `welcome` and reloads.

**Close codes**: presence@1 §3's (1008 over a limit or for a message a page must not send, 1002 a protocol error, 1001 two unanswered pings, 1011 a handler that throws), and 1000 after `closed` (§5). The fake's `restart` closes with 1012.

## 4. Ops

### Ops

| Op | Shape | Idempotent as |
|---|---|---|
| `set` | `{ "op": "set", "id", "prop", "value" }`: `id` a node or page, `prop` a property path (§2) | the same set twice is the same |
| `add` | `{ "op": "add", "node": { "id", "type", "parent", …props }, "after": <id or null> }`: the node as stored, with no `children` key (a container starts empty); `after` null for first | an `add` of an existing id with the same type and parent is its properties as `set`s; with a different type or parent it is `exists`; an `after` that is gone places last |
| `del` | `{ "op": "del", "id" }` | removes the node and its subtree; `del` of a missing id does nothing |
| `move` | `{ "op": "move", "id", "parent", "after" }` | `move` to where it is does nothing; an `after` that is gone places last |
| `token` | `{ "op": "token", "path", "value": <token or null> }` | sets the token, making groups on the way; `token` null on a missing path does nothing; a group left empty goes |

`id`, `type`, `parent` and `children` change only by `add`, `del` and `move`: a `set` of any of them is `prop`. A `set` of a property not of the node's type is `prop`; of a missing node or page `missing`. A `set` of null removes a property whose default is absent (§2) and is a value like any other elsewhere (`fill` takes null). A `move` of a missing node is `missing`; into its own subtree `cycle`.

**Edits are judged as a whole.** An edit's ops are applied in order to a copy of the document. Each op is first checked on its own against the copy as it stands (its shape, its property against the node's type, its value against its class, the node or parent it names existing, an `add`'s id, a `move` into its own subtree); the first op that fails refuses the edit with that check's code. Only after the last op is the whole copy judged by the document rules (§2); the first failing rule in the table's order refuses the edit with that rule's code. So ops within one edit may refer forward (a prop target set before its node is added, a token retyped before its uses change), and a broken end state is charged to its rule, not to an op. A refused edit changes nothing. An edit with no ops is `shape`, and a View person's edit is `view` before anything else is judged. An applied edit raises `rev` by one, whatever it changed (a `del` of a missing id included).

**Pages as ops** (so there is no sixth op): `add` with `{ "id", "type": "page", "parent": null, "name" }` adds a page after `after` (null for first), and an `add` of an existing page sets its name; `del` of a page id removes it and its nodes (the last page is `limit`); `set` of a page's `name` (any other property of a page is `prop`); `move` of a page with parent null reorders it. A page with a non-null parent, or a node with a null one, is `parent`; a page added with a node's id, or a node with a page's, is `exists`.

## 5. Messages

### Page messages

| t | Shape |
|---|---|
| `edit` | `{ "t": "edit", "client", "seq", "ops": [ … ] }`: `client` 16 of `[0-9a-z]`, chosen once per page load and kept across reconnects; `seq` a positive safe integer, rising by one per edit |
| `select` | `{ "t": "select", "ids": [ … ] }`: at most 100 node ids |
| `pong` | `{ "t": "pong" }`, answering `ping` |

### Server messages

| t | Shape |
|---|---|
| `welcome` | `{ "t": "welcome", "canvas": 1, "session", "rev", "you": { "id", "conn" } }`, first, before any other message; `you` as presence@1 §4 |
| `ops` | `{ "t": "ops", "rev", "by": { "id", "name", "via" }, "ack": { "client", "seq" } or null, "ops": [ … ] }` to every connection, `rev` the canvas's after this edit; `via` `page` (`by` the person from the upgrade, `ack` the edit's), or `apply` or `take` (`by.id` and `by.name` the claimed `by`, `ack` null) |
| `saved` | `{ "t": "saved", "rev" }`: everything at or below `rev` is on disk |
| `refused` | `{ "t": "refused", "client", "seq", "why" }`: that edit only, `why` a refusal code (§6) |
| `selections` | `{ "t": "selections", "people": [ { "id", "name", "ids" } ] }` |
| `paused` | `{ "t": "paused", "why" }`: saving paused |
| `resumed` | `{ "t": "resumed" }`: saving again |
| `reload` | `{ "t": "reload", "session" }`: the document was replaced whole |
| `closed` | `{ "t": "closed", "why" }`: the canvas no longer takes edits |
| `ping` | `{ "t": "ping" }` |

- **Acked means applied in memory**, not yet on disk. An `edit` at or below the client's highest applied `seq` in this session is acked again to that connection only, without being applied: `{ "t": "ops", "rev": <current>, "by": <its own by, via page>, "ack": { "client", "seq" }, "ops": [] }`. A refused edit doesn't raise the client's highest `seq`, so a resent refused edit is judged again. The sender's later edits are judged on their own.
- An `edit` whose `client` or `seq` breaks its rule is a message a page must not send: the connection is closed 1008. Any other fault in an edit (`ops` not an array, empty, a malformed op) is `refused` `shape`.
- `select`: at most 100 ids of the id class; a longer list or a bad id and the whole `select` is ignored; ids that name no node are dropped. `selections` lists every person with a connection on the canvas (View people included), their latest `select` from any of their connections (empty until one), in the order they first connected; it goes to every connection, at most one per 250 ms window (the first change opens it, and one message at its end carries all), like presence's `people`. A deleted node leaves every selection.
- `saved`: at most 500 ms after an applied edit (the first unsaved edit opens the window), to every connection; none while saving is paused; when the pause ends, at once if anything is unsaved.
- `paused` `why` is `branch-moved`, `worktree-gone` or `index-dirty`; `closed` `why` is `landed` or `removed`. They are codes the page puts in plain words ("Saving paused: the canvas's branch changed. Your edits are kept here."). `closed` is followed by a close with code 1000; a later upgrade for that slug is 404.
- `reload` is sent when the document was replaced whole (an import that rewrote it, a supervisor's file the server took whole). A replace starts a new session on the open connections: `session` is the new id, every client's highest `seq` is forgotten, and the replaced document's `rev` is the old one plus one. The page does as §3's State rule says for a session that differs: it reloads over HTTP, then resends its own edits above the last `saved`, which the new session judges afresh (applied or refused aloud, never re-acked unseen).
- `ping` every 20 s; two unanswered close the connection 1001. A page message of a `t` it doesn't know is ignored.

## 6. Refusals

`refused.why` is one word; the page turns it into plain words ("That layer was deleted by Ana"). The same words answer the local route's 409 (§8).

### Refusals

| why | When |
|---|---|
| `shape` | an op or an edit malformed (an edit with no ops, an `add` with `children`, a missing required property), or a document's top, page or node shape |
| `prop` | a property not of the node's type, or a structural key: `id`, `type`, `parent`, `children`; a page property other than `name` |
| `value` | a value outside its class, a token path inside a token or naming a group, a token value not of its type, an id of the wrong form in a document |
| `missing` | `set` on a missing node or page, `move` of a missing node |
| `parent` | `add` or `move` under a missing parent or a node that holds no children, a page with a non-null parent, a node with a null one, a component inside a component |
| `exists` | `add` of an id with a different type or parent, of an id a page has, of a page with a node's id; an id twice in a document |
| `cycle` | `move` into its own subtree, an instance cycle |
| `ref` | a token, component, prop target, prop value, override, variant or image that doesn't resolve or is of the wrong type or range |
| `limit` | over a limit (§7), deleting the last page |
| `view` | a View person's edit |

No `closed` code: after `closed` the socket is closed, and the local route answers 423.

## 7. Limits

### Limits

Each limit's name is its key in the fake's `LIMITS`; the Answer is what crossing it by one gives.

| Name | Number | Answer |
|---|---|---|
| `docBytes` | `5242880` (5 MB, `canvas.json` as written) | refused limit |
| `folderBytes` | `26214400` (25 MB, the whole folder) | refused limit |
| `nodes` | `20000` | refused limit |
| `pages` | `100` | refused limit |
| `tokens` | `1000` | refused limit |
| `tokenDepth` | `8` (segments in a token's path) | refused limit |
| `depth` | `100` (a page's children are depth 1) | refused limit |
| `overrideEntries` | `1000` (entries in one instance's overrides or one variant) | refused limit |
| `props` | `32` (per component) | refused limit |
| `variants` | `32` (per component) | refused limit |
| `tracks` | `64` (per track list) | refused value |
| `idChars` | `40` | refused value |
| `nameChars` | `200` | refused value |
| `textChars` | `10000` | refused value |
| `pathBytes` | `65536` | refused value |
| `figmaChars` | `100` | refused value |
| `propNameChars` | `40` (prop and variant names) | refused value |
| `tokenSegmentChars` | `40` | refused value |
| `pageMsgBytes` | `262144` (256 KB, a page message once joined) | close 1008 |
| `pageFrames` | `16` (frames in a page message) | close 1008 |
| `editOpsBytes` | `65536` (64 KB, an edit's `ops` as JSON) | refused limit |
| `serverMsgBytes` | `1048576` (1 MB, a server message) | split; one op over: 409 limit |
| `serverFrameBytes` | `262144` (256 KB, a server frame) | fragmented |
| `perSecond` | `30` (page messages a second per connection) | close 1008 |
| `perPerson` | `8` (connections per person per canvas) | close 1008 |
| `perCanvas` | `50` (connections per canvas) | close 1008 |
| `openCanvases` | `20` (open canvases per server) | close 1008 |
| `perServer` | `200` (canvas connections per server) | close 1008 |
| `selectIds` | `100` (ids in a `select`) | ignored |
| `pingMs` | `20000` | window: ping |
| `unansweredPings` | `2` | close 1001 |
| `savedMs` | `500` | window: saved |
| `selectionsMs` | `250` | window: selections |
| `imageBytes` | `4194304` (4 MB, an uploaded image) | 413 |
| `imageBodyBytes` | `6291456` (6 MB, the upload's body) | 413 |
| `localBodyBytes` | `5242880` (5 MB, the local route's body) | 413 |
| `importBodyBytes` | `52428800` (50 MB, the import's body) | 413 |
| `byChars` | `64` (the local route's `by`) | 400 |
| `noteAnchorChars` | `64` (a pin's node anchor) | not an anchor |

- **refused limit** and **refused value**: an edit that crosses it is refused with that code (409 with it on the local route), and a stored document that crosses it breaks the `limits` or `classes` rule (`id-form` and `tokens` for ids and token segments). A limit that is a class bound (`tracks`, `idChars`, `nameChars`, `textChars`, `pathBytes`, `figmaChars`, `propNameChars`, `tokenSegmentChars`) answers `value` where a value of its class crosses it; where the over-long string is an op's own `id`, an `add`'s `node.id` or a `token` op's `path`, the op is malformed (`shape`), and a `set` whose path names a prop or variant over 40 characters names no property (`prop`). A page can send a path only as long as fits its 64 KB edit with the op around it (`editOpsBytes` is judged first); longer ones come by the local route or import. `editOpsBytes` binds a page's edit only; a local apply is bound by its body. `folderBytes` on the image route is 413.
- **close 1008**: the page's message is checked on each frame header before its payload is read; a 17th frame or a 31st message in a second (counting each data message and each ping frame) closes the connection at once. Connections are counted from the handshake: one over is accepted, then closed 1008 before `welcome`, so the page reads the code. A local apply is not a connection and counts toward no connection limit.
- **split; one op over: 409 limit**: a local apply whose change passes 1 MB is sent as several `ops` messages (§8); a single op whose `ops` message alone would pass 1 MB refuses the whole apply with `limit`. **fragmented**: a server message over 256 KB goes in frames of at most 256 KB (§3).
- **ignored**: a `select` of 101 ids changes nothing. **window**: a `ping` every 20000 ms, `saved` within 500 ms, one `selections` per 250 ms (§5). **close 1001**: two pings unanswered.
- **413**: judged from `Content-Length` before the body is read, and from what is read. **400**: a local request whose `by` is not 1 to 64 of `[A-Za-z0-9._-]`. **not an anchor**: `anchorProblem` refuses it (§10).

## 8. HTTP routes

All on the dashboard server. The GETs are guarded as the dashboard's other data GETs are (its host check and the relay mark refused, 403); the POSTs other than the local route as its owner-action POSTs are: the host check, a same-origin `Origin` (exactly `http://<Host>`; absent or another is 403), no relay mark, the person headers by presence@1 §4 (403), level `full` (View 403), `Content-Type: application/json` (415). So a View person gets the GETs only.

### Routes

| Key | Method and path | Fake |
|---|---|---|
| `doc` | `GET /api/canvas/doc` | yes |
| `image-post` | `POST /api/canvas/image` | yes |
| `image-get` | `GET /api/canvas/image/<slug>/<file>` | yes |
| `local` | `POST /api/canvas/local` | yes |
| `import` | `POST /api/canvas/import` | yes |
| `export` | `GET /api/canvas/export` | no |
| `edit` | `POST /api/canvas/edit` | no |

### HTTP bodies

| Kind | Shape |
|---|---|
| `doc-response` | `{ "session", "rev", "doc", "repo": { "name", "public" } }`: `session` 16 of `[0-9a-z]` or null, `rev` equal to `doc.rev`, `doc` a valid document, `repo.name` `"<owner>/<repo>"` or null, `repo.public` true, false or null (null when `name` is) |
| `image-request` | `{ "name", "data" }`: `name` 1 to 200 characters, `data` base64 of at most 4 MB of image |
| `image-response` | `{ "src" }`: `images/<16 hex>.<ext>` |
| `local-request` | `{ "by", "via", "ops" }`: `by` 1 to 64 of `[A-Za-z0-9._-]`, `via` `apply` or `take`, `ops` an array |
| `local-response` | `{ "rev", "edits", "saved" }`: `edits` the number of `ops` messages sent (at least 1), `saved` a bool |
| `error-response` | `{ "why" }`: a refusal code (§6), `no-session` or `closed` |

- **`GET /api/canvas/doc?slug=`** → `{ "session", "rev", "doc", "repo": { "name": "<owner/repo>" or null, "public": true, false or null } }` for a canvas open for editing (`session` the open one, or the id the next will use, §3). `repo.name` is origin's `owner/repo`; `public` from `gh repo view --json visibility`, cached for the session, null when that fails or there is no GitHub remote, which the editor's bar shows as "may be public". With `&at=main`, the canvas as main has it, for any canvas on main (open for editing or not), `session` null. Guards: the host check and the relay mark (403). A slug neither open nor on main: 404.
- **`POST /api/canvas/image?slug=`**: the owner-action guards (403, 415). Then a slug `land` closed 423, any other slug not open for editing 404: the 423 is judged first. The body `{ "name", "data" }` (base64): the image at most 4 MB, the body at most 6 MB (413, judged from `Content-Length` before reading and from what is read); sniffed by its first bytes as PNG, JPEG, WebP or GIF (anything else, SVG included, 415); saved as `images/<first 16 hex of SHA-256>.<ext>` → `{ "src" }`, so the same bytes twice give the same `src`; 413 when the folder would pass 25 MB; 400 for bad JSON, keys or base64. The page then adds an `image` node naming it.
- **`GET /api/canvas/image/<slug>/<file>`**: the host check and the relay mark (403); `<slug>` by the slug rule and `<file>` exactly `[0-9a-f]{16}\.(png|jpg|webp|gif)`, else 404: nothing from the URL is joined to a path unless it matches. Served from the canvas's folder on its branch while it is open for editing, else from main's, else 404; its type from its extension (`image/png`, `image/jpeg`, `image/webp`, `image/gif`), with `X-Content-Type-Options: nosniff`.
- **`POST /api/canvas/local?slug=`**, the supervisor's route, which browsers can't reach: it refuses any `Origin`, `Sec-Fetch-Site`, `x-devteam-relay`, `x-devteam-person` or `x-devteam-level` (403), and requires `x-devteam-canvas-token` equal to the token in `run/canvas-token` (mode 600, made by the dashboard at start; the fake's `token`), else 403; the body at most 5 MB (413). The body is `{ "by", "via": "apply"|"take", "ops": [ … ] }`, `by` the CLI's session name (`supervisor`, `plan-checkout`, a ticket id), shown as claimed.
  - **It goes only to an open session.** With no session open, the answer is 503 `{ "why": "no-session" }` and nothing changes; the CLI then applies the ops to the file under the lock (`run/canvas/<slug>.lock`, which an open session holds), and a 503 after it lost a race to a closing session sends it there too.
  - **One judgement, then one change.** The ops are judged as one edit (§4). Refused, nothing changes, no `ops` is sent, and the answer is 409 `{ "why": <refusal code> }`. Applied, the document changes once, and the change is sent as consecutive `ops` messages, each a run of the ops in order whose message fits 1 MB, each raising `rev` by one, all sent before any other edit is taken, with `by` `{ "id": by, "name": by, "via" }` and `ack` null. A single op whose `ops` message alone would pass 1 MB refuses the whole apply with `limit`.
  - **The answer waits for the disk.** The session writes at once for a local apply, and answers 200 `{ "rev", "edits": <messages sent>, "saved": true }` once the write covering `rev` is done (and `saved` is sent). While saving is paused it answers at once with `"saved": false`, and `canvas take` keeps its copy until a later `canvas show` reports a saved `rev` at or above it. A restart after a local apply answered `saved: true` keeps that apply.
  - **Statuses in order**: the guards (403, 413), then a slug `land` closed 423 `{ "why": "closed" }`, then any other slug not open for editing 404, then no session 503, then the body (400 for bad JSON or keys), then 409 or 200. A local apply is not a connection and counts toward no connection limit.
- **`POST /api/canvas/import?slug=`**: the owner-action guards and a 50 MB body limit (413 from `Content-Length`); the import itself (a Figma `JSON_REST_V1` body, or `{ "key" }`) is a later ticket's. The fake answers 501 within the limit.
- **`GET /api/canvas/export?slug=&target=web|swiftui|spec|tokens`** (the data GET guards) and **`POST /api/canvas/edit?slug=`** (the owner-action guards, Full only; the route form of `canvas edit`) are later tickets'; the fake doesn't serve them (404).

## 9. Presence on a canvas

Consumes `presence@1`. The canvas page reports `at` as `{ "page": "canvas", "tab": "<canvas page id>", "peek": null, "art": "<slug>@canvas", "thread": … }`, so two people on the same canvas page are the same spot and other canvas pages aren't. A cursor's anchor `k` is the node id under the pointer; over empty canvas it is `@<page id>`, with `x`, `y` as fractions of the page's content bounds (the union of its top-level nodes' rectangles plus 200 px around), which the document alone fixes, so every screen agrees whatever its zoom or pan. The fixtures `presence-here.json`, `presence-move.json` and `presence-move-empty.json` are checked with presence's own `shapeErrors` plus these rules (`shapeErrors('presence-here' | 'presence-move', …)` in the fake): `page` `canvas`, `tab` a page id, `peek` null, `art` a slug and `@canvas`; `k` a node id or `@` and a page id.

## 10. Pins

A pin on a canvas is an `artifact-notes@1` note whose anchor is `{ "node": "<id>" }` instead of a CSS selector, and whose subject names the canvas's slug. The value is 1 to 64 characters of one line of plain text (well-formed, no control characters, no line or paragraph separator). It is documented here for the kit's `anchorProblem` ticket, which accepts a `node` key by this rule of its own, leaving `ANCHOR_CAPS` and its copies alone; the log schema's `subject.anchor` is already any object. A pin on a deleted node keeps its thread and shows at the page's top-left corner, marked "on a deleted layer". The fixture `note-anchor.json` is checked by the rule (`shapeErrors('note-anchor', …)`).

## 11. Exports

Every exporter is a pure function of the document (the same document gives the same bytes), and escapes every free-text field (§2) for its target:

- HTML: text escaped as text; attribute values quoted and escaped.
- CSS: class and custom-property names built from a sanitiser (`[a-z0-9-]`, a numeric suffix on collision), never from raw names; no strings from the document in CSS but checked values.
- Swift: strings written as escaped literals (`\\`, `\"`, `\n`, and `\(` written as `\\(` so nothing interpolates); identifiers from a sanitiser (letters, digits and `_`, not starting with a digit, Swift keywords suffixed, collisions numbered).
- Markdown: names and text inside code spans whose fence is longer than any run of backticks they hold, so nothing becomes a link or HTML.

Stated here; the exporters' tickets test them with their goldens in `test/fixtures/canvas/`, `hostile.json` among their inputs.

## 12. Not defended

A process that can read `run/canvas-token` edits as any session name it claims. A local process opening `/canvas` on the loopback port with no person headers is the owner (presence@1 §4). The document lives in the canvas's worktree and branch, which anyone with the repo can read.

## 13. Canvas test files

The measure counts the longest unbroken run of names `canvas A<n>:` from A1 across `test/*.test.mjs`:

```sh
n=0; while grep -qE "test\('canvas A$((n+1)):" test/*.test.mjs; do n=$((n+1)); done; echo $n
```

It counts only a `test('canvas A<n>: …` call in a test file, never a name in a contract or fixture, so A1 holds every such name to these rules. A real measured call's callee is the whole identifier `test`, in code: the grep has no word boundary, so it also counts `subtest('canvas A<n>:` and `t.test('canvas A<n>:`, and those are problems too.

**Where names live** (`measureProblems(files)`): every match of the measure's pattern in any `test/*.test.mjs` is a real call: its `test` the whole identifier, in code, outside any comment, string or template (the same scanner as the skip rule's), its quote opening the call's first argument; a match inside a comment, a string or a template is a problem wherever it is, since the grep counts it; every real call is in a `test/canvas-*.test.mjs` file; no `canvas A<n>:` appears twice; and every `test/canvas-*.test.mjs`, and every file holding a match, passes the skip rule. A1 lists `test/` to find the files, so a new one is read with no change to the test.

**The skip rule** (`skipProblems(source)`), on the source with comments removed and the insides of strings, templates and regular expressions blanked (so prose in a test name never trips it):

- `skip:` appears only as `skip: canDrive ? false : '<reason>'` (a single-quoted, non-empty reason), with `canDrive` imported by that name from `./lib/chrome.mjs` in that file, or as `skip: process.platform === 'darwin' ? false : 'not macOS'`. There is no other `skip:`, so the kit's usual `const SKIP = …; { skip: SKIP }` form is refused in canvas files: write the expression inline.
- No `.skip`, `.todo`, `todo:`, `.only` or `only:`.
- No quoted keys, computed keys or bracket access with those words: a string or plain template whose text is exactly `skip`, `todo` or `only` followed by `:` or `]` is refused (`{ 'skip': true }`, `{ ['only']: true }`, `test['todo'](`).

The last rule has known false positives: a string `'skip'`, `'only'` or `'todo'` right before a `:` or `]` that isn't a key, as in `case 'skip':`, `x ? 'only' : y` or `['a', 'skip']`. In a canvas test file, reword such a line (another word, or the string built another way). The scanner reads a `/` after a value as division and after an operator as a regular expression, and ends a misread string or expression at its line's end, so a misreading costs at most one line.

## 14. The fake, the exchanges and the HTTP fixtures

`test/lib/canvas-fake.mjs` holds the rules as code and a fake server (Node built-ins only; it imports `cutName`, `ID_RE`, `CONN_RE` and `shapeErrors` from `presence-fake.mjs`). Its tables (`TYPES`, `PROPS`, `CLASSES`, `TOKEN_TYPES`, `DOC_RULES`, `OPS`, `PAGE_KINDS`, `SERVER_KINDS`, `HTTP_KINDS`, `REFUSALS`, `ROUTES`, `LIMITS`) are this contract's tables; its functions are `docErrors`, `opErrors`, `applyEdit(doc, ops, { images, folderBytes, level })` (§4's judgement: a new document at `rev` + 1 and `why` null, or the same document and the refusal code), `resolve`, `shapeErrors(kind, msg)` (every message and body kind, plus `note-anchor`, `presence-here`, `presence-move`), `freeTexts`, `skipProblems` and `measureProblems`.

**The fake server.** `startCanvasFake(opts) → Promise<fake>`, a `node:http` server on `127.0.0.1`, port 0, serving the `/canvas` socket and `GET /api/canvas/doc`, `POST /api/canvas/image`, `GET /api/canvas/image/…`, `POST /api/canvas/local` and `POST /api/canvas/import`'s guards and limit, enforcing §3 to §8. Options:

- `canvases`: slug → document, open for editing; `main`: slug → document, as main has it;
- `images`: slug → `{ "<16 hex>.<ext>": Buffer }`; `folderBytes`: slug → bytes of the folder's other files;
- `repo`: `{ name, public }`, default `{ name: null, public: null }`; `ownerName`: `'Owner'`; `token`: the local route's token, default random;
- `clock`: `'real'` (default) or `'manual'`, where no timer fires and time moves only by `tick(ms)`;
- `serve(req, res)` for any other plain request.

The fake: `{ url, port, token, close(), doc(slug), rev(slug), session(slug), save(slug), pause(slug, why), resume(slug), replace(slug, doc), land(slug), remove(slug), restart(slug), stats(), tick(ms) }`. `save` sends `saved` now; `pause` and `resume` send `paused` and `resumed` and hold `saved` meanwhile; `replace` sends `reload` with a new session id and forgets every client's `seq`; `land` sends `closed` `landed`, closes with 1000 and moves the slug to main (later upgrades 404, the local route 423); `remove` sends `closed` `removed`; `restart` closes every connection on that canvas with 1012, reverts it to its last saved document and makes a new session id; `stats` lists open connections `{ conn, id, slug, messages }`; `tick` moves the manual clock (the `saved` and `selections` windows, pings, the per-second count).

**The client.** `openCanvas(url, { slug, headers, origin, host, keep })`: presence's `openPresence` client (`status`, `you`, `send`, `frame`, `build`, `raw`, `messages`, `sizes`, `next`, `closed`, `close`, `destroy`, with its options' meanings), over `net`, joining continuation frames into one message. `request(url, { method, headers, body, contentLength })` over `net`, so a test can declare a length it doesn't send.

**The fixtures**, every file under `test/fixtures/canvas/` of a known kind by its name (A1 fails on any other):

- `doc-*.json` and `hostile.json`: documents, valid with the folder's `images/` (`doc-every-type.json` uses every type, every property of every type, every layout mode and token type, and holds the five-level conflict; `doc-minimal.json`; `hostile.json`, §2's free text);
- `msg-<kind>[-…].json`: one socket message of that page or server kind, at least one per kind;
- `presence-here[-…].json`, `presence-move[-…].json`, `note-anchor[-…].json` (§9, §10);
- `images/<16 hex>.<ext>`: an image whose name is the first 16 hex of its SHA-256, its first bytes its type's;
- `http-<route key>-<case>.json` and `exchange-<name>.json`, below.

**An HTTP fixture** (`http-<route key>-<case>.json`): `{ "fake": { options }, "request": { "method", "path", "headers", "body"?, "contentLength"? }, "status", "requestKind", "responseKind", "response"? }`. In `fake`, documents and images are named by fixture file: `"canvases": { "<slug>": "doc-minimal.json" }`, `"main": { … }` alike, `"images": { "<slug>": ["<16 hex>.png"] }`, read from the fixtures folder (`images/`). `"requestKind"` is an `HTTP_KINDS` entry the request body holds to, or null when the request has no JSON body or is deliberately broken; `"responseKind"` is the `HTTP_KINDS` entry of the response's JSON body (a refusal's `{ "why" }` is `error-response`), or null when it has none (an image, a bare 404). `response`, when given, must equal the body exactly. `playHttp(file, { fixturesDir }) → Promise<void>` starts the fake, sends the request and checks status, kinds and body. At least one per served route, the doc route's public, private and unknown repo; a fixture for an unserved route (`export`, `edit`) expects 404 with `responseKind` null.

**An exchange** (`exchange-<name>.json`): `{ "canvas": "<doc fixture>", "slug", "images"?: [names], "steps": [ … ] }`, each step one of:

- `{ "open": "<name>", "person": "<x-devteam-person value>" or null, "level": "full"|"view" or null, "status"?: <n> }`: a connection named `<name>`; a `status` other than 101 expects the upgrade refused with it;
- `{ "as": "<name>", "send": {…} }`; `{ "as": "<name>", "close": true }`;
- `{ "local": { "by", "via", "ops" }, "status": <n>, "body"?: {…} }`: a local apply, its body checked as `local-request` unless its expected `status` is a refusal (403, 413, 400) meant to exercise a broken body, its response, when given, as `local-response` (200) or `error-response`;
- `{ "do": "save"|"pause"|"resume"|"replace"|"land"|"remove"|"restart", "arg"?: … }`; `{ "tick": <ms> }`;

each optionally with `"expect": { "<name>": [ messages ] }` and `"doc"`: a document the canvas must equal after the step. `playExchange(fake, exchange, { fixturesDir })` runs it on the manual clock; after each step every open connection's new messages must equal its `expect` list exactly, in order (a connection not named must have received nothing; pings never fall due inside an exchange), and it throws an assertion naming the step and the connection. An expected list may end with `{ "$close": <code> }`: the connection must then be closed by the server with that code. In expected messages `"$session"` matches the canvas's current session id and `"$conn:<name>"` that connection's conn; nothing else is a placeholder. Every sent and expected message holds to its kind's shape (or the same step expects a `refused` `shape` for it, or the sender's `$close` 1008), and every `doc` is valid. The real server's tickets replay the same files.
