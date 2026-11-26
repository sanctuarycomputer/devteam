// The overlay (cutover-tree@1): what the split tool applies to a split, from every folder under
// <split dir>/overlay/, in name order. A folder may hold:
//   rules.mjs   export const rules = [{ name, apply(t) }] and checks = [{ name, run(t) }]. Each returns
//               { changed: [{ file?, decl?, item?, site? }], refused: [{ site, why }] }: the sites it
//               changed (a declaration named here is one --verify accepts as changed, and so is an item
//               that is no declaration, named with its module: item '(head)', the lines before a
//               module's first declaration, or 'marker <name> start|end', a marker line and the statements
//               after it) and those it refused.
//   overrides/  <any>.mjs: line 1 is `// override <name> sha256:<64 hex>[ in <source>]`, the hash of the
//               declaration it was written against; the rest replaces that declaration's whole item.
//   files/      files at their tree paths, written over whatever the tree has there.
//   patches/    *.patch files, applied with git apply in the tree, by file name.
//   README.md   for people. Anything else in a folder (another tool's file) is listed as ignored.
// Order: overrides, then each folder's rules, then every check, then the imports regions are made
// again, then files; split.mjs then writes the tree and applies the patches. Stale (named, the tree
// still written): an override whose original changed or is gone, a patch that no longer applies, a
// rule site refused or one the tool can't place, a rule or check that threw. Conflict (named with both
// folders, neither applied): two folders writing one tree file or overriding one declaration; a patch
// that applies alone but not after another folder's patch to the same file.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { items } from './js.mjs';
import { importLines, mentioned, region } from './split.mjs';
import { readModule } from './verify.mjs';

export const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const HEADER = /^\/\/ override ([A-Za-z_$][\w$]*) sha256:([0-9a-f]{64})(?: in (\S+))?$/;
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const ENTRIES = { 'rules.mjs': 'file', 'README.md': 'file', overrides: 'dir', files: 'dir', patches: 'dir' };
const posixRel = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\0\\]+$/; // relative, no . or .. part, no backslash

// Every plain file under dir (posix paths relative to it); a link or anything else is a problem.
function walk(dir, problems, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort(byName)) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, problems, r));
    else if (e.isFile()) out.push(r);
    else problems.push(`${path.join(dir, r)} is ${e.isSymbolicLink() ? 'a link' : 'not a plain file'}; the overlay holds plain files only`);
  }
  return out;
}

// The overlay folders under splitDir/overlay, read and checked: { folders, problems, ignored }. A problem means
// the overlay itself is malformed, and the tool refuses (exit 2) before writing anything.
export async function loadOverlay(splitDir) {
  const root = path.join(splitDir, 'overlay');
  const problems = [];
  const folders = [];
  const ignored = [];
  const st = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!st) return { folders, problems, ignored };
  if (!st.isDirectory()) return { folders, problems: [`${root} is not a folder`], ignored };
  for (const e of fs.readdirSync(root, { withFileTypes: true }).sort(byName)) {
    // anything else (a file beside the folders, another tool's file in a folder: parity's finding.mjs)
    // is not the split's to read; it is listed as ignored, so a misspelt name shows
    if (!e.isDirectory() || e.name.startsWith('.')) { ignored.push(`overlay/${e.name}`); continue; }
    const dir = path.join(root, e.name);
    const f = { name: e.name, dir, rules: [], checks: [], overrides: [], files: [], patches: [] };
    for (const x of fs.readdirSync(dir, { withFileTypes: true }).sort(byName)) {
      const want = ENTRIES[x.name];
      if (!want) ignored.push(`overlay/${e.name}/${x.name}`);
      else if (want === 'file' ? !x.isFile() : !x.isDirectory()) problems.push(`overlay/${e.name}/${x.name} must be a ${want === 'file' ? 'plain file' : 'folder'}`);
    }
    const rulesFile = path.join(dir, 'rules.mjs');
    if (fs.lstatSync(rulesFile, { throwIfNoEntry: false })?.isFile()) {
      try {
        const m = await import(pathToFileURL(rulesFile).href);
        for (const [key, fn] of [['rules', 'apply'], ['checks', 'run']]) {
          const list = m[key] ?? [];
          if (!Array.isArray(list)) { problems.push(`overlay/${e.name}/rules.mjs: ${key} is not an array`); continue; }
          const seen = new Set();
          for (const r of list) {
            if (!r || typeof r.name !== 'string' || !r.name || typeof r[fn] !== 'function') problems.push(`overlay/${e.name}/rules.mjs: each of ${key} needs a name and a ${fn} function`);
            else if (seen.has(r.name)) problems.push(`overlay/${e.name}/rules.mjs: two ${key} named ${r.name}`);
            else { seen.add(r.name); f[key].push(r); }
          }
        }
      } catch (err) { problems.push(`overlay/${e.name}/rules.mjs failed to load: ${err?.message ?? err}`); }
    }
    const sub = (k) => { const d = path.join(dir, k); return fs.lstatSync(d, { throwIfNoEntry: false })?.isDirectory() ? d : null; };
    const od = sub('overrides');
    if (od) {
      const names = new Set();
      for (const r of walk(od, problems)) {
        const at = `overlay/${e.name}/overrides/${r}`;
        if (r.includes('/') || !r.endsWith('.mjs')) { problems.push(`${at}: overrides/ holds only <name>.mjs files`); continue; }
        const text = fs.readFileSync(path.join(od, r), 'utf8');
        const nl = text.indexOf('\n');
        const h = (nl < 0 ? text : text.slice(0, nl)).match(HEADER);
        if (!h) { problems.push(`${at}: line 1 must be // override <name> sha256:<64 hex>[ in <source>]`); continue; }
        const body = text.slice(nl + 1).replace(/\n$/, '');
        if (!body.trim()) { problems.push(`${at}: no replacement after line 1`); continue; }
        if (names.has(h[1])) { problems.push(`${at}: a second override of ${h[1]} in this folder`); continue; }
        names.add(h[1]);
        f.overrides.push({ file: r, name: h[1], pin: h[2], source: h[3] ?? null, text: body });
      }
    }
    const fd = sub('files');
    if (fd) for (const r of walk(fd, problems)) f.files.push({ path: r, abs: path.join(fd, r) });
    const pd = sub('patches');
    if (pd) for (const r of walk(pd, problems)) {
      if (r.includes('/') || !r.endsWith('.patch')) problems.push(`overlay/${e.name}/patches/${r}: patches/ holds only *.patch files`);
      else f.patches.push({ file: r, abs: path.join(pd, r) });
    }
    folders.push(f);
  }
  return { folders, problems, ignored };
}

// A module's text parsed once, cached by the text itself: every top-level item of its body, keyed as
// verify keys them (a declaration by its names, a marker by its name, the head), with its text
// (export taken off a declaration's own line) and its lines in the file (1-based).
const parsedCache = new Map();
function parse(text) {
  let p = parsedCache.get(text);
  if (p) return p;
  const { region: reg, body } = readModule(text);
  const off = reg ? reg.length + 2 : 0;
  const U = items(body.length ? `${body.join('\n')}\n` : '');
  const all = U.items.map((it) => {
    const ls = U.lines.slice(it.from - 1, it.to);
    if (it.kind === 'decl') ls[it.line - it.from] = ls[it.line - it.from].replace(/^export\s+/, '');
    const key = it.kind === 'decl' ? it.names.join(',') : it.kind === 'mark' ? `marker ${it.names[0]}` : '(head)';
    return { kind: it.kind, key, names: it.kind === 'decl' ? it.names : [], text: ls.join('\n'), from: it.from + off, to: it.to + off };
  });
  p = { U, all, decls: all.filter((x) => x.kind === 'decl') };
  if (parsedCache.size > 4000) parsedCache.clear();
  parsedCache.set(text, p);
  return p;
}
// A declaration in a module's text, by one of its names: { names, key, text, from, to }, or null.
export function findDecl(text, name) { return parse(text).decls.find((d) => d.names.includes(name)) ?? null; }
export const findDecls = (text, name) => parse(text).decls.filter((d) => d.names.includes(name));
// An item that is no declaration, by its key: '(head)' or 'marker <name> start|end'.
export const ITEM_KEY = /^(?:\(head\)|marker [A-Za-z0-9_$.-]+ (?:start|end))$/;
export const findItems = (text, key) => parse(text).all.filter((x) => x.kind !== 'decl' && x.key === key);
// What --verify accepts by one name: a declaration's, or an item's key.
const findAccepted = (text, name) => (ITEM_KEY.test(name) ? findItems(text, name) : findDecls(text, name));
// The module with lines from..to replaced by a declaration text, export put on each of its
// declarations' own lines.
export function spliceDecl(text, from, to, bare) {
  const lines = text.split('\n');
  const nl = bare === '' ? [] : bare.split('\n');
  for (const it of items(bare === '' ? '' : `${bare}\n`).items) if (it.kind === 'decl' && !it.exported) nl[it.line - 1] = `export ${nl[it.line - 1]}`;
  lines.splice(from - 1, to - from + 1, ...nl);
  return lines.join('\n');
}
// Each module's imports region made again from its own body: owner maps every name declared in the
// given modules to its file, builtins the source's own imports.
export function remakeRegions(files, getText, builtins) {
  const owner = new Map();
  for (const f of files) for (const d of parse(getText(f)).decls) for (const n of d.names) owner.set(n, f);
  return new Map(files.map((f) => {
    const p = parse(getText(f));
    const { body } = readModule(getText(f));
    const own = new Set(p.decls.flatMap((d) => d.names));
    return [f, `${[...region(importLines(f, mentioned(p.U.codeLines), own, owner, builtins)), ...body].join('\n')}\n`];
  }));
}
// The items (by key) whose text differs between two versions of a module: the declarations (or
// markers, or the head) a change touched.
function touchedKeys(before, after) {
  const count = new Map();
  for (const x of parse(before).all) count.set(`${x.key}\0${x.text}`, (count.get(`${x.key}\0${x.text}`) ?? 0) + 1);
  for (const x of parse(after).all) count.set(`${x.key}\0${x.text}`, (count.get(`${x.key}\0${x.text}`) ?? 0) - 1);
  return [...new Set([...count].filter(([, c]) => c).map(([k]) => k.split('\0')[0]))];
}

// One pass of the overlay in memory, leaving out the items in `excluded` (ids `<area>\0<kind>\0<name>`).
// Every item that changes the tree records claims: { file, decl } (decl a declaration's key, or null
// for the whole file), found from what it changed, not from what it names.
async function attempt({ folders, builds, show, paths, sha, excluded }) {
  const applied = [], stale = [], claims = [];
  const text = new Map();
  const modules = new Map(); // module file -> manifest source
  for (const { M, b } of builds) {
    for (const m of b.modules) { text.set(m.file, m.text); modules.set(m.file, M.source); }
    if (b.entry) text.set(b.entry.file, b.entry.text);
  }
  const base = new Map(text); // the split before the overlay
  const accepted = new Map(builds.map(({ M }) => [M.source, new Set()]));
  const read = (staged, f) => (staged?.has(f) ? staged.get(f) : text.has(f) ? text.get(f) : show(f));
  const locate = (staged, name, source) => {
    const hits = [];
    for (const [f, src] of modules) {
      if (source && src !== source) continue;
      for (const d of findDecls(read(staged, f), name)) hits.push({ file: f, source: src, ...d });
    }
    return hits;
  };
  const isOut = (area, kind, name) => excluded.has(`${area}\0${kind}\0${name}`);
  const claim = (area, kind, name, file, decl) => claims.push({ area, kind, name, file, decl });
  const staleOf = (area, kind, name, why) => stale.push({ area, kind, name, why });

  for (const f of folders) for (const o of f.overrides) {
    if (isOut(f.name, 'override', o.name)) continue;
    const hits = locate(null, o.name, o.source);
    if (!hits.length) { staleOf(f.name, 'override', o.name, `no declaration ${o.name}${o.source ? ` in ${o.source}` : ''} in the split`); continue; }
    if (hits.length > 1) { staleOf(f.name, 'override', o.name, `${o.name} is declared in ${hits.map((h) => h.file).join(' and ')}; name the source with "in <source>"`); continue; }
    // pinned against the split's own text, so a second area's override of it conflicts, never goes stale
    const [d] = hits;
    const orig = findDecls(base.get(d.file), o.name)[0];
    const now = hash(orig?.text ?? '');
    if (now !== o.pin) { staleOf(f.name, 'override', o.name, `the original changed: it is now sha256:${now}, the override was written against sha256:${o.pin}`); continue; }
    text.set(d.file, spliceDecl(read(null, d.file), d.from, d.to, o.text));
    accepted.get(d.source).add(o.name);
    claim(f.name, 'override', o.name, d.file, d.key);
    applied.push({ area: f.name, kind: 'override', name: o.name, sites: [d.file] });
  }

  // the view a rule or check works through; a rule's writes land only if it returns
  const view = (staged, readOnly) => {
    const no = () => { throw new Error('a check changes nothing'); };
    const one = (name, source) => {
      const hits = locate(staged, name, source);
      if (hits.length > 1) throw new Error(`${name} is declared in ${hits.map((h) => h.file).join(' and ')}; name the source`);
      return hits[0] ?? null;
    };
    return {
      sha,
      files: () => [...new Set([...paths, ...text.keys(), ...(staged?.keys() ?? [])])].sort(),
      modules: () => [...modules].map(([file, source]) => ({ file, source })),
      read: (f) => read(staged, f),
      decl: (name, source) => { const h = one(name, source); return h && { file: h.file, source: h.source, names: h.names, text: h.text }; },
      write: readOnly ? no : (f, t) => {
        if (typeof f !== 'string' || !posixRel.test(f)) throw new Error(`write: ${f} is not a tree path`);
        if (typeof t !== 'string') throw new Error(`write: ${f}: the text must be a string`);
        staged.set(f, t);
      },
      replace: readOnly ? no : (name, t, source) => {
        const h = one(name, source);
        if (!h) throw new Error(`replace: no declaration ${name}`);
        if (typeof t !== 'string') throw new Error(`replace: ${name}: the text must be a string`);
        staged.set(h.file, spliceDecl(read(staged, h.file), h.from, h.to, t));
      },
    };
  };
  const sitesOf = (area, kind, r, res, staged) => {
    if (!res || typeof res !== 'object' || !Array.isArray(res.changed ?? []) || !Array.isArray(res.refused ?? [])) {
      staleOf(area, kind, r.name, 'returned no { changed, refused } arrays');
      return null;
    }
    const sites = [];
    for (const s of res.changed ?? []) {
      if (!s || typeof s !== 'object' || (!s.decl && !s.file)) { staleOf(area, kind, r.name, `a changed site names neither a file nor a declaration: ${JSON.stringify(s)}`); continue; }
      if (s.item !== undefined) {
        // an item that is no declaration: named with its module, there exactly once
        if (s.decl || typeof s.item !== 'string' || !ITEM_KEY.test(s.item)) { staleOf(area, kind, r.name, `a changed item must be '(head)' or 'marker <name> start|end', alone: ${JSON.stringify(s)}`); continue; }
        if (!s.file || !modules.has(s.file)) { staleOf(area, kind, r.name, `names ${s.item} as changed, but ${s.file ?? '(no file)'} is not a module the split makes`); continue; }
        const n = findItems(read(staged, s.file), s.item).length;
        if (n !== 1) { staleOf(area, kind, r.name, `names ${s.item} in ${s.file} as changed, but the tool can't place it: it is there ${n} times`); continue; }
        if (kind === 'rule') accepted.get(modules.get(s.file)).add(s.item);
        sites.push([s.file, s.item, s.site ?? ''].filter(Boolean).join(' '));
        continue;
      }
      if (s.decl) {
        const hits = locate(staged, s.decl, null).filter((h) => !s.file || h.file === s.file);
        if (hits.length !== 1) { staleOf(area, kind, r.name, `names ${s.decl}${s.file ? ` in ${s.file}` : ''} as changed, but the tool can't place it: ${hits.length ? `it is in ${hits.map((h) => h.file).join(' and ')}` : 'it is in no module'}`); continue; }
        if (kind === 'rule') accepted.get(hits[0].source).add(s.decl);
      }
      sites.push([s.file ?? '', s.decl ?? '', s.site ?? ''].filter(Boolean).join(' '));
    }
    for (const s of res.refused ?? []) staleOf(area, kind, r.name, `refused ${s?.site ?? '(no site)'}: ${s?.why ?? '(no reason)'}`);
    return sites;
  };
  for (const f of folders) for (const r of f.rules) {
    if (isOut(f.name, 'rule', r.name)) continue;
    const staged = new Map();
    let res;
    try { res = await r.apply(view(staged, false)); } catch (err) { staleOf(f.name, 'rule', r.name, `threw: ${err?.message ?? err}`); continue; }
    const sites = sitesOf(f.name, 'rule', r, res, staged);
    if (!sites) continue;
    for (const [k, v] of staged) {
      if (modules.has(k)) for (const key of touchedKeys(read(null, k), v)) claim(f.name, 'rule', r.name, k, key);
      else if (v !== read(null, k)) claim(f.name, 'rule', r.name, k, null);
      text.set(k, v);
    }
    applied.push({ area: f.name, kind: 'rule', name: r.name, sites });
  }
  for (const f of folders) for (const c of f.checks) {
    let res;
    try { res = await c.run(view(null, true)); } catch (err) { staleOf(f.name, 'check', c.name, `threw: ${err?.message ?? err}`); continue; }
    const sites = sitesOf(f.name, 'check', c, res, null);
    if (sites) applied.push({ area: f.name, kind: 'check', name: c.name, sites });
  }
  for (const { M, b } of builds) {
    const files = [...modules].filter(([, s]) => s === M.source).map(([f]) => f);
    for (const [f, t] of remakeRegions(files, (x) => text.get(x), b.builtins)) text.set(f, t);
    // a module the overlay grew past the cap
    for (const f of files) { const n = text.get(f).split('\n').length - 1; if (n > (M.cap ?? 2000)) staleOf('(overlay)', 'cap', f, `${f} is ${n} lines after the overlay, over the cap of ${M.cap ?? 2000}`); }
  }
  const files = [];
  for (const f of folders) for (const x of f.files) {
    if (isOut(f.name, 'file', x.path)) continue;
    // a generated module is changed by declaration (an override or a rule), never replaced whole
    if (modules.has(x.path)) { staleOf(f.name, 'file', x.path, `${x.path} is a module the split generates; change its declarations with an override or a rule`); continue; }
    files.push({ ...x, area: f.name });
    claim(f.name, 'file', x.path, x.path, null);
    applied.push({ area: f.name, kind: 'file', name: x.path, sites: [x.path] });
  }
  return { text, modules, files, accepted, applied, stale, claims };
}

// Apply overrides, rules, checks and files to a split in memory.
//   builds: [{ M, b }] (split.mjs's build per manifest); show(file): the file's text at the commit or
//   null; paths: every file the commit tracks.
// Two areas whose items claim one tree file, or one declaration, conflict: both items are left out
// and the overlay runs again without them, so neither is applied, whatever the folder order.
// Returns { text: Map<file, text> (every generated file and every file a rule wrote), modules:
// Map<file, source>, files: [{ path, abs, area }] (files/ files to write), accepted: Map<source,
// Set<name>>, report: { areas, ignored, applied, stale, conflicts } }.
export async function applyOverlay({ folders, ignored = [], builds, show, paths, sha = '' }) {
  const excluded = new Set();
  const conflicts = new Map();
  for (;;) {
    const r = await attempt({ folders, builds, show, paths, sha, excluded });
    let fresh = false;
    for (let i = 0; i < r.claims.length; i++) for (let j = i + 1; j < r.claims.length; j++) {
      const a = r.claims[i], b = r.claims[j];
      if (a.area === b.area || a.file !== b.file || (a.decl && b.decl && a.decl !== b.decl)) continue;
      const decl = a.decl && b.decl ? a.decl : null;
      const kind = decl ? 'declaration' : 'file';
      const name = decl ?? a.file;
      const k = `${kind}\0${name}\0${a.area}\0${b.area}`;
      const ids = [a, b].map((x) => `${x.area}\0${x.kind}\0${x.name}`);
      if (!conflicts.has(k)) conflicts.set(k, { kind, name, areas: [a.area, b.area].sort((x, y) => (x < y ? -1 : 1)), why:`${a.area}'s ${a.kind} ${a.name} and ${b.area}'s ${b.kind} ${b.name} both change ${decl ? `${decl} in ${a.file}` : a.file}; neither is applied` });
      for (const id of ids) if (!excluded.has(id)) { excluded.add(id); fresh = true; }
    }
    if (!fresh) return { text: r.text, modules: r.modules, files: r.files, accepted: r.accepted, report: { areas: folders.map((f) => f.name), ignored, applied: r.applied, stale: r.stale, conflicts: [...conflicts.values()] } };
  }
}

// Apply every folder's patches in the written tree at out, in folder then file name order, with git
// apply. A patch that fails after another folder's patch to the same file, but applies to the file as
// it was before any patch, is a conflict naming both; any other failure is stale. Adds to report.
export function applyPatches(out, folders, report, env) {
  const git = (a, cwd) => spawnSync('git', a, { cwd, env, encoding: 'utf8' });
  const pristine = new Map(); // tree path -> its bytes before the first patch touched it (null: absent)
  const touchedBy = new Map(); // tree path -> folders whose applied patches touched it
  for (const f of folders) for (const p of f.patches) {
    const item = `${p.file}`;
    const ns = git(['apply', '--numstat', p.abs], out);
    if (ns.status !== 0) { report.stale.push({ area: f.name, kind: 'patch', name: item, why: `not a patch git can read: ${ns.stderr.trim().split('\n')[0]}` }); continue; }
    const touched = ns.stdout.split('\n').filter(Boolean).map((l) => l.split('\t').slice(2).join('\t'));
    for (const t of touched) if (!pristine.has(t)) { const abs = path.join(out, t); pristine.set(t, fs.existsSync(abs) && fs.lstatSync(abs).isFile() ? fs.readFileSync(abs) : null); }
    const r = git(['apply', '--whitespace=nowarn', p.abs], out);
    if (r.status === 0) {
      for (const t of touched) { if (!touchedBy.has(t)) touchedBy.set(t, []); touchedBy.get(t).push(f.name); }
      report.applied.push({ area: f.name, kind: 'patch', name: item, sites: touched });
      continue;
    }
    const why = r.stderr.trim().split('\n').filter(Boolean).slice(-1)[0] ?? 'git apply failed';
    const before = [...new Set(touched.flatMap((t) => touchedBy.get(t) ?? []).filter((x) => x !== f.name))];
    if (before.length) {
      const tmp = fs.mkdtempSync(path.join(out, '.split-patch-check-'));
      try {
        for (const t of touched) { const b = pristine.get(t); if (b) { fs.mkdirSync(path.dirname(path.join(tmp, t)), { recursive: true }); fs.writeFileSync(path.join(tmp, t), b); } }
        if (git(['apply', '--check', p.abs], tmp).status === 0) {
          report.conflicts.push({ kind: 'patch', name: touched.join(', '), areas: [...before, f.name], why: `${f.name}/patches/${p.file} applies to ${touched.join(', ')} alone but not after ${before.join(' and ')}'s patches: ${why}` });
          continue;
        }
      } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    }
    report.stale.push({ area: f.name, kind: 'patch', name: item, why: `no longer applies: ${why}` });
  }
}

// For --verify: a tree's modules with every declaration and item the overlay accepted put back as the
// source has it (or taken out, when the source has none), after checking each is exactly what the overlay
// makes. { modules, problems }. The regions are made again, so verify judges only the declarations;
// the tree's own regions are checked by regionProblems.
export function restore(srcItems, modules, accepted, overlaid, builtins) {
  const problems = [];
  const srcDecl = (name) => {
    const it = ITEM_KEY.test(name)
      ? srcItems.items.find((x) => x.kind !== 'decl' && (x.kind === 'head' ? '(head)' : `marker ${x.names[0]}`) === name)
      : srcItems.items.find((x) => x.kind === 'decl' && x.names.includes(name));
    if (!it) return null;
    const ls = srcItems.lines.slice(it.from - 1, it.to);
    ls[it.line - it.from] = ls[it.line - it.from].replace(/^export\s+/, '');
    return ls.join('\n');
  };
  const out = modules.map((m) => ({ ...m }));
  // "a.mjs, b.mjs (2 times)": the modules a name is declared in, sorted, with how often
  const where = (pairs) => pairs.filter(([, n]) => n).sort(([a], [b]) => (a < b ? -1 : 1)).map(([f, n]) => `${f}${n > 1 ? ` (${n} times)` : ''}`).join(', ') || 'no module';
  for (const name of accepted) {
    // where the overlay puts it, and how often, must be where the tree has it
    const want = new Map([...overlaid].map(([f, t]) => [f, findAccepted(t, name)]));
    const have = where(out.map((m) => [m.file, findAccepted(m.text, name).length]));
    const should = where([...want].map(([f, ds]) => [f, ds.length]));
    if (have !== should) problems.push(`placed: ${name} is in ${have} in the tree, and the overlay puts it in ${should}`);
    for (const m of out) {
      const ds = findAccepted(m.text, name);
      const w = want.get(m.file) ?? [];
      ds.forEach((d, i) => { if (w[i] && d.text !== w[i].text) problems.push(`changed: ${name} in ${m.file} differs from what the overlay makes of it`); });
      const orig = srcDecl(name) ?? '';
      for (const d of [...ds].reverse()) m.text = spliceDecl(m.text, d.from, d.to, orig);
    }
  }
  const t = new Map(out.map((m) => [m.file, m.text]));
  const re = remakeRegions(out.map((m) => m.file).filter((f) => readModule(t.get(f)).region), (f) => t.get(f), builtins);
  return { modules: out.map((m) => ({ file: m.file, text: re.get(m.file) ?? m.text })), problems };
}

// The tree's own imports regions against its own modules, worded as verify words them (verify itself
// sees the restored modules, whose regions restore made again): one problem per module whose region
// is not what the tree's declarations make it.
export function regionProblems(modules, builtins) {
  const t = new Map(modules.map((m) => [m.file, m.text]));
  const files = modules.filter((m) => readModule(m.text).region).map((m) => m.file);
  const want = remakeRegions(files, (f) => t.get(f), builtins);
  const out = [];
  for (const f of files) {
    const have = readModule(t.get(f)).region, should = readModule(want.get(f)).region;
    if (have.join('\n') === should.join('\n')) continue;
    const hs = new Set(have), ns = new Set(should);
    const missing = should.filter((l) => !hs.has(l)), extra = have.filter((l) => !ns.has(l));
    out.push(`stale imports region: ${f}${missing.length ? `; missing ${missing.join(' ')}` : ''}${extra.length ? `; extra ${extra.join(' ')}` : ''}${!missing.length && !extra.length ? '; not sorted' : ''}`);
  }
  return out;
}
