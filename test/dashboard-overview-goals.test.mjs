// The dashboard's Overview and Goals (kit-90): goalBlock, run alone in vm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const INDEX = fs.readFileSync(path.join(here, '..', 'docs', 'devteam', 'dashboard', 'index.html'), 'utf8');
const block = (src, name) => {
  const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`);
  assert.ok(a >= 0 && b > a, `the ${name} block is in the page`);
  assert.equal(src.indexOf(`/* ${name} start */`, a + 1), -1, `one ${name} block`);
  return src.slice(a, b + `/* ${name} end */`.length);
};

test('goalBlock: full, partial and null', () => {
  const ctx = vm.createContext({});
  vm.runInContext(`${block(INDEX, 'goal-block')}\nthis.goalBlock = goalBlock;`, ctx);
  const goalBlock = (g, d) => ctx.goalBlock(JSON.parse(JSON.stringify(g)), JSON.parse(JSON.stringify(d)));
  const G = { id: 'g1', status: 'ready' };
  const mk = (over = {}) => {
    const d = {
      ooda: { roadmap: { goals: [{ id: 'g1', features: ['f1'] }, { id: 'g2', features: ['f2'] }], features: { f1: {}, f2: {} } } },
      tickets: [{ id: 'a', feature: 'f1', stage: 'building' }, { id: 'b', feature: 'f1', stage: 'building' }],
      questions: [], planners: [],
    };
    return { ...d, ...over };
  };
  const tk = (d, id, o) => { Object.assign(d.tickets.find((t) => t.id === id), o); return d; };
  const q1 = { id: 'q-1', status: 'open' };
  let d = mk({ questions: [q1] }); tk(d, 'a', { held_by: 'q-1' }); tk(d, 'b', { phase: 'blocked' });
  assert.equal(goalBlock(G, d), 'full');
  d = mk({ questions: [{ id: 'q-2', status: 'open', default: 'x' }] }); tk(d, 'a', { held_by: 'q-2' });
  assert.equal(goalBlock(G, d), null);
  d = mk({ questions: [q1] }); tk(d, 'a', { held_by: 'q-1' }); tk(d, 'b', { depends_on: ['a'] });
  assert.equal(goalBlock(G, d), 'full');
  d = mk(); tk(d, 'a', { held: { reason: 'x' } });
  assert.equal(goalBlock(G, d), 'partial');
  d = mk({ questions: [{ id: 'q-3', status: 'open', blocks: ['b'] }] }); tk(d, 'a', { stage: 'merged' });
  assert.equal(goalBlock(G, d), 'full');
  const P = { goals: ['g1'], waiting: { kind: 'prompt' } };
  d = mk({ tickets: [], planners: [P] });
  assert.equal(goalBlock(G, d), 'full');
  d = mk({ tickets: [{ id: 'm', feature: 'f1', stage: 'building' }], planners: [P] });
  assert.equal(goalBlock(G, d), 'partial');
  assert.equal(goalBlock(G, mk()), null);
  assert.equal(goalBlock(G, mk({ tickets: [] })), null);
  d = mk({ questions: [q1] }); tk(d, 'a', { held_by: 'q-1' }); tk(d, 'b', { held_by: 'q-1' });
  assert.equal(goalBlock({ ...G, status: 'met' }, d), null);
  assert.equal(goalBlock({ ...G, status: 'abandoned' }, d), null);
  assert.equal(goalBlock({ ...G, hold_view: { mode: 'park' } }, d), null);
  d = mk({ tickets: [{ id: 'z', feature: 'f2', stage: 'building' }, { id: 'a', feature: 'f1', stage: 'building' }], questions: [{ id: 'q-4', status: 'open', blocks: ['z'] }] });
  assert.equal(goalBlock(G, d), null);
  d = mk({ tickets: [{ id: 'a', feature: 'f1', stage: 'building', held_by: 'q-1' }, { id: 'b', feature: 'f1', stage: 'building', depends_on: ['c'] }, { id: 'c', feature: 'f1', stage: 'building', depends_on: ['a'] }], questions: [q1] });
  assert.equal(goalBlock(G, d), 'full');
  d = mk({ questions: [{ id: 'q-5', status: 'open', default: 'y', blocks: ['a'] }] });
  assert.equal(goalBlock(G, d), null);
  d = mk({ tickets: [], planners: [{ goals: ['g1'], waiting: { kind: 'limit' } }] });
  assert.equal(goalBlock(G, d), null);
  // an open question with no default names a ticket by its ticket field
  d = mk({ questions: [{ id: 'q-6', status: 'open', ticket: 'a' }] }); tk(d, 'b', { depends_on: ['a'] });
  assert.equal(goalBlock(G, d), 'full');
  // a question that is not open holds nothing, by held_by or by blocks or ticket
  const ans = { id: 'q-7', status: 'answered', blocks: ['a', 'b'], ticket: 'a' };
  d = mk({ questions: [ans] }); tk(d, 'a', { held_by: 'q-7' });
  assert.equal(goalBlock(G, d), null);
  // merged, released and superseded tickets are done work, not stuck work
  for (const stage of ['released', 'superseded']) {
    d = mk({ questions: [q1] }); tk(d, 'a', { held_by: 'q-1' }); tk(d, 'b', { held_by: 'q-1', stage });
    assert.equal(goalBlock(G, d), 'full', stage);
    d = mk({ questions: [q1] }); tk(d, 'a', { stage }); tk(d, 'b', { held_by: 'q-1' });
    assert.equal(goalBlock(G, d), 'full', stage);
    d = mk({ questions: [q1] }); tk(d, 'a', { stage }); tk(d, 'b', { stage });
    assert.equal(goalBlock(G, d), null, stage);
  }
  // a stuck ticket that is done does not count, so a lone live one moving is not blocked
  d = mk({ questions: [q1] }); tk(d, 'a', { held_by: 'q-1', stage: 'released' });
  assert.equal(goalBlock(G, d), null);
});
