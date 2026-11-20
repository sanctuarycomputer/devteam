// A dead machine's sessions come back in order: work in progress first, sessions idle on a dependency
// last, up to 3 a tick under the memory ceiling, with the page cache counted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux, json, until, write } from './lib/kit.mjs';
import { fixture, OFF, UNDER } from './lib/recovery-fixture.mjs';

// What a worker, the supervisor and the owner say, through the kit itself (lines the log accepts).
const dtRun = (F, args, env) => { const r = spawnSync(process.execPath, [path.join(F.root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: F.root, encoding: 'utf8', env }); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };

const asWorker = (F, id, args) => { const e = F.env({ DEVTEAM_ROLE: 'worker' }); e.DEVTEAM_TICKET = id; return dtRun(F, args, e); };

const asOwner = (F, args) => { const e = F.env(); delete e.DEVTEAM_ROLE; return dtRun(F, args, e); };

const phase = (F, id, to) => F.logLine(id, { type: 'phase', from: 'starting', to });

// Tick after tick, up to 3 each: what they bring back, in the order they bring it.
const order = (F, n) => { const got = []; for (let i = 0; got.length < n && i < n; i++) got.push(...(F.tick(UNDER(F)).match(/relaunched \S+(?=: its window was gone)/g) ?? []).map((l) => l.slice(11))); return got; };
test('the order: work in progress first, sessions idle on a dependency last; ties keep the launch order', { skip: !hasTmux }, async () => {
  const F = fixture('order');
  try {
    F.worker('demo-60-idle'); phase(F, 'demo-60-idle', 'awaiting-word');
    F.worker('demo-61-blocked'); phase(F, 'demo-61-blocked', 'spec');
    asWorker(F, 'demo-61-blocked', ['send', 'supervisor', 'waiting on demo-60', '--kind', 'blocked']);
    F.worker('demo-62-plain'); phase(F, 'demo-62-plain', 'spec');
    F.worker('demo-63-build'); phase(F, 'demo-63-build', 'build');
    F.worker('demo-64-dirty'); phase(F, 'demo-64-dirty', 'awaiting-word');
    const wt = path.join(F.root, '.worktrees', 'demo-64-dirty');
    execFileSync('git', ['init', '-q'], { cwd: wt });
    write(path.join(wt, 'half-done.txt'), 'not committed\n');
    F.planner('p6');
    dtRun(F, ['ask', '--question', 'Which layout for p6?', '--recommendation', 'the grid', '--links', JSON.stringify([{ title: 'the p6 design', path: 'docs/p6.md', ref: 'plan/p6' }])], F.env());
    F.planner('p7');
    asOwner(F, ['thread', 'new', 'The header is too tall', '--subject', JSON.stringify({ kind: 'artifact', slug: 'mock', at: 'plan-p7' })]);
    F.planner('p8');
    asOwner(F, ['thread', 'new', 'Split this feature', '--subject', JSON.stringify({ kind: 'item', ref: 'planner:p8' })]);
    F.worker('demo-65-plain2'); phase(F, 'demo-65-plain2', 'plan');
    // a blocked message the supervisor answered, and one followed by a later message: neither idles
    F.worker('demo-66-answered'); phase(F, 'demo-66-answered', 'spec');
    const asked = asWorker(F, 'demo-66-answered', ['send', 'supervisor', 'which table?', '--kind', 'blocked']).split('\n')[0];
    dtRun(F, ['send', 'demo-66-answered', 'the new one', '--re', asked], F.env());
    F.worker('demo-67-later'); phase(F, 'demo-67-later', 'spec');
    asWorker(F, 'demo-67-later', ['send', 'supervisor', 'waiting on demo-60', '--kind', 'blocked']);
    asWorker(F, 'demo-67-later', ['send', 'supervisor', 'found a way round it', '--kind', 'info']);
    F.worker('demo-68-blocked'); phase(F, 'demo-68-blocked', 'blocked');
    // a thread on the planner by its session name
    F.planner('p9');
    asOwner(F, ['thread', 'new', 'Is this one still needed?', '--subject', JSON.stringify({ kind: 'item', ref: 'planner:plan-p9' })]);
    // the main checkout has changes of its own: a worktree that is no checkout of its own never reads them
    write(path.join(F.root, 'stray.txt'), 'not committed\n');
    assert.deepEqual(order(F, 13), ['demo-63-build', 'demo-64-dirty', 'plan-p6', 'plan-p7', 'plan-p8', 'plan-p9', 'demo-62-plain', 'demo-65-plain2', 'demo-66-answered', 'demo-67-later', 'demo-60-idle', 'demo-61-blocked', 'demo-68-blocked']);
    await until(() => F.relaunched().length === 13, 'all thirteen resumed');
  } finally { F.done(); }
});

test('the order: a planner whose question is withdrawn and whose thread is resolved waits like any other', { skip: !hasTmux }, async () => {
  const F = fixture('order2');
  try {
    F.planner('q1');
    const q = dtRun(F, ['ask', '--question', 'Which layout for q1?', '--recommendation', 'the grid', '--links', JSON.stringify([{ title: 'the q1 design', path: 'docs/q1.md', ref: 'plan/q1' }])], F.env()).split('\n')[0];
    dtRun(F, ['withdraw', q], F.env());
    F.planner('q2');
    const t = asOwner(F, ['thread', 'new', 'Split this feature', '--subject', JSON.stringify({ kind: 'item', ref: 'planner:q2' })]).split('\n')[0];
    asOwner(F, ['thread', 'resolve', t]);
    F.worker('demo-70-build'); phase(F, 'demo-70-build', 'build');
    assert.deepEqual(order(F, 3), ['demo-70-build', 'plan-q1', 'plan-q2']);
  } finally { F.done(); }
});

test('up to 3 a tick under the memory ceiling, each under the restart record and caps', { skip: !hasTmux }, async () => {
  const F = fixture('three');
  try {
    for (const id of ['demo-80-a', 'demo-81-notdue', 'demo-82-b', 'demo-83-c', 'demo-84-d']) F.worker(id);
    const once = Date.now() - 60000;
    write(F.restartsFile, JSON.stringify({ 'demo-81-notdue': [once] }));
    F.tick(UNDER(F));
    assert.deepEqual(F.state().relaunched, ['demo-80-a', 'demo-82-b', 'demo-83-c'], 'three, passing over the one not due');
    assert.deepEqual(F.tick(UNDER(F)).match(/relaunched [^\s:]+/g), ['relaunched demo-84-d']);
    assert.deepEqual(json(fs.readFileSync(F.restartsFile, 'utf8'))['demo-81-notdue'], [once], 'not claimed: its one attempt only');
    await until(() => F.relaunched().length === 4, 'four resumed');
    assert.ok(!F.relaunched().includes('demo-81-notdue'));
  } finally { F.done(); }
});

test('a box that counts the page cache: the cache counts toward the ceiling, read again before each relaunch', { skip: !hasTmux }, async () => {
  const F = fixture('cache');
  try {
    // the 2026-11-17 box: a 32 GB cap the platform enforces on memory.current, 11 GB of it page cache
    const G = 1024 ** 3;
    const cg = fs.mkdtempSync(path.join(F.base, 'cgroup-'));
    const use = (current) => { write(path.join(cg, 'memory.max'), `${32 * G}\n`); write(path.join(cg, 'memory.current'), `${current}\n`); write(path.join(cg, 'memory.stat'), `anon ${15 * G}\nfile ${11 * G}\nshmem 0\n`); };
    const box = { ...OFF, DEVTEAM_CGROUP: cg, DEVTEAM_MEMINFO: path.join(F.base, 'no-meminfo'), DEVTEAM_MEMORY_COUNTS_CACHE: '1' };
    // each resume (its worktree_setup) takes the box to 27 GB, 84% with the cache
    const sf = path.join(F.root, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"project":', `"worktree_setup": ${JSON.stringify(`echo ${27 * G} > ${path.join(cg, 'memory.current')}`)},\n  "project":`));
    execFileSync('sh', ['-c', 'git add -A && git -c user.email=t@t -c user.name=t commit -qm setup'], { cwd: F.root });
    for (const id of ['demo-95-a', 'demo-96-b', 'demo-97-c']) F.worker(id);
    // 27 of 32 GB: 16 GB without the cache, under the ceiling; with it, over, so nothing comes back
    use(27 * G);
    assert.match(F.tick(box), /^3 gone sessions wait for room to relaunch: the machine's memory is at 27\.0 of 32\.0 GB \(84%, 11\.0 GB of it page cache\), at or over its 80% ceiling$/m);
    assert.deepEqual(F.relaunched(), []);
    // 20 GB: the first comes back, its resume takes the box to 27, and the next waits
    use(20 * G);
    const out = F.tick(box);
    assert.deepEqual(F.state().relaunched, ['demo-95-a'], out);
    assert.match(out, /^2 gone sessions wait for room to relaunch: the machine's memory is at 27\.0 of 32\.0 GB/m);
    // where the platform's cap leaves the cache out (no DEVTEAM_MEMORY_COUNTS_CACHE): 16 GB, so both
    // come back (in two ticks if the first one's worktree_setup leaves under 100 s for the second)
    const { DEVTEAM_MEMORY_COUNTS_CACHE: _, ...laptop } = box;
    const back = [];
    for (let i = 0; i < 2 && back.length < 2; i++) { F.tick(laptop); back.push(...F.state().relaunched); }
    assert.deepEqual(back, ['demo-96-b', 'demo-97-c']);
    assert.equal(F.state().memory_held, 0);
    await until(() => F.relaunched().length === 3, 'all three resumed');
  } finally { F.done(); }
});
