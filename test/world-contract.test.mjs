// self@1 and exterior@1: the shapes of project/self.md (what a project is) and project/exterior.md
// (what it relates to), held as $defs in log.schema.json, against their fixtures in
// test/fixtures/world/. kit-139 (self show|check), kit-135 (exterior show|check) and kit-137 (the
// dashboard) build against these fixtures and refuse the same invalid/ cases, so a fixture that
// drifts from the schema, or a schema that drifts from the spine (design
// sense-the-business-s-outside-world), fails here first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { schema as S, defs, cut, schemaErrors, blocks, checkSelf, checkExterior, namesWhole, dashboardSelf, dashboardExterior } from './fixtures/world/check.mjs';

const dir = fileURLToPath(new URL('./fixtures/world/', import.meta.url));
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const json = (f) => JSON.parse(read(f));
const blockOf = (f, info) => JSON.parse(blocks(read(f)).blocks.find((b) => b.info === info).body);
const strategy = read('strategy.md');

const SUBSET = ['type', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'items', 'properties', 'required', 'additionalProperties'];
const NOTES = ['description'];
const RELATIONS = ['serves', 'depends_on', 'builds_on_it', 'alternative', 'collaborates', 'governs', 'affects', 'other'];
const KINDS = ['organisation', 'group', 'work'];

// Every schema part a reader validates against: [name, part].
const parts = () => ['self', 'exterior'].flatMap((d) => ['block', 'dashboard'].map((k) => [`${d}.${k}`, S.$defs[d][k]]));
function walk(part, where, fn) {
  fn(part, where);
  if (part.items) walk(part.items, `${where}[]`, fn);
  for (const [k, v] of Object.entries(part.properties ?? {})) walk(v, `${where}.${k}`, fn);
}
// Every .md fixture but the strategy, valid and invalid.
const mdFixtures = () => [
  ...fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'strategy.md'),
  ...(fs.existsSync(path.join(dir, 'invalid')) ? fs.readdirSync(path.join(dir, 'invalid')).filter((f) => f.endsWith('.md')).map((f) => `invalid/${f}`) : []),
];

test('the checker runs the kit\'s own schemaErrors, cut from devteam.mjs', () => {
  assert.deepEqual(cut, { schemaErrors: true, asList: true });
});

test('the defs use only the keywords the kit\'s checker reads, each part described and each object closed', () => {
  for (const d of ['self', 'exterior']) {
    assert.deepEqual(Object.keys(S.$defs[d]).sort(), ['block', 'dashboard', 'description'], `$defs.${d}`);
    assert.match(S.$defs[d].description, new RegExp(`\\b${d}@1\\b`), `$defs.${d} names its contract`);
    assert.match(S.$defs[d].dashboard.description, /\bnull\b/, `$defs.${d}.dashboard says what an absent document is`);
  }
  for (const [name, def] of parts()) {
    walk(def, name, (part, where) => {
      for (const k of Object.keys(part)) assert.ok(SUBSET.includes(k) || NOTES.includes(k), `${where}.${k}: not a keyword the kit checks`);
      assert.ok(part.description, `${where} has no description`);
      if (part.type === 'object') assert.equal(part.additionalProperties, false, `${where} is open`);
      if (part.pattern) new RegExp(part.pattern);
    });
  }
  // the dashboard shapes require every field they have, at every level
  for (const d of ['self', 'exterior']) {
    walk(S.$defs[d].dashboard, `${d}.dashboard`, (part, where) => {
      if (part.properties) assert.deepEqual([...part.required].sort(), Object.keys(part.properties).sort(), `${where} requires every field`);
    });
  }
  assert.deepEqual(S.$defs.exterior.block.properties.entities.items.properties.relation.enum, RELATIONS);
  assert.deepEqual(S.$defs.exterior.block.properties.entities.items.properties.kind.enum, KINDS);
  assert.deepEqual(Object.keys(S.$defs.exterior.block.properties.entities.items.properties.signals.items.properties), ['id', 'what', 'value']);
});

test('strategy.md opens with a link to self.md', () => {
  const opening = strategy.split(/^## /m)[0];
  assert.match(opening, /\[[^\]]+\]\((\.\/)?self\.md\)/);
});

test('self.md is a title, prose and one valid self block', () => {
  const t = read('self.md');
  assert.match(t, /^# \S/);
  assert.ok(blocks(t).prose.replace(/^# .*$/m, '').trim().length > 0, 'prose outside the block');
  assert.deepEqual(checkSelf(t), []);
  const b = blockOf('self.md', 'self');
  assert.equal(b.self, 1);
  assert.ok(b.parts.length >= 1 && b.controls.length >= 1 && b.not.length >= 1);
});

test('exterior.md is a title, prose and one valid exterior block, with every relation and kind', () => {
  const t = read('exterior.md');
  assert.match(t, /^# \S/);
  assert.deepEqual(checkExterior(t), []);
  const b = blockOf('exterior.md', 'exterior');
  assert.equal(b.exterior, 1);
  assert.deepEqual([...new Set(b.entities.map((e) => e.relation))].sort(), [...RELATIONS].sort());
  assert.deepEqual([...new Set(b.entities.map((e) => e.kind))].sort(), [...KINDS].sort());
  const other = b.entities.find((e) => e.relation === 'other');
  assert.match(other.relation_word, /^[a-z]+$/);
  for (const e of b.entities) for (const s of e.signals) assert.deepEqual(Object.keys(s), ['id', 'what', 'value'], `${e.id}: ${s.id}`);
  assert.ok(b.entities.some((e) => e.signals.length === 0), 'an entity with no signal yet');
});

test('exterior-empty.md, with no entities, is valid', () => {
  assert.deepEqual(checkExterior(read('exterior-empty.md')), []);
  assert.deepEqual(blockOf('exterior-empty.md', 'exterior').entities, []);
});

test('exterior.md\'s blobs are the fixture strategy.md\'s and self.md\'s', () => {
  const blob = (f) => execFileSync('git', ['hash-object', path.join(dir, f)], { encoding: 'utf8' }).trim();
  const b = blockOf('exterior.md', 'exterior');
  assert.equal(b.strategy_blob, blob('strategy.md'));
  assert.equal(b.self_blob, blob('self.md'));
});

test('nothing in a fixture names what the strategy does not', () => {
  // every capitalised word, anywhere in any fixture, is in strategy.md
  for (const f of mdFixtures()) {
    for (const w of new Set(read(f).match(/\p{Lu}[\p{L}\p{N}'-]*/gu) ?? [])) assert.ok(namesWhole(strategy, w), `${f}: "${w}" is not in strategy.md`);
  }
  // every organisation or work, and every quote, of exterior.md and the invalid exterior files
  for (const f of mdFixtures().filter((x) => /(^|\/)exterior[^/]*\.md$/.test(x))) {
    let b;
    try { b = JSON.parse(blocks(read(f)).blocks.find((x) => x.info === 'exterior')?.body); } catch { continue; }
    if (!b || !Array.isArray(b.entities)) continue;
    for (const e of b.entities) {
      if (['organisation', 'work'].includes(e.kind)) assert.ok(namesWhole(strategy, e.name), `${f}: ${e.name} is not in strategy.md`);
      for (const q of Array.isArray(e.strategy) ? e.strategy : []) assert.ok(strategy.includes(q), `${f}: ${e.id} quotes "${q}", not in strategy.md`);
    }
  }
});

test('namesWhole matches whole words only, ignoring case', () => {
  assert.ok(namesWhole('We sync with Cloudberry Storage daily.', 'cloudberry storage'));
  assert.ok(!namesWhole('We use Google.', 'Go'));
  assert.ok(!namesWhole('Ledgerpads are many.', 'Ledgerpad'));
  assert.ok(namesWhole('(Ledgerpad)', 'Ledgerpad'));
  assert.ok(namesWhole('a.b+c', 'b+c'), 'a name\'s regex characters are escaped');
});

test('dashboard-data.json is both documents\' dashboard blocks, each valid, and scores are weight times value', () => {
  const d = json('dashboard-data.json');
  assert.deepEqual(Object.keys(d).sort(), ['exterior', 'self']);
  assert.deepEqual(schemaErrors(defs.self.dashboard, d.self, 'self'), []);
  assert.deepEqual(schemaErrors(defs.exterior.dashboard, d.exterior, 'exterior'), []);
  assert.deepEqual(d.self, dashboardSelf(blockOf('self.md', 'self')));
  assert.deepEqual(d.exterior, dashboardExterior(blockOf('exterior.md', 'exterior')));
  const b = blockOf('exterior.md', 'exterior');
  d.exterior.entities.forEach((e, i) => e.signals.forEach((s, j) => assert.equal(s.score, b.entities[i].weight * b.entities[i].signals[j].value, `${e.entity}.${s.signal}`)));
  assert.ok(d.exterior.entities.some((e) => typeof e.relation_word === 'string'));
  assert.ok(d.exterior.entities.some((e) => e.relation_word === null));
  // typed out, not computed: a builder that swapped two fields would still make a valid, self-consistent file
  const fair = d.exterior.entities.find((e) => e.entity === 'press-fair');
  assert.deepEqual({ ...fair, signals: undefined }, {
    entity: 'press-fair', relation: 'other', relation_word: 'sponsors', kind: 'organisation', name: 'Small Press Fair',
    matters: 'It sponsors the yearly meetup, where most new plugin writers first come.', weight: 1, signals: undefined,
  });
  const prices = d.exterior.entities.find((e) => e.entity === 'cloudberry').signals.find((s) => s.signal === 'storage-prices');
  assert.deepEqual(prices, { signal: 'storage-prices', what: 'Their storage prices, which set what sync costs.', value: 3, score: 9 });
  assert.equal(d.self.parts[0].name, 'The app');
});

test('dashboard-empty.json is the absent form: null under each key', () => {
  assert.deepEqual(json('dashboard-empty.json'), { self: null, exterior: null });
});

