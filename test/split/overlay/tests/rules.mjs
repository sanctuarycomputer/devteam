// The tests' area of the overlay (cutover-tree@1, kit-893): the kit's tests run in the generated tree,
// finding the CLI's and the gateway's source through one helper each.
//   cli-source  test/lib/cli-source.mjs: the CLI's source as the single file had it, read from the
//               tree's modules when called (the shebang, the header, the import lines as written, then
//               every module's body in the manifest's order with its imports region and each export
//               the split added taken off).
//   test-reads  in every test, every node:fs read goes through cliRead, which
//               answers a read of the tree's docs/devteam/scripts/devteam.mjs with cliSource() when it
//               runs; and (when the gateway's area wrote its helper) each read of cloud/gateway.mjs's
//               text becomes gatewaySource(). The rewrites are rewireCliReads and rewireGatewayReads
//               (kit-894's, moved here); finding.mjs replays them for the parity run's test-change check.
// The rule refuses nothing, so a test it can't match would need a patch here; there is none.
import path from 'node:path';
import { items, scan } from '../../lib/js.mjs';
import { importPath } from '../../lib/split.mjs';
import fs from 'node:fs';

export const CLI = 'docs/devteam/scripts/devteam.mjs';
export const CLI_HELPER = 'test/lib/cli-source.mjs';
export const GATEWAY_HELPER = 'test/lib/gateway-source.mjs'; // written by the gateway's area

// The files the rule reads: every .mjs under test/ (the fixtures' helpers too) but the split's own, its
// tests and the two helpers. The gateway's rewrite keeps kit-894's set, which leaves the fixtures out.
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
        if (!isTestFile(f)) continue;
        const text = t.read(f);
        if (!text) continue;
        const r = rewireReads(f, text, { gateway });
        if (r.text !== text) t.write(f, r.text);
        for (const s of r.sites) changed.push({ file: f, site: s });
        for (const s of r.refused) refused.push({ site: `${f}: ${s.site}`, why: s.why });
      }
      return { changed, refused };
    },
  },
];

// Both rewrites on one test file, the gateway's first: { text, sites, refused }.
export function rewireReads(file, text, { gateway = true } = {}) {
  const g = gateway && gatewayFile(file) ? rewireGatewayReads(file, text) : { text, sites: [], refused: [] };
  const c = rewireCliReads(file, g.text);
  return { text: c.text, sites: [...g.sites, ...c.sites], refused: [...g.refused, ...c.refused] };
}

function cliHelperText(files, sp, strip) {
  return `// The CLI's source as the single file had it, from the generated tree's modules (written by
// test/split/overlay/tests, kit-893): the shebang, the header, the import lines as written, then every
// module's body in the manifest's order with its imports region and each export the split added taken
// off. The kit's tests make every node:fs read through cliRead (or
// cliReadAsync), which answers a read of the tree's devteam.mjs with this text.
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

// The tree's devteam.mjs, as a read names it (a path, a file: URL or a Buffer); a file descriptor or
// anything else is not it.
const CLI = path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs');
function isCli(p) {
  let s;
  if (typeof p === 'string') s = p;
  else if (p instanceof URL) { if (p.protocol !== 'file:') return false; s = fileURLToPath(p); }
  else if (Buffer.isBuffer(p)) s = p.toString();
  else return false;
  return path.resolve(s) === CLI;
}
// The text as the read asked for it: a string with an encoding, else a Buffer.
function answer(opts) {
  const enc = typeof opts === 'string' ? opts : opts?.encoding;
  const text = cliSource();
  return enc ? Buffer.from(text).toString(enc) : Buffer.from(text);
}
// fn.call(self, p, opts, ...rest), unless p is the tree's devteam.mjs: then the single file's text.
export function cliRead(fn, self, p, opts, ...rest) {
  return isCli(p) ? answer(opts) : fn.call(self, p, opts, ...rest);
}
export function cliReadAsync(fn, self, p, opts, ...rest) {
  return isCli(p) ? Promise.resolve().then(() => answer(opts)) : fn.call(self, p, opts, ...rest);
}
// fs.readFile's callback form: the text on the next tick, or fn's own read.
export function cliReadCallback(fn, self, p, ...args) {
  if (!isCli(p)) return fn.call(self, p, ...args);
  const cb = args[args.length - 1];
  let text;
  try { text = answer(args.length > 1 ? args[0] : undefined); } catch (err) { process.nextTick(cb, err); return; }
  process.nextTick(cb, null, text);
}
// A read function handed on as a value (an injected io.readFile): one that reads through cliRead.
export const cliReader = (fn, self) => (p, opts, ...rest) => cliRead(fn, self, p, opts, ...rest);
export const cliReaderAsync = (fn, self) => (p, opts, ...rest) => cliReadAsync(fn, self, p, opts, ...rest);
`;
}

// ---- the CLI's reads: every node:fs read call in a test that names the CLI goes through cliRead ----

// The names a file binds to node:fs: { ns: names of the module (default or namespace import of 'fs' or
// 'node:fs'), sync: bare readFileSync locals, promises: names of 'fs/promises' modules, async: bare
// readFile locals from 'fs/promises' }.
export function fsNames(text) {
  const out = { ns: new Set(), sync: new Set(), promises: new Set(), async: new Set() };
  for (const it of items(text).items) {
    if (it.kind !== 'import') continue;
    const m = text.split('\n').slice(it.from - 1, it.to).join(' ').replace(/\s+/g, ' ').match(/^import (.+?) from (['"])(node:)?(fs|fs\/promises)\2/);
    if (!m) continue;
    const promises = m[4] === 'fs/promises';
    const clause = m[1];
    const head = clause.replace(/\{.*\}/, '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const h of head) { const n = h.replace(/^\* as /, ''); if (/^[A-Za-z_$][\w$]*$/.test(n)) (promises ? out.promises : out.ns).add(n); }
    const named = clause.match(/\{(.*)\}/)?.[1] ?? '';
    for (const b of named.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [imp, loc = imp] = b.split(/\s+as\s+/).map((s) => s.trim());
      if (!promises && imp === 'readFileSync') out.sync.add(loc);
      if (!promises && imp === 'promises') out.promises.add(loc);
      if (promises && imp === 'readFile') out.async.add(loc);
    }
  }
  return out;
}

// One test file's node:fs reads, each through the helper: { text, sites, refused }. Every test file is
// read, whether or not it names the CLI: a path can come from another module (box-health-park's SCRIPT,
// imported from a fixture). In its code (comments, strings and templates blanked), each call
//   <fs>.readFileSync(…)          becomes cliRead(<fs>.readFileSync, <fs>, …)
//   readFileSync(…)  (imported)   becomes cliRead(readFileSync, undefined, …)
//   <fs>.promises.readFile(…), <fsp>.readFile(…), readFile(…) (imported from fs/promises)
//                                 become cliReadAsync(<the same function>, <its object>, …)
// Only the callee changes: the arguments and the closing paren stay as written, so a read is still
// made by the same function, looked up when it runs (a stub or a patched fs still answers), and
// cliRead answers with the tree's CLI source only when the path is the tree's devteam.mjs. A second
// pass changes nothing (the callee is no longer followed by its paren). Nothing is refused.
export function rewireCliReads(file, text) {
  const names = fsNames(text);
  const code = scan(text).code;
  const id = (n) => n.replace(/\$/g, '\\$');
  const alt = (set) => [...set].map(id).join('|');
  const edits = [];
  const add = (re, to) => { for (const m of code.matchAll(re)) edits.push([m.index, m.index + m[0].length, to(m)]); };
  const B = String.raw`(?<![\w$])(?<!(?:^|[^.])\.)`; // not a member's name (a spread's ... is not a member's dot)
  let sync = 0, async = 0, callback = 0, reader = 0, readerAsync = 0;
  if (names.ns.size) {
    add(new RegExp(String.raw`${B}(${alt(names.ns)})\s*\.\s*readFileSync\s*\(`, 'g'), (m) => { sync++; return `cliRead(${m[1]}.readFileSync, ${m[1]}, `; });
    add(new RegExp(String.raw`${B}(${alt(names.ns)})\s*\.\s*promises\s*\.\s*readFile\s*\(`, 'g'), (m) => { async++; return `cliReadAsync(${m[1]}.promises.readFile, ${m[1]}.promises, `; });
    add(new RegExp(String.raw`${B}(${alt(names.ns)})\s*\.\s*readFile\s*\(`, 'g'), (m) => { callback++; return `cliReadCallback(${m[1]}.readFile, ${m[1]}, `; });
    // the same functions handed on as a value (not called, not assigned to, not compared, not already a
    // cli* argument)
    const value = String.raw`(?!\s*[(\w$]|\s*=(?!=)|\s*[=!]==?)`;
    const notArg = String.raw`(?<!cli\w*\(\s*)(?<![=!]==?\s*)`;
    add(new RegExp(String.raw`${notArg}${B}(${alt(names.ns)})\s*\.\s*readFileSync\b${value}`, 'g'), (m) => { reader++; return `cliReader(${m[1]}.readFileSync, ${m[1]})`; });
    add(new RegExp(String.raw`${notArg}${B}(${alt(names.ns)})\s*\.\s*promises\s*\.\s*readFile\b${value}`, 'g'), (m) => { readerAsync++; return `cliReaderAsync(${m[1]}.promises.readFile, ${m[1]}.promises)`; });
  }
  if (names.promises.size) add(new RegExp(String.raw`${B}(${alt(names.promises)})\s*\.\s*readFile\s*\(`, 'g'), (m) => { async++; return `cliReadAsync(${m[1]}.readFile, ${m[1]}, `; });
  if (names.sync.size) add(new RegExp(String.raw`${B}(${alt(names.sync)})\s*\(`, 'g'), (m) => { sync++; return `cliRead(${m[1]}, undefined, `; });
  if (names.async.size) add(new RegExp(String.raw`${B}(${alt(names.async)})\s*\(`, 'g'), (m) => { async++; return `cliReadAsync(${m[1]}, undefined, `; });
  if (!edits.length) return { text, sites: [], refused: [] };
  let out = text;
  for (const [s, e, r] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, s) + r + out.slice(e);
  const want = [sync ? 'cliRead' : null, async ? 'cliReadAsync' : null, callback ? 'cliReadCallback' : null, reader ? 'cliReader' : null, readerAsync ? 'cliReaderAsync' : null].filter(Boolean).join(', ');
  out = addImport(out, `import { ${want} } from '${importPath(file, CLI_HELPER)}';`);
  return { text: out, sites: [`${edits.length} node:fs read${edits.length === 1 ? '' : 's'} through ${want}`], refused: [] };
}

// The import line put after the file's last import statement, or first (after a shebang) if it has none.
function addImport(text, line) {
  const S = items(text);
  const imports = S.items.filter((x) => x.kind === 'import');
  const lines = text.split('\n');
  if (!imports.length) { lines.splice(lines[0]?.startsWith('#!') ? 1 : 0, 0, line); return lines.join('\n'); }
  const last = imports[imports.length - 1];
  let end = last.line;
  while (end < lines.length && !/;\s*$/.test(S.codeLines[end - 1])) end++;
  lines.splice(end, 0, line);
  return lines.join('\n');
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
