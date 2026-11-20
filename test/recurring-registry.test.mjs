// The job registry (kit-162; design recurring-checks-and-chores-under-upkeep, C3 and "Registering"):
// settings.recurring is the owner's (recurring-edit), and a change to it lands only as an answered
// question showed it, entry by entry; ask --class recurring-edit --change, the 100-runs-a-day cap,
// ticket and plan branches, Upkeep's holds, recurring list, show and apply, and supervisor.md.
// Each test is a fixture repo with a bare origin and forge "git", run through the kit's commands.
// Run with TMUX unset: no fixture here starts or stops a tmux server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { monoFixture, multiFixture, write, json, kit, gitShim } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const QID = /q-[0-9]+-[0-9]+-supervisor/;
const BLOCK = /```json devteam\s*\n([\s\S]*?)\n```/;
const HEADER = 'This answer approves exactly these job changes, and no other:';
// the head's settings.md is not main's and the head doesn't contain main's checked tip: the kit
// predicts no merge of the file, so it is refused until main is merged in (rulings
// d-20261120-044235981, d-20261120-075327162)
const DIFFERS = /settings\.md: this branch's settings\.md differs from main's and the branch doesn't contain main's tip; merge main into the branch first/;
// under merge_method rebase only a head whose settings.md is main's, with no merge commit and no
// commit touching the file since main, is cleared (d-20261120-102757339)
const REBASE_ALONE = /settings\.md: merge_method is rebase, which replays commits, so the branch must leave settings\.md alone; land the change with merge or squash/;
// the head's settings.md is not mode 100644 (final-7 F2)
const NOT_REGULAR = /settings\.md at the head is not a regular file \(mode \d+\); the kit reads only a plain file/;
const MAIN_CHANGED = DIFFERS;
const MAIN_CHANGED_REBASE = REBASE_ALONE;

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
    // a job of its own per field, so each question is the only one for its job
    T.onMain((j) => { j.recurring = { 'ci-every': check(), 'ci-run': check(), tidy: chore() }; });
    const cases = [
      ['ci-every', 'every', check({ every: '12h' }), check({ every: '24h' })],
      ['ci-run', 'run', check({ run: 'gh run list --limit 2' }), check({ run: 'gh run list --limit 3' })],
      ['tidy', 'prompt', chore({ prompt: 'Delete merged branches, then prune.' }), chore({ prompt: 'Delete every branch.' })],
    ];
    for (const [name, field, edited, otherValue] of cases) {
      const slug = `edit-${name}-${field}`;
      const q = T.yes({ recurring: { [name]: edited } });
      T.jobsChore(slug, (j) => { j.recurring[name] = edited; });
      refused(T.dry(slug), /recurring-edit/);
      // the same field edited to another value: the answer showed something else
      T.jobsChore(`${slug}-other`, (j) => { j.recurring[name] = otherValue; });
      refused(T.dry(`${slug}-other`, q), new RegExp(`recurring\\.${name}`));
      passes(T.dry(slug, q));
    }
  } finally { T.done(); }
});

test('A4: an answer for one job lands nothing else; a null lands only that removal', () => {
  const T = setup('entries');
  try {
    T.onMain((j) => { j.recurring = { aa: check(), bb: chore() }; });
    const qa = T.yes({ recurring: { aa: check({ every: '12h' }) } });
    T.jobsChore('also-adds', (j) => { j.recurring.aa = check({ every: '12h' }); j.recurring.cc = chore(); });
    refused(T.dry('also-adds', qa), /recurring\.cc/);
    T.jobsChore('also-edits', (j) => { j.recurring.aa = check({ every: '12h' }); j.recurring.bb = chore({ every: '2w' }); });
    refused(T.dry('also-edits', qa), /recurring\.bb/);
    T.jobsChore('other-field', (j) => { j.recurring.aa = check({ every: '12h', timeout_s: 300 }); });
    refused(T.dry('other-field', qa), /recurring\.aa/);
    T.jobsChore('with-workflow', (j) => { j.recurring.aa = check({ every: '12h' }); });
    fs.appendFileSync(path.join(T.old, '.worktrees/chore-with-workflow/.github/workflows/ci.yml'), '# more\n');
    T.g(['commit', '-qam', 'workflow too'], path.join(T.old, '.worktrees/chore-with-workflow'));
    T.g(['push', '-q', '-f', 'origin', 'chore-with-workflow'], path.join(T.old, '.worktrees/chore-with-workflow'));
    refused(T.dry('with-workflow', qa), /outside project\/[^\n]*\.github\/workflows\/ci\.yml/);
    T.jobsChore('exact', (j) => { j.recurring.aa = check({ every: '12h' }); });
    passes(T.dry('exact', qa));
    const stop = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-b', (j) => { delete j.recurring.bb; });
    passes(T.dry('stop-b', stop));
    T.jobsChore('stop-b-and-more', (j) => { delete j.recurring.bb; j.recurring.aa = check({ every: '2h' }); });
    refused(T.dry('stop-b-and-more', stop), /recurring\.aa/);
    // an answer cited on a chore that changes no owner setting lands none of what it showed (task-2 F4)
    T.choreBranch('no-jobs', () => {});
    refused(T.dry('no-jobs', qa), /recurring\.aa[^\n]*leaves it as main has it/);
    // main's jobs moved since the branch: what would land is not what the base-to-head diff shows (task-2 F1)
    T.jobsChore('stale', (j) => { j.recurring.dd = check({ every: '8h' }); });
    T.onMain((j) => { j.recurring.bb = chore({ every: '2w' }); });
    const qd = T.yes({ recurring: { dd: check({ every: '8h' }) } });
    refused(T.dry('stale', qd), MAIN_CHANGED);
    const stale = path.join(T.old, '.worktrees/chore-stale');
    T.g(['fetch', '-q', 'origin'], stale);
    T.g(['merge', '-q', '--no-edit', 'origin/main'], stale);
    T.g(['push', '-q', 'origin', 'chore-stale'], stale);
    passes(T.dry('stale', qd));
    // main reorders the jobs' text, the same value, with no answer needed: the text merge would keep
    // a job this branch stops (task-2-r3 F1-1a; final-1 F1): refused until main is merged in
    T.onMain((j) => { j.recurring = { ...j.recurring, ee: check({ every: '12h' }), ff: chore({ every: '1d' }) }; });
    const qf = T.yes({ recurring: { ff: null } });
    const late = T.jobsChore('stop-ff', (j) => { delete j.recurring.ff; });
    T.onMain((j) => { const { ff, ...rest } = j.recurring; j.recurring = { ff, ...rest }; });
    refused(T.dry('stop-ff', qf), MAIN_CHANGED);
    T.g(['fetch', '-q', 'origin'], late);
    T.g(['merge', '-q', '--no-edit', 'origin/main'], late);
    // the merge keeps main's moved ff, so the branch stops it again on top
    T.edit((j) => { delete j.recurring.ff; }, late);
    T.g(['commit', '-q', '--allow-empty', '-am', 'stop ff again'], late);
    T.g(['push', '-q', 'origin', 'chore-stop-ff'], late);
    passes(T.dry('stop-ff', qf));
    // criss-cross: two merge bases, and the one git merge-base names has main's settings blob, while
    // the merge itself (over both) lands something else: what lands is read from the merge (task-2-r4 F1-1b).
    // Deterministic: B1, whose blob is main's, is committed after B2, so merge-base names it.
    const qe = T.yes({ recurring: { ee: null } });
    const before = fs.readFileSync(T.settingsFile, 'utf8');
    const ago = (secs) => { const d = `${Math.floor(Date.now() / 1000) - secs} +0000`; return { ...process.env, GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d }; };
    T.g(['checkout', '-q', '-b', 'cc-side'], T.old);
    T.edit((j) => { const { ee, ...rest } = j.recurring; j.recurring = { ee, ...rest }; });
    execFileSync('git', ['commit', '-qam', 'B2: the jobs text reordered'], { cwd: T.old, env: ago(120) });
    T.g(['checkout', '-q', 'main'], T.old);
    fs.writeFileSync(path.join(T.old, 'README.md'), 'B1\n');
    execFileSync('git', ['commit', '-qam', 'B1: unrelated'], { cwd: T.old, env: ago(60) });
    const b1 = T.g(['rev-parse', 'HEAD'], T.old);
    const cc = path.join(T.old, '.worktrees/chore-cc');
    T.g(['worktree', 'add', '-q', '-b', 'chore-cc', cc, 'cc-side'], T.old);
    T.g(['merge', '-q', '--no-edit', b1], cc);
    T.g(['merge', '-q', '--no-edit', 'cc-side'], T.old);
    fs.writeFileSync(T.settingsFile, before);
    T.g(['commit', '-qam', 'the jobs text back'], T.old);
    T.g(['push', '-q', 'origin', 'main'], T.old);
    T.edit((j) => { delete j.recurring.ee; }, cc);
    T.g(['commit', '-qam', 'stop ee'], cc);
    T.g(['push', '-q', 'origin', 'chore-cc'], cc);
    write(path.join(T.old, 'docs/devteam/run/pr/chore-cc.md'), '# chore-cc: jobs\n\n## One-way doors\n\nNone.\n');
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['merge-base', '--all', 'origin/main', 'origin/chore-cc'], T.old).split('\n').length, 2, 'two merge bases');
    const mb = T.g(['merge-base', 'origin/main', 'origin/chore-cc'], T.old);
    assert.equal(T.g(['rev-parse', `${mb}:docs/devteam/project/settings.md`], T.old), T.g(['rev-parse', 'origin/main:docs/devteam/project/settings.md'], T.old), 'the named base has main\'s settings blob');
    // one base's blob is not main's: main changed the file, and the branch touches it
    refused(T.dry('cc', qe), MAIN_CHANGED);
  } finally { T.done(); }
});

test('A4b: what lands is judged on every home PR: a stale branch that only reorders the jobs text cannot bring back a job main stopped', () => {
  // A branch whose recurring text is moved but canonically unchanged reads as no change against its
  // merge base, while git's 3-way merge of it onto a main that stopped a job puts the job back
  // (final-1 F1). Whether a PR changes the jobs is read from main's jobs now against the merged result.
  const T = setup('lands');
  try {
    T.lines(T.STD);
    for (const id of ['api-01-x', 'api-02-decoy']) T.ok(['ticket', 'add', id, '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['its suite passes in CI'], notes: 'n' })]);
    const jobs = { aa: check({ title: 'A job', every: '6h' }), bb: check({ title: 'B job', every: '12h', run: 'echo bb' }), cc: chore({ title: 'C job', prompt: 'C.' }), dd: check({ title: 'D job', every: '8h', run: 'echo dd' }), ee: chore({ title: 'E job', every: '2w', prompt: 'E.' }) };
    T.onMain((j) => { j.recurring = jobs; });
    const moveBb = (j) => { const { aa, bb, cc, dd, ee } = j.recurring; j.recurring = { aa, cc, dd, bb, ee }; };
    // cut now: a chore that only moves bb's text after dd, one that also adds ff, and a ticket that only moves it
    T.jobsChore('sneak', moveBb);
    T.jobsChore('sneak-ff', (j) => { moveBb(j); j.recurring.ff = chore({ title: 'F job', prompt: 'F.' }); });
    const tw = path.join(T.base, 'ticket-api-01-x');
    T.g(['worktree', 'add', '-q', '-b', 'ticket/api-01-x', tw, 'origin/main'], T.old);
    T.edit(moveBb, tw);
    T.g(['commit', '-qam', 'jobs text moved'], tw);
    T.g(['push', '-q', 'origin', 'ticket/api-01-x'], tw);
    const tsha = T.g(['rev-parse', 'HEAD'], tw);
    // the decoy (final-2b B2-1): a copy of the block above the original, its fence with a trailing
    // space (still the kit's fence); git puts main's stop in the original, the kit reads the copy
    const decoy = (t) => { const m = BLOCK.exec(t); return `${m[0].replace('```json devteam', '```json devteam ')}\n\n${t}`; };
    const raw = (wt, fn) => { const f = path.join(wt, 'docs/devteam/project/settings.md'); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); };
    T.choreBranch('decoy', (wt) => raw(wt, decoy));
    const dw = path.join(T.base, 'ticket-api-02-decoy');
    T.g(['worktree', 'add', '-q', '-b', 'ticket/api-02-decoy', dw, 'origin/main'], T.old);
    raw(dw, decoy);
    T.g(['commit', '-qam', 'jobs block copied'], dw);
    T.g(['push', '-q', 'origin', 'ticket/api-02-decoy'], dw);
    const dsha = T.g(['rev-parse', 'HEAD'], dw);
    // the owner stops bb, and it lands
    const stop = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-bb', (j) => { delete j.recurring.bb; });
    passes(T.merge('stop-bb', ['--approved', stop]));
    assert.equal(Object.hasOwn(T.mainSettings().recurring, 'bb'), false);
    // the chore: its merge would put bb back; main changed settings.md under it, so it is refused
    // until main is merged in, and nothing lands
    refused(T.merge('sneak'), MAIN_CHANGED);
    assert.equal(Object.hasOwn(T.mainSettings().recurring, 'bb'), false);
    // with an answer for ff alone: the same refusal, before any comparison
    const qff = T.yes({ recurring: { ff: chore({ title: 'F job', prompt: 'F.' }) } });
    refused(T.dry('sneak-ff', qff), MAIN_CHANGED);
    // the ticket: a stale ticket branch that only moves the text is refused by check-pr
    const r = T.run(['check-pr', '--head-ref', 'ticket/api-01-x', '--sha', tsha, '--title', 'x']);
    refused({ status: r.status, text: T.text(r) }, MAIN_CHANGED);
    // what lands is read from the whole settings file, never the jobs' span (final-2b B2-1): the decoy
    // is refused as a job change, and for its second block
    const dc = T.dry('decoy');
    refused(dc, MAIN_CHANGED);
    assert.match(dc.text, /settings\.md has 2 json devteam blocks: the kit reads only the first, so keep exactly one/);
    const rd = T.run(['check-pr', '--head-ref', 'ticket/api-02-decoy', '--sha', dsha, '--title', 'x']);
    refused({ status: rd.status, text: T.text(rd) }, MAIN_CHANGED);
    // validate refuses a second block too
    fs.writeFileSync(T.settingsFile, decoy(fs.readFileSync(T.settingsFile, 'utf8')));
    const v = T.run(['validate']);
    refused({ status: v.status, text: T.text(v) }, /settings\.md has 2 json devteam blocks: the kit reads only the first, so keep exactly one/);
    T.g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], T.old);
  } finally { T.done(); }
});

test('A4c: text tricks beside the jobs, on a chore cut before a stop: none lands a job change without an answer', () => {
  // final-2 F2: git's merge must put main's change where the kit reads it, or the PR is refused
  const T = setup('tricks');
  const SET = 'docs/devteam/project/settings.md';
  const raw = (wt, fn) => { const f = path.join(wt, SET); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); };
  const recText = (body) => { const i = body.indexOf('  "recurring": {'); let d = 0, k = body.indexOf('{', i); for (; k < body.length; k++) { if (body[k] === '{') d++; else if (body[k] === '}') { d--; if (!d) break; } } return body.slice(i, k + 1); };
  // what git's merge of the branch onto main lands: { conflict, jobs }
  const merged = (branch) => {
    T.g(['fetch', '-q', 'origin'], T.old);
    let out;
    try { out = execFileSync('git', ['merge-tree', '--write-tree', 'origin/main', `origin/${branch}`], { cwd: T.old, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch { return { conflict: true, jobs: null }; }
    const j = JSON.parse(BLOCK.exec(T.g(['show', `${out.split('\n')[0].trim()}:${SET}`], T.old))[1]);
    return { conflict: false, jobs: j.recurring === undefined ? {} : j.recurring };
  };
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job', every: '6h' }), bb: check({ title: 'B job', every: '12h', run: 'echo bb' }), cc: chore({ title: 'C job', prompt: 'C.' }), dd: check({ title: 'D job', every: '8h', run: 'echo dd' }), ee: chore({ title: 'E job', every: '2w', prompt: 'E.' }) }; });
    const V = {
      dupblockbefore: (wt) => raw(wt, (t) => { const m = BLOCK.exec(t); return t.slice(0, m.index) + m[0] + '\n\n' + t.slice(m.index); }),
      moveblockfirst: (wt) => T.edit((j) => { const { recurring, ...rest } = j; for (const k of Object.keys(j)) delete j[k]; Object.assign(j, { recurring, ...rest }); }, wt),
      copykeyafter: (wt) => raw(wt, (t) => { const r = recText(BLOCK.exec(t)[1]); return t.replace(r, () => `${r},\n${r.replace('"recurring"', '"zz_copy"')}`); }),
      copykeybefore: (wt) => raw(wt, (t) => { const r = recText(BLOCK.exec(t)[1]); return t.replace(r, () => `${r.replace('"recurring"', '"zz_copy"')},\n${r}`); }),
      keybefore: (wt) => raw(wt, (t) => t.replace('  "recurring": {', '  "zz_note": "x",\n  "recurring": {')),
      keyafter: (wt) => raw(wt, (t) => { const r = recText(BLOCK.exec(t)[1]); return t.replace(r, () => `${r},\n  "zz_note": "x"`); }),
      prosejobsbefore: (wt) => raw(wt, (t) => { const m = BLOCK.exec(t); return t.slice(0, m.index) + recText(m[1]) + '\n\n' + t.slice(m.index); }),
      // final-2b B2-1's decoy (a copy above, its fence with a trailing space), and a one-block form
      // of it (a copy above, the original's fence made a plain one)
      decoy: (wt) => raw(wt, (t) => { const m = BLOCK.exec(t); return `${m[0].replace('```json devteam', '```json devteam ')}\n\n${t}`; }),
      demote: (wt) => raw(wt, (t) => { const m = BLOCK.exec(t); return `${m[0]}\n\n${t.replace('```json devteam', '```json')}`; }),
    };
    for (const [n, fn] of Object.entries(V)) T.choreBranch(`t-${n}`, fn);
    const stop = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-bb', (j) => { delete j.recurring.bb; });
    passes(T.merge('stop-bb', ['--approved', stop]));
    const now = T.mainSettings().recurring;
    const bad = [];
    const dry = {};
    for (const n of Object.keys(V)) {
      const d = (dry[n] = T.dry(`t-${n}`));
      const m = merged(`chore-t-${n}`);
      if (d.status === 0 && !m.conflict && canon(m.jobs) !== canon(now)) bad.push(n);
    }
    assert.deepEqual(bad, [], 'a no-answer chore lands a job change');
    for (const n of Object.keys(V)) refused(dry[n], MAIN_CHANGED);
    for (const n of ['dupblockbefore', 'decoy']) refused(dry[n], /settings\.md has 2 json devteam blocks: the kit reads only the first, so keep exactly one/);
  } finally { T.done(); }
});

// git's own merge, for the tests that compare the kit's verdict with what lands (final-3b, final-3)
const SETP = 'docs/devteam/project/settings.md';
const rawEdit = (wt, fn) => { const f = path.join(wt, SETP); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); };
const gx = (T, args, input) => execFileSync('git', args, { cwd: T.old, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 });
// what merge-ort (git merge, merge-tree, the forge) lands for ref onto origin/main: { conflict, jobs }
const gitLands = (T, ref) => {
  T.g(['fetch', '-q', 'origin'], T.old);
  let out;
  try { out = gx(T, ['merge-tree', '--write-tree', '--no-messages', 'origin/main', ref]); } catch { return { conflict: true, jobs: null }; }
  const j = JSON.parse(BLOCK.exec(gx(T, ['show', `${out.split('\n')[0].trim()}:${SETP}`]))[1]);
  return { conflict: false, jobs: j.recurring === undefined ? {} : j.recurring };
};
// a ticket branch off origin/main whose worktree fn edits; returns its head
const ticketBranch = (T, id, fn) => {
  T.ok(['ticket', 'add', id, '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['its suite passes in CI'], notes: 'n' })]);
  T.g(['fetch', '-q', 'origin'], T.old);
  const wt = path.join(T.base, `ticket-${id}`);
  T.g(['worktree', 'add', '-q', '-b', `ticket/${id}`, wt, 'origin/main'], T.old);
  fn(wt);
  T.g(['commit', '-qam', 'x'], wt);
  T.g(['push', '-q', 'origin', `ticket/${id}`], wt);
  return T.g(['rev-parse', 'HEAD'], wt);
};
// six jobs, and a search over reorders of them (job order and field order) against a stop of one:
// the first reorder for which keep(merge-file clean, merge-tree result) holds, from a fixed seed
const SIX = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff'];
const sixJobs = () => Object.fromEntries(SIX.map((n, i) => [n, i % 2 ? chore({ title: `${n} job`, prompt: `Do ${n}.`, every: ['1d', '1w', '2w'][i % 3] }) : check({ title: `${n} job`, run: `echo ${n}`, every: ['6h', '12h', '1d'][i % 3] })]));
function findReorder(T, keep) {
  const jobs = sixJobs();
  let seed = 5;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const baseText = fs.readFileSync(path.join(T.old, SETP), 'utf8');
  const withJobs = (rec) => { const m = BLOCK.exec(baseText); const j = JSON.parse(m[1]); j.recurring = rec; return baseText.replace(m[1], () => JSON.stringify(j, null, 2)); };
  const commit = (text, parent) => { const b = gx(T, ['hash-object', '-w', '--stdin'], text).trim(); const t = gx(T, ['mktree'], `100644 blob ${b}\tx.md\n`).trim(); return gx(T, ['commit-tree', t, ...(parent ? ['-p', parent] : []), '-m', 'x']).trim(); };
  const tmp = fs.mkdtempSync(path.join(T.base, 'mf-'));
  for (let c = 0; c < 4000; c++) {
    const stop = SIX[Math.floor(rnd() * SIX.length)];
    const mainRec = Object.fromEntries(SIX.filter((n) => n !== stop).map((n) => [n, jobs[n]]));
    const headRec = Object.fromEntries(shuffle(SIX).map((n) => [n, Object.fromEntries(shuffle(Object.keys(jobs[n])).map((k) => [k, jobs[n][k]]))]));
    const [b, m, h] = [baseText, withJobs(mainRec), withJobs(headRec)];
    for (const [f, t] of [['b', b], ['m', m], ['h', h]]) fs.writeFileSync(path.join(tmp, f), t);
    let mfClean = true;
    try { gx(T, ['merge-file', '-p', path.join(tmp, 'h'), path.join(tmp, 'b'), path.join(tmp, 'm')]); } catch { mfClean = false; }
    const cb = commit(b);
    let lands;
    try { lands = JSON.parse(BLOCK.exec(gx(T, ['show', `${gx(T, ['merge-tree', '--write-tree', '--no-messages', commit(m, cb), commit(h, cb)]).split('\n')[0].trim()}:x.md`]))[1]).recurring; } catch { lands = null; }
    if (keep(mfClean, lands, stop)) return { stop, headRec };
  }
  return null;
}

test('A4d: both sides changed: refused, with no merge predicted, on any git (RVHIST)', () => {
  // final-3b B3-1 (RVHIST): merge-file diffs with Myers, git's merge (merge-ort) with histogram. For
  // a reorder-only chore cut before a stop, merge-file conflicts while git's merge is clean and
  // brings the stopped job back. The kit predicts neither: main changed the file and the branch
  // touches it, so it is refused, and an old git is never asked for merge-tree or a merge.
  const T = setup('hist');
  try {
    T.onMain((j) => { j.recurring = sixJobs(); });
    const found = findReorder(T, (mfClean, lands, stop) => !mfClean && lands && Object.hasOwn(lands, stop));
    assert.ok(found, 'a reorder where merge-file conflicts and git lands the stopped job');
    T.jobsChore('reorder', (j) => { j.recurring = found.headRec; });
    const tsha = ticketBranch(T, 'api-01-x', (wt) => T.edit((j) => { j.recurring = found.headRec; }, wt));
    const q = T.yes({ recurring: { [found.stop]: null } });
    T.jobsChore('stop', (j) => { delete j.recurring[found.stop]; });
    passes(T.merge('stop', ['--approved', q]));
    assert.equal(Object.hasOwn(T.mainSettings().recurring, found.stop), false);
    assert.equal(Object.hasOwn(gitLands(T, 'origin/chore-reorder').jobs, found.stop), true, 'git\'s merge brings it back');
    // the chore and the ticket: refused until main is merged in
    refused(T.dry('reorder'), MAIN_CHANGED);
    const tr = T.run(['check-pr', '--head-ref', 'ticket/api-01-x', '--sha', tsha, '--title', 'x']);
    refused({ status: tr.status, text: T.text(tr) }, MAIN_CHANGED);
    // a git without merge-tree --write-tree: the same, with no merge-tree, no merge and no worktree
    const oldGit = gitShim(T, 'old');
    const od = T.run(['merge', '--chore', 'reorder', '--dry-run'], { ...SUP, ...oldGit.env });
    refused({ status: od.status, text: T.text(od) }, MAIN_CHANGED);
    assert.doesNotMatch(oldGit.calls(), /^(merge-tree|merge --no-ff --no-commit)/m, 'no merge is predicted');
    assert.doesNotMatch(T.g(['worktree', 'list', '--porcelain'], T.old), /devteam-landing-/, 'no throwaway worktree');
    const ot = T.run(['check-pr', '--head-ref', 'ticket/api-01-x', '--sha', tsha, '--title', 'x'], { ...SUP, ...oldGit.env });
    refused({ status: ot.status, text: T.text(ot) }, MAIN_CHANGED);
  } finally { T.done(); }
});

test('A4e: a merge git can\'t make lands nothing: merge --chore stops, and main\'s settings.md is as it was', () => {
  // both sides changed settings.md and git's merge conflicts: whatever the kit's checks say, the
  // landing merge itself fails, so no path puts the branch's text on main
  const T = setup('conflict');
  try {
    T.onMain((j) => { j.recurring = sixJobs(); });
    const found = findReorder(T, (mfClean, lands) => lands === null);
    assert.ok(found, 'a reorder git can\'t merge with the stop');
    T.jobsChore('conflicts', (j) => { j.recurring = found.headRec; });
    const q = T.yes({ recurring: { [found.stop]: null } });
    T.jobsChore('stop', (j) => { delete j.recurring[found.stop]; });
    passes(T.merge('stop', ['--approved', q]));
    assert.equal(gitLands(T, 'origin/chore-conflicts').conflict, true, 'git\'s merge conflicts');
    const before = T.g(['rev-parse', 'origin/main'], T.old);
    const blob = T.g(['rev-parse', `origin/main:${SETP}`], T.old);
    const r = T.merge('conflicts');
    refused(r, MAIN_CHANGED);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['rev-parse', `origin/main:${SETP}`], T.old), blob, 'main\'s settings.md is unchanged');
    assert.equal(T.g(['rev-parse', 'origin/main'], T.old), before, 'main did not move');
  } finally { T.done(); }
});

test('A4f: a copy of the block\'s body that merge-file and git\'s merge align differently (final-3 F1, RV3-DIVERGE)', () => {
  const T = setup('diverge');
  try {
    T.lines(T.STD);
    const five = { aa: check({ title: 'A job', every: '6h' }), bb: check({ title: 'B job', every: '12h', run: 'echo bb' }), cc: chore({ title: 'C job', prompt: 'C.' }), dd: check({ title: 'D job', every: '8h', run: 'echo dd' }), ee: chore({ title: 'E job', every: '2w', prompt: 'E.' }) };
    T.onMain((j) => { j.recurring = five; });
    // one block the kit reads (fence with a trailing space, closed by ````), and a plain ```json copy
    // of its body placed by where
    const shape = (where) => (t) => {
      const m = BLOCK.exec(t);
      const read = `\`\`\`json devteam \n${m[1]}\n\`\`\`\``;
      const copy = `\`\`\`json\n${m[1]}\n\`\`\``;
      const before = t.slice(0, m.index);
      const after = t.slice(m.index + m[0].length);
      if (where === 'top') return `${copy}\n\n${before}${read}${after}`;
      if (where === 'line1') { const i = t.indexOf('\n'); return `${before.slice(0, i + 1)}\n${copy}\n${before.slice(i + 1)}${read}${after}`; }
      const k = after.indexOf('\n\n', 2);
      return `${before}${read}${after.slice(0, k)}\n\n${copy}${after.slice(k)}`;
    };
    const W = ['top', 'line1', 'below'];
    for (const w of W) T.choreBranch(`dv-${w}`, (wt) => rawEdit(wt, shape(w)));
    const tsha = ticketBranch(T, 'api-01-x', (wt) => rawEdit(wt, shape('top')));
    const stop = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-bb', (j) => { delete j.recurring.bb; });
    passes(T.merge('stop-bb', ['--approved', stop]));
    const now = T.mainSettings().recurring;
    const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
    const bad = [];
    for (const w of W) {
      const d = T.dry(`dv-${w}`);
      const m = gitLands(T, `origin/chore-dv-${w}`);
      if (d.status === 0 && !m.conflict && canon(m.jobs) !== canon(now)) bad.push(w);
    }
    assert.deepEqual(bad, [], 'a no-answer chore lands a job change');
    assert.equal(Object.hasOwn(gitLands(T, 'origin/chore-dv-top').jobs, 'bb'), true, 'git\'s merge of the top copy brings bb back');
    const tr = T.run(['check-pr', '--head-ref', 'ticket/api-01-x', '--sha', tsha, '--title', 'x']);
    refused({ status: tr.status, text: T.text(tr) }, MAIN_CHANGED);
    for (const w of W) refused(T.dry(`dv-${w}`), MAIN_CHANGED);
  } finally { T.done(); }
});

test('A4g: a .gitattributes that sets a merge driver or a filter for settings.md is refused, at main or at the head; text and eol pass (final-3 F2, RV3-UNION)', () => {
  const T = setup('union');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job', every: '6h' }), bb: check({ title: 'B job', every: '12h', run: 'echo bb' }), cc: chore({ title: 'C job', prompt: 'C.' }) }; });
    // cut before the stop: only bb's opening line re-indented (canonically no change)
    T.choreBranch('reindent', (wt) => rawEdit(wt, (t) => t.replace('\n    "bb": {\n', '\n      "bb": {\n')));
    const stop = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-bb', (j) => { delete j.recurring.bb; });
    passes(T.merge('stop-bb', ['--approved', stop]));
    const ATTR = /\.gitattributes sets merge for docs\/devteam\/project\/settings\.md: the jobs must merge as plain text; remove it/;
    // at the head: the supervisor's own project/ chore adding the attribute is refused
    T.choreBranch('attrs', (wt) => write(path.join(wt, 'docs/devteam/project/.gitattributes'), 'settings.md merge=union\n'));
    refused(T.merge('attrs'), ATTR);
    // a filter is refused too
    T.choreBranch('filter', (wt) => write(path.join(wt, 'docs/devteam/project/.gitattributes'), 'settings.md filter=jobs\n'));
    refused(T.dry('filter'), /\.gitattributes sets filter for docs\/devteam\/project\/settings\.md: the jobs must merge as plain text; remove it/);
    // a repo-wide text=auto and eol=lf on main (pushed by hand) only normalise line endings: they pass
    T.g(['fetch', '-q', 'origin'], T.old);
    T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    write(path.join(T.old, '.gitattributes'), '* text=auto\n* eol=lf\n');
    T.g(['add', '.gitattributes'], T.old);
    T.g(['commit', '-qm', 'line endings by hand'], T.old);
    T.g(['push', '-q', 'origin', 'main'], T.old);
    T.choreBranch('notes', (wt) => write(path.join(wt, 'docs/devteam/project/notes.md'), 'n\n'));
    passes(T.dry('notes'));
    const ok = T.run(['validate']);
    assert.doesNotMatch(T.text(ok), /\.gitattributes/);
    // at main (pushed by hand): git's merge honours main's merge=union, keeping both sides' lines,
    // so the stale re-indent brings bb back; the kit refuses every PR while main has it
    write(path.join(T.old, 'docs/devteam/project/.gitattributes'), 'settings.md merge=union\n');
    T.g(['add', 'docs/devteam/project/.gitattributes'], T.old);
    T.g(['commit', '-qm', 'attrs by hand'], T.old);
    T.g(['push', '-q', 'origin', 'main'], T.old);
    assert.equal(Object.hasOwn(gitLands(T, 'origin/chore-reindent').jobs, 'bb'), true, 'git\'s union merge brings bb back');
    refused(T.dry('reindent'), ATTR);
    const v = T.run(['validate']);
    refused({ status: v.status, text: T.text(v) }, ATTR);
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
      const r = T.run(['ask', '--class', cls, '--question', { 'governance-edit': 'Should I change how the project is governed?', 'new-feature': 'Should I start a new feature?' }[cls], '--recommendation', 'Yes', ...(cls === 'new-feature' ? ['--no-default', 'only the owner starts one'] : [])]);
      passes({ status: r.status, text: T.text(r) });
      const q = QID.exec(r.out)[0];
      T.answer(q);
      refused(T.dry('add', q), /recurring-edit/);
    }
    // a question whose change is rewritten after the owner answered it: its own line edited in place
    // (no writer may set question.change or question.question, so a set line would be dropped unread)
    const rewrite = (fields) => {
      const q = T.yes({ recurring: { 'ci-main': check() } });
      const f = T.logFile('supervisor');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').map((l) => { const o = l ? JSON.parse(l) : null; return o?.type === 'question' && o.op === 'new' && o.id === q ? JSON.stringify({ ...o, ...fields }) : l; }).join('\n'));
      refused(T.dry('add', q), /not a question the owner answered/);
      T.run(['withdraw', q, '--reason', 'test']);
    };
    rewrite({ change: { recurring: { 'ci-main': check({ every: '12h' }) } } });
    rewrite({ question: 'Should I add a job that runs every hour?' });
    // answered in words, then asked again about the same job, then the first's words read as Yes: superseded
    const first = T.asked({ recurring: { 'ci-main': check() } });
    T.ok(['answer', first, 'maybe, let me think', '--in-words'], {});
    T.asked({ recurring: { 'ci-main': check({ every: '12h' }) } });
    T.ok(['answer', first, '--read', 'Yes', '--cite', 'maybe', '--class', 'recurring-edit']);
    refused(T.dry('add', first), /superseded/);
    // a secrets question of the class (ask refuses one; written here by hand) answered "Posted": no Yes, so it approves nothing
    const sq = 'q-20990101-000000001-supervisor';
    fs.appendFileSync(T.logFile('supervisor'), `${JSON.stringify({ v: 1, type: 'question', op: 'new', id: sq, at: new Date().toISOString(), by: 'supervisor', kind: 'owner-action', class: 'recurring-edit', question: 'Post the key for the job?', recommendation: 'Yes', secrets: [{ name: 'API_KEY', sink: 'rails-credentials:test:api.key' }], change: { recurring: { 'ci-main': check() } } })}\n`);
    T.ok(['answer', sq, 'Posted 1 secret'], {});
    refused(T.dry('add', sq), /can't approve a job change: answered/);
    T.ok(['chore', 'start', 'recurring']);
    refused(T.run(['recurring', 'apply', sq]), /can't approve|Yes/);
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
    // no recurring key at all reads as no jobs, as validate reads it (task-2 F2)
    T.jobsChore('drop-key', (j) => { delete j.recurring; });
    passes(T.dry('drop-key', q));
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
      // a chore of another slug that changes the jobs is held too
      T.jobsChore('jobs-other', (j) => { j.recurring['tidy'] = chore(); });
      const q2 = T.yes({ recurring: { tidy: chore() } });
      refused(T.dry('jobs-other', q2), /Upkeep|goal is/);
      // a record-keeping slug that changes the jobs is held too
      T.jobsChore('fleet-handoff', (j) => { j.recurring['tidy'] = chore(); });
      refused(T.dry('fleet-handoff', q2), /Upkeep|goal is/);
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
    assert.ok(q.context.includes('A check only looks: it never changes production') && q.context.includes('as it is on main each time'), q.context);
    passes(T.ask({ recurring: { tidy: null } }));
    refused(T.ask({ recurring: { xx: check() }, gates: {} }), /only "recurring"/);
    refused(T.ask({ recurring: { xx: check({ every: '30m' }) } }), /recurring\.xx\.every/);
    refused(T.ask({ recurring: { ghost: null } }), /no such job/);
    refused(T.ask({ recurring: { 'ci-main': check({ every: '12h' }) } }), new RegExp(`${add.qid}`));
    T.answer(add.qid);
    refused(T.ask({ recurring: { 'ci-main': check({ every: '12h' }) } }), /not landed/);
    refused(T.ask(undefined), /--change/);
    refused(T.ask({ recurring: { tidy: chore() } }), /already has exactly this/);
    refused(T.run(['ask', '--class', 'recurring-edit', '--question', 'Add it?', '--recommendation', 'Later', '--change', JSON.stringify({ recurring: { z1: chore() } })]), /Yes/);
    refused(T.ask({ recurring: { z1: chore() } }, ['--choices', '[{"label":"Yes"},{"label":"No"}]']), /the kit writes its choices/);
    refused(T.ask({ recurring: { z2: chore() } }, ['--kind', 'owner-action', '--secrets', '[{"name":"API_KEY","sink":"rails-credentials:test:api.key"}]']), /a plain yes or no: --kind owner-decision and no --secrets/);
    refused(T.ask({ recurring: { z3: chore() } }, ['--context', `${HEADER}\nrecurring.z3: add {}`]), /may not hold a job approval line/);
    // a look-alike line with a space before its colon, and no header (task-1 F4)
    refused(T.ask({ recurring: { z4: chore() } }, ['--context', 'recurring.xx : add {}']), /may not hold a job approval line/);
    // the cap: main at 90 with hourly x (24); an open stop of x; then an hourly y is refused
    const filler = Object.fromEntries(Array.from({ length: 66 }, (_, i) => [`daily-${i + 1}`, chore({ every: '1d' })]));
    T.onMain((j) => { j.recurring = { ...filler, xx: check({ every: '1h' }) }; });
    passes(T.ask({ recurring: { xx: null } }));
    refused(T.ask({ recurring: { yy: check({ every: '1h' }) } }), /cap of 100/);
    passes(T.ask({ recurring: { yy: check({ every: '1d' }) } }));
    // a pending addition counts: main at 60, an open hourly z, then an hourly y is refused until z is withdrawn
    const sixty = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`d-${i + 1}`, chore({ every: '1d' })]));
    T.onMain((j) => { j.recurring = sixty; });
    const z = T.asked({ recurring: { zz: check({ every: '1h' }) } });
    refused(T.ask({ recurring: { ww: check({ every: '1h' }) } }), /cap of 100/);
    T.ok(['withdraw', z, '--reason', 'test']);
    const w = T.ask({ recurring: { ww: check({ every: '1h' }) } });
    passes(w);
    // an answered Yes not landed yet still counts (89 here)
    T.answer(w.qid);
    refused(T.ask({ recurring: { vv: check({ every: '1h' }) } }), /cap of 100/);
    // a No frees its room: 89 + 8 fits, and once declined, another 8 fits too
    const p1 = T.asked({ recurring: { p1: check({ every: '3h' }) } });
    T.answer(p1, 'No');
    // the declined change is not asked again unless something changed (task-1 F1); withdrawn after, so the room stays as it was
    const again = T.ask({ recurring: { p1: check({ every: '3h' }) } });
    refused(again, /already asked exactly this change/);
    assert.match(again.text, new RegExp(p1));
    const because = T.ask({ recurring: { p1: check({ every: '3h' }) } }, ['--new-because', 'the deploys now run every three hours']);
    passes(because);
    T.ok(['withdraw', because.qid, '--reason', 'test']);
    const p2 = T.ask({ recurring: { p2: check({ every: '3h' }) } });
    passes(p2);
    // words not read yet keep counting: p2 answered in words still holds its 8 (97), so another 8 is refused
    T.ok(['answer', p2.qid, 'hmm, not sure', '--in-words'], {});
    refused(T.ask({ recurring: { p3: check({ every: '3h' }) } }), /cap of 100/);
    // main over the cap (a hand edit): a stop adds no runs, so the cap never refuses it (task-1 F3)
    T.onMain((j) => { j.recurring = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`hourly-${i + 1}`, check({ every: '1h' })])); });
    passes(T.ask({ recurring: { 'hourly-1': null } }));
  } finally { T.done(); }
});

test('A9b: only the supervisor asks a recurring-edit question or applies one: a worker, a planner and the responder are refused', () => {
  const T = setup('roles');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    const roles = { worker: { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'api-01-x' }, planner: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'chores' }, responder: { DEVTEAM_ROLE: 'responder' } };
    // final-1b B3: each is refused by the kit's role check, before anything is asked or written
    const before = T.g(['status', '--porcelain'], T.old);
    for (const [who, role] of Object.entries(roles)) {
      const a = T.run(['ask', '--class', 'recurring-edit', '--question', 'Should I add bb?', '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { bb: check() } })], role);
      refused(a, /^devteam: ask: the supervisor does this/m);
      const p = T.run(['recurring', 'apply', q], role);
      refused(p, /^devteam: recurring apply: the supervisor does this/m);
      assert.equal(T.g(['status', '--porcelain'], T.old), before, `${who}: nothing written`);
    }
    assert.equal(T.ask({ recurring: { bb: check() } }).status, 0, 'the supervisor asks it');
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

test("A10b: merge refuses a recurring-edit answer cited for a ticket whose code lands in a linked repo", () => {
  // the binding reads home's settings, which a linked repo's ticket never changes (task-2 F3)
  const F = multiFixture('recur-linked');
  const { old, g } = F;
  try {
    F.ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'src/main.js'), 'changed\n');
    g(['commit', '-qam', 'console-01-a: x'], w);
    g(['push', '-q', 'origin', 'ticket/console-01-a'], w);
    write(path.join(old, 'docs/devteam/run/pr/ticket/console-01-a.md'), '# console-01-a: x\n\n## One-way doors\n\nNone.\n');
    const a = F.runIn(old, ['ask', '--class', 'recurring-edit', '--question', 'Should I add this job?', '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { 'ci-main': check() } })], SUP);
    assert.equal(a.status, 0, a.err);
    const q = QID.exec(a.out)[0];
    F.okIn(old, ['answer', q, 'Yes']);
    const r = F.runIn(old, ['merge', 'console-01-a', '--dry-run', '--approved', q], SUP);
    refused({ status: r.status, text: `${r.out}\n${r.err}` }, new RegExp(`${q} approves job changes in this repo's settings: land it in a chore PR here`));
  } finally { if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(F.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
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

test('A11b: a settings block with a key twice in one object is refused by validate and at landing', () => {
  // JSON.parse keeps the last of two equal keys, so a hidden first one reads as nothing while git
  // merges its text (task-2-r2 F1-1)
  const T = setup('dup-keys');
  try {
    const evil = JSON.stringify(check({ every: '1h', run: 'gh run list --limit 9' }));
    const hide = (text, name) => text.replace(/"recurring": \{\n/, `"recurring": {\n    "${name}": ${evil},\n`);
    T.onMain((j) => { j.recurring = { mm: check() }; });
    // a chore whose head adds aa visibly, with a second aa above it that the parse hides
    const wt = T.choreBranch('dup', (w) => {
      T.edit((j) => { j.recurring.aa = check(); }, w);
      const f = path.join(w, 'docs/devteam/project/settings.md');
      fs.writeFileSync(f, hide(fs.readFileSync(f, 'utf8'), 'aa'));
    });
    assert.match(fs.readFileSync(path.join(wt, 'docs/devteam/project/settings.md'), 'utf8'), /"aa": \{"kind"/);
    const q = T.yes({ recurring: { aa: check() } });
    refused(T.dry('dup', q), /settings: "aa" appears twice in one object \(recurring\.aa\): JSON keeps only the last/);
    // main itself with zz twice: validate refuses it
    fs.writeFileSync(T.settingsFile, hide(fs.readFileSync(T.settingsFile, 'utf8').replace(/"recurring": \{\n/, `"recurring": {\n    "zz": ${JSON.stringify(check())},\n`), 'zz'));
    T.g(['commit', '-qam', 'main hides a job'], T.old);
    T.g(['push', '-q', 'origin', 'main'], T.old);
    const v = T.run(['validate']);
    refused({ status: v.status, text: T.text(v) }, /settings: "zz" appears twice in one object \(recurring\.zz\)/);
  } finally { T.done(); }
});

test('A12: recurring apply writes exactly the answered change and leaves every other byte alone', () => {
  const T = setup('apply');
  try {
    // main's block in a form JSON.stringify never writes: compact, odd spacing, a key after recurring
    const compact = (jobs) => (txt) => txt.replace(BLOCK, (m, body) => {
      const o = JSON.parse(body);
      delete o.recurring;
      const keys = Object.keys(o);
      const head = keys.slice(0, -1).map((k) => `"${k}" :${JSON.stringify(o[k])}`).join(',\n ');
      const last = keys.at(-1);
      return `\`\`\`json devteam\n{ ${head},\n${jobs === undefined ? '' : `   "recurring":${JSON.stringify(jobs)} ,\n`}  "${last}":   ${JSON.stringify(o[last])}\n}\n\`\`\``;
    });
    const toMain = (fn) => { fs.writeFileSync(T.settingsFile, fn(fs.readFileSync(T.settingsFile, 'utf8'))); T.g(['commit', '-qam', 'main block'], T.old); T.g(['push', '-q', 'origin', 'main'], T.old); T.g(['fetch', '-q', 'origin'], T.old); };
    const wt = path.join(T.old, '.worktrees/chore-recurring');
    const wtFile = path.join(wt, 'docs/devteam/project/settings.md');
    const apply = (q) => T.run(['recurring', 'apply', q]);
    // the text around the recurring value: before the key, and after the value's closing bracket
    const around = (t) => { const i = t.indexOf('"recurring"'); let d = 0; let j = t.indexOf('{', i); for (let k = j; k < t.length; k++) { if (t[k] === '{') d++; else if (t[k] === '}' && --d === 0) { j = k; break; } } return [t.slice(0, i), t.slice(j + 1)]; };
    const others = (t) => { const o = JSON.parse(BLOCK.exec(t)[1]); delete o.recurring; return o; };
    toMain(compact({ aa: check(), bb: chore() }));
    const change = { recurring: { aa: check({ every: '12h' }), cc: chore({ every: '2w' }) } };
    const open = T.asked(change);
    T.ok(['chore', 'start', 'recurring']);
    const before = fs.readFileSync(wtFile, 'utf8');
    refused(apply(open), /answered/);
    T.answer(open);
    passes(apply(open));
    const after = fs.readFileSync(wtFile, 'utf8');
    assert.deepEqual(T.blockAt(wtFile).recurring, { aa: check({ every: '12h' }), bb: chore(), cc: chore({ every: '2w' }) });
    assert.deepEqual(around(after), around(before));
    assert.deepEqual(others(after), others(before));
    // the worktree's jobs now differ from main's: a second answer can't be applied on top
    const second = T.yes({ recurring: { dd: chore() } });
    refused(apply(second), /differs from main/);
    // landed: the PR merges, and the answer applies no more
    T.ok(['chore', 'pr', 'recurring', '--title', 'jobs']);
    write(path.join(T.old, 'docs/devteam/run/pr/chore-recurring.md'), '# chore-recurring: jobs\n\n## One-way doors\n\nNone.\n');
    passes(T.merge('recurring', ['--approved', open]));
    T.g(['worktree', 'remove', '--force', wt], T.old);
    T.g(['branch', '-D', 'chore-recurring'], T.old);
    T.ok(['chore', 'start', 'recurring']);
    refused(apply(open), /already landed/);
    // once landed, the question no longer blocks its jobs: a is asked about again
    T.asked({ recurring: { aa: check({ every: '24h' }) } });
    // declined, and another class
    const no = T.asked({ recurring: { ee: chore() } });
    T.answer(no, 'No');
    refused(apply(no));
    const gr = T.run(['ask', '--class', 'governance-edit', '--question', 'Something else?', '--recommendation', 'Yes']);
    const gq = QID.exec(gr.out)[0];
    T.answer(gq);
    refused(apply(gq), /recurring-edit/);
    // no recurring key on main: apply inserts it and changes nothing else
    T.g(['worktree', 'remove', '--force', wt], T.old);
    T.g(['branch', '-D', 'chore-recurring'], T.old);
    T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    toMain(compact(undefined));
    T.ok(['chore', 'start', 'recurring']);
    const bare = fs.readFileSync(wtFile, 'utf8');
    assert.ok(!bare.includes('"recurring"'), bare);
    const add = T.yes({ recurring: { ff: chore() } });
    passes(apply(add));
    const added = fs.readFileSync(wtFile, 'utf8');
    assert.deepEqual(T.blockAt(wtFile).recurring, { ff: chore() });
    assert.deepEqual(others(added), others(bare));
    assert.equal(added.replace(/,?\s*"recurring":[\s\S]*?\n  \}/, ''), bare);
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

test('A13b: a settings.md with CRLF line endings reads as the same jobs, and validate says the same, as with LF', () => {
  const T = setup('crlf');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job', every: '6h' }), bb: chore({ title: 'B job', prompt: 'B.' }) }; });
    const read = () => {
      const l = T.run(['recurring', 'list', '--json']);
      passes(l);
      const v = T.run(['validate']);
      // validate's verdict and its error and warning lines, the counts line included
      return { list: JSON.parse(l.out), validate: { status: v.status, lines: T.text(v).split('\n').filter((x) => /^(error|warning)|ticket\(s\)/.test(x)) } };
    };
    const lf = read();
    assert.deepEqual(lf.list.entries.map((e) => e.name), ['aa', 'bb']);
    const text = fs.readFileSync(T.settingsFile, 'utf8');
    assert.doesNotMatch(text, /\r/);
    fs.writeFileSync(T.settingsFile, text.replace(/\n/g, '\r\n'));
    T.g(['commit', '-qam', 'settings.md with CRLF'], T.old);
    T.g(['push', '-q', 'origin', 'main'], T.old);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.match(T.g(['show', `origin/main:${SETP}`], T.old), /\r\n/, 'main has CRLF');
    const crlf = read();
    assert.deepEqual(crlf.list, lf.list);
    assert.deepEqual(crlf.validate, lf.validate);
  } finally { T.done(); }
});

test('A14: supervisor.md documents registering, changing and stopping a job, and that none writes to production', () => {
  const doc = fs.readFileSync(path.join(kit, 'process/supervisor.md'), 'utf8');
  const at = (re) => doc.search(re);
  const s = at(/^## Recurring jobs$/m);
  assert.ok(s > at(/^## 3\. /m) && s < at(/^## 4\. /m), 'a level-2 section between §3 and §4');
  const end = doc.indexOf('\n## ', s + 1);
  const section = doc.slice(s, end);
  for (const w of ['only looks', 'recurring-edit', 'thread ask', 'answer', '--from-turn', 'answer <qid> "Yes" --from-turn', 'recurring apply', 'chore start recurring', 'merge --chore recurring --approved', 'null', 'recurring propose', '--stop', 'production']) assert.ok(section.includes(w), `the section says ${w}`);
  const mon = doc.slice(at(/^### Monitoring$/m), at(/^## Recurring jobs$/m));
  assert.match(mon, /Recurring jobs/);
  const five = doc.slice(at(/^## 5\. /m), at(/^## 6\. /m));
  assert.match(five, /Owner settings, in any PR[^\n]*recurring/);
  const q = fs.readFileSync(path.join(kit, 'governance/quality.md'), 'utf8');
  const four = q.slice(q.search(/^## 4\. /m), q.search(/^## 5\. /m));
  assert.match(four, /`recurring`[^\n]*recurring-edit/);
});

// ---- round 4 (ruling d-20261120-044235981): no merge of settings.md is predicted ----
const NOTES = 'docs/devteam/project/notes.md';
// main moves by hand with one file written
const onMainFile = (T, rel, text, msg) => {
  T.g(['fetch', '-q', 'origin'], T.old); T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
  write(path.join(T.old, rel), text); T.g(['add', rel], T.old); T.g(['commit', '-qm', msg], T.old); T.g(['push', '-q', 'origin', 'main'], T.old); T.g(['fetch', '-q', 'origin'], T.old);
};
const leftovers = (T) => T.g(['worktree', 'list', '--porcelain'], T.old).split('\n').filter((l) => /devteam-landing-/.test(l));
// commit what fn changes in a branch's worktree, and push it
const commitIn = (T, wt, branch, fn, msg) => { fn(wt); T.g(['add', '-A'], wt); T.g(['commit', '-q', '--allow-empty', '-m', msg], wt); T.g(['push', '-q', '-f', 'origin', branch], wt); };
// final-4 F1's setup: six jobs, notes.md on main, and a reorder git merges with a stop, bringing it back
const S4 = (T) => {
  T.onMain((j) => { j.recurring = sixJobs(); });
  onMainFile(T, NOTES, 'top\n\nshared middle\n\nbottom\n', 'notes');
  const found = findReorder(T, (mfClean, lands, stop) => lands && Object.hasOwn(lands, stop));
  assert.ok(found, 'a reorder git merges with the stop, bringing it back');
  return found;
};

test('RV4-STALE: a reorder chore cut before a stop, while a stale checkout reads another .gitattributes: refused, and the stop holds (final-4 F1)', () => {
  const T = setup('rv4stale');
  try {
    const found = S4(T);
    T.choreBranch('reorder', (wt) => { T.edit((j) => { j.recurring = found.headRec; }, wt); write(path.join(wt, NOTES), 'top from the branch\n\nshared middle\n\nbottom\n'); });
    const q = T.yes({ recurring: { [found.stop]: null } });
    T.jobsChore('stop', (j) => { delete j.recurring[found.stop]; });
    passes(T.merge('stop', ['--approved', q]));
    // the supervisor's own project/ chore: notes.md merges by union; the checkout stays behind main
    T.choreBranch('notes-union', (wt) => { write(path.join(wt, 'docs/devteam/project/.gitattributes'), 'notes.md merge=union\n'); write(path.join(wt, NOTES), 'top from main\n\nshared middle\n\nbottom\n'); });
    passes(T.merge('notes-union'));
    refused(T.dry('reorder'), MAIN_CHANGED);
    refused(T.merge('reorder'), MAIN_CHANGED);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(Object.hasOwn(T.mainSettings().recurring, found.stop), false, `${found.stop} came back with no answer`);
  } finally { T.done(); }
});

test('RV4-CWD: the same chore merged from its own worktree, whose .gitattributes says notes.md merge=binary: refused, and the stop holds (final-4 F1)', () => {
  const T = setup('rv4cwd');
  try {
    const found = S4(T);
    T.choreBranch('reorder', (wt) => { T.edit((j) => { j.recurring = found.headRec; }, wt); write(path.join(wt, NOTES), 'top from the branch\n\nshared middle\n\nbottom\n'); write(path.join(wt, 'docs/devteam/project/.gitattributes'), 'notes.md merge=binary\n'); });
    const q = T.yes({ recurring: { [found.stop]: null } });
    T.jobsChore('stop', (j) => { delete j.recurring[found.stop]; });
    passes(T.merge('stop', ['--approved', q]));
    T.choreBranch('notes', (wt) => write(path.join(wt, NOTES), 'top\n\nshared middle\n\nbottom from main\n'));
    passes(T.merge('notes'));
    T.g(['fetch', '-q', 'origin'], T.old);
    T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    const cw = path.join(T.old, '.worktrees', 'chore-reorder');
    refused(T.run(['merge', '--chore', 'reorder', '--dry-run'], SUP, cw), MAIN_CHANGED);
    refused(T.run(['merge', '--chore', 'reorder'], SUP, cw), MAIN_CHANGED);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(Object.hasOwn(T.mainSettings().recurring, found.stop), false, `${found.stop} came back with no answer`);
  } finally { T.done(); }
});

test('RV4-OLDCONFLICT: old git, a settings.md prose line beside another file that conflicts: refused before any merge, no worktree left (final-4b B4-3)', () => {
  const T = setup('rv4oc');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job', every: '6h' }), bb: check({ title: 'B job', every: '12h', run: 'echo bb' }), cc: chore({ title: 'C job', prompt: 'C.' }) }; });
    onMainFile(T, NOTES, 'one\n', 'notes');
    T.choreBranch('oc', (wt) => { rawEdit(wt, (t) => `${t}\nA prose line.\n`); write(path.join(wt, NOTES), 'branch\n'); });
    const q = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-bb', (j) => { delete j.recurring.bb; });
    passes(T.merge('stop-bb', ['--approved', q]));
    onMainFile(T, NOTES, 'main\n', 'notes on main');
    const oldGit = gitShim(T, 'old');
    const od = T.run(['merge', '--chore', 'oc', '--dry-run'], { ...SUP, ...oldGit.env });
    refused(od, MAIN_CHANGED);
    assert.doesNotMatch(oldGit.calls(), /^(merge-tree|merge --no-ff --no-commit)/m, 'no merge is predicted');
    refused(T.dry('oc'), MAIN_CHANGED);
    assert.deepEqual(leftovers(T), []);
  } finally { T.done(); }
});

test('RV4-REBASE: under merge_method rebase, a stop-then-restore branch, a merge commit beside a settings change and an unreadable middle commit are refused (final-4 F2, final-4b B4-1)', () => {
  const T = setup('rv4rb');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job', every: '6h' }), bb: check({ title: 'B job', every: '12h', run: 'echo bb' }), cc: chore({ title: 'C job', prompt: 'C.' }) }; });
    // cut before the stop: one commit stops bb (as main will), the next restores it, so the tip is
    // the base's; a rebase replays both onto main, and the restore brings bb back
    const fw = T.jobsChore('flip', (j) => { delete j.recurring.bb; });
    commitIn(T, fw, 'chore-flip', (wt) => T.g(['checkout', '-q', 'origin/main', '--', SETP], wt), 'bb back');
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['rev-parse', `origin/chore-flip:${SETP}`], T.old), T.g(['rev-parse', `origin/main:${SETP}`], T.old), 'the tip is the base\'s file');
    const q = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-bb', (j) => { delete j.recurring.bb; });
    passes(T.merge('stop-bb', ['--approved', q]));
    // under rebase no job change lands from a branch (d-20261120-075327162), so the stop lands first
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    T.onMain((j) => { j.merge_method = 'rebase'; }, 'rebase');
    refused(T.dry('flip'), REBASE_ALONE);
    // a prose line in settings.md, then main merged in (a merge commit the rebase would drop)
    const mw = T.choreBranch('mc', (wt) => rawEdit(wt, (t) => `${t}\nA prose line.\n`));
    onMainFile(T, NOTES, 'moved\n', 'main moves');
    T.g(['fetch', '-q', 'origin'], mw); T.g(['merge', '-q', '--no-ff', '--no-edit', 'origin/main'], mw); T.g(['push', '-q', 'origin', 'chore-mc'], mw);
    refused(T.dry('mc'), REBASE_ALONE);
    // a merge commit with no settings change beside it: a rebase drops every merge, so any merge
    // commit since main is refused (d-20261120-102757339); with none, the branch passes
    const nw = T.choreBranch('mc-notes', (wt) => write(path.join(wt, 'docs/devteam/project/other.md'), 'o\n'));
    passes(T.dry('mc-notes'));
    onMainFile(T, NOTES, 'moved again\n', 'main moves again');
    T.g(['fetch', '-q', 'origin'], nw); T.g(['merge', '-q', '--no-ff', '--no-edit', 'origin/main'], nw); T.g(['push', '-q', 'origin', 'chore-mc-notes'], nw);
    refused(T.dry('mc-notes'), REBASE_ALONE);
    // a middle commit whose block doesn't parse: a rebase lands it on main as it is
    const uw = T.choreBranch('mid', (wt) => rawEdit(wt, (t) => t.replace('  "recurring": {', '  "recurring": {{')));
    commitIn(T, uw, 'chore-mid', (wt) => rawEdit(wt, (t) => `${t.replace('  "recurring": {{', '  "recurring": {')}\nA prose line.\n`), 'fixed');
    refused(T.dry('mid'), REBASE_ALONE);
  } finally { T.done(); }
});

test('RV5-OURS: a chore cut before a stop merges main with -s ours, then main changes settings.md again: refused from blobs, and the stop holds (final-5b B5-1)', () => {
  const T = setup('rv5ours');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job', every: '6h' }), bb: check({ title: 'B job', every: '12h', run: 'echo bb' }), cc: chore({ title: 'C job', prompt: 'C.' }) }; });
    const w = T.choreBranch('sneak', (wt) => write(path.join(wt, NOTES), 'n\n'));
    const q = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-bb', (j) => { delete j.recurring.bb; });
    passes(T.merge('stop-bb', ['--approved', q]));
    // "merge main into the branch first", resolved as ours: settings.md stays the branch's (bb in it),
    // and the merge is TREESAME to the branch, so rev-list lists no commit touching the file
    T.g(['fetch', '-q', 'origin'], w); T.g(['merge', '-q', '-s', 'ours', '--no-edit', 'origin/main'], w); T.g(['push', '-q', 'origin', 'chore-sneak'], w);
    // main changes another setting far from the jobs
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    T.onMain((j) => { j.tick_minutes = 7; }, 'tick 7');
    assert.equal(T.g(['rev-list', 'origin/main..origin/chore-sneak', '--full-history', '--', SETP], T.old), '', 'rev-list lists nothing');
    refused(T.dry('sneak'), MAIN_CHANGED);
    refused(T.merge('sneak'), MAIN_CHANGED);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(Object.hasOwn(T.mainSettings().recurring, 'bb'), false, 'bb came back with no answer');
  } finally { T.done(); }
});

test('RV5-SKIP: rebase, a branch commit main already has (then undid): the rebase would skip it, so it is refused (final-5 F1)', () => {
  const T = setup('rv5skip');
  try {
    T.onMain((j) => { j.recurring = { dd: check({ title: 'DD', run: 'echo dd' }) }; j.merge_method = 'rebase'; });
    // the chore: c1 retitles dd
    const wt = T.choreBranch('skip', (w) => rawEdit(w, (t) => t.replace('"title": "DD"', '"title": "T2"')));
    const c1 = T.g(['rev-parse', 'HEAD'], wt);
    // main gets the same patch (a cherry-pick), then undoes it by hand beside another file
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['checkout', '-q', 'main'], T.old); T.g(['reset', '-q', '--hard', 'origin/main'], T.old);
    T.g(['cherry-pick', '-x', c1], T.old);
    T.g(['checkout', 'HEAD~1', '--', SETP], T.old); write(path.join(T.old, NOTES), 'undo\n'); T.g(['add', '-A'], T.old); T.g(['commit', '-qm', 'undo the retitle, and notes'], T.old);
    T.g(['push', '-q', 'origin', 'main'], T.old);
    assert.equal(T.g(['rev-parse', `origin/main:${SETP}`], T.old), T.g(['rev-parse', `${c1}~1:${SETP}`], T.old), 'main\'s file is the base\'s again');
    // c2 changes dd's run; the head's dd is { title T2, run "echo changed" }, as the answer shows
    commitIn(T, wt, 'chore-skip', (w) => rawEdit(w, (t) => t.replace('"run": "echo dd"', '"run": "echo changed"')), 'c2: run');
    const q = T.yes({ recurring: { dd: check({ title: 'T2', run: 'echo changed' }) } });
    // git rebase drops c1 (its patch is upstream) and lands a dd neither main nor the answer has
    const rb = path.join(T.base, 'rb');
    T.g(['fetch', '-q', 'origin'], T.old);
    T.g(['worktree', 'add', '-q', '--detach', rb, 'origin/chore-skip'], T.old);
    T.g(['rebase', '-q', 'origin/main'], rb);
    assert.deepEqual(JSON.parse(BLOCK.exec(fs.readFileSync(path.join(rb, SETP), 'utf8'))[1]).recurring.dd, check({ title: 'DD', run: 'echo changed' }));
    refused(T.dry('skip', q), MAIN_CHANGED_REBASE);
  } finally { T.done(); }
});

test('RV5-HIDDEN: rebase, a settings commit hidden behind a merge of an older main that keeps that main\'s file: refused (final-5 F4)', () => {
  const T = setup('rv5hid');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job' }), bb: check({ title: 'B job', run: 'echo bb' }) }; });
    T.g(['fetch', '-q', 'origin'], T.old);
    const O = T.g(['rev-parse', 'origin/main'], T.old);
    // c1 retitles aa; then the branch merges a side line off O (before the stop), taking O's settings.md
    const wt = T.choreBranch('hid', (w) => rawEdit(w, (t) => t.replace('"title": "A job"', '"title": "A2"')));
    const q = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-bb', (j) => { delete j.recurring.bb; });
    passes(T.merge('stop-bb', ['--approved', q]));
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    T.onMain((j) => { j.merge_method = 'rebase'; }, 'rebase');
    write(path.join(wt, NOTES), 'side\n'); T.g(['add', '-A'], wt); T.g(['commit', '-qm', 'notes'], wt);
    const side = path.join(T.base, 'side');
    T.g(['worktree', 'add', '-q', '--detach', side, O], T.old); write(path.join(side, 'docs/devteam/project/other.md'), 'o\n'); T.g(['add', '-A'], side); T.g(['commit', '-qm', 'side'], side);
    const S2 = T.g(['rev-parse', 'HEAD'], side);
    T.g(['merge', '-q', '--no-ff', '--no-commit', S2], wt); T.g(['checkout', S2, '--', SETP], wt); T.g(['commit', '-qm', 'merge side, its settings'], wt); T.g(['push', '-q', '-f', 'origin', 'chore-hid'], wt);
    T.g(['fetch', '-q', 'origin'], T.old);
    // without --full-history, rev-list follows the TREESAME parent and hides c1
    assert.equal(T.g(['rev-list', 'origin/main..origin/chore-hid', '--', SETP], T.old), '');
    assert.notEqual(T.g(['rev-list', 'origin/main..origin/chore-hid', '--full-history', '--', SETP], T.old), '');
    refused(T.dry('hid'), MAIN_CHANGED_REBASE);
  } finally { T.done(); }
});

test('RV4-MOVED: forge git, main moves between the checks and the landing: refused, and main is left as the mover left it (final-4 F3)', () => {
  const T = setup('rv4mv');
  try {
    // a commit on top of main, on origin as another branch: the chore's gate pushes it to main, after
    // the checks and before the landing
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    write(path.join(T.old, NOTES), 'moved\n'); T.g(['add', NOTES], T.old); T.g(['commit', '-qm', 'main moves'], T.old);
    const adv = T.g(['rev-parse', 'HEAD'], T.old);
    T.g(['push', '-q', 'origin', `${adv}:refs/heads/advance`], T.old);
    T.g(['reset', '-q', '--hard', 'HEAD~1'], T.old);
    const wt = T.jobsChore('mover', (j) => { j.gates = { ...(j.gates ?? {}), mover: `git push -q origin ${adv}:refs/heads/main` }; });
    const head = T.g(['rev-parse', 'HEAD'], wt);
    const r = T.merge('mover');
    refused(r, /main moved since the checks \([0-9a-f]{12} to [0-9a-f]{12}\); run merge again/);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['rev-parse', 'origin/main'], T.old), adv, 'main is as the mover left it');
    assert.throws(() => T.g(['merge-base', '--is-ancestor', head, 'origin/main'], T.old), 'the chore did not land');
  } finally { T.done(); }
});

test('RV4-MOVED-GH: forge github, main moves after the checks: refused before gh pr merge, main left as it is; unmoved, gh pr merge runs (final-4 F3)', () => {
  const T = setup('rv4mvgh');
  try {
    // home's code lands through GitHub: settings forge "github", and a gh first on PATH that answers
    // the calls merge makes (pr view: one open, clean PR at the head; pr merge: logged only)
    T.onMain((j) => { j.forge = 'github'; });
    const bin = path.join(T.base, 'bin-gh');
    const log = path.join(T.base, 'gh.log');
    const prFile = path.join(T.base, 'pr.json');
    write(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\n[ "$1 $2" = "pr view" ] && exec cat "${prFile}"\n[ "$1 $2" = "pr merge" ] && exit 0\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const env = { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
    const prMerges = () => calls().filter((c) => c.startsWith('pr merge '));
    const ghMerge = (slug, wt) => {
      const sha = T.g(['rev-parse', 'HEAD'], wt);
      write(prFile, JSON.stringify({ number: 7, headRefOid: sha, title: `chore-${slug}: jobs`, body: '## One-way doors\n\nNone.\n', isDraft: false, mergeStateStatus: 'CLEAN', url: 'https://example.test/pr/7', statusCheckRollup: [] }));
      fs.rmSync(log, { force: true });
      const r = T.run(['merge', '--chore', slug], env);
      return { sha, r };
    };
    // a commit on top of main, on origin as another branch: the chore's gate pushes it to main, after
    // the checks and before the landing
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    write(path.join(T.old, NOTES), 'moved\n'); T.g(['add', NOTES], T.old); T.g(['commit', '-qm', 'main moves'], T.old);
    const adv = T.g(['rev-parse', 'HEAD'], T.old);
    T.g(['push', '-q', 'origin', `${adv}:refs/heads/advance`], T.old);
    T.g(['reset', '-q', '--hard', 'HEAD~1'], T.old);
    const moved = ghMerge('mover', T.jobsChore('mover', (j) => { j.gates = { ...(j.gates ?? {}), mover: `git push -q origin ${adv}:refs/heads/main` }; }));
    refused(moved.r, /main moved since the checks \([0-9a-f]{12} to [0-9a-f]{12}\); run merge again/);
    assert.ok(calls().some((c) => c.startsWith('pr view ')), 'the stand-in answered the PR');
    assert.deepEqual(prMerges(), [], 'gh pr merge was never called');
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['rev-parse', 'origin/main'], T.old), adv, 'main is as the mover left it');
    assert.throws(() => T.g(['merge-base', '--is-ancestor', moved.sha, 'origin/main'], T.old), 'the chore did not land');
    // control: the same kind of chore, a gate that leaves main alone: gh pr merge runs, at the head
    const still = ghMerge('still', T.jobsChore('still', (j) => { j.gates = { ...(j.gates ?? {}), still: 'true' }; }));
    passes(still.r);
    assert.deepEqual(prMerges(), [`pr merge 7 --merge --match-head-commit ${still.sha}`]);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['rev-parse', 'origin/main'], T.old), adv, 'the stand-in lands nothing');
  } finally { T.done(); }
});

test('RV4-UNTOUCHED: a branch that never touches settings.md lands while main changed the jobs, and the jobs stay main\'s (d-20261120-083617902)', () => {
  const T = setup('rv4un');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job', every: '6h' }), bb: check({ title: 'B job', every: '12h', run: 'echo bb' }) }; });
    T.choreBranch('notes', (wt) => write(path.join(wt, NOTES), 'n\n'));
    const q = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-bb', (j) => { delete j.recurring.bb; });
    passes(T.merge('stop-bb', ['--approved', q]));
    // the branch left the file alone: main's file lands
    passes(T.merge('notes'));
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.deepEqual(Object.keys(T.mainSettings().recurring), ['aa']);
    assert.equal(T.g(['show', `origin/main:${NOTES}`], T.old), 'n');
  } finally { T.done(); }
});

test('RV4-BINDS: once main is merged into the branch, its job change binds against the head\'s file', () => {
  const T = setup('rv4bd');
  try {
    const zz = chore({ title: 'Z job', prompt: 'Z.' });
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job', every: '6h' }), bb: check({ title: 'B job', every: '12h', run: 'echo bb' }), zz }; });
    const cc = chore({ title: 'C job', prompt: 'C.' });
    const w = T.jobsChore('add-cc', (j) => { j.recurring.cc = cc; });
    const stop = T.yes({ recurring: { aa: null } });
    T.jobsChore('stop-aa', (j) => { delete j.recurring.aa; });
    passes(T.merge('stop-aa', ['--approved', stop]));
    const q = T.yes({ recurring: { cc } });
    refused(T.dry('add-cc', q), MAIN_CHANGED);
    T.g(['fetch', '-q', 'origin'], w); T.g(['merge', '-q', '--no-edit', 'origin/main'], w); T.g(['push', '-q', 'origin', 'chore-add-cc'], w);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['merge-base', '--all', 'origin/main', 'origin/chore-add-cc'], T.old), T.g(['rev-parse', 'origin/main'], T.old), 'main is the only base');
    // the head's file now: bb, zz and cc; one more job there is a change the answer never showed
    commitIn(T, w, 'chore-add-cc', (wt) => T.edit((j) => { j.recurring.dd = check({ title: 'D job', every: '8h', run: 'echo dd' }); }, wt), 'and dd');
    refused(T.dry('add-cc', q), /recurring\.dd is added here, which q-[0-9]+-[0-9]+-supervisor did not show the owner/);
    commitIn(T, w, 'chore-add-cc', (wt) => T.edit((j) => { delete j.recurring.dd; }, wt), 'not dd');
    passes(T.merge('add-cc', ['--approved', q]));
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.deepEqual(T.mainSettings().recurring, { bb: check({ title: 'B job', every: '12h', run: 'echo bb' }), zz, cc });
  } finally { T.done(); }
});

// ---- round 6 (d-20261120-075327162): cleared only when the head's settings.md is main's, or the
// head contains main's checked tip; under rebase only the first ----
const OLDP = 'docs/devteam/project/settings-old.md';
const jobsOf6 = (T, ref, p = SETP) => { const j = JSON.parse(BLOCK.exec(T.g(['show', `${ref}:${p}`], T.old))[1]); return j.recurring ?? {}; };
const editAt = (wt, rel, fn) => { const f = path.join(wt, rel); const txt = fs.readFileSync(f, 'utf8'); const m = BLOCK.exec(txt); const j = JSON.parse(m[1]); fn(j); fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2))); };

for (const how of ['merge', 'squash', 'rebase']) {
  test(`RV6-RENAME (${how}): settings.md missing at the base, main brings it back by a rename of the file the chore edits: refused, and the job doesn't land (final-6 F1)`, () => {
    const T = setup(`rv6ren-${how}`);
    try {
      T.onMain((j) => { j.recurring = Object.fromEntries(['aa', 'bb', 'cc', 'dd', 'ee'].map((n) => [n, check({ title: `${n} job`, run: `echo ${n}` })])); if (how !== 'merge') j.merge_method = how; });
      // main moves settings.md aside for a while; a chore cut then edits the file where main put it
      T.g(['mv', SETP, OLDP], T.old); T.g(['commit', '-qm', 'settings aside'], T.old); T.g(['push', '-q', 'origin', 'main'], T.old);
      T.choreBranch('mig', (wt) => editAt(wt, OLDP, (j) => { j.recurring.zz = check({ title: 'Z job', run: 'echo zz' }); }));
      // main puts it back (git's rename detection pairs it with the chore's edited file), then stops aa
      T.g(['fetch', '-q', 'origin'], T.old); T.g(['reset', '-q', '--hard', 'origin/main'], T.old);
      T.g(['mv', OLDP, SETP], T.old); T.g(['commit', '-qm', 'settings back'], T.old); T.g(['push', '-q', 'origin', 'main'], T.old);
      T.onMain((j) => { delete j.recurring.aa; }, 'stop aa');
      const why = how === 'rebase' ? REBASE_ALONE : DIFFERS;
      refused(T.dry('mig'), why);
      refused(T.merge('mig'), why);
      T.g(['fetch', '-q', 'origin'], T.old);
      assert.equal(Object.hasOwn(jobsOf6(T, 'origin/main'), 'zz'), false, 'zz landed with no answer');
    } finally { T.done(); }
  });
}

test('RV6-REBASE-OURS: rebase, a branch cut before a stop merges main with -s ours, then main moves by another file: refused, the files differ (final-6b B6-1)', () => {
  const T = setup('rv6ro');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job' }), bb: check({ title: 'B job', run: 'echo bb' }) }; j.merge_method = 'rebase'; });
    const w = T.choreBranch('back', (wt) => write(path.join(wt, NOTES), 'n\n'));
    // main stops bb (by hand: under rebase no branch lands a job change, d-20261120-075327162)
    T.onMain((j) => { delete j.recurring.bb; }, 'stop bb');
    T.g(['fetch', '-q', 'origin'], w); T.g(['merge', '-q', '-s', 'ours', '--no-edit', 'origin/main'], w); T.g(['push', '-q', 'origin', 'chore-back'], w);
    onMainFile(T, 'docs/devteam/project/other.md', 'o\n', 'main moves, not settings');
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.notEqual(T.g(['rev-parse', `origin/chore-back:${SETP}`], T.old), T.g(['rev-parse', `origin/main:${SETP}`], T.old), 'the head\'s file is not main\'s');
    // with an answer for bb back: a rebase lands main's file (bb stopped), not the head's
    const q2 = T.yes({ recurring: { bb: check({ title: 'B job', run: 'echo bb' }) } });
    refused(T.dry('back', q2), REBASE_ALONE);
    refused(T.dry('back'), REBASE_ALONE);
  } finally { T.done(); }
});

test('RV6-CRISS: a criss-cross whose two bases\' settings.md differ, the head\'s equal to one, then main stops a job: refused (final-6 F2, final-6b B6-3)', () => {
  const T = setup('rv6criss');
  try {
    T.onMain((j) => { j.recurring = Object.fromEntries(['aa', 'bb', 'cc', 'dd'].map((n) => [n, check({ title: `${n} job`, run: `echo ${n}` })])); });
    const wt = T.choreBranch('cx', (w) => write(path.join(w, NOTES), 'cx 1\n'));
    const x1 = T.g(['rev-parse', 'HEAD'], wt);
    // m1 changes settings.md (a tick), so the two bases' blobs differ
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['reset', '-q', '--hard', 'origin/main'], T.old);
    T.onMain((j) => { j.tick_minutes = 7; }, 'm1: tick');
    const m1 = T.g(['rev-parse', 'origin/main'], T.old);
    // main merges x1; the chore merges m1 (not main's tip)
    T.g(['merge', '-q', '--no-ff', '-m', 'main takes x1', x1], T.old); T.g(['push', '-q', 'origin', 'main'], T.old);
    T.g(['merge', '-q', '--no-ff', '-m', 'chore takes m1', m1], wt); T.g(['push', '-q', '-f', 'origin', 'chore-cx'], wt);
    T.onMain((j) => { delete j.recurring.bb; }, 'stop bb');
    T.g(['fetch', '-q', 'origin'], T.old);
    const bases = T.g(['merge-base', '--all', 'origin/main', 'origin/chore-cx'], T.old).split('\n');
    assert.equal(bases.length, 2, 'two merge bases');
    assert.notEqual(T.g(['rev-parse', `${bases[0]}:${SETP}`], T.old), T.g(['rev-parse', `${bases[1]}:${SETP}`], T.old), 'their settings.md differ');
    refused(T.dry('cx'), DIFFERS);
    refused(T.merge('cx'), DIFFERS);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(Object.hasOwn(jobsOf6(T, 'origin/main'), 'bb'), false, 'bb stays stopped');
  } finally { T.done(); }
});

test('RV6-UPSTREAM-OURS: rebase, main merges with -s ours a side commit that cherry-picks a branch commit: refused, the files differ (final-6b B6-3)', () => {
  const T = setup('rv6uo');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job' }), bb: check({ title: 'B job', run: 'echo bb' }) }; j.merge_method = 'rebase'; });
    // the chore: c1 retitles aa
    const wt = T.choreBranch('pick', (w) => rawEdit(w, (t) => t.replace('"title": "A job"', '"title": "A2"')));
    const c1 = T.g(['rev-parse', 'HEAD'], wt);
    // a side line off main cherry-picks c1; main merges it with -s ours, keeping main's file
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['reset', '-q', '--hard', 'origin/main'], T.old);
    const side = path.join(T.base, 'side');
    T.g(['worktree', 'add', '-q', '--detach', side, 'origin/main'], T.old); T.g(['cherry-pick', '-x', c1], side);
    T.g(['merge', '-q', '-s', 'ours', '--no-edit', T.g(['rev-parse', 'HEAD'], side)], T.old); T.g(['push', '-q', 'origin', 'main'], T.old);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['rev-parse', `origin/main:${SETP}`], T.old), T.g(['rev-parse', `${c1}~1:${SETP}`], T.old), 'main\'s file is as the branch left it');
    const q = T.yes({ recurring: { aa: check({ title: 'A2' }) } });
    refused(T.dry('pick', q), REBASE_ALONE);
  } finally { T.done(); }
});

test('RV6-UNTOUCHED: a branch that never touches settings.md and doesn\'t contain main lands under merge, as main\'s file, whether or not main changed it (d-20261120-083617902); under rebase only an equal file lands', () => {
  const T = setup('rv6un');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job' }), bb: check({ title: 'B job', run: 'echo bb' }) }; });
    T.choreBranch('notes-a', (wt) => write(path.join(wt, NOTES), 'a\n'));
    T.choreBranch('notes-b', (wt) => write(path.join(wt, 'docs/devteam/project/other.md'), 'b\n'));
    T.choreBranch('notes-c', (wt) => write(path.join(wt, 'docs/devteam/project/fourth.md'), 'c\n'));
    // main moves by another file only: main's settings.md is still the branch's, so the same file lands
    onMainFile(T, 'docs/devteam/project/third.md', 't\n', 'main moves, not settings');
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.throws(() => T.g(['merge-base', '--is-ancestor', 'origin/main', 'origin/chore-notes-a'], T.old), 'notes-a doesn\'t contain main');
    passes(T.merge('notes-a'));
    // main changes settings.md (a stop): notes-b left the file alone, so main's file lands and bb stays stopped
    const q = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-bb', (j) => { delete j.recurring.bb; });
    passes(T.merge('stop-bb', ['--approved', q]));
    passes(T.merge('notes-b'));
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(Object.hasOwn(T.mainSettings().recurring, 'bb'), false);
    // under rebase the same kind of branch is refused once main's file differs from its own
    T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    T.onMain((j) => { j.merge_method = 'rebase'; }, 'rebase');
    refused(T.dry('notes-c'), REBASE_ALONE);
  } finally { T.done(); }
});

test('RV6-CRISS2: a criss-cross whose head equals one base of two (the other has main\'s earlier change), then main stops a job: refused (d-20261120-083617902)', () => {
  const T = setup('rv6criss2');
  try {
    T.onMain((j) => { j.recurring = Object.fromEntries(['aa', 'bb', 'cc', 'dd'].map((n) => [n, check({ title: `${n} job`, run: `echo ${n}` })])); });
    const wt = T.choreBranch('cx2', (w) => write(path.join(w, NOTES), 'cx 1\n'));
    const x1 = T.g(['rev-parse', 'HEAD'], wt);
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['reset', '-q', '--hard', 'origin/main'], T.old);
    T.onMain((j) => { j.tick_minutes = 7; }, 'm1: tick');
    const m1 = T.g(['rev-parse', 'origin/main'], T.old);
    // main merges x1; the chore merges m1 but keeps its own settings.md (x1's)
    T.g(['merge', '-q', '--no-ff', '-m', 'main takes x1', x1], T.old); T.g(['push', '-q', 'origin', 'main'], T.old);
    T.g(['merge', '-q', '--no-ff', '--no-commit', m1], wt); T.g(['checkout', x1, '--', SETP], wt); T.g(['commit', '-qm', 'chore takes m1, keeps its settings'], wt); T.g(['push', '-q', '-f', 'origin', 'chore-cx2'], wt);
    T.onMain((j) => { delete j.recurring.bb; }, 'stop bb');
    T.g(['fetch', '-q', 'origin'], T.old);
    const bases = T.g(['merge-base', '--all', 'origin/main', 'origin/chore-cx2'], T.old).split('\n');
    assert.equal(bases.length, 2, 'two merge bases');
    const head = T.g(['rev-parse', `origin/chore-cx2:${SETP}`], T.old);
    assert.deepEqual(bases.map((b) => T.g(['rev-parse', `${b}:${SETP}`], T.old) === head).sort(), [false, true], 'the head equals one base only');
    refused(T.dry('cx2'), DIFFERS);
    refused(T.merge('cx2'), DIFFERS);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(Object.hasOwn(jobsOf6(T, 'origin/main'), 'bb'), false, 'bb stays stopped');
  } finally { T.done(); }
});

test('RV6-MAIN-ALONE: main moved by another file only; a chore that adds an answered job lands the head\'s file under merge, and is refused under rebase (d-20261120-085914614)', () => {
  const T = setup('rv6ma');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job' }) }; });
    const zz = check({ title: 'Z job', run: 'echo zz' });
    T.jobsChore('add-zz', (j) => { j.recurring.zz = zz; });
    T.jobsChore('add-yy', (j) => { j.recurring.yy = check({ title: 'Y job', run: 'echo yy' }); });
    onMainFile(T, NOTES, 'main moves\n', 'main moves, not settings');
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.throws(() => T.g(['merge-base', '--is-ancestor', 'origin/main', 'origin/chore-add-zz'], T.old), 'the chore doesn\'t contain main');
    refused(T.dry('add-zz'), /changes owner settings: recurring \(recurring-edit\)/);
    const q = T.yes({ recurring: { zz } });
    passes(T.merge('add-zz', ['--approved', q]));
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.deepEqual(T.mainSettings().recurring, { aa: check({ title: 'A job' }), zz });
    // under rebase the same kind of chore is refused: only an equal file lands
    T.g(['merge', '-q', '--ff-only', 'origin/main'], T.old);
    T.onMain((j) => { j.merge_method = 'rebase'; }, 'rebase');
    const qy = T.yes({ recurring: { yy: check({ title: 'Y job', run: 'echo yy' }) } });
    refused(T.dry('add-yy', qy), REBASE_ALONE);
  } finally { T.done(); }
});

test('RV6-CRISS3: a criss-cross where main\'s settings.md equals one base of two and the head changed the file: refused (d-20261120-085914614)', () => {
  const T = setup('rv6criss3');
  try {
    T.onMain((j) => { j.recurring = Object.fromEntries(['aa', 'bb'].map((n) => [n, check({ title: `${n} job`, run: `echo ${n}` })])); });
    const wt = T.choreBranch('cx3', (w) => write(path.join(w, NOTES), 'cx 1\n'));
    const x1 = T.g(['rev-parse', 'HEAD'], wt);
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['reset', '-q', '--hard', 'origin/main'], T.old);
    T.onMain((j) => { j.tick_minutes = 7; }, 'm1: tick');
    const m1 = T.g(['rev-parse', 'origin/main'], T.old);
    // main merges x1 (its settings.md stays m1's); the chore merges m1, then adds zz
    T.g(['merge', '-q', '--no-ff', '-m', 'main takes x1', x1], T.old); T.g(['push', '-q', 'origin', 'main'], T.old);
    T.g(['merge', '-q', '--no-ff', '-m', 'chore takes m1', m1], wt);
    const zz = check({ title: 'Z job', run: 'echo zz' });
    commitIn(T, wt, 'chore-cx3', (w) => T.edit((j) => { j.recurring.zz = zz; }, w), 'zz');
    T.g(['fetch', '-q', 'origin'], T.old);
    const bases = T.g(['merge-base', '--all', 'origin/main', 'origin/chore-cx3'], T.old).split('\n');
    assert.equal(bases.length, 2, 'two merge bases');
    const main = T.g(['rev-parse', `origin/main:${SETP}`], T.old);
    assert.deepEqual(bases.map((b) => T.g(['rev-parse', `${b}:${SETP}`], T.old) === main).sort(), [false, true], 'main equals one base only');
    const q = T.yes({ recurring: { zz } });
    refused(T.dry('cx3', q), DIFFERS);
    refused(T.merge('cx3', ['--approved', q]), DIFFERS);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(Object.hasOwn(jobsOf6(T, 'origin/main'), 'zz'), false, 'zz did not land');
  } finally { T.done(); }
});

// ---- round 7 (d-20261120-102757339): under rebase the first case needs a replay that leaves
// settings.md alone; under every method the head's settings.md is a regular file ----
// what `git rebase origin/main` of the branch lands (the spec models a rebase merge as it)
const rebaseLands = (T, branch) => {
  const rb = path.join(T.base, `rb-${branch}`);
  T.g(['fetch', '-q', 'origin'], T.old);
  T.g(['worktree', 'add', '-q', '--detach', rb, `origin/${branch}`], T.old);
  T.g(['rebase', '-q', 'origin/main'], rb);
  return JSON.parse(BLOCK.exec(fs.readFileSync(path.join(rb, SETP), 'utf8'))[1]).recurring;
};

test('RV7-DROP: rebase, the head\'s file is main\'s, but a pure settings commit main already has is dropped, so a rebase would land zz: refused (final-7 F1)', () => {
  const T = setup('rv7drop');
  try {
    const aa = check({ title: 'A job' }); const bb = check({ title: 'B job', run: 'echo bb' }); const zz = check({ title: 'Z job', run: 'echo zz' });
    T.onMain((j) => { j.recurring = { aa, bb }; j.merge_method = 'rebase'; });
    // c1 adds zz beside a notes edit; c2 removes zz, settings.md only
    const wt = T.choreBranch('drop', (w) => { T.edit((j) => { j.recurring.zz = zz; }, w); write(path.join(w, NOTES), 'notes\n'); });
    commitIn(T, wt, 'chore-drop', (w) => T.edit((j) => { delete j.recurring.zz; }, w), 'c2: remove zz');
    // main makes the same add and remove as commits of its own (the remove is c2's patch)
    T.onMain((j) => { j.recurring.zz = zz; }, 'main: add zz');
    T.onMain((j) => { delete j.recurring.zz; }, 'main: remove zz');
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['rev-parse', `origin/main:${SETP}`], T.old), T.g(['rev-parse', `origin/chore-drop:${SETP}`], T.old), 'the head\'s file is main\'s');
    const d = T.dry('drop');
    assert.ok(Object.hasOwn(rebaseLands(T, 'chore-drop'), 'zz'), 'git rebase lands zz');
    refused(d, REBASE_ALONE);
    refused(T.merge('drop'), REBASE_ALONE);
  } finally { T.done(); }
});

test('RV7-EVIL: rebase, a chore adds zz, then merges main taking main\'s settings.md; a rebase drops the merge and would land zz: refused (final-7 F1)', () => {
  const T = setup('rv7evil');
  try {
    const job = (n) => check({ title: `${n} job`, run: `echo ${n}` });
    T.onMain((j) => { j.recurring = { aa: job('aa'), bb: job('bb'), cc: job('cc'), dd: job('dd') }; j.merge_method = 'rebase'; });
    const wt = T.jobsChore('evil', (j) => { j.recurring.zz = job('zz'); });
    const q = T.yes({ recurring: { aa: null } });
    T.onMain((j) => { delete j.recurring.aa; }, `main: stop aa (${q})`);
    T.g(['fetch', '-q', 'origin'], wt);
    try { T.g(['merge', '-q', '--no-commit', 'origin/main'], wt); } catch {}
    T.g(['checkout', 'origin/main', '--', SETP], wt);
    T.g(['commit', '-qm', 'merge main, taking main\'s settings.md'], wt); T.g(['push', '-q', '-f', 'origin', 'chore-evil'], wt);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['rev-parse', `origin/main:${SETP}`], T.old), T.g(['rev-parse', `origin/chore-evil:${SETP}`], T.old), 'the head\'s file is main\'s');
    const d = T.dry('evil');
    assert.ok(Object.hasOwn(rebaseLands(T, 'chore-evil'), 'zz'), 'git rebase lands zz');
    refused(d, REBASE_ALONE);
  } finally { T.done(); }
});

test('RV7-REBASE-DROP: rebase, the branch stops bb, restores it and stops it again, main has that stop; a rebase would bring bb back: refused (final-7b B7-1)', () => {
  const T = setup('rv7rd');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job' }), bb: check({ title: 'B job', run: 'echo bb' }) }; j.merge_method = 'rebase'; });
    const wt = T.jobsChore('drop', (j) => { delete j.recurring.bb; });
    const c1 = T.g(['rev-parse', 'HEAD'], wt);
    commitIn(T, wt, 'chore-drop', (w) => T.g(['checkout', '-q', `${c1}~1`, '--', SETP], w), 'c2: bb back');
    T.g(['cherry-pick', c1], wt); T.g(['push', '-q', '-f', 'origin', 'chore-drop'], wt);
    // main stops bb with the same patch, as a commit of its own (-x, so it isn't c1 itself)
    T.g(['fetch', '-q', 'origin'], T.old); T.g(['checkout', '-q', 'main'], T.old); T.g(['reset', '-q', '--hard', 'origin/main'], T.old);
    T.g(['cherry-pick', '-x', c1], T.old);
    assert.notEqual(T.g(['rev-parse', 'HEAD'], T.old), c1, 'main\'s stop is a commit of its own'); T.g(['push', '-q', 'origin', 'main'], T.old); T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(T.g(['rev-parse', `origin/chore-drop:${SETP}`], T.old), T.g(['rev-parse', `origin/main:${SETP}`], T.old), 'the head\'s file is main\'s');
    const d = T.dry('drop');
    assert.ok(Object.hasOwn(rebaseLands(T, 'chore-drop'), 'bb'), 'git rebase brings bb back');
    refused(d, REBASE_ALONE);
  } finally { T.done(); }
});

test('RV7-SYMLINK: the head turns settings.md into a symlink whose target text is the answered file: refused (final-7 F2)', () => {
  const T = setup('rv7sym');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job' }) }; });
    const zz = check({ title: 'Z job', run: 'echo zz' });
    const wt = T.jobsChore('sym', (j) => { j.recurring.zz = zz; });
    // the same blob, committed as mode 120000
    const oid = T.g(['rev-parse', `HEAD:${SETP}`], wt);
    T.g(['update-index', '--cacheinfo', `120000,${oid},${SETP}`], wt);
    T.g(['commit', '-qm', 'settings.md as a symlink'], wt); T.g(['push', '-q', '-f', 'origin', 'chore-sym'], wt);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.match(T.g(['ls-tree', 'origin/chore-sym', '--', SETP], T.old), /^120000 /, 'the head\'s settings.md is a symlink');
    const q = T.yes({ recurring: { zz } });
    refused(T.dry('sym', q), NOT_REGULAR);
    refused(T.merge('sym', ['--approved', q]), NOT_REGULAR);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(Object.hasOwn(jobsOf6(T, 'origin/main'), 'zz'), false, 'zz did not land');
  } finally { T.done(); }
});

test('RV8-EXEC: the head commits settings.md as mode 100755 with an answered job: refused as not a regular file (final-8b R2)', () => {
  const T = setup('rv8exec');
  try {
    T.onMain((j) => { j.recurring = { aa: check({ title: 'A job' }) }; });
    const zz = check({ title: 'Z job', run: 'echo zz' });
    const wt = T.jobsChore('ex', (j) => { j.recurring.zz = zz; });
    T.g(['update-index', '--chmod=+x', SETP], wt); T.g(['commit', '-qm', 'x bit'], wt); T.g(['push', '-q', '-f', 'origin', 'chore-ex'], wt);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.match(T.g(['ls-tree', 'origin/chore-ex', '--', SETP], T.old), /^100755 /, 'the head\'s settings.md is mode 100755');
    const q = T.yes({ recurring: { zz } });
    refused(T.dry('ex', q), /settings\.md at the head is not a regular file \(mode 100755\)/);
    refused(T.merge('ex', ['--approved', q]), NOT_REGULAR);
  } finally { T.done(); }
});

test('RV7-RENAME-MIRROR: main lacks settings.md at the base and its tip and edits the old path, the branch renames it into settings.md: refused (final-7b B7-4)', () => {
  const T = setup('rv7mir');
  try {
    T.onMain((j) => { j.recurring = Object.fromEntries(['aa', 'bb', 'cc', 'dd', 'ee'].map((n) => [n, check({ title: `${n} job`, run: `echo ${n}` })])); });
    // main moves settings.md aside, from a worktree of its own (the kit's checkout keeps its file)
    const mw = path.join(T.base, 'main-wt');
    T.g(['worktree', 'add', '-q', '--detach', mw, 'origin/main'], T.old);
    T.g(['mv', SETP, OLDP], mw); T.g(['commit', '-qm', 'settings aside'], mw); T.g(['push', '-q', 'origin', 'HEAD:main'], mw);
    // the chore renames it back into settings.md and adds zz
    T.choreBranch('mir', (wt) => { T.g(['mv', OLDP, SETP], wt); editAt(wt, SETP, (j) => { j.recurring.zz = check({ title: 'Z job', run: 'echo zz' }); }); });
    // main edits the old path: stops aa
    editAt(mw, OLDP, (j) => { delete j.recurring.aa; }); T.g(['commit', '-qam', 'stop aa'], mw); T.g(['push', '-q', 'origin', 'HEAD:main'], mw);
    T.g(['fetch', '-q', 'origin'], T.old);
    const mb = T.g(['merge-base', 'origin/main', 'origin/chore-mir'], T.old);
    for (const ref of [mb, 'origin/main']) assert.throws(() => T.g(['rev-parse', '--verify', '-q', `${ref}:${SETP}`], T.old), `${ref} has no settings.md`);
    refused(T.dry('mir'), DIFFERS);
    refused(T.merge('mir'), DIFFERS);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.throws(() => T.g(['rev-parse', '--verify', '-q', `origin/main:${SETP}`], T.old), 'nothing landed');
  } finally { T.done(); }
});

// ---- round 8 (d-20261120-123629470): under merge and squash the equal case also needs
// settings.md at every merge base ----
// main moves settings.md aside, a chore is cut that adds settings.md as a byte copy of the old path
// and adds zz at the old path, and main moves the file back: the head's blob is main's, but git's
// rename detection carries the old path's edit into settings.md
const copyBack = (T, how) => {
  T.onMain((j) => { j.recurring = Object.fromEntries(['aa', 'bb', 'cc', 'dd', 'ee'].map((n) => [n, check({ title: `${n} job`, run: `echo ${n}` })])); if (how !== 'merge') j.merge_method = how; });
  T.g(['mv', SETP, OLDP], T.old); T.g(['commit', '-qm', 'settings aside'], T.old); T.g(['push', '-q', 'origin', 'main'], T.old);
  T.choreBranch('cb', (wt) => { fs.copyFileSync(path.join(wt, OLDP), path.join(wt, SETP)); editAt(wt, OLDP, (j) => { j.recurring.zz = check({ title: 'Z job', run: 'echo zz' }); }); });
  T.g(['fetch', '-q', 'origin'], T.old); T.g(['reset', '-q', '--hard', 'origin/main'], T.old);
  T.g(['mv', OLDP, SETP], T.old); T.g(['commit', '-qm', 'settings back'], T.old); T.g(['push', '-q', 'origin', 'main'], T.old);
  T.g(['fetch', '-q', 'origin'], T.old);
  assert.equal(T.g(['rev-parse', `origin/main:${SETP}`], T.old), T.g(['rev-parse', `origin/chore-cb:${SETP}`], T.old), 'the head\'s file is main\'s');
  const mb = T.g(['merge-base', 'origin/main', 'origin/chore-cb'], T.old);
  assert.throws(() => T.g(['rev-parse', '--verify', '-q', `${mb}:${SETP}`], T.old), 'the base has no settings.md');
  const gl = gitLands(T, 'origin/chore-cb');
  assert.equal(!gl.conflict && Object.hasOwn(gl.jobs, 'zz'), true, 'git\'s merge lands zz');
};

for (const how of ['merge', 'squash']) {
  test(`RV8-COPYBACK (${how}): the base lacks settings.md, main moves it back, the chore adds a byte copy and edits the old path: refused, and zz doesn't land (final-8b R1)`, () => {
    const T = setup(`rv8cb-${how}`);
    try {
      copyBack(T, how);
      refused(T.dry('cb'), DIFFERS);
      refused(T.merge('cb'), DIFFERS);
      T.g(['fetch', '-q', 'origin'], T.old);
      assert.equal(Object.hasOwn(jobsOf6(T, 'origin/main'), 'zz'), false, 'zz landed with no answer');
    } finally { T.done(); }
  });
}

test('RV8-COPYBACK-GOV: the copy-back chore with only a governance-edit answer: refused, and zz doesn\'t land (final-8b R1)', () => {
  const T = setup('rv8cbgov');
  try {
    copyBack(T, 'merge');
    const gr = T.run(['ask', '--class', 'governance-edit', '--question', 'Should I put settings.md back where it was?', '--recommendation', 'Yes']);
    assert.equal(gr.status, 0, gr.text);
    const gq = (QID.exec(gr.out) ?? [null])[0];
    T.answer(gq);
    refused(T.dry('cb', gq), DIFFERS);
    refused(T.merge('cb', ['--approved', gq]), DIFFERS);
    T.g(['fetch', '-q', 'origin'], T.old);
    assert.equal(Object.hasOwn(jobsOf6(T, 'origin/main'), 'zz'), false, 'zz landed under a governance-edit answer');
  } finally { T.done(); }
});
