// Knowledge in decisions and prompts (the OODA spec, PR 4): a decision cites the knowledge or
// problems it rests on, a worker's or planner's start records the lessons its prompt carried, and a
// fixed incident nobody learned from is orientation debt until a lesson or a noise ruling cites it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line, hasTmux } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
// A line as the kit would have written it agoMs ago, in its writer's file. Ids follow the kit's
// form, so each line picks a distinct agoMs; lines go in time order.
function handFor(F) {
  const logDir = path.join(F.old, 'docs/devteam/run/log');
  return (by, o, agoMs = 1000) => {
    const d = new Date(Date.now() - agoMs);
    const id = o.id ?? `${{ observation: 'o', problem: 'p', decision: 'd', act: 'a', knowledge: 'k' }[o.type]}-${stamp(d)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${d.toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
    return id;
  };
}
const peek = (F, kind, id) => json(F.ok(F.old, ['peek', kind, id, '--json']));
const decisionOf = (F, id) => json(F.ok(F.old, ['log', '--type', 'decision', '--json'])).find((d) => d.id === id);

test('decide --on: a decision cites the accepted knowledge or problems it rests on, apart from its refs', () => {
  const F = fleetFixture('ooda-on');
  const { old, ok, run } = F;
  try {
    const o1 = ok(old, ['observe', '--subject', 'app', '--kind', 'note', '--detail', 'the registry has a scratch copy'], SUP).trim();
    const rule = ok(old, ['knowledge', 'add', '--kind', 'preference', '--statement', 'Keep scratch copies out of the registry', '--scope', 'project', '--owner']).trim();
    const cand = ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'Scratch copies confuse workers', '--scope', 'project', '--evidence', o1], SUP).trim();
    const old1 = ok(old, ['knowledge', 'add', '--kind', 'fact', '--statement', 'The registry was hand-kept', '--scope', 'project', '--owner']).trim();
    ok(old, ['knowledge', 'set', old1, '--status', 'retired', '--owner']);
    const p = ok(old, ['problem', 'add', '--title', 'registry drift', '--severity', '1'], SUP).trim();

    // without --on, then with it: the same call, the same authority; knowledge stored, refs as given
    const plain = ok(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--', 'the registry stays as it is'], SUP).trim();
    const on = ok(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', rule, p, '--', 'the registry stays as it is'], SUP).trim();
    const d0 = decisionOf(F, plain), d1 = decisionOf(F, on);
    assert.equal(d0.knowledge, undefined, 'no --on, no field');
    assert.deepEqual(d1.knowledge, [rule, p]);
    assert.deepEqual(d1.refs, [o1], 'never copied into refs');
    assert.equal(d1.authority, d0.authority, 'citing a standing rule with --on is not resting on it for authority');
    assert.equal(d1.approved_by, undefined);
    // an act under it stays within its refs, as before
    ok(old, ['act', '--decision', on, '--', 'left the registry as it is'], SUP);
    assert.match(run(old, ['act', '--decision', on, '--refs', rule, '--', 'x'], SUP).err, /outside it/);

    // refused: a candidate, a retired lesson, an observation, an unknown id, one in both lists, a bare --on
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', cand, '--', 'x'], SUP).err, new RegExp(`${cand} is candidate: a decision rests only on accepted knowledge`));
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', old1, '--', 'x'], SUP).err, new RegExp(`${old1} is retired: a decision rests only on accepted knowledge`));
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', o1, '--', 'x'], SUP).err, /--on .*knowledge or a problem/);
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', 'k-nope', '--', 'x'], SUP).err, /--on k-nope: no such/);
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, p, '--on', p, '--', 'x'], SUP).err, new RegExp(`${p} is in both --refs and --on`));
    assert.match(run(old, ['decide', '--class', 'registry-edit', '--refs', o1, '--on', '--', 'x'], SUP).err, /--on names/);

    // lineage draws what it rests on before it
    const L = peek(F, 'decision', on).lineage;
    for (const k of [rule, p]) assert.ok(L.edges.some((e) => e.from === k && e.to === on && e.why === 'rests on'), `${k} → ${on}: ${JSON.stringify(L.edges)}`);
    // the peek names them in their own words
    assert.equal(peek(F, 'decision', on).cited[rule].text, 'Keep scratch copies out of the registry');
  } finally { F.done(); }
});

test('a start records the accepted knowledge its prompt carried: fresh starts only, newest first, at most 60', { skip: !hasTmux && 'no tmux' }, () => {
  const F = fleetFixture('ooda-given');
  const { old, ok } = F;
  const hand = handFor(F);
  const ticket = (id, component) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component, kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`${component}/**`], done_when: ['the tidy check passes in CI'] })], SUP);
  const starts = () => json(ok(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'worker-slots');
  const startOf = (name) => starts().filter((a) => a.what.includes(` ${name} in `)).pop();
  const rawLine = (id) => fs.readdirSync(path.join(old, 'docs/devteam/run/log')).flatMap((f) => fs.readFileSync(path.join(old, 'docs/devteam/run/log', f), 'utf8').split('\n')).find((l) => l.includes(`"id":"${id}"`));
  try {
    // 61 accepted lessons for one component, written hours ago, in time order
    const many = Array.from({ length: 61 }, (_, i) => hand('owner', { type: 'knowledge', kind: 'lesson', statement: `lesson ${i} for the mn component`, scope: 'component:mn', status: 'accepted', evidence: [] }, (100 - i) * 60000));
    ticket('ch-01-tidy', 'ch');
    ticket('ot-01-other', 'ot');
    ticket('mn-01-many', 'mn');
    const lesson = ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'Run the tidy check before pushing', '--scope', 'component:ch', '--owner']).trim();
    ok(old, ['knowledge', 'add', '--kind', 'lesson', '--statement', 'Tidy checks are slow on Mondays', '--scope', 'component:ch', '--evidence', many[0]], SUP); // a candidate: not given

    // given: the one accepted lesson in its scope, in its prompt and on its act
    ok(old, ['worker', 'ch-01-tidy'], SUP);
    const a = startOf('ch-01-tidy');
    assert.match(a.what, /^made worker ch-01-tidy in /, 'what is as LAUNCH_ACT reads it');
    assert.deepEqual(a.knowledge, [lesson]);
    assert.ok(fs.readFileSync(path.join(old, 'docs/devteam/run/prompts/ch-01-tidy.txt'), 'utf8').includes(`(${lesson})`));
    // none in scope: no field
    ok(old, ['worker', 'ot-01-other'], SUP);
    assert.equal('knowledge' in startOf('ot-01-other'), false);
    assert.ok(!rawLine(startOf('ot-01-other').id).includes('"knowledge"'), 'omitted, not empty');
    // a resumed session never reads a new prompt: nothing recorded as given
    ok(old, ['worker', 'ch-01-tidy', '--resume'], SUP);
    const r = startOf('ch-01-tidy');
    assert.match(r.what, /^resumed worker ch-01-tidy in /);
    assert.equal(r.knowledge, undefined);
    // at most 60, newest first; the line stays under 4,096 bytes
    ok(old, ['worker', 'mn-01-many'], SUP);
    const m = startOf('mn-01-many');
    assert.equal(m.knowledge.length, 60);
    assert.deepEqual(m.knowledge, many.slice(1).reverse());
    assert.ok(Buffer.byteLength(rawLine(m.id)) < 4096, `${Buffer.byteLength(rawLine(m.id))} bytes`);
    // a planner's start too
    const G = ok(old, ['goal', 'add', '--title', 'Tidy everything', '--outcome', 'nothing untidy', '--measure', 'untidy files', '--target', '0', '--unit', 'files', '--direction', 'down', '--source', 'prod', '--check', 'echo 0', '--non-goals', 'none', '--preconditions', 'a'], SUP).trim();
    const plan = ok(old, ['knowledge', 'add', '--kind', 'fact', '--statement', 'Plans name their goal', '--scope', 'project', '--owner']).trim();
    ok(old, ['planner', 'beta', '--goal', G], SUP);
    assert.deepEqual(startOf('plan-beta').knowledge, [plan]);
    // the lineage draws a lesson into the start it was given to
    const L = peek(F, 'act', a.id).lineage;
    assert.ok(L.edges.some((e) => e.from === lesson && e.to === a.id && e.why === 'rests on'), JSON.stringify(L.edges));
  } finally { F.done(); }
});
