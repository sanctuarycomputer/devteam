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
  get) [ -e "$HOME/has-figma" ] && echo "  Scope: $(cat "$HOME/has-figma")" ;;
  add) [ -z "$NO_ADD" ] && echo 'User config (available in all your projects)' > "$HOME/has-figma" && echo added-to-log ;;
esac
`, { mode: 0o755 });
  const boot = (env = {}) => {
    const r = spawnSync('sh', ['-c', `note() { echo "$*" >> "$HOME/notes"; }\n${block}\necho after >> "$HOME/ran"`], { cwd: home, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, ...env } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(home, 'ran')), 'the boot went on past the block');
    fs.rmSync(path.join(home, 'ran'));
  };
  const calls = () => (fs.existsSync(path.join(home, 'calls')) ? fs.readFileSync(path.join(home, 'calls'), 'utf8').trim().split('\n') : []);
  return { home, boot, calls, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test('the block comes before the first session, and carries no credential', () => {
  assert.ok(block, 'the figma-mcp block');
  assert.ok(df.indexOf('# figma-mcp start') < df.indexOf('\nstart_operator boot'), 'added before the operator starts');
  assert.doesNotMatch(block, /--header|Authorization|Bearer|token=/i);
  // a hung CLI can't hold the boot, before the operator and the terminal are up
  assert.equal([...block.matchAll(/claude mcp/g)].length, 2);
  assert.equal([...block.matchAll(/timeout 30 claude mcp/g)].length, 2, 'both calls have a time limit');
  assert.match(df, /Figma: in Claude, \/mcp, pick figma and log in once; new sessions then have it/, 'the welcome text says how');
});

test('added once, with the login left to the owner; a server they removed stays removed', () => {
  const B = box();
  try {
    B.boot();
    assert.deepEqual(B.calls(), ['mcp get figma', 'mcp add --transport http --scope user figma https://mcp.figma.com/mcp']);
    assert.match(fs.readFileSync(path.join(B.home, 'box.log'), 'utf8'), /added-to-log/, "the add's output goes to box.log");
    fs.rmSync(path.join(B.home, 'has-figma'));
    B.boot();
    assert.equal(B.calls().length, 2, 'the mark holds: no second add');
  } finally { B.done(); }
});

test('one already there is left alone, and a failed add is noted and tried at the next boot', () => {
  const A = box();
  try {
    fs.writeFileSync(path.join(A.home, 'has-figma'), 'User config (available in all your projects)\n');
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

test('a figma from another scope is not counted, and an unwritable .box never stops the boot', () => {
  const P = box();
  try {
    fs.writeFileSync(path.join(P.home, 'has-figma'), 'Project config (shared via .mcp.json)\n');
    P.boot();
    assert.ok(P.calls().some((c) => c.startsWith('mcp add')), 'a project-scope figma still gets the user one');
  } finally { P.done(); }
  const R = box();
  try {
    fs.writeFileSync(path.join(R.home, 'has-figma'), 'User config (available in all your projects)\n');
    fs.mkdirSync(path.join(R.home, '.box'));
    fs.chmodSync(path.join(R.home, '.box'), 0o555);
    R.boot();
    assert.match(fs.readFileSync(path.join(R.home, 'notes'), 'utf8'), /could not mark the Figma MCP/);
    fs.chmodSync(path.join(R.home, '.box'), 0o755);
  } finally { R.done(); }
});
