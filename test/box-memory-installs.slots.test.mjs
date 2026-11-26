// Worktree installs (kit-596): the machine-wide setup slots: which holders are freed, kept or taken
// over, and a slots folder that can't be written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { clock, deadlineIn, hold, readHolder, slotFleet, startOf, until } from './lib/box-memory-fixture.mjs';

function rewriteHolder(dir, n, fn) {
  const f = path.join(dir, String(n), 'holder.json');
  const h = fn(JSON.parse(fs.readFileSync(f, 'utf8')));
  fs.writeFileSync(`${f}.test-tmp`, JSON.stringify(h));
  fs.renameSync(`${f}.test-tmp`, f);
}

// setupSlots.lib, taken as text from the kit as the runner takes it, to drive a race step by step
function slotsLib() {
  const src = fs.readFileSync(new URL('../docs/devteam/scripts/devteam.mjs', import.meta.url), 'utf8');
  const end = 'return { count, take, judge, free, release, sweep, startTime };';
  const from = src.indexOf('  lib: function () {') + '  lib: '.length;
  const body = `${src.slice(from, src.indexOf(end, from))}${end}\n}`;
  return new Function('require', `return (${body})()`)(createRequire(import.meta.url));
}
test('4f: a slot whose holder is dead with no live group is freed at once', () => {
  const S = slotFleet('installs-4f', () => 'true');
  try {
    const dead = spawnSync('true').pid;
    hold(S.slots, 0, { pid: dead, start: '1' });
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.equal(r.status, 0, r.err);
    assert.doesNotMatch(r.err, /waiting for a setup slot/, 'freed at once, with no wait for a slot');
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4f\': a slot folder whose holder.json is empty or not JSON, a minute old, is freed at once', () => {
  const S = slotFleet('installs-4f2', () => 'true');
  try {
    for (const [slug, text] of [['empty', ''], ['garbled', 'not json']]) {
      fs.mkdirSync(path.join(S.slots, '0'), { recursive: true });
      fs.writeFileSync(path.join(S.slots, '0', 'holder.json'), text);
      const old = new Date(Date.now() - 60000);
      fs.utimesSync(path.join(S.slots, '0'), old, old);
      const r = S.start(slug, { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
      assert.equal(r.status, 0, `${slug}: ${r.err}`);
      assert.doesNotMatch(r.err, /waiting for a setup slot/, 'freed at once, with no wait for a slot');
      assert.equal(fs.existsSync(path.join(S.slots, '0')), false);
    }
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('a non-folder at a slot (a file, a symlink to a folder, a dangling symlink), a minute old, is freed at once: the slots stay on, and a link\'s target is left alone', () => {
  const S = slotFleet('installs-nondir', () => 'true');
  try {
    const target = path.join(S.F.base, 'slot-target');
    fs.mkdirSync(target);
    const kinds = [
      ['file', (p) => { fs.writeFileSync(p, 'stray\n'); }],
      ['dirlink', (p) => { fs.symlinkSync(target, p); }],
      ['dangling', (p) => { fs.symlinkSync(path.join(S.F.base, 'no-such-folder'), p); }],
    ];
    for (const [slug, plant] of kinds) {
      fs.mkdirSync(S.slots, { recursive: true });
      const p = path.join(S.slots, '0');
      plant(p);
      const old = new Date(Date.now() - 60000);
      fs.lutimesSync(p, old, old);
      const t0 = Date.now();
      const r = S.start(slug, { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
      assert.equal(r.status, 0, `${slug}: ${r.err}`);
      assert.doesNotMatch(r.err, /no usable setup slots folder/, `${slug}: the slots stay on`);
      assert.doesNotMatch(r.err, /waiting for a setup slot/, `${slug}: freed at once, with no wait for a slot`);
      assert.ok(Date.now() - t0 < 10000, `${slug}: took ${Date.now() - t0} ms`);
      assert.throws(() => fs.lstatSync(p), /ENOENT/, `${slug}: no slot left`);
    }
    assert.ok(fs.statSync(target).isDirectory(), 'the symlink\'s target folder is still there');
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('M8: a young unreadable holder (a rewrite may be in flight) holds its slot: the deadline gives 75', () => {
  const S = slotFleet('installs-young', () => 'true');
  try {
    fs.mkdirSync(path.join(S.slots, '0'), { recursive: true });
    fs.writeFileSync(path.join(S.slots, '0', 'holder.json'), '');
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(2000) });
    assert.equal(r.status, 75, r.err);
    assert.match(r.err, /setup-slot-wait/);
    assert.ok(fs.existsSync(path.join(S.slots, '0', 'holder.json')), 'the young holder is left in place');
    fs.rmSync(path.join(S.slots, '0'), { recursive: true, force: true });
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('M11: an unreadable holder re-taken between the judging and the move is put back, never removed', () => {
  const lib = slotsLib();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-slots-'));
  try {
    fs.mkdirSync(path.join(dir, '0'));
    fs.writeFileSync(path.join(dir, '0', 'holder.json'), 'not json');
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(dir, '0'), old, old);
    const memo = {};
    assert.equal(lib.judge(dir, 0, memo), 'gone');
    assert.equal(memo.judged[0], null, 'judged as unreadable');
    // meanwhile its slot is freed and taken by a runner whose holder reads whole
    fs.rmSync(path.join(dir, '0'), { recursive: true, force: true });
    assert.equal(lib.take(dir, 1, { id: 'retaker', pid: process.pid, start: 'x' }), 0);
    assert.equal(lib.free(dir, 0, memo.judged[0]), false);
    assert.equal(readHolder(dir, 0)?.id, 'retaker', 'the re-taken slot is put back');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('4g: a slot whose holder pid is alive with another start time (a reused pid) is freed at once', () => {
  const S = slotFleet('installs-4g', () => 'true');
  try {
    const p = S.live();
    hold(S.slots, 0, { pid: p.pid, start: 'not-its-start' });
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.equal(r.status, 0, r.err);
    assert.doesNotMatch(r.err, /waiting for a setup slot/, 'freed at once, with no wait for a slot');
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4g\': a dead runner whose group lives holds its slot only while the group leader\'s start time matches', () => {
  const S = slotFleet('installs-4g2', () => 'true');
  try {
    const dead = spawnSync('true').pid;
    const g = S.live({ detached: true });
    hold(S.slots, 0, { pid: dead, start: '1', pgid: g.pid, leader_start: 'not-its-start' });
    const freed = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.equal(freed.status, 0, freed.err);
    assert.doesNotMatch(freed.err, /waiting for a setup slot/, 'freed at once, with no wait for a slot');
    hold(S.slots, 0, { pid: dead, start: '1', pgid: g.pid, leader_start: startOf(g.pid) });
    const held = S.start('two', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(2000) });
    assert.equal(held.status, 75, held.err);
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4h: a slot held past 15 minutes is taken over, warned and logged', () => {
  const S = slotFleet('installs-4h', () => 'true');
  try {
    const p = S.live();
    const at = new Date(Date.now() - 16 * 60000).toISOString();
    hold(S.slots, 0, { pid: p.pid, start: startOf(p.pid), at });
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.equal(r.status, 0, r.err);
    assert.doesNotMatch(r.err, /waiting for a setup slot/, 'freed at once, with no wait for a slot');
    assert.match(r.err, new RegExp(`took over setup slot 0, held since ${at.replace(/\./g, '\\.')} by pid ${p.pid}`));
    const logDir = path.join(S.F.old, 'docs/devteam/run/log');
    const obs = fs.readdirSync(logDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((o) => o.type === 'observation' && o.kind === 'setup-slot-taken-over');
    assert.equal(obs.length, 1, 'one setup-slot-taken-over observation');
    assert.equal(obs[0].source, 'kit');
    assert.equal(obs[0].subject, 'setup-slot-0');
    assert.match(obs[0].detail, new RegExp(`${p.pid}`));
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('4h\': a runner whose slot was taken over leaves the taker\'s slot alone', async () => {
  // A runs until the takeover is seen (4h-go), B (the taker) 5 s, C 1 s
  const S = slotFleet('installs-4h2', (F) => `n=$(basename "$PWD"); echo "start ${clock}" >> ${F.base}/4h-$n.txt; case $n in chore-a) while [ ! -e ${F.base}/4h-go ]; do sleep 0.1; done;; chore-b) sleep 5;; *) sleep 1;; esac; echo "end ${clock}" >> ${F.base}/4h-$n.txt`);
  const runs = [];
  const times = (s) => Object.fromEntries(fs.readFileSync(path.join(S.F.base, `4h-chore-${s}.txt`), 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([k, v]) => [k, Number(v)]));
  try {
    const env = () => ({ DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    const runA = S.startAsync('a', env());
    runs.push(runA);
    await until(() => fs.existsSync(path.join(S.F.base, '4h-chore-a.txt')), 10000, 'setup A to start');
    // A's runner writes its holder once more, with the setup's pgid, after the setup starts: ours comes after it
    await until(() => readHolder(S.slots, 0)?.pgid, 10000, "A's holder to name its setup's group");
    const idA = readHolder(S.slots, 0)?.id;
    assert.ok(idA, 'A holds slot 0');
    rewriteHolder(S.slots, 0, (h) => ({ ...h, at: new Date(Date.now() - 16 * 60000).toISOString() }));
    const runB = S.startAsync('b', env());
    runs.push(runB);
    const idB = await until(() => { const id = readHolder(S.slots, 0)?.id; return id && id !== idA && id; }, 10000, 'B to take over slot 0');
    fs.writeFileSync(path.join(S.F.base, '4h-go'), '');
    const a = await runA;
    assert.equal(a.status, 0, a.stderr);
    assert.equal(readHolder(S.slots, 0)?.id, idB, 'A\'s release left B\'s slot alone');
    const c = await S.startAsync('c', env());
    const b = await runB;
    assert.equal(b.status, 0, b.stderr);
    assert.equal(c.status, 0, c.stderr);
    assert.match(b.stderr, /took over setup slot 0/);
    assert.ok(times('c').start >= times('b').end, `C started at ${times('c').start}, before B ended at ${times('b').end}`);
  } catch (e) { S.failed = e; throw e; } finally {
    // A's setup ends, and every run is over, before the fixture's base goes
    fs.writeFileSync(path.join(S.F.base, '4h-go'), '');
    await Promise.all(runs);
    S.finish();
  }
});

test('4i: DEVTEAM_SETUP_SLOTS outside 1-8 warns naming the value and gives two slots', async () => {
  const S = slotFleet('installs-4i', (F) => `echo "start ${clock}" >> ${F.base}/4i-$(basename "$PWD").txt; sleep 2; echo "end ${clock}" >> ${F.base}/4i-$(basename "$PWD").txt`);
  const iv = (s) => { const t = Object.fromEntries(fs.readFileSync(path.join(S.F.base, `4i-chore-${s}.txt`), 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([k, v]) => [k, Number(v)])); return [t.start, t.end]; };
  try {
    for (const v of ['0', '9', 'x']) {
      const env = { DEVTEAM_SETUP_SLOTS: v, ...deadlineIn(20000) };
      const rs = await Promise.all([S.startAsync(`${v}-a`, env), S.startAsync(`${v}-b`, env)]);
      for (const r of rs) {
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stderr, new RegExp(`DEVTEAM_SETUP_SLOTS "${v}"`));
      }
      const [[s1, e1], [s2, e2]] = [iv(`${v}-a`), iv(`${v}-b`)];
      assert.ok(s1 < e2 && s2 < e1, `${v}: the two setups ran one after the other (a ${s1}-${e1}, b ${s2}-${e2})`);
    }
  } catch (e) { S.failed = e; throw e; } finally { S.finish(); }
});

test('a slots folder that can\'t be written to stops no install: warned, run without a slot', { skip: process.getuid?.() === 0 && 'root writes through a read-only folder' }, () => {
  const S = slotFleet('installs-ro', (F) => `touch ${F.base}/ro.ran`);
  try {
    fs.mkdirSync(S.slots, { recursive: true });
    fs.chmodSync(S.slots, 0o555);
    const t0 = Date.now();
    const r = S.start('one', { DEVTEAM_SETUP_SLOTS: '1', ...deadlineIn(20000) });
    assert.equal(r.status, 0, r.err);
    assert.ok(Date.now() - t0 < 15000, `took ${Date.now() - t0} ms`);
    assert.match(r.err, /no usable setup slots folder .*running worktree_setup without a slot/);
    assert.doesNotMatch(r.err, /waiting for a setup slot/);
    assert.ok(fs.existsSync(path.join(S.F.base, 'ro.ran')), 'the setup ran');
  } catch (e) { S.failed = e; throw e; } finally { try { fs.chmodSync(S.slots, 0o755); } catch {} S.finish(); }
});
