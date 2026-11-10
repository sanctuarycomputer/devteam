// Sibling PRs: check-pr --repo, merge in that repo, gh per repo, gates, depends_on, pushes to main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { kit, sessionOf, line, write, review, json, multiFixture } from './lib/kit.mjs';

test('check-pr --repo checks a sibling PR in that repo, from any checkout of it (--path)', () => {
  const F = multiFixture('check-pr-repo');
  const { old, g, runIn, ticket } = F;
  const bodyF = path.join(F.base, 'body.md');
  write(bodyF, '## One-way doors\n\nNone.\n');
  try {
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'scripts/new.sh'), 'x\n');
    write(path.join(w, 'docs/devteam/project/log/console-01-a.jsonl'), '');
    g(['add', '-A'], w); g(['commit', '-qm', 'console-01-a: x'], w); g(['push', '-q', 'origin', 'ticket/console-01-a'], w);
    const sha = g(['rev-parse', 'HEAD'], w);
    F.lines({ ...F.STD, console: { link: 'console', owns: ['src/**', 'package.json', '.gitignore'] }, companion: { link: 'companion' } });
    // from another checkout of the sibling (a CI run's, say), with home's kit
    const ci = path.join(F.base, 'ci-console');
    g(['clone', '-q', F.consoleOrigin, ci], F.base);
    g(['fetch', '-q', 'origin', 'ticket/console-01-a'], ci);
    const r = runIn(ci, ['check-pr', '--repo', 'console', '--path', ci, '--head-ref', 'ticket/console-01-a', '--sha', sha, '--title', 'console-01-a: x', '--body-file', bodyF], {}, { DEVTEAM_HOME: old });
    assert.notEqual(r.status, 0, r.err);
    assert.match(r.out, /components \(console\): unowned: scripts\/ \(1\): scripts\/new\.sh/);
    assert.match(r.out, /docs\/devteam\/project\/log\/console-01-a\.jsonl: .*holds only tickets\//, 'no log in another repo');
    assert.match(r.out, /spec\.md missing at this head/, 'records are read from console at the head');
    assert.match(runIn(ci, ['check-pr', '--repo', 'nope', '--head-ref', 'ticket/x', '--sha', sha], {}, { DEVTEAM_HOME: old }).err, /no repo link "nope"/);
    // a ticket of one repo checked as another's, and a plan PR outside home: refused
    assert.match(runIn(old, ['check-pr', '--repo', 'companion', '--head-ref', 'ticket/console-01-a', '--sha', 'origin/main']).out, /ticket\/console-01-a is a ticket of console, not companion/);
    assert.match(runIn(ci, ['check-pr', '--repo', 'console', '--path', ci, '--head-ref', 'plan/x', '--sha', sha], {}, { DEVTEAM_HOME: old }).out, /plan and chore PRs are always home's/);
    // console's main moved since this checkout fetched (a push from another clone): check-pr
    // fetches it first, so the landing it judges is onto that main
    write(path.join(F.console, 'scripts/new.sh'), 'main has its own\n');
    g(['add', '-A'], F.console); g(['commit', '-qm', 'main moved'], F.console); g(['push', '-q', 'origin', 'trunk'], F.console);
    assert.match(runIn(ci, ['check-pr', '--repo', 'console', '--path', ci, '--head-ref', 'ticket/console-01-a', '--sha', sha], {}, { DEVTEAM_HOME: old }).out, /does not merge cleanly onto origin\/trunk/);
    // the fetch of the sibling's main fails: refused, never judged against a stale one
    fs.renameSync(F.consoleOrigin, `${F.consoleOrigin}-away`);
    try {
      assert.match(runIn(ci, ['check-pr', '--repo', 'console', '--path', ci, '--head-ref', 'ticket/console-01-a', '--sha', sha], {}, { DEVTEAM_HOME: old }).err, /could not fetch origin trunk in console: .*refusing to judge against a stale main/);
    } finally { fs.renameSync(`${F.consoleOrigin}-away`, F.consoleOrigin); }
  } finally { F.done(); }
});

test('merge runs a sibling ticket\'s gates in its repo and lands it on that repo\'s main; a repo with no gates is refused', () => {
  const F = multiFixture('sibling-merge');
  const { old, g, okIn, runIn, ticket, real } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    // home's own gates are path-filtered; companion has none, and inherits none. Console's gate
    // records where it ran: outside home's tree, so nothing of home's is found by walking up.
    const cwdFile = path.join(F.base, 'gate-cwd');
    const links0 = json(okIn(old, ['settings'])).links;
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { gates: { web: { cmd: 'true', paths: ['web/**'] } }, links: { ...links0, console: { ...links0.console, gates: { test: `test -f src/main.js && pwd -P > '${cwdFile}'` } } } });
    const land = (id, repoDir, branch, files) => {
      ticket(id, { touches: Object.keys(files).map((f) => `${f.split('/')[0]}/**`) });
      const w = path.join(old, '.worktrees', id);
      g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, `origin/${branch}`], repoDir);
      const tdir = path.join(w, `docs/devteam/project/tickets/${id}`);
      write(path.join(tdir, 'spec.md'), '# spec\n');
      write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- x\n');
      write(path.join(tdir, 'verification.md'), '| Done-when | Command | Result |\n|---|---|---|\n| s | t | pass |\n');
      for (const [f, text] of Object.entries(files)) write(path.join(w, f), text);
      g(['add', '-A'], w); g(['commit', '-qm', `${id}: work`], w);
      write(path.join(tdir, 'reviews/final-1.md'), review('reviewer-b', g(['rev-parse', 'HEAD'], w)));
      g(['add', '-A'], w); g(['commit', '-qm', 'review'], w); g(['push', '-q', 'origin', `ticket/${id}`], w);
      okIn(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
      okIn(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
      write(path.join(old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
      return g(['rev-parse', 'HEAD'], w);
    };
    const sha = land('console-01-a', F.console, 'trunk', { 'src/main.js': 'changed\n' });
    // a push to console's main from another clone since console's checkout fetched: merge fetches it first
    const other = path.join(F.base, 'console-other');
    g(['clone', '-q', F.consoleOrigin, other], F.base);
    write(path.join(other, 'package.json'), '{"moved":true}\n');
    g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'elsewhere'], other); g(['push', '-q', 'origin', 'trunk'], other);
    const moved = g(['rev-parse', 'HEAD'], other);
    assert.match(okIn(old, ['merge', 'console-01-a'], SUP), /merged ticket\/console-01-a at \w{12} in console/);
    const ran = fs.readFileSync(cwdFile, 'utf8').trim();
    assert.ok(!ran.startsWith(`${real(old)}${path.sep}`), `console's gate ran outside home's tree (${ran})`);
    assert.ok(ran.startsWith(real(os.tmpdir())), `in the OS temp folder (${ran})`);
    assert.ok(!fs.existsSync(path.dirname(ran)), 'and its holder is gone after the merge');
    g(['fetch', '-q', 'origin'], F.console);
    assert.equal(g(['rev-parse', 'origin/trunk^2'], F.console), sha, "console's main merged the verified head");
    assert.equal(g(['rev-parse', 'origin/trunk^1'], F.console), moved, 'onto the main its origin has now');
    const gate = json(okIn(old, ['log', '--type', 'gate', '--json'])).find((x) => x.sha === sha);
    assert.deepEqual([gate.gate, gate.ok, gate.repo], ['test', true, 'console'], "console's gate, in home's log, naming its repo");
    assert.ok(!json(okIn(old, ['log', '--type', 'gate', '--json'])).some((x) => x.gate === 'web'), "home's gates never run for console");
    const act = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'merge-word' && a.refs.includes('console-01-a'));
    assert.equal(act.repo, 'console');
    assert.match(okIn(old, ['status']), /merged +console-01-a/, "status reads console's main");
    // a repo with no gates of its own is refused, never given home's
    land('companion-02-b', F.companion, 'main', { 'app/index.js': 'changed\n' });
    const r = runIn(old, ['merge', 'companion-02-b', '--dry-run'], SUP);
    assert.notEqual(r.status, 0);
    assert.match(r.out, /no gates in companion's settings \(links\.companion\.gates\); pass --no-gates/);
    // at merge too: a console-ui ticket that edits console-build's file is refused, by home's lines
    F.lines({ ...F.STD, 'console-ui': { link: 'console', owns: ['src/**'] }, 'console-build': { link: 'console', owns: ['package.json', '.gitignore'] }, companion: { link: 'companion' } }, { gates: { web: { cmd: 'true', paths: ['web/**'] } } });
    ticket('console-ui-03-c', { component: 'console-ui', touches: ['src/**', 'package.json'] });
    const uw = path.join(old, '.worktrees', 'console-ui-03-c');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-ui-03-c', uw, 'origin/trunk'], F.console);
    write(path.join(uw, 'package.json'), '{"name":"edited by the ui"}\n');
    g(['commit', '-qam', 'console-ui-03-c: x'], uw); g(['push', '-q', 'origin', 'ticket/console-ui-03-c'], uw);
    write(path.join(old, 'docs/devteam/run/pr/ticket/console-ui-03-c.md'), '# console-ui-03-c: x\n\n## One-way doors\n\nNone.\n');
    assert.match(runIn(old, ['merge', 'console-ui-03-c', '--dry-run'], SUP).out, /changes files outside the line of console-ui: package\.json/, 'merge refuses it too');
    // the fetch of a sibling's main fails: refused, never judged against a stale one
    fs.renameSync(F.consoleOrigin, `${F.consoleOrigin}-away`);
    try {
      assert.match(runIn(old, ['merge', 'console-ui-03-c', '--dry-run'], SUP).err, /could not fetch origin trunk in console/);
    } finally { fs.renameSync(`${F.consoleOrigin}-away`, F.consoleOrigin); }
  } finally { F.done(); }
});

test('every gh call goes through its repo\'s gh', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  // every call, whatever its arguments are; one that isn't a repo's says why, with // gh-direct:
  const direct = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /sh\('gh',/.test(l) && !/sh\('gh', (\[\.\.\.args|args, opts\))/.test(l) && !/\/\/ gh-direct: \S/.test(l));
  assert.deepEqual(direct.map(([n]) => n), [], `gh called outside repo.gh at lines ${direct.map(([n]) => n).join(', ')}`);
});

test('views never use the object routers', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8').split('\n');
  const VIEWS = ['deriveStatus', 'collectMetrics', 'collectProgress', 'notSchedulable', 'cmdReady', 'cmdStatus', 'sessionOf', 'liveSessionsNow', 'restartCommands', 'holdView', 'holdFindings', 'sessionSettled', 'timelineView', 'dashboardData', 'fleetStatus', 'moveChecklist', 'cmdLinks', 'cmdPrompt'];
  const body = (name) => {
    const at = src.findIndex((l) => new RegExp(`^(async )?function ${name}\\(`).test(l) || l.startsWith(`const ${name} = `));
    assert.ok(at >= 0, `${name} is defined`);
    if (src[at].startsWith('const ')) return [[at + 1, src[at]]];
    const end = src.findIndex((l, i) => i > at && l === '}');
    return src.slice(at, end + 1).map((l, i) => [at + 1 + i, l]);
  };
  const bad = VIEWS.flatMap((v) => body(v).filter(([, l]) => /\brepoOfTicket(Id)?\(/.test(l)).map(([n]) => `${v}:${n}`));
  assert.deepEqual(bad, [], 'a view calls an object router; use repoOfTicketLink, factsRepo or repoReadable');
});

test('gate --all and gate <name> in a sibling worktree run that repo\'s gates and log them as that repo\'s', () => {
  const F = multiFixture('gate-sibling');
  const { old, g, okIn, runIn, ticket } = F;
  const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'console-01-a' };
  try {
    const seen = path.join(F.base, 'console-gate-main');
    const links = json(okIn(old, ['settings'])).links;
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { gates: { homegate: 'test -f api/app.rb' }, links: { ...links, console: { ...links.console, gates: { consolegate: `test -f src/main.js && printf %s "$DEVTEAM_MAIN" > '${seen}'` } } } });
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    const head = g(['rev-parse', 'HEAD'], w);
    const r = runIn(w, ['gate', '--all'], W);
    assert.equal(r.status, 0, r.err || r.out);
    assert.match(r.out, /^pass {2}consolegate /m, "console's gate ran");
    assert.doesNotMatch(r.out, /homegate/, "home's gates are never a sibling's");
    assert.equal(F.real(fs.readFileSync(seen, 'utf8')), F.real(F.console), "DEVTEAM_MAIN is console's root");
    okIn(w, ['gate', 'unit', '--', 'true'], W);
    const gates = json(okIn(old, ['log', '--type', 'gate', '--json']));
    assert.deepEqual(gates.map((x) => [x.gate, x.repo, x.sha]), [['consolegate', 'console', head], ['unit', 'console', head]], 'each gate line names console');
    // home's gate --all is as it was: home's gates, no repo on the line
    okIn(old, ['gate', '--all'], W);
    assert.deepEqual(json(okIn(old, ['log', '--type', 'gate', '--json'])).filter((x) => x.gate === 'homegate').map((x) => x.repo), [undefined]);
  } finally { F.done(); }
});

test('a ticket merges only after its depends_on, in any repo; unreadable fails closed; a merge out of order is a finding', () => {
  const F = multiFixture('deps-order');
  const { old, g, okIn, runIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    ticket('companion-01-p', { touches: ['app/**'] });
    ticket('console-02-e', { depends_on: ['companion-01-p'] });
    const w = path.join(old, '.worktrees', 'console-02-e');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-02-e', w, 'origin/trunk'], F.console);
    const tdir = path.join(w, 'docs/devteam/project/tickets/console-02-e');
    write(path.join(tdir, 'spec.md'), '# spec\n');
    write(path.join(tdir, 'plan.md'), '# plan\n\n## TL;DR\n\n- x\n');
    write(path.join(tdir, 'verification.md'), '| Done-when | Command | Result |\n|---|---|---|\n| s | t | pass |\n');
    write(path.join(w, 'src/main.js'), 'uses companion\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'console-02-e: work'], w);
    write(path.join(tdir, 'reviews/final-1.md'), review('reviewer-b', g(['rev-parse', 'HEAD'], w)));
    g(['add', '-A'], w); g(['commit', '-qm', 'review'], w); g(['push', '-q', 'origin', 'ticket/console-02-e'], w);
    const head = g(['rev-parse', 'HEAD'], w);
    okIn(old, ['act', '--class', 'approve-spec', '--refs', 'console-02-e', '--', 'ok'], SUP);
    okIn(old, ['act', '--class', 'approve-plan', '--refs', 'console-02-e', '--', 'ok'], SUP);
    write(path.join(old, 'docs/devteam/run/pr/ticket/console-02-e.md'), '# console-02-e: work\n\n## One-way doors\n\nNone.\n');
    assert.match(okIn(old, ['ready']), /companion-01-p/);
    const trunk = g(['rev-parse', 'origin/trunk'], F.console);
    // merge (dry run or not) and check-pr refuse it while companion-01-p is unmerged
    for (const args of [['merge', 'console-02-e', '--dry-run'], ['merge', 'console-02-e']]) {
      const r = runIn(old, args, SUP);
      assert.notEqual(r.status, 0, args.join(' '));
      assert.match(r.out, /depends on companion-01-p, which is not merged in companion yet: merge it first/);
    }
    assert.match(runIn(old, ['check-pr', '--repo', 'console', '--head-ref', 'ticket/console-02-e', '--sha', head], SUP).out, /depends on companion-01-p, which is not merged in companion yet/);
    assert.equal(g(['rev-parse', 'origin/trunk'], F.console), trunk, 'nothing landed');
    assert.doesNotMatch(okIn(old, ['status']), /merged +console-02-e/);
    // no companion checkout here: it can't be confirmed, so it is refused
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ companion: { path: path.join(F.base, 'not-cloned') } }));
    assert.match(runIn(old, ['merge', 'console-02-e', '--dry-run'], SUP).out, /cannot confirm companion-01-p is merged: its checkout \S*not-cloned is missing/);
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
    // console-02-e lands on console's trunk by hand (the forge's UI): a finding names it. First, the
    // same merge dated before the upgrade (before the kit that knows the finding reached home's main)
    // raises nothing: merge didn't refuse it then.
    g(['checkout', '-q', 'trunk'], F.console);
    execFileSync('git', ['merge', '-q', '--no-ff', '-m', 'Merge ticket/console-02-e', 'ticket/console-02-e'], { cwd: F.console, env: { ...process.env, GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z' } });
    g(['push', '-q', 'origin', 'trunk'], F.console);
    assert.match(okIn(old, ['status']), /merged +console-02-e/, 'it reads merged');
    assert.ok(!json(okIn(old, ['metrics', '--json'])).findings.some((x) => x.kind === 'merged-out-of-order'), 'an out-of-order merge from before the upgrade is no finding');
    g(['reset', '-q', '--hard', 'HEAD^'], F.console);
    g(['merge', '-q', '--no-ff', '-m', 'Merge ticket/console-02-e', 'ticket/console-02-e'], F.console);
    g(['push', '-q', '-f', 'origin', 'trunk'], F.console);
    const m = json(okIn(old, ['metrics', '--json']));
    const f = m.findings.find((x) => x.kind === 'merged-out-of-order');
    assert.ok(f, `a merged-out-of-order finding: ${JSON.stringify(m.findings.map((x) => x.kind))}`);
    assert.equal(f.subject, 'console-02-e');
    assert.match(f.detail, /console-02-e reached console's main before companion-01-p/);
    okIn(old, ['observe-metrics'], SUP);
    const o = json(okIn(old, ['log', '--type', 'observation', '--json'])).find((x) => x.kind === 'merged-out-of-order');
    assert.equal(o.severity, 3);
  } finally { F.done(); }
});

test('a worker session denies pushes to its own repo\'s main; a merge with no merge act on any main is merged-without-merge', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const fn = /\nfunction deniedFor\(rules, mb\) \{[\s\S]*?\n\}\n/.exec(src);
  assert.ok(fn, 'deniedFor is defined');
  const deniedFor = new Function(`${fn[0]}; return deniedFor;`)();
  const defaults = ['gh pr merge*', 'gh api*', 'git push*main*', 'git push*--force*', 'git push*-f *', 'git push*+*'];
  assert.deepEqual(deniedFor(defaults, 'main'), defaults, "home on main: the owner's rules as written");
  assert.ok(deniedFor(defaults, 'trunk').includes('git push*trunk*'), 'a sibling on trunk: its main is denied too');
  assert.ok(deniedFor(defaults, 'trunk').includes('git push*main*'));
  assert.match(src, /policy = path\.join\(runDir, 'agent', `\$\{name\}-claude\.json`\)/, 'one policy file per session');
  assert.match(src, /deny: deniedFor\(s\.worker_denied_commands, mb\)/, "built from the session's repo's main branch");
  const F = multiFixture('no-merge-act');
  const { old, g, okIn, ticket } = F;
  try {
    ticket('console-01-a');
    // a worker pushes its ticket straight to console's trunk: it reads merged, with no merge act
    const w = path.join(F.base, 'console-push');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'src/main.js'), 'pushed\n');
    g(['commit', '-qam', 'console-01-a: work'], w);
    g(['push', '-q', 'origin', 'HEAD:trunk'], w);
    // a merge on companion's main from the forge's button, no ticket
    g(['checkout', '-q', '-b', 'side'], F.companion);
    write(path.join(F.companion, 'app/x.js'), 'x\n');
    g(['add', '-A'], F.companion); g(['commit', '-qm', 'side'], F.companion);
    g(['checkout', '-q', 'main'], F.companion);
    g(['merge', '-q', '--no-ff', '-m', 'Merge pull request #1', 'side'], F.companion);
    g(['push', '-q', 'origin', 'main'], F.companion);
    okIn(old, ['observe-metrics'], { DEVTEAM_ROLE: 'supervisor' });
    const fs1 = json(okIn(old, ['metrics', '--json'])).findings.filter((x) => x.kind === 'merged-without-merge');
    const t = fs1.find((x) => x.subject === 'console-01-a');
    assert.ok(t, `a finding for the pushed ticket: ${JSON.stringify(fs1)}`);
    assert.match(t.detail, /console-01-a reached console's main at \w{12} with no merge act/);
    const m = fs1.find((x) => x.subject.startsWith('companion:'));
    assert.ok(m, 'a finding for the merge on companion\'s main');
    assert.match(m.detail, /companion's main has merge \w{12} .* that no merge act made/);
    assert.equal(fs1.length, 2, 'nothing for home, where nothing was merged');
  } finally { F.done(); }
});
