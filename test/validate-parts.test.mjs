// Tickets that change different parts of one file run at once (kit-299): touches entries that name
// parts (path#name, path#+name) of any file; D4 and ready compare the parts' lines at main, validate
// checks they exist, and check-ticket refuses a change to a part the ticket didn't name. The setting
// split_files only marks files whose whole-file claims warn when they order two tickets.
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
  assert.equal(L.get('r:r'), '/* r start */\n\u241e\n/* r end */', 'a rest in runs: a mark where other leaves come between');
});

test('parts: an .html file ends a declaration at a tag line; <!-- --> regions', () => {
  const { fileParts, leafTexts } = partsFns();
  const text = ['<html>', '<!-- page start -->', '<section id="p"></section>', '<!-- page end -->', '<script>', 'function draw() {', '  x();', '}', '</script>', '</html>'].join('\n');
  const P = fileParts(text, 'index.html');
  assert.deepEqual(range(P, 'page'), [{ from: 2, to: 4 }]);
  assert.deepEqual(range(P, 'draw'), [{ from: 6, to: 8 }], 'stops before </script>');
  assert.equal(leafTexts(P).get('r:'), '<html>\n\u241e\n<script>\n\u241e\n</script>\n</html>');
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

test('parts: # // -- line-comment regions in any text file, but # is a heading in Markdown', () => {
  const { fileParts, partLeaves } = partsFns();
  const rb = ['require "x"', '# billing start', 'def charge', '  1', 'end', '# billing end', '# mail start', 'def send', 'end', '# mail end'].join('\n');
  const R = fileParts(rb, 'app/models/order.rb');
  assert.deepEqual(range(R, 'billing'), [{ from: 2, to: 6 }]);
  assert.deepEqual(range(R, 'mail'), [{ from: 7, to: 10 }]);
  assert.deepEqual([...partLeaves(R, 'billing')], ['r:billing'], 'a region with no declaration is its own rest');
  assert.equal(R.owner[1], 'r:', 'the require line is the file\'s rest');
  const py = ['import os', '', '  # helpers start', '  x = 1', '  # helpers end', '# api start', 'def get():', '    pass', '# api end'].join('\n');
  const Y = fileParts(py, 'tool.py');
  assert.deepEqual(range(Y, 'helpers'), [{ from: 3, to: 5 }], 'an indented # marker');
  assert.deepEqual(range(Y, 'api'), [{ from: 6, to: 9 }]);
  assert.deepEqual(range(fileParts(['a: 1', '# ci start', 'b: 2', '# ci end'].join('\n'), 'x.yml'), 'ci'), [{ from: 2, to: 4 }], 'YAML');
  assert.deepEqual(range(fileParts(['-- q start', 'select 1;', '-- q end'].join('\n'), 'x.sql'), 'q'), [{ from: 1, to: 3 }], 'SQL');
  const js = fileParts(['// wiring start', 'function a() {}', '// wiring end', 'function b() {}'].join('\n'), 'x.mjs');
  assert.deepEqual(range(js, 'wiring'), [{ from: 1, to: 3 }], 'a // marker');
  assert.deepEqual(range(js, 'a'), [{ from: 2, to: 2 }], 'a // marker is no comment of the declaration below it, and ends the one above');
  assert.equal(fileParts(['# a b start', 'x', '# a b end'].join('\n'), 'x.py').places.size, 0, 'a name with a space is no marker');
  assert.equal(fileParts(['## not start', 'x'].join('\n'), 'x.py').places.size, 0, '## is no marker');
  const cls = fileParts(['class Api:', '    # get start', '    def get(self): pass', '    # get end', '    # post start', '    def post(self): pass', '    # post end'].join('\n'), 'api.py');
  assert.equal(cls.places.has('Api'), false, 'a Python class is no declaration: only script files have them');
  assert.deepEqual([...partLeaves(cls, 'get')], ['r:get'], 'so regions inside it stay apart');
  assert.ok(fileParts('# Setup start\nx\n# Setup end\n', 'x.mdx').places.has('setup-start'), '.mdx is Markdown');
  const md = fileParts(['# intro start', 'x', '# intro end'].join('\n'), 'x.md');
  assert.equal(md.places.has('intro'), false, 'in Markdown # starts a heading');
  assert.ok(md.places.has('intro-start'));
});

test('parts: TypeScript declarations in .ts and .tsx files', () => {
  const { fileParts } = partsFns();
  const ts = [
    "import { x } from './x';", // 1 rest
    'export interface Props {', // 2 Props
    '  a: string;', // 3
    '}', // 4
    'export type Id = string;', // 5 Id
    'type Pair<T> = [T, T];', // 6 Pair
    'export const enum Mode { A, B }', // 7 Mode
    'enum Color { Red }', // 8 Color
    'export abstract class Base {}', // 9 Base
    'declare function ext(): void;', // 10 ext
    'export default function App() {', // 11 App
    '  return <div />;', // 12
    '}', // 13
    'const enumerate = 1;', // 14 enumerate, not enum erate
    'type = 3;', // 15 no declaration: in enumerate
  ].join('\n');
  for (const file of ['a.ts', 'a.tsx']) {
    const P = fileParts(ts, file);
    for (const [name, from, to] of [['Props', 2, 4], ['Id', 5, 5], ['Pair', 6, 6], ['Mode', 7, 7], ['Color', 8, 8], ['Base', 9, 9], ['ext', 10, 10], ['App', 11, 13], ['enumerate', 14, 15]]) assert.deepEqual(range(P, name), [{ from, to }], `${file}: ${name}`);
    assert.equal(P.places.has('erate'), false);
    assert.equal(P.owner[1], 'r:');
  }
});

test('the gate judges a leaf the base has by the base: a part widened at the head covers nothing more', () => {
  const { partsChanged: inVm } = partsFns();
  const partsChanged = (...args) => [...inVm(...args)]; // an array of this realm, for deepEqual
  const named = (...n) => n.map((x) => ({ name: x.replace(/^\+/, ''), added: x.startsWith('+') }));
  const md = ['## 3. The tick', 'a', '### Monitoring', 'b', '## 4. Fixing drift', 'c'].join('\n');
  // demoting ## 4 under ## 3, then editing it: 4-fixing-drift was not the ticket's at the base
  assert.deepEqual(partsChanged(md, md.replace('## 4. Fixing drift\nc', '### 4. Fixing drift\nc edited'), 'x.md', named('3-the-tick')), ['d:4-fixing-drift#1']);
  // a new heading above Monitoring, then Monitoring edited
  assert.deepEqual(partsChanged(md, md.replace('### Monitoring\nb', '## New\n### Monitoring\nb edited'), 'x.md', named('+new')).sort(), ['d:3-the-tick/monitoring#1', 'p:3-the-tick'], 'and the new heading sits inside 3-the-tick');
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
  assert.deepEqual(partsChanged(dup, dup.replace('x\n', 'x\n### Artifacts\nnew\n'), 'x.md', named('9-improvement')).sort(), ['d:4-fixing-drift/artifacts#1', 'p:4-fixing-drift']);
  // deleting the named section's own sub-heading when a later section has one of the same name
  const notes = ['## A', 'a', '### Notes', 'n1', '## B', 'b', '### Notes', 'n2'].join('\n');
  assert.deepEqual(partsChanged(notes, notes.replace('### Notes\nn1\n', ''), 'x.md', named('a')), [], 'not refused for a name B also has');
  // +name of a name the base has covers no new place of it either (final-1 F2)
  const one = ['function cmdReady() {}', 'function other() {}'].join('\n');
  assert.deepEqual(partsChanged(one, `${one}\nfunction cmdReady() { again }`, 'x.mjs', named('+cmdReady')), ['d:cmdReady#2']);
  // a function added inside a named region is the region's
  assert.deepEqual(partsChanged(js, js.replace('function a() {}', 'function a() {}\nfunction c() {}'), 'x.mjs', named('r')), []);
});

test('the gate: lines inserted inside another part are that part\'s, however the head labels them', () => {
  const { partsChanged: inVm } = partsFns();
  const partsChanged = (...args) => [...inVm(...args)];
  const named = (...n) => n.map((x) => ({ name: x.replace(/^\+/, ''), added: x.startsWith('+') }));
  const py = ['import os', '# fetch start', 'def fetch():', '    return 1', '# fetch end', '# store start', 'def store(x):', '    db.write(x)', '    return 2', '# store end', ''].join('\n');
  const into = (lines) => py.replace('    db.write(x)\n', `    db.write(x)\n${lines.join('\n')}\n`);
  // a new region inside store's body (review: a +name inside another ticket's region)
  assert.deepEqual(partsChanged(py, into(['    # audit start', '    os.remove(x)', '    # audit end']), 'tool.py', named('+audit')), ['r:store', 'p:store']);
  // a second fetch pair inside store's body
  assert.deepEqual(partsChanged(py, into(['    # fetch start', '    os.remove(x)', '    # fetch end']), 'tool.py', named('fetch')), ['r:store', 'p:store']);
  // the same insertion is fine for the ticket that names store
  assert.deepEqual(partsChanged(py, into(['    # audit start', '    os.remove(x)', '    # audit end']), 'tool.py', named('store', '+audit')), []);
  // a new region at the end of the file, or between two regions, is the ticket's
  assert.deepEqual(partsChanged(py, `${py}# audit start\ndef audit():\n    pass\n# audit end\n`, 'tool.py', named('+audit')), []);
  assert.deepEqual(partsChanged(py, py.replace('# fetch end\n', '# fetch end\n# audit start\npass\n# audit end\n'), 'tool.py', named('+audit')), []);
  // JS: a new function inside another function's body, or inside a region another ticket names
  const js = ['function a() {', '  x();', '}', '', '/* r start */', 'function b() {}', 'function c() {}', '/* r end */', ''].join('\n');
  assert.ok(partsChanged(js, js.replace('  x();\n', '  x();\n/* n start */\nfunction n() {}\n/* n end */\n'), 'x.mjs', named('+n')).includes('d:a#1'), 'inside a: a\'s');
  assert.deepEqual(partsChanged(js, js.replace('  x();\n', '  x();\n  /* n start */\n  y();\n  /* n end */\n'), 'x.mjs', named('+n')), ['d:a#1'], 'an indented region inside a: a\'s');
  assert.deepEqual(partsChanged(js, js.replace('function c() {}\n', 'function n() {}\nfunction c() {}\n'), 'x.mjs', named('+n')).sort(), ['p:r'], 'inside region r: r\'s');
  assert.deepEqual(partsChanged(js, js.replace('function c() {}\n', 'function n() {}\nfunction c() {}\n'), 'x.mjs', named('r')), []);
  // after a's closing brace and blank line: diff may place it either side of the blank; either is fine
  assert.deepEqual(partsChanged(js, js.replace('}\n\n', '}\n\nfunction n() {}\n\n'), 'x.mjs', named('+n')), []);
  assert.deepEqual(partsChanged(js, js.replace('}\n\n', '}\n\n\nfunction n() {}\n'), 'x.mjs', named('+n')), []);
  assert.deepEqual(partsChanged(py, py.split('\n').reverse().join('\n'), 'tool.py', named('fetch')).includes('r:store'), true, 'a reordered file');
  // review round 2: an inserted block whose edge equals a neighbouring marker; a blank line replaced
  // by a new region or function; a sub-heading added under a heading the ticket doesn't name
  const nest = ['# store start', 'def store():', '    a()', '    # fetch start', '    f()', '    # fetch end', '    b()', '# store end', ''].join('\n');
  const evil = ['    # fetch start', '    evil()', '    # fetch end'];
  assert.deepEqual(partsChanged(nest, nest.replace('    # fetch end\n', `    # fetch end\n${evil.join('\n')}\n`), 'tool.py', named('fetch')), [], 'after the region, its markers repeated: inside fetch too');
  assert.deepEqual(partsChanged(nest, nest.replace('    # fetch end\n', '    # fetch end\n    evil()\n    # fetch end\n'), 'tool.py', named('fetch')), ['r:store'], 'a line the head puts outside fetch is store\'s');
  assert.deepEqual(partsChanged(nest, nest.replace('    # fetch end\n', '    # fetch end\n    evil()\n'), 'tool.py', named('fetch')), ['r:store'], 'store holds the whole file (whole-like), so its rest says it');
  // a block wrapped in fetch's own markers at fetch's edge lines up, in the diff, with those markers: it reads as
  // lines inside fetch, and in the head they are in a fetch region still; no line of store's changes or moves
  assert.deepEqual(partsChanged(nest, nest.replace('    # fetch start\n', `${evil.join('\n')}\n    # fetch start\n`), 'tool.py', named('fetch')), [], 'before it: inside fetch');
  assert.deepEqual(partsChanged(nest, nest.replace('    f()\n', '    g()\n'), 'tool.py', named('fetch')), [], 'inside it');
  const blank = ['/* store start */', 'function s1() {', '  return 1;', '}', '', 'function s2() {', '  return 2;', '}', '/* store end */', ''].join('\n');
  // a part's trailing blank lines are no part's text: a new region or function in s1's blank line is
  // a new part between s1 and s2, inside store; store holds the whole file here, so that is free, and
  // where it doesn't, store's parts changed
  assert.deepEqual(partsChanged(blank, blank.replace('}\n\n', '}\n/* audit start */\nglobalThis.evil = 1;\n/* audit end */\n'), 'x.mjs', named('+audit')), []);
  assert.deepEqual(partsChanged(blank, blank.replace('}\n\n', '}\nfunction evil() {}\n'), 'x.mjs', named('+evil')), []);
  const blank2 = `${blank}/* other start */\nconst o = 1;\n/* other end */\n`;
  assert.deepEqual(partsChanged(blank2, blank2.replace('}\n\n', '}\n/* audit start */\nglobalThis.evil = 1;\n/* audit end */\n'), 'x.mjs', named('+audit')), ['p:store']);
  assert.deepEqual(partsChanged(blank2, blank2.replace('}\n\n', '}\nfunction evil() {}\n'), 'x.mjs', named('+evil')), ['p:store']);
  assert.deepEqual(partsChanged(blank, blank.replace('  return 1;\n}\n\n', '  return 3;\n}\n'), 'x.mjs', named('s1')), [], 'its own blank line is the ticket\'s');
  // review round 3: a region round the whole file exempts nothing inside a part it holds
  const all = ['# all start', 'import os', '# fetch start', 'def fetch():', '    return 1', '# fetch end', '# store start', 'def store(x):', '    db.write(x)', '    return 2', '# store end', '# all end', ''].join('\n');
  assert.deepEqual(partsChanged(all, all.replace('    db.write(x)\n', '    db.write(x)\n    # audit start\n    evil()\n    # audit end\n'), 't.py', named('+audit')), ['r:all/store', 'p:store']);
  assert.deepEqual(partsChanged(all, all.replace('# fetch end\n', '# fetch end\n# audit start\nx = 1\n# audit end\n'), 't.py', named('+audit')), [], 'between two regions inside it: the ticket\'s');
  const doc = ['# Doc', '## A', 'a text', '### A1', 't', '## B', 'b', ''].join('\n');
  assert.deepEqual(partsChanged(doc, doc.replace('### A1\n', '### X\nx\n### A1\n'), 'x.md', named('+x')), ['p:a'], 'before A1');
  assert.deepEqual(partsChanged(doc, doc.replace('## B\n', '### X\nx\n## B\n'), 'x.md', named('+x')), ['p:a'], 'after A1: still under A');
  assert.deepEqual(partsChanged(doc, doc.replace('## B\n', '## X\nx\n## B\n'), 'x.md', named('+x')), [], 'a new section beside A: the title holds the whole file');
  // final review F1: an insertion whose edge lines equal its neighbour's (a closing brace, a blank
  // line) may sit either side of them; the diff's pick is arbitrary, so it is a held place's only when
  // every placement is, and it never slides over a marker, a heading or a declaration line
  const fns = ['function loadA() {', '  return a;', '}', '', 'function parseB() {', '  return b;', '}', '', 'function saveC() {', '  return c;', '}', ''].join('\n');
  const newN = 'function newN() {\n  return n;\n}\n\n';
  assert.deepEqual(partsChanged(fns, fns.replace('function saveC', `${newN}function saveC`), 'x.mjs', named('+newN')), [], 'a new function alone');
  assert.deepEqual(partsChanged(fns, fns.replace('  return a;', '  return a2;').replace('function saveC', `${newN}function saveC`), 'x.mjs', named('loadA', '+newN')), [], '(a) its own function edited and a new one added');
  const moved = ['function parseB() {', '  return b;', '}', '', 'function loadA() {', '  return a;', '}', '', 'function saveC() {', '  return c;', '}', ''].join('\n');
  assert.deepEqual(partsChanged(fns, moved, 'x.mjs', named('loadA')), [], '(b) its own function moved below another');
  const sec = ['# Doc', '', '## Alpha', '', 'a', '', '## Beta', '', 'b', '', '## Gamma', '', 'g', ''].join('\n');
  assert.deepEqual(partsChanged(sec, sec.replace('\na\n', '\na2\n').replace('## Gamma', '## New\n\nn\n\n## Gamma'), 'x.md', named('alpha', '+new')), [], '(c) its own section edited and a new one added');
  // still refused: a new function inside parseB's body, with no placement outside it
  assert.deepEqual(partsChanged(fns, fns.replace('  return b;\n', '  return b;\nfunction n() {}\n'), 'x.mjs', named('+n')), ['d:parseB#1']);
  // review 2 F5: a new part directly under another's last line, no blank line between (#338, #270)
  assert.deepEqual(partsChanged(fns, fns.replace('}\n\nfunction saveC', '}\n// n\nfunction newN() {\n  return n;\n}\n\nfunction saveC'), 'x.mjs', named('+newN')), []);
  assert.deepEqual(partsChanged('const k1 = 1;\n\nconst k3 = 3;\n', 'const k1 = 1;\nconst k2 = 2;\n\nconst k3 = 3;\n', 'x.mjs', named('+k2')), []);
  // review 2 F6: moving one's own function past a shorter one, and deleting one's own whose tail
  // equals the one above's, are free; moving another's, or reordering inside another's region, is not
  const fs3 = ['function x() {', '  a();', '  b();', '  c();', '}', '', 'function y() {', '  return v;', '}', '', 'function z() {', '  return v;', '}', ''].join('\n');
  const yxz = ['function y() {', '  return v;', '}', '', 'function x() {', '  a();', '  b();', '  c();', '}', '', 'function z() {', '  return v;', '}', ''].join('\n');
  assert.deepEqual(partsChanged(fs3, yxz, 'x.mjs', named('x')), [], 'x moved below the shorter y');
  assert.deepEqual(partsChanged(fs3, fs3.replace('function z() {\n  return v;\n}\n\n', ''), 'x.mjs', named('z')), [], 'its own z deleted');
  assert.deepEqual(partsChanged(fs3, yxz, 'x.mjs', named('z')), ['m:d:x#1'], 'another\'s x moved');
  const inR = `/* r start */\n${fs3}/* r end */\nconst tail = 1;\n`;
  assert.deepEqual(partsChanged(inR, `/* r start */\n${yxz}/* r end */\nconst tail = 1;\n`, 'x.mjs', named('x')), ['p:r'], 'reordered inside region r');
  assert.deepEqual(partsChanged(inR, `/* r start */\n${yxz}/* r end */\nconst tail = 1;\n`, 'x.mjs', named('x', 'r')), []);
  // review 2 rerun (fresh reviewer): a region with no declarations moved into a named one, or
  // wrapped in a new one, is a different leaf (its key holds the regions round it); a part put in the
  // middle of the rest, or of a region's body, splits that rest; a second same-named part under
  // another's heading is a change to that heading
  const py2 = ['import os', '# R start', 'x = 1', '# R end', '# G start', 'y = 2', '# G end', 'main()', ''].join('\n');
  assert.deepEqual(partsChanged(py2, py2.replace('# R end\n# G start\ny = 2\n# G end\n', '# G start\ny = 2\n# G end\n# R end\n'), 'a.py', named('R')), ['r:G'], 'G moved into R');
  assert.deepEqual(partsChanged(py2, py2.replace('# G start\ny = 2\n# G end\n', '# W start\n# G start\ny = 2\n# G end\n# W end\n'), 'a.py', named('+W')), ['r:G'], 'W wrapped round G');
  const py3 = ['def main():', '    setup()', '    run()', '# H start', 'z = 3', '# H end', ''].join('\n');
  assert.deepEqual(partsChanged(py3, py3.replace('    setup()\n', '    setup()\n    # X start\n    return\n    # X end\n'), 'a.py', named('+X')), ['r:'], 'X in the middle of the file\'s rest');
  const py4 = ['import os', '# G start', 'def h():', '    a()', '    b()', '# G end', ''].join('\n');
  assert.deepEqual(partsChanged(py4, py4.replace('    a()\n', '    a()\n    # X start\n    return\n    # X end\n'), 'a.py', named('+X')), ['r:G'], 'X in the body of G, though G holds the whole file');
  const md2 = ['# T', '## a', 'text a', '### notes', 'mine', '## b', ''].join('\n');
  assert.deepEqual(partsChanged(md2, md2.replace('mine\n', 'mine\n### notes\ninjected\n'), 'd.md', named('notes')), ['p:a'], 'a second notes under a');
  // review 3 F8: a blank line inside a rest's run is content (a YAML block scalar, a heredoc, a table)
  const yml = (body) => `top: 1\n# mine start\nm: 1\n# mine end\n# other start\nscript: |\n  line one\n${body}  line two\n# other end\n`;
  assert.deepEqual(partsChanged(yml(''), yml('\n'), 'c.yml', named('mine')), ['r:other'], 'Y1 a blank line added in a block scalar');
  assert.deepEqual(partsChanged(yml('\n'), yml(''), 'c.yml', named('mine')), ['r:other'], 'Y2 one removed');
  const sh = (body) => `#!/bin/sh\n# mine start\necho hi\n# mine end\n# other start\ncat <<EOT\nalpha\n${body}beta\nEOT\n# other end\n`;
  assert.deepEqual(partsChanged(sh(''), sh('\n'), 'x.sh', named('mine')), ['r:other'], 'S1 a blank line in a heredoc');
  const tbl = (body) => `<!-- other start -->\n| a | b |\n|---|---|\n| 1 | 2 |\n${body}| 3 | 4 |\n<!-- other end -->\n\n# T\n\n## mine\n\ntext\n`;
  assert.deepEqual(partsChanged(tbl(''), tbl('\n'), 'd.md', named('mine')), ['r:other'], 'M1 a blank line splitting a table');
  // review 4 F13: a long run of blank lines inside a leaf is trimmed in linear time (a regex for it
  // backtracked exponentially), in a region's rest, a function and a section; a long heading too
  const k = 5000, t0 = Date.now();
  const yk = `# other start\na\n${'\n'.repeat(k)}b\n# other end\n# mine start\nm\n# mine end\n`;
  assert.deepEqual(partsChanged(yk, yk.replace('m\n', 'm2\n'), 'c.yml', named('mine')), []);
  assert.deepEqual(partsChanged(yk, yk.replace('b\n', '\r\nb\n'), 'c.yml', named('mine')), ['r:other'], 'a CRLF blank line in the run is still content');
  const jk = `function other() {\n  a();\n${'  \n'.repeat(k)}  b();\n}\nfunction mine() {}\n`;
  assert.deepEqual(partsChanged(jk, jk.replace('mine() {}', 'mine() { x(); }'), 'a.js', named('mine')), []);
  assert.deepEqual(partsChanged(jk, jk.replace('  b();', '\n  b();'), 'a.js', named('mine')), ['d:other#1']);
  const mk = `# T\n\n## other\n\na\n${'\t\n'.repeat(k)}b\n\n## mine\n\nm\n## ${'x '.repeat(k)}#${' '.repeat(k)}y\n`;
  assert.deepEqual(partsChanged(mk, mk.replace('\nm\n', '\nm2\n'), 'd.md', named('mine')), []);
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms for runs of ${k} blank lines`);
  // a run's edges still aren't: blank lines added round your own part between two others
  assert.deepEqual(partsChanged(yml(''), yml('').replace('# mine end\n', '# mine end\n\n\n'), 'c.yml', named('mine')), [], 'blank lines at a run\'s edge');

  assert.deepEqual(partsChanged(doc, doc.replace('### A1\n', '### X\nx\n### A1\n'), 'x.md', named('a', '+x')), [], 'naming A');
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
    // split_files listing nothing changes nothing: any file splits by part
    F.split([]);
    assert.deepEqual(F.d4('app-01-ready', 'app-02-other'), [], 'an unlisted file splits too');
    assert.doesNotMatch(F.validate(), /error: app-0[12]-\S+: touches/, 'and its part entries are accepted');
  } finally { F.done(); }
});

test('validate: each named part exists at main, in any file; another ticket\'s part errors only warn under a gate', () => {
  const KIT4 = [DT, 'docs/devteam/dashboard/index.html', 'docs/devteam/dashboard/hub.html', 'docs/devteam/process/supervisor.md'];
  const F = partsProject('parts-validate', [...KIT4, 'docs/devteam/scripts/nope.mjs']);
  try {
    const errs = (id) => F.validate().split('\n').filter((l) => l.startsWith(`error: ${id}: touches`));
    const bad = {
      'app-11-missing': [`${DT}#noSuchPart`, /has no part noSuchPart at main/],
      'app-12-plus': [`${DT}#+cmdReady`, /already has a part cmdReady at main; name it without \+/],
      'app-13-unlisted': ['docs/devteam/process/worker.md#no-such-heading', /worker\.md has no part no-such-heading at main/],
      'app-18-folder': ['docs/devteam/scripts#cmdReady', /is not a file on main; a ticket that creates a file names it whole/],
      'app-14-glob': ['docs/devteam/scripts/*.mjs#x', /a part names one file, not a glob/],
      'app-15-nofile': ['docs/devteam/scripts/nope.mjs#x', /is not a file on main; a ticket that creates a file names it whole/],
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

test('any file splits: functions of an unlisted .mjs, Markdown headings, a Python region; a whole claim on a big file that orders two tickets warns', () => {
  const F = partsProject('parts-any', []);
  try {
    // a Python file with # regions, and a small .mjs, on main
    const PY = 'app/tool.py', SMALL = 'app/small.mjs';
    write(path.join(F.old, PY), ['import os', '', '# fetch start', 'def fetch():', '    return 1', '# fetch end', '', '# store start', 'def store():', '    return 2', '# store end', ''].join('\n'));
    write(path.join(F.old, SMALL), ['export function a() {}', 'export function b() {}', ''].join('\n'));
    F.g(['add', '-A'], F.old);
    F.g(['commit', '-qm', 'files with parts'], F.old);
    F.g(['push', '-q', 'origin', 'main'], F.old);
    const WMD = 'docs/devteam/process/worker.md';
    F.ticket('app-01-a', [`${DT}#cmdReady`, `${WMD}#3-the-rules`, `${PY}#fetch`]);
    F.ticket('app-02-b', [`${DT}#cmdValidate`, `${WMD}#4-the-loop-with-superpowers`, `${PY}#store`]);
    assert.deepEqual(F.d4('app-01-a', 'app-02-b'), [], 'different functions, headings and regions of unlisted files: no D4');
    assert.doesNotMatch(F.validate(), /error: app-0[12]-\S+: touches/, 'every part exists at main');
    const one = (a, b) => { F.touches('app-01-a', a); F.touches('app-02-b', b); return F.d4('app-01-a', 'app-02-b').length; };
    assert.equal(one([`${DT}#cmdReady`], [`${DT}#cmdReady`]), 1, 'the same function: D4');
    assert.equal(one([`${DT}#cmdReady`], [DT]), 1, 'a function and the whole file: D4');
    assert.equal(one([`${WMD}#3-the-rules`], [`${WMD}#3-the-rules`]), 1, 'the same heading: D4');
    assert.equal(one([`${WMD}#3-the-rules`], [WMD]), 1, 'a heading and the whole file: D4');
    assert.equal(one([`${PY}#fetch`], [`${PY}#fetch`]), 1, 'the same region: D4');
    assert.equal(one([`${PY}#fetch`], [PY]), 1, 'a region and the whole file: D4');
    assert.equal(one([`${PY}#fetch`], ['app/*.py']), 1, 'a region and a glob over the file: D4');
    assert.equal(one([`${PY}#fetch`], [`${PY}#store`]), 0, 'two regions: no D4');
    assert.equal(one([`${WMD}#worker`], [`${WMD}#+new-section`]), 1, 'a title heading holds the whole file: a new part overlaps it');
    assert.equal(one([`${WMD}#3-the-rules`], [`${WMD}#+new-section`]), 0, 'a new part and a section: no D4');
    // a missing part is refused, in an unlisted file too
    F.touches('app-01-a', [`${PY}#nope`]);
    assert.match(F.validate(), /error: app-01-a: touches "app\/tool\.py#nope": app\/tool\.py has no part nope at main/);
    // ordered: app-02 depends on app-01, and app-01 claims the big kit script whole
    F.touches('app-01-a', [DT]);
    F.ok(F.old, ['ticket', 'set', 'app-02-b', '--json', JSON.stringify({ touches: [`${DT}#cmdValidate`], depends_on: ['app-01-a'] })], SUP);
    const warn = () => F.validate().split('\n').filter((l) => /whole-file claim on a big file orders/.test(l));
    assert.equal(warn().length, 1, 'a big file claimed whole orders them: a warning');
    assert.match(warn()[0], /^warning: .*app-02-b depends on app-01-a, and they share only docs\/devteam\/scripts\/devteam\.mjs \(\d+ lines\), claimed whole/);
    assert.doesNotMatch(F.validate(), /^error: .*whole-file claim/m, 'never an error');
    F.touches('app-01-a', [`${DT}#cmdReady`]);
    F.touches('app-02-b', [`${DT}#cmdReady`]);
    assert.deepEqual(warn(), [], 'both name the same part: a real overlap, no warning');
    F.touches('app-01-a', [DT, 'app/other.txt']);
    F.touches('app-02-b', [`${DT}#cmdValidate`, 'app/other.txt']);
    assert.deepEqual(warn(), [], 'they share another file too: no warning');
    F.touches('app-01-a', [SMALL]);
    F.touches('app-02-b', [`${SMALL}#b`]);
    assert.deepEqual(warn(), [], 'a small file claimed whole: no warning');
    F.split([SMALL]);
    assert.equal(warn().length, 1, 'a small file split_files lists: a warning');
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
    // a file split_files doesn't list is judged by its parts just the same
    const WMD = 'docs/devteam/process/worker.md';
    const inRules = swap('## 3. The rules\n', '## 3. The rules\n\nEdited.\n');
    assert.equal(run('app-53-unlisted', [`${WMD}#3-the-rules`], [[WMD, inRules]]), '', 'an unlisted file: the named heading may change');
    assert.match(run('app-54-unlisted-other', [`${WMD}#3-the-rules`], [[WMD, swap('## 2. Catch up before you act\n', '## 2. Catch up before you act\n\nEdited.\n')]]), /changes parts of docs\/devteam\/process\/worker\.md the ticket doesn't name: worker\/2-catch-up-before-you-act/, 'and another heading is refused');
  } finally { F.done(); }
});

test('planning.md, worker.md, supervisor.md and the schema say the same about parts', () => {
  const doc = (f) => fs.readFileSync(path.join(kit, f), 'utf8').replace(/\s+/g, ' ');
  const planning = doc('process/planning.md'), worker = doc('process/worker.md'), supervisor = doc('process/supervisor.md');
  for (const [name, d] of [['planning.md', planning], ['worker.md', worker], ['supervisor.md', supervisor]]) assert.match(d, /`path#name`/, `${name} names the path#name syntax`);
  for (const [name, d] of [['planning.md', planning], ['supervisor.md', supervisor]]) {
    assert.match(d, /`split_files`/, `${name} names split_files`);
    assert.match(d, /1,500 lines/, `${name} names the big-file threshold`);
  }
  assert.match(planning, /Any file may be named by part/);
  assert.match(planning, /`# name start` … `# name end`/);
  assert.doesNotMatch(worker, /split_files/, 'a worker has no setting to read');
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
