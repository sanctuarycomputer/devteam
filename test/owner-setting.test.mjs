// The owner sets how many workers run at once (kit-85): max_active_tickets and
// max_active_per_component are the supervisor's own settings, so the owner's Save is a request (an
// owner-setting act) that the supervisor lands through its settings chore. Both apply as main has
// them, null is "no limit" wherever a cap is read, and a finding stays raised until main has the value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { monoFixture, json, line, kit, freePort, startDashboard, until } from './lib/kit.mjs';
import { ownerSettingSignature, paneSignature } from '../cloud/gateway.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const month = () => new Date().toISOString().slice(0, 7);
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
// A line as the kit would have written it agoMs ago, in its writer's file.
function handFor(F) {
  const logDir = path.join(F.old, 'docs/devteam/run/log');
  return (by, o, agoMs = 1000) => {
    const d = new Date(Date.now() - agoMs);
    const id = o.id ?? `${{ observation: 'o', problem: 'p', decision: 'd', act: 'a', phase: 'h', ticket: 't' }[o.type]}-${stamp(d)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${month()}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
    return id;
  };
}
const ticketJson = (id, extra = {}) => JSON.stringify({ title: id, feature: 'chores', component: 'web', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**'], done_when: ['the web check passes in CI'], ...extra });
const count = (s, re) => (s.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) ?? []).length;

test('the allowlist and OWNER_SETTINGS never overlap', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
  const owner = [...src.match(/const OWNER_SETTINGS = \{([\s\S]*?)\};/)[1].matchAll(/([a-z_]+):/g)].map((m) => m[1]);
  const askable = [...src.match(/const OWNER_ASKABLE = \[([^\]]*)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(askable, ['max_active_tickets', 'max_active_per_component']);
  assert.deepEqual(askable.filter((k) => owner.includes(k)), []);
  assert.ok(!owner.includes('links') && !askable.includes('links'));
});

test('max_active_* apply as on main: a working-tree edit in the main checkout is ignored, and named once', () => {
  const F = monoFixture('askable-pin');
  const { old, run, ok, edit, g } = F;
  try {
    F.lines(F.STD);
    edit((j) => { j.max_active_tickets = 3; j.max_active_per_component = 1; });
    const r = run(old, ['settings', '--get', 'max_active_tickets'], SUP);
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out, '', "main's value applies: unset, no cap");
    const warning = /max_active_tickets, max_active_per_component here differs from main; it applies as on main, so change it with settings set in the settings chore/;
    assert.match(r.err, warning);
    assert.equal(count(r.err, warning), 1, 'named once per process');
    assert.equal(ok(old, ['settings', '--get', 'max_active_per_component'], SUP), '');

    // an owner key and an askable key both edited: each line once
    edit((j) => { j.gates = { tidy: { cmd: 'true' } }; });
    const both = run(old, ['settings', '--get', 'max_active_tickets'], SUP);
    assert.equal(count(both.err, warning), 1, both.err);
    assert.equal(count(both.err, /owner settings apply as they are on/), 1, both.err);
    edit((j) => { j.gates = {}; });

    // landed on main, it applies
    g(['commit', '-qam', 'caps'], old);
    g(['push', '-q', 'origin', 'main'], old);
    const landed = run(old, ['settings', '--get', 'max_active_tickets'], SUP);
    assert.equal(landed.out, '3');
    assert.doesNotMatch(landed.err, warning);
  } finally { F.done(); }
});

// The readers are kit PR #277's (capOf: a positive number is a cap, null or 0 none; ruling
// m-20261116-021912584). What kit-85 adds is the pin: null on main reaches them as main has it, and
// a working-tree number doesn't.
test('null on main reads as no cap through the kit\'s reader, whatever the working tree says', () => {
  const F = monoFixture('askable-null');
  const { old, ok, edit, g } = F;
  const hand = handFor(F);
  const none = path.join(F.base, 'no-such-file');
  const ENV = { ...SUP, DEVTEAM_CGROUP: none, DEVTEAM_MEMINFO: none };
  try {
    F.lines(F.STD, { max_active_tickets: null, max_active_per_component: null });
    ok(old, ['ticket', 'add', 'web-00-busy', '--json', ticketJson('web-00-busy', { touches: ['web/busy/**'] })], SUP);
    ok(old, ['ticket', 'add', 'web-01-a', '--json', ticketJson('web-01-a', { touches: ['web/a/**'] })], SUP);
    hand('web-00-busy', { type: 'phase', to: 'build' }, 60000);
    // a working-tree cap of 1 in the main checkout: ignored, main's null applies
    edit((j) => { j.max_active_tickets = 1; j.max_active_per_component = 1; });
    const ready = ok(old, ['ready'], ENV);
    assert.match(ready, /^active workers: 1\/no cap$/m);
    assert.doesNotMatch(ready, /component at cap/);
    assert.deepEqual(json(ok(old, ['ready', '--json'], ENV)).caps, { max_active_tickets: null, max_active_per_component: null, incident_slots: json(ok(old, ['ready', '--json'], ENV)).caps.incident_slots });
    const idle = json(ok(old, ['metrics', '--json'], ENV)).findings.filter((f) => f.kind === 'idle-capacity');
    assert.equal(idle.length, 1, JSON.stringify(idle));
    assert.match(idle[0].detail, /1\/no cap workers active/);
    // landed on main, the 1 applies
    g(['commit', '-qam', 'caps of 1'], old); g(['push', '-q', 'origin', 'main'], old);
    assert.match(ok(old, ['ready'], ENV), /^active workers: 1\/1$/m);
    assert.equal(json(ok(old, ['metrics', '--json'], ENV)).findings.filter((f) => f.kind === 'idle-capacity').length, 0);
  } finally { F.done(); }
});

// Every log line here, in every file of run/log.
const logLines = (F) => { const dir = path.join(F.old, 'docs/devteam/run/log'); return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))) : []; };
const DASH = { DEVTEAM_CHANNEL: 'dashboard' };

test('owner-setting writes one owner act and touches no file or git', () => {
  const F = monoFixture('owner-setting-act');
  const { old, run, g } = F;
  try {
    F.lines(F.STD);
    const snapshot = () => `${g(['status', '--porcelain'], old)}\n${g(['ls-files', '-s'], old)}\n${g(['diff'], old)}`;
    const before = snapshot();
    const n = logLines(F).length;
    const r = run(old, ['owner-setting', 'max_active_tickets', '7'], DASH);
    assert.equal(r.status, 0, r.err);
    const added = logLines(F).slice(n);
    assert.equal(added.length, 1, JSON.stringify(added));
    const a = added[0];
    assert.equal(r.out, a.id);
    assert.deepEqual([a.type, a.class, a.by, a.channel, a.key, a.value, a.what, a.reversible], ['act', 'owner-setting', 'owner', 'dashboard', 'max_active_tickets', 7, 'asked for max_active_tickets 7', true]);
    assert.deepEqual(a.refs, []);
    assert.ok(!Number.isNaN(Date.parse(a.at)), "the envelope's at");
    assert.equal(JSON.stringify(a).match(/"at":/g).length, 1, 'no other at');
    assert.equal(snapshot(), before, 'no file or git change');
    const none = run(old, ['owner-setting', 'max_active_per_component', 'none'], DASH);
    assert.equal(none.status, 0, none.err);
    const b = logLines(F).at(-1);
    assert.deepEqual([b.key, b.value, b.what], ['max_active_per_component', null, 'asked for max_active_per_component no limit']);
    assert.equal(run(old, ['log-check']).status, 0);
  } finally { F.done(); }
});

test('owner-setting refuses, writes nothing and names why', () => {
  const F = monoFixture('owner-setting-refuse');
  const { old, run } = F;
  try {
    F.lines(F.STD);
    const runDir = path.join(old, 'docs/devteam/run');
    fs.mkdirSync(runDir, { recursive: true });
    const refused = (args, env, re, input) => {
      const n = logLines(F).length;
      const r = run(old, ['owner-setting', ...args], env, input);
      assert.notEqual(r.status, 0, `${args.join(' ')} ${JSON.stringify(env)}: ${r.out}`);
      assert.match(r.err, re);
      assert.equal(logLines(F).length, n, 'nothing written');
    };
    refused(['max_active_tickets', '7'], { ...DASH, DEVTEAM_ROLE: 'worker' }, /DEVTEAM_ROLE=worker/);
    refused(['max_active_tickets', '7'], { ...DASH, TMUX: 'x', TMUX_PANE: '%9', DEVTEAM_SUPERVISOR: '%9' }, /supervisor's session/);
    for (const n of ['supervisor-pane', 'supervisor-pane-role']) fs.writeFileSync(path.join(runDir, n), '%9');
    refused(['max_active_tickets', '7'], { ...DASH, TMUX: 'x', TMUX_PANE: '%9' }, /recorded as the supervisor's/);
    for (const n of ['supervisor-pane', 'supervisor-pane-role']) fs.rmSync(path.join(runDir, n));
    refused(['max_active_planners', '3'], DASH, /not a setting the owner asks for/);
    const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
    for (const k of [...src.match(/const OWNER_SETTINGS = \{([\s\S]*?)\};/)[1].matchAll(/([a-z_]+):/g)].map((m) => m[1])) refused([k, '3'], DASH, /owner's own setting/);
    refused(['links', '3'], DASH, /links change through link set and link land/);
    for (const v of ['0', '21', '7.5']) refused(['max_active_tickets', v], DASH, /whole number from 1 to 20/);
    // an agent's shell: no dashboard channel, and stdin a pipe
    refused(['max_active_tickets', '7'], {}, /on the dashboard's Settings page or in their own terminal/, '');
    // the channel is checked before the key (task-2 T2-2)
    refused(['max_active_planners', '3'], {}, /on the dashboard's Settings page or in their own terminal/, '');
    // one key and one value, nothing more (task-2 T2-4)
    refused(['max_active_tickets', '7', '9'], DASH, /usage: owner-setting <key> <1\.\.20\|none>/);
  } finally { F.done(); }
});

test('validate takes proof on owner-setting and pane-answer only', () => {
  const F = monoFixture('owner-setting-validate');
  const { old, run } = F;
  const hand = handFor(F);
  const proof = { port: 4400, ts: 1, nonce: 'n', sig: 's', body: 'e30=' };
  const check = () => run(old, ['log-check']);
  const ownerFile = path.join(old, 'docs/devteam/run/log', `owner-${month()}.jsonl`);
  const supFile = path.join(old, 'docs/devteam/run/log', `supervisor-${month()}.jsonl`);
  // one hand line at a time, removed again after it is judged
  const judged = (by, o) => {
    const file = by === 'owner' ? ownerFile : supFile;
    const keep = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    hand(by, { type: 'act', refs: [], reversible: true, ...o });
    const r = check();
    if (keep === null) fs.rmSync(file); else fs.writeFileSync(file, keep);
    return r;
  };
  try {
    F.lines(F.STD);
    const ask = { class: 'owner-setting', key: 'max_active_tickets', value: 7, what: 'asked for max_active_tickets 7' };
    let r = judged('owner', { ...ask, proof });
    assert.equal(r.status, 0, r.err || r.out);
    r = judged('owner', { class: 'goal-order', what: 'ordered the goals', proof });
    assert.notEqual(r.status, 0);
    assert.match(`${r.out}\n${r.err}`, /proof is the gateway's signature/);
    r = judged('supervisor', ask);
    assert.notEqual(r.status, 0);
    assert.match(`${r.out}\n${r.err}`, /owner-setting is the owner's/);
    // validate's own rule names each (task-2 T2-1): readers skip the schema, so it is their guard
    const shapeRule = /an owner-setting act names a setting \(key\) and its value/;
    for (const bad of [{ value: 21 }, { value: 0 }, { value: '7' }, { key: 'Bad Key' }, { key: undefined }, { value: undefined }, { artifact: 'some-page' }]) {
      const x = judged('owner', JSON.parse(JSON.stringify({ ...ask, ...bad })));
      assert.notEqual(x.status, 0, JSON.stringify(bad));
      assert.match(`${x.out}\n${x.err}`, shapeRule, JSON.stringify(bad));
    }
    assert.equal(judged('owner', { ...ask, value: null, what: 'asked for max_active_tickets no limit' }).status, 0);
    r = judged('owner', { ...ask, key: 'max_active_planners', what: 'asked for max_active_planners 7' });
    assert.equal(r.status, 0, `shape, not today's allowlist: ${r.err || r.out}`);
  } finally { F.done(); }
});

test('CLASS_WORDS names both classes', () => {
  const F = monoFixture('owner-setting-words');
  try {
    const d = json(F.ok(F.old, ['dashboard-data']));
    assert.equal(d.class_words['owner-setting'], 'Asking for a setting');
    assert.equal(d.class_words['settings-edit'], 'Changing one of its own settings');
  } finally { F.done(); }
});

// A dashboard on a port of its own (--port, so run/dashboard-port isn't written and the port comes
// from run/dashboard.log), and posts as the page's own.
async function dashFor(t, F, env = {}) {
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env(env), ['--port', String(port)]);
  t.after(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const own = { origin: B, 'sec-fetch-site': 'same-origin' };
  const post = (body, headers = own, type = 'application/json') => fetch(`${B}/api/owner-setting`, { method: 'POST', headers: { 'content-type': type, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { B, port, own, post };
}
const settingActs = (F) => logLines(F).filter((l) => l.type === 'act' && l.class === 'owner-setting');
const ownerKeys = () => [...fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8').match(/const OWNER_SETTINGS = \{([\s\S]*?)\};/)[1].matchAll(/([a-z_]+):/g)].map((m) => m[1]);

test('POST /api/owner-setting from the page runs owner-setting', async (t) => {
  const F = monoFixture('owner-setting-route');
  t.after(() => F.done());
  F.lines(F.STD);
  const D = await dashFor(t, F);
  let r = await D.post({ key: 'max_active_tickets', value: 7 });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await r.json()).ok, true);
  let acts = settingActs(F);
  assert.equal(acts.length, 1);
  assert.deepEqual([acts[0].by, acts[0].channel, acts[0].key, acts[0].value], ['owner', 'dashboard', 'max_active_tickets', 7]);
  r = await D.post({ key: 'max_active_tickets', value: null });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(settingActs(F).at(-1).value, null);
  const n = settingActs(F).length;
  const refused = async (status, body, headers, type, re) => {
    const x = await D.post(body, headers, type);
    assert.equal(x.status, status, `${JSON.stringify(body)} ${JSON.stringify(headers)} ${type}`);
    if (re) assert.match((await x.json()).error, re);
    assert.equal(settingActs(F).length, n, 'nothing written');
  };
  const ok7 = { key: 'max_active_tickets', value: 7 };
  for (const h of [{}, { origin: D.B }, { 'sec-fetch-site': 'same-origin' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }]) await refused(403, ok7, h);
  await refused(403, ok7, D.own, 'text/plain');
  for (const v of [0, 21]) await refused(400, { key: 'max_active_tickets', value: v }, D.own, undefined, /whole number from 1 to 20/);
  for (const v of [7.5, '7', true]) await refused(400, { key: 'max_active_tickets', value: v }, D.own, undefined, /missing or invalid fields/);
  for (const k of ownerKeys()) await refused(400, { key: k, value: 3 }, D.own, undefined, /owner's own setting/);
  await refused(400, { key: 'nope', value: 3 }, D.own, undefined, /not a setting the owner asks for/);
  // exactly { key, value }, at most 512 bytes: the route's own checks (task-3 T3-1)
  await refused(400, { key: 'max_active_tickets', value: 7, extra: 1 }, D.own, undefined, /missing or invalid fields: \{ key, value \}/);
  await refused(400, { key: 'max_active_tickets' }, D.own, undefined, /missing or invalid fields: \{ key, value \}/);
  await refused(400, `${JSON.stringify(ok7)}${' '.repeat(600)}`, D.own, undefined, /missing or invalid fields/);
  // 7.0 is the number 7 once parsed: accepted
  r = await D.post('{"key":"max_active_tickets","value":7.0}');
  assert.equal(r.status, 200, await r.clone().text());
  acts = settingActs(F);
  assert.equal(acts.length, n + 1);
  assert.equal(acts.at(-1).value, 7);
});

test("on a box the save needs the gateway's owner-setting signature, once", async (t) => {
  const F = monoFixture('owner-setting-box');
  t.after(() => F.done());
  F.lines(F.STD);
  const pair = crypto.generateKeyPairSync('ed25519');
  const priv = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = path.join(F.base, 'thread-key.pub');
  fs.writeFileSync(pub, pair.publicKey.export({ type: 'spki', format: 'pem' }));
  const box = { DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_GATEWAY_THREAD_KEY: pub };
  const D = await dashFor(t, F, box);
  const body = JSON.stringify({ key: 'max_active_tickets', value: 7 });
  const signed = (sig) => D.post(body, { ...D.own, ...sig });
  let r = await D.post(body);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /on a box the owner saves settings only through the box's gateway/);
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  for (const [why, sig] of [
    ['another key', ownerSettingSignature(other, D.port, Buffer.from(body))],
    ['another port', ownerSettingSignature(priv, D.port + 1, Buffer.from(body))],
    ['another body', ownerSettingSignature(priv, D.port, Buffer.from(body.replace('7', '8')))],
    ['too old', ownerSettingSignature(priv, D.port, Buffer.from(body), Date.now() - 10 * 60000)],
    ['a pane-answer signature', paneSignature(priv, D.port, Buffer.from(body))],
  ]) {
    r = await signed(sig);
    assert.equal(r.status, 403, why);
  }
  assert.equal(settingActs(F).length, 0);
  const sig = ownerSettingSignature(priv, D.port, Buffer.from(body));
  r = await signed(sig);
  assert.equal(r.status, 200, await r.clone().text());
  const [act] = settingActs(F);
  assert.deepEqual([act.by, act.value, act.proof.nonce, act.proof.port], ['owner', 7, sig['x-devteam-gateway-nonce'], D.port]);
  r = await signed(sig);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /used already/);
  // the command the dashboard runs: the log remembers the nonce past a restart
  const cli = (args, input) => F.run(F.old, ['owner-setting', ...args], { ...box, ...DASH }, input);
  const refusedCli = (args, input, re) => { const x = cli(args, input); assert.notEqual(x.status, 0, x.out); assert.match(x.err, re); };
  refusedCli(['max_active_tickets', '7'], JSON.stringify({ proof: act.proof }), /taken already/);
  refusedCli(['max_active_tickets', '7'], '', /on a box the owner saves settings only on the dashboard through the box's gateway/);
  const proofOf = (b, port = D.port) => { const h = ownerSettingSignature(priv, port, Buffer.from(b)); return { port, ts: h['x-devteam-gateway-ts'], nonce: h['x-devteam-gateway-nonce'], sig: h['x-devteam-gateway-sig'], body: Buffer.from(b).toString('base64') }; };
  refusedCli(['max_active_tickets', '7'], JSON.stringify({ proof: proofOf(JSON.stringify({ key: 'max_active_tickets', value: 9 })) }), /signed another/);
  refusedCli(['max_active_tickets', '7'], JSON.stringify({ proof: proofOf(JSON.stringify({ key: 'max_active_per_component', value: 7 })) }), /signed another/);
  refusedCli(['max_active_tickets', '7'], JSON.stringify({ proof: proofOf(body, D.port + 1) }), /another dashboard/);
  // the signed body is exactly { key, value } (task-3 T3-2)
  refusedCli(['max_active_tickets', '7'], JSON.stringify({ proof: proofOf(JSON.stringify({ key: 'max_active_tickets', value: 7, extra: 1 })) }), /signed another/);
  // and the reverse of domain separation at the kit: an owner-setting signature answers no pane (task-3 T3-3)
  const press = JSON.stringify({ digest: 'a'.repeat(40), option: 1, token: 't' });
  const pressProof = proofOf(press);
  const pane = F.run(F.old, ['pane', 'answered', '--owner'], box, JSON.stringify({ digest: 'a'.repeat(40), option: 1, label: 'Yes', first: 'Q', keys: '1', taken: true, proof: pressProof }));
  assert.notEqual(pane.status, 0);
  assert.match(pane.err, /its signature is not the gateway's/);
  // a fresh, valid proof for this dashboard: the CLI takes it
  const fresh = cli(['max_active_tickets', '7'], JSON.stringify({ proof: proofOf(body) }));
  assert.equal(fresh.status, 0, fresh.err);
  const n = settingActs(F).length;
  for (const b of [JSON.stringify({ key: 'max_active_tickets', value: 7, extra: 1 }), JSON.stringify({ key: 'max_active_tickets', value: 7, pad: 'x'.repeat(600) }), `${body}${' '.repeat(600)}`]) {
    r = await D.post(b, { ...D.own, ...ownerSettingSignature(priv, D.port, Buffer.from(b)) });
    assert.equal(r.status, 400, b.slice(0, 80));
  }
  assert.equal(settingActs(F).length, n);
  assert.equal(F.run(F.old, ['log-check'], box).status, 0);
});

const SETTINGS_REL = 'docs/devteam/project/settings.md';
const blockOf = (f) => JSON.parse(fs.readFileSync(f, 'utf8').match(/```json devteam\s*\n([\s\S]*?)\n```/)[1]);
const choreWt = (F) => path.join(F.old, '.worktrees/chore-settings');
const editActs = (F) => logLines(F).filter((l) => l.type === 'act' && l.class === 'settings-edit');
// the PR file merge --chore reads, as link-edits.test.mjs writes it
const prFile = (F, title) => { fs.mkdirSync(path.join(F.old, 'docs/devteam/run/pr'), { recursive: true }); fs.writeFileSync(path.join(F.old, 'docs/devteam/run/pr/chore-settings.md'), `# chore-settings: ${title}\n\n## One-way doors\n\nNone.\n`); };
// after a settings chore merged: the next one starts afresh from main (plan Task 0's fixture note)
const clearChore = (F) => { F.g(['worktree', 'remove', '--force', choreWt(F)], F.old); F.g(['branch', '-D', 'chore-settings'], F.old); };

test("settings set applies the owner's act in the settings chore, and lands through merge --chore", () => {
  const F = monoFixture('settings-set');
  const { old, ok, run, g } = F;
  try {
    F.lines(F.STD);
    const before = fs.readFileSync(path.join(old, SETTINGS_REL), 'utf8');
    const id = ok(old, ['owner-setting', 'max_active_tickets', '7'], DASH);
    const wt = ok(old, ['chore', 'start', 'settings'], SUP).trim();
    assert.equal(fs.realpathSync(wt), fs.realpathSync(choreWt(F)));
    const set = run(old, ['settings', 'set', 'max_active_tickets', '7', '--for', id], SUP);
    assert.equal(set.status, 0, set.err);
    assert.match(set.out, /chore pr settings/);
    assert.equal(blockOf(path.join(wt, SETTINGS_REL)).max_active_tickets, 7);
    const diff = g(['diff', '-U0', '--', SETTINGS_REL], wt).split('\n').filter((l) => /^[+-][^+-]/.test(l));
    assert.equal(diff.filter((l) => l.startsWith('+')).length, 1, diff.join('\n'));
    assert.ok(diff.filter((l) => l.startsWith('-')).length <= 1, diff.join('\n'));
    assert.equal(fs.readFileSync(path.join(old, SETTINGS_REL), 'utf8'), before, "the main checkout's file is unchanged");
    const [e] = editActs(F);
    assert.deepEqual([e.by, e.key, e.value, e.for, e.refs, e.what], ['supervisor', 'max_active_tickets', 7, id, [id], 'set max_active_tickets to 7 in the settings chore']);
    assert.match(run(old, ['settings', 'set', 'max_active_tickets', '6', '--for', id], SUP).err, /asked for 7/);
    assert.match(run(old, ['settings', 'set', 'links', '3'], SUP).err, /link set and link land/);
    for (const k of ownerKeys()) assert.match(run(old, ['settings', 'set', k, '3'], SUP).err, /owner's own setting/, k);
    assert.equal(editActs(F).length, 1, 'nothing more logged');
    ok(old, ['chore', 'pr', 'settings', '--title', 'settings: max_active_tickets 7'], SUP);
    prFile(F, 'settings: max_active_tickets 7');
    const m = run(old, ['merge', '--chore', 'settings'], SUP);
    assert.equal(m.status, 0, `${m.out}\n${m.err}`);
    g(['fetch', '-q', 'origin'], old);
    assert.equal(JSON.parse(g(['show', `origin/main:${SETTINGS_REL}`], old).match(/```json devteam\s*\n([\s\S]*?)\n```/)[1]).max_active_tickets, 7);
    assert.ok(logLines(F).some((l) => l.type === 'act' && l.class === 'merge-chore' && (l.refs ?? []).includes('chore-settings')), 'a merge-chore act for chore-settings');
    // a superseded request is never applied: the newer one is named
    clearChore(F);
    const newer = ok(old, ['owner-setting', 'max_active_tickets', '8'], DASH);
    ok(old, ['chore', 'start', 'settings'], SUP);
    assert.match(run(old, ['settings', 'set', 'max_active_tickets', '7', '--for', id], SUP).err, new RegExp(`a newer request ${newer} asks for 8`));
    assert.match(run(old, ['settings', 'set', 'max_active_per_component', '7', '--for', newer], SUP).err, /--for names the owner's owner-setting act for max_active_per_component/);
    assert.equal(editActs(F).length, 1);
  } finally { F.done(); }
});

test("settings set is the supervisor's alone", () => {
  const F = monoFixture('settings-set-roles');
  const { old, ok, run } = F;
  try {
    F.lines(F.STD);
    ok(old, ['chore', 'start', 'settings'], SUP);
    const before = fs.readFileSync(path.join(choreWt(F), SETTINGS_REL), 'utf8');
    for (const role of ['worker', 'planner', 'operator']) {
      const r = run(old, ['settings', 'set', 'max_active_tickets', '4'], { DEVTEAM_ROLE: role });
      assert.notEqual(r.status, 0, role);
      if (role === 'operator') assert.match(r.err, /the operator only reads/);
    }
    assert.equal(run(old, ['settings', '--get', 'max_active_tickets'], { DEVTEAM_ROLE: 'operator' }).status, 0, 'the operator still reads');
    assert.equal(fs.readFileSync(path.join(choreWt(F), SETTINGS_REL), 'utf8'), before);
    assert.equal(editActs(F).length, 0);
  } finally { F.done(); }
});

test('settings set adds to a chore that holds other edits', () => {
  const F = monoFixture('settings-set-adds');
  const { old, ok } = F;
  try {
    F.lines(F.STD);
    ok(old, ['chore', 'start', 'settings'], SUP);
    const f = path.join(choreWt(F), SETTINGS_REL);
    // an unrelated key and gates in an order of their own, as written by hand
    F.edit((j) => { j.tick_minutes = 7; j.gates = { zeta: { cmd: 'true' }, alpha: { cmd: 'true' } }; j.max_active_per_component = 2; }, choreWt(F));
    const before = fs.readFileSync(f, 'utf8');
    ok(old, ['settings', 'set', 'max_active_per_component', 'none'], SUP);
    const after = fs.readFileSync(f, 'utf8');
    const j = blockOf(f);
    assert.equal(j.max_active_per_component, null);
    assert.equal(j.tick_minutes, 7);
    assert.deepEqual(Object.keys(j.gates), ['zeta', 'alpha']);
    // only the one line differs
    const a = before.split('\n'), b = after.split('\n');
    assert.equal(b.length, a.length, 'replaced in place');
    assert.equal(b.filter((l, i) => l !== a[i]).length, 1);
  } finally { F.done(); }
});

test('settings set without the chore worktree', () => {
  const F = monoFixture('settings-set-nowt');
  try {
    F.lines(F.STD);
    const r = F.run(F.old, ['settings', 'set', 'max_active_tickets', '4'], SUP);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /no worktree \.worktrees\/chore-settings; devteam\.mjs chore start settings/);
    assert.equal(editActs(F).length, 0);
  } finally { F.done(); }
});

test("settings set refuses a settings block it can't edit safely", () => {
  const F = monoFixture('settings-set-unsafe');
  const { old, ok, run } = F;
  try {
    F.lines(F.STD);
    ok(old, ['chore', 'start', 'settings'], SUP);
    const f = path.join(choreWt(F), SETTINGS_REL);
    const text = fs.readFileSync(f, 'utf8');
    const block = text.match(/```json devteam\s*\n([\s\S]*?)\n```/)[1];
    const dup = text.replace(block, () => block.replace(/^\{/, '{\n  "max_active_tickets": 3,\n  "max_active_tickets": 4,'));
    fs.writeFileSync(f, dup);
    const r = run(old, ['settings', 'set', 'max_active_tickets', '6'], SUP);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /repeats/);
    assert.equal(fs.readFileSync(f, 'utf8'), dup, 'the file is unchanged');
    fs.writeFileSync(f, text.replace(block, () => '{}'));
    ok(old, ['settings', 'set', 'max_active_tickets', '4'], SUP);
    assert.deepEqual(blockOf(f), { max_active_tickets: 4 });
    assert.equal(editActs(F).length, 1);
  } finally { F.done(); }
});

test('owner-setting-unlanded and the Settings label follow main, a landed override and Upkeep', () => {
  const F = monoFixture('owner-setting-label');
  const { old, ok, run, g } = F;
  const ENV = { ...SUP, DEVTEAM_CGROUP: path.join(F.base, 'none'), DEVTEAM_MEMINFO: path.join(F.base, 'none') };
  const view = () => json(ok(old, ['dashboard-data'], ENV)).asked_settings.max_active_tickets;
  const unlanded = () => json(ok(old, ['metrics', '--json'], ENV)).findings.filter((f) => f.kind === 'owner-setting-unlanded');
  const ask = (v) => ok(old, ['owner-setting', 'max_active_tickets', v], DASH);
  // a settings chore from main: fn edits it, then it lands through merge --chore
  const chore = (fn) => { if (fs.existsSync(choreWt(F))) clearChore(F); ok(old, ['chore', 'start', 'settings'], SUP); fn(); };
  const land = (title) => {
    ok(old, ['chore', 'pr', 'settings', '--title', title], SUP);
    prFile(F, title);
    const m = run(old, ['merge', '--chore', 'settings'], SUP);
    assert.equal(m.status, 0, `${m.out}\n${m.err}`);
    g(['fetch', '-q', 'origin'], old);
  };
  const SAVED = "Saved; applies once the supervisor lands it";
  try {
    F.lines(F.STD);
    // 1. no act, key not on main
    let v = view();
    assert.deepEqual(v, { value: null, shown: 'No limit', label: "The kit's default", asked: null, act: null });
    assert.equal(unlanded().length, 0);
    // 2. no act, main sets 4
    F.edit((j) => { j.max_active_tickets = 4; }); g(['commit', '-qam', 'four'], old); g(['push', '-q', 'origin', 'main'], old);
    assert.equal(view().label, 'Set by the supervisor');
    // 3. the owner asks for 7
    const a7 = ask('7');
    v = view();
    assert.deepEqual(v, { value: 4, shown: '4', label: SAVED, asked: 7, act: a7 });
    let [f] = unlanded();
    assert.equal(f.severity, 'medium');
    assert.equal(f.subject, 'max_active_tickets');
    assert.equal(f.detail, `the owner asked for max_active_tickets 7 (${a7}); main has 4`);
    for (const re of [/chore start settings/, new RegExp(`settings set max_active_tickets 7 --for ${a7}`), /chore pr settings --title/, /merge --chore settings/, /waits until Upkeep runs/]) assert.match(f.suggestion, re);
    assert.doesNotMatch(f.suggestion, /^Upkeep is/);
    // 4. an override without --for, in the chore, not merged: nothing clears
    chore(() => ok(old, ['settings', 'set', 'max_active_tickets', '3'], SUP));
    assert.equal(view().label, SAVED);
    assert.equal(unlanded().length, 1);
    // 5. that chore merged: main has 3
    land('settings: max_active_tickets 3');
    assert.equal(view().label, 'Set by the supervisor (you asked for 7)');
    assert.equal(view().value, 3);
    assert.equal(unlanded().length, 0);
    // 6. the owner asks for 3
    ask('3');
    assert.equal(view().label, 'Set by you');
    // 7. no limit, asked and landed with --for
    const aNone = ask('none');
    assert.equal(view().label, SAVED);
    chore(() => ok(old, ['settings', 'set', 'max_active_tickets', 'none', '--for', aNone], SUP));
    land('settings: max_active_tickets no limit');
    v = view();
    assert.deepEqual(v, { value: null, shown: 'No limit', label: 'Set by you', asked: null, act: aNone });
    assert.equal(unlanded().length, 0);
    // 8. Upkeep parked, and a new ask: the fix leads with it
    ok(old, ['goal', 'hold', 'upkeep', 'park', '--owner', '--reason', 'a test']);
    const a2 = ask('2');
    [f] = unlanded();
    assert.match(f.suggestion, /^Upkeep is parked: /);
    assert.match(f.detail, new RegExp(`\\(${a2}\\); main has no limit$`));
    ok(old, ['goal', 'hold', 'upkeep', 'run', '--owner']);
    // 9. a no-op override: main at 3, the owner asks for 5, an unrelated settings merge lands, then
    // the supervisor keeps 3 (the file unchanged)
    chore(() => ok(old, ['settings', 'set', 'max_active_tickets', '3'], SUP));
    land('settings: max_active_tickets 3');
    const a5 = ask('5');
    chore(() => F.edit((j) => { j.tick_minutes = 9; }, choreWt(F)));
    land('settings: tick_minutes 9');
    assert.equal(view().label, SAVED, 'a settings merge newer than the ask, but none newer than any edit');
    chore(() => { ok(old, ['settings', 'set', 'max_active_tickets', '3'], SUP); F.edit((j) => { j.stale_after_minutes = 50; }, choreWt(F)); });
    assert.equal(view().label, SAVED, 'before its merge the edit clears nothing, though main already holds its value');
    assert.equal(unlanded().length, 1);
    // another chore's merge is no settings merge: it lands nothing of the edit
    const tidy = ok(old, ['chore', 'start', 'tidy'], SUP).trim();
    fs.writeFileSync(path.join(tidy, 'docs/devteam/project/tidy.md'), 'tidied\n');
    ok(old, ['chore', 'pr', 'tidy', '--title', 'tidy'], SUP);
    fs.writeFileSync(path.join(old, 'docs/devteam/run/pr/chore-tidy.md'), '# chore-tidy: tidy\n\n## One-way doors\n\nNone.\n');
    const mt = run(old, ['merge', '--chore', 'tidy'], SUP);
    assert.equal(mt.status, 0, `${mt.out}\n${mt.err}`);
    g(['fetch', '-q', 'origin'], old);
    assert.equal(view().label, SAVED, 'a merge of chore-tidy is not the settings chore landing');
    land('settings: keep 3, stale_after_minutes 50');
    v = view();
    assert.deepEqual([v.label, v.asked, v.act], ['Set by the supervisor (you asked for 5)', 5, a5]);
    assert.equal(unlanded().length, 0);
    // 9b. main moves on without an edit (a commit from another clone): the override it landed is no
    // longer what main holds, so it no longer answers the ask
    const other = path.join(F.base, 'other');
    g(['clone', '-q', F.org, other], F.base);
    for (const [k, x] of [['user.email', 'o@o'], ['user.name', 'o']]) g(['config', k, x], other);
    F.edit((j) => { j.max_active_tickets = 4; }, other);
    g(['commit', '-qam', 'four, by hand'], other); g(['push', '-q', 'origin', 'main'], other);
    g(['fetch', '-q', 'origin'], old);
    assert.deepEqual([view().label, view().value], [SAVED, 4]);
    // and back to 3 by hand, so state 10 runs with main at 3, as the plan has it (task-5 T5-4)
    F.edit((j) => { j.max_active_tickets = 3; }, other);
    g(['commit', '-qam', 'three, by hand'], other); g(['push', '-q', 'origin', 'main'], other);
    g(['fetch', '-q', 'origin'], old);
    assert.deepEqual([view().label, view().value], ['Set by the supervisor (you asked for 5)', 3], 'the landed keep-3 answers the ask again');
    // 10. an override that never merged clears nothing for a newer ask
    ask('6');
    chore(() => ok(old, ['settings', 'set', 'max_active_tickets', '5'], SUP));
    assert.equal(view().label, SAVED);
    assert.equal(unlanded().length, 1);
    assert.equal(run(old, ['log-check']).status, 0);
  } finally { F.done(); }
});

test('settings set edits the block itself, keeps its line endings, and only in the settings chore', () => {
  const F = monoFixture('settings-set-where');
  const { old, ok, run, g } = F;
  try {
    F.lines(F.STD);
    ok(old, ['chore', 'start', 'settings'], SUP);
    const f = path.join(choreWt(F), SETTINGS_REL);
    const text = fs.readFileSync(f, 'utf8');
    const block = text.match(/```json devteam\s*\n([\s\S]*?)\n```/)[1];
    // an empty block, with {} in the prose above it: the block is edited, not the prose (task-4 T4-1)
    const withProse = text.replace(block, () => '{}').replace(/^/, 'An empty object reads {} in JSON.\n\n');
    fs.writeFileSync(f, withProse);
    ok(old, ['settings', 'set', 'max_active_tickets', '4'], SUP);
    const after = fs.readFileSync(f, 'utf8');
    assert.ok(after.startsWith('An empty object reads {} in JSON.\n'), 'the prose is untouched');
    assert.deepEqual(blockOf(f), { max_active_tickets: 4 });
    // CRLF: the inserted line keeps them (task-4 T4-3)
    const crlf = text.replace(block, () => block.replace(/\n/g, '\r\n'));
    fs.writeFileSync(f, crlf);
    ok(old, ['settings', 'set', 'max_active_per_component', '3'], SUP);
    const b = fs.readFileSync(f, 'utf8').match(/```json devteam\s*\n([\s\S]*?)\n```/)[1];
    assert.equal(JSON.parse(b).max_active_per_component, 3);
    assert.doesNotMatch(b, /[^\r]\n/, 'no bare LF inside the block');
    // 1e3 is not a plain number: named as such (task-4 T4-4)
    fs.writeFileSync(f, text.replace(block, () => '{\n  "max_active_tickets": 1e1\n}'));
    assert.match(run(old, ['settings', 'set', 'max_active_tickets', '4'], SUP).err, /isn't written as one plain number or null/);
    // a folder on another branch where the chore should be is refused (task-4 T4-2)
    fs.writeFileSync(f, text);
    g(['checkout', '-q', '-b', 'not-settings'], choreWt(F));
    const before = fs.readFileSync(f, 'utf8');
    assert.match(run(old, ['settings', 'set', 'max_active_tickets', '4'], SUP).err, /its branch is not chore-settings/);
    assert.equal(fs.readFileSync(f, 'utf8'), before);
  } finally { F.done(); }
});
