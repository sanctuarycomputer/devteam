// The load-time overlay (test/split/overlay/load-time/): nothing cross-module runs while the CLI's
// modules load, and no module writes another's let but through its setter. L1-L5 run the overlay's
// checks on fixture modules, L5b the shared-state check on the entry, L8 it when node's acorn can't load.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES = path.join(root, 'test', 'split', 'overlay', 'load-time', 'rules.mjs');
const { checks, LIB, ENTRY_FILE, ACORN } = await import(pathToFileURL(RULES).href);

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
});

test("L5b: the shared-state check reads the entry too, whose imports are in its body: a write there to another module's let is refused", async () => {
  const refused = await checkOn({ 'a.mjs': LETS, '(entry)': "import { X } from './lib/a.mjs';\nimport { K } from './lib/a.mjs';\nX = 2;\nexport const k = K;\n" }, 'shared-state');
  assert.deepEqual(refused.map((r) => `${r.site}: ${r.why}`), [`${ENTRY_FILE}:3 X: writes X (assign), a let of ${LIB}/a.mjs: an import can't be assigned`]);
});

test('L8: when node\'s acorn can\'t load, the shared-state check is refused as a whole, naming it', async () => {
  const was = ACORN.path;
  ACORN.path = 'internal/deps/acorn/missing';
  try {
    const want = [{ site: LIB, why: "node's acorn (--expose-internals) failed: Error: Cannot find module 'internal/deps/acorn/missing'" }];
    assert.deepEqual(await checkOn({ 'a.mjs': LETS, 'b.mjs': mod(["import { X } from './a.mjs';"], 'export function w() { X = 1; }\n') }, 'shared-state'), want);
  } finally { ACORN.path = was; }
});
