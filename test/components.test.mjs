// Component lines and coverage: G1's goldens, the coverage function, what init writes, the
// registry and component lines, and the components check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { kit, line, write, json, fleetFixture, G1_DIR, g1Outputs, coverageFns, coverageClean, monoFixture } from './lib/kit.mjs';

test('G1: a single-repo project with no new settings prints what it printed before', () => {
  const F = fleetFixture('g1');
  try {
    const outs = g1Outputs(F);
    for (const [name, text] of Object.entries(outs)) {
      const file = path.join(G1_DIR, `${name}.txt`);
      if (process.env.DEVTEAM_G1_RECORD) { write(file, text); continue; }
      assert.equal(text, fs.readFileSync(file, 'utf8'), `${name} changed for a single-repo project (G1); the golden is ${file}`);
    }
  } finally { F.done(); }
});

test('coverage: every tracked path has exactly one owner', () => {
  const { coverage, prefixOwners } = coverageFns();
  const DEV = ['docs/devteam/**'];
  const plain = (r) => JSON.parse(JSON.stringify(r));
  const paths = ['.github/workflows/ci.yml', '.tool-versions', 'app/.keep', 'app/a b/c.rb', 'app/é.rb', 'app/x.rb', 'lib/deep/.hidden/x', 'vendor/sub', 'link-to-app', 'docs/devteam/project/settings.md', 'docs/devteam/scripts/devteam.mjs'];
  const comps = [{ name: 'api', owns: ['app/**', 'lib/**'] }, { name: 'ops', owns: ['.github/**', '.tool-versions', 'vendor/sub', 'link-to-app'] }];
  // dotfiles, dot-directories, spaces, non-ASCII, a submodule gitlink and a symlink are paths like any other
  assert.deepEqual(plain(coverage(paths, comps, DEV)), { unowned: [], contested: [], empty: [], case_collisions: [] });
  assert.equal(coverageClean(coverage(paths, comps, DEV)), true);
  assert.deepEqual(plain(coverage([...paths, 'scripts/x.sh'], comps, DEV)).unowned, ['scripts/x.sh'], 'a path no line owns');
  assert.deepEqual(plain(coverage(paths, [...comps, { name: 'web', owns: ['app/x.rb'] }], DEV)).contested, [['app/x.rb', ['api', 'web'], [['api', 'app/**'], ['web', 'app/x.rb']]]], 'a path two lines own, and the globs that collide');
  assert.deepEqual(plain(coverage(paths, [...comps, { name: 'web', owns: ['web/**'] }], DEV)).empty, ['web/**'], 'a glob that matches nothing is a typo');
  assert.deepEqual(plain(coverage(paths, [{ name: 'all', owns: ['**'] }], DEV)).contested, [], "the kit's line is set aside before any contest: a glob reaching into it claims nothing there");
  assert.deepEqual(plain(coverage(paths, [...comps, { name: 'docs', owns: ['docs/**'] }], DEV)).empty, ['docs/**'], 'a glob that only reaches the kit owns nothing');
  assert.deepEqual(plain(coverage(paths, [{ name: 'all' }], DEV)), { unowned: [], contested: [], empty: [], case_collisions: [] }, 'a sole component with no owns owns everything devteam does not');
  assert.deepEqual(plain(coverage(paths, [{ name: 'a' }, { name: 'b', owns: ['app/**'] }], DEV)).unowned.length > 0, true, 'the ** default holds only for a sole component');
  assert.deepEqual(plain(coverage(['App.rb', 'app.rb'], [{ name: 'x', owns: ['App.rb', 'app.rb'] }], DEV)).case_collisions, [['App.rb', 'app.rb']], 'paths that differ only by case');
  assert.deepEqual(plain(coverage(['App.rb'], [{ name: 'x', owns: ['app.rb'] }], DEV)).unowned, ['App.rb'], 'matching is case-sensitive');
  // touches containment: the static prefix of a touches entry and who owns it
  assert.deepEqual(plain(prefixOwners('app/models/**', comps, DEV)), ['api']);
  assert.deepEqual(plain(prefixOwners('app', comps, DEV)), ['api'], 'a plain path is the folder and what is in it');
  assert.equal(prefixOwners('**/*.rb', comps, DEV), null, 'no static prefix');
  assert.deepEqual(plain(prefixOwners('docs/devteam/project/x', comps, DEV)), ['devteam']);
  const { ownersOf } = coverageFns();
  assert.deepEqual(plain(ownersOf('app/x.rb', comps, DEV)), ['api']);
  assert.deepEqual(plain(ownersOf('docs/devteam/scripts/devteam.mjs', [{ name: 'all' }], DEV)), ['devteam'], 'the ** default never reaches the kit\'s line');
});

test('coverage: the function reports a clean partition exactly when there is one (property)', () => {
  const { coverage, pathMatches } = coverageFns();
  // mulberry32: a seeded generator, so a failure names the seed that reproduces it
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
  let collided = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const dirs = ['a', 'a/b', '.c', 'd e', 'é', 'x/.y'];
    // 'f' and 'F' in one folder are a case collision, so some seeds exercise case_collisions
    const paths = [...new Set(Array.from({ length: 2 + Math.floor(r() * 12) }, () => `${pick(r, dirs)}/${pick(r, ['f', 'F', 'g.rb', '.h', 'Ö'])}`))];
    const candidates = [...dirs.map((d) => `${d}/**`), ...paths, '**/*.rb', 'nowhere/**'];
    const comps = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) => ({ name: `c${i}`, owns: Array.from({ length: 1 + Math.floor(r() * 3) }, () => pick(r, candidates)) }));
    const oracle = paths.every((p) => comps.filter((c) => c.owns.some((g) => pathMatches(g, p))).length === 1)
      && comps.every((c) => c.owns.every((g) => paths.some((p) => pathMatches(g, p))))
      && new Set(paths.map((p) => p.toLowerCase())).size === paths.length;
    assert.equal(coverageClean(coverage(paths, comps, [])), oracle, `seed ${seed}: ${JSON.stringify({ paths, comps })}`);
    // and a partition built to be clean always is: each path owned by exactly one exact-path glob
    const parts = comps.map((c) => ({ name: c.name, owns: [] }));
    paths.forEach((p, i) => parts[i % parts.length].owns.push(p));
    const live = parts.filter((c) => c.owns.length);
    const unique = new Set(paths.map((p) => p.toLowerCase())).size === paths.length;
    assert.equal(coverageClean(coverage(paths, live, [])), unique, `seed ${seed}: a built partition`);
    if (!unique) collided++;
  }
  assert.ok(collided > 0, 'some seeds produced a case collision');
});

test('every path init writes is in the devteam line or one of the project files the README names', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-init-paths-'));
  try {
    const r = path.join(base, 'repo');
    fs.mkdirSync(r);
    const gx = (args) => execFileSync('git', args, { cwd: r, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    gx(['init', '-q', '-b', 'main']);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) gx(['config', k, v]);
    // a project that already has its own CLAUDE.md, AGENTS.md and .gitignore, so init appends to each
    write(path.join(r, 'CLAUDE.md'), '# Claude\n\nOur rules.\n');
    write(path.join(r, 'AGENTS.md'), '# Agents\n\nOur agents.\n');
    write(path.join(r, '.gitignore'), 'node_modules/\n');
    fs.cpSync(kit, path.join(r, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
    gx(['add', '-A']); gx(['commit', '-qm', 'before init']);
    const env = { ...process.env };
    for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_RUN']) delete env[k];
    execFileSync(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'init', '--name', 'x'], { cwd: r, env, encoding: 'utf8' });
    const touched = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: r, encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.slice(3));
    assert.ok(touched.length, 'init wrote something');
    const outside = [...new Set(touched.filter((p) => !p.startsWith('docs/devteam/')))].sort();
    const readme = fs.readFileSync(path.join(path.dirname(kit), '..', 'README.md'), 'utf8');
    const named = /`init` writes into these files outside `docs\/devteam\/`, and they stay the project's:([^\n]*)/.exec(readme);
    assert.ok(named, 'the README names the project files init writes into');
    for (const p of outside) assert.ok(named[1].includes(`\`${p}\``), `${p}: init writes it outside the devteam line, so the README names it as the project's`);
    assert.deepEqual(outside, ['.gitignore', '.gitleaks.toml', 'AGENTS.md', 'CLAUDE.md']);
    // and the README's example lines never claim one of them as a component's own kind of file
    assert.doesNotMatch(readme.match(/"ops": \{[^\n]*/)?.[0] ?? '', /AGENTS\.md|devteam\.yml/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('the registry and component lines are validated; labels-only components and no links change nothing', () => {
  const F = monoFixture('registry');
  const { old, ok, run, lines, edit, g } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const v = () => { const r = run(old, ['validate']); return r.out + r.err; };
  try {
    // components written as labels before lines existed (a stack, a path): no new errors
    lines({ api: { stack: 'rails', path: 'api' }, web: { stack: 'next' } });
    assert.doesNotMatch(v(), /component|owns|links/i, 'labels are not lines');
    // unknown kind, reserved ids, http, unknown field, duplicate remotes, home's own remote
    const bad = { bare: { kind: 'repo', title: 'Bare', remote: 'some-folder' }, console: { kind: 'repo', title: 'Console', remote: 'usbclub/console' }, dup: { kind: 'repo', title: 'Dup', remote: 'https://github.com/usbclub/console.git' }, home: { kind: 'url', title: 'x', url: 'https://x.test' }, figma: { kind: 'url', title: 'F', url: 'http://figma.test' }, notes: { kind: 'doc', title: 'D' }, self: { kind: 'repo', title: 'Self', remote: F.org }, extra: { kind: 'url', title: 'E', url: 'https://e.test', colour: 'red' } };
    lines({}, { links: bad });
    const out = v();
    assert.match(out, /links\.notes: unknown kind "doc" \(known: repo, url\)/);
    assert.match(out, /links\.home: "home" is reserved/);
    assert.match(out, /links\.figma: url must start with https:\/\//);
    assert.match(out, /links\.dup: the same remote as links\.console/);
    assert.match(out, /links\.self: the repo that holds the kit \(home\)/);
    assert.match(out, /links\.extra: "colour" is not a field of a url link/);
    assert.match(out, /links\.bare: remote "some-folder" is neither owner\/name nor a URL; a local remote is a path starting \.\/, \.\.\/ or \//);
    lines({}, { links: {} });
    // declared lines: object entries are reserved, negations refused, two owns-less components, a non-home link
    lines({ api: { owns: ['api/**', { link: 'x', glob: 'y' }] }, web: { owns: ['!web/tmp/**', 'web/**'] }, ops: {}, misc: {}, none: { owns: [] }, console: { link: 'console' } });
    const o2 = v();
    assert.match(o2, /components\.api\.owns\[1\]: an object entry is reserved for a later release/);
    assert.match(o2, /components\.web\.owns\[0\]: negation patterns are refused/);
    assert.match(o2, /components ops and misc both have no owns on home/);
    assert.match(o2, /components\.none\.owns: an empty list owns nothing/);
    assert.match(o2, /components\.console: link "console" is not in links/);
    // m1: a ticket whose component is a reserved slug is reported once, with the rename
    lines(F.STD);
    const tj = (component, extra = {}) => JSON.stringify({ title: 'x', feature: 'chores', component, kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['the api check passes'], notes: 'n', ...extra });
    // new tickets can't take a reserved name, and the refusal names the list
    assert.match(run(old, ['ticket', 'add', 'home-01-x', '--json', tj('home')], SUP).err, /component "home" is reserved \(reserved: home, devteam\)/);
    ok(old, ['ticket', 'add', 'api-02-y', '--json', tj('api')], SUP);
    assert.match(run(old, ['ticket', 'set', 'api-02-y', '--json', JSON.stringify({ component: 'devteam' })], SUP).err, /component "devteam" is reserved \(reserved: home, devteam\)/);
    // a ticket a project wrote before the names were reserved: one error, and the prescribed fix clears it
    const logDir = path.join(old, 'docs/devteam/run/log');
    const file = path.join(logDir, fs.readdirSync(logDir).find((f) => f.startsWith('supervisor-')));
    const mine = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((o) => o.type === 'ticket' && o.id === 'api-02-y' && o.op === 'new');
    fs.appendFileSync(file, `${JSON.stringify({ ...mine, id: 'home-01-x', component: 'home', at: new Date().toISOString() })}\n`);
    assert.match(v(), /tickets home-01-x: component "home" is reserved/);
    ok(old, ['ticket', 'add', 'api-03-x', '--json', tj('api')], SUP);
    ok(old, ['ticket', 'set', 'home-01-x', '--json', JSON.stringify({ superseded_by: 'api-03-x' })], SUP);
    assert.doesNotMatch(v(), /is reserved/, 'superseding it, as the message says, clears it');
  } finally { F.done(); }
});

test('owner settings per entry: repo-link fields have classes, url links are the supervisor\'s, and repo links count as on main', () => {
  const F = monoFixture('owner-entries');
  const { old, ok, run, g, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  try {
    const repoLink = { kind: 'repo', title: 'Console', remote: 'usbclub/console' };
    edit((j) => { j.links = { console: repoLink, figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a' } }; });
    g(['commit', '-qam', 'links'], old);
    g(['push', '-q', 'origin', 'main'], old);
    const chore = (slug, fn) => {
      const w = path.join(old, '.worktrees', `chore-${slug}`);
      g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
      edit(fn, w);
      g(['commit', '-qam', slug], w);
      g(['push', '-q', 'origin', `chore-${slug}`], w);
      write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
      const r = run(old, ['merge', '--chore', slug, '--dry-run'], SUP);
      g(['worktree', 'remove', '--force', w], old);
      return r.out + r.err;
    };
    assert.doesNotMatch(chore('figma', (j) => { j.links.figma.title = 'All designs'; j.links.figma.for = ['all']; }), /owner settings/, 'url-link edits are the supervisor\'s');
    assert.match(chore('gates', (j) => { j.links.console.gates = { test: 'npm test' }; }), /changes owner settings: links\.console\.gates \(gate-change\)/);
    assert.match(chore('remote', (j) => { j.links.console.remote = 'usbclub/console2'; }), /links\.console\.remote \(governance-edit\)/);
    assert.match(chore('add', (j) => { j.links.companion = { kind: 'repo', title: 'C', remote: 'usbclub/companion' }; }), /links\.companion \(governance-edit\)/);
    assert.match(chore('flip', (j) => { j.links.console = { kind: 'url', title: 'C', url: 'https://c.test' }; }), /links\.console \(governance-edit\)/, 'a repo→url flip is a repo removal');
    assert.doesNotMatch(chore('path', (j) => { j.links.console.path = '../elsewhere'; }), /owner settings/, 'where the checkout is is never the owner\'s');
    // working-tree flips and removals are ignored; repo links count as on main
    const settings = () => json(ok(old, ['settings']));
    edit((j) => { j.links.console = { kind: 'url', title: 'flip', url: 'https://c.test' }; j.links.added = { kind: 'repo', title: 'A', remote: 'usbclub/added' }; j.links.figma.notes = 'working tree'; j.links.fresh = { kind: 'url', title: 'Fresh', url: 'https://fresh.test' }; });
    const s1 = run(old, ['settings']);
    assert.deepEqual(json(s1.out).links.console, repoLink, 'a url flip of a repo link on main is ignored');
    assert.equal(json(s1.out).links.added, undefined, 'a repo link not on main is dropped');
    assert.equal(json(s1.out).links.figma.notes, 'working tree', 'url links come from the working tree');
    assert.equal(json(s1.out).links.fresh.title, 'Fresh');
    assert.match(s1.err, /settings\.md here changes links\.added, links\.console; owner settings apply as they are on/);
    edit((j) => { delete j.links.console; });
    assert.deepEqual(settings().links.console, repoLink, 'a working-tree removal of a repo link is ignored');
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
    edit((j) => { j.links.figma = { kind: 'repo', title: 'F', remote: 'usbclub/figma' }; });
    assert.equal(settings().links.figma.kind, 'url', 'a url→repo flip in the working tree is ignored');
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
  } finally { F.done(); }
});

test('components check reads a commit\'s tree: dotfiles, gitlinks, symlinks, spaces, unicode; never the index', () => {
  const F = monoFixture('components-check');
  const { old, ok, run, g, lines } = F;
  try {
    assert.match(ok(old, ['components', 'check']), /no component lines declared/, 'labels-only or none: nothing to check');
    assert.equal(ok(old, ['components', 'check', '--count']), '0');
    // a submodule gitlink, a symlink, a dot-directory, a space, a non-ASCII name
    const sub = path.join(F.base, 'sub');
    g(['init', '-q', '-b', 'main', sub], F.base);
    write(path.join(sub, 'x'), 'x\n');
    g(['add', 'x'], sub);
    g(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x'], sub);
    g(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub'], old);
    fs.symlinkSync('api', path.join(old, 'api-link'));
    write(path.join(old, 'api/.hidden/deep/x.rb'), 'x\n');
    write(path.join(old, 'api/with space.rb'), 'x\n');
    write(path.join(old, 'api/é.rb'), 'x\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'shapes'], old);
    g(['push', '-q', 'origin', 'main'], old);
    lines({ ...F.STD, ops: { owns: [...F.STD.ops.owns, '.gitmodules', 'vendor/sub', 'api-link'] } });
    ok(old, ['components', 'check']);
    assert.equal(ok(old, ['components', 'check', '--count']), '0');
    // a staged, uncommitted file is not in any tree
    write(path.join(old, 'stray.txt'), 'staged only\n');
    g(['add', 'stray.txt'], old);
    ok(old, ['components', 'check']);
    g(['reset', '-q', 'stray.txt'], old);
    fs.rmSync(path.join(old, 'stray.txt'));
    // committed but owned by nobody: unowned, grouped by folder, with a suggested owner
    write(path.join(old, 'api/new/one.rb'), '1\n');
    write(path.join(old, 'scripts/run.sh'), '1\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'stray'], old);
    lines({ ...F.STD, api: { owns: ['api/*.rb', 'api/lib/**', 'api/.hidden/**', 'api/app.rb'] }, ops: { owns: [...F.STD.ops.owns, '.gitmodules', 'vendor/sub', 'api-link', 'docs/nowhere/**'] } });
    const r = run(old, ['components', 'check']);
    assert.equal(r.status, 1);
    assert.match(r.out, /unowned: api\/new\/ \(1\): api\/new\/one\.rb; suggested owner: api/);
    assert.match(r.out, /unowned: scripts\/ \(1\): scripts\/run\.sh/);
    assert.match(r.out, /empty: ops owns "docs\/nowhere\/\*\*", which matches nothing/);
    assert.doesNotMatch(r.out, /contested: api\/app\.rb/, 'two globs of one component are still one owner');
    assert.equal(run(old, ['components', 'check', '--count']).out, '3');
    const j = json(run(old, ['components', 'check', '--json']).out);
    assert.deepEqual(j.unowned.sort(), ['api/new/one.rb', 'scripts/run.sh']);
    // each kind of gap carries its own fix; a contest names both globs
    assert.match(r.out, /unowned: scripts\/ \(1\): scripts\/run\.sh.* -> extend a line \(settings components\) in a chore PR, or move the files into one/);
    lines({ ...F.STD, web: { owns: ['web/**', 'api/app.rb'] }, ops: { owns: [...F.STD.ops.owns, '.gitmodules', 'vendor/sub', 'api-link', 'scripts/**'] } });
    assert.match(run(old, ['components', 'check']).out, /contested: api\/app\.rb is owned by api \("api\/\*\*"\) and web \("api\/app\.rb"\) -> narrow one of those globs so one line owns it/);
    // a project line over docs/ coexists with the kit's docs/devteam/**: the kit is set aside first
    write(path.join(old, 'docs/guide.md'), '# guide\n');
    g(['add', '-A'], old); g(['commit', '-qm', 'docs'], old);
    lines({ ...F.STD, ops: { owns: [...F.STD.ops.owns, '.gitmodules', 'vendor/sub', 'api-link', 'scripts/**'] }, docs: { owns: ['docs/**'] } });
    ok(old, ['components', 'check']);
    // --ref reads that commit's tree and that commit's settings
    ok(old, ['components', 'check', '--ref', 'HEAD~5']);
  } finally { F.done(); }
});

// kit-315: index.html's style, markup and renderOoda sections are named regions (devteam-dev PR #189),
// so a ticket can claim index.html#<region>. Read by the kit's own parts reader, as validate reads them.
function partsFns() {
  const src = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
  const a = src.indexOf('/* parts start */'), b = src.indexOf('/* parts end */');
  assert.ok(a >= 0 && b > a, 'devteam.mjs has a /* parts */ region');
  return vm.runInContext(`${src.slice(a, b)}\n;({ fileParts })`, vm.createContext({}));
}
// [name, first content line, last content line (trimmed prefixes; '' a blank line), content line count]
const INDEX_REGIONS = [
  ["css-base", "* { box-sizing: border-box; }", "", 32],
  ["css-shell", "/* shell */", ":where(.no-shell) main { max-width: 1120", 16],
  ["css-frame", "/* the frame (kit-87): the grouped nav, ", "main.page > section[data-page] { margin-", 28],
  ["css-settings", "/* the Settings page (kit-87 spec §8), a", "", 36],
  ["css-common", "/* sections */", "", 65],
  ["css-efficiency", "/* the Efficiency Score card (kit-174), ", "", 43],
  ["css-progress", "/* progress */", "", 29],
  ["css-board", "/* board */", "", 54],
  ["css-loop", "/* loop */", ".qcard.done { border-left-color: var(--g", 11],
  ["css-inbox", "/* the Inbox is in the kit's order: the ", "", 46],
  ["css-loop-tabs", "/* loop tabs */", "", 8],
  ["css-goals-old", "/* goals */", "", 14],
  ["css-chrome", "/* icons, title bars, menus */", "", 22],
  ["css-planners", "/* the planners strip above the Board (k", "", 18],
  ["css-acts", "/* acts in plain words */", "", 4],
  ["css-peek", "/* the peek (kit-88): the block's frame ", ".attrs-h { margin: 6px 0 0; font-size: 1", 28],
  ["css-misc", "/* a key's tooltip on keyboard focus (th", "", 85],
  ["css-review", "/* review questions: three bands, the mi", "", 63],
  ["css-library", "/* the Library: artifacts (a landed one ", "", 19],
  ["css-viewer", "/* the artifact viewer: a page the fleet", ".viewer #artifact-view:not([hidden]) { i", 29],
  ["css-viewer-bar", ".av-bar { display: flex; align-items: ce", "@media (max-width: 600px) { .av-bar .av-", 11],
  ["css-threads", "/* threads: the layer over the page (Shi", "@media (pointer: coarse) { .threads-head", 128],
  ["css-goals", "/* Goals (kit-90): the tabs, then the ca", "#goals > #unassigned { margin-top: 12px;", 18],
  ["css-overview", "/* Overview (kit-90): a header with the ", ".card.goal.blk-partial, .ov-goal.blk-par", 30],
  ["html-side", "<aside class=\"side\" aria-label=\"Navigati", "</aside>", 13],
  ["html-pagebar", "<header class=\"pagebar\"><h1 id=\"page-tit", "<header class=\"pagebar\"><h1 id=\"page-tit", 1],
  ["html-overview", "<section id=\"overview\" data-page=\"overvi", "</section>", 5],
  ["html-goals", "<section id=\"goals\" data-page=\"goals\">", "</section>", 4],
  ["html-progress", "<section id=\"progress\" data-page=\"progre", "</section>", 19],
  ["html-board", "<section id=\"board\" data-page=\"board\">", "</section>", 4],
  ["html-library", "<section id=\"library\" class=\"no-shell\" d", "</section>", 8],
  ["html-loop", "<section id=\"loop\" class=\"no-shell\" data", "", 41],
  ["html-trust", "<section id=\"trust\" class=\"no-shell\" dat", "</section>", 7],
  ["html-efficiency", "<!-- kit-174: the Efficiency Score card,", "<section id=\"efficiency\" data-page=\"effi", 2],
  ["html-retros", "<section id=\"retros\" class=\"no-shell\" da", "", 6],
  ["html-health", "<section id=\"health\" class=\"no-shell\" da", "", 8],
  ["html-sensors", "<section id=\"monitoring\" class=\"no-shell", "", 11],
  ["html-settings", "<section id=\"settings\" data-page=\"settin", "<section id=\"settings\" data-page=\"settin", 1],
  ["html-review", "<section id=\"review-view\" class=\"no-shel", "</section>", 9],
  ["html-drawer", "<div class=\"scrim\" id=\"scrim\" hidden></d", "<button class=\"ghost tt\" id=\"tt-peek\" ty", 7],
  ["html-viewer", "<div id=\"artifact-view\" class=\"no-shell\"", "</div>", 21],
  ["html-viewer-bar", "<div class=\"av-bar\">", "</div>", 7],
  ["html-tl", "<!-- the thread layer: outside <main>, w", "</div>", 8],
  ["html-threads", "<!-- the Threads panel (kit-89 spec §2.1", "</aside>", 11],
  ["ooda-learning", "// Is it learning: the chart above the t", "", 3],
  ["ooda-observe", "// Observe", "", 5],
  ["ooda-orient", "// Orient", "", 18],
  ["ooda-trust", "// Trust Ladder", "", 8],
  ["ooda-decide", "// Decide: every call, the supervisor's ", "", 3],
  ["ooda-act", "// Act", "}", 12],
];
const IS_REGION_MARK = /^\s*(?:\/\*|<!--) (?:css|html|ooda)-[a-z-]+ (?:start|end) (?:\*\/|-->)$/;
test("index.html's regions (kit-315): each name is one region over exactly its lines, in its form", () => {
  const { fileParts } = partsFns();
  const P = fileParts(fs.readFileSync(path.join(kit, 'dashboard', 'index.html'), 'utf8'), 'index.html');
  const L = P.lines;
  const at = (s, from = 0) => { const i = L.findIndex((l, k) => k >= from && l === s); assert.ok(i >= 0, `index.html has the line ${s}`); return i + 1; };
  const style = at('<style>'), styleEnd = at('</style>'), script = at('<script>', styleEnd), mainEnd = at('</main>');
  const R = new Map();
  for (const [name, first, last, count] of INDEX_REGIONS) {
    const pl = P.places.get(name);
    assert.equal(pl?.length, 1, `${name}: one region`);
    const { from, to } = pl[0];
    R.set(name, { from, to });
    const mark = name.startsWith('html-') ? (w) => `<!-- ${name} ${w} -->` : name.startsWith('ooda-') ? (w) => `  /* ${name} ${w} */` : (w) => `/* ${name} ${w} */`;
    assert.equal(L[from - 1], mark('start'), `${name}: its start marker, in its form and column`);
    assert.equal(L[to - 1], mark('end'), `${name}: its end marker, in its form and column`);
    const check = (got, want, what) => (want === '' ? assert.equal(got.trim(), '', `${name}: its ${what} line is blank`) : assert.ok(got.trim().startsWith(want), `${name}: its ${what} line starts ${JSON.stringify(want)}; got ${JSON.stringify(got.trim().slice(0, 60))}`));
    check(L[from], first, 'first');
    check(L[to - 2], last, 'last');
    assert.equal(L.slice(from, to - 1).filter((l) => !IS_REGION_MARK.test(l)).length, count, `${name}: ${count} lines`);
    if (name.startsWith('css-')) assert.ok(style < from && to < styleEnd, `${name}: inside <style>`);
    if (name.startsWith('html-')) assert.ok(styleEnd < from && to < script, `${name}: in the markup`);
  }
  // nesting: only the two viewer bars sit inside another region; no other pair overlaps
  const inside = (x, y) => R.get(y).from < R.get(x).from && R.get(x).to < R.get(y).to;
  assert.ok(inside('css-viewer-bar', 'css-viewer') && inside('html-viewer-bar', 'html-viewer'), 'the viewer bars sit inside their viewers');
  const names = [...R.keys()];
  for (const x of names) for (const y of names) {
    if (x >= y || ['css-viewer-bar|css-viewer', 'css-viewer|css-viewer-bar', 'html-viewer-bar|html-viewer', 'html-viewer|html-viewer-bar'].includes(`${x}|${y}`)) continue;
    assert.ok(R.get(x).to < R.get(y).from || R.get(y).to < R.get(x).from, `${x} and ${y} don't overlap`);
  }
  // the 600px .av-bar rule moved up into css-viewer-bar, right after #av-reload.stale
  const stale = L.findIndex((l) => l.trim().startsWith('#av-reload.stale'));
  assert.ok(L[stale + 1].trim().startsWith('@media (max-width: 600px) { .av-bar .av-label'), 'the .av-bar media rule follows #av-reload.stale');
  assert.equal(L[stale + 2], '/* css-viewer-bar end */', 'and closes css-viewer-bar');
  assert.ok(R.get('html-review').to < mainEnd, 'html-review ends before </main>');
  // renderOoda's sub-regions: after renderGoals(), in PR #189's order. renderOoda's own place is unchanged:
  // it ends above them, at the line before its first column-0 </div> (the markers' indentation, held
  // above, is what keeps a column-0 marker out of the body)
  const fn = L.findIndex((l) => l.startsWith('function renderOoda(')) + 1;
  const goals = at('  renderGoals();', fn);
  const ooda = ['learning', 'observe', 'orient', 'trust', 'decide', 'act'].map((n) => R.get(`ooda-${n}`));
  assert.ok(goals < ooda[0].from, 'the ooda regions follow renderGoals()');
  for (let i = 1; i < ooda.length; i++) assert.ok(ooda[i - 1].to < ooda[i].from, 'the ooda regions in order');
  const div = L.findIndex((l, k) => k >= fn && l.startsWith('</div>')) + 1;
  const own = P.places.get('renderOoda');
  assert.ok(own?.length === 1 && own[0].from <= fn && own[0].to === div - 1, "renderOoda's own place is as before");
});
