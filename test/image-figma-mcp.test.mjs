// The image's boot adds Figma's MCP once per disk, with no token, before any session starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const df = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cloud', 'Dockerfile'), 'utf8');
const block = /# figma-mcp start\n([\s\S]*?)# figma-mcp end/.exec(df)?.[1];

function box() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-mcp-'));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  // a claude that records each call; `mcp get` finds figma once it was added, and $NO_ADD makes add fail
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
echo "$*" >> "$HOME/calls"
case "$2" in
  get) [ -e "$HOME/has-figma" ] ;;
  add) [ -z "$NO_ADD" ] && : > "$HOME/has-figma" ;;
esac
`, { mode: 0o755 });
  const boot = (env = {}) => {
    const r = spawnSync('sh', ['-c', `note() { echo "$*" >> "$HOME/notes"; }\n${block}`], { cwd: home, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, ...env } });
    assert.equal(r.status, 0, r.stderr);
  };
  const calls = () => (fs.existsSync(path.join(home, 'calls')) ? fs.readFileSync(path.join(home, 'calls'), 'utf8').trim().split('\n') : []);
  return { home, boot, calls, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test('the block comes before the first session, and carries no credential', () => {
  assert.ok(block, 'the figma-mcp block');
  assert.ok(df.indexOf('# figma-mcp start') < df.indexOf('\nstart_operator boot'), 'added before the operator starts');
  assert.doesNotMatch(block, /--header|Authorization|Bearer|token=/i);
});

test('added once, with the login left to the owner; a server they removed stays removed', () => {
  const B = box();
  try {
    B.boot();
    assert.deepEqual(B.calls(), ['mcp get figma', 'mcp add --transport http --scope user figma https://mcp.figma.com/mcp']);
    fs.rmSync(path.join(B.home, 'has-figma'));
    B.boot();
    assert.equal(B.calls().length, 2, 'the mark holds: no second add');
  } finally { B.done(); }
});

test('one already there is left alone, and a failed add is noted and tried at the next boot', () => {
  const A = box();
  try {
    fs.writeFileSync(path.join(A.home, 'has-figma'), '');
    A.boot();
    assert.deepEqual(A.calls(), ['mcp get figma']);
  } finally { A.done(); }
  const F = box();
  try {
    F.boot({ NO_ADD: '1' });
    assert.ok(!fs.existsSync(path.join(F.home, '.box/figma-mcp')));
    assert.match(fs.readFileSync(path.join(F.home, 'notes'), 'utf8'), /could not add the Figma MCP/);
    F.boot();
    assert.ok(fs.existsSync(path.join(F.home, '.box/figma-mcp')), 'the next boot adds it');
  } finally { F.done(); }
});
