// The browser's egress guard (browser@1; design supervisors-can-use-a-browser-with-the-o, §1): a
// loopback forward proxy that refuses every destination on this machine's own network, so the
// supervisor's Chrome can never load a dashboard and press an owner button. Each test starts the
// guard as its own process (`devteam.mjs browser-guard`) and asks it through a raw socket, spelling
// every request head itself.
//
// The machine is faked by a stub the test writes into its own temp dir and preloads with
// `node --require`: it patches os.networkInterfaces, dns.lookup and net.connect on the module
// objects the kit's default imports share, so the guard carries no test hook of its own. The stub
// never lets the guard reach the real network: a dial goes to the test's own servers or fails.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { schema, validate, refusalOf } from './fixtures/browser/check.mjs';
import { startSites } from './lib/sites.mjs';
import { PORTS } from './lib/ports.mjs';

// GUARD_TEST_KIT points the file at a scratch copy of the kit (the final review's range mutation).
const KIT = process.env.GUARD_TEST_KIT || fileURLToPath(new URL('../docs/devteam/scripts/devteam.mjs', import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-guard-'));
const children = new Set();
after(() => {
  for (const c of children) try { c.kill(); } catch {}
  fs.rmSync(TMP, { recursive: true, force: true });
});

const STUB = String.raw`
const fs = require('fs'), os = require('os'), dns = require('dns'), net = require('net');
const E = process.env;
const rec = (o) => { if (E.GUARD_STUB_RECORD) fs.appendFileSync(E.GUARD_STUB_RECORD, JSON.stringify(o) + '\n'); };
if (E.GUARD_STUB_IFACES_FILE) os.networkInterfaces = () => JSON.parse(fs.readFileSync(E.GUARD_STUB_IFACES_FILE, 'utf8'));
else if (E.GUARD_STUB_IFACES) os.networkInterfaces = () => JSON.parse(E.GUARD_STUB_IFACES);
const DNS = JSON.parse(E.GUARD_STUB_DNS || '{}');
const seen = {};
const realLookup = dns.lookup;
dns.lookup = function (name, opts, cb) {
  // every name the test doesn't fake goes to the real lookup with the caller's own arguments
  if (!Object.prototype.hasOwnProperty.call(DNS, name)) return realLookup.apply(this, arguments);
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  rec({ lookup: name });
  const list = DNS[name];
  seen[name] = (seen[name] ?? -1) + 1;
  const a = list[Math.min(seen[name], list.length - 1)];
  process.nextTick(() => {
    const nf = () => { const e = new Error('getaddrinfo ENOTFOUND ' + name); e.code = 'ENOTFOUND'; return e; };
    if (a === 'ENOTFOUND') return cb(nf());
    if (opts && opts.all) return cb(null, a);
    if (!a.length) return cb(nf());
    cb(null, a[0].address, a[0].family);
  });
};
const DIAL = JSON.parse(E.GUARD_STUB_DIAL || '{}');
const OK = new Set(String(E.GUARD_STUB_LOOPBACK_OK || '').split(',').filter(Boolean).map(Number));
const realConnect = net.connect;
const refused = (host, port) => {
  const s = new net.Socket();
  process.nextTick(() => { const e = new Error('connect ECONNREFUSED ' + host + ':' + port); e.code = 'ECONNREFUSED'; s.destroy(e); });
  return s;
};
net.connect = function (...args) {
  const o = args[0] !== null && typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
  const host = o.host, port = Number(o.port);
  if (!net.isIP(String(host))) throw new Error('stub: dial of a name ' + host);
  rec({ dial: host, port });
  const d = DIAL[host];
  if (d === 'ECONNREFUSED') return refused(host, port);
  if (d) { const i = d.lastIndexOf(':'); return realConnect.call(net, { host: d.slice(0, i), port: Number(d.slice(i + 1)) }); }
  if ((/^127\./.test(host) || host === '::1') && OK.has(port)) return realConnect.call(net, { host, port });
  return refused(host, port);
};
`;
const STUB_PATH = path.join(TMP, 'stub.cjs');
fs.writeFileSync(STUB_PATH, STUB);

let runs = 0;
// The guard on its own, as browser serve will start it: { port, record(), stop() }.
async function startGuard({ env = {}, stub = false } = {}) {
  const dir = path.join(TMP, `run-${++runs}`);
  fs.mkdirSync(dir);
  const recordFile = path.join(dir, 'record.jsonl');
  const childEnv = { PATH: process.env.PATH, HOME: dir, DEVTEAM_PROJECT: dir, ...(stub ? { GUARD_STUB_RECORD: recordFile } : {}), ...env };
  const child = spawn(process.execPath, [...(stub ? ['--require', STUB_PATH] : []), KIT, 'browser-guard'], { cwd: dir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let errText = '';
  child.stderr.on('data', (d) => { errText += d; });
  const port = await new Promise((resolve, reject) => {
    let outText = '';
    const t = setTimeout(() => reject(new Error(`the guard didn't start in 10 s: ${errText}`)), 10000);
    child.stdout.on('data', (d) => {
      outText += d;
      const nl = outText.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(t);
      try {
        const line = JSON.parse(outText.slice(0, nl));
        assert.equal(line.browser, 1);
        assert.ok(Number.isInteger(line.port) && line.port > 0, `a port: ${outText}`);
        resolve(line.port);
      } catch (e) { reject(e); }
    });
    child.once('exit', (code) => { clearTimeout(t); reject(new Error(`the guard exited ${code}: ${errText}`)); });
  });
  const record = () => { try { return fs.readFileSync(recordFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill();
  });
  return { port, child, record, stop, stderr: () => errText };
}

function dechunk(body) {
  let out = Buffer.alloc(0);
  let rest = body;
  for (;;) {
    const i = rest.indexOf('\r\n');
    if (i < 0) break;
    const n = parseInt(rest.subarray(0, i).toString('latin1'), 16);
    if (!n) break;
    out = Buffer.concat([out, rest.subarray(i + 2, i + 2 + n)]);
    rest = rest.subarray(i + 2 + n + 2);
  }
  return out;
}
// status, headers (names lowercased, repeats joined with ", "), body (dechunked); for a tunnel's
// 200, what came through it as inner.
function parse(buf, tunnelled) {
  const i = buf.indexOf('\r\n\r\n');
  if (i < 0) return { status: 0, headers: {}, body: buf.toString('utf8'), head: buf.toString('latin1') };
  const head = buf.subarray(0, i).toString('latin1');
  const [line, ...rest] = head.split('\r\n');
  const headers = {};
  for (const h of rest) {
    const c = h.indexOf(':');
    const k = h.slice(0, c).trim().toLowerCase();
    const v = h.slice(c + 1).trim();
    headers[k] = k in headers ? `${headers[k]}, ${v}` : v;
  }
  const status = Number(line.split(' ')[1]);
  let body = buf.subarray(i + 4);
  if (tunnelled && status === 200) return { status, headers, head, body: '', inner: parse(body, false) };
  if (/chunked/i.test(headers['transfer-encoding'] ?? '')) body = dechunk(body);
  return { status, headers, head, body: body.toString('utf8') };
}
// One raw request to the guard, read until the socket ends (5 s at most). then: a request head
// written into the tunnel once a CONNECT's 200 arrives.
function ask(port, raw, { then } = {}) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1');
    let buf = Buffer.alloc(0);
    let sent = false;
    const done = () => { clearTimeout(t); resolve(parse(buf, !!then)); };
    const t = setTimeout(() => { s.destroy(); reject(new Error(`no answer in 5 s to ${raw.split('\r\n')[0]}: ${buf.toString('latin1').slice(0, 200)}`)); }, 5000);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (then && !sent && buf.indexOf('\r\n\r\n') >= 0 && /^HTTP\/1\.1 200 /.test(buf.toString('latin1', 0, 13))) { sent = true; s.write(then); }
    });
    s.on('error', (e) => { if (buf.length) done(); else { clearTimeout(t); reject(e); } });
    s.on('end', done);
    s.write(raw);
  });
}
const headLines = (h) => Object.entries(h).map(([k, v]) => `${k}: ${v}\r\n`).join('');
function hostOf(target) { try { return new URL(target).host; } catch { return 'x.test'; } }
const get = (port, target, headers = {}) => ask(port, `GET ${target} HTTP/1.1\r\n${headLines({ Host: hostOf(target), Connection: 'close', ...headers })}\r\n`);
const connect = (port, authority, then) => ask(port, `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nConnection: close\r\n\r\n`, { then });
const inner = (host, p = '/account') => `GET ${p} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;

// The refusal object of an answer, checked against browser@1 and the page's own headers.
function refusal(r) {
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8', r.head);
  assert.equal(r.headers.connection, 'close', r.head);
  const o = refusalOf(r.body);
  assert.ok(o, `no #devteam-refusal in: ${r.body.slice(0, 300)}`);
  assert.deepEqual(validate('refusal', o), []);
  return o;
}
// An IP literal as the guard reports it: what WHATWG URL makes of it, without brackets.
const norm = (host) => new URL(`http://${host}/`).hostname.replace(/^\[|\]$/g, '');
const normAddr = (a) => (a.includes(':') ? norm(`[${a.split('%')[0]}]`) : norm(a));
const ownAddrs = () => new Set(Object.values(os.networkInterfaces()).flat().map((e) => normAddr(e.address)));
const LO_ONLY = JSON.stringify({ lo: [{ address: '127.0.0.1', family: 'IPv4' }, { address: '::1', family: 'IPv6' }] });

// ---- Task 1: the decision, the refusal and the command ----

const A1_ADDRESSES = {
  '127.0.0.1': '127.0.0.0/8', '127.1': '127.0.0.0/8', 2130706433: '127.0.0.0/8', '0x7f.1': '127.0.0.0/8',
  '[::]': '::/128', '[::1]': '::1/128', '[::ffff:127.0.0.1]': '::ffff:0:0/96', '[64:ff9b::7f00:1]': '64:ff9b::/96',
  '0.0.0.0': '0.0.0.0/8', '10.1.2.3': '10.0.0.0/8', '100.64.0.1': '100.64.0.0/10', '172.16.0.1': '172.16.0.0/12',
  '192.0.0.1': '192.0.0.0/24', '192.168.1.1': '192.168.0.0/16', '198.18.0.1': '198.18.0.0/15', '169.254.169.254': '169.254.0.0/16',
  '224.0.0.1': '224.0.0.0/4', '[fe80::1]': 'fe80::/10', '[fd00::1]': 'fc00::/7', '[2002:7f00:1::1]': '2002::/16',
  '[2001:0:4136:e378:8000:63bf:3fff:fdd2]': '2001::/32',
};
const HOSTNAME = os.hostname().toLowerCase();
const A1_NAMES = {
  localhost: 'own-name', 'a.localhost': 'own-name', [HOSTNAME]: 'own-name',
  'LOCALHOST.': 'own-name', 'A.LOCALHOST.': 'own-name', [`${HOSTNAME.toUpperCase()}.`]: 'own-name',
  'box.example.test': 'gateway', 'x.box.example.test': 'gateway', 'box.example.test.': 'gateway', 'X.Box.Example.Test.': 'gateway',
};

test('A1: every listed host is refused, by GET and by CONNECT, with its rule', async () => {
  const g = await startGuard({ env: { DEVTEAM_PUBLIC_URL: 'https://box.example.test' } });
  try {
    const own = ownAddrs();
    for (const [host, range] of Object.entries(A1_ADDRESSES)) {
      const address = norm(host);
      for (const [how, r, asked] of [['GET', await get(g.port, `http://${host}/`), host], ['CONNECT', await connect(g.port, `${host}:443`), `${host}:443`]]) {
        assert.equal(r.status, 403, `${how} ${host}: ${r.head}`);
        const o = refusal(r);
        assert.equal(o.host, asked, `${how} ${host}`);
        assert.equal(o.address, address, `${how} ${host}`);
        if (own.has(address)) assert.equal(o.rule, 'own-interface', `${how} ${host}`);
        else assert.deepEqual([o.rule, o.range], ['special-purpose', range], `${how} ${host}`);
      }
    }
    for (const [host, rule] of Object.entries(A1_NAMES)) {
      for (const [how, r, asked] of [['GET', await get(g.port, `http://${host}/`), host], ['CONNECT', await connect(g.port, `${host}:443`), `${host}:443`]]) {
        assert.equal(r.status, 403, `${how} ${host}: ${r.head}`);
        const o = refusal(r);
        assert.equal(o.rule, rule, `${how} ${host}`);
        assert.equal(o.host, asked, `${how} ${host}`);
        assert.ok(!('address' in o) && !('range' in o), `${how} ${host}: a name rule names no address`);
      }
    }
  } finally { await g.stop(); }
});

// One address inside each refused range of the contract and inside no narrower one.
const SAMPLES = {
  '127.0.0.0/8': '127.9.9.9', '0.0.0.0/8': '0.1.2.3', '10.0.0.0/8': '10.9.9.9', '172.16.0.0/12': '172.20.1.1',
  '192.168.0.0/16': '192.168.9.9', '169.254.0.0/16': '169.254.9.9', '100.64.0.0/10': '100.100.1.1', '192.0.0.0/24': '192.0.0.9',
  '198.18.0.0/15': '198.19.1.1', '224.0.0.0/4': '230.1.1.1', '::/128': '::', '::1/128': '::1', 'fc00::/7': 'fd12::1',
  'fe80::/10': 'fe80::9', '64:ff9b::/96': '64:ff9b::808:808', '::ffff:0:0/96': '::ffff:8.8.8.8', '192.0.2.0/24': '192.0.2.9',
  '192.31.196.0/24': '192.31.196.9', '192.52.193.0/24': '192.52.193.9', '192.88.99.0/24': '192.88.99.9',
  '192.175.48.0/24': '192.175.48.9', '198.51.100.0/24': '198.51.100.9', '203.0.113.0/24': '203.0.113.9',
  '240.0.0.0/4': '250.1.1.1', '255.255.255.255/32': '255.255.255.255', '64:ff9b:1::/48': '64:ff9b:1::9', '100::/64': '100::9',
  '2001::/23': '2001:100::1', '2001::/32': '2001:0:1::1', '2001:db8::/32': '2001:db8::9', '2002::/16': '2002:808:808::1',
  '2620:4f:8000::/48': '2620:4f:8000::9', '3fff::/20': '3fff::9', '5f00::/16': '5f00::9', 'ff00::/8': 'ff02::1',
  '::/3': '1000::1', '4000::/2': '4000::1', '8000::/1': '8000::1',
};

test('A2: one sample per contract range is refused with exactly that range', async () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...schema.$defs.shapes.refusal.properties.range.enum].sort(), 'a sample for every range the contract names, and no other');
  const g = await startGuard({ stub: true, env: { GUARD_STUB_IFACES: '{}' } });
  try {
    for (const [range, sample] of Object.entries(SAMPLES)) {
      const host = sample.includes(':') ? `[${sample}]` : sample;
      const r = await get(g.port, `http://${host}/`);
      assert.equal(r.status, 403, `${sample}: ${r.head}`);
      const o = refusal(r);
      assert.deepEqual([o.rule, o.range, o.address], ['special-purpose', range, norm(host)], sample);
    }
  } finally { await g.stop(); }
});

test('A3: an own public address is refused by own-interface, read on every request', async () => {
  const ifaces = { lo: [{ address: '127.0.0.1', family: 'IPv4' }], eth0: [{ address: '203.0.113.7', family: 'IPv4' }] };
  const g = await startGuard({ stub: true, env: { GUARD_STUB_IFACES: JSON.stringify(ifaces) } });
  try {
    for (const r of [await get(g.port, 'http://203.0.113.7/'), await connect(g.port, '203.0.113.7:443')]) {
      assert.equal(r.status, 403, r.head);
      const o = refusal(r);
      assert.deepEqual([o.rule, o.address], ['own-interface', '203.0.113.7']);
    }
  } finally { await g.stop(); }
  // read per request: the same guard sees the address arrive
  const file = path.join(TMP, 'ifaces.json');
  fs.writeFileSync(file, LO_ONLY);
  const h = await startGuard({ stub: true, env: { GUARD_STUB_IFACES_FILE: file } });
  try {
    assert.equal(refusal(await get(h.port, 'http://203.0.113.7/')).rule, 'special-purpose');
    fs.writeFileSync(file, JSON.stringify(ifaces));
    assert.equal(refusal(await get(h.port, 'http://203.0.113.7/')).rule, 'own-interface');
  } finally { await h.stop(); }
});

test('A5: a request that is not a proxy request gets 400', async () => {
  const g = await startGuard();
  try {
    const heads = [
      'GET / HTTP/1.1\r\nHost: x.test\r\nConnection: close\r\n\r\n',
      'GET https://example.test/ HTTP/1.1\r\nHost: example.test\r\nConnection: close\r\n\r\n',
      'CONNECT example.test HTTP/1.1\r\nHost: example.test\r\nConnection: close\r\n\r\n',
      'CONNECT user@example.test:443 HTTP/1.1\r\nHost: example.test\r\nConnection: close\r\n\r\n',
      'CONNECT 10.0.0.1\\x:443 HTTP/1.1\r\nHost: example.test\r\nConnection: close\r\n\r\n',
    ];
    for (const raw of heads) {
      const r = await ask(g.port, raw);
      assert.equal(r.status, 400, `${raw.split('\r\n')[0]}: ${r.head}`);
      assert.equal(refusal(r).rule, 'not-a-proxy-request', raw.split('\r\n')[0]);
    }
  } finally { await g.stop(); }
});

test('a host the contract can\'t carry is named in its allowed characters', async () => {
  const g = await startGuard();
  const long = `${Array(5).fill('x'.repeat(60)).join('.')}.localhost`;
  try {
    for (const [host, named] of [['a_b.localhost', 'a_b.localhost'], ['a!b.localhost', 'a-b.localhost'], ['a$b.localhost', 'a-b.localhost'], [long, long.slice(0, 255)]]) {
      for (const r of [await get(g.port, `http://${host}/`), await connect(g.port, `${host}:443`)]) {
        assert.equal(r.status, 403, `${host.slice(0, 40)}: ${r.head}`);
        const o = refusal(r);
        assert.equal(o.rule, 'own-name');
        assert.ok(o.host.startsWith(named.slice(0, 200)), `${o.host.slice(0, 40)} for ${host.slice(0, 40)}`);
      }
    }
  } finally { await g.stop(); }
});

test('rule order: a name rule is reported before an address rule, own-name before gateway', async () => {
  const g = await startGuard({ env: { DEVTEAM_PUBLIC_URL: 'http://10.9.9.9' } });
  try { assert.equal(refusal(await get(g.port, 'http://10.9.9.9/')).rule, 'gateway'); } finally { await g.stop(); }
  const h = await startGuard({ env: { DEVTEAM_PUBLIC_URL: 'https://box.localhost' } });
  try { assert.equal(refusal(await get(h.port, 'http://x.box.localhost/')).rule, 'own-name'); } finally { await h.stop(); }
});

test('CONNECT authorities that reach the guard but are not <host>:<port> get 400', async () => {
  const g = await startGuard();
  try {
    for (const a of ['a/b:443', 'a?b:443', 'a#b:443', '[::1:443', 'a:b:443', 'a:0', 'a:65536', ':443']) {
      const r = await connect(g.port, a);
      assert.equal(r.status, 400, `${a}: ${r.head}`);
      assert.equal(refusal(r).rule, 'not-a-proxy-request', a);
    }
  } finally { await g.stop(); }
});

test('a fault inside the decision is a 502, and the guard stays up', async () => {
  const g = await startGuard({ stub: true, env: { GUARD_STUB_IFACES_FILE: path.join(TMP, 'no-such-ifaces.json') } });
  try {
    for (const r of [await get(g.port, 'http://8.8.8.8/'), await connect(g.port, '8.8.8.8:443')]) assert.equal(r.status, 502, r.head);
    assert.equal(g.child.exitCode, null, `the guard exited: ${g.stderr()}`);
    assert.equal(refusal(await get(g.port, 'http://localhost/')).rule, 'own-name');
  } finally { await g.stop(); }
});

test('the command prints its port and stays up', async () => {
  const g = await startGuard();
  try {
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(g.child.exitCode, null, `the guard exited: ${g.stderr()}`);
    assert.equal((await get(g.port, 'http://127.0.0.1/')).status, 403);
  } finally { await g.stop(); }
});
