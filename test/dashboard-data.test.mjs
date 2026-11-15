// Dashboard data derived on read and stored nowhere (kit-84): plain names for every kind of decision,
// and the rest of what the overhaul's pages draw from. Each test builds its own fixture, drives the
// CLI, and checks that its reads wrote nothing to the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { threadsFixture, fleetFixture, line, write, json, dashboardOnFreePort, PORTS, kit } from './lib/kit.mjs';

// `/api/data` serves exactly this
const data = (F) => json(F.ok(F.old, ['dashboard-data']));
// every log file's bytes, to compare before and after a read
const logBytes = (F) => {
  const dir = path.join(F.old, 'docs/devteam/run/log');
  return new Map(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => [f, fs.readFileSync(path.join(dir, f)).toString('base64')]));
};
// kit.mjs's threadsFixture stamp, which it doesn't export
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
const PREFIX = { act: 'a', phase: 'h', message: 'm', decision: 'd', observation: 'o' };
const used = new Set();
// One log line written by hand, agoMs ago, in F.hand's format, with an id of its own: a line written
// later never sorts earlier, and no two lines share a millisecond.
const handLine = (F, by, o, agoMs, file) => {
  let at = Math.floor(Date.now() - agoMs);
  while (used.has(at)) at += 1;
  used.add(at);
  const d = new Date(at);
  const id = `${PREFIX[o.type]}-${stamp(d)}-${by}`;
  fs.mkdirSync(F.logDir, { recursive: true });
  fs.appendFileSync(path.join(F.logDir, file ?? `${by}-${d.toISOString().slice(0, 7)}.jsonl`), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
  return id;
};
// a time inside the UTC day d days back from today, never in the future
const dayAt = (d) => {
  const day0 = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return d >= 1 ? day0 - d * 86400000 + 30 * 60000 : day0 + Math.floor((Date.now() - day0) / 2);
};

// The known classes: the constitution's, every one the kit writes itself, and kit-85's two.
const NOT_CLASSES = new Set([
  'let-go', // a goal hold, on a merge's class line
  'owner-decision', // a question kind
  'owner-only', // a reason
  'goal-definition', // a question kind
  'chore-registry', // a ref
]);
const knownClasses = () => {
  const block = JSON.parse(fs.readFileSync(path.join(kit, 'governance/constitution.md'), 'utf8').match(/```json devteam\s*\n([\s\S]*?)\n```/)[1]);
  const set = new Set([...Object.keys(block.classes), ...block.constitutional, ...block.owner_only]);
  for (const l of fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8').split('\n')) {
    if (/\bclass: |\bconst cls = |OWNER_ACTS = /.test(l)) for (const m of l.matchAll(/'([a-z][a-z0-9]*(?:-[a-z0-9]+)+)'/g)) set.add(m[1]);
  }
  for (const c of ['fleet-drain', 'fleet-park', 'fleet-undrain', 'fleet-unpark', 'owner-setting', 'settings-edit']) set.add(c);
  for (const c of NOT_CLASSES) set.delete(c);
  return set;
};
const missingNames = (set, words) => [...set].filter((c) => !words?.[c]);
const firstId = (s) => s.split('\n')[0].trim();

test('every kind of decision has a plain name, and no class id shows', { timeout: 300000 }, async (t) => {
  const undo = [];
  t.after(async () => { let err = null; for (const f of undo.reverse()) { try { await f(); } catch (e) { err ??= e; } } if (err) throw err; });
  const F = threadsFixture('class-words');
  undo.push(() => F.done());
  F.sup(['decide', '--class', 'rename-column', '--', 'renamed a column']);
  F.sup(['decide', '--class', 'Rollback2', '--', 'rolled back']);
  F.sup(['decide', '--class', 'Add-Ticket', '--', 'added y']);
  F.sup(['ask', '--class', 'goal-change', '--goal', F.goal, '--change', JSON.stringify({ title: 'Launch the checkout' }), '--question', 'Rename the checkout goal?', '--recommendation', 'Yes', '--stake', '1', '--urgency', '1']);
  F.sup(['act', '--class', 'add-ticket', '--refs', 'x', '--', 'added x']);
  // a rung change: the owner moves new-feature to rung 3
  const q = firstId(F.sup(['ask', '--class', 'new-feature', '--question', 'Start x?', '--recommendation', 'yes']));
  F.owner(['answer', q, 'yes', '--autonomy', '3']);
  // a rule row, which has no class
  F.owner(['knowledge', 'add', '--kind', 'fact', '--statement', 'x builds with make', '--scope', 'project', '--owner']);

  const set = knownClasses();
  const before = logBytes(F);
  const d = data(F);
  for (const c of set) assert.ok(d.class_words?.[c], `no plain name for ${c}`);

  // the display rule: a name is never a known class id, nor holds one as a whole word
  const noId = (name) => [...set].every((id) => name.toLowerCase() !== id.toLowerCase() && !new RegExp(`(^|[^a-z0-9-])${id}($|[^a-z0-9-])`, 'i').test(name));
  for (const [c, name] of Object.entries(d.class_words)) assert.ok(noId(name), `${c}'s name shows a class id: ${name}`);
  const known = (r) => r.class && set.has(r.class);
  const rows = [
    ...Object.entries(d.ooda.classes).map(([c, v]) => ({ where: 'ooda.classes', class: c, class_name: v.class_name })),
    ...['trust', 'decisions', 'acts', 'answered'].flatMap((k) => d.ooda[k].map((r) => ({ where: `ooda.${k}`, ...r }))),
    ...d.questions.map((r) => ({ where: 'questions', ...r })),
  ];
  for (const r of rows) {
    assert.ok('class_name' in r, `${r.where} ${r.id ?? r.class} has no class_name`);
    if (r.class == null) assert.equal(r.class_name, null, `${r.where} ${r.id}: no class, no name`);
    if (known(r) && r.class_name !== null) assert.ok(noId(r.class_name), `${r.where} ${r.class}: ${r.class_name}`);
  }
  for (const k of ['trust', 'decisions', 'acts', 'answered']) assert.ok(d.ooda[k].some(known), `ooda.${k} has a row of a known class to check`);
  assert.ok(d.questions.some(known), 'questions has a row of a known class to check');
  const rungs = d.ooda.learning_marks.filter((m) => m.kind === 'rung');
  for (const m of rungs) assert.ok(noId(m.label), `a rung mark shows a class id: ${m.label}`);
  assert.ok(rungs.some((m) => m.label === `${d.class_words['new-feature']} to decides and tells you`), `a rung mark for new-feature in words: ${JSON.stringify(rungs)}`);

  // a class the supervisor made up shows as unnamed, in its own words
  const made = (c) => d.ooda.decisions.find((r) => r.class === c);
  assert.equal(made('rename-column')?.class_name, 'Unnamed kind (rename column)');
  assert.equal(made('Rollback2')?.class_name, 'Unnamed kind (rollback2)');
  // a known id in another case reads as the known class, never as its own words (T1-1)
  assert.equal(made('Add-Ticket')?.class_name, d.class_words['add-ticket']);
  const rule = d.ooda.decisions.find((r) => r.kind === 'rule');
  assert.ok(rule, 'a rule row');
  assert.equal(rule.class_name, null);

  // the self-test: a class whose name is taken out is caught
  const copy = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  const text = fs.readFileSync(copy, 'utf8');
  undo.push(() => fs.writeFileSync(copy, text));
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('const CLASS_WORDS = '));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('});'));
  const at = lines.findIndex((l, i) => i > start && i < end && /^\s*'goal-order': /.test(l));
  assert.ok(start >= 0 && at > start, "a 'goal-order': line in CLASS_WORDS");
  fs.writeFileSync(copy, lines.filter((_, i) => i !== at).join('\n'));
  assert.deepEqual(missingNames(set, data(F).class_words), ['goal-order']);
  fs.writeFileSync(copy, text);

  assert.deepEqual(logBytes(F), before, 'the reads wrote nothing to the log');
});

test('each blocked item names the question holding it', { timeout: 300000 }, async (t) => {
  const undo = [];
  t.after(async () => { let err = null; for (const f of undo.reverse()) { try { await f(); } catch (e) { err ??= e; } } if (err) throw err; });
  const F = threadsFixture('held-by');
  undo.push(() => F.done());
  const tk = (id, feature, story) => F.sup(['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature, component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: [story], depends_on: [], touches: ['src/**'], done_when: ['the src test passes in CI'] })]);
  F.sup(['feature', 'add', 'hb-work', '--json', JSON.stringify({ title: 'HB', goals: [F.goal], stories: [{ id: 'HB-S1', text: 'x', release: 'v1.0.0' }] })]);
  for (const id of ['app-01-a', 'app-02-b', 'app-03-c', 'app-04-d']) tk(id, 'hb-work', 'HB-S1');
  // a ticket on a second goal, to park (P1-4)
  const g2 = F.sup(['goal', 'add', '--title', 'Other', '--outcome', 'admins pay alone', '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', '3']);
  F.sup(['feature', 'add', 'hb-other', '--json', JSON.stringify({ title: 'HB other', goals: [g2], stories: [{ id: 'HB-S2', text: 'y', release: 'v1.0.0' }] })]);
  tk('app-05-e', 'hb-other', 'HB-S2');

  const qa = firstId(F.sup(['ask', '--blocks', 'app-01-a', '--question', 'Which tax table for a?', '--recommendation', 'the new one', '--stake', '3', '--urgency', '3']));
  const qb = firstId(F.sup(['ask', '--ticket', 'app-02-b', '--question', 'Ship b before the billing page?', '--recommendation', 'yes', '--stake', '2', '--urgency', '2']));
  const qa2 = firstId(F.sup(['ask', '--blocks', 'app-01-a', '--question', 'Which currency does a show first?', '--recommendation', 'dollars', '--stake', '1', '--urgency', '1']));
  // a planner whose goal has an open question (P1-13): its branch isn't on main
  const { goal: g3, question: qg } = F.approval();
  const wt = path.join(F.base, 'plan-hb-plan');
  F.g(['worktree', 'add', '-q', '-b', 'plan/hb-plan', wt, 'main'], F.old);
  write(path.join(wt, 'docs/devteam/project/log/plan-hb-plan.jsonl'), `${JSON.stringify({ v: 1, id: 'hb-plan', type: 'feature', op: 'new', at: new Date().toISOString(), by: 'plan-hb-plan', title: 'HB plan', goals: [g3], stories: [] })}\n`);
  F.g(['add', '-A'], wt);
  F.g(['commit', '-qm', 'plan-hb-plan: feature'], wt);
  F.g(['worktree', 'remove', wt], F.old);

  // each read writes nothing to the log
  const read = (f) => { const before = logBytes(F); const r = f(); assert.deepEqual(logBytes(F), before, 'the read wrote nothing to the log'); return r; };
  const heldBy = (id) => read(() => data(F)).tickets.find((r) => r.id === id)?.held_by;
  const findings = () => read(() => json(F.ok(F.old, ['metrics', '--json']))).findings;
  const bwq = (subject) => findings().filter((f) => f.kind === 'blocked-without-question' && f.subject === subject);

  const d = read(() => data(F));
  const row = (id) => d.tickets.find((r) => r.id === id);
  assert.equal(row('app-01-a').held_by, qa, 'the first in Inbox order holds it');
  assert.equal(row('app-02-b').held_by, qb, 'held by the question asked for it');
  assert.equal(row('app-03-c').held_by, null, 'no question names it');
  for (const r of d.tickets) assert.ok('held_by' in r, `${r.id} has held_by`);
  const plan = d.planners.find((p) => p.feature === 'hb-plan');
  assert.ok(plan, `a planner row for hb-plan: ${JSON.stringify(d.planners)}`);
  assert.deepEqual(plan.goals, [g3]);
  assert.equal(plan.held_by, qg, 'the planner is held by its goal\'s open question');

  F.owner(['answer', qa, 'yes']);
  assert.equal(heldBy('app-01-a'), qa2, 'once the first is answered, the other holds it');
  F.sup(['withdraw', qa2, '--reason', 'test']);
  assert.equal(heldBy('app-01-a'), null, 'once both are closed, nothing holds it');

  // a ticket just blocked with no question: medium, with the hint
  handLine(F, 'app-03-c', { type: 'phase', to: 'blocked' }, 5 * 60000, 'app-03-c.jsonl');
  const [c] = bwq('app-03-c');
  assert.ok(c, 'blocked-without-question for app-03-c');
  assert.equal(c.severity, 'medium');
  assert.match(c.suggestion, /ask --blocks app-03-c/);
  assert.match(c.suggestion, /answer its blocked message/);
  // blocked over an hour: the existing high finding, and not this one
  handLine(F, 'app-04-d', { type: 'phase', to: 'blocked' }, 2 * 3600000, 'app-04-d.jsonl');
  let all = findings();
  assert.ok(all.some((f) => f.kind === 'blocked' && f.severity === 'high' && f.subject === 'app-04-d'), 'blocked (high) for app-04-d');
  assert.ok(!all.some((f) => f.kind === 'blocked-without-question' && f.subject === 'app-04-d'), 'no blocked-without-question past the hour');
  // a question that blocks it: no finding
  F.sup(['ask', '--blocks', 'app-03-c', '--question', 'May c drop the legacy export?', '--recommendation', 'drop it', '--stake', '2', '--urgency', '2']);
  assert.deepEqual(bwq('app-03-c'), [], 'a question names app-03-c');
  // a ticket blocked on a running goal, then parked with its goal (P2-3, P1-4)
  handLine(F, 'app-05-e', { type: 'phase', to: 'blocked' }, 5 * 60000, 'app-05-e.jsonl');
  assert.equal(bwq('app-05-e').length, 1, 'raised while its goal runs');
  F.owner(['goal', 'hold', g2, 'park', '--owner']);
  all = findings();
  assert.ok(!all.some((f) => ['blocked-without-question', 'blocked'].includes(f.kind) && f.subject === 'app-05-e'), 'parked with its goal, it waits by choice');
  // a question on a let-go goal holds nothing (spec, edge cases)
  F.owner(['goal', 'decide', g2, 'let-go', '--owner']);
  F.sup(['ask', '--blocks', 'app-05-e', '--question', 'Should e keep the old receipts?', '--recommendation', 'keep them', '--stake', '1', '--urgency', '2']);
  assert.equal(heldBy('app-05-e'), null, 'a question on a let-go goal holds nothing');

  // the planner: once its question is withdrawn (answer refuses a goal approval), a blocked message raises it
  F.sup(['withdraw', qg, '--reason', 'test']);
  assert.equal(read(() => data(F)).planners.find((p) => p.feature === 'hb-plan').held_by, null, 'the planner holds nothing');
  assert.deepEqual(bwq('plan-hb-plan'), [], 'not blocked yet');
  handLine(F, 'plan-hb-plan', { type: 'message', kind: 'blocked', to: 'supervisor', text: 'need a ruling' }, 60000);
  const [p] = bwq('plan-hb-plan');
  assert.ok(p, 'blocked-without-question for plan-hb-plan');
  assert.equal(p.severity, 'medium');
  assert.match(p.suggestion, new RegExp(`ask on its goal \\(ask --goal ${g3} `), 'a planner is asked about on its goal');
  assert.doesNotMatch(p.suggestion, /--blocks plan-/, 'ask refuses --blocks for a planner');
  assert.match(p.suggestion, /answer its blocked message/);
  // its goal parked: it waits by choice
  F.owner(['goal', 'hold', g3, 'park', '--owner']);
  assert.deepEqual(bwq('plan-hb-plan'), [], 'its goal parked, the planner waits by choice');
});

test('threads by state, in the hello and the data', { timeout: 300000 }, async (t) => {
  const undo = [];
  t.after(async () => { let err = null; for (const f of undo.reverse()) { try { await f(); } catch (e) { err ??= e; } } if (err) throw err; });
  const F = threadsFixture('thread-counts');
  undo.push(() => F.done());
  const open = (text) => firstId(F.owner(['thread', 'new', text]));
  // T1: the owner's turn, then the supervisor's reply: the owner's move
  const t1 = open('first question');
  F.sup(['thread', 'reply', t1, 'an answer']);
  // T2: the owner's turn only: it waits on the supervisor
  open('second question');
  // T3: replied, then proposed as ready
  const t3 = open('third question');
  F.sup(['thread', 'reply', t3, 'an answer']);
  F.sup(['thread', 'ready', t3, '--outcome', 'done']);
  // T4: resolved by the owner, so it counts nowhere
  const t4 = open('fourth question');
  F.owner(['thread', 'resolve', t4]);

  // T5: proposed as ready, then the owner spoke again: no longer ready, and it waits on the supervisor
  const t5 = open('fifth question');
  F.sup(['thread', 'reply', t5, 'an answer']);
  F.sup(['thread', 'ready', t5, '--outcome', 'done']);
  F.owner(['thread', 'say', t5, 'not yet']);

  const before = logBytes(F);
  const want = { you: 1, waiting: 2, ready: 1 };
  assert.deepEqual(json(F.ok(F.old, ['hello', '--json'])).threads, want);
  assert.deepEqual(data(F).threads, want);
  assert.deepEqual(logBytes(F), before, 'the reads wrote nothing to the log');
});

test("Upkeep's last 14 days, from a log with known answers", { timeout: 300000 }, async (t) => {
  const undo = [];
  t.after(async () => { let err = null; for (const f of undo.reverse()) { try { await f(); } catch (e) { err ??= e; } } if (err) throw err; });
  const F = threadsFixture('upkeep-days');
  undo.push(() => F.done());
  const act = (cls, refs, ago) => handLine(F, 'supervisor', { type: 'act', class: cls, what: `${cls} ${refs.join(' ')}`, refs, reversible: false }, ago);
  const chore = (slug, d) => act('merge-chore', [`chore-${slug}`], Date.now() - dayAt(d));
  // day 0: one dayAt, the lines 10 ms apart in write order, so their order never rests on the clock
  const b0 = dayAt(0);
  const t0 = Date.now();
  act('merge-chore', ['chore-tidy'], t0 - b0);
  act('merge-chore', ['chore-tidy'], t0 - b0 - 10);
  act('merge-chore', ['chore-docs'], t0 - b0 - 20);
  act('merge-chore', ['chore-log'], t0 - b0 - 30);
  chore('devteam-sync-v0.9.0', 2);
  chore('ci-fix-node24', 3);
  const retro = handLine(F, 'supervisor', { type: 'observation', source: 'supervisor', subject: 'project', kind: 'retro', detail: 'r' }, Date.now() - dayAt(5));
  chore('retro-2026-11-10', 5);
  F.sup(['ticket', 'add', 'ch-01-tidy-docs', '--json', JSON.stringify({ title: 'Tidy the docs', feature: 'chores', component: 'ch', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['docs/**'], done_when: ['the docs check passes in CI'], notes: 'n' })]);
  act('merge-word', ['ch-01-tidy-docs'], Date.now() - dayAt(6));
  // an act with no refs (an older line): skipped, never a throw
  act('merge-chore', [], Date.now() - dayAt(7));
  chore('old', 15);
  // the window's edges: the oldest day is in, the day before it is out (T4-1)
  chore('edge-in', 13);
  chore('edge-out', 14);

  const before = logBytes(F);
  const days = data(F).upkeep_days;
  assert.equal(days.length, 14);
  const now = new Date();
  assert.equal(days.at(-1).starts_at, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString());
  const day = (d) => days[13 - d];
  const items = (d) => day(d).items.map((i) => [i.kind, i.ref, i.words]);
  assert.deepEqual(items(0), [['chore', 'chore-tidy', 'Merged chore tidy'], ['chore', 'chore-docs', 'Merged chore docs']], 'the duplicate tidy and the log chore are absent');
  assert.deepEqual(items(2), [['kit-sync', 'chore-devteam-sync-v0.9.0', 'Kit synced to v0.9.0']]);
  assert.deepEqual(items(3), [['ci-fix', 'chore-ci-fix-node24', 'CI fix ci-fix-node24']]);
  days.forEach((x, i) => assert.equal(x.failed, i === 13 - 3, `day ${13 - i} failed`));
  assert.deepEqual(items(5), [['retro', retro, 'Retro']], 'the retro counts once');
  assert.deepEqual(items(6), [['chore', 'ch-01-tidy-docs', 'Merged Tidy the docs']]);
  assert.deepEqual(day(7).items, [], 'a quiet day');
  assert.ok(days.flatMap((x) => x.items).every((i) => i.ref !== 'chore-old'), 'the old line is out of range');
  assert.deepEqual(days[0].items.map((i) => [i.kind, i.ref, i.words]), [['chore', 'chore-edge-in', 'Merged chore edge-in']], 'the oldest day, day 13, is in');
  assert.ok(days.flatMap((x) => x.items).every((i) => i.ref !== 'chore-edge-out'), 'day 14 is out of range');
  for (const x of days) assert.deepEqual(x.items.map((i) => i.at), x.items.map((i) => i.at).sort(), 'each day in at order');
  assert.deepEqual(logBytes(F), before, 'the reads wrote nothing to the log');
});
