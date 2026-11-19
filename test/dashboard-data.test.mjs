// Dashboard data derived on read and stored nowhere (kit-84): plain names for every kind of decision,
// and the rest of what the overhaul's pages draw from. Each test builds its own fixture, drives the
// CLI, and checks that its reads wrote nothing to the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { threadsFixture, fleetFixture, multiFixture, line, write, json, dashboardOnFreePort, PORTS, kit } from './lib/kit.mjs';

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

  // the planner: not blocked yet; then blocked while its goal's open question holds it: no finding (F2)
  assert.deepEqual(bwq('plan-hb-plan'), [], 'not blocked yet');
  handLine(F, 'plan-hb-plan', { type: 'message', kind: 'blocked', to: 'supervisor', text: 'need a ruling' }, 60000);
  assert.deepEqual(bwq('plan-hb-plan'), [], 'blocked, but held by its goal\'s open question');
  // once its question is withdrawn (answer refuses a goal approval), the unanswered blocked message raises it
  F.sup(['withdraw', qg, '--reason', 'test']);
  assert.equal(read(() => data(F)).planners.find((p) => p.feature === 'hb-plan').held_by, null, 'the planner holds nothing');
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

test('the governance listing, read-only, with what changed here', { timeout: 300000 }, async (t) => {
  const undo = [];
  t.after(async () => { let err = null; for (const f of undo.reverse()) { try { await f(); } catch (e) { err ??= e; } } if (err) throw err; });
  const F = fleetFixture('governance');
  undo.push(() => F.done());
  // each main commit pushed: main is origin's
  const commit = (root, msg) => { F.g(['add', '-A'], root); F.g(['commit', '-qm', msg], root); F.g(['push', '-q', 'origin', 'main'], root); };
  // A project initialised fresh, with its own origin, in fleetFixture's folder. Init's untouched
  // strategy template is kept: it reads as not written yet.
  const govFixture = (name, upstreamBase, project = null) => {
    const root = path.join(F.base, name);
    const org = path.join(F.base, `${name}.git`);
    F.g(['init', '-q', '--bare', '-b', 'main', org], F.base);
    fs.mkdirSync(root);
    F.g(['init', '-q', '-b', 'main'], root);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) F.g(['config', k, v], root);
    F.g(['remote', 'add', 'origin', org], root);
    fs.cpSync(kit, path.join(root, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
    // a global flag, after the command
    const pre = project ? ['--project', project] : [];
    F.ok(root, ['init', '--name', name, ...(upstreamBase ? ['--upstream-base', upstreamBase] : []), ...pre]);
    const proj = path.join(root, project ?? 'docs/devteam/project');
    assert.ok(fs.existsSync(path.join(proj, 'strategy.md')), "init's strategy template");
    const sf = path.join(proj, 'settings.md');
    fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"gates": {}', '"gates": {}, "forge": "git", "agent_command": "true", "resume_command": "true"'));
    commit(root, 'init');
    return { root, org, pre, proj };
  };
  const gov = (G, root = G.root) => json(F.ok(root, ['governance', '--json', ...G.pre])).files;
  const logAt = (root) => (fs.existsSync(path.join(root, 'docs/devteam/run/log')) ? logBytes({ old: root }) : 'no log');
  const kitFiles = (dir) => fs.readdirSync(path.join(kit, dir)).filter((f) => f.endsWith('.md')).sort().map((f) => `docs/devteam/${dir}/${f}`);
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  const row = (files, p) => files.find((r) => r.path === p);
  const notWritten = (r, p, title) => {
    assert.ok(r, `a row for ${p}`);
    assert.deepEqual({ ...r, last_change: undefined }, { group: 'project', path: p, title, last_change: undefined, differs: null, written: false, state: 'not written yet' });
  };

  // A: initialised at v0.1.0
  const A = govFixture('gov-sync', 'v0.1.0');
  const before = logAt(A.root);
  let files = gov(A);
  assert.deepEqual(files.map((r) => r.path), [...kitFiles('governance'), ...kitFiles('process'), 'docs/devteam/project/strategy.md', 'docs/devteam/project/exterior.md'], 'every file, in its group, by name');
  assert.deepEqual(files.map((r) => r.group), [...kitFiles('governance').map(() => 'governance'), ...kitFiles('process').map(() => 'process'), 'project', 'project']);
  const con = row(files, 'docs/devteam/governance/constitution.md');
  assert.equal(con.title, 'Constitution');
  assert.equal(con.differs, false, 'untouched since the sync');
  assert.equal(con.written, true);
  assert.equal(con.state, null);
  assert.match(con.last_change, ISO);
  for (const r of files.filter((x) => x.group !== 'project')) assert.equal(r.differs, false, `${r.path} untouched`);
  notWritten(row(files, 'docs/devteam/project/strategy.md'), 'docs/devteam/project/strategy.md', 'Strategy');
  assert.match(row(files, 'docs/devteam/project/strategy.md').last_change, ISO, 'the template is on main, and still not written');
  notWritten(row(files, 'docs/devteam/project/exterior.md'), 'docs/devteam/project/exterior.md', 'Exterior');

  // a local edit
  fs.appendFileSync(path.join(A.root, 'docs/devteam/governance/quality.md'), '\nA local rule.\n');
  commit(A.root, 'a local rule');
  files = gov(A);
  assert.equal(row(files, 'docs/devteam/governance/quality.md').differs, true);
  assert.equal(row(files, 'docs/devteam/governance/quality.md').state, 'changed here');
  assert.equal(row(files, 'docs/devteam/governance/constitution.md').differs, false);

  // a second sync, to v0.2.0, that changes worker.md and leaves quality.md alone
  const sf = path.join(A.proj, 'settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"upstream_base": "v0.1.0"', '"upstream_base": "v0.2.0"'));
  fs.appendFileSync(path.join(A.root, 'docs/devteam/process/worker.md'), '\nFrom the next release.\n');
  commit(A.root, 'chore-devteam-sync-v0.2.0: kit files verbatim from the tag; upstream_base v0.2.0');
  files = gov(A);
  assert.equal(row(files, 'docs/devteam/governance/quality.md').differs, true, 'the sync left the local edit');
  assert.equal(row(files, 'docs/devteam/process/worker.md').differs, false, 'the sync brought it');
  assert.equal(row(files, 'docs/devteam/process/worker.md').state, null);

  // a settings edit that keeps the kit release is not a sync, so a kit file it carries is changed here (T5-1)
  const was = fs.readFileSync(sf, 'utf8');
  fs.writeFileSync(sf, was.replace('"forge": "git"', '"forge": "git", "tick_minutes": 20'));
  assert.notEqual(fs.readFileSync(sf, 'utf8'), was, 'settings.md changed');
  fs.appendFileSync(path.join(A.root, 'docs/devteam/process/worker.md'), '\nA local step.\n');
  commit(A.root, 'tick every 20 minutes, and a local step');
  files = gov(A);
  assert.equal(row(files, 'docs/devteam/process/worker.md').differs, true, 'upstream_base unchanged: not a sync');
  assert.equal(row(files, 'docs/devteam/process/worker.md').state, 'changed here');
  assert.equal(row(files, 'docs/devteam/governance/constitution.md').differs, false, 'untouched since the first sync');

  // the strategy written
  fs.writeFileSync(path.join(A.proj, 'strategy.md'), '# Our strategy\n\nSell to admins.\n');
  commit(A.root, 'the strategy');
  files = gov(A);
  const st = row(files, 'docs/devteam/project/strategy.md');
  assert.equal(st.written, true);
  assert.equal(st.title, 'Our strategy');
  assert.equal(st.state, null);
  assert.equal(st.differs, null, 'the project\'s own');
  assert.match(st.last_change, ISO);
  notWritten(row(files, 'docs/devteam/project/exterior.md'), 'docs/devteam/project/exterior.md', 'Exterior');
  const cli = json(F.ok(A.root, ['governance', '--json']));
  assert.deepEqual(logAt(A.root), before, 'the reads wrote nothing to the log');

  // B and C: no upstream_base and no strategy, under another project folder
  const B = govFixture('gov-none', null, 'docs/elsewhere');
  const beforeB = logAt(B.root);
  files = gov(B);
  assert.deepEqual(files.map((r) => r.path), [...kitFiles('governance'), ...kitFiles('process'), 'docs/elsewhere/strategy.md', 'docs/elsewhere/exterior.md']);
  for (const r of files.filter((x) => x.group !== 'project')) {
    assert.equal(r.differs, null, `${r.path}: no sync commit`);
    assert.equal(r.state, null);
    assert.match(r.last_change, ISO);
  }
  notWritten(row(files, 'docs/elsewhere/strategy.md'), 'docs/elsewhere/strategy.md', 'Strategy');
  notWritten(row(files, 'docs/elsewhere/exterior.md'), 'docs/elsewhere/exterior.md', 'Exterior');
  assert.deepEqual(logAt(B.root), beforeB, 'the reads wrote nothing to the log');
  // its first sync, which changes only worker.md: worker.md is the release's, and every file older
  // than the sync has no known release to compare with (F1)
  const sfB = path.join(B.proj, 'settings.md');
  const nullBase = fs.readFileSync(sfB, 'utf8');
  assert.match(nullBase, /"upstream_base": null/);
  fs.writeFileSync(sfB, nullBase.replace('"upstream_base": null', '"upstream_base": "v0.1.0"'));
  fs.appendFileSync(path.join(B.root, 'docs/devteam/process/worker.md'), '\nFrom the first release.\n');
  commit(B.root, 'chore-devteam-sync-v0.1.0: kit files verbatim from the tag; upstream_base v0.1.0');
  files = gov(B);
  assert.equal(row(files, 'docs/devteam/process/worker.md').differs, false, 'the sync brought it');
  assert.equal(row(files, 'docs/devteam/process/worker.md').state, null);
  for (const r of files.filter((x) => x.group !== 'project' && x.path !== 'docs/devteam/process/worker.md')) {
    assert.equal(r.differs, null, `${r.path}: older than every sync`);
    assert.equal(r.state, null, `${r.path}: not changed here`);
  }
  assert.ok(row(files, 'docs/devteam/governance/constitution.md'), 'constitution among them');

  // D: a shallow clone of A
  const neu = path.join(F.base, 'gov-shallow');
  F.g(['clone', '-q', '--depth', '1', `file://${A.org}`, neu], F.base);
  files = gov(A, neu);
  assert.equal(files.length, cli.files.length);
  for (const r of files) assert.equal(r.last_change, '—', `${r.path}: its history is cut off`);
  for (const r of files.filter((x) => x.group !== 'project')) assert.equal(r.differs, null, `${r.path}: shallow`);

  // the dashboard serves the same
  const env = F.env({
    DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PORT_BASE: String(PORTS + 3),
    CLAUDE_CONFIG_DIR: path.join(F.base, 'claude'), CODEX_HOME: path.join(F.base, 'codex'),
    DEVTEAM_DATA_WAIT_MS: '600000',
  });
  delete env.DEVTEAM_SUPERVISOR;
  const { dash, port } = await dashboardOnFreePort(A.root, env);
  undo.push(() => dash.stop());
  const get = async (route) => { const r = await fetch(`http://127.0.0.1:${port}${route}`); assert.equal(r.status, 200, route); return r.json(); };
  assert.deepEqual(await get('/api/governance'), cli);
  const d = await get('/api/data');
  for (const k of ['class_words', 'threads', 'upkeep_days', 'settings_all']) assert.ok(k in d, `/api/data has ${k}`);
  const h = await get('/api/hello');
  for (const k of ['you', 'waiting', 'ready']) assert.equal(typeof h.threads?.[k], 'number', `/api/hello's threads.${k}`);
  assert.deepEqual(logAt(A.root), before, 'the dashboard\'s reads wrote nothing to the log');
});

// The settings groups, in the page's order
const SETTING_GROUPS = ['Fleet and capacity', 'Agents and sessions', 'Merging and checks', 'Questions and findings', 'Upstream and releases', 'Production', 'Rhythm', 'Project and links'];
const SETTINGS_BLOCK_RE = /```json devteam\s*\n([\s\S]*?)\n```/;
// a const's object literal in the kit's source, from its opening line to the next `};`
const sourceBlock = (src, start) => { const i = src.indexOf(start); assert.ok(i >= 0, `${start} in the kit`); const rest = src.slice(i); return rest.slice(0, rest.search(/^}\)?;/m) + 2); };
// an entry the words check rejects: no name, no description, or a description longer than one short line
const badWords = (all) => all.filter((e) => !e.name || e.name.startsWith('Unnamed setting') || !e.description || e.description.length > 140 || /\n/.test(e.description)).map((e) => e.key);

test('every kit setting, grouped, named, with no secret shown', { timeout: 300000 }, async (t) => {
  const undo = [];
  t.after(async () => { let err = null; for (const f of undo.reverse()) { try { await f(); } catch (e) { err ??= e; } } if (err) throw err; });
  const F = fleetFixture('settings-all');
  undo.push(() => F.done());

  // The keys, from the source by regex: SETTINGS_DEFAULTS', OWNER_SETTINGS' and sensor_scrub
  const src = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
  const defaultsText = sourceBlock(src, 'const SETTINGS_DEFAULTS = {');
  const union = new Set([
    ...[...defaultsText.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]),
    ...[...sourceBlock(src, 'const OWNER_SETTINGS = {').matchAll(/\b([a-z_]+): '/g)].map((m) => m[1]),
    'sensor_scrub',
  ]);
  assert.equal(union.size, 49, 'every setting the kit reads, 49 today');
  // every direct read names a key in the union (spec §6, F3-3: its reach)
  const reads = [...src.matchAll(/loadSettings\(\)\.([a-z_]+)/g), ...src.matchAll(/settingsAt\([^)]*\)\??\.([a-z_]+)/g)].map((m) => m[1]);
  assert.ok(reads.length > 50, `the read sites found (${reads.length})`);
  assert.deepEqual([...new Set(reads.filter((k) => !union.has(k)))], [], 'a key read in the code and missing from the union');
  // no stale name: every SETTINGS_WORDS key is one the kit reads
  assert.deepEqual([...sourceBlock(src, 'const SETTINGS_WORDS = ').matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]).filter((k) => !union.has(k)), [], 'a SETTINGS_WORDS key the kit doesn\'t read');
  // the kit's defaults, evaluated from the same block (upstream_repo's default is KIT_UPSTREAM)
  const DEFAULTS = new Function('KIT_UPSTREAM', `return ${defaultsText.slice(defaultsText.indexOf('{'), -1)}`)(src.match(/^const KIT_UPSTREAM = '([^']+)';/m)[1]);

  // main's settings: credentials planted wherever one could live
  const sf = path.join(F.old, 'docs/devteam/project/settings.md');
  const block = (text) => JSON.parse(text.match(SETTINGS_BLOCK_RE)[1]);
  const withBlock = (text, o) => text.replace(SETTINGS_BLOCK_RE, () => `\`\`\`json devteam\n${JSON.stringify(o, null, 2)}\n\`\`\``);
  const init = fs.readFileSync(sf, 'utf8');
  const cmd = 'claude --token ghp_PLANTED1';
  const TOKEN = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  // a sensor id the scrubber catches: a names key that reads withheld (T6-1)
  const SENSOR_ID = 'ghp_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
  const planted = {
    ...block(init),
    max_active_tickets: 3,
    agent_command: cmd, resume_command: cmd, agent_trust_command: cmd, usage_command: cmd, worktree_setup: cmd,
    gates: { test: { cmd: 'TOKEN=PLANTED2 npm test' } },
    upstream_repo: 'https://user:PLANTED3@example.com/PLANTED4/kit.git',
    links: { ...block(init).links, site: { kind: 'url', title: 'Site', url: 'https://example.com/?key=PLANTED5' } },
    sensors: { web: { kind: 'http', url: 'https://example.com/PLANTED6' }, [SENSOR_ID]: { kind: 'http', url: 'https://example.com/health' } },
    sensor_defaults: { params: { token: 'PLANTED7' } },
    remediations: { restart: { script: 'x.mjs', params: { key: 'PLANTED8' } } },
    sensor_scrub: ['PLANTED9'],
    release: { branch: 'production', token: 'PLANTED11' },
    tmux_session: TOKEN,
    secret_commands: ['gh secret set PLANTED10'],
  };
  assert.equal(TOKEN.length, 4 + 36, 'ghp_ and 36 characters');
  const onMain = withBlock(init, planted);
  fs.writeFileSync(sf, onMain);
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', 'settings with credentials in them'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  const mainKeys = new Set(Object.keys(block(F.g(['show', 'main:docs/devteam/project/settings.md'], F.old))));
  // a working-tree edit, put back after its read
  undo.push(() => fs.writeFileSync(sf, onMain));
  const edited = (o) => { fs.writeFileSync(sf, withBlock(onMain, { ...planted, ...o })); try { return data(F).settings_all; } finally { fs.writeFileSync(sf, onMain); } };
  const entry = (all, k) => { const e = all.find((x) => x.key === k); assert.ok(e, `an entry for ${k}`); return e; };
  const noCredential = (all, label) => {
    const s = JSON.stringify(all);
    for (let i = 1; i <= 11; i++) assert.ok(!s.includes(`PLANTED${i}`), `${label}: PLANTED${i} shows`);
    assert.ok(!s.includes(TOKEN) && !s.includes('ghp_'), `${label}: the ghp_ token shows`);
  };

  // the fixture has no log until something writes one: a read must not make it
  const logNow = () => (fs.existsSync(path.join(F.old, 'docs/devteam/run/log')) ? logBytes(F) : 'no log');
  const before = logNow();
  const all = data(F).settings_all;
  assert.ok(Array.isArray(all), 'settings_all');
  // keys
  assert.equal(all.length, 49);
  assert.deepEqual(new Set(all.map((e) => e.key)), union);
  // order: each group once, in the page's order
  const groups = all.map((e) => e.group).filter((g, i, a) => g !== a[i - 1]);
  assert.deepEqual(groups, SETTING_GROUPS);
  // the show kinds (F3-4)
  const kinds = {};
  for (const e of all) kinds[e.shown] = (kinds[e.shown] ?? 0) + 1;
  assert.deepEqual(kinds, { value: 32, hidden: 6, names: 8, count: 3 });
  for (const e of all) {
    for (const f of ['key', 'group', 'name', 'description', 'shown', 'value', 'set', 'default', 'owner_only']) assert.ok(f in e, `${e.key} has ${f}`);
    assert.equal(e.set, mainKeys.has(e.key), `${e.key}: set is whether main's file has it`);
    assert.ok(!('local' in e) && !('source' in e), `${e.key}: the working tree is main's, and main is read`);
    if (e.shown === 'value') assert.deepEqual(e.default, DEFAULTS[e.key], `${e.key}: its kit default passes its shape`);
    if (e.shown === 'value' && !mainKeys.has(e.key)) {
      assert.ok(!e.withheld, `${e.key}: a default is never withheld`);
      assert.deepEqual(e.value, DEFAULTS[e.key], `${e.key}: unset shows the kit default`);
    }
    if (e.shown === 'hidden') assert.equal(e.value, null, `${e.key}: hidden`);
  }
  // words
  assert.deepEqual(badWords(all), [], 'each entry named, with a one-line description');
  // values
  assert.deepEqual(entry(all, 'gates'), { ...entry(all, 'gates'), owner_only: 'gate-change', value: ['test'] });
  assert.equal(entry(all, 'sensor_scrub').value, 1);
  assert.equal(entry(all, 'secret_commands').value, 1);
  assert.deepEqual(entry(all, 'sensor_defaults').value, ['params']);
  assert.equal(SENSOR_ID.length, 4 + 36);
  assert.deepEqual(entry(all, 'sensors').value, ['web', '[withheld]'], 'a sensor id the scrubber catches reads withheld');
  assert.ok(!JSON.stringify(all).includes(SENSOR_ID), 'the sensor id token shows');
  const ac = entry(all, 'agent_command');
  assert.deepEqual([ac.value, ac.set, ac.default, ac.owner_only], [null, true, 'claude --dangerously-skip-permissions', 'governance-edit']);
  assert.equal(entry(all, 'upstream_repo').default, null);
  for (const k of ['release', 'tmux_session']) assert.deepEqual([entry(all, k).withheld, entry(all, k).value], [true, null], `${k} withheld`);
  noCredential(all, 'main');

  // (a) a working-tree edit shows in local, not in value
  let a = edited({ max_active_tickets: 4 });
  const max = entry(a, 'max_active_tickets');
  assert.deepEqual({ value: max.value, set: max.set, local: max.local, default: max.default, owner_only: max.owner_only }, { value: 3, set: true, local: 4, default: null, owner_only: null });
  noCredential(a, '(a)');
  // (b) values of the wrong type: withheld, never raw, never a throw (Review Focus 5)
  a = edited({ agent_command: 42, max_active_tickets: 'lots' });
  assert.equal(entry(a, 'agent_command').local ?? null, null);
  assert.ok(!JSON.stringify(entry(a, 'agent_command')).includes('42'), 'no 42 under agent_command');
  assert.deepEqual([entry(a, 'max_active_tickets').local, entry(a, 'max_active_tickets').local_withheld], [null, true]);
  assert.ok(!JSON.stringify(a).includes('"lots"'), 'no raw "lots" anywhere');
  noCredential(a, '(b)');
  // (c) a bidi override in a shape releaseProblem accepts
  a = edited({ release: { branch: 'main‮' } });
  assert.deepEqual([entry(a, 'release').local, entry(a, 'release').local_withheld], [null, true]);
  assert.ok(!JSON.stringify(a).includes('‮'));
  noCredential(a, '(c)');

  // the self-test: a key whose words are taken out is caught, and its value hidden
  const copy = path.join(F.old, 'docs/devteam/scripts/devteam.mjs');
  const text = fs.readFileSync(copy, 'utf8');
  undo.push(() => fs.writeFileSync(copy, text));
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('const SETTINGS_WORDS = '));
  const end = lines.findIndex((l, i) => i > start && l.startsWith('});'));
  const at = lines.findIndex((l, i) => i > start && i < end && /^\s*tick_minutes: /.test(l));
  assert.ok(start >= 0 && at > start, 'a tick_minutes: line in SETTINGS_WORDS');
  fs.writeFileSync(copy, lines.filter((_, i) => i !== at).join('\n'));
  const cut = data(F).settings_all;
  fs.writeFileSync(copy, text);
  const tick = entry(cut, 'tick_minutes');
  assert.deepEqual({ group: tick.group, name: tick.name, shown: tick.shown, value: tick.value, default: tick.default }, { group: 'Other', name: 'Unnamed setting (tick_minutes)', shown: 'hidden', value: null, default: null });
  assert.equal(cut.at(-1).key, 'tick_minutes', 'an unnamed key comes last');
  assert.deepEqual(badWords(cut), ['tick_minutes']);

  assert.deepEqual(logNow(), before, 'the reads wrote nothing to the log');
});

// kit-91: the Board's Repo filter reads each ticket's repo: its component's repo link, 'home' for home's lines
test('each ticket row says its repo', { timeout: 300000 }, async (t) => {
  const M = multiFixture('repo-rows');
  t.after(() => M.done());
  M.ticket('console-01-a');
  M.ticket('api-01-a', { touches: ['api/**'] });
  const d = json(M.ok(M.old, ['dashboard-data']));
  const row = (xs, id) => xs.find((r) => r.id === id);
  assert.equal(row(d.tickets, 'console-01-a').repo, 'console', 'a repo link component: the link');
  assert.equal(row(d.tickets, 'api-01-a').repo, 'home', 'a home line: home');
  assert.equal(row(d.progress.tickets, 'console-01-a').repo, 'console', 'progress: the link');
  assert.equal(row(d.progress.tickets, 'api-01-a').repo, 'home', 'progress: home');
  const F = threadsFixture('repo-rows-one');
  t.after(() => F.done());
  F.sup(['feature', 'add', 'rr-work', '--json', JSON.stringify({ title: 'RR', goals: [F.goal], stories: [{ id: 'RR-S1', text: 'x', release: 'v1.0.0' }] })]);
  F.sup(['ticket', 'add', 'app-01-a', '--json', JSON.stringify({ title: 'a', feature: 'rr-work', component: 'app', kind: 'build', size: 'S', risk: 'normal', serves: ['RR-S1'], depends_on: [], touches: ['src/**'], done_when: ['the src test passes in CI'] })]);
  const one = data(F);
  assert.ok(one.tickets.length && one.progress.tickets.length, 'rows to check');
  for (const r of [...one.tickets, ...one.progress.tickets]) assert.equal(r.repo, 'home', `${r.id}: one repo, home`);
});
