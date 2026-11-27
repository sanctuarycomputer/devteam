// merge's pin check (kit-957; kit-sync@2's checks, kit-install@1). Checks are numbered as in the
// ticket's spec (M1 to M9). Each test is a fixture instance (the kit copied in, init, main pushed to a
// bare origin, forge "git", upstream_base v0.100.0, main pinned to 0.100.0) merging chore PRs as the
// supervisor, against test/lib/fake-registry.mjs (a loopback registry, a fake npm first on PATH, and
// statements signed by the fake's own test CA) and a fake upstream of this file's: the kit at v0.100.0,
// v0.101.0 (one governance file changed) and v1.0.0 (the launcher's marker as devteam.mjs's second
// line), all on its main, reached through url.insteadOf in the registry's HOME.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { kit, bareProject } from './lib/kit.mjs';
import { startFakeRegistry, FIXTURES, NAME } from './lib/fake-registry.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-merge-pin-'));
const regs = [];
after(async () => {
  for (const r of regs) await r.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };
const g = (args, cwd) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const MARK = '// devteam-launcher: kit-package@1';
const LAYOUT = { '0.99.0': 1, '0.100.0': 1, '0.101.0': 1, '1.0.0': 2 };
const integrityOf = (version) => `sha512-${crypto.createHash('sha512').update(fs.readFileSync(path.join(FIXTURES, 'registry', `devteam-${version}.tgz`))).digest('base64')}`;
const folderOf = (version) => `${version}-${Buffer.from(integrityOf(version).slice(7), 'base64').toString('hex').slice(0, 12)}`;
const SRC = fs.readFileSync(path.join(kit, 'scripts', 'devteam.mjs'), 'utf8');
// packagePinPair, loaded alone (as test/package-pin.test.mjs loads it)
const packagePinPair = (() => {
  const a = SRC.indexOf('\nfunction packagePinPair(');
  return vm.runInContext(`${SRC.slice(a, SRC.indexOf('\n}\n', a) + 2)}\npackagePinPair`, vm.createContext({}));
})();
const pairOf = (version, layout = LAYOUT[version]) => packagePinPair({ name: NAME, version, integrity: integrityOf(version), resolved: `https://registry.npmjs.org/${NAME}/-/devteam-${version}.tgz`, layout });

// upstream: the kit at v0.100.0, v0.101.0 (governance/quality.md changed) and v1.0.0 (the launcher's
// marker as devteam.mjs's second line, and quality.md again), each tagged on its main
function upstream() {
  const u = path.join(scratch('upstream'), 'devteam');
  fs.mkdirSync(u);
  g(['init', '-q', '-b', 'main'], u);
  fs.cpSync(kit, path.join(u, 'docs/devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  g(['add', '-A'], u);
  g(['commit', '-qm', 'v0.100.0'], u);
  g(['tag', '-a', 'v0.100.0', '-m', '0.100.0'], u);
  fs.appendFileSync(path.join(u, 'docs/devteam/governance/quality.md'), '\nA rule of v0.101.0.\n');
  g(['commit', '-qam', 'v0.101.0'], u);
  g(['tag', '-a', 'v0.101.0', '-m', '0.101.0'], u);
  const script = path.join(u, 'docs/devteam/scripts/devteam.mjs');
  const lines = fs.readFileSync(script, 'utf8').split('\n');
  lines[1] = MARK;
  fs.writeFileSync(script, lines.join('\n'));
  fs.appendFileSync(path.join(u, 'docs/devteam/governance/quality.md'), '\nA rule of v1.0.0.\n');
  g(['commit', '-qam', 'v1.0.0'], u);
  g(['tag', '-a', 'v1.0.0', '-m', '1.0.0'], u);
  const sha = (r) => g(['rev-parse', `${r}^{commit}`], u);
  return { dir: u, commits: { '0.100.0': sha('v0.100.0'), '0.101.0': sha('v0.101.0'), '1.0.0': sha('v1.0.0') } };
}
const UP = upstream();
// an upstream that never answers (git's ext transport, a sleep that holds the pipe) and one that isn't there
const HANG = path.join(scratch('hang'), 'hang.sh');
fs.writeFileSync(HANG, '#!/bin/sh\nexec sleep 90 2>/dev/null\n', { mode: 0o755 });
const upFile = (tag, f) => execFileSync('git', ['show', `${tag}:docs/devteam/${f}`], { cwd: UP.dir, maxBuffer: 256 * 1024 * 1024 });
const clean = () => {
  const e = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && !/^GIT_/.test(k) && !/^npm_config_/i.test(k)));
  e.DEVTEAM_HUB_PORT = '4999';
  return e;
};
const settingsFile = (root) => path.join(root, 'docs/devteam/project/settings.md');
const editSettings = (root, fn) => {
  const f = settingsFile(root);
  const t = fs.readFileSync(f, 'utf8');
  const m = /```json devteam\n([\s\S]*?)\n```/.exec(t);
  fs.writeFileSync(f, t.replace(m[1], JSON.stringify(fn(JSON.parse(m[1])), null, 2)));
};
const writePair = (dir, pair) => { for (const [f, text] of Object.entries(pair)) fs.writeFileSync(path.join(dir, 'docs/devteam', f), text); };

// A fixture instance, as the file's header says. dt runs its kit as the supervisor.
async function instance(name, { fail = null, mainPin = '0.100.0', mainBase = 'v0.100.0', upstream = null } = {}) {
  const base = scratch(name);
  const origin = path.join(base, 'origin.git');
  const root = bareProject(base, 'pkg');
  editSettings(root, (s) => ({ ...s, forge: 'git', upstream_base: mainBase, ...(upstream ? { upstream_repo: upstream } : {}) }));
  writePair(root, pairOf(mainPin));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  g(['remote', 'add', 'origin', origin], root);
  g(['add', '-A'], root);
  g(['commit', '-qm', `init, pinned to ${mainPin}`], root);
  g(['push', '-q', 'origin', 'main'], root);
  const reg = await startFakeRegistry({ commits: UP.commits });
  regs.push(reg);
  if (fail) await reg.fail(fail);
  fs.writeFileSync(path.join(reg.home, '.gitconfig'), `[user]\n\temail = t@t\n\tname = t\n[commit]\n\tgpgsign = false\n[url "${UP.dir}"]\n\tinsteadOf = https://github.com/sanctuarycomputer/devteam.git\n\tinsteadOf = https://github.com/someone-else/devteam.git\n[url "${path.join(base, 'gone')}"]\n\tinsteadOf = https://github.com/gone/devteam.git\n[protocol "ext"]\n\tallow = always\n[url "ext::${HANG}"]\n\tinsteadOf = https://github.com/slow/devteam.git\n`);
  const env = { ...reg.env(clean()), DEVTEAM_ROLE: 'supervisor' };
  const f = path.join(root, 'docs/devteam/scripts/devteam.mjs');
  const dt = (args, extra = {}) => {
    const r = spawnSync(process.execPath, [f, ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 600000 });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const ok = (args, extra) => { const r = dt(args, extra); assert.equal(r.status, 0, `${args.join(' ')}: ${r.out}`); return r; };
  const body = path.join(base, 'body.md');
  fs.writeFileSync(body, 'A chore.\n\n## One-way doors\n\nNone.\n');
  // a chore PR off main: kit files copied from a tag, upstream_base set, the pin given as a version
  // (its pair), 'delete', or a pair of the test's own; edit(worktree) for anything else; pushed
  const pr = (slug, { tag = null, files = [], set = undefined, pin = undefined, edit = null } = {}) => {
    const w = path.join(base, `wt-${slug}`);
    g(['worktree', 'add', '-q', '-b', `chore-${slug}`, w, 'origin/main'], root);
    for (const file of files) fs.writeFileSync(path.join(w, 'docs/devteam', file), upFile(tag, file));
    if (set !== undefined) editSettings(w, (s) => ({ ...s, upstream_base: set }));
    if (pin === 'delete') { g(['rm', '-q', 'docs/devteam/package.json', 'docs/devteam/package-lock.json'], w); } else if (typeof pin === 'string') writePair(w, pairOf(pin)); else if (pin) writePair(w, pin);
    if (edit) edit(w);
    g(['add', '-A'], w);
    g(['commit', '-qm', slug], w);
    g(['push', '-q', '-f', 'origin', `chore-${slug}`], w);
    return { w, sha: g(['rev-parse', 'HEAD'], w), args: ['merge', '--chore', slug, '--title', `chore-${slug}: ${slug}`, '--body-file', body] };
  };
  // an owner's governance-edit answer, for a chore that changes kit files outside a sync
  const answered = () => {
    const q = ok(['ask', '--question', `Land it? ${crypto.randomBytes(3).toString('hex')}`, '--class', 'governance-edit', '--reasons', 'owner-only', '--recommendation', 'yes']).stdout.trim();
    ok(['answer', q, 'yes', '--from-chat', '--said', 'yes, land it']);
    return q;
  };
  const tip = () => { g(['fetch', '-q', 'origin'], root); return g(['rev-parse', 'origin/main'], root); };
  const acts = () => JSON.parse(ok(['log', '--type', 'act', '--json']).stdout).filter((a) => a.class === 'merge-chore');
  const kitTree = path.join(root, 'docs/devteam/.kit');
  const current = () => { try { return fs.readlinkSync(path.join(kitTree, 'current')); } catch { return null; } };
  const findings = () => JSON.parse(ok(['metrics', '--json']).stdout).findings.filter((x) => x.kind === 'package-pin-skipped');
  return { root, reg, env, dt, ok, pr, answered, tip, acts, kitTree, current, findings };
}
const sync = (I, tag, opts = {}) => I.pr(`devteam-sync-${tag}`, { tag, files: ['governance/quality.md', ...(tag === 'v1.0.0' ? ['scripts/devteam.mjs'] : [])], set: tag, pin: tag.slice(1), ...opts });

test('M1 a layout-1 sync carrying its pin: checked, adopted without an answer, the act records the pin, installed after the merge', async () => {
  const I = await instance('m1');
  const P = sync(I, 'v0.101.0');
  const r = I.dt(P.args);
  assert.equal(r.status, 0, `M1 merges: ${r.out}`);
  assert.match(r.stdout, /approved by settings\.upstream_sync "adopt"/, 'M1 adopted under "adopt", no answer');
  assert.match(r.stdout, /pin: @sanctuarycomputer\/devteam@0\.101\.0 \(layout 1\) is the registry's, with its provenance; it installs after the merge/, 'M1 the pin is checked');
  const calls = I.reg.calls().map((c) => c.argv.join(' '));
  assert.ok(calls.some((c) => c.startsWith(`view ${NAME}@0.101.0 --json`)), 'M1 npm view asked for the pinned version');
  const act = I.acts().at(-1);
  assert.ok(act?.what.includes(`; pin ${NAME}@0.101.0 ${integrityOf('0.101.0')}`), `M1 the act records the version and integrity (${act?.what})`);
  assert.match(r.stdout, /pin: package install: installed @sanctuarycomputer\/devteam@0\.101\.0 \(layout 1\) in docs\/devteam\/\.kit\//, 'M1 installed after the merge');
  assert.ok(r.stdout.indexOf('pin: package install') < r.stdout.indexOf('merged chore-devteam-sync-v0.101.0'), 'M1 the merge is reported last');
  assert.equal(I.current(), folderOf('0.101.0'), "M1 current is the new pin's folder");
});

test('M2 a pin the registry answers differently is refused, with and without --approved, sync or not', async () => {
  for (const [fail, why] of [['integrity', /differs from the registry: its integrity is/], ['no-attestation', /differs from the registry: its provenance is refused \(no-attestation\)/], ['repo', /differs from the registry: its provenance is refused \(repo\)/], ['digest', /differs from the registry: its provenance is refused \(digest\)/]]) {
    const I = await instance(`m2-${fail}`, { fail });
    const before = I.tip();
    const S = sync(I, 'v0.101.0');
    const r = I.dt(S.args);
    assert.notEqual(r.status, 0, `M2 ${fail}: the sync is refused (${r.out})`);
    assert.match(r.out, why, `M2 ${fail}: the sync is refused naming why`);
    const q = I.answered();
    assert.match(I.dt([...S.args, '--approved', q, '--dry-run']).out, why, `M2 ${fail}: --approved skips nothing`);
    const C = I.pr(`pin-fix-${fail}`, { pin: '0.101.0', set: 'v0.101.0' });
    const c = I.dt([...C.args, '--approved', q]);
    assert.notEqual(c.status, 0, `M2 ${fail}: a chore that isn't a sync is refused too`);
    assert.match(c.out, why, `M2 ${fail}: a chore that isn't a sync is checked too`);
    assert.equal(I.tip(), before, `M2 ${fail}: nothing landed`);
  }
  // the registry's answer to npm view, rewritten by an npm of the test's own (DT_VIEW names how; every
  // other call is the fake's): a dependency, another name, no layout, a layout the tag's marker
  // contradicts, an E401
  const I = await instance('m2-manifest');
  const bin = scratch('view-npm');
  fs.writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}\nconst a = process.argv.slice(2);\nconst r = require('node:child_process').spawnSync(${JSON.stringify(path.join(I.reg.bin, 'npm'))}, a, { encoding: 'utf8' });\nlet out = r.stdout ?? '';\nconst how = process.env.DT_VIEW;\nif (a[0] === 'view' && r.status === 0 && how) {\n  if (/^E[A-Z0-9_]+$/.test(how)) { process.stderr.write('npm error code ' + how + '\\nnpm error request failed\\n'); process.exit(1); }\n  const m = JSON.parse(out);\n  if (how === 'empty') process.exit(0);\n  if (how === 'dependencies') m.dependencies = { 'left-pad': '1.3.0' };\n  if (how === 'name') m.name = '@someone/devteam';\n  if (how === 'no-layout') delete m.devteam;\n  if (how === 'layout-2') m.devteam = { layout: 2 };\n  out = JSON.stringify(m);\n}\nprocess.stdout.write(out); process.stderr.write(r.stderr ?? ''); process.exit(r.status ?? 1);\n`, { mode: 0o755 });
  const q = I.answered();
  for (const [how, why] of [['dependencies', /differs from the registry: the package has dependencies \(dependencies\)/], ['name', /differs from the registry: its manifest names @someone\/devteam@0\.101\.0/], ['no-layout', /differs from the registry: its manifest has no devteam\.layout of 1 or 2/], ['layout-2', /differs from the registry: its manifest says layout 2, but v0\.101\.0 lacks the launcher's marker/], ['E401', /differs from the registry: npm view @sanctuarycomputer\/devteam@0\.101\.0 failed \(E401\)/]]) {
    const C = I.pr(`pin-${how.toLowerCase()}`, { pin: '0.101.0', set: 'v0.101.0' });
    const r = I.dt([...C.args, '--approved', q, '--dry-run'], { PATH: `${bin}${path.delimiter}${I.env.PATH}`, DT_VIEW: how });
    assert.notEqual(r.status, 0, `M2 ${how}: refused (${r.out})`);
    assert.match(r.out, why, `M2 ${how}: refused naming why`);
  }
  // npm view answers nothing for a version the package doesn't list (task-1 T1-5): unpublished, not refused
  const E = I.pr('pin-empty', { pin: '0.101.0', set: 'v0.101.0' });
  const er = I.dt([...E.args, '--approved', q, '--dry-run'], { PATH: `${bin}${path.delimiter}${I.env.PATH}`, DT_VIEW: 'empty' });
  assert.equal(er.status, 0, `M2 empty answer: a layout-1 skip (${er.out})`);
  assert.match(er.stderr, /pin: can't verify @sanctuarycomputer\/devteam@0\.101\.0 \(unpublished\)/, 'M2 empty answer: unpublished');
  assert.equal(g(['for-each-ref', 'refs/devteam-pin'], I.root), '', 'M2 the tag refs are removed after each check');
  // a socket fault npm names (EPROTO, ENETDOWN): no answer came, so a layout-1 pin goes on, never refused
  for (const how of ['EPROTO', 'ENETDOWN']) {
    const C = I.pr(`pin-${how.toLowerCase()}`, { pin: '0.101.0', set: 'v0.101.0' });
    const r = I.dt([...C.args, '--approved', q, '--dry-run'], { PATH: `${bin}${path.delimiter}${I.env.PATH}`, DT_VIEW: how });
    assert.equal(r.status, 0, `M2 ${how}: unreachable, not refused (${r.out})`);
    assert.match(r.stderr, /pin: can't verify @sanctuarycomputer\/devteam@0\.101\.0 \(unreachable\)/, `M2 ${how}: said unreachable`);
  }
});

test("M3 package_name and upstream_repo are main's, whatever the PR sets", async () => {
  // the PR names another package: its pin of main's package is checked as main's (a head read would refuse it)
  const I = await instance('m3');
  const q = I.answered();
  const A = I.pr('rename', { pin: '0.101.0', set: 'v0.101.0', edit: (w) => editSettings(w, (s) => ({ ...s, package_name: '@acme/devteam' })) });
  const a = I.dt([...A.args, '--approved', q, '--dry-run']);
  assert.match(a.out, /pin: @sanctuarycomputer\/devteam@0\.101\.0 \(layout 1\) is the registry's/, "M3 the pin is read with main's package_name");
  // the statement names someone-else/devteam; a PR setting that as upstream_repo is still checked against main's
  const J = await instance('m3-repo', { fail: 'repo' });
  const B = J.pr('upstream', { pin: '0.101.0', set: 'v0.101.0', edit: (w) => editSettings(w, (s) => ({ ...s, upstream_repo: 'someone-else/devteam' })) });
  const b = J.dt([...B.args, '--approved', J.answered(), '--dry-run']);
  assert.match(b.out, /its provenance is refused \(repo\)/, "M3 the provenance is checked against main's upstream_repo");
});

test('M4 a pin of another version than the head\'s upstream_base, and a deleted pair, are refused with both fixes', async () => {
  const I = await instance('m4');
  const q = I.answered();
  const fixes = /restore main's pair \(git checkout origin\/main -- docs\/devteam\/package\.json docs\/devteam\/package-lock\.json, which needs no registry\) or run devteam\.mjs package pin v0\.10[01]\.0/;
  const A = I.pr('wrong-version', { pin: '0.101.0' });
  const a = I.dt([...A.args, '--approved', q, '--dry-run']);
  assert.notEqual(a.status, 0, 'M4 another version: refused');
  assert.match(a.out, /pins @sanctuarycomputer\/devteam@0\.101\.0, but upstream_base at its head is "v0\.100\.0"/, 'M4 another version: named');
  assert.match(a.out, fixes, 'M4 another version: both fixes');
  for (const [slug, opts] of [['deleted', { pin: 'delete' }], ['sync-deleted', { pin: 'delete', set: 'v0.101.0', tag: 'v0.101.0', files: ['governance/quality.md'] }]]) {
    const D = I.pr(slug === 'sync-deleted' ? 'devteam-sync-v0.101.0' : slug, opts);
    const d = I.dt([...D.args, '--approved', q, '--dry-run']);
    assert.notEqual(d.status, 0, `M4 ${slug}: refused`);
    assert.match(d.out, /deletes the pin pair \(docs\/devteam\/package\.json, docs\/devteam\/package-lock\.json missing at its head\)/, `M4 ${slug}: named`);
    assert.match(d.out, fixes, `M4 ${slug}: both fixes`);
  }
  // a pair whose fields are right but whose bytes aren't packagePinPair's: refused, the registry up or not
  const odd = Object.fromEntries(Object.entries(pairOf('0.101.0')).map(([k, t]) => [k, k === 'package.json' ? t.replace('\n}\n', ',\n  "scripts": {}\n}\n') : t]));
  const J = await instance('m4-unreachable', { fail: 'unreachable' });
  for (const [X, label] of [[J, 'registry unreachable'], [I, 'registry up']]) {
    const B = X.pr('odd-bytes', { pin: odd, set: 'v0.101.0' });
    const b = X.dt([...B.args, '--approved', X === I ? q : X.answered(), '--dry-run']);
    assert.notEqual(b.status, 0, `M4 other bytes, ${label}: refused`);
    assert.match(b.out, /its pin isn't a pin of @sanctuarycomputer\/devteam, main's package_name \(its bytes are not packagePinPair's\)/, `M4 other bytes, ${label}: named`);
  }
  // an upstream_base that isn't a string, in a sync: a refusal line, never a stack trace (plan-2 P2-2)
  const T = I.pr('devteam-sync-v0-101-0', { tag: 'v0.101.0', files: ['governance/quality.md'], pin: '0.101.0', edit: (w) => editSettings(w, (x) => ({ ...x, upstream_base: 5 })) });
  const t = I.dt([...T.args, '--approved', q, '--dry-run']);
  assert.notEqual(t.status, 0, 'M4 a number upstream_base: refused');
  assert.doesNotMatch(t.out, /TypeError|    at /, `M4 a number upstream_base: no throw (${t.out.slice(0, 600)})`);
  assert.match(t.out, /pins @sanctuarycomputer\/devteam@0\.101\.0, but upstream_base at its head is 5/, 'M4 a number upstream_base: named');
  // a DEVTEAM_NPM_REGISTRY npmRun refuses (not http://127.0.0.1:<port>/): the merge is refused, never a layout-1 skip (final-1 F2)
  const X = I.pr('pin-bad-registry', { pin: '0.101.0', set: 'v0.101.0' });
  const x = I.dt([...X.args, '--approved', q, '--dry-run'], { DEVTEAM_NPM_REGISTRY: 'http://localhost:1/' });
  assert.notEqual(x.status, 0, `M4 a bad DEVTEAM_NPM_REGISTRY: refused (${x.out})`);
  assert.match(x.out, /can't check the pin @sanctuarycomputer\/devteam@0\.101\.0: .*DEVTEAM_NPM_REGISTRY/, 'M4 a bad DEVTEAM_NPM_REGISTRY: named');
  assert.doesNotMatch(x.out, /pin: can't verify/, 'M4 a bad DEVTEAM_NPM_REGISTRY: not a skip');
  // a branch with no merge base with main: refused, never unchecked
  const w = path.join(path.dirname(I.root), 'wt-orphan');
  g(['worktree', 'add', '-q', '--detach', w, 'origin/main'], I.root);
  g(['checkout', '-q', '--orphan', 'chore-orphan'], w);
  g(['commit', '-qm', 'orphan'], w);
  g(['push', '-q', 'origin', 'chore-orphan'], w);
  const o = I.dt(['merge', '--chore', 'orphan', '--title', 'chore-orphan: orphan', '--body-file', path.join(path.dirname(I.root), 'body.md'), '--approved', q, '--dry-run']);
  assert.notEqual(o.status, 0, 'M4 no merge base: refused, exit');
  assert.match(o.out, /can't find where [0-9a-f]{12} meets origin\/main, so its pin and docs\/devteam\/\.kit can't be checked/, 'M4 no merge base: refused');
});

test('M5 a sync to a tag that carries the launcher needs its pin, verified, installed before the merge; current switches right after', async () => {
  const I = await instance('m5');
  const before = I.tip();
  // no pin bump: refused
  const A = sync(I, 'v1.0.0', { pin: undefined });
  const a = I.dt(A.args);
  assert.notEqual(a.status, 0, 'M5 no pin: refused');
  assert.match(a.out, /v1\.0\.0 carries the launcher \(layout 2\), so its sync must pin it: run devteam\.mjs package pin v1\.0\.0/, 'M5 no pin: named, with the fix');
  g(['worktree', 'remove', '--force', A.w], I.root);
  g(['branch', '-q', '-D', 'chore-devteam-sync-v1.0.0'], I.root);
  // pinned, but the install before the merge fails (.kit can't be made): refused, nothing lands
  const B = sync(I, 'v1.0.0');
  fs.writeFileSync(I.kitTree, 'not a folder\n');
  const b = I.dt(B.args);
  assert.notEqual(b.status, 0, `M5 a failed install before: refused (${b.out})`);
  assert.match(b.out, /the install of @sanctuarycomputer\/devteam@1\.0\.0 \(layout 2\) before the merge failed, so nothing merged/, 'M5 a failed install before: named');
  assert.equal(I.tip(), before, 'M5 a failed install before: nothing landed');
  fs.rmSync(I.kitTree);
  // pinned and verified: installed into its own folder before the merge, current switched after
  const r = I.dt(B.args);
  assert.equal(r.status, 0, `M5 merges: ${r.out}`);
  const into = r.stdout.indexOf(`package install: installed ${NAME}@1.0.0 into ${path.join(I.kitTree, folderOf('1.0.0'))} (layout 2), verified`);
  assert.ok(into >= 0, `M5 installed into its folder before the merge (${r.stdout})`);
  const merged = r.stdout.indexOf('merged chore-devteam-sync-v1.0.0');
  const landed = r.stdout.indexOf(`pin: package install: installed ${NAME}@1.0.0 (layout 2) in docs/devteam/.kit/${folderOf('1.0.0')}`);
  assert.ok(into < landed && landed < merged, 'M5 the install ran before the landing and current switched after it');
  assert.equal(I.current(), folderOf('1.0.0'), 'M5 current names the new folder');
  // a layout-2 pin with the registry out of reach is refused
  const J = await instance('m5-unreachable', { fail: 'unreachable' });
  const U = sync(J, 'v1.0.0');
  const u = J.dt(U.args);
  assert.notEqual(u.status, 0, 'M5 unreachable, layout 2: refused');
  assert.match(u.out, /can't verify the layout-2 pin @sanctuarycomputer\/devteam@1\.0\.0 \(unreachable\)/, 'M5 unreachable, layout 2: named');
  // a chore that isn't a sync pinning v1.0.0 (whose tag carries the launcher) as layout 1: strict all the same
  const k = J.pr('pin-fix-launcher', { pin: pairOf('1.0.0', 1), set: 'v1.0.0' });
  const kr = J.dt([...k.args, '--approved', J.answered(), '--dry-run']);
  assert.notEqual(kr.status, 0, 'M5 a launcher release pinned as layout 1 outside a sync: refused');
  assert.match(kr.out, /can't verify the layout-2 pin @sanctuarycomputer\/devteam@1\.0\.0 \(unreachable\)/, 'M5 a launcher release pinned as layout 1 outside a sync: held to layout 2');
  // a launcher sync whose pair main pins already: checked in full, installed before, merged
  const K = await instance('m5-pinned', { mainPin: '1.0.0', mainBase: 'v0.101.0' });
  // the same sync leaving upstream_base at main's v0.101.0: refused with the one fix (task-1 T1-1)
  const W = K.pr('devteam-sync-v1-0-0', { tag: 'v1.0.0', files: ['governance/quality.md', 'scripts/devteam.mjs'] });
  const wr = K.dt([...W.args, '--approved', K.answered(), '--dry-run']);
  assert.notEqual(wr.status, 0, 'M5 main pins the tag, upstream_base not moved: refused');
  assert.match(wr.out, /v1\.0\.0 carries the launcher \(layout 2\), so its sync must pin it: run devteam\.mjs package pin v1\.0\.0/, 'M5 main pins the tag, upstream_base not moved: the one fix');
  assert.doesNotMatch(wr.out, /restore main's pair/, "M5 main pins the tag, upstream_base not moved: not main's pair");
  const P = sync(K, 'v1.0.0', { pin: undefined });
  const p = K.dt(P.args);
  assert.equal(p.status, 0, `M5 main pins the tag already: merges (${p.out})`);
  assert.match(p.stdout, /pin: @sanctuarycomputer\/devteam@1\.0\.0 \(layout 2\) is the registry's, with its provenance; it installs before the merge/, 'M5 main pins the tag already: checked');
  assert.ok(p.stdout.includes(`package install: installed ${NAME}@1.0.0 into ${path.join(K.kitTree, folderOf('1.0.0'))} (layout 2), verified`), 'M5 main pins the tag already: installed before');
  assert.equal(K.current(), folderOf('1.0.0'), 'M5 main pins the tag already: current switched');
  // upstream can't be read: the sync's own devteam.mjs (the tag's, with the marker) decides, so no pin is refused
  const G = await instance('m5-gone', { upstream: 'gone/devteam' });
  const N = sync(G, 'v1.0.0', { pin: undefined });
  const nr = G.dt([...N.args, '--approved', G.answered(), '--dry-run']);
  assert.notEqual(nr.status, 0, 'M5 tag unread, no pin: refused');
  assert.match(nr.out, /pin: can't read v1\.0\.0 from gone\/devteam, so whether it carries the launcher is read from the PR's own copy/, 'M5 tag unread: said');
  assert.match(nr.out, /v1\.0\.0 carries the launcher \(layout 2\), so its sync must pin it/, 'M5 tag unread, no pin: the PR\'s copy decides');
  // upstream never answers: the tag fetch is killed at its bound, and a layout-1 pin goes on
  const H = await instance('m5-hang', { upstream: 'slow/devteam', fail: 'unreachable' });
  const Q = H.pr('pin-slow', { pin: '0.101.0', set: 'v0.101.0' });
  const hq = H.answered();
  const t0 = Date.now();
  const hr = H.dt([...Q.args, '--approved', hq, '--dry-run'], { DEVTEAM_GIT_TIMEOUT_MS: '2000' });
  const took = Date.now() - t0;
  assert.equal(hr.status, 0, `M5 a hung upstream: the merge goes on (${hr.out})`);
  assert.ok(took < 45000, `M5 a hung upstream: the fetch is bounded (${took} ms, the upstream hangs 90 s)`);
  assert.match(hr.stderr, /pin: can't read v0\.101\.0 from slow\/devteam, so whether it carries the launcher is left to the registry's manifest/, 'M5 a hung upstream: said');
});

test("M6 a layout-1 pin: an unreachable registry, or a missing or old npm, is a finding and the merge goes on; the install after is best effort", async () => {
  const bin = scratch('nonpm');
  for (const t of ['git']) fs.symlinkSync(execFileSync('sh', ['-c', `command -v ${t}`], { encoding: 'utf8' }).trim(), path.join(bin, t));
  for (const [fail, cause, extra] of [['unreachable', 'unreachable', {}], ['server-error', 'unreachable', {}], ['old-npm', 'old-npm', {}], [null, 'no-npm', { PATH: bin }]]) {
    const I = await instance(`m6-${fail ?? cause}`, { fail });
    const S = sync(I, 'v0.101.0');
    const r = I.dt(S.args, extra);
    assert.equal(r.status, 0, `M6 ${cause}: the merge goes on (${r.out})`);
    assert.match(r.stderr, new RegExp(`pin: can't verify @sanctuarycomputer/devteam@0\\.101\\.0 \\(${cause}\\)`), `M6 ${cause}: said`);
    assert.match(r.stderr, /merged, but the install of @sanctuarycomputer\/devteam@0\.101\.0 after the merge did not finish/, `M6 ${cause}: the install after failed, said`);
    assert.match(r.stdout, /merged chore-devteam-sync-v0\.101\.0/, `M6 ${cause}: the merge is reported done`);
    assert.equal(I.current(), null, `M6 ${cause}: current as it was`);
    const f = I.findings().find((x) => x.subject === 'v0.101.0');
    assert.ok(f && f.severity === 'medium' && f.detail.includes(`(${cause})`), `M6 ${cause}: a finding names the cause (${JSON.stringify(I.findings())})`);
  }
  // a version the registry doesn't publish (0.102.0, a pair of the test's own): a finding, merged
  const U = await instance('m6-unpublished');
  const unpub = packagePinPair({ name: NAME, version: '0.102.0', integrity: `sha512-${crypto.createHash('sha512').update('0.102.0').digest('base64')}`, resolved: `https://registry.npmjs.org/${NAME}/-/devteam-0.102.0.tgz`, layout: 1 });
  const C = U.pr('pin-unpublished', { pin: unpub, set: 'v0.102.0' });
  const c = U.dt([...C.args, '--approved', U.answered()]);
  assert.equal(c.status, 0, `M6 unpublished: the merge goes on (${c.out})`);
  assert.match(c.stderr, /pin: can't verify @sanctuarycomputer\/devteam@0\.102\.0 \(unpublished\)/, 'M6 unpublished: said');
  assert.ok(U.findings().some((x) => x.subject === 'v0.102.0' && x.detail.includes('(unpublished)')), 'M6 unpublished: a finding');
  // the check passes and the install after fails (.kit can't be made): a finding, the merge done
  const I = await instance('m6-install');
  const S = sync(I, 'v0.101.0');
  fs.writeFileSync(I.kitTree, 'not a folder\n');
  const r = I.dt(S.args);
  assert.equal(r.status, 0, `M6 install: the merge is done (${r.out})`);
  assert.match(r.stderr, /after the merge did not finish: .*refused \(tree\)/, 'M6 install: said');
  const f = I.findings().find((x) => x.subject === 'v0.101.0');
  assert.ok(f?.detail.includes('(install)'), 'M6 install: a finding');
});

test('M7 the pair is exempt from the sync checks and only the pair: another change still needs the answer', async () => {
  const I = await instance('m7');
  const S = sync(I, 'v0.101.0', { edit: (w) => fs.appendFileSync(path.join(w, 'docs/devteam/process/worker.md'), '\nNot upstream.\n') });
  const r = I.dt([...S.args, '--dry-run']);
  assert.notEqual(r.status, 0, 'M7 refused');
  assert.match(r.out, /covers only a whole newer release: its kit files aren't exactly what upstream changed from v0\.100\.0 to v0\.101\.0; extra docs\/devteam\/process\/worker\.md\. The owner's answer is needed/, 'M7 the other file is named, the pair is not');
  assert.doesNotMatch(r.out.split('\n').find((l) => l.includes('covers only a whole newer release')), /package(-lock)?\.json/, "M7 the sync check doesn't name the pair");
  // the same files as the release, one of them not upstream's byte for byte: the verbatim check names it, and only it
  const J = await instance('m7-bytes');
  const B = sync(J, 'v0.101.0', { edit: (w) => fs.appendFileSync(path.join(w, 'docs/devteam/governance/quality.md'), 'x') });
  const b = J.dt([...B.args, '--dry-run']);
  assert.notEqual(b.status, 0, 'M7 a changed byte: refused');
  const line = b.out.split('\n').find((l) => l.includes('copied verbatim from upstream')) ?? '';
  assert.match(line, /standing approval covers only files copied verbatim from upstream v0\.101\.0; these differ: docs\/devteam\/governance\/quality\.md\. The owner's answer is needed/, 'M7 a changed byte: the file is named');
  assert.doesNotMatch(line, /package(-lock)?\.json/, "M7 a changed byte: the verbatim check doesn't name the pair");
});

test('M8 a PR that adds or changes a path under docs/devteam/.kit is refused, whatever the approval, naming the path', async () => {
  const I = await instance('m8');
  const q = I.answered();
  for (const p of ['docs/devteam/.kit/x', 'docs/devteam/.KIT/x', 'docs/devteam/.kit./x', 'docs/DevTeam/.kit/x', 'docs/devteam/KIT~1/x', 'docs/devteam/.k\u200cit/x', 'docs/devteam/.kit', 'docs/devteam/.kit:x', 'docs/devteam/.kit::$INDEX_ALLOCATION/x', 'docs/devteam/.kit\\x', 'docs/DEVTEA~1/.kit/x']) {
    const slug = `kit-${crypto.createHash('sha1').update(p).digest('hex').slice(0, 8)}`;
    const P = I.pr(slug, { edit: (w) => { fs.mkdirSync(path.dirname(path.join(w, p)), { recursive: true }); fs.writeFileSync(path.join(w, p), 'x\n'); g(['add', '-f', '--', p], w); } });
    const r = I.dt([...P.args, '--approved', q, '--dry-run']);
    assert.notEqual(r.status, 0, `M8 ${JSON.stringify(p)}: refused`);
    assert.ok(r.out.includes(`adds or changes ${p}: docs/devteam/.kit holds this machine's installs and is never committed`), `M8 ${JSON.stringify(p)}: named (${r.out})`);
  }
  const P = I.pr('kitten', { edit: (w) => { fs.mkdirSync(path.join(w, 'docs/devteam/.kitten'), { recursive: true }); fs.writeFileSync(path.join(w, 'docs/devteam/.kitten/x'), 'x\n'); } });
  const kr = I.dt([...P.args, '--approved', q, '--dry-run']);
  assert.equal(kr.status, 0, `M8 .kitten merges (${kr.out})`);
  assert.doesNotMatch(kr.out, /never committed/, 'M8 .kitten is not .kit');
  // a path under .kit main holds already (committed before this rule): a PR that deletes it is not refused for it
  fs.mkdirSync(path.join(I.root, 'docs/devteam/.kit'), { recursive: true });
  fs.writeFileSync(path.join(I.root, 'docs/devteam/.kit/old'), 'x\n');
  g(['add', '-f', 'docs/devteam/.kit/old'], I.root);
  g(['commit', '-qm', 'a .kit path from before'], I.root);
  g(['push', '-q', 'origin', 'HEAD:main'], I.root);
  const D = I.pr('kit-gone', { edit: (w) => g(['rm', '-q', 'docs/devteam/.kit/old'], w) });
  const dr = I.dt([...D.args, '--approved', q, '--dry-run']);
  assert.equal(dr.status, 0, `M8 deleting a .kit path merges (${dr.out})`);
  assert.doesNotMatch(dr.out, /never committed/, 'M8 deleting a .kit path is not refused');
  // a path with a newline is named quoted, never as two lines (task-1 T1-8)
  const nl = 'docs/devteam/.kit/a\nb';
  const NL = I.pr('kit-newline', { edit: (w) => { fs.mkdirSync(path.join(w, 'docs/devteam/.kit'), { recursive: true }); fs.writeFileSync(path.join(w, nl), 'x\n'); g(['add', '-f', '--', nl], w); } });
  const nr = I.dt([...NL.args, '--approved', q, '--dry-run']);
  assert.notEqual(nr.status, 0, 'M8 a newline path: refused');
  assert.ok(nr.out.includes(`adds or changes ${JSON.stringify(nl)}: docs/devteam/.kit`), `M8 a newline path: named quoted (${nr.out})`);
});

test('M9 the kit ships SYNC_PINS true, once', () => {
  assert.equal(SRC.split('const SYNC_PINS = true;').length, 2, 'M9 SYNC_PINS is true, once');
  assert.equal(SRC.split('const SYNC_PINS = false;').length, 1, 'M9 and never false');
});
