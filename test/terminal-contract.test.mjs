// The terminal routes (terminal@1, test/contracts/terminal.md): the contract states every route,
// guard, refusal and writer rule the design's "The routes" and "The owner's line comes first" set
// (C1 to C3, which read the document's own words), and the fake server the page's tests use
// (test/fixtures/term-fake.mjs) answers as the contract says (A1 to A3, C4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = () => fs.readFileSync(path.join(here, 'contracts', 'terminal.md'), 'utf8');
const has = (text, needle) => assert.ok(text.includes(needle), `the contract says ${JSON.stringify(needle)}`);
// The text from the `## ` heading naming `word` to the next `## ` heading (a `###` never cuts it).
function section(md, word) {
  const parts = md.split(/^## /m);
  const hit = parts.filter((p) => p.split('\n', 1)[0].includes(word));
  assert.equal(hit.length, 1, `one ## section names ${word}`);
  return hit[0];
}

test('terminal C1: the contract states the routes', () => {
  const md = contract();
  for (const n of [
    'terminal@1',
    '`GET /api/term/token` answers `{ token }`', 'GET /api/term/<which>/screen', 'GET /api/term/<which>/history?before=<n>&count=<k>',
    'POST /api/term/<which>/keys', 'POST /api/term/shell/open',
    '`pane`', '`state`', '`cols`', '`rows`', '`cursor`', '`modes`', '`history_size`', '`lines`', '`etag`', '`held`',
    'at most 500',
    '{ which, pane, page, seq, data | paste, token }',
    '`Sec-Fetch-Site: same-origin`', '`Origin` equal to `http://<Host>`', '`Content-Type` `application/json`', '`127.0.0.1`, `localhost`, `::1`',
    'devteam-term-keys-v1', 'devteam-term-open-v1',
    '`400`', '`403`', '`409`', '`413`', '`423`', '`503`',
    'greater than the last',
  ]) has(md, n);
});

test('terminal C2: the Writers section', () => {
  const w = section(contract(), 'Writers');
  for (const n of [
    '`@devteam-owner-floor`', 'on every post', '`<epoch ms> open`', '`<epoch ms> done`', 'Enter (', 'Ctrl+C (',
    "Escape doesn't end a line", '3 s settle', '`ready`', '`busy`', '`dialog`', '`limit`', '`unknown`',
    '`paneAnswer` is exempt', 'an `open` floor is never released', '`run/type-lock-<pane id>`', 'pid and a stamp', 'refreshed between steps',
    'when the pid is dead', '60 s old', 're-entrant per call chain', '`AsyncLocalStorage`', 'where every wait is async',
    '`Atomics.wait`', 'only after taking it', 'after 10 s', '503 after 2 s', '`pane answered`',
    'once the floor is released', "owner's line open", '120000', '2 minutes',
    'Messages for the supervisor are waiting until you send or clear your line.',
    'Press Enter or Ctrl+C here to let them through.',
    "supervisor's pane only",
    'the keys and paste routes', '`typeNow`', '`typeInto`', '`flushHeld`', '`flushAllHeld`', '`resendLostEnter`',
    '`machine tell`', '`enterLanded`',
  ]) has(w, n);
});

test('terminal C3: consumers and logging', () => {
  const md = contract();
  for (const n of ['`index.html`', 'Supervisor and Shell tabs', '`cloud/gateway.mjs`', '`devteam.mjs`', 'never logged']) has(md, n);
});

// The fake, imported inside each test so a missing module fails the test, not the file.
const fakeModule = () => import('./fixtures/term-fake.mjs');
const P = 'p'.repeat(16);
const Q = 'q'.repeat(16);
// A request as the dashboard's own page sends it: same-origin headers by default; a header given
// as null is left out (fetch would send undefined as the string "undefined").
async function req(fake, method, p, { headers = {}, body, raw } = {}) {
  const h = { 'sec-fetch-site': 'same-origin', origin: fake.url, ...headers };
  for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
  let b;
  if (raw !== undefined || body !== undefined) {
    b = raw !== undefined ? raw : JSON.stringify(body);
    if (!('content-type' in headers)) h['content-type'] = 'application/json';
  }
  const r = await fetch(fake.url + p, { method, headers: h, body: b });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, headers: r.headers, text, json };
}
const screenOf = (fake, which, headers) => req(fake, 'GET', `/api/term/${which}/screen`, { headers });
// A well-formed keys post; `fields` overrides any part (a field set to undefined is left out).
async function keys(fake, which, fields = {}, headers) {
  const pane = 'pane' in fields ? fields.pane : (await screenOf(fake, which)).json.pane;
  return req(fake, 'POST', `/api/term/${which}/keys`, { headers, body: { which, pane, page: P, token: fake.token, ...fields } });
}
const hex = (s) => Buffer.from(s, 'latin1').toString('hex');
// fetch can't set Host, so the wrong-host check goes through http.request.
const withHost = (fake, p, host, extra = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: fake.port, path: p, headers: { host, 'sec-fetch-site': 'same-origin', ...extra } }, (res) => {
    let s = '';
    res.on('data', (c) => { s += c; });
    res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(s) }));
  });
  r.on('error', reject);
  r.end();
});
const until = async (f, ms = 2000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 2)); } };

test('terminal A1: the fake answers every route, echoes, orders, brackets, 304, 403 and 413', async () => {
  const { startTermFake } = await fakeModule();
  const fake = await startTermFake({ shell: false });
  try {
    // token: needs Sec-Fetch-Site present and same-origin
    let r = await req(fake, 'GET', '/api/term/token');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { token: fake.token });
    r = await req(fake, 'GET', '/api/term/token', { headers: { 'sec-fetch-site': null } });
    assert.equal(r.status, 403);
    assert.deepEqual(r.json, { why: 'cross-site' });
    // screen: answers without Sec-Fetch-Site; every field
    r = await screenOf(fake, 'supervisor', { 'sec-fetch-site': null });
    assert.equal(r.status, 200);
    const s0 = (await screenOf(fake, 'supervisor')).json;
    for (const k of ['v', 'which', 'pane', 'state', 'cols', 'rows', 'cursor', 'modes', 'history_size', 'held', 'lines', 'etag']) assert.ok(k in s0, `screen has ${k}`);
    assert.equal(s0.v, 1);
    assert.equal(s0.which, 'supervisor');
    assert.equal(s0.pane, '%1');
    assert.equal(s0.state, 'live');
    assert.equal(s0.lines.length, s0.rows);
    assert.deepEqual(Object.keys(s0.cursor).sort(), ['visible', 'x', 'y']);
    assert.deepEqual(Object.keys(s0.modes).sort(), ['app_cursor', 'app_keypad']);
    // etag: 304 on the quoted header byte for byte; a weak etag or a list is a 200
    const tag = (await screenOf(fake, 'supervisor')).headers.get('etag');
    assert.equal(tag, `"${s0.etag}"`);
    assert.equal((await screenOf(fake, 'supervisor', { 'if-none-match': tag })).status, 304);
    assert.equal((await screenOf(fake, 'supervisor', { 'if-none-match': `W/${tag}` })).status, 200);
    assert.equal((await screenOf(fake, 'supervisor', { 'if-none-match': `"x", ${tag}` })).status, 200);
    // keys: echo and typed
    r = await keys(fake, 'supervisor', { seq: 1, data: '6869' });
    assert.equal(r.status, 200);
    assert.equal(r.json.taken, true);
    assert.deepEqual(fake.typed('supervisor'), ['hi']);
    assert.equal(r.json.lines[0], 'hi');
    const after = await screenOf(fake, 'supervisor', { 'if-none-match': tag });
    assert.equal(after.status, 200, 'the old etag no longer matches');
    assert.notEqual(after.json.etag, s0.etag);
    // seq order: greater than the last taken, per page and which
    assert.equal((await keys(fake, 'supervisor', { seq: 2, data: hex('!') })).json.taken, true);
    assert.equal((await keys(fake, 'supervisor', { seq: 2, data: hex('!') })).json.taken, false);
    r = await keys(fake, 'supervisor', { seq: 1, data: hex('!') });
    assert.equal(r.status, 200);
    assert.equal(r.json.taken, false);
    assert.deepEqual(fake.typed('supervisor'), ['hi', '!']);
    // one post at a time per pane: seq 4 waits behind seq 3's send
    fake.set({ sendMs: 100 });
    const p3 = keys(fake, 'supervisor', { seq: 3, data: hex('a'), pane: '%1' }).then((x) => ({ ...x, at: Date.now() }));
    await until(() => fake.typed('supervisor').length === 3);
    const t4 = Date.now();
    const p4 = keys(fake, 'supervisor', { seq: 4, data: hex('b'), pane: '%1' }).then((x) => ({ ...x, at: Date.now() }));
    const [r3, r4] = await Promise.all([p3, p4]);
    assert.equal(r3.json.taken, true);
    assert.equal(r4.json.taken, true);
    assert.deepEqual(fake.typed('supervisor').slice(-2), ['a', 'b']);
    // from seq 4's own send: with the chain it waits out most of seq 3's 100 ms and then its own (about 180 ms); a stall only adds; without the chain about 100 ms
    assert.ok(r4.at - t4 >= 150, `seq 4 waited behind seq 3 and then took its own send (${r4.at - t4} ms after it was sent)`);
    assert.ok(r4.at >= r3.at, 'seq 4 answered after seq 3');
    fake.set({ sendMs: 0 });
    assert.equal((await keys(fake, 'supervisor', { seq: 3, data: hex('a') })).json.taken, false);
    assert.equal((await keys(fake, 'supervisor', { seq: 7, data: hex('c') })).json.taken, true, 'a gap is taken');
    assert.equal((await keys(fake, 'supervisor', { seq: 6, data: hex('c') })).json.taken, false);
    assert.equal((await keys(fake, 'supervisor', { seq: 1, data: hex('d'), page: Q })).json.taken, true, 'another page keeps its own seq');
    // Shell: gone until opened, then live; open is idempotent; its own seq
    r = await screenOf(fake, 'shell');
    assert.equal(r.json.state, 'gone');
    assert.equal(r.json.pane, null);
    assert.equal(r.json.cols, 0);
    assert.equal(r.json.rows, 0);
    assert.deepEqual(r.json.lines, []);
    assert.deepEqual(r.json.cursor, { x: 0, y: 0, visible: false });
    assert.equal(r.json.history_size, 0);
    const openBody = { which: 'shell', page: P, token: fake.token, cols: 100, rows: 30 };
    r = await req(fake, 'POST', '/api/term/shell/open', { body: openBody });
    assert.equal(r.status, 200);
    assert.equal(r.json.state, 'live');
    assert.equal(r.json.cols, 100);
    assert.equal(r.json.pane, '%2');
    r = await req(fake, 'POST', '/api/term/shell/open', { body: openBody });
    assert.equal(r.json.pane, '%2');
    assert.equal((await keys(fake, 'shell', { seq: 1, data: hex('ls') })).json.taken, true, 'each tab its own seq');
    assert.deepEqual(fake.typed('shell'), ['ls']);
    fake.set({ shell: false });
    assert.equal((await screenOf(fake, 'shell')).json.state, 'gone', 'set({ shell: false }) closes the Shell');
    assert.equal((await req(fake, 'POST', '/api/term/shell/open', { body: openBody })).json.state, 'live');
    // a paste: whole, bracketed only when told to
    await keys(fake, 'supervisor', { seq: 8, paste: 'a\nb' });
    assert.equal(fake.typed('supervisor').at(-1), 'a\nb');
    fake.set({ bracketPaste: true });
    await keys(fake, 'supervisor', { seq: 9, paste: 'a\nb' });
    assert.equal(fake.typed('supervisor').at(-1), '\x1b[200~a\nb\x1b[201~');
    // refusals the done-when names
    const n = fake.typed('supervisor').length;
    assert.equal((await keys(fake, 'supervisor', { seq: 10, data: '00', token: undefined })).status, 403);
    assert.equal((await keys(fake, 'supervisor', { seq: 10, data: '00'.repeat(4097) })).status, 413);
    assert.equal(fake.typed('supervisor').length, n);
    r = await keys(fake, 'supervisor', { seq: 10, data: '00'.repeat(4096) });
    assert.equal(r.status, 200);
    assert.equal(r.json.taken, true);
    // history: absolute numbering, at most 500
    fake.set({ history: ['x', 'y', 'z'] });
    r = await req(fake, 'GET', '/api/term/supervisor/history?before=3&count=2');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.lines, ['y', 'z']);
    assert.equal(r.json.history_size, 3);
    assert.equal(r.json.before, 3);
    for (const q of ['before=3&count=501', 'before=3&count=0', 'before=4&count=1', 'count=1']) {
      assert.equal((await req(fake, 'GET', `/api/term/supervisor/history?${q}`)).status, 400, q);
    }
  } finally {
    await fake.close();
  }
});

test('terminal A2: held and why', async () => {
  const { startTermFake, WHYS } = await fakeModule();
  const fake = await startTermFake();
  try {
    assert.deepEqual((await screenOf(fake, 'supervisor')).json.held, { count: 0, oldest_ms: 0, prompt: 'readable' });
    fake.set({ held: { count: 2, oldest_ms: 5000, prompt: 'unknown' } });
    const s1 = (await screenOf(fake, 'supervisor')).json;
    assert.deepEqual(s1.held, { count: 2, oldest_ms: 5000, prompt: 'unknown' });
    assert.deepEqual((await screenOf(fake, 'shell')).json.held, { count: 0, oldest_ms: 0, prompt: 'readable' }, "Shell's held is the default");
    fake.set({ held: { count: 2, oldest_ms: 6000, prompt: 'unknown' } });
    assert.equal((await screenOf(fake, 'supervisor')).json.etag, s1.etag, 'the etag holds while oldest_ms grows');
    fake.set({ held: { count: 2, oldest_ms: 120000, prompt: 'unknown' } });
    assert.notEqual((await screenOf(fake, 'supervisor')).json.etag, s1.etag, 'the etag changes when the note is due');
    const arrow = await keys(fake, 'supervisor', { seq: 1, data: hex('\x1b[Ab\x1bOA') });
    assert.equal(arrow.json.lines[0], 'b', 'an escape sequence is recorded but not drawn');
    assert.deepEqual(fake.typed('supervisor'), ['\x1b[Ab\x1bOA']);
    for (const w of WHYS) {
      fake.set({ refuse: w });
      for (const p of ['/api/term/token', '/api/term/supervisor/screen', '/api/term/supervisor/history?before=0&count=1']) {
        const r = await req(fake, 'GET', p);
        assert.equal(r.status, 403, `${w} ${p}`);
        assert.deepEqual(r.json, { why: w }, `${w} ${p}`);
      }
    }
    fake.set({ refuse: null });
    const why = async (headers) => (await screenOf(fake, 'supervisor', headers)).json;
    assert.deepEqual(await why({ 'x-devteam-level': 'view' }), { why: 'view' });
    assert.deepEqual(await why({ 'x-devteam-relay': '1' }), { why: 'relay' });
    assert.deepEqual(await why({ 'sec-fetch-site': 'cross-site' }), { why: 'cross-site' });
    assert.deepEqual(await why({ 'x-devteam-level': 'view', 'sec-fetch-site': 'cross-site' }), { why: 'view' }, 'view wins over cross-site');
    assert.deepEqual(await why({ 'x-devteam-level': 'view', 'x-devteam-relay': '1' }), { why: 'relay' }, 'the global relay guard comes first');
    assert.deepEqual((await req(fake, 'GET', '/api/term/nope', { headers: { 'x-devteam-relay': '1' } })).json, { why: 'relay' }, 'before routing');
    assert.equal((await withHost(fake, '/api/term/supervisor/screen', `[::1]:${fake.port}`)).status, 200, '[::1] is a loopback host');
    const hv = await withHost(fake, '/api/term/supervisor/screen', 'evil.test', { 'x-devteam-level': 'view' });
    assert.deepEqual(hv.json, { why: 'host' }, 'host wins over view');
    const h = await withHost(fake, '/api/term/supervisor/screen', 'evil.test');
    assert.equal(h.status, 403);
    assert.deepEqual(h.json, { why: 'host' });
    fake.set({ gatewayView: true });
    for (const r of [await screenOf(fake, 'supervisor'), await keys(fake, 'supervisor', { pane: '%1', seq: 1, data: '00' })]) {
      assert.equal(r.status, 403);
      assert.equal(r.headers.get('content-type'), 'application/json');
      assert.equal(r.text, '{"why":"view"}');
    }
  } finally {
    await fake.close();
  }
});

test('terminal A3: refusals type nothing', async () => {
  const { startTermFake } = await fakeModule();
  const fake = await startTermFake();
  try {
    const typed = () => fake.typed('supervisor').length;
    const none = async (label, p, status, why) => {
      const n = typed();
      const r = await p;
      assert.equal(r.status, status, label);
      if (why) assert.equal(r.json.why, why, label);
      assert.equal(typed(), n, `${label}: nothing typed`);
      return r;
    };
    await none('which mismatch', keys(fake, 'supervisor', { which: 'shell', seq: 1, data: '00' }), 400);
    await none('extra key', keys(fake, 'supervisor', { seq: 1, data: '00', extra: 1 }), 400);
    await none('data and paste', keys(fake, 'supervisor', { seq: 1, data: '00', paste: 'x' }), 400);
    for (const seq of [0, -1, 1.5, 2 ** 53]) await none(`seq ${seq}`, keys(fake, 'supervisor', { seq, data: '00' }), 400);
    for (const data of ['abc', 'zz']) await none(`data ${data}`, keys(fake, 'supervisor', { seq: 1, data }), 400);
    await none('empty paste', keys(fake, 'supervisor', { seq: 1, paste: '' }), 400);
    await none('text/plain', keys(fake, 'supervisor', { seq: 1, data: '00' }, { 'content-type': 'text/plain' }), 403);
    await none('no Origin', keys(fake, 'supervisor', { seq: 1, data: '00' }, { origin: null }), 403, 'cross-site');
    await none('paste over 65536 bytes', keys(fake, 'supervisor', { seq: 1, paste: '€'.repeat(21846) }), 413);
    let n = typed();
    let r = await keys(fake, 'supervisor', { seq: 1, paste: '€'.repeat(21845) });
    assert.equal(r.status, 200);
    assert.equal(typed(), n + 1);
    await none('body over 100 KB', req(fake, 'POST', '/api/term/supervisor/keys', { raw: 'x'.repeat(102401) }), 413);
    await none('body at 100 KB is read (and is no JSON)', req(fake, 'POST', '/api/term/supervisor/keys', { raw: 'x'.repeat(102400) }), 400);
    await none('content type before the body cap', req(fake, 'POST', '/api/term/supervisor/keys', { raw: 'x'.repeat(102401), headers: { 'content-type': 'text/plain' } }), 403);
    await none('token before the data cap', keys(fake, 'supervisor', { seq: 1, data: '00'.repeat(4097), token: undefined }), 403);
    await none('paste one byte over', keys(fake, 'supervisor', { seq: 1, paste: 'a'.repeat(65537) }), 413);
    n = typed();
    assert.equal((await keys(fake, 'supervisor', { seq: 1, paste: 'a'.repeat(65536) })).status, 200, 'a paste of exactly 65536 bytes');
    assert.equal(typed(), n, 'seq 1 was already taken, so nothing more is typed');
    await none('unknown which', req(fake, 'GET', '/api/term/nope/screen'), 404);
    await none('supervisor/open', req(fake, 'POST', '/api/term/supervisor/open', { body: { which: 'supervisor', page: P, token: fake.token, cols: 80, rows: 24 } }), 404);
    await none('GET keys', req(fake, 'GET', '/api/term/supervisor/keys'), 405);
    // a refusal after the shape check doesn't use up its seq
    fake.set({ supervisor: 'gone' });
    await none('gone', keys(fake, 'supervisor', { pane: '%1', seq: 2, data: '00' }), 409);
    fake.set({ supervisor: 'live' });
    assert.equal((await keys(fake, 'supervisor', { seq: 2, data: '00' })).json.taken, true, 'seq 2 after a 409');
    fake.set({ pane: '%7' });
    await none('stale pane', keys(fake, 'supervisor', { pane: '%1', seq: 3, data: '00' }), 423);
    assert.equal((await keys(fake, 'supervisor', { pane: '%7', seq: 3, data: '00' })).json.taken, true, 'seq 3 after a 423');
    fake.set({ busy: true });
    await none('busy', keys(fake, 'supervisor', { seq: 4, data: '00' }), 503);
    r = await none('a repeat while busy', keys(fake, 'supervisor', { seq: 3, data: '00' }), 200);
    assert.equal(r.json.taken, false, 'the repeat drop comes before the lock');
    assert.notEqual((await keys(fake, 'shell', { seq: 1, data: '00' })).status, 503, "Shell's keys take no lock");
    fake.set({ busy: false });
    n = typed();
    assert.equal((await keys(fake, 'supervisor', { seq: 4, data: '00' })).json.taken, true, 'seq 4 after a 503');
    assert.equal(typed(), n + 1);
    // every POST guard, each typing nothing
    await none('POST cross-site with a right Origin', keys(fake, 'supervisor', { seq: 5, data: '00' }, { 'sec-fetch-site': 'cross-site' }), 403, 'cross-site');
    await none('POST without Sec-Fetch-Site', keys(fake, 'supervisor', { seq: 5, data: '00' }, { 'sec-fetch-site': null }), 403, 'cross-site');
    await none('a wrong Origin', keys(fake, 'supervisor', { seq: 5, data: '00' }, { origin: 'http://evil.test' }), 403, 'cross-site');
    await none('View on a POST', keys(fake, 'supervisor', { seq: 5, data: '00' }, { 'x-devteam-level': 'view' }), 403, 'view');
    fake.set({ refuse: 'cross-site' });
    await none('a real View header wins over a scripted refusal', screenOf(fake, 'supervisor', { 'x-devteam-level': 'view' }), 403, 'view');
    fake.set({ refuse: null });
    const shellTyped = () => fake.typed('shell').length;
    const open = (fields, headers) => req(fake, 'POST', '/api/term/shell/open', { headers, body: { which: 'shell', page: P, token: fake.token, cols: 80, rows: 24, ...fields } });
    const s0 = shellTyped();
    assert.equal((await open({ token: undefined })).status, 403, 'shell/open without a token');
    assert.equal((await open({ token: 'f'.repeat(64) })).status, 403, 'shell/open with a wrong token');
    for (const f of [{ cols: 19 }, { cols: 501 }, { rows: 4 }, { rows: 201 }, { cols: 80.5 }, { extra: 1 }, { which: 'supervisor' }, { page: 'short' }]) {
      assert.equal((await open(f)).status, 400, `shell/open ${JSON.stringify(f)}`);
    }
    assert.equal((await open({ cols: 20, rows: 5 })).status, 200, 'the smallest panel');
    assert.equal((await open({ cols: 500, rows: 200 })).status, 200, 'the largest panel');
    assert.equal((await open({}, { 'x-devteam-level': 'view' })).json.why, 'view', 'View on shell/open');
    fake.set({ shell: false });
    assert.equal((await keys(fake, 'shell', { pane: '%2', seq: 2, data: '00' })).status, 409, 'Shell keys while Shell is gone');
    fake.set({ openFails: true });
    assert.equal((await open({})).status, 409, 'shell/open that could not make the window');
    fake.set({ openFails: false, shellPane: '%5' });
    assert.equal((await open({})).json.pane, '%5');
    assert.equal((await keys(fake, 'shell', { pane: '%2', seq: 2, data: '00' })).status, 423, 'Shell keys to the old pane');
    assert.equal(shellTyped(), s0, 'no Shell refusal typed anything');
  } finally {
    await fake.close();
  }
});

test('terminal C4: the why list matches the fake', async () => {
  const { WHYS } = await fakeModule();
  const md = contract();
  const at = md.indexOf('`why` is one of');
  assert.ok(at >= 0, 'the contract has the why sentence');
  const sentence = md.slice(at + '`why` is one of'.length, md.indexOf('.', at));
  assert.deepEqual([...sentence.matchAll(/`([^`]+)`/g)].map((m) => m[1]), WHYS);
  has(md, '{"why":"view"}');
  has(md, 'held: { count, oldest_ms, prompt }');
});
