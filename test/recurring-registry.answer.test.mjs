// The job registry's answers (kit-162, the A5 tests; split from test/recurring-registry.test.mjs by
// d-20261121-084623830, so each file runs well inside its CI limit): a recurring-edit answer approves a
// job change only as the owner's own Yes, in a whole owner turn right after the turn that shows the
// question, in the same thread, and never once the owner has written again after it; a line planted
// some other way, on another channel or against other words lands nothing. Each test is a fixture repo
// with a bare origin, run through the kit's commands.
// Run with TMUX unset: no fixture here starts or stops a tmux server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json } from './lib/kit.mjs';
import { QID, ZZ, check, setup, refused, passes } from './fixtures/recurring-registry/shared.mjs';

test('A5: another class, a standing rule, or a question changed after its answer approves nothing', () => {
  const T = setup('other-answers');
  try {
    // the owner's standing rule, for a project that put recurring-edit in owner_rules
    const cf = path.join(T.old, 'docs/devteam/governance/constitution.md');
    T.onMainDo(() => fs.writeFileSync(cf, fs.readFileSync(cf, 'utf8').replace('"owner_rules": ["gate-change"]', '"owner_rules": ["gate-change", "recurring-edit"]')), 'owner rules');
    T.ok(['knowledge', 'add', '--kind', 'preference', '--statement', 'Add any job you like.', '--scope', 'class:recurring-edit', '--owner'], {});
    T.jobsChore('add', () => ({ 'ci-main': check() }));
    refused(T.dry('add'), /recurring-edit/);
    for (const cls of ['governance-edit', 'new-feature']) {
      const r = T.run(['ask', '--class', cls, '--question', { 'governance-edit': 'Should I change how the project is governed?', 'new-feature': 'Should I start a new feature?' }[cls], '--recommendation', 'Yes', ...(cls === 'new-feature' ? ['--no-default', 'only the owner starts one'] : [])]);
      passes(r);
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
    // answered in words, then asked again about the same job: the words can't be read as Yes
    // (final-10b F2), and the first approves nothing, in words or superseded
    const first = T.asked({ recurring: { 'ci-main': check() } });
    T.ok(['answer', first, 'maybe, let me think', '--in-words'], {});
    T.asked({ recurring: { 'ci-main': check({ every: '12h' }) } });
    refused(T.run(['answer', first, '--read', 'Yes', '--cite', 'maybe', '--class', 'recurring-edit']), /only the owner's own pick of Yes approves a job change/);
    refused(T.dry('add', first), /answered in the owner's own words \("maybe, let me think"\), not a choice: only the owner's own pick of Yes approves a job change/);
    // a secrets question of the class (ask refuses one; written here by hand) answered "Posted": no Yes, so it approves nothing
    const sq = 'q-20990101-000000001-supervisor';
    fs.appendFileSync(T.logFile('supervisor'), `${JSON.stringify({ v: 1, type: 'question', op: 'new', id: sq, at: new Date().toISOString(), by: 'supervisor', kind: 'owner-action', class: 'recurring-edit', question: 'Post the key for the job?', recommendation: 'Yes', secrets: [{ name: 'API_KEY', sink: 'rails-credentials:test:api.key' }], change: { recurring: { 'ci-main': check() } } })}\n`);
    T.ok(['answer', sq, 'Posted 1 secret'], {});
    refused(T.dry('add', sq), /can't approve a job change: answered/);
    T.ok(['chore', 'start', 'recurring']);
    refused(T.run(['recurring', 'apply', sq]), new RegExp(`${sq} can't approve a job change: answered "Posted 1 secret", not Yes`));
  } finally { T.done(); }
});

test('A5: a recurring-edit answer counts only as the owner\'s own pick: answer --read is refused, and a reading line already in the log lands nothing (final-10b F2)', () => {
  const T = setup('reading');
  try {
    const q = T.asked({ recurring: { aa: check() } });
    T.ok(['answer', q, 'No, never add it', '--in-words'], {});
    refused(T.run(['answer', q, '--read', 'Yes', '--cite', 'add it', '--class', 'recurring-edit']), new RegExp(`${q} is a recurring-edit question: only the owner's own pick of Yes approves a job change, never a reading of their words`));
    // a reading line written some other way (an older kit, a hand edit): the view reads it as Yes,
    // and still nothing lands on it
    const answeredAt = json(T.ok(['questions', '--id', q, '--json']))[0].answered_at;
    fs.appendFileSync(T.logFile('supervisor'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: q, at: new Date().toISOString(), by: 'supervisor', reading: { choice: 'Yes', cite: 'add it', class: 'recurring-edit', of: answeredAt, act: 'a-20990101-000000001-supervisor' } })}\n`);
    assert.equal(json(T.ok(['questions', '--id', q, '--json']))[0].matched, true, 'the view takes the reading');
    T.jobsChore('read', () => ({ aa: check() }));
    // merge refuses words before the binding; apply reaches live itself, which ignores the reading
    const words = new RegExp(`${q} was answered in the owner's own words \\("No, never add it"\\), not a choice: only the owner's own pick of Yes approves a job change`);
    refused(T.dry('read', q), words);
    refused(T.merge('read', ['--approved', q]), words);
    assert.equal(Object.hasOwn(T.mainJobs(), 'aa'), false, 'no job landed');
    T.ok(['chore', 'start', 'recurring']);
    refused(T.run(['recurring', 'apply', q]), new RegExp(`${q} can't approve a job change`));
  } finally { T.done(); }
});

test('A5: a recurring-edit answer is never recorded from chat, and from a turn only when the owner\'s words there start with Yes; such a line already in the log lands nothing (final-11b F1)', () => {
  const T = setup('chat-turn');
  try {
    const plant = (q, fields) => fs.appendFileSync(T.logFile('owner'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: q, at: new Date().toISOString(), by: 'owner', answer: 'Yes', ...fields })}\n`);
    // H1: the owner said No in chat; the supervisor records Yes from chat: refused
    const q = T.asked({ recurring: { aa: check() } });
    refused(T.run(['answer', q, 'Yes', '--from-chat', '--said', 'No, never add it']), new RegExp(`${q} is a recurring-edit question: only the owner's own Yes approves a job change, never words recorded from chat`));
    // a chat line written some other way (an older kit, a hand edit) is not the owner's own Yes
    const other = QID.exec(T.run(['ask', '--question', 'Tidy the branches?', '--recommendation', 'Yes']).out)[0];
    T.ok(['answer', other, 'Yes'], {});
    plant(q, { channel: 'chat', said: 'No, never add it' });
    assert.equal(json(T.ok(['questions', '--id', q, '--json']))[0].matched, true, 'the view takes the line');
    T.jobsChore('chat', () => ({ aa: check() }));
    refused(T.merge('chat', ['--approved', q]), new RegExp(`${q} can't approve a job change: answered from chat`));
    assert.equal(Object.hasOwn(T.mainJobs(), 'aa'), false, 'no job landed');
    // H6: in a thread, the owner says No; Yes recorded from that turn is refused, and so is a turn
    // whose words don't start with the label Yes (any case: final-12b F3)
    const bb = check({ title: 'bb job', run: 'echo bb' });
    const tid = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const q2 = QID.exec(T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', 'Add bb?', '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { bb } })]).out)[0];
    for (const words of ['No, never add it', 'Yesterday I said no', 'Sure. Yes, add it', 'No, yes later', '"No", yes later']) {
      const u = T.ok(['thread', 'say', tid, words], {}).split('\n')[0];
      refused(T.run(['answer', q2, 'Yes', '--from-turn', u]), new RegExp(`--from-turn ${u}: ${q2} is a recurring-edit question, and the owner's words there don't start with Yes`));
    }
    assert.equal(json(T.ok(['questions', '--id', q2, '--json']))[0].status, 'open');
    // a turn line of that kind already in the log is not the owner's own Yes either
    const q3 = T.asked({ recurring: { cc: check({ title: 'cc job', run: 'echo cc' }) } });
    plant(q3, { channel: 'thread', said: 'No, never add it', turn: 'u-20990101-000000001-owner' });
    T.jobsChore('turn-no', () => ({ cc: check({ title: 'cc job', run: 'echo cc' }) }));
    refused(T.merge('turn-no', ['--approved', q3]), new RegExp(`${q3} can't approve a job change: answered from u-20990101-000000001-owner, whose words don't start with Yes`));
    // shown again, the owner's "Yes, add it" right after it is accepted, and the job lands (final-13b F1)
    T.ok(['thread', 'reply', tid, `About ${q2}: shall I add bb?`, '--refs', `question:${q2}`]);
    const yes = T.ok(['thread', 'say', tid, 'Yes, add it'], {}).split('\n')[0];
    passes(T.run(['answer', q2, 'Yes', '--from-turn', yes]));
    T.jobsChore('turn', () => ({ bb }));
    passes(T.merge('turn', ['--approved', q2]));
    assert.deepEqual(T.mainJobs(), { bb }, 'the job the owner said Yes to landed, and nothing else');
  } finally { T.done(); }
});

test('A5: a recurring-edit answer is a whole owner turn newer than the question: a --said clause and thread ask --turn are refused, and such a line already in the log lands nothing (final-12b F1)', () => {
  const T = setup('turn-clause');
  try {
    const plant = (q, fields) => fs.appendFileSync(T.logFile('owner'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: q, at: new Date().toISOString(), by: 'owner', answer: 'Yes', channel: 'thread', ...fields })}\n`);
    const tid = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const say = (w) => T.ok(['thread', 'say', tid, w], {}).split('\n')[0];
    const tAsk = (name, extra = []) => T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', `Add ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: check({ title: `${name} job`, every: '1h', run: 'echo evil' }) } }), ...extra]);
    const qOf = (r) => { passes(r); return QID.exec(r.out)[0]; };
    const SAID = (q) => new RegExp(`${q} is a recurring-edit question: only a whole owner turn newer than the question approves a job change, never a clause of one \\(--said\\)`);
    // H1: the owner's "Yes, add a nightly disk check.", written before any question
    const early = say('Yes, add a nightly disk check.');
    refused(tAsk('disk', ['--turn', early]), /thread ask --turn: a recurring-edit question is never asked about an earlier turn/);
    const q1 = qOf(tAsk('disk'));
    refused(T.run(['answer', q1, 'Yes', '--from-turn', early, '--said', 'Yes, add a nightly disk check.']), SAID(q1));
    refused(T.run(['answer', q1, 'Yes', '--from-turn', early]), /the turn is older than/);
    // H1b: the same after the owner's later No, with that No read
    const no = say('No, not hourly, and not that command.');
    refused(T.run(['answer', q1, 'Yes', '--from-turn', early, '--said', 'Yes, add a nightly disk check.', '--seen-turn', no]), SAID(q1));
    refused(T.run(['answer', q1, 'Yes', '--from-turn', no]), /don't start with Yes/);
    // H2: a No turn whose later clause starts with Yes
    const q2 = qOf(tAsk('mem'));
    const h2 = say('No. Yes would be wrong here.');
    refused(T.run(['answer', q2, 'Yes', '--from-turn', h2, '--said', 'Yes would be wrong here.']), SAID(q2));
    for (const q of [q1, q2]) assert.equal(json(T.ok(['questions', '--id', q, '--json']))[0].status, 'open', `${q} stays open`);
    // lines of those kinds already in the log approve nothing at merge: a clause (said_at) of a
    // newer Yes turn, and a whole Yes turn older than the question
    plant(q1, { said: 'Yes, add a nightly disk check.', turn: early });
    T.jobsChore('older', () => ({ disk: check({ title: 'disk job', every: '1h', run: 'echo evil' }) }));
    refused(T.merge('older', ['--approved', q1]), new RegExp(`${q1} can't approve a job change: answered from ${early}, which isn't newer than the question`));
    const later = say('Yes. But only nightly.');
    plant(q2, { said: 'Yes.', turn: later, said_at: [0, 4], answer_seen: later });
    T.jobsChore('clause', () => ({ mem: check({ title: 'mem job', every: '1h', run: 'echo evil' }) }));
    refused(T.merge('clause', ['--approved', q2]), new RegExp(`${q2} can't approve a job change: answered from a clause of ${later} \\(said_at\\), which approves no job change`));
    assert.deepEqual(T.mainJobs(), {}, 'no job landed');
  } finally { T.done(); }
});

test('A5: the owner\'s Yes in a turn is read as --choice reads a label: any case, never inside or next to a quotation mark of any kind (final-14b F4, final-15b F5, final-16b F3, final-17b F6), then the end, a space or . , !, and no invisible characters (final-12b F3, final-13b F3)', () => {
  const T = setup('turn-case');
  try {
    const tid = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const jobs = {};
    ['Yes', 'yes, add it', 'YES!', 'Yes. Don\u2019t wait'].forEach((words, i) => {
      const name = `y${i}`;
      const job = check({ title: `${name} job`, run: `echo ${name}` });
      const q = QID.exec(T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', `Add ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: job } })]).out)[0];
      const u = T.ok(['thread', 'say', tid, words], {}).split('\n')[0];
      passes(T.run(['answer', q, 'Yes', '--from-turn', u]));
      T.jobsChore(name, (j) => ({ ...j, [name]: job }));
      passes(T.merge(name, ['--approved', q]));
      jobs[name] = job;
    });
    assert.deepEqual(T.mainJobs(), jobs, 'each Yes landed its own job');
    // the long s (U+017F) folds to s under a case-insensitive regex; it is not the label
    const tid2 = T.ok(['thread', 'new', 'More?', '--title', 'More'], {}).split('\n')[0];
    const q = QID.exec(T.run(['thread', 'ask', tid2, '--class', 'recurring-edit', '--question', 'Add zz?', '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { zz: ZZ } })]).out)[0];
    for (const words of ['Ye\u017f', 'No, yes later', '"No" yes', "'yes' please", '"Yes" is what you want me to say. No.', '\u201cYes\u201d? No.', '\u00abYes\u00bb no', 'Yes\u200bterday', 'Yes\u00adterday', 'Yes\u2060no', 'Yes\u0301', 'Yesterday', 'Yes\u2019m no', 'Yes \u2060no', 'Yes, add it\u0301', '"Yes, sure', '"Yes," you want me to say. "No."', '"Yes." He wants that. I say "no"', '\u201cYes,\u201d you say. \u201cNo.\u201d', '"Yes,\u201d you said. \u201cNo."', '\u201cYes," you say. "No.\u201d', "'Yes, don't wait'", '\u00abYes, \u2018no\u2019\u00bb', '"Yes, you say \u2018no\u2019"',
      // any quotation mark, inside a pair or next to the Yes (final-16b F3), and a pair alone
      '"Yes,\u201e you said. \u201eNo."', '"Yes, \u2039no\u203a"', '"Yes,\uff02 you said. \uff02No."', '"Yes,\u300c you said \u300dNo."', '"Yes,\u2033 you said. \u2033No."',
      'Yes,\u201e you said', 'Yes\u2033 no', '\u300cYes\u300d', 'Yes.\u201d', '"Yes"', '\u201cYes.\u201d',
      // the reversed primes and the backtick, used as quote marks too (final-17b F6)
      'Yes,\u2036 you said. \u2036No.', 'Yes,` you said. `No.', '\u2037Yes\u2037 no', '`Yes`']) {
      const u = T.ok(['thread', 'say', tid2, words], {}).split('\n')[0];
      refused(T.run(['answer', q, 'Yes', '--from-turn', u]), /don't start with Yes/);
    }
  } finally { T.done(); }
});

test('A5: a recurring-edit answer binds only the owner\'s first turn right after the supervisor\'s turn that shows the question; such a line already in the log lands nothing (final-13b F1)', () => {
  const T = setup('turn-first');
  try {
    const plant = (q, fields) => fs.appendFileSync(T.logFile('owner'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: q, at: new Date().toISOString(), by: 'owner', answer: 'Yes', channel: 'thread', ...fields })}\n`);
    const ev = check({ title: 'ev job', every: '1h', run: 'echo evil' });
    const tAsk = (tid, name, job) => { const r = T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', `Add ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: job } })]); passes(r); return QID.exec(r.out)[0]; };
    const FIRST = (u, q) => new RegExp(`--from-turn ${u}: ${q} is a recurring-edit question, and that turn isn't the owner's first right after your turn that shows it`);
    const PLANTED = (q, u) => new RegExp(`${q} can't approve a job change: answered from ${u}, which isn't the owner's first turn right after the supervisor's turn that shows the question`);
    // X1: the owner's No to q1, then the supervisor asks q2, and the owner's Yes is to q2
    const t1 = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const say1 = (w) => T.ok(['thread', 'say', t1, w], {}).split('\n')[0];
    const q1 = tAsk(t1, 'ev', ev);
    say1('No, not that one, never.');
    const q2 = QID.exec(T.run(['thread', 'ask', t1, '--question', 'Shall I merge kit-200 now?', '--recommendation', 'Yes']).out)[0];
    const yes1 = say1('Yes');
    refused(T.run(['answer', q1, 'Yes', '--from-turn', yes1]), FIRST(yes1, q1));
    assert.equal(json(T.ok(['questions', '--id', q1, '--json']))[0].status, 'open', 'q1 stays open');
    plant(q1, { said: 'Yes', turn: yes1 });
    T.jobsChore('x1', () => ({ ev }));
    refused(T.merge('x1', ['--approved', q1]), PLANTED(q1, yes1));
    // X2: q3 asked in the Inbox and named in a thread; the owner's No, then a reply asking something else, then Yes
    const ev3 = check({ title: 'ev3 job', every: '1h', run: 'echo evil3' });
    const q3 = T.asked({ recurring: { ev3 } });
    const t2 = T.ok(['thread', 'new', 'More jobs?', '--title', 'More jobs'], {}).split('\n')[0];
    T.ok(['thread', 'reply', t2, `About ${q3}: shall I add ev3?`, '--refs', `question:${q3}`]);
    T.ok(['thread', 'say', t2, 'No.'], {});
    T.ok(['thread', 'reply', t2, 'OK. Shall I tidy branches?']);
    const yes2 = T.ok(['thread', 'say', t2, 'Yes'], {}).split('\n')[0];
    refused(T.run(['answer', q3, 'Yes', '--from-turn', yes2]), FIRST(yes2, q3));
    plant(q3, { said: 'Yes', turn: yes2 });
    T.jobsChore('x2', () => ({ ev3 }));
    refused(T.merge('x2', ['--approved', q3]), PLANTED(q3, yes2));
    // a reply that names another question comes between the showing turn and the Yes
    const ev4 = check({ title: 'ev4 job', every: '1h', run: 'echo evil4' });
    const q4 = tAsk(t2, 'ev4', ev4);
    T.ok(['thread', 'reply', t2, `And ${q2}?`, '--refs', `question:${q2}`]);
    const yes4 = T.ok(['thread', 'say', t2, 'Yes'], {}).split('\n')[0];
    refused(T.run(['answer', q4, 'Yes', '--from-turn', yes4]), FIRST(yes4, q4));
    assert.deepEqual(T.mainJobs(), {}, 'no job landed');
    // the plain case: the question shown, and the owner's next turn says Yes; it lands
    const ok = check({ title: 'ok job', run: 'echo ok' });
    const q5 = tAsk(t2, 'ok', ok);
    const yes5 = T.ok(['thread', 'say', t2, 'Yes'], {}).split('\n')[0];
    passes(T.run(['answer', q5, 'Yes', '--from-turn', yes5]));
    T.jobsChore('plain', () => ({ ok }));
    passes(T.merge('plain', ['--approved', q5]));
    // and an Inbox question named by a reply, then the owner's Yes: accepted
    const q6 = T.asked({ recurring: { ev6: ok } });
    T.ok(['thread', 'reply', t2, `About ${q6}?`, '--refs', `question:${q6}`]);
    const yes6 = T.ok(['thread', 'say', t2, 'Yes, add it'], {}).split('\n')[0];
    passes(T.run(['answer', q6, 'Yes', '--from-turn', yes6]));
    assert.deepEqual(T.mainJobs(), { ok }, 'only the plain Yes landed its job');
  } finally { T.done(); }
});

test('A5: a recurring-edit answer binds only the owner\'s very next turn in the thread after the turn that shows the question: a plain supervisor reply between asks something else, so the Yes after it lands nothing (final-14b F1)', () => {
  const T = setup('turn-next');
  try {
    const plant = (q, fields) => fs.appendFileSync(T.logFile('owner'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: q, at: new Date().toISOString(), by: 'owner', answer: 'Yes', channel: 'thread', ...fields })}\n`);
    const FIRST = (u, q) => new RegExp(`--from-turn ${u}: ${q} is a recurring-edit question, and that turn isn't the owner's first right after your turn that shows it \\([^)]*, the supervisor's turn, comes between`);
    const PLANTED = (q, u) => new RegExp(`${q} can't approve a job change: answered from ${u}, which isn't the owner's first turn right after the supervisor's turn that shows the question \\([^)]*the supervisor's turn, comes between`);
    // Y1: thread ask q1, then a plain reply asking something else in words, then the owner's Yes
    const ev = check({ title: 'ev job', every: '1h', run: 'echo evil' });
    const t1 = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const r1 = T.run(['thread', 'ask', t1, '--class', 'recurring-edit', '--question', 'Add ev?', '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { ev } })]);
    passes(r1);
    const q1 = QID.exec(r1.out)[0];
    T.ok(['thread', 'reply', t1, 'Separately: shall I delete the stale branches now? Just say yes.']);
    const yes1 = T.ok(['thread', 'say', t1, 'Yes'], {}).split('\n')[0];
    refused(T.run(['answer', q1, 'Yes', '--from-turn', yes1]), FIRST(yes1, q1));
    assert.equal(json(T.ok(['questions', '--id', q1, '--json']))[0].status, 'open', 'q1 stays open');
    plant(q1, { said: 'Yes', turn: yes1 });
    T.jobsChore('y1', () => ({ ev }));
    refused(T.merge('y1', ['--approved', q1]), PLANTED(q1, yes1));
    // Y2: q2 asked in the Inbox and named by a reply, then a plain reply asking something else, then Yes
    const ev2 = check({ title: 'ev2 job', every: '1h', run: 'echo evil2' });
    const q2 = T.asked({ recurring: { ev2 } });
    const t2 = T.ok(['thread', 'new', 'More jobs?', '--title', 'More jobs'], {}).split('\n')[0];
    T.ok(['thread', 'reply', t2, 'From the Inbox: add ev2?', '--refs', `question:${q2}`]);
    T.ok(['thread', 'reply', t2, 'Never mind that one. Shall I restart the dashboard?']);
    const yes2 = T.ok(['thread', 'say', t2, 'Yes'], {}).split('\n')[0];
    refused(T.run(['answer', q2, 'Yes', '--from-turn', yes2]), FIRST(yes2, q2));
    plant(q2, { said: 'Yes', turn: yes2 });
    T.jobsChore('y2', () => ({ ev2 }));
    refused(T.merge('y2', ['--approved', q2]), PLANTED(q2, yes2));
    assert.deepEqual(T.mainJobs(), {}, 'no job landed');
    // the plain case: the reply shows the question, and the owner's very next turn says Yes; it lands
    const ok = check({ title: 'ok job', run: 'echo ok' });
    const q3 = T.asked({ recurring: { ok } });
    T.ok(['thread', 'reply', t2, 'Add ok?', '--refs', `question:${q3}`]);
    const yes3 = T.ok(['thread', 'say', t2, 'Yes'], {}).split('\n')[0];
    passes(T.run(['answer', q3, 'Yes', '--from-turn', yes3]));
    T.jobsChore('plain', () => ({ ok }));
    passes(T.merge('plain', ['--approved', q3]));
    assert.deepEqual(T.mainJobs(), { ok }, 'only the plain Yes landed its job');
  } finally { T.done(); }
});

test('A5: a recurring-edit Yes binds only as the very next line in its thread after the turn that shows the question, of any type: a resolve proposal, a resolve and a reopen between bind nothing (final-15b F1, H1, H9)', () => {
  const T = setup('turn-line');
  try {
    const plant = (q, fields) => fs.appendFileSync(T.logFile('owner'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: q, at: new Date().toISOString(), by: 'owner', answer: 'Yes', channel: 'thread', ...fields })}\n`);
    const tAsk = (tid, name, job) => { const r = T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', `Add ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: job } })]); passes(r); return QID.exec(r.out)[0]; };
    const FIRST = (u, q, what) => new RegExp(`--from-turn ${u}: ${q} is a recurring-edit question, and that turn isn't the owner's first right after your turn that shows it \\([^)]*${what}[^)]* comes between`);
    const PLANTED = (q, u, what) => new RegExp(`${q} can't approve a job change: answered from ${u}, which isn't the owner's first turn right after the supervisor's turn that shows the question \\([^)]*${what}[^)]* comes between`);
    // H1: thread ask q1, then a resolve proposal that asks something else, then the owner's Yes
    const ev = check({ title: 'ev job', every: '1h', run: 'echo evil' });
    const t1 = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const q1 = tAsk(t1, 'ev', ev);
    passes(T.run(['thread', 'ready', t1, '--outcome', 'Branches tidied; shall I resolve this?']));
    const yes1 = T.ok(['thread', 'say', t1, 'Yes'], {}).split('\n')[0];
    refused(T.run(['answer', q1, 'Yes', '--from-turn', yes1]), FIRST(yes1, q1, 'resolve proposal'));
    assert.equal(json(T.ok(['questions', '--id', q1, '--json']))[0].status, 'open', 'q1 stays open');
    plant(q1, { said: 'Yes', turn: yes1 });
    T.jobsChore('h1', () => ({ ev }));
    refused(T.merge('h1', ['--approved', q1]), PLANTED(q1, yes1, 'resolve proposal'));
    // H9: a proposal standing from before; q2 shown; the owner accepts the proposal, reopens with no
    // words, then says Yes
    const ev2 = check({ title: 'ev2 job', every: '1h', run: 'echo evil2' });
    const t2 = T.ok(['thread', 'new', 'More jobs?', '--title', 'More jobs'], {}).split('\n')[0];
    passes(T.run(['thread', 'ready', t2, '--outcome', 'Nothing left here.']));
    const q2 = tAsk(t2, 'ev2', ev2);
    T.ok(['thread', 'resolve', t2, '--accept'], {});
    T.ok(['thread', 'reopen', t2], {});
    const yes2 = T.ok(['thread', 'say', t2, 'Yes'], {}).split('\n')[0];
    refused(T.run(['answer', q2, 'Yes', '--from-turn', yes2]), FIRST(yes2, q2, 'status'));
    plant(q2, { said: 'Yes', turn: yes2 });
    T.jobsChore('h9', () => ({ ev2 }));
    refused(T.merge('h9', ['--approved', q2]), PLANTED(q2, yes2, 'status'));
    assert.deepEqual(T.mainJobs(), {}, 'no job landed');
    // the plain case in t2: a question shown, and the owner's very next line is the Yes; it lands
    const ok = check({ title: 'ok job', run: 'echo ok' });
    const q3 = T.asked({ recurring: { ok } });
    T.ok(['thread', 'reply', t2, 'Shall I add ok?', '--refs', `question:${q3}`]);
    const yes3 = T.ok(['thread', 'say', t2, 'Yes'], {}).split('\n')[0];
    passes(T.run(['answer', q3, 'Yes', '--from-turn', yes3]));
    T.jobsChore('plain', () => ({ ok }));
    passes(T.merge('plain', ['--approved', q3]));
    assert.deepEqual(T.mainJobs(), { ok }, 'only the plain Yes landed its job');
  } finally { T.done(); }
});

test('A5: a planted line whose words aren\'t its Yes turn\'s, or whose turn is in another thread than the question\'s, lands nothing; a reply showing two questions binds neither (final-14b F5)', () => {
  const T = setup('turn-checks');
  try {
    const plant = (q, fields) => fs.appendFileSync(T.logFile('owner'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: q, at: new Date().toISOString(), by: 'owner', answer: 'Yes', channel: 'thread', ...fields })}\n`);
    const tAsk = (tid, name, job) => { const r = T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', `Add ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: job } })]); passes(r); return QID.exec(r.out)[0]; };
    // saideq: the turn is the owner's bound Yes, but the line's words are other than the turn's
    const ev = check({ title: 'ev job', every: '1h', run: 'echo evil' });
    const t1 = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const q1 = tAsk(t1, 'ev', ev);
    const yes1 = T.ok(['thread', 'say', t1, 'Yes'], {}).split('\n')[0];
    plant(q1, { said: 'Yes please', turn: yes1 });
    T.jobsChore('saideq', () => ({ ev }));
    refused(T.merge('saideq', ['--approved', q1]), new RegExp(`${q1} can't approve a job change: answered from ${yes1}, with words that aren't that turn's \\("Yes please"\\)`));
    // nothread: q2 asked in t2; a reply in t3 names it, and the owner's Yes there binds by turn, not by thread
    const ev2 = check({ title: 'ev2 job', every: '1h', run: 'echo evil2' });
    const t2 = T.ok(['thread', 'new', 'Jobs 2?', '--title', 'Jobs 2'], {}).split('\n')[0];
    const t3 = T.ok(['thread', 'new', 'Other', '--title', 'Other'], {}).split('\n')[0];
    const q2 = tAsk(t2, 'ev2', ev2);
    T.ok(['thread', 'reply', t3, `About ${q2}?`, '--refs', `question:${q2}`]);
    const yes2 = T.ok(['thread', 'say', t3, 'Yes'], {}).split('\n')[0];
    plant(q2, { said: 'Yes', turn: yes2 });
    T.jobsChore('nothread', () => ({ ev2 }));
    refused(T.merge('nothread', ['--approved', q2]), new RegExp(`${q2} can't approve a job change: answered from ${yes2}, which is in ${t3}, not the question's ${t2}`));
    // multiq: a reply showing q3 and q4 together, then the owner's Yes: it binds neither
    const q3 = T.asked({ recurring: { ev3: check({ title: 'ev3 job', every: '1h', run: 'echo evil3' }) } });
    const q4 = T.asked({ recurring: { ev4: check({ title: 'ev4 job', run: 'echo ev4' }) } });
    const t4 = T.ok(['thread', 'new', 'Both?', '--title', 'Both'], {}).split('\n')[0];
    T.ok(['thread', 'reply', t4, 'Add ev3 and ev4?', '--refs', `question:${q3}`, `question:${q4}`]);
    const yes3 = T.ok(['thread', 'say', t4, 'Yes'], {}).split('\n')[0];
    refused(T.run(['answer', q3, 'Yes', '--from-turn', yes3]), new RegExp(`--from-turn ${yes3}: ${q3} is a recurring-edit question, and that turn isn't the owner's first right after your turn that shows it \\([^)]*, which shows it, names another question too\\)`));
    assert.equal(json(T.ok(['questions', '--id', q3, '--json']))[0].status, 'open', 'q3 stays open');
    assert.deepEqual(T.mainJobs(), {}, 'no job landed');
  } finally { T.done(); }
});

test('A5: a recurring-edit Yes is refused once the owner has written again after it in the thread: their next turn may take it back (final-14b F3)', () => {
  const T = setup('turn-newer');
  try {
    const ev = check({ title: 'ev job', every: '1h', run: 'echo evil' });
    const tid = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const r = T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', 'Add ev?', '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { ev } })]);
    passes(r);
    const q = QID.exec(r.out)[0];
    const yes = T.ok(['thread', 'say', tid, 'Yes'], {}).split('\n')[0];
    const back = T.ok(['thread', 'say', tid, 'Wait, no. Cancel that, do not add it.'], {}).split('\n')[0];
    refused(T.run(['answer', q, 'Yes', '--from-turn', yes]), new RegExp(`--from-turn ${yes}: ${q} is a recurring-edit question, and the owner wrote again after that turn \\(${back}\\)`));
    assert.equal(json(T.ok(['questions', '--id', q, '--json']))[0].status, 'open', 'q stays open');
    // the plain case in the same thread: shown again, Yes, and nothing after it
    T.ok(['thread', 'reply', tid, 'Shall I add ev after all?', '--refs', `question:${q}`]);
    const yes2 = T.ok(['thread', 'say', tid, 'Yes'], {}).split('\n')[0];
    passes(T.run(['answer', q, 'Yes', '--from-turn', yes2]));
  } finally { T.done(); }
});

test('A5: once the owner has written anything after a recurring-edit Yes in its thread (a turn, whatever it answers, a resolve with an outcome, a reopen), the Yes is refused; recorded before the next question is shown, it stands (final-16b F1 to F4, d-20261121-072341505)', () => {
  const T = setup('turn-bound');
  try {
    const tAsk = (tid, name, job) => { const r = T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', `Add ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: job } })]); passes(r); return QID.exec(r.out)[0]; };
    const pAsk = (tid, words, extra = []) => { const r = T.run(['thread', 'ask', tid, '--question', words, '--recommendation', 'Yes', ...extra]); passes(r); return QID.exec(r.out)[0]; };
    const say = (tid, w) => T.ok(['thread', 'say', tid, w], {}).split('\n')[0];
    const newT = (title) => T.ok(['thread', 'new', title, '--title', title], {}).split('\n')[0];
    const job = (n) => check({ title: `${n} job`, run: `echo ${n}` });
    const AGAIN = (u, q, what) => new RegExp(`--from-turn ${u}: ${q} is a recurring-edit question, and the owner wrote again after that turn \\(${what}\\)`);
    // H3: q1, y1, then q2 (a recurring-edit question), y2: q2 is recorded from y2, but q1 from y1 is
    // refused, since y2 came after it
    const t1 = newT('Jobs');
    const q1 = tAsk(t1, 'a1', job('a1'));
    const y1 = say(t1, 'Yes');
    const q2 = tAsk(t1, 'a2', job('a2'));
    const y2 = say(t1, 'Yes');
    passes(T.run(['answer', q2, 'Yes', '--from-turn', y2]));
    refused(T.run(['answer', q1, 'Yes', '--from-turn', y1]), AGAIN(y1, q1, y2));
    // recorded before the next question is shown, each stands
    const t2 = newT('Jobs 2');
    const q3 = tAsk(t2, 'a3', job('a3'));
    const y3 = say(t2, 'Yes');
    passes(T.run(['answer', q3, 'Yes', '--from-turn', y3]));
    const q4 = tAsk(t2, 'a4', job('a4'));
    const y4 = say(t2, 'Yes');
    passes(T.run(['answer', q4, 'Yes', '--from-turn', y4]));
    // B3: a question asked right after the Yes, which the owner's retraction answers by position
    const t3 = newT('Jobs 3');
    const q5 = tAsk(t3, 'a5', job('a5'));
    const y5 = say(t3, 'Yes');
    pAsk(t3, 'Anything else today?');
    const back5 = say(t3, 'No. Actually cancel that job, do not add it.');
    refused(T.run(['answer', q5, 'Yes', '--from-turn', y5]), AGAIN(y5, q5, back5));
    // B5: a question about the retraction turn, answered from another clause of it
    const t4 = newT('Jobs 4');
    const q6 = tAsk(t4, 'a6', job('a6'));
    const y6 = say(t4, 'Yes');
    const back6 = say(t4, 'Cancel that job. Also restart the dashboard.');
    const q7 = pAsk(t4, 'Restart the dashboard now?', ['--turn', back6]);
    passes(T.run(['answer', q7, 'Yes', '--from-turn', back6, '--said', 'Also restart the dashboard.']));
    refused(T.run(['answer', q6, 'Yes', '--from-turn', y6]), AGAIN(y6, q6, back6));
    // B6: the retraction recorded, in its own words, as the answer to an older open plain question
    const t5 = newT('Jobs 5');
    const q8 = pAsk(t5, 'Shall I restart the dashboard?');
    T.ok(['thread', 'reply', t5, 'Meanwhile, one more.']);
    const q9 = tAsk(t5, 'a9', job('a9'));
    const y9 = say(t5, 'Yes');
    const back9 = say(t5, 'Wait, no. Cancel that job.');
    passes(T.run(['answer', q8, 'Wait, no. Cancel that job.', '--from-turn', back9]));
    refused(T.run(['answer', q9, 'Yes', '--from-turn', y9]), AGAIN(y9, q9, back9));
    // B7: the owner resolves the thread with an outcome after the Yes
    const t6 = newT('Jobs 6');
    const q10 = tAsk(t6, 'b0', job('b0'));
    const y10 = say(t6, 'Yes');
    T.ok(['thread', 'resolve', t6, '--outcome', 'Never mind, do not add the job.'], {});
    refused(T.run(['answer', q10, 'Yes', '--from-turn', y10]), AGAIN(y10, q10, `their resolve of ${t6} with an outcome[^)]*`));
    // a reopen after the Yes (the resolve before it has no words)
    const t7 = newT('Jobs 7');
    const q11 = tAsk(t7, 'b1', job('b1'));
    const y11 = say(t7, 'Yes');
    T.ok(['thread', 'resolve', t7], {});
    T.ok(['thread', 'reopen', t7], {});
    refused(T.run(['answer', q11, 'Yes', '--from-turn', y11]), AGAIN(y11, q11, `their reopen of ${t7}[^)]*`));
    for (const q of [q1, q5, q6, q9, q10, q11]) assert.equal(json(T.ok(['questions', '--id', q, '--json']))[0].status, 'open', `${q} stays open`);
  } finally { T.done(); }
});

test('A5: the owner\'s card answer to another question of the Yes\'s thread counts as a later owner line; at merge a planted answer line after a later owner line lands nothing; an owner line in another thread blocks nothing (final-17b F1, F3, F4, d-20261121-103254180)', () => {
  const T = setup('turn-later17');
  try {
    const tAsk = (tid, name, job) => { const r = T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', `Add ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: job } })]); passes(r); return QID.exec(r.out)[0]; };
    const pAsk = (tid, words) => { const r = T.run(['thread', 'ask', tid, '--question', words, '--recommendation', 'Yes']); passes(r); return QID.exec(r.out)[0]; };
    const say = (tid, w) => T.ok(['thread', 'say', tid, w], {}).split('\n')[0];
    const newT = (title) => T.ok(['thread', 'new', title, '--title', title], {}).split('\n')[0];
    const job = (n) => check({ title: `${n} job`, run: `echo ${n}` });
    const landed = {};
    // N1: a plain q2, then the recurring-edit q1, in thread t1; the owner says Yes to q1, then
    // answers q2's card with words that take it back: the Yes is refused, and nothing lands
    const t1 = newT('Jobs');
    const q2 = pAsk(t1, 'Also restart the dashboard?');
    T.ok(['thread', 'reply', t1, 'And one job.']);
    const q1 = tAsk(t1, 'n1', job('n1'));
    const y1 = say(t1, 'Yes');
    T.ok(['answer', q2, 'No. And cancel that job too, do not add it.'], {});
    refused(T.run(['answer', q1, 'Yes', '--from-turn', y1]), new RegExp(`--from-turn ${y1}: ${q1} is a recurring-edit question, and the owner wrote again after that turn \\(their answer to ${q2}, at [^)]*\\)`));
    assert.equal(json(T.ok(['questions', '--id', q1, '--json']))[0].status, 'open', `${q1} stays open`);
    T.jobsChore('n1', (j) => ({ ...j, n1: job('n1') }));
    refused(T.merge('n1', ['--approved', q1]));
    assert.equal(Object.hasOwn(T.mainJobs(), 'n1'), false, 'n1 did not land');
    // N2: Yes, then "Wait, no.", then an answer line from the Yes planted in the owner's log: merge
    // re-checks the later owner line and lands nothing
    const t2 = newT('Jobs 2');
    const qn2 = tAsk(t2, 'n2', job('n2'));
    const yn2 = say(t2, 'Yes');
    const back = say(t2, 'Wait, no. Cancel that job.');
    refused(T.run(['answer', qn2, 'Yes', '--from-turn', yn2]), /the owner wrote again after that turn/);
    const yText = json(T.ok(['log', '--type', 'turn', '--json'])).find((x) => x.id === yn2).text;
    fs.appendFileSync(T.logFile('owner'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: qn2, at: new Date().toISOString(), by: 'owner', answer: 'Yes', channel: 'thread', said: yText, turn: yn2 })}\n`);
    assert.equal(json(T.ok(['questions', '--id', qn2, '--json']))[0].matched, true, 'the view takes the planted line');
    T.jobsChore('n2', (j) => ({ ...j, n2: job('n2') }));
    const AFTER = new RegExp(`${qn2} can't approve a job change: answered from ${yn2}, after which the owner wrote again in ${t2} before the answer was recorded \\(${back}\\)`);
    refused(T.dry('n2', qn2), AFTER);
    refused(T.merge('n2', ['--approved', qn2]), AFTER);
    assert.equal(Object.hasOwn(T.mainJobs(), 'n2'), false, 'n2 did not land');
    // another thread: after the Yes, the owner writes a turn in t4 and answers t4's question on its
    // card; neither is in the Yes's thread, so the answer is accepted and lands
    const t3 = newT('Jobs 3');
    const t4 = newT('Elsewhere');
    const q4 = pAsk(t4, 'Restart the dashboard?');
    const q3 = tAsk(t3, 'n3', job('n3'));
    const y3 = say(t3, 'Yes');
    say(t4, 'Wait, no. Not that.');
    T.ok(['answer', q4, 'No, cancel it.'], {});
    passes(T.run(['answer', q3, 'Yes', '--from-turn', y3]));
    T.jobsChore('n3', (j) => ({ ...j, n3: job('n3') }));
    passes(T.merge('n3', ['--approved', q3]));
    landed.n3 = job('n3');
    // N6: Yes, the supervisor's reply, the answer recorded, then a later owner line in the thread:
    // the answer was recorded first, so it stands and lands
    const t5 = newT('Jobs 5');
    const q6 = tAsk(t5, 'n6', job('n6'));
    const y6 = say(t5, 'Yes, add it!');
    T.ok(['thread', 'reply', t5, 'Thanks: I will add it.']);
    passes(T.run(['answer', q6, 'Yes', '--from-turn', y6]));
    say(t5, 'Thanks. Actually, wait, no.');
    T.jobsChore('n6', (j) => ({ ...j, n6: job('n6') }));
    passes(T.merge('n6', ['--approved', q6]));
    landed.n6 = job('n6');
    assert.deepEqual(T.mainJobs(), landed, 'only n3 and n6 landed');
  } finally { T.done(); }
});

test('A5: thread reply --refs question:<id> names a question in the log, or it is refused (final-16b F1, B4)', () => {
  const T = setup('refs-exist');
  try {
    const tid = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const q = T.asked({ recurring: { ok: check({ title: 'ok job', run: 'echo ok' }) } });
    const r = T.run(['thread', 'reply', tid, 'Anything else?', '--refs', 'question:q-20200101-000000000-supervisor']);
    refused(r, /--refs question:q-20200101-000000000-supervisor names no question in the log/);
    assert.equal(json(T.ok(['log', '--type', 'turn', '--json'])).filter((x) => x.thread === tid).length, 1, 'no reply written');
    refused(T.run(['thread', 'reply', tid, 'Anything else?', '--refs', 'goal:upkeep', `question:${q}x`]), new RegExp(`--refs question:${q}x names no question in the log`));
    passes(T.run(['thread', 'reply', tid, 'Shall I add ok?', '--refs', `question:${q}`]));
  } finally { T.done(); }
});

test('A5: a thread line in the very millisecond of the showing turn or of the Yes counts as between them: a tie never binds (final-16b F6)', () => {
  const T = setup('turn-tie');
  try {
    const tAsk = (tid, name, job) => { const r = T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', `Add ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: job } })]); passes(r); return QID.exec(r.out)[0]; };
    const job = (n) => check({ title: `${n} job`, run: `echo ${n}` });
    const atOf = (id) => json(T.ok(['log', '--type', 'turn', '--json'])).find((x) => x.id === id).created_at;
    const ready = (tid, at) => fs.appendFileSync(T.logFile('supervisor'), `${JSON.stringify({ v: 1, type: 'thread', op: 'set', id: tid, at, by: 'supervisor', ready: { outcome: 'Shall I resolve this?', at } })}\n`);
    const TIE = (u, q) => new RegExp(`--from-turn ${u}: ${q} is a recurring-edit question, and that turn isn't the owner's first right after your turn that shows it \\(the supervisor's resolve proposal, a thread ready line,[^)]* comes between`);
    // a resolve proposal planted at the Yes's own millisecond
    const t1 = T.ok(['thread', 'new', 'Jobs', '--title', 'Jobs'], {}).split('\n')[0];
    const q1 = tAsk(t1, 'c1', job('c1'));
    const y1 = T.ok(['thread', 'say', t1, 'Yes'], {}).split('\n')[0];
    ready(t1, atOf(y1));
    refused(T.run(['answer', q1, 'Yes', '--from-turn', y1]), TIE(y1, q1));
    // and one at the showing turn's own millisecond
    const t2 = T.ok(['thread', 'new', 'Jobs 2', '--title', 'Jobs 2'], {}).split('\n')[0];
    const q2 = tAsk(t2, 'c2', job('c2'));
    const show = json(T.ok(['log', '--type', 'turn', '--json'])).find((x) => x.thread === t2 && x.question === q2);
    ready(t2, show.created_at);
    const y2 = T.ok(['thread', 'say', t2, 'Yes'], {}).split('\n')[0];
    refused(T.run(['answer', q2, 'Yes', '--from-turn', y2]), TIE(y2, q2));
  } finally { T.done(); }
});

test('A5: a supervisor reply after the owner\'s Yes doesn\'t block it, and an owner turn in the same millisecond as the Yes counts as after it (final-15b F6)', () => {
  const T = setup('turn-after');
  try {
    const tAsk = (tid, name, job) => { const r = T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', `Add ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: job } })]); passes(r); return QID.exec(r.out)[0]; };
    const job = (n) => check({ title: `${n} job`, run: `echo ${n}` });
    // laterany: the owner's Yes, then the supervisor's reply; the answer from the Yes is accepted
    const t1 = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const q1 = tAsk(t1, 'b1', job('b1'));
    const y1 = T.ok(['thread', 'say', t1, 'Yes'], {}).split('\n')[0];
    T.ok(['thread', 'reply', t1, 'Thanks: I will add it.']);
    passes(T.run(['answer', q1, 'Yes', '--from-turn', y1]));
    // samems: an owner turn written in the very millisecond of the Yes (a planted line, its id one
    // millisecond on) counts as after it, so the Yes is refused
    const t2 = T.ok(['thread', 'new', 'Jobs 2?', '--title', 'Jobs 2'], {}).split('\n')[0];
    const q2 = tAsk(t2, 'b2', job('b2'));
    const y2 = T.ok(['thread', 'say', t2, 'Yes'], {}).split('\n')[0];
    const at = json(T.ok(['log', '--type', 'turn', '--json'])).find((x) => x.id === y2).created_at;
    const same = y2.replace(/-(\d{9})-owner$/, (m, d) => `-${String(Number(d) + 1).padStart(9, '0')}-owner`);
    fs.appendFileSync(T.logFile('owner'), `${JSON.stringify({ v: 1, type: 'turn', op: 'new', id: same, at, by: 'owner', channel: 'cli', thread: t2, text: 'Wait, no.' })}\n`);
    refused(T.run(['answer', q2, 'Yes', '--from-turn', y2]), new RegExp(`--from-turn ${y2}: ${q2} is a recurring-edit question, and the owner wrote again after that turn \\(${same}\\)`));
  } finally { T.done(); }
});

test('A5: a planted line on a channel the kit never writes for an owner\'s answer lands nothing (final-14b F7)', () => {
  const T = setup('turn-channel');
  try {
    for (const [i, ch] of ['Thread', 'thread ', 'terminal', undefined, null, 7].entries()) {
      const tid = T.ok(['thread', 'new', `Jobs ${i}?`, '--title', `Jobs ${i}`], {}).split('\n')[0];
      const name = `ch${i}`;
      const job = check({ title: `${name} job`, every: '1h', run: `echo ${name}` });
      const r = T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', `Add ${name}?`, '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { [name]: job } })]);
      passes(r);
      const q = QID.exec(r.out)[0];
      const no = T.ok(['thread', 'say', tid, 'No, never.'], {}).split('\n')[0];
      fs.appendFileSync(T.logFile('owner'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: q, at: new Date().toISOString(), by: 'owner', answer: 'Yes', channel: ch, said: 'Yes', turn: no })}\n`);
      T.jobsChore(name, () => ({ [name]: job }));
      refused(T.merge(name, ['--approved', q]), new RegExp(`${q} can't approve a job change: answered on channel ${JSON.stringify(ch ?? null).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, which the kit never writes for an owner's answer`));
    }
    assert.deepEqual(T.mainJobs(), {}, 'no job landed');
  } finally { T.done(); }
});

test('A5: a recurring-edit line from a turn is read against that turn\'s own words: a planted Yes on a No turn lands nothing (final-13b F2)', () => {
  const T = setup('turn-words');
  try {
    const ev = check({ title: 'ev job', every: '1h', run: 'echo evil' });
    const tid = T.ok(['thread', 'new', 'Jobs?', '--title', 'Jobs'], {}).split('\n')[0];
    const q = QID.exec(T.run(['thread', 'ask', tid, '--class', 'recurring-edit', '--question', 'Add ev?', '--recommendation', 'Yes', '--change', JSON.stringify({ recurring: { ev } })]).out)[0];
    const no = T.ok(['thread', 'say', tid, 'No, never add it.'], {}).split('\n')[0];
    // X3: the line says Yes, the turn it cites says No
    fs.appendFileSync(T.logFile('owner'), `${JSON.stringify({ v: 1, type: 'question', op: 'set', id: q, at: new Date().toISOString(), by: 'owner', answer: 'Yes', channel: 'thread', said: 'Yes', turn: no })}\n`);
    T.jobsChore('x3', () => ({ ev }));
    refused(T.merge('x3', ['--approved', q]), new RegExp(`${q} can't approve a job change: answered from ${no}, whose words don't start with Yes \\("No, never add it\\."\\)`));
    assert.deepEqual(T.mainJobs(), {}, 'no job landed');
  } finally { T.done(); }
});
