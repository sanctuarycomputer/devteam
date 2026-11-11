// settings.merge_admin: merge adds --admin to gh pr merge when it is true (after all of merge's own
// checks), never by default, and changing it is the owner's (governance-edit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, write } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

const editSettings = (dir, fn) => {
  const f = path.join(dir, 'docs/devteam/project/settings.md');
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  const j = JSON.parse(m[1]);
  fn(j);
  fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
};

// A chore branch off origin/main with these files, pushed; returns its head sha.
function chore(F, slug, files, edit) {
  const { old, g } = F;
  const w = path.join(old, '.worktrees', `chore-${slug}`);
  g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
  for (const [f, text] of Object.entries(files)) write(path.join(w, f), text);
  if (edit) editSettings(w, edit);
  g(['add', '-A'], w);
  g(['commit', '-qm', slug], w);
  g(['push', '-q', 'origin', `chore-${slug}`], w);
  const sha = g(['rev-parse', 'HEAD'], w);
  g(['worktree', 'remove', '--force', w], old);
  return sha;
}

// A gh first on PATH: `pr view` answers with one open, clean PR at this head; `pr merge` logs its
// arguments and succeeds (it lands nothing: merge doesn't re-read the PR after a merge).
function fakeGh(F, slug, sha) {
  const bin = path.join(F.base, `bin-${slug}`);
  const prFile = path.join(F.base, `pr-${slug}.json`);
  const log = path.join(F.base, `gh-${slug}.log`);
  write(prFile, JSON.stringify({ number: 7, headRefOid: sha, title: `chore-${slug}: x`, body: '## One-way doors\n\nNone.\n', isDraft: false, mergeStateStatus: 'CLEAN', url: 'https://example.test/pr/7', statusCheckRollup: [] }));
  write(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\n[ "$1 $2" = "pr view" ] && exec cat "${prFile}"\n[ "$1 $2" = "pr merge" ] && exit 0\nexit 1\n`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  return { env: { ...SUP, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []) };
}

// Main on the github forge, with merge_admin as given (absent: the default).
function githubMain(F, admin) {
  const { old, g } = F;
  editSettings(old, (j) => { j.forge = 'github'; if (admin !== undefined) j.merge_admin = admin; });
  g(['commit', '-qam', 'forge github'], old);
  g(['push', '-q', 'origin', 'main'], old);
}

const prMerges = (calls) => calls.filter((c) => c.startsWith('pr merge '));

test('merge_admin true: merge passes --admin to gh pr merge, after its own checks', () => {
  const F = fleetFixture('merge-admin-on');
  try {
    githubMain(F, true);
    const sha = chore(F, 'notes', { 'docs/devteam/project/designs/notes.md': 'n\n' });
    const gh = fakeGh(F, 'notes', sha);
    const r = F.run(F.old, ['merge', '--chore', 'notes'], gh.env);
    assert.equal(r.status, 0, r.err || r.out);
    assert.deepEqual(prMerges(gh.calls()), [`pr merge 7 --merge --admin --match-head-commit ${sha}`]);
  } finally { F.done(); }
});

test('merge_admin by default: gh pr merge has no --admin', () => {
  const F = fleetFixture('merge-admin-off');
  try {
    githubMain(F);
    const sha = chore(F, 'notes', { 'docs/devteam/project/designs/notes.md': 'n\n' });
    const gh = fakeGh(F, 'notes', sha);
    const r = F.run(F.old, ['merge', '--chore', 'notes'], gh.env);
    assert.equal(r.status, 0, r.err || r.out);
    assert.deepEqual(prMerges(gh.calls()), [`pr merge 7 --merge --match-head-commit ${sha}`]);
  } finally { F.done(); }
});

test('merge_admin true bypasses none of merge\'s own refusals: a refused PR never reaches gh pr merge', () => {
  const F = fleetFixture('merge-admin-refused');
  try {
    githubMain(F, true);
    // a kit file with no owner answer: refused before anything reaches gh pr merge
    const sha = chore(F, 'rules', { 'docs/devteam/governance/quality.md': 'A changed rule.\n' });
    const gh = fakeGh(F, 'rules', sha);
    const r = F.run(F.old, ['merge', '--chore', 'rules'], gh.env);
    assert.notEqual(r.status, 0);
    assert.deepEqual(prMerges(gh.calls()), []);
  } finally { F.done(); }
});

test('a PR that changes merge_admin needs a governance-edit answer', () => {
  const F = fleetFixture('merge-admin-owner');
  const { old, ok, run } = F;
  try {
    chore(F, 'admin', {}, (j) => { j.merge_admin = true; });
    write(path.join(old, 'docs/devteam/run/pr/chore-admin.md'), '# chore-admin: x\n\n## One-way doors\n\nNone.\n');
    const merge = (...extra) => { const r = run(old, ['merge', '--chore', 'admin', '--dry-run', ...extra], SUP); return { status: r.status, text: r.out + r.err }; };
    const ask = (cls) => { const q = ok(old, ['ask', '--question', 'Let merge use --admin?', '--recommendation', 'yes', '--class', cls, '--reasons', 'owner-only'], SUP); ok(old, ['answer', q, 'yes']); return q; };
    const none = merge();
    assert.notEqual(none.status, 0);
    assert.match(none.text, /changes owner settings: merge_admin \(governance-edit\)/);
    assert.notEqual(merge('--approved', ask('gate-change')).status, 0, 'a gate-change answer does not approve it');
    const r = merge('--approved', ask('governance-edit'));
    assert.equal(r.status, 0, r.text);
  } finally { F.done(); }
});
