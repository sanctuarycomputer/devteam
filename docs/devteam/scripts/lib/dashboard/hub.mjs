/* imports start */
import path from 'node:path';
import { ARTIFACTS_REL } from '../artifacts.mjs';
import { ARTIFACT_FILE_MAX } from '../artifacts.mjs';
import { BRANCH_AT } from '../artifacts.mjs';
import { HUB_PORT } from '../orient.mjs';
import { LINK_ID } from '../links.mjs';
import { WINDOW_MS } from '../accounts.mjs';
import { artifactProblems } from '../artifacts.mjs';
import { execFile } from 'node:child_process';
import { fingerprint } from '../artifacts.mjs';
import { git } from '../base.mjs';
import { imageHub } from '../hub/image.mjs';
import { out } from '../base.mjs';
import { ownKitVersion } from '../hub/health-pool.mjs';
import { redactUrl } from '../links.mjs';
import { slug } from '../base.mjs';
import { spawn } from 'node:child_process';
import { startHub } from '../presence.mjs';
import { timedOut } from '../box-pins.mjs';
import { treeNow } from '../artifacts.mjs';
/* imports end */
// A dashboard's hub, unless the box image runs the machine's hub on this port (DEVTEAM_IMAGE_HUB):
// then it is left to the image. The image relies on this check (IMAGE_RUNS).
export function dashboardHub(log) {
  if (imageHub() === HUB_PORT) { log(`hub: left to the image (DEVTEAM_IMAGE_HUB=${HUB_PORT})`); return null; }
  return startHub(log, { kit: ownKitVersion() });
}
// ----- the Library's fetch of origin (kit-750): drafts and landings from other machines -----
// While a Library or an artifact viewer asks (want()), the dashboard fetches origin once each FETCH_MS:
// main into refs/remotes/origin/<main> (what mainRef reads), every branch into the kit's own
// refs/devteam-remote/* (--refmap= so git writes no other ref, --prune drops a branch deleted there and
// nowhere else). The timer decides when it fires: with no ask in WINDOW_MS it does nothing and arms
// nothing, so a closed Library leaves no fetch and no timer. One fetch at a time, in its own process
// group (no terminal, no prompt: GIT_TERMINAL_PROMPT=0, empty askpass, ssh in BatchMode unless the
// user set an ssh command), SIGTERM at TIMEOUT_MS so git removes its locks, SIGKILL GRACE_MS later.
// A failure waits BACKOFF_MS and is said (stale); a fetch that moved a ref calls onMoved. resolve()
// reads a fetched branch's artifact folder for the server, async, its check kept by tree id.
export function artifactRemoteRefs({ root, main, onMoved = () => {}, env = process.env } = {}) {
  const ms = (k, d) => { const v = Number(env[k]); return env[k] !== undefined && env[k] !== '' && Number.isInteger(v) && v > 0 ? v : d; };
  const FETCH_MS = ms('DEVTEAM_ARTIFACT_FETCH_MS', 30000);
  const BACKOFF_MS = ms('DEVTEAM_ARTIFACT_FETCH_BACKOFF_MS', 300000);
  const TIMEOUT_MS = ms('DEVTEAM_ARTIFACT_FETCH_TIMEOUT_MS', 20000);
  const WINDOW_MS = Math.max(FETCH_MS, 10000) + 5000;
  const GRACE_MS = 2000;
  const GIT_ENV = { ...env, LC_ALL: 'C' };
  // git, async, with its exit code: 0, git's own, or -1 (it never ran, or was killed)
  const run = (args, encoding = 'utf8') => new Promise((resolve) => {
    try {
      execFile('git', args, { cwd: root, env: GIT_ENV, encoding, maxBuffer: 64 * 1024 * 1024 }, (err, out, errOut) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out, err: String(errOut ?? '') }));
    } catch (e) { resolve({ code: -1, out: encoding === 'utf8' ? '' : Buffer.alloc(0), err: String(e?.message ?? e) }); }
  });
  const url = git(['config', '--get', 'remote.origin.url'], root);
  const remote = url !== null;
  // the remote's host, for the page's words: scp form, a URL's; a local path or file:// has none
  const host = (() => {
    const s = String(url ?? '').trim();
    const u = /^([a-z][a-z0-9+.-]*):\/\/(?:[^/\s]*@)?(\[[^\]\s]+\]|[^/:?#\s@]+)/i.exec(s);
    if (u) return u[1].toLowerCase() === 'file' ? null : u[2].toLowerCase();
    const scp = /^(?:[^@/\s]+@)?([^:/\s@]+):(?!\/\/)/.exec(s);
    return scp ? scp[1].toLowerCase() : null;
  })();
  // running: a fetch is under way, from the refs read before it to the one after (child is set only
  // while git runs), so a want() between them never arms a second
  let lastWant = -Infinity, timer = null, child = null, running = false, rev = 0;
  let startedAt = null, endedAt = null, lastOk = null, lastError = null;
  const iso = (t) => (t === null ? null : new Date(t).toISOString());
  const due = () => (endedAt === null ? Date.now() : endedAt + (lastOk ? FETCH_MS : BACKOFF_MS));
  const refsNow = async () => { const r = await run(['for-each-ref', '--format=%(refname) %(objectname)', `refs/remotes/origin/${main}`, 'refs/devteam-remote/']); return r.code === 0 ? r.out : null; };
  const fetchOnce = async () => {
    const before = await refsNow();
    startedAt = Date.now();
    const ssh = env.GIT_SSH_COMMAND || git(['config', '--get', 'core.sshCommand'], root) ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };
    const r = await new Promise((resolve) => {
      let errText = '', done = false, timedOut = false, term = null, kill = null;
      // after a timeout the SIGKILL stays armed: what else in the group ignored SIGTERM goes too
      const finish = (v) => { if (done) return; done = true; clearTimeout(term); if (!timedOut) clearTimeout(kill); child = null; resolve(v); };
      try {
        child = spawn('git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--prune', '--refmap=', 'origin', `+refs/heads/${main}:refs/remotes/origin/${main}`, '+refs/heads/*:refs/devteam-remote/*'], { cwd: root, env: { ...GIT_ENV, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', ...ssh }, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
      } catch (e) { return finish({ ok: false, error: String(e?.message ?? e) }); }
      const pid = child.pid;
      child.stderr.on('data', (d) => { if (errText.length < 4096) errText += d; });
      child.on('error', (e) => finish({ ok: false, error: String(e?.message ?? e) }));
      // the group leader's close is the answer, or the SIGKILL below
      child.on('close', (code) => finish(code === 0 && !timedOut ? { ok: true } : { ok: false, error: timedOut ? `no answer from origin in ${Math.round(TIMEOUT_MS / 1000)} s` : errText.trim().split('\n').filter(Boolean).pop() || `git fetch exited ${code}` }));
      term = setTimeout(() => {
        timedOut = true;
        try { process.kill(-pid, 'SIGTERM'); } catch {}
        kill = setTimeout(() => { try { process.kill(-pid, 0); process.kill(-pid, 'SIGKILL'); } catch {} kill = null; finish({ ok: false, error: `no answer from origin in ${Math.round(TIMEOUT_MS / 1000)} s` }); }, GRACE_MS);
      }, TIMEOUT_MS);
    });
    endedAt = Date.now();
    lastOk = r.ok;
    lastError = r.ok ? null : redactUrl(r.error).replace(/\s+/g, ' ').trim().slice(0, 300) || 'the fetch failed';
    if (r.ok) { const after = await refsNow(); if (after !== before) { rev += 1; try { onMoved(); } catch {} } }
  };
  const arm = () => {
    if (!remote || timer || running) return;
    timer = setTimeout(fire, Math.max(0, due() - Date.now()));
    timer.unref?.();
  };
  function fire() {
    timer = null;
    if (Date.now() - lastWant > WINDOW_MS) return;
    running = true;
    void fetchOnce().catch(() => {}).finally(() => { running = false; arm(); });
  }
  // a fetched branch's artifact folder, for the server: { missing } | { failed } | { tree, fp, error }
  const trees = new Map();
  const checkTree = async (tree, slug) => {
    const ls = await run(['ls-tree', '-r', '-l', '-z', tree]);
    if (ls.code !== 0) return null;
    const entries = ls.out.split('\0').filter(Boolean).map((l) => {
      const tab = l.indexOf('\t');
      const [mode, type, oid, size] = l.slice(0, tab).trim().split(/\s+/);
      return { path: l.slice(tab + 1), mode, type, oid, size: Number(size) || 0, buf: null, read() { return this.buf; } };
    });
    for (const e of entries) {
      if (e.type !== 'blob' || !['artifact.json', 'index.html'].includes(e.path) || e.size > ARTIFACT_FILE_MAX) continue;
      const b = await run(['cat-file', 'blob', e.oid], 'buffer');
      if (b.code !== 0) return null;
      e.buf = b.out;
    }
    const sub = entries.find((e) => e.type !== 'blob');
    const error = !entries.length ? `${slug}: empty` : sub ? `${slug}/${sub.path}: a submodule isn't served` : artifactProblems(slug, entries).errors[0] ?? null;
    return { fp: fingerprint(entries), error };
  };
  async function resolve(branch, slug) {
    if (!BRANCH_AT.test(branch ?? '') || !LINK_ID.test(slug ?? '')) return { missing: true };
    const r = await run(['ls-tree', `refs/devteam-remote/${branch}`, '--', `${ARTIFACTS_REL}/${slug}`]);
    // a ref that isn't there is nothing there; any other failure is a failure
    if (r.code !== 0) return /not a valid object name/i.test(r.err) ? { missing: true } : { failed: true };
    const tree = treeNow(r.out);
    if (!tree) return { missing: true };
    const key = `${slug}\0${tree}`;
    // kept by tree id, which never changes; at most 500, then begun again
    if (!trees.has(key)) { const c = await checkTree(tree, slug); if (!c) return { failed: true }; if (trees.size >= 500) trees.clear(); trees.set(key, c); }
    return { tree, ...trees.get(key) };
  }
  return {
    want() { lastWant = Date.now(); arm(); },
    status() {
      return { remote, host, started_at: iso(startedAt), fetched_at: iso(endedAt), ok: lastOk, stale: lastOk === false, error: lastError, next_at: remote ? iso(Math.max(due(), Date.now())) : null, rev };
    },
    resolve,
    // at exit: a fetch under way gets SIGTERM, so git removes its own locks; it is its own group and
    // ends by itself without us
    stop() { clearTimeout(timer); timer = null; if (child) try { process.kill(-child.pid, 'SIGTERM'); } catch {} },
  };
}
/* cmdDashboard start */
