// image-changes@1: what `devteam.mjs box-pins changed` prints and exits with, held in two places that
// must agree: test/contracts/image-changes.md, which states it, and test/fixtures/image-changes/, the
// recorded outputs a consumer vendors as its fake. checkRun is the reference checker: it refuses what a
// caller refuses (the document's §7), so each fixture passing it, and each mutant failing it, ties the
// fixtures to the rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const DOC = read('test', 'contracts', 'image-changes.md');
const FIX = path.join(root, 'test', 'fixtures', 'image-changes');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
const exitOf = (stem) => {
  const s = fixture(`${stem}.exit`);
  assert.match(s, /^\d+\n$/, `${stem}.exit is a code in decimal and a newline`);
  return Number(s);
};

const SMOKE_COMMANDS = ['machine status', 'machine status --questions', 'machine status --knowledge', 'recover --machine --dry-run --force'];
const SHA = /^[0-9a-f]{40}$/;
const fail = (rule, why) => { throw new Error(`${rule}: ${why}`); };

// §5's order: file, then part, by UTF-16 code units; a null part before any string.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byChange = (x, y) => cmp(x.file, y.file) || (x.part === y.part ? 0 : x.part === null ? -1 : y.part === null ? 1 : cmp(x.part, y.part));

// §3: the text form of a run, from its JSON.
function render(j) {
  const lines = j.changes.map((c) => `image: ${c.file}${c.part === null ? '' : `#${c.part}`}\n`);
  return lines.join('') + (j.kind === 'patch' ? 'kind: patch\n' : `kind: minor (${j.changes.length} changes the image runs)\n`);
}

// A run that exited 0 or 3: its JSON (§4, §5), its exit (§7) and, when given, its text (§3).
function checkRun({ exit, stdout, json }) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) fail('json', 'not an object');
  if (json.v !== 1) fail('v', `is ${JSON.stringify(json.v)}, not 1`);
  for (const k of ['since', 'to']) if (typeof json[k] !== 'string' || !SHA.test(json[k])) fail(k, `${JSON.stringify(json[k])} is not 40 lowercase hex`);
  if (json.kind !== 'patch' && json.kind !== 'minor') fail('kind', `${JSON.stringify(json.kind)} is neither patch nor minor`);
  if (!Array.isArray(json.changes)) fail('changes', 'not a list');
  const seen = new Map();
  for (const c of json.changes) {
    if (c === null || typeof c !== 'object' || Array.isArray(c)) fail('changes', `${JSON.stringify(c)} is not an object`);
    if (typeof c.file !== 'string' || !c.file || c.file.startsWith('/')) fail('changes', `file ${JSON.stringify(c.file)} is not a repo path or "(smoke)"`);
    if (!(c.part === null || (typeof c.part === 'string' && c.part))) fail('changes', `part ${JSON.stringify(c.part)} is neither null nor a name`);
    if (c.file === '(smoke)' && !SMOKE_COMMANDS.includes(c.part)) fail('changes', `a smoke change's part ${JSON.stringify(c.part)} is not one of the smoke commands`);
    const parts = seen.get(c.file) ?? [];
    if (parts.includes(c.part)) fail('changes', `${c.file} ${JSON.stringify(c.part)} appears twice`);
    if (parts.length && (c.part === null || parts.includes(null))) fail('changes', `${c.file} has both a whole-file change and a part`);
    seen.set(c.file, [...parts, c.part]);
  }
  for (let i = 1; i < json.changes.length; i++) if (byChange(json.changes[i - 1], json.changes[i]) > 0) fail('sorted', `change ${i} comes before change ${i - 1}`);
  if ((json.kind === 'patch') !== (json.changes.length === 0)) fail('kind', `${json.kind} with ${json.changes.length} changes`);
  const want = { patch: 0, minor: 3 }[json.kind];
  if (exit !== want) fail('exit', `${exit} with kind ${json.kind} (a caller refuses: ${json.kind} exits ${want})`);
  if (stdout !== undefined && stdout !== render(json)) fail('text', `${JSON.stringify(stdout)} is not ${JSON.stringify(render(json))}`);
}

// A run that couldn't tell, with its reason: §7's exit 2.
function checkCantTell({ exit, stderr }) {
  if (exit === 0 || exit === 3) fail('exit', `${exit} is a patch's or a minor's, not can't tell`);
  if (!stderr) fail('stderr', 'is empty: exit 2 says why');
  if (!stderr.split('\n')[0].startsWith('devteam: ')) fail('stderr', "its first line doesn't start 'devteam: '");
  if (/^kind:/m.test(stderr)) fail('stderr', 'has a kind: line');
}

const runOf = (stem) => ({ exit: exitOf(stem), stdout: fixture(`${stem}.txt`), json: JSON.parse(fixture(`${stem}.json`)) });

test('the document states the command, its forms and its exits', () => {
  const first = DOC.split('\n').find((l) => /^#/.test(l));
  assert.match(first, /^# .*image-changes@1\b/, 'the first heading names image-changes@1');
  for (const s of [
    'devteam.mjs box-pins changed --since <ref> [--to <ref>] [--smoke] [--json]',
    "in the kit's own checkout",
    'from a checkout at `--to`',
    '`--to` defaults to `HEAD`',
    '`image: <file>`',
    '`image: <file>#<part>`',
    '`kind: patch`',
    '`kind: minor (<n> changes the image runs)`',
    '{ "v": 1, "since": "<sha>", "to": "<sha>", "kind": "patch" | "minor", "changes": [{ "file": "<path>", "part": "<name>" | "(rest)" | null }] }',
    '`null` for a whole file',
    '`"(rest)"`',
    '`"(smoke)"`',
    'sorted by `file` and then `part`',
    'empty exactly when',
    '**0**',
    '**3**',
    '**2**',
    '**1**',
    '**A caller refuses**',
    '`patch` with 3, `minor` with 0',
  ]) assert.ok(DOC.includes(s), `the document says ${s}`);
});

test('the document states --smoke and the stamp rule', () => {
  for (const s of [
    ...SMOKE_COMMANDS.map((c) => `\`${c} --in <parent>\``),
    '`init`',
    '`git add -A` then `git commit -m fixture`',
    "`ask --question 'Smoke question?' --stake 1 --urgency 1`",
    "`knowledge add --owner --kind fact --statement 'Smoke fact.'`",
    'remove `docs/devteam/run/supervisor-up.json`',
    'the `--since` tree',
    'the `--to` tree',
    'its **own** kit',
    "**that fixture's** HOME",
    '`smoke-fixture`',
    'a HOME of its own',
    '`GIT_AUTHOR_NAME` and `GIT_COMMITTER_NAME` `devteam-smoke`',
    '`GIT_AUTHOR_EMAIL` and `GIT_COMMITTER_EMAIL` `devteam-smoke@example.invalid`',
    'its own tmux socket',
    '`DEVTEAM_HUB_PORT`',
    'every other `DEVTEAM_*` variable unset',
    "Only the fixture's own lines are compared",
    'never the machine-wide lines',
    '`<path>`',
    '`<name>`',
    '`<kit>`',
    '`<time>`',
    '`<id>`',
    'kit-672 implements',
    '`vX.Y.0` when Z > 0',
    'the tag itself when Z = 0',
    '`box-pins bump --release vX.Y.Z` refuses a tag with Z > 0',
  ]) assert.ok(DOC.includes(s), `the document says ${s}`);
});

test('the fixtures are the ones the contract names', () => {
  assert.deepEqual(fs.readdirSync(FIX).sort(), ['cant-tell.exit', 'cant-tell.txt', 'minor.exit', 'minor.json', 'minor.txt', 'patch.exit', 'patch.json', 'patch.txt']);
  assert.deepEqual([exitOf('patch'), exitOf('minor'), exitOf('cant-tell')], [0, 3, 2]);
  const { changes } = JSON.parse(fixture('minor.json'));
  const script = 'docs/devteam/scripts/devteam.mjs';
  assert.ok(changes.some((c) => c.file !== '(smoke)' && c.part === null), 'a whole file');
  assert.ok(changes.some((c) => c.file === script && c.part !== null && c.part !== '(rest)'), 'a devteam.mjs part');
  assert.ok(changes.some((c) => c.file === script && c.part === '(rest)'), 'the rest');
  assert.ok(changes.some((c) => c.file === '(smoke)'), 'a smoke difference');
});

test('every fixture passes the checker', () => {
  for (const stem of ['patch', 'minor']) checkRun(runOf(stem));
  checkCantTell({ exit: exitOf('cant-tell'), stderr: fixture('cant-tell.txt') });
});

test('the checker refuses what a caller refuses', () => {
  const minor = runOf('minor');
  const patch = runOf('patch');
  const withJson = (run, json, extra = {}) => ({ ...run, json, stdout: render(json), ...extra });
  // (a) a minor relabelled patch, with one change; its exit and text agree with the label
  const relabelled = { ...patch.json, kind: 'patch', changes: [{ file: 'cloud/gateway.mjs', part: null }] };
  assert.throws(() => checkRun(withJson(patch, relabelled, { exit: 0 })), { message: /^kind:/ });
  // (b) a patch whose exit says minor
  assert.throws(() => checkRun({ ...patch, exit: 3 }), { message: /^exit:/ });
  // (c) a minor's changes out of order
  const [c0, c1, ...rest] = minor.json.changes;
  assert.throws(() => checkRun(withJson(minor, { ...minor.json, changes: [c1, c0, ...rest] })), { message: /^sorted:/ });
  // (d) a since that isn't a full sha
  assert.throws(() => checkRun(withJson(minor, { ...minor.json, since: minor.json.since.slice(1) })), { message: /^since:/ });
  // (e) another version
  assert.throws(() => checkRun(withJson(minor, { ...minor.json, v: 2 })), { message: /^v:/ });
  // (f) text that isn't its JSON rendered
  assert.throws(() => checkRun({ ...minor, stdout: minor.stdout.replace('(4 changes', '(3 changes') }), { message: /^text:/ });
  // and a can't-tell that exits like a patch
  assert.throws(() => checkCantTell({ exit: 0, stderr: fixture('cant-tell.txt') }), { message: /^exit:/ });
});
