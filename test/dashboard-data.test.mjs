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
