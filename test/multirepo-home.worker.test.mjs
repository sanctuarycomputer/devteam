// Records in home: the worker's records worktree, a parked worker, and merges half-done or hand-made.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux, json, review, write } from './lib/kit.mjs';
import { homeRecords, readyInHome, recordsFixture, SUP, VERIF } from './lib/multirepo-home-fixture.mjs';

test('records in home: the worker\'s records worktree and prompt, review-worktree\'s records checkout, timeline, and --remove', (t) => {
  const F = recordsFixture('records-worktrees');
  const { old, g, okIn, runIn, ticket } = F;
  const id = 'console-01-a';
  const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id };
  try {
    if (hasTmux) {
      ticket('console-03-c');
      okIn(old, ['worker', 'console-03-c'], SUP);
      spawnSync('tmux', ['kill-server'], { env: F.env({}) });
      const rw = path.join(old, '.worktrees', 'records-console-03-c');
      assert.equal(F.real(g(['rev-parse', '--path-format=absolute', '--git-common-dir'], rw)), F.real(path.join(old, '.git')), 'a worktree of home');
      assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], rw), 'ticket/console-03-c');
      assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], path.join(old, '.worktrees', 'console-03-c')), 'ticket/console-03-c');
      const prompt = fs.readFileSync(path.join(old, 'docs/devteam/run/prompts/console-03-c.txt'), 'utf8');
      assert.match(prompt, /Keep its records \(spec, plan, verification, reviews\) under docs\/devteam\/project\/tickets\/console-03-c\/ in \S*\.worktrees\/records-console-03-c, a checkout of home on its branch ticket\/console-03-c/);
      assert.match(prompt, /"- Records: <full sha>"/);
      assert.doesNotMatch(prompt, /in this repo\./, "not the default's records line");
    } else t.diagnostic('tmux not installed: the worker launch is not exercised');
    const r = readyInHome(F, id);
    // timeline lists the records from home (no repo field)
    const files = json(okIn(old, ['timeline', id, '--json'])).files;
    assert.deepEqual(files.map((f) => [f.title, f.repo]), [['spec', undefined], ['plan', undefined], ['verification', undefined]]);
    // review-worktree: the link checkout, and home's records beside it at their full sha
    const out = okIn(old, ['review-worktree', id, r.code]).split('\n');
    const rv = out[0];
    const m = /^records: (\S+) \(([0-9a-f]{40})\)$/.exec(out[1] ?? '');
    assert.ok(m, out.join('\n'));
    assert.equal(m[2], r.head);
    assert.equal(F.real(g(['rev-parse', '--path-format=absolute', '--git-common-dir'], m[1])), F.real(path.join(old, '.git')));
    assert.ok(fs.existsSync(path.join(m[1], `docs/devteam/project/tickets/${id}/spec.md`)));
    okIn(old, ['review-worktree', '--remove', rv]);
    assert.ok(!fs.existsSync(rv) && !fs.existsSync(m[1]), 'both removed');
    // --remove after the merge removes both worktrees
    okIn(old, ['merge', id], SUP);
    okIn(r.w, ['phase', 'done'], W);
    const rm = okIn(old, ['worker', id, '--remove'], SUP);
    assert.match(rm, /removed .*console-01-a \(a worktree of console\)/);
    assert.match(rm, /removed .*records-console-01-a \(a worktree of home\)/);
    assert.ok(!fs.existsSync(r.rw));
    // once merged, timeline reads home's main
    assert.equal(json(okIn(old, ['timeline', id, '--json'])).files.find((f) => f.title === 'spec').ref, 'origin/main');
  } finally { F.done(); }
});

test('records in home: a parked worker is settled only once its records are committed and pushed too', () => {
  const F = recordsFixture('records-park');
  const { old, g, okIn, ticket } = F;
  const id = 'console-01-a';
  const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id };
  try {
    ticket(id);
    const w = path.join(old, '.worktrees', id);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
    g(['push', '-q', 'origin', `ticket/${id}`], w);
    const rw = path.join(old, '.worktrees', `records-${id}`);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, rw, 'origin/main'], old);
    // the park ruling names the records worktree
    okIn(w, ['phase', 'build'], W);
    okIn(old, ['fleet', 'park', '--reason', 'moving'], SUP);
    const told = json(okIn(old, ['messages', '--to', id, '--json'])).pop();
    assert.match(told.text, /^Park: .* Push records-console-01-a too\. Commit all work/);
    okIn(w, ['phase', 'parked', '--note', 'parked'], W);
    const problems = () => json(okIn(old, ['fleet', 'status', '--json', '--no-fetch'], SUP)).sessions.find((x) => x.name === id).problems.filter((p) => p.startsWith('records:'));
    assert.deepEqual(problems(), [], 'a records branch with nothing of its own has nothing to lose');
    write(path.join(rw, `docs/devteam/project/tickets/${id}/spec.md`), '# spec\n');
    assert.match(problems().join('\n'), /records: 1 uncommitted change\(s\) in \S*records-console-01-a/);
    g(['add', '-A'], rw); g(['commit', '-qm', 'spec'], rw);
    assert.match(problems().join('\n'), /records: home's ticket\/console-01-a is not on origin: push it from/);
    g(['push', '-q', 'origin', `ticket/${id}`], rw);
    assert.deepEqual(problems(), []);
    write(path.join(rw, `docs/devteam/project/tickets/${id}/plan.md`), '# plan\n');
    g(['add', '-A'], rw); g(['commit', '-qm', 'plan'], rw);
    assert.match(problems().join('\n'), /records: home's ticket\/console-01-a here \(\w{12}\) is not what origin has/);
  } finally { F.done(); }
});

test('records in home: a half-done merge, then a review record added on home\'s ticket/<id>: the retry lands the new head and its act names both records merges', () => {
  const F = recordsFixture('records-moved');
  const { old, g, okIn, runIn } = F;
  const id = 'console-01-a';
  const T = `docs/devteam/project/tickets/${id}`;
  const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id };
  try {
    const r = readyInHome(F, id);
    const hook = path.join(F.consoleOrigin, 'hooks', 'pre-receive');
    write(hook, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    assert.notEqual(runIn(old, ['merge', id], SUP).status, 0);
    // a record added since (a dispose, another track): the verdicts still hold, so the retry lands it
    const later = homeRecords(F, id, { 'reviews/task-9.md': review('late-reviewer', r.code) });
    // a hand-made merge on home's main that borrows the records subject: never named, still flagged
    const forge = path.join(F.base, 'forged');
    g(['clone', '-q', path.join(F.base, 'origin.git'), forge], F.base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], forge);
    g(['checkout', '-q', '-b', 'x'], forge);
    write(path.join(forge, 'README.md'), 'pushed past merge\n');
    g(['commit', '-qam', 'unchecked'], forge);
    g(['checkout', '-q', 'main'], forge);
    g(['merge', '-q', '--no-ff', '-m', `${id}: records`, 'x'], forge);
    g(['push', '-q', 'origin', 'main'], forge);
    const forged = g(['rev-parse', 'HEAD'], forge);
    // an evil merge that stays in the folder: a real records commit (an ancestor of what merge will
    // check) merged with a review no records commit has. Never named, still flagged.
    g(['fetch', '-q', 'origin', `ticket/${id}`], forge);
    g(['merge', '-q', '--no-ff', '--no-commit', 'FETCH_HEAD'], forge);
    write(path.join(forge, `${T}/reviews/final-9.md`), review('nobody', r.code));
    g(['add', '-A'], forge); g(['commit', '-qm', `${id}: records`], forge);
    g(['push', '-q', 'origin', 'main'], forge);
    const evil = g(['rev-parse', 'HEAD'], forge);
    const last = homeRecords(F, id, { 'reviews/task-10.md': review('later-reviewer', r.code) });
    fs.rmSync(hook);
    assert.match(okIn(old, ['merge', id], SUP), new RegExp(`landed the records of ${id} at ${last.sha.slice(0, 12)} in home`));
    const act = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'merge-word' && (a.refs ?? []).includes(id));
    assert.match(act.what, new RegExp(`; records at ${last.sha} in home$`));
    const landings = json(okIn(old, ['log', '--type', 'act', '--json'])).filter((a) => String(a.what).startsWith(`merged home's ticket/${id} at `)).map((a) => a.what.split(' ')[4].replace(/:$/, ''));
    assert.deepEqual(landings, [r.head, last.sha], 'each records landing logged its own act; the forged merges have none');
    const f = json(okIn(old, ['metrics', '--json'])).findings;
    assert.ok(!f.some((x) => x.kind === 'records-without-code'));
    assert.deepEqual(f.filter((x) => x.kind === 'merged-without-merge').map((x) => x.subject).sort(), [`home:${evil.slice(0, 12)}`, `home:${forged.slice(0, 12)}`].sort(), 'both records merges are named by the act; the forged ones stay flagged');
    // --remove: a dirty records worktree refuses before anything is removed
    okIn(r.w, ['phase', 'done'], W);
    write(path.join(r.rw, `${T}/notes.md`), 'uncommitted\n');
    assert.notEqual(runIn(old, ['worker', id, '--remove'], SUP).status, 0);
    assert.ok(fs.existsSync(r.w) && fs.existsSync(r.rw), 'neither worktree removed');
  } finally { F.done(); }
});

test('records in home: a hand-made merge borrowing the records subject is never named by the act, whichever check it fails', () => {
  const F = recordsFixture('records-borrowed');
  const { old, g, okIn } = F;
  const id = 'console-02-b';
  const T = `docs/devteam/project/tickets/${id}`;
  try {
    F.ticket(id);
    const w = path.join(old, '.worktrees', id);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
    write(path.join(w, 'src/main.js'), `${id}\n`);
    g(['add', '-A'], w); g(['commit', '-qm', 'work'], w); g(['push', '-q', 'origin', `ticket/${id}`], w);
    const code = g(['rev-parse', 'HEAD'], w);
    // the records' own first commit also edits README.md (outside the folder): refused as it stands
    const first = homeRecords(F, id, { 'spec.md': '# spec\n', 'plan.md': '# plan\n\n## TL;DR\n\n- x\n', 'verification.md': VERIF });
    write(path.join(first.rw, 'README.md'), 'through the records branch\n');
    g(['commit', '-qam', 'readme too'], first.rw); g(['push', '-q', 'origin', `ticket/${id}`], first.rw);
    const h = g(['rev-parse', 'HEAD'], first.rw);
    okIn(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
    okIn(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
    // by hand, onto home's main, with the records subject: (1) that commit, a clean merge of an
    // ancestor of what merge will check, which changes README.md: only the footprint check stops it;
    // (2) a clean, in-folder merge of a commit that is no ancestor: only the ancestry check stops it
    const forge = path.join(F.base, 'borrowed');
    g(['clone', '-q', path.join(F.base, 'origin.git'), forge], F.base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], forge);
    g(['fetch', '-q', 'origin', `ticket/${id}`], forge);
    // (0) a plain --no-ff merge of a real records commit, by hand before merge ran: git can't tell it
    // from merge's own; only merge's act says what merge landed, so it stays flagged
    g(['merge', '-q', '--no-ff', '-m', `${id}: records`, first.sha], forge);
    const viaClean = g(['rev-parse', 'HEAD'], forge);
    g(['merge', '-q', '--no-ff', '-m', `${id}: records`, 'FETCH_HEAD'], forge);
    const viaFootprint = g(['rev-parse', 'HEAD'], forge);
    g(['checkout', '-q', '-b', 'y', 'origin/main'], forge);
    write(path.join(forge, `${T}/notes.md`), 'not a records commit\n');
    g(['add', '-A'], forge); g(['commit', '-qm', 'notes'], forge);
    g(['checkout', '-q', 'main'], forge);
    g(['merge', '-q', '--no-ff', '-m', `${id}: records`, 'y'], forge);
    const viaAncestry = g(['rev-parse', 'HEAD'], forge);
    // (3) an empty merge of an old main commit (an ancestor of everything): every other check passes
    // trivially, so only "its merge brought the head in" stops it; (4) then a merge of that same head
    // that edits README.md, which naming (3) would hide too
    const oldMain = g(['rev-list', '--max-parents=0', 'HEAD'], forge).split('\n')[0];
    const mergeOf = (tree) => { const c = g(['commit-tree', tree, '-p', 'HEAD', '-p', oldMain, '-m', `${id}: records`], forge); g(['reset', '-q', '--hard', c], forge); return c; };
    const viaEmpty = mergeOf(g(['rev-parse', 'HEAD^{tree}'], forge));
    write(path.join(forge, 'README.md'), 'hidden behind a named head\n');
    g(['add', '-A'], forge);
    const viaReadme = mergeOf(g(['write-tree'], forge));
    g(['push', '-q', 'origin', 'main'], forge);
    // the reviewed records, now that home's main has the README change (merge-base moved past it)
    homeRecords(F, id, { 'reviews/final-1.md': `- Records: ${h}\n${review('reviewer-b', code)}` });
    write(path.join(old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
    okIn(old, ['merge', id], SUP);
    const act = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'merge-word' && (a.refs ?? []).includes(id));
    assert.doesNotMatch(act.what, /and earlier at/, 'neither hand-made merge is named');
    const flagged = json(okIn(old, ['metrics', '--json'])).findings.filter((x) => x.kind === 'merged-without-merge').map((x) => x.subject).sort();
    assert.deepEqual(flagged, [viaClean, viaAncestry, viaFootprint, viaEmpty, viaReadme].map((s) => `home:${s.slice(0, 12)}`).sort());
  } finally { F.done(); }
});
