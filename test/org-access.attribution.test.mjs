// Who did it (kit-252, org-access A10): the gateway says which person a request is (x-devteam-person,
// presence@1 §4's form), stripping any copy the browser sent and any x-devteam-level, and the kit
// records it as person { id, name } on the owner's lines: answers, thread turns (the dashboard's and,
// through hubAsk, the hub's), owner settings and pane answers. The dashboard and the hub show the name.
// A person only attributes: a forged header or an inherited DEVTEAM_PERSON grants nothing.
// One real gateway (in this process) in front of one real dashboard, which serves the hub, as a box:
// every signed press is the gateway's own. Sessions are written into the gateway's state.
// Run: node --test test/org-access.attribution.test.mjs
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { hasTmux, PORTS, startDashboard, threadsFixture, until } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { menuPane } from './lib/pane-question-fixture.mjs';

// lib/kit.mjs gave this file a block: the hub is its first port, the dashboard the next.
const HUB = PORTS;
const P = PORTS + 1;
assert.equal(process.env.DEVTEAM_HUB_PORT, String(HUB));
process.env.DEVTEAM_HUB_RETRY_MS = '500';
delete process.env.DEVTEAM_CLAIM_TOKEN;
const G = await import('../cloud/gateway.mjs');
const hubSignature = G.hubSignature;
const paneSignature = G.paneSignature;
const ownerSettingSignature = G.ownerSettingSignature;

const NAME = '山田 花子 🌸';
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const u = (b) => Buffer.from(b).toString('base64url');
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const rid = (prefix) => prefix + Array.from(crypto.randomBytes(12), (x) => B32[x & 31]).join('');
const header = (id, name) => `${id};name=${encodeURIComponent(name)}`;

const MARKUP = 'Ada <img src=x onerror="window.__pwned=1">';
const gwLogs = [];
let ttydServer = null;
let F, gw, pane, dash, label, keys, hanako, ada, odd, broken, longName, owner, cookies, ttydSeen;
const lines = () => fs.readdirSync(F.logDir).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const ownerLines = (pred) => lines().filter((l) => l.by === 'owner' && pred(l));
const storeFile = () => [path.join(process.env.HOME, 'operator', 'threads.jsonl'), path.join(process.env.HOME, '.devteam', `operator-${HUB}`, 'threads.jsonl')].find((f) => fs.existsSync(f)) ?? '/nonexistent';
const store = () => (fs.existsSync(storeFile()) ? fs.readFileSync(storeFile(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

// one request to the gateway, on the box's name or a project's, as the browser sends it
const viaGateway = (method, route, { on = null, cookie, body, headers = {} } = {}) => new Promise((resolve, reject) => {
  const host = on ? `${on}.box.localhost:${gw.port}` : `box.localhost:${gw.port}`;
  const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const h = { host, ...(method !== 'GET' ? { origin: `http://${host}`, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } : { 'sec-fetch-site': 'same-origin' }), ...(cookie ? { cookie } : {}), ...(data ? { 'content-length': data.length } : {}), ...headers };
  const r = http.request({ host: '127.0.0.1', port: gw.port, method, path: route, headers: h }, (res) => {
    let b = '';
    res.on('data', (c) => { b += c; });
    res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: b, json: j }); });
  });
  r.on('error', reject);
  r.end(data ?? undefined);
});
// one request straight to a local port (the dashboard's or the hub's), as an agent on the box could send it
const direct = (port, method, route, { body, headers = {} } = {}) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const r = http.request({ host: '127.0.0.1', port, method, path: route, headers: { host: `127.0.0.1:${port}`, ...(data ? { 'content-length': data.length } : {}), ...headers } }, (res) => {
    let b = '';
    res.on('data', (c) => { b += c; });
    res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, body: b, json: j }); });
  });
  r.on('error', reject);
  r.end(data ?? undefined);
});
// what a browser could add: another person, and the View level
const FORGED = { 'x-devteam-person': header('p-forgedforged', 'Eve'), 'x-devteam-level': 'view' };
const ask = (q, env = {}) => F.sup(['ask', '--question', q], env).split('\n')[0].match(/q-\S+/)[0];

before(async () => {
  F = threadsFixture('attribution');
  // the gateway's state, as one with an owner and Hanako signed in would be (people@1)
  const dir = path.join(F.base, 'gateway');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pair = crypto.generateKeyPairSync('ed25519');
  keys = { privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) };
  const pub = path.join(F.base, 'thread-key.pub');
  fs.writeFileSync(pub, keys.publicKey);
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const tok = () => crypto.randomBytes(32);
  const [ot, ht, at, dt, bt, lt] = [tok(), tok(), tok(), tok(), tok(), tok()];
  owner = { id: rid('p-'), name: 'Owner', role: 'owner', level: 'full', methods: [], pushSubs: [], added_at: iso, last_seen: null, notices: [], rev: 1 };
  hanako = { id: rid('p-'), name: NAME, role: 'member', level: 'full', methods: [{ id: rid('m-'), type: 'passkey', key: 'hanako-key', label: 'passkey 1', added_at: iso, last_used: null, data: {} }], pushSubs: [], added_at: iso, last_seen: null, notices: [], rev: 1 };
  ada = { ...hanako, id: rid('p-'), name: MARKUP, methods: [{ ...hanako.methods[0], id: rid('m-'), key: 'ada-key' }] };
  odd = { ...hanako, id: rid('p-'), name: 'Bad\uD800name', methods: [{ ...hanako.methods[0], id: rid('m-'), key: 'odd-key' }] };
  broken = { ...hanako, id: 'p bad id', name: 'Broken', methods: [{ ...hanako.methods[0], id: rid('m-'), key: 'broken-key' }] };
  longName = { ...hanako, id: rid('p-'), name: '花'.repeat(26), methods: [{ ...hanako.methods[0], id: rid('m-'), key: 'long-key' }] };
  const passkeys = [{ id: 'owner-key', rp: 'box.localhost' }];
  const state = {
    passkeys, claimHash: null, pushSubs: [], threadKey: keys, people: [owner, hanako, ada, odd, broken, longName],
    sessions: [{ hash: u(sha(ot)), method: 'owner-key', at: now, expires: now + 86400e3 }],
    peopleSessions: [{ hash: u(sha(ht)), person: hanako.id, method: hanako.methods[0].id, at: now, expires: now + 86400e3 }, { hash: u(sha(at)), person: ada.id, method: ada.methods[0].id, at: now, expires: now + 86400e3 }, ...[[dt, odd], [bt, broken], [lt, longName]].map(([t, x]) => ({ hash: u(sha(t)), person: x.id, method: x.methods[0].id, at: now, expires: now + 86400e3 }))],
    peopleStamp: u(sha(`devteam-people-stamp-v1\n${passkeys.map((p) => p.id).sort().join('\n')}`)),
  };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state), { mode: 0o600 });
  cookies = { owner: `devteam_session=${u(ot)}`, hanako: `devteam_session=${u(ht)}`, ada: `devteam_session=${u(at)}`, odd: `devteam_session=${u(dt)}`, broken: `devteam_session=${u(bt)}`, long: `devteam_session=${u(lt)}` };
  const port = await new Promise((r) => { const s = http.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const ttydPage = path.join(F.base, 'ttyd.html');
  fs.writeFileSync(ttydPage, 'ttyd');
  const uploadsDir = path.join(F.base, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o750 });
  const ttyd = http.createServer((q, r) => r.end('ttyd'));
  ttyd.on('upgrade', (q, sock) => { ttydSeen = q.headers; sock.end('HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\n\r\n'); });
  await new Promise((r) => ttyd.listen(0, '127.0.0.1', r));
  ttydServer = ttyd;
  const g = G.createGateway({ publicUrl: `http://box.localhost:${port}`, dir, ttydPort: ttyd.address().port, ttydPage, uploadsDir, log: (m) => gwLogs.push(m) });
  g.server.on('clientError', (e) => gwLogs.push(`clientError ${e.code} ${e.message}`));
  await new Promise((r) => g.server.listen(port, '127.0.0.1', r));
  gw = { g, port };
  // the supervisor's pane shows a question (a menu); the dashboard, a box's, serves the hub too, and
  // was started with a DEVTEAM_PERSON of its own, which must never reach a line
  pane = hasTmux ? menuPane(F, 'menu,menu2,input') : null;
  const boxEnv = { DEVTEAM_PUBLIC_URL: `http://box.localhost:${port}`, DEVTEAM_GATEWAY_THREAD_KEY: pub, DEVTEAM_HELLO_MS: '1000', DEVTEAM_PERSON: JSON.stringify({ id: 'p-inherited', name: 'Mallory' }), ...(pane ? { DEVTEAM_SUPERVISOR: pane.target } : {}) };
  dash = startDashboard(F.old, F.env(boxEnv), ['--port', String(P)]);
  await until(async () => { try { const j = await (await fetch(`http://127.0.0.1:${HUB}/instances.json`)).json(); label = j.instances.find((x) => x.port === P)?.name; return !!label; } catch { return false; } }, 'the hub, listing the dashboard');
}, { timeout: 120000 });
after(async () => {
  dash?.stop();
  if (gw) { gw.g.server.closeAllConnections?.(); await new Promise((r) => gw.g.server.close(r)); }
  if (ttydServer) { ttydServer.closeAllConnections?.(); await new Promise((r) => ttydServer.close(r)); }
  F?.done();
});

// Each press once, shared by the checks that read what it wrote (each check asserts one thing).
const once = (f) => { let p = null; return () => (p ??= f()); };
const HANAKO = () => ({ id: hanako.id, name: NAME });
const answered = once(async () => {
  const q = ask('Ship the attribution change?');
  const r = await viaGateway('POST', '/api/answer', { on: label, cookie: cookies.hanako, body: { id: q, answer: 'Yes' }, headers: FORGED });
  assert.equal(r.status, 200, r.body);
  return q;
});
const dashTurn = once(async () => {
  const r = await viaGateway('POST', '/api/thread-new', { on: label, cookie: cookies.hanako, body: { title: 'Attribution', text: 'Who wrote this?' }, headers: FORGED });
  assert.equal(r.status, 200, r.body);
  return ownerLines((l) => l.type === 'turn' && l.text === 'Who wrote this?')[0];
});
const hubTurn = once(async () => {
  const r = await viaGateway('POST', '/operator/thread-new', { cookie: cookies.hanako, body: { text: 'Is the box well?' }, headers: FORGED });
  assert.equal(r.status, 200, r.body);
  return store().find((l) => l.type === 'turn' && l.text === 'Is the box well?');
});
const PAGE = () => ({ origin: `http://127.0.0.1:${P}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });
const HUB_PAGE_HEADERS = () => ({ origin: `http://127.0.0.1:${HUB}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });
// a Save on the Settings page, signed as the gateway signs it, sent straight to the dashboard
const signedSetting = (value, extra = {}) => {
  const data = Buffer.from(JSON.stringify({ key: 'max_active_tickets', value }));
  return direct(P, 'POST', '/api/owner-setting', { body: data.toString(), headers: { ...PAGE(), ...ownerSettingSignature(keys.privateKey, P, data), ...extra } });
};
const settingAct = (value) => ownerLines((l) => l.type === 'act' && l.class === 'owner-setting' && l.value === value).pop();

// ----- what the log records ---------------------------------------------------------------------------
test('org-access A10: an answer through the gateway records its person, a non-Latin name whole, never the browser\'s', { timeout: 60000 }, async () => {
  const q = await answered();
  assert.deepEqual(ownerLines((l) => l.type === 'question' && l.id === q && l.answer === 'Yes')[0].person, HANAKO());
});

test('org-access A10: the owner\'s answer through the gateway records the owner\'s row as its person', { timeout: 60000 }, async () => {
  const q = ask('And the owner?');
  assert.equal((await viaGateway('POST', '/api/answer', { on: label, cookie: cookies.owner, body: { id: q, answer: 'No' } })).status, 200);
  assert.deepEqual(ownerLines((l) => l.id === q && l.answer === 'No')[0].person, { id: owner.id, name: 'Owner' });
});

test('org-access A10: the dashboard\'s data gives an answered question its person', { timeout: 60000 }, async () => {
  const q = await answered();
  const d = await viaGateway('GET', '/api/data', { on: label, cookie: cookies.hanako });
  const all = [...(d.json.ooda?.answered ?? []), ...(d.json.answered ?? []), ...(d.json.questions ?? [])];
  assert.deepEqual(all.find((x) => x.id === q)?.answered_person, HANAKO());
});

test('org-access A10: a dashboard thread turn through the gateway records its person', { timeout: 60000 }, async () => {
  assert.deepEqual((await dashTurn()).person, HANAKO());
});

test('org-access A10: /api/threads gives a dashboard turn its person', { timeout: 60000 }, async () => {
  await dashTurn();
  const t = await viaGateway('GET', '/api/threads', { on: label, cookie: cookies.hanako });
  assert.deepEqual(t.json.threads.flatMap((x) => x.turns).find((x) => x.text === 'Who wrote this?').person, HANAKO());
});

test('org-access A10: an owner setting saved through the gateway records its person', { timeout: 60000 }, async () => {
  const r = await viaGateway('POST', '/api/owner-setting', { on: label, cookie: cookies.hanako, body: { key: 'max_active_tickets', value: 3 }, headers: FORGED });
  assert.equal(r.status, 200, r.body);
  assert.deepEqual(settingAct(3).person, HANAKO());
});

const paneQuestion = () => until(async () => { const j = (await viaGateway('GET', '/api/threads', { on: label, cookie: cookies.hanako })).json; const x = j?.supervisor?.question; return x && x.kind === 'menu' ? x : null; }, 'the pane\'s question');

test('org-access A10: a malformed person header on a signed pane answer is refused and types nothing', { skip: hasTmux ? false : 'no tmux', timeout: 90000 }, async () => {
  const q = await paneQuestion();
  const data = Buffer.from(JSON.stringify({ digest: q.digest, option: 1, token: q.token }));
  const typed = pane.typed();
  const r = await direct(P, 'POST', '/api/pane-answer', { body: data.toString(), headers: { ...PAGE(), ...paneSignature(keys.privateKey, P, data), 'x-devteam-person': 'p-x;name=' } });
  assert.deepEqual([r.status, pane.typed() === typed], [400, true], r.body);
});

test('org-access A10: a malformed person header on an answer is refused and answers nothing', { timeout: 60000 }, async () => {
  const q = ask('Malformed answer?');
  const r = await direct(P, 'POST', '/api/answer', { body: { id: q, answer: 'Yes' }, headers: { ...PAGE(), 'x-devteam-person': 'p-x;name=' } });
  assert.deepEqual([r.status, ownerLines((l) => l.id === q && l.answer !== undefined).length], [400, 0], r.body);
});

test('org-access A10: a pane answer through the gateway records its person', { skip: hasTmux ? false : 'no tmux', timeout: 90000 }, async () => {
  const q = await paneQuestion();
  const r = await viaGateway('POST', '/api/pane-answer', { on: label, cookie: cookies.hanako, body: { digest: q.digest, option: 1, token: q.token }, headers: FORGED });
  assert.equal(r.status, 200, r.body);
  assert.deepEqual(ownerLines((l) => l.type === 'act' && l.class === 'pane-answer').pop().person, HANAKO());
});

test('org-access A10: a thread turn through hubAsk records its person in the operator\'s store', { timeout: 60000 }, async () => {
  assert.deepEqual((await hubTurn()).person, HANAKO());
});

test('org-access A10: the hub\'s /operator/threads gives a turn its person', { timeout: 60000 }, async () => {
  await hubTurn();
  const t = await viaGateway('GET', '/operator/threads', { cookie: cookies.hanako });
  assert.deepEqual(t.json.threads.flatMap((x) => x.turns).find((x) => x.text === 'Is the box well?').person, HANAKO());
});

test('org-access A10: an x-devteam-level from the browser is dropped', { timeout: 30000 }, async () => {
  // the terminal's routes refuse a View level (kit-251): a full person's browser saying View is not View
  const r = await viaGateway('GET', '/api/term/token', { on: label, cookie: cookies.hanako, headers: { 'x-devteam-level': 'view' } });
  assert.notEqual(r.json?.why, 'view', r.body);
});

// ----- a person only attributes -------------------------------------------------------------------------
test('org-access A10: a forged person header on a direct local request grants nothing', { timeout: 60000 }, async () => {
  const before = lines().length;
  // on a box a press needs the gateway's signature: a person header doesn't stand in for it
  const r1 = await direct(P, 'POST', '/api/owner-setting', { body: { key: 'max_active_tickets', value: 5 }, headers: { ...PAGE(), 'x-devteam-person': header(hanako.id, NAME) } });
  const r2 = await direct(HUB, 'POST', '/operator/thread-new', { body: { text: 'forged' }, headers: { ...HUB_PAGE_HEADERS(), 'x-devteam-person': header(hanako.id, NAME) } });
  assert.deepEqual([r1.status, r2.status, lines().length - before, store().some((l) => l.text === 'forged')], [403, 403, 0, false]);
});

test('org-access A10: a malformed person header is refused and nothing is written', { timeout: 60000 }, async () => {
  const before = lines().length;
  const got = [];
  for (const bad of ['p-x', 'p-x;name=', 'p x;name=Eve', 'p-x;name=%FF', 'p-x;name=Eve;level=full']) got.push([bad, (await signedSetting(6, { 'x-devteam-person': bad })).status]);
  const hb = Buffer.from(JSON.stringify({ text: 'bad person' }));
  const r = await direct(HUB, 'POST', '/operator/thread-new', { body: hb.toString(), headers: { ...HUB_PAGE_HEADERS(), ...hubSignature(keys.privateKey, '/operator/thread-new', hb), 'x-devteam-person': 'p-x;name=' } });
  got.push(['hub', r.status]);
  assert.deepEqual([got, lines().length - before, store().some((l) => l.text === 'bad person')], [got.map(([b]) => [b, 400]), 0, false]);
});

test('org-access A10: a long name is cut by whole characters to 80 bytes of JSON', { timeout: 60000 }, async () => {
  const r = await signedSetting(7, { 'x-devteam-person': header(hanako.id, '花'.repeat(40)) });
  assert.equal(r.status, 200, r.body);
  assert.equal(settingAct(7).person?.name, '花'.repeat(26));
});

test('org-access A10: a server\'s own DEVTEAM_PERSON never reaches its children', { timeout: 60000 }, async () => {
  // the dashboard was started with DEVTEAM_PERSON=Mallory: a signed press with no person header is nobody's
  const r = await signedSetting(4);
  assert.equal(r.status, 200, r.body);
  assert.deepEqual([!!settingAct(4), settingAct(4)?.person], [true, undefined]);
});

test('org-access A10: DEVTEAM_PERSON makes no agent the owner and goes on no agent\'s line', { timeout: 60000 }, async () => {
  const person = JSON.stringify({ id: hanako.id, name: NAME });
  const q = ask('Inherited?');
  const refused = F.fails(['answer', q, '--', 'Yes'], { DEVTEAM_ROLE: 'worker', DEVTEAM_PERSON: person });
  const sq = ask('Asked with an inherited person?', { DEVTEAM_PERSON: person });
  const o = lines().find((l) => l.type === 'question' && l.id === sq && l.op === 'new');
  assert.deepEqual([/agent session/.test(refused), !!o, o?.person], [true, true, undefined]);
});

test('org-access A10: no child of a kit command inherits DEVTEAM_PERSON', { timeout: 60000 }, async () => {
  const out = F.sup(['gate', 'test', '--', 'sh', '-c', 'printf "[%s]" "${DEVTEAM_PERSON-unset}"'], { DEVTEAM_PERSON: JSON.stringify({ id: hanako.id, name: NAME }) });
  assert.match(out, /\[unset\]/);
});

test('org-access A10: a turn too long to carry its person is refused whole, writing no thread', { timeout: 60000 }, async () => {
  const text = '"'.repeat(1900);
  const r = await viaGateway('POST', '/api/thread-new', { on: label, cookie: cookies.long, body: { title: 'Too long with a name', text } });
  assert.deepEqual([r.status, lines().some((l) => l.type === 'thread' && l.title === 'Too long with a name')], [400, false], r.body);
  assert.match(r.json?.error ?? '', /too long with your name on it/i);
});

test('org-access A10: the gateway sends a lone surrogate in a name as U+FFFD', { timeout: 60000 }, async () => {
  const q = ask('Odd name?');
  assert.equal((await viaGateway('POST', '/api/answer', { on: label, cookie: cookies.odd, body: { id: q, answer: 'Yes' } })).status, 200);
  assert.deepEqual(ownerLines((l) => l.id === q && l.answer === 'Yes')[0]?.person, { id: odd.id, name: 'Bad\uFFFDname' });
});

test('org-access A10: a person whose id the header can\'t carry is refused, never sent as the owner', { timeout: 60000 }, async () => {
  const q = ask('Broken id?');
  const r = await viaGateway('POST', '/api/answer', { on: label, cookie: cookies.broken, body: { id: q, answer: 'Yes' } });
  assert.deepEqual([r.status, /this person's record can't be read/.test(r.body), ownerLines((l) => l.id === q && l.answer).length], [500, true, 0], r.body);
});

test('org-access A10: the terminal\'s socket gets neither the browser\'s person nor its level', { timeout: 30000 }, async () => {
  ttydSeen = null;
  let answered = '';
  await new Promise((resolve) => {
    const host = `term.box.localhost:${gw.port}`;
    const s = net.connect(gw.port, '127.0.0.1', () => s.write(`GET /ws HTTP/1.1\r\nhost: ${host}\r\norigin: http://${host}\r\ncookie: ${cookies.hanako}\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-key: x\r\nsec-websocket-version: 13\r\nx-devteam-person: ${FORGED['x-devteam-person']}\r\nx-devteam-level: view\r\n\r\n`));
    s.setTimeout(10000, () => s.destroy());
    s.on('data', (c) => { answered += c; s.destroy(); });
    s.on('close', resolve);
    s.on('error', (e) => { answered += `ERR ${e.message}`; resolve(); });
  });
  assert.ok(ttydSeen, `the upgrade reached the stand-in (the gateway answered ${JSON.stringify(answered.slice(0, 200))}; its log ${JSON.stringify(gwLogs.slice(-5))})`);
  assert.deepEqual([ttydSeen['x-devteam-person'], ttydSeen['x-devteam-level']], [undefined, undefined]);
});

// ----- the schema ---------------------------------------------------------------------------------------
const schemaOf = () => JSON.parse(fs.readFileSync(path.join(F.old, 'docs/devteam/schema/log.schema.json'), 'utf8'));
const turnLine = (extra) => ({ type: 'turn', thread: 't-20260101-000000000-owner', text: 'hello', ...extra });
const threadLine = ['owner', { type: 'thread', id: 't-20260101-000000000-owner', title: 'x', subject: { kind: 'page', view: 'overview' } }];

test('log.schema.json: person is $defs.person, { id, name }, on question, turn, act and thread', () => {
  const s = schemaOf();
  assert.deepEqual([s.$defs.person?.required, ...['question', 'turn', 'act', 'thread'].map((t) => JSON.stringify(s.$defs.types[t].properties.person) === JSON.stringify(s.$defs.person))], [['id', 'name'], true, true, true, true]);
  // the shape itself, as the spec gives it (its words aside)
  const { description, 'x-tip': tip, ...shape } = s.$defs.person ?? {};
  assert.deepEqual(shape, { type: 'object', required: ['id', 'name'], additionalProperties: false, properties: { id: { type: 'string', pattern: '^[A-Za-z0-9._:@/-]{1,64}$' }, name: { type: 'string', minLength: 1, maxLength: 80 } } });
  assert.ok(description && tip, 'it says what it is');
});

test('log.schema.json: an owner line with person passes log-check, not set aside', () => {
  const ok = F.checkWith(threadLine, ['owner', turnLine({ person: { id: hanako.id, name: NAME } })]);
  assert.deepEqual([ok.status, /person/.test(ok.said)], [0, false], ok.said);
});

test('log.schema.json: the owner\'s set lines with person pass log-check: a thread resolved, an act corrected', () => {
  const p = { id: hanako.id, name: NAME };
  const act = ['supervisor', { type: 'act', id: 'a-20260101-000000000-supervisor', class: 'note', what: 'did a thing' }];
  const ok = F.checkWith(threadLine, act,
    ['owner', { type: 'thread', op: 'set', id: 't-20260101-000000000-owner', status: 'resolved', person: p }],
    ['owner', { type: 'act', op: 'set', id: 'a-20260101-000000000-supervisor', corrected: { reason: 'not this' }, person: p }]);
  assert.deepEqual([ok.status, /person/.test(ok.said)], [0, false], ok.said);
});

test('log.schema.json: an owner line without person still passes log-check', () => {
  const ok = F.checkWith(threadLine, ['owner', turnLine({})]);
  assert.equal(ok.status, 0, ok.said);
});

test('log.schema.json: a malformed person fails log-check', () => {
  const st = [{ id: hanako.id }, { id: hanako.id, name: '' }, { id: 'p x', name: 'Eve' }, { id: hanako.id, name: 'Eve', level: 'full' }].map((bad) => F.checkWith(threadLine, ['owner', turnLine({ person: bad })]).status);
  assert.ok(st.every((x) => x !== 0), JSON.stringify(st));
});

test('log.schema.json: person on a supervisor\'s line fails log-check', () => {
  const r = F.checkWith(threadLine, ['supervisor', turnLine({ person: { id: hanako.id, name: NAME } })]);
  assert.deepEqual([r.status !== 0, /person/.test(r.said)], [true, true], r.said);
});

// ----- what the pages show ------------------------------------------------------------------------------
const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 120000 };
let chromeOpen = null;
after(async () => { if (chromeOpen) { chromeOpen.p.close(); await chromeOpen.chrome.close(); } });
const browser = once(async () => {
  const chrome = await openChrome();
  const p = await chrome.newPage();
  chromeOpen = { chrome, p };
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  return p;
});
const shows = async (url, what, expr) => {
  const p = await browser();
  await p.send('Page.navigate', { url });
  return until(() => p.ev(expr).catch(() => false), what);
};
const metas = `(() => { const m = [...document.querySelectorAll('.tl-turn.owner .meta')].map((e) => e.textContent); return m.length ? m : false; })()`;

test('org-access A10: the dashboard\'s thread card names the person on their turn', CHROME, async () => {
  const turn = await dashTurn();
  const meta = await shows(`http://127.0.0.1:${P}/#talk/${turn.thread}`, 'the thread\'s turn', metas);
  assert.match(meta[0], new RegExp(`^${NAME} · `));
});

test('org-access A10: the dashboard\'s Answered card names the person who answered', CHROME, async () => {
  const q = await answered();
  const text = await shows(`http://127.0.0.1:${P}/`, 'the answered card', `(() => { const e = [...document.querySelectorAll('#answered > *')].find((x) => x.textContent.includes('Ship the attribution change?')); return e ? e.textContent : false; })()`);
  assert.match(text, new RegExp(NAME), q);
});

test('org-access A10: the hub\'s operator thread names the person on their turn', CHROME, async () => {
  const turn = await hubTurn();
  const p = await browser();
  await p.send('Page.navigate', { url: `http://127.0.0.1:${HUB}/` });
  await until(() => p.ev(`typeof tlOpen === 'function' && document.readyState === 'complete'`).catch(() => false), 'the hub');
  await p.ev(`tlOpen(${JSON.stringify(turn.thread)})`);
  const meta = await until(() => p.ev(metas).catch(() => false), 'the hub\'s turn');
  assert.match(meta[0], new RegExp(`^${NAME} · `));
});

test('org-access A10: a name with markup is shown as text, never drawn', CHROME, async () => {
  assert.equal((await viaGateway('POST', '/api/thread-new', { on: label, cookie: cookies.ada, body: { title: 'Markup', text: 'Markup name?' } })).status, 200);
  const tid = ownerLines((l) => l.type === 'turn' && l.text === 'Markup name?')[0].thread;
  const got = await shows(`http://127.0.0.1:${P}/#talk/${tid}`, 'the markup turn', `(() => { const m = document.querySelector('.tl-turn.owner .meta'); return m ? { text: m.textContent, imgs: m.querySelectorAll('img').length, pwned: !!window.__pwned } : false; })()`);
  assert.deepEqual([got.text.startsWith(`${MARKUP} · `), got.imgs, got.pwned], [true, 0, false], got.text);
});

test('org-access A10: a name with markup on the Answered card is shown as text, never drawn', CHROME, async () => {
  const q = ask('Markup answer?');
  assert.equal((await viaGateway('POST', '/api/answer', { on: label, cookie: cookies.ada, body: { id: q, answer: 'Yes' } })).status, 200);
  const got = await shows(`http://127.0.0.1:${P}/`, 'the markup answered card', `(() => { const e = [...document.querySelectorAll('#answered > *')].find((x) => x.textContent.includes('Markup answer?')); return e ? { text: e.textContent, imgs: e.querySelectorAll('img').length, pwned: !!window.__pwned } : false; })()`);
  assert.deepEqual([got.text.includes(MARKUP), got.imgs, got.pwned], [true, 0, false], got.text);
});

// last: a state from before people (no owner row) is the owner's stand-in, and sends no person
test('org-access A10: an owner session from before people sends no person header', { timeout: 60000 }, async () => {
  const file = path.join(F.base, 'gateway', 'state.json');
  const kept = fs.readFileSync(file, 'utf8');
  try {
    const s = JSON.parse(kept);
    delete s.people; delete s.peopleSessions; delete s.peopleStamp;
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(s), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
    const q = ask('From before people?');
    // the browser's forged person and level ride along: with no person of the gateway's own to
    // replace them, only their drop keeps them off the line (task-3 review F1)
    const r = await viaGateway('POST', '/api/answer', { on: label, cookie: cookies.owner, body: { id: q, answer: 'Yes' }, headers: FORGED });
    assert.equal(r.status, 200, r.body);
    const a = ownerLines((l) => l.id === q && l.answer === 'Yes')[0];
    assert.deepEqual([!!a, a?.person], [true, undefined]);
  } finally {
    fs.writeFileSync(`${file}.tmp`, kept, { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }
});
