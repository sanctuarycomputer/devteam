// apps-src@1's compatibility surface (apps/dashboard/APPS.md, The compatibility surface; apps/<app>/COMPAT.md).
// Always: each COMPAT.md's parts and view names, and, where git has the commit it was written from, that the
// scan still writes it byte for byte. On a built app with Chrome: each route, served under its hashed policy
// (script-src 'self' plus csp-hashes.json's hashes, no 'unsafe-inline'), hydrates its root view with no
// policy violation; and each COMPAT global that is not yet on the page is reported (a diagnostic, as the ports
// land one by one), failing only under DEVTEAM_APPS_COMPAT_STRICT=1, which the cutover sets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canDrive, openChrome, cleanup } from './lib/chrome.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const APP_NAMES = ['dashboard', 'hub'];
const compatOf = (a) => fs.readFileSync(path.join(ROOT, 'apps', a, 'COMPAT.md'), 'utf8');
// the port plan's view names (APPS.md, COMPAT.md)
const VIEWS = {
  dashboard: ['shell', 'data', 'words', 'overview', 'goals', 'board', 'autonomy', 'settings', 'loop', 'peeks', 'peek-kinds', 'review', 'viewer', 'attachments', 'library', 'threads-core', 'threads-panel', 'thread', 'terminal',
    'canvas', 'canvas-panels', 'canvas-sync', 'canvas-editing', 'canvas-history', 'canvas-presence', 'browser'],
  hub: ['hub-shell', 'hub-overview', 'hub-settings', 'hub-threads'],
};
const CANVAS_SECTIONS = ['canvas-panels', 'canvas-sync', 'canvas-editing', 'canvas-history', 'canvas-presence'];
const PAGES = { dashboard: { 'index.html': '/', 'canvas.html': '/view/canvas/', 'browser.html': '/browser/' }, hub: { 'hub.html': '/' } };
const ROOT_VIEW = { '/': { dashboard: 'shell', hub: 'hub-shell' }, '/view/canvas/': { dashboard: 'canvas' }, '/browser/': { dashboard: 'browser' } };

// a section's text: from its "## " heading to the next
const section = (md, heading) => {
  const at = md.indexOf(`\n## ${heading}\n`);
  if (at < 0) return null;
  const next = md.indexOf('\n## ', at + 1);
  return md.slice(at + 1, next < 0 ? md.length : next);
};
const rowsOf = (text) => text.split('\n').filter((l) => /^\| `/.test(l)).map((l) => l.slice(1, -1).split(' | ').map((c) => c.trim()));
const unquote = (c) => c.replace(/^`+ ?|`+$/g, '').replace(/ $/, '');

// COMPAT.md's globals of one page: [{ name, kind }]
function globalsOf(md, page) {
  const s = section(md, `Globals: \`${page}\``);
  return s ? rowsOf(s).map((r) => ({ name: unquote(r[0]), kind: r[1] })) : [];
}

test('C1 each COMPAT.md has its parts, its pages, and only the port plan\'s view names', () => {
  for (const a of APP_NAMES) {
    const md = compatOf(a);
    assert.match(md, new RegExp(`^# COMPAT: apps/${a}$`, 'm'), `apps/${a}/COMPAT.md names its app`);
    assert.match(md, /at kit `[0-9a-f]{40}`/, `apps/${a}/COMPAT.md names the commit it was written from`);
    for (const h of ['Counts', 'The poll', 'Slices (`node:vm`)', 'Tests by view']) assert.ok(section(md, h), `apps/${a}/COMPAT.md has "${h}"`);
    const counts = rowsOf(section(md, 'Counts'));
    assert.deepEqual(counts.map((r) => unquote(r[0])), Object.keys(PAGES[a]), `apps/${a}/COMPAT.md counts its pages`);
    for (const r of counts) assert.equal(unquote(r[1]), PAGES[a][unquote(r[0])], `${unquote(r[0])}'s route`);
    const byView = rowsOf(section(md, 'Tests by view'));
    assert.ok(byView.length > 0, `apps/${a}/COMPAT.md maps tests to views`);
    const seen = new Set();
    for (const r of byView) {
      assert.match(unquote(r[0]), /^test\/.+\.mjs$/, `a test file: ${r[0]}`);
      for (const v of (r[3] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) { assert.ok(VIEWS[a].includes(v), `${r[0]}: "${v}" is one of apps/${a}'s views`); seen.add(v); }
    }
    // every view is either mapped to a test or listed as mapped to none
    const bare = md.slice(md.indexOf('### Views no item maps a test to'));
    assert.ok(md.includes('### Views no item maps a test to'), `apps/${a}/COMPAT.md lists the views no item maps a test to`);
    for (const v of VIEWS[a]) assert.ok(seen.has(v) || new RegExp(`^\\| ${v} \\|`, 'm').test(bare), `apps/${a}: the view ${v} is mapped to a test, or listed as mapped to none`);
    if (a === 'dashboard') for (const v of CANVAS_SECTIONS) assert.ok(seen.has(v) || new RegExp(`^\\| ${v} \\|`, 'm').test(bare), `the canvas section ${v} is named`);
    for (const page of Object.keys(PAGES[a])) for (const g of globalsOf(md, page)) assert.ok(['function', 'value'].includes(g.kind), `${page}: ${g.name} is a function or a value`);
  }
  // written once: APPS.md pins each file's hash, so a hand edit fails here, in CI too (C2 needs the base commit)
  const appsMd = fs.readFileSync(path.join(ROOT, 'apps', 'dashboard', 'APPS.md'), 'utf8');
  for (const a of APP_NAMES) {
    const pinned = new RegExp(`^- \`apps/${a}/COMPAT\\.md\`: sha256 \`([0-9a-f]{64})\`$`, 'm').exec(appsMd)?.[1];
    assert.ok(pinned, `APPS.md pins apps/${a}/COMPAT.md's sha256`);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'apps', a, 'COMPAT.md'))).digest('hex'), pinned, `apps/${a}/COMPAT.md is the file APPS.md pins (port tickets don't edit it)`);
  }
  const poll = section(compatOf('dashboard'), 'The poll');
  assert.match(poll, /setInterval\(…, POLL_MS\)/, 'the poll: setInterval with POLL_MS');
  assert.match(poll, /`10000`/, 'the poll: 10000');
  assert.match(poll, /window\.__polls/, 'the poll: window.__polls');
});

const baseOf = (md) => /at kit `([0-9a-f]{40})`/.exec(md)?.[1];
const base = baseOf(compatOf('dashboard'));
const hasCommit = (c) => spawnSync('git', ['cat-file', '-e', `${c}^{commit}`], { cwd: ROOT }).status === 0;
const hasBase = !!base && hasCommit(base);
// the scan also reads the design's view ranges at 3088ac1e (RANGES_AT): a checkout without it skips C2 too
const hasRanges = hasCommit('3088ac1e');

test('C2 the scan at COMPAT.md\'s commit writes both files as they are, and each root stub exports what other views call', { skip: hasBase && !hasRanges ? 'git has no 3088ac1e here (the design\'s view ranges): the scan needs it' : hasBase ? false : `git has no ${base?.slice(0, 12) ?? 'base'} here (a shallow clone): the scan needs the tests at the commit it was written from`, timeout: 100000 }, () => {
  assert.equal(baseOf(compatOf('hub')), base, 'both files are from the same commit');
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', path.join(ROOT, 'apps', 'dashboard', 'scripts', 'compat-scan.mjs'), '--base', base, '--repo', ROOT, '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 90000, maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, `compat-scan --check: ${r.stderr.trim().split('\n').slice(0, 6).join(' | ')}`.slice(0, 2000));
  // a mistyped mode or two modes: usage, exit 2, and neither file written
  const before = APP_NAMES.map((a) => fs.readFileSync(path.join(ROOT, 'apps', a, 'COMPAT.md')));
  for (const bad of [['--chek'], ['--check', '--json'], ['--repo']]) {
    const u = spawnSync(process.execPath, [path.join(ROOT, 'apps', 'dashboard', 'scripts', 'compat-scan.mjs'), '--base', base, ...bad], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    assert.equal(u.status, 2, `compat-scan --base … ${bad.join(' ')}: usage, exit 2 (${(u.stderr || '').trim().split('\n')[0]})`);
  }
  assert.deepEqual(APP_NAMES.map((a) => fs.readFileSync(path.join(ROOT, 'apps', a, 'COMPAT.md'))), before, 'a refused run writes neither COMPAT.md');
});

// A second reading, apart from the scan's and simpler: every id or class a test looks up by name
// (getElementById('x'), querySelector('#x' / '.x')) in a test COMPAT.md says opens the page, which the page at
// the base writes (id="x", a 'x' string in its script, or an id prefix `x-${…}`; class="… x …"), is listed.
const PAGE_FILE = { 'index.html': 'docs/devteam/dashboard/index.html', 'canvas.html': 'docs/devteam/dashboard/canvas.html', 'browser.html': 'docs/devteam/dashboard/browser.html', 'hub.html': 'docs/devteam/dashboard/hub.html' };
const atBase = (f) => spawnSync('git', ['show', `${base}:${f}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
const listed = (md, kind, page) => new Set(rowsOf(section(md, `${kind}: \`${page}\``) ?? '').map((r) => unquote(r[0])));

test('C4 every id and class a test looks up by name, which its page writes, is in COMPAT.md (a reading apart from the scan)', { skip: hasBase ? false : `git has no ${base?.slice(0, 12) ?? 'base'} here (a shallow clone)`, timeout: 40000 }, () => {
  const missing = [];
  for (const a of APP_NAMES) {
    const md = compatOf(a);
    const byView = rowsOf(section(md, 'Tests by view'));
    for (const page of Object.keys(PAGES[a])) {
      const html = atBase(PAGE_FILE[page]);
      const ids = listed(md, 'Ids', page), classes = listed(md, 'Classes', page);
      const prefixes = [...ids].filter((x) => x.endsWith('*')).map((x) => x.slice(0, -1));
      const classWords = new Set([...html.matchAll(/\bclass=\\?["']([^"'`$]*)/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
      const writesId = (x) => html.includes(`id="${x}"`) || html.includes(`id=\\"${x}\\"`) || (/-./.test(x) && (html.includes(`'${x}'`) || html.includes(`"${x}"`))) || [...html.matchAll(/[`"]([A-Za-z][\w:]*-)\$\{/g)].some((m) => x.startsWith(m[1]));
      for (const r of byView.filter((r) => (r[1] ?? '').includes(`\`${page}\``))) {
        const file = unquote(r[0]);
        const src = atBase(file);
        // getElementById('x'), querySelector('#x'), the page's own $('x') in code run in it, a '#x-y' selector passed to a helper (text('#n-trust'))
        for (const m of src.matchAll(/getElementById\(\s*\\?['"`]([A-Za-z][\w-]*)|querySelector(?:All)?\(\s*\\?['"`]#([A-Za-z][\w-]*)|(?<![\w$.])\$\(\s*\\?['"`]([A-Za-z][\w-]*)\\?['"`]\s*\)|\b(?!(?:startsWith|endsWith|includes|indexOf|replace|split)\()\w+\(\s*['"`]#([A-Za-z][\w]*-[\w-]*)['"`]\s*[,)]/g)) {
          const x = m[1] ?? m[2] ?? m[3] ?? m[4];
          // x- read as a prefix (#a-${qid}): listed as that prefix
          if ((x.length < 3 && !x.endsWith('-')) || !writesId(x) || ids.has(x) || prefixes.some((p) => x.startsWith(p))) continue;
          missing.push(`${page} id ${x} (${file})`);
        }
        for (const m of src.matchAll(/querySelector(?:All)?\(\s*\\?['"`]\.([A-Za-z][\w-]*)/g)) {
          if (m[1].length < 3 || !classWords.has(m[1]) || classes.has(m[1])) continue;
          missing.push(`${page} class ${m[1]} (${file})`);
        }
      }
    }
  }
  assert.deepEqual([...new Set(missing)], [], 'every id and class a test looks up by name, which its page writes, is in its COMPAT.md');
});

// ---- a built app, in Chrome ----

const builtAt = (a) => [path.join(ROOT, 'docs', 'devteam', 'apps', a), path.join(ROOT, 'apps', a, 'out')].find((d) => fs.existsSync(path.join(d, 'csp-hashes.json')));
const built = APP_NAMES.every((a) => builtAt(a));
const someBuilt = APP_NAMES.filter((a) => builtAt(a));
const skipChrome = !built ? (someBuilt.length ? 'only ' + someBuilt.join(', ') + ' is built here' : 'no app is built here') + ': run `npm ci --ignore-scripts && npm run build` in apps/dashboard and apps/hub (the parity run builds them)' : canDrive ? false : 'no Chrome here';
const STRICT = process.env.DEVTEAM_APPS_COMPAT_STRICT === '1';

const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', txt: 'text/plain; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon', webp: 'image/webp', woff2: 'font/woff2' };
// The route's policy as apps@1 serves it: script-src 'self' plus its hashes; the browser view's style-src 'self' alone;
// the dashboard app's routes but /browser/ also name the shell's font and icon origins (kit-1033).
const policyFor = (route, hashes, app) => [
  "default-src 'none'",
  `script-src 'self' ${hashes.map((h) => `'${h}'`).join(' ')}`,
  route === '/browser/' ? "style-src 'self'" : `style-src 'self' 'unsafe-inline'${app === 'dashboard' ? ' https://fonts.googleapis.com https://cdn.jsdelivr.net' : ''}`,
  route === '/browser/' ? "img-src 'none'" : "img-src 'self' data:",
  route === '/browser/' ? "font-src 'self'" : `font-src 'self'${app === 'dashboard' ? ' https://fonts.gstatic.com https://cdn.jsdelivr.net' : ''}`, "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

// A server for one built app at the root: a route's index.html under its policy, every other exported file as is.
function serve(out, app) {
  const hashes = JSON.parse(fs.readFileSync(path.join(out, 'csp-hashes.json'), 'utf8')).pages;
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const route = p.endsWith('/') ? p : null;
    const rel = route ? `${route.slice(1)}index.html` : p.slice(1);
    const file = path.join(out, rel);
    if (rel.split('/').includes('..') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404, { 'content-type': TYPES.txt }); res.end('not found'); return; }
    const head = { 'content-type': TYPES[path.extname(file).slice(1)] ?? 'application/octet-stream' };
    if (route) head['content-security-policy'] = policyFor(route, hashes[route] ?? [], app);
    res.writeHead(200, head);
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

const WATCH = "window.__cspv = []; document.addEventListener('securitypolicyviolation', (e) => window.__cspv.push(`${e.violatedDirective} ${e.blockedURI || 'inline'}`));";
// React owns the root view: a ported route's own [data-view="<view>"]; a stub route's first [data-view], as before
const hydrated = (view, ported) => `(() => { const e = document.querySelector('${ported ? `[data-view="${view}"]` : '[data-view]'}'); return !!e && Object.keys(e).some((k) => k.startsWith('__reactFiber')); })()`;
// a route's own root-view file, and whether it is still the stub (each route on its own: rulings a-20261127-085033872, a-20261127-085501674)
const rootFile = (a, view) => ['tsx', 'ts'].map((x) => path.join(ROOT, 'apps', a, 'src/views', view, `index.${x}`)).find(fs.existsSync);
const isStub = (f) => fs.readFileSync(f, 'utf8').startsWith('// apps-src@1 view stub: ');

test('C3 each route of each built app hydrates its root view under its hashed policy, with no violation; COMPAT globals not yet on the page are reported', { skip: skipChrome, timeout: 120000 }, async (t) => {
  const later = cleanup(t);
  const chrome = await openChrome();
  later(() => chrome.close());
  const missing = [];
  for (const a of APP_NAMES) {
    const srv = await serve(builtAt(a), a);
    later(() => srv.close());
    const md = compatOf(a);
    for (const [page, route] of Object.entries(PAGES[a])) {
      const p = await chrome.newPage();
      later(() => p.close());
      await p.send('Page.enable');
      await p.send('Runtime.enable');
      await p.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH });
      await p.send('Page.navigate', { url: `${srv.url}${route}` });
      const view = ROOT_VIEW[route][a];
      const file = rootFile(a, view);
      assert.ok(file, `${a}${route}: apps/${a}/src/views/${view}/index.tsx (or .ts) exists`);
      const stub = isStub(file);
      let ok = false;
      for (let i = 0; i < 150 && !ok; i++) {
        try { ok = await p.ev(hydrated(view, !stub)); } catch {}
        if (!ok) await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(ok, `${a}${route}: its root view hydrated (React owns ${stub ? '[data-view]' : `[data-view="${view}"]`}) within 15 s; violations: ${JSON.stringify(await p.ev('window.__cspv').catch(() => null))}`);
      if (stub) {
        assert.equal(await p.ev("document.querySelector('[data-view]').dataset.view"), view, `${a}${route} renders the ${view} view`);
        assert.equal(await p.ev("document.querySelector('[data-view] h1').textContent"), view, `${a}${route} shows its name`);
      } else {
        assert.equal(await p.ev(`document.querySelector('[data-view="${view}"]') !== null`), true, `${a}${route} renders the ${view} view (ported)`);
        assert.equal(await p.ev(hydrated(view, true)), true, `${a}${route}: React owns [data-view="${view}"] (ported)`);
      }
      assert.equal(await p.ev("document.getElementById('alpha-back')"), null, `${a}${route}: no back link at the root`);
      assert.deepEqual(await p.ev('window.__cspv'), [], `${a}${route}: no policy violation`);
      const globals = globalsOf(md, page);
      // the page's own: a top-level declaration or expose() is on window itself, never only inherited (window.when is EventTarget's)
      const kinds = await p.ev(`(${JSON.stringify(globals.map((g) => g.name))}).map((n) => (Object.prototype.hasOwnProperty.call(window, n) ? typeof window[n] : 'not its own'))`);
      globals.forEach((g, i) => {
        const bad = g.kind === 'function' ? kinds[i] !== 'function' : kinds[i] === 'not its own';
        if (bad) missing.push(`${a} ${page} ${g.name} (${g.kind}: ${kinds[i]})`);
      });
      t.diagnostic(`${a}${route}: ${globals.filter((g, i) => (g.kind === 'function' ? kinds[i] === 'function' : kinds[i] !== 'not its own')).length} of ${globals.length} COMPAT globals on the page`);
    }
  }
  t.diagnostic(`${missing.length} COMPAT globals not on their page yet${missing.length ? `: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ', …' : ''}` : ''}`);
  if (STRICT) assert.deepEqual(missing, [], 'DEVTEAM_APPS_COMPAT_STRICT=1: every COMPAT global is on its page');
});

// policyFor's origins are the tree's: the apps-serve policy builder's own text, run for a dashboard route, the
// browser view and the hub, names in style-src and font-src exactly the https origins policyFor names (kit-1033)
test("C5 policyFor names exactly the origins the tree's policy builder gives the dashboard, the browser view and the hub", () => {
  const t = fs.readFileSync(path.join(ROOT, 'test', 'split', 'overlay', 'apps-serve', 'overrides', 'servePage.mjs'), 'utf8');
  const text = /\n[ \t]*\/\/ policy builder start\n([\s\S]*?)\n[ \t]*\/\/ policy builder end\n/.exec(t)?.[1];
  assert.ok(text, 'servePage.mjs has the policy builder between its marker lines');
  const build = new Function(`${text}\nreturn build;`)();
  const origins = (csp, n) => (csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === n) ?? []).filter((x) => x.startsWith('https://'));
  const cases = [['dashboard', '/', build("default-src 'none'", [], false, true)], ['dashboard', '/browser/', build("default-src 'none'", [], true, false)], ['hub', '/', build("default-src 'none'", [], false, false)]];
  for (const [a, route, tree] of cases) for (const n of ['style-src', 'font-src']) assert.deepEqual(origins(policyFor(route, [], a), n), origins(tree, n), `${a}${route}: ${n}'s origins are the tree's`);
});
