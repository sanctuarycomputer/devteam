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

test('cases.json lists every file in cases/ once, and each of its fields', () => {
  const files = fs.readdirSync(path.join(dir, 'cases')).map((f) => `cases/${f}`).sort();
  assert.deepEqual(cases.map((c) => c.file).sort(), files);
  for (const c of cases) {
    assert.ok(c.shows, c.file);
    assert.deepEqual(Object.keys(c.expect).sort(), (c.doc === 'self' ? ['errors', 'parts'] : Object.keys(clean)).sort(), c.file);
    if (c.doc === 'exterior') assert.ok(['private', 'public', 'unknown'].includes(c.visibility), c.file);
  }
});

for (const c of cases) {
  test(`${c.file}: ${c.shows}`, () => {
    const got = run(c);
    for (const k of ['errors', 'warnings']) {
      const want = c.expect[k] ?? [];
      assert.equal((got[k] ?? []).length, want.length, `${k}: ${JSON.stringify(got[k])}`);
      want.forEach((w, i) => assert.ok(got[k][i].includes(w), `${k}: "${got[k][i]}" names "${w}"`));
    }
    for (const k of ['parts', 'refused', 'held', 'hosts']) if (c.expect[k]) assert.deepEqual(got[k], c.expect[k], k);
  });
}

test('a hostile text is read in seconds, not minutes', () => {
  const n = 2000;
  for (const x of [`[a](${' '.repeat(n)}`, '[a]('.repeat(n), '['.repeat(n), '![' .repeat(n), '`` ` '.repeat(n), '<!-- '.repeat(n), 'www.'.repeat(n), `### ${'Z'.repeat(40000)}`, `x ${'#'.repeat(n)} y`]) {
    const start = process.hrtime.bigint();
    checkExterior(`# T\n\n${x}\n`, { today, allowed, visibility: 'public' });
    checkSelf(`# T\n\n${x}\n`, { root, has });
    assert.ok(process.hrtime.bigint() - start < 10_000_000_000n, x.slice(0, 20));
  }
});

test('a large text is read in under 2 s, without a throw', () => {
  const name = (i) => `Z${i.toString(36).replace(/\d/g, (d) => 'abcdefghij'[d])}x`;
  const distinct = (n) => Array.from({ length: n }, (_, i) => name(i)).join(' ');
  for (const [what, x] of [
    ['a 200,000-line paragraph', 'word\n'.repeat(200000)],
    ['20,000 comments on a line', `x ${'<!-- -->'.repeat(20000)}`],
    ["50,000 spaces inside a fence's info string", `\`\`\`a${' '.repeat(50000)}b\n\`\`\``],
    ['100,000 apostrophes in a word', `Za${"'".repeat(100000)}b`],
    ['20,000 distinct held words', distinct(20000)],
    ['3,000 Z words', distinct(3000)],
    ['40,000 nested [ then links', `${'['.repeat(40000)}${'[a](b) '.repeat(40000)}`],
    ['50,000 spaces in a heading', `### a${' '.repeat(50000)}b`],
    ['a heading of 50,000 [x](', `### ${'[x]('.repeat(50000)}`],
    ['100,000 ![ then 100,000 ](', `${'!['.repeat(100000)}${']('.repeat(100000)}`],
    ['a line of 18 list markers', `${'-   '.repeat(18)}x`],
    ['a line of 5,000 list markers', `${'-   '.repeat(5000)}x`],
    ['a line of 5,000 ordered markers', `${'1.  '.repeat(5000)}x`],
    ['100,000 spaces after ](', `[x](${' '.repeat(100000)}x`],
    ['a line of 200,000 nested markers', `${'* + '.repeat(100000)}x`],
    ['a user of 100,000 commas', `[x](https://${'a,'.repeat(100000)}@b.example)`],
  ]) {
    for (const [doc, check] of [['exterior', (t) => checkExterior(t, { today, allowed, visibility: 'public' })], ['self', (t) => checkSelf(t, { root, has })]]) {
      const start = process.hrtime.bigint();
      assert.doesNotThrow(() => check(`# T\n\n${x}\n`), `${doc}: ${what}`);
      const s = Number(process.hrtime.bigint() - start) / 1e9;
      assert.ok(s < 2, `${doc}: ${what} took ${s.toFixed(2)} s`);
    }
  }
});

// Every case, by name: a case dropped with its file, or one added without its name here, fails.
const CASES = [
  'self-block', 'self-exterior-block', 'self-block-tilde', 'self-no-title', 'self-two-titles', 'self-fenced-title',
  'self-fenced-heading', 'self-no-part', 'self-part-nothing', 'self-part-case', 'self-part-bad-escape',
  'self-part-outside', 'self-part-outside-escaped', 'self-part-code', 'self-part-image', 'self-part-anchor',
  'self-part-md', 'self-part-md-elsewhere', 'self-part-absolute', 'self-part-fence', 'self-part-indented',
  'self-part-comment', 'self-part-comment-midline', 'self-part-list-indented', 'self-part-span-list', 'self-part-parens',
  'self-part-slash', 'self-two-blocks', 'self-crlf', 'self-part-prose', 'self-part-resolves', 'exterior-block',
  'exterior-self-block', 'exterior-no-title', 'exterior-fenced-heading', 'exterior-no-date', 'exterior-no-link',
  'exterior-no-real-date', 'exterior-future-date', 'exterior-good-date', 'exterior-undated-first', 'exterior-date-deeper',
  'exterior-date-code', 'exterior-two-dates', 'exterior-date-wrapped', 'exterior-date-capital', 'exterior-source-autolink',
  'exterior-source-reference', 'exterior-source-parens', 'exterior-source-relative', 'exterior-empty-heading',
  'exterior-block-names', 'public-named', 'public-heading', 'public-heading-lower', 'public-heading-dependency',
  'public-line-start', 'public-list-item', 'public-table-cell', 'public-bold', 'public-section', 'public-link-host',
  'public-link-host-forms', 'public-heading-part', 'public-heading-substring', 'public-heading-any-case',
  'public-heading-dependency-file', 'public-possessive', 'public-url-word', 'public-fenced-host',
  'public-host-punctuation', 'public-host-user', 'private-names', 'unknown-names', 'public-host-user-comma',
  'public-host-user-semicolon', 'public-host-user-apostrophe', 'public-host-entity', 'public-host-entity-slashes',
  'public-host-entity-named', 'public-host-reference-tight', 'public-host-three-slashes', 'public-host-backslash',
  'public-host-href-break', 'public-host-mailto-second', 'public-host-email-autolink', 'public-host-email-bare',
  'public-host-email-version', 'public-host-user-brackets', 'public-host-escaped', 'public-host-reference-escaped',
  'public-host-email-autolink-local', 'public-host-href-after-break', 'public-host-href-unquoted',
  'public-host-href-no-semicolon', 'public-heading-not-a-link', 'public-heading-line-separator', 'public-heading-lone-cr',
  'public-host-user-space', 'public-host-user-reference-space', 'public-host-long-user', 'public-host-user-unicode-space',
  'self-part-unicode-space', 'public-host-user-angle-bracket', 'public-host-user-angle-bracket-breaks',
  'public-host-user-angle-bracket-feed', 'public-heading-span-in-tail', 'public-heading-span-in-angle-tail',
  'public-heading-code-span', 'public-heading-paren-title', 'public-heading-backslash-space', 'self-part-backslash-space',
  'self-part-list-fence', 'self-part-list-fence-open', 'self-part-list-fence-deep', 'public-heading-after-list-fence',
  'public-heading-after-ordered-interrupt', 'public-heading-after-nested-list-fence', 'public-heading-angle-link',
  'public-heading-after-indented-continuation', 'public-heading-after-empty-item-in-paragraph',
  'public-heading-after-one-line-nested-fence', 'public-heading-after-empty-item-fence', 'public-heading-after-item-fence',
  'public-heading-after-item-fence-wide', 'self-part-item-fence-deep', 'exterior-entry-ends-at-section',
  'public-one-letter', 'self-part-md-capital', 'self-part-long-tail', 'self-part-link-in-link', 'public-host-www-in-path',
  'self-part-after-break', 'self-part-in-image',
];
test('the cases are exactly these, the ticket done-whens\' among them', () => {
  assert.deepEqual(cases.map((c) => c.file), CASES.map((f) => `cases/${f}.md`));
});
