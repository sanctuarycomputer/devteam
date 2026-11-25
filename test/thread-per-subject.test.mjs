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
import { kit, threadsFixture, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const idOf = (out) => out.split('\n')[0].trim();
const goalArgs = (title, priority) => ['goal', 'add', '--title', title, '--outcome', 'admins pay alone', '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', String(priority)];

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
      // the subject's own checks run first: a malformed duplicate is told what is wrong with it
      assert.match(F.fails(args({ ...s, extra: 1 }, 'Again')), /subject has no extra/, `${kind}: the shape's refusal first`);
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
    // a canvas layer's pin (kit-667): keyed by its node on both
    { kind: 'artifact', slug: 'checkout-canvas', at: 'main', anchor: { node: 'k3f9a2-1' } },
  ];
  for (const s of subjects) assert.equal(subjectKey(s), tKey(s), JSON.stringify(s));
  // the keys as the design names them
  assert.equal(subjectKey({ kind: 'item', ref: 'goal:g-1' }), 'item:goal:g-1');
  assert.equal(subjectKey({ kind: 'page', view: '#goals', at: { x: 0.25, y: 0.5 } }), 'page:#goals:0.25:0.5');
  assert.equal(subjectKey({ kind: 'artifact', slug: 'viewer-mock', at: 'main', point: { x: 1, y: 2 } }), 'artifact:viewer-mock:index.html:1,2');
  assert.equal(subjectKey({ kind: 'preview', name: 'brisk-otter', route: '/cart', anchor: { selector: 'h1', text: 'Cart' } }), 'preview:brisk-otter:/cart:h1|Cart');
  assert.equal(subjectKey(null), null);
});

// A fixture's dashboard and a Chrome tab on it at 1440x900, the threads read every 300 ms and every
// POST kept in window.__posts.
const INIT = `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  window.__posts = [];
  const rf = window.fetch;
  window.fetch = (u, o) => { if (String(o?.method || 'GET').toUpperCase() === 'POST') window.__posts.push(String(u)); return rf(u, o); };
})()`;
const soonIn = (p, ms = 30000) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const FRAMES = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';

test('a Shift+click on a subject with an open thread opens that thread, not a new one', { skip: SKIP, timeout: 300000 }, async (t) => {
  const F = threadsFixture('thread-per-subject-page');
  const later = cleanup(t);
  later(() => F.done());
  F.sup(goalArgs('Self-serve billing', 2));
  const G = idOf(F.owner(['thread', 'new', 'About this goal', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]));
  F.sup(['thread', 'reply', G, 'On it.']);
  const D = idOf(F.sup(['decide', '--class', 'rename-column', '--', 'renamed a column']));
  const DT = idOf(F.owner(['thread', 'new', 'About this call', '--subject', JSON.stringify({ kind: 'item', ref: `decision:${D}` })]));
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT });
  const soon = soonIn(p);
  const shiftClick = async (sel) => {
    await soon(`!!document.querySelector(${JSON.stringify(sel)})?.getClientRects().length`, `${sel} drawn`);
    await p.ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' }); void 0`);
    await p.ev(FRAMES);
    const at = await p.at(sel);
    await p.hold('Shift', true);
    await p.move(at.x, at.y, 8);
    await soon(`!document.getElementById('tl-cursor').hidden`, 'the pin over it');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await p.ev(FRAMES);
  };
  const opened = (id) => `TL.open === ${JSON.stringify(id)} && !TL.draft && !document.getElementById('tl-card').hidden && document.getElementById('tl-card').dataset.key === ${JSON.stringify(id)}`;

  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#goals` });
  await soon('typeof DATA === "object" && DATA !== null && TL.have > 0', 'the page and its threads read');
  // the goal's card has a pin: a Shift+click on the card opens its thread's floating card
  const card = `#goals [data-subject="goal:${F.goal}"]`;
  await shiftClick(card);
  await soon(opened(G), 'the goal\'s open thread, in its card');
  assert.equal(await p.ev("document.getElementById('tl-card').parentElement.id"), 'tl', 'floating beside its pin, not in the panel');
  assert.deepEqual(await p.ev('window.__posts'), [], 'nothing posted');
  await p.ev('tlClose()');

  // a decision row on Self Improvement's Decide tab: its open thread opens
  await p.ev("location.hash = '#loop?lt=decide'");
  const row = `#decisions-feed [data-subject="decision:${D}"]`;
  await shiftClick(row);
  await soon(opened(DT), 'the decision\'s open thread');
  assert.deepEqual(await p.ev('window.__posts'), [], 'nothing posted');
  await p.ev('tlClose()');

  // resolved, the same Shift+click starts a new thread: a draft on the goal, nothing open
  F.owner(['thread', 'resolve', G, '--outcome', 'done']);
  await p.ev("location.hash = '#goals'");
  await soon(`TL.threads.find((x) => x.id === ${JSON.stringify(G)})?.status === 'resolved'`, 'the resolve read');
  await shiftClick(card);
  await soon(`!TL.open && TL.draft?.subject?.ref === ${JSON.stringify(`goal:${F.goal}`)}`, 'a new thread about to start');
  assert.deepEqual(await p.ev('window.__posts'), [], 'nothing posted until the owner sends words');
});
