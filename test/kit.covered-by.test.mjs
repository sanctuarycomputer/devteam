import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { multiFixture, fleetFixture, write, review, json } from './lib/kit.mjs';

// ===== covered_by: merge trusts a gate's green forge checks at the exact head (kit-205) =====
// A console sibling ticket on a github forge, with a fake gh whose `pr view` answers come from
// view-<n>.json by call order; the gate's command touches a marker, so "ran" is a file check.
const COV_SUP = { DEVTEAM_ROLE: 'supervisor' };
const covRun = (n) => ({ __typename: 'CheckRun', name: n, status: 'COMPLETED', conclusion: 'SUCCESS' });
const covPending = (n) => ({ __typename: 'CheckRun', name: n, status: 'IN_PROGRESS', conclusion: null });
const covFailed = (n) => ({ __typename: 'CheckRun', name: n, status: 'COMPLETED', conclusion: 'FAILURE' });
const covSkipped = (n) => ({ __typename: 'CheckRun', name: n, status: 'COMPLETED', conclusion: 'SKIPPED' });
const covNeutral = (n) => ({ __typename: 'CheckRun', name: n, status: 'COMPLETED', conclusion: 'NEUTRAL' });
const covStatus = (n, state) => ({ __typename: 'StatusContext', context: n, state });

function coveredFixture(name) {
  const F = multiFixture(name);
  const { old, g, okIn, runIn, ticket } = F;
  g(['remote', 'set-url', 'origin', 'https://github.com/usbclub/console.git'], F.console);
  g(['config', `url.${F.consoleOrigin}.insteadOf`, 'https://github.com/usbclub/console.git'], F.console);
  const links0 = json(okIn(old, ['settings'])).links;
  const marker = path.join(F.base, 'ran-test');
  const cmd = `touch '${marker}'`;
  // settings land on home's main (committed and pushed); the same settings again change nothing
  let last = null;
  const setGate = (gate = { cmd, covered_by: 'ci' }, extra = {}) => { const k = JSON.stringify([gate, extra]); if (k === last) return; last = k; F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links0, console: { ...links0.console, remote: 'usbclub/console', forge: 'github', gates: { test: gate }, ...extra } } }); };
  setGate();
  const land = (id, files) => {
    ticket(id, { touches: [...new Set(Object.keys(files).map((f) => `${f.split('/')[0]}/**`))] });
    const w = path.join(old, '.worktrees', id);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
    const tdir = path.join(w, `docs/devteam/project/tickets/${id}`);
    write(path.join(tdir, 'spec.md'), '# spec\n');
    write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- x\n');
    write(path.join(tdir, 'verification.md'), '| Done-when | Command | Result |\n|---|---|---|\n| s | t | pass |\n');
    for (const [f, text] of Object.entries(files)) write(path.join(w, f), text);
    g(['add', '-A'], w); g(['commit', '-qm', `${id}: work`], w);
    write(path.join(tdir, 'reviews/final-1.md'), review('reviewer-b', g(['rev-parse', 'HEAD'], w)));
    g(['add', '-A'], w); g(['commit', '-qm', 'review'], w); g(['push', '-q', 'origin', `ticket/${id}`], w);
    okIn(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], COV_SUP);
    okIn(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], COV_SUP);
    write(path.join(old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
    return g(['rev-parse', 'HEAD'], w);
  };
  const sha = land('console-01-a', { 'src/main.js': 'changed\n' });
  const bin = path.join(F.base, 'fakegh');
  const logf = path.join(F.base, 'gh.log');
  const cnt = path.join(F.base, 'gh.count');
  // views: [rollup | { rollup, head } | 'fail', …]; the last repeats. Resets the count, the log and the marker.
  const gh = (views, { id = 'console-01-a', head = sha } = {}) => {
    for (const f of [logf, cnt, marker]) fs.rmSync(f, { force: true });
    views.forEach((v, i) => write(path.join(bin, `view-${i + 1}.json`), v === 'fail' ? 'fail' : JSON.stringify({ number: 7, headRefOid: Array.isArray(v) ? head : v.head, title: `${id}: work`, body: '## One-way doors\n\nNone.\n', isDraft: false, mergeStateStatus: 'CLEAN', url: 'https://example.test/pr/7', statusCheckRollup: Array.isArray(v) ? v : v.rollup })));
    write(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> '${logf}'\nif [ "$1 $2" = "pr view" ]; then\n  n=$(cat '${cnt}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${cnt}'\n  [ $n -gt ${views.length} ] && n=${views.length}\n  f='${bin}'/view-$n.json\n  [ "$(cat "$f")" = fail ] && exit 1\n  exec cat "$f"\nfi\n[ "$1 $2" = "pr merge" ] && exit 0\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
  };
  const merge = (args = [], id = 'console-01-a') => { const r = runIn(old, ['merge', id, ...args], COV_SUP, { PATH: `${bin}${path.delimiter}${process.env.PATH}` }); return { status: r.status, text: `${r.out}\n${r.err}` }; };
  const calls = () => (fs.existsSync(logf) ? fs.readFileSync(logf, 'utf8').split('\n').filter(Boolean) : []);
  const views = () => calls().filter((c) => c.startsWith('pr view '));
  const gateLines = (at = sha) => json(okIn(old, ['log', '--type', 'gate', '--json'])).filter((x) => x.gate === 'test' && x.sha === at).length;
  const act = (id = 'console-01-a') => json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'merge-word' && a.refs.includes(id));
  return { F, sha, cmd, setGate, land, gh, merge, calls, views, gateLines, act, ran: () => fs.existsSync(marker) };
}

test('merge covered_by "ci": every check green at the head, the gate is not run, and merge says so in its output and act', () => {
  const C = coveredFixture('cov-ci');
  try {
    C.gh([[covRun('test'), covRun('lint')]]);
    const r = C.merge();
    assert.equal(r.status, 0, r.text);
    assert.equal(C.ran(), false, 'the gate did not run');
    assert.equal(C.gateLines(), 0, 'no gate line for a gate that did not run');
    assert.match(r.text, /gate test not run here: the forge's checks ran it green at \w{12} \(test, lint\)/);
    assert.ok(C.act().what.includes(`gate test covered by the forge's checks at ${C.sha} (test, lint)`), C.act().what);
    assert.match(C.views()[1] ?? '', /^pr view 7 --json headRefOid,statusCheckRollup/, 'the re-read names the PR by number');
  } finally { C.F.done(); }
});

test('merge covered_by a list: the named checks green, the gate is not run, and the act names them', () => {
  const C = coveredFixture('cov-list');
  try {
    C.setGate({ cmd: C.cmd, covered_by: ['test'] });
    C.gh([[covRun('test'), covStatus('deploy', 'SUCCESS')]]);
    const r = C.merge();
    assert.equal(r.status, 0, r.text);
    assert.equal(C.ran(), false);
    assert.match(r.text, /gate test not run here: .* \(test\)/);
    assert.ok(C.act().what.includes(`gate test covered by the forge's checks at ${C.sha} (test)`), C.act().what);
  } finally { C.F.done(); }
});

test('merge covered_by: when coverage fails, the gate runs as today', async (t) => {
  const C = coveredFixture('cov-runs');
  const green = [covRun('test')];
  // the gate ran here: its marker, one more gate line, and merge's reason
  const runs = (why, args = ['--dry-run']) => {
    const before = C.gateLines();
    const r = C.merge(args);
    assert.equal(r.status, 0, r.text);
    assert.equal(C.ran(), true, `the gate ran: ${r.text}`);
    assert.equal(C.gateLines(), before + 1, 'a gate line for the run');
    assert.match(r.text, /gate test runs here: /);
    assert.match(r.text, why);
    return r;
  };
  try {
    await t.test('covered_by: a pending, failed, missing, neutral or skipped check, or an ignored one failing', () => {
      const rows = [
        ['ci', green, [covRun('test'), covPending('lint')], /lint is pending/],
        [['test'], green, [covFailed('test')], /test is failure/],
        [['test', 'e2e'], green, green, /e2e is missing/],
        ['ci', [], [], /the forge reports no checks/],
        ['ci', [covRun('lint'), covSkipped('test')], [covRun('lint'), covSkipped('test')], /test is skipped/],
        [['test'], [covNeutral('test')], [covNeutral('test')], /test is neutral/],
        [['test'], green, [covRun('test'), covFailed('test')], /test is failure/],
        // a re-run: the old failed attempt first, the new green one after; still not covered
        [['test'], green, [covFailed('test'), covRun('test')], /test is failure/],
        ['ci', green, [covFailed('test'), covRun('test')], /test is failure/],
        [['test'], green, [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: null }], /test is pending/],
        [['test'], green, [{ __typename: 'CheckRun', name: 'test' }], /test is pending/],
      ];
      for (const [by, first, fresh, why] of rows) {
        C.setGate({ cmd: C.cmd, covered_by: by });
        C.gh([first, fresh]);
        runs(why);
      }
      C.setGate({ cmd: C.cmd, covered_by: 'ci' }, { ignored_checks: ['flaky'] });
      C.gh([[covRun('test'), covFailed('flaky')]]);
      runs(/flaky is failure \(ignored_checks never counts as coverage\)/);
      // a lowercase state is uppercased, as today: green
      C.setGate({ cmd: C.cmd, covered_by: ['test'] });
      C.gh([green, [covStatus('test', 'success')]]);
      const r = C.merge(['--dry-run']);
      assert.equal(r.status, 0, r.text);
      assert.equal(C.ran(), false, r.text);
      assert.match(r.text, /not run here/);
    });
    await t.test('covered_by: a PR that changes the forge\'s CI configuration runs the gate', () => {
      C.setGate();
      const sha2 = C.land('console-02-g', { 'src/main.js': 'again\n', '.github/workflows/test.yml': 'on: pull_request\n' });
      C.gh([green], { id: 'console-02-g', head: sha2 });
      const before = C.gateLines(sha2);
      const r = C.merge(['--dry-run'], 'console-02-g');
      assert.equal(r.status, 0, r.text);
      assert.equal(C.ran(), true, r.text);
      assert.equal(C.gateLines(sha2), before + 1);
      assert.match(r.text, /gate test runs here: the PR changes the forge's CI configuration \(\.github\/workflows\/test\.yml\)/);
      assert.equal(C.views().length, 1, 'no re-read needed');
    });
    await t.test('covered_by: the head moved since merge read the PR, so the gate runs', () => {
      C.setGate();
      C.gh([green, { rollup: green, head: 'f'.repeat(40) }]);
      runs(/the head moved to f{12}/);
    });
    await t.test('covered_by: the PR can\'t be read again, so the gate runs', () => {
      C.setGate();
      C.gh([green, 'fail']);
      runs(/could not read the PR's checks again/);
    });
    await t.test('covered_by on a forge "git" repo: no checks to read, the gate runs', () => {
      C.setGate(undefined, { forge: 'git' });
      C.gh([green]);
      runs(/forge is git: no checks to read/);
      assert.equal(C.views().length, 0, 'gh is never asked');
    });
    await t.test('covered_by absent: merge runs the gate though every check is green', () => {
      C.setGate({ cmd: C.cmd });
      C.gh([green]);
      const r = C.merge(['--dry-run']);
      assert.equal(r.status, 0, r.text);
      assert.equal(C.ran(), true);
      assert.equal(C.views().length, 1, 'no re-read when no gate declares covered_by');
    });
    await t.test('covered_by of a shape it doesn\'t know runs the gate and warns', () => {
      for (const [by, extra] of [['yes', {}], [[], {}], ['yes', { forge: 'git' }]]) {
        C.setGate({ cmd: C.cmd, covered_by: by }, extra);
        C.gh([green]);
        const r = C.merge(['--dry-run']);
        assert.equal(r.status, 0, r.text);
        assert.equal(C.ran(), true, r.text);
        assert.match(r.text, /covered_by is not "ci" or a list of check names/);
      }
    });
    await t.test('covered_by with paths that don\'t match: not applicable, never covered', () => {
      C.setGate({ cmd: C.cmd, paths: ['web/**'], covered_by: 'ci' });
      C.gh([green]);
      const r = C.merge(['--dry-run']);
      assert.match(r.text, /gates not applicable to this PR: test/);
      assert.doesNotMatch(r.text, /not run here|runs here/);
      assert.equal(C.views().length, 1);
    });
    await t.test('covered_by on a --dry-run with no PR yet: nothing to read, the gate runs', () => {
      C.setGate();
      C.gh(['fail']);
      const body = path.join(C.F.base, 'no-pr-body.md');
      write(body, '## One-way doors\n\nNone.\n');
      runs(/gate test runs here: no PR to read/, ['--dry-run', '--title', 'console-01-a: work', '--body-file', body]);
      assert.equal(C.views().length, 1, 'gh is asked once, for the PR that is not there');
    });
    await t.test('covered_by with --no-gates: no re-read of the PR', () => {
      C.setGate();
      C.gh([green]);
      const r = C.merge(['--dry-run', '--no-gates']);
      assert.equal(r.status, 0, r.text);
      assert.equal(C.ran(), false);
      assert.equal(C.views().length, 1);
    });
    await t.test('covered_by: the first read still refuses a failing or pending check, as today', () => {
      C.setGate();
      C.gh([[covFailed('test')]]);
      let r = C.merge(['--dry-run']);
      assert.notEqual(r.status, 0);
      assert.match(r.text, /the forge's checks failed at \w{12}: test \(failure\)/);
      assert.equal(C.views().length, 1); assert.equal(C.ran(), false);
      C.gh([[covPending('test')]]);
      r = C.merge(['--dry-run']);
      assert.notEqual(r.status, 0);
      assert.match(r.text, /still running at \w{12}: test; wait for them/);
      assert.equal(C.views().length, 1); assert.equal(C.ran(), false);
    });
  } finally { C.F.done(); }
});

// covered_by is the owner's: a change to a gate is gate-change, and a gate the supervisor adds alone can't carry it
function covChore(F, slug, gates) {
  const { old, g } = F;
  const w = path.join(old, '.worktrees', `chore-${slug}`);
  g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
  const f = path.join(w, 'docs/devteam/project/settings.md');
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  const j = JSON.parse(m[1]);
  j.gates = gates;
  fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
  g(['commit', '-qam', slug], w);
  g(['push', '-q', 'origin', `chore-${slug}`], w);
  g(['worktree', 'remove', '--force', w], old);
  write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
}
function covMainGates(F, gates) {
  const { old, g } = F;
  const f = path.join(old, 'docs/devteam/project/settings.md');
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  const j = JSON.parse(m[1]);
  j.gates = gates;
  fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
  g(['commit', '-qam', 'gates'], old);
  g(['push', '-q', 'origin', 'main'], old);
}

test('covered_by on an existing gate is the owner\'s gate-change', () => {
  const F = fleetFixture('cov-owner');
  const { old, ok, run } = F;
  try {
    // main's gate in object form, so only covered_by differs
    covMainGates(F, { test: { cmd: 'true' } });
    covChore(F, 'cover', { test: { cmd: 'true', covered_by: 'ci' } });
    // and the same edit riding along with a gate the supervisor may add alone
    covChore(F, 'ride', { test: { cmd: 'true', covered_by: 'ci' }, lint: 'true' });
    const merge = (slug, ...extra) => { const r = run(old, ['merge', '--chore', slug, '--dry-run', ...extra], COV_SUP); return { status: r.status, text: `${r.out}\n${r.err}` }; };
    for (const slug of ['cover', 'ride']) {
      const none = merge(slug);
      assert.notEqual(none.status, 0, none.text);
      assert.match(none.text, /changes owner settings: gates \(gate-change\) \(gates: it changes test; only adding a gate is the supervisor's\)/, slug);
    }
    const q = ok(old, ['ask', '--question', 'Let merge trust CI for the test gate?', '--recommendation', 'yes', '--class', 'gate-change', '--reasons', 'owner-only'], COV_SUP);
    ok(old, ['answer', q, 'yes']);
    const r = merge('cover', '--approved', q);
    assert.equal(r.status, 0, r.text);
  } finally { F.done(); }
});

test('covered_by on a new gate is not the supervisor\'s to add', () => {
  const F = fleetFixture('cov-add');
  const { old, run } = F;
  try {
    covMainGates(F, { test: 'true' });
    covChore(F, 'lint', { test: 'true', lint: { cmd: 'true', covered_by: 'ci' } });
    const r = run(old, ['merge', '--chore', 'lint', '--dry-run'], COV_SUP);
    assert.notEqual(r.status, 0);
    assert.match(`${r.out}\n${r.err}`, /it sets covered_by; a new gate the owner hasn't approved has only cmd, paths, junit, mode/);
  } finally { F.done(); }
});
