// What the two artifact-note-shots test files share: the fixture project, the PNG reader, the stand-in
// Chromes, the worktrees and the functions cut from the kit. Each file importing it has its own.
import { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { chromePath } from '../../lib/chrome.mjs';
import { kit, testDir, threadsFixture, write } from '../../lib/kit.mjs';

export const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
export const LENS = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(SRC)[1];
export const FIXTURES = path.join(testDir, 'fixtures', 'artifact-shots');
export const MARKERS = ['// helpers: the shooter injects from here', '// helpers: to here', '// finder: the shooter injects from here', '// finder: to here'];
export const count = (text, part) => text.split(part).length - 1;
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// --- the fixture: one project for the file, its artifact pricing on main ------------------------------
// Chrome's singleton socket path is capped, so its TMPDIR is short and this file's own.
export const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ks'));
// Another server on this machine, which a page under a capture must never reach; the fixtures name it
// as __OTHER__.
export const reached = [];
// (anything else on the machine that looks at a new port asks for /)
export const other = http.createServer((q, s) => { if (q.url !== '/') reached.push(q.url); s.end('x'); });
other.on('upgrade', (q, sock) => { reached.push(`upgrade ${q.url}`); sock.destroy(); });
await new Promise((r) => other.listen(0, '127.0.0.1', r));
export const OTHER = `http://127.0.0.1:${other.address().port}`;
export const udp = dgram.createSocket('udp4');
udp.on('message', () => { reached.push('udp'); });
await new Promise((r) => udp.bind(0, '127.0.0.1', r));
let made = null;
after(() => { udp.close(); other.closeAllConnections?.(); other.close(); made?.F.done(); fs.rmSync(TMP, { recursive: true, force: true }); });
export function shotKit() {
  if (made) return made;
  const F = threadsFixture('shots');
  const arts = path.join(F.old, 'docs/devteam/project/artifacts');
  fs.cpSync(FIXTURES, path.join(arts, 'pricing'), { recursive: true, filter: (f) => !/\.(?:sh|mjs)$/.test(f) });
  for (const f of fs.readdirSync(path.join(arts, 'pricing')).filter((x) => /\.(html|js)$/.test(x))) { const at = path.join(arts, 'pricing', f); fs.writeFileSync(at, fs.readFileSync(at, 'utf8').replaceAll('__OTHER__', OTHER).replaceAll('__UDP__', String(udp.address().port))); }
  fs.symlinkSync('app.js', path.join(arts, 'pricing', 'link.js'));
  write(path.join(arts, 'pricing', '.secret.js'), '// never served\n');
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'pricing'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  const DT = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const childEnv = (extra = {}) => { const e = { ...F.env({}), HOME: F.home, TMPDIR: TMP, DEVTEAM_TEST: '1', DEVTEAM_CHROME_NO_SANDBOX: '1', CHROME_PATH: chromePath ?? '', ...extra }; for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]; return e; };
  // async, so a server this test holds answers while the command runs
  const run = (args, extra = {}) => new Promise((resolve) => {
    const p = spawn(process.execPath, [DT, ...args], { cwd: F.old, env: childEnv(extra), stdio: ['ignore', 'pipe', 'pipe'] });
    let o = '', e = '';
    p.stdout.on('data', (b) => { o += b; });
    p.stderr.on('data', (b) => { e += b; });
    p.on('close', (status) => resolve({ status, stdout: o, stderr: e, out: `${o}${e}`.trim() }));
  });
  const lines = () => fs.readdirSync(F.logDir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => fs.readFileSync(path.join(F.logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
  const last = (pred) => lines().filter(pred).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).pop();
  const logBytes = () => fs.readdirSync(F.logDir).sort().map((f) => `${f}:${fs.statSync(path.join(F.logDir, f)).size}`).join(' ');
  const shots = path.join(F.old, 'docs/devteam/run/shots');
  const files = (id) => (fs.existsSync(path.join(shots, id)) ? fs.readdirSync(path.join(shots, id)).sort() : []);
  const tree = () => { const all = []; const walk = (d) => { if (fs.existsSync(d)) for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); all.push(f); if (e.isDirectory()) walk(f); } }; walk(shots); return all.sort().join('\n'); };
  // a subject of its own each time (one open thread per subject): the selector gains a :not() that
  // matches everything
  let n = 0;
  const subject = (o = {}, anchor = {}) => ({ kind: 'artifact', slug: 'pricing', at: 'main', path: 'found.html', anchor: { selector: `#buy:not(.n${++n})`, tag: 'button', text: 'Start trial', rect: { x: 600, y: 400, w: 100, h: 60 }, ...anchor }, point: { x: 620, y: 420 }, ...o });
  const pointNote = (o = {}) => ({ kind: 'artifact', slug: 'pricing', at: 'main', path: 'found.html', point: { x: 40 + ++n / 1000, y: 20 }, ...o });
  // a note as thread new leaves it, its two lines written by hand: a command saved on every test that
  // only needs one to be there
  let notes = 0;
  const note = async (s, { frame } = {}) => {
    const ago = 900000 - ++notes * 1000;
    const id = F.hand('owner', { type: 'thread', title: 'A note', ...(s ? { subject: s } : {}), ...(frame ? { frame } : {}) }, ago);
    F.hand('owner', { type: 'turn', thread: id, text: 'Make it say Annual' }, ago - 500);
    return id;
  };
  const noteByCommand = async (s, { frame } = {}) => {
    const r = await run(['thread', 'new', '--title', 'A note', ...(s ? [`--subject=${JSON.stringify(s)}`] : []), ...(frame ? [`--frame=${JSON.stringify(frame)}`] : []), '--', 'Make it say Annual']);
    assert.equal(r.status, 0, r.out);
    return /t-\d{8}-\d{9}-[a-z0-9-]+/.exec(r.stdout)[0];
  };
  const ready = async (id, extra = {}) => {
    const r = await run(['thread', 'ready', id, '--outcome', 'The button now says Annual'], { ...SUP, ...extra });
    return { ...r, id, line: last((o) => o.type === 'thread' && o.op === 'set' && o.id === id && o.ready) };
  };
  const readyOn = async (s, { frame, ...extra } = {}) => ready(await note(s, { frame }), extra);
  const light = (r) => png(fs.readFileSync(path.join(shots, r.id, `${r.line.shot.stamp}-light.png`)));
  const show = async (id) => JSON.parse((await run(['thread', 'show', id, '--json'], SUP)).stdout);
  const seen = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
  return (made = { F, DT, SUP, arts, shots, run, lines, last, logBytes, files, tree, subject, pointNote, note, noteByCommand, ready, readyOn, light, show, seen, childEnv });
}

// --- a PNG's pixels: every row filter undone (Chrome uses them all) ------------------------------------
export function png(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), bpp = { 2: 3, 6: 4 }[buf[25]];
  assert.ok(bpp && buf[24] === 8 && buf[28] === 0, 'an 8-bit RGB or RGBA PNG, not interlaced');
  const idat = [];
  for (let at = 8; at < buf.length;) { const len = buf.readUInt32BE(at); if (buf.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(buf.subarray(at + 8, at + 8 + len)); at += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, data = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? data[y * stride + i - bpp] : 0, b = y ? data[(y - 1) * stride + i] : 0, c = i >= bpp && y ? data[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const add = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      data[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + add) & 255;
    }
  }
  return { w, h, px: (x, y) => { const at = y * stride + x * bpp; return [data[at], data[at + 1], data[at + 2], bpp === 4 ? data[at + 3] : 255]; } };
}
export const near = (px, rgb) => rgb.every((v, i) => Math.abs(px[i] - v) <= 8);
export const RING = [0xff, 0x1f, 0x8f];
// the ring's four lines 2 px outside box (in the picture's own pixels), and none 20 px inside it
export function ringAt(p, { x, y, w, h }) {
  const cx = Math.round(x + w / 2), cy = Math.round(y + h / 2);
  const on = [[x - 3, cy], [x + w + 2, cy], [cx, y - 3], [cx, y + h + 2]].every(([a, b]) => near(p.px(a, b), RING));
  return on && !near(p.px(x + Math.min(20, Math.floor(w / 2)), y + Math.min(20, Math.floor(h / 2))), RING);
}

// a stand-in Chrome from the fixtures, and the arguments of each launch of it
let fakes = 0;
export function fake(name, as = name) {
  const file = path.join(TMP, `f${++fakes}`, as);
  fs.mkdirSync(path.dirname(file));
  fs.copyFileSync(path.join(FIXTURES, name), file);
  fs.chmodSync(file, 0o755);
  return { file, dir: path.dirname(file), launches: () => (fs.existsSync(`${file}.log`) ? fs.readFileSync(`${file}.log`, 'utf8').trim().split('\n').map((l) => l.split(' ')) : []) };
}
export const seenFile = () => path.join(TMP, `seen${++fakes}.log`);
// the body of a top-level function or const in the kit, for a string check
export const body = (name) => new RegExp(`\\n(?:async )?(?:function|const) ${name}\\b[\\s\\S]*?\\n\\}`).exec(SRC)?.[0] ?? '';
export const region = () => /\/\* note-shots start \*\/([\s\S]*?)\/\* note-shots end \*\//.exec(SRC)?.[1] ?? '';


export const HOSTS = [.../const ARTIFACT_CDNS = (\[.*?\]);/.exec(SRC)[1].matchAll(/'https:\/\/([^']+)'/g), .../const ARTIFACT_FONT_HOSTS = (\[.*?\]);/.exec(SRC)[1].matchAll(/'https:\/\/([^']+)'/g)].map((m) => m[1]);

// a capture is mostly waiting: three at a time
export async function each(list, fn) { const at = [...list]; await Promise.all([0, 1, 2].map(async () => { while (at.length) await fn(at.shift()); })); }
export const NINE = { w: 900, h: 700, hash: '' };
// where found.html's button is in its 320x200 picture
export const MIDDLE = { x: 110, y: 70, w: 100, h: 60 };
export const lit = (k, r) => fs.readFileSync(path.join(k.shots, r.id, `${r.line.shot.stamp}-light.png`));
export const said = (r) => `${r.status}: ${r.out}`;

// a session's worktree with its own copy of an artifact, committed
export function worktree(k, name, slug, label) {
  const root = path.join(k.F.old, '.worktrees', name);
  if (!fs.existsSync(root)) k.F.g(['worktree', 'add', '-q', '-b', name, root], k.F.old);
  const dir = path.join(root, 'docs/devteam/project/artifacts', slug);
  write(path.join(dir, 'artifact.json'), '{"v":1,"title":"A page","summary":"A page","by":"supervisor"}\n');
  write(path.join(dir, 'index.html'), `<!doctype html><button id="buy">${label}</button>\n`);
  k.F.g(['add', '-A'], root);
  k.F.g(['commit', '-qm', `${slug}: ${label}`], root);
  return { root, dir, head: () => k.F.g(['rev-parse', 'HEAD'], root), remove: () => { k.F.g(['worktree', 'remove', '--force', root], k.F.old); k.F.g(['branch', '-D', name], k.F.old); } };
}
export const pageNote = (k, o = {}) => k.subject({ path: 'index.html', ...o });
// a note the owner handed over and a session marked addressed, as kit-144 will write it
let marks = 0;
export async function addressed(k, s, by, extra = {}) {
  const id = await k.note(s);
  k.F.hand('owner', { type: 'thread', op: 'set', id, handed: { to: by, at: new Date(Date.now() - 20).toISOString() } }, 20);
  const m = `m-20261123-${String(++marks).padStart(9, '0')}-${by}`;
  k.F.hand(by, { id: m, type: 'message', to: 'owner', kind: 'addressed', thread: id, text: 'The button now says Annual', ...extra }, 0);
  return id;
}

// --- the kit's own functions, run alone ----------------------------------------------------------------
// top-level declarations cut from the kit, over the names given
export function cut(names, scope = {}) {
  const decl = (n) => new RegExp(`\\n((?:async )?function ${n}\\b[\\s\\S]*?\\n\\}|const ${n} = (?:.*;(?=\\n)|[\\s\\S]*?\\n\\};))`).exec(SRC)?.[1] ?? assert.fail(`no ${n} in the kit`);
  return new Function(...Object.keys(scope), `${names.map(decl).join('\n')}\nreturn { ${names.filter((n) => /^[a-z]/.test(n)).join(', ')} };`)(...Object.values(scope));
}
