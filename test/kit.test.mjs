// End-to-end test of the kit against a throwaway repo: plan PR, worker lifecycle, questions,
// trust, corrections, forgery, log-sync, and the computed views. The steps are in lib/chain.mjs.
// Run the suite: node --test --test-concurrency=8 test/*.test.mjs  (DEVTEAM_TEST_KEEP=1 keeps the fixtures;
// DEVTEAM_TEST_COLD=1 spawns every CLI call fresh instead of through lib/cli.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { steps, snapshot, useFixture, tmp } from './lib/chain.mjs';
import { testDir, threadsFixture, hasTmux, until } from './lib/kit.mjs';

// Steps that run in a fork of the fixture, beside the rest. A fork is copied at the step's place,
// so it starts from what the in-line steps before it left, without what earlier forks did; the
// steps after it go on without it. So a step is here only if no later assertion needs what it
// leaves: it puts back what it changes, or what it changes (its own questions, branches, worktrees,
// goals) only changes what a later listing or count holds. Consecutive steps in one entry run in
// one fork, in order, when a later one reads an earlier one's work. Every assertion still runs, but
// some see other values than they would in line: a listing without another fork's lines.
const FORKS = [
  ['goal measures:'],
  ['sensor credentials:'],
  ['sensors: what a probe prints stays in its frame'],
  ['review-worktree:'],
  ['an answer the owner gave in the supervisor chat'],
  ['questions carry choices'],
  ['forged lines'],
  ['a chore PR that touches the kit'],
  ['a PR of any kind that changes owner settings'],
  ['an answer one act recorded'],
  ["the owner's CI-fix rule"],
  ['a standing owner rule approves upstream syncs'],
  ['a planner in flight'],
  ['parallel planners'],
  ['a fully defined goal nobody is planning'],
  ['a lost Enter'],
  ['a ready goal changes'],
  ['goal holds:'],
  ['secrets:'],
  ["merge waits for the forge's checks"],
  ['goal list flags'],
  ['approve-plan accepts', "a ticket's merge gate", 'spend is measured'],
  ['review questions: a page'],
  ['review questions on the dashboard'],
  ['dashboard: Library and the artifact viewer'],
  ['review permanence'],
  ['artifacts: new, check, list', 'artifacts: check-pr and merge refuse', 'artifacts: the dashboard serves them', 'artifacts: a question links one', 'artifacts: the Library data', 'public artifacts: an artifact-publish act', 'public artifacts: owner acts are records', 'public artifacts: artifact publish and unpublish', 'public artifacts: /public-manifest', 'public artifacts: the Library'],
  // its own group: tmux windows and listeners the other steps must not count as sessions
  ['previews: a derived name', 'previews: the link for here', 'previews: the kit runs the server', 'previews: hello lists them', 'previews: a question cites one', 'previews: a record nobody wrote'],
];

const forked = new Map();
FORKS.forEach((group, g) => group.forEach((prefix) => {
  const i = steps.findIndex((s) => s.name.startsWith(prefix));
  if (i < 0) throw new Error(`FORKS names no step: ${prefix}`);
  forked.set(i, g);
}));

// Only the loaders a fork needs from this process's command line (the test runner adds many more).
const loaders = process.execArgv.flatMap((a, i, all) => (/^--(import|require)=/.test(a) ? [a] : /^(--import|--require|-r)$/.test(a) ? [a, all[i + 1]] : []));

function fork(t, indexes, n) {
  const dir = `${tmp}-fork-${n}`;
  snapshot(dir, indexes);
  const log = path.join(dir, 'fork.log');
  const fd = fs.openSync(log, 'w');
  const child = spawn(process.execPath, [...loaders, path.join(testDir, 'lib', 'fork.mjs')], { env: { ...process.env, DEVTEAM_FORK: dir }, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  const exited = new Promise((resolve) => { child.on('error', (e) => resolve(String(e))); child.on('close', (code, signal) => resolve(signal ?? code)); });
  return Promise.all(indexes.map((i) => t.test(steps[i].name, async (st) => {
    const code = await exited;
    const f = path.join(dir, `result-${i}.json`);
    const r = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    for (const d of r?.diagnostics ?? []) st.diagnostic(d);
    if (r?.skip !== null && r?.skip !== undefined) return st.skip(r.skip);
    if (r?.ok && code === 0) return;
    const e = new Error(`${r?.error?.message ?? `the fork exited ${code} with no result for this step`}\n(run in a fork of the fixture: ${log})\n${r?.error?.stack ?? fs.readFileSync(log, 'utf8').slice(-4000)}`);
    if (r?.error) Object.assign(e, { actual: r.error.actual, expected: r.error.expected, operator: r.error.operator });
    throw e;
  }))).finally(() => { if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(dir, { recursive: true, force: true }); });
}

test('devteam kit', { concurrency: true }, async (t) => {
  useFixture(fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-kit-')));
  fs.writeFileSync(path.join(tmp, 'body.md'), '## One-way doors\n\nNone.\n');
  t.after(() => {
    spawnSync('tmux', ['kill-server']);
    if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(tmp, { recursive: true, force: true }); else console.log(`fixture kept at ${tmp}`);
  });
  const forks = [];
  for (let i = 0; i < steps.length;) {
    if (!forked.has(i)) { await t.test(steps[i].name, steps[i].fn); i++; continue; }
    const g = forked.get(i);
    const group = [];
    for (; forked.get(i) === g; i++) group.push(i);
    forks.push(fork(t, group, forks.length + 1));
  }
  await Promise.all(forks);
});

// Threads, on a project of their own: the chain's log clock runs into 2100, and a thread's rules
// compare when the owner and the supervisor last spoke. One fixture; the subtests run in order.
test('threads: records, commands, delivery, the Inbox and the loop', async (t) => {
  const F = threadsFixture();
  t.after(() => F.done());
  const show = (id) => JSON.parse(F.owner(['thread', 'show', id, '--json']));

  await t.test('the log takes a thread and turns from the owner, turns from the supervisor, and nothing else', () => {
    const T = 't-20261110-100000000-owner';
    const subject = { kind: 'item', ref: `goal:${F.goal}`, quote: 'Launch checkout' };
    const ok = (...ls) => { const r = F.checkWith(...ls); assert.equal(r.status, 0, r.said); };
    const refused = (why, ...ls) => { const r = F.checkWith(...ls); assert.notEqual(r.status, 0, `refused: ${why}`); assert.match(r.said, why); };
    const thread = ['owner', { type: 'thread', id: T, title: 'Launch checkout', subject }];
    ok(thread, ['owner', { type: 'turn', thread: T, text: 'Narrow this to the EU launch' }], ['supervisor', { type: 'turn', thread: T, text: 'Done.', refs: [`goal:${F.goal}`, 'act:a-20261110-101719000-supervisor'], question: 'q-20261110-101700000-supervisor' }]);
    ok(thread, ['owner', { type: 'thread', op: 'set', id: T, status: 'resolved', outcome: null }], ['supervisor', { type: 'thread', op: 'set', id: T, ready: { outcome: 'EU only', at: '2026-11-10T10:30:00.000Z' } }]);
    refused(/supervisor may not create thread lines/, ['supervisor', { type: 'thread', title: 'x' }]);
    refused(/ticket may not create turn lines/, ['demo-01-x', { type: 'turn', thread: T, text: 'x' }, 'demo-01-x.jsonl']);
    refused(/owner may not set thread\.ready/, thread, ['owner', { type: 'thread', op: 'set', id: T, ready: { outcome: 'x', at: '2026-11-10T10:30:00.000Z' } }]);
    refused(/supervisor may not set thread\.status/, thread, ['supervisor', { type: 'thread', op: 'set', id: T, status: 'resolved' }]);
    refused(/may not change turn lines/, thread, ['owner', { type: 'turn', op: 'set', id: 'u-20261110-100000000-owner', text: 'edited' }]);
    refused(/refs and question are on the supervisor's turns/, ['owner', { type: 'turn', thread: T, text: 'x', refs: ['goal:x'] }]);
    refused(/turn\.text is 2002 bytes; at most 2000/, ['owner', { type: 'turn', thread: T, text: 'é'.repeat(1001) }]);
    refused(/turn\.text is \d+ bytes as the log holds it; at most 3800/, ['owner', { type: 'turn', thread: T, text: '"'.repeat(1950) }]);
    refused(/thread\.title is one line/, ['owner', { type: 'thread', title: 'two\nlines' }]);
    refused(/thread\.outcome is \d+ bytes; at most 300/, thread, ['owner', { type: 'thread', op: 'set', id: T, status: 'resolved', outcome: 'o'.repeat(301) }]);
    // a subject: one of four kinds, only its own keys, each within its cap, 2,500 bytes in all
    const sub = (s) => ['owner', { type: 'thread', title: 't', subject: s }];
    refused(/kind is one of item, page, artifact, preview/, sub({ kind: 'lens' }));
    refused(/an item subject has no view/, sub({ ...subject, view: '#goals' }));
    refused(/ref is <type>:<id>/, sub({ kind: 'item', ref: 'secret:x' }));
    refused(/the subject is \d+ bytes encoded; at most 2500/, sub({ kind: 'item', ref: `goal:${F.goal}`, quote: 'q'.repeat(2600) }));
    refused(/quote is 301 bytes; at most 300/, sub({ kind: 'item', ref: `goal:${F.goal}`, quote: 'q'.repeat(301) }));
    // bytes, not characters: 200 é are 200 characters (the schema's count passes them) and 400 bytes
    refused(/quote is 400 bytes; at most 300/, sub({ kind: 'item', ref: `goal:${F.goal}`, quote: 'é'.repeat(200) }));
    refused(/anchor\.html is 1200 bytes; at most 1024/, sub({ kind: 'preview', name: 'cool-tiger', anchor: { html: 'é'.repeat(600) } }));
    refused(/at is \{x, y\}, each a fraction/, sub({ kind: 'page', view: '#goals', at: { x: 1.5, y: 0 } }));
    ok(sub({ kind: 'page', view: '#loop/observe', at: { x: 0.25, y: 0.5 }, quote: 'Loop' }));
    // the shapes a later kit's viewers write: accepted now, so the log needn't change for them
    const anchor = { selector: 'main > button.buy', tag: 'button', role: 'button', text: 'Buy now', name: 'Buy now', html: '<button class="buy">Buy now</button>', rect: { x: 10, y: 20, w: 80, h: 24 }, point: { x: 4, y: 6 } };
    ok(sub({ kind: 'artifact', slug: 'pricing-mock', at: 'main', fp: 'a'.repeat(64), path: 'index.html', anchor }));
    ok(sub({ kind: 'artifact', slug: 'pricing-mock', at: `tree:${'b'.repeat(40)}`, point: { x: 120, y: 340 } }));
    ok(sub({ kind: 'preview', name: 'cool-tiger', route: '/checkout', viewport: { w: 1280, h: 800 }, anchor, errors: ['e1', 'e2', 'e3'] }));
    refused(/errors is a list of at most 3/, sub({ kind: 'preview', name: 'cool-tiger', errors: ['1', '2', '3', '4'] }));
    refused(/anchor\.html is 1025 bytes; at most 1024/, sub({ kind: 'preview', name: 'cool-tiger', anchor: { html: 'h'.repeat(1025) } }));
    refused(/name is a preview name/, sub({ kind: 'preview', name: 'Cool Tiger' }));
    // a question asked in a thread, and an answer recorded from one: channel thread names its turn
    const Q = 'q-20261110-100100000-supervisor';
    const asked = ['supervisor', { type: 'question', id: Q, kind: 'owner-decision', question: 'EU only?', thread: T }];
    ok(asked, ['owner', { type: 'question', op: 'set', id: Q, answer: 'yes', said: 'yes, go ahead', turn: 'u-20261110-100200000-owner', channel: 'thread' }]);
    refused(/a thread answer names the owner's turn/, asked, ['owner', { type: 'question', op: 'set', id: Q, answer: 'yes', said: 'yes', channel: 'thread' }]);
    refused(/turn is on an answer recorded from a thread/, asked, ['owner', { type: 'question', op: 'set', id: Q, answer: 'yes', turn: 'u-20261110-100200000-owner' }]);
    refused(/a thread line is an answer/, ['owner', { type: 'observation', subject: 'x', kind: 'k', detail: 'd', channel: 'thread' }]);
  });
});
