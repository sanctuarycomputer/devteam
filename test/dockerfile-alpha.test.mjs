// The box image's alpha step (kit-963; alpha@1 step 5, design decision 9 of kit-package-dist): one RUN
// in cloud/Dockerfile, after ARG DEVTEAM_RELEASE, installs the stamped release's package into
// /opt/devteam/alpha with the kit's own install step (kit-install@1's `package install --version v
// --into <dir>`) and never fails the build. Checks are numbered as in the ticket's spec (D1 to D5).
// D1 reads the Dockerfile's instructions. D2 to D5 run that RUN's own text under /bin/sh, as docker
// runs a RUN, with only /opt/devteam moved under a scratch folder of this file's: against
// test/lib/fake-registry.mjs (a loopback registry, a fake npm first on PATH, statements signed by the
// fake's test CA whose commits name an upstream repo of this file's), from a folder in no repo, with
// every DEVTEAM_*, GIT_* and npm_config_* variable of the test's own dropped, then the image's ENV
// before the step set as the image sets it (IMAGE_ENV), DEVTEAM_RELEASE set as docker sets a build ARG,
// and DEVTEAM_HUB_PORT away from the box's 4320 (the step starts no hub; a guard all the same); a umask
// of 077 (a builder whose files come out unreadable, as Render's once did); a `chown` first on PATH that
// records its arguments and exits $CHOWN_EXIT (a test is not root), and a `chmod` that runs the real
// one unless $CHMOD_EXIT is set.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kit } from './lib/kit.mjs';
import { startFakeRegistry, NAME } from './lib/fake-registry.mjs';

const DOCKERFILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'cloud', 'Dockerfile');
const CMD = 'node /opt/devteam/kit/scripts/devteam.mjs package install --version "$DEVTEAM_RELEASE" --into /opt/devteam/alpha';
const REPO = 'sanctuarycomputer/devteam';
const L1 = '0.101.0';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-dockerfile-alpha-'));
const regs = [];
after(async () => {
  for (const r of regs) await r.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
let n = 0;
const scratch = (name) => { const d = path.join(tmp, `${++n}-${name}`); fs.mkdirSync(d, { recursive: true }); return d; };

// The Dockerfile's instructions, as docker reads them: comment and blank lines dropped, a line ending in
// a backslash joined to the next (the backslash and newline removed), a heredoc's body (<<EOF … EOF)
// kept out. Each is { line (1-based, its first), keyword, text (after the keyword) }.
function instructions(src) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(#|$)/.test(l)) continue;
    const at = i;
    let text = l;
    while (/\\$/.test(text) && i + 1 < lines.length) {
      i++;
      if (/^\s*#/.test(lines[i])) continue;
      text = `${text.slice(0, -1)}${lines[i]}`;
    }
    const m = /^\s*([A-Za-z]+)\s+([\s\S]*)$/.exec(text);
    if (!m) continue;
    out.push({ line: at + 1, keyword: m[1].toUpperCase(), text: m[2] });
    const h = /<<-?(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(text);
    if (h) while (i + 1 < lines.length && lines[++i] !== h[2]);
  }
  return out;
}
const SRC = fs.readFileSync(DOCKERFILE, 'utf8');
const INS = instructions(SRC);
// the one RUN that installs the alpha
const alphaRuns = INS.filter((x) => x.keyword === 'RUN' && /\bpackage install\b/.test(x.text));
const step = () => {
  assert.equal(alphaRuns.length, 1, `exactly one RUN in cloud/Dockerfile runs package install (${alphaRuns.length})`);
  return alphaRuns[0];
};

// upstream: v0.101.0 tagged on its main; the registry's statements name its commit
function upstream() {
  const u = path.join(scratch('upstream'), 'devteam');
  fs.mkdirSync(u);
  const g = (args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: u, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  g(['init', '-q', '-b', 'main']);
  g(['commit', '-q', '--allow-empty', '-m', 'one']);
  g(['tag', '-a', `v${L1}`, '-m', L1]);
  g(['commit', '-q', '--allow-empty', '-m', 'two']);
  return { dir: u, commits: { [L1]: g(['rev-parse', `v${L1}^{commit}`]) } };
}
const UP = upstream();

// what the image's ENV instructions before the step set (cloud/Dockerfile's ENV lines; DEVTEAM_KIT_RELEASE
// and DEVTEAM_BOX_TOOLS follow the stamp, DEVTEAM_KIT_RELEASE set per run)
const IMAGE_ENV = { DEVTEAM_PREVIEWS: '1', DEVTEAM_PROJECT_HOSTS: '1', DEVTEAM_IMAGE_HUB: '4320', DEVTEAM_MEMORY_COUNTS_CACHE: '1', DEVTEAM_BOX_TOOLS: 'claude-code=0 claude-swap=0 gh=0 ttyd=0 mise=0 uv=0' };
// The step's own text run as docker runs it, with /opt/devteam under a scratch folder: { status,
// output, alpha (the moved /opt/devteam/alpha), chown (each call's argv) }.
async function runStep(name, { release = `v${L1}`, fail = null, chownExit = 0, chmodExit = 0, umask = '077' } = {}) {
  const base = scratch(name);
  const opt = path.join(base, 'opt', 'devteam');
  fs.cpSync(kit, path.join(opt, 'kit'), { recursive: true, filter: (p) => !/[\\/](project|run|\.kit)([\\/]|$)/.test(p.slice(kit.length)) });
  const cwd = path.join(base, 'cwd');
  fs.mkdirSync(cwd);
  assert.notEqual(spawnSync('git', ['rev-parse', '--git-dir'], { cwd, encoding: 'utf8' }).status, 0, 'the step runs in no repo');
  const shim = path.join(base, 'shim');
  fs.mkdirSync(shim);
  const chownLog = path.join(base, 'chown.jsonl');
  fs.writeFileSync(path.join(shim, 'chown'), `#!${process.execPath}\nrequire('fs').appendFileSync(${JSON.stringify(chownLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.exit(Number(process.env.CHOWN_EXIT || 0));\n`, { mode: 0o755 });
  const realChmod = ['/bin/chmod', '/usr/bin/chmod'].find((f) => fs.existsSync(f));
  fs.writeFileSync(path.join(shim, 'chmod'), `#!/bin/sh\n[ "\${CHMOD_EXIT:-0}" = 0 ] || exit "$CHMOD_EXIT"\nexec ${realChmod} "$@"\n`, { mode: 0o755 });
  fs.symlinkSync(process.execPath, path.join(shim, 'node'));
  const reg = await startFakeRegistry({ fail, commits: UP.commits });
  regs.push(reg);
  fs.writeFileSync(path.join(reg.home, '.gitconfig'), `[url "${UP.dir}"]\n\tinsteadOf = https://github.com/${REPO}.git\n`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && !/^GIT_/.test(k) && !/^npm_config_/i.test(k)));
  env.PATH = `${shim}${path.delimiter}${env.PATH ?? ''}`;
  const e = { ...reg.env(env), ...IMAGE_ENV, DEVTEAM_KIT_RELEASE: release, DEVTEAM_RELEASE: release, CHOWN_EXIT: String(chownExit), CHMOD_EXIT: String(chmodExit), DEVTEAM_HUB_PORT: '4999' };
  const text = step().text.replaceAll('/opt/devteam', opt);
  const r = spawnSync('/bin/sh', ['-c', `umask ${umask}\n${text}`], { cwd, env: e, encoding: 'utf8', timeout: 300000 });
  const chown = fs.existsSync(chownLog) ? fs.readFileSync(chownLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { status: r.status, signal: r.signal, output: `${r.stdout ?? ''}${r.stderr ?? ''}`, alpha: path.join(opt, 'alpha'), chown };
}
// the step's output on one line, for a message
const brief = (r) => r.output.trim().split('\n').join(' | ').slice(0, 400);
const verified = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'verified.json'), 'utf8')); } catch { return null; } };

test('D1 one RUN, after ARG DEVTEAM_RELEASE, runs the install step for the stamp into /opt/devteam/alpha', () => {
  const s = step();
  const arg = INS.findIndex((x) => x.keyword === 'ARG' && /^DEVTEAM_RELEASE=/.test(x.text));
  assert.ok(arg >= 0, 'the Dockerfile has ARG DEVTEAM_RELEASE');
  assert.ok(INS.indexOf(s) > arg, `the step (line ${s.line}) comes after ARG DEVTEAM_RELEASE (line ${INS[arg].line})`);
  assert.ok(s.text.includes(CMD), `the step runs: ${CMD}`);
});

const runs = {};
const once = (key, opts) => (runs[key] ??= runStep(key, opts));
const CASES = [
  ['a good release', 'good', {}],
  ['an unpublished release', 'unpublished', { release: 'v0.102.0' }],
  ['an unreachable registry', 'unreachable', { fail: 'unreachable' }],
  ['a tampered integrity', 'integrity', { fail: 'integrity' }],
];
// a good install whose folder can't be made root's, or readable
const FAILS = [
  ['chown failing', 'chown-fails', { chownExit: 1 }],
  ['chmod failing', 'chmod-fails', { chmodExit: 1 }],
];

test('D2 the step never fails the build: exit 0 for each registry case, and when chown or chmod fails', async () => {
  for (const [what, key, opts] of CASES) {
    const r = await once(key, opts);
    assert.equal(r.status, 0, `D2 ${what}: the step exits 0 (${brief(r)})`);
  }
  for (const [what, key, opts] of FAILS) {
    const r = await once(key, opts);
    assert.equal(r.status, 0, `D2 ${what}: the step exits 0 (${brief(r)})`);
  }
});

test('D3 verified.json only for the good release; every other case leaves no /opt/devteam/alpha', async () => {
  const good = await once('good', {});
  const rec = verified(good.alpha);
  assert.deepEqual([rec?.name, rec?.version, rec?.integrity_ok, rec?.provenance_ok, rec?.provenance?.repo], [NAME, L1, true, true, REPO], `D3 a good release: verified.json (${brief(good)})`);
  for (const [what, key, opts] of CASES.slice(1)) {
    const r = await once(key, opts);
    assert.equal(fs.existsSync(r.alpha), false, `D3 ${what}: no /opt/devteam/alpha (${brief(r)})`);
  }
  for (const [what, key, opts] of FAILS) {
    const c = await once(key, opts);
    assert.equal(fs.existsSync(c.alpha), false, `D3 ${what}: no /opt/devteam/alpha (${brief(c)})`);
  }
});

test('D4 the step leaves /opt/devteam/alpha owned by root (chown -R root:root) and readable by all (a+rX), none of it writable but by its owner', async () => {
  const r = await once('good', {});
  assert.deepEqual(r.chown, [['-R', 'root:root', r.alpha]], 'D4 chown -R root:root on the folder, once');
  const modes = (dir, wrong) => {
    const bad = [];
    const walk = (p) => {
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) return;
      if (wrong(st.mode & 0o777, st.isDirectory())) bad.push(`${path.relative(dir, p) || '.'} ${(st.mode & 0o777).toString(8)}`);
      if (st.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    };
    walk(dir);
    return bad;
  };
  // under umask 077 npm's files come out unreadable to gw: the step makes them readable
  const unreadable = modes(r.alpha, (m, dir) => (m & 0o044) !== 0o044 || (dir && (m & 0o011) !== 0o011));
  assert.deepEqual(unreadable.slice(0, 5), [], `D4 every file readable by all and every folder searchable (umask 077; ${unreadable.length} not)`);
  // under umask 000 they come out writable by all: the step leaves them writable by root alone
  const w = await once('good-wide', { umask: '000' });
  assert.equal(verified(w.alpha)?.version, L1, `D4 umask 000: installed (${brief(w)})`);
  const writable = modes(w.alpha, (m) => (m & 0o022) !== 0);
  assert.deepEqual(writable.slice(0, 5), [], `D4 nothing group- or world-writable (umask 000; ${writable.length} are)`);
});

test('D5 the step prints the install\'s own line, so the build log shows what happened', async (t) => {
  const want = { good: /^package install: installed .* verified$/m, unpublished: /^devteam: package install .*: refused \(unpublished\)/m, unreachable: /^devteam: package install .*: refused \(unreachable\)/m, integrity: /^devteam: package install .*: refused \((?:integrity|audit|provenance:[a-z-]+)\)/m };
  for (const [what, key, opts] of CASES) {
    const r = await once(key, opts);
    t.diagnostic(`${what}: ${r.output.trim().split('\n').join(' | ')}`);
    assert.match(r.output, want[key], `D5 ${what}: the install's line`);
  }
});
