// The registry at landing: url links tied to the acts that wrote them, removals, conflicts.
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
import { line, write, json, monoFixture, until } from './lib/kit.mjs';

test('the registry at landing: checked whatever the PR, url edits tied to registry-edit acts, tickets judged by main', () => {
  const F = monoFixture('registry-landing');
  const { old, ok, run, g, lines, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  const chore = (slug, fn) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
    fn(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', `chore-${slug}: x`], w);
    g(['push', '-q', 'origin', `chore-${slug}`], w);
    write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
    return { w, sha: g(['rev-parse', 'HEAD'], w) };
  };
  const dry = (slug) => { const r = run(old, ['merge', '--chore', slug, '--dry-run'], SUP); return r.out + r.err; };
  try {
    lines(F.STD, { links: { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a' }, console: { kind: 'repo', title: 'Console', remote: 'usbclub/console' } } });
    // a url link edited by hand and landed with no act is refused; the same edit made with link set passes
    chore('hand', (w) => edit((j) => { j.links.figma.title = 'All designs'; }, w));
    assert.match(dry('hand'), /links\.figma.*no registry-edit act.*link add\|set\|rm/, 'a hand edit to a url link has no act');
    ok(old, ['link', 'set', 'figma', 'title', 'All designs'], SUP);
    assert.doesNotMatch(dry('hand'), /registry-edit/, 'the act link set logged lands it');
    g(['checkout', '-q', '--', 'docs/devteam/project/settings.md'], old);
    // a bad registry is refused at landing, whatever the PR
    const bad = chore('bad', (w) => edit((j) => { j.links.notes = { kind: 'doc', title: 'D' }; }, w));
    assert.match(run(old, ['check-pr', '--head-ref', 'chore-bad', '--sha', bad.sha, '--title', 'chore-bad: x', '--body-file', body]).out, /links\.notes: unknown kind "doc"/);
    // a component on a repo link lands (components in other repos); its registry is still checked at landing
    const comp = chore('console-comp', (w) => edit((j) => { j.components.desktop = { link: 'console' }; }, w));
    assert.match(run(old, ['check-pr', '--head-ref', 'chore-console-comp', '--sha', comp.sha, '--title', 'chore-console-comp: x', '--body-file', body]).out, /^ok: chore-console-comp passes the checks/);
    // a ticket PR is judged by main's settings, so rewriting settings.md can't switch its footprint off
    ok(old, ['ticket', 'add', 'api-01-sneak', '--json', JSON.stringify({ title: 'x', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**', 'docs/devteam/project/settings.md'], done_when: ['the api suite passes'], notes: 'n' })], SUP);
    const tw = path.join(old, '.worktrees', 'api-01-sneak');
    g(['worktree', 'add', '-q', '-b', 'ticket/api-01-sneak', tw, 'origin/main'], old);
    edit((j) => { j.components = { api: { stack: 'rails' }, web: { stack: 'next' } }; }, tw);
    write(path.join(tw, 'api/app.rb'), 'changed\n');
    g(['commit', '-qam', 'api-01-sneak: x'], tw);
    const ct = run(old, ['check-ticket', 'api-01-sneak', '--sha', g(['rev-parse', 'HEAD'], tw), '--title', 'api-01-sneak: x', '--body-file', body]).out;
    assert.match(ct, /changes files outside the line of api: docs\/devteam\/project\/settings\.md/, 'main\'s lines judge a ticket');
    // validate in a chore worktree that narrows a line and moves its files judges the tree that
    // would land, as coverageFails does; in the main checkout it judges main under main's settings
    const mv = chore('move', (w) => { edit((j) => { j.components.api.owns = ['api/lib/**', 'api/core/**']; }, w); fs.mkdirSync(path.join(w, 'api/core')); g(['mv', 'api/app.rb', 'api/core/app.rb'], w); });
    assert.doesNotMatch(run(mv.w, ['validate']).out, /components: /, 'the landing tree under the landing settings has no gap');
    assert.doesNotMatch(run(old, ['validate']).out, /components: /, 'main under main\'s settings has none either');
  } finally { F.done(); }
});

test('a url link lands only as a registry-edit act wrote it: matched by the entry, main to landing, with no time window', () => {
  const F = monoFixture('registry-acts');
  const { old, ok, run, g, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const chore = (slug, fn, { from = 'origin/main' } = {}) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, from], old);
    fn(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', `chore-${slug}: x`], w);
    g(['push', '-q', 'origin', `chore-${slug}`], w);
    write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
    return w;
  };
  const merge = (slug, extra = []) => { const r = run(old, ['merge', '--chore', slug, ...extra], SUP); return { status: r.status, text: r.out + r.err }; };
  const settingsRel = 'docs/devteam/project/settings.md';
  try {
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a' } }; });
    g(['commit', '-qam', 'figma, by hand on main'], old); g(['push', '-q', 'origin', 'main'], old);
    const before = g(['rev-parse', 'origin/main'], old);
    // the act records the entry it wrote: a hash of its canonical JSON, null for a removal
    ok(old, ['link', 'set', 'figma', 'notes', 'see page 2'], SUP);
    const act = json(ok(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'registry-edit').pop();
    const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
    const entry = { kind: 'url', title: 'Designs', url: 'https://figma.test/a', notes: 'see page 2' };
    assert.equal(act.entry_hash, `sha256:${crypto.createHash('sha256').update(canon(entry)).digest('hex')}`);
    g(['checkout', '-q', '--', settingsRel], old);
    // a stale act for figma's notes can't authorise a hand edit of its url
    chore('hand-url', (w) => edit((j) => { j.links.figma.url = 'https://evil.test/x'; }, w));
    const h = merge('hand-url', ['--dry-run']);
    assert.notEqual(h.status, 0, h.text);
    assert.match(h.text, /links\.figma to an entry no registry-edit act wrote/);
    // an act with no entry_hash (as every act before this rule) names the link but never matches
    ok(old, ['act', '--class', 'registry-edit', '--refs', 'link:figma', '--', 'set link figma url'], SUP);
    assert.match(merge('hand-url', ['--dry-run']).text, /links\.figma to an entry no registry-edit act wrote/, 'an old act never matches');
    // an unrelated settings chore lands first; the pending notes act still lands its own edit
    chore('tick', (w) => edit((j) => { j.tick_minutes = 7; }, w));
    assert.equal(merge('tick').status, 0, 'the unrelated chore merges');
    chore('notes', (w) => edit((j) => { j.links.figma.notes = 'see page 2'; }, w));
    const n = merge('notes', ['--dry-run']);
    assert.equal(n.status, 0, `an act outlives an unrelated settings landing: ${n.text}`);
    // a link identical on main needs no act: main's figma title changes by hand; a branch from
    // before makes the same change and adds notion, which link add wrote (its act)
    g(['merge', '-q', '--ff-only', 'origin/main'], old);
    edit((j) => { j.links.figma.title = 'All designs'; });
    g(['commit', '-qam', 'figma title, by hand on main'], old); g(['push', '-q', 'origin', 'main'], old);
    ok(old, ['link', 'add', 'notion', '--kind', 'url', '--url', 'https://notion.test/r', '--title', 'Runbook'], SUP);
    g(['checkout', '-q', '--', settingsRel], old);
    chore('both', (w) => edit((j) => { j.links = { notion: { kind: 'url', url: 'https://notion.test/r', title: 'Runbook' }, figma: { ...j.links.figma, title: 'All designs' } }; }, w), { from: before });
    const r = merge('both', ['--dry-run']);
    assert.equal(r.status, 0, `figma is as main has it and notion has its act: ${r.text}`);
    // a removal lands with the act that removed it (entry_hash null)
    g(['checkout', '-q', '--', settingsRel], old);
    ok(old, ['link', 'rm', 'figma'], SUP);
    assert.equal(json(ok(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'registry-edit').pop().entry_hash, null);
    g(['checkout', '-q', '--', settingsRel], old);
    chore('rm-figma', (w) => edit((j) => { delete j.links.figma; }, w));
    assert.doesNotMatch(merge('rm-figma', ['--dry-run']).text, /registry-edit/, 'the rm act lands the removal');
  } finally { F.done(); }
});

test('a removal lands only by an rm act for the entry main has: a stale link rm never re-deletes a re-added link', () => {
  const F = monoFixture('registry-rm');
  const { old, ok, run, g, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const settingsRel = 'docs/devteam/project/settings.md';
  const chore = (slug, fn) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], old);
    fn(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', `chore-${slug}: x`], w);
    g(['push', '-q', 'origin', `chore-${slug}`], w);
    write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
    return w;
  };
  const merge = (slug, extra = []) => { const r = run(old, ['merge', '--chore', slug, ...extra], SUP); return { status: r.status, text: r.out + r.err }; };
  const lastAct = () => json(ok(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'registry-edit').pop();
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
  const hash = (e) => `sha256:${crypto.createHash('sha256').update(canon(e)).digest('hex')}`;
  try {
    const v1 = { kind: 'url', title: 'Designs', url: 'https://figma.test/a' };
    edit((j) => { j.links = { figma: v1 }; });
    g(['commit', '-qam', 'figma'], old); g(['push', '-q', 'origin', 'main'], old);
    // link rm records the entry it removed
    ok(old, ['link', 'rm', 'figma'], SUP); g(['checkout', '-q', '--', settingsRel], old);
    assert.equal(lastAct().entry_hash, null);
    assert.equal(lastAct().prior_hash, hash(v1));
    chore('rm', (w) => edit((j) => { delete j.links.figma; }, w));
    assert.equal(merge('rm').status, 0, 'the rm act lands its removal');
    g(['merge', '-q', '--ff-only', 'origin/main'], old);
    // figma is added again, and lands
    ok(old, ['link', 'add', 'figma', '--kind', 'url', '--url', 'https://figma.test/v2', '--title', 'Designs v2'], SUP); g(['checkout', '-q', '--', settingsRel], old);
    chore('add', (w) => edit((j) => { j.links.figma = { kind: 'url', url: 'https://figma.test/v2', title: 'Designs v2' }; }, w));
    assert.equal(merge('add').status, 0);
    g(['merge', '-q', '--ff-only', 'origin/main'], old);
    // a hand deletion of the re-added link: the old rm act removed a different entry
    chore('hand-rm', (w) => edit((j) => { delete j.links.figma; }, w));
    const h = merge('hand-rm', ['--dry-run']);
    assert.notEqual(h.status, 0, `a stale rm act landed a removal: ${h.text}`);
    assert.match(h.text, /links\.figma to an entry no registry-edit act wrote/);
    // an rm act from before prior_hash existed (null, no prior_hash) never lands a removal either
    ok(old, ['act', '--class', 'registry-edit', '--refs', 'link:figma', '--', 'removed url link figma'], SUP);
    assert.match(merge('hand-rm', ['--dry-run']).text, /links\.figma to an entry no registry-edit act wrote/);
    // link rm of the entry main has now lands it
    ok(old, ['link', 'rm', 'figma'], SUP); g(['checkout', '-q', '--', settingsRel], old);
    const again = merge('hand-rm', ['--dry-run']);
    assert.equal(again.status, 0, `the rm act for main's entry lands it: ${again.text}`);
  } finally { F.done(); }
});

test('without lines, a key or link both main and the branch changed is refused, dry run and merge alike', () => {
  const F = monoFixture('settings-both');
  const { old, ok, run, g, edit } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const settingsRel = 'docs/devteam/project/settings.md';
  const chore = (slug, fn, { from = 'origin/main' } = {}) => {
    const w = path.join(old, '.worktrees', `chore-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, from], old);
    fn(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', `chore-${slug}: x`], w);
    g(['push', '-q', 'origin', `chore-${slug}`], w);
    write(path.join(old, `docs/devteam/run/pr/chore-${slug}.md`), `# chore-${slug}: x\n\n## One-way doors\n\nNone.\n`);
    return w;
  };
  const merge = (slug, extra = []) => { const r = run(old, ['merge', '--chore', slug, ...extra], SUP); return { status: r.status, text: r.out + r.err }; };
  const mainFigma = () => { g(['fetch', '-q', 'origin'], old); return JSON.parse(g(['show', `origin/main:${settingsRel}`], old).match(/```json devteam\s*\n([\s\S]*?)\n```/)[1]).links.figma; };
  try {
    edit((j) => { j.links = { figma: { kind: 'url', title: 'Designs', url: 'https://figma.test/a', for: ['all'], notes: 'n0' } }; });
    g(['commit', '-qam', 'figma'], old); g(['push', '-q', 'origin', 'main'], old);
    const before = g(['rev-parse', 'origin/main'], old);
    // main moves figma's url, with its act
    ok(old, ['link', 'set', 'figma', 'url', 'https://figma.test/b'], SUP); g(['checkout', '-q', '--', settingsRel], old);
    chore('url', (w) => edit((j) => { j.links.figma.url = 'https://figma.test/b'; }, w));
    assert.equal(merge('url').status, 0);
    // a branch from before changes figma's notes (its act records {url a, notes n1}): git's text merge
    // of the two lines is clean and would land {url b, notes n1}, an entry no act wrote
    ok(old, ['link', 'set', 'figma', 'notes', 'n1'], SUP); g(['checkout', '-q', '--', settingsRel], old);
    chore('notes', (w) => edit((j) => { j.links.figma.notes = 'n1'; }, w), { from: before });
    const refused = /settings\.md: both main and this branch changed links\.figma; merge main into the branch first/;
    for (const extra of [['--dry-run'], []]) {
      const r = merge('notes', extra);
      assert.notEqual(r.status, 0, `${extra.join(' ') || 'merge'}: ${r.text}`);
      assert.match(r.text, refused, extra.join(' ') || 'merge');
    }
    assert.deepEqual(mainFigma(), { kind: 'url', title: 'Designs', url: 'https://figma.test/b', for: ['all'], notes: 'n0' }, 'nothing landed');
    // a branch from before whose edit git can't merge either: the same refusal, not git's raw error
    ok(old, ['link', 'set', 'figma', 'url', 'https://figma.test/c'], SUP); g(['checkout', '-q', '--', settingsRel], old);
    chore('url2', (w) => edit((j) => { j.links.figma.url = 'https://figma.test/c'; }, w), { from: before });
    for (const extra of [['--dry-run'], []]) assert.match(merge('url2', extra).text, refused, `a conflicting branch: ${extra.join(' ') || 'merge'}`);
    assert.deepEqual(g(['worktree', 'list'], old).split('\n').filter((l) => /land-/.test(l)), [], 'no landing worktree left');
    // a top-level key both sides changed is refused the same way; changed identically, it lands
    g(['merge', '-q', '--ff-only', 'origin/main'], old);
    const mid = g(['rev-parse', 'origin/main'], old);
    edit((j) => { j.tick_minutes = 7; }); g(['commit', '-qam', 'tick 7'], old); g(['push', '-q', 'origin', 'main'], old);
    chore('tick9', (w) => edit((j) => { j.tick_minutes = 9; }, w), { from: mid });
    assert.match(merge('tick9', ['--dry-run']).text, /settings\.md: both main and this branch changed tick_minutes; merge main into the branch first/);
    chore('tick7', (w) => edit((j) => { j.tick_minutes = 7; j.stale_after_minutes = 40; }, w), { from: mid });
    const same = merge('tick7', ['--dry-run']);
    assert.equal(same.status, 0, `the same change on both sides: ${same.text}`);
  } finally { F.done(); }
});

test('deleting the last file under a glob: never refused, a line-empty warning that blocks nothing', () => {
  const F = monoFixture('line-empty');
  const { old, ok, run, g, lines } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const body = path.join(F.base, 'body.md');
  write(body, '## One-way doors\n\nNone.\n');
  try {
    lines({ ...F.STD, api: { owns: ['api/app.rb', 'api/lib/**'] } });
    ok(old, ['ticket', 'add', 'api-01-a', '--json', JSON.stringify({ title: 'a', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['the api suite passes'], notes: 'n' })], SUP);
    const w = path.join(old, '.worktrees', 'chore-dead');
    g(['worktree', 'add', '-q', '-b', 'chore-dead', w, 'origin/main'], old);
    g(['rm', '-q', 'api/lib/x.rb'], w);
    g(['commit', '-qm', 'chore-dead: x'], w);
    const r = run(old, ['check-pr', '--head-ref', 'chore-dead', '--sha', g(['rev-parse', 'HEAD'], w), '--title', 'chore-dead: x', '--body-file', body]);
    assert.equal(r.status, 0, `deleting the last file a glob matches is not refused: ${r.out}`);
    // landed: validate warns with the fix, and nothing waits on it
    g(['rm', '-q', 'api/lib/x.rb'], old); g(['commit', '-qm', 'dead code'], old); g(['push', '-q', 'origin', 'main'], old);
    const v = run(old, ['validate']);
    assert.match(v.out, /warning: components: line-empty: api owns "api\/lib\/\*\*", which matches nothing.*remove or fix the glob/);
    assert.doesNotMatch(v.out, /error: components/);
    assert.match(ok(old, ['ready']), /build +api-01-a/, 'an empty glob blocks no ticket');
    const f = json(ok(old, ['metrics', '--json'])).findings;
    assert.equal(f.find((x) => x.kind === 'line-empty')?.severity, 'low');
    assert.ok(!f.some((x) => x.kind === 'unowned-files'));
  } finally { F.done(); }
});

test('unowned files on main: a severity-4 finding, and no new ticket starts there until a line covers them', () => {
  const F = monoFixture('unowned');
  const { old, ok, run, g, lines } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    lines(F.STD);
    ok(old, ['ticket', 'add', 'api-01-a', '--json', JSON.stringify({ title: 'a', feature: 'chores', component: 'api', kind: 'chore', size: 'S', risk: 'normal', serves: [], depends_on: [], touches: ['api/**'], done_when: ['the api suite passes'], notes: 'n' })], SUP);
    assert.match(ok(old, ['ready']), /build +api-01-a/);
    write(path.join(old, 'scripts/x.sh'), 'x\n');
    g(['add', '-A'], old); g(['commit', '-qm', 'pushed past devteam'], old); g(['push', '-q', 'origin', 'main'], old);
    const f = json(ok(old, ['metrics', '--json'])).findings.find((x) => x.kind === 'unowned-files');
    assert.ok(f, 'the finding');
    assert.equal(f.subject, 'home');
    assert.match(f.detail, /origin\/main has coverage gaps: 1 unowned \(devteam\.mjs components check lists them\)/, 'the finding names what it counted');
    ok(old, ['observe-metrics'], SUP);
    assert.equal(json(ok(old, ['log', '--type', 'observation', '--json'])).find((o) => o.kind === 'unowned-files').severity, 4);
    const r = json(ok(old, ['ready', '--json']));
    assert.deepEqual(r.waiting, [{ id: 'api-01-a', why: 'unowned files' }]);
    assert.match(ok(old, ['ready']), /unowned files api-01-a .*a chore PR that extends a line/);
    assert.match(run(old, ['worker', 'api-01-a'], SUP).err, /home's main has coverage gaps \(1 unowned\)/);
    lines({ ...F.STD, ops: { owns: [...F.STD.ops.owns, 'scripts/**'] } });
    assert.match(ok(old, ['ready']), /build +api-01-a/, 'a line that covers them clears it');
  } finally { F.done(); }
});
