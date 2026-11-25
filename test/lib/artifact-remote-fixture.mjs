// Helpers the artifact-remote tests share (artifact-remote.test.mjs and, split from it by kit-859,
// artifact-remote.chrome.test.mjs): the fetch-logging git shim, the other machine, the dashboard's
// reads and asks, the polls and the set-up.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { write, dashboardOnFreePort, fleetFixture, REAL_GIT } from './kit.mjs';
import { cleanup } from './chrome.mjs';

const J = JSON.stringify;
const ARTS = 'docs/devteam/project/artifacts';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the test interval, and the demand window the design derives from it: max(interval, 10 s) + 5 s
const INT = 1500;
const WINDOW = (int) => Math.max(int, 10000) + 5000;
const DATA_EVERY_MS = 3000;

const art = (title, extra = {}) => ({
  'artifact.json': J({ v: 1, title, summary: `${title}, a page`, by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><head><title>${title}</title></head><body><p id="t">${title}</p></body></html>`,
  ...extra,
});

// A git on the dashboard's PATH. Every fetch is logged as `<ms> start <cwd>|<prompt>|<askpass>|<ssh askpass>|<ssh command>|<argv>`
// and `<ms> end <status>`; with <dir>/hang present it starts `sleep 60` as a child, logs `<ms> hang <child pid>`, and waits on it;
// a SIGTERM there logs `<ms> term` (a SIGKILL logs nothing).
// Times come from node (portable); argv is logged one arg per | -separated field after the env.
function spyGit(F) {
  const dir = path.join(F.base, 'git-spy');
  const log = path.join(dir, 'fetch.log');
  const now = `"${process.execPath}" -e 'process.stdout.write(String(Date.now()))'`;
  write(path.join(dir, 'git'), `#!/bin/sh
if [ "$1" = fetch ] || { [ "$1" = -c ] && printf '%s\\n' "$@" | grep -qx fetch; }; then
  a=""; for x in "$@"; do a="$a $x"; done
  printf '%s start %s|%s|%s|%s|%s|%s\\n' "$(${now})" "$PWD" "\${GIT_TERMINAL_PROMPT-unset}" "\${GIT_ASKPASS-unset}" "\${SSH_ASKPASS-unset}" "\${GIT_SSH_COMMAND-unset}" "\${a# }" >> "${log}"
  if [ -f "${dir}/hang" ]; then sleep 60 </dev/null & c=$!; onterm() { printf '%s term\\n' "$(${now})" >> "${log}"; kill $c 2>/dev/null; exit 1; }; trap onterm TERM; printf '%s hang %s\\n' "$(${now})" "$c" >> "${log}"; wait $c; exit 1; fi
  "${REAL_GIT}" "$@"; s=$?
  printf '%s end %s\\n' "$(${now})" "$s" >> "${log}"
  exit $s
fi
exec "${REAL_GIT}" "$@"
`);
  fs.chmodSync(path.join(dir, 'git'), 0o755);
  const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  const fetches = () => {
    const res = [];
    for (const l of lines()) {
      const m = /^(\d+) (start|end|hang|term) ?(.*)$/.exec(l);
      if (!m) continue;
      if (m[2] === 'start') {
        const [cwd, prompt, askpass, sshAsk, sshCmd, ...argv] = m[3].split('|');
        res.push({ start: Number(m[1]), end: null, status: null, hang: null, term: null, cwd, prompt, askpass, sshAsk, sshCmd, argv: argv.join('|') });
      } else if (res.length) {
        const f = res[res.length - 1];
        if (m[2] === 'hang') f.hang = { at: Number(m[1]), pid: Number(m[3]) }; else if (m[2] === 'term') f.term = Number(m[1]); else { f.end = Number(m[1]); f.status = Number(m[3]); }
      }
    }
    return res;
  };
  return { env: { PATH: `${dir}${path.delimiter}${process.env.PATH}` }, fetches, hang: (on) => (on ? write(path.join(dir, 'hang'), '') : fs.rmSync(path.join(dir, 'hang'), { force: true })) };
}
// alive: the pid answers signal 0 and, where /proc says, isn't a zombie (one exited, its parent gone, not yet reaped)
const alive = (pid) => {
  try { process.kill(pid, 0); } catch { return false; }
  try { return !/^\d+ \(.*\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return true; }
};
// the design's fetch, word for word: its flags before origin, and exactly its two refspecs after
function fetchArgvOk(argv) {
  const words = argv.split(' ');
  const o = words.indexOf('origin');
  const flags = words.slice(0, o);
  for (const f of ['-c', 'gc.auto=0', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--prune', '--refmap=']) if (!flags.includes(f)) return `no ${f}`;
  const specs = words.slice(o + 1);
  return J(specs) === J(['+refs/heads/main:refs/remotes/origin/main', '+refs/heads/*:refs/devteam-remote/*']) ? null : `refspecs ${J(specs)}`;
}

// The other machine: a clone of origin that pushes artifacts to main or a branch.
function otherMachine(F) {
  const dir = path.join(F.base, 'other');
  F.g(['clone', '-q', F.org, dir], F.base);
  for (const [k, v] of [['user.email', 'o@o'], ['user.name', 'o']]) F.g(['config', k, v], dir);
  const g = (args) => F.g(args, dir);
  const put = (slug, files, symlinks = {}) => {
    const folder = path.join(dir, ARTS, slug);
    for (const [rel, text] of Object.entries(files)) { if (text === null) fs.rmSync(path.join(folder, rel), { force: true }); else write(path.join(folder, rel), text); }
    for (const [rel, target] of Object.entries(symlinks)) { fs.mkdirSync(folder, { recursive: true }); fs.symlinkSync(target, path.join(folder, rel)); }
    g(['add', '-A', ARTS]);
  };
  return {
    dir,
    g,
    // a commit on <branch> (from <from>, origin's main by default, when the branch is new) putting files
    // under <slug> (null deletes one), then pushed; its folder's tree id
    push(branch, slug, files, { from = 'origin/main', symlinks = {} } = {}) {
      g(['fetch', '-q', 'origin']);
      const has = (() => { try { g(['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`]); return true; } catch { return false; } })();
      g(['checkout', '-q', '-B', branch, has ? `origin/${branch}` : from]);
      put(slug, files, symlinks);
      g(['commit', '-qm', `${slug} on ${branch}`]);
      g(['push', '-q', '-f', 'origin', `HEAD:refs/heads/${branch}`]);
      return g(['rev-parse', `HEAD:${ARTS}/${slug}`]);
    },
    // a branch with no history in common with main
    orphan(branch, slug, files) {
      g(['checkout', '-q', '--orphan', branch]);
      g(['rm', '-rq', '--cached', '.']);
      for (const e of fs.readdirSync(dir)) if (e !== '.git') fs.rmSync(path.join(dir, e), { recursive: true, force: true });
      put(slug, files);
      g(['commit', '-qm', `${slug} on ${branch}`]);
      g(['push', '-q', '-f', 'origin', `HEAD:refs/heads/${branch}`]);
      g(['checkout', '-q', '-f', 'main']);
    },
    // <branch> landed on main as a squash (one new commit, its tree) or a merge commit, then pushed
    land(branch, how) {
      g(['fetch', '-q', 'origin']);
      g(['checkout', '-q', '-B', 'main', 'origin/main']);
      if (how === 'squash') { g(['merge', '-q', '--squash', `origin/${branch}`]); g(['commit', '-qm', `squash ${branch}`]); } else g(['merge', '-q', '--no-ff', '-m', `merge ${branch}`, `origin/${branch}`]);
      g(['push', '-q', 'origin', 'HEAD:refs/heads/main']);
    },
    del(branch) { g(['push', '-q', 'origin', `:refs/heads/${branch}`]); },
    tipTime(branch) { g(['fetch', '-q', 'origin']); return new Date(g(['log', '-1', '--format=%cI', `origin/${branch}`])).toISOString(); },
  };
}

const getJson = async (B, route) => { const r = await fetch(`${B}${route}`); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }; };
// the page's ask: a same-origin POST, which is the demand (a GET only reads, org-access A13)
const askRemote = (B, headers = {}, body = '{}') => fetch(`${B}/api/artifact-remote`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: B, ...headers }, body });
const remoteStatus = async (B) => (await askRemote(B)).json();
const library = async (B) => { const r = await fetch(`${B}/api/data`); assert.equal(r.status, 200, '/api/data'); return (await r.json()).library.artifacts; };
const row = (arts, slug, at) => arts.find((a) => a.slug === slug && a.at === at) ?? null;
const bytes = async (B, route) => { const r = await fetch(`${B}${route}`); return { status: r.status, text: await r.text() }; };
// until f() is truthy, polling every 250 ms, for at most ms
async function within(ms, f, what) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try { last = await f(); } catch (e) { last = e; }
    if (last && !(last instanceof Error)) return last;
    if (Date.now() > end) assert.fail(`not within ${ms} ms: ${what}${last instanceof Error ? ` (last: ${last.message})` : ''}`);
    await sleep(250);
  }
}
// The Library's ask, as the page makes it while the Library is shown: every 250 ms until stopped.
function demand(B) {
  let on = true;
  (async () => { while (on) { try { await (await askRemote(B)).text(); } catch {} await sleep(250); } })();
  return () => { on = false; };
}
// what must never change: local branches and tags, worktrees, HEAD, the index, the working tree, and
// every remote-tracking ref but origin/main
const snapshot = (F) => ({
  heads: F.g(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/tags'], F.old),
  // a symbolic ref (origin/HEAD, which a newer git's clone makes) by what it names, not the sha it follows
  remotes: F.g(['for-each-ref', '--format=%(refname) %(if)%(symref)%(then)-> %(symref)%(else)%(objectname)%(end)', 'refs/remotes'], F.old).split('\n').filter((l) => l && !l.startsWith('refs/remotes/origin/main ')).join('\n'),
  worktrees: F.g(['worktree', 'list', '--porcelain'], F.old),
  status: F.g(['status', '--porcelain', '--untracked-files=all'], F.old),
  head: F.g(['rev-parse', 'HEAD'], F.old),
  index: F.g(['ls-files', '-s'], F.old),
  dirs: fs.readdirSync(F.old).sort().join(','),
});
const refsIn = (F, ns) => F.g(['for-each-ref', '--format=%(refname) %(objectname)', ns], F.old);
// every directory under root, outside .git, named name
function dirsNamed(root, name) {
  const res = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (!e.isDirectory() || e.name === '.git') continue; const p = path.join(d, e.name); if (e.name === name) res.push(p); walk(p); } };
  walk(root);
  return res;
}

async function setup(t, name, env = {}) {
  const later = cleanup(t);
  const F = fleetFixture(name);
  later(() => F.done());
  const spy = spyGit(F);
  const other = otherMachine(F);
  const start = async (extra = {}) => {
    const e = { ...F.env({}), ...spy.env, DEVTEAM_ARTIFACT_FETCH_MS: String(INT), ...env, ...extra };
    delete e.GIT_SSH_COMMAND;
    for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
    const { dash, port } = await dashboardOnFreePort(F.old, e);
    later(() => dash.stop());
    const B = `http://127.0.0.1:${port}`;
    // BUILD: one full /api/data read, timed; the budgets are derived from it
    const t0 = Date.now();
    await library(B);
    const BUILD = Math.max(1000, Date.now() - t0);
    const int = Number(e.DEVTEAM_ARTIFACT_FETCH_MS) || 30000;
    const L = int + DATA_EVERY_MS + 2 * BUILD + 5000;
    // LW: a change on this machine's disk (a worktree draft) moves no ref, so it waits out a kept
    // /api/data build (reused up to 20 s) rather than a fetch
    const LW = 20000 + DATA_EVERY_MS + 2 * BUILD + 5000;
    return { dash, B, BUILD, L, LW, P: L + 10000, V: int + 10000 + 12000 + 5000, W: WINDOW(int) };
  };
  return { F, spy, other, start, later };
}

export { J, ARTS, sleep, INT, art, alive, fetchArgvOk, getJson, askRemote, remoteStatus, library, row, bytes, within, demand, snapshot, refsIn, dirsNamed, setup };
