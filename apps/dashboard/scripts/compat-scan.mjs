#!/usr/bin/env node
// apps-src@1 The scan that writes apps/dashboard/COMPAT.md and apps/hub/COMPAT.md, once, from the kit's tests
// at one commit (the contract ticket's base): every test file that opens a page in Chrome or slices one under
// node:vm, what it reads of each page (the window globals it calls, the ids, classes, roles and texts it
// reads, the poll), and which views it needs. A view is the port that owns a page line, by the line ranges in
// PAGES (lines at RANGES_AT, from the port plan); a line at the base is carried back to RANGES_AT through git's
// diff, so a line added since goes with the line above it.
//   node apps/dashboard/scripts/compat-scan.mjs --base <sha> [--repo <kit checkout>] [--check | --json | --stubs | --state [--json]]
// --check compares the two files with what it would write, each root view's stub's exported functions with the
// cross-view functions it finds, and each owning view's state.ts with its cross-view state (exit 1 when any
// differs); --json prints the scan; --stubs prints each stub's export block; --state prints the cross-view state
// by owning view (--json: { <view>: [{ name, line }] }). Exit 0 ok, 1 differs or a test it can't place, 2 usage or git refused.
//
// It is a scan, not a parser: it reads a test's string literals (page-evaluated code is a string to the test)
// for selectors, getElementById calls and global names, and keeps only what the page itself has (an id, class
// or role the page writes, a top-level name its script declares, a text it holds), so what it lists is what a
// port must keep. Its limits, each named in COMPAT.md's head: an id or class the page builds from a variable
// is matched by its fixed prefix only; a text is a test literal of 4 or more characters, with a capital or a
// space, found in the page, on a line that reads the page; a name built at run time isn't seen.
// Node 18+, built-ins only; needs git.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RANGES_AT = '3088ac1e';

// Every view a test can need, by app, in the port plan's names.
export const VIEWS = {
  dashboard: ['shell', 'data', 'words', 'overview', 'goals', 'board', 'autonomy', 'settings', 'loop', 'peeks', 'peek-kinds', 'review', 'viewer', 'attachments', 'library', 'threads-core', 'threads-panel', 'thread', 'terminal',
    'canvas', 'canvas-panels', 'canvas-sync', 'canvas-editing', 'canvas-history', 'canvas-presence', 'browser'],
  hub: ['hub-shell', 'hub-overview', 'hub-settings', 'hub-threads'],
};

const r = (...pairs) => pairs.map((p) => p.split('-').map(Number));
// The pages, their routes, the views every test of the page needs (the route's root view, and for the
// dashboard its data loop), and each view's lines at RANGES_AT (the design's Tickets tables). A line in no
// range goes with the page's first view (the design: "a blank or closing line between two ranges goes with
// the shell"). hub.html's copies of the shared blocks (13-191, 507-844) are the hub shell's to import.
export const PAGES = [
  {
    key: 'index', app: 'dashboard', file: 'docs/devteam/dashboard/index.html', route: '/', needs: ['shell', 'data'], globals: 'top',
    ranges: {
      shell: r('1-289', '328-394', '680-729', '760-850', '1323-1329', '1362-1390', '1574-2042', '9393-9460'),
      data: r('7892-8158', '9461-9577', '12122-12280', '12296-12762'),
      words: r('592-639', '3112-3649'),
      overview: r('1291-1322', '1391-1397', '9244-9392', '12281-12295', '12763-12877'),
      goals: r('664-679', '1271-1290', '1399-1404', '4184-4376', '4616-4887'),
      board: r('492-578', '1406-1433', '2686-3111'),
      autonomy: r('395-491', '1465-1479', '1484-1488', '2043-2685', '5774-5877'),
      settings: r('290-327', '1480-1483', '1489-1494', '4377-4615', '6138-6182'),
      loop: r('579-591', '640-663', '1442-1464', '4888-5097', '5614-5710', '6453-6499'),
      peeks: r('730-759', '1511-1519', '5098-5613', '5711-5773'),
      'peek-kinds': r('5878-6137', '6183-6452', '6500-6870'),
      review: r('851-915', '1496-1510', '3650-4183'),
      viewer: r('962-1066', '1520-1549', '6871-7891'),
      attachments: r('1232-1270', '8159-8509'),
      library: r('916-961', '1435-1440', '8510-9243'),
      'threads-core': r('9579-9950'),
      'threads-panel': r('1067-1231', '1550-1572', '9951-10404', '10747-10820', '11041-11468'),
      thread: r('10405-10746', '10821-11040', '11469-11722'),
      terminal: r('1330-1361', '11723-12121'),
    },
  },
  {
    key: 'canvas', app: 'dashboard', file: 'docs/devteam/dashboard/canvas.html', route: '/view/canvas/', needs: ['canvas'], globals: 'window',
    ranges: {
      canvas: r('1-1058'),
      'canvas-panels': r('1059-1658', '2238-2629'),
      'canvas-sync': r('1659-2237', '4452-4724'),
      'canvas-editing': r('2630-3572'),
      'canvas-history': r('3573-4451'),
      'canvas-presence': r('4725-5504'),
    },
  },
  { key: 'browser', app: 'dashboard', file: 'docs/devteam/dashboard/browser.html', route: '/browser/', needs: ['browser'], globals: 'window', ranges: { browser: r('1-483') } },
  {
    key: 'hub', app: 'hub', file: 'docs/devteam/dashboard/hub.html', route: '/', needs: ['hub-shell'], globals: 'top',
    ranges: {
      'hub-shell': r('1-12', '13-191', '192-362', '395-506', '507-844', '845-1148', '1292-1477', '3194-3504'),
      'hub-overview': r('363-394', '1149-1291', '1478-1976'),
      'hub-settings': r('1977-2566'),
      'hub-threads': r('2567-3193'),
    },
  },
];

// What marks a test file (or a fixture it imports) as touching a page. Read from the file's text.
// The file's hub port: HUB, and every expression it gives DEVTEAM_HUB_PORT (`DEVTEAM_HUB_PORT: String(PORTS + 0)`,
// `process.env.DEVTEAM_HUB_PORT = String(GW_HUB)`). A template URL `${<that>}/` or `${<that>}/#…` ending the
// template is the hub's root, which serves hub.html.
const squash = (e) => e.replace(/\s+/g, '');
export function hubRoot(text) {
  const ports = new Set(['HUB']);
  for (const m of text.matchAll(/DEVTEAM_HUB_PORT['"]?\s*[:=]\s*(?:String\(\s*([^()]+?)\s*\)|([A-Za-z_$][\w$.]*(?:\s*\+\s*\d+)?))\s*[,;}\n]/g)) ports.add(squash(m[1] ?? m[2]));
  for (const m of text.matchAll(/\$\{([^{}]+)\}\/(?:#[^`]*)?`/g)) if (ports.has(squash(m[1]))) return true;
  return false;
}
export const SIGNALS = {
  index: [/dashboard['"]?\s*,\s*['"]index\.html|dashboard\/index\.html|\bINDEX\b\s*=|\bdashboardOnFreePort\b|\bstartDashboard\b|['"]dashboard['"]\s*,\s*['"]--port|devteam\.mjs['"]\s*,\s*['"]dashboard['"]/],
  // a URL to a hub port's root loads hub.html: see hubRoot
  hub: [/\bhub\.html\b|\bhubPage\b|\bstartHub\b/, (t) => hubRoot(t)],
  canvas: [/\bcanvas\.html\b|\/view\/canvas\//],
  browser: [/\bbrowser\.html\b|\bbrowserViewServer\b/],
};

// Shared helpers every kind of test imports: their own page signals (a dashboard starter they define) don't
// make each importer a page test; a test that starts a dashboard names the starter itself.
export const GENERAL = new Set(['test/lib/kit.mjs']);

// Files the signals misjudge, decided by reading them (each with why). `[]` means it opens no kit page.
export const PLACED = {
  'test/chrome-temp.test.mjs': { pages: [], why: 'Chrome\'s own temp folder; it opens about:blank' },
  'test/run.test.mjs': { pages: [], why: 'the test runner\'s grouping; no page' },
  'test/artifact-archive.test.mjs': { pages: [], why: 'imports chrome.mjs for cleanup() only' },
  'test/artifact-interactivity.test.mjs': { pages: [], why: 'the artifact lens in vm and an artifact\'s own page' },
  'test/artifact-note-shots-page.test.mjs': { pages: [], why: 'the note-shot page the kit draws, not a dashboard page' },
  'test/browser-hygiene.profile.test.mjs': { pages: [], why: 'the browser command\'s Chrome profiles' },
  'test/browser-hygiene.test.mjs': { pages: [], why: 'the browser command\'s Chrome profiles' },
  'test/browser-profiles.test.mjs': { pages: [], why: 'the browser command\'s credential chain' },
  'test/gateway-paste.test.mjs': { pages: [], why: 'the gateway\'s own Terminal page (cloud/gateway.mjs), not hub.html' },
};

const TAGS = new Set('a abbr article aside b body button canvas code details dialog div em fieldset figure footer form h1 h2 h3 h4 h5 h6 header html i iframe img input kbd label li main nav ol option output p pre section select small span strong summary svg table tbody td textarea th thead time tr ul'.split(' '));

// ---- reading a JS file: its string material (string, template and regex literal text) apart from its code ----
export function literals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  let prevSig = '';
  const stack = []; // template nesting: brace depth where each ${ opened
  let depth = 0;
  const regexOk = () => !prevSig || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prevSig) || /\b(?:return|typeof|case|in|of|void|delete|throw|new)$/.test(prevSig);
  const readTemplate = () => { // at a ` or after a } closing ${ : read template text to ` or ${
    let s = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { s += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; out.push({ text: s, line: lineAt(i) }); prevSig = 'x'; return; }
      if (c === '$' && src[i + 1] === '{') { out.push({ text: s, line: lineAt(i) }); s = ''; i += 2; stack.push(depth); depth++; prevSig = '('; return; }
      s += c; i++;
    }
    out.push({ text: s, line: lineAt(i) });
  };
  const nl = [];
  for (let k = 0; k < n; k++) if (src[k] === '\n') nl.push(k);
  const lineAt = (pos) => { let lo = 0, hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < pos) lo = m + 1; else hi = m; } return lo + 1; };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      const at = i; let s = ''; i++;
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { s += src.slice(i, i + 2); i += 2; } else s += src[i++]; }
      i++; out.push({ text: s, line: lineAt(at), quote: c }); prevSig = 'x'; continue;
    }
    if (c === '`') { i++; readTemplate(); continue; }
    if (c === '/' && regexOk()) {
      const at = i; let s = ''; i++; let cls = false;
      while (i < n && src[i] !== '\n') { const d = src[i]; if (d === '\\') { s += src.slice(i, i + 2); i += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; s += d; i++; }
      i++; while (/[a-z]/.test(src[i] ?? '')) i++;
      out.push({ text: s, line: lineAt(at), regex: true }); prevSig = 'x'; continue;
    }
    if (c === '{') { depth++; prevSig = '{'; i++; continue; }
    if (c === '}') {
      if (stack.length && stack[stack.length - 1] === depth - 1) { stack.pop(); depth--; i++; readTemplate(); continue; }
      depth--; prevSig = '}'; i++; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[\w$]/.test(c)) { const m = /^[\w$]+/.exec(src.slice(i, i + 64)); prevSig = m[0]; i += m[0].length; continue; }
    prevSig = c; i++;
  }
  return out;
}

// ---- a page: its lines, its views, and what it holds ----
const ident = /[A-Za-z_$][\w$]*/;
export function readPage(text, page) {
  const lines = text.split('\n');
  const found = { kinds: new Map(), globals: new Map(), ids: new Map(), idPrefixes: new Map(), strs: new Map(), classes: new Map(), roles: new Map(), texts: [], regions: new Map() };
  const first = (map, k, ln, weak = false) => {
    const had = map.get(k);
    if (!had || (had.weak && !weak)) map.set(k, { line: ln, weak, lines: had?.weak || !had ? (weak ? [] : [ln]) : had.lines });
    else if (!weak && had.lines.at(-1) !== ln) had.lines.push(ln);
  };
  let inStyle = false;
  lines.forEach((l, k) => {
    const ln = k + 1;
    // a page's own <style> element: one opening at a line's start (a "<style" inside a script string is not)
    if (/^\s*<style\b/i.test(l)) inStyle = true;
    const css = inStyle;
    if (/^\s*<\/style>/i.test(l)) inStyle = false;
    for (const m of l.matchAll(/(?:\/\*|<!--)\s*([\w-]+) start\s*(?:\*\/|-->)/g)) first(found.regions, m[1], ln);
    if (page.globals === 'top') {
      const d = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)/.exec(l);
      if (d) { first(found.globals, d[1] ?? d[2], ln); found.kinds.set(d[1] ?? d[2], d[1] || /^(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(d[3]) ? 'function' : 'value'); }
    }
    for (const m of l.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=(?!=)\s*(.*)/g)) { first(found.globals, m[1], ln); if (!found.kinds.has(m[1])) found.kinds.set(m[1], /^(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(m[2]) ? 'function' : 'value'); }
    if (css) {
      for (const m of l.matchAll(/(?:^|[\s,>+~(])[a-z0-9]*((?:[.#][A-Za-z_][\w-]*)+)/g)) for (const p of m[1].match(/[.#][A-Za-z_][\w-]*/g)) {
        if (p[0] === '.') first(found.classes, p.slice(1), ln, true); else first(found.ids, p.slice(1), ln, true);
      }
      return;
    }
    for (const m of l.matchAll(/\bid=\\?["']([A-Za-z_][\w:-]*)(\$\{)?/g)) { if (m[2]) first(found.idPrefixes, m[1], ln); else first(found.ids, m[1], ln); }
    // an id the script builds: `n-${tab}` on a line that looks elements up by id (getElementById, the page's $)
    if (/getElementById\(|(?<![\w$.])\$\(/.test(l)) for (const m of l.matchAll(/`([A-Za-z_][\w:]*-)\$\{/g)) first(found.idPrefixes, m[1], ln);
    // every hyphenated id-shaped string the script holds ({ library: 'n-library' }): an id only if a test looks
    // it up by id (getElementById, querySelector('#…')), never from a selector or a hash route in other text
    for (const m of l.matchAll(/(?<![\w\\])['"]([A-Za-z_][\w:]*-[\w:-]*)['"]/g)) first(found.strs, m[1], ln);
    for (const m of l.matchAll(/(?:getElementById|\.id\s*=)\s*\(?\s*['"]([A-Za-z_][\w:-]*)['"]/g)) first(found.ids, m[1], ln);
    for (const m of l.matchAll(/\bclass(?:Name)?\s*=\s*\\?["'`]([^"'`]*)/g)) for (const c of m[1].replace(/\$\{[^}]*\}?/g, ' ').split(/\s+/)) if (/^[A-Za-z_][\w-]*$/.test(c)) first(found.classes, c, ln);
    for (const m of l.matchAll(/classList\.(?:add|remove|toggle|contains|replace)\(([^)]*)\)/g)) for (const c of m[1].matchAll(/['"]([A-Za-z_][\w-]*)['"]/g)) first(found.classes, c[1], ln);
    for (const m of l.matchAll(/(?:querySelector(?:All)?|closest|matches)\(\s*['"`]([^'"`]+)/g)) for (const p of m[1].match(/[.#][A-Za-z_][\w-]*/g) ?? []) {
      if (p[0] === '.') first(found.classes, p.slice(1), ln, true); else first(found.ids, p.slice(1), ln, true);
    }
    for (const m of l.matchAll(/\brole=\\?["']?([a-z]+)/g)) first(found.roles, m[1], ln);
    for (const m of l.matchAll(/setAttribute\(\s*['"]role['"]\s*,\s*['"]([a-z]+)['"]/g)) first(found.roles, m[1], ln);
  });
  found.texts = material(text);
  return { lines, found };
}

// A page's words: the text of its markup outside <script> and <style>, and the string, template and regex
// literals of its scripts, each with its line. Comments are not words.
export function material(text) {
  const out = [];
  const re = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
  let at = 0;
  const lineOf = (pos) => text.slice(0, pos).split('\n').length;
  const markup = (from, to) => {
    const part = text.slice(from, to).replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '));
    const first = lineOf(from);
    part.split('\n').forEach((l, k) => { const t = l.replace(/<[^>]*>/g, ' ').trim(); if (t) out.push({ line: first + k, text: t }); });
  };
  for (const m of text.matchAll(re)) {
    markup(at, m.index);
    if (m[1].toLowerCase() === 'script' && !/\ssrc\s*=/i.test(m[2])) {
      const first = lineOf(m.index + m[0].indexOf('>') + 1);
      for (const l of literals(m[3])) out.push({ line: first + l.line - 1, text: l.text });
    }
    at = m.index + m[0].length;
  }
  markup(at, text.length);
  return out;
}

// ---- git, and lines at the base carried back to RANGES_AT ----
function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw Object.assign(new Error(`git ${args.join(' ')}: ${(r.stderr || '').trim()}`), { usage: true });
  return r.stdout;
}
// base line -> RANGES_AT line, from the -U0 diff's hunks: a line the base added goes with the old line above it
export function lineMap(diff) {
  const hunks = [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({ os: +m[1], oc: m[2] === undefined ? 1 : +m[2], ns: +m[3], nc: m[4] === undefined ? 1 : +m[4] }));
  // In a -U0 hunk a count of 0 names the line before the change: "-12,0" inserts after old line 12.
  return (ln) => {
    let offset = 0;
    for (const h of hunks) {
      const newFirst = h.nc === 0 ? h.ns + 1 : h.ns;
      if (ln < newFirst) break;
      if (h.nc > 0 && ln < h.ns + h.nc) return Math.max(1, h.oc === 0 ? h.os : h.os + Math.min(ln - h.ns, h.oc - 1));
      offset = (h.oc === 0 ? h.os + 1 : h.os + h.oc) - (h.nc === 0 ? h.ns + 1 : h.ns + h.nc);
    }
    return ln + offset;
  };
}

export function viewOf(page, oldLine) {
  for (const [v, rs] of Object.entries(page.ranges)) if (rs.some(([a, b]) => oldLine >= a && oldLine <= b)) return v;
  return page.needs[0];
}

// ---- tests ----
const POLL = /setInterval[\s\S]{0,240}?\b10000\b|\b10000\b[\s\S]{0,240}?setInterval/;
const READS_LINE = /textContent|innerText|\bev(?:In)?\(|\bsoon|title|aria-label|placeholder|assert\.|includes\(|\.match\(|getAttribute|value/;

// The names a piece of code calls (a name, not after ".", then "(") or reads off window ("window.name").
export function calledNames(text) {
  const out = new Set();
  for (const m of text.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) out.add(m[2]);
  for (const m of text.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  return out;
}

// Methods a page name can share with a built-in, never read as a page's own (x.filter(…) is an array's).
const BUILTIN = new Set('add apply bind call catch concat delete entries every fill filter find findIndex flat flatMap forEach get has includes indexOf join keys map match pop push reduce replace set slice some sort splice split startsWith endsWith test then toString trim values'.split(' '));

// slicing: the test runs page code under node:vm, so it also names what it takes (take('linkify'), a block's
// marker) or calls it in its own code (ctx.when(…))
export function scanTest(src, pages, { slicing = [] } = {}) {
  const lits = literals(src);
  const strs = lits.filter((l) => !l.regex);
  const srcLines = src.split('\n');
  const got = { globals: new Set(), taken: new Set(), ids: new Set(), classes: new Set(), roles: new Set(), texts: new Set(), regions: new Set() };
  const called = strs.map((l) => calledNames(l.text));
  for (const p of pages) {
    const f = p.model.found;
    strs.forEach((l, k) => {
      for (const name of called[k]) if (name.length >= 2 && f.globals.has(name)) got.globals.add(`${p.key}\0${name}`);
    });
    for (const l of strs) {
      for (const m of l.text.matchAll(/getElementById\(\s*\\?['"`]([A-Za-z_][\w:-]*)/g)) addId(p, m[1], got, true);
      for (const m of l.text.matchAll(/querySelector(?:All)?\(\s*\\?['"`]#([A-Za-z_][\w:-]*)/g)) addId(p, m[1], got, true);
      // the page's own $('x') in code a test runs in the page, and a literal that is a whole id selector ('#n-trust')
      for (const m of l.text.matchAll(/(?<![\w$.])\$\(\s*\\?['"`]([A-Za-z_][\w:-]*)['"`]\s*\)/g)) addId(p, m[1], got, true);
      if (l.quote && /^#[A-Za-z_][\w:]*-[\w:-]*$/.test(l.text)) addId(p, l.text.slice(1), got, true);
      for (const m of l.text.matchAll(/\[id\^?=\\?["']?([A-Za-z_][\w:-]*)/g)) addId(p, m[1], got);
      for (const m of l.text.matchAll(/(?:^|[\s'"(,>+~[\]):])((?:[a-z][a-z0-9]*)?(?:[#.][A-Za-z_][\w-]*)+)/g)) {
        const tag = /^[a-z][a-z0-9]*/.exec(m[1])?.[0];
        if (tag && !TAGS.has(tag)) continue;
        for (const q of m[1].match(/[#.][A-Za-z_][\w-]*/g)) {
          if (q[0] === '#') addId(p, q.slice(1), got);
          else if (f.classes.has(q.slice(1))) got.classes.add(`${p.key}\0${q.slice(1)}`);
        }
      }
      for (const m of l.text.matchAll(/classList\.contains\(\s*\\?['"]([A-Za-z_][\w-]*)/g)) if (f.classes.has(m[1])) got.classes.add(`${p.key}\0${m[1]}`);
      for (const m of l.text.matchAll(/role\s*=\s*\\?["']?([a-z]+)/g)) if (f.roles.has(m[1])) got.roles.add(`${p.key}\0${m[1]}`);
      if (l.quote && f.regions.has(l.text)) got.regions.add(`${p.key}\0${l.text}`);
    }
    if (slicing.includes(p.key)) {
      for (const l of strs) if (l.quote && f.globals.has(l.text)) got.taken.add(`${p.key}\0${l.text}`);
      for (const m of src.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)) if (m[1].length >= 3 && !BUILTIN.has(m[1]) && f.globals.has(m[1])) got.taken.add(`${p.key}\0${m[1]}`);
      for (const l of strs) { const r = l.text.replace(/^\/\* | start \*\/$/g, ''); if (f.regions.has(r)) got.regions.add(`${p.key}\0${r}`); }
    }
    if (/['"]role['"]/.test(src)) for (const l of strs) if (l.quote && f.roles.has(l.text)) got.roles.add(`${p.key}\0${l.text}`);
    for (const l of lits) {
      const t = l.regex ? plainRegex(l.text) : l.text;
      if (!t || t !== t.trim() || t.length < 4 || !/[A-Z ]/.test(t) || !/[A-Za-z]/.test(t) || /[{}<>=;$`\\()!'"]/.test(t) || t.startsWith('--') || /^[#.[,:;]/.test(t) || /^[\w$]+\.[\w$.]+$/.test(t)) continue;
      if (!READS_LINE.test(srcLines[l.line - 1] ?? '')) continue;
      let hit = p.model.seen.get(t);
      if (hit === undefined) { hit = isPageText(p.model, t); p.model.seen.set(t, hit); }
      if (hit) got.texts.add(`${p.key}\0${t}`);
    }
  }
  return { got, poll: POLL.test(src), polls: /__polls\b/.test(src) };
}
// A test literal is a page text when it is the whole of one of the page's strings or text runs, or it starts
// with a capital and the page holds it between word boundaries ("Needs you" in "Needs you now", never "a read"
// inside "a ready").
export function isPageText(model, t) {
  model.exact ??= new Set(model.found.texts.map((w) => w.text.trim()));
  if (model.exact.has(t)) return true;
  if (!/^[A-Z]/.test(t)) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w-])${esc}(?![\\w-])`).test(model.words);
}
function addId(p, id, got, lookup = false) {
  const f = p.model.found;
  if (f.ids.has(id)) { got.ids.add(`${p.key}\0${id}`); return; }
  // a string the page's script holds, which a test reads as an id: an id the page sets from it (first, so
  // n-library is the shell's PAGE_COUNT_ID entry, not the loop's n-${tab})
  if (lookup && id.includes('-') && !id.endsWith('-') && f.strs.has(id)) { f.ids.set(id, f.strs.get(id)); got.ids.add(`${p.key}\0${id}`); return; }
  // a prefix the test builds on (#a-${qid}) is that prefix's item
  for (const pre of f.idPrefixes.keys()) if (id.startsWith(pre) && (id.length > pre.length || id.endsWith('-'))) { got.ids.add(`${p.key}\0${pre}*`); return; }
}
// a regex literal's text when it is plain words: \s+ and \s* read as a space, other escapes as the character
function plainRegex(s) {
  const t = s.replace(/\\s[+*]?/g, ' ').replace(/^\^|\$$/g, '').replace(/\\(.)/g, '$1');
  return /^[\w ’'.,:!?()-]+$/.test(t) && !/[()]/.test(s.replace(/\\[()]/g, '')) ? t.trim() : null;
}

// ---- the whole scan ----
export function scan(repo, base) {
  const read = (p) => git(repo, ['show', `${base}:${p}`]);
  const tracked = git(repo, ['ls-tree', '-r', '--name-only', base, '--', 'test']).split('\n').filter((f) => /^test\/.*\.mjs$/.test(f) && !f.startsWith('test/split/'));
  const pages = PAGES.map((p) => {
    const text = read(p.file);
    const model = readPage(text, p);
    model.text = text;
    model.seen = new Map();
    model.words = model.found.texts.map((w) => w.text).join('\n');
    const map = lineMap(git(repo, ['diff', '-U0', RANGES_AT, base, '--', p.file]));
    const view = (ln) => viewOf(p, map(ln));
    return { ...p, model, view };
  });
  const byKey = Object.fromEntries(pages.map((p) => [p.key, p]));
  const src = Object.fromEntries(tracked.map((f) => [f, read(f)]));
  const imports = (f) => [...src[f].matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]))).filter((p) => src[p] !== undefined);
  const closures = new Map();
  const closure = (f) => {
    if (!closures.has(f)) { const seen = new Set([f]); const q = [f]; while (q.length) for (const i of imports(q.shift())) if (!seen.has(i)) { seen.add(i); q.push(i); } closures.set(f, [...seen]); }
    return closures.get(f);
  };
  const own = (f) => Object.entries(SIGNALS).filter(([, res]) => res.some((re) => (typeof re === 'function' ? re(src[f]) : re.test(src[f])))).map(([k]) => k);
  // a Chrome test: it, or a file it imports, imports test/lib/chrome.mjs
  const isChrome = (f) => closure(f).includes('test/lib/chrome.mjs');
  const rows = [];
  const unplaced = [];
  for (const f of tracked.filter((x) => !GENERAL.has(x) && (x.endsWith('.test.mjs') || x.startsWith('test/lib/') || x.startsWith('test/fixtures/')))) {
    const vm = /['"](?:node:)?vm['"]/.test(src[f]);
    const chrome = f !== 'test/lib/chrome.mjs' && isChrome(f);
    const touched = PLACED[f]?.pages ?? [...new Set(closure(f).filter((g) => !GENERAL.has(g)).flatMap(own))];
    const ownPages = PLACED[f]?.pages ?? own(f);
    const opens = chrome && f.endsWith('.test.mjs') ? touched : [];
    const slicing = vm ? ownPages : [];
    if (chrome && f.endsWith('.test.mjs') && !touched.length && !PLACED[f]) { unplaced.push(f); continue; }
    const reads = [...new Set([...opens, ...slicing, ...(f.endsWith('.test.mjs') ? [] : ownPages)])];
    if (!reads.length) continue;
    const s = scanTest(src[f], reads.map((k) => byKey[k]), { slicing });
    // a slice: a vm test that takes a block or a name of the page
    const slices = slicing.filter((k) => [...s.got.regions, ...s.got.globals, ...s.got.taken].some((x) => x.startsWith(`${k}\0`)));
    if (!opens.length && !slices.length && f.endsWith('.test.mjs')) continue;
    rows.push({ file: f, opens, slices, fixture: !f.endsWith('.test.mjs'), uses: closure(f).slice(1).filter((g) => !g.endsWith('chrome.mjs')), ...s });
  }
  // a fixture stays only when a kept test uses it
  const kept = new Set(rows.filter((r) => !r.fixture).flatMap((r) => r.uses));
  const all = rows.filter((r) => !r.fixture || kept.has(r.file));
  // views
  const itemView = (kind, key) => {
    const [pk, name] = key.split('\0');
    const p = byKey[pk];
    const f = p.model.found;
    const at = kind === 'ids' ? (name.endsWith('*') ? f.idPrefixes.get(name.slice(0, -1)) : f.ids.get(name))
      : kind === 'texts' ? p.model.found.texts.find((t) => t.text.includes(name))
        : f[kind === 'taken' ? 'globals' : kind].get(name);
    if (!at?.line) return p.needs[0];
    // written by more than one view (a shared class, a word on several pages): the page's root view, which
    // holds the shared parts; written by one view: that view
    const lines = kind === 'texts' ? p.model.found.texts.filter((t) => t.text.includes(name)).map((t) => t.line) : at.lines?.length ? at.lines : [at.line];
    const views = new Set(lines.map((ln) => p.view(ln)));
    return views.size === 1 ? [...views][0] : p.needs[0];
  };
  for (const row of all) {
    const v = new Set();
    for (const k of [...row.opens, ...row.slices]) for (const n of byKey[k].needs) v.add(n);
    for (const kind of ['globals', 'taken', 'ids', 'classes', 'roles', 'texts', 'regions']) for (const key of row.got[kind]) v.add(itemView(kind, key));
    row.views = v;
  }
  for (const row of all) if (!row.fixture) for (const u of row.uses) { const fx = all.find((x) => x.file === u); if (fx) for (const v of fx.views) row.views.add(v); }
  return { base, pages, rows: all, unplaced, itemView, crossView: crossView(pages) };
}
const lineOfText = (text, t) => text.slice(0, Math.max(0, text.indexOf(t))).split('\n').length;

// The functions a root view declares that another view of its page calls: each stub exports them, typed,
// throwing "not ported: <view>" until the port. Top-level declarations (index, hub) or the canvas IIFE's own
// (two spaces in), whose line is the root view's; a call is the name followed by "(", or the name passed
// on, outside the root view's own lines.
export function crossView(pages) {
  const out = {};
  for (const p of pages) {
    const root = p.needs[0];
    const decl = p.key === 'canvas' ? /^ {2}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^ {2}const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\((?!\()[^)]*\)|[A-Za-z_$][\w$]*)\s*=>/
      : /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\((?!\()[^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;
    const names = new Map();
    p.model.lines.forEach((l, k) => { const m = decl.exec(l); if (m && p.view(k + 1) === root) names.set(m[1] ?? m[2], k + 1); });
    const callers = new Map();
    p.model.lines.forEach((l, k) => {
      if (/^\s*(?:\/\/|\*)/.test(l)) return;
      const v = p.view(k + 1);
      if (v === root) return;
      // names used as code: string literals blanked, a name not after "." (a property) nor before ":" (a key)
      const codeOnly = l.replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""');
      for (const m of codeOnly.matchAll(/(^|[^\w$.-])([A-Za-z_$][\w$]*)\b(?!\s*:(?!:))/g)) {
        if (!names.has(m[2])) continue;
        if (!callers.has(m[2])) callers.set(m[2], new Set());
        callers.get(m[2]).add(v);
      }
    });
    out[p.key] = { view: root, fns: [...callers].map(([name, vs]) => ({ name, line: names.get(name), from: [...vs].sort() })).sort((a, b) => a.name.localeCompare(b.name)) };
  }
  return out;
}

// ---- the root views' stubs ----
export const STUBS = { index: 'apps/dashboard/src/views/shell/index.tsx', canvas: 'apps/dashboard/src/views/canvas/index.tsx', browser: 'apps/dashboard/src/views/browser/index.tsx', hub: 'apps/hub/src/views/hub-shell/index.tsx' };
// What a stub exports for other views: each function, typed, throwing until the view's port replaces it.
export function stubExports(cv) {
  return cv.fns.map((f) => `export function ${f.name}(..._args: unknown[]): never {\n  throw new Error('not ported: ${cv.view}');\n}\n`).join('\n');
}
// The names a view's source exports (its default export aside): functions, and consts a port may export instead.
export const exportedFns = (src) => [...src.matchAll(/^export (?:async )?(?:function\*? ?|const |let )([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]).sort((a, b) => a.localeCompare(b));
// A root view still the contract's stub (its first line says so); its port replaces the line with the folder.
export const isStub = (src) => src.startsWith('// apps-src@1 view stub:');

// ---- COMPAT.md ----
const md = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s) => (s.includes('`') ? `\`\` ${md(s)} \`\`` : `\`${md(s)}\``);
export function render(res, app) {
  const pages = res.pages.filter((p) => p.app === app);
  const keys = new Set(pages.map((p) => p.key));
  const rows = res.rows.filter((r) => [...r.opens, ...r.slices].some((k) => keys.has(k)) || (r.fixture && res.rows.some((t) => !t.fixture && t.uses.includes(r.file) && [...t.opens, ...t.slices].some((k) => keys.has(k)))));
  const L = [];
  L.push(`# COMPAT: apps/${app}`, '');
  L.push(`The compatibility surface of \`apps/${app}\` (\`apps-src@1\`, \`apps/dashboard/APPS.md\`): what the kit's tests at kit \`${res.base}\` read of ${pages.map((p) => `\`${path.posix.basename(p.file)}\``).join(', ')}, which the app keeps until the cutover. Written once by \`node apps/dashboard/scripts/compat-scan.mjs --base ${res.base}\`, which \`--check\` re-runs; port tickets don't edit it, and an item a later test adds is a carry-over.`, '');
  L.push('A scan, not a parser. It reads each test\'s string, template and regex literals (code a test runs in the page is a string to it) and keeps only what the page itself has. Its limits: an id or class the page builds from a variable is matched by its fixed prefix only (listed as `prefix*`); a text is a literal of 4 or more characters, with a capital or a space, on a line that reads the page, found in the page\'s source; a name built at run time is not seen. A view is the port that owns the page lines where the item is written, by the line ranges in `apps/dashboard/scripts/compat-scan.mjs` (lines at kit `' + RANGES_AT + '`); an item more than one view writes belongs to the page\'s root view, which holds the shared parts.', '');
  // a test that opens the page in Chrome, or a fixture such a test uses: only these call window globals
  const opener = (r, k) => r.opens.includes(k) || (r.fixture && rows.some((t) => !t.fixture && t.uses.includes(r.file) && t.opens.includes(k)));
  L.push('## Counts', '', '| page | route | tests that open it | tests that slice it | globals | ids | classes | roles | texts |', '|---|---|---|---|---|---|---|---|---|');
  for (const p of pages) {
    const c = (kind) => new Set(rows.filter((r) => kind !== 'globals' || opener(r, p.key)).flatMap((r) => [...r.got[kind]].filter((k) => k.startsWith(`${p.key}\0`)))).size;
    L.push(`| \`${path.posix.basename(p.file)}\` | \`${p.route}\` | ${rows.filter((r) => !r.fixture && r.opens.includes(p.key)).length} | ${rows.filter((r) => !r.fixture && r.slices.includes(p.key)).length} | ${c('globals')} | ${c('ids')} | ${c('classes')} | ${c('roles')} | ${c('texts')} |`);
  }
  L.push('');
  const section = (title, kind, intro) => {
    for (const p of pages) {
      const items = new Map();
      for (const r of rows) for (const k of r.got[kind]) if (k.startsWith(`${p.key}\0`) && (kind !== 'globals' || opener(r, p.key))) { const n = k.slice(p.key.length + 1); if (!items.has(n)) items.set(n, new Set()); items.get(n).add(r.file); }
      if (!items.size) continue;
      L.push(`## ${title}: \`${path.posix.basename(p.file)}\``, '');
      if (intro) L.push(intro, '');
      const kinds = kind === 'globals';
      L.push(kinds ? '| item | kind | view | read by |' : '| item | view | read by |', kinds ? '|---|---|---|---|' : '|---|---|---|');
      for (const [n, fs_] of [...items].sort((a, b) => a[0].localeCompare(b[0]))) L.push(`| ${code(n)} |${kinds ? ` ${p.model.found.kinds.get(n) ?? 'function'} |` : ''} ${res.itemView(kind, `${p.key}\0${n}`)} | ${[...fs_].sort().map((f) => `\`${f}\``).join(', ')} |`);
      L.push('');
    }
  };
  section('Globals', 'globals', 'Each is on `window`, registered once by the view named: a function with `expose()` (`src/shared/compat.ts`), a value (state the page declares at its top level, reassigned or not) as a `window` property with a getter and a setter over the variable of the view (APPS.md, Shared code). `test/apps-compat.test.mjs` reports each function that is not a function on `window`, and each value that is missing.');
  section('Ids', 'ids');
  section('Classes', 'classes');
  section('Roles', 'roles');
  section('Texts', 'texts');
  L.push('## The poll', '');
  L.push('The data loop calls `setInterval(…, POLL_MS)` with `POLL_MS` exactly `10000` (`src/shared/poll.ts`): these tests replace `setInterval` for that one value to poll faster.', '');
  for (const r of rows.filter((x) => x.poll)) L.push(`- \`${r.file}\``);
  L.push('', 'These count the page\'s `/api/data` reads through `window.__polls`, set by the test\'s own `fetch` wrapper, so each poll must be one `fetch` of `/api/data`:', '');
  for (const r of rows.filter((x) => x.polls)) L.push(`- \`${r.file}\``);
  L.push('');
  const sl = rows.filter((r) => r.slices.length && !r.fixture);
  if (sl.length) {
    L.push('## Slices (`node:vm`)', '', 'Each runs page code under `node:vm`: a marked block it slices, or the declarations of the names it takes; the port moves them to `src/lib/` and the test, ported, imports `lib-dist/`.', '', '| test | page | blocks | names |', '|---|---|---|---|');
    for (const r of sl) {
      const only = (...kinds) => [...new Set(kinds.flatMap((kind) => [...r.got[kind]]).filter((k) => r.slices.some((s) => k.startsWith(`${s}\0`))).map((k) => k.split('\0')[1]))].sort();
      L.push(`| \`${r.file}\` | ${r.slices.map((k) => `\`${path.posix.basename(byKeyOf(res, k).file)}\``).join(', ')} | ${only('regions').map(code).join(', ') || 'n/a'} | ${only('globals', 'taken').map(code).join(', ') || 'n/a'} |`);
    }
    L.push('');
  }
  L.push('## Tests by view', '', 'Every test above, with the views it needs (the port plan\'s view names): its page\'s root view, and the view of every item it reads. A fixture\'s views count for each test that uses it.', '', '| test | opens | slices | views |', '|---|---|---|---|');
  for (const r of rows.sort((a, b) => a.file.localeCompare(b.file))) {
    const order = VIEWS[app];
    const vs = [...r.views].filter((v) => order.includes(v)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const pg = (ks) => ks.filter((k) => keys.has(k)).map((k) => `\`${path.posix.basename(byKeyOf(res, k).file)}\``).join(', ') || (r.fixture ? 'fixture' : 'n/a');
    L.push(`| \`${r.file}\` | ${pg(r.opens)} | ${pg(r.slices)} | ${vs.join(', ')} |`);
  }
  L.push('');
  // a view no item maps a test to: its port's tests are named by what they test, not by what they read
  const mapped = new Set(rows.flatMap((r) => [...r.views]));
  const bare = VIEWS[app].filter((v) => !mapped.has(v));
  L.push('### Views no item maps a test to', '');
  if (!bare.length) L.push('None.', '');
  else {
    L.push('No test reads an item only this view writes. Its port\'s done-whens name tests by the behaviour they check; those named for the view are listed.', '', '| view | tests named for it |', '|---|---|');
    for (const v of bare) {
      const named = rows.map((r) => r.file).filter((f) => f.startsWith(`test/${v}.`) || f.startsWith(`test/${v}-`)).sort();
      L.push(`| ${v} | ${named.map(code).join(', ') || 'none'} |`);
    }
    L.push('');
  }
  return L.join('\n');
}
const byKeyOf = (res, k) => res.pages.find((p) => p.key === k);

// ---- the cross-view state (kit-989; APPS.md, Cross-view state) ----
// index.html's top-level let/const/var values that a code line of another view names: each owning view keeps
// them on one object in its state.ts, since an import can't be assigned. A value that is a function, or a bare
// name (an alias of one: const layerField = tlOwn), isn't state. The router's five lines from `let ROUTED =
// false;` (8014-8018 at the port's base) are data's, by ruling (kit-989).
function declarators(rest) {
  const out = [];
  let depth = 0, i = 0, expectName = true;
  while (i < rest.length) {
    const c = rest[i];
    if ('\'"`'.includes(c)) { const q = c; i++; while (i < rest.length && rest[i] !== q) { if (rest[i] === '\\') i++; i++; } i++; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 0 && c === ',') expectName = true;
    else if (depth === 0 && c === ';') break;
    if (expectName && depth === 0 && /[A-Za-z_$]/.test(c)) {
      const m = /^([A-Za-z_$][\w$]*)\s*(=)?/.exec(rest.slice(i));
      const after = m[2] ? rest.slice(i + m[0].length) : '';
      out.push({ name: m[1], fn: /^\s*(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|^\s*(async\s+)?function\b|^\s*(?!(?:null|true|false|undefined)\b)[A-Za-z_$][\w$]*\s*(;|$)/.test(after) });
      expectName = false;
      i += m[1].length;
      continue;
    }
    i++;
  }
  return out;
}
export function stateLists(page) {
  const text = page.model.text.split('\n');
  const routed = text.indexOf('let ROUTED = false;');
  const viewAt = (ln) => (routed >= 0 && ln > routed && ln <= routed + 5 ? 'data' : page.view(ln));
  const first = text.findIndex((l, i) => i > 1500 && /^<script>/.test(l)) + 1;
  const decl = new Map();
  text.forEach((l, i) => {
    if (i < first) return;
    const m = /^(let|const|var)\s+(.+)/.exec(l);
    if (m) for (const d of declarators(m[2])) if (!d.fn && !decl.has(d.name)) decl.set(d.name, { view: viewAt(i + 1), line: i + 1 });
  });
  const used = new Map();
  text.forEach((l, i) => {
    if (i < first || /^\s*(\/\/|\/\*|\*)/.test(l)) return;
    const v = viewAt(i + 1);
    const codeOnly = l.replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
    for (const m of codeOnly.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)(?![\w$])(?!\s*:(?!:))/g)) {
      const d = decl.get(m[2]);
      if (d && d.view !== v && d.line !== i + 1) used.set(m[2], d);
    }
  });
  const out = {};
  for (const [name, d] of used) (out[d.view] ??= []).push({ name, line: d.line });
  for (const v of Object.keys(out)) out[v].sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
// a view's state file and object; the shell's page state is its `shell` object (kit-988)
export const stateFile = (view) => `apps/dashboard/src/views/${view}/state.ts`;
export const stateObject = (view) => (view === 'shell' ? 'shell' : `${view.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}State`);
// the keys of `export const <obj> … = { … }` at its own depth (comments and strings skipped)
export function objectKeys(src, obj) {
  const at = src.search(new RegExp(`^export const ${obj}\\b`, 'm'));
  if (at < 0) return null;
  let i = at, depth = 0;
  // the "=" at depth 0 (a type annotation may hold braces, and "=>")
  for (; i < src.length; i++) {
    const c = src[i];
    if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && src[i - 1] !== '=')) depth--;
    else if (c === '=' && depth === 0 && src[i + 1] !== '>') break;
  }
  i = src.indexOf('{', i) + 1;
  depth = 1;
  const keys = [];
  let start = true;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (src.startsWith('//', i)) { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (src.startsWith('/*', i)) { i = src.indexOf('*/', i) + 2; continue; }
    if ('\'"`'.includes(c)) { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; start = false; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (depth === 1 && c === ',') { start = true; i++; continue; }
    if (depth === 1 && start && /[A-Za-z_$]/.test(c)) {
      const m = /^([A-Za-z_$][\w$]*)\s*[:,}]/.exec(src.slice(i));
      if (m) keys.push(m[1]);
      start = false;
    } else if (!/\s/.test(c)) start = false;
    i++;
  }
  return keys;
}
// every name a module under apps/dashboard/src exports at its top level
function srcExports(repo) {
  const names = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/^export (?:async )?(?:function\*? ?|const |let |var )([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    }
  };
  const src = path.join(repo, 'apps', 'dashboard', 'src');
  if (fs.existsSync(src)) walk(src);
  return names;
}
// what --check finds wrong with the state files: a missing file, or a listed name its object lacks (the shell's
// names may instead be exported by its modules)
export function stateProblems(repo, lists) {
  const out = [];
  let exported = null;
  for (const [view, list] of Object.entries(lists)) {
    const rel = stateFile(view);
    const file = path.join(repo, rel);
    if (!fs.existsSync(file)) { out.push(`${rel} is missing (it holds ${list.map((x) => x.name).join(', ')})`); continue; }
    const obj = stateObject(view);
    const keys = objectKeys(fs.readFileSync(file, 'utf8'), obj);
    if (!keys) { out.push(`${rel} exports no ${obj}`); continue; }
    let lacks = list.map((x) => x.name).filter((n) => !keys.includes(n));
    if (view === 'shell' && lacks.length) { exported ??= srcExports(repo); lacks = lacks.filter((n) => !exported.has(n)); }
    if (lacks.length) out.push(`${rel}'s ${obj} lacks ${lacks.join(', ')}`);
  }
  return out;
}

// ---- the command ----
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const USAGE = 'usage: node apps/dashboard/scripts/compat-scan.mjs --base <sha> [--repo <kit>] [--check | --json | --stubs | --state [--json]]';
  const usage = (why) => { console.error(`compat-scan: ${why}\n${USAGE}`); process.exit(2); };
  // refuse what it doesn't know before anything runs: a mistyped --check must never fall through to writing
  const MODES = ['--check', '--json', '--stubs', '--state'];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' || args[i] === '--repo') { if (!args[i + 1] || args[i + 1].startsWith('--')) usage(`${args[i]} needs a value`); i++; continue; }
    if (!MODES.includes(args[i])) usage(`unknown argument ${JSON.stringify(args[i])}`);
  }
  const modes = args.filter((a) => MODES.includes(a));
  if (modes.length > 1 && !(modes.length === 2 && modes.includes('--state') && modes.includes('--json'))) usage('one of --check, --json, --stubs, --state (--state may add --json)');
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(opt('repo') ?? path.join(here, '..', '..', '..'));
  const base = opt('base');
  if (!base) usage('--base is required');
  let res;
  try {
    const sha = git(repo, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).trim();
    git(repo, ['rev-parse', '--verify', '--quiet', `${RANGES_AT}^{commit}`]);
    res = scan(repo, sha);
  } catch (e) { if (!e.usage) throw e; console.error(`compat-scan: ${e.message}`); process.exit(2); }
  if (res.unplaced.length) { console.error(`compat-scan: Chrome tests the scan can't place on a page (add each to PLACED):\n${res.unplaced.join('\n')}`); process.exit(1); }
  if (args.includes('--stubs')) {
    for (const [k, cv] of Object.entries(res.crossView)) console.log(`// ---- ${STUBS[k]} (${cv.view}): ${cv.fns.length} ----\n${stubExports(cv)}`);
    process.exit(0);
  }
  if (args.includes('--state')) {
    const lists = stateLists(byKeyOf(res, 'index'));
    if (args.includes('--json')) console.log(JSON.stringify(lists, null, 1));
    else for (const [view, list] of Object.entries(lists)) console.log(`${stateFile(view)} (${stateObject(view)}): ${list.map((x) => `${x.name} ${x.line}`).join(', ')}`);
    process.exit(0);
  }
  if (args.includes('--json')) {
    console.log(JSON.stringify({ base: res.base, crossView: res.crossView, rows: res.rows.map((r) => ({ ...r, got: Object.fromEntries(Object.entries(r.got).map(([k, v]) => [k, [...v]])), views: [...r.views] })) }, null, 1));
    process.exit(0);
  }
  let differ = 0;
  for (const app of ['dashboard', 'hub']) {
    const file = path.join(repo, 'apps', app, 'COMPAT.md');
    const text = render(res, app);
    if (args.includes('--check')) { const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null; if (have !== text) { differ = 1; console.error(`compat-scan: apps/${app}/COMPAT.md differs from the scan at ${res.base}`); } }
    else { fs.writeFileSync(file, text); console.log(`compat-scan: wrote apps/${app}/COMPAT.md`); }
  }
  if (args.includes('--check')) for (const [k, cv] of Object.entries(res.crossView)) {
    const file = path.join(repo, STUBS[k]);
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const have = text === null ? null : exportedFns(text);
    const want = cv.fns.map((f) => f.name).sort((a, b) => a.localeCompare(b));
    // a stub exports exactly these; a port exports at least these
    const ok = have && (isStub(text) ? JSON.stringify(have) === JSON.stringify(want) : want.every((n) => have.includes(n)));
    if (!ok) { differ = 1; console.error(`compat-scan: ${STUBS[k]} exports ${have ? have.join(', ') || 'no function' : 'nothing (no file)'}; the scan wants ${want.join(', ') || 'none'}`); }
  }
  if (args.includes('--check')) for (const p of stateProblems(repo, stateLists(byKeyOf(res, 'index')))) { differ = 1; console.error(`compat-scan: ${p}`); }
  process.exit(differ);
}
