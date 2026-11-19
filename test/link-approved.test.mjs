// One yes per repo link change: an owner's answer binds the field changes its question showed,
// wherever the same change comes up again (link set|add|rm, link land, merge), and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { line, write, json, multiFixture } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const QID = /q-[0-9]+-[0-9]+-supervisor/;
const HEADER = 'This answer approves exactly these repo link changes, and no other:';
const ONE = 'This is the one question for this change: nothing else will ask the owner about it.';
const blockOf = (text) => JSON.parse(/```json devteam\s*\n([\s\S]*?)\n```/.exec(text)[1]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The fixture plus what these tests share: questions, answers, main's history.
function setup(name) {
  const F = multiFixture(name);
  const { old, okIn, runIn } = F;
  const run = (args) => runIn(old, args, SUP);
  const ok = (args) => okIn(old, args, SUP);
  const ask = (args) => { const out = ok(args); return { out, qid: (QID.exec(out) ?? [null])[0] }; };
  const question = (qid) => json(okIn(old, ['questions', '--id', qid, '--json']))[0];
  const questionCount = () => json(okIn(old, ['log', '--type', 'question', '--json'])).length;
  const acts = () => json(okIn(old, ['log', '--type', 'act', '--json']));
  const yes = (qid) => okIn(old, ['answer', qid, 'yes']);
  const here = () => fs.readFileSync(F.settingsFile, 'utf8');
  const links = () => blockOf(here()).links;
  // the lines of a question's approves section: after the header, up to the first blank line
  const section = (ctx) => { const ls = ctx.split('\n'); const i = ls.indexOf(HEADER); if (i < 0) return null; const outL = []; for (const l of ls.slice(i + 1)) { if (!l.trim()) break; outL.push(l); } return outL; };
  // main moved by someone else: a clone of home's origin commits to main, dated `at`, and pushes;
  // the main checkout only fetches (its settings.md, with what link set wrote, stays as it is)
  const originUrl = F.g(['remote', 'get-url', 'origin'], old).trim();
  const clone = path.join(F.base, 'home-clone');
  const gitAt = (args, cwd, at) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...(at ? { GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at } : {}) } });
  const onMain = (fn, at, msg = 'main moves') => {
    if (!fs.existsSync(clone)) {
      gitAt(['clone', '-q', originUrl, clone], F.base);
      for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) gitAt(['config', k, v], clone);
    }
    gitAt(['pull', '-q', 'origin', 'main'], clone);
    F.edit(fn, clone);
    gitAt(['commit', '-qam', msg], clone, at);
    gitAt(['push', '-q', 'origin', 'HEAD:main'], clone);
    F.g(['fetch', '-q', 'origin'], old);
  };
  // a time n seconds after an answer (commit times are whole seconds; an answer in the same second counts)
  const after = (qid, n) => new Date(Date.parse(question(qid).answered_at) + n * 1000).toISOString();
  const logFile = () => { const d = path.join(old, 'docs/devteam/run/log'); return path.join(d, fs.readdirSync(d).find((f) => /^supervisor-/.test(f))); };
  return { ...F, run, ok, ask, question, questionCount, acts, yes, here, links, section, onMain, after, logFile };
}

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

// ask --link-change: the supervisor asks in its own words, the kit writes the lines the answer binds by
const ownWords = (T, change, cls = 'governance-edit') => T.ask(['ask', '--class', cls, '--question', 'May I make this registry change?', '--recommendation', 'yes', '--stake', '1', '--urgency', '2', '--link-change', JSON.stringify(change)]).qid;

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

// a chore off main: fn fills it (by default link land), then it is committed, pushed and given its PR text
const chore = (T, slug, fn = () => T.ok(['link', 'land', slug])) => {
  T.g(['fetch', '-q', 'origin'], T.old);
  const wt = path.join(T.old, '.worktrees', `chore-${slug}`);
  T.g(['worktree', 'add', '-q', '-b', `chore-${slug}`, wt, 'origin/main'], T.old);
  fn(wt);
  T.g(['add', '-A'], wt);
  T.g(['commit', '-q', '--allow-empty', '-m', `chore-${slug}: registry`], wt);
  T.g(['push', '-q', 'origin', `chore-${slug}`], wt);
  write(path.join(T.old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: registry\n\n## One-way doors\n\nNone.\n`);
  return wt;
};
const dry = (T, slug, qid) => { const r = T.run(['merge', '--chore', slug, '--dry-run', '--approved', qid]); return { status: r.status, text: `${r.out}\n${r.err}` }; };
const choreLinks = (wt) => blockOf(fs.readFileSync(path.join(wt, 'docs/devteam/project/settings.md'), 'utf8')).links;
const wouldMerge = (r, slug) => { assert.equal(r.status, 0, r.text); assert.match(r.text, new RegExp(`ok: chore-${slug} at \\w{12} would merge`)); assert.doesNotMatch(r.text, /already approved|did not approve/); };

test('own-words answers land: a set, and a gate field asked in governance-edit', () => {
  const T = setup('one-yes-land-own');
  try {
    const q1 = ownWords(T, { link: 'console', field: 'records', value: 'home' });
    T.yes(q1);
    T.ok(['link', 'set', 'console', 'records', 'home', '--approved', q1]);
    chore(T, 'records');
    wouldMerge(dry(T, 'records', q1), 'records');
    const T2 = setup('one-yes-land-own-gate');
    try {
      const q2 = ownWords(T2, { link: 'console', field: 'gates', value: { test: 'true' } });
      T2.yes(q2);
      T2.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q2]);
      chore(T2, 'gates');
      wouldMerge(dry(T2, 'gates', q2), 'gates');
    } finally { T2.done(); }
  } finally { T.done(); }
});

test('a re-ask lands under its own answer, the earlier yes still covering what it approved (either class)', () => {
  const T = setup('one-yes-land-reask');
  try {
    const q1 = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']).qid;
    T.yes(q1);
    T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q1]);
    const q2 = T.ask(['link', 'set', 'console', 'worktree_setup', 'pnpm i']).qid;
    T.yes(q2);
    T.ok(['link', 'set', 'console', 'worktree_setup', 'pnpm i', '--approved', q2]);
    const q3 = T.ask(['link', 'set', 'console', 'records', 'home']).qid;
    assert.equal(T.question(q3).class, 'governance-edit');
    assert.deepEqual(T.section(T.question(q3).context), ['links.console.records: main has null; would be "home"']);
    T.yes(q3);
    T.ok(['link', 'set', 'console', 'records', 'home', '--approved', q3]);
    const wt = chore(T, 'registry');
    assert.deepEqual([choreLinks(wt).console.gates, choreLinks(wt).console.worktree_setup, choreLinks(wt).console.records], [{ test: 'true' }, 'pnpm i', 'home']);
    wouldMerge(dry(T, 'registry', q3), 'registry');
  } finally { T.done(); }
});

test('another field landing on main between the answer and link land spends nothing, for a legacy answer too', () => {
  for (const legacy of [false, true]) {
    const T = setup(`one-yes-land-moved${legacy ? '-legacy' : ''}`);
    try {
      let q1;
      if (!legacy) q1 = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']).qid;
      else {
        // as link set asked before this change: the entry lines and the bundle, no approves section
        T.ask(['link', 'set', 'companion', 'title', 'Companion']);
        const mainConsole = T.links().console;
        const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
        const next = { ...mainConsole, gates: { test: 'true' } };
        q1 = 'q-20261118-120000002-supervisor';
        const context = `The settings diff this answer approves, each links entry main has and what would land:\nlinks.console: main has ${canon(mainConsole)}; would be ${canon(next)}\n\nThe registry entries, as they would be in settings.md links (merge lands exactly these under this answer, and no other):\n${JSON.stringify({ console: next }, null, 2)}`;
        fs.appendFileSync(T.logFile(), line({ id: q1, type: 'question', op: 'new', at: new Date(Date.now() - 60000).toISOString(), by: 'supervisor', kind: 'owner-decision', class: 'gate-change', question: 'Change the repo link console (gates)?', context, recommendation: 'yes' }));
      }
      T.yes(q1);
      T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q1]);
      T.onMain((j) => { j.links.console.worktree_setup = 'npm ci'; });
      const wt = chore(T, 'registry');
      assert.deepEqual([choreLinks(wt).console.gates, choreLinks(wt).console.worktree_setup], [{ test: 'true' }, 'npm ci'], 'gates carried, main\'s worktree_setup kept');
      wouldMerge(dry(T, 'registry', q1), 'registry');
    } finally { T.done(); }
  }
});

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
