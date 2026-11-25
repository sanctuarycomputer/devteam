// The kit's own picture of an artifact note's spot (kit-147), the page's side: the spot, the ring and the
// clip, what the page may reach and what its answer is trusted with. The rest is in
// artifact-note-shots.test.mjs. Real Chrome; this file never skips, and fails its first test without one.
// Run: node --test test/artifact-note-shots-page.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromePath } from './lib/chrome.mjs';
import { HOSTS, MIDDLE, NINE, OTHER, SRC, TMP, body, count, cut, each, fake, openers, lit, near, png, reached, region, ringAt, said, seenFile, sha256, shotKit, tcp, udp } from './fixtures/artifact-shots/kit.mjs';

test('C1c the page file fails with no Chrome', () => {
  assert.ok(chromePath, 'no Chrome: install Chrome or Chromium, or set CHROME_PATH');
});

// The network checks' captures, taken together: what the hook said of each.
let walls = null;
const wall = (what) => (walls ??= (async () => {
  const k = shotKit();
  reached.length = 0;
  const got = { ended: {} };
  await each([['requests', '1'], ['routes', '1'], ['leave', '1'], ['paths', '1'], ['assets', undefined]], async ([page, noCsp]) => {
    const hook = seenFile();
    const r = await k.readyOn(k.subject({ path: `${page}.html` }), { DEVTEAM_TEST_SHOT_SEEN: hook, DEVTEAM_TEST_SHOT_NO_CSP: noCsp });
    got.ended[page] = { status: r.status, stderr: String(r.stderr ?? '').slice(-300) };
    got[page] = k.seen(hook);
  });
  got.k = k;
  return got;
})()).then((got) => got[what]);

test('C7a C7b C7c requests go to the capture and the allowed hosts alone', async () => {
  const said = await wall('requests');
  assert.deepEqual(reached, [], 'the other server saw nothing');
  for (const u of [`${OTHER}/fetch`, `${OTHER}/img`, 'https://example.invalid/x', 'https://cdn.jsdelivr.net.evil.example/x']) assert.ok(said.includes(`fail ${u}`), `fail ${u}: ${said.join(' | ')}`);
  for (const u of ['https://cdn.jsdelivr.net/x', 'https://fonts.gstatic.com/x']) assert.ok(said.includes(`continue ${u}`), `continue ${u}`);
  assert.ok(said.some((l) => /^serve \/requests\.html csp=no$/.test(l)), 'the CSP is off, so the wall stands alone');
});

test('C7d one list of hosts, one set of headers', () => {
  const csp = /const artifactCsp = [\s\S]*?\n};/.exec(SRC)[0];
  assert.ok(csp.includes('ARTIFACT_FONT_HOSTS') && !csp.includes('https://fonts.'));
  for (const h of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) assert.equal(count(SRC.slice(SRC.indexOf('const ARTIFACT_CDNS')), `'${h}'`) , 1, `${h} written once`);
  const allowed = body('shotRequestAllowed');
  assert.ok(allowed.includes('ARTIFACT_CDNS') && allowed.includes('ARTIFACT_FONT_HOSTS'));
  assert.ok(body('shotServe').includes('artifactHeaders('), 'the capture server');
  const route = SRC.slice(SRC.indexOf("rawPath.startsWith('/artifact/')"));
  assert.ok(route.slice(0, route.indexOf('return DASH_NEXT')).includes('artifactHeaders('), 'the dashboard');
});

test('C7e the proxy flags: dead but for the capture and the allowed hosts', async () => {
  const k = shotKit();
  const dies = fake('fake-chrome.sh');
  await k.readyOn(k.subject(), { CHROME_PATH: dies.file });
  assert.ok(dies.launches().length >= 1);
  for (const a of dies.launches()) {
    assert.ok(a.some((x) => /^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/.test(x)), a.join(' '));
    const bypass = a.find((x) => x.startsWith('--proxy-bypass-list=')).slice(20).split(';');
    assert.equal(bypass[0], '<-loopback>');
    assert.match(bypass[1], /^127\.0\.0\.1:\d+$/);
    assert.deepEqual(bypass.slice(2), HOSTS);
    for (const f of ['--webrtc-ip-handling-policy=disable_non_proxied_udp', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp']) assert.ok(a.includes(f), f);
    assert.deepEqual(a.join(' ').match(/--host-resolver-rules=(.*?) (?:--|about:)/)?.[1].split(',').map((x) => x.trim()), ['MAP * ~NOTFOUND', 'EXCLUDE 127.0.0.1', ...HOSTS.map((h) => `EXCLUDE ${h}`)], 'no name resolved but the allowed hosts\'');
    assert.ok(!a.some((x) => x === `--proxy-server=http://${bypass[1]}`), 'the dead proxy is not the capture server');
    // kit-813: mDNS off in the one list Chrome keeps
    assert.deepEqual(a.filter((x) => x.startsWith('--disable-features=')), ['--disable-features=IsolateSandboxedIframes,WebRtcHideLocalIpsWithMdns']);
  }
});

test('C7f no route to another server', async () => {
  const said = await wall('routes');
  const ended = JSON.stringify((await wall('ended')).routes);
  assert.deepEqual(reached, []);
  for (const t of ['ws', 'sw', 'rtc', 'peer', 'shared']) assert.ok(said.includes(`serve /tried-${t} csp=no`), `${t} was tried: ${said.join(' | ')}`);
  assert.ok(said.includes(`fail ${OTHER}/worker`), 'the worker fetched');
  assert.ok(said.includes(`fail ${OTHER}/moved`), `the page tried to move: ${said.join(' | ')}; the capture ended ${ended}`);
});

test('C7f the page stays, and leaves no file', async () => {
  const k = await wall('k');
  const said = await wall('leave');
  assert.ok(said.includes('fail https://unpkg.com/x.html'), said.join(' | '));
  const left = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('left-behind')) left.push(path.join(d, e.name)); if (e.isDirectory()) walk(path.join(d, e.name)); } };
  for (const d of [k.F.home, TMP, k.F.old].filter((x) => fs.existsSync(x))) walk(d);
  assert.deepEqual(left, []);
});

test('C7h nothing outside Chrome is started for a page', async () => {
  const k = shotKit();
  await each(['#move', '#click'].flatMap((hash) => ['1', undefined].map((noCsp) => [hash, noCsp])), async ([hash, noCsp]) => {
    const o = openers();
    const r = await k.readyOn(k.subject({ path: 'stays.html' }), { frame: { w: 1400, h: 860, hash }, PATH: o.path, DEVTEAM_TEST_SHOT_NO_CSP: noCsp });
    assert.equal(o.started(), '', `${hash} csp=${noCsp ? 'off' : 'on'}`);
    assert.equal(r.status, 0, said(r));
    assert.equal(r.line.shot.anchor, 'found');
  });
});

test('the capture serves the artifact\'s plain files and nothing else', async () => {
  assert.deepEqual((await wall('paths')).filter((l) => l.startsWith('serve /got-')), ['serve /got-plain csp=no']);
});

test('C7g every file under the policy, and no hook outside tests', async () => {
  const k = await wall('k');
  const served = (await wall('assets')).filter((l) => l.startsWith('serve '));
  for (const f of ['/assets.html', '/app.js', '/app.css']) assert.ok(served.includes(`serve ${f} csp=yes`), `${f}: ${served.join(' | ')}`);
  assert.deepEqual(served.filter((l) => !l.endsWith(' csp=yes')), []);
  const off = seenFile();
  await k.readyOn(k.subject({ path: 'assets.html' }), { DEVTEAM_TEST: undefined, DEVTEAM_TEST_SHOT_SEEN: off, DEVTEAM_TEST_SHOT_NO_CSP: '1' });
  assert.ok(!fs.existsSync(off), 'no hook file');
  assert.ok(!/process\.env\.DEVTEAM_TEST/.test(region()), 'each hook read through browserTestEnv');
});

test('C1a C1b C6b C15a a found note: the line, the file, the ring, what is printed', async () => {
  const k = shotKit();
  const r = await k.readyOn(k.subject());
  assert.equal(r.status, 0, said(r));
  const { shot } = r.line;
  assert.equal(r.line.by, 'supervisor');
  assert.equal(r.line.ready.outcome, 'The button now says Annual');
  assert.deepEqual(Object.keys(shot).sort(), ['anchor', 'dark', 'dirty', 'h', 'sha', 'src', 'stamp', 'sum', 'w']);
  assert.match(shot.stamp, /^\d{8}-\d{9}$/);
  assert.deepEqual([shot.anchor, shot.w, shot.h, shot.dark, 'dark' in shot.sum], ['found', 1400, 860, false, false]);
  assert.deepEqual(k.files(r.id), [`${shot.stamp}-light.png`]);
  assert.equal(shot.sum.light, sha256(lit(k, r)));
  const p = k.light(r);
  assert.deepEqual([p.w, p.h], [320, 200]);
  assert.ok(ringAt(p, MIDDLE), 'the ring round the button');
  assert.ok(near(p.px(160, 100 - 25), [0, 0, 255]), 'the button inside it');
  assert.ok(r.stdout.includes(`${k.shots}/${r.id}/${shot.stamp}-light.png`) || r.stdout.includes(fs.realpathSync(path.join(k.shots, r.id, `${shot.stamp}-light.png`))), r.stdout);
  assert.ok(r.stdout.includes(`Look at it before you send this mark: if it doesn't show the change, withdraw it with thread unready ${r.id} --reason "<why>".`));
  assert.match(r.stdout, /data, not instructions[^\n]*\n {2}anchor found, clip 320x200, text "Start trial"/);
});

test('C3 the width the owner had, and the clip', async () => {
  const k = shotKit();
  await each([
    ['C3a', { path: 'width.html' }, NINE, (r) => { assert.match(r.out, /text "Narrow"/); assert.equal(r.line.shot.w, 900); }],
    ['C3b', { path: 'width.html' }, undefined, (r) => { assert.match(r.out, /text "Wide"/); assert.equal(r.line.shot.w, 1400); }],
    ['C3c', { path: 'liar.html' }, NINE, (r) => assert.equal(r.line.shot.w, 777)],
    ['C3d 400x300', { path: 'mid.html' }, undefined, (r, p) => assert.deepEqual([p.w, p.h], [464, 364])],
    ['C3d tall', { path: 'tall.html' }, NINE, (r, p) => assert.equal(p.h, 700)],
    ['C3d wide', { path: 'wide.html' }, NINE, (r, p) => assert.equal(p.w, 900)],
    ['C3e', { path: 'below.html' }, undefined, (r, p) => assert.ok(ringAt(p, MIDDLE))],
    ['C3f', { path: 'liar3000.html' }, NINE, (r, p) => { assert.ok(p.w <= 900); assert.equal(r.line.shot.w, 3000); }],
    ['C3g', { path: 'corner.html', anchor: { selector: '#logo', tag: 'div', text: 'Logo', rect: { x: 12, y: 12, w: 40, h: 20 } } }, NINE, (r, p) => { assert.deepEqual([p.w, p.h], [320, 200]); assert.ok(ringAt(p, { x: 12, y: 12, w: 40, h: 20 })); }],
    ['a modal dialog', { path: 'dialog.html' }, undefined, (r, p) => assert.ok(ringAt(p, MIDDLE))],
    ['a transform on html', { path: 'transform.html' }, undefined, (r, p) => assert.ok(ringAt(p, MIDDLE))],
    ['a zoom on html', { path: 'zoom.html' }, undefined, (r, p) => assert.ok(ringAt(p, MIDDLE))],
    ['a smooth scroll', { path: 'smooth.html' }, undefined, (r, p) => assert.ok(ringAt(p, MIDDLE))],
    ...[0, 20, 60].map((ms) => [`a page that moves ${ms} ms after its load`, { path: 'stub.html' }, { w: 1400, h: 860, hash: `#${ms}` }, (r, p) => { assert.equal(r.line.shot.anchor, 'found'); assert.equal(r.line.shot.dark, false); assert.ok(ringAt(p, MIDDLE)); }]),
    ['a page that moves between its light and its dark picture', { path: 'moves-dark.html' }, { w: 1400, h: 860 }, (r, p) => { assert.equal(r.line.shot.anchor, 'found'); assert.equal(r.line.shot.dark, false); assert.ok(ringAt(p, MIDDLE)); }],
    ...[['a page that changes its hash all the time', 'hashes.html'], ['a page that writes its document anew between its two pictures', 'reopens.html']].map(([what, file]) => [what, { path: file }, { w: 1400, h: 860 }, (r, p) => { assert.equal(r.line.shot.anchor, 'found'); assert.equal(r.line.shot.dark, false); assert.ok(ringAt(p, MIDDLE)); }]),
    ['a page with a default button and no dark styles', { path: 'plain.html' }, undefined, (r) => assert.equal(r.line.shot.dark, false)],
    ['C3h', { point: { x: 40, y: 20 }, path: 'scrolled.html', anchor: undefined }, undefined, (r, p) => { assert.ok(near(p.px(40, 20), [255, 0, 0]), String(p.px(40, 20))); assert.ok(near(p.px(40, 80), [0, 0, 255])); }],
    ['C3x a query string in path', { path: 'found.html?x=1' }, undefined, (r) => assert.equal(r.line.shot.anchor, 'found')],
    ['C5x a page whose script throws', { path: 'throws.html' }, undefined, (r) => assert.equal(r.line.shot.anchor, 'found')],
    ['C8d a page that alerts', { path: 'alert.html' }, undefined, (r) => assert.equal(r.line.shot.anchor, 'found')],
  ], async ([what, o, frame, check]) => {
    const r = await k.readyOn(k.subject(o), { frame });
    assert.equal(r.status, 0, `${what}: ${said(r)}`);
    try { check(r, k.light(r)); } catch (e) { e.message = `${what}: ${e.message}`; throw e; }
  });
});

test('C5 the state of the spot, and the view it is on', async () => {
  const k = shotKit();
  const tab = { w: 1400, h: 860, hash: '#tab2' };
  const green = (r, p) => assert.ok(near(p.px(40, 20), [0, 170, 0]), String(p.px(40, 20)));
  await each([
    ['C5b', k.subject({ path: 'changed.html' }), undefined, 'changed', (r) => assert.match(r.out, /text "Start free trial"/)],
    ['C5c', k.subject({ path: 'details.html' }), undefined, 'found', (r, p) => assert.deepEqual([p.w, p.h], [320, 200])],
    ['C5d', k.subject({ path: 'tabs-js.html' }), undefined, 'hidden', (r, p) => assert.ok(ringAt(p, MIDDLE))],
    ['C5e', k.subject({ path: 'gone.html' }), undefined, 'gone', (r, p) => assert.ok(ringAt(p, MIDDLE))],
    ['C5f', k.pointNote(), undefined, 'point', (r, p) => assert.deepEqual([p.w, p.h], [480, 320])],
    ['C5g #tab2', k.subject({ path: 'tabs.html' }), tab, 'found', () => {}],
    ['C5g none', k.subject({ path: 'tabs.html' }), { ...tab, hash: '' }, 'hidden', () => {}],
    ['an element note whose path has a hash', k.subject({ path: 'tabs.html#tab2' }), { ...tab, hash: '' }, 'hidden', () => {}],
    ['C5h no frame', k.pointNote({ path: 'tabs.html#tab2' }), undefined, 'point', green],
    ['C5h a frame with no hash', k.pointNote({ path: 'tabs.html#tab2' }), { ...tab, hash: '' }, 'point', green],
  ], async ([what, s, frame, state, check]) => {
    const r = await k.readyOn(s, { frame });
    assert.equal(r.status, 0, `${what}: ${said(r)}`);
    assert.equal(r.line.shot.anchor, state, what);
    try { check(r, k.light(r)); } catch (e) { e.message = `${what}: ${e.message}`; throw e; }
  });
});

test('C6a a page with dark styles has a dark picture', async () => {
  const k = shotKit();
  const r = await k.readyOn(k.subject({ path: 'dark.html' }));
  assert.equal(r.status, 0, said(r));
  const { shot } = r.line;
  assert.equal(shot.dark, true);
  const dark = fs.readFileSync(path.join(k.shots, r.id, `${shot.stamp}-dark.png`));
  assert.equal(shot.sum.dark, sha256(dark));
  assert.ok(near(png(dark).px(20, 20), [0x11, 0x11, 0x11]));
  assert.ok(near(k.light(r).px(20, 20), [255, 255, 255]));
  assert.ok(ringAt(png(dark), MIDDLE));
  assert.match(r.stdout, /-light\.png \(and -dark\.png\)/);
});

test('C15b the page is not trusted with what is printed or recorded', async () => {
  const k = shotKit();
  const r = await k.readyOn(k.subject({ path: 'hostile.html' }));
  assert.equal(r.status, 0, said(r));
  const text = JSON.parse(/text (".*")$/m.exec(r.stdout)[1]);
  assert.ok([...text].length <= 80 && text.includes('[link removed]'), text);
  assert.ok(!r.stdout.includes('\u202e') && !r.stdout.includes('abcdefghijklmnop'));
  const bad = await k.readyOn(k.subject({ path: 'badstate.html' }));
  assert.equal(bad.status, 1);
  assert.match(bad.out, /the page answered the picture with something else/);
  assert.equal(bad.line, undefined);
  assert.deepEqual(k.files(bad.id), []);
});

test('C5y two captures at once', async () => {
  const k = shotKit();
  const ids = [await k.note(k.subject()), await k.note(k.subject())];
  const hooks = [seenFile(), seenFile()];
  const rs = await Promise.all(ids.map((id, i) => k.ready(id, { DEVTEAM_TEST_SHOT_SEEN: hooks[i] })));
  for (const r of rs) assert.equal(r.status, 0, said(r));
  const of = (i, re) => k.seen(hooks[i]).map((l) => re.exec(l)?.[1]).filter(Boolean);
  for (const re of [/ profile=(.*)$/, /^continue (http:\/\/127\.0\.0\.1:\d+)/]) assert.equal(of(0, re).filter((x) => of(1, re).includes(x)).length, 0, String(re));
  for (const r of rs) { assert.deepEqual(k.files(r.id), [`${r.line.shot.stamp}-light.png`]); assert.equal(r.line.shot.sum.light, sha256(lit(k, r))); }
});

test('C15b each part of the page\'s answer is checked', () => {
  const { shotTrust } = cut(['shotTrust'], { isObj: (o) => !!o && typeof o === 'object' && !Array.isArray(o), uncapped: (x) => x, UNSAFE_TEXT_ALL: /[\x00-\x1f]/g, SHOT_ANSWER: 'no answer' });
  const good = { state: 'found', box: { x: 1, y: 2, w: 3, h: 4 }, text: 'a', innerWidth: 3840, innerHeight: 2160 };
  assert.equal(shotTrust(good).text, 'a');
  for (const bad of [{ state: 'ok' }, { state: ['found'] }, { box: null }, { box: { ...good.box, x: NaN } }, { box: { ...good.box, y: '2' } }, { box: { ...good.box, w: -1 } }, { box: { ...good.box, h: -1 } }, { box: { ...good.box, w: Infinity } }, { innerWidth: 3841 }, { innerHeight: 2161 }, { innerWidth: 0 }, { innerWidth: 900.5 }]) assert.throws(() => shotTrust({ ...good, ...bad }), /no answer/, JSON.stringify(bad));
});

test('C3 what was taken while the page moved is of two documents, and is not kept', async () => {
  const { shotOfOne } = cut(['shotOfOne']);
  const launch = { page: { moves: 3 } };
  assert.equal(await shotOfOne(launch, async () => 'both'), 'both');
  assert.equal(await shotOfOne(launch, async () => { launch.page.moves++; return 'both'; }), null);
  assert.equal(await shotOfOne(launch, async () => { launch.page.moves++; throw new Error('its context is gone'); }), null);
  await assert.rejects(shotOfOne(launch, async () => { throw new Error('a page that stays'); }), /a page that stays/);
});

test('a draft\'s file is read only when it is a plain one within the limit', () => {
  const dir = fs.mkdtempSync(path.join(TMP, 'read'));
  const { shotRead } = cut(['shotRead'], { fs, ARTIFACT_FILE_MAX: 10 });
  const at = (n) => ({ abs: path.join(dir, n), read: () => assert.fail('the reader it had') });
  fs.writeFileSync(path.join(dir, 'ten'), '0123456789');
  fs.writeFileSync(path.join(dir, 'eleven'), '01234567890');
  fs.symlinkSync('ten', path.join(dir, 'link'));
  fs.mkdirSync(path.join(dir, 'folder'));
  assert.equal(String(shotRead(at('ten'))), '0123456789');
  assert.equal(shotRead(at('eleven')), null);
  assert.equal(shotRead(at('folder')), null);
  assert.throws(() => shotRead(at('link')), /ELOOP/);
  assert.equal(shotRead({ read: () => 'main' }), 'main');
});

test('C3 the clip stays inside the frame at each edge', () => {
  const { shotClip } = cut(['shotClip']);
  const at = (x, y, w = 40, h = 20) => Object.values(shotClip({ x, y, w, h }, { w: 900, h: 700 }));
  assert.deepEqual(at(12, 12), [0, 0, 320, 200]);
  assert.deepEqual(at(850, 670), [580, 500, 320, 200]);
  assert.deepEqual(at(5000, 5000), [580, 500, 320, 200]);
  assert.deepEqual(at(-5000, -5000), [0, 0, 320, 200]);
  assert.deepEqual(at(400, 300, 5000, 5000), [0, 0, 900, 700]);
});

test('a picture\'s stamp is its thread\'s own, and shots itself may be no symlink', () => {
  const runDir = fs.mkdtempSync(path.join(TMP, 'run'));
  const { shotWrite } = cut(['shotStamp', 'shotsDir', 'shotFolder', 'shotWrite'], { fs, path, crypto, runDir, THREAD_ID: /^t-[a-z0-9-]+$/ });
  const now = Date.parse('2026-11-24T10:00:00.999Z');
  assert.deepEqual([0, 1, 2].map(() => shotWrite('t-1', Buffer.from('x'), null, now).stamp), ['20261124-100000999', '20261124-100001000', '20261124-100001001']);
  fs.rmSync(path.join(runDir, 'shots'), { recursive: true });
  const away = fs.mkdtempSync(path.join(TMP, 'away'));
  fs.symlinkSync(away, path.join(runDir, 'shots'));
  assert.throws(() => shotWrite('t-1', Buffer.from('x'), null, now), /isn't a plain folder/);
  assert.deepEqual(fs.readdirSync(away), []);
});

// kit-813: a page's WebRTC under the picture's Chrome, counted as kit-805 counts the browser's. While the
// page holds WebRTC open (its fonts are ready only once it has told), the UDP sockets on 5353 (mDNS)
// that Chrome's group holds; what reaches this file's listeners; and what the page was given.
const procNet = (f) => { try { return fs.readFileSync(`/proc/net/${f}`, 'utf8').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c.length > 1); } catch { return []; } };
// the socket inodes of every process whose group is leader's
function groupSockets(leader) {
  const held = new Set();
  for (const d of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      if (Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[2]) !== leader) continue;
      for (const fd of fs.readdirSync(`/proc/${d}/fd`)) { const m = /^socket:\[(\d+)\]$/.exec(fs.readlinkSync(`/proc/${d}/fd/${fd}`)); if (m) held.add(m[1]); }
    } catch {}
  }
  return { mdns: ['udp', 'udp6'].flatMap(procNet).filter((c) => c[1].endsWith(':14E9') && held.has(c[9])).length, tcp: ['tcp', 'tcp6'].flatMap(procNet).filter((c) => held.has(c[9])).length };
}
const RTC_PAGE = `<!doctype html><title>RTC</title><button id="buy">Start trial</button><script>
let told;
Object.defineProperty(document, 'fonts', { value: { ready: new Promise((r) => { told = r; }) } });
(async () => {
  const turn = (urls) => ({ urls, username: 'u', credential: 'c' });
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${udp.address().port}' }, { urls: 'stun:rtc-stun.local:3478' }, turn('turn:127.0.0.1:${tcp.address().port}?transport=tcp'), turn('turn:rtc-turn.local:3478?transport=tcp'), turn('turn:rtc-turn.invalid:3478')] });
  pc.createDataChannel('x');
  await pc.setLocalDescription(await pc.createOffer());
  const peer = new RTCPeerConnection();
  await peer.setRemoteDescription(pc.localDescription);
  await peer.setLocalDescription(await peer.createAnswer());
  await pc.setRemoteDescription(peer.localDescription);
  let added = 0;
  for (const c of ['udp 2122260223 127.0.0.1 ${udp.address().port} typ host', 'tcp 2122260222 127.0.0.1 ${tcp.address().port} typ host tcptype passive', 'udp 2122260221 rtc-ice.local 9 typ host', 'udp 2122260220 RTC-UP.LOCAL. 9 typ host']) { await pc.addIceCandidate({ candidate: 'candidate:1 1 ' + c, sdpMid: '0' }); added++; }
  await new Promise((r) => setTimeout(r, 2500));
  const shown = [...(await pc.getStats()).values()].filter((x) => x.type === 'local-candidate' && x.address && x.address !== '0.0.0.0' && x.address !== '::').map((x) => x.address);
  fetch('rtc-done-' + added + '-' + pc.localDescription.sdp.split('\\n').filter((l) => l.startsWith('a=candidate')).length + '-' + (shown.join('_') || 'none')).finally(told);
})().catch((e) => fetch('rtc-done-' + encodeURIComponent(e)).finally(told));
</script>`;

test('K1 a page\'s WebRTC joins no mDNS group and sends nothing round the dead proxy (kit-813)', async () => {
  const k = shotKit();
  fs.writeFileSync(path.join(k.arts, 'pricing', 'rtc.html'), RTC_PAGE);
  k.F.g(['add', '-A'], k.F.old);
  k.F.g(['commit', '-qm', 'rtc'], k.F.old);
  k.F.g(['push', '-q', 'origin', 'main'], k.F.old);
  // Chrome as the kit runs it; the wrapper's pid is the group's leader, as exec keeps it
  const pids = path.join(TMP, 'rtc-chrome.pid'), wrap = path.join(TMP, 'rtc-chrome.sh');
  fs.writeFileSync(wrap, `#!/bin/sh\necho "$$" >> '${pids}'\nexec '${chromePath}' "$@"\n`, { mode: 0o755 });
  const linux = fs.existsSync('/proc/net/udp');
  const held = { mdns: 0, read: !linux };
  let over = false;
  const watch = (async () => {
    while (!over) {
      for (const p of fs.existsSync(pids) ? fs.readFileSync(pids, 'utf8').trim().split('\n').map(Number) : []) { const g = groupSockets(p); held.mdns = Math.max(held.mdns, g.mdns); held.read ||= g.tcp > 0; }
      await new Promise((r) => setTimeout(r, 100));
    }
  })();
  reached.length = 0;
  const hook = seenFile();
  let r;
  try { r = await k.readyOn(k.subject({ path: 'rtc.html' }), { CHROME_PATH: wrap, DEVTEAM_TEST_SHOT_SEEN: hook }); } finally { over = true; await watch; }
  assert.equal(r.status, 0, r.out);
  const told = k.seen(hook).filter((l) => l.startsWith('serve /rtc-done-')).map((l) => l.split(' ')[1].slice('/rtc-done-'.length));
  assert.equal(told.length, 1, `the page told once: ${told.join(' | ')}`);
  const [added, candidates, shown] = told[0].split('-');
  assert.equal(added, '4', `the page offered, and added its four candidates: ${told[0]}`);
  assert.ok(held.read, "the sockets of Chrome's network process can be read");
  assert.deepEqual({ mdns: held.mdns, reached: [...reached], candidates, shown }, { mdns: 0, reached: [], candidates: '0', shown: 'none' });
});
