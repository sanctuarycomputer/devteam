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
    want(hand('supervisor', { type: 'observation', source: 'owner', subject: 'g-20260101-000000000-supervisor', kind: 'reading', detail: 'the owner said yes to q-20260101-000000000-supervisor', measure: { value: 1 }, approved: 'q-20260101-000000000-supervisor' }, 85000), 'owner-answer', 'q-20260101-000000000-supervisor', 'measurement');
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
    want(ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'the owner said so in chat', '--source', 'owner-chat'], SUP).trim(), 'owner-chat', null);
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
