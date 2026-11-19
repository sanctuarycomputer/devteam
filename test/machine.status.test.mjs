// machine status: the check-in digest, the machine's caps, and what the operator may run (reads only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux, write } from './lib/kit.mjs';
import { agent, baseEnv, box, code, conversation, dtIn, home, latestRelease, link, machine, prompt, repo, shown, tmp, tmuxSh } from './lib/machine-fixture.mjs';

test('alert reaches the hub, by hello, and clears', () => {
  const r = repo('alerted');
  const alert = path.join(home, '.box/alert');
  const raise = (...w) => machine(['machine', 'alert', '--', ...w]);
  fs.rmSync(alert, { force: true });
  const hello = () => JSON.parse(dtIn(r, ['hello', '--json']).stdout);
  assert.equal(hello().box_alert, undefined);
  assert.match(raise('disk\nnearly full').stdout, /alert raised: disk nearly full/);
  // the box's alert is the machine's: box_alert, which a hub and gateway on this kit show once; alert
  // still ends with it, so an older hub or gateway (which reads only alert) still shows and pushes it
  assert.equal(hello().box_alert, 'disk nearly full');
  assert.equal(hello().alert, 'disk nearly full', 'folded in for older readers');
  fs.utimesSync(alert, new Date(Date.now() - 25 * 3600000), new Date(Date.now() - 25 * 3600000));
  assert.equal(hello().box_alert, undefined, 'a day old, it has been seen or forgotten');
  raise(`${'x'.repeat(199)}é and more`);
  assert.equal(fs.readFileSync(alert, 'utf8'), `${'x'.repeat(199)}\n`, 'cut at 200 bytes, never half a character');
  raise(`${'x'.repeat(198)}€ and more`);
  assert.equal(fs.readFileSync(alert, 'utf8'), `${'x'.repeat(198)}\n`, 'nor a third of one');
  raise(`${'x'.repeat(198)}é and more`);
  assert.equal(fs.readFileSync(alert, 'utf8'), `${'x'.repeat(198)}é\n`, 'a whole character that fits stays');
  raise('short é');
  assert.equal(fs.readFileSync(alert, 'utf8'), 'short é\n', 'and a line under the limit is left alone');
  const fromWorker = machine(['machine', 'alert', '--', 'not mine'], { DEVTEAM_ROLE: 'worker' });
  assert.notEqual(fromWorker.status, 0);
  assert.equal(fs.readFileSync(alert, 'utf8'), 'short é\n', 'the operator\'s, never a worker\'s');
  assert.match(raise('--clear').stdout, /alert cleared/);
  assert.ok(!fs.existsSync(alert));
  assert.equal(raise().status, 2);
});

test('status says at a glance what a check-in needs, and reads no pane it needn\'t', { skip: !hasTmux }, async () => {
  const notes = path.join(home, 'operator/NOTES.md');
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.rmSync(path.join(home, '.box/alert'), { force: true });
  const last = path.join(home, '.devteam', `status-last-${process.env.DEVTEAM_HUB_PORT}`);
  fs.rmSync(last, { force: true });
  const sub = path.join(tmp, 'status-code');
  const r = repo('statused', { settings: { upstream_base: 'v0.1.0', worktree_files: ['config/master.key'] }, dir: sub });
  const sib = repo('a-sib', { dir: sub });
  repo('the-home', { links: { 'a-sib': link('a-sib') }, dir: sub });
  const sup = { DEVTEAM_ROLE: 'supervisor', DEVTEAM_SUPERVISOR_UP: 'off' };
  const q1 = dtIn(r, ['ask', '--question', 'first?', '--kind', 'owner-decision', '--class', 'design', '--reasons', 'x'], sup);
  assert.equal(q1.status, 0, q1.stderr + q1.stdout);
  assert.equal(dtIn(r, ['ask', '--question', 'second?', '--kind', 'owner-decision', '--class', 'design', '--reasons', 'x'], sup).status, 0);
  // knowledge to harvest: the owner's rule, a lesson the supervisor tagged for the kit, one already noted, one still a candidate
  const rule = dtIn(r, ['knowledge', 'add', '--kind', 'preference', '--statement', 'Ship banners without asking', '--owner']).stdout.trim();
  const ob = dtIn(r, ['observe', '--subject', 'kit', '--kind', 'friction', '--detail', 'd', '--severity', '1', '--valence', '-1'], sup).stdout.trim();
  const kitL = dtIn(r, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'Fetch before the merge', '--evidence', ob, '--kit'], sup).stdout.trim();
  const seenL = dtIn(r, ['knowledge', 'add', '--kind', 'fact', '--statement', 'Seen already', '--evidence', ob], sup).stdout.trim();
  dtIn(r, ['knowledge', 'add', '--kind', 'fact', '--statement', 'Still a candidate'], sup);
  for (const k of [kitL, seenL]) assert.equal(dtIn(r, ['knowledge', 'set', k, '--status', 'accepted'], sup).status, 0);
  fs.writeFileSync(notes, `read ${q1.stdout.trim()}\n- ${seenL}: stays\nfriction: same as ${kitL}, in passing\n`);
  fs.mkdirSync(path.join(r, '.worktrees/a/node_modules'), { recursive: true });
  fs.writeFileSync(path.join(r, '.worktrees/a/node_modules/big'), Buffer.alloc(4096 * 256));
  fs.writeFileSync(path.join(r, 'docs/devteam/run/accounts.json'), JSON.stringify({ at: new Date().toISOString(), cswap: true, active: 'a@b', active_no_room: false, exhausted: false, needs_login: ['c@d'], restart_gave_up: [], supervisor_limit: null }));
  // tmux, as the kit sees it, noting what it was asked
  const logged = path.join(tmp, 'tmux-asked');
  const spy = path.join(tmp, 'spy');
  write(path.join(spy, 'tmux'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(logged)}\nPATH=${JSON.stringify(process.env.PATH)} exec tmux "$@"\n`);
  fs.chmodSync(path.join(spy, 'tmux'), 0o755);
  const srv = spawn(process.execPath, ['-e', "require('http').createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1', function () { console.log(this.address().port); });"], { stdio: ['ignore', 'pipe', 'inherit'] });
  const portUp = await new Promise((ok) => srv.stdout.once('data', (d) => ok(Number(String(d).trim()))));
  const worker = path.join(tmp, 'statused-wt');
  fs.mkdirSync(worker, { recursive: true });
  const a = agent({ screens: [box(prompt), `✻ Ticking… (esc to interrupt)\n${box(prompt)}`], cwd: r, window: 'sup-statused' });
  const shell = agent({ screens: ['secret in the owner\'s shell'], cwd: home, window: 'shell' });
  const x = agent({ screens: [`line\n${box(prompt)}`, `other output now\n${box(prompt)}`], cwd: worker, window: 'worker-x' });
  const y = agent({ screens: [`You've hit your limit · resets 3pm\n${box(prompt)}`], cwd: worker, window: 'worker-y' });
  const status = (args = [], env = {}) => machine(['machine', 'status', '--in', sub, '--notes', notes, ...args], { PATH: `${spy}${path.delimiter}${baseEnv.PATH}`, ...env });
  try {
    for (const p of [a, x, y]) await shown(p.pane, 'status');
    fs.writeFileSync(path.join(r, 'docs/devteam/run/dashboard-port'), `${portUp}\n`);
    fs.writeFileSync(logged, '');
    const st = status([], { DEVTEAM_STATUS_SECONDS: '0' });
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /^machine: disk \S+ free of \S+.*; memory .*; cpus \S+.*; load [\d.]+ [\d.]+ [\d.]+$/m);
    assert.match(st.stdout, /^machine: accounts cswap active=a@b exhausted=false no-room=false needs-login=c@d as of /m);
    assert.match(st.stdout, new RegExp(`^machine: hub ${process.env.DEVTEAM_HUB_PORT} DOWN$`, 'm'));
    assert.match(st.stdout, new RegExp(`^statused sup=up fleet=run kit=v0\\.1\\.0\\S* inbox=\\d+ missing=config/master\\.key tools=ok behind=v9\\.9\\.9 pane=${a.pane} state=ready dash=${portUp}/up wt=1/\\S+ new-questions=1 new-knowledge=2$`, 'm'));
    assert.match(st.stdout, /^machine: daily review due \(last never\)$/m);
    const kn = status(['--knowledge']);
    assert.equal(kn.status, 0, kn.stderr);
    assert.match(kn.stdout, new RegExp(`^statused ${rule} \\[preference, project, owner's\\] Ship banners without asking$`, 'm'));
    assert.match(kn.stdout, new RegExp(`^statused ${kitL} \\[lesson, project, kit lesson\\] Fetch before the merge$`, 'm'));
    assert.doesNotMatch(kn.stdout, /Seen already|Still a candidate/, 'noted, or not accepted: not listed');
    // the review is done for the day once the notes have today's heading; an older one leaves it due
    fs.appendFileSync(notes, '\n## Review 2026-01-02\n');
    assert.match(status().stdout, /^machine: daily review due \(last 2026-01-02\)$/m);
    const today = new Date().toISOString().slice(0, 10);
    fs.appendFileSync(notes, `\n## Review ${today} (UTC)\n1. **${rule}**: the owner's ruling, stays\n`);
    // one reading for both: nothing changes between them
    const done = status();
    assert.match(done.stdout, new RegExp(`^machine: daily review done ${today}$`, 'm'));
    assert.match(done.stdout, /^statused .* new-knowledge=1$/m);
    assert.match(st.stdout, /^a-sib sup=down .* sibling-of=the-home$/m);
    assert.match(st.stdout, new RegExp(`^attention: ${y.pane} keep:worker-y limit$`, 'm'));
    assert.doesNotMatch(st.stdout, new RegExp(`${shell.pane}\\b`), 'never the owner\'s shell');
    assert.doesNotMatch(fs.readFileSync(logged, 'utf8'), new RegExp(`capture-pane .*-t ${shell.pane}$`, 'm'), 'not even read');
    assert.match(st.stdout, new RegExp(`^changed since last reading: .*${a.pane}.*${x.pane}.*${y.pane}`, 'm'), 'no reading before: everything changed');
    const q = status(['--questions']);
    assert.match(q.stdout, /^statused q-\S+ \[owner-decision\] second\?$/m);
    assert.doesNotMatch(q.stdout, /first\?/, 'noted, so not read again');
    assert.match(fs.readFileSync(last, 'utf8'), /^at \d+\ndisk \d+\npane %\d+ \w+\n/, 'the reading it keeps');
    // only what moved: one pane's screen changes
    tmuxSh(['send-keys', '-t', x.pane, 'Enter']);
    await shown(x.pane, 'other output now');
    assert.match(status([], { DEVTEAM_STATUS_SECONDS: '0' }).stdout, new RegExp(`^changed since last reading: ${x.pane}$`, 'm'));
    assert.match(status([], { DEVTEAM_STATUS_SECONDS: '0' }).stdout, /^changed since last reading: $/m, 'nothing moved since: nothing changed');
    // the reading is held 20 minutes, so a manual re-run doesn't erase the change the next check-in should see
    const held = fs.readFileSync(last, 'utf8');
    status();
    assert.equal(fs.readFileSync(last, 'utf8'), held);
    // a dashboard's port nothing answers is down; a repo whose kit is at the latest isn't behind
    fs.writeFileSync(path.join(r, 'docs/devteam/run/dashboard-port'), '9\n');
    fs.writeFileSync(latestRelease, 'v0.1.0\n');
    // and an alert raised: one reading says all three (the alert is on the hub's line, not the repo's)
    machine(['machine', 'alert', '--', 'look at the disk']);
    const st3 = status();
    assert.match(st3.stdout, /^statused .*dash=9\/DOWN/m);
    assert.doesNotMatch(st3.stdout, /behind=/);
    assert.match(st3.stdout, /^machine: hub \d+ DOWN; alert: look at the disk$/m);
    assert.doesNotMatch(st3.stdout, /^attention: statused: /m, "the box's alert, folded into hello's alert, is not repeated as the repo's");
    machine(['machine', 'alert', '--', '--clear']);
    // a supervisor up, idle at its prompt, its fleet running, and no tick or wait for 45 minutes: it
    // stopped its loop, and the check-in says so; its host check is the sign, as each tick and wait make one
    assert.doesNotMatch(st.stdout, /supervisor idle/, 'no record of its loop (a kit before it): nothing said');
    const claim = path.join(r, 'docs/devteam/run/host-claim.json');
    const beat = (checked, at = checked) => fs.writeFileSync(claim, JSON.stringify({ sha: 'x', at: new Date(Date.now() - at * 60000).toISOString(), machine: 'm', checked: Date.now() - checked * 60000 }));
    beat(138, 140);
    assert.match(status().stdout, /^attention: statused supervisor idle, not ticking for 138m$/m);
    beat(5, 140);
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'a wait checks every 10 minutes however long it runs: waiting is not idle');
    beat(30);
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'under 45 minutes: a tick can be that far apart');
    fs.writeFileSync(claim, JSON.stringify({ checked: Date.now() - 138 * 60000, refused: true }));
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'another machine holds the repo: the kit told it to stop, so never told to tick');
    fs.writeFileSync(claim, '{ not json');
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'a record it can\'t read says nothing');
    beat(138);
    // a parked fleet's supervisor has nothing to start, and isn't flagged
    const sup2 = { ...sup, DEVTEAM_SUPERVISOR_UP: 'off' };
    const parked = dtIn(r, ['fleet', 'park', '--reason', 'a quiet week'], sup2);
    assert.equal(parked.status, 0, parked.stderr + parked.stdout);
    beat(138);
    assert.match(status().stdout, /^statused sup=up fleet=park /m);
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'parked: not flagged');
    beat(138);
    const unparked = dtIn(r, ['fleet', 'unpark'], sup2);
    assert.equal(unparked.status, 0, unparked.stderr + unparked.stdout);
    assert.doesNotMatch(status().stdout, /supervisor idle/, 'an unpark is a start: it checks the claim, a sign of its loop');
    beat(138);
    assert.match(status().stdout, /^attention: statused supervisor idle, not ticking for 138m$/m, 'running again, and still idle');
    // busy in a turn (a long step of a tick): not idle, however old the sign
    tmuxSh(['send-keys', '-t', a.pane, 'Enter']);
    await shown(a.pane, 'Ticking');
    const busy = status();
    assert.match(busy.stdout, new RegExp(`^statused .* pane=${a.pane} state=busy `, 'm'));
    assert.doesNotMatch(busy.stdout, /supervisor idle/, 'busy: not flagged');
    assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/run/supervisor-pane')), 'reading a project writes nothing of its');
  } finally {
    srv.kill();
    for (const p of [a, shell, x, y]) p.kill();
    fs.writeFileSync(latestRelease, 'v9.9.9\n');

  }
});

test('status says the machine\'s own CPU and memory caps, not the host\'s', () => {
  // a 2-CPU, 8 GiB container: 6 GiB charged, 2 GiB of it page cache the kernel can drop
  const cg = fs.mkdtempSync(path.join(tmp, 'cgroup-'));
  const G = 1024 ** 3;
  fs.writeFileSync(path.join(cg, 'cpu.max'), '200000 100000\n');
  fs.writeFileSync(path.join(cg, 'cpu.pressure'), 'some avg10=20.00 avg60=15.00 avg300=10.00 total=1\nfull avg10=14.00 avg60=12.60 avg300=9.00 total=1\n');
  fs.writeFileSync(path.join(cg, 'memory.max'), `${8 * G}\n`);
  fs.writeFileSync(path.join(cg, 'memory.current'), `${6 * G}\n`);
  fs.writeFileSync(path.join(cg, 'memory.stat'), `anon ${3 * G}\nfile ${2 * G}\ninactive_file ${G}\n`);
  const r = machine(['machine', 'status'], { DEVTEAM_CGROUP: cg });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^machine: disk .*; memory 4\.0 GB in use of 8\.0 GB; cpus 2 \(all waiting 13% of the last minute\); load /m);
  // a platform that stops the box by memory.current, cache and all (the box image says so): the
  // working set, all but the inactive cache, the number the memory ceiling reads, and the split
  const counts = { DEVTEAM_CGROUP: cg, DEVTEAM_MEMORY_COUNTS_CACHE: '1' };
  assert.match(machine(['machine', 'status'], counts).stdout, /^machine: disk .*; memory 5\.0 GB in use of 8\.0 GB \(1\.0 GB of it page cache, and 1\.0 GB of inactive cache left out\); cpus 2 /m);
  // no caps (a laptop, or a cgroup that says max): the machine's own numbers
  fs.writeFileSync(path.join(cg, 'cpu.max'), 'max 100000\n');
  fs.writeFileSync(path.join(cg, 'memory.max'), 'max\n');
  assert.match(machine(['machine', 'status'], { DEVTEAM_CGROUP: cg }).stdout, /^machine: disk .*; memory [\d.]+ GB free of [\d.]+ GB; cpus \d+[ ;].*load /m);
  // the host's own: MemAvailable of MemTotal (what the kit's memory ceiling reads too)
  const meminfo = path.join(cg, 'meminfo');
  fs.writeFileSync(meminfo, 'MemTotal:       8388608 kB\nMemFree:          524288 kB\nMemAvailable:    3145728 kB\n');
  assert.match(machine(['machine', 'status'], { DEVTEAM_CGROUP: cg, DEVTEAM_MEMINFO: meminfo }).stdout, /^machine: disk .*; memory 3\.0 GB free of 8\.0 GB; cpus /m);
  // with no cap the setting changes nothing: MemAvailable already counts what the kernel can drop
  assert.match(machine(['machine', 'status'], { ...counts, DEVTEAM_MEMINFO: meminfo }).stdout, /^machine: disk .*; memory 3\.0 GB free of 8\.0 GB; cpus /m);
});

// Every read the operator is allowed, against a repo with something in it: the log, git status and
// the files on disk are byte-for-byte what they were. That's the point of the list.
test('each read the operator may run writes nothing', () => {
  const r = repo('read-only', { settings: { upstream_base: 'v0.2.0', sensors: { web: { kind: 'http', url: 'https://app.example.test/up' } } } });
  const sup = { DEVTEAM_ROLE: 'supervisor', DEVTEAM_SUPERVISOR_UP: 'off' };
  assert.equal(dtIn(r, ['goal', 'add', '--title', 'a goal', '--outcome', 'x'], sup).status, 0);
  const goal = dtIn(r, ['goal'], sup).stdout.match(/g-\S+/)?.[0];
  assert.ok(goal);
  const k = dtIn(r, ['knowledge', 'add', '--kind', 'fact', '--statement', 's'], sup).stdout.match(/k-\S+/)?.[0];
  assert.ok(k);
  assert.equal(dtIn(r, ['ask', '--question', 'q?', '--kind', 'owner-decision', '--class', 'design', '--reasons', 'x'], sup).status, 0);
  assert.equal(dtIn(r, ['send', 'supervisor', 'hello'], sup).status, 0);
  const p = dtIn(r, ['problem', 'add', '--title', 'a problem', '--severity', '2'], sup).stdout.trim();
  assert.match(p, /^p-/);
  conversation(r);
  const op = { DEVTEAM_ROLE: 'operator', TMUX: 'x', TMUX_PANE: '%7' };
  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.name === '.git') continue; if (e.isDirectory()) walk(p, out); else out.push(p); } return out; };
  const snap = () => ({ files: Object.fromEntries(walk(r).map((f) => [f, fs.readFileSync(f).toString('base64')])), status: execFileSync('git', ['status', '--porcelain'], { cwd: r, encoding: 'utf8' }) });
  const before = snap();
  const reads = [['search', 'goal'], ['status'], ['status', '--json'], ['ready'], ['ready', '--json'], ['metrics'], ['metrics', '--json'], ['hello', '--json'], ['settings'], ['supervisor-session'], ['prompt', 'supervisor'], ['validate'], ['questions'], ['questions', '--json', '--all'], ['log', '--json', '--tail', '5'], ['messages', '--to', 'supervisor', '--open'], ['knowledge', '--json'], ['knowledge', '--for', 'x'], ['goal', '--json'], ['goal', 'list'], ['goal', 'show', goal], ['fleet', 'status', '--json', '--no-fetch'], ['trust'], ['trust', '--json'], ['problem'], ['problem', '--json', '--all'], ['sensor', 'status'], ['sensor', 'status', '--json'], ['sensor', 'series', 'web', '--range', '7d'], ['knowledge', '--kit'], ['machine', 'pane-state', '%7'], ['peek', 'lesson', k, '--json'], ['peek', 'lesson', k, '--mermaid'], ['peek', 'problem', p, '--json'], ['peek', 'goal', goal, '--json'], ['peek', 'sensor', 'web', '--json']];
  for (const c of reads) { const x = dtIn(r, c, op); assert.equal(x.status, 0, `${c.join(' ')}: ${x.stderr}`); assert.doesNotMatch(x.stderr, /only reads/, c.join(' ')); }
  // and the machine's digest, run from inside the project, reads it the same way
  assert.equal(dtIn(r, ['machine', 'status', '--in', code], op).status, 0);
  const after = snap();
  assert.deepEqual(Object.keys(after.files).sort(), Object.keys(before.files).sort(), 'no file created or removed');
  for (const f of Object.keys(before.files)) assert.equal(after.files[f], before.files[f], `${f} unchanged`);
  assert.equal(after.status, before.status);
});

test('the kit lets a box operator look, and nothing else', () => {
  const r = repo('guarded');
  const op = { DEVTEAM_ROLE: 'operator', TMUX: 'x', TMUX_PANE: '%7' };
  for (const c of [['status'], ['fleet', 'status', '--json', '--no-fetch'], ['settings', '--get', 'main_branch'], ['supervisor-session'], ['questions', '--json'], ['log', '--json'], ['messages', '--to', 'supervisor', '--open'], ['knowledge'], ['knowledge', '--kind', 'fact'], ['goal'], ['goal', 'list']]) assert.equal(dtIn(r, c, op).status, 0, c.join(' '));
  for (const c of [['merge', 't-1'], ['fleet', 'park', '--reason', 'x'], ['fleet', 'unpark'], ['answer', 'q', 'yes'], ['send', 'supervisor', 'hi'], ['knowledge', 'add', '--kind', 'fact', '--statement', 'x'], ['knowledge', 'set', 'k-1'], ['goal', 'add', '--title', 'x'], ['goal', 'set', 'g-1'], ['goal', 'status', 'g-1', 'met'], ['goal', 'hold', 'g-1', 'park'], ['goal', 'reading', 'g-1', '--run'], ['ticket', 'show', 't-1'], ['dashboard-data'], ['ask', '--question', 'q', '--kind', 'x'], ['problem', 'add', '--title', 'x', '--severity', '1'], ['problem', 'set', 'p-1', '--status', 'resolved'], ['sensor', 'poll'], ['sensor', 'test', 'web'], ['sensor', 'ignore', 'f-1', '--reason', 'x'], ['sensor', 'discover'], ['knowledge', 'set', 'k-1', '--kit']]) { const x = dtIn(r, c, op); assert.notEqual(x.status, 0, c.join(' ')); assert.match(x.stderr, /only reads|owner commands/, c.join(' ')); }
  assert.ok(!fs.existsSync(path.join(r, 'docs/devteam/run/supervisor-pane')), 'and it is never taken for the supervisor\'s pane');
  // the one write the operator has: bringing a supervisor back (operator.md)
  const dry = dtIn(r, ['recover', '--dry-run'], op);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /left stopped/);
  const worker = dtIn(r, ['recover', '--dry-run'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-1' });
  assert.notEqual(worker.status, 0);
  assert.match(worker.stderr, /recover: /);
});
