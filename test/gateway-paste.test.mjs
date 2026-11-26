// A pasted image on the box's Terminal page (cloud/gateway.mjs, TERM_DROP; kit-690): the gateway's real
// page, scripts and POST /upload, in headless Chrome. ttyd is not here: its page is a stand-in that loads
// the xterm.js ttyd 1.7.7 bundles (its yarn.lock: 5.4.0) and, as ttyd's does, sends what onData gives to
// its socket; the socket is a fake. So what xterm.js types and what its paste handler does are real.
// xterm.js comes from jsdelivr, checked against its sha256: the kit has no packages.
// Run: node --test --test-concurrency=1 test/gateway-paste.test.mjs (Node 22 or later, and Chrome)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PORTS } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
delete process.env.DEVTEAM_CLAIM_TOKEN;
const G = await import(pathToFileURL(path.join(repo, 'cloud', 'gateway.mjs')).href);
const XTERM = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.4.0/lib/xterm.js';
const XTERM_SHA256 = '32900c1a490da904f7042f1257c54c259d05c21d220624854c87829fb018e106';
const GATEWAY = PORTS + 40;
const ORIGIN = `http://term.box.localhost:${GATEWAY}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-paste-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function xterm() {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(XTERM, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`${XTERM}: ${r.status}`);
      const js = Buffer.from(await r.arrayBuffer());
      assert.equal(sha(js).toString('hex'), XTERM_SHA256, 'the pinned xterm.js');
      return js.toString('utf8');
    } catch (e) { if (i === 2) throw e; await sleep(1000 * (i + 1)); }
  }
}
// Put in before any of the page's scripts: a socket that records what is sent and opens or drops when told.
const FAKE_SOCKET = `window.sent = [];
window.WebSocket = class extends EventTarget {
  constructor() { super(); this.readyState = 0; window.sock = this; setTimeout(() => window.sockOpen(), 0); }
  send(d) { window.sent.push(d); }
  close() {}
};
window.sockOpen = () => { window.sock.readyState = 1; window.sock.dispatchEvent(new Event('open')); };
window.sockDrop = () => { window.sock.readyState = 3; };`;
const page = (lib) => `<!DOCTYPE html><html><head><meta charset="utf-8"><style>.xterm-helper-textarea{position:absolute;left:-9999em;top:0;opacity:0}</style></head><body><div id="t" style="width:640px;height:300px"></div>
<script class="stand-in">${lib}</script><script class="stand-in">
const sock = new WebSocket('ws://x');
const t = new Terminal();
t.open(document.getElementById('t'));
window.data = []; window.pasted = [];
t.onData((d) => { window.data.push(d); if (sock.readyState === 1) sock.send(d); });
const paste = t.paste.bind(t);
t.paste = (d) => { window.pasted.push(d); paste(d); };
window.term = t;
t.focus();
</script></body></html>`;

let gateway, chrome, cookie, uploads;
before(async () => {
  if (!canDrive) return;
  const lib = await xterm();
  const dir = path.join(tmp, 'gw');
  fs.mkdirSync(dir);
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const token = crypto.randomBytes(32);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    passkeys: [{ id: 'k-owner', userId: 'u', jwk: {}, alg: -7, signCount: 0, name: 'passkey 1', rp: 'box.localhost', createdAt: iso }], claimHash: null,
    sessions: [{ hash: sha(token).toString('base64url'), method: 'k-owner', at: now, expires: now + 3600e3 }],
  }));
  cookie = token.toString('base64url');
  uploads = path.join(tmp, 'uploads');
  fs.mkdirSync(uploads, { mode: 0o750 });
  const ttydPage = path.join(tmp, 'ttyd.html');
  fs.writeFileSync(ttydPage, page(lib));
  gateway = G.createGateway({ publicUrl: `http://box.localhost:${GATEWAY}`, dir, ttydPort: PORTS + 41, ttydPage, uploadsDir: uploads, log: () => {} });
  await new Promise((ok, no) => { gateway.server.once('error', no); gateway.server.listen(GATEWAY, '127.0.0.1', ok); });
  chrome = await openChrome();
}, { timeout: 150000 });
after(async () => {
  await chrome?.close();
  gateway?.server.closeAllConnections?.();
  if (gateway) await new Promise((r) => gateway.server.close(r));
});

const WINDOWS = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', platform: 'Win32' };
const LINUX = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', platform: 'Linux x86_64' };
const MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', platform: 'MacIntel' };
async function open(t, who = LINUX) {
  const p = await chrome.newPage();
  t.after(() => p.close());
  for (const d of ['Page', 'Network', 'Runtime']) await p.send(`${d}.enable`);
  await p.send('Emulation.setUserAgentOverride', who);
  await p.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await p.send('Network.setCookie', { name: 'devteam_session', value: cookie, url: `${ORIGIN}/`, httpOnly: true });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE_SOCKET });
  await p.send('Page.navigate', { url: `${ORIGIN}/` });
  const wait = async (expr, what, ms = 10000) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await p.ev(expr).catch(() => false)) return; assert.fail(`timed out: ${what}; ${JSON.stringify(await state().catch((e) => e.message))}`); };
  const state = () => p.ev(`({ pasted: window.pasted, data: window.data, sent: window.sent, note: document.getElementById('devteam-drop-note')?.textContent ?? '', shown: document.getElementById('devteam-drop-note')?.style.display ?? '', busy: !!window.devteamDropBusy && window.devteamDropBusy() })`);
  // ready, as the page counts it: the socket has been open for its settle time
  await wait(`!!window.term && !!window.devteamTermSocket && window.devteamTermSocket.at > 0 && Date.now() - window.devteamTermSocket.at > 1600`, 'the terminal');
  // the uploads the page makes, as it makes them
  await p.ev(`(() => { window.posts = []; const o = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u) { window.posts.push(m + ' ' + u); return o.apply(this, arguments); }; })()`);
  const paste = (spec) => p.ev(`(async () => {
    const bytes = { png: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', bmp: '${BMP}' };
    const s = ${JSON.stringify(spec)};
    const d = new DataTransfer();
    for (const [name, type, what] of s.files ?? []) d.items.add(new File([bytes[what] ? Uint8Array.from(atob(bytes[what]), (c) => c.charCodeAt(0)) : what], name, { type }));
    if (s.text !== undefined) d.setData('text/plain', s.text);
    if (s.html !== undefined) d.setData('text/html', s.html);
    const e = new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true, composed: true });
    document.querySelector('.xterm-helper-textarea').dispatchEvent(e);
    return e.defaultPrevented;
  })()`);
  const key = async (k, code, vk, modifiers, commands) => {
    await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers, ...(commands ? { commands } : {}) });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  return { ...p, wait, state, paste, key };
}
const SHOT = ['image.png', 'image/png', 'png'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// two pixels, red then blue, so a redraw that loses or crops them shows
const BMP = (() => {
  const b = Buffer.alloc(62);
  b.write('BM');
  b.writeUInt32LE(62, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14); b.writeInt32LE(2, 18); b.writeInt32LE(1, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(8, 34);
  b.set([0, 0, 255, 255, 0, 0], 54);
  return b.toString('base64');
})();
const URL1 = 'https://example.com/cat';
const IMG = `<img src="${URL1}" alt="a cat">`;
const PATH = /^\/\S+\/\d{4}-\d{2}-\d{2}-[0-9a-f]{24}\/(\S+)$/;
const STAMPED = /^pasted-\d{8}-\d{6}\.png$/;
const READ = "That image can't be read here. Save it and drop the file.";
const ONLY = 'Only images paste here. Drop other files instead.';
// one image paste, all the way to the pane: what was typed is its stored path and nothing else
async function image(p, spec, name, { note, bytes } = {}) {
  assert.equal(await p.paste(spec), true, 'the browser\'s own paste is prevented');
  await p.wait('window.pasted.length > 0', 'the path pasted');
  const s = await p.state();
  assert.equal(s.pasted.length, 1, JSON.stringify(s));
  const at = PATH.exec(s.pasted[0]);
  assert.ok(at, `a stored path, with no space or Enter: ${JSON.stringify(s.pasted)}`);
  assert.match(at[1], name);
  assert.deepEqual(s.data, [s.pasted[0]], 'xterm.js gave the path alone');
  assert.deepEqual(s.sent, [s.pasted[0]], 'and the socket was sent the path alone');
  assert.ok(fs.statSync(s.pasted[0]).size > 0 && s.pasted[0].startsWith(uploads), 'the file is stored');
  if (bytes) assert.deepEqual(fs.readFileSync(s.pasted[0]), bytes, 'the bytes pasted are the bytes stored');
  assert.deepEqual(await p.ev('window.posts'), [`POST /upload?name=${encodeURIComponent(at[1])}`], 'one upload, by the drop\'s route');
  assert.ok(s.note.includes(note ?? 'Pasted to the focused pane.'), s.note);
  return s.pasted[0];
}
// a paste left to the terminal: its text, and no upload
async function text(p, spec) {
  await p.paste(spec);
  await sleep(700);
  const s = await p.state();
  assert.equal(s.data.join(''), spec.text.replace(/\r?\n/g, '\r'), 'the text is typed');
  assert.deepEqual(await p.ev('window.posts'), [], 'and nothing is uploaded');
  assert.deepEqual(s.pasted, [], 'and no path is pasted');
  assert.equal(s.note, '', 'and no note');
}
const on = (name, fn) => test(name, { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 120000 }, fn);
const each = (rule, list) => { for (const [what, fn] of list) on(`paste ${rule}: ${what}`, async (t) => fn(await open(t))); };

each('rules', [
  ['a screenshot (P2)', (p) => image(p, { files: [SHOT] }, STAMPED, { bytes: PNG })],
  ['Chrome\'s Copy Image, a PNG and HTML of a lone img (P2)', (p) => image(p, { files: [SHOT], html: `<meta charset='utf-8'>${IMG}` }, STAMPED)],
  ['Firefox\'s Copy Image, its address as text and a meta before the img (P2)', (p) => image(p, { files: [SHOT], text: URL1, html: `<meta charset='utf-8'>${IMG}` }, STAMPED)],
  ['Firefox\'s Copy Image in the fragment wrappers Windows adds (P2)', (p) => image(p, { files: [SHOT], text: `${URL1}\r\n`, html: `<html>\r\n<body>\r\n<!--StartFragment--><meta charset='utf-8'>${IMG}<!--EndFragment-->\r\n</body>\r\n</html>` }, STAMPED)],
  ['a Finder copy of shot.jpg, the file and its name as text (P2)', (p) => image(p, { files: [['shot.jpg', 'image/jpeg', 'png']], text: 'shot.jpg' }, /^shot\.jpg$/)],
  ['a spreadsheet\'s cells paste their text (P1)', (p) => text(p, { files: [SHOT], text: 'a\tb\r\n1\t2\r\n', html: '<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>' })],
  ['one cell holding an address pastes its text (P1)', (p) => text(p, { files: [SHOT], text: `${URL1}\r\n`, html: `<table><tr><td>${URL1}</td></tr></table>` })],
  ['a cell that holds an img in a table pastes its text (P1)', (p) => text(p, { files: [SHOT], text: URL1, html: `<table><tr><td>${IMG}</td></tr></table>` })],
  ['an img with words beside it pastes its text (P1)', (p) => text(p, { files: [SHOT], text: URL1, html: `${IMG} see this` })],
  ['one word and an image pastes the word (P1)', (p) => text(p, { files: [SHOT], text: 'hello' })],
  ['two lines, the first an address, paste as text (P1)', (p) => text(p, { files: [SHOT], text: `${URL1}\nlook` })],
  ['two lines, the last a file name, paste as text (P1)', (p) => text(p, { files: [SHOT], text: 'look\nholiday.png' })],
  ['a PDF with words pastes the words (P1)', (p) => text(p, { files: [['a.pdf', 'application/pdf', '%PDF']], text: 'two words' })],
  ['a PNG with a PDF: the image goes and the note says the rest did not (P2b)', async (p) => {
    const at = await image(p, { files: [SHOT, ['a.pdf', 'application/pdf', '%PDF']] }, STAMPED, { note: ONLY });
    assert.ok((await p.state()).note.includes(at), 'and names the path');
  }],
  ['two images paste together, joined by a space (P2)', async (p) => {
    await p.paste({ files: [['a.png', 'image/png', 'png'], ['b.png', 'image/png', 'png']] });
    await p.wait('window.pasted.length > 0', 'the paths pasted');
    const s = await p.state();
    assert.match(s.pasted[0], /^\S+\/a\.png \S+\/b\.png$/, 'in order, no trailing space');
    assert.deepEqual(s.data, s.pasted);
  }],
  ['a PDF alone pastes nothing and says why (P3)', async (p) => {
    assert.equal(await p.paste({ files: [['a.pdf', 'application/pdf', '%PDF']] }), true);
    await sleep(700);
    const s = await p.state();
    assert.equal(s.note, ONLY);
    assert.equal(s.shown, 'block');
    assert.deepEqual([s.data, s.sent, s.pasted, await p.ev('window.posts')], [[], [], [], []]);
  }],
  ['a Finder copy of a PDF, the file and its name as text, pastes nothing and says why (P3)', async (p) => {
    assert.equal(await p.paste({ files: [['a.pdf', 'application/pdf', '%PDF']], text: 'a.pdf' }), true);
    await p.wait(`document.getElementById('devteam-drop-note').textContent === ${JSON.stringify(ONLY)}`, 'the note');
    const s = await p.state();
    assert.deepEqual([s.data, s.pasted, await p.ev('window.posts')], [[], [], []]);
  }],
  ['each text that only names its files, and each that only looks like one (P2, P1)', async (p) => {
    for (const named of ['http://x.test/a', 'https://x.test/a', 'HTTPS://x.test/a', 'file:///a', 'data:image/png;base64,AA', 'image.png\r\n', ...['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tif', 'tiff', 'bmp'].map((e) => `holiday.${e}`)]) assert.equal(await p.paste({ files: [SHOT], text: named }), true, `names its image: ${named}`);
    // every one that is taken for a name, so one run shows them all
    const taken = [];
    for (const words of ['see https://x.test/a', 'holiday.png is nice', 'holiday.pdf', 'ftp://x.test/a', 'holiday.tiffany',
      'https://x.test/a is down, please look', 'http: server closed the connection', 'https: see below', 'file: not found', 'data: 3 rows failed to load', 'https:',
      'https://x.test/a\tb', 'https://x.test/a b', 'https://x.test/a\u000bb', 'https://x.test/a b', 'https://x.test/a\fb', 'look holiday.png', 'look\u000bholiday.png', 'https://x.test/a\u0085holiday.png', 'look\rholiday.png', 'look\fholiday.png', 'look\u2029holiday.png', 'https://x.test/a\u00a0look', 'https://x.test/a\u2003look']) if (await p.paste({ files: [SHOT], text: words })) taken.push(words);
    assert.deepEqual(taken, [], 'taken for a name, and their words lost');
    assert.equal(await p.paste({ files: [SHOT], text: 'https://x.test/a is down, look', html: IMG }), false, 'words after an address, beside HTML of a lone img');
  }],
  ['an address with no file pastes as text', (p) => text(p, { text: URL1 })],
  ['an empty paste does nothing (P4)', async (p) => {
    await p.paste({});
    await sleep(700);
    const s = await p.state();
    assert.deepEqual([s.data.join(''), s.pasted, s.note, await p.ev('window.posts')], ['', [], '', []]);
  }],
]);

test('paste rules: a drop\'s note still says Sent, a paste\'s Pasted', () => {
  assert.ok(G.dropNote(['/d/a.png']).startsWith('Sent to the focused pane. '));
  assert.ok(G.dropNote(['/d/a.png'], 'Pasted').startsWith('Pasted to the focused pane. '));
});

each('names', [
  ['a clipboard image is pasted-<date>-<time> in local time', async (p) => {
    await p.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Kathmandu' }); // never UTC
    const at = await image(p, { files: [SHOT] }, STAMPED);
    const now = await p.ev(`(() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]; })()`);
    const m = /pasted-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)\.png$/.exec(at).slice(1).map(Number);
    const ms = (a) => Date.UTC(a[0], a[1] - 1, a[2], a[3], a[4], a[5]);
    assert.ok(ms(now) - ms(m) >= 0 && ms(now) - ms(m) < 30000, `${m} is the moment of the paste (${now})`);
  }],
  ['a copied file keeps its name', (p) => image(p, { files: [['shot.jpg', 'image/jpeg', 'png']] }, /^shot\.jpg$/)],
  ['a clipboard GIF goes as it is, byte for byte', (p) => image(p, { files: [['image.gif', 'image/gif', 'GIF89a, two frames']] }, /^pasted-\d{8}-\d{6}\.gif$/, { bytes: Buffer.from('GIF89a, two frames') })],
  ['a clipboard WebP goes as it is, byte for byte', (p) => image(p, { files: [['image.webp', 'image/webp', 'RIFF, a webp']] }, /^pasted-\d{8}-\d{6}\.webp$/, { bytes: Buffer.from('RIFF, a webp') })],
  ['a clipboard image with no name is stamped', (p) => image(p, { files: [['', 'image/png', 'png']] }, STAMPED)],
  ['a clipboard JPEG is named .jpg', (p) => image(p, { files: [['image.jpg', 'image/jpeg', 'png']] }, /^pasted-\d{8}-\d{6}\.jpg$/)],
  ['a JPEG named shot.jfif keeps its name, and arrives as a path with the drop\'s space', async (p) => {
    await p.paste({ files: [['shot.jfif', 'image/jpeg', 'png']] });
    await p.wait('window.sent.length === 2', 'the path and its space');
    const s = await p.state();
    assert.equal(PATH.exec(s.pasted[0])[1], 'shot.jfif');
    assert.deepEqual(s.sent, [s.pasted[0], ' ']);
    assert.ok(fs.statSync(s.pasted[0]).size > 0, 'stored');
  }],
  ['a BMP is redrawn as PNG, under its own name', async (p) => {
    const at = await image(p, { files: [['scan.bmp', 'image/bmp', 'bmp']] }, /^scan\.png$/);
    const png = fs.readFileSync(at);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG bytes');
    const pixels = await p.ev(`(async () => { const b = await createImageBitmap(new Blob([Uint8Array.from(atob('${png.toString('base64')}'), (c) => c.charCodeAt(0))])); const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; const x = c.getContext('2d'); x.drawImage(b, 0, 0); return [b.width, b.height, ...x.getImageData(0, 0, b.width, b.height).data]; })()`);
    assert.deepEqual(pixels, [2, 1, 255, 0, 0, 255, 0, 0, 255, 255], 'the same picture');
  }],
  ['a clipboard BMP is redrawn and stamped', (p) => image(p, { files: [['image.bmp', 'image/bmp', 'bmp']] }, STAMPED)],
  ['an image the browser can\'t decode uploads nothing and says so', async (p) => {
    await p.paste({ files: [['image.tiff', 'image/tiff', 'not a picture']] });
    await p.wait(`document.getElementById('devteam-drop-note').textContent === ${JSON.stringify(READ)}`, 'the note');
    const s = await p.state();
    assert.deepEqual([s.data, s.pasted, await p.ev('window.posts'), s.busy], [[], [], [], false]);
  }],
]);

// A file dropped on the page, as the drop's own code takes it.
const drop = (p, name) => p.ev(`(() => { const d = new DataTransfer(); d.items.add(new File(['dropped'], ${JSON.stringify(name)}, { type: 'image/png' })); document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: d, bubbles: true, cancelable: true })); })()`);
on('paste rules: a drop on the page still uploads, pastes and says Sent, after a paste too', async (t) => {
  const p = await open(t);
  await image(p, { files: [SHOT] }, STAMPED);
  await drop(p, 'plan.png');
  await p.wait('window.pasted.length === 2', 'the dropped path pasted');
  const s = await p.state();
  assert.match(s.pasted[1], /\/plan\.png$/);
  assert.equal(fs.readFileSync(s.pasted[1], 'utf8'), 'dropped');
  assert.ok(s.note.startsWith('Sent to the focused pane.'), s.note);
});
on('paste rules: pastes upload one at a time, in order, and one that can\'t be read leaves the rest', async (t) => {
  const p = await open(t);
  await p.ev(`(() => { const s = XMLHttpRequest.prototype.send; window.held = []; XMLHttpRequest.prototype.send = function (b) { window.held.push(() => s.call(this, b)); }; })()`);
  await p.paste({ files: [['image.tiff', 'image/tiff', 'not a picture'], ['a.png', 'image/png', 'png']] });
  await p.paste({ files: [['b.png', 'image/png', 'png']] });
  await p.wait('window.held.length > 0', 'the first upload');
  await sleep(700);
  assert.deepEqual(await p.ev('window.posts'), ['POST /upload?name=a.png'], 'the second waits for the first');
  await p.ev('window.held[0]()');
  await p.wait('window.held.length === 2', 'the second upload');
  const s = await p.state();
  assert.match(s.pasted[0] ?? '', /\/a\.png$/, 'the first is pasted');
  await p.ev('window.held[1]()');
  await p.wait('window.pasted.length === 2', 'the second path pasted');
  assert.match((await p.state()).pasted[1], /\/b\.png$/);
});
on('paste offline: a paste while the socket is down is stored, said, and pasted once it is back; busy until then', async (t) => {
  const p = await open(t);
  // the upload held, so busy is seen before it is answered
  await p.ev(`(() => { const s = XMLHttpRequest.prototype.send; XMLHttpRequest.prototype.send = function (b) { window.go = () => s.call(this, b); }; window.sockDrop(); })()`);
  assert.equal((await p.state()).busy, false);
  await p.paste({ files: [SHOT] });
  assert.equal((await p.state()).busy, true, 'from the paste');
  await p.wait('!!window.go', 'the upload asked');
  await p.ev('window.go()');
  await p.wait(`document.getElementById('devteam-drop-note').textContent.includes('terminal not connected: stored at ')`, 'the offline note');
  let s = await p.state();
  const at = /stored at (\S+)/.exec(s.note)[1];
  assert.ok(fs.existsSync(at), 'stored');
  assert.deepEqual([s.pasted, s.sent, s.busy], [[], [], true], 'nothing pasted, still busy');
  // a PDF pasted meanwhile says so, and leaves the stored path on screen
  await p.paste({ files: [['a.pdf', 'application/pdf', '%PDF']] });
  await p.wait(`document.getElementById('devteam-drop-note').textContent.includes(${JSON.stringify(ONLY)})`, 'the images-only words');
  assert.ok((await p.state()).note.includes(`stored at ${at}`), 'the stored path is still on screen');
  await p.ev('window.sockOpen()');
  await p.wait('window.pasted.length > 0', 'the path pasted');
  s = await p.state();
  assert.deepEqual([s.pasted, s.sent, s.busy], [[at], [at], false]);
});

// What a browser puts on the clipboard is put there by a real copy, so the keys paste for real.
async function copy(p, what) {
  await p.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: ORIGIN });
  await p.ev(what === 'text'
    ? `navigator.clipboard.writeText('${URL1}')`
    : `(async () => { const c = document.createElement('canvas'); c.width = c.height = 2; c.getContext('2d').fillRect(0, 0, 2, 2); const b = await new Promise((r) => c.toBlob(r, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b${what === 'both' ? `, 'text/plain': new Blob(['${URL1}'], { type: 'text/plain' })` : ''} })]); })()`);
  await p.ev('window.term.focus()');
}
for (const [os, who] of [['Windows', WINDOWS], ['Linux', LINUX]]) {
  for (const [keys, args] of [['Ctrl+V', ['v', 'KeyV', 86, 2]], ['Shift+Insert', ['Insert', 'Insert', 45, 8]]]) {
    on(`paste chord: ${os}, ${keys} pastes the clipboard's image, and no ^V is sent`, async (t) => {
      const p = await open(t, who);
      await copy(p, 'image');
      await p.ev(`window.prevented = null; addEventListener('keydown', (e) => { setTimeout(() => { window.prevented = e.defaultPrevented; }, 0); }, true)`);
      await p.key(...args, ['paste']);
      await p.wait('window.pasted.length > 0', 'the path pasted');
      const s = await p.state();
      assert.match(PATH.exec(s.pasted[0])[1], STAMPED);
      assert.deepEqual(s.sent, s.pasted, 'the path alone: no ^V');
      assert.equal(await p.ev('window.prevented'), false, 'the key is not prevented');
    });
  }
  on(`paste chord: ${os}, Ctrl+Shift+V pastes the text and uploads nothing; Ctrl+C is ^C`, async (t) => {
    const p = await open(t, who);
    // an image and its address: an image that came through would upload
    await copy(p, 'both');
    await p.key('V', 'KeyV', 86, 10, ['pasteAndMatchStyle']);
    await p.wait(`window.sent.join('') === '${URL1}'`, 'the text typed');
    await sleep(700);
    assert.deepEqual(await p.ev('window.posts'), []);
    await p.key('c', 'KeyC', 67, 2);
    await p.wait(`window.sent.join('') === '${URL1}\\x03'`, '^C sent');
    await p.key('k', 'KeyV', 75, 2);
    await p.wait(`window.sent.join('') === '${URL1}\\x03\\x0b'`, 'a layout whose V key is a K still sends ^K');
  });
  on(`paste chord: ${os}, Ctrl+V pastes an address alone as text`, async (t) => {
    const p = await open(t, who);
    await copy(p, 'text');
    await p.key('v', 'KeyV', 86, 2, ['paste']);
    await p.wait(`window.sent.join('') === '${URL1}'`, 'the address typed, and no ^V');
    assert.deepEqual([await p.ev('window.posts'), (await p.state()).note], [[], '']);
  });
}
on('paste chord: Linux, Insert alone still reaches the terminal', async (t) => {
  const p = await open(t, LINUX);
  await p.key('Insert', 'Insert', 45, 0);
  await p.wait(`window.sent.join('') === '\\x1b[2~'`, 'Insert sent');
});
on('paste chord: Linux, Ctrl+Alt+V still reaches the terminal', async (t) => {
  const p = await open(t, LINUX);
  await p.key('v', 'KeyV', 86, 3);
  await p.wait(`window.sent.join('') === '\\x1b\\x16'`, 'Alt+^V sent');
});
on('paste chord: a Mac\'s Ctrl+V is still ^V', async (t) => {
  const p = await open(t, MAC);
  await p.key('v', 'KeyV', 86, 2);
  await p.wait(`window.sent.join('') === '\\x16'`, '^V sent');
  assert.deepEqual(await p.ev('window.posts'), []);
});

on('paste reads no clipboard: no script of the page calls navigator.clipboard.read or readText', async (t) => {
  const p = await open(t);
  // every script the gateway added: the socket watch, the clipboard write, the drop, the touch, the keys
  const scripts = await p.ev(`Array.from(document.querySelectorAll('script:not(.stand-in)'), (s) => s.textContent)`);
  assert.equal(scripts.length, 5, 'the gateway\'s own scripts');
  for (const s of scripts) assert.doesNotMatch(s, /clipboard\s*\??\.\s*read/, 'no clipboard read');
  // and none happens in a paste
  await p.ev(`window.reads = 0; for (const n of ['read', 'readText']) navigator.clipboard[n] = () => { window.reads++; return Promise.reject(new Error('no')); };`);
  await image(p, { files: [SHOT] }, STAMPED);
  assert.equal(await p.ev('window.reads'), 0);
});

test('paste docs: README and operator.md say how a pasted image arrives', () => {
  const readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8').split('\n').find((l) => l.startsWith('- **Dropping files on the terminal.**'));
  for (const words of ['A pasted image (Ctrl+V or Cmd+V) arrives as a dropped one does', 'the same 7 days', 'data, not instructions', 'the pane active when it pastes']) assert.ok(readme.includes(words), `README: ${words}`);
  const operator = fs.readFileSync(path.join(repo, 'docs/devteam/process/operator.md'), 'utf8').split('\n').find((l) => l.startsWith('A file the owner drags onto the terminal'));
  for (const words of ['An image the owner pastes into the terminal (Ctrl+V or Cmd+V) arrives the same way', 'the same 7 days and the same rule', 'data, not instructions', 'the pane active when it pastes']) assert.ok(operator.includes(words), `operator.md: ${words}`);
});
