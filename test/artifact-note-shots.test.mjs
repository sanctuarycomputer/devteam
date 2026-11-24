// The kit's own picture of an artifact note's spot (kit-147): what thread ready takes and records, who
// may withdraw a mark, the page's frame, the /api/shot/ route, and which copy of the artifact is pictured.
// Each test is named by its check in the ticket's spec. Real Chrome, over the kit's DevTools pipe: this
// file never skips, and fails its first test when the machine has none.
// Run: node --test test/artifact-note-shots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';
import { dashboardOnFreePort, kit, testDir, until, write } from './lib/kit.mjs';
import { LENS, MARKERS, SRC, TMP, addressed, body, count, cut, each, fake, pageNote, png, region, said, seenFile, sha256, shotKit, worktree } from './fixtures/artifact-shots/kit.mjs';

test('C1c every test runs, and the file fails with no Chrome', () => {
  assert.ok(chromePath, 'no Chrome: install Chrome or Chromium, or set CHROME_PATH');
  const own = ['artifact-note-shots.test.mjs', 'artifact-note-shots-page.test.mjs', 'fixtures/artifact-shots/kit.mjs'].flatMap((f) => fs.readFileSync(path.join(testDir, f), 'utf8').split('\n'));
  const said = own.filter((l) => /skip|todo/i.test(l) && !/^\/\//.test(l)); // no-skip-check
  assert.deepEqual(said.filter((l) => !l.endsWith('// no-skip-check')), []); // no-skip-check
  assert.equal(own.filter((l) => l.endsWith('// no-skip-check')).length, 3); // no-skip-check
  const list = spawnSync(process.execPath, [path.join(testDir, 'run.mjs'), '--list'], { cwd: path.join(testDir, '..'), encoding: 'utf8' }).stdout;
  for (const f of ['artifact-note-shots', 'artifact-note-shots-page']) assert.match(list, new RegExp(`${f}\\.test\\.mjs\\s+chrome\\b`));
});

test('C2b no websocket in the kit', () => {
  assert.equal(count(SRC, 'new WebSocket('), 0);
});

test('C14a one finder, the lens\'s own', () => {
  for (const m of MARKERS) assert.equal(count(LENS, m), 1, `marker missing: ${m}`);
  const at = MARKERS.map((m) => LENS.indexOf(m));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the markers in order');
  for (const d of ['const find = (a) =>', 'const hiddenEl =', 'const textOf =']) assert.equal(count(LENS, d), 1, d);
  for (const d of ['const find = (a) =>', 'const hiddenEl =']) assert.equal(count(SRC, d), 1, `${d} once in the kit`);
  const finder = LENS.slice(at[2], at[3]);
  for (const d of ['const find = (a) =>', 'const hiddenEl =', 'const textOf =', 'const rectOf =']) assert.ok(finder.includes(d), `${d} in the finder's slice`);
  for (const d of ['const CAPS =', 'const cap =', 'const oneLine =', 'const num =', 'const unCap =']) assert.ok(LENS.slice(at[0], at[1]).includes(d), `${d} in the helpers' slice`);
  assert.ok(region(), 'the note-shots region');
  assert.ok(/ARTIFACT_LENS\b/.test(body('shotSlice')) && body('shotScript').includes('shotSlice('), 'the shooter\'s script is cut from the lens');
  for (const d of ['find', 'hiddenEl', 'textOf']) assert.ok(!new RegExp(`(?:const|let|var|function) ${d}\\b`).test(region()), `the shooter has no ${d} of its own`);
});

test('C2a a pipe, no port, and a profile of its own that goes', async () => {
  const k = shotKit();
  const dies = fake('fake-chrome.sh');
  await k.readyOn(k.subject(), { CHROME_PATH: dies.file });
  assert.ok(dies.launches().length >= 1, 'the fake Chrome was launched');
  for (const a of dies.launches()) {
    for (const f of ['--headless=new', '--remote-debugging-pipe', '--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']) assert.ok(a.includes(f), f);
    assert.ok(!a.some((x) => x.startsWith('--remote-debugging-port')), 'no port');
    assert.ok(a.find((x) => x.startsWith('--user-data-dir=')).slice(16).startsWith(`${TMP}${path.sep}`), 'a profile under the temp folder');
  }
  const profiles = [];
  await Promise.all([0, 1].map(async () => {
    const wrap = fake('wrap-chrome.sh');
    const hook = seenFile();
    await k.readyOn(k.subject(), { CHROME_PATH: wrap.file, REAL_CHROME: chromePath, DEVTEAM_TEST_SHOT_SEEN: hook });
    const mine = k.seen(hook).filter((l) => l.startsWith('launch ')).map((l) => / profile=(.*)$/.exec(l)[1]);
    assert.ok(mine.length >= 1 && wrap.launches().length === mine.length, 'a launch line each launch');
    for (const p of mine) assert.ok(!fs.existsSync(p), `${p} is gone`);
    profiles.push(...mine);
  }));
  assert.equal(new Set(profiles).size, profiles.length, 'no shared profile');
  assert.deepEqual(fs.readdirSync(TMP).filter((f) => /^dc|^devteam-shot-/.test(f)), [], 'no profile or temp folder is left');
});

test('C2c one list of Chrome\'s names', async () => {
  const k = shotKit();
  const named = fake('fake-chrome.sh', 'google-chrome');
  await k.readyOn(k.subject(), { CHROME_PATH: undefined, PATH: `${named.dir}${path.delimiter}${process.env.PATH}` });
  assert.ok(named.launches().length >= 1, 'the google-chrome first on PATH was launched');
  assert.equal(count(SRC, 'const BROWSER_CHROME_NAMES ='), 1);
  assert.equal(count(SRC, "'google-chrome-stable'"), 1);
  assert.ok(region().includes('browserChrome('), 'the shooter finds Chrome as the browser does');
});

test('C8a no sandbox only when the operator says so, and only second', async () => {
  const k = shotKit();
  const dies = fake('fake-chrome.sh');
  const r = await k.readyOn(k.subject(), { CHROME_PATH: dies.file });
  assert.equal(r.status, 1);
  assert.equal(r.line, undefined);
  assert.deepEqual(dies.launches().map((a) => a.includes('--no-sandbox')), [false, true]);
  assert.match(r.out, /Chrome's sandbox didn't start here; took the picture without it \(DEVTEAM_CHROME_NO_SANDBOX=1\)/);
  for (const v of [undefined, '0']) {
    const again = fake('fake-chrome.sh');
    const r2 = await k.readyOn(k.subject(), { CHROME_PATH: again.file, DEVTEAM_CHROME_NO_SANDBOX: v });
    assert.equal(r2.status, 1);
    assert.deepEqual(again.launches().map((a) => a.includes('--no-sandbox')), [false], String(v));
    assert.match(r2.out, /Chrome didn't start \(its sandbox may not be available here\); set DEVTEAM_CHROME_NO_SANDBOX=1 to allow one try without it/);
  }
});

test('C8a a Chrome that dies once its page exists is not tried again', async () => {
  const k = shotKit();
  const wrap = fake('fake-pipe.sh');
  const r = await k.readyOn(k.subject(), { CHROME_PATH: wrap.file, FAKE_NODE: process.execPath });
  assert.equal(r.status, 1);
  assert.deepEqual(wrap.launches().map((a) => a.includes('--no-sandbox')), [false]);
});

test('C8b a crash after the page opened is never tried again', async () => {
  const k = shotKit();
  const wrap = fake('wrap-chrome.sh');
  const hook = seenFile();
  const r = await k.readyOn(k.subject(), { CHROME_PATH: wrap.file, REAL_CHROME: chromePath, DEVTEAM_TEST_SHOT_SEEN: hook, DEVTEAM_TEST_SHOT_CRASH: '1' });
  assert.equal(r.status, 1, r.out);
  assert.equal(r.line, undefined);
  assert.match(r.out, /the page crashed; no mark written/);
  const said = k.seen(hook);
  const page = said.indexOf('page');
  assert.ok(page > 0, 'the page opened');
  assert.deepEqual(said.slice(page).filter((l) => l.startsWith('launch ')), []);
});

test('C8c no Chrome: refused, nothing written', async () => {
  const k = shotKit();
  const id = await k.note(k.subject());
  const was = [k.logBytes(), k.tree()];
  const r = await k.ready(id, { CHROME_PATH: path.join(TMP, 'no-such-chrome') });
  assert.equal(r.status, 1);
  assert.match(r.out, /thread ready on an artifact note needs Chrome to take its picture: install Chrome or Chromium, or set CHROME_PATH/);
  assert.deepEqual([k.logBytes(), k.tree()], was);
});

test('C9 other threads: as before, no Chrome', async () => {
  const k = shotKit();
  for (const s of [null, { kind: 'item', ref: `goal:${k.F.goal}` }, { kind: 'preview', name: 'cool-tiger', route: '/', point: { x: 1, y: 1 } }, { kind: 'page', view: 'overview', at: { x: 0.5, y: 0.5 } }]) {
    const r = await k.readyOn(s, { CHROME_PATH: path.join(TMP, 'no-such-chrome') });
    assert.equal(r.status, 0, `${s?.kind ?? 'no subject'}: ${r.out}`);
    assert.ok(r.line && !('shot' in r.line), `${s?.kind ?? 'no subject'}: a ready line, no shot`);
  }
});

test('C8a C8c a page that loops, a Chrome that says nothing, nothing to picture: refused, nothing written', async () => {
  const k = shotKit();
  const hook = seenFile();
  const id = await k.note(k.subject({ path: 'loop.html' }));
  const nowhere = await k.note(k.subject({ slug: 'nowhere' }));
  const silent = await k.note(k.subject());
  const hang = fake('hang-chrome.sh');
  const was = [k.logBytes(), k.tree()];
  const started = Date.now();
  // the Chrome that says nothing, and its child, are killed after 8 s (beside the 20 s one)
  const silenced = k.ready(silent, { CHROME_PATH: hang.file, DEVTEAM_CHROME_NO_SANDBOX: undefined }).then((r) => ({ ...r, took: Date.now() - started }));
  const r = await k.ready(id, { DEVTEAM_TEST_SHOT_SEEN: hook });
  const h = await silenced;
  assert.equal(h.status, 1);
  assert.match(h.out, /Chrome didn't start/);
  assert.ok(h.took >= 8000 && h.took < 16000, `${h.took} ms`);
  await until(() => !spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).stdout.split('\n').includes('sleep 97531'), 'its child to be gone');
  assert.equal(r.status, 1);
  assert.match(r.out, /the picture took longer than 20 s \(a page that never settles, or a script that loops\); no mark written/);
  assert.ok(Date.now() - started < 32000, 'it ended soon after 20 s');
  const ps = spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).stdout;
  const profiles = k.seen(hook).filter((l) => l.startsWith('launch ')).map((l) => / profile=(.*)$/.exec(l)[1]);
  assert.ok(profiles.length);
  for (const p of profiles) assert.ok(!ps.includes(p) && !fs.existsSync(p), `nothing of ${p} is left`);
  const r2 = await k.ready(nowhere);
  assert.equal(r2.status, 1);
  assert.match(r2.out, /nothing to picture: nowhere isn't on main or in a draft/);
  assert.deepEqual([k.logBytes(), k.tree()], was);
});

test('C10a C10c thread new --frame: recorded, and every bound held', async () => {
  const k = shotKit();
  const frame = { w: 900, h: 700, hash: '#tab2' };
  const id = await k.noteByCommand(k.subject(), { frame });
  const started = k.last((o) => o.type === 'thread' && o.op === 'new' && o.id === id);
  assert.deepEqual(started.frame, frame);
  assert.equal(started.by, 'owner');
  const was = k.logBytes();
  const bad = async (what, text, subject, want) => {
    const r = await k.run(['thread', 'new', '--title', 'A bad frame', `--subject=${JSON.stringify(subject)}`, `--frame=${text}`, '--', 'Words']);
    assert.equal(r.status, 1, what);
    assert.match(r.out, want, what);
    assert.equal(k.logBytes(), was, `${what}: no line`);
  };
  for (const [what, f] of [['w 319', { w: 319, h: 700, hash: '' }], ['w 3841', { w: 3841, h: 700, hash: '' }], ['w 900.5', { w: 900.5, h: 700, hash: '' }], ['w text', { w: '900', h: 700, hash: '' }], ['h 239', { w: 900, h: 239, hash: '' }], ['h 2161', { w: 900, h: 2161, hash: '' }], ['hash tab2', { w: 900, h: 700, hash: 'tab2' }], ['hash 201 bytes', { w: 900, h: 700, hash: `#${'x'.repeat(200)}` }], ['hash 203 bytes, 102 characters', { w: 900, h: 700, hash: `#${'é'.repeat(101)}` }], ['hash bidi', { w: 900, h: 700, hash: '#a\u202eb' }], ['hash newline', { w: 900, h: 700, hash: '#a\nb' }], ['no hash', { w: 900, h: 700 }], ['an extra key', { w: 900, h: 700, hash: '', x: 1 }], ['a list', [900, 700, '']], ['null', null]]) await bad(what, JSON.stringify(f), k.subject(), /--frame/);
  await bad('not JSON', '{w:900}', k.subject(), /--frame/);
  await bad('an item subject', JSON.stringify(frame), { kind: 'item', ref: `goal:${k.F.goal}` }, /--frame goes with an artifact subject/);
  for (const f of [{ w: 320, h: 240, hash: '' }, { w: 3840, h: 2160, hash: `#${'x'.repeat(199)}` }]) { const at = await k.noteByCommand(k.subject(), { frame: f }); assert.deepEqual(k.last((o) => o.type === 'thread' && o.op === 'new' && o.id === at).frame, f); }
});

test('C5i a capability in frame.hash is cut', async () => {
  const k = shotKit();
  const cap = '/c/1763164800000.abcdefghijklmnop.abcdefghijklmnopqrstuv';
  const id = await k.noteByCommand(k.subject(), { frame: { w: 900, h: 700, hash: `#${cap}` } });
  const { hash } = k.last((o) => o.type === 'thread' && o.op === 'new' && o.id === id).frame;
  assert.ok(hash.includes('[link removed]') && !hash.includes('abcdefghijklmnop'), hash);
});

test('C10b the thread-new POST carries the frame, and refuses a bad one', async () => {
  const k = shotKit();
  const { dash, port } = await dashboardOnFreePort(k.F.old, k.childEnv());
  try {
    const post = (b) => fetch(`http://127.0.0.1:${port}/api/thread-new`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(b) });
    const named = (title) => k.last((o) => o.type === 'thread' && o.op === 'new' && o.title === title);
    const frame = { w: 900, h: 700, hash: '' };
    const good = await post({ title: 'A framed note', text: 'Words', subject: k.subject(), frame });
    assert.equal(good.status, 200, await good.text());
    assert.deepEqual(named('A framed note').frame, frame);
    const bad = await post({ title: 'A badly framed note', text: 'Words', subject: k.subject(), frame: { w: 100 } });
    assert.equal(bad.status, 400);
    assert.equal(named('A badly framed note'), undefined);
    // refused before a command is spawned, and what is spawned carries no capability
    const action = /\n    'thread-new': \(b\) => \{[\s\S]*?\n    \},\n/.exec(SRC)?.[0] ?? '';
    assert.ok(action.includes('!frameProblem(frame, subject)') && /frame[^;]*uncapped\(|uncapped\([^;]*frame/.test(action), action.slice(0, 80));
    const none = await post({ title: 'A note with no frame', text: 'Words', subject: k.subject() });
    assert.equal(none.status, 200);
    assert.ok(!('frame' in named('A note with no frame')));
  } finally { await dash.stop(); }
});

test('the pictures go only in their own folder: a symlinked one is refused', async () => {
  const k = shotKit();
  const id = await k.note(k.subject());
  const away = fs.mkdtempSync(path.join(TMP, 'away'));
  fs.mkdirSync(k.shots, { recursive: true });
  fs.symlinkSync(away, path.join(k.shots, id));
  const r = await k.ready(id);
  assert.equal(r.status, 1, said(r));
  assert.equal(r.line, undefined);
  assert.deepEqual(fs.readdirSync(away), []);
  fs.unlinkSync(path.join(k.shots, id));
});

test('a thread resolved while its picture is taken gets no proposal', async () => {
  const k = shotKit();
  const id = await k.note(k.subject({ path: 'slow.html' }));
  const hook = seenFile();
  const going = k.ready(id, { DEVTEAM_TEST_SHOT_SEEN: hook });
  await until(() => k.seen(hook).includes('page'), 'the picture to have begun');
  assert.equal((await k.run(['thread', 'resolve', id])).status, 0);
  const r = await going;
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /is resolved/);
  assert.equal(r.line, undefined);
  assert.deepEqual(k.files(id), []);
});

test('C4a C4e main first, never a stale checkout', async () => {
  const k = shotKit();
  const old = worktree(k, 'kit-1-old', 'pricing', 'Old');
  const chore = worktree(k, 'chore-artifact-pricing', 'pricing', 'Chore');
  try {
    for (const [what, s] of [['C4a', pageNote(k)], ['C4e', pageNote(k, { at: 'chore-artifact-pricing' })]]) {
      const r = await k.readyOn(s);
      assert.equal(r.status, 0, said(r));
      assert.match(r.out, /text "Main"/, what);
      const { src, sha, dirty } = r.line.shot;
      assert.deepEqual({ src, sha, dirty }, { src: 'main', sha: k.F.g(['rev-parse', 'origin/main'], k.F.old), dirty: false }, what);
      assert.deepEqual((await k.show(r.id)).source, { at: 'main', slug: 'pricing' }, what);
    }
  } finally { old.remove(); chore.remove(); }
});

test('C4b C4d a draft alone: pictured from it, then main once it is gone', async () => {
  const k = shotKit();
  const wt = worktree(k, 'chore-artifact-drafty', 'drafty', 'Chore');
  const s = () => pageNote(k, { slug: 'drafty', at: 'chore-artifact-drafty' });
  write(path.join(wt.root, 'other.txt'), 'a change outside the artifact\n');
  const r = await k.readyOn(s());
  assert.equal(r.status, 0, said(r));
  assert.match(r.out, /text "Chore"/);
  const { src, sha, dirty } = r.line.shot;
  assert.deepEqual({ src, sha, dirty }, { src: 'chore-artifact-drafty', sha: wt.head(), dirty: false });
  assert.deepEqual((await k.show(r.id)).source, { at: 'chore-artifact-drafty', slug: 'drafty' });
  fs.writeFileSync(path.join(wt.dir, 'index.html'), '<!doctype html><button id="buy">Chore edited</button>\n');
  const d = await k.readyOn(s());
  assert.match(d.out, /text "Chore edited"/);
  assert.equal(d.line.shot.dirty, true);
  // an edit and a commit while the picture is taken
  const during = async (what) => {
    fs.writeFileSync(path.join(wt.dir, 'index.html'), '<!doctype html><button id="buy">Chore</button>\n');
    k.F.g(['add', '-A'], wt.root);
    k.F.g(['commit', '-q', '--allow-empty', '-m', 'clean'], wt.root);
    const hook = seenFile();
    const going = k.readyOn(s(), { DEVTEAM_TEST_SHOT_SEEN: hook });
    await until(() => k.seen(hook).some((l) => l.startsWith('launch ')), 'Chrome to launch');
    fs.writeFileSync(path.join(wt.dir, 'index.html'), '<!doctype html><button id="buy">After</button>\n');
    if (what === 'commit') k.F.g(['commit', '-qam', 'after'], wt.root);
    return going;
  };
  const edited = await during('edit');
  assert.equal(edited.line?.shot.dirty, true, said(edited));
  const moved = await during('commit');
  assert.equal(moved.status, 1, said(moved));
  assert.match(moved.out, /moved to another commit/);
  assert.deepEqual(k.files(moved.id), []);
  fs.cpSync(wt.dir, path.join(k.arts, 'drafty'), { recursive: true });
  k.F.g(['add', '-A'], k.F.old);
  k.F.g(['commit', '-qm', 'drafty lands'], k.F.old);
  k.F.g(['push', '-q', 'origin', 'main'], k.F.old);
  assert.equal((await k.show(r.id)).source.at, 'chore-artifact-drafty', 'landed, the worktree kept');
  wt.remove();
  assert.deepEqual((await k.show(r.id)).source, { at: 'main', slug: 'drafty' });
});

test('C4c C4f an addressed mark\'s draft is what Show me opens, and what a ready over it pictures', async () => {
  const k = shotKit();
  const chore = worktree(k, 'chore-artifact-pricing', 'pricing', 'Chore');
  const id = await addressed(k, pageNote(k), 'supervisor', { draft: 'chore-artifact-pricing' });
  assert.equal((await k.show(id)).check, 'addressed');
  assert.deepEqual((await k.show(id)).source, { at: 'chore-artifact-pricing', slug: 'pricing' });
  const r = await k.ready(id);
  assert.equal(r.status, 0, said(r));
  assert.equal(r.line.shot.src, 'chore-artifact-pricing');
  assert.match(r.out, /text "Chore"/);
  chore.remove();
  assert.deepEqual((await k.show(id)).source, { at: 'main', slug: 'pricing' });
  const plain = await k.show(await k.note(pageNote(k)));
  assert.equal(plain.source, null, 'nothing to check, no source');
});

test('C4 the order, and the copy\'s own commit and changes', () => {
  const has = (...at) => (x) => at.includes(x);
  const { shotOrder, noteSource, markShot } = cut(['LINK_ID', 'shotOrder', 'noteSource', 'readySource', 'markShot'], { shotHolds: () => has('kit-9-x', 'main'), noteShot: (view, src) => src });
  const v = (o = {}) => ({ subject: { slug: 'p', at: 'kit-9-x' }, addressed: { draft: 'kit-8-y' }, ...o });
  assert.deepEqual(['kit-8-y', 'kit-9-x', 'chore-artifact-p', 'main'].map((_, i, all) => shotOrder(v(), has(...all.slice(i)))?.at), ['kit-8-y', 'kit-9-x', 'chore-artifact-p', 'main']);
  assert.equal(shotOrder(v(), has()), null);
  for (const at of ['kit-9-x', 'main']) assert.equal(noteSource(v({ addressed: null, check: 'addressed', subject: { slug: 'p', at } }), has(at)).at, at);
  for (const slug of [['racy'], undefined, 7, '../x']) assert.equal(noteSource({ subject: { slug, at: 'kit-9-x' }, check: 'ready', shot: null }, has('kit-9-x')), null);
  assert.equal(noteSource({ subject: { slug: 'p', at: 'main' }, check: 'ready' }, () => { throw new Error('a path'); }), null, 'a throw is no source');
  // what kit-144 marks with
  assert.equal(markShot(v({ addressed: null }), { kind: 'addressed', by: 'supervisor', draft: 'kit-9-x' }), 'kit-9-x');
  assert.equal(markShot(v({ subject: { slug: 'p', at: 'main' } }), { kind: 'addressed', by: 'supervisor' }), 'main');
  const git = (top, status) => cut(['shotSha', 'shotDirty'], { ARTIFACTS_REL: 'a', mainSha: () => 'm', draftWorktree: () => '/wt', git: (a) => (a.includes('--show-toplevel') ? top : a.includes('status') ? (git.asked = a, status) : 'sha') });
  assert.equal(git('/wt', '').shotSha('x'), 'sha');
  assert.throws(() => git('/main', '').shotSha('x'), /has no commit/);
  assert.deepEqual(['', ' M a', null].map((st) => git('/wt', st).shotDirty('x', 'p')), [false, true, true]);
  assert.ok(git.asked.includes('--no-optional-locks') && git.asked.includes('--untracked-files=normal'));
});

test('a hand-written note of the wrong shape stops no command', async () => {
  const k = shotKit();
  const wt = worktree(k, 'kit-2-racy', 'racy', 'Racy');
  // in a log of its own, gone after
  const before = new Map(fs.readdirSync(k.F.logDir).map((f) => [f, fs.readFileSync(path.join(k.F.logDir, f))]));
  try {
    const id = await k.note(pageNote(k, { slug: ['racy'], at: 'kit-2-racy' }));
    k.F.hand('supervisor', { type: 'thread', op: 'set', id, ready: { at: new Date().toISOString(), outcome: 'The button now says Annual' } }, 0);
    const r = await k.run(['thread', 'list'], k.SUP);
    assert.equal(r.status, 0, said(r));
  } finally {
    for (const f of fs.readdirSync(k.F.logDir)) { if (before.has(f)) fs.writeFileSync(path.join(k.F.logDir, f), before.get(f)); else fs.unlinkSync(path.join(k.F.logDir, f)); }
    wt.remove();
  }
});

// --- withdrawing a mark -------------------------------------------------------------------------------
const REASON = 'The picture shows the old button';
const unready = (k, id, reason = REASON, extra = { DEVTEAM_ROLE: 'supervisor' }) => k.run(['thread', 'unready', id, '--reason', reason], extra);
const toldOf = (k, id) => k.lines().filter((o) => o.type === 'message' && o.kind === 'info' && o.thread !== undefined && String(o.text).includes(id));

test('C11a C11d thread unready over a proposal, once', async () => {
  const k = shotKit();
  const { id, line } = await k.readyOn(k.subject());
  assert.ok(line);
  const r = await unready(k, id);
  assert.equal(r.status, 0, said(r));
  const w = k.last((o) => o.type === 'thread' && o.op === 'set' && o.id === id);
  assert.equal(w.by, 'supervisor');
  assert.equal(w.ready, null);
  assert.deepEqual(Object.keys(w.unready).sort(), ['at', 'reason']);
  assert.equal(w.unready.reason, REASON);
  const v = await k.show(id);
  assert.deepEqual([v.check, v.ready, v.source, v.unready.reason], [null, null, null, REASON]);
  const was = k.logBytes();
  const again = await unready(k, id);
  assert.equal(again.status, 1);
  assert.ok(again.out.includes(`${id} has nothing to check: no proposal or addressed mark stands`), said(again));
  assert.equal(k.logBytes(), was);
});

test('C11b the session whose mark is withdrawn is told; the supervisor is not', async () => {
  const k = shotKit();
  const theirs = await addressed(k, k.subject(), 'plan-pricing');
  const r = await unready(k, theirs);
  assert.equal(r.status, 0, said(r));
  const told = toldOf(k, theirs);
  assert.equal(told.length, 1);
  assert.deepEqual([told[0].by, told[0].to], ['supervisor', 'plan-pricing']);
  assert.equal(told[0].text, `Your mark on ${theirs} was withdrawn: ${REASON}. Fix it and mark it again: devteam.mjs artifact notes pricing.`);
  assert.match(r.stdout, /plan-pricing/);
  assert.equal((await k.show(theirs)).check, null);
  const own = await addressed(k, k.subject(), 'supervisor');
  const r2 = await unready(k, own);
  assert.equal(r2.status, 0, said(r2));
  assert.ok(r2.stdout.includes(`withdrew your own mark on ${own}`), said(r2));
  assert.deepEqual(toldOf(k, own), []);
});

test('C11c each refusal of thread unready, and no line', async () => {
  const k = shotKit();
  const fresh = await k.note(k.subject());
  const { id } = await k.readyOn(k.subject());
  const was = k.logBytes();
  for (const [what, at, reason, env, want] of [
    ['nothing to check', fresh, REASON, undefined, /has nothing to check: no proposal or addressed mark stands/],
    ['11 bytes', id, 'Too short!!', undefined, /--reason is 12 to 300 bytes/],
    ['301 bytes', id, 'x'.repeat(301), undefined, /--reason is 12 to 300 bytes/],
    ['a newline', id, 'The picture\nshows the old one', undefined, /--reason is one line/],
    ['none', id, '', undefined, /--reason is 12 to 300 bytes/],
    ['a worker', id, REASON, { DEVTEAM_ROLE: 'worker' }, /thread unready: the supervisor does this/],
    ['a planner', id, REASON, { DEVTEAM_FEATURE: 'pricing' }, /thread unready: the supervisor does this/],
    ['no thread', 't-20990101-000000000-owner', REASON, undefined, /no thread/],
  ]) {
    const r = await unready(k, at, reason, env);
    assert.equal(r.status, 1, what);
    assert.match(r.out, want, what);
    assert.ok(!/usage:/.test(r.out), what);
    assert.equal(k.logBytes(), was, what);
  }
});

// --- the dashboard ------------------------------------------------------------------------------------
test('C12 the picture, the source and their freshness on the dashboard', async () => {
  const k = shotKit();
  const r = await k.readyOn(k.subject());
  const wt = worktree(k, 'chore-artifact-gone', 'gone', 'Chore');
  const landing = worktree(k, 'chore-artifact-landing', 'landing', 'Chore');
  const gone = await k.readyOn(pageNote(k, { slug: 'gone', at: 'chore-artifact-gone' }));
  const lands = await k.readyOn(pageNote(k, { slug: 'landing', at: 'chore-artifact-landing' }));
  for (const x of [r, gone, lands]) assert.equal(x.status, 0, said(x));
  const name = `${r.line.shot.stamp}-light.png`;
  const { dash, port } = await dashboardOnFreePort(k.F.old, k.childEnv());
  try {
    const at = `http://127.0.0.1:${port}`;
    const read = async (headers = {}) => { const a = await fetch(`${at}/api/threads`, { headers }); const b = a.status === 200 ? (await a.json()).threads : null; return { status: a.status, tag: a.headers.get('etag'), of: (id) => b.find((x) => x.id === id) }; };
    // C12a
    const first = await read();
    assert.deepEqual(first.of(r.id).source, { at: 'main', slug: 'pricing' });
    assert.deepEqual(first.of(r.id).shot, r.line.shot);
    assert.deepEqual(first.of(gone.id).source, { at: 'chore-artifact-gone', slug: 'gone' });
    // C12b
    const shot = (p, headers = {}) => new Promise((resolve, reject) => { const q = http.request({ host: '127.0.0.1', port, path: p, headers }, (res) => { const got = []; res.on('data', (b) => got.push(b)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(got) })); }); q.on('error', reject); q.end(); });
    const ok = await shot(`/api/shot/${r.id}/${name}`);
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.headers['content-type'], ok.headers['cache-control'], ok.headers['x-content-type-options'], ok.headers['cross-origin-resource-policy']], ['image/png', 'no-store', 'nosniff', 'same-origin']);
    assert.equal(sha256(ok.body), r.line.shot.sum.light);
    // C12c
    for (const [site, want] of [['cross-site', 403], ['same-site', 403], ['none', 403], ['same-origin', 200]]) assert.equal((await shot(`/api/shot/${r.id}/${name}`, { 'sec-fetch-site': site })).status, want, site);
    // C12d
    const dir = path.join(k.shots, r.id);
    fs.symlinkSync(name, path.join(dir, '20990101-000000000-light.png'));
    const linked = await k.note(k.subject());
    fs.symlinkSync(dir, path.join(k.shots, linked));
    write(path.join(k.shots, 'x-1', name), 'x');
    write(path.join(dir, `${r.line.shot.stamp}-light.jpg`), 'x');
    for (const p of [`/api/shot/${r.id}/../x/${name}`, `/api/shot/${r.id}%2F${name}`, `/api/shot/${r.id}/..%2F${r.id}%2F${name}`, `/api/shot/${r.id}/${r.line.shot.stamp}-light.jpg`, `/api/shot/x-1/${name}`, `/api/shot/${r.id}/20990101-000000000-light.png`, `/api/shot/${linked}/${name}`, `/api/shot/${r.id}/${r.line.shot.stamp}-dark.png`, `/api/shot/${r.id}/`]) assert.equal((await shot(p)).status, 404, p);
    for (const f of [path.join(dir, '20990101-000000000-light.png'), path.join(k.shots, linked), path.join(dir, `${r.line.shot.stamp}-light.jpg`)]) fs.unlinkSync(f);
    // C12e: no log line is written from here on
    const was = k.logBytes();
    const held = await read();
    assert.equal((await read({ 'if-none-match': held.tag })).status, 304, 'nothing changed');
    wt.remove();
    const after = await read({ 'if-none-match': held.tag });
    assert.equal(after.status, 200, 'a removed worktree is seen');
    assert.equal(after.of(gone.id).source, null);
    fs.cpSync(landing.dir, path.join(k.arts, 'landing'), { recursive: true });
    k.F.g(['add', '-A'], k.F.old);
    k.F.g(['commit', '-qm', 'landing lands'], k.F.old);
    k.F.g(['push', '-q', 'origin', 'main'], k.F.old);
    assert.equal((await read()).of(lands.id).source.at, 'chore-artifact-landing');
    landing.remove();
    assert.deepEqual((await read({ 'if-none-match': after.tag })).of(lands.id).source, { at: 'main', slug: 'landing' });
    assert.equal(k.logBytes(), was);
    // main is asked again once it moves: gone's source read null above
    fs.cpSync(path.join(k.arts, 'landing'), path.join(k.arts, 'gone'), { recursive: true });
    k.F.g(['add', '-A'], k.F.old);
    k.F.g(['commit', '-qm', 'gone lands'], k.F.old);
    k.F.g(['push', '-q', 'origin', 'main'], k.F.old);
    assert.deepEqual((await read()).of(gone.id).source, { at: 'main', slug: 'gone' });
    // and a log line with no source changed is in the next read
    assert.equal((await k.run(['thread', 'say', linked, '--', 'One more word'])).status, 0);
    assert.ok(JSON.stringify((await read()).of(linked)).includes('One more word'));
  } finally { await dash.stop(); }
});

// --- retention ----------------------------------------------------------------------------------------
test('C13 the newest three and the live mark\'s are kept, and an old resolved thread\'s go', async () => {
  const k = shotKit();
  const day = 86400000;
  const plant = (id, stamp, ...names) => { for (const n of names.length ? names : [`${stamp}-light.png`]) write(path.join(k.shots, id, n), 'x'); };
  const resolved = async (days) => { const id = await k.note(k.subject()); k.F.hand('owner', { type: 'thread', op: 'set', id, status: 'resolved', outcome: null }, days * day); plant(id, '20261101-000000000'); return id; };
  const status = (id, to, days) => k.F.hand('owner', { type: 'thread', op: 'set', id, status: to, ...(to === 'resolved' ? { outcome: null } : {}) }, days * day);
  const [old, recent, open] = [await resolved(15), await resolved(13), await k.note(k.subject())];
  const reopened = await resolved(20);
  status(reopened, 'open', 19);
  const twice = await resolved(20);
  status(twice, 'open', 19);
  status(twice, 'resolved', 13);
  plant(open, '20250101-000000000');
  // folders and files that aren't the kit's to remove
  const stray = 't-20990101-000000000-nobody';
  plant(stray, '20250101-000000000');
  write(path.join(k.shots, 'notes', 'a.txt'), 'x');
  write(path.join(k.shots, 'notes.txt'), 'x');
  const id = await k.note(k.subject());
  plant(id, '', 'notes.txt');
  fs.mkdirSync(path.join(k.shots, id, '20250101-000000000-light.png'));
  const stamps = [];
  for (let i = 0; i < 4; i++) { const r = await k.ready(id); assert.equal(r.status, 0, said(r)); stamps.push(r.line.shot.stamp); }
  assert.deepEqual(k.files(id), ['20250101-000000000-light.png', ...stamps.slice(1).map((s) => `${s}-light.png`), 'notes.txt']);
  assert.ok(!fs.existsSync(path.join(k.shots, old)), 'resolved 15 days ago');
  assert.deepEqual(k.files(recent), ['20261101-000000000-light.png'], 'resolved 13 days ago');
  assert.deepEqual(k.files(reopened), ['20261101-000000000-light.png'], 'resolved long ago, reopened');
  assert.deepEqual(k.files(twice), ['20261101-000000000-light.png'], 'resolved again 13 days ago');
  assert.deepEqual(k.files(open), ['20250101-000000000-light.png'], 'an open thread');
  assert.deepEqual(k.files(stray), ['20250101-000000000-light.png'], 'not in the log');
  assert.ok(fs.existsSync(path.join(k.shots, 'notes', 'a.txt')) && fs.existsSync(path.join(k.shots, 'notes.txt')));
  // a mark's own picture stays, however old
  const shot = { stamp: '20250601-000000000', w: 1400, h: 860, src: 'main', sha: 'a'.repeat(40), dirty: false, anchor: 'found', dark: true, sum: { light: 'b'.repeat(64), dark: 'c'.repeat(64) } };
  const marked = await addressed(k, k.subject(), 'supervisor', { shot });
  plant(marked, '', `${shot.stamp}-light.png`, `${shot.stamp}-dark.png`, '20250501-000000000-light.png');
  for (let i = 0; i < 3; i++) assert.equal((await k.ready(marked)).status, 0);
  assert.deepEqual(k.files(marked).slice(0, 2), [`${shot.stamp}-dark.png`, `${shot.stamp}-light.png`]);
  assert.equal(k.files(marked).length, 5);
});

// --- what the supervisor reads -------------------------------------------------------------------------
test('C15c the supervisor\'s guide and the help name thread unready', async () => {
  const k = shotKit();
  const doc = fs.readFileSync(path.join(kit, 'process', 'supervisor.md'), 'utf8');
  const part = /\n### Artifact notes\n([\s\S]*?)\n## /.exec(doc)?.[1] ?? '';
  assert.ok(part.includes('thread unready <t-id> --reason'), 'the command');
  assert.match(part, /look at the picture `thread ready` prints/);
  assert.match(part, /`shot\.w` and `shot\.h` are the width and height the page laid out at/);
  assert.ok(!part.includes('writes none of them') && !part.includes('null in this kit'), 'no longer what it was before the pictures');
  assert.match((await k.run(['help', 'decide'])).stdout + (await k.run(['help'])).stdout, /thread unready <t-id> --reason "<line>"/);
});
