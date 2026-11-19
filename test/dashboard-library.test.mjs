// The dashboard's Library (kit-92): the library-items block (LIB_KINDS, libraryGoalIndex, linkHost,
// libraryItems and libraryKeep), run alone in vm with the preview-cards block beside it, over
// libraryFixture()'s /api/data parts; then the page in real headless Chrome over a real dashboard on a
// bare project whose /api/data is patched in the page with libraryFixture() (skipped where Chrome can't
// run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PORTS, bareProject, dashboardOnFreePort, dataPatchInit, libraryFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'index.html'), 'utf8');
const block = (src, name) => {
  const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`);
  assert.ok(a >= 0 && b > a, `the ${name} block is in the page`);
  assert.equal(src.indexOf(`/* ${name} start */`, a + 1), -1, `one ${name} block`);
  return src.slice(a, b + `/* ${name} end */`.length);
};

test('library-items: kinds, order, goals and keep', () => {
  // the two blocks alone, with no page globals but URL and URLSearchParams
  const vctx = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(`${block(INDEX, 'preview-cards')}\n${block(INDEX, 'library-items')}\nthis.previewState = previewState; this.LIB_KINDS = LIB_KINDS; this.libraryGoalIndex = libraryGoalIndex; this.linkHost = linkHost; this.remoteWeb = remoteWeb; this.libraryItems = libraryItems; this.libraryKeep = libraryKeep;`, vctx);
  const { previewState, LIB_KINDS, libraryGoalIndex, linkHost, remoteWeb, libraryItems, libraryKeep } = vctx;
  // stubs for the page's href helpers, so an href that isn't theirs shows
  const ctx = {
    previewState,
    artHref: (s, at) => `#artifact/${at}/${s}`,
    artViewer: (s, at) => `/view/artifact/${s}?at=${at}`,
    pvViewer: (n) => `/view/preview/${n}`,
    fileHref: (l) => `#file?path=${l.path}`,
  };
  const now = Date.parse('2026-11-19T12:00:00Z');
  const { patch: data, ids } = libraryFixture({ now });
  const plain = (x) => JSON.parse(JSON.stringify(x));

  assert.deepEqual(plain(LIB_KINDS), [['mock', 'Mock', 'layout-dashboard'], ['diagram', 'Diagram', 'workflow'], ['docs', 'Docs', 'book-open'], ['review', 'Review page', 'list-checks'], ['preview', 'Preview', 'monitor-play'], ['link', 'Link', 'link']]);
  const before = JSON.stringify(data);
  // in this realm, so deepEqual compares values, not the vm's prototypes
  const items = plain(libraryItems(data, now, ctx));
  assert.equal(JSON.stringify(data), before, 'the data is not changed');
  const byId = new Map(items.map((x) => [x.id, x]));
  assert.equal(byId.size, items.length, 'one item per id');

  // kind order, every kind held; the fixture lists them out of order
  const order = LIB_KINDS.map((k) => k[0]);
  const kinds = items.map((x) => x.kind);
  assert.ok(kinds.every((k, i) => i === 0 || order.indexOf(kinds[i - 1]) <= order.indexOf(k)), `kind order: ${kinds.join(' ')}`);
  for (const k of order) assert.ok(kinds.includes(k), `a ${k} item`);
  const rawKinds = data.library.artifacts.map((a) => a.kind ?? 'mock');
  assert.ok(rawKinds.some((k, i) => i > 0 && order.indexOf(rawKinds[i - 1]) > order.indexOf(k === 'x' ? 'mock' : k)), 'the fixture lists artifacts out of kind order');
  // artifacts in the server's order within a kind (first row of each slug)
  const slugsOf = (k) => [...new Set(data.library.artifacts.filter((a) => (['mock', 'diagram', 'docs'].includes(a.kind) ? a.kind : 'mock') === k).map((a) => a.slug))];
  for (const k of ['mock', 'diagram', 'docs']) assert.deepEqual(items.filter((x) => x.kind === k).map((x) => x.id), slugsOf(k).map((s) => `artifact:${s}`), `${k}: one per slug, in the server's order`);

  // an unknown kind and a missing one read as Mock
  assert.equal(byId.get(`artifact:${ids.unknownKind}`).kind, 'mock');
  assert.equal(byId.get(`artifact:${ids.noKind}`).kind, 'mock');
  assert.equal(byId.get(`artifact:${ids.diagram}`).kind, 'diagram');
  assert.equal(byId.get(`artifact:${ids.docs}`).kind, 'docs');

  // every item's hrefs are the page's helpers' (the block builds none of its own)
  for (const x of items) {
    if (x.kind === 'review') { assert.equal(x.href, `#review/${x.review.id}`); assert.equal(x.tab, null); continue; }
    if (x.kind === 'preview') { assert.equal(x.href, `#preview/${x.preview.name}`); assert.equal(x.tab, ctx.pvViewer(x.preview.name)); continue; }
    if (x.kind === 'link') {
      const l = x.link;
      assert.equal(x.href, l.url ? l.url : l.path && !l.remote ? ctx.fileHref(l) : null, `${x.id} href`);
      assert.equal(x.tab, x.href ?? remoteWeb(l.remote) ?? `#lib/link%3A${l.id}`, `${x.id} tab: its href, else its remote's page, else its peek`);
      assert.ok(x.tab, `${x.id}: a tab`);
      continue;
    }
    if (x.error) { assert.equal(x.href, null, `${x.id}: a broken row opens nothing here`); assert.equal(x.tab, ctx.artViewer(x.art.slug, x.art.at), `${x.id}: its tab, the viewer`); continue; }
    assert.equal(x.href, ctx.artHref(x.art.slug, x.art.at), `${x.id} href`);
    assert.equal(x.tab, ctx.artViewer(x.art.slug, x.art.at), `${x.id} tab`);
  }

  // a slug landed with drafts in two worktrees: one item, the newer draft shown
  const drafted = items.filter((x) => x.id === `artifact:${ids.drafted}`);
  assert.equal(drafted.length, 1, 'one item for the drafted slug');
  const d = drafted[0];
  assert.equal(d.at, ids.wt2, 'the newer worktree\'s draft');
  assert.equal(d.art.at, ids.wt2);
  assert.equal(d.drafts.length, 2);
  assert.deepEqual(d.drafts.map((r) => r.at).sort(), [ids.wt1, ids.wt2].sort());
  assert.equal(d.landed?.at, 'main', 'its landed row');
  assert.equal(d.href, `#artifact/${ids.wt2}/${ids.drafted}`);
  assert.equal(d.title, data.library.artifacts.find((a) => a.slug === ids.drafted && a.at === ids.wt2).title, 'the draft\'s title');
  // a draft of a slug that never landed
  const only = byId.get(`artifact:${ids.draftOnly}`);
  assert.equal(only.landed, null);
  assert.equal(only.drafts.length, 1);
  assert.equal(only.at, ids.wt1);
  // a landed row with no drafts
  const pub = byId.get(`artifact:${ids.public}`);
  assert.equal(pub.at, 'main');
  assert.deepEqual(pub.landed, pub.art);
  assert.deepEqual(plain(pub.drafts), []);
  // a broken row: its slug and its error
  const broken = byId.get(`artifact:${ids.broken}`);
  assert.ok(broken.error, 'the broken row carries its error');
  assert.equal(broken.title, ids.broken, 'a broken row shows its slug');
  for (const x of items.filter((y) => y.art && y.id !== `artifact:${ids.broken}`)) assert.equal(x.error, null, `${x.id} not broken`);

  // reviews: one per open review question, none for a plain question
  const reviewQs = data.questions.filter((q) => q.kind === 'review');
  assert.equal(reviewQs.length, 2);
  assert.ok(data.questions.length > reviewQs.length, 'plain questions beside them');
  assert.deepEqual(items.filter((x) => x.kind === 'review').map((x) => x.id), reviewQs.map((q) => `review:${q.id}`));
  const rv = byId.get(`review:${ids.reviewQ}`);
  assert.equal(rv.href, `#review/${ids.reviewQ}`);
  assert.equal(rv.tab, null);
  assert.equal(rv.title, reviewQs.find((q) => q.id === ids.reviewQ).review.title);
  const rv2 = items.find((x) => x.kind === 'review' && x.id !== `review:${ids.reviewQ}`);
  assert.equal(rv2.title, rv2.review.question, 'no review title: the question');

  // previews: as served, each with its state
  assert.deepEqual(items.filter((x) => x.kind === 'preview').map((x) => x.preview.name), data.library.previews.map((p) => p.name));
  const st = (n) => byId.get(`preview:${n}`).pstate.state;
  assert.equal(st(ids.pvLive), 'live');
  assert.equal(st(ids.pvChecking), 'checking');
  assert.equal(st(ids.pvNotRunning), 'not-running');
  assert.equal(st(ids.pvDown), 'not-answering');
  assert.ok(byId.get(`preview:${ids.pvDown}`).pstate.since, 'down since');
  assert.equal(st(ids.pvExpired), 'expired');
  for (const p of data.library.previews) assert.match(p.name, /^[a-z]{3,7}-[a-z]{3,7}(-[1-9]\d?)?$/, 'a name openPreview accepts');

  // links: as served, each with its host
  assert.deepEqual(items.filter((x) => x.kind === 'link').map((x) => x.link.id), data.library.links.map((l) => l.id));
  assert.equal(byId.get(`link:${ids.linkUrl}`).host, new URL(data.library.links.find((l) => l.id === ids.linkUrl).url).host);
  assert.equal(byId.get(`link:${ids.linkRemote}`).host, 'github.com');
  assert.equal(byId.get(`link:${ids.linkRemote}`).href, null, 'a remote-only link opens nothing here');
  assert.equal(byId.get(`link:${ids.linkPath}`).host, null);
  assert.match(byId.get(`link:${ids.linkPath}`).href, /^#file\?path=/);
  // literally: a url link opens its url, here and in a new tab; a path link has no tab
  const urlLink = byId.get(`link:${ids.linkUrl}`);
  assert.equal(urlLink.href, 'https://www.figma.com/file/pay-flow');
  assert.equal(urlLink.tab, 'https://www.figma.com/file/pay-flow');
  assert.equal(byId.get(`link:${ids.linkPath}`).tab, '#file?path=docs/devteam/project/designs/pay.md', 'a path link\'s tab: the file peek');
  assert.equal(byId.get(`link:${ids.linkRemote}`).tab, 'https://github.com/sanctuarycomputer/devteam', 'a remote-only link\'s tab: its web page');
  // every item but a review has a tab
  for (const x of items) assert.equal(!!x.tab, x.kind !== 'review', `${x.id}: a tab unless a review`);
  // a link whose remote has no web page (local, file://): its ↗ opens its own peek
  const local = { library: { links: [{ id: 'local-repo', kind: 'repo', title: 'Local', url: null, remote: '/srv/repo.git', path: null }, { id: 'file-repo', kind: 'repo', title: 'File', url: null, remote: 'file:///srv/repo.git', path: 'x.md' }, { id: 'git-repo', kind: 'repo', title: 'Git', url: null, remote: 'git://host.example/a/b.git', path: null }] } };
  assert.deepEqual(plain(libraryItems(local, now, ctx).map((x) => x.tab)), ['#lib/link%3Alocal-repo', '#lib/link%3Afile-repo', 'https://host.example/a/b']);
  // remoteWeb: http(s) as given, git://, scp and ssh forms as https://host/..., each less a trailing .git;
  // a local path or file:// none
  assert.equal(remoteWeb('https://bitbucket.org/a/b.git'), 'https://bitbucket.org/a/b');
  assert.equal(remoteWeb('https://github.com/a/b'), 'https://github.com/a/b');
  assert.equal(remoteWeb('http://git.example.com/a/b.git'), 'http://git.example.com/a/b');
  assert.equal(remoteWeb('git://git.kernel.org/pub/scm/git/git.git'), 'https://git.kernel.org/pub/scm/git/git');
  assert.equal(remoteWeb('file:///srv/repo.git'), null);
  assert.equal(remoteWeb('../other-repo'), null);
  assert.equal(remoteWeb('git@github.com:a/b.git'), 'https://github.com/a/b');
  assert.equal(remoteWeb('git@GitHub.com:a/b'), 'https://github.com/a/b');
  assert.equal(remoteWeb('ssh://git@gitlab.com/a/b.git'), 'https://gitlab.com/a/b');
  assert.equal(remoteWeb('ssh://gitlab.com:2222/a/b'), 'https://gitlab.com/a/b');
  assert.equal(remoteWeb('/srv/repo.git'), null);
  assert.equal(remoteWeb(null), null);

  // goals: a ref's goals
  const goalsOf = libraryGoalIndex(data);
  const sorted = (xs) => [...xs].sort();
  assert.deepEqual(plain(goalsOf(`goal:${ids.goal2}`)), [ids.goal2]);
  assert.deepEqual(plain(goalsOf(`ticket:${ids.tBuilding}`)), [ids.goal1], 'a ticket through its feature');
  assert.deepEqual(plain(goalsOf(ids.tMergedReceipts)), [ids.goal2], 'a bare ticket id (a session)');
  assert.deepEqual(plain(goalsOf(`feature:${ids.feat1}`)), [ids.goal1]);
  assert.deepEqual(plain(goalsOf(`feature:${ids.feat2}`)), [ids.goal2]);
  assert.deepEqual(plain(goalsOf(`plan-${ids.feat1}`)), [ids.goal1], 'a planner session by its feature');
  assert.deepEqual(plain(goalsOf(`plan-${ids.planPromptQ}`)), [ids.goal2], 'a planner session by its planner row');
  assert.deepEqual(plain(goalsOf(`ticket:${ids.tPlain}`)), [], 'a ticket of a feature in no goal');
  assert.deepEqual(plain(goalsOf('component:x')), []);
  assert.deepEqual(plain(goalsOf('supervisor')), []);
  assert.deepEqual(plain(goalsOf('ticket:nope')), []);
  // each item's goals
  assert.deepEqual(sorted(byId.get(`artifact:${ids.diagram}`).goals), [ids.goal2]);
  assert.deepEqual(sorted(byId.get(`artifact:${ids.public}`).goals), [ids.goal1]);
  assert.deepEqual(plain(byId.get(`artifact:${ids.noGoal}`).goals), [], 'an artifact for nothing');
  assert.deepEqual(plain(byId.get(`review:${ids.reviewQ}`).goals), [ids.goal2], 'a review question\'s goal');
  assert.deepEqual(plain(rv2.goals), [ids.goal1], 'a review question\'s ticket\'s goal');
  assert.deepEqual(plain(byId.get(`preview:${ids.pvLive}`).goals), [ids.goal1], 'a preview\'s session (a ticket)');
  assert.deepEqual(plain(byId.get(`preview:${ids.pvChecking}`).goals), [ids.goal2], 'a preview\'s session (a planner)');
  assert.deepEqual(plain(byId.get(`link:${ids.linkPath}`).goals), [ids.goal1], 'a link for a feature');

  // libraryKeep: by kind, by goal, both; no goal kept only with no goal filter
  const keep = (f) => items.filter((x) => libraryKeep(x, f)).map((x) => x.id);
  assert.deepEqual(keep({}), items.map((x) => x.id), 'no filter: everything');
  assert.deepEqual(keep({ kind: 'diagram' }), items.filter((x) => x.kind === 'diagram').map((x) => x.id));
  assert.ok(keep({ kind: 'diagram' }).length > 0);
  assert.deepEqual(keep({ goal: ids.goal1 }), items.filter((x) => x.goals.includes(ids.goal1)).map((x) => x.id));
  assert.ok(keep({ goal: ids.goal1 }).length > 0 && keep({ goal: ids.goal1 }).length < items.length);
  assert.deepEqual(keep({ kind: 'preview', goal: ids.goal2 }), [`preview:${ids.pvChecking}`], 'kind and goal');
  const none = { kind: 'mock', goals: [] };
  assert.equal(libraryKeep(none, {}), true);
  assert.equal(libraryKeep(none, { kind: 'mock' }), true);
  assert.equal(libraryKeep(none, { goal: ids.goal1 }), false);
  assert.equal(libraryKeep(none, { kind: 'mock', goal: ids.goal1 }), false);
  assert.equal(libraryKeep({ kind: 'docs', goals: [ids.goal1] }, { kind: 'mock', goal: ids.goal1 }), false);

  // linkHost: a url, then a remote, else none
  assert.equal(linkHost({ url: 'https://github.com/a/b' }), 'github.com');
  assert.equal(linkHost({ remote: 'git@github.com:a/b.git' }), 'github.com');
  assert.equal(linkHost({ remote: 'ssh://git@gitlab.com/a/b' }), 'gitlab.com');
  assert.equal(linkHost({ remote: 'https://bitbucket.org/a/b.git' }), 'bitbucket.org');
  assert.equal(linkHost({ url: 'https://docs.example.com/x', remote: 'git@github.com:a/b.git' }), 'docs.example.com');
  assert.equal(linkHost({ path: 'x' }), null);
  assert.equal(linkHost({ url: 'not a url' }), null);

  // artifacts: n adds n landed mocks bulk-<i>
  const big = libraryFixture({ now, artifacts: 3 });
  assert.deepEqual(big.patch.library.artifacts.filter((a) => a.slug.startsWith('bulk-')).map((a) => [a.slug, a.at]), [['bulk-0', 'main'], ['bulk-1', 'main'], ['bulk-2', 'main']]);
  assert.equal(libraryItems(big.patch, now, ctx).length, items.length + 3);
});

// ---- in Chrome (kit-92 T2): the page on the shell, the grid in kind order, Kind and Goal in the page bar ----

// the items libraryItems gives for data (the block run in vm, as above), for what the page should draw
function itemsOf(data, now = Date.now()) {
  const vctx = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(`${block(INDEX, 'preview-cards')}\n${block(INDEX, 'library-items')}\nthis.previewState = previewState; this.libraryItems = libraryItems; this.libraryKeep = libraryKeep;`, vctx);
  const ctx = { previewState: vctx.previewState, artHref: () => '#a', artViewer: () => '/v', pvViewer: () => '/v', fileHref: () => '#f' };
  const items = JSON.parse(JSON.stringify(vctx.libraryItems(data, now, ctx)));
  return { items, keep: (f) => items.filter((x) => vctx.libraryKeep(x, f)).map((x) => x.id) };
}

// a wait on a condition in the page
const soonIn = (p, ms = 20000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

// The box (kit-92 T3): a page whose requests to http://<n>.box.localhost:<port>/ (Chrome sends *.localhost to
// loopback; the dashboard answers only its own Host) are paused over a second DevTools connection (the helper's
// own drops events) and fulfilled from http://127.0.0.1:<port>, method, body, headers and status passed through,
// with x-devteam-public: <header> added to /api/data's answer, as the gateway adds it. header is the gateway's
// served map, { [project]: { root, port, artifacts: { slug: tree } } }. Its close() closes both connections.
async function boxPage(chrome, port, { n = 4321, header }) {
  const dir = chrome.proc.spawnargs.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; !(fs.existsSync(portFile) && /^\d+\n/.test(fs.readFileSync(portFile, 'utf8'))); i++) {
    if (i > 200) throw new Error('no DevToolsActivePort');
    await new Promise((r) => setTimeout(r, 50));
  }
  const dt = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const list = async () => (await fetch(`http://127.0.0.1:${dt}/json/list`)).json();
  const before = new Set((await list()).map((x) => x.id));
  const p = await chrome.newPage();
  const target = (await list()).find((x) => x.type === 'page' && !before.has(x.id));
  assert.ok(target, 'the new page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('could not reach the page for the proxy')); });
  let seq = 0;
  const waiting = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  // an answer for a page that has gone fails; nothing waits on it
  const quiet = (method, params) => { send(method, params).catch(() => {}); };
  const origin = `http://${n}.box.localhost:${port}`;
  const answer = async ({ requestId, request }) => {
    const u = new URL(request.url);
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([k]) => !/^(host|content-length|connection)$/i.test(k))
      .map(([k, v]) => [k, /^origin$/i.test(k) && v === origin ? `http://127.0.0.1:${port}` : v]));
    try {
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : request.postData;
      const r = await fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, { method: request.method, headers, body, redirect: 'manual' });
      const buf = Buffer.from(await r.arrayBuffer());
      // fetch has decoded the body: its encoding and length go
      const out = [...r.headers].filter(([k]) => !/^(content-encoding|content-length|transfer-encoding|connection)$/i.test(k)).map(([name, value]) => ({ name, value }));
      if (u.pathname === '/api/data') out.push({ name: 'x-devteam-public', value: JSON.stringify(header) });
      quiet('Fetch.fulfillRequest', { requestId, responseCode: r.status, responseHeaders: out, body: buf.toString('base64') });
    } catch { quiet('Fetch.failRequest', { requestId, errorReason: 'Failed' }); }
  };
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data);
    if (o.id !== undefined) { const w = waiting.get(o.id); if (!w) return; waiting.delete(o.id); if (o.error) w.reject(new Error(o.error.message)); else w.resolve(o.result); return; }
    if (o.method === 'Fetch.requestPaused') answer(o.params);
  };
  ws.onclose = () => { for (const [id, w] of waiting) { waiting.delete(id); w.reject(new Error('the proxy connection closed')); } };
  await send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/*` }] });
  const close = p.close;
  return { ...p, origin, close: () => { try { ws.close(); } catch {} close(); } };
}
// what a box page's window.__errors holds but the /presence socket's (not proxied)
const ERRORS = "window.__errors.filter((e) => !/presence|websocket/i.test(e))";

// A bare project (every Library record comes from the patch), its env with its own HOME and every
// DEVTEAM_* but the ports unset; the dashboard on it and Chrome with init: { p, soon, port, go }. box: the
// gateway's served map, and the page is at http://4321.box.localhost:<port>/ through boxPage. page: a
// function (chrome, port) giving the page instead (tapPage). setup(root, env): run on the bare project before
// the dashboard starts, its result given back as made; box may then be a function (made, port) giving the header.
async function libraryOn(t, { width = 1440, height = 900, init, box = null, page = null, setup = null } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-library-'));
  const later = cleanup(t);
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const root = bareProject(base, 'library');
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 66), DEVTEAM_PORT_BASE: String(PORTS + 67), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const made = setup ? setup(root, env) : null;
  const { dash, port } = await dashboardOnFreePort(root, env);
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  if (typeof box === 'function') box = box(made, port);
  const p = page ? await page(chrome, port) : box ? await boxPage(chrome, port, { header: box }) : await chrome.newPage();
  later(() => p.close());
  const at = box ? p.origin : `http://127.0.0.1:${port}`;
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  if (init) await p.send('Page.addScriptToEvaluateOnNewDocument', { source: init });
  const soon = soonIn(p, 20000, () => dash.out());
  const loaded = "!document.querySelector('main.waiting') && typeof DATA !== 'undefined' && !!DATA";
  // a fresh document at a head (from about:blank, so a head that differs only in its hash loads anew)
  const go = async (hash) => {
    await p.send('Page.navigate', { url: 'about:blank' });
    await soon("location.href === 'about:blank'", 'about:blank');
    await p.send('Page.navigate', { url: `${at}/${hash}` });
    await soon(loaded, 'the page with its data');
  };
  return { p, soon, port, go, at, made, box };
}

const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' };
// the page bar's filters: a control by its data-f, a pick (its change event, as the owner's choice makes)
const ctl = (f) => `document.querySelector('.pagebar .extra [data-f="${f}"]')`;
const pick = (p, f, v) => p.ev(`(() => { const s = ${ctl(f)}; s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
const EXTRA = "[...document.querySelectorAll('.pagebar .extra select, .pagebar .extra button, .pagebar .extra input')].map((c) => c.dataset.f)";
// the hash, its query read back (so the test doesn't lean on how a value is escaped)
const HEAD = "(() => { const h = location.hash, i = h.indexOf('?'); return { page: h.slice(1, i < 0 ? h.length : i), q: Object.fromEntries(new URLSearchParams(i < 0 ? '' : h.slice(i + 1))) }; })()";
// the grid's cards by id, in order
const IDS = "[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => c.dataset.libId)";
const idsAre = (xs) => `JSON.stringify(${IDS}) === ${JSON.stringify(JSON.stringify(xs))}`;
// an init (after dataPatchInit) that counts the page's /api/data reads
const READS_INIT = `(() => {
  window.__dataReads = 0;
  const f = window.fetch;
  window.fetch = (u, o) => { if (String(u && u.url ? u.url : u).startsWith('/api/data')) window.__dataReads++; return f(u, o); };
})();`;
const card = (id) => `document.querySelector('#lib-grid > .lib-card[data-lib-id="${id}"]')`;

test('the Library is one grid in kind order with no headers', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture();
  // one title far longer than a card is wide
  const LONG = `The pay flow, ${'every screen the checkout shows and every state it can be in, '.repeat(4)}end`;
  patch.library.artifacts.find((a) => a.slug === ids.noKind).title = LONG;
  const { items } = itemsOf(patch);
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#library');
  await p.ev('localStorage.clear()');
  await go('#library');
  await soon(idsAre(items.map((x) => x.id)), 'a card per item, in the items\' order');
  const kinds = await p.ev("[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => c.dataset.kind)");
  const order = ['mock', 'diagram', 'docs', 'review', 'preview', 'link'];
  assert.deepEqual(kinds, items.map((x) => x.kind), 'each card its item\'s kind');
  assert.deepEqual(kinds, [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b)), 'kind order');
  assert.deepEqual([...new Set(kinds)], order, 'every kind, in order');
  assert.deepEqual(await p.ev(`(() => { const L = document.getElementById('library'); return { headers: L.querySelectorAll('h1, h2, h3, h4, hr').length, noShell: L.classList.contains('no-shell') || !!L.querySelector('.no-shell'), grid: document.getElementById('lib-grid').classList.contains('cards'), grids: L.querySelectorAll('.cards').length, top: !!document.getElementById('lib-top'), old: !!L.querySelector('#artifacts, #previews, #lib-links') }; })()`),
    { headers: 0, noShell: false, grid: true, grids: 1, top: true, old: false }, 'one .cards grid on the shell, no section header');
  // each card's head: the kind's icon and the title first, ↗ (none on a review) and ⋯ last
  const heads = await p.ev(`[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => { const h = c.firstElementChild; const k = [...h.children]; return { id: c.dataset.libId, head: h.classList.contains('card-head'), icon: k[0].className, title: k[1].classList.contains('lib-title') ? k[1].textContent : null, last: k.at(-1).matches('details.menu'), tab: !!h.querySelector(':scope > a.lib-tab.av-open > i.icon-external-link'), beforeMenu: k.at(-2).matches('a.lib-tab.av-open') && !!k.at(-2).querySelector(':scope > i.icon-external-link'), href: h.querySelector(':scope > a.lib-tab')?.getAttribute('href') ?? null, thumb: !!c.querySelector(':scope > .lib-thumb[data-thumb-src]'), body: !!c.querySelector(':scope > .lib-body') }; })`);
  // each ↗'s target, written out per kind: an artifact's viewer (a broken one too), a preview's, a url link's url,
  // a path link's file peek, a remote-only link's web page
  const tabOf = {};
  for (const x of items) {
    if (x.art) tabOf[x.id] = `/view/artifact/${x.art.slug}${x.art.at === 'main' ? '' : `?at=${x.art.at}`}`;
    if (x.preview) tabOf[x.id] = `/view/preview/${x.preview.name}`;
  }
  tabOf[`link:${ids.linkUrl}`] = 'https://www.figma.com/file/pay-flow';
  tabOf[`link:${ids.linkPath}`] = `#file?${new URLSearchParams({ path: 'docs/devteam/project/designs/pay.md', title: 'The pay design' })}`;
  tabOf[`link:${ids.linkRemote}`] = 'https://github.com/sanctuarycomputer/devteam';
  assert.ok(tabOf[`artifact:${ids.broken}`] && tabOf[`artifact:${ids.drafted}`].includes('?at='), 'a broken and a drafted artifact among them');
  const icons = { mock: 'layout-dashboard', diagram: 'workflow', docs: 'book-open', review: 'list-checks', preview: 'monitor-play', link: 'link' };
  for (const [i, x] of items.entries()) {
    const h = heads[i];
    assert.equal(h.head, true, `${x.id}: a .card-head first`);
    assert.equal(h.icon, `icon-${icons[x.kind]}`, `${x.id}: the kind's icon`);
    assert.equal(h.title, x.title, `${x.id}: the title in the head`);
    assert.equal(h.last, true, `${x.id}: ⋯ last`);
    assert.equal(h.thumb && h.body, true, `${x.id}: a thumbnail box and a body`);
    if (x.kind === 'review') { assert.equal(h.tab, false, `${x.id}: a review has no ↗`); continue; }
    assert.equal(h.beforeMenu, true, `${x.id}: ↗ (icon-external-link) just before ⋯`);
    assert.equal(h.href, tabOf[x.id], `${x.id}: ↗'s target`);
  }
  // the title one line, truncated
  assert.deepEqual(await p.ev("(() => { const s = getComputedStyle(document.querySelector('#lib-grid .lib-title')); return [s.overflow, s.textOverflow, s.whiteSpace, s.minWidth]; })()"), ['hidden', 'ellipsis', 'nowrap', '0px']);
  // the long title is cut short, its ↗ and ⋯ still inside the card
  assert.deepEqual(await p.ev(`(() => { const c = ${card(`artifact:${ids.noKind}`)}, t = c.querySelector('.lib-title'), r = c.getBoundingClientRect().right; return { title: t.textContent.length, cut: t.scrollWidth > t.clientWidth, tab: c.querySelector('.card-head > .lib-tab').getBoundingClientRect().right <= r, menu: c.querySelector('.card-head > details.menu').getBoundingClientRect().right <= r, oneLine: t.getBoundingClientRect().height < 30 }; })()`),
    { title: LONG.length, cut: true, tab: true, menu: true, oneLine: true }, 'a long title truncated on one line');
  // a frame source for a working artifact and a live preview, none for a review, a broken one or a link
  const srcs = await p.ev("Object.fromEntries([...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => [c.dataset.libId, c.querySelector('.lib-thumb').dataset.thumbSrc]))");
  for (const x of items) {
    const want = x.kind === 'review' || x.kind === 'link' || x.error || (x.kind === 'preview' && x.pstate.state !== 'live') ? '' : null;
    if (want === '') assert.equal(srcs[x.id], '', `${x.id}: no frame source`);
    else assert.ok(srcs[x.id], `${x.id}: a frame source`);
  }
  assert.equal(await p.ev("document.getElementById('n-library').textContent"), String(items.filter((x) => ['mock', 'diagram', 'docs', 'preview'].includes(x.kind)).length), 'the nav count: one per artifact and preview card');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('Kind and Goal ride in the hash', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture();
  const { items, keep } = itemsOf(patch);
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#library');
  await p.ev('localStorage.clear()');
  await go('#library');
  await soon(idsAre(items.map((x) => x.id)), 'every card');
  assert.deepEqual(await p.ev(EXTRA), ['goal', 'kind'], 'Goal, then Kind');
  assert.deepEqual(await p.ev(`[...${ctl('kind')}.options].map((o) => [o.value, o.textContent])`), [['', 'All kinds'], ['mock', 'Mock'], ['diagram', 'Diagram'], ['docs', 'Docs'], ['review', 'Review page'], ['preview', 'Preview'], ['link', 'Link']]);
  assert.equal(await p.ev(`${ctl('kind')}.getAttribute('aria-label')`), 'Kind');
  assert.deepEqual(await p.ev(`[...${ctl('goal')}.options].map((o) => o.value)`), ['', ids.goal1, ids.goal2]);

  await pick(p, 'kind', 'diagram');
  await soon("location.hash === '#library?kind=diagram'", 'the kind in the hash');
  const diagrams = keep({ kind: 'diagram' });
  assert.ok(diagrams.length >= 2 && diagrams.length < items.length);
  await soon(idsAre(diagrams), 'only Diagram cards');
  // a goal that narrows the diagrams to some of them
  const g = [ids.goal1, ids.goal2].find((x) => { const k = keep({ kind: 'diagram', goal: x }); return k.length && k.length < diagrams.length; });
  assert.ok(g, 'a goal holding some of the diagrams');
  await pick(p, 'goal', g);
  await soon(`location.hash.includes(${JSON.stringify(`goal=${g}`)})`, 'the goal in the hash');
  assert.deepEqual(await p.ev(HEAD), { page: 'library', q: { kind: 'diagram', goal: g } });
  await soon(idsAre(keep({ kind: 'diagram', goal: g })), "only the goal's diagrams");
  assert.deepEqual(await p.ev(`[${ctl('goal')}.value, ${ctl('kind')}.value]`), [g, 'diagram'], 'the selects show the filters');
  // Back restores the Diagram-only set
  await p.ev('history.back()');
  await soon("location.hash === '#library?kind=diagram'", 'back: the kind alone');
  await soon(idsAre(diagrams), 'back: the Diagram cards');
  assert.equal(await p.ev(`${ctl('goal')}.value`), '', 'back: All goals');
  // the goal alone
  await pick(p, 'kind', '');
  await soon("location.hash === '#library'", 'All kinds: no kind key');
  await pick(p, 'goal', ids.goal2);
  await soon(idsAre(keep({ goal: ids.goal2 })), "goal2's items, of every kind");
  assert.ok(keep({ goal: ids.goal2 }).length < items.length);

  // a kind or a goal naming nothing: every card, the select at All
  await go('#library?kind=zzz');
  await soon(idsAre(items.map((x) => x.id)), 'an unknown kind: every card');
  assert.equal(await p.ev(`${ctl('kind')}.value`), '', 'All kinds');
  await go('#library?goal=g-20200101-000000009-supervisor');
  await soon(idsAre(items.map((x) => x.id)), 'an unknown goal: every card');
  assert.equal(await p.ev(`${ctl('goal')}.value`), '', 'All goals');
  // filters that keep nothing: None
  const kinds = ['mock', 'diagram', 'docs', 'review', 'preview', 'link'];
  const nothing = kinds.flatMap((k) => [ids.goal1, ids.goal2].map((x) => [k, x])).find(([k, x]) => !keep({ kind: k, goal: x }).length);
  assert.ok(nothing, 'a kind and goal that keep nothing');
  await go(`#library?kind=${nothing[0]}&goal=${nothing[1]}`);
  await soon("document.getElementById('lib-grid').textContent.trim() === 'None'", 'None');
  assert.equal(await p.ev(IDS + '.length'), 0);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the goal is shared and Board\'s keys never reach Library', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture();
  const { keep } = itemsOf(patch);
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#overview');
  await p.ev('localStorage.clear()');
  await go('#board');
  await soon(`!!${ctl('goal')}`, 'the Board filters');
  await pick(p, 'goal', ids.goal2);
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal2}`)}`, 'goal2 on the Board');
  // the Board's goal on Library
  await p.click('.side a[href="#library"]');
  await soon(`location.hash === ${JSON.stringify(`#library?goal=${ids.goal2}`)}`, "the Board's goal on Library");
  await soon(idsAre(keep({ goal: ids.goal2 })), "goal2's items");
  assert.deepEqual(await p.ev(EXTRA), ['goal', 'kind'], 'no Feature, Repo or Needs attention on Library');
  assert.equal(await p.ev(`document.querySelectorAll('.pagebar .extra select[data-f="feat"], .pagebar .extra select[data-f="repo"], .pagebar .extra [data-f="att"]').length`), 0);
  // a goal picked on Library shows on Progress
  await pick(p, 'goal', ids.goal1);
  await soon(`location.hash === ${JSON.stringify(`#library?goal=${ids.goal1}`)}`, 'goal1 on Library');
  await p.click('.side a[href="#progress"]');
  await soon(`location.hash === ${JSON.stringify(`#progress?goal=${ids.goal1}`)}`, "Library's goal on Progress");
  // a feature picked on the Board, then the goal changed on Library: the Board has the new goal and no feature
  await p.click('.side a[href="#board"]');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal1}`)}`, 'goal1 on the Board');
  await soon(`[...${ctl('feat')}.options].some((o) => o.value === 'pay')`, "goal1's feature offered");
  await pick(p, 'feat', 'pay');
  await soon(`location.hash === ${JSON.stringify(`#board?goal=${ids.goal1}&feat=pay`)}`, 'the feature on the Board');
  await p.click('.side a[href="#library"]');
  await soon(`location.hash === ${JSON.stringify(`#library?goal=${ids.goal1}`)}`, 'Library: the goal, no feature');
  await pick(p, 'goal', ids.goal2);
  await soon(`location.hash === ${JSON.stringify(`#library?goal=${ids.goal2}`)}`, 'goal2 on Library');
  await p.click('.side a[href="#board"]');
  await soon("location.hash.startsWith('#board')", 'the Board');
  await soon(`(${HEAD}).q.goal === ${JSON.stringify(ids.goal2)}`, "Library's goal on the Board");
  assert.deepEqual(await p.ev(HEAD), { page: 'board', q: { goal: ids.goal2 } }, "no feature: the old goal's is dropped");
  // Library's hash never has Board's keys
  await p.ev('localStorage.clear()');
  await go('#library?feat=x&att=1');
  await soon("location.hash === '#library'", "Board's keys dropped, in place");
  assert.equal(await p.ev('history.state.page'), '#library', 'the stamp names the canonical head');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('Kind is remembered by Library alone', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch } = libraryFixture();
  const { keep } = itemsOf(patch);
  const { p, soon, go } = await libraryOn(t, { init: dataPatchInit(patch) });
  await go('#overview');
  await p.ev('localStorage.clear()');
  await go('#library');
  await soon(`!!${ctl('kind')}`, 'the Kind select');
  await pick(p, 'kind', 'docs');
  await soon("location.hash === '#library?kind=docs'", 'docs on Library');
  await soon(idsAre(keep({ kind: 'docs' })), 'the Docs cards');
  for (const page of ['board', 'progress', 'overview', 'loop']) {
    await p.click(`.side a[href="#${page}"]`);
    await soon(`PAGE_NOW === ${JSON.stringify(page)} && (${HEAD}).page === ${JSON.stringify(page)}`, page);
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await p.ev(HEAD)).q.kind, undefined, `${page}: no kind`);
  }
  await p.click('.side a[href="#library"]');
  await soon("location.hash === '#library?kind=docs'", 'back on Library: its kind');
  await soon(idsAre(keep({ kind: 'docs' })), 'the Docs cards again');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a poll leaves the grid alone; a changed card is replaced, its ⋯ open again', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture();
  const { items } = itemsOf(patch);
  const { p, soon, go } = await libraryOn(t, { init: `${dataPatchInit(patch)}\n${READS_INIT}` });
  await go('#library');
  await p.ev('localStorage.clear()');
  await go('#library');
  await soon(idsAre(items.map((x) => x.id)), 'every card');
  const target = `artifact:${ids.docs}`, other = `artifact:${ids.diagram}`;
  await p.ev(`(() => { const c = ${card(target)}, d = c.querySelector('.card-head details.menu'); d.open = true; d.__mark = 'kept'; c.__mark = 'kept'; ${card(other)}.__mark = 'other'; })()`);
  // polls, not a fixed wait: three more reads of /api/data begun (the page's 300 ms poll), the earlier ones read and drawn
  const reads = await p.ev('window.__dataReads');
  await soon(`window.__dataReads >= ${reads + 3}`, 'two more polls');
  assert.deepEqual(await p.ev(`(() => { const c = ${card(target)}, d = c.querySelector('.card-head details.menu'); return { card: c.__mark, menu: d.__mark, open: d.open, other: ${card(other)}.__mark }; })()`),
    { card: 'kept', menu: 'kept', open: true, other: 'other' }, 'the same nodes, the menu still open');
  // the card's summary changes: that card is drawn anew, its menu opened again; the others are kept
  await p.ev(`window.__fx.library.artifacts.find((a) => a.slug === ${JSON.stringify(ids.docs)}).summary = 'Now it shows the new guide'`);
  await soon(`${card(target)}.querySelector('.lib-body').textContent.includes('Now it shows the new guide')`, 'the new summary');
  assert.deepEqual(await p.ev(`(() => { const c = ${card(target)}, d = c.querySelector('.card-head details.menu'); return { card: c.__mark ?? null, menu: d.__mark ?? null, open: d.open, other: ${card(other)}.__mark }; })()`),
    { card: null, menu: null, open: true, other: 'other' }, 'a new node for the changed card, its menu open; the other kept');
  assert.equal(await p.ev(idsAre(items.map((x) => x.id))), true, 'the order kept');
  // an empty Library (no artifact, preview, review page or link): None
  await p.ev("window.__fx.library = { ...window.__fx.library, artifacts: [], previews: [], links: [] }; window.__fx.questions = window.__fx.questions.filter((q) => q.kind !== 'review')");
  await soon("document.getElementById('lib-grid').textContent.trim() === 'None'", 'None for an empty Library');
  assert.equal(await p.ev(`${IDS}.length`), 0);
  assert.equal(await p.ev("document.getElementById('n-library').textContent"), '', 'no count');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

// ---- in Chrome (kit-92 T3): the card: head, badges, details, menu and actions; box states through boxPage ----

// the page at #library with every card drawn, localStorage cleared first
async function libraryAll(t, opts = {}) {
  const fx = opts.fx ?? libraryFixture();
  const { items } = itemsOf(fx.patch);
  const on = await libraryOn(t, { ...opts, init: `${dataPatchInit(fx.patch)}${opts.init ? `\n${opts.init}` : ''}` });
  await on.go('#library');
  await on.p.ev('localStorage.clear()');
  await on.go('#library');
  await on.soon(idsAre(items.map((x) => x.id)), 'a card per item');
  return { ...on, ...fx, items };
}
// the gateway's served map for libraryFixture, as x-devteam-public carries it
const servedOf = (ids) => ({ [ids.project]: { root: ids.root, port: 4321, artifacts: ids.served } });
// an artifact card by slug, in the page
const art = (slug) => card(`artifact:${slug}`);

test('a preview card keeps dev-links\' selectors', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, patch, ids } = await libraryAll(t);
  const live = patch.library.previews.find((x) => x.name === ids.pvLive);
  const sel = `[data-preview="${ids.pvLive}"]`;
  assert.deepEqual(await p.ev(`(() => { const c = document.querySelector('${sel}'); return { card: c.matches('#lib-grid > .lib-card'), live: !!c.querySelector('.badge.good'), copy: c.querySelector('[data-copy]').dataset.copy, copyText: c.querySelector('[data-copy]').textContent, open: c.querySelector('a.av-open').getAttribute('href') }; })()`),
    { card: true, live: true, copy: `http://127.0.0.1:${live.port}/`, copyText: 'Copy link', open: `/view/preview/${ids.pvLive}` }, 'data-preview, the live .badge.good, Copy link the first [data-copy], ↗ as a.av-open');
  // Copy link in the head, before ↗ and ⋯
  assert.equal(await p.ev(`(() => { const h = document.querySelector('${sel} .card-head'), k = [...h.children]; return k.at(-3).matches('[data-copy]'); })()`), true);
  // every preview card carries data-preview; no card has a preview's error span (the bar's alone)
  for (const x of patch.library.previews) {
    assert.equal(await p.ev(`document.querySelector('[data-preview="${x.name}"]')?.dataset.libId`), `preview:${x.name}`);
    assert.equal(await p.ev(`document.querySelectorAll('[id="e-preview-${x.name}"]').length`), 0, `${x.name}: no e-preview span on the Library`);
  }
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a card\'s head', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, items, ids } = await libraryAll(t);
  const heads = await p.ev(`[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => {
    const h = c.querySelector(':scope > .card-head'), k = [...h.children], m = h.querySelector(':scope > details.menu');
    const edge = h.getBoundingClientRect().right - parseFloat(getComputedStyle(h).paddingRight);
    return { id: c.dataset.libId, title: !!h.querySelector(':scope > .lib-title'), tab: k.at(-2).matches('a.lib-tab') && !!k.at(-2).querySelector('i.icon-external-link'), menu: k.at(-1).matches('details.menu'), right: Math.abs(m.getBoundingClientRect().right - edge) };
  })`);
  for (const [i, x] of items.entries()) {
    const h = heads[i];
    assert.equal(h.title, true, `${x.id}: the title in .card-head`);
    assert.equal(h.menu, true, `${x.id}: ⋯ last`);
    if (x.kind !== 'review') assert.equal(h.tab, true, `${x.id}: ↗ (a.lib-tab, icon-external-link) then ⋯`);
    else assert.equal(h.tab, false, `${x.id}: a review's head ends with ⋯ alone`);
    assert.ok(h.right <= 1, `${x.id}: ⋯ at the head's right edge (off by ${h.right}px)`);
  }
  // the drafts: the draft badge, then "in <worktree>" (the newest draft's)
  const draft = (slug) => p.ev(`(() => { const h = ${art(slug)}.querySelector('.card-head'), b = h.querySelector('.badge.amber'); return { badge: b?.textContent ?? null, afterTitle: !!b && h.querySelector('.lib-title').compareDocumentPosition(b) === Node.DOCUMENT_POSITION_FOLLOWING, in: b?.nextElementSibling?.textContent ?? null, wt: b?.nextElementSibling?.querySelector('a')?.getAttribute('href') ?? null }; })()`);
  // the worktree by its id, as the spec writes it, a link to its ticket
  assert.deepEqual(await draft(ids.drafted), { badge: 'draft', afterTitle: true, in: `in ${ids.wt2}`, wt: `#ticket/${ids.wt2}` }, 'the newest draft\'s worktree');
  assert.deepEqual(await draft(ids.draftOnly), { badge: 'draft', afterTitle: true, in: `in ${ids.wt1}`, wt: `#ticket/${ids.wt1}` });
  assert.equal(await p.ev(`!!${art(ids.docs)}.querySelector('.badge.amber')`), false, 'a landed card has no draft badge');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('clicks open the viewer, links a new tab', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids } = await libraryAll(t);
  const wt = ids.wt2, slug = ids.drafted;
  const c = `[data-lib-id="artifact:${slug}"]`;
  assert.deepEqual(await p.ev(`[document.querySelector('${c} .lib-title').getAttribute('href'), document.querySelector('${c} .lib-thumb').matches('a'), document.querySelector('${c} .lib-thumb').getAttribute('href')]`),
    [`#artifact/wt/${wt}/${slug}`, true, `#artifact/wt/${wt}/${slug}`], 'title and thumbnail open the newest draft');
  const viewer = `!document.getElementById('artifact-view').hidden && document.getElementById('av-frame').getAttribute('src').endsWith('/artifact/wt/${wt}/${slug}/')`;
  await p.click(`${c} .lib-title`);
  await soon(viewer, 'the title opens the viewer on the draft');
  assert.equal(await p.ev("document.getElementById('drawer').hidden"), true, 'no peek');
  await p.click('#av-close');
  await soon("document.getElementById('artifact-view').hidden && location.hash.startsWith('#library')", 'closed, back on the Library');
  await p.click(`${c} .lib-thumb`);
  await soon(viewer, 'the thumbnail opens the viewer on the draft');
  assert.equal(await p.ev("document.getElementById('drawer').hidden"), true, 'no peek');
  await p.click('#av-close');
  await soon("document.getElementById('artifact-view').hidden && location.hash.startsWith('#library')", 'closed again');
  // a link's title: a new tab, the page stays (the default is stopped last, so no real tab loads; the page's own handlers ran first)
  const lc = `[data-lib-id="link:${ids.linkUrl}"]`;
  assert.deepEqual(await p.ev(`[document.querySelector('${lc} .lib-title').getAttribute('href'), document.querySelector('${lc} .lib-title').getAttribute('target'), document.querySelector('${lc} .lib-thumb').getAttribute('href'), document.querySelector('${lc} .lib-thumb').getAttribute('target')]`),
    ['https://www.figma.com/file/pay-flow', '_blank', 'https://www.figma.com/file/pay-flow', '_blank']);
  const href = await p.ev(`(() => { window.__opened = []; window.__clicked = []; const o = window.open; window.open = (...a) => { window.__opened.push(a); return null; };
    window.addEventListener('click', (e) => { const a = e.target.closest('a'); window.__clicked.push({ href: a?.getAttribute('href') ?? null, target: a?.target ?? null, prevented: e.defaultPrevented }); e.preventDefault(); }, { once: true }); return location.href; })()`);
  await p.click(`${lc} .lib-title`);
  await soon('window.__clicked.length === 1', 'the click seen');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(await p.ev('[location.href, window.__opened.length, window.__clicked[0]]'), [href, 0, { href: 'https://www.figma.com/file/pay-flow', target: '_blank', prevented: false }], 'a new tab, the page unchanged');
  assert.deepEqual(await p.ev('window.__errors'), []);
  // a preview's title opens #preview/<name>; a review's #review/<qid>
  assert.equal(await p.ev(`document.querySelector('[data-lib-id="preview:${ids.pvLive}"] .lib-title').getAttribute('href')`), `#preview/${ids.pvLive}`);
  assert.equal(await p.ev(`document.querySelector('[data-lib-id="review:${ids.reviewQ}"] .lib-title').getAttribute('href')`), `#review/${ids.reviewQ}`);
  await p.click(`[data-lib-id="preview:${ids.pvLive}"] .lib-title`);
  await soon(`location.hash === '#preview/${ids.pvLive}' && !document.getElementById('artifact-view').hidden`, 'the preview in the viewer');
  await p.click('#av-close');
  await soon("document.getElementById('artifact-view').hidden && location.hash.startsWith('#library')", 'closed');
  await p.click(`[data-lib-id="review:${ids.reviewQ}"] .lib-title`);
  await soon(`location.hash === '#review/${ids.reviewQ}'`, 'the review page');
});

test('an artifact card\'s meta', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, ids } = await libraryAll(t);
  const meta = (slug) => p.ev(`(() => { const m = ${art(slug)}.querySelector('.lib-meta'); const by = m?.querySelector('.lib-by'), f = m?.querySelector('.lib-for');
    return { by: by ? [by.firstChild.textContent, [...by.querySelectorAll('a')].map((a) => a.getAttribute('href'))] : null, for: f ? [f.firstChild.textContent, [...f.querySelectorAll('a')].map((a) => a.getAttribute('href'))] : null, text: m?.textContent ?? '' }; })()`);
  const d = await meta(ids.drafted);
  assert.deepEqual([d.by, d.for], [['drawn by ', ['#planner/pay']], ['for ', [`#feature/${ids.feat1}`]]], 'the planner\'s session; the feature');
  assert.equal(await p.ev(`${art(ids.drafted)}.querySelector('.lib-for a').textContent === DATA.ooda.roadmap.features[${JSON.stringify(ids.feat1)}].title`), true, 'the feature by its title');
  const pub = await meta(ids.public);
  assert.deepEqual([pub.by, pub.for], [['drawn by ', ['#planner/pay']], ['for ', [`#goal/${ids.goal1}`]]], 'a goal');
  const nl = await meta(ids.notLive);
  assert.deepEqual([nl.by, nl.for], [['drawn by ', [`#ticket/${ids.tHeld}`]], ['for ', [`#ticket/${ids.tHeld}`]]], 'a ticket\'s session; a ticket');
  const broken = await meta(ids.broken);
  assert.equal(broken.by, null, 'no by: no drawn by');
  assert.ok(!broken.text.includes('drawn by'));
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the ⋯ menu', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, items } = await libraryAll(t);
  const menus = await p.ev(`[...document.querySelectorAll('#lib-grid > .lib-card')].map((c) => { const m = c.querySelector('.card-head > details.menu'); const b = (s) => [...m.querySelectorAll(s)].map((x) => [x.textContent, x.dataset.copy ?? x.dataset.menuOpen]);
    return { id: c.dataset.libId, kv: m.querySelector('.kv code')?.textContent, copy: b('[data-copy]').filter(([s]) => s === 'Copy ID'), peek: b('[data-menu-open]') }; })`);
  for (const [i, x] of items.entries()) {
    assert.deepEqual(menus[i], { id: x.id, kv: x.id, copy: [['Copy ID', x.id]], peek: [['Open in side peek', `lib/${x.id}`]] }, `${x.id}: ID, Copy ID, Open in side peek`);
  }
});

test('the gap-audit rows off a box', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, patch, ids } = await libraryAll(t);
  const text = (id) => p.ev(`${card(id)}.textContent.replace(/\\s+/g, ' ')`);
  const badges = (id) => p.ev(`[...${card(id)}.querySelectorAll('.card-head .badge')].map((b) => b.textContent)`);
  // each preview state, its name, project, session (a link) and offered
  const states = { [ids.pvLive]: 'live', [ids.pvChecking]: 'checking', [ids.pvNotRunning]: 'not running', [ids.pvDown]: 'not answering', [ids.pvExpired]: 'expired' };
  for (const x of patch.library.previews) {
    const id = `preview:${x.name}`;
    assert.ok((await badges(id)).includes(states[x.name]), `${x.name}: its state`);
    const s = await text(id);
    assert.ok(s.includes(x.name) && s.includes(x.project) && s.includes('offered '), `${x.name}: name, project, offered: ${s}`);
    assert.equal(await p.ev(`${card(id)}.querySelector('.lib-body code')?.textContent`), x.name, `${x.name}: the name in code`);
  }
  assert.equal(await p.ev(`${card(`preview:${ids.pvLive}`)}.querySelector('.lib-body a[href="#ticket/${ids.tBuilding}"]') !== null`), true, 'the session a link');
  assert.ok((await text(`preview:${ids.pvDown}`)).includes('down since '), 'not answering: down since');
  const live = patch.library.previews.find((x) => x.name === ids.pvLive);
  assert.equal(await p.ev(`${card(`preview:${ids.pvLive}`)}.querySelector('[data-copy]').dataset.copy`), `http://127.0.0.1:${live.port}/`, 'Copy link on the live card');
  for (const x of [ids.pvNotRunning, ids.pvDown, ids.pvExpired]) assert.equal(await p.ev(`[...${card(`preview:${x}`)}.querySelectorAll('[data-copy]')].some((b) => b.textContent === 'Copy link')`), false, `${x}: no Copy link`);
  // no Start or Stop on any card
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#lib-grid *')].filter((e) => ['Start', 'Stop'].includes(e.textContent.trim())).length"), 0, 'no Start or Stop');
  assert.equal(await p.ev("document.querySelectorAll('#lib-grid [data-preview-start], #lib-grid [data-preview-stop]').length"), 0);
  // the broken card
  assert.deepEqual(await badges(`artifact:${ids.broken}`), ['broken']);
  assert.equal(await p.ev(`${art(ids.broken)}.querySelector('.card-head .badge').matches('.badge.high')`), true);
  assert.ok((await text(`artifact:${ids.broken}`)).includes('manifest.json: title is missing'), 'its error');
  // each link: kind badge, id, location, for, notes
  for (const l of patch.library.links) {
    const id = `link:${l.id}`;
    const s = await text(id);
    assert.equal(await p.ev(`${card(id)}.querySelector('.lib-body .badge')?.textContent`), l.kind, `${l.id}: its kind`);
    assert.equal(await p.ev(`[...${card(id)}.querySelectorAll('.lib-body code')].some((c) => c.textContent === ${JSON.stringify(l.id)})`), true, `${l.id}: its id`);
    const loc = l.url || (l.remote ? `${l.remote}${l.path ? `:${l.path}` : ''}` : l.path);
    assert.ok(s.includes(loc), `${l.id}: its location ${loc}`);
    if (l.notes) assert.ok(s.includes(l.notes), `${l.id}: its notes`);
    if (l.for.length) assert.ok(s.includes('for '), `${l.id}: for`);
  }
  assert.equal(await p.ev(`${card(`link:${ids.linkUrl}`)}.querySelector('.lib-body a[href="#goal/${ids.goal1}"]') !== null`), true, 'for: a goal link');
  // published, off a box; no Public badge
  assert.ok((await badges(`artifact:${ids.public}`)).includes('published'), 'published off a box');
  assert.ok(!(await badges(`artifact:${ids.public}`)).includes('Public'));
  assert.ok((await text(`artifact:${ids.public}`)).includes('recorded '), 'when it was recorded');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('publish on the card (box)', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, port, ids } = await libraryAll(t, { fx, box: servedOf(fx.ids) });
  assert.equal(await p.ev("typeof PUBLIC === 'object' && !!PUBLIC && location.host.startsWith('4321.box.localhost')"), true, 'on the box');
  const pub = art(ids.public);
  assert.deepEqual(await p.ev(`(() => { const c = ${pub}, b = c.querySelector('.lib-title').nextElementSibling; return { good: b.matches('.badge.good'), globe: !!b.querySelector('i.icon-globe'), text: b.textContent.trim(), dot: !!c.querySelector('.dot'), live: /\\blive\\b/i.test(c.textContent), border: getComputedStyle(c).borderColor === getComputedStyle(${art(ids.docs)}).borderColor }; })()`),
    { good: true, globe: true, text: 'Public', dot: false, live: false, border: true }, 'Public with a globe, after the title; no dot, no live, the plain border');
  const text = (slug) => p.ev(`${art(slug)}.textContent.replace(/\\s+/g, ' ')`);
  const s = await text(ids.public);
  assert.ok(s.includes('Public on this box') && /recorded .+ from the dashboard/.test(s), `publish details: ${s}`);
  assert.ok((await text(ids.drift)).includes('changed on main since'), 'drift');
  // drift in amber: its computed colour is --amber-fg's (resolved on a probe beside it)
  assert.deepEqual(await p.ev(`(() => { const d = ${art(ids.drift)}.querySelector('.lib-drift'), x = document.createElement('span'); x.style.color = 'var(--amber-fg)'; d.after(x); const want = getComputedStyle(x).color; x.remove(); return [d.textContent, getComputedStyle(d).color === want, want !== getComputedStyle(${art(ids.drift)}).color]; })()`), ['changed on main since', true, true], 'drift in amber');
  // not live: the badge, Restore (the gateway's publish page, a new tab), the error span, Forget in ⋯
  const box = `http://box.localhost:${port}`;
  const nl = art(ids.notLive);
  assert.ok((await text(ids.notLive)).includes('not live on this box'));
  assert.deepEqual(await p.ev(`(() => { const a = [...${nl}.querySelectorAll('a')].find((x) => x.textContent === 'Restore'); return a && [a.getAttribute('href'), a.target]; })()`), [`${box}/public/publish?port=4321&slug=${ids.notLive}`, '_blank']);
  assert.equal(await p.ev(`${nl}.querySelector('#e-pub-${ids.notLive}') !== null`), true, 'its error span');
  assert.equal(await p.ev(`${nl}.querySelector('.card-head details.menu [data-forget="${ids.notLive}"]')?.textContent`), 'Forget', 'Forget in ⋯');
  assert.equal(await p.ev("[...document.querySelectorAll('#lib-top a')].some((a) => a.textContent === 'Restore all')"), true, 'Restore all above the grid');
  // the public card's ⋯: Copy public link
  assert.equal(await p.ev(`[...${pub}.querySelectorAll('.card-head details.menu [data-copy]')].find((b) => b.textContent === 'Copy public link')?.dataset.copy`), `http://public.box.localhost:${port}/${ids.project}/${ids.public}/`);
  assert.deepEqual(await p.ev(ERRORS), []);
});

test('no publish buttons on any card (box)', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, port, ids } = await libraryAll(t, { fx, box: servedOf(fx.ids) });
  const badges = (slug) => p.ev(`[...${art(slug)}.querySelectorAll('.card-head .badge')].map((b) => b.textContent.trim())`);
  // every state drawn: public, public with an update, drifted and not live, not live
  assert.ok((await badges(ids.public)).includes('Public'));
  assert.ok((await badges(ids.pubUpdate)).includes('Public'));
  assert.ok((await badges(ids.drift)).includes('not live on this box'));
  assert.ok((await badges(ids.notLive)).includes('not live on this box'));
  const WORDS = ['Unpublish', 'Update', 'Publish', 'Start', 'Stop', "Review main's version"];
  assert.deepEqual(await p.ev(`[...document.querySelectorAll('#lib-grid *')].map((e) => e.textContent.trim()).filter((s) => ${JSON.stringify(WORDS)}.includes(s))`), [], 'none of the publish or preview buttons, menus included');
  // the gateway's pages: Restore alone, on a not-live card
  assert.deepEqual(await p.ev(`[...new Set([...document.querySelectorAll('#lib-grid a[href]')].filter((a) => a.getAttribute('href').startsWith(${JSON.stringify(`http://box.localhost:${port}/`)})).map((a) => a.textContent))]`), ['Restore']);
  assert.deepEqual(await p.ev(ERRORS), []);
});

// an init after dataPatchInit: the server refuses POST /api/artifact-publish with 400 {"error":"no"}
const FORGET_FAILS = `(() => {
  const f = window.fetch;
  window.fetch = (u, o) => (String(u && u.url ? u.url : u).startsWith('/api/artifact-publish') && String(o?.method || 'GET').toUpperCase() === 'POST'
    ? Promise.resolve(new Response(JSON.stringify({ error: 'no' }), { status: 400, headers: { 'content-type': 'application/json' } })) : f(u, o));
})();`;

test('a refused Forget says why (box)', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { p, soon, ids } = await libraryAll(t, { fx, box: servedOf(fx.ids), init: FORGET_FAILS });
  const c = `[data-lib-id="artifact:${ids.notLive}"]`;
  await p.click(`${c} .card-head details.menu > summary`);
  await soon(`document.querySelector('${c} .card-head details.menu').open`, 'the ⋯ open');
  await p.click(`${c} [data-forget]`);
  await soon(`document.querySelector('${c} [data-forget]').textContent === 'Confirm forget'`, 'the confirm step');
  await p.click(`${c} [data-forget]`);
  await soon(`document.getElementById('e-pub-${ids.notLive}').textContent.includes('no')`, 'the refusal in e-pub');
  assert.equal(await p.ev(`document.getElementById('e-pub-${ids.notLive}').textContent`), 'Not saved: no');
  assert.equal(await p.ev(`document.querySelector('${c}').contains(document.getElementById('e-pub-${ids.notLive}'))`), true, 'on the card');
  assert.deepEqual(await p.ev(ERRORS), []);
});

test('a draft\'s worktree truncates in the head', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { patch, ids } = fx;
  // the newest draft in a worktree with a long id, its ticket a very long title
  const WT = `pay-99-${'a-very-long-worktree-name-'.repeat(4)}end`;
  const base = patch.tickets.find((x) => x.id === ids.wt2);
  patch.tickets = [...patch.tickets, { ...base, id: WT, title: `The refund screen, ${'with every state the processor can answer in, '.repeat(6)}end` }];
  patch.library.artifacts.find((a) => a.slug === ids.drafted && a.at === ids.wt2).at = WT;
  const { p } = await libraryAll(t, { fx });
  const m = await p.ev(`(() => { const c = ${art(ids.drafted)}, h = c.querySelector('.card-head'), w = h.querySelector('.lib-wt'), r = h.getBoundingClientRect(), edge = r.right - parseFloat(getComputedStyle(h).paddingRight);
    const plain = ${art(ids.docs)}.querySelector('.card-head').getBoundingClientRect().height;
    return { text: w.textContent, href: w.querySelector('a').getAttribute('href'), tip: w.querySelector('a').title.startsWith('The refund screen'), cut: w.scrollWidth > w.clientWidth, tab: h.querySelector(':scope > .lib-tab').getBoundingClientRect().right <= edge + 1, menu: h.querySelector(':scope > details.menu').getBoundingClientRect().right <= edge + 1, title: (() => { const x = h.querySelector('.lib-title'); return { wide: x.getBoundingClientRect().width >= 40, cut: x.scrollWidth > x.clientWidth }; })(), height: r.height === plain, cardRight: h.querySelector(':scope > details.menu').getBoundingClientRect().right <= c.getBoundingClientRect().right }; })()`);
  assert.deepEqual(m, { text: `in ${WT}`, href: `#ticket/${WT}`, tip: true, cut: true, tab: true, menu: true, title: { wide: true, cut: true }, height: true, cardRight: true }, 'the worktree id, cut short; the title keeps 40px or more, truncated; ↗ and ⋯ inside the head; the head\'s height unchanged');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('served by another instance: from instance <port> (box)', { ...CHROME, timeout: 300000 }, async (t) => {
  // the box serves this project's copy from instance 4399, not this page's 4321
  const fx = libraryFixture();
  const box = servedOf(fx.ids);
  box[fx.ids.project].port = 4399;
  const { p, ids } = await libraryAll(t, { fx, box });
  const s = await p.ev(`${art(ids.public)}.textContent.replace(/\\s+/g, ' ')`);
  assert.ok(s.includes('from instance 4399') && !s.includes('Public on this box'), `from instance: ${s}`);
  assert.deepEqual(await p.ev(ERRORS), []);
});

// ---- in Chrome (kit-92 T4): thumbnails: sandboxed frames in view, at most 12, the icon after 5 s ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A page with a second DevTools connection that hears its events (the helper's own drops them): Fetch on
// patterns, each paused request given to paused(params, reply), reply(method, params) answering on the
// session it came from; children: also auto-attached to child frame targets (flatten), Fetch on each, so a
// sandboxed frame in its own process is held too. Its close() closes both connections.
async function tapPage(chrome, { patterns, paused, children = false }) {
  const dir = chrome.proc.spawnargs.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  const portFile = path.join(dir, 'DevToolsActivePort');
  for (let i = 0; !(fs.existsSync(portFile) && /^\d+\n/.test(fs.readFileSync(portFile, 'utf8'))); i++) {
    if (i > 200) throw new Error('no DevToolsActivePort');
    await sleep(50);
  }
  const dt = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const list = async () => (await fetch(`http://127.0.0.1:${dt}/json/list`)).json();
  const before = new Set((await list()).map((x) => x.id));
  const p = await chrome.newPage();
  const target = (await list()).find((x) => x.type === 'page' && !before.has(x.id));
  assert.ok(target, 'the new page target');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('could not reach the page for the tap')); });
  let seq = 0;
  const waiting = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const quiet = (method, params, sessionId) => { send(method, params, sessionId).catch(() => {}); };
  const attach = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };
  const sessions = [];
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data);
    if (o.id !== undefined) { const w = waiting.get(o.id); if (!w) return; waiting.delete(o.id); if (o.error) w.reject(new Error(o.error.message)); else w.resolve(o.result); return; }
    if (o.method === 'Fetch.requestPaused') paused(o.params, (method, params) => quiet(method, params, o.sessionId));
    if (o.method === 'Target.attachedToTarget' && children) {
      const s = o.params.sessionId;
      sessions.push(o.params.targetInfo);
      quiet('Fetch.enable', { patterns }, s);
      quiet('Target.setAutoAttach', attach, s);
    }
  };
  ws.onclose = () => { for (const [id, w] of waiting) { waiting.delete(id); w.reject(new Error('the tap connection closed')); } };
  await send('Fetch.enable', { patterns });
  if (children) await send('Target.setAutoAttach', attach);
  const close = p.close;
  return { ...p, sessions, close: () => { try { ws.close(); } catch {} close(); } };
}
// an init that records every thumbnail frame put in and taken out, with the page's clock: window.__frames,
// { id: its card's, in, out }, and each box's data-thumb change: window.__states, { id, v, t }
const FRAMES_INIT = `(() => {
  window.__frames = [];
  window.__states = [];
  const frames = (n) => (n.nodeName === 'IFRAME' ? [n] : n.querySelectorAll ? [...n.querySelectorAll('iframe')] : []);
  new MutationObserver((ms) => {
    const t = performance.now();
    for (const m of ms) {
      if (m.type === 'attributes') { window.__states.push({ id: m.target.closest('.lib-card')?.dataset.libId ?? null, v: m.target.dataset.thumb ?? null, t }); continue; }
      for (const n of m.addedNodes) for (const f of frames(n)) if (f.parentElement?.classList.contains('lib-thumb')) window.__frames.push({ el: f, id: f.closest('.lib-card')?.dataset.libId ?? null, in: t });
      for (const n of m.removedNodes) for (const f of frames(n)) { const r = window.__frames.find((x) => x.el === f); if (r && r.out === undefined) r.out = t; }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-thumb'] });
})();`;
const FRAMES = "window.__frames.map(({ id, in: a, out }) => ({ id, in: a, out: out ?? null }))";
// what is in view (the window scrolls): the boxes intersecting it, those with a frame source, the frames
const VIEW = `(() => {
  const H = innerHeight, inv = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < H; };
  const boxes = [...document.querySelectorAll('#lib-grid .lib-thumb')], id = (b) => b.closest('.lib-card').dataset.libId;
  return { frames: document.querySelectorAll('#lib-grid .lib-thumb iframe').length, inView: boxes.filter(inv).map(id), srcInView: boxes.filter((b) => inv(b) && b.dataset.thumbSrc).length,
    holding: boxes.filter((b) => b.querySelector('iframe')).map((b) => ({ id: id(b), inView: inv(b) })) };
})()`;
// the page at #library once, every card drawn (a fresh profile: no remembered filter)
async function libraryOnce(t, fx, opts = {}) {
  const { items } = itemsOf(fx.patch);
  const on = await libraryOn(t, { ...opts, init: `${dataPatchInit(fx.patch)}${opts.init ? `\n${opts.init}` : ''}` });
  await on.go('#library');
  await on.soon(idsAre(items.map((x) => x.id)), 'a card per item');
  return { ...on, ...fx, items };
}
const thumb = (id) => `${card(id)}.querySelector('.lib-thumb')`;

test('thumbnail frames are sandboxed, lazy and inert', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon } = await libraryAll(t);
  await soon("document.querySelectorAll('#lib-grid .lib-thumb > iframe').length > 0", 'a thumbnail frame');
  const fs_ = await p.ev(`[...document.querySelectorAll('#lib-grid .lib-thumb iframe')].map((f) => { const b = f.parentElement, r = f.getBoundingClientRect(), q = b.getBoundingClientRect(), s = getComputedStyle(b);
    return { parent: b.matches('.lib-thumb'), sandbox: f.getAttribute('sandbox'), loading: f.getAttribute('loading'), lazy: f.loading, events: getComputedStyle(f).pointerEvents, tabindex: f.getAttribute('tabindex'), hidden: f.getAttribute('aria-hidden'),
      src: f.getAttribute('src') === b.dataset.thumbSrc, state: b.dataset.thumb, ratio: Math.abs(q.width / q.height - 16 / 9) < 0.03,
      fills: Math.abs(r.width - b.clientWidth) <= 1 && Math.abs(r.height - b.clientHeight) <= 1 && Math.abs(r.left - q.left - b.clientLeft) <= 1 && Math.abs(r.top - q.top - b.clientTop) <= 1 }; })`);
  assert.ok(fs_.length > 0);
  for (const f of fs_) assert.deepEqual(f, { parent: true, sandbox: 'allow-scripts', loading: 'lazy', lazy: 'lazy', events: 'none', tabindex: '-1', hidden: 'true', src: true, state: 'live', ratio: true, fills: true }, 'a sandboxed, lazy, inert frame filling its 16:9 box');
  // every box says its state; one with no frame source never holds a frame
  const states = await p.ev("[...document.querySelectorAll('#lib-grid .lib-thumb')].map((b) => [b.dataset.thumbSrc, b.dataset.thumb ?? null, !!b.querySelector('iframe')])");
  for (const [src, state, frame] of states) {
    assert.ok(['icon', 'live', 'failed'].includes(state), `a box's state: ${state}`);
    if (!src) assert.deepEqual([state, frame], ['icon', false], 'no source: the icon');
  }
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('at most 12 live, only in view', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon } = await libraryAll(t, { fx: libraryFixture({ artifacts: 60 }), height: 3000 });
  await soon(`${VIEW}.frames === 12`, 'twelve frames');
  await sleep(1500);
  const top = await p.ev(VIEW);
  assert.ok(top.srcInView > 12, `more than 12 boxes with a frame source in view (${top.srcInView})`);
  assert.equal(top.frames, 12, 'exactly 12 frames');
  assert.ok(top.holding.every((h) => h.inView), 'every frame in view');
  await p.ev('window.scrollTo(0, document.scrollingElement.scrollHeight)');
  const was = JSON.stringify(top.holding.map((h) => h.id));
  await soon(`(() => { const v = ${VIEW}; return v.frames === 12 && v.holding.every((h) => h.inView) && !v.holding.some((h) => ${was}.includes(h.id)); })()`, 'twelve frames, all at the bottom');
  await sleep(1500);
  const bottom = await p.ev(VIEW);
  assert.ok(bottom.srcInView > 12, `more than 12 boxes with a frame source in view at the bottom (${bottom.srcInView})`);
  assert.equal(bottom.frames, 12, 'exactly 12 frames at the bottom');
  assert.ok(bottom.holding.every((h) => h.inView), 'every frame in view at the bottom');
  const tops = top.inView;
  assert.ok(tops.every((id) => !bottom.inView.includes(id)), 'the top boxes are out of view');
  assert.ok(bottom.holding.every((h) => !tops.includes(h.id)), 'the top boxes hold none');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a frame that never loads falls back after 5 s', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { ids } = fx;
  const held = [];
  // the slow artifact's request, paused and never continued, wherever the frame's request is made
  const page = (chrome) => tapPage(chrome, { patterns: [{ urlPattern: `*/artifact/main/${ids.slow}/*` }], children: true, paused: (o) => { held.push(o.request.url); } });
  const { p, soon } = await libraryOnce(t, fx, { height: 3000, init: FRAMES_INIT, page });
  const slow = `artifact:${ids.slow}`, ok = `artifact:${ids.mock}`;
  const rec = `window.__frames.find((f) => f.id === ${JSON.stringify(slow)})`;
  await soon(`!!${rec}`, 'a frame put in the slow box');
  const t0 = Date.now();
  while (!held.some((u) => u.includes(`/artifact/main/${ids.slow}/`))) {
    if (Date.now() - t0 > 3000) assert.fail(`no paused request for the slow frame within 3 s (held: ${JSON.stringify(held)})`);
    await sleep(50);
  }
  // the page's own clock throughout: data-thumb-at is stamped before its wait starts, and the observer stamps
  // a frame's going out and each data-thumb change no earlier than it happened
  const at = Number(await p.ev(`${thumb(slow)}.dataset.thumbAt`));
  assert.ok(at > 0, 'the box stamped when its frame went in');
  await soon(`${thumb(slow)}.dataset.thumb === 'failed' || performance.now() - ${at} > 8000`, 'the fallback');
  const after = await p.ev(`({ gone: ${rec}.out - ${at}, frame: !!${thumb(slow)}.querySelector('iframe'), state: ${thumb(slow)}.dataset.thumb, icon: !!${thumb(slow)}.querySelector(':scope > i.icon-layout-dashboard'),
    states: window.__states.filter((s) => s.id === ${JSON.stringify(slow)} && s.t >= ${at}).map((s) => [s.v, s.t - ${at}]) })`);
  assert.equal(after.state, 'failed', 'data-thumb="failed"');
  assert.equal(after.frame, false, 'no frame');
  assert.equal(after.icon, true, 'the kind\'s icon');
  // still a frame, and live, at its own stamp + 4 s: nothing but live before the frame went out
  assert.ok(after.gone > 4000, `a frame at 4 s (out at ${after.gone} ms)`);
  assert.ok(after.states.every(([v, dt]) => v === 'live' || dt >= 5000), `live until the fallback: ${JSON.stringify(after.states)}`);
  assert.ok(after.gone >= 5000 && after.gone <= 7000, `taken out between 5 and 7 s (${after.gone} ms)`);
  // not retried; one that loads keeps its frame
  await sleep(1500);
  assert.deepEqual(await p.ev(`[${thumb(slow)}.dataset.thumb, !!${thumb(slow)}.querySelector('iframe'), window.__frames.filter((f) => f.id === ${JSON.stringify(slow)}).length]`), ['failed', false, 1], 'not retried');
  assert.deepEqual(await p.ev(`[${thumb(ok)}.dataset.thumb, !!${thumb(ok)}.querySelector('iframe')]`), ['live', true], 'a normal box keeps its frame');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a refused preview frame is the icon', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { ids } = fx;
  const { p, soon } = await libraryOnce(t, fx, { init: FRAMES_INIT });
  const live = `preview:${ids.pvLive}`;
  // on 127.0.0.1 the page's frame-src allows no preview's own origin
  assert.match(await p.ev(`${thumb(live)}.dataset.thumbSrc`), /^http:\/\/127\.0\.0\.1:\d+\/$/);
  await p.ev(`${card(live)}.scrollIntoView({ block: 'center' })`);
  const rec = `window.__frames.find((f) => f.id === ${JSON.stringify(live)})`;
  await soon(`!!${rec}`, 'a frame put in the live preview\'s box');
  await soon(`${thumb(live)}.dataset.thumb === 'failed'`, 'the refused frame failed');
  const r = await p.ev(`({ gone: ${rec}.out === undefined ? null : ${rec}.out - ${rec}.in, frame: !!${thumb(live)}.querySelector('iframe'), icon: !!${thumb(live)}.querySelector(':scope > i.icon-monitor-play') })`);
  assert.ok(r.gone !== null && r.gone < 1000, `taken out within 1 s (${r.gone} ms)`);
  assert.deepEqual([r.frame, r.icon], [false, true], 'the icon, no frame');
  await sleep(1500);
  const notLive = [ids.pvChecking, ids.pvNotRunning, ids.pvDown, ids.pvExpired].map((n) => `preview:${n}`);
  assert.deepEqual(await p.ev(`[${thumb(live)}.dataset.thumb, !!${thumb(live)}.querySelector('iframe'), window.__frames.filter((f) => f.id === ${JSON.stringify(live)}).length]`), ['failed', false, 1], 'never a frame past that, not retried');
  const inView = await p.ev(VIEW);
  for (const id of notLive) assert.ok(inView.inView.includes(id), `${id} in view`);
  assert.deepEqual(await p.ev(`${FRAMES}.filter((f) => ${JSON.stringify(notLive)}.includes(f.id))`), [], 'a preview that isn\'t live never had a frame');
  for (const id of notLive) assert.equal(await p.ev(`${thumb(id)}.dataset.thumb`), 'icon', `${id}: the icon`);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a link shows its site icon', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { ids } = fx;
  const asked = [];
  // figma's icon held (so it stays), github's refused (so it is removed)
  const page = (chrome) => tapPage(chrome, { patterns: [{ urlPattern: 'https://www.figma.com/favicon.ico' }, { urlPattern: 'https://github.com/favicon.ico' }], paused: (o, reply) => {
    asked.push(o.request.url);
    if (o.request.url.startsWith('https://github.com/')) reply('Fetch.failRequest', { requestId: o.requestId, errorReason: 'Failed' });
  } });
  const { p, soon } = await libraryOnce(t, fx, { init: FRAMES_INIT, page });
  const url = `link:${ids.linkUrl}`, remote = `link:${ids.linkRemote}`, file = `link:${ids.linkPath}`;
  await p.ev(`${card(url)}.scrollIntoView({ block: 'center' })`);
  const seen = (id) => p.ev(`(() => { const b = ${thumb(id)}, i = b.querySelector('img'); return { img: i ? [i.getAttribute('src'), i.getAttribute('referrerpolicy')] : null, text: b.textContent.trim(), icon: !!b.querySelector('i.icon-link'), frame: !!b.querySelector('iframe') }; })()`);
  assert.deepEqual(await seen(url), { img: ['https://www.figma.com/favicon.ico', 'no-referrer'], text: 'www.figma.com', icon: false, frame: false }, 'the site\'s icon and its host');
  // an icon that fails is removed; the host stays
  await soon(`!${thumb(remote)}.querySelector('img')`, 'the failed icon removed');
  assert.ok(asked.includes('https://github.com/favicon.ico'), 'github\'s icon was asked for');
  assert.deepEqual(await seen(remote), { img: null, text: 'github.com', icon: true, frame: false }, 'its host, the link icon');
  assert.deepEqual(await seen(file), { img: null, text: '', icon: true, frame: false }, 'no host: the link icon');
  await sleep(1000);
  assert.deepEqual(await p.ev(`${FRAMES}.filter((f) => f.id.startsWith('link:'))`), [], 'never a frame in a link\'s box');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a poll keeps a live frame', { ...CHROME, timeout: 300000 }, async (t) => {
  const fx = libraryFixture();
  const { ids } = fx;
  const { p, soon } = await libraryAll(t, { fx, init: READS_INIT });
  const id = `artifact:${ids.mock}`;
  await soon(`!!${thumb(id)}.querySelector('iframe')`, 'a live frame');
  await p.ev(`${thumb(id)}.querySelector('iframe').__mark = 'kept'`);
  const reads = await p.ev('window.__dataReads');
  await soon(`window.__dataReads >= ${reads + 3}`, 'two more polls');
  assert.deepEqual(await p.ev(`(() => { const f = ${thumb(id)}.querySelector('iframe'); return [f?.__mark ?? null, f?.isConnected ?? false, ${thumb(id)}.dataset.thumb]; })()`), ['kept', true, 'live'], 'the same frame in its box');
  // another card changes: the grid is patched (that card drawn anew), and the marked frame is still the same element
  const other = `artifact:${ids.docs}`;
  await p.ev(`${card(other)}.__mark = 'old'`);
  await p.ev(`window.__fx.library.artifacts.find((a) => a.slug === ${JSON.stringify(ids.docs)}).summary = 'Now it shows the new guide'`);
  await soon(`${card(other)}.querySelector('.lib-body').textContent.includes('Now it shows the new guide')`, 'the other card patched');
  assert.equal(await p.ev(`${card(other)}.__mark ?? null`), null, 'the other card is a new node');
  assert.deepEqual(await p.ev(`(() => { const f = ${thumb(id)}.querySelector('iframe'); return [f?.__mark ?? null, f?.isConnected ?? false, ${thumb(id)}.dataset.thumb]; })()`), ['kept', true, 'live'], 'the same frame after a patch');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a card removed by a poll frees its slot', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon } = await libraryAll(t, { fx: libraryFixture({ artifacts: 60 }), height: 3000 });
  await soon(`${VIEW}.frames === 12`, 'twelve frames');
  await sleep(1000);
  const before = await p.ev(VIEW);
  assert.ok(before.srcInView > 12, `more than 12 boxes with a frame source in view (${before.srcInView})`);
  const gone = before.holding.map((h) => h.id).find((id) => id.startsWith('artifact:bulk-'));
  assert.ok(gone, 'a framed bulk card');
  const slug = gone.slice('artifact:'.length);
  await p.ev(`window.__fx.library.artifacts = window.__fx.library.artifacts.filter((a) => a.slug !== ${JSON.stringify(slug)})`);
  await soon(`!${card(gone)}`, 'the card patched away');
  const was = JSON.stringify(before.holding.map((h) => h.id));
  await soon(`(() => { const v = ${VIEW}; return v.frames === 12 && v.holding.some((h) => !${was}.includes(h.id)); })()`, 'its slot taken by the next box in view');
  await sleep(1000);
  const after = await p.ev(VIEW);
  assert.equal(after.frames, 12, 'exactly 12 frames');
  assert.ok(after.holding.every((h) => h.inView && h.id !== gone), 'every frame in a box in view that still exists');
  // nothing the thumbnails keep is a box no longer in the page (its observer let go of it)
  assert.deepEqual(await p.ev('[THUMBS.watched, THUMBS.seen, THUMBS.live].map((s) => [...s].filter((b) => !b.isConnected).length)'), [0, 0, 0], 'no detached box kept');
  assert.equal(await p.ev("[...document.querySelectorAll('iframe')].filter((f) => f.closest('.lib-thumb') && !f.closest('#lib-grid')).length"), 0);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

// ---- in Chrome (kit-92 T5): an item's side peek, properties first ----

// the peek as drawn: shown, its bar's type badge and title, its properties (dt, dd text, dd's links), what follows them
const PEEK = `(() => { const d = document.getElementById('drawer'), b = document.getElementById('drawer-body');
  const dl = b.querySelector('section.attrs > dl.props');
  const rows = dl ? [...dl.querySelectorAll(':scope > dt')].map((dt) => { const dd = dt.nextElementSibling; return [dt.textContent, dd.textContent, [...dd.querySelectorAll('a')].map((a) => a.getAttribute('href'))]; }) : [];
  const after = dl ? [...b.querySelector('section.attrs').parentElement.children].filter((e) => b.querySelector('section.attrs').compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) : [];
  return { shown: !d.hidden, type: document.querySelector('#drawer-bar-title .dtype .badge')?.textContent ?? null, title: document.querySelector('#drawer-bar-title .dtitle')?.textContent ?? null, rows,
    thumb: after[0]?.matches('.lib-thumb') ?? false, thumbW: after[0] ? Math.round(after[0].getBoundingClientRect().width) : 0, bodyW: Math.round(b.clientWidth - parseFloat(getComputedStyle(b).paddingLeft) - parseFloat(getComputedStyle(b).paddingRight)),
    measure: after[1]?.matches('.measure') ? after[1].textContent : null }; })()`;
// the properties' order: each row a peek can have, in the spec's order; a link's (its Kind the item's Kind row) Where, For, Notes
const LIB_ORDER = ['ID', 'Kind', 'Drawn by', 'For', 'Where', 'State', 'Published', 'Error', 'Updated', 'How it changes'];
const LINK_ORDER = ['ID', 'Kind', 'Where', 'For', 'Notes', 'Updated', 'How it changes'];

test('Open in side peek opens the item\'s properties', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids, items } = await libraryAll(t);
  const id = `artifact:${ids.drafted}`;
  const x = items.find((i) => i.id === id);
  const sel = `#lib-grid > .lib-card[data-lib-id="${id}"] .card-head details.menu`;
  await p.click(`${sel} > summary`);
  await soon(`document.querySelector('${sel}').open`, 'the ⋯ menu open');
  await p.click(`${sel} [data-menu-open]`);
  // the menu writes it encoded, #lib/artifact%3A<slug>
  await soon(`decodeURIComponent(location.hash) === ${JSON.stringify(`#lib/${id}`)} && !document.getElementById('drawer').hidden`, 'the peek on the item');
  await soon(`${PEEK}.rows.length > 3`, 'its properties');
  const pk = await p.ev(PEEK);
  assert.equal(pk.shown, true);
  assert.equal(pk.type, 'Library item', 'the bar\'s type badge');
  assert.equal(pk.title, x.title, 'the item\'s title in the bar');
  assert.deepEqual(pk.rows[0].slice(0, 2), ['ID', id], 'ID first, the item id');
  const dts = pk.rows.map((r) => r[0]);
  assert.deepEqual(dts, ['ID', 'Kind', 'Drawn by', 'For', 'Where', 'Updated', 'How it changes'], 'the drafted artifact\'s properties, in order');
  const row = (k) => pk.rows.find((r) => r[0] === k);
  assert.match(row('Kind')[1], /Mock/);
  assert.deepEqual(row('Drawn by')[2], [`#planner/${ids.feat1}`], 'Drawn by: a link to the session');
  assert.deepEqual(row('For')[2], [`#feature/${ids.feat1}`]);
  assert.match(row('Where')[1], new RegExp(`draft.*in ${ids.wt2}`), 'the newest draft\'s worktree');
  assert.deepEqual(row('Where')[2], [`#ticket/${ids.wt2}`]);
  assert.equal(row('How it changes')[1], 'Shift+click it and say so in a thread');
  // then the thumbnail at the peek's width, then the summary
  assert.equal(pk.thumb, true, 'the thumbnail box after the properties');
  assert.ok(Math.abs(pk.thumbW - pk.bodyW) <= 1, `the thumbnail at the peek's width (${pk.thumbW} against ${pk.bodyW})`);
  assert.equal(pk.measure, x.summary, 'the summary');
  // a published one has Published, with its details, in its place; a broken one its Error
  await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(`artifact:${ids.public}`)}`)}`);
  await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(`artifact:${ids.public}`)}`, 'the public artifact\'s peek');
  const pub = await p.ev(PEEK);
  assert.deepEqual(pub.rows.map((r) => r[0]), ['ID', 'Kind', 'Drawn by', 'For', 'Where', 'Published', 'Updated', 'How it changes']);
  assert.match(pub.rows.find((r) => r[0] === 'Where')[1], /Landed on main/);
  assert.match(pub.rows.find((r) => r[0] === 'Published')[1], /recorded .* from the dashboard/);
  await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(`artifact:${ids.broken}`)}`)}`);
  await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(`artifact:${ids.broken}`)}`, 'the broken artifact\'s peek');
  const bad = await p.ev(PEEK);
  assert.deepEqual(bad.rows.find((r) => r[0] === 'Error')?.[1], 'manifest.json: title is missing');
  // its row's own fields still show: its time (it names no by and no for)
  assert.deepEqual(bad.rows.map((r) => r[0]), ['ID', 'Kind', 'Where', 'Error', 'Updated', 'How it changes'], 'a broken one: what its row has');
  // every item's peek: ID first, How it changes last, the rows in the spec's order
  for (const i of items) {
    await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(i.id)}`)}`);
    await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(i.id)}`, `${i.id}'s peek`);
    const r = (await p.ev(PEEK)).rows.map((x) => x[0]);
    const order = i.kind === 'link' ? LINK_ORDER : LIB_ORDER;
    assert.deepEqual(r, order.filter((k) => r.includes(k)), `${i.id}: rows in order (${r.join(', ')})`);
    assert.equal(r.length, new Set(r).size, `${i.id}: each row once`);
    assert.deepEqual([r[0], r[1], r.at(-1)], ['ID', 'Kind', 'How it changes'], `${i.id}: ID, Kind first, How it changes last`);
  }
  // an unknown id: not found, the type badge still the item's
  await p.ev("location.hash = '#lib/artifact%3Ano-such-thing'");
  await soon("document.querySelector('#drawer-bar-title .dtitle')?.textContent === 'artifact:no-such-thing'", 'not found');
  assert.equal(await p.ev("document.querySelector('#drawer-bar-title .dtype .badge')?.textContent"), 'Library item');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a link\'s peek has its details', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids } = await libraryAll(t);
  await p.ev(`location.hash = ${JSON.stringify(`#lib/link:${ids.linkUrl}`)}`);
  await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(`link:${ids.linkUrl}`)}`, 'the link\'s peek');
  const pk = await p.ev(PEEK);
  assert.equal(pk.type, 'Library item');
  assert.equal(pk.title, 'The pay flow in Figma');
  assert.deepEqual(pk.rows.map((r) => r[0]), ['ID', 'Kind', 'Where', 'For', 'Notes', 'How it changes'], 'a link\'s Kind, Where, For, Notes');
  const row = (k) => pk.rows.find((r) => r[0] === k);
  assert.match(row('Kind')[1], /Link/);
  assert.match(row('Kind')[1], /url/, 'the link\'s own kind');
  assert.match(row('Where')[1], /https:\/\/www\.figma\.com\/file\/pay-flow/);
  assert.deepEqual(row('For')[2], [`#goal/${ids.goal1}`]);
  assert.equal(row('Notes')[1], 'The screens the pay tickets build');
  assert.equal(row('How it changes')[1], 'Shift+click it and say so in a thread');
  // a local remote's ↗ opens this peek (T2): its Where is the remote and path
  await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(`link:${ids.linkPath}`)}`)}`);
  await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(`link:${ids.linkPath}`)}`, 'the path link\'s peek');
  const path_ = await p.ev(PEEK);
  assert.match(path_.rows.find((r) => r[0] === 'Where')[1], /docs\/devteam\/project\/designs\/pay\.md/);
  assert.deepEqual(path_.rows.find((r) => r[0] === 'For')[2], [`#feature/${ids.feat1}`]);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a preview\'s peek: its state and who drew it', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids } = await libraryAll(t);
  const peekOn = async (id) => {
    await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(id)}`)}`);
    await soon(`${PEEK}.rows[0]?.[1] === ${JSON.stringify(id)}`, `${id}'s peek`);
    return Object.fromEntries((await p.ev(PEEK)).rows.map(([k, v, a]) => [k, { v, a }]));
  };
  const down = await peekOn(`preview:${ids.pvDown}`);
  assert.deepEqual(Object.keys(down), ['ID', 'Kind', 'Drawn by', 'State', 'Updated', 'How it changes']);
  assert.match(down.State.v, /^not answering down since .+/, 'State: the card\'s words, and since when');
  assert.deepEqual(down['Drawn by'].a, [`#planner/${ids.feat1}`], 'Drawn by: the planner\'s session');
  const live = await peekOn(`preview:${ids.pvLive}`);
  assert.equal(live.State.v, 'live');
  assert.deepEqual(live['Drawn by'].a, [`#ticket/${ids.tBuilding}`], 'Drawn by: the ticket\'s session');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

// counts the page's /api/peek requests (after dataPatchInit and READS_INIT)
const PEEK_REQS_INIT = `(() => {
  window.__peekReqs = [];
  const f = window.fetch;
  window.fetch = (u, o) => { const s = String(u && u.url ? u.url : u); if (s.startsWith('/api/peek')) window.__peekReqs.push(s); return f(u, o); };
})();`;

test('a lib peek asks the server for no peek', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, ids } = await libraryAll(t, { init: `${READS_INIT}\n${PEEK_REQS_INIT}` });
  for (const id of [`artifact:${ids.drafted}`, `link:${ids.linkUrl}`, 'artifact:no-such-thing']) {
    await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(id)}`)}`);
    await soon(`document.querySelector('#drawer-bar-title .dtitle')?.textContent.length > 0 && (${PEEK}.rows[0]?.[1] === ${JSON.stringify(id)})`, `${id}'s peek`);
    // through three refreshes (each one asks again for the open object's peek, unless it is missing)
    const n = await p.ev('window.__dataReads');
    await soon(`window.__dataReads >= ${n + 3}`, 'three refreshes');
  }
  assert.deepEqual(await p.ev('window.__peekReqs'), [], 'no /api/peek request');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the peek\'s frame is one of the 12', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon } = await libraryAll(t, { fx: libraryFixture({ artifacts: 60 }), height: 3000 });
  await soon(`${VIEW}.frames === 12`, 'twelve frames');
  await sleep(1000);
  const before = await p.ev(VIEW);
  const framed = before.holding.map((h) => h.id).find((id) => id.startsWith('artifact:'));
  assert.ok(framed, 'a framed artifact');
  // the grid frame farthest from the viewport's centre is the one that makes room (any of those tied for farthest)
  const farthest = await p.ev(`(() => { const d = (b) => { const r = b.getBoundingClientRect(); return Math.hypot((r.left + r.right - innerWidth) / 2, (r.top + r.bottom - innerHeight) / 2); };
    const xs = [...document.querySelectorAll('#lib-grid .lib-thumb')].filter((b) => b.querySelector('iframe')), m = Math.max(...xs.map(d));
    return xs.filter((b) => d(b) > m - 0.5).map((b) => b.closest('.lib-card').dataset.libId); })()`);
  const all = "document.querySelectorAll('.lib-thumb iframe').length";
  const inPeek = "document.querySelectorAll('#drawer-body .lib-thumb iframe').length";
  await p.ev(`location.hash = ${JSON.stringify(`#lib/${encodeURIComponent(framed)}`)}`);
  const box = "document.querySelector('#drawer-body .lib-thumb')";
  await soon(`!!${box}?.querySelector('iframe')`, 'the peek\'s box holds a frame');
  await sleep(1000);
  assert.equal(await p.ev(`${box}.dataset.thumb`), 'live');
  assert.equal(await p.ev(`${box}.querySelector('iframe').getAttribute('src') === ${box}.dataset.thumbSrc`), true);
  assert.deepEqual(await p.ev(`[${all}, ${inPeek}, ${VIEW}.frames]`), [12, 1, 11], '12 in all: 1 in the peek, 11 in the grid');
  const open = await p.ev(VIEW);
  const gone = before.holding.map((h) => h.id).filter((id) => !open.holding.some((h) => h.id === id));
  assert.equal(gone.length, 1, 'one grid frame made room');
  assert.ok(farthest.includes(gone[0]), `the grid frame farthest from the centre made room (${gone[0]}; farthest: ${farthest.join(', ')})`);
  // closed: its slot goes back to the grid
  await p.key('Escape');
  await soon("document.getElementById('drawer').hidden", 'the peek closed');
  await soon(`${VIEW}.frames === 12 && ${inPeek} === 0`, 'the grid back to 12');
  await sleep(1000);
  assert.deepEqual(await p.ev(`[${all}, ${VIEW}.frames]`), [12, 12]);
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a cold link opens over the Library', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, ids } = await libraryAll(t);
  await go(`#lib/${encodeURIComponent(`artifact:${ids.drafted}`)}`);
  await soon(`!document.getElementById('drawer').hidden && ${PEEK}.rows[0]?.[1] === ${JSON.stringify(`artifact:${ids.drafted}`)}`, 'the peek on a cold load');
  assert.equal(await p.ev('history.state.page'), '#library', 'over the Library');
  assert.equal(await p.ev("document.getElementById('library').classList.contains('on')"), true, 'the Library under it');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

// ---- in Chrome (kit-92 T6): the viewer bar: the version pill, Reload, the Public tile, Start and Stop ----

const VERS = 'vers-mock', VERS_WT = 'demo-01-draft', VERS_TITLE = 'Vers mock';
const versFiles = (n) => ({
  'artifact.json': JSON.stringify({ v: 1, title: VERS_TITLE, summary: 'A page with versions', by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><head><meta charset="utf-8"><title>v${n}</title></head><body><p>v${n}</p></body></html>\n`,
});
const putFiles = (dir, files) => { fs.mkdirSync(dir, { recursive: true }); for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text); };
// libraryOn's setup: settings.md's project set (kit92, edited in place as peekFixture edits it), vers-mock landed on
// main in three commits and drafted in a worktree's folder under .worktrees/ (as artifact-versions.test.mjs builds
// one); its versions as the CLI lists them, the realpath of the project, the draft's folder
function versProject(root, env) {
  const sf = path.join(root, 'docs/devteam/project/settings.md');
  const s = fs.readFileSync(sf, 'utf8');
  assert.ok(s.includes('"gates": {}'), 'settings.md as init writes it');
  fs.writeFileSync(sf, s.replace('"gates": {}', '"project": "kit92", "gates": {}'));
  const dir = path.join(root, 'docs/devteam/project/artifacts', VERS);
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd: root, encoding: 'utf8' }).trim();
  for (const n of [1, 2, 3]) { putFiles(dir, versFiles(n)); git('add', '-A', dir); git('commit', '-qm', `${VERS} v${n}`); }
  const draft = path.join(root, '.worktrees', VERS_WT, 'docs/devteam/project/artifacts', VERS);
  putFiles(draft, versFiles('d'));
  const r = spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), 'artifact', 'versions', VERS, '--json'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const versions = JSON.parse(r.stdout).versions;
  assert.deepEqual(versions.map((v) => v.kind), ['draft', 'landed', 'earlier', 'earlier'], 'a draft, main\'s and two earlier');
  return { root: fs.realpathSync(root), versions, draft };
}
// the dataPatchInit pattern, merging instead of replacing (so the served vers-mock stays): window.__fx.previews
// appended to the served library.previews, and window.__fx.published (when the key is there) put on vers-mock's
// landed row; read on every answer, so a test changes it in the page
const libraryMergeInit = ({ previews = [], published } = {}) => `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__fx = ${JSON.stringify({ previews, ...(published !== undefined ? { published } : {}) })};
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error || e)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason && e.reason.message || e.reason)));
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    const method = String(o?.method || 'GET').toUpperCase();
    const r = await real(u, o);
    const fx = window.__fx;
    if (method !== 'GET' || !r.ok || !url.startsWith('/api/data')) return r;
    const d = await r.json();
    const lib = d.library || {};
    d.library = { ...lib, previews: [...(lib.previews || []), ...(fx.previews || [])] };
    if ('published' in fx) d.library.artifacts = (lib.artifacts || []).map((a) => (a.slug === ${JSON.stringify(VERS)} && a.at === 'main' ? { ...a, published: fx.published } : a));
    return new Response(JSON.stringify(d), { status: r.status, statusText: r.statusText, headers: r.headers });
  };
})();`;
// /api/artifact-versions asks counted (window.__versReads); window.__versFail answers them 500
const VERS_INIT = `(() => {
  window.__versReads = 0;
  window.__versFail = false;
  const f = window.fetch;
  window.fetch = (u, o) => {
    if (String(u && u.url ? u.url : u).startsWith('/api/artifact-versions')) {
      window.__versReads++;
      if (window.__versFail) return Promise.resolve(new Response('{"error":"down"}', { status: 500, headers: { 'content-type': 'application/json' } }));
    }
    return f(u, o);
  };
})();`;
// /api/preview-start answered by the page: window.__start's status (400 refuses with "no", 200 takes it)
const START_INIT = `(() => {
  window.__start = 400;
  window.__starts = 0;
  const f = window.fetch;
  window.fetch = (u, o) => {
    if (!String(u && u.url ? u.url : u).startsWith('/api/preview-start')) return f(u, o);
    window.__starts++;
    return Promise.resolve(new Response(JSON.stringify(window.__start === 200 ? { ok: true } : { error: 'no' }), { status: window.__start, headers: { 'content-type': 'application/json' } }));
  };
})();`;
async function versOn(t, { previews = [], published, init = '', ...rest } = {}) {
  return libraryOn(t, { ...rest, setup: versProject, init: `${libraryMergeInit({ previews, published })}\n${READS_INIT}\n${VERS_INIT}${init ? `\n${init}` : ''}` });
}
// whether an element by id is there and drawn
const shown = (id) => `(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && e.getClientRects().length > 0; })()`;
const VIEWING = "!document.getElementById('artifact-view').hidden";
const frameIs = (src) => `${VIEWING} && document.getElementById('av-frame').getAttribute('src') === ${JSON.stringify(src)}`;
// the version list's options
const OPTS = "[...document.querySelectorAll('#av-vers [role=option]')].map((o) => ({ at: o.dataset.at, text: o.textContent.trim() }))";
const LIST_OPEN = "!document.getElementById('av-vers').hidden";
const BAR = `(() => { const g = (id) => document.getElementById(id); return { title: g('av-title').textContent, where: g('av-where').textContent, note: g('av-note').hidden ? null : g('av-note').textContent,
  reload: ${shown('av-reload')}, pub: ${shown('av-pub')}, list: !g('av-vers').hidden }; })()`;
// a colour token as this scheme resolves it
const tokenColor = (p, token) => p.ev(`(() => { const e = document.createElement('span'); e.style.color = 'var(${token})'; document.getElementById('artifact-view').append(e); const c = getComputedStyle(e).color; e.remove(); return c; })()`);
const polls = async (p, soon, n = 2) => { const k = await p.ev('window.__dataReads'); await soon(`window.__dataReads >= ${k + n}`, `${n} polls`); };
const cardTitle = (slug) => `[data-lib-id="artifact:${slug}"] .lib-title`;

test('the viewer bar: its sizes and order', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go } = await versOn(t);
  await go(`#artifact/main/${VERS}`);
  await soon(`${frameIs(`/artifact/main/${VERS}/`)} && document.getElementById('av-title').textContent === ${JSON.stringify(VERS_TITLE)} && ${shown('av-pub')}`, 'the landed version in the viewer, with its tile');
  const m = await p.ev(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(), bar = r('.av-bar');
    return { bar: bar.height, ver: r('#av-ver').height, badge: r('#av-kind').height, kind: document.getElementById('av-kind').matches('span.badge'), icon: !!document.querySelector('.av-bar > i.av-kind.icon-layout-dashboard:first-child'),
      pills: ['#av-reload', '#av-pub', '#av-tab', '#av-close'].map((s) => ({ s, h: r(s).height, x: r(s).left })), edge: bar.right - r('#av-close').right, title: r('#av-title').right, ver2: r('#av-ver').left }; })()`);
  assert.equal(m.bar, 41, '.av-bar is --head-h tall');
  assert.equal(m.kind, true, 'the kind badge');
  assert.equal(m.icon, true, 'the kind\'s icon first');
  assert.equal(m.ver, m.badge, '#av-ver is a badge\'s height');
  for (const x of m.pills) assert.equal(x.h, 20, `${x.s} is 20 tall`);
  assert.deepEqual([...m.pills].sort((a, b) => a.x - b.x).map((x) => x.s), ['#av-reload', '#av-pub', '#av-tab', '#av-close'], 'Reload, the tile, open in a tab, close');
  assert.ok(m.edge >= 0 && m.edge <= 16, `close at the bar's right (${m.edge}px in)`);
  assert.ok(m.ver2 >= m.title, 'the pill after the title');
  // off a box: the recorded state, disabled, saying why
  assert.deepEqual(await p.ev("(() => { const b = document.getElementById('av-pub'); return [b.tagName, b.disabled, b.textContent.trim(), /cloud box/.test(b.title)]; })()"), ['BUTTON', true, 'Not public', true]);
  // open in a tab and close: one hover rule
  await p.send('DOM.enable');
  await p.send('CSS.enable');
  const { root } = await p.send('DOM.getDocument', { depth: 0 });
  const hover = async (sel) => {
    const { nodeId } = await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    await p.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
    // a button's background has a .12s transition
    await sleep(400);
    return p.ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).backgroundColor`);
  };
  const [tab, close] = [await hover('#av-tab'), await hover('#av-close')];
  assert.equal(tab, close, 'the same background under :hover');
  assert.notEqual(tab, 'rgba(0, 0, 0, 0)', 'a hover background');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the version pill: the versions, an earlier one read-only, Escape closes only the list', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, made } = await versOn(t);
  const [, , mid, oldest] = made.versions;
  await go('#library');
  await soon(`!!document.querySelector(${JSON.stringify(cardTitle(VERS))})`, 'the card');
  await p.click(cardTitle(VERS));
  await soon(frameIs(`/artifact/wt/${VERS_WT}/${VERS}/`), 'the draft in the viewer');
  assert.equal(await p.ev("document.getElementById('av-where').textContent"), `Draft · live in ${VERS_WT}`);
  assert.equal(await p.ev("getComputedStyle(document.getElementById('av-ver')).color"), await tokenColor(p, '--amber-fg'), 'amber');
  assert.equal(await p.ev("document.querySelector('#av-ver > #av-where') !== null && document.getElementById('av-ver').matches('button.badge.ver-pill')"), true);
  assert.equal(await p.ev("document.getElementById('av-vers').getAttribute('role')"), 'listbox');
  assert.equal(await p.ev(LIST_OPEN), false, 'the list closed at first');
  await p.click('#av-ver');
  await soon(`${LIST_OPEN} && ${OPTS}.length === 4`, 'the versions listed');
  const opts = await p.ev(OPTS);
  assert.deepEqual(opts.map((o) => o.at), [VERS_WT, 'main', mid.at, oldest.at], 'drafts, landed, earlier');
  assert.equal(opts[0].text, `Draft · live in ${VERS_WT}`);
  assert.match(opts[1].text, /^Landed on main · \S/);
  assert.ok(opts[3].text.endsWith(` · ${oldest.commit.slice(0, 7)}`), `an earlier one by its date and short commit: ${opts[3].text}`);
  // the oldest: read-only
  await p.click(`#av-vers [data-at="${oldest.at}"]`);
  await soon(frameIs(`/artifact/tree/${oldest.tree}/${VERS}/`), 'the oldest in the frame');
  const ro = { title: VERS_TITLE, where: opts[3].text, note: `Showing ${opts[3].text}, read-only`, reload: false, pub: false, list: false };
  assert.deepEqual(await p.ev(BAR), ro, 'read-only: the note, no Reload, no tile');
  await polls(p, soon);
  assert.deepEqual(await p.ev(BAR), ro, 'two polls on, the title is still the artifact\'s');
  // the landed one: Reload again
  await p.click('#av-ver');
  await soon(`${LIST_OPEN} && ${OPTS}.length === 4`, 'the list again');
  await p.click('#av-vers [data-at="main"]');
  await soon(frameIs(`/artifact/main/${VERS}/`), 'main\'s in the frame');
  const b = await p.ev(BAR);
  assert.deepEqual([b.title, b.note, b.reload, b.pub, b.list], [VERS_TITLE, null, true, true, false], 'Reload and the tile back, no note');
  assert.equal(b.where, opts[1].text, 'Landed on main, with its date');
  assert.equal(await p.ev('window.__versReads'), 1, 'the versions read once per open');
  // Escape with the list open closes the list, never the viewer
  await p.click('#av-ver');
  await soon(LIST_OPEN, 'the list open');
  await p.key('Escape');
  await soon(`!${LIST_OPEN}`, 'Escape closed the list');
  await sleep(500);
  assert.equal(await p.ev(VIEWING), true, 'the viewer stays');
  // a click outside closes it too
  await p.click('#av-ver');
  await soon(LIST_OPEN, 'the list open');
  await p.click('#av-title');
  await soon(`!${LIST_OPEN}`, 'a click outside closed the list');
  assert.equal(await p.ev(VIEWING), true);
  // a versions read that fails says so
  await p.click('#av-close');
  await soon(`!${VIEWING}`, 'closed');
  await p.ev('window.__versFail = true');
  await p.click(cardTitle(VERS));
  await soon(frameIs(`/artifact/wt/${VERS_WT}/${VERS}/`), 'the draft again');
  await p.click('#av-ver');
  await soon(`${LIST_OPEN} && document.getElementById('av-vers').textContent.includes('Versions could not be read')`, 'the failure said');
  assert.equal(await p.ev('window.__versReads'), 2, 'a new open reads them again');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('a tree opened by a link is the published version', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, made } = await versOn(t);
  const mid = made.versions[2];
  await go('#library');
  await p.ev(`showArtifact(${JSON.stringify(VERS)}, ${JSON.stringify(mid.at)})`);
  await soon(frameIs(`/artifact/tree/${mid.tree}/${VERS}/`), 'the tree in the frame');
  const b = await p.ev(BAR);
  assert.deepEqual([b.where, b.note, b.reload], ['the published version', null, true], 'no read-only note: read-only is the picked state');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('Reload: its stale outline on the pill', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, made } = await versOn(t);
  await go('#library');
  await soon(`!!document.querySelector(${JSON.stringify(cardTitle(VERS))})`, 'the card');
  await p.click(cardTitle(VERS));
  await soon(`${frameIs(`/artifact/wt/${VERS_WT}/${VERS}/`)} && /^[0-9a-f]{64}$/.test(TS.fp ?? '')`, 'the draft in the viewer, with its fingerprint');
  const button = () => p.ev("(() => { const b = document.getElementById('av-reload'), s = getComputedStyle(b); return { stale: b.classList.contains('stale'), color: s.outlineColor, width: s.outlineWidth, style: s.outlineStyle, h: b.getBoundingClientRect().height }; })()");
  assert.equal((await button()).stale, false, 'nothing newer at open');
  putFiles(made.draft, versFiles('d2'));
  await soonIn(p, 60000)("document.getElementById('av-reload').classList.contains('stale')", 'the outline once a newer fingerprint is seen');
  const b = await button();
  assert.deepEqual([b.color, b.width, b.style, b.h], [await tokenColor(p, '--amber'), '2px', 'solid', 20], 'the --amber outline on the 20px pill');
  assert.deepEqual(await p.ev('window.__errors'), []);
});

test('the Public tile (box)', { ...CHROME, timeout: 300000 }, async (t) => {
  const { p, soon, go, made, port, box: header } = await versOn(t, { box: (m, port) => ({ kit92: { root: m.root, port, artifacts: {} } }) });
  const [, landed, mid] = made.versions;
  const publish = `http://box.localhost:${port}/public/publish?port=4321&slug=${VERS}`;
  const unpublish = `http://box.localhost:${port}/public/unpublish?port=4321&project=kit92&slug=${VERS}`;
  const rec = (tree) => ({ tree, at: new Date(Date.now() - 3600e3).toISOString(), channel: 'dashboard' });
  const TILE = `(() => { const e = document.getElementById('av-pub'); if (!e || !e.getClientRects().length) return null;
    return { tag: e.tagName, text: e.textContent.trim(), href: e.getAttribute('href'), target: e.getAttribute('target'), disabled: !!e.disabled, h: e.getBoundingClientRect().height }; })()`;
  const tileColor = "getComputedStyle(document.getElementById('av-pub')).color";
  await go(`#artifact/main/${VERS}`);
  await soon(`${frameIs(`/artifact/main/${VERS}/`)} && ${shown('av-pub')}`, 'the landed version, with its tile');
  const set = async (served, published) => { header.kit92.artifacts = served; await p.ev(`window.__fx.published = ${JSON.stringify(published)}`); };
  const link = (text, href) => ({ tag: 'A', text, href, target: '_blank', disabled: false, h: 20 });
  // public, nothing to update: Public (green), the unpublish page
  await set({ [VERS]: landed.tree }, rec(landed.tree));
  await soon(`JSON.stringify(${TILE}) === ${JSON.stringify(JSON.stringify(link('Public', unpublish)))}`, 'public');
  assert.equal(await p.ev(tileColor), await tokenColor(p, '--green-fg'), 'green');
  assert.equal(await p.ev("!!document.querySelector('#av-pub i.icon-globe')"), true, 'with a globe');
  // public, main moved on: the update menu
  await set({ [VERS]: mid.tree }, rec(landed.tree));
  await soon(`${TILE}?.text === 'Public · update available'`, 'public with an update');
  assert.deepEqual(await p.ev(TILE), { tag: 'BUTTON', text: 'Public · update available', href: null, target: null, disabled: false, h: 20 });
  assert.equal(await p.ev(tileColor), await tokenColor(p, '--amber-fg'), 'amber');
  assert.equal(await p.ev(shown('av-pub-menu')), false, 'its menu closed');
  await p.click('#av-pub');
  await soon(shown('av-pub-menu'), 'its menu');
  const entries = "[...document.querySelectorAll('#av-pub-menu a')].map((a) => [a.textContent.trim(), a.getAttribute('href'), a.target])";
  assert.deepEqual(await p.ev(entries), [['Update to main\'s version', publish, '_blank'], ['Unpublish', unpublish, '_blank']]);
  await polls(p, soon);
  assert.equal(await p.ev(shown('av-pub-menu')), true, 'a poll leaves the open menu');
  await p.click('#av-title');
  await soon(`!${shown('av-pub-menu')}`, 'a click outside closes it');
  // recorded but not served: Not public (amber), the publish page
  await set({}, rec(landed.tree));
  await soon(`JSON.stringify(${TILE}) === ${JSON.stringify(JSON.stringify(link('Not public', publish)))}`, 'not live');
  assert.equal(await p.ev(tileColor), await tokenColor(p, '--amber-fg'), 'amber');
  // never published: Not public, the publish page
  await set({}, null);
  await soon(`JSON.stringify(${TILE}) === ${JSON.stringify(JSON.stringify(link('Not public', publish)))} && ${tileColor} !== ${JSON.stringify(await tokenColor(p, '--amber-fg'))}`, 'none');
  // a draft has none
  await go(`#artifact/wt/${VERS_WT}/${VERS}`);
  await soon(`${frameIs(`/artifact/wt/${VERS_WT}/${VERS}/`)} && document.getElementById('av-title').textContent === ${JSON.stringify(VERS_TITLE)}`, 'the draft');
  await polls(p, soon);
  assert.equal(await p.ev(TILE), null, 'no tile on a draft');
  assert.deepEqual(await p.ev(ERRORS), []);
});

test('a preview\'s Start and Stop', { ...CHROME, timeout: 300000 }, async (t) => {
  const { patch, ids } = libraryFixture();
  const { p, soon, go } = await libraryOn(t, { init: `${libraryMergeInit({ previews: patch.library.previews })}\n${READS_INIT}\n${START_INIT}` });
  const RUN = `(() => { const g = (id) => document.getElementById(id), r = (id) => g(id).getBoundingClientRect();
    return { run: [...g('av-run').querySelectorAll('button')].map((b) => b.textContent.trim()), pub: ${shown('av-pub')}, ver: g('av-ver').disabled, plain: g('av-ver').classList.contains('plain'),
      order: r('av-reload').right <= r('av-run').left && r('av-run').right <= r('av-tab').left && r('av-tab').right <= r('av-close').left }; })()`;
  for (const [name, run] of [[ids.pvNotRunning, ['Start', 'Stop']], [ids.pvLive, ['Stop']], [ids.pvChecking, ['Stop']], [ids.pvDown, ['Stop']], [ids.pvExpired, ['Stop']]]) {
    await go(`#preview/${name}`);
    await soon(`${VIEWING} && document.querySelectorAll('#av-run button').length > 0`, `${name}'s bar`);
    assert.deepEqual(await p.ev(RUN), { run, pub: false, ver: true, plain: true, order: true }, `${name}: its buttons, after Reload and before open in a tab and close; no tile; the pill plain`);
  }
  const name = ids.pvNotRunning;
  const start = `#av-run [data-preview-start="${name}"]`;
  await go(`#preview/${name}`);
  await soon(`document.querySelectorAll('#av-run button').length === 2`, 'Start and Stop');
  // refused: the error beside the buttons, the page's only element with that id, kept through polls
  await p.click(start);
  await soon(`document.getElementById('e-preview-${name}')?.textContent === 'Not saved: no'`, 'the refusal in the bar');
  assert.deepEqual(await p.ev(`[document.querySelectorAll('[id="e-preview-${name}"]').length, !!document.getElementById('e-preview-${name}').closest('.av-bar'), !!document.getElementById('e-preview-${name}').closest('#av-run')]`), [1, true, false]);
  await polls(p, soon);
  assert.equal(await p.ev(`document.getElementById('e-preview-${name}').textContent`), 'Not saved: no', 'a poll leaves it');
  assert.deepEqual((await p.ev(RUN)).run, ['Start', 'Stop'], 'Start back as it was');
  // taken: once the preview reads live, Stop alone, within two polls, the viewer still open
  await p.ev('window.__start = 200');
  await p.click(start);
  await soon('window.__starts === 2', 'the second Start sent');
  await p.ev(`window.__fx.previews.find((x) => x.name === ${JSON.stringify(name)}).up = true`);
  await polls(p, soon);
  assert.deepEqual((await p.ev(RUN)).run, ['Stop'], 'Stop alone, never Starting…');
  assert.equal(await p.ev(VIEWING), true, 'the viewer stays open');
  assert.deepEqual(await p.ev('window.__errors'), []);
});
