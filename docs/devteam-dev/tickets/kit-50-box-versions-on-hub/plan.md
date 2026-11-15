# kit-50-box-versions-on-hub: plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, this session) with superpowers:test-driven-development. Steps use checkbox (`- [ ]`) syntax.

## TL;DR

- T0 (contract): comments above `/box.json` (gateway.mjs) and the hub-list comment above `startHub` (devteam.mjs) document `image` and the fallback's `down: true`. Committed alone; the stage word before T1.
- T1: `boxImage(e)` in gateway.mjs, `/box.json` gains `image`, `serve` writes `image: <release>|none`. Tests in `test/gateway.test.mjs`.
- T2: the gateway's fallback list is `{"hub":1,"instances":[],"down":true}`; the two existing fallback assertions change to it.
- T3: `boxLine(image, list)` in a marked pure block of `hub.html`, wired into `findBox`, `draw` and `paintOverview`, with CSS; vm and source tests in `test/hub-overview.test.mjs`.
- T4: `machine status` prints `machine: box <release>: <name> <version>, …` after the hub line; test in `test/hub-overview.test.mjs`.
- Tests run one file at a time, `--test-concurrency=2` (ruling m-20261115-030119049-supervisor); GitHub CI is the gate.

**Goal:** the hub page and `machine status` show the box's release, the release serving the hub, and the box's tool versions.

**Spec:** `docs/devteam-dev/tickets/kit-50-box-versions-on-hub/spec.md` (approved: m-20261115-030809314-supervisor).

## Global Constraints

- Token form, everywhere a value is shown or kept: `^[\w.+-]{1,64}$`.
- `/box.json` stays `box: 1`; the hub list stays `hub: 1` (both changes additive).
- Only `boxImage` in gateway.mjs names `DEVTEAM_KIT_RELEASE` / `DEVTEAM_BOX_TOOLS`.
- No new files (owner); code only in the ticket's `touches`.
- Every test that starts a child or a gateway clears `DEVTEAM_IMAGE_HUB`, `DEVTEAM_KIT_RELEASE`, `DEVTEAM_BOX_TOOLS` from the env it passes and sets them only where it means to.
- Page text: plain words and versions (R2), inserted as text, never HTML.

## Review Focus

1. Something on the hub port answers JSON `null` or a non-object (spec-2's note): `draw` must treat it as a failure (`hubSeen = null`, paint, return) and not throw before setting `hubSeen`. Test: T3's source assertion plus a `boxLine(image, null)` case; `draw`'s parse step is `data = await r.json(); if (!data || typeof data !== 'object') throw …` inside the try.
2. `DEVTEAM_BOX_TOOLS` with tabs or several spaces between pairs: split on `/\s+/` after trim. T1 case.
3. A tool version with a leading `v` (`ttyd=v1.7.7` is not today's form, but `gh` tags are): kept as given; token form allows it. T1 case.
4. `/box.json` answered but `image` missing entirely (an older gateway): `boxLine(undefined, …)` is `null`. T3 case.
5. `machine status` on the box, where the real `ENV` is set: the test env clears it; the "unset" run asserts no `machine: box` line. T4.

---

### Task 0: the contract comments

**Files:** Modify `cloud/gateway.mjs` (comment right above the `/box.json` route ~2032, and above `instances` ~1224), `docs/devteam/scripts/devteam.mjs` (the list comment above `startHub`, the line `// The list, /instances.json: { hub: 1, kit, image?, instances }…`).

- [ ] Above `/box.json`: `// /box.json, box: 1: { box, terminal, instance, passkeys, previews, push, image }. image is what the box's image says it is (boxImage: ENV DEVTEAM_KIT_RELEASE and DEVTEAM_BOX_TOOLS): { release: 'vX.Y.Z' | null, tools: { name: version } } in the ENV's order, or null with neither set. An additive change keeps box: 1.`
- [ ] Above `instances`: the fallback, when no hub answers, is the empty list with `down: true`.
- [ ] In devteam.mjs's list comment: `{ hub: 1, kit, image?, down?, instances }`, and `down: true` is only ever the gateway's fallback (no hub answered), never a hub's.
- [ ] Commit `kit-50: contract: /box.json image, the fallback list's down`; push; `send supervisor "… contract at <sha>" --kind review-request`; `phase contract`; wait for the word.

### Task 1: `boxImage`, `/box.json`'s `image`, the start line

**Files:** Modify `cloud/gateway.mjs` (new export near `publicUrl` ~154; `createGateway` ~851; route ~2032; `serve` ~2423). Test `test/gateway.test.mjs`.

**Interfaces:** Produces `export function boxImage(e): null | { release: string | null, tools: Record<string, string> }`; `createGateway(opts)` accepts `opts.env`.

- [ ] **Failing tests** (in `test/gateway.test.mjs`):
  - `test('boxImage reads the image ENV: release and tools in order, or null', …)`: `boxImage({})` → `null`; `{ DEVTEAM_KIT_RELEASE: '  ', DEVTEAM_BOX_TOOLS: '' }` → `null`; `{ DEVTEAM_KIT_RELEASE: 'v0.52.0' }` → `{ release: 'v0.52.0', tools: {} }`; `{ DEVTEAM_BOX_TOOLS: 'gh=2.83.0' }` → `{ release: null, tools: { gh: '2.83.0' } }`; `{ DEVTEAM_KIT_RELEASE: ' v0.52.0 ', DEVTEAM_BOX_TOOLS: ' claude-code=2.1.310\tgh=v2.83.0  uv=0.9.9 gh=9 bad=\u001b[31m x=y=z =1 n= ' }` → `{ release: 'v0.52.0', tools: { 'claude-code': '2.1.310', gh: 'v2.83.0', uv: '0.9.9' } }` and `Object.keys` order `['claude-code','gh','uv']`; release `'\u001b[31mv1'` and `'v'.repeat(65)` → `release: null`.
  - In the existing signed-in test (~L319): build `env` for the gateway as `{ ...process.env }` minus the three box vars and pass `env` to `gateway(name, { env })`; the `deepEqual` at ~L358 gains exactly `image: null`.
  - `test('/box.json names the image: release and tools from the env the gateway is given', …)`: `gateway('boximage', { env: { ...cleared, DEVTEAM_KIT_RELEASE: 'v9.9.9', DEVTEAM_BOX_TOOLS: 'claude-code=2.1.310 gh=2.83.0' } })`, claim, `GET /box.json` → `image` deepEquals `{ release: 'v9.9.9', tools: { 'claude-code': '2.1.310', gh: '2.83.0' } }`, and the other six keys are present; unclaimed/signed-out still 403/401 (one assertion each).
  - `test('serve writes image: <release> at start, or image: none', …)`: spawn `cloud/gateway.mjs serve` with env `{ ...cleared, HOME, DEVTEAM_GATEWAY_DIR, DEVTEAM_UPLOADS_DIR (temp, mode 0o750), DEVTEAM_PUBLIC_URL: 'http://box.localhost:<port>', PORT: <freePort>, DEVTEAM_TTYD_PORT: <freePort> }`; read stdout until a line matching `/^image: /m` (10 s cap); assert `image: v9.9.9` with the vars set, `image: none` without; kill with SIGTERM and await `exit` in `finally`.
  - `test('only boxImage reads DEVTEAM_KIT_RELEASE and DEVTEAM_BOX_TOOLS in gateway.mjs', …)`: for each name, count in the file source equals count in `G.boxImage.toString()` (and the latter is ≥ 1); the source has `image: boxImg` (or the name used) in the `/box.json` route line, and the `serve` branch contains `boxImage(` .
- [ ] Run `node --test --test-concurrency=2 test/gateway.test.mjs` → the new tests fail (`boxImage` not exported; `image` missing).
- [ ] **Implement:** `boxImage` per spec §1 (trim; split `/\s+/`; pair split at the first `=` with both halves matching the token form and no second `=`; first of a duplicate name kept; `null` when the trimmed release and the trimmed tools string are both empty). In `createGateway`: `const IMAGE = boxImage(opts.env ?? env);` and the route adds `image: IMAGE`. In `serve`, before `listen`: `process.stdout.write(\`image: ${boxImage(env)?.release ?? 'none'}\n\`)`.
- [ ] Run the file again → PASS. `gate test --junit … -- node --test --test-concurrency=2 test/gateway.test.mjs`.
- [ ] Commit `kit-50 T1: boxImage, /box.json image, the gateway's image line`; task review `reviews/task-1.md` (fresh subagent).

### Task 2: the fallback's `down`

**Files:** Modify `cloud/gateway.mjs` `instances` (~1224). Test `test/gateway.test.mjs` (~L488, ~L494).

- [ ] Change the two expected bodies `'{"hub":1,"instances":[]}'` to `'{"hub":1,"instances":[],"down":true}'` (L488: an answer over 1 MB; L494: nothing on the port). Run → FAIL.
- [ ] `JSON.stringify({ hub: 1, instances: [], down: true })` in `instances`. Run → PASS; gate as T1.
- [ ] Commit `kit-50 T2: the gateway's fallback list says down`; `reviews/task-2.md`.

### Task 3: the box line on the hub page

**Files:** Modify `docs/devteam/dashboard/hub.html` (CSS after `.ov-head .acts` rules ~110; the pure block just before `function paintOverview` ~554; `paintOverview`; `draw` ~1281; `findBox` ~1386; `let hubSeen = null;` beside `let box`). Test `test/hub-overview.test.mjs`.

**Interfaces:** Produces `boxLine(image, list): null | Array<{ text: string, amber: boolean }>`, inside `/* box-line start */ … /* box-line end */`, using no DOM, `fetch`, `window`, or names defined outside the block.

- [ ] **Failing tests** (pure-logic, no Chrome, near the top of the file after the pulse tests): a helper `const boxLineOf = () => { const html = read hub.html; const src = slice between markers; assert src.length > 200; const ctx = vm.createContext({}); vm.runInContext(\`${src}\n;globalThis.api = { boxLine };\`, ctx); return ctx.api.boxLine; }` (import `vm` and `kit`'s path as dashboard.test.mjs does). `const line = (p) => p && p.map((x) => x.text).join(' · ')`, `const amber = (p) => p.filter((x) => x.amber).map((x) => x.text)`. `const IMG = { release: 'v0.52.0', tools: { 'claude-code': '2.1.310', 'claude-swap': '0.4.1', gh: '2.83.0', ttyd: '1.7.7', mise: '2025.11.3', uv: '0.9.9' } }`.
  - `test('the box line: the image's release, the hub's, and the tools', …)`: `line(boxLine(IMG, { hub: 1, kit: 'v0.52.0', image: true, instances: [] }))` === `'Box v0.52.0 · hub v0.52.0 · Claude Code 2.1.310 · claude-swap 0.4.1 · gh 2.83.0 · ttyd 1.7.7 · mise 2025.11.3 · uv 0.9.9'` and `amber(...)` is `[]`.
  - amber: list `{ hub: 1, kit: 'v0.50.4', instances: [] }` → `["hub served by a project's kit, v0.50.4"]`; `{ hub: 1, instances: [] }` → `["hub served by a project's kit, ?"]`; `{ hub: 1, kit: 'v0.52.0', instances: [] }` → `["hub served by a project's kit, v0.52.0"]`; `{ hub: 1, kit: 'v0.52.0', image: true }` with image release `v0.53.0` → `['hub v0.52.0, box v0.53.0']` and the line starts `Box v0.53.0 · hub v0.52.0, box v0.53.0 · `; `{ hub: 1, instances: [], down: true }` and `null` → `['hub not answering']`; `{ hub: 2 }` and `{ instances: [] }` → `["hub port held by something that isn't a hub"]`; `{ hub: 1, kit: '\u001b[31mx', image: true }` and `kit: 'v'.repeat(10240)` → `['hub ?, box v0.52.0']`.
  - nothing: `boxLine(null, L)`, `boxLine(undefined, L)`, `boxLine('v1', L)`, `boxLine({ release: '<b>', tools: {} }, L)`, `boxLine({ tools: {} }, L)` all `null`.
  - tools: `{ release: 'v1.0.0', tools: { gh: '2', 'x y': '1', uv: '<i>', mise: 3 } }` → tool parts `['gh 2']`; `tools` not an object → just Box and hub parts.
  - R2: every `text` across the cases matches `/^[\w .,'+-]+$/` and none contains `http` or `<`.
  - `test('the Overview draws the box line from box.json and the latest list', …)`: cut each function's source from hub.html by `html.indexOf('function paintOverview(')` to the next `\nfunction `/`\nasync function ` (same for `async function draw(` and `async function findBox(`); assert `paintOverview` matches `/boxLine\(box\?\.image \?\? null, hubSeen\)/`; `findBox` matches `/image: b\.image/`; `draw` matches `/hubSeen = data/` and, in its `catch`, `/hubSeen = null;[^}]*paintOverview\(\)/`.
- [ ] Run `node --test --test-concurrency=2 test/hub-overview.test.mjs` → the new tests FAIL (no markers).
- [ ] **Implement** per spec §3: the block (with `BOX_TOKEN = /^[\w.+-]{1,64}$/` and `TOOL_WORDS = { 'claude-code': 'Claude Code' }` inside it); `box = { …, image: b.image }` in `findBox`; in `draw`: `data = await r.json(); if (!data || typeof data !== 'object') throw new Error('not a list');` then `hubSeen = data;`, and `catch { hubSeen = null; paintOverview(); return; }` (the 401 reload stays before it); in `paintOverview`, after the summary is appended and before `acts`: `const bl = boxLine(box?.image ?? null, hubSeen); if (bl) { const d = el('div', 'ov-box'); bl.forEach((p, i) => { if (i) d.append(' · '); d.append(el('span', p.amber ? 'amber' : '', p.text)); }); head.append(d); }` (`el` sets text with `textContent`; check it does). CSS per spec: `.ov-head .ov-box { flex-basis: 100%; order: 1; color: var(--fg-2); } .ov-box .amber { color: var(--amber-fg); }`.
- [ ] Run → PASS; also `node --test --test-concurrency=2 test/dashboard.test.mjs` (it reads hub.html too, if it does: `grep -l hub.html test/*.mjs` and run each one that reads it, one at a time). Gate as T1.
- [ ] Look at it: `devteam.mjs preview --run` is not needed for a pure line; take a screenshot only if Chrome is available (`test/lib/chrome.mjs`'s `canDrive`), else say so in verification.md.
- [ ] Commit `kit-50 T3: the box line on the hub's Overview`; `reviews/task-3.md`.

### Task 4: `machine status`'s box line

**Files:** Modify `docs/devteam/scripts/devteam.mjs` (`machineStatus`, right after the `machine: hub` `out(...)` ~13681; a small helper `boxStatusLine(env = process.env): string | null` beside `hubLine`). Test `test/hub-overview.test.mjs`.

- [ ] **Failing test** `test('machine status prints the box line after the hub line, only with the image ENV', { timeout: 120000 }, async (t) => …)`: `const M = hubMachine(t, 'box-line', <a free fixture port: PORTS + 42>)`; `empty = fs.mkdtempSync(...)` under `M.base`; run `spawnSync(process.execPath, [kitScript, 'machine', 'status', '--in', empty], { cwd: M.cwd, env, encoding: 'utf8', timeout: 60000 })` where `kitScript` is the repo's `docs/devteam/scripts/devteam.mjs` (via `kit`). Lines = stdout split. With `{ ...M.env, DEVTEAM_KIT_RELEASE: 'v9.9.9', DEVTEAM_BOX_TOOLS: 'claude-code=2.1.310 gh=2.83.0' }`: the line after the one starting `machine: hub ` is exactly `machine: box v9.9.9: claude-code 2.1.310, gh 2.83.0`. With `M.env`: no line starts `machine: box`. With `DEVTEAM_KIT_RELEASE: '\u001b[31mx'`, `DEVTEAM_BOX_TOOLS: 'gh=2.83.0 uv=\u001b[0m'`: `machine: box ?: gh 2.83.0`. With `DEVTEAM_KIT_RELEASE: 'v1.0.0'` only: `machine: box v1.0.0`. `git status --porcelain` of the repo unchanged by the test.
- [ ] Run → FAIL.
- [ ] **Implement** `boxStatusLine`: same parse as `boxImage` (trim; `/\s+/`; first `=`; token form both halves; first duplicate kept); `null` when both trimmed values are empty; else `machine: box ${release ?? '?'}` plus `: ${pairs.map(([n, v]) => \`${n} ${v}\`).join(', ')}` when any pair. In `machineStatus`: `const bl = boxStatusLine(); if (bl) out(bl);` right after the hub line.
- [ ] Run → PASS; `node --test --test-concurrency=2 test/machine.test.mjs` (it parses machine status). Gate as T1.
- [ ] Commit `kit-50 T4: machine status's box line`; `reviews/task-4.md`.

### Finish

verification.md (a row per done-when, command, result, commit); merge `origin/main`; touched test files one at a time; push; PR `kit-50-box-versions-on-hub: <title>`; `gate ci -- <the real CI watch command>` once CI is green; two final reviews from other sessions (risk high) via `review-request`; `check-ticket`; `merge-request`.

## Rulings

- m-20261115-030119049-supervisor: never run the full suite locally; touched files one at a time at `--test-concurrency=2`; CI is the gate; tell reviewers.
- m-20261115-030809314-supervisor: spec approved, the four calls included (boxImage drops non-token values; the amber "isn't a hub" part; `machine: box <release>` with no usable pair; the fallback assertions ~L488/494 change). The PR body says the existing fallback assertions changed because the body changed.
