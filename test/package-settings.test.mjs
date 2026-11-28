// settings.package_name (the kit's npm package) and settings.alpha (the live alpha on or off):
// kit-install@1's two settings. Both are the owner's (governance-edit), read as main has them;
// SETTING_SHAPES decides which of their values the Settings page shows, and SETTINGS_WORDS names them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fleetFixture, write } from './lib/kit.mjs';

const SUP = { DEVTEAM_ROLE: 'supervisor' };
const SETTINGS = 'docs/devteam/project/settings.md';

const editSettings = (dir, fn) => {
  const f = path.join(dir, SETTINGS);
  const txt = fs.readFileSync(f, 'utf8');
  const m = txt.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  const j = JSON.parse(m[1]);
  fn(j);
  fs.writeFileSync(f, txt.replace(m[1], () => JSON.stringify(j, null, 2)));
};
// main's settings changed and pushed, as a landed PR would leave them
const onMain = (F, fn) => {
  editSettings(F.old, fn);
  F.g(['commit', '-qam', 'settings on main'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
};
const get = (F, key) => F.ok(F.old, ['settings', '--get', key]);

// A chore branch off origin/main with this settings edit, pushed (as merge-admin.test.mjs has it).
function chore(F, slug, edit) {
  const { old, g } = F;
  const w = path.join(old, '.worktrees', `chore-${slug}`);
  g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
  editSettings(w, edit);
  g(['commit', '-qam', slug], w);
  g(['push', '-q', 'origin', `chore-${slug}`], w);
  g(['worktree', 'remove', '--force', w], old);
  write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
}

test('a fresh instance reads package_name @sanctuarycomputer/devteam and alpha true', () => {
  const F = fleetFixture('pkg-defaults');
  try {
    assert.equal(get(F, 'package_name'), '@sanctuarycomputer/devteam');
    assert.equal(get(F, 'alpha'), 'true');
  } finally { F.done(); }
});

test('alpha false in main\'s settings.md is read as false', () => {
  const F = fleetFixture('pkg-alpha-off');
  try {
    onMain(F, (j) => { j.alpha = false; });
    assert.equal(get(F, 'alpha'), 'false');
  } finally { F.done(); }
});

test('alpha and package_name apply as main has them: a working-tree edit is not read', () => {
  const F = fleetFixture('pkg-owner-main');
  try {
    editSettings(F.old, (j) => { j.alpha = false; j.package_name = '@someone/else'; });
    assert.equal(get(F, 'alpha'), 'true', 'alpha is read from main');
    assert.equal(get(F, 'package_name'), '@sanctuarycomputer/devteam', 'package_name is read from main');
  } finally { F.done(); }
});

test('a chore that changes alpha merges only with an answered governance-edit question', () => {
  const F = fleetFixture('pkg-alpha-merge');
  const { old, ok, run } = F;
  try {
    chore(F, 'alpha', (j) => { j.alpha = false; });
    const merge = (...extra) => { const r = run(old, ['merge', '--chore', 'alpha', '--dry-run', ...extra], SUP); return { status: r.status, text: r.out + r.err }; };
    const ask = (cls) => { const q = ok(old, ['ask', '--question', 'Turn the live alpha off?', '--recommendation', 'yes', '--class', cls, '--reasons', 'owner-only'], SUP); ok(old, ['answer', q, 'yes']); return q; };
    const none = merge();
    assert.notEqual(none.status, 0, 'refused without --approved');
    assert.match(none.text, /changes owner settings: alpha \(governance-edit\)/);
    assert.notEqual(merge('--approved', ask('gate-change')).status, 0, 'a gate-change answer does not approve it');
    const r = merge('--approved', ask('governance-edit'));
    assert.equal(r.status, 0, r.text);
  } finally { F.done(); }
});

test('a chore that changes package_name is refused without the owner\'s answer', () => {
  const F = fleetFixture('pkg-name-merge');
  try {
    chore(F, 'pkgname', (j) => { j.package_name = '@someone/else'; });
    const r = F.run(F.old, ['merge', '--chore', 'pkgname', '--dry-run'], SUP);
    assert.notEqual(r.status, 0, 'refused without --approved');
    assert.match(r.out + r.err, /changes owner settings: package_name \(governance-edit\)/);
  } finally { F.done(); }
});

test('the Settings page: each named in plain words, owner-only, and only a value of its shape shown', () => {
  const F = fleetFixture('pkg-settings-page');
  try {
    const all = () => JSON.parse(F.ok(F.old, ['dashboard-data'])).settings_all;
    const entry = (list, k) => { const e = list.find((x) => x.key === k); assert.ok(e, `an entry for ${k}`); return e; };
    let list = all();
    for (const k of ['package_name', 'alpha']) {
      const e = entry(list, k);
      assert.ok(e.name && !e.name.startsWith('Unnamed setting'), `${k} has a name in words`);
      assert.ok(e.description && e.description.length <= 140 && !/\n/.test(e.description), `${k} has a one-line description`);
      assert.equal(e.group, 'Upstream and releases', `${k}'s group`);
      assert.equal(e.owner_only, 'governance-edit', `${k} is the owner's`);
    }
    // the defaults pass their shapes and show
    assert.deepEqual([entry(list, 'package_name').value, entry(list, 'package_name').withheld], ['@sanctuarycomputer/devteam', undefined]);
    assert.deepEqual([entry(list, 'alpha').value, entry(list, 'alpha').withheld], [true, undefined]);
    // a good value set on main shows
    onMain(F, (j) => { j.alpha = false; j.package_name = '@acme/devteam-fork'; });
    list = all();
    assert.deepEqual([entry(list, 'alpha').value, entry(list, 'alpha').withheld], [false, undefined], 'alpha false shows');
    assert.deepEqual([entry(list, 'package_name').value, entry(list, 'package_name').withheld], ['@acme/devteam-fork', undefined], 'a scoped name shows');
    // npm's longest name, 214 characters, shows
    const longest = `@a/${'b'.repeat(211)}`;
    onMain(F, (j) => { j.package_name = longest; });
    assert.deepEqual([entry(all(), 'package_name').value, entry(all(), 'package_name').withheld], [longest, undefined], 'a 214-character name shows');
    // off its shape: withheld
    for (const bad of ['yes', 'false', 1, 0, null, ['true'], {}]) {
      onMain(F, (j) => { j.alpha = bad; });
      const e = entry(all(), 'alpha');
      assert.deepEqual([e.value, e.withheld], [null, true], `alpha ${JSON.stringify(bad)} is withheld`);
    }
    // 'x@a/b' pins the ^ anchor, '@a/B' lower case after the / (kit-977)
    for (const bad of ['devteam', 'x@a/b', '@Sanctuary/devteam', '@a/B', '@sanctuarycomputer/', '@/devteam', '@a/b/c', '@a/.b', '@a/_b', '@a /b', '@a/~b', '@a/b~', '@~a/b', "@a/b'c", '@a/b!', '@a/b(c)', '@a/b*', `@a/${'b'.repeat(212)}`, 7, null]) {
      onMain(F, (j) => { j.package_name = bad; });
      const e = entry(all(), 'package_name');
      assert.deepEqual([e.value, e.withheld], [null, true], `package_name ${JSON.stringify(bad)} is withheld`);
    }
  } finally { F.done(); }
});

// ---- kit-install@2 (kit-1050): package_source, github or npm, default npm --------------------------

test('S1 a fresh instance reads package_source npm, and main\'s github is read as github', () => {
  const F = fleetFixture('pkg-source-default');
  try {
    assert.equal(get(F, 'package_source'), 'npm', 'S1 the default is npm');
    editSettings(F.old, (j) => { j.package_source = 'github'; });
    assert.equal(get(F, 'package_source'), 'npm', 'S1 a working-tree edit is not read: main has npm');
    F.g(['checkout', '-q', '--', SETTINGS], F.old);
    onMain(F, (j) => { j.package_source = 'github'; });
    assert.equal(get(F, 'package_source'), 'github', 'S1 github set on main is read');
  } finally { F.done(); }
});

test('S2 a chore that changes package_source merges only with an answered governance-edit question', () => {
  const F = fleetFixture('pkg-source-merge');
  const { old, ok, run } = F;
  try {
    chore(F, 'pkgsource', (j) => { j.package_source = 'github'; });
    const merge = (...extra) => { const r = run(old, ['merge', '--chore', 'pkgsource', '--dry-run', ...extra], SUP); return { status: r.status, text: r.out + r.err }; };
    const ask = (cls) => { const q = ok(old, ['ask', '--question', 'Install the kit from GitHub until npm is set up?', '--recommendation', 'yes', '--class', cls, '--reasons', 'owner-only'], SUP); ok(old, ['answer', q, 'yes']); return q; };
    const none = merge();
    assert.notEqual(none.status, 0, 'S2 refused without --approved');
    assert.match(none.text, /changes owner settings: package_source \(governance-edit\)/, 'S2 named as the owner\'s');
    assert.notEqual(merge('--approved', ask('gate-change')).status, 0, 'S2 a gate-change answer does not approve it');
    const r = merge('--approved', ask('governance-edit'));
    assert.equal(r.status, 0, `S2 a governance-edit answer approves it: ${r.text}`);
  } finally { F.done(); }
});

test('S3 the Settings page names package_source and shows only github and npm', () => {
  const F = fleetFixture('pkg-source-page');
  try {
    const all = () => JSON.parse(F.ok(F.old, ['dashboard-data'])).settings_all;
    const entry = (k) => { const e = all().find((x) => x.key === k); assert.ok(e, `S3 an entry for ${k}`); return e; };
    let e = entry('package_source');
    assert.ok(e.name && !e.name.startsWith('Unnamed setting'), 'S3 package_source has a name in words');
    assert.ok(e.description && e.description.length <= 140 && !/\n/.test(e.description), 'S3 a one-line description');
    assert.equal(e.group, 'Upstream and releases', 'S3 its group');
    assert.equal(e.owner_only, 'governance-edit', 'S3 it is the owner\'s');
    assert.deepEqual([e.value, e.withheld, e.default], ['npm', undefined, 'npm'], 'S3 the default npm shows');
    onMain(F, (j) => { j.package_source = 'github'; });
    e = entry('package_source');
    assert.deepEqual([e.value, e.withheld], ['github', undefined], 'S3 github shows');
    for (const bad of ['GitHub', 'NPM', 'git', 'registry', '', 'npm ', 'github\n', true, 1, null, ['npm'], {}]) {
      onMain(F, (j) => { j.package_source = bad; });
      e = entry('package_source');
      assert.deepEqual([e.value, e.withheld], [null, true], `S3 package_source ${JSON.stringify(bad)} is withheld`);
    }
  } finally { F.done(); }
});

test('S4 package_name\'s words no longer say npm: the package comes from npm or GitHub', () => {
  const F = fleetFixture('pkg-name-words');
  try {
    const pn = JSON.parse(F.ok(F.old, ['dashboard-data'])).settings_all.find((x) => x.key === 'package_name');
    assert.ok(pn, 'S4 an entry for package_name');
    assert.doesNotMatch(`${pn.name} ${pn.description}`, /npm/i, 'S4 package_name\'s words no longer say npm');
  } finally { F.done(); }
});
