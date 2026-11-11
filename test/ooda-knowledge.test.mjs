// Knowledge in decisions and prompts (the OODA spec, PR 4): a decision cites the knowledge or
// problems it rests on, a worker's or planner's start records the lessons its prompt carried, and a
// fixed incident nobody learned from is orientation debt until a lesson or a noise ruling cites it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json, line } from './lib/kit.mjs';

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
