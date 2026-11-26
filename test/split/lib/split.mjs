// The split (cutover-tree@1): one source file into modules by a manifest, every top-level item moved
// byte for byte, each declaration prefixed with export, each module opening with a generated imports
// region. Pure: text in, text out; split.mjs reads git and writes the tree.
import path from 'node:path';
import { items } from './js.mjs';

export const IMPORTS_START = '/* imports start */';
export const IMPORTS_END = '/* imports end */';

// One import statement's bindings: [{ local, line }], line the one-binding import that brings it.
export function parseImport(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  const m = t.match(/^import (.+?) from (['"])(.+?)\2 ?;?$/);
  if (!m) throw new Error(`an import the split can't read: ${t}`);
  const [, clause, , spec] = m;
  const out = [];
  const named = clause.match(/\{(.*)\}/);
  const head = clause.replace(/\{.*\}/, '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const h of head) {
    const ns = h.match(/^\* as ([A-Za-z_$][\w$]*)$/);
    if (ns) out.push({ local: ns[1], line: `import * as ${ns[1]} from '${spec}';` });
    else if (/^[A-Za-z_$][\w$]*$/.test(h)) out.push({ local: h, line: `import ${h} from '${spec}';` });
    else throw new Error(`an import the split can't read: ${t}`);
  }
  if (named) for (const b of named[1].split(',').map((s) => s.trim()).filter(Boolean)) {
    const [imported, local = imported] = b.split(/ as /).map((s) => s.trim());
    out.push({ local, line: `import { ${imported === local ? local : `${imported} as ${local}`} } from '${spec}';` });
  }
  return out;
}

// The source without its shebang and its top-level import statements, which the imports regions
// and the entry take over: { text, imports: [{ local, line }], shebang }.
export function strip(src) {
  const S = items(src);
  const drop = new Set();
  const shebang = S.lines[0]?.startsWith('#!') ? S.lines[0] : null;
  if (shebang) drop.add(1);
  const imports = [];
  for (const it of S.items) {
    if (it.kind !== 'import') continue;
    let end = it.line;
    while (end < S.lines.length && !/;\s*$/.test(S.codeLines[end - 1])) end++;
    for (let i = it.line; i <= end; i++) drop.add(i);
    imports.push(...parseImport(S.lines.slice(it.line - 1, end).join('\n')));
  }
  const kept = S.lines.filter((_, i) => !drop.has(i + 1));
  return { text: kept.length ? `${kept.join('\n')}\n` : '', imports, shebang };
}

// The identifiers a run of blanked code mentions, property names after a single dot left out.
const IDENT = /[A-Za-z_$][\w$]*/g;
export function mentioned(codeLines) {
  const used = new Set();
  for (const c of codeLines) for (const x of c.matchAll(IDENT)) { if (c[x.index - 1] === '.' && c[x.index - 2] !== '.') continue; used.add(x[0]); }
  return used;
}

export const modulePath = (M, name) => `${M.dir}/${name}.mjs`;
export function importPath(fromFile, toFile) {
  const r = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return r.startsWith('.') ? r : `./${r}`;
}

// A module's imports region lines: every name of another module (owner: name -> file) or of the
// source's own imports (builtins: local -> line) that its code mentions and it doesn't declare,
// one import per line, sorted.
export function importLines(file, used, own, owner, builtins) {
  const out = new Set();
  for (const u of used) {
    if (own.has(u)) continue;
    if (owner.has(u) && owner.get(u) !== file) out.add(`import { ${u} } from '${importPath(file, owner.get(u))}';`);
    else if (!owner.has(u) && builtins.has(u)) out.add(builtins.get(u));
  }
  return [...out].sort();
}
export const region = (lines) => [IMPORTS_START, ...lines, IMPORTS_END];

// Where each manifest module starts in the stripped source: { starts: [{ name, line }], problems }.
// An anchor (line, banner title prefix, region name or declaration name) snaps forward to the first
// top-level item at or after it, so a cut never falls inside an item.
export function cuts(T, M) {
  const problems = [];
  const banners = [];
  T.lines.forEach((l, i) => { const m = l.match(/^\/\/ ===== (.*) =====$/); if (m) banners.push({ line: i + 1, title: m[1] }); });
  const starts = [];
  for (const m of M.modules) {
    const f = m.from ?? {};
    let line;
    if (f.line) line = f.line;
    else if (f.banner) line = banners.find((b) => b.title.startsWith(f.banner))?.line;
    else if (f.region) line = T.items.find((x) => x.kind === 'mark' && x.names[0] === `${f.region} start`)?.line;
    else if (f.decl) line = T.items.find((x) => x.kind === 'decl' && x.names.includes(f.decl))?.from;
    const it = line && T.items.find((x) => x.from >= line);
    if (!it) { problems.push(`manifest: module ${m.name}'s start ${JSON.stringify(f)} is not in the source`); continue; }
    const prev = starts[starts.length - 1];
    if (prev && it.from <= prev.line) { problems.push(`manifest: module ${m.name} starts at line ${it.from}, not after ${prev.name} (line ${prev.line})`); continue; }
    starts.push({ name: m.name, line: it.from });
  }
  if (starts.length && starts[0].line !== 1) problems.push(`manifest: the first module (${starts[0].name}) must start at line 1`);
  return { starts, problems };
}

// The whole split of one source by one manifest: { modules: [{ name, file, text, lines, items }],
// entry: { file, text }, problems, builtins, owner }.
export function build(src, M, { sha = '' } = {}) {
  const st = strip(src);
  const T = items(st.text);
  const { starts, problems } = cuts(T, M);
  for (const it of T.items) if (it.unread) problems.push(`the declaration at line ${it.line} of the source without its imports binds names the split can't read whole (read: ${it.names.join(', ')}): ${T.lines[it.line - 1].slice(0, 80)}`);
  const mods = starts.map((s) => ({ name: s.name, file: modulePath(M, s.name), items: [] }));
  const byName = new Map(mods.map((m) => [m.name, m]));
  const home = (line) => { let k = 0; while (k + 1 < starts.length && starts[k + 1].line <= line) k++; return mods[k]; };
  const placed = new Map();
  for (const [decl, target] of Object.entries(M.place ?? {})) {
    const it = T.items.find((x) => x.kind === 'decl' && x.names.includes(decl));
    if (!it) problems.push(`manifest: place names ${decl}, which is not a top-level declaration`);
    else if (!byName.has(target)) problems.push(`manifest: place puts ${decl} in ${target}, which is not a module`);
    else placed.set(it, byName.get(target));
  }
  if (mods.length) for (const it of T.items) (placed.get(it) ?? home(it.from)).items.push(it);
  const owner = new Map();
  for (const m of mods) for (const it of m.items) if (it.kind === 'decl') for (const nm of it.names) owner.set(nm, m.file);
  const builtins = new Map(st.imports.map((x) => [x.local, x.line]));
  for (const m of mods) {
    const body = [];
    const code = [];
    const own = new Set();
    for (const it of m.items) {
      for (let i = it.from; i <= it.to; i++) {
        const l = T.lines[i - 1];
        body.push(it.kind === 'decl' && i === it.line && !it.exported ? `export ${l}` : l);
        code.push(T.codeLines[i - 1]);
      }
      if (it.kind === 'decl') for (const nm of it.names) own.add(nm);
    }
    m.lines = [...region(importLines(m.file, mentioned(code), own, owner, builtins)), ...body];
    m.text = `${m.lines.join('\n')}\n`;
    if (m.lines.length > (M.cap ?? 2000)) problems.push(`module ${m.file} is ${m.lines.length} lines, over the cap of ${M.cap ?? 2000}`);
  }
  const entry = M.entry && {
    file: M.entry,
    text: [
      st.shebang ?? '#!/usr/bin/env node',
      `// The CLI's default entry, generated by test/split/split.mjs from ${M.source}${sha ? ` at ${sha}` : ''}.`,
      '// It imports every module in the manifest\'s order; the dispatch runs in the last, which no module',
      '// imports, so after every other. An overlay may replace this file.',
      ...mods.map((m) => `import '${importPath(M.entry, m.file)}';`),
      '',
    ].join('\n'),
  };
  return { modules: mods, entry, problems, builtins, owner, stripped: st, T };
}
