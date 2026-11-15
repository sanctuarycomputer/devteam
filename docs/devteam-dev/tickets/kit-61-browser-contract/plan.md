# kit-61-browser-contract: plan

## TL;DR

- Two tasks: T1 the schema, its fixtures and the contract half of the test (done-whens 1 and 3); T2 the fixture site and the site half of the test (done-when 2).
- T1 is the contract stage: committed alone, then a `review-request` for the stage word before T2's build.
- The schema stays inside the kit checker's keyword subset; the test carries a checker for exactly that subset and asserts the schema uses nothing else.
- One masked-URL pattern (`x-masked-url`), copied into every field `x-masked-fields` lists (only `nav.url` is exempt, in `x-unmasked-fields`); the test proves every copy equal and runs it over accept/refuse cases.
- `test/fixtures/browser/check.mjs` is the subset checker every later test imports; the refusal is an HTML page carrying its JSON in `#devteam-refusal`.
- Fixtures are named `<shape>[-<variant>].json`; every one is validated, `bad/` ones must fail for their named reason.
- `test/lib/sites.mjs`: Node 18 built-ins, random loopback port, random password and code per start, runnable from a shell.
- Executed inline (executing-plans) with TDD; a task review per task by a fresh subagent; gates through `devteam.mjs gate`.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the `browser@1` contract (schema, fixtures, fixture site) and the test that holds them together.

**Architecture:** a JSON schema read by the kit's own subset checker, example JSON per shape, an in-process HTTP fixture site; one `node:test` file.

**Tech Stack:** Node built-ins only (`node:test`, `node:assert/strict`, `node:http`, `node:crypto`, `node:fs`), Node 18 to 24. ImageMagick `convert` once, by hand, to make the two frame JPEGs.

**Spec:** `docs/devteam-dev/tickets/kit-61-browser-contract/spec.md`.

## Global Constraints

- Touches only: `docs/devteam/schema/browser.schema.json`, `test/fixtures/browser/**`, `test/lib/sites.mjs`, `test/browser-contract.test.mjs` (plus this ticket folder).
- Schema keywords inside a shape: `type`, `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `items`, `properties`, `required`, `additionalProperties` (boolean only), and notes `description`, `title`. No `$ref`, `oneOf`, `anyOf`, `if`.
- Every shape object: `additionalProperties: false`; every property has a `description`.
- Every JSON shape has `browser` `{ "const": 1 }` required; view messages have `t` `{ "const": "<t>" }` required.
- Patterns are ECMAScript, compiled with `new RegExp(p)` (no `u` flag); `•••` is U+2022 ×3.
- Code style matches the kit's tests: ES modules, two-space indent, terse comments saying why.
- Gates: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test test/browser-contract.test.mjs` (and the full `rest` set before finishing).

## Review Focus

1. A consumer's real output carrying a field the fixtures don't (e.g. `status.notes`): `additionalProperties: false` refuses it; the fixtures must exercise every optional field once so a consumer sees each is allowed (T1: `status.json` carries every optional field).
2. A URL with a percent-encoded or IPv6 host (`https://[::1]:8443/`) or with no path: the mask must accept it (T1 mask cases).
3. A query key with no value (`?abc`), an empty query (`?`), a trailing slash: accepted only in masked form (T1 mask cases).
4. The site's `pending` cookie alone reaching `/account`: must read "Not signed in" (T2 test).
5. A wrong 2FA code, or a replayed `pending` after success: no `session` cookie (T2 test).

---

### Task 1: the schema, the fixtures, the contract test

**Files:**
- Create: `docs/devteam/schema/browser.schema.json`
- Create: `test/fixtures/browser/check.mjs`
- Create: `test/fixtures/browser/{status,status-stopped,snapshot,tabs,profiles,wait-done,wait-declined,wait-withdrawn,wait-timeout,state,resets,view-from-server,view-from-page}.json`, `test/fixtures/browser/{refusal,refusal-not-a-proxy-request}.html`, `test/fixtures/browser/snapshot.txt`
- Create: `test/fixtures/browser/bad/{status-browser-2,snapshot-no-framing,tabs-fragment,view-from-server-unknown-type,view-from-page-unknown-type,state-lock,tabs-userinfo,snapshot-query-value,resets-timeout}.json`, `test/fixtures/browser/bad/snapshot-text-no-framing.txt`
- Create: `test/browser-contract.test.mjs`

**Interfaces:**
- Produces: `S.$defs.shapes.{status,snapshot,tabs,profiles,wait,state,resets,refusal}`, `S.$defs.view.from_server.{frame,url,held,bye}`, `S.$defs.view.from_page.{mouse,wheel,key,paste,nav,back,forget}`, `S['x-masked-url']`, `S['x-masked-fields']`, `S['x-unmasked-fields']`, `S['x-snapshot-text']` (shapes exactly as the spec's tables). From `test/fixtures/browser/check.mjs`: `schema`, `check(schemaPart, value, where) -> string[]` (the subset, same messages as `schemaErrors`), `validate(shape, value) -> string[]`, `message(dir, m) -> string[]` (dispatch by `t`; `dir` is `from_server`|`from_page`; unknown `t` → `<where>.t "x" is not a message from_<dir>`), `refusalOf(html) -> object|null` (the parsed `#devteam-refusal` element). In the test only: `shapeOf(file) -> string` (`wait-done.json` → `wait`; `view-from-server.json` → stream; `refusal*.html` → `refusal`).

- [ ] **Step 1: Write the failing tests** in `test/browser-contract.test.mjs`:
  - `the schema uses only the keywords the kit's checker reads`: walk every shape and message def; each key ∈ the subset ∪ {description, title}; every property has a description; every object def has `additionalProperties: false`.
  - `every fixture validates against its shape`: read `test/fixtures/browser/*.json`; each maps to a shape or a stream; `check(...)` returns `[]`; streams check each item via `message`. Then: the set of wait fixtures' outcomes is exactly `done, declined, withdrawn, timeout`; `resets.json` has an entry with `reset: true` and one `{outcome: 'done', reset: false}`, and every entry has `reset === (outcome !== 'done')`; `state.json` has `daemon_pid` and `chrome_pid`; `refusal.html`'s element validates, its rule is a 403 rule, and the page's visible text (tags stripped, script removed) contains its `why`; each frame's JPEG SOF0/SOF2 width and height equal its `w`, `h`; every nested object def has `additionalProperties: false`; every `t` of each direction appears in its stream; `snapshot.txt`'s first line matches `x-snapshot-text`; no fixture file is left unread.
  - `each bad fixture fails for its named reason`: table `{ 'status-browser-2.json': /browser must be 1/, 'snapshot-no-framing.json': /framing is required/, 'tabs-fragment.json': /url .* does not match/, 'view-from-server-unknown-type.json': /is not a message from_server/, 'view-from-page-unknown-type.json': /is not a message from_page/, 'state-lock.json': /lock is not a field here/, 'tabs-userinfo.json': /does not match/, 'snapshot-query-value.json': /does not match/, 'resets-timeout.json': /outcome must be one of/ }`, and `snapshot-text-no-framing.txt` fails `x-snapshot-text`; every file in `bad/` is in the table.
  - `the mask pattern`: accepts `about:blank`, `https://shop.example`, `https://shop.example/`, `http://127.0.0.1:4321/account`, `https://[::1]:8443/x`, `https://a.example/oauth/callback?code=•••&state=•••`, `https://a.example/orders/•••/receipt`, `https://a.example/x?•••`, `https://a.example/x?`, `https://a.example/p/123/a`, a 19-character segment; refuses `…#frag`, `https://u:p@a.example/`, `?code=abc`, `/orders/1234`, `/a1b2c3d4`, a 20-character segment, `?flag`, `file:///etc/passwd`, `javascript:alert(1)`, a URL with a space. And every path in `x-masked-fields` resolves to a def whose `pattern === S['x-masked-url']`; every property named `url`, `href` or `reopened` in the schema is in `x-masked-fields` or `x-unmasked-fields`; `x-unmasked-fields` is exactly `['view.from_page.nav.url']`.
  - `the refusal names the guard's rules and ranges; state holds no lock`: concatenated descriptions of `shapes.refusal` (its own and its properties') contain each rule id and each spine range (`127.0.0.0/8`, `0.0.0.0/8`, `::/128`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15`, `224.0.0.0/4`, `fc00::/7`, `fe80::/10`, `64:ff9b::/96`, `::ffff:0:0/96`), `localhost`, `*.localhost`, `DEVTEAM_PUBLIC_URL`, `own network interfaces`; each spine range is in `range.enum`; `shapes.state` has `additionalProperties: false` and no property matching `/lock|hold|held/`.

- [ ] **Step 2: Run** `node --test test/browser-contract.test.mjs` — expected FAIL (no schema file).

- [ ] **Step 3: Write `check.mjs` and the schema** per the spec's tables (mouse `type` includes `click`, key `type` includes `press`; `x`/`y` maximum 8192; `ref` `^[A-Za-z0-9_-]{1,32}# kit-61-browser-contract: plan

## TL;DR

- Two tasks: T1 the schema, its fixtures and the contract half of the test (done-whens 1 and 3); T2 the fixture site and the site half of the test (done-when 2).
- T1 is the contract stage: committed alone, then a `review-request` for the stage word before T2's build.
- The schema stays inside the kit checker's keyword subset; the test carries a checker for exactly that subset and asserts the schema uses nothing else.
- One masked-URL pattern (`x-masked-url`), copied into every field `x-masked-fields` lists (only `nav.url` is exempt, in `x-unmasked-fields`); the test proves every copy equal and runs it over accept/refuse cases.
- `test/fixtures/browser/check.mjs` is the subset checker every later test imports; the refusal is an HTML page carrying its JSON in `#devteam-refusal`.
- Fixtures are named `<shape>[-<variant>].json`; every one is validated, `bad/` ones must fail for their named reason.
- `test/lib/sites.mjs`: Node 18 built-ins, random loopback port, random password and code per start, runnable from a shell.
- Executed inline (executing-plans) with TDD; a task review per task by a fresh subagent; gates through `devteam.mjs gate`.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the `browser@1` contract (schema, fixtures, fixture site) and the test that holds them together.

**Architecture:** a JSON schema read by the kit's own subset checker, example JSON per shape, an in-process HTTP fixture site; one `node:test` file.

**Tech Stack:** Node built-ins only (`node:test`, `node:assert/strict`, `node:http`, `node:crypto`, `node:fs`), Node 18 to 24. ImageMagick `convert` once, by hand, to make the two frame JPEGs.

**Spec:** `docs/devteam-dev/tickets/kit-61-browser-contract/spec.md`.

## Global Constraints

- Touches only: `docs/devteam/schema/browser.schema.json`, `test/fixtures/browser/**`, `test/lib/sites.mjs`, `test/browser-contract.test.mjs` (plus this ticket folder).
- Schema keywords inside a shape: `type`, `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `items`, `properties`, `required`, `additionalProperties` (boolean only), and notes `description`, `title`. No `$ref`, `oneOf`, `anyOf`, `if`.
- Every shape object: `additionalProperties: false`; every property has a `description`.
- Every JSON shape has `browser` `{ "const": 1 }` required; view messages have `t` `{ "const": "<t>" }` required.
- Patterns are ECMAScript, compiled with `new RegExp(p)` (no `u` flag); `•••` is U+2022 ×3.
- Code style matches the kit's tests: ES modules, two-space indent, terse comments saying why.
- Gates: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test test/browser-contract.test.mjs` (and the full `rest` set before finishing).

## Review Focus

1. A consumer's real output carrying a field the fixtures don't (e.g. `status.notes`): `additionalProperties: false` refuses it; the fixtures must exercise every optional field once so a consumer sees each is allowed (T1: `status.json` carries every optional field).
2. A URL with a percent-encoded or IPv6 host (`https://[::1]:8443/`) or with no path: the mask must accept it (T1 mask cases).
3. A query key with no value (`?abc`), an empty query (`?`), a trailing slash: accepted only in masked form (T1 mask cases).
4. The site's `pending` cookie alone reaching `/account`: must read "Not signed in" (T2 test).
5. A wrong 2FA code, or a replayed `pending` after success: no `session` cookie (T2 test).

---

### Task 1: the schema, the fixtures, the contract test

**Files:**
- Create: `docs/devteam/schema/browser.schema.json`
- Create: `test/fixtures/browser/check.mjs`
- Create: `test/fixtures/browser/{status,status-stopped,snapshot,tabs,profiles,wait-done,wait-declined,wait-withdrawn,wait-timeout,state,resets,view-from-server,view-from-page}.json`, `test/fixtures/browser/{refusal,refusal-not-a-proxy-request}.html`, `test/fixtures/browser/snapshot.txt`
- Create: `test/fixtures/browser/bad/{status-browser-2,snapshot-no-framing,tabs-fragment,view-from-server-unknown-type,view-from-page-unknown-type,state-lock,tabs-userinfo,snapshot-query-value,resets-timeout}.json`, `test/fixtures/browser/bad/snapshot-text-no-framing.txt`
- Create: `test/browser-contract.test.mjs`

**Interfaces:**
- Produces: `S.$defs.shapes.{status,snapshot,tabs,profiles,wait,state,resets,refusal}`, `S.$defs.view.from_server.{frame,url,held,bye}`, `S.$defs.view.from_page.{mouse,wheel,key,paste,nav,back,forget}`, `S['x-masked-url']`, `S['x-masked-fields']`, `S['x-unmasked-fields']`, `S['x-snapshot-text']` (shapes exactly as the spec's tables). From `test/fixtures/browser/check.mjs`: `schema`, `check(schemaPart, value, where) -> string[]` (the subset, same messages as `schemaErrors`), `validate(shape, value) -> string[]`, `message(dir, m) -> string[]` (dispatch by `t`; `dir` is `from_server`|`from_page`; unknown `t` → `<where>.t "x" is not a message from_<dir>`), `refusalOf(html) -> object|null` (the parsed `#devteam-refusal` element). In the test only: `shapeOf(file) -> string` (`wait-done.json` → `wait`; `view-from-server.json` → stream; `refusal*.html` → `refusal`).

- [ ] **Step 1: Write the failing tests** in `test/browser-contract.test.mjs`:
  - `the schema uses only the keywords the kit's checker reads`: walk every shape and message def; each key ∈ the subset ∪ {description, title}; every property has a description; every object def has `additionalProperties: false`.
  - `every fixture validates against its shape`: read `test/fixtures/browser/*.json`; each maps to a shape or a stream; `check(...)` returns `[]`; streams check each item via `message`. Then: the set of wait fixtures' outcomes is exactly `done, declined, withdrawn, timeout`; `resets.json` has an entry with `reset: true` and one `{outcome: 'done', reset: false}`, and every entry has `reset === (outcome !== 'done')`; `state.json` has `daemon_pid` and `chrome_pid`; `refusal.html`'s element validates, its rule is a 403 rule, and the page's visible text (tags stripped, script removed) contains its `why`; each frame's JPEG SOF0/SOF2 width and height equal its `w`, `h`; every nested object def has `additionalProperties: false`; every `t` of each direction appears in its stream; `snapshot.txt`'s first line matches `x-snapshot-text`; no fixture file is left unread.
  - `each bad fixture fails for its named reason`: table `{ 'status-browser-2.json': /browser must be 1/, 'snapshot-no-framing.json': /framing is required/, 'tabs-fragment.json': /url .* does not match/, 'view-from-server-unknown-type.json': /is not a message from_server/, 'view-from-page-unknown-type.json': /is not a message from_page/, 'state-lock.json': /lock is not a field here/, 'tabs-userinfo.json': /does not match/, 'snapshot-query-value.json': /does not match/, 'resets-timeout.json': /outcome must be one of/ }`, and `snapshot-text-no-framing.txt` fails `x-snapshot-text`; every file in `bad/` is in the table.
  - `the mask pattern`: accepts `about:blank`, `https://shop.example`, `https://shop.example/`, `http://127.0.0.1:4321/account`, `https://[::1]:8443/x`, `https://a.example/oauth/callback?code=•••&state=•••`, `https://a.example/orders/•••/receipt`, `https://a.example/x?•••`, `https://a.example/x?`, `https://a.example/p/123/a`, a 19-character segment; refuses `…#frag`, `https://u:p@a.example/`, `?code=abc`, `/orders/1234`, `/a1b2c3d4`, a 20-character segment, `?flag`, `file:///etc/passwd`, `javascript:alert(1)`, a URL with a space. And every path in `x-masked-fields` resolves to a def whose `pattern === S['x-masked-url']`; every property named `url`, `href` or `reopened` in the schema is in `x-masked-fields` or `x-unmasked-fields`; `x-unmasked-fields` is exactly `['view.from_page.nav.url']`.
  - `the refusal names the guard's rules and ranges; state holds no lock`: concatenated descriptions of `shapes.refusal` (its own and its properties') contain each rule id and each spine range (`127.0.0.0/8`, `0.0.0.0/8`, `::/128`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15`, `224.0.0.0/4`, `fc00::/7`, `fe80::/10`, `64:ff9b::/96`, `::ffff:0:0/96`), `localhost`, `*.localhost`, `DEVTEAM_PUBLIC_URL`, `own network interfaces`; each spine range is in `range.enum`; `shapes.state` has `additionalProperties: false` and no property matching `/lock|hold|held/`.

- [ ] **Step 2: Run** `node --test test/browser-contract.test.mjs` — expected FAIL (no schema file).

; `resets[].reopened` optional masked; rule order in `refusal`'s description) (field types, ranges and enums exactly as there; `control_secret` `^[0-9a-f]{64}$`; instance key `^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}$`; qid `^q-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*$`; `at` the log's `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`; frame `data` `^/9j/[A-Za-z0-9+/]*={0,2}$`). The masked-URL pattern (prototyped against the cases above):

```
^(?:about:blank|https?://[^/?#@\s]+(?:/(?:•••|(?=(?:[^/?#\s\d]*\d){0,3}[^/?#\s\d]*(?:[/?]|$))[^/?#\s]{0,19}(?=[/?]|$)))*(?:\?(?:(?:[^=&#\s•]+=•••|•••)(?:&(?:[^=&#\s•]+=•••|•••))*)?)?)$
```

- [ ] **Step 4: Write the fixtures.** Frames: `convert -size 160x100 xc:'#2b6cb0' -quality 40 a.jpg`, `convert -size 320x200 xc:'#c05621' -quality 40 b.jpg` (in the scratchpad), base64 into `view-from-server.json`. `status.json` carries every optional field; `state.json`'s `control_secret` is 64 zeros; `resets.json`'s `done` entry carries `reopened`.

- [ ] **Step 5: Run** the gate (Global Constraints) — expected PASS. Mutation check: drop `additionalProperties: false` from `state` in a scratch copy of the schema → `state-lock` test fails; drop the `#` from the mask's host class → `tabs-fragment`… (record in the task review).

- [ ] **Step 6: Commit** the schema, fixtures and test alone: `kit-61: browser@1 contract (schema, fixtures, contract test)`; push; `phase contract`; `send supervisor "kit-61 contract browser@1 at <sha>: …" --kind review-request`.

### Task 2: the fixture site

**Files:**
- Create: `test/lib/sites.mjs`
- Modify: `test/browser-contract.test.mjs` (a second `test(...)` block)

**Interfaces:**
- Produces: `export async function startSites({ port = 0 } = {}) -> { port, origin, username, password, code, posts(): {posts, paths}, events(): object[], sessions(): string[], close(): Promise<void> }`; `password` `^pw-[a-z2-7]{20}# kit-61-browser-contract: plan

## TL;DR

- Two tasks: T1 the schema, its fixtures and the contract half of the test (done-whens 1 and 3); T2 the fixture site and the site half of the test (done-when 2).
- T1 is the contract stage: committed alone, then a `review-request` for the stage word before T2's build.
- The schema stays inside the kit checker's keyword subset; the test carries a checker for exactly that subset and asserts the schema uses nothing else.
- One masked-URL pattern (`x-masked-url`), copied into every field `x-masked-fields` lists (only `nav.url` is exempt, in `x-unmasked-fields`); the test proves every copy equal and runs it over accept/refuse cases.
- `test/fixtures/browser/check.mjs` is the subset checker every later test imports; the refusal is an HTML page carrying its JSON in `#devteam-refusal`.
- Fixtures are named `<shape>[-<variant>].json`; every one is validated, `bad/` ones must fail for their named reason.
- `test/lib/sites.mjs`: Node 18 built-ins, random loopback port, random password and code per start, runnable from a shell.
- Executed inline (executing-plans) with TDD; a task review per task by a fresh subagent; gates through `devteam.mjs gate`.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the `browser@1` contract (schema, fixtures, fixture site) and the test that holds them together.

**Architecture:** a JSON schema read by the kit's own subset checker, example JSON per shape, an in-process HTTP fixture site; one `node:test` file.

**Tech Stack:** Node built-ins only (`node:test`, `node:assert/strict`, `node:http`, `node:crypto`, `node:fs`), Node 18 to 24. ImageMagick `convert` once, by hand, to make the two frame JPEGs.

**Spec:** `docs/devteam-dev/tickets/kit-61-browser-contract/spec.md`.

## Global Constraints

- Touches only: `docs/devteam/schema/browser.schema.json`, `test/fixtures/browser/**`, `test/lib/sites.mjs`, `test/browser-contract.test.mjs` (plus this ticket folder).
- Schema keywords inside a shape: `type`, `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `items`, `properties`, `required`, `additionalProperties` (boolean only), and notes `description`, `title`. No `$ref`, `oneOf`, `anyOf`, `if`.
- Every shape object: `additionalProperties: false`; every property has a `description`.
- Every JSON shape has `browser` `{ "const": 1 }` required; view messages have `t` `{ "const": "<t>" }` required.
- Patterns are ECMAScript, compiled with `new RegExp(p)` (no `u` flag); `•••` is U+2022 ×3.
- Code style matches the kit's tests: ES modules, two-space indent, terse comments saying why.
- Gates: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test test/browser-contract.test.mjs` (and the full `rest` set before finishing).

## Review Focus

1. A consumer's real output carrying a field the fixtures don't (e.g. `status.notes`): `additionalProperties: false` refuses it; the fixtures must exercise every optional field once so a consumer sees each is allowed (T1: `status.json` carries every optional field).
2. A URL with a percent-encoded or IPv6 host (`https://[::1]:8443/`) or with no path: the mask must accept it (T1 mask cases).
3. A query key with no value (`?abc`), an empty query (`?`), a trailing slash: accepted only in masked form (T1 mask cases).
4. The site's `pending` cookie alone reaching `/account`: must read "Not signed in" (T2 test).
5. A wrong 2FA code, or a replayed `pending` after success: no `session` cookie (T2 test).

---

### Task 1: the schema, the fixtures, the contract test

**Files:**
- Create: `docs/devteam/schema/browser.schema.json`
- Create: `test/fixtures/browser/check.mjs`
- Create: `test/fixtures/browser/{status,status-stopped,snapshot,tabs,profiles,wait-done,wait-declined,wait-withdrawn,wait-timeout,state,resets,view-from-server,view-from-page}.json`, `test/fixtures/browser/{refusal,refusal-not-a-proxy-request}.html`, `test/fixtures/browser/snapshot.txt`
- Create: `test/fixtures/browser/bad/{status-browser-2,snapshot-no-framing,tabs-fragment,view-from-server-unknown-type,view-from-page-unknown-type,state-lock,tabs-userinfo,snapshot-query-value,resets-timeout}.json`, `test/fixtures/browser/bad/snapshot-text-no-framing.txt`
- Create: `test/browser-contract.test.mjs`

**Interfaces:**
- Produces: `S.$defs.shapes.{status,snapshot,tabs,profiles,wait,state,resets,refusal}`, `S.$defs.view.from_server.{frame,url,held,bye}`, `S.$defs.view.from_page.{mouse,wheel,key,paste,nav,back,forget}`, `S['x-masked-url']`, `S['x-masked-fields']`, `S['x-unmasked-fields']`, `S['x-snapshot-text']` (shapes exactly as the spec's tables). From `test/fixtures/browser/check.mjs`: `schema`, `check(schemaPart, value, where) -> string[]` (the subset, same messages as `schemaErrors`), `validate(shape, value) -> string[]`, `message(dir, m) -> string[]` (dispatch by `t`; `dir` is `from_server`|`from_page`; unknown `t` → `<where>.t "x" is not a message from_<dir>`), `refusalOf(html) -> object|null` (the parsed `#devteam-refusal` element). In the test only: `shapeOf(file) -> string` (`wait-done.json` → `wait`; `view-from-server.json` → stream; `refusal*.html` → `refusal`).

- [ ] **Step 1: Write the failing tests** in `test/browser-contract.test.mjs`:
  - `the schema uses only the keywords the kit's checker reads`: walk every shape and message def; each key ∈ the subset ∪ {description, title}; every property has a description; every object def has `additionalProperties: false`.
  - `every fixture validates against its shape`: read `test/fixtures/browser/*.json`; each maps to a shape or a stream; `check(...)` returns `[]`; streams check each item via `message`. Then: the set of wait fixtures' outcomes is exactly `done, declined, withdrawn, timeout`; `resets.json` has an entry with `reset: true` and one `{outcome: 'done', reset: false}`, and every entry has `reset === (outcome !== 'done')`; `state.json` has `daemon_pid` and `chrome_pid`; `refusal.html`'s element validates, its rule is a 403 rule, and the page's visible text (tags stripped, script removed) contains its `why`; each frame's JPEG SOF0/SOF2 width and height equal its `w`, `h`; every nested object def has `additionalProperties: false`; every `t` of each direction appears in its stream; `snapshot.txt`'s first line matches `x-snapshot-text`; no fixture file is left unread.
  - `each bad fixture fails for its named reason`: table `{ 'status-browser-2.json': /browser must be 1/, 'snapshot-no-framing.json': /framing is required/, 'tabs-fragment.json': /url .* does not match/, 'view-from-server-unknown-type.json': /is not a message from_server/, 'view-from-page-unknown-type.json': /is not a message from_page/, 'state-lock.json': /lock is not a field here/, 'tabs-userinfo.json': /does not match/, 'snapshot-query-value.json': /does not match/, 'resets-timeout.json': /outcome must be one of/ }`, and `snapshot-text-no-framing.txt` fails `x-snapshot-text`; every file in `bad/` is in the table.
  - `the mask pattern`: accepts `about:blank`, `https://shop.example`, `https://shop.example/`, `http://127.0.0.1:4321/account`, `https://[::1]:8443/x`, `https://a.example/oauth/callback?code=•••&state=•••`, `https://a.example/orders/•••/receipt`, `https://a.example/x?•••`, `https://a.example/x?`, `https://a.example/p/123/a`, a 19-character segment; refuses `…#frag`, `https://u:p@a.example/`, `?code=abc`, `/orders/1234`, `/a1b2c3d4`, a 20-character segment, `?flag`, `file:///etc/passwd`, `javascript:alert(1)`, a URL with a space. And every path in `x-masked-fields` resolves to a def whose `pattern === S['x-masked-url']`; every property named `url`, `href` or `reopened` in the schema is in `x-masked-fields` or `x-unmasked-fields`; `x-unmasked-fields` is exactly `['view.from_page.nav.url']`.
  - `the refusal names the guard's rules and ranges; state holds no lock`: concatenated descriptions of `shapes.refusal` (its own and its properties') contain each rule id and each spine range (`127.0.0.0/8`, `0.0.0.0/8`, `::/128`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15`, `224.0.0.0/4`, `fc00::/7`, `fe80::/10`, `64:ff9b::/96`, `::ffff:0:0/96`), `localhost`, `*.localhost`, `DEVTEAM_PUBLIC_URL`, `own network interfaces`; each spine range is in `range.enum`; `shapes.state` has `additionalProperties: false` and no property matching `/lock|hold|held/`.

- [ ] **Step 2: Run** `node --test test/browser-contract.test.mjs` — expected FAIL (no schema file).

- [ ] **Step 3: Write `check.mjs` and the schema** per the spec's tables (mouse `type` includes `click`, key `type` includes `press`; `x`/`y` maximum 8192; `ref` `^[A-Za-z0-9_-]{1,32}# kit-61-browser-contract: plan

## TL;DR

- Two tasks: T1 the schema, its fixtures and the contract half of the test (done-whens 1 and 3); T2 the fixture site and the site half of the test (done-when 2).
- T1 is the contract stage: committed alone, then a `review-request` for the stage word before T2's build.
- The schema stays inside the kit checker's keyword subset; the test carries a checker for exactly that subset and asserts the schema uses nothing else.
- One masked-URL pattern (`x-masked-url`), copied into every field `x-masked-fields` lists (only `nav.url` is exempt, in `x-unmasked-fields`); the test proves every copy equal and runs it over accept/refuse cases.
- `test/fixtures/browser/check.mjs` is the subset checker every later test imports; the refusal is an HTML page carrying its JSON in `#devteam-refusal`.
- Fixtures are named `<shape>[-<variant>].json`; every one is validated, `bad/` ones must fail for their named reason.
- `test/lib/sites.mjs`: Node 18 built-ins, random loopback port, random password and code per start, runnable from a shell.
- Executed inline (executing-plans) with TDD; a task review per task by a fresh subagent; gates through `devteam.mjs gate`.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the `browser@1` contract (schema, fixtures, fixture site) and the test that holds them together.

**Architecture:** a JSON schema read by the kit's own subset checker, example JSON per shape, an in-process HTTP fixture site; one `node:test` file.

**Tech Stack:** Node built-ins only (`node:test`, `node:assert/strict`, `node:http`, `node:crypto`, `node:fs`), Node 18 to 24. ImageMagick `convert` once, by hand, to make the two frame JPEGs.

**Spec:** `docs/devteam-dev/tickets/kit-61-browser-contract/spec.md`.

## Global Constraints

- Touches only: `docs/devteam/schema/browser.schema.json`, `test/fixtures/browser/**`, `test/lib/sites.mjs`, `test/browser-contract.test.mjs` (plus this ticket folder).
- Schema keywords inside a shape: `type`, `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `items`, `properties`, `required`, `additionalProperties` (boolean only), and notes `description`, `title`. No `$ref`, `oneOf`, `anyOf`, `if`.
- Every shape object: `additionalProperties: false`; every property has a `description`.
- Every JSON shape has `browser` `{ "const": 1 }` required; view messages have `t` `{ "const": "<t>" }` required.
- Patterns are ECMAScript, compiled with `new RegExp(p)` (no `u` flag); `•••` is U+2022 ×3.
- Code style matches the kit's tests: ES modules, two-space indent, terse comments saying why.
- Gates: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test test/browser-contract.test.mjs` (and the full `rest` set before finishing).

## Review Focus

1. A consumer's real output carrying a field the fixtures don't (e.g. `status.notes`): `additionalProperties: false` refuses it; the fixtures must exercise every optional field once so a consumer sees each is allowed (T1: `status.json` carries every optional field).
2. A URL with a percent-encoded or IPv6 host (`https://[::1]:8443/`) or with no path: the mask must accept it (T1 mask cases).
3. A query key with no value (`?abc`), an empty query (`?`), a trailing slash: accepted only in masked form (T1 mask cases).
4. The site's `pending` cookie alone reaching `/account`: must read "Not signed in" (T2 test).
5. A wrong 2FA code, or a replayed `pending` after success: no `session` cookie (T2 test).

---

### Task 1: the schema, the fixtures, the contract test

**Files:**
- Create: `docs/devteam/schema/browser.schema.json`
- Create: `test/fixtures/browser/check.mjs`
- Create: `test/fixtures/browser/{status,status-stopped,snapshot,tabs,profiles,wait-done,wait-declined,wait-withdrawn,wait-timeout,state,resets,view-from-server,view-from-page}.json`, `test/fixtures/browser/{refusal,refusal-not-a-proxy-request}.html`, `test/fixtures/browser/snapshot.txt`
- Create: `test/fixtures/browser/bad/{status-browser-2,snapshot-no-framing,tabs-fragment,view-from-server-unknown-type,view-from-page-unknown-type,state-lock,tabs-userinfo,snapshot-query-value,resets-timeout}.json`, `test/fixtures/browser/bad/snapshot-text-no-framing.txt`
- Create: `test/browser-contract.test.mjs`

**Interfaces:**
- Produces: `S.$defs.shapes.{status,snapshot,tabs,profiles,wait,state,resets,refusal}`, `S.$defs.view.from_server.{frame,url,held,bye}`, `S.$defs.view.from_page.{mouse,wheel,key,paste,nav,back,forget}`, `S['x-masked-url']`, `S['x-masked-fields']`, `S['x-unmasked-fields']`, `S['x-snapshot-text']` (shapes exactly as the spec's tables). From `test/fixtures/browser/check.mjs`: `schema`, `check(schemaPart, value, where) -> string[]` (the subset, same messages as `schemaErrors`), `validate(shape, value) -> string[]`, `message(dir, m) -> string[]` (dispatch by `t`; `dir` is `from_server`|`from_page`; unknown `t` → `<where>.t "x" is not a message from_<dir>`), `refusalOf(html) -> object|null` (the parsed `#devteam-refusal` element). In the test only: `shapeOf(file) -> string` (`wait-done.json` → `wait`; `view-from-server.json` → stream; `refusal*.html` → `refusal`).

- [ ] **Step 1: Write the failing tests** in `test/browser-contract.test.mjs`:
  - `the schema uses only the keywords the kit's checker reads`: walk every shape and message def; each key ∈ the subset ∪ {description, title}; every property has a description; every object def has `additionalProperties: false`.
  - `every fixture validates against its shape`: read `test/fixtures/browser/*.json`; each maps to a shape or a stream; `check(...)` returns `[]`; streams check each item via `message`. Then: the set of wait fixtures' outcomes is exactly `done, declined, withdrawn, timeout`; `resets.json` has an entry with `reset: true` and one `{outcome: 'done', reset: false}`, and every entry has `reset === (outcome !== 'done')`; `state.json` has `daemon_pid` and `chrome_pid`; `refusal.html`'s element validates, its rule is a 403 rule, and the page's visible text (tags stripped, script removed) contains its `why`; each frame's JPEG SOF0/SOF2 width and height equal its `w`, `h`; every nested object def has `additionalProperties: false`; every `t` of each direction appears in its stream; `snapshot.txt`'s first line matches `x-snapshot-text`; no fixture file is left unread.
  - `each bad fixture fails for its named reason`: table `{ 'status-browser-2.json': /browser must be 1/, 'snapshot-no-framing.json': /framing is required/, 'tabs-fragment.json': /url .* does not match/, 'view-from-server-unknown-type.json': /is not a message from_server/, 'view-from-page-unknown-type.json': /is not a message from_page/, 'state-lock.json': /lock is not a field here/, 'tabs-userinfo.json': /does not match/, 'snapshot-query-value.json': /does not match/, 'resets-timeout.json': /outcome must be one of/ }`, and `snapshot-text-no-framing.txt` fails `x-snapshot-text`; every file in `bad/` is in the table.
  - `the mask pattern`: accepts `about:blank`, `https://shop.example`, `https://shop.example/`, `http://127.0.0.1:4321/account`, `https://[::1]:8443/x`, `https://a.example/oauth/callback?code=•••&state=•••`, `https://a.example/orders/•••/receipt`, `https://a.example/x?•••`, `https://a.example/x?`, `https://a.example/p/123/a`, a 19-character segment; refuses `…#frag`, `https://u:p@a.example/`, `?code=abc`, `/orders/1234`, `/a1b2c3d4`, a 20-character segment, `?flag`, `file:///etc/passwd`, `javascript:alert(1)`, a URL with a space. And every path in `x-masked-fields` resolves to a def whose `pattern === S['x-masked-url']`; every property named `url`, `href` or `reopened` in the schema is in `x-masked-fields` or `x-unmasked-fields`; `x-unmasked-fields` is exactly `['view.from_page.nav.url']`.
  - `the refusal names the guard's rules and ranges; state holds no lock`: concatenated descriptions of `shapes.refusal` (its own and its properties') contain each rule id and each spine range (`127.0.0.0/8`, `0.0.0.0/8`, `::/128`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15`, `224.0.0.0/4`, `fc00::/7`, `fe80::/10`, `64:ff9b::/96`, `::ffff:0:0/96`), `localhost`, `*.localhost`, `DEVTEAM_PUBLIC_URL`, `own network interfaces`; each spine range is in `range.enum`; `shapes.state` has `additionalProperties: false` and no property matching `/lock|hold|held/`.

- [ ] **Step 2: Run** `node --test test/browser-contract.test.mjs` — expected FAIL (no schema file).

; `resets[].reopened` optional masked; rule order in `refusal`'s description) (field types, ranges and enums exactly as there; `control_secret` `^[0-9a-f]{64}$`; instance key `^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}$`; qid `^q-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*$`; `at` the log's `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`; frame `data` `^/9j/[A-Za-z0-9+/]*={0,2}$`). The masked-URL pattern (prototyped against the cases above):

```
^(?:about:blank|https?://[^/?#@\s]+(?:/(?:•••|(?=(?:[^/?#\s\d]*\d){0,3}[^/?#\s\d]*(?:[/?]|$))[^/?#\s]{0,19}(?=[/?]|$)))*(?:\?(?:(?:[^=&#\s•]+=•••|•••)(?:&(?:[^=&#\s•]+=•••|•••))*)?)?)$
```

- [ ] **Step 4: Write the fixtures.** Frames: `convert -size 160x100 xc:'#2b6cb0' -quality 40 a.jpg`, `convert -size 320x200 xc:'#c05621' -quality 40 b.jpg` (in the scratchpad), base64 into `view-from-server.json`. `status.json` carries every optional field; `state.json`'s `control_secret` is 64 zeros; `resets.json`'s `done` entry carries `reopened`.

- [ ] **Step 5: Run** the gate (Global Constraints) — expected PASS. Mutation check: drop `additionalProperties: false` from `state` in a scratch copy of the schema → `state-lock` test fails; drop the `#` from the mask's host class → `tabs-fragment`… (record in the task review).

- [ ] **Step 6: Commit** the schema, fixtures and test alone: `kit-61: browser@1 contract (schema, fixtures, contract test)`; push; `phase contract`; `send supervisor "kit-61 contract browser@1 at <sha>: …" --kind review-request`.

### Task 2: the fixture site

**Files:**
- Create: `test/lib/sites.mjs`
- Modify: `test/browser-contract.test.mjs` (a second `test(...)` block)

**Interfaces:**
, `code` `^[A-Z][A-Z2-9]{9}# kit-61-browser-contract: plan

## TL;DR

- Two tasks: T1 the schema, its fixtures and the contract half of the test (done-whens 1 and 3); T2 the fixture site and the site half of the test (done-when 2).
- T1 is the contract stage: committed alone, then a `review-request` for the stage word before T2's build.
- The schema stays inside the kit checker's keyword subset; the test carries a checker for exactly that subset and asserts the schema uses nothing else.
- One masked-URL pattern (`x-masked-url`), copied into every field `x-masked-fields` lists (only `nav.url` is exempt, in `x-unmasked-fields`); the test proves every copy equal and runs it over accept/refuse cases.
- `test/fixtures/browser/check.mjs` is the subset checker every later test imports; the refusal is an HTML page carrying its JSON in `#devteam-refusal`.
- Fixtures are named `<shape>[-<variant>].json`; every one is validated, `bad/` ones must fail for their named reason.
- `test/lib/sites.mjs`: Node 18 built-ins, random loopback port, random password and code per start, runnable from a shell.
- Executed inline (executing-plans) with TDD; a task review per task by a fresh subagent; gates through `devteam.mjs gate`.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the `browser@1` contract (schema, fixtures, fixture site) and the test that holds them together.

**Architecture:** a JSON schema read by the kit's own subset checker, example JSON per shape, an in-process HTTP fixture site; one `node:test` file.

**Tech Stack:** Node built-ins only (`node:test`, `node:assert/strict`, `node:http`, `node:crypto`, `node:fs`), Node 18 to 24. ImageMagick `convert` once, by hand, to make the two frame JPEGs.

**Spec:** `docs/devteam-dev/tickets/kit-61-browser-contract/spec.md`.

## Global Constraints

- Touches only: `docs/devteam/schema/browser.schema.json`, `test/fixtures/browser/**`, `test/lib/sites.mjs`, `test/browser-contract.test.mjs` (plus this ticket folder).
- Schema keywords inside a shape: `type`, `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `items`, `properties`, `required`, `additionalProperties` (boolean only), and notes `description`, `title`. No `$ref`, `oneOf`, `anyOf`, `if`.
- Every shape object: `additionalProperties: false`; every property has a `description`.
- Every JSON shape has `browser` `{ "const": 1 }` required; view messages have `t` `{ "const": "<t>" }` required.
- Patterns are ECMAScript, compiled with `new RegExp(p)` (no `u` flag); `•••` is U+2022 ×3.
- Code style matches the kit's tests: ES modules, two-space indent, terse comments saying why.
- Gates: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test test/browser-contract.test.mjs` (and the full `rest` set before finishing).

## Review Focus

1. A consumer's real output carrying a field the fixtures don't (e.g. `status.notes`): `additionalProperties: false` refuses it; the fixtures must exercise every optional field once so a consumer sees each is allowed (T1: `status.json` carries every optional field).
2. A URL with a percent-encoded or IPv6 host (`https://[::1]:8443/`) or with no path: the mask must accept it (T1 mask cases).
3. A query key with no value (`?abc`), an empty query (`?`), a trailing slash: accepted only in masked form (T1 mask cases).
4. The site's `pending` cookie alone reaching `/account`: must read "Not signed in" (T2 test).
5. A wrong 2FA code, or a replayed `pending` after success: no `session` cookie (T2 test).

---

### Task 1: the schema, the fixtures, the contract test

**Files:**
- Create: `docs/devteam/schema/browser.schema.json`
- Create: `test/fixtures/browser/check.mjs`
- Create: `test/fixtures/browser/{status,status-stopped,snapshot,tabs,profiles,wait-done,wait-declined,wait-withdrawn,wait-timeout,state,resets,view-from-server,view-from-page}.json`, `test/fixtures/browser/{refusal,refusal-not-a-proxy-request}.html`, `test/fixtures/browser/snapshot.txt`
- Create: `test/fixtures/browser/bad/{status-browser-2,snapshot-no-framing,tabs-fragment,view-from-server-unknown-type,view-from-page-unknown-type,state-lock,tabs-userinfo,snapshot-query-value,resets-timeout}.json`, `test/fixtures/browser/bad/snapshot-text-no-framing.txt`
- Create: `test/browser-contract.test.mjs`

**Interfaces:**
- Produces: `S.$defs.shapes.{status,snapshot,tabs,profiles,wait,state,resets,refusal}`, `S.$defs.view.from_server.{frame,url,held,bye}`, `S.$defs.view.from_page.{mouse,wheel,key,paste,nav,back,forget}`, `S['x-masked-url']`, `S['x-masked-fields']`, `S['x-unmasked-fields']`, `S['x-snapshot-text']` (shapes exactly as the spec's tables). From `test/fixtures/browser/check.mjs`: `schema`, `check(schemaPart, value, where) -> string[]` (the subset, same messages as `schemaErrors`), `validate(shape, value) -> string[]`, `message(dir, m) -> string[]` (dispatch by `t`; `dir` is `from_server`|`from_page`; unknown `t` → `<where>.t "x" is not a message from_<dir>`), `refusalOf(html) -> object|null` (the parsed `#devteam-refusal` element). In the test only: `shapeOf(file) -> string` (`wait-done.json` → `wait`; `view-from-server.json` → stream; `refusal*.html` → `refusal`).

- [ ] **Step 1: Write the failing tests** in `test/browser-contract.test.mjs`:
  - `the schema uses only the keywords the kit's checker reads`: walk every shape and message def; each key ∈ the subset ∪ {description, title}; every property has a description; every object def has `additionalProperties: false`.
  - `every fixture validates against its shape`: read `test/fixtures/browser/*.json`; each maps to a shape or a stream; `check(...)` returns `[]`; streams check each item via `message`. Then: the set of wait fixtures' outcomes is exactly `done, declined, withdrawn, timeout`; `resets.json` has an entry with `reset: true` and one `{outcome: 'done', reset: false}`, and every entry has `reset === (outcome !== 'done')`; `state.json` has `daemon_pid` and `chrome_pid`; `refusal.html`'s element validates, its rule is a 403 rule, and the page's visible text (tags stripped, script removed) contains its `why`; each frame's JPEG SOF0/SOF2 width and height equal its `w`, `h`; every nested object def has `additionalProperties: false`; every `t` of each direction appears in its stream; `snapshot.txt`'s first line matches `x-snapshot-text`; no fixture file is left unread.
  - `each bad fixture fails for its named reason`: table `{ 'status-browser-2.json': /browser must be 1/, 'snapshot-no-framing.json': /framing is required/, 'tabs-fragment.json': /url .* does not match/, 'view-from-server-unknown-type.json': /is not a message from_server/, 'view-from-page-unknown-type.json': /is not a message from_page/, 'state-lock.json': /lock is not a field here/, 'tabs-userinfo.json': /does not match/, 'snapshot-query-value.json': /does not match/, 'resets-timeout.json': /outcome must be one of/ }`, and `snapshot-text-no-framing.txt` fails `x-snapshot-text`; every file in `bad/` is in the table.
  - `the mask pattern`: accepts `about:blank`, `https://shop.example`, `https://shop.example/`, `http://127.0.0.1:4321/account`, `https://[::1]:8443/x`, `https://a.example/oauth/callback?code=•••&state=•••`, `https://a.example/orders/•••/receipt`, `https://a.example/x?•••`, `https://a.example/x?`, `https://a.example/p/123/a`, a 19-character segment; refuses `…#frag`, `https://u:p@a.example/`, `?code=abc`, `/orders/1234`, `/a1b2c3d4`, a 20-character segment, `?flag`, `file:///etc/passwd`, `javascript:alert(1)`, a URL with a space. And every path in `x-masked-fields` resolves to a def whose `pattern === S['x-masked-url']`; every property named `url`, `href` or `reopened` in the schema is in `x-masked-fields` or `x-unmasked-fields`; `x-unmasked-fields` is exactly `['view.from_page.nav.url']`.
  - `the refusal names the guard's rules and ranges; state holds no lock`: concatenated descriptions of `shapes.refusal` (its own and its properties') contain each rule id and each spine range (`127.0.0.0/8`, `0.0.0.0/8`, `::/128`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15`, `224.0.0.0/4`, `fc00::/7`, `fe80::/10`, `64:ff9b::/96`, `::ffff:0:0/96`), `localhost`, `*.localhost`, `DEVTEAM_PUBLIC_URL`, `own network interfaces`; each spine range is in `range.enum`; `shapes.state` has `additionalProperties: false` and no property matching `/lock|hold|held/`.

- [ ] **Step 2: Run** `node --test test/browser-contract.test.mjs` — expected FAIL (no schema file).

- [ ] **Step 3: Write `check.mjs` and the schema** per the spec's tables (mouse `type` includes `click`, key `type` includes `press`; `x`/`y` maximum 8192; `ref` `^[A-Za-z0-9_-]{1,32}# kit-61-browser-contract: plan

## TL;DR

- Two tasks: T1 the schema, its fixtures and the contract half of the test (done-whens 1 and 3); T2 the fixture site and the site half of the test (done-when 2).
- T1 is the contract stage: committed alone, then a `review-request` for the stage word before T2's build.
- The schema stays inside the kit checker's keyword subset; the test carries a checker for exactly that subset and asserts the schema uses nothing else.
- One masked-URL pattern (`x-masked-url`), copied into every field `x-masked-fields` lists (only `nav.url` is exempt, in `x-unmasked-fields`); the test proves every copy equal and runs it over accept/refuse cases.
- `test/fixtures/browser/check.mjs` is the subset checker every later test imports; the refusal is an HTML page carrying its JSON in `#devteam-refusal`.
- Fixtures are named `<shape>[-<variant>].json`; every one is validated, `bad/` ones must fail for their named reason.
- `test/lib/sites.mjs`: Node 18 built-ins, random loopback port, random password and code per start, runnable from a shell.
- Executed inline (executing-plans) with TDD; a task review per task by a fresh subagent; gates through `devteam.mjs gate`.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the `browser@1` contract (schema, fixtures, fixture site) and the test that holds them together.

**Architecture:** a JSON schema read by the kit's own subset checker, example JSON per shape, an in-process HTTP fixture site; one `node:test` file.

**Tech Stack:** Node built-ins only (`node:test`, `node:assert/strict`, `node:http`, `node:crypto`, `node:fs`), Node 18 to 24. ImageMagick `convert` once, by hand, to make the two frame JPEGs.

**Spec:** `docs/devteam-dev/tickets/kit-61-browser-contract/spec.md`.

## Global Constraints

- Touches only: `docs/devteam/schema/browser.schema.json`, `test/fixtures/browser/**`, `test/lib/sites.mjs`, `test/browser-contract.test.mjs` (plus this ticket folder).
- Schema keywords inside a shape: `type`, `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `items`, `properties`, `required`, `additionalProperties` (boolean only), and notes `description`, `title`. No `$ref`, `oneOf`, `anyOf`, `if`.
- Every shape object: `additionalProperties: false`; every property has a `description`.
- Every JSON shape has `browser` `{ "const": 1 }` required; view messages have `t` `{ "const": "<t>" }` required.
- Patterns are ECMAScript, compiled with `new RegExp(p)` (no `u` flag); `•••` is U+2022 ×3.
- Code style matches the kit's tests: ES modules, two-space indent, terse comments saying why.
- Gates: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test test/browser-contract.test.mjs` (and the full `rest` set before finishing).

## Review Focus

1. A consumer's real output carrying a field the fixtures don't (e.g. `status.notes`): `additionalProperties: false` refuses it; the fixtures must exercise every optional field once so a consumer sees each is allowed (T1: `status.json` carries every optional field).
2. A URL with a percent-encoded or IPv6 host (`https://[::1]:8443/`) or with no path: the mask must accept it (T1 mask cases).
3. A query key with no value (`?abc`), an empty query (`?`), a trailing slash: accepted only in masked form (T1 mask cases).
4. The site's `pending` cookie alone reaching `/account`: must read "Not signed in" (T2 test).
5. A wrong 2FA code, or a replayed `pending` after success: no `session` cookie (T2 test).

---

### Task 1: the schema, the fixtures, the contract test

**Files:**
- Create: `docs/devteam/schema/browser.schema.json`
- Create: `test/fixtures/browser/check.mjs`
- Create: `test/fixtures/browser/{status,status-stopped,snapshot,tabs,profiles,wait-done,wait-declined,wait-withdrawn,wait-timeout,state,resets,view-from-server,view-from-page}.json`, `test/fixtures/browser/{refusal,refusal-not-a-proxy-request}.html`, `test/fixtures/browser/snapshot.txt`
- Create: `test/fixtures/browser/bad/{status-browser-2,snapshot-no-framing,tabs-fragment,view-from-server-unknown-type,view-from-page-unknown-type,state-lock,tabs-userinfo,snapshot-query-value,resets-timeout}.json`, `test/fixtures/browser/bad/snapshot-text-no-framing.txt`
- Create: `test/browser-contract.test.mjs`

**Interfaces:**
- Produces: `S.$defs.shapes.{status,snapshot,tabs,profiles,wait,state,resets,refusal}`, `S.$defs.view.from_server.{frame,url,held,bye}`, `S.$defs.view.from_page.{mouse,wheel,key,paste,nav,back,forget}`, `S['x-masked-url']`, `S['x-masked-fields']`, `S['x-unmasked-fields']`, `S['x-snapshot-text']` (shapes exactly as the spec's tables). From `test/fixtures/browser/check.mjs`: `schema`, `check(schemaPart, value, where) -> string[]` (the subset, same messages as `schemaErrors`), `validate(shape, value) -> string[]`, `message(dir, m) -> string[]` (dispatch by `t`; `dir` is `from_server`|`from_page`; unknown `t` → `<where>.t "x" is not a message from_<dir>`), `refusalOf(html) -> object|null` (the parsed `#devteam-refusal` element). In the test only: `shapeOf(file) -> string` (`wait-done.json` → `wait`; `view-from-server.json` → stream; `refusal*.html` → `refusal`).

- [ ] **Step 1: Write the failing tests** in `test/browser-contract.test.mjs`:
  - `the schema uses only the keywords the kit's checker reads`: walk every shape and message def; each key ∈ the subset ∪ {description, title}; every property has a description; every object def has `additionalProperties: false`.
  - `every fixture validates against its shape`: read `test/fixtures/browser/*.json`; each maps to a shape or a stream; `check(...)` returns `[]`; streams check each item via `message`. Then: the set of wait fixtures' outcomes is exactly `done, declined, withdrawn, timeout`; `resets.json` has an entry with `reset: true` and one `{outcome: 'done', reset: false}`, and every entry has `reset === (outcome !== 'done')`; `state.json` has `daemon_pid` and `chrome_pid`; `refusal.html`'s element validates, its rule is a 403 rule, and the page's visible text (tags stripped, script removed) contains its `why`; each frame's JPEG SOF0/SOF2 width and height equal its `w`, `h`; every nested object def has `additionalProperties: false`; every `t` of each direction appears in its stream; `snapshot.txt`'s first line matches `x-snapshot-text`; no fixture file is left unread.
  - `each bad fixture fails for its named reason`: table `{ 'status-browser-2.json': /browser must be 1/, 'snapshot-no-framing.json': /framing is required/, 'tabs-fragment.json': /url .* does not match/, 'view-from-server-unknown-type.json': /is not a message from_server/, 'view-from-page-unknown-type.json': /is not a message from_page/, 'state-lock.json': /lock is not a field here/, 'tabs-userinfo.json': /does not match/, 'snapshot-query-value.json': /does not match/, 'resets-timeout.json': /outcome must be one of/ }`, and `snapshot-text-no-framing.txt` fails `x-snapshot-text`; every file in `bad/` is in the table.
  - `the mask pattern`: accepts `about:blank`, `https://shop.example`, `https://shop.example/`, `http://127.0.0.1:4321/account`, `https://[::1]:8443/x`, `https://a.example/oauth/callback?code=•••&state=•••`, `https://a.example/orders/•••/receipt`, `https://a.example/x?•••`, `https://a.example/x?`, `https://a.example/p/123/a`, a 19-character segment; refuses `…#frag`, `https://u:p@a.example/`, `?code=abc`, `/orders/1234`, `/a1b2c3d4`, a 20-character segment, `?flag`, `file:///etc/passwd`, `javascript:alert(1)`, a URL with a space. And every path in `x-masked-fields` resolves to a def whose `pattern === S['x-masked-url']`; every property named `url`, `href` or `reopened` in the schema is in `x-masked-fields` or `x-unmasked-fields`; `x-unmasked-fields` is exactly `['view.from_page.nav.url']`.
  - `the refusal names the guard's rules and ranges; state holds no lock`: concatenated descriptions of `shapes.refusal` (its own and its properties') contain each rule id and each spine range (`127.0.0.0/8`, `0.0.0.0/8`, `::/128`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15`, `224.0.0.0/4`, `fc00::/7`, `fe80::/10`, `64:ff9b::/96`, `::ffff:0:0/96`), `localhost`, `*.localhost`, `DEVTEAM_PUBLIC_URL`, `own network interfaces`; each spine range is in `range.enum`; `shapes.state` has `additionalProperties: false` and no property matching `/lock|hold|held/`.

- [ ] **Step 2: Run** `node --test test/browser-contract.test.mjs` — expected FAIL (no schema file).

; `resets[].reopened` optional masked; rule order in `refusal`'s description) (field types, ranges and enums exactly as there; `control_secret` `^[0-9a-f]{64}$`; instance key `^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}$`; qid `^q-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*$`; `at` the log's `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`; frame `data` `^/9j/[A-Za-z0-9+/]*={0,2}$`). The masked-URL pattern (prototyped against the cases above):

```
^(?:about:blank|https?://[^/?#@\s]+(?:/(?:•••|(?=(?:[^/?#\s\d]*\d){0,3}[^/?#\s\d]*(?:[/?]|$))[^/?#\s]{0,19}(?=[/?]|$)))*(?:\?(?:(?:[^=&#\s•]+=•••|•••)(?:&(?:[^=&#\s•]+=•••|•••))*)?)?)$
```

- [ ] **Step 4: Write the fixtures.** Frames: `convert -size 160x100 xc:'#2b6cb0' -quality 40 a.jpg`, `convert -size 320x200 xc:'#c05621' -quality 40 b.jpg` (in the scratchpad), base64 into `view-from-server.json`. `status.json` carries every optional field; `state.json`'s `control_secret` is 64 zeros; `resets.json`'s `done` entry carries `reopened`.

- [ ] **Step 5: Run** the gate (Global Constraints) — expected PASS. Mutation check: drop `additionalProperties: false` from `state` in a scratch copy of the schema → `state-lock` test fails; drop the `#` from the mask's host class → `tabs-fragment`… (record in the task review).

- [ ] **Step 6: Commit** the schema, fixtures and test alone: `kit-61: browser@1 contract (schema, fixtures, contract test)`; push; `phase contract`; `send supervisor "kit-61 contract browser@1 at <sha>: …" --kind review-request`.

### Task 2: the fixture site

**Files:**
- Create: `test/lib/sites.mjs`
- Modify: `test/browser-contract.test.mjs` (a second `test(...)` block)

**Interfaces:**
, session values `^s-[a-z2-7]{32}# kit-61-browser-contract: plan

## TL;DR

- Two tasks: T1 the schema, its fixtures and the contract half of the test (done-whens 1 and 3); T2 the fixture site and the site half of the test (done-when 2).
- T1 is the contract stage: committed alone, then a `review-request` for the stage word before T2's build.
- The schema stays inside the kit checker's keyword subset; the test carries a checker for exactly that subset and asserts the schema uses nothing else.
- One masked-URL pattern (`x-masked-url`), copied into every field `x-masked-fields` lists (only `nav.url` is exempt, in `x-unmasked-fields`); the test proves every copy equal and runs it over accept/refuse cases.
- `test/fixtures/browser/check.mjs` is the subset checker every later test imports; the refusal is an HTML page carrying its JSON in `#devteam-refusal`.
- Fixtures are named `<shape>[-<variant>].json`; every one is validated, `bad/` ones must fail for their named reason.
- `test/lib/sites.mjs`: Node 18 built-ins, random loopback port, random password and code per start, runnable from a shell.
- Executed inline (executing-plans) with TDD; a task review per task by a fresh subagent; gates through `devteam.mjs gate`.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the `browser@1` contract (schema, fixtures, fixture site) and the test that holds them together.

**Architecture:** a JSON schema read by the kit's own subset checker, example JSON per shape, an in-process HTTP fixture site; one `node:test` file.

**Tech Stack:** Node built-ins only (`node:test`, `node:assert/strict`, `node:http`, `node:crypto`, `node:fs`), Node 18 to 24. ImageMagick `convert` once, by hand, to make the two frame JPEGs.

**Spec:** `docs/devteam-dev/tickets/kit-61-browser-contract/spec.md`.

## Global Constraints

- Touches only: `docs/devteam/schema/browser.schema.json`, `test/fixtures/browser/**`, `test/lib/sites.mjs`, `test/browser-contract.test.mjs` (plus this ticket folder).
- Schema keywords inside a shape: `type`, `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `items`, `properties`, `required`, `additionalProperties` (boolean only), and notes `description`, `title`. No `$ref`, `oneOf`, `anyOf`, `if`.
- Every shape object: `additionalProperties: false`; every property has a `description`.
- Every JSON shape has `browser` `{ "const": 1 }` required; view messages have `t` `{ "const": "<t>" }` required.
- Patterns are ECMAScript, compiled with `new RegExp(p)` (no `u` flag); `•••` is U+2022 ×3.
- Code style matches the kit's tests: ES modules, two-space indent, terse comments saying why.
- Gates: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test test/browser-contract.test.mjs` (and the full `rest` set before finishing).

## Review Focus

1. A consumer's real output carrying a field the fixtures don't (e.g. `status.notes`): `additionalProperties: false` refuses it; the fixtures must exercise every optional field once so a consumer sees each is allowed (T1: `status.json` carries every optional field).
2. A URL with a percent-encoded or IPv6 host (`https://[::1]:8443/`) or with no path: the mask must accept it (T1 mask cases).
3. A query key with no value (`?abc`), an empty query (`?`), a trailing slash: accepted only in masked form (T1 mask cases).
4. The site's `pending` cookie alone reaching `/account`: must read "Not signed in" (T2 test).
5. A wrong 2FA code, or a replayed `pending` after success: no `session` cookie (T2 test).

---

### Task 1: the schema, the fixtures, the contract test

**Files:**
- Create: `docs/devteam/schema/browser.schema.json`
- Create: `test/fixtures/browser/check.mjs`
- Create: `test/fixtures/browser/{status,status-stopped,snapshot,tabs,profiles,wait-done,wait-declined,wait-withdrawn,wait-timeout,state,resets,view-from-server,view-from-page}.json`, `test/fixtures/browser/{refusal,refusal-not-a-proxy-request}.html`, `test/fixtures/browser/snapshot.txt`
- Create: `test/fixtures/browser/bad/{status-browser-2,snapshot-no-framing,tabs-fragment,view-from-server-unknown-type,view-from-page-unknown-type,state-lock,tabs-userinfo,snapshot-query-value,resets-timeout}.json`, `test/fixtures/browser/bad/snapshot-text-no-framing.txt`
- Create: `test/browser-contract.test.mjs`

**Interfaces:**
- Produces: `S.$defs.shapes.{status,snapshot,tabs,profiles,wait,state,resets,refusal}`, `S.$defs.view.from_server.{frame,url,held,bye}`, `S.$defs.view.from_page.{mouse,wheel,key,paste,nav,back,forget}`, `S['x-masked-url']`, `S['x-masked-fields']`, `S['x-unmasked-fields']`, `S['x-snapshot-text']` (shapes exactly as the spec's tables). From `test/fixtures/browser/check.mjs`: `schema`, `check(schemaPart, value, where) -> string[]` (the subset, same messages as `schemaErrors`), `validate(shape, value) -> string[]`, `message(dir, m) -> string[]` (dispatch by `t`; `dir` is `from_server`|`from_page`; unknown `t` → `<where>.t "x" is not a message from_<dir>`), `refusalOf(html) -> object|null` (the parsed `#devteam-refusal` element). In the test only: `shapeOf(file) -> string` (`wait-done.json` → `wait`; `view-from-server.json` → stream; `refusal*.html` → `refusal`).

- [ ] **Step 1: Write the failing tests** in `test/browser-contract.test.mjs`:
  - `the schema uses only the keywords the kit's checker reads`: walk every shape and message def; each key ∈ the subset ∪ {description, title}; every property has a description; every object def has `additionalProperties: false`.
  - `every fixture validates against its shape`: read `test/fixtures/browser/*.json`; each maps to a shape or a stream; `check(...)` returns `[]`; streams check each item via `message`. Then: the set of wait fixtures' outcomes is exactly `done, declined, withdrawn, timeout`; `resets.json` has an entry with `reset: true` and one `{outcome: 'done', reset: false}`, and every entry has `reset === (outcome !== 'done')`; `state.json` has `daemon_pid` and `chrome_pid`; `refusal.html`'s element validates, its rule is a 403 rule, and the page's visible text (tags stripped, script removed) contains its `why`; each frame's JPEG SOF0/SOF2 width and height equal its `w`, `h`; every nested object def has `additionalProperties: false`; every `t` of each direction appears in its stream; `snapshot.txt`'s first line matches `x-snapshot-text`; no fixture file is left unread.
  - `each bad fixture fails for its named reason`: table `{ 'status-browser-2.json': /browser must be 1/, 'snapshot-no-framing.json': /framing is required/, 'tabs-fragment.json': /url .* does not match/, 'view-from-server-unknown-type.json': /is not a message from_server/, 'view-from-page-unknown-type.json': /is not a message from_page/, 'state-lock.json': /lock is not a field here/, 'tabs-userinfo.json': /does not match/, 'snapshot-query-value.json': /does not match/, 'resets-timeout.json': /outcome must be one of/ }`, and `snapshot-text-no-framing.txt` fails `x-snapshot-text`; every file in `bad/` is in the table.
  - `the mask pattern`: accepts `about:blank`, `https://shop.example`, `https://shop.example/`, `http://127.0.0.1:4321/account`, `https://[::1]:8443/x`, `https://a.example/oauth/callback?code=•••&state=•••`, `https://a.example/orders/•••/receipt`, `https://a.example/x?•••`, `https://a.example/x?`, `https://a.example/p/123/a`, a 19-character segment; refuses `…#frag`, `https://u:p@a.example/`, `?code=abc`, `/orders/1234`, `/a1b2c3d4`, a 20-character segment, `?flag`, `file:///etc/passwd`, `javascript:alert(1)`, a URL with a space. And every path in `x-masked-fields` resolves to a def whose `pattern === S['x-masked-url']`; every property named `url`, `href` or `reopened` in the schema is in `x-masked-fields` or `x-unmasked-fields`; `x-unmasked-fields` is exactly `['view.from_page.nav.url']`.
  - `the refusal names the guard's rules and ranges; state holds no lock`: concatenated descriptions of `shapes.refusal` (its own and its properties') contain each rule id and each spine range (`127.0.0.0/8`, `0.0.0.0/8`, `::/128`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15`, `224.0.0.0/4`, `fc00::/7`, `fe80::/10`, `64:ff9b::/96`, `::ffff:0:0/96`), `localhost`, `*.localhost`, `DEVTEAM_PUBLIC_URL`, `own network interfaces`; each spine range is in `range.enum`; `shapes.state` has `additionalProperties: false` and no property matching `/lock|hold|held/`.

- [ ] **Step 2: Run** `node --test test/browser-contract.test.mjs` — expected FAIL (no schema file).

- [ ] **Step 3: Write `check.mjs` and the schema** per the spec's tables (mouse `type` includes `click`, key `type` includes `press`; `x`/`y` maximum 8192; `ref` `^[A-Za-z0-9_-]{1,32}# kit-61-browser-contract: plan

## TL;DR

- Two tasks: T1 the schema, its fixtures and the contract half of the test (done-whens 1 and 3); T2 the fixture site and the site half of the test (done-when 2).
- T1 is the contract stage: committed alone, then a `review-request` for the stage word before T2's build.
- The schema stays inside the kit checker's keyword subset; the test carries a checker for exactly that subset and asserts the schema uses nothing else.
- One masked-URL pattern (`x-masked-url`), copied into every field `x-masked-fields` lists (only `nav.url` is exempt, in `x-unmasked-fields`); the test proves every copy equal and runs it over accept/refuse cases.
- `test/fixtures/browser/check.mjs` is the subset checker every later test imports; the refusal is an HTML page carrying its JSON in `#devteam-refusal`.
- Fixtures are named `<shape>[-<variant>].json`; every one is validated, `bad/` ones must fail for their named reason.
- `test/lib/sites.mjs`: Node 18 built-ins, random loopback port, random password and code per start, runnable from a shell.
- Executed inline (executing-plans) with TDD; a task review per task by a fresh subagent; gates through `devteam.mjs gate`.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the `browser@1` contract (schema, fixtures, fixture site) and the test that holds them together.

**Architecture:** a JSON schema read by the kit's own subset checker, example JSON per shape, an in-process HTTP fixture site; one `node:test` file.

**Tech Stack:** Node built-ins only (`node:test`, `node:assert/strict`, `node:http`, `node:crypto`, `node:fs`), Node 18 to 24. ImageMagick `convert` once, by hand, to make the two frame JPEGs.

**Spec:** `docs/devteam-dev/tickets/kit-61-browser-contract/spec.md`.

## Global Constraints

- Touches only: `docs/devteam/schema/browser.schema.json`, `test/fixtures/browser/**`, `test/lib/sites.mjs`, `test/browser-contract.test.mjs` (plus this ticket folder).
- Schema keywords inside a shape: `type`, `enum`, `const`, `pattern`, `minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`, `items`, `properties`, `required`, `additionalProperties` (boolean only), and notes `description`, `title`. No `$ref`, `oneOf`, `anyOf`, `if`.
- Every shape object: `additionalProperties: false`; every property has a `description`.
- Every JSON shape has `browser` `{ "const": 1 }` required; view messages have `t` `{ "const": "<t>" }` required.
- Patterns are ECMAScript, compiled with `new RegExp(p)` (no `u` flag); `•••` is U+2022 ×3.
- Code style matches the kit's tests: ES modules, two-space indent, terse comments saying why.
- Gates: `node '/data/home/code/devteam-dev/docs/devteam/scripts/devteam.mjs' gate test -- node --test test/browser-contract.test.mjs` (and the full `rest` set before finishing).

## Review Focus

1. A consumer's real output carrying a field the fixtures don't (e.g. `status.notes`): `additionalProperties: false` refuses it; the fixtures must exercise every optional field once so a consumer sees each is allowed (T1: `status.json` carries every optional field).
2. A URL with a percent-encoded or IPv6 host (`https://[::1]:8443/`) or with no path: the mask must accept it (T1 mask cases).
3. A query key with no value (`?abc`), an empty query (`?`), a trailing slash: accepted only in masked form (T1 mask cases).
4. The site's `pending` cookie alone reaching `/account`: must read "Not signed in" (T2 test).
5. A wrong 2FA code, or a replayed `pending` after success: no `session` cookie (T2 test).

---

### Task 1: the schema, the fixtures, the contract test

**Files:**
- Create: `docs/devteam/schema/browser.schema.json`
- Create: `test/fixtures/browser/check.mjs`
- Create: `test/fixtures/browser/{status,status-stopped,snapshot,tabs,profiles,wait-done,wait-declined,wait-withdrawn,wait-timeout,state,resets,view-from-server,view-from-page}.json`, `test/fixtures/browser/{refusal,refusal-not-a-proxy-request}.html`, `test/fixtures/browser/snapshot.txt`
- Create: `test/fixtures/browser/bad/{status-browser-2,snapshot-no-framing,tabs-fragment,view-from-server-unknown-type,view-from-page-unknown-type,state-lock,tabs-userinfo,snapshot-query-value,resets-timeout}.json`, `test/fixtures/browser/bad/snapshot-text-no-framing.txt`
- Create: `test/browser-contract.test.mjs`

**Interfaces:**
- Produces: `S.$defs.shapes.{status,snapshot,tabs,profiles,wait,state,resets,refusal}`, `S.$defs.view.from_server.{frame,url,held,bye}`, `S.$defs.view.from_page.{mouse,wheel,key,paste,nav,back,forget}`, `S['x-masked-url']`, `S['x-masked-fields']`, `S['x-unmasked-fields']`, `S['x-snapshot-text']` (shapes exactly as the spec's tables). From `test/fixtures/browser/check.mjs`: `schema`, `check(schemaPart, value, where) -> string[]` (the subset, same messages as `schemaErrors`), `validate(shape, value) -> string[]`, `message(dir, m) -> string[]` (dispatch by `t`; `dir` is `from_server`|`from_page`; unknown `t` → `<where>.t "x" is not a message from_<dir>`), `refusalOf(html) -> object|null` (the parsed `#devteam-refusal` element). In the test only: `shapeOf(file) -> string` (`wait-done.json` → `wait`; `view-from-server.json` → stream; `refusal*.html` → `refusal`).

- [ ] **Step 1: Write the failing tests** in `test/browser-contract.test.mjs`:
  - `the schema uses only the keywords the kit's checker reads`: walk every shape and message def; each key ∈ the subset ∪ {description, title}; every property has a description; every object def has `additionalProperties: false`.
  - `every fixture validates against its shape`: read `test/fixtures/browser/*.json`; each maps to a shape or a stream; `check(...)` returns `[]`; streams check each item via `message`. Then: the set of wait fixtures' outcomes is exactly `done, declined, withdrawn, timeout`; `resets.json` has an entry with `reset: true` and one `{outcome: 'done', reset: false}`, and every entry has `reset === (outcome !== 'done')`; `state.json` has `daemon_pid` and `chrome_pid`; `refusal.html`'s element validates, its rule is a 403 rule, and the page's visible text (tags stripped, script removed) contains its `why`; each frame's JPEG SOF0/SOF2 width and height equal its `w`, `h`; every nested object def has `additionalProperties: false`; every `t` of each direction appears in its stream; `snapshot.txt`'s first line matches `x-snapshot-text`; no fixture file is left unread.
  - `each bad fixture fails for its named reason`: table `{ 'status-browser-2.json': /browser must be 1/, 'snapshot-no-framing.json': /framing is required/, 'tabs-fragment.json': /url .* does not match/, 'view-from-server-unknown-type.json': /is not a message from_server/, 'view-from-page-unknown-type.json': /is not a message from_page/, 'state-lock.json': /lock is not a field here/, 'tabs-userinfo.json': /does not match/, 'snapshot-query-value.json': /does not match/, 'resets-timeout.json': /outcome must be one of/ }`, and `snapshot-text-no-framing.txt` fails `x-snapshot-text`; every file in `bad/` is in the table.
  - `the mask pattern`: accepts `about:blank`, `https://shop.example`, `https://shop.example/`, `http://127.0.0.1:4321/account`, `https://[::1]:8443/x`, `https://a.example/oauth/callback?code=•••&state=•••`, `https://a.example/orders/•••/receipt`, `https://a.example/x?•••`, `https://a.example/x?`, `https://a.example/p/123/a`, a 19-character segment; refuses `…#frag`, `https://u:p@a.example/`, `?code=abc`, `/orders/1234`, `/a1b2c3d4`, a 20-character segment, `?flag`, `file:///etc/passwd`, `javascript:alert(1)`, a URL with a space. And every path in `x-masked-fields` resolves to a def whose `pattern === S['x-masked-url']`; every property named `url`, `href` or `reopened` in the schema is in `x-masked-fields` or `x-unmasked-fields`; `x-unmasked-fields` is exactly `['view.from_page.nav.url']`.
  - `the refusal names the guard's rules and ranges; state holds no lock`: concatenated descriptions of `shapes.refusal` (its own and its properties') contain each rule id and each spine range (`127.0.0.0/8`, `0.0.0.0/8`, `::/128`, `::1/128`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10`, `192.0.0.0/24`, `198.18.0.0/15`, `224.0.0.0/4`, `fc00::/7`, `fe80::/10`, `64:ff9b::/96`, `::ffff:0:0/96`), `localhost`, `*.localhost`, `DEVTEAM_PUBLIC_URL`, `own network interfaces`; each spine range is in `range.enum`; `shapes.state` has `additionalProperties: false` and no property matching `/lock|hold|held/`.

- [ ] **Step 2: Run** `node --test test/browser-contract.test.mjs` — expected FAIL (no schema file).

; `resets[].reopened` optional masked; rule order in `refusal`'s description) (field types, ranges and enums exactly as there; `control_secret` `^[0-9a-f]{64}$`; instance key `^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{12}$`; qid `^q-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*$`; `at` the log's `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`; frame `data` `^/9j/[A-Za-z0-9+/]*={0,2}$`). The masked-URL pattern (prototyped against the cases above):

```
^(?:about:blank|https?://[^/?#@\s]+(?:/(?:•••|(?=(?:[^/?#\s\d]*\d){0,3}[^/?#\s\d]*(?:[/?]|$))[^/?#\s]{0,19}(?=[/?]|$)))*(?:\?(?:(?:[^=&#\s•]+=•••|•••)(?:&(?:[^=&#\s•]+=•••|•••))*)?)?)$
```

- [ ] **Step 4: Write the fixtures.** Frames: `convert -size 160x100 xc:'#2b6cb0' -quality 40 a.jpg`, `convert -size 320x200 xc:'#c05621' -quality 40 b.jpg` (in the scratchpad), base64 into `view-from-server.json`. `status.json` carries every optional field; `state.json`'s `control_secret` is 64 zeros; `resets.json`'s `done` entry carries `reopened`.

- [ ] **Step 5: Run** the gate (Global Constraints) — expected PASS. Mutation check: drop `additionalProperties: false` from `state` in a scratch copy of the schema → `state-lock` test fails; drop the `#` from the mask's host class → `tabs-fragment`… (record in the task review).

- [ ] **Step 6: Commit** the schema, fixtures and test alone: `kit-61: browser@1 contract (schema, fixtures, contract test)`; push; `phase contract`; `send supervisor "kit-61 contract browser@1 at <sha>: …" --kind review-request`.

### Task 2: the fixture site

**Files:**
- Create: `test/lib/sites.mjs`
- Modify: `test/browser-contract.test.mjs` (a second `test(...)` block)

**Interfaces:**
; run as `node test/lib/sites.mjs [port]` → one JSON line `{port, origin, username, password, code}`, then a `{"session":"…"}` line per issued session, serving until killed. Routes exactly as the spec's table.

- [ ] **Step 1: Write the failing test** `the fixture site serves every page later tests browse`, with a local `req(method, path, { body, cookie }) -> { status, headers, setCookies: string[], text }` over `node:http` (`setCookies` from `res.headers['set-cookie']`). Asserts, on `startSites()`:
  - `GET /login`: 200, `<form` with `method="post"` `action="/login"`, `type="password"`, `name="username"` with no `autocomplete`.
  - `POST /login` wrong password: 200 with "Wrong username or password", no `session` cookie. Right: 302 to `/2fa`, a `pending=` cookie, no `session=`.
  - `GET /account` with only `pending`: "Not signed in".
  - `GET /2fa` with `pending`: a POST form to `/2fa` with `autocomplete="one-time-code"`; with neither cookie: 302 to `/login`; with a live `session` only: 200, the form page with "Signed in as".
  - `password`, `code` and each `sessions()` value match their patterns.
  - `POST /2fa` wrong code: 200, no `session`. Right: 302 to `/account`, `session=<v>` whose cookie has neither `Expires` nor `Max-Age`; `v` ∈ `sessions()`; `GET /account` with it: "Signed in as".
  - Replaying the used `pending` on `POST /2fa`: no `session`.
  - Remembered (`remember=1`): `session` cookie with `Max-Age=86400`.
  - `variant=page`: `POST /2fa` answers 200 with "Signed in as" and a `session` cookie.
  - `GET /posts`: `posts` equals the POSTs this test made; `paths['/login']` and `paths['/2fa']` match.
  - `GET /oauth/authorize`: 302, Location matches `/oauth/callback\?code=[^&#]+&state=[^&#]+#access_token=/`; `GET /oauth/callback`: title "Signed in with the provider", the `code`, `state` and token values appear nowhere in it, no `<a>` text contains `://`; contains `href="https://user:pass@127.0.0.1:<port>/account"`, a `/orders/\d{4,}/` link and a `/magic/[A-Za-z0-9]{20,}` link.
  - `GET /redirect?to=http%3A%2F%2F127.0.0.1%3A9%2Fx`: 302 to `http://127.0.0.1:9/x`; `GET /go?to=…`: a link to `/redirect?to=…`.
  - `GET /instructions`: text matches `/run (this|the following) command/i`.
  - `POST /events` `{"kind":"click","x":1,"y":2}` then `GET /events` and `events()` include it; `GET /record` has a `<button` and an `<input`.
  - `GET /nope`: 404. Run directly: `node test/lib/sites.mjs` prints one JSON line with `port`; after a login through that process it prints a `{"session"}` line whose value matches the cookie; then is killed.

- [ ] **Step 2: Run** — expected FAIL (no module).
- [ ] **Step 3: Implement** `test/lib/sites.mjs`: `http.createServer` on `127.0.0.1`; state in closures; `crypto.randomBytes` for password, code (6 digits), cookie values and tokens; bodies capped at 64 KB (413 above); urlencoded and JSON bodies parsed with `URLSearchParams`/`JSON.parse`; `pending` values single-use (a `Map` pending → `{remember, variant}` deleted on success); run-directly guard via `import.meta.url === pathToFileURL(process.argv[1]).href`.
- [ ] **Step 4: Run** the gate — expected PASS. Then the whole `rest` set once (CI's command, `DEVTEAM_TEST_GITLEAKS` unset), to see nothing else broke.
- [ ] **Step 5: Commit** `kit-61: the fixture site test/lib/sites.mjs`.

Then: verification.md, merge `origin/main`, PR, final review, `check-ticket`, merge-request (worker.md §8).
