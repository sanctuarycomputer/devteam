// What keeps an artifact clickable in the viewer: its lens never tells a Shift typed in one of the
// page's own fields (told, the viewer raised its overlay over a page being typed in, and a click made
// without moving the pointer was the overlay's), and `artifact check` says before the owner looks
// when an image or media file comes from a host the page's policy never loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, fleetFixture, write } from './lib/kit.mjs';
import { cleanup } from './lib/chrome.mjs';

// The lens's script, run in vm against a stand-in page (as presence-lens.test.mjs's lensInVm): its
// window listeners and what it posts to its parent, after the viewer's hello.
function lens({ activeElement = null } = {}) {
  const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
  const script = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(src)[1];
  const ancestor = 'http://127.0.0.1:4321';
  const listeners = {};
  const posted = [];
  const parent = { postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) };
  const doc = { title: 'A mock', documentElement: {}, body: {}, activeElement, elementFromPoint: () => null, querySelectorAll: () => [], querySelector: () => null, getElementsByTagName: () => [], getElementById: () => null };
  const win = {
    document: doc, parent, innerWidth: 800, innerHeight: 600,
    location: { pathname: '/artifact/main/lens-mock/index.html', ancestorOrigins: [ancestor] },
    addEventListener: (type, f) => { (listeners[type] ??= []).push(f); },
    setInterval: () => 0, setTimeout: () => 0, clearTimeout: () => {}, requestAnimationFrame: () => 0,
    MutationObserver: class { observe() {} }, TextEncoder, CSS: { escape: (s) => s },
  };
  win.window = win;
  vm.runInNewContext(script, win);
  for (const f of listeners.message ?? []) f({ data: { lens: 1, type: 'hello' }, source: parent, isTrusted: true, origin: ancestor });
  const press = (type, key, target) => { for (const f of listeners[type] ?? []) f({ type, key, shiftKey: key === 'Shift' ? type === 'keydown' : false, target }); };
  const keys = () => posted.filter((m) => m.type === 'key').map((m) => `${m.key}:${m.shift}`);
  return { press, keys };
}
const el = (localName, o = {}) => ({ nodeType: 1, localName, isContentEditable: false, shadowRoot: null, ...o });

test('artifact lens: a Shift typed in one of the page\'s fields is never told; elsewhere it is', () => {
  const fields = [
    ['a text input', el('input', { type: 'text' })],
    ['an input with no type', el('input', { type: '' })],
    ['a search input', el('input', { type: 'search' })],
    ['a textarea', el('textarea')],
    ['a contenteditable', el('div', { isContentEditable: true })],
    ['an input inside an open shadow root', el('my-field', { shadowRoot: { activeElement: el('input', { type: 'email' }) } })],
  ];
  for (const [what, target] of fields) {
    const L = lens();
    L.press('keydown', 'Shift', target);
    L.press('keydown', 'Shift', target);
    assert.deepEqual(L.keys().filter((k) => k === 'Shift:true'), [], `${what}: a capital letter, not a point`);
    // Escape still ends the viewer's pin mode from anywhere
    L.press('keydown', 'Escape', target);
    assert.ok(L.keys().includes('Escape:false'), `${what}: Escape is still told`);
  }
  const elsewhere = [
    ['the page itself', el('body')],
    ['a button', el('button')],
    ['a checkbox', el('input', { type: 'checkbox' })],
    ['a range', el('input', { type: 'range' })],
  ];
  for (const [what, target] of elsewhere) {
    const L = lens();
    L.press('keydown', 'Shift', target);
    assert.deepEqual(L.keys(), ['Shift:true'], `${what}: Shift is told, so the overlay rises to point`);
    L.press('keyup', 'Shift', target);
    assert.deepEqual(L.keys(), ['Shift:true', 'Shift:false'], `${what}: and its release`);
  }
  // an event with no element for a target (the window's own): what has the focus decides
  let L = lens({ activeElement: el('textarea') });
  L.press('keydown', 'Shift', undefined);
  assert.deepEqual(L.keys(), [], 'the focus in a textarea: not told');
  L = lens();
  L.press('keydown', 'Shift', undefined);
  assert.deepEqual(L.keys(), ['Shift:true'], 'nothing focused: told');
});

test('artifact check warns of an image or media file from another host: the page\'s policy never loads it', (t) => {
  const F = fleetFixture('artifact-media');
  cleanup(t)(() => F.done());
  const dir = path.join(F.old, 'docs/devteam/project/artifacts');
  const manifest = (title) => JSON.stringify({ v: 1, title, summary: 'A page to point at', by: 'supervisor', for: [] });
  write(path.join(dir, 'remote-media', 'artifact.json'), manifest('Remote media'));
  write(path.join(dir, 'remote-media', 'index.html'), [
    '<!doctype html><html><body>',
    '<img alt="" src="https://images.example.com/hero.png">',
    '<img src="https://cdn.jsdelivr.net/npm/some-icons@1.2.3/icon.svg">',
    '<video poster="https://media.example.com/poster.jpg"><source src="https://media.example.com/clip.mp4"></video>',
    '<img src="https://images.example.com/hero.png">',
    // one a script draws: its markup is in the page's text all the same
    '<script>const icon = (host) => \'<img alt="" src="https://www.example.org/s2/favicons?domain=\' + host + \'">\';</script>',
    '</body></html>',
  ].join('\n'));
  write(path.join(dir, 'own-media', 'artifact.json'), manifest('Own media'));
  write(path.join(dir, 'own-media', 'index.html'), '<!doctype html><html><body><img src="hero.png"><img src="data:image/png;base64,AA=="><video src="clip.mp4"></video><a href="https://example.com/">a link is fine</a></body></html>');
  write(path.join(dir, 'own-media', 'hero.png'), 'x');
  const r = F.run(F.old, ['artifact', 'check', 'remote-media', 'own-media']);
  assert.equal(r.status, 0, `warnings never block: ${r.err}`);
  const warned = r.err.split('\n').filter((l) => /won't load \(copy it into/.test(l));
  for (const url of ['https://images.example.com/hero.png', 'https://cdn.jsdelivr.net/npm/some-icons@1.2.3/icon.svg', 'https://media.example.com/poster.jpg', 'https://media.example.com/clip.mp4', 'https://www.example.org/s2/favicons?domain=']) {
    assert.ok(warned.some((l) => l.includes(url)), `warned of ${url}: ${r.err}`);
  }
  assert.equal(warned.length, 5, 'each url once');
  assert.ok(warned.every((l) => l.includes('remote-media')), 'only the page that loads from elsewhere');
});
