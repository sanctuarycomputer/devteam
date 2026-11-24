// kit-109: a thread about a live session's work goes straight to that session, which replies in it.
// The contract is log.schema.json@responder-2: an owner turn routed_to session names the session it
// was typed to (routed_session), and a ticket or planner writer writes turns in threads bound to it.
// Its fake is the hand-written lines below (C0 accepted, C1-C4, S3g, S3i refused), checked by
// log-check the way every reader folds them. Run with TMUX unset (the fixture's own tmux server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { line, threadsFixture } from './lib/kit.mjs';

const W = 'web-09-live';
const FEAT = 'pricing';
const P = `plan-${FEAT}`;
const month = () => new Date().toISOString().slice(0, 7);

test('kit-109 contract: log.schema.json@responder-2', async (t) => {
  const F = threadsFixture('session-contract');
  t.after(() => F.done());
  F.sup(['feature', 'add', FEAT, '--json', JSON.stringify({ title: 'Pricing', goals: [F.goal], stories: [{ id: 'PR-S1', text: 'a story', release: 'v1.0.0' }] })]);
  F.sup(['ticket', 'add', W, '--json', JSON.stringify({ title: W, feature: FEAT, component: 'web', kind: 'build', size: 'S', risk: 'normal', serves: ['PR-S1'], depends_on: [], touches: ['src/**'], done_when: ['its test passes in CI'] })]);
  const T = 't-20261110-100000000-owner';
  const thread = ['owner', { type: 'thread', id: T, title: 'The pricing page', subject: { kind: 'item', ref: `ticket:${W}` } }];
  const ok = (...ls) => { const r = F.checkWith(...ls); assert.equal(r.status, 0, r.said); };
  const refused = (why, ...ls) => { const r = F.checkWith(...ls); assert.notEqual(r.status, 0, `refused: ${why}`); assert.match(r.said, why); };
  const routed = (extra) => ['owner', { type: 'turn', thread: T, text: 'Make it two tiers', ...extra }];

  await t.test('C0: the fake: a turn routed to a session, a ticket turn, a planner turn in its monthly file, a session handoff', () => {
    ok(thread,
      routed({ routed_to: 'session', routed_session: W }),
      [W, { type: 'turn', thread: T, text: 'Two tiers it is' }, `${W}.jsonl`],
      [P, { type: 'turn', thread: T, text: 'Noted for the plan' }, `${P}-${month()}.jsonl`],
      [W, { type: 'message', id: `m-${new Date(Date.now() - 50000).toISOString().replace(/[-:.Z]/g, '').replace('T', '-')}-${W}`, to: 'supervisor', kind: 'handoff', text: 'The owner asks to merge it', re: null, sha: null, ticket: null, thread: T }, `${W}.jsonl`]);
  });
  await t.test('C1: routed_session with routed_to supervisor is refused', () => {
    refused(/routed_session goes with routed_to session/, thread, routed({ routed_to: 'supervisor', routed_session: W }));
  });
  await t.test('C2: routed_session naming the supervisor is refused', () => {
    refused(/routed_session is a ticket or planner/, thread, routed({ routed_to: 'session', routed_session: 'supervisor' }));
  });
  await t.test("C3: routed_session on a session's own turn is refused", () => {
    refused(/routed_to and delivered are on the owner's turns/, thread, [W, { type: 'turn', thread: T, text: 'mine', routed_session: W }, `${W}.jsonl`]);
  });
  await t.test('C4: routed_to session with no routed_session is refused', () => {
    refused(/routed_session goes with routed_to session/, thread, routed({ routed_to: 'session' }));
  });
  await t.test("S3g: log-check refuses a session turn with question, and keeps one without", () => {
    refused(/a session's turns ask nothing/, thread, [W, { type: 'turn', thread: T, text: 'asking', question: 'q-20990101-000000000-supervisor' }, `${W}.jsonl`]);
    ok(thread, [W, { type: 'turn', thread: T, text: 'fine' }, `${W}.jsonl`]);
  });
  await t.test("S3i: log-check refuses a planner's turn in its plan file", () => {
    // a plan file is read from the durable log (the plan branch's, landed), never the live one
    const pf = path.join(F.old, 'docs/devteam/project/log', `${P}.jsonl`);
    const was = fs.existsSync(pf) ? fs.readFileSync(pf) : null;
    const d = new Date(Date.now() - 30000);
    const stamp = `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
    try {
      fs.mkdirSync(path.dirname(pf), { recursive: true });
      fs.appendFileSync(pf, line({ op: 'new', type: 'turn', id: `u-${stamp}-${P}`, at: d.toISOString(), by: P, thread: T, text: 'in the plan file' }));
      refused(/a planner's turns belong in its monthly file/, thread);
    } finally {
      if (was === null) fs.rmSync(pf, { force: true }); else fs.writeFileSync(pf, was);
    }
  });
});
