// Artifacts and previews on the dashboard's server: the Library's states, a published tree, the artifact lens, the viewer's route, popups.
// Ports: +0/+1..25 lib/kit.mjs's; +30/31..55 the viewer's route (its hub's list)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { PORTS, kit, freePort, write, startDashboard, until, threadsFixture } from './lib/kit.mjs';
import { landArtifact, VIEWER_MOCK, cleanup } from './lib/dashboard-page.mjs';

// The artifact lens's script, run in vm against a stand-in page: what it says to its parent, and to whom.
function artLensRun({ ancestor = 'http://127.0.0.1:4321', title = 'A mock', pathname = '/artifact/main/viewer-mock/index.html' } = {}) {
  const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
  const script = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(src)[1];
  const listeners = {};
  const posted = [];
  const parent = { postMessage: (m, o) => posted.push({ m: JSON.parse(JSON.stringify(m)), o }) };
  const doc = { title, documentElement: {}, body: {}, elementFromPoint: () => null, querySelectorAll: () => [], querySelector: () => null, getElementsByTagName: () => [], getElementById: () => null };
  const win = {
    document: doc, parent, innerWidth: 800, innerHeight: 600,
    location: { pathname, ancestorOrigins: ancestor ? [ancestor] : undefined },
    addEventListener: (type, f) => { (listeners[type] ??= []).push(f); },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} }, TextEncoder, CSS: { escape: (s) => s },
  };
  win.window = win;
  vm.runInNewContext(script, win);
  const hear = (data, { source = parent, isTrusted = true, origin = ancestor ?? 'http://127.0.0.1:4321' } = {}) => { for (const f of listeners.message ?? []) f({ data, source, isTrusted, origin }); };
  const press = (type, key, shiftKey = key === 'Shift') => { for (const f of listeners[type] ?? []) f({ type, key, shiftKey }); };
  return { script, posted, hear, press, win };
}

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
  assert.match(html, /action: 'artifact-publish', body: \{ op: 'unpublish', slug \}/);
  assert.match(html, /Restore all/);
  // kit-92 (R4): a drifted set is Restore all too, its sentence saying what goes up; no Review on the page; the card's drift words
  assert.match(html, /changed on main since: what goes up is main's version, not the one recorded\.` : ''\} \$\{tab\(L\.publish\([^`]*'Restore all'\)\}/);
  assert.doesNotMatch(html, /Review all|Review main's version/);
  assert.match(html, /<span class="lib-drift">changed on main since<\/span>/);
  // kit-95: the Library's line saying where publishing happens is gone (the Public pill's tooltip keeps it)
  assert.doesNotMatch(html, />Publishing happens on the cloud box/);
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

test('an artifact at a published tree: served from git by its tree id, under the artifact policy, with frame-ancestors and no X-Frame-Options', async (t) => {
  const F = threadsFixture('artifact-tree');
  const later = cleanup(t);
  later(() => F.done());
  const T = landArtifact(F, 'viewer-mock', VIEWER_MOCK);
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({}), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const dir = `/artifact/tree/${T}/viewer-mock/`;
  let r = await fetch(`${B}${dir}`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), VIEWER_MOCK['index.html']);
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp.includes(`script-src 'unsafe-inline' 'unsafe-eval' ${B}${dir} `), 'its own folder is self');
  assert.match(csp, new RegExp(`frame-ancestors ${B} http://127\\.0\\.0\\.1:${PORTS};`), 'framed by this dashboard and the hub: the gateway adds the public name to this list');
  assert.match(csp, /sandbox allow-scripts/);
  assert.equal(r.headers.get('x-frame-options'), null, 'none: the gateway only extends frame-ancestors');
  r = await fetch(`${B}${dir}style.css`);
  assert.deepEqual([r.status, r.headers.get('content-type'), await r.text()], [200, 'text/css; charset=utf-8', VIEWER_MOCK['style.css']]);
  r = await fetch(`${B}/artifact/tree/${T}/viewer-mock`, { redirect: 'manual' });
  assert.deepEqual([r.status, r.headers.get('location')], [301, `/artifact/tree/${T}/viewer-mock/`]);
  // a commit, the repository's root tree, a folder that is no artifact's: <id>:<path> would name
  // any committed file through them, so none is an artifact's tree (decision 12)
  const commit = F.g(['rev-parse', 'HEAD'], F.old);
  const root = F.g(['rev-parse', 'HEAD^{tree}'], F.old);
  const project = F.g(['rev-parse', 'HEAD:docs/devteam/project'], F.old);
  for (const bad of [`/artifact/tree/${commit}/viewer-mock/docs/devteam/project/settings.md`, `/artifact/tree/${root}/viewer-mock/docs/devteam/project/settings.md`, `/artifact/tree/${project}/viewer-mock/settings.md`, `/artifact/tree/${commit}/viewer-mock/`]) assert.equal((await fetch(`${B}${bad}`)).status, 404, bad);
  // a tree the repository doesn't have, a short id, a path out of it: none is served
  for (const bad of [`/artifact/tree/${'0'.repeat(40)}/viewer-mock/`, `/artifact/tree/${T.slice(0, 12)}/viewer-mock/`, `${dir}nope.css`, `${dir}%2e%2e/artifact.json`, `${dir}../index.html`, `/artifact/tree/${T}/Bad_Slug/`]) assert.equal((await fetch(`${B}${bad}`)).status, 404, bad);
  // and as a raw request sends it, before any client folds ../ away: out of the tree, up to the repo's root
  const raw = (p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject));
  for (const bad of [`${dir}../viewer-mock/index.html`, `${dir}../../../../docs/devteam/project/settings.md`, `${dir}x/../index.html`, `${dir}./index.html`, `${dir}%2e%2e/%2e%2e/settings.md`, `${dir}..%2fartifact.json`, `${dir}.hidden`, `${dir}a//b.css`, `/artifact/tree/${T}/../${T}/viewer-mock/`, `/artifact/tree/${T}%2f..%2f/viewer-mock/`, `/artifact/tree/${T.toUpperCase()}/viewer-mock/`, `/artifact/tree/${T}0/viewer-mock/`]) assert.equal(await raw(bad), 404, bad);
  assert.equal(await raw(`${dir}index.html`), 200, 'while the page itself, asked the same way, is served');
});

test('the artifact lens: plain ASCII, the kit\'s caps, and it answers only the page that frames it', () => {
  const { script } = artLensRun();
  assert.doesNotMatch(script, /[^\x20-\x7e\n]/, 'plain ASCII');
  assert.doesNotMatch(script, /`|\$\{|<\/script/i, 'a String.raw that closes no script tag');
  assert.doesNotThrow(() => new vm.Script(script));
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const kitCaps = (name) => vm.runInNewContext(`(${new RegExp(`^const ${name} = (\\{.*\\});$`, 'm').exec(src)[1]})`);
  const caps = vm.runInNewContext(`(${/const CAPS = (\{[^}]*\});/.exec(script)[1]})`);
  for (const [k, v] of Object.entries(kitCaps('ANCHOR_CAPS'))) assert.equal(caps[k], v, `anchor.${k}`);
  assert.equal(caps.path, kitCaps('SUBJECT_CAPS').path);
  let L = artLensRun();
  L.hear({ lens: 1, type: 'hello' });
  assert.deepEqual(L.posted, [{ m: { lens: 1, type: 'ready', path: '/artifact/main/viewer-mock/index.html', title: 'A mock', viewport: { w: 800, h: 600 } }, o: 'http://127.0.0.1:4321' }], 'hello: ready, to the parent\'s origin alone');
  L.hear({ lens: 1, type: 'hit', id: 'h1', x: 5, y: 5 });
  assert.deepEqual(L.posted[1].m, { lens: 1, type: 'hit-reply', id: 'h1', anchor: null, rect: null }, 'the page itself is nothing to point at');
  const n = L.posted.length;
  L.hear({ lens: 1, type: 'hello' }, { source: {} });
  L.hear({ lens: 1, type: 'hello' }, { isTrusted: false });
  L.hear({ type: 'hello' });
  L.hear({ lens: 1, type: 'go', route: '/x' });
  L.hear({ lens: 1, type: 'hit', id: { not: 'an id' }, x: 1, y: 1 });
  L.hear({ lens: 1, type: 'hit', id: 'h2', x: 'one', y: 1 });
  L.hear('{"lens":1,"type":"hello"}');
  assert.equal(L.posted.length, n, 'nothing from another window, a made-up event, another kind, a bad id or point, or text');
  L = artLensRun({ ancestor: null });
  L.hear({ lens: 1, type: 'hello' });
  assert.equal(L.posted[0].o, '*', 'where the browser names no ancestor, its opaque parent by *');
  // from the parent window, but another origin than the one the browser names for it: nothing
  L = artLensRun();
  L.hear({ lens: 1, type: 'hello' }, { origin: 'http://elsewhere.example' });
  assert.deepEqual(L.posted, [], 'only the framing page\'s own origin');
  // no key before a hello: a page nobody asked about tells nobody what is pressed in it
  L.press('keydown', 'Shift');
  L.press('keydown', 'Escape');
  assert.deepEqual(L.posted, [], 'no key before hello');
  L.hear({ lens: 1, type: 'hello' });
  L.press('keydown', 'Shift');
  assert.deepEqual(L.posted.map((x) => x.m.type), ['ready', 'key'], 'and keys once asked');
  // on a box the frame's path carries the gateway's capability, a bearer token: it is never told
  L = artLensRun({ pathname: '/c/1.abc.def/artifact/main/viewer-mock/index.html', title: 'Share http://box.example/c/1.abc.def/artifact/main/viewer-mock/' });
  L.hear({ lens: 1, type: 'hello' });
  assert.equal(L.posted[0].m.path, '/artifact/main/viewer-mock/index.html', 'the path from its artifact segment on');
  assert.equal(L.posted[0].m.title, 'Share http://box.example/artifact/main/viewer-mock/');
  assert.ok(L.posted.every((x) => !JSON.stringify(x.m).includes('/c/')), 'no message carries the capability');
  // the cap is the page's own: neither the capability nor the artifact's prefix takes any of it
  const longPage = `${'p/'.repeat(149)}x`;
  const longAt = `/artifact/tree/${'a'.repeat(40)}/${'s'.repeat(63)}/`;
  L = artLensRun({ pathname: `/c/1767225600000.abcdefghijklmnop.abcdefghijklmnopqrstuv${longAt}${longPage}${'q'.repeat(50)}` });
  L.hear({ lens: 1, type: 'hello' });
  assert.equal(L.posted[0].m.path, `${longAt}${longPage}${'q'.repeat(300 - longPage.length)}`, 'the prefix whole, the page cut to 300 bytes');
  // the page's own token, cut wherever its text holds it, in whatever encoding: no /artifact/ after it needed
  for (const [title, want] of [
    ['Share http%3A%2F%2Fbox.example%2Fc%2F1.abc.def%2Fartifact%2Fmain%2F', 'Share http%3A%2F%2Fbox.example%2Fartifact%2Fmain%2F'],
    ['Share {"u":"http:\\/\\/box.example\\/c\\/1.abc.def\\/artifact\\/"}', 'Share {"u":"http:\\/\\/box.example\\/artifact\\/"}'],
    ['Share %2fc%2f1%2Eabc%2Edef and token=1.abc.def;', 'Share and token=;'],
  ]) {
    L = artLensRun({ pathname: '/c/1.abc.def/artifact/main/viewer-mock/index.html', title });
    L.hear({ lens: 1, type: 'hello' });
    assert.equal(L.posted[0].m.title, want, title);
    assert.ok(L.posted.every((x) => !/abc(\.|%2e)def/i.test(JSON.stringify(x.m))), `no message carries the token: ${title}`);
  }
});

test('the artifact lens is added to a framed HTML load and nothing else: the policy unchanged, publishing\'s bytes untouched', async (t) => {
  const F = threadsFixture('artifact-lens');
  const later = cleanup(t);
  later(() => F.done());
  const T = landArtifact(F, 'viewer-mock', VIEWER_MOCK);
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({}), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
  const lens = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(src)[1];
  const iframe = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' };
  // a draft in a session's worktree, the third way an artifact is served
  for (const [rel, text] of Object.entries(VIEWER_MOCK)) write(path.join(F.old, '.worktrees/demo-01-draft/docs/devteam/project/artifacts/viewer-mock', rel), text);
  for (const dir of ['/artifact/main/viewer-mock/', `/artifact/tree/${T}/viewer-mock/`, '/artifact/wt/demo-01-draft/viewer-mock/']) {
    const plain = await fetch(`${B}${dir}`, { headers: { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' } });
    const framed = await fetch(`${B}${dir}`, { headers: iframe });
    assert.equal(await plain.text(), VIEWER_MOCK['index.html'], `${dir}: a top-level load gets the bytes as committed`);
    assert.equal(await framed.text(), `${VIEWER_MOCK['index.html']}<script>${lens}</script>`, `${dir}: a framed load, the lens after them`);
    assert.equal(framed.headers.get('content-security-policy'), plain.headers.get('content-security-policy'), 'the policy unchanged: its unsafe-inline admits the lens, and a hash would turn that off');
    assert.deepEqual([plain.headers.get('vary'), framed.headers.get('vary')], ['sec-fetch-dest', 'sec-fetch-dest'], 'the answer differs by where it is loaded, and says so');
    assert.equal(await (await fetch(`${B}${dir}`)).text(), VIEWER_MOCK['index.html'], 'no fetch metadata (curl, the gateway\'s loopback fetch for a publish): the bytes');
    assert.equal(await (await fetch(`${B}${dir}style.css`, { headers: iframe })).text(), VIEWER_MOCK['style.css'], 'only HTML');
  }
  // what publishing would put up hashes the committed bytes, and the gateway's loopback fetch for a
  // publish (its own Host, no sec-fetch-*) reads exactly those bytes for every file
  const m = await (await fetch(`${B}/public-manifest/viewer-mock`)).json();
  assert.equal(m.files['index.html'].sha256, crypto.createHash('sha256').update(VIEWER_MOCK['index.html']).digest('hex'));
  const loopback = (p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p, headers: { host: `127.0.0.1:${port}` } }, (res) => { const c = []; res.on('data', (b) => c.push(b)); res.on('end', () => resolve(Buffer.concat(c))); }).on('error', reject));
  for (const [rel, f] of Object.entries(m.files)) {
    const body = await loopback(`/artifact/main/viewer-mock/${rel}`);
    assert.deepEqual([crypto.createHash('sha256').update(body).digest('hex'), body.length], [f.sha256, f.size], `${rel}: as the manifest says`);
  }
});

test('the viewer: its route and headers, what /api/view says of an artifact, and viewer: 1 in hello', async (t) => {
  const F = threadsFixture('viewer-route');
  const later = cleanup(t);
  later(() => F.done());
  const T = landArtifact(F, 'viewer-mock', VIEWER_MOCK);
  // its own hub and instance block (the ports test's, free while this runs: the file's tests run one
  // at a time), so a hub another test's dashboard still holds can't keep this one out of the list
  const HUB = PORTS + 30;
  const d = startDashboard(F.old, F.env({ DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(PORTS + 31), DEVTEAM_HUB_RETRY_MS: '500' }));
  later(() => d.stop());
  const port = Number((await until(() => /dashboard on http:\/\/127\.0\.0\.1:(\d+)\b/.exec(d.out()), 'the dashboard'))[1]);
  assert.ok(port >= PORTS + 31 && port <= PORTS + 55, 'a port in the block, where the hub looks');
  const B = `http://127.0.0.1:${port}`;
  assert.equal((await (await fetch(`${B}/api/hello`)).json()).viewer, 1, 'the gateway wraps a public page only for a kit that says so');
  // and it reads that from the hub's list, which carries each instance's hello as it answered, inside
  // the probe's 300 ms budget (a slower hello is no instance in the list)
  const listedHere = async () => { try { return ((await (await fetch(`http://127.0.0.1:${HUB}/instances.json`)).json()).instances ?? []).find((i) => i.port === port); } catch { return null; } };
  const inHub = await until(listedHere, 'this dashboard in the hub\'s list');
  assert.deepEqual([inHub.viewer, inHub.root], [1, fs.realpathSync(F.old)]);
  const page = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  // the wrapper's grant rides along as w=<expiry>.<mac>: the gateway's to check, the kit's to ignore
  for (const q of ['', '?at=main', `?at=tree:${T}`, '?at=demo-01-x', `?at=tree:${T}&w=1767225600000.abcdefghijklmnopqrstuv`, '?w=anything&x=1']) {
    const r = await fetch(`${B}/view/artifact/viewer-mock${q}`);
    assert.equal(r.status, 200, q);
    assert.equal(await r.text(), page, 'the dashboard page, in viewer mode by its path');
    assert.equal(r.headers.get('content-security-policy'), `frame-src 'self'; frame-ancestors 'self' http://127.0.0.1:${HUB}`, 'its frames are its own; framed by itself and the hub, and by policy alone: the gateway adds the public name');
    assert.equal(r.headers.get('x-frame-options'), null);
    assert.deepEqual([r.headers.get('referrer-policy'), r.headers.get('cache-control')], ['no-referrer', 'no-store']);
  }
  for (const bad of ['/view/artifact/Bad_Slug', '/view/artifact/viewer-mock/x', '/view/artifact/', '/view/artifact/viewer-mock?at=..%2Fx', '/view/artifact/viewer-mock?at=tree:xyz', '/view/preview/cool-tiger']) assert.equal((await fetch(`${B}${bad}`)).status, 404, bad);
  // what the viewer's bar and "changed since" read, without /api/data
  const view = (q, headers = {}) => fetch(`${B}/api/view?${new URLSearchParams({ kind: 'artifact', ...q })}`, { headers });
  const lib = JSON.parse(F.owner(['artifacts', '--json'])).find((a) => a.slug === 'viewer-mock' && a.at === 'main');
  let r = await view({ slug: 'viewer-mock', at: 'main' });
  assert.equal(r.status, 200);
  let v = await r.json();
  assert.deepEqual([v.slug, v.at, v.title, v.summary, v.error, v.fp, v.main_fp, v.main_tree], ['viewer-mock', 'main', 'Viewer mock', 'A page to point at', null, lib.fp, lib.fp, T]);
  v = await (await view({ slug: 'viewer-mock', at: `tree:${T}` })).json();
  assert.deepEqual([v.at, v.fp, v.main_fp], [`tree:${T}`, lib.fp, lib.fp], 'the published tree, as main has it now');
  assert.equal((await view({ slug: 'viewer-mock', at: `tree:${'0'.repeat(40)}` })).status, 404, 'a tree the repository lacks: the viewer shows main instead');
  r = await view({ slug: 'no-such', at: 'main' });
  assert.deepEqual([r.status, await r.json()], [404, { error: 'no artifact no-such at main' }], 'nothing there, in words of its own: never what describe printed');
  assert.equal((await view({ slug: 'viewer-mock', at: 'demo-01-gone' })).status, 404, 'a worktree that is not there');
  // describe failing for another reason (a folder it can't read) is a 500 in words of its own, never
  // taken for nothing there; as root a mode holds nothing back, so it is not asked
  if (process.getuid?.() !== 0) {
    const draft = path.join(F.old, '.worktrees/demo-01-locked/docs/devteam/project/artifacts/viewer-mock');
    for (const [rel, text] of Object.entries(VIEWER_MOCK)) write(path.join(draft, rel), text);
    fs.mkdirSync(path.join(draft, 'locked'));
    fs.chmodSync(path.join(draft, 'locked'), 0);
    try {
      r = await view({ slug: 'viewer-mock', at: 'demo-01-locked' });
      assert.deepEqual([r.status, await r.json()], [500, { error: 'the artifact could not be read' }]);
    } finally {
      fs.chmodSync(path.join(draft, 'locked'), 0o755);
      fs.rmSync(path.join(F.old, '.worktrees/demo-01-locked'), { recursive: true, force: true });
    }
  }
  const many = await Promise.all([1, 2, 3].map(() => view({ slug: 'viewer-mock', at: 'main' }).then((x) => x.json())));
  assert.deepEqual(many.map((x) => x.fp), [lib.fp, lib.fp, lib.fp], 'asks at once share one run, and each has its answer');
  assert.equal((await view({ slug: 'viewer-mock', at: '../x' })).status, 400);
  assert.equal((await fetch(`${B}/api/view?kind=lens&slug=viewer-mock`)).status, 400);
  assert.equal((await view({ slug: 'viewer-mock', at: 'main' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.match(F.owner(['artifact', 'describe', 'viewer-mock']), /^viewer-mock at main: "Viewer mock", fingerprint [0-9a-f]{12}/);
  // thread show says when the artifact a thread is about has changed since (decision 21); each at a spot of
  // its own, since a spot with an open thread takes no second one (kit-97)
  let spot = 0;
  const on = (s) => F.owner(['thread', 'new', 'About it', '--subject', JSON.stringify({ kind: 'artifact', slug: 'viewer-mock', path: 'index.html', point: { x: 1, y: 2 + spot++ }, ...s })]).split('\n')[0];
  assert.doesNotMatch(F.sup(['thread', 'show', on({ at: 'main', fp: lib.fp })]), /changed since/, 'as it was');
  assert.match(F.sup(['thread', 'show', on({ at: 'main', fp: 'a'.repeat(64) })]), /^the artifact viewer-mock has changed since this thread began$/m);
  assert.doesNotMatch(F.sup(['thread', 'show', on({ at: `tree:${T}`, fp: lib.fp })]), /changed since/, 'a published tree main still has');
  assert.match(F.sup(['thread', 'show', on({ at: `tree:${T}`, fp: 'b'.repeat(64) })]), /^main has changed viewer-mock since this published version$/m);
  assert.match(F.sup(['thread', 'show', on({ at: 'demo-01-gone', fp: lib.fp })]), /^the artifact viewer-mock is no longer at "demo-01-gone"$/m, 'a draft whose worktree is gone');
  // a published tree is served only under the slug whose folder it was on main: another artifact's
  // tree under this name would show its files as this one's, in the bar and in a thread's subject
  const T2 = landArtifact(F, 'other-mock', { ...VIEWER_MOCK, 'artifact.json': JSON.stringify({ v: 1, title: 'Other mock', summary: 'Another page', by: 'supervisor', for: [] }) });
  assert.equal((await fetch(`${B}/artifact/tree/${T2}/viewer-mock/`)).status, 404, 'another artifact\'s tree under this slug');
  assert.equal((await view({ slug: 'viewer-mock', at: `tree:${T2}` })).status, 404);
  assert.equal(F.run(F.old, ['artifact', 'describe', 'viewer-mock', `--at=tree:${T2}`]).status, 3, 'nothing there');
  assert.equal((await fetch(`${B}/artifact/tree/${T2}/other-mock/`)).status, 200, 'under its own');
  // a version main has moved on from is still its slug's, by main's history of that folder
  write(path.join(F.old, 'docs/devteam/project/artifacts/viewer-mock/style.css'), '#art { color: rgb(4, 5, 6) }');
  const T3 = landArtifact(F, 'viewer-mock', {});
  assert.notEqual(T3, T);
  assert.equal((await fetch(`${B}/artifact/tree/${T}/viewer-mock/`)).status, 200, 'the older version, by history');
  assert.equal(F.run(F.old, ['artifact', 'describe', 'viewer-mock', `--at=tree:${T}`]).status, 0, 'and in a process of its own, nothing remembered');
  assert.equal((await fetch(`${B}/artifact/tree/${T}/other-mock/`)).status, 404, 'still never under another slug');
  // and once main no longer has it, a thread on a published version says so
  const pub = on({ at: `tree:${T}`, fp: lib.fp });
  F.g(['rm', '-rq', 'docs/devteam/project/artifacts/viewer-mock'], F.old);
  F.g(['commit', '-qm', 'artifact: viewer-mock gone'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  assert.match(F.sup(['thread', 'show', pub]), /^the artifact viewer-mock is no longer on main$/m);
});

test('a popup the dashboard or a viewer opens never needs window.opener: the wrapper\'s opener policy severs it', () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  assert.doesNotMatch(html, /\bwindow\.opener\b|[^.\w]opener\s*[.=]/, 'nothing reads or sets an opener');
  // kit-92: and the attributes an <a> built elsewhere is given as one quoted piece (the Library's libGo, a url link's title and thumbnail)
  const tags = [...(html.match(/<a\b[^>]*target="_blank"[^>]*>/g) ?? []), ...(html.match(/'[^'<>\n]*target="_blank"[^'<>\n]*'/g) ?? [])];
  assert.ok(tags.length >= 10, `the page's new-tab links: ${tags.length}`);
  assert.equal(tags.length, (html.match(/target="_blank"/g) ?? []).length, 'every target="_blank" in the file is in a tag the check matched');
  for (const a of tags) assert.match(a, /rel="noopener noreferrer"/, a);
  // to the end of the statement, not the first ")": an argument with a call in it (a URL built by one)
  // must not cut the options off from the check
  const opens = html.match(/window\.open\([^;\n]*/g) ?? [];
  assert.ok(opens.length >= 2, `the page's window.open calls: ${opens.length}`);
  for (const w of opens) assert.match(w, /noopener/, w);
});
