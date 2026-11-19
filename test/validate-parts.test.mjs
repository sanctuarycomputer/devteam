// Tickets that change different parts of one big file run at once (kit-299): touches entries that
// name parts (path#name, path#+name) of a file settings.split_files lists; D4 and ready compare the
// parts' lines at main, validate checks they exist, and check-ticket refuses a change to a part the
// ticket didn't name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, fleetFixture, write, json } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const DTREL = 'docs/devteam/scripts/devteam.mjs';
const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');

// The pure parts region of devteam.mjs, run on its own.
function partsFns() {
  const a = SRC.indexOf('/* parts start */'), b = SRC.indexOf('/* parts end */');
  assert.ok(a >= 0 && b > a, 'devteam.mjs has a /* parts */ region');
  const ctx = vm.createContext({});
  return vm.runInContext(`${SRC.slice(a, b)}\n;({ fileParts, partLeaves, leafTexts, touchPath, touchPart, partsChanged })`, ctx);
}
const range = (P, name) => JSON.parse(JSON.stringify(P.places.get(name) ?? null));

test('parts: declarations, their comments, regions and the rest of a .mjs file', () => {
  const { fileParts, partLeaves, leafTexts } = partsFns();
  const text = [
    "import fs from 'node:fs';", // 1 rest
    '', // 2 rest
    '// says what a does', // 3 a
    'function a() {', // 4 a
    '  return 1;', // 5 a
    '}', // 6 a
    '', // 7 a
    'async function b() { return 2; }', // 8 b
    'const TABLE = {', // 9 TABLE
    '  x: 1,', // 10
    '};', // 11
    '/* r start */', // 12 r rest
    '// c', // 13 c
    'function c() {}', // 14 c
    'function d() {}', // 15 d
    '/* r end */', // 16 r rest
    'const tpl = `', // 17 tpl
    '<div>', // 18 tpl: html in a template stays in its declaration
    '`;', // 19 tpl
  ].join('\n') + '\n';
  const P = fileParts(text, 'x.mjs');
  assert.deepEqual(range(P, 'a'), [{ from: 3, to: 7 }], 'a function with the comment above it, through the line before the next');
  assert.deepEqual(range(P, 'b'), [{ from: 8, to: 8 }]);
  assert.deepEqual(range(P, 'TABLE'), [{ from: 9, to: 11 }], 'a const ends at the region marker');
  assert.deepEqual(range(P, 'r'), [{ from: 12, to: 16 }]);
  assert.deepEqual(range(P, 'c'), [{ from: 13, to: 14 }]);
  assert.deepEqual(range(P, 'd'), [{ from: 15, to: 15 }], 'ends before the end marker');
  assert.deepEqual(range(P, 'tpl'), [{ from: 17, to: 19 }]);
  assert.deepEqual([...partLeaves(P, 'r')].sort(), ['d:r/c#1', 'd:r/d#1', 'r:r'], 'a region covers what it holds and its own rest, keyed under its name');
  assert.deepEqual([...partLeaves(P, 'a')], ['d:a#1']);
  const L = leafTexts(P);
  assert.equal(L.get('r:'), "import fs from 'node:fs';", "the file's rest, trailing blanks dropped");
  assert.equal(L.get('d:a#1'), '// says what a does\nfunction a() {\n  return 1;\n}');
  assert.equal(L.get('r:r'), '/* r start */\n/* r end */');
});

test('parts: an .html file ends a declaration at a tag line; <!-- --> regions', () => {
  const { fileParts, leafTexts } = partsFns();
  const text = ['<html>', '<!-- page start -->', '<section id="p"></section>', '<!-- page end -->', '<script>', 'function draw() {', '  x();', '}', '</script>', '</html>'].join('\n');
  const P = fileParts(text, 'index.html');
  assert.deepEqual(range(P, 'page'), [{ from: 2, to: 4 }]);
  assert.deepEqual(range(P, 'draw'), [{ from: 6, to: 8 }], 'stops before </script>');
  assert.equal(leafTexts(P).get('r:'), '<html>\n<script>\n</script>\n</html>');
});

test('parts: .md headings by slug, holding their sub-headings; fences and duplicates', () => {
  const { fileParts, partLeaves } = partsFns();
  const text = ['# Supervisor', 'intro', '## 3. The tick', 'a', '### Monitoring', 'b', '```', '# not a heading', '```', '## 4. Fixing drift', 'c', '### Monitoring', 'd'].join('\n');
  const P = fileParts(text, 'supervisor.md');
  assert.deepEqual(range(P, '3-the-tick'), [{ from: 3, to: 9 }]);
  assert.deepEqual(range(P, 'supervisor'), [{ from: 1, to: 13 }]);
  assert.equal(P.places.has('not-a-heading'), false, 'a # inside a fence is no heading');
  assert.deepEqual(range(P, 'monitoring'), [{ from: 5, to: 9 }, { from: 12, to: 13 }], 'a duplicate name names both places');
  assert.deepEqual([...partLeaves(P, '3-the-tick')].sort(), ['d:supervisor/3-the-tick#1', 'd:supervisor/3-the-tick/monitoring#1'], 'keyed by the headings above');
  assert.ok(P.owner.includes('d:supervisor/4-fixing-drift/monitoring#1'), 'a duplicate heading has its own path');
});

test('parts: indented markers, markers whose name has a space, _ in a slug, a region in a .md file', () => {
  const { fileParts, partLeaves } = partsFns();
  const js = [
    'function f() {', // 1
    '  /* inner start */', // 2 indented: a region, but f goes on
    '  x();', // 3
    '  /* inner end */', // 4
    '}', // 5
    '/* devteam-ui tokens start */', // 6 a space in the name: no marker
    'function g() {}', // 7
    '/* devteam-ui tokens end */', // 8
  ].join('\n');
  const P = fileParts(js, 'a.mjs');
  assert.deepEqual(range(P, 'f'), [{ from: 1, to: 5 }], 'an indented marker sits inside a body and ends nothing');
  assert.deepEqual(range(P, 'inner'), [{ from: 2, to: 4 }]);
  assert.deepEqual([...partLeaves(P, 'inner')], ['d:f#1'], 'a region cutting through a declaration covers it whole');
  assert.equal(P.places.has('devteam-ui'), false);
  assert.equal(P.places.has('tokens'), false);
  assert.deepEqual(range(P, 'g'), [{ from: 6, to: 8 }], 'a space-named marker is just a comment: it ends nothing, and the one above g is g\'s');
  const css = ['<style>', '  /* devteam-layout start */', '  .a {}', '  /* devteam-layout end */', '</style>'].join('\n');
  assert.deepEqual(range(fileParts(css, 'hub.html'), 'devteam-layout'), [{ from: 2, to: 4 }], 'an indented CSS marker forms a region');
  const md = ['# Top', '## The snake_case rule', 'a', '<!-- r start -->', 'b', '<!-- r end -->', '## Next', 'c'].join('\n');
  const M = fileParts(md, 'x.md');
  assert.ok(M.places.has('the-snake_case-rule'), '_ survives in a slug');
  assert.deepEqual([...partLeaves(M, 'r')], ['d:top/the-snake_case-rule#1'], "a region in a heading's section covers that heading's leaf");
});

test('parts: no space after function is no declaration; a repeated start, a start with no end, CRLF', () => {
  const { fileParts } = partsFns();
  const P = fileParts(['functionality = 1;', 'function a() {}', '/* r start */', '/* r start */', 'function b() {}', '/* r end */', '/* lone start */', 'function c() {}'].join('\n'), 'x.mjs');
  assert.equal(P.places.has('ality'), false, 'functionality is not function ality');
  assert.deepEqual(range(P, 'r'), [{ from: 3, to: 6 }], 'a second start of the same name before its end is ignored');
  assert.equal(P.places.has('lone'), false, 'a start with no end is no region');
  const C = fileParts(['/* r start */', 'function a() {}', '/* r end */', '## Head', 'x'].join('\r\n'), 'x.mjs');
  assert.deepEqual(range(C, 'r'), [{ from: 1, to: 3 }], 'CRLF markers');
  assert.deepEqual(range(C, 'a'), [{ from: 2, to: 2 }]);
  const M = fileParts(['## Head One', 'x'].join('\r\n'), 'x.md');
  assert.ok(M.places.has('head-one'), 'a CRLF heading has the same slug');
});

test('the gate judges a leaf the base has by the base: a part widened at the head covers nothing more', () => {
  const { partsChanged: inVm } = partsFns();
  const partsChanged = (...args) => [...inVm(...args)]; // an array of this realm, for deepEqual
  const named = (...n) => n.map((x) => ({ name: x.replace(/^\+/, ''), added: x.startsWith('+') }));
  const md = ['## 3. The tick', 'a', '### Monitoring', 'b', '## 4. Fixing drift', 'c'].join('\n');
  // demoting ## 4 under ## 3, then editing it: 4-fixing-drift was not the ticket's at the base
  assert.deepEqual(partsChanged(md, md.replace('## 4. Fixing drift\nc', '### 4. Fixing drift\nc edited'), 'x.md', named('3-the-tick')), ['d:4-fixing-drift#1']);
  // a new heading above Monitoring, then Monitoring edited
  assert.deepEqual(partsChanged(md, md.replace('### Monitoring\nb', '## New\n### Monitoring\nb edited'), 'x.md', named('+new')), ['d:3-the-tick/monitoring#1']);
  // a sub-heading added under a named heading is the heading's
  assert.deepEqual(partsChanged(md, md.replace('### Monitoring', '### Added\nn\n### Monitoring'), 'x.md', named('3-the-tick')), []);
  const js = ['/* r start */', 'function a() {}', '/* r end */', 'function b() {}'].join('\n');
  // widening a named region around b, then editing b
  assert.deepEqual(partsChanged(js, ['/* r start */', 'function a() {}', 'function b() { edited }', '/* r end */'].join('\n'), 'x.mjs', named('r')), ['d:b#1']);
  // a region added around b by +name
  assert.deepEqual(partsChanged(js, js.replace('function b() {}', '/* s start */\nfunction b() { edited }\n/* s end */'), 'x.mjs', named('+s')), ['d:b#1']);
  // a same-named heading added in a section the ticket didn't name: it is that section's, not the
  // named one's, however the names count (final-1 F1)
  const dup = ['## 4. Fixing drift', 'x', '## 9. Improvement', 'y', '### Artifacts', 'z'].join('\n');
  assert.deepEqual(partsChanged(dup, dup.replace('x\n', 'x\n### Artifacts\nnew\n'), 'x.md', named('9-improvement')), ['d:4-fixing-drift/artifacts#1']);
  // deleting the named section's own sub-heading when a later section has one of the same name
  const notes = ['## A', 'a', '### Notes', 'n1', '## B', 'b', '### Notes', 'n2'].join('\n');
  assert.deepEqual(partsChanged(notes, notes.replace('### Notes\nn1\n', ''), 'x.md', named('a')), [], 'not refused for a name B also has');
  // +name of a name the base has covers no new place of it either (final-1 F2)
  const one = ['function cmdReady() {}', 'function other() {}'].join('\n');
  assert.deepEqual(partsChanged(one, `${one}\nfunction cmdReady() { again }`, 'x.mjs', named('+cmdReady')), ['d:cmdReady#2']);
  // a function added inside a named region is the region's
  assert.deepEqual(partsChanged(js, js.replace('function a() {}', 'function a() {}\nfunction c() {}'), 'x.mjs', named('r')), []);
});

test('touches entries: path and part', () => {
  const { touchPath, touchPart } = partsFns();
  assert.equal(touchPath('a/b.mjs#x'), 'a/b.mjs');
  assert.equal(touchPath('a/b/**'), 'a/b/**');
  assert.equal(touchPart('a/b.mjs'), null);
  assert.deepEqual({ ...touchPart('a/b.mjs#+x') }, { name: 'x', added: true });
  assert.deepEqual({ ...touchPart('a/b.mjs#x') }, { name: 'x', added: false });
  assert.deepEqual({ ...touchPart('a/b.mjs#++x') }, { name: '+x', added: true }, 'one + only: the name keeps the second');
});

test('split_files: a setting of its own, [] by default, on the Settings page', () => {
  const F = fleetFixture('parts-setting');
  try {
    const all = json(F.ok(F.old, ['dashboard-data'])).settings_all;
    const e = all.find((x) => x.key === 'split_files');
    assert.ok(e, 'split_files is in settings_all');
    assert.deepEqual(e.default, []);
    assert.equal(e.set, false);
    assert.equal(e.group, 'Merging and checks');
    assert.equal(e.shown, 'value');
  } finally { F.done(); }
});

// A project whose main lists split files, with chore tickets on them. A ticket's touches are set
// with ticket set; validate and ready are the supervisor's.
const editSettings = (dir, fn) => {
  const f = path.join(dir, 'docs/devteam/project/settings.md');
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  const j = JSON.parse(m[1]);
  fn(j);
  fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
};
function partsProject(name, split) {
  const F = fleetFixture(name);
  F.split = (list) => {
    editSettings(F.old, (j) => { j.split_files = list; });
    F.g(['commit', '-qam', `split_files ${list.length}`], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
  };
  F.split(split);
  F.ticket = (id, touches, extra = {}) => F.ok(F.old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'app', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches, done_when: ['the part is changed'], notes: 'a test ticket', ...extra })], SUP);
  F.touches = (id, touches) => F.ok(F.old, ['ticket', 'set', id, '--json', JSON.stringify({ touches })], SUP);
  F.validate = (env = {}) => { const r = F.run(F.old, ['validate'], { ...SUP, ...env }); return `${r.out}\n${r.err}`; };
  F.d4 = (a, b, env) => F.validate(env).split('\n').filter((l) => l.includes(`${a} and ${b} can run concurrently`) || l.includes(`${b} and ${a} can run concurrently`));
  return F;
}
const DT = 'docs/devteam/scripts/devteam.mjs';

test('D4 and ready: different parts of one split file run together; the same part, a nested one, or the whole file do not', () => {
  const F = partsProject('parts-d4', [DT]);
  try {
    F.ticket('app-01-ready', [`${DT}#cmdReady`]);
    F.ticket('app-02-other', [`${DT}#cmdValidate`]);
    assert.deepEqual(F.d4('app-01-ready', 'app-02-other'), [], 'different parts: no D4');
    F.touches('app-02-other', [`${DT}#cmdReady`]);
    assert.equal(F.d4('app-01-ready', 'app-02-other').length, 1, 'the same part: D4');
    F.touches('app-02-other', [DT]);
    assert.equal(F.d4('app-01-ready', 'app-02-other').length, 1, 'a part and the whole file: D4');
    F.touches('app-01-ready', [`${DT}#globs`]);
    F.touches('app-02-other', [`${DT}#globsOverlap`]);
    assert.equal(F.d4('app-01-ready', 'app-02-other').length, 1, 'a region and a function inside it: D4');
    F.touches('app-01-ready', [`${DT}#+cmdNew`]);
    F.touches('app-02-other', [`${DT}#+cmdNew`]);
    assert.equal(F.d4('app-01-ready', 'app-02-other').length, 1, 'the same new part: D4');
    F.touches('app-02-other', [`${DT}#cmdReady`]);
    assert.deepEqual(F.d4('app-01-ready', 'app-02-other'), [], 'a new part and an existing one: no D4');
    // ready: with app-01 running on #cmdReady, a #cmdValidate ticket doesn't wait for it; a #cmdReady or whole-file one does
    F.touches('app-01-ready', [`${DT}#cmdReady`]);
    F.touches('app-02-other', [`${DT}#cmdValidate`]);
    F.ticket('app-03-same', [`${DT}#cmdReady`], { depends_on: [] });
    F.ticket('app-04-whole', [DT]);
    F.ok(F.old, ['phase', 'build'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'app-01-ready' });
    const rows = Object.fromEntries(json(F.ok(F.old, ['ready', '--json'], SUP)).ready.map((r) => [r.id, r]));
    assert.ok(rows['app-02-other'], 'app-02-other is ready');
    assert.equal(rows['app-02-other'].overlaps_active, undefined, 'a different part: ready to start');
    assert.deepEqual(rows['app-03-same']?.overlaps_active, ['app-01-ready'], 'the same part waits');
    assert.deepEqual(rows['app-04-whole']?.overlaps_active, ['app-01-ready'], 'the whole file waits');
    // a file main lacks: its parts can't be read, so they overlap (validate also refuses them)
    F.split([DT, 'docs/devteam/scripts/nope.mjs', 'docs/devteam/scripts']);
    F.touches('app-01-ready', ['docs/devteam/scripts/nope.mjs#a']);
    F.touches('app-02-other', ['docs/devteam/scripts/nope.mjs#b']);
    assert.equal(F.d4('app-01-ready', 'app-02-other').length, 1, 'a file missing at main: D4');
    // a part of a folder (listed itself) and a part of a file in it are different paths: D4
    F.touches('app-01-ready', ['docs/devteam/scripts#a']);
    F.touches('app-02-other', [`${DT}#cmdReady`]);
    assert.equal(F.d4('app-01-ready', 'app-02-other').length, 1, 'different paths that overlap: D4');
    F.touches('app-01-ready', [`${DT}#cmdReady`]);
    F.touches('app-02-other', [`${DT}#cmdValidate`]);
    F.split([DT]);
    // split_files lists nothing: every file is whole again, and different parts are D4
    F.split([]);
    assert.equal(F.d4('app-01-ready', 'app-02-other').length, 1, 'an unlisted file is touched whole');
    assert.match(F.validate(), /error: app-02-other: touches "docs\/devteam\/scripts\/devteam\.mjs#cmdValidate": docs\/devteam\/scripts\/devteam\.mjs is not in settings\.split_files/, 'and its part entries are refused');
  } finally { F.done(); }
});

test('validate: each named part exists at main, in a file split_files lists; another ticket\'s part errors only warn under a gate', () => {
  const KIT4 = [DT, 'docs/devteam/dashboard/index.html', 'docs/devteam/dashboard/hub.html', 'docs/devteam/process/supervisor.md'];
  const F = partsProject('parts-validate', [...KIT4, 'docs/devteam/scripts/nope.mjs']);
  try {
    const errs = (id) => F.validate().split('\n').filter((l) => l.startsWith(`error: ${id}: touches`));
    const bad = {
      'app-11-missing': [`${DT}#noSuchPart`, /has no part noSuchPart at main/],
      'app-12-plus': [`${DT}#+cmdReady`, /already has a part cmdReady at main; name it without \+/],
      'app-13-unlisted': ['docs/devteam/process/worker.md#3-the-rules', /is not in settings\.split_files, so it is touched whole/],
      'app-14-glob': ['docs/devteam/scripts/*.mjs#x', /a part names one file, not a glob/],
      'app-15-nofile': ['docs/devteam/scripts/nope.mjs#x', /is not on main; a ticket that creates a file names it whole/],
      'app-16-name': [`${DT}#a b`, /a part's name is letters, digits/],
      'app-17-plus2': [`${DT}#++x`, /a part's name is letters, digits/],
    };
    for (const [id, [entry]] of Object.entries(bad)) F.ticket(id, [entry]);
    for (const [id, [, re]] of Object.entries(bad)) { const e = errs(id); assert.equal(e.length, 1, `${id}: ${e.join(' | ')}`); assert.match(e[0], re); }
    for (const id of Object.keys(bad)) F.touches(id, [`app/${id}.txt`]);
    // one part of each of the four files the done-when names, and a region
    F.ticket('app-21-four', [`${DT}#cmdReady`, 'docs/devteam/dashboard/index.html#devteam-shell-js', 'docs/devteam/dashboard/hub.html#tabBar', 'docs/devteam/process/supervisor.md#3-the-tick', `${DT}#globs`]);
    assert.deepEqual(errs('app-21-four'), []);
    // a part a dependency adds
    F.ticket('app-31-adds', [`${DT}#+cmdPartsProbe`]);
    F.ticket('app-32-uses', [`${DT}#cmdPartsProbe`], { depends_on: ['app-31-adds'] });
    assert.deepEqual(errs('app-32-uses'), [], 'named once a dependency adds it');
    assert.deepEqual(errs('app-31-adds'), []);
    // scoped: under another ticket's gate a part error warns; under its own it fails
    F.touches('app-32-uses', [`${DT}#noSuchPart`]);
    const under = (scope) => F.validate({ DEVTEAM_GATE_TICKET: scope }).split('\n').filter((l) => l.includes('app-32-uses: touches'));
    assert.match(under('app-31-adds').join('\n'), /^warning: app-32-uses: touches .*not app-31-adds's to fix$/m);
    assert.match(under('app-32-uses').join('\n'), /^error: app-32-uses: touches/m);
  } finally { F.done(); }
});

// A branch ticket/<id> off main in a worktree of its own, with these edits (file -> text -> text),
// committed; check-ticket runs from the main checkout, whose kit is untouched. Its footprint lines.
function branchFootprint(F, id, edits) {
  const w = path.join(F.base, `wt-${id}`);
  F.g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/main'], F.old);
  for (const [file, fn] of edits) { const f = path.join(w, file); write(f, fn(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')); }
  F.g(['add', '-A'], w);
  F.g(['commit', '-qm', `${id}: edits`], w);
  const sha = F.g(['rev-parse', 'HEAD'], w);
  F.g(['worktree', 'remove', '--force', w], F.old);
  const r = F.run(F.old, ['check-ticket', id, '--sha', sha], SUP);
  return `${r.out}\n${r.err}`.split('\n').filter((l) => /outside touches|changes parts of/.test(l)).join('\n');
}
const swap = (a, b) => (text) => { assert.ok(text.includes(a), `the file has ${a}`); return text.replace(a, b); };
const inReady = swap('function cmdReady() {\n  const ts = tickets();', 'function cmdReady() {\n  const ts = tickets(); // edited');
const inValidate = swap('function cmdValidate() {\n  const ts = tickets();', 'function cmdValidate() {\n  const ts = tickets(); // edited');
const hello = swap('function cmdWaves() {', '// says hello\nfunction cmdPartsProbe() {\n  return 1;\n}\n\nfunction cmdWaves() {');

test('the merge gate: a change to a part the ticket did not name is refused', () => {
  const SUPMD = 'docs/devteam/process/supervisor.md';
  const F = partsProject('parts-gate', [DT, SUPMD]);
  try {
    const run = (id, touches, edits) => { F.ticket(id, touches); return branchFootprint(F, id, edits); };
    assert.equal(run('app-41-named', [`${DT}#cmdReady`], [[DT, inReady]]), '', 'only the named part changed');
    const two = run('app-42-two', [`${DT}#cmdReady`], [[DT, (t) => inValidate(inReady(t))]]);
    assert.match(two, /changes parts of docs\/devteam\/scripts\/devteam\.mjs the ticket doesn't name: cmdValidate \(/);
    assert.match(two, /a part not named is a design-change to the supervisor/);
    assert.doesNotMatch(two, /cmdReady/);
    assert.match(run('app-43-new', [`${DT}#cmdReady`], [[DT, hello]]), /doesn't name: cmdPartsProbe/, 'a new function needs its #+name');
    assert.equal(run('app-44-plus', [`${DT}#+cmdPartsProbe`], [[DT, hello]]), '', 'named with +');
    assert.equal(run('app-45-whole', [DT], [[DT, (t) => hello(inValidate(inReady(t)))]]), '', 'a whole-file entry takes anything');
    assert.match(run('app-46-rest', [`${DT}#cmdReady`], [[DT, swap("import os from 'node:os';", "import os from 'node:os'; // edited")]]), /doesn't name: the file's rest/);
    assert.match(run('app-47-del', [`${DT}#cmdReady`], [[DT, (t) => t.replace(/\nfunction cmdValidate\(\) \{[\s\S]*?\n\}\n/, '\n')]]), /doesn't name: cmdValidate/, 'deleting a part is changing it');
    assert.match(run('app-48-plusold', [`${DT}#+cmdReady`], [[DT, inReady]]), /doesn't name: cmdReady/, '+name never covers a part the base has');
    const inGlobs = swap('function globsOverlap(a, b) {', 'function globsOverlap(a, b) { // edited');
    const addGlobs = swap('/* globs end */', 'function globsNew() {}\n/* globs end */');
    assert.equal(run('app-49-region', [`${DT}#globs`], [[DT, (t) => addGlobs(inGlobs(t))]]), '', 'a named region: edit and add inside it');
    // headings
    const underMon = swap('### Monitoring\n', '### Monitoring\n\nEdited.\n');
    const underDrift = swap('## 4. Fixing drift\n', '## 4. Fixing drift\n\nEdited.\n');
    assert.equal(run('app-51-tick', [`${SUPMD}#3-the-tick`], [[SUPMD, underMon]]), '', 'a sub-heading is its heading\'s');
    assert.match(run('app-52-drift', [`${SUPMD}#3-the-tick`], [[SUPMD, underDrift]]), /changes parts of docs\/devteam\/process\/supervisor\.md the ticket doesn't name: supervisor\/4-fixing-drift/);
    // split_files comes from main: listing a file on the branch doesn't split it
    const SET = 'docs/devteam/project/settings.md';
    const listed = (t) => { const m = t.match(/```json devteam\s*\n([\s\S]*?)\n```/); const j = JSON.parse(m[1]); j.split_files = [...j.split_files, 'docs/devteam/process/worker.md']; return t.replace(m[1], () => JSON.stringify(j, null, 2)); };
    const own = run('app-53-own', ['docs/devteam/process/worker.md#3-the-rules', SET], [[SET, listed], ['docs/devteam/process/worker.md', swap('## 3. The rules\n', '## 3. The rules\n\nEdited.\n')]]);
    assert.match(own, /changes files outside touches: docs\/devteam\/process\/worker\.md/);
    // nor does a checkout whose settings say otherwise: the gate reads main's
    const sf = path.join(F.old, SET);
    const onMain = fs.readFileSync(sf, 'utf8');
    fs.writeFileSync(sf, listed(onMain));
    try {
      const wt = run('app-54-local', ['docs/devteam/process/worker.md#3-the-rules'], [['docs/devteam/process/worker.md', swap('## 3. The rules\n', '## 3. The rules\n\nEdited.\n')]]);
      assert.match(wt, /changes files outside touches: docs\/devteam\/process\/worker\.md/, "the checkout's own split_files changes nothing");
    } finally { fs.writeFileSync(sf, onMain); }
  } finally { F.done(); }
});

test('planning.md, worker.md, supervisor.md and the schema say the same about parts', () => {
  const doc = (f) => fs.readFileSync(path.join(kit, f), 'utf8').replace(/\s+/g, ' ');
  const planning = doc('process/planning.md'), worker = doc('process/worker.md'), supervisor = doc('process/supervisor.md');
  for (const [name, d] of [['planning.md', planning], ['worker.md', worker], ['supervisor.md', supervisor]]) {
    assert.match(d, /`split_files`/, `${name} names split_files`);
    assert.match(d, /`path#name`/, `${name} names the path#name syntax`);
  }
  assert.match(planning, /`path#\+name`/);
  assert.match(planning, /validate` checks each named part exists at main/);
  for (const [name, d] of [['worker.md', worker], ['supervisor.md', supervisor]]) {
    assert.match(d, /merges? (`origin\/main`|main) (into your branch )?before each review and before (you ask for the merge|asking for the merge)/, `${name}: merge main before each review and before merge`);
    assert.match(d, /merge conflict in a part another ticket named/, `${name}: a conflict goes back to the worker`);
  }
  assert.match(worker, /one you find you must change is a `design-change`/);
  assert.match(worker, /merge conflict in a part another ticket named is yours to resolve/, 'the worker resolves it');
  assert.match(supervisor, /merge conflict in a part another ticket named goes back to that worker/, 'the supervisor sends it back');
  const schema = json(fs.readFileSync(path.join(kit, 'schema/log.schema.json'), 'utf8'));
  const find = (o) => (o && typeof o === 'object' ? (o.touches?.description ?? Object.values(o).map(find).find(Boolean)) : undefined);
  assert.match(find(schema), /path#name names one part/);
});
