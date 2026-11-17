// An artifact's versions (kit-172): its drafts, main's version and earlier ones by date, as
// `artifact versions <slug> --json` lists them over a real git history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture, write, freePort, startDashboard, until } from './lib/kit.mjs';
import { cleanup } from './lib/chrome.mjs';

const ARTIFACTS_REL = 'docs/devteam/project/artifacts';

// An artifact landed on main in a threads fixture, as a merged PR puts it there: its folder's tree
// id, and the commit that landed it.
function landArtifact(F, slug, files) {
  const dir = path.join(F.old, ARTIFACTS_REL, slug);
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
  F.g(['add', '-A', dir], F.old);
  F.g(['commit', '-qm', `artifact: ${slug}`], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  return { tree: F.g(['rev-parse', `HEAD:${ARTIFACTS_REL}/${slug}`], F.old), commit: F.g(['rev-parse', 'HEAD'], F.old) };
}
const cliVersions = (F, slug) => JSON.parse(F.owner(['artifact', 'versions', slug, '--json']));
// VIEWER_MOCK's shape (dashboard.test.mjs), its page saying which version it is
const mock = (n) => ({
  'artifact.json': JSON.stringify({ v: 1, title: 'Viewer mock', summary: 'A page to point at', by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><p id="art">v${n}</p></body></html>`,
  'style.css': '#art { color: rgb(1, 2, 3) }',
});
const mainEntry = (kind, slug, { tree, commit }) => ({ kind, tree, commit, at: `tree:${tree}`, url: `/artifact/tree/${tree}/${slug}/` });
const shape = (v) => ({ kind: v.kind, tree: v.tree, commit: v.commit, at: v.at, url: v.url });
const startApi = async (F, later) => {
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({}), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  return B;
};
const apiVersions = (B, slug, headers = {}) => fetch(`${B}/api/artifact-versions?slug=${slug}`, { headers });
const apiJson = async (B, slug) => (await apiVersions(B, slug)).json();
const nonIncreasing = (times) => times.every((t, i) => i === 0 || Date.parse(times[i - 1]) >= Date.parse(t));

test('versions: landed then earlier by date, each with its commit and time', async (t) => {
  const F = threadsFixture('versions-a1');
  const later = cleanup(t);
  later(() => F.done());
  const B = await startApi(F, later);
  const v1 = landArtifact(F, 'viewer-mock', mock(1));
  write(path.join(F.old, 'unrelated.txt'), 'not an artifact');
  F.g(['add', 'unrelated.txt'], F.old);
  F.g(['commit', '-qm', 'unrelated'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  const unrelated = F.g(['rev-parse', 'HEAD'], F.old);
  // a subfolder: its own 040000 line in the commit's raw output, which only an exact-path parse leaves out
  const v2 = landArtifact(F, 'viewer-mock', { ...mock(2), 'img/a.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  const v3 = landArtifact(F, 'viewer-mock', mock(3));
  const r = cliVersions(F, 'viewer-mock');
  assert.deepEqual(await apiJson(B, 'viewer-mock'), r, 'the endpoint says what the CLI says');
  assert.equal(r.slug, 'viewer-mock');
  assert.deepEqual(r.versions.map(shape), [mainEntry('landed', 'viewer-mock', v3), mainEntry('earlier', 'viewer-mock', v2), mainEntry('earlier', 'viewer-mock', v1)]);
  for (const v of r.versions) assert.equal(v.time, F.g(['log', '-1', '--format=%cI', v.commit], F.old), `${v.commit}: its committer time`);
  assert.ok(nonIncreasing(r.versions.map((v) => v.time)), 'newest first');
  assert.ok(!r.versions.some((v) => v.commit === unrelated), 'a commit that did not touch the folder is not a version');
  const sub = F.g(['rev-parse', `${v2.commit}:${ARTIFACTS_REL}/viewer-mock/img`], F.old);
  assert.ok(!r.versions.some((v) => v.tree === sub), 'a subfolder\'s tree is not a version');
  assert.equal(r.versions.length, 3);
  assert.equal(r.truncated, false);
  // and in plain words, one line each
  assert.deepEqual(F.owner(['artifact', 'versions', 'viewer-mock']).split('\n'), r.versions.map((v) => `${v.kind} ${v.tree.slice(0, 12)} ${v.commit.slice(0, 12)} ${v.time}`));
});

test('versions: the draft first, with its worktree and its own commit', async (t) => {
  const F = threadsFixture('versions-a2');
  const later = cleanup(t);
  later(() => F.done());
  const B = await startApi(F, later);
  landArtifact(F, 'viewer-mock', mock(1));
  const v2 = landArtifact(F, 'viewer-mock', mock(2));
  const main = cliVersions(F, 'viewer-mock').versions;
  assert.deepEqual(main.map((v) => v.kind), ['landed', 'earlier']);
  const wtRoot = (name) => path.join(F.old, '.worktrees', name);
  const draftDir = (name) => path.join(wtRoot(name), ARTIFACTS_REL, 'viewer-mock');
  const put = (name, files) => { for (const [rel, text] of Object.entries(files)) write(path.join(draftDir(name), rel), text); };
  const touch = (name, when) => { for (const rel of Object.keys(mock(0))) fs.utimesSync(path.join(draftDir(name), rel), when, when); };
  // a worktree that is a git checkout of its own, with one commit
  put('demo-01-draft', mock('d1'));
  const wt = wtRoot('demo-01-draft');
  F.g(['init', '-q'], wt);
  F.g(['add', '-A'], wt);
  F.g(['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'wt'], wt);
  const wtHead = F.g(['rev-parse', 'HEAD'], wt);
  assert.notEqual(wtHead, F.g(['rev-parse', 'HEAD'], F.old));
  let r = cliVersions(F, 'viewer-mock');
  const d = r.versions[0];
  assert.deepEqual([d.kind, d.at, d.worktree, d.url, d.commit], ['draft', 'demo-01-draft', 'demo-01-draft', '/artifact/wt/demo-01-draft/viewer-mock/', wtHead]);
  assert.match(d.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/, 'an ISO time');
  assert.equal(typeof d.fp, 'string');
  assert.deepEqual(r.versions.slice(1), main, 'landed and earlier follow, unchanged');
  assert.deepEqual(await apiJson(B, 'viewer-mock'), r, 'the endpoint says what the CLI says');
  // a plain folder (no .git of its own), its files an hour older
  put('demo-02-plain', mock('d2'));
  touch('demo-02-plain', new Date(Date.now() - 3600 * 1000));
  r = cliVersions(F, 'viewer-mock');
  assert.deepEqual(r.versions.filter((v) => v.kind === 'draft').map((v) => [v.worktree, v.commit]), [['demo-01-draft', wtHead], ['demo-02-plain', null]], 'newest first; a plain folder has no commit, never main\'s HEAD');
  assert.equal(r.versions[1].url, '/artifact/wt/demo-02-plain/viewer-mock/');
  assert.deepEqual(r.versions.slice(2), main);
  touch('demo-02-plain', new Date(Date.now() + 60 * 1000));
  r = cliVersions(F, 'viewer-mock');
  assert.deepEqual(r.versions.filter((v) => v.kind === 'draft').map((v) => v.worktree), ['demo-02-plain', 'demo-01-draft'], 'touched, it is the newer');
  fs.rmSync(wtRoot('demo-02-plain'), { recursive: true, force: true });
  // a copy equal to main's is not a draft
  put('demo-01-draft', mock(2));
  r = cliVersions(F, 'viewer-mock');
  assert.deepEqual(r.versions, main, 'equal to main\'s: no draft');
  assert.equal(r.versions[0].tree, v2.tree);
  fs.rmSync(wtRoot('demo-01-draft'), { recursive: true, force: true });
  assert.deepEqual(cliVersions(F, 'viewer-mock').versions, main, 'the worktree gone: no draft');
  assert.deepEqual(await apiJson(B, 'viewer-mock'), cliVersions(F, 'viewer-mock'), 'and the endpoint agrees');
});

test('versions: only servable, deduped, and kept after a delete', async (t) => {
  const F = threadsFixture('versions-a5');
  const later = cleanup(t);
  later(() => F.done());
  const B = await startApi(F, later);
  // (a) a tree from before the artifact had a manifest is not servable, so not listed
  landArtifact(F, 'old-mock', { 'index.html': mock(0)['index.html'] });
  const withManifest = landArtifact(F, 'old-mock', mock(1));
  assert.deepEqual(cliVersions(F, 'old-mock').versions.map(shape), [mainEntry('landed', 'old-mock', withManifest)]);
  assert.deepEqual(await apiJson(B, 'old-mock'), cliVersions(F, 'old-mock'));
  // (b) a revert to an older tree: listed once, at its newest commit
  const T1 = landArtifact(F, 'viewer-mock', mock(1));
  const T2 = landArtifact(F, 'viewer-mock', mock(2));
  const T3 = landArtifact(F, 'viewer-mock', mock(3));
  const back = landArtifact(F, 'viewer-mock', mock(1));
  assert.equal(back.tree, T1.tree, 'the exact files, the same tree');
  let r = cliVersions(F, 'viewer-mock');
  assert.deepEqual(await apiJson(B, 'viewer-mock'), r);
  assert.deepEqual(r.versions.map(shape), [mainEntry('landed', 'viewer-mock', back), mainEntry('earlier', 'viewer-mock', T3), mainEntry('earlier', 'viewer-mock', T2)]);
  // (c) the folder deleted on main: no landed, and its history kept
  F.g(['rm', '-rq', `${ARTIFACTS_REL}/viewer-mock`], F.old);
  F.g(['commit', '-qm', 'artifact: viewer-mock gone'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  r = cliVersions(F, 'viewer-mock');
  assert.deepEqual(r.versions.map(shape), [mainEntry('earlier', 'viewer-mock', back), mainEntry('earlier', 'viewer-mock', T3), mainEntry('earlier', 'viewer-mock', T2)]);
  assert.equal(r.truncated, false);
  assert.deepEqual(await apiJson(B, 'viewer-mock'), r);
  // each url is still served, with the bytes of its own version
  for (const [v, n] of [[r.versions[0], 1], [r.versions[1], 3], [r.versions[2], 2]]) {
    const res = await fetch(B + v.url);
    assert.equal(res.status, 200, v.url);
    assert.equal(await res.text(), mock(n)['index.html'], v.url);
  }
});

test('versions: capped at 200 versions, not commits', async (t) => {
  const F = threadsFixture('versions-a7');
  const later = cleanup(t);
  later(() => F.done());
  const B = await startApi(F, later);
  const dir = path.join(F.old, ARTIFACTS_REL, 'long-mock');
  const commit = (files, msg) => {
    for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
    F.g(['add', '-A', dir], F.old);
    F.g(['commit', '-qm', msg], F.old);
  };
  const files = (i) => ({ 'artifact.json': mock(0)['artifact.json'], 'index.html': `v${i}` });
  let second = null;
  for (let i = 1; i <= 201; i++) {
    commit(files(i), `long-mock v${i}`);
    if (i === 2) second = F.g(['rev-parse', `HEAD:${ARTIFACTS_REL}/long-mock`], F.old);
    // a revert to v99's exact files: 202 folder commits, 201 distinct trees
    if (i === 100) commit(files(99), 'long-mock back to v99');
  }
  F.g(['push', '-q', 'origin', 'main'], F.old);
  const r = cliVersions(F, 'long-mock');
  assert.equal(r.versions.length, 200);
  assert.equal(r.truncated, true);
  assert.equal(r.versions[0].kind, 'landed');
  assert.equal(r.versions.at(-1).tree, second, 'the oldest is cut, so the last is version 2');
  assert.equal(new Set(r.versions.map((v) => v.tree)).size, 200, 'each tree once');
  assert.deepEqual(await apiJson(B, 'long-mock'), r);
});

test('artifact versions: exit 3 when there is nothing', (t) => {
  const F = threadsFixture('versions-a6');
  const later = cleanup(t);
  later(() => F.done());
  const r = F.run(F.old, ['artifact', 'versions', 'no-such']);
  assert.equal(r.status, 3, r.err);
  assert.match(r.err, /no-such: no versions/);
  assert.equal(F.run(F.old, ['artifact', 'versions', 'Bad_Slug']).status, 1, 'a bad slug dies');
});

test('a listed version is served read-only at its url, under the artifact sandbox', async (t) => {
  const F = threadsFixture('versions-a3');
  const later = cleanup(t);
  later(() => F.done());
  const B = await startApi(F, later);
  landArtifact(F, 'viewer-mock', mock(1));
  landArtifact(F, 'viewer-mock', { ...mock(2), 'img/a.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' });
  landArtifact(F, 'viewer-mock', mock(3));
  const draft = path.join(F.old, '.worktrees', 'demo-01-draft', ARTIFACTS_REL, 'viewer-mock');
  for (const [rel, text] of Object.entries(mock('d1'))) write(path.join(draft, rel), text);
  const r = await apiJson(B, 'viewer-mock');
  assert.deepEqual(r.versions.map((v) => v.kind), ['draft', 'landed', 'earlier', 'earlier']);
  const main = await fetch(`${B}/artifact/main/viewer-mock/`);
  assert.equal(main.status, 200);
  const mainCsp = main.headers.get('content-security-policy');
  const want = [...r.versions.map((v) => (v.kind === 'draft' ? fs.readFileSync(path.join(draft, 'index.html'), 'utf8') : null))];
  let n = 3;
  for (const [i, v] of r.versions.entries()) {
    const res = await fetch(B + v.url);
    assert.equal(res.status, 200, v.url);
    assert.equal(await res.text(), want[i] ?? mock(n--)['index.html'], `${v.url}: that version's bytes`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp.includes('sandbox allow-scripts'), `${v.url}: sandboxed`);
    assert.equal(csp.replaceAll(B + v.url.replace(/\/$/, ''), `${B}/artifact/main/viewer-mock`), mainCsp.replaceAll(`${B}/artifact/main/viewer-mock/`.replace(/\/$/, ''), `${B}/artifact/main/viewer-mock`), `${v.url}: main's policy, its folder aside`);
    assert.equal(res.headers.get('x-frame-options'), null, `${v.url}: no x-frame-options`);
    assert.notEqual((await fetch(B + v.url, { method: 'POST' })).status, 200, `${v.url}: nothing can be written`);
  }
});

test('/api/artifact-versions: guards', async (t) => {
  const F = threadsFixture('versions-a6-api');
  const later = cleanup(t);
  later(() => F.done());
  const B = await startApi(F, later);
  landArtifact(F, 'viewer-mock', mock(1));
  landArtifact(F, 'viewer-mock', mock(2));
  assert.equal((await apiVersions(B, 'Bad_Slug')).status, 400);
  assert.equal((await fetch(`${B}/api/artifact-versions`)).status, 400, 'no slug');
  const none = await apiVersions(B, 'no-such');
  assert.equal(none.status, 404);
  assert.equal(typeof (await none.json()).error, 'string');
  assert.equal((await apiVersions(B, 'viewer-mock', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await apiVersions(B, 'viewer-mock', { 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal((await apiVersions(B, 'viewer-mock')).status, 200, 'no header (curl, the gateway)');
  const bodies = await Promise.all([1, 2, 3].map(async () => (await apiVersions(B, 'viewer-mock')).text()));
  assert.equal(new Set(bodies).size, 1, 'three concurrent asks, one answer');
  assert.deepEqual(JSON.parse(bodies[0]), cliVersions(F, 'viewer-mock'));
});
