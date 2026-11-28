// kit-1073: a unit test of the dashboard app's later() (apps/dashboard/src/lib/data-later.ts), the call data makes
// into another view's async function. A stub's synchronous `not ported: <view>` throw (an Error whose message is a
// string starting so) becomes a rejection already handled, which an awaiting caller still gets; any other
// synchronous throw (another Error, a non-Error, an Error whose message isn't a string) becomes a rejection left
// unhandled, as before kit-1061, and so does one whose match itself throws (a message getter, a Proxy trap); and
// later() itself never throws.
// The source is TypeScript and the kit installs no compiler, so the file is read and its types stripped by
// node:module's stripTypeScriptTypes. Each test skips on Node 18 and 20, which lack it; on 22 and later a missing
// stripTypeScriptTypes fails the child, so the file goes red rather than skipping. The cases run in a child
// Node of their own, so its unhandled rejections are counted by its own listener and never reach this runner's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'dashboard', 'src', 'lib', 'data-later.ts');
const MAJOR = Number(process.versions.node.split('.')[0]);

// The child: strips the file, imports it from a data: URL, runs each case and prints one JSON line,
// { "<case>": { sync, settled, value, same, unhandled } }. sync is later()'s own throw (null when it returned a
// promise); unhandled lists the reasons the child's unhandledRejection listener saw for that case alone.
const CHILD = `
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const js = stripTypeScriptTypes(fs.readFileSync(process.argv[1], 'utf8'));
const { later } = await import('data:text/javascript,' + encodeURIComponent(js));
const seen = [];
process.on('unhandledRejection', (r) => seen.push(r));
const tick = () => new Promise((r) => setTimeout(r, 30));
const show = (v) => { try { return v instanceof Error ? v.constructor.name + ': ' + String(v.message) : typeof v === 'string' ? 'string: ' + v : JSON.stringify(v) ?? String(v); } catch { return 'unshowable'; } };
const out = {};
const run = async (name, f, args, awaited) => {
  seen.length = 0;
  const r = { sync: null, settled: null, value: null, same: null, unhandled: [] };
  let p;
  try { p = later(f, ...args); } catch (e) { r.sync = show(e); }
  if (p && awaited) {
    try { r.value = show(await p); r.settled = 'resolved'; } catch (e) { r.settled = 'rejected'; r.value = show(e); r.same = e === f.thrown; }
  }
  if (p) r.promise = p instanceof Promise;
  await tick(); await tick();
  r.unhandled = seen.map(show);
  out[name] = r;
};
const throwing = (v) => { const f = () => { throw v; }; f.thrown = v; return f; };
const odd = (m) => { const e = new Error('x'); e.message = m; return e; };
await run('stub', throwing(new Error('not ported: overview')), [], false);
await run('stub-args', throwing(new Error('not ported: peeks')), ['lesson', 'k-1'], false);
await run('stub-awaited', throwing(new Error('not ported: viewer')), [], true);
await run('stub-subclass', throwing(new TypeError('not ported: board')), [], false);
await run('other-error', throwing(new TypeError('boom')), [], false);
await run('near-not-found', throwing(new Error('not found: x')), [], false);
await run('near-case', throwing(new Error('Not ported: x')), [], false);
await run('near-no-space', throwing(new Error('not ported:x')), [], false);
await run('near-inside', throwing(new Error('view not ported: x')), [], false);
await run('other-awaited', throwing(new RangeError('bad')), [], true);
await run('non-error-string', throwing('not ported: overview'), [], false);
await run('non-error-null', throwing(null), [], false);
await run('non-error-undefined', throwing(undefined), [], false);
await run('non-error-object', throwing({ message: 'not ported: overview' }), [], false);
await run('message-number', throwing(odd(42)), [], false);
await run('message-undefined', throwing(odd(undefined)), [], false);
await run('message-starts-with', throwing(odd({ startsWith: () => true })), [], false);
await run('message-string-object', throwing(odd(new String('not ported: overview'))), [], false);
await run('message-getter-throws', throwing(Object.defineProperty(new Error('x'), 'message', { get() { throw new Error('getter'); } })), [], false);
await run('proxy-trap', throwing(new Proxy(new Error('not ported: overview'), { getPrototypeOf() { throw new Error('trap'); } })), [], false);
await run('message-number-awaited', throwing(odd(42)), [], true);
await run('value', (a, b) => a + b, [2, 3], true);
await run('async-value', async (a) => a * 2, [4], true);
const asyncErr = new Error('not ported: async');
const asyncF = async () => { throw asyncErr; }; asyncF.thrown = asyncErr;
await run('async-rejection', asyncF, [], true);
let order = [];
const p = later(() => { order.push('f'); }); order.push('returned'); await p;
out.order = order;
process.stdout.write(JSON.stringify(out) + '\\n');
`;

// The child runs once: its result, or its failure, is kept for every test, so a child that fails or hangs costs
// one 60 s timeout, not one per test (the runner's watchdog ends a file at 300 s).
let cases = null;
let failed = null;
const results = () => {
  if (failed) throw failed;
  if (cases) return cases;
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '--no-warnings', '-e', CHILD, FILE], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(r.status, 0, `the child ran (status ${r.status}, signal ${r.signal}): ${r.stderr}`);
    cases = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch (e) {
    failed = e;
    throw e;
  }
  return cases;
};
const skip = MAJOR < 22 ? 'Node 18 and 20 have no node:module stripTypeScriptTypes to read data-later.ts with' : false;
const handled = (c, name) => {
  assert.equal(c.sync, null, `${name}: later() threw synchronously: ${c.sync}`);
  assert.equal(c.promise, true, `${name}: later() returned a promise`);
};

test('U1 a stub\'s not-ported throw, not awaited, is a handled rejection', { skip }, () => {
  const c = results();
  for (const n of ['stub', 'stub-args', 'stub-subclass']) {
    handled(c[n], n);
    assert.deepEqual(c[n].unhandled, [], `${n}: no unhandled rejection`);
  }
});

test('U2 an awaiting caller still gets the stub\'s own error', { skip }, () => {
  const c = results()['stub-awaited'];
  handled(c, 'stub-awaited');
  assert.equal(c.settled, 'rejected', 'the promise rejects');
  assert.equal(c.same, true, 'with the very error the stub threw');
  assert.deepEqual(c.unhandled, []);
});

test('U3 any other Error stays an unhandled rejection, prefix look-alikes included', { skip }, () => {
  const c = results();
  const want = { 'other-error': 'TypeError: boom', 'near-not-found': 'Error: not found: x', 'near-case': 'Error: Not ported: x', 'near-no-space': 'Error: not ported:x', 'near-inside': 'Error: view not ported: x' };
  for (const [n, r] of Object.entries(want)) {
    handled(c[n], n);
    assert.deepEqual(c[n].unhandled, [r], `${n}: left unhandled`);
  }
  assert.equal(c['other-awaited'].settled, 'rejected');
  assert.equal(c['other-awaited'].same, true, 'an awaiting caller gets the other error too');
});

test('U4 a thrown non-Error stays an unhandled rejection, and later() does not throw', { skip }, () => {
  const c = results();
  const want = { 'non-error-string': 'string: not ported: overview', 'non-error-null': 'null', 'non-error-undefined': 'undefined', 'non-error-object': '{"message":"not ported: overview"}' };
  for (const [n, r] of Object.entries(want)) {
    handled(c[n], n);
    assert.deepEqual(c[n].unhandled, [r], `${n}: left unhandled`);
  }
});

test('U5 an Error whose message is not a string, or whose match throws, stays an unhandled rejection, and later() does not throw', { skip }, () => {
  const c = results();
  const want = { 'message-number': 'Error: 42', 'message-undefined': 'Error: undefined', 'message-starts-with': 'Error: [object Object]', 'message-string-object': 'Error: not ported: overview', 'message-getter-throws': 'unshowable', 'proxy-trap': 'unshowable' };
  for (const [n, r] of Object.entries(want)) {
    handled(c[n], n);
    assert.deepEqual(c[n].unhandled, [r], `${n}: left unhandled`);
  }
  const a = c['message-number-awaited'];
  handled(a, 'message-number-awaited');
  assert.equal(a.settled, 'rejected');
  assert.equal(a.same, true, 'an awaiting caller gets that error');
});

test('U6 values and an async f\'s result come through; f runs before later() returns', { skip }, () => {
  const c = results();
  assert.equal(c.value.value, '5', 'a value comes through');
  assert.equal(c['async-value'].value, '8', 'an async f\'s value comes through');
  assert.equal(c['async-rejection'].settled, 'rejected');
  assert.equal(c['async-rejection'].same, true, 'an async f\'s rejection reaches the caller');
  assert.deepEqual(c.order, ['f', 'returned'], 'f runs before later() returns');
});
