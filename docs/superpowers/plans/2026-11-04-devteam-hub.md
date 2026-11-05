# devteam hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every devteam instance on a machine gets its own tmux session and dashboard port, and `http://127.0.0.1:4320` lists them all, linking to each instance's own dashboard.

**Architecture:** One script (`docs/devteam/scripts/devteam.mjs`, Node 18+, built-ins only) gains:
- a resolver for the tmux session name, which every tmux call goes through;
- a port picker for the dashboard;
- a light `hello` subcommand, plus an `/api/hello` route served from a cached background run;
- a hub server inside every dashboard process, which wins `127.0.0.1:4320` or retries.

The hub finds instances by probing `/api/hello` on 4321–4345. There is no shared state file. The hub page is a new kit file, `dashboard/hub.html`.

**Tech Stack:** Node 18 built-ins (`node:http`, `node:net`, `node:child_process`), tmux, git; tests in `test/kit.test.mjs` with `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-04-devteam-hub-design.md`

## Global Constraints

- Node 18 or newer, built-ins only, nothing newer than Node 18 APIs.
- Hub port 4320. Instance range 4321–4345 (25 ports). Hub retry 30 s. Probe timeout 300 ms. Hello refresh 30 s.
- Test-only overrides: `DEVTEAM_HUB_PORT`, `DEVTEAM_PORT_BASE` (the range is base..base+24), `DEVTEAM_HUB_RETRY_MS`.
- The hub binds `127.0.0.1` only. It answers only to `Host` `127.0.0.1:<hub>` or `localhost:<hub>`, and has no POST routes.
- Every tmux target uses exact session matching: `=<session>`. tmux otherwise falls back to a prefix match, so `devteam` would find `devteam-stacks`.
- `run/tmux-session` is written only when the kit creates the tmux session. `run/dashboard-port` is written only by `dashboard` with no explicit port.
- Harness-agnostic, and nothing project-specific in the kit.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `ASDF_RUBY_VERSION=3.1.7 ~/.asdf/installs/nodejs/<v>/bin/node --test test/kit.test.mjs` for 18.20.4, 20.19.6 and 24.14.1, one at a time.

---

### Task 1: The tmux session is resolved per project

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`:
  - SETTINGS_DEFAULTS, line 174: `tmux_session: null`
  - new helpers after `sh()`, near line 128
  - every `tmux_session` use: lines 1269, 1280, 1343, 1670, 5045, 5051, 5064, 5620, 5846–5850, 5866, 6288
  - `cmdWhoami`, `cmdSettings`
  - `RUN_KNOWN`
- Test: `test/kit.test.mjs`

**Interfaces:**
- Produces: `tmuxSession({ save = false } = {}) → string` and `tmuxTarget(window) → string` (returns `=<session>:<window>`).
- `cmdSettings --get tmux_session` prints the resolved name.

- [ ] **Step 1: Write the failing test.** Add a subtest in the main `devteam kit` test, after the existing worker/tmux subtests:

```js
  await t.test('the tmux session is per project: devteam-<project>, a legacy devteam session kept, read-only commands write nothing', () => {
    const f = path.join(repo, 'docs/devteam/run/tmux-session');
    fs.rmSync(f, { force: true });
    assert.equal(must(['settings', '--get', 'tmux_session']), 'devteam-demo', 'the default names the project');
    assert.ok(!fs.existsSync(f), 'resolving it writes nothing');
    if (hasTmux) {
      // a legacy `devteam` session holding one of this project's live windows keeps that name
      const live = json(must(['dashboard-data'])).tickets.find((x) => x.session_alive)?.id;
      if (live) {
        spawnSync('tmux', ['new-session', '-d', '-s', 'devteam', '-n', live]);
        assert.equal(must(['settings', '--get', 'tmux_session']), 'devteam');
        spawnSync('tmux', ['kill-session', '-t', '=devteam']);
      }
    }
  });
```

- [ ] **Step 2: Run it to verify it fails.** Expected: FAIL, `'devteam' !== 'devteam-demo'`.

- [ ] **Step 3: Implement.** In SETTINGS_DEFAULTS, `tmux_session: 'devteam'` becomes `tmux_session: null`. After `function sh(...)`, add:

```js
// The tmux session that holds this project's workers and planners. settings.tmux_session when set;
// else the name saved in run/tmux-session; else devteam-<project>, so two projects on one machine
// never share a session. A project whose live sessions already sit in a `devteam` session (the
// default before this) keeps it. Resolving writes nothing: the name is saved when the kit creates
// the session (save), so a read-only command or CI never writes into run/.
function tmuxSession({ save = false } = {}) {
  const s = loadSettings();
  if (s.tmux_session) return s.tmux_session;
  const file = path.join(runDir, 'tmux-session');
  const saved = readText(file)?.trim();
  if (saved) return saved;
  const legacy = new Set((sh('tmux', ['list-windows', '-t', '=devteam', '-F', '#W']) ?? '').split('\n').filter(Boolean));
  const name = legacy.size && liveSessions().some((x) => legacy.has(x.name)) ? 'devteam' : `devteam-${slug(s.project ?? path.basename(mainRoot))}`;
  if (save) { fs.mkdirSync(runDir, { recursive: true }); fs.writeFileSync(file, `${name}\n`); }
  return name;
}
// A window of this project's session, matched exactly (tmux would otherwise take a prefix).
const tmuxTarget = (window) => `=${tmuxSession()}:${window}`;
```

Replace each use:
- `${loadSettings().tmux_session}:${window}` → `tmuxTarget(window)`
- `${s.tmux_session}:${by}` → `tmuxTarget(by)`
- `${loadSettings().tmux_session}:${to}` → `tmuxTarget(to)`
- `['list-windows', '-t', loadSettings().tmux_session, ...]`, `['list-windows', '-t', settings.tmux_session, ...]` and `['list-windows', '-t', s.tmux_session, ...]` → `['list-windows', '-t', `=${tmuxSession()}`, ...]`
- In the findings at 5051 and 5064, `select-window -t ${settings.tmux_session}:${id}` → `select-window -t ${tmuxTarget(id)}` (and `who` likewise).
- In the worker launch (5846–5850):

```js
  const session = tmuxSession({ save: true });
  if (!tmux(['has-session', '-t', `=${session}`])) { fresh = tmux(['new-session', '-d', '-s', session, '-n', name, '-c', wt]); if (!fresh) die('could not start tmux'); }
  const windows = (sh('tmux', ['list-windows', '-t', `=${session}`, '-F', '#W']) ?? '').split('\n');
  if (!fresh && windows.includes(name)) { if (!flags.resume) die(`window ${session}:${name} exists (use --resume to relaunch in it)`); }
  else if (!fresh) tmux(['new-window', '-d', '-t', `=${session}`, '-n', name, '-c', wt]);
  const target = `=${session}:${name}`;
```

- In the marker strip (5866): `['show-environment', '-t', s.tmux_session]` → `['show-environment', '-t', `=${tmuxSession()}`]`.
- In the move checklist (6288): `-t ${s.tmux_session}` → `-t ${tmuxSession()}`.
- `cmdWhoami`: `tmux_session=${s.tmux_session}` → `tmux_session=${tmuxSession()}`.
- `cmdSettings`: before `const v = s[key];`, add `if (key === 'tmux_session') return out(tmuxSession());`.
- `RUN_KNOWN`: add `'tmux-session'` and `'dashboard-port'`.

Then grep for any remaining `tmux_session` that isn't the default, the helper or the settings doc. Expected: none.

- [ ] **Step 4: Fix the tests that assumed `devteam`.** The test file names `devteam:<window>` in `capture-pane` targets (lines ~275–319, 1124, 1136, and the fleet-park pane check). The fixture's project is `demo` (`init --name demo`), so those become `=devteam-demo:<window>`. In `fleetFixture`, the project is named by `init --name <name>`, so the fleet-park check uses `` `=devteam-${'park'}:${ID}` ``, written as the literal `=devteam-park:`. Run `grep -n "'devteam:" test/kit.test.mjs` and replace every hit.

- [ ] **Step 5: Run the full suite on Node 24.** Expected: PASS, including the new subtest.

- [ ] **Step 6: Commit.** Message: `A project's tmux session is its own: devteam-<project>, a legacy devteam session kept, exact targets`.

---

### Task 2: The dashboard picks its port by the "+1" rule

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`: SETTINGS_DEFAULTS `dashboard_port: null`; new helpers before `cmdDashboard`; `cmdDashboard` start.
- Test: `test/kit.test.mjs`, at the top, plus a new top-level `test(...)`.

**Interfaces:**
- Produces:
  - `HUB_PORT` (number)
  - `PORT_BASE` (number)
  - `PORT_RANGE` (number array, 25 entries)
  - `probeHello(port, ms = 300) → Promise<object|null>` (the parsed `/api/hello` JSON with `devteam` ≥ 1, or null)
  - `portFree(port) → Promise<boolean>`
  - `pickDashboardPort() → Promise<{ port, saved: boolean, warn: string|null }>`

- [ ] **Step 1: Set the test-only ports for the whole file.** At the top of `test/kit.test.mjs`, after `delete process.env.TMUX_PANE;`, add:

```js
// Dashboards started by tests never use the machine's real ports or become its hub: the hub and
// the instance range move to a block the tests own.
process.env.DEVTEAM_HUB_PORT = '47320';
process.env.DEVTEAM_PORT_BASE = '47321';
```

- [ ] **Step 2: Write the failing test.** Add a top-level test at the end of the file:

```js
test('dashboard ports: saved and reused, +1 from the highest instance, held ports skipped, pinned outside the range warned', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-ports-'));
  const mk = (name) => {
    const r = path.join(base, name);
    fs.mkdirSync(r);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r });
    fs.cpSync(kit, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
    spawnSync(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'init', '--name', name], { cwd: r });
    return r;
  };
  const env = { ...process.env, DEVTEAM_HUB_PORT: '47390', DEVTEAM_PORT_BASE: '47391' };
  const start = (r) => { const p = spawn(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'dashboard'], { cwd: r, env, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', (b) => { o += b; }); p.stderr.on('data', (b) => { o += b; }); return { p, out: () => o }; };
  const until = async (f) => { for (let i = 0; i < 300 && !f(); i++) await new Promise((r) => setTimeout(r, 100)); assert.ok(f()); };
  const A = mk('alpha');
  const B = mk('beta');
  const blocker = net.createServer().listen(47392, '127.0.0.1');
  const a = start(A);
  try {
    await until(() => /dashboard on http:\/\/127\.0\.0\.1:47391/.test(a.out()));
    assert.equal(fs.readFileSync(path.join(A, 'docs/devteam/run/dashboard-port'), 'utf8').trim(), '47391');
    const b = start(B);
    try {
      await until(() => /dashboard on http:\/\/127\.0\.0\.1:47393/.test(b.out()));
      // 47392 is held by something that isn't devteam, so the next after alpha's 47391 is 47393
    } finally { b.p.kill(); }
    a.p.kill();
    await new Promise((r) => a.p.on('close', r));
    const a2 = start(A);
    try { await until(() => /127\.0\.0\.1:47391/.test(a2.out())); } finally { a2.p.kill(); }
  } finally { a.p.kill(); blocker.close(); }
  const pinned = spawn(process.execPath, [path.join(A, 'docs/devteam/scripts/devteam.mjs'), 'dashboard', '--port', String(await freePort())], { cwd: A, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let po = ''; pinned.stdout.on('data', (b) => { po += b; }); pinned.stderr.on('data', (b) => { po += b; });
  try { await until(() => /outside 47391-47415: the hub won't list it/.test(po)); } finally { pinned.kill(); }
  fs.rmSync(base, { recursive: true, force: true });
});
```

- [ ] **Step 3: Run it to verify it fails.** Expected: FAIL. With the default 4321 it never prints `:47391`.

- [ ] **Step 4: Implement.** SETTINGS_DEFAULTS: `dashboard_port: 4321` → `dashboard_port: null`. Before `function cmdDashboard`, add:

```js
// Every instance on a machine has its own dashboard port in one block, so the hub (§ below) finds
// them all by asking each port who it is. DEVTEAM_HUB_PORT and DEVTEAM_PORT_BASE are for tests.
const HUB_PORT = Number(process.env.DEVTEAM_HUB_PORT ?? 4320);
const PORT_BASE = Number(process.env.DEVTEAM_PORT_BASE ?? 4321);
const PORT_RANGE = Array.from({ length: 25 }, (_, i) => PORT_BASE + i);
// Who answers on a port: a devteam dashboard's /api/hello, or null (closed, slow, or not devteam).
function probeHello(port, ms = 300) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/hello', timeout: ms, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; if (b.length > 65536) req.destroy(); });
      res.on('end', () => { try { const j = JSON.parse(b); resolve(res.statusCode === 200 && Number(j?.devteam) >= 1 ? j : null); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}
const portFree = (port) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '127.0.0.1', () => s.close(() => resolve(true))); });
// The dashboard's port: the one pinned (settings or --port); else the one this checkout used
// last, if free; else one past the highest instance answering in the block, skipping ports held
// by anything else; else the lowest free one. Saved to run/dashboard-port.
async function pickDashboardPort() {
  const pinned = flagStr('port') ?? loadSettings().dashboard_port;
  if (pinned != null) {
    const port = Number(pinned);
    return { port, saved: false, warn: PORT_RANGE.includes(port) ? null : `port ${port} is outside ${PORT_RANGE[0]}-${PORT_RANGE.at(-1)}: the hub won't list it` };
  }
  const file = path.join(runDir, 'dashboard-port');
  const last = Number(readText(file)?.trim());
  if (PORT_RANGE.includes(last) && (await portFree(last))) return { port: last, saved: true, warn: null };
  const hellos = await Promise.all(PORT_RANGE.map((p) => probeHello(p)));
  const top = PORT_RANGE.filter((_, i) => hellos[i]).pop();
  const order = top === undefined ? PORT_RANGE : [...PORT_RANGE.filter((p) => p > top), ...PORT_RANGE.filter((p) => p <= top)];
  for (const p of order) {
    if (await portFree(p)) {
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(file, `${p}\n`);
      return { port: p, saved: true, warn: null };
    }
  }
  die(`every dashboard port in ${PORT_RANGE[0]}-${PORT_RANGE.at(-1)} is taken; pin one with "dashboard_port" in settings.md (the hub won't list it) or stop an instance`);
}
```

Add `import net from 'node:net';` with the other imports. `cmdDashboard` becomes async at the top:

```js
async function cmdDashboard() {
  const picked = await pickDashboardPort();
  const port = picked.port;
  const host = flagStr('host') ?? '127.0.0.1';
  const log = dashboardLogger();
  if (picked.warn) { log(picked.warn); process.stderr.write(`devteam dashboard: ${picked.warn}\n`); }
```

Find how `COMMANDS` dispatches and confirm an async command's promise is awaited, or that its rejections reach the dashboard's `unhandledRejection` handler. `cmdDashboard` sets that handler only after `pickDashboardPort`, so wrap the dispatch with `.catch((e) => die(e.message))` if the dispatcher doesn't await.

- [ ] **Step 5: Run the new test, then the full suite.** Expected: PASS. Dashboards in existing tests pass `--port` with a free OS port. That port is outside 47321–47345, so they log the warning, which is harmless.

- [ ] **Step 6: Commit.** Message: `The dashboard port: saved per checkout, +1 from the highest instance in 4321-4345, held ports skipped`.

---

### Task 3: `hello` and `/api/hello`

**Files:**
- Modify: `docs/devteam/scripts/devteam.mjs`: new `cmdHello`, a `COMMANDS` entry, the help text, a `cmdDashboard` route and background refresh.
- Test: `test/kit.test.mjs`, a subtest in the main test.

**Interfaces:**
- Consumes: `questions()`, `fleetMode()`, `liveSessions()`, `mainRef()`, `git()`, `kitDir`, `repoRoot`, `mainRoot`, `projectRel`, `loadSettings()`.
- Produces: the `hello --json` output `{ devteam: 1, root, name, kit, inbox, fleet: { mode, workers } }`, and `GET /api/hello` = that plus `port`, with `inbox` and `fleet` null until the first run.

- [ ] **Step 1: Write the failing test.** A subtest in the main test, near the dashboard subtests:

```js
  await t.test('hello: who this instance is, light enough for the hub; /api/hello answers from the last run', async () => {
    const h = json(must(['hello', '--json']));
    assert.equal(h.devteam, 1);
    assert.equal(h.root, fs.realpathSync(repo));
    assert.equal(h.name, 'demo');
    assert.equal(typeof h.inbox, 'number');
    assert.ok(['run', 'drain', 'park'].includes(h.fleet.mode));
    assert.equal(typeof h.fleet.workers, 'number');
    assert.match(h.kit, /^(v\d+\.\d+\.\d+|unreleased)(\+local)?$/);
    const port = await freePort();
    const srv = spawn(process.execPath, [DT, 'dashboard', '--port', String(port)], { cwd: repo, env: { ...process.env, DEVTEAM_ROLE: '' }, stdio: 'ignore' });
    try {
      await serverUp(`http://127.0.0.1:${port}/`);
      let j;
      for (let i = 0; i < 300; i++) { j = await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json(); if (j.inbox !== null) break; await new Promise((r) => setTimeout(r, 100)); }
      assert.equal(j.port, port);
      assert.equal(j.inbox, h.inbox, 'the background run fills it in');
      const t0 = Date.now();
      await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json();
      assert.ok(Date.now() - t0 < 300, 'answered from the last run, not recomputed');
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/hello`, { headers: { host: 'evil.example' } })).status, 403);
    } finally { srv.kill(); }
  });
```

Check how the dashboard rejects a foreign `Host` today (the `okHost` check), and assert the same status it returns.

- [ ] **Step 2: Run it to verify it fails.** Expected: FAIL, `unknown command "hello"`.

- [ ] **Step 3: Implement `cmdHello`.** Place it next to `cmdWhoami`:

```js
// hello: who this instance is, for the hub. A fold of the log, without metrics or git history, so
// the dashboard can run it every 30 s; the hub reads it from /api/hello.
function cmdHello() {
  const s = loadSettings();
  const inbox = questions().filter((q) => q.status === 'open').length;
  const workers = liveSessions().filter((x) => x.alive).length;
  const r = { devteam: 1, root: fs.realpathSync(mainRoot), name: s.project ?? path.basename(mainRoot), kit: kitVersion(), inbox, fleet: { mode: fleetMode() ?? 'run', workers } };
  return flags.json ? json(r) : out(`${r.name} at ${r.root}: kit ${r.kit}, ${inbox} open question(s), fleet ${r.fleet.mode}, ${workers} session(s)`);
}
// The kit's release (settings.upstream_base), +local when the kit that is running differs from the
// kit committed on main (kit files outside project/ and run/, by blob).
function kitVersion() {
  const tag = loadSettings().upstream_base ?? 'unreleased';
  const main = mainRef();
  const rel = path.relative(mainRoot, kitDir).split(path.sep).join('/');
  if (!main || rel.startsWith('..')) return tag;
  const onMain = new Map((git(['ls-tree', '-r', main, '--', rel]) ?? '').split('\n').filter(Boolean).map((l) => { const [meta, f] = l.split('\t'); return [f, meta.split(' ')[2]]; }).filter(([f]) => !/\/(project|run)\//.test(`/${f.slice(rel.length)}/`)));
  for (const [f, blob] of onMain) {
    const abs = path.join(mainRoot, f);
    if (!fs.existsSync(abs) || git(['hash-object', abs]) !== blob) return `${tag}+local`;
  }
  return tag;
}
```

Before relying on `x.alive` in `liveSessions()` and `q.status === 'open'` in `questions()`, check them against those functions. Use the field `dashboard-data` already uses for "session alive" and for the Inbox's open count, so the hub and the dashboard agree. Add `hello: cmdHello` to `COMMANDS`, and a help line: `hello [--json]   who this instance is (root, name, kit, open questions, fleet): what the hub lists`.

- [ ] **Step 4: Implement `/api/hello` in `cmdDashboard`.** After `const send = ...`:

```js
  // /api/hello answers at once from the last `hello` run, refreshed every 30 s in the background.
  let hello = null;
  const refreshHello = async () => { const r = await run(['hello', '--json']); if (r.ok) { try { hello = JSON.parse(r.stdout); } catch {} } };
  refreshHello();
  setInterval(refreshHello, 30000).unref();
  const helloBody = () => JSON.stringify({ devteam: 1, root: fs.realpathSync(mainRoot), name: loadSettings().project ?? path.basename(mainRoot), kit: hello?.kit ?? null, port, inbox: hello?.inbox ?? null, fleet: hello?.fleet ?? null });
```

In the request handler, after the `okHost` guard has run and before the `/api/data` route:

```js
    if (req.method === 'GET' && req.url === '/api/hello') return send(res, 200, 'application/json', helloBody());
```

- [ ] **Step 5: Run the subtest, then the full suite.** Expected: PASS.

- [ ] **Step 6: Commit.** Message: `hello and /api/hello: who an instance is, from a light fold the dashboard refreshes every 30s`.

---

### Task 4: The hub

**Files:**
- Create: `docs/devteam/dashboard/hub.html`
- Modify: `docs/devteam/scripts/devteam.mjs`: `startHub()`, called from `cmdDashboard` after `server.listen`.
- Test: `test/kit.test.mjs`, an extension of Task 2's top-level test, or a new one with two instances.

**Interfaces:**
- Consumes: `HUB_PORT`, `PORT_RANGE`, `probeHello`, `kitDir`, the `log` from `cmdDashboard`.
- Produces: `GET /` (hub.html) and `GET /instances.json` → `{ hub: 1, instances: [hello…] }` sorted by root.

- [ ] **Step 1: Write the failing test.** A top-level test:

```js
test('the hub: lists every instance on the machine, links to each one, moves when its dashboard stops, and does nothing else', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-hub-'));
  const mk = (name) => {
    const r = path.join(base, name);
    fs.mkdirSync(r);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: r });
    fs.cpSync(kit, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
    spawnSync(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'init', '--name', name], { cwd: r });
    return r;
  };
  const HUB = 47360;
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: '47361', DEVTEAM_HUB_RETRY_MS: '500' };
  const start = (r) => spawn(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'dashboard'], { cwd: r, env, stdio: 'ignore' });
  const list = async () => { try { return (await (await fetch(`http://127.0.0.1:${HUB}/instances.json`)).json()).instances; } catch { return null; } };
  const until = async (f) => { for (let i = 0; i < 300; i++) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); } assert.fail('timed out'); };
  const A = mk('alpha');
  const B = mk('beta');
  fs.appendFileSync(path.join(B, 'docs/devteam/scripts/devteam.mjs'), '\n// a local change\n');
  const a = start(A);
  const b = start(B);
  try {
    const both = await until(async () => { const l = await list(); return l?.length === 2 && l.every((x) => x.inbox !== null) && l; });
    assert.deepEqual(both.map((x) => x.name), ['alpha', 'beta']);
    assert.match(both[1].kit, /\+local$/, "beta's edited kit shows");
    const page = await (await fetch(`http://127.0.0.1:${HUB}/`)).text();
    assert.match(page, /instances\.json/, 'the page reads the list from its own hub');
    assert.equal((await fetch(`http://127.0.0.1:${HUB}/instances.json`, { headers: { host: 'evil.example' } })).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${HUB}/instances.json`, { method: 'POST' })).status, 405);
    a.kill();
    const after = await until(async () => { const l = await list(); return l?.length === 1 && l; });
    assert.deepEqual(after.map((x) => x.name), ['beta'], "the hub moved to beta's dashboard and lists what is left");
  } finally { a.kill(); b.kill(); fs.rmSync(base, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it to verify it fails.** Expected: FAIL, timed out, since nothing listens on 47360.

- [ ] **Step 3: Create `docs/devteam/dashboard/hub.html`.** A self-contained page with no external requests. It polls `instances.json` every 10 s and renders one card per instance:
  - the root path as a link to `http://127.0.0.1:<port>/`
  - the name
  - the kit, badged when it ends `+local`
  - the Inbox count, highlighted when above 0
  - fleet mode and session count, or "starting" when `inbox` is null

  When the list is empty, it shows "No devteam dashboards are running on this machine." The styles are inline, following `devteam-ui.css`'s tokens, with dark mode through `prefers-color-scheme`, and it renders text through `textContent` only. The full file:

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>devteam</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#2563eb;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--card:#1c1917;--line:#292524;--accent:#60a5fa;--warn:#f59e0b}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px}
h1{font-size:18px;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:0 0 12px}
.card a{color:var(--accent);font:600 15px ui-monospace,monospace;word-break:break-all;text-decoration:none}
.meta{color:var(--muted);font-size:13px;margin-top:6px;display:flex;gap:12px;flex-wrap:wrap}
.badge{border:1px solid var(--line);border-radius:999px;padding:0 8px}
.inbox{color:var(--warn);font-weight:600}
</style></head>
<body><main><h1>devteam on this machine</h1><p class="sub">Every running instance. Open one to see its own dashboard.</p><div id="list"></div></main>
<script>
const list = document.getElementById('list');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
async function draw() {
  let data;
  try { data = await (await fetch('instances.json', { cache: 'no-store' })).json(); } catch { return; }
  list.replaceChildren();
  if (!data.instances.length) { list.append(el('p', 'sub', 'No devteam dashboards are running on this machine.')); return; }
  for (const x of data.instances) {
    const c = el('div', 'card');
    const a = el('a', '', x.root); a.href = `http://127.0.0.1:${x.port}/`;
    const m = el('div', 'meta');
    m.append(el('span', '', x.name ?? ''));
    if (x.kit) m.append(el('span', x.kit.endsWith('+local') ? 'badge inbox' : 'badge', x.kit));
    if (x.inbox === null || x.inbox === undefined) m.append(el('span', '', 'starting'));
    else {
      m.append(el('span', x.inbox > 0 ? 'inbox' : '', `${x.inbox} in the Inbox`));
      m.append(el('span', '', `${x.fleet.mode}, ${x.fleet.workers} session(s)`));
    }
    c.append(a, m);
    list.append(c);
  }
}
draw();
setInterval(draw, 10000);
</script></body></html>
```

- [ ] **Step 4: Implement `startHub`.** Add it before `cmdDashboard`:

```js
// The hub: every dashboard tries to serve 127.0.0.1:HUB_PORT; the one that gets it lists every
// instance in the block by asking each port /api/hello, and links to each one's own dashboard.
// It owns no state and takes no action: no POST, no proxy, its own Host only. The others retry,
// so it moves when its dashboard stops. Something else on the port: logged once, no retries.
function startHub(log) {
  const page = path.join(kitDir, 'dashboard', 'hub.html');
  const retry = Number(process.env.DEVTEAM_HUB_RETRY_MS ?? 30000);
  const okHost = (h) => [`127.0.0.1:${HUB_PORT}`, `localhost:${HUB_PORT}`].includes(h ?? '');
  const scan = async () => (await Promise.all(PORT_RANGE.map(async (p) => { const h = await probeHello(p); return h ? { ...h, port: p } : null; }))).filter(Boolean).sort((a, b) => String(a.root).localeCompare(String(b.root)));
  const tryListen = () => {
    const hub = http.createServer(async (req, res) => {
      const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body); };
      if (!okHost(req.headers.host)) return send(403, 'text/plain; charset=utf-8', 'the hub answers only on its own address');
      if (req.method !== 'GET') return send(405, 'text/plain; charset=utf-8', 'the hub only lists');
      if (req.url === '/') return send(200, 'text/html; charset=utf-8', fs.readFileSync(page));
      if (req.url === '/instances.json') return send(200, 'application/json', JSON.stringify({ hub: 1, instances: await scan() }));
      return send(404, 'text/plain; charset=utf-8', 'not found');
    });
    hub.once('error', async (e) => {
      if (e.code !== 'EADDRINUSE') { log(`hub: ${e.message}`); return; }
      const ours = await new Promise((resolve) => { const r = http.get({ host: '127.0.0.1', port: HUB_PORT, path: '/instances.json', timeout: 1000, headers: { host: `127.0.0.1:${HUB_PORT}` } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b)?.hub === 1); } catch { resolve(false); } }); }); r.on('timeout', () => { r.destroy(); resolve(false); }); r.on('error', () => resolve(false)); });
      if (ours) setTimeout(tryListen, retry).unref();
      else log(`hub: port ${HUB_PORT} is held by something that isn't a devteam hub; this dashboard won't serve the hub`);
    });
    hub.listen(HUB_PORT, '127.0.0.1', () => log(`hub on http://127.0.0.1:${HUB_PORT}`));
  };
  tryListen();
}
```

In `cmdDashboard`, in the `server.listen` callback, after the `out(...)` line, add `startHub(log);`.

- [ ] **Step 5: Run the hub test, then the full suite.** Expected: PASS. The existing tests' dashboards use the file-wide hub port 47320, so whichever starts first serves a test hub there. That's harmless, and they're killed at the end of each subtest.

- [ ] **Step 6: Commit.** Message: `The hub: 127.0.0.1:4320 lists every instance on the machine and links to each one's own dashboard`.

---

### Task 5: Docs and the kit's file list

**Files:**
- Modify: `README.md` (the file list, which grows from eleven to twelve files with `dashboard/hub.html`; "How it runs"; step 9's dashboard line; the "On the new machine" dashboard line)
- Modify: `docs/devteam/process/supervisor.md` (line 17, and §11's dashboard restart)
- Modify: the settings documentation where `tmux_session` and `dashboard_port` are described (`grep -rn "dashboard_port\|tmux_session" docs README.md`)

- [ ] **Step 1: Edit the docs.**
  - **README file list:** add `dashboard/hub.html   the machine's page listing every instance (served on 127.0.0.1:4320 by any dashboard)`, and change "Eleven files" to "Twelve files", with "one dashboard and its two helpers" becoming "one dashboard, its two helpers and the hub page".
  - **"How it runs":** add one paragraph: "**Many projects, one machine.** Each project has its own tmux session (`devteam-<project>`) and its own dashboard port, the next free one in 4321–4345. Any running dashboard also serves `http://127.0.0.1:4320`, which lists every instance on the machine (its repo root, kit version, Inbox count and fleet state) and links to each one's own dashboard."
  - **Dashboard restart commands** (step 9, "On the new machine", supervisor.md §11) become: `tmux new-window -d -t "$(node docs/devteam/scripts/devteam.mjs settings --get tmux_session)" -n dashboard 'node docs/devteam/scripts/devteam.mjs dashboard'`, and "open http://127.0.0.1:4320, or the address the dashboard prints".
  - **supervisor.md line 17:** "One tmux session (`settings --get tmux_session`: `devteam-<project>` unless set) holds the workers and planners…".

- [ ] **Step 2:** Run `grep -rn "4321\|-t devteam\b\|devteam:dashboard" README.md docs/devteam` and fix each remaining hard-coded `devteam` session or 4321 the reader would type.

- [ ] **Step 3: Run the full suite on Node 18.20.4, 20.19.6 and 24.14.1, one at a time.** Expected: all PASS. If one fails, read why before rerunning.

- [ ] **Step 4: Commit.** Message: `Docs: one tmux session and port per project, and the hub`.

---

### Task 6: PR, review, merge, release, adoption

- [ ] **Step 1:** Push `devteam-hub` and open the PR. The body has What, Why, Authority (the hub can't act for the owner: no POST, own Host only, links only), Migration (a running fleet keeps `devteam` and its port, saved on first use; new projects get their own; bookmark `http://127.0.0.1:4320`) and Tests. It ends with the Claude Code line.
- [ ] **Step 2:** Get a review from a fresh subagent that didn't write the code, run adversarially against the spec, the global constraints, and the upstream loop's authority checklist. Fix what it finds with commits on the branch.
- [ ] **Step 3:** Merge main into the branch. Once CI (18/20/22/24) is green, merge with `gh pr merge --merge --delete-branch`.
- [ ] **Step 4:** Release `v0.19.0` (minor: `tmux_session` and `dashboard_port` defaults change, so it needs a migration note) with What, Why and Migration.
- [ ] **Step 5:** Send the Stacks supervisor the adoption, as `chore-devteam-sync-v0.19.0`. Expected: Stacks resolves `devteam` (its workers' windows are there) and keeps 4321, and the hub appears at 127.0.0.1:4320. Verify read-only: `curl -s http://127.0.0.1:4320/instances.json` lists Stacks.
