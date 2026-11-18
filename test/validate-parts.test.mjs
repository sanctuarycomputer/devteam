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
  return vm.runInContext(`${SRC.slice(a, b)}\n;({ fileParts, partLeaves, leafTexts, touchPath, touchPart })`, ctx);
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
  assert.deepEqual([...partLeaves(P, 'r')].sort(), ['d:c#1', 'd:d#1', 'r:r'], 'a region covers what it holds and its own rest');
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
  assert.deepEqual([...partLeaves(P, '3-the-tick')].sort(), ['d:3-the-tick#1', 'd:monitoring#1']);
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
  assert.deepEqual([...partLeaves(M, 'r')], ['d:the-snake_case-rule#1'], "a region in a heading's section covers that heading's leaf");
});

test('touches entries: path and part', () => {
  const { touchPath, touchPart } = partsFns();
  assert.equal(touchPath('a/b.mjs#x'), 'a/b.mjs');
  assert.equal(touchPath('a/b/**'), 'a/b/**');
  assert.equal(touchPart('a/b.mjs'), null);
  assert.deepEqual({ ...touchPart('a/b.mjs#+x') }, { name: 'x', added: true });
  assert.deepEqual({ ...touchPart('a/b.mjs#x') }, { name: 'x', added: false });
});
