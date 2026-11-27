// The tests' area of the overlay (cutover-tree@1, kit-893): the kit's tests run in the generated tree,
// finding the CLI's and the gateway's source through one helper each.
//   cli-source  test/lib/cli-source.mjs: the CLI's source as the single file had it, read from the
//               tree's modules when called (the shebang, the header, the import lines as written, then
//               every module's body in the manifest's order with its imports region and each export
//               the split added taken off).
//   test-reads  (when the gateway's area wrote its helper) each read of cloud/gateway.mjs's text becomes
//               gatewaySource(). The rewrite is rewireGatewayReads (kit-894's, moved here).
// The rule refuses nothing it can rewrite, so a test it can't match would need a patch here; there is none.
import { items } from '../../lib/js.mjs';
import { importPath } from '../../lib/split.mjs';

export const CLI = 'docs/devteam/scripts/devteam.mjs';
export const CLI_HELPER = 'test/lib/cli-source.mjs';
export const GATEWAY_HELPER = 'test/lib/gateway-source.mjs'; // written by the gateway's area

// The files the rule reads: every .mjs under test/ but the split's own, its tests and the two helpers. The
// gateway's rewrite keeps kit-894's set, which leaves the fixtures out.
export const isTestFile = (f) => /^test\/.*\.mjs$/.test(f) && !f.startsWith('test/split/') && !f.startsWith('test/split-') && f !== CLI_HELPER && f !== GATEWAY_HELPER;
export const gatewayFile = (f) => isTestFile(f) && !f.startsWith('test/fixtures/');

// The source's lines before its declarations: its shebang, its header (up to the first import) and its
// import lines as written.
export function sourceParts(src) {
  const S = items(src);
  const imports = S.items.filter((x) => x.kind === 'import');
  if (!imports.length) return null;
  const first = imports[0].from;
  // the last import statement's own last line: an item's `to` runs on over what follows it (blank
  // lines, and in the CLI the top-level statements before the first declaration)
  const lastItem = imports[imports.length - 1];
  let last = lastItem.line;
  while (last < S.lines.length && !/;\s*$/.test(S.codeLines[last - 1])) last++;
  const shebang = S.lines[0].startsWith('#!') ? S.lines[0] : null;
  return {
    shebang,
    head: S.lines.slice(shebang ? 1 : 0, first - 1),
    imports: S.lines.slice(first - 1, last),
  };
}

export const rules = [
  {
    name: 'cli-source',
    apply(t) {
      const sp = sourceParts(t.read(CLI) ?? '');
      if (!sp) return { changed: [], refused: [{ site: CLI_HELPER, why: `no import statements in ${CLI} as the rules see it` }] };
      const files = t.modules().filter((m) => m.source === CLI).map((m) => m.file);
      if (!files.length) return { changed: [], refused: [{ site: CLI_HELPER, why: `the split makes no module of ${CLI}` }] };
      const C = items(t.read(CLI));
      const exported = new Set(C.items.filter((x) => x.kind === 'decl' && x.exported).map((x) => C.lines[x.line - 1]));
      // per module, the declaration lines the split exported and the single file did not: cliSource
      // takes "export " off exactly these lines (a template's line that looks like one is left)
      const strip = files.map((m) => { const M = items(t.read(m)); return M.items.filter((x) => x.kind === 'decl' && x.exported && !exported.has(M.lines[x.line - 1])).map((x) => M.lines[x.line - 1]); });
      t.write(CLI_HELPER, cliHelperText(files, sp, strip));
      return { changed: [{ file: CLI_HELPER, site: `${CLI_HELPER}: ${files.length} modules` }], refused: [] };
    },
  },
  {
    name: 'test-reads',
    apply(t) {
      const changed = [], refused = [];
      const gateway = t.read(GATEWAY_HELPER) !== null;
      for (const f of t.files()) {
        if (!gateway || !gatewayFile(f)) continue;
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

function cliHelperText(files, sp, strip) {
  return `// The CLI's source as the single file had it, from the generated tree's modules (written by
// test/split/overlay/tests, kit-893): the shebang, the header, the import lines as written, then every
// module's body in the manifest's order with its imports region and each export the split added taken
// off.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULES = ${JSON.stringify(files)};
const SHEBANG = ${JSON.stringify(sp.shebang)};
const HEAD = ${sp.head.length};
const IMPORTS = ${JSON.stringify(sp.imports)};
const STRIP = ${JSON.stringify(strip)}; // per module, the lines the split exported that the single file did not

export function cliSource() {
  const body = [];
  MODULES.forEach((f, i) => {
    const lines = fs.readFileSync(path.join(root, f), 'utf8').split('\\n');
    if (lines[lines.length - 1] === '') lines.pop();
    const e = lines[0] === '/* imports start */' ? lines.indexOf('/* imports end */') : -1;
    const strip = new Set(STRIP[i]);
    for (const l of lines.slice(e + 1)) body.push(strip.has(l) ? l.slice('export '.length) : l);
  });
  return \`\${[...(SHEBANG ? [SHEBANG] : []), ...body.slice(0, HEAD), ...IMPORTS, ...body.slice(HEAD)].join('\\n')}\\n\`;
}
`;
}

// ---- the gateway's reads (kit-894's rewrite, moved here from overlay/gateway/rules.mjs) ----

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
    const line = `import { gatewaySource } from '${importPath(file, GATEWAY_HELPER)}';`;
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
