// The recurring contract (kit-161; design recurring-checks-and-chores-under-upkeep, C1, C2, C3, C5):
// RECURRING_ENTRY_SHAPE@1 in devteam.mjs and validate's check of settings.md's recurring block, the
// run records in log.schema.json, recurring-edit as an owner-only class, and the fixtures
// test/fixtures/recurring/{slots,peek,dashboard}.json@1 that kit-162 to kit-169 and kit-175 build
// against. devteam.mjs exports nothing, so its rules are tested through validate and log-check on a
// throwaway project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { kit, bareProject } from './lib/kit.mjs';
import { runNode } from './lib/cli.mjs';

const SRC = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
const bases = [];
process.on('exit', () => { if (!process.env.DEVTEAM_TEST_KEEP) for (const b of bases) fs.rmSync(b, { recursive: true, force: true }); });
// a commit needs an identity, which CI's runner may not have
const GIT_ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

// A project of its own, with a HOME of its own beside it.
function project(name = 'recur') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-recur-'));
  bases.push(base);
  fs.mkdirSync(path.join(base, 'home'));
  return bareProject(base, name);
}
const envFor = (dir) => ({ ...process.env, ...GIT_ID, HOME: path.join(path.dirname(dir), 'home') });
const cli = (dir, args) => { const r = runNode(path.join(dir, 'docs/devteam/scripts/devteam.mjs'), args, { cwd: dir, env: envFor(dir) }); return { status: r.status, out: `${r.stdout}${r.stderr}` }; };
const git = (dir, args) => execFileSync('git', args, { cwd: dir, env: envFor(dir), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const BLOCK = /```json devteam\s*\n([\s\S]*?)\n```/;
const settingsFile = (dir) => path.join(dir, 'docs/devteam/project/settings.md');
// settings.md's keys set as patch says (undefined removes one), the rest left as it is
function withSettings(dir, patch) {
  const f = settingsFile(dir);
  const text = fs.readFileSync(f, 'utf8');
  const o = JSON.parse(BLOCK.exec(text)[1]);
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete o[k]; else o[k] = v;
  fs.writeFileSync(f, text.replace(BLOCK, () => `\`\`\`json devteam\n${JSON.stringify(o, null, 2)}\n\`\`\``));
}
const withRecurring = (dir, block) => withSettings(dir, { recurring: block });
const validate = (dir) => cli(dir, ['validate']);
const recurringLines = (out) => out.split('\n').filter((l) => /settings recurring/.test(l));

// A valid entry of each kind, with extra over it (a field set to undefined is left out).
const check = (extra = {}) => ({ kind: 'check', title: 'T', what: 'W', every: '1d', run: 'npm test', ...extra });
const chore = (extra = {}) => ({ kind: 'chore', title: 'T', what: 'W', every: '1w', by: 'supervisor', prompt: 'Do it.', ...extra });
const WORKER = { by: 'worker', component: 'kit', touches: ['package.json'], done_when: ['the suite passes in CI'] };

let P = null;
const proj = () => (P ??= project());

test('validate accepts the design C1 examples', () => {
  const dir = proj();
  withRecurring(dir, {
    'ci-main': check({ every: '6h', fail: { exit: 'nonzero' }, timeout_s: 1800 }),
    'open-advisories': check({ every: '1d', at: '06:00', run: 'npm audit --json | node count.mjs', fail: { last_line: { above: 0 } }, fail_after: 2, severity: 3 }),
    'tidy-branches': chore({ every: '1w', on: 'mon', at: '09:00' }),
    'review-docs': chore({ every: '2w', on: 'mon' }),
    'monthly-report': chore({ every: '1mo', on: 1, grace_days: 2 }),
    'deps-bump': chore({ every: '1mo', at: '03:00', ...WORKER }),
    'low-coverage': check({ every: '1w', fail: { last_line: { below: 0 } } }),
    'release-notes': check({ fail: { last_line: { is_not: 'ok' } } }),
    'monthly-at': chore({ every: '1mo', at: '03:00' }),
    health: check({ run: 'curl -s https://example.com/health && ping -c1 10.0.0.1' }),
    'api-bearer': check({ run: 'curl -H "Authorization: Bearer $TOKEN" https://example.com/api' }),
    'gh-runs': check({ run: 'GITHUB_TOKEN=${GH_TOKEN} gh run list' }),
    'multi-line-prompt': chore({ prompt: 'Look at the branches.\n\tDelete the merged ones.' }),
    'quarterly-hours': check({ every: '2160h' }),
    'by-author': check({ run: 'git log --since=yesterday --author=bot@example.com' }),
    'quick-check': check({ timeout_s: 1, fail_after: 10, severity: 1 }),
    'worker-grace': chore({ ...WORKER, grace_days: 30 }),
    'is-not-200': check({ fail: { last_line: { is_not: 'x'.repeat(200) } } }),
    'below-fraction': check({ fail: { last_line: { below: 0.5 } } }),
    'monthly-28': chore({ every: '3mo', on: 28 }),
    'sunday-late': chore({ every: '12w', on: 'sun', at: '23:59' }),
  });
  const r = validate(dir);
  assert.deepEqual(recurringLines(r.out), [], r.out);
  assert.equal(r.status, 0, r.out);
});

// [name, entry, the line validate prints for it]; each case is its own validate run, so one case's
// error can't stand in for another's
const LONG = 'a' + 'b'.repeat(40);
const REFUSED = [
  ['half-hourly', check({ every: '30m' }), 'every'],
  ['twice-daily', chore({ every: '12h' }), 'every'],
  ['days-91', check({ every: '91d' }), 'every'],
  ['weeks-13', check({ every: '13w' }), 'every'],
  ['months-4', check({ every: '4mo' }), 'every'],
  ['zero-days', check({ every: '0d' }), 'every'],
  ['padded-days', check({ every: '01d' }), 'every'],
  ['day-29', chore({ every: '1mo', on: 29 }), 'on'],
  ['day-as-text', chore({ every: '1mo', on: '1' }), 'on'],
  ['daily-on', chore({ every: '1d', on: 'mon' }), 'on'],
  ['weekly-monday', chore({ every: '1w', on: 'monday' }), 'on'],
  ['weekly-number', chore({ every: '1w', on: 1 }), 'on'],
  ['hourly-at', check({ every: '6h', at: '09:00' }), 'at'],
  ['short-at', check({ at: '9:00' }), 'at'],
  ['midnight-24', check({ at: '24:00' }), 'at'],
  ['long-run', check({ run: 'x'.repeat(501) }), 'run'],
  ['two-line-run', check({ run: 'npm test\nrm -rf /' }), 'run'],
  ['run-userinfo', check({ run: 'curl "https://u:p@h/x"' }), 'run'],
  ['run-query-token', check({ run: 'curl "https://h/x?token=y"' }), 'run'],
  ['run-url-option', check({ run: 'x --url=https://user:pw@host/x' }), 'run'],
  ['run-ghp', check({ run: `gh api -H "Authorization: token ghp_${'A'.repeat(36)}"` }), 'run'],
  ['run-token-literal', check({ run: 'TOKEN=abc123secret make check' }), 'run'],
  ['run-fallback-secret', check({ run: 'API_KEY=${X:-abc123secret} cmd' }), 'run'],
  ['run-bearer-fallback', check({ run: 'curl -H "Authorization: Bearer ${TOKEN:-abc123secretvalue}" https://example.com' }), 'run'],
  ['run-suffix-secret', check({ run: 'TOKEN=${X}abc123secret cmd' }), 'run'],
  ['run-typed-marker', check({ run: 'echo [credentials]; curl --url=https://user:pw@host/x' }), 'run'],
  // what only the per-word credential check refuses (the scrubber leaves each as it is)
  ['run-quoted-sig', check({ run: 'curl "https://h/x?sig=abc"' }), 'run'],
  ['run-key-param', check({ run: 'curl https://h/x?key=abc' }), 'run'],
  ['run-user-only', check({ run: 'git clone https://alice@host/x' }), 'run'],
  ['run-scp-password', check({ run: 'git clone user:pass@host:repo' }), 'run'],
  ['no-run', check({ run: undefined }), 'run'],
  ['hours-2161', check({ every: '2161h' }), 'every'],
  ['hourly-on', check({ every: '6h', on: 'mon' }), 'on'],
  ['timeout-zero', check({ timeout_s: 0 }), 'timeout_s'],
  ['timeout-text', check({ timeout_s: '120' }), 'timeout_s'],
  ['grace-zero', chore({ grace_days: 0 }), 'grace_days'],
  ['is-not-201', check({ fail: { last_line: { is_not: 'x'.repeat(201) } } }), 'fail'],
  ['is-not-empty', check({ fail: { last_line: { is_not: '' } } }), 'fail'],
  ['above-text', check({ fail: { last_line: { above: '3' } } }), 'fail'],
  ['below-null', check({ fail: { last_line: { below: null } } }), 'fail'],
  ['bell-prompt', chore({ prompt: 'ring \u0007 me' }), 'prompt'],
  ['bidi-title', check({ title: 'safe ‮ text' }), 'title'],
  ['two-line-what', check({ what: 'one\ntwo' }), 'what'],
  ['timeout-long', check({ timeout_s: 1801 }), 'timeout_s'],
  ['fail-two-rules', check({ fail: { last_line: { above: 3, below: 9 } } }), 'fail'],
  ['fail-zero', check({ fail: { exit: 'zero' } }), 'fail'],
  ['fail-both', check({ fail: { exit: 'nonzero', last_line: { above: 1 } } }), 'fail'],
  ['fail-after-11', check({ fail_after: 11 }), 'fail_after'],
  ['severity-4', check({ severity: 4 }), 'severity'],
  ['check-with-by', check({ by: 'supervisor' }), 'by'],
  ['chore-with-run', chore({ run: 'npm test' }), 'run'],
  ['chore-no-by', chore({ by: undefined }), 'by'],
  ['chore-no-prompt', chore({ prompt: undefined }), 'prompt'],
  ['long-prompt', chore({ prompt: 'x'.repeat(2001) }), 'prompt'],
  ['worker-no-touches', chore({ ...WORKER, touches: undefined }), 'touches'],
  ['worker-empty-touches', chore({ ...WORKER, touches: [] }), 'touches'],
  ['worker-short-done', chore({ ...WORKER, done_when: ['ok'] }), 'done_when'],
  ['supervisor-touches', chore({ touches: ['x'] }), 'touches'],
  ['grace-31', chore({ grace_days: 31 }), 'grace_days'],
  ['long-title', check({ title: 'x'.repeat(81) }), 'title'],
  ['long-what', check({ what: 'x'.repeat(161) }), 'what'],
  ['unknown-field', check({ owner: 'me' }), 'owner'],
  ['no-kind', check({ kind: 'job' }), 'kind'],
  ['Nightly', check(), null],
  ['nightly-', check(), null],
  ['a--b', check(), null],
  ['a', check(), null],
  [LONG, check(), null],
  ['x', null, null],
  ['y', 'npm test', null],
];

test('validate refuses each case, naming the entry and field', () => {
  const dir = proj();
  assert.equal(LONG.length, 41);
  for (const [name, entry, field] of REFUSED) {
    withRecurring(dir, { 'fine-one': check(), [name]: entry });
    const r = validate(dir);
    const want = `error: settings recurring.${name}${field ? `.${field}` : ''}: `;
    assert.equal(r.status, 1, `${name}: ${r.out}`);
    assert.ok(r.out.split('\n').some((l) => l.startsWith(want)), `${name}: no line starting ${JSON.stringify(want)} in\n${r.out}`);
    assert.ok(!r.out.includes('settings recurring.fine-one'), `${name}: the valid entry beside it is named\n${r.out}`);
  }
  for (const block of [[], 'x', 3, null]) {
    withRecurring(dir, block);
    const r = validate(dir);
    assert.equal(r.status, 1, `${JSON.stringify(block)}: ${r.out}`);
    assert.ok(r.out.split('\n').some((l) => l.startsWith('error: settings recurring: ')), `${JSON.stringify(block)}: ${r.out}`);
  }
  withRecurring(dir, undefined);
  assert.equal(validate(dir).status, 0, 'no recurring key: nothing to check');
});

test('a run the owner\'s own scrub patterns would hide is refused, whatever their marker', () => {
  const dir = project('recur-scrub');
  withSettings(dir, {
    sensor_scrub: [{ pattern: 'ACME-[0-9a-z]{8}', as: '[ACME]' }, { pattern: 'ZED-[0-9]{4}', as: '[acme_id]' }, { pattern: 'QQ-[0-9]{4}', as: 'HIDDEN' }, 'PLAIN-[0-9]{4}'],
    recurring: { 'safe-one': check({ run: 'curl https://example.com/ACME' }) },
  });
  assert.equal(validate(dir).status, 0, 'a run with no match passes');
  for (const [name, run] of [['acme', 'tool --id ACME-1234abcd'], ['zed', 'tool --id ZED-1234'], ['qq', 'tool --id QQ-1234'], ['plain', 'tool --id PLAIN-1234']]) {
    withSettings(dir, { recurring: { [name]: check({ run }) } });
    const r = validate(dir);
    assert.equal(r.status, 1, `${name}: ${r.out}`);
    assert.match(r.out, new RegExp(`^error: settings recurring\\.${name}\\.run: `, 'm'), name);
  }
});

test('validate checks this checkout\'s recurring block, whatever main has', () => {
  const dir = project('recur-main');
  withRecurring(dir, { 'ci-main': check() });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'a job on main']);
  assert.equal(validate(dir).status, 0);
  withRecurring(dir, { 'ci-main': check({ every: '30m' }) });
  const r = validate(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /^error: settings recurring\.ci-main\.every: /m);
});

test('the shape is a constant in devteam.mjs, with no new schema file', () => {
  const at = SRC.indexOf('\nconst RECURRING_ENTRY_SHAPE = Object.freeze({');
  assert.ok(at > 0, 'RECURRING_ENTRY_SHAPE is a frozen constant');
  assert.match(SRC.slice(at, at + 400), /\n {2}version: 1,/);
  assert.match(SRC, /\nfunction recurringEntryProblems\(name, entry\) \{/);
  assert.deepEqual(fs.readdirSync(path.join(kit, 'schema')).filter((f) => f.startsWith('recurring')), []);
});

// ===== C2, C3: the run records, the reopen line, recurring-edit =====
const SCHEMA = JSON.parse(fs.readFileSync(path.join(kit, 'schema/log.schema.json'), 'utf8'));
const OBS = SCHEMA.$defs.types.observation;
// One hand-written observation line, as its writer's kit would append it: ids from a clock that
// moves a millisecond per line, so no two repeat; an owner's line says where it was typed (cli); a
// ticket session writes its own file, <ticket-id>.jsonl.
let clock = Date.parse('2026-11-16T09:00:00.000Z');
function logLine(dir, writer, body) {
  const at = new Date((clock += 1)).toISOString();
  const d = at.replace(/[-:TZ.]/g, '');
  const file = ['supervisor', 'owner'].includes(writer) ? `${writer}-${at.slice(0, 7)}` : writer;
  const line = { v: 1, id: `o-${d.slice(0, 8)}-${d.slice(8, 17)}-${writer}`, type: 'observation', op: 'new', at, by: writer, ...(writer === 'owner' ? { channel: 'cli' } : {}), ...body };
  const f = path.join(dir, 'docs/devteam/run/log', `${file}.jsonl`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.appendFileSync(f, `${JSON.stringify(line)}\n`);
}
const logCheck = (dir) => cli(dir, ['log-check']);
const SLOT = '2026-11-16T09:00:00Z';
const runLine = (status, run = {}) => ({
  kind: 'recurring-run', subject: 'recurring:ci-main', source: 'recurring', detector: 'recurring', detail: `ci-main: ${status}`,
  run: { status, slot: SLOT, ...(['pass', 'fail', 'error'].includes(status) ? { sha: 'a'.repeat(40), seconds: 12.5, exit: status === 'pass' ? 0 : 1, value: null, excerpt: 'tests 3, pass 3' } : { ref: 'chore-recurring-tidy-branches-20261116' }), ...run },
});

test('a recurring-run line of each status passes log-check, an unknown one does not', () => {
  const dir = project('recur-log');
  for (const s of ['pass', 'fail', 'error', 'started', 'nothing', 'abandoned']) logLine(dir, 'supervisor', runLine(s));
  logLine(dir, 'supervisor', runLine('fail', { value: 7, exit: 0 }));
  // the schema doesn't say who counts (C2: the readers take only the supervisor's detector lines),
  // so a ticket session's line is valid too, and kit-163 may not lean on the schema to refuse it
  logLine(dir, 'kit-01-probe', runLine('pass'));
  const ok = logCheck(dir);
  assert.equal(ok.status, 0, ok.out);
  assert.doesNotMatch(ok.out, /observation\.run/, 'run is a field this kit knows');

  const bad = project('recur-log-bad');
  logLine(bad, 'supervisor', runLine('skipped'));
  logLine(bad, 'supervisor', { ...runLine('pass'), run: { status: 'pass' } });
  logLine(bad, 'supervisor', runLine('pass', { sha: 'main' }));
  logLine(bad, 'supervisor', runLine('pass', { excerpt: 'x'.repeat(201) }));
  logLine(bad, 'supervisor', runLine('pass', { output: 'everything it printed' }));
  const r = logCheck(bad);
  assert.notEqual(r.status, 0, r.out);
  assert.match(r.out, /run\.status must be one of pass, fail, error, started, nothing, abandoned/);
  assert.match(r.out, /run\.slot is required/);
  assert.match(r.out, /run\.sha "main" does not match/);
  assert.match(r.out, /run\.excerpt must be at most 200 characters/);
  assert.match(r.out, /run\.output is not a field here/);
});

test('the owner\'s reopen line passes, and only the owner\'s counts', () => {
  const dir = project('recur-reopen');
  logLine(dir, 'owner', { kind: 'recurring-reopen', subject: 'recurring:ci-main', source: 'owner', detail: 'reopened ci-main' });
  const r = logCheck(dir);
  assert.equal(r.status, 0, r.out);
  const kinds = OBS.properties.kind.description;
  assert.match(kinds, /recurring-reopen/);
  assert.match(kinds, /counts only when the owner wrote it/);
  assert.match(kinds, /lifts only declines made before it/);
  for (const k of ['recurring-run', 'recurring-failed', 'recurring-recovered']) assert.match(kinds, new RegExp(k));
  assert.match(OBS.properties.run.description, /detector "recurring"/);
  assert.match(OBS.properties.run.description, /one result per slot/i);
});

test('question.change names a recurring-edit change', () => {
  const change = SCHEMA.$defs.types.question.properties.change;
  assert.match(change.description, /recurring-edit/);
  assert.match(change.description, /\{ "<name>": <entry> \| null/);
  assert.equal(change.properties.recurring.type, 'object');
  assert.match(change.properties.recurring.description, /RECURRING_ENTRY_SHAPE/);
  const stages = SCHEMA['x-ooda'].stages.observation.kind;
  assert.equal(stages['recurring-run'], 'measurement');
  assert.equal(stages['recurring-reopen'], 'decide');
});

test('recurring-edit is owner-only, on no ladder and in no standing rule', () => {
  const text = fs.readFileSync(path.join(kit, 'governance/constitution.md'), 'utf8');
  const L = JSON.parse(BLOCK.exec(text)[1]);
  assert.ok(L.owner_only.includes('recurring-edit'), 'owner_only');
  assert.ok(!Object.keys(L.classes).includes('recurring-edit'), 'not on the ladder');
  assert.ok(!L.constitutional.includes('recurring-edit'), 'not the supervisor\'s own');
  assert.ok(!(L.owner_rules ?? []).includes('recurring-edit'), 'no standing rule approves it');
  const s2 = text.slice(text.indexOf('\n## 2.'), text.indexOf('\n## 3.')).replace(BLOCK, '');
  const said = s2.split(/(?<=\.)\s/).find((x) => x.includes('`recurring-edit`')) ?? '';
  assert.match(said, /adding, changing or removing/);
  assert.match(said, /owner_only/);
  const words = /\n {2}'recurring-edit': '([^']+)',\n/.exec(SRC.slice(SRC.indexOf('const CLASS_WORDS = Object.freeze({')))?.[1];
  assert.ok(words, 'CLASS_WORDS names recurring-edit');
  assert.doesNotMatch(words, /recurring-edit|owner_only/, 'its words carry no class id');
});
