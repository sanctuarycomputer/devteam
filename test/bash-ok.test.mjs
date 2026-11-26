// bash-ok, the PreToolUse hook on Bash in every session the kit starts: an inline rm of a path built
// from a variable, a glob, a brace or $(…) is refused with worker.md's "Scripts go in files" as the
// reason, before Claude Code stops on its "Dangerous rm operation" prompt in a window nobody
// watches. Anything else, and anything it can't read, goes through. It needs no repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'devteam', 'scripts', 'devteam.mjs');
// from a folder with no repo: the hook runs wherever the session is
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-ok-'));
test.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
const hook = (input) => {
  const r = spawnSync(process.execPath, [KIT, 'bash-ok'], { cwd, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
};
const bash = (command) => hook({ tool_name: 'Bash', tool_input: { command } });

test('refused: an rm of a variable, glob, brace or $(…), wherever it sits in the line', () => {
  for (const c of [
    'B=/data/run/scratch; for d in kit home code; do S="$B/$d"; rm -rf -- "${S:?}"; done; ls "$B"',
    'B=/x; for d in a b; do S="$B/$d"; [ -e "$S" ] && rm -rf -- "${S:?}"; done',
    'rm -f *.log',
    'rm -rf "$(mktemp -d)"',
    'rm -rf /tmp/run-{a,b}',
    'cd /tmp && sudo rm -rf $DIR',
    'if [ -d x ]; then rm -r `cat list`; fi',
    'find . -name x | xargs echo; /bin/rm -f ./*.tmp',
  ]) {
    const out = bash(c);
    assert.equal(out?.hookSpecificOutput?.permissionDecision, 'deny', c);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /as a script file you write with your file tool and then run/, 'the reason is the rule, word for word');
  }
});

test('through: a literal rm, a quoted literal, another command, a script file', () => {
  for (const c of ['rm -rf /tmp/literal', "rm -f 'a$b'", 'git rm --cached x', 'echo rm $x', 'bash /tmp/clean.sh', 'ls -la "$HOME"', 'npm run rm-dist -- --all']) {
    assert.equal(bash(c), null, c);
  }
});

test('anything it cannot read, or another tool, goes through', () => {
  assert.equal(hook('not json'), null);
  assert.equal(hook(''), null);
  assert.equal(hook({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } }), null);
  assert.equal(hook({ tool_name: 'Bash' }), null);
});
