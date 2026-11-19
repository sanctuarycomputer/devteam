// The job registry (kit-162; design recurring-checks-and-chores-under-upkeep, C3 and "Registering"):
// settings.recurring is the owner's (recurring-edit), and a change to it lands only as an answered
// question showed it, entry by entry; ask --class recurring-edit --change, the 100-runs-a-day cap,
// ticket and plan branches, Upkeep's holds, recurring list, show and apply, and supervisor.md.
// Each test is a fixture repo with a bare origin and forge "git", run through the kit's commands.
// Run with TMUX unset: no fixture here starts or stops a tmux server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { monoFixture, write, json, kit } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const QID = /q-[0-9]+-[0-9]+-supervisor/;
const BLOCK = /```json devteam\s*\n([\s\S]*?)\n```/;
const HEADER = 'This answer approves exactly these job changes, and no other:';

// Jobs that hold RECURRING_ENTRY_SHAPE@1.
const check = (extra = {}) => ({ kind: 'check', title: 'CI on main', what: 'the kit CI on main is green', every: '6h', run: 'gh run list --limit 1', ...extra });
const chore = (extra = {}) => ({ kind: 'chore', title: 'Tidy branches', what: 'merged branches are gone', every: '1w', by: 'supervisor', prompt: 'Delete merged branches.', ...extra });

// A fixture of its own per test; removed afterwards without touching any tmux server.
function setup(name) {
  const F = monoFixture(`recur-${name}`);
  const { old, g } = F;
  const run = (args, role = SUP, cwd = old) => { const r = F.run(cwd, args, role); return { ...r, text: `${r.out}\n${r.err}` }; };
  const ok = (args, role = SUP, cwd = old) => F.ok(cwd, args, role);
  const text = (r) => `${r.out}\n${r.err}`;
  const blockAt = (file) => JSON.parse(BLOCK.exec(fs.readFileSync(file, 'utf8'))[1]);
  const mainSettings = () => JSON.parse(BLOCK.exec(g(['show', 'origin/main:docs/devteam/project/settings.md'], old))[1]);
  // main moves by hand (a commit pushed straight to origin): how a job reached main before this ticket
  const onMain = (fn, msg = 'main moves') => { F.edit(fn); g(['commit', '-qam', msg], old); g(['push', '-q', 'origin', 'main'], old); g(['fetch', '-q', 'origin'], old); };
  // a question asked with the kit's rules for the class; returns { status, text, qid }
  const ask = (change, extra = []) => {
    const r = run(['ask', '--class', 'recurring-edit', '--question', 'Should I change these jobs?', '--recommendation', 'Yes', ...(change === undefined ? [] : ['--change', JSON.stringify(change)]), ...extra]);
    return { status: r.status, text: text(r), qid: r.status === 0 ? (QID.exec(r.out) ?? [null])[0] : null };
  };
  const asked = (change, extra) => { const r = ask(change, extra); assert.equal(r.status, 0, r.text); return r.qid; };
  const answer = (qid, words = 'Yes') => F.ok(old, ['answer', qid, words]);
  // an answered yes for this change
  const yes = (change) => { const q = asked(change); answer(q); return q; };
  // a chore branch off origin/main: fn edits its worktree, then it is committed, pushed and given its PR text
  const choreBranch = (slug, fn) => {
    g(['fetch', '-q', 'origin'], old);
    const wt = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, wt, 'origin/main'], old);
    fn(wt);
    g(['add', '-A'], wt);
    g(['commit', '-q', '--allow-empty', '-m', `chore-${slug}: jobs`], wt);
    g(['push', '-q', '-f', 'origin', `chore-${slug}`], wt);
    write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: jobs\n\n## One-way doors\n\nNone.\n`);
    return wt;
  };
  // a chore whose settings.md has recurring as fn leaves it (fn gets the block)
  const jobsChore = (slug, fn) => choreBranch(slug, (wt) => F.edit(fn, wt));
  const merge = (slug, args = []) => { const r = run(['merge', '--chore', slug, ...args]); return { status: r.status, text: text(r) }; };
  const dry = (slug, q) => merge(slug, ['--dry-run', ...(q ? ['--approved', q] : [])]);
  const acts = () => json(F.ok(old, ['log', '--type', 'act', '--json']));
  const logFile = (who) => { const d = path.join(old, 'docs/devteam/run/log'); return path.join(d, fs.readdirSync(d).find((f) => f.startsWith(`${who}-`))); };
  const done = () => { if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(F.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  return { ...F, run, ok, text, blockAt, mainSettings, onMain, ask, asked, answer, yes, choreBranch, jobsChore, merge, dry, acts, logFile, done };
}
const refused = (r, re) => { assert.notEqual(r.status, 0, r.text); if (re) assert.match(r.text, re); };
const passes = (r) => assert.equal(r.status, 0, r.text);

test('A2: a chore adding a job lands only with an answered recurring-edit question showing it, as one merge-chore act', () => {
  const T = setup('add');
  try {
    T.jobsChore('recurring', (j) => { j.recurring = { 'ci-main': check() }; });
    refused(T.dry('recurring'), /recurring-edit/);
    const q = T.yes({ recurring: { 'ci-main': check() } });
    passes(T.dry('recurring', q));
    passes(T.merge('recurring', ['--approved', q]));
    assert.deepEqual(T.mainSettings().recurring, { 'ci-main': check() });
    const landed = T.acts().filter((a) => a.class === 'merge-chore' && a.approved_by === q);
    assert.equal(landed.length, 1, JSON.stringify(landed));
  } finally { T.done(); }
});

test('A3: editing one field of a live job (every, run, prompt) needs an answer showing the edited job', () => {
  const T = setup('edit');
  try {
    T.onMain((j) => { j.recurring = { 'ci-main': check(), tidy: chore() }; });
    for (const [name, edited] of [['ci-main', check({ every: '12h' })], ['ci-main', check({ run: 'gh run list --limit 2' })], ['tidy', chore({ prompt: 'Delete merged branches, then prune.' })]]) {
      const slug = `edit-${name}-${Object.keys(edited).find((k) => JSON.stringify(edited[k]) !== JSON.stringify((name === 'tidy' ? chore() : check())[k]))}`;
      T.jobsChore(slug, (j) => { j.recurring[name] = edited; });
      refused(T.dry(slug), /recurring-edit/);
      const stale = T.yes({ recurring: { [name]: { ...edited, title: 'Something else' } } });
      refused(T.dry(slug, stale), new RegExp(`recurring\\.${name}`));
      const q = T.yes({ recurring: { [name]: edited } });
      passes(T.dry(slug, q));
    }
  } finally { T.done(); }
});

test('A4: an answer for one job lands nothing else; a null lands only that removal', () => {
  const T = setup('entries');
  try {
    T.onMain((j) => { j.recurring = { a: check(), b: chore() }; });
    const qa = T.yes({ recurring: { a: check({ every: '12h' }) } });
    T.jobsChore('also-adds', (j) => { j.recurring.a = check({ every: '12h' }); j.recurring.c = chore(); });
    refused(T.dry('also-adds', qa), /recurring\.c/);
    T.jobsChore('also-edits', (j) => { j.recurring.a = check({ every: '12h' }); j.recurring.b = chore({ every: '2w' }); });
    refused(T.dry('also-edits', qa), /recurring\.b/);
    T.jobsChore('other-field', (j) => { j.recurring.a = check({ every: '12h', timeout_s: 300 }); });
    refused(T.dry('other-field', qa), /recurring\.a/);
    T.jobsChore('exact', (j) => { j.recurring.a = check({ every: '12h' }); });
    passes(T.dry('exact', qa));
    const stop = T.yes({ recurring: { b: null } });
    T.jobsChore('stop-b', (j) => { delete j.recurring.b; });
    passes(T.dry('stop-b', stop));
    T.jobsChore('stop-b-and-more', (j) => { delete j.recurring.b; j.recurring.a = check({ every: '2h' }); });
    refused(T.dry('stop-b-and-more', stop), /recurring\.a/);
  } finally { T.done(); }
});

test('A5: another class, a standing rule, or a question changed after its answer approves nothing', () => {
  const T = setup('other-answers');
  try {
    // the owner's standing rule, for a project that put recurring-edit in owner_rules
    const cf = path.join(T.old, 'docs/devteam/governance/constitution.md');
    fs.writeFileSync(cf, fs.readFileSync(cf, 'utf8').replace('"owner_rules": ["gate-change"]', '"owner_rules": ["gate-change", "recurring-edit"]'));
    T.g(['commit', '-qam', 'owner rules'], T.old);
    T.g(['push', '-q', 'origin', 'main'], T.old);
    T.ok(['knowledge', 'add', '--kind', 'preference', '--statement', 'Add any job you like.', '--scope', 'class:recurring-edit', '--owner'], {});
    T.jobsChore('add', (j) => { j.recurring = { 'ci-main': check() }; });
    refused(T.dry('add'), /recurring-edit/);
    for (const cls of ['governance-edit', 'new-feature']) {
      const r = T.run(['ask', '--class', cls, '--question', `A ${cls} question?`, '--recommendation', 'Yes']);
      passes({ status: r.status, text: T.text(r) });
      const q = QID.exec(r.out)[0];
      T.answer(q);
      refused(T.dry('add', q), /recurring-edit/);
    }
    // a question whose change is rewritten after the owner answered it
    const q = T.yes({ recurring: { 'ci-main': check({ every: '12h' }) } });
    fs.appendFileSync(T.logFile('supervisor'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: q, at: new Date(Date.now() + 1000).toISOString(), by: 'supervisor', change: { recurring: { 'ci-main': check() } } })}\n`);
    refused(T.dry('add', q));
  } finally { T.done(); }
});

test('A6: one answer, one key: recurring with another owner setting is refused whatever the answer', () => {
  const T = setup('split');
  try {
    T.jobsChore('with-gates', (j) => { j.recurring = { 'ci-main': check() }; j.gates = { test: 'true' }; });
    T.jobsChore('with-agent', (j) => { j.recurring = { 'ci-main': check() }; j.agent_command = 'echo other'; });
    const rq = T.yes({ recurring: { 'ci-main': check() } });
    const gr = T.run(['ask', '--class', 'governance-edit', '--question', 'Change the agent command?', '--recommendation', 'Yes']);
    const gq = QID.exec(gr.out)[0];
    T.answer(gq);
    for (const slug of ['with-gates', 'with-agent']) for (const q of [null, rq, gq]) refused(T.dry(slug, q), /split/);
    T.jobsChore('jobs-only', (j) => { j.recurring = { 'ci-main': check() }; });
    refused(T.dry('jobs-only', gq), /recurring-edit/);
  } finally { T.done(); }
});

test('A7: a chore that only removes a job lands only with an answer whose change is that name: null', () => {
  const T = setup('remove');
  try {
    T.onMain((j) => { j.recurring = { 'old-job': chore() }; });
    T.jobsChore('stop', (j) => { delete j.recurring['old-job']; });
    refused(T.dry('stop'), /recurring-edit/);
    const q = T.yes({ recurring: { 'old-job': null } });
    passes(T.merge('stop', ['--approved', q]));
    assert.deepEqual(T.mainSettings().recurring, {});
  } finally { T.done(); }
});

test('A8: the registry chore waits while Upkeep is drained or parked; --force goes ahead, logged', () => {
  for (const mode of ['drain', 'park']) {
    const T = setup(`hold-${mode}`);
    try {
      T.ok(['goal', 'hold', 'upkeep', mode, '--owner', ...(mode === 'park' ? ['--reason', 'a test'] : [])], {});
      refused(T.run(['chore', 'start', 'recurring']), /Upkeep/);
      passes(T.run(['chore', 'start', 'recurring', '--force']));
      const forced = T.acts().filter((a) => a.class === 'goal-hold' && (a.refs ?? []).includes('chore-recurring'));
      assert.equal(forced.length, 1, JSON.stringify(T.acts()));
      assert.match(forced[0].what, /--force/);
      T.g(['worktree', 'remove', '--force', path.join(T.old, '.worktrees/chore-recurring')], T.old);
      T.g(['branch', '-D', 'chore-recurring'], T.old);
      T.jobsChore('recurring', (j) => { j.recurring = { 'ci-main': check() }; });
      const q = T.yes({ recurring: { 'ci-main': check() } });
      refused(T.merge('recurring', ['--approved', q]), /Upkeep|goal is/);
      passes(T.merge('recurring', ['--approved', q, '--force']));
      const act = T.acts().find((a) => a.class === 'merge-chore' && a.approved_by === q);
      assert.match(act.what, /with --force/);
    } finally { T.done(); }
  }
});

test('A9: ask --class recurring-edit --change takes the C3 shape and nothing else, one pending question per job, and the cap', () => {
  const T = setup('ask');
  try {
    T.onMain((j) => { j.recurring = { tidy: chore() }; });
    const add = T.ask({ recurring: { 'ci-main': check() } });
    passes(add);
    const q = json(T.ok(['questions', '--id', add.qid, '--json']))[0];
    assert.ok(q.context.includes(HEADER), q.context);
    assert.ok(q.context.includes('recurring.ci-main: add'), q.context);
    passes(T.ask({ recurring: { tidy: null } }));
    refused(T.ask({ recurring: { x: check() }, gates: {} }), /only "recurring"/);
    refused(T.ask({ recurring: { x: check({ every: '30m' }) } }), /recurring\.x\.every/);
    refused(T.ask({ recurring: { ghost: null } }), /no such job/);
    refused(T.ask({ recurring: { 'ci-main': check({ every: '12h' }) } }), new RegExp(`${add.qid}`));
    T.answer(add.qid);
    refused(T.ask({ recurring: { 'ci-main': check({ every: '12h' }) } }), /not landed/);
    refused(T.ask(undefined), /--change/);
    // the cap: main at 90 with hourly x (24); an open stop of x; then an hourly y is refused
    const filler = Object.fromEntries(Array.from({ length: 66 }, (_, i) => [`daily-${i + 1}`, chore({ every: '1d' })]));
    T.onMain((j) => { j.recurring = { ...filler, x: check({ every: '1h' }) }; });
    passes(T.ask({ recurring: { x: null } }));
    refused(T.ask({ recurring: { y: check({ every: '1h' }) } }), /cap of 100/);
    passes(T.ask({ recurring: { y: check({ every: '1d' }) } }));
  } finally { T.done(); }
});

test('A10: a ticket or plan branch that changes recurring is refused by check-pr and merge', () => {
  const T = setup('branches');
  try {
    T.lines(T.STD);
    T.ok(['ticket', 'add', 'api-01-x', '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['its suite passes in CI'], notes: 'n' })]);
    for (const branch of ['ticket/api-01-x', 'plan/jobs']) {
      T.g(['fetch', '-q', 'origin'], T.old);
      const wt = path.join(T.base, branch.replace('/', '-'));
      T.g(['worktree', 'add', '-q', '-b', branch, wt, 'origin/main'], T.old);
      T.edit((j) => { j.recurring = { 'ci-main': check() }; }, wt);
      T.g(['commit', '-qam', 'jobs'], wt);
      T.g(['push', '-q', 'origin', branch], wt);
      const sha = T.g(['rev-parse', 'HEAD'], wt);
      const r = T.run(['check-pr', '--head-ref', branch, '--sha', sha, '--title', 'x']);
      refused({ status: r.status, text: T.text(r) }, /changes recurring: jobs are the owner's/);
    }
    write(path.join(T.old, 'docs/devteam/run/pr/plan/jobs.md'), '# plan-jobs: jobs\n\n## One-way doors\n\nNone.\n');
    const m = T.run(['merge', '--plan', 'jobs', '--dry-run']);
    refused({ status: m.status, text: T.text(m) }, /changes recurring: jobs are the owner's/);
  } finally { T.done(); }
});

test('A11: merge refuses a job that breaks the shape; validate and merge refuse over 100 runs a day, naming the jobs', () => {
  const T = setup('shape-cap');
  try {
    T.jobsChore('bad', (j) => { j.recurring = { broken: check({ every: '5x' }) }; });
    const q = T.yes({ recurring: { broken: check({ every: '6h' }) } });
    refused(T.dry('bad', q), /recurring\.broken\.every/);
    const many = { ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`hourly-${i + 1}`, check({ every: '1h' })])), extra: chore({ every: '1d' }), more: chore({ every: '1d' }), most: chore({ every: '1d' }), last: chore({ every: '1d' }), final: chore({ every: '1d' }) };
    T.edit((j) => { j.recurring = many; });
    const v = T.run(['validate']);
    refused({ status: v.status, text: T.text(v) }, /101 runs a day[^\n]*hourly-1/);
    T.g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], T.old);
    T.jobsChore('over', (j) => { j.recurring = many; });
    refused(T.dry('over'), /101 runs a day[^\n]*hourly-1/);
  } finally { T.done(); }
});

test('A12: recurring apply writes exactly the answered change and leaves every other byte alone', () => {
  const T = setup('apply');
  try {
    T.onMain((j) => { j.recurring = { a: check(), b: chore() }; });
    const change = { recurring: { a: check({ every: '12h' }), c: chore({ every: '2w' }) } };
    const open = T.asked(change);
    T.ok(['chore', 'start', 'recurring']);
    const wtFile = path.join(T.old, '.worktrees/chore-recurring/docs/devteam/project/settings.md');
    const before = fs.readFileSync(wtFile, 'utf8');
    refused((() => { const r = T.run(['recurring', 'apply', open]); return { status: r.status, text: T.text(r) }; })(), /answered/);
    T.answer(open);
    passes((() => { const r = T.run(['recurring', 'apply', open]); return { status: r.status, text: T.text(r) }; })());
    const after = fs.readFileSync(wtFile, 'utf8');
    assert.deepEqual(T.blockAt(wtFile).recurring, { a: check({ every: '12h' }), b: chore(), c: chore({ every: '2w' }) });
    // every other key byte-identical: the text outside the recurring value is the same
    const outside = (t) => { const i = t.indexOf('"recurring":'); const o = JSON.parse(BLOCK.exec(t)[1]); const s = JSON.stringify(o.recurring, null, 2).split('\n').length; return [t.slice(0, i), t.split('\n').slice(t.slice(0, i).split('\n').length - 1 + s).join('\n')]; };
    assert.equal(outside(after)[0], outside(before)[0]);
    const keysOf = (t) => { const o = JSON.parse(BLOCK.exec(t)[1]); delete o.recurring; return o; };
    assert.deepEqual(keysOf(after), keysOf(before));
    assert.equal(after.replace(BLOCK, ''), before.replace(BLOCK, ''));
    // declined and other classes
    T.g(['checkout', '-q', '--', '.'], path.join(T.old, '.worktrees/chore-recurring'));
    const no = T.asked({ recurring: { d: chore() } });
    T.answer(no, 'No');
    refused((() => { const r = T.run(['recurring', 'apply', no]); return { status: r.status, text: T.text(r) }; })());
    const gr = T.run(['ask', '--class', 'governance-edit', '--question', 'Something else?', '--recommendation', 'Yes']);
    const gq = QID.exec(gr.out)[0];
    T.answer(gq);
    refused((() => { const r = T.run(['recurring', 'apply', gq]); return { status: r.status, text: T.text(r) }; })(), /recurring-edit/);
    assert.equal(fs.readFileSync(wtFile, 'utf8'), before);
  } finally { T.done(); }
});

test("A13: recurring list --json and show read main's jobs, with who registered each and the qid", () => {
  const T = setup('list');
  try {
    T.onMain((j) => { j.recurring = { 'by-hand': chore() }; });
    T.jobsChore('recurring', (j) => { j.recurring['ci-main'] = check(); });
    const q = T.yes({ recurring: { 'ci-main': check() } });
    passes(T.merge('recurring', ['--approved', q]));
    T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    T.edit((j) => { j.recurring['not-landed'] = check(); });
    const list = json(T.ok(['recurring', 'list', '--json'], {}));
    const names = list.entries.map((e) => e.name);
    assert.deepEqual(names, ['by-hand', 'ci-main']);
    const ci = list.entries.find((e) => e.name === 'ci-main');
    assert.equal(ci.registered.qid, q);
    assert.equal(ci.registered.by, 'supervisor');
    assert.deepEqual(ci.entry, check());
    assert.equal(list.entries.find((e) => e.name === 'by-hand').registered, null);
    const show = T.ok(['recurring', 'show', 'ci-main'], {});
    assert.ok(show.includes(q) && show.includes('gh run list --limit 1'), show);
    refused((() => { const r = T.run(['recurring', 'show', 'not-landed'], {}); return { status: r.status, text: T.text(r) }; })(), /no job/);
  } finally { T.done(); }
});

test('A14: supervisor.md documents registering, changing and stopping a job, and that none writes to production', () => {
  const doc = fs.readFileSync(path.join(kit, 'process/supervisor.md'), 'utf8');
  const at = (re) => doc.search(re);
  const s = at(/^## Recurring jobs$/m);
  assert.ok(s > at(/^## 3\. /m) && s < at(/^## 4\. /m), 'a level-2 section between §3 and §4');
  const end = doc.indexOf('\n## ', s + 1);
  const section = doc.slice(s, end);
  for (const w of ['recurring-edit', 'thread ask', 'answer', '--from-turn', 'recurring apply', 'chore start recurring', 'merge --chore recurring --approved', 'null', 'recurring propose', '--stop', 'production']) assert.ok(section.includes(w), `the section says ${w}`);
  const mon = doc.slice(at(/^### Monitoring$/m), at(/^## Recurring jobs$/m));
  assert.match(mon, /Recurring jobs/);
});
