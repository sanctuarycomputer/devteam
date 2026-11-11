// Signals the loop can see (the OODA spec, PR 2): where each observation came from and which stage
// of the loop it sits in, computed when it is read; spikes over the hours a sensor heard; one
// recurring signal per fingerprint; noise rulings; set-asides that cite what they set aside; and
// escalations nobody triaged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
// A line as the kit would have written it agoMs ago, in its writer's file (owner lines carry
// their channel). Ids follow the kit's form, so each case picks a distinct agoMs.
function handFor(F) {
  const logDir = path.join(F.old, 'docs/devteam/run/log');
  return (by, o, agoMs = 1000) => {
    const d = new Date(Date.now() - agoMs);
    const id = o.id ?? `${{ observation: 'o', problem: 'p', decision: 'd' }[o.type]}-${stamp(d)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${d.toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
    return id;
  };
}
const one = (F, id) => json(F.ok(F.old, ['log', '--id', id, '--json']))[0];

test('provenance and stage are computed for every writer; observe --source keeps to the vocabulary', () => {
  const F = fleetFixture('ooda-provenance');
  const { old, ok, run } = F;
  const hand = handFor(F);
  try {
    const cases = [];
    const want = (id, from, ref, stage = 'observe') => cases.push({ id, from, ref, stage });
    want(hand('supervisor', { type: 'observation', source: 'web', detector: 'sensor', subject: 'sensor:web', kind: 'log-error', detail: 'web: a error log line', severity: 3, source_key: 'sensor:web:log:L1' }, 90000), 'sensor', 'web');
    want(hand('supervisor', { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'w-01-a', kind: 'stale-worker', detail: 'quiet', source_key: 'metrics:stale-worker:w-01-a' }, 89000), 'metrics', 'stale-worker');
    want(hand('supervisor', { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'build', kind: 'cost-hotspot', detail: '60% of spend', source_key: 'metrics:cost-hotspot:build' }, 88000), 'spend', 'cost-hotspot');
    want(hand('supervisor', { type: 'observation', source: 'pane', detector: 'pane', subject: 'w-01-a', kind: 'resent-enter', detail: 'pressed Enter once', source_key: 'resent-enter x' }, 87000), 'metrics', 'pane');
    want(hand('supervisor', { type: 'observation', source: 'repo', subject: 'g-20260101-000000000-supervisor', kind: 'reading', detail: 'reading 5', measure: { value: 5 } }, 86000), 'sensor', 'goal-measure', 'measurement');
    // an owner reading counts as the owner's answer only when it names a question they answered
    const q = ok(old, ['ask', '--question', 'Is it met?', '--recommendation', 'yes'], SUP).match(/q-\S+/)[0];
    ok(old, ['answer', q, 'yes']);
    want(hand('supervisor', { type: 'observation', source: 'owner', subject: 'g-20260101-000000000-supervisor', kind: 'reading', detail: `the owner said yes to ${q}`, measure: { value: 1 }, approved: q }, 85000), 'owner-answer', q, 'measurement');
    want(hand('supervisor', { type: 'observation', source: 'owner', subject: 'g-20260101-000000000-supervisor', kind: 'reading', detail: 'the owner said yes to a question that never was', measure: { value: 1 }, approved: 'q-20260101-000000000-supervisor' }, 84500), 'supervisor', null, 'measurement');
    // a thread's resolution is the owner's alone: the supervisor's line saying so is the supervisor's
    want(hand('supervisor', { type: 'observation', source: 'owner', subject: 'thread:t-20260101-000000000-owner', kind: 'thread-resolved', detail: 'resolved', refs: ['t-20260101-000000000-owner'] }, 84200), 'supervisor', null);
    want(hand('owner', { type: 'observation', source: 'owner', subject: 'thread:t-20260101-000000000-owner', kind: 'thread-resolved', detail: 'resolved', refs: ['t-20260101-000000000-owner'] }, 84000), 'owner-thread', 't-20260101-000000000-owner');
    want(hand('supervisor', { type: 'observation', source: 'supervisor', subject: 'project', kind: 'retro', detail: 'a week', source_ref: 'project/retros/2026-11-09.md' }, 83000), 'retro', 'project/retros/2026-11-09.md');
    // a set-aside is the call of whoever made it, not the check it sets aside
    want(hand('supervisor', { type: 'observation', source: 'ack', kind: 'finding-ack', subject: 'stale-worker w-01-a', detail: 'it is fine' }, 82000), 'supervisor', null, 'decide');
    want(hand('supervisor', { type: 'observation', source: 'web', detector: 'sensor', subject: 'sensor:web', kind: 'sensor-ignored', detail: 'ignored web:log:L1: bots', source_ref: 'web:log:L1' }, 81000), 'supervisor', 'web:log:L1', 'decide');
    // a worker's line that says it is a sensor's is still the worker's (fromSensor trusts only the supervisor and the owner)
    want(hand('w-01-a', { type: 'observation', source: 'web', detector: 'sensor', subject: 'sensor:web', kind: 'down', detail: 'web is down' }, 80000), 'worker', null);
    want(ok(old, ['observe', '--owner', '--subject', 'app', '--kind', 'note', '--detail', 'the owner saw it']).trim(), 'owner', null);
    want(ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'the supervisor saw it'], SUP).trim(), 'supervisor', null);
    want(ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'a worker saw it'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'w-01-a' }).trim(), 'worker', null);
    want(ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'the owner said so in chat', '--source', 'owner-chat', '--ref', q], SUP).trim(), 'owner-chat', q);
    // the owner's words need the record that holds them; the supervisor writes as no worker or planner
    assert.match(run(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'the owner approved X', '--source', 'owner-answer'], SUP).err, /needs --ref <id> naming where the owner said it/);
    assert.match(run(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'x', '--source', 'owner-answer', '--ref', 'q-20260101-000000000-supervisor'], SUP).err, /needs --ref/);
    for (const s of ['worker', 'planner']) assert.match(run(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'x', '--source', s], SUP).err, /a supervisor's observation is from/);
    for (const c of cases) {
      const o = one(F, c.id);
      assert.deepEqual(o.provenance, { from: c.from, ref: c.ref }, `${o.kind} by ${o.created_by}: ${JSON.stringify(o.provenance)}`);
      assert.equal(o.stage, c.stage, `${o.kind}'s stage`);
    }
    // the kit's own sources, and another writer's, are refused from the command line
    for (const s of ['sensor', 'metrics', 'spend']) assert.match(run(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'x', '--source', s], SUP).err, /come from the kit itself/);
    assert.match(run(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'x', '--source', 'supervisor'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'w-01-a' }).err, /a worker's observation is from worker/);
    // what the dashboard reads carries them too, and the schema says where each type sits
    const d = json(ok(old, ['dashboard-data']));
    const seen = new Map(d.ooda.observations.map((o) => [o.id, o]));
    assert.deepEqual(seen.get(cases[0].id).provenance, { from: 'sensor', ref: 'web' });
    assert.equal(seen.get(cases[0].id).stage, 'observe');
    const S = json(fs.readFileSync(path.join(old, 'docs/devteam/schema/log.schema.json'), 'utf8'));
    assert.equal(S['x-ooda'].stages.act, 'act');
    assert.ok(S['x-ooda'].sources.includes('owner-chat'));
    // a peek of an observation carries them as well
    const p = json(ok(old, ['peek', 'observation', cases[1].id, '--json']));
    assert.deepEqual(p.provenance, { from: 'metrics', ref: 'stale-worker' });
    assert.equal(p.stage, 'observe');
  } finally { F.done(); }
});

// A probe sensor on main, "fake", that prints what its mode file says: the chain's probe, cut down.
function sensorFixture(F) {
  const mode = path.join(F.base, 'probe-mode');
  fs.writeFileSync(mode, '');
  const probe = `import fs from 'node:fs';
const p = JSON.parse(process.env.DEVTEAM_PARAMS);
for (const l of fs.readFileSync(p.mode, 'utf8').split('\\n').filter(Boolean)) console.log(l);
`;
  fs.mkdirSync(path.join(F.old, 'docs/devteam/project/sensors'), { recursive: true });
  fs.writeFileSync(path.join(F.old, 'docs/devteam/project/sensors/fake.mjs'), probe);
  const sf = path.join(F.old, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"gates": {}', `"sensors": { "fake": { "kind": "probe", "probe": "project/sensors/fake.mjs", "every_minutes": 5, "params": { "mode": ${JSON.stringify(mode)} } } }, "gates": {}`));
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'a sensor'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  const dir = path.join(F.old, 'docs/devteam/run/sensors/fake');
  const emit = (...events) => fs.writeFileSync(mode, events.map((e) => JSON.stringify(e)).join('\n'));
  const poll = () => F.ok(F.old, ['sensor', 'poll', '--name', 'fake'], SUP);
  const file = (f) => path.join(dir, f);
  const read = (f, d = {}) => (fs.existsSync(file(f)) ? json(fs.readFileSync(file(f), 'utf8')) : d);
  const put = (f, v) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file(f), JSON.stringify(v)); };
  return { mode, dir, emit, poll, read, put };
}
const hourAgo = (n) => new Date(Date.now() - n * 3600000).toISOString().slice(0, 13);

test('spikes: a median over the hours the sensor heard, naming the line', () => {
  const F = fleetFixture('ooda-spike');
  try {
    const s = sensorFixture(F);
    // a first poll makes the sensor's files; nothing in it qualifies
    s.emit({ kind: 'log', fingerprint: 'W0', level: 'warning', template: 'warm up', count: 1 });
    s.poll();
    assert.ok(s.read('listened.json')[hourAgo(0)], 'a poll that ran marks its hour heard');
    // two lines the kit has known for three days, ten an hour in the 30 hours it heard; the box was
    // down for the 42 hours between, which nobody heard (the Stacks case)
    const heard = [...Array(30)].map((_, i) => hourAgo(i < 20 ? i + 1 : i + 33));
    const fps = s.read('fingerprints.json');
    const counts = s.read('counts.json');
    for (const k of ['S1', 'S2']) {
      fps[`log:${k}`] = { kind: 'log', first_seen: new Date(Date.now() - 3 * 86400000).toISOString(), seen_at: new Date(Date.now() - 3 * 86400000).toISOString(), total: 300, users: 0, level: 'error', observed: true, template: 'payment gateway timeout after <n>ms' };
      counts[`log:${k}`] = Object.fromEntries(heard.map((h) => [h, 10]));
    }
    s.put('fingerprints.json', fps);
    s.put('counts.json', counts);
    s.put('listened.json', { ...s.read('listened.json'), ...Object.fromEntries(heard.map((h) => [h, true])) });
    const spikes = () => json(F.ok(F.old, ['log', '--type', 'observation', '--json'])).filter((o) => o.kind === 'spike');
    // a normal hour after the gap: 25 against a median of 10 over what it heard (the unheard hours
    // would have made the median 0)
    s.emit({ kind: 'log', fingerprint: 'S1', level: 'error', template: 'payment gateway timeout after <n>ms', count: 25 });
    s.poll();
    assert.deepEqual(spikes(), [], 'no spike from hours nobody heard');
    // a real one: five times the median
    s.emit({ kind: 'log', fingerprint: 'S2', level: 'error', template: 'payment gateway timeout after <n>ms', count: 60 });
    s.poll();
    const [sp] = spikes();
    assert.ok(sp, 'one spike');
    assert.match(sp.detail, /^fake: a log line \(fake:log:S2\) is spiking: 60 this hour against a median of 10 an hour over the last 1 day\(s\)\n--- untrusted production data (\w+) \(the line\)[^\n]*\npayment gateway timeout after <n>ms\n--- end of untrusted data \1 ---$/);
    assert.equal(spikes().length, 1, 'once');
  } finally { F.done(); }
});

// A sensor's lines on one fingerprint, written as the sensors write them: its first qualify, then
// spikes in hours on two days (Orient wants a signal on two days or from two writers).
function fingerprintLines(hand, sensor, fp, spikes, ago = 3 * 86400000, stepMs = 3 * 3600000) {
  const ids = [hand('supervisor', { type: 'observation', source: sensor, detector: 'sensor', subject: `sensor:${sensor}`, kind: 'log-error', detail: `${sensor}: a error log line`, severity: 3, valence: -1, source_key: `sensor:${sensor}:${fp}` }, ago)];
  for (let i = 0; i < spikes; i++) {
    const at = ago - (i + 1) * stepMs;
    const hour = new Date(Date.now() - at).toISOString().slice(0, 13);
    ids.push(hand('supervisor', { type: 'observation', source: sensor, detector: 'sensor', subject: `sensor:${sensor}`, kind: 'spike', detail: `${sensor}: a log line is spiking`, severity: 4, valence: -1, source_key: `sensor:${sensor}:spike:${fp}:${hour}` }, at));
  }
  return ids;
}

test('orient: one signal per fingerprint; a noise ruling clears it until it is corrected', () => {
  const F = fleetFixture('ooda-orient');
  const { old, ok, run } = F;
  const hand = handFor(F);
  try {
    const ids = fingerprintLines(hand, 'web', 'log:L1', 4, 6 * 86400000, 86400000); // five days, so the signal forms whatever the hour
    const signals = () => json(ok(old, ['orient', '--json'])).filter((c) => c.count);
    const [sig, ...more] = signals();
    assert.deepEqual(more, [], 'one signal');
    assert.equal(sig.key, 'web:log:L1', 'keyed on the fingerprint, not each spike\'s hour');
    assert.deepEqual([...sig.ids].sort(), [...ids].sort());
    assert.match(ok(old, ['orient']), /^web:log:L1 {2}x5/m);
    // a noise ruling names the observations it explains
    assert.match(run(old, ['decide', '--class', 'orient-noise', '--refs', 'web:log:L1', '--', 'bots'], SUP).err, /a noise ruling names the observations it explains/);
    const d = ok(old, ['decide', '--class', 'orient-noise', '--refs', 'web:log:L1', ...ids, '--', 'bots crawling an old route'], SUP).trim();
    assert.deepEqual(signals(), [], 'the ruling explains it');
    assert.equal(one(F, d).stage, 'decide');
    // the owner corrects it: the signal is unexplained again
    ok(old, ['correct', d, '--reason', 'not bots: real customers']);
    assert.equal(signals()[0]?.key, 'web:log:L1', 'a corrected ruling explains nothing');
  } finally { F.done(); }
});

test('set-asides cite what they set aside: an ack its finding\'s observations, an ignore its fingerprint\'s, newest 40', () => {
  const F = fleetFixture('ooda-setaside');
  const { old, ok } = F;
  const hand = handFor(F);
  try {
    const s = sensorFixture(F);
    // a sensor and no discovery yet: sensor-discovery-due is live; 41 days of it observed
    const found = [...Array(41)].map((_, i) => hand('supervisor', { type: 'observation', source: 'metrics', detector: 'metrics', subject: 'sensors', kind: 'sensor-discovery-due', detail: 'production has not been looked over yet', severity: 1, valence: -1, source_key: 'metrics:sensor-discovery-due:sensors' }, (41 - i) * 86400000));
    const a = one(F, ok(old, ['ack', 'sensor-discovery-due', 'sensors', '--reason', 'next week'], SUP).split(':')[0]);
    assert.equal(a.refs.length, 40, 'at most 40');
    assert.deepEqual([...a.refs].sort(), found.slice(1).sort(), 'the newest 40');
    assert.equal(a.source_ref, 'metrics:sensor-discovery-due:sensors', 'the finding\'s key, for the rest');
    // an ignore: the fingerprint's observations
    const fps = s.read('fingerprints.json');
    fps['log:L1'] = { kind: 'log', first_seen: new Date().toISOString(), total: 1, users: 0, level: 'error', template: 'boom' };
    s.put('fingerprints.json', fps);
    const obs = fingerprintLines(hand, 'fake', 'log:L1', 40, 30 * 86400000);
    const ig = one(F, ok(old, ['sensor', 'ignore', 'fake:log:L1', '--reason', 'bots'], SUP).split(':')[0]);
    assert.equal(ig.refs.length, 40);
    assert.deepEqual([...ig.refs].sort(), obs.slice(1).sort(), 'the newest 40');
    assert.equal(ig.source_ref, 'fake:log:L1');
    assert.equal(ig.stage, 'decide');
    // a long reason costs refs, never the line
    ok(old, ['sensor', 'unignore', 'fake:log:L1'], SUP);
    const long = one(F, ok(old, ['sensor', 'ignore', 'fake:log:L1', '--reason', 'b'.repeat(3000)], SUP).split(':')[0]);
    assert.ok(long.refs.length > 0 && long.refs.length < 40, `${long.refs.length} refs fit beside a long reason`);
  } finally { F.done(); }
});

test('sensor-untriaged: a sensor\'s escalation nobody folded, ignored or ruled noise, while the supervisor runs', () => {
  const F = fleetFixture('ooda-untriaged');
  const { old, ok } = F;
  const hand = handFor(F);
  try {
    const s = sensorFixture(F);
    const H = 3600000;
    const esc = (fp, severity, ago, sensor = 'fake') => hand('supervisor', { type: 'observation', source: sensor, detector: 'sensor', subject: `sensor:${sensor}`, kind: 'log-error', detail: `${sensor}: a error log line`, severity, valence: -1, source_key: `sensor:${sensor}:log:${fp}` }, ago);
    const u1 = esc('U1', 3, 3 * H);
    esc('U2', 2, 3 * H + 1000); // under severity 3
    esc('U3', 3, H); // not overdue yet
    esc('U4', 3, 3 * H + 2000, 'gone'); // a sensor no longer in the settings
    esc('U5', 3, 3 * H + 3000);
    const u6 = esc('U6', 3, 3 * H + 4000);
    const fps = s.read('fingerprints.json');
    fps['log:U5'] = { kind: 'log', first_seen: new Date().toISOString(), total: 1, users: 0, level: 'error', template: 'boom' };
    s.put('fingerprints.json', fps);
    ok(old, ['sensor', 'ignore', 'fake:log:U5', '--reason', 'bots'], SUP);
    ok(old, ['decide', '--class', 'orient-noise', '--refs', 'fake:log:U6', u6, '--', 'a health check, by design'], SUP);
    const findings = () => json(ok(old, ['metrics', '--json'])).findings.filter((x) => ['sensor-untriaged', 'incident-unowned'].includes(x.kind));
    assert.deepEqual(findings(), [], 'nothing while the supervisor is not running');
    // the supervisor's wait is alive
    fs.writeFileSync(path.join(old, 'docs/devteam/run/sensors/.wait-alive'), '');
    const [f, ...rest] = findings();
    assert.deepEqual(rest, [], JSON.stringify(rest));
    assert.equal(f.kind, 'sensor-untriaged');
    assert.equal(f.subject, 'fake:log:U1');
    assert.match(f.detail, /severity 3/);
    assert.match(f.suggestion, /fold it into an incident, ignore it, or rule it noise/);
    // an incident takes it: untriaged stops, and incident-unowned takes over after its hour
    hand('supervisor', { type: 'problem', title: 'payment errors', severity: 3, realized: true, status: 'open', threatens: [], refs: [u1], fingerprints: ['fake:log:U1'], sensor: 'fake' }, 2 * H);
    assert.deepEqual(findings().map((x) => x.kind), ['incident-unowned']);
  } finally { F.done(); }
});

test('a kit lesson keeps its tag through Orient: stage orient, listed by knowledge --kit, untouched by a noise ruling', () => {
  const F = fleetFixture('ooda-kit-lesson');
  const { old, ok } = F;
  try {
    const o1 = ok(old, ['observe', '--subject', 'app', '--kind', 'friction', '--detail', 'the kit made me retype it'], SUP).trim();
    const k = ok(old, ['knowledge', 'add', '--kind', 'lesson', '--scope', 'project', '--statement', 'the kit should remember the last value', '--evidence', o1, '--kit'], SUP).match(/k-\S+/)[0];
    ok(old, ['decide', '--class', 'orient-noise', '--refs', `note:app`, o1, '--', 'one-off'], SUP);
    const listed = json(ok(old, ['knowledge', '--kit', '--json']));
    assert.ok(listed.some((x) => x.id === k), 'still a kit lesson');
    const rec = json(ok(old, ['log', '--id', k, '--json']))[0];
    assert.equal(rec.stage, 'orient');
  } finally { F.done(); }
});

test('an open incident holds its fingerprint; a noise ruling by key covers its signal; a hand reading is refused', () => {
  const F = fleetFixture('ooda-held');
  const { old, ok, run } = F;
  try {
    const hand = handFor(F);
    const signals = () => json(ok(old, ['orient', '--json'], SUP)).clusters ?? json(ok(old, ['orient', '--json'], SUP));
    const ids = fingerprintLines(hand, 'web', 'log:L1', 4, 6 * 86400000, 86400000);
    const key = 'web:log:L1';
    // an open incident that cites only the first observation still holds the whole fingerprint
    hand('supervisor', { type: 'problem', title: 'web errors', severity: 3, realized: true, status: 'open', refs: [ids[0]], fingerprints: [key], sensor: 'web' }, 1000);
    assert.ok(!JSON.stringify(signals()).includes(key), 'held by its open incident');
    // a ruling naming the key covers the signal's observations before it, cited or not
    const F2 = fleetFixture('ooda-ruled');
    try {
      const h2 = handFor(F2);
      const first = fingerprintLines(h2, 'web', 'log:L1', 3, 6 * 86400000, 86400000);
      F2.ok(F2.old, ['decide', '--class', 'orient-noise', '--refs', key, ...first, '--', 'bots'], SUP);
      fingerprintLines(h2, 'web', 'log:L1', 3, 2 * 86400000, 12 * 3600000).slice(1);
      assert.ok(!JSON.stringify(json(F2.ok(F2.old, ['orient', '--json'], SUP))).includes(key), 'the ruling covers every observation on the signal before it, cited or not');
    } finally { F2.done(); }
    assert.match(run(old, ['observe', '--subject', 'g-x', '--kind', 'reading', '--source', 'repo', '--detail', '5'], SUP).err, /goal's readings come from the kit/);
  } finally { F.done(); }
});

test('a noise ruling covers its signal up to the ruling: an escalation after it is untriaged again', () => {
  const F = fleetFixture('ooda-ruling-window');
  const F0 = fleetFixture('ooda-ruling-shape');
  const { old, ok } = F;
  const hand = handFor(F);
  try {
    sensorFixture(F);
    const H = 3600000;
    const esc = (ago) => hand('supervisor', { type: 'observation', source: 'fake', detector: 'sensor', subject: 'sensor:fake', kind: 'log-error', detail: 'fake: a error log line', severity: 3, valence: -1, source_key: 'sensor:fake:log:U7' }, ago);
    const before = esc(5 * H);
    // a ruling as decide writes it (its shape from another project), made four hours ago
    const o0 = F0.ok(F0.old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'x'], SUP).trim();
    const d0 = one(F0, F0.ok(F0.old, ['decide', '--class', 'orient-noise', '--refs', 'fake:log:U7', o0, '--', 'a health check'], SUP).match(/d-\S+/)[0]);
    const shape = Object.fromEntries(Object.entries(d0).filter(([k]) => !['id', 'type', 'created_at', 'created_by', 'updates', 'stage', 'refs'].includes(k) && !k.startsWith('__')));
    hand('supervisor', { ...shape, type: 'decision', refs: ['fake:log:U7', before] }, 4 * H);
    fs.mkdirSync(path.join(old, 'docs/devteam/run/sensors'), { recursive: true });
    fs.writeFileSync(path.join(old, 'docs/devteam/run/sensors/.wait-alive'), '');
    const untriaged = () => json(ok(old, ['metrics', '--json'])).findings.filter((x) => x.kind === 'sensor-untriaged' && x.subject === 'fake:log:U7');
    assert.deepEqual(untriaged(), [], 'the ruling covers what came before it');
    const after = esc(3 * H);
    const [f] = untriaged();
    assert.ok(f, 'an escalation after the ruling gets a fresh look');
    assert.match(f.detail, new RegExp(after));
    assert.doesNotMatch(f.detail, new RegExp(before));
  } finally { F.done(); F0.done(); }
});
