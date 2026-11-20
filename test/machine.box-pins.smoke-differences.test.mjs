// box-pins changed --smoke: what counts as a difference, and the runs it refuses (a fixture it can't
// seed, an image blind to it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { after, leftNothing, onBranch, SCRIPT, smokeRun } from './lib/machine-fixture.mjs';

const before = (anchor, add) => (t) => { assert.equal(t.split(anchor).length, 2, `anchor ${anchor} once`); return t.replace(anchor, () => `${add}${anchor}`); };

test('box-pins changed --smoke: a kit= the image can\'t read is a difference, never a placeholder; an exit alone is one too', () => {
  // a number where the image reads a string: its line says kit=?, which the kit placeholder must not take
  onBranch('smoke-kit', { [SCRIPT]: before('  return flags.json ? json(r) : out(`${r.name} at', '  r.kit = 42;\n') });
  const k = smokeRun(['--since', 'v9.1.0']);
  assert.equal(k.r.status, 3, k.r.stderr + k.r.stdout);
  assert.ok(k.r.stdout.split('\n').includes('image: (smoke)#machine status'), k.r.stdout);
  leftNothing(k.tmpd);
  // the fixture's own recover says the same and exits 1: the image's recover --machine exits 1 with the same line
  onBranch('smoke-exit', { [SCRIPT]: after("  out(say);\n  if (say.startsWith('NOT started')) process.exitCode = 1;\n", '  process.exitCode = 1;\n') });
  const e = smokeRun(['--since', 'v9.1.0']);
  assert.equal(e.r.status, 3, e.r.stderr + e.r.stdout);
  const lines = e.r.stdout.split('\n');
  assert.ok(lines.includes('image: (smoke)#recover --machine --dry-run --force'), e.r.stdout);
  assert.ok(!lines.some((l) => l.startsWith('image: (smoke)#machine')), e.r.stdout);
  const rec = e.trace.filter((x) => x.command === 'recover --machine --dry-run --force');
  assert.deepEqual(rec.map((x) => x.exit), [0, 1]);
  assert.equal(rec[0].stdout, rec[1].stdout, 'the same line, only the exit differs');
  leftNothing(e.tmpd);
});

test('box-pins changed --smoke exits 2, says why and cleans up, when a fixture can\'t be seeded or the image is blind', () => {
  onBranch('smoke-no-init', { [SCRIPT]: after('function cmdInit() {\n', "  die('broken for the test');\n") });
  const s = smokeRun(['--since', 'v9.1.0']);
  assert.equal(s.r.status, 2, s.r.stderr + s.r.stdout);
  assert.equal(s.r.stdout, '');
  assert.match(s.r.stderr, /^devteam: box-pins changed: --smoke: the to fixture's init failed \(exit 1\): devteam: broken for the test$/m);
  leftNothing(s.tmpd);
  // the image's own kit prints nothing of its fixture for --questions: the comparison would be blind
  onBranch('smoke-blind', { [SCRIPT]: after('function machineQuestions() {\n', '  return;\n') });
  const b = smokeRun(['--since', 'smoke-blind', '--to', 'v9.1.0']);
  assert.equal(b.r.status, 2, b.r.stderr + b.r.stdout);
  assert.equal(b.r.stdout, '');
  assert.match(b.r.stderr, /^devteam: box-pins changed: --smoke: machine status --questions printed no line of the --since fixture$/m);
  leftNothing(b.tmpd);
});
