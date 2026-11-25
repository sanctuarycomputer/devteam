// capacity.list (kit-839): each Claude account's numbers in accounts.json, by named field only. The
// functions are cut from devteam.mjs's source and run alone; accounts.rotation covers the tick itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checks, SCRIPT } from './fixtures/box-health/contract/check.mjs';
import fs from 'node:fs';

const src = fs.readFileSync(SCRIPT, 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `${a} … ${b} marks a block in devteam.mjs`); return src.slice(i, j); };
const capacityOf = new Function(`'use strict';\n${cut('const mainWindows = ', '// One switch, and what it said')}\nreturn capacityOf;`)();
const listed = (...rows) => JSON.parse(JSON.stringify(capacityOf(rows).list));
const one = (more = {}) => listed({ number: 3, email: 'mira@corp.test', usageStatus: 'ok', usage: { fiveHour: { pct: 20 }, sevenDay: { pct: 30 } }, ...more })[0];

const FIELDS = ['n', 'label', 'active', 'disabled', 'status', 'week_pct', 'week_resets_at', 'five_pct', 'five_resets_at', 'models_full', 'tier'];
const TOKEN = 'sk-ant-oat01-notarealtoken';
// every field cswap gives, and more: an address, a token-like value and an unknown key at each depth
const leaky = () => ({
  number: 7, alias: 'studio', email: 'mira@corp.test', active: true, disabled: false, usageStatus: 'ok',
  organizationName: "mira@corp.test's Organization", organizationUuid: 'org-uuid', accessToken: TOKEN, oauth: { token: TOKEN }, zz_unknown: 'zz-value',
  usage: {
    fiveHour: { pct: 12.5, resetsAt: '2026-11-25T09:00:00.123456+00:00', clock: 'zz-value', email: 'mira@corp.test', zz_unknown: 'zz-value' },
    sevenDay: { pct: 34, resetsAt: '2026-11-28T11:30:00+02:00', countdown: 'zz-value', token: TOKEN, projectedExhaustionAt: '2026-11-27T00:00:00Z' },
    scoped: [{ name: 'mira@corp.test', pct: 100, resetsAt: '2026-11-29T00:00:00Z', token: TOKEN, zz_unknown: 'zz-value' }, { name: 'zz-value', pct: 40, resetsAt: '2026-11-30T00:00:00Z' }],
    spend: { used: 1, currency: 'zz-value' }, zz_unknown: { zz_unknown: TOKEN },
  },
  plan: { tier: 'default_claude_max_20x', label: 'mira@corp.test', zz_unknown: TOKEN },
  lastGoodUsage: { sevenDay: { pct: 1, email: 'mira@corp.test' } },
});

test('a row keeps the named fields and nothing else', () => {
  const list = listed(leaky());
  assert.deepEqual(list, [{
    n: 7, label: 'studio', active: true, disabled: false, status: 'ok',
    week_pct: 34, week_resets_at: '2026-11-28T09:30:00.000Z', five_pct: 12.5, five_resets_at: '2026-11-25T09:00:00.123Z',
    models_full: [{ resets_at: '2026-11-29T00:00:00.000Z' }], tier: 20,
  }]);
  assert.deepEqual(Object.keys(list[0]), FIELDS);
});

test('an email, a token-like value and an unknown key leave nothing in the JSON', () => {
  // with no alias, or one that is an address, the label falls back to nothing else the row holds
  const answer = capacityOf(['studio', undefined, 'mira@corp.test'].map((alias) => ({ ...leaky(), alias })));
  assert.equal(answer.list?.length, 3, 'each row is listed');
  const said = JSON.stringify(answer);
  for (const x of ['@', 'mira', 'corp.test', 'sk-ant', 'zz_unknown', 'zz-value', 'org-uuid', 'notareal']) assert.ok(!said.includes(x), `${x} is in the answer`);
});

test('text in a field that is kept is kept only in its known form', () => {
  const bad = [TOKEN, 'mira@corp.test', 'two words', '', 7, null, { email: 'mira@corp.test' }];
  for (const v of bad) {
    const row = one({ usageStatus: v, active: v, plan: { tier: v }, usage: { fiveHour: { pct: v === 7 ? '7' : v, resetsAt: v }, sevenDay: { pct: v === 7 ? '7' : v, resetsAt: v }, scoped: [{ pct: 100, resetsAt: v }] } });
    assert.deepEqual(row, { n: 3, label: 'Account 3', active: false, disabled: false, models_full: [{}] }, JSON.stringify(v));
  }
  for (const t of ['2026-11-25T09:00:00Z (mira@corp.test)', '(mira@corp.test) 2026-11-25T09:00:00Z', '2026-11-25T09:00:00', 'Account 5']) assert.equal(one({ usage: { sevenDay: { pct: 1, resetsAt: t } } }).week_resets_at, undefined, `a time with more or less in it: ${t}`);
  assert.equal(one({ usage: { sevenDay: { pct: 1, resetsAt: '2026-99-25T09:00:00Z' } } }).week_resets_at, undefined, 'a time that is none');
  assert.equal(one({ usageStatus: 'x'.repeat(31) }).status, undefined, 'a word too long');
  for (const v of ['mira@corp.test', { 0: { pct: 100 } }, 7]) assert.deepEqual(one({ usage: { sevenDay: { pct: 1 }, scoped: v } }).models_full, [], 'scoped that is no list');
  assert.equal(one({ usage: 'mira@corp.test' }).five_pct, undefined, 'usage that is no object');
  assert.equal(listed({ number: 'mira@corp.test', usageStatus: 'ok' }, { usageStatus: 'ok' }, { number: 0 }, { number: 1.5 }).length, 0, 'no slot number, no row');
});

test('the label is the alias unless it is an address, else Account n', () => {
  assert.equal(one({ alias: 'studio' }).label, 'studio');
  assert.equal(one({ alias: ' studio two ' }).label, 'studio two');
  for (const alias of [undefined, null, '', '  ', 7, 'mira@corp.test', '@mira', 'mira＠corp.test', 'mira﹫corp.test', 'a\nb', 'a​b', 'x'.repeat(41)]) assert.equal(one({ alias }).label, 'Account 3', JSON.stringify(alias));
  assert.equal(one({ alias: 'x'.repeat(40) }).label, 'x'.repeat(40));
});

test('an absent five-hour window on status ok is 100 left; any other unread figure is left out', () => {
  const left = (r) => 100 - r.five_pct;
  assert.equal(left(one({ usage: { sevenDay: { pct: 30 } } })), 100);
  assert.equal(left(one({ usage: { fiveHour: null, sevenDay: { pct: 30 } } })), 100);
  assert.equal(left(one()), 80, 'a window that is there is its own');
  assert.equal(one({ usage: { fiveHour: { pct: null }, sevenDay: { pct: 30 } } }).five_pct, undefined, 'there, and not measured');
  assert.equal(one({ usageStatus: 'unavailable', usage: { sevenDay: { pct: 30 } } }).five_pct, undefined, 'not ok');
  assert.equal(one({ usage: null }).five_pct, undefined, 'no usage at all');
  for (const k of ['week_pct', 'five_pct']) assert.equal(one({ usageStatus: 'token_expired', usage: null, lastGoodUsage: { fiveHour: { pct: 40 }, sevenDay: { pct: 40 } } })[k], undefined, `the last good reading is not this one: ${k}`);
  assert.equal(one({ usage: { fiveHour: { pct: 120 }, sevenDay: { pct: -1 } } }).five_pct, 100);
  assert.equal(one({ usage: { sevenDay: { pct: -1 } } }).week_pct, 0);
});

test('a full model is its reset, a tier its multiplier, a disabled account marked; in cswap\'s order', () => {
  assert.deepEqual(one({ usage: { sevenDay: { pct: 1 }, scoped: [{ pct: 99 }, { pct: 100 }, null, { pct: 101, resetsAt: '2026-11-25T09:00:00Z' }] } }).models_full, [{}, { resets_at: '2026-11-25T09:00:00.000Z' }]);
  for (const [tier, x] of [['default_claude_max_20x', 20], ['default_claude_max_5x', 5], ['default_claude_ai', undefined], ['x_0x', undefined], ['x_1000x', undefined], ['20x', undefined], ['x_20x_mira', undefined]]) assert.equal(one({ plan: { tier } }).tier, x, tier);
  assert.deepEqual(listed({ number: 9, disabled: true }, { number: 2, disabled: false }).map((r) => [r.n, r.disabled]), [[9, true], [2, false]]);
});

test('every row of it fits box-health@1 as an account', () => {
  const { boxHealthProblem } = checks();
  const at = '2026-11-25T00:00:00Z';
  for (const r of listed(leaky(), { number: 2 }, { number: 3, alias: 'x@y', usageStatus: 'ok', usage: { sevenDay: { pct: 250 } } })) {
    const account = { n: r.n, label: r.label, active: r.active, status: r.status, week_left: r.week_pct === undefined ? undefined : 100 - r.week_pct, five_left: r.five_pct === undefined ? undefined : 100 - r.five_pct, week_resets_at: r.week_resets_at, five_resets_at: r.five_resets_at };
    assert.equal(boxHealthProblem(JSON.stringify({ v: 1, at, window_s: 3600, now: {}, samples: [], claude: { accounts: [account] } })), null);
  }
});

test('the fields capacityOf gave before are unchanged', () => {
  const OUT = '2026-11-16T05:00:00Z', RESET = '2026-11-16T21:00:00Z';
  const rows = [
    { number: 1, active: true, usageStatus: 'ok', usage: { fiveHour: { pct: 31.4 }, sevenDay: { pct: 9, projectedExhaustionAt: OUT, willLastToReset: false } } },
    { number: 2, usageStatus: 'ok', usage: { fiveHour: { pct: 10 }, sevenDay: { pct: 100, resetsAt: RESET } } },
    { number: 3, usageStatus: 'unavailable', usage: null },
    { number: 4, disabled: true, usageStatus: 'ok', usage: { sevenDay: { pct: 1 } } },
  ];
  const before = structuredClone(rows);
  const { list, ...rest } = capacityOf(rows);
  assert.deepEqual(rest, { accounts: 3, room: 1, unknown: 1, active_week_pct: 9, active_5h_pct: 31, runs_out_at: OUT, next_reset_at: RESET, gap: true });
  assert.equal(list.length, 4);
  assert.deepEqual(rows, before, 'the rows it was given are left as they were');
  assert.deepEqual(capacityOf([]), { accounts: 0, room: 0, unknown: 0, active_week_pct: null, active_5h_pct: null, runs_out_at: null, next_reset_at: null, gap: false, list: [] });
});


test('a per-model window is full only at a finite pct of 100 or more (kit-881)', () => {
  const full = (...pcts) => one({ usage: { sevenDay: { pct: 1 }, scoped: pcts.map((pct) => ({ pct, resetsAt: '2026-11-25T09:00:00Z' })) } }).models_full.length;
  for (const pct of ['100', '1e3', [100], [[100]], true, { valueOf: () => 100 }, NaN, Infinity, null, undefined]) assert.equal(full(pct), 0, `a pct of ${typeof pct} ${String(pct)} is not full`);
  assert.equal(full(100, 100.5, 99.99, 1e9), 3, 'a number of 100 or more is full, one under it is not');
});

test('no pct in any shape throws (kit-881)', () => {
  // valueOf and toString that are not functions, and an object with neither: >= on them throws
  const odd = [{ valueOf: 1, toString: 1 }, Object.create(null), { [Symbol.toPrimitive]: 1 }, Symbol('pct')];
  for (const pct of odd) {
    const row = { number: 3, usageStatus: 'unavailable', usage: { fiveHour: { pct }, sevenDay: { pct }, scoped: [{ pct }] } };
    assert.doesNotThrow(() => capacityOf([row]), String(typeof pct));
    assert.deepEqual(listed(row)[0].models_full, [], 'nor is it full');
  }
});

test('every time in the list is one box-health@1 takes, or is left out, at either edge of the years too (kit-881)', () => {
  const { memoryAtOk } = checks();
  const cases = [
    ['9999-12-31T23:59:59-01:00', undefined], ['9999-12-31T23:59:00-14:00', undefined],
    ['0000-01-01T00:00:00+01:00', undefined], ['0000-01-01T00:00:00+14:00', undefined],
    ['9999-12-31T22:59:59-01:00', '9999-12-31T23:59:59.000Z'], ['9999-12-31T23:59:59Z', '9999-12-31T23:59:59.000Z'],
    ['0000-01-01T00:00:00Z', '0000-01-01T00:00:00.000Z'], ['0000-01-01T00:00:00-01:00', '0000-01-01T01:00:00.000Z'],
  ];
  for (const [t, want] of cases) {
    const r = one({ usage: { fiveHour: { pct: 1, resetsAt: t }, sevenDay: { pct: 1, resetsAt: t }, scoped: [{ pct: 100, resetsAt: t }] } });
    for (const got of [r.week_resets_at, r.five_resets_at, r.models_full[0].resets_at]) {
      assert.equal(got, want, t);
      assert.ok(got === undefined || memoryAtOk(got), `${got} is a time box-health@1 takes`);
    }
  }
});

test('usage that is a list is read as no usage (kit-881)', () => {
  for (const usage of [[], [{ pct: 1 }]]) assert.deepEqual(one({ usage }), { n: 3, label: 'Account 3', active: false, disabled: false, status: 'ok', models_full: [] }, JSON.stringify(usage));
  assert.equal(one({ usage: {} }).five_pct, 0, 'an object with no five-hour window is still unused');
});
