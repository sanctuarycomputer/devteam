// Answers in words (kit-313): readings written by hand, and what a pick or words approve elsewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { firstId, RATE, SUP, TEXTS, YN } from './lib/answer-words-fixture.mjs';
import { hasTmux, json, monoFixture, multiFixture, threadsFixture, until, write } from './lib/kit.mjs';

test('the answer line records the pick beside the words, and words alone wait for a reading the view checks (3 of 3: readings written by hand)', () => {
  const F = threadsFixture('answer-words');
  const run = (args, role = {}) => F.run(F.old, args, role);
  let n = 0;
  const text = () => TEXTS[n++];
  const plain = (...more) => firstId(F.sup(['ask', '--question', text(), '--recommendation', 'Yes', '--choices', YN, ...RATE, ...more]));
  const view = (q) => json(F.owner(['questions', '--id', q, '--json']))[0];
  try {
    // the goal is running, so the fold holds every goal set to its goal-change answer too
    F.owner(['goal', 'decide', F.goal, 'approve', '--force']);

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
    F.ok(old, ['answer', QA, 'yes, go ahead with it', '--in-words']);
    const r = plan(A, QA);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.err, /not its recommendation/);
    F.ok(old, ['answer', QA, '--read', 'Yes', '--cite', 'yes, go ahead', '--class', 'one-way-door'], SUP);
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
