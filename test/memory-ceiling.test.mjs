// The machine is shared: several supervisors' fleets on one box with one memory cap. A new worker
// or planner doesn't start while the machine's memory is at the supervisor's machine_memory_ceiling
// (--force does anyway, logged); a resume of a session that ran always does; where the kit can't
// read memory (macOS: no cgroup, no /proc/meminfo) nothing is refused. The idle-capacity and
// idle-planning findings don't suggest a start then; memory-full says the memory is full instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, hasTmux } from './lib/kit.mjs';

const G = 1024 ** 3;
const SUP = { DEVTEAM_ROLE: 'supervisor' };

test('a new worker waits while the machine\'s memory is over the ceiling; a resume and --force start', { skip: !hasTmux && 'no tmux' }, () => {
  const F = fleetFixture('memory-ceiling');
  const { old, ok, run } = F;
  // a 32 GiB container: memory.current less the page cache is what's in use
  const cg = fs.mkdtempSync(path.join(F.base, 'cgroup-'));
  const none = path.join(F.base, 'no-such-file');
  const use = (inUse, max = 32 * G) => {
    fs.writeFileSync(path.join(cg, 'memory.max'), `${max}\n`);
    fs.writeFileSync(path.join(cg, 'memory.current'), `${Math.round(inUse + G)}\n`);
    fs.writeFileSync(path.join(cg, 'memory.stat'), `anon ${Math.round(inUse)}\nfile ${G}\n`);
  };
  const M = { ...SUP, DEVTEAM_CGROUP: cg, DEVTEAM_MEMINFO: none };
  const ticket = (id) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['ch/**'], done_when: ['the tidy check passes in CI'] })], SUP);
  const starts = () => json(ok(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'worker-slots');
  const findings = (env) => json(ok(old, ['metrics', '--json'], env)).findings;
  const settings = (patch) => {
    const sf = path.join(old, 'docs/devteam/project/settings.md');
    const text = fs.readFileSync(sf, 'utf8');
    const block = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    fs.writeFileSync(sf, text.replace(block[1], JSON.stringify({ ...JSON.parse(block[1]), ...patch }, null, 2)));
  };
  try {
    for (const id of ['ch-01-a', 'ch-02-b', 'ch-03-c', 'ch-04-d', 'ch-05-e']) ticket(id);

    // 27.2 of 32 GB, 85%: refused in plain words, nothing started, nothing logged
    use(27.2 * G);
    const r = run(old, ['worker', 'ch-01-a'], M);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /the machine's memory is at 27\.2 of 32\.0 GB \(85%\), over its 80% ceiling: start this worker when some finish, or pass --force/);
    assert.equal(starts().length, 0);
    assert.ok(!fs.existsSync(path.join(old, '.worktrees/ch-01-a')), 'no worktree made');
    // --resume on a ticket that never ran is a new start, so it is refused too
    assert.match(run(old, ['worker', 'ch-01-a', '--resume'], M).err, /over its 80% ceiling/);
    // a planner as well
    const goal = ok(old, ['goal', 'add', '--title', 'Tidy', '--outcome', 'tidy', '--measure', 'untidy files', '--target', '0', '--unit', 'files', '--direction', 'down', '--source', 'prod', '--check', 'echo 0', '--non-goals', 'none', '--preconditions', 'a'], SUP).trim();
    assert.match(run(old, ['planner', 'beta', '--goal', goal], M).err, /over its 80% ceiling: start this planner when some finish/);

    // the findings: no "make workers for", memory-full in its place
    const full = findings(M);
    assert.ok(!full.some((f) => ['idle-capacity', 'idle-planning'].includes(f.kind)), JSON.stringify(full.map((f) => f.kind)));
    const mf = full.find((f) => f.kind === 'memory-full');
    assert.ok(mf, 'memory-full is shown');
    assert.match(mf.detail, /^the machine's memory is at 27\.2 of 32\.0 GB \(85%\), over its 80% ceiling, with 5 tickets ready, 0\/5 workers active/);
    assert.match(mf.suggestion, /lower max_active_tickets/);
    assert.doesNotMatch(mf.suggestion, /make a worker|make workers/);

    // --force starts it, and its act says what it overrode
    ok(old, ['worker', 'ch-01-a', '--force'], M);
    const forced = starts().pop();
    assert.match(forced.what, /^made worker ch-01-a in \S+ while the machine's memory is at 27\.2 of 32\.0 GB \(85%\), over its 80% ceiling, with --force$/);
    // a resume of a session that ran is never refused for memory, and says nothing of it
    use(31 * G);
    ok(old, ['worker', 'ch-01-a', '--resume'], M);
    assert.match(starts().pop().what, /^resumed worker ch-01-a in \S+$/);

    // under the ceiling: starts, and idle-capacity is back
    use(20 * G);
    ok(old, ['worker', 'ch-02-b'], M);
    assert.match(starts().pop().what, /^made worker ch-02-b in \S+$/);
    const under = findings(M);
    assert.ok(under.some((f) => f.kind === 'idle-capacity'), JSON.stringify(under.map((f) => f.kind)));
    assert.ok(!under.some((f) => f.kind === 'memory-full'));

    // the supervisor's own ceiling counts: 85% under a 0.9 ceiling starts
    use(27.2 * G);
    settings({ machine_memory_ceiling: 0.9 });
    ok(old, ['worker', 'ch-03-c'], M);
    assert.equal(ok(old, ['settings', '--get', 'machine_memory_ceiling']), '0.9');
    // validated: out of range or not a number is an error, and counts as the default, never wider
    for (const bad of [0.99, 1, 2, 0.4, '0.9', null]) {
      settings({ machine_memory_ceiling: bad });
      const v = run(old, ['validate'], SUP);
      assert.notEqual(v.status, 0, `${JSON.stringify(bad)} is refused`);
      assert.match(`${v.out}\n${v.err}`, /settings\.machine_memory_ceiling is .*a number from 0\.5 to 0\.95/);
    }
    settings({ machine_memory_ceiling: 1 });
    assert.match(run(old, ['worker', 'ch-04-d'], M).err, /over its 80% ceiling/, 'an invalid ceiling is the default');
    settings({ machine_memory_ceiling: 0.8 });
    { const v = run(old, ['validate'], SUP); assert.doesNotMatch(`${v.out}\n${v.err}`, /machine_memory_ceiling/, 'a valid ceiling passes'); }

    // memory.max "max": the host's /proc/meminfo, MemTotal less MemAvailable
    fs.writeFileSync(path.join(cg, 'memory.max'), 'max\n');
    const meminfo = path.join(F.base, 'meminfo');
    fs.writeFileSync(meminfo, `MemTotal:       16777216 kB\nMemFree:          524288 kB\nMemAvailable:    1677722 kB\n`);
    assert.match(run(old, ['worker', 'ch-04-d'], { ...M, DEVTEAM_MEMINFO: meminfo }).err, /at 14\.4 of 16\.0 GB \(90%\), over its 80% ceiling/);
    // no cgroup and no meminfo (macOS): nothing says, nothing is refused or suppressed
    const mac = { ...SUP, DEVTEAM_CGROUP: path.join(F.base, 'no-cgroup'), DEVTEAM_MEMINFO: none };
    ok(old, ['worker', 'ch-04-d'], mac);
    assert.ok(!findings(mac).some((f) => f.kind === 'memory-full'));
  } finally { F.done(); }
});
