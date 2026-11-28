// The review view's bridge listener (kit-999-dashboard-review). It ports chain.mjs's bridge cases
// (test/lib/chain.mjs, "the bridge listener": the ev helper, the 7 accepted messages, the 22-row table of
// dropped ones, the sha256 lengths loop) from a vm slice of the page to the built lib module
// apps/dashboard/lib-dist/lib/review-bridge.js, and adds the listener's own guards (ruling
// m-20261128-084551857-supervisor): with no review open or no frame mounted an event is ignored; an event
// from another window or from a foreign origin is dropped and counted, and the preview is redrawn on the
// 1st drop and every 20th; only the frame's window with an opaque origin reaches onBridge, with only its
// type's fields.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const LIB = path.join(ROOT, 'apps', 'dashboard', 'lib-dist');
// with no lib-dist/, every test skips locally; under CI the file fails
const UNBUILT = fs.existsSync(LIB) ? false : 'build apps/dashboard first (npm run build)';
if (UNBUILT && process.env.CI) throw new Error(UNBUILT);
const test = (name, fn) => nodeTest(name, UNBUILT ? { skip: UNBUILT } : {}, fn);
const load = () => import(pathToFileURL(path.join(LIB, 'lib', 'review-bridge.js')).href);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const B = 'http://127.0.0.1:43999';

// only that frame, only an opaque origin, only the known messages, within the caps; nothing else gets through
test('bridgeAccept: only that frame, only an opaque origin, only the known messages, within the caps', async () => {
  const { bridgeAccept } = await load();
  const frameWin = {};
  const ev = (data, over = {}) => ({ source: frameWin, origin: 'null', data, ...over });
  const accept = (e) => JSON.parse(JSON.stringify(bridgeAccept(e, frameWin)));
  assert.deepEqual(accept(ev({ type: 'ready' })), { type: 'ready' });
  assert.deepEqual(accept(ev({ type: 'progress', done: 3, total: 6 })), { type: 'progress', done: 3, total: 6 });
  assert.deepEqual(accept(ev({ type: 'propose', result: { rows: [] }, answer: true, sha256: 'x' })), { type: 'propose', result: { rows: [] } }, 'only the fields its type allows');
  assert.deepEqual(accept(ev({ type: 'open', href: 'https://example.com/a?b=1' })), { type: 'open', href: 'https://example.com/a?b=1' });
  assert.deepEqual(accept(ev({ type: 'open', path: 'docs/a.md', ref: 'main' })), { type: 'open', path: 'docs/a.md', ref: 'main' });
  assert.deepEqual(accept(ev({ type: 'resize', height: 1e9 })), { type: 'resize', height: 100000 }, 'a height is clamped');
  assert.deepEqual(accept(ev({ type: 'markdown', id: 1, text: '**hi**' })), { type: 'markdown', id: 1, text: '**hi**' });
  const dropped = [
    [ev({ type: 'ready' }, { source: {} }), 'source', 'another window'],
    [ev({ type: 'ready' }, { source: null }), 'source', 'no window'],
    [ev({ type: 'ready' }, { origin: B }), 'origin', "the dashboard's own origin: not a sandboxed frame"],
    [ev({ type: 'ready' }, { origin: 'https://example.com' }), 'origin', 'another origin'],
    [ev({ type: 'answer', result: {} }), 'type', 'an unknown type'],
    [ev({ type: 'submit' }), 'type', 'an unknown type'],
    [ev({}), 'type', 'no type'],
    [ev('ready'), 'shape', 'not an object'],
    [ev([{ type: 'ready' }]), 'shape', 'an array'],
    [ev({ type: 'propose', result: { pad: 'x'.repeat(4 * 1024 * 1024) } }), 'size', 'an oversize proposal'],
    [ev({ type: 'draft', state: 'x'.repeat(4 * 1024 * 1024 + 1) }), 'size', 'an oversize draft'],
    [ev({ type: 'markdown', id: 1, text: 'x'.repeat(64 * 1024 + 1) }), 'size', 'oversize markdown'],
    [ev({ type: 'propose', result: [1] }), 'fields', 'a result that is not an object'],
    [ev({ type: 'draft' }), 'fields', 'a draft with no state'],
    [ev({ type: 'progress', done: 7, total: 6 }), 'fields', 'more done than there are'],
    [ev({ type: 'progress', done: 'all', total: 6 }), 'fields', 'not a number'],
    [ev({ type: 'open', href: 'http://example.com/' }), 'href', 'plain http'],
    [ev({ type: 'open', href: 'javascript:alert(1)' }), 'href', 'a script URL'],
    [ev({ type: 'open', href: 'https://user@example.com/' }), 'href', 'credentials in the URL'],
    [ev({ type: 'open', path: '../etc/passwd' }), 'path', 'a path out of the repo'],
    [ev({ type: 'open', path: '/etc/passwd' }), 'path', 'an absolute path'],
    [ev({ type: 'resize', height: Infinity }), 'fields', 'not a finite height'],
  ];
  for (const [e, why, msg] of dropped) assert.equal(accept(e).drop, why, msg);
});

// the hash the panel shows when the page isn't a secure context is the owner's process's hash
test('sha256Js: the same hash as node:crypto', async () => {
  const { sha256Js } = await load();
  for (const n of [0, 3, 55, 56, 63, 64, 65, 1000]) {
    const bytes = crypto.randomBytes(n);
    assert.equal(sha256Js(new Uint8Array(bytes)), sha(bytes), `sha256 of ${n} bytes`);
  }
});

test('bridgeMessage: ignores a review with no frame; counts and redraws on a foreign window or origin; passes only the frame', async () => {
  const { wireBridge, bridgeMessage } = await load();
  const reviewState = { RV: null };
  const bridged = [];
  const redraws = [];
  wireBridge({ reviewState, onBridge: (m) => bridged.push(m), renderReviewPreview: () => redraws.push(reviewState.RV.dropped) });
  const frameWin = {};
  const ev = (over = {}) => ({ source: frameWin, origin: 'null', data: { type: 'ready' }, ...over });

  // no review open, and a review with no frame: ignored, nothing called, nothing counted
  bridgeMessage(ev());
  reviewState.RV = {};
  bridgeMessage(ev());
  bridgeMessage(ev({ source: {} }));
  assert.deepEqual([bridged.length, redraws.length, reviewState.RV.dropped], [0, 0, undefined], 'no review or no frame: nothing called, nothing counted');

  // a frame mounted: another window, the dashboard's own origin, another origin, and an empty or missing origin
  // are dropped and counted
  reviewState.RV = { frame: { contentWindow: frameWin }, dropped: 0 };
  bridgeMessage(ev({ source: {} }));
  bridgeMessage(ev({ origin: B }));
  bridgeMessage(ev({ origin: 'https://example.com' }));
  bridgeMessage(ev({ origin: '' }));
  bridgeMessage(ev({ origin: undefined }));
  assert.equal(reviewState.RV.dropped, 5, 'each foreign event is counted');
  assert.equal(bridged.length, 0, 'none of them reaches onBridge');
  assert.deepEqual(redraws, [1], 'the preview is redrawn on the 1st drop only');
  for (let i = 0; i < 36; i++) bridgeMessage(ev({ source: {} }));
  assert.equal(reviewState.RV.dropped, 41);
  assert.deepEqual(redraws, [1, 20, 40], 'and on every 20th drop, not otherwise');
  assert.equal(bridged.length, 0);

  // the frame's own window with an opaque origin reaches onBridge once, with only its type's fields
  bridgeMessage(ev({ data: { type: 'propose', result: { rows: [] }, answer: true } }));
  assert.deepEqual(bridged, [{ type: 'propose', result: { rows: [] } }]);
  assert.equal('answer' in bridged[0], false, 'no answer key');
  assert.equal(reviewState.RV.dropped, 41, 'an accepted message is not counted as a drop');
  assert.equal(redraws.length, 3);
});
