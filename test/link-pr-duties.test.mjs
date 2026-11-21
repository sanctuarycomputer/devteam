// A repo link the supervisor maintains: open PRs that wait unreviewed, CHANGES reviews nobody
// answered, and merges waiting on a release are metrics findings (pr-unreviewed,
// pr-changes-unanswered, release-due). gh is a stub; without it nothing about PRs is raised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { write, json, multiFixture } from './lib/kit.mjs';

const H = 3600000;
const iso = (agoH) => new Date(Date.now() - agoH * H).toISOString();
const sha = (c) => c.repeat(40);

test('link PR duties: unreviewed and unanswered PRs, and a release that is due', () => {
  const F = multiFixture('link-prs');
  const { old, g, okIn } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    // console is a GitHub repo (insteadOf sends fetches to the local bare repo) with its own release: "tag"
    g(['remote', 'set-url', 'origin', 'https://github.com/usbclub/console.git'], F.console);
    g(['config', `url.${F.consoleOrigin}.insteadOf`, 'https://github.com/usbclub/console.git'], F.console);
    const links = json(okIn(old, ['settings'])).links;
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, remote: 'usbclub/console', forge: 'github', release: 'tag', maintain: { prs: true, releases: true, reviews: 'kit' } } } });

    const pr = (number, head, o = {}) => ({ number, title: `pr ${number}`, url: `https://github.com/usbclub/console/pull/${number}`, headRefName: `feature-${number}`, headRefOid: head, isDraft: false, createdAt: iso(72), updatedAt: iso(o.pushedH ?? 72), reviews: [], comments: [], ...o });
    const prs = [
      pr(11, sha('a')), // never reviewed: pr-unreviewed
      pr(12, sha('b')), // CHANGES at its head two days ago, nothing posted: pr-changes-unanswered
      pr(13, sha('c'), { comments: [{ author: { login: 'someone' }, createdAt: iso(1) }] }), // CHANGES, then the findings were commented
      pr(14, sha('d'), { pushedH: 0.1 }), // a fresh head, pushed 6 min ago
      pr(27, sha('b').slice(0, 39) + 'c', { pushedH: 0.5 }), // pushed 30 min ago, unreviewed: past the 15 min
      // either side of the 15 min, with room for the test's own run time: 13 min quiet, 17 min fires
      pr(28, sha('c').slice(0, 39) + 'd', { pushedH: 13 / 60 }),
      pr(29, sha('d').slice(0, 39) + 'e', { pushedH: 17 / 60 }),
      pr(15, sha('e'), { headRefName: 'ticket/console-01-a' }), // the fleet's own
      pr(16, sha('f'), { isDraft: true }),
      pr(17, sha('1'), { reviews: [{ author: { login: 'someone' }, state: 'COMMENTED', submittedAt: iso(48), commit: { oid: sha('1') } }] }), // reviewed on the forge
      pr(18, sha('2')), // approved in a record
      pr(19, sha('3')), // CHANGES at an older head: the new head is unreviewed
      pr(20, sha('4'), { reviews: [{ author: { login: 'copilot-pull-request-reviewer' }, state: 'COMMENTED', submittedAt: iso(48), commit: { oid: sha('4') } }] }), // only a bot looked: unreviewed
      pr(21, sha('5'), { comments: [{ author: { login: 'github-actions' }, createdAt: iso(1) }] }), // CHANGES, then only a bot commented: unanswered
      pr(22, sha('6')), // approved only in a record named for another link: unreviewed
      pr(23, sha('7')), // approved in a bare pr-<n> record (one GitHub link)
      pr(24, sha('8'), { headRefName: 'chore-fix-typo', isCrossRepository: true }), // a fork's branch that only looks like the fleet's: watched
      pr(25, sha('0'), { comments: Array.from({ length: 100 }, () => ({ author: { login: 'someone' }, createdAt: iso(60) })) }), // CHANGES, but 100 comments: the newest may be past gh's page
      pr(26, sha('a').slice(0, 39) + 'b'), // approved in a record under maintain.reviews' prefix
    ];
    const bin = path.join(F.base, 'fakegh');
    const logf = path.join(F.base, 'gh-args.log');
    const data = path.join(F.base, 'prs.json');
    fs.writeFileSync(data, JSON.stringify(prs));
    write(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${logf}"\ncase "$1 $2" in "pr list") cat "${data}" ;; *) exit 1 ;; esac\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const withGh = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };

    const reviews = path.join(old, 'docs/devteam/run/reviews');
    const record = (rel, verdict, head, agoH) => {
      const f = path.join(reviews, rel);
      write(f, `# Review\n\n- Reviewer: a fresh session\n\nVerdict: ${verdict} ${head}\n`);
      const t = new Date(Date.now() - agoH * H);
      fs.utimesSync(f, t, t);
    };
    record('console-pr-12/final-1.md', 'CHANGES', sha('b'), 48);
    record('console-pr-13/final-1.md', 'CHANGES', sha('c'), 48);
    record('console-pr-18.md', 'APPROVE', sha('2'), 30);
    record('console-pr-19/final-1.md', 'CHANGES', sha('9'), 48);
    record('console-pr-21/final-1.md', 'CHANGES', sha('5'), 48);
    record('companion-pr-22.md', 'APPROVE', sha('6'), 30);
    record('pr-23.md', 'APPROVE', sha('7'), 30);
    record('console-pr-25/final-1.md', 'CHANGES', sha('0'), 48);
    record('kit-pr-26/final-1.md', 'APPROVE', sha('a').slice(0, 39) + 'b', 30);

    // release-due: v1 tags console's main, then a merge waits a day
    g(['tag', 'v1'], F.console);
    write(path.join(F.console, 'src/y.js'), 'y\n');
    g(['add', '-A'], F.console);
    const day = `${Math.floor((Date.now() - 26 * H) / 1000)} +0000`;
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a merge'], { cwd: F.console, env: { ...process.env, GIT_COMMITTER_DATE: day, GIT_AUTHOR_DATE: day } });
    g(['push', '-q', 'origin', 'trunk', 'v1'], F.console);
    // companion releases from a tag too (the default) and has a merge waiting, but its owner set no
    // maintain: no release duty, no finding
    g(['tag', 'v1'], F.companion);
    write(path.join(F.companion, 'app/z.js'), 'z\n');
    g(['add', '-A'], F.companion);
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a merge'], { cwd: F.companion, env: { ...process.env, GIT_COMMITTER_DATE: day, GIT_AUTHOR_DATE: day } });
    g(['push', '-q', 'origin', 'main', 'v1'], F.companion);

    assert.match(okIn(old, ['observe-metrics'], SUP, withGh), /recorded/);
    const calls = fs.readFileSync(logf, 'utf8').trim().split('\n');
    assert.ok(!/\bcommits\b/.test(calls.find((c) => c.startsWith('pr list'))), `no commits field: GitHub refuses its node count (${calls[0]})`);
    assert.deepEqual(calls.filter((c) => c.startsWith('pr list')).map((c) => / -R (\S+)/.exec(c)?.[1]), ['usbclub/console'], `only the GitHub link is asked: ${calls.join(' | ')}`);
    const findings = json(okIn(old, ['metrics', '--json'])).findings;
    const of = (kind) => findings.filter((x) => x.kind === kind).map((x) => x.subject).sort();
    assert.ok(calls.find((c) => c.startsWith('pr list')).includes('isCrossRepository'), 'asks whether a head is a fork\'s');
    assert.deepEqual(of('pr-unreviewed'), ['console#11', 'console#19', 'console#20', 'console#22', 'console#24', 'console#27', 'console#29']);
    assert.deepEqual(of('pr-changes-unanswered'), ['console#12', 'console#21']);
    const ch = findings.find((x) => x.kind === 'pr-changes-unanswered' && x.subject === 'console#12');
    assert.match(ch.detail, /console-pr-12\/final-1\.md/);
    assert.match(ch.suggestion, /comment the findings to its author/);
    const rel = findings.find((x) => x.kind === 'release-due');
    assert.equal(rel?.subject, 'console', 'release-due on console');
    assert.match(rel.detail, /1 commit\(s\) on console's main since v1/);
    assert.ok(!findings.some((x) => x.kind === 'release-due' && x.subject === 'companion'), 'companion declares no release duty');
    assert.ok(json(okIn(old, ['log', '--type', 'observation', '--json'])).some((o) => o.kind === 'pr-unreviewed' && o.subject === 'console#11'), 'observed');

    // a fresh read is reused: the next tick doesn't ask gh again
    const asked = () => fs.readFileSync(logf, 'utf8').trim().split('\n').filter((c) => c.startsWith('pr list')).length;
    okIn(old, ['observe-metrics'], SUP, withGh);
    assert.equal(asked(), 1, 'a read under 10 min old is reused');
    const prsFile0 = path.join(old, 'docs/devteam/run/link-prs.json');
    const setAt = (h) => { const j = JSON.parse(fs.readFileSync(prsFile0, 'utf8')); j.console.at = iso(h); fs.writeFileSync(prsFile0, JSON.stringify(j)); };
    setAt(8 / 60);
    okIn(old, ['observe-metrics'], SUP, withGh);
    assert.equal(asked(), 1, 'an 8 min old read is still reused');
    setAt(12 / 60);
    okIn(old, ['observe-metrics'], SUP, withGh);
    assert.equal(asked(), 2, 'a 12 min old read is read again (the reuse is 10 min)');
    const prsFile = path.join(old, 'docs/devteam/run/link-prs.json');
    const backdate = (k, h) => { const j = JSON.parse(fs.readFileSync(prsFile, 'utf8')); if (h === null) delete j.console[k]; else j.console[k] = iso(h); fs.writeFileSync(prsFile, JSON.stringify(j)); };

    // gh fails right after a good read (35 min old, so it is asked again): the PR findings go
    // quietly though the last read is fresh; the tick carries on
    backdate('at', 35 / 60);
    write(path.join(bin, 'gh'), '#!/bin/sh\necho "HTTP 401: Bad credentials" >&2\nexit 1\n');
    assert.match(okIn(old, ['observe-metrics'], SUP, withGh), /recorded/);
    assert.ok(JSON.parse(fs.readFileSync(prsFile, 'utf8')).console.failing_since, 'the failed read is recorded');
    const after = json(okIn(old, ['metrics', '--json'])).findings;
    assert.ok(!after.some((x) => x.kind.startsWith('pr-')), 'no PR findings without a good read');
    assert.ok(!after.some((x) => x.kind === 'link-prs-unread'), 'one failed read is not yet a finding');
    assert.ok(after.some((x) => x.kind === 'release-due'), 'release-due reads local git, not gh');
    // reads failing for hours: a low note with gh's first line
    backdate('failing_since', 7);
    const unread = json(okIn(old, ['metrics', '--json'])).findings.find((x) => x.kind === 'link-prs-unread');
    assert.equal(unread?.subject, 'console');
    assert.equal(unread.severity, 'low');
    assert.match(unread.detail, /HTTP 401: Bad credentials/);
    // an old read (a tick's budget cut the next ones) raises nothing from what it last saw
    backdate('failing_since', null);
    backdate('at', 20 / 60);
    assert.ok(json(okIn(old, ['metrics', '--json'])).findings.some((x) => x.kind === 'pr-unreviewed'), 'a 20 min old read still counts');
    backdate('at', 40 / 60);
    assert.ok(!json(okIn(old, ['metrics', '--json'])).findings.some((x) => x.kind.startsWith('pr-')), 'no PR findings from a read over 30 min old');

    // a release cut elsewhere (the tag only on origin) clears release-due: the tick fetches v* tags
    g(['tag', 'v2', 'trunk'], F.consoleOrigin);
    okIn(old, ['observe-metrics'], SUP, withGh);
    assert.ok(!json(okIn(old, ['metrics', '--json'])).findings.some((x) => x.kind === 'release-due'));
  } finally { F.done(); }
});

test('maintain is set through link set and link add, as an object, by a governance-edit', () => {
  const F = multiFixture('link-maintain');
  const { old, okIn, runIn } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const QID = /q-[0-9]+-[0-9]+-supervisor/;
  const block = () => JSON.parse(/```json devteam\s*\n([\s\S]*?)\n```/.exec(fs.readFileSync(F.settingsFile, 'utf8'))[1]);
  try {
    const out = okIn(old, ['link', 'set', 'console', 'maintain', '{"prs":true}'], SUP);
    const qid = QID.exec(out)?.[0];
    assert.ok(qid, `drafts a question: ${out}`);
    const q = json(okIn(old, ['questions', '--id', qid, '--json']))[0];
    assert.equal(q.class, 'governance-edit');
    assert.ok(q.context.includes('links.console.maintain: main has null; would be {"prs":true}'), q.context);
    okIn(old, ['answer', qid, 'yes']);
    okIn(old, ['link', 'set', 'console', 'maintain', '{"prs":true}', '--approved', qid], SUP);
    assert.deepEqual(block().links.console.maintain, { prs: true });
    const bad = runIn(old, ['link', 'set', 'console', 'maintain', '{"prs":"yes"}'], SUP);
    assert.equal(bad.status, 1, bad.out);
    assert.match(bad.err, /maintain is \{ "prs": true\|false/);
    const add = okIn(old, ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs', '--maintain', '{"releases":true,"reviews":"docs-site"}'], SUP);
    const q2 = json(okIn(old, ['questions', '--id', QID.exec(add)?.[0], '--json']))[0];
    assert.ok(q2.context.includes('"maintain":{"releases":true,"reviews":"docs-site"}'), q2.context);
  } finally { F.done(); }
});
