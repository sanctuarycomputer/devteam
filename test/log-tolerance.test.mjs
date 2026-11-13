// A kit reads a log a newer kit wrote: a field or a type it doesn't know is set aside and reported,
// never an error, so log-check passes, log-sync syncs and the fold still applies what it knows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const month = () => new Date().toISOString().slice(0, 7);

test('a newer kit\'s field or type is reported, not refused; known fields still fold', () => {
  const F = fleetFixture('tolerance');
  const { old, ok, run } = F;
  try {
    const id = ok(old, ['problem', 'add', '--title', 'slow page', '--severity', '1'], SUP).trim();
    const file = path.join(old, 'docs/devteam/run/log', `supervisor-${month()}.jsonl`);
    const at = () => new Date().toISOString();
    // a set line from a newer kit: one known field, one it doesn't know
    fs.appendFileSync(file, line({ id, type: 'problem', op: 'set', at: at(), by: 'supervisor', status: 'owned', figures: { informed: 1 } }));
    // a whole line of a type this kit doesn't know
    fs.appendFileSync(file, line({ id: `l-${id.slice(2)}`, type: 'learning', op: 'new', at: at(), by: 'supervisor', kind: 'outcome' }));
    const r = run(old, ['log-check']);
    assert.equal(r.status, 0, r.err || r.out);
    assert.match(r.out, /a newer kit's line, or a mistyped name: upgrade, or check .*figures/);
    assert.match(r.out, /a newer kit's line, or a mistyped name: upgrade, or check .*type "learning"/);
    const o = json(ok(old, ['log', '--id', id, '--json']))[0];
    assert.equal(o.status, 'owned', 'the known field on the same line still applies');
    assert.equal(o.figures, undefined, 'an unknown field is never read');
    // a line set aside still has its envelope checked: a writer that isn't its file's, an owner's
    // channel missing, no v
    fs.appendFileSync(file, line({ id: `l-${id.slice(2)}x`, type: 'learning', op: 'new', at: at(), by: 'owner', channel: 'cli', kind: 'outcome' }));
    const bad = run(old, ['log-check']);
    assert.notEqual(bad.status, 0);
    assert.match(bad.out + bad.err, /does not match the file's writer/);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter((l) => !l.includes(`l-${id.slice(2)}x`)).join('\n'));
    fs.appendFileSync(file, `${JSON.stringify({ id, type: 'problem', op: 'set', at: at(), by: 'supervisor', figures: 1 })}\n`);
    assert.match(run(old, ['log-check']).out + run(old, ['log-check']).err, /v is required|v must be/);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter((l) => !(l.includes('"figures":1') && !l.includes('"v"'))).join('\n'));
    // a known field the writer may not set is still an error: tolerance is for unknown names only
    fs.appendFileSync(file, line({ id, type: 'problem', op: 'set', at: at(), by: 'supervisor', title: 'renamed' }));
    assert.notEqual(run(old, ['log-check']).status, 0);
  } finally { F.done(); }
});

test('log-sync lands a file whose lines carry a field this kit doesn\'t know', () => {
  const F = fleetFixture('tolerance-sync');
  const { old, ok } = F;
  try {
    const id = ok(old, ['problem', 'add', '--title', 'slow page', '--severity', '1'], SUP).trim();
    const file = path.join(old, 'docs/devteam/run/log', `supervisor-${month()}.jsonl`);
    fs.appendFileSync(file, line({ id, type: 'problem', op: 'set', at: new Date().toISOString(), by: 'supervisor', status: 'owned', figures: { informed: 1 } }));
    fs.appendFileSync(file, line({ id: `l-${id.slice(2)}`, type: 'learning', op: 'new', at: new Date().toISOString(), by: 'supervisor', kind: 'outcome' }));
    const r = F.run(old, ['log-sync'], SUP);
    assert.equal(r.status, 0, r.err || r.out);
    assert.doesNotMatch(`${r.err}\n${r.out}`, /not synced/);
    const landed = F.g(['show', `chore-log:docs/devteam/project/log/supervisor-${month()}.jsonl`], old);
    assert.match(landed, /"figures"/, 'the line lands as written, for a newer kit to read');
    // and the check merge runs on a log PR passes it: the line breaks no rule this kit knows
    const body = path.join(F.base, 'body.md');
    fs.writeFileSync(body, '## One-way doors\n\nNone.\n');
    const c = F.run(old, ['check-pr', '--head-ref', 'chore-log', '--sha', F.g(['rev-parse', 'chore-log'], old), '--title', 'chore-log: log', '--body-file', body]);
    assert.equal(c.status, 0, c.err || c.out);
    // a newer kit's line is still held to time order: one dated in the future fails the check
    const wt = path.join(F.base, 'wt-future');
    F.g(['worktree', 'add', '-q', '--detach', wt, 'chore-log'], old);
    fs.appendFileSync(path.join(wt, `docs/devteam/project/log/supervisor-${month()}.jsonl`), line({ id: 'l-x', type: 'learning', op: 'new', at: '2099-01-01T00:00:00.000Z', by: 'supervisor' }));
    F.g(['commit', '-qam', 'a line from the future'], wt);
    const late = F.run(old, ['check-pr', '--head-ref', 'chore-log', '--sha', F.g(['rev-parse', 'HEAD'], wt), '--title', 'chore-log: log', '--body-file', body]);
    assert.notEqual(late.status, 0);
    assert.match(late.out + late.err, /is not in|after the commit time/);
    // and one whose writer isn't its file's fails it too, though its type is unknown here
    F.g(['reset', '-q', '--hard', 'HEAD~1'], wt);
    fs.appendFileSync(path.join(wt, `docs/devteam/project/log/supervisor-${month()}.jsonl`), line({ id: 'l-y', type: 'learning', op: 'new', at: new Date().toISOString(), by: 'owner', channel: 'cli' }));
    F.g(['commit', '-qam', 'a line by the wrong writer'], wt);
    const forged = F.run(old, ['check-pr', '--head-ref', 'chore-log', '--sha', F.g(['rev-parse', 'HEAD'], wt), '--title', 'chore-log: log', '--body-file', body]);
    assert.notEqual(forged.status, 0);
    assert.match(forged.out + forged.err, /does not match the file's writer/);
  } finally { F.done(); }
});

test('every kind of line takes a newer kit\'s field: new lines, owner lines, plan files; envelope checks still hold', () => {
  const F = fleetFixture('tolerance-kinds');
  const { old, ok, run } = F;
  try {
    const at = () => new Date().toISOString();
    const sup = path.join(old, 'docs/devteam/run/log', `supervisor-${month()}.jsonl`);
    // an unknown field on a new line, and a prototype name: both stripped and listed (not figures,
    // which an observation now has)
    const oid = ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'seed'], SUP).trim();
    const nid = `${oid.replace(/-\d{9}-supervisor$/, '')}-${String(Number(oid.split('-')[2]) + 1).padStart(9, '0')}-supervisor`;
    fs.appendFileSync(sup, line({ id: nid, type: 'observation', op: 'new', at: at(), by: 'supervisor', source: 'metrics', subject: 'app', kind: 'note', detail: 'from a newer kit', insights: { n: 1 }, constructor: 1 }));
    // a set line with only unknown fields changes nothing
    const pid = ok(old, ['problem', 'add', '--title', 'slow page', '--severity', '1'], SUP).trim();
    fs.appendFileSync(sup, line({ id: pid, type: 'problem', op: 'set', at: at(), by: 'supervisor', figures: { n: 2 } }));
    assert.equal(json(ok(old, ['log', '--id', pid, '--json']))[0].updates?.length ?? 0, 0, 'a set of only unknown fields changes nothing');
    // an owner line with its channel and an unknown field
    const own = path.join(old, 'docs/devteam/run/log', `owner-${month()}.jsonl`);
    fs.appendFileSync(own, line({ id: pid, type: 'problem', op: 'set', at: at(), by: 'owner', channel: 'cli', status: 'owned', figures: { n: 3 } }));
    // a planner's plan file, as an older planner worktree would land it
    ok(old, ['feature', 'add', 'pay', '--json', JSON.stringify({ title: 'pay', goals: [], stories: [] })], SUP);
    const plan = path.join(old, 'docs/devteam/project/log/plan-pay.jsonl');
    fs.mkdirSync(path.dirname(plan), { recursive: true });
    fs.appendFileSync(plan, line({ id: 'pay-01-start', type: 'ticket', op: 'new', at: at(), by: 'plan-pay', title: 'start', feature: 'pay', component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['src/**'], done_when: ['its test passes in CI'], figures: { n: 4 } }));
    const r = run(old, ['log-check']);
    assert.equal(r.status, 0, r.err || r.out);
    for (const want of [/observation\.insights, constructor/, /problem\.figures/, /owner-.*problem\.figures/, /plan-pay\.jsonl.*ticket\.figures/]) assert.match(r.out, want);
    const o = json(ok(old, ['log', '--id', nid, '--json']))[0];
    assert.equal(o.detail, 'from a newer kit');
    assert.ok(!Object.hasOwn(o, 'insights') && !Object.hasOwn(o, 'constructor'));
    assert.equal(json(ok(old, ['log', '--id', pid, '--json']))[0].status, 'owned', 'the owner\'s known field applies');
    assert.ok(json(ok(old, ['log', '--id', 'pay-01-start', '--json']))[0], 'the plan file\'s ticket folds');
    assert.equal(json(ok(old, ['dashboard-data'])).ooda.log.unknown, 4, 'the dashboard counts what a newer kit wrote');
    // the envelope still holds: an owner line without its channel is an error, field or no field
    fs.appendFileSync(own, line({ id: pid, type: 'problem', op: 'set', at: at(), by: 'owner', status: 'open', figures: { n: 5 } }));
    assert.match(run(old, ['log-check']).out + run(old, ['log-check']).err, /channel is on every owner line/);
  } finally { F.done(); }
});
