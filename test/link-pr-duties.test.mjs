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
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, remote: 'usbclub/console', forge: 'github', release: 'tag' } } });

    const pr = (number, head, o = {}) => ({ number, title: `pr ${number}`, url: `https://github.com/usbclub/console/pull/${number}`, headRefName: `feature-${number}`, headRefOid: head, isDraft: false, createdAt: iso(72), commits: [{ oid: head, committedDate: iso(o.pushedH ?? 72) }], reviews: [], comments: [], ...o });
    const prs = [
      pr(11, sha('a')), // never reviewed: pr-unreviewed
      pr(12, sha('b')), // CHANGES at its head two days ago, nothing posted: pr-changes-unanswered
      pr(13, sha('c'), { comments: [{ createdAt: iso(1) }] }), // CHANGES, then the findings were commented
      pr(14, sha('d'), { pushedH: 2 }), // a fresh head
      pr(15, sha('e'), { headRefName: 'ticket/console-01-a' }), // the fleet's own
      pr(16, sha('f'), { isDraft: true }),
      pr(17, sha('1'), { reviews: [{ state: 'COMMENTED', submittedAt: iso(48), commit: { oid: sha('1') } }] }), // reviewed on the forge
      pr(18, sha('2')), // approved in a record
      pr(19, sha('3')), // CHANGES at an older head: the new head is unreviewed
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

    // release-due: v1 tags console's main, then a merge waits a day
    g(['tag', 'v1'], F.console);
    write(path.join(F.console, 'src/y.js'), 'y\n');
    g(['add', '-A'], F.console);
    const day = `${Math.floor((Date.now() - 26 * H) / 1000)} +0000`;
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a merge'], { cwd: F.console, env: { ...process.env, GIT_COMMITTER_DATE: day, GIT_AUTHOR_DATE: day } });
    g(['push', '-q', 'origin', 'trunk', 'v1'], F.console);

    assert.match(okIn(old, ['observe-metrics'], SUP, withGh), /recorded/);
    const calls = fs.readFileSync(logf, 'utf8').trim().split('\n');
    assert.deepEqual(calls.filter((c) => c.startsWith('pr list')).map((c) => / -R (\S+)/.exec(c)?.[1]), ['usbclub/console'], `only the GitHub link is asked: ${calls.join(' | ')}`);
    const findings = json(okIn(old, ['metrics', '--json'])).findings;
    const of = (kind) => findings.filter((x) => x.kind === kind).map((x) => x.subject).sort();
    assert.deepEqual(of('pr-unreviewed'), ['console#11', 'console#19']);
    assert.deepEqual(of('pr-changes-unanswered'), ['console#12']);
    const ch = findings.find((x) => x.kind === 'pr-changes-unanswered');
    assert.match(ch.detail, /console-pr-12\/final-1\.md/);
    assert.match(ch.suggestion, /fix the PR/);
    assert.match(ch.suggestion, /comment the findings to its author/);
    const rel = findings.find((x) => x.kind === 'release-due');
    assert.equal(rel?.subject, 'console', 'release-due on console');
    assert.match(rel.detail, /1 commit\(s\) on console's main since v1/);
    assert.ok(!findings.some((x) => x.kind === 'release-due' && x.subject === 'companion'), 'companion declares no release duty');
    assert.ok(json(okIn(old, ['log', '--type', 'observation', '--json'])).some((o) => o.kind === 'pr-unreviewed' && o.subject === 'console#11'), 'observed');

    // gh fails (missing, logged out, offline): the PR findings go quietly; the tick carries on
    write(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n');
    assert.match(okIn(old, ['observe-metrics'], SUP, withGh), /recorded/);
    const after = json(okIn(old, ['metrics', '--json'])).findings;
    assert.ok(!after.some((x) => x.kind.startsWith('pr-')), 'no PR findings without a read');
    assert.ok(after.some((x) => x.kind === 'release-due'), 'release-due reads local git, not gh');

    // a release clears release-due
    g(['tag', 'v2'], F.console);
    g(['push', '-q', 'origin', 'v2'], F.console);
    okIn(old, ['observe-metrics'], SUP, withGh);
    assert.ok(!json(okIn(old, ['metrics', '--json'])).findings.some((x) => x.kind === 'release-due'));
  } finally { F.done(); }
});
