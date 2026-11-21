// Autonomy suggestions (kit-99): a suggestion is something the dashboard can point at, and a thread can be about.
// Ports: none
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit, threadsFixture, fleetFixture, json, line } from './lib/kit.mjs';

const DAY = 86400000;
const HOUR = 3600000;
const stamp = (d) => `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 23).replace(/[:.]/g, '')}`;
// A line as the kit would have written it at ms, in its writer's file; each id a millisecond apart
// (as test/autonomy-data.test.mjs writes them).
function handFor(F) {
  const logDir = path.join(F.old, 'docs/devteam/run/log');
  let n = 0;
  return (by, o, ms) => {
    const d = new Date(ms + (n++ % 1000));
    const id = o.id ?? `${{ observation: 'o', decision: 'd', act: 'a', knowledge: 'k', question: 'q', goal: 'g', thread: 't', turn: 'u' }[o.type]}-${stamp(d)}-${by}`;
    const file = ['owner', 'supervisor'].includes(by) ? `${by}-${d.toISOString().slice(0, 7)}.jsonl` : `${by}.jsonl`;
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, file), line({ op: 'new', ...(by === 'owner' ? { channel: 'cli' } : {}), ...o, id, at: d.toISOString(), by }));
    return id;
  };
}
const data = (F) => json(F.ok(F.old, ['dashboard-data']));
const suggestions = (F) => data(F).autonomy.suggestions;
// settings.md's json block, patched; committed and pushed with whatever else changed (main's settings
// and strategy apply)
function settings(F, patch) {
  const sf = path.join(F.old, 'docs/devteam/project/settings.md');
  const text = fs.readFileSync(sf, 'utf8');
  const m = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
  fs.writeFileSync(sf, text.replace(m[1], JSON.stringify({ ...JSON.parse(m[1]), ...patch }, null, 2)));
}
function toMain(F, msg) {
  F.g(['add', '-A'], F.old);
  F.g(['commit', '-qm', msg], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
}
const STRATEGY = (items) => `# Strategy\n\n## Why it exists\nA shop that bakes bread for the street.\n\n## Not known yet\n${items.map((i) => `- ${i}\n`).join('')}\n## Later\n- Not this one\n`;
const writeStrategy = (F, text) => fs.writeFileSync(path.join(F.old, 'docs/devteam/project/strategy.md'), text);
function missingSensors(F, names) {
  settings(F, { sensors: Object.fromEntries(names.map((n) => [n, { kind: 'probe', probe: `project/sensors/${n}.mjs`, credentials: { [n.toUpperCase()]: `file:${n}` } }])) });
  for (const n of names) {
    const dir = path.join(F.old, 'docs/devteam/run/sensors', n);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ state: 'failing', fails: 0 }));
  }
}
const HOLDQ = 'Which route should the hub use to read the cloud box?';
const HOLD_ID = 'q-20260101-000000000-supervisor';
const FIXTURE_CLASSES = ['priority-change', 'new-feature', 'release-scope', 'upstream-pr', 'release-production', 'production-migration', 'incident-fix', 'owner-setting', 'settings-edit', 'production-remediation'];

// The known-answers log (spec C5): each kind holds once, and every decoy fails exactly one condition.
// off: every line that much earlier, so it reads off later. Times are relative to now, so the 28 days
// are always [now - 28 days, now].
function knownFixture(F, { off = 0, sensors = ['tok'], strategy = ['Who pays for the hosting'] } = {}) {
  const hand = handFor(F);
  const T = Date.now() - off;
  let k = 0;
  const ask = (cls, ms, extra = {}) => hand('supervisor', { type: 'question', kind: 'owner-decision', class: cls, question: `Should we take step ${++k} for ${cls}?`, recommendation: 'Yes', options: ['Yes', 'No'], ...extra }, ms);
  // n answered with the recommendation, `inside` of them asked in the 28 days, the rest 40 days back
  const answered = (cls, n, inside) => {
    for (let i = 0; i < n; i++) {
      const ms = i < inside ? T - (2 + i) * DAY : T - (40 + i) * DAY;
      hand('owner', { type: 'question', op: 'set', id: ask(cls, ms), answer: 'Yes' }, ms + HOUR);
    }
  };
  // the raise: 10 of 10 went with the recommendation, 6 asked in the 28 days (q = 1.5), so asked 3+
  // times and only raise-excludes-rule keeps a rule for it out
  answered('priority-change', 10, 6);
  // the rule: asked 4 times in the 28 days, never answered, no owner rule
  for (let i = 0; i < 4; i++) ask('new-feature', T - (3 + i) * DAY);
  // raise decoys, each 2 asked in the 28 days: a correction in the 28 days
  // A raise decoy sits at rung 2, so leaking it would be a raise to rung 3 at weight 0.5 and push the
  // strategy item out of the five; a raise to rung 2 would weigh 0.25 and fall off the end unseen.
  // The owner's trust answer takes a class to rung 2.
  const toRung2 = (cls, ms) => {
    const q = hand('supervisor', { type: 'question', kind: 'trust', class: cls, question: `May ${cls} go ahead at a deadline?`, recommendation: 'Yes', options: ['Yes', 'No'] }, ms);
    hand('owner', { type: 'question', op: 'set', id: q, answer: 'Yes', autonomy: { class: cls, rung: 2 } }, ms + HOUR);
  };
  // the correction drops it to rung 1; the owner's answer after it takes it back to 2 and is one of
  // its 2 questions in the 28 days
  answered('release-scope', 10, 1);
  const d = hand('supervisor', { type: 'decision', class: 'release-scope', what: 'cut the release scope', authority: 'rung', rung: 2 }, T - 10 * DAY);
  hand('owner', { type: 'decision', op: 'set', id: d, corrected: { reason: 'not that scope' } }, T - 9 * DAY);
  toRung2('release-scope', T - 8 * DAY);
  // at its ceiling (settings lower it to 2); 9 answered; an open trust question; incident-fix capped at
  // 2 by release-production (1) where merging releases
  answered('upstream-pr', 10, 2);
  answered('release-production', 9, 2);
  toRung2('production-migration', T - 60 * DAY);
  answered('production-migration', 10, 1);
  hand('supervisor', { type: 'question', kind: 'trust', class: 'production-migration', question: 'May I decide production migrations and tell you?', recommendation: 'Yes', options: ['Yes', 'No'] }, T - 4 * DAY);
  answered('incident-fix', 10, 2);
  // rule decoys: an owner standing rule, asked 4 times; asked exactly 2 times
  for (let i = 0; i < 4; i++) ask('owner-setting', T - (5 + i) * DAY);
  hand('owner', { type: 'knowledge', kind: 'lesson', statement: 'Settings: always ask me', scope: 'class:owner-setting', status: 'accepted' }, T - 20 * DAY);
  for (let i = 0; i < 2; i++) ask('settings-edit', T - (6 + i) * DAY);
  // the question decoy: open and older, holding nothing; then the one holding two tickets
  hand('supervisor', { type: 'question', kind: 'owner-decision', question: 'Should the docs move to a wiki?', options: ['Yes', 'No'] }, T - 3 * DAY);
  hand('supervisor', { type: 'question', id: HOLD_ID, kind: 'owner-decision', question: HOLDQ, options: ['Yes', 'No'], blocks: ['kit-23', 'kit-24'] }, T - 5.5 * HOUR);
  settings(F, { release: 'merge', autonomy_ceilings: { 'upstream-pr': 2 } });
  missingSensors(F, sensors);
  if (strategy) writeStrategy(F, STRATEGY(strategy));
  toMain(F, 'settings, sensors and the strategy');
  return { hand, ask, answered, T };
}
function known(W, { senses = 'has 0 of 1 → 1 of 1', sensors = ['tok'] } = {}) {
  return [
    { id: `tr-question-${HOLD_ID}`, kind: 'question', what: HOLDQ, evidence: 'open 5 hours; holds kit-23 and kit-24', effect: '2 can start', weight: 2 },
    { id: 'tr-raise-priority-change', kind: 'raise', what: `Let "${W['priority-change']}" decide and tell you`, evidence: '10 of the last 10 answers went with its recommendation; no corrections in 4 weeks', effect: 'about 2 fewer questions a week', weight: 1.5 },
    { id: 'tr-rule-new-feature', kind: 'rule', what: `A rule for "${W['new-feature']}"`, evidence: 'asked 4 times in 4 weeks', effect: 'about 1 fewer question a week', weight: 1 },
    ...sensors.map((n) => ({ id: `tr-sense-${n}`, kind: 'sense', what: `Connect ${n}`, evidence: 'needed, not connected', effect: `Senses: ${senses}`, weight: 0.5 })),
    { id: 'tr-strategy-who-pays-for-the-hosting', kind: 'strategy', what: '"Who pays for the hosting" is not known yet', evidence: 'listed under Not known yet in the strategy', effect: 'goals stop being rated against a guess', weight: 0.5 },
  ];
}

test('subject: thread new takes suggestion:<id>, one thread per subject', () => {
  const F = threadsFixture('sugg-subject');
  try {
    const args = ['thread', 'new', '--subject', JSON.stringify({ kind: 'item', ref: 'suggestion:tr-raise-x' }), '--', 'about this'];
    const first = F.owner(args).split('\n')[0];
    assert.match(first, /^t-\d{8}-\d{9}-owner$/);
    assert.match(F.fails(args), new RegExp(`${first} is already open on this subject`));
  } finally {
    F.done();
  }
});

test('page names it: T_TYPES, T_KIND, T_HOME, T_WHERE, one key', () => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  const src = html.slice(html.indexOf('/* threads-core start */'), html.indexOf('/* threads-core end */'));
  assert.ok(src.length > 500, 'the threads-core block is marked in index.html');
  const ctx = vm.createContext({ TextEncoder, URL });
  vm.runInContext(`${src}\n;globalThis.api = { T_TYPES, T_KIND, T_HOME, T_WHERE, tKey };`, ctx);
  const A = ctx.api;
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const kitSrc = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
  const kitLine = (name) => new RegExp(`^const ${name} = .*$`, 'm').exec(kitSrc)[0];
  const K = vm.runInContext(`${kitLine('SUBJECT_TYPES')}\n${kitLine('subjectKey')}\n;({ SUBJECT_TYPES, subjectKey })`, vm.createContext({}));
  assert.deepEqual(plain(A.T_TYPES), plain(K.SUBJECT_TYPES));
  assert.ok(A.T_TYPES.includes('suggestion'));
  assert.equal(A.T_KIND.suggestion, 'a suggestion');
  assert.equal(A.T_HOME.suggestion, 'trust');
  assert.equal(A.T_WHERE.suggestion, 'Trust');
  const s = { kind: 'item', ref: 'suggestion:a' };
  assert.equal(A.tKey(s), K.subjectKey(s));
  assert.equal(A.tKey(s), 'item:suggestion:a');
});

test('known answers: one of each kind, every decoy out, in order', () => {
  const F = fleetFixture('sugg-known');
  try {
    knownFixture(F);
    const D = data(F);
    assert.deepEqual(D.autonomy.suggestions, known(D.class_words));
  } finally { F.done(); }
});

test('drops out: each condition, one change at a time', () => {
  const variants = {
    'the holding question answered': [(F, x) => x.hand('owner', { type: 'question', op: 'set', id: HOLD_ID, answer: 'Yes' }, Date.now() - 60000), (L) => L.filter((s) => s.kind !== 'question')],
    'an owner rule for the asked kind': [(F, x) => x.hand('owner', { type: 'knowledge', kind: 'lesson', statement: 'New features: go ahead', scope: 'class:new-feature', status: 'accepted' }, Date.now() - 60000), (L) => L.filter((s) => s.kind !== 'rule')],
    // the raise goes, and its class (asked 6 times, no owner rule) takes a rule in its place
    'a correction on the ready kind': [(F, x) => {
      const d = x.hand('supervisor', { type: 'decision', class: 'priority-change', what: 'raised the importer', authority: 'rung', rung: 2 }, Date.now() - 5 * DAY);
      x.hand('owner', { type: 'decision', op: 'set', id: d, corrected: { reason: 'not the importer' } }, Date.now() - 4 * DAY);
    }, (L, W) => [L[0], { id: 'tr-rule-priority-change', kind: 'rule', what: `A rule for "${W['priority-change']}"`, evidence: 'asked 6 times in 4 weeks', effect: 'about 2 fewer questions a week', weight: 1.5 }, ...L.slice(2)]],
    'the credential posted': [(F, x) => {
      const q = x.hand('supervisor', { type: 'question', kind: 'owner-action', question: 'Post the token tok reads?', sensor: 'tok', secrets: [{ name: 'TOK', sink: 'file:tok' }] }, Date.now() - 2 * HOUR);
      x.hand('owner', { type: 'question', op: 'set', id: q, secrets_posted: [{ name: 'TOK' }] }, Date.now() - HOUR);
    }, (L) => L.filter((s) => s.kind !== 'sense')],
    'the bullet deleted, the strategy still written': [(F) => { writeStrategy(F, STRATEGY([])); toMain(F, 'nothing unknown'); }, (L) => L.filter((s) => s.kind !== 'strategy')],
    'the strategy back to the template': [(F) => { writeStrategy(F, `${STRATEGY(['Who pays for the hosting'])}\n<!-- devteam:strategy-template -->\n`); toMain(F, 'the template again'); }, (L) => L.filter((s) => s.kind !== 'strategy')],
  };
  for (const [name, [change, want]] of Object.entries(variants)) {
    const F = fleetFixture('sugg-drops');
    try {
      const x = knownFixture(F);
      change(F, x);
      const D = data(F);
      assert.deepEqual(D.autonomy.suggestions, want(known(D.class_words), D.class_words), name);
    } finally { F.done(); }
  }
});

test('how many: five at most, none padded, a target-2 raise, a long item', () => {
  // six hold: a second missing sense; the strategy, last by the tie order, is the one left out
  let F = fleetFixture('sugg-six');
  try {
    knownFixture(F, { sensors: ['aaa', 'tok'] });
    const D = data(F);
    assert.deepEqual(D.autonomy.suggestions, known(D.class_words, { senses: 'has 0 of 2 → 1 of 2', sensors: ['aaa', 'tok'] }).slice(0, 5));
  } finally { F.done(); }
  // an empty project: nothing
  F = fleetFixture('sugg-empty');
  try { assert.deepEqual(suggestions(F), []); } finally { F.done(); }
  // one holds, and it is a raise to rung 2 (production-remediation: rung 1, ceiling 2): half the weight
  F = fleetFixture('sugg-one');
  try {
    const hand = handFor(F);
    const T = Date.now();
    for (let i = 0; i < 10; i++) {
      const ms = i < 4 ? T - (2 + i) * DAY : T - (40 + i) * DAY;
      const q = hand('supervisor', { type: 'question', kind: 'owner-decision', class: 'production-remediation', question: `Should we roll back step ${i}?`, recommendation: 'Yes', options: ['Yes', 'No'] }, ms);
      hand('owner', { type: 'question', op: 'set', id: q, answer: 'Yes' }, ms + HOUR);
    }
    const D = data(F);
    assert.deepEqual(D.autonomy.suggestions, [{ id: 'tr-raise-production-remediation', kind: 'raise', what: `Let "${D.class_words['production-remediation']}" go ahead at a deadline`, evidence: '10 of the last 10 answers went with its recommendation; no corrections in 4 weeks', effect: 'about 1 question a week stops waiting on you', weight: 0.5 }]);
  } finally { F.done(); }
  // a 150-character strategy item: its id at most 109, and a thread on it is taken
  F = fleetFixture('sugg-long');
  try {
    const item = `Whether the ${'very '.repeat(26)}long question settles`.slice(0, 150);
    assert.equal(item.length, 150);
    writeStrategy(F, STRATEGY([item]));
    toMain(F, 'a long unknown');
    const [s] = suggestions(F);
    assert.equal(s.kind, 'strategy');
    assert.equal(s.what, `"${item.slice(0, 120)}" is not known yet`);
    assert.equal(s.id.length, 109);
    assert.ok(s.id.startsWith('tr-strategy-whether-the-very-'), s.id);
    F.ok(F.old, ['thread', 'new', '--subject', JSON.stringify({ kind: 'item', ref: `suggestion:${s.id}` }), '--', 'about this']);
  } finally { F.done(); }
});

test('stable ids: a week later the same; more questions reorder, ids stay', () => {
  const F1 = fleetFixture('sugg-week0');
  const F2 = fleetFixture('sugg-week1');
  try {
    knownFixture(F1);
    const x = knownFixture(F2, { off: 7 * DAY });
    const a = suggestions(F1);
    const b = suggestions(F2);
    assert.deepEqual(b.map((s) => s.id), a.map((s) => s.id));
    // eight more new-feature questions: its rule now weighs 3, first, and no id moves
    for (let i = 0; i < 8; i++) x.ask('new-feature', Date.now() - (1 + i) * HOUR);
    const c = suggestions(F2);
    assert.equal(c[0].id, 'tr-rule-new-feature');
    assert.equal(c[0].weight, 3);
    assert.deepEqual(c.map((s) => s.id).sort(), a.map((s) => s.id).sort());
    for (const s of [...a, ...c]) {
      assert.match(s.id, /^tr-(raise|question|sense|strategy|rule)-[a-z0-9-]*$/);
      assert.match(s.id, /^[a-z0-9][a-z0-9-]{0,108}$/);
    }
  } finally { F1.done(); F2.done(); }
});

test('plain words: kinds by name, never by id', () => {
  const F = fleetFixture('sugg-words');
  try {
    knownFixture(F);
    const D = data(F);
    const S = D.autonomy.suggestions;
    assert.equal(S.length, 5);
    for (const s of S) for (const f of ['what', 'evidence', 'effect']) for (const c of FIXTURE_CLASSES) assert.ok(!s[f].includes(c), `${s.id} ${f}: ${s[f]} names ${c}`);
    assert.ok(S.find((s) => s.kind === 'raise').what.includes(D.class_words['priority-change']));
    assert.ok(S.find((s) => s.kind === 'rule').what.includes(D.class_words['new-feature']));
  } finally { F.done(); }
});

// task-2 review F1-F4: the edges the known-answers log doesn't reach
test('edges: no question in the window, asked exactly 3, the effect words, the ages', () => {
  let F = fleetFixture('sugg-edges');
  try {
    const hand = handFor(F);
    const T = Date.now();
    let k = 0;
    const ask = (cls, ms) => hand('supervisor', { type: 'question', kind: 'owner-decision', class: cls, question: `Should we take edge step ${++k}?`, recommendation: 'Yes', options: ['Yes', 'No'] }, ms);
    const answered = (cls, n, inside) => {
      for (let i = 0; i < n; i++) {
        const ms = i < inside ? T - (2 + i) * DAY : T - (40 + i) * DAY;
        hand('owner', { type: 'question', op: 'set', id: ask(cls, ms), answer: 'Yes' }, ms + HOUR);
      }
    };
    answered('priority-change', 10, 1); // a raise to 3 asked once: under half a question a week
    answered('production-remediation', 10, 8); // a raise to 2 asked 8 times: 2 a week stop waiting
    answered('release-scope', 10, 0); // ready, but nothing asked in the 28 days: no raise (F1)
    for (let i = 0; i < 3; i++) ask('new-feature', T - (3 + i) * DAY); // exactly 3: a rule (F2)
    const D = data(F);
    const W = D.class_words;
    assert.deepEqual(D.autonomy.suggestions, [
      { id: 'tr-raise-production-remediation', kind: 'raise', what: `Let "${W['production-remediation']}" go ahead at a deadline`, evidence: '10 of the last 10 answers went with its recommendation; no corrections in 4 weeks', effect: 'about 2 questions a week stop waiting on you', weight: 1 },
      { id: 'tr-rule-new-feature', kind: 'rule', what: `A rule for "${W['new-feature']}"`, evidence: 'asked 3 times in 4 weeks', effect: 'about 1 fewer question a week', weight: 0.75 },
      { id: 'tr-raise-priority-change', kind: 'raise', what: `Let "${W['priority-change']}" decide and tell you`, evidence: '10 of the last 10 answers went with its recommendation; no corrections in 4 weeks', effect: 'fewer than one question a week', weight: 0.25 },
    ]);
  } finally { F.done(); }
  // the oldest holding question's age and what it holds, each older one taking its place (F3)
  F = fleetFixture('sugg-ages');
  try {
    const hand = handFor(F);
    const T = Date.now();
    const hold = (ago, blocks) => hand('supervisor', { type: 'question', kind: 'owner-decision', question: `Hold ${blocks.join(' ')}?`, options: ['Yes', 'No'], blocks }, T - ago);
    const q = () => suggestions(F).find((s) => s.kind === 'question');
    for (const [ago, blocks, evidence, effect] of [
      [30 * 60000, ['kit-1'], 'open under an hour; holds kit-1', '1 can start'],
      [1.5 * HOUR, ['kit-2', 'kit-3', 'kit-4'], 'open 1 hour; holds kit-2, kit-3 and kit-4', '3 can start'],
      [47.5 * HOUR, ['kit-5'], 'open 47 hours; holds kit-5', '1 can start'],
      [48.5 * HOUR, ['kit-6', 'kit-7'], 'open 2 days; holds kit-6 and kit-7', '2 can start'],
      [10.5 * DAY, ['kit-8'], 'open 10 days; holds kit-8', '1 can start'],
    ]) {
      hold(ago, blocks);
      const s = q();
      assert.deepEqual([s.evidence, s.effect, s.weight], [evidence, effect, blocks.length], evidence);
    }
  } finally { F.done(); }
});
