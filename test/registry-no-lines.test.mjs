// url links in a project with no lines: no git 2.38 needed.
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
import { write, monoFixture, gitShim } from './lib/kit.mjs';

test('url links and no lines need no git 2.38: the registry at landing is read from settings.md, never merge-tree', () => {
  const F = monoFixture('registry-oldgit');
  const { old, ok, run, g, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  const settingsRel = 'docs/devteam/project/settings.md';
  try {
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a' } }; });
    g(['commit', '-qam', 'figma'], old); g(['push', '-q', 'origin', 'main'], old);
    const before = g(['rev-parse', 'origin/main'], old);
    // main's settings.md moves after the branch leaves it, figma's title by hand included: what would
    // land keeps main's figma (the branch leaves it alone), so figma needs no act
    edit((j) => { j.tick_minutes = 7; j.links.figma.title = 'All designs'; });
    g(['commit', '-qam', 'tick'], old); g(['push', '-q', 'origin', 'main'], old);
    ok(old, ['link', 'add', 'notion', '--kind', 'url', '--url', 'https://notion.test/r', '--title', 'Runbook'], SUP);
    g(['checkout', '-q', '--', settingsRel], old);
    const w = path.join(old, '.worktrees', 'chore-registry');
    g(['worktree', 'add', '-q', '-b', 'chore-registry', w, before], old);
    edit((j) => { j.links.notion = { kind: 'url', url: 'https://notion.test/r', title: 'Runbook' }; }, w);
    g(['commit', '-qam', 'chore-registry: notion'], w); g(['push', '-q', 'origin', 'chore-registry'], w);
    write(path.join(old, 'docs/devteam/run/pr/chore-registry.md'), '# chore-registry: notion\n\n## One-way doors\n\nNone.\n');
    const oldGit = gitShim(F, 'old');
    const c = run(old, ['check-pr', '--head-ref', 'chore-registry', '--sha', g(['rev-parse', 'HEAD'], w), '--title', 'chore-registry: notion', '--body-file', body], oldGit.env);
    assert.equal(c.status, 0, `check-pr on git 2.34 with no lines: ${c.out}`);
    const m = run(old, ['merge', '--chore', 'registry', '--dry-run'], { ...SUP, ...oldGit.env });
    assert.equal(m.status, 0, `merge on git 2.34 with no lines: ${m.out}${m.err}`);
    assert.doesNotMatch(oldGit.calls(), /^merge-tree\b/m, 'no merge-tree without lines');
    // the landing registry is still judged: a bad kind on the branch is refused, on old git too
    edit((j) => { j.links.bad = { kind: 'doc', title: 'D' }; }, w);
    g(['commit', '-qam', 'chore-registry: bad'], w);
    const b = run(old, ['check-pr', '--head-ref', 'chore-registry', '--sha', g(['rev-parse', 'HEAD'], w), '--title', 'chore-registry: notion', '--body-file', body], oldGit.env);
    assert.match(b.out, /settings at landing: links\.bad: unknown kind "doc"/);
    assert.doesNotMatch(b.out, /coverage needs git/);
  } finally { F.done(); }
});
