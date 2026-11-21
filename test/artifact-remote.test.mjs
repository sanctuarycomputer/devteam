// The Library shows pushes from other machines (kit-750): while the Library or a viewer is open, the
// dashboard fetches origin (main into refs/remotes/origin/<main>, every branch into the kit's own
// refs/devteam-remote/*) at most once an interval, one fetch at a time, bounded, backing off after a
// failure; an artifact pushed to origin's main shows and an open viewer of it reloads, and an origin
// branch that changes project/artifacts/<slug>/ against main shows as a draft from another machine,
// served from that ref's tree after the artifact checks. A real dashboard on a fleet fixture whose
// origin is a bare repo; "the other machine" is a second clone that pushes. A git shim on the
// dashboard's PATH logs every fetch (time, env, argv, exit) and can make one hang. Intervals are
// shortened by DEVTEAM_ARTIFACT_FETCH_MS / _BACKOFF_MS / _TIMEOUT_MS; one case reads the defaults.
// Chrome cases skip where Chrome can't be driven, as the kit's other Chrome tests do.
// Ports: none of its own (lib/kit.mjs's freePort)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { write, dashboardOnFreePort, fleetFixture, REAL_GIT } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const J = JSON.stringify;
const ARTS = 'docs/devteam/project/artifacts';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INT = 1500;

const art = (title, extra = {}) => ({
  'artifact.json': J({ v: 1, title, summary: `${title}, a page`, by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><head><title>${title}</title></head><body><p id="t">${title}</p></body></html>`,
  ...extra,
});

// A git on the dashboard's PATH: every fetch logged as `<ms> start <cwd>|<prompt>|<askpass>|<ssh askpass>|<ssh command>|<argv>`
// and `<ms> end <status>`; with <dir>/hang present a fetch logs `<ms> hang` and becomes a 60 s sleep.
function spyGit(F) {
  const dir = path.join(F.base, 'git-spy');
  const log = path.join(dir, 'fetch.log');
  write(path.join(dir, 'git'), `#!/bin/sh
if [ "$1" = fetch ]; then
  printf '%s start %s|%s|%s|%s|%s|%s\\n' "$(date +%s%3N)" "$PWD" "\${GIT_TERMINAL_PROMPT-unset}" "\${GIT_ASKPASS-unset}" "\${SSH_ASKPASS-unset}" "\${GIT_SSH_COMMAND-unset}" "$*" >> "${log}"
  if [ -f "${dir}/hang" ]; then printf '%s hang\\n' "$(date +%s%3N)" >> "${log}"; exec sleep 60; fi
  "${REAL_GIT}" "$@"; s=$?
  printf '%s end %s\\n' "$(date +%s%3N)" "$s" >> "${log}"
  exit $s
fi
exec "${REAL_GIT}" "$@"
`);
  fs.chmodSync(path.join(dir, 'git'), 0o755);
  const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  const fetches = () => {
    const res = [];
    for (const l of lines()) {
      const m = /^(\d+) (start|end|hang) ?(.*)$/.exec(l);
      if (!m) continue;
      if (m[2] === 'start') {
        const [cwd, prompt, askpass, sshAsk, sshCmd, argv] = m[3].split('|');
        res.push({ start: Number(m[1]), end: null, status: null, hang: false, cwd, prompt, askpass, sshAsk, sshCmd, argv });
      } else if (res.length) {
        const f = res[res.length - 1];
        if (m[2] === 'hang') f.hang = true; else { f.end = Number(m[1]); f.status = Number(m[3]); }
      }
    }
    return res;
  };
  return { env: { PATH: `${dir}${path.delimiter}${process.env.PATH}` }, fetches, hang: (on) => (on ? write(path.join(dir, 'hang'), '') : fs.rmSync(path.join(dir, 'hang'), { force: true })) };
}

// The other machine: a clone of origin that pushes artifacts to main or a branch.
function otherMachine(F) {
  const dir = path.join(F.base, 'other');
  F.g(['clone', '-q', F.org, dir], F.base);
  for (const [k, v] of [['user.email', 'o@o'], ['user.name', 'o']]) F.g(['config', k, v], dir);
  const g = (args) => F.g(args, dir);
  return {
    dir,
    // a commit on <branch> (from <from>, origin's main by default, when the branch is new) putting files under
    // <slug>, then pushed; extra: { rel: null } deletes a file, symlinks: { rel: target }
    push(branch, slug, files, { from = 'origin/main', symlinks = {} } = {}) {
      g(['fetch', '-q', 'origin']);
      const has = (() => { try { g(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`]); return true; } catch { return false; } })();
      g(['checkout', '-q', '-B', branch, has ? `origin/${branch}` : from]);
      const folder = path.join(dir, ARTS, slug);
      for (const [rel, text] of Object.entries(files)) {
        if (text === null) fs.rmSync(path.join(folder, rel), { force: true }); else write(path.join(folder, rel), text);
      }
      for (const [rel, target] of Object.entries(symlinks)) { fs.mkdirSync(folder, { recursive: true }); fs.symlinkSync(target, path.join(folder, rel)); }
      g(['add', '-A', ARTS]);
      g(['commit', '-qm', `${slug} on ${branch}`]);
      g(['push', '-q', '-f', 'origin', `HEAD:refs/heads/${branch}`]);
      return g(['rev-parse', `HEAD:${ARTS}/${slug}`]);
    },
    del(branch) { g(['push', '-q', 'origin', `:refs/heads/${branch}`]); },
  };
}

const getJson = async (B, route) => { const r = await fetch(`${B}${route}`); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
const library = async (B) => { const r = await fetch(`${B}/api/data`); assert.equal(r.status, 200, '/api/data'); return (await r.json()).library.artifacts; };
const row = (arts, slug, at) => arts.find((a) => a.slug === slug && a.at === at) ?? null;
const bytes = async (B, route) => { const r = await fetch(`${B}${route}`); return { status: r.status, text: await r.text() }; };
// until f() is truthy, polling every 250 ms, for at most ms
async function within(ms, f, what) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try { last = await f(); } catch (e) { last = e; }
    if (last && !(last instanceof Error)) return last;
    if (Date.now() > end) assert.fail(`not within ${ms} ms: ${what}${last instanceof Error ? ` (last: ${last.message})` : ''}`);
    await sleep(250);
  }
}
// The Library's ask, as the page makes it while the Library is shown: every 250 ms until stopped.
function demand(B) {
  let on = true;
  (async () => { while (on) { try { await (await fetch(`${B}/api/artifact-remote`, { headers: { 'sec-fetch-site': 'same-origin' } })).text(); } catch {} await sleep(250); } })();
  return () => { on = false; };
}
const snapshot = (F) => ({
  heads: F.g(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags'], F.old),
  worktrees: F.g(['worktree', 'list', '--porcelain'], F.old),
  status: F.g(['status', '--porcelain', '--untracked-files=all'], F.old),
  head: F.g(['rev-parse', 'HEAD'], F.old),
  index: F.g(['ls-files', '-s'], F.old),
  dirs: fs.readdirSync(F.old).sort().join(','),
});
const refsIn = (F, ns) => F.g(['for-each-ref', '--format=%(refname) %(objectname)', ns], F.old);

async function setup(t, name, env = {}) {
  const later = cleanup(t);
  const F = fleetFixture(name);
  later(() => F.done());
  const spy = spyGit(F);
  const other = otherMachine(F);
  const start = async (extra = {}) => {
    const { dash, port } = await dashboardOnFreePort(F.old, { ...F.env({}), ...spy.env, DEVTEAM_ARTIFACT_FETCH_MS: String(INT), ...env, ...extra });
    later(() => dash.stop());
    return { dash, B: `http://127.0.0.1:${port}` };
  };
  return { F, spy, other, start, later };
}

test('artifact remote main: fetched at most once an interval while asked for, none while nothing is open; a push to main shows', { timeout: 300000 }, async (t) => {
  const { F, spy, other, start } = await setup(t, 'remote-main');
  const { B } = await start();
  // M1: nothing open, nothing fetched
  await sleep(INT * 3 + 500);
  assert.deepEqual(spy.fetches(), [], 'M1: no fetch while no Library or viewer is open');
  // M2 + M3: the Library open; a push to origin's main from the other machine shows
  const stop = demand(B);
  t.after(stop);
  other.push('main', 'remote-main', art('v1'));
  await within(INT + 5000, async () => row(await library(B), 'remote-main', 'main'), 'M3: the pushed artifact in the Library at main');
  const served = await bytes(B, '/artifact/main/remote-main/');
  assert.equal(served.status, 200, 'M3: served from main');
  assert.match(served.text, /<title>v1<\/title>/, 'M3: the pushed bytes');
  await sleep(INT * 4);
  const fs1 = spy.fetches();
  assert.ok(fs1.length >= 3, `M2: one fetch per interval while asked for (${fs1.length})`);
  for (let i = 1; i < fs1.length; i++) assert.ok(fs1[i].start - fs1[i - 1].start >= INT - 100, `M2: fetches ${i - 1} and ${i} ${fs1[i].start - fs1[i - 1].start} ms apart, under the interval`);
  for (const f of fs1) assert.equal(f.cwd, fs.realpathSync(F.old), 'M2: in the checkout');
  // demand gone: the fetches stop within one interval and the 5 s window
  stop();
  await sleep(INT + 6000);
  const n = spy.fetches().length;
  await sleep(INT * 3);
  assert.equal(spy.fetches().length, n, 'M1: no fetch once the Library closed');
});

test('artifact remote main: the defaults are a 30 s cadence and a 5 min back-off', { timeout: 120000 }, async (t) => {
  const { F, start } = await setup(t, 'remote-defaults');
  const { B } = await start({ DEVTEAM_ARTIFACT_FETCH_MS: '' });
  const stop = demand(B);
  t.after(stop);
  const ok = await within(30000, async () => { const r = await getJson(B, '/api/artifact-remote'); return r.status === 200 && r.body.fetched_at && r.body; }, 'a first fetch');
  assert.equal(ok.ok, true);
  assert.equal(ok.stale, false);
  assert.ok(Math.abs(Date.parse(ok.next_at) - Date.parse(ok.fetched_at) - 30000) < 1500, `next fetch 30 s after the last (${ok.next_at} vs ${ok.fetched_at})`);
  // origin unreachable: the next fetch fails, and the one after waits 5 min
  F.g(['remote', 'set-url', 'origin', path.join(F.base, 'nowhere.git')], F.old);
  const bad = await within(40000, async () => { const r = await getJson(B, '/api/artifact-remote'); return r.body.ok === false && r.body; }, 'a failed fetch');
  assert.equal(bad.stale, true);
  assert.ok(Math.abs(Date.parse(bad.next_at) - Date.parse(bad.fetched_at) - 300000) < 1500, `back-off 5 min (${bad.next_at} vs ${bad.fetched_at})`);
  assert.ok(typeof bad.error === 'string' && bad.error.length > 0 && bad.error.length <= 300, 'a short error');
});

test('artifact remote drafts: an origin branch that changes an artifact shows as a draft from another machine, served from its ref', { timeout: 300000 }, async (t) => {
  const { F, spy, other, start } = await setup(t, 'remote-drafts');
  // landed-one on main, and a branch from that main which never touches it
  other.push('main', 'landed-one', art('landed v1'));
  other.push('ticket/old-base', 'own-mock', art('own'));
  other.push('main', 'landed-one', art('landed v2'));
  F.g(['pull', '-q', 'origin', 'main'], F.old);
  const { B } = await start();
  const stop = demand(B);
  t.after(stop);
  const before = snapshot(F);
  // D1
  const tree = other.push('ticket/far-01', 'far-mock', art('far v1', { 'style.css': 'p { color: red }' }));
  const r1 = await within(INT + 5000, async () => row(await library(B), 'far-mock', 'origin:ticket/far-01'), 'D1: the branch draft listed');
  assert.equal(r1.branch, 'ticket/far-01', 'D1: labelled with its branch');
  assert.equal(r1.remote, true, 'D1: from another machine');
  assert.equal(r1.error, null, 'D1: no error');
  assert.equal(r1.title, 'far v1');
  const page = await bytes(B, '/artifact/origin/ticket%2Ffar-01/far-mock/');
  assert.equal(page.status, 200, 'D1: served');
  assert.equal(page.text, F.g(['cat-file', 'blob', `${tree}:index.html`], other.dir) , 'D1: the branch blob, byte for byte');
  assert.equal((await bytes(B, '/artifact/origin/ticket%2Ffar-01/far-mock/style.css')).text, 'p { color: red }', 'D1: its other files');
  // D2: never a checkout
  assert.deepEqual(snapshot(F), before, 'D2: no worktree, branch, index or file of the checkout changed');
  const found = spawnFind(F.old, 'far-mock');
  assert.deepEqual(found, [], 'D2: no far-mock folder on disk');
  // D3: a branch from an old main is no draft of what main changed since
  const arts = await library(B);
  assert.equal(arts.filter((a) => a.slug === 'landed-one' && a.at !== 'main').length, 0, 'D3: landed-one has no remote draft');
  assert.ok(row(arts, 'own-mock', 'origin:ticket/old-base'), 'D3: the old branch\'s own artifact is');
  // D4: a second push refreshes it
  const fp1 = r1.fp;
  other.push('ticket/far-01', 'far-mock', art('far v2'));
  const r2 = await within(INT + 5000, async () => { const x = row(await library(B), 'far-mock', 'origin:ticket/far-01'); return x && x.fp !== fp1 && x; }, 'D4: the new commit listed');
  assert.equal(r2.title, 'far v2');
  assert.match((await bytes(B, '/artifact/origin/ticket%2Ffar-01/far-mock/')).text, /far v2/, 'D4: the new bytes');
  // D6: a local worktree's draft of the same slug wins, and says so
  const wt = path.join(F.old, '.worktrees/far-01', ARTS, 'far-mock');
  for (const [rel, text] of Object.entries(art('local'))) write(path.join(wt, rel), text);
  const r6 = await within(10000, async () => row(await library(B), 'far-mock', 'far-01'), 'D6: the local draft');
  assert.deepEqual(r6.remote_branches, ['ticket/far-01'], 'D6: the local row names the remote draft it hides');
  assert.equal(row(await library(B), 'far-mock', 'origin:ticket/far-01'), null, 'D6: no remote row beside it');
  fs.rmSync(path.join(F.old, '.worktrees'), { recursive: true, force: true });
  // D5: deleted on origin, gone after the next fetch
  await within(10000, async () => row(await library(B), 'far-mock', 'origin:ticket/far-01'), 'D5: back once the local draft went');
  other.del('ticket/far-01');
  await within(INT + 5000, async () => !row(await library(B), 'far-mock', 'origin:ticket/far-01'), 'D5: dropped');
  assert.equal((await bytes(B, '/artifact/origin/ticket%2Ffar-01/far-mock/')).status, 404, 'D5: no longer served');
  assert.doesNotMatch(refsIn(F, 'refs/devteam-remote'), /far-01/, 'D5: its ref pruned');
  assert.ok(spy.fetches().length >= 1);
});

// every directory under root, outside .git, named name
function spawnFind(root, name) {
  const res = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (!e.isDirectory() || e.name === '.git') continue; const p = path.join(d, e.name); if (e.name === name) res.push(p); walk(p); } };
  walk(root);
  return res;
}

test('artifact remote safe: bounded, one at a time, backs off and says so, refs only, checked before serving', { timeout: 300000 }, async (t) => {
  const { F, spy, other, start } = await setup(t, 'remote-safe', { DEVTEAM_ARTIFACT_FETCH_MS: '1000', DEVTEAM_ARTIFACT_FETCH_TIMEOUT_MS: '2000', DEVTEAM_ARTIFACT_FETCH_BACKOFF_MS: '6000' });
  // S5's branches, pushed before the dashboard starts
  const big = 'x'.repeat(8 * 1024 * 1024 + 1);
  other.push('bad/symlink', 'bad-link', art('link'), { symlinks: { 'evil.html': '/etc/passwd' } });
  other.push('bad/big', 'bad-big', art('big', { 'big.bin': big }));
  other.push('bad/noindex', 'bad-noindex', { 'artifact.json': J({ v: 1, title: 'no index', summary: 's', by: 'supervisor' }) });
  other.push('bad/dotfile', 'bad-dot', art('dot', { '.secret': 'x' }));
  other.push('bad/manifest', 'bad-manifest', { 'artifact.json': '{"v": 2}', 'index.html': '<p>x</p>' });
  other.push('ok/cdn', 'cdn-mock', art('cdn', { 'index.html': '<!doctype html><script src="https://cdn.jsdelivr.net/npm/react/umd/react.production.min.js"></script><p>cdn</p>' }));
  const { B } = await start();
  const before = snapshot(F);
  const headsBefore = refsIn(F, 'refs/heads');
  const stop = demand(B);
  t.after(stop);
  // S1: every fetch's env and argv
  await within(5000, async () => spy.fetches().some((f) => f.end !== null), 'a fetch');
  for (const f of spy.fetches()) {
    assert.equal(f.prompt, '0', 'S1: GIT_TERMINAL_PROMPT=0');
    assert.equal(f.askpass, '', 'S1: GIT_ASKPASS empty');
    assert.equal(f.sshAsk, '', 'S1: SSH_ASKPASS empty');
    assert.match(f.sshCmd, /BatchMode=yes/, 'S1: ssh never prompts');
    assert.equal(f.argv, 'fetch --quiet --no-tags --prune origin +refs/heads/main:refs/remotes/origin/main +refs/heads/*:refs/devteam-remote/*', 'S1: the two refspecs, nothing else');
  }
  // S5: each broken branch listed broken and never served; an unpinned CDN served with its warning, as a landed one is
  const arts = await within(5000, async () => { const a = await library(B); return row(a, 'cdn-mock', 'origin:ok/cdn') && a; }, 'the branches listed');
  for (const [slug, branch, files] of [['bad-link', 'bad/symlink', ['', 'index.html', 'evil.html']], ['bad-big', 'bad/big', ['', 'big.bin']], ['bad-noindex', 'bad/noindex', ['', 'artifact.json']], ['bad-dot', 'bad/dotfile', ['', '.secret']], ['bad-manifest', 'bad/manifest', ['', 'index.html']]]) {
    const r = row(arts, slug, `origin:${branch}`);
    assert.ok(r, `S5: ${slug} listed`);
    assert.ok(r.error, `S5: ${slug} listed broken`);
    for (const f of files) assert.equal((await bytes(B, `/artifact/origin/${encodeURIComponent(branch)}/${slug}/${f}`)).status, 404, `S5: ${slug}/${f} not served`);
  }
  assert.equal(row(arts, 'cdn-mock', 'origin:ok/cdn').error, null, 'S5: a CDN warning is no error');
  assert.equal((await bytes(B, '/artifact/origin/ok%2Fcdn/cdn-mock/')).status, 200, 'S5: served, as a landed one is');
  // S6: bad at values
  for (const at of ['origin:../x', 'origin:a//b', 'origin:a.lock', 'origin:@{u}', `origin:${'b'.repeat(201)}`, 'origin:', 'origin:/x', 'origin:x/']) {
    assert.equal((await bytes(B, `/view/artifact/cdn-mock?at=${encodeURIComponent(at)}`)).status, 404, `S6: /view/artifact at ${at}`);
    assert.equal((await fetch(`${B}/api/artifact-fp?${new URLSearchParams({ slug: 'cdn-mock', at })}`)).status, 400, `S6: /api/artifact-fp at ${at}`);
    assert.equal((await bytes(B, `/artifact/origin/${encodeURIComponent(at.slice(7))}/cdn-mock/`)).status, 404, `S6: /artifact/origin/ at ${at}`);
  }
  // S4: refs only, across fetches that brought main and branches
  other.push('main', 'main-mock', art('main'));
  await within(5000, async () => row(await library(B), 'main-mock', 'main'), 'main moved');
  const after = snapshot(F);
  assert.deepEqual(after, before, 'S4: no worktree, local branch, index, HEAD or file changed');
  assert.equal(refsIn(F, 'refs/heads'), headsBefore, 'S4: local branches as they were');
  assert.match(refsIn(F, 'refs/devteam-remote'), /refs\/devteam-remote\/ok\/cdn /, 'S4: branches under the kit\'s own namespace');
  assert.equal(F.g(['rev-parse', 'refs/remotes/origin/main'], F.old), F.g(['rev-parse', 'HEAD'], other.dir), 'S4: origin/main moved to the push');
  // S2: a hung fetch is killed at the timeout; never two at once
  const n0 = spy.fetches().length;
  spy.hang(true);
  const hung = await within(3000, async () => spy.fetches().slice(n0).find((f) => f.hang), 'S2: a hung fetch');
  await sleep(3500);
  assert.equal(spy.fetches().slice(n0).length, 1, 'S2: no second fetch while one runs or before the back-off');
  const st = await within(3000, async () => { const r = await getJson(B, '/api/artifact-remote'); return r.body.stale === true && r.body; }, 'S3: stale said');
  assert.equal(st.ok, false, 'S3: the last fetch failed');
  assert.ok(st.error, 'S3: with why');
  assert.ok(Date.parse(st.fetched_at) - hung.start <= 2000 + 2000, `S2: killed within timeout + 2 s (${Date.parse(st.fetched_at) - hung.start} ms)`);
  // S3: the next fetch waits for the back-off, then succeeds and stale clears
  spy.hang(false);
  const next = await within(12000, async () => spy.fetches().slice(n0)[1], 'S3: the fetch after the back-off');
  assert.ok(next.start - hung.start >= 2000 + 6000 - 500, `S3: backed off (${next.start - hung.start} ms after the hung one)`);
  for (let i = 1; i < spy.fetches().length; i++) { const [a, b] = [spy.fetches()[i - 1], spy.fetches()[i]]; if (a.end !== null) assert.ok(b.start >= a.end, 'S2: never two at once'); }
  await within(5000, async () => { const r = await getJson(B, '/api/artifact-remote'); return r.body.stale === false && r.body.ok === true; }, 'S3: stale cleared');
  // cross-site asks refused; no origin remote says so
  assert.equal((await fetch(`${B}/api/artifact-remote`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, 'a cross-site ask');
});

// ----- in Chrome: the viewer reloads by itself on main, the Library's cards and sentences -----
const PAGE = `(() => {
  window.__titles = [];
  addEventListener('message', (e) => { const fr = document.getElementById('av-frame'); if (fr && e.source === fr.contentWindow && e.data?.lens === 1 && e.data.type === 'ready') window.__titles.push(e.data.title); });
})();`;

test('artifact remote main: in Chrome, an open viewer reloads to a push and the Library shows new cards, drafts and stale', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 600000 }, async (t) => {
  const { F, spy, other, start, later } = await setup(t, 'remote-chrome', { DEVTEAM_ARTIFACT_FETCH_BACKOFF_MS: '8000', DEVTEAM_ARTIFACT_FETCH_TIMEOUT_MS: '2000' });
  other.push('main', 'remote-main', art('v1'));
  F.g(['pull', '-q', 'origin', 'main'], F.old);
  const { B } = await start();
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE });
  const soon = async (ms, expr, what) => within(ms, async () => p.ev(expr), what);
  // M4: a viewer on main, a push of v2 to origin's main, the frame on v2 with no click
  await p.send('Page.navigate', { url: `${B}/view/artifact/remote-main` });
  await soon(30000, `window.__titles.includes('v1')`, 'M4: v1 framed');
  other.push('main', 'remote-main', art('v2'));
  await soon(INT + 10000 + 12000, `window.__titles.includes('v2')`, 'M4: the viewer reloaded to v2 by itself');
  // M5 + D7: the Library, a new landed card and a draft from another machine, without a reload of the page
  await p.send('Page.navigate', { url: `${B}/#library` });
  await soon(30000, `typeof PAGE_NOW === 'string' && PAGE_NOW === 'library' && !!document.querySelector('[data-lib-id="artifact:remote-main"]')`, 'the Library');
  await p.ev('(window.__loaded = true)');
  other.push('main', 'new-card', art('New card'));
  other.push('ticket/far-02', 'far-card', art('Far card'));
  await soon(INT + 15000, `!!document.querySelector('[data-lib-id="artifact:new-card"]')`, 'M5: the pushed card');
  const card = await soon(INT + 15000, `(() => { const c = document.querySelector('[data-lib-id="artifact:far-card"]'); return c && c.textContent; })()`, 'D7: the draft card');
  assert.match(card, /from another machine/, 'D7: says it is from another machine');
  assert.match(card, /ticket\/far-02/, 'D7: names its branch');
  assert.equal(await p.ev('window.__loaded === true'), true, 'no reload of the page');
  // D6: a local worktree draft of the same slug wins and says so
  for (const [rel, text] of Object.entries(art('Local far'))) write(path.join(F.old, '.worktrees/far-02', ARTS, 'far-card', rel), text);
  const local = await soon(30000, `(() => { const c = document.querySelector('[data-lib-id="artifact:far-card"]'); return c && /also pushed from another machine on ticket\\/far-02/.test(c.textContent) && c.textContent; })()`, 'D6: the local card says so');
  assert.match(local, /far-02/);
  // S3: a failing fetch puts the stale sentence at the Library's top, and a good one takes it away
  spy.hang(true);
  await soon(20000, `/Drafts from other machines may be out of date/.test(document.getElementById('lib-top').textContent) && !document.getElementById('lib-top').hidden`, 'S3: stale said in the Library');
  spy.hang(false);
  await soon(30000, `!/Drafts from other machines may be out of date/.test(document.getElementById('lib-top').textContent)`, 'S3: stale gone after a good fetch');
});
