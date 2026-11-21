// One yes per link change: what stays bound, a no covers nothing, link land, and only a yes approves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { line } from './lib/kit.mjs';
import { chore, choreLinks, dry, HEADER, ownWords, setup, wouldMerge } from './lib/link-approved-fixture.mjs';

test('still bound: a hand edit, an answer that covers none of it, a default', () => {
  const T = setup('one-yes-land-bound');
  try {
    const q1 = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']).qid;
    T.yes(q1);
    T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q1]);
    chore(T, 'hand', (wt) => T.edit((j) => { j.links.console.gates = { test: 'other' }; }, wt));
    const h = dry(T, 'hand', q1);
    assert.notEqual(h.status, 0, h.text);
    assert.match(h.text, /changes links\.console\.gates, which q-\S+ did not approve/);
    // an answer about companion only, cited for a chore that changes console only
    const qc = ownWords(T, { link: 'companion', field: 'records', value: 'home' });
    T.yes(qc);
    chore(T, 'other');
    const o = dry(T, 'other', qc);
    assert.notEqual(o.status, 0, o.text);
    assert.match(o.text, new RegExp(`${qc} approves none of the repo link changes`));
    // a default (not the owner's yes) carries nothing at link land
    const id = 'q-20261118-120000003-supervisor';
    const at = new Date(Date.now() - 60000).toISOString();
    fs.appendFileSync(T.logFile(), line({ id, type: 'question', op: 'new', at, by: 'supervisor', kind: 'owner-decision', class: 'governance-edit', question: 'Records?', context: `${HEADER}\nlinks.console.records: main has null; would be "home"`, recommendation: 'yes', default: 'yes' }));
    fs.appendFileSync(T.logFile(), line({ id, type: 'question', op: 'set', at: new Date(Date.parse(at) + 1000).toISOString(), by: 'supervisor', status: 'defaulted' }));
    T.edit((j) => { j.links.console.records = 'home'; });
    T.g(['fetch', '-q', 'origin'], T.old);
    const wt = path.join(T.old, '.worktrees', 'chore-dflt');
    T.g(['worktree', 'add', '-q', '-b', 'chore-dflt', wt, 'origin/main'], T.old);
    assert.match(T.ok(['link', 'land', 'dflt']), /not carried, as the owner's.*links\.console/);
    assert.equal(choreLinks(wt).console.records, undefined);
  } finally { T.done(); }
});

test("the owner's no covers nothing: link set asks again rather than citing it (task-1 T1-1)", () => {
  const T = setup('one-yes-no');
  try {
    const { qid } = T.ask(['link', 'set', 'console', 'records', 'home']);
    T.okIn(T.old, ['answer', qid, 'no, keep them in the repo']);
    const n = T.questionCount();
    const out = T.ok(['link', 'set', 'console', 'records', 'home']);
    assert.equal(T.questionCount(), n + 1, out);
    assert.ok(!out.includes(qid), out);
  } finally { T.done(); }
});

test('link land carries an approved add, removal and field removal, each landing under its answer (task-4 T4-1)', () => {
  const T = setup('one-yes-land-entries');
  try {
    const entry = { kind: 'repo', remote: 'usbclub/docs', title: 'Docs site' };
    const qa = ownWords(T, { link: 'docs', entry });
    T.yes(qa);
    T.ok(['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site', '--approved', qa]);
    const wa = chore(T, 'add');
    assert.deepEqual(choreLinks(wa).docs, entry);
    wouldMerge(dry(T, 'add', qa), 'add');
    // a removal (companion's component goes first, on main and here)
    T.onMain((j) => { delete j.components.companion; });
    T.edit((j) => { delete j.components.companion; });
    const qr = ownWords(T, { link: 'companion', entry: null });
    T.yes(qr);
    T.ok(['link', 'rm', 'companion', '--approved', qr]);
    const wr = chore(T, 'rm');
    assert.equal(choreLinks(wr).companion, undefined);
    wouldMerge(dry(T, 'rm', qr), 'rm');
    // a field removal: console's entry without its gates, asked whole, written here by hand
    const { gates, ...noGates } = T.links().console;
    assert.ok(gates);
    const qf = ownWords(T, { link: 'console', entry: noGates });
    assert.deepEqual(T.section(T.question(qf).context), [`links.console.gates: main has ${JSON.stringify(gates)}; would be null`]);
    T.yes(qf);
    T.edit((j) => { delete j.links.console.gates; });
    const wf = chore(T, 'nogates');
    assert.ok(!Object.hasOwn(choreLinks(wf).console, 'gates'), 'the field is removed, not set to null');
    wouldMerge(dry(T, 'nogates', qf), 'nogates');
  } finally { T.done(); }
});

test('only a yes approves: --link-change recommends yes and offers no choices, and a no to the same line takes a yes back (final-1 F1, F2)', () => {
  const T = setup('one-yes-only-yes');
  try {
    const change = JSON.stringify({ link: 'console', field: 'records', value: 'home' });
    const base = ['ask', '--class', 'governance-edit', '--question', 'Keep console records in home?', '--link-change', change];
    const n = T.questionCount();
    const rno = T.run([...base, '--recommendation', 'no']);
    assert.equal(rno.status, 1, rno.out);
    assert.match(rno.err, /--link-change asks yes or no/);
    const rch = T.run([...base, '--recommendation', 'Keep in the repo', '--choices', '[{"label":"Keep in the repo"},{"label":"Move to home"}]']);
    assert.equal(rch.status, 1, rch.out);
    assert.equal(T.questionCount(), n, 'nothing asked');
    // a question that recommended something other than yes (written by hand: ask refuses it), answered as recommended, covers nothing
    T.ask(['link', 'set', 'companion', 'title', 'Companion']);
    const id = 'q-20261118-120000004-supervisor';
    fs.appendFileSync(T.logFile(), line({ id, type: 'question', op: 'new', at: new Date(Date.now() - 60000).toISOString(), by: 'supervisor', kind: 'owner-decision', class: 'governance-edit', question: 'Where do console records go?', context: `${HEADER}\nlinks.console.records: main has null; would be "home"`, recommendation: 'Keep in the repo' }));
    T.okIn(T.old, ['answer', id, 'Keep in the repo']);
    const m = T.questionCount();
    const out = T.ok(['link', 'set', 'console', 'records', 'home']);
    assert.equal(T.questionCount(), m + 1, out);
    assert.ok(!out.includes(id), out);
    // a yes, then the owner's later no to the same line: the yes is taken back
    const q1 = ownWords(T, { link: 'console', field: 'gates', value: { test: 'true' } });
    T.yes(q1);
    const q2 = T.ask([...base.slice(0, 4), 'Keep the console gate as it is?', '--link-change', JSON.stringify({ link: 'console', field: 'gates', value: { test: 'true' } }), '--recommendation', 'yes', '--new-because', 'checking again']).qid;
    T.okIn(T.old, ['answer', q2, 'no, keep it']);
    const k = T.questionCount();
    const out2 = T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}']);
    assert.equal(T.questionCount(), k + 1, out2);
    assert.ok(!out2.includes(`--approved ${q1}`), out2);
  } finally { T.done(); }
});
