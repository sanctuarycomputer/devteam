// The split tool's overlay (kit-899): every folder (area) under <split dir>/overlay/, in name order,
// may hold rules.mjs (rules and checks), overrides/ (hash-pinned declarations), files/ and patches/.
// Each test builds a fixture repo (a small CLI at the kit's own paths, a gateway, a Dockerfile) and a
// split dir with both manifests and the areas it names, copied from test/fixtures/split-overlay/areas/
// or written by the test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'test', 'split', 'split.mjs');
const FX = path.join(root, 'test', 'fixtures', 'split-overlay');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_)/.test(k)));
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 28, ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-overlay-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const kitSrc = fs.readFileSync(path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs'), 'utf8');
const PARTS = kitSrc.slice(kitSrc.indexOf('/* parts start */'), kitSrc.indexOf('/* parts end */') + '/* parts end */'.length);
const SOURCE = fs.readFileSync(path.join(FX, 'source.txt'), 'utf8').replace('/* PARTS */', PARTS);
const CLI = 'docs/devteam/scripts/devteam.mjs';
const ONE = 'docs/devteam/scripts/lib/one.mjs';
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');

// A fixture repo (one commit, or two when change is given) and a split dir with the named areas
// (fixture names, or [name, make(dir)] for an area the test writes); split runs once, with --json.
function fixture(name, areas, change) {
  const dir = path.join(tmp, name);
  const repo = path.join(dir, 'repo');
  const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), t); };
  put(CLI, SOURCE);
  put('cloud/gateway.mjs', fs.readFileSync(path.join(FX, 'gateway.txt'), 'utf8'));
  put('cloud/Dockerfile', fs.readFileSync(path.join(FX, 'Dockerfile'), 'utf8'));
  put('README.md', 'fixture\n');
  const g = (...a) => assert.equal(run('git', ['-C', repo, ...a]).status, 0, a.join(' '));
  const commit = () => { g('add', '-A'); g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'fixture'); };
  g('init', '-q');
  commit();
  if (change) { change(put, (f) => fs.readFileSync(path.join(repo, f), 'utf8')); commit(); }
  const split = path.join(dir, 'split');
  fs.mkdirSync(path.join(split, 'overlay'), { recursive: true });
  for (const m of ['manifest.json', 'manifest-gateway.json']) fs.copyFileSync(path.join(FX, m), path.join(split, m));
  for (const a of areas) {
    if (typeof a === 'string') fs.cpSync(path.join(FX, 'areas', a), path.join(split, 'overlay', a), { recursive: true });
    else { fs.mkdirSync(path.join(split, 'overlay', a[0])); a[1](path.join(split, 'overlay', a[0])); }
  }
  const sha = run('git', ['-C', repo, 'rev-parse', 'HEAD']).stdout.trim();
  const opts = ['--repo', repo, '--split-dir', split, '--at', sha];
  const out = path.join(dir, 'tree');
  const r = run(process.execPath, [tool, ...opts, '--out', out, '--json'], { cwd: os.tmpdir() });
  let j = {};
  try { j = JSON.parse(r.stdout); } catch { /* the test's own assertion names it */ }
  const read = (f) => (fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf8') : null);
  const verify = () => run(process.execPath, [tool, ...opts, '--verify', '--tree', out], { cwd: os.tmpdir() });
  return { dir, split, opts, out, r, j, read, verify };
}
const applied = (j) => (j.overlay?.applied ?? []).map((a) => `${a.area} ${a.kind} ${a.name}`);
const staleOf = (j) => (j.overlay?.stale ?? []).map((s) => `${s.area} ${s.kind} ${s.name}`);
const conflictsOf = (j) => (j.overlay?.conflicts ?? []).map((c) => `${c.kind} ${c.name}: ${c.areas.join(', ')}`);
const file = (d, rel, text) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
const rule = (body) => (d) => file(d, 'rules.mjs', `export const rules = [{ name: 'r', apply(t) { ${body} } }];\n`);

const each = fixture('each', ['10-each']);
const ordered = fixture('ordered', ['10-each', '20-later', '3-last']);
const clash = fixture('clash', ['10-each', '30-clash']);
const collide = fixture('collide', ['10-each', '60-rules']);
const unnamed = fixture('unnamed', ['40-unnamed']);
const adds = fixture('adds', ['45-adds']);
const stale = fixture('stale', ['10-each', '50-gone'], (put, get) => {
  put(CLI, get(CLI).replace('return `hello ${who}`;', 'return `hello, ${who}`;'));
  put('cloud/Dockerfile', get('cloud/Dockerfile').replace('COPY docs/devteam /opt/devteam/kit', 'COPY docs/devteam /kit'));
});

test('O1: an area using every kind is applied and reported, across both manifests', () => {
  assert.deepEqual(applied(each.j), [
    '10-each override greet', '10-each override route', '10-each rule entry', '10-each check no-meta',
    '10-each file docs/devteam/scripts/cli.mjs', '10-each file docs/devteam/scripts/devteam.mjs', '10-each file notes/same.txt',
    '10-each patch dockerfile.patch',
  ], each.r.stderr);
  assert.equal(each.r.status, 0, each.r.stderr);
  assert.deepEqual(each.j.stale, []);
  assert.deepEqual(each.j.overlay.ignored, ['overlay/10-each/finding.mjs']);
  const one = each.read(ONE);
  assert.match(one, /^export function greet\(who\) \{\n {2}return `hi \$\{who\}`;/m, 'the override');
  assert.match(one, /^export function whereAmI\(\) \{ return path\.dirname\(process\.argv\[1\]\); \}$/m, 'the rule');
  assert.doesNotMatch(one, /fileURLToPath/, 'the imports region is made again: fileURLToPath is no longer imported');
  assert.match(each.read('cloud/gateway/routes.mjs'), /^export function route\(p\) \{ return `routed \$\{p\}`; \}$/m, "the gateway manifest's override");
  assert.equal(each.read('cloud/Dockerfile'), 'FROM node:22\nCOPY docs/devteam /opt/devteam/kit\nCOPY cloud/gateway /opt/devteam/gateway\nCMD ["node"]\n');
  assert.equal(each.read('notes/same.txt'), 'written by 10-each\n');
  assert.equal(each.read('order/10-each.txt'), '10-each\n');
});

test('O2: areas run in name order (10-each, 20-later, 3-last)', () => {
  assert.equal(ordered.read('order/3-last.txt'), '10-each\n20-later\n3-last\n');
  assert.deepEqual(ordered.j.overlay.areas, ['10-each', '20-later', '3-last']);
});

test('O3: an override whose original changed, a patch that no longer applies and rule sites refused or not placed mark the tree stale, each named', () => {
  assert.deepEqual(staleOf(stale.j), ['10-each override greet', '50-gone rule gone', '50-gone rule refuser', '50-gone rule thrower', '10-each patch dockerfile.patch'], stale.r.stderr);
  const why = Object.fromEntries(stale.j.overlay.stale.map((s) => [s.name, s.why]));
  assert.match(why.greet, /the original changed: it is now sha256:[0-9a-f]{64}, the override was written against sha256:6ef44c58/);
  assert.match(why.gone, /names nowhere as changed, but the tool can't place it: it is in no module/);
  assert.match(why.refuser, /refused serve: the pattern is not there/);
  assert.match(why.thrower, /threw: boom/);
  assert.match(why['dockerfile.patch'], /no longer applies/);
  assert.equal(stale.read('THROWN.txt'), null, 'a rule that threw: its writes are discarded');
  assert.match(stale.read(ONE), /return `hello, \$\{who\}`;/, 'the stale override is not applied');
});

test('O4: --json carries the stale list as `stale`, and the tree is still written when only stale items are found', () => {
  assert.ok(Array.isArray(stale.j.stale) && stale.j.stale.length === 5, JSON.stringify(stale.j.stale));
  for (const s of stale.j.stale) for (const k of ['area', 'kind', 'name', 'why']) assert.equal(typeof s[k], 'string', `${k} in ${JSON.stringify(s)}`);
  assert.equal(stale.r.status, 0, stale.r.stderr);
  assert.ok(stale.read(ONE), 'the tree is written');
  assert.ok(stale.read('docs/devteam/scripts/cli.mjs'), 'the tree is written');
});

test('O5: --verify accepts the declarations a rule or override names as changed, and only those', () => {
  const v = each.verify();
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.match(v.stdout, /accepted as changed by the overlay: greet, whereAmI/);
  assert.match(v.stdout, /accepted as changed by the overlay: route/);
  const u = unnamed.verify();
  assert.match(u.stdout, /changed: other /, 'a declaration the rule changed without naming it is named');
  assert.doesNotMatch(u.stdout, /changed: helper /, 'the one it named is accepted');
  assert.equal(u.status, 1);
});

test('O6: --verify still names an accepted declaration changed beyond what the overlay makes of it', () => {
  const f = path.join(each.out, ONE);
  const was = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, was.replace('return `hi ${who}`;', 'return `HI ${who}`;'));
  try {
    const v = each.verify();
    assert.match(v.stdout, /changed: greet in docs\/devteam\/scripts\/lib\/one\.mjs differs from what the overlay makes of it/);
    assert.equal(v.status, 1);
  } finally { fs.writeFileSync(f, was); }
});

test('O7: --verify accepts a declaration the overlay adds only where the overlay put it, once', () => {
  const ok = adds.verify();
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const two = path.join(adds.out, 'docs/devteam/scripts/lib/two.mjs');
  const was = fs.readFileSync(two, 'utf8');
  fs.writeFileSync(two, `${was}export function setOther() { return 3; }\n`);
  try {
    const v = adds.verify();
    assert.match(v.stdout, /placed: setOther is in docs\/devteam\/scripts\/lib\/one\.mjs, docs\/devteam\/scripts\/lib\/two\.mjs in the tree, and the overlay puts it in docs\/devteam\/scripts\/lib\/one\.mjs/);
    assert.equal(v.status, 1);
  } finally { fs.writeFileSync(two, was); }
});

test("O8: an area's files/ replaces the default docs/devteam/scripts/cli.mjs", () => {
  assert.equal(each.read('docs/devteam/scripts/cli.mjs'), fs.readFileSync(path.join(FX, 'areas/10-each/files/docs/devteam/scripts/cli.mjs'), 'utf8'));
});

test("O9: an area's files/ replaces the tree's docs/devteam/scripts/devteam.mjs", () => {
  assert.equal(each.read(CLI), fs.readFileSync(path.join(FX, 'areas/10-each/files/docs/devteam/scripts/devteam.mjs'), 'utf8'));
});

test('O10: two areas writing one tree file, or overriding one declaration, are a conflict naming both, and neither applies', () => {
  const c = conflictsOf(clash.j);
  assert.ok(c.includes('file notes/same.txt: 10-each, 30-clash'), c.join('\n'));
  assert.ok(c.includes('declaration greet: 10-each, 30-clash'), c.join('\n'));
  assert.equal(clash.read('notes/same.txt'), null, 'neither area wins by folder order');
  assert.match(clash.read(ONE), /return `hello \$\{who\}`;/, 'neither override applies');
  assert.ok(clash.j.stale.some((s) => s.kind === 'file conflict' && s.area === '10-each and 30-clash'), 'a conflict is in the stale list');
});

test("O11: a rule writing another area's file, or changing another area's declaration, is a conflict naming both, and neither applies", () => {
  const c = conflictsOf(collide.j);
  assert.ok(c.includes('file notes/same.txt: 10-each, 60-rules'), c.join('\n'));
  assert.ok(c.includes('declaration whereAmI: 10-each, 60-rules'), c.join('\n'));
  assert.equal(collide.read('notes/same.txt'), null, "neither 10-each's file nor 60-rules' write");
  assert.match(collide.read(ONE), /^export function whereAmI\(\) \{ return path\.dirname\(fileURLToPath\(import\.meta\.url\)\); \}$/m, 'neither rule applies');
});

test('O12: patches from two areas to one file apply in name order, and a conflict between them names both', () => {
  assert.equal(ordered.read('cloud/Dockerfile'), 'FROM node:22\nCOPY docs/devteam /opt/devteam/kit\nCOPY cloud/gateway /opt/devteam/gateway\nRUN npm i -g devteam\nCMD ["node"]\n');
  const c = conflictsOf(clash.j);
  assert.ok(c.includes('patch cloud/Dockerfile: 10-each, 30-clash'), c.join('\n'));
  assert.equal(clash.read('cloud/Dockerfile'), 'FROM node:22\nCOPY docs/devteam /opt/devteam/kit\nCOPY cloud/gateway /opt/devteam/gateway\nCMD ["node"]\n');
});

test('O13: overrides of one name in two sources are two declarations, both applied', () => {
  const o = (src, text) => (d) => file(d, 'overrides/serve.mjs', `// override serve sha256:${sha256(text)} in ${src}\nfunction serve() { return 'overridden'; }\n`);
  const f = fixture('same-name', [['10-cli', o(CLI, "function serve() { return 'cli'; }")], ['20-gw', o('cloud/gateway.mjs', "function serve() { return route('/'); }")]]);
  assert.deepEqual(conflictsOf(f.j), []);
  assert.deepEqual(applied(f.j), ['10-cli override serve', '20-gw override serve'], f.r.stderr);
});

// R1: a malformed overlay refuses (exit 2) before anything is written; one test per kind
const refused = (k, make) => {
  const f = fixture(`refuse-${k}`, [['10-bad', make]]);
  assert.equal(f.r.status, 2, `${k}: ${f.r.stderr}`);
  assert.match(f.r.stderr, /overlay: overlay\/10-bad/, k);
  assert.equal(fs.existsSync(f.out), false, `${k}: nothing written`);
};
test('R1a: an override with an unreadable header refuses', () => refused('header', (d) => file(d, 'overrides/x.mjs', '// overrides x\nfunction x() {}\n')));
test('R1b: a rules.mjs that throws on import refuses', () => refused('load', (d) => file(d, 'rules.mjs', "throw new Error('no');\n")));
test('R1c: files as a plain file refuses', () => refused('shape', (d) => file(d, 'files', 'a file, not a folder\n')));

test('R2: with no overlay folder the tree is the plain split, reported clean', () => {
  const f = fixture('none', []);
  assert.equal(f.r.status, 0, f.r.stderr);
  assert.deepEqual(f.j.overlay?.areas, []);
  assert.deepEqual(f.j.stale, []);
  assert.equal(f.read(CLI), SOURCE);
  const v = f.verify();
  assert.equal(v.status, 0, v.stdout + v.stderr);
});

test('R3: files/ at a module the split generates is stale, and not written', () => {
  const f = fixture('module', ['70-module']);
  assert.deepEqual(staleOf(f.j), ['70-module file docs/devteam/scripts/lib/two.mjs'], f.r.stderr);
  assert.match(f.read('docs/devteam/scripts/lib/two.mjs'), /^export function main\(\)/m);
});

// R4: an overlay path the commit has as a folder, or under one of its files, refuses (exit 1) with
// nothing written
const badPath = (k, make, re) => {
  const f = fixture(`path-${k}`, [['10-path', make]]);
  assert.match(f.r.stderr, re, k);
  assert.equal(f.r.status, 1, `${k}: ${f.r.stderr}`);
  assert.equal(fs.existsSync(f.out), false, `${k}: nothing written`);
};
test('R4a: a rule writing a path the commit has as a folder refuses', () => badPath('folder', rule("t.write('cloud', 'x'); return { changed: [{ file: 'cloud' }], refused: [] };"), /cloud is a folder in [0-9a-f]{8}/));
test("R4b: files/ under a path the commit has as a file refuses", () => badPath('under', (d) => file(d, 'files/cloud/Dockerfile/inner.txt', 'x\n'), /cloud\/Dockerfile is a file in [0-9a-f]{8}/));

test('R5: a module the overlay grows past the cap is stale, and --verify names it', () => {
  const big = Array.from({ length: 2100 }, (_, i) => `  // line ${i}`).join('\n');
  const f = fixture('cap', [['10-big', (d) => file(d, 'overrides/greet.mjs', `// override greet sha256:6ef44c58c92214c043bc7593be02c5d8dc179e49ad278073086fa040e6d3a955\nfunction greet(who) {\n${big}\n  return who;\n}\n`)]]);
  assert.deepEqual(staleOf(f.j), [`(overlay) cap ${ONE}`], f.r.stderr);
  assert.match(f.verify().stdout, /over the cap: docs\/devteam\/scripts\/lib\/one\.mjs is \d+ lines \(cap 2000\)/);
});
