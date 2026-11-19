// devteam.mjs's HELP, COMMANDS and the dashboard's route table, split into named parts (kit-322, spec
// docs/devteam/project/tickets/kit-322-devteam-mjs-regions/spec.md): each section, command group and
// route group is a part a ticket can name, and nothing the CLI or the dashboard does changes. The
// structure checks read the source through the kit's own fileParts; the behaviour checks run the
// kit in a fixture and compare help and the COMMANDS pairs with main's kit while main is unsplit.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';
import { PORTS, bareProject, dashboardOnFreePort, kit, testDir } from './lib/kit.mjs';

const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');

// The pure parts region of devteam.mjs, run on its own (as validate-parts.test.mjs does).
function partsFns() {
  const a = SRC.indexOf('/* parts start */'), b = SRC.indexOf('/* parts end */');
  assert.ok(a >= 0 && b > a, 'devteam.mjs has a /* parts */ region');
  const ctx = vm.createContext({});
  return vm.runInContext(`${SRC.slice(a, b)}\n;({ fileParts, partLeaves, leafTexts, touchPath, touchPart, partsChanged })`, ctx);
}

// JS text with its comments blanked and, unless strings is false, the insides of its strings,
// template literals (their ${} code kept) and regex literals too. Every other character, and every
// newline, stays where it was, so offsets into the blanked text are offsets into the source.
const REGEX_AFTER = '(,=:[!&|?{};+-*%<>~^';
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new', 'else', 'do', 'yield', 'await', 'instanceof']);
function blank(src, { strings = true } = {}) {
  const o = src.split('');
  const n = src.length;
  const sp = (a, b) => { for (let k = a; k < b && k < n; k++) if (o[k] !== '\n') o[k] = ' '; };
  // a template's text from start: to its ${ (open) or its closing backtick
  const template = (start) => {
    for (let k = start; k < n;) {
      if (src[k] === '\\') { k += 2; continue; }
      if (src[k] === '`') { if (strings) sp(start, k); return { end: k + 1, open: false }; }
      if (src[k] === '$' && src[k + 1] === '{') { if (strings) sp(start, k); return { end: k + 2, open: true }; }
      k++;
    }
    if (strings) sp(start, n);
    return { end: n, open: false };
  };
  const tpl = []; // the brace depth at each open ${
  let depth = 0, last = '', word = '', i = 0;
  const afterTemplate = (r) => { i = r.end; if (r.open) { tpl.push(depth); depth++; last = '{'; } else last = 'x'; word = ''; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; sp(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; sp(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      if (strings) sp(i + 1, k);
      i = k + 1; last = 'x'; word = '';
      continue;
    }
    if (c === '`') { afterTemplate(template(i + 1)); continue; }
    if (c === '{') { depth++; last = c; word = ''; i++; continue; }
    if (c === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); afterTemplate(template(i + 1)); continue; }
      last = c; word = ''; i++;
      continue;
    }
    if (c === '/' && (last === '' || REGEX_AFTER.includes(last) || REGEX_WORDS.has(word))) {
      let k = i + 1, cls = false;
      while (k < n && src[k] !== '\n') {
        if (src[k] === '\\') { k += 2; continue; }
        if (cls) { if (src[k] === ']') cls = false; } else if (src[k] === '[') cls = true; else if (src[k] === '/') break;
        k++;
      }
      if (strings) sp(i + 1, k);
      k++;
      while (k < n && /[a-z]/i.test(src[k])) k++;
      i = k; last = 'x'; word = '';
      continue;
    }
    if (/[\w$]/.test(c)) { let k = i; while (k < n && /[\w$]/.test(src[k])) k++; word = src.slice(i, k); last = 'x'; i = k; continue; }
    if (!/\s/.test(c)) { last = c; word = ''; }
    i++;
  }
  return o.join('');
}
const CODE = blank(SRC); // comments, strings, templates and regexes blanked
const NOCOMMENT = blank(SRC, { strings: false }); // comments blanked

// A column-0 declaration's text: from its line to the column-0 `}` (or `};` / `];`) that closes it.
function declSpan(text, re) {
  const m = re.exec(text);
  if (!m) return null;
  const from = m.index;
  const close = /\n[}\]];?\n/g;
  close.lastIndex = from;
  const c = close.exec(text);
  return { from, to: c ? c.index + c[0].length - 1 : text.length, name: m[1] };
}
// The index of the brace that closes the one at code[at], in blanked code.
function braceEnd(code, at) {
  let d = 0;
  for (let k = at; k < code.length; k++) {
    if ('([{'.includes(code[k])) d++;
    else if (')]}'.includes(code[k]) && --d === 0) return k;
  }
  return code.length;
}
const cmdSpan = () => {
  const s = declSpan(SRC, /^async function (cmdDashboard)\(/m);
  assert.ok(s, 'devteam.mjs declares async function cmdDashboard');
  return s;
};

// [key, handler text] from the COMMANDS table: from /* commandGroups start */ when there is one,
// else from `const COMMANDS = {`, up to the `};` that ends COMMANDS, directly above /* dispatch start */.
function commandPairs(text) {
  const g = text.indexOf('/* commandGroups start */');
  const a = g >= 0 ? g : text.indexOf('const COMMANDS = {');
  const b = text.indexOf('\n};\n/* dispatch start */', a);
  assert.ok(a >= 0 && b > a, 'COMMANDS ends directly above /* dispatch start */');
  const table = blank(text.slice(a, b + 3), { strings: false });
  const pairs = [];
  for (const m of table.matchAll(/(?:^\s*|,\s*)(?:'([\w-]+)'|([A-Za-z]\w*)):\s/gm)) {
    let k = m.index + m[0].length, d = 0;
    const from = k;
    for (; k < table.length; k++) {
      const c = table[k];
      if (c === '\n') break;
      if ('([{'.includes(c)) d++;
      else if (')]}'.includes(c)) { if (d === 0) break; d--; } else if (c === ',' && d === 0) break;
    }
    pairs.push([m[1] || m[2], table.slice(from, k).trim()]);
  }
  return pairs;
}

// The names cmdDashboard declares at its own level, and those it destructures from dashboardActions().
function cmdLocals() {
  const { from, to } = cmdSpan();
  const names = new Set();
  for (const l of NOCOMMENT.slice(from, to).split('\n')) {
    let m = /^ {2}(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(l);
    if (m) names.add(m[1]);
    m = /^ {2}(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(l);
    if (m) names.add(m[1]);
    m = /^ {2}(?:const|let)\s*\{([^}]*)\}\s*=\s*dashboardActions\(\)/.exec(l);
    if (m) for (const x of m[1].split(',')) { const v = x.split(':').pop().split('=')[0].trim(); if (v) names.add(v); }
  }
  return names;
}

// The fixture: a bare project in its own temp base, HOME there, the hub and port base moved to this
// file's ports, every other DEVTEAM_* but DEVTEAM_BOX gone, and no tmux of the caller's.
function fixture(t, name = 'regions') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-regions-${name}-`));
  const env = { ...process.env, HOME: base, DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  for (const k of Object.keys(env)) if (k.startsWith('DEVTEAM_') && !['DEVTEAM_HUB_PORT', 'DEVTEAM_PORT_BASE', 'DEVTEAM_BOX'].includes(k)) delete env[k];
  for (const k of ['TMUX', 'TMUX_PANE']) delete env[k];
  const stops = [];
  t.after(async () => {
    for (const s of stops.reverse()) await s();
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const root = bareProject(base, name);
  return { base, root, env, later: (f) => stops.push(f) };
}
const dt = (root, env, args, script = path.join(root, 'docs/devteam/scripts/devteam.mjs')) => spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: 'utf8', timeout: 120000 });

// main's kit (docs/devteam at origin/main), extracted once into a private temp dir; or why not.
let mainMemo = null;
let mainTmp = null;
after(() => { if (mainTmp) fs.rmSync(mainTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
function mainKit() {
  if (mainMemo) return mainMemo;
  const tmp = (mainTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-regions-main-')));
  const repo = path.resolve(testDir, '..');
  try {
    const tar = path.join(tmp, 'main.tar');
    execFileSync('git', ['archive', '--format=tar', '-o', tar, 'origin/main', 'docs/devteam'], { cwd: repo, stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 });
    fs.mkdirSync(path.join(tmp, 'x'));
    execFileSync('tar', ['-xf', tar, '-C', path.join(tmp, 'x')], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 });
  } catch {
    return (mainMemo = { skip: 'origin/main not readable' });
  }
  const script = path.join(tmp, 'x', 'docs', 'devteam', 'scripts', 'devteam.mjs');
  if (!fs.existsSync(script)) return (mainMemo = { skip: 'origin/main not readable' });
  const text = fs.readFileSync(script, 'utf8');
  if (text.includes('/* helpSections start */')) return (mainMemo = { skip: 'main already split' });
  return (mainMemo = { script, text });
}

const HEADINGS = ['Setup and roles', 'Holds and the fleet', 'The graph', 'Checks and merging', 'Sessions', 'Decide and act', 'Observe and orient', 'Goals and retros', 'The log', 'Dashboard and releases'];
const TOP = 'devteam <command>   (positionals before flags; flags take the words after them)';
const headingLine = (h) => new RegExp(`^${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: \\(.*\\))?$`);

test('A1: help prints the top line, the ten sections in order, and ends as before', (t) => {
  const F = fixture(t, 'help');
  const r = dt(F.root, F.env, ['help']);
  assert.equal(r.status, 0, r.stderr);
  const outText = r.stdout;
  const lines = outText.split('\n');
  assert.equal(lines[0], TOP, 'the first line is the top line');
  assert.equal(lines[1], '', 'a blank line under the top line');
  let prev = -1;
  for (const h of HEADINGS) {
    const at = lines.flatMap((l, i) => (headingLine(h).test(l) ? [i] : []));
    assert.equal(at.length, 1, `heading ${h} once`);
    assert.ok(at[0] > prev, `heading ${h} in order`);
    assert.ok(lines[at[0] - 1] === '' && lines[at[0] - 2] !== '', `heading ${h} after exactly one blank line`);
    prev = at[0];
  }
  assert.ok(!outText.includes('\n\n\n'), 'no run of two blank lines');
  assert.match(outText, /\n {2}hub \[--release vX\.Y\.Z\][^\n]*\n\n$/, 'ends with the hub line, then HELP\'s newline and out\'s');
});

test('A2: HELP is built from one HELP_* const per section, in helpSections, joined in region order', () => {
  const { fileParts, partLeaves } = partsFns();
  const P = fileParts(SRC, 'devteam.mjs');
  assert.ok(P.places.has('helpSections'), 'devteam.mjs has a helpSections region');
  const inRegion = partLeaves(P, 'helpSections');
  const consts = [];
  P.lines.forEach((l, i) => { const m = /^const (HELP_\w+)\s*=/.exec(l); if (m) consts.push({ name: m[1], line: i + 1 }); });
  assert.ok(consts.length, 'devteam.mjs declares HELP_* consts');
  for (const c of consts) {
    assert.match(P.owner[c.line], new RegExp(`^d:.*${c.name}#\\d+$`), `${c.name} is its own leaf`);
    assert.ok(inRegion.has(P.owner[c.line]), `${c.name} inside helpSections`);
  }
  const h = declSpan(SRC, /^const (HELP) = `/m);
  assert.ok(h, 'devteam.mjs declares const HELP');
  const helpText = SRC.slice(h.from, SRC.indexOf('`;\n', h.from + 1) + 2);
  const joins = [...helpText.matchAll(/\$\{\[([^\]]*)\]\.join\('\\n\\n'\)\}/g)];
  assert.equal(joins.length, 1, "HELP has one [ … ].join('\\n\\n')");
  assert.deepEqual(joins[0][1].split(',').map((s) => s.trim()).filter(Boolean), consts.map((c) => c.name), 'the join names every HELP_* const, in region order');
  for (const c of consts) assert.equal(helpText.split(new RegExp(`\\b${c.name}\\b`)).length - 1, 1, `HELP names ${c.name} once`);
});

test('A3: help is byte-for-byte main\'s', (t) => {
  const M = mainKit();
  if (M.skip) return t.skip(M.skip);
  const F = fixture(t, 'help-main');
  const now = dt(F.root, F.env, ['help']);
  const was = dt(F.root, F.env, ['help'], M.script);
  assert.equal(now.status, 0, now.stderr);
  assert.equal(was.status, 0, was.stderr);
  assert.equal(now.stdout, was.stdout);
});

test('A4: COMMANDS is spread from one COMMANDS_* const per group, in commandGroups', () => {
  const { fileParts, partLeaves } = partsFns();
  const P = fileParts(SRC, 'devteam.mjs');
  assert.ok(P.places.has('commandGroups'), 'devteam.mjs has a commandGroups region');
  const inRegion = partLeaves(P, 'commandGroups');
  const consts = [];
  P.lines.forEach((l, i) => { const m = /^const (COMMANDS_\w+)\s*=/.exec(l); if (m) consts.push({ name: m[1], line: i + 1 }); });
  assert.ok(consts.length, 'devteam.mjs declares COMMANDS_* consts');
  for (const c of consts) {
    assert.match(P.owner[c.line], new RegExp(`^d:.*${c.name}#\\d+$`), `${c.name} is its own leaf`);
    assert.ok(inRegion.has(P.owner[c.line]), `${c.name} inside commandGroups`);
  }
  const a = SRC.indexOf('const COMMANDS = {'), b = SRC.indexOf('\n};\n/* dispatch start */', a);
  assert.ok(a >= 0 && b > a, 'COMMANDS ends directly above /* dispatch start */');
  const body = NOCOMMENT.slice(a + 'const COMMANDS = {'.length, b + 1).split(',').map((s) => s.trim()).filter(Boolean);
  for (const s of body) assert.match(s, /^\.\.\.COMMANDS_\w+$/, `COMMANDS holds only spreads (${s.slice(0, 60)})`);
  assert.deepEqual(body.map((s) => s.slice(3)), consts.map((c) => c.name), 'COMMANDS spreads each group once, in region order');
  // the pairs of each group, and whose they are
  const where = new Map();
  for (const c of consts) {
    const open = CODE.indexOf('{', P.lines.slice(0, c.line - 1).reduce((x, l) => x + l.length + 1, 0));
    const inner = SRC.slice(open + 1, braceEnd(CODE, open));
    for (const [k, h] of commandPairs(`const COMMANDS = {\n${inner}\n};\n/* dispatch start */`)) {
      assert.ok(!where.has(k), `${k} in two groups (${where.get(k)} and ${c.name})`);
      where.set(k, c.name);
      if (/^\(\) => makeSession\('(worker|planner)'\)$/.test(h)) continue;
      assert.match(h, /^cmd\w+$/, `${k}'s handler is a cmd function or makeSession`);
      // a function, or a const one (cmdDashboardData is `const cmdDashboardData = () => {`)
      assert.match(SRC, new RegExp(`^(?:(?:async )?function ${h}\\(|const ${h} = (?:async )?\\()`, 'm'), `${k}'s handler ${h} is a function devteam.mjs declares`);
    }
  }
  assert.ok(where.size, 'the groups hold commands');
});

test('A5: the COMMANDS pairs are main\'s, in main\'s order', (t) => {
  const M = mainKit();
  if (M.skip) return t.skip(M.skip);
  const was = commandPairs(M.text);
  assert.ok(was.length > 50, 'main has its COMMANDS pairs');
  assert.deepEqual(commandPairs(SRC), was);
});

test('A6: dispatch: an unknown command, whoami and ready', (t) => {
  const F = fixture(t, 'dispatch');
  const no = dt(F.root, F.env, ['no-such-command']);
  assert.equal(no.status, 1, no.stderr);
  assert.ok(no.stderr.startsWith('devteam: unknown command "no-such-command"'), no.stderr.slice(0, 200));
  for (const c of ['whoami', 'ready']) {
    const r = dt(F.root, F.env, [c]);
    assert.equal(r.status, 0, `${c}: ${r.stderr.slice(0, 400)}`);
  }
});

// The names a body declares itself (they shadow cmdDashboard's).
function ownNames(code) {
  const s = new Set();
  const add = (list) => { for (const x of list.split(',')) { const v = x.split(':').pop().split('=')[0].replace(/[{}[\].\s]/g, ''); if (/^[A-Za-z_$][\w$]*$/.test(v)) s.add(v); } };
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]=]*)[}\]]\s*=/g)) add(m[1]);
  for (const m of code.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) { if (m[1]) s.add(m[1]); add(m[2]); }
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of code.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) s.add(m[1]);
  for (const m of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  return s;
}
// The keys of the object literal that starts at text[at] ('{'), in blanked code.
function objectKeys(code, at) {
  let d = 0, k = at, start = at + 1;
  const parts = [];
  for (; k < code.length; k++) {
    const c = code[k];
    if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) { d--; if (d === 0) { parts.push(code.slice(start, k)); break; } } else if (c === ',' && d === 1) { parts.push(code.slice(start, k)); start = k + 1; }
  }
  const keys = new Set();
  for (const p of parts) {
    const m = /^\s*(?:(?:get|set|async)\s+)?([A-Za-z_$][\w$]*)\s*(?:[:(,]|$)/.exec(p);
    if (m && !/^\s*\.\.\./.test(p)) keys.add(m[1]);
  }
  return keys;
}
const D_STATE = ['port', 'lastData', 'dataEpoch', 'paneAnswering'];

test('A8: the routes live in dashRoutes* groups, which read cmdDashboard\'s state only through D', () => {
  const { fileParts, partLeaves } = partsFns();
  const P = fileParts(SRC, 'devteam.mjs');
  assert.ok(P.places.has('dashboardRoutes'), 'devteam.mjs has a dashboardRoutes region');
  const inRegion = partLeaves(P, 'dashboardRoutes');
  const groups = [];
  P.lines.forEach((l, i) => { const m = /^async function (dashRoutes\w+)\(/.exec(l); if (m) groups.push({ name: m[1], line: i + 1 }); });
  assert.ok(groups.length, 'devteam.mjs declares async function dashRoutes* groups');
  for (const g of groups) assert.ok(inRegion.has(P.owner[g.line]) && P.owner[g.line].endsWith(`${g.name}#1`), `${g.name} is a leaf in dashboardRoutes`);
  const R = declSpan(SRC, /^const (DASHBOARD_ROUTES) = \[/m);
  assert.ok(R, 'devteam.mjs declares const DASHBOARD_ROUTES');
  const listed = CODE.slice(SRC.indexOf('[', R.from) + 1, CODE.indexOf(']', R.from)).split(',').map((s) => s.trim()).filter(Boolean);
  for (const g of groups) assert.equal(listed.filter((x) => x === g.name).length, 1, `${g.name} once in DASHBOARD_ROUTES`);
  assert.equal(listed.at(-1), 'dashRoutesOwner', 'dashRoutesOwner last in DASHBOARD_ROUTES');
  // the request handler: global guards only
  const C = cmdSpan();
  const cmd = SRC.slice(C.from, C.to);
  const ha = SRC.indexOf('const server = http.createServer(', C.from), hb = SRC.indexOf('server.listen(port, host)', ha);
  assert.ok(ha > 0 && hb > ha && hb < C.to, 'cmdDashboard has its request handler');
  const handler = SRC.slice(ha, hb);
  assert.ok(!handler.includes('u.pathname ==='), 'the request handler has no u.pathname === route');
  const paths = [...handler.matchAll(/(['"`])(\/[^'"`\n]*)\1/g)].map((m) => m[2]).filter((p) => !['/api/term/', '/presence', '/upload'].some((ok) => p.startsWith(ok)));
  assert.deepEqual(paths, [], 'the request handler has no path literal but /api/term/, /presence and /upload');
  assert.ok(!/\/\^\\\//.test(handler), 'the request handler has no path regex');
  assert.ok(!cmd.includes('ACTIONS = {'), 'cmdDashboard has no ACTIONS = {');
  // each group's use of cmdDashboard's locals
  const locals = cmdLocals();
  const dc = CODE.indexOf('dashContext(', C.from);
  assert.ok(dc > 0 && dc < C.to, 'cmdDashboard passes an object to dashContext(');
  const dKeys = objectKeys(CODE, CODE.indexOf('{', dc));
  for (const g of groups) {
    const s = declSpan(CODE, new RegExp(`^async function (${g.name})\\(`, 'm'));
    const body = CODE.slice(SRC.indexOf('{', s.from) + 1, s.to).replace(/\.\.\./g, '   ');
    const fromD = new Set();
    let uses = body;
    for (const m of body.matchAll(/\b(?:const|let)\s*\{([^}]*)\}\s*=\s*D\s*;/g)) {
      for (const x of m[1].split(',')) { const v = x.trim(); if (v) fromD.add(v); }
      uses = uses.slice(0, m.index) + ' '.repeat(m[0].length) + uses.slice(m.index + m[0].length);
    }
    for (const v of fromD) {
      assert.ok(!D_STATE.includes(v), `${g.name} reads ${v} as D.${v}, not destructured`);
      assert.ok(dKeys.has(v), `${g.name} destructures ${v}, which cmdDashboard passes to dashContext`);
    }
    const own = ownNames(uses);
    // its parameters (D, req, res, q) are its own too: cmdDashboard's `const D` is another binding
    for (const p of CODE.slice(s.from, SRC.indexOf('{', s.from)).replace(/^[^(]*\(/, '').replace(/\)[^)]*$/, '').split(',')) if (p.trim()) own.add(p.trim());
    for (const m of uses.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const name = m[0];
      if (!locals.has(name) || own.has(name)) continue;
      const before = uses.slice(0, m.index).replace(/\s+$/, '');
      const prevCh = before.at(-1), prevCh2 = uses[m.index - 1];
      if (prevCh2 && /[\w$]/.test(prevCh2)) continue;
      if (prevCh === '.') continue; // a property (D.port, R.port), not the local
      const next = uses.slice(m.index + name.length).replace(/^\s+/, '');
      if ((prevCh === '{' || prevCh === ',') && next[0] === ':' && next[1] !== ':') continue; // an object key
      if (D_STATE.includes(name)) assert.fail(`${g.name} uses ${name} outside D`);
      assert.ok(fromD.has(name), `${g.name} uses ${name}, which it doesn't destructure from D`);
    }
  }
  // dashContext alone: a name it wasn't given throws; then and a symbol fall through
  const dcx = declSpan(SRC, /^function (dashContext)\(/m);
  assert.ok(dcx, 'devteam.mjs declares function dashContext');
  const dashContext = vm.runInContext(`${SRC.slice(dcx.from, dcx.to)}\n;dashContext`, vm.createContext({}));
  const Dx = dashContext({ a: 1 });
  assert.equal(Dx.a, 1);
  assert.throws(() => Dx.x, /dashboard route context has no x/);
  assert.doesNotThrow(() => Dx.then);
  assert.doesNotThrow(() => Dx[Symbol.iterator]);
});

test('A9: a request through each route group answers as before, and the dashboard lives on', async (t) => {
  const F = fixture(t, 'routes');
  const { dash, port } = await dashboardOnFreePort(F.root, F.env);
  F.later(() => dash.stop());
  const at = `http://127.0.0.1:${port}`;
  const get = (p) => fetch(`${at}${p}`, { redirect: 'manual' });
  let r = await get('/api/hello');
  assert.equal(r.status, 200, '/api/hello');
  assert.equal((await r.json()).devteam, 1, '/api/hello says devteam: 1');
  r = await get('/');
  assert.equal(r.status, 200, '/');
  assert.match(r.headers.get('content-security-policy') ?? '', /frame-src 'self'.*frame-ancestors 'self'/, '/ has the page CSP');
  await r.arrayBuffer();
  r = await get('/api/data');
  assert.equal(r.status, 200, '/api/data');
  assert.ok(r.headers.has('x-devteam-page'), '/api/data has x-devteam-page');
  await r.json();
  for (const [p, code] of [
    ['/view/artifact/BAD!', 404],
    ['/api/view?kind=x', 400],
    ['/api/threads', 200],
    ['/api/record?id=BAD!', 400],
    ['/api/schema', 200],
    ['/api/file?path=../x', 400],
    ['/public-manifest/BAD!', 404],
    ['/artifact/main/BAD!/', 404],
    ['/review/nope/', 404],
  ]) {
    r = await get(p);
    assert.equal(r.status, code, `GET ${p}`);
    await r.arrayBuffer();
  }
  r = await get('/upload/x');
  assert.equal(r.status, 404, 'GET /upload/x');
  assert.equal((await r.text()).trim(), 'not found', 'GET /upload/x says not found');
  r = await fetch(`${at}/api/no-such`, { method: 'POST', headers: { origin: at, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 404, 'POST /api/no-such');
  await r.arrayBuffer();
  r = await fetch(`${at}/api/answer`, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403, 'POST /api/answer from another origin');
  await r.arrayBuffer();
  assert.doesNotThrow(() => process.kill(dash.p.pid, 0), 'the dashboard is still running');
});

const A11 = [
  'helpSections', 'commandGroups', 'dashboardRoutes',
  'HELP_SETUP', 'HELP_HOLDS', 'HELP_GRAPH', 'HELP_CHECKS', 'HELP_SESSIONS', 'HELP_DECIDE', 'HELP_OBSERVE', 'HELP_GOALS', 'HELP_LOG', 'HELP_DASHBOARD',
  'COMMANDS_SETUP', 'COMMANDS_GRAPH', 'COMMANDS_CHECKS', 'COMMANDS_SESSIONS', 'COMMANDS_DECIDE', 'COMMANDS_OBSERVE', 'COMMANDS_GOALS', 'COMMANDS_LOG', 'COMMANDS_HOLDS', 'COMMANDS_DASHBOARD',
  'DASH_NEXT', 'dashContext', 'dashboardActions',
  'dashRoutesUpload', 'dashRoutesPage', 'dashRoutesViewer', 'dashRoutesThreads', 'dashRoutesReads', 'dashRoutesFiles', 'dashRoutesArtifacts', 'dashRoutesReviewPage', 'dashRoutesOwner',
  'DASHBOARD_ROUTES',
];

test('A11: the parts reader lists every part kit-322 adds', () => {
  const { fileParts } = partsFns();
  const P = fileParts(SRC, 'devteam.mjs');
  const missing = A11.filter((n) => !P.places.has(n));
  for (const r of ['HELP', 'cmdDashboard']) if (!P.regions.some((x) => x.name === r)) missing.push(`region ${r}`);
  assert.deepEqual(missing, [], `${missing[0]} is a part (missing: ${missing.join(', ')})`);
});
