// Sibling repos in the views: observe-metrics, gh, fleet status, the dashboard, releases, planning.
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
import { kit, freePort, serverUp, write, review, json, monoFixture, multiFixture } from './lib/kit.mjs';

test('observe-metrics fetches each repo link\'s main; a failed fetch is a repo-unreachable finding, never a crash', () => {
  const F = multiFixture('tick-fetch');
  const { old, g, okIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    ticket('console-01-a');
    assert.match(okIn(old, ['status']), /ready +console-01-a/);
    // from another clone of console: a commit for console-01-a lands on trunk by hand
    const other = path.join(F.base, 'console-other');
    g(['clone', '-q', F.consoleOrigin, other], F.base);
    write(path.join(other, 'src/x.js'), 'by hand\n');
    g(['add', '-A'], other);
    g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'console-01-a: by hand'], other);
    g(['push', '-q', 'origin', 'trunk'], other);
    g(['fetch', '-q', 'origin'], old);
    assert.match(okIn(old, ['status']), /ready +console-01-a/, "before the tick's observe step, console's main is as last fetched");
    assert.match(okIn(old, ['observe-metrics'], SUP), /recorded/);
    assert.equal(g(['rev-parse', 'origin/trunk'], F.console), g(['rev-parse', 'HEAD'], other), "console's main is fetched");
    assert.match(okIn(old, ['status']), /merged +console-01-a/);
    // console's origin is gone: a finding naming the link, and the tick carries on
    fs.renameSync(F.consoleOrigin, `${F.consoleOrigin}-away`);
    try {
      const out = okIn(old, ['observe-metrics'], SUP);
      assert.match(out, /recorded/);
      const f = json(okIn(old, ['metrics', '--json'])).findings.find((x) => x.kind === 'repo-unreachable');
      assert.ok(f, 'a repo-unreachable finding');
      assert.equal(f.subject, 'console');
      assert.match(f.detail, /could not fetch origin trunk/);
      assert.ok(json(okIn(old, ['log', '--type', 'observation', '--json'])).some((o) => o.kind === 'repo-unreachable' && o.subject === 'console'), 'observed');
    } finally { fs.renameSync(`${F.consoleOrigin}-away`, F.consoleOrigin); }
    // back: the next tick's fetch clears it
    okIn(old, ['observe-metrics'], SUP);
    assert.ok(!json(okIn(old, ['metrics', '--json'])).findings.some((x) => x.kind === 'repo-unreachable'));
  } finally { F.done(); }
});

test('a github-forge sibling: gh is asked about that repo', () => {
  const F = multiFixture('gh-r');
  const { old, g, okIn, runIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    // console's origin is written as GitHub's; insteadOf sends fetches to the local bare repo
    g(['remote', 'set-url', 'origin', 'https://github.com/usbclub/console.git'], F.console);
    g(['config', `url.${F.consoleOrigin}.insteadOf`, 'https://github.com/usbclub/console.git'], F.console);
    const links = json(okIn(old, ['settings'])).links;
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, remote: 'usbclub/console', forge: 'github' } } });
    ticket('console-01-a');
    const bin = path.join(F.base, 'fakegh');
    const logf = path.join(F.base, 'gh-args.log');
    write(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${logf}"\nexit 1\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    runIn(old, ['merge', 'console-01-a', '--dry-run'], SUP, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    assert.match(fs.readFileSync(logf, 'utf8'), /^pr view ticket\/console-01-a --json \S+ -R usbclub\/console$/m);
  } finally { F.done(); }
});

test('a single-repo project\'s gh calls name no repo (-R), as before repo links', () => {
  const F = monoFixture('gh-home');
  const { old, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    g(['remote', 'set-url', 'origin', 'https://github.com/acme/home.git'], old);
    g(['config', `url.${F.org}.insteadOf`, 'https://github.com/acme/home.git'], old);
    F.lines(F.STD, { forge: 'github' });
    const bin = path.join(F.base, 'fakegh');
    const logf = path.join(F.base, 'gh-args.log');
    write(path.join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${logf}"\necho '[]'\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const gh = (cmd) => spawnSync(process.execPath, [path.join(old, 'docs/devteam/scripts/devteam.mjs'), ...cmd], { cwd: old, env: { ...F.env(SUP), PATH: `${bin}${path.delimiter}${process.env.PATH}` }, encoding: 'utf8' });
    gh(['fleet', 'status', '--json', '--no-fetch']);
    gh(['merge', 'api-01-x', '--dry-run']);
    const calls = fs.readFileSync(logf, 'utf8').split('\n').filter(Boolean);
    assert.ok(calls.some((c) => /^pr list /.test(c)), `fleet status asked gh for open PRs: ${calls.join(' | ')}`);
    assert.deepEqual(calls.filter((c) => /(^| )-R( |$)/.test(c)), [], 'no home gh call names a repo');
  } finally { F.done(); }
});

test('fleet status checks a sibling session against its own remote and lists every repo', () => {
  const F = multiFixture('fleet-multi');
  const { old, g, okIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'console-01-a' };
  try {
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    okIn(w, ['phase', 'build', '--task', 'T1'], W);
    write(path.join(w, 'src/a.js'), 'a\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'T1'], w);
    okIn(old, ['fleet', 'park', '--reason', 'move'], SUP);
    okIn(w, ['handoff'], W, {}, 'Done: T1. Next: T2.\n');
    okIn(w, ['phase', 'parked', '--note', 'parked'], W);
    const st = json(okIn(old, ['fleet', 'status', '--json', '--no-fetch'], SUP));
    const s = st.sessions.find((x) => x.name === 'console-01-a');
    assert.equal(s.repo, 'console');
    assert.equal(s.pushed, true, "its branch is on console's origin (handoff pushed it)");
    assert.equal(s.handoff, true);
    assert.deepEqual(st.repos.map((r) => [r.id, F.real(r.path), r.found]), [['companion', F.real(F.companion), true], ['console', F.real(F.console), true]]);
    assert.ok(st.checklist.some((c) => /^clone .*console\.git: git clone '\S*console\.git' '\S*\/console' /.test(c)), 'the new machine clones each sibling where its path says');
    assert.match(okIn(old, ['fleet', 'status', '--no-fetch'], SUP), /\nrepos:\n {2}companion +.*\n {2}console +/);
    // a commit not on console's origin is a blocker named for console's remote
    okIn(w, ['phase', 'build'], W);
    write(path.join(w, 'src/b.js'), 'b\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'T2'], w);
    okIn(w, ['phase', 'parked', '--note', 'parked'], W);
    assert.match(json(okIn(old, ['fleet', 'status', '--json', '--no-fetch'], SUP)).blockers.join('\n'), /console-01-a: ticket\/console-01-a here \(\w{12}\) is not what origin has/);
    // a machine without the console checkout: fleet status still runs, and says what to clone where
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: path.join(F.base, 'not-cloned') } }));
    const miss = json(okIn(old, ['fleet', 'status', '--json', '--no-fetch'], SUP));
    assert.equal(miss.sessions.find((x) => x.name === 'console-01-a').readable, false);
    assert.match(miss.blockers.join('\n'), /console-01-a: its repo console has no checkout here, or the wrong one: clone .*console\.git at .*not-cloned/);
    assert.match(miss.blockers.join('\n'), /(^|\n)console: clone .*console\.git at .*not-cloned/);
    assert.ok(miss.checklist.some((c) => /run\/links\.local\.json/.test(c)), 'the checklist says links.local.json does not move');
    assert.doesNotMatch(miss.blockers.join('\n'), /files in run\/ the kit didn't make/, 'links.local.json is a kit file');
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
    // with fetching, console's origin gone: a blocker, never a stale "pushed"
    fs.renameSync(F.consoleOrigin, `${F.consoleOrigin}-away`);
    try {
      assert.match(json(okIn(old, ['fleet', 'status', '--json'], SUP)).blockers.join('\n'), /(^|\n)console: could not fetch origin: .*; what its sessions pushed is unchecked/);
    } finally { fs.renameSync(`${F.consoleOrigin}-away`, F.consoleOrigin); }
    // the kit installs no forge workflow, so a sibling on GitHub has no workflow check either
    const links = json(okIn(old, ['settings'])).links;
    F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, companion: { ...links.companion, forge: 'github' } } });
    const gh = json(okIn(old, ['fleet', 'status', '--json', '--no-fetch'], SUP));
    assert.doesNotMatch(gh.warnings.join('\n'), /workflow/);
    assert.equal(gh.repos.find((r) => r.id === 'companion').workflow, undefined);
  } finally { F.done(); }
});

test('the dashboard reads a sibling ticket\'s documents from its repo', async () => {
  const F = multiFixture('dash-sibling');
  const { old, g, okIn, ticket } = F;
  try {
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'docs/devteam/project/tickets/console-01-a/spec.md'), '# console spec\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'spec'], w);
    const spec = json(okIn(old, ['timeline', 'console-01-a', '--json'])).files.find((f) => f.title === 'spec');
    assert.equal(spec.repo, 'console');
    const port = await freePort();
    const srv = spawn(process.execPath, [F.kitDT, 'dashboard', '--port', String(port)], { cwd: old, env: F.env({}), stdio: 'ignore' });
    try {
      await serverUp(`http://127.0.0.1:${port}/`);
      const get = async (q) => { const r = await fetch(`http://127.0.0.1:${port}/api/file?${new URLSearchParams(q)}`); return [r.status, await r.text()]; };
      assert.deepEqual(await get({ path: spec.path, ref: spec.ref, repo: 'console' }), [200, '# console spec\n']);
      assert.equal((await get({ path: spec.path, ref: spec.ref }))[0], 404, "home has no such file: the repo must be named");
      assert.equal((await get({ path: spec.path, repo: 'Not A Link' }))[0], 400);
      // the drawer rebuilds the URL from the link's params: it must carry repo through
      const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
      const of = html.slice(html.indexOf('function openFile(params)'), html.indexOf('DRAWER.url = url;', html.indexOf('function openFile(params)')));
      assert.match(of, /repo = params\.get\('repo'\)/);
      assert.match(of, /new URLSearchParams\(\{ path, \.\.\.\(ref \? \{ ref \} : \{\}\), \.\.\.\(repo \? \{ repo \} : \{\}\) \}\)/, 'openFile passes repo to /api/file');
      assert.match(html, /const fileHref = \(l\) => [^\n]*\.\.\.\(l\.repo \? \{ repo: l\.repo \} : \{\}\)/, 'a file link carries its repo');
      // the drawer's Commits: the file's history from console's git, not home's
      const peek = async (q) => { const r = await fetch(`http://127.0.0.1:${port}/api/peek?${new URLSearchParams({ kind: 'file', id: spec.path, ...q })}`); return [r.status, await r.json()]; };
      const [ps, pj] = await peek({ ref: spec.ref, repo: 'console' });
      assert.equal(ps, 200);
      assert.deepEqual(pj.history.map((h) => h.subject), ['spec'], "the file's commits, read in console");
      assert.equal((await peek({ repo: 'Not A Link' }))[0], 400);
      assert.match(html.slice(html.indexOf('function openFile(params)')), /peekOf\('file', path, \{ \.\.\.\(ref \? \{ ref \} : \{\}\), \.\.\.\(repo \? \{ repo \} : \{\}\) \}\)/, 'openFile asks the peek in the same repo');
      // no console checkout here: a 404 that says so, and the dashboard carries on
      write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: path.join(F.base, 'not-cloned') } }));
      const [code, text] = await get({ path: spec.path, ref: spec.ref, repo: 'console' });
      assert.deepEqual([code, text], [404, 'no checkout of console here']);
      assert.deepEqual((await peek({ ref: spec.ref, repo: 'console' }))[1].history, [], 'no history, and no failure, without the checkout');
      fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
    } finally { srv.kill(); }
  } finally { F.done(); }
});

test('the dashboard caches a file\'s peek per repo and ref', async () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* peeks start */'), html.indexOf('/* peeks end */'));
  assert.ok(src.length > 200, 'the peek block is marked in index.html');
  const answers = { '': ['apps'], companion: ['init'], 'companion#v1': ['old'] };
  const fetch = async (u) => { const q = new URL(u, 'http://x').searchParams; const k = `${q.get('repo') ?? ''}${q.get('ref') ? `#${q.get('ref')}` : ''}`; return { ok: true, status: 200, json: async () => ({ history: answers[k] }) }; };
  const ctx = vm.createContext({ fetch, URLSearchParams, DRAWER: { kind: null, id: null }, redraw: () => {} });
  vm.runInContext(`${src}\n;globalThis.api = { PEEKS, peekOf, fetchPeek, peekKey };`, ctx);
  const { peekOf, fetchPeek } = ctx.api;
  await fetchPeek('file', 'README.md', {});
  await fetchPeek('file', 'README.md', { repo: 'companion' });
  await fetchPeek('file', 'README.md', { repo: 'companion', ref: 'v1' });
  assert.deepEqual([...peekOf('file', 'README.md').history], ['apps'], "home's file");
  assert.deepEqual([...peekOf('file', 'README.md', { repo: 'companion' }).history], ['init'], "companion's file, not home's");
  assert.deepEqual([...peekOf('file', 'README.md', { repo: 'companion', ref: 'v1' }).history], ['old'], 'the same file at another ref');
  assert.equal(ctx.api.PEEKS.size, 3);
});

test('releases per repo: a component\'s tag pattern, the act names the repo, notes read that repo', () => {
  const F = multiFixture('releases');
  const { old, g, okIn, runIn, ticket } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    F.lines({ ...F.STD, console: { link: 'console', release: { tag: 'console/v*' } }, companion: { link: 'companion' } });
    ticket('console-01-a');
    const w = path.join(old, '.worktrees', 'console-01-a');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'src/main.js'), 'v1\n');
    g(['commit', '-qam', 'console-01-a: v1'], w);
    g(['checkout', '-q', 'trunk'], F.console);
    g(['merge', '-q', '--no-ff', '-m', 'Merge ticket/console-01-a', 'ticket/console-01-a'], F.console);
    g(['push', '-q', 'origin', 'trunk'], F.console);
    g(['tag', '-a', 'v9.9.9', '-m', 'not this component\'s', 'trunk'], F.console);
    assert.match(okIn(old, ['status']), /merged +console-01-a/, 'a v* tag is not a console/v* release');
    g(['tag', '-a', 'console/v1.0.0', '-m', 'console 1.0.0', 'trunk'], F.console);
    assert.match(okIn(old, ['status']), /released +console-01-a/);
    const a = okIn(old, ['act', '--class', 'release-staging', '--repo', 'console', '--', 'staged console/v1.0.0'], SUP);
    assert.equal(json(okIn(old, ['log', '--id', a, '--json']))[0].repo, 'console');
    assert.equal(json(okIn(old, ['log', '--id', okIn(old, ['act', '--class', 'release-staging', '--', 'staged v2'], SUP), '--json']))[0].repo, undefined, "home's acts carry no repo");
    assert.match(runIn(old, ['act', '--class', 'release-staging', '--repo', 'nope', '--', 'x'], SUP).err, /--repo nope: not a repo link/);
    assert.match(okIn(old, ['notes', 'trunk~1', 'trunk', '--repo', 'console']), /Other\n\n- console-01-a/);
    assert.doesNotMatch(okIn(old, ['notes', 'origin/main~1', 'origin/main']), /console-01-a/, "home's notes read home's history");
  } finally { F.done(); }
});

test('cross-repo planning: footprints overlap only within a repo; a story across repos needs one ticket that lands last', () => {
  const F = multiFixture('xrepo-plan');
  const { old, okIn, runIn, ticket } = F;
  try {
    // the same path in two repos is two different files
    ticket('console-01-a', { touches: ['src/**'] });
    ticket('companion-02-b', { touches: ['src/**'] });
    assert.doesNotMatch(runIn(old, ['validate']).out, /console-01-a and companion-02-b can run concurrently/);
    ticket('console-03-c', { touches: ['src/**'] });
    assert.match(runIn(old, ['validate']).out, /console-01-a and console-03-c can run concurrently/, 'within one repo they still overlap');
    // review questions pin a page in home: a sibling ticket's is refused, with what to do
    assert.match(runIn(old, ['ask', '--kind', 'review', '--ticket', 'console-01-a', '--question', 'Does it look right?'], { DEVTEAM_ROLE: 'supervisor' }).err, /console-01-a is a ticket in console: a review question pins a page committed in home, so draw the page in a home chore and ask it there/);
    // a story served in two repos: --strict wants the end-to-end ticket that depends on the rest
    okIn(old, ['feature', 'add', 'sync', '--json', JSON.stringify({ title: 'Sync', goals: ['g-20260101-000000000-supervisor'], stories: [{ id: 'SYNC-S1', text: 'sync works', release: 'v1' }] })], { DEVTEAM_ROLE: 'supervisor' });
    const tk = (id, extra) => okIn(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'sync', component: id.split('-')[0], kind: 'build', size: 'S', risk: 'normal', serves: ['SYNC-S1'], depends_on: [], touches: [`${id.split('-')[0] === 'api' ? 'api' : 'src'}/**`], done_when: ['the sync check passes'], ...extra })], { DEVTEAM_ROLE: 'supervisor' });
    tk('api-10-provide', { kind: 'contract', contracts: { provides: ['sync-v1'] } });
    tk('console-11-use', {});
    assert.match(runIn(old, ['validate', '--strict']).out, /feature sync: story SYNC-S1 is served in api, console \(home, console\) and no ticket serving it depends on all the others/);
    assert.doesNotMatch(runIn(old, ['validate']).out, /story SYNC-S1 is served in/, 'only under --strict');
    tk('console-12-e2e', { kind: 'integration', depends_on: ['api-10-provide', 'console-11-use'] });
    assert.doesNotMatch(runIn(old, ['validate', '--strict']).out, /story SYNC-S1 is served in/);
  } finally { F.done(); }
});
