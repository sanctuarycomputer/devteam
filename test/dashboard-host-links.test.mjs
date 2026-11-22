// kit-280: the dashboard's dev and public links on a project's host (project-hosts@1), and the
// laptop's and today's <port>.<box> links beside them.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, testDir, json, dashboardOnFreePort, statusWithHost, threadsFixture } from './lib/kit.mjs';
import { cleanup } from './lib/dashboard-page.mjs';

const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
const block = (name) => html.slice(html.indexOf(`/* ${name} start */`), html.indexOf(`/* ${name} end */`));
const fixture = JSON.parse(fs.readFileSync(path.join(testDir, 'fixtures/project-hosts.json'), 'utf8'));
// The two blocks alone, as the page's script holds them; `globals` stands in for the page's own.
const load = (globals = '') => {
  const ctx = vm.createContext({});
  vm.runInContext(`${globals}\n${block('preview-cards')}\n${block('public-states')}\n;globalThis.api = { previewHere, previewUrl, publicHere, publicState, publicLinks, canPublish: typeof canPublish === 'undefined' ? null : canPublish };`, ctx);
  return ctx.api;
};
const lib = { public: { project: 'alpha', root: '/srv/alpha' } };
const hello = { name: 'alpha', port: 4321 };
const at = (host, protocol = 'https:') => ({ protocol, host });
const onHost = at('alpha.box.example.com');
const T = 'a'.repeat(40);
const rec = { tree: T, at: '2026-11-09T10:00:00.000Z', channel: 'dashboard' };
const art = { slug: 'hello', tree: T, published: rec };
const serving = (port) => ({ alpha: { port, root: '/srv/alpha', artifacts: { hello: T } } });

test('A1 a dev link on a project host is https://<name>.<box>/', () => {
  const { previewHere, previewUrl } = load();
  const me = previewHere(onHost, true, hello);
  assert.ok(me, 'the project host is read as this project on this box');
  assert.equal(previewUrl(me, { name: 'cool-tiger', port: 5173 }), 'https://cool-tiger.box.example.com/');
});

test('A2 the fixture\'s dashboard samples read as that project on that box', () => {
  const { publicHere } = load();
  const hosts = [...new Set(fixture.samples.filter((s) => s.expect === 'dashboard').map((s) => new URL(s.url).host))];
  assert.ok(hosts.length >= 2);
  for (const host of hosts) {
    const name = host.split('.')[0];
    const me = publicHere(at(host), { public: { project: name, root: '/r' } }, { name, port: 4321 });
    assert.equal(me?.box, fixture.box.name, host);
    assert.equal(me?.project, name, host);
  }
});

test('A3 a public link on a project host is https://<project>.<box>/<artifact>/', () => {
  const { publicHere, publicLinks } = load();
  assert.equal(publicLinks(publicHere(onHost, lib, hello)).page('hello'), 'https://alpha.box.example.com/hello/');
});

test('A4 Publish and Unpublish name the project on the box, with no port', () => {
  const { publicHere, publicLinks } = load();
  const L = publicLinks(publicHere(onHost, lib, hello));
  assert.equal(L.publish(['a', 'b']), 'https://box.example.com/public/publish?project=alpha&slug=a&slug=b');
  assert.equal(L.unpublish('a'), 'https://box.example.com/public/unpublish?project=alpha&slug=a');
});

test('A5 a card says from instance <port> only when the record\'s port is not the dashboard\'s own', () => {
  const { publicHere, publicState } = load();
  const me = publicHere(onHost, lib, hello);
  assert.equal(publicState(art, serving(4321), me).from, null, 'its own port');
  assert.equal(publicState(art, serving(4322), me).from, 4322, 'another instance');
});

test('A6 before /api/hello has answered, no card says from instance', () => {
  const { publicHere, publicState } = load();
  const me = publicHere(onHost, lib, null);
  assert.ok(me, 'the project name from the Library is enough to read the host');
  assert.equal(publicState(art, serving(4322), me).from, null);
});

test('A7 with no argument the helpers read the page\'s own hello', () => {
  const { previewHere, publicHere, publicState } = load('let DATA = null; let HELLO = { name: "alpha", port: 4321 };');
  assert.ok(previewHere(onHost, true), 'previewHere');
  const me = publicHere(onHost, lib);
  assert.equal(me?.port, 4321, 'publicHere');
  assert.equal(publicState(art, serving(4321), me).from, null);
});

test('A8 a laptop keeps the laptop\'s links', () => {
  const { previewHere, previewUrl, publicHere } = load();
  for (const host of ['127.0.0.1:4321', 'localhost:4321']) {
    assert.equal(previewHere(at(host, 'http:'), true, hello), null, host);
    assert.equal(publicHere(at(host, 'http:'), lib, hello), null, host);
  }
  assert.equal(previewUrl(null, { name: 'cool-tiger', port: 5173 }), 'http://127.0.0.1:5173/');
});

test('A9 a <digits>.<box> host keeps today\'s links and Publish by ?port=', () => {
  const { previewHere, previewUrl, publicHere, publicLinks } = load();
  const host = at('4321.box.example.com');
  assert.equal(previewUrl(previewHere(host, true, hello), { name: 'cool-tiger', port: 5173 }), 'https://cool-tiger.box.example.com/');
  const me = publicHere(host, lib, { name: 'alpha', port: 9999 });
  assert.deepEqual({ ...me }, { proto: 'https:', port: 4321, box: 'box.example.com', project: 'alpha', root: '/srv/alpha' });
  const L = publicLinks(me);
  assert.equal(L.publish(['a']), 'https://box.example.com/public/publish?port=4321&slug=a');
  assert.equal(L.unpublish('a'), 'https://box.example.com/public/unpublish?port=4321&project=alpha&slug=a');
  assert.equal(L.page('a'), 'https://public.box.example.com/alpha/a/');
});

test('A10 a host that is not this project\'s is not read as one', () => {
  const { previewHere, publicHere } = load();
  for (const [host, name] of [['box.example.com', 'alpha'], ['beta.box.example.com', 'alpha'], ['public.box.example.com', 'public'], ['www.box.example.com', 'www'], ['term.box.example.com', 'term'], ['my_app.box.example.com', 'my_app']]) {
    const h = { name, port: 4321 };
    assert.equal(previewHere(at(host), true, h), null, `preview ${host}`);
    assert.equal(publicHere(at(host), { public: { project: name, root: '/r' } }, h), null, `public ${host}`);
  }
});

test('A11 a project host with no project in settings offers no link that names none', () => {
  const { publicHere, publicState } = load();
  const me = publicHere(onHost, { public: { project: null, root: '/srv/alpha' } }, hello);
  assert.ok(me, 'hello names the host');
  assert.equal(me.project, null);
  assert.deepEqual([...publicState(art, {}, me).actions], ['forget']);
  assert.deepEqual([...publicState({ ...art, published: null }, {}, me).actions], []);
});

test('F1 on a project host, a Library naming another project builds no link', () => {
  const { publicHere, publicState, canPublish } = load();
  for (const project of ['beta', 'my.app', 'other_app']) {
    const me = publicHere(onHost, { public: { project, root: '/srv/alpha' } }, hello);
    assert.equal(me?.project, null, `${project}: not this host's project`);
    assert.equal(canPublish(me), false, project);
    const pub = { [project]: { port: 4321, root: '/srv/alpha', artifacts: { hello: T } } };
    assert.equal(publicState(art, pub, me).state, 'not-live', `${project}: its copy is not shown as this project's`);
    assert.deepEqual([...publicState(art, pub, me).actions], ['forget'], project);
    assert.deepEqual([...publicState({ ...art, published: null }, pub, me).actions], [], project);
  }
  assert.equal(publicHere(onHost, lib, hello).project, 'alpha', 'the same name is kept');
});

test('A11b Restore all is offered wherever a link can name the project', () => {
  const { publicHere, canPublish } = load();
  assert.equal(canPublish(publicHere(onHost, { public: { project: null, root: '/r' } }, hello)), false, 'a project host with no project in settings');
  assert.equal(canPublish(publicHere(onHost, lib, hello)), true, 'a project host');
  assert.equal(canPublish(publicHere(at('4321.box.example.com'), { public: { project: null, root: '/r' } }, hello)), true, 'a port host, as today');
  assert.equal(canPublish(null), false, 'a laptop');
  assert.match(html, /const notLive = canPublish\(me\) \? /);
});

test('A13 the Library redraws when hello first names the project or its port changes, and not on other news', async () => {
  let answer = { name: 'alpha', port: 4321, pulse: 1 };
  const ctx = vm.createContext({ AbortSignal, fetch: async () => ({ ok: true, json: async () => answer }), drawn: 0 });
  vm.runInContext(`const DATA = { library: {} }; const PAGE_NOW = 'library'; const esc = String; const renderOverview = () => {}; const renderLibrary = () => { drawn++; };\n${block('hello-pulse')}\n;globalThis.load = helloLoad;`, ctx);
  await ctx.load();
  assert.equal(ctx.drawn, 1, 'hello named the project');
  answer = { ...answer, pulse: 2 };
  await ctx.load();
  assert.equal(ctx.drawn, 1, 'only the pulse changed');
  answer = { ...answer, port: 4322 };
  await ctx.load();
  assert.equal(ctx.drawn, 2, 'the port changed');
});

test('RF1 a local gateway\'s port stays in every link on a project host', () => {
  const { previewHere, previewUrl, publicHere, publicLinks } = load();
  const host = at('alpha.box.localhost:8123', 'http:');
  assert.equal(previewUrl(previewHere(host, true, hello), { name: 'cool-tiger', port: 5173 }), 'http://cool-tiger.box.localhost:8123/');
  const L = publicLinks(publicHere(host, lib, hello));
  assert.equal(L.page('a'), 'http://alpha.box.localhost:8123/a/');
  assert.equal(L.publish(['a']), 'http://box.localhost:8123/public/publish?project=alpha&slug=a');
});

test('RF2 a slug is encoded in every link on a project host', () => {
  const { publicHere, publicLinks } = load();
  const L = publicLinks(publicHere(onHost, lib, hello));
  assert.equal(L.page('a b'), 'https://alpha.box.example.com/a%20b/');
  assert.equal(L.publish(['a b']), 'https://box.example.com/public/publish?project=alpha&slug=a%20b');
  assert.equal(L.unpublish('a b'), 'https://box.example.com/public/unpublish?project=alpha&slug=a%20b');
});

test('RF3 a hello that fails after a good one redraws the Library, whose links then come from its project', async () => {
  let fail = false;
  const ctx = vm.createContext({ AbortSignal, fetch: async () => { if (fail) throw new Error('down'); return { ok: true, json: async () => ({ name: 'alpha', port: 4321 }) }; }, drawn: 0 });
  vm.runInContext(`const DATA = { library: { public: { project: 'alpha' } } }; const PAGE_NOW = 'library'; const esc = String; const renderOverview = () => {}; const renderLibrary = () => { drawn++; };\n${block('hello-pulse')}\n${block('preview-cards')}\n;globalThis.load = helloLoad; globalThis.here = (l) => previewHere(l, true);`, ctx);
  await ctx.load();
  fail = true;
  await ctx.load();
  assert.equal(ctx.drawn, 2, 'the failed ask redrew');
  assert.equal(ctx.here(onHost)?.box, 'box.example.com');
});

test('A7b until hello answers, the Library\'s project names the host', () => {
  const { previewHere, publicHere } = load('let HELLO = null; let DATA = { library: { public: { project: "alpha" } } };');
  assert.ok(previewHere(onHost, true), 'previewHere');
  assert.equal(publicHere(onHost, lib)?.port, null, 'no port is known yet');
});

test('A7c with no name known, a page the gateway marked as served reads its first label', () => {
  const served = load('let HELLO = null; let DATA = null; let PREVIEWS = true;');
  assert.equal(served.previewUrl(served.previewHere(onHost, true), { name: 'cool-tiger', port: 5173 }), 'https://cool-tiger.box.example.com/');
  assert.equal(served.previewHere(at('public.box.example.com'), true), null, 'a reserved label');
  const unmarked = load('let HELLO = null; let DATA = null; let PREVIEWS = false;');
  assert.equal(unmarked.previewHere(onHost, true), null, 'no gateway header');
});

test('A14 previewHere and publicHere agree on every project-hosts@1 label', () => {
  const { previewHere, publicHere } = load();
  for (const { name, expect } of fixture.labelCases) {
    const host = at(`${name}.box.example.com`);
    const h = { name, port: 4321 };
    const want = expect !== 'refused';
    // an all-digit label is refused as a project, and is still today's <port>.<box>
    const portHost = /^\d{1,5}$/.test(name);
    assert.equal(!!previewHere(host, true, h), want || portHost, `preview ${name}`);
    assert.equal(publicHere(host, { public: { project: name, root: '/r' } }, h)?.named === true, want, `public ${name}`);
  }
});

test('A12 /api/hello gives the page the name and port the helpers read', async (t) => {
  const F = threadsFixture('host-links');
  const later = cleanup(t);
  later(() => F.done());
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  assert.equal(await statusWithHost(port, '/api/hello', `127.0.0.1:${port}`), 200);
  const h = json(await (await fetch(`http://127.0.0.1:${port}/api/hello`)).text());
  assert.equal(h.port, port);
  assert.equal(typeof h.name, 'string');
  assert.match(html, /async function helloLoad\(\)[\s\S]*?HELLO = h;/);
});
