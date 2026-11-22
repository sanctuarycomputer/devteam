// Records in home: the setting, check-ticket at both heads, and merge landing them first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { json, multiFixture, review, write } from './lib/kit.mjs';
import { homeRecords, readyInHome, recordsFixture, SUP, tryCommit, VERIF } from './lib/multirepo-home-fixture.mjs';

test('records in home: the setting (repo by default, home or refused), and approve-plan reads the plan from home', () => {
  const F = multiFixture('records-setting');
  const { old, okIn, runIn, ticket } = F;
  try {
    const eff = () => json(okIn(old, ['links', '--json'])).links.find((x) => x.id === 'console').effective.records;
    assert.equal(eff(), 'repo', 'today\'s behaviour by default');
    assert.equal(json(okIn(old, ['links', '--json'])).home.effective.records, 'home');
    assert.match(runIn(old, ['link', 'set', 'console', 'records', 'nope'], SUP).err, /links\.console: records is "repo" or "home"/);
    F.edit((j) => { j.links.console.records = 'home'; });
    F.g(['commit', '-qam', 'records home'], old); F.g(['push', '-q', 'origin', 'main'], old);
    assert.doesNotMatch(runIn(old, ['validate']).out, /records is/);
    assert.equal(eff(), 'home');
    // approve-plan reads the plan from home's ticket/<id>, never the link's
    ticket('console-01-a');
    okIn(old, ['act', '--class', 'approve-spec', '--refs', 'console-01-a', '--', 'ok'], SUP);
    const w = path.join(old, '.worktrees', 'console-01-a');
    F.g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'docs/devteam/project/tickets/console-01-a/plan.md'), '# plan\n\n## TL;DR\n\n- x\n');
    F.g(['add', '-A'], w); F.g(['commit', '-qm', 'plan in the link'], w);
    homeRecords(F, 'console-01-a', { 'spec.md': '# spec\n' }, { push: false });
    assert.match(runIn(old, ['act', '--class', 'approve-plan', '--refs', 'console-01-a', '--', 'ok'], SUP).err, /no plan\.md for console-01-a on ticket\/console-01-a/, "a plan in the link doesn't count");
    homeRecords(F, 'console-01-a', { 'plan.md': '# plan\n\n## TL;DR\n\n- x\n' }, { push: false });
    assert.match(okIn(old, ['act', '--class', 'approve-plan', '--refs', 'console-01-a', '--', 'ok'], SUP), /^a-/, "the plan on home's ticket/<id>");
  } finally { F.done(); }
});

test('records in home: check-ticket reads them from home\'s ticket/<id> at both heads; home\'s check-pr checks only the records footprint', () => {
  const F = recordsFixture('records-check');
  const { old, g, okIn, runIn, ticket } = F;
  const id = 'console-01-a';
  const T = `docs/devteam/project/tickets/${id}`;
  try {
    // no records branch yet: one failure, nothing read from home's working tree
    ticket('console-02-b');
    const w0 = path.join(old, '.worktrees', 'console-02-b');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-02-b', w0, 'origin/trunk'], F.console);
    write(path.join(old, 'docs/devteam/project/tickets/console-02-b/spec.md'), '# spec in home\'s working tree\n');
    const none = runIn(old, ['check-ticket', 'console-02-b', '--sha', g(['rev-parse', 'HEAD'], w0)]);
    assert.notEqual(none.status, 0);
    assert.match(none.out, /no records for console-02-b in home: commit them under docs\/devteam\/project\/tickets\/console-02-b\/ on home's ticket\/console-02-b/);
    assert.doesNotMatch(none.out, /spec\.md missing|no final review/, 'the record checks are skipped');
    fs.rmSync(path.join(old, 'docs/devteam/project/tickets/console-02-b'), { recursive: true });

    const r = readyInHome(F, id);
    const check = (args = []) => runIn(old, ['check-ticket', id, '--sha', r.code, ...args]);
    assert.equal(check().status, 0, check().out);
    // the link's own records folder is no longer exempt: nothing of the project's in the link
    const dry = () => runIn(old, ['merge', id, '--dry-run'], SUP).out;
    tryCommit(F, r.w, { [`${T}/spec.md`]: '# spec in the link\n' }, (sha) => {
      assert.match(runIn(old, ['check-ticket', id, '--sha', sha]).out, new RegExp(`changes files outside touches: ${T}/spec\\.md`));
      g(['push', '-q', 'origin', `ticket/${id}`], r.w);
      assert.match(dry(), new RegExp(`changes files outside touches: ${T}/spec\\.md`), 'merge refuses it too');
    });
    g(['push', '-q', '--force', 'origin', `ticket/${id}`], r.w);
    // the records branch holds only its records folder; home's check-pr on it says the same
    tryCommit(F, r.rw, { 'README.md': 'changed through the records branch\n' }, (sha) => {
      assert.match(check().out, new RegExp(`home's ticket/${id} changes files outside its records folder ${T}/: README\\.md`));
      const pr = runIn(old, ['check-pr', '--head-ref', `ticket/${id}`, '--sha', sha]);
      assert.notEqual(pr.status, 0);
      assert.match(pr.out, /changes files outside its records folder .*README\.md/);
      g(['push', '-q', 'origin', `ticket/${id}`], r.rw);
      assert.match(dry(), /changes files outside its records folder .*README\.md/, 'merge refuses it too');
    });
    g(['push', '-q', '--force', 'origin', `ticket/${id}`], r.rw);
    assert.equal(runIn(old, ['check-pr', '--head-ref', `ticket/${id}`, '--sha', r.head]).status, 0, 'a records-only branch passes home\'s check-pr');
    // the records edited after the final review: the records verdict no longer holds
    tryCommit(F, r.rw, { [`${T}/verification.md`]: `${VERIF}| more | x | pass |\n` }, () => {
      assert.match(check().out, /final-1\.md: its records verdict is at \w{12}, which does not hold at home's \w{12}/);
      assert.match(check().out, /needs 1 final APPROVE review/);
    });
    // a newly added review record keeps it holding; a final record without "- Records:" fails
    tryCommit(F, r.rw, { [`${T}/reviews/task-1.md`]: review('task-reviewer', r.code) }, () => assert.equal(check().status, 0, check().out));
    tryCommit(F, r.rw, { [`${T}/reviews/final-2.md`]: review('reviewer-c', r.code) }, () => {
      assert.match(check().out, /final-2\.md: no "- Records: <full sha>" line/);
      g(['push', '-q', 'origin', `ticket/${id}`], r.rw);
      assert.match(dry(), /final-2\.md: no "- Records: <full sha>" line/, 'merge refuses it too');
    });
    g(['push', '-q', '--force', 'origin', `ticket/${id}`], r.rw);
    // --records pins the records commit read: the reviewed one has no review in it yet
    assert.match(check(['--records', r.reviewed]).out, /no final review record/);
  } finally { F.done(); }
});

test('records in home: merge checks the records at one pinned sha and lands them first; a half-done merge says so and a retry finishes it once', () => {
  const F = recordsFixture('records-merge');
  const { old, g, okIn, runIn, ticket } = F;
  const id = 'console-01-a';
  const T = `docs/devteam/project/tickets/${id}`;
  try {
    // no records in home: refused before anything lands
    ticket('console-02-b');
    const w0 = path.join(old, '.worktrees', 'console-02-b');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-02-b', w0, 'origin/trunk'], F.console);
    write(path.join(w0, 'src/b.js'), 'b\n');
    g(['add', '-A'], w0); g(['commit', '-qm', 'b'], w0); g(['push', '-q', 'origin', 'ticket/console-02-b'], w0);
    assert.match(runIn(old, ['merge', 'console-02-b', '--dry-run'], SUP).out, /no records for console-02-b in home: commit them under .* and push it/);

    const r = readyInHome(F, id);
    const dry = () => runIn(old, ['merge', id, '--dry-run'], SUP);
    assert.match(dry().out, new RegExp(`ok: ticket/${id} at \\w{12} would merge in console, records at ${r.head.slice(0, 12)} in home`));
    // merge reads origin's records, never the local branch: a local commit that breaks them doesn't
    // move what merge checks, while check-ticket (the worker's committed state) sees it
    tryCommit(F, r.rw, { [`${T}/verification.md`]: `${VERIF}| local | x | pass |\n` }, () => {
      assert.match(runIn(old, ['check-ticket', id, '--sha', r.code]).out, /records verdict .* does not hold/);
      assert.equal(dry().status, 0, dry().out);
      assert.doesNotMatch(runIn(old, ['check-pr', '--repo', 'console', '--head-ref', `ticket/${id}`, '--sha', r.code]).out, /records verdict|no records/, "check-pr --repo judges origin's records, which hold");
    });
    // and the reverse: origin's records broken, the local branch fine: merge refuses
    tryCommit(F, r.rw, { [`${T}/verification.md`]: `${VERIF}| pushed | x | pass |\n` }, () => { g(['push', '-q', 'origin', `ticket/${id}`], r.rw); });
    assert.equal(runIn(old, ['check-ticket', id, '--sha', r.code]).status, 0);
    assert.match(dry().out, /records verdict .* does not hold/);
    assert.match(runIn(old, ['check-pr', '--repo', 'console', '--head-ref', `ticket/${id}`, '--sha', r.code]).out, /records verdict .* does not hold/, "check-pr --repo judges origin's records too");
    g(['push', '-q', '--force', 'origin', `ticket/${id}`], r.rw);
    // home's ticket/<id> not on origin: check-pr --repo refuses, never passing with no records read
    g(['push', '-q', 'origin', `:ticket/${id}`], r.rw);
    const gone = runIn(old, ['check-pr', '--repo', 'console', '--head-ref', `ticket/${id}`, '--sha', r.code]);
    assert.notEqual(gone.status, 0);
    assert.match(gone.out, new RegExp(`no records for ${id} in home: home's ticket/${id} is not on origin; push it`));
    g(['push', '-q', 'origin', `ticket/${id}`], r.rw);

    // the half-done merge: console's origin refuses the push, after the records landed
    const hook = path.join(F.consoleOrigin, 'hooks', 'pre-receive');
    write(hook, '#!/bin/sh\necho refused by the test >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    const half = runIn(old, ['merge', id], SUP);
    assert.notEqual(half.status, 0);
    assert.match(half.err, new RegExp(`the records of ${id} landed in home at ${r.head.slice(0, 12)}; the code did not land in console \\(push to trunk in console refused .*\\): run merge ${id} again`));
    g(['fetch', '-q', 'origin'], old); g(['fetch', '-q', 'origin'], F.console);
    for (const f of ['spec.md', 'plan.md', 'verification.md', 'reviews/final-1.md']) g(['cat-file', '-e', `origin/main:${T}/${f}`], old);
    assert.equal(g(['show', 'origin/trunk:src/main.js'], F.console), 'console', "console's main doesn't have the code");
    const merges = () => json(okIn(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'merge-word' && (a.refs ?? []).includes(id));
    assert.equal(merges().length, 0, 'no merge act');
    const row = () => json(okIn(old, ['status', '--json'])).tickets.find((x) => x.id === id);
    assert.equal(row().records_landed, true);
    // the same from a subfolder of home: paths in a commit are the repo root's, wherever the command runs
    const sub = path.join(old, 'docs/devteam/project');
    const fromSub = JSON.parse(execFileSync(process.execPath, [path.join(old, 'docs/devteam/scripts/devteam.mjs'), 'status', '--json'], { cwd: sub, env: F.env({}), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    assert.equal(fromSub.tickets.find((x) => x.id === id).records_landed, true, 'from a subfolder');
    assert.match(okIn(old, ['status']), new RegExp(`${id}.*records in home, code not merged: run merge ${id} again`));
    const findings = () => json(okIn(old, ['metrics', '--json'])).findings;
    assert.ok(findings().some((x) => x.kind === 'records-without-code' && x.subject === id), 'the finding that names the fix');
    assert.ok(!findings().some((x) => x.kind === 'merged-without-merge'), 'the records merge is named by its own act, logged as it landed');
    const recAct = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'merge-word' && String(a.what).startsWith(`merged home's ticket/${id} at ${r.head}`));
    assert.ok(recAct, 'the records landing is an act of its own');
    assert.deepEqual(recAct.refs ?? [], [], 'with no ticket refs: the ticket is not merged yet');
    // the retry: same checks, the records skipped (landed), the code lands, one act
    fs.rmSync(hook);
    const again = okIn(old, ['merge', id], SUP);
    assert.match(again, new RegExp(`merged ticket/${id} at \\w{12} in console`));
    assert.doesNotMatch(again, /landed the records/);
    g(['fetch', '-q', 'origin'], old); g(['fetch', '-q', 'origin'], F.console);
    assert.equal(g(['show', 'origin/trunk:src/main.js'], F.console), id, 'the code landed');
    const recordMerges = g(['log', '--first-parent', '--merges', '--format=%P', 'origin/main'], old).split('\n').filter((l) => l.split(' ')[1] === r.head);
    assert.equal(recordMerges.length, 1, 'the records merged into home once');
    assert.equal(merges().length, 1);
    assert.match(merges()[0].what, new RegExp(`^merged ticket/${id} at ${r.code}; records at ${r.head} in home`));
    assert.equal(row().records_landed, undefined);
    assert.ok(!findings().some((x) => ['records-without-code', 'merged-without-merge'].includes(x.kind)), 'both gone once the act names the records');
    assert.ok(!g(['ls-tree', '-r', '--name-only', 'origin/trunk'], F.console).split('\n').some((f) => f.startsWith('docs/devteam/')), 'nothing of the project in console');
    assert.match(okIn(old, ['merge', id], SUP), /already on trunk: nothing to merge, nothing logged/);
  } finally { F.done(); }
});
