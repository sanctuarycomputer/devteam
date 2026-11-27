// apps-src@2 (apps/dashboard/APPS.md): the design-system page, /#design-system on the dashboard's /.
// Always (main's CI too, no build): every component in apps/dashboard/src/shared/ui/ has its specimens;
// scripts/ui-catalog.mjs writes the catalog for the fixture folder test/fixtures/apps-design-system/ui/
// and refuses a component with no specimens file or no specimen; --duplicates lists a class rendered
// outermost in two view folders of the fixture apps; nothing but the page's own files names it; APPS.md,
// package.json and .gitignore say apps-src@2. On a built dashboard: / (index.html) loads none of the
// design-system view's chunks and links nowhere to it. In the tree (its CLI serves the built apps), with
// Chrome, Node 24 and the dashboard installed: a scratch copy of the dashboard with the fixture
// components in src/shared/ui/, built by its own build script and served by the tree's dashboard server,
// opened at /#design-system under emulated light and dark, and at / without the hash, /#design-systemx and
// /index.html#design-system (the shell at each).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { PORTS, bareProject } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const APPS = path.join(ROOT, 'apps');
const DASH = path.join(APPS, 'dashboard');
const UI = path.join(DASH, 'src', 'shared', 'ui');
const VIEW = path.join(DASH, 'src', 'views', 'design-system');
const SCRIPT = path.join(DASH, 'scripts', 'ui-catalog.mjs');
const FIX = path.join(here, 'fixtures', 'apps-design-system');
const posix = (p) => p.split(path.sep).join('/');
const rel = (p) => posix(path.relative(ROOT, p));
const read = (f) => fs.readFileSync(f, 'utf8');
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const catalogRun = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
const scratch = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `apps-ds-${name}-`));
// a catalog's entries, from its text: [{ name, file, props, from }]
const entriesOf = (text) => {
  const imports = Object.fromEntries([...text.matchAll(/^import \{ specimens as (s\d+) \} from '([^']+)';$/gm)].map((m) => [m[1], m[2]]));
  return [...text.matchAll(/^ {2}\{ name: ("[^"]*"), file: ("[^"]*"), props: (\[[^\]]*\]), specimens: (s\d+) \},$/gm)].map((m) => ({ name: JSON.parse(m[1]), file: JSON.parse(m[2]), props: JSON.parse(m[3]), from: imports[m[4]] }));
};
// a folder's components: each <name>.tsx that isn't a specimens file
const componentsIn = (ui) => (fs.existsSync(ui) ? fs.readdirSync(ui).filter((f) => f.endsWith('.tsx') && !f.endsWith('.specimens.tsx')).map((f) => f.slice(0, -4)).sort() : []);
// a specimens file's titles, in its order
const titlesIn = (file) => [...read(file).matchAll(/\btitle:\s*(['"])((?:(?!\1).)*)\1/g)].map((m) => m[2]);

// ---- always ----

test('D1 every component in src/shared/ui/ has its specimens file with a specimen, and the catalog of the folder lists it', () => {
  const names = componentsIn(UI);
  for (const n of names) {
    const s = path.join(UI, `${n}.specimens.tsx`);
    assert.ok(fs.existsSync(s), `${rel(path.join(UI, `${n}.tsx`))} has ${n}.specimens.tsx beside it`);
    assert.ok(titlesIn(s).length > 0 && /\brender\s*[:(]/.test(read(s)), `${rel(s)} holds a specimen ({ title, note?, render })`);
  }
  const dir = scratch('d1');
  try {
    const r = catalogRun('--out', path.join(dir, 'catalog.gen.ts'));
    assert.equal(r.status, 0, `ui-catalog.mjs on src/shared/ui/ exits 0: ${r.stderr}`);
    assert.deepEqual(entriesOf(read(path.join(dir, 'catalog.gen.ts'))).map((e) => e.name), names, 'the catalog lists every component of src/shared/ui/, by name');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D2 ui-catalog.mjs writes the fixture folder\'s catalog with every component, and refuses a component with no specimens file or no specimen', () => {
  const dir = scratch('d2');
  try {
    const out = path.join(dir, 'views', 'design-system', 'catalog.gen.ts');
    const ui = path.join(FIX, 'ui');
    const r = catalogRun('--ui', ui, '--out', out);
    assert.equal(r.status, 0, r.stderr);
    const text = read(out);
    const entries = entriesOf(text);
    const names = componentsIn(ui);
    assert.ok(names.length >= 2, 'the fixture folder holds components');
    assert.deepEqual(entries.map((e) => e.name), names, 'every fixture component is in the catalog, alphabetically');
    for (const e of entries) {
      assert.equal(e.file, rel(path.join(ui, `${e.name}.tsx`)), `${e.name}: its file path`);
      assert.equal(path.resolve(path.dirname(out), `${e.from}.tsx`), path.join(ui, `${e.name}.specimens.tsx`), `${e.name}: the catalog imports its specimens`);
    }
    assert.deepEqual(entries.find((e) => e.name === 'fixture-alpha')?.props, ['label', 'onPress', 'disabled'], 'a type <Pascal>Props\'s members are its props');
    assert.deepEqual(entries.find((e) => e.name === 'fixture-beta')?.props, ['text', 'tone'], 'an interface <Pascal>Props\'s members are its props');
    assert.match(text, /^import type \{ Specimen \} from '\.\/specimen';$/m, 'the catalog types each entry\'s specimens as Specimen[]');
    const again = catalogRun('--ui', ui, '--out', out);
    assert.match(again.stdout, /unchanged/, 'a second run with nothing changed leaves the file alone');
    for (const [folder, file, why] of [['no-specimens', 'fixture-gamma.tsx', /no fixture-gamma\.specimens\.tsx beside it/], ['no-specimen', 'fixture-delta.specimens.tsx', /no specimen in it/], ['no-specimen-strings', 'fixture-epsilon.specimens.tsx', /no specimen in it/], ['no-specimen-elsewhere', 'fixture-zeta.specimens.tsx', /no specimen in it/]]) {
      const bad = catalogRun('--ui', path.join(FIX, folder, 'ui'), '--out', path.join(dir, `${folder}.ts`));
      assert.equal(bad.status, 1, `${folder}: refused (exit 1)`);
      assert.match(bad.stderr, new RegExp(`refused: ${rel(path.join(FIX, folder, 'ui', file)).replace(/[.]/g, '\\.')}: ${why.source}`), `${folder}: says which file and why`);
      assert.equal(fs.existsSync(path.join(dir, `${folder}.ts`)), false, `${folder}: no catalog written`);
    }
    const odd = path.join(dir, 'odd');
    fs.mkdirSync(odd);
    fs.writeFileSync(path.join(odd, 'helper.ts'), 'export const x = 1;\n');
    assert.match(catalogRun('--ui', odd, '--out', path.join(dir, 'o.ts')).stderr, /refused: .*helper\.ts: the ui folder holds only/, 'a file the folder doesn\'t allow is refused');
    fs.rmSync(path.join(odd, 'helper.ts'));
    fs.writeFileSync(path.join(odd, 'lone.specimens.tsx'), 'export const specimens = [{ title: "x", render: () => null }];\n');
    assert.match(catalogRun('--ui', odd, '--out', path.join(dir, 'o.ts')).stderr, /refused: .*lone\.specimens\.tsx: no lone\.tsx beside it/, 'specimens with no component are refused');
    assert.equal(catalogRun('--nope').status, 2, 'an unknown option: usage');
    // apps-src@2's other guards, each with a folder that would go through without it: refused (exit 1),
    // the file named, nothing written
    const pair = (d, name, specimens = 'export const specimens = [{ title: "x", render: () => null }];\n') => {
      fs.writeFileSync(path.join(d, `${name}.tsx`), 'export default function X() { return null; }\n');
      fs.writeFileSync(path.join(d, `${name}.specimens.tsx`), specimens);
    };
    for (const [name, setup, why, what] of [
      ['kebab', (d) => pair(d, 'Foo'), /kebab\/Foo(?:\.specimens)?\.tsx: the ui folder holds only/, 'a name not in kebab-case (Foo.tsx)'],
      ['subfolder', (d) => { pair(d, 'extra'); fs.mkdirSync(path.join(d, 'extra.css')); }, /subfolder\/extra\.css: the ui folder holds only/, 'a subfolder (extra.css/, beside its component)'],
      ['lone-css', (d) => fs.writeFileSync(path.join(d, 'lone.css'), '.lone { color: red; }\n'), /lone-css\/lone\.css: no lone\.tsx beside it/, 'a .css with no component'],
      ['no-export', (d) => pair(d, 'bare', 'const specimens = [{ title: "x", render: () => null }];\nexport default specimens;\n'), /no-export\/bare\.specimens\.tsx: it doesn't export const specimens/, 'a specimens file without export const specimens'],
    ]) {
      const d = path.join(dir, name);
      fs.mkdirSync(d);
      setup(d);
      const out = path.join(dir, `${name}.ts`);
      const r2 = catalogRun('--ui', d, '--out', out);
      assert.equal(r2.status, 1, `${what}: refused (exit 1): ${r2.stderr}`);
      assert.match(r2.stderr, new RegExp(`refused: .*${why.source}`), `${what}: says which file and why`);
      assert.equal(fs.existsSync(out), false, `${what}: no catalog written`);
    }
    const noValue = catalogRun('--ui');
    assert.equal(noValue.status, 2, `--ui with no value: usage (exit 2): ${noValue.stderr}`);
    assert.match(noValue.stderr, /incomplete option --ui\nusage: /, '--ui with no value: it says so, with the usage');
    // and with an option where its value should be: refused, not taken as the folder
    const optOut = path.join(dir, 'opt.ts');
    const optValue = catalogRun('--out', optOut, '--ui', '--duplicates');
    assert.equal(optValue.status, 2, `--ui followed by an option: usage (exit 2): ${optValue.stderr}`);
    assert.equal(fs.existsSync(optOut), false, '--ui followed by an option: no catalog written');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D3 --duplicates lists each class rendered outermost in two or more view folders of either app, with its files sorted; a folder it can\'t read is skipped and named', (t) => {
  const apps = path.join(FIX, 'dupes', 'apps');
  const r = catalogRun('--duplicates', '--apps', apps);
  assert.equal(r.status, 0, r.stderr);
  // the fixture's two lines, for an apps folder holding the fixture's apps
  const expected = (at) => {
    const f = (p) => rel(path.join(at, p));
    return [
      `.dup: ${f('a/src/views/one/index.tsx')}, ${f('a/src/views/two/panel.tsx')}`,
      `.dup-cross: ${f('a/src/shared/thing/thing.tsx')}, ${f('b/src/views/three/index.tsx')}`,
      '',
    ].join('\n');
  };
  assert.equal(r.stdout, expected(apps), 'only .dup (two views) and .dup-cross (a shared module and the other app\'s view): not .solo (one folder), .inner (nested), .via-ui (src/shared/ui/ and one view), .in-text (a string, a comment) or a class no CSS defines');
  const none = scratch('d3');
  try { assert.equal(catalogRun('--duplicates', '--apps', none).stdout, 'No duplicates.\n', 'none found: it says so'); } finally { fs.rmSync(none, { recursive: true, force: true }); }
  // a line's files sorted, though the walk meets them in another order: it goes into v/ before v-a/ (a
  // folder's entries come sorted), but v-a/index.tsx sorts first ('-' before '/'), and so with w/ and w-a/
  const order = scratch('d3-order');
  try {
    const src = path.join(order, 'a', 'src');
    fs.mkdirSync(path.join(src, 'shared', 'layout'), { recursive: true });
    fs.writeFileSync(path.join(src, 'shared', 'layout', 'layout.css'), '.order { color: red; }\n');
    for (const v of ['w-a', 'w', 'v-a', 'v']) {
      fs.mkdirSync(path.join(src, 'views', v), { recursive: true });
      fs.writeFileSync(path.join(src, 'views', v, 'index.tsx'), 'export default function V() { return <div className="order">x</div>; }\n');
    }
    const met = walk(path.join(src, 'views')).map(rel);
    assert.notDeepEqual(met, [...met].sort(), `the walk meets the files out of order here (${met.join(', ')})`);
    const o = catalogRun('--duplicates', '--apps', order);
    assert.equal(o.status, 0, o.stderr);
    assert.equal(o.stdout, `.order: ${[...met].sort().join(', ')}\n`, 'a line\'s files are sorted, whatever order the walk met them in');
  } finally { fs.rmSync(order, { recursive: true, force: true }); }
  // a folder under src/ it can't read: skipped, named in one stderr line, and the scan goes on (exit 0)
  const lockedAt = scratch('d3-locked');
  const locked = path.join(lockedAt, 'apps', 'a', 'src', 'views', 'locked');
  const listed = path.join(lockedAt, 'apps', 'a', 'src', 'views', 'listed');
  try {
    fs.cpSync(apps, path.join(lockedAt, 'apps'), { recursive: true });
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, 'index.tsx'), 'export default function L() { return <div className="dup">x</div>; }\n');
    // and one it can list but not enter (mode 0444): its subfolder can't be read either
    fs.mkdirSync(path.join(listed, 'inner'), { recursive: true });
    fs.writeFileSync(path.join(listed, 'inner', 'index.tsx'), 'export default function I() { return <div className="dup">x</div>; }\n');
    fs.chmodSync(locked, 0o000);
    fs.chmodSync(listed, 0o444);
    let readable = true;
    try { fs.readdirSync(locked); } catch { readable = false; }
    // CI runs as a user a mode-000 folder stops: there the case must run
    if (readable && process.env.CI) assert.fail('a folder with mode 000 is still readable in CI (root?): the unreadable-folder case would show nothing');
    if (readable) t.diagnostic('a folder with mode 000 is still readable here (root): the unreadable-folder case shows nothing, and is left out');
    else {
      const l = catalogRun('--duplicates', '--apps', path.join(lockedAt, 'apps'));
      assert.equal(l.status, 0, `an unreadable folder: the scan still exits 0: ${l.stderr}`);
      assert.deepEqual(l.stderr.split('\n').filter(Boolean).map((x) => x.replace(/ not read: .*$/, ' not read: …')), [`ui-catalog: ${rel(path.join(listed, 'inner'))} not read: …`, `ui-catalog: ${rel(locked)} not read: …`], 'one stderr line names each folder it couldn\'t read');
      assert.equal(l.stdout, expected(path.join(lockedAt, 'apps')), 'the rest of the scan as before, without the folders');
    }
  } finally {
    for (const d of [locked, listed]) { try { fs.chmodSync(d, 0o755); } catch {} }
    fs.rmSync(lockedAt, { recursive: true, force: true });
  }
});

test('D4 nothing leads to the page: only page.tsx and the view name design-system (a specimens file only in its Specimen type import), and only the catalog imports specimens', () => {
  const allowed = (f) => f === rel(path.join(DASH, 'src', 'app', 'page.tsx')) || f.startsWith(`${rel(VIEW)}/`);
  // a specimens file may name it only in its type import: import type { Specimen } from '…/views/design-system/specimen'
  const TYPE_IMPORT = /^import type \{ Specimen \} from '(?:\.\.\/)+views\/design-system\/specimen';$/gm;
  const named = [];
  for (const a of ['dashboard', 'hub']) for (const file of walk(path.join(APPS, a, 'src'))) {
    const f = rel(file);
    const text = f.startsWith(`${rel(UI)}/`) && f.endsWith('.specimens.tsx') ? read(file).replace(TYPE_IMPORT, '') : read(file);
    if (/design-system/.test(text) && !allowed(f)) named.push(f);
    if (/\.specimens['"]/.test(text) && !f.startsWith(`${rel(VIEW)}/`)) named.push(`${f} (imports specimens)`);
  }
  assert.deepEqual(named, [], 'no tab, side-bar entry, route, link or other import names the page');
  const page = read(path.join(DASH, 'src', 'app', 'page.tsx'));
  assert.match(page, /^import Root from '\.\.\/views\/design-system\/gate';$/m, 'page.tsx renders the shell through the gate');
  assert.match(page, /<Root><Shell \/><\/Root>/, 'the gate wraps the shell');
  const gate = read(path.join(VIEW, 'gate.tsx'));
  assert.match(gate, /import\('\.\/index'\)/, 'the gate loads the view by a dynamic import');
  assert.doesNotMatch(gate, /^import [^;]*from '\.\/index'/m, 'and never statically');
  const view = read(path.join(VIEW, 'index.tsx'));
  assert.match(view, /<Contain><Draw specimen=\{s\} on=\{/, 'each specimen renders as its own component inside its boundary');
  assert.doesNotMatch(view, /\.render\(on[A-Z]/, 'and never in the page\'s own render, where a throw would take the page');
});

test('D5 apps-src@2: APPS.md, the build and predev scripts, and the ignored catalog', () => {
  const md = read(path.join(DASH, 'APPS.md'));
  const at = md.indexOf('\n## `apps-src@2`\n');
  assert.ok(at >= 0, 'APPS.md has a section headed `apps-src@2`');
  const next = md.indexOf('\n## ', at + 1);
  const sec = md.slice(at, next < 0 ? md.length : next);
  for (const pin of ['- Version: 2', '#design-system', '`<name>.tsx`', '<name>.specimens.tsx', '{ title: string; note?: string; render: (on: On) => ReactNode }', '<name>.css', 'catalog.gen.ts', '--duplicates', '// ui-candidate: <name>', 'Parity and `COMPAT.md` come first', 'adds no file to `src/shared/ui/`']) assert.ok(sec.includes(pin), `the apps-src@2 section says ${pin}`);
  const pj = JSON.parse(read(path.join(DASH, 'package.json')));
  assert.match(pj.scripts.build, /^node \.\.\/dashboard\/scripts\/ui-catalog\.mjs && next build( |$)/, 'the dashboard\'s build writes the catalog before next build');
  assert.equal(pj.scripts.predev, 'node ../dashboard/scripts/ui-catalog.mjs', 'predev writes it too');
  assert.equal(pj.scripts.dev, 'next dev', 'npm run dev (which runs predev)');
  assert.ok(read(path.join(DASH, '.gitignore')).split('\n').map((l) => l.trim()).includes('src/views/design-system/catalog.gen.ts'), 'the catalog is gitignored');
});

// ---- on a built dashboard ----

const builtAt = [path.join(ROOT, 'docs', 'devteam', 'apps', 'dashboard'), path.join(DASH, 'out')].find((d) => fs.existsSync(path.join(d, 'csp-hashes.json')));
const NOT_BUILT = 'the dashboard isn\'t built here: run `npm ci --ignore-scripts && npm run build` in apps/dashboard (the parity run builds it)';
// the view's own markup, as the compiled chunk holds it: only the view's module renders it
const MARK = /"data-view":"design-system"/;
const viewChunks = (out) => walk(path.join(out, '_next')).filter((f) => f.endsWith('.js') && MARK.test(read(f)));

test('E1 / (index.html) loads none of the design-system view\'s chunks, and no page links to it', { skip: builtAt ? false : NOT_BUILT }, () => {
  const chunks = viewChunks(builtAt);
  assert.ok(chunks.length > 0, 'the build has the view in a chunk of its own');
  const index = read(path.join(builtAt, 'index.html'));
  for (const c of chunks) assert.ok(!index.includes(path.basename(c)), `/ doesn't load ${posix(path.relative(builtAt, c))}`);
  const loaded = [...index.matchAll(/(?:src|href)="(\/_next\/[^"?]+)/g)].map((m) => path.join(builtAt, m[1]));
  for (const f of loaded) if (f.endsWith('.js')) assert.doesNotMatch(read(f), MARK, `${m(f)}, which / loads, doesn't hold the view`);
  for (const f of walk(builtAt).filter((x) => x.endsWith('.html'))) assert.doesNotMatch(read(f), /href="[^"]*#design-system/, `${posix(path.relative(builtAt, f))} links nowhere to the page`);
  function m(f) { return posix(path.relative(builtAt, f)); }
});

// ---- in the tree, in Chrome ----

const KIT = path.join(ROOT, 'docs', 'devteam');
const inTree = fs.existsSync(path.join(KIT, 'scripts', 'cli.mjs')) && fs.existsSync(path.join(KIT, 'apps', 'dashboard', 'csp-hashes.json'));
const node24 = Number(process.versions.node.split('.')[0]) === 24;
const installed = fs.existsSync(path.join(DASH, 'node_modules', '.bin', 'next'));
const skipChrome = !inTree ? 'not in the tree: its CLI (docs/devteam/scripts/cli.mjs) serves the built apps (node test/split/apps-try.mjs test/apps-design-system.test.mjs)'
  : !canDrive ? 'no Chrome here'
  : node24 && installed ? false
  : process.env.CI ? false : `the scratch build needs Node 24 and apps/dashboard/node_modules (this is Node ${process.versions.node}${installed ? '' : ', not installed'})`;

// what the page did, kept on window.__w from before its first script: a boot of the shell (its gesture
// blocker), errors, sockets, policy violations, every fetch, XHR and beacon its code asked for, and its
// long timers
const WATCH = `(() => {
  const w = window.__w = { boot: 0, errors: [], sockets: [], cspv: [], asked: [], timers: [] };
  // every interval, and every timeout of a second or more: a poll, seen before its first call
  const si = window.setInterval, st = window.setTimeout;
  window.setInterval = function (fn, ms, ...a) { w.timers.push('setInterval ' + ms); return si.call(this, fn, ms, ...a); };
  window.setTimeout = function (fn, ms, ...a) { if (Number(ms) >= 1000) w.timers.push('setTimeout ' + ms); return st.call(this, fn, ms, ...a); };
  // every request the page's code makes, recorded as it is made (Resource Timing lists a fetch only once it ends)
  const f = window.fetch;
  window.fetch = function (u, ...a) { w.asked.push(String(u && u.url ? u.url : u)); return f.call(this, u, ...a); };
  const xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...a) { w.asked.push(String(u)); return xo.call(this, m, u, ...a); };
  const sb = navigator.sendBeacon && navigator.sendBeacon.bind(navigator);
  if (sb) navigator.sendBeacon = (u, d) => { w.asked.push(String(u)); return sb(u, d); };
  const add = Document.prototype.addEventListener;
  Document.prototype.addEventListener = function (t, ...a) { if (t === 'gesturestart') w.boot++; return add.call(this, t, ...a); };
  const ce = console.error;
  console.error = (...a) => { w.errors.push('console.error: ' + a.map(String).join(' ').slice(0, 400)); return ce.apply(console, a); };
  addEventListener('error', (e) => w.errors.push('error: ' + e.message));
  addEventListener('unhandledrejection', (e) => w.errors.push('rejection: ' + String(e.reason)));
  document.addEventListener('securitypolicyviolation', (e) => w.cspv.push(e.violatedDirective + ' ' + (e.blockedURI || 'inline')));
  const WS = window.WebSocket;
  window.WebSocket = function (...a) { w.sockets.push(String(a[0])); return new WS(...a); };
  const ES = window.EventSource;
  window.EventSource = function (...a) { w.sockets.push(String(a[0])); return new ES(...a); };
})();`;
// A command in a process group of its own, ended whole (TERM, then KILL) when it outlives ms or the test
// ends first: a build's workers never outlive it. Resolves { status, out, timedOut }.
const inGroup = (cmd, args, opts, ms, later) => new Promise((resolve) => {
  const c = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let out = '', timedOut = false;
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { out += d; });
  const end = () => { try { process.kill(-c.pid, 'SIGTERM'); } catch {} setTimeout(() => { try { process.kill(-c.pid, 'SIGKILL'); } catch {} }, 3000).unref(); };
  const timer = setTimeout(() => { timedOut = true; end(); }, ms);
  later(() => { if (c.exitCode === null && c.signalCode === null) end(); });
  c.on('error', (e) => { clearTimeout(timer); resolve({ status: null, out: `${out}\n${e.message}`, timedOut }); });
  c.on('close', (status) => { clearTimeout(timer); try { process.kill(-c.pid, 'SIGKILL'); } catch {} resolve({ status, out, timedOut }); });
});
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const until = async (f, what, ms = 30000) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = null, err = null;
    try { v = await f(); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? ` (${err.message})` : ''}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

// The processes on the machine: { pid, state, ppid, pgid }, from /proc (Linux; elsewhere F1 records nothing
// and F2 skips).
const HAS_PROC = fs.existsSync('/proc/self/stat');
const procs = () => {
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const s = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const r = s.slice(s.lastIndexOf(')') + 2).split(' ');
      out.push({ pid: Number(d), state: r[0], ppid: Number(r[1]), pgid: Number(r[2]) });
    } catch {}
  }
  return out;
};
// The file's time, under test.yml's 300 s watchdog for a file (which would end the test without its
// teardown): F1's own bound, its teardown's (the server's 3 s, Chrome's close at most 8 s, the scratch
// folder), F2's wait, and 20 s for the rest of the file. And what F1 started (its children and their
// process groups), read once its server and Chrome are up, for F2.
const WATCHDOG = 300000, F1_TIMEOUT = 240000, TEARDOWN_MAX = 15000, F2_WAIT = 10000, REST = 20000;
let f1Started = null;

test('F1 in the tree: /#design-system from the dashboard server, light and dark: tokens, every entry under its anchor, the filter, the event list, nothing fetched, no socket, no poll, no error, no violation; an anchor scrolls to its entry; / mounts the shell, and so do /#design-systemx and /index.html#design-system', { skip: skipChrome, timeout: F1_TIMEOUT }, async (t) => {
  assert.ok(node24 && installed, `in CI the tree's Chrome case runs: it needs Node 24 and apps/dashboard/node_modules (Node ${process.versions.node}, installed: ${installed})`);
  const later = cleanup(t);
  // once F1 is out of time its teardown has run, but its body goes on: it starts nothing after that
  const live = (what) => { if (t.signal.aborted) throw new Error(`F1 is out of time: not starting ${what}`); };
  const base = scratch('f1');
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  // a scratch copy of the dashboard with the fixture components beside any real ones, built by its own script
  const copy = path.join(base, 'apps', 'dashboard');
  fs.cpSync(DASH, copy, { recursive: true, filter: (src) => !/[\\/](node_modules|out|\.next|lib-dist)$/.test(src) });
  const ln = spawnSync('cp', ['-al', path.join(DASH, 'node_modules'), path.join(copy, 'node_modules')]);
  if (ln.status !== 0) fs.cpSync(path.join(DASH, 'node_modules'), path.join(copy, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  const ui = path.join(copy, 'src', 'shared', 'ui');
  fs.mkdirSync(ui, { recursive: true });
  for (const f of fs.readdirSync(path.join(FIX, 'ui'))) fs.copyFileSync(path.join(FIX, 'ui', f), path.join(ui, f));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && !['TMUX', 'TMUX_PANE'].includes(k)));
  live('the scratch build');
  const b = await inGroup('npm', ['run', 'build'], { cwd: copy, env: { ...clean, NEXT_TELEMETRY_DISABLED: '1' } }, 150000, later);
  assert.equal(b.status, 0, `npm run build in the scratch copy${b.timedOut ? ' (out of time: its process group ended)' : ''}:\n${b.out.slice(-3000)}`);
  const catalog = entriesOf(read(path.join(copy, 'src', 'views', 'design-system', 'catalog.gen.ts')));
  assert.deepEqual(catalog.map((e) => e.name), componentsIn(ui), 'the build wrote the catalog with every component');
  const titles = Object.fromEntries(catalog.map((e) => [e.name, titlesIn(path.join(ui, `${e.name}.specimens.tsx`))]));
  const dsChunks = viewChunks(path.join(copy, 'out')).map((f) => path.basename(f));
  assert.ok(dsChunks.length > 0, 'the scratch build has the view\'s chunk');
  // the tree's kit, in a project of its own, serving the scratch build
  const env = { ...clean, HOME: base, DEVTEAM_OWN_KIT: '1', DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  const root = bareProject(base, 'ds');
  const served = path.join(root, 'docs', 'devteam', 'apps', 'dashboard');
  fs.rmSync(served, { recursive: true, force: true });
  fs.cpSync(path.join(copy, 'out'), served, { recursive: true });
  const port = await freePort();
  live('the dashboard server');
  const dash = spawn(process.execPath, [path.join(root, 'docs', 'devteam', 'scripts', 'cli.mjs'), 'dashboard', '--port', String(port)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let said = '';
  dash.stdout.on('data', (d) => { said += d; });
  dash.stderr.on('data', (d) => { said += d; });
  // its whole process group, by the PID it started, and waited for
  later(() => new Promise((r) => {
    if (dash.exitCode !== null || dash.signalCode !== null) { try { process.kill(-dash.pid, 'SIGKILL'); } catch {} return r(); }
    const hard = setTimeout(() => { try { process.kill(-dash.pid, 'SIGKILL'); } catch {} }, 3000);
    dash.once('exit', () => { clearTimeout(hard); try { process.kill(-dash.pid, 'SIGKILL'); } catch {} r(); });
    try { process.kill(-dash.pid, 'SIGTERM'); } catch { r(); }
  }));
  await until(() => /dashboard on http/.test(said) || dash.exitCode !== null, 'the dashboard server', 120000);
  assert.match(said, /dashboard on http/, `the dashboard server started: ${said.slice(-600)}`);
  live('Chrome');
  const chrome = await openChrome();
  if (t.signal.aborted) { await chrome.close(); live('a page'); }
  later(() => chrome.close());
  const kids = HAS_PROC ? procs().filter((p) => p.ppid === process.pid) : null;
  if (kids) f1Started = { pids: kids.map((p) => p.pid), groups: [...new Set(kids.map((p) => p.pgid))].filter((g) => g !== procs().find((p) => p.pid === process.pid)?.pgid) };
  if (kids) assert.ok(f1Started.pids.includes(dash.pid), 'F1 sees the server it started');
  const url = (hash) => `http://127.0.0.1:${port}/${hash}`;
  const open = async (hash, scheme) => {
    live('a page');
    const p = await chrome.newPage();
    later(() => p.close());
    await p.send('Page.enable');
    await p.send('Runtime.enable');
    await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
    await p.send('Page.navigate', { url: url(hash) });
    return p;
  };
  const resources = (p) => p.ev("performance.getEntriesByType('resource').map((e) => e.name)");
  const layoutCss = read(path.join(DASH, 'src', 'shared', 'layout', 'layout.css'));
  // the tokens: what the layout CSS's :root rules define (a property set on an element, --fill, is no token)
  const tokenNames = [...new Set([...layoutCss.matchAll(/:root\s*\{([^}]*)\}/g)].flatMap((r) => [...r[1].matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1])))].sort();
  assert.ok(tokenNames.length > 20, 'the layout CSS defines its tokens');
  const bg = {};
  for (const scheme of ['light', 'dark']) {
    const p = await open('#design-system', scheme);
    await until(() => p.ev("document.querySelectorAll('[data-view=\"design-system\"] [data-ds-token]').length > 0"), `${scheme}: the design-system view drawn with its tokens`);
    assert.equal(await p.ev("matchMedia('(prefers-color-scheme: dark)').matches"), scheme === 'dark', `${scheme}: the scheme is emulated`);
    assert.equal(await p.ev("document.querySelector('[data-view=\"shell\"]')"), null, `${scheme}: the shell isn't on the page`);
    // tokens: every custom property the layout CSS defines, with its value now
    const shown = await p.ev("Object.fromEntries([...document.querySelectorAll('[data-ds-token]')].map((e) => [e.dataset.dsToken, [e.querySelector('.ds-value').textContent, getComputedStyle(document.documentElement).getPropertyValue(e.dataset.dsToken).trim(), !!e.querySelector('.ds-swatch')]]))");
    for (const n of tokenNames) {
      assert.ok(shown[n], `${scheme}: the tokens list ${n}`);
      assert.ok(shown[n][0] !== '', `${scheme}: ${n} has a value`);
      assert.equal(shown[n][0], shown[n][1], `${scheme}: ${n}'s value is the page's`);
    }
    assert.equal(shown['--bg'][2], true, `${scheme}: a colour token shows its swatch`);
    bg[scheme] = shown['--bg'][0];
    // every catalog entry under its anchor, each specimen rendered
    const got = await p.ev("[...document.querySelectorAll('[data-ds-component]')].map((e) => ({ name: e.dataset.dsComponent, id: e.id, specimens: [...e.querySelectorAll('[data-ds-specimen]')].map((f) => [f.dataset.dsSpecimen, f.querySelector('.ds-stage').childElementCount]) }))");
    assert.deepEqual(got.map((g) => g.name), catalog.map((e) => e.name), `${scheme}: every catalog entry, alphabetically`);
    for (const g of got) {
      assert.equal(g.id, `design-system/${g.name}`, `${scheme}: ${g.name} is under its anchor`);
      assert.deepEqual(g.specimens.map((s) => s[0]), titles[g.name], `${scheme}: ${g.name} shows each of its specimens`);
      for (const [title, kids] of g.specimens) assert.ok(kids > 0, `${scheme}: ${g.name} · ${title} rendered something`);
    }
    assert.equal(await p.ev("document.querySelectorAll('.ds-error').length"), 0, `${scheme}: no specimen threw`);
    if (scheme === 'light') {
      // the filter narrows by name, and clearing it shows them all again
      await p.click('#ds-filter');
      await p.type('alpha');
      const visible = () => p.ev("[...document.querySelectorAll('[data-ds-component]')].filter((e) => !e.hidden && e.offsetParent !== null).map((e) => e.dataset.dsComponent)");
      await until(async () => JSON.stringify(await visible()) === JSON.stringify(['fixture-alpha']), 'the filter "alpha" leaves fixture-alpha alone');
      for (let i = 0; i < 5; i++) for (const type of ['rawKeyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await until(async () => (await visible()).length === catalog.length, 'an empty filter shows every entry');
      // a specimen's handler only appends to the page's event list
      const before = (await resources(p)).length;
      const askedBefore = await p.ev('window.__w.asked.length');
      await p.click('[id="design-system/fixture-alpha"] [data-ds-specimen="Default"] button');
      await until(() => p.ev("[...document.querySelectorAll('#ds-events li')].some((li) => li.textContent === 'fixture-alpha · Default press')"), 'the press is on the event list');
      assert.equal(await p.ev('document.querySelectorAll("#ds-events li").length'), 1, 'one line for one press');
      assert.equal(await p.ev('window.__w.asked.length'), askedBefore, 'the press asked for nothing');
      assert.equal((await resources(p)).length, before, 'the press fetched nothing');
      assert.equal(await p.ev('location.hash'), '#design-system', 'and went nowhere');
    }
    const res = await resources(p);
    const asked = await p.ev('window.__w.asked');
    assert.deepEqual([...asked, ...res].filter((u) => new URL(u, 'http://x').pathname.startsWith('/api/')), [], `${scheme}: no /api/ request`);
    assert.ok(res.some((u) => dsChunks.some((c) => u.endsWith(`/${c}`))), `${scheme}: the view's chunk was loaded, on this page alone`);
    const w = await p.ev('window.__w');
    assert.equal(w.boot, 0, `${scheme}: the shell never booted`);
    assert.deepEqual(w.sockets, [], `${scheme}: no socket`);
    assert.deepEqual(w.timers, [], `${scheme}: no poll (no interval, no timeout of a second or more)`);
    assert.deepEqual(w.errors, [], `${scheme}: no error`);
    assert.deepEqual(w.cspv, [], `${scheme}: no policy violation`);
  }
  assert.notEqual(bg.light, bg.dark, 'the tokens follow the system theme');
  // a component's anchor, loaded, opens the page scrolled to its entry
  {
    const p = await open('#design-system/fixture-beta', 'light');
    await until(() => p.ev("(() => { const e = document.getElementById('design-system/fixture-beta'); if (!e || scrollY === 0) return false; const r = e.getBoundingClientRect(); return r.top >= -1 && r.top < innerHeight; })()"), '#design-system/fixture-beta opens the page at fixture-beta');
  }
  // / without the hash mounts the shell, and fetches none of the view
  const p = await open('', 'light');
  await until(() => p.ev("(() => { const e = document.querySelector('[data-view=\"shell\"]'); return !!e && Object.keys(e).some((k) => k.startsWith('__reactFiber')); })()"), '/ hydrates the shell');
  await until(() => p.ev('window.__w.boot === 1'), 'the shell booted');
  assert.equal(await p.ev("document.querySelector('[data-view=\"design-system\"]')"), null, '/ has no design-system view');
  assert.deepEqual((await resources(p)).filter((u) => dsChunks.some((c) => u.endsWith(`/${c}`))), [], '/ fetched none of the view\'s chunks');
  assert.deepEqual((await p.ev('window.__w')).errors, [], '/: no error');
  // near misses show the plain shell too: a hash that only begins as the page's, and the page's hash on a
  // path other than / (the server sends the same page at /index.html)
  for (const at of ['#design-systemx', 'index.html#design-system']) {
    const q = await open(at, 'light');
    await until(() => q.ev("(() => { const e = document.querySelector('[data-view=\"shell\"]'); return !!e && Object.keys(e).some((k) => k.startsWith('__reactFiber')); })()"), `/${at} hydrates the shell`);
    await until(() => q.ev('window.__w.boot === 1'), `/${at}: the shell booted`);
    assert.equal(await q.ev("document.querySelector('[data-view=\"design-system\"]')"), null, `/${at} has no design-system view`);
    assert.deepEqual((await resources(q)).filter((u) => dsChunks.some((c) => u.endsWith(`/${c}`))), [], `/${at} fetched none of the view's chunks`);
    assert.deepEqual((await q.ev('window.__w')).errors, [], `/${at}: no error`);
  }
});

test('F2 F1 ended what it started in its teardown: the dashboard server and Chrome, each by its process group, within its own timeout', { skip: skipChrome || (HAS_PROC ? false : 'no /proc here: F2 reads processes from it (Linux)') }, async (t) => {
  assert.ok(F1_TIMEOUT + TEARDOWN_MAX + F2_WAIT + REST <= WATCHDOG, `F1's timeout, its teardown, F2's wait and the rest of the file (${F1_TIMEOUT + TEARDOWN_MAX + F2_WAIT + REST} ms) fit test.yml's ${WATCHDOG / 1000} s watchdog for a file`);
  if (!f1Started) return t.skip('F1 stopped before its server and Chrome were up');
  const left = () => procs().filter((p) => p.state !== 'Z' && (f1Started.pids.includes(p.pid) || f1Started.groups.includes(p.pgid)));
  const end = Date.now() + F2_WAIT;
  while (left().length && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
  const still = left();
  // never leave them for the next test on a shared machine, whatever this says
  for (const g of new Set(still.map((p) => p.pgid))) { try { process.kill(-g, 'SIGKILL'); } catch {} }
  assert.deepEqual(still.map((p) => `${p.pid} (group ${p.pgid})`), [], 'no process F1 started outlived its teardown');
});
