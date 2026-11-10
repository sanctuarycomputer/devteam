// The tree that would land: validate, the ticket footprint, check-pr and merge against main.
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
import { kit, line, write, json, monoFixture } from './lib/kit.mjs';

test('validate: main\'s tree under the lines in force, declared components, touches inside one line', () => {
  const F = monoFixture('validate-lines');
  const { old, ok, run, g, lines } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const tk = (id, extra) => ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: id.split('-')[0], kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['the api suite passes'], notes: 'n', ...extra })], SUP);
  try {
    lines(F.STD);
    tk('api-01-a');
    tk('web-02-b', { touches: ['web/src/**', 'api/app.rb'] });
    tk('ghost-03-c', { touches: ['web/**'] });
    tk('web-04-d', { touches: ['**/*.js'] });
    tk('api-05-e', { kind: 'contract', contracts: { provides: ['api-v1'] }, touches: ['api/lib/**', 'web/src/api.js'], touches_components: ['web'] });
    tk('api-06-f', { touches: ['docs/devteam/governance/quality.md'] });
    tk('ops-07-g', { touches_components: ['web'] });
    const out = run(old, ['validate']).out;
    assert.doesNotMatch(out, /api-01-a: touches/, 'inside its own line');
    assert.match(out, /web-02-b: touches "api\/app\.rb" lies in api's line, not web's \(list api in touches_components on a contract or integration ticket, or split the ticket\)/);
    assert.match(out, /ghost-03-c: component "ghost" is not declared in settings\.components/);
    assert.match(out, /web-04-d: touches "\*\*\/\*\.js" has no static prefix, so it could be in any line/);
    assert.doesNotMatch(out, /api-05-e: touches/, 'a contract ticket may span the lines it names');
    assert.match(out, /api-06-f: touches "docs\/devteam\/governance\/quality\.md" lies in the kit's own line/);
    assert.match(out, /ops-07-g: touches_components is for contract and integration tickets/);
    // coverage of main's tree: a file pushed straight to main
    write(path.join(old, 'scripts/x.sh'), 'x\n');
    g(['add', '-A'], old);
    g(['commit', '-qm', 'bypass'], old);
    g(['push', '-q', 'origin', 'main'], old);
    assert.match(run(old, ['validate']).out, /error: components: unowned: scripts\/ \(1\): scripts\/x\.sh/);
    // checked for one ticket (its gate), the gap is main's, not the ticket's: a warning
    const scoped = spawnSync(process.execPath, [path.join(old, 'docs/devteam/scripts/devteam.mjs'), 'validate'], { cwd: old, env: { ...F.env({}), DEVTEAM_GATE_TICKET: 'api-01-a' }, encoding: 'utf8' });
    assert.match(scoped.stdout, /warning: components: unowned: scripts\/ .*; not api-01-a's to fix/);
  } finally { F.done(); }
});

test('the ticket footprint: touches, and the component\'s line, and its own records', () => {
  const F = monoFixture('footprint');
  const { old, ok, run, g, lines } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  try {
    lines(F.STD);
    const branch = (id, ticket, files) => {
      ok(old, ['ticket', 'add', id, '--json', JSON.stringify({ title: id, feature: 'chores', component: id.split('-')[0], kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], done_when: ['its suite passes in CI'], notes: 'n', ...ticket })], SUP);
      const w = path.join(old, '.worktrees', id);
      g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/main'], old);
      for (const [f, text] of Object.entries(files)) write(path.join(w, f), text);
      g(['add', '-A'], w);
      g(['commit', '-qm', `${id}: work`], w);
      return run(old, ['check-ticket', id, '--sha', g(['rev-parse', 'HEAD'], w), '--title', `${id}: work`, '--body-file', body]).out;
    };
    // an ordinary ticket's PR carries its own records, inside the kit's line
    const b1 = branch('api-01-own', { touches: ['api/**'] }, { 'api/app.rb': 'changed\n', 'docs/devteam/project/tickets/api-01-own/spec.md': '# spec\n' });
    assert.doesNotMatch(b1, /outside the line|outside touches/, "a ticket's own records are in the kit's line");
    // a non-ASCII path is owned at point 4 too
    assert.doesNotMatch(branch('api-02-utf', { touches: ['api/**'] }, { 'api/é.rb': 'x\n' }), /outside the line|outside touches/, 'app/é.rb');
    // touches that reach another line: refused at the footprint, whatever the globs claimed
    const reach = branch('web-03-reach', { touches: ['web/**', 'api/app.rb'] }, { 'api/app.rb': 'web edits api\n' });
    assert.match(reach, /changes files outside the line of web: api\/app\.rb \(api's line\)/, 'the file and its owner');
    assert.match(reach, /drop those changes, plan them as a contract or integration ticket that lists api in touches_components, or split the ticket/, 'the fix');
    // touches_components widens only a contract or integration ticket, here as in validate
    const wide = branch('api-06-build', { kind: 'build', touches: ['api/**', 'web/src/x.js'], touches_components: ['web'] }, { 'web/src/x.js': 'x\n' });
    assert.match(wide, /changes files outside the line of api: web\/src\/x\.js \(web's line\)/);
    assert.match(wide, /touches_components is for contract and integration tickets; this build ticket's line is api's alone/);
    // a contract ticket that names the second line passes
    assert.doesNotMatch(branch('api-04-contract', { kind: 'contract', contracts: { provides: ['v1'] }, touches: ['api/lib/**', 'web/src/api.js'], touches_components: ['web'] }, { 'api/lib/v1.rb': 'v1\n', 'web/src/api.js': 'fake\n' }), /outside the line/);
    // the kit's line: nothing but the ticket's own folder
    assert.match(branch('api-05-kit', { touches: ['api/**', 'docs/devteam/governance/quality.md'] }, { 'docs/devteam/governance/quality.md': 'x\n' }), /changes files outside the line of api: docs\/devteam\/governance\/quality\.md \(the kit's own line\)/);
  } finally { F.done(); }
});

test('check-pr and merge judge the tree that would land, by committed lines', () => {
  const F = monoFixture('landing');
  const { old, ok, run, g, lines, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  const chore = (slug, fn, { from = 'origin/main' } = {}) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, from], old);
    fn(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', `chore-${slug}: x`], w);
    g(['push', '-q', 'origin', `chore-${slug}`], w);
    return { w, sha: g(['rev-parse', 'HEAD'], w) };
  };
  const checkPr = (slug, sha) => run(old, ['check-pr', '--head-ref', `chore-${slug}`, '--sha', sha, '--title', `chore-${slug}: x`, '--body-file', body]);
  try {
    // before any lines, a chore PR passes check-pr even with a validate error in the graph
    ok(old, ['ticket', 'add', 'api-01-dangling', '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: ['api-99-nope'], touches: ['api/**'], done_when: ['the api suite passes'], notes: 'n' })], SUP);
    assert.notEqual(run(old, ['validate']).status, 0, 'a pre-existing validate error');
    const m10 = chore('m10', (w) => write(path.join(w, 'docs/devteam/project/designs/note.md'), '# note\n'));
    assert.equal(checkPr('m10', m10.sha).status, 0, 'a chore PR never runs full validate');
    lines(F.STD);
    const stale = g(['rev-parse', 'origin/main'], old);
    // a new top-level folder; a rename out of every line; a narrowed glob
    assert.match(checkPr('top', chore('top', (w) => write(path.join(w, 'scripts/x.sh'), 'x\n')).sha).out, /unowned: scripts\/ \(1\): scripts\/x\.sh/);
    assert.match(checkPr('mv', chore('mv', (w) => { fs.mkdirSync(path.join(w, 'misc')); g(['mv', 'api/app.rb', 'misc/app.rb'], w); }).sha).out, /unowned: misc\/ \(1\): misc\/app\.rb/);
    // a ticket PR gets coverage too (checkPr returns early for ticket/ branches): a case collision
    ok(old, ['ticket', 'add', 'api-02-case', '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['the api suite passes'], notes: 'n' })], SUP);
    const tw = path.join(old, '.worktrees', 'api-02-case');
    g(['worktree', 'add', '-q', '-b', 'ticket/api-02-case', tw, 'origin/main'], old);
    // through the index, not the disk: on a case-insensitive file system (macOS) api/App.rb is api/app.rb
    const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: tw, input: 'beside app.rb\n', encoding: 'utf8' }).trim();
    g(['update-index', '--add', '--cacheinfo', `100644,${blob},api/App.rb`], tw);
    g(['commit', '-qm', 'api-02-case: x'], tw);
    const tr = run(old, ['check-pr', '--head-ref', 'ticket/api-02-case', '--sha', g(['rev-parse', 'HEAD'], tw), '--title', 'api-02-case: x', '--body-file', body]);
    assert.match(tr.out, /components: case: api\/App\.rb, api\/app\.rb differ only by case/, 'a ticket PR is checked for coverage');
    assert.match(checkPr('narrow', chore('narrow', (w) => edit((j) => { j.components.api.owns = ['api/lib/**']; }, w)).sha).out, /unowned: api\/ \(1\): api\/app\.rb/);
    // a gap already on main is not this PR's: it passes coverage (observe-metrics reports main's)
    write(path.join(old, 'scripts/pushed.sh'), 'x\n');
    g(['add', '-A'], old); g(['commit', '-qm', 'bypass'], old); g(['push', '-q', 'origin', 'main'], old);
    assert.doesNotMatch(checkPr('clean', chore('clean', (w) => write(path.join(w, 'api/new.rb'), 'x\n')).sha).out, /unowned/);
    g(['rm', '-q', 'scripts/pushed.sh'], old); g(['commit', '-qm', 'tidy'], old); g(['push', '-q', 'origin', 'main'], old);
    // forge git: main narrows web and moves its file; a stale branch adds a path under the old line
    edit((j) => { j.components.web.owns = ['web/src/**', 'web/package.json']; });
    g(['commit', '-qam', 'narrow web'], old); g(['push', '-q', 'origin', 'main'], old);
    chore('m5', (w) => write(path.join(w, 'web/extra.js'), 'x\n'), { from: stale });
    write(path.join(old, 'docs/devteam/run/pr/chore-m5.md'), '# chore-m5: x\n\n## One-way doors\n\nNone.\n');
    assert.match(run(old, ['merge', '--chore', 'm5', '--dry-run'], SUP).out, /unowned: web\/ \(1\): web\/extra\.js/, 'refused on the merged tree');
    chore('m5ok', (w) => write(path.join(w, 'api/stale-ok.rb'), 'x\n'), { from: stale });
    write(path.join(old, 'docs/devteam/run/pr/chore-m5ok.md'), '# chore-m5ok: x\n\n## One-way doors\n\nNone.\n');
    assert.doesNotMatch(run(old, ['merge', '--chore', 'm5ok', '--dry-run'], SUP).out, /unowned/, 'a stale branch main\'s move leaves clean is not refused');
    // merge reads committed lines; a working-tree widening has no effect
    edit((j) => { j.components.ops.owns.push('scripts/**'); });
    chore('m1', (w) => write(path.join(w, 'scripts/y.sh'), 'x\n'));
    write(path.join(old, 'docs/devteam/run/pr/chore-m1.md'), '# chore-m1: x\n\n## One-way doors\n\nNone.\n');
    assert.match(run(old, ['merge', '--chore', 'm1', '--dry-run'], SUP).out, /unowned: scripts\/ \(1\): scripts\/y\.sh/, 'committed lines, not the working tree');
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
  } finally { F.done(); }
});

test('merge and check-pr fetch main before judging: a push from another clone is in the tree they check', () => {
  const F = monoFixture('fresh-main');
  const { old, run, g, lines, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  try {
    lines(F.STD);
    // a chore narrows web to the files it sees
    const w = path.join(old, '.worktrees', 'chore-narrow');
    g(['worktree', 'add', '-q', '-b', 'chore-narrow', w, 'origin/main'], old);
    edit((j) => { j.components.web.owns = ['web/src/**', 'web/package.json']; }, w);
    g(['commit', '-qam', 'chore-narrow: x'], w);
    g(['push', '-q', 'origin', 'chore-narrow'], w);
    const sha = g(['rev-parse', 'HEAD'], w);
    write(path.join(old, 'docs/devteam/run/pr/chore-narrow.md'), '# chore-narrow: x\n\n## One-way doors\n\nNone.\n');
    // someone pushes web/extra.js to main from another clone: this checkout's origin/main is stale
    const other = path.join(F.base, 'other');
    g(['clone', '-q', F.org, other], F.base);
    for (const [k, v] of [['user.email', 'o@o'], ['user.name', 'o']]) g(['config', k, v], other);
    write(path.join(other, 'web/extra.js'), 'x\n');
    g(['add', '-A'], other); g(['commit', '-qm', 'web extra'], other); g(['push', '-q', 'origin', 'main'], other);
    const m = run(old, ['merge', '--chore', 'narrow', '--dry-run'], SUP);
    assert.notEqual(m.status, 0, `merge judged a stale main: ${m.out}`);
    assert.match(m.out, /unowned: web\/ \(1\): web\/extra\.js/, 'merge: the landing tree is onto the main it would merge onto');
    assert.notEqual(run(old, ['merge', '--chore', 'narrow'], SUP).status, 0, 'and the real merge is refused');
    g(['fetch', '-q', 'origin'], old);
    assert.doesNotMatch(g(['show', 'origin/main:docs/devteam/project/settings.md'], old), /web\/src\/\*\*/, 'nothing landed');
    // check-pr, from a checkout that has not fetched since the push, too
    g(['update-ref', 'refs/remotes/origin/main', g(['rev-parse', 'origin/main~1'], old)], old);
    const c = run(old, ['check-pr', '--head-ref', 'chore-narrow', '--sha', sha, '--title', 'chore-narrow: x', '--body-file', body]);
    assert.match(c.out, /unowned: web\/ \(1\): web\/extra\.js/, 'check-pr fetches main first');
  } finally { F.done(); }
});

test('a fetch of main that fails refuses merge and check-pr, never judges the stale ref', () => {
  const F = monoFixture('fetch-fails');
  const { old, run, g, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  try {
    const w = path.join(old, '.worktrees', 'chore-tick');
    g(['worktree', 'add', '-q', '-b', 'chore-tick', w, 'origin/main'], old);
    edit((j) => { j.tick_minutes = 7; }, w);
    g(['commit', '-qam', 'chore-tick: x'], w);
    g(['push', '-q', 'origin', 'chore-tick'], w);
    const sha = g(['rev-parse', 'HEAD'], w);
    write(path.join(old, 'docs/devteam/run/pr/chore-tick.md'), '# chore-tick: x\n\n## One-way doors\n\nNone.\n');
    { const r0 = run(old, ['merge', '--chore', 'tick', '--dry-run'], SUP); assert.equal(r0.status, 0, `with origin reachable it would merge: ${r0.out}${r0.err}`); }
    // origin becomes unreachable (offline, a broken credential helper): this checkout's origin/main is all it has
    g(['remote', 'set-url', 'origin', path.join(F.base, 'nope.git')], old);
    const refused = /could not fetch origin main: .*nope\.git.*; refusing to judge against a stale main/;
    for (const args of [['merge', '--chore', 'tick', '--dry-run'], ['merge', '--chore', 'tick']]) {
      const r = run(old, args, SUP);
      assert.notEqual(r.status, 0, `${args.join(' ')}: ${r.out}`);
      assert.match(r.err, refused, args.join(' '));
    }
    const c = run(old, ['check-pr', '--head-ref', 'chore-tick', '--sha', sha, '--title', 'chore-tick: x', '--body-file', body]);
    assert.notEqual(c.status, 0, c.out);
    assert.match(c.err, refused, 'check-pr');
    // a checkout with no origin at all has nothing to fetch from: it judges its own main
    g(['remote', 'remove', 'origin'], old);
    const c2 = run(old, ['check-pr', '--head-ref', 'chore-tick', '--sha', sha, '--title', 'chore-tick: x', '--body-file', body]);
    assert.doesNotMatch(c2.err, /could not fetch/, `no origin: check-pr skips the fetch: ${c2.err}`);
    assert.equal(c2.status, 0, `no origin: check-pr judges the local main: ${c2.out}${c2.err}`);
    const d2 = run(old, ['merge', '--chore', 'tick', '--dry-run'], SUP);
    assert.doesNotMatch(d2.err, /could not fetch/, `no origin: merge --dry-run skips the fetch: ${d2.err}`);
  } finally { F.done(); }
});
