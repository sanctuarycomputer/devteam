// The memory reading, machine-memory@1 (kit-590): the box-memory region of devteam.mjs cut out and
// run under node:vm with nothing in scope, so a region that reaches outside itself throws. Its
// check, memoryReadingProblem, against valid readings and one change at a time; its contract
// comment against the fields, kinds and /memory.json words the design gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b); assert.ok(i >= 0 && j > i, `${a} … ${b} marks a block in devteam.mjs`); return src.slice(i, j); };
const region = () => cut('/* box-memory start */', '/* box-memory end */');
const fns = () => vm.runInContext(`${region()}\n;({ memoryReadingProblem, MEMORY_KINDS, MEMORY_CEILING_MIN, MEMORY_CEILING_MAX })`, vm.createContext({}));

const KINDS = ['agent', 'browser', 'install', 'devteam', 'node', 'other'];
// The design's example reading, as one valid line.
const READING = {
  v: 1, at: '2026-11-18T01:40:00Z', working_set: 24125440000, max: 51539607552, ceiling: 0.8,
  source: 'cgroup', sessions: 33,
  kinds: { agent: { n: 38, rss: 16200000000 }, browser: { n: 15, rss: 1890000000 },
    install: { n: 2, rss: 230000000 }, devteam: { n: 45, rss: 4500000000 }, node: { n: 7, rss: 3200000000 }, other: { n: 160, rss: 1100000000 } },
  devteam: { dashboard: { n: 6, rss: 626000000 }, wait: { n: 5, rss: 309000000 }, hello: { n: 1, rss: 140000000 } },
  projects: { 'devteam-dev': { rss: 3100000000, sessions: 6, devteam: { dashboard: 110000000, hello: 140000000, wait: 60000000 } },
    mothership: { rss: 5200000000, sessions: 9, devteam: { dashboard: 100000000 } } },
};
const reading = () => structuredClone(READING);
const variant = (f) => { const r = reading(); f(r); return r; };

test('check 1: a valid reading passes, as text and as an object, and so do its valid variants', () => {
  const { memoryReadingProblem } = fns();
  const valid = {
    'the design example': reading(),
    'at with milliseconds': variant((r) => { r.at = '2026-11-17T00:00:00.123Z'; }),
    'working_set 0': variant((r) => { r.working_set = 0; }),
    'a project with only rss': variant((r) => { r.projects.mothership = { rss: 5200000000 }; }),
    'a partial line': variant((r) => { r.partial = true; }),
    'a macOS line': { v: 1, at: '2026-11-17T00:00:00Z', working_set: 8589934592, max: 17179869184, source: 'os' },
    'a minimal line': { v: 1, at: '2026-11-17T00:00:00Z', working_set: 1 },
    'meminfo, no kinds': { v: 1, at: '2026-11-17T00:00:00Z', working_set: 1, max: 2, source: 'meminfo' },
  };
  for (const [name, r] of Object.entries(valid)) {
    assert.equal(memoryReadingProblem(JSON.stringify(r)), null, `${name}, as text`);
    assert.equal(memoryReadingProblem(r), null, `${name}, as an object`);
  }
  assert.equal(memoryReadingProblem(`${JSON.stringify(reading())}\n`), null, 'a line with its newline');
});

test('check 2: each refusal starts with the path of the field it names', () => {
  const { memoryReadingProblem } = fns();
  const line = JSON.stringify(READING);
  const cases = [
    ['no v', (r) => { delete r.v; }, 'v'],
    ['v 2', (r) => { r.v = 2; }, 'v'],
    ['v "1"', (r) => { r.v = '1'; }, 'v'],
    ['no at', (r) => { delete r.at; }, 'at'],
    ['at yesterday', (r) => { r.at = 'yesterday'; }, 'at'],
    ['at with an offset', (r) => { r.at = '2026-11-17T00:00:00+00:00'; }, 'at'],
    ['at with no Z', (r) => { r.at = '2026-11-17T00:00:00'; }, 'at'],
    ['at a number', (r) => { r.at = 1763337600000; }, 'at'],
    ['at month 13', (r) => { r.at = '2026-13-01T00:00:00Z'; }, 'at'],
    ['at February 30', (r) => { r.at = '2026-02-30T00:00:00Z'; }, 'at'],
    ['at hour 24', (r) => { r.at = '2026-11-17T24:00:00Z'; }, 'at'],
    ['no working_set', (r) => { delete r.working_set; }, 'working_set'],
    ['working_set -1', (r) => { r.working_set = -1; }, 'working_set'],
    ['working_set 1.5', (r) => { r.working_set = 1.5; }, 'working_set'],
    ['working_set "12"', (r) => { r.working_set = '12'; }, 'working_set'],
    ['working_set 2^60', (r) => { r.working_set = 2 ** 60; }, 'working_set'],
    ['working_set null', (r) => { r.working_set = null; }, 'working_set'],
    ['max 0', (r) => { r.max = 0; }, 'max'],
    ['max -1', (r) => { r.max = -1; }, 'max'],
    ['kinds.agent.rss -5', (r) => { r.kinds.agent.rss = -5; }, 'kinds.agent.rss'],
    ['kinds.agent.n 1.5', (r) => { r.kinds.agent.n = 1.5; }, 'kinds.agent.n'],
    ['kinds.agent with no n', (r) => { delete r.kinds.agent.n; }, 'kinds.agent.n'],
    ['kinds.agent with pss', (r) => { r.kinds.agent.pss = 1; }, 'kinds.agent.pss'],
    ['kinds.agent a number', (r) => { r.kinds.agent = 3; }, 'kinds.agent'],
    ['kinds.gpu', (r) => { r.kinds.gpu = { n: 1, rss: 1 }; }, 'kinds.gpu'],
    ['kinds an array', (r) => { r.kinds = []; }, 'kinds'],
    ['sessions -1', (r) => { r.sessions = -1; }, 'sessions'],
    ['sessions 1.5', (r) => { r.sessions = 1.5; }, 'sessions'],
    ['devteam a string', (r) => { r.devteam = 'x'; }, 'devteam'],
    ['devteam an array', (r) => { r.devteam = [{ n: 1, rss: 1 }]; }, 'devteam'],
    ['devteam "Not A Command"', (r) => { r.devteam = { 'Not A Command': { n: 1, rss: 1 } }; }, 'devteam["Not A Command"]'],
    ['devteam.hello with x', (r) => { r.devteam.hello.x = 1; }, 'devteam.hello.x'],
    ['devteam.hello with no rss', (r) => { delete r.devteam.hello.rss; }, 'devteam.hello.rss'],
    ['projects devteam "x"', (r) => { r.projects['devteam-dev'].devteam = { hello: 'x' }; }, 'projects.devteam-dev.devteam.hello'],
    ['projects devteam 1.5', (r) => { r.projects['devteam-dev'].devteam = { hello: 1.5 }; }, 'projects.devteam-dev.devteam.hello'],
    ['projects devteam { n }', (r) => { r.projects['devteam-dev'].devteam = { hello: { n: 1 } }; }, 'projects.devteam-dev.devteam.hello'],
    ['projects devteam "Not A Command"', (r) => { r.projects['devteam-dev'].devteam = { 'Not A Command': 1 }; }, 'projects.devteam-dev.devteam["Not A Command"]'],
    ['projects devteam an array', (r) => { r.projects['devteam-dev'].devteam = [1]; }, 'projects.devteam-dev.devteam'],
    ['a project with no rss', (r) => { delete r.projects['devteam-dev'].rss; }, 'projects.devteam-dev.rss'],
    ['a project sessions -1', (r) => { r.projects['devteam-dev'].sessions = -1; }, 'projects.devteam-dev.sessions'],
    ['a project with another key', (r) => { r.projects['devteam-dev'].kinds = {}; }, 'projects.devteam-dev.kinds'],
    ['a project not an object', (r) => { r.projects['devteam-dev'] = 5; }, 'projects.devteam-dev'],
    ['projects a number', (r) => { r.projects = 5; }, 'projects'],
    ['projects an array', (r) => { r.projects = [{ rss: 1 }]; }, 'projects'],
    ['a project named ""', (r) => { r.projects[''] = { rss: 1 }; }, 'projects[""]'],
    ['projects["my.app"].rss -1', (r) => { r.projects['my.app'] = { rss: -1 }; }, 'projects["my.app"].rss'],
    ['ceiling 1.2', (r) => { r.ceiling = 1.2; }, 'ceiling'],
    ['ceiling "0.8"', (r) => { r.ceiling = '0.8'; }, 'ceiling'],
    ['source disk', (r) => { r.source = 'disk'; }, 'source'],
    ['partial false', (r) => { r.partial = false; }, 'partial'],
    ['top-level extra', (r) => { r.extra = 1; }, 'extra'],
  ];
  for (const [name, change, want] of cases) {
    const r = reading(); change(r);
    for (const [as, input] of [['text', JSON.stringify(r)], ['object', r]]) {
      const got = memoryReadingProblem(input);
      assert.equal(typeof got, 'string', `${name} (${as}) is refused`);
      assert.ok(got.startsWith(`${want} `), `${name} (${as}): "${got}" starts with "${want} "`);
    }
  }
  for (const [name, input] of [['not json', 'not json'], ['[]', '[]'], ['null', 'null'], ['a torn line', line.slice(0, Math.floor(line.length / 2))],
    ['an empty line', ''], ['a number', '5'], ['an array value', []], ['a null value', null], ['undefined', undefined]]) {
    const got = memoryReadingProblem(input);
    assert.equal(typeof got, 'string', `${name} is refused`);
    assert.ok(got.startsWith('reading '), `${name}: "${got}" starts with "reading "`);
  }
});

test('check 2: a value JSON cannot print is refused with words, never a throw', () => {
  const { memoryReadingProblem } = fns();
  const loop = []; loop.push(loop);
  const self = { n: 1.5 }; self.self = self;
  const bare = Object.create(null);
  for (const [name, change, want] of [
    ['a BigInt working_set', (r) => { r.working_set = 10n; }, 'working_set'],
    ['a BigInt max', (r) => { r.max = 1n; }, 'max'],
    ['a circular kinds entry', (r) => { r.kinds.agent = loop; }, 'kinds.agent'],
    ['a circular object as kinds', (r) => { r.kinds = self; }, 'kinds.n'],
    ['a prototype-less project entry', (r) => { r.projects['devteam-dev'] = bare; }, 'projects.devteam-dev.rss'],
    ['a prototype-less devteam value', (r) => { r.projects['devteam-dev'].devteam = { hello: bare }; }, 'projects.devteam-dev.devteam.hello'],
  ]) {
    const r = reading(); change(r);
    let got; assert.doesNotThrow(() => { got = memoryReadingProblem(r); }, name);
    assert.equal(typeof got, 'string', `${name} is refused`);
    assert.ok(got.startsWith(`${want} `), `${name}: "${got}" starts with "${want} "`);
  }
});

test('check 2: the words say what the field is and what it should be', () => {
  const { memoryReadingProblem } = fns();
  assert.equal(memoryReadingProblem(variant((r) => { r.working_set = -1; })), 'working_set is -1: it should be integer bytes, 0 or more');
});

test('check 3: only shape; the ceiling bounds agree with memoryCeilingProblem', () => {
  const { memoryReadingProblem, MEMORY_CEILING_MIN, MEMORY_CEILING_MAX, MEMORY_KINDS } = fns();
  assert.equal(JSON.stringify(MEMORY_KINDS), JSON.stringify(KINDS));
  assert.equal(memoryReadingProblem(variant((r) => { r.kinds.agent.rss = r.working_set * 3; })), null, 'kinds that add up past working_set');
  assert.equal(memoryReadingProblem(variant((r) => { r.working_set = r.max * 2; })), null, 'working_set over max');
  for (const c of [0.5, 0.95]) assert.equal(memoryReadingProblem(variant((r) => { r.ceiling = c; })), null, `ceiling ${c}`);
  for (const c of [0.49, 0.96]) assert.ok(memoryReadingProblem(variant((r) => { r.ceiling = c; }))?.startsWith('ceiling '), `ceiling ${c} refused`);
  const line = src.split('\n').find((l) => l.startsWith('const memoryCeilingProblem = '));
  assert.ok(line, 'memoryCeilingProblem in devteam.mjs');
  const m = /v >= ([\d.]+) && v <= ([\d.]+)/.exec(line);
  assert.ok(m, `memoryCeilingProblem's bounds read from "${line.slice(0, 120)}"`);
  assert.equal(Number(m[1]), MEMORY_CEILING_MIN);
  assert.equal(Number(m[2]), MEMORY_CEILING_MAX);
});

// The comment block directly above function memoryReadingProblem: the run of // lines before it.
const contractComment = () => {
  const lines = region().split('\n');
  const at = lines.findIndex((l) => l.startsWith('function memoryReadingProblem('));
  assert.ok(at > 0, 'function memoryReadingProblem in the region');
  let i = at;
  while (i > 0 && lines[i - 1].startsWith('//')) i--;
  assert.ok(i < at, 'a comment directly above memoryReadingProblem');
  return lines.slice(i, at).join('\n');
};

test('check 3b: readers skip refused lines, and the comment says so', () => {
  const { memoryReadingProblem } = fns();
  const day = [0, 1, 2].map((k) => JSON.stringify(variant((r) => { r.at = `2026-11-17T00:0${k}:00Z`; })));
  const torn = day[1].slice(0, Math.floor(day[1].length / 2));
  const file = `${[...day, torn].join('\n')}\n${JSON.stringify(variant((r) => { r.v = 2; }))}\n`;
  const kept = file.split('\n').filter((l) => l !== '' && memoryReadingProblem(l) === null);
  assert.deepEqual(kept, day);
  assert.match(contractComment(), /skipped/);
});

test('check 10: the comment states every field, kind and /memory.json rule', () => {
  const c = contractComment();
  const words = ['machine-memory@1', 'v: 1',
    ...['v', 'at', 'working_set', 'max', 'ceiling', 'source', 'partial', 'sessions', 'kinds', 'devteam', 'projects', 'n', 'rss'].map((f) => `\`${f}\``),
    ...KINDS.map((k) => `\`${k}\``),
    '`{"v":1,"readings":[', 'oldest first', '`?since=', '`?after=', '`?thin=0`', '24 hours', '8 days', '5 minutes', '6 hours',
    '30 minutes', '3 days', '400', 'loopback', '/instances.json'];
  for (const w of words) assert.ok(c.includes(w), `the contract comment holds ${w}`);
});
