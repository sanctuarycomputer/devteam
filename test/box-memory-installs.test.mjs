// Worktree installs (kit-596): a session or chore worktree reuses main's installed folder, skips its
// setup on resume, and runs it through machine-wide slots. Tests here cover the two settings, the
// setup runner and its slots, the marker and the copy, and the docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { write, json, multiFixture } from './lib/kit.mjs';

test('the two settings: defaults, a repo link may carry them, and validate types them', () => {
  const F = multiFixture('installs-settings');
  const { old, runIn, okIn } = F;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-home-'));
  const env = { HOME: home };
  try {
    assert.equal(okIn(old, ['settings', '--get', 'worktree_copy'], {}, env), '[]');
    assert.equal(okIn(old, ['settings', '--get', 'worktree_setup_always'], {}, env), 'false');
    const links = json(okIn(old, ['settings'], {}, env)).links;
    const withLink = (extra) => F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, ...extra } } });
    withLink({ worktree_copy: [{ path: 'node_modules', key: 'package-lock.json' }], worktree_setup_always: true });
    const good = runIn(old, ['validate'], {}, env);
    assert.equal(good.status, 0, good.err || good.out);
    withLink({ worktree_setup_always: 'yes' });
    const bad = runIn(old, ['validate'], {}, env);
    assert.notEqual(bad.status, 0);
    assert.match(`${bad.out}\n${bad.err}`, /worktree_setup_always is true or false/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); F.done(); }
});
