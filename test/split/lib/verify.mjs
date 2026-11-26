// split --verify (cutover-tree@1): a tree's modules against the source they came from, read on their
// own (not regenerated): every top-level item of the source appears once, byte for byte with only an
// export prefix added; nothing is dropped, doubled or added; every imports region is as the tree's
// own modules make it. Then the independent count, by the kit's own fileParts.
import vm from 'node:vm';
import { items } from './js.mjs';
import { IMPORTS_END, IMPORTS_START, importLines, mentioned, strip } from './split.mjs';

const keyOf = (it) => (it.kind === 'decl' ? it.names.join(',') : it.kind === 'mark' ? `marker ${it.names[0]}` : '(head)');
const textOf = (L, it) => L.lines.slice(it.from - 1, it.to).join('\n');
// A declaration's text with export taken off its own line, so a source declaration already exported
// and its copy in a module compare equal.
const bareOf = (L, it) => { const ls = L.lines.slice(it.from - 1, it.to); if (it.kind === 'decl') ls[it.line - it.from] = ls[it.line - it.from].replace(/^export\s+/, ''); return ls.join('\n'); };

// A module file's region lines and body; region is null when the file opens with none.
export function readModule(text) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines[0] !== IMPORTS_START) return { region: null, body: lines };
  const e = lines.indexOf(IMPORTS_END);
  if (e < 0) return { region: null, body: lines };
  return { region: lines.slice(1, e), body: lines.slice(e + 1) };
}

// modules: [{ file, text }] (every .mjs under the manifest's dir in the tree). Problems, one line each,
// naming the declaration (or marker, or module).
export function verify(src, M, modules) {
  const problems = [];
  const st = strip(src);
  const T = items(st.text);
  for (const it of T.items) if (it.unread) problems.push(`unread: the declaration ${keyOf(it)} binds names the scanner can't read whole`);
  const want = new Map();
  const rank = new Map(); // each key's first place in the source, for the order check
  T.items.forEach((it, i) => { const k = keyOf(it); if (!rank.has(k)) rank.set(k, i); });
  for (const it of T.items) { const k = keyOf(it); if (!want.has(k)) want.set(k, []); want.get(k).push(bareOf(T, it)); }
  const got = new Map();
  const parsed = [];
  for (const { file, text } of modules) {
    const { region, body } = readModule(text);
    if (!region) problems.push(`no imports region: ${file} does not open with ${IMPORTS_START} … ${IMPORTS_END}`);
    const U = items(body.length ? `${body.join('\n')}\n` : '');
    const own = new Set();
    for (const it of U.items) {
      const t = bareOf(U, it);
      if (it.kind === 'decl') {
        for (const nm of it.names) own.add(nm);
        if (!it.exported) problems.push(`not exported: ${keyOf(it)} in ${file}`);
      }
      const k = keyOf(it);
      if (!got.has(k)) got.set(k, []);
      got.get(k).push({ text: t, file });
    }
    // a module's items keep the source's order
    let prev = null;
    for (const it of U.items) {
      const k = keyOf(it);
      if (!rank.has(k)) continue;
      if (prev && rank.get(k) < rank.get(prev)) problems.push(`out of order: ${k} in ${file} comes after ${prev}, unlike the source`);
      prev = k;
    }
    parsed.push({ file, region, U, own, lines: (region ? region.length + 2 : 0) + body.length });
  }
  for (const k of new Set([...want.keys(), ...got.keys()])) {
    const w = want.get(k) ?? [], g = got.get(k) ?? [];
    const where = [...new Set(g.map((x) => x.file))].join(', ');
    if (!w.length) { problems.push(`added: ${k} (in ${where}) is not in the source`); continue; }
    if (!g.length) { problems.push(`dropped: ${k} is in no module`); continue; }
    if (g.length > w.length) { problems.push(`doubled: ${k} appears ${g.length} times (in ${where}), ${w.length} in the source`); continue; }
    if (g.length < w.length) { problems.push(`dropped: ${k} appears ${g.length} times (in ${where}), ${w.length} in the source`); continue; }
    const left = [...w];
    for (const x of g) {
      const i = left.indexOf(x.text);
      if (i >= 0) { left.splice(i, 1); continue; }
      const a = left[0].split('\n'), b = x.text.split('\n');
      let n = 0;
      while (n < a.length && a[n] === b[n]) n++;
      problems.push(`changed: ${k} in ${x.file} differs from the source at its line ${n + 1}`);
      left.shift();
    }
  }
  // the imports regions, as the tree's own declarations make them
  const owner = new Map();
  for (const p of parsed) for (const nm of p.own) owner.set(nm, p.file);
  const builtins = new Map(st.imports.map((x) => [x.local, x.line]));
  for (const p of parsed) {
    if (!p.region) continue;
    const should = importLines(p.file, mentioned(p.U.codeLines), p.own, owner, builtins);
    const have = new Set(p.region), need = new Set(should);
    const missing = should.filter((l) => !have.has(l)), extra = p.region.filter((l) => !need.has(l));
    if (missing.length || extra.length || p.region.join('\n') !== should.join('\n')) {
      problems.push(`stale imports region: ${p.file}${missing.length ? `; missing ${missing.join(' ')}` : ''}${extra.length ? `; extra ${extra.join(' ')}` : ''}${!missing.length && !extra.length ? '; not sorted' : ''}`);
    }
    if (p.lines > (M.cap ?? 2000)) problems.push(`over the cap: ${p.file} is ${p.lines} lines (cap ${M.cap ?? 2000})`);
  }
  return problems;
}

// The kit's own fileParts and leafTexts, run from the parts region of a devteam.mjs text.
export function kitParts(text) {
  const a = text.indexOf('/* parts start */'), b = text.indexOf('/* parts end */');
  if (a < 0 || b < a) return null;
  return vm.runInContext(`${text.slice(a, b)}\n;({ fileParts, leafTexts })`, vm.createContext({}));
}

// The names fileParts reads as declarations in the source that the scanner doesn't declare: a
// declaration the scanner missed (a line it wrongly reads as inside a template or comment), or a
// column-0 line inside a template that fileParts reads as one. Either way the split can't be sure,
// unless the line lies inside a declaration the manifest names in templates (a page's browser code,
// written at column 0 in a template): { refused, accepted }, each "<name> (the leaf at line N)",
// accepted ones with "in <template>"; unknown: each templates name that is no top-level declaration.
export function partsNames(kit, src, srcFile, templates = []) {
  const P = kit.fileParts(src, srcFile);
  const S = items(strip(src).text);
  const ours = new Set(S.items.flatMap((x) => (x.kind === 'decl' ? x.names : [])));
  const whole = items(src).items.filter((x) => x.kind === 'decl');
  const named = [];
  const refused = [], accepted = [], unknown = [];
  for (const t of templates) {
    const it = whole.find((x) => x.names.includes(t));
    if (it) named.push({ name: t, from: it.from, to: it.to });
    else unknown.push(t);
  }
  for (let i = 1; i <= P.n; i++) {
    const k = P.owner[i];
    if (!k.startsWith('d:') || P.owner[i - 1] === k) continue;
    const name = k.slice(2).split('/').pop().replace(/#\d+$/, '');
    if (ours.has(name)) continue;
    const inside = named.find((x) => i > x.from && i <= x.to);
    if (inside) accepted.push(`${name} (the leaf at line ${i}) in ${inside.name}`);
    else refused.push(`${name} (the leaf at line ${i})`);
  }
  return { refused, accepted, unknown };
}
// The independent count: the declaration leaves fileParts finds in the source and in the tree's
// modules (export stripped first on both sides), compared as multisets of text. { equal, source,
// tree, onlySource, onlyTree } with the first line of each leaf that differs.
export function partsCount(kit, src, srcFile, modules) {
  const leaves = (text, file) => [...kit.leafTexts(kit.fileParts(text, file))].filter(([k]) => k.startsWith('d:')).map(([, v]) => v);
  const bare = (text) => text.replace(/^export\s+(?=(?:async\s+)?function|class\s|(?:const|let|var)[\s{[])/gm, '');
  const s = leaves(bare(src), srcFile);
  const t = modules.flatMap(({ file, text }) => leaves(bare(text), file));
  const count = new Map();
  for (const x of s) count.set(x, (count.get(x) ?? 0) + 1);
  for (const x of t) count.set(x, (count.get(x) ?? 0) - 1);
  const onlySource = [], onlyTree = [];
  for (const [x, c] of count) { if (c > 0) onlySource.push(x.split('\n')[0]); if (c < 0) onlyTree.push(x.split('\n')[0]); }
  return { equal: !onlySource.length && !onlyTree.length, source: s.length, tree: t.length, onlySource, onlyTree };
}
