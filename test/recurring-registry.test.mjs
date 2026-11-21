// The job registry (kit-162; design recurring-checks-and-chores-under-upkeep, C3 and "Registering",
// as the owner's "Separate file now" changed it): the jobs live in a file of their own,
// docs/devteam/project/recurring.json, and a change to it lands only as an answered recurring-edit
// question showed it, entry by entry. What lands is known only when the branch contains main's tip,
// or when no recurring.json changed on either side since a single merge base; every other PR is told
// to merge main in. Also: ask --class recurring-edit --change, the 100-runs-a-day cap, ticket and plan
// branches, Upkeep's holds, recurring list, show and apply, supervisor.md, and settings.md holding no
// jobs. Each test is a fixture repo with a bare origin and forge "git", run through the kit's commands;
// the histories of A15 are also landed with plain git, to show what the refusal keeps out. The A15
// landing tests are in test/recurring-registry.landing.test.mjs, the A5 answer tests in
// test/recurring-registry.answer.test.mjs, and what they share is in
// test/fixtures/recurring-registry/shared.mjs (final-14 F2).
// Run with TMUX unset: no fixture here starts or stops a tmux server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { multiFixture, write, json, kit, gitShim, REAL_GIT } from './lib/kit.mjs';
import { SUP, QID, PROJ, JOBS, NOTES, GIT_TIMEOUT, ZZ, check, chore, jobsText, putJson, putJobs, setup, refused, passes } from './fixtures/recurring-registry/shared.mjs';

const HEADER = 'This answer approves exactly these job changes, and no other:';
const HOWS = ['merge', 'squash', 'rebase'];

// the spec's refusals, verbatim
// (the advice follows merge_method: under rebase, the branch is rebased onto main, never merged; final-10 F7)
const CATCH_UP = (how = 'merge') => (how === 'rebase' ? 'rebase it onto main' : 'merge main into the branch first');
const BEHIND = (how) => new RegExp(`recurring\\.json: this branch doesn't contain main's tip, and it or main changed a recurring\\.json since they parted; ${CATCH_UP(how)}`);
const MULTI_BASES = (how) => new RegExp(`recurring\\.json: this branch doesn't contain main's tip and has \\d+ merge bases with it; ${CATCH_UP(how)}`);
const REBASE_MERGES = /recurring\.json: merge_method is rebase and this branch has merge commits since main; rebase it onto main instead/;
const NOT_REGULAR = /recurring\.json (at [0-9a-f]{12}|in this checkout) is not a regular file/;
const NOT_DIR = /recurring\.json (at [0-9a-f]{12}|in this checkout): \S+ is not a directory/;
const IN_SETTINGS = /settings\.md has "recurring": the jobs live in docs\/devteam\/project\/recurring\.json/;
const NOT_JSON = /recurring\.json (at [0-9a-f]{12}|in this checkout): not a JSON object/;
const MAIN_BROKEN = /main's recurring\.json doesn't read/;
const SPLIT = (key) => new RegExp(`changes the jobs \\(recurring\\.json\\) and also ${key}: one answer lands one change, so split this into two PRs`);
const OWNERS = /changes the jobs \(recurring\.json\): they are the owner's, so they land only in the supervisor's chore PR/;

const FIVE = () => Object.fromEntries(['aa', 'bb', 'cc', 'dd', 'ee'].map((n) => [n, check({ title: `${n} job`, run: `echo ${n}` })]));

// What plain git lands for origin/<branch> onto origin/main, in a scratch clone of the fixture's
// origin: a merge commit, a squash, or the branch rebased onto main; with renames, git's
// merge.directoryRenames=true, as a user's config may set it. Returns the entry that lands at the jobs
// file and at its parent dir, and the file's text when it is a blob.
let plainN = 0;
function plainLand(T, branch, how, { renames = false } = {}) {
  const dir = path.join(T.base, `plain-${++plainN}`);
  execFileSync('git', ['clone', '-q', T.org, dir], { stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT });
  const g = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...(renames ? ['-c', 'merge.directoryRenames=true'] : []), ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT }).trim();
  try {
    if (how === 'rebase') { g(['checkout', '-q', '-b', 'land', `origin/${branch}`]); g(['rebase', '-q', 'origin/main']); }
    else if (how === 'squash') { g(['checkout', '-q', 'main']); g(['merge', '-q', '--squash', `origin/${branch}`]); g(['commit', '-q', '--allow-empty', '-m', 'squash']); }
    else { g(['checkout', '-q', 'main']); g(['merge', '-q', '--no-ff', '--no-edit', `origin/${branch}`]); }
  } catch (e) { return { conflict: true, why: `${e.stdout ?? ''}${e.stderr ?? ''}` }; }
  const entry = (rel) => { const l = g(['ls-tree', 'HEAD', '--', rel]); return l ? { mode: l.split(' ')[0], type: l.split(' ')[1] } : null; };
  const at = entry(JOBS);
  return { conflict: false, entry: at, parent: entry(PROJ), text: at?.type === 'blob' ? g(['show', `HEAD:${JOBS}`]) : null, has: (rel) => entry(rel) !== null };
}
// plain git lands the branch cleanly, and the jobs file it lands names the job
const reaches = (pl, name) => {
  assert.equal(pl.conflict, false, `plain git lands it cleanly: ${pl.why}`);
  assert.ok(pl.text?.includes(`"${name}"`), `plain git lands ${name} in ${JOBS}: ${JSON.stringify(pl)}`);
};

test('A2: a chore adding a job lands only with an answered recurring-edit question showing it, as one merge-chore act', () => {
  const T = setup('add');
  try {
    T.jobsChore('recurring', () => ({ 'ci-main': check() }));
    refused(T.dry('recurring'), /recurring-edit/);
    const q = T.yes({ recurring: { 'ci-main': check() } });
    passes(T.dry('recurring', q));
    passes(T.merge('recurring', ['--approved', q]));
    assert.deepEqual(T.mainJobs(), { 'ci-main': check() });
    const landed = T.acts().filter((a) => a.class === 'merge-chore' && a.approved_by === q);
    assert.equal(landed.length, 1, JSON.stringify(landed));
  } finally { T.done(); }
});

test('A3: editing one field of a live job (every, run, prompt) needs an answer showing the edited job', () => {
  const T = setup('edit');
  try {
    // a job of its own per field, so each question is the only one for its job
    T.onMain(() => ({ 'ci-every': check(), 'ci-run': check(), tidy: chore() }));
    const cases = [
      ['ci-every', 'every', check({ every: '12h' }), check({ every: '24h' })],
      ['ci-run', 'run', check({ run: 'gh run list --limit 2' }), check({ run: 'gh run list --limit 3' })],
      ['tidy', 'prompt', chore({ prompt: 'Delete merged branches, then prune.' }), chore({ prompt: 'Delete every branch.' })],
    ];
    for (const [name, field, edited, otherValue] of cases) {
      const slug = `edit-${name}-${field}`;
      T.jobsChore(slug, (j) => { j[name] = edited; });
      refused(T.dry(slug), /recurring-edit/);
      const q = T.yes({ recurring: { [name]: edited } });
      // the same field edited to another value: the answer showed something else
      T.jobsChore(`${slug}-other`, (j) => { j[name] = otherValue; });
      refused(T.dry(`${slug}-other`, q), new RegExp(`recurring\\.${name}`));
      passes(T.dry(slug, q));
    }
  } finally { T.done(); }
});

test('A4: an answer for one job lands nothing else; a null lands only that removal', () => {
  const T = setup('entries');
  try {
    T.onMain(() => ({ aa: check(), bb: chore() }));
    T.jobsChore('also-adds', (j) => { j.aa = check({ every: '12h' }); j.cc = chore(); });
    refused(T.dry('also-adds'), /recurring-edit/);
    const qa = T.yes({ recurring: { aa: check({ every: '12h' }) } });
    refused(T.dry('also-adds', qa), /recurring\.cc/);
    T.jobsChore('also-edits', (j) => { j.aa = check({ every: '12h' }); j.bb = chore({ every: '2w' }); });
    refused(T.dry('also-edits', qa), /recurring\.bb/);
    T.jobsChore('other-field', (j) => { j.aa = check({ every: '12h', timeout_s: 300 }); });
    refused(T.dry('other-field', qa), /recurring\.aa/);
    T.choreBranch('with-workflow', (wt) => { putJobs(wt, (j) => { j.aa = check({ every: '12h' }); }); fs.appendFileSync(path.join(wt, '.github/workflows/ci.yml'), '# more\n'); });
    refused(T.dry('with-workflow', qa), /outside project\/[^\n]*\.github\/workflows\/ci\.yml/);
    T.jobsChore('exact', (j) => { j.aa = check({ every: '12h' }); });
    passes(T.dry('exact', qa));
    const stop = T.yes({ recurring: { bb: null } });
    T.jobsChore('stop-b', (j) => { delete j.bb; });
    passes(T.dry('stop-b', stop));
    T.jobsChore('stop-b-and-more', (j) => { delete j.bb; j.aa = check({ every: '2h' }); });
    refused(T.dry('stop-b-and-more', stop), /recurring\.aa/);
    // an answer cited on a chore that changes no job lands none of what it showed (task-2 F4)
    T.choreBranch('no-jobs', () => {});
    refused(T.dry('no-jobs', qa), /recurring\.aa[^\n]*leaves it as main has it/);
    // main's jobs moved since the branch: refused until main is merged in, then judged on the head's file
    const stale = T.jobsChore('stale', (j) => { j.dd = check({ every: '8h' }); });
    T.onMain((j) => { j.aa = check({ title: 'A job' }); });
    const qd = T.yes({ recurring: { dd: check({ every: '8h' }) } });
    refused(T.dry('stale', qd), BEHIND());
    T.mergeMainInto(stale, 'chore-stale');
    passes(T.dry('stale', qd));
    // main reorders the jobs' text, the same value, with no answer needed: still a change to the file
    // since the branch parted, so refused until main is merged in
    T.onMain((j) => ({ ...j, ee: check({ every: '12h' }), ff: chore({ every: '1d' }) }));
    const qf = T.yes({ recurring: { ff: null } });
    const late = T.jobsChore('stop-ff', (j) => { delete j.ff; });
    T.onMain((j) => { const { ff, ...rest } = j; return { ff, ...rest }; }, 'main: the jobs reordered');
    refused(T.dry('stop-ff', qf), BEHIND());
    T.mergeMainInto(late, 'chore-stop-ff');
    // the merge keeps main's moved ff, so the branch stops it again on top
    T.commitIn(late, 'chore-stop-ff', (wt) => putJobs(wt, (j) => { delete j.ff; }), 'stop ff again');
    passes(T.dry('stop-ff', qf));
    // criss-cross: two merge bases, so git would merge over a virtual base the kit can't read.
    // Deterministic: B1, whose file is main's, is committed after B2, so merge-base names it.
    const qe = T.yes({ recurring: { ee: null } });
    T.syncMain();
    const before = fs.readFileSync(path.join(T.old, JOBS), 'utf8');
    const ago = (secs) => { const d = `${Math.floor(Date.now() / 1000) - secs} +0000`; return { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d }; };
    T.g(['checkout', '-q', '-b', 'cc-side']);
    putJobs(T.old, (j) => { const { ee, ...rest } = j; return { ee, ...rest }; });
    T.g(['commit', '-qam', 'B2: the jobs text reordered'], T.old, ago(120));
    T.g(['checkout', '-q', 'main']);
    fs.writeFileSync(path.join(T.old, 'README.md'), 'B1\n');
    T.g(['commit', '-qam', 'B1: unrelated'], T.old, ago(60));
    const b1 = T.g(['rev-parse', 'HEAD']);
    const cc = path.join(T.old, '.worktrees/chore-cc');
    T.g(['worktree', 'add', '-q', '-b', 'chore-cc', cc, 'cc-side']);
    T.g(['merge', '-q', '--no-edit', b1], cc);
    T.g(['merge', '-q', '--no-edit', 'cc-side']);
    fs.writeFileSync(path.join(T.old, JOBS), before);
    T.g(['commit', '-qam', 'the jobs text back']);
    T.pushMain();
    putJobs(cc, (j) => { delete j.ee; });
    T.g(['commit', '-qam', 'stop ee'], cc);
    T.g(['push', '-q', 'origin', 'chore-cc'], cc);
    write(path.join(T.old, 'docs/devteam/run/pr/chore-cc.md'), '# chore-cc: jobs\n\n## One-way doors\n\nNone.\n');
    T.g(['fetch', '-q', 'origin']);
    assert.equal(T.g(['merge-base', '--all', 'origin/main', 'origin/chore-cc']).split('\n').length, 2, 'two merge bases');
    const mb = T.g(['merge-base', 'origin/main', 'origin/chore-cc']);
    assert.equal(T.g(['rev-parse', `${mb}:${JOBS}`]), T.g(['rev-parse', `origin/main:${JOBS}`]), 'the named base has main\'s file');
    refused(T.dry('cc', qe), MULTI_BASES());
  } finally { T.done(); }
});

test('A6: one answer, one change: the jobs with another owner setting are refused whatever the answer', () => {
  const T = setup('split');
  try {
    T.choreBranch('with-gates', (wt) => { putJobs(wt, () => ({ 'ci-main': check() })); T.edit((j) => { j.gates = { test: 'true' }; }, wt); });
    T.choreBranch('with-agent', (wt) => { putJobs(wt, () => ({ 'ci-main': check() })); T.edit((j) => { j.agent_command = 'echo other'; }, wt); });
    refused(T.dry('with-gates'), SPLIT('gates'));
    refused(T.dry('with-agent'), SPLIT('agent_command'));
    const rq = T.yes({ recurring: { 'ci-main': check() } });
    const gr = T.run(['ask', '--class', 'governance-edit', '--question', 'Change the agent command?', '--recommendation', 'Yes']);
    const gq = QID.exec(gr.out)[0];
    T.answer(gq);
    for (const [slug, key] of [['with-gates', 'gates'], ['with-agent', 'agent_command']]) for (const q of [null, rq, gq]) refused(T.dry(slug, q), SPLIT(key));
    T.jobsChore('jobs-only', () => ({ 'ci-main': check() }));
    refused(T.dry('jobs-only', gq), /recurring-edit/);
  } finally { T.done(); }
});

test('A7: a chore that only removes a job lands only with an answer whose change is that name: null; deleting the file stops every job', () => {
  const T = setup('remove');
  try {
    T.onMain(() => ({ 'old-job': chore() }));
    T.jobsChore('stop', (j) => { delete j['old-job']; });
    refused(T.dry('stop'), /recurring-edit/);
    // the file deleted is the stop of every job: with no answer it is refused too
    T.jobsChore('drop-file', () => null);
    refused(T.dry('drop-file'), /recurring-edit/);
    const q = T.yes({ recurring: { 'old-job': null } });
    passes(T.dry('drop-file', q));
    passes(T.merge('stop', ['--approved', q]));
    assert.deepEqual(T.mainJobs(), {});
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
      assert.equal(forced[0].what, `started chore-recurring while Upkeep is ${mode === 'drain' ? 'drained' : 'parked'}, with --force`);
      assert.deepEqual(forced[0].refs, ['upkeep', 'chore-recurring']);
      T.g(['worktree', 'remove', '--force', path.join(T.old, '.worktrees/chore-recurring')]);
      T.g(['branch', '-D', 'chore-recurring']);
      T.jobsChore('recurring', () => ({ 'ci-main': check() }));
      const q = T.yes({ recurring: { 'ci-main': check() } });
      refused(T.merge('recurring', ['--approved', q]), /Upkeep|goal is/);
      passes(T.merge('recurring', ['--approved', q, '--force']));
      const act = T.acts().find((a) => a.class === 'merge-chore' && a.approved_by === q);
      assert.match(act.what, /with --force/);
      // a chore of another slug that changes the jobs is held too
      T.jobsChore('jobs-other', (j) => { j.tidy = chore(); });
      const q2 = T.yes({ recurring: { tidy: chore() } });
      refused(T.dry('jobs-other', q2), /Upkeep|goal is/);
      // a record-keeping slug that changes the jobs is held too
      T.jobsChore('fleet-handoff', (j) => { j.tidy = chore(); });
      refused(T.dry('fleet-handoff', q2), /Upkeep|goal is/);
    } finally { T.done(); }
  }
});

test('A9: ask --class recurring-edit --change takes the C3 shape and nothing else, one pending question per job, and the cap', () => {
  const T = setup('ask');
  try {
    T.onMain(() => ({ tidy: chore() }));
    const add = T.ask({ recurring: { 'ci-main': check() } });
    passes(add);
    const q = json(T.ok(['questions', '--id', add.qid, '--json']))[0];
    assert.ok(q.context.includes(HEADER), q.context);
    assert.ok(q.context.includes('recurring.ci-main: add'), q.context);
    assert.ok(q.context.includes('A check only looks: it never changes production') && q.context.includes('as it is on main each time'), q.context);
    passes(T.ask({ recurring: { tidy: null } }));
    refused(T.ask({ recurring: { xx: check() }, gates: {} }), /only "recurring"/);
    refused(T.ask({ recurring: { xx: check({ every: '30m' }) } }), /recurring\.json xx\.every/);
    refused(T.ask({ recurring: { ghost: null } }), /no such job/);
    const open1 = T.ask({ recurring: { 'ci-main': check({ every: '12h' }) } });
    refused(open1, new RegExp(`${add.qid}`));
    assert.match(open1.text, /\(open\): one question per job at a time; withdraw it, or wait for its answer and land it/);
    T.answer(add.qid);
    // an answered question can't be withdrawn: the advice says what can be done (final-10b F3)
    refused(T.ask({ recurring: { 'ci-main': check({ every: '12h' }) } }), /\(answered Yes, not landed yet\): one question per job at a time; an answered question can't be withdrawn: land it first \(recurring apply, then merge --chore recurring --approved\), or wait for its reopen/);
    refused(T.ask(undefined), /--change/);
    refused(T.ask({ recurring: { tidy: chore() } }), /already has exactly this/);
    refused(T.run(['ask', '--class', 'recurring-edit', '--question', 'Add it?', '--recommendation', 'Later', '--change', JSON.stringify({ recurring: { z1: chore() } })]), /--recommendation[^\n]*Yes/);
    refused(T.ask({ recurring: { z1: chore() } }, ['--choices', '[{"label":"Yes"},{"label":"No"}]']), /the kit writes its choices/);
    refused(T.ask({ recurring: { z2: chore() } }, ['--kind', 'owner-action', '--secrets', '[{"name":"API_KEY","sink":"rails-credentials:test:api.key"}]']), /a plain yes or no: --kind owner-decision and no --secrets/);
    refused(T.ask({ recurring: { z3: chore() } }, ['--context', `${HEADER}\nrecurring.z3: add {}`]), /may not hold a job approval line/);
    // a look-alike line with a space before its colon, and no header (task-1 F4)
    refused(T.ask({ recurring: { z4: chore() } }, ['--context', 'recurring.xx : add {}']), /may not hold a job approval line/);
    // the cap: main at 90 with hourly x (24); an open stop of x; then an hourly y is refused
    const filler = Object.fromEntries(Array.from({ length: 66 }, (_, i) => [`daily-${i + 1}`, chore({ every: '1d' })]));
    T.onMain(() => ({ ...filler, xx: check({ every: '1h' }) }));
    passes(T.ask({ recurring: { xx: null } }));
    refused(T.ask({ recurring: { yy: check({ every: '1h' }) } }), /cap of 100/);
    passes(T.ask({ recurring: { yy: check({ every: '1d' }) } }));
    // a pending addition counts: main at 60, an open hourly z, then an hourly w is refused until z is withdrawn
    const sixty = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`d-${i + 1}`, chore({ every: '1d' })]));
    T.onMain(() => sixty);
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
    T.onMain(() => Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`hourly-${i + 1}`, check({ every: '1h' })])));
    passes(T.ask({ recurring: { 'hourly-1': null } }));
  } finally { T.done(); }
});

test('A9: ask --change refuses a key twice in one object, a job name or the "recurring" key itself: JSON keeps only the last (final-14b F7)', () => {
  const T = setup('ask-dups');
  try {
    const askRaw = (raw) => T.run(['ask', '--class', 'recurring-edit', '--question', 'Add?', '--recommendation', 'Yes', '--change', raw]);
    const good = JSON.stringify(check({ title: 'pp job', run: 'echo pp' }));
    const evil = JSON.stringify(check({ title: 'pp job', run: 'echo evil' }));
    refused(askRaw(`{"recurring":{"pp":${good},"pp":${evil}}}`), /--change for recurring-edit: "pp" appears twice in one object \(recurring\.pp\): JSON keeps only the last/);
    refused(askRaw(`{"recurring":{"pp":${good}},"recurring":{"zz":${good}}}`), /--change for recurring-edit: "recurring" appears twice in one object \(recurring\): JSON keeps only the last/);
    refused(askRaw(`{"recurring":{"pp":{"kind":"check","title":"t","what":"w","every":"6h","run":"echo ok","run":"echo evil"}}}`), /--change for recurring-edit: "run" appears twice in one object \(recurring\.pp\.run\)/);
    assert.deepEqual(json(T.ok(['questions', '--json'])).filter((q) => q.class === 'recurring-edit'), [], 'no question asked');
    passes(askRaw(`{"recurring":{"pp":${good}}}`));
  } finally { T.done(); }
});

test('A9b: only the supervisor asks a recurring-edit question or applies one: a worker, a planner and the responder are refused', () => {
  const T = setup('roles');
  try {
    const q = T.yes({ recurring: { aa: check() } });
    const roles = { worker: { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'api-01-x' }, planner: { DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'chores' }, responder: { DEVTEAM_ROLE: 'responder' } };
    // final-1b B3: each is refused by the kit's role check, before anything is asked or written
    const before = T.g(['status', '--porcelain']);
    for (const [who, role] of Object.entries(roles)) {
      const a = T.run(['ask', '--class', 'recurring-edit', '--question', 'Should I add bb?', '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { bb: check() } })], role);
      refused(a, /^devteam: ask: the supervisor does this/m);
      const p = T.run(['recurring', 'apply', q], role);
      refused(p, /^devteam: recurring apply: the supervisor does this/m);
      assert.equal(T.g(['status', '--porcelain']), before, `${who}: nothing written`);
    }
    assert.equal(T.ask({ recurring: { bb: check() } }).status, 0, 'the supervisor asks it');
  } finally { T.done(); }
});

test('A10: a ticket or plan branch that changes the jobs is refused by check-pr and merge', () => {
  const T = setup('branches');
  try {
    T.lines(T.STD);
    T.ok(['ticket', 'add', 'api-01-x', '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['its suite passes in CI'], notes: 'n' })]);
    for (const branch of ['ticket/api-01-x', 'plan/jobs']) {
      T.g(['fetch', '-q', 'origin']);
      const wt = path.join(T.base, branch.replace('/', '-'));
      T.g(['worktree', 'add', '-q', '-b', branch, wt, 'origin/main']);
      putJobs(wt, () => ({ 'ci-main': check() }));
      T.g(['add', '-A'], wt);
      T.g(['commit', '-qm', 'jobs'], wt);
      T.g(['push', '-q', 'origin', branch], wt);
      refused(T.checkPr(branch), new RegExp(`${branch} ${OWNERS.source}`));
    }
    write(path.join(T.old, 'docs/devteam/run/pr/plan/jobs.md'), '# plan-jobs: jobs\n\n## One-way doors\n\nNone.\n');
    refused(T.run(['merge', '--plan', 'jobs', '--dry-run']), OWNERS);
  } finally { T.done(); }
});

test("A10b: merge refuses a recurring-edit answer cited for a ticket whose code lands in a linked repo", () => {
  // the binding reads home's jobs file, which a linked repo's ticket never changes (task-2 F3)
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
    refused({ status: r.status, text: `${r.out}\n${r.err}` }, new RegExp(`${q} approves job changes in this repo's recurring\\.json: land it in a chore PR here`));
  } finally { if (!process.env.DEVTEAM_TEST_KEEP) fs.rmSync(F.base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('A11: merge refuses a job that breaks the shape; validate and merge refuse over 100 runs a day, naming the jobs', () => {
  const T = setup('shape-cap');
  try {
    T.jobsChore('bad', () => ({ broken: check({ every: '5x' }) }));
    refused(T.dry('bad'), /recurring\.json broken\.every/);
    const q = T.yes({ recurring: { broken: check({ every: '6h' }) } });
    refused(T.dry('bad', q), /recurring\.json broken\.every/);
    const many = { ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`hourly-${i + 1}`, check({ every: '1h' })])), extra: chore({ every: '1d' }), more: chore({ every: '1d' }), most: chore({ every: '1d' }), last: chore({ every: '1d' }), final: chore({ every: '1d' }) };
    putJobs(T.old, () => many);
    refused(T.run(['validate']), /101 runs a day[^\n]*hourly-1/);
    fs.rmSync(path.join(T.old, JOBS));
    T.jobsChore('over', () => many);
    refused(T.dry('over'), /101 runs a day[^\n]*hourly-1/);
  } finally { T.done(); }
});

// the hourly four (96) and five daily ones: 101 runs a day
const OVER = () => ({ ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`hourly-${i + 1}`, check({ every: '1h' })])), extra: chore({ every: '1d' }), more: chore({ every: '1d' }), most: chore({ every: '1d' }), last: chore({ every: '1d' }), final: chore({ every: '1d' }) });

test('A11: check-pr refuses a landed job that breaks the shape, its message prefixed "at landing: "', () => {
  const T = setup('cpr-shape');
  try {
    T.jobsChore('bad', () => ({ broken: check({ every: '5x' }) }));
    refused(T.checkPr('chore-bad'), /^(fail: )?at landing: recurring\.json broken\.every: /m);
  } finally { T.done(); }
});

test('A11: check-pr refuses landed jobs over 100 runs a day, naming every job', () => {
  const T = setup('cpr-cap');
  try {
    T.jobsChore('over', () => OVER());
    refused(T.checkPr('chore-over'), /^(fail: )?(at landing: )?recurring\.json: 101 runs a day, over the cap of 100 [^\n]*hourly-1 24[^\n]*final 1/m);
  } finally { T.done(); }
});

test('A11: a jobs file that is not a plain JSON object file is refused by validate, check-pr and merge, with its read message', () => {
  const T = setup('reads');
  try {
    T.syncMain();
    const real = `${PROJ}/jobs-real.json`;
    const dup = `{\n  "zz": ${JSON.stringify(check({ every: '1h', run: 'gh run list --limit 9' }))},\n  "zz": ${JSON.stringify(ZZ)}\n}\n`;
    // each kind: how a checkout holds it, and how a commit holds it (gitlink: an entry the index names)
    const KINDS = [
      ['symlink', NOT_REGULAR, (wt) => { write(path.join(wt, real), jobsText({ zz: ZZ })); fs.symlinkSync('jobs-real.json', path.join(wt, JOBS)); }],
      ['exec', NOT_REGULAR, (wt) => { write(path.join(wt, JOBS), jobsText({ zz: ZZ })); fs.chmodSync(path.join(wt, JOBS), 0o755); }],
      ['directory', NOT_REGULAR, (wt) => write(path.join(wt, JOBS, 'keep'), jobsText({ zz: ZZ }))],
      ['gitlink', NOT_REGULAR, (wt) => { fs.mkdirSync(path.join(wt, JOBS), { recursive: true }); T.g(['init', '-q'], path.join(wt, JOBS)); }],
      ['duplicate', /recurring\.json: "zz" appears twice in one object/, (wt) => write(path.join(wt, JOBS), dup)],
      ['nonjson', NOT_JSON, (wt) => write(path.join(wt, JOBS), '{ "zz": \n')],
    ];
    const clean = () => { fs.rmSync(path.join(T.old, JOBS), { recursive: true, force: true }); fs.rmSync(path.join(T.old, real), { force: true }); };
    for (const [kind, re, make] of KINDS) {
      // validate, on this checkout
      make(T.old);
      try { refused(T.run(['validate']), re); } finally { clean(); }
      // check-pr and merge, on a chore whose head holds it
      const slug = `read-${kind}`;
      if (kind === 'gitlink') T.choreBranch(slug, (wt) => T.g(['update-index', '--add', '--cacheinfo', `160000,${T.g(['rev-parse', 'HEAD'], wt)},${JOBS}`], wt), { add: false });
      else T.choreBranch(slug, make);
      if (kind === 'gitlink') assert.match(T.g(['ls-tree', `origin/chore-${slug}`, '--', JOBS]), /^160000 commit /, 'a gitlink at the jobs file');
      refused(T.checkPr(`chore-${slug}`), re);
      refused(T.dry(slug), re);
    }
    // docs/devteam/project itself a symlink: at the head, and in this checkout
    T.choreBranch('projlink', (wt) => { fs.renameSync(path.join(wt, PROJ), path.join(wt, 'docs/devteam/proj-real')); fs.symlinkSync('proj-real', path.join(wt, PROJ)); });
    assert.match(T.g(['ls-tree', 'origin/chore-projlink', '--', PROJ]), /^120000 /, 'the project dir is a symlink at the head');
    refused(T.checkPr('chore-projlink'), NOT_DIR);
    refused(T.dry('projlink'), NOT_DIR);
    fs.renameSync(path.join(T.old, PROJ), path.join(T.old, 'docs/devteam/proj-real'));
    fs.symlinkSync('proj-real', path.join(T.old, PROJ));
    try { refused(T.run(['validate']), NOT_DIR); } finally { fs.unlinkSync(path.join(T.old, PROJ)); fs.renameSync(path.join(T.old, 'docs/devteam/proj-real'), path.join(T.old, PROJ)); }
  } finally { T.done(); }
});

test('A11: a "recurring" key in settings.md is refused by validate and check-pr: the jobs live in recurring.json', () => {
  const T = setup('in-settings');
  try {
    T.edit((j) => { j.recurring = { 'ci-main': check() }; });
    try { refused(T.run(['validate']), IN_SETTINGS); } finally { T.g(['checkout', '-q', '--', `${PROJ}/settings.md`]); }
    T.choreBranch('in-settings', (wt) => T.edit((j) => { j.recurring = { 'ci-main': check() }; }, wt));
    refused(T.checkPr('chore-in-settings'), IN_SETTINGS);
  } finally { T.done(); }
});

test("A11: a jobs file broken by hand on main never blocks an unrelated PR, and never lets a job land without an answer", () => {
  const T = setup('broken-main');
  try {
    T.onMain(() => ({ aa: check() }));
    const BROKEN = '{\n  "aa": {\n';
    const breakMain = () => T.onMainDo((cwd) => fs.writeFileSync(path.join(cwd, JOBS), BROKEN), 'main: the jobs file broken by hand');
    const mainText = () => T.g(['show', `origin/main:${JOBS}`]);
    breakMain();
    // behind and untouched: lands, and check-pr says main's file doesn't read
    T.choreBranch('notes', (wt) => write(path.join(wt, NOTES), 'n\n'));
    T.onMainFile('README.md', 'main moves\n');
    const c = T.checkPr('chore-notes');
    passes(c);
    assert.match(c.text, MAIN_BROKEN);
    passes(T.merge('notes'));
    // up to date, the head's file byte for byte main's broken one: lands with no answer (plan-7 P5)
    T.choreBranch('notes2', (wt) => write(path.join(wt, `${PROJ}/notes2.md`), 'n\n'));
    passes(T.merge('notes2'));
    assert.equal(`${mainText()}\n`, BROKEN, 'main\'s file is as broken as it was');
    // a PR deleting the broken file lands {}, with no answer
    T.jobsChore('delete', () => null);
    passes(T.merge('delete'));
    assert.equal(T.has('origin/main', JOBS), false, 'the broken file is gone');
    // broken again; the fix is an up-to-date chore whose file reads, every job in it an addition
    breakMain();
    T.jobsChore('fix', () => ({ aa: check(), bb: chore() }));
    refused(T.dry('fix'), /recurring-edit/);
    const q = T.yes({ recurring: { aa: check(), bb: chore() } });
    passes(T.merge('fix', ['--approved', q]));
    assert.deepEqual(T.mainJobs(), { aa: check(), bb: chore() });
  } finally { T.done(); }
});

test('A11: a main jobs file nested thousands deep is a read problem, never a crash: an unrelated chore lands with the warning, and a deep head file is refused (final-10b F1)', () => {
  const T = setup('deep');
  try {
    const deep = `{"aa": ${'['.repeat(20000)}${']'.repeat(20000)}}\n`;
    const crash = /RangeError|Maximum call stack/;
    T.choreBranch('deephead', (wt) => write(path.join(wt, JOBS), deep));
    const h = T.dry('deephead');
    assert.doesNotMatch(h.text, crash);
    refused(h, /recurring\.json at [0-9a-f]{12}: nested deeper than 64 levels; no job needs that/);
    T.onMainFile(JOBS, deep, 'main: deep');
    T.choreBranch('notes', (wt) => write(path.join(wt, NOTES), 'x\n'));
    const c = T.checkPr('chore-notes');
    assert.doesNotMatch(c.text, crash);
    passes(c);
    assert.match(c.text, MAIN_BROKEN);
    passes(T.merge('notes'));
    T.g(['fetch', '-q', 'origin']);
    assert.equal(T.g(['show', `origin/main:${NOTES}`]), 'x', 'the unrelated chore landed');
    const l = T.run(['recurring', 'list']);
    assert.doesNotMatch(l.text, crash);
    assert.match(l.text, /nested deeper than 64 levels/);
    T.syncMain();
    const v = T.run(['validate']);
    assert.doesNotMatch(v.text, crash);
    refused(v, /recurring\.json in this checkout: nested deeper than 64 levels/);
  } finally { T.done(); }
});

test('A11: a jobs file over the kit\'s size bound is a read problem with its entry, never a git failure: on main an unrelated chore lands with the warning, and a big head file is refused (final-11b F2)', () => {
  const T = setup('big');
  try {
    // the bound cut to 4 KiB (DEVTEAM_RECURRING_MAX_BYTES, for tests), so the file stays small
    const SMALL = { DEVTEAM_RECURRING_MAX_BYTES: '4096' };
    const big = `{"aa":"${'x'.repeat(8000)}"}\n`;
    const BIG = /recurring\.json at [0-9a-f]{12}: 8010 bytes, over the kit's bound of 4096; no jobs file needs that/;
    T.choreBranch('bighead', (wt) => write(path.join(wt, JOBS), big));
    refused(T.merge('bighead', ['--dry-run'], SMALL), BIG);
    T.onMainFile(JOBS, big, 'main: big');
    T.choreBranch('notes', (wt) => write(path.join(wt, NOTES), 'x\n'));
    const c = T.run(['check-pr', '--head-ref', 'chore-notes', '--sha', T.headOf('chore-notes'), '--title', 'chore-notes: jobs'], { ...SUP, ...SMALL });
    passes(c);
    assert.match(c.text, MAIN_BROKEN);
    assert.match(c.text, BIG);
    const m = T.merge('notes', [], SMALL);
    passes(m);
    T.g(['fetch', '-q', 'origin']);
    assert.equal(T.g(['show', `origin/main:${NOTES}`]), 'x', 'the unrelated chore landed');
    assert.match(T.run(['recurring', 'list'], { ...SUP, ...SMALL }).text, BIG);
  } finally { T.done(); }
});

test('A11: on a main over the cap by a hand edit, a stop is asked, answered and lands; an addition there is still refused at landing (final-10b F4)', () => {
  const T = setup('overcap');
  try {
    T.onMain(() => Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`hourly-${i}`, check({ every: '1h', run: `echo ${i}` })])));
    const q = T.asked({ recurring: { 'hourly-0': null } });
    T.answer(q);
    T.jobsChore('stop', (j) => { delete j['hourly-0']; });
    passes(T.checkPr('chore-stop'));
    passes(T.merge('stop', ['--approved', q]));
    assert.equal(Object.hasOwn(T.mainJobs(), 'hourly-0'), false, 'the stop landed');
    T.jobsChore('more', (j) => { j['hourly-9'] = check({ every: '1h', run: 'echo 9' }); });
    refused(T.checkPr('chore-more'), /at landing: recurring\.json: 144 runs a day, over the cap of 100/);
  } finally { T.done(); }
});

test('A9: the cap sums exactly: 27 checks every 7h, 4 weekly chores and a 28th 7h check are 100 runs a day, accepted by ask and validate; one run more is refused (final-10b F5)', () => {
  const T = setup('exact');
  try {
    const jobs = {};
    for (let i = 0; i < 4; i++) jobs[`weekly-${i}`] = chore({ title: `w${i}` });
    for (let i = 0; i < 27; i++) jobs[`seven-${i}`] = check({ every: '7h', run: `echo ${i}` });
    T.onMain(() => jobs);
    const seven = check({ every: '7h', run: 'echo 27' });
    passes(T.ask({ recurring: { 'seven-27': seven } }));
    // with the 28th open, one more run (a weekly chore) is 101
    refused(T.ask({ recurring: { 'weekly-4': chore({ title: 'w4' }) } }), /could take the jobs to 101 runs a day, over the cap of 100/);
    T.syncMain();
    putJobs(T.old, (j) => { j['seven-27'] = seven; });
    assert.doesNotMatch(T.run(['validate']).text, /over the cap/, 'exactly 100 passes validate');
    putJobs(T.old, (j) => { j['weekly-4'] = chore({ title: 'w4' }); });
    assert.match(T.run(['validate']).text, /recurring\.json: 101 runs a day, over the cap of 100/);
    T.g(['checkout', '--', '.']);
  } finally { T.done(); }
});

test('A12: recurring apply writes exactly the answered change into the chore worktree\'s file, and nothing else', () => {
  const T = setup('apply');
  try {
    // main's jobs out of sort order: an edit keeps its place, an addition goes last
    T.onMain(() => ({ bb: chore(), aa: check() }));
    const wt = path.join(T.old, '.worktrees/chore-recurring');
    const wtJobs = path.join(wt, JOBS);
    const wtSettings = path.join(wt, `${PROJ}/settings.md`);
    const apply = (q) => T.run(['recurring', 'apply', q]);
    const change = { recurring: { aa: check({ every: '12h' }), ab: chore({ every: '2w' }) } };
    const open = T.asked(change);
    T.ok(['chore', 'start', 'recurring']);
    const settingsBefore = fs.readFileSync(wtSettings);
    refused(apply(open), /answered/);
    T.answer(open);
    const applied = apply(open);
    passes(applied);
    assert.ok(applied.out.includes('devteam.mjs chore pr recurring --title "…"'), applied.text);
    assert.ok(applied.out.includes(`devteam.mjs merge --chore recurring --approved ${open}`), applied.text);
    assert.equal(fs.readFileSync(wtJobs, 'utf8'), jobsText({ bb: chore(), aa: check({ every: '12h' }), ab: chore({ every: '2w' }) }), 'main\'s jobs with exactly the change, in the documented form');
    assert.deepEqual(fs.readFileSync(wtSettings), settingsBefore, 'settings.md is byte for byte as it was');
    // the worktree's jobs now differ from main's: a second answer can't be applied on top
    const second = T.yes({ recurring: { dd: chore() } });
    refused(apply(second), /the chore worktree's recurring\.json already differs from main's/);
    // landed: the PR merges, and the answer applies no more
    T.ok(['chore', 'pr', 'recurring', '--title', 'jobs']);
    write(path.join(T.old, 'docs/devteam/run/pr/chore-recurring.md'), '# chore-recurring: jobs\n\n## One-way doors\n\nNone.\n');
    passes(T.merge('recurring', ['--approved', open]));
    T.g(['worktree', 'remove', '--force', wt]);
    T.g(['branch', '-D', 'chore-recurring']);
    T.ok(['chore', 'start', 'recurring']);
    refused(apply(open), /already landed/);
    // once landed, the question no longer blocks its jobs: aa is asked about again
    T.asked({ recurring: { aa: check({ every: '24h' }) } });
    // declined, and another class
    const no = T.asked({ recurring: { ee: chore() } });
    T.answer(no, 'No');
    refused(apply(no), new RegExp(`${no} can't approve a job change: answered "No", not Yes`));
    const gr = T.run(['ask', '--class', 'governance-edit', '--question', 'Something else?', '--recommendation', 'Yes']);
    const gq = QID.exec(gr.out)[0];
    T.answer(gq);
    refused(apply(gq), /recurring-edit/);
    // no file on main: apply creates it
    T.g(['worktree', 'remove', '--force', wt]);
    T.g(['branch', '-D', 'chore-recurring']);
    T.onMain(() => null, 'main: no jobs file');
    T.ok(['chore', 'start', 'recurring']);
    assert.equal(fs.existsSync(wtJobs), false, 'no jobs file in the chore worktree');
    const bare = fs.readFileSync(wtSettings);
    const add = T.yes({ recurring: { ff: chore() } });
    passes(apply(add));
    assert.equal(fs.readFileSync(wtJobs, 'utf8'), jobsText({ ff: chore() }));
    assert.deepEqual(fs.readFileSync(wtSettings), bare, 'settings.md is byte for byte as it was');
  } finally { T.done(); }
});

test("A13: recurring list --json and show read main's jobs, with who registered each and the qid", () => {
  const T = setup('list');
  try {
    T.onMain(() => ({ 'by-hand': chore() }));
    T.jobsChore('recurring', (j) => { j['ci-main'] = check(); });
    const q = T.yes({ recurring: { 'ci-main': check() } });
    passes(T.merge('recurring', ['--approved', q]));
    T.syncMain();
    putJobs(T.old, (j) => { j['not-landed'] = check(); });
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
    refused(T.run(['recurring', 'show', 'not-landed'], {}), /no job not-landed on main; recurring list/);
  } finally { T.done(); }
});

test("A13: list and show give the runs a day, the cap, the registering act and the pending rows; a hand edit on main unregisters; a broken main file exits 1; outside the repo, no jobs (task-4 T4-2)", () => {
  const T = setup('list-more');
  try {
    T.jobsChore('recurring', (j) => { j['ci-main'] = check(); });
    const q = T.yes({ recurring: { 'ci-main': check() } });
    passes(T.merge('recurring', ['--approved', q]));
    const act = T.acts().find((a) => a.class === 'merge-chore' && a.approved_by === q);
    let list = json(T.ok(['recurring', 'list', '--json'], {}));
    assert.deepEqual(list.entries.map((e) => [e.name, e.runs_a_day]), [['ci-main', 4]], 'every 6h: 4 runs a day');
    assert.deepEqual(list.entries[0].registered, { qid: q, at: act.created_at, by: 'supervisor', act: act.id });
    assert.equal(list.runs_a_day, 4);
    assert.equal(list.cap, 100);
    assert.deepEqual(list.pending, []);
    // the pending rows: open, registering (a Yes not landed) and stopping (a Yes to a null), one per name
    const open = T.asked({ recurring: { tidy: chore() } });
    const reg = T.yes({ recurring: { 'ab-job': check({ every: '12h' }) } });
    const stop = T.yes({ recurring: { 'ci-main': null } });
    list = json(T.ok(['recurring', 'list', '--json'], {}));
    assert.deepEqual(list.pending, [
      { qid: open, name: 'tidy', change: chore(), status: 'open' },
      { qid: reg, name: 'ab-job', change: check({ every: '12h' }), status: 'registering' },
      { qid: stop, name: 'ci-main', change: null, status: 'stopping' },
    ]);
    const shown = json(T.ok(['recurring', 'show', 'ci-main', '--json'], {}));
    assert.equal(shown.runs_a_day, 4);
    assert.deepEqual(shown.pending, [{ qid: stop, name: 'ci-main', change: null, status: 'stopping' }]);
    assert.ok(T.ok(['recurring', 'show', 'ci-main'], {}).includes(`pending: ${stop} stopping: ci-main stop`));
    // main's entry edited by hand: no answer showed it, so it is not registered
    T.onMain((j) => { j['ci-main'] = check({ every: '12h' }); }, 'main: ci-main edited by hand');
    list = json(T.ok(['recurring', 'list', '--json'], {}));
    assert.equal(list.entries[0].registered, null);
    assert.equal(list.runs_a_day, 2);
    // a file on main that doesn't read: list and show print the read problem and exit 1
    T.onMainDo((cwd) => write(path.join(cwd, JOBS), '{ "ci-main": '), 'main: a broken jobs file');
    for (const args of [['list'], ['list', '--json'], ['show', 'ci-main']]) {
      const r = T.run(['recurring', ...args], {});
      assert.equal(r.status, 1, r.text);
      assert.match(r.text, NOT_JSON);
      assert.match(r.text, /recurring\.json at [0-9a-f]{12}: not a JSON object/);
    }
    // a project dir outside the repo: git holds no jobs file for it
    const outside = path.join(T.base, 'outside-proj');
    fs.cpSync(path.join(T.old, PROJ), outside, { recursive: true });
    const env = { DEVTEAM_PROJECT: outside };
    const ol = T.run(['recurring', 'list'], env);
    passes(ol);
    assert.equal(ol.out.trim(), 'the project dir is outside this repo, so it has no jobs');
    assert.deepEqual(json(T.ok(['recurring', 'list', '--json'], env)), { entries: [], runs_a_day: 0, cap: 100, pending: [] });
    refused(T.run(['recurring', 'show', 'ci-main'], env), /^devteam: the project dir is outside this repo, so it has no jobs$/m);
  } finally { T.done(); }
});

test('A14: supervisor.md documents registering, changing and stopping a job in recurring.json, and that none writes to production', () => {
  const doc = fs.readFileSync(path.join(kit, 'process/supervisor.md'), 'utf8');
  const at = (re) => doc.search(re);
  const s = at(/^## Recurring jobs$/m);
  assert.ok(s > at(/^## 3\. /m) && s < at(/^## 4\. /m), 'a level-2 section between §3 and §4');
  const end = doc.indexOf('\n## ', s + 1);
  const section = doc.slice(s, end);
  for (const w of ['recurring.json', 'only looks', 'recurring-edit', 'thread ask', '--from-turn', 'answer <qid> "Yes" --from-turn', 'recurring apply', 'chore start recurring', 'merge --chore recurring --approved', 'null', 'recurring propose', '--stop', 'production']) assert.ok(section.includes(w), `the section says ${w}`);
  // the move from settings lands before the upgrade or in the sync PR, and apply can't fix a broken main (final-10b F6)
  assert.match(section, /\*\*Moving jobs from settings\.\*\*[^\n]*before the upgrade[^\n]*sync PR[^\n]*asked again/);
  assert.match(section, /`recurring apply` can't fix a broken main[^\n]*up-to-date chore/);
  assert.match(section, /rebase it onto main/);
  const mon = doc.slice(at(/^### Monitoring$/m), at(/^## Recurring jobs$/m));
  assert.match(mon, /Recurring jobs/);
  const five = doc.slice(at(/^## 5\. /m), at(/^## 6\. /m));
  assert.match(five, /recurring-edit/);
  // §6's chat passage names the one question chat can't answer (final-12b F4)
  const six = doc.slice(at(/^## 6\. /m), at(/^## 7\. /m));
  const chat = six.slice(six.indexOf('**When the owner tells you in your own session.**'));
  assert.match(chat.split('\n')[0], /except a recurring-edit question, which can't be answered from chat \(see Recurring jobs\)/);
  // and §6's Threads bullet on answering from a turn names it too (final-13b F4)
  const threads = six.split('\n').find((l) => l.startsWith('- **An instruction in a thread is acted on as from chat**')) ?? '';
  assert.ok(threads.includes('--from-turn <u-id> --said "<their clause>"` (not a recurring-edit question: ask it fresh and take their Yes after it; see Recurring jobs)'), 'the Threads bullet excepts a recurring-edit question');
  // and Recurring jobs says which turn binds and which words are a Yes (final-13b F1, F3)
  assert.match(section, /the owner's next turn after the one that shows the question \(the `thread ask`, or a reply with `--refs question:<qid>`, naming no other question\), with no line of the thread between them, of any type: a reply that asks something else, even in plain words, the owner's own No, a resolve proposal \(`thread ready`\), a resolve or a reopen comes between/);
  assert.match(section, /a Yes inside quotes, or with a quotation mark of any kind right before or after it, is no Yes/);
  // and that a turn answer is refused once the owner wrote anything after it, so each answer is
  // recorded before the next question is shown (final-16b F5, d-20261121-072341505)
  assert.match(section, /refused once the owner has written anything after it in the thread \(a turn, whatever it answers, a resolve with an outcome, a reopen, or an answer to another question shown in the thread\)/);
  assert.match(section, /record each recurring-edit answer before you show the next question/);
  const q = fs.readFileSync(path.join(kit, 'governance/quality.md'), 'utf8');
  const four = q.slice(q.search(/^## 4\. /m), q.search(/^## 5\. /m));
  assert.match(four, /recurring-edit/);
  // the landing onto the checked main, and the one window GitHub leaves (final-10 F3)
  assert.match(four, /lands onto the main its checks judged \(forge git: a lease push; GitHub: a re-fetch just before `gh pr merge`, which leaves the call itself as the one window; records in home land on GitHub's current main, with no re-fetch, and their branch never touches the jobs file\)/);
  assert.match(four, /onto the main its checks judged, with no git hooks, and pushes with a lease on that main/);
  assert.doesNotMatch(four, /onto origin's main with/);
});

// ---- A15: what lands is what was judged, under every merge method ----
// One test per history and method; merge_method is set on main before the branch parts from it.
let histN = 0;
const history = (title, body, hows = HOWS) => {
  const n = ++histN;
  for (const how of hows) {
    test(`A15 ${title} (${how})`, () => {
      const T = setup(`a15-${n}-${how}`);
      try {
        if (how !== 'merge') T.onSettings((j) => { j.merge_method = how; }, `main: merge_method ${how}`);
        body(T, how);
      } finally { T.done(); }
    });
  }
};
const behind = (T, branch) => assert.throws(() => T.g(['merge-base', '--is-ancestor', 'origin/main', `origin/${branch}`]), `${branch} doesn't contain main's tip`);
// a directory of two files, distinct from each other and from anything in project/
const twoFiles = (cwd, dir) => { write(path.join(cwd, dir, 'alpha.md'), 'alpha one\nalpha two\nalpha three\nalpha four\n'); write(path.join(cwd, dir, 'beta.md'), 'beta one\nbeta two\nbeta three\nbeta four\n'); };
const moveTwo = (T, cwd, from, to) => { for (const f of ['alpha.md', 'beta.md']) T.g(['mv', `${from}/${f}`, `${to}/${f}`], cwd); };

history('cleared: an up-to-date answered chore lands exactly its answered change, merged with directory renames off', (T, how) => {
  T.onMain(() => ({ aa: check({ title: 'A job' }) }));
  T.jobsChore('up', (j) => { j.zz = ZZ; });
  refused(T.dry('up'), /recurring-edit/);
  const q = T.yes({ recurring: { zz: ZZ } });
  const spy = gitShim(T);
  passes(T.merge('up', ['--approved', q], spy.env));
  assert.deepEqual(T.mainJobs(), { aa: check({ title: 'A job' }), zz: ZZ });
  // forge git lands with directory-rename moves off, whatever the user's git config says (plan-7 P2)
  assert.match(spy.calls(), /(^| )-c merge\.directoryRenames=conflict -c commit\.cleanup=verbatim -c merge\.log=false merge --no-ff/m);
});

history('cleared: a behind PR touching only docs/other.md and project/notes.md lands, main having moved by another file', (T, how) => {
  T.onMain(() => FIVE());
  T.choreBranch('other', (wt) => { write(path.join(wt, 'docs/other.md'), 'o\n'); write(path.join(wt, NOTES), 'n\n'); });
  T.onMainFile('README.md', 'main moves\n');
  behind(T, 'chore-other');
  // docs/other.md is outside project/: a chore lands it only with an owner's answer, here a governance-edit one
  const gr = T.run(['ask', '--class', 'governance-edit', '--question', 'Should I add docs/other.md?', '--recommendation', 'Yes']);
  passes(gr);
  const gq = QID.exec(gr.out)[0];
  T.answer(gq);
  passes(T.checkPr('chore-other'));
  passes(T.dry('other', gq));
  passes(T.merge('other', ['--approved', gq]));
  assert.deepEqual(T.mainJobs(), FIVE(), 'main\'s jobs land');
  assert.equal(T.g(['show', 'origin/main:docs/other.md']), 'o');
});

history('refused: a behind chore adding a job', (T, how) => {
  T.onMain(() => FIVE());
  T.jobsChore('add', (j) => { j.zz = ZZ; });
  T.onMainFile('README.md', 'main moves\n');
  behind(T, 'chore-add');
  reaches(plainLand(T, 'chore-add', how), 'zz');
  refused(T.dry('add'), BEHIND(how));
  const q = T.yes({ recurring: { zz: ZZ } });
  refused(T.dry('add', q), BEHIND(how));
  refused(T.merge('add', ['--approved', q]), BEHIND(how));
  assert.equal(Object.hasOwn(T.mainJobs(), 'zz'), false, 'zz did not land');
});

history('refused: a behind PR touching nothing, after main landed a job (no plain-git proof: plain git lands main\'s jobs)', (T, how) => {
  T.onMain(() => FIVE());
  T.choreBranch('notes', (wt) => write(path.join(wt, NOTES), 'n\n'));
  T.onMain((j) => { j.ff = check({ title: 'F job', run: 'echo ff' }); }, 'main: a job lands');
  refused(T.dry('notes'), BEHIND(how));
  refused(T.merge('notes'), BEHIND(how));
  assert.equal(T.has('origin/main', NOTES), false, 'the PR did not land');
});

history('refused: a criss-cross, two merge bases', (T, how) => {
  T.onMain(() => FIVE());
  const wt = T.choreBranch('cx', (w) => write(path.join(w, NOTES), 'x1\n'));
  T.onMainFile(`${PROJ}/m1.md`, 'm1\n', 'm1');
  const m1 = T.g(['rev-parse', 'origin/main']);
  // main takes the chore's first commit; the chore takes m1, not main's tip; then adds zz
  T.syncMain();
  T.g(['merge', '-q', '--no-ff', '-m', 'main takes x1', 'origin/chore-cx']);
  T.pushMain();
  T.g(['merge', '-q', '--no-ff', '-m', 'the chore takes m1', m1], wt);
  T.commitIn(wt, 'chore-cx', (w) => putJobs(w, (j) => { j.zz = ZZ; }), 'add zz');
  T.g(['fetch', '-q', 'origin']);
  assert.equal(T.g(['merge-base', '--all', 'origin/main', 'origin/chore-cx']).split('\n').length, 2, 'two merge bases');
  reaches(plainLand(T, 'chore-cx', how), 'zz');
  refused(T.dry('cx'), MULTI_BASES(how));
  refused(T.merge('cx'), MULTI_BASES(how));
  assert.equal(Object.hasOwn(T.mainJobs(), 'zz'), false, 'zz did not land');
});

history('refused: the branch adds other/recurring.json while main renames other/ into project/', (T, how) => {
  T.onMainDo((cwd) => twoFiles(cwd, 'other'), 'main: other/');
  T.choreBranch('other', (wt) => write(path.join(wt, 'other/recurring.json'), jobsText({ zz: ZZ })));
  T.onMainDo((cwd) => moveTwo(T, cwd, 'other', PROJ), 'main: other/ into project/');
  reaches(plainLand(T, 'chore-other', how, { renames: true }), 'zz');
  refused(T.dry('other'), BEHIND(how));
  refused(T.merge('other'), BEHIND(how));
  assert.equal(T.has('origin/main', JOBS), false, 'no jobs file landed');
});

history('refused: the branch edits other/recurring.json while main renames other/ into project/', (T, how) => {
  T.onMainDo((cwd) => { twoFiles(cwd, 'other'); write(path.join(cwd, 'other/recurring.json'), jobsText(FIVE())); }, 'main: other/, with a recurring.json');
  T.choreBranch('other-edit', (wt) => putJson(wt, 'other/recurring.json', (j) => { j.zz = ZZ; }));
  T.onMainDo((cwd) => { moveTwo(T, cwd, 'other', PROJ); T.g(['mv', 'other/recurring.json', JOBS], cwd); }, 'main: other/ into project/');
  assert.deepEqual(T.mainJobs(), FIVE(), 'main\'s jobs file is other/recurring.json moved');
  reaches(plainLand(T, 'chore-other-edit', how, { renames: true }), 'zz');
  refused(T.dry('other-edit'), BEHIND(how));
  refused(T.merge('other-edit'), BEHIND(how));
  assert.equal(Object.hasOwn(T.mainJobs(), 'zz'), false, 'zz did not land');
});

history('refused: the branch renames other/ into project/ while main adds other/recurring.json (the mirror)', (T, how) => {
  T.onMainDo((cwd) => twoFiles(cwd, 'other'), 'main: other/');
  T.choreBranch('mirror', (wt) => moveTwo(T, wt, 'other', PROJ));
  T.onMainDo((cwd) => write(path.join(cwd, 'other/recurring.json'), jobsText({ zz: ZZ })), 'main: other/recurring.json');
  reaches(plainLand(T, 'chore-mirror', how, { renames: true }), 'zz');
  refused(T.dry('mirror'), BEHIND(how));
  refused(T.merge('mirror'), BEHIND(how));
  assert.equal(T.has('origin/main', JOBS), false, 'no jobs file landed');
});

const DRAFT = `${PROJ}/jobs-draft.json`;
history('refused: main renames another file into the jobs file while the branch edits it', (T, how) => {
  T.onMainDo((cwd) => write(path.join(cwd, DRAFT), jobsText(FIVE())), 'main: a draft');
  T.choreBranch('draft', (wt) => putJson(wt, DRAFT, (j) => { j.zz = ZZ; }));
  T.onMainDo((cwd) => T.g(['mv', DRAFT, JOBS], cwd), 'main: the draft is the jobs file');
  reaches(plainLand(T, 'chore-draft', how), 'zz');
  refused(T.dry('draft'), BEHIND(how));
  refused(T.merge('draft'), BEHIND(how));
  assert.equal(Object.hasOwn(T.mainJobs(), 'zz'), false, 'zz did not land');
});

history('refused: the branch renames another file into the jobs file while main edits it', (T, how) => {
  T.onMainDo((cwd) => write(path.join(cwd, DRAFT), jobsText(FIVE())), 'main: a draft');
  T.choreBranch('draft', (wt) => T.g(['mv', DRAFT, JOBS], wt));
  T.onMainDo((cwd) => putJson(cwd, DRAFT, (j) => { j.zz = ZZ; }), 'main: the draft edited');
  reaches(plainLand(T, 'chore-draft', how), 'zz');
  refused(T.dry('draft'), BEHIND(how));
  refused(T.merge('draft'), BEHIND(how));
  assert.equal(T.has('origin/main', JOBS), false, 'no jobs file landed');
});

const ASIDE = `${PROJ}/jobs-aside.json`;
history('refused: main copies the jobs file away and back while the branch edits the copy', (T, how) => {
  T.onMain(() => FIVE());
  const before = T.g(['rev-parse', `origin/main:${JOBS}`]);
  // copied away (both paths hold it), then the jobs file removed: the branch parts here
  T.onMainDo((cwd) => fs.copyFileSync(path.join(cwd, JOBS), path.join(cwd, ASIDE)), 'main: the jobs copied aside');
  assert.equal(T.g(['rev-parse', `origin/main:${ASIDE}`]), before, 'a byte copy beside the jobs file');
  T.onMainDo((cwd) => fs.rmSync(path.join(cwd, JOBS)), 'main: the jobs file removed, the copy kept');
  T.choreBranch('aside', (wt) => putJson(wt, ASIDE, (j) => { j.zz = ZZ; }));
  // copied back from the aside file, which main then removes
  T.onMainDo((cwd) => { fs.copyFileSync(path.join(cwd, ASIDE), path.join(cwd, JOBS)); fs.rmSync(path.join(cwd, ASIDE)); }, 'main: the jobs copied back');
  // unlike the renamed draft: this path held the jobs before, and main's file is the same blob again
  assert.equal(T.g(['rev-parse', `origin/main:${JOBS}`]), before, 'main\'s jobs file is the one it had before the copy');
  const mb = T.g(['merge-base', 'origin/main', 'origin/chore-aside']);
  assert.equal(T.has(mb, JOBS), false, 'the base has no jobs file');
  assert.equal(T.g(['rev-parse', `${mb}~1:${JOBS}`]), before, 'the base\'s parent had it');
  reaches(plainLand(T, 'chore-aside', how), 'zz');
  refused(T.dry('aside'), BEHIND(how));
  refused(T.merge('aside'), BEHIND(how));
  assert.equal(Object.hasOwn(T.mainJobs(), 'zz'), false, 'zz did not land');
});

history('refused: main renames old/recurring.json into the jobs file and breaks it; the branch adds a byte copy of the broken file and edits the old path (plan-7 P1)', (T, how) => {
  const OLD = `${PROJ}/old/recurring.json`;
  const broken = jobsText(FIVE()).replace(/\n\}\n$/, '\n');
  T.onMainDo((cwd) => write(path.join(cwd, OLD), jobsText(FIVE())), 'main: old/recurring.json');
  T.choreBranch('copy', (wt) => { write(path.join(wt, JOBS), broken); putJson(wt, OLD, (j) => { j.zz = ZZ; }); });
  T.onMainDo((cwd) => { T.g(['mv', OLD, JOBS], cwd); fs.writeFileSync(path.join(cwd, JOBS), broken); }, 'main: old/recurring.json into the jobs file, broken');
  assert.equal(T.g(['rev-parse', `origin/chore-copy:${JOBS}`]), T.g(['rev-parse', `origin/main:${JOBS}`]), 'the head\'s file is main\'s broken one');
  reaches(plainLand(T, 'chore-copy', how), 'zz');
  refused(T.dry('copy'), BEHIND(how));
  refused(T.merge('copy'), BEHIND(how));
  assert.equal(T.g(['show', `origin/main:${JOBS}`]).includes('"zz"'), false, 'zz did not land');
});

history('refused: é/recurring.json carried into project/ by a directory rename (names read with -z)', (T, how) => {
  T.onMainDo((cwd) => twoFiles(cwd, 'é'), 'main: é/');
  T.choreBranch('accent', (wt) => write(path.join(wt, 'é/recurring.json'), jobsText({ zz: ZZ })));
  T.onMainDo((cwd) => moveTwo(T, cwd, 'é', PROJ), 'main: é/ into project/');
  reaches(plainLand(T, 'chore-accent', how, { renames: true }), 'zz');
  refused(T.dry('accent'), BEHIND(how));
  refused(T.merge('accent'), BEHIND(how));
  assert.equal(T.has('origin/main', JOBS), false, 'no jobs file landed');
});

history('refused: the branch adds docs/devteam/project/recurring.json/x', (T, how) => {
  T.choreBranch('dir', (wt) => write(path.join(wt, JOBS, 'x'), jobsText({ zz: ZZ })));
  T.onMainFile('README.md', 'main moves\n');
  const pl = plainLand(T, 'chore-dir', how);
  assert.equal(pl.conflict, false, pl.why);
  assert.equal(pl.entry?.type, 'tree', 'plain git lands a directory at the jobs file');
  // spec step 1 runs first: the head's jobs file doesn't read (a directory), so that is the refusal
  refused(T.dry('dir'), NOT_REGULAR);
  refused(T.merge('dir'), NOT_REGULAR);
  assert.equal(T.has('origin/main', JOBS), false, 'nothing landed at the jobs file');
});

history('refused: the branch makes docs/devteam/project a symlink, with no jobs file at the base', (T, how) => {
  T.choreBranch('link', (wt) => { fs.renameSync(path.join(wt, PROJ), path.join(wt, 'docs/devteam/proj-real')); fs.symlinkSync('proj-real', path.join(wt, PROJ)); });
  T.onMainFile('README.md', 'main moves\n');
  const pl = plainLand(T, 'chore-link', how);
  assert.equal(pl.conflict, false, pl.why);
  assert.equal(pl.parent?.mode, '120000', 'plain git lands a link at the project dir');
  // spec step 1 runs first: the head's project dir is not a directory, so that is the refusal
  refused(T.dry('link'), NOT_DIR);
  refused(T.merge('link'), NOT_DIR);
  assert.match(T.g(['ls-tree', 'origin/main', '--', PROJ]), /^040000 tree /, 'the project dir is still a directory');
});

history('refused: the branch moves project/ away while main adds the jobs file', (T, how) => {
  T.choreBranch('away', (wt) => T.g(['mv', PROJ, 'docs/devteam/moved'], wt));
  T.onMain(() => ({ zz: ZZ }), 'main: a job');
  // with directory renames on, main's file follows the move: its job stops, with no answer
  const pl = plainLand(T, 'chore-away', how, { renames: true });
  assert.equal(pl.conflict, false, pl.why);
  assert.equal(pl.entry, null, 'plain git lands no jobs file');
  assert.ok(pl.has('docs/devteam/moved/recurring.json'), 'main\'s file lands elsewhere');
  refused(T.dry('away'), BEHIND(how));
  refused(T.merge('away'), BEHIND(how));
  assert.deepEqual(T.mainJobs(), { zz: ZZ }, 'main\'s job stays');
});

history('refused under rebase: a merge commit since main (no plain-git proof: a rebase drops the merge)', (T, how) => {
  T.onMain(() => FIVE());
  const wt = T.choreBranch('mc', (w) => write(path.join(w, NOTES), 'n\n'));
  T.onMainFile('README.md', 'main moves\n');
  T.mergeMainInto(wt, 'chore-mc');
  refused(T.dry('mc'), REBASE_MERGES);
  refused(T.merge('mc'), REBASE_MERGES);
}, ['rebase']);

history('refused under rebase: a behind branch whose commits add the jobs file and then delete it (no plain-git proof)', (T, how) => {
  const wt = T.jobsChore('flip', (j) => { j.zz = ZZ; });
  T.commitIn(wt, 'chore-flip', (w) => fs.rmSync(path.join(w, JOBS)), 'and delete it');
  T.onMainFile('README.md', 'main moves\n');
  assert.equal(T.has('origin/chore-flip', JOBS), false, 'the head has no jobs file');
  refused(T.dry('flip'), BEHIND(how));
  refused(T.merge('flip'), BEHIND(how));
}, ['rebase']);

// the user's git config can't hide a name from the scan (T3-3): diff.relative with merge run from
// docs/, and diff.ignoreSubmodules=all, while a commit puts a gitlink at the project dir and the next
// puts the directory back
history('refused under rebase: with diff.relative and diff.ignoreSubmodules=all, a behind branch whose commits make docs/devteam/project a gitlink and then a directory again', (T, how) => {
  T.g(['config', 'diff.relative', 'true']);
  T.g(['config', 'diff.ignoreSubmodules', 'all']);
  const wt = T.choreBranch('subflip', (w) => {
    T.g(['rm', '-r', '-q', '--cached', PROJ], w);
    T.g(['update-index', '--add', '--cacheinfo', `160000,${T.g(['rev-parse', 'HEAD'], w)},${PROJ}`], w);
  }, { add: false });
  assert.match(T.g(['ls-tree', 'origin/chore-subflip', '--', PROJ]), /^160000 commit /, 'a gitlink at the project dir');
  T.g(['rm', '-q', '--cached', PROJ], wt);
  T.commitIn(wt, 'chore-subflip', () => {}, 'and back');
  T.onMainFile('README.md', 'main moves\n');
  assert.match(T.g(['ls-tree', 'origin/chore-subflip', '--', PROJ]), /^040000 tree /, 'the head\'s project dir is a directory');
  // the kit run from docs/, where diff.relative would print names relative to it
  const sub = spawnSync(process.execPath, [path.join(T.old, 'docs/devteam/scripts/devteam.mjs'), 'merge', '--chore', 'subflip', '--dry-run'], { cwd: path.join(T.old, 'docs'), env: { ...process.env, ...SUP }, encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
  refused({ status: sub.status, text: `${sub.stdout}\n${sub.stderr}` }, BEHIND(how));
  refused(T.dry('subflip'), BEHIND(how));
}, ['rebase']);

// the two above whose head refuses on its own (step 1), here with the head clean again: only the
// commit scan sees the path under the jobs file, or the project dir turned into a link
history('refused under rebase: a behind branch whose commits add docs/devteam/project/recurring.json/x and then delete it (no plain-git proof)', (T, how) => {
  const wt = T.choreBranch('dirflip', (w) => write(path.join(w, JOBS, 'x'), jobsText({ zz: ZZ })));
  T.commitIn(wt, 'chore-dirflip', (w) => fs.rmSync(path.join(w, JOBS), { recursive: true }), 'and delete it');
  T.onMainFile('README.md', 'main moves\n');
  assert.equal(T.has('origin/chore-dirflip', JOBS), false, 'the head has nothing at the jobs file');
  refused(T.dry('dirflip'), BEHIND(how));
  refused(T.merge('dirflip'), BEHIND(how));
}, ['rebase']);

history('refused under rebase: a behind branch whose commits make docs/devteam/project a symlink and then a directory again (no plain-git proof)', (T, how) => {
  const real = 'docs/devteam/proj-real';
  const wt = T.choreBranch('linkflip', (w) => { fs.renameSync(path.join(w, PROJ), path.join(w, real)); fs.symlinkSync('proj-real', path.join(w, PROJ)); });
  T.commitIn(wt, 'chore-linkflip', (w) => { fs.unlinkSync(path.join(w, PROJ)); fs.renameSync(path.join(w, real), path.join(w, PROJ)); }, 'and back');
  T.onMainFile('README.md', 'main moves\n');
  assert.match(T.g(['ls-tree', 'origin/chore-linkflip', '--', PROJ]), /^040000 tree /, 'the head\'s project dir is a directory');
  refused(T.dry('linkflip'), BEHIND(how));
  refused(T.merge('linkflip'), BEHIND(how));
}, ['rebase']);

test('A16: settings.md holds no jobs: no default, no words, and validate reads the jobs file of the project dir in use', () => {
  const T = setup('settings');
  try {
    // loadSettings' defaults, as settings prints them
    assert.equal(Object.hasOwn(json(T.ok(['settings'], {})), 'recurring'), false, 'settings has no recurring');
    const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
    const block = (start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('\n}', i)); };
    assert.doesNotMatch(block('const SETTINGS_DEFAULTS = {'), /\n {2}recurring:/, 'SETTINGS_DEFAULTS has no recurring');
    assert.doesNotMatch(block('const SETTINGS_WORDS = Object.freeze({'), /\n {2}recurring:/, 'the settings words don\'t list it');
    assert.doesNotMatch(src, /loadSettings\(\)\.recurring|settings\.recurring\b/, 'nothing reads the jobs from settings');
    // kit-161's validate cases, from the file
    putJobs(T.old, () => ({ 'ci-main': check({ every: '6h', fail: { exit: 'nonzero' }, timeout_s: 1800 }), 'tidy-branches': chore({ every: '1w', on: 'mon', at: '09:00' }) }));
    const good = T.run(['validate']);
    passes(good);
    assert.doesNotMatch(good.text, /recurring\.json/);
    putJobs(T.old, (j) => { j['half-hourly'] = check({ every: '30m' }); });
    const bad = T.run(['validate']);
    refused(bad, /^error: recurring\.json half-hourly\.every: /m);
    assert.doesNotMatch(bad.text, /recurring\.json ci-main/, 'the valid entry beside it is not named');
    // the project dir moved (DEVTEAM_PROJECT): validate reads that dir's recurring.json, not the default's
    fs.rmSync(path.join(T.old, JOBS));
    fs.cpSync(path.join(T.old, PROJ), path.join(T.old, 'docs/proj'), { recursive: true });
    write(path.join(T.old, 'docs/proj/recurring.json'), jobsText({ pp: check({ every: '30m' }) }));
    putJobs(T.old, () => ({ dd: check({ every: '30m' }) }));
    const moved = T.run(['validate'], { ...SUP, DEVTEAM_PROJECT: path.join(T.old, 'docs/proj') });
    refused(moved, /^error: recurring\.json pp\.every: /m);
    assert.doesNotMatch(moved.text, /recurring\.json dd\./, 'the default dir\'s file is not read');
    // check-pr reads the moved dir's jobs file through git (read(ref) follows projectRel): a chore
    // adding a bad job to docs/proj/recurring.json is refused at landing there, and passes as a
    // plain file under the default dir
    fs.rmSync(path.join(T.old, JOBS));
    fs.rmSync(path.join(T.old, 'docs/proj/recurring.json'));
    T.onMainDo(() => {}, 'main: docs/proj, a copy of the project dir');
    T.choreBranch('proj-jobs', (wt) => write(path.join(wt, 'docs/proj/recurring.json'), jobsText({ pp: check({ every: '30m' }) })));
    const head = T.headOf('chore-proj-jobs');
    const cpr = (env) => T.run(['check-pr', '--head-ref', 'chore-proj-jobs', '--sha', head, '--title', 'chore-proj-jobs: jobs'], { ...SUP, ...env });
    refused(cpr({ DEVTEAM_PROJECT: path.join(T.old, 'docs/proj') }), /^(fail: )?at landing: recurring\.json pp\.every: /m);
    assert.doesNotMatch(cpr({}).text, /recurring\.json pp\./, 'the default dir reads no job from docs/proj');
    // a project dir outside the repo: git holds no jobs file for it, so validate refuses one there
    const outside = path.join(T.base, 'outside-proj');
    fs.cpSync(path.join(T.old, PROJ), outside, { recursive: true });
    write(path.join(outside, 'recurring.json'), jobsText({ oo: check() }));
    refused(T.run(['validate'], { ...SUP, DEVTEAM_PROJECT: outside }), /the project dir is outside this repo: its recurring\.json is never read/);
  } finally { T.done(); }
});

test('A16: git failing is never read as no jobs, and a jobs file this checkout can\'t read is a problem, not a throw (task-2 T2-1, T2-3)', () => {
  const T = setup('read-fails');
  try {
    T.onMain(() => ({ aa: check() }));
    // a git whose tree reads (cat-file -p) fail: ask refuses, and check-pr's landing fails closed
    const dir = path.join(T.base, 'git-catfile-fails');
    write(path.join(dir, 'git'), `#!/bin/sh\ncase " $* " in *" cat-file -p "*) echo "fatal: the test's git fails" >&2; exit 128 ;; esac\nexec "${REAL_GIT}" "$@"\n`);
    fs.chmodSync(path.join(dir, 'git'), 0o755);
    const env = { PATH: `${dir}${path.delimiter}${process.env.PATH}` };
    const a = T.run(['ask', '--class', 'recurring-edit', '--question', 'Should I add this job?', '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { bb: chore() } })], { ...SUP, ...env });
    refused(a, /recurring\.json: couldn't read main's jobs \(recurring\.json at [0-9a-f]{12}: git cat-file failed, so the kit can't read the jobs\); try again/);
    T.choreBranch('notes', (wt) => write(path.join(wt, NOTES), 'n\n'));
    const c = T.run(['check-pr', '--head-ref', 'chore-notes', '--sha', T.headOf('chore-notes'), '--title', 'chore-notes: jobs'], { ...SUP, ...env });
    refused(c, /recurring\.json at [0-9a-f]{12}: git cat-file failed, so the kit can't read the jobs/);
    passes(T.checkPr('chore-notes'));
    // only main's reads fail (cat-file -p of main's trees), the head's read: landing refuses on main's
    // own failure, never reading it as a broken file or no jobs (T3-4)
    const mainSha = T.headOf('main');
    const only = path.join(T.base, 'git-main-fails');
    write(path.join(only, 'git'), `#!/bin/sh\ncase " $* " in *" cat-file -p ${mainSha}:"*) echo "fatal: the test's git fails on main" >&2; exit 128 ;; esac\nexec "${REAL_GIT}" "$@"\n`);
    fs.chmodSync(path.join(only, 'git'), 0o755);
    const onlyEnv = { PATH: `${only}${path.delimiter}${process.env.PATH}` };
    const m = T.run(['check-pr', '--head-ref', 'chore-notes', '--sha', T.headOf('chore-notes'), '--title', 'chore-notes: jobs'], { ...SUP, ...onlyEnv });
    refused(m, new RegExp(`recurring\\.json at ${mainSha.slice(0, 12)}: git cat-file failed, so the kit can't read the jobs`));
    assert.doesNotMatch(m.text, /main's recurring\.json doesn't read/, 'a git failure on main is not a broken file');
    refused(T.merge('notes', ['--dry-run'], onlyEnv), new RegExp(`recurring\\.json at ${mainSha.slice(0, 12)}: git cat-file failed`));
  } finally { T.done(); }
});

test('A16: a git call that prints more than the kit reads (ENOBUFS) is told apart from a timeout (final-11b F2)', () => {
  const T = setup('enobufs');
  try {
    T.onMain(() => ({ aa: check() }));
    const dir = path.join(T.base, 'git-prints-much');
    write(path.join(dir, 'git'), `#!/bin/sh\ncase " $* " in *" cat-file -s "*) yes 1234567 | head -c 70000000; exit 0 ;; esac\nexec "${REAL_GIT}" "$@"\n`);
    fs.chmodSync(path.join(dir, 'git'), 0o755);
    const l = T.run(['recurring', 'list'], { ...SUP, PATH: `${dir}${path.delimiter}${process.env.PATH}` });
    refused(l, /recurring\.json at [0-9a-f]{12}: git cat-file printed more than the 64 MiB the kit reads, so the kit can't read the jobs/);
    assert.doesNotMatch(l.text, /timed out/);
  } finally { T.done(); }
});

test('A16: a jobs file this checkout can\'t read (EACCES) is a validate problem, not a throw (task-2 T2-3)', (t) => {
  // root reads a mode-000 file, so there is no EACCES to see
  if (process.getuid?.() === 0) { t.skip('running as root: a mode-000 file still reads'); return; }
  const T = setup('eacces');
  try {
    T.onMain(() => ({ aa: check() }));
    T.syncMain();
    fs.chmodSync(path.join(T.old, JOBS), 0o000);
    try { refused(T.run(['validate']), /recurring\.json in this checkout: can't read it \(EACCES\)/); } finally { fs.chmodSync(path.join(T.old, JOBS), 0o644); }
  } finally { T.done(); }
});

test('A16: a jobs file in this checkout over the kit\'s size bound is a validate problem, checked on its size before it is read (final-12b F5)', () => {
  const T = setup('bigwork');
  try {
    const SMALL = { ...SUP, DEVTEAM_RECURRING_MAX_BYTES: '4096' };
    write(path.join(T.old, JOBS), `{"aa":"${'x'.repeat(8000)}"}\n`);
    refused(T.run(['validate'], SMALL), /recurring\.json in this checkout: 8010 bytes, over the kit's bound of 4096; no jobs file needs that/);
    // at the bound it reads (and is refused only for its shape): exactly 4096 bytes; one byte more is over (final-13b F6)
    const body = (n) => { const head = '{"aa":"'; const tail = '"}\n'; return `${head}${'x'.repeat(n - head.length - tail.length)}${tail}`; };
    write(path.join(T.old, JOBS), body(4096));
    assert.equal(fs.statSync(path.join(T.old, JOBS)).size, 4096);
    assert.doesNotMatch(T.run(['validate'], SMALL).text, /over the kit's bound/);
    write(path.join(T.old, JOBS), body(4097));
    refused(T.run(['validate'], SMALL), /recurring\.json in this checkout: 4097 bytes, over the kit's bound of 4096/);
  } finally { T.done(); }
});
