// The goal order in one step (planning.md §1, priority is the owner's): the owner's goal order, one
// goal-change question that proposes a whole order and the supervisor's goal order --approved that
// applies exactly it, the fold that holds a supervisor's order line to that answer, the channels
// that may post an order, and the one-goal goal-change path left as it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fleetFixture, json, line, PORTS, bareProject, dashboardOnFreePort, until, kit } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };

// Goals with priorities 1..n, the last two approved (ready); the rest are drafts.
function goals(F, titles) {
  const { old, ok } = F;
  const ids = titles.map((t, i) => ok(old, ['goal', 'add', '--title', t, '--outcome', `${t} holds`, '--measure', 'gaps', '--target', '0', '--unit', 'gaps', '--direction', 'down', '--source', 'repo', '--check', 'echo 3', '--non-goals', 'none', '--preconditions', 'a', '--priority', String(i + 1)], SUP).split('\n')[0].trim());
  for (const id of ids.slice(-2)) ok(old, ['goal', 'decide', id, 'approve', '--force']);
  return ids;
}
const prio = (F, id) => json(F.ok(F.old, ['goal', 'show', id, '--json'])).priority;
const prios = (F, ids) => ids.map((id) => prio(F, id));
// every line of the log, from its live files
const lines = (F) => {
  const dir = path.join(F.old, 'docs/devteam/run/log');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).sort((a, b) => a.at.localeCompare(b.at));
};
const supLog = (F) => path.join(F.old, 'docs/devteam/run/log', `supervisor-${new Date().toISOString().slice(0, 7)}.jsonl`);
const firstId = (s) => s.split('\n')[0].trim();

test('the owner orders goals in one step: 1..n on the named ones, the rest after in their own order', () => {
  const F = fleetFixture('goal-order-owner');
  const { old, ok, run } = F;
  try {
    const [A, B, C, D] = goals(F, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
    const M = goals(F, ['Met one'])[0];
    ok(old, ['goal', 'status', M, 'met', '--force']);
    const L = goals(F, ['Let go one'])[0];
    ok(old, ['goal', 'decide', L, 'let-go']);
    const before = lines(F).length;
    const callsBefore = json(ok(old, ['dashboard-data'])).ooda.learning_totals.calls;

    const out = ok(old, ['goal', 'order', C, A]);
    assert.match(out, new RegExp(`1 ${C}.*\\n.*2 ${A}`, 's'), 'it prints the new order');
    assert.deepEqual(prios(F, [C, A, B, D]), [1, 2, 3, 4], 'named first, the rest after in their own order');
    const added = lines(F).slice(before);
    const goalLines = added.filter((l) => l.type === 'goal');
    // one line per named goal (C, A) and one for B, which moved from 2 to 3; D stays 4 and gets none
    assert.deepEqual(goalLines.map((l) => [l.id, l.priority]), [[C, 1], [A, 2], [B, 3]]);
    assert.ok(goalLines.every((l) => l.by === 'owner' && Object.keys(l).every((k) => ['v', 'id', 'type', 'op', 'at', 'by', 'channel', 'priority'].includes(k))), 'priority and nothing else');
    const acts = added.filter((l) => l.type === 'act');
    assert.equal(acts.length, 1, 'one act');
    assert.equal(acts[0].class, 'goal-order', "the owner's own record class");
    assert.equal(acts[0].by, 'owner');
    assert.deepEqual(acts[0].refs, [C, A, B]);
    assert.equal(added.length, 4, 'nothing else written');

    // the owner's goal-order act is a record, never a call: not in the act feed, the calls, trust,
    // nor correctable; and only the owner writes that class
    const X = acts[0].id;
    const d = json(ok(old, ['dashboard-data']));
    assert.equal(d.ooda.learning_totals.calls, callsBefore, 'the calls total leaves it out');
    assert.ok(!d.ooda.acts.some((a) => a.id === X), 'not in the act feed');
    assert.ok(!d.ooda.decisions.some((r) => r.id === X || (r.refs ?? []).includes(X) || (r.acts ?? []).includes(X)), 'nor among the calls');
    assert.ok(!JSON.stringify(json(ok(old, ['trust', '--json']))).includes(X), 'nor in trust');
    assert.match(run(old, ['correct', X, '--reason', 'no']).err, new RegExp(`${X} is the owner's own record \\(goal-order\\), not a call`));
    const supAct = run(old, ['act', '--class', 'goal-order', '--what', 'put the goals in order', '--refs', A], SUP);
    assert.notEqual(supAct.status, 0);
    assert.match(supAct.err, /goal-order is the owner's/);
    const wat = new Date(Date.now() + 500).toISOString();
    const wid = `a-${wat.slice(0, 10).replace(/-/g, '')}-${wat.slice(11, 23).replace(/[:.]/g, '')}-kit-1`;
    const wfile = path.join(old, 'docs/devteam/run/log', 'kit-1.jsonl');
    fs.writeFileSync(wfile, line({ id: wid, type: 'act', op: 'new', at: wat, by: 'kit-1', class: 'goal-order', what: 'put the goals in order', refs: [A] }));
    // a worker writes no act at all, so not this one either
    const wc = run(old, ['log-check']);
    assert.equal(wc.status, 1, "a worker's goal-order act fails log-check");
    assert.match(wc.out + wc.err, /ticket may not create act lines|goal-order is the owner's/);
    fs.rmSync(wfile);

    // a met or let-go goal named is refused with its status, and nothing is written
    const n = lines(F).length;
    const met = run(old, ['goal', 'order', A, M]);
    assert.equal(met.status, 1);
    assert.match(met.err, new RegExp(`${M} is met`));
    const gone = run(old, ['goal', 'order', L, A]);
    assert.equal(gone.status, 1);
    assert.match(gone.err, new RegExp(`${L} is let go`));
    assert.match(run(old, ['goal', 'order', A, A]).err, /more than once/);
    assert.match(run(old, ['goal', 'order', A, 'g-20990101-000000000-nobody']).err, /no goal g-20990101-000000000-nobody/);
    assert.match(run(old, ['goal', 'order']).err, /usage: goal order/);
    assert.equal(lines(F).length, n, 'a refused order writes nothing');
    assert.deepEqual(prios(F, [C, A, B, D]), [1, 2, 3, 4]);

    // naming every live goal leaves none to move after them
    ok(old, ['goal', 'order', D, C, B, A]);
    assert.deepEqual(prios(F, [D, C, B, A]), [1, 2, 3, 4]);

    // the supervisor never orders goals on its own word
    const sup = run(old, ['goal', 'order', A, B], SUP);
    assert.equal(sup.status, 1);
    assert.match(sup.err, /goal-change --order/);
    assert.deepEqual(prios(F, [D, C, B, A]), [1, 2, 3, 4]);
  } finally { F.done(); }
});

test('the goals left out: ties keep the order they were made in, a goal with no priority keeps none, Upkeep has no place', () => {
  const F = fleetFixture('goal-order-rest');
  const { old, ok, run } = F;
  try {
    const mk = (title, p) => firstId(ok(old, ['goal', 'add', '--title', title, ...(p ? ['--priority', String(p)] : [])], SUP));
    const A = mk('Alpha', 1);
    const T1 = mk('Tie first', 2);
    const T2 = mk('Tie second', 2);
    const N = mk('No priority');
    const Z = mk('Zulu', 3);
    ok(old, ['goal', 'order', Z, A]);
    assert.deepEqual(prios(F, [Z, A, T1, T2]), [1, 2, 3, 4], 'the tie by when each was made');
    assert.equal(prio(F, N), undefined, 'a goal with no priority is given none');
    ok(old, ['goal', 'hold', 'upkeep', 'drain', '--owner']);
    const U = json(ok(old, ['goal', 'show', 'upkeep'])).id;
    assert.match(U, /^g-/);
    const r = run(old, ['goal', 'order', U, A]);
    assert.equal(r.status, 1);
    assert.match(r.err, /Upkeep has no place in the goal order/);
  } finally { F.done(); }
});

test('one goal-change question proposes a whole order, and goal order --approved applies exactly it', () => {
  const F = fleetFixture('goal-order-question');
  const { old, ok, run } = F;
  try {
    const [A, B, C, D] = goals(F, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
    const M = goals(F, ['Met one'])[0];
    ok(old, ['goal', 'status', M, 'met', '--force']);
    const ask = (order, more = []) => run(old, ['ask', '--class', 'goal-change', '--question', 'Put the goals in this order?', '--context', 'You said Delta first.', '--order', JSON.stringify(order), '--recommendation', 'Yes, this order', '--stake', '2', '--urgency', '1', ...more], SUP);
    // a question asked again after the owner's answer says what changed (the kit refuses a repeat otherwise)
    let n = 0;
    const asked = (order) => { const r = ask(order, n++ ? ['--new-because', `the owner asked for another order (${n})`] : []); assert.equal(r.status, 0, r.err); assert.doesNotMatch(r.err, /names no --goal|names a kit id/, 'no warning for the order the kit wrote'); return firstId(r.out); };

    // the question: one, with its order, about no one goal
    const Q = asked([D, C, A]);
    const qv = json(ok(old, ['questions', '--id', Q, '--json']))[0];
    assert.deepEqual(qv.order, [D, C, A]);
    assert.equal(qv.goal, null);
    assert.equal(qv.class, 'goal-change');
    assert.equal(qv.change, null, "no 'Approving sets on <goal>' card for a question about no goal");
    assert.match(qv.context, new RegExp(`The order proposed:\\n1\\. Delta \\(${D}\\)\\n2\\. Charlie \\(${C}\\)\\n3\\. Alpha \\(${A}\\)\\nGoals left out keep their order after these\\.`), 'the order in words, in what the owner reads and the hash covers');
    assert.match(qv.context, /^You said Delta first\./, "the supervisor's own context first");
    assert.match(ask([D, C], ['--goal', D]).err, /--order .*no --goal/);
    assert.match(ask([D, C], ['--change', '{"priority":1}']).err, /--order .*no --change|--change belongs/);
    assert.match(run(old, ['ask', '--class', 'goal-definition', '--question', 'Order?', '--order', JSON.stringify([D, C]), '--recommendation', 'Yes', '--stake', '1', '--urgency', '1'], SUP).err, /--order belongs on a goal-change question/);
    assert.match(ask([D]).err, /at least two goals/);
    assert.match(ask([D, M]).err, new RegExp(`${M} is met`));
    assert.match(ask([D, D]).err, /more than once/);

    // not answered yet, then answered with something other than the recommendation: refused
    assert.match(run(old, ['goal', 'order', '--approved', Q], SUP).err, /not answered by the owner/);
    ok(old, ['answer', Q, 'No, Alpha first']);
    const no = run(old, ['goal', 'order', '--approved', Q], SUP);
    assert.equal(no.status, 1);
    assert.match(no.err, /not its recommendation/);
    assert.deepEqual(prios(F, [A, B, C, D]), [1, 2, 3, 4], 'nothing applied');

    // answered with its recommendation: exactly that order, the rest after
    const Q2 = asked([D, C, A]);
    ok(old, ['answer', Q2, 'Yes, this order']);
    // an order other than the one proposed is refused; none given, or the same, applies it
    assert.match(run(old, ['goal', 'order', C, D, A, '--approved', Q2], SUP).err, /not the order .* proposed/);
    assert.match(run(old, ['goal', 'order', D, C, '--approved', Q2], SUP).err, /not the order .* proposed/);
    const before = lines(F).length;
    ok(old, ['goal', 'order', D, C, A, '--approved', Q2], SUP);
    assert.deepEqual(prios(F, [D, C, A, B]), [1, 2, 3, 4]);
    // a goal added later, at the top, doesn't undo the applied order on a later read
    const E = firstId(ok(old, ['goal', 'add', '--title', 'Echo', '--priority', '1'], SUP));
    assert.deepEqual(prios(F, [D, C, A, B]), [1, 2, 3, 4], 'the order stays as applied');
    assert.equal(prio(F, E), 1);
    const added = lines(F).slice(before).filter((l) => l.id !== E);
    assert.deepEqual(added.filter((l) => l.type === 'goal').map((l) => [l.id, l.priority, l.approved]), [[D, 1, Q2], [C, 2, Q2], [A, 3, Q2], [B, 4, Q2]]);
    const acts = added.filter((l) => l.type === 'act');
    assert.equal(acts.length, 1);
    assert.equal(acts[0].class, 'goal-change');
    assert.equal(acts[0].approved_by, Q2);
    // a second use of the same answer is refused
    assert.match(run(old, ['goal', 'order', '--approved', Q2], SUP).err, new RegExp(`${Q2} already authorised`));
    assert.match(run(old, ['goal', 'set', D, '--approved', Q2], SUP).err, /about no goal|not D|is about/, "goal set doesn't take an order's answer");

    // the fold holds a supervisor's line to the answer: a wrong priority, another field, a second
    // set of the same goal, or a goal the order doesn't name at a place inside it, counts for nothing
    // the owner's own order first, then an order they approve: it applies (the owner's answer, the owner's rank)
    ok(old, ['goal', 'order', A, B, C, D]);
    const QR = asked([C, D]);
    ok(old, ['answer', QR, 'Yes, this order']);
    ok(old, ['goal', 'order', '--approved', QR], SUP);
    assert.deepEqual(prios(F, [C, D, A, B]), [1, 2, 3, 4], 'an approved order moves goals the owner ordered before');

    const Q3 = asked([B, A]);
    ok(old, ['answer', Q3, 'Yes, this order']);
    const at = new Date(Date.now() + 1000).toISOString();
    fs.appendFileSync(supLog(F), [
      line({ id: B, type: 'goal', op: 'set', at, by: 'supervisor', priority: 7, approved: Q3 }),
      line({ id: A, type: 'goal', op: 'set', at, by: 'supervisor', priority: 2, title: 'Renamed', approved: Q3 }),
      line({ id: D, type: 'goal', op: 'set', at, by: 'supervisor', priority: 9, approved: Q3 }),
    ].join(''));
    assert.deepEqual(prios(F, [C, D, A, B]), [1, 2, 3, 4], 'none of the hand-written lines count: D, left out, belongs at 4');
    assert.equal(json(ok(old, ['goal', 'show', A, '--json'])).title, 'Alpha');
    const at2 = new Date(Date.now() + 2000).toISOString();
    fs.appendFileSync(supLog(F), [
      line({ id: B, type: 'goal', op: 'set', at: at2, by: 'supervisor', priority: 1, approved: Q3 }),
      line({ id: B, type: 'goal', op: 'set', at: at2, by: 'supervisor', priority: 2, approved: Q3 }),
    ].join(''));
    assert.equal(prio(F, B), 1, 'the first set under the answer counts, a second of the same goal does not');

    // the schema: change.order is unique goal ids, two or more; a line otherwise fails log-check
    const at3 = new Date(Date.now() + 3000).toISOString();
    const qline = (id, order) => line({ id, type: 'question', op: 'new', at: at3, by: 'supervisor', kind: 'owner-decision', class: 'goal-change', question: 'Order?', recommendation: 'Yes', change: { order } });
    const clean = fs.readFileSync(supLog(F), 'utf8');
    for (const bad of [[A, A], 'not a list', [A], [1, 2]]) {
      fs.writeFileSync(supLog(F), clean + qline(`q-20991231-000000000-supervisor`, bad));
      assert.equal(run(old, ['log-check']).status, 1, `order ${JSON.stringify(bad)} fails log-check`);
    }
    fs.writeFileSync(supLog(F), clean);
    assert.equal(run(old, ['log-check']).status, 0, run(old, ['log-check']).out);
    // an older reader: a schema without the field sets it aside and still passes the log
    const sf = path.join(old, 'docs/devteam/schema/log.schema.json');
    const schema = JSON.parse(fs.readFileSync(sf, 'utf8'));
    delete schema.$defs.types.question.properties.change.properties; // main's: change is any object
    fs.writeFileSync(sf, JSON.stringify(schema, null, 2));
    const older = run(old, ['log-check']);
    assert.equal(older.status, 0, older.err || older.out);
    assert.doesNotMatch(older.out, /^fail:/m);
    assert.equal(json(ok(old, ['questions', '--id', Q3, '--json']))[0].status, 'answered', 'the answered order question still reads as answered');
  } finally { F.done(); }
});

test("today's one-goal goal-change path is unchanged", () => {
  const F = fleetFixture('goal-order-one');
  const { old, ok, run } = F;
  try {
    const [, , C, D] = goals(F, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
    const Q = firstId(ok(old, ['ask', '--class', 'goal-change', '--goal', D, '--change', '{"priority":9}', '--question', 'Move Delta to 9?', '--recommendation', 'Yes', '--stake', '1', '--urgency', '1'], SUP));
    assert.equal(json(ok(old, ['questions', '--id', Q, '--json']))[0].order, null);
    assert.match(run(old, ['goal', 'set', D, '--approved', Q], SUP).err, /is not answered by the owner/);
    ok(old, ['answer', Q, 'Yes']);
    assert.match(run(old, ['goal', 'set', C, '--approved', Q], SUP).err, new RegExp(`${Q} is about ${D}, not ${C}`));
    assert.match(run(old, ['goal', 'order', '--approved', Q], SUP).err, /proposes no order/, 'an order applies only an order question');
    ok(old, ['goal', 'set', D, '--approved', Q], SUP);
    assert.equal(prio(F, D), 9);
    assert.match(run(old, ['goal', 'set', D, '--approved', Q], SUP).err, /already authorised a change/);
    assert.match(run(old, ['goal', 'set', D, '--priority', '3'], SUP).err, /only the owner changes it now/);
  } finally { F.done(); }
});

test('the dashboard posts a goal order as the owner; the hub does not take one', { timeout: 240000 }, async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-goal-order-dash-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const hub = PORTS + 0;
  const env = { ...process.env, DEVTEAM_HUB_PORT: String(hub), DEVTEAM_PORT_BASE: String(PORTS + 1), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  const root = bareProject(base, 'goal-order');
  const dt = (args, role = {}) => spawnSync(process.execPath, [path.join(root, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: root, env: { ...env, ...role }, encoding: 'utf8' });
  const mk = (title, p) => { const r = dt(['goal', 'add', '--title', title, '--priority', String(p)], SUP); assert.equal(r.status, 0, r.stderr); return firstId(r.stdout); };
  const [A, B] = [mk('Alpha', 1), mk('Bravo', 2)];
  const { dash, port } = await dashboardOnFreePort(root, env);
  t.after(() => dash.stop());
  const post = (p, url, body) => fetch(`http://127.0.0.1:${p}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${p}`, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });

  const r = await post(port, '/api/goal-order', { ids: [B, A] });
  assert.equal(r.status, 200, await r.clone().text());
  const show = (id) => JSON.parse(dt(['goal', 'show', id, '--json']).stdout).priority;
  assert.deepEqual([show(B), show(A)], [1, 2]);
  const logDir = path.join(root, 'docs/devteam/run/log');
  const owned = fs.readdirSync(logDir).flatMap((f) => fs.readFileSync(path.join(logDir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))).filter((l) => l.type === 'goal' && l.priority !== undefined && l.by === 'owner');
  assert.ok(owned.length >= 2 && owned.every((l) => l.channel === 'dashboard'), 'the owner, on the dashboard channel');
  for (const bad of [{ ids: 'x' }, { ids: [] }, { ids: ['not an id'] }, { ids: Array.from({ length: 51 }, () => A) }, {}]) assert.equal((await post(port, '/api/goal-order', bad)).status, 400, JSON.stringify(bad).slice(0, 60));

  // the hub's owner actions are the operator's threads only
  await until(async () => { try { return (await fetch(`http://127.0.0.1:${hub}/instances.json`)).ok; } catch { return false; } }, 'the hub');
  const h = await post(hub, '/operator/goal-order', { ids: [A, B] });
  assert.ok(h.status >= 400, `the hub refuses it (${h.status})`);
  assert.deepEqual([show(B), show(A)], [1, 2], 'nothing applied through the hub');
});

test("supervisor.md's goal-change row asks one --order question to reorder several goals", () => {
  const md = fs.readFileSync(path.join(kit, 'process', 'supervisor.md'), 'utf8');
  const row = md.split('\n').find((l) => l.startsWith('| `owner-decision`, `--class goal-change`'));
  assert.ok(row, 'the goal-change row');
  assert.match(row, /--order/);
  assert.match(row, /goal order --approved/);
  assert.match(row, /carries no `--goal`/);
  assert.match(row, /Never one question per goal/);
});
