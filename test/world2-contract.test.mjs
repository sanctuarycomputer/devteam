// self@2 and exterior@2: project/self.md and project/exterior.md as plain documents, their rules in
// log.schema.json's $defs.self2 and $defs.exterior2, against the fixtures in test/fixtures/world2/.
// kit-862 (self), kit-863 (exterior) and kit-866 (the dashboard) build against these, and give each
// case of cases.json the result it lists, so a checker that drifts from the fixtures fails here first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSelf, checkExterior, entries, headings, version, namesWhole } from './fixtures/world2/check.mjs';

const dir = fileURLToPath(new URL('./fixtures/world2/', import.meta.url));
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const { root, paths, today, package: pkg, cases } = JSON.parse(read('cases.json'));
const S = JSON.parse(fs.readFileSync(new URL('../docs/devteam/schema/log.schema.json', import.meta.url), 'utf8'));
// The fixture repo: a path is there when it is a listed file or a folder above one, by exact case.
const has = (p) => p === '' || paths.some((f) => f === p || f.startsWith(`${p}/`));
const allowed = { names: `${read('strategy.md')}\n${Object.keys(pkg.dependencies).join('\n')}`, words: `${read('strategy.md')}\n${JSON.stringify(pkg)}` };
const run = (c) => (c.doc === 'self' ? checkSelf(read(c.file), { root, has }) : checkExterior(read(c.file), { today, allowed, visibility: c.visibility }));
const clean = { errors: [], warnings: [], refused: [], held: [], hosts: [] };

test('the defs describe each contract, beside version 1, and hold no shape', () => {
  const both = ['plain markdown document and nothing else', 'opens with one # title', 'info string is exactly self or exterior makes it version 1', 'a new draft may not be', "the reference checker's, test/fixtures/world2/check.mjs", 'test/fixtures/world2/cases.json lists each case with its result', 'A later version is a kit change, not a mark in the document'];
  for (const [d, id, words] of [
    ['self2', 'self@2', [...both, 'what the project is, as', 'what it makes, its parts, what it controls and what it touches but does not', 'inline link outside code and comments', 'not an image', 'its target relative: no scheme, no leading /, not only an #anchor', 'anchor and query are dropped, its % escapes decoded', "resolves from the file's folder", 'must stay inside the repo', 'exist, by exact case', "an .md in self.md's own folder is a reference, not a part", 'reference-style and angle-bracket links are prose', 'At least one part is required']],
    ['exterior2', 'exterior@2', [...both, '## sections group by relation', 'a ### entry is one subject', 'never a person', 'Order is importance: the first section and the first entry matter most', 'Headings in code or a comment are not read', '(read YYYY-MM-DD)', 'a sentence holding read YYYY-MM-DD', 'no web address or no read date', 'a date after today', 'a warning at the draft, never a refusal', 'known to be private it names freely', 'unknown counts as public', 'named whole, ignoring case', "origin main's strategy or dependency names", 'else it is refused', 'every capitalised word of the whole text, no place skipped', 'every link host', "the strategy and the dependency files' whole text", 'held until named on the chore']],
  ]) {
    assert.deepEqual(Object.keys(S.$defs[d] ?? {}), ['description'], `$defs.${d} is a description only`);
    for (const w of [id, ...words]) assert.ok(S.$defs[d].description.includes(w), `$defs.${d} says "${w}"`);
    assert.ok(S.$defs[d].description.includes('test/fixtures/world2/'), `$defs.${d} names its fixtures`);
  }
  for (const d of ['self', 'exterior']) assert.deepEqual(Object.keys(S.$defs[d]).sort(), ['block', 'dashboard', 'description'], `$defs.${d} stays`);
});

test('self.md holds: its parts are its links', () => {
  assert.deepEqual(checkSelf(read('self.md'), { root, has }), { errors: [], parts: ['docs/app', 'docs/services/sync', 'docs/plugin api/index.js'] });
  assert.equal(version(read('self.md')), 2);
});

test('exterior.md holds: entries in order of importance, each dated, on a public repo too', () => {
  const t = read('exterior.md');
  for (const visibility of ['private', 'public', 'unknown']) assert.deepEqual(checkExterior(t, { today, allowed, visibility }), clean, visibility);
  assert.deepEqual(entries(t).map((e) => e.name), ['Ledgerpad', 'Acme Storage', 'Open Notes Format']);
  assert.deepEqual(headings(t).filter((h) => h.level === 2).map((h) => h.text), ['Rivals', 'Vendors', 'Forces', 'Watch']);
  assert.equal(version(t), 2);
});

test('exterior-topic.md holds: its one entry is a topic and names no one', () => {
  const t = read('exterior-topic.md');
  for (const visibility of ['private', 'public', 'unknown']) assert.deepEqual(checkExterior(t, { today, allowed, visibility }), clean, visibility);
  assert.deepEqual(entries(t).map((e) => e.name), ['Moving notes between devices']);
  for (const n of ['Ledgerpad', 'Acme', 'Open Notes Format', 'Zorbly']) assert.ok(!namesWhole(t.replace(/https?:\S+/g, ''), n), n);
});

test('version 1 is a fenced self or exterior block, anywhere', () => {
  for (const c of cases) assert.equal(version(read(c.file)), c.expect.errors.some((e) => /^fenced (self|exterior) block$/.test(e)) ? 1 : 2, c.file);
  for (const f of ['self.md', 'exterior.md', 'exterior-empty.md']) assert.equal(version(read(`../world/${f}`)), 1, `world/${f}`);
});
