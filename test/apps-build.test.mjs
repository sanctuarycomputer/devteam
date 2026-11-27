// apps-src@1 (apps/dashboard/APPS.md) and alpha-build@1: the two Next.js apps' layout, build and compiled
// logic. Always: each app's files, its pinned dev-only dependencies (the same in both apps), its config, the
// hub's @shared import, the hash step (apps/dashboard/scripts/csp-hashes.mjs) on HTML it must read as a
// browser does, APPS.md and the root view stubs. On a built app only (the parity run's tree, or after
// `npm ci --ignore-scripts && npm run build` in apps/<app>): the export against alpha-build@1 at the root and
// under /next (built here, in a scratch copy), lib-dist/ importing on this Node, and every locked package's
// publish date at least 7 days back where the registry answers. With nothing built it skips, saying so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KNOWN } from './release/package-check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const APPS = path.join(ROOT, 'apps');
const APP_NAMES = ['dashboard', 'hub'];
const app = (a, ...p) => path.join(APPS, a, ...p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const HASH = path.join(APPS, 'dashboard', 'scripts', 'csp-hashes.mjs');
const ROUTES = { dashboard: ['/', '/view/canvas/', '/browser/'], hub: ['/'] };
const BUILD = 'next build && node ../dashboard/scripts/csp-hashes.mjs out && node ../dashboard/scripts/lib-build.mjs';
// apps-src@2: the dashboard's build writes the design-system page's catalog first (scripts/ui-catalog.mjs)
const BUILDS = { dashboard: `node ../dashboard/scripts/ui-catalog.mjs && ${BUILD}`, hub: BUILD };
const DAY = 24 * 3600 * 1000;

// ---- always ----

test('B1 layout: each app holds its files, and apps/ holds the two apps and nothing else', () => {
  assert.deepEqual(fs.readdirSync(APPS).sort(), APP_NAMES, 'apps/ holds dashboard/ and hub/ only, nothing directly under it');
  for (const a of APP_NAMES) {
    for (const f of ['package.json', 'package-lock.json', '.gitignore', 'next.config.mjs', 'tsconfig.json', 'tsconfig.lib.json', 'COMPAT.md']) assert.ok(fs.statSync(app(a, f)).isFile(), `apps/${a}/${f}`);
    assert.ok(fs.statSync(app(a, 'src', 'app')).isDirectory(), `apps/${a}/src/app/`);
    const ignored = fs.readFileSync(app(a, '.gitignore'), 'utf8').split('\n').map((l) => l.trim());
    for (const g of ['node_modules/', '.next/', 'out/', 'lib-dist/']) assert.ok(ignored.includes(g), `apps/${a}/.gitignore ignores ${g}`);
  }
  assert.ok(fs.statSync(app('dashboard', 'APPS.md')).isFile(), 'apps/dashboard/APPS.md');
});

test('B2 dependencies: dev only, exact pins, the same in both apps, and both lockfiles lock the same set', () => {
  const pj = Object.fromEntries(APP_NAMES.map((a) => [a, readJson(app(a, 'package.json'))]));
  for (const a of APP_NAMES) {
    const p = pj[a];
    assert.equal(p.private, true, `apps/${a} is private`);
    assert.equal(p.scripts?.build, BUILDS[a], `apps/${a}'s build: ${a === 'dashboard' ? 'the catalog, then ' : ''}next build, then the hash step, then lib-dist`);
    for (const k of ['dependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies']) assert.equal(p[k], undefined, `apps/${a} has no ${k}`);
    for (const n of ['next', 'react', 'react-dom', 'typescript']) assert.ok(p.devDependencies?.[n], `apps/${a} pins ${n}`);
    for (const [n, v] of Object.entries(p.devDependencies)) assert.match(v, /^\d+\.\d+\.\d+$/, `apps/${a}: ${n} is pinned exactly (${v})`);
    const lock = readJson(app(a, 'package-lock.json'));
    assert.equal(lock.lockfileVersion, 3, `apps/${a}'s lockfile is version 3`);
    assert.deepEqual(lock.packages[''].devDependencies, p.devDependencies, `apps/${a}'s lockfile root is its package.json`);
    assert.equal(lock.packages[''].dependencies, undefined, `apps/${a}'s lockfile root has no dependencies`);
    for (const [k, v] of Object.entries(lock.packages)) if (k) assert.equal(v.dev, true, `apps/${a}: ${k} is locked as a dev dependency`);
  }
  assert.deepEqual(pj.hub.devDependencies, pj.dashboard.devDependencies, 'both apps pin the same versions');
  const locked = (a) => Object.entries(readJson(app(a, 'package-lock.json')).packages).filter(([k]) => k).map(([k, v]) => `${k}@${v.version}`).sort();
  assert.deepEqual(locked('hub'), locked('dashboard'), 'both lockfiles lock the same packages at the same versions');
});

test('B3 next.config.mjs: a trailing-slash static export, the base path from DEVTEAM_BASE_PATH, turbopack at apps/', async () => {
  const was = process.env.DEVTEAM_BASE_PATH;
  try {
    for (const a of APP_NAMES) for (const base of ['', '/next']) {
      process.env.DEVTEAM_BASE_PATH = base;
      const c = (await import(`${pathToFileURL(app(a, 'next.config.mjs')).href}?base=${encodeURIComponent(base)}`)).default;
      assert.equal(c.output, 'export', `apps/${a}: output export`);
      assert.equal(c.trailingSlash, true, `apps/${a}: trailingSlash`);
      assert.equal(c.basePath, base, `apps/${a}: basePath "${base}"`);
      assert.equal(c.images?.unoptimized, true, `apps/${a}: images unoptimized`);
      assert.equal(c.env?.DEVTEAM_BASE_PATH, base, `apps/${a}: the base path reaches the page as DEVTEAM_BASE_PATH`);
      assert.equal(path.resolve(c.turbopack?.root ?? ''), path.resolve(APPS), `apps/${a}: turbopack.root is apps/`);
    }
  } finally { if (was === undefined) delete process.env.DEVTEAM_BASE_PATH; else process.env.DEVTEAM_BASE_PATH = was; }
  for (const a of APP_NAMES) {
    const lib = readJson(app(a, 'tsconfig.lib.json')).compilerOptions;
    assert.equal(lib.target, 'ES2020', `apps/${a}/tsconfig.lib.json: lib-dist/ is ES2020`);
    assert.equal(lib.module, 'ES2020', `apps/${a}/tsconfig.lib.json: as ES2020 modules`);
    assert.deepEqual(lib.lib, ['ES2020', 'DOM', 'DOM.Iterable'], `apps/${a}/tsconfig.lib.json: ES2020 and the DOM's types (a function may use the DOM; nothing at import, which B9 checks)`);
    assert.equal(lib.jsx, undefined, `apps/${a}/tsconfig.lib.json: no jsx, so a lib module importing a .tsx component fails the build`);
    assert.equal(lib.outDir, 'lib-dist', `apps/${a}/tsconfig.lib.json: into lib-dist/`);
    assert.equal(lib.rootDir, 'src', `apps/${a}/tsconfig.lib.json: keeping src/'s folders`);
  }
});

test('B4 the hub imports apps/dashboard/src/shared/ as @shared/* and holds no copy of it', () => {
  const ts = readJson(app('hub', 'tsconfig.json'));
  assert.deepEqual(ts.compilerOptions?.paths?.['@shared/*'], ['./../dashboard/src/shared/*'], 'the hub maps @shared/* to the dashboard\'s shared folder');
  assert.equal(fs.existsSync(app('hub', 'src', 'shared')), false, 'apps/hub/src/shared/ does not exist');
  assert.match(fs.readFileSync(app('hub', 'src', 'app', 'layout.tsx'), 'utf8'), /from '@shared\/back-link'/, 'the hub\'s layout imports the shared back link');
});

const html = (...parts) => parts.join('');
const sha = (s) => `sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}`;

test('B5 the hash step reads scripts as the HTML parser does, and refuses what it cannot read', async () => {
  const { scanHtml, hashOf, routeOf, hashExport, Refused } = await import(pathToFileURL(HASH).href);
  const one = 'self.__next_f=[]', two = 'a("</scripts>")', three = '\n x = "é" \n', four = 'quoted()';
  const page = html('<!doctype html><html><head><script src="/_next/a.js" async></script>', `<script id="_R_">${one}</script>`,
    '<!-- <script>commented()</script> -->', `<script>${two}</script >`, `<SCRIPT type="module">${three}</SCRIPT>`, `<script data-x="a>b" data-y='c>d'>${four}</script>`,
    '<a title="x > y" href="/">t</a><style>.x{}</style><p style="color:red">p</p></head></html>');
  const s = scanHtml(page);
  assert.deepEqual(s.scripts, [one, two, three, four], 'each inline body exactly; no src script; no comment; "</scripts>" doesn\'t end a script; "</script >" and "</SCRIPT>" do; a quoted ">" doesn\'t end the open tag');
  assert.deepEqual(s.styles.map((x) => x.kind), ['element', 'attribute'], 'the <style> element and the style attribute are reported');
  assert.equal(hashOf(three), sha(three), 'the hash is base64 SHA-256 of the UTF-8 bytes');
  assert.throws(() => scanHtml('<p>x</p><script>never ends'), Refused, 'a script with no end tag is refused');
  assert.throws(() => scanHtml('<script'), Refused, 'a tag with no ">" is refused');
  assert.throws(() => scanHtml('<script>a()\r\nb()</script>'), Refused, 'a carriage return in a script body is refused');
  assert.equal(routeOf('index.html'), '/');
  assert.equal(routeOf(path.join('view', 'canvas', 'index.html')), '/view/canvas/');
  assert.equal(routeOf('404.html'), null, 'the export\'s 404.html is no route');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-build-hash-'));
  try {
    assert.throws(() => hashExport(dir), Refused, 'an export with no page is refused');
    fs.mkdirSync(path.join(dir, 'b'));
    fs.writeFileSync(path.join(dir, 'index.html'), page);
    fs.writeFileSync(path.join(dir, 'b', 'index.html'), `<script>${one}</script><script>${one}</script>`);
    fs.writeFileSync(path.join(dir, '404.html'), '<script>nf()</script>');
    const r = spawnSync(process.execPath, [HASH, dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readJson(path.join(dir, 'csp-hashes.json')), { v: 1, pages: { '/': [sha(one), sha(two), sha(three), sha(four)], '/b/': [sha(one)] } }, 'csp-hashes.json, by route, each hash once');
    fs.writeFileSync(path.join(dir, 'b', 'index.html'), '<script>x(');
    const bad = spawnSync(process.execPath, [HASH, dir], { encoding: 'utf8' });
    assert.equal(bad.status, 1, 'a page it cannot read fails the build');
    assert.match(bad.stderr, /refused: b\/index\.html: a <script> at \d+ has no <\/script>/);
    assert.equal(fs.existsSync(path.join(dir, 'csp-hashes.json')), false, 'a refused run leaves no csp-hashes.json, not the earlier one');
    assert.equal(spawnSync(process.execPath, [HASH], { encoding: 'utf8' }).status, 2, 'no folder: usage');
    assert.equal(spawnSync(process.execPath, [HASH, path.join(dir, 'none')], { encoding: 'utf8' }).status, 2, 'a missing folder: usage');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// APPS.md's "Exports" list for a stub: the lines "- `name`" under its "### <stub path>" heading
function appsMdExports(md, stub) {
  const at = md.indexOf(`### \`${stub}\``);
  if (at < 0) return null;
  const next = md.indexOf('\n#', at + 1);
  return [...md.slice(at, next < 0 ? md.length : next).matchAll(/^- `([A-Za-z_$][\w$]*)`/gm)].map((m) => m[1]).sort((a, b) => a.localeCompare(b));
}
const STUBS = { shell: 'apps/dashboard/src/views/shell/index.tsx', canvas: 'apps/dashboard/src/views/canvas/index.tsx', browser: 'apps/dashboard/src/views/browser/index.tsx', 'hub-shell': 'apps/hub/src/views/hub-shell/index.tsx' };

test('B6 APPS.md states apps-src@1 at version 1, every part the design gives it, and each stub\'s exports', () => {
  const md = fs.readFileSync(app('dashboard', 'APPS.md'), 'utf8');
  assert.match(md, /^# `apps-src@1`/m, 'APPS.md names the contract');
  assert.match(md, /^- Version: 1$/m, 'at version 1');
  for (const h of ['Layout', 'Routes', 'Paths', 'The view stubs', 'Shared code', 'API calls', 'Third-party code', 'The compatibility surface', 'COMPAT.md', 'The back link', 'Test changes']) assert.match(md, new RegExp(`^## ${h}$`, 'm'), `APPS.md has "${h}"`);
  // each section's load-bearing line, so an emptied section fails
  const part = (h) => { const at = md.indexOf(`\n## ${h}\n`); const next = md.indexOf('\n## ', at + 1); return md.slice(at, next < 0 ? md.length : next); };
  const PINS = {
    Layout: [BUILDS.dashboard, BUILDS.hub, '`node_modules/`, `.next/`, `out/`, `lib-dist/`', 'lib-dist/lib/<module>.js'],
    Routes: ['| `apps/dashboard` | `/view/canvas/` |', '| `apps/dashboard` | `/browser/` |', '| `apps/hub` | `/` |'],
    Paths: ['export function appPath(pathname?: string, base?: string): string;'],
    'The view stubs': ["throw new Error('not ported: <view>');"],
    'Shared code': ['@shared/<module>'],
    'API calls': ['root-absolute', '`/box.json`'],
    'Third-party code': ["no `'unsafe-inline'`"],
    'The compatibility surface': ['export function expose(', 'POLL_MS = 10000', 'window.__polls', 'at the top level of its module'],
    'COMPAT.md': ['**Tests by view**', 'sha256'],
    'The back link': ['<a class="alpha-back" id="alpha-back" href="/">Back to the stable page</a>'],
    'Test changes': ['test/split/overlay/apps-tests/'],
  };
  for (const [h, pins] of Object.entries(PINS)) for (const pin of pins) assert.ok(part(h).includes(pin), `APPS.md's "${h}" says ${pin}`);
  for (const [view, stub] of Object.entries(STUBS)) {
    const src = fs.readFileSync(path.join(ROOT, stub), 'utf8');
    const listed = appsMdExports(md, stub);
    assert.ok(listed, `APPS.md has a list for ${stub}`);
    if (!src.startsWith('// apps-src@1 view stub:')) {
      // ported: the view itself, which still exports every function other views call from it
      const has = new Set([...src.matchAll(/^export (?:async )?(?:function\*? ?|const |let )([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
      for (const n of listed) assert.ok(has.has(n), `${stub} (ported) still exports ${n}`);
      continue;
    }
    const fns = [...src.matchAll(/^export function ([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*:\s*([^{]+)\{\s*\n\s*throw new Error\('not ported: ([\w-]+)'\);\s*\n\}/gm)];
    const all = [...src.matchAll(/^export function ([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    assert.equal(fns.length, all.length, `${stub}: every exported function only throws`);
    for (const m of fns) {
      assert.equal(m[4], view, `${stub}: ${m[1]} throws "not ported: ${view}"`);
      assert.match(m[2], /:\s*unknown/, `${stub}: ${m[1]}'s parameters are typed`);
      assert.equal(m[3].trim(), 'never', `${stub}: ${m[1]} is typed never`);
    }
    assert.deepEqual(listed, all.sort((a, b) => a.localeCompare(b)), `APPS.md lists ${stub}'s exports`);
    assert.match(src, new RegExp(`data-view="${view}"[\\s\\S]*<h1>${view}</h1>`), `${stub} shows its name`);
  }
});

// ---- on a built app ----

// Where each app's root build is: the parity tree's docs/devteam/apps/<app>/, else apps/<app>/out/.
const builtAt = (a) => [path.join(ROOT, 'docs', 'devteam', 'apps', a), app(a, 'out')].find((d) => fs.existsSync(path.join(d, 'csp-hashes.json')));
const built = APP_NAMES.every((a) => builtAt(a));
const NOT_BUILT = 'no app is built here: run `npm ci --ignore-scripts && npm run build` in apps/dashboard and apps/hub (the parity run builds them)';
const skipUnbuilt = built ? false : NOT_BUILT;

const walk = (d, rel = '') => fs.readdirSync(path.join(d, rel), { withFileTypes: true }).flatMap((e) => {
  const r = rel ? `${rel}/${e.name}` : e.name;
  return e.isDirectory() ? walk(d, r) : [{ rel: r, link: e.isSymbolicLink(), file: e.isFile() }];
});
// the test's own reading of a page's inline scripts, apart from the hash step's
const inlineScripts = (h) => [...h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter((m) => !/\ssrc\s*=/i.test(m[1])).map((m) => m[2]);

// One export against alpha-build@1, at a base path.
function checkExport(out, a, base) {
  const files = walk(out);
  for (const f of files) {
    assert.ok(f.file && !f.link, `${a}${base}: ${f.rel} is a regular file`);
    assert.ok(KNOWN.includes(path.extname(f.rel).slice(1).toLowerCase()), `${a}${base}: ${f.rel} is of a known type`);
  }
  const pages = files.filter((f) => f.rel === 'index.html' || f.rel.endsWith('/index.html')).map((f) => (f.rel === 'index.html' ? '/' : `/${f.rel.slice(0, -'index.html'.length)}`)).sort();
  for (const r of ROUTES[a]) assert.ok(pages.includes(r), `${a}${base}: the route ${r} is exported as ${r.slice(1)}index.html`);
  const m = readJson(path.join(out, 'csp-hashes.json'));
  assert.equal(m.v, 1, `${a}${base}: csp-hashes.json v 1`);
  assert.deepEqual(Object.keys(m.pages).sort(), pages, `${a}${base}: csp-hashes.json has every exported page, keyed by route without the base path`);
  for (const r of pages) {
    const h = fs.readFileSync(path.join(out, r.slice(1), 'index.html'), 'utf8');
    assert.deepEqual([...m.pages[r]].sort(), [...new Set(inlineScripts(h).map(sha))].sort(), `${a}${base}: ${r}'s hashes are its inline scripts'`);
    assert.ok(m.pages[r].length > 0, `${a}${base}: ${r} has inline scripts to hash`);
    const assets = [...h.matchAll(/(?:src|href)="([^"]*\/_next\/[^"]*)"/g)].map((x) => x[1]);
    assert.ok(assets.length, `${a}${base}: ${r} loads files from _next/`);
    for (const u of assets) assert.ok(u.startsWith(`${base}/_next/`), `${a}${base}: ${r} loads ${u} under the base path`);
    const back = /<a\b[^>]*id="alpha-back"[^>]*>([^<]*)<\/a>/.exec(h);
    if (base) { assert.ok(back, `${a}${base}: ${r} shows the back link`); assert.match(back[0], /href="\/"/); assert.equal(back[1], 'Back to the stable page'); }
    else assert.equal(back, null, `${a} at the root: ${r} has no back link`);
    if (r === '/browser/') assert.doesNotMatch(h, /<style\b|\sstyle\s*=/i, `${a}${base}: the browser view's route has no inline style (its policy is style-src 'self')`);
  }
}

test('B7 each built app\'s export (DEVTEAM_BASE_PATH empty) is alpha-build@1\'s', { skip: skipUnbuilt }, () => {
  for (const a of APP_NAMES) checkExport(builtAt(a), a, '');
});

const node24 = Number(process.versions.node.split('.')[0]) === 24;
const installed = APP_NAMES.every((a) => fs.existsSync(app(a, 'node_modules', '.bin', 'next')));
const canBuildNext = built && node24 && installed;
// In CI a built tree must check /next too; elsewhere it says why it can't.
const skipNext = !built ? NOT_BUILT : canBuildNext || process.env.CI ? false : `the /next build needs Node 24 and apps/<app>/node_modules (this is Node ${process.versions.node}${installed ? '' : ', not installed'})`;

test('B8 both apps build with DEVTEAM_BASE_PATH=/next, in a scratch copy, into alpha-build@1\'s export', { skip: skipNext, timeout: 200000 }, () => {
  assert.ok(canBuildNext, `the /next build needs Node 24 and each app installed (Node ${process.versions.node}, installed: ${installed})`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-build-next-'));
  try {
    const to = path.join(tmp, 'apps');
    for (const a of APP_NAMES) {
      fs.cpSync(app(a), path.join(to, a), { recursive: true, filter: (src) => !/[\\/](node_modules|out|\.next|lib-dist)$/.test(src) });
      // node_modules hard-linked where the folders share a disk (Turbopack refuses a symlink out of its root), else copied
      const ln = spawnSync('cp', ['-al', app(a, 'node_modules'), path.join(to, a, 'node_modules')]);
      if (ln.status !== 0) fs.cpSync(app(a, 'node_modules'), path.join(to, a, 'node_modules'), { recursive: true, verbatimSymlinks: true });
    }
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_')));
    for (const a of APP_NAMES) {
      const r = spawnSync('npm', ['run', 'build'], { cwd: path.join(to, a), env: { ...env, DEVTEAM_BASE_PATH: '/next', NEXT_TELEMETRY_DISABLED: '1' }, encoding: 'utf8', timeout: 90000, maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, `npm run build in apps/${a} with /next:\n${`${r.stdout}\n${r.stderr}`.slice(-3000)}`);
      checkExport(path.join(to, a, 'out'), a, '/next');
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('B9 lib-dist/ imports on this Node: appPath, expose and POLL_MS do what apps-src@1 says', { skip: skipUnbuilt }, async () => {
  for (const a of APP_NAMES) {
    const marker = app(a, 'lib-dist', 'package.json');
    assert.ok(fs.existsSync(marker), `apps/${a}/lib-dist/package.json marks lib-dist/ as ES modules (Node 18 reads .js as CommonJS without it)`);
    assert.deepEqual(readJson(marker), { type: 'module' }, `apps/${a}/lib-dist/ is ES modules`);
  }
  const lib = (m) => import(pathToFileURL(app('dashboard', 'lib-dist', 'shared', `${m}.js`)).href);
  const { appPath } = await lib('paths');
  const cases = [['/next/view/canvas/x', '/next', '/view/canvas/x'], ['/next', '/next', '/'], ['/next/', '/next', '/'], ['/next/', '/next/', '/'], ['/nextish', '/next', '/nextish'], ['/other/next/', '/next', '/other/next/'], ['/view/artifact/a', '', '/view/artifact/a'], ['', '', '/'], ['', '/next', '/']];
  for (const [p, b, want] of cases) assert.equal(appPath(p, b), want, `appPath(${JSON.stringify(p)}, ${JSON.stringify(b)})`);
  const { expose } = await lib('compat');
  const w = {};
  const f = () => 1;
  expose('tlClose', f, w);
  assert.equal(w.tlClose, f, 'expose sets the global');
  assert.throws(() => expose('tlClose', () => 2, w), /tlClose is already registered/, 'a second registration throws');
  const plain = {};
  assert.throws(() => expose('__proto__', () => 4, plain), /is not a global name/, '__proto__ is refused');
  assert.equal(Object.getPrototypeOf(plain), Object.prototype, 'and the target keeps its prototype');
  assert.equal(w.tlClose, f, 'and changes nothing');
  const proto = { when: () => 0 };
  const inherits = Object.create(proto);
  expose('when', f, inherits);
  assert.equal(inherits.when, f, 'a name the target only inherits (window.when, EventTarget\'s) is shadowed, as the page\'s top-level function does today');
  assert.ok(Object.hasOwn(inherits, 'when'), 'on the target itself');
  assert.throws(() => expose('when', () => 3, inherits), /when is already registered/, 'and then registered');
  assert.throws(() => expose('not a name', f, w), TypeError);
  assert.throws(() => expose('x', 'nope', w), TypeError);
  const before = Object.keys(globalThis).length;
  expose('notOnNode', f);
  assert.equal(globalThis.notOnNode, undefined, 'with no window (the build\'s prerender on Node) expose registers nothing');
  assert.equal(Object.keys(globalThis).length, before);
  // no DOM at import: every compiled module of both apps imports on this Node
  for (const a of APP_NAMES) for (const f2 of walk(app(a, 'lib-dist')).map((x) => x.rel).filter((r) => r.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(app(a, 'lib-dist', f2), 'utf8'), /\bfrom\s*['"](?:react|react-dom|next)(?:\/[^'"]*)?['"]|\bimport\(\s*['"](?:react|react-dom|next)\b/, `apps/${a}/lib-dist/${f2} imports no React or Next (logic only)`);
    try { await import(pathToFileURL(app(a, 'lib-dist', f2)).href); } catch (e) { assert.fail(`apps/${a}/lib-dist/${f2} imports on Node, with no DOM at import (${e.message})`); }
  }
  const { POLL_MS } = await lib('poll');
  assert.equal(POLL_MS, 10000, 'POLL_MS is 10000');
});

test('B10 every locked package was published at least 7 days ago (L-SEC-6), where the registry answers', { skip: skipUnbuilt, timeout: 60000 }, async (t) => {
  const want = new Map();
  for (const a of APP_NAMES) for (const [k, v] of Object.entries(readJson(app(a, 'package-lock.json')).packages)) if (k) want.set(`${k.replace(/^.*node_modules\//, '')}@${v.version}`, { name: k.replace(/^.*node_modules\//, ''), version: v.version });
  const reg = 'https://registry.npmjs.org';
  const times = new Map();
  let unanswered = 0;
  const names = [...new Set([...want.values()].map((p) => p.name))];
  // the registry's whole share of the file's 300 s: 40 s, 10 s a request; a name not asked by then counts as unanswered
  const until = Date.now() + 40000;
  for (let i = 0; i < names.length; i += 4) {
    if (Date.now() > until) { unanswered += names.length - i; t.diagnostic(`out of time: ${names.length - i} names not asked`); break; }
    await Promise.all(names.slice(i, i + 4).map(async (n) => {
      try {
        const r = await fetch(`${reg}/${n.replace('/', '%2f')}`, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        times.set(n, (await r.json()).time ?? {});
      } catch (e) { unanswered++; t.diagnostic(`the registry didn't answer for ${n}: ${e.message}`); }
    }));
  }
  if (!times.size) { t.skip('the registry is unreachable here'); return; }
  const now = Date.now();
  const young = [];
  for (const { name, version } of want.values()) {
    const at = times.get(name)?.[version];
    if (!times.has(name)) continue;
    assert.ok(at, `the registry has ${name}@${version}`);
    if (now - Date.parse(at) < 7 * DAY) young.push(`${name}@${version} (${at})`);
  }
  assert.deepEqual(young, [], 'no locked package is younger than 7 days');
  t.diagnostic(`${want.size} locked packages, ${want.size - [...want.values()].filter((p) => !times.has(p.name)).length} checked, ${unanswered} names unanswered`);
  // next's compiled React has no version in its package.json; its production build names it
  const reactJs = app('dashboard', 'node_modules', 'next', 'dist', 'compiled', 'react', 'cjs', 'react.production.js');
  if (!fs.existsSync(reactJs)) return;
  const vendored = /\b(\d+\.\d+\.\d+-canary-[0-9a-f]+-\d+)\b/.exec(fs.readFileSync(reactJs, 'utf8'))?.[1] ?? 'unknown';
  t.diagnostic(`the React the pages run is next's vendored ${vendored} (next ${readJson(app('dashboard', 'node_modules', 'next', 'package.json')).version})`);
});
