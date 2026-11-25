// kit-863: exterior.md is a plain document (exterior@2). P1, P1t: the self-plain region of devteam.mjs,
// run alone in vm, gives every world2 exterior case its cases.json result, word for word the
// reference's, and reads a hostile or large text in linear time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { checkExterior as refCheckExterior } from './fixtures/world2/check.mjs';

const SRC = fs.readFileSync(new URL('../docs/devteam/scripts/devteam.mjs', import.meta.url), 'utf8');
const world2 = (f) => fs.readFileSync(new URL(`./fixtures/world2/${f}`, import.meta.url), 'utf8');
const W2 = JSON.parse(world2('cases.json'));
const CASES = W2.cases.filter((c) => c.doc === 'exterior');
const allowed = { names: `${world2('strategy.md')}\n${Object.keys(W2.package.dependencies).join('\n')}`, words: `${world2('strategy.md')}\n${JSON.stringify(W2.package)}` };
const region = () => SRC.match(/\/\* self-plain start \*\/([\s\S]*?)\/\* self-plain end \*\//)?.[1] ?? '';
const plainOf = () => vm.runInContext(`${region()}\n;(typeof selfPlain === 'object' ? selfPlain : {})`, vm.createContext({ path, URL }));
const copy = (x) => JSON.parse(JSON.stringify(x));

test('P1 the region gives each world2 exterior case its result', () => {
  const P = plainOf();
  assert.equal(typeof P.checkExterior, 'function', 'P1 the self-plain region has checkExterior');
  assert.equal(CASES.length, 105, 'P1 105 exterior cases');
  for (const c of CASES) {
    const opts = { today: W2.today, visibility: c.visibility, allowed };
    const got = copy(P.checkExterior(world2(c.file), opts));
    for (const k of ['errors', 'warnings']) {
      assert.equal(got[k].length, c.expect[k].length, `P1 ${c.file} ${k}: ${JSON.stringify(got[k])}`);
      c.expect[k].forEach((w, i) => assert.ok(got[k][i].includes(w), `P1 ${c.file}: "${got[k][i]}" names "${w}"`));
    }
    for (const k of ['refused', 'held', 'hosts']) assert.deepEqual(got[k], c.expect[k], `P1 ${c.file} ${k}`);
    assert.deepEqual(got, refCheckExterior(world2(c.file), opts), `P1 ${c.file}: word for word the reference's`);
  }
  for (const f of ['exterior.md', 'exterior-topic.md']) for (const visibility of ['private', 'public', 'unknown']) {
    assert.deepEqual(copy(P.checkExterior(world2(f), { today: W2.today, visibility, allowed })), { errors: [], warnings: [], refused: [], held: [], hosts: [] }, `P1 ${f} ${visibility}`);
  }
});

// kit-862 final-2 F1, final-3 M1: the names hold is linear in links and words; each text under 2 s
test('P1t the region reads a hostile or large exterior text in under 2 s each', () => {
  const P = plainOf();
  assert.equal(typeof P.checkExterior, 'function', 'P1t the self-plain region has checkExterior');
  const name = (i) => `Z${i.toString(36).replace(/\d/g, (d) => 'abcdefghij'[d])}x`;
  const distinct = (n) => Array.from({ length: n }, (_, i) => name(i)).join(' ');
  for (const [what, x] of [
    ['20,000 distinct held words', distinct(20000)],
    ['40,000 nested [ then links', `${'['.repeat(40000)}${'[a](b) '.repeat(40000)}`],
    ['40,000 links to distinct hosts', Array.from({ length: 40000 }, (_, i) => `[a](https://h${i}.example/)`).join(' ')],
    ['5,000 ### entries, each dated', Array.from({ length: 5000 }, (_, i) => `### ${name(i)}\n\n[p](https://x.example/) (read 2026-11-20)\n`).join('\n')],
    ['a user of 100,000 commas', `[x](https://${'a,'.repeat(100000)}@b.example)`],
    ['www. 2,000 times', 'www.'.repeat(2000)],
  ]) {
    const start = process.hrtime.bigint();
    assert.doesNotThrow(() => P.checkExterior(`# T\n\n${x}\n`, { today: W2.today, visibility: 'public', allowed }), what);
    const s = Number(process.hrtime.bigint() - start) / 1e9;
    assert.ok(s < 2, `P1t ${what} took ${s.toFixed(2)} s`);
  }
});
