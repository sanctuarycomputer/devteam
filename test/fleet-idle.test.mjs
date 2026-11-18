// An empty fleet: no worker and no planner has run for stale_after_minutes while the fleet is
// neither parked nor drained. idle-capacity says nothing when no ticket can start, so fleet-idle
// does: how many tickets are ready, held and planned, and the moves that make work, in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

test('fleet-idle: an unparked fleet with no session for half an hour says what to start, in order', () => {
  const F = fleetFixture('fleet-idle');
  const { old, ok } = F;
  const logDir = path.join(old, 'docs/devteam/run/log');
  // a phase line by a worker, written agoMs ago in its own file, as the kit would have
  const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
  const phase = (id, o, agoMs) => { const d = new Date(Date.now() - agoMs); return line({ op: 'new', type: 'phase', from: null, ...o, id: `h-${stamp(d)}-${id}`, at: d.toISOString(), by: id }); };
  const by = (id, o, agoMs) => { fs.mkdirSync(logDir, { recursive: true }); fs.appendFileSync(path.join(logDir, `${id}.jsonl`), phase(id, o, agoMs)); };
  const ticket = (id, extra = {}) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`ch/${id}/**`], done_when: ['the tidy check passes in CI'], ...extra })], SUP);
  const idle = () => json(ok(old, ['metrics', '--json'])).findings.find((f) => f.kind === 'fleet-idle');
  try {
    // a fresh project: nothing has run, and the log began a moment ago
    assert.equal(idle(), undefined, 'a fleet that just started is not idle yet');

    ticket('ch-01-ready');
    ticket('ch-02-held');
    ticket('ch-03-asked');
    ticket('ch-04-next', { depends_on: ['ch-01-ready'] });
    ticket('ch-05-parked');
    ok(old, ['ticket', 'set', 'ch-02-held', '--json', JSON.stringify({ held: 'waits on the pricing answer' })], SUP);
    const q = ok(old, ['ask', '--question', 'Which plan names?', '--choices', '[{"label":"Basic/Pro"},{"label":"Free/Team"}]', '--blocks', 'ch-03-asked', '--stake', '1', '--urgency', '2'], SUP).trim().split(/\s/)[0];
    // the last worker parked two hours ago
    by('ch-05-parked', { to: 'parked', note: 'parked' }, 2 * 3600000);

    const f = idle();
    assert.ok(f, 'two hours with nothing running');
    assert.equal(f.severity, 'medium');
    assert.equal(f.subject, 'fleet');
    assert.match(f.detail, /^no worker or planner has run for 2\.0h \(last sign of life \S+\); 1 ticket ready, 3 held, 1 planned$/);
    assert.match(f.suggestion, /^in order: 1\. start a ready chore \(worker ch-01-ready\); 2\. split a held ticket so the part that doesn't need the owner runs \(ch-02-held, ch-03-asked, ch-05-parked\); 3\. give an open no-default question a default \(/);
    assert.ok(f.suggestion.includes(q), `names the question without a default: ${f.suggestion}`);
    assert.match(f.suggestion, /4\. propose the next goal from strategy\.md/);
    const order = ['1. start', '2. split', '3. give', '4. propose'].map((s) => f.suggestion.indexOf(s));
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'the moves in order');

    // the supervisor's tick reads it: observe-metrics records it as an observation
    ok(old, ['observe-metrics'], SUP);
    assert.ok(json(ok(old, ['log', '--type', 'observation', '--json'])).some((o) => o.kind === 'fleet-idle' && o.source_key === 'metrics:fleet-idle:fleet'));

    // a threshold of the owner's: stale_after_minutes stretched to three hours, two quiet hours are fine
    const sf = path.join(old, 'docs/devteam/project/settings.md');
    const text = fs.readFileSync(sf, 'utf8');
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(block[1], JSON.stringify({ ...JSON.parse(block[1]), stale_after_minutes: 180 }, null, 2)));
    assert.equal(idle(), undefined, 'under a longer stale_after_minutes');
    fs.writeFileSync(sf, text);
    assert.ok(idle());

    // a worker running: not idle
    by('ch-01-ready', { to: 'build', task: 'T1' }, 1000);
    assert.equal(idle(), undefined, 'a worker is running');
    by('ch-01-ready', { to: 'parked', note: 'parked' }, 500);
    assert.equal(idle(), undefined, 'it stopped a moment ago');

    // a parked fleet waits on purpose: nothing to say
    fs.writeFileSync(path.join(logDir, 'ch-01-ready.jsonl'), phase('ch-01-ready', { to: 'parked', note: 'parked' }, 3 * 3600000));
    assert.ok(idle(), 'idle again once its last line is three hours old');
    ok(old, ['fleet', 'park', '--reason', 'owner away'], SUP);
    assert.equal(idle(), undefined, 'a parked fleet is not idle');
  } finally { F.done(); }
});
