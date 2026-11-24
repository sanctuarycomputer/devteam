// The gateway's part of presence@1 (cloud/gateway.mjs, kit-632; test/contracts/presence.md §2): it
// forwards a /presence upgrade on a project's name and on the box's own, with a session and that
// name's Origin, says who the person is and at what level (never the browser's word), lets a View
// session hold it, and closes it when its session ends. The relay is the contract's fake, which
// enforces §2 to §7, behind an instance and a hub that record what reached them.
// Ports: hub +0, instances +1 (alpha) and +2 (devteam-dev, a project name shaped like a preview's).
// Run: node --test --test-concurrency=1 test/presence-gateway.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PORTS } from './lib/kit.mjs';
import { openPresence, startPresenceFake } from './lib/presence-fake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
delete process.env.DEVTEAM_CLAIM_TOKEN;
// imported after lib/kit.mjs has set the ports the gateway reads at load
const G = await import(pathToFileURL(path.join(repo, 'cloud', 'gateway.mjs')).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-presence-gw-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const HUB = PORTS;
const ALPHA = PORTS + 1;
const SHAPED = PORTS + 2;

const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (srv, port) => new Promise((ok, no) => { srv.once('error', no); srv.listen(port, '127.0.0.1', () => ok(srv.address().port)); });

// people@1's state, claimed: the owner, Ana (View) and Jo (Full), and a fresh session for each.
function seeded(dir) {
  const at = Date.now();
  const top = { id: 'k-owner', userId: 'u', jwk: {}, alg: -7, signCount: 0, name: 'passkey 1', rp: 'box.localhost', createdAt: new Date().toISOString() };
  const method = (key) => ({ id: `m-${key}`, type: 'passkey', key, label: 'passkey 1', added_at: new Date().toISOString(), last_used: null, data: { userId: 'u', jwk: {}, alg: -7, signCount: 0, rp: 'box.localhost' } });
  const row = (id, name, role, level, methods) => ({ id, name, role, level, methods, pushSubs: [], added_at: new Date().toISOString(), last_seen: null, notices: [], rev: 1 });
  const tok = () => crypto.randomBytes(32);
  const t = { owner: tok(), ana: tok(), jo: tok(), jo2: tok() };
  const s = { passkeys: [top], claimHash: null, sessions: [{ hash: u(sha(t.owner)), method: 'k-owner', at, expires: at + 3600e3 }],
    people: [row('p-owner', 'Owner Z', 'owner', 'full', []), row('p-ana', 'Ana', 'member', 'view', [method('ana')]), row('p-jo', 'Jo Ω', 'member', 'full', [method('jo')])],
    peopleSessions: [['ana', 'ana'], ['jo', 'jo'], ['jo2', 'jo']].map(([k, p]) => ({ hash: u(sha(t[k])), person: `p-${p}`, method: `m-${p}`, at, expires: at + 3600e3 })),
    invites: [], peopleStamp: u(sha('devteam-people-stamp-v1\nk-owner')) };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(s));
  return { cookies: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, `devteam_session=${u(v)}`])), hashes: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, u(sha(v))])) };
}

// A server that records each upgrade and hands it to the fake relay, Host and Origin said for its port.
async function recorder(port, { json = { ok: true }, hub = false } = {}) {
  let gate = null;
  const fake = await startPresenceFake({ hub });
  const ups = [];
  let silent = false;
  const open = new Set();
  const srv = http.createServer(async (q, r) => { q.resume(); await gate; r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(json)); });
  srv.on('connection', (c) => { open.add(c); c.on('close', () => open.delete(c)); });
  srv.on('upgrade', (q, sock) => {
    sock.on('error', () => {});
    ups.push({ url: q.url, raw: q.rawHeaders, h: q.headers });
    if (silent) return;
    const back = net.connect(fake.port, '127.0.0.1');
    back.on('error', () => sock.destroy());
    sock.on('close', () => back.destroy());
    back.on('close', () => sock.destroy());
    const lines = [];
    for (let i = 0; i < q.rawHeaders.length; i += 2) lines.push(`${q.rawHeaders[i]}: ${q.rawHeaders[i + 1].replace(`127.0.0.1:${port}`, `127.0.0.1:${fake.port}`)}`);
    back.write(`${q.method} ${q.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    sock.pipe(back);
    // the answer carries a cookie and the gateway's own headers, which must not pass
    back.once('data', (d) => { sock.write(d.toString('latin1').replace('\r\n', '\r\nset-cookie: devteam_session=evil\r\nx-devteam-public: {}\r\n'), 'latin1'); back.pipe(sock); });
  });
  await listen(srv, port);
  return { ups, fake, gate: (p) => { gate = p; }, hush: (v) => { silent = v; }, srv, drop: () => { for (const c of open) c.destroy(); }, close: async () => { for (const c of open) c.destroy(); await new Promise((r) => srv.close(r)); await fake.close(); } };
}

async function box(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, 'box-'));
  const { cookies, hashes } = seeded(dir);
  const alpha = await recorder(ALPHA);
  const shaped = await recorder(SHAPED);
  const listed = [['alpha', ALPHA], ['devteam-dev', SHAPED]].map(([name, port]) => ({ devteam: 1, root: `/srv/${name}`, port, name, previews: [] }));
  const hub = await recorder(HUB, { hub: true, json: { hub: 1, instances: listed } });
  const ttyd = net.createServer((c) => { c.on('error', () => {}); c.once('data', () => c.write('HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n')); });
  const ttydPort = await listen(ttyd, 0);
  const probe = net.createServer();
  const port = await listen(probe, 0);
  await new Promise((r) => probe.close(r));
  const uploadsDir = path.join(dir, 'uploads');
  fs.mkdirSync(uploadsDir, { mode: 0o750 });
  const ttydPage = path.join(dir, 'ttyd.html');
  fs.writeFileSync(ttydPage, 'ttyd');
  const g = G.createGateway({ publicUrl: `http://box.localhost:${port}`, dir, ttydPort, ttydPage, uploadsDir, hubPage: path.join(repo, 'docs/devteam/dashboard/hub.html'), log: () => {}, ...opts });
  const held = new Set();
  g.server.on('connection', (c) => { held.add(c); c.on('close', () => held.delete(c)); });
  await listen(g.server, port);
  const host = `box.localhost:${port}`;
  let stopping = null;
  const stop = () => (stopping ??= (async () => {
    for (const c of held) c.destroy();
    await new Promise((r) => g.server.close(r));
    ttyd.close();
    for (const x of [alpha, shaped, hub]) await x.close();
  })());
  t.after(stop);
  const file = path.join(dir, 'state.json');
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = (s) => { fs.writeFileSync(`${file}.t`, JSON.stringify(s)); fs.renameSync(`${file}.t`, file); };
  // a handshake on a name of the box, through the contract's own client
  const up = (name, { as = null, origin, route = '/presence', headers = {} } = {}) => {
    const h = name ? `${name}.${host}` : host;
    const asked = openPresence(`http://127.0.0.1:${port}`, { host: h, origin: origin === undefined ? `http://${h}` : origin, path: route, headers: { ...(as ? { cookie: cookies[as] } : {}), ...headers } });
    // a socket the gateway lets through to something that never welcomes: a status of its own
    return Promise.race([asked, sleep(3000).then(() => ({ status: 'no answer in 3 s' }))]);
  };
  const post = (as, route, body) => new Promise((resolve, reject) => {
    const b = JSON.stringify(body ?? {});
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: route, headers: { host, origin: `http://${host}`, cookie: cookies[as], 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) } }, (res) => { let x = ''; res.on('data', (d) => { x += d; }); res.on('end', () => resolve({ status: res.statusCode, body: x })); });
    r.on('error', reject);
    r.end(b);
  });
  const row = (id) => state().people.find((p) => p.id === id);
  return { stop, held, alpha, shaped, hub, listed, file, up, post, state, write, row, hashes, host, port, cookies };
}
const opened = (c, what) => { assert.equal(c.status, 101, `${what}: opened (${c.status})`); assert.ok(c.you, `${what}: welcomed`); return c; };
const only = (raw, name) => raw.filter((v, i) => i % 2 === 0 && v.toLowerCase() === name).length;
const FORGED = { 'x-devteam-person': 'p-owner;name=Boss', 'x-devteam-level': 'full' };

const NAMES = [['alpha', 'alpha'], ['devteam-dev', 'shaped'], [null, 'hub']];
test('presence A9: a signed-in upgrade reaches its own upstream with the gateway\'s person and level', async (t) => {
  const B = await box(t);
  for (const [name, at] of NAMES) {
    const c = opened(await B.up(name, { as: 'jo', route: '/presence?x=1' }), at);
    assert.equal(c.you.id, 'p-jo', `${at}: the relay was told Jo`);
    const r = B[at].ups.at(-1);
    assert.equal(r.url, '/presence?x=1');
    assert.equal(r.h['x-devteam-person'], `p-jo;name=${encodeURIComponent('Jo Ω')}`);
    assert.equal(r.h['x-devteam-level'], 'full');
    assert.equal(r.h.cookie, undefined, `${at}: no session cookie goes on`);
    assert.equal(c.headers['set-cookie'], undefined, `${at}: the upstream sets no session`);
    assert.equal(c.headers['x-devteam-public'], undefined, `${at}: nor the gateway's own headers`);
    c.destroy();
  }
});
test('presence A9: the browser\'s person and level never pass, once or twice over', async (t) => {
  const B = await box(t);
  for (const headers of [FORGED, { 'X-Devteam-Person': ['p-owner;name=A', 'p-owner;name=B'], 'X-Devteam-Level': ['full', 'full'] }]) {
    for (const [name, at] of NAMES) {
      const c = opened(await B.up(name, { as: 'ana', headers }), at);
      assert.equal(c.you.id, 'p-ana', `${at}: Ana stays Ana`);
      const r = B[at].ups.at(-1);
      assert.deepEqual([r.h['x-devteam-person'], r.h['x-devteam-level']], ['p-ana;name=Ana', 'view']);
      assert.deepEqual([only(r.raw, 'x-devteam-person'), only(r.raw, 'x-devteam-level')], [1, 1]);
      c.destroy();
    }
  }
});
test('presence A9: the owner from before people has no header, and a forged one still never passes', async (t) => {
  const B = await box(t);
  const { people, peopleSessions, peopleStamp, ...before } = B.state();
  B.write(before);
  for (const [name, at] of NAMES) {
    const c = opened(await B.up(name, { as: 'owner', headers: FORGED }), at);
    assert.equal(c.you.id, 'owner', `${at}: the relay's own owner`);
    const r = B[at].ups.at(-1);
    assert.deepEqual([only(r.raw, 'x-devteam-person'), only(r.raw, 'x-devteam-level')], [0, 0], `${at}: none passed`);
    c.destroy();
  }
});
test('presence A9: 401 without a session, 403 from another Origin or none, and nothing reaches the upstream', async (t) => {
  const B = await box(t);
  for (const [name, at] of NAMES) {
    assert.equal((await B.up(name)).status, 401, `${at}: signed out`);
    assert.equal((await B.up(name, { headers: { cookie: 'devteam_session=AAAA' } })).status, 401, `${at}: a bad cookie`);
    for (const origin of ['http://evil.example', `http://term.${B.host}`, `https://${B.host}`, name ? `http://${B.host}` : `http://alpha.${B.host}`, 'null', null]) {
      assert.equal((await B.up(name, { as: 'jo', origin })).status, 403, `${at}: Origin ${origin}`);
    }
    assert.equal(B[at].ups.length, 0, `${at}: untouched`);
  }
});
test('presence A10: a View session holds presence and still can\'t upgrade the terminal', async (t) => {
  const B = await box(t);
  for (const [name, at] of NAMES) {
    const c = opened(await B.up(name, { as: 'ana' }), at);
    assert.equal(B[at].ups.at(-1).h['x-devteam-level'], 'view');
    c.destroy();
  }
  assert.equal((await B.up('term', { as: 'ana', route: '/ws' })).status, 403, 'the terminal socket');
  assert.equal((await B.up('term', { as: 'ana' })).status, 403, 'nor /presence on the terminal\'s name');
  assert.equal((await B.up('cool-tiger', { as: 'ana' })).status, 403, 'nor a preview\'s socket');
});
test('presence: an upstream that answers anything but 101 is a refusal, and nothing more of the browser\'s reaches it', async (t) => {
  const B = await box(t);
  const got = [];
  const held = new Set();
  // a server with no upgrade listener, as a kit from before presence is: it answers and reads on
  const old = http.createServer((q, r) => { got.push(q.method + ' ' + q.url); q.resume(); r.writeHead(404, { 'content-length': 2 }); r.end('no'); });
  old.on('connection', (c) => { held.add(c); });
  await new Promise((r) => B.alpha.srv.close(r) && B.alpha.drop());
  await listen(old, ALPHA);
  try {
    const smuggled = 'POST /api/answer HTTP/1.1\r\nhost: 127.0.0.1\r\nx-devteam-person: p-owner;name=Boss\r\nx-devteam-level: full\r\ncontent-length: 0\r\n\r\n';
    const say = (method) => `${method} /presence HTTP/1.1\r\nhost: alpha.${B.host}\r\norigin: http://alpha.${B.host}\r\ncookie: ${B.cookies.ana}\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`;
    for (const early of [true, false]) {
      const answer = await new Promise((resolve) => {
        const c = net.connect(B.port, '127.0.0.1', () => c.write(say('GET') + (early ? smuggled : '')));
        let x = '';
        c.on('error', () => {});
        c.on('data', (d) => { x += d; if (!early) c.write(smuggled); });
        c.on('close', () => resolve(x));
        setTimeout(() => c.destroy(), 1500);
      });
      await sleep(200);
      assert.deepEqual(got.filter((x) => x.startsWith('POST')), [], early ? 'nothing sent with the handshake went on' : 'nothing sent after the answer went on');
      assert.match(answer, /^HTTP\/1\.1 404 /, 'the browser is told its status');
      assert.equal((answer.match(/HTTP\/1\.1/g) ?? []).length, 1, 'and nothing after it');
    }
  } finally { for (const c of held) c.destroy(); await new Promise((r) => old.close(r)); }
});
// a raw upstream on alpha's port that answers each connection with what `say` gives; and a handshake
const rawAlpha = async (B, say) => {
  await new Promise((r) => B.alpha.srv.close(r) && B.alpha.drop());
  const x = { bytes: '', open: new Set() };
  const srv = net.createServer((c) => { x.open.add(c); c.on('close', () => x.open.delete(c)); c.on('error', () => {}); c.on('data', (d) => { if (!x.bytes) c.write(say()); x.bytes += d; }); });
  await listen(srv, ALPHA);
  x.close = async () => { for (const c of x.open) c.destroy(); await new Promise((r) => srv.close(r)); };
  return x;
};
const rawAsk = (B, extra = '') => {
  const c = net.connect({ port: B.port, host: '127.0.0.1', allowHalfOpen: true }, () => c.write(`GET /presence HTTP/1.1\r\nhost: alpha.${B.host}\r\norigin: http://alpha.${B.host}\r\ncookie: ${B.cookies.ana}\r\nconnection: Upgrade\r\nupgrade: websocket\r\n${extra}sec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\nEARLY`));
  const x = { c, text: '', gone: false };
  c.on('error', () => {});
  c.on('data', (d) => { x.text += d; });
  c.on('close', () => { x.gone = true; });
  return x;
};
test('presence: no status but 101 opens it, an interim 1xx or a 101 in the reason included, and both sides end', async (t) => {
  for (const [line, told] of [['100 Continue', '502'], ['103 Early Hints', '502'], ['200 101', '502'], ['1010 Odd', '502'], ['302 Found', '502'], ['404 Not Found', '404']]) {
    const B = await box(t);
    const up = await rawAlpha(B, () => `HTTP/1.1 ${line}\r\n\r\n`);
    let beat = null;
    try {
      const q = rawAsk(B, 'expect: 100-continue\r\n');
      beat = setInterval(() => q.c.write('LATER'), 100);
      for (let i = 0; i < 40 && !q.text; i++) await sleep(25);
      assert.match(q.text, new RegExp(`^HTTP/1\\.1 ${told} `), line);
      await sleep(300);
      assert.ok(!/EARLY|LATER/.test(up.bytes), `${line}: nothing past the handshake went on`);
      assert.equal(up.open.size, 0, `${line}: the upstream's side ended`);
    } finally { clearInterval(beat); await up.close(); }
    await B.stop();
  }
});
test('presence: a refused browser that keeps its half open is let go', async (t) => {
  const B = await box(t);
  const held0 = B.held.size;
  const c = net.connect({ port: B.port, host: '127.0.0.1', allowHalfOpen: true }, () => c.write(`GET /presence HTTP/1.1\r\nhost: alpha.${B.host}\r\norigin: http://evil.example\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n`));
  c.on('error', () => {});
  c.resume();
  for (let i = 0; i < 40 && B.held.size <= held0; i++) await sleep(25);
  await sleep(1500);
  assert.equal(B.held.size, held0, 'the gateway holds no socket of it');
  c.destroy();
});
test('presence: an open one outlives the answer limit, and what came with the handshake follows its 101', async (t) => {
  const B = await box(t, { presenceAnswerMs: 300 });
  const up = await rawAlpha(B, () => 'HTTP/1.1 101 Switching Protocols\r\nconnection: Upgrade\r\nupgrade: websocket\r\n\r\n');
  try {
    const q = rawAsk(B);
    await sleep(800);
    assert.match(q.text, /^HTTP\/1\.1 101 /);
    assert.equal(q.gone || q.c.readableEnded, false, 'still open past the limit');
    assert.ok(up.bytes.endsWith('EARLY'), 'the early bytes followed');
    q.c.destroy();
  } finally { await up.close(); }
});
test('presence A9: a person header with a space before its colon is no header', async (t) => {
  const B = await box(t);
  const c = await B.up('alpha', { as: 'ana', headers: { 'X-Devteam-Person ': 'p-owner;name=A', 'X-Devteam-Level ': 'full' } });
  // a newer Node refuses the request itself, and the gateway's clientError drops the socket
  if (c.status !== 101) return assert.deepEqual([c.status, B.alpha.ups.length], [undefined, 0], 'refused, and nothing went on');
  assert.equal(B.alpha.ups.at(-1).raw.filter((v, i) => i % 2 === 0 && /^x-devteam-(person|level)$/i.test(v.trim())).length, 2, 'only the gateway\'s own two');
  c.destroy();
});
test('presence: what the browser sends with its handshake waits for the 101, and only a GET is one', async (t) => {
  const B = await box(t, { presenceAnswerMs: 400 });
  await new Promise((r) => B.alpha.srv.close(r) && B.alpha.drop());
  let bytes = '';
  const held = new Set();
  const raw = net.createServer((c) => { held.add(c); c.on('error', () => {}); c.on('data', (d) => { bytes += d; }); });
  await listen(raw, ALPHA);
  const ask = (method) => new Promise((resolve) => {
    const c = net.connect(B.port, '127.0.0.1', () => c.write(`${method} /presence HTTP/1.1\r\nhost: alpha.${B.host}\r\norigin: http://alpha.${B.host}\r\ncookie: ${B.cookies.ana}\r\nconnection: Upgrade\r\nupgrade: websocket\r\nsec-websocket-version: 13\r\nsec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\nEARLY`));
    let x = '';
    c.on('error', () => {});
    c.on('data', (d) => { x += d; });
    c.on('close', () => resolve(x));
    setTimeout(() => c.destroy(), 1500);
  });
  try {
    assert.equal(await ask('GET'), '', 'given up with no answer');
    assert.match(bytes, /^GET \/presence HTTP\/1\.1\r\n/);
    assert.ok(!bytes.includes('EARLY'), 'nothing past the handshake went on');
    bytes = '';
    assert.match(await ask('POST'), /^HTTP\/1\.1 421 /, 'a POST is no handshake');
    assert.equal(bytes, '', 'and went nowhere');
  } finally { for (const c of held) c.destroy(); await new Promise((r) => raw.close(r)); }
});
test('presence: an upstream that never answers is given up', async (t) => {
  const B = await box(t, { presenceAnswerMs: 300 });
  B.alpha.hush(true);
  assert.equal((await B.up('alpha', { as: 'jo' })).status, undefined, 'closed with no answer');
  assert.equal(B.alpha.ups.length, 1);
});
test('presence: a person the header can\'t carry is 500, a shared name 421, an unclaimed box 401', async (t) => {
  const B = await box(t);
  const s = B.state();
  B.write({ ...s, people: s.people.map((p) => (p.id === 'p-jo' ? { ...p, name: 7 } : p)) });
  assert.equal((await B.up('alpha', { as: 'jo' })).status, 500, 'the bad row');
  B.write(s);
  B.listed.push({ ...B.listed[0], root: '/srv/alpha2', port: SHAPED });
  B.listed.splice(1, 1);
  assert.equal((await B.up('alpha', { as: 'jo' })).status, 421, 'the shared name');
  B.write({ ...s, passkeys: [], peopleStamp: u(sha('devteam-people-stamp-v1\n')) });
  assert.equal((await B.up('alpha', { as: 'owner' })).status, 401, 'unclaimed');
  assert.equal(B.alpha.ups.length, 0, 'none went on');
});
test('presence: any other path is still 421 on a project\'s name and the box\'s, and no reading of it but the exact one passes', async (t) => {
  const B = await box(t);
  for (const [name, at] of [['alpha', 'alpha'], ['devteam-dev', 'shaped'], [null, 'hub']]) {
    opened(await B.up(name, { as: 'owner' }), at).destroy();
    B[at].ups.length = 0;
    for (const route of ['/', '/ws', '/api/data', '/presence/', '/presence/x', '/presences', '/PRESENCE', '//presence', '/a/../presence', '/%70resence', '/x?/presence']) {
      assert.equal((await B.up(name, { as: 'owner', route })).status, 421, `${at} ${route}`);
    }
    assert.equal(B[at].ups.length, 0, `${at}: untouched`);
  }
  for (const name of ['nosuch', 'a.alpha', 'public', 'www']) assert.equal((await B.up(name, { as: 'owner' })).status, 421, `${name} is no project's name`);
});
