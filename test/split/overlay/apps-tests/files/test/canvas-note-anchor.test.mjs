// An artifact note anchored to a canvas layer (kit-667): artifact-notes@1's anchor gains node, a
// layer's id, by a rule of anchorProblem's own (test/contracts/canvas.md §10). The page-element caps
// (ANCHOR_CAPS, the artifact lens's CAPS, the dashboard page's T_ANCHOR_CAPS) stay as they are, and
// every artifact-notes@1 fixture still passes log-check.
// Run: node --test test/canvas-note-anchor.test.mjs
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { testDir, threadsFixture } from './lib/kit.mjs';
import { cliSource } from './lib/cli-source.mjs';

// kit-1003: threads-core runs as apps/dashboard/lib-dist/ modules, the port of the dashboard page's threads-core block;
// with no lib-dist/, every test skips locally; under CI the file fails
const LIB = new URL('../apps/dashboard/lib-dist/', import.meta.url);
const UNBUILT = fs.existsSync(LIB) ? false : 'build apps/dashboard first (npm run build)';
if (UNBUILT && process.env.CI) throw new Error(UNBUILT);
const test = (name, o, fn) => { if (typeof o === 'function') { fn = o; o = {}; } return nodeTest(name, UNBUILT ? { ...o, skip: UNBUILT } : o, fn); };
// the lib wired with threadsCoreState alone, as the block loaded by itself in vm: the names the vm context held
const threadsCore = async () => {
  const lib = await import(new URL('lib/threads-core-rules.js', LIB).href);
  const { threadsCoreState } = await import(new URL('views/threads-core/state.js', LIB).href);
  lib.wireThreadsCore({ threadsCoreState });
  return { ...threadsCoreState, ...lib, threadsCoreState };
};

const KIT = path.join(testDir, '..', 'docs', 'devteam');
const SRC = cliSource();
const NOTES = path.join(testDir, 'fixtures', 'artifact-notes');
// canvas-doc@1's own example of a pin's anchor (kit-651)
const NOTE_ANCHOR = JSON.parse(fs.readFileSync(path.join(testDir, 'fixtures', 'canvas', 'note-anchor.json'), 'utf8'));

// The kit's subject rules, taken from its source as artifact-pages.test.mjs takes them: subjectProblem
// and anchorProblem as the kit runs them, with nothing but the constants they read.
const subjectProblem = (() => {
  const from = SRC.indexOf('\nconst SUBJECT_TYPES = '), to = SRC.indexOf('\nfunction threadLineProblems(');
  assert.ok(from > 0 && to > from, 'the subject rules found in the source');
  const one = (name) => { const m = new RegExp(`^const ${name} = .*$`, 'm').exec(SRC); assert.ok(m, `${name} found`); return m[0]; };
  const head = ['isObj', 'SUBJECT_MAX', 'ARTIFACT_AT', 'UNSAFE_TEXT', 'LINK_ID', 'PREVIEW_NAME'].map(one).join('\n');
  const ctx = { Buffer };
  vm.runInNewContext(`${head}\n${SRC.slice(from, to)}\n;globalThis.subjectProblem = subjectProblem;`, ctx);
  return ctx.subjectProblem;
})();
const pin = (anchor) => ({ kind: 'artifact', slug: 'checkout-canvas', at: 'main', anchor });
const refuses = (anchor, re, why) => { const p = subjectProblem(pin(anchor)); assert.match(p ?? 'accepted', re, why); };

test('canvas-note-anchor A1: an anchor { node } of one line of plain text, 1 to 64 characters, is accepted', () => {
  assert.deepEqual(Object.keys(NOTE_ANCHOR), ['node'], "the canvas contract's fixture is a node anchor");
  for (const node of [NOTE_ANCHOR.node, 'a', 'k3f9a2-1'.padEnd(64, 'x'), 'é'.repeat(64), '\u{1F600}'.repeat(64), 'Layer 7 (hero) / title']) {
    assert.equal(subjectProblem(pin({ node })), null, `node ${JSON.stringify(node)} (${[...node].length} characters)`);
  }
});

test('canvas-note-anchor A2: a node with a control character or a line break is refused', () => {
  for (const c of ['\u0000', '\u0001', '\t', '\n', '\r', '\u007f', '\u0085', ' ', ' ']) {
    refuses({ node: `k3f9a2${c}1` }, /^anchor\.node is one line of plain text \(no control or bidi characters\)$/, `U+${c.codePointAt(0).toString(16)}`);
  }
});

test('canvas-note-anchor A3: a node with a bidi character is refused', () => {
  for (const c of ['؜', '‎', '‏', '‪', '‮', '⁦', '⁩']) {
    refuses({ node: `k3f9a2${c}1` }, /^anchor\.node is one line of plain text \(no control or bidi characters\)$/, `U+${c.codePointAt(0).toString(16)}`);
  }
});

test('canvas-note-anchor A4: a node over 64 characters is refused, counted in characters', () => {
  refuses({ node: 'x'.repeat(65) }, /^anchor\.node is 65 characters; at most 64$/, '65 ASCII characters');
  refuses({ node: '\u{1F600}'.repeat(65) }, /^anchor\.node is 65 characters; at most 64$/, '65 astral characters, 130 UTF-16 units');
});

test('canvas-note-anchor A5: a node mixed with page-element keys is refused', () => {
  for (const [k, v] of [['selector', '#hero'], ['tag', 'div'], ['role', 'img'], ['text', 'Hero'], ['name', 'Hero'], ['html', '<div>'], ['rect', { x: 0, y: 0, w: 1, h: 1 }], ['point', { x: 1, y: 1 }]]) {
    refuses({ node: 'k3f9a2-1', [k]: v }, new RegExp(`^an anchor with a node has no ${k}$`), `node with ${k}`);
    refuses({ [k]: v, node: 'k3f9a2-1' }, new RegExp(`^an anchor with a node has no ${k}$`), `${k} before node`);
  }
  refuses({ node: 'k3f9a2-1', selector: '#hero', text: 'Hero' }, /^an anchor with a node has no selector, text$/, 'every extra key named');
});

test('canvas-note-anchor A6: an empty node, a node that is not text, and a node of broken text are refused', () => {
  refuses({ node: '' }, /^anchor\.node is at least 1 character$/, 'empty');
  for (const v of [null, 5, ['k3f9a2-1'], { id: 'k3f9a2-1' }, true]) refuses({ node: v }, /^anchor\.node is text$/, JSON.stringify(v));
  for (const v of ['k3f9a2\ud800', '\udc00k3f9a2', 'a\ud83d']) refuses({ node: v }, /^anchor\.node is one line of plain text \(no control or bidi characters\)$/, 'a lone surrogate');
});

test('canvas-note-anchor A7: thread new records a node-anchored note as written, log-check passes it, and thread new refuses a mixed one', (t) => {
  const F = threadsFixture('canvas-note-anchor');
  t.after(() => F.done());
  const subject = pin({ node: NOTE_ANCHOR.node });
  const id = F.owner(['thread', 'new', 'Make this layer bolder', '--subject', JSON.stringify(subject)]).split('\n')[0].trim();
  assert.deepEqual(JSON.parse(F.owner(['thread', 'show', id, '--json'])).subject, subject, 'the subject as written');
  const r = F.run(F.old, ['log-check']);
  assert.equal(r.status, 0, `log-check: ${r.out}\n${r.err}`);
  const said = F.fails(['thread', 'new', 'Mixed', '--subject', JSON.stringify(pin({ node: NOTE_ANCHOR.node, selector: '#hero' }))]);
  assert.match(said, /an anchor with a node has no selector/);
});

test('canvas-note-anchor A8: the page-element caps and their copies are unchanged, and none has a node', async () => {
  const { T_ANCHOR_CAPS } = await threadsCore();
  const PAGE_CAPS = { selector: 200, tag: 40, role: 40, text: 80, name: 80, html: 1024 };
  const literal = (src, re, what) => { const m = re.exec(src); assert.ok(m, `${what} found`); return JSON.parse(JSON.stringify(vm.runInNewContext(`(${m[1]})`))); };
  assert.deepEqual(literal(SRC, /^const ANCHOR_CAPS = (\{.*\});$/m, 'ANCHOR_CAPS'), PAGE_CAPS, 'ANCHOR_CAPS');
  const lens = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(SRC);
  assert.ok(lens, 'ARTIFACT_LENS found');
  const lensCaps = literal(lens[1], /const CAPS = (\{[^}]*\});/, "the artifact lens's CAPS");
  assert.deepEqual(Object.fromEntries(Object.keys(PAGE_CAPS).map((k) => [k, lensCaps[k]])), PAGE_CAPS, "the artifact lens's anchor caps");
  assert.deepEqual(Object.keys(lensCaps), [...Object.keys(PAGE_CAPS), 'path', 'hash'], "the artifact lens's CAPS has only its own keys besides");
  assert.deepEqual(JSON.parse(JSON.stringify(T_ANCHOR_CAPS)), PAGE_CAPS, "index.html's T_ANCHOR_CAPS");
});

test('canvas-note-anchor A9: every artifact-notes@1 fixture still passes log-check', (t) => {
  const F = threadsFixture('canvas-note-anchor-fixtures');
  t.after(() => F.done());
  const { readOnly } = JSON.parse(fs.readFileSync(path.join(NOTES, 'refused.json'), 'utf8'));
  const folders = fs.readdirSync(NOTES, { withFileTypes: true }).filter((e) => e.isDirectory() && !readOnly.includes(e.name)).map((e) => e.name).sort();
  assert.ok(folders.length >= 30, `the fake's folders: ${folders.length}`);
  for (const f of folders) {
    const snap = F.snapLog();
    try {
      for (const n of fs.readdirSync(path.join(NOTES, f, 'log'))) fs.appendFileSync(path.join(F.logDir, n), fs.readFileSync(path.join(NOTES, f, 'log', n)));
      const r = F.run(F.old, ['log-check']);
      assert.equal(r.status, 0, `${f}: ${r.out}\n${r.err}`);
    } finally { F.restoreLog(snap); }
  }
});

test('canvas-note-anchor A11: pins on two layers of one canvas are two threads, and a second pin on one layer is refused, naming the open one', (t) => {
  const F = threadsFixture('canvas-note-anchor-layers');
  t.after(() => F.done());
  const on = (node) => JSON.stringify(pin({ node }));
  const first = F.owner(['thread', 'new', 'On layer one', '--subject', on('k3f9a2-1')]).split('\n')[0].trim();
  const second = F.owner(['thread', 'new', 'On layer two', '--subject', on('k3f9a2-2')]).split('\n')[0].trim();
  assert.notEqual(first, second, 'two threads');
  const said = F.fails(['thread', 'new', 'Again on layer one', '--subject', on('k3f9a2-1')]);
  assert.match(said, new RegExp(`${first} is already open on this subject`), 'the second pin on layer one');
});

// The two keys, each loaded by itself in vm, as test/thread-per-subject.test.mjs loads them
test("canvas-note-anchor A12: subjectKey and the page's tKey (with tFrameSpot) key a node anchor as node:<id>, alike", async () => {
  const line = (src, name) => { const m = src.match(new RegExp(`^const ${name} = .*;$`, 'm')); assert.ok(m, `${name} on one line`); return m[0]; };
  const subjectKey = vm.runInNewContext(`${line(SRC, 'subjectKey')}\nsubjectKey`, {});
  const { tKey } = await threadsCore();
  for (const node of ['k3f9a2-1', 'k3f9a2-2', 'Layer 7 (hero) / title']) {
    const s = pin({ node });
    assert.equal(subjectKey(s), `artifact:checkout-canvas:index.html:node:${node}`, `subjectKey of ${node}`);
    assert.equal(tKey(s), subjectKey(s), `tKey of ${node}`);
  }
  // a page element's key is as it was
  const el = { kind: 'artifact', slug: 'checkout-canvas', at: 'main', anchor: { selector: '#buy', text: 'Buy' } };
  assert.deepEqual([subjectKey(el), tKey(el)], ['artifact:checkout-canvas:index.html:#buy|Buy', 'artifact:checkout-canvas:index.html:#buy|Buy']);
});
