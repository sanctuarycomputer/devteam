// Answers in words (kit-313): the answer line, parts 1 and 2: a pick, words alone, readings, refusals, the flags.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { firstId, RATE, SUP, TEXTS, YN } from './lib/answer-words-fixture.mjs';
import { json, threadsFixture, write } from './lib/kit.mjs';

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

test('the answer line records the pick beside the words, and words alone wait for a reading the view checks (1 of 3: a pick, words alone, a reading, its refusals and its correction)', () => {
  const F = threadsFixture('answer-words');
  const run = (args, role = {}) => F.run(F.old, args, role);
  const refused = (args, re, role = {}) => { const r = run(args, role); assert.notEqual(r.status, 0, `${args.join(' ')} should fail: ${r.out}`); assert.match(`${r.err}\n${r.out}`, re, args.join(' ')); };
  let n = 0;
  const text = () => TEXTS[n++];
  const gc = () => { const t = text(); return firstId(F.sup(['ask', '--class', 'goal-change', '--goal', F.goal, '--change', JSON.stringify({ title: `X${n}` }), '--question', t, '--recommendation', 'Yes', '--choices', YN, ...RATE])); };
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
    // the owner's correction said in chat: the supervisor's process records it, so the supervisor withdraws (task-2 T2-1)
    const Q7d = gc();
    F.owner(['answer', Q7d, 'yes, fine', '--in-words']);
    F.sup(['answer', Q7d, '--read', 'Yes', '--cite', 'yes', '--class', 'goal-change']);
    const A3 = view(Q7d).reading.act;
    F.sup(['correct', A3, '--from-chat', '--said', 'That is not what I meant.']);
    const heard = lines().filter((l) => l.type === 'question' && l.id === Q7d && (l.reading_withdrawn !== undefined || l.reading_void !== undefined));
    assert.deepEqual(heard.map((l) => [l.reading_void ?? null, l.reading_withdrawn ?? null, l.by]), [[null, A3, 'supervisor']], 'withdrawn by the supervisor, never an owner line it wrote');
    assert.deepEqual([view(Q7d).matched, view(Q7d).read_by], [false, null]);
    // correcting an act that is no reading writes no void (task-2 T2-3)
    const Qn = gc();
    const other = firstId(F.sup(['act', '--class', 'worker-slots', '--refs', Qn, '--', 'tidied']));
    F.owner(['correct', other, '--reason', 'not this']);
    assert.equal(lines().filter((l) => l.type === 'question' && l.id === Qn && (l.reading_withdrawn !== undefined || l.reading_void !== undefined)).length, 0, 'no void for an act that is no reading');

    // 13. everything the kit wrote checks
    assert.equal(run(['log-check']).status, 0, run(['log-check']).err);
  } finally { F.done(); }
});

test('the answer line records the pick beside the words, and words alone wait for a reading the view checks (2 of 3: silence, a goal-met question, the flags)', () => {
  const F = threadsFixture('answer-words');
  const run = (args, role = {}) => F.run(F.old, args, role);
  const refused = (args, re, role = {}) => { const r = run(args, role); assert.notEqual(r.status, 0, `${args.join(' ')} should fail: ${r.out}`); assert.match(`${r.err}\n${r.out}`, re, args.join(' ')); };
  let n = 0;
  const text = () => TEXTS[n++];
  const plain = (...more) => firstId(F.sup(['ask', '--question', text(), '--recommendation', 'Yes', '--choices', YN, ...RATE, ...more]));
  const view = (q) => json(F.owner(['questions', '--id', q, '--json']))[0];
  const lines = () => fs.readdirSync(F.logDir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).sort((a, b) => a.at.localeCompare(b.at));
  const answerLine = (q) => lines().filter((l) => l.id === q && l.by === 'owner' && l.answer !== undefined).pop();
  try {
    // the goal is running, so the fold holds every goal set to its goal-change answer too
    F.owner(['goal', 'decide', F.goal, 'approve', '--force']);

    const read = (q, label, cite, cls) => ['answer', q, '--read', label, '--cite', cite, '--class', cls];

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

    assert.equal(run(['log-check']).status, 0, run(['log-check']).err);
  } finally { F.done(); }
});
