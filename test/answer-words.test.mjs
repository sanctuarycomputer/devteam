// An answer is the option picked plus the words typed (kit-313): answer --choice records the pick
// beside the words, answer --in-words records words alone, which approve nothing until the
// supervisor reads them (answer --read … --cite … --class …), and questionView checks any reading
// itself, never trusting a supervisor line that fails its checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture, monoFixture, multiFixture, write, json, hasTmux, until } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const RATE = ['--stake', '1', '--urgency', '1'];
const YN = JSON.stringify([{ label: 'Yes' }, { label: 'No' }]);
const firstId = (s) => s.split('\n')[0].trim();
// Distinct words for each question, so the kit's re-ask refusal never takes one for another.
const TEXTS = ['Should checkout move to the new pricing page before launch?', 'Do invoices go out on the first business day of each month?', 'Can refunds skip the manual review queue under fifty dollars?', 'Will the mobile app share the web login cookie?', 'Must exports include archived customers by default?', 'Is dark mode worth shipping ahead of the holiday freeze?', 'Should trial accounts keep their data after ninety days?', 'May the support team see partial card numbers?', 'Does the onboarding tour replay after every major release?', 'Could weekly digests replace the daily summary email?', 'Ought the status page show maintenance windows a week ahead?', 'Should failed webhooks retry for a full day?', 'Are team invitations limited to verified domains?', 'Would a yearly plan discount of twenty percent hurt margins?', 'Shall the legacy API stay up until spring?', 'Should search index deleted projects for thirty days?', 'Can admins impersonate users without a ticket?', 'Do we localise receipts into French and German first?', 'Is single sign-on included on the starter tier?', 'Should usage alerts fire at eighty percent of quota?', 'Do contractors get read access to the billing dashboard?', 'Should the changelog email go to every workspace admin?', 'Can a workspace hold more than one custom domain?', 'Will the free tier keep its API rate limit next year?', 'Should archived boards stay searchable for a year?', 'Do guests see the comment history on shared docs?', 'Can billing contacts change the plan without an admin?', 'Should the desktop app update itself overnight?'];

// A ready goal read from a repo check, approved by the owner (as goal-met.test.mjs's first test).
function readyGoal(F) {
  write(path.join(F.old, 'gaps.txt'), '0\n');
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'gaps'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  const G = F.ok(F.old, ['goal', 'add', '--title', 'Floor repo', '--outcome', 'the floor holds', '--measure', 'floor gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'cat gaps.txt', '--non-goals', 'none', '--preconditions', 'a', 'b'], SUP);
  F.ok(F.old, ['goal', 'decide', G, 'approve', '--force']);
  F.ok(F.old, ['goal', 'reading', G, '--run'], SUP);
  return G;
}

test('the answer line records the pick beside the words, and words alone wait for a reading the view checks', () => {
  const F = threadsFixture('answer-words');
  const run = (args, role = {}) => F.run(F.old, args, role);
  const refused = (args, re, role = {}) => { const r = run(args, role); assert.notEqual(r.status, 0, `${args.join(' ')} should fail: ${r.out}`); assert.match(`${r.err}\n${r.out}`, re, args.join(' ')); };
  let n = 0;
  const text = () => TEXTS[n++];
  const gc = () => { const t = text(); return firstId(F.sup(['ask', '--class', 'goal-change', '--goal', F.goal, '--change', JSON.stringify({ title: `X${n}` }), '--question', t, '--recommendation', 'Yes', '--choices', YN, ...RATE])); };
  const plain = (...more) => firstId(F.sup(['ask', '--question', text(), '--recommendation', 'Yes', '--choices', YN, ...RATE, ...more]));
  const view = (q) => json(F.owner(['questions', '--id', q, '--json']))[0];
  const lines = () => fs.readdirSync(F.logDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).sort((a, b) => a.at.localeCompare(b.at));
  const answerLine = (q) => lines().filter((l) => l.id === q && l.by === 'owner' && l.answer !== undefined).pop();
  const approve = (q) => run(['goal', 'set', F.goal, '--approved', q], SUP);
  try {
    // the goal is running, so the fold holds every goal set to its goal-change answer too
    F.owner(['goal', 'decide', F.goal, 'approve', '--force']);

    // 1. a pick plus words: the pick as the set spells it, the words after it
    const Q1 = gc();
    F.owner(['answer', Q1, 'cheaper', '--choice', 'yes']);
    assert.deepEqual([answerLine(Q1).choice, answerLine(Q1).answer], ['Yes', 'Yes — cheaper']);
    let v = view(Q1);
    assert.deepEqual([v.matched, v.label, v.words, v.in_words, v.agreed_by_owner, v.read_by], [true, 'Yes', 'cheaper', false, true, null]);
    assert.deepEqual(v.labels, ['Yes', 'No']);
    assert.equal(approve(Q1).status, 0, 'a pick of the recommendation approves');

    // 2. a pick with no words: the label alone, not doubled; a pick of No approves nothing
    const Q2 = gc();
    F.owner(['answer', Q2, '--choice', 'No']);
    assert.deepEqual([answerLine(Q2).choice, answerLine(Q2).answer], ['No', 'No']);
    v = view(Q2);
    assert.deepEqual([v.matched, v.label, v.words, v.agreed_by_owner], [false, 'No', '', false]);
    refused(['goal', 'set', F.goal, '--approved', Q2], /not its recommendation/, SUP);

    // 3. words alone, even the recommendation's own word: no pick, nothing matched
    const Q3 = gc();
    F.owner(['answer', Q3, 'Yes', '--in-words']);
    assert.deepEqual([answerLine(Q3).choice, answerLine(Q3).answer], [null, 'Yes']);
    v = view(Q3);
    assert.deepEqual([v.matched, v.in_words, v.label, v.words, v.reading, v.read_by, v.agreed_by_owner], [false, true, null, 'Yes', null, null, false]);
    refused(['goal', 'set', F.goal, '--approved', Q3], /not its recommendation/, SUP);

    // 9. a line with neither flag (the terminal, chat, a turn): no choice key, judged as before
    const Q9 = gc();
    F.owner(['answer', Q9, 'Yes — fine']);
    assert.equal(Object.hasOwn(answerLine(Q9), 'choice'), false);
    v = view(Q9);
    assert.deepEqual([v.matched, v.label, v.choice, v.words, v.in_words, v.agreed_by_owner], [true, 'Yes', null, null, null, true]);
    assert.equal(approve(Q9).status, 0, 'an older line approves as before');

    // 5. the supervisor reads the words: its act in the question's class, then the reading
    F.sup(['answer', Q3, '--read', 'Yes', '--cite', 'Yes', '--class', 'goal-change']);
    const act = lines().filter((l) => l.type === 'act' && (l.refs ?? []).includes(Q3)).pop();
    assert.equal(act.class, 'goal-change');
    assert.equal(act.by, 'supervisor');
    assert.deepEqual(act.refs, [Q3]);
    assert.match(act.what, /\("Yes"\)/);
    const set = lines().filter((l) => l.id === Q3 && l.reading).pop();
    assert.deepEqual(set.reading, { choice: 'Yes', cite: 'Yes', class: 'goal-change', of: answerLine(Q3).at, act: act.id });
    assert.ok(set.at > act.at, 'the act first, then the reading');
    v = view(Q3);
    assert.deepEqual([v.matched, v.read_by, v.label, v.agreed_by_owner, v.in_words], [true, 'supervisor', 'Yes', false, true]);
    assert.equal(approve(Q3).status, 0, 'a read answer approves');
    refused(['answer', Q3, '--read', 'Yes', '--cite', 'Yes', '--class', 'goal-change'], /already read/, SUP);

    // 4. what --read refuses, each with its own words
    const Q4 = gc();
    F.owner(['answer', Q4, 'yes, rename it', '--in-words']);
    const read = (q, label, cite, cls) => ['answer', q, '--read', label, '--cite', cite, '--class', cls];
    refused(read(Q4, 'Yes', 'yes', 'goal-change'), /the supervisor does this/, { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-01-y' });
    refused(read(Q4, 'Yes', 'yes', 'owner-decision'), /--class owner-decision: .*asked in goal-change/, SUP);
    refused(read(Q4, 'Yes', 'Nope', 'goal-change'), /--cite "Nope" is not .*whole words/, SUP);
    refused(read(Q4, 'Yes', 'es', 'goal-change'), /--cite "es" is not .*whole words/, SUP);
    refused(read(Q4, 'Maybe', 'yes', 'goal-change'), /"Maybe" is not one of .*choices \(Yes, No\)/, SUP);
    refused(read(Q1, 'Yes', 'cheaper', 'goal-change'), /answered with a pick \("Yes"\)/, SUP);
    refused(read(Q9, 'Yes', 'fine', 'goal-change'), /carries no pick/, SUP);
    const Qopen = gc();
    refused(read(Qopen, 'Yes', 'yes', 'goal-change'), /not answered/, SUP);
    refused([...read(Q4, 'Yes', 'yes', 'goal-change'), '--choice', 'Yes'], /--read .*not with --choice/, SUP);
    const Qorder = firstId(F.sup(['ask', '--class', 'goal-order', '--question', text(), '--recommendation', 'Yes', '--choices', YN, ...RATE]));
    F.owner(['answer', Qorder, 'yes that order', '--in-words']);
    refused(read(Qorder, 'Yes', 'yes', 'goal-order'), /goal-order acts are the owner's/, SUP);
    assert.equal(view(Q4).reading, null, 'nothing refused wrote a reading');
    assert.equal(lines().some((l) => l.type === 'act' && (l.refs ?? []).includes(Q4)), false, 'nor an act');

    // 10. nothing on silence: a question with a default, unanswered, has no words to read
    const Qdef = plain('--class', 'release-scope', '--reasons', 'below-rung', '--default', 'Yes');
    refused(read(Qdef, 'Yes', 'Yes', view(Qdef).class), /not answered/, SUP);
    // a goal-met question is answered by a pick: words alone are refused, and the pick decides it
    const G = readyGoal(F);
    const Qmet = firstId(F.sup(['ask', '--class', 'goal-met', '--goal', G, '--recommendation', 'yes']));
    refused(['answer', Qmet, 'yes', '--in-words'], /pick Yes or No/);
    assert.equal(view(Qmet).status, 'open');
    assert.match(F.owner(['answer', Qmet, 'looks done', '--choice', 'Yes']), new RegExp(`${G} is met`));
    assert.equal(answerLine(Qmet).answer, 'Yes — looks done');

    // 11. the flags: each refusal names what it refuses
    const Qf = plain('--no-default', 'the test waits for the owner');
    refused(['answer', Qf, '--choice', 'Maybe'], /--choice "Maybe" is not one of .*choices \(Yes, No\)/);
    refused(['answer', Qf, 'x', '--choice', 'Yes', '--in-words'], /--choice or --in-words, not both/);
    refused(['answer', Qf, '--in-words'], /--in-words: .*words/);
    refused(['answer', Qf, '--choice'], /--choice "<label>"/);
    refused(['answer', Qf, 'Yes', '--choice', 'Yes', '--from-chat', '--said', 'x'], /--choice .*not with --from-chat/, SUP);
    refused(['answer', Qf, 'Yes', '--choice', 'Yes', '--from-turn', 'u-20261119-000000000-owner'], /--choice .*not with --from-turn/, SUP);
    refused(['answer', Qf, '--choice', 'Yes', '--defaulted'], /--choice .*not with --defaulted/, SUP);
    refused(['answer', Qf, 'why', '--in-words', '--decline'], /--in-words .*not with --decline/);
    refused(['answer', Qf, '--choice', 'Yes', '--review-result', '-'], /--choice .*not with --review-result/);
    write(path.join(F.old, 'review/page.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Check it</title></head><body><p>Look.</p></body></html>\n');
    F.g(['add', '-A'], F.old);
    F.g(['commit', '-qm', 'review page'], F.old);
    const Qrev = firstId(F.sup(['ask', '--kind', 'review', '--question', 'Does the page look right?', '--ref', 'main', '--page', 'review/page.html', ...RATE]));
    const { question: Qgoal } = F.approval();
    const Qsec = firstId(F.sup(['ask', '--kind', 'owner-action', '--question', 'Post the API key', '--secrets', JSON.stringify([{ name: 'KEY', sink: 'file:secrets/key.txt' }]), ...RATE]));
    for (const [q, what] of [[Qrev, 'review'], [Qgoal, 'goal approval'], [Qsec, 'secrets question']]) {
      refused(['answer', q, '--choice', 'Yes'], new RegExp(`--choice: .*is an? ${what}`));
      refused(['answer', q, 'fine', '--in-words'], new RegExp(`--in-words: .*is an? ${what}`));
    }
    assert.deepEqual([Qf, Qrev, Qgoal, Qsec].map((q) => view(q).status), ['open', 'open', 'open', 'open'], 'nothing refused answered');

    // words alone cited for an approval: the refusal says to read them
    const draft = F.sup(['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site']);
    const Ql = /q-[0-9]+-[0-9]+-supervisor/.exec(draft)[0];
    F.owner(['answer', Ql, 'yes', '--in-words']);
    refused(['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site', '--approved', Ql], new RegExp(`${Ql} was answered in the owner's own words \\("yes"\\), not a choice: read them with answer ${Ql} --read .*--class governance-edit`), SUP);

    // 17. the owner corrects the reading's act: the reading is void at once, and what was done on it stands
    const goalTitle = () => json(F.owner(['goal', 'show', F.goal, '--json'])).title;
    assert.equal(goalTitle(), 'X3', "case 5's goal set gave the goal Q3's title");
    F.owner(['correct', act.id, '--reason', 'misread']);
    const voids = lines().filter((l) => l.type === 'question' && l.id === Q3 && l.reading_void !== undefined);
    assert.deepEqual(voids.map((l) => [l.reading_void, l.by]), [[act.id, 'owner']], 'the correction voids the reading, as the owner');
    v = view(Q3);
    assert.deepEqual([v.matched, v.read_by, v.reading, v.label], [false, null, null, null]);
    assert.equal(goalTitle(), 'X3', 'the goal set made on the reading still folds');
    assert.equal(run(['log-check']).status, 0, run(['log-check']).err);
    // a fresh goal-change read, then corrected: it approves nothing
    const Q7b = gc();
    F.owner(['answer', Q7b, 'yes, rename it', '--in-words']);
    F.sup(['answer', Q7b, '--read', 'Yes', '--cite', 'yes', '--class', 'goal-change']);
    assert.equal(view(Q7b).matched, true);
    F.owner(['correct', view(Q7b).reading.act, '--reason', 'misread']);
    assert.equal(view(Q7b).matched, false);
    refused(['goal', 'set', F.goal, '--approved', Q7b], /not its recommendation|own words/, SUP);
    // the owner corrects A1 and answers again; the supervisor reads again (A2), then withdraws A2 at a retro
    const Q7c = gc();
    F.owner(['answer', Q7c, 'go ahead', '--in-words']);
    F.sup(['answer', Q7c, '--read', 'Yes', '--cite', 'go ahead', '--class', 'goal-change']);
    const A1 = view(Q7c).reading.act;
    F.owner(['correct', A1, '--reason', 'misread']);
    assert.equal(view(Q7c).reading, null);
    F.hand('owner', { type: 'question', op: 'set', id: Q7c, answer: 'yes, go', choice: null, question_hash: view(Q7c).hash, channel: 'dashboard' }, 0);
    assert.deepEqual([view(Q7c).answer, view(Q7c).in_words, view(Q7c).matched], ['yes, go', true, false]);
    F.sup(['answer', Q7c, '--read', 'Yes', '--cite', 'yes', '--class', 'goal-change']);
    const A2 = view(Q7c).reading.act;
    assert.notEqual(A2, A1);
    assert.equal(view(Q7c).matched, true);
    F.sup(['correct', A2, '--retro', '--reason', 'x']);
    const withdrawn = lines().filter((l) => l.type === 'question' && l.id === Q7c && (l.reading_withdrawn !== undefined || l.reading_void !== undefined));
    assert.deepEqual(withdrawn.map((l) => [l.reading_void ?? null, l.reading_withdrawn ?? null, l.by]), [[A1, null, 'owner'], [null, A2, 'supervisor']], 'the owner voids A1, the supervisor withdraws A2');
    assert.deepEqual([view(Q7c).matched, view(Q7c).read_by], [false, null]);
    refused(['goal', 'set', F.goal, '--approved', Q7c], /not its recommendation|own words/, SUP);

    // 13. everything the kit wrote checks
    assert.equal(run(['log-check']).status, 0, run(['log-check']).err);

    // 6. readings written by hand: the view checks each itself, and the first valid one counts
    const snap = F.snapLog();
    try {
      const fake = 'a-20261119-000000000-supervisor';
      const inWords = () => { const q = plain('--no-default', 'the test waits for the owner'); F.owner(['answer', q, 'yes please', '--in-words']); return q; };
      const hand = (q, r) => F.hand('supervisor', { type: 'question', op: 'set', id: q, reading: r }, 0);
      const good = (q) => ({ choice: 'Yes', cite: 'yes please', class: 'owner-decision', of: view(q).answered_at, act: fake });
      const qok = inWords();
      hand(qok, good(qok));
      assert.deepEqual([view(qok).matched, view(qok).label, view(qok).read_by], [true, 'Yes', 'supervisor'], 'a reading that passes every check counts (its act is not looked up)');
      for (const [why, change] of [
        ['wrong class', { class: 'goal-change' }],
        ['cite not in the words', { cite: 'no thanks' }],
        ['cite splitting a word', { cite: 'es pleas' }],
        ['cite in another case', { cite: 'Yes Please' }],
        ['label not in the set', { choice: 'Maybe' }],
        ['of an older answer', { of: '2026-01-01T00:00:00.000Z' }],
        ['no act', { act: undefined }],
      ]) {
        const q = inWords();
        hand(q, JSON.parse(JSON.stringify({ ...good(q), ...change })));
        const w = view(q);
        assert.deepEqual([w.matched, w.label, w.read_by, w.reading], [false, null, null, null], why);
      }
      // a cite is at most 600 characters: 120 words (599) count, 121 (604) don't
      const long = Array.from({ length: 150 }, () => 'word').join(' ');
      for (const [k, counts] of [[120, true], [121, false]]) {
        const q = plain('--no-default', 'the test waits for the owner');
        F.owner(['answer', q, long, '--in-words']);
        hand(q, { ...good(q), cite: long.split(' ').slice(0, k).join(' ') });
        assert.equal(view(q).read_by, counts ? 'supervisor' : null, `a cite of ${k} words`);
      }
      // a reading of an answer that has a pick counts for nothing (check 2)
      const qp = plain('--no-default', 'the test waits for the owner');
      F.owner(['answer', qp, 'yes please', '--choice', 'Yes']);
      hand(qp, { ...good(qp), choice: 'No' });
      assert.deepEqual([view(qp).reading, view(qp).read_by, view(qp).label], [null, null, 'Yes'], 'a pick is never read');
      // two readings: the first valid one counts, a later one with another label doesn't
      const q2 = inWords();
      F.sup(['answer', q2, '--read', 'Yes', '--cite', 'yes  please', '--class', 'owner-decision']);
      hand(q2, { ...good(q2), choice: 'No', cite: 'please' });
      assert.deepEqual([view(q2).label, view(q2).matched, view(q2).reading.choice], ['Yes', true, 'Yes']);
      // a reading voided by the owner, or withdrawn by the supervisor, no longer counts (check 6)
      const qv = inWords();
      F.sup(['answer', qv, '--read', 'Yes', '--cite', 'yes please', '--class', 'owner-decision']);
      const aid = view(qv).reading.act;
      F.hand('owner', { type: 'question', op: 'set', id: qv, reading_void: aid }, 0);
      assert.deepEqual([view(qv).matched, view(qv).read_by], [false, null], 'voided');
      const qw = inWords();
      F.sup(['answer', qw, '--read', 'Yes', '--cite', 'yes please', '--class', 'owner-decision']);
      F.hand('supervisor', { type: 'question', op: 'set', id: qw, reading_withdrawn: view(qw).reading.act }, 0);
      assert.deepEqual([view(qw).matched, view(qw).read_by], [false, null], 'withdrawn');
      // and a void named by the wrong writer's field counts for nothing
      const qx = inWords();
      F.sup(['answer', qx, '--read', 'Yes', '--cite', 'yes please', '--class', 'owner-decision']);
      F.hand('supervisor', { type: 'question', op: 'set', id: qx, reading_void: view(qx).reading.act }, 0);
      assert.equal(view(qx).matched, true, "the supervisor can't write the owner's void");
    } finally { F.restoreLog(snap); }
    assert.equal(run(['log-check']).status, 0);
  } finally { F.done(); }
});

test('a door answered in words approves its plan only once read; a pick approves it at once', () => {
  const F = monoFixture('answer-words-door');
  const { old, g } = F;
  try {
    const door = (id, question) => {
      F.ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'high', serves: [], depends_on: [], touches: ['api/**'], done_when: ['its suite passes in CI'], notes: 'n', one_way_doors: ['move the data'] })], SUP);
      const w = path.join(old, '.worktrees', id);
      g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/main'], old);
      const tdir = path.join(w, 'docs/devteam/project/tickets', id);
      write(path.join(tdir, 'spec.md'), '# spec\n');
      write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- move the data in one step\n\n## T1\n\n- a step\n');
      g(['add', '-A'], w);
      g(['commit', '-qm', `${id}: plan`], w);
      g(['push', '-q', 'origin', `ticket/${id}`], w);
      F.ok(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'spec ok'], SUP);
      return firstId(F.ok(old, ['ask', '--kind', 'one-way-door', '--ticket', id, '--question', question, '--choices', YN, '--recommendation', 'Yes', ...RATE], SUP));
    };
    const plan = (id, q) => F.run(old, ['act', '--class', 'approve-plan', '--approved', q, '--refs', id, '--', 'plan ok'], SUP);
    const A = 'api-01-words';
    const QA = door(A, 'Move the order data to the new database in one cutover?');
    F.ok(old, ['answer', QA, 'later maybe', '--in-words']);
    const r = plan(A, QA);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, /not its recommendation/);
    F.ok(old, ['answer', QA, '--read', 'Yes', '--cite', 'later maybe', '--class', 'one-way-door'], SUP);
    const a = plan(A, QA);
    assert.equal(a.status, 0, a.err);
    const B = 'api-02-pick';
    const QB = door(B, 'Drop the legacy invoices table after the export lands?');
    F.ok(old, ['answer', QB, 'go', '--choice', 'Yes']);
    const b = plan(B, QB);
    assert.equal(b.status, 0, b.err);
  } finally { F.done(); }
});

test('settles_if reads the pick: a pick settles, words alone settle nothing', { skip: hasTmux ? false : 'needs tmux' }, async () => {
  const F = threadsFixture('answer-words-settles');
  try {
    const pane = F.standIn();
    for (const n of ['supervisor-pane', 'supervisor-pane-role']) fs.writeFileSync(path.join(F.old, 'docs/devteam/run', n), pane.target);
    const pair = (t, s) => {
      const Qt = firstId(F.sup(['ask', '--question', t, '--goal', F.goal, '--recommendation', 'Yes', '--choices', YN, ...RATE]));
      const Qs = firstId(F.sup(['ask', '--question', s, '--goal', F.goal, '--recommendation', 'Yes', '--choices', YN, '--settles', Qt, '--settles-if', 'Yes', '--stake', '3', '--urgency', '1']));
      return Qs;
    };
    const Qs1 = pair(TEXTS[0], TEXTS[1]);
    F.owner(['answer', Qs1, 'ok', '--choice', 'Yes']);
    await until(() => new RegExp(`\\[devteam answer ${Qs1} from owner\\][^\\n]*settles 1 open question`).test(pane.typed()), 'the settles note for the pick');
    const Qs2 = pair(TEXTS[2], TEXTS[3]);
    F.owner(['answer', Qs2, 'Yes', '--in-words']);
    const said = await until(() => pane.typed().split(/[\r\n]+/).find((l) => l.includes(`[devteam answer ${Qs2} from owner]`)), 'the nudge for the words');
    assert.doesNotMatch(said, /settles/, 'words alone settle nothing');
  } finally { F.done(); }
});

test('link --approved reads the label: words alone are refused until read, then the reading approves; a pick approves at once', () => {
  const F = multiFixture('answer-words-link');
  const { old, okIn, runIn } = F;
  const add = (id) => ['link', 'add', id, '--kind', 'repo', '--remote', `usbclub/${id}`, '--title', `${id} site`];
  const has = (id) => new RegExp(`"${id}"`).test(fs.readFileSync(path.join(old, 'docs/devteam/project/settings.md'), 'utf8'));
  try {
    const Q = /q-[0-9]+-[0-9]+-supervisor/.exec(okIn(old, add('docs'), SUP))[0];
    // words that say yes and more: the old split of the answer text would never read them as yes
    okIn(old, ['answer', Q, 'yes, add the docs repo', '--in-words']);
    const r = runIn(old, [...add('docs'), '--approved', Q], SUP);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, /answered in the owner's own words .*--read/);
    assert.equal(has('docs'), false, 'nothing written');
    const cls = json(okIn(old, ['questions', '--id', Q, '--json']))[0].class;
    okIn(old, ['answer', Q, '--read', 'yes', '--cite', 'yes', '--class', cls], SUP);
    okIn(old, [...add('docs'), '--approved', Q], SUP);
    assert.equal(has('docs'), true, 'the read answer approves the link');
    const Q2 = /q-[0-9]+-[0-9]+-supervisor/.exec(okIn(old, add('handbook'), SUP))[0];
    okIn(old, ['answer', Q2, 'go on then', '--choice', 'yes']);
    okIn(old, [...add('handbook'), '--approved', Q2], SUP);
    assert.equal(has('handbook'), true, 'a pick approves the link');
  } finally { F.done(); }
});

test("trust counts the owner's own agreement: a pick counts, words read or unread stay out", () => {
  const F = threadsFixture('answer-words-trust');
  const view = (q) => json(F.owner(['questions', '--id', q, '--json']))[0];
  try {
    const cls = 'release-scope';
    const row = () => json(F.owner(['trust', '--json'])).find((r) => r.class === cls);
    assert.ok(row(), `${cls} is a ladder class trust lists`);
    // distinct words and subjects for each, so the kit's re-ask refusal never takes one for another
    const ask = (t) => firstId(F.sup(['ask', '--class', cls, '--question', t, '--reasons', 'below-rung', '--recommendation', 'Yes', '--choices', YN, '--default', 'Yes', ...RATE]));
    const picked = ask(TEXTS[0]);
    F.owner(['answer', picked, 'ship it', '--choice', 'Yes']);
    const read = ask(TEXTS[5]);
    F.owner(['answer', read, 'yes, ship it', '--in-words']);
    F.sup(['answer', read, '--read', 'Yes', '--cite', 'yes', '--class', cls]);
    assert.equal(view(read).matched, true, 'the reading makes it match');
    const unread = ask(TEXTS[10]);
    F.owner(['answer', unread, 'Yes', '--in-words']);
    const r = row();
    assert.deepEqual(r.agreement_questions, [picked], 'words alone, read or not, are out of the window');
    assert.equal(r.agreement, 1);
  } finally { F.done(); }
});

test('asking again what the owner answered in their own words says to read them', () => {
  const F = threadsFixture('answer-words-reask');
  try {
    const args = ['ask', '--class', 'owner-decision', '--question', TEXTS[3], '--recommendation', 'Yes', '--choices', YN, ...RATE];
    const Q16 = firstId(F.sup(args));
    F.owner(['answer', Q16, 'sure, fine', '--in-words']);
    const r = F.run(F.old, args, SUP);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, /in their own words/);
    assert.match(r.err, /--read/);
    assert.match(r.err, new RegExp(`answer ${Q16} --read`));
  } finally { F.done(); }
});
