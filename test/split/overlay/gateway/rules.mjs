// The gateway's area of the overlay (cutover-tree@1, kit-894): the gateway runs from its modules.
//   here           `here` names the entry's folder (cloud/), where hub.html and ttyd.html sit beside
//                  gateway.mjs on the box, not the module's (cloud/gateway/).
//   gateway-source test/lib/gateway-source.mjs: the gateway's source as the single file had it, read
//                  from the tree, for tests that read the gateway's text (before entry, which replaces
//                  the source's text).
//   entry          cloud/gateway.mjs becomes the entry: the source's header, every module loaded in the
//                  manifest's order, the names the single file exported re-exported, and its command
//                  line, moved out of PAGES's module so it runs after every module has loaded and its
//                  main-module check (import.meta.url) is the entry's own.
//   test-reads     each test's read of cloud/gateway.mjs's text becomes gatewaySource() (rewireGatewayReads,
//                  exported for kit-893's one rule, which rewires the CLI's reads in the same files).
import { items } from '../../lib/js.mjs';
import { importLines, importPath, mentioned, strip } from '../../lib/split.mjs';
import { readModule } from '../../lib/verify.mjs';

export const SOURCE = 'cloud/gateway.mjs';
export const HELPER = 'test/lib/gateway-source.mjs';
const COMMAND_LINE = '// --- command line ';
const HERE_FROM = 'const here = path.dirname(fileURLToPath(import.meta.url));';
const HERE_TO = "const here = path.dirname(fileURLToPath(new URL('../gateway.mjs', import.meta.url)));";

const gatewayModules = (t) => t.modules().filter((m) => m.source === SOURCE).map((m) => m.file);
// The source's lines: its shebang, its header (up to the first import), its import lines as written.
function sourceParts(src) {
  const S = items(src);
  const imports = S.items.filter((x) => x.kind === 'import');
  if (!imports.length) return null;
  const first = imports[0].from, last = imports[imports.length - 1].to;
  const shebang = S.lines[0].startsWith('#!') ? S.lines[0] : null;
  return {
    shebang,
    head: S.lines.slice(shebang ? 1 : 0, first - 1),
    // an item runs on over the blank lines after it, which strip leaves in the body
    imports: S.lines.slice(first - 1, last).join('\n').replace(/\n+$/, '').split('\n'),
    exported: S.items.filter((x) => x.kind === 'decl' && x.exported).flatMap((x) => x.names),
  };
}

export const rules = [
  {
    name: 'here',
    apply(t) {
      const d = t.decl('here', SOURCE);
      if (!d) return { changed: [], refused: [{ site: 'here', why: 'the gateway declares no here' }] };
      if (d.text !== HERE_FROM) return { changed: [], refused: [{ site: `${d.file} here`, why: `here is not ${HERE_FROM}` }] };
      t.replace('here', HERE_TO, SOURCE);
      return { changed: [{ file: d.file, decl: 'here', site: `${d.file}: here is the entry's folder` }], refused: [] };
    },
  },
  {
    name: 'gateway-source',
    apply(t) {
      const sp = sourceParts(t.read(SOURCE) ?? '');
      if (!sp) return { changed: [], refused: [{ site: HELPER, why: 'no import statements in the source' }] };
      t.write(HELPER, helperText(gatewayModules(t), sp));
      return { changed: [{ file: HELPER, site: HELPER }], refused: [] };
    },
  },
  {
    name: 'entry',
    apply(t) {
      const src = t.read(SOURCE);
      const sp = src && sourceParts(src);
      if (!sp) return { changed: [], refused: [{ site: SOURCE, why: 'no import statements in the source' }] };
      const pages = t.decl('PAGES', SOURCE);
      const at = pages ? pages.text.indexOf(`\n${COMMAND_LINE}`) : -1;
      if (at < 0) return { changed: [], refused: [{ site: 'PAGES', why: `the command line (${COMMAND_LINE.trim()}) is not at the end of PAGES's item` }] };
      const block = pages.text.slice(at + 1);
      if (!/fileURLToPath\(import\.meta\.url\)/.test(block)) return { changed: [], refused: [{ site: 'the command line', why: 'it has no main-module check on import.meta.url' }] };
      t.replace('PAGES', pages.text.slice(0, at), SOURCE);
      const files = gatewayModules(t);
      // who declares each name, by the modules as they now are
      const owner = new Map();
      for (const f of files) for (const it of items(`${readModule(t.read(f)).body.join('\n')}\n`).items) if (it.kind === 'decl') for (const n of it.names) owner.set(n, f);
      const builtins = new Map(strip(src).imports.map((x) => [x.local, x.line]));
      const B = items(`${block}\n`);
      const needs = importLines(SOURCE, mentioned(B.codeLines), new Set(), owner, builtins);
      const byFile = new Map(files.map((f) => [f, []]));
      const missing = [];
      for (const n of sp.exported) { if (owner.has(n)) byFile.get(owner.get(n)).push(n); else missing.push(n); }
      if (missing.length) return { changed: [], refused: [{ site: SOURCE, why: `exported by the source but in no module: ${missing.join(', ')}` }] };
      const text = [
        sp.shebang ?? '#!/usr/bin/env node',
        ...sp.head,
        '// In the generated tree (test/split/overlay/gateway, kit-894) this file is the gateway\'s entry: it',
        '// loads every module under cloud/gateway/ in the manifest\'s order, re-exports the names the single',
        '// file exported, and runs its command line, whose main-module check is this file\'s.',
        ...needs,
        ...files.map((f) => `import '${importPath(SOURCE, f)}';`),
        ...files.filter((f) => byFile.get(f).length).map((f) => `export { ${byFile.get(f).sort().join(', ')} } from '${importPath(SOURCE, f)}';`),
        '',
        block.replace(/\n*$/, ''),
        '',
      ].join('\n');
      t.write(SOURCE, text);
      return { changed: [{ file: pages.file, decl: 'PAGES', site: 'the command line moved to the entry' }, { file: SOURCE, site: `the entry: ${files.length} modules, ${sp.exported.length} names re-exported, the command line` }], refused: [] };
    },
  },
  {
    name: 'test-reads',
    apply(t) {
      const changed = [], refused = [];
      for (const f of t.files()) {
        if (!/^test\/.*\.mjs$/.test(f) || f.startsWith('test/split/') || f.startsWith('test/split-') || f.startsWith('test/fixtures/') || f === HELPER) continue;
        const text = t.read(f);
        if (!text || !text.includes('gateway.mjs')) continue;
        const r = rewireGatewayReads(f, text);
        if (r.text !== text) t.write(f, r.text);
        for (const s of r.sites) changed.push({ file: f, site: s });
        for (const s of r.refused) refused.push({ site: `${f}: ${s.site}`, why: s.why });
      }
      return { changed, refused };
    },
  },
];

// The helper's text: it reads the tree's modules and entry when called, so it shows the tree as it is.
function helperText(files, sp) {
  return `// The gateway's source as the single file had it, from the generated tree's modules (written by
// test/split/overlay/gateway, kit-894): the shebang, the header, the import lines as written, then every
// module's body in the manifest's order with its imports region and each export the split added taken
// off, then the command line from the entry. Tests that read cloud/gateway.mjs's text read this.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES = ${JSON.stringify(files)};
const SHEBANG = ${JSON.stringify(sp.shebang)};
const HEAD = ${sp.head.length};
const IMPORTS = ${JSON.stringify(sp.imports)};
const EXPORTED = new Set(${JSON.stringify(sp.exported)});
const DECL = /^export ((?:async\\s+)?function\\*?\\s*|class\\s+|(?:const|let|var)\\s+)([A-Za-z_$][\\w$]*)/;

export function gatewaySource() {
  const body = [];
  for (const f of MODULES) {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const e = lines[0] === '/* imports start */' ? lines.indexOf('/* imports end */') : -1;
    for (const l of lines.slice(e + 1)) { const m = DECL.exec(l); body.push(m && !EXPORTED.has(m[2]) ? l.slice('export '.length) : l); }
  }
  const entry = fs.readFileSync(path.join(root, 'cloud', 'gateway.mjs'), 'utf8');
  const at = entry.indexOf('\\n${COMMAND_LINE}');
  const tail = at < 0 ? [] : entry.slice(at + 1).replace(/\\n$/, '').split('\\n');
  return \`\${[...(SHEBANG ? [SHEBANG] : []), ...body.slice(0, HEAD), ...IMPORTS, ...body.slice(HEAD), ...tail].join('\\n')}\\n\`;
}
`;
}

// One test file's reads of the gateway's text, rewired to gatewaySource(): { text, sites, refused }.
// The forms in use: a read of path.join(<dir>, ['..',] 'cloud', 'gateway.mjs'); a read of a const that
// names that path; and a read of path.join(<dir>, '..', <file>) in a file that names 'cloud/gateway.mjs'
// (gateway.test.mjs's of(file)), which reads the helper for that file alone. Any other read of the
// gateway's text on one line (readFileSync( with the gateway's path after it) is refused, so it shows in the
// report rather than reading the entry.
const GW_PATH = String.raw`path\.join\(\s*[A-Za-z_$][\w$]*\s*,\s*(?:'\.\.'\s*,\s*)?'cloud'\s*,\s*'gateway\.mjs'\s*\)`;
export function rewireGatewayReads(file, text) {
  const sites = [], refused = [];
  const lineOf = (s, i) => s.slice(0, i).split('\n').length;
  let out = text;
  const swap = (re, to, what) => {
    out = out.replace(re, (...a) => { const i = a[a.length - 2]; sites.push(`line ${lineOf(a[a.length - 1], i)}: ${what}`); return typeof to === 'function' ? to(...a) : to; });
  };
  swap(new RegExp(String.raw`fs\.readFileSync\(\s*${GW_PATH}\s*,\s*'utf8'\s*\)`, 'g'), 'gatewaySource()', 'a read of cloud/gateway.mjs');
  for (const m of [...text.matchAll(new RegExp(String.raw`^\s*const ([A-Za-z_$][\w$]*) = ${GW_PATH};$`, 'gm'))]) {
    swap(new RegExp(String.raw`fs\.readFileSync\(\s*${m[1].replace(/\$/g, '\\$')}\s*,\s*'utf8'\s*\)`, 'g'), 'gatewaySource()', `a read of ${m[1]} (cloud/gateway.mjs)`);
  }
  if (out.includes("'cloud/gateway.mjs'")) {
    swap(/fs\.readFileSync\(path\.join\(([A-Za-z_$][\w$]*), '\.\.', ([A-Za-z_$][\w$]*)\), 'utf8'\)/g,
      (all, dir, f) => `(${f} === 'cloud/gateway.mjs' ? gatewaySource() : ${all})`, 'a read of a named file, the gateway\'s through the helper');
  }
  // what is left that reads the gateway's text
  out.split('\n').forEach((l, i) => {
    if (/readFileSync\(.*(?:'cloud',\s*'gateway\.mjs'|cloud\/gateway\.mjs)/.test(l)) refused.push({ site: `line ${i + 1}`, why: `a read of the gateway's text the rule doesn't know: ${l.trim().slice(0, 100)}` });
  });
  if (sites.length) {
    const S = items(out);
    const imports = S.items.filter((x) => x.kind === 'import');
    const line = `import { gatewaySource } from '${importPath(file, HELPER)}';`;
    const lines = out.split('\n');
    if (!imports.length) refused.push({ site: 'imports', why: 'the file has no import statement to put the helper\'s after' });
    else {
      // the last import statement's own last line: from its first line to the line its ; ends (an item's
      // `to` runs on over what follows it, so it can't be the place)
      const last = imports[imports.length - 1];
      let end = last.from;
      while (end <= last.to && !/;\s*$/.test(S.codeLines[end - 1])) end++;
      if (end > last.to) refused.push({ site: `line ${last.from}`, why: 'the last import statement has no ; to put the helper\'s import after' });
      else {
        lines.splice(end, 0, line);
        out = lines.join('\n');
      }
    }
  }
  return { text: out, sites, refused };
}
