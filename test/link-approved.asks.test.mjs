// One yes per link change: the one question, what --approved refuses, re-asks, and what a default covers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { line } from './lib/kit.mjs';
import { HEADER, setup } from './lib/link-approved-fixture.mjs';

const ONE = 'This is the one question for this change: nothing else will ask the owner about it.';

test("link set's question is the one question, and binds per field", () => {
  const T = setup('one-yes-one-question');
  try {
    const { qid } = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']);
    const ctx = T.question(qid).context;
    assert.ok(ctx.includes(ONE), ctx);
    assert.deepEqual(T.section(ctx), ['links.console.gates: main has {"test":"test -f src/main.js"}; would be {"test":"true"}']);
  } finally { T.done(); }
});

test('--approved refuses another value or another link, naming what the answer named and what the change is', () => {
  const T = setup('one-yes-other-change');
  try {
    const { qid } = T.ask(['link', 'set', 'console', 'records', 'home']);
    T.yes(qid);
    const before = T.here();
    const v = T.run(['link', 'set', 'console', 'records', 'repo', '--approved', qid]);
    assert.equal(v.status, 1, v.out);
    assert.match(v.err, /asked about another change; ask again for this one/);
    assert.ok(v.err.includes('links.console.records: main has null; would be "home"'), v.err);
    assert.ok(v.err.includes('links.console.records: main has null; would be "repo"'), v.err);
    assert.equal(T.here(), before);
    const l = T.run(['link', 'set', 'companion', 'records', 'home', '--approved', qid]);
    assert.equal(l.status, 1, l.out);
    assert.ok(l.err.includes('links.console.records') && l.err.includes('links.companion.records: main has null; would be "home"'), l.err);
    assert.equal(T.here(), before);
  } finally { T.done(); }
});

test('a re-ask carries an earlier yes: the owner is asked only about the new field', () => {
  const T = setup('one-yes-reask');
  try {
    const q1 = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']).qid;
    T.yes(q1);
    T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q1]);
    const q2 = T.ask(['link', 'set', 'console', 'worktree_setup', 'pnpm i']).qid;
    assert.notEqual(q2, q1);
    const ctx = T.question(q2).context;
    assert.deepEqual(T.section(ctx), ['links.console.worktree_setup: main has null; would be "pnpm i"']);
    assert.ok(ctx.includes(`- links.console.gates (${q1})`), ctx);
    T.yes(q2);
    T.ok(['link', 'set', 'console', 'worktree_setup', 'pnpm i', '--approved', q2]);
    assert.equal(T.links().console.worktree_setup, 'pnpm i');
    const act = T.acts().find((a) => a.approved_by === q2 && a.refs.includes('link:console'));
    assert.equal(act.class, 'gate-change');
  } finally { T.done(); }
});

test('nothing new to ask: link set asks no question and names the answer that covers it', () => {
  const T = setup('one-yes-nothing-new');
  try {
    const q1 = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']).qid;
    T.yes(q1);
    T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q1]);
    assert.match(T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}']), /is already that/);
    // this checkout's settings.md back to main's: the change is to make again, and q1 covers it
    fs.writeFileSync(T.settingsFile, T.g(['show', 'origin/main:docs/devteam/project/settings.md'], T.old));
    const n = T.questionCount();
    const out = T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}']);
    assert.equal(T.questionCount(), n, 'no question asked');
    assert.ok(out.includes(q1) && out.includes(`--approved ${q1}`), out);
  } finally { T.done(); }
});

test("setting a field back to main's value asks nothing and approves nothing", () => {
  const T = setup('one-yes-back');
  try {
    const q1 = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']).qid;
    T.yes(q1);
    T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q1]);
    const n = T.questionCount();
    const acts = T.acts().filter((a) => a.approved_by).length;
    T.ok(['link', 'set', 'console', 'gates', '{"test":"test -f src/main.js"}']);
    assert.equal(T.questionCount(), n);
    assert.deepEqual(T.links().console.gates, { test: 'test -f src/main.js' });
    assert.equal(T.acts().filter((a) => a.approved_by).length, acts);
  } finally { T.done(); }
});

test('an old yes expires when main changed what it approves since the answer, even back to the same value', () => {
  const T = setup('one-yes-expires');
  try {
    // a field
    const q1 = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']).qid;
    T.yes(q1);
    T.onMain((j) => { j.links.console.gates = { test: 'c' }; }, T.after(q1, 5));
    T.onMain((j) => { j.links.console.gates = { test: 'test -f src/main.js' }; }, T.after(q1, 10));
    const r = T.run(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q1]);
    assert.equal(r.status, 1, r.out);
    assert.match(r.err, /asked about another change/);
    // an entry: companion's removal (its component goes first, on main and here, or rm is refused)
    T.onMain((j) => { delete j.components.companion; });
    T.edit((j) => { delete j.components.companion; });
    const q2 = T.ask(['link', 'rm', 'companion']).qid;
    T.yes(q2);
    let removed;
    T.onMain((j) => { removed = j.links.companion; delete j.links.companion; }, T.after(q2, 5));
    T.onMain((j) => { j.links.companion = removed; }, T.after(q2, 10));
    const r2 = T.run(['link', 'rm', 'companion', '--approved', q2]);
    assert.equal(r2.status, 1, r2.out);
    assert.match(r2.err, /asked about another change/);
  } finally { T.done(); }
});

test("a default is not the owner's yes: it covers nothing", () => {
  const T = setup('one-yes-default');
  try {
    // a line of the supervisor's first, so its log file exists
    T.ask(['link', 'set', 'companion', 'title', 'Companion']);
    const id = 'q-20261118-120000001-supervisor';
    const at = new Date(Date.now() - 60000).toISOString();
    const context = `${HEADER}\nlinks.console.records: main has null; would be "home"`;
    fs.appendFileSync(T.logFile(), line({ id, type: 'question', op: 'new', at, by: 'supervisor', kind: 'owner-decision', class: 'governance-edit', question: 'Keep console records in home?', context, recommendation: 'yes', default: 'yes' }));
    fs.appendFileSync(T.logFile(), line({ id, type: 'question', op: 'set', at: new Date(Date.parse(at) + 1000).toISOString(), by: 'supervisor', status: 'defaulted' }));
    assert.equal(T.question(id).status, 'defaulted');
    const n = T.questionCount();
    const out = T.ok(['link', 'set', 'console', 'records', 'home']);
    assert.equal(T.questionCount(), n + 1, out);
    assert.ok(!out.includes(id), out);
  } finally { T.done(); }
});
