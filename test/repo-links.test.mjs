// Repo links are the owner's: asked, approved by what the owner saw, landed only as approved.
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
import { line, write, json, multiFixture, until } from './lib/kit.mjs';

test('link add --kind repo asks the owner a governance-edit question and writes nothing until it is answered', () => {
  const F = multiFixture('link-repo');
  const { old, g, okIn, runIn } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const add = ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site', '--main_branch', 'trunk'];
  try {
    const before = fs.readFileSync(F.settingsFile, 'utf8');
    const draft = okIn(old, add, SUP);
    const qid = /q-[0-9]+-[0-9]+-supervisor/.exec(draft)[0];
    assert.equal(fs.readFileSync(F.settingsFile, 'utf8'), before, 'nothing written before the answer');
    assert.match(okIn(old, add, SUP), new RegExp(`${qid}: already asked the owner about this exact change`), 'asking twice reuses the question');
    const q = json(okIn(old, ['questions', '--id', qid, '--json']))[0];
    assert.deepEqual([q.kind, q.class], ['owner-decision', 'governance-edit']);
    assert.match(q.context, /"docs": \{[\s\S]*"kind": "repo"[\s\S]*"remote": "usbclub\/docs"/);
    assert.match(runIn(old, [...add, '--approved', qid], SUP).err, /is not a question the owner answered/);
    okIn(old, ['answer', qid, 'yes']);
    assert.match(runIn(old, ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/other', '--title', 'Docs site', '--approved', qid], SUP).err, /asked about another change; ask again for this one/, 'an answer approves the draft it was asked about');
    okIn(old, [...add, '--approved', qid], SUP);
    assert.match(okIn(old, [...add, '--approved', qid], SUP), /links\.docs is already that in settings\.md here/, 'a second apply is a no-op (the entry is in the raw block, not yet on main)');
    assert.equal(JSON.parse(/```json devteam\s*\n([\s\S]*?)\n```/.exec(fs.readFileSync(F.settingsFile, 'utf8'))[1]).links.docs.remote, 'usbclub/docs');
    const act = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.approved_by === qid);
    assert.deepEqual([act.class, act.refs], ['governance-edit', ['chore-registry', 'link:docs']]);
    // and the registry chore lands with that one answer
    const wt = path.join(old, '.worktrees', 'chore-registry');
    g(['worktree', 'add', '-q', '-b', 'chore-registry', wt, 'origin/main'], old);
    // link land carries the entry the owner approved (and only an approved one)
    assert.match(okIn(old, ['link', 'land', 'registry'], SUP), /links\.docs \(added\)/);
    assert.equal(JSON.parse(/```json devteam\s*\n([\s\S]*?)\n```/.exec(fs.readFileSync(path.join(wt, 'docs/devteam/project/settings.md'), 'utf8'))[1]).links.docs.remote, 'usbclub/docs');
    g(['commit', '-qam', 'chore-registry: docs repo'], wt);
    g(['push', '-q', 'origin', 'chore-registry'], wt);
    write(path.join(old, 'docs/devteam/run/pr/chore-registry.md'), '# chore-registry: docs repo\n\n## One-way doors\n\nNone.\n');
    const dry = runIn(old, ['merge', '--chore', 'registry', '--dry-run', '--approved', qid], SUP);
    assert.doesNotMatch(dry.out + dry.err, /changes owner settings|already approved/);
    assert.match(dry.out, /ok: chore-registry at \w{12} would merge/);
    // a repo link edited by hand in settings.md, with no answer: link land leaves it for the owner
    F.edit((j) => { j.links.companion.title = 'Hand edit'; });
    const w2 = path.join(old, '.worktrees', 'chore-hand');
    g(['worktree', 'add', '-q', '-b', 'chore-hand', w2, 'origin/main'], old);
    assert.match(okIn(old, ['link', 'land', 'hand'], SUP), /not carried, as the owner's .*links\.companion/);
    // a gate field is the owner's gate-change; a repo link's path is no one's, a logged registry-edit
    assert.match(okIn(old, ['link', 'set', 'console', 'gates', '{"test":"true"}'], SUP), /asked the owner \(gate-change\)/);
    okIn(old, ['link', 'set', 'console', 'path', '../console'], SUP);
    assert.ok(json(okIn(old, ['log', '--type', 'act', '--json'])).some((a) => a.class === 'registry-edit' && a.refs.includes('link:console') && /set path on link console/.test(a.what)));
  } finally { F.done(); }
});

test('what the owner saw binds what lands: a hand-written act, or a question changed after the answer, widens nothing', () => {
  const F = multiFixture('link-forge');
  const { old, g, okIn, runIn } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const add = ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site'];
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
  const hash = (e) => `sha256:${crypto.createHash('sha256').update(canon(e)).digest('hex')}`;
  try {
    const qid = /q-[0-9]+-[0-9]+-supervisor/.exec(okIn(old, add, SUP))[0];
    okIn(old, ['answer', qid, 'yes']);
    okIn(old, [...add, '--approved', qid], SUP);
    const wt = path.join(old, '.worktrees', 'chore-registry');
    g(['worktree', 'add', '-q', '-b', 'chore-registry', wt, 'origin/main'], old);
    okIn(old, ['link', 'land', 'registry'], SUP);
    const wf = path.join(wt, 'docs/devteam/project/settings.md');
    const text = fs.readFileSync(wf, 'utf8');
    const m = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    const blk = JSON.parse(m[1]);
    const mainConsole = structuredClone(blk.links.console);
    blk.links.console.gates = { test: 'true' };
    fs.writeFileSync(wf, text.replace(m[1], JSON.stringify(blk, null, 2)));
    g(['commit', '-qam', 'chore-registry: docs repo'], wt);
    g(['push', '-q', 'origin', 'chore-registry'], wt);
    write(path.join(old, 'docs/devteam/run/pr/chore-registry.md'), '# chore-registry: docs repo\n\n## One-way doors\n\nNone.\n');
    const logDir = path.join(old, 'docs/devteam/run/log');
    const supFile = path.join(logDir, fs.readdirSync(logDir).find((f) => /^supervisor-/.test(f)));
    const before = fs.readFileSync(supFile, 'utf8');
    // a hand-written act binding console's edited entry to the owner's yes about docs
    fs.appendFileSync(supFile, line({ id: 'a-20261105-120000001-supervisor', type: 'act', op: 'new', at: new Date().toISOString(), by: 'supervisor', class: 'governance-edit', what: 'links.console', refs: ['chore-registry', 'link:console'], reversible: true, approved_by: qid, entry_hash: hash(blk.links.console), prior_hash: hash(mainConsole) }));
    const forged = runIn(old, ['merge', '--chore', 'registry', '--dry-run', '--approved', qid], SUP);
    assert.notEqual(forged.status, 0);
    assert.match(forged.out + forged.err, new RegExp(`changes links\\.console\\.gates, which ${qid} did not approve`));
    fs.writeFileSync(supFile, before);
    // the question's context rewritten after the answer to show console too: widens nothing
    const shown = `links.console: main has ${canon(mainConsole)}; would be ${canon(blk.links.console)}`;
    const q = json(okIn(old, ['questions', '--id', qid, '--json']))[0];
    fs.appendFileSync(supFile, line({ id: qid, type: 'question', op: 'set', at: new Date(Date.now() + 1000).toISOString(), by: 'supervisor', context: `${q.context}\n${shown}` }));
    // the log refuses the line (a question's context is the asker's, written once), so the owner's record stands
    assert.match(runIn(old, ['log-check']).out, /may not set question\.context/);
    const widened = runIn(old, ['merge', '--chore', 'registry', '--dry-run', '--approved', qid], SUP);
    assert.notEqual(widened.status, 0);
    assert.match(widened.out + widened.err, new RegExp(`changes links\\.console\\.gates, which ${qid} did not approve|question was changed after the owner answered it`));
    fs.writeFileSync(supFile, before);
  } finally { F.done(); }
});

test('the owner\'s "no" adds no repo link: link --approved and merge --approved both refuse it', () => {
  const F = multiFixture('link-no');
  const { old, okIn, runIn } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const add = ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site'];
  try {
    const qid = /q-[0-9]+-[0-9]+-supervisor/.exec(okIn(old, add, SUP))[0];
    okIn(old, ['answer', qid, 'no, do not add it']);
    const r = runIn(old, [...add, '--approved', qid], SUP);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /was answered "no, do not add it", not its recommendation \("yes"\): that approves nothing/);
    assert.ok(!/"docs"/.test(fs.readFileSync(path.join(old, 'docs/devteam/project/settings.md'), 'utf8')), 'nothing written');
    assert.ok(!json(okIn(old, ['log', '--type', 'act', '--json'])).some((a) => a.approved_by === qid), 'no act');
    const m = runIn(old, ['merge', '--chore', 'registry', '--dry-run', '--approved', qid], SUP);
    assert.notEqual(m.status, 0);
    assert.match(m.out + m.err, /not its recommendation|no open PR|no branch/);
  } finally { F.done(); }
});

test('merge --approved lands only the repo link entries the answer approved: a hand edit beside them is refused by name', () => {
  const F = multiFixture('link-bundle');
  const { old, g, okIn, runIn } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  const add = ['link', 'add', 'docs', '--kind', 'repo', '--remote', 'usbclub/docs', '--title', 'Docs site'];
  try {
    const qid = /q-[0-9]+-[0-9]+-supervisor/.exec(okIn(old, add, SUP))[0];
    const q = json(okIn(old, ['questions', '--id', qid, '--json']))[0];
    assert.match(q.context, /links\.docs: main has null; would be \{"kind":"repo","remote":"usbclub\/docs","title":"Docs site"\}/, 'the question carries the settings diff it covers');
    okIn(old, ['answer', qid, 'yes']);
    okIn(old, [...add, '--approved', qid], SUP);
    const act = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.approved_by === qid);
    assert.equal(act.prior_hash, null, 'the act records the entry main has (none: an add)');
    // a second question shows the whole bundle waiting to land: docs as well as console's gates
    const q2id = /q-[0-9]+-[0-9]+-supervisor/.exec(okIn(old, ['link', 'set', 'console', 'gates', '{"test":"true"}'], SUP))[0];
    const q2 = json(okIn(old, ['questions', '--id', q2id, '--json']))[0];
    assert.match(q2.context, /links\.console: main has .*would be .*"gates":\{"test":"true"\}/);
    assert.match(q2.context, /links\.docs: main has null; would be /, 'the bundle includes the change already waiting');
    // the registry chore with docs, plus hand edits to console's gates and companion's remote
    const wt = path.join(old, '.worktrees', 'chore-registry');
    g(['worktree', 'add', '-q', '-b', 'chore-registry', wt, 'origin/main'], old);
    assert.match(okIn(old, ['link', 'land', 'registry'], SUP), /links\.docs \(added\)/);
    const wf = path.join(wt, 'docs/devteam/project/settings.md');
    const text = fs.readFileSync(wf, 'utf8');
    const m = /```json devteam\s*\n([\s\S]*?)\n```/.exec(text);
    const blk = JSON.parse(m[1]);
    blk.links.console.gates = { test: 'true' };
    blk.links.companion.remote = F.consoleOrigin;
    fs.writeFileSync(wf, text.replace(m[1], JSON.stringify(blk, null, 2)));
    g(['commit', '-qam', 'chore-registry: docs repo'], wt);
    g(['push', '-q', 'origin', 'chore-registry'], wt);
    write(path.join(old, 'docs/devteam/run/pr/chore-registry.md'), '# chore-registry: docs repo\n\n## One-way doors\n\nNone.\n');
    const dry = runIn(old, ['merge', '--chore', 'registry', '--dry-run', '--approved', qid], SUP);
    assert.notEqual(dry.status, 0);
    assert.match(dry.out + dry.err, new RegExp(`changes links\\.companion\\.remote, links\\.console\\.gates, which ${qid} did not approve`));
    assert.doesNotMatch(dry.out + dry.err, /links\.docs[,.]? .*did not approve|links\.docs, which/, 'the approved entry is bound');
    // without the hand edits, the same answer lands docs
    fs.writeFileSync(wf, text);
    g(['commit', '-qam', 'chore-registry: only docs'], wt);
    g(['push', '-q', 'origin', 'chore-registry'], wt);
    const ok2 = runIn(old, ['merge', '--chore', 'registry', '--dry-run', '--approved', qid], SUP);
    assert.match(ok2.out, /ok: chore-registry at \w{12} would merge/, ok2.err);
  } finally { F.done(); }
});

test('a repo measure names the link it runs in (measure.link): read on that repo\'s main, default home', () => {
  const F = multiFixture('measure-link');
  const { old, g, okIn, runIn } = F;
  const SUP = { DEVTEAM_ROLE: 'supervisor' };
  try {
    const rest = ['--horizon', '2027-03-31', '--non-goals', 'none', '--preconditions', 'it builds'];
    const G = okIn(old, ['goal', 'add', '--title', 'Console sources', '--outcome', 'one entry point', '--measure', 'files in src/', '--target', '1', '--unit', 'files', '--direction', 'down', '--source', 'repo', '--link', 'console', '--check', 'ls src | wc -l', ...rest, '--priority', '7'], SUP);
    assert.equal(json(okIn(old, ['goal', 'show', G])).measure.link, 'console');
    const trunk = g(['rev-parse', 'origin/trunk'], F.console);
    assert.match(okIn(old, ['goal', 'reading', G, '--run'], SUP), new RegExp(`recorded 1 for ${G} \\(console's main at ${trunk.slice(0, 12)}\\)`), "console's tree (home has no src/), at console's main");
    assert.deepEqual(json(okIn(old, ['goal', 'show', G])).readings.map((r) => [r.value, r.sha]), [[1, trunk]], "a reading counts when its sha is on its own repo's main");
    // home is the default: the same check on home's main finds no src/
    const H = okIn(old, ['goal', 'add', '--title', 'Home sources', '--outcome', 'x', '--measure', 'files in api/', '--target', '1', '--unit', 'files', '--direction', 'up', '--source', 'repo', '--check', 'ls api | wc -l', ...rest, '--priority', '8'], SUP);
    assert.match(okIn(old, ['goal', 'reading', H, '--run'], SUP), new RegExp(`recorded 2 for ${H} \\(main at ${g(['rev-parse', 'origin/main'], old).slice(0, 12)}\\)`));
    // a link that is no repo, or a link on a measure that isn't a repo's: definition gaps
    okIn(old, ['goal', 'set', H, '--link', 'nope'], SUP);
    assert.match(okIn(old, ['goal', 'check', H]), /measure\.link "nope" is not a repo link/);
    const P = okIn(old, ['goal', 'add', '--title', 'Prod', '--outcome', 'y', '--measure', 'm', '--target', '1', '--unit', 'n', '--direction', 'up', '--source', 'prod', '--link', 'console', '--check', 'echo 1', ...rest, '--priority', '9'], SUP);
    assert.match(okIn(old, ['goal', 'check', P]), /measure\.link is for a repo measure/);
    // no console checkout here: reading it fails fast, saying what to clone where
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: path.join(F.base, 'not-cloned') } }));
    assert.match(runIn(old, ['goal', 'reading', G, '--run'], SUP).err, /repo console: no checkout at .*not-cloned/);
    okIn(old, ['goal', 'show', G]);
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
    // the fetch of console's main fails: refused, never read on a stale main
    fs.renameSync(F.consoleOrigin, `${F.consoleOrigin}-away`);
    try {
      assert.match(runIn(old, ['goal', 'reading', G, '--run'], SUP).err, /could not fetch origin trunk in console: .*refusing to read the measure on a stale main/);
    } finally { fs.renameSync(`${F.consoleOrigin}-away`, F.consoleOrigin); }
  } finally { F.done(); }
});
