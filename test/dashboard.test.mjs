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
  ];
  const n = (await list()).length;
  for (const [name, body, why] of bad) assert.equal((await post(name, body)).status, 400, why);
  assert.equal((await list()).length, n, 'nothing was written');
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
