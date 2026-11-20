// One yes per link change: own-words answers and re-asks land, and another field landing spends nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { line } from './lib/kit.mjs';
import { chore, choreLinks, dry, ownWords, setup, wouldMerge } from './lib/link-approved-fixture.mjs';

test('own-words answers land: a set, and a gate field asked in governance-edit', () => {
  const T = setup('one-yes-land-own');
  try {
    const q1 = ownWords(T, { link: 'console', field: 'records', value: 'home' });
    T.yes(q1);
    T.ok(['link', 'set', 'console', 'records', 'home', '--approved', q1]);
    chore(T, 'records');
    wouldMerge(dry(T, 'records', q1), 'records');
    const T2 = setup('one-yes-land-own-gate');
    try {
      const q2 = ownWords(T2, { link: 'console', field: 'gates', value: { test: 'true' } });
      T2.yes(q2);
      T2.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q2]);
      chore(T2, 'gates');
      wouldMerge(dry(T2, 'gates', q2), 'gates');
    } finally { T2.done(); }
  } finally { T.done(); }
});

test('a re-ask lands under its own answer, the earlier yes still covering what it approved (either class)', () => {
  const T = setup('one-yes-land-reask');
  try {
    const q1 = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']).qid;
    T.yes(q1);
    T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q1]);
    const q2 = T.ask(['link', 'set', 'console', 'worktree_setup', 'pnpm i']).qid;
    T.yes(q2);
    T.ok(['link', 'set', 'console', 'worktree_setup', 'pnpm i', '--approved', q2]);
    const q3 = T.ask(['link', 'set', 'console', 'records', 'home']).qid;
    assert.equal(T.question(q3).class, 'governance-edit');
    assert.deepEqual(T.section(T.question(q3).context), ['links.console.records: main has null; would be "home"']);
    T.yes(q3);
    T.ok(['link', 'set', 'console', 'records', 'home', '--approved', q3]);
    const wt = chore(T, 'registry');
    assert.deepEqual([choreLinks(wt).console.gates, choreLinks(wt).console.worktree_setup, choreLinks(wt).console.records], [{ test: 'true' }, 'pnpm i', 'home']);
    wouldMerge(dry(T, 'registry', q3), 'registry');
  } finally { T.done(); }
});

test('another field landing on main between the answer and link land spends nothing, for a legacy answer too', () => {
  for (const legacy of [false, true]) {
    const T = setup(`one-yes-land-moved${legacy ? '-legacy' : ''}`);
    try {
      let q1;
      if (!legacy) q1 = T.ask(['link', 'set', 'console', 'gates', '{"test":"true"}']).qid;
      else {
        // as link set asked before this change: the entry lines and the bundle, no approves section
        T.ask(['link', 'set', 'companion', 'title', 'Companion']);
        const mainConsole = T.links().console;
        const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
        const next = { ...mainConsole, gates: { test: 'true' } };
        q1 = 'q-20261118-120000002-supervisor';
        const context = `The settings diff this answer approves, each links entry main has and what would land:\nlinks.console: main has ${canon(mainConsole)}; would be ${canon(next)}\n\nThe registry entries, as they would be in settings.md links (merge lands exactly these under this answer, and no other):\n${JSON.stringify({ console: next }, null, 2)}`;
        fs.appendFileSync(T.logFile(), line({ id: q1, type: 'question', op: 'new', at: new Date(Date.now() - 60000).toISOString(), by: 'supervisor', kind: 'owner-decision', class: 'gate-change', question: 'Change the repo link console (gates)?', context, recommendation: 'yes' }));
      }
      T.yes(q1);
      T.ok(['link', 'set', 'console', 'gates', '{"test":"true"}', '--approved', q1]);
      T.onMain((j) => { j.links.console.worktree_setup = 'npm ci'; });
      const wt = chore(T, 'registry');
      assert.deepEqual([choreLinks(wt).console.gates, choreLinks(wt).console.worktree_setup], [{ test: 'true' }, 'npm ci'], 'gates carried, main\'s worktree_setup kept');
      wouldMerge(dry(T, 'registry', q1), 'registry');
    } finally { T.done(); }
  }
});
