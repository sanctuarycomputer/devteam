// Autonomy suggestions (kit-99): a suggestion is something the dashboard can point at, and a thread can be about.
// Ports: none
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, threadsFixture } from './lib/kit.mjs';

test('subject: thread new takes suggestion:<id>, one thread per subject', () => {
  const F = threadsFixture('sugg-subject');
  try {
    const args = ['thread', 'new', '--subject', JSON.stringify({ kind: 'item', ref: 'suggestion:tr-raise-x' }), '--', 'about this'];
    const first = F.owner(args).split('\n')[0];
    assert.match(first, /^t-\d{8}-\d{9}-owner$/);
    assert.match(F.fails(args), new RegExp(`${first} is already open on this subject`));
  } finally {
    F.done();
  }
});

test('page names it: T_TYPES, T_KIND, T_HOME, T_WHERE, one key', () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* threads-core start */'), html.indexOf('/* threads-core end */'));
  assert.ok(src.length > 500, 'the threads-core block is marked in index.html');
  const ctx = vm.createContext({ TextEncoder, URL });
  vm.runInContext(`${src}\n;globalThis.api = { T_TYPES, T_KIND, T_HOME, T_WHERE, tKey };`, ctx);
  const A = ctx.api;
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const kitSrc = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
  const kitLine = (name) => new RegExp(`^const ${name} = .*$`, 'm').exec(kitSrc)[0];
  const K = vm.runInContext(`${kitLine('SUBJECT_TYPES')}\n${kitLine('subjectKey')}\n;({ SUBJECT_TYPES, subjectKey })`, vm.createContext({}));
  assert.deepEqual(plain(A.T_TYPES), plain(K.SUBJECT_TYPES));
  assert.ok(A.T_TYPES.includes('suggestion'));
  assert.equal(A.T_KIND.suggestion, 'a suggestion');
  assert.equal(A.T_HOME.suggestion, 'trust');
  assert.equal(A.T_WHERE.suggestion, 'Trust');
  const s = { kind: 'item', ref: 'suggestion:a' };
  assert.equal(A.tKey(s), K.subjectKey(s));
  assert.equal(A.tKey(s), 'item:suggestion:a');
});
