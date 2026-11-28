// The rung above the supervisor (cause G). wait returns at once only on a high finding no wait has
// woken on in standing_high_hours (run/wait-high), so one left standing stops short-circuiting every
// call; and a move stalled past twice next_move_stall_hours goes to the owner in one kit-kept Inbox
// question, the stuck-work digest, written by a supervisor's metrics run (never the operator's),
// asked again when its list changes, withdrawn when it empties, and shown on the hub's alert while
// open. Fixture projects drive the real CLI, as test/next-moves-findings.test.mjs does.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, json } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const first = (s) => s.split('\n')[0].trim();
const projects = [];
after(() => { for (const p of projects) p.F.done(); });

function project(name, settings = {}) {
  const F = fleetFixture(`wsd-${name}`);
  const { old, ok, g } = F;
  if (Object.keys(settings).length) {
    const sf = path.join(old, 'docs/devteam/project/settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"forge": "git"', `"forge": "git", ${Object.entries(settings).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')}`));
    g(['add', '-A'], old); g(['commit', '-qm', 'settings'], old); g(['push', '-q', 'origin', 'main'], old);
  }
  const sup = (args) => ok(old, args, SUP);
  let prio = 0;
  const P = {
    F, sup,
    gappy: (title) => first(sup(['goal', 'add', '--title', title])),
    ready: (title) => {
      const G = first(sup(['goal', 'add', '--title', title, '--outcome', `${title} holds`, '--measure', 'the owner says it holds', '--target', '1', '--unit', 'attested', '--direction', 'up', '--source', 'owner', '--question', `Does ${title} hold?`, '--non-goals', 'none', '--preconditions', 'first part', 'second part', '--priority', String(++prio)]));
      sup(['goal', 'set', G, '--milestones', JSON.stringify([{ title: 'all of it', target: 1, preconditions: [1, 2], tickets: 2 }])]);
      ok(old, ['goal', 'decide', G, 'approve', '--force']);
      return G;
    },
    feature: (slug, G) => sup(['feature', 'add', slug, '--json', JSON.stringify({ title: `Feature ${slug}`, goals: [G], preconditions: [`${G}#1`, `${G}#2`], stories: [{ id: `${slug.toUpperCase()}-S1`, text: 'it works', release: 'v1.0.0' }] })]),
    ticket: (id, feature) => sup(['ticket', 'add', id, '--json', JSON.stringify({ title: `Ticket ${id}`, feature, component: 'ch', kind: 'build', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: [`${id}/**`], done_when: ['its check passes in CI'] })]),
    phase: (id, to) => ok(old, ['phase', to], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id }),
    wait: (minutes) => { const t = Date.now(); const out = sup(['wait', '--minutes', String(minutes)]); return { out, ms: Date.now() - t }; },
    digests: () => json(ok(old, ['questions', '--all', '--json'])).filter((q) => q.class === 'stuck-work'),
    hello: () => json(ok(old, ['hello', '--json', '--no-kit'])),
  };
  projects.push(P);
  return P;
}

test('wait: a standing high finding does not short-circuit the next wait; a new one does', async (t) => {
  // owed at once: an undefined goal's ask-definition is a high move-owed finding. Standing ones wake
  // again after 21.6 s: room for the next two waits on a loaded runner (about 6 s here)
  const P = project('standing', { next_move_owed_minutes: 0, standing_high_hours: 0.006 });
  const A = P.gappy('First gap');
  await t.test('the first wait returns at once on it', () => {
    const { out } = P.wait(1);
    assert.match(out, /^high findings are open/m);
    assert.ok(out.includes(`move-owed goal:${A} ask-definition:`), out);
  });
  await t.test('the second, with it still open, waits out its tick', () => {
    const { out, ms } = P.wait(0.05);
    assert.match(out, /^nothing new in 0\.05 min: the tick is due/m, out);
    assert.ok(ms >= 2500, `it waited (${ms} ms)`);
  });
  await t.test('a new high finding returns at once, naming only the new one', () => {
    const B = P.gappy('Second gap');
    const { out, ms } = P.wait(1);
    assert.match(out, /^high findings are open/m);
    assert.ok(out.includes(`move-owed goal:${B} ask-definition:`), out);
    assert.ok(!out.includes(`goal:${A} ask-definition:`), `the standing one is not said again: ${out}`);
    assert.ok(ms < 50000, `at once (${ms} ms)`);
  });
  await t.test('past standing_high_hours a standing one comes back, said as standing', () => {
    sleep(20000);
    const { out } = P.wait(1);
    assert.match(out, /^high findings are open/m);
    assert.match(out, new RegExp(`move-owed goal:${A} ask-definition:.*an earlier wait saw it too`), out);
  });
});

test('the stuck-work digest: asked once a move is stuck past twice the stall hours, kept to the list, withdrawn when it empties', async (t) => {
  // stalled after nine seconds, so in the digest after eighteen
  const P = project('digest', { next_move_stall_hours: 0.0025 });
  const G = P.ready('Building');
  P.feature('building', G);
  P.ticket('ch-21-build', 'building');
  P.ticket('ch-22-build', 'building');
  P.phase('ch-21-build', 'build');
  sleep(10000);
  P.phase('ch-22-build', 'build');
  await t.test('nothing while no move is past twice the stall hours', () => {
    P.sup(['metrics', '--json']);
    assert.deepEqual(P.digests(), []);
  });
  let q1;
  await t.test('the operator\'s metrics run never writes it', () => {
    sleep(9000);
    P.F.ok(P.F.old, ['metrics', '--json'], { DEVTEAM_ROLE: 'operator' });
    assert.deepEqual(P.digests(), []);
  });
  await t.test("a supervisor's metrics run asks it, an owner-action naming the item, holder and age", () => {
    P.sup(['metrics', '--json']);
    const ds = P.digests();
    assert.equal(ds.length, 1, JSON.stringify(ds));
    [q1] = ds;
    assert.equal(q1.status, 'open');
    assert.equal(q1.kind, 'owner-action');
    assert.match(q1.question, /^Stuck work in .+: 1 item waiting more than 0\.005 h$/);
    assert.match(q1.context, /ticket:ch-21-build; held by the worker, unchanged for \d+ min/);
    assert.ok(!q1.context.includes('ch-22-build'), q1.context);
    assert.equal(q1.default, null);
    assert.deepEqual(q1.blocks, []);
    assert.match(P.hello().alert ?? '', new RegExp(`Stuck work in .+: 1 item .*${q1.id}`), 'on the hub\'s alert');
  });
  await t.test('the same list again changes nothing', () => {
    P.sup(['metrics', '--json']);
    assert.deepEqual(P.digests().map((q) => [q.id, q.status]), [[q1.id, 'open']]);
  });
  await t.test('the supervisor can neither withdraw it nor ask one', () => {
    assert.match(P.F.run(P.F.old, ['withdraw', q1.id], SUP).err, /the kit's stuck-work digest/);
    assert.match(P.F.run(P.F.old, ['ask', '--kind', 'owner-action', '--class', 'stuck-work', '--question', 'Anything stuck?'], SUP).err, /the kit's own question/);
  });
  let q2;
  await t.test('a second item stuck: the first withdrawn, the list asked again with both', () => {
    sleep(10000);
    P.sup(['metrics', '--json']);
    const ds = P.digests();
    assert.equal(ds.find((q) => q.id === q1.id)?.status, 'withdrawn');
    const open = ds.filter((q) => q.status === 'open');
    assert.equal(open.length, 1, JSON.stringify(ds));
    [q2] = open;
    assert.match(q2.question, /: 2 items waiting more than/);
    assert.ok(q2.context.includes('ticket:ch-21-build') && q2.context.includes('ticket:ch-22-build'), q2.context);
  });
  await t.test('both moved on: withdrawn, and off the hub\'s alert', () => {
    P.phase('ch-21-build', 'verify');
    P.phase('ch-22-build', 'verify');
    P.sup(['metrics', '--json']);
    const ds = P.digests();
    assert.equal(ds.find((q) => q.id === q2.id)?.status, 'withdrawn');
    assert.deepEqual(ds.filter((q) => q.status === 'open'), []);
    assert.doesNotMatch(P.hello().alert ?? '', /Stuck work/);
  });
});
