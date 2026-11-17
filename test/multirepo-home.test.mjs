// Several repos, one home: the fixture, home's kit and run directory, repo(), lines per repo.
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
import { kit, line, write, json, review, hasTmux, multiFixture } from './lib/kit.mjs';

test('three repos: the fixture validates, and links shows each', () => {
  const F = multiFixture('multi-smoke');
  try {
    const l = json(F.okIn(F.old, ['links', '--json']));
    assert.deepEqual(l.links.map((x) => [x.id, x.found]).sort(), [['companion', true], ['console', true]]);
  } finally { F.done(); }
});

test('a worker in a sibling worktree runs home\'s kit: home\'s run directory and project; a bad DEVTEAM_HOME, or a sibling\'s own kit, is refused', () => {
  const F = multiFixture('m6');
  const { old, g, runIn, okIn } = F;
  try {
    const w = path.join(old, '.worktrees', 'console-01-x');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-01-x', w, 'origin/trunk'], F.console);
    const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'console-01-x' };
    const who = okIn(w, ['whoami'], W, { DEVTEAM_HOME: old });
    assert.match(who, new RegExp(`DEVTEAM_RUN=(${fs.realpathSync(old)}|${old})/docs/devteam/run`));
    assert.match(who, /project=.*\/old\/docs\/devteam\/project/);
    assert.match(who, /writer=console-01-x/, 'its own branch names it');
    assert.match(who, /home=.*\/old\b/, 'whoami names home');
    okIn(w, ['phase', 'build', '--task', 'T1'], W, { DEVTEAM_HOME: old });
    assert.ok(fs.readFileSync(path.join(old, 'docs/devteam/run/log/console-01-x.jsonl'), 'utf8').includes('"to":"build"'), "the phase line lands in home's live log");
    assert.equal(json(okIn(old, ['log', '--type', 'phase', '--by', 'console-01-x', '--json']))[0].sha, g(['rev-parse', 'HEAD'], w), "the phase records the worktree's own head");
    // the same from the worktree with no DEVTEAM_HOME: home is the running kit's repo, never the cwd's
    assert.match(okIn(w, ['whoami'], W), /project=.*\/old\/docs\/devteam\/project/);
    // DEVTEAM_HOME refused, never followed: a repo link's checkout, a missing directory, a non-project checkout
    assert.match(runIn(w, ['whoami'], W, { DEVTEAM_HOME: F.console }).err, /DEVTEAM_HOME=.*console is not a devteam home/, "a repo link's checkout is refused");
    assert.match(runIn(w, ['whoami'], W, { DEVTEAM_HOME: path.join(F.base, 'nowhere') }).err, /DEVTEAM_HOME=.*nowhere is not a devteam home/);
    const plain = path.join(F.base, 'plain');
    fs.mkdirSync(plain); g(['init', '-q'], plain);
    assert.match(runIn(w, ['whoami'], W, { DEVTEAM_HOME: plain }).err, /DEVTEAM_HOME=.*plain is not a devteam home .*point it at home's main checkout/);
    // a sibling that carries a stray settings.md is still a repo link's checkout, never a home
    write(path.join(F.console, 'docs/devteam/project/settings.md'), '```json devteam\n{}\n```\n');
    assert.match(runIn(w, ['whoami'], W, { DEVTEAM_HOME: F.console }).err, /DEVTEAM_HOME=.*console is the checkout of repo link console, not a devteam home/);
    fs.rmSync(path.join(F.console, 'docs/devteam/project/settings.md'));
    // a project moved with DEVTEAM_PROJECT is still a home
    okIn(w, ['whoami'], W, { DEVTEAM_HOME: old, DEVTEAM_PROJECT: path.join(old, 'docs/devteam/project') });
    // the kit's own line holds from a sibling worktree: validate doesn't read the kit as unowned
    assert.doesNotMatch(runIn(w, ['validate'], W, { DEVTEAM_HOME: old }).out, /unowned: docs\/devteam/, "kitRel is relative to home's checkout, not the cwd's");
    // a sibling's own copy of the kit (its project folder holds tickets/, never settings.md): refused, never run as a home
    fs.cpSync(path.join(old, 'docs/devteam'), path.join(F.console, 'docs/devteam'), { recursive: true, filter: (x) => !/[\\/](project|run)([\\/]|$)/.test(x.slice(path.join(old, 'docs/devteam').length)) });
    write(path.join(F.console, 'docs/devteam/project/tickets/console-01-x/spec.md'), '# spec\n');
    const own = spawnSync(process.execPath, [path.join(F.console, 'docs/devteam/scripts/devteam.mjs'), 'status'], { cwd: F.console, env: F.env({}), encoding: 'utf8' });
    assert.notEqual(own.status, 0);
    assert.match(own.stderr, /no docs\/devteam\/project\/settings\.md here .*: run init to adopt devteam in this repo, or run home's kit with DEVTEAM_HOME=<home>/);
    // DEVTEAM_HOME names home, but the kit running is another repo's copy: refused, with the command to run
    const other = spawnSync(process.execPath, [path.join(F.console, 'docs/devteam/scripts/devteam.mjs'), 'status'], { cwd: F.console, env: { ...F.env({}), DEVTEAM_HOME: old }, encoding: 'utf8' });
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, /DEVTEAM_HOME=.*old, but this kit is .*console.*: run home's kit, node '.*\/old\/docs\/devteam\/scripts\/devteam\.mjs'/);
  } finally { F.done(); }
});

test('a kit copy with no project settings.md never runs as a home: only init and help (and, in the kit\'s own repo, its views)', () => {
  const F = multiFixture('phantom');
  const { old, g } = F;
  try {
    const src = path.join(old, 'docs/devteam');
    fs.cpSync(src, path.join(F.console, 'docs/devteam'), { recursive: true, filter: (x) => !/[\\/](project|run)([\\/]|$)/.test(x.slice(src.length)) });
    const own = (args) => spawnSync(process.execPath, [path.join(F.console, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: F.console, env: F.env({ DEVTEAM_ROLE: 'supervisor' }), encoding: 'utf8' });
    for (const args of [['whoami'], ['status'], ['act', '--class', 'merge-word', '--', 'phantom merge']]) {
      const r = own(args);
      assert.notEqual(r.status, 0, `${args[0]} is refused`);
      assert.match(r.stderr, /no docs\/devteam\/project\/settings\.md here .*: run init to adopt devteam in this repo, or run home's kit with DEVTEAM_HOME=<home>/);
    }
    assert.ok(!fs.existsSync(path.join(F.console, 'docs/devteam/run')), 'nothing was written in the copy');
    assert.equal(own(['help']).status, 0, 'help still prints');
    // the kit's own repo (a remote of it is the kit's upstream) runs its read-only views, over no
    // tickets, and still refuses anything that writes
    const kr = path.join(F.base, 'kit-own');
    fs.mkdirSync(kr);
    g(['init', '-q', '-b', 'main'], kr);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], kr);
    g(['remote', 'add', 'origin', 'https://github.com/sanctuarycomputer/devteam.git'], kr);
    fs.cpSync(src, path.join(kr, 'docs/devteam'), { recursive: true, filter: (x) => !/[\\/](project|run)([\\/]|$)/.test(x.slice(src.length)) });
    g(['add', '-A'], kr); g(['commit', '-qm', 'kit'], kr);
    const kitOwn = (args) => spawnSync(process.execPath, [path.join(kr, 'docs/devteam/scripts/devteam.mjs'), ...args], { cwd: kr, env: F.env({ DEVTEAM_ROLE: 'supervisor' }), encoding: 'utf8' });
    for (const v of ['status', 'whoami', 'validate', 'links']) { const r = kitOwn([v]); assert.equal(r.status, 0, `${v} runs in the kit's own repo: ${r.stderr}`); }
    assert.match(kitOwn(['validate']).stdout, /0 ticket\(s\), 0 feature\(s\), 0 error\(s\)/);
    assert.match(kitOwn(['act', '--class', 'merge-word', '--', 'x']).stderr, /no docs\/devteam\/project\/settings\.md here .*: run init to adopt/, 'a command that writes is still refused');
    assert.equal(g(['status', '--porcelain'], kr), '', 'the views wrote nothing tracked');
    // init adopts devteam in this repo; then it is a home of its own, as asked
    const i = own(['init', '--name', 'console']);
    assert.equal(i.status, 0, i.stderr);
    assert.equal(own(['whoami']).status, 0);
  } finally { F.done(); }
});

test('repo(): each repo its own main and caches; --path and links.local.json override path; a wrong origin is refused', () => {
  const F = multiFixture('repo-obj');
  const { old, g, runIn, okIn } = F;
  try {
    const l = json(okIn(old, ['links', '--json']));
    assert.equal(l.home.main_ref, 'origin/main');
    assert.equal(l.home.main_sha, g(['rev-parse', 'origin/main'], old));
    const con = l.links.find((x) => x.id === 'console');
    assert.equal(con.main_ref, 'origin/trunk', "console's own main branch");
    assert.equal(con.main_sha, g(['rev-parse', 'origin/trunk'], F.console));
    assert.notEqual(con.main_sha, l.home.main_sha, 'no cache bleed between repos');
    // run/links.local.json, then --path, override the committed path
    const elsewhere = path.join(F.base, 'console-elsewhere');
    g(['clone', '-q', F.consoleOrigin, elsewhere], F.base);
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: elsewhere } }));
    assert.equal(F.real(json(okIn(old, ['links', '--json'])).links.find((x) => x.id === 'console').location), F.real(elsewhere));
    assert.match(okIn(old, ['components', 'check', '--repo', 'console', '--path', F.console]), /tracked path\(s\) at origin\/trunk: 0 unowned/, '--path wins over links.local.json');
    // a checkout of another remote is refused, with one message
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: F.companion } }));
    const r = runIn(old, ['components', 'check', '--repo', 'console']);
    assert.notEqual(r.status, 0);
    assert.match(r.err, /repo console: .*companion is a checkout of .*companion\.git, not .*console\.git/);
    // links --json still lists it, without main refs: a view never fails on a wrong checkout
    assert.equal(json(okIn(old, ['links', '--json'])).links.find((x) => x.id === 'console').main_ref, undefined);
    // no checkout at all: one message that says what to clone where
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: path.join(F.base, 'not-cloned') } }));
    assert.match(runIn(old, ['components', 'check', '--repo', 'console']).err, /repo console: no checkout at .*not-cloned; clone .*console\.git there/);
    assert.match(runIn(old, ['components', 'check', '--repo', 'nope']).err, /no repo link "nope"/);
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
  } finally { F.done(); }
});

test('lines on sibling repos: coverage per repo, project folder holds only tickets/, unowned-files names the repo', () => {
  const F = multiFixture('lines-per-repo');
  const { old, g, runIn, okIn, ticket } = F;
  try {
    assert.doesNotMatch(runIn(old, ['validate']).out, /only home holds/, 'components may live on repo links now');
    ticket('console-01-a');
    assert.doesNotMatch(runIn(old, ['validate']).out, /console-01-a: touches/, "a console ticket's touches are judged by console's lines");
    assert.match(okIn(old, ['ready']), /build +console-01-a/);
    // a file in console's project folder outside tickets/, pushed straight to its main
    write(path.join(F.console, 'docs/devteam/project/settings.md'), 'stray\n');
    g(['add', '-A'], F.console); g(['commit', '-qm', 'stray'], F.console); g(['push', '-q', 'origin', 'trunk'], F.console);
    assert.match(runIn(old, ['validate']).out, /console: docs\/devteam\/project\/settings\.md is in docs\/devteam\/project, which holds only tickets\//);
    // narrow console's line so a file falls outside it
    F.lines({ ...F.STD, console: { link: 'console', owns: ['src/**', 'package.json', '.gitignore'] }, companion: { link: 'companion' } });
    write(path.join(F.console, 'docs/x.md'), 'x\n');
    g(['add', '-A'], F.console); g(['commit', '-qm', 'x'], F.console); g(['push', '-q', 'origin', 'trunk'], F.console);
    assert.match(runIn(old, ['validate']).out, /components \(console\): unowned: docs\/ \(1\): docs\/x\.md/);
    const f = json(okIn(old, ['metrics', '--json'])).findings.filter((x) => x.kind === 'unowned-files');
    assert.deepEqual(f.map((x) => x.subject), ['console']);
    assert.deepEqual(json(okIn(old, ['ready', '--json'])).waiting, [{ id: 'console-01-a', why: 'unowned files' }]);
    assert.match(runIn(old, ['components', 'check', '--repo', 'console']).out, /unowned: docs\/ \(1\): docs\/x\.md/);
    assert.match(runIn(old, ['worker', 'console-01-a'], { DEVTEAM_ROLE: 'supervisor' }).err, /console's main has coverage gaps \(1 unowned\): no new ticket starts there .*components check --repo console\)/);
    // no console checkout on this machine: ready and metrics carry on; the ticket waits, and says why
    write(path.join(old, 'docs/devteam/run/links.local.json'), JSON.stringify({ console: { path: path.join(F.base, 'not-cloned') } }));
    assert.deepEqual(json(okIn(old, ['ready', '--json'])).waiting, [{ id: 'console-01-a', why: 'repo unreachable' }]);
    assert.match(okIn(old, ['ready']), /repo unreachable console-01-a +\(no new worker: its repo has no checkout here, or the wrong one/);
    assert.ok(json(okIn(old, ['metrics', '--json'])).findings.some((x) => x.kind === 'link-unreachable' && x.subject === 'console'));
    assert.match(runIn(old, ['validate']).out + runIn(old, ['validate']).err, /components \(console\): not checked, its checkout .*not-cloned is missing/);
    fs.rmSync(path.join(old, 'docs/devteam/run/links.local.json'));
  } finally { F.done(); }
});

// Records in home (links.<id>.records "home"): a link ticket's spec, plan, verification and
// reviews live on home's ticket/<id>, in home's project folder; only its code is in the link.
const SUP = { DEVTEAM_ROLE: 'supervisor' };
function recordsFixture(name, linkExtra = {}) {
  const F = multiFixture(name);
  const links = json(F.okIn(F.old, ['settings'])).links;
  F.lines({ ...F.STD, console: { link: 'console' }, companion: { link: 'companion' } }, { links: { ...links, console: { ...links.console, records: 'home', ...linkExtra } } });
  return F;
}
// home's ticket/<id> in a worktree of home: the records the worker keeps there
function homeRecords(F, id, files, { push = true } = {}) {
  const rw = path.join(F.old, '.worktrees', `records-${id}`);
  if (!fs.existsSync(rw)) F.g(['worktree', 'add', '-q', '-b', `ticket/${id}`, rw, 'origin/main'], F.old);
  for (const [f, text] of Object.entries(files)) write(path.join(rw, 'docs/devteam/project/tickets', id, f), text);
  F.g(['add', '-A'], rw); F.g(['commit', '-qm', `${id}: records`], rw);
  if (push) F.g(['push', '-q', 'origin', `ticket/${id}`], rw);
  return { rw, sha: F.g(['rev-parse', 'HEAD'], rw) };
}

test('records in home: the setting (repo by default, home or refused), and approve-plan reads the plan from home', () => {
  const F = multiFixture('records-setting');
  const { old, okIn, runIn, ticket } = F;
  try {
    const eff = () => json(okIn(old, ['links', '--json'])).links.find((x) => x.id === 'console').effective.records;
    assert.equal(eff(), 'repo', 'today\'s behaviour by default');
    assert.equal(json(okIn(old, ['links', '--json'])).home.effective.records, 'home');
    assert.match(runIn(old, ['link', 'set', 'console', 'records', 'nope'], SUP).err, /links\.console: records is "repo" or "home"/);
    F.edit((j) => { j.links.console.records = 'home'; });
    F.g(['commit', '-qam', 'records home'], old); F.g(['push', '-q', 'origin', 'main'], old);
    assert.doesNotMatch(runIn(old, ['validate']).out, /records is/);
    assert.equal(eff(), 'home');
    // approve-plan reads the plan from home's ticket/<id>, never the link's
    ticket('console-01-a');
    okIn(old, ['act', '--class', 'approve-spec', '--refs', 'console-01-a', '--', 'ok'], SUP);
    const w = path.join(old, '.worktrees', 'console-01-a');
    F.g(['worktree', 'add', '-q', '-b', 'ticket/console-01-a', w, 'origin/trunk'], F.console);
    write(path.join(w, 'docs/devteam/project/tickets/console-01-a/plan.md'), '# plan\n\n## TL;DR\n\n- x\n');
    F.g(['add', '-A'], w); F.g(['commit', '-qm', 'plan in the link'], w);
    homeRecords(F, 'console-01-a', { 'spec.md': '# spec\n' }, { push: false });
    assert.match(runIn(old, ['act', '--class', 'approve-plan', '--refs', 'console-01-a', '--', 'ok'], SUP).err, /no plan\.md for console-01-a on ticket\/console-01-a/, "a plan in the link doesn't count");
    homeRecords(F, 'console-01-a', { 'plan.md': '# plan\n\n## TL;DR\n\n- x\n' }, { push: false });
    assert.match(okIn(old, ['act', '--class', 'approve-plan', '--refs', 'console-01-a', '--', 'ok'], SUP), /^a-/, "the plan on home's ticket/<id>");
  } finally { F.done(); }
});
// A records-in-home console ticket ready to merge: code only on console's ticket/<id>, records
// (spec, plan, verification, then a final review naming both heads) on home's ticket/<id>.
const VERIF = '| Done-when | Command | Result |\n|---|---|---|\n| s | t | pass |\n';
function readyInHome(F, id, { reviewer = 'reviewer-b' } = {}) {
  const { old, g, okIn, ticket } = F;
  ticket(id);
  const w = path.join(old, '.worktrees', id);
  g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
  write(path.join(w, 'src/main.js'), `${id}\n`);
  g(['add', '-A'], w); g(['commit', '-qm', `${id}: work`], w); g(['push', '-q', 'origin', `ticket/${id}`], w);
  const code = g(['rev-parse', 'HEAD'], w);
  const rec = homeRecords(F, id, { 'spec.md': '# spec\n', 'plan.md': '# plan\n\n## TL;DR\n\n- x\n', 'verification.md': VERIF });
  okIn(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
  okIn(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
  const final = homeRecords(F, id, { 'reviews/final-1.md': `- Records: ${rec.sha}\n${review(reviewer, code)}` });
  write(path.join(old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
  return { w, code, rw: rec.rw, reviewed: rec.sha, head: final.sha };
}
// one commit on a branch's worktree, then the check, then the commit undone (and pushed back)
function tryCommit(F, wt, files, fn) {
  const before = F.g(['rev-parse', 'HEAD'], wt);
  for (const [f, text] of Object.entries(files)) write(path.join(wt, f), text);
  F.g(['add', '-A'], wt); F.g(['commit', '-qm', 'try'], wt);
  try { fn(F.g(['rev-parse', 'HEAD'], wt)); } finally { F.g(['reset', '-q', '--hard', before], wt); }
}

test('records in home: check-ticket reads them from home\'s ticket/<id> at both heads; home\'s check-pr checks only the records footprint', () => {
  const F = recordsFixture('records-check');
  const { old, g, okIn, runIn, ticket } = F;
  const id = 'console-01-a';
  const T = `docs/devteam/project/tickets/${id}`;
  try {
    // no records branch yet: one failure, nothing read from home's working tree
    ticket('console-02-b');
    const w0 = path.join(old, '.worktrees', 'console-02-b');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-02-b', w0, 'origin/trunk'], F.console);
    write(path.join(old, 'docs/devteam/project/tickets/console-02-b/spec.md'), '# spec in home\'s working tree\n');
    const none = runIn(old, ['check-ticket', 'console-02-b', '--sha', g(['rev-parse', 'HEAD'], w0)]);
    assert.notEqual(none.status, 0);
    assert.match(none.out, /no records for console-02-b in home: commit them under docs\/devteam\/project\/tickets\/console-02-b\/ on home's ticket\/console-02-b/);
    assert.doesNotMatch(none.out, /spec\.md missing|no final review/, 'the record checks are skipped');
    fs.rmSync(path.join(old, 'docs/devteam/project/tickets/console-02-b'), { recursive: true });

    const r = readyInHome(F, id);
    const check = (args = []) => runIn(old, ['check-ticket', id, '--sha', r.code, ...args]);
    assert.equal(check().status, 0, check().out);
    // the link's own records folder is no longer exempt: nothing of the project's in the link
    const dry = () => runIn(old, ['merge', id, '--dry-run'], SUP).out;
    tryCommit(F, r.w, { [`${T}/spec.md`]: '# spec in the link\n' }, (sha) => {
      assert.match(runIn(old, ['check-ticket', id, '--sha', sha]).out, new RegExp(`changes files outside touches: ${T}/spec\\.md`));
      g(['push', '-q', 'origin', `ticket/${id}`], r.w);
      assert.match(dry(), new RegExp(`changes files outside touches: ${T}/spec\\.md`), 'merge refuses it too');
    });
    g(['push', '-q', '--force', 'origin', `ticket/${id}`], r.w);
    // the records branch holds only its records folder; home's check-pr on it says the same
    tryCommit(F, r.rw, { 'README.md': 'changed through the records branch\n' }, (sha) => {
      assert.match(check().out, new RegExp(`home's ticket/${id} changes files outside its records folder ${T}/: README\\.md`));
      const pr = runIn(old, ['check-pr', '--head-ref', `ticket/${id}`, '--sha', sha]);
      assert.notEqual(pr.status, 0);
      assert.match(pr.out, /changes files outside its records folder .*README\.md/);
      g(['push', '-q', 'origin', `ticket/${id}`], r.rw);
      assert.match(dry(), /changes files outside its records folder .*README\.md/, 'merge refuses it too');
    });
    g(['push', '-q', '--force', 'origin', `ticket/${id}`], r.rw);
    assert.equal(runIn(old, ['check-pr', '--head-ref', `ticket/${id}`, '--sha', r.head]).status, 0, 'a records-only branch passes home\'s check-pr');
    // the records edited after the final review: the records verdict no longer holds
    tryCommit(F, r.rw, { [`${T}/verification.md`]: `${VERIF}| more | x | pass |\n` }, () => {
      assert.match(check().out, /final-1\.md: its records verdict is at \w{12}, which does not hold at home's \w{12}/);
      assert.match(check().out, /needs 1 final APPROVE review/);
    });
    // a newly added review record keeps it holding; a final record without "- Records:" fails
    tryCommit(F, r.rw, { [`${T}/reviews/task-1.md`]: review('task-reviewer', r.code) }, () => assert.equal(check().status, 0, check().out));
    tryCommit(F, r.rw, { [`${T}/reviews/final-2.md`]: review('reviewer-c', r.code) }, () => {
      assert.match(check().out, /final-2\.md: no "- Records: <full sha>" line/);
      g(['push', '-q', 'origin', `ticket/${id}`], r.rw);
      assert.match(dry(), /final-2\.md: no "- Records: <full sha>" line/, 'merge refuses it too');
    });
    g(['push', '-q', '--force', 'origin', `ticket/${id}`], r.rw);
    // --records pins the records commit read: the reviewed one has no review in it yet
    assert.match(check(['--records', r.reviewed]).out, /no final review record/);
  } finally { F.done(); }
});

test('records in home: merge checks the records at one pinned sha and lands them first; a half-done merge says so and a retry finishes it once', () => {
  const F = recordsFixture('records-merge');
  const { old, g, okIn, runIn, ticket } = F;
  const id = 'console-01-a';
  const T = `docs/devteam/project/tickets/${id}`;
  try {
    // no records in home: refused before anything lands
    ticket('console-02-b');
    const w0 = path.join(old, '.worktrees', 'console-02-b');
    g(['worktree', 'add', '-q', '-b', 'ticket/console-02-b', w0, 'origin/trunk'], F.console);
    write(path.join(w0, 'src/b.js'), 'b\n');
    g(['add', '-A'], w0); g(['commit', '-qm', 'b'], w0); g(['push', '-q', 'origin', 'ticket/console-02-b'], w0);
    assert.match(runIn(old, ['merge', 'console-02-b', '--dry-run'], SUP).out, /no records for console-02-b in home: commit them under .* and push it/);

    const r = readyInHome(F, id);
    const dry = () => runIn(old, ['merge', id, '--dry-run'], SUP);
    assert.match(dry().out, new RegExp(`ok: ticket/${id} at \\w{12} would merge in console, records at ${r.head.slice(0, 12)} in home`));
    // merge reads origin's records, never the local branch: a local commit that breaks them doesn't
    // move what merge checks, while check-ticket (the worker's committed state) sees it
    tryCommit(F, r.rw, { [`${T}/verification.md`]: `${VERIF}| local | x | pass |\n` }, () => {
      assert.match(runIn(old, ['check-ticket', id, '--sha', r.code]).out, /records verdict .* does not hold/);
      assert.equal(dry().status, 0, dry().out);
      assert.doesNotMatch(runIn(old, ['check-pr', '--repo', 'console', '--head-ref', `ticket/${id}`, '--sha', r.code]).out, /records verdict|no records/, "check-pr --repo judges origin's records, which hold");
    });
    // and the reverse: origin's records broken, the local branch fine: merge refuses
    tryCommit(F, r.rw, { [`${T}/verification.md`]: `${VERIF}| pushed | x | pass |\n` }, () => { g(['push', '-q', 'origin', `ticket/${id}`], r.rw); });
    assert.equal(runIn(old, ['check-ticket', id, '--sha', r.code]).status, 0);
    assert.match(dry().out, /records verdict .* does not hold/);
    assert.match(runIn(old, ['check-pr', '--repo', 'console', '--head-ref', `ticket/${id}`, '--sha', r.code]).out, /records verdict .* does not hold/, "check-pr --repo judges origin's records too");
    g(['push', '-q', '--force', 'origin', `ticket/${id}`], r.rw);
    // home's ticket/<id> not on origin: check-pr --repo refuses, never passing with no records read
    g(['push', '-q', 'origin', `:ticket/${id}`], r.rw);
    const gone = runIn(old, ['check-pr', '--repo', 'console', '--head-ref', `ticket/${id}`, '--sha', r.code]);
    assert.notEqual(gone.status, 0);
    assert.match(gone.out, new RegExp(`no records for ${id} in home: home's ticket/${id} is not on origin; push it`));
    g(['push', '-q', 'origin', `ticket/${id}`], r.rw);

    // the half-done merge: console's origin refuses the push, after the records landed
    const hook = path.join(F.consoleOrigin, 'hooks', 'pre-receive');
    write(hook, '#!/bin/sh\necho refused by the test >&2\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    const half = runIn(old, ['merge', id], SUP);
    assert.notEqual(half.status, 0);
    assert.match(half.err, new RegExp(`the records of ${id} landed in home at ${r.head.slice(0, 12)}; the code did not land in console \\(push to trunk in console refused .*\\): run merge ${id} again`));
    g(['fetch', '-q', 'origin'], old); g(['fetch', '-q', 'origin'], F.console);
    for (const f of ['spec.md', 'plan.md', 'verification.md', 'reviews/final-1.md']) g(['cat-file', '-e', `origin/main:${T}/${f}`], old);
    assert.equal(g(['show', 'origin/trunk:src/main.js'], F.console), 'console', "console's main doesn't have the code");
    const merges = () => json(okIn(old, ['log', '--type', 'act', '--json'])).filter((a) => a.class === 'merge-word' && (a.refs ?? []).includes(id));
    assert.equal(merges().length, 0, 'no merge act');
    const row = () => json(okIn(old, ['status', '--json'])).tickets.find((x) => x.id === id);
    assert.equal(row().records_landed, true);
    assert.match(okIn(old, ['status']), new RegExp(`${id}.*records in home, code not merged: run merge ${id} again`));
    const findings = () => json(okIn(old, ['metrics', '--json'])).findings;
    assert.ok(findings().some((x) => x.kind === 'records-without-code' && x.subject === id), 'the finding that names the fix');
    assert.ok(!findings().some((x) => x.kind === 'merged-without-merge'), 'the records merge is named by its own act, logged as it landed');
    const recAct = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'merge-word' && String(a.what).startsWith(`merged home's ticket/${id} at ${r.head}`));
    assert.ok(recAct, 'the records landing is an act of its own');
    assert.deepEqual(recAct.refs ?? [], [], 'with no ticket refs: the ticket is not merged yet');
    // the retry: same checks, the records skipped (landed), the code lands, one act
    fs.rmSync(hook);
    const again = okIn(old, ['merge', id], SUP);
    assert.match(again, new RegExp(`merged ticket/${id} at \\w{12} in console`));
    assert.doesNotMatch(again, /landed the records/);
    g(['fetch', '-q', 'origin'], old); g(['fetch', '-q', 'origin'], F.console);
    assert.equal(g(['show', 'origin/trunk:src/main.js'], F.console), id, 'the code landed');
    const recordMerges = g(['log', '--first-parent', '--merges', '--format=%P', 'origin/main'], old).split('\n').filter((l) => l.split(' ')[1] === r.head);
    assert.equal(recordMerges.length, 1, 'the records merged into home once');
    assert.equal(merges().length, 1);
    assert.match(merges()[0].what, new RegExp(`^merged ticket/${id} at ${r.code}; records at ${r.head} in home`));
    assert.equal(row().records_landed, undefined);
    assert.ok(!findings().some((x) => ['records-without-code', 'merged-without-merge'].includes(x.kind)), 'both gone once the act names the records');
    assert.ok(!g(['ls-tree', '-r', '--name-only', 'origin/trunk'], F.console).split('\n').some((f) => f.startsWith('docs/devteam/')), 'nothing of the project in console');
    assert.match(okIn(old, ['merge', id], SUP), /already on trunk: nothing to merge, nothing logged/);
  } finally { F.done(); }
});

// A console ticket written before links.console.records was "home": its code and records both on
// console's ticket/<id>, under the link's own project folder, the final review at the code head.
function leftInLink(F, id, { files = { 'spec.md': '# spec\n', 'plan.md': '# plan\n\n## TL;DR\n\n- x\n', 'verification.md': VERIF }, final = true } = {}) {
  const { old, g, okIn, ticket } = F;
  ticket(id);
  const w = path.join(old, '.worktrees', id);
  g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
  write(path.join(w, `src/${id}.js`), `${id}\n`);
  for (const [f, text] of Object.entries(files)) write(path.join(w, 'docs/devteam/project/tickets', id, f), text);
  g(['add', '-A'], w); g(['commit', '-qm', `${id}: work`], w);
  const code = g(['rev-parse', 'HEAD'], w);
  if (final) { write(path.join(w, 'docs/devteam/project/tickets', id, 'reviews/final-1.md'), review('reviewer-b', code)); g(['add', '-A'], w); g(['commit', '-qm', 'review'], w); }
  g(['push', '-q', 'origin', `ticket/${id}`], w);
  // approve-plan dies with no plan to read, so each act only when its file is there
  if (files['spec.md']) okIn(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
  if (files['plan.md']) okIn(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
  write(path.join(old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
  return { w, code, head: g(['rev-parse', 'HEAD'], w) };
}
// the left-in-the-link warning lines for a ticket in a command's stderr
const warnings = (text, id) => text.split('\n').filter((l) => new RegExp(`^devteam: warning: ${id}: records read from console \\(docs/devteam/project/tickets/${id}/\\), left from before links\\.console\\.records was "home"; move them to home's docs/devteam/project/tickets/${id}/ once merged$`).test(l)).length;

test('records in home: a ticket whose records were left in the link merges from there until home has some', () => {
  const F = recordsFixture('records-left');
  const { old, g, okIn, runIn } = F;
  const T = (id) => `docs/devteam/project/tickets/${id}`;
  const check = (id, sha) => runIn(old, ['check-ticket', id, '--sha', sha]);
  const checkPr = (id, sha) => runIn(old, ['check-pr', '--repo', 'console', '--head-ref', `ticket/${id}`, '--sha', sha]);
  const dropRef = (dir, ref) => { try { g(['update-ref', '-d', ref], dir); } catch {} };
  try {
    // a records branch with no folder in it (as worker makes one) is not records in home
    g(['branch', 'ticket/console-01-a', 'origin/main'], old); g(['push', '-q', 'origin', 'ticket/console-01-a'], old);
    // A2: left in the link, it passes from the link, with the warning once per command
    const id = 'console-01-a';
    const a = leftInLink(F, id);
    const ck = check(id, a.head);
    assert.equal(ck.status, 0, ck.out);
    assert.equal(warnings(ck.err, id), 1, ck.err);
    const pr = checkPr(id, a.head);
    assert.equal(pr.status, 0, pr.out);
    assert.equal(warnings(pr.err, id), 1, pr.err);
    const dry = runIn(old, ['merge', id, '--dry-run'], SUP);
    assert.match(dry.out, new RegExp(`ok: ticket/${id} at \\w{12} would merge in console`), dry.out);
    assert.doesNotMatch(dry.out, /records at/);
    assert.equal(warnings(dry.err, id), 1, dry.err);
    // A2b: the link's ticket/<id> refs gone (a CI checkout): decided at the sha, read at the sha
    g(['checkout', '-q', '--detach'], a.w); g(['branch', '-D', `ticket/${id}`], a.w); dropRef(F.console, `refs/remotes/origin/ticket/${id}`);
    const ck2 = check(id, a.head);
    assert.equal(ck2.status, 0, ck2.out);
    assert.equal(warnings(ck2.err, id), 1, ck2.err);
    const rv = okIn(old, ['review-worktree', id, a.code], SUP).split('\n');
    assert.ok(!rv.some((l) => /^records: /.test(l)), rv.join('\n'));
    okIn(old, ['review-worktree', '--remove', rv[0]], SUP);
    g(['checkout', '-q', '-B', `ticket/${id}`, a.head], a.w); g(['fetch', '-q', 'origin'], F.console);
    // A7: the views read the link: the default records line in the worker's prompt
    const wp = okIn(old, ['prompt', 'worker', id], SUP);
    assert.match(wp, /keep this ticket's records under docs\/devteam\/project\/tickets\/console-01-a\/ in this repo\./);
    assert.doesNotMatch(wp, /Keep its records/);
    // approve-plan reads the link's plan (leftInLink's act succeeds), until home has a folder without one
    leftInLink(F, 'console-06-f', { files: { 'spec.md': '# spec\n', 'plan.md': '# plan\n\n## TL;DR\n\n- x\n' }, final: false });
    homeRecords(F, 'console-06-f', { 'spec.md': '# spec\n' }, { push: false });
    assert.match(runIn(old, ['act', '--class', 'approve-plan', '--refs', 'console-06-f', '--', 'ok'], SUP).err, /no plan\.md for console-06-f on ticket\/console-06-f/);
    // merge lands the code and the link's records in console, nothing in home
    okIn(old, ['merge', id], SUP);
    g(['fetch', '-q', 'origin'], F.console); g(['fetch', '-q', 'origin'], old);
    const trunk = g(['ls-tree', '-r', '--name-only', 'origin/trunk'], F.console).split('\n');
    assert.ok(trunk.includes(`src/${id}.js`) && trunk.includes(`${T(id)}/spec.md`), trunk.join('\n'));
    assert.equal(g(['ls-tree', '-r', '--name-only', 'origin/main', '--', T(id)], old), '', 'nothing in home');
    assert.equal(json(okIn(old, ['timeline', id, '--json'])).files.find((f) => f.title === 'spec')?.repo, 'console');
    // A2c: home records pushed from another clone: merge and check-pr fetch them before deciding
    const e = leftInLink(F, 'console-05-e');
    const other = path.join(F.base, 'home-other');
    g(['clone', '-q', F.org, other], F.base);
    g(['config', 'user.email', 't@t'], other); g(['config', 'user.name', 't'], other);
    g(['checkout', '-q', '-b', 'ticket/console-05-e'], other);
    write(path.join(other, T('console-05-e'), 'spec.md'), '# spec in home\n');
    g(['add', '-A'], other); g(['commit', '-qm', 'records elsewhere'], other); g(['push', '-q', 'origin', 'ticket/console-05-e'], other);
    dropRef(old, 'refs/remotes/origin/ticket/console-05-e');
    const outsideE = new RegExp(`changes files outside touches: ${T('console-05-e')}/`);
    assert.match(runIn(old, ['merge', 'console-05-e', '--dry-run'], SUP).out, outsideE);
    dropRef(old, 'refs/remotes/origin/ticket/console-05-e');
    assert.match(checkPr('console-05-e', e.head).out, outsideE);
    // A3: held to the link head: a code change after the final review voids it
    const b = leftInLink(F, 'console-02-b');
    tryCommit(F, b.w, { 'src/console-02-b.js': 'changed\n' }, (sha) => assert.match(check('console-02-b', sha).out, /final-1\.md: its verdict is at \w{12}, which does not hold at/));
    // A4: the record checks still run on the link's records
    const c = leftInLink(F, 'console-03-c', { files: { 'spec.md': '# spec\n' }, final: false });
    const ck4 = check('console-03-c', c.head);
    assert.match(ck4.out, /plan\.md missing at this head/);
    assert.match(ck4.out, /verification\.md missing/);
    assert.equal(warnings(ck4.err, 'console-03-c'), 1, ck4.err);
    // A5: home wins once it has a folder: the link's is outside touches, home's records are judged
    homeRecords(F, 'console-02-b', { 'spec.md': '# spec\n' }, { push: false });
    const outsideB = new RegExp(`changes files outside touches: ${T('console-02-b')}/`);
    const ck5 = check('console-02-b', b.head);
    assert.match(ck5.out, outsideB);
    assert.match(ck5.out, /plan\.md missing at this head/);
    assert.equal(warnings(ck5.err, 'console-02-b'), 0, ck5.err);
    const rec = homeRecords(F, 'console-02-b', { 'plan.md': '# plan\n\n## TL;DR\n\n- x\n', 'verification.md': VERIF }, { push: false });
    const recFinal = homeRecords(F, 'console-02-b', { 'reviews/final-1.md': `- Records: ${rec.sha}\n${review('reviewer-b', b.code)}` }, { push: false });
    const fails5 = check('console-02-b', b.head).out.split('\n').filter((l) => l.startsWith('fail: '));
    assert.ok(fails5.length && fails5.every((l) => outsideB.test(l)), fails5.join('\n'));
    // A6: home's checks are not lax: a records edit after the review, and no records anywhere
    tryCommit(F, recFinal.rw, { [`${T('console-02-b')}/verification.md`]: `${VERIF}| more | x | pass |\n` }, () => {
      assert.match(check('console-02-b', b.head).out, /its records verdict is at \w{12}, which does not hold at home's/);
    });
    const d = leftInLink(F, 'console-04-d', { files: {}, final: false });
    assert.match(check('console-04-d', d.head).out, /no records for console-04-d in home/);
    // home wins on home's main alone too (a records PR merged first, its branch deleted): the link's
    // folder is refused, with no warning
    const gg = leftInLink(F, 'console-07-g');
    write(path.join(old, T('console-07-g'), 'spec.md'), '# spec on home main\n');
    g(['add', T('console-07-g')], old); g(['commit', '-qm', 'console-07-g records on main'], old); g(['push', '-q', 'origin', 'main'], old);
    const outsideG = new RegExp(`changes files outside touches: ${T('console-07-g')}/`);
    const ck7 = check('console-07-g', gg.head);
    assert.match(ck7.out, outsideG);
    assert.equal(warnings(ck7.err, 'console-07-g'), 0, ck7.err);
    assert.match(runIn(old, ['merge', 'console-07-g', '--dry-run'], SUP).out, outsideG);
    // merge and check-pr decide at the PR head, not the link's local branch (here reset to trunk,
    // where there is no records folder: the views form would route it home and find none)
    const hh = leftInLink(F, 'console-08-h');
    g(['checkout', '-q', '--detach'], hh.w); g(['branch', '-f', 'ticket/console-08-h', 'origin/trunk'], hh.w);
    const dry8 = runIn(old, ['merge', 'console-08-h', '--dry-run'], SUP);
    assert.match(dry8.out, /ok: ticket\/console-08-h at \w{12} would merge in console/, dry8.out);
    assert.equal(warnings(dry8.err, 'console-08-h'), 1, dry8.err);
    const pr8 = checkPr('console-08-h', hh.head);
    assert.equal(pr8.status, 0, pr8.out);
    assert.equal(warnings(pr8.err, 'console-08-h'), 1, pr8.err);
  } finally { F.done(); }
});

test('records in home: a link left on records "repo" (the default) never reads as left in the link', () => {
  const F = multiFixture('records-repo-default');
  const { old, g, runIn, ticket } = F;
  const id = 'console-01-a';
  try {
    ticket(id);
    const w = path.join(old, '.worktrees', id);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
    write(path.join(w, `docs/devteam/project/tickets/${id}/spec.md`), '# spec\n');
    g(['add', '-A'], w); g(['commit', '-qm', 'records in the link'], w);
    const ck = runIn(old, ['check-ticket', id, '--sha', g(['rev-parse', 'HEAD'], w)]);
    assert.equal(warnings(ck.err, id), 0, ck.err);
    assert.doesNotMatch(ck.err, /left from before/);
    assert.doesNotMatch(ck.out, /no records for .* in home|changes files outside touches/, ck.out);
  } finally { F.done(); }
});

test('records in home on a GitHub home: a merged records PR is recognized (branch there or gone), else an open one is needed', () => {
  const F = recordsFixture('records-gh', { forge: 'git' });
  const { old, g, runIn } = F;
  const id = 'console-01-a';
  try {
    const r = readyInHome(F, id);
    F.edit((j) => { delete j.forge; });
    g(['commit', '-qam', 'home on github'], old); g(['push', '-q', 'origin', 'main'], old);
    // a gh on PATH: pr list --state merged answers from a file; every other call fails (no open PR)
    const bin = path.join(F.base, 'gh-bin');
    const merged = path.join(F.base, 'merged.json');
    write(path.join(bin, 'gh'), `#!/bin/sh\ncase "$*" in\n  "pr list"*"--state merged"*) cat '${merged}' ;;\n  *) exit 1 ;;\nesac\n`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const dry = () => runIn(old, ['merge', id, '--dry-run'], SUP, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });
    const origin = path.join(F.base, 'origin.git');
    g(['update-ref', 'refs/pull/7/head', r.head], origin);
    // an older merge of an earlier head is newer in the list's order here: the one at the fetched head counts
    g(['update-ref', 'refs/pull/8/head', r.reviewed], origin);
    write(merged, JSON.stringify([{ number: 7, headRefOid: r.head, mergedAt: '2026-11-15T00:00:00Z' }, { number: 8, headRefOid: r.reviewed, mergedAt: '2026-11-15T01:00:00Z' }]));
    assert.match(dry().out, new RegExp(`records at ${r.head.slice(0, 12)} in home \\(landed already: only the code lands\\)`));
    // the head branch deleted on merge: the newest merged PR, fetched from refs/pull/<n>/head
    write(merged, JSON.stringify([{ number: 7, headRefOid: r.head, mergedAt: '2026-11-15T00:00:00Z' }]));
    g(['push', '-q', 'origin', `:ticket/${id}`], r.rw);
    assert.match(dry().out, /\(landed already: only the code lands\)/);
    // no merged PR and no open one: refused
    g(['push', '-q', 'origin', `ticket/${id}`], r.rw);
    write(merged, '[]');
    assert.match(dry().out, new RegExp(`no open home PR from ticket/${id} \\(its records\\)`));
  } finally { F.done(); }
});

test('records in home: the worker\'s records worktree and prompt, review-worktree\'s records checkout, timeline, and --remove', (t) => {
  const F = recordsFixture('records-worktrees');
  const { old, g, okIn, runIn, ticket } = F;
  const id = 'console-01-a';
  const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id };
  try {
    if (hasTmux) {
      ticket('console-03-c');
      okIn(old, ['worker', 'console-03-c'], SUP);
      spawnSync('tmux', ['kill-server'], { env: F.env({}) });
      const rw = path.join(old, '.worktrees', 'records-console-03-c');
      assert.equal(F.real(g(['rev-parse', '--path-format=absolute', '--git-common-dir'], rw)), F.real(path.join(old, '.git')), 'a worktree of home');
      assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], rw), 'ticket/console-03-c');
      assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD'], path.join(old, '.worktrees', 'console-03-c')), 'ticket/console-03-c');
      const prompt = fs.readFileSync(path.join(old, 'docs/devteam/run/prompts/console-03-c.txt'), 'utf8');
      assert.match(prompt, /Keep its records \(spec, plan, verification, reviews\) under docs\/devteam\/project\/tickets\/console-03-c\/ in \S*\.worktrees\/records-console-03-c, a checkout of home on its branch ticket\/console-03-c/);
      assert.match(prompt, /"- Records: <full sha>"/);
      assert.doesNotMatch(prompt, /in this repo\./, "not the default's records line");
    } else t.diagnostic('tmux not installed: the worker launch is not exercised');
    const r = readyInHome(F, id);
    // timeline lists the records from home (no repo field)
    const files = json(okIn(old, ['timeline', id, '--json'])).files;
    assert.deepEqual(files.map((f) => [f.title, f.repo]), [['spec', undefined], ['plan', undefined], ['verification', undefined]]);
    // review-worktree: the link checkout, and home's records beside it at their full sha
    const out = okIn(old, ['review-worktree', id, r.code]).split('\n');
    const rv = out[0];
    const m = /^records: (\S+) \(([0-9a-f]{40})\)$/.exec(out[1] ?? '');
    assert.ok(m, out.join('\n'));
    assert.equal(m[2], r.head);
    assert.equal(F.real(g(['rev-parse', '--path-format=absolute', '--git-common-dir'], m[1])), F.real(path.join(old, '.git')));
    assert.ok(fs.existsSync(path.join(m[1], `docs/devteam/project/tickets/${id}/spec.md`)));
    okIn(old, ['review-worktree', '--remove', rv]);
    assert.ok(!fs.existsSync(rv) && !fs.existsSync(m[1]), 'both removed');
    // --remove after the merge removes both worktrees
    okIn(old, ['merge', id], SUP);
    okIn(r.w, ['phase', 'done'], W);
    const rm = okIn(old, ['worker', id, '--remove'], SUP);
    assert.match(rm, /removed .*console-01-a \(a worktree of console\)/);
    assert.match(rm, /removed .*records-console-01-a \(a worktree of home\)/);
    assert.ok(!fs.existsSync(r.rw));
    // once merged, timeline reads home's main
    assert.equal(json(okIn(old, ['timeline', id, '--json'])).files.find((f) => f.title === 'spec').ref, 'origin/main');
  } finally { F.done(); }
});

test('records in home: a parked worker is settled only once its records are committed and pushed too', () => {
  const F = recordsFixture('records-park');
  const { old, g, okIn, ticket } = F;
  const id = 'console-01-a';
  const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id };
  try {
    ticket(id);
    const w = path.join(old, '.worktrees', id);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
    g(['push', '-q', 'origin', `ticket/${id}`], w);
    const rw = path.join(old, '.worktrees', `records-${id}`);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, rw, 'origin/main'], old);
    // the park ruling names the records worktree
    okIn(w, ['phase', 'build'], W);
    okIn(old, ['fleet', 'park', '--reason', 'moving'], SUP);
    const told = json(okIn(old, ['messages', '--to', id, '--json'])).pop();
    assert.match(told.text, /^Park: .* Push records-console-01-a too\. Commit all work/);
    okIn(w, ['phase', 'parked', '--note', 'parked'], W);
    const problems = () => json(okIn(old, ['fleet', 'status', '--json', '--no-fetch'], SUP)).sessions.find((x) => x.name === id).problems.filter((p) => p.startsWith('records:'));
    assert.deepEqual(problems(), [], 'a records branch with nothing of its own has nothing to lose');
    write(path.join(rw, `docs/devteam/project/tickets/${id}/spec.md`), '# spec\n');
    assert.match(problems().join('\n'), /records: 1 uncommitted change\(s\) in \S*records-console-01-a/);
    g(['add', '-A'], rw); g(['commit', '-qm', 'spec'], rw);
    assert.match(problems().join('\n'), /records: home's ticket\/console-01-a is not on origin: push it from/);
    g(['push', '-q', 'origin', `ticket/${id}`], rw);
    assert.deepEqual(problems(), []);
    write(path.join(rw, `docs/devteam/project/tickets/${id}/plan.md`), '# plan\n');
    g(['add', '-A'], rw); g(['commit', '-qm', 'plan'], rw);
    assert.match(problems().join('\n'), /records: home's ticket\/console-01-a here \(\w{12}\) is not what origin has/);
  } finally { F.done(); }
});

test('records in home: a half-done merge, then a review record added on home\'s ticket/<id>: the retry lands the new head and its act names both records merges', () => {
  const F = recordsFixture('records-moved');
  const { old, g, okIn, runIn } = F;
  const id = 'console-01-a';
  const T = `docs/devteam/project/tickets/${id}`;
  const W = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: id };
  try {
    const r = readyInHome(F, id);
    const hook = path.join(F.consoleOrigin, 'hooks', 'pre-receive');
    write(hook, '#!/bin/sh\nexit 1\n');
    fs.chmodSync(hook, 0o755);
    assert.notEqual(runIn(old, ['merge', id], SUP).status, 0);
    // a record added since (a dispose, another track): the verdicts still hold, so the retry lands it
    const later = homeRecords(F, id, { 'reviews/task-9.md': review('late-reviewer', r.code) });
    // a hand-made merge on home's main that borrows the records subject: never named, still flagged
    const forge = path.join(F.base, 'forged');
    g(['clone', '-q', path.join(F.base, 'origin.git'), forge], F.base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], forge);
    g(['checkout', '-q', '-b', 'x'], forge);
    write(path.join(forge, 'README.md'), 'pushed past merge\n');
    g(['commit', '-qam', 'unchecked'], forge);
    g(['checkout', '-q', 'main'], forge);
    g(['merge', '-q', '--no-ff', '-m', `${id}: records`, 'x'], forge);
    g(['push', '-q', 'origin', 'main'], forge);
    const forged = g(['rev-parse', 'HEAD'], forge);
    // an evil merge that stays in the folder: a real records commit (an ancestor of what merge will
    // check) merged with a review no records commit has. Never named, still flagged.
    g(['fetch', '-q', 'origin', `ticket/${id}`], forge);
    g(['merge', '-q', '--no-ff', '--no-commit', 'FETCH_HEAD'], forge);
    write(path.join(forge, `${T}/reviews/final-9.md`), review('nobody', r.code));
    g(['add', '-A'], forge); g(['commit', '-qm', `${id}: records`], forge);
    g(['push', '-q', 'origin', 'main'], forge);
    const evil = g(['rev-parse', 'HEAD'], forge);
    const last = homeRecords(F, id, { 'reviews/task-10.md': review('later-reviewer', r.code) });
    fs.rmSync(hook);
    assert.match(okIn(old, ['merge', id], SUP), new RegExp(`landed the records of ${id} at ${last.sha.slice(0, 12)} in home`));
    const act = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'merge-word' && (a.refs ?? []).includes(id));
    assert.match(act.what, new RegExp(`; records at ${last.sha} in home$`));
    const landings = json(okIn(old, ['log', '--type', 'act', '--json'])).filter((a) => String(a.what).startsWith(`merged home's ticket/${id} at `)).map((a) => a.what.split(' ')[4].replace(/:$/, ''));
    assert.deepEqual(landings, [r.head, last.sha], 'each records landing logged its own act; the forged merges have none');
    const f = json(okIn(old, ['metrics', '--json'])).findings;
    assert.ok(!f.some((x) => x.kind === 'records-without-code'));
    assert.deepEqual(f.filter((x) => x.kind === 'merged-without-merge').map((x) => x.subject).sort(), [`home:${evil.slice(0, 12)}`, `home:${forged.slice(0, 12)}`].sort(), 'both records merges are named by the act; the forged ones stay flagged');
    // --remove: a dirty records worktree refuses before anything is removed
    okIn(r.w, ['phase', 'done'], W);
    write(path.join(r.rw, `${T}/notes.md`), 'uncommitted\n');
    assert.notEqual(runIn(old, ['worker', id, '--remove'], SUP).status, 0);
    assert.ok(fs.existsSync(r.w) && fs.existsSync(r.rw), 'neither worktree removed');
  } finally { F.done(); }
});

test('records in home: a hand-made merge borrowing the records subject is never named by the act, whichever check it fails', () => {
  const F = recordsFixture('records-borrowed');
  const { old, g, okIn } = F;
  const id = 'console-02-b';
  const T = `docs/devteam/project/tickets/${id}`;
  try {
    F.ticket(id);
    const w = path.join(old, '.worktrees', id);
    g(['worktree', 'add', '-q', '-b', `ticket/${id}`, w, 'origin/trunk'], F.console);
    write(path.join(w, 'src/main.js'), `${id}\n`);
    g(['add', '-A'], w); g(['commit', '-qm', 'work'], w); g(['push', '-q', 'origin', `ticket/${id}`], w);
    const code = g(['rev-parse', 'HEAD'], w);
    // the records' own first commit also edits README.md (outside the folder): refused as it stands
    const first = homeRecords(F, id, { 'spec.md': '# spec\n', 'plan.md': '# plan\n\n## TL;DR\n\n- x\n', 'verification.md': VERIF });
    write(path.join(first.rw, 'README.md'), 'through the records branch\n');
    g(['commit', '-qam', 'readme too'], first.rw); g(['push', '-q', 'origin', `ticket/${id}`], first.rw);
    const h = g(['rev-parse', 'HEAD'], first.rw);
    okIn(old, ['act', '--class', 'approve-spec', '--refs', id, '--', 'ok'], SUP);
    okIn(old, ['act', '--class', 'approve-plan', '--refs', id, '--', 'ok'], SUP);
    // by hand, onto home's main, with the records subject: (1) that commit, a clean merge of an
    // ancestor of what merge will check, which changes README.md: only the footprint check stops it;
    // (2) a clean, in-folder merge of a commit that is no ancestor: only the ancestry check stops it
    const forge = path.join(F.base, 'borrowed');
    g(['clone', '-q', path.join(F.base, 'origin.git'), forge], F.base);
    for (const [k, v] of [['user.email', 't@t'], ['user.name', 't']]) g(['config', k, v], forge);
    g(['fetch', '-q', 'origin', `ticket/${id}`], forge);
    // (0) a plain --no-ff merge of a real records commit, by hand before merge ran: git can't tell it
    // from merge's own; only merge's act says what merge landed, so it stays flagged
    g(['merge', '-q', '--no-ff', '-m', `${id}: records`, first.sha], forge);
    const viaClean = g(['rev-parse', 'HEAD'], forge);
    g(['merge', '-q', '--no-ff', '-m', `${id}: records`, 'FETCH_HEAD'], forge);
    const viaFootprint = g(['rev-parse', 'HEAD'], forge);
    g(['checkout', '-q', '-b', 'y', 'origin/main'], forge);
    write(path.join(forge, `${T}/notes.md`), 'not a records commit\n');
    g(['add', '-A'], forge); g(['commit', '-qm', 'notes'], forge);
    g(['checkout', '-q', 'main'], forge);
    g(['merge', '-q', '--no-ff', '-m', `${id}: records`, 'y'], forge);
    const viaAncestry = g(['rev-parse', 'HEAD'], forge);
    // (3) an empty merge of an old main commit (an ancestor of everything): every other check passes
    // trivially, so only "its merge brought the head in" stops it; (4) then a merge of that same head
    // that edits README.md, which naming (3) would hide too
    const oldMain = g(['rev-list', '--max-parents=0', 'HEAD'], forge).split('\n')[0];
    const mergeOf = (tree) => { const c = g(['commit-tree', tree, '-p', 'HEAD', '-p', oldMain, '-m', `${id}: records`], forge); g(['reset', '-q', '--hard', c], forge); return c; };
    const viaEmpty = mergeOf(g(['rev-parse', 'HEAD^{tree}'], forge));
    write(path.join(forge, 'README.md'), 'hidden behind a named head\n');
    g(['add', '-A'], forge);
    const viaReadme = mergeOf(g(['write-tree'], forge));
    g(['push', '-q', 'origin', 'main'], forge);
    // the reviewed records, now that home's main has the README change (merge-base moved past it)
    homeRecords(F, id, { 'reviews/final-1.md': `- Records: ${h}\n${review('reviewer-b', code)}` });
    write(path.join(old, `docs/devteam/run/pr/ticket/${id}.md`), `# ${id}: work\n\n## One-way doors\n\nNone.\n`);
    okIn(old, ['merge', id], SUP);
    const act = json(okIn(old, ['log', '--type', 'act', '--json'])).find((a) => a.class === 'merge-word' && (a.refs ?? []).includes(id));
    assert.doesNotMatch(act.what, /and earlier at/, 'neither hand-made merge is named');
    const flagged = json(okIn(old, ['metrics', '--json'])).findings.filter((x) => x.kind === 'merged-without-merge').map((x) => x.subject).sort();
    assert.deepEqual(flagged, [viaClean, viaAncestry, viaFootprint, viaEmpty, viaReadme].map((s) => `home:${s.slice(0, 12)}`).sort());
  } finally { F.done(); }
});
