// What presence-relay.*.test.mjs share. The presence relay (kit-631, presence@1): the /presence
// WebSocket on a real dashboard and on its real hub, driven by the contract's own test client
// (test/lib/presence-fake.mjs's openPresence) and held to its shapes (shapeErrors). The clock is real:
// every wait is a `next` or a `closed` with a deadline, and every "never" is bounded by a sentinel
// people on the same socket. The dashboard starts once per importing file, and stops after it.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dashboardOnFreePort, fleetFixture, PORTS } from './kit.mjs';
import { LIMITS, openPresence, shapeErrors } from './presence-fake.mjs';

// ---- the file's people: every id, name and at word starts zq7, so A8(d) can look for them on disk ----
const SPOT = Object.freeze({ page: 'zq7-board', tab: null, peek: 'zq7-kit-1', art: null, thread: null });
const hereMsg = (at = {}, visible = true) => ({ t: 'here', at: { ...SPOT, ...at }, visible });
const P = (id, name = 'zq7 Ann') => ({ 'x-devteam-person': `${id};name=${encodeURIComponent(name)}` });

async function until(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out after ${ms} ms: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ---- A8 (e): the contract and the fake say present is visible people only (the ruling) ----

// ---- the fixture: a real dashboard on a scratch fleet; its hub is real too (DEVTEAM_HUB_PORT) ----

const HUB_PORT = PORTS + 0;
let fixture = null;
// The dashboard, started once for the file (the first check that needs it waits for it).
function dashboard() {
  fixture ??= (async () => {
    const F = fleetFixture('presence');
    const env = F.env({ DEVTEAM_HUB_PORT: String(HUB_PORT) });
    const { dash, port } = await dashboardOnFreePort(F.old, env);
    const gitName = execFileSync('git', ['config', 'user.name'], { cwd: F.old, encoding: 'utf8' }).trim();
    return { F, dash, port, url: `http://127.0.0.1:${port}`, gitName, runDir: path.join(F.old, 'docs/devteam/run') };
  })();
  return fixture;
}
after(async () => {
  if (!fixture) return;
  const { F, dash } = await fixture;
  await dash.stop();
  F.done();
});

// A8 (d)'s look, for A7's parts (each on a dashboard of its own): with every connection closed, no
// path under run/ names presence, no file there holds a zq7 word, and the dashboard's output holds none.
async function nothingKept() {
  const { runDir, dash } = await dashboard();
  await closeEvery();
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.isFile() ? [path.join(d, e.name)] : []));
  const files = walk(runDir);
  assert.ok(files.length > 0, 'run/ has files to look in');
  for (const f of files) {
    const rel = path.relative(runDir, f);
    assert.ok(!/presence/i.test(rel), `no path under run/ names presence (${rel})`);
    assert.ok(!fs.readFileSync(f).includes('zq7'), `run/${rel} holds nothing of the test's presence`);
  }
  assert.ok(!dash.out().includes('zq7'), "the dashboard's output holds nothing of the test's presence");
}

// ---- the file's clients: every one through open(), which answers the relay's ping, and closed with its
// close awaited at the end of each check (closeEvery), so no check starts with another's connections ----

const clients = new Set();
async function open(url, opts = {}) {
  const c = await openPresence(url, opts);
  clients.add(c);
  let answered = 0;
  const pong = setInterval(() => {
    const pings = c.messages.filter((m) => m.t === 'ping').length;
    for (; answered < pings; answered++) c.send({ t: 'pong' });
  }, 500);
  pong.unref();
  c.closed.then(() => clearInterval(pong));
  return c;
}
async function closeEvery() {
  const all = [...clients];
  clients.clear();
  await Promise.all(all.map(async (c) => {
    c.close(1000);
    let timer;
    const late = new Promise((r) => { timer = setTimeout(r, 5000); });
    await Promise.race([c.closed, late]);
    clearTimeout(timer);
    c.destroy();
  }));
}
// Each check: its clients closed whatever happens in it.
const check = (fn) => async (t) => { try { await fn(t); } finally { await closeEvery(); } };

const json = (m) => Buffer.from(JSON.stringify(m));
async function closedWithin(c, ms = 5000) {
  let timer;
  const late = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`not closed within ${ms} ms`)), ms); });
  try { return await Promise.race([c.closed, late]); } finally { clearTimeout(timer); }
}
const kinds = (list, t) => list.filter((m) => m.t === t);
// `c`'s messages from index `mark` up to (not including) `msg`.
const between = (c, mark, msg) => { const i = c.messages.indexOf(msg); assert.ok(i >= mark, 'the sentinel came after the mark'); return c.messages.slice(mark, i); };

// The sentinel: `E` (which has said here at `at`) says here again with a fresh thread tag. A server
// handles one socket's messages in order, so the people naming the tag, which every watched client
// (each has said here) gets, comes after anything E sent before it, and after anything the server sent
// those clients before it. Resolves to each watched client's people.
let tags = 0;
async function sentinel(E, at, watched, ms = 5000) {
  const tag = `zq7-s${++tags}`;
  E.send(hereMsg({ ...at, thread: tag }));
  const hasTag = (m) => m.t === 'people' && m.people.some((p) => p.conns.some((x) => x.conn === E.you.conn && x.at.thread === tag));
  return Promise.all(watched.map((c) => c.next(hasTag, ms)));
}
const peopleWith = (n) => (m) => m.t === 'people' && m.people.length === n;
const peopleIds = (m) => m.people.map((p) => p.id);

// ---- A7 and A8: the limits, the ping, and the hello's present ----

// `n` people at the field limits, every field starting zq7: a 64-character id, a name of 80 JSON bytes
// (zq7, 38 escaped quotes, a), five 120-character at parts.
const padTo = (head, len, i) => `${head}${'x'.repeat(len - head.length - 3)}${String(i).padStart(3, '0')}`;
const limitZq7 = (n) => Array.from({ length: n }, (_, i) => ({
  id: padTo('zq7-p', 64, i),
  header: `zq7${'%22'.repeat(38)}a`,
  name: `zq7${'"'.repeat(38)}a`,
  at: { page: padTo('zq7-pg', 120, i), tab: padTo('zq7-tb', 120, i), peek: padTo('zq7-pk', 120, i), art: padTo('zq7-ar', 120, i), thread: padTo('zq7-th', 120, i) },
}));
// 200 at the field limits, all open first (only the first keeps its messages), then every here at once.
// Resolves to the clients and the first client's people listing all 200.
async function fill200(url) {
  const people = limitZq7(LIMITS.perServer);
  const cs = [];
  for (const [i, p] of people.entries()) {
    const c = await open(url, { headers: { 'x-devteam-person': `${p.id};name=${p.header}` }, keep: i === 0 });
    assert.ok(c.you, `client ${i} welcomed`);
    cs.push(c);
  }
  for (const [i, c] of cs.entries()) c.send({ t: 'here', at: people[i].at, visible: true });
  const p = await cs[0].next(peopleWith(LIMITS.perServer), 30000);
  assert.deepEqual(shapeErrors('people', p), []);
  return { cs, people, p };
}
// Nobody but a probe is on the server: its first people lists only itself.
async function onlyProbe(url) {
  const probe = await open(url, { headers: P('zq7-probe') });
  probe.send(hereMsg({ page: 'zq7-probe' }));
  const p = await probe.next((m) => m.t === 'people', 5000);
  assert.deepEqual(peopleIds(p), ['zq7-probe'], 'nobody else is connected');
  probe.close(1000);
  await closedWithin(probe);
  clients.delete(probe);
}

export { between, check, clients, closedWithin, closeEvery, dashboard, fill200, hereMsg, HUB_PORT, json, kinds, nothingKept, onlyProbe, open, P, peopleIds, peopleWith, sentinel, until };
