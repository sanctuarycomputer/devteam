// The owner sets how many workers run at once (kit-85): max_active_tickets and
// max_active_per_component are the supervisor's own settings, so the owner's Save is a request (an
// owner-setting act) that the supervisor lands through its settings chore. Both apply as main has
// them, null is "no limit" wherever a cap is read, and a finding stays raised until main has the value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { monoFixture, json, line, kit } from './lib/kit.mjs';

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
    assert.equal(r.out, '5', "main's value applies");
    const warning = /max_active_tickets, max_active_per_component here differs from main; it applies as on main, so change it with settings set in the settings chore/;
    assert.match(r.err, warning);
    assert.equal(count(r.err, warning), 1, 'named once per process');
    assert.equal(ok(old, ['settings', '--get', 'max_active_per_component'], SUP), '2');

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

test('null means no limit wherever a cap is read', () => {
  const F = monoFixture('askable-null');
  const { old, ok, run, edit, g } = F;
  const hand = handFor(F);
  const none = path.join(F.base, 'no-such-file');
  const ENV = { ...SUP, DEVTEAM_CGROUP: none, DEVTEAM_MEMINFO: none };
  const setMain = (patch) => { edit((j) => Object.assign(j, patch)); g(['commit', '-qam', `settings ${JSON.stringify(patch)}`], old); g(['push', '-q', 'origin', 'main'], old); };
  try {
    F.lines(F.STD, { max_active_tickets: null, max_active_per_component: null, incident_slots: 1 });
    // a goal with one feature holding the three open tickets: two ready and the fix
    const G = ok(old, ['goal', 'add', '--title', 'Floor', '--outcome', 'the floor holds', '--measure', 'gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'echo 3', '--non-goals', 'none', '--preconditions', 'a'], SUP);
    ok(old, ['goal', 'set', G, '--milestones', JSON.stringify([{ title: 'Floor', target: 0, preconditions: [1], tickets: 3 }])], SUP);
    ok(old, ['feature', 'add', 'floor', '--json', JSON.stringify({ title: 'Floor', goals: [G], preconditions: [`${G}#1`], stories: [{ id: 'FL-S1', text: 'the floor holds', release: 'v1.0.0' }] })], SUP);
    ok(old, ['ticket', 'add', 'web-01-a', '--json', ticketJson('web-01-a', { feature: 'floor' })], SUP);
    ok(old, ['ticket', 'add', 'web-02-b', '--json', ticketJson('web-02-b', { feature: 'floor' })], SUP);
    ok(old, ['ticket', 'add', 'web-00-busy', '--json', ticketJson('web-00-busy')], SUP);
    // one worker counted active in web: a build phase of its own
    hand('web-00-busy', { type: 'phase', to: 'build' }, 60000);
    // an open incident and its fix ticket
    hand('supervisor', { type: 'problem', title: 'web errors', severity: 3, realized: true, status: 'open', threatens: [], refs: [], fingerprints: ['web:log:E1'], sensor: 'web' }, 50000);
    hand('supervisor', { type: 'ticket', id: 'fx-01-web', title: 'web errors', feature: 'floor', component: 'web', kind: 'fix', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['web/**'], done_when: ['no errors'] }, 40000);

    const ready = run(old, ['ready'], ENV);
    assert.equal(ready.status, 0, ready.err);
    assert.match(ready.out, /^active workers: 1 \(no limit\)$/m);
    assert.doesNotMatch(ready.out, /for fix tickets/);
    assert.doesNotMatch(ready.out, /component at cap/);
    assert.match(ready.out, /web-01-a/);
    assert.equal(json(ok(old, ['ready', '--json'], ENV)).caps.max_active_tickets, null);

    const idle = json(ok(old, ['metrics', '--json'], ENV)).findings.filter((f) => f.kind === 'idle-capacity');
    assert.equal(idle.length, 1, JSON.stringify(idle));
    assert.match(idle[0].subject, /ready/);
    assert.doesNotMatch(idle[0].subject, /fix ready/);
    assert.match(idle[0].detail, /no limit/);
    assert.doesNotMatch(idle[0].detail, /null/);

    const meminfo = path.join(F.base, 'meminfo');
    fs.writeFileSync(meminfo, 'MemTotal:       16777216 kB\nMemFree:          524288 kB\nMemAvailable:    1677722 kB\n');
    const full = json(ok(old, ['metrics', '--json'], { ...ENV, DEVTEAM_MEMINFO: meminfo })).findings.find((f) => f.kind === 'memory-full');
    assert.ok(full, 'memory-full is raised with no limit');
    assert.match(full.detail, /no limit/);
    assert.doesNotMatch(full.detail, /null/);

    // the forecast: no limit runs the goal's open tickets at once (3), not one at a time
    const forecast = () => json(ok(old, ['goal', 'show', G], ENV)).forecast;
    const atNull = forecast();
    assert.equal(atNull.slots, 3);
    setMain({ max_active_tickets: 3 });
    assert.deepEqual(forecast(), atNull);
    setMain({ max_active_tickets: 1 });
    assert.notDeepEqual(forecast(), atNull);

    // the control: a finite cap of 1 reaches the fix-ready line
    const fix = json(ok(old, ['metrics', '--json'], ENV)).findings.filter((f) => f.kind === 'idle-capacity');
    assert.ok(fix.some((f) => /fix ready/.test(f.subject)), JSON.stringify(fix));
    assert.match(ok(old, ['ready'], ENV), /^active workers: 1\/1 \(\+1 for fix tickets\)$/m);
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
    for (const bad of [{ value: 21 }, { value: 0 }, { value: '7' }, { key: 'Bad Key' }]) assert.notEqual(judged('owner', { ...ask, ...bad }).status, 0, JSON.stringify(bad));
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
