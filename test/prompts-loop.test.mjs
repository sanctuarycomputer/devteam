// A supervisor keeps its tick loop after setup (supervisor.md §1.7, kit-310): the prompt and init's next line say so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bareProject } from './lib/kit.mjs';

const run = (root, base, args, extra = {}) =>
  spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: base, ...extra } });

test('prompt supervisor: after the end-of-setup sentence, setup ends at start-up and the loop is kept', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-loop-'));
  try {
    const root = bareProject(base, 'loop');
    const r = run(root, base, ['prompt', 'supervisor'], { DEVTEAM_ROLE: 'supervisor' });
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout;
    const end = out.indexOf('by asking the owner what the project is for.');
    assert.ok(end > -1, 'the end-of-setup sentence is there');
    const rest = out.slice(end);
    assert.match(rest, /Setup ends when start-up \(supervisor\.md §1, steps 1-6\) has run/);
    assert.match(rest, /devteam\.mjs wait in the background/);
    assert.match(rest, /keep the loop until the owner stops you/);
    assert.match(rest, /run the tick \(supervisor\.md §3\), then start node docs\/devteam\/scripts\/devteam\.mjs wait/);
    assert.match(rest, /tick again when it returns/);
    assert.match(rest, /Never end a turn without a wait running/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('init: the next line says the supervisor keeps its loop', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-loop-'));
  try {
    const root = bareProject(base, 'loop');
    const r = run(root, base, ['init', '--name', 'loop']);
    assert.equal(r.status, 0, r.stderr);
    const last = r.stdout.split('\n').filter((l) => l.trim()).pop();
    assert.ok(last.startsWith('next:'), last);
    assert.ok(last.includes('keeps its loop: devteam.mjs wait in the background, a tick when it returns, never a turn ended without a wait running'), last);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
