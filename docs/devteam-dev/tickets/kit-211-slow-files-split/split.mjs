// kit-211: split test/<name>.test.mjs into test/<name>.<part>.test.mjs and test/lib/<name>-fixture.mjs,
// by the plan in split-plan.mjs. Each test moves verbatim (with the comment lines right above it),
// in its original order; the code between tests goes to the fixture, or to the one part the plan
// names. Imports are recomputed with eslint (lint.mjs): each file imports only what it uses, and the
// fixture exports only what some part imports. Refuses to write if any file has an undefined name.
//   node split.mjs <name> [--check]      (--check: report, write nothing)
// Run from the repo root, on the base's file (git checkout <base> -- test/<name>.test.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chunks } from './chunks.mjs';
import { lint } from './lint.mjs';
import { PLANS } from './split-plan.mjs';

const require = createRequire(import.meta.url);
const espree = require(path.join(process.env.ESLINT ?? '/data/home/code/website/cms/node_modules/eslint', '..', 'espree'));
const [name, flag] = process.argv.slice(2);
const plan = PLANS[name];
if (!plan) { console.error(`no plan for ${name}`); process.exit(2); }
const src = fs.readFileSync(`test/${name}.test.mjs`, 'utf8');
const lines = src.split('\n');
const lastImport = lines.reduce((a, l, i) => (/^import /.test(l) ? i : a), -1);
const importLines = lines.slice(0, lastImport + 1).filter((l) => /^import /.test(l));
// every imported name: { mod, kind }
const imported = new Map();
for (const l of importLines) {
  const mod = /from '([^']+)'/.exec(l)[1];
  const def = /^import (\w+)(?:,|\s+from)/.exec(l);
  if (def) imported.set(def[1], { mod, kind: 'default' });
  const named = /\{([^}]*)\}/.exec(l);
  if (named) for (const n of named[1].split(',').map((s) => s.trim()).filter(Boolean)) imported.set(n, { mod, kind: 'named' });
}
const body = chunks(lines.slice(lastImport + 1).join('\n'));
const tests = body.filter((c) => c.kind === 'test');
// a program's top-level names
const topNames = (text) => {
  const out = new Set();
  const pat = (p) => { if (!p) return; if (p.type === 'Identifier') out.add(p.name); else if (p.type === 'ObjectPattern') p.properties.forEach((q) => pat(q.value ?? q.argument)); else if (p.type === 'ArrayPattern') p.elements.forEach(pat); else if (p.type === 'RestElement') pat(p.argument); else if (p.type === 'AssignmentPattern') pat(p.left); };
  for (const s of espree.parse(text, { ecmaVersion: 'latest', sourceType: 'module' }).body) {
    if (s.type === 'VariableDeclaration') s.declarations.forEach((d) => pat(d.id));
    else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) out.add(s.id.name);
  }
  return out;
};

const codeHome = new Map();
for (const [i, c] of body.entries()) if (c.kind !== 'test') codeHome.set(i, [...topNames(c.lines.join('\n'))].map((n) => plan.code?.[n]).find(Boolean) ?? 'fixture');
const testHome = new Map();
for (const t of tests) {
  const all = Object.entries(plan.parts).filter(([, p]) => p.tests.some((s) => t.name.startsWith(s)));
  if (all.length !== 1) { console.error(`${all.length ? 'in two parts' : 'unplaced'}: ${t.name}`); process.exitCode = 1; }
  testHome.set(t, all[0]?.[0]);
}
for (const [p, def] of Object.entries(plan.parts)) for (const s of def.tests) if (!tests.some((t) => t.name.startsWith(s))) { console.error(`${p}: no test starts ${JSON.stringify(s)}`); process.exitCode = 1; }
if (process.exitCode) process.exit(1);

const textOf = (home) => body.map((c, i) => ((c.kind === 'test' ? testHome.get(c) : codeHome.get(i)) === home ? c.lines.join('\n').replace(/^\n+|\n+$/g, '') : null)).filter((x) => x !== null && x !== '').join('\n\n');
const rank = (m) => (m === 'node:test' ? -2 : m === 'node:assert/strict' ? -1 : m.startsWith('node:') ? 0 : 1);
const relFromLib = (mod) => { if (!mod.startsWith('.')) return mod; const r = path.posix.relative('test/lib', path.posix.normalize(path.posix.join('test', mod))); return r.startsWith('.') ? r : `./${r}`; };
const importBlock = (names) => {
  const byMod = new Map();
  for (const [n, { mod, kind }] of names) { if (!byMod.has(mod)) byMod.set(mod, { def: null, named: [] }); const e = byMod.get(mod); if (kind === 'default') e.def = n; else e.named.push(n); }
  return [...byMod.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((m) => { const e = byMod.get(m); return `import ${[e.def, e.named.length ? `{ ${e.named.sort((a, b) => a.localeCompare(b)).join(', ')} }` : null].filter(Boolean).join(', ')} from '${m}';`; }).join('\n');
};
// imports: every candidate, then drop what eslint says is unused; a name still undefined is an error
function withImports(head, candidates, rest) {
  const draft = (c) => `${head}\n${importBlock(c)}\n\n${rest}\n`;
  const unused = new Set(lint(draft(candidates)).filter((m) => m.ruleId === 'no-unused-vars').map((m) => /'([^']+)'/.exec(m.message)?.[1]));
  const kept = new Map([...candidates].filter(([n]) => !unused.has(n)));
  return draft(kept);
}

// The fixture holds only what two or more parts (or the fixture itself) use: a top-level statement
// whose names only one part needs moves to the top of that part, in the original order.
const undef = (text) => new Set(lint(text, { unused: false }).filter((m) => m.ruleId === 'no-undef').map((m) => /'([^']+)'/.exec(m.message)?.[1]));
const statements = (text) => {
  // each statement with what comes before it (blank lines, comments), from the end of the line the
  // statement before it ends on; the last one also takes whatever follows it
  const ast = espree.parse(text, { ecmaVersion: 'latest', sourceType: 'module', range: true });
  const eol = (k) => { const j = text.indexOf('\n', k); return j < 0 ? text.length : j; };
  return ast.body.map((st, i) => {
    const start = i === 0 ? 0 : eol(ast.body[i - 1].range[1]);
    const end = i + 1 === ast.body.length ? text.length : eol(st.range[1]);
    return { i, text: text.slice(start, end), names: topNames(text.slice(st.range[0], st.range[1])) };
  });
};
const fixStatements = statements(textOf('fixture'));
const moved = new Map(Object.keys(plan.parts).map((p) => [p, []]));
for (let changed = true; changed;) {
  changed = false;
  for (const st of fixStatements.filter((x) => !x.gone && x.names.size)) {
    const rest = fixStatements.filter((x) => !x.gone && x !== st).map((x) => x.text).join('\n');
    if ([...undef(rest)].some((n) => st.names.has(n))) continue;
    const users = Object.keys(plan.parts).filter((p) => { const t = [...moved.get(p).map((x) => x.text), textOf(p)].join('\n'); return [...undef(t)].some((n) => st.names.has(n)); });
    if (users.length !== 1) continue;
    st.gone = true;
    moved.get(users[0]).push(st);
    changed = true;
  }
}
const partBody = (p) => [moved.get(p).sort((a, b) => a.i - b.i).map((x) => x.text).join('').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, ''), textOf(p)].filter(Boolean).join('\n\n');
for (const [p, sts] of moved) if (sts.length) console.log(`${p} takes: ${sts.flatMap((x) => [...x.names]).join(', ')}`);

const out = new Map();
const fixFile = `test/lib/${name}-fixture.mjs`;
const fixText = fixStatements.filter((x) => !x.gone).map((x) => x.text).join('').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
const fixNames = topNames(fixText);
const partFiles = Object.keys(plan.parts).map((p) => [p, `test/${name}.${p}.test.mjs`]);
const fixExports = new Set();
for (const [p, f] of partFiles) {
  const cands = new Map([...imported].filter(([n]) => !fixNames.has(n)));
  for (const n of fixNames) cands.set(n, { mod: `./lib/${name}-fixture.mjs`, kind: 'named' });
  const text = withImports(plan.parts[p].comment, cands, partBody(p));
  for (const m of text.matchAll(new RegExp(`^import \\{([^}]*)\\} from '\\./lib/${name}-fixture\\.mjs';$`, 'gm'))) m[1].split(',').map((s) => s.trim()).forEach((n) => fixExports.add(n));
  out.set(f, text);
}
const fixCands = new Map([...imported].map(([n, i]) => [n, { ...i, mod: relFromLib(i.mod) }]));
// exported names count as used: draft with the export line, so eslint keeps their imports
const fixBody = `${fixText}\n\nexport { ${[...fixExports].sort((a, b) => a.localeCompare(b)).join(', ')} };`;
out.set(fixFile, withImports(plan.fixtureComment, fixCands, fixBody));

for (const [f, t] of out) {
  const undef = lint(t).filter((m) => m.ruleId !== 'no-unused-vars');
  for (const m of undef) { console.error(`${f}:${m.line}:${m.column} ${m.message}`); process.exitCode = 1; }
  console.log(`${f}: ${t.split('\n').length} lines, ${(t.match(/^test\(/gm) ?? []).length} tests`);
}
if (flag !== '--check' && !process.exitCode) { for (const [f, t] of out) fs.writeFileSync(f, t); fs.rmSync(`test/${name}.test.mjs`); console.log(`removed test/${name}.test.mjs`); }
