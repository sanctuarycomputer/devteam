// Records in home: records left in the link, a link on records "repo", and a GitHub home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { json, multiFixture, review, write } from './lib/kit.mjs';
import { homeRecords, readyInHome, recordsFixture, SUP, tryCommit, VERIF } from './lib/multirepo-home-fixture.mjs';

// A console ticket written before links.console.records was "home": its code and records both on
// console's ticket/<id>, under the link's own project folder, the final review at the code head.
function leftInLink(F, id, { files = { 'spec.md': '# spec\n', 'plan.md': '# plan\n\n## TL;DR\n\n- x\n', 'verification.md': VERIF }, final = true } = {}) {
  const { old, g, okIn, ticket } = F;
  ticket(id);
  const w = path.join(old, '.worktrees', id);
  g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
  write(path.join(w, `src/${id}.js`), `${id}\n`);
  for (const [f, text] of Object.entries(files)) write(path.join(w, 'docs/devteam/project/tickets', id, f), text);
  g(['add', '-A'], w); g(['commit', '-qm', `${id}: work`], w);
  const code = g(['rev-parse', 'HEAD'], w);
  if (final) { write(path.join(w, 'docs/devteam/project/tickets', id, 'reviews/final-1.md'), review('reviewer-b', code)); g(['add', '-A'], w); g(['commit', '-qm', 'review'], w); }
  g(['push', '-q', 'origin', `ticket/${id}`], w);
  // approve-plan dies with no plan to read, so each act only when its file is there
  if (files['spec.md']) okIn(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
  if (files['plan.md']) okIn(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
  write(path.join(old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
  return { w, code, head: g(['rev-parse', 'HEAD'], w) };
}
// the left-in-the-link warning lines for a ticket in a command's stderr
const warnings = (text, id) => text.split('\n').filter((l) => new RegExp(`^devteam: warning: ${id}: records read from console \\(docs/devteam/project/tickets/${id}/\\), left from before links\\.console\\.records was "home"; move them to home's docs/devteam/project/tickets/${id}/ once merged$`).test(l)).length;

test('records in home: a ticket whose records were left in the link merges from there until home has some', () => {
  const F = recordsFixture('records-left');
  const { old, g, okIn, runIn } = F;
  const T = (id) => `docs/devteam/project/tickets/${id}`;
  const check = (id, sha) => runIn(old, ['check-ticket', id, '--sha', sha]);
  const checkPr = (id, sha) => runIn(old, ['check-pr', '--repo', 'console', '--head-ref', `ticket/${id}`, '--sha', sha]);
  const dropRef = (dir, ref) => { try { g(['update-ref', '-d', ref], dir); } catch {} };
  try {
    // a records branch with no folder in it (as worker makes one) is not records in home
    g(['branch', 'ticket/console-01-a', 'origin/main'], old); g(['push', '-q', 'origin', 'ticket/console-01-a'], old);
    // A2: left in the link, it passes from the link, with the warning once per command
    const id = 'console-01-a';
    const a = leftInLink(F, id);
    const ck = check(id, a.head);
    assert.equal(ck.status, 0, ck.out);
    assert.equal(warnings(ck.err, id), 1, ck.err);
    const pr = checkPr(id, a.head);
    assert.equal(pr.status, 0, pr.out);
    assert.equal(warnings(pr.err, id), 1, pr.err);
    const dry = runIn(old, ['merge', id, '--dry-run'], SUP);
    assert.match(dry.out, new RegExp(`ok: ticket/${id} at \\w{12} would merge in console`), dry.out);
    assert.doesNotMatch(dry.out, /records at/);
    assert.equal(warnings(dry.err, id), 1, dry.err);
    // A2b: the link's ticket/<id> refs gone (a CI checkout): decided at the sha, read at the sha
    g(['checkout', '-q', '--detach'], a.w); g(['branch', '-D', `ticket/${id}`], a.w); dropRef(F.console, `refs/remotes/origin/ticket/${id}`);
    const ck2 = check(id, a.head);
    assert.equal(ck2.status, 0, ck2.out);
    assert.equal(warnings(ck2.err, id), 1, ck2.err);
    const rv = okIn(old, ['review-worktree', id, a.code], SUP).split('\n');
    assert.ok(!rv.some((l) => /^records: /.test(l)), rv.join('\n'));
    okIn(old, ['review-worktree', '--remove', rv[0]], SUP);
    g(['checkout', '-q', '-B', `ticket/${id}`, a.head], a.w); g(['fetch', '-q', 'origin'], F.console);
    // A7: the views read the link: the default records line in the worker's prompt
    const wp = okIn(old, ['prompt', 'worker', id], SUP);
    assert.match(wp, /keep this ticket's records under docs\/devteam\/project\/tickets\/console-01-a\/ in this repo\./);
    assert.doesNotMatch(wp, /Keep its records/);
    // approve-plan reads the link's plan (leftInLink's act succeeds), until home has a folder without one
    leftInLink(F, 'console-06-f', { files: { 'spec.md': '# spec\n', 'plan.md': '# plan\n\n## TL;DR\n\n- x\n' }, final: false });
    homeRecords(F, 'console-06-f', { 'spec.md': '# spec\n' }, { push: false });
    assert.match(runIn(old, ['act', '--class', 'approve-plan', '--refs', 'console-06-f', '--', 'ok'], SUP).err, /no plan\.md for console-06-f on ticket\/console-06-f/);
    // merge lands the code and the link's records in console, nothing in home
    okIn(old, ['merge', id], SUP);
    g(['fetch', '-q', 'origin'], F.console); g(['fetch', '-q', 'origin'], old);
    const trunk = g(['ls-tree', '-r', '--name-only', 'origin/trunk'], F.console).split('\n');
    assert.ok(trunk.includes(`src/${id}.js`) && trunk.includes(`${T(id)}/spec.md`), trunk.join('\n'));
    assert.equal(g(['ls-tree', '-r', '--name-only', 'origin/main', '--', T(id)], old), '', 'nothing in home');
    assert.equal(json(okIn(old, ['timeline', id, '--json'])).files.find((f) => f.title === 'spec')?.repo, 'console');
    // A2c: home records pushed from another clone: merge and check-pr fetch them before deciding
    const e = leftInLink(F, 'console-05-e');
    const other = path.join(F.base, 'home-other');
    g(['clone', '-q', F.org, other], F.base);
    g(['config', 'user.email', 't@t'], other); g(['config', 'user.name', 't'], other);
    g(['checkout', '-q', '-b', 'ticket/console-05-e'], other);
    write(path.join(other, T('console-05-e'), 'spec.md'), '# spec in home\n');
    g(['add', '-A'], other); g(['commit', '-qm', 'records elsewhere'], other); g(['push', '-q', 'origin', 'ticket/console-05-e'], other);
    dropRef(old, 'refs/remotes/origin/ticket/console-05-e');
    const outsideE = new RegExp(`changes files outside touches: ${T('console-05-e')}/`);
    assert.match(runIn(old, ['merge', 'console-05-e', '--dry-run'], SUP).out, outsideE);
    dropRef(old, 'refs/remotes/origin/ticket/console-05-e');
    assert.match(checkPr('console-05-e', e.head).out, outsideE);
    // A3: held to the link head: a code change after the final review voids it
    const b = leftInLink(F, 'console-02-b');
    tryCommit(F, b.w, { 'src/console-02-b.js': 'changed\n' }, (sha) => assert.match(check('console-02-b', sha).out, /final-1\.md: its verdict is at \w{12}, which does not hold at/));
    // A4: the record checks still run on the link's records
    const c = leftInLink(F, 'console-03-c', { files: { 'spec.md': '# spec\n' }, final: false });
    const ck4 = check('console-03-c', c.head);
    assert.match(ck4.out, /plan\.md missing at this head/);
    assert.match(ck4.out, /verification\.md missing/);
    assert.equal(warnings(ck4.err, 'console-03-c'), 1, ck4.err);
    // A5: home wins once it has a folder: the link's is outside touches, home's records are judged
    homeRecords(F, 'console-02-b', { 'spec.md': '# spec\n' }, { push: false });
    const outsideB = new RegExp(`changes files outside touches: ${T('console-02-b')}/`);
    const ck5 = check('console-02-b', b.head);
    assert.match(ck5.out, outsideB);
    assert.match(ck5.out, /plan\.md missing at this head/);
    assert.equal(warnings(ck5.err, 'console-02-b'), 0, ck5.err);
    const rec = homeRecords(F, 'console-02-b', { 'plan.md': '# plan\n\n## TL;DR\n\n- x\n', 'verification.md': VERIF }, { push: false });
    const recFinal = homeRecords(F, 'console-02-b', { 'reviews/final-1.md': `- Records: ${rec.sha}\n${review('reviewer-b', b.code)}` }, { push: false });
    const fails5 = check('console-02-b', b.head).out.split('\n').filter((l) => l.startsWith('fail: '));
    assert.ok(fails5.length && fails5.every((l) => outsideB.test(l)), fails5.join('\n'));
    // A6: home's checks are not lax: a records edit after the review, and no records anywhere
    tryCommit(F, recFinal.rw, { [`${T('console-02-b')}/verification.md`]: `${VERIF}| more | x | pass |\n` }, () => {
      assert.match(check('console-02-b', b.head).out, /its records verdict is at \w{12}, which does not hold at home's/);
    });
    const d = leftInLink(F, 'console-04-d', { files: {}, final: false });
    assert.match(check('console-04-d', d.head).out, /no records for console-04-d in home/);
    // home wins on home's main alone too (a records PR merged first, its branch deleted): the link's
    // folder is refused, with no warning
    const gg = leftInLink(F, 'console-07-g');
    write(path.join(old, T('console-07-g'), 'spec.md'), '# spec on home main\n');
    g(['add', T('console-07-g')], old); g(['commit', '-qm', 'console-07-g records on main'], old); g(['push', '-q', 'origin', 'main'], old);
    const outsideG = new RegExp(`changes files outside touches: ${T('console-07-g')}/`);
    const ck7 = check('console-07-g', gg.head);
    assert.match(ck7.out, outsideG);
    assert.equal(warnings(ck7.err, 'console-07-g'), 0, ck7.err);
    assert.match(runIn(old, ['merge', 'console-07-g', '--dry-run'], SUP).out, outsideG);
    // merge and check-pr decide at the PR head, not the link's local branch (here reset to trunk,
    // where there is no records folder: the views form would route it home and find none)
    const hh = leftInLink(F, 'console-08-h');
    g(['checkout', '-q', '--detach'], hh.w); g(['branch', '-f', 'ticket/console-08-h', 'origin/trunk'], hh.w);
    const dry8 = runIn(old, ['merge', 'console-08-h', '--dry-run'], SUP);
    assert.match(dry8.out, /ok: ticket\/console-08-h at \w{12} would merge in console/, dry8.out);
    assert.equal(warnings(dry8.err, 'console-08-h'), 1, dry8.err);
    const pr8 = checkPr('console-08-h', hh.head);
    assert.equal(pr8.status, 0, pr8.out);
    assert.equal(warnings(pr8.err, 'console-08-h'), 1, pr8.err);
  } finally { F.done(); }
});

test('records in home: a link left on records "repo" (the default) never reads as left in the link', () => {
  const F = multiFixture('records-repo-default');
  const { old, g, runIn, ticket } = F;
  const id = 'console-01-a';
  try {
    ticket(id);
    const w = path.join(old, '.worktrees', id);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
    write(path.join(w, `docs/devteam/project/tickets/${id}/spec.md`), '# spec\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'records in the link'], w);
    const ck = runIn(old, ['check-ticket', id, '--sha', g(['rev-parse', 'HEAD'], w)]);
    assert.equal(warnings(ck.err, id), 0, ck.err);
    assert.doesNotMatch(ck.err, /left from before/);
    assert.doesNotMatch(ck.out, /no records for .* in home|changes files outside touches/, ck.out);
  } finally { F.done(); }
});

test('records in home on a GitHub home: a merged records PR is recognized (branch there or gone), else an open one is needed', () => {
  const F = recordsFixture('records-gh', { forge: 'git' });
  const { old, g, runIn } = F;
  const id = 'console-01-a';
  try {
    const r = readyInHome(F, id);
    F.edit((j) => { delete j.forge; });
    g(['commit', '-qam', 'home on github'], old); g(['push', '-q', 'origin', 'main'], old);
    // a gh on PATH: pr list --state merged answers from a file; every other call fails (no open PR)
    const bin = path.join(F.base, 'gh-bin');
    const merged = path.join(F.base, 'merged.json');
    write(path.join(bin, 'gh'), `#!/bin/sh\ncase "$*" in\n  "pr list"*"--state merged"*) cat '${merged}' ;;\n  *) exit 1 ;;\nesac\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const dry = () => runIn(old, ['merge', id, '--dry-run'], SUP, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    const origin = path.join(F.base, 'origin.git');
    g(['update-ref', 'refs/pull/7/head', r.head], origin);
    // an older merge of an earlier head is newer in the list's order here: the one at the fetched head counts
    g(['update-ref', 'refs/pull/8/head', r.reviewed], origin);
    write(merged, JSON.stringify([{ number: 7, headRefOid: r.head, mergedAt: '2026-11-15T00:00:00Z' }, { number: 8, headRefOid: r.reviewed, mergedAt: '2026-11-15T01:00:00Z' }]));
    assert.match(dry().out, new RegExp(`records at ${r.head.slice(0, 12)} in home \\(landed already: only the code lands\\)`));
    // the head branch deleted on merge: the newest merged PR, fetched from refs/pull/<n>/head
    write(merged, JSON.stringify([{ number: 7, headRefOid: r.head, mergedAt: '2026-11-15T00:00:00Z' }]));
    g(['push', '-q', 'origin', `:ticket/${id}`], r.rw);
    assert.match(dry().out, /\(landed already: only the code lands\)/);
    // no merged PR and no open one: refused
    g(['push', '-q', 'origin', `ticket/${id}`], r.rw);
    write(merged, '[]');
    assert.match(dry().out, new RegExp(`no open home PR from ticket/${id} \\(its records\\)`));
  } finally { F.done(); }
});
