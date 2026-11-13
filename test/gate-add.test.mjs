// Adding a gate is the supervisor's call (constitution.md §4, gate-add): a PR that only adds new
// gates after main's, leaving every one of main's byte-identical and in order, merges with no owner
// question, after the new gate passes at its head, and is logged as its own gate-add act. Anything
// else that changes settings.gates (an edit, a removal, a rename, a reorder, a repeated key) stays the
// owner's gate-change, decided from the trees whatever the log says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, write, line } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const SETTINGS = 'docs/devteam/project/settings.md';
const MAIN_GATES = { lint: 'true', test: { cmd: 'true', paths: ['src/**'] } };

// settings.md's json devteam block, rewritten: fn edits the parsed object; raw (optional) edits the
// text after, for what JSON.stringify can't write (a repeated key)
const editSettings = (dir, fn, raw = (t) => t) => {
  const f = path.join(dir, SETTINGS);
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  const j = JSON.parse(m[1]);
  fn(j);
  fs.writeFileSync(f, txt.replace(m[1], () => raw(JSON.stringify(j, null, 2))));
};

// main with two gates, one a string and one an object
function withGates(F) {
  editSettings(F.old, (j) => { j.gates = MAIN_GATES; });
  F.g(['commit', '-qam', 'gates'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
}

// A chore branch off origin/main whose settings edit is fn (and raw), pushed, with its PR body.
function chore(F, slug, fn, raw) {
  const { old, g } = F;
  const w = path.join(old, '.worktrees', `chore-${slug}`);
  g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
  editSettings(w, fn, raw);
  g(['add', '-A'], w);
  g(['commit', '-qm', slug], w);
  g(['push', '-q', 'origin', `chore-${slug}`], w);
  g(['worktree', 'remove', '--force', w], old);
  write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
}
const merge = (F, slug, ...extra) => { const r = F.run(F.old, ['merge', '--chore', slug, ...extra], SUP); return { status: r.status, text: `${r.out}\n${r.err}` }; };
const liveLog = (F) => { const d = path.join(F.old, 'docs/devteam/run/log'); return (fs.existsSync(d) ? fs.readdirSync(d) : []).filter((f) => f.endsWith('.jsonl')).flatMap((f) => fs.readFileSync(path.join(d, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))); };
const refused = (r, re) => { assert.notEqual(r.status, 0, r.text); assert.match(r.text, re); };

test('an added gate merges with no question, runs at the head first, and is logged as its own gate-add act', () => {
  const F = fleetFixture('gate-add-merges');
  try {
    withGates(F);
    chore(F, 'shellcheck', (j) => { j.gates.shellcheck = 'true'; });
    const r = merge(F, 'shellcheck');
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /adds gate shellcheck and leaves main's as they are/);
    assert.doesNotMatch(r.text, /changes owner settings/);
    const log = liveLog(F);
    const mergeAct = log.find((o) => o.type === 'act' && o.class === 'merge-chore' && o.refs?.includes('chore-shellcheck'));
    const add = log.find((o) => o.type === 'act' && o.class === 'gate-add');
    assert.ok(mergeAct && add, JSON.stringify(log.filter((o) => o.type === 'act')));
    assert.match(add.what, /^added gate shellcheck \("true"\) to settings\.gates by merging chore-shellcheck at [0-9a-f]{40}$/);
    assert.deepEqual(add.refs, ['chore-shellcheck', mergeAct.id]);
    assert.equal(add.approved_by, undefined);
    assert.ok(log.some((o) => o.type === 'gate' && o.gate === 'shellcheck' && o.ok), 'the new gate ran at the head');
    F.g(['fetch', '-q', 'origin'], F.old);
    const onMain = JSON.parse(F.g(['show', `origin/main:${SETTINGS}`], F.old).match(/```json devteam\s*\n([\s\S]*?)\n```/)[1]);
    assert.deepEqual(Object.keys(onMain.gates), ['lint', 'test', 'shellcheck']);
  } finally { F.done(); }
});

test('an edited, removed or renamed gate is refused without the owner, alone or beside an added one', () => {
  const F = fleetFixture('gate-add-refused');
  try {
    withGates(F);
    chore(F, 'edit', (j) => { j.gates.test.paths = ['src/**', 'lib/**']; });
    refused(merge(F, 'edit', '--dry-run'), /changes owner settings: gates \(gate-change: it changes test; only adding a gate is the supervisor's\)/);
    chore(F, 'loosen', (j) => { j.gates.test.mode = 'ratchet'; });
    refused(merge(F, 'loosen', '--dry-run'), /gates \(gate-change: it changes test/);
    chore(F, 'remove', (j) => { delete j.gates.lint; });
    refused(merge(F, 'remove', '--dry-run'), /gates \(gate-change: it removes lint/);
    chore(F, 'rename', (j) => { j.gates = { test: j.gates.test, eslint: 'true' }; });
    refused(merge(F, 'rename', '--dry-run'), /gates \(gate-change: it removes lint/);
    chore(F, 'add-and-edit', (j) => { j.gates.shellcheck = 'true'; j.gates.lint = 'exit 0'; });
    refused(merge(F, 'add-and-edit', '--dry-run'), /gates \(gate-change: it changes lint/);
    // the same entries, main's in another order, then the new one
    chore(F, 'reorder', (j) => { j.gates = { test: j.gates.test, lint: j.gates.lint, shellcheck: 'true' }; });
    refused(merge(F, 'reorder', '--dry-run'), /gates \(gate-change: it reorders the gates main has/);
    // the same value written with its fields in another order is not byte-identical
    chore(F, 'refield', (j) => { j.gates.test = { paths: ['src/**'], cmd: 'true' }; j.gates.shellcheck = 'true'; });
    refused(merge(F, 'refield', '--dry-run'), /gates \(gate-change: it changes test/);
    // nothing lands, and no gate-add act was written
    assert.ok(!liveLog(F).some((o) => o.class === 'gate-add'));
  } finally { F.done(); }
});

test('an added gate whose name repeats a key under gates is refused: JSON.parse would keep the last one unseen', () => {
  const F = fleetFixture('gate-add-dup');
  try {
    withGates(F);
    // a second "lint" after the new gate; its value is main's, so the parsed gates look like an addition
    chore(F, 'dup', (j) => { j.gates.shellcheck = 'true'; }, (t) => t.replace('"shellcheck": "true"', '"shellcheck": "true",\n    "lint": "true"'));
    refused(merge(F, 'dup', '--dry-run'), /gates \(gate-change: it repeats gates\.lint in settings\.md/);
    // a repeated key elsewhere in settings is not this rule's business; a repeated gates is
    chore(F, 'dup-gates', (j) => { j.gates.shellcheck = 'true'; }, (t) => t.replace(/\n}$/, `,\n  "gates": ${JSON.stringify({ ...MAIN_GATES, shellcheck: 'true' })}\n}`));
    refused(merge(F, 'dup-gates', '--dry-run'), /gates \(gate-change: it repeats gates in settings\.md/);
  } finally { F.done(); }
});

test('a new gate is a plain check: a known shape, a lowercase name, and it passes at the head unless in ratchet mode', () => {
  const F = fleetFixture('gate-add-shape');
  try {
    withGates(F);
    chore(F, 'numeric', (j) => { j.gates['1'] = 'true'; });
    refused(merge(F, 'numeric', '--dry-run'), /gate-change: (it reorders the gates main has|new gate "1": a new gate is a short lowercase name)/);
    chore(F, 'upper', (j) => { j.gates.Shellcheck = 'true'; });
    refused(merge(F, 'upper', '--dry-run'), /new gate "Shellcheck": a new gate is a short lowercase name/);
    chore(F, 'field', (j) => { j.gates.shellcheck = { cmd: 'true', env: { RAILS_ENV: 'production' } }; });
    refused(merge(F, 'field', '--dry-run'), /new gate "shellcheck": it sets env; a new gate the owner hasn't approved has only cmd, paths, junit, mode/);
    chore(F, 'junit', (j) => { j.gates.shellcheck = { cmd: 'true', junit: '../../secrets.xml' }; });
    refused(merge(F, 'junit', '--dry-run'), /junit is a path inside the checkout/);
    chore(F, 'newline', (j) => { j.gates.shellcheck = 'true\nrm -rf "$DEVTEAM_HOME"'; });
    refused(merge(F, 'newline', '--dry-run'), /cmd is one line of plain text/);
    chore(F, 'failing', (j) => { j.gates.shellcheck = 'false'; });
    refused(merge(F, 'failing', '--dry-run'), /the gate shellcheck this PR adds fails at [0-9a-f]{12}: fix it, or add it with "mode": "ratchet"/);
    chore(F, 'ratchet', (j) => { j.gates.shellcheck = { cmd: 'false', mode: 'ratchet', paths: ['**/*.sh'] }; });
    const r = merge(F, 'ratchet', '--dry-run');
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /adds gate shellcheck/);
  } finally { F.done(); }
});

test('a hand-written log line changes nothing: the check reads the trees', () => {
  const F = fleetFixture('gate-add-hand');
  try {
    withGates(F);
    chore(F, 'edit', (j) => { j.gates.shellcheck = 'true'; j.gates.lint = 'exit 0'; });
    // an act claiming the edit was a gate-add, and one claiming a gate-change, both by hand
    const at = new Date().toISOString();
    F.ok(F.old, ['act', '--class', 'gate-add', '--refs', 'chore-edit', '--', 'added gate shellcheck; lint is unchanged'], SUP);
    fs.mkdirSync(path.join(F.old, 'docs/devteam/run/log'), { recursive: true });
    fs.appendFileSync(path.join(F.old, 'docs/devteam/run/log', `supervisor-${at.slice(0, 7)}.jsonl`),
      line({ id: 'a-20990101-000000000-supervisor', op: 'new', at, by: 'supervisor', type: 'act', class: 'gate-add', what: 'added gate shellcheck; lint is unchanged', refs: ['chore-edit'], reversible: true })
      + line({ id: 'a-20990101-000000001-supervisor', op: 'new', at, by: 'supervisor', type: 'act', class: 'gate-change', what: 'the owner approved the lint change', refs: ['chore-edit'], reversible: true }));
    refused(merge(F, 'edit', '--dry-run'), /changes owner settings: gates \(gate-change: it changes lint/);
    // and an addition needs no line at all
    chore(F, 'add', (j) => { j.gates.shellcheck = 'true'; });
    const r = merge(F, 'add', '--dry-run');
    assert.equal(r.status, 0, r.text);
  } finally { F.done(); }
});

test('worktree_setup and worktree_files stay the owner\'s, even beside an added gate', () => {
  const F = fleetFixture('gate-add-setup');
  try {
    withGates(F);
    chore(F, 'setup', (j) => { j.gates.shellcheck = 'true'; j.worktree_setup = 'npm ci'; });
    refused(merge(F, 'setup', '--dry-run'), /changes owner settings: worktree_setup \(gate-change\)/);
    chore(F, 'files', (j) => { j.gates.shellcheck = 'true'; j.worktree_files = [...j.worktree_files, 'config/master.key']; });
    refused(merge(F, 'files', '--dry-run'), /changes owner settings: worktree_files \(gate-change\)/);
  } finally { F.done(); }
});
