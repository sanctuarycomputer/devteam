// The image's boot adds Context7's MCP once per disk, before any session starts: with the owner's
// key from ~/.box/context7-key as a header when there is one, without when there isn't.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const df = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'cloud', 'Dockerfile'), 'utf8');
const block = /# context7-mcp start\n([\s\S]*?)# context7-mcp end/.exec(df)?.[1];
const URL = 'https://mcp.context7.com/mcp';

function box() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'context7-mcp-'));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(home, '.box'));
  // a claude that records each call, one argument a line; `mcp get` finds context7 once it was added, and $NO_ADD makes add fail
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh
printf '%s|' "$@" >> "$HOME/calls"; echo >> "$HOME/calls"
case "$2" in
  get) [ -e "$HOME/has-c7" ] && echo "  Scope: $(cat "$HOME/has-c7")" ;;
  add) [ -z "$NO_ADD" ] && echo 'User config (available in all your projects)' > "$HOME/has-c7" && echo added-to-log ;;
esac
`, { mode: 0o755 });
  const boot = (env = {}) => {
    const r = spawnSync('sh', ['-c', `note() { echo "$*" >> "$HOME/notes"; }\n${block}\necho "after:\${c7key-unset}" >> "$HOME/ran"`], { cwd: home, encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, HOME: home, ...env } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(home, 'ran'), 'utf8').trim(), 'after:unset', 'the boot went on past the block, with the key unset');
    fs.rmSync(path.join(home, 'ran'));
  };
  const calls = () => (fs.existsSync(path.join(home, 'calls')) ? fs.readFileSync(path.join(home, 'calls'), 'utf8').trim().split('\n') : []);
  return { home, boot, calls, done: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test('the block comes before the first session, holds no key of its own, and every call has a time limit', () => {
  assert.ok(block, 'the context7-mcp block');
  assert.ok(df.indexOf('# context7-mcp start') < df.indexOf('\nstart_operator boot'), 'added before the operator starts');
  assert.ok(df.indexOf('# figma-mcp end') < df.indexOf('# context7-mcp start'), 'after .box is made, beside Figma');
  assert.doesNotMatch(block, /ctx7sk|Bearer/i, 'no key in the image');
  assert.equal([...block.matchAll(/claude mcp/g)].length, [...block.matchAll(/timeout 30 claude mcp/g)].length);
  assert.match(df, /\nContext7: every session can look up current library docs\./, 'the welcome text says how to add a key');
});

test('added once without a key, and a server the owner removed stays removed', () => {
  const B = box();
  try {
    B.boot();
    assert.deepEqual(B.calls(), ['mcp|get|context7|', `mcp|add|--transport|http|--scope|user|context7|${URL}|`]);
    assert.match(fs.readFileSync(path.join(B.home, 'box.log'), 'utf8'), /added-to-log/, "the add's output goes to box.log");
    assert.ok(fs.existsSync(path.join(B.home, '.box/context7-mcp')));
    fs.rmSync(path.join(B.home, 'has-c7'));
    B.boot();
    assert.equal(B.calls().length, 2, 'the mark holds: no second add');
  } finally { B.done(); }
});

test("with the owner's key, it goes as the header, trimmed, and never into box.log or the notes", () => {
  const K = box();
  try {
    fs.writeFileSync(path.join(K.home, '.box/context7-key'), ' ctx7sk-test-123 \nignored second line\n');
    K.boot();
    assert.deepEqual(K.calls()[1], `mcp|add|--transport|http|--scope|user|context7|${URL}|--header|CONTEXT7_API_KEY: ctx7sk-test-123|`);
    for (const f of ['box.log', 'notes']) {
      const p = path.join(K.home, f);
      if (fs.existsSync(p)) assert.doesNotMatch(fs.readFileSync(p, 'utf8'), /ctx7sk/);
    }
  } finally { K.done(); }
});

test('one already there is marked and left alone; a failed add is noted and tried at the next boot', () => {
  const A = box();
  try {
    fs.writeFileSync(path.join(A.home, 'has-c7'), 'User config (available in all your projects)\n');
    A.boot();
    assert.deepEqual(A.calls(), ['mcp|get|context7|']);
    assert.ok(fs.existsSync(path.join(A.home, '.box/context7-mcp')));
  } finally { A.done(); }
  const F = box();
  try {
    F.boot({ NO_ADD: '1' });
    assert.ok(!fs.existsSync(path.join(F.home, '.box/context7-mcp')));
    assert.match(fs.readFileSync(path.join(F.home, 'notes'), 'utf8'), /could not add the Context7 MCP/);
    F.boot();
    assert.ok(fs.existsSync(path.join(F.home, '.box/context7-mcp')), 'the next boot adds it');
  } finally { F.done(); }
});
