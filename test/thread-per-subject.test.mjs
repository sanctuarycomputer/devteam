// One thread per subject (kit-97): a subject with an open thread has only that one. thread new on it
// is refused, naming the open thread, by subjectKey in devteam.mjs, which the page's tKey mirrors; and
// a Shift+click on it opens that thread instead of a new one. The CLI and the two keys need no browser;
// the Shift+clicks are headless Chrome against a real dashboard (threadsFixture), skipped where Chrome
// can't be driven, as the kit's other Chrome tests are.
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { kit, threadsFixture } from './lib/kit.mjs';

const idOf = (out) => out.split('\n')[0].trim();

// Each kind: a subject, another with the same key (only what the key leaves out differs), and one
// with another key (its spot, ref or route moved).
const KINDS = (goal) => ({
  item: [{ kind: 'item', ref: `goal:${goal}`, quote: 'Launch checkout' }, { kind: 'item', ref: `goal:${goal}`, quote: 'another quote' }, { kind: 'item', ref: 'ticket:checkout-04' }],
  page: [{ kind: 'page', view: '#goals', at: { x: 0.25, y: 0.5 }, quote: 'Goals' }, { kind: 'page', view: '#goals', at: { x: 0.25, y: 0.5 } }, { kind: 'page', view: '#goals', at: { x: 0.25, y: 0.75 } }],
  'artifact point': [{ kind: 'artifact', slug: 'viewer-mock', at: 'main', path: 'index.html', point: { x: 1, y: 2 } }, { kind: 'artifact', slug: 'viewer-mock', at: 'main', point: { x: 1, y: 2 }, fp: 'a'.repeat(12) }, { kind: 'artifact', slug: 'viewer-mock', at: 'main', path: 'index.html', point: { x: 1, y: 3 } }],
  'artifact anchor': [{ kind: 'artifact', slug: 'viewer-mock', at: 'main', path: 'cart.html', anchor: { selector: '#buy', text: 'Buy now' }, point: { x: 1, y: 2 } }, { kind: 'artifact', slug: 'viewer-mock', at: 'main', path: 'cart.html', anchor: { selector: '#buy', text: 'Buy now', tag: 'button' }, point: { x: 9, y: 9 } }, { kind: 'artifact', slug: 'viewer-mock', at: 'main', path: 'cart.html', anchor: { selector: '#buy', text: 'Buy later' } }],
  'preview point': [{ kind: 'preview', name: 'brisk-otter', route: '/cart', point: { x: 3, y: 4 } }, { kind: 'preview', name: 'brisk-otter', route: '/cart', point: { x: 3, y: 4 }, viewport: { w: 800, h: 600 } }, { kind: 'preview', name: 'brisk-otter', route: '/', point: { x: 3, y: 4 } }],
  'preview anchor': [{ kind: 'preview', name: 'brisk-otter', anchor: { selector: 'h1', text: 'Cart' } }, { kind: 'preview', name: 'brisk-otter', anchor: { selector: 'h1', text: 'Cart' }, errors: ['boom'] }, { kind: 'preview', name: 'brisk-otter', route: '/cart', anchor: { selector: 'h1', text: 'Cart' } }],
});

test('thread new on a subject with an open thread is refused, naming it, for every kind; resolved, a new one starts', () => {
  const F = threadsFixture('thread-per-subject');
  try {
    const args = (s, words) => ['thread', 'new', words, '--subject', JSON.stringify(s)];
    for (const [kind, [s, same, other]] of Object.entries(KINDS(F.goal))) {
      const A = idOf(F.owner(args(s, 'About it')));
      const threads = () => JSON.parse(F.owner(['thread', 'list', '--json'])).length;
      for (const dup of [s, same]) {
        const before = threads();
        const said = F.fails(args(dup, 'Again'));
        assert.match(said, new RegExp(`${A}.*thread say ${A}`), `${kind}: the refusal of ${JSON.stringify(dup)} names the open thread`);
        assert.equal(threads(), before, `${kind}: a refused thread leaves nothing written`);
      }
      // another spot, ref or route: its own thread
      F.owner(args(other, 'Elsewhere'));
      // resolved: the subject is free again
      F.owner(['thread', 'resolve', A, '--outcome', 'done']);
      assert.notEqual(idOf(F.owner(args(s, 'Again, later'))), A, `${kind}: after the first resolves, a new thread starts`);
    }
    // a thread about nothing is never refused
    F.owner(['thread', 'new', 'No subject']);
    F.owner(['thread', 'new', 'No subject']);
  } finally {
    F.done();
  }
});

// The two keys, each loaded by itself in vm: the page's tKey (with tFrameSpot, the one helper it calls)
// and devteam.mjs's subjectKey.
const declaration = (src, name, file) => {
  const m = src.match(new RegExp(`^const ${name} = .*;$`, 'm'));
  assert.ok(m, `${file} declares ${name} on one line`);
  return m[0];
};
function keys() {
  const page = fs.readFileSync(path.join(kit, 'dashboard', 'index.html'), 'utf8');
  const cli = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const tKey = vm.runInNewContext(`${declaration(page, 'tFrameSpot', 'index.html')}\n${declaration(page, 'tKey', 'index.html')}\ntKey`, {});
  const subjectKey = vm.runInNewContext(`${declaration(cli, 'subjectKey', 'devteam.mjs')}\nsubjectKey`, {});
  return { tKey, subjectKey };
}

test("the page's tKey and devteam.mjs's subjectKey give the same key for every subject", () => {
  const { tKey, subjectKey } = keys();
  const subjects = [
    ...Object.values(KINDS('g-20261120-000000000-supervisor')).flat(),
    // the edges each key spells out: a page spot with no at, an artifact with no path or spot, an
    // anchor with only one of its two words, a preview with no route
    { kind: 'page', view: '#settings' },
    { kind: 'artifact', slug: 'viewer-mock', at: 'main' },
    { kind: 'artifact', slug: 'viewer-mock', at: 'main', anchor: { text: 'Buy now' } },
    { kind: 'preview', name: 'brisk-otter', anchor: { selector: 'h1' } },
    { kind: 'preview', name: 'brisk-otter' },
  ];
  for (const s of subjects) assert.equal(subjectKey(s), tKey(s), JSON.stringify(s));
  // the keys as the design names them
  assert.equal(subjectKey({ kind: 'item', ref: 'goal:g-1' }), 'item:goal:g-1');
  assert.equal(subjectKey({ kind: 'page', view: '#goals', at: { x: 0.25, y: 0.5 } }), 'page:#goals:0.25:0.5');
  assert.equal(subjectKey({ kind: 'artifact', slug: 'viewer-mock', at: 'main', point: { x: 1, y: 2 } }), 'artifact:viewer-mock:index.html:1,2');
  assert.equal(subjectKey({ kind: 'preview', name: 'brisk-otter', route: '/cart', anchor: { selector: 'h1', text: 'Cart' } }), 'preview:brisk-otter:/cart:h1|Cart');
  assert.equal(subjectKey(null), null);
});
