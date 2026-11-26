// The load-time overlay (cutover-tree@1, the design's cli-modules@1 rules): nothing cross-module runs
// while the CLI's modules load. Rules, in order:
//   entry    every fileURLToPath(import.meta.url) in a module becomes ENTRY, the CLI's entry file,
//            which lib/state.mjs exports (path.dirname of it, the scripts folder, likewise)
//   init     every top-level statement but the dispatch, and every declaration whose initializer does
//            load-time work, moves into init() in lib/state.mjs, in source order: a declaration keeps
//            its name as an `export let` there that only init assigns. Load-time work is the design's
//            named values (argv and its flags, REPLY_FD, the locations) and, to a fixed point, anything
//            whose initializer reads one of them or reaches into another module at load
//   dispatch the dispatch region's statements become `export function dispatch()`, and the entry
//            awaits init() then calls dispatch() after importing every module
//   setters  a top-level let assigned from another module gets a setter beside it, and each such
//            assignment calls it
// The check `load-time` then refuses any initializer or statement that, while its module loads, calls
// an imported function or reads an imported const, let or class, directly or through a function of its
// own module it calls; referencing an imported function declaration (as the COMMANDS tables do) is
// allowed.
import { spawnSync } from 'node:child_process';
import { items } from '../../lib/js.mjs';
import { readModule } from '../../lib/verify.mjs';

export const LIB = 'docs/devteam/scripts/lib';
export const ENTRY_FILE = 'docs/devteam/scripts/cli.mjs';

// ---- a small reading of blanked code (comments, strings and regexes blanked by js.mjs) ----
const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set([')', ']', '}']);
// a function passed to one of these runs now
const NOW = new Set(['map', 'filter', 'forEach', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap', 'sort', 'toSorted', 'from', 'replace', 'replaceAll', 'fromEntries']);
const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'function', 'typeof', 'await', 'new', 'in', 'of', 'do', 'else', 'try', 'finally']);
const prevNon = (c, i) => { let k = i; while (k >= 0 && /\s/.test(c[k])) k--; return k; };
const nextNon = (c, i) => { let k = i; while (k < c.length && /\s/.test(c[k])) k++; return k; };
export function match(c, i) {
  const st = [];
  for (let k = i; k < c.length; k++) {
    if (OPEN[c[k]]) st.push(OPEN[c[k]]);
    else if (CLOSE.has(c[k])) { if (st.pop() !== c[k]) return -1; if (!st.length) return k; }
  }
  return -1;
}
function matchBack(c, i) {
  const want = { ')': '(', ']': '[', '}': '{' };
  const st = [];
  for (let k = i; k >= 0; k--) {
    if (CLOSE.has(c[k])) st.push(want[c[k]]);
    else if (OPEN[c[k]]) { if (st.pop() !== c[k]) return -1; if (!st.length) return k; }
  }
  return -1;
}
// the ( [ or { that encloses i, or -1
function enclosing(c, i) {
  let d = 0;
  for (let k = i; k >= 0; k--) { if (CLOSE.has(c[k])) d++; else if (OPEN[c[k]]) { if (!d) return k; d--; } }
  return -1;
}
// where an expression starting at i ends: a comma, a semicolon or a closer at its own depth, or the
// end of a line at its own depth whose next line starts a new statement
export function exprEnd(c, i) {
  let d = 0;
  for (let k = i; k < c.length; k++) {
    const x = c[k];
    if (OPEN[x]) d++;
    else if (CLOSE.has(x)) { if (!d) return k; d--; }
    else if (!d && (x === ',' || x === ';')) return k;
    else if (!d && x === '\n') {
      const n = nextNon(c, k + 1);
      if (n >= c.length || !/^[.?:+\-*/%&|^=<>]/.test(c.slice(n)) && !/[=+\-*/%&|^<>?:,(\[{]\s*$/.test(c.slice(0, k))) return k;
    }
  }
  return c.length;
}
// every function in c: arrows, function expressions or declarations, and methods: [{ start, end, body }]
export function functions(c) {
  const out = [];
  for (let i = c.indexOf('=>'); i >= 0; i = c.indexOf('=>', i + 2)) {
    const p = prevNon(c, i - 1);
    let start;
    if (c[p] === ')') { start = matchBack(c, p); if (start < 0) continue; } else { let k = p; while (k >= 0 && /[\w$]/.test(c[k])) k--; start = k + 1; }
    const a = prevNon(c, start - 1);
    if (a >= 4 && c.slice(a - 4, a + 1) === 'async' && !/[\w$]/.test(c[a - 5] ?? '')) start = a - 4;
    const b = nextNon(c, i + 2);
    const end = c[b] === '{' ? match(c, b) + 1 : exprEnd(c, b);
    if (end > 0) out.push({ start, end, body: b });
  }
  for (const m of c.matchAll(/(?<![\w$])(?:async\s+)?function(?![\w$])\s*\*?\s*[\w$]*\s*\(/g)) {
    const po = m.index + m[0].length - 1, pc = match(c, po);
    const b = pc < 0 ? -1 : nextNon(c, pc + 1);
    if (b >= 0 && c[b] === '{') out.push({ start: m.index, end: match(c, b) + 1, body: b });
  }
  for (const m of c.matchAll(/(?<![\w$.])((?:(?:async|get|set|static)\s+)*\*?\s*([\w$]+))\s*\(/g)) {
    if (NOT_METHOD.has(m[2])) continue;
    const at = m.index + m[0].indexOf(m[1]);
    const before = prevNon(c, at - 1);
    if (before >= 0 && !['{', ',', '}', ';'].includes(c[before])) continue; // a call
    const po = m.index + m[0].length - 1, pc = match(c, po);
    const b = pc < 0 ? -1 : nextNon(c, pc + 1);
    if (b >= 0 && c[b] === '{') out.push({ start: at, end: match(c, b) + 1, body: b });
  }
  return out;
}
function runsNow(c, f) {
  const a = prevNon(c, f.start - 1), z = nextNon(c, f.end);
  if (c[a] === '(' && c[z] === ')' && c[nextNon(c, z + 1)] === '(') return true; // (() => …)()
  if (c[a] === '(' || c[a] === ',') {
    const o = c[a] === '(' ? a : enclosing(c, a);
    if (o > 0 && c[o] === '(') { const w = c.slice(0, o).match(/([\w$]+)\s*$/); if (w && NOW.has(w[1])) return true; }
  }
  return false;
}
// c with every function body that does not run now blanked (its parameters too: defaults run later)
export function executed(c) {
  const o = c.split('');
  for (const f of functions(c).sort((x, y) => x.start - y.start || y.end - x.end)) {
    if (runsNow(c, f)) continue;
    for (let k = f.start; k < f.end; k++) if (o[k] !== '\n') o[k] = ' ';
  }
  return o.join('');
}
// the names c mentions (not after a single dot), each with whether it is called
export function mentions(c) {
  const out = [];
  for (const x of c.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (c[x.index - 1] === '.' && c[x.index - 2] !== '.') continue;
    if (/^\s*:/.test(c.slice(x.index + x[0].length, x.index + x[0].length + 3)) && /[{,]\s*$/.test(c.slice(Math.max(0, x.index - 40), x.index))) continue; // a key in an object literal
    const after = c.slice(x.index + x[0].length, x.index + x[0].length + 4);
    out.push({ name: x[0], call: /^\s*(\(|\?\.\(|`)/.test(after) || /(?<![\w$])new\s+$/.test(c.slice(Math.max(0, x.index - 5), x.index)), at: x.index });
  }
  return out;
}
// the names a run of code declares itself (parameters, locals): a mention of one is not the module's
const LOCAL = /(?<![\w$.])(?:const|let|var|function|class)\s+([\w$]+)|(?<![\w$.])(?:const|let|var)\s*[{[]([^=]*?)[}\]]\s*=|\(([^()]*)\)\s*=>|([\w$]+)\s*=>|function\s*[\w$]*\s*\(([^)]*)\)|catch\s*\(\s*([\w$]+)/g;
export function locals(c) {
  const out = new Set();
  // a pattern's or a parameter list's names: its defaults and its keys (a: b names b) are not
  const names = (g) => g.replace(/=[^,{}[\]]*/g, '').replace(/[\w$]+\s*:/g, '').matchAll(/[A-Za-z_$][\w$]*/g);
  for (const m of c.matchAll(LOCAL)) for (const g of m.slice(1)) if (g) for (const n of names(g)) out.add(n[0]);
  // a function declaration's or a method's parameters
  for (const m of c.matchAll(/(?:function\s*[\w$]*|(?<![\w$.])(?!if|for|while|switch|catch|return)[\w$]+)\s*\(([^()]*)\)\s*\{/g)) for (const n of names(m[1])) out.add(n[0]);
  // the later names of a declarator list: const a = 1, b = f(x), { c } = o;
  for (const m of c.matchAll(/(?<![\w$.])(?:const|let|var)\s+/g)) {
    let k = m.index + m[0].length;
    for (let guard = 0; guard < 50; guard++) {
      const eq = c.slice(k).search(/[=,;\n]/);
      if (eq < 0 || c[k + eq] !== '=') break;
      const e = exprEnd(c, k + eq + 1);
      if (c[e] !== ',') break;
      const next = c.slice(e + 1).match(/^\s*([A-Za-z_$][\w$]*|[{[][^=]*?[}\]])\s*=/);
      if (!next) break;
      for (const n of names(next[1])) out.add(n[0]);
      k = e + 1;
    }
  }
  return out;
}

// ---- the modules, read ----
// Each module: { file, T (items of its body), units: what runs at load, decls }. A unit is a
// declaration's initializer that is no function, or the statements in an item after its declaration.
export function readModules(list) {
  const mods = [];
  for (const { file, text } of list) {
    const { region, body } = readModule(text);
    const off = region ? region.length + 2 : 0;
    const T = items(body.length ? `${body.join('\n')}\n` : '');
    const m = { file, text, region, off, T, body, units: [], decls: new Map() };
    for (const [idx, it] of T.items.entries()) {
      const stm = T.statements.filter((s) => s.item === it).map((s) => s.line);
      // a statement takes the comment lines directly above it
      let tail = stm.length ? stm[0] : null;
      if (tail !== null) while (tail - 1 > (it.kind === 'decl' ? it.line : it.from) && /^\s*(\/\/|\/\*|\*)/.test(T.lines[tail - 2])) tail--;
      const declEnd = tail !== null ? tail - 1 : it.to;
      const u = { mod: m, idx, it, tail, declEnd };
      if (tail !== null) m.units.push({ ...u, kind: 'statements', name: `statements after ${it.kind === 'decl' ? it.names.join(',') : it.names[0]}`, code: T.codeLines.slice(tail - 1, it.to).join('\n'), from: tail, to: it.to });
      if (it.kind !== 'decl') continue;
      const code = T.codeLines.slice(it.line - 1, declEnd).join('\n').replace(/^export\s+/, '');
      let fn = null, init = null;
      if (it.decl === 'function') { const f = functions(code).sort((a, b) => a.start - b.start)[0]; fn = f ? code.slice(f.body, f.end) : ''; }
      else if (it.decl === 'class') init = '';
      else {
        const eq = code.match(/^(?:const|let|var)\s+[\w$]+\s*=\s*/);
        if (eq) {
          const after = code.slice(eq[0].length);
          const f = functions(after).filter((x) => /^\s*(async\s*)?$/.test(after.slice(0, x.start))).sort((a, b) => b.end - a.end)[0];
          if (f && /^[\s;]*$/.test(after.slice(f.end))) fn = after.slice(f.body, f.end);
        }
        if (fn === null) init = code;
      }
      const d = { ...u, kind: it.decl, names: it.names, fn, init, code };
      for (const n of it.names) m.decls.set(n, d);
      if (init) m.units.push({ ...d, kind: 'init', name: it.names.join(','), code: init, from: it.from, to: declEnd });
    }
    mods.push(m);
  }
  return mods;
}

// The problems of one unit, with names placed by owner (name -> file) and `late` the names only
// init assigns: [why]. It reads through every function of its own module it calls.
export function unitProblems(u, owner, declOf, late = new Set()) {
  const why = [];
  const seen = new Set();
  const visit = (code, file, via) => {
    const own = locals(code);
    for (const { name, call } of mentions(executed(code))) {
      if (own.has(name) || !owner.has(name)) continue;
      const at = owner.get(name);
      const d = declOf(name);
      const isFn = d?.kind === 'function';
      if (at !== file) {
        if (call) why.push(`calls ${name}, imported from ${at}${via}`);
        else if (!isFn) why.push(`reads ${d?.kind ?? 'binding'} ${name}, imported from ${at}${via}`);
      } else if (late.has(name)) why.push(`reads ${name}, which only init assigns${via}`);
      else if (call && d && (d.fn !== null || d.init) && !seen.has(name)) { seen.add(name); visit(d.fn ?? d.init, file, `${via} (through ${name})`); }
    }
  };
  visit(u.code, u.mod.file, '');
  return [...new Set(why)];
}
// What a unit does by itself that only init may do, in its own code or through a function of its own
// module it calls: read process.argv, print, exit, spawn, or write a file. The first
// such thing found, or null. (Blanked code: a string or comment never matches.)
export const WORK = /(?<![\w$])process\s*\.\s*(?:argv|stdout|stderr|exit)\b|(?<![\w$])console\s*\.|(?<![\w$.])(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(|(?<![\w$])fs\s*\.\s*(?:write|append|mkdir|mkdtemp|rm|unlink|rename|copy|cp|symlink|truncate|open|createWriteStream)\w*\s*\(/;
export function unitWork(u, declOf) {
  const seen = new Set();
  const visit = (code) => {
    const x = executed(code);
    const m = x.match(WORK);
    if (m) return m[0].replace(/\s+/g, '');
    const own = locals(code);
    for (const { name, call } of mentions(x)) {
      if (!call || own.has(name) || seen.has(name)) continue;
      const d = declOf(name);
      if (!d || d.mod.file !== u.mod.file || (d.fn === null && !d.init)) continue;
      seen.add(name);
      const w = visit(d.fn ?? d.init);
      if (w) return `${w} (through ${name})`;
    }
    return null;
  };
  return visit(u.code);
}
// Every load-time problem in a set of modules: [{ file, unit, why }]. The dispatch is a unit like any.
export function loadTimeProblems(list) {
  const mods = readModules(list);
  const owner = new Map(), decl = new Map();
  for (const m of mods) for (const [n, d] of m.decls) { owner.set(n, m.file); decl.set(n, d); }
  const out = [];
  for (const m of mods) for (const u of m.units) {
    const why = unitProblems(u, owner, (n) => decl.get(n));
    const w = unitWork(u, (n) => decl.get(n));
    if (w) why.push(`does what only init may: ${w}`);
    if (why.length) out.push({ file: m.file, unit: u.name, why });
  }
  return out;
}

// ---- the checks' reading ----
const libModules = (t) => t.modules().filter((x) => x.file.startsWith(`${LIB}/`)).map((x) => ({ file: x.file, text: t.read(x.file) }));

// ---- writes to another module's let ----
// An import can't be assigned, so every write in a module to a let another module owns goes through that
// let's setter. Writes are found by a parse: node's own acorn (in node since 12, loaded only with
// --expose-internals), in one child process over every module. Each written name is resolved to its
// scope; one bound by no scope of its module is the module's free name, and it is another module's let
// when the manifest's modules declare it there.
// The child: reads { lets: { name: owner }, mods: [{ file, text }], acorn } on stdin; prints
// { mods: [{ file, refused: [{ line, names, form, why }] }] }, every write it finds listed.
// Forms: assign (X = e), compound (X op= e), logical (X ??= e, ||=, &&=), pattern (a destructuring
// assignment holding X anywhere), update (X++, --X), for (a for-in/of loop's own target).
const WRITES = String.raw`
const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
const acorn = require(input.acorn);
const LETS = new Map(Object.entries(input.lets));
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const kids = (n) => Object.entries(n).filter(([k]) => !['type', 'start', 'end', 'loc'].includes(k)).flatMap(([, v]) => (Array.isArray(v) ? v : [v])).filter((c) => c && typeof c.type === 'string');
// the identifiers a pattern binds or writes, each with the shorthand property holding it, if any
const targets = (p, acc = [], prop = null) => {
  if (!p) return acc;
  if (p.type === 'Identifier') acc.push({ node: p, prop });
  else if (p.type === 'ObjectPattern') for (const q of p.properties) { if (q.type === 'RestElement') targets(q.argument, acc); else targets(q.value, acc, q.shorthand ? q : null); }
  else if (p.type === 'ArrayPattern') for (const q of p.elements) targets(q, acc);
  else if (p.type === 'AssignmentPattern') targets(p.left, acc, prop);
  else if (p.type === 'RestElement') targets(p.argument, acc);
  return acc;
};
const names = (p) => targets(p).map((x) => x.node.name);
const vars = (n, acc = []) => { if (n.type === 'VariableDeclaration' && n.kind === 'var') for (const d of n.declarations) acc.push(...names(d.id)); for (const c of kids(n)) if (!FN.has(c.type) && c.type !== 'StaticBlock') vars(c, acc); return acc; };
const lexical = (stmts) => stmts.flatMap((s) => {
  const d = (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') && s.declaration ? s.declaration : s;
  // an import binds no name of the module's own: a write to it is a write to the other module's binding
  if (s.type === 'ImportDeclaration') return [];
  if (d.type === 'VariableDeclaration' && d.kind !== 'var') return d.declarations.flatMap((x) => names(x.id));
  if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) return [d.id.name];
  return [];
});
function writesOf(file, text) {
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowReturnOutsideFunction: false });
  const out = [];
  const bound = (sc, x) => { for (let s = sc; s; s = s.up) if (s.names.has(x)) return true; return false; };
  const foreign = (sc, x) => !bound(sc, x) && LETS.has(x) && LETS.get(x) !== file;
  const walk = (n, sc, parent) => {
    const open = (list) => ({ names: new Set(list), up: sc });
    if (FN.has(n.type)) {
      // the parameters' scope (a default's closure sees these, not the body's declarations), then the body's
      const body = n.body.type === 'BlockStatement' ? n.body.body : [];
      const params = open([...(n.type === 'FunctionExpression' && n.id ? [n.id.name] : []), ...n.params.flatMap((p) => names(p)), 'arguments']);
      const inner = { names: new Set([...vars(n.body), ...lexical(body)]), up: params };
      for (const p of n.params) walk(p, params, n);
      if (n.body.type === 'BlockStatement') for (const s of body) walk(s, inner, n.body); else walk(n.body, inner, n);
      return;
    }
    let inner = sc;
    if (n.type === 'Program') inner = open([...vars(n), ...lexical(n.body)]);
    else if (n.type === 'BlockStatement') inner = open(lexical(n.body));
    else if (n.type === 'StaticBlock') inner = open([...n.body.flatMap((x) => vars(x)), ...lexical(n.body)]);
    else if (n.type === 'SwitchStatement') inner = open(lexical(n.cases.flatMap((c) => c.consequent)));
    else if (n.type === 'CatchClause') inner = open(names(n.param));
    else if ((n.type === 'ClassExpression' || n.type === 'ClassDeclaration') && n.id) inner = open([n.id.name]);
    else if (/^For(In|Of)?Statement$/.test(n.type)) { const d = n.init ?? n.left; if (d && d.type === 'VariableDeclaration' && d.kind !== 'var') inner = open(d.declarations.flatMap((x) => names(x.id))); }
    const hit = (ts) => ts.filter((x) => foreign(inner, x.node.name));
    if (n.type === 'AssignmentExpression') {
      const ts = hit(targets(n.left));
      if (ts.length) out.push({ node: n, parent, ts, form: n.left.type !== 'Identifier' ? 'pattern' : n.operator === '=' ? 'assign' : ['??=', '||=', '&&='].includes(n.operator) ? 'logical' : 'compound' });
    }
    if (n.type === 'UpdateExpression' && n.argument.type === 'Identifier' && foreign(inner, n.argument.name)) out.push({ node: n, parent, ts: [{ node: n.argument }], form: 'update' });
    if ((n.type === 'ForInStatement' || n.type === 'ForOfStatement') && n.left.type !== 'VariableDeclaration') { const ts = hit(targets(n.left)); if (ts.length) out.push({ node: n, parent, ts, form: 'for' }); }
    for (const c of kids(n)) walk(c, inner, n);
  };
  walk(ast, null, null);
  return out;
}
const result = [];
for (const { file, text } of input.mods) {
  const refused = [];
  try {
    for (const w of writesOf(file, text)) for (const t of w.ts) refused.push({ line: w.node.loc.start.line, names: [t.node.name], form: w.form });
  } catch (e) { refused.push({ line: e.loc?.line ?? 0, names: [], form: 'parse', why: 'does not parse: ' + e.message }); }
  result.push({ file, refused });
}
process.stdout.write(JSON.stringify({ mods: result }));
`;
// Runs the child over the given modules' bodies; lets: name -> owner file. { mods } or { error }.
// where the child loads node's acorn from; a test points it elsewhere to see the refusal when it can't
export const ACORN = { path: 'internal/deps/acorn/acorn/dist/acorn' };
function writesChild(lets, mods) {
  const r = spawnSync(process.execPath, ['--expose-internals', '-e', WRITES], { input: JSON.stringify({ lets: Object.fromEntries(lets), mods, acorn: ACORN.path }), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { const ls = (r.stderr || r.error?.message || '').split('\n'); return { error: `node's acorn (--expose-internals) failed: ${(ls.find((l) => /^\w*Error\b/.test(l)) ?? ls[0]).trim()}` }; }
  return JSON.parse(r.stdout);
}
// the lets a write could reach: every top-level let and its owner
const letOwners = (mods) => new Map(mods.flatMap((m) => [...m.decls].filter(([, d]) => d.kind === 'let').map(([n]) => [n, m.file])));

// shared-state: every write left to another module's let, in any form
export function sharedWrites(list) {
  const mods = readModules(list);
  const lets = letOwners(mods);
  const r = writesChild(lets, mods.map((m) => ({ file: m.file, text: m.body.join('\n') })));
  if (r.error) return [{ site: LIB, why: r.error }];
  return r.mods.flatMap((x) => {
    const m = mods.find((y) => y.file === x.file);
    return x.refused.map((f) => ({ site: `${m.file}:${f.line + m.off} ${f.names.join(', ')}`, why: f.form === 'parse' ? f.why : `writes ${f.names[0]} (${f.form}), a let of ${lets.get(f.names[0])}: an import can't be assigned` }));
  });
}

export const rules = [];
export const checks = [
  { name: 'load-time', run: (t) => ({ changed: [], refused: loadTimeProblems(libModules(t)).map((p) => ({ site: `${p.file} ${p.unit}`, why: p.why.join('; ') })) }) },
  // every lib module and the entry, which holds its imports in its body
  { name: 'shared-state', run: (t) => { const entry = t.read(ENTRY_FILE); return { changed: [], refused: sharedWrites([...libModules(t), ...(entry ? [{ file: ENTRY_FILE, text: entry }] : [])]) }; } },
];
