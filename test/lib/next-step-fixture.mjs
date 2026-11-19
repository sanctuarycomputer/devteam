// What next-step.*.test.mjs share. Next best step: the supervisor rates (each goal's impact against
// the strategy, each question's stake and urgency, what an answer would settle), the kit counts and
// orders. The order is computed on every read; nothing here stores it.
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line, write } from './kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

// A fixture with helpers: ready goals, features, tickets, questions and their ranks.
function fixture(name) {
  const F = fleetFixture(name);
  const { old, ok, run, g } = F;
  let n = 0;
  const ownerLine = (o) => fs.appendFileSync(path.join(old, 'docs/devteam/run/log', `owner-${new Date().toISOString().slice(0, 7)}.jsonl`), line({ at: new Date().toISOString(), by: 'owner', channel: 'cli', ...o }));
  const goal = (title, priority) => { const id = ok(old, ['goal', 'add', '--title', title, '--outcome', 'it works', '--priority', String(priority)], SUP); ownerLine({ id, type: 'goal', op: 'set', status: 'ready' }); return id; };
  const feature = (id, goalId) => ok(old, ['feature', 'add', id, '--json', JSON.stringify({ title: id, goals: [goalId], stories: [{ id: `${id.toUpperCase()}-S1`, text: 'it works', release: 'v1.0.0' }] })], SUP);
  const ticket = (id, feat, deps = []) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: feat, component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: [`${feat.toUpperCase()}-S1`], depends_on: deps, touches: [`src/${id}/**`], done_when: ['its test passes in CI'] })], SUP);
  const ask = (question, ...opts) => ok(old, ['ask', '--question', question, ...opts], SUP);
  const impact = (goalId, level, why = 'the strategy puts this first') => ok(old, ['goal', 'impact', goalId, String(level), '--rationale', why], SUP);
  const inbox = () => json(ok(old, ['questions', '--json']));
  const rank = (id) => inbox().find((q) => q.id === id).rank;
  const findings = (kind) => json(ok(old, ['metrics', '--json'])).findings.filter((f) => f.kind === kind);
  // a ticket merged: a commit on main named for it, as the merge word leaves one
  const merged = (id) => { write(path.join(old, `src/${id}.txt`), `${++n}\n`); g(['add', '-A'], old); g(['commit', '-qm', `${id}: done`], old); g(['push', '-q', 'origin', 'main'], old); };
  return { ...F, ownerLine, goal, feature, ticket, ask, impact, inbox, rank, findings, merged };
}
const yesNo = ['--choices', JSON.stringify([{ label: 'Build it' }, { label: "Don't build it" }]), '--recommendation', 'Build it'];

// A question written straight to the log: for a fixture of a hundred, and the shapes ask refuses.
let rawN = 0;
const raw = (F) => {
  const lines = [];
  const add = (o, i) => { const id = `q-20260105-${String(++rawN).padStart(9, '0')}-supervisor`; lines.push(line({ id, type: 'question', op: 'new', at: new Date(Date.UTC(2026, 0, 5, 0, i ?? rawN)).toISOString(), by: 'supervisor', kind: 'owner-decision', question: `Q ${id}?`, ...o })); return id; };
  return { add, flush: () => fs.appendFileSync(path.join(F.old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`), lines.join('')) };
};

export { fixture, raw, SUP, yesNo };
