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
//            assignment calls it; a write it can't rewrite is refused at its site and left as written
// Then two checks, after every area's rules:
//   load-time     refuses any initializer or statement that, while its module loads, calls an imported
//                 function, reads an imported const, let or class, or spawns, writes, prints, exits or
//                 reads process.argv, directly or through a function of its own module it calls;
//                 referencing an imported function declaration (as the COMMANDS tables do) is allowed
//   shared-state  refuses every write left, in any form, to another module's let, in every lib module
//                 and the entry (a write through a renamed import included): an import can't be assigned
import { spawnSync } from 'node:child_process';
import { items } from '../../lib/js.mjs';
import { readModule } from '../../lib/verify.mjs';

export const LIB = 'docs/devteam/scripts/lib';
export const STATE = `${LIB}/state.mjs`;
export const DISPATCH = `${LIB}/dispatch.mjs`;
export const ENTRY_FILE = 'docs/devteam/scripts/cli.mjs';
// The load-time values the design names (How it works today): argv parsing, REPLY_FD, and the
// locations from import.meta.url and git, here through runDir. Every top-level statement is named too.
// The argv parsing the design names (devteam.mjs 70-109, argv through flagNum, the args region
// inside) moves to state whole, its functions with it unchanged, so each declaration keeps its
// neighbours (fileParts reads the destructuring flags line as part of whatever is above it).
export const ARGV_BLOCK = ['argv', 'flagNum'];
export const NAMED = ['argv', 'command', 'flags', 'positional', 'rest', 'REPLY_FD', 'here', 'repoRoot', 'cwdCommon', 'homeAt', 'commonDir', 'mainRoot', 'cwdIsHome', 'devteamDir', 'kitDir', 'projectDir', 'runDir'];

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

// ---- the rules ----
const libModules = (t) => t.modules().filter((x) => x.file.startsWith(`${LIB}/`)).map((x) => ({ file: x.file, text: t.read(x.file) }));
const bodyText = (m, lines) => `${[...(m.region ? ['/* imports start */', ...m.region, '/* imports end */'] : []), ...lines].join('\n')}\n`;
// a declaration's lines (comment lines included) and its statement tail
const linesOf = (m, from, to) => m.T.lines.slice(from - 1, to);

// entry: fileURLToPath(import.meta.url) -> ENTRY
const SELF = /fileURLToPath\(import\.meta\.url\)/g;
function ruleEntry(t) {
  const changed = [], refused = [];
  if (!t.read(STATE)) return { changed, refused: [{ site: STATE, why: 'no state module in the split' }] };
  for (const { file, text } of libModules(t)) {
    const mods = readModules([{ file, text }]);
    const m = mods[0];
    const hits = [];
    for (const [i, it] of m.T.items.entries()) {
      const src = linesOf(m, it.from, it.to).join('\n');
      const code = m.T.codeLines.slice(it.from - 1, it.to).join('\n');
      // only where the code (not a comment or string) has it
      const n = [...src.matchAll(SELF)].filter((x) => code.slice(x.index, x.index + 11) === 'fileURLToPa').length;
      if (n) hits.push({ i, it, n });
    }
    if (!hits.length) continue;
    const lines = [...m.body];
    for (const { it, n } of hits) {
      for (let k = it.from - 1; k < it.to; k++) {
        const code = m.T.codeLines[k];
        lines[k] = lines[k].replace(SELF, (s, at) => (code.slice(at, at + 11) === 'fileURLToPa' ? 'ENTRY' : s));
      }
      const site = it.kind === 'decl' ? { file, decl: it.names[0], site: `${n} use${n > 1 ? 's' : ''} of fileURLToPath(import.meta.url) -> ENTRY` } : { file, item: it.kind === 'head' ? '(head)' : `marker ${it.names[0]}`, site: `${n} use${n > 1 ? 's' : ''} -> ENTRY` };
      changed.push(site);
    }
    t.write(file, bodyText(m, lines));
  }
  return { changed, refused };
}

// init: move load-time work into init() in state. The names it makes init-assigned lets, for setters
// to leave alone (only init assigns them, in their own module).
let initNames = new Set(), initLets = new Set();
function ruleInit(t) {
  const changed = [], refused = [];
  initNames = new Set(); initLets = new Set();
  const list = libModules(t);
  const mods = readModules(list);
  const state = mods.find((m) => m.file === STATE);
  if (!state) return { changed, refused: [{ site: STATE, why: 'no state module in the split' }] };
  const order = new Map(mods.map((m, i) => [m.file, i]));
  const owner = new Map(), decl = new Map();
  for (const m of mods) for (const [n, d] of m.decls) { owner.set(n, m.file); decl.set(n, d); }
  for (const n of NAMED) if (!decl.has(n)) refused.push({ site: n, why: `the design names ${n} as load-time work, and no module declares it` });
  // L: units that move. Start: the named values, and every statement outside the dispatch.
  const moving = new Set();
  const late = new Set();
  const all = mods.flatMap((m) => m.units).filter((u) => u.mod.file !== DISPATCH);
  for (const u of all) {
    if (u.kind === 'statements') moving.add(u);
    else if ((u.names ?? []).some((n) => NAMED.includes(n)) || unitWork(u, (n) => decl.get(n))) { moving.add(u); for (const n of u.names ?? []) late.add(n); }
  }
  // to a fixed point: a unit that reads a late name or reaches another module at load moves too, its
  // names placed in state from then on
  for (let grew = true; grew;) {
    grew = false;
    const placed = new Map(owner);
    for (const n of late) placed.set(n, STATE);
    for (const u of all) {
      if (moving.has(u)) continue;
      const file = placed.get(u.names?.[0]) ?? u.mod.file;
      const why = unitProblems({ ...u, mod: { file } }, placed, (n) => decl.get(n), late);
      if (why.length) { moving.add(u); for (const n of u.names ?? []) late.add(n); grew = true; }
    }
  }
  // the units in source order, by module then by item
  const moved = [...moving].sort((a, b) => order.get(a.mod.file) - order.get(b.mod.file) || a.idx - b.idx || (a.kind === 'statements') - (b.kind === 'statements'));
  const initLines = [];
  const lets = new Map(); // module file -> [{ idx, line }] export let lines to place in state, by rank
  const drop = new Map(); // module file -> Set of body line numbers taken out
  const take = (m, from, to) => { if (!drop.has(m.file)) drop.set(m.file, new Set()); for (let k = from; k <= to; k++) drop.get(m.file).add(k); };
  for (const u of moved) {
    const m = u.mod;
    const lines = linesOf(m, u.from, u.to);
    if (u.kind === 'statements') {
      initLines.push(...lines);
      take(m, u.from, u.to);
      changed.push(u.it.kind === 'decl' ? { file: m.file, decl: u.it.names[0], site: `a statement after it -> init()` } : { file: m.file, item: u.it.kind === 'head' ? '(head)' : `marker ${u.it.names[0]}`, site: 'its statements -> init()' });
      continue;
    }
    // const X = e; -> export let X; in state, and X = e; in init
    const at = u.it.line - u.from; // the declaration's own line among lines
    const own = lines[at].replace(/^export\s+/, '');
    const kw = own.match(/^(const|let|var)\s+/);
    if (!kw) { refused.push({ site: `${m.file} ${u.name}`, why: 'a load-time declaration that is no const, let or var' }); continue; }
    let rest = own.slice(kw[0].length);
    const out = [...lines.slice(0, at), rest, ...lines.slice(at + 1)];
    if (/^[{]/.test(rest)) { out[at] = `(${rest}`; const last = out.length - 1; out[last] = out[last].replace(/;\s*$/, ');'); if (!out[last].endsWith(');')) { refused.push({ site: `${m.file} ${u.name}`, why: 'a destructuring declaration that does not end with ;' }); continue; } }
    initLines.push(...out);
    if (!lets.has(m.file)) lets.set(m.file, []);
    lets.get(m.file).push({ rank: [order.get(m.file), u.idx], line: `export let ${u.names.join(', ')};` });
    take(m, u.from, u.to);
    for (const n of u.names) { initNames.add(n); if (kw[1] === 'let') initLets.add(n); }
    changed.push({ file: STATE, decl: u.names[0], site: `from ${m.file}: export let ${u.names.join(', ')}, assigned in init()` });
  }
  // the argv block: every other item from argv to flagNum goes to state unchanged
  const carried = [];
  const [b0, b1] = ARGV_BLOCK.map((n) => decl.get(n));
  if (!b0 || !b1 || b0.mod !== b1.mod || b1.idx < b0.idx) refused.push({ site: ARGV_BLOCK.join('..'), why: 'the argv block is not one run of one module' });
  else if (b0.mod.file !== STATE) {
    const m = b0.mod;
    for (let idx = b0.idx; idx <= b1.idx; idx++) {
      const it = m.T.items[idx];
      const gone = drop.get(m.file) ?? new Set();
      const ls = linesOf(m, it.from, it.to).map((l, k) => [l, it.from + k]).filter(([, k]) => !gone.has(k));
      if (!ls.length) continue;
      take(m, ls[0][1], ls[ls.length - 1][1]);
      carried.push({ rank: [order.get(m.file), idx], lines: ls.map(([l]) => l) });
      if (it.kind === 'decl' && !moving.has(m.units.find((u) => u.kind === 'init' && u.idx === idx))) changed.push({ file: STATE, decl: it.names[0], site: `carried from ${m.file} with the argv block, unchanged` });
    }
  }
  if (refused.length) return { changed: [], refused };
  // write each module without what moved; state gets the lets in rank and init()
  for (const m of mods) {
    const gone = drop.get(m.file) ?? new Set();
    if (m.file !== STATE && !gone.size) continue;
    if (m.file !== STATE) { t.write(m.file, bodyText(m, m.body.filter((_, i) => !gone.has(i + 1)))); continue; }
    const entries = [];
    m.T.items.forEach((it, idx) => { const ls = linesOf(m, it.from, it.to).filter((_, k) => !gone.has(it.from + k)); if (ls.length) entries.push({ rank: [order.get(m.file), idx], lines: ls }); });
    for (const [, ls] of lets) for (const l of ls) entries.push({ rank: l.rank, lines: [l.line] });
    entries.push(...carried);
    entries.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
    const body = entries.flatMap((e) => e.lines);
    body.push(
      '// The CLI\'s entry, and the scripts folder: what "this script" means in every module.',
      "export const ENTRY = fileURLToPath(new URL('../cli.mjs', import.meta.url));",
      '// All load-time work, in the source\'s order: the entry calls it once, after importing every module',
      '// and before the dispatch. Nothing else assigns what it assigns.',
      // async: a load-time statement may await (the bash-ok hook reads its stdin); it runs synchronously up to
      // its first await, which only that path reaches, and the entry awaits it before dispatch()
      'export async function init() {',
      ...initLines,
      '}',
    );
    t.write(m.file, bodyText(m, body));
  }
  changed.push({ file: STATE, decl: 'ENTRY', site: 'the CLI\'s entry file' }, { file: STATE, decl: 'init', site: `${moved.length} load-time units, ${initLines.length} lines` });
  return { changed, refused };
}

// dispatch: the region's statements into dispatch(); the entry calls init() then dispatch()
function ruleDispatch(t) {
  const changed = [], refused = [];
  const text = t.read(DISPATCH), entry = t.read(ENTRY_FILE);
  if (!text || !entry) return { changed, refused: [{ site: text ? ENTRY_FILE : DISPATCH, why: 'not in the split' }] };
  const m = readModules([{ file: DISPATCH, text }])[0];
  const mk = m.T.items.findIndex((it) => it.kind === 'mark' && it.names[0] === 'dispatch start');
  if (mk < 0) return { changed, refused: [{ site: DISPATCH, why: 'no dispatch start marker' }] };
  const it = m.T.items[mk];
  const lines = [...m.body];
  lines.splice(it.from, it.to - it.from, 'export function dispatch() {', ...lines.slice(it.from, it.to), '}');
  t.write(DISPATCH, bodyText(m, lines));
  changed.push({ file: DISPATCH, item: 'marker dispatch start', site: 'its statements -> export function dispatch()' });
  t.write(ENTRY_FILE, `${entry.replace(/\n*$/, '\n')}import { init } from './lib/state.mjs';\nimport { dispatch } from './lib/dispatch.mjs';\n\nawait init();\ndispatch();\n`);
  changed.push({ file: ENTRY_FILE, site: 'awaits init() then calls dispatch() after every import' });
  return { changed, refused };
}

// ---- writes to another module's let ----
// An import can't be assigned, so every write in a module to a let another module owns goes through that
// let's setter. Writes are found by a parse: node's own acorn (in node since 12, loaded only with
// --expose-internals), in one child process over every module. Each written name is resolved to its
// scope; one bound by no scope of its module is the module's free name, and it is another module's let
// when the manifest's modules declare it there.
const setterName = (n) => `set${n[0].toUpperCase()}${n.slice(1)}`;
// The child: reads { mode, lets: { name: owner }, taken: { name: why }, mods: [{ file, text, imports }],
// acorn } on stdin, where imports is the text of a lib module's imports region (its body holds none); prints
// { mods: [{ file, text, sites: [{ line, names, form }], refused: [{ line, names, form, of, why, imports }] }] },
// or { acorn: <its error line> } when acorn can't be loaded. A name written through a renamed import
// (import { X as Q }) is resolved to the name it imports: of is the let's own name.
// mode 'rewrite' rewrites what it can (last write first, parsing again after each); 'report' only lists.
// Forms: assign (X = e), compound (X op= e), logical (X ??= e, ||=, &&=), pattern (a destructuring
// assignment holding X anywhere), update (X++, --X), for (a for-in/of loop's own target).
const WRITES = String.raw`
const input = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
let acorn = null, acornError = null;
try { acorn = require(input.acorn); } catch (e) { acornError = String(e).split('\n')[0]; }
const LETS = new Map(Object.entries(input.lets));
const TAKEN = new Map(Object.entries(input.taken ?? {}));
const set = (x) => 'set' + x[0].toUpperCase() + x.slice(1);
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
const idsIn = (n, acc = []) => { if (n.type === 'Identifier') acc.push(n.name); for (const c of kids(n)) idsIn(c, acc); return acc; };
// what a pattern reads while it assigns: its defaults and computed keys
const patReads = (p, acc = []) => {
  if (!p) return acc;
  if (p.type === 'AssignmentPattern') { idsIn(p.right, acc); patReads(p.left, acc); }
  else if (p.type === 'ObjectPattern') for (const q of p.properties) { if (q.type === 'RestElement') patReads(q.argument, acc); else { if (q.computed) idsIn(q.key, acc); patReads(q.value, acc); } }
  else if (p.type === 'ArrayPattern') for (const q of p.elements) patReads(q, acc);
  else if (p.type === 'RestElement') patReads(p.argument, acc);
  return acc;
};
const vars = (n, acc = []) => { if (n.type === 'VariableDeclaration' && n.kind === 'var') for (const d of n.declarations) acc.push(...names(d.id)); for (const c of kids(n)) if (!FN.has(c.type) && c.type !== 'StaticBlock') vars(c, acc); return acc; };
const lexical = (stmts) => stmts.flatMap((s) => {
  const d = (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') && s.declaration ? s.declaration : s;
  // an import binds no name of the module's own: a write to it is a write to the other module's binding
  if (s.type === 'ImportDeclaration') return [];
  if (d.type === 'VariableDeclaration' && d.kind !== 'var') return d.declarations.flatMap((x) => names(x.id));
  if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) return [d.id.name];
  return [];
});
const parse = (text) => acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowReturnOutsideFunction: false });
// where a relative import of file leads, as a path like the owners' ('./a.mjs' from lib/b.mjs is lib/a.mjs);
// anything else (node:path, a package) leads to no module of the split
const posix = require('node:path').posix;
const target = (file, spec) => (/^\.\.?\//.test(spec) ? posix.join(posix.dirname(file), spec) : null);
// a program's renamed import specifiers: local -> the let it imports, or null when its source is not that
// let's owner (another module's binding of the same name, or a builtin's), so a write to it is no let's
const renames = (file, ast, as = new Map()) => {
  for (const s of ast.body) if (s.type === 'ImportDeclaration') for (const x of s.specifiers) {
    const name = x.imported?.name ?? x.imported?.value;
    if (x.type === 'ImportSpecifier' && name !== x.local.name) as.set(x.local.name, LETS.get(name) === target(file, s.source.value) ? name : null);
  }
  return as;
};
// as: the renames of the module's imports region; the entry's own imports are in its text
function writesOf(file, text, as) {
  const ast = parse(text);
  const AS = renames(file, ast, new Map(as));
  const of = (x) => (AS.has(x) ? AS.get(x) : x);
  const out = [];
  const bound = (sc, x) => { for (let s = sc; s; s = s.up) if (s.names.has(x)) return true; return false; };
  const foreign = (sc, x) => !bound(sc, x) && LETS.has(of(x)) && LETS.get(of(x)) !== file;
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
    const hit = (ts) => ts.filter((x) => foreign(inner, x.node.name)).map((x) => ({ ...x, of: of(x.node.name) }));
    if (n.type === 'AssignmentExpression') {
      const ts = hit(targets(n.left));
      if (ts.length) out.push({ node: n, parent, ts, form: n.left.type !== 'Identifier' ? 'pattern' : n.operator === '=' ? 'assign' : ['??=', '||=', '&&='].includes(n.operator) ? 'logical' : 'compound', shadow: ts.map((x) => x.node.name).filter((x) => bound(inner, set(x))), selfRead: n.left.type !== 'Identifier' && patReads(n.left).some((x) => ts.some((y) => y.node.name === x)) });
    }
    if (n.type === 'UpdateExpression' && n.argument.type === 'Identifier' && foreign(inner, n.argument.name)) out.push({ node: n, parent, ts: [{ node: n.argument, of: of(n.argument.name) }], form: 'update', shadow: [] });
    if ((n.type === 'ForInStatement' || n.type === 'ForOfStatement') && n.left.type !== 'VariableDeclaration') { const ts = hit(targets(n.left)); if (ts.length) out.push({ node: n, parent, ts, form: 'for', shadow: [] }); }
    for (const c of kids(n)) walk(c, inner, n);
  };
  walk(ast, null, null);
  return out;
}
// only a syntax error acorn raised is a module's refusal; anything else is the child failing
const parseError = (e) => e instanceof SyntaxError && e.loc;
function writes(file, given, imports) {
  let text = given;
  const sites = [], refused = [];
  let as;
  try { as = imports ? renames(file, parse(imports)) : new Map(); } catch (e) {
    if (!parseError(e)) throw e;
    refused.push({ line: e.loc.line, names: [], form: 'parse', why: 'its imports do not parse: ' + e.message, imports: true });
    return { file, text, sites, refused };
  }
  try {
    if (input.mode === 'report') {
      for (const w of writesOf(file, text, as)) for (const t of w.ts) refused.push({ line: w.node.loc.start.line, names: [t.node.name], form: w.form, of: t.of });
    } else {
      // last first: a write's line is its line in the given text, since every edit so far came after it
      for (let limit = Infinity; ;) {
        const ws = writesOf(file, text, as).filter((w) => w.node.start < limit);
        if (!ws.length) break;
        const w = ws.reduce((a, b) => (b.node.start > a.node.start ? b : a));
        limit = w.node.start;
        const src = (n) => text.slice(n.start, n.end);
        const line = w.node.loc.start.line;
        const ns = [...new Set(w.ts.map((x) => x.node.name))];
        const stmt = w.parent && w.parent.type === 'ExpressionStatement' && w.parent.expression === w.node ? w.parent : null;
        let from = w.node.start, to = w.node.end, rep = null, why = null;
        // the right side in parentheses of its own: acorn's range leaves out any around it, as in X = (a, b)
        const right = w.node.right ? '(' + src(w.node.right) + ')' : '';
        const renamed = w.ts.find((x) => x.of !== x.node.name);
        const taken = ns.find((x) => TAKEN.has(x));
        if (renamed) why = renamed.node.name + ' is a renamed import of the let ' + renamed.of + ' of ' + LETS.get(renamed.of) + ';';
        else if (taken) why = TAKEN.get(taken) + ', so its writes stay as written;';
        else if (w.shadow.length) why = 'a local named ' + set(w.shadow[0]) + ' where it writes ' + w.shadow[0] + ', so the setter would not be reached;';
        else if (w.selfRead) why = 'a destructuring whose default or computed key reads a name it writes;';
        else if (w.form === 'assign') rep = set(ns[0]) + '(' + right + ')';
        else if (w.form === 'compound') rep = set(ns[0]) + '(' + ns[0] + ' ' + w.node.operator.slice(0, -1) + ' ' + right + ')';
        else if (w.form === 'logical') { const e = ns[0] + ' ' + w.node.operator.slice(0, -1) + ' ' + set(ns[0]) + '(' + right + ')'; rep = stmt ? e : '(' + e + ')'; }
        else if (w.form === 'pattern' && stmt) {
          // destructure into temporaries, then set each: { let $w0; ({ a: $w0 } = e); setX($w0); }
          const temps = w.ts.map((x, k) => ({ ...x, tmp: '$written' + k }));
          let pat = '';
          let at = w.node.left.start;
          for (const x of [...temps].sort((a, b) => (a.prop ?? a.node).start - (b.prop ?? b.node).start)) {
            if (x.prop) { const v = x.prop.value; pat += text.slice(at, x.prop.start) + x.node.name + ': ' + x.tmp + (v.type === 'AssignmentPattern' ? ' = ' + src(v.right) : ''); at = x.prop.end; }
            else { pat += text.slice(at, x.node.start) + x.tmp; at = x.node.end; }
          }
          pat += text.slice(at, w.node.left.end);
          from = stmt.start; to = stmt.end;
          rep = '{ let ' + temps.map((x) => x.tmp).join(', ') + '; (' + pat + ' = ' + right + '); ' + temps.map((x) => set(x.node.name) + '(' + x.tmp + ');').join(' ') + ' }';
        } else if (!why) why = w.form === 'pattern' ? 'a destructuring write used as a value' : w.form === 'update' ? 'a ++ or -- write' : 'a for-in/of loop writing it';
        if (why) { refused.push({ line, names: ns, form: w.form, why: why.endsWith(';') ? why.slice(0, -1) + ': the rule can\'t rewrite it' : why + ' to another module\'s let the rule can\'t rewrite' }); continue; }
        text = text.slice(0, from) + rep + text.slice(to);
        sites.push({ line, names: w.ts.map((x) => x.node.name), form: w.form });
      }
    }
  } catch (e) {
    if (!parseError(e)) throw e;
    refused.push({ line: e.loc.line, names: [], form: 'parse', why: 'does not parse: ' + e.message });
  }
  return { file, text, sites, refused };
}
process.stdout.write(JSON.stringify(acornError ? { acorn: acornError } : { mods: input.mods.map((m) => writes(m.file, m.text, m.imports)) }));
`;
// where the child loads node's acorn from; a test points it elsewhere to see the refusal when it can't
export const ACORN = { path: 'internal/deps/acorn/acorn/dist/acorn' };
// Runs the child over the given modules (each its body and its imports region); lets: name -> owner file.
// { mods } or { error }: acorn not loadable, or the child failing any other way, each named as such.
function writesChild(mode, lets, mods, taken = new Map()) {
  const input = { mode, lets: Object.fromEntries(lets), taken: Object.fromEntries(taken), mods: mods.map((m) => ({ file: m.file, text: m.body.join('\n'), imports: (m.region ?? []).join('\n') })), acorn: ACORN.path };
  const r = spawnSync(process.execPath, ['--expose-internals', '-e', WRITES], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 1 << 28 });
  let out = null;
  if (r.status === 0) try { out = JSON.parse(r.stdout); } catch { /* named below */ }
  if (!out) { const ls = (r.stderr || r.error?.message || `no result (exit ${r.status})`).split('\n'); return { error: `the writes child failed: ${(ls.find((l) => /^\w*Error\b/.test(l)) ?? ls[0]).trim()}` }; }
  return out.acorn ? { error: `node's acorn (--expose-internals) failed: ${out.acorn}` } : out;
}
// a refusal's site: its line in the module (an imports region's line is after the imports start marker)
const siteOf = (m, f) => `${m.file}:${f.imports ? f.line + 1 : f.line + m.off} ${f.names.join(', ')}`;
// the lets a write could reach: every top-level let and its owner
const letOwners = (mods, keep = () => true) => new Map(mods.flatMap((m) => [...m.decls].filter(([n, d]) => d.kind === 'let' && keep(n)).map(([n]) => [n, m.file])));
const itemKey = (m, line) => { const it = m.T.items.findLast((x) => x.from <= line) ?? m.T.items[0]; return it.kind === 'decl' ? { decl: it.names[0] } : { item: it.kind === 'head' ? '(head)' : `marker ${it.names[0]}` }; };

// setters: every write to another module's let becomes its setter's call. The lets are the source's own
// and those init made of a source let; init's other names were consts in the source, so nothing writes
// them there.
function ruleSetters(t) {
  const changed = [], refused = [];
  const mods = readModules(libModules(t));
  const lets = letOwners(mods, (n) => !initNames.has(n) || initLets.has(n));
  // a let whose setter's name is taken (a top-level name, or a global like setTimeout) gets no setter: each write
  // to it is refused at its site and left as written, never turned into a call of the name that is there
  const owned = new Set(mods.flatMap((m) => [...m.decls.keys()]));
  const taken = new Map([...lets.keys()].filter((n) => owned.has(setterName(n)) || setterName(n) in globalThis).map((n) => [n, `${setterName(n)} is already a name${owned.has(setterName(n)) ? '' : ' (a global)'}`]));
  const r = writesChild('rewrite', lets, mods, taken);
  if (r.error) return { changed, refused: [{ site: LIB, why: r.error }] };
  const need = new Map();
  for (const x of r.mods) {
    const m = mods.find((y) => y.file === x.file);
    for (const f of x.refused) refused.push({ site: siteOf(m, f), why: f.why });
    if (!x.sites.length) continue;
    t.write(m.file, bodyText(m, x.text.split('\n')));
    const per = new Map(); // item key -> writes
    for (const s of x.sites) {
      for (const n of s.names) need.set(n, lets.get(n));
      const k = JSON.stringify(itemKey(m, s.line));
      per.set(k, [...(per.get(k) ?? []), ...s.names.map((n) => ({ name: n, form: s.form }))]);
    }
    for (const [k, ws] of per) {
      const count = new Map();
      for (const w of ws) count.set(w.name, (count.get(w.name) ?? 0) + 1);
      const names = [...count].map(([n, c]) => (c > 1 ? `${n} x${c}` : n)).join(', ');
      changed.push({ file: m.file, ...JSON.parse(k), site: `${ws.length} assignment${ws.length > 1 ? 's' : ''} -> setter (${names}; ${[...new Set(ws.map((w) => w.form))].join(', ')})` });
    }
  }
  // each setter beside its let, bottom up so each insert leaves the lines above it where they were
  const byFile = new Map();
  for (const [name, file] of need) { if (!byFile.has(file)) byFile.set(file, []); byFile.get(file).push(name); }
  for (const [file, names] of byFile) {
    const m = readModules([{ file, text: t.read(file) }])[0];
    const lines = [...m.body];
    for (const name of names.sort((x, y) => m.decls.get(y).it.to - m.decls.get(x).it.to)) {
      lines.splice(m.decls.get(name).it.to, 0, `export function ${setterName(name)}(v) { return (${name} = v); }`);
      changed.push({ file, decl: setterName(name), site: `the setter of ${name}` });
    }
    t.write(file, bodyText(m, lines));
  }
  return { changed, refused };
}

// shared-state: every write left to another module's let, in any form
export function sharedWrites(list) {
  const mods = readModules(list);
  const lets = letOwners(mods);
  const r = writesChild('report', lets, mods);
  if (r.error) return [{ site: LIB, why: r.error }];
  return r.mods.flatMap((x) => {
    const m = mods.find((y) => y.file === x.file);
    // a renamed import names both: the local written and the let it is
    return x.refused.map((f) => ({ site: siteOf(m, f), why: f.form === 'parse' ? f.why : `writes ${f.names[0]} (${f.form}), ${f.of === f.names[0] ? 'a let' : `the let ${f.of}`} of ${lets.get(f.of)}: an import can't be assigned` }));
  });
}

export const rules = [
  { name: 'entry', apply: ruleEntry },
  { name: 'init', apply: ruleInit },
  { name: 'dispatch', apply: ruleDispatch },
  { name: 'setters', apply: ruleSetters },
];
export const checks = [
  { name: 'load-time', run: (t) => ({ changed: [], refused: loadTimeProblems(libModules(t)).map((p) => ({ site: `${p.file} ${p.unit}`, why: p.why.join('; ') })) }) },
  // every lib module and the entry, which holds its imports in its body
  { name: 'shared-state', run: (t) => { const entry = t.read(ENTRY_FILE); return { changed: [], refused: sharedWrites([...libModules(t), ...(entry ? [{ file: ENTRY_FILE, text: entry }] : [])]) }; } },
];
