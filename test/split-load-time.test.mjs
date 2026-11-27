// The load-time overlay (test/split/overlay/load-time/): nothing cross-module runs while the CLI's
// modules load, and no module writes another's let but through its setter. L1-L5 run the overlay's
// checks on fixture modules, L5b the shared-state check on the entry, L6-L7 the setters rule, and L8
// the rule and the check when node's acorn can't load or the writes child fails. T1-T7b generate the
// kit's tree at this checkout's HEAD (its base) once, with the real overlay, and check it: every module
// imported alone does nothing, the report lists every rewritten site, a parse finds no write to an
// import, --verify is clean, and the tree's cli.mjs prints what the source's devteam.mjs prints, in the
// kit's own checkout (T7) and in a project (T7b). About 80-110 s; CI runs it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'test', 'split', 'split.mjs');
const RULES = path.join(root, 'test', 'split', 'overlay', 'load-time', 'rules.mjs');
const { checks, rules, LIB, NAMED, ENTRY_FILE, ACORN } = await import(pathToFileURL(RULES).href);
const { items } = await import(pathToFileURL(path.join(root, 'test', 'split', 'lib', 'js.mjs')).href);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GIT_|DEVTEAM_)/.test(k)));
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 28, ...o });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'split-load-time-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

// ---- L: the check on fixture modules ----
// The check as the tool runs it: over a view of the given modules.
// a view of fixture modules under LIB; the key '(entry)' is the entry, cli.mjs
const view = (mods) => ({ modules: () => Object.keys(mods).filter((f) => f !== '(entry)').map((f) => ({ file: `${LIB}/${f}`, source: 'x' })), read: (f) => (f === ENTRY_FILE ? mods['(entry)'] ?? null : mods[f.slice(LIB.length + 1)] ?? null), write: (f, text) => { mods[f === ENTRY_FILE ? '(entry)' : f.slice(LIB.length + 1)] = text; } });
const checkOn = async (mods, name = 'load-time') => (await checks.find((x) => x.name === name).run(view(mods))).refused;
const mod = (imports, body) => `/* imports start */\n${imports.join('\n')}\n/* imports end */\n${body}`;
const A = mod([], "export function f() { return 1; }\nexport const K = 2;\nexport function g() { return K; }\nexport class C {}\n");

test('L1: the check refuses a module whose top-level initializer calls an imported function', async () => {
  const refused = await checkOn({ 'a.mjs': A, 'b.mjs': mod(["import { f } from './a.mjs';"], 'export const X = f();\n') });
  assert.deepEqual(refused.map((r) => r.site), [`${LIB}/b.mjs X`]);
  assert.match(refused[0].why, /calls f, imported from docs\/devteam\/scripts\/lib\/a\.mjs/);
});

test('L2: the check refuses one that reads an imported const through a function of its own it calls', async () => {
  const refused = await checkOn({ 'a.mjs': A, 'c.mjs': mod(["import { K } from './a.mjs';"], 'function h() { return K + 1; }\nexport const Y = h();\n') });
  assert.deepEqual(refused.map((r) => r.site), [`${LIB}/c.mjs Y`]);
  assert.match(refused[0].why, /reads const K, imported from docs\/devteam\/scripts\/lib\/a\.mjs \(through h\)/);
});

test('L3: the check accepts a module that only references imported function declarations, as the COMMANDS tables do', async () => {
  const refused = await checkOn({ 'a.mjs': A, 'd.mjs': mod(["import { K } from './a.mjs';", "import { f } from './a.mjs';", "import { g } from './a.mjs';"], "export const TABLE = { one: f, two: g };\nexport const later = () => K + f();\nexport function now() { return g(); }\n") });
  assert.deepEqual(refused, []);
});

test('L4: the check refuses a module that spawns, writes, prints or reads process.argv while it loads, itself or through its own function', async () => {
  const refused = await checkOn({ 'e.mjs': mod(["import fs from 'node:fs';"], "const w = () => fs.writeFileSync('x', '');\nexport const A = process.argv[2];\nexport const B = w();\nexport const C = () => console.log('later');\n") });
  assert.deepEqual(refused.map((r) => `${r.site}: ${r.why}`), [`${LIB}/e.mjs A: does what only init may: process.argv`, `${LIB}/e.mjs B: does what only init may: fs.writeFileSync( (through w)`]);
});

// lets a module owns, and one that writes them in every form, and names them only locally
const LETS = mod([], 'export let X = 0;\nexport let Y = 0;\nexport let Z = null;\nexport let S = \'\';\nexport let W = null;\nexport const K = 1;\n');
// renamed imports of names that are lets elsewhere, from modules that don't own them: k.mjs's const X (a.mjs
// owns the let X) and node:path's join (j.mjs owns a let join)
const OTHER_SOURCE = () => ({ 'a.mjs': LETS, 'j.mjs': mod([], 'export let join = 0;\n'), 'k.mjs': mod([], 'export const X = 5;\n'), 'h.mjs': mod(["import { X as Q } from './k.mjs';", "import { join as J } from 'node:path';"], 'export function w() { Q = 1; J = 2; }\n') });

test("L5: the shared-state check refuses each form of write to another module's let, and no write to a local of that name", async () => {
  const refused = await checkOn({ 'a.mjs': LETS, 'b.mjs': mod(["import { X, Y } from './a.mjs';"], [
    'export function w1() { X = 1; }', 'export function w2() { X += 1; }', 'export function w3() { Y ??= 2; }', 'export function w4() { X++; }',
    'export function w5(o) { ({ X, Y } = o); }', 'export function w6(o) { [X] = o; }', 'export function w7(o) { for (X of o); }',
    'export function w8(o) { let a; [a, ...X] = o; return a; }', 'export function w9(o) { let a; ({ X: a, b: X } = o); return a; }', 'export function w10(o) { let k; for ([k, X] of o); return k; }',
    'export function ok1(X) { X = 3; return X; }', 'export function ok2({ Y = 1 } = {}) { return Y; }',
    'export function ok3() { const k = 1, X = 2; return k + X; }', 'export const ok4 = (o) => (o.X = 1);',
    'export function ok5(a = Math.max(1, 2), X) { X = 3; return a + X; }', 'export function ok6() { try { return 0; } catch ({ m: X }) { X = 1; return X; } }',
    'export class ok7 { X = 1; }', 'export function w11(f = () => { X = 1; }) { let X = 0; return [f, X]; }', 'export class w12 { static { var X; } m() { X = 1; } }', '',
  ].join('\n')) }, 'shared-state');
  assert.deepEqual(refused.map((r) => r.why.match(/^writes (\w+) \((\w+)\)/)?.slice(1).join(' ')), ['X assign', 'X compound', 'Y logical', 'X update', 'X pattern', 'Y pattern', 'X pattern', 'X for', 'X pattern', 'X pattern', 'X for', 'X assign', 'X assign']);
  assert.ok(refused.every((r) => r.site.startsWith(`${LIB}/b.mjs:`)), refused.map((r) => r.site).join(', '));
  // a write through a renamed import is a write to the let it imports, named by both names
  const renamed = await checkOn({ 'a.mjs': LETS, 'c.mjs': mod(["import { X as Q } from './a.mjs';"], 'export function w() { Q = 1; }\n') }, 'shared-state');
  assert.deepEqual(renamed.map((r) => `${r.site}: ${r.why}`), [`${LIB}/c.mjs:4 Q: writes Q (assign), the let X of ${LIB}/a.mjs: an import can't be assigned`]);
  // a renamed import from a module that is not the let's owner (a same-named const of a third module, a builtin
  // whose export shares a let's name) is no write to that let
  assert.deepEqual(await checkOn(OTHER_SOURCE(), 'shared-state'), []);
  // an imports region that doesn't parse: the module is refused, at that region's own line
  const broken = await checkOn({ 'a.mjs': LETS, 'g.mjs': mod(["import { K } from './a.mjs';", "import { X from './a.mjs';"], 'export function w() { X = 1; }\n') }, 'shared-state');
  assert.deepEqual(broken.map((r) => `${r.site}: ${r.why}`), [`${LIB}/g.mjs:3 : its imports do not parse: Unexpected token (2:11)`]);
});

test("L5b: the shared-state check reads the entry too, whose imports are in its body: a write there to another module's let is refused", async () => {
  const refused = await checkOn({ 'a.mjs': LETS, '(entry)': "import { X } from './lib/a.mjs';\nimport { K } from './lib/a.mjs';\nX = 2;\nexport const k = K;\n" }, 'shared-state');
  assert.deepEqual(refused.map((r) => `${r.site}: ${r.why}`), [`${ENTRY_FILE}:3 X: writes X (assign), a let of ${LIB}/a.mjs: an import can't be assigned`]);
});

// the setters rule over a view, its modules written to a folder and run
const settersOn = async (mods) => {
  const r = await rules.find((x) => x.name === 'setters').apply(view(mods));
  const dir = fs.mkdtempSync(path.join(tmp, 'setters-'));
  for (const [f, text] of Object.entries(mods)) fs.writeFileSync(path.join(dir, f), text);
  return { ...r, dir };
};

test('L6: the setters rule rewrites every form of write to another module\'s let into its setter, and the writes take effect', async () => {
  const { changed, refused, dir } = await settersOn({ 'a.mjs': LETS, 'b.mjs': mod(["import { X, Y, Z, S, W, setX, setY, setZ, setS, setW } from './a.mjs';"], [
    'export function run(o) {', '  X = 1;', '  X += 2;', '  ({ Y, Z } = o);', "  S ||= 'set';", '  Z = Y = Z + 1;',
    '  let a;', '  [a, ...W] = [0, 1, 2];', '  ({ X: a, b: X = 4 } = { X: 9 });', '  S = `pre', '${S}`;', '  void a', '  Z ??= 0', '  Y = (Y, Y + 1);', '  return [X, Y, Z, S, W, a];', '}', '',
  ].join('\n')) });
  assert.deepEqual(refused, []);
  assert.deepEqual(changed.filter((c) => c.file.endsWith('a.mjs')).map((c) => c.decl).sort(), ['setS', 'setW', 'setX', 'setY', 'setZ']);
  const b = await import(pathToFileURL(path.join(dir, 'b.mjs')).href);
  const want = [4, 9, 8, 'pre\nset', [1, 2], 9];
  assert.deepEqual(b.run({ Y: 5, Z: 7 }), want);
  const a = await import(pathToFileURL(path.join(dir, 'a.mjs')).href);
  assert.deepEqual([a.X, a.Y, a.Z, a.S, a.W], want.slice(0, 5));
});

test('L7: the setters rule refuses a write it can\'t rewrite (++, a pattern used as a value, a for-of target, a local setter, a self-reading default, a setter name already taken, a renamed import), naming it', async () => {
  const { refused } = await settersOn({ 'a.mjs': LETS, 'c.mjs': mod(["import { X, Y, S } from './a.mjs';"], 'export function up() { X++; }\nexport function pat(o) { return ({ a: Y } = o); }\nexport function each(o) { for (S of o); }\nexport function sh() { const setX = () => 0; X = 1; return setX; }\nexport function dflt(o) { [X, Y = X] = o; }\n') });
  assert.deepEqual(refused.map((r) => r.site.replace(/:\d+/, '')), [`${LIB}/c.mjs X, Y`, `${LIB}/c.mjs X`, `${LIB}/c.mjs S`, `${LIB}/c.mjs Y`, `${LIB}/c.mjs X`]);
  assert.deepEqual(refused.map((r) => r.why.split(/ to another|: the rule/)[0]), ['a destructuring whose default or computed key reads a name it writes', 'a local named setX where it writes X, so the setter would not be reached', 'a for-in/of loop writing it', 'a destructuring write used as a value', 'a ++ or -- write']);
  // a let whose setter's name is a global (setTimeout): refused, never shadowing the timer
  const gm = { 'a.mjs': mod([], 'export let timeout = 0;\n'), 'd.mjs': mod(["import { timeout } from './a.mjs';"], 'export function w() { timeout = 5; }\n') };
  const g = await settersOn(gm);
  assert.deepEqual(g.refused.map((r) => `${r.site}: ${r.why}`), [`${LIB}/d.mjs:4 timeout: setTimeout is already a name (a global), so its writes stay as written: the rule can't rewrite it`]);
  assert.deepEqual([g.changed, gm['d.mjs'].includes('timeout = 5;') && !gm['a.mjs'].includes('setTimeout')], [[], true], 'no setter, and the write left as written');
  // a let whose setter's name is already a top-level function of the split: refused, never calling that function
  const om = { 'a.mjs': mod([], 'export let x = 0;\nexport function setX(v) { return v * 2; }\n'), 'd.mjs': mod(["import { x } from './a.mjs';"], 'export function w() { x = 1; }\n') };
  const o = await settersOn(om);
  assert.deepEqual(o.refused.map((r) => `${r.site}: ${r.why}`), [`${LIB}/d.mjs:4 x: setX is already a name, so its writes stay as written: the rule can't rewrite it`]);
  assert.deepEqual([o.changed, om['d.mjs'].includes('x = 1;') && !om['d.mjs'].includes('setX')], [[], true], 'no setter, and the write left as written');
  // a write through a renamed import: refused at the write and left as written, no setter made
  const rm = { 'a.mjs': LETS, 'e.mjs': mod(["import { X as Q } from './a.mjs';"], 'export function w() { Q = 1; }\n') };
  const r = await settersOn(rm);
  assert.deepEqual(r.refused.map((x) => `${x.site}: ${x.why}`), [`${LIB}/e.mjs:4 Q: Q is a renamed import of the let X of ${LIB}/a.mjs: the rule can't rewrite it`]);
  assert.deepEqual([r.changed, rm['e.mjs'].includes('Q = 1;') && !rm['a.mjs'].includes('setX')], [[], true], 'no setter, and the write left as written');
  // a renamed import from a module that is not the owner: no let's write, so nothing refused or rewritten
  const om2 = OTHER_SOURCE();
  const before = { ...om2 };
  const n = await settersOn(om2);
  assert.deepEqual([n.refused, n.changed, om2], [[], [], before]);
});

test('L8: when node\'s acorn can\'t load, or the writes child fails otherwise, the setters rule and the shared-state check are refused as a whole, naming which', async () => {
  const was = ACORN.path;
  const fixture = () => ({ 'a.mjs': LETS, 'b.mjs': mod(["import { X } from './a.mjs';"], 'export function w() { X = 1; }\n') });
  try {
    ACORN.path = 'internal/deps/acorn/missing';
    const want = [{ site: LIB, why: "node's acorn (--expose-internals) failed: Error: Cannot find module 'internal/deps/acorn/missing'" }];
    assert.deepEqual(await checkOn(fixture(), 'shared-state'), want);
    const { refused, changed } = await settersOn(fixture());
    assert.deepEqual([refused, changed], [want, []]);
    // a module that loads but is no parser: the child itself fails, and is named so, not as acorn
    ACORN.path = 'node:os';
    const other = [{ site: LIB, why: 'the writes child failed: TypeError: acorn.parse is not a function' }];
    assert.deepEqual(await checkOn(fixture(), 'shared-state'), other);
    const o = await settersOn(fixture());
    assert.deepEqual([o.refused, o.changed], [other, []]);
  } finally { ACORN.path = was; }
});

// ---- T: the kit's tree at its base ----
const sha = run('git', ['-C', root, 'rev-parse', 'HEAD']).stdout.trim();
// whoami, help and validate as the source's devteam.mjs prints them, then the tree written at the
// same folder (what they print names it) and the same with its cli.mjs
const KIT = path.join(tmp, 'kit');
const HOME = path.join(tmp, 'home');
fs.mkdirSync(KIT); fs.mkdirSync(HOME);
const CMDS = ['whoami', 'help', 'validate'];
const plain = { PATH: process.env.PATH, HOME, DEVTEAM_HUB_PORT: '4399' };
const one = (script, c, extra = {}, stdio = 'pipe', input = undefined) => { const r = spawnSync(process.execPath, [script, c], { cwd: KIT, env: { ...plain, ...extra }, encoding: 'utf8', timeout: 120000, stdio, input }); return { out: r.stdout, err: r.stderr, status: r.status, fd3: r.output?.[3] ?? null }; };
// done-when 4 as written: each command, every DEVTEAM_* but the port unset, in the kit's own checkout
const cmds = (script) => Object.fromEntries(CMDS.map((c) => [c, one(script, c)]));
// and in a project (the source's init, committed): there the guard runs main's devteam.mjs for any other
// script until kit-892 teaches it the tree, so DEVTEAM_OWN_KIT=1 keeps cli.mjs the one that runs; plus
// whoami as an owner action runs it (DEVTEAM_REPLY_FD: what it printed, again on fd 3)
const OWN = { DEVTEAM_OWN_KIT: '1' };
const PROJECT = ['.gitignore', '.gitleaks.toml', 'AGENTS.md', 'docs/devteam/project'];
// bash-ok, the hook's fast path, is load-time work that awaits its stdin: in the tree it runs from the async init()
const HOOK = (command) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
const inProject = (script) => ({
  ...Object.fromEntries([...CMDS, 'status'].map((c) => [c, one(script, c, OWN)])),
  'whoami (owner action)': one(script, 'whoami', { ...OWN, DEVTEAM_REPLY_FD: '3' }, ['ignore', 'pipe', 'pipe', 'pipe']),
  'bash-ok (an rm of a variable)': one(script, 'bash-ok', OWN, 'pipe', HOOK('rm -rf $D')),
  'bash-ok (ls)': one(script, 'bash-ok', OWN, 'pipe', HOOK('ls')),
});
// a checkout of its own, so the locations init() finds come from git as in a real one
const commitAll = () => { for (const a of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x']]) assert.equal(run('git', ['-C', KIT, ...a], { env: plain }).status, 0, `git ${a.join(' ')}`); };
const tar = run('git', ['-C', root, 'archive', sha], { encoding: 'buffer' });
assert.equal(run('tar', ['-x', '-f', '-', '-C', KIT], { input: tar.stdout }).status, 0, 'the source extracts');
commitAll();
const SRC = 'docs/devteam/scripts/devteam.mjs', CLI = 'docs/devteam/scripts/cli.mjs';
const before = cmds(SRC);
const made0 = one(SRC, 'init', { DEVTEAM_HUB_PORT: '4399' }, 'pipe');
assert.equal(made0.status, 0, `the source's init makes a project: ${made0.err}`);
commitAll();
const beforeProject = inProject(SRC);
const saved = path.join(tmp, 'project');
for (const f of PROJECT) fs.cpSync(path.join(KIT, f), path.join(saved, f), { recursive: true });
fs.rmSync(KIT, { recursive: true });
const made = run(process.execPath, [tool, '--at', sha, '--out', KIT, '--json'], { cwd: tmp });
let J = {};
try { J = JSON.parse(made.stdout); } catch { /* T2 names it */ }
let after = {}, afterProject = {};
if (made.status === 0) {
  commitAll();
  after = cmds(CLI);
  for (const f of PROJECT) fs.cpSync(path.join(saved, f), path.join(KIT, f), { recursive: true });
  commitAll();
  afterProject = inProject(CLI);
}
const lib = path.join(KIT, LIB);
const read = (f) => fs.readFileSync(path.join(KIT, f), 'utf8');
const modules = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.mjs')) modules.push(path.relative(KIT, p).split(path.sep).join('/')); } };
if (fs.existsSync(lib)) walk(lib);
const site = (rule) => J.overlay?.applied?.find((a) => a.area === 'load-time' && a.kind === 'rule' && a.name === rule)?.sites ?? [];
// --count at the base: the load-time statements, import.meta.url uses and let sites it finds
// --count prints a section per manifest (each opens `K1 count at <sha> (<source>: …`): this area's is devteam.mjs's
const count = (run(process.execPath, [tool, '--count', '--at', sha], { cwd: tmp }).stdout.split(/^(?=K1 count at )/m).find((x) => /^K1 count at \S+ \(docs\/devteam\/scripts\/devteam\.mjs:/.test(x)) ?? '');

test('T1: in the tree, importing every lib module alone in a fresh node process prints nothing, writes no file, spawns nothing and never reads process.argv', () => {
  const harness = path.join(tmp, 'alone.mjs');
  fs.writeFileSync(harness, ALONE);
  const cwd = path.join(tmp, 'alone-cwd'), home = path.join(tmp, 'alone-home');
  fs.mkdirSync(cwd); fs.mkdirSync(home);
  assert.ok(modules.length > 40, `the tree has its modules (${modules.length})`);
  const bad = [];
  for (const m of modules) {
    const r = spawnSync(process.execPath, [harness, path.join(KIT, m)], { cwd, env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
    const report = (r.output[3] ?? '').trim();
    let x = null;
    try { x = JSON.parse(report); } catch { /* named below */ }
    const what = [...(x?.seen ?? ['no report']), ...(x?.error ? [`threw: ${x.error}`] : []), ...(r.stdout ? [`stdout: ${r.stdout.slice(0, 120)}`] : []), ...(r.stderr ? [`stderr: ${r.stderr.slice(0, 200)}`] : []), ...(r.status ? [`exit ${r.status}`] : [])];
    if (what.length) bad.push(`${m}: ${[...new Set(what)].join('; ')}`);
  }
  assert.deepEqual(bad, []);
  assert.deepEqual([...fs.readdirSync(cwd), ...fs.readdirSync(home)], [], 'nothing written in the cwd or HOME');
});

test("T2: the tree is written with the load-time area applied, nothing stale, and its checks refuse nothing in it", () => {
  assert.equal(made.status, 0, made.stderr);
  assert.deepEqual(J.stale, []);
  assert.deepEqual((J.overlay?.applied ?? []).filter((a) => a.area === 'load-time').map((a) => `${a.kind} ${a.name}`), ['rule entry', 'rule init', 'rule dispatch', 'rule setters', 'check load-time', 'check shared-state']);
});

test('T3: the report lists each load-time statement --count finds moved into init() in lib/state.mjs, and the dispatch into dispatch()', () => {
  const state = read(`${LIB}/state.mjs`);
  const init = state.slice(state.indexOf('export async function init() {'));
  assert.ok(init.length > 20, 'state has init()');
  // --count quotes each statement's first 80 characters, its template quotes as '
  const norm = (x) => x.replace(/[`'"]/g, "'");
  const stmts = [...count.matchAll(/^- ([\w/-]+): `(.*)`$/gm)].map(([, m, l]) => ({ m, l }));
  assert.ok(stmts.length >= 15, `--count lists the load-time statements (${stmts.length})`);
  const sites = site('init').join('\n');
  // each statement's own item in the source: the declaration above it, or its module's head
  const src = run('git', ['-C', root, 'show', `${sha}:docs/devteam/scripts/devteam.mjs`]).stdout;
  const S = items(src);
  const itemOf = (l) => S.statements.find((s) => norm(S.lines[s.line - 1]).startsWith(norm(l.slice(0, 40))))?.item;
  const dispatch = read(`${LIB}/dispatch.mjs`).split('export function dispatch() {')[1] ?? '';
  const left = [];
  for (const { m, l } of stmts) {
    const want = norm(l.slice(0, 40));
    if (m === 'dispatch') { if (!norm(dispatch).includes(want)) left.push(`${m}: ${l} (not in dispatch())`); continue; }
    // an assignment to another module's let reads through its setter there (T5)
    const set = want.replace(/^([\w$]+) = /, (x, n) => `set${n[0].toUpperCase()}${n.slice(1)}((`);
    if (!norm(init).includes(want) && !norm(init).includes(set)) left.push(`${m}: ${l} (not in init())`);
    const it = itemOf(l);
    const own = [`${LIB}/${m}.mjs (head) its statements -> init()`, ...(it?.kind === 'decl' ? [`${LIB}/${m}.mjs ${it.names[0]} a statement after it -> init()`] : []), ...(it?.kind === 'mark' ? [`${LIB}/${m}.mjs marker ${it.names[0]} its statements -> init()`] : [])];
    if (!it) left.push(`${m}: ${l} (not found in the source)`);
    else if (!own.some((x) => sites.includes(x))) left.push(`${m}: ${l} (no site for its item: ${own.join(' | ')})`);
  }
  assert.deepEqual(left, []);
  // every value the design names: a let of state's, assigned at the start of a line of init(), listed
  assert.equal(NAMED.length, 17);
  for (const n of NAMED) {
    assert.match(state, new RegExp(`^export let (?:[\\w$]+, )*${n}[,;]`, 'm'), `${n} is a let in state`);
    assert.match(init, new RegExp(`^\\(?(?:\\{ )?(?:[\\w$]+, )*${n}\\b[^\\n=]*=(?!=)`, 'm'), `init assigns ${n}`);
    assert.match(sites, new RegExp(`${LIB}/state\\.mjs [\\w$]+ from \\S+: export let (?:[\\w$]+, )*${n}[,]? `), `the report lists ${n}`);
  }
  assert.match(site('dispatch').join('\n'), /dispatch\.mjs marker dispatch start/);
  assert.match(read('docs/devteam/scripts/cli.mjs'), /\nawait init\(\);\ndispatch\(\);\n$/);
});

test('T4: the report lists every fileURLToPath(import.meta.url), counted at its base, replaced by ENTRY; import.meta.url appears under lib/ only in state and settings', () => {
  const [, uses, cli] = count.match(/^import\.meta\.url: (\d+) uses; meaning the CLI: (\d+)/m) ?? [];
  assert.ok(Number(cli) > 0, '--count finds the CLI uses');
  const listed = site('entry').reduce((n, s) => n + Number(s.match(/ (\d+) uses? /)?.[1] ?? 0), 0);
  assert.equal(listed, Number(uses), `the entry rule lists ${uses} uses (${cli} meaning the CLI)`);
  const where = modules.filter((m) => /import\.meta\.url/.test(read(m))).map((m) => m.slice(LIB.length + 1));
  assert.deepEqual(where.filter((m) => !['state.mjs', 'settings.mjs'].includes(m)), []);
  assert.deepEqual(modules.filter((m) => /fileURLToPath\(import\.meta\.url\)/.test(read(m))), []);
});

test("T5: the report lists a setter at each write to another module's let, counted at its base, and a parse of the tree finds no write to an import left", () => {
  // --count's lets written from another module, each with its sites: the rule lists at least as many writes of it
  // (its list also holds lets written only from another banner section of their own module)
  const [, lets, at] = count.match(/^Lets: \d+ top-level; assigned from another module: (\d+) at (\d+) sites/m) ?? [];
  const want = [...count.matchAll(/^- ([\w$]+) \(([\w/-]+)\): (\d+) sites, from (.*)$/gm)].filter(([, , o, , from]) => from.split(', ').some((x) => x !== o)).map(([, n, , k]) => [n, Number(k)]);
  assert.equal(want.length, Number(lets), `--count lists its ${lets} lets`);
  const sites = site('setters');
  const listed = new Map();
  for (const s of sites) for (const [, n, k] of (s.match(/-> setter \(([^;]*);/)?.[1] ?? '').matchAll(/([\w$]+)(?: x(\d+))?/g)) listed.set(n, (listed.get(n) ?? 0) + Number(k ?? 1));
  assert.deepEqual(want.filter(([n]) => !listed.get(n)).map(([n]) => n), [], 'each has a write listed');
  const total = want.reduce((x, [n]) => x + listed.get(n), 0);
  assert.ok(total >= Number(at), `the rule lists ${total} writes of them, at least the ${at} --count finds`);
  const setters = sites.filter((s) => / the setter of /.test(s)).map((s) => s.match(/the setter of ([\w$]+)/)[1]);
  assert.deepEqual(want.map(([n]) => n).filter((n) => !setters.includes(n)), [], 'each has its setter');
  // independent of the rule: acorn (node's own copy) parses each module and the entry, resolves every name written
  // to its scope, and names each one that is an import
  const scanner = path.join(tmp, 'written.cjs');
  fs.writeFileSync(scanner, WRITTEN);
  const r = run(process.execPath, ['--expose-internals', scanner, ...[...modules, CLI].map((m) => path.join(KIT, m))]);
  assert.equal(r.status, 0, r.stderr);
  const found = JSON.parse(r.stdout);
  assert.ok(found.parsed === modules.length + 1 && modules.length > 40, `it parsed every module and the entry (${found.parsed})`);
  assert.deepEqual(found.writes.map((w) => w.replace(`${KIT}/`, '')), []);
});

test('T6: --verify of the tree is clean: nothing changed but the sites the report lists', () => {
  const v = run(process.execPath, [tool, '--verify', '--at', sha, '--tree', KIT], { cwd: tmp });
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.match(v.stdout, /accepted as changed by the overlay: .*\(head\)/);
});

test("T7: in the tree, cli.mjs whoami, help and validate (scratch HOME, hub port 4399, every other DEVTEAM_* unset, the kit's own git checkout) print what the source's devteam.mjs prints", () => {
  for (const c of CMDS) assert.deepEqual(after[c], before[c], c);
  assert.match(before.help.out, /devteam/);
});

test("T7b: in a project the source's init made, cli.mjs whoami, help, validate and status, whoami as an owner action, and bash-ok on a hook's stdin, print and reply what the source's devteam.mjs does", () => {
  for (const c of Object.keys(beforeProject)) assert.deepEqual(afterProject[c], beforeProject[c], c);
  for (const c of ['whoami', 'validate', 'status']) assert.equal(beforeProject[c].status, 0, `${c} runs in the project: ${beforeProject[c].err}`);
  assert.match(beforeProject.whoami.out, /DEVTEAM_ROLE=/);
  assert.match(beforeProject['whoami (owner action)'].fd3, /^\{"out":"DEVTEAM_/, 'the reply pipe carries what whoami printed');
  assert.match(beforeProject['bash-ok (an rm of a variable)'].out, /"permissionDecision":"deny"/, 'bash-ok denies an rm of a variable');
  assert.deepEqual([beforeProject['bash-ok (ls)'].out, beforeProject['bash-ok (ls)'].status], ['', 0], 'bash-ok passes ls');
  assert.deepEqual(fs.readdirSync(HOME), [], 'nothing written in HOME');
});

// Every write to an imported binding in the modules named, by a real parse (acorn, inside node: run
// with --expose-internals). Prints { parsed, writes: ['<file>:<line> <name> (<how>)'] }.
const WRITTEN = String.raw`const acorn = require('internal/deps/acorn/acorn/dist/acorn');
const fs = require('node:fs');
const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const kids = (n) => Object.entries(n).filter(([k]) => !['type', 'start', 'end', 'loc'].includes(k)).flatMap(([, v]) => (Array.isArray(v) ? v : [v])).filter((c) => c && typeof c.type === 'string');
const ids = (p, acc = []) => {
  if (!p) return acc;
  if (p.type === 'Identifier') acc.push(p.name);
  else if (p.type === 'ObjectPattern') for (const q of p.properties) ids(q.type === 'RestElement' ? q.argument : q.value, acc);
  else if (p.type === 'ArrayPattern') for (const q of p.elements) ids(q, acc);
  else if (p.type === 'AssignmentPattern') ids(p.left, acc);
  else if (p.type === 'RestElement') ids(p.argument, acc);
  return acc;
};
const vars = (n, acc = []) => { if (n.type === 'VariableDeclaration' && n.kind === 'var') for (const d of n.declarations) ids(d.id, acc); for (const c of kids(n)) if (!FN.has(c.type) && c.type !== 'StaticBlock') vars(c, acc); return acc; };
const lexical = (stmts) => stmts.flatMap((s) => {
  const d = (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') && s.declaration ? s.declaration : s;
  if (s.type === 'ImportDeclaration') return s.specifiers.map((x) => [x.local.name, 'import']);
  if (d.type === 'VariableDeclaration' && d.kind !== 'var') return d.declarations.flatMap((x) => ids(x.id)).map((x) => [x, 'local']);
  if ((d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id) return [[d.id.name, 'local']];
  return [];
});
const local = (names) => names.map((x) => [x, 'local']);
const out = [];
let parsed = 0;
for (const file of process.argv.slice(2)) {
  let ast;
  try { ast = acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', locations: true }); } catch (e) { out.push(file + ': does not parse: ' + e.message); continue; }
  parsed++;
  const find = (sc, x) => { for (let s = sc; s; s = s.up) if (s.names.has(x)) return s.names.get(x); return null; };
  const wrote = (x, n, sc, how) => { if (find(sc, x) === 'import') out.push(file + ':' + n.loc.start.line + ' ' + x + ' (' + how + ')'); };
  const walk = (n, sc) => {
    const open = (pairs) => ({ names: new Map(pairs), up: sc });
    if (FN.has(n.type)) {
      const body = n.body.type === 'BlockStatement' ? n.body.body : [];
      const params = open([...(n.type === 'FunctionExpression' && n.id ? [[n.id.name, 'local']] : []), ...local(n.params.flatMap((p) => ids(p))), ['arguments', 'local']]);
      const inner = { names: new Map([...local(vars(n.body)), ...lexical(body)]), up: params };
      for (const p of n.params) walk(p, params);
      if (n.body.type === 'BlockStatement') for (const s of body) walk(s, inner); else walk(n.body, inner);
      return;
    }
    let inner = sc;
    if (n.type === 'Program') inner = open([...local(vars(n)), ...lexical(n.body)]);
    else if (n.type === 'BlockStatement') inner = open(lexical(n.body));
    else if (n.type === 'StaticBlock') inner = open([...local(n.body.flatMap((x) => vars(x))), ...lexical(n.body)]);
    else if (n.type === 'SwitchStatement') inner = open(lexical(n.cases.flatMap((c) => c.consequent)));
    else if (n.type === 'CatchClause') inner = open(local(ids(n.param)));
    else if (n.type === 'ClassExpression' && n.id) inner = open([[n.id.name, 'local']]);
    else if (/^For(In|Of)?Statement$/.test(n.type)) { const d = n.init ?? n.left; if (d && d.type === 'VariableDeclaration' && d.kind !== 'var') inner = open(local(d.declarations.flatMap((x) => ids(x.id)))); }
    if (n.type === 'AssignmentExpression') for (const x of ids(n.left)) wrote(x, n, inner, n.operator);
    if (n.type === 'UpdateExpression' && n.argument.type === 'Identifier') wrote(n.argument.name, n, inner, n.operator);
    if ((n.type === 'ForInStatement' || n.type === 'ForOfStatement') && n.left.type !== 'VariableDeclaration') for (const x of ids(n.left)) wrote(x, n, inner, 'for');
    for (const c of kids(n)) walk(c, inner);
  };
  walk(ast, null);
}
process.stdout.write(JSON.stringify({ parsed, writes: out }));
`;

// Imports one module alone, recording what it does while it loads; reports on fd 3.
const ALONE = `import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
const file = process.argv[2];
const seen = [];
const note = (what) => { if (!seen.includes(what)) seen.push(what); };
const argv = process.argv;
Object.defineProperty(process, 'argv', { configurable: true, get() { note('read process.argv'); return argv; } });
for (const k of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) { const f = cp[k]; cp[k] = function (...a) { note('spawned: child_process.' + k); return f.apply(this, a); }; }
for (const k of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'unlinkSync', 'renameSync', 'copyFileSync', 'createWriteStream', 'writeFile', 'appendFile', 'mkdir', 'symlinkSync', 'truncateSync', 'mkdtempSync', 'rmdirSync', 'cpSync']) { const f = fs[k]; fs[k] = function (...a) { note('wrote: fs.' + k); return f.apply(this, a); }; }
const open = fs.openSync;
fs.openSync = function (p, flags = 'r', ...a) { if (!/^rs?\\+?$/.test(String(flags)) || String(flags).includes('+')) note('wrote: fs.openSync ' + flags); return open.call(this, p, flags, ...a); };
syncBuiltinESMExports();
for (const s of [process.stdout, process.stderr]) { const w = s.write.bind(s); s.write = (c, ...a) => { note('printed: ' + JSON.stringify(String(c).slice(0, 80))); return w(c, ...a); }; }
let error = null;
try { await import(pathToFileURL(file).href); } catch (e) { error = String(e && e.stack || e).split('\\n').slice(0, 2).join(' | '); }
fs.writeSync(3, JSON.stringify({ seen, error }) + '\\n');
`;
