// An empty fleet: no worker and no planner has run for stale_after_minutes while the fleet is
// neither parked nor drained. idle-capacity says nothing when no ticket can start, so fleet-idle
// does: how many tickets are ready, held and planned, and the moves that make work, in order. It
// stays quiet while idle-capacity, idle-planning or memory-full names the move, and a planner
// counts as running only while its window is open and it waits on no owner answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fleetFixture, json, line, hasTmux, sessionOf } from './lib/kit.mjs';

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
    ok(old, ['ticket', 'hold', 'ch-02-held', '--for', 'external:pricing', '--until', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), '--reason', 'waits on the pricing answer'], SUP);
    const q = ok(old, ['ask', '--question', 'Which plan names?', '--choices', '[{"label":"Basic/Pro"},{"label":"Free/Team"}]', '--blocks', 'ch-03-asked', '--stake', '1', '--urgency', '2'], SUP).trim().split(/\s/)[0];
    ok(old, ['ticket', 'hold', 'ch-03-asked', '--for', q, '--reason', 'waits on the plan names', '--whole', 'every part names the plans'], SUP);
    // the last worker parked two hours ago
    by('ch-05-parked', { to: 'parked', note: 'parked' }, 2 * 3600000);
    const findings = () => json(ok(old, ['metrics', '--json'])).findings;
    // a ticket can start: idle-capacity says so, and fleet-idle doesn't say it again
    assert.ok(findings().some((x) => x.kind === 'idle-capacity'), 'ch-01-ready can start');
    assert.equal(idle(), undefined, 'quiet while idle-capacity names the move');

    // nothing can start: the last ready ticket waits on the owner too
    ok(old, ['ticket', 'hold', 'ch-01-ready', '--for', 'external:copy', '--until', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), '--reason', 'waits on the copy answer'], SUP);
    assert.ok(!findings().some((x) => x.kind === 'idle-capacity'), 'nothing can start');
    const f = idle();
    assert.ok(f, 'two hours with nothing running');
    assert.equal(f.severity, 'medium');
    assert.equal(f.subject, 'fleet');
    assert.match(f.detail, /^no worker or planner has run for 2\.0h \(last sign of life \S+\); 0 tickets ready, 4 held, 1 planned$/);
    assert.match(f.suggestion, /^in order: 1\. add a chore from what the metrics or the code point at; 2\. split a held ticket so the part that doesn't need the owner runs \(ch-01-ready, ch-02-held, ch-03-asked\); 3\. give an open no-default question a default \(/);
    assert.ok(f.suggestion.includes(q), `names the question without a default: ${f.suggestion}`);
    assert.match(f.suggestion, /4\. propose the next goal from strategy\.md/);
    const order = ['1. add', '2. split', '3. give', '4. propose'].map((s) => f.suggestion.indexOf(s));
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'the moves in order');

    // planners. A plan branch whose last commit is three hours old and whose window is gone was
    // left behind: it is no sign of life and doesn't count as running.
    const planAt = (branch, agoMs) => {
      const d = new Date(Date.now() - agoMs).toISOString();
      const sha = execFileSync('git', ['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', `design ${branch}`], { cwd: old, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
      F.g(['branch', '-f', branch, sha], old);
    };
    planAt('plan/left', 3 * 3600000);
    assert.ok(idle(), 'an abandoned plan branch, no window: still idle');
    if (hasTmux) {
      // its window open: a planner designing, quiet however long since it last wrote
      const tmux = (args) => spawnSync('tmux', args, { env: F.env({}), encoding: 'utf8' });
      const s = sessionOf(old, 'fleet-idle');
      assert.equal(tmux(['new-session', '-d', '-s', s, '-n', 'plan-left', 'sleep 600']).status, 0);
      try {
        assert.equal(idle(), undefined, 'a planner with its window open is running');
        // but one whose design waits on the owner's answer is the stuck fleet
        ok(old, ['ask', '--question', 'Ship the left design?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--links', JSON.stringify([{ title: 'The draft design', path: 'docs/devteam/project/designs/left.md', ref: 'plan/left' }]), '--stake', '1', '--urgency', '2'], SUP);
        assert.ok(idle(), 'a planner waiting on the owner does not count as running');
      } finally { tmux(['kill-server']); }
    }
    F.g(['branch', '-D', 'plan/left'], old);
    // a planner's branch that moved a moment ago is a sign of life
    planAt('plan/fresh', 60000);
    assert.equal(idle(), undefined, 'a plan commit a minute ago');
    F.g(['branch', '-D', 'plan/fresh'], old);
    assert.ok(idle());

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
