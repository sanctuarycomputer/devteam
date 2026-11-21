// box-pins changed --smoke: the image's readers of a project on each kit, compared: equal fixtures,
// and a project kit the readers can no longer read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, cg, changed, changedKit, leftNothing, onBranch, SCRIPT, smokeRun, testHome } from './lib/machine-fixture.mjs';

// --smoke: the image's readers of a project (as of --since) against a fixture on each kit. Each run
// gets a TMPDIR of its own, so what the command leaves behind there is seen; the trace is the
// command's test seam (DEVTEAM_SMOKE_TRACE): one line per reader run.
const SMOKE_COMMANDS = ['machine status', 'machine status --questions', 'machine status --knowledge', 'recover --machine --dry-run --force'];
test('box-pins changed --smoke: two fixtures from one tree compare equal, each on a HOME of its own', () => {
  changedKit();
  cg(['checkout', '-q', '-B', 'smoke-equal', 'v9.1.0']);
  const { r, tmpd, trace } = smokeRun(['--since', 'v9.1.0', '--to', 'v9.1.0']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(r.stdout, 'kind: patch\n');
  assert.deepEqual(trace.map((x) => [x.fixture, x.command]), [...SMOKE_COMMANDS.map((c) => ['since', c]), ...SMOKE_COMMANDS.map((c) => ['to', c])]);
  const homeOf = (f) => { const hs = [...new Set(trace.filter((x) => x.fixture === f).map((x) => x.home))]; assert.equal(hs.length, 1, `${f} runs share one HOME`); return hs[0]; };
  const hs = homeOf('since'), ht = homeOf('to');
  assert.notEqual(hs, ht);
  for (const h of [hs, ht]) { assert.notEqual(h, testHome); assert.ok(h.startsWith(`${tmpd}${path.sep}`), `${h} is in the run's temporary folder`); }
  // each fixture's machine status writes into its own HOME: absent before, there after, the to run's too
  for (const f of ['since', 'to']) {
    const ms = trace.find((x) => x.fixture === f && x.command === 'machine status');
    assert.ok(!ms.home_devteam_before.some((n) => n.startsWith('status-last-')), `${f}: no status-last before its own machine status`);
    assert.ok(ms.home_devteam.some((n) => n.startsWith('status-last-')), `${f}: status-last after its own machine status`);
  }
  // each run lists exactly its own fixture, and each fixture its own seeding
  for (const x of trace) {
    assert.equal(x.exit, 0, `${x.fixture} ${x.command}: ${x.stdout}`);
    assert.equal(x.stdout.split('\n').filter((l) => /(^|[^\w-])smoke-fixture([^\w-]|$)/.test(l)).length, 1, `${x.fixture} ${x.command}: one line of one fixture\n${x.stdout}`);
  }
  const ids = (f) => trace.filter((x) => x.fixture === f && / --(questions|knowledge)$/.test(x.command)).map((x) => /\b[qk]-\d{8}-\d{9}-[a-z0-9-]+/.exec(x.stdout)?.[0]);
  const [is, it] = [ids('since'), ids('to')];
  assert.equal(is.length, 2); assert.ok(is.every(Boolean) && it.every(Boolean), `${is} ${it}`);
  for (let i = 0; i < 2; i++) assert.notEqual(is[i], it[i]);
  leftNothing(tmpd);
});

test('box-pins changed --smoke names a project kit the image\'s readers can no longer read; without --smoke it is a patch', () => {
  const cases = [
    ['questions', 'function cmdQuestions() {\n', "  if (flags.json) return out('{}');\n", 'machine status --questions'],
    ['hello', 'function cmdHello() {\n', "  if (flags.json) return out('not json');\n", 'machine status'],
  ];
  for (const [name, anchor, add, command] of cases) {
    onBranch(`smoke-${name}`, { [SCRIPT]: after(anchor, add) });
    const plain = changed(['--since', 'v9.1.0']);
    assert.equal(plain.status, 0, `${name} without --smoke: ${plain.stderr}${plain.stdout}`);
    const { r, tmpd } = smokeRun(['--since', 'v9.1.0']);
    assert.equal(r.status, 3, `${name}: ${r.stderr}${r.stdout}`);
    const lines = r.stdout.trim().split('\n');
    const kinds = lines.pop();
    assert.equal(kinds, `kind: minor (${lines.length} changes the image runs)`);
    assert.ok(lines.every((l) => l.startsWith('image: (smoke)#')), `${name}: only smoke changes\n${r.stdout}`);
    assert.ok(lines.includes(`image: (smoke)#${command}`), `${name}: names ${command}\n${r.stdout}`);
    assert.match(r.stderr, new RegExp(command.replace(/[-]/g, '\\-')), 'the first differing lines go to stderr');
    leftNothing(tmpd);
  }
});
