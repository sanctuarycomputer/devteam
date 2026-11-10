// Landing by every forge, and a git too old for merge-tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { line, write, json, monoFixture, gitShim, until } from './lib/kit.mjs';

test('coverage at landing: no lines, no tree work; every forge judges the merge; a git that cannot merge-tree fails closed', () => {
  const F = monoFixture('landing-forges');
  const { old, run, g, lines, edit } = F;
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  const chore = (slug, fn, { from = 'origin/main' } = {}) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, from], old);
    fn(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', `chore-${slug}: x`], w);
    g(['push', '-q', 'origin', `chore-${slug}`], w);
    return g(['rev-parse', 'HEAD'], w);
  };
  const checkPr = (slug, sha, env = {}) => run(old, ['check-pr', '--head-ref', `chore-${slug}`, '--sha', sha, '--title', `chore-${slug}: x`, '--body-file', body], env);
  try {
    // no lines: a branch that conflicts with main passes check-pr, and coverage reads no tree
    const stale = g(['rev-parse', 'origin/main'], old);
    write(path.join(old, 'README.md'), 'main moved\n');
    g(['commit', '-qam', 'main edits README'], old); g(['push', '-q', 'origin', 'main'], old);
    const conflicting = chore('conflict', (w) => write(path.join(w, 'README.md'), 'the branch edits it too\n'), { from: stale });
    const spy = gitShim(F);
    const r0 = checkPr('conflict', conflicting, spy.env);
    assert.equal(r0.status, 0, `no lines: check-pr passes a conflicting chore (merge is where it conflicts): ${r0.out}`);
    assert.doesNotMatch(spy.calls(), /^(merge-tree|ls-tree)\b/m, 'no lines: coverage does no tree work');
    // lines on forge git: the same branch is refused as not merging cleanly, naming the fix
    lines(F.STD);
    assert.match(checkPr('conflict', conflicting).out, /does not merge cleanly onto origin\/main.*merge main into the branch/);
    // a git without merge-tree --write-tree fails closed, with its own message
    const clean = chore('clean', (w) => write(path.join(w, 'api/new.rb'), 'x\n'));
    const oldGit = gitShim(F, 'old');
    const r1 = checkPr('clean', clean, oldGit.env);
    assert.notEqual(r1.status, 0);
    assert.match(r1.out, /coverage needs git ≥ 2\.38 \(merge-tree --write-tree\); found 2\.34\.1/);
    assert.doesNotMatch(r1.out, /does not merge cleanly/, 'a git that cannot merge-tree is not a conflict');
    // a tree that can't be read fails closed too, never as an empty tree
    const r2 = checkPr('clean', clean, gitShim(F, 'lstree').env);
    assert.notEqual(r2.status, 0);
    assert.match(r2.out, /could not read the tree/);
    // forge github: a behind PR is judged on the merge, not its head. The branch narrows
    // web to the files it sees; main meanwhile adds web/extra.js under the old line.
    edit((j) => { j.forge = 'github'; });
    g(['commit', '-qam', 'forge github'], old); g(['push', '-q', 'origin', 'main'], old);
    const before = g(['rev-parse', 'origin/main'], old);
    write(path.join(old, 'web/extra.js'), 'x\n');
    g(['add', '-A'], old); g(['commit', '-qm', 'web extra'], old); g(['push', '-q', 'origin', 'main'], old);
    const narrow = chore('narrow-web', (w) => edit((j) => { j.components.web.owns = ['web/src/**', 'web/package.json']; }, w), { from: before });
    assert.match(checkPr('narrow-web', narrow).out, /unowned: web\/ \(1\): web\/extra\.js/, 'forge github: the merge result lands web/extra.js outside every line');
  } finally { F.done(); }
});

test('validate warns when lines are declared and git is older than 2.38, in the words merge refuses with', () => {
  const F = monoFixture('old-git-warn');
  const { old, run, lines } = F;
  const oldGit = gitShim(F, 'old');
  const said = 'components: coverage needs git ≥ 2.38 (merge-tree --write-tree); found 2.34.1; coverage fails closed until it can';
  try {
    const v0 = run(old, ['validate'], oldGit.env);
    assert.doesNotMatch(v0.out + v0.err, /git ≥ 2\.38/, 'no lines: an older git is fine');
    lines(F.STD);
    const v = run(old, ['validate'], oldGit.env);
    assert.equal(v.status, 0, `a warning, not an error: ${v.out}${v.err}`);
    assert.ok((v.out + v.err).includes(said), `the merge refusal's words: ${v.out}${v.err}`);
    assert.doesNotMatch(run(old, ['validate']).out, /git ≥ 2\.38/, 'a current git: nothing to say');
  } finally { F.done(); }
});
