# Supervisor threads, PR 2 (Gateway) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The box's gateway gets ready for the kit's viewers (PR 3), and stays dormant until a kit has them. A preview's name answers `/.devteam/lens`, the gateway's own page that frames the running app and tells the viewer what is under the pointer. The app's own framing headers give way for that one frame. An artifact at a published tree (`/artifact/tree/<sha>/…`) goes under a capability as `main` and worktrees do. An instance's viewer and published-tree pages may be framed by the public name. On `public.<box>`, a signed-in owner's own visit to a published page gets a small page of the gateway's, framing that project's viewer at exactly the published version. Everyone else, and the owner whenever anything about it is in doubt, gets the published bytes as today.

**Architecture:** everything is in `cloud/gateway.mjs`:
- New module-level exports: `addFrameAncestor` and `replaceFrameAncestors` (pure CSP edits), `PREVIEW_LENS` (the lens document, one `String.raw` constant that PR 3 copies byte for byte into `devteam.mjs`), and `previewLensCsp(ancestors)`.
- In `createGateway`:
  - `LENS_ANCESTORS` (the hub and every instance origin) and `LENS_CSP`.
  - `downstreamHeaders` gains `framedBySelf`, and `proxyPreview` passes it for `sec-fetch-dest: iframe` with `sec-fetch-site: same-origin`.
  - `ARTIFACT` gains `tree/<sha>`.
  - `proxy` gains `publicFrame`, set by `publicFramed(rawPath)` on `/view/` and `/artifact/tree/`.
  - The request handler answers `GET /.devteam/lens` after the session check.
  - `ownerWrapper(req, url)` runs ahead of `servePublic`, and `servePublic` sends `vary: cookie` on a page's index. `PAGES.ownerWrapper` is the wrapper's markup.
- Tests are in `test/gateway.test.mjs`, with a fake kit and the existing fake hub. Real-browser steps are in `test/browser/dev-links.mjs`, with a stand-in instance in the kit viewer's place.

**Tech Stack:** Node 18 built-ins only (no dependencies), vanilla browser JS (the lens), `node:test`, Chrome over CDP (local only).

**Spec:** `docs/superpowers/specs/2026-11-10-supervisor-threads-design.md`: read §5 (anchors and caps), §6 and §7 (the lenses and the viewer), §8 (published artifacts for the owner), §11 and §12 (security, the gateway), and "Scope and sequence". The preview lens itself comes from the superseded draft: `git show origin/dev-link-annotations-design:docs/superpowers/specs/2026-11-10-dev-link-annotations-design.md`, its §2 (the lens and its messages), §6 (the framing rule) and §7 (the gateway). Where the draft and the spec differ, the spec wins (Shift, not ⌥; §5's caps; PR 1's anchor shape).

## Decisions made while planning

These settle what the spec leaves open, or what the code makes impossible as written. Each is applied in the tasks below.

1. **The lens's `frame-ancestors` are the hub and every instance name** (`[PUB, ...BLOCK.map(instanceOrigin)]`), not the instances alone. A browser checks `frame-ancestors` against every ancestor, and the in-page viewer sits in hub → dashboard → lens. The lens's policy is static because PR 3 copies it byte for byte and the laptop relay can't know the box's origins. An instance name is a port in the block, and an agent's page can sit on an unused one and frame the lens, but the app's relaxed policy (decision 2) names only the owning instance, so that page gets an empty frame. What remains exposed is the owning dashboard's name. The README says so (Task 7).
2. **The relaxed app header is `frame-ancestors 'self' <PUB> <the owning instance>`.** The app framed by its lens has the lens, the viewer and maybe the hub above it, so `'self'` alone would block it. The owning instance is the port whose hello lists the preview (`previewLinks` keeps it on each row as `instance`); an ambiguous or unknown name is never proxied, so it never reaches the relaxation.
   - It applies only to `sec-fetch-dest: iframe` with `sec-fetch-site: same-origin`. `frame`, `object` and `embed` keep the app's headers.
   - `x-frame-options` is dropped. Every policy in the header that has a `frame-ancestors` directive gets the new value.
   - A response with no policy gets none added. `content-security-policy-report-only` blocks nothing and is left alone.
3. **The public name is appended to a `frame-ancestors` list that names sources** (`addFrameAncestor`). `'none'`, an empty list and a policy with no directive are left as they are, because adding a directive where there was none would narrow who may frame the page. `x-frame-options` on `/view/` and `/artifact/tree/` is not touched, so PR 3 should send none there.
4. **`/view/` and `/artifact/tree/<tree id>/` are matched on the raw path** (`publicFramed`). `tree/` qualifies only with a real tree id, as `ARTIFACT` takes it. A path with `..`, `%2e`, `%5c` or a backslash never qualifies. An artifact under its capability qualifies by its inner path (`cm[4]`).
5. **The lens's messages are `{ lens: 1, type, … }` both ways.**
   - From the viewer: `hello`, `hit {id, x, y}`, `resolve {id, anchors: [{key, anchor}]}`, `scroll-by {dx, dy, x?, y?}`, `scroll-to {anchor}` and `go {route}`.
   - From the lens: `ready {route, title, viewport}`, `route {route}`, `hit-reply {id, anchor, rect, route}`, `rects {id?, rects: [{key, rect, changed, text}]}`, `key {key, shift}` (Shift and Escape, from inside the app, and Shift up again when the app loses focus) and `errors {errors}`.
   - The lens says nothing until the viewer's first message. `hello` answers with `ready`, and with `errors` if there are any.
   - `ready` goes out when the lens first attaches to a page (the 250 ms poll can find it mid-parse) and again on that page's `load`, unconditionally. So a viewer waiting for a page's title, as Task 8's `go` step does, always gets a `ready` with the loaded page's.
   - `resolve` sets the watched anchors (the draft's `watch` folded in) and answers with its `id`. After that, `rects` without an `id` follow each change: a scroll or resize at most once per animation frame, a DOM change debounced by 100 ms, and every second as a backstop. Each is sent only when something moved.
   - `scroll-by` scrolls the box under `(x, y)` (or the last hit) that scrolls, else the page, by at most 10,000 px a step.
6. **The lens checks that a message came from its parent, never what that parent's origin is.** The lens is one string shared with the laptop's relay (PR 3), so it can't name the box's origins. It accepts a message only when all of these hold:
   - `event.source === parent`.
   - The origin isn't its own (the app's) and isn't `"null"`.
   - The origin equals `location.ancestorOrigins[0]` where the browser has that list.
   - The origin is the one it first heard from.

   Its policy's `frame-ancestors` is what limits who that parent can be. Every reply goes to that one origin, never to `'*'`.
7. **An anchor is PR 1's shape** (`anchorProblem`): `selector, tag, role, text, name, html, rect {x, y, w, h}, point {x, y}`.
   - `point` is the pin's offset inside `rect` in CSS pixels, not the draft's fractional `at`.
   - Strings are capped in bytes as spec §5 and the kit's `ANCHOR_CAPS` say: selector 200, tag 40, role 40, text 80, name 80, html 1,024. A route is capped at 300, and errors at three of 200 bytes each. A test holds the lens's `CAPS` to the kit's.
   - `html` is the element with its own children, each child's contents collapsed to `…` (at most 50 children), cut to 1,024 bytes ending in `…`.
   - A hit on `<html>` or `<body>` has `anchor: null`, so the viewer pins the point instead.
8. **The lens frames the app in a sandbox of its own, without top navigation**, as well as the viewer's sandbox around the lens (PR 3). A lens opened on its own still keeps the app from navigating the tab. That sandbox keeps `allow-popups-to-escape-sandbox`: dev apps need real windows (OAuth popups, external links). So the framed app can open an unsandboxed window from the owner's click, as it could when opened plain.
9. **`GET /.devteam/lens` is served for any preview-shaped name after the session check, whether or not the map has it.** It is a static page, and serving it asks the hub nothing. Only `GET` on exactly that path (any query) is the lens. `HEAD`, `POST` and `/.devteam/lens/…` stay the app's. Without a session, the sign-in sends the owner back to the preview's own `/`, not to the lens: a lens open in a tab of its own is no use.
10. **The lens is a `String.raw` template in plain ASCII**, with no backtick and no `${` in it, so its regular expressions read as written and the kit's copy compares as the same bytes. PR 3's equality test compares `PREVIEW_LENS` only. `previewLensCsp` hashes its one script and one style.
11. **The lens's DOM behaviour is checked in Chrome**: anchors, caps, rects, scrolling, keys and errors (Task 8). CI checks its markup, its policy, its caps against the kit's, its message gate and its route rules, by running its script in `vm` against a stand-in page (Task 4).
12. **Only a published page's index is wrapped** (`/<project>/<slug>/` and `/<project>/<slug>/index.html`). The viewer's URL in spec §8 has no page path, so a direct visit to any other page gets the plain bytes.
13. **The wrapper asks the bound instance itself.** It reads the binding's port's `/api/hello` by `loopback`, as `recordUnpublish` already does, with a 1.5 s deadline (`opts.wrapperHelloMs`) and a 256 KB cap. It wraps only when all of these hold:
    - the hello says `viewer: 1` and the binding's `root`;
    - the binding's port is in the block;
    - its tree is a tree id.

    The hub's list carries the same hello, but it is up to 10 s old and doesn't show the instance answering now.
14. **Every doubt serves the plain bytes, the instance being down included.** Spec §8's fourth bullet says the wrapper shows a "Threads need …" message then, but §12, the Testing list and "Scope and sequence" say plain. Plain is what keeps the wrapper dormant until a kit has viewers.
15. **`vary: cookie` is on a page's index responses only** (200 and 304), which are the paths that can be wrapped. The wrapper is `no-store, private`, so it doesn't vary on `sec-fetch-dest` as well.
16. **The wrapper has no script.**
    - It is a one-line bar ("Public · <project>/<slug> · Open it as the public sees it", linking `?plain`) and the viewer in a frame.
    - That frame is sandboxed without top navigation.
    - It sends a policy of its own, `WRAP_CSP(<the bound instance>)`: `default-src 'none'; style-src 'unsafe-inline'; frame-src <inst>; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. `PAGE_CSP` would admit inline script and `connect-src 'self'`, which the wrapper doesn't need. It also sends `x-frame-options: DENY`, `referrer-policy: no-referrer`, `cache-control: no-store, private` and `vary: cookie`.
    - Its frame's sandbox has no `allow-popups-to-escape-sandbox`: an artifact viewer opens no window that needs to escape it (unlike the lens's app frame, decision 8).
    - Its title is the published title, escaped.
17. **The wrapper is served for a signed-in cross-site top-level navigation too** (a link from mail or another site). That is safe:
    - Nothing in it is readable: no script, `frame-ancestors 'none'`, and another site can't read a top-level page it opened.
    - Its frame is sandboxed without top navigation.
    - The request's query is ignored: the frame's URL is built from the binding alone, so a link can't steer what is framed.
18. **The Chrome check of wrapper → viewer → artifact uses a stand-in instance.** PR 2's kit has no `/view/` and no `/artifact/tree/`. The stand-in answers with `viewer: 1` and the kit's kinds of policy in its loopback origin, so the gateway maps them as it will the kit's. PR 3 runs the chain again against the real kit.

## Spec problems found while planning

- **§7 and §12: "the lens's `frame-ancestors` from the instance origins"** misses the hub, which frames the dashboard that frames the lens (decision 1). The spec also doesn't say what the app's replaced `frame-ancestors` becomes, and `'self'` alone would block the app in its own lens (decision 2).
- **§11 says "the lens framable only by instance origins"**, which conflicts with decision 1 the same way. The spec is corrected in this branch to "by the hub and the box's instance names".
- **Who can frame the lens.** An agent's page on an unused block port is an "instance name" too, so it can frame the lens and read the dev app through it. Narrowing that needs the gateway to know which ports are real dashboards, which it doesn't today (the hub's list is agent-written). That is left for later, and the README says what such a page can read.
- **§8's fourth bullet** (a message when the instance doesn't answer or has an older kit) contradicts §12, the Testing list and "Scope and sequence" (plain bytes). Plain is used (decision 14).
- **§8: "a session store read failure … serve[s] the plain bytes"** can't happen as written. `servePublic` reads the same `state.json` for the published map, so a store that can't be read answers 503 to everyone, as it does today. The wrapper's attempt adds nothing to that: Task 6 tests that the owner and the public get the same 503.
- **The draft lens "accepts only `parent` and an instance origin"**, but a lens that must be byte-identical in `devteam.mjs` (laptop, `http://127.0.0.1:<port>` viewers) can't list the box's origins. The browser enforces the parent through `frame-ancestors`, and the lens checks `source` (decision 6).
- **§8's viewer URL** (`/view/artifact/<slug>?at=tree:<tree>`) carries no page, so only the index can be wrapped (decision 12). If PR 3 adds a `path` to the viewer, the wrapper can pass it then.
- **The draft's lens details are superseded by the spec**: ⌥ (`key {key, alt}`), five errors of 300 bytes, `html` up to 2 KB, fractional `at`, and a separate `watch`. The spec's Shift and §5's caps, and PR 1's anchor schema, are used (decisions 5 and 7).
- **Testing's "the three-level chain loads in Chrome"** can't run against the real kit in PR 2 (decision 17).
- **For PR 3:** the viewer and `/artifact/tree/` should send no `x-frame-options`, since the gateway only extends `frame-ancestors` (decision 3).

## Global Constraints

- **Node 18+ built-ins only** in the gateway: no dependencies, no API newer than Node 18 (`server.closeAllConnections()` in tests is 18.2+, which CI's 18 has). CI runs the matrix in `.github/workflows/test.yml`: Node 18, 20, 22 and 24. `test/gateway.test.mjs` is in the `rest` job. Locally, run with Node 24 (`~/.asdf/installs/nodejs/24.21.0/bin/node`) and let CI cover the rest. The browser script may use Node 22+'s global `WebSocket` and `fetch`.
- **No new source files.** The lens is a string in `cloud/gateway.mjs`: no `lens.html`. Change only `cloud/gateway.mjs`, `test/gateway.test.mjs`, `test/browser/dev-links.mjs` and `README.md` (and the spec's corrections, already on this branch). Nothing in `docs/devteam/scripts/devteam.mjs` or `docs/devteam/dashboard/index.html`: the kit's viewer, relay, artifact lens and `/artifact/tree/` serving are PR 3.
- **Plain English on the owner's pages**: the wrapper's bar and title. No ids, flags or paths beyond the page's own `<project>/<slug>`.
- **The lens is data's source, never authority.** It reports what the page holds; it can start, write or answer nothing, and nothing it says is acted on by the gateway.
- **Tests first** in every task: write the failing test, run it to see it fail for the expected reason, implement, run it green, then run the whole file.
- **Run tests:** `NODE=~/.asdf/installs/nodejs/24.21.0/bin/node`.
  - One gateway test: `$NODE --test --test-name-pattern "<text>" test/gateway.test.mjs`.
  - The gateway file: `$NODE --test test/gateway.test.mjs`.
  - The browser script: `$NODE test/browser/dev-links.mjs`. It runs locally, needs Chrome and npm's network once, and isn't in CI.
  - The whole suite, as CI splits it: `$NODE --test test/bounds.test.mjs && $NODE --test --test-concurrency=8 $(ls test/*.test.mjs | grep -v '/\(kit\|bounds\)\.test\.mjs$') && $NODE --test --test-concurrency=8 test/kit.test.mjs`.
  - Local timings swing with load, so compare back to back.
- **Branch and commits.** Work on `threads-gateway` in `/Users/hhff/Documents/Code/devteam-threads-gw`, which is based on `main` at `dfc84a6` (PR 1 merged).
  - One commit per task. Every message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never rebase or force-push.
  - Stop at a merge-ready PR: don't merge or release.
- **Match the repo's style:** dense single-file code, comments that say why, the surrounding comment density, no placeholders.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `cloud/gateway.mjs` | Header comment (1-18). After `previewLinks` (268): `PREVIEW_LENS`, `lensPart`, `lensHash`, `previewLensCsp`. After `publicCsp` (392-399): `FRAME_ANCESTORS`, `addFrameAncestor`, `replaceFrameAncestors`. In `createGateway`: `LENS_ANCESTORS`, `LENS_CSP` after `previewOrigin` (563); `downstreamHeaders` (776-788) `framedBySelf`; `proxy` (789-804) `publicFrame`; `proxyPreview`'s `writeHead` (829); `ARTIFACT` (963) and its comment (960-962); `PUBLIC_FRAMED`, `publicFramed`; `servePublic`'s comment (1177-1179) and `head` (1195); `ownerWrapper` after `publicMap` (1334). The handler: `isPublic` (1453-1456), the capability branch (1466-1470), `/.devteam/lens` before `if (pv)` (1514), the instance branch (1516-1520). `PAGES.ownerWrapper` after `publicList` (1938-1941) | 1-7 |
| `test/gateway.test.mjs` | `fakeKit` and `lensRun` after the last test (2210). New tests: a published tree's capability; the public name as a frame ancestor; a preview framed by its lens; the lens document; the lens's message gate; `/.devteam/lens`; the owner wrapper. The comment in the public test (910) | 1-6 |
| `test/browser/dev-links.mjs` | Header (1-5), imports (8-14), `gatewayViewers` before `async function main()`, `viaGateway` (277) taking `SP` and calling it at its end (351), `main` (437) | 8 |
| `README.md` | Cloud section: the gateway bullet (171), Public artifacts (172), Dev links (173), two threat-model bullets after Passkey prompts (175) | 7 |

---

### Task 1: An artifact at a published tree goes under a capability

**Files:**
- Modify: `cloud/gateway.mjs` (`ARTIFACT` at line 963 and the comment above it at 960-962)
- Test: `test/gateway.test.mjs` (a helper `fakeKit` and a new test, appended after the last test at line 2210)

- [ ] **Step 1: The fake kit.** Append to `test/gateway.test.mjs`:

```js
// A stand-in for a kit on an instance's port, for what the gateway does with its answers. It has a
// hello (K.hello: an object; null cuts the socket; 'slow' never answers), a viewer page and an
// artifact's files under the kit's own kinds of policy in its loopback origin, and a dashboard for
// anything else. Every request it sees is kept.
function fakeKit(port) {
  const self = `http://127.0.0.1:${port}`;
  const K = { hello: { devteam: 1, name: 'alpha', root: '/srv/alpha', port, viewer: 1 }, seen: [] };
  K.srv = http.createServer((q, s) => {
    K.seen.push({ url: q.url, h: q.headers });
    const reply = (type, csp, body) => { s.writeHead(200, { 'content-type': type, 'content-security-policy': csp }); s.end(body); };
    if (q.url === '/api/hello') {
      if (K.hello === 'slow') return undefined;
      if (K.hello === null) return q.socket.destroy();
      return reply('application/json', "default-src 'none'", JSON.stringify(K.hello));
    }
    const art = /^\/artifact\/((?:main|wt\/[^/]+|tree\/[0-9a-f]+)\/[^/]+)\//.exec(q.url);
    if (art) return reply('text/html; charset=utf-8', `default-src 'none'; script-src 'unsafe-inline' ${self}/artifact/${art[1]}/; frame-ancestors ${self} http://127.0.0.1:${HUB}; sandbox allow-scripts`, '<p>an artifact');
    if (q.url.startsWith('/view/')) return reply('text/html; charset=utf-8', `default-src 'none'; frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:${HUB}`, '<p>a viewer');
    return reply('text/html; charset=utf-8', `default-src 'self'; frame-ancestors 'self' http://127.0.0.1:${HUB}`, 'the dashboard');
  });
  K.up = () => new Promise((r) => K.srv.listen(port, '127.0.0.1', r));
  K.close = () => new Promise((r) => { K.srv.closeAllConnections(); K.srv.close(r); });
  return K;
}
```

- [ ] **Step 2: The test.** Append:

```js
test('an artifact at a published tree goes under a capability, as main and a worktree do', async () => {
  const gw = await gateway('artifact-tree');
  const K = fakeKit(P + 20);
  await K.up();
  const T = 'b'.repeat(40);
  const framed = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' };
  const opaque = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script' };
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    let r = await gw.req('GET', `/artifact/tree/${T}/mock/?v=1`, { on: P + 20, headers: framed });
    assert.equal(r.status, 302, r.body);
    const cap = new RegExp(`^(/c/[^/]+)/artifact/tree/${T}/mock/\\?v=1$`).exec(r.headers.location)?.[1];
    assert.ok(cap, r.headers.location);
    // its files need no cookie, under its own policy pointed at the capability
    r = await gw.req('GET', `${cap}/artifact/tree/${T}/mock/app.js`, { on: P + 20, cookie: '', headers: opaque });
    assert.equal(r.status, 200, r.body);
    assert.equal(K.seen.at(-1).url, `/artifact/tree/${T}/mock/app.js`, 'the kit sees the plain path');
    assert.equal(K.seen.at(-1).h.cookie, undefined);
    assert.ok(r.headers['content-security-policy'].includes(`script-src 'unsafe-inline' ${gw.inst(P + 20)}${cap}/artifact/tree/${T}/mock/`), r.headers['content-security-policy']);
    // that tree's folder only
    for (const other of [`/artifact/tree/${'c'.repeat(40)}/mock/app.js`, '/artifact/main/mock/app.js', `/artifact/tree/${T}/other/app.js`, `/artifact/tree/${T}/mock/../../main/mock/app.js`])
      assert.equal((await gw.req('GET', `${cap}${other}`, { on: P + 20, cookie: '', headers: opaque })).status, 403, other);
    // a sha256 tree, and a top-level open, as main's
    assert.equal((await gw.req('GET', `/artifact/tree/${'d'.repeat(64)}/mock/`, { on: P + 20, headers: framed })).status, 302);
    assert.equal((await gw.req('GET', `/artifact/tree/${T}/mock/`, { on: P + 20, headers: { ...framed, 'sec-fetch-dest': 'document' } })).status, 302);
    // not a tree id: no capability; the request goes to the kit as it came
    for (const bad of [`/artifact/tree/${'b'.repeat(39)}/mock/`, `/artifact/tree/${'B'.repeat(40)}/mock/`, `/artifact/tree/${T}x/mock/`, `/artifact/tree/${'b'.repeat(41)}/mock/`]) {
      r = await gw.req('GET', bad, { on: P + 20, headers: framed });
      assert.deepEqual([r.status, r.headers.location], [200, undefined], bad);
    }
  } finally { await K.close(); await gw.close(); }
});
```

- [ ] **Step 3: Run it.** `$NODE --test --test-name-pattern "published tree goes under" test/gateway.test.mjs`. Expect a failure at the first `302`: today's `ARTIFACT` doesn't know `tree/`, so the request is proxied and answers 200.
- [ ] **Step 4: Implement.** In `cloud/gateway.mjs`, replace the comment and `ARTIFACT` at lines 960-963:

```js
  // A sandboxed artifact can't be told from another site's page by its headers, and its bytes use
  // relative URLs. So the frame's first load (same-origin, with the session) is redirected under
  // /c/<expiry>.<session>.<mac>/, good for that one artifact folder, and its files need no cookie.
  // The folder is main's, a worktree's, or a published tree's (the owner's wrapper shows exactly the
  // version the public sees: spec §8).
  const ARTIFACT = /^\/artifact\/(?:main|wt\/[^/]+|tree\/[0-9a-f]{40}(?:[0-9a-f]{24})?)\/[^/]+\//;
```

- [ ] **Step 5: Run it, then the file.** The test above, then `$NODE --test test/gateway.test.mjs`. Expect green.
- [ ] **Step 6: Commit.** `gateway: an artifact at a published tree goes under a capability as main's does`

### Task 2: The public name may frame an instance's viewer and published trees, and nothing else

**Files:**
- Modify: `cloud/gateway.mjs` (after `publicCsp` at line 399: `FRAME_ANCESTORS`, `addFrameAncestor`; in `createGateway` beside `ARTIFACT`: `PUBLIC_FRAMED`, `publicFramed`; `proxy` at 789-804; the capability branch at 1469; the instance branch at 1519)
- Test: `test/gateway.test.mjs` (appended)

- [ ] **Step 1: The test.** Append:

```js
test('frame-ancestors gains the public name on an instance\'s viewer and published trees, and nowhere else', async () => {
  // the pure edit: one more source wherever a policy names who may frame it
  assert.equal(G.addFrameAncestor("default-src 'none'; frame-ancestors 'self' https://a", 'https://p'), "default-src 'none'; frame-ancestors 'self' https://a https://p");
  assert.equal(G.addFrameAncestor("frame-ancestors https://a ; img-src x", 'https://p'), 'frame-ancestors https://a https://p ; img-src x');
  assert.equal(G.addFrameAncestor("frame-ancestors https://a, script-src 'self'; frame-ancestors https://b", 'https://p'), "frame-ancestors https://a https://p, script-src 'self'; frame-ancestors https://b https://p", 'every policy in the header');
  assert.equal(G.addFrameAncestor("frame-ancestors 'none'", 'https://p'), "frame-ancestors 'none'", "'none' stays no one");
  assert.equal(G.addFrameAncestor('frame-ancestors;', 'https://p'), 'frame-ancestors;', 'an empty list is no one too');
  assert.equal(G.addFrameAncestor("default-src 'self'", 'https://p'), "default-src 'self'", 'no directive: none is added, which would narrow it');
  assert.equal(G.addFrameAncestor("default-src 'self'; x-frame-ancestors a", 'https://p'), "default-src 'self'; x-frame-ancestors a", 'only the directive itself');
  const gw = await gateway('public-ancestor');
  const K = fakeKit(P + 20);
  await K.up();
  const T = 'b'.repeat(40);
  const fa = (r) => r.headers['content-security-policy'].split(/;\s*/).find((d) => d.startsWith('frame-ancestors'));
  const fromPublic = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' };
  const framed = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' };
  const opaque = { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'style' };
  const inst = gw.inst(P + 20);
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    for (const v of [`/view/artifact/mock?at=tree:${T}`, '/view/preview/cool-tiger'])
      assert.equal(fa(await gw.req('GET', v, { on: P + 20, headers: fromPublic })), `frame-ancestors 'self' ${gw.publicUrl} ${gw.site}`, v);
    // a published tree, under its capability and without
    const cap = /^(\/c\/[^/]+)\//.exec((await gw.req('GET', `/artifact/tree/${T}/mock/`, { on: P + 20, headers: framed })).headers.location)[1];
    assert.equal(fa(await gw.req('GET', `${cap}/artifact/tree/${T}/mock/s.css`, { on: P + 20, cookie: '', headers: opaque })), `frame-ancestors ${inst} ${gw.publicUrl} ${gw.site}`);
    assert.equal(fa(await gw.req('GET', `/artifact/tree/${T}/mock/s.css`, { on: P + 20 })), `frame-ancestors ${inst} ${gw.publicUrl} ${gw.site}`);
    // nothing else of an instance's
    const mainCap = /^(\/c\/[^/]+)\//.exec((await gw.req('GET', '/artifact/main/mock/', { on: P + 20, headers: framed })).headers.location)[1];
    assert.equal(fa(await gw.req('GET', `${mainCap}/artifact/main/mock/s.css`, { on: P + 20, cookie: '', headers: opaque })), `frame-ancestors ${inst} ${gw.publicUrl}`, 'main\'s artifacts');
    for (const other of ['/', '/api/data', '/viewer/x', '/view', '/view/../api/data', '/view/%2e%2e/api/data', '/x/view/a', '/artifact/tree/notasha/mock/'])
      assert.equal(fa(await gw.req('GET', other, { on: P + 20 })), `frame-ancestors 'self' ${gw.publicUrl}`, other);
  } finally { await K.close(); await gw.close(); }
});
```

- [ ] **Step 2: Run it.** `$NODE --test --test-name-pattern "gains the public name" test/gateway.test.mjs`. Expect a failure at once: `G.addFrameAncestor` is not a function.
- [ ] **Step 3: Implement the pure edits.** In `cloud/gateway.mjs`, after `publicCsp` (it ends at line 399) and before `LINK_ID`, add:

```js
// The frame-ancestors directive of each policy in a header (several arrive joined by ", "), with
// what precedes it and the list it names.
const FRAME_ANCESTORS = /(^|[;,])(\s*)frame-ancestors(?=[\s;,]|$)([^;,]*)/gi;
// One more origin that may frame the page, in every policy that names who may. A page that says no
// one, or says nothing, is left as it is: adding a directive where there was none would narrow it.
export const addFrameAncestor = (csp, origin) => csp.replace(FRAME_ANCESTORS, (all, sep, sp, list) => (!list.trim() || /^\s*'none'\s*$/i.test(list) ? all : `${sep}${sp}frame-ancestors ${list.trim()} ${origin}${/\s$/.test(list) ? ' ' : ''}`));
```

- [ ] **Step 4: Implement the rule.** In `createGateway`, right after `ARTIFACT` (Task 1), add:

```js
  // An instance's viewer, and an artifact at a published tree, may also be framed by the owner's
  // wrapper on the public name (spec §8). frame-ancestors is checked against every ancestor, and the
  // wrapper is one. Nothing else of an instance's is opened to it: a tree only by a real tree id, as
  // ARTIFACT takes it. The raw path, as the kit reads it.
  const PUBLIC_FRAMED = /^\/(?:view\/|artifact\/tree\/[0-9a-f]{40}(?:[0-9a-f]{24})?\/)/;
  const publicFramed = (raw) => PUBLIC_FRAMED.test(raw) && !/\.\.|%2e|%5c|\\/i.test(raw);
```

Replace `proxy`'s signature and its `writeHead` (lines 789-793):

```js
  const proxy = (req, res, { port, path: p, publicOrigin, cap, extra = null, publicFrame = false }) => {
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: p, headers: upstreamHeaders(req, port, publicOrigin) }, (ur) => {
      const head = downstreamHeaders(ur.headers, cap, publicOrigin);
      if (publicFrame && head['content-security-policy']) head['content-security-policy'] = addFrameAncestor(String(head['content-security-policy']), PUBLIC);
      // Never kept: a page an agent served once on this name must not come back from the browser's
      // cache after a real dashboard has taken its port.
      res.writeHead(ur.statusCode, { ...head, 'cache-control': 'no-store', ...(extra ?? {}) });
```

In the capability branch (line 1469), pass `publicFrame: publicFramed(cm[4])`:

```js
        return proxy(req, res, { port, path: cm[4] + url.search, publicOrigin: own, cap: `/c/${cm[1]}.${cm[2]}.${cm[3]}`, publicFrame: publicFramed(cm[4]) });
```

In the instance branch (line 1519), pass `publicFrame: publicFramed(rawPath)`:

```js
        return proxy(req, res, { port, path: req.url, publicOrigin: own, publicFrame: publicFramed(rawPath), extra: req.method === 'GET' && p === '/api/data' ? { 'x-devteam-public': publicMap(port), 'x-devteam-previews': '1' } : null });
```

- [ ] **Step 5: Run it, then the file.** Expect green.
- [ ] **Step 6: Commit.** `gateway: the public name may frame an instance's viewer and published trees, and nothing else`

### Task 3: A preview framed by its own name gets past the app's framing headers, and nothing else does

**Files:**
- Modify: `cloud/gateway.mjs` (after `addFrameAncestor`: `replaceFrameAncestors`; after `previewOrigin` at line 563: `LENS_ANCESTORS`; `downstreamHeaders` at 776-788; `proxyPreview`'s `writeHead` at 829)
- Test: `test/gateway.test.mjs` (appended)

- [ ] **Step 1: The test.** Append:

```js
test('a preview framed from its own name (its lens) gets past the app\'s framing headers, and nothing else does', async () => {
  assert.equal(G.replaceFrameAncestors("default-src 'self'; frame-ancestors 'none'", "'self' https://a"), "default-src 'self'; frame-ancestors 'self' https://a");
  assert.equal(G.replaceFrameAncestors("frame-ancestors 'none', frame-ancestors https://x; img-src y", 'https://a'), 'frame-ancestors https://a, frame-ancestors https://a; img-src y');
  assert.equal(G.replaceFrameAncestors("default-src 'self'", 'https://a'), "default-src 'self'", 'none is added');
  assert.equal(G.replaceFrameAncestors("frame-ancestors 'none' ; img-src y", 'https://a'), 'frame-ancestors https://a ; img-src y', 'the space before the next directive is kept');
  const S = await previewSetup('preview-framing');
  const { gw, hub, instance, req, origin } = S;
  const devPort = await freePort();
  const dev = http.createServer((q, s) => {
    if (q.url === '/nocsp') s.writeHead(200, { 'x-frame-options': 'SAMEORIGIN' });
    else if (q.url === '/two') s.writeHead(200, { 'content-security-policy': ["frame-ancestors 'none'", "script-src 'self'; frame-ancestors http://elsewhere.example"] });
    else s.writeHead(200, { 'x-frame-options': 'DENY', 'content-security-policy': `default-src 'self' http://127.0.0.1:${devPort}; frame-ancestors 'none'`, 'content-security-policy-report-only': "frame-ancestors 'none'" });
    s.end('app');
  });
  // a WebSocket's answer carries a policy too: a socket is no frame, so it stays as sent
  dev.on('upgrade', (q, sock) => {
    const accept = crypto.createHash('sha1').update(`${q.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.on('error', () => {});
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nContent-Security-Policy: frame-ancestors 'none'\r\nX-Frame-Options: DENY\r\n\r\n`);
  });
  await new Promise((r) => dev.listen(devPort, '127.0.0.1', r));
  // an instance's page that refuses frames: the relaxation is a preview's alone
  const inst = http.createServer((q, s) => { s.writeHead(200, { 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }); s.end('dashboard'); });
  await new Promise((r) => inst.listen(P + 21, '127.0.0.1', r));
  const site = origin('cool-tiger');
  const lens = `'self' ${gw.publicUrl} ${Array.from({ length: 25 }, (_, i) => gw.inst(P + i)).join(' ')}`;
  const as = (dest, from) => ({ 'sec-fetch-dest': dest, 'sec-fetch-site': from, 'sec-fetch-mode': 'navigate' });
  try {
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)])];
    let r = await req('cool-tiger', 'GET', '/', { headers: as('iframe', 'same-origin') });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.headers['x-frame-options'], undefined, 'X-Frame-Options goes');
    assert.equal(r.headers['content-security-policy'], `default-src 'self' ${site}; frame-ancestors ${lens}`, 'frame-ancestors names the lens and what may hold it; the rest is kept');
    assert.equal(r.headers['content-security-policy-report-only'], "frame-ancestors 'none'", 'a report-only policy blocks nothing, and is left');
    for (const [dest, from] of [['document', 'none'], ['iframe', 'same-site'], ['frame', 'same-origin'], ['object', 'same-origin'], ['embed', 'same-origin']]) {
      r = await req('cool-tiger', 'GET', '/', { headers: as(dest, from) });
      assert.deepEqual([r.status, r.headers['x-frame-options'], r.headers['content-security-policy']], [200, 'DENY', `default-src 'self' ${site}; frame-ancestors 'none'`], `${dest} from ${from}: the app's own headers`);
    }
    assert.equal((await req('cool-tiger', 'GET', '/', { headers: as('iframe', 'cross-site') })).status, 403, 'another site\'s frame is still refused');
    r = await req('cool-tiger', 'GET', '/nocsp', { headers: as('iframe', 'same-origin') });
    assert.deepEqual([r.headers['x-frame-options'], r.headers['content-security-policy']], [undefined, undefined], 'no policy: none is added');
    r = await req('cool-tiger', 'GET', '/two', { headers: as('iframe', 'same-origin') });
    assert.equal(r.headers['content-security-policy'], `frame-ancestors ${lens}, script-src 'self'; frame-ancestors ${lens}`, 'every policy in the header');
    // confined to previews: an instance's page framed from its own name keeps its headers
    r = await gw.req('GET', '/x', { on: P + 21, headers: as('iframe', 'same-origin') });
    assert.deepEqual([r.status, r.headers['x-frame-options'], r.headers['content-security-policy']], [200, 'DENY', "default-src 'self'; frame-ancestors 'none'"], 'an instance\'s page');
    // and a socket's handshake is passed on as sent
    await gw.g.pollPush();
    const c = await wsClient(gw.port, S.on('cool-tiger'), { origin: site, cookie: gw.jar() });
    assert.equal(c.status, 101);
    assert.match(c.head, /content-security-policy: frame-ancestors 'none'/i, 'a WebSocket\'s policy is unchanged');
    assert.match(c.head, /x-frame-options: DENY/i);
    c.close();
  } finally { await S.close(); dev.close(); inst.close(); }
});
```

- [ ] **Step 2: Run it.** `$NODE --test --test-name-pattern "framed from its own name" test/gateway.test.mjs`. Expect a failure at once: `G.replaceFrameAncestors` is not a function.
- [ ] **Step 3: Implement.** After `addFrameAncestor` (Task 2), add:

```js
// Who may frame the page, replaced in every policy that says. A policy that doesn't say gets nothing.
export const replaceFrameAncestors = (csp, sources) => csp.replace(FRAME_ANCESTORS, (all, sep, sp, list) => `${sep}${sp}frame-ancestors ${sources}${/\s$/.test(list) ? ' ' : ''}`);
```

In `createGateway`, after `previewOrigin` (line 563), add:

```js
  // Who may hold a preview's lens, and so the app inside it: frame-ancestors is checked against every
  // ancestor, so the hub (which frames a dashboard) as well as each instance (whose viewer frames the lens).
  const LENS_ANCESTORS = [PUB, ...BLOCK.map(instanceOrigin)].join(' ');
```

Replace `downstreamHeaders`'s first line and its end (lines 776 and 785-788):

```js
  // framedBySelf: a preview's page framed from its own origin, which is how its lens holds it (spec
  // §7). For that load alone the app's own framing headers give way, to the lens and what may hold it.
  const downstreamHeaders = (h, cap, own, previewPort = null, framedBySelf = false) => {
```

```js
    // an artifact under its capability: its policy stays under it too
    if (cap && out['content-security-policy']) out['content-security-policy'] = out['content-security-policy'].split(`${own}/artifact/`).join(`${own}${cap}/artifact/`);
    if (previewPort && framedBySelf) {
      delete out['x-frame-options'];
      if (out['content-security-policy']) out['content-security-policy'] = replaceFrameAncestors(String(out['content-security-policy']), `'self' ${LENS_ANCESTORS}`);
    }
    return { ...out, ...hsts };
  };
```

Replace `proxyPreview`'s `writeHead` (line 829):

```js
        res.writeHead(ur.statusCode, { ...downstreamHeaders(ur.headers, null, own, link.port, req.headers['sec-fetch-dest'] === 'iframe' && req.headers['sec-fetch-site'] === 'same-origin'), 'cache-control': 'no-store' });
```

`previewHandshake` (line 1707) keeps calling `downstreamHeaders(parsed, null, own, port)`: a socket is no frame.

- [ ] **Step 4: Run it, then the file.** Expect green, the existing `a preview: the owner reaches the dev server` test included: its `x-frame-options: DENY` passes through on a plain load.
- [ ] **Step 5: Commit.** `gateway: a preview framed by its own name gets past the app's framing headers, and nothing else does`

### Task 4: The lens document

**Files:**
- Modify: `cloud/gateway.mjs` (after `previewLinks`, which ends at line 268: `PREVIEW_LENS`, `lensPart`, `lensHash`, `previewLensCsp`)
- Test: `test/gateway.test.mjs` (a helper `lensRun` and two tests, appended)

- [ ] **Step 1: The tests.** Append:

```js
// The lens's script on its own, with a stand-in for its page and its parent: what it hears, and what
// it says back. Nothing is loaded in its frame (contentWindow is null), as before the app answers.
// Its timers are stubs: the rect pushes (animation frames, the 100 ms debounce, the 1 s backstop)
// are checked only in Chrome (test/browser/dev-links.mjs).
function lensRun({ search = '', ancestor = 'http://4321.box.example' } = {}) {
  const script = /<script>([\s\S]*?)<\/script>/.exec(G.PREVIEW_LENS)[1];
  const listeners = {};
  const posted = [];
  const frame = { src: '', contentWindow: null, addEventListener() {} };
  const parent = { postMessage: (m, o) => posted.push({ m: JSON.parse(JSON.stringify(m)), o }) };
  const win = {
    document: { getElementById: (id) => (id === 'app' ? frame : null) },
    location: { search, origin: 'http://cool-tiger.box.example', ancestorOrigins: ancestor ? [ancestor] : undefined },
    parent, addEventListener: (t, f) => { (listeners[t] ??= []).push(f); },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0,
    TextEncoder, URL, URLSearchParams, CSS: { escape: (s) => s },
  };
  win.window = win;
  vm.runInNewContext(script, win);
  const hear = (data, { origin = ancestor ?? 'http://4321.box.example', source = parent } = {}) => { for (const f of listeners.message ?? []) f({ data, origin, source }); };
  return { frame, posted, hear };
}

test('the preview lens: one script and one style, a policy of their hashes, and the kit\'s caps', () => {
  const L = G.PREVIEW_LENS;
  const script = /<script>([\s\S]*?)<\/script>/.exec(L)[1];
  const style = /<style>([\s\S]*?)<\/style>/.exec(L)[1];
  assert.deepEqual([L.match(/<script\b/g).length, L.match(/<style\b/g).length], [1, 1]);
  assert.doesNotMatch(L.replace(script, '').replace(style, ''), /\son[a-z]+\s*=|\sstyle\s*=|\ssrc\s*=|\shref\s*=/i, 'no handler, style, src or link in the markup: the policy admits the two hashes and nothing else');
  assert.doesNotMatch(L, /[^\x20-\x7e\n]/, 'plain ASCII, so the kit\'s copy compares byte for byte');
  assert.doesNotMatch(L, /`|\$\{/, 'no backtick and no ${ in it: it is a String.raw template in both files');
  assert.doesNotThrow(() => new vm.Script(script), 'the script parses');
  const h = (t) => `'sha256-${crypto.createHash('sha256').update(t).digest('base64')}'`;
  assert.equal(G.previewLensCsp('http://a http://b'), `default-src 'none'; script-src ${h(script)}; style-src ${h(style)}; frame-src 'self'; frame-ancestors http://a http://b; base-uri 'none'; form-action 'none'`);
  // spec §5's caps, as the kit records an anchor and a preview subject
  const caps = vm.runInNewContext(`(${/const CAPS = (\{[^}]*\});/.exec(script)[1]})`);
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const kitCaps = (name) => vm.runInNewContext(`(${new RegExp(`^const ${name} = (\\{.*\\});$`, 'm').exec(src)[1]})`);
  for (const [k, v] of Object.entries(kitCaps('ANCHOR_CAPS'))) assert.equal(caps[k], v, `anchor.${k}`);
  assert.equal(caps.route, kitCaps('SUBJECT_CAPS').route);
  assert.deepEqual([caps.errors, caps.error], [3, 200], 'three errors of 200 bytes');
});

test('the preview lens answers only the page that frames it, and takes the app only to its own paths', () => {
  let L = lensRun();
  assert.equal(L.frame.src, '/', 'the app, at its root');
  L.hear({ lens: 1, type: 'hello' });
  assert.deepEqual(L.posted, [{ m: { lens: 1, type: 'ready', route: null, title: '', viewport: null }, o: 'http://4321.box.example' }], 'hello: what is framed now, to that origin alone');
  L.hear({ lens: 1, type: 'hit', id: 'h1', x: 10, y: 20 });
  assert.deepEqual(L.posted.at(-1).m, { lens: 1, type: 'hit-reply', id: 'h1', anchor: null, rect: null, route: null }, 'nothing loaded: nothing under the point');
  const n = L.posted.length;
  L.hear({ lens: 1, type: 'hello' }, { source: {} });
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://cool-tiger.box.example' });
  L.hear({ lens: 1, type: 'hello' }, { origin: 'null' });
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://4322.box.example' });
  L.hear({ type: 'hello' });
  L.hear({ lens: 1, type: 'toString' });
  L.hear({ lens: 1, type: 'hit', id: { no: 1 }, x: 1, y: 1 });
  L.hear({ lens: 1, type: 'hit', id: 'h2', x: 'a', y: 1 });
  L.hear('hello');
  assert.equal(L.posted.length, n, 'not its parent, the app\'s own origin, an opaque one, not the parent the browser names, not a lens message, not an order, a bad id or point: each ignored');
  // a first message from an origin the browser doesn't name as the parent binds nothing and gets nothing
  L = lensRun();
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://4322.box.example' });
  L.hear({ lens: 1, type: 'hit', id: 'h1', x: 1, y: 1 }, { origin: 'http://4322.box.example' });
  assert.deepEqual(L.posted, [], 'nothing to a page that is not the parent');
  L.hear({ lens: 1, type: 'hello' });
  assert.deepEqual(L.posted.map((x) => x.o), ['http://4321.box.example'], 'and the real parent is still answered');
  // where the browser doesn't name the parent's origin, the first one heard is the only one
  L = lensRun({ ancestor: null });
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://4321.box.example' });
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://4322.box.example' });
  assert.deepEqual(L.posted.map((x) => x.o), ['http://4321.box.example']);
  // go, and the first route: this origin's paths only, never the lens's own
  L.hear({ lens: 1, type: 'go', route: '/checkout?step=2#pay' }, { origin: 'http://4321.box.example' });
  assert.equal(L.frame.src, '/checkout?step=2#pay');
  for (const bad of ['//evil.example/x', 'https://evil.example/', 'checkout', '/\\evil.example', '/.devteam/lens', '', 5]) {
    L.hear({ lens: 1, type: 'go', route: bad }, { origin: 'http://4321.box.example' });
    assert.equal(L.frame.src, '/checkout?step=2#pay', `go ${bad}`);
  }
  assert.equal(lensRun({ search: '?route=%2Fadmin%3Fx%3D1' }).frame.src, '/admin?x=1');
  for (const bad of ['?route=%2F%2Fevil.example', '?route=https%3A%2F%2Fevil.example', '?route=%2F.devteam%2Flens']) assert.equal(lensRun({ search: bad }).frame.src, '/', bad);
});
```

- [ ] **Step 2: Run them.** `$NODE --test --test-name-pattern "preview lens" test/gateway.test.mjs`. Expect a failure at once: `G.PREVIEW_LENS` is undefined.
- [ ] **Step 3: Implement.** After `previewLinks` (it ends at line 268), add:

```js
// --- the preview lens: the gateway's own page on a preview's name, framing the app -------------
// The kit's viewer frames it at /.devteam/lens. On the app's own origin, it reads the app's page for
// the viewer over postMessage (spec §7). The kit's laptop relay serves the same bytes, so its
// source is in devteam.mjs too, and a test holds the two equal. It is a String.raw, so its regular
// expressions read as written, and so it may hold no backtick and no dollar sign before a brace.
export const PREVIEW_LENS = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview</title><style>html,body{margin:0;height:100%;overflow:hidden;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><iframe id="app" title="The app" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-pointer-lock allow-downloads"></iframe><script>
(() => {
  'use strict';
  // devteam's preview lens. It is on the app's own origin, so it can read the app's page. It frames
  // the app, and answers the viewer that frames it, over postMessage, about what is where. It takes
  // only the viewer's questions (hello, hit, resolve, scroll-by, scroll-to, go), tells it only about
  // the app (ready, route, hit-reply, rects, key, errors), and holds nothing of the owner's.
  const CAPS = { selector: 200, tag: 40, role: 40, text: 80, name: 80, html: 1024, route: 300, error: 200, errors: 3 };
  const WATCH_MAX = 200;
  const KEY_MAX = 120;
  const frame = document.getElementById('app');
  const enc = new TextEncoder();
  const size = (s) => enc.encode(s).length;
  // at most n bytes of UTF-8, never half a character
  const cap = (s, n) => {
    const str = String(s == null ? '' : s);
    if (size(str) <= n) return str;
    let out = '';
    let b = 0;
    for (const c of str) { const k = size(c); if (b + k > n) break; out += c; b += k; }
    return out;
  };
  const capDots = (s, n) => (size(s) <= n ? s : cap(s, n - 3) + '\u2026');
  const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = (v) => typeof v === 'number' && isFinite(v);
  const idOk = (id) => (typeof id === 'string' && id.length > 0 && id.length <= 64) || (Number.isInteger(id) && id >= 0);

  // --- the viewer: the page that frames this one, and only it ----------------------------------
  // This page's frame-ancestors says who that may be. Here: a message must come from that frame
  // (never the app, which shares this origin), and from the origin first heard.
  let viewer = null;
  const tell = (m) => { if (viewer) parent.postMessage(Object.assign({ lens: 1 }, m), viewer); };

  // --- the app ----------------------------------------------------------------------------------
  const appWindow = () => { try { const w = frame.contentWindow; return w && w.document && w.location.href !== 'about:blank' ? w : null; } catch (e) { return null; } };
  const routeOf = (w) => { try { return w.location.origin === location.origin ? cap(w.location.pathname + w.location.search + w.location.hash, CAPS.route) : null; } catch (e) { return null; } };
  // a path on this origin, and never the lens's own
  const safeRoute = (r) => {
    if (typeof r !== 'string' || r[0] !== '/' || r[1] === '/' || r.indexOf('\\') >= 0 || size(r) > 2048) return null;
    try { const u = new URL(r, location.origin); return u.origin === location.origin && u.pathname.indexOf('/.devteam/') !== 0 ? u.pathname + u.search + u.hash : null; } catch (e) { return null; }
  };

  // --- what is where ------------------------------------------------------------------------------
  // an id or a class a person wrote, not one a build made (digit runs, hashes, React's :r1:)
  const plain = (s) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s) && !/[0-9]{3,}/.test(s) && !s.split(/[-_]/).some((p) => p.length >= 5 && /[0-9]/.test(p) && /[A-Za-z]/.test(p));
  const only = (doc, sel) => { try { return doc.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  const quoted = (v) => '"' + String(v).replace(/["\\]/g, '\\$&') + '"';
  const selectorOf = (el, doc) => {
    const tag = el.localName;
    if (el.id && plain(el.id) && only(doc, '#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    for (const [n, ok] of [['data-testid', true], ['name', /^(input|select|textarea|button|form)$/.test(tag)], ['aria-label', true]]) {
      const v = el.getAttribute(n);
      const sel = v ? tag + '[' + n + '=' + quoted(v) + ']' : '';
      if (ok && v && size(v) <= 100 && only(doc, sel)) return sel;
    }
    const steps = [];
    for (let e = el; e && e.nodeType === 1 && e !== doc.documentElement && steps.length < 6; e = e.parentElement) {
      if (e !== el && e.id && plain(e.id) && only(doc, '#' + CSS.escape(e.id))) { steps.unshift('#' + CSS.escape(e.id)); break; }
      let n = 1;
      for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === e.localName) n += 1;
      steps.unshift(e.localName + Array.prototype.filter.call(e.classList, plain).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('') + ':nth-of-type(' + n + ')');
    }
    while (steps.length > 1 && size(steps.join(' > ')) > CAPS.selector) steps.shift();
    return cap(steps.join(' > '), CAPS.selector);
  };
  const ROLES = { button: 'button', select: 'combobox', textarea: 'textbox', img: 'img', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', form: 'form', table: 'table', ul: 'list', ol: 'list', li: 'listitem', dialog: 'dialog', aside: 'complementary', section: 'region', option: 'option', summary: 'button' };
  const INPUTS = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox' };
  const roleOf = (el) => {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.localName;
    if (t === 'a') return el.hasAttribute('href') ? 'link' : '';
    if (t === 'input') return INPUTS[(el.getAttribute('type') || 'text').toLowerCase()] || 'textbox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    return ROLES[t] || '';
  };
  const nameOf = (el, doc) => {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    const by = el.getAttribute('aria-labelledby');
    const named = by ? by.split(/\s+/).map((id) => { const x = doc.getElementById(id); return x ? x.textContent : ''; }).join(' ') : '';
    if (oneLine(named)) return named;
    if (el.labels && el.labels.length) return el.labels[0].textContent;
    for (const n of ['alt', 'title', 'placeholder']) { const v = el.getAttribute(n); if (v) return v; }
    return el.textContent;
  };
  // the element with its own children, each child's contents collapsed to an ellipsis
  const htmlOf = (el) => {
    const top = el.cloneNode(false);
    let k = 0;
    for (const c of el.childNodes) {
      if (++k > 50) { top.appendChild(el.ownerDocument.createTextNode('\u2026')); break; }
      if (c.nodeType === 3) top.appendChild(c.cloneNode(false));
      else if (c.nodeType === 1) { const d = c.cloneNode(false); if (c.firstChild) d.textContent = '\u2026'; top.appendChild(d); }
    }
    return capDots(top.outerHTML, CAPS.html);
  };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const textOf = (el) => cap(oneLine(el.textContent), CAPS.text);
  const anchorOf = (el, doc, x, y) => {
    const rect = rectOf(el);
    return { selector: selectorOf(el, doc), tag: cap(el.localName, CAPS.tag), role: cap(roleOf(el), CAPS.role), text: textOf(el), name: cap(oneLine(nameOf(el, doc)), CAPS.name), html: htmlOf(el), rect, point: { x: Math.round(x - rect.x), y: Math.round(y - rect.y) } };
  };
  // Where an anchor is now: by its selector (changed: with other text now), else an element of its
  // tag with its text, the nearest to where it was.
  const find = (doc, a) => {
    let el = null;
    try { el = doc.querySelector(a.selector); } catch (e) { el = null; }
    if (el) { const t = textOf(el); return { el, changed: typeof a.text === 'string' && t !== a.text, text: t }; }
    if (typeof a.text !== 'string' || !a.text || typeof a.tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(a.tag)) return null;
    const was = a.rect && num(a.rect.x) && num(a.rect.y) ? a.rect : { x: 0, y: 0 };
    const all = doc.getElementsByTagName(a.tag);
    let best = null;
    let far = Infinity;
    for (let i = 0; i < all.length && i < 5000; i++) {
      if (textOf(all[i]) !== a.text) continue;
      const r = all[i].getBoundingClientRect();
      const d = Math.hypot(r.left - was.x, r.top - was.y);
      if (d < far) { far = d; best = all[i]; }
    }
    return best ? { el: best, changed: false, text: a.text } : null;
  };

  // --- what the viewer watches: sent when it moves --------------------------------------------
  let watched = [];
  let sent = '';
  const sendRects = (id) => {
    const w = appWindow();
    const rects = watched.map((x) => { const f = w ? find(w.document, x.anchor) : null; return f ? { key: x.key, rect: rectOf(f.el), changed: f.changed, text: f.text } : { key: x.key, rect: null }; });
    const now = JSON.stringify(rects);
    if (id === undefined && now === sent) return;
    sent = now;
    tell(id === undefined ? { type: 'rects', rects } : { type: 'rects', id, rects });
  };
  let framePending = false;
  const soon = () => { if (framePending || !watched.length) return; framePending = true; requestAnimationFrame(() => { framePending = false; sendRects(); }); };
  let settle = 0;
  const later = () => { if (!watched.length) return; clearTimeout(settle); settle = setTimeout(() => sendRects(), 100); };

  // --- what the app does: its route, its keys, its errors ----------------------------------------
  let route = null;
  const checkRoute = () => { const w = appWindow(); const r = w ? routeOf(w) : null; if (r === route) return; route = r; tell({ type: 'route', route: r }); soon(); };
  let errors = [];
  const describe = (x) => { try { return x && typeof x === 'object' && 'message' in x ? String(x.message) : String(x); } catch (e) { return 'an error'; } };
  const noteError = (text) => { const one = cap(oneLine(text), CAPS.error); if (!one) return; errors = errors.concat(one).slice(-CAPS.errors); tell({ type: 'errors', errors }); };
  let shiftDown = false;
  const onKey = (e) => {
    if (e.key !== 'Shift' && e.key !== 'Escape') return;
    shiftDown = e.type === 'keydown' ? e.key === 'Shift' || e.shiftKey : e.key !== 'Shift' && e.shiftKey;
    tell({ type: 'key', key: e.key, shift: shiftDown });
  };
  const onBlur = () => { if (shiftDown) { shiftDown = false; tell({ type: 'key', key: 'Shift', shift: false }); } };
  const readyOf = (w) => (w ? { type: 'ready', route: routeOf(w), title: cap(oneLine(w.document.title), CAPS.text), viewport: { w: w.innerWidth, h: w.innerHeight } } : { type: 'ready', route: null, title: '', viewport: null });
  // Each page the app loads is a new window: listen on it, in the capture phase so the app can't stop
  // a key reaching here, and note the errors it logs from then on.
  let attached = null;
  const attach = () => {
    const w = appWindow();
    if (!w || w.document === attached) return;
    attached = w.document;
    errors = [];
    try {
      w.addEventListener('keydown', onKey, true);
      w.addEventListener('keyup', onKey, true);
      w.addEventListener('blur', onBlur);
      w.addEventListener('error', (e) => { if (e && e.message) noteError(e.message); }, true);
      w.addEventListener('unhandledrejection', (e) => noteError('Unhandled rejection: ' + describe(e.reason)));
      const own = w.console && w.console.error;
      if (typeof own === 'function') w.console.error = function () { noteError(Array.prototype.map.call(arguments, describe).join(' ')); return own.apply(this, arguments); };
      w.addEventListener('scroll', soon, true);
      w.addEventListener('resize', soon);
      w.addEventListener('popstate', checkRoute);
      w.addEventListener('hashchange', checkRoute);
      new w.MutationObserver(later).observe(w.document, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (e) { /* a page that can't be watched is still framed */ }
    route = routeOf(w);
    tell(readyOf(w));
    sendRects();
  };

  // --- the viewer's questions ----------------------------------------------------------------------
  let last = { x: 0, y: 0 };
  const ORDERS = {
    hello: () => { tell(readyOf(appWindow())); if (errors.length) tell({ type: 'errors', errors }); },
    hit: (m) => {
      if (!idOk(m.id) || !num(m.x) || !num(m.y)) return;
      const w = appWindow();
      const doc = w && w.document;
      let el = doc ? doc.elementFromPoint(m.x, m.y) : null;
      // the page itself is no thing to point at: the viewer pins the point instead
      if (el && (el === doc.documentElement || el === doc.body)) el = null;
      last = { x: m.x, y: m.y };
      const anchor = el ? anchorOf(el, doc, m.x, m.y) : null;
      tell({ type: 'hit-reply', id: m.id, anchor, rect: anchor ? anchor.rect : null, route: w ? routeOf(w) : null });
    },
    resolve: (m) => {
      if (!idOk(m.id) || !Array.isArray(m.anchors)) return;
      watched = m.anchors.slice(0, WATCH_MAX).filter((x) => x && typeof x.key === 'string' && size(x.key) <= KEY_MAX && x.anchor && typeof x.anchor === 'object' && typeof x.anchor.selector === 'string' && size(x.anchor.selector) <= CAPS.selector).map((x) => ({ key: x.key, anchor: x.anchor }));
      sendRects(m.id);
    },
    'scroll-by': (m) => {
      const w = appWindow();
      if (!w) return;
      const step = (v) => (num(v) ? Math.max(-10000, Math.min(10000, v)) : 0);
      const at = num(m.x) && num(m.y) ? { x: m.x, y: m.y } : last;
      // the box under the pointer that scrolls, else the page
      for (let el = w.document.elementFromPoint(at.x, at.y); el && el !== w.document.body && el !== w.document.documentElement; el = el.parentElement) {
        const s = w.getComputedStyle(el);
        if (/(auto|scroll|overlay)/.test(s.overflowY + ' ' + s.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) { el.scrollBy(step(m.dx), step(m.dy)); return; }
      }
      w.scrollBy(step(m.dx), step(m.dy));
    },
    'scroll-to': (m) => {
      const w = appWindow();
      const a = m.anchor;
      if (!w || !a || typeof a !== 'object' || typeof a.selector !== 'string' || size(a.selector) > CAPS.selector) return;
      const f = find(w.document, a);
      if (f) f.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    },
    go: (m) => { const r = safeRoute(m.route); if (r) frame.src = r; },
  };
  addEventListener('message', (e) => {
    if (e.source !== parent || parent === window) return;
    if (e.origin === location.origin || e.origin === 'null') return;
    const ancestors = location.ancestorOrigins;
    if (ancestors && ancestors.length && ancestors[0] !== e.origin) return;
    if (viewer && e.origin !== viewer) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || m.lens !== 1 || typeof m.type !== 'string' || !Object.prototype.hasOwnProperty.call(ORDERS, m.type)) return;
    viewer = e.origin;
    try { ORDERS[m.type](m); } catch (err) { /* one bad question costs only itself */ }
  });
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKey, true);
  // the poll can find a page mid-parse (no title yet): its load says ready again, whatever attach did
  frame.addEventListener('load', () => { attach(); const w = appWindow(); if (w) tell(readyOf(w)); checkRoute(); });
  // an SPA's pushState can't be seen without touching its code: the route is polled
  setInterval(() => { attach(); checkRoute(); }, 250);
  setInterval(() => { if (watched.length) sendRects(); }, 1000);
  frame.src = safeRoute(new URLSearchParams(location.search).get('route')) || '/';
})();
</script></body></html>
`;
// The lens's policy: its one script and its one style by hash, its own origin to frame, and who may hold it.
const lensPart = (tag) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(PREVIEW_LENS)[1];
const lensHash = (tag) => `'sha256-${crypto.createHash('sha256').update(lensPart(tag)).digest('base64')}'`;
export const previewLensCsp = (ancestors) => `default-src 'none'; script-src ${lensHash('script')}; style-src ${lensHash('style')}; frame-src 'self'; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'none'`;
```

- [ ] **Step 4: Run them, then the file.** Expect green. If the ASCII assertion fails, an editor has turned `'\u2026'` or a quote into its character: put the escape back.
- [ ] **Step 5: Commit.** `gateway: the preview lens, the page that frames an app for the kit's viewer`

### Task 5: `GET /.devteam/lens` on a preview's name

**Files:**
- Modify: `cloud/gateway.mjs` (in `createGateway` after `LENS_ANCESTORS`: `LENS_CSP`; the handler's no-session branch at 1509-1513, and before `if (pv) return servePreview(…)` at line 1514)
- Test: `test/gateway.test.mjs` (appended)

- [ ] **Step 1: The test.** Append:

```js
test('/.devteam/lens on a preview\'s name: the gateway\'s own page, for the owner only, never the app\'s', async () => {
  const S = await previewSetup('preview-lens');
  const { gw, hub, instance, req } = S;
  const seen = [];
  const devPort = await freePort();
  const dev = http.createServer((q, s) => { seen.push(`${q.method} ${q.url}`); s.end('app'); });
  await new Promise((r) => dev.listen(devPort, '127.0.0.1', r));
  const ancestors = [gw.publicUrl, ...Array.from({ length: 25 }, (_, i) => gw.inst(P + i))].join(' ');
  const framed = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' };
  try {
    hub.list = [instance('/srv/alpha', P, [previewRow('cool-tiger', devPort)])];
    let r = await req('cool-tiger', 'GET', '/.devteam/lens', { cookie: '', headers: NAV });
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, `${gw.auth}/auth/login?next=${encodeURIComponent(`${S.origin('cool-tiger')}/`)}`, 'no session: sign-in, then back to the preview itself, not to a lens on its own');
    assert.equal((await req('cool-tiger', 'GET', '/.devteam/lens', { cookie: '', headers: { 'sec-fetch-mode': 'cors' } })).status, 401);
    r = await req('cool-tiger', 'GET', '/.devteam/lens?route=%2Fcheckout', { headers: framed });
    assert.equal(r.status, 200, r.body);
    assert.equal(r.body, G.PREVIEW_LENS);
    assert.deepEqual([r.headers['content-type'], r.headers['content-security-policy'], r.headers['cache-control'], r.headers['referrer-policy'], r.headers['x-frame-options']], ['text/html; charset=utf-8', G.previewLensCsp(ancestors), 'no-store', 'no-referrer', undefined]);
    assert.equal((await req('cool-tiger', 'GET', '/.devteam/lens', { headers: { ...framed, 'sec-fetch-site': 'cross-site' } })).status, 403, 'another site\'s frame is refused, as the app\'s would be');
    const hits = hub.hits;
    assert.equal((await req('calm-otter', 'GET', '/.devteam/lens', { headers: framed })).body, G.PREVIEW_LENS, 'the same page on any preview\'s name');
    assert.equal(hub.hits, hits, 'and serving it asks the hub nothing');
    assert.deepEqual(seen, [], 'the app saw none of it');
    // anything else at that path is the app's, as before
    await req('cool-tiger', 'POST', '/.devteam/lens', { headers: { origin: S.origin('cool-tiger') }, body: {} });
    await req('cool-tiger', 'GET', '/.devteam/lens/x');
    await req('cool-tiger', 'GET', '/.devteam/lensx');
    await req('cool-tiger', 'HEAD', '/.devteam/lens');
    assert.deepEqual(seen, ['POST /.devteam/lens', 'GET /.devteam/lens/x', 'GET /.devteam/lensx', 'HEAD /.devteam/lens']);
  } finally { await S.close(); dev.close(); }
});
```

- [ ] **Step 2: Run it.** `$NODE --test --test-name-pattern "devteam/lens on a preview" test/gateway.test.mjs`. Expect a failure at the sign-in's `location`: today's `next` is the lens URL.
- [ ] **Step 3: Implement.** After `LENS_ANCESTORS` (Task 3), add:

```js
  const LENS_CSP = previewLensCsp(LENS_ANCESTORS);
```

In the handler's no-session branch (lines 1509-1513), send a signed-out lens back to the preview itself:

```js
      const session = claimed ? sessionOf(req) : null;
      if (!session) {
        // a lens open in a tab of its own is no use after sign-in: the preview itself is
        const back = pv && p === '/.devteam/lens' ? `${own}/` : `${own}${req.url}`;
        if (navigating(req)) return redirect(res, claimed ? loginAt(back) : loginAt());
        return send(res, claimed ? 401 : 403, 'text/plain; charset=utf-8', claimed ? 'sign in with your passkey' : 'this box is unclaimed');
      }
```

Then replace the `if (pv) return servePreview(req, res, pv, own);` line (1514):

```js
      // A preview's lens: the gateway's own page, after the session check, never the app's (spec §7).
      // Static, so it asks the hub nothing; any other method or path there is the app's, as before.
      if (pv && req.method === 'GET' && p === '/.devteam/lens') return send(res, 200, 'text/html; charset=utf-8', PREVIEW_LENS, { 'content-security-policy': LENS_CSP, 'referrer-policy': 'no-referrer' });
      if (pv) return servePreview(req, res, pv, own);
```

- [ ] **Step 4: Run it, then the file.** Expect green.
- [ ] **Step 5: Commit.** `gateway: /.devteam/lens on a preview's name, for the signed-in owner, never proxied`

### Task 6: The owner wrapper on the public name

**Files:**
- Modify: `cloud/gateway.mjs` (`servePublic`'s comment at 1177-1179 and `head` at 1195; `WRAP_MS`, `WRAP_CSP` and `ownerWrapper` after `publicMap` at 1334; the `isPublic` branch at 1453-1456; `PAGES.ownerWrapper` after `publicList` at 1938-1941)
- Test: `test/gateway.test.mjs` (the comment at line 910 in the public test; a new test, appended)

- [ ] **Step 1: The test.** Append:

```js
test('public.<box>: the signed-in owner\'s own visit gets the viewer at the published version; anyone else, and any doubt, the plain bytes', async () => {
  const gw = await gateway('public-wrap', { wrapperHelloMs: 400 });
  const K = fakeKit(P + 20);
  await K.up();
  const page = '<!doctype html><p>hi';
  const tree = 'a'.repeat(40);
  const state = path.join(gw.dir, 'state.json');
  try {
    assert.equal((await gw.claim(authenticator())).status, 200);
    seedPublic(gw.dir, 'alpha', 'hello', { 'index.html': page, 'app.js': 'x()' }, { root: '/srv/alpha', port: P + 20 });
    const s = JSON.parse(fs.readFileSync(state, 'utf8'));
    s.public.alpha.artifacts.hello.title = 'A <b>mock</b>';
    fs.writeFileSync(state, JSON.stringify(s));
    const get = (route, headers = NAV, cookie = gw.jar()) => gw.req('GET', route, { on: 'public', cookie, headers });
    const plain = (r, why) => {
      assert.deepEqual([r.status, r.body, r.headers['cache-control'], r.headers.vary], [200, page, 'public, max-age=60', 'cookie'], why);
      assert.match(r.headers['content-security-policy'], /; sandbox allow-scripts allow-forms allow-modals allow-pointer-lock$/, why);
      assert.doesNotMatch(r.headers['content-security-policy'], /allow-same-origin/, why);
    };
    let r = await get('/alpha/hello/');
    assert.equal(r.status, 200);
    assert.notEqual(r.body, page, 'the wrapper, not the bytes');
    assert.deepEqual([r.headers['cache-control'], r.headers.vary, r.headers['x-frame-options'], r.headers['referrer-policy'], r.headers['set-cookie']], ['no-store, private', 'cookie', 'DENY', 'no-referrer', undefined]);
    assert.equal(r.headers['content-security-policy'], `default-src 'none'; style-src 'unsafe-inline'; frame-src ${gw.inst(P + 20)}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, 'a policy of its own: no script, nothing to connect to');
    assert.match(r.body, /sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"/);
    assert.doesNotMatch(r.body, /allow-popups-to-escape-sandbox|allow-top-navigation/, 'its frame can neither navigate this tab nor open a window outside its sandbox');
    assert.ok(r.body.includes(`<iframe src="${gw.inst(P + 20)}/view/artifact/hello?at=tree:${tree}"`), r.body);
    assert.match(r.body, /<a href="\?plain">Open it as the public sees it<\/a>/);
    assert.match(r.body, /Public · alpha\/hello/);
    assert.ok(r.body.includes('A &#60;b&#62;mock') && !r.body.includes('<b>mock'), 'the title is escaped');
    assert.doesNotMatch(r.body, /<script/i, 'no script of its own');
    const asked = K.seen.filter((x) => x.url === '/api/hello');
    assert.equal(asked.length, 1, 'the wrapper asked the bound instance who it is');
    assert.deepEqual([asked[0].h.host, asked[0].h.cookie, asked[0].h['sec-fetch-site'], asked[0].h.origin], [`127.0.0.1:${P + 20}`, undefined, undefined, undefined], 'as a loopback client: nothing of the owner\'s goes with it');
    assert.ok((await get('/alpha/hello/index.html')).body.includes('<iframe'), 'its index by name too');
    // the plain bytes, with vary: cookie on the document
    plain(await get('/alpha/hello/?plain'), '?plain');
    plain(await get('/alpha/hello/', { ...NAV, 'sec-fetch-dest': 'iframe' }), 'a frame load');
    plain(await get('/alpha/hello/', { accept: 'text/html' }), 'no fetch metadata: an old browser');
    const hellos = () => K.seen.filter((x) => x.url === '/api/hello').length;
    const before = hellos();
    plain(await get('/alpha/hello/', NAV, ''), 'no cookie');
    plain(await get('/alpha/hello/', NAV, `devteam_session=${'A'.repeat(43)}`), 'a cookie that is no session');
    assert.equal(hellos(), before, 'without a session the instance is never asked: no anonymous visit reaches it');
    // a signed-in owner arriving from a link elsewhere gets it too: nothing in it is readable to
    // that site, its frame is sandboxed, and the frame's URL comes from the binding, not the query
    r = await get('/alpha/hello/?at=main&slug=other', { ...NAV, 'sec-fetch-site': 'cross-site' });
    assert.ok(r.body.includes(`<iframe src="${gw.inst(P + 20)}/view/artifact/hello?at=tree:${tree}"`), 'a cross-site visit: the wrapper, framing the published tree whatever the query says');
    r = await gw.req('HEAD', '/alpha/hello/', { on: 'public', headers: NAV });
    assert.deepEqual([r.status, r.body, r.headers.vary, r.headers['cache-control']], [200, '', 'cookie', 'public, max-age=60'], 'HEAD');
    r = await get('/alpha/hello/app.js');
    assert.deepEqual([r.body, r.headers.vary], ['x()', undefined], 'a file is never wrapped, and doesn\'t vary');
    assert.equal((await get('/alpha/nope/')).status, 404, 'nothing published there: still 404');
    // the instance decides whether threads can be had: a kit with viewers, at the bound checkout, now
    K.hello = { devteam: 1, name: 'alpha', root: '/srv/alpha', port: P + 20 };
    plain(await get('/alpha/hello/'), 'a kit without viewers');
    K.hello = { devteam: 1, name: 'alpha', root: '/srv/other', port: P + 20, viewer: 1 };
    plain(await get('/alpha/hello/'), 'another checkout on that port');
    K.hello = null;
    plain(await get('/alpha/hello/'), 'a hello cut off');
    K.hello = 'slow';
    const t0 = Date.now();
    plain(await get('/alpha/hello/'), 'a hello that never comes');
    assert.ok(Date.now() - t0 < 2000, `a slow instance costs at most its deadline (${Date.now() - t0} ms)`);
    await K.close();
    plain(await get('/alpha/hello/'), 'nothing on the port');
    // a revalidation by the signed-in owner: still the plain path here, and it varies on the cookie
    r = await get('/alpha/hello/', { ...NAV, 'if-none-match': `"${crypto.createHash('sha256').update(page).digest('hex')}"` });
    assert.deepEqual([r.status, r.headers.vary], [304, 'cookie'], 'a 304 for the document varies on the cookie too');
    seedPublic(gw.dir, 'beta', 'x', { 'index.html': page }, { root: '/srv/alpha', port: 1 });
    plain(await get('/beta/x/'), 'a binding outside the block');
    // a state file that can't be read: the owner gets what anyone gets
    const kept = fs.readFileSync(state);
    fs.writeFileSync(state, '{');
    assert.deepEqual([(await get('/alpha/hello/')).status, (await get('/alpha/hello/', NAV, '')).status], [503, 503]);
    fs.writeFileSync(state, kept);
  } finally { await K.close().catch(() => {}); await gw.close(); }
});
```

In the existing test `public.<box>: anyone reads a published artifact` (line 910), replace the comment `// signed in or not, the same answer: the cookie is never read on this name, and none is set` with:

```js
    // signed in or not, without fetch metadata the same answer: the cookie only ever chooses the
    // owner's wrapper (a top-level visit), and none is set
```

- [ ] **Step 2: Run it.** `$NODE --test --test-name-pattern "own visit gets the viewer" test/gateway.test.mjs`. Expect a failure at `notEqual(r.body, page)`: today the plain bytes are served to everyone.
- [ ] **Step 3: Implement `vary: cookie`.** In `servePublic`, replace the comment above it (lines 1177-1179):

```js
  // A published artifact, from the gateway's own copy alone: reads only, the raw path matched
  // before any decoding, the gateway's own headers. Nothing here reads the cookie, sets one, or
  // talks to an instance, so taking a port, rewriting main or forging log lines changes nothing.
  // (The owner's wrapper, tried before this, reads the cookie to choose itself, and only that.)
```

And its `head` (line 1195): a page's index varies on the cookie, which is what can make it the wrapper.

```js
    const head = { etag: tag, 'cache-control': 'public, max-age=60', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': publicCsp(`${PUBLIC}/${m[1]}/${m[2]}/`), ...(rel === 'index.html' ? { vary: 'cookie' } : {}), ...hsts };
```

- [ ] **Step 4: Implement the choice.** After `publicMap` (it ends at line 1334), add:

```js
  // The owner's page on the public name (spec §8): the project's viewer at the published version,
  // with threads. Only for a top-level visit (sec-fetch-dest: document; navigate also matches frames)
  // to a published page's index, by the signed-in owner, whose bound instance answers now as that
  // checkout with a kit that has viewers. Anything in doubt is null: a session that isn't one, a
  // store that can't be read, no binding, an instance that is down, slow, another checkout or an
  // older kit. Then the public's bytes are served, as before. It reads the cookie, and nothing else
  // of the owner's: it never proxies, and the instance is asked as a loopback client.
  const WRAP_MS = opts.wrapperHelloMs ?? 1500;
  // The wrapper's own policy: styles and one frame, the bound instance's; no script, nothing to fetch.
  const WRAP_CSP = (inst) => `default-src 'none'; style-src 'unsafe-inline'; frame-src ${inst}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;
  const ownerWrapper = async (req, url) => {
    try {
      if (req.method !== 'GET' || req.headers['sec-fetch-dest'] !== 'document' || url.searchParams.has('plain')) return null;
      const m = /^\/([^/]+)\/([^/]+)\/(?:index\.html)?$/.exec(req.url.split('?')[0]);
      if (!m || !PROJECT.test(m[1]) || !LINK_ID.test(m[2])) return null;
      const s = store.load();
      if (!s.passkeys.length || !sessionOf(req)) return null;
      const bound = Object.hasOwn(s.public ?? {}, m[1]) ? s.public[m[1]] : null;
      const art = bound && Object.hasOwn(bound.artifacts ?? {}, m[2]) ? bound.artifacts[m[2]] : null;
      if (!art || !BLOCK.includes(bound.port) || typeof art.tree !== 'string' || !TREE.test(art.tree)) return null;
      const r = await loopback(bound.port, 'GET', '/api/hello', { cap: 256 * 1024, ms: WRAP_MS });
      if (r.status !== 200) return null;
      const hello = JSON.parse(r.body.toString('utf8'));
      if (hello?.viewer !== 1 || hello.root !== bound.root) return null;
      return { port: bound.port, html: PAGES.ownerWrapper({ project: m[1], slug: m[2], title: typeof art.title === 'string' && art.title ? art.title : m[2], frame: `${instanceOrigin(bound.port)}/view/artifact/${m[2]}?at=tree:${art.tree}` }) };
    } catch { return null; }
  };
```

Replace the `isPublic` branch (lines 1453-1456):

```js
    // Anyone's, so before every check that is about the owner (Origin, cookie, session). The one
    // exception reads the cookie to choose a page, never to refuse one: the owner's own visit gets
    // the wrapper, and whatever that can't settle gets the public's bytes, exactly as before.
    if (isPublic) {
      const wrap = await ownerWrapper(req, url);
      if (wrap) return send(res, 200, 'text/html; charset=utf-8', wrap.html, { 'content-security-policy': WRAP_CSP(instanceOrigin(wrap.port)), 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store, private', vary: 'cookie' });
      try { return servePublic(req, res); } catch (e) { return send(res, e?.unreadable ? 503 : 500, 'text/plain; charset=utf-8', 'this page can\'t be served just now'); }
    }
```

- [ ] **Step 5: The page.** In `PAGES`, after `publicList` (it ends at line 1941), add:

```js
  // The owner's view of a public page: the instance's viewer, framed full size under one line, and
  // no script of its own. The frame may not navigate this tab, nor open a window outside its
  // sandbox (an artifact viewer needs none); its sandbox keeps its origin.
  ownerWrapper: ({ project, slug, title, frame }) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#fafafa;--fg:#171717;--fg2:#666;--line:#e5e5e5}@media (prefers-color-scheme:dark){:root{--bg:#000;--fg:#ededed;--fg2:#a1a1a1;--line:#2e2e2e}}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px/1.4 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}body{display:flex;flex-direction:column}
header{padding:6px 12px;border-bottom:1px solid var(--line);color:var(--fg2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}a{color:var(--fg)}iframe{flex:1;border:0;width:100%}
</style></head><body><header>Public · ${esc(project)}/${esc(slug)} · <a href="?plain">Open it as the public sees it</a></header><iframe src="${esc(frame)}" title="${esc(title)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"></iframe></body></html>`,
```

- [ ] **Step 6: Run it, then the file.** Expect green, the existing public tests included: none of them sends `sec-fetch-dest: document` with a session.
- [ ] **Step 7: Commit.** `gateway: the owner's wrapper on the public name, the viewer at the published version, plain bytes on any doubt`

### Task 7: Docs: the gateway's header and the README

**Files:**
- Modify: `cloud/gateway.mjs` (the header comment, lines 1-18)
- Modify: `README.md` (cloud section: the gateway bullet at 171, Public artifacts at 172, Dev links at 173; two threat-model bullets after **Passkey prompts from an agent's page** at 175)

- [ ] **Step 1: The gateway's header.** After line 17 (`// picks between two claimants of one name, and box.example.com/dev/ lists them.`), add:

```js
// The kit's viewers (for threads) lean on it twice. A preview's name answers /.devteam/lens, the
// gateway's own page that frames the app, and the app's own framing headers give way for that one
// frame. On public.box.example.com, the signed-in owner's own visit to a published page gets a page
// of the gateway's framing that project's viewer at the published version; everyone else, and any
// doubt, gets the published bytes. The public name reads the cookie for that choice alone.
```

- [ ] **Step 2: The README's cloud section.** In the **The gateway** bullet (line 171), replace `with no sign-in and no cookie.` with:

```
with no sign-in; it sets no cookie there, and reads the owner's only to choose the owner's own view of a page (below).
```

At the end of the **Public artifacts** bullet (line 172), append:

```
Signed in, the owner opening a public link gets a page of the gateway's instead: the project's viewer, showing exactly the published version, so a thread can be started on it, under a one-line bar whose **Open it as the public sees it** shows the plain page. That needs the project's dashboard running on the box, with a kit that has viewers; otherwise, or whenever anything about it is in doubt, the owner sees the plain page too.
```

At the end of the **Dev links** bullet (line 173), append:

```
A preview's name also answers `/.devteam/lens`, a page of the gateway's own that frames the app for the dashboard's viewer, so a thread can point at an element in a running app; an app route at that path can't be reached through the link.
```

- [ ] **Step 3: The threat model.** After the **Passkey prompts from an agent's page** bullet (line 175), add two bullets:

```
- **A preview's framing headers give way once.** The gateway drops an app's `X-Frame-Options` and replaces its `frame-ancestors` for one kind of load only: the app framed from its own name, which is how its lens holds it. The lens can be framed only by the hub and the box's instance names, where an agent's page can also sit (on an unused port). Such a page could frame a lens and read what the lens reads: the dev app's text, HTML, routes and console errors, as the app shows them to you with your cookies for that app. Keep secrets out of dev apps on the box, as for anything an agent can reach. A top-level load and every other frame get the app's own headers, and another site's frame is still refused. The framed app can still open a window of its own from your click (an OAuth popup, a link), unsandboxed, as it could when opened plain. The lens shares the app's origin, so the app can rewrite it, or lie through it about what is on the page: what reaches the supervisor from there is a description of the page, given to it as data, and it can't start, write or answer a thread.
- **The public name reads the session cookie** to choose the owner's own view of a page, and for nothing else. It never forwards the cookie or sets one, that view is never cached (`no-store, private`), and the plain page says `Vary: Cookie`, so a cache in between can at worst hand the owner the plain page, and never hands that view to anyone else. An instance's viewer and published-version pages accept the public name as a frame ancestor, which is safe because that name serves only the gateway's own page and sandboxed artifacts with no origin of their own.
```

- [ ] **Step 4: Check.** Read both edits back for plain English and the repo's voice: no flags or ids beyond the paths the bullets already use. Run `$NODE --test test/gateway.test.mjs` (the header is a comment; nothing should change).
- [ ] **Step 5: Commit.** `docs: the preview lens, framing, and the owner's view of a public page, in the gateway and the README`

### Task 8: The browser script: the lens and the wrapper in Chrome

**Files:**
- Modify: `test/browser/dev-links.mjs` (the header at lines 1-5; imports at 8-14; `gatewayViewers` before `async function main()`; `viaGateway` at 277 takes `SP` and calls `gatewayViewers` at its end, after line 350; `main` at 437)

- [ ] **Step 1: The header and imports.** Replace the first five lines:

```js
#!/usr/bin/env node
// The dev links chain in a real browser: Chrome over the DevTools protocol against a real dashboard,
// a real Vite app, (between them) the thread layer, and (the second half) a real gateway on
// *.localhost, with its preview lens and the owner's view of a public page. Run by hand (needs Chrome
// and npm's network once; not in CI). Node 22+.
//   node test/browser/dev-links.mjs [--only threads]
```

Add the two imports, keeping the list sorted:

```js
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
```

- [ ] **Step 2: The steps.** Before `async function main()`, add:

```js
// ===== the gateway's half of viewers: the lens on a preview's name, the owner's view on the public
// name. The kit's own viewer comes in a later PR, so a stand-in instance plays it: its hello says
// viewer: 1, and its pages carry the kit's kinds of policy in its loopback origin, as the kit's do. =====
async function gatewayViewers({ G, HUB, SP, tab, app }) {
  const pub = `http://box.localhost:${G}`;
  const inst = `http://${SP}.box.localhost:${G}`;
  const self = `http://127.0.0.1:${SP}`;
  const T = 'e'.repeat(40);
  // an app that refuses every frame, as many do: only its lens's own load may hold it. Its console
  // error comes 1.5 s after load, so the lens has attached by then (its poll is 250 ms): don't shorten it.
  const appPage = (title) => `<!doctype html><title>${title}</title><body style="margin:0;height:3000px"><button id="buy">Buy now</button><div id="card" style="padding:24px"><span>one</span><span><b>deep</b> two</span></div><p id="long">${'é'.repeat(600)}</p><button id="forge" onclick="parent.postMessage({ lens: 1, type: 'go', route: '/second' }, '*')">forge</button><script>setTimeout(() => console.error('boom from the app'), 1500)</script></body>`;
  const appSrv = http.createServer((q, s) => {
    s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self' 'unsafe-inline'; frame-ancestors 'none'" });
    s.end(appPage(q.url.startsWith('/second') ? 'Second' : 'First'));
  });
  const appPort = await freePort();
  await new Promise((r) => appSrv.listen(appPort, '127.0.0.1', r));
  procs.push({ kill: () => appSrv.close() });
  const said = dt(['preview', String(appPort), '--label', 'framed'], { ...WORKER, DEVTEAM_PUBLIC_URL: pub, DEVTEAM_PREVIEWS: '1' }, app);
  const name = /preview (\S+) is live/.exec(said)?.[1];
  assert.ok(name, said);
  const lensUrl = `http://${name}.box.localhost:${G}/.devteam/lens`;
  // listed by the hub before the lens asks the gateway for the app
  await until(async () => (await (await fetch(`http://127.0.0.1:${HUB}/instances.json`)).json()).instances.some((x) => (x.previews ?? []).some((p) => p.name === name)), 'the hub to list the framed app');

  // the stand-in instance: a viewer page that frames what it's given and keeps what it hears in #got,
  // posting whatever the test puts in data-send. Its hello says devteam: 1, so the hub (the real
  // dashboard's) shows it as a tab of its own, "standin"; nothing here looks at the hub's tabs again.
  const viewerPage = (src, sandbox) => `<!doctype html><title>Stand-in viewer</title><iframe id="f" src="${src}" ${sandbox} style="width:800px;height:600px;border:0"></iframe><pre id="got"></pre><script>
const f = document.getElementById('f');
const got = document.getElementById('got');
addEventListener('message', (e) => { if (e.source === f.contentWindow) got.textContent += JSON.stringify({ origin: e.origin, data: e.data }) + '\\n'; });
new MutationObserver(() => { const m = document.body.dataset.send; if (!m) return; delete document.body.dataset.send; f.contentWindow.postMessage(JSON.parse(m), new URL(f.src, location.href).origin); }).observe(document.body, { attributes: true });
</script>`;
  const policy = (extra) => `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; ${extra}; frame-ancestors 'self' http://127.0.0.1:${HUB}`;
  const dir = `${self}/artifact/tree/${T}/mock/`;
  const artPolicy = `default-src 'none'; style-src 'unsafe-inline' ${dir}; frame-ancestors ${self} http://127.0.0.1:${HUB}; sandbox allow-scripts`;
  const kitSrv = http.createServer((q, s) => {
    const send = (type, csp, body) => { s.writeHead(200, { 'content-type': type, 'content-security-policy': csp }); s.end(body); };
    if (q.url === '/api/hello') return send('application/json', "default-src 'none'", JSON.stringify({ devteam: 1, name: 'standin', root: '/srv/standin', port: SP, viewer: 1, inbox: 0, previews: [] }));
    if (q.url.startsWith(`/view/preview/${name}`)) return send('text/html; charset=utf-8', policy(`frame-src http://${name}.box.localhost:${G}`), viewerPage(`${lensUrl}?route=%2F`, 'sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"'));
    if (q.url.startsWith('/view/artifact/mock')) return send('text/html; charset=utf-8', policy("frame-src 'self'"), viewerPage(`/artifact/tree/${T}/mock/index.html`, ''));
    if (q.url === `/artifact/tree/${T}/mock/index.html`) return send('text/html; charset=utf-8', artPolicy, '<!doctype html><link rel="stylesheet" href="s.css"><p id="art">the instance at the published tree</p>');
    if (q.url === `/artifact/tree/${T}/mock/s.css`) return send('text/css; charset=utf-8', artPolicy, '#art { color: rgb(1, 2, 3) }');
    s.writeHead(404);
    return s.end();
  });
  await new Promise((r) => kitSrv.listen(SP, '127.0.0.1', r));
  procs.push({ kill: () => kitSrv.close() });

  // --- the lens ---
  const viewer = `${inst}/view/preview/${name}`;
  await browser.navigate(tab, viewer);
  await browser.cdp.send('Page.bringToFront', {}, tab.sessionId).catch(() => {});
  const inApp = (expr) => browser.evalIn(lensUrl, `(() => { const d = document.getElementById('app').contentDocument; return ${expr}; })()`);
  await until(() => inApp(`d && d.getElementById('buy') && d.getElementById('buy').textContent`), 'the app inside the lens');
  stepOk('the lens on the preview\'s name frames an app that sends X-Frame-Options: DENY and frame-ancestors \'none\'');
  const tell = (m) => browser.evalIn(viewer, `document.body.dataset.send = ${JSON.stringify(JSON.stringify({ lens: 1, ...m }))}`);
  const heard = async () => (await browser.evalIn(viewer, 'document.getElementById(\'got\').textContent')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const hear = (pred, what) => until(async () => (await heard()).find((x) => pred(x.data)), what, 10000);
  await tell({ type: 'hello' });
  const ready = await hear((d) => d.type === 'ready' && d.route === '/', 'ready');
  assert.equal(ready.origin, `http://${name}.box.localhost:${G}`, 'from the preview\'s own origin');
  const centre = (id) => inApp(`(() => { const r = d.getElementById('${id}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tell({ type: 'hit', id: 'h1', ...(await centre('buy')) });
  const buy = (await hear((d) => d.type === 'hit-reply' && d.id === 'h1', 'the hit on the button')).data.anchor;
  assert.deepEqual([buy.selector, buy.tag, buy.role, buy.text, buy.name, buy.html], ['#buy', 'button', 'button', 'Buy now', 'Buy now', '<button id="buy">Buy now</button>']);
  assert.ok(buy.rect.w > 0 && buy.rect.h > 0 && Math.abs(buy.point.x - buy.rect.w / 2) <= 1, JSON.stringify(buy));
  const corner = await inApp(`(() => { const r = d.getElementById('card').getBoundingClientRect(); return { x: r.left + 4, y: r.top + 4 }; })()`);
  await tell({ type: 'hit', id: 'h2', ...corner });
  const card = (await hear((d) => d.type === 'hit-reply' && d.id === 'h2', 'the hit on the card')).data.anchor;
  assert.equal(card.html, '<div id="card" style="padding:24px"><span>\u2026</span><span>\u2026</span></div>', 'its children kept, their contents collapsed');
  await tell({ type: 'hit', id: 'h3', ...(await centre('long')) });
  const long = (await hear((d) => d.type === 'hit-reply' && d.id === 'h3', 'the hit on the long text')).data.anchor;
  assert.ok(long.text.length === 40 && Buffer.byteLength(long.name) <= 80 && Buffer.byteLength(long.html) <= 1024 && long.html.endsWith('\u2026'), JSON.stringify(long));
  await tell({ type: 'resolve', id: 'r1', anchors: [{ key: 'buy', anchor: buy }, { key: 'gone', anchor: { selector: '#gone', tag: 'p', text: 'nothing like it' } }] });
  const r1 = (await hear((d) => d.type === 'rects' && d.id === 'r1', 'rects')).data.rects;
  assert.deepEqual(r1.map((x) => [x.key, x.rect && x.rect.y]), [['buy', buy.rect.y], ['gone', null]]);
  stepOk('the lens names what is under a point (selector, role, text, the HTML with its children collapsed, within spec §5\'s caps) and finds it again');
  await tell({ type: 'scroll-by', dx: 0, dy: 300, x: 5, y: 5 });
  await hear((d) => d.type === 'rects' && d.id === undefined && d.rects[0].rect && d.rects[0].rect.y === buy.rect.y - 300, 'the rect to move with a scroll');
  stepOk('scroll-by scrolls the app, and the watched rect follows, unasked');
  // newPage turned on focus emulation, so a headless tab holds focus. If a Chrome still keeps the key
  // out of the frame, click the button first with a real mouse event (mouseAt at the iframe's offset
  // plus the button's centre) and dispatch Shift after that.
  await inApp(`(d.getElementById('buy').focus(), true)`);
  await browser.shift(tab, true);
  await hear((d) => d.type === 'key' && d.key === 'Shift' && d.shift === true, 'Shift, seen inside the app');
  await browser.shift(tab, false);
  await hear((d) => d.type === 'key' && d.key === 'Shift' && d.shift === false, 'Shift up');
  stepOk('Shift held with the app focused reaches the viewer as key {shift}');
  await hear((d) => d.type === 'errors' && d.errors.some((e) => e.includes('boom from the app')), 'the app\'s console error');
  stepOk('a console error in the app reaches the viewer');
  await inApp(`(d.getElementById('forge').click(), true)`);
  await sleep(800);
  assert.equal(await inApp('d.location.pathname'), '/', 'a message from the app is not the viewer\'s: the lens took it nowhere');
  await tell({ type: 'go', route: '/second' });
  await hear((d) => d.type === 'ready' && d.route === '/second' && d.title === 'Second', 'the app at /second');
  stepOk('go takes the app to its own path; the same message from the app itself moved nothing');

  // --- the owner's view of a public page: what the box serves for standin/mock, bound to the stand-in ---
  const gwDir = path.join(base, 'gateway');
  const copy = '<!doctype html><p id="art">the box\'s own copy</p>';
  const sha = crypto.createHash('sha256').update(copy).digest('hex');
  fs.mkdirSync(path.join(gwDir, 'public', 'blobs'), { recursive: true });
  fs.writeFileSync(path.join(gwDir, 'public', 'blobs', sha), copy);
  const sf = path.join(gwDir, 'state.json');
  const st = JSON.parse(fs.readFileSync(sf, 'utf8'));
  st.public = { ...(st.public ?? {}), standin: { root: '/srv/standin', port: SP, artifacts: { mock: { tree: T, title: 'Mock', at: new Date().toISOString(), files: { 'index.html': { sha256: sha, size: Buffer.byteLength(copy) } } } } } };
  fs.writeFileSync(sf, JSON.stringify(st, null, 2));
  const page = `http://public.box.localhost:${G}/standin/mock/`;
  await browser.navigate(tab, page);
  await until(() => browser.frameWhere(`${inst}/view/artifact/mock?at=tree:${T}`), 'the viewer in the owner\'s view');
  const shown = await until(() => browser.evalIn(`${inst}/c/`, `(() => { const p = document.getElementById('art'); return p && p.textContent + '|' + getComputedStyle(p).color; })()`), 'the artifact in the viewer in the owner\'s view');
  assert.equal(shown, 'the instance at the published tree|rgb(1, 2, 3)');
  assert.match(await browser.evalIn(page, 'document.querySelector(\'header\').textContent'), /Public · standin\/mock/);
  stepOk('signed in, the public link is the owner\'s view: the viewer at the published tree, the artifact under its capability, each frame allowed by every ancestor');
  await browser.click(page, page, 'header a');
  await until(() => (tab.url ?? '').endsWith('/standin/mock/?plain'), 'the plain link');
  assert.equal(await browser.evalIn(`${page}?plain`, 'document.getElementById(\'art\').textContent + \'|\' + document.querySelectorAll(\'iframe\').length'), 'the box\'s own copy|0');
  stepOk('"Open it as the public sees it" is the box\'s own copy, plain');
}
```

- [ ] **Step 3: Wire it in.** `viaGateway`'s signature (line 277) becomes `async function viaGateway({ DASH, HUB, app, G, SP })`. After its last line (`say(\`measure  no-store: …\`);`, line 350), add:

```js
  // the session from the sign-in above carries on into the gateway's half of viewers
  await gatewayViewers({ G, HUB, SP, tab, app });
```

In `main`, the gateway call (line 437) becomes:

```js
  if (!only) await viaGateway({ HUB, DASH, app, G: block + 30, SP: block + 20 });
```

`block + 20` is in the instance block (`DEVTEAM_PORT_BASE` is `block + 1`, 25 ports), so the gateway serves it as an instance. `portBlock(34)` already holds it free, and nothing else in the script uses it.

- [ ] **Step 4: Run it.** `$NODE test/browser/dev-links.mjs`. Expect every step to print `ok`, the six new ones included, and `all steps passed`.
  - If a step fails and the gateway's handling of it is the cause, fix it in `cloud/gateway.mjs` with a failing gateway test first.
  - If the lens is the cause, fix it in `PREVIEW_LENS`, and keep Task 4's tests green.
- [ ] **Step 5: Commit.** `test: the preview lens and the owner's view of a public page, in Chrome through the gateway`

### Task 9: The whole suite, the browser script, and the PR

**Files:** none changed unless something fails.

- [ ] **Step 1: The whole suite, as CI splits it.**

```
NODE=~/.asdf/installs/nodejs/24.21.0/bin/node
$NODE --test test/bounds.test.mjs && $NODE --test --test-concurrency=8 $(ls test/*.test.mjs | grep -v '/\(kit\|bounds\)\.test\.mjs$') && $NODE --test --test-concurrency=8 test/kit.test.mjs
```

Expect every file green. Nothing outside `cloud/gateway.mjs`, `test/gateway.test.mjs`, `test/browser/dev-links.mjs` and `README.md` changed, so a failure in the kit's files is the machine's load: run that file again on its own before suspecting the branch.

- [ ] **Step 2: The browser script.** `$NODE test/browser/dev-links.mjs`. Expect `all steps passed`, and keep its output for the PR body.
- [ ] **Step 3: Check the scope.** `git diff --stat origin/main...HEAD` lists only the four files above, this plan, and the spec (`docs/superpowers/specs/2026-11-10-supervisor-threads-design.md`: commit `27050ec`, gateway corrections from planning, and the §11 lens-ancestors line). `git grep -n "PREVIEW_LENS" -- docs/devteam` finds nothing (the kit's copy is PR 3's).
- [ ] **Step 4: Open the PR.** `git push -u origin threads-gateway`, then `gh pr create --base main --head threads-gateway --title "Threads, PR 2: the gateway (preview lens, framing, the owner's view of a public page)" --body-file <file>`. The body has these parts:
  - **What:** the lens at `/.devteam/lens` (`PREVIEW_LENS`, which PR 3 copies byte for byte), the one framing relaxation, `ARTIFACT` with `tree/`, `frame-ancestors` for `/view/` and `/artifact/tree/`, the owner's wrapper with its plain fallback, and `vary: cookie`.
  - **Dormant:** nothing changes for anyone until a kit says `viewer: 1` in its hello (PR 3). Until then the wrapper serves the plain bytes, and the lens is reachable but nothing frames it.
  - **The spec problems and decisions** from this plan, in short.
  - **Tests:** the gateway file's new tests, and the browser script's output pasted.
  - **Only a real box can verify:** the wildcard certificate for the lens on a preview name, an iPhone's Safari with the wrapper, and Render's proxy passing `sec-fetch-*` unchanged.
  - It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- [ ] **Step 5: Stop.** Watch CI to green and answer review. Don't merge or release: merging is another session's job.

---

## Self-review

- **Spec coverage.**
  - §12 and "Scope and sequence", item 2:
    - The lens on preview hosts after the session check, never proxied: Tasks 4 and 5.
    - The framing relaxation in `downstreamHeaders` for preview responses only: Task 3.
    - The lens's `frame-ancestors`: Tasks 3 and 5, with decision 1.
    - `ARTIFACT` with `tree/`: Task 1.
    - `frame-ancestors` for `/view/` and `/artifact/tree/` only: Task 2.
    - The owner wrapper: `sec-fetch-dest: document` with a session, its own CSP, `no-store, private`, the frame URL, the `?plain` bar, plain on every failure and without `viewer: 1`, `vary: cookie`, the cookie read only to choose: Task 6.
    - Nothing persisted and no new polling: Task 6 stores nothing and asks the bound instance once per owner visit.
  - §5's caps: Task 4 (held to the kit's `ANCHOR_CAPS` and `SUBJECT_CAPS`) and Task 8.
  - §6 and §7 messages: hit, hit-reply, resolve, rects, scroll-by, scroll-to, go, route, ready, key {shift} and errors. Task 4 (source and gate) and Task 8 (behaviour).
  - §7's hash-only CSP: Tasks 4 and 5.
  - The draft's source and origin checks: Task 4, with decision 6.
  - §8 every ancestor: Tasks 2 and 8.
  - §11 bullets for the lens, framing, the wrapper and the viewer's ancestors: Tasks 2, 3, 5, 6 and 7.
  - Testing, gateway list:
    - session and never proxied: Task 5;
    - `iframe` with `same-origin` only, and only for previews (an instance's page and a WebSocket's 101 keep their headers): Task 3;
    - `tree/` capability: Task 1;
    - public ancestor and nowhere else: Task 2;
    - wrapper vs plain for `?plain`, a frame load, a bad cookie, no `viewer: 1` and down, never cached, its own policy, the instance never asked without a session, a cross-site visit, a 304 that varies: Task 6;
    - `publicCsp`'s sandbox: Task 6;
    - the three-level chain in Chrome: Task 8 (stand-in, decision 17).
  - Docs: the README's cloud and threat-model bullets, and the gateway's header: Task 7.
- **Placeholders.** None: every task names its files with line anchors as of `dfc84a6`, gives its test and code in full, and its command. `<file>` in Task 9 is the PR body the implementer writes from the listed parts.
- **Names.**
  - Gateway, module level: `PREVIEW_LENS`, `lensPart`, `lensHash`, `previewLensCsp`, `FRAME_ANCESTORS`, `addFrameAncestor`, `replaceFrameAncestors`.
  - Gateway, in `createGateway`: `LENS_ANCESTORS`, `LENS_CSP`, `ARTIFACT`, `PUBLIC_FRAMED`, `publicFramed`, `proxy`'s `publicFrame`, `downstreamHeaders`'s `framedBySelf`, `WRAP_MS`, `WRAP_CSP`, `ownerWrapper`, `PAGES.ownerWrapper`, `opts.wrapperHelloMs`.
  - Tests: `fakeKit` (`K.hello`, `K.seen`, `K.up`, `K.close`), `lensRun`. Browser script: `gatewayViewers`.
  - The lens's own names: `CAPS`, `ORDERS`, `tell`, `appWindow`, `safeRoute`, `anchorOf`, `find`, `sendRects`, `attach`.
  - Each is defined in the task that first uses it and used with the same name after.
