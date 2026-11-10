// Fleet drain, and instances on one machine: dashboard ports, the hub, and init's checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PORTS, kit, freePort, write, json, fleetFixture, bareProject, startDashboard, until, statusWithHost, threadsFixture, hasTmux } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

test('fleet drain: in-flight work finishes, nothing new starts, and a drained fleet moves with parity', () => {
  const F = fleetFixture('drain');
  const { org, old, neu, run, ok, g, base } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const ID = 'ch-01-small';
  const WRK = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: ID };
  try {
    ok(old, ['ticket', 'add', ID, '--json', JSON.stringify({ title: 'small', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['small/**'], done_when: ['the small check passes'], notes: 'turns on small' })], SUP);
    ok(old, ['ticket', 'add', 'ch-02-later', '--json', JSON.stringify({ title: 'later', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['later/**'], done_when: ['the later check passes'], notes: 'turns on later' })], SUP);
    const ww = path.join(old, '.worktrees', ID);
    g(['worktree', 'add', '-q', '-b', `ticket/${ID}`, ww, 'origin/main'], old);
    ok(ww, ['phase', 'build', '--task', 'T1'], WRK);
    assert.match(ok(old, ['fleet', 'drain', '--reason', 'quiet week'], SUP), /draining the fleet \(f-\d{8}-\d{9}\): 1 goal\(s\) set to drain/);
    assert.equal(json(ok(old, ['messages', '--to', ID, '--json'])).length, 0, 'a drain tells running sessions nothing: they finish');
    const ready = json(ok(old, ['ready', '--json']));
    assert.deepEqual(ready.ready, [], 'nothing new is ready');
    assert.ok(ready.waiting.some((w) => w.id === 'ch-02-later' && w.why === 'goal draining'));
    assert.match(run(old, ['worker', 'ch-02-later'], SUP).err, /its goal is draining: a draining goal finishes what is running and starts nothing new/);
    assert.match(ok(old, ['goal', 'list']), /^upkeep \[draining: quiet week\] Upkeep/m);
    let st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.equal(st.fleet.mode, 'drain');
    assert.ok(st.blockers.some((b) => new RegExp(`${ID}: still running \\(phase build\\): a drain finishes in-flight work`).test(b)));
    // the ticket finishes (merged, as merge would put it on main)
    write(path.join(ww, 'small/a.txt'), 'a\n');
    g(['add', '-A'], ww);
    g(['commit', '-qm', `${ID}: small`], ww);
    g(['push', '-q', 'origin', `ticket/${ID}`], ww);
    g(['merge', '-q', '--no-ff', '-m', `Merge pull request #1 from x/ticket/${ID}`, `ticket/${ID}`], old);
    g(['push', '-q', 'origin', 'main'], old);
    ok(ww, ['phase', 'done'], WRK);
    g(['worktree', 'remove', '--force', ww], old);
    assert.match(ok(old, ['goal', 'list']), /^upkeep \[drained: quiet week\]/m, 'drained once nothing of it runs');
    F.land();
    ok(old, ['handoff', '--supervisor'], SUP, 'Nothing in flight. Next: run Upkeep again.\n');
    st = json(ok(old, ['fleet', 'status', '--json'], SUP));
    assert.deepEqual(st.blockers, []);
    assert.equal(st.ready, true, 'a drained fleet, nothing running, can move');
    const oldParity = st.parity.hash;
    g(['clone', '-q', org, neu], base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], neu);
    const up = ok(neu, ['fleet', 'undrain'], SUP);
    assert.equal(/parity: ([0-9a-f]{16})/.exec(up)?.[1], oldParity);
    assert.match(up, /undrained the fleet \(f-\d{8}-\d{9}\): Upkeep → run/);
    assert.deepEqual(json(ok(neu, ['ready', '--json'])).ready.map((r) => r.id), ['ch-02-later'], 'work starts again');
  } finally {
    F.done();
  }
});

test('dashboard ports: +1 from the highest instance, not the lowest free; a saved port reused; held ports skipped; pinned outside the block warned', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-ports-'));
  const P = PORTS + 31;
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(PORTS + 30), DEVTEAM_PORT_BASE: String(P) };
  const on = (d, port) => until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), `a dashboard on ${port}`);
  const blocker = net.createServer().listen(P + 1, '127.0.0.1');
  const running = [];
  const start = (r, args) => { const d = startDashboard(r, env, args); running.push(d); return d; };
  try {
    const [A, B, C] = ['alpha', 'beta', 'carol'].map((n) => bareProject(base, n));
    const a = start(A);
    await on(a, P);
    assert.equal(fs.readFileSync(path.join(A, 'docs/devteam/run/dashboard-port'), 'utf8').trim(), String(P));
    const b = start(B);
    await on(b, P + 2); // P+1 is held by something that isn't devteam
    await a.stop();
    const c = start(C);
    await on(c, P + 3); // one past the highest instance (beta), though P is the lowest free
    await b.stop();
    const b2 = start(B);
    await on(b2, P + 2); // its saved port, though P is the lowest free and P+4 is one past carol
    const pinned = start(A, ['--port', String(await freePort())]);
    await until(() => new RegExp(`outside ${P}-${P + 24}: the hub won't list it`).test(pinned.out()), 'the warning for a pinned port outside the block');
  } finally {
    for (const d of running) await d.stop();
    blocker.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('the hub: lists every instance on the machine, links to each one, moves when its dashboard stops, and does nothing else', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-hub-'));
  const HUB = PORTS + 60;
  const P = PORTS + 61;
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(P), DEVTEAM_HUB_RETRY_MS: '500' };
  const list = async () => { try { return (await (await fetch(`http://127.0.0.1:${HUB}/instances.json`)).json()).instances; } catch { return null; } };
  const A = bareProject(base, 'alpha');
  const B = bareProject(base, 'beta');
  for (const r of [A, B]) execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm init'], { cwd: r });
  fs.appendFileSync(path.join(B, 'docs/devteam/scripts/devteam.mjs'), '\n// a local change\n');
  const a = startDashboard(A, env);
  let b;
  try {
    await until(() => a.out().includes(`127.0.0.1:${P}`), "alpha's dashboard");
    b = startDashboard(B, env);
    const both = await until(async () => { const l = await list(); return l?.length === 2 && l.every((x) => x.inbox !== null) && l; }, 'both instances listed with counts');
    assert.deepEqual(both.map((x) => [x.name, x.port]), [['alpha', P], ['beta', P + 1]], 'beta took the port after alpha: +1');
    assert.doesNotMatch(both[0].kit, /\+local$/, "alpha runs the kit it committed");
    assert.match(both[1].kit, /\+local$/, "beta's edited kit shows");
    const page = await fetch(`http://127.0.0.1:${HUB}/`);
    assert.match(await page.text(), /instances\.json/, 'the page reads the list from its own hub');
    assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/, 'and can talk to nothing else');
    const csp = page.headers.get('content-security-policy');
    for (let p = P; p < P + 25; p++) assert.ok(csp.includes(`http://127.0.0.1:${p} `) || csp.includes(`http://127.0.0.1:${p};`), `the hub may frame ${p}`);
    assert.ok(!csp.includes(`http://127.0.0.1:${P + 25}`), 'and nothing outside the block');
    const dash = await fetch(`http://127.0.0.1:${P}/`);
    assert.ok(dash.headers.get('content-security-policy').split('; ').includes(`frame-ancestors 'self' http://127.0.0.1:${HUB}`), 'only the dashboard itself and the hub, at its one address, can frame a dashboard');
    // the hub has one address: localhost (which may be ::1, held by something else) is sent to 127.0.0.1
    const viaLocalhost = await new Promise((resolve, reject) => { const r = http.request({ host: '127.0.0.1', port: HUB, path: '/#beta', headers: { host: `localhost:${HUB}` } }, (res) => { res.resume(); resolve([res.statusCode, res.headers.location]); }); r.on('error', reject); r.end(); });
    assert.deepEqual(viaLocalhost, [302, `http://127.0.0.1:${HUB}/#beta`]);
    const page2 = await (await fetch(`http://127.0.0.1:${HUB}/`)).text();
    assert.match(page2, /id="tabs"/, 'the page is a tab bar');
    // idle connections stay open longer than any client reuses one (Node 18's fetch: about 4 s)
    assert.match(page.headers.get('keep-alive') ?? '', /timeout=65/, "the hub's");
    assert.match((await fetch(`http://127.0.0.1:${P}/api/hello`)).headers.get('keep-alive') ?? '', /timeout=65/, "and a dashboard's");
    assert.equal(await statusWithHost(HUB, '/instances.json', 'rebound.example'), 403, 'its own Host only');
    assert.equal(await statusWithHost(HUB, '/instances.json', `127.0.0.1:${HUB}`, 'POST'), 405, 'it only lists');
    assert.equal(await statusWithHost(HUB, '/instances.json', `127.0.0.1:${HUB}`, 'GET', { 'sec-fetch-site': 'cross-site' }), 403, "another site's page can't make it probe");
    assert.equal(await statusWithHost(HUB, '/', `127.0.0.1:${HUB}`, 'GET', { 'sec-fetch-site': 'cross-site' }), 200, 'the page itself opens from a link anywhere');
    await a.stop();
    const after = await until(async () => { const l = await list(); return l?.length === 1 && l; }, 'the hub, after alpha stops');
    assert.deepEqual(after.map((x) => x.name), ['beta'], 'whichever dashboard is left serves the hub and lists what is left');
    await b.stop();
    // something that isn't a devteam hub holds the port: the dashboard says so once and stays out of it
    const squatter = http.createServer((req, res) => res.end('hello')).listen(HUB, '127.0.0.1');
    try {
      const c = startDashboard(A, env);
      try {
        await until(() => fs.existsSync(path.join(A, 'docs/devteam/run/dashboard.log')) && /isn't a devteam hub/.test(fs.readFileSync(path.join(A, 'docs/devteam/run/dashboard.log'), 'utf8')), 'the dashboard noting the squatter');
      } finally { await c.stop(); }
    } finally { squatter.close(); }
  } finally {
    await a.stop();
    if (b) await b.stop();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('init: from the main checkout only; main is the remote default branch, never the branch you are on; no placeholders the merge refuses', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-init-'));
  const g = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const run = (cwd, args) => spawnSync(process.execPath, [path.join(cwd, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd, encoding: 'utf8' });
  try {
    // a remote whose default branch is trunk, a repo made with git init (no origin/HEAD), on a feature branch
    const org = path.join(base, 'origin.git');
    g(['init', '-q', '--bare', '-b', 'trunk', org], base);
    const r = path.join(base, 'repo');
    fs.mkdirSync(r);
    g(['init', '-q', '-b', 'trunk'], r);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], r);
    g(['remote', 'add', 'origin', org], r);
    fs.writeFileSync(path.join(r, 'README.md'), 'x\n');
    g(['add', '-A'], r);
    g(['commit', '-qm', 'first'], r);
    g(['push', '-q', 'origin', 'trunk'], r);
    g(['checkout', '-q', '-b', 'feature/adopt-devteam'], r);
    fs.cpSync(kit, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
    // from a worktree: refused, nothing written anywhere
    g(['add', '-A'], r);
    g(['commit', '-qm', 'kit'], r);
    const w = path.join(base, 'wt');
    g(['worktree', 'add', '-q', '--detach', w, 'HEAD'], r);
    const fromWt = run(w, ['init', '--name', 'demo']);
    assert.notEqual(fromWt.status, 0);
    assert.match(fromWt.stderr, /run init from the main checkout/);
    assert.ok(!fs.existsSync(path.join(r, 'AGENTS.md')) && !fs.existsSync(path.join(w, 'docs/devteam/project')), 'nothing written');
    // from the main checkout
    const ok = run(r, ['init', '--name', 'demo']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(fs.readFileSync(path.join(r, 'docs/devteam/project/settings.md'), 'utf8'), /"main_branch": "trunk"/, "the remote's default, not feature/adopt-devteam");
    for (const d of ['log', 'tickets']) assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/project', d, '.gitkeep')), `no ${d}/.gitkeep: merge refuses it`);
    // the strategy's template, for the supervisor to draft with the owner; a second init leaves a written one alone
    const strategy = path.join(r, 'docs/devteam/project/strategy.md');
    assert.match(ok.stdout, /docs\/devteam\/project\/strategy\.md/);
    assert.match(fs.readFileSync(strategy, 'utf8'), /^# Strategy\n[\s\S]*## How it wins, in order\n/);
    fs.writeFileSync(strategy, '# Strategy\n\nOurs.\n');
    assert.equal(run(r, ['init', '--name', 'demo']).status, 0);
    assert.equal(fs.readFileSync(strategy, 'utf8'), '# Strategy\n\nOurs.\n');
    assert.ok(!fs.existsSync(path.join(r, '.github/workflows/devteam.yml')), 'no forge workflow');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('the Library shows each landed artifact\'s publish state, from the log and the gateway\'s header', () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* public-states start */'), html.indexOf('/* public-states end */'));
  assert.ok(src.length > 200, 'the publish-state block is marked in index.html');
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\n;globalThis.api = { publicHere, publicState, publicLinks };`, ctx);
  const { publicHere, publicState, publicLinks } = ctx.api;
  const lib = { public: { project: 'alpha', root: '/srv/alpha' } };
  const me = publicHere({ protocol: 'https:', host: '4321.box.example.com' }, lib);
  assert.deepEqual({ ...me }, { proto: 'https:', port: 4321, box: 'box.example.com', project: 'alpha', root: '/srv/alpha' });
  assert.equal(publicHere({ protocol: 'http:', host: '127.0.0.1:4321' }, lib), null, 'a laptop');
  assert.equal(publicHere({ protocol: 'http:', host: 'localhost:4321' }, lib), null);
  const T = 'a'.repeat(40);
  const U = 'b'.repeat(40);
  const rec = { tree: T, at: '2026-11-09T10:00:00.000Z', channel: 'dashboard' };
  const art = (published) => ({ slug: 'hello', tree: T, published });
  const serving = (tree, port = 4321, root = '/srv/alpha') => ({ alpha: { port, root, artifacts: tree ? { hello: tree } : {} } });
  const S = (a, pub, at = me) => { const s = publicState(a, pub, at); return [s.state, [...s.actions], s.from]; };
  // the spec's table, row by row
  assert.deepEqual(S(art(null), serving(null)), ['none', ['publish'], null]);
  assert.deepEqual(S(art(rec), serving(T)), ['public', ['copy', 'unpublish'], null]);
  assert.deepEqual(S(art(rec), serving(U)), ['public', ['update', 'copy', 'unpublish'], null]);
  assert.deepEqual(S(art(rec), serving(null)), ['not-live', ['restore', 'forget'], null]);
  assert.deepEqual(S(art(null), serving(T)), ['public', ['unpublish'], null], 'the gateway is the truth');
  assert.deepEqual(S(art(rec), serving(T, 4322)), ['public', ['copy', 'unpublish'], 4322], 'public from another instance');
  assert.deepEqual(S(art(rec), serving(T, 4321, '/srv/other')), ['not-live', ['restore', 'forget'], null], 'another checkout of the name is not this one');
  assert.deepEqual(S(art(rec), {}), ['not-live', ['restore', 'forget'], null]);
  assert.deepEqual(S(art(rec), null, null), ['published', [], null], 'a laptop says what the log says, and offers nothing');
  assert.deepEqual(S(art(null), null, null), ['none', [], null]);
  assert.deepEqual(S(art(null), serving(null), { ...me, project: null }), ['none', [], null], 'no project name, no publishing');
  assert.equal(publicState(art(rec), serving(null), me).rec.channel, 'dashboard', 'the card shows the line\'s channel');
  // main has moved since the record: never offered as a Restore, and the card says so
  const moved = (published) => ({ slug: 'hello', tree: U, published });
  assert.deepEqual(S(moved(rec), serving(null)), ['not-live', ['review', 'forget'], null]);
  assert.equal(publicState(moved(rec), serving(null), me).drift, true);
  assert.equal(publicState(art(rec), serving(null), me).drift, false);
  assert.equal(publicState(moved(rec), null, null).drift, true, 'a laptop can say it too');
  assert.equal(publicState(moved(rec), serving(T), me).drift, true, 'public, and main has moved on');
  assert.equal(publicState(moved(null), serving(null), me).drift, false, 'no record, nothing to differ from');
  const L = publicLinks(me);
  assert.equal(L.publish(['a', 'b']), 'https://box.example.com/public/publish?port=4321&slug=a&slug=b');
  assert.equal(L.unpublish('a'), 'https://box.example.com/public/unpublish?port=4321&project=alpha&slug=a');
  assert.equal(L.page('a'), 'https://public.box.example.com/alpha/a/');
  // the page reads the header, opens the gateway's pages in a tab it can't steer, and Forget records through the kit
  assert.match(html, /PUBLIC = JSON\.parse\(r\.headers\.get\('x-devteam-public'\)/);
  assert.match(html, /target="_blank" rel="noopener noreferrer">\$\{label\}<\/a>/);
  assert.match(html, /post\('artifact-publish', \{ op: 'unpublish', slug \}/);
  assert.match(html, /Restore all/);
  assert.match(html, /Review all/);
  assert.match(html, /Changed on main since it was published/);
  assert.match(html, /Publishing happens on the cloud box/);
});

test('the Library lists previews with the link for where the page is', () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* preview-cards start */'), html.indexOf('/* preview-cards end */'));
  assert.ok(src.length > 200, 'the preview-cards block is marked in index.html');
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\n;globalThis.api = { previewHere, previewUrl, previewState };`, ctx);
  const { previewHere, previewUrl, previewState } = ctx.api;
  const box = { protocol: 'https:', host: '4321.box.example.com' };
  const me = previewHere(box, true);
  assert.deepEqual({ ...me }, { proto: 'https:', box: 'box.example.com' });
  assert.equal(previewHere({ protocol: 'http:', host: '127.0.0.1:4321' }, true), null, 'a laptop');
  assert.equal(previewHere(box, false), null, 'a box whose gateway has no previews header');
  assert.equal(previewHere({ protocol: 'https:', host: 'box.example.com' }, true), null, 'not an instance name');
  assert.equal(previewUrl(me, { name: 'cool-tiger', port: 5173 }), 'https://cool-tiger.box.example.com/');
  assert.equal(previewUrl(null, { name: 'cool-tiger', port: 5173 }), 'http://127.0.0.1:5173/');
  assert.equal(previewUrl(previewHere({ protocol: 'http:', host: '4321.box.localhost:8123' }, true), { name: 'cool-tiger', port: 5173 }), 'http://cool-tiger.box.localhost:8123/', 'a local gateway keeps its port');
  const now = Date.parse('2026-11-10T12:00:00Z');
  const future = '2026-11-12T00:00:00Z';
  const S = (p) => { const r = previewState({ expires: future, ...p }, now); return [r.state, [...r.actions]]; };
  // the spec's table, row by row
  assert.deepEqual(S({ up: null }), ['checking', ['open', 'copy', 'stop']]);
  assert.deepEqual(S({ up: true }), ['live', ['open', 'copy', 'stop']]);
  assert.deepEqual(S({ up: true, run: true }), ['live', ['open', 'copy', 'stop']]);
  assert.deepEqual(S({ up: false, run: true }), ['not-running', ['start', 'open', 'stop']]);
  assert.deepEqual(S({ up: false, run: false }), ['not-answering', ['open', 'stop']]);
  assert.equal(previewState({ up: false, run: false, expires: future, down_since: '2026-11-10T11:00:00Z' }, now).since, '2026-11-10T11:00:00Z');
  assert.deepEqual(S({ up: true, expires: '2026-11-01T00:00:00Z' }), ['expired', ['stop']]);
  assert.deepEqual(S({ up: false, run: true, expires: '2026-11-01T00:00:00Z' }), ['expired', ['stop']]);
});

test('a question links a preview: the link for this page, with its state, and nothing to open when it is gone', () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* preview-cards start */'), html.indexOf('/* preview-cards end */'));
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\n;globalThis.api = { previewHere, previewLinkHtml };`, ctx);
  const { previewHere, previewLinkHtml } = ctx.api;
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const me = previewHere({ protocol: 'https:', host: '4321.box.example.com' }, true);
  const row = (state, port = 5173) => ({ preview: 'cool-tiger', title: 'The <b>flow</b>', port, state });
  const live = previewLinkHtml(row('live'), me, esc);
  assert.match(live, /<a href="https:\/\/cool-tiger\.box\.example\.com\/" target="_blank" rel="noopener noreferrer">The &lt;b&gt;flow&lt;\/b&gt;<\/a>/);
  assert.match(live, /live/);
  assert.match(previewLinkHtml(row('live'), null, esc), /href="http:\/\/127\.0\.0\.1:5173\/"/);
  assert.match(previewLinkHtml(row('down'), me, esc), /not answering/);
  assert.match(previewLinkHtml(row('checking'), me, esc), /checking/);
  const gone = previewLinkHtml(row('gone', null), me, esc);
  assert.doesNotMatch(gone, /<a /);
  assert.match(gone, /no longer offered/);
});

// The page polls every 10s here; the fixture polls every 300ms, and a test can stop /api/data
// answering to catch a refresh in flight (the fetch outlasts the moment focus arrives).
const POLL_FAST = `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  const rf = window.fetch;
  window.__polls = 0;
  window.__gate = null;
  window.__answerHold = null;
  window.fetch = async (u, o) => {
    if (String(u).startsWith('/api/data')) { window.__polls++; if (window.__gate) await window.__gate; return rf(u, o); }
    if (String(u).startsWith('/api/answer') && window.__answerHold) await window.__answerHold;
    // a test can let the next /api/threads read through but hold its answer back: read now, landing later
    // and can slow every /api/threads answer, as a loaded box would
    if (String(u).startsWith('/api/threads') && window.__threadsDelay) await new Promise((r) => setTimeout(r, window.__threadsDelay));
    if (String(u).startsWith('/api/threads') && window.__threadsHold) { const h = window.__threadsHold; window.__threadsHold = null; const r = await rf(u, o); window.__threadsRead = true; await h; setTimeout(() => { window.__threadsLanded = true; }, 0); return r; }
    return rf(u, o);
  };
})()`;

test('typing in the dashboard: a refresh never takes the field, the caret or the scroll, and holding it can\'t wedge', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-focus-'));
  // in t.after, each as it starts: they run on a failure and a timeout, where a finally may never be reached
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(PORTS + 80), DEVTEAM_PORT_BASE: String(PORTS + 81), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN', 'TMUX', 'TMUX_PANE']) delete env[k];
  const root = bareProject(base, 'focus');
  const ask = (q, ...more) => {
    const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'ask', '--question', q, ...more], { cwd: root, env: { ...env, DEVTEAM_ROLE: 'supervisor' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const Q = ask('Which way?', '--choices', '[{"label":"Left"},{"label":"Right"}]');
  for (let i = 0; i < 12; i++) ask(`Filler ${i}?`); // enough cards that the page scrolls
  const port = await freePort();
  const dash = startDashboard(root, env, ['--port', String(port)]);
  t.after(() => dash.stop());
  const chrome = await openChrome();
  t.after(() => chrome.close());
  const p = await chrome.newPage();
  t.after(() => p.close());
  {
    await until(() => /dashboard on http/.test(dash.out()), 'the dashboard');
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 600, deviceScaleFactor: 1, mobile: false });
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
    await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#questions` });
    const box = `textarea[data-q="${Q}"]`;
    const soon = async (expr, what) => { for (let i = 0; i < 300; i++) { const v = await p.ev(expr); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`timed out: ${what}`); };
    await soon(`!!document.querySelector('${box}')`, 'the question card');
    // Answered by polls actually arriving, however long /api/data takes.
    const polls = async (n = 2) => { const at = await p.ev('window.__polls'); await soon(`window.__polls >= ${at + n}`, `${n} polls`); };
    // jumped: a space on the page scrolls most of a screen; a pixel or two is a caret coming into view
    const state = (y) => p.ev(`(() => { const a = document.activeElement, t = document.querySelector('${box}'); return { value: t.value, focus: a === t, start: t.selectionStart, end: t.selectionEnd, jumped: Math.abs(window.scrollY - ${y ?? 'window.scrollY'}) > 20 }; })()`);
    const wrote = (v) => ({ value: v, focus: true, start: v.length, end: v.length, jumped: false });
    // A new question lands in the log: the tab title says so at once, the cards wait.
    const newQuestion = async (q) => {
      const n = await p.ev(`Number((document.title.match(/\\((\\d+)\\)/) || [])[1])`);
      ask(q);
      await soon(`document.title.startsWith('(${n + 1})')`, `the title to count ${q}`);
    };

    await t.test('a refresh already in flight when you click in and type', async () => {
      await p.ev('void (window.__gate = new Promise((r) => { window.__open = r; }))'); // void: evaluating a promise would wait for it
      await polls(1);
      await p.click(box);
      const y = await p.ev('window.scrollY');
      assert.ok(y > 0, 'the fixture page scrolls');
      await p.type('hello');
      await p.ev('window.__open(); window.__gate = null; window.__t = document.querySelector(\'' + box + '\')');
      await polls();
      assert.deepEqual(await state(y), wrote('hello'), 'still in the field after the refresh lands');
      assert.equal(await p.ev('window.__t.isConnected'), true, 'the same field, not a redrawn one');
      await p.type(' world');
      assert.deepEqual(await state(y), wrote('hello world'), 'space typed, not scrolled');
    });

    await t.test('the caret and a selection stay where they were', async () => {
      const y = await p.ev('window.scrollY');
      for (let i = 0; i < 5; i++) await p.key('ArrowLeft');
      await p.type('X');
      await polls();
      assert.deepEqual(await state(y), { value: 'hello Xworld', focus: true, start: 7, end: 7, jumped: false });
      await p.key('ArrowRight', 8);
      await p.key('ArrowRight', 8);
      await polls();
      assert.deepEqual(await state(y), { value: 'hello Xworld', focus: true, start: 7, end: 9, jumped: false });
      for (let i = 0; i < 5; i++) await p.key('ArrowRight');
    });

    await t.test('while typing the title and the Inbox count stay fresh, the cards wait; focus leaving draws them', async () => {
      const q = 'Arrived while you typed?';
      await newQuestion(q);
      assert.equal(await p.ev(`document.querySelector('#questions').textContent.includes(${JSON.stringify(q)})`), false, 'not drawn under the typing');
      assert.equal(await p.ev(`document.getElementById('n-questions').textContent === document.title.match(/\\((\\d+)\\)/)[1]`), true, 'the Inbox count');
      await p.key('Tab');
      await soon(`document.querySelector('#questions').textContent.includes(${JSON.stringify(q)})`, 'the held data, once focus left');
      assert.equal(await p.ev(`document.querySelector('${box}').value`), 'hello Xworld', 'the draft survives the redraw');
      assert.notEqual(await p.ev('document.activeElement.tagName'), 'BODY', 'Tab lands on a control, and the redraw leaves it there');
    });

    await t.test('held for a long time: a hint, and clicking it draws without losing the field or the caret', async () => {
      const y = await p.click(box).then(() => p.ev('window.scrollY'));
      const q = 'Urgent while you were idle?';
      await newQuestion(q);
      assert.equal(await p.ev(`getComputedStyle($('held')).display`), 'none', 'no hint while typing normally');
      await p.ev('(() => { const n = Date.now; Date.now = () => n() + 300000; })()');
      await soon(`!$('held').hidden`, 'the hint');
      await p.click('#held');
      await soon(`document.querySelector('#questions').textContent.includes(${JSON.stringify(q)})`, 'the held data after the hint');
      assert.equal(await p.ev(`$('held').hidden`), true, 'the hint goes once drawn');
      const s = await state();
      assert.equal(s.value, 'hello Xworld');
      assert.equal(s.focus, true, 'still in the field');
      assert.equal(s.start, 12, 'caret kept');
      await p.type('Z');
      assert.equal((await state()).value, 'hello XworldZ');
      assert.equal((await state(y)).jumped, false, 'and the page stayed put');
    });

    await t.test('an IME composition is not drawn over', async () => {
      await p.send('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 });
      await newQuestion('Mid composition?');
      await polls();
      const v = await p.ev(`document.querySelector('${box}').value`);
      assert.match(v, /かな$/, 'the composition is still there');
      await p.send('Input.insertText', { text: 'かな' });
      assert.match(await p.ev(`document.querySelector('${box}').value`), /Zかな$/);
      assert.equal(await p.ev('document.activeElement.tagName'), 'TEXTAREA');
    });

    await t.test('a radio in the card still picks with a draft and held data, and a space after it doesn\'t scroll', async () => {
      await newQuestion('Before the radio?');
      await p.click(`input[data-pick="${Q}"][value="Right"]`);
      await soon(`document.querySelector('#questions').textContent.includes('Before the radio?')`, 'the redraw after the click');
      assert.equal(await p.ev(`document.querySelector('input[data-pick="${Q}"][value="Right"]').checked`), true, 'the pick took');
      assert.equal(await p.ev(`document.activeElement.dataset.pick`), Q, 'focus is back on the radio, not on the page');
      const y = await p.ev('window.scrollY');
      await p.key(' ');
      await new Promise((r) => setTimeout(r, 300));
      assert.equal((await state(y)).jumped, false, 'space on the radio does not scroll');
      assert.match(await p.ev(`document.querySelector('${box}').value`), /Zかな$/, 'draft intact');
    });

    await t.test('a control that keeps focus without typing doesn\'t stop the page refreshing', async () => {
      await p.click('#left-only');
      const q = 'After the checkbox?';
      ask(q);
      await soon(`document.querySelector('#questions').textContent.includes(${JSON.stringify(q)})`, 'a redraw with a checkbox focused');
      await p.click('#left-only'); // leave the setting as it was
      await p.ev(`document.activeElement.blur()`);
    });

    await t.test('an open select is left alone, and a list closed without a choice can\'t stop the refreshing', async () => {
      await p.ev(`window.__o = $('view').options[0]`);
      await p.click('#view');
      await polls();
      assert.equal(await p.ev(`window.__o.isConnected`), true, 'its options are not redrawn');
      await p.key('Escape');
      await p.ev('(() => { const n = Date.now; Date.now = () => n() + 120000; })()');
      await soon(`!window.__o.isConnected`, 'the page drawing again, no change event to say so');
      await p.ev(`document.activeElement.blur()`);
    });

    await t.test('Answer still works with a draft and held data, and isn\'t redrawn while it posts', async () => {
      await p.click(box);
      await newQuestion('Before the answer?');
      // held by the test, not by a clock: on a loaded runner the polls below can outlast any fixed delay
      await p.ev('window.__answerHold = new Promise((r) => { window.__answerGo = r; }); void 0');
      await p.click(`button[data-answer="${Q}"]`);
      await soon(`document.querySelector('button[data-answer="${Q}"]')?.textContent === 'Posting…'`, 'the button posting');
      await polls();
      assert.equal(await p.ev(`document.querySelector('button[data-answer="${Q}"]')?.getAttribute('aria-busy')`), 'true', 'not redrawn mid-post');
      await p.ev('window.__answerGo(); void 0');
      await soon(`!document.querySelector('${box}')`, 'the card answered and gone');
      const listed = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'questions', '--all', '--json'], { cwd: root, env, encoding: 'utf8' });
      assert.equal(JSON.parse(listed.stdout).find((x) => x.id === Q)?.status, 'answered', listed.stderr);
    });
  }
});

test('the dashboard and hub pages parse: one stray quote and nothing shows at all', () => {
  for (const page of ['index.html', 'hub.html']) {
    const html = fs.readFileSync(path.join(kit, 'dashboard', page), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 1, page);
    for (const s of scripts) new vm.Script(s, { filename: page });
  }
});

test("threads on the dashboard's server: owner actions checked before anything runs, /api/threads read from the log's files, cached, same-origin only", async (t) => {
  const F = threadsFixture('threads-api');
  t.after(() => F.done());
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({}), ['--port', String(port)]);
  t.after(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const post = (name, body, headers = {}) => fetch(`${B}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'sec-fetch-site': 'same-origin', ...headers }, body: JSON.stringify(body) });
  const get = (headers = {}) => fetch(`${B}/api/threads`, { headers });
  const list = async () => (await (await get()).json()).threads;
  const subject = { kind: 'item', ref: `goal:${F.goal}`, quote: 'Launch checkout' };

  // the dashboard's own first runs (hello, dashboard-data, the accounts tick) can write to run/ as it
  // starts: read once it has served data, and of a run of reads with nothing written one is cached
  await until(async () => (await fetch(`${B}/api/data`)).ok, 'a first dashboard-data');
  let r = await get();
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.deepEqual([j.threads, j.supervisor], [[], { pane: false }], 'no threads, and no supervisor pane');
  const heads = [];
  for (let i = 0; i < 3; i++) heads.push((await get()).headers.get('x-devteam-threads'));
  assert.ok(heads.includes('cached'), `a read with no file changed is served from the cache: ${heads}`);
  r = await post('thread-new', { title: 'Launch checkout', subject, text: 'Narrow this to the EU launch' });
  assert.equal(r.status, 200, await r.clone().text());
  const T = (await r.json()).out.split('\n')[0];
  assert.match(T, /^t-\d{8}-\d{9}-owner$/);
  r = await get();
  assert.equal(r.headers.get('x-devteam-threads'), null, 'a changed file is read again');
  let th = (await r.json()).threads.find((x) => x.id === T);
  assert.deepEqual([th.title, th.subject, th.waiting, th.turns.length], ['Launch checkout', subject, 'supervisor', 1]);
  assert.equal(JSON.parse(F.owner(['log', '--id', th.turns[0].id, '--json']))[0].channel, 'dashboard', "the owner's, from the dashboard");
  // a line another process appends is there at the next read
  F.sup(['thread', 'say', T, 'On it.']);
  th = (await list()).find((x) => x.id === T);
  assert.deepEqual([th.turns.length, th.turns[1].by, th.waiting], [2, 'supervisor', 'owner']);
  // a GET carries no Origin: same-origin only, as /public-manifest/ is, and only on its own Host
  for (const site of ['cross-site', 'same-site']) assert.equal((await get({ 'sec-fetch-site': site })).status, 403, site);
  assert.equal((await get({ 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal(await statusWithHost(port, '/api/threads', `rebound.example:${port}`), 403);
  // bad bodies and bad subjects are refused before anything is spawned
  const bad = [
    ['thread-new', { subject, text: 'x' }, 'no title'],
    ['thread-new', { title: 'two\nlines', text: 'x' }, 'a title of two lines'],
    ['thread-new', { title: 'a'.repeat(121), text: 'x' }, 'a title over 120 characters'],
    ['thread-new', { title: 't', text: ' ' }, 'no words'],
    ['thread-new', { title: 't', text: 'é'.repeat(1001) }, 'a turn over 2,000 bytes'],
    ['thread-new', { title: 't', text: '"'.repeat(1950) }, 'a turn over 3,800 bytes as the log holds it'],
    ['thread-new', { title: 't', text: 'x', subject: { kind: 'artifact', slug: 'pricing-mock', at: 'main' } }, 'an artifact subject: the viewers come later'],
    ['thread-new', { title: 't', text: 'x', subject: { kind: 'lens' } }, 'an unknown kind'],
    ['thread-new', { title: 't', text: 'x', subject: { ...subject, view: '#goals' } }, "another kind's key"],
    ['thread-new', { title: 't', text: 'x', subject: { kind: 'item', ref: `goal:${F.goal}`, quote: 'q'.repeat(2600) } }, 'a subject over 2,500 bytes'],
    ['thread-new', { title: 't', text: 'x', subject: { kind: 'item', ref: 'secret:x' } }, 'a ref of no known type'],
    ['thread-say', { id: 'nope', text: 'x' }, 'not a thread id'],
    ['thread-say', { id: T }, 'no words'],
    ['thread-resolve', { id: T, outcome: 'two\nlines' }, 'an outcome of two lines'],
    ['thread-accept', { id: 'q-20261110-101500123-supervisor' }, 'a question id'],
    ['thread-say', { id: [T], text: 'x' }, 'an id sent as a one-element array'],
    ['thread-resolve', { id: [T] }, 'a resolve id sent as an array'],
    ['thread-accept', { id: [T] }, 'an accept id sent as an array'],
  ];
  const n = (await list()).length;
  const turnsOf = async () => (await list()).find((x) => x.id === T).turns;
  const before = (await turnsOf()).length;
  for (const [name, body, why] of bad) assert.equal((await post(name, body)).status, 400, why);
  assert.equal((await list()).length, n, 'nothing was written');
  assert.equal((await turnsOf()).length, before, 'no stray turn was written to the thread');
  // words and titles that look like flags arrive as words, verbatim
  assert.equal((await post('thread-say', { id: T, text: '--accept' })).status, 200);
  assert.equal((await turnsOf()).at(-1).text, '--accept', 'a turn that is a flag is stored as sent');
  assert.equal((await turnsOf()).length, before + 1);
  const flagTitle = '--subject={"kind":"page"}';
  r = await post('thread-new', { title: flagTitle, text: 'x' });
  assert.equal(r.status, 200, await r.clone().text());
  const T2 = (await r.json()).out.split('\n')[0];
  th = (await list()).find((x) => x.id === T2);
  assert.deepEqual([th.title, th.subject ?? null], [flagTitle, null], 'a title that looks like a flag is a title, and sets no subject');
  assert.equal((await post('thread-resolve', { id: T2 })).status, 200);
  assert.equal((await post('thread-say', { id: T, text: 'x' }, { origin: 'https://evil.example' })).status, 403, 'another origin');
  // resolve, a turn on a resolved thread, reopen, a proposal accepted
  assert.equal((await post('thread-accept', { id: T })).status, 400, 'no proposal to accept');
  assert.equal((await post('thread-resolve', { id: T, outcome: 'Narrowed to the EU' })).status, 200);
  r = await post('thread-say', { id: T, text: 'one more thing' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /reopen it first/);
  assert.equal((await post('thread-reopen', { id: T, text: 'One more thing' })).status, 200);
  F.sup(['thread', 'ready', T, '--outcome', 'EU only']);
  assert.equal((await post('thread-accept', { id: T })).status, 200);
  th = (await list()).find((x) => x.id === T);
  assert.deepEqual([th.status, th.outcome], ['resolved', 'EU only']);
  // a supervisor with a pane: said within the 10 s the answer is kept
  if (hasTmux) {
    const pane = F.standIn();
    fs.writeFileSync(path.join(F.old, 'docs/devteam/run/supervisor-pane'), pane.target);
    await until(async () => (await (await get()).json()).supervisor.pane === true, 'the pane seen');
  }
  // after a move run/log is empty until each file's next write: the checkout's project/log copy counts
  const durable = path.join(F.old, 'docs/devteam/project/log');
  fs.mkdirSync(durable, { recursive: true });
  const ownerFile = fs.readdirSync(F.logDir).find((f) => f.startsWith('owner-'));
  const kept = fs.readFileSync(path.join(F.logDir, ownerFile));
  fs.copyFileSync(path.join(F.logDir, ownerFile), path.join(durable, ownerFile));
  fs.rmSync(path.join(F.logDir, ownerFile));
  try { assert.ok((await list()).some((x) => x.id === T), 'read from project/log'); } finally { fs.writeFileSync(path.join(F.logDir, ownerFile), kept); fs.rmSync(path.join(durable, ownerFile)); }
});

test('every item the dashboard draws says what it is; a question asked in a thread links to it; an answer from a thread says so', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  for (const type of ['goal', 'question', 'ticket', 'planner', 'observation', 'problem', 'lesson', 'act', 'preview', 'artifact']) assert.match(html, new RegExp(`subj\\('${type}'`), `the ${type} renderer marks its item`);
  assert.match(html, /subj\(decSubject\(r\)/, 'and the Decide feed, by kind');
  const F = threadsFixture('threads-items');
  t.after(() => F.done());
  const T = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]).split('\n')[0];
  const Q = F.sup(['thread', 'ask', T, '--question', 'Narrow the goal to EU orders?', '--goal', F.goal, '--stake', '2', '--urgency', '1']);
  const Qa = F.sup(['thread', 'ask', T, '--question', 'Keep the US for later?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  const U = F.owner(['thread', 'say', T, 'yes, keep the US for later']).split('\n')[0];
  F.sup(['answer', Qa, 'yes', '--from-turn', U]);
  const O = F.sup(['observe', '--subject', F.goal, '--kind', 'slow-test', '--detail', 'the checkout test is slow']);
  const port = await freePort();
  const dash = startDashboard(F.old, F.env({}), ['--port', String(port)]);
  t.after(() => dash.stop());
  const chrome = await openChrome();
  t.after(() => chrome.close());
  const p = await chrome.newPage();
  t.after(() => p.close());
  await until(() => /dashboard on http/.test(dash.out()), 'the dashboard');
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#inbox` });
  const soon = async (expr, what) => { for (let i = 0; i < 400; i++) { const v = await p.ev(expr); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`timed out: ${what}`); };
  await soon(`!!document.querySelector('#questions [data-subject="question:${Q}"]')`, 'the Inbox card');
  const titleOf = (sel) => p.ev(`document.querySelector(${JSON.stringify(sel)})?.dataset.title ?? null`);
  assert.equal(await titleOf(`#goals-list [data-subject="goal:${F.goal}"]`), 'Launch checkout');
  assert.equal(await titleOf(`#questions [data-subject="question:${Q}"]`), 'Narrow the goal to EU orders?');
  assert.equal(await titleOf(`#answered [data-subject="question:${Qa}"]`), 'Keep the US for later?');
  assert.ok(await titleOf(`#observations [data-subject="observation:${O}"]`));
  assert.equal(await p.ev(`document.querySelector('#questions [data-subject="question:${Q}"]').id`), `q-${Q}`, 'the Inbox copy keeps its id');
  assert.equal(await p.ev(`document.querySelector('#q-${Q}').dataset.qcard`), Q);
  assert.deepEqual(await p.ev(`(() => { const a = document.querySelector('#q-${Q} .from-thread a'); return a && [a.getAttribute('href'), a.textContent]; })()`), [`#talk/${T}`, 'Launch checkout']);
  assert.match(await p.ev(`document.querySelector('#answered [data-subject="question:${Qa}"]').textContent`), /You said: “yes, keep the US for later”[\s\S]*answered in a thread/);
});

test("the thread layer's rules: what the pointer is on, a subject that fits, where a card opens, its state, the pins and the dock's words", () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* threads-core start */'), html.indexOf('/* threads-core end */'));
  assert.ok(src.length > 500, 'the threads-core block is marked in index.html');
  const ctx = vm.createContext({ TextEncoder });
  vm.runInContext(`${src}\n;globalThis.api = { T_TYPES, T_REF, T_REF_MAX, T_KIND, T_HOME, T_WAIT_MS, T_TURN_MAX, T_ENCODED_MAX, T_SUBJECT_MAX, T_TITLE_MAX, tBytes, tCut, tLine, tSubjectAt, tFit, tCardState, tPlace, tWhere, tPins, tUnread };`, ctx);
  const A = ctx.api;
  const plain = (x) => JSON.parse(JSON.stringify(x));
  // the page and the kit name the same things, and the page sends no ref the log refuses
  const kitSrc = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
  const kitLine = (name) => new RegExp(`^const ${name} = .*$`, 'm').exec(kitSrc)[0];
  const kitNames = ['SUBJECT_TYPES', 'SUBJECT_REF', 'SUBJECT_CAPS', 'THREAD_WAIT_MS', 'TURN_MAX', 'TURN_ENCODED_MAX', 'SUBJECT_MAX', 'THREAD_TITLE_MAX'];
  const kitLog = vm.runInContext(`${kitNames.map(kitLine).join('\n')}\n;({ ${kitNames.join(', ')} })`, vm.createContext({}));
  assert.deepEqual(plain(A.T_TYPES), plain(kitLog.SUBJECT_TYPES));
  assert.equal(A.T_REF.source, kitLog.SUBJECT_REF.source);
  assert.deepEqual([A.T_REF_MAX, A.T_WAIT_MS, A.T_TURN_MAX, A.T_ENCODED_MAX, A.T_SUBJECT_MAX, A.T_TITLE_MAX], [kitLog.SUBJECT_CAPS.ref, kitLog.THREAD_WAIT_MS, kitLog.TURN_MAX, kitLog.TURN_ENCODED_MAX, kitLog.SUBJECT_MAX, kitLog.THREAD_TITLE_MAX], "the page's caps are the kit's");
  assert.deepEqual(Object.keys(A.T_KIND).sort(), [...plain(A.T_TYPES)].sort(), 'every kind of item has a name the owner reads');
  assert.deepEqual(Object.keys(A.T_HOME).sort(), [...plain(A.T_TYPES)].sort(), 'every kind of item has a home section');
  // sizes in bytes; one line; never half a surrogate pair
  assert.equal(A.tBytes('héllo'), 6);
  assert.equal(A.tCut('日本語', 7), '日本');
  assert.equal(A.tLine('a\n b‮ c', 120), 'a b c');
  assert.equal(A.tLine('x'.repeat(130), 120).length, 120);
  assert.equal(A.tLine(`${'x'.repeat(119)}😀`, 120).length, 119);
  // an item under the pointer, a spot in a section, nothing
  const G = 'g-20261110-101500123-supervisor';
  const on = (item) => ({ closest: (s) => (s === '[data-subject]' ? item : null) });
  const item = { dataset: { subject: `goal:${G}`, title: 'Launch checkout' }, innerText: 'Launch checkout\n  admins pay alone\nRun Drain Park Let go', querySelector: () => ({ textContent: 'Launch checkout' }) };
  const hit = A.tSubjectAt(on(item), 10, 10, () => null);
  assert.deepEqual(plain(hit.subject), { kind: 'item', ref: `goal:${G}`, quote: 'Launch checkout' }, "its name, not its buttons' labels");
  assert.equal(hit.title, 'Launch checkout');
  const card = { dataset: { subject: 'question:q-20261110-101500123-supervisor', title: 'Narrow it?' }, innerText: 'x', querySelector: () => ({ textContent: 'Narrow the goal to EU orders?' }) };
  assert.equal(A.tSubjectAt(on(card), 0, 0, () => null).subject.quote, 'Narrow it? · Narrow the goal to EU orders?');
  const untitled = A.tSubjectAt(on({ dataset: { subject: `goal:${G}` }, innerText: 'Only\ntext', querySelector: () => null }), 0, 0, () => null);
  assert.equal(untitled.subject.quote, 'Only text', 'its text only when it has no name or heading');
  assert.equal(untitled.title, 'a goal', 'no ref in what the owner reads');
  assert.equal(A.tSubjectAt(on({ dataset: { subject: 'act:a-1' }, innerText: 'x', querySelector: () => null }), 0, 0, () => null).title, 'an action');
  assert.equal(A.tSubjectAt(on({ dataset: { subject: 'secret:x', title: 'x' }, innerText: 'x' }), 0, 0, () => null), null, 'a ref the log would refuse is no item');
  const longRef = `observation:${'a'.repeat(109)}`;
  assert.ok(A.T_REF.test(longRef) && longRef.length === 121);
  assert.equal(A.tSubjectAt(on({ dataset: { subject: longRef, title: 'x' }, innerText: 'x' }), 0, 0, () => null), null, 'nor one over the log\'s 120 bytes');
  assert.ok(A.tSubjectAt(on({ dataset: { subject: longRef.slice(0, 120), title: 'x' }, innerText: 'x', querySelector: () => null }), 0, 0, () => null));
  const sec = { el: {}, view: '#loop/observe', box: { left: 100, top: 200, width: 400, height: 100 }, heading: 'Loop' };
  const spot = A.tSubjectAt({ closest: () => null }, 200, 250, () => sec);
  assert.deepEqual(plain(spot.subject), { kind: 'page', view: '#loop/observe', at: { x: 0.25, y: 0.5 }, quote: 'Loop' });
  assert.equal(spot.title, 'the dashboard · Loop');
  assert.equal(A.tSubjectAt({ closest: () => null }, 0, 0, () => null), null);
  // fitting the log's 2,500 bytes: the HTML first, then the errors, then the quote
  const big = { kind: 'preview', name: 'cool-tiger', route: '/checkout', anchor: { tag: 'button', html: 'h'.repeat(1024), selector: 's'.repeat(200) }, errors: ['"'.repeat(200), '"'.repeat(200), '"'.repeat(200)] };
  const fit = A.tFit(big);
  assert.ok(A.tBytes(JSON.stringify(fit)) <= 2500);
  assert.equal(fit.errors.length, 3, 'the errors kept while the HTML can give');
  assert.ok(fit.anchor.html.length < 1024);
  const noHtml = A.tFit({ ...big, anchor: { tag: 'button' }, errors: ['\u0001'.repeat(200), '\u0001'.repeat(200), '\u0001'.repeat(200)] });
  assert.ok(A.tBytes(JSON.stringify(noHtml)) <= 2500 && noHtml.errors.length < 3);
  assert.ok(A.tBytes(JSON.stringify(A.tFit({ kind: 'item', ref: `goal:${G}`, quote: '"'.repeat(1500) }))) <= 2500);
  assert.deepEqual(plain(A.tFit(hit.subject)), plain(hit.subject), 'a small subject is left alone');
  // the card's state line
  const now = Date.parse('2026-11-10T12:00:00Z');
  const th = (...turns) => ({ turns: turns.map(([by, min]) => ({ by, at: new Date(now - min * 60000).toISOString() })) });
  const later = 'Sent; the supervisor will read it when it next checks.';
  assert.equal(A.tCardState(th(['owner', 5], ['supervisor', 1]), now, true, true), null, 'the reply is the state');
  assert.equal(A.tCardState(th(['owner', 1]), now, true, true), 'Sent.');
  assert.equal(A.tCardState(th(['owner', 1]), now, false, false), later);
  assert.equal(A.tCardState(th(['owner', 1]), now, undefined, true), later, 'after a reload nobody knows: when it next checks');
  assert.equal(A.tCardState(th(['owner', 11]), now, true, true), "The supervisor hasn't replied yet.");
  assert.equal(A.tCardState(th(['owner', 11]), now, true, false), later, 'not running: it will read it later');
  assert.equal(A.tCardState(th(), now, true, true), null);
  // where a card opens: beside the pin, flipped to stay on screen; a sheet on a narrow screen
  assert.deepEqual(plain(A.tPlace({ left: 100, right: 300, top: 100, bottom: 150 }, 360, 400, 1200, 800)), { sheet: false, left: 310, top: 100 });
  assert.deepEqual(plain(A.tPlace({ left: 800, right: 1000, top: 700, bottom: 750 }, 360, 400, 1200, 800)), { sheet: false, left: 430, top: 392 });
  assert.deepEqual(plain(A.tPlace({ left: 10, right: 20, top: 10, bottom: 20 }, 360, 400, 600, 800)), { sheet: true });
  // the dock's words for where a subject is
  assert.equal(A.tWhere({ kind: 'item', ref: `goal:${G}` }), 'Goals');
  assert.equal(A.tWhere({ kind: 'item', ref: 'ticket:checkout-04' }), 'Board');
  assert.equal(A.tWhere({ kind: 'page', view: '#loop/observe' }), 'Loop, Observe');
  assert.equal(A.tWhere({ kind: 'page', view: '#goals' }), 'Goals');
  assert.equal(A.tWhere({ kind: 'page', view: '#nowhere' }), 'the dashboard', 'no hash route in what the owner reads');
  assert.equal(A.tWhere({ kind: 'artifact', slug: 'pricing-mock' }), 'pricing-mock');
  assert.equal(A.tWhere({ kind: 'preview', name: 'cool-tiger', route: '/checkout' }), 'cool-tiger /checkout');
  assert.equal(A.tWhere(null), 'no subject');
  // one pin per subject, numbered by when its first open thread began; resolved and no-subject threads get none
  const onGoal = { kind: 'item', ref: `goal:${G}` };
  const t = (id, created, subject, status = 'open') => ({ id, created_at: created, subject, status, turns: [] });
  const pins = A.tPins([t('a', '1', onGoal), t('c', '2', { kind: 'page', view: '#goals', at: { x: 0.1, y: 0.2 } }), t('b', '3', onGoal), t('d', '0', onGoal, 'resolved'), t('e', '4', null)]);
  assert.deepEqual(plain(pins).map((g) => [g.n, g.ids]), [[1, ['a', 'b']], [2, ['c']]]);
  // a dot when the supervisor spoke after the owner last looked
  const reply = { turns: [{ by: 'owner', at: '2026-11-10T10:00:00.000Z' }, { by: 'supervisor', at: '2026-11-10T10:05:00.000Z' }] };
  assert.equal(A.tUnread(reply, '2026-11-10T10:01:00.000Z'), true);
  assert.equal(A.tUnread(reply, '2026-11-10T10:05:00.000Z'), false);
  assert.equal(A.tUnread(reply, null), true);
  assert.equal(A.tUnread({ turns: [{ by: 'owner', at: '2026-11-10T10:00:00.000Z' }] }, null), false);
});
// The thread layer in Chrome, on a project of its own: aiming (this task), the card (Task 11), the
// pins and the dock (Task 12), questions and resolving (Task 13). One page; the subtests run in order.
test('threads on the dashboard page: Shift and point, the card, the pins and the dock', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  // stopped last-in first-out, each whatever the one before did: the fixture's files go only once the
  // dashboard writing into them has stopped, and one cleanup that throws leaves no Chrome running
  const undo = [];
  t.after(async () => { let err = null; for (const f of undo.reverse()) { try { await f(); } catch (e) { err ??= e; } } if (err) throw err; });
  const F = threadsFixture('threads-page');
  undo.push(() => F.done());
  const Q0 = F.sup(['ask', '--question', 'Which way?', '--choices', '[{"label":"Left"},{"label":"Right"}]', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  const port = await freePort();
  const dash = startDashboard(F.old, F.env({}), ['--port', String(port)]);
  undo.push(() => dash.stop());
  const chrome = await openChrome();
  undo.push(() => chrome.close());
  const p = await chrome.newPage();
  undo.push(() => p.close());
  await until(() => /dashboard on http/.test(dash.out()), 'the dashboard');
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#goals` });
  const soon = async (expr, what) => { for (let i = 0; i < 300; i++) { const v = await p.ev(expr); if (v) return v; await new Promise((r) => setTimeout(r, 50)); } assert.fail(`timed out: ${what}`); };
  const goalSel = `#goals-list [data-subject="goal:${F.goal}"]`;
  const shown = (id) => `!document.getElementById('${id}').hidden`;
  await soon(`!!document.querySelector('${goalSel}')`, 'the goal card');
  const threads = () => JSON.parse(F.owner(['thread', 'list', '--all', '--json']));
  let T;

  await t.test('Shift and point: the pin cursor, the goal outlined, a chip naming it; Shift up, the cursor back', async () => {
    const at = await p.at(`${goalSel} h4`);
    await p.hold('Shift', true);
    await p.move(at.x, at.y, 8);
    await soon(`${shown('tl-cursor')} && ${shown('tl-hl')}`, 'the pin and the highlight');
    assert.equal(await p.ev(`document.getElementById('tl-chip').textContent`), 'Launch checkout');
    assert.equal(await p.ev(`document.documentElement.classList.contains('tl-aiming')`), true);
    await p.hold('Shift', false);
    await soon(`document.getElementById('tl-cursor').hidden && !document.documentElement.classList.contains('tl-aiming')`, 'the normal cursor back');
  });

  await t.test('Shift held while typing in a field shows nothing until the pointer leaves the field', async () => {
    const box = `textarea[data-q="${Q0}"]`;
    await p.click(box);
    await p.hold('Shift', true);
    await p.key('A', 8);
    assert.equal(await p.ev(`document.getElementById('tl-cursor').hidden`), true, 'a capital is just a capital');
    const over = await p.at(box);
    await p.move(over.x, over.y, 8);
    assert.equal(await p.ev(`document.getElementById('tl-cursor').hidden`), true, 'not over the field');
    const g = await p.at(`${goalSel} h4`);
    await p.move(g.x, g.y, 8);
    await soon(shown('tl-cursor'), 'the pin once outside it');
    await p.hold('Shift', false);
    assert.match(await p.ev(`document.querySelector('${box}').value`), /A$/);
    await p.ev(`document.querySelector('${box}').value = ''; document.activeElement.blur()`);
  });

  await t.test("a Shift+click is the layer's alone: it starts a thread on the goal, and the title link under it isn't followed", async () => {
    const at = await p.at(`${goalSel} a.title-link`);
    const pages = async () => (await p.send('Target.getTargets')).targetInfos.filter((x) => x.type === 'page').length;
    const before = await pages();
    await p.hold('Shift', true);
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.ref === 'goal:${F.goal}'`, 'a thread about to start, on the goal');
    assert.equal(await p.ev('PRESSED'), 0, 'the press that holds a redraw never saw it');
    assert.equal(await pages(), before, "no new window: the browser's own Shift+click never ran");
    assert.equal(await p.ev('TL.draft.title'), 'Launch checkout');
    assert.equal(await p.ev('location.hash'), '#goals', 'the link was not followed');
    assert.equal(await p.ev(`document.getElementById('drawer').hidden`), true, 'no sidepeek opened');
    assert.equal(threads().length, 0, 'nothing is written until the owner writes');
  });

  await t.test('the card opens beside the goal, with the goal as its context, and nothing written yet', async () => {
    await soon(shown('tl-card'), 'the card');
    assert.match(await p.ev(`document.querySelector('#tl-card .tl-ctx summary').textContent`), /Launch checkout[\s\S]*Goals/);
    assert.equal(await p.ev(`document.activeElement.id`), 'tl-c-text', 'ready to write');
    assert.equal(threads().length, 0);
  });

  await t.test("a draft left on one subject stays with it: another subject's card starts empty; Escape closes the card", async () => {
    const shiftClick = async (sel) => { const at = await p.at(sel); await p.hold('Shift', true); await p.move(at.x, at.y, 8); await soon(shown('tl-cursor'), 'the pin'); await p.clickAt(at.x, at.y, 8); await p.hold('Shift', false); };
    await p.type('draft for the goal');
    // an unsent draft is let go after 7 days; one of a day ago stays
    const old = (days, at = Date.now() - days * 86400000) => JSON.stringify(JSON.stringify({ text: 'x', at }));
    await p.ev(`localStorage.setItem('devteam.thread.draft.new:item:goal:gone', ${old(8)}); localStorage.setItem('devteam.thread.draft.new:item:goal:kept', ${old(1)}); void 0`);
    await p.key('Escape');
    await soon(`document.getElementById('tl-card').hidden`, 'Escape closed the card');
    await shiftClick('#goals h2');
    await soon(`${shown('tl-card')} && TL.draft?.subject?.kind === 'page'`, 'a card on a spot in Goals');
    assert.equal(await p.ev(`document.getElementById('tl-c-text').value`), '', "the goal's draft isn't here");
    assert.deepEqual(await p.ev(`['gone', 'kept'].map((k) => localStorage.getItem('devteam.thread.draft.new:item:goal:' + k) !== null)`), [false, true], 'the week-old draft pruned');
    await p.ev(`localStorage.removeItem('devteam.thread.draft.new:item:goal:kept'); void 0`);
    await p.key('Escape');
    await soon(`document.getElementById('tl-card').hidden`, 'closed');
    await shiftClick(`${goalSel} h4`);
    await soon(`${shown('tl-card')} && TL.draft?.subject?.ref === 'goal:${F.goal}'`, 'the goal again');
    assert.equal(await p.ev(`document.getElementById('tl-c-text').value`), 'draft for the goal', 'its draft kept');
    assert.equal(await p.ev(`document.activeElement.id`), 'tl-c-text');
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.equal(threads().length, 0);
  });

  await t.test('Enter sends the first words: a thread on the goal, its turn in the card, the draft cleared', async () => {
    await p.type('Narrow this to the EU launch');
    // a read of the threads begun before the send, answering after it: the card must stay the thread's
    await p.ev(`window.__threadsRead = false; window.__threadsLanded = false; window.__threadsHold = new Promise((r) => { window.__threadsLet = r; }); tlRefresh(); void 0`);
    await soon('window.__threadsRead', 'a read begun before the send');
    await p.key('Enter');
    const th = await until(() => threads().find((x) => x.turns[0]?.text === 'Narrow this to the EU launch'), 'the thread in the log');
    T = th.id;
    await soon(`document.getElementById('tl-card').dataset.key === '${T}'`, 'the card the thread');
    await p.ev('window.__threadsLet()');
    await soon('window.__threadsLanded', 'the old read landing');
    const polls = await p.ev('window.__polls');
    await soon(`window.__polls >= ${polls + 2}`, 'two page refreshes since');
    assert.equal(await p.ev(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`), true, "the old read didn't close the new thread's card");
    assert.deepEqual([th.subject.kind, th.subject.ref, th.title], ['item', `goal:${F.goal}`, 'Launch checkout']);
    await soon(`document.querySelector('#tl-c-turns .tl-turn.owner')?.textContent.includes('Narrow this to the EU launch')`, 'the turn in the card');
    assert.equal(await p.ev(`document.getElementById('tl-c-text').value`), '');
    assert.equal(await p.ev(`document.activeElement.id`), 'tl-c-text', 'still in the composer after the card became the thread');
    assert.equal(await p.ev(`document.getElementById('tl-c-state').textContent`), 'Sent; the supervisor will read it when it next checks.', 'no pane here');
  });

  await t.test('the page refreshes while the owner writes in the card: the layer holds no redraw', async () => {
    await p.ev("document.getElementById('tl-c-text').focus()");
    await p.type('half a thought');
    const polls = await p.ev('window.__polls');
    await p.ev(`window.__g = document.querySelector('${goalSel}'); void 0`);
    await soon(`window.__polls >= ${polls + 2} && !window.__g.isConnected`, 'polls landing and the goal card redrawn');
    assert.equal(await p.ev(`document.activeElement.id`), 'tl-c-text');
    assert.equal(await p.ev(`document.getElementById('tl-c-text').value`), 'half a thought', 'the draft untouched');
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  });

  await t.test("the supervisor's reply shows in the open card within two polls", async () => {
    F.sup(['thread', 'say', T, 'That drops the measure to EU orders; want me to propose the change?']);
    const t0 = Date.now();
    await soon(`document.querySelector('#tl-c-turns .tl-turn.supervisor')?.textContent.includes('drops the measure')`, 'the reply');
    // the card polls every 2 s: two polls and a margin for a loaded machine
    assert.ok(Date.now() - t0 < 2 * 2000 + 1500, `took ${Date.now() - t0} ms`);
    assert.equal(await p.ev(`document.getElementById('tl-c-state').textContent`), '', 'the reply is the state');
  });

  await t.test('a turn over 2,000 bytes is refused in the card, counted in bytes', async () => {
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.focus(); ta.value = '日'.repeat(700); ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.match(await p.ev(`document.getElementById('tl-c-bytes').textContent`), /2100 \/ 2000 bytes/);
    await p.key('Enter');
    await soon(`/At most 2000 bytes/.test(document.getElementById('e-tl').textContent)`, 'the refusal');
    await p.ev(`(() => { const ta = document.getElementById('tl-c-text'); ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.blur(); })()`);
  });

  await t.test('reads of the threads slower than the 2 s poll: a reply still shows, and the owner can still send twice', async () => {
    await p.ev('window.__threadsDelay = 2500');
    try {
      F.sup(['thread', 'say', T, 'Slow box: still here.']);
      await soon(`[...document.querySelectorAll('#tl-c-turns .tl-turn.supervisor')].some((e) => e.textContent.includes('Slow box'))`, 'the reply through slow reads');
      for (const w of ['First on a slow box', 'Second on a slow box']) {
        await p.ev("document.getElementById('tl-c-text').focus()");
        await p.type(w);
        await p.key('Enter');
        await until(() => threads().find((x) => x.id === T)?.turns.some((u) => u.text === w), `"${w}" in the log`);
        await soon(`[...document.querySelectorAll('#tl-c-turns .tl-turn.owner')].some((e) => e.textContent.includes(${JSON.stringify(w)})) && document.getElementById('tl-c-text').value === '' && !TL.busy`, `"${w}" in the card, the composer free`);
      }
    } finally { await p.ev('window.__threadsDelay = 0'); }
    await p.ev('document.activeElement.blur()');
  });

  await t.test('#talk/<id> opens the thread beside its subject', async () => {
    await p.click('[data-tl-close]');
    await soon(`document.getElementById('tl-card').hidden`, 'closed');
    await p.ev(`location.hash = '#talk/${T}'`);
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'the card from the link');
    // closed either way, the same link opens it again
    await p.click('[data-tl-close]');
    await soon(`document.getElementById('tl-card').hidden && location.hash === '#goals'`, 'closed, the link let go for its subject\'s section');
    await p.ev(`location.hash = '#talk/${T}'`);
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'the same link again');
    await p.ev("document.getElementById('tl-c-text').focus()");
    await p.key('Escape');
    await soon(`document.getElementById('tl-card').hidden && location.hash === '#goals'`, 'Escape closed it');
    await soon('TL.polling === null', 'no poll with no thread open');
    await p.ev(`location.hash = '#talk/${T}'`);
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'and again after Escape');
  });

  await t.test('a numbered pin on the goal, placed again after the 10 s rebuild, opening the thread without Shift', async () => {
    await p.ev('document.activeElement?.blur()');
    await soon(`!!document.querySelector('.tl-pin')`, 'a pin');
    const pin = () => p.ev(`(() => { const r = document.querySelector('.tl-pin').getBoundingClientRect(), g = document.querySelector('${goalSel}').getBoundingClientRect(); return { dx: Math.round(r.left + r.width / 2 - g.right), dy: Math.round(r.top + r.height / 2 - g.top), n: document.querySelector('.tl-pin').textContent }; })()`);
    const before = await pin();
    assert.equal(before.n, '1');
    assert.ok(Math.abs(before.dx) <= 2 && Math.abs(before.dy) <= 2, `at the goal's top right corner: ${JSON.stringify(before)}`);
    await p.ev(`window.__g = document.querySelector('${goalSel}'); void 0`);
    await soon('!window.__g.isConnected', 'the goal card redrawn');
    assert.deepEqual(await pin(), before, 'placed again after the rebuild');
    await p.click('[data-tl-close]');
    await soon(`document.getElementById('tl-card').hidden`, 'closed');
    await p.click('.tl-pin');
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'the card from its pin');
  });

  await t.test('the dock: the pill with its count and a dot for a reply not seen, where each subject is, New thread with no subject', async () => {
    await p.click('[data-tl-close]');
    F.sup(['thread', 'say', T, 'Noted.']);
    await soon(`/Threads · 1/.test(document.getElementById('tl-pill').textContent) && !!document.querySelector('#tl-pill .tl-dot')`, 'the count, and a dot for the reply');
    await p.click('#tl-pill');
    await soon(`document.querySelector('#tl-list [data-tl-open="${T}"]')?.textContent.includes('Goals')`, 'where its subject is');
    await p.click('[data-tl-new]');
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').classList.contains('in-dock')`, 'a card in the dock');
    await p.ev("document.getElementById('tl-c-text').focus()");
    await p.type('What about onboarding?');
    await p.key('Enter');
    const n = await until(() => threads().find((x) => x.title === 'What about onboarding?'), 'the thread with no subject');
    assert.equal(n.subject, null);
    await soon(`/Threads · 2/.test(document.getElementById('tl-pill').textContent)`, 'two open');
    await p.ev('document.activeElement?.blur()');
    await p.click('[data-tl-close]');
  });

  await t.test('the pin button: pointing without Shift, until Esc', async () => {
    if (await p.ev(`document.getElementById('tl-panel').hidden`)) await p.click('#tl-pill');
    await p.click('#tl-pinbtn');
    assert.equal(await p.ev(`document.getElementById('tl-pinbtn').getAttribute('aria-pressed')`), 'true');
    const at = await p.at(`${goalSel} h4`);
    await p.move(at.x, at.y, 0);
    await soon(shown('tl-cursor'), 'the pin without Shift');
    await p.key('Escape');
    await soon(`document.getElementById('tl-cursor').hidden && document.getElementById('tl-pinbtn').getAttribute('aria-pressed') === 'false'`, 'out of pin mode');
  });

  await t.test("a dock row keeps the keyboard's focus through reads that change the list", async () => {
    if (await p.ev(`document.getElementById('tl-panel').hidden`)) await p.click('#tl-pill');
    await soon(`!!document.querySelector('#tl-list [data-tl-open="${T}"]')`, 'its row');
    await p.ev(`window.__row = document.querySelector('#tl-list [data-tl-open="${T}"]'); window.__row.focus(); void 0`);
    F.sup(['thread', 'say', T, 'One more thing.']);
    await p.ev('tlRefresh()');
    await p.ev('tlRefresh()');
    assert.ok(await p.ev(`TL.threads.find((x) => x.id === '${T}').turns.some((u) => u.text === 'One more thing.')`), 'the reads brought the reply in');
    assert.ok(await p.ev('document.activeElement === window.__row && window.__row.isConnected'), 'focus still on the same row');
    await p.ev('window.__row.blur()');
    await p.ev('tlRefresh()');
    assert.ok(await p.ev(`!!document.querySelector('#tl-list [data-tl-open="${T}"] .tl-dot[role="img"][aria-label]')`), 'drawn once focus left, its dot named');
  });

  await t.test('a press on a pin across a read that adds a pin still opens its card', async () => {
    await p.click('#tl-pill');
    await soon(`document.getElementById('tl-panel').hidden`, 'the panel closed');
    const at = await p.at('.tl-pin');
    await p.ev(`window.__pin = document.querySelector('.tl-pin'); void 0`);
    await p.move(at.x, at.y);
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 });
    F.owner(['thread', 'new', 'About this spot', '--subject', JSON.stringify({ kind: 'page', view: '#goals', at: { x: 0.5, y: 0.9 } })]);
    await p.ev('tlRefresh()');
    assert.equal(await p.ev(`document.querySelectorAll('.tl-pin').length`), 2, 'the new pin drawn');
    assert.ok(await p.ev('window.__pin.isConnected'), 'the pressed pin kept, not drawn again');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 });
    await soon(`${shown('tl-card')} && document.getElementById('tl-card').dataset.key === '${T}'`, 'the card from the pressed pin');
    await p.click('[data-tl-close]');
  });

  await t.test('pins stay under the drawer and its scrim', async () => {
    await p.ev('document.activeElement?.blur()');
    const at = await p.at('.tl-pin');
    await p.ev(`location.hash = '#goal/${F.goal}'`);
    await soon(shown('drawer'), 'the drawer');
    assert.equal(await p.ev(`!!document.elementFromPoint(${at.x}, ${at.y})?.closest('#tl-pins')`), false, 'no pin hit over the drawer');
    assert.equal(await p.ev(`[...document.querySelectorAll('.tl-pin')].some((b) => { const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('.tl-pin') === b; })`), false, 'none on top anywhere');
    await p.key('Escape');
    await soon(`document.getElementById('drawer').hidden`, 'the drawer closed');
  });

  await t.test("a question asked in the thread: the Inbox's card in the card (t-q-), one pick in both, answered there once, answered in the Inbox too", async () => {
    await p.click(`[data-tl-pin="${T}"]`);
    await soon(`document.getElementById('tl-card').dataset.key === '${T}'`, 'its card');
    const Q = F.sup(['thread', 'ask', T, '--question', 'Narrow the goal to EU orders?', '--choices', '[{"label":"Yes"},{"label":"Not yet"}]', '--recommendation', 'Yes', '--goal', F.goal, '--stake', '2', '--urgency', '1']);
    await soon(`!!document.getElementById('t-q-${Q}') && !!document.getElementById('q-${Q}')`, 'both copies');
    assert.equal(await p.ev(`document.getElementById('t-q-${Q}').querySelector('input[data-pick]').name`), `t-pick-${Q}`, 'its own radio group');
    // the Inbox is another section: its copy is clicked as a script would
    await p.ev(`document.querySelector('#q-${Q} input[data-pick="${Q}"][value="Not yet"]').click()`);
    assert.ok(await p.ev(`document.querySelector('#t-q-${Q} input[value="Not yet"]').checked && document.querySelector('#t-q-${Q} input[value="Not yet"]').closest('.choice').classList.contains('picked')`), "the Inbox's pick shows in the thread's");
    await p.click(`#t-q-${Q} input[data-pick="${Q}"][value="Yes"]`);
    assert.deepEqual(await p.ev(`[document.querySelector('#q-${Q} input[value="Yes"]').checked, document.querySelector('#q-${Q} input[value="Not yet"]').checked, document.querySelectorAll('#q-${Q} .choice.picked').length]`), [true, false, 1], "the thread's pick shows in the Inbox's");
    await p.click(`#t-q-${Q} button[data-answer="${Q}"]`);
    const q = await until(() => { const x = JSON.parse(F.owner(['questions', '--id', Q, '--json']))[0]; return x.status === 'answered' && x; }, 'the answer');
    assert.deepEqual([q.answer, q.channel], ['Yes', 'dashboard']);
    await soon(`!document.getElementById('q-${Q}') || document.getElementById('q-${Q}').classList.contains('done')`, 'the Inbox copy answered');
    await soon(`document.querySelector('#tl-c-turns .tl-q.done, #tl-c-turns .qcard.done')?.textContent.includes('Yes')`, 'the thread copy answered');
  });

  await t.test("answered in the Inbox, it shows answered in the thread; a hostile question and thread title are only text", async () => {
    const H = '<img src=x onerror="window.__xss=1">';
    const Q = F.sup(['thread', 'ask', T, '--question', `${H} Ship it?`, '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    await soon(`!!document.getElementById('t-q-${Q}') && !!document.getElementById('q-${Q}')`, 'both copies');
    assert.ok(await p.ev(`document.getElementById('t-q-${Q}').textContent.includes(${JSON.stringify(H)})`), 'the words as written');
    assert.equal(await p.ev(`!!document.querySelector('#tl img') || !!document.querySelector('#q-${Q} img') || !!window.__xss`), false, 'no element made from them');
    await p.ev(`(() => { const c = document.getElementById('q-${Q}'); c.querySelector('textarea[data-q]').value = 'ship it'; c.querySelector('button[data-answer="${Q}"]').click(); })()`);
    await until(() => JSON.parse(F.owner(['questions', '--id', Q, '--json']))[0].status === 'answered', 'the answer');
    await soon(`!document.getElementById('t-q-${Q}')?.querySelector('textarea, button[data-answer]') && /ship it/.test(document.getElementById('tl-c-turns').textContent)`, 'answered in the thread too');
    const X = F.owner(['thread', 'new', 'hello', '--title', `${H} hello`]).split('\n')[0];
    await p.ev(`tlOpen('${X}')`);
    await soon(`document.getElementById('tl-c-title').textContent === ${JSON.stringify(`${H} hello`)}`, 'the title as written');
    assert.equal(await p.ev(`!!document.querySelector('#tl img') || !!window.__xss`), false, 'no element made from the title');
    await p.click('[data-tl-close]');
    F.owner(['thread', 'resolve', X]);
    await p.ev('tlRefresh()');
    await p.click(`[data-tl-pin="${T}"]`);
    await soon(`document.getElementById('tl-card').dataset.key === '${T}'`, 'its card again');
  });

  await t.test('a secrets question in the thread is a link to the Inbox, never a second form', async () => {
    const Q = F.sup(['thread', 'ask', T, '--kind', 'owner-action', '--question', 'Post the API key', '--secrets', JSON.stringify([{ name: 'KEY', sink: 'file:secrets/key.txt' }]), '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    await soon(`!!document.querySelector('#q-${Q} [data-secret]') && /Post the API key/.test(document.getElementById('tl-c-turns').textContent)`, 'the Inbox form, the thread turn');
    assert.equal(await p.ev(`document.querySelectorAll('#tl [data-secret], #tl [data-post-secrets], #t-q-${Q}').length`), 0, 'no form in the thread');
    assert.equal(await p.ev(`document.querySelector('#tl-c-turns a[href="#q/${Q}"]')?.textContent`), 'Answer it in the Inbox');
    F.owner(['answer', Q, 'Can’t right now']);
    await soon(`!document.querySelector('#tl-c-turns a[href="#q/${Q}"]')`, 'answered, the link gone');
  });

  await t.test('Ready to resolve: it warns of an open question, Not yet clears it, Resolve takes the proposal, unpins it and moves it to Resolved', async () => {
    const Q2 = F.sup(['thread', 'ask', T, '--question', 'Tell the US team?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
    F.sup(['thread', 'ready', T, '--outcome', 'Goal narrowed to EU orders']);
    await soon(`document.querySelector('#tl-c-ready .tl-ready')?.textContent.includes('Goal narrowed to EU orders')`, 'the banner');
    assert.match(await p.ev(`document.querySelector('#tl-c-ready .tl-ready').textContent`), /1 question asked here is still open; it stays in the Inbox/);
    await p.click('[data-tl-notyet]');
    await until(() => threads().find((x) => x.id === T).ready === null, "cleared by the owner's Not yet");
    const th = threads().find((x) => x.id === T);
    assert.deepEqual([th.turns[th.turns.length - 1].by, th.turns[th.turns.length - 1].text], ['owner', 'Not yet']);
    await soon(`!document.querySelector('#tl-c-ready .tl-ready')`, 'the banner gone');
    F.sup(['thread', 'ready', T, '--outcome', 'EU only']);
    await soon(`document.querySelector('#tl-c-ready .tl-ready')?.textContent.includes('EU only')`, 'proposed again');
    await p.click('[data-tl-accept]');
    await until(() => threads().find((x) => x.id === T).status === 'resolved', 'resolved');
    await soon(`!document.querySelector('[data-tl-pin="${T}"]') && document.getElementById('tl-card').hidden`, 'unpinned, the card closed');
    if (await p.ev(`document.getElementById('tl-panel').hidden`)) await p.click('#tl-pill');
    await soon(`!!document.querySelector('.tl-resolved [data-tl-open="${T}"]')`, 'listed under Resolved');
    assert.ok(JSON.parse(F.owner(['log', '--type', 'observation', '--json'])).some((o) => o.kind === 'thread-resolved' && o.subject === `thread:${T}` && o.detail === 'EU only'));
    assert.equal(JSON.parse(F.owner(['questions', '--id', Q2, '--json']))[0].status, 'open', 'its question stays in the Inbox');
  });

  await t.test('a resolved thread reopens from its card', async () => {
    await p.ev(`document.querySelector('.tl-resolved').open = true`);
    await p.click(`.tl-resolved [data-tl-open="${T}"]`);
    await soon(`!!document.querySelector('[data-tl-reopen]')`, 'Reopen in its header');
    await p.click('[data-tl-reopen]');
    await until(() => threads().find((x) => x.id === T).status === 'open', 'reopened');
    await soon(`!!document.querySelector('[data-tl-pin="${T}"]')`, 'its pin back');
  });

  await t.test("Resolve in the card's header: a line for how it ended, the open question's warning, Cancel keeps it open", async () => {
    await soon(`!!document.querySelector('[data-tl-resolve]')`, 'Resolve in its header');
    await p.click('[data-tl-resolve]');
    await soon(`!!document.getElementById('tl-outcome')`, 'the form');
    assert.match(await p.ev(`document.querySelector('#tl-c-ready .tl-ready').textContent`), /1 question asked here is still open; it stays in the Inbox/);
    await p.click('[data-tl-resolve-cancel]');
    await soon(`!document.getElementById('tl-outcome')`, 'the form gone');
    assert.equal(threads().find((x) => x.id === T).status, 'open');
    await p.click('[data-tl-resolve]');
    await soon(`!!document.getElementById('tl-outcome')`, 'the form again');
    await p.ev(`document.getElementById('tl-outcome').value = 'Kept to the EU'`);
    await p.click('[data-tl-resolve-go]');
    const r = await until(() => { const x = threads().find((y) => y.id === T); return x.status === 'resolved' && x; }, 'resolved');
    assert.equal(r.outcome, 'Kept to the EU');
  });
});
