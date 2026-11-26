// bash-ok (scripts/bash-ok.mjs), the PreToolUse hook on Bash in every session the kit starts: an
// inline rm of a path built from a variable, a glob, a brace or $(…) is refused with worker.md's
// "Scripts go in files" as the reason, before Claude Code stops on its "Dangerous rm operation"
// prompt in a window nobody watches. rm in quotes, comments, heredoc bodies or redirections is no
// command; anything else, and anything it can't read, goes through. It needs no repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'devteam', 'scripts', 'bash-ok.mjs');
const { inlineRiskyRm } = await import(HOOK);
// from a folder with no repo: the hook runs wherever the session is
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-ok-'));
test.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
const hook = (input) => {
  const r = spawnSync(process.execPath, [HOOK], { cwd, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
};

test('the hook: a deny with the rule word for word, from a folder with no repo', () => {
  const out = hook({ tool_name: 'Bash', tool_input: { command: 'B=/x; for d in a b; do S="$B/$d"; rm -rf -- "${S:?}"; done' } });
  assert.equal(out?.hookSpecificOutput?.permissionDecision, 'deny');
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /as a script file you write with your file tool and then run/);
  assert.equal(hook({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/literal' } }), null);
});

test('refused: an rm of a variable, glob, brace or $(…), wherever it sits and whatever wraps it', () => {
  for (const c of [
    // the command that stopped a supervisor's window
    'B=/data/run/scratchkit-947/final-2; for d in kit home code; do S="$B/$d"; rm -rf -- "${S:?}"; done; ls "$B"',
    'B=/x; for d in a b; do S="$B/$d"; [ -e "$S" ] && rm -rf -- "${S:?}"; done',
    'rm -f *.log',
    'rm -rf "$(mktemp -d)"',
    'rm -rf /tmp/run-{a,b}',
    'if [ -d x ]; then rm -r `cat list`; fi',
    '/bin/rm -f ./*.tmp',
    // wrappers
    'timeout 30 rm -rf "$X"',
    'timeout -k 5 30s rm -rf "$X"',
    'env FOO=1 rm -rf $X',
    'nohup rm -rf $X',
    'sudo -n rm -rf $X',
    'sudo -u root rm -rf $X',
    'nice -n 5 rm -rf $X',
    'FOO=1 command rm $X',
    // separators
    '(rm -rf $X)',
    'sleep 1 & rm -rf $X',
    'true || rm $X',
    'ls\nrm -rf $X',
    'ls \\\n  && rm -rf $X',
    // read again as commands
    'sh -c "rm -rf $X"',
    "bash -lc 'rm -rf $X'",
    'eval rm -rf \\$X',
    // a path after -- that starts with a dash
    'rm -- -$X',
    'rm 2>/dev/null -f $X',
  ]) assert.ok(inlineRiskyRm(c), c);
});

test('through: rm as text, a literal path, another command, a script file', () => {
  for (const c of [
    'rm -rf /tmp/literal',
    "rm -f 'a$b'",
    "rm 'a b$c'",
    'git rm --cached x',
    'echo rm $x',
    'echo "done; rm $X"',
    "printf '%s\\n' 'x; rm *'",
    'grep -E "x|rm *.log" notes.md',
    "grep -rn 'rm -rf \"$S\"' docs",
    '# then rm *\nls',
    'ls # rm -rf $X',
    "git commit -m \"$(cat <<'EOF'\nClean up\n\nrm * was the old way\nEOF\n)\"",
    "cat > x.sh <<'EOF'\nrm -rf \"${S:?}\"\nEOF\nbash x.sh",
    'cat <<-EOF > y\n\trm -rf $X\n\tEOF\nls',
    'bash /tmp/clean.sh',
    'ls -la "$HOME" > "$OUT" 2>&1',
    'npm run rm-dist -- --all',
    'find . -name "*.tmp" -delete',
    'gh pr create --body "rm -rf $X is refused now"',
    'timeout 30 node test/run.mjs x',
  ]) assert.equal(inlineRiskyRm(c), null, c);
});

test('anything it cannot read, or another tool, goes through', () => {
  assert.equal(hook('not json'), null);
  assert.equal(hook(''), null);
  assert.equal(hook({ tool_name: 'Read', tool_input: { file_path: '/tmp/x' } }), null);
  assert.equal(hook({ tool_name: 'Bash' }), null);
  assert.equal(inlineRiskyRm('echo "unterminated'), null);
  assert.equal(inlineRiskyRm("echo 'x"), null);
});
