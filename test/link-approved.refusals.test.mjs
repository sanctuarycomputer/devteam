// One yes per link change: refusals by name, flags after --, own-words questions, and binding lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADER, ownWords, setup } from './lib/link-approved-fixture.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('a bundle change no answer covers is refused by name, and nothing is written', () => {
  const T = setup('one-yes-not-yet');
  try {
    const q1 = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']).qid;
    T.yes(q1);
    T.edit((j) => { j.links.companion.title = 'Hand edit'; });
    const before = T.here();
    const r = T.run(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q1]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.err, new RegExp(`not approved yet: ${esc('links.companion.title')}`));
    assert.match(r.err, /bring this checkout's settings\.md up to date/);
    assert.equal(T.here(), before);
    // without --approved it asks about that change only, and its question names it, not console's covered gates (task-1 T1-2)
    const { qid } = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']);
    const q = T.question(qid);
    assert.deepEqual(T.section(q.context), ['links.companion.title: main has "Companion app"; would be "Hand edit"']);
    assert.match(q.question, /^Change links\.companion\.title, waiting in settings\.md to land with console\?$/);
  } finally { T.done(); }
});

test('a link flag after -- is refused, and the printed command puts --approved before --', () => {
  const T = setup('one-yes-dashdash');
  try {
    const before = T.here();
    const n = T.questionCount();
    for (const tail of [['v', '--approved', 'q-20260101-000000000-supervisor'], ['v', '--reason', 'x'], ['v', '--approved=q-20260101-000000000-supervisor']]) {
      const r = T.run(['link', 'set', 'console', 'worktree_setup', '--', ...tail]);
      assert.equal(r.status, 1, r.out);
      assert.match(r.err, /put flags before --/);
      assert.match(r.err, /quote the value/);
    }
    assert.equal(T.here(), before);
    assert.equal(T.questionCount(), n, 'nothing asked');
    // a value that starts with -- still goes after a bare --, and the command to run once answered keeps it there
    const { out, qid } = T.ask(['link', 'set', 'console', 'worktree_setup', '--', '--x']);
    const cmd = /node docs\/devteam\/scripts\/devteam\.mjs (.*)$/.exec(out)[1];
    assert.match(cmd, new RegExp(`--approved ${qid} '--' '--x'$`), cmd);
    T.yes(qid);
    const words = [...cmd.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2]));
    T.ok(words);
    assert.equal(T.links().console.worktree_setup, '--x');
  } finally { T.done(); }
});

test('an own-words question approves a set: link set asks nothing more and lands it with that answer', () => {
  const T = setup('one-yes-own-words');
  try {
    const qid = ownWords(T, { link: 'console', field: 'records', value: 'home' });
    assert.deepEqual(T.section(T.question(qid).context), ['links.console.records: main has null; would be "home"']);
    T.yes(qid);
    const n = T.questionCount();
    const out = T.ok(['link', 'set', 'console', 'records', 'home']);
    assert.equal(T.questionCount(), n, 'no second question');
    assert.ok(out.includes(`--approved ${qid}`), out);
    T.ok(['link', 'set', 'console', 'records', 'home', '--approved', qid]);
    assert.equal(T.links().console.records, 'home');
  } finally { T.done(); }
});

test('an own-words question about a gate field in governance-edit: the act is in the answer\'s class', () => {
  const T = setup('one-yes-own-gate');
  try {
    const qid = ownWords(T, { link: 'console', field: 'gates', value: { test: 'true' } });
    T.yes(qid);
    T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', qid]);
    const act = T.acts().find((a) => a.approved_by === qid);
    assert.equal(act.class, 'governance-edit');
  } finally { T.done(); }
});

test('an own-words question approves an add and a removal', () => {
  const T = setup('one-yes-own-entry');
  try {
    const entry = { kind: 'repo', remote: 'usbclub/docs', title: 'Docs site' };
    const q1 = ownWords(T, { link: 'docs', entry });
    assert.deepEqual(T.section(T.question(q1).context), [`links.docs: main has null; would be ${JSON.stringify(entry)}`]);
    T.yes(q1);
    T.ok(['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site', '--approved', q1]);
    assert.deepEqual(T.links().docs, entry);
    // companion's component goes first, on main and here: a link a component uses can't be removed
    T.onMain((j) => { delete j.components.companion; });
    T.edit((j) => { delete j.components.companion; });
    const q2 = ownWords(T, { link: 'companion', entry: null });
    T.yes(q2);
    T.ok(['link', 'rm', 'companion', '--approved', q2]);
    assert.equal(T.links().companion, undefined);
  } finally { T.done(); }
});

test('binding lines are the kit\'s: typed or quoted they are refused, and --link-change only where it means something', () => {
  const T = setup('one-yes-typed');
  try {
    const n = T.questionCount();
    const base = ['ask', '--class', 'governance-edit', '--recommendation', 'yes'];
    for (const args of [
      [...base, '--question', 'Change it?', '--context', 'links.console.gates: main has 1; would be 2'],
      [...base, '--question', 'Change it?', '--context', HEADER],
      [...base, '--question', 'links.console: main has null; would be {}'],
      [...base, '--question', 'Change it?', '--context', 'Why: x\\nlinks.console.records: main has null; would be "home"'],
      [...base, '--question', 'Change it?', '--context', 'links.console: main has {"kind":"repo"}\r; would be {"kind":"repo","records":"home"}'],
      [...base, '--question', 'Change it?', '--context', 'Why: x\rlinks.console.records: main has null; would be "home"'],
    ]) assert.equal(T.run(args).status, 1, args.join(' '));
    const strat = T.run(['ask', '--class', 'strategy-change', '--question', 'x?', '--link-change', '{"link":"console","field":"records","value":"home"}']);
    assert.equal(strat.status, 1);
    assert.match(strat.err, /--link-change goes with --class governance-edit or gate-change/);
    const noop = T.run([...base, '--question', 'x?', '--link-change', '{"link":"console","field":"main_branch","value":"trunk"}']);
    assert.equal(noop.status, 1);
    assert.match(noop.err, /main already has that/);
    const notOnMain = T.run([...base, '--question', 'x?', '--link-change', '{"link":"docs","field":"records","value":"home"}']);
    assert.equal(notOnMain.status, 1);
    assert.match(notOnMain.err, /not a link on main.*"entry"/);
    const change = T.run([...base, '--question', 'x?', '--change', '{}']);
    assert.equal(change.status, 1);
    assert.match(change.err, /--link-change/);
    assert.equal(T.questionCount(), n, 'nothing asked');
  } finally { T.done(); }
});
