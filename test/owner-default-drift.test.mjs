// An owner setting's default can't change under an instance without the owner's answer (kit-978).
// settings.md may leave an owner key unset; the instance then runs the kit's default. A sync PR
// that brings a kit whose SETTINGS_DEFAULTS gives that key another default changes what the
// instance runs, so merge classes it as a change to that owner setting: refused without an
// answered question of its class, naming the key, the old default and the new one. A sync that
// moves no owner default merges as it does today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fleetFixture, write } from './lib/kit.mjs';
import { runNode } from './lib/cli.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const SETTINGS = 'docs/devteam/project/settings.md';
const SCRIPT = 'docs/devteam/scripts/devteam.mjs';

const editSettings = (dir, fn) => {
  const f = path.join(dir, SETTINGS);
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  const j = JSON.parse(m[1]);
  fn(j);
  fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
};
const onMain = (F, fn) => {
  editSettings(F.old, fn);
  F.g(['commit', '-qam', 'settings on main'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
};
// one line of the kit script swapped for another; throws when the line isn't there, so a test
// never passes on a kit that no longer has the default it means to move
const swap = (text, from, to) => { assert.ok(text.includes(from), `the kit has ${from.trim()}`); return text.replace(from, () => to); };

// A chore branch off origin/main (or from) with this edit to the working copy, pushed, with its PR body.
function chore(F, slug, edit, from = 'origin/main') {
  const { old, g } = F;
  const w = path.join(old, '.worktrees', `chore-${slug}`);
  g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, from], old);
  edit(w);
  g(['add', '-A'], w);
  g(['commit', '-qm', slug], w);
  g(['push', '-q', 'origin', `chore-${slug}`], w);
  g(['worktree', 'remove', '--force', w], old);
  write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
}
const merge = (F, slug, ...extra) => { const r = F.run(F.old, ['merge', '--chore', slug, '--dry-run', ...extra], SUP); return { status: r.status, text: `${r.out}\n${r.err}` }; };
const ask = (F, cls) => { const q = F.ok(F.old, ['ask', '--question', 'Take the new default?', '--recommendation', 'yes', '--class', cls, '--reasons', 'owner-only'], SUP); F.ok(F.old, ['answer', q, 'yes']); return q; };
const kitEdit = (...pairs) => (w) => { const f = path.join(w, SCRIPT); let s = fs.readFileSync(f, 'utf8'); for (let i = 0; i < pairs.length; i += 2) s = swap(s, pairs[i], pairs[i + 1]); fs.writeFileSync(f, s); };
// SETTINGS_DEFAULTS moved out of the script into scripts/lib/settings.mjs as `export const`, as the
// cutover's modules hold their declarations (cli-modules@1), with this edit to the moved text
const toModule = (edit = (s) => s) => (w) => {
  const f = path.join(w, SCRIPT);
  const s = fs.readFileSync(f, 'utf8');
  const at = s.indexOf('\nconst SETTINGS_DEFAULTS = {\n');
  const end = s.indexOf('\n};\n', at);
  assert.ok(at > 0 && end > at, 'the kit declares SETTINGS_DEFAULTS');
  write(path.join(w, 'docs/devteam/scripts/lib/settings.mjs'), `export ${edit(s.slice(at + 1, end + 3))}\n`);
  fs.writeFileSync(f, `${s.slice(0, at)}\n// SETTINGS_DEFAULTS is in lib/settings.mjs${s.slice(end + 3)}`);
};

// An upstream whose releases are this kit: v0.2.0 as the instance has it, v0.2.1 moving a default
// the supervisor owns (stale_after_minutes), v0.3.0 also moving the owner's alpha. main is on
// v0.2.0, under upstream_sync "adopt", the setting init writes.
function upstream(F) {
  const up = path.join(F.base, 'upstream');
  const g = (args) => F.g(args, up);
  fs.mkdirSync(up);
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  const kit = path.join(F.old, 'docs/devteam');
  fs.cpSync(kit, path.join(up, 'docs/devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  g(['add', '-A']);
  g(['commit', '-qm', 'the release this instance is on']);
  g(['tag', 'v0.2.0']);
  const script = path.join(up, SCRIPT);
  fs.writeFileSync(script, swap(fs.readFileSync(script, 'utf8'), '\n  stale_after_minutes: 30,\n', '\n  stale_after_minutes: 31,\n'));
  g(['commit', '-qam', 'a supervisor default moves']);
  g(['tag', 'v0.2.1']);
  fs.writeFileSync(script, swap(fs.readFileSync(script, 'utf8'), '\n  alpha: true,\n', '\n  alpha: false,\n'));
  g(['commit', '-qam', 'an owner default moves']);
  g(['tag', 'v0.3.0']);
  onMain(F, (j) => { j.upstream_repo = up; j.upstream_base = 'v0.2.0'; j.upstream_sync = 'adopt'; delete j.alpha; });
  // a sync PR: the kit files of this tag, verbatim, and upstream_base set to it
  return (tag) => chore(F, `devteam-sync-${tag}`, (w) => {
    fs.writeFileSync(path.join(w, SCRIPT), execFileSync('git', ['show', `${tag}:${SCRIPT}`], { cwd: up, maxBuffer: 64 * 1024 * 1024 }));
    editSettings(w, (j) => { j.upstream_base = tag; });
  });
}

test('a sync that moves an unset owner key\'s default is refused without a governance-edit answer, naming the key and both defaults', () => {
  const F = fleetFixture('drift-adopt');
  try {
    const sync = upstream(F);
    sync('v0.3.0');
    const none = merge(F, 'devteam-sync-v0.3.0');
    assert.notEqual(none.status, 0, `refused without --approved, even under "adopt": ${none.text}`);
    assert.match(none.text, /changes owner settings: alpha's default changes from true to false, and settings\.md leaves it unset/);
    const gc = merge(F, 'devteam-sync-v0.3.0', '--approved', ask(F, 'gate-change'));
    assert.notEqual(gc.status, 0, 'a gate-change answer (enough for kit files) does not approve the owner default');
    assert.match(gc.text, /changing alpha's default changes from true to false, and settings\.md leaves it unset \(\S+\) needs an answered/);
    const ok = merge(F, 'devteam-sync-v0.3.0', '--approved', ask(F, 'governance-edit'));
    assert.equal(ok.status, 0, ok.text);
  } finally { F.done(); }
});

test('a sync that moves no owner default merges as today, under "adopt" with no answer', () => {
  const F = fleetFixture('drift-none');
  try {
    const sync = upstream(F);
    sync('v0.2.1');
    const r = merge(F, 'devteam-sync-v0.2.1');
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /approved by settings\.upstream_sync "adopt"/);
    assert.doesNotMatch(r.text, /owner settings/);
  } finally { F.done(); }
});

test('an owner key settings.md sets keeps its value: the same sync merges under "adopt"', () => {
  const F = fleetFixture('drift-set');
  try {
    const sync = upstream(F);
    onMain(F, (j) => { j.alpha = true; });
    sync('v0.3.0');
    const r = merge(F, 'devteam-sync-v0.3.0');
    assert.equal(r.status, 0, r.text);
    assert.doesNotMatch(r.text, /owner settings/);
  } finally { F.done(); }
});

test('a kit whose owner defaults do not read as literals is refused without a governance-edit answer, fail closed', () => {
  const F = fleetFixture('drift-unread');
  try {
    chore(F, 'kit-unread', kitEdit('\n  alpha: true,\n', '\n  alpha: process.env.X === \'1\',\n'));
    const r = merge(F, 'kit-unread', '--approved', ask(F, 'gate-change'));
    assert.notEqual(r.status, 0, `refused: ${r.text}`);
    assert.match(r.text, /SETTINGS_DEFAULTS in docs\/devteam\/scripts\/ does not read at the head/);
    const ok = merge(F, 'kit-unread', '--approved', ask(F, 'governance-edit'));
    assert.equal(ok.status, 0, ok.text);
  } finally { F.done(); }
});

test('a kit change that gives an owner key a default it had none of is the owner\'s too', () => {
  const F = fleetFixture('drift-new');
  try {
    chore(F, 'kit-newdefault', kitEdit('\n  alpha: true,\n', '\n  alpha: true,\n  responder_command: \'x\',\n'));
    const r = merge(F, 'kit-newdefault', '--approved', ask(F, 'gate-change'));
    assert.notEqual(r.status, 0, `refused: ${r.text}`);
    assert.match(r.text, /responder_command's default changes from none to "x", and settings\.md leaves it unset/);
  } finally { F.done(); }
});

test('the head kit\'s OWNER_SETTINGS counts: a key it makes the owner\'s, with a moved default, is refused', () => {
  const F = fleetFixture('drift-head-owner');
  try {
    chore(F, 'kit-headowner', kitEdit('\nconst OWNER_SETTINGS = {\n', '\nconst OWNER_SETTINGS = {\n  stale_after_minutes: \'governance-edit\',\n', '\n  stale_after_minutes: 30,\n', '\n  stale_after_minutes: 31,\n'));
    const r = merge(F, 'kit-headowner', '--approved', ask(F, 'gate-change'));
    assert.notEqual(r.status, 0, `refused: ${r.text}`);
    assert.match(r.text, /stale_after_minutes's default changes from 30 to 31, and settings\.md leaves it unset/);
  } finally { F.done(); }
});

test('the base side is the base commit\'s kit, not the running one: a branch from before main moved a default changes nothing', () => {
  const F = fleetFixture('drift-base');
  const { old, g } = F;
  try {
    const before = g(['rev-parse', 'HEAD'], old);
    // main moves alpha's default (the running kit is now this one)
    const f = path.join(old, SCRIPT);
    fs.writeFileSync(f, swap(fs.readFileSync(f, 'utf8'), '\n  alpha: true,\n', '\n  alpha: false,\n'));
    g(['commit', '-qam', 'main moves a default'], old);
    g(['push', '-q', 'origin', 'main'], old);
    // a branch cut before that, changing only a comment in the script
    chore(F, 'kit-older', (w) => fs.appendFileSync(path.join(w, SCRIPT), '\n// a note\n'), before);
    const r = merge(F, 'kit-older', '--approved', ask(F, 'gate-change'));
    assert.equal(r.status, 0, r.text);
    assert.doesNotMatch(r.text, /owner settings/);
  } finally { F.done(); }
});

test('a head OWNER_SETTINGS that does not read as literal data is refused without a governance-edit answer', () => {
  const F = fleetFixture('drift-owner-unread');
  try {
    chore(F, 'kit-ownerunread', kitEdit('\nconst OWNER_SETTINGS = {\n', '\nconst OWNER_SETTINGS = { ...{},\n'));
    const r = merge(F, 'kit-ownerunread', '--approved', ask(F, 'gate-change'));
    assert.notEqual(r.status, 0, `refused: ${r.text}`);
    assert.match(r.text, /OWNER_SETTINGS in docs\/devteam\/scripts\/ does not read at the head/);
  } finally { F.done(); }
});

test('defaults moved into a module as export const are read there: the move alone changes nothing, a moved default is refused', () => {
  const F = fleetFixture('drift-module');
  try {
    const gc = ask(F, 'gate-change');
    chore(F, 'kit-module', toModule());
    const moved = merge(F, 'kit-module', '--approved', gc);
    assert.equal(moved.status, 0, moved.text);
    assert.doesNotMatch(moved.text, /owner settings/);
    chore(F, 'kit-module-alpha', toModule((s) => swap(s, '\n  alpha: true,\n', '\n  alpha: false,\n')));
    const r = merge(F, 'kit-module-alpha', '--approved', gc);
    assert.notEqual(r.status, 0, `refused: ${r.text}`);
    assert.match(r.text, /alpha's default changes from true to false, and settings\.md leaves it unset/);
  } finally { F.done(); }
});

test('a kit script that assigns into SETTINGS_DEFAULTS is unreadable: refused without a governance-edit answer', () => {
  const F = fleetFixture('drift-assign');
  try {
    chore(F, 'kit-assign', (w) => fs.appendFileSync(path.join(w, SCRIPT), '\nSETTINGS_DEFAULTS.alpha = false;\n'));
    const r = merge(F, 'kit-assign', '--approved', ask(F, 'gate-change'));
    assert.notEqual(r.status, 0, `refused: ${r.text}`);
    assert.match(r.text, /SETTINGS_DEFAULTS in docs\/devteam\/scripts\/ does not read at the head/);
  } finally { F.done(); }
});

test('merge run from a subdirectory of the checkout reads the kit from the repo\'s top: the same sync is refused', () => {
  const F = fleetFixture('drift-subdir');
  try {
    const sync = upstream(F);
    sync('v0.3.0');
    const sub = path.join(F.old, 'docs');
    const r = runNode(path.join(F.old, SCRIPT), ['merge', '--chore', 'devteam-sync-v0.3.0', '--dry-run'], { cwd: sub, env: F.env(SUP) });
    const text = `${r.stdout}\n${r.stderr}`;
    assert.notEqual(r.status, 0, `refused from ${sub}: ${text}`);
    assert.match(text, /alpha's default changes from true to false, and settings\.md leaves it unset/);
  } finally { F.done(); }
});

test('a compound assignment into SETTINGS_DEFAULTS is a write; a comment that names one is not', () => {
  const F = fleetFixture('drift-writes');
  try {
    const gc = ask(F, 'gate-change');
    chore(F, 'kit-qq', (w) => fs.appendFileSync(path.join(w, SCRIPT), "\nSETTINGS_DEFAULTS.responder_command ??= 'x';\n"));
    const r = merge(F, 'kit-qq', '--approved', gc);
    assert.notEqual(r.status, 0, `refused: ${r.text}`);
    assert.match(r.text, /SETTINGS_DEFAULTS in docs\/devteam\/scripts\/ does not read at the head/);
    chore(F, 'kit-note', (w) => fs.appendFileSync(path.join(w, SCRIPT), '\n// never write SETTINGS_DEFAULTS.alpha = false here\nconst X_SETTINGS_DEFAULTS = {}; X_SETTINGS_DEFAULTS.y = 1;\n'));
    const n = merge(F, 'kit-note', '--approved', gc);
    assert.equal(n.status, 0, n.text);
    assert.doesNotMatch(n.text, /owner settings/);
  } finally { F.done(); }
});
