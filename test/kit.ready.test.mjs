import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture, hasTmux } from './lib/kit.mjs';

// No caps by default: what keeps parallel workers apart is touches. ready marks a ready ticket whose
// touches overlap a running one's (build rows only), idle capacity leaves it out, and caps the owner
// sets still hold.
test('ready marks a touches overlap with a running ticket, idle capacity skips it, and set caps still hold', async () => {
  const F = threadsFixture('overlap');
  try {
    const H = 3600000;
    const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
    const phaseLine = (id, from, to, agoMs) => F.hand(id, { id: `h-${stamp(new Date(Date.now() - agoMs))}-${id}`, type: 'phase', from, to }, agoMs, `${id}.jsonl`);
    F.sup(['feature', 'add', 'olap', '--json', JSON.stringify({ title: 'Overlap', goals: [F.goal], stories: [{ id: 'OL-S1', text: 'parallel workers stay apart', release: 'v1.0.0' }] })]);
    const add = (id, touches, depends_on = []) => F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'olap', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['OL-S1'], depends_on, touches, done_when: ['its test passes in CI'] })]);
    add('o-01-running', ['src/a/**']);
    add('o-02-overlaps', ['src/a/x.js']);
    add('o-03-apart', ['lib/**']);
    add('o-04-after', ['src/a/y.js'], ['o-01-running']);
    // o-01 is a running worker: a phase line and its worktree here
    phaseLine('o-01-running', null, 'starting', 60000);
    phaseLine('o-01-running', 'starting', 'build', 30000);
    F.g(['worktree', 'add', '-q', '-b', 'ticket/o-01-running', path.join(F.old, '.worktrees', 'o-01-running'), 'origin/main'], F.old);
    const r = JSON.parse(F.sup(['ready', '--json']));
    assert.ok(r.active.includes('o-01-running'));
    const row = (id) => r.ready.find((x) => x.id === id);
    assert.deepEqual(row('o-02-overlaps').overlaps_active, ['o-01-running'], 'an overlapping ready ticket is marked');
    assert.equal(row('o-03-apart').overlaps_active, undefined, 'a disjoint one is not');
    assert.ok(!row('o-04-after'), 'a ticket behind an unmerged dependency is not ready');
    const text = F.sup(['ready']);
    assert.match(text, /o-02-overlaps .*touches overlap o-01-running: start it once that merges/);
    assert.doesNotMatch(text.split('\n').find((l) => / o-03-apart /.test(l)) ?? '', /overlap/);
    assert.match(text, /^active workers: 1\/no cap$/m);
    // plan-ahead: o-04 specs and plans beside its running dependency, and is told nothing about overlap
    const pa = JSON.parse(F.sup(['ready', '--plan-ahead', '--json']));
    assert.equal(pa.ready.find((x) => x.id === 'o-04-after')?.mode, 'plan-ahead');
    assert.equal(pa.ready.find((x) => x.id === 'o-04-after').overlaps_active, undefined, 'plan-ahead rows are not marked');
    // idle capacity offers only what can start, and says how many wait
    const findings = JSON.parse(F.sup(['metrics', '--json'])).findings;
    if (!findings.some((f) => f.kind === 'memory-full')) {
      const idle = findings.find((f) => f.kind === 'idle-capacity' && /ready$/.test(f.subject));
      assert.ok(idle, 'idle capacity');
      assert.match(idle.suggestion, /o-03-apart/);
      assert.doesNotMatch(idle.suggestion, /o-02-overlaps/, 'never suggests a ticket ready says must wait');
      assert.match(idle.detail, /1 more wait on a running ticket/);
    }
    // caps the owner sets still hold: N/M, the component at cap, and idle capacity stops at the cap
    const sf = path.join(F.old, 'docs/devteam/project/settings.md');
    const was = fs.readFileSync(sf, 'utf8');
    assert.ok(was.includes('"agent_command": "true"') && !was.includes('max_active_tickets'));
    fs.writeFileSync(sf, was.replace('"agent_command": "true"', '"max_active_tickets": 1, "max_active_per_component": 1, "agent_command": "true"'));
    F.g(['commit', '-qm', 'caps', '--', 'docs/devteam/project/settings.md'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    const capped = F.sup(['ready']);
    assert.match(capped, /^active workers: 1\/1$/m);
    assert.match(capped, /o-03-apart .*\(component at cap\)/);
    const rc = JSON.parse(F.sup(['ready', '--json']));
    assert.equal(rc.caps.max_active_tickets, 1);
    assert.ok(!JSON.parse(F.sup(['metrics', '--json'])).findings.some((f) => f.kind === 'idle-capacity' && /ready$/.test(f.subject)), 'at the cap, no idle capacity');
    // 0 reads as no cap for both settings
    fs.writeFileSync(sf, was.replace('"agent_command": "true"', '"max_active_tickets": 0, "max_active_per_component": 0, "agent_command": "true"'));
    F.g(['commit', '-qm', 'zero caps', '--', 'docs/devteam/project/settings.md'], F.old);
    F.g(['push', '-q', 'origin', 'HEAD:main'], F.old);
    const zero = F.sup(['ready']);
    assert.match(zero, /^active workers: 1\/no cap$/m);
    assert.doesNotMatch(zero, /component at cap/);
  } finally { F.done(); }
});

// A stopped or held launch isn't a stuck session (kit-238): kit-211 was stopped a minute after launch
// for the component cap (no window, no worktree), then held, and read as "starting, 109m STALE", a
// high stale-worker on every sweep, and a worker toward the cap. Only a real stuck worker is stale.
test('a held ticket or a stopped launch is not a stuck worker; a real stuck one still is', async () => {
  const F = threadsFixture('stopped-launch');
  try {
    const H = 3600000;
    const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
    // a phase line as the ticket's worker would have written it agoMs ago, in its own log file
    const phaseLine = (id, from, to, agoMs) => F.hand(id, { id: `h-${stamp(new Date(Date.now() - agoMs))}-${id}`, type: 'phase', from, to }, agoMs, `${id}.jsonl`);
    F.sup(['feature', 'add', 'stops', '--json', JSON.stringify({ title: 'Stops', goals: [F.goal], stories: [{ id: 'ST-S1', text: 'stopped launches read right', release: 'v1.0.0' }] })]);
    const ids = ['w-01-held', 'w-02-stopped', 'w-03-stuck', 'w-04-held-stopped'];
    // w-02-stopped touches other files than the running w-03 and w-05: idle capacity offers only a ticket that can start
    for (const id of ids) F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'stops', component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['ST-S1'], depends_on: [], touches: [id === 'w-02-stopped' ? 'lib/**' : 'src/**'], done_when: ['the src test passes in CI'] })]);
    for (const id of ['w-01-held', 'w-02-stopped', 'w-04-held-stopped']) phaseLine(id, null, 'starting', 2 * H);
    phaseLine('w-03-stuck', null, 'starting', 2 * H + 60000);
    phaseLine('w-03-stuck', 'starting', 'build', 2 * H);
    for (const id of ['w-01-held', 'w-04-held-stopped']) F.sup(['ticket', 'set', id, '--json', JSON.stringify({ held: 'waits for the cap', held_for: ['external:the cap'], held_until: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10) })]);
    // its worktree is here, so it is no stopped launch, window or not: a worker gone quiet (another
    // component, so the web counts below stay the four tickets')
    F.sup(['ticket', 'add', 'w-05-worktree', '--json', JSON.stringify({ title: 'w-05-worktree', feature: 'stops', component: 'api', kind: 'build', size: 'S', risk: 'normal', serves: ['ST-S1'], depends_on: [], touches: ['src/**'], done_when: ['the src test passes in CI'] })]);
    phaseLine('w-05-worktree', null, 'starting', 2 * H);
    F.g(['worktree', 'add', '-q', '-b', 'ticket/w-05-worktree', path.join(F.old, '.worktrees', 'w-05-worktree'), 'origin/main'], F.old);
    const staleOf = () => JSON.parse(F.sup(['metrics', '--json'])).findings.filter((f) => f.kind === 'stale-worker' && ids.includes(f.subject));
    const statusRow = (id) => F.sup(['status']).split('\n').find((l) => new RegExp(`\\s${id}(\\s|$)`).test(l)) ?? '';
    const statusJson = () => new Map(JSON.parse(F.sup(['status', '--json'])).tickets.map((r) => [r.id, r]));
    const ready = () => JSON.parse(F.sup(['ready', '--json']));
    // no tmux session at all (or no tmux): a stopped launch is one by its log and its missing worktree
    {
      const st = statusJson();
      assert.equal(st.get('w-02-stopped').not_started, true);
      assert.equal(st.get('w-04-held-stopped').not_started, true);
      assert.ok(!staleOf().some((f) => ['w-02-stopped', 'w-04-held-stopped'].includes(f.subject)), 'a stopped launch is not stale');
      assert.match(statusRow('w-02-stopped'), /not started/);
      assert.doesNotMatch(statusRow('w-02-stopped'), /STALE/);
      assert.match(statusRow('w-04-held-stopped'), /HELD: waits for the cap/, 'held and stopped: the hold wins on the line');
      assert.doesNotMatch(statusRow('w-04-held-stopped'), /STALE|not started/);
      const r = ready();
      assert.ok(r.ready.some((x) => x.id === 'w-02-stopped'), 'a stopped launch is ready to start again');
      assert.ok(r.held.some((x) => x.id === 'w-04-held-stopped'));
      assert.ok(!r.active.includes('w-02-stopped') && !r.active.includes('w-04-held-stopped'));
      // a starting worker with its worktree here is no stopped launch: stale, and a worker
      const findings = JSON.parse(F.sup(['metrics', '--json'])).findings;
      assert.ok(findings.some((f) => f.kind === 'stale-worker' && f.subject === 'w-05-worktree'), 'a worktree means it launched');
      assert.ok(!statusJson().get('w-05-worktree').not_started);
      assert.ok(r.active.includes('w-05-worktree'));
      // idle capacity counts the same workers (w-03-stuck and w-05-worktree) and offers the stopped
      // launch; over the machine's memory ceiling memory-full says so instead
      if (!findings.some((f) => f.kind === 'memory-full')) {
        const idle = findings.find((f) => f.kind === 'idle-capacity' && /ready$/.test(f.subject));
        assert.ok(idle, 'idle capacity');
        assert.match(idle.detail, /^2\/(\d+|no cap) workers active/);
        assert.match(idle.suggestion, /w-02-stopped/);
      }
    }
    if (!hasTmux) return;
    // windows for the stuck worker and the held one: held is then held, not a stopped launch
    const session = /tmux_session=(\S+)/.exec(F.sup(['whoami']))?.[1];
    assert.ok(session, 'whoami names the tmux session');
    spawnSync('tmux', ['new-session', '-d', '-s', session, '-n', 'w-03-stuck', 'sleep 600'], { env: F.env() });
    spawnSync('tmux', ['new-window', '-d', '-t', `=${session}`, '-n', 'w-01-held', 'sleep 600'], { env: F.env() });
    const stale = staleOf();
    assert.deepEqual(stale.map((f) => f.subject), ['w-03-stuck'], 'only the real stuck worker is stale');
    assert.equal(stale[0].severity, 'high');
    assert.match(statusRow('w-01-held'), /HELD: waits for the cap/);
    assert.doesNotMatch(statusRow('w-01-held'), /STALE/);
    assert.match(statusRow('w-02-stopped'), /not started/);
    assert.match(statusRow('w-03-stuck'), /\[build, \d+m STALE\]/);
    assert.match(statusRow('w-04-held-stopped'), /HELD: waits for the cap/);
    const st = statusJson();
    assert.deepEqual(ids.filter((id) => st.get(id).not_started), ['w-02-stopped', 'w-04-held-stopped']);
    assert.ok(!st.get('w-01-held').not_started, 'a held ticket with a window is not a stopped launch');
    const r = ready();
    assert.deepEqual(r.active.filter((id) => ids.includes(id)), ['w-03-stuck']);
    assert.equal(r.active_per_component.web, 1);
    assert.equal(r.caps.max_active_per_component, null, 'no cap per component by default');
    assert.ok(!/component at cap/.test(F.sup(['ready'])), 'and so none is ever at cap');
    assert.deepEqual(r.held.map((x) => x.id).filter((id) => ids.includes(id)).sort(), ['w-01-held', 'w-04-held-stopped']);
    assert.ok(r.ready.some((x) => x.id === 'w-02-stopped'));
    assert.match(F.sup(['ready']), /^active workers: 2\//m, 'w-03-stuck and w-05-worktree; neither held nor stopped');
    // worker <id> starts a stopped launch as a new start: a draining goal starts nothing new
    F.sup(['goal', 'hold', F.goal, 'drain', '--reason', 'test', '--for', 'external:test', '--until', new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)]);
    assert.match(F.fails(['worker', 'w-02-stopped'], F.SUP), /draining goal.*starts nothing new/);
    F.sup(['goal', 'hold', F.goal, 'run', '--reason', 'test']);
    assert.match(F.sup(['worker', 'w-02-stopped']), /made worker w-02-stopped/);
    assert.ok(fs.existsSync(path.join(F.old, '.worktrees', 'w-02-stopped')), 'its worktree is made');
    const mine = fs.readFileSync(path.join(F.logDir, 'w-02-stopped.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.type === 'phase');
    assert.equal(mine.length, 2, 'a fresh starting line');
    assert.equal(mine.at(-1).to, 'starting');
    assert.ok(Date.now() - Date.parse(mine.at(-1).at) < 10 * 60000);
    assert.doesNotMatch(statusRow('w-02-stopped'), /not started/);
  } finally {
    spawnSync('tmux', ['kill-server'], { env: F.env() });
    F.done();
  }
});
