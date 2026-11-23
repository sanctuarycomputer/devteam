// The owner approves each version of project/self.md and project/exterior.md as with the strategy
// (kit-138): ask pins the draft's text and names its one chore, and check-pr and merge land a change
// to either file only under the owner's answered question of that file's own class.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json, kit as KIT, line, write } from './lib/kit.mjs';
import { fixture, SUP } from './lib/next-step-fixture.mjs';

const P = 'docs/devteam/project';
const FILES = {
  strategy: { rel: `${P}/strategy.md`, cls: 'strategy-change', title: 'The strategy' },
  self: { rel: `${P}/self.md`, cls: 'self-change', title: 'The Self' },
  exterior: { rel: `${P}/exterior.md`, cls: 'exterior-change', title: 'The exterior' },
};
const said = (r) => ({ status: r.status, text: `${r.out}\n${r.err}` });
// a refusal: a non-zero exit and its own words (a warning with the exit unchanged is not one)
const refused = (r, pattern, m) => { assert.notEqual(r.status, 0, `${m}: exits non-zero\n${r.text}`); assert.match(r.text, pattern, m); };
// a disk that ignores case (macOS, Windows) makes a twin the file itself; CI's disk doesn't
const caseBlind = fs.existsSync(path.join(KIT, 'SCHEMA'));
const re = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// file k's draft: its words, and for self.md a valid self@1 block too (kit-139 holds a draft that breaks
// the contract), its one part named by name, its path one the fixture has, no capitalised word in it
const draft = (k, words, name) => `# ${k}\n\n${words}\n${k === 'self' ? `\n\`\`\`self\n${JSON.stringify({ self: 1, what: 'a project the owner approves drafts of.', makes: 'the drafts these tests land.', parts: [{ id: 'project', name, what: 'the project folder.', code: ['docs/devteam/project/'] }], controls: ['its code'], not: [] }, null, 2)}\n\`\`\`\n` : ''}`;

// A fixture with a chore per draft, the owner's answers and the two gates (merge --dry-run, check-pr).
function world(name) {
  const F = fixture(name);
  const { old, ok, run, g } = F;
  const wts = new Map();
  // a chore branch off main, its files changed by change(w), pushed, with its PR file; its head
  const chore = (slug, change, { amend = false } = {}) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    if (!wts.has(slug)) { g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old); wts.set(slug, w); }
    change(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', slug, '--allow-empty', ...(amend ? ['--amend'] : [])], w);
    g(['push', '-qf', 'origin', `chore-${slug}`], w);
    write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
    return g(['rev-parse', 'HEAD'], w);
  };
  // any branch (plan/<f>, ticket/<id>) carrying changes, pushed, with its PR file; its head
  const branchOf = (branch, change) => {
    const w = path.join(old, '.worktrees', branch.replace('/', '-'));
    g(['worktree', 'add', '-q', '-b', branch, w, 'origin/main'], old);
    change(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', branch], w);
    g(['push', '-q', 'origin', branch], w);
    write(path.join(old, 'docs/devteam/run/pr', `${branch}.md`), `# ${branch.replace('/', '-')}: x\n\n## One-way doors\n\nNone.\n`);
    return g(['rev-parse', 'HEAD'], w);
  };
  const said = (r) => ({ status: r.status, text: `${r.out}\n${r.err}` });
  const merge = (slug, q) => said(run(old, ['merge', '--chore', slug, '--dry-run', ...(q ? ['--approved', q] : [])], SUP));
  const body = path.join(F.base, 'pr-body.md');
  write(body, 'x\n\n## One-way doors\n\nNone.\n');
  const checkPr = (headRef, sha, q) => said(run(old, ['check-pr', '--head-ref', headRef, '--sha', sha, '--title', `${headRef}: x`, '--body-file', body, ...(q ? ['--approved', q] : [])]));
  const link = (k, ref) => ({ title: FILES[k].title, path: FILES[k].rel, ref });
  // ask about file k's draft on chore-<slug>: self-change and exterior-change name the chore, as ask requires
  let n = 0;
  const askRun = (k, slug, { approves = k === 'strategy' ? null : `chore-${slug}`, links, cls = FILES[k].cls, more = [] } = {}) => run(old, ['ask', '--question', `Approve this draft (${++n})?`, '--recommendation', 'yes', '--stake', '3', '--urgency', '2', '--new-because', 'the test asks again',
    ...(cls ? ['--class', cls, '--reasons', 'owner-only'] : []),
    ...(links === null ? [] : ['--links', JSON.stringify(links ?? [link(k, `chore-${slug}`)])]),
    ...(approves ? ['--approves', approves] : []), ...more], SUP);
  const ask = (k, slug, o) => { const r = askRun(k, slug, o); assert.equal(r.status, 0, r.err); return r.out.trim(); };
  const answered = (k, slug, o, answer = 'yes') => { const q = ask(k, slug, o); ok(old, ['answer', q, answer]); return q; };
  // a release-scope or classless question, answered yes
  const other = (cls) => { const q = ok(old, ['ask', '--question', `Something else (${++n})?`, '--recommendation', 'yes', '--stake', '1', '--urgency', '1', '--new-because', 'the test asks again', ...(cls ? ['--class', cls, '--reasons', 'below-rung', '--no-default', 'the test waits'] : [])], SUP).trim(); ok(old, ['answer', q, 'yes']); return q; };
  const onMain = (rel, text) => { write(path.join(old, rel), text); g(['add', '-A'], old); g(['commit', '-qm', `main: ${rel}`], old); g(['push', '-q', 'origin', 'main'], old); };
  const supLine = (o) => fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), line({ at: new Date().toISOString(), by: 'supervisor', ...o }));
  // check-pr's exit on a chore that changes only a project note: what a warning must leave it at
  const baseline = () => { const sha = chore('notes-only', (w) => write(path.join(w, `${P}/designs/notes.md`), 'n\n')); const r = checkPr('chore-notes-only', sha); assert.equal(r.status, 0, `check-pr passes a chore that changes only a project note\n${r.text}`); return r.status; };
  return { ...F, branchOf, baseline, chore, merge, checkPr, link, askRun, ask, answered, other, onMain, supLine };
}

for (const k of ['self', 'exterior']) {
  const { rel, cls } = FILES[k];
  const otherK = k === 'self' ? 'exterior' : 'self';
  const twinRel = rel.replace(`${k}.md`, `${k.toUpperCase()}.md`);

  test(`${rel} is the owner's: check-pr and merge land a change only under an answered ${cls} question pinned to the text`, () => {
    const W = world(`wa-${k}`);
    const { chore, merge, checkPr, answered, other, supLine } = W;
    try {
      // a first draft, in a chore: refused with no answer, at merge and at check-pr
      const sha = chore('a', (w) => write(path.join(w, rel), draft(k, 'Draft A.', 'draft a')));
      const none = merge('a');
      assert.notEqual(none.status, 0);
      assert.match(none.text, new RegExp(`changes ${re(rel)}: .*the owner's answer is needed: ask --class ${cls}`), 'DW1 no answer, merge');
      const cp0 = checkPr('chore-a', sha);
      assert.match(cp0.text, new RegExp(`warn: changes ${re(rel)}: .*ask --class ${cls}`), 'DW1 no answer, check-pr warns');
      assert.equal(cp0.status, W.baseline(), 'DW1 no answer, check-pr exits as a notes-only chore does');
      // answers of another class approve nothing, naming the file
      refused(merge('a', other('release-scope')), new RegExp(`is a release-scope question; changing ${re(rel)} needs an answered ${cls} question`));
      refused(merge('a', other(null)), new RegExp(`is a classless question; changing ${re(rel)} needs an answered ${cls} question`));
      chore('o', (w) => write(path.join(w, FILES[otherK].rel), `# ${otherK}\n\nIts draft.\n`));
      const wrong = answered(otherK, 'o');
      refused(merge('a', wrong), new RegExp(`is a ${FILES[otherK].cls} question; changing ${re(rel)} needs an answered ${cls} question`), 'DW1 the other file\'s class, merge');
      refused(checkPr('chore-a', sha, wrong), new RegExp(`is a ${FILES[otherK].cls} question; changing ${re(rel)} needs an answered ${cls} question`), 'DW1 the other file\'s class, check-pr');
      // a non-recommendation answer, a supervisor's answer and a defaulted question approve nothing
      const declined = answered(k, 'a', {}, 'no, redraft it');
      refused(merge('a', declined), /not its recommendation/, 'DW2 non-recommendation');
      // check-pr reads the answer only through the gate, so each of these is tried there too
      refused(checkPr('chore-a', sha, declined), /check-pr --approved: .* not its recommendation/, 'DW2 non-recommendation, check-pr');
      const bySup = W.ask(k, 'a');
      supLine({ id: bySup, type: 'question', op: 'set', answer: 'yes' });
      refused(merge('a', bySup), /is not a question the owner answered/, 'DW2 supervisor answer');
      refused(checkPr('chore-a', sha, bySup), /check-pr --approved: .* is not a question the owner answered/, 'DW2 supervisor answer, check-pr');
      const defaulted = W.ask(k, 'a');
      supLine({ id: defaulted, type: 'question', op: 'set', status: 'defaulted' });
      refused(merge('a', defaulted), /is not a question the owner answered/, 'DW2 defaulted');
      refused(checkPr('chore-a', sha, defaulted), /check-pr --approved: .* is not a question the owner answered/, 'DW2 defaulted, check-pr');
      // the owner's yes lands it, at merge and at check-pr
      const yes = answered(k, 'a');
      const landed = merge('a', yes);
      assert.equal(landed.status, 0, landed.text);
      const cp = checkPr('chore-a', sha, yes);
      assert.equal(cp.status, 0, cp.text);
      // a question line written by hand, pinning a blob that is not the draft's: no pin this repo can show
      const hand = `q-20260105-000000001-supervisor`;
      supLine({ id: hand, type: 'question', op: 'new', kind: 'owner-decision', class: cls, reasons: ['owner-only'], question: 'Approve this draft (by hand)?', recommendation: 'yes', approves: ['chore-a'], links: [{ title: FILES[k].title, path: rel, ref: sha, blob: 'a'.repeat(40) }] });
      W.ok(W.old, ['answer', hand, 'yes']);
      refused(merge('a', hand), new RegExp(`${hand} pins no draft of ${re(rel)} that this repo can show`), 'DW1 step 8: no pin the repo shows');
      // the same answer cited for a plan or a ticket PR carrying that very text: its question names the chore
      const G = W.goal('Billing', 1);
      W.feature('billing', G);
      W.ticket('billing-01-a', 'billing');
      const draftA = (w) => write(path.join(w, rel), draft(k, 'Draft A.', 'draft a'));
      const planSha = W.branchOf('plan/billing', draftA);
      const ticketSha = W.branchOf('ticket/billing-01-a', draftA);
      refused(checkPr('plan/billing', planSha, yes), new RegExp(`${yes} approves chore-a, not plan-billing`), 'DW1 plan PR, check-pr');
      // a ticket whose id reads like the chore's act is still no chore
      refused(checkPr('ticket/chore-a', sha, yes), new RegExp(`${yes} approves chore-a, not ticket/chore-a: a change to ${re(rel)}`), 'DW1 a ticket named chore-a, check-pr');
      refused(checkPr('ticket/billing-01-a', ticketSha, yes), new RegExp(`${yes} approves chore-a, not billing-01-a`), 'DW1 ticket PR, check-pr');
      refused(said(W.run(W.old, ['merge', '--plan', 'billing', '--dry-run', '--approved', yes], SUP)), new RegExp(`${yes} approves chore-a, not plan-billing: a change to ${re(rel)}`), 'DW1 plan PR, merge');
      const planQ = 'q-20260105-000000002-supervisor';
      supLine({ id: planQ, type: 'question', op: 'new', kind: 'owner-decision', class: cls, reasons: ['owner-only'], question: 'Approve the plan\'s draft (by hand)?', recommendation: 'yes', approves: ['plan-billing'], links: [{ title: FILES[k].title, path: rel, ref: 'plan/billing', blob: W.g(['rev-parse', `plan/billing:${rel}`], W.old) }] });
      W.ok(W.old, ['answer', planQ, 'yes']);
      refused(checkPr('plan/billing', planSha, planQ), new RegExp(`${planQ} approves plan-billing, not plan-billing: a change to ${re(rel)} lands only in the chore`), 'DW1 a hand-written line naming the plan, check-pr');
      refused(said(W.run(W.old, ['merge', 'billing-01-a', '--dry-run', '--approved', yes], SUP)), new RegExp(`${yes} approves chore-a, not billing-01-a: a change to ${re(rel)}`), 'DW1 ticket PR, merge');
      // amended after the answer: the owner never saw it
      const sha2 = chore('a', (w) => write(path.join(w, rel), draft(k, 'Draft B, never seen.', 'draft b')), { amend: true });
      refused(merge('a', yes), new RegExp(`${re(rel)} at the head is not the text ${yes} asked the owner about`), 'DW1 amended, merge');
      refused(checkPr('chore-a', sha2, yes), new RegExp(`${re(rel)} at the head is not the text ${yes} asked the owner about`), 'DW1 amended, check-pr');
      // a case-twin of the file
      const twinSha = chore('twin', (w) => write(path.join(w, twinRel), `# ${k}\n\nA twin.\n`));
      const twinSays = new RegExp(`adds ${re(twinRel)}, which a disk that ignores case can't tell from ${re(rel)}${caseBlind ? `|changes ${re(rel)}` : ''}`);
      refused(merge('twin'), twinSays, 'DW1 case-twin, merge');
      const tw = checkPr('chore-twin', twinSha, yes);
      assert.notEqual(tw.status, 0, 'DW1 case-twin, check-pr --approved');
      assert.match(tw.text, twinSays, 'DW1 case-twin, check-pr --approved');
      const tw0 = checkPr('chore-twin', twinSha);
      assert.match(tw0.text, new RegExp(`warn: (${twinSays.source})`), 'DW1 case-twin, check-pr warns');
      assert.equal(tw0.status, W.baseline(), 'DW1 case-twin, check-pr exit unchanged');
    } finally { W.done(); }
  });

  test(`${rel} on main: emptying it needs the owner's answer like any change, and deleting it is never approved`, () => {
    const W = world(`wa-${k}-main`);
    const { chore, merge, answered, onMain } = W;
    try {
      onMain(rel, `# ${k}\n\nThe approved version.\n`);
      chore('empty', (w) => write(path.join(w, rel), ''));
      refused(merge('empty'), new RegExp(`changes ${re(rel)}: .*ask --class ${cls}`), 'DW1 emptied');
      // an empty self.md breaks the self@1 contract (it is no deletion), so even the owner's yes doesn't land it
      if (k === 'self') refused(merge('empty', answered(k, 'empty')), /breaks self@1/, 'an empty self.md breaks the contract, answered or not');
      else assert.equal(merge('empty', answered(k, 'empty')).status, 0, 'an empty version the owner saw and approved lands');
      // changed: a new text needs its own answer
      chore('edit', (w) => write(path.join(w, rel), draft(k, 'The next version.', 'next version')));
      refused(merge('edit'), new RegExp(`changes ${re(rel)}: .*ask --class ${cls}`), 'DW1 changed, no answer');
      assert.equal(merge('edit', answered(k, 'edit')).status, 0, 'DW1 changed, the owner\'s yes lands it');
      // deleted: no draft to pin (ask refuses), and an answer from before the deletion pins a text the head lacks
      chore('gone', (w) => write(path.join(w, rel), draft(k, 'A last version.', 'last version')));
      const q = answered(k, 'gone');
      const goneSha = chore('gone', (w) => fs.rmSync(path.join(w, rel)), { amend: true });
      refused(merge('gone'), new RegExp(`changes ${re(rel)}: .*ask --class ${cls}`), 'DW1 deleted, no answer');
      assert.match(W.askRun(k, 'gone').err, /commit the draft to its branch first/, 'DW2 deleted: nothing to pin');
      refused(merge('gone', q), new RegExp(`${re(rel)} at the head is not the text ${q} asked the owner about \\(no file,`), 'DW1 deleted, never approved');
      refused(W.checkPr('chore-gone', goneSha, q), new RegExp(`${re(rel)} at the head is not the text ${q} asked the owner about \\(no file,`), 'DW1 deleted, check-pr');
    } finally { W.done(); }
  });

  test(`ask about ${rel}: it pins the draft and names exactly its one chore; no default`, () => {
    const W = world(`wa-${k}-ask`);
    const { chore, askRun, ok, old, g, link } = W;
    try {
      const head = chore('s', (w) => write(path.join(w, rel), `# ${k}\n\nDraft.\n`));
      chore('t', (w) => write(path.join(w, rel), `# ${k}\n\nAnother draft.\n`));
      assert.match(askRun(k, 's', { approves: null }).err, new RegExp(`a ${cls} question names its chore: --approves chore-<slug>`), 'DW2 --approves missing');
      assert.match(askRun(k, 's', { approves: 'chore-t' }).err, /--approves chore-t: the link pins the draft on chore-s/, 'DW2 another chore');
      assert.match(askRun(k, 's', { approves: 'chore-s,chore-t' }).err, new RegExp(`a ${cls} question approves exactly one act`), 'DW2 more acts');
      assert.match(askRun(k, 's', { approves: 'plan-billing' }).err, new RegExp(`a ${cls} question approves exactly one act, the chore chore-<slug>`), 'DW2 not a chore');
      assert.match(askRun(k, 's', { links: [link(k, head)] }).err, /--approves chore-s: the link pins the draft on /, 'DW2 a commit, not the chore\'s branch');
      assert.match(askRun(k, 's', { links: null }).err, new RegExp(`a ${cls} question links the draft it asks about`), 'DW2 no link');
      assert.match(askRun(k, 's', { links: [{ title: 'x', path: rel }] }).err, new RegExp(`a ${cls} question links the draft it asks about`), 'DW2 link with no ref');
      assert.match(askRun(k, 'nope', { links: [link(k, 'chore-nope')] }).err, /commit the draft to its branch first/, 'DW2 no draft there');
      assert.match(askRun(k, 's', { more: ['--default', 'yes', '--deadline', '2099-01-01T00:00:00Z'] }).err, new RegExp(`${cls} is the owner's \\(constitution\\.md §1\\): no --default`), 'DW2 no default');
      const r = askRun(k, 's');
      assert.equal(r.status, 0, r.err);
      const q = json(ok(old, ['questions', '--id', r.out.trim(), '--json']))[0];
      assert.deepEqual(q.approves, ['chore-s'], 'DW2 approves is exactly the chore, the field next-moves\' C1 reads');
      assert.equal(q.links[0].ref, head, 'DW2 the link names the commit');
      assert.equal(q.links[0].blob, g(['rev-parse', `chore-s:${rel}`], old), 'DW2 the draft\'s blob is pinned');
      // every other class keeps the two-act rule
      assert.match(askRun('strategy', 's', { approves: 'chore-s', links: [] }).err, /--approves names two or more acts/, 'DW2 other classes unchanged');
      // and so does a question of no class, or a ladder class, naming one act (a-20261122-095055213-supervisor)
      assert.match(askRun('strategy', 's', { cls: null, approves: 'chore-s', links: [] }).err, /--approves names two or more acts/, 'DW2 a classless one-act question is refused');
      assert.match(W.run(old, ['ask', '--question', 'Ship it later?', '--recommendation', 'yes', '--class', 'release-scope', '--reasons', 'below-rung', '--no-default', 'the test waits', '--approves', 'chore-s'], SUP).err, /--approves names two or more acts/, 'DW2 a release-scope one-act question is refused');
    } finally { W.done(); }
  });
}

test('one PR, one --approved: a PR changing two of strategy.md, self.md and exterior.md is refused, naming the file left unapproved', () => {
  const W = world('wa-pairs');
  const { chore, merge, checkPr, answered } = W;
  try {
    // the strategy at check-pr with no answer: a warning, the exit unchanged (ruling A)
    const sSha = chore('strategy-only', (w) => write(path.join(w, FILES.strategy.rel), '# Strategy\n\nW1 is revenue.\n'));
    const s0 = checkPr('chore-strategy-only', sSha);
    assert.match(s0.text, /warn: changes docs\/devteam\/project\/strategy\.md: the strategy is the owner's/, 'DW1 strategy at check-pr warns');
    assert.equal(s0.status, W.baseline(), 'DW1 strategy at check-pr: exit unchanged');
    for (const [x, y] of [['strategy', 'self'], ['strategy', 'exterior'], ['self', 'exterior']]) {
      const slug = `${x}-${y}`;
      const sha = chore(slug, (w) => { write(path.join(w, FILES[x].rel), `# ${x}\n\nBoth (${slug}).\n`); write(path.join(w, FILES[y].rel), `# ${y}\n\nBoth (${slug}).\n`); });
      for (const [by, left] of [[x, y], [y, x]]) {
        const q = answered(by, slug);
        const m = merge(slug, q);
        assert.notEqual(m.status, 0, `${slug} under ${FILES[by].cls}`);
        assert.match(m.text, new RegExp(`is a ${FILES[by].cls} question; changing ${re(FILES[left].rel)} needs an answered ${FILES[left].cls} question`), `DW1 ${slug} under ${FILES[by].cls}, merge`);
        refused(checkPr(`chore-${slug}`, sha, q), new RegExp(`changing ${re(FILES[left].rel)} needs an answered ${FILES[left].cls} question`), `DW1 ${slug} under ${FILES[by].cls}, check-pr`);
      }
    }
  } finally { W.done(); }
});

test('the rules say it: owner_only, the authority rows, the pinned link\'s description and supervisor.md', () => {
  const C = fs.readFileSync(path.join(KIT, 'governance/constitution.md'), 'utf8');
  const L = json(/`{3}json devteam\s*\n([\s\S]*?)\n`{3}/.exec(C)[1]);
  for (const c of ['self-change', 'exterior-change', 'strategy-change']) assert.ok(L.owner_only.includes(c), `DW3 ${c} is owner_only`);
  for (const [f, c] of [['self.md', 'self-change'], ['exterior.md', 'exterior-change']]) assert.ok(C.split('\n').some((l) => l.startsWith('| ') && l.includes(`\`project/${f}\``) && l.includes('| owner |') && l.includes(`\`${c}\``)), `DW3 an authority row for project/${f}`);
  const S = json(fs.readFileSync(path.join(KIT, 'schema/log.schema.json'), 'utf8'));
  const blob = JSON.stringify(S).match(/"blob":\{"type":"string","pattern":"[^"]*","description":"([^"]*)"/)[1];
  for (const w of ['strategy-change', 'self-change', 'exterior-change', 'project/self.md', 'project/exterior.md']) assert.ok(blob.includes(w), `DW3 the pinned link's description names ${w}`);
  const sup = fs.readFileSync(path.join(KIT, 'process/supervisor.md'), 'utf8');
  const sec = /\n### Self and exterior changes\n([\s\S]*?)(?=\n## )/.exec(sup)?.[1];
  assert.ok(sec, 'DW4 supervisor.md has ### Self and exterior changes');
  assert.ok(sup.indexOf('### Self and exterior changes') > sup.indexOf('## 6. Questions to the owner') && sup.indexOf('### Self and exterior changes') < sup.indexOf('## 7.'), 'DW4 at the end of §6');
  for (const w of ['--approves chore-<slug>', 'public', 'separate PRs', 'self-change', 'exterior-change', 'branch', '--approved']) assert.ok(sec.includes(w), `DW4 the section says ${w}`);
});

// kit-773: each owner file is a plain file at the head, whatever the owner answered; a twin is
// found by a folded path (case folding, normalisation, trailing dots and spaces); and the gate's
// own refusals when it can't list the PR's added files or finds no merge base. Each check is
// tried and its miss kept, so one run names every check that fails, not only the first.
const checks = (label = 'kit-773') => {
  const misses = [];
  const check = (fn) => { try { fn(); } catch (e) { misses.push(String(e.message).split('\n')[0]); } };
  return { check, none: () => assert.deepEqual(misses, [], `${label} misses:\n${misses.join('\n')}`) };
};

for (const k of ['strategy', 'self', 'exterior']) {
  const { rel } = FILES[k];

  test(`kit-773: ${rel} that is a symlink, a submodule or a folder is refused, whatever the owner answered`, () => {
    const W = world(`wa-plain-${k}`);
    const { chore, merge, checkPr, answered, old, g } = W;
    const { check, none } = checks();
    try {
      const kinds = [
        ['symlink', 'a symlink', (w) => { write(path.join(w, `${P}/designs/n.md`), `# ${k}\n\nRead through a link.\n`); fs.rmSync(path.join(w, rel), { force: true }); fs.symlinkSync('designs/n.md', path.join(w, rel)); }],
        ['gitlink', 'a submodule', (w) => { const d = path.join(w, rel); fs.rmSync(d, { force: true }); fs.mkdirSync(d, { recursive: true }); g(['init', '-q'], d); g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'sub'], d); }],
        ['folder', 'a folder', (w) => { fs.rmSync(path.join(w, rel), { force: true }); write(path.join(w, rel, 'x.md'), `# ${k}\n\nA folder.\n`); }],
      ];
      for (const [slug, words, change] of kinds) {
        const sha = chore(slug, change);
        const yes = answered(k, slug);
        const says = new RegExp(`${re(rel)} is ${words} at the head, not a plain file`);
        check(() => refused(merge(slug, yes), says, `kit-773 DW1 ${slug} under the owner's yes, merge`));
        check(() => refused(checkPr(`chore-${slug}`, sha, yes), says, `kit-773 DW1 ${slug} under the owner's yes, check-pr`));
        // check-pr with no --approved warns, its exit as for a notes-only chore (kit-138's ruling A)
        if (slug === 'symlink') check(() => { const r = checkPr(`chore-${slug}`, sha); assert.match(r.text, new RegExp(`warn: ${says.source}`), `kit-773 DW1 ${slug}, check-pr with no answer warns`); });
      }
      // already a symlink on main: a PR that changes only what it points at is refused too
      write(path.join(old, `${P}/designs/n.md`), 'On main.\n');
      fs.rmSync(path.join(old, rel), { force: true });
      fs.symlinkSync('designs/n.md', path.join(old, rel));
      g(['add', '-A'], old); g(['commit', '-qm', 'main: a link'], old); g(['push', '-q', 'origin', 'main'], old);
      const tsha = chore('target', (w) => write(path.join(w, `${P}/designs/n.md`), 'Words the owner never saw.\n'));
      check(() => refused(merge('target'), new RegExp(`${re(rel)} is a symlink at the head, not a plain file`), 'kit-773 DW1 a symlink on main, its target changed, merge'));
      check(() => refused(checkPr('chore-target', tsha, W.other(null)), new RegExp(`${re(rel)} is a symlink at the head, not a plain file`), 'kit-773 DW1 a symlink on main, its target changed, check-pr --approved'));
      none();
    } finally { W.done(); }
  });

  test(`kit-773: a folded twin of ${rel} (long s, trailing dot, trailing space) is refused`, () => {
    const W = world(`wa-fold-${k}`);
    const { chore, merge } = W;
    const { check, none } = checks();
    try {
      const twins = [
        ['longs', rel.replace(/^docs\//, 'docſ/')],
        ['dot', `${rel}.`],
        ['space', `${rel} `],
        ...(k === 'exterior' ? [] : [['longs-name', rel.replace(`/${k}.md`, `/ſ${k.slice(1)}.md`)]]),
      ];
      for (const [slug, twin] of twins) {
        chore(slug, (w) => write(path.join(w, twin), `# ${k}\n\nA twin.\n`));
        // on a disk that folds names (caseBlind) the twin is written onto the file itself
        check(() => refused(merge(slug), new RegExp(`adds ${re(twin)}, which a disk that ignores case can't tell from ${re(rel)}${caseBlind ? `|changes ${re(rel)}` : ''}`), `kit-773 DW2 ${slug} twin of ${k}.md, merge`));
      }
      none();
    } finally { W.done(); }
  });
}

test('kit-773: in a project folder spelled with an accent, an NFD spelling of each owner file is a twin', () => {
  const W = world('wa-fold-nfd');
  const { old, g, run } = W;
  const { check, none } = checks();
  try {
    const NFC = 'docs/devteam/projé';
    const NFD = 'docs/devteam/projé';
    g(['mv', P, NFC], old); g(['commit', '-qm', 'main: the project folder, accented'], old); g(['push', '-q', 'origin', 'main'], old);
    const env = { ...SUP, DEVTEAM_PROJECT: path.join(old, NFC) };
    for (const f of ['strategy.md', 'self.md', 'exterior.md']) {
      const slug = `nfd-${f.replace('.md', '')}`;
      const w = path.join(old, '.worktrees', `chore-${slug}`);
      g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
      write(path.join(w, NFD, f), '# A twin.\n');
      g(['add', '-A'], w); g(['commit', '-qm', slug], w); g(['push', '-q', 'origin', `chore-${slug}`], w);
      write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
      check(() => refused(said(run(old, ['merge', '--chore', slug, '--dry-run'], env)), new RegExp(`adds ${re(`${NFD}/${f}`)}, which a disk that ignores case can't tell from ${re(`${NFC}/${f}`)}${caseBlind ? `|changes ${re(`${NFC}/${f}`)}` : ''}`), `kit-773 DW2 NFD twin of ${f}, merge`));
    }
    none();
  } finally { W.done(); }
});

test('kit-773: the gate refuses on its own when it can\'t list the files a PR adds, or finds no merge base', () => {
  const W = world('wa-fail-closed');
  const { chore, merge, checkPr, old, g } = W;
  const { check, none } = checks();
  try {
    const yes = W.other(null);
    // the added-files diff fails: a tree only the diff reads is missing from the object store
    const sha = chore('gone', (w) => write(path.join(w, `${P}/designs/deep/er/x.md`), 'x\n'));
    const tree = g(['rev-parse', `${sha}:${P}/designs/deep/er`], old);
    for (const objects of [path.join(old, '.git/objects'), path.join(W.org, 'objects')]) fs.rmSync(path.join(objects, tree.slice(0, 2), tree.slice(2)), { force: true });
    const cannot = new RegExp(`could not list the files ${sha.slice(0, 12)} adds or changes since [0-9a-f]{12}, so a change to the owner's files can't be ruled out`);
    check(() => refused(merge('gone'), cannot, 'kit-773 DW3 the diff fails, merge'));
    check(() => refused(checkPr('chore-gone', sha, yes), cannot, 'kit-773 DW3 the diff fails, check-pr --approved'));
    // no merge base: an orphan chore carrying self.md
    const w = path.join(old, '.worktrees', 'chore-orphan');
    g(['worktree', 'add', '-q', '-b', 'chore-orphan-from', w, 'origin/main'], old);
    g(['checkout', '-q', '--orphan', 'chore-orphan'], w);
    write(path.join(w, FILES.self.rel), '# self\n\nFrom nowhere.\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'orphan'], w); g(['push', '-q', 'origin', 'chore-orphan'], w);
    write(path.join(old, 'docs/devteam/run/pr/chore-orphan.md'), '# chore-orphan: x\n\n## One-way doors\n\nNone.\n');
    const osha = g(['rev-parse', 'HEAD'], w);
    const noBase = new RegExp(`${osha.slice(0, 12)} has no merge base with main, so a change to the owner's files can't be ruled out`);
    check(() => refused(merge('orphan'), noBase, 'kit-773 DW3 no merge base, merge'));
    check(() => refused(checkPr('chore-orphan', osha, yes), noBase, 'kit-773 DW3 no merge base, check-pr --approved'));
    // the project folder's listing doesn't read as a folder (here a symlink in its place): refused, never read as plain files
    const lsha = chore('folder-link', (w) => { fs.rmSync(path.join(w, P), { recursive: true, force: true }); fs.symlinkSync('elsewhere', path.join(w, P)); });
    const unread = new RegExp(`could not read ${re(P)} at ${lsha.slice(0, 12)} as a folder, so the owner's files can't be judged plain files`);
    check(() => refused(checkPr('chore-folder-link', lsha, yes), unread, 'kit-773 DW1 the project folder unread, check-pr --approved'));
    // a file in the folder's place whose text reads like a listing: still no folder (task-1 F1)
    const fsha = chore('folder-forged', (w) => { fs.rmSync(path.join(w, P), { recursive: true, force: true }); write(path.join(w, P), `100644 blob ${'0'.repeat(40)}\tnotes.md\n`); });
    check(() => refused(checkPr('chore-folder-forged', fsha, yes), new RegExp(`could not read ${re(P)} at ${fsha.slice(0, 12)} as a folder`), 'kit-773 DW1 a file forged as the project folder\'s listing, check-pr --approved'));
    none();
  } finally { W.done(); }
});

test('kit-773: ask pins the draft on the chore\'s branch when a tag has the same name', () => {
  const W = world('wa-ask-tag');
  const { chore, askRun, ok, old, g } = W;
  try {
    const rel = FILES.self.rel;
    chore('s', (w) => write(path.join(w, rel), '# self\n\nThe branch\'s draft.\n'));
    const other = chore('t', (w) => write(path.join(w, rel), '# self\n\nThe tag\'s text.\n'));
    g(['tag', 'chore-s', other], old);
    const r = askRun('self', 's');
    assert.equal(r.status, 0, r.err);
    const q = json(ok(old, ['questions', '--id', r.out.trim(), '--json']))[0];
    assert.equal(q.links[0].blob, g(['rev-parse', `refs/heads/chore-s:${rel}`], old), 'kit-773 DW3 a same-named tag: the pin is the branch\'s draft');
  } finally { W.done(); }
});

// kit-776: a branch off main whose tree is set through the index, never the disk, so a twin a
// folding disk can't hold is still committed. entries: [path, text, mode] (mode 100644 if left
// out; 120000 makes text a symlink's target); a null text removes the path. onto: 'main' pushes the
// commit to origin's main (the gate reads origin/main), else it is pushed as its own branch with a
// PR file. Returns the commit.
function indexed(W, branch, entries, { onto } = {}) {
  const { old, g, base } = W;
  const w = path.join(old, '.worktrees', `ix-${branch.replace(/\//g, '-')}`);
  g(['worktree', 'add', '-q', '--no-checkout', '-b', branch, w, 'origin/main'], old);
  g(['read-tree', 'HEAD'], w);
  let n = 0;
  for (const [p, text, mode = '100644'] of entries) {
    if (text === null) { g(['update-index', '--force-remove', p], w); continue; }
    const f = path.join(base, `ix-${branch.replace(/\//g, '-')}-${++n}`);
    fs.writeFileSync(f, text);
    g(['update-index', '--add', '--cacheinfo', `${mode},${g(['hash-object', '-w', f], w)},${p}`], w);
  }
  g(['commit', '-qm', branch], w);
  if (onto === 'main') g(['push', '-q', 'origin', `HEAD:main`], w);
  else {
    g(['push', '-q', 'origin', branch], w);
    write(path.join(old, 'docs/devteam/run/pr', `${branch}.md`), `# ${branch.replace('/', '-')}: x\n\n## One-way doors\n\nNone.\n`);
  }
  return g(['rev-parse', 'HEAD'], w);
}

test('kit-776: an added path one of whose folders folds to an owner file or a folder on its path is refused', () => {
  const W = world('wa-twin-folders');
  const { merge, checkPr, run, old } = W;
  const { check, none } = checks('kit-776');
  try {
    const yes = W.other(null);
    const mergeOf = (branch) => said(run(old, ['merge', ...(branch.startsWith('plan/') ? ['--plan', branch.slice(5)] : branch.startsWith('ticket/') ? [branch.slice(7)] : ['--chore', branch.slice(6)]), '--dry-run'], SUP));
    const G = W.goal('Billing', 1);
    W.feature('billing', G);
    W.ticket('billing-01-a', 'billing');
    for (const id of ['billing-02-b', 'billing-03-c', 'billing-04-d']) W.ticket(id, 'billing');
    // a folder named as an owner file, in a chore: in a folder a folding disk can't tell from the file
    for (const k of ['strategy', 'self', 'exterior']) {
      const { rel } = FILES[k];
      const f = rel.replace(`${k}.md`, `${k.toUpperCase()}.md/x.md`);
      const slug = `fold-in-${k}`;
      const sha = indexed(W, `chore-${slug}`, [[f, 'x\n']]);
      const says = new RegExp(`adds ${re(f)}, in a folder a disk that ignores case can't tell from ${re(rel)}`);
      check(() => refused(merge(slug), says, `kit-776 DW1 ${k.toUpperCase()}.md/x.md, merge`));
      check(() => refused(checkPr(`chore-${slug}`, sha, yes), says, `kit-776 DW1 ${k.toUpperCase()}.md/x.md, check-pr --approved`));
    }
    // twins of the project folder (a symlink, a case twin, a trailing dot) and of each folder above
    // it, in ticket and plan PRs; each line names the folder it can't be told from, and ends there
    const folderTwins = [
      ['ticket/billing-01-a', 'docs/devteam/PROJECT', 'elsewhere', '120000', 'which', P, 'a symlink twin of the project folder, ticket PR'],
      ['plan/billing', 'docs/devteam/PROJECT/x.md', 'x\n', '100644', 'in a folder', P, 'a case-twin project folder, plan PR'],
      ['ticket/billing-04-d', `${P}./notes.md`, 'x\n', '100644', 'in a folder', P, 'a trailing-dot twin of the project folder, ticket PR'],
      ['ticket/billing-02-b', 'docs/DevTeam/x.md', 'x\n', '100644', 'in a folder', 'docs/devteam', 'a case twin of the folder above the project folder, ticket PR'],
      ['ticket/billing-03-c', 'Docs/x.md', 'x\n', '100644', 'in a folder', 'docs', 'a case twin of the top folder, ticket PR'],
    ];
    for (const [branch, f, text, mode, how, at, m] of folderTwins) {
      const sha = indexed(W, branch, [[f, text, mode]]);
      const says = new RegExp(`adds ${re(f)}, ${how} a disk that ignores case can't tell from ${re(at)}[;:]`);
      check(() => refused(mergeOf(branch), says, `kit-776 DW1 ${m}, merge`));
      check(() => refused(checkPr(branch, sha, yes), says, `kit-776 DW1 ${m}, check-pr --approved`));
    }
    // over-refusal: a path near the files but no fold of them, and the project folder's own notes
    for (const [slug, f] of [['near-self', `${P}/selfie/x.md`], ['near-md', `${P}/self.md.d/x.md`], ['note', `${P}/designs/n.md`]]) {
      const sha = indexed(W, `chore-${slug}`, [[f, 'x\n']]);
      check(() => { const r = merge(slug); assert.equal(r.status, 0, `kit-776 DW1 ${f} is no twin, merge\n${r.text}`); });
      check(() => { const r = checkPr(`chore-${slug}`, sha); assert.doesNotMatch(r.text, /disk that ignores case/, `kit-776 DW1 ${f} is no twin, check-pr`); });
    }
    none();
  } finally { W.done(); }
});

test('kit-776: a change to a case twin of an owner file already on main is refused like a change to the file', () => {
  const W = world('wa-twin-on-main');
  const { merge, checkPr } = W;
  const { check, none } = checks('kit-776');
  try {
    const yes = W.other(null);
    const twinOf = (k) => FILES[k].rel.replace(`${k}.md`, `${k.toUpperCase()}.md`);
    // the twins landed before the gate looked for them
    indexed(W, 'main-twins', [...['strategy', 'self', 'exterior'].map((k) => [twinOf(k), `# ${k}\n\nA twin on main.\n`]), [`${P.replace('project', 'PROJECT')}/old.md`, 'old\n']], { onto: 'main' });
    // a file already on main in a folder twin, changed: kit-776 let it through; kit-779 names it
    // like an added one (its own test, below, covers the cases)
    const osha = indexed(W, 'chore-edit-old', [[`${P.replace('project', 'PROJECT')}/old.md`, 'new\n']]);
    check(() => { const r = checkPr('chore-edit-old', osha); assert.match(r.text, /warn: changes docs\/devteam\/PROJECT\/old\.md, in a folder a disk that ignores case can't tell from docs\/devteam\/project[;:]/, `kit-779 DW1 a file on main in a folder twin, changed, check-pr warns\n${r.text}`); });
    for (const k of ['strategy', 'self', 'exterior']) {
      const { rel } = FILES[k];
      const t = twinOf(k);
      // the chore also carries a draft of the file itself, which the owner answers yes to
      const sha = indexed(W, `chore-edit-${k}`, [[t, `# ${k}\n\nWords the owner never saw.\n`], [rel, `# ${k}\n\nThe draft the owner saw.\n`]]);
      const says = new RegExp(`changes ${re(t)}, which a disk that ignores case can't tell from ${re(rel)}`);
      check(() => refused(merge(`edit-${k}`), says, `kit-776 DW2 ${k.toUpperCase()}.md changed, merge`));
      // ruling a-20261122-192515661: refused under the file's own answer too
      const own = W.answered(k, `edit-${k}`);
      check(() => refused(merge(`edit-${k}`, own), says, `kit-776 DW2 ${k.toUpperCase()}.md changed, merge under ${k}.md's own answer`));
      check(() => refused(checkPr(`chore-edit-${k}`, sha, own), says, `kit-776 DW2 ${k.toUpperCase()}.md changed, check-pr under ${k}.md's own answer`));
      check(() => refused(checkPr(`chore-edit-${k}`, sha, yes), says, `kit-776 DW2 ${k.toUpperCase()}.md changed, check-pr --approved`));
      check(() => { const r = checkPr(`chore-edit-${k}`, sha); assert.match(r.text, new RegExp(`warn: ${says.source}`), `kit-776 DW2 ${k.toUpperCase()}.md changed, check-pr warns`); });
      // a twin made a symlink is a change of kind, and named like any change (task-1 F1)
      indexed(W, `chore-link-${k}`, [[t, 'elsewhere', '120000']]);
      check(() => refused(merge(`link-${k}`), says, `kit-776 DW2 ${k.toUpperCase()}.md made a symlink, merge`));
      // removing the twin is the fix, so it lands
      indexed(W, `chore-drop-${k}`, [[t, null]]);
      check(() => { const r = merge(`drop-${k}`); assert.equal(r.status, 0, `kit-776 DW2 ${k.toUpperCase()}.md removed, merge\n${r.text}`); });
    }
    none();
  } finally { W.done(); }
});

test('kit-776: trailing dots and spaces are dropped from every folder of a path, not only the last part', () => {
  const W = world('wa-fold-folders');
  const { merge } = W;
  const { check, none } = checks('kit-776');
  try {
    for (const k of ['strategy', 'self', 'exterior']) {
      const { rel } = FILES[k];
      for (const [slug, twin] of [[`pdot-${k}`, rel.replace(`${P}/`, `${P}./`)], [`pspace-${k}`, rel.replace(`${P}/`, `${P} /`)], [`ddot-${k}`, rel.replace('docs/', 'docs../')]]) {
        indexed(W, `chore-${slug}`, [[twin, `# ${k}\n\nA twin.\n`]]);
        check(() => refused(merge(slug), new RegExp(`adds ${re(twin)}, which a disk that ignores case can't tell from ${re(rel)}`), `kit-776 DW3 ${JSON.stringify(twin)}, merge`));
      }
    }
    none();
  } finally { W.done(); }
});

// kit-779: a folder twin an older kit let onto main is held like an added one. A path the PR changes
// under it (or makes a symlink), or the twin itself repointed, is named at merge and check-pr in
// ticket and plan PRs; removing it is the fix, and lands.
test('kit-779: a change under a folder twin of docs, docs/devteam or the project folder already on main is refused like an added one', () => {
  const W = world('wa-folder-twins-on-main');
  const { checkPr, run, old } = W;
  const { check, none } = checks('kit-779');
  try {
    const yes = W.other(null);
    const mergeOf = (branch) => said(run(old, ['merge', ...(branch.startsWith('plan/') ? ['--plan', branch.slice(5)] : [branch.slice(7)]), '--dry-run'], SUP));
    const G = W.goal('Billing', 1);
    const feats = ['billing', 'payments', 'ledger', 'audit', 'tax'];
    for (const f of feats) W.feature(f, G);
    for (const n of [1, 2, 3, 4, 5, 6, 7]) W.ticket(`billing-0${n}-t`, 'billing');
    // the twins landed before the gate looked at changed paths
    indexed(W, 'main-folder-twins', [
      [`${P.replace('project', 'PROJECT')}/old.md`, 'old\n'],
      ['docs/devteam/Project', 'elsewhere', '120000'],
      ['docs/DevTeam/b.md', 'b\n'],
      ['Docs/a.md', 'a\n'],
      ['docs/notes.md', 'n\n'],
    ], { onto: 'main' });
    const cases = [
      ['docs/devteam/PROJECT/old.md', 'new\n', '100644', 'in a folder', P, 'a file in a case-twin project folder, changed'],
      ['docs/devteam/PROJECT/old.md', '../project/self.md', '120000', 'in a folder', P, 'a file in a case-twin project folder, made a symlink'],
      ['docs/devteam/Project', 'other', '120000', 'which', P, 'a symlink twin of the project folder, repointed'],
      ['docs/DevTeam/b.md', 'b2\n', '100644', 'in a folder', 'docs/devteam', 'a file in a case twin of docs/devteam, changed'],
      ['Docs/a.md', 'a2\n', '100644', 'in a folder', 'docs', 'a file in a case twin of docs, changed'],
    ];
    cases.forEach(([f, text, mode, how, at, m], i) => {
      const says = new RegExp(`changes ${re(f)}, ${how} a disk that ignores case can't tell from ${re(at)}[;:]`);
      for (const branch of [`ticket/billing-0${i + 1}-t`, `plan/${feats[i]}`]) {
        const kind = branch.startsWith('plan/') ? 'plan PR' : 'ticket PR';
        const sha = indexed(W, branch, [[f, text, mode]]);
        check(() => refused(mergeOf(branch), says, `kit-779 DW1 ${m}, ${kind}, merge`));
        check(() => refused(checkPr(branch, sha, yes), says, `kit-779 DW1 ${m}, ${kind}, check-pr --approved`));
        check(() => { const r = checkPr(branch, sha); assert.match(r.text, new RegExp(`warn: ${says.source}`), `kit-779 DW1 ${m}, ${kind}, check-pr warns`); });
      }
    });
    // removing the twins is the fix; a changed file in no twin is named by no twin line
    for (const [branch, entries, m] of [
      ['ticket/billing-06-t', [[`${P.replace('project', 'PROJECT')}/old.md`, null], ['docs/devteam/Project', null], ['docs/DevTeam/b.md', null], ['Docs/a.md', null]], 'the folder twins removed'],
      ['ticket/billing-07-t', [['docs/notes.md', 'n2\n']], 'docs/notes.md changed'],
    ]) {
      const sha = indexed(W, branch, entries);
      check(() => { const r = checkPr(branch, sha, yes); assert.doesNotMatch(r.text, /disk that ignores case/, `kit-779 DW1 ${m}, check-pr --approved\n${r.text}`); });
      check(() => { const r = mergeOf(branch); assert.doesNotMatch(r.text, /disk that ignores case/, `kit-779 DW1 ${m}, merge\n${r.text}`); });
    }
    none();
  } finally { W.done(); }
});

// kit-779: a folding disk may merge more than NFKC and lower case do: NTFS upper-cases (ı is I), and
// HFS+ ignores some default-ignorable code points (U+200C); the fold drops them all (a soft hyphen too).
test('kit-779: the fold upper-cases before lower-casing and drops default-ignorable code points', () => {
  const W = world('wa-fold-wider');
  const { merge, checkPr } = W;
  const { check, none } = checks('kit-779');
  try {
    const yes = W.other(null);
    const twins = [
      ['dotless', `${P}/exterıor.md`, 'which', FILES.exterior.rel, 'exterıor.md (dotless i)'],
      ['zwnj', `${P}/self.md‌`, 'which', FILES.self.rel, 'self.md then U+200C'],
      ['zwnj-dot', `${P}/self.md.‌`, 'which', FILES.self.rel, 'self.md, a dot, then U+200C'],
      ['shy', `${P}/strat­egy.md`, 'which', FILES.strategy.rel, 'strategy.md with a soft hyphen'],
      ['zwsp-folder', `docs/devteam/pro​ject/x.md`, 'in a folder', P, 'the project folder with U+200B, a file in it'],
    ];
    for (const [slug, f, how, at, m] of twins) {
      const sha = indexed(W, `chore-${slug}`, [[f, 'x\n']]);
      const says = new RegExp(`adds ${re(f)}, ${how} a disk that ignores case can't tell from ${re(at)}[;:]`);
      check(() => refused(merge(slug), says, `kit-779 DW2 ${m}, merge`));
      check(() => refused(checkPr(`chore-${slug}`, sha, yes), says, `kit-779 DW2 ${m}, check-pr --approved`));
    }
    // over-refusal: a note whose name has a dotless i or an ignorable, near no owner file
    for (const [slug, f] of [['note-dotless', `${P}/designs/ıdea.md`], ['note-shy', `${P}/designs/so­ft.md`]]) {
      const sha = indexed(W, `chore-${slug}`, [[f, 'x\n']]);
      check(() => { const r = merge(slug); assert.equal(r.status, 0, `kit-779 DW2 ${f} is no twin, merge\n${r.text}`); });
      check(() => { const r = checkPr(`chore-${slug}`, sha); assert.doesNotMatch(r.text, /disk that ignores case/, `kit-779 DW2 ${f} is no twin, check-pr`); });
    }
    none();
  } finally { W.done(); }
});
