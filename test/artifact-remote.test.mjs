// The Library shows pushes from other machines (kit-750): while the Library or a viewer is open, the
// dashboard fetches origin (main into refs/remotes/origin/<main>, every branch into the kit's own
// refs/devteam-remote/*, --refmap= so nothing else is written) once an interval, one fetch at a time,
// bounded (its process group killed at the timeout), backing off after a failure and saying so; an
// artifact pushed to origin's main shows and an open viewer of it reloads; an origin branch that changes
// project/artifacts/<slug>/ against main (not merged, not squash-merged) shows as a draft from another
// machine, served from that ref's tree after the artifact checks; a local worktree's draft still wins.
// A real dashboard on a fleet fixture whose origin is a bare repo; "the other machine" is a second clone
// that pushes. A git shim on the dashboard's PATH logs every fetch (time, cwd, env, argv, exit) and can
// make one hang with a child of its own. Intervals are shortened by DEVTEAM_ARTIFACT_FETCH_MS /
// _BACKOFF_MS / _TIMEOUT_MS; one case reads the defaults. Budgets are derived from a timed build.
// The Chrome case is in artifact-remote.chrome.test.mjs and the helpers in lib/artifact-remote-fixture.mjs (kit-859).
// Ports: none of its own (lib/kit.mjs's freePort)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, write } from './lib/kit.mjs';
import { J, ARTS, sleep, INT, art, alive, fetchArgvOk, getJson, askRemote, remoteStatus, library, row, bytes, within, demand, snapshot, refsIn, dirsNamed, setup } from './lib/artifact-remote-fixture.mjs';

// S6 at its source: BRANCH_AT and ARTIFACT_AT read out of the script, as the server and the CLI hold them
test('artifact remote safe: BRANCH_AT takes branch names git and a URL can carry safely, and ARTIFACT_AT takes origin:<branch>', () => {
  const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
  const decl = (name) => { const m = new RegExp(`^const ${name} = .*;$`, 'm').exec(src); assert.ok(m, `${name} is declared on one line`); return m[0]; };
  const ctx = vm.createContext({});
  vm.runInContext(`${decl('BRANCH_AT')}\n${decl('ARTIFACT_AT')}\nglobalThis.R = { BRANCH_AT, ARTIFACT_AT };`, ctx);
  const { BRANCH_AT, ARTIFACT_AT } = ctx.R;
  assert.ok(ARTIFACT_AT.source.includes(`|origin:${BRANCH_AT.source.slice(1, -1)})`), 'S6: ARTIFACT_AT\'s origin: form is BRANCH_AT written out');
  for (const b of ['ticket/far-01', 'a.b/c-d_e', 'main', 'plan/x', 'v1.2.3', `a${'b'.repeat(199)}`]) {
    assert.ok(BRANCH_AT.test(b), `S6: takes ${b}`);
    assert.ok(ARTIFACT_AT.test(`origin:${b}`), `S6: at origin:${b}`);
  }
  for (const b of ['../x', 'a/../b', 'a//b', 'a.lock', 'a/b.lock', '@{u}', 'a@{1}', 'a/.b', '.a', 'a/', 'a.', '', '/x', `a${'b'.repeat(200)}`, 'a b', 'ça', 'a\nb', 'a..b', 'x/a..b', 'a~1', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b']) {
    assert.equal(BRANCH_AT.test(b), false, `S6: refuses ${JSON.stringify(b)}`);
    assert.equal(ARTIFACT_AT.test(`origin:${b}`), false, `S6: at origin:${JSON.stringify(b)}`);
  }
  // what it took before stays as it was
  for (const at of ['main', `tree:${'a'.repeat(40)}`, 'kit-750-x', 'demo-01-draft']) assert.ok(ARTIFACT_AT.test(at), `ARTIFACT_AT still takes ${at}`);
  for (const at of ['tree:abc', '-x', 'a/b', 'origin:']) assert.equal(ARTIFACT_AT.test(at), false, `ARTIFACT_AT still refuses ${at}`);
});

test('artifact remote main: fetched once an interval while asked for, none while nothing is open; a push to main shows', { timeout: 300000 }, async (t) => {
  const { F, spy, other, start } = await setup(t, 'remote-main');
  const { B, L, W } = await start();
  // M1: nothing open, nothing fetched; the GETs only read (org-access A13): the status, a viewer's
  // check of main and a draft's fp start no fetch
  const t1 = Date.now();
  while (Date.now() - t1 < INT * 3 + W) {
    for (const r of ['/api/artifact-remote', '/api/view?kind=artifact&slug=none&at=main', '/api/artifact-fp?slug=none&at=origin:ticket/none']) await (await fetch(`${B}${r}`, { headers: { 'sec-fetch-site': 'same-origin' } })).text();
    await sleep(500);
  }
  assert.deepEqual(spy.fetches(), [], 'M1: no fetch while no Library or viewer is open, GETs asked or not');
  // M2 + M3: the Library open; a push to origin's main from the other machine shows
  const stop = demand(B);
  t.after(stop);
  other.push('main', 'remote-main', art('v1'));
  await within(L, async () => row(await library(B), 'remote-main', 'main'), 'M3: the pushed artifact in the Library at main');
  const served = await bytes(B, '/artifact/main/remote-main/');
  assert.equal(served.status, 200, 'M3: served from main');
  assert.match(served.text, /<title>v1<\/title>/, 'M3: the pushed bytes');
  await sleep(INT * 4);
  const fs1 = spy.fetches();
  assert.ok(fs1.length >= 3, `M2: one fetch per interval while asked for (${fs1.length})`);
  for (let i = 1; i < fs1.length; i++) assert.ok(fs1[i].start - fs1[i - 1].end >= INT - 100, `M2: fetch ${i} started ${fs1[i].start - fs1[i - 1].end} ms after the last ended, under the interval`);
  for (const f of fs1) {
    assert.equal(f.cwd, fs.realpathSync(F.old), 'M2: in the checkout');
    assert.equal(fetchArgvOk(f.argv), null, `M2: only the design's fetch ran (${f.argv})`);
  }
  // demand gone: fetches may go on until the window has passed since the last ask, and none starts after
  // that (the timer decides when it fires); one already running may finish
  stop();
  const lastAsk = Date.now();
  await sleep(W + INT * 4);
  const late = spy.fetches().filter((f) => f.start > lastAsk + W + 250);
  assert.deepEqual(late.map((f) => f.start - lastAsk), [], 'M1: no fetch starts once the window since the last ask has passed');
});

test('artifact remote main: the defaults are a fetch at once, then a 30 s cadence, and a 5 min back-off', { timeout: 180000 }, async (t) => {
  const { F, start } = await setup(t, 'remote-defaults');
  const { B } = await start({ DEVTEAM_ARTIFACT_FETCH_MS: undefined });
  const stop = demand(B);
  t.after(stop);
  const ok = await within(25000, async () => { const s = await remoteStatus(B); return s?.fetched_at && s; }, 'M6: a first fetch at once');
  assert.equal(ok.ok, true);
  assert.equal(ok.stale, false);
  assert.ok(Math.abs(Date.parse(ok.next_at) - Date.parse(ok.fetched_at) - 30000) < 1500, `M6: the next fetch 30 s after the last (${ok.next_at} vs ${ok.fetched_at})`);
  // origin unreachable: the next fetch fails, and the one after waits 5 min
  F.g(['remote', 'set-url', 'origin', path.join(F.base, 'nowhere.git')], F.old);
  const bad = await within(45000, async () => { const s = await remoteStatus(B); return s.ok === false && s; }, 'M6: a failed fetch');
  assert.equal(bad.stale, true);
  assert.ok(Math.abs(Date.parse(bad.next_at) - Date.parse(bad.fetched_at) - 300000) < 1500, `M6: back-off 5 min (${bad.next_at} vs ${bad.fetched_at})`);
});

test('artifact remote drafts: an origin branch that changes an artifact shows as a draft from another machine, served from its ref', { timeout: 400000 }, async (t) => {
  const { F, spy, other, start } = await setup(t, 'remote-drafts');
  // D3: landed-one on main, a branch from that main with its own artifact, then main changes landed-one
  other.push('main', 'landed-one', art('landed v1'));
  other.push('ticket/old-base', 'own-mock', art('own'));
  other.push('main', 'landed-one', art('landed v2'));
  // D8: one branch squash-merged and kept, one merge-committed and kept; main changes both artifacts after
  other.push('ticket/sq-01', 'sq-mock', art('sq v1'));
  other.land('ticket/sq-01', 'squash');
  other.push('ticket/mc-01', 'mc-mock', art('mc v1'));
  other.land('ticket/mc-01', 'merge');
  other.push('main', 'sq-mock', art('sq v2 on main'));
  other.push('main', 'mc-mock', art('mc v2 on main'));
  // D9: two branches change one slug, the second a second later
  other.push('ticket/two-a', 'two-mock', art('two a'));
  await sleep(1100);
  other.push('ticket/two-b', 'two-mock', art('two b'));
  // D10: an orphan branch
  other.orphan('orphan/x', 'orphan-mock', art('orphan'));
  F.g(['pull', '-q', 'origin', 'main'], F.old);
  // the checkout's own remote-tracking refs for every branch, as a supervisor's fetch leaves them
  F.g(['fetch', '-q', 'origin'], F.old);
  // final-1 F5: a branch this machine has too is its own pushed work, never from another machine
  other.push('ticket/mine', 'mine-mock', art('mine'));
  F.g(['fetch', '-q', 'origin'], F.old);
  F.g(['branch', '-q', 'ticket/mine', 'origin/ticket/mine'], F.old);
  const { B, L, LW } = await start();
  const stop = demand(B);
  t.after(stop);
  const before = snapshot(F);
  // D1
  const tree = other.push('ticket/far-01', 'far-mock', art('far v1', { 'style.css': 'p { color: red }' }));
  const r1 = await within(L, async () => row(await library(B), 'far-mock', 'origin:ticket/far-01'), 'D1: the branch draft listed');
  assert.equal(r1.branch, 'ticket/far-01', 'D1: labelled with its branch');
  assert.equal(r1.remote, true, 'D1: from another machine');
  assert.equal(r1.error, null, 'D1: no error');
  assert.equal(r1.title, 'far v1');
  assert.equal(r1.updated_at, other.tipTime('ticket/far-01'), "D1: updated_at is the tip's committer date");
  assert.equal((await library(B)).find((a) => a.slug === 'mine-mock'), undefined, "F5: this machine's own branch is no draft from another machine");
  const page = await bytes(B, '/artifact/origin/ticket%2Ffar-01/far-mock/');
  assert.equal(page.status, 200, 'D1: served');
  assert.equal(page.text, F.g(['cat-file', 'blob', `${tree}:index.html`], other.dir), 'D1: the branch blob, byte for byte');
  assert.equal((await bytes(B, '/artifact/origin/ticket%2Ffar-01/far-mock/style.css')).text, 'p { color: red }', 'D1: its other files');
  // the viewer's reads of it (task-3 F5): its version, and its fingerprint by the async lookup
  const tip = F.g(['rev-parse', 'origin/ticket/far-01'], other.dir);
  const vers = await getJson(B, '/api/artifact-versions?slug=far-mock');
  assert.equal(vers.status, 200, 'D1: its versions');
  assert.deepEqual(vers.body.versions.find((v) => v.at === 'origin:ticket/far-01'), { kind: 'draft', at: 'origin:ticket/far-01', worktree: 'origin:ticket/far-01', branch: 'ticket/far-01', commit: tip, time: r1.updated_at, fp: r1.fp, url: '/artifact/origin/ticket%2Ffar-01/far-mock/' }, 'D1: the remote version');
  const fpAt = (at) => getJson(B, `/api/artifact-fp?${new URLSearchParams({ slug: 'far-mock', at })}`);
  assert.deepEqual(await fpAt('origin:ticket/far-01'), { status: 200, body: { fp: r1.fp, at: 'origin:ticket/far-01' } }, "D1: its fp, the listing's");
  assert.equal((await fpAt('origin:ticket/none')).status, 404, 'D1: no such branch is gone, not a failure');
  // D2: never a checkout, and no configured remote-tracking ref moved
  assert.deepEqual(snapshot(F), before, 'D2: no worktree, branch, index, file or remote-tracking ref of the checkout changed');
  assert.deepEqual(dirsNamed(F.old, 'far-mock'), [], 'D2: no far-mock folder on disk');
  const arts = await library(B);
  // D3
  assert.equal(arts.filter((a) => a.slug === 'landed-one' && a.at !== 'main').length, 0, 'D3: landed-one has no remote draft');
  assert.ok(row(arts, 'own-mock', 'origin:ticket/old-base'), "D3: the old branch's own artifact is listed");
  // D8
  assert.equal(arts.filter((a) => a.slug === 'sq-mock' && a.at !== 'main').length, 0, 'D8: a squash-merged branch kept on origin is no draft');
  assert.equal(arts.filter((a) => a.slug === 'mc-mock' && a.at !== 'main').length, 0, 'D8: a merge-committed branch kept on origin is no draft');
  // D9
  const a9 = row(arts, 'two-mock', 'origin:ticket/two-a'), b9 = row(arts, 'two-mock', 'origin:ticket/two-b');
  assert.ok(a9 && b9, 'D9: both branches listed');
  assert.equal(a9.updated_at, other.tipTime('ticket/two-a'));
  assert.equal(b9.updated_at, other.tipTime('ticket/two-b'));
  assert.ok(Date.parse(b9.updated_at) > Date.parse(a9.updated_at), 'D9: two-b is the newer');
  // D10
  assert.equal(row(arts, 'orphan-mock', 'origin:orphan/x')?.error, null, 'D10: an orphan branch lists its artifact');
  // D4: a second push refreshes it
  other.push('ticket/far-01', 'far-mock', art('far v2'));
  const r2 = await within(L, async () => { const x = row(await library(B), 'far-mock', 'origin:ticket/far-01'); return x && x.fp !== r1.fp && x; }, 'D4: the new commit listed');
  assert.equal(r2.title, 'far v2');
  assert.match((await bytes(B, '/artifact/origin/ticket%2Ffar-01/far-mock/')).text, /far v2/, 'D4: the new bytes');
  // D6: a local worktree's draft of the same slug wins, and says so
  const wt = path.join(F.old, '.worktrees/far-01', ARTS, 'far-mock');
  for (const [rel, text] of Object.entries(art('local'))) write(path.join(wt, rel), text);
  const r6 = await within(LW, async () => row(await library(B), 'far-mock', 'far-01'), 'D6: the local draft');
  assert.deepEqual(r6.remote_branches, ['ticket/far-01'], 'D6: the local row names the remote draft it hides');
  assert.equal(row(await library(B), 'far-mock', 'origin:ticket/far-01'), null, 'D6: no remote row beside it');
  fs.rmSync(path.join(F.old, '.worktrees'), { recursive: true, force: true });
  // D5: deleted on origin, gone after the next fetch; only the kit's own namespace pruned
  await within(LW, async () => row(await library(B), 'far-mock', 'origin:ticket/far-01'), 'D5: back once the local draft went');
  const tracking = F.g(['for-each-ref', '--format=%(objectname)', 'refs/remotes/origin/ticket/old-base'], F.old);
  other.del('ticket/far-01');
  other.del('ticket/old-base');
  await within(L, async () => !row(await library(B), 'far-mock', 'origin:ticket/far-01'), 'D5: dropped');
  assert.equal((await bytes(B, '/artifact/origin/ticket%2Ffar-01/far-mock/')).status, 404, 'D5: no longer served');
  assert.equal((await getJson(B, `/api/artifact-fp?${new URLSearchParams({ slug: 'far-mock', at: 'origin:ticket/far-01' })}`)).status, 404, "D5: the viewer's poll says it is gone");
  assert.doesNotMatch(refsIn(F, 'refs/devteam-remote'), /far-01|old-base/, 'D5: its ref pruned');
  assert.equal(F.g(['for-each-ref', '--format=%(objectname)', 'refs/remotes/origin/ticket/old-base'], F.old), tracking, "D5: the checkout's own remote-tracking ref left alone");
  assert.ok(spy.fetches().length >= 1);
});

test('artifact remote safe: bounded, one at a time, backs off and says so, refs only, checked before serving', { timeout: 400000 }, async (t) => {
  const { F, spy, other, start } = await setup(t, 'remote-safe', { DEVTEAM_ARTIFACT_FETCH_MS: '1000', DEVTEAM_ARTIFACT_FETCH_TIMEOUT_MS: '2000', DEVTEAM_ARTIFACT_FETCH_BACKOFF_MS: '6000' });
  // S5's branches, pushed before the dashboard starts
  const mb = (n) => 'x'.repeat(n * 1024 * 1024);
  other.push('bad/symlink', 'bad-link', art('link'), { symlinks: { 'evil.html': '/etc/passwd' } });
  // a gitlink (a submodule) in the folder: final-1 F4
  other.push('bad/sub', 'bad-sub', art('sub'));
  other.g(['update-index', '--add', '--cacheinfo', `160000,${other.g(['rev-parse', 'HEAD']).trim()},${ARTS}/bad-sub/mod`]);
  other.g(['commit', '-qm', 'a submodule']);
  other.g(['push', '-q', '-f', 'origin', 'HEAD:refs/heads/bad/sub']);
  other.push('bad/big', 'bad-big', art('big', { 'big.bin': `${mb(8)}x` }));
  other.push('bad/total', 'bad-total', art('total', { 'a.bin': mb(7), 'b.bin': mb(7), 'c.bin': mb(7), 'd.bin': mb(7) }));
  other.push('bad/noindex', 'bad-noindex', { 'artifact.json': J({ v: 1, title: 'no index', summary: 's', by: 'supervisor' }) });
  other.push('bad/dotfile', 'bad-dot', art('dot', { '.secret': 'x' }));
  other.push('bad/manifest', 'bad-manifest', { 'artifact.json': '{"v": 2}', 'index.html': '<p>x</p>' });
  other.push('ok/cdn', 'cdn-mock', art('cdn', { 'index.html': '<!doctype html><script src="https://cdn.jsdelivr.net/npm/react/umd/react.production.min.js"></script><p>cdn</p>' }));
  F.g(['fetch', '-q', 'origin'], F.old);
  const { B, dash } = await start();
  const before = snapshot(F);
  const stop = demand(B);
  t.after(stop);
  // S1: every fetch's env and argv
  await within(10000, async () => spy.fetches().some((f) => f.end !== null), 'a fetch');
  for (const f of spy.fetches()) {
    assert.equal(f.prompt, '0', 'S1: GIT_TERMINAL_PROMPT=0');
    assert.equal(f.askpass, '', 'S1: GIT_ASKPASS empty');
    assert.equal(f.sshAsk, '', 'S1: SSH_ASKPASS empty');
    assert.match(f.sshCmd, /BatchMode=yes/, 'S1: ssh never prompts');
    assert.equal(fetchArgvOk(f.argv), null, `S1: the design's flags and its two refspecs, nothing else (${f.argv})`);
  }
  // S5: each broken branch listed broken and never served; an unpinned CDN served, as a landed one is
  const arts = await within(10000, async () => { const a = await library(B); return row(a, 'cdn-mock', 'origin:ok/cdn') && a; }, 'the branches listed');
  for (const [slug, branch, files] of [['bad-link', 'bad/symlink', ['', 'index.html', 'evil.html']], ['bad-big', 'bad/big', ['', 'index.html', 'big.bin']], ['bad-total', 'bad/total', ['', 'index.html', 'a.bin']], ['bad-noindex', 'bad/noindex', ['', 'artifact.json']], ['bad-dot', 'bad/dotfile', ['', 'index.html', '.secret']], ['bad-manifest', 'bad/manifest', ['', 'index.html']]]) {
    const r = row(arts, slug, `origin:${branch}`);
    assert.ok(r, `S5: ${slug} listed`);
    assert.ok(r.error, `S5: ${slug} listed broken`);
    for (const f of files) assert.equal((await bytes(B, `/artifact/origin/${encodeURIComponent(branch)}/${slug}/${f}`)).status, 404, `S5: ${slug}/${f} not served`);
  }
  const sub = row(arts, 'bad-sub', 'origin:bad/sub');
  assert.match(sub?.error ?? '', /a submodule isn't served/, 'S5: a submodule listed broken');
  for (const f of ['', 'index.html', 'mod']) assert.equal((await bytes(B, `/artifact/origin/bad%2Fsub/bad-sub/${f}`)).status, 404, `S5: bad-sub/${f} not served`);
  const view = await (await fetch(`${B}/api/view?kind=artifact&slug=bad-sub&at=${encodeURIComponent('origin:bad/sub')}`, { headers: { 'sec-fetch-site': 'same-origin' } })).json();
  assert.match(JSON.stringify(view), /a submodule isn't served/, `F4: the viewer says why (${JSON.stringify(view).slice(0, 200)})`);
  assert.equal(row(arts, 'cdn-mock', 'origin:ok/cdn').error, null, 'S5: a CDN warning is no error');
  assert.equal((await bytes(B, '/artifact/origin/ok%2Fcdn/cdn-mock/')).status, 200, 'S5: served, as a landed one is');
  // S6: bad at values
  for (const at of ['origin:../x', 'origin:a//b', 'origin:a.lock', 'origin:@{u}', 'origin:a/.b', `origin:${'b'.repeat(201)}`, 'origin:', 'origin:/x', 'origin:x/']) {
    assert.equal((await bytes(B, `/view/artifact/cdn-mock?at=${encodeURIComponent(at)}`)).status, 404, `S6: /view/artifact at ${at}`);
    assert.equal((await fetch(`${B}/api/artifact-fp?${new URLSearchParams({ slug: 'cdn-mock', at })}`)).status, 400, `S6: /api/artifact-fp at ${at}`);
    assert.equal((await bytes(B, `/artifact/origin/${encodeURIComponent(at.slice(7))}/cdn-mock/`)).status, 404, `S6: /artifact/origin/ at ${at}`);
  }
  // S4: refs only, across fetches that brought main and branches
  other.push('main', 'main-mock', art('main'));
  other.push('ok/cdn', 'cdn-mock', art('cdn 2'));
  await within(10000, async () => row(await library(B), 'main-mock', 'main'), 'main moved');
  assert.deepEqual(snapshot(F), before, 'S4: no worktree, local branch, tag, index, HEAD, file or remote-tracking ref but origin/main changed');
  assert.match(refsIn(F, 'refs/devteam-remote'), /refs\/devteam-remote\/ok\/cdn /, "S4: branches under the kit's own namespace");
  assert.equal(F.g(['rev-parse', 'refs/remotes/origin/main'], F.old), F.g(['rev-parse', 'origin/main'], other.dir), 'S4: origin/main moved to the push');
  // S2: a hung fetch's whole group is killed at the timeout (plus the 2 s grace); never two at once
  const n0 = spy.fetches().length;
  spy.hang(true);
  const hung = await within(5000, async () => spy.fetches().slice(n0).find((f) => f.hang), 'S2: a hung fetch');
  await within(2000 + 2000 + 1000 + 1000, async () => !alive(hung.hang.pid), "S2: the hung fetch's child killed with it");
  const st = await within(3000, async () => { const s = await remoteStatus(B); return s.stale === true && s; }, 'S3: stale said');
  assert.equal(spy.fetches().slice(n0).length, 1, 'S2: no second fetch while one runs or before the back-off');
  assert.equal(st.ok, false, 'S3: the last fetch failed');
  assert.ok(typeof st.error === 'string' && st.error.length > 0 && st.error.length <= 300, 'S3: a short error');
  assert.ok(Date.parse(st.fetched_at) - hung.start <= 2000 + 2000 + 1000, `S2: ended within timeout + grace (${Date.parse(st.fetched_at) - hung.start} ms)`);
  // S3: the next fetch waits for the back-off, then succeeds and stale clears
  spy.hang(false);
  const next = await within(15000, async () => spy.fetches().slice(n0)[1], 'S3: the fetch after the back-off');
  assert.ok(next.start - Date.parse(st.fetched_at) >= 6000 - 200, `S3: backed off (${next.start - Date.parse(st.fetched_at)} ms after the failure)`);
  const all = spy.fetches();
  for (let i = 1; i < all.length; i++) assert.ok(all[i].start >= (all[i - 1].end ?? Date.parse(st.fetched_at)), `S2: fetch ${i} began before ${i - 1} ended (${JSON.stringify([all[i - 1], all[i]].map((f) => ({ start: f.start, end: f.end, hang: f.hang?.at ?? null })))}, failed at ${st.fetched_at})`);
  await within(5000, async () => { const s = await remoteStatus(B); return s.stale === false && s.ok === true; }, 'S3: stale cleared');
  // S7: a cross-site ask refused
  assert.equal((await fetch(`${B}/api/artifact-remote`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, 'S7: a cross-site read');
  for (const h of [{ 'sec-fetch-site': 'cross-site' }, { origin: 'http://evil.example' }, { 'content-type': 'text/plain' }]) assert.equal((await askRemote(B, h)).status, 403, `S7: a POST refused (${JSON.stringify(h)})`);
  // the body is {} and nothing else (final-1 F2)
  for (const body of ['{"x":1}', '[]', '', 'hello', `{}${' '.repeat(100)}`]) assert.equal((await askRemote(B, {}, body)).status, 403, `S7: a POST with the body ${JSON.stringify(body.slice(0, 12))} refused`);
  assert.equal((await askRemote(B)).status, 200, 'S7: the page\'s {} still taken');
  // S2 at exit: a fetch under way when the dashboard ends is sent SIGTERM, so git removes its own
  // locks, never a bare SIGKILL (task-2 F1)
  const n1 = spy.fetches().length;
  spy.hang(true);
  const last = await within(5000, async () => spy.fetches().slice(n1).find((f) => f.hang), 'S2: a fetch under way at exit');
  await dash.stop();
  await within(3000, async () => spy.fetches().find((f) => f.start === last.start)?.term, 'S2: the fetch under way at exit got SIGTERM');
  spy.hang(false);
});

test('artifact remote safe: with no origin remote nothing is fetched, and the route says so', { timeout: 120000 }, async (t) => {
  const { F, spy, start } = await setup(t, 'remote-none');
  F.g(['remote', 'remove', 'origin'], F.old);
  const { B } = await start();
  const stop = demand(B);
  t.after(stop);
  const s = await within(5000, async () => { const r = await getJson(B, '/api/artifact-remote'); return r.status === 200 && r.body; }, 'S7: an answer');
  assert.equal(s.remote, false, 'S7: no remote');
  await sleep(INT * 3);
  assert.deepEqual(spy.fetches(), [], 'S7: never fetched');
});

// kit-752: a question links an artifact as it did before kit-750. A branch fetched from origin into
// refs/devteam-remote/* is a draft the Library shows, never a question's: `ask --links` with no "at"
// picks main's copy, then this machine's worktrees', never the remote draft and never failing because
// of it; "at": "origin:<branch>" is refused in plain words before any line is written (ruling
// a-20261122-082323258-supervisor). No dashboard: the fetch is the dashboard's own refspec, by hand.
test('artifact remote cli: ask --links with no at never picks a draft fetched from origin, and an origin: at is refused', { timeout: 120000 }, async (t) => {
  const { F, other } = await setup(t, 'remote-cli');
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  other.push('main', 'on-main', art('on main v1'));
  F.g(['pull', '-q', 'origin', 'main'], F.old);
  // a draft in this machine's worktree, never landed
  const wt = path.join(F.old, '.worktrees', 'bill-01-card');
  F.g(['worktree', 'add', '-q', '-b', 'ticket/bill-01-card', wt], F.old);
  for (const [rel, text] of Object.entries(art('wt only'))) write(path.join(wt, ARTS, 'wt-only', rel), text);
  // another machine's branches: one changes on-main, one changes wt-only, one adds far-only
  other.push('ticket/far-01', 'on-main', art('on main, far draft'));
  other.push('ticket/far-02', 'wt-only', art('wt only, far draft'));
  other.push('ticket/far-03', 'far-only', art('far only'));
  F.g(['fetch', '-q', '--no-tags', '--refmap=', 'origin', '+refs/heads/*:refs/devteam-remote/*'], F.old);
  const rows = JSON.parse(F.ok(F.old, ['artifacts', '--json'], SUP));
  const fp = (slug, at) => rows.find((a) => a.slug === slug && a.at === at)?.fp;
  assert.ok(fp('on-main', 'origin:ticket/far-01'), 'setup: the fetched branch is a draft the kit lists (kit-750)');
  assert.ok(fp('far-only', 'origin:ticket/far-03'), 'setup: the fetched new artifact is listed too');
  const ask = (link) => F.run(F.old, ['ask', '--kind', 'owner-decision', '--question', 'Is [[m]] right?', '--options', 'Yes', 'No', '--recommendation', 'Yes', '--stake', '1', '--urgency', '1', '--links', JSON.stringify([{ name: 'm', title: 'Mock', ...link }])], SUP);
  const linkOf = (r, what) => { assert.equal(r.status, 0, `${what}: ask exits 0 (${r.err})`); return JSON.parse(F.ok(F.old, ['log', '--id', r.out.trim().split('\n')[0], '--json'], SUP))[0].links[0]; };
  const questions = () => JSON.parse(F.ok(F.old, ['log', '--json'], SUP)).filter((x) => x.type === 'question').length;
  // C1: on main and changed on a fetched branch, no at: main, as before kit-750
  const c1 = linkOf(ask({ artifact: 'on-main' }), 'C1');
  assert.deepEqual([c1.at, c1.sha256], ['main', fp('on-main', 'main')], 'C1: no at picks main, never the remote draft');
  // C2: only in a worktree here and changed on a fetched branch, no at: the worktree, as before
  const c2 = linkOf(ask({ artifact: 'wt-only' }), 'C2');
  assert.deepEqual([c2.at, c2.sha256], ['bill-01-card', fp('wt-only', 'bill-01-card')], 'C2: no at picks the worktree draft');
  // C3: at names a remote draft: refused in plain words, before any line is written
  const n = questions();
  const c3 = ask({ artifact: 'on-main', at: 'origin:ticket/far-01' });
  assert.match(c3.err, /artifact "on-main" in origin:ticket\/far-01 is a draft from another machine, which a question can't link: check its branch out in a worktree here, or merge it to main, first/, 'C3: an origin: at is refused in plain words');
  assert.equal(c3.status, 1, 'C3: and ask fails');
  assert.equal(questions(), n, 'C3: no question line written');
  // C3b: the guard is on the at, not on a row: a remote row a worktree draft hides, and a branch never fetched
  const c3b = ask({ artifact: 'wt-only', at: 'origin:ticket/far-02' });
  assert.match(c3b.err, /artifact "wt-only" in origin:ticket\/far-02 is a draft from another machine, which a question can't link/, 'C3b: an origin: at hidden by a worktree draft is refused the same way');
  const c3c = ask({ artifact: 'on-main', at: 'origin:ticket/never' });
  assert.match(c3c.err, /artifact "on-main" in origin:ticket\/never is a draft from another machine, which a question can't link/, 'C3c: an origin: at never fetched is refused the same way');
  assert.equal(questions(), n, 'C3b, C3c: no question line written');
  // C4: only on a fetched branch, no at: never picked, refused the same way
  const c4 = ask({ artifact: 'far-only' });
  assert.match(c4.err, /artifact "far-only" in origin:ticket\/far-03 is a draft from another machine, which a question can't link/, 'C4: a remote-only draft is never picked');
  assert.equal(c4.status, 1, 'C4: and ask fails');
  // C4b: only on a fetched branch, at naming a place here: the same refusal, never an empty "it is in"
  const c4b = ask({ artifact: 'far-only', at: 'main' });
  assert.match(c4b.err, /artifact "far-only" in origin:ticket\/far-03 is a draft from another machine, which a question can't link/, 'C4b: a remote-only draft named at main is refused the same way');
  assert.equal(questions(), n, 'C4, C4b: no question line written');
});
