// An artifact's kind (kit-319): an optional `kind` in its manifest (mock, diagram or docs) that
// `artifact new --kind` writes, `artifact check` holds to those three, and dashboard-data passes on
// with each artifact row, so the Library (kit-92) files it as Diagram or Docs. With no kind, an
// artifact reads as before: no `kind` in its manifest, and Mock in the Library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, fleetFixture, write } from './lib/kit.mjs';
import { cleanup } from './lib/chrome.mjs';

const ARTIFACTS_REL = 'docs/devteam/project/artifacts';
const manifestOf = (root, slug) => JSON.parse(fs.readFileSync(path.join(root, ARTIFACTS_REL, slug, 'artifact.json'), 'utf8'));
const page = '<!doctype html><html><body><p>a page</p></body></html>';
// a hand-written artifact: the manifest `artifact new` writes, plus whatever extra says
const drawn = (root, slug, extra) => {
  write(path.join(root, ARTIFACTS_REL, slug, 'artifact.json'), JSON.stringify({ v: 1, title: slug, summary: 'A page to point at', by: 'supervisor', for: [], ...extra }));
  write(path.join(root, ARTIFACTS_REL, slug, 'index.html'), page);
};
// The dashboard's library-items block run alone in vm, as dashboard-library.test.mjs runs it.
function library() {
  const src = fs.readFileSync(path.join(kit, 'dashboard', 'index.html'), 'utf8');
  const block = (name) => src.slice(src.indexOf(`/* ${name} start */`), src.indexOf(`/* ${name} end */`) + `/* ${name} end */`.length);
  const vctx = vm.createContext({ URL, URLSearchParams });
  vm.runInContext(`${block('preview-cards')}\n${block('library-items')}\nthis.previewState = previewState; this.libraryItems = libraryItems; this.libraryKeep = libraryKeep;`, vctx);
  const ctx = { previewState: vctx.previewState, artHref: (s, at) => `#artifact/${at}/${s}`, artViewer: (s, at) => `/view/artifact/${s}?at=${at}`, pvViewer: (n) => `/view/preview/${n}`, fileHref: (l) => `#file?path=${l.path}` };
  return { items: (data) => JSON.parse(JSON.stringify(vctx.libraryItems(data, Date.now(), ctx))), keep: (x, f) => vctx.libraryKeep(x, f) };
}

test('artifact new --kind writes the kind; with none the manifest has no kind; any other value is refused', (t) => {
  const F = fleetFixture('artifact-kind-new');
  cleanup(t)(() => F.done());
  const wt = path.join(F.old, '.worktrees', 'kind-draw');
  F.g(['worktree', 'add', '-q', '--detach', wt], F.old);
  for (const k of ['mock', 'diagram', 'docs']) {
    const r = F.run(wt, ['artifact', 'new', `a-${k}`, '--title', `A ${k}`, '--summary', 'A page', '--kind', k], { DEVTEAM_ROLE: 'supervisor' });
    assert.equal(r.status, 0, r.err || r.out);
    assert.equal(manifestOf(wt, `a-${k}`).kind, k, `--kind ${k} is in the manifest`);
  }
  const none = F.run(wt, ['artifact', 'new', 'a-plain', '--title', 'Plain', '--summary', 'A page'], { DEVTEAM_ROLE: 'supervisor' });
  assert.equal(none.status, 0, none.err || none.out);
  assert.deepEqual(Object.keys(manifestOf(wt, 'a-plain')), ['v', 'title', 'summary', 'by', 'for'], 'no --kind: the manifest as before, with no kind key');
  // a bare --kind (no value) too: it must not read as no --kind at all
  for (const bad of ['review', 'Mock', 'diagrams', '', null]) {
    const r = F.run(wt, ['artifact', 'new', 'a-bad', '--title', 'Bad', '--summary', 'A page', '--kind', ...(bad === null ? [] : [bad])], { DEVTEAM_ROLE: 'supervisor' });
    assert.notEqual(r.status, 0, `--kind ${JSON.stringify(bad)} is refused: ${r.out}`);
    assert.match(r.err, /kind is mock, diagram or docs/, r.err);
    assert.equal(fs.existsSync(path.join(wt, ARTIFACTS_REL, 'a-bad')), false, `--kind ${JSON.stringify(bad)} writes nothing`);
  }
  const c = F.run(wt, ['artifact', 'check'], {});
  assert.equal(c.status, 0, c.err || c.out);
  assert.match(c.out, /4 artifacts pass/);
});

test('artifact check accepts kind mock, diagram or docs, and refuses any other value', (t) => {
  const F = fleetFixture('artifact-kind-check');
  cleanup(t)(() => F.done());
  for (const k of ['mock', 'diagram', 'docs']) drawn(F.old, `ok-${k}`, { kind: k });
  drawn(F.old, 'ok-none', {});
  const good = F.run(F.old, ['artifact', 'check'], {});
  assert.equal(good.status, 0, good.err || good.out);
  assert.match(good.out, /4 artifacts pass/);
  for (const [slug, kind] of [['bad-review', 'review'], ['bad-case', 'Diagram'], ['bad-empty', ''], ['bad-null', null], ['bad-number', 3], ['bad-list', ['docs']]]) {
    drawn(F.old, slug, { kind });
    const r = F.run(F.old, ['artifact', 'check', slug], {});
    assert.equal(r.status, 1, `kind ${JSON.stringify(kind)} is refused: ${r.out}`);
    assert.match(r.err, new RegExp(`${slug}/artifact\\.json: kind is mock, diagram or docs`), r.err);
  }
});

test('dashboard-data carries each artifact\'s kind, landed and drafted, and the Library files it by kind; no kind reads as Mock', (t) => {
  const F = fleetFixture('artifact-kind-data');
  cleanup(t)(() => F.done());
  // landed: committed on main (as a merged PR puts them there)
  drawn(F.old, 'land-diagram', { kind: 'diagram' });
  drawn(F.old, 'land-plain', {});
  F.g(['add', '-A', ARTIFACTS_REL], F.old);
  F.g(['commit', '-qm', 'artifacts'], F.old);
  F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
  // drafted: in a session's worktree, uncommitted
  const wt = path.join(F.old, '.worktrees', 'kind-draft');
  F.g(['worktree', 'add', '-q', '--detach', wt], F.old);
  drawn(wt, 'draft-docs', { kind: 'docs' });
  drawn(wt, 'draft-mock', { kind: 'mock' });
  drawn(wt, 'draft-plain', {});
  const rows = JSON.parse(F.ok(F.old, ['dashboard-data'])).library.artifacts;
  const row = (slug) => rows.find((a) => a.slug === slug) ?? assert.fail(`${slug} is listed: ${rows.map((a) => a.slug)}`);
  assert.equal(row('land-diagram').at, 'main');
  assert.equal(row('draft-docs').at, 'kind-draft');
  assert.deepEqual(Object.fromEntries(rows.map((a) => [a.slug, a.kind])), { 'land-diagram': 'diagram', 'land-plain': null, 'draft-docs': 'docs', 'draft-mock': 'mock', 'draft-plain': null });
  // `artifacts --json` lists the same rows
  const cli = JSON.parse(F.ok(F.old, ['artifacts', '--json']));
  assert.deepEqual(Object.fromEntries(cli.map((a) => [a.slug, a.kind])), Object.fromEntries(rows.map((a) => [a.slug, a.kind])));
  // the Library, fed this data: Diagram and Docs where the manifest says so, Mock otherwise
  const L = library();
  const items = L.items({ library: { artifacts: rows, previews: [], links: [] }, questions: [] });
  const kindOf = Object.fromEntries(items.map((x) => [x.id, x.kind]));
  assert.deepEqual(kindOf, { 'artifact:draft-mock': 'mock', 'artifact:land-plain': 'mock', 'artifact:draft-plain': 'mock', 'artifact:land-diagram': 'diagram', 'artifact:draft-docs': 'docs' });
  assert.deepEqual(items.filter((x) => L.keep(x, { kind: 'diagram' })).map((x) => x.id), ['artifact:land-diagram'], 'the Kind filter keeps the diagram');
  assert.deepEqual(items.filter((x) => L.keep(x, { kind: 'docs' })).map((x) => x.id), ['artifact:draft-docs'], 'and the docs');
  assert.deepEqual(items.map((x) => x.kind), ['mock', 'mock', 'mock', 'diagram', 'docs'], 'sorted in kind order');

  // the heal (spec-1 S1): a devteam.mjs from before kinds, run from a worktree branched before they
  // landed, caches the kinded landed tree as broken (unknown key) and with no kind; that row is
  // described again, never served
  const cacheFile = path.join(F.old, 'docs/devteam/run/cache/artifacts-landed.json');
  const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const tree = Object.keys(cache).find((k) => cache[k].slug === 'land-diagram') ?? assert.fail('the landed diagram is cached');
  const { kind, ...rest } = cache[tree];
  assert.equal(kind, 'diagram', 'the cache holds the kind');
  cache[tree] = { ...rest, title: null, summary: null, by: null, for: [], error: 'land-diagram/artifact.json: unknown key "kind" (v, title, summary, by, for)' };
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  const healed = JSON.parse(F.ok(F.old, ['dashboard-data'])).library.artifacts.find((a) => a.slug === 'land-diagram');
  assert.equal(healed.error, null, 'the old row is not served');
  assert.equal(healed.kind, 'diagram');
  assert.equal(healed.title, 'land-diagram');
  assert.equal('kind' in JSON.parse(fs.readFileSync(cacheFile, 'utf8'))[tree], true, 'and the cache holds the new row');
});
