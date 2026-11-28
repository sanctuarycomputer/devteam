// The dashboard shell (dashboard-shell@2, test/contracts/shell.md): its two blocks are
// byte-identical in index.html and hub.html, scoped so today's pages can't change, and their
// builders, binders and URL rules do what the contract says (run in vm, over a tiny DOM of their
// own HTML); the measure check (test/lib/measure.mjs) passes on the fixture page built only from
// the blocks, at three sizes, and fails, check by check, on broken copies; and the hub frame's two
// fakes talk as §10 says, on two loopback origins (both headless Chrome).
//
// Ported to the apps (kit-988): "the page" is now the apps' sources and builds. The blocks run as
// apps/dashboard/lib-dist/ modules, imported fresh per load(); their text is sliced from the sources
// (src/shared/layout/layout.css, src/shared/shell/shell.ts, src/lib/shell-routes.ts); markup is read in
// each app's built / (docs/devteam/apps/<app>/index.html, else apps/<app>/out/index.html); code is read
// in each app's src/** (.ts, .tsx, .css) joined.
import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { CHECKS, SIZES, measure, measureAt } from './lib/measure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const APP = (app, ...p) => path.join(ROOT, 'apps', app, ...p);
const LIB = APP('dashboard', 'lib-dist');
// with no lib-dist/, every test skips locally; under CI the file fails
const UNBUILT = fs.existsSync(LIB) ? false : 'build apps/dashboard first (npm run build)';
if (UNBUILT && process.env.CI) throw new Error(UNBUILT);
const test = (name, o, fn) => { if (typeof o === 'function') { fn = o; o = {}; } return nodeTest(name, UNBUILT ? { ...o, skip: UNBUILT } : o, fn); };
const SHELL_MD = fs.readFileSync(path.join(here, 'contracts', 'shell.md'), 'utf8');
const block = (src, name) => {
  const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`);
  assert.ok(a >= 0 && b > a, `the ${name} block is in the page`);
  assert.equal(src.indexOf(`/* ${name} start */`, a + 1), -1, `one ${name} block`);
  return src.slice(a, b + `/* ${name} end */`.length);
};
const without = (src, ...names) => names.reduce((s, n) => s.replace(block(s, n), ''), src);

// the blocks as modules: each load() imports a fresh instance (its own registry), with ctx.localStorage on
// globalThis for that instance's calls (a load() with none removes it)
const SHELL_JS = path.join(LIB, 'shared', 'shell', 'shell.js');
const shellUrl = pathToFileURL(SHELL_JS).href;
const routesUrl = pathToFileURL(path.join(LIB, 'lib', 'shell-routes.js')).href;
let loads = 0;
const load = async (ctx = {}) => {
  if (ctx.localStorage) Object.defineProperty(globalThis, 'localStorage', { value: ctx.localStorage, configurable: true, writable: true, enumerable: true });
  else Reflect.deleteProperty(globalThis, 'localStorage');
  const k = ++loads;
  return { ...(await import(`${shellUrl}?n=${k}`)), ...(await import(`${routesUrl}?n=${k}`)) };
};
const S = UNBUILT ? null : await load();
const R = S?.SHELL_ROUTES;

// the sources: each app's src/** (.ts, .tsx, .css), joined in path order
const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const sources = (app) => walk(APP(app, 'src')).filter((f) => /\.(?:ts|tsx|css)$/.test(f)).sort().map((f) => ({ file: path.relative(ROOT, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }));
const joined = (files) => files.map((f) => f.text).join('\n');
const SRC_FILES = sources('dashboard');
const SRC = joined(SRC_FILES);
const HUB_FILES = sources('hub');
const HUB_SRC = joined(HUB_FILES);
const srcOf = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SHELL_TS = 'apps/dashboard/src/shared/shell/shell.ts';
const LAYOUT_CSS = srcOf('apps/dashboard/src/shared/layout/layout.css');
const LAYOUT = block(LAYOUT_CSS, 'devteam-layout');
// the block's text, for its names; where JS must run, the built module with its exports dropped
const JS = block(srcOf(SHELL_TS), 'devteam-shell-js').replace(/^export /gm, '');
const JS_RUN = () => fs.readFileSync(SHELL_JS, 'utf8').replace(/^export /gm, '');
const ROUTES_SRC = block(srcOf('apps/dashboard/src/lib/shell-routes.ts'), 'shell-routes');
// each app's built /, its inline scripts and its own stylesheets (in the page's order)
const builtPage = (app) => {
  const at = [path.join(ROOT, 'docs', 'devteam', 'apps', app, 'index.html'), APP(app, 'out', 'index.html')].find((f) => fs.existsSync(f));
  assert.ok(at, `the ${app}'s built / is missing: build apps/${app} (npm run build), so docs/devteam/apps/${app}/index.html or apps/${app}/out/index.html exists`);
  return { file: at, html: fs.readFileSync(at, 'utf8') };
};
const inlineScripts = (html) => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/\bsrc=/.test(m[1]) && !/\btype="(?!text\/javascript")/.test(m[1])).map((m) => m[2]);
const builtCss = (app) => {
  const { file, html } = builtPage(app);
  return [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].map((m) => /\bhref="(\/[^"/][^"]*)"/.exec(m[0])?.[1]).filter(Boolean)
    .map((href) => fs.readFileSync(path.join(path.dirname(file), href.split('?')[0].slice(1)), 'utf8')).join('\n');
};
// the shell view's delegating wrappers (export function <n>(…) { return <Ns>.<n>(…); }, Ns a namespace
// import): the block's own function under the name APPS.md requires, not a second definition
const SHELL_VIEW = 'apps/dashboard/src/views/shell/index.tsx';
// apps-src@1: a view stub's typed throwing functions are the contract's placeholders, not declarations
const isViewStub = (f) => f.text.startsWith('// apps-src@1 view stub: ');
const wrappersOut = (src) => {
  const ns = new Set([...src.matchAll(/^import \* as ([A-Za-z_$][\w$]*) from /gm)].map((m) => m[1]));
  return src.replace(/^export function ([A-Za-z_$][\w$]*)\s*\([^)]*\)(?:\s*:\s*[^{;]+)?\s*\{\s*return\s+([A-Za-z_$][\w$]*)\.\1\s*\([^)]*\)\s*;?\s*\}/gm, (w, _n, o) => (ns.has(o) ? '' : w));
};
const hubWrappersOut = (src) => { const imp = (src.match(/^import \* as [A-Za-z_$][\w$]* from .*$/gm) ?? []).join('\n'); return src.split('\n').map((l) => (/^export function (?:bindFleetSwitch|fleetSwitch)\b/.test(l) ? wrappersOut(`${imp}\n${l}`).slice(imp.length + 1) : l)).join('\n'); };

// ---- a tiny DOM: the builders' own HTML, parsed, with the few calls the binders make ----
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'wbr']);
class El {
  constructor(tag, attrs = {}, parent = null) { this.tagName = tag.toUpperCase(); this.attrs = attrs; this.parentElement = parent; this.children = []; this.text = ''; this.focused = false; this.isConnected = true; }
  getAttribute(k) { return Object.hasOwn(this.attrs, k) ? this.attrs[k] : null; }
  get dataset() { const d = {}; for (const [k, v] of Object.entries(this.attrs)) if (k.startsWith('data-')) d[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; return d; }
  get classList() { return (this.attrs.class || '').split(/\s+/).filter(Boolean); }
  get disabled() { return Object.hasOwn(this.attrs, 'disabled'); }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  matchesOne(sel) {
    const m = /^([a-z0-9]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i.exec(sel.trim());
    if (!m) throw new Error(`the tiny DOM can't read ${sel}`);
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classList.includes(c)) return false;
    for (const a of m[3].match(/\[[^\]]+\]/g) || []) { const [, k, v] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a); if (!Object.hasOwn(this.attrs, k) || (v !== undefined && this.attrs[k] !== v)) return false; }
    return true;
  }
  matches(sel) {
    return sel.split(',').some((s) => {
      const parts = s.trim().split(/\s+/);
      if (!this.matchesOne(parts.pop())) return false;
      let at = this.parentElement;
      while (parts.length) { while (at && !at.matchesOne(parts[parts.length - 1])) at = at.parentElement; if (!at) return false; parts.pop(); at = at.parentElement; }
      return true;
    });
  }
  closest(sel) { for (let e = this; e; e = e.parentElement) if (e.matches(sel)) return e; return null; }
  contains(o) { for (let e = o; e; e = e.parentElement) if (e === this) return true; return false; }
  querySelectorAll(sel) { const out = []; const walk = (e) => { for (const c of e.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  focus() { this.focused = true; }
  addEventListener(type, fn) { (this.on ??= {})[type] = [...(this.on?.[type] || []), fn]; }
  set innerHTML(html) {
    for (const c of this.children) c.isConnected = false;
    this.children = [];
    let at = this;
    for (const m of html.matchAll(/<(\/?)([a-z0-9]+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/gi)) {
      if (m[4] !== undefined) { at.text += m[4]; continue; }
      if (m[1]) { at = at.parentElement || this; continue; }
      const attrs = {};
      for (const a of m[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
      const e = new El(m[2], attrs, at);
      at.children.push(e);
      if (!VOID.has(m[2].toLowerCase())) at = e;
    }
  }
}
// an event at target, through the root's delegated listeners
const fire = (root, type, target, extra = {}) => { const e = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra }; for (const fn of root.on?.[type] || []) fn(e); return e; };
const rootWith = (html) => { const r = new El('div'); r.innerHTML = html; return r; };

test('shell.md says @3 and defines what the design lists', () => {
  assert.match(SHELL_MD, /^Contract `dashboard-shell@3`\./m, 'shell.md is headed dashboard-shell@3');
  assert.match(SHELL_MD, /^- \*\*@2\*\* \(`kit-267`\): /m, 'a @2 line in its History');
  assert.match(SHELL_MD, /^- \*\*@3\*\* \(`kit-611`\): /m, 'a @3 line in its History');
  // @3 (kit-611): the tab bar's panels and sub size, the terminal th values, a file peek's view, tab choices as history, §10 amended.
  // Read with the History section cut off, so a rule deleted from its section goes red even though the @3 line names it
  const body = SHELL_MD.split(/^## History$/m)[0];
  assert.ok(body.length < SHELL_MD.length, 'shell.md has a History section');
  for (const n of ['aria-controls', 'aria-labelledby', 'role=tabpanel', "size: 'sub'", 'tabPanel', 'tabSelected', 'th=supervisor', 'th=shell', 'view=raw', "Every tab set's choice is a state key", 'it is a history entry', 'while a peek is open replaces the entry', 'history.state = { hub: 1, key }', 'only selects the tab', 'no `openAt`', "After a reload the marker isn't enough", '**`hub-route` still replaces**', "{ devteam: 'hub-visible', visible }", '**A file peek\'s view** is in its query', '`inbox`, `open`, `resolved`, `supervisor`, `shell`']) assert.ok(body.includes(n), `shell.md @3 says ${n} outside its History`);
  assert.match(SHELL_MD, /^## 10\. The hub frame$/m, 'a §10');
  // §6, §7, §8 and §10 name what the design's 'Contract dashboard-shell@2' section says
  for (const n of ['`p=q/<id>`', '`i`', '`u`', 'SHELL_ROUTES.peeks', 'peekHead', 'legacy: true', '`tree/<id>`', '`wt/<worktree>`', '`path`', '`route`', '`talk/<t-id>?u=<u-id>`', 'th=inbox&i=', 'URLSearchParams', 'artifactPathOk', 'reads its page from the head', '`hub-route`', '`hub-base`', '2,048', '`null`', 'postHead()', '`box: 2`', '#<key>/<head>', '`#overview?ot=<id>`', 'test/fixtures/hub-frame-fake.html', 'test/fixtures/dashboard-frame-fake.html', 'An empty value is a value']) assert.ok(SHELL_MD.includes(n), `shell.md says ${n}`);
  assert.match(SHELL_MD, /`box: 2`\) it is the project's own host, `https:\/\/<project>\.<box>\/#`/, "hub-base's base on a box: 2 box");
  assert.match(SHELL_MD, /under `box: 1`, and on a laptop, it is the hub's own address/, "hub-base's base under box: 1 and on a laptop");
  assert.match(SHELL_MD, /§8 governs freshness/);
  for (const t of ['--page-max', '--page-top', '--page-pad', '--header-pad', '--panel-pad', '--head-h', '--backdrop', '--gap', '--ease', '--dur', '--threads-w', '--bar-h', '--measure']) {
    assert.ok(SHELL_MD.includes(`\`${t}\``), `shell.md defines ${t}`);
    assert.match(LAYOUT, new RegExp(`${t}:`), `the layout block sets ${t}`);
  }
  for (const n of ['.g12', '.cards', 'registerPage', 'tabBar', 'bindTabBar', 'dbTable', 'bindDbTable', 'props', 'goalSteps', 'heartbeat', 'statusPill', 'fleetSwitch', 'bindFleetSwitch', 'threadsTabs.register', 'parseHead', 'headFor', 'stampFor', 'closeTarget', 'rememberedFilters', 'history.state', 'redirects', '#<page>[?<state>]']) assert.ok(SHELL_MD.includes(n), `shell.md defines ${n}`);
  for (const k of ['th', 't', 'goal', 'feat', 'repo', 'att', 'gt', 'narrow', 'show', 'kind', 'st', 'lt', 'orient']) assert.ok(SHELL_MD.includes(`\`${k}\``), `shell.md names the state key ${k}`);
  assert.match(SHELL_MD, /no ticket before the copy sweep \(`kit-95`\) changes either block/);
});

test('both blocks are byte-identical in index.html and hub.html', () => {
  // one copy of each: the hub imports the dashboard's (kit-1012, hub-shell) and holds none of its own
  assert.match(HUB_SRC, /^import\s+['"]@shared\/layout\/layout\.css['"]/m, 'the layout block: the hub imports @shared/layout/layout.css');
  assert.match(HUB_SRC, /^import\b[^;]*\bfrom\s+['"]@shared\/shell\/shell['"]/m, 'the JS block: the hub imports @shared/shell/shell');
  for (const n of ['devteam-layout', 'devteam-shell-js']) assert.ok(!HUB_SRC.includes(`/* ${n} start */`), `the hub's sources hold no copy of the ${n} block`);
  // the layout block sits right after the tokens block, so each page's own CSS comes after it: in each app's
  // CSS, its sources' and the @shared CSS they import
  const sharedCss = (src) => [...src.matchAll(/^import\s+['"]@shared\/([^'"]+\.css)['"]/gm)].map((m) => srcOf(`apps/dashboard/src/shared/${m[1]}`)).join('\n');
  for (const [name, src] of [["the dashboard's CSS", SRC], ["the hub's CSS", `${HUB_SRC}\n${sharedCss(HUB_SRC)}`]]) {
    const after = src.slice(src.indexOf('/* devteam-ui tokens end */') + '/* devteam-ui tokens end */'.length);
    assert.match(after, /^\s*\/\* devteam-layout start \*\//, `${name}: the layout block follows the tokens block`);
  }
});

test("every layout rule is scoped to .shell: index adopts it with its old regions fenced, the hub has none yet", () => {
  // every selector, inside @media or not, is :root or starts with :where(.shell)
  const css = LAYOUT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const sels = [];
  const splitTop = (h) => { const out = []; let d = 0, cur = ''; for (const c of h) { if (c === '(') d++; if (c === ')') d--; if (c === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += c; } out.push(cur.trim()); return out; };
  const walk = (s) => { let i = 0; while (i < s.length) { const o = s.indexOf('{', i); if (o < 0) break; const head = s.slice(i, o).trim(); let d = 1, j = o + 1; while (d && j < s.length) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; } const body = s.slice(o + 1, j - 1); if (head.startsWith('@media')) walk(body); else sels.push(...splitTop(head)); i = j; } };
  walk(css);
  assert.ok(sels.length > 50, 'the selectors were read');
  // and its subject sits outside any .no-shell region (the lower boundary), with no weight added
  const B = ':not(:where(.no-shell, .no-shell *))';
  for (const s of sels) assert.ok(s === ':root' || (/^:where\(\.shell\)(\.peek-open|\.threads-open)?[ :]/.test(s) && /:not\(:where\(\.no-shell, \.no-shell \*\)\)(::[\w-]+)?$/.test(s)), `scoped and fenced: ${s}`);
  assert.ok(sels.filter((s) => s.includes(B)).length === sels.filter((s) => s !== ':root').length);
  const frames = [...LAYOUT.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual(frames, ['shell-ring'], 'its one animation has a name of its own');
  // index adopts the shell (kit-87): .shell on <body>, every region it doesn't port fenced with .no-shell
  // the hub has no .shell until its own ticket (kit-94)
  // the markup is the built /; .shell goes on <body> in its first inline script, as the shell writes it
  const IDX = builtPage('dashboard').html;
  assert.match(inlineScripts(IDX)[0] ?? '', /\bdocument\.body\.classList\.add\((['"])shell\1\)/, 'index.html adopts the shell on <body>');
  // Goals and Overview are ported (kit-90), the Board and Progress (kit-91) and the Library (kit-92), so none is in the fenced list
  assert.doesNotMatch(IDX.match(/<[a-z]+\b[^>]*\bid="library"[^>]*>/)?.[0] ?? 'missing', /no-shell|missing/, '#library is there and carries no no-shell');
  // Trust is ported (kit-93)
  assert.doesNotMatch(IDX.match(/<[a-z]+\b[^>]*\bid="trust"[^>]*>/)?.[0] ?? 'missing', /no-shell|missing/, '#trust is there and carries no no-shell');
  // the Loop is ported (kit-96): it carries no no-shell
  assert.doesNotMatch(IDX.match(/<[a-z]+\b[^>]*\bid="loop"[^>]*>/)?.[0] ?? 'missing', /no-shell|missing/, '#loop is there and carries no no-shell');
  // Sensors is ported and Health folded into its Fleet tab (kit-93): no #health, #monitoring unfenced
  assert.doesNotMatch(IDX, /\bid="health"/, 'index.html has no #health section');
  assert.doesNotMatch(IDX.match(/<[a-z]+\b[^>]*\bid="monitoring"[^>]*>/)?.[0] ?? 'missing', /no-shell|missing/, '#monitoring is there and carries no no-shell');
  assert.doesNotMatch(IDX.match(/<[a-z]+\b[^>]*\bid="retros"[^>]*>/)?.[0] ?? 'missing', /no-shell|missing/, '#retros is there and carries no no-shell');
  for (const id of ['review-view', 'artifact-view', 'tl']) {
    const tag = IDX.match(new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `index.html has #${id}`);
    assert.match(tag, /\bclass="[^"]*(?<![\w-])no-shell(?![\w-])/, `#${id} carries no-shell: ${tag}`);
  }
  // the Inbox is ported (kit-100): no #inbox section any more, and the panel's #th-inbox is not fenced
  assert.doesNotMatch(IDX, /\bid="inbox"/, 'index.html has no #inbox section');
  assert.doesNotMatch(IDX.match(/<[a-z]+\b[^>]*\bid="th-inbox"[^>]*>/)?.[0] ?? 'missing', /no-shell|missing/, '#th-inbox is there and carries no no-shell');
  // the hub adopts it too (kit-94): .shell on <body>, its timeline and frames fenced with .no-shell
  assert.match(inlineScripts(builtPage('hub').html)[0] ?? '', /\bdocument\.body\.classList\.add\((['"])shell\1\)/, 'hub.html adopts the shell on <body>');
  // the code: each app's sources, the dashboard's without its blocks (the hub holds no copy)
  for (const [name, rest] of [["the dashboard's sources", without(SRC, 'devteam-layout', 'devteam-shell-js')], ["the hub's sources", HUB_SRC]]) {
    for (const f of frames) assert.doesNotMatch(rest, new RegExp(`@keyframes\\s+${f}\\b|animation(-name)?:[^;]*\\b${f}\\b`), `${name} has no animation of the block's name ${f}`);
  }
  // index's own --measure (78ch, words') still comes after the block in the built CSS, so it still wins there
  // (the build drops comments: the block's place is its own --measure)
  const built = builtCss('dashboard');
  const own = built.search(/--measure:\s*calc\(/);
  assert.ok(own >= 0 && built.search(/--measure:\s*78ch/) > own, "index's --measure still wins on index");
});

test("the JS block's names are its own: neither page declares one outside it", async () => {
  const names = [...JS.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.ok(names.includes('tabBar') && names.includes('parseHead') && names.includes('goalSteps'), 'its names were read');
  // any source but shell.ts and the view stubs; the shell view's delegating wrappers are the block's own functions
  const decl = joined(SRC_FILES.filter((f) => f.file !== SHELL_TS && !isViewStub(f)).map((f) => (f.file === SHELL_VIEW ? { ...f, text: wrappersOut(f.text) } : f)));
  for (const [name, rest] of [["the dashboard's sources", decl], ["the hub's sources", joined(HUB_FILES.filter((f) => !isViewStub(f)).map((f) => (f.file === 'apps/hub/src/views/hub-shell/index.tsx' ? { ...f, text: hubWrappersOut(f.text) } : f)))]]) {
    for (const n of names) assert.doesNotMatch(rest, new RegExp(`(?:^|[\\s;(])(?:const|let|var|function|class)\\s+${n.replace('$', '\\$')}\\b`, 'm'), `${name} declares ${n} outside the block`);
  }
  // and it runs alone: no page global, no DOM at load
  assert.doesNotThrow(() => vm.runInContext(JS_RUN(), vm.createContext({})));
  // each built page's inline scripts compile, and every lib-dist/ module imports (the block's among them)
  for (const [name, app] of [['index.html', 'dashboard'], ['hub.html', 'hub']]) {
    const scripts = inlineScripts(builtPage(app).html);
    assert.ok(scripts.length > 0, `${name}: its inline scripts were read`);
    for (const x of scripts) assert.doesNotThrow(() => new vm.Script(x), `${name}: a script compiles`);
  }
  const mods = walk(LIB).filter((f) => f.endsWith('.js'));
  assert.ok(mods.includes(SHELL_JS), 'the block is in a lib-dist/ module');
  for (const m of mods) await assert.doesNotReject(import(pathToFileURL(m).href), `${path.relative(LIB, m)} imports`);
  // index's own step bar is gone (kit-90): every caller draws the block's goalSteps
  assert.doesNotMatch(SRC, /function goalStepper\b/);
  assert.doesNotMatch(without(SRC, 'devteam-shell-js'), /\bgoalSteps\(g, s, R\)/);
});

test('tabBar: counts, disabled tabs, roving tabindex; arrows, Home and End skip disabled tabs', () => {
  const tabs = [{ id: 'a', label: 'A', count: 2 }, { id: 'b', label: 'B', disabled: true }, { id: 'c', label: 'C <x>', count: 1, waiting: true }, { id: 'd', label: 'D' }];
  const html = S.tabBar({ tabs, selected: 'c' });
  assert.match(html, /role="tablist"/);
  assert.match(html, /data-tab="c" aria-selected="true" tabindex="0"/);
  assert.match(html, /data-tab="a" aria-selected="false" tabindex="-1"/);
  assert.match(html, /data-tab="b"[^>]*aria-disabled="true"/);
  assert.match(html, /C &lt;x&gt; <span class="n blue">1<\/span>/, 'a waiting count is blue, and a label is text');
  assert.match(html, /A <span class="n">2<\/span>/);
  assert.match(S.tabBar({ tabs, selected: 'b' }), /data-tab="a" aria-selected="true"/, 'a disabled selection falls to the first enabled tab');
  assert.equal(S.tabStep(tabs, 'a', 'ArrowRight'), 'c', 'skips the disabled tab');
  assert.equal(S.tabStep(tabs, 'c', 'ArrowLeft'), 'a');
  assert.equal(S.tabStep(tabs, 'd', 'ArrowRight'), 'a', 'wraps');
  assert.equal(S.tabStep(tabs, 'a', 'ArrowLeft'), 'd', 'wraps back');
  assert.equal(S.tabStep(tabs, 'c', 'Home'), 'a');
  assert.equal(S.tabStep([{ id: 'x', disabled: true }, ...tabs.slice(0, 2)], 'a', 'Home'), 'a', 'Home skips a disabled first tab');
  assert.equal(S.tabStep(tabs, 'a', 'End'), 'd');
  assert.equal(S.tabStep(tabs, 'a', 'Enter'), null);
  assert.equal(S.tabStep(tabs, 'gone', 'ArrowRight'), 'a', 'from a tab that is gone, Right goes to the first');
  assert.equal(S.tabStep(tabs, 'gone', 'ArrowLeft'), 'd', 'and Left to the last');
  // bound: keys and clicks select through onSelect, focus the tab again after a redraw, never a disabled one
  const root = rootWith(html);
  let sel = 'c';
  const said = [];
  S.bindTabBar(root, { onSelect: (id) => { said.push(id); sel = id; root.innerHTML = S.tabBar({ tabs, selected: sel }); } });
  const tab = (id) => root.querySelectorAll('[role="tab"]').find((b) => b.dataset.tab === id);
  const k = fire(root, 'keydown', tab('c'), { key: 'ArrowRight' });
  assert.ok(k.defaultPrevented);
  assert.deepEqual(said, ['d']);
  assert.ok(tab('d').focused, 'the selected tab has focus after the redraw');
  fire(root, 'keydown', tab('d'), { key: 'ArrowRight' });
  fire(root, 'keydown', tab('a'), { key: 'ArrowRight' });
  fire(root, 'keydown', tab('c'), { key: 'Home' });
  fire(root, 'keydown', tab('a'), { key: 'End' });
  fire(root, 'keydown', tab('d'), { key: 'ArrowLeft' });
  assert.deepEqual(said, ['d', 'a', 'c', 'a', 'd', 'c']);
  fire(root, 'click', tab('b'));
  fire(root, 'keydown', tab('c'), { key: 'x' });
  assert.equal(said.length, 6, 'a disabled tab and another key select nothing');
  fire(root, 'click', tab('a').children.length ? tab('a').children[0] : tab('a'));
  assert.equal(said.at(-1), 'a', 'a click on an enabled tab (or inside it) selects it');
});

test('terminal A2: the tab bar', () => {
  const tabs = [{ id: 'open', label: 'Open', count: 2 }, { id: 'x', label: 'X', disabled: true }];
  // A2a: panel and size add the tablist's size class and each tab's id and aria-controls
  const sub = S.tabBar({ tabs, selected: 'open', panel: 'th-list', size: 'sub' });
  assert.ok(sub.includes('<div class="tabbar sub" role="tablist">'), sub);
  assert.ok(sub.includes('data-tab="open" id="tab-th-list-open" aria-controls="th-list"'), sub);
  assert.ok(sub.includes('data-tab="x" id="tab-th-list-x" aria-controls="th-list"'), sub);
  // A2b: tabPanel is labelled by the tab tabBar selects
  assert.equal(S.tabPanel({ panel: 'th-list', tabs, selected: 'open' }, '<p>x</p>'), '<div role="tabpanel" id="th-list" aria-labelledby="tab-th-list-open"><p>x</p></div>');
  assert.equal(S.tabPanel({ panel: 'th-list', tabs, selected: 'x' }, '<p>x</p>'), '<div role="tabpanel" id="th-list" aria-labelledby="tab-th-list-open"><p>x</p></div>', 'a disabled selection labels by the first enabled tab');
  assert.equal(S.tabPanel({ panel: 'A b', tabs, selected: 'open' }, '<p>x</p>'), '<p>x</p>');
  assert.equal(S.tabPanel({ panel: '', tabs, selected: 'open' }, '<p>x</p>'), '<p>x</p>');
  assert.equal(S.tabPanel({ panel: 'th-list', tabs, selected: 'open' }, null), '<div role="tabpanel" id="th-list" aria-labelledby="tab-th-list-open"></div>');
  const odd = [{ id: 'a b', label: 'A' }];
  const oddBar = S.tabBar({ tabs: odd, selected: 'a b', panel: 'th-list' });
  assert.ok(!oddBar.includes(' id="tab-') && !oddBar.includes('aria-controls'), oddBar);
  assert.equal(S.tabPanel({ panel: 'th-list', tabs: odd, selected: 'a b' }, 'h'), '<div role="tabpanel" id="th-list">h</div>');
  assert.equal(S.tabPanel({ panel: 'th-list', tabs: [{ id: 'x', label: 'X', disabled: true }] }, 'h'), '<div role="tabpanel" id="th-list">h</div>', 'no enabled tab: no aria-labelledby');
  // A2e: without panel (and with a bad panel and size) it is today's output, a literal pasted from the unchanged builder
  const today = '<div class="tabbar" role="tablist"><button type="button" role="tab" data-tab="open" aria-selected="true" tabindex="0">Open <span class="n">2</span></button><button type="button" role="tab" data-tab="x" aria-selected="false" tabindex="-1" aria-disabled="true">X</button></div>';
  assert.equal(S.tabBar({ tabs, selected: 'open' }), today);
  assert.equal(S.tabBar({ tabs, selected: 'open', panel: 'A b', size: 'big' }), today);
});

test('terminal A2: the URL', () => {
  // A2c: the side panel's Supervisor and Shell tabs (th=supervisor, th=shell) are kept and written back
  for (const h of ['#overview?th=supervisor', '#board?goal=g-1&th=shell']) assert.equal(S.headFor(S.parseHead(h, R)), h, h);
  // A2d: a file peek's view: the first value decides, raw or rendered only, written last
  const fp = (q) => '#library?p=' + encodeURIComponent('file?' + q);
  const raw = '#library?p=file%3Fpath%3Ddocs%252Fa.md%26ref%3Dmain%26view%3Draw';
  const rendered = '#library?p=file%3Fpath%3Ddocs%252Fa.md%26ref%3Dmain%26view%3Drendered';
  const noView = '#library?p=file%3Fpath%3Ddocs%252Fa.md%26ref%3Dmain';
  assert.equal(S.parseHead(raw, R).state.p, 'file?path=docs%2Fa.md&ref=main&view=raw');
  assert.equal(S.headFor(S.parseHead(fp('path=docs/a.md&ref=main&view=raw'), R)), raw);
  assert.equal(S.headFor(S.parseHead(raw, R)), raw);
  assert.equal(S.headFor(S.parseHead(fp('path=docs/a.md&ref=main&view=rendered'), R)), rendered);
  assert.equal(S.headFor(S.parseHead(fp('path=docs/a.md&ref=main&view=wide'), R)), noView, 'a bad view is dropped');
  assert.equal(S.headFor(S.parseHead(fp('path=docs/a.md&ref=main&view=Raw'), R)), noView, 'view is case-exact');
  assert.equal(S.headFor(S.parseHead(fp('path=docs/a.md&ref=main&view=raw&view=wide'), R)), raw, 'the first value decides, one view');
  assert.equal(S.headFor(S.parseHead(fp('path=docs/a.md&ref=main&view=wide&view=raw'), R)), noView, 'the first bad value decides');
  assert.equal(S.headFor(S.parseHead(fp('path=docs/a.md&view=raw&ref=main'), R)), raw, 'view is written last');
  // another kind: view is not read, so a ticket head keeps whatever it carries
  const tk = '#board?p=' + encodeURIComponent('ticket/kit-1?view=wide');
  assert.equal(S.parseHead(tk, R).state.p, 'ticket/kit-1?view=wide');
  assert.equal(S.headFor(S.parseHead(tk, R)), tk);
});

test('dbTable: numeric sort, a second press reverses, None when empty; onOpen gets the index as passed', () => {
  const rows = [['kit-10', '<b>ten</b>'], ['kit-2', 'two'], ['kit-1', 'one'], { cells: ['kit-x', 'x'], sort: ['kit-3', 'x'] }];
  const order = (html) => [...html.matchAll(/data-row="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(order(S.dbTable(['Id', 'Title'], rows)), [0, 1, 2, 3], 'unsorted: as passed');
  let sort = S.nextSort(null, 0);
  assert.deepEqual({ ...sort }, { col: 0, dir: 1 });
  const up = S.dbTable(['Id', { label: 'Title' }], rows, { sort });
  assert.deepEqual(order(up), [2, 1, 3, 0], 'numeric-aware: 1, 2, 3 (a sort key), 10');
  assert.match(up, /aria-sort="ascending"><button type="button" class="sort" data-col="0">Id ↑/);
  assert.match(up, /<tr class="click" data-row="2" tabindex="0"><td><div class="cell">kit-1<\/div><\/td>/, 'each row is focusable, its cells in .cell');
  sort = S.nextSort(sort, 0);
  assert.deepEqual(order(S.dbTable(['Id', 'Title'], rows, { sort })), [0, 3, 1, 2], 'the same column again reverses');
  assert.deepEqual({ ...S.nextSort(sort, 1) }, { col: 1, dir: 1 }, 'another column starts ascending');
  assert.deepEqual(order(S.dbTable(['Id', 'Title'], rows, { sort: { col: 1, dir: 1 } })), [2, 0, 1, 3], 'by the cell text, tags stripped: one, ten, two, x');
  assert.deepEqual(S.sortRows([['a'], ['a'], ['a']], { col: 0, dir: -1 }).map(([i]) => i), [0, 1, 2], 'stable');
  const none = S.dbTable(['Id', 'Title'], []);
  assert.match(none, /<tr class="none"><td colspan="2"><div class="cell">None<\/div><\/td><\/tr>/);
  assert.doesNotMatch(none, /data-row/);
  // bound, through a page that keeps the sort and redraws
  const root = rootWith('');
  let st = null;
  const opened = [];
  const draw = () => { root.innerHTML = S.dbTable(['Id', 'Title'], rows, { sort: st }); };
  draw();
  S.bindDbTable(root, { onSort: (c) => { st = S.nextSort(st, c); draw(); }, onOpen: (i) => opened.push(i) });
  const row = (n) => root.querySelectorAll('tr[data-row]')[n];
  fire(root, 'click', row(1).children[0].children[0]);
  assert.deepEqual(opened, [1], 'a click on a row opens its index');
  fire(root, 'click', root.querySelectorAll('button.sort')[0]);
  assert.equal(row(0).dataset.row, '2', 'sorted');
  fire(root, 'click', row(0));
  const ent = fire(root, 'keydown', row(3), { key: 'Enter' });
  assert.ok(ent.defaultPrevented);
  assert.deepEqual(opened, [1, 2, 0], 'after a sort, the index in rows as passed, on a click and on Enter');
  fire(root, 'click', root.querySelectorAll('button.sort')[0]);
  assert.equal(row(0).dataset.row, '0', 'a second press reverses');
  fire(root, 'keydown', row(0), { key: ' ' });
  fire(root, 'keydown', row(0).children[0], { key: 'Enter' });
  assert.deepEqual(opened, [1, 2, 0], 'other keys, and Enter not on the row itself, open nothing');
  root.innerHTML = S.dbTable(['Id'], [['<a href="#x">x</a>']]);
  fire(root, 'click', root.querySelectorAll('a')[0]);
  assert.deepEqual(opened, [1, 2, 0], "a link in a row is the link's");
  root.innerHTML = S.dbTable(['Id'], [['<button type="button">b</button>'], ['<label><input type="checkbox"> l</label>']]);
  fire(root, 'click', root.querySelectorAll('td button')[0]);
  fire(root, 'click', root.querySelectorAll('td label')[0]);
  fire(root, 'keydown', root.querySelectorAll('td button')[0], { key: 'Enter' });
  assert.deepEqual(opened, [1, 2, 0], "a button, a label or Enter on a control in a row is the control's");
  // numbers as numbers: decimals and negatives; a null sort key as empty
  const nums = [{ cells: ['a'], sort: ['1.5'] }, { cells: ['b'], sort: ['1.25'] }, { cells: ['c'], sort: ['-2'] }, { cells: ['d'], sort: [null] }, { cells: ['e'], sort: ['10'] }];
  assert.deepEqual(S.sortRows(nums, { col: 0, dir: 1 }).map(([i]) => i), [3, 2, 1, 0, 4], 'empty, -2, 1.25, 1.5, 10');
  // a mixed column is text throughout: the same order from any input order
  const mixed = ['1.9', '1.9a', '1.10'].map((k) => ({ cells: [k], sort: [k] }));
  const orders = [[0, 1, 2], [2, 1, 0], [1, 2, 0]].map((o) => S.sortRows(o.map((i) => mixed[i]), { col: 0, dir: 1 }).map(([, r]) => r.sort[0]).join(' '));
  assert.equal(new Set(orders).size, 1, `one order: ${orders.join(' | ')}`);
});

test('every builder escapes the text it is given, in attributes too', () => {
  const evil = `x"&<y>'z`;
  const esc = 'x&quot;&amp;&lt;y&gt;&#39;z';
  assert.equal(S.escHtml(evil), esc);
  const has = (html, what) => { assert.ok(html.includes(esc), `${what} escapes all five`); assert.ok(!html.includes(evil) && !html.includes('x"'), `${what} lets nothing raw through`); };
  has(S.tabBar({ tabs: [{ id: evil, label: evil, count: evil }], selected: evil }), 'tabBar (id, label, count)');
  has(S.dbTable([evil], []), 'dbTable (a column)');
  has(S.props([[evil, 'v', evil]]), 'props (a key and its tip)');
  has(S.goalSteps({ step: 3, built: { frac: 0.5, text: evil, title: evil } }), 'goalSteps (text and title)');
  has(S.heartbeat([{ day: '2026-11-02', items: [evil], failed: false }]), 'heartbeat (an item, in its title)');
  has(S.fleetSwitch({ scope: evil, mode: 'run', busy: evil }), 'fleetSwitch (scope and busy)');
  has(S.fleetSwitch({ mode: 'run', error: evil }), 'fleetSwitch (error)');
});

test('props, goalSteps and heartbeat render their fixtures', () => {
  assert.equal(S.props([['ID', '<code>k</code>', 'What Copy ID copies'], ['Status <x>', 'ok']]), '<dl class="props"><dt title="What Copy ID copies" tabindex="0">ID</dt><dd><code>k</code></dd><dt>Status &lt;x&gt;</dt><dd>ok</dd></dl>');
  const words = (html) => [...html.matchAll(/<li class="([^"]*)"[^>]*>([^<]+)/g)].map((m) => `${m[1] || '-'}:${m[2]}`);
  assert.deepEqual(words(S.goalSteps({ step: 0 })), ['now:Defining', '-:Planning', '-:Approval', '-:Built', '-:Met']);
  assert.deepEqual(words(S.goalSteps({ step: 2 })), ['done:Defined', 'done:Planned', 'now:Waiting on you', '-:Built', '-:Met']);
  const built = S.goalSteps({ step: 3, built: { frac: 0.4, text: '4 of 10 points' }, met: { frac: 0.25, text: '1 now → 4', title: 'Users: 1 now' } });
  assert.deepEqual(words(built), ['done:Defined', 'done:Planned', 'done:Approved', 'now:Building', 'part:Met']);
  assert.match(built, /<li class="now" style="--fill:40%" title="4 of 10 points">Building<span class="step-sub">4 of 10 points<\/span><\/li>/);
  assert.match(built, /<li class="part" style="--fill:25%" title="Users: 1 now">Met<span class="step-sub">1 now → 4<\/span>/);
  assert.deepEqual(words(S.goalSteps({ step: 4, built: { frac: 1, text: 'done' }, met: null })), ['done:Defined', 'done:Planned', 'done:Approved', 'done:Built', 'now:Met?']);
  assert.match(S.goalSteps({ step: 4, built: { frac: 1, text: 'done' } }), /<li class="done" title="done">Built<span class="step-sub">done<\/span>/, 'a done step is not refilled');
  assert.deepEqual(words(S.goalSteps({ step: 5 })), ['done:Defined', 'done:Planned', 'done:Approved', 'done:Built', 'done:Met']);
  // upkeep_days: 14 days, oldest first, today last
  const days = Array.from({ length: 14 }, (_, i) => ({ day: `2026-11-${String(2 + i).padStart(2, '0')}`, items: [], failed: false }));
  days[3].items = ['chore merged'];
  days[9].items = ['chore merged', 'kit sync', 'retro', 'recurring check ran', 'chore merged'];
  days[11] = { ...days[11], items: ['recurring check failed: hub down'], failed: true };
  const hb = S.heartbeat(days);
  const cells = [...hb.matchAll(/<i class="([^"]*)" title="([^"]*)"><\/i>/g)];
  assert.equal(cells.length, 14);
  assert.equal(cells[0][1], '', 'a quiet day is empty');
  assert.match(cells[0][2], /: quiet$/);
  assert.equal(cells[3][1], 'l1');
  assert.equal(cells[9][1], 'l4', 'shade caps at 4');
  assert.match(cells[9][2], /chore merged, kit sync, retro, recurring check ran, chore merged$/, 'the hover lists the day');
  assert.equal(cells[11][1], 'bad', 'a failed day is red');
  assert.match(cells[13][2], /\(today\): quiet$/, 'today last');
  assert.match(hb, /<div class="hb-labels"><span>Nov 2<\/span><span>today<\/span><\/div>$/, 'the first day as the date it names, in any locale');
  assert.match(hb, /aria-label="Upkeep, the last 14 days"/);
});

// hub.html's STATES as it was before it moved into the block (kit main ad139e1), so a word or tone lost in the move fails
const HUB_STATES_BEFORE = {
  building: { label: 'Building', tone: 'green', rank: 3 },
  moving: { label: 'Moving', tone: 'blue', rank: 3 },
  blocked: { label: 'Fully blocked', tone: 'red', rank: 0 },
  waiting: { label: 'Waiting on you', tone: 'amber', rank: 1 },
  stalled: { label: 'Stalled', tone: 'red', rank: 0 },
  idle: { label: 'Idle', tone: '', rank: 4 },
  parked: { label: 'Parked', tone: '', rank: 4 },
  gone: { label: 'Not answering', tone: 'red', rank: 0 },
  starting: { label: 'Starting', tone: '', rank: 5 },
  unknown: { label: 'Running', tone: 'blue', rank: 3 },
};
test('statusPill: every pulse state as the hub draws it, and the hub draws from the block', () => {
  const hubStates = Object.keys(HUB_STATES_BEFORE);
  assert.deepEqual(JSON.parse(JSON.stringify(S.PULSE_STATES)), HUB_STATES_BEFORE, "the hub's table, moved unchanged");
  // the hub's card: el('span', `pill ${S.tone}`, S.label) with S = STATES[state], and STATES is the block's table
  const hubRest = HUB_SRC;
  assert.match(hubRest, /^const STATES = PULSE_STATES;$/m);
  assert.match(hubRest, /el\('span', `pill \$\{S\.tone\}`, S\.label\)/);
  for (const st of hubStates) {
    const { label, tone } = HUB_STATES_BEFORE[st];
    assert.equal(S.statusPill(st), `<span class="pill${tone ? ` ${tone}` : ''}">${label}</span>`, st);
  }
  assert.equal(S.statusPill('blocked'), '<span class="pill red">Fully blocked</span>');
  assert.equal(S.statusPill('nonsense'), S.statusPill('unknown'));
  assert.equal(S.statusPill('toString'), S.statusPill('unknown'), 'an inherited name is unknown');
});

test('fleetSwitch: each mode, mixed, the confirm, busy and error; its binder calls each callback', () => {
  const pressed = (html) => [...html.matchAll(/data-fleet="(\w+)"[^>]*aria-pressed="true"/g)].map((m) => m[1]);
  assert.deepEqual(pressed(S.fleetSwitch({ mode: 'drain' })), ['drain']);
  assert.match(S.fleetSwitch({ scope: 'project', mode: 'run' }), /<span class="dot green"><\/span>Fleet<\/span>/);
  assert.match(S.fleetSwitch({ scope: 'row', mode: 'park' }), /<span class="dot "><\/span><\/span>/, 'a row has no label');
  const mixed = S.fleetSwitch({ scope: 'machine', mode: 'mixed', counts: { running: 3, draining: 1, parked: 2 } });
  assert.deepEqual(pressed(mixed), []);
  assert.match(mixed, /Mixed: 3 running, 1 draining, 2 parked/);
  assert.match(S.fleetSwitch({ scope: 'machine', mode: 'run' }), />Every fleet</);
  assert.match(S.fleetSwitch({ scope: 'project', mode: 'run', confirming: true }), /data-fleet="park" class="confirm" data-confirm="1"[^>]*>Confirm park</);
  assert.match(S.fleetSwitch({ scope: 'machine', mode: 'mixed', confirming: true, counts: { running: 3, draining: 1, parked: 1 } }), />Park 4 projects\?</, 'the projects it would park');
  assert.match(S.fleetSwitch({ scope: 'machine', mode: 'mixed', confirming: true, counts: { running: 1, parked: 4 } }), />Park 1 project\?</);
  const busy = S.fleetSwitch({ mode: 'run', busy: 'parking…', error: 'refused <b>' });
  assert.equal((busy.match(/ disabled>/g) || []).length, 3);
  assert.match(busy, /<span class="msg">parking…<\/span><span class="err">refused &lt;b&gt;<\/span>/);
  // bound
  const root = rootWith(S.fleetSwitch({ mode: 'run' }));
  const calls = [];
  S.bindFleetSwitch(root, { onPress: (m) => calls.push(`press:${m}`), onConfirm: (m) => calls.push(`confirm:${m}`), onCancel: () => calls.push('cancel') });
  const btn = (m) => root.querySelectorAll('[data-fleet]').find((b) => b.dataset.fleet === m);
  fire(root, 'click', btn('park'));
  fire(root, 'click', btn('drain'));
  fire(root, 'keydown', btn('run'), { key: 'Escape' });
  assert.deepEqual(calls, ['press:park', 'press:drain'], 'Escape cancels only a confirming switch');
  root.innerHTML = S.fleetSwitch({ mode: 'run', confirming: true });
  fire(root, 'click', btn('park'));
  fire(root, 'keydown', btn('run'), { key: 'Escape' });
  assert.deepEqual(calls, ['press:park', 'press:drain', 'confirm:park', 'cancel']);
  root.innerHTML = S.fleetSwitch({ mode: 'run', busy: 'working' });
  fire(root, 'click', btn('drain'));
  assert.equal(calls.length, 4, 'a busy switch takes no press');
});

test('pages and Threads tabs register once; a throwing tab shows its error', async () => {
  const T = await load();
  T.registerPage({ id: 'board', title: 'Board', group: 'project', icon: 'kanban', count: () => 3, render: () => {} });
  assert.throws(() => T.registerPage({ id: 'board', title: 'Again' }), /registered already/);
  assert.throws(() => T.registerPage({ id: 'a/b', title: 'X' }), /lower-case/);
  assert.deepEqual(JSON.parse(JSON.stringify(T.shellPages().map((p) => p.id))), ['board']);
  T.threadsTabs.register({ id: 'inbox', label: 'Inbox', count: () => 2, render: (el) => { el.innerHTML = 'cards'; } });
  T.threadsTabs.register({ id: 'bad', label: 'Bad', count: () => { throw new Error('x'); }, render: () => { throw new Error('it broke'); } });
  T.threadsTabs.register({ id: 'supervisor', label: 'Supervisor', disabled: true });
  assert.throws(() => T.threadsTabs.register({ id: 'inbox', label: 'Again' }), /registered already/);
  assert.deepEqual(JSON.parse(JSON.stringify(T.threadsTabs.list())), [{ id: 'inbox', label: 'Inbox', count: 2, disabled: false }, { id: 'bad', label: 'Bad', count: null, disabled: false }, { id: 'supervisor', label: 'Supervisor', count: null, disabled: true }]);
  const el = { innerHTML: '' };
  assert.equal(T.threadsTabs.render('bad', el), false);
  assert.match(el.innerHTML, /Bad could not draw: it broke/);
  assert.equal(T.threadsTabs.render('inbox', el), true);
  assert.equal(el.innerHTML, 'cards', 'the next tab still draws');
});

test("the router's table: page ids and link kinds disjoint, and every legacy head goes to its home page", () => {
  assert.deepEqual([...R.pages].sort(), ['awareness', 'board', 'efficiency', 'goals', 'governance', 'jobs', 'library', 'loop', 'overview', 'progress', 'retros', 'sensors', 'settings', 'trust']);
  for (const p of R.pages) { assert.doesNotMatch(p, /[/?]/); assert.ok(!Object.hasOwn(R.links, p), `${p} is not a link kind`); }
  // every link kind today's route() reads
  assert.ok(SRC.includes('function route()') && SRC.includes('function hideDrawer()'), "the dashboard's sources hold route() and hideDrawer() (data's port)");
  const route = SRC.slice(SRC.indexOf('function route()'), SRC.indexOf('function hideDrawer()'));
  const kinds = new Set([...route.matchAll(/startsWith\('([a-z-]+)[/?]?'\)/g)].map((m) => m[1]));
  for (const m of route.match(/const PEEKS = \{([^}]*)\}/)[1].matchAll(/([a-z]+):/g)) kinds.add(m[1]);
  assert.ok(kinds.size >= 20, 'the kinds were read');
  for (const k of kinds) assert.ok(Object.hasOwn(R.links, k), `the table has ${k}`);
  const HOME = { ticket: 'board', feature: 'board', story: 'board', release: 'board', wave: 'board', milestone: 'board', planner: 'board', thread: 'board', goal: 'goals', q: 'overview', act: 'loop', decision: 'loop', lesson: 'loop', problem: 'loop', signal: 'loop', learning: 'loop', observation: 'loop', sensor: 'sensors', retro: 'retros', artifact: 'library', preview: 'library', review: 'library', 'review-preview': 'library', talk: 'overview' };
  // what p may open (@2): every peek kind the dashboard draws (TYPE_META's) and the two viewers, all link kinds
  const at = SRC.search(/const TYPE_META\b[^=\n]*= \{/);
  assert.ok(at >= 0, "the dashboard's sources hold TYPE_META (peeks' port)");
  const meta = SRC.slice(at, SRC.indexOf('\n};', at));
  const metaKinds = [...meta.matchAll(/(?:^|[{,\s])([a-z]+): \[/g)].map((m) => m[1]);
  assert.ok(metaKinds.length >= 20, 'the peek kinds were read');
  assert.deepEqual([...(R.peeks || [])].sort(), [...metaKinds, 'artifact', 'preview'].sort(), 'SHELL_ROUTES.peeks: every TYPE_META kind and the two viewers');
  for (const k of R.peeks) assert.ok(Object.hasOwn(R.links, k), `a peek kind ${k} has a home`);
  for (const k of ['talk', 'review', 'review-preview']) assert.ok(!R.peeks.includes(k), `${k} stays a link head`);
  for (const [k, home] of Object.entries(HOME)) {
    const p = S.parseHead(k === 'review-preview' ? '#review-preview?path=x' : `#${k}/some-id`, R);
    if (R.peeks.includes(k)) { assert.equal(p.page, home, `${k} opens over ${home}`); assert.equal(p.legacy, true); continue; }
    assert.equal(p.kind, k);
    assert.equal(p.home, home, `${k} opens over ${home}`);
  }
  assert.equal(S.parseHead('#talk/t-1?u=u-1', R).link, 'talk/t-1?u=u-1', 'the rest of a link is kept');
  assert.equal(S.parseHead('#file?path=docs%2Fdevteam%2Fgovernance%2Fquality.md&title=Quality', R).page, 'governance');
  assert.equal(S.parseHead('#file?path=docs%2Fdevteam%2Fprocess%2Fworker.md', R).page, 'governance');
  assert.equal(S.parseHead('#file?path=docs%2Fdevteam%2Fproject%2Fstrategy.md&title=Strategy', R).page, 'governance');
  assert.equal(S.parseHead('#file?path=docs%2Fdevteam%2Fproject%2Fdesigns%2Fx.md', R).page, 'library');
  assert.equal(S.parseHead('#nothing-here/x', R).home, 'overview', 'anything else over overview');
  assert.equal(S.parseHead('#nothing-here/x', R).link, 'nothing-here/x', 'a head of no kind stays a link head');
  // today's section anchors are page heads, and the two that move redirect
  for (const s of ['overview', 'goals', 'progress', 'board', 'library', 'loop', 'trust', 'retros']) assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead(`#${s}`, R))), { page: s, state: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#monitoring', R))), { page: 'sensors', state: {}, redirected: true });
  // kit-93: Health folds into Sensors (redirected), Governance is a page, and a class link opens over Trust
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#health', R))), { page: 'sensors', state: { st: 'fleet' }, redirected: true });
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#governance', R))), { page: 'governance', state: {} });
  assert.equal(R.links.class, 'trust');
  // the Inbox is the Threads panel's first tab (kit-100): no page, the old heads redirect to it, and `?th=inbox` is a plain state
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.ok(!R.pages.includes('inbox'));
  assert.deepEqual(plain(S.parseHead('#inbox', R)), { page: 'overview', state: { th: 'inbox' }, redirected: true });
  assert.deepEqual(plain(S.parseHead('#questions', R)), { page: 'overview', state: { th: 'inbox' }, redirected: true });
  for (const p of R.pages) assert.deepEqual(plain(S.parseHead(`#${p}?th=inbox`, R)), { page: p, state: { th: 'inbox' } });
  assert.ok(!Object.keys(R.redirects).some((k) => k.endsWith('?th=inbox')));
  // the old Loop tab subjects are permanent redirects
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#loop/orient', R))), { page: 'loop', state: { lt: 'orient' }, redirected: true });
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#loop/observe', R))), { page: 'loop', state: {}, redirected: true });
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('', R))), { page: 'overview', state: {} });
});

test('parseHead and headFor round-trip every page head and link head', () => {
  const heads = ['#overview', '#overview?th=open&t=t-1', '#board?goal=g-1&feat=f&repo=kit&att=1&th=resolved', '#progress?goal=g-1&narrow=features&show=all', '#library?kind=Mock&goal=g-2', '#goals?gt=met', '#goals?gt=letgo', '#sensors?st=fleet', '#loop?lt=orient&kind=lesson&orient=1', '#trust', '#retros', '#settings', '#overview?th=inbox', '#board?goal=g-1&th=inbox'];
  for (const p of R.pages) heads.push(`#${p}`, `#${p}?th=open&t=t-20261115-1`);
  // the link heads that stay link heads (@2): talk/ (with a turn too), review/ and review-preview
  for (const k of Object.keys(R.links).filter((k) => !(R.peeks || []).includes(k))) heads.push(k === 'review-preview' ? '#review-preview?path=a.html&ref=ticket%2Fx' : `#${k}/an-id`);
  heads.push('#talk/t-1', '#talk/t-1?u=u-1');
  for (const h of heads) assert.equal(S.headFor(S.parseHead(h, R)), h, h);
  // parseHead keeps only the page's own keys; headFor writes them in STATE_KEYS order, whatever order it is given
  assert.deepEqual(JSON.parse(JSON.stringify(S.parseHead('#goals?goal=g&gt=met&lt=act', R))), { page: 'goals', state: { gt: 'met' } });
  assert.equal(S.headFor({ page: 'board', state: { t: 'x', att: '1', goal: 'g' } }), '#board?goal=g&att=1&t=x');
  // only the page's own keys survive, in canonical order
  assert.equal(S.headFor(S.parseHead('#board?t=x&repo=r&gt=met&goal=g', R)), '#board?goal=g&repo=r&t=x');
  assert.equal(S.headFor({ page: 'board', state: { goal: 'a b&c' } }), '#board?goal=a+b%26c');
  assert.equal(S.parseHead(S.headFor({ page: 'board', state: { goal: 'a b&c' } }), R).state.goal, 'a b&c');
});

// ---- dashboard-shell@2 (§6-§8): p, i and u ----
const plain2 = (o) => JSON.parse(JSON.stringify(o));
const pq = (v) => new URLSearchParams({ p: v }).toString();
const HEX40 = 'a'.repeat(40), HEX64 = 'b'.repeat(64);
// one canonical head per peek kind: a file by its path, an artifact and a preview by their own grammar
const PEEK_HEAD = (k) => (k === 'file' ? 'file?path=docs%2Fx.md&ref=main' : k === 'artifact' ? 'artifact/main/the-mock' : k === 'preview' ? 'preview/bold-otter' : `${k}/an-id`);
const PEEK_HOME = (k) => (k === 'file' ? 'library' : R.links[k]);

test('@2 round-trip: p of every peek kind on every page, t with u, th=inbox with i, the viewers, a turn in talk/, a pinned head with empty values', () => {
  const heads = [];
  for (const page of R.pages) {
    for (const k of R.peeks || ['ticket']) heads.push(`#${page}?${pq(PEEK_HEAD(k))}`);
    heads.push(`#${page}?th=open&t=t-1&u=u-1`, `#${page}?th=inbox&i=q-1`, `#${page}?th=inbox&i=k-1`);
  }
  heads.push('#board?goal=g-1&th=open&t=t-1&u=u-1&p=ticket%2Fkit-1', '#overview?th=open&t=t-1&u=u-1', '#overview?th=inbox&i=q-1', '#goals?th=inbox&i=k-1&p=lesson%2Fk-1');
  heads.push(`#library?${pq('artifact/main/the-mock')}`, `#library?${pq('artifact/wt/kit-267-shell-url-contract/the-mock')}`, `#progress?goal=g-1&${pq(`artifact/tree/${HEX40}/the-mock?path=b.html`)}`, `#library?${pq(`artifact/tree/${HEX64}/the-mock?path=docs%2Fb.html`)}`, `#library?${pq('preview/bold-otter?route=%2Fsettings%3Ftab%3D2')}`);
  heads.push('#talk/t-1?u=u-1', '#board?goal=&feat=&repo=&att=&th=&p=ticket%2Fkit-1');
  // the pinned head's parse first, so its own line is what a dropped empty value fails on
  assert.deepEqual(plain2(S.parseHead('#board?goal=&feat=&repo=&att=&th=&p=ticket%2Fkit-1', R)), { page: 'board', state: { goal: '', feat: '', repo: '', att: '', th: '', p: 'ticket/kit-1' } }, 'each empty key kept, present with the value ""');
  for (const h of heads) assert.equal(S.headFor(S.parseHead(h, R)), h, h);
});

// until the router adopts p (kit-268), it routes a legacy head exactly as @1 routed its link head: every test of a
// parse result's link outside the block reads legacy too, so a legacy head is never taken for a page head
test('@2 the router reads legacy wherever it reads link', () => {
  const lines = without(SRC, 'devteam-shell-js').split('\n').filter((l) => /\.link [!=]== undefined/.test(l));
  assert.ok(lines.length >= 15, `the router's link tests were read: ${lines.length}`);
  for (const l of lines) assert.match(l, /\.legacy\b/, `reads legacy: ${l.trim()}`);
});

test('@2 legacy heads: every peek kind and the two viewers open over their home with themselves as p', () => {
  for (const k of R.peeks || ['ticket']) {
    const h = `#${PEEK_HEAD(k)}`;
    assert.deepEqual(plain2(S.parseHead(h, R)), { page: PEEK_HOME(k), state: { p: PEEK_HEAD(k) }, legacy: true }, h);
    assert.equal(S.headFor(S.parseHead(h, R)), `#${PEEK_HOME(k)}?${pq(PEEK_HEAD(k))}`, `${h} canonical`);
  }
  for (const v of ['artifact/main/the-mock', 'artifact/wt/kit-1/the-mock', 'preview/bold-otter']) assert.deepEqual(plain2(S.parseHead(`#${v}`, R)), { page: 'library', state: { p: v }, legacy: true }, v);
  assert.deepEqual(plain2(S.parseHead('#file?path=docs%2Fdevteam%2Fgovernance%2Fquality.md&title=Quality', R)), { page: 'governance', state: { p: 'file?path=docs%2Fdevteam%2Fgovernance%2Fquality.md&title=Quality' }, legacy: true }, 'a file by its path');
});

test('@2 p of an unknown kind, or an artifact with a bad slug, is dropped', () => {
  for (const v of ['nothing/x', 'talk/t-1', 'review/q-1', 'review-preview?path=a.html', 'ticket', 'ticket/', 'file?title=x', 'file/x', 'file/x?path=a.md', 'artifact/main/Bad_Slug', 'artifact/main/', 'artifact/tree/' + HEX40 + '/-x', 'preview/a/b']) {
    assert.deepEqual(plain2(S.parseHead(`#board?goal=g-1&${pq(v)}`, R)), { page: 'board', state: { goal: 'g-1' } }, v);
  }
  assert.deepEqual(plain2(S.parseHead('#artifact/main/Bad_Slug', R)), { page: 'library', state: {}, legacy: true }, 'a legacy viewer head naming no artifact: its home, no p');
  // a file is file?<query> with a path (§6), never file/<anything>
  assert.deepEqual(plain2(S.parseHead('#file/x', R)), { page: 'library', state: {}, legacy: true }, 'a legacy file/ head names no file: its home, no p');
});

test('@2 i is kept only with th=inbox', () => {
  assert.deepEqual(plain2(S.parseHead('#board?th=open&i=q-1', R)), { page: 'board', state: { th: 'open' } });
  assert.deepEqual(plain2(S.parseHead('#board?i=q-1', R)), { page: 'board', state: {} });
  assert.deepEqual(plain2(S.parseHead('#board?th=inbox&i=q-1', R)), { page: 'board', state: { th: 'inbox', i: 'q-1' } });
});

test("@2 an artifact's version: tree/<id> only with 40 or 64 lower-case hex, anything else but main and wt/<w> is main", () => {
  const got = (v) => S.parseHead(`#library?${pq(v)}`, R).state.p;
  for (const at of [`tree/${'a'.repeat(39)}`, `tree/${'A'.repeat(40)}`, 'tree/', 'tree', `tree/${HEX40}x`, 'origin/main', 'wt', 'wt/.x', 'wt/a/b', 'draft']) {
    assert.equal(got(`artifact/${at}/the-mock?path=b.html`), 'artifact/main/the-mock?path=b.html', at);
  }
  assert.equal(got(`artifact/tree/${HEX40}/the-mock`), `artifact/tree/${HEX40}/the-mock`);
  assert.equal(got('artifact/wt/kit-1.x_y/the-mock'), 'artifact/wt/kit-1.x_y/the-mock');
  assert.equal(S.headFor(S.parseHead(`#library?${pq(`artifact/tree/${'a'.repeat(39)}/the-mock`)}`, R)), `#library?${pq('artifact/main/the-mock')}`, 'headFor writes the normalised head');
});

test("@2 p's own query is read with URLSearchParams: a preview's route holding ? & = # round-trips", () => {
  const h = `#library?p=${encodeURIComponent(`preview/app?route=${encodeURIComponent('/a?b=1&c=2#d')}`)}`;
  const p = S.parseHead(h, R).state.p;
  assert.equal(new URLSearchParams(String(p).slice(String(p).indexOf('?') + 1)).get('route'), '/a?b=1&c=2#d');
  assert.equal(S.headFor(S.parseHead(h, R)), h);
  assert.equal(S.parseHead(`#library?${pq('preview/app?route=%2F')}`, R).state.p, 'preview/app', "the route '/' is the default, left out");
});

test("@2 an artifact's page: kept when the server can serve it, else dropped with the version kept", () => {
  const v = (page) => `artifact/tree/${HEX40}/the-mock?${new URLSearchParams({ path: page })}`;
  assert.equal(S.parseHead(`#library?${pq(v('docs/b.html'))}`, R).state.p, `artifact/tree/${HEX40}/the-mock?path=docs%2Fb.html`, 'docs/b.html is kept');
  for (const bad of ['..', '.x/y.html', 'a//b', 'b c.html', '%2e%2e/x.html', 'a\\b', '/abs.html', 'a/', 'index.html']) {
    const h = `#library?${pq(v(bad))}`;
    assert.equal(S.parseHead(h, R).state.p, `artifact/tree/${HEX40}/the-mock`, `${bad}: dropped, the version kept`);
    assert.equal(S.headFor(S.parseHead(h, R)), `#library?${pq(`artifact/tree/${HEX40}/the-mock`)}`, `${bad}: the normalised head`);
  }
});

test('@2 stampFor on a p head: its own page, cold or warm', () => {
  const h = '#progress?goal=g-1&p=ticket%2Fkit-1';
  const cold = S.stampFor({ hash: h, state: null }, null, true, R);
  assert.deepEqual(plain2(cold), { page: '#progress?goal=g-1', depth: 1, openedHere: false }, 'cold');
  assert.deepEqual(plain2(S.closeTarget(cold)), { replace: '#progress?goal=g-1' });
  assert.deepEqual(plain2(S.stampFor({ hash: h, state: null }, { page: '#board', depth: 0, openedHere: true }, false, R)), { page: '#progress?goal=g-1', depth: 1, openedHere: false }, 'warm over another page');
  assert.deepEqual(plain2(S.stampFor({ hash: h, state: null }, { page: '#progress?goal=g-1', depth: 0, openedHere: true }, false, R)), { page: '#progress?goal=g-1', depth: 1, openedHere: true }, 'warm over its own page');
  assert.deepEqual(plain2(S.stampFor({ hash: h, state: null }, { page: '#progress?goal=g-1', depth: 1, openedHere: false }, false, R)), { page: '#progress?goal=g-1', depth: 2, openedHere: false }, 'from a peek over its own page');
});

test('@2 rememberedFilters: a fresh head with p says what it shows', () => {
  const stored = { goal: 'g-1' };
  const keys = (h) => Object.keys(S.parseHead(h, R).state);
  assert.equal(S.rememberedFilters('board', keys('#board?p=ticket%2Fkit-1'), true, stored), null, 'a head with p');
  assert.equal(S.rememberedFilters('board', keys('#board?th=open&p=ticket%2Fkit-1'), true, stored), null, 'with p and th');
  assert.deepEqual(plain2(S.rememberedFilters('board', keys('#board?th=open'), true, stored)), { goal: 'g-1' }, 'without p the store fills in');
});

test('@2 rememberedFilters: an empty value is a value', () => {
  const stored = { goal: 'g-1', kind: 'Mock' };
  const keys = (h) => Object.keys(S.parseHead(h, R).state);
  for (const [page, h] of [['board', '#board?goal='], ['board', '#board?att='], ['progress', '#progress?goal='], ['library', '#library?kind=']]) assert.equal(S.rememberedFilters(page, keys(h), true, stored), null, h);
});

test('stampFor, closeTarget and rememberedFilters', async () => {
  const plain = (o) => JSON.parse(JSON.stringify(o));
  // a page entry, then a peek from it, then a peek from that peek
  const pg = S.stampFor({ hash: '#progress?goal=g-1', state: null }, null, false, R);
  assert.deepEqual(plain(pg), { page: '#progress?goal=g-1', depth: 0, openedHere: true });
  const p1 = S.stampFor({ hash: '#ticket/kit-1', state: null }, pg, false, R);
  assert.deepEqual(plain(p1), { page: '#progress?goal=g-1', depth: 1, openedHere: true }, 'a peek from a page: depth 1, over that page');
  const p2 = S.stampFor({ hash: '#goal/g-1', state: null }, p1, false, R);
  assert.deepEqual(plain(p2), { page: '#progress?goal=g-1', depth: 2, openedHere: true }, 'a peek from a peek: depth + 1, the same page');
  // a peek opened from a cold-loaded peek: the entry below wasn't pushed in this visit, so it closes in place
  const cold1 = S.stampFor({ hash: '#ticket/kit-1', state: null }, null, true, R);
  const cold2 = S.stampFor({ hash: '#goal/g-1', state: null }, cold1, false, R);
  assert.deepEqual(plain(cold2), { page: '#board', depth: 2, openedHere: false });
  assert.deepEqual(plain(S.closeTarget(cold2)), { replace: '#board' });
  assert.deepEqual(plain(S.stampFor({ hash: '#file?path=docs%2Fdevteam%2Fgovernance%2Fquality.md', state: null }, null, true, R)), { page: '#governance', depth: 1, openedHere: false }, 'a cold file link by its path, over Governance');
  assert.deepEqual(plain(S.stampFor({ hash: '#file?path=docs%2Fx.md', state: null }, null, true, R)), { page: '#library', depth: 1, openedHere: false });
  // Threads changing under an open peek: the same entry, its page head updated
  assert.deepEqual(plain(S.withPage(p1, '#progress?goal=g-1&th=open')), { page: '#progress?goal=g-1&th=open', depth: 1, openedHere: true });
  // a cold load
  assert.deepEqual(plain(S.stampFor({ hash: '#ticket/kit-1', state: null }, null, true, R)), { page: '#board', depth: 1, openedHere: false }, "a cold link opens over its kind's home page");
  assert.deepEqual(plain(S.stampFor({ hash: '#lesson/k-1', state: null }, pg, true, R)), { page: '#loop', depth: 1, openedHere: false });
  assert.deepEqual(plain(S.stampFor({ hash: '#board', state: null }, null, true, R)), { page: '#board', depth: 0, openedHere: false });
  // a reload or Back keeps the entry's own stamp
  const kept = { page: '#trust', depth: 1, openedHere: true };
  assert.equal(S.stampFor({ hash: '#ticket/kit-1', state: kept }, pg, true, R), kept);
  // closing
  assert.deepEqual(plain(S.closeTarget(p2)), { go: -2 });
  assert.deepEqual(plain(S.closeTarget(p1)), { go: -1 });
  assert.deepEqual(plain(S.closeTarget({ page: '#board', depth: 1, openedHere: false })), { replace: '#board' });
  assert.deepEqual(plain(S.closeTarget({ page: '#progress?goal=g', depth: 3, openedHere: false })), { replace: '#progress?goal=g' }, 'never Overview by default');
  // remembered filters
  const stored = { goal: 'g-1', feat: 'f-1', repo: 'kit', att: '1', kind: 'Mock' };
  assert.deepEqual(plain(S.rememberedFilters('board', [], true, stored)), { goal: 'g-1', feat: 'f-1', repo: 'kit', att: '1' });
  assert.deepEqual(plain(S.rememberedFilters('progress', [], true, stored)), { goal: 'g-1' }, 'only its own keys');
  assert.deepEqual(plain(S.rememberedFilters('library', ['th'], true, stored)), { goal: 'g-1', kind: 'Mock' }, 'th is not a filter');
  assert.equal(S.rememberedFilters('board', [], false, stored), null, 'Back or Forward shows its own keys');
  assert.equal(S.rememberedFilters('board', ['repo'], true, stored), null, 'a fresh entry with a filter key keeps it');
  assert.equal(S.rememberedFilters('loop', [], true, stored), null, "Self Improvement's filters are never remembered");
  assert.equal(S.rememberedFilters('overview', [], true, stored), null);
  assert.equal(S.rememberedFilters('board', [], true, {}), null);
  // the store: through localStorage, and a throwing one gives null and takes nothing
  const mem = {};
  const L = await load({ localStorage: { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); } } });
  L.saveFilters('board', { goal: 'g-2', repo: 'kit', th: 'open' });
  L.saveFilters('loop', { kind: 'lesson' });
  assert.deepEqual(JSON.parse(mem['devteam.board.filters']), { goal: 'g-2', repo: 'kit' }, "one flat object, only a page's own keys");
  assert.deepEqual(plain(L.rememberedFilters('progress', [], true)), { goal: 'g-2' }, 'the goal is shared');
  L.saveFilters('library', { kind: 'Mock', goal: 'g-2' });
  L.saveFilters('board', { goal: 'g-2' });
  assert.deepEqual(JSON.parse(mem['devteam.board.filters']), { goal: 'g-2', kind: 'Mock' }, "a cleared filter is cleared, another page's kept");
  assert.equal(L.rememberedFilters('board', [], true).repo, undefined, 'and stays cleared');
  L.saveFilters('progress', {});
  assert.deepEqual(JSON.parse(mem['devteam.board.filters']), { kind: 'Mock' }, 'clearing the goal on one page clears it for all three');
  const X = await load({ localStorage: { getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); } } });
  assert.equal(X.rememberedFilters('board', [], true), null);
  assert.doesNotThrow(() => X.saveFilters('board', { goal: 'g' }));
  assert.equal((await load()).rememberedFilters('board', [], true), null, 'no localStorage at all');
});

// ---- the measure check, proven on the fixture page (headless Chrome) ----
const FIXTURE = fs.readFileSync(path.join(here, 'fixtures', 'dashboard-shell.html'), 'utf8');
const filled = () => FIXTURE
  .replace('/* slot: devteam-ui tokens */', () => block(LAYOUT_CSS, 'devteam-ui tokens'))
  .replace('/* slot: devteam-layout */', () => LAYOUT)
  .replace('/* slot: devteam-shell-js */', () => JS_RUN());
// one way to break each check, run in the loaded fixture
const BREAK = {
  prose: "document.querySelector('#right p').style.maxWidth = 'none'; document.querySelector('#pair').style.gridTemplateColumns = '1fr'; document.querySelectorAll('#pair > *').forEach((c) => { c.style.gridColumn = 'span 1'; });",
  overflow: "document.querySelector('#small p').style.width = '2000px';",
  uneven: "document.querySelector('#left').style.alignSelf = 'start';",
  'head-end': "document.querySelector('#left .card-head .end').style.marginRight = '30px';",
  'page-top': "document.querySelector('#view').style.paddingTop = '60px';",
  'head-h': "document.querySelector('#small .card-head').style.height = '36px';",
  'header-pad': "document.querySelector('.pagebar').style.paddingLeft = '24px';",
  'tab-motion': "const s = document.createElement('style'); s.textContent = '.shell .tabbar [role=tab]::after { transition: visibility .2s; }'; document.head.append(s);",
};

const EXTRA = [
  ['overflow', "document.querySelector('#small p').style.marginLeft = '-60px';"],
  ['header-pad', "document.querySelector('.pagebar').style.paddingRight = '24px';"],
  ['tab-motion', "document.querySelector('.tabbar.sub [role=tab]').style.transition = 'color 1s'"],
];
// a page's own prose and ignore add to the defaults
test('measure options: a page adds to prose and ignore', async () => {
  let got = null;
  await measure({ ev: async (x) => { got = x; return []; } }, { prose: '.turn .tx', ignore: '.mine' });
  const o = JSON.parse(got.slice(got.lastIndexOf(')(') + 2, -1));
  assert.match(o.prose, /^p, \.ctx, .*, \.turn \.tx$/);
  assert.match(o.ignore, /\.no-shell, \.mine$/);
});

test('the measure: every check passes on the fixture at three sizes and fails on a broken copy', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  assert.deepEqual(Object.keys(BREAK).sort(), [...CHECKS].sort(), 'a break for every check');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-shell-'));
  const later = cleanup(t);
  later(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'dashboard-shell.html');
  fs.writeFileSync(file, filled());
  const url = `file://${file}`;
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const res = await measureAt(p, url, { ready: 'window.__ready' });
  assert.deepEqual(Object.keys(res), SIZES.map(([w, h]) => `${w}x${h}`));
  for (const [size, fails] of Object.entries(res)) assert.deepEqual(fails, [], `the fixture at ${size}`);
  // A4: the sub bar is 30px tall and its panel is labelled by its selected tab
  assert.equal(await p.ev("(() => { const t = document.querySelector('.tabbar.sub [role=\"tab\"]'); return t && getComputedStyle(t).height; })()"), '30px', 'the fixture has a .tabbar.sub whose first tab is 30px tall');
  assert.equal(await p.ev("(() => { const e = document.querySelector('[role=\"tabpanel\"]#fx-list'); return e && e.getAttribute('aria-labelledby'); })()"), 'tab-fx-list-open');
  // the c6 pair side by side at 720
  await p.send('Emulation.setDeviceMetricsOverride', { width: 720, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.navigate', { url });
  const soon = async (expr) => { for (let i = 0; i < 300; i++) { if (await p.ev(expr).catch(() => false)) return; await new Promise((r) => setTimeout(r, 50)); } assert.fail(expr); };
  await soon('window.__ready === true');
  const pair = await p.ev("(() => { const a = document.querySelector('#left').getBoundingClientRect(), b = document.querySelector('#right').getBoundingClientRect(); return { top: Math.abs(a.top - b.top), side: a.right <= b.left, h: Math.abs(a.height - b.height) }; })()");
  assert.ok(pair.top < 1 && pair.side, `the c6 pair is side by side at 720: ${JSON.stringify(pair)}`);
  // the lower boundary: nothing in the block styles a .no-shell region, while the same names outside it are styled
  const fenced = await p.ev("(() => { const cs = (s, pe) => getComputedStyle(document.querySelector(s), pe); return { card: cs('#fenced .card').borderTopStyle, head: cs('#fenced .card-head').height, headLine: cs('#fenced .card-head').borderBottomStyle, pill: cs('#fenced .pill').display, dot: cs('#fenced .pill', '::before').content, seg: cs('#fenced .seg').display, shellHead: cs('#small .card-head').height, shellPill: cs('#peek .pill').display }; })()");
  assert.deepEqual(fenced, { card: 'none', head: fenced.head, headLine: 'none', pill: 'inline', dot: 'none', seg: 'inline', shellHead: '41px', shellPill: 'inline-flex' });
  assert.notEqual(fenced.head, '41px');
  // reduced motion: the red dot stops pulsing
  const pulse = () => p.ev("getComputedStyle(document.querySelector('#peek .dot.red.pulse')).animationName");
  assert.equal(await pulse(), 'shell-ring', 'the red dot pulses');
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await pulse(), 'none', 'and stops under reduced motion');
  assert.equal(await p.ev("getComputedStyle(document.documentElement).getPropertyValue('--dur').trim()"), '0ms');
  await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  // each check fails, by its name, on a broken copy (two for overflow and header-pad: either side)
  for (const [check, script] of [...Object.entries(BREAK), ...EXTRA]) {
    await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await p.send('Page.navigate', { url });
    await soon('window.__ready === true');
    assert.deepEqual(await measure(p), [], `clean before breaking ${check}`);
    await p.ev(`(() => { ${script} })()`);
    await p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const fails = await measure(p);
    assert.ok(fails.some((f) => f.startsWith(`${check}: `)), `${check} fails on its broken copy: ${JSON.stringify(fails)}`);
  }
});

// ---- §10 the hub frame: the two fakes, each on a loopback origin of its own (headless Chrome) ----
const FAKES = ['hub-frame-fake.html', 'dashboard-frame-fake.html'];
const FAKE_DIR = path.join(here, 'fixtures');
const serveFakes = () => new Promise((resolve, reject) => {
  const s = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://x').pathname.slice(1);
    if (!FAKES.includes(name)) { res.writeHead(404); return void res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(FAKE_DIR, name)));
  });
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => resolve(s));
});

test('the hub frame: hub-base on every load, the hub follows hub-route from its frame only, a bad base is kept by no one', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 120000 }, async (t) => {
  const later = cleanup(t);
  const hubS = await serveFakes(), dashS = await serveFakes();
  later(() => new Promise((r) => hubS.close(r)));
  later(() => new Promise((r) => dashS.close(r)));
  const hubO = `http://127.0.0.1:${hubS.address().port}`, dashO = `http://127.0.0.1:${dashS.address().port}`;
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const until = async (fn, what) => {
    let last;
    for (let i = 0; i < 200; i++) { try { last = await fn(); if (last === true) return; } catch (e) { last = e.message; } await new Promise((r) => setTimeout(r, 50)); }
    assert.fail(`${what} (last: ${JSON.stringify(last)})`);
  };
  const key = 'devteam-dev';
  const base = `${hubO}/hub-frame-fake.html#${key}/`;
  const src = `${dashO}/dashboard-frame-fake.html#board?goal=g-1`;
  // before its first hub-base the dashboard posts nothing: the hub holds that base back while the frame loads,
  // writes its head and changes its hash
  const hubUrl = `${hubO}/hub-frame-fake.html?key=${key}&src=${encodeURIComponent(src)}`;
  await p.send('Page.navigate', { url: `${hubUrl}&hold=1` });
  await until(async () => (await p.ev('window.__held')) === true && (await p.evIn(dashO, "document.getElementById('head').textContent")) === '#board?goal=g-1', 'the held frame has loaded');
  await p.evIn(dashO, "location.hash = '#goals'");
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(await p.ev("window.__log.filter((e) => e.got === 'hub-route')"), [], 'the dashboard fake posts no hub-route before its first hub-base');
  await p.ev('window.__release()');
  await until(async () => (await p.ev('location.hash')) === `#${key}/goals`, 'its head goes at once with the first');
  await p.send('Page.navigate', { url: hubUrl });
  // the bases the dashboard fake kept: true when there is one at least and each is the hub fake's (it sends one on
  // load and one after each hub-route it accepts), else the list
  const bases = async () => { const b = await p.evIn(dashO, 'JSON.stringify(window.__bases)'); const l = JSON.parse(b); return (l.length > 0 && l.every((x) => x === base)) || b; };
  await until(bases, "the dashboard fake receives the hub fake's base on load");
  await until(async () => (await p.ev('location.hash')) === `#${key}/board?goal=g-1`, 'the hub fake has the head the dashboard fake loaded at');
  // the hub's hash follows each head the dashboard is sent to (by assignment: a new entry, a hashchange)
  for (const h of ['#board?goal=g-1&p=ticket%2Fkit-1', '#progress?goal=g-1', `#library?${pq(`artifact/tree/${HEX40}/the-mock?path=b.html`)}`, '#talk/t-1?u=u-1']) {
    await p.evIn(dashO, `location.hash = ${JSON.stringify(h)}`);
    await until(async () => (await p.ev('location.hash')) === `#${key}/${h.slice(1)}`, `the hub fake's hash follows ${h}`);
  }
  // a head over 2,048 characters is sent as null: the bare key
  await p.evIn(dashO, `location.hash = '#board?goal=' + 'x'.repeat(2100)`);
  await until(async () => (await p.ev('location.hash')) === `#${key}`, 'a head sent as null shows the bare key');
  await p.evIn(dashO, "location.hash = '#goals'");
  await until(async () => (await p.ev('location.hash')) === `#${key}/goals`, 'and follows again after it');
  // the dashboard reloads itself: a new document, hub-base again
  await p.evIn(dashO, 'location.reload()');
  await until(async () => (await p.ev("window.__log.filter((e) => e.why === 'load').length")) === 2 && (await bases()) === true, 'the dashboard fake receives hub-base again after it reloads itself');
  // a hub-base the dashboard must not keep: javascript:, data:, credentials
  await until(async () => (await p.evIn(dashO, 'window.__seen')) >= 1, 'the reloaded fake has read a base');
  await new Promise((r) => setTimeout(r, 300));
  const seen = await p.evIn(dashO, 'window.__seen');
  for (const b of ['javascript:alert(1)//', 'data:text/html,x', `http://u:pw@127.0.0.1:1/x#`, `https://u@127.0.0.1:1/#`]) await p.ev(`document.getElementById('f').contentWindow.postMessage({ devteam: 'hub-base', base: ${JSON.stringify(b)} }, ${JSON.stringify(dashO)})`);
  await until(async () => (await p.evIn(dashO, 'window.__seen')) >= seen + 4, 'the dashboard fake read the four bad bases');
  assert.equal(await p.evIn(dashO, 'window.__base()'), base, 'the dashboard fake keeps its base');
  assert.equal(await bases(), true, 'and keeps none of the bad ones');
  // a hub-route from the frame itself whose head is over 2,048 characters, or not a string: not accepted
  const atBad = await p.ev('location.hash');
  await p.evIn(dashO, `window.parent.postMessage({ devteam: 'hub-route', head: '#' + 'x'.repeat(2048) }, ${JSON.stringify(hubO)})`);
  await p.evIn(dashO, `window.parent.postMessage({ devteam: 'hub-route', head: 1 }, ${JSON.stringify(hubO)})`);
  const badHeads = "window.__log.filter((e) => e.got === 'hub-route' && (e.head === 1 || (typeof e.head === 'string' && e.head.length === 2049)))";
  await until(async () => (await p.ev(`${badHeads}.length`)) === 2, 'the hub fake received the long head and the non-string one');
  assert.deepEqual(await p.ev(`${badHeads}.map((e) => e.accepted)`), [false, false], 'a head over 2,048 characters or not a string is not accepted');
  assert.equal(await p.ev('location.hash'), atBad, "the hub fake's hash does not move for them");
  // a hub-route from a window that is not the hub's frame (another window at the frame's origin, and the hub's own):
  // the hub's hash doesn't change
  const before = await p.ev('location.hash');
  await p.ev(`(() => { const r = document.createElement('iframe'); r.id = 'rogue'; r.src = ${JSON.stringify(`${dashO}/dashboard-frame-fake.html#rogue`)}; document.body.append(r); })()`);
  await until(async () => (await p.evIn(dashO, 'location.hash')) === '#rogue', 'the other window has loaded');
  await p.evIn(dashO, "window.parent.postMessage({ devteam: 'hub-route', head: '#evil' }, '*')");
  await p.ev("window.postMessage({ devteam: 'hub-route', head: '#self' }, '*')");
  await until(async () => (await p.ev("window.__log.filter((e) => e.head === '#evil' || e.head === '#self').length")) === 2, 'the hub fake received both');
  assert.deepEqual(await p.ev("window.__log.filter((e) => e.head === '#evil' || e.head === '#self').map((e) => e.accepted)"), [false, false], 'neither is accepted');
  assert.equal(await p.ev('location.hash'), before, "the hub fake's hash does not change");
  // the frame's window showing a page of a third origin: the hub sends hub-base only to the frame's origin, so that
  // page reads none, and its hub-route is refused though it comes from the frame's window
  const thirdS = await serveFakes();
  later(() => new Promise((r) => thirdS.close(r)));
  const thirdO = `http://127.0.0.1:${thirdS.address().port}`;
  const loads = await p.ev("window.__log.filter((e) => e.why === 'load').length");
  await p.ev(`document.getElementById('f').src = ${JSON.stringify(`${thirdO}/dashboard-frame-fake.html#third`)}`);
  await until(async () => (await p.ev("window.__log.filter((e) => e.why === 'load').length")) === loads + 1 && (await p.evIn(thirdO, 'location.hash')) === '#third', 'the frame has loaded a third origin, and the hub fake sent its base');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await p.evIn(thirdO, 'window.__seen'), 0, "hub-base goes to the frame's origin only: the third origin reads none");
  await p.evIn(thirdO, "window.parent.postMessage({ devteam: 'hub-route', head: '#third' }, '*')");
  await until(async () => (await p.ev("window.__log.filter((e) => e.head === '#third').length")) === 1, 'the hub fake received the third origin\'s hub-route');
  assert.deepEqual(await p.ev("window.__log.filter((e) => e.head === '#third').map((e) => [e.origin, e.accepted])"), [[thirdO, false]], "from the frame's window but not the frame's origin: not accepted");
  assert.equal(await p.ev('location.hash'), before, "the hub fake's hash still does not change");
  // a hub framing the dashboard from the dashboard's own origin: the dashboard fake keeps no base from it
  await p.send('Page.navigate', { url: `${dashO}/hub-frame-fake.html?key=${key}&src=${encodeURIComponent(`${dashO}/dashboard-frame-fake.html#same`)}` });
  await until(async () => (await p.ev("window.__log.filter((e) => e.why === 'load').length")) === 1 && (await p.ev("document.getElementById('f').contentWindow.location.hash")) === '#same', 'a same-origin hub has framed the dashboard fake and sent its base');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await p.ev("document.getElementById('f').contentWindow.__bases.length"), 0, 'the dashboard fake keeps no hub-base from its own origin');
});
