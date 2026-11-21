// machine status: the check-in digest, the machine's caps, and what the operator may run (reads only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hasTmux, write } from './lib/kit.mjs';
import { baseEnv, dtIn, home, machine, repo, shown, statusFixture, tmp, tmuxSh } from './lib/machine-fixture.mjs';

test('alert reaches the hub, by hello, and clears', () => {
  const r = repo('alerted');
  const alert = path.join(home, '.box/alert');
  const raise = (...w) => machine(['machine', 'alert', '--', ...w]);
  fs.rmSync(alert, { force: true });
  const hello = () => JSON.parse(dtIn(r, ['hello', '--json']).stdout);
  assert.equal(hello().box_alert, undefined);
  assert.match(raise('disk\nnearly full').stdout, /alert raised: disk nearly full/);
  // the box's alert is the machine's: box_alert, which a hub and gateway on this kit show once; alert
  // still ends with it, so an older hub or gateway (which reads only alert) still shows and pushes it
  assert.equal(hello().box_alert, 'disk nearly full');
  assert.equal(hello().alert, 'disk nearly full', 'folded in for older readers');
  fs.utimesSync(alert, new Date(Date.now() - 25 * 3600000), new Date(Date.now() - 25 * 3600000));
  assert.equal(hello().box_alert, undefined, 'a day old, it has been seen or forgotten');
  raise(`${'x'.repeat(199)}é and more`);
  assert.equal(fs.readFileSync(alert, 'utf8'), `${'x'.repeat(199)}\n`, 'cut at 200 bytes, never half a character');
  raise(`${'x'.repeat(198)}€ and more`);
  assert.equal(fs.readFileSync(alert, 'utf8'), `${'x'.repeat(198)}\n`, 'nor a third of one');
  raise(`${'x'.repeat(198)}é and more`);
  assert.equal(fs.readFileSync(alert, 'utf8'), `${'x'.repeat(198)}é\n`, 'a whole character that fits stays');
  raise('short é');
  assert.equal(fs.readFileSync(alert, 'utf8'), 'short é\n', 'and a line under the limit is left alone');
  const fromWorker = machine(['machine', 'alert', '--', 'not mine'], { DEVTEAM_ROLE: 'worker' });
  assert.notEqual(fromWorker.status, 0);
  assert.equal(fs.readFileSync(alert, 'utf8'), 'short é\n', 'the operator\'s, never a worker\'s');
  assert.match(raise('--clear').stdout, /alert cleared/);
  assert.ok(!fs.existsSync(alert));
  assert.equal(raise().status, 2);
});

test('status says at a glance what a check-in needs, and reads no pane it needn\'t', { skip: !hasTmux }, async () => {
  const S = await statusFixture();
  const { a, kitL, last, logged, portUp, rule, shell, status, x, y } = S;
  try {
    const st = status([], { DEVTEAM_STATUS_SECONDS: '0' });
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /^machine: disk \S+ free of \S+.*; memory .*; cpus \S+.*; load [\d.]+ [\d.]+ [\d.]+$/m);
    assert.match(st.stdout, /^machine: accounts cswap active=a@b exhausted=false no-room=false needs-login=c@d as of /m);
    assert.match(st.stdout, /^machine: capacity 1 of 5 accounts with room THIN; active 9% week, 31% 5h; room runs out after the next reset; next reset 2026-11-16 21:00$/m);
    // the capacity line, as accounts-tick last wrote it: usage that can't be read is unknown, never NONE
    assert.match(st.stdout, new RegExp(`^machine: hub ${process.env.DEVTEAM_HUB_PORT} DOWN$`, 'm'));
    assert.match(st.stdout, new RegExp(`^statused sup=up fleet=run kit=v0\\.1\\.0\\S* inbox=\\d+ missing=config/master\\.key tools=ok behind=v9\\.9\\.9 pane=${a.pane} state=ready dash=${portUp}/up wt=1/\\S+ new-questions=1 new-knowledge=2$`, 'm'));
    assert.match(st.stdout, /^machine: daily review due \(last never\)$/m);
    const kn = status(['--knowledge']);
    assert.equal(kn.status, 0, kn.stderr);
    assert.match(kn.stdout, new RegExp(`^statused ${rule} \\[preference, project, owner's\\] Ship banners without asking$`, 'm'));
    assert.match(kn.stdout, new RegExp(`^statused ${kitL} \\[lesson, project, kit lesson\\] Fetch before the merge$`, 'm'));
    assert.doesNotMatch(kn.stdout, /Seen already|Still a candidate/, 'noted, or not accepted: not listed');
    assert.match(st.stdout, /^a-sib sup=down .* sibling-of=the-home$/m);
    assert.match(st.stdout, new RegExp(`^attention: ${y.pane} keep:worker-y limit$`, 'm'));
    assert.doesNotMatch(st.stdout, new RegExp(`${shell.pane}\\b`), 'never the owner\'s shell');
    assert.doesNotMatch(fs.readFileSync(logged, 'utf8'), new RegExp(`capture-pane .*-t ${shell.pane}$`, 'm'), 'not even read');
    assert.match(st.stdout, new RegExp(`^changed since last reading: .*${a.pane}.*${x.pane}.*${y.pane}`, 'm'), 'no reading before: everything changed');
    const q = status(['--questions']);
    assert.match(q.stdout, /^statused q-\S+ \[owner-decision\] second\?$/m);
    assert.doesNotMatch(q.stdout, /first\?/, 'noted, so not read again');
    assert.match(fs.readFileSync(last, 'utf8'), /^at \d+\ndisk \d+\npane %\d+ \w+\n/, 'the reading it keeps');
    // only what moved: one pane's screen changes
    tmuxSh(['send-keys', '-t', x.pane, 'Enter']);
    await shown(x.pane, 'other output now');
    assert.match(status([], { DEVTEAM_STATUS_SECONDS: '0' }).stdout, new RegExp(`^changed since last reading: ${x.pane}$`, 'm'));
    assert.match(status([], { DEVTEAM_STATUS_SECONDS: '0' }).stdout, /^changed since last reading: $/m, 'nothing moved since: nothing changed');
    assert.doesNotMatch(st.stdout, /supervisor idle/, 'no record of its loop (a kit before it): nothing said');
    S.readNothing();
  } finally {
    S.done();
  }
});

test('status says the machine\'s own CPU and memory caps, not the host\'s', () => {
  // a 2-CPU, 8 GiB container: 6 GiB charged, 2 GiB of it page cache the kernel can drop
  const cg = fs.mkdtempSync(path.join(tmp, 'cgroup-'));
  const G = 1024 ** 3;
  fs.writeFileSync(path.join(cg, 'cpu.max'), '200000 100000\n');
  fs.writeFileSync(path.join(cg, 'cpu.pressure'), 'some avg10=20.00 avg60=15.00 avg300=10.00 total=1\nfull avg10=14.00 avg60=12.60 avg300=9.00 total=1\n');
  fs.writeFileSync(path.join(cg, 'memory.max'), `${8 * G}\n`);
  fs.writeFileSync(path.join(cg, 'memory.current'), `${6 * G}\n`);
  fs.writeFileSync(path.join(cg, 'memory.stat'), `anon ${3 * G}\nfile ${2 * G}\ninactive_file ${G}\n`);
  const r = machine(['machine', 'status'], { DEVTEAM_CGROUP: cg });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^machine: disk .*; memory 4\.0 GB in use of 8\.0 GB; cpus 2 \(all waiting 13% of the last minute\); load /m);
  // a platform that stops the box by memory.current, cache and all (the box image says so): the
  // working set, all but the inactive cache, the number the memory ceiling reads, and the split
  const counts = { DEVTEAM_CGROUP: cg, DEVTEAM_MEMORY_COUNTS_CACHE: '1' };
  assert.match(machine(['machine', 'status'], counts).stdout, /^machine: disk .*; memory 5\.0 GB in use of 8\.0 GB \(1\.0 GB of it page cache, and 1\.0 GB of inactive cache left out\); cpus 2 /m);
  // no caps (a laptop, or a cgroup that says max): the machine's own numbers
  fs.writeFileSync(path.join(cg, 'cpu.max'), 'max 100000\n');
  fs.writeFileSync(path.join(cg, 'memory.max'), 'max\n');
  assert.match(machine(['machine', 'status'], { DEVTEAM_CGROUP: cg }).stdout, /^machine: disk .*; memory [\d.]+ GB free of [\d.]+ GB; cpus \d+[ ;].*load /m);
  // the host's own: MemAvailable of MemTotal (what the kit's memory ceiling reads too)
  const meminfo = path.join(cg, 'meminfo');
  fs.writeFileSync(meminfo, 'MemTotal:       8388608 kB\nMemFree:          524288 kB\nMemAvailable:    3145728 kB\n');
  assert.match(machine(['machine', 'status'], { DEVTEAM_CGROUP: cg, DEVTEAM_MEMINFO: meminfo }).stdout, /^machine: disk .*; memory 3\.0 GB free of 8\.0 GB; cpus /m);
  // with no cap the setting changes nothing: MemAvailable already counts what the kernel can drop
  assert.match(machine(['machine', 'status'], { ...counts, DEVTEAM_MEMINFO: meminfo }).stdout, /^machine: disk .*; memory 3\.0 GB free of 8\.0 GB; cpus /m);
});

test('status lists the operator\'s own open kit PRs, and which need it now', () => {
  const notes = path.join(home, 'operator/NOTES.md');
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  if (!fs.existsSync(notes)) fs.writeFileSync(notes, '');
  const stub = fs.mkdtempSync(path.join(tmp, 'gh-prs-'));
  const prs = path.join(stub, 'prs.json');
  const asked = path.join(stub, 'asked');
  write(path.join(stub, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(asked)}\n[ "$1 $2" = "pr list" ] || exit 0\n[ -f ${JSON.stringify(prs)} ] || exit 1\ncat ${JSON.stringify(prs)}\n`);
  fs.chmodSync(path.join(stub, 'gh'), 0o755);
  const status = (args = ['--notes', notes]) => machine(['machine', 'status', '--in', path.join(tmp, 'no-repos'), ...args], { PATH: `${stub}${path.delimiter}${baseEnv.PATH}` });
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const head = 'a'.repeat(40);
  const old = 'b'.repeat(40);
  const verdict = (v, sha, h) => ({ body: `# Review\n\n| Id | Finding |\n\nVerdict: ${v} ${sha}\n`, createdAt: ago(h) });
  const mark = 'Fixes the thing.\n\nOpened by the box operator.\n';
  const pr = (number, headRefName, more = {}) => ({ number, headRefName, body: mark, isDraft: false, headRefOid: head, createdAt: ago(30), latestReviews: [], comments: [], statusCheckRollup: [{ __typename: 'CheckRun', name: 'kit', status: 'COMPLETED', conclusion: 'SUCCESS' }], ...more });
  fs.writeFileSync(prs, JSON.stringify([
    pr(405, 'link-pr-stall-findings', { comments: [verdict('CHANGES', old, 20), { body: 'fixed', createdAt: ago(10) }, verdict('CHANGES', head, 2)] }),
    pr(356, 'operator-idle-fleets', { comments: [verdict('APPROVE', head, 3)], statusCheckRollup: [{ __typename: 'CheckRun', name: 'kit', status: 'COMPLETED', conclusion: 'FAILURE' }, { __typename: 'StatusContext', context: 'x', state: 'SUCCESS' }] }),
    pr(400, 'fixed-since', { comments: [verdict('CHANGES', old, 0.1)] }),
    pr(401, 'reviewed-on-github', { latestReviews: [{ state: 'CHANGES_REQUESTED', body: '', submittedAt: ago(1), commit: { oid: head } }] }),
    pr(402, 'approved-after', { comments: [verdict('CHANGES', head, 4)], latestReviews: [{ state: 'APPROVED', body: '', submittedAt: ago(1), commit: { oid: head } }] }),
    pr(403, 'brand-new', { createdAt: ago(0.1) }),
    pr(404, 'waiting-long'),
    pr(406, 'pending-only', { latestReviews: [{ state: 'PENDING', body: '', submittedAt: null }], statusCheckRollup: [{ __typename: 'StatusContext', context: 'ci', state: 'ERROR' }] }),
    pr(407, 'ticket/kit-1-x'), pr(408, 'plan/g-1'), pr(409, 'chore-devteam-sync-v1.0.0'), pr(415, 'release-prep-v1.0.0'),
    // a note after the sha is still the verdict
    pr(410, 'trailing-note', { comments: [{ body: `Verdict: CHANGES ${head} (F1, F2)`, createdAt: ago(2) }] }),
    // a fix pushed after CHANGES and said so, then a day with no one looking at the new head
    pr(411, 're-review-wait', { createdAt: ago(60), comments: [verdict('CHANGES', old, 40), { body: 'fixed F1 at the new head', createdAt: ago(26) }] }),
    // a verdict in a GitHub review's body, which GitHub only calls a comment
    pr(412, 'review-body-verdict', { latestReviews: [{ state: 'COMMENTED', body: `Verdict: CHANGES ${head}`, submittedAt: ago(1), commit: { oid: head } }] }),
    // checks still running, or cancelled by a newer run: not red
    pr(413, 'checks-running', { createdAt: ago(0.1), statusCheckRollup: [{ __typename: 'CheckRun', name: 'kit', status: 'IN_PROGRESS', conclusion: '' }, { __typename: 'CheckRun', name: 'old', status: 'COMPLETED', conclusion: 'CANCELLED' }] }),
    // a review that only comments is no verdict
    pr(414, 'commented-only', { createdAt: ago(40), latestReviews: [{ state: 'COMMENTED', body: 'looks fine so far', submittedAt: ago(30), commit: { oid: head } }] }),
    // a verdict quoted in a reply is not one
    pr(416, 'quoted', { createdAt: ago(0.2), comments: [{ body: `> Verdict: CHANGES ${head}\n\nwill fix`, createdAt: ago(0.1) }] }),
    // the same gh login opened it, but not the operator (no line of its own saying so): not the operator's
    pr(417, 'owners-own', { body: 'by hand', statusCheckRollup: [{ __typename: 'CheckRun', name: 'kit', status: 'COMPLETED', conclusion: 'FAILURE' }] }),
    pr(418, 'mentions-it', { body: 'see `Opened by the box operator.` in operator.md' }),
    pr(419, 'no-body', { body: null }),
    // pushed 40 minutes ago and nobody has looked: past the 15 minutes, in minutes
    pr(421, 'forty-minutes', { createdAt: ago(40 / 60) }),
    // either side of the 15 minutes, with room for the test's own run time
    pr(422, 'thirteen-minutes', { createdAt: ago(13 / 60) }),
    pr(423, 'seventeen-minutes', { createdAt: ago(17 / 60) }),
    // a draft isn't up for review yet
    pr(420, 'a-draft', { isDraft: true }),
  ]));
  const st = status();
  assert.equal(st.status, 0, st.stderr);
  assert.match(st.stdout, /^machine: operator PRs: 17 open, 11 need you \(#405 changes requested, #356 CI red, #401 changes requested, #404 no review 30h, #406 CI red and no review 30h, #410 changes requested, #411 no review of its head 26h, #412 changes requested, #414 no review 30h, #421 no review 40min, #423 no review 17min\)$/m);
  // one gh call for it, on the kit's repo, by the gh login
  const calls = fs.readFileSync(asked, 'utf8').split('\n').filter((l) => l.startsWith('pr list'));
  assert.equal(calls.length, 1);
  assert.match(calls[0], /-R sanctuarycomputer\/devteam --author @me --state open --search "Opened by the box operator\." in:body .*--json \S*body\S*isDraft\S*statusCheckRollup/);
  fs.writeFileSync(prs, JSON.stringify([pr(400, 'fixed-since', { comments: [verdict('CHANGES', old, 0.1)] }), pr(407, 'ticket/kit-1-x')]));
  assert.match(status().stdout, /^machine: operator PRs: 1 open, none need you$/m);
  fs.writeFileSync(prs, '[]');
  assert.match(status().stdout, /^machine: operator PRs: none open$/m);
  // gh missing, offline or logged out: unknown, never "none"
  fs.rmSync(prs);
  assert.match(status().stdout, /^machine: operator PRs: \?$/m);
  fs.writeFileSync(prs, 'not json');
  assert.match(status().stdout, /^machine: operator PRs: \?$/m);
  // only the operator's digest (box-status passes --notes) asks
  fs.writeFileSync(asked, '');
  assert.doesNotMatch(status([]).stdout, /operator PRs/m);
  assert.doesNotMatch(fs.readFileSync(asked, 'utf8'), /^pr list/m);
});
