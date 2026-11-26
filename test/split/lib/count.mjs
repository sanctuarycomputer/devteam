// split --count: K1's sizing count (cutover-tree@1, risk K1) of one source by its manifest, as
// markdown: top-level declarations per module, load-time statement sites, uses of import.meta.url
// meaning the CLI, lets assigned from another module or banner section, and marker regions over
// 2,000 lines.
export function count(b, M, sha) {
  const { T, modules } = b;
  const moduleOf = new Map();
  for (const m of modules) for (const it of m.items) for (let i = it.from; i <= it.to; i++) moduleOf.set(i, m.name);
  const banners = [];
  T.lines.forEach((l, i) => { const x = l.match(/^\/\/ ===== (.*) =====$/); if (x) banners.push({ line: i + 1, title: x[1] }); });
  const sectionOf = (line) => { let s = '(top)'; for (const x of banners) if (x.line <= line) s = x.title; return s; };
  const decls = T.items.filter((x) => x.kind === 'decl');
  const out = [`K1 count at ${sha} (${M.source}: ${T.lines.length} lines without its shebang and imports, ${decls.length} top-level declarations)`, ''];
  out.push('| module | lines | declarations |', '|---|---|---|');
  for (const m of modules) out.push(`| ${m.name} | ${m.lines.length} | ${m.items.filter((x) => x.kind === 'decl').length} |`);
  const big = Math.max(...modules.map((m) => m.lines.length));
  out.push('', `Modules: ${modules.length}; largest ${big} lines; over ${M.cap ?? 2000}: ${modules.filter((m) => m.lines.length > (M.cap ?? 2000)).map((m) => m.name).join(', ') || 'none'}.`);
  out.push('', `Load-time statement sites (top-level statements that are no declaration): ${T.statements.length}`);
  for (const s of T.statements) out.push(`- ${moduleOf.get(s.line)}: \`${s.text.slice(0, 80).replace(/`/g, "'")}\``);
  const meta = [];
  // path.dirname(fileURLToPath(import.meta.url)) means the scripts folder; any other use, the CLI's file
  T.lines.forEach((l, i) => { if (/import\.meta\.url/.test(T.codeLines[i])) meta.push({ module: moduleOf.get(i + 1), item: [...T.items].reverse().find((x) => x.from <= i + 1)?.names.join(','), folder: /path\.dirname\(fileURLToPath\(import\.meta\.url\)\)/.test(l) }); });
  out.push('', `import.meta.url: ${meta.length} uses; meaning the CLI: ${meta.filter((x) => !x.folder).length}; meaning the scripts folder: ${meta.filter((x) => x.folder).length}`);
  for (const x of meta) out.push(`- ${x.module}, in ${x.item}${x.folder ? ' (the folder)' : ''}`);
  const lets = decls.filter((x) => x.decl === 'let').flatMap((x) => x.names.map((nm) => ({ nm, line: x.line })));
  const sites = [];
  for (const { nm, line } of lets) {
    const e = nm.replace(/\$/g, '\\$');
    const re = new RegExp(`(?<![\\w$.])${e}\\s*(?:=(?!=)|\\+=|-=|\\*=|\\|\\|=|\\?\\?=|&&=|\\+\\+|--)|(?:\\+\\+|--)${e}(?![\\w$])`);
    for (let i = 1; i <= T.lines.length; i++) {
      if (i === line || !re.test(T.codeLines[i - 1])) continue;
      const om = moduleOf.get(i) !== moduleOf.get(line), os = sectionOf(i) !== sectionOf(line);
      if (om || os) sites.push({ nm, own: moduleOf.get(line), from: moduleOf.get(i), om, os });
    }
  }
  const nm = (f) => new Set(sites.filter(f).map((x) => x.nm)).size;
  out.push('', `Lets: ${lets.length} top-level; assigned from another module: ${nm((x) => x.om)} at ${sites.filter((x) => x.om).length} sites; from another banner section: ${nm((x) => x.os)} at ${sites.filter((x) => x.os).length} sites`);
  for (const n of new Set(sites.map((x) => x.nm))) { const ss = sites.filter((x) => x.nm === n); out.push(`- ${n} (${ss[0].own}): ${ss.length} sites, from ${[...new Set(ss.map((x) => x.from))].join(', ')}`); }
  const open = new Map(), regions = [];
  for (const it of T.items) if (it.kind === 'mark') { const [r, se] = it.names[0].split(' '); if (se === 'start') open.set(r, it.line); else if (open.has(r) && it.line - open.get(r) + 1 > 2000) regions.push(`${r} (${it.line - open.get(r) + 1} lines)`); }
  out.push('', `Marker regions over 2,000 lines: ${regions.join(', ') || 'none'}`);
  return out.join('\n');
}
