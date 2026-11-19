// next-move@1 (kit-287): the move shape, defined in the comment above nextMoves() in devteam.mjs, held
// here to a shape checker both ways; the fixtures in test/fixtures/next-moves/ checked against it, with
// one broken copy per rule so no rule goes unchecked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DT = path.join(here, '..', 'docs', 'devteam', 'scripts', 'devteam.mjs');
const FIX = path.join(here, 'fixtures', 'next-moves');
const clone = (v) => JSON.parse(JSON.stringify(v));
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

// The contract's closed lists, as the checker knows them.
const FIELDS = ['subject', 'move', 'words', 'holder', 'ref', 'title', 'since', 'command', 'covered_by', 'quiet', 'via', 'flag', 'rung', 'chore'];
const SUBJECT_KINDS = ['goal:', 'ticket:', 'planner:', 'chore:'];
const HOLDERS = ['owner', 'supervisor', 'planner', 'worker', 'nobody'];
const REF_KINDS = ['q', 'm', 'ticket', 'goal', 'chore', 'pr'];
const QUIET = [null, 'hold', 'drain', 'queue'];
const VIA_KINDS = [null, 'ticket:', 'planner:', 'goal:', 'chore:'];
const FLAGS = [null, 'owed', 'stalled', 'none'];
const RUNGS = [0, 1, 2];
const CHORE_KEYS = ['branch', 'ahead', 'pr', 'for'];
const ALWAYS = FIELDS.filter((f) => f !== 'chore');
const LISTS = { fields: FIELDS, subject: SUBJECT_KINDS, holder: HOLDERS, 'ref.kind': REF_KINDS, quiet: QUIET, via: VIA_KINDS, flag: FLAGS, rung: RUNGS, chore: CHORE_KEYS };
// every rule moveErrors and wrapperErrors can report; 3.4's table must break each
const RULES = [
  'field-missing', 'field-unknown', 'subject', 'move', 'words', 'holder', 'ref', 'ref-kind', 'ref-id', 'ref-url', 'title', 'since', 'command', 'covered-by',
  'quiet', 'via', 'flag', 'rung', 'quiet-flag', 'quiet-rung', 'owed-holder', 'owed-rung', 'owed-c4', 'stalled-rung', 'none-holder',
  'chore-missing', 'chore-extra', 'chore-keys', 'chore-branch', 'chore-ahead', 'chore-pr', 'chore-for',
  'wrap-version', 'wrap-moves', 'wrap-keys', 'cache-at', 'cache-goal', 'pulse-one',
];

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const isIso = (s) => typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s));
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const kindOf = (s) => (typeof s === 'string' ? (s.match(/^(goal|ticket|planner|chore):\S+$/)?.[1] ?? null) : null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

// The problems with one move, each "<rule>: <detail>".
function moveErrors(m) {
  const e = [];
  const no = (rule, detail) => e.push(`${rule}: ${detail}`);
  if (!isObj(m)) return ['field-missing: not an object'];
  for (const f of ALWAYS) if (!(f in m)) no('field-missing', f);
  for (const f of Object.keys(m)) if (!FIELDS.includes(f)) no('field-unknown', f);
  const kind = kindOf(m.subject);
  if ('subject' in m && !kind) no('subject', String(m.subject));
  if ('move' in m && !(typeof m.move === 'string' && KEBAB.test(m.move))) no('move', String(m.move));
  if ('words' in m && !nonEmpty(m.words)) no('words', 'empty');
  if ('holder' in m && !HOLDERS.includes(m.holder)) no('holder', String(m.holder));
  if ('ref' in m && m.ref !== null) {
    if (!isObj(m.ref)) no('ref', 'not an object or null');
    else {
      if (!REF_KINDS.includes(m.ref.kind)) no('ref-kind', String(m.ref.kind));
      if (m.ref.kind === 'pr') {
        if (!(Number.isInteger(m.ref.id) && m.ref.id > 0)) no('ref-id', `a pr ref's id is the PR number: ${JSON.stringify(m.ref.id)}`);
        if (!nonEmpty(m.ref.url)) no('ref-url', 'a pr ref has no url');
      } else {
        if (!nonEmpty(m.ref.id)) no('ref-id', JSON.stringify(m.ref.id));
        if ('url' in m.ref) no('ref-url', `a ${m.ref.kind} ref has a url`);
      }
      for (const k of Object.keys(m.ref)) if (!['kind', 'id', 'url'].includes(k)) no('ref', `unknown key ${k}`);
    }
  }
  if ('title' in m && !nonEmpty(m.title)) no('title', 'empty');
  if ('since' in m && !isIso(m.since)) no('since', String(m.since));
  if ('command' in m && !(m.command === null || nonEmpty(m.command))) no('command', JSON.stringify(m.command));
  if ('covered_by' in m) {
    if (!Array.isArray(m.covered_by)) no('covered-by', 'not an array');
    else for (const c of m.covered_by) if (!isObj(c) || !nonEmpty(c.kind) || !nonEmpty(c.subject) || Object.keys(c).length !== 2) no('covered-by', JSON.stringify(c));
  }
  if ('quiet' in m && !QUIET.includes(m.quiet)) no('quiet', String(m.quiet));
  if ('via' in m && m.via !== null && !kindOf(m.via)) no('via', String(m.via));
  if ('flag' in m && !FLAGS.includes(m.flag)) no('flag', String(m.flag));
  if ('rung' in m && !RUNGS.includes(m.rung)) no('rung', JSON.stringify(m.rung));
  const c4 = kind === 'chore' && isObj(m.chore) && m.chore.pr === null;
  if (m.quiet && m.flag !== null) no('quiet-flag', `a quiet move is never flagged (${m.flag})`);
  if (m.quiet && m.rung !== 0) no('quiet-rung', `a quiet move stays at rung 0 (${m.rung})`);
  if (m.flag === 'owed' && m.holder !== 'supervisor') no('owed-holder', `owed is the supervisor's (${m.holder})`);
  if (m.flag === 'owed' && ![1, 2].includes(m.rung)) no('owed-rung', `an owed move is at rung 1 or 2 (${m.rung})`);
  if (m.flag === 'owed' && c4) no('owed-c4', 'a chore with no PR (C4) is never owed');
  if (m.flag === 'stalled' && m.rung !== 2) no('stalled-rung', `a stalled move is at rung 2 (${m.rung})`);
  if (m.flag === 'none' && m.holder !== 'nobody') no('none-holder', `no next move is nobody's (${m.holder})`);
  if (kind === 'chore' && !('chore' in m)) no('chore-missing', 'a chore move carries chore');
  if (kind && kind !== 'chore' && 'chore' in m) no('chore-extra', `a ${kind} move carries no chore`);
  if (kind === 'chore' && 'chore' in m) {
    const c = m.chore;
    if (!isObj(c) || Object.keys(c).sort().join() !== [...CHORE_KEYS].sort().join()) no('chore-keys', JSON.stringify(c));
    if (isObj(c)) {
      if (c.branch !== `chore-${m.subject.slice('chore:'.length)}`) no('chore-branch', `${c.branch} for ${m.subject}`);
      if (!(Number.isInteger(c.ahead) && c.ahead >= 0)) no('chore-ahead', JSON.stringify(c.ahead));
      if (!(c.pr === null || (isObj(c.pr) && Number.isInteger(c.pr.number) && c.pr.number > 0 && nonEmpty(c.pr.url) && Object.keys(c.pr).length === 2))) no('chore-pr', JSON.stringify(c.pr));
      if (!(Array.isArray(c.for) && c.for.every(nonEmpty))) no('chore-for', JSON.stringify(c.for));
    }
  }
  return e;
}

// The problems with a fixture file's wrapper: moves (moves --json), cache (run/cache/next-moves.json),
// pulse (pulse.next: one move).
function wrapperErrors(kind, o) {
  const e = [];
  const no = (rule, detail) => e.push(`${rule}: ${detail}`);
  if (kind === 'pulse') {
    if (!isObj(o)) no('pulse-one', 'pulse.next is one move object');
    return e;
  }
  if (!isObj(o)) return ['wrap-keys: not an object'];
  if (o.next_move !== 1) no('wrap-version', JSON.stringify(o.next_move));
  if (!Array.isArray(o.moves)) no('wrap-moves', 'moves is not an array');
  const keys = kind === 'cache' ? ['next_move', 'at', 'moves'] : ['next_move', 'moves'];
  if (Object.keys(o).join() !== keys.join()) no('wrap-keys', `${Object.keys(o).join()} (want ${keys.join()})`);
  if (kind === 'cache') {
    if (!isIso(o.at)) no('cache-at', String(o.at));
    if (Array.isArray(o.moves)) for (const m of o.moves) if (kindOf(m?.subject) !== 'goal') no('cache-goal', `the cache holds goals' moves only: ${m?.subject}`);
  }
  return e;
}

// The `//` lines directly above `function nextMoves(`, inside the one next-moves region.
function contractComment() {
  const src = fs.readFileSync(DT, 'utf8');
  const a = src.indexOf('/* next-moves start */'), b = src.indexOf('/* next-moves end */');
  assert.ok(a >= 0 && b > a, 'the next-moves region is in devteam.mjs');
  assert.equal(src.indexOf('/* next-moves start */', a + 1), -1, 'one next-moves region');
  const lines = src.slice(a, b).split('\n');
  const i = lines.findIndex((l) => l.startsWith('function nextMoves('));
  assert.ok(i > 0, 'nextMoves() is declared at the top level of the region');
  let j = i;
  while (j > 0 && lines[j - 1].startsWith('//')) j--;
  assert.ok(j < i, 'a comment sits directly above nextMoves()');
  return lines.slice(j, i).join('\n');
}
// `// values <name>: a | b | …` lines, by name.
function valueLines(comment) {
  const m = new Map();
  for (const l of comment.split('\n')) {
    const x = l.match(/^\/\/ values ([\w.]+): (.*)$/);
    if (x) m.set(x[1], [...(m.get(x[1]) ?? []), x[2].split(' | ').map((v) => v.trim())]);
  }
  return m;
}

test('next-moves: the comment above nextMoves() defines next-move@1', () => {
  const c = contractComment();
  assert.match(c, /next-move@1/);
  for (const f of FIELDS) assert.ok(c.includes(f), `the comment names the field ${f}`);
  for (const k of SUBJECT_KINDS) assert.ok(c.includes(k), `the comment names the subject kind ${k}`);
  for (const h of HOLDERS) assert.ok(c.includes(h), `the comment names the holder ${h}`);
  for (const k of REF_KINDS) assert.ok(c.includes(k), `the comment names the ref kind ${k}`);
  assert.ok(c.includes('{ kind, id, url }'), 'the comment gives ref as { kind, id, url }');
  for (const v of [...QUIET, ...FLAGS].filter(Boolean)) assert.ok(c.includes(v), `the comment names ${v}`);
  for (const k of CHORE_KEYS) assert.ok(c.includes(k), `the comment names the chore key ${k}`);
  assert.ok(c.split('\n').some((l) => /\bowed\b/.test(l) && /\bC4\b/.test(l) && /\bnever\b/.test(l)), 'one line says a C4 chore is never owed');
  // the five places
  assert.ok(c.includes('moves --json'), 'place 1: moves --json');
  assert.ok(c.includes('/api/data') && c.includes('next_moves'), 'place 2: /api/data next_moves');
  assert.ok(c.includes('ooda.goals') && /\bnext_move\b/.test(c) && c.includes('goal show'), "place 3: goal views' next_move (ooda.goals, goal show)");
  assert.ok(c.includes('run/cache/next-moves.json'), 'place 4: the hub cache');
  assert.ok(c.includes('pulse.next'), 'place 5: pulse.next');
});

test('next-moves: the comment and the shape checker list the same values', () => {
  const V = valueLines(contractComment());
  for (const [name, list] of Object.entries(LISTS)) {
    assert.equal(V.get(name)?.length, 1, `exactly one "// values ${name}: …" line`);
    assert.deepEqual([...V.get(name)[0]].sort(), list.map(String).sort(), `the comment's ${name} values are the checker's`);
  }
  assert.deepEqual([...V.keys()].sort(), Object.keys(LISTS).sort(), 'no value line the checker lacks');
});

test('next-moves: every fixture move fits the shape', () => {
  const moves = fixture('moves.json'), cache = fixture('cache.json'), pulse = fixture('pulse-next.json');
  assert.deepEqual(wrapperErrors('moves', moves), []);
  assert.deepEqual(wrapperErrors('cache', cache), []);
  assert.deepEqual(wrapperErrors('pulse', pulse), []);
  assert.ok(moves.moves.length > 0 && cache.moves.length > 0);
  for (const m of [...moves.moves, ...cache.moves, pulse]) assert.deepEqual(moveErrors(m), [], `${m.subject} ${m.move}`);
  assert.equal(kindOf(pulse.subject), 'goal', "pulse.next is a goal's move");
  assert.notEqual(pulse.flag, null, 'the pulse sample is flagged');
  assert.ok(cache.moves.some((m) => m.flag !== null), 'the cache holds a flagged move');
});

test('next-moves: the fixtures cover every holder, kind, quiet, flag, rung and ref', () => {
  const { moves } = fixture('moves.json');
  const set = (f) => [...new Set(moves.map(f))].map(String).sort();
  assert.deepEqual(set((m) => m.holder), [...HOLDERS].sort());
  assert.deepEqual(set((m) => `${kindOf(m.subject)}:`), [...SUBJECT_KINDS].sort());
  assert.deepEqual(set((m) => m.quiet), QUIET.map(String).sort());
  assert.deepEqual(set((m) => m.flag), FLAGS.map(String).sort());
  assert.deepEqual(set((m) => m.rung), RUNGS.map(String).sort());
  assert.deepEqual([...new Set(moves.filter((m) => m.ref).map((m) => m.ref.kind))].sort(), [...REF_KINDS].sort());
  assert.ok(moves.some((m) => m.via), 'a via move');
  assert.ok(moves.some((m) => m.covered_by.some((c) => c.subject === '*')), 'a covered_by on any subject');
  assert.ok(moves.some((m) => m.covered_by.some((c) => c.subject !== '*')), 'a covered_by on a stated subject');
  assert.ok(moves.some((m) => m.chore && m.chore.pr && m.ref?.kind === 'pr' && m.ref.url), 'a chore move with its PR (C3)');
  assert.ok(moves.some((m) => m.chore && m.chore.pr === null && m.flag === 'stalled'), 'a chore move with no PR, stalled (C4)');
  assert.ok(moves.some((m) => m.flag === 'owed' && m.rung === 2), 'an owed move at rung 2');
});

test('next-moves: a broken copy fails the checker, one per rule', () => {
  const { moves } = fixture('moves.json');
  const cache = fixture('cache.json');
  const pick = (p) => clone(moves.find(p) ?? assert.fail('no fixture move for a broken copy'));
  const goal = () => pick((m) => m.subject.startsWith('goal:') && !m.quiet && !m.flag && m.ref);
  const pr = () => pick((m) => m.ref?.kind === 'pr');
  const c4 = () => pick((m) => m.chore && m.chore.pr === null);
  const quiet = () => pick((m) => m.quiet);
  const owed = () => pick((m) => m.flag === 'owed' && !m.chore);
  const stalled = () => pick((m) => m.flag === 'stalled');
  const none = () => pick((m) => m.flag === 'none');
  const set = (base, f) => () => { const m = base(); f(m); return m; };
  const CASES = [
    ...ALWAYS.map((f) => ['field-missing', set(goal, (m) => { delete m[f]; })]),
    ['field-unknown', set(goal, (m) => { m.extra = 1; })],
    ['subject', set(goal, (m) => { m.subject = 'feature:x'; })],
    ['move', set(goal, (m) => { m.move = ''; })],
    ['move', set(goal, (m) => { m.move = 'Ask_Goal'; })],
    ['words', set(goal, (m) => { m.words = ' '; })],
    ['holder', set(goal, (m) => { m.holder = 'you'; })],
    ['ref', set(goal, (m) => { m.ref = 'q-1'; })],
    ['ref-kind', set(goal, (m) => { m.ref.kind = 'thread'; })],
    ['ref-id', set(goal, (m) => { delete m.ref.id; })],
    ['ref-url', set(pr, (m) => { delete m.ref.url; })],
    ['ref-id', set(pr, (m) => { m.ref.id = String(m.ref.id); })],
    ['ref-url', set(goal, (m) => { m.ref.url = 'https://example.invalid/x'; })],
    ['title', set(goal, (m) => { m.title = ''; })],
    ['since', set(goal, (m) => { m.since = 'yesterday'; })],
    ['command', set(goal, (m) => { m.command = 3; })],
    ['covered-by', set(goal, (m) => { m.covered_by = {}; })],
    ['covered-by', set(goal, (m) => { m.covered_by = [{ kind: 'idle-planning' }]; })],
    ['covered-by', set(goal, (m) => { m.covered_by = [{ subject: '*' }]; })],
    ['quiet', set(goal, (m) => { m.quiet = 'nap'; })],
    ['via', set(goal, (m) => { m.via = 'feature:x'; })],
    ['flag', set(goal, (m) => { m.flag = 'late'; })],
    ['rung', set(goal, (m) => { m.rung = 3; })],
    ['rung', set(goal, (m) => { m.rung = '1'; })],
    ['quiet-flag', set(quiet, (m) => { m.flag = 'stalled'; m.rung = 2; })],
    ['quiet-rung', set(quiet, (m) => { m.rung = 1; })],
    ['owed-holder', set(owed, (m) => { m.holder = 'owner'; })],
    ['owed-rung', set(owed, (m) => { m.rung = 0; })],
    ['owed-c4', set(c4, (m) => { m.flag = 'owed'; m.rung = 1; })],
    ['stalled-rung', set(stalled, (m) => { m.rung = 1; })],
    ['none-holder', set(none, (m) => { m.holder = 'supervisor'; })],
    ['chore-missing', set(c4, (m) => { delete m.chore; })],
    ['chore-extra', set(goal, (m) => { m.chore = { branch: 'chore-x', ahead: 1, pr: null, for: [] }; })],
    ['chore-keys', set(c4, (m) => { m.chore.extra = 1; })],
    ['chore-branch', set(c4, (m) => { m.chore.branch = 'chore-other'; })],
    ['chore-ahead', set(c4, (m) => { m.chore.ahead = -1; })],
    ['chore-ahead', set(c4, (m) => { m.chore.ahead = 1.5; })],
    ['chore-pr', set(pr, (m) => { delete m.chore.pr.number; })],
    ['chore-pr', set(pr, (m) => { delete m.chore.pr.url; })],
    ['chore-for', set(c4, (m) => { m.chore.for = 'g-1'; })],
  ];
  const WRAPS = [
    ['wrap-version', 'moves', () => ({ next_move: 2, moves: [] })],
    ['wrap-version', 'moves', () => ({ moves: [] })],
    ['wrap-moves', 'moves', () => ({ next_move: 1, moves: {} })],
    ['wrap-keys', 'moves', () => ({ next_move: 1, moves: [], at: cache.at })],
    ['cache-at', 'cache', () => ({ ...clone(cache), at: 'now' })],
    ['cache-goal', 'cache', () => ({ ...clone(cache), moves: [...clone(cache.moves), pick((m) => m.subject.startsWith('ticket:'))] })],
    ['pulse-one', 'pulse', () => [clone(cache.moves[0])]],
  ];
  for (const [rule, make] of CASES) {
    const m = make();
    assert.ok(moveErrors(m).some((x) => x.startsWith(`${rule}: `)), `${rule} is reported for ${JSON.stringify(m)}: ${moveErrors(m).join('; ')}`);
  }
  for (const [rule, kind, make] of WRAPS) {
    assert.ok(wrapperErrors(kind, make()).some((x) => x.startsWith(`${rule}: `)), `${rule} is reported for a ${kind} wrapper`);
  }
  const broken = new Set([...CASES.map(([r]) => r), ...WRAPS.map(([r]) => r)]);
  assert.deepEqual(RULES.filter((r) => !broken.has(r)), [], 'every rule has a broken copy');
});
