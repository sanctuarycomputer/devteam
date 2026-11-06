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
import { kit, line, write, json, multiFixture } from './lib/kit.mjs';

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
