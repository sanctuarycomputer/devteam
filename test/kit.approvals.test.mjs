import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { threadsFixture, multiFixture, write, json } from './lib/kit.mjs';

test('a repo link approved by the owner lands under any chore slug, still only as the question showed it', () => {
  const F = multiFixture('link-any-slug');
  const { old, g, okIn, runIn } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const add = ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site', '--main_branch', 'trunk'];
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
  const hash = (e) => `sha256:${crypto.createHash('sha256').update(canon(e)).digest('hex')}`;
  const linksAt = (f) => JSON.parse(/```json devteam\s*\n([\s\S]*?)\n```/.exec(fs.readFileSync(f, 'utf8'))[1]).links;
  try {
    const qid = /q-[0-9]+-[0-9]+-supervisor/.exec(okIn(old, add, SUP))[0];
    okIn(old, ['answer', qid, 'yes']);
    okIn(old, [...add, '--approved', qid], SUP);
    const approvedEntry = linksAt(F.settingsFile).docs;
    // A2: the act names the change (the link), not a chore slug
    const act = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.approved_by === qid);
    assert.deepEqual(act.refs, ['link:docs'], 'a link act names the change, not chore-registry');
    assert.equal(act.entry_hash, hash(approvedEntry), 'the act binds the entry the owner approved');
    assert.equal(act.prior_hash, null, 'an add: main has no entry');
    // a chore off main: fn writes it, then it is committed, pushed and given its PR text
    const chore = (slug, fn) => {
      g(['fetch', '-q', 'origin'], old);
      const wt = path.join(old, '.worktrees', `chore-${slug}`);
      g(['worktree', 'add', '-q', '-b', `chore-${slug}`, wt, 'origin/main'], old);
      fn(wt);
      g(['add', '-A'], wt);
      g(['commit', '-q', '--allow-empty', '-m', `chore-${slug}: docs repo`], wt);
      g(['push', '-q', 'origin', `chore-${slug}`], wt);
      write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: docs repo\n\n## One-way doors\n\nNone.\n`);
      return wt;
    };
    const dry = (slug) => { const r = runIn(old, ['merge', '--chore', slug, '--dry-run', '--approved', qid], SUP); return { status: r.status, text: `${r.out}\n${r.err}` }; };
    // A1: a chore named for what it does lands the approved entry under the one answer
    chore('docs-repo', () => assert.match(okIn(old, ['link', 'land', 'docs-repo'], SUP), /links\.docs \(added\)/));
    const a1 = dry('docs-repo');
    assert.equal(a1.status, 0, a1.text);
    assert.match(a1.text, /ok: chore-docs-repo at \w{12} would merge/);
    assert.doesNotMatch(a1.text, /already approved|changes owner settings/);
    // A3a: an entry other than the one the question showed is refused by name
    chore('docs-other', (wt) => F.edit((j) => { j.links ??= {}; j.links.docs = { ...approvedEntry, remote: 'usbclub/elsewhere' }; }, wt));
    const a3a = dry('docs-other');
    assert.notEqual(a3a.status, 0, a3a.text);
    assert.match(a3a.text, /links\.docs[^\n]*which q-\S+ did not approve/);
    // A3b: the approved entry plus a kit file: the answer approved link entries only
    chore('docs-kit', (wt) => { okIn(old, ['link', 'land', 'docs-kit'], SUP); write(path.join(wt, 'docs/devteam/scripts/x.mjs'), 'export {};\n'); });
    const a3b = dry('docs-kit');
    assert.notEqual(a3b.status, 0, a3b.text);
    assert.match(a3b.text, /approved repo link entries only/);
    assert.match(a3b.text, /docs\/devteam\/scripts\/x\.mjs/);
    // A3b': the approved entry plus another owner setting of the answer's class (governance-edit)
    chore('docs-setting', (wt) => { okIn(old, ['link', 'land', 'docs-setting'], SUP); F.edit((j) => { j.agent_command = 'echo other'; }, wt); });
    const a3s = dry('docs-setting');
    assert.notEqual(a3s.status, 0, a3s.text);
    assert.match(a3s.text, /approved repo link entries only[^\n]*also changes agent_command/);
    // A3c: a chore that lands no link at all
    chore('docs-none', (wt) => write(path.join(wt, 'docs/devteam/project/notes.md'), 'notes\n'));
    const a3c = dry('docs-none');
    assert.notEqual(a3c.status, 0, a3c.text);
    assert.match(a3c.text, /approved repo link entries only/);
    // A3d: one landing; after it the answer approves nothing more
    const real = runIn(old, ['merge', '--chore', 'docs-repo', '--approved', qid], SUP);
    assert.equal(real.status, 0, `${real.out}\n${real.err}`);
    assert.ok(json(okIn(old, ['log', '--type', 'act', '--json'])).some((a) => a.class === 'merge-chore' && a.approved_by === qid), 'the merge is logged under the answer');
    chore('docs-again', (wt) => write(path.join(wt, 'docs/devteam/project/notes-again.md'), 'again\n'));
    const a3d = dry('docs-again');
    assert.notEqual(a3d.status, 0, a3d.text);
    assert.match(a3d.text, /already approved/);
  } finally { F.done(); }
});

test('ask refuses a goal approval asked as another kind, so goal decide can use the yes', () => {
  const F = threadsFixture('approval-kind');
  try {
    const R = ['--stake', '1', '--urgency', '1'];
    const cmd = (g) => new RegExp(`ask --kind goal-approval --goal ${g}`);
    const refused = (args, g = F.goal) => assert.match(F.fails([...args, ...R], F.SUP), cmd(g), args.join(' '));
    const asked = (args) => { const id = F.sup([...args, ...R]).split('\n')[0]; assert.match(id, /^q-/, args.join(' ')); return id; };
    const openFor = (g) => JSON.parse(F.owner(['questions', '--json'])).filter((q) => q.goal === g && q.status === 'open').map((q) => q.id).sort();
    const on = (...a) => ['ask', '--goal', F.goal, ...a];
    const before = openFor(F.goal);
    // DW1: an approval of the draft goal asked as another kind is refused, naming the command
    refused(on('--kind', 'owner-decision', '--question', 'Ready to build the goal as the design says?', '--choices', JSON.stringify([{ label: 'Approve' }, { label: 'Refine' }]))); // A1a
    refused(on('--question', 'Approve launch checkout?')); // A1b
    refused(on('--question', 'Do you approve the design?')); // A1c
    refused(on('--question', 'Is the goal ready to build?', '--options', 'Approve', 'Refine')); // A1d
    refused(on('--question', 'Is the goal ready to build?', '--recommendation', 'Approve'));
    refused(on('--question', 'Is the goal ready to build?', '--default', 'Approve'));
    refused(on('--kind', 'clarification', '--question', 'Approve the goal?')); // A1e
    const T = F.owner(['thread', 'new', 'About checkout', '--title', 'Checkout']).split('\n')[0];
    refused(['thread', 'ask', T, '--goal', F.goal, '--question', 'Approve the goal?']); // A1f
    for (const q of ['Sign off on the plan?', 'Can we get approval of the approach?', 'Green-light launch checkout?']) refused(on('--question', q)); // A1g
    assert.deepEqual(openFor(F.goal), before, 'A1h: no refused call recorded a question');
    // DW2: questions that legitimately name a draft goal are asked
    asked(on('--kind', 'goal-definition', '--question', "Approve the goal's measure as self-serve share?")); // A2a
    asked(on('--kind', 'one-way-door', '--question', 'Approve the design: move orders to a new database?', '--recommendation', 'yes')); // A2b
    asked(on('--kind', 'owner-action', '--question', 'Approve the plan in the billing console?')); // A2c
    const QD = asked(on('--question', 'Which card processor should checkout use?', '--choices', JSON.stringify([{ label: 'Stripe' }, { label: 'Adyen' }]))); // A2d
    // A2g: approvals of something else
    asked(on('--question', 'Approve the $40 card fee?'));
    asked(on('--question', 'Which processor should the design use?', '--choices', JSON.stringify([{ label: 'Approve option A' }, { label: 'Approve option B' }])));
    asked(on('--question', 'Store cards with Stripe?', '--choices', JSON.stringify([{ label: 'Approve' }, { label: 'Reject' }])));
    asked(on('--question', 'Should we approve a plan B for payments if Stripe fails?'));
    // A2f, A3c, A2e: the goal-approval path still works, goal decide approves through it, and a goal no longer draft is not caught
    const A = F.approval();
    assert.match(A.question, /^q-/);
    F.owner(['goal', 'decide', A.goal, 'approve']);
    assert.equal(JSON.parse(F.owner(['goal', 'show', A.goal, '--json'])).status, 'ready');
    asked(['ask', '--goal', A.goal, '--question', 'Approve self-serve billing?']);
    // DW3: goal decide still takes only a goal-approval answer
    F.owner(['answer', QD, 'Stripe']);
    assert.match(F.fails(['goal', 'decide', F.goal, 'approve', '--question', QD]), /is not a goal-approval question for/); // A3a
    F.sup(['goal', 'reading', F.goal, '--run']);
    assert.match(F.fails(['goal', 'decide', F.goal, 'approve']), /has no design up for approval/); // A3b
  } finally { F.done(); }
});
