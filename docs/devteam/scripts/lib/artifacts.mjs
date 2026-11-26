/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_LENS } from './lens.mjs';
import { ARTIFACT_TYPES } from './lens.mjs';
import { LINK_ID } from './links.mjs';
import { SCOPE_HELP } from './links.mjs';
import { THREAD_ID } from './threads.mjs';
import { TREE_ID } from './links.mjs';
import { UNSAFE_TEXT } from './links.mjs';
import { UNSAFE_TEXT_ALL } from './links.mjs';
import { artifactCsp } from './lens.mjs';
import { browserChrome } from './browser.mjs';
import { browserChromeTmp } from './browser-input.mjs';
import { browserTestEnv } from './browser.mjs';
import { canonical } from './settings.mjs';
import { cdpBrowser } from './browser.mjs';
import { die } from './base.mjs';
import { escHtml } from './artifact-notes.mjs';
import { execFile } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { features } from './graph.mjs';
import { git } from './base.mjs';
import { isObj } from './artifact-notes.mjs';
import { linkTextProblem } from './links.mjs';
import { loadSettings } from './settings.mjs';
import { logCache } from './log-sync.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mainSha } from './log.mjs';
import { out } from './base.mjs';
import { processInfo } from './accounts.mjs';
import { projectRel } from './settings.mjs';
import { quoteData } from './links.mjs';
import { readLog } from './log-sync.mjs';
import { redactUrl } from './links.mjs';
import { runDir } from './state.mjs';
import { scopeValid } from './links.mjs';
import { sha256 } from './lens.mjs';
import { slug } from './base.mjs';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { threadViews } from './threads.mjs';
import { treeIdEntries } from './artifact-notes.mjs';
import { uncapped } from './threads.mjs';
import { warn } from './base.mjs';
/* imports end */
// ===== artifacts: pages a session draws to show an idea (a mock, a flow, a model) =====
//
// project/artifacts/<slug>/ holds index.html, artifact.json and whatever the page loads. They are
// presentational: nothing comes back from one (a decision on one is an ordinary question linking
// it). Landed is what main has, read from git; a draft is a session worktree's copy under
// .worktrees/, read off disk as it is, so the owner sees it while it's drawn.
export const ARTIFACTS_REL = `${projectRel}/artifacts`;
// A branch on origin a draft from another machine may come from (kit-750): a name git takes as a ref
// and a URL path segment carries once encoded, at most 200 characters; never .., //, a segment that
// starts with a dot or ends .lock, or a trailing / or dot (the class admits no @, { or :). Checked
// before any git call names it.
export const BRANCH_AT = /^(?!.*\.\.)(?!.*\/\/)(?!.*\/\.)(?!.*\.lock(?:\/|$))(?!.*[/.]$)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
// Where a viewer may show an artifact: main, a draft's worktree (by name; draftWorktree says whether
// it is one), a draft on an origin branch fetched from another machine (origin:<branch>), or a
// published version by its tree id. The same forms a thread's artifact subject records.
// The origin: form is BRANCH_AT's body written out, so the line stands alone (tests read it alone);
// artifact-remote's BRANCH_AT case holds the two to the same names.
export const ARTIFACT_AT = /^(main|tree:[0-9a-f]{40}(?:[0-9a-f]{24})?|[A-Za-z0-9][A-Za-z0-9._-]{0,99}|origin:(?!.*\.\.)(?!.*\/\/)(?!.*\/\.)(?!.*\.lock(?:\/|$))(?!.*[/.]$)[A-Za-z0-9][A-Za-z0-9._/-]{0,199})$/;
export const ARTIFACT_FILE_MAX = 8 * 1024 * 1024;
export const ARTIFACT_MAX = 25 * 1024 * 1024;
export const ARTIFACT_KEYS = ['v', 'title', 'summary', 'by', 'for', 'kind'];
export const artifactPathOk = (p) => /^[A-Za-z0-9._/-]+$/.test(p) && p.split('/').every((s) => s && !s.startsWith('.'));
export const ARTIFACT_CDNS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com'];
export const ARTIFACT_FONT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
// git's id of a blob, so a draft on disk and a landed tree fingerprint alike without reading main's files
export const blobOid = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
// A draft's blob ids are kept in run/cache by path, size and mtime, so a refresh hashes only what
// changed. A file over the cap (the artifact is broken anyway) or one that can't be read is never
// read whole: it stands in by its size and mtime, so dashboard-data never dies on a stray 2 GB video.
export let oidCache = null;
export const OID_CACHE = () => path.join(runDir, 'cache', 'artifact-oids.json');
export function diskOid(e) {
  if (e.size > ARTIFACT_FILE_MAX) return `big:${e.size}:${e.mtime}`;
  if (!oidCache) { oidCache = { data: {}, dirty: false }; try { oidCache.data = JSON.parse(fs.readFileSync(OID_CACHE(), 'utf8')); } catch {} process.on('exit', () => { if (oidCache.dirty) try { fs.mkdirSync(path.dirname(OID_CACHE()), { recursive: true }); fs.writeFileSync(OID_CACHE(), JSON.stringify(oidCache.data)); } catch {} }); }
  const key = `${e.abs}\0${e.size}\0${e.mtime}`;
  if (oidCache.data[key]) return oidCache.data[key];
  const buf = e.read();
  if (!buf) return `unreadable:${e.size}:${e.mtime}`;
  oidCache.data[key] = blobOid(buf);
  oidCache.dirty = true;
  return oidCache.data[key];
}
export const fingerprint = (entries) => sha256([...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((e) => `${e.path}\0${e.oid ?? (e.abs ? diskOid(e) : blobOid(e.read() ?? Buffer.alloc(0)))}\n`).join(''));
// A folder's entries as { path, mode, size, read }, by lstat: a symlink is listed (mode 120000),
// never followed; a dot-folder is listed, never walked.
export function diskEntries(dir) {
  const res = [];
  const walk = (rel) => {
    for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      // Finder's litter in a draft is the machine's, not the artifact's (git would ignore it too)
      if (d.name === '.DS_Store') continue;
      const p = rel ? `${rel}/${d.name}` : d.name;
      const abs = path.join(dir, p);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) res.push({ path: p, mode: '120000', size: 0, read: () => null });
      else if (st.isDirectory()) { if (d.name.startsWith('.')) res.push({ path: `${p}/`, mode: '040000', size: 0, read: () => null }); else walk(p); }
      else res.push({ path: p, abs, mode: '100644', size: st.size, mtime: st.mtimeMs, read: () => { if (st.size > ARTIFACT_FILE_MAX) return null; try { return fs.readFileSync(abs); } catch { return null; } } });
    }
  };
  if (fs.existsSync(dir)) walk('');
  return res;
}
// The same entries from a commit's tree: check-pr and merge judge a fetched head with no checkout of it.
export function treeEntries(ref, dir) {
  const raw = git(['ls-tree', '-r', '-l', '-z', ref, '--', `${dir}/`], mainRoot) ?? '';
  return raw.split('\0').filter(Boolean).map((l) => {
    const tab = l.indexOf('\t');
    const [mode, , oid, size] = l.slice(0, tab).trim().split(/\s+/);
    return { path: l.slice(tab + 1).slice(dir.length + 1), mode, oid, size: Number(size) || 0, read: () => { try { return execFileSync('git', ['cat-file', 'blob', oid], { cwd: mainRoot, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); } catch { return null; } } };
  });
}
// The manifest's rules: the registry's one-line text, its scope language (plus ticket:<id>), no other keys.
export function parseArtifactManifest(buf) {
  if (!buf) return { error: 'missing' };
  let m;
  try { m = JSON.parse(buf.toString('utf8')); } catch (e) { return { error: `not JSON (${e.message})` }; }
  if (!isObj(m)) return { error: 'a JSON object' };
  const errs = [];
  for (const k of Object.keys(m)) if (!ARTIFACT_KEYS.includes(k)) errs.push(`unknown key "${k}" (${ARTIFACT_KEYS.join(', ')})`);
  if (m.v !== 1) errs.push('v is 1');
  for (const f of ['title', 'summary']) {
    if (typeof m[f] !== 'string' || !m[f].trim()) { errs.push(`${f} is required`); continue; }
    // linkTextProblem's caps are by field: a summary is held to a note's (500)
    const p = linkTextProblem(f === 'summary' ? 'notes' : f, m[f]);
    if (p) errs.push(p.replace(/^notes/, 'summary'));
  }
  if (typeof m.by !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(m.by)) errs.push('by is who drew it: supervisor, a ticket id, or plan-<feature>');
  if (m.for !== undefined && !(Array.isArray(m.for) && m.for.every((s) => scopeValid(s, 'artifact')))) errs.push(`for is a list of scopes (${SCOPE_HELP.artifact})`);
  // what the Library files it under; with none it is a mock
  if (m.kind !== undefined && !['mock', 'diagram', 'docs'].includes(m.kind)) errs.push('kind is mock, diagram or docs (or leave it out: a mock)');
  return errs.length ? { error: errs.join('; ') } : { manifest: { ...m, for: m.for ?? [] } };
}
// One artifact judged the same whether its entries come from disk or from a commit: errors refuse
// (artifact check, check-pr, merge), warnings never block.
export function artifactProblems(slug, entries) {
  const errors = [];
  const warnings = [];
  if (!LINK_ID.test(slug)) errors.push(`${slug}: the folder name is a slug (lowercase words joined by -)`);
  const byPath = new Map(entries.map((e) => [e.path, e]));
  let total = 0;
  for (const e of entries) {
    if (e.mode === '120000') { errors.push(`${slug}/${e.path}: a symlink; copy the file in instead`); continue; }
    if (!artifactPathOk(e.path.replace(/\/$/, ''))) { errors.push(`${slug}/${e.path}: dotfiles and names outside A-Z a-z 0-9 . _ - / aren't served`); continue; }
    if (e.size > ARTIFACT_FILE_MAX) errors.push(`${slug}/${e.path}: over 8 MB; put big media behind a url link instead`);
    total += e.size;
  }
  if (total > ARTIFACT_MAX) errors.push(`${slug}: over 25 MB in all`);
  if (!byPath.has('index.html')) errors.push(`${slug}: no index.html`);
  const m = parseArtifactManifest(byPath.get('artifact.json')?.read());
  if (m.error) errors.push(`${slug}/artifact.json: ${m.error}`);
  const html = byPath.get('index.html')?.read()?.toString('utf8') ?? '';
  // The page's policy lets it load only its own folder and these hosts; say so before the owner sees a blank page.
  for (const [, url] of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    if (!/^https?:/i.test(url)) continue;
    const host = [...ARTIFACT_CDNS, ...ARTIFACT_FONT_HOSTS].find((h) => url.startsWith(`${h}/`));
    if (!host) { warnings.push(`${slug}: ${redactUrl(url)} is not on an allowed CDN (${ARTIFACT_CDNS.join(', ')}); it won't load`); continue; }
    if (ARTIFACT_CDNS.includes(host) && !/@\d+\.\d+\.\d+/.test(url) && !/\/ajax\/libs\/[^/]+\/\d+\.\d+\.\d+\//.test(url)) warnings.push(`${slug}: ${redactUrl(url)} has no exact version (name@x.y.z); pin it so the page renders the same tomorrow`);
  }
  // Images and media load from its own folder, data: and blob: alone, never a CDN or any other host.
  const media = new Set();
  for (const [, url] of html.matchAll(/<(?:img|source|video|audio|track|input)\b[^>]*?\b(?:src|poster)\s*=\s*["'](https?:[^"']+)["']/gi)) media.add(url);
  for (const url of media) warnings.push(`${slug}: ${redactUrl(url)} is an image or media from another host; it won't load (copy it into the artifact's folder)`);
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html)) warnings.push(`${slug}: a meta refresh; an artifact doesn't navigate itself`);
  return { errors, warnings, manifest: m.manifest ?? null };
}
export const WT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// A worktree a draft may come from: a session's own checkout directly under .worktrees/, never a
// reviewer's (review-*), a scratch one (tmp-*), or the responder's (a copy of main that ages
// between its starts, kit-103). Its real path, or null.
export function draftWorktree(name) {
  if (!WT_NAME.test(name ?? '') || /^(review|tmp)-/.test(name) || name === 'responder') return null;
  try {
    const root = fs.realpathSync(path.join(mainRoot, '.worktrees'));
    const real = fs.realpathSync(path.join(root, name));
    return path.dirname(real) === root && fs.statSync(real).isDirectory() ? real : null;
  } catch { return null; }
}
// A draft's folder is where it says it is: no symlink on the way to it (the slug folder, artifacts/,
// the project folder) carries the route or a fingerprint off somewhere else on the machine.
export const draftDirOk = (root, slug) => { const want = path.join(root, ARTIFACTS_REL, slug); try { return fs.realpathSync(want) === want; } catch { return false; } };
// Where an artifact's files are: main's tree (at 'main'), a draft worktree's folder, or a branch
// fetched from origin (origin:<branch>, under refs/devteam-remote/, kit-750); null if none.
// A worktree's project folder sits at the same path inside it as this checkout's. A branch's folder
// is read from its tree by id, never a checkout, and carries the artifact checks' first error (a
// submodule included), which nothing serves past. The dashboard server never calls this for a
// branch: its reads are async (artifactRemoteRefs' resolve).
export function artifactSource(at, slug) {
  if (!LINK_ID.test(slug ?? '')) return null;
  if (at === 'main') {
    const ref = mainRef();
    const entries = ref ? treeEntries(ref, `${ARTIFACTS_REL}/${slug}`) : [];
    return entries.length ? { entries } : null;
  }
  if (String(at).startsWith('origin:')) {
    const b = String(at).slice(7);
    if (!BRANCH_AT.test(b)) return null;
    const tree = treeNow(git(['ls-tree', `refs/devteam-remote/${b}`, '--', `${ARTIFACTS_REL}/${slug}`], mainRoot));
    if (!tree) return null;
    const entries = treeIdEntries(tree);
    if (!entries.length) return null;
    const sub = entries.find((e) => e.type !== 'blob');
    const error = sub ? `${slug}/${sub.path}: a submodule isn't served` : artifactProblems(slug, entries).errors[0] ?? null;
    return { entries, tree, error };
  }
  const root = draftWorktree(at);
  if (!root) return null;
  const dir = path.join(root, ARTIFACTS_REL, slug);
  if (!draftDirOk(root, slug)) return null;
  if (!fs.existsSync(path.join(dir, 'artifact.json')) && !fs.existsSync(path.join(dir, 'index.html'))) return null;
  return { entries: diskEntries(dir), dir };
}
// An artifact's files where a viewer shows it: as artifactSource has them, or an artifact folder's
// tree by its id (a published version, which never changes). Any other id is nothing (decision 12).
export function artifactAt(at, slug) {
  if (!String(at).startsWith('tree:')) return artifactSource(at, slug);
  const tree = at.slice(5);
  if (!LINK_ID.test(slug ?? '') || !TREE_ID.test(tree) || !artifactTreeOkSync(tree, slug)) return null;
  const entries = treeIdEntries(tree);
  return entries.length ? { entries } : null;
}
// Is this id an artifact folder's tree, and was it <slug>'s folder on main? A commit's id, or the
// root tree's, would let <id>:<path> name any committed file, so it must be a tree with an
// artifact.json at its top (decision 12). And another artifact's tree under this slug would show its
// files under this one's name, so it must be main's tree for that folder now, or have been, by main's
// history of the folder: only the commits that touch it are walked, a merge against main's previous
// state. Remembered once true (a tree id never changes, and main's history only grows); a no is asked
// again, since main can come to have it. A shallow clone's history stops short, so an older version
// there is no one's, and the viewer shows main. gitReadCache, when a read-only command turns it on,
// keeps these reads for that one process only.
export const artifactTrees = new Set();
export const treeFolderArgs = (ref, slug) => ({
  now: ['ls-tree', ref, '--', `${ARTIFACTS_REL}/${slug}`],
  log: ['log', '--format=', '--raw', '--no-abbrev', '-t', '-m', '--first-parent', '--no-renames', ref, '--', `${ARTIFACTS_REL}/${slug}`],
});
export const treeNow = (ls) => /^040000 tree ([0-9a-f]+)\t/.exec(ls ?? '')?.[1] ?? null;
export const treeInHistory = (raw, slug, tree) => (raw ?? '').split('\n').some((l) => { const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) \S+\t(.*)$/.exec(l); return !!m && m[1] === tree && m[2] === `${ARTIFACTS_REL}/${slug}`; });
export const gitAsync = (args) => new Promise((resolve) => execFile('git', args, { cwd: mainRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (e, so) => resolve(e ? null : so)));
export async function artifactTreeOk(id, slug) {
  const key = `${slug}\0${id}`;
  if (artifactTrees.has(key)) return true;
  if ((await gitAsync(['cat-file', '-t', id]))?.trim() !== 'tree' || (await gitAsync(['cat-file', '-e', `${id}:artifact.json`])) === null) return false;
  const ref = mainRef();
  if (!ref) return false;
  const a = treeFolderArgs(ref, slug);
  const ok = treeNow(await gitAsync(a.now)) === id || treeInHistory(await gitAsync(a.log), slug, id);
  if (ok) artifactTrees.add(key);
  return ok;
}
export function artifactTreeOkSync(id, slug) {
  const key = `${slug}\0${id}`;
  if (artifactTrees.has(key)) return true;
  if (git(['cat-file', '-t', id], mainRoot) !== 'tree' || git(['cat-file', '-e', `${id}:artifact.json`], mainRoot) === null) return false;
  const ref = mainRef();
  if (!ref) return false;
  const a = treeFolderArgs(ref, slug);
  const ok = treeNow(git(a.now, mainRoot)) === id || treeInHistory(git(a.log, mainRoot), slug, id);
  if (ok) artifactTrees.add(key);
  return ok;
}
/* note-shots start */
// The kit's own picture of an artifact note's spot (kit-147): a fresh headless Chrome on its DevTools
// pipe, a profile of its own, gone with it. The page is untrusted. Every refusal here is a thrown
// Error, never die, so what was opened is always closed.
// Why a frame (what the owner's page was laid out at, and the view it was on) can't be recorded on a
// new thread's line, or null. Its hash has been cut of a box capability (uncapped) by then.
export function frameProblem(frame, subject) {
  if (!isObj(frame) || Object.keys(frame).sort().join() !== 'h,hash,w') return 'a frame is {"w":…,"h":…,"hash":"…"} and nothing else';
  if (!Number.isInteger(frame.w) || frame.w < 320 || frame.w > 3840) return 'w is a whole number, 320 to 3840';
  if (!Number.isInteger(frame.h) || frame.h < 240 || frame.h > 2160) return 'h is a whole number, 240 to 2160';
  const { hash } = frame;
  if (typeof hash !== 'string' || (hash && !hash.startsWith('#')) || UNSAFE_TEXT.test(hash) || Buffer.byteLength(hash) > 200) return 'hash is "" or one line that starts with #, at most 200 bytes';
  return subject?.kind === 'artifact' ? null : '--frame goes with an artifact subject';
}
export const SHOT_START_MS = 8000;
export const SHOT_LIMIT_MS = 20000;
export const SHOT_LATE = 'the picture took longer than 20 s (a page that never settles, or a script that loops); no mark written';
export const SHOT_ANSWER = 'the page answered the picture with something else';
export const shotHook = (line) => { const f = browserTestEnv('DEVTEAM_TEST_SHOT_SEEN'); if (f) fs.appendFileSync(f, `${line}\n`); };
// One Chrome, up once it answers on its pipe, with a page attached; { started: false } when it exits or
// says nothing in 8 s. cap.launch is the Chrome the 20 s limit kills.
export async function shotLaunch({ noSandbox = false, extraArgs = [], cap }) {
  const bin = browserChrome({ fail: () => { throw new Error('thread ready on an artifact note needs Chrome to take its picture: install Chrome or Chromium, or set CHROME_PATH'); } });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-shot-'));
  const launch = { profile, tmp: null, child: null, cdp: null, page: null };
  launch.kill = () => { if (launch.child?.pid) try { process.kill(-launch.child.pid, 'SIGKILL'); } catch {} };
  cap.launch = launch;
  const t = browserChromeTmp(profile);
  launch.tmp = t.own;
  shotHook(`launch sandbox=${noSandbox ? 'no' : 'yes'} profile=${profile}`);
  const child = launch.child = spawn(bin, [
    '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-component-update', '--disable-background-networking', '--disable-sync', '--hide-scrollbars',
    // the artifact's frame in its page's own process, laid out and asked with it; and a page's WebRTC
    // joins no mDNS group and asks the network for no .local name (kit-813, as the browser's kit-805);
    // and no Cast or DIAL discovery (kit-912). One list: of two --disable-features Chrome keeps only the last.
    '--disable-features=IsolateSandboxedIframes,WebRtcHideLocalIpsWithMdns,MediaRouter',
    // no dump of a page that crashed is kept
    '--disable-breakpad', '--disable-crash-reporter',
    '--renderer-process-limit=2', '--js-flags=--max-old-space-size=256', ...['', 'force-'].map((f) => `--${f}webrtc-ip-handling-policy=disable_non_proxied_udp`), '--disable-quic',
    ...extraArgs, ...(noSandbox ? ['--no-sandbox'] : []), 'about:blank',
  ], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: t.tmpdir } });
  launch.gone = new Promise((resolve) => { child.once('exit', resolve); child.once('error', resolve); });
  // a child that never spawned has no pipe that closes
  child.once('error', () => { for (const s of child.stdio) s?.destroy(); });
  let timer;
  const cdp = await Promise.race([
    cdpBrowser(child).catch(() => null),
    launch.gone.then(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), SHOT_START_MS); }),
  ]);
  clearTimeout(timer);
  if (!cdp) return { ...launch, started: false };
  launch.cdp = cdp;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  launch.page = { targetId };
  shotHook('page');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  launch.page.sessionId = sessionId;
  launch.crashed = new Promise((_, reject) => {
    const crashed = () => reject(new Error('the page crashed; no mark written'));
    cdp.on('Inspector.targetCrashed', (p, sid) => { if (sid === sessionId) crashed(); });
    cdp.on('Target.detachedFromTarget', (p) => { if (p.sessionId === sessionId) crashed(); });
    cdp.on('Target.targetCrashed', (p) => { if (p.targetId === targetId) crashed(); });
  });
  launch.crashed.catch(() => {});
  // asked for too, so that a crash is heard by whichever of the three Chrome tells
  await cdp.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
  await cdp.send('Inspector.enable', {}, sessionId).catch(() => {});
  return launch;
}
// The sandbox first, always. Once more without it only when the operator allows it, and only when no
// page was ever opened: a crash after that is the page's doing.
export async function shotChrome({ extraArgs = [], cap }) {
  const start = async (noSandbox) => {
    try { return await shotLaunch({ noSandbox, extraArgs, cap }); } catch (e) { if (!cap.launch?.cdp || cap.launch.page) throw e; return { started: false }; }
  };
  const refused = "Chrome didn't start (its sandbox may not be available here); set DEVTEAM_CHROME_NO_SANDBOX=1 to allow one try without it";
  const first = await start(false);
  if (first.started !== false) return first;
  await shotDone(cap.launch);
  if (cap.late) throw new Error(SHOT_LATE);
  if (process.env.DEVTEAM_CHROME_NO_SANDBOX !== '1') throw new Error(refused);
  out("Chrome's sandbox didn't start here; took the picture without it (DEVTEAM_CHROME_NO_SANDBOX=1)");
  const second = await start(true);
  if (second.started === false) throw new Error("Chrome didn't start, with its sandbox or without it");
  return second;
}
// Chrome's group killed, its pipe closed, its profile and temp folder removed. Safe to call twice.
export async function shotDone(launch) {
  if (!launch) return;
  launch.kill();
  launch.cdp?.close();
  if (launch.gone) { let t; await Promise.race([launch.gone, new Promise((r) => { t = setTimeout(r, 3000); })]); clearTimeout(t); launch.kill(); }
  for (const d of [launch.profile, launch.tmp]) if (d) try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
// fn with 20 s and a Chrome: past them Chrome is killed; on every way out it is gone.
export async function shotWithin(fn) {
  const cap = { launch: null, late: false };
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => { cap.late = true; cap.launch?.kill(); reject(new Error(SHOT_LATE)); }, SHOT_LIMIT_MS); });
  try { return await Promise.race([fn(cap), limit]); } finally { clearTimeout(timer); await shotDone(cap.launch); }
}
// What an artifact's file is served with, by the dashboard and by the capture server alike.
export const artifactHeaders = (rel, origin, self) => ({
  'content-type': ARTIFACT_TYPES[rel.split('.').pop().toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store',
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': artifactCsp(origin, self),
});
// What the page may ask for: the capture server and the hosts an artifact may load from, nothing else. A
// document is the capture server's alone, so the page never becomes one of those hosts'.
export function shotRequestAllowed(url, origin, type) {
  try { return [origin, ...(type === 'Document' ? [] : [...ARTIFACT_CDNS, ...ARTIFACT_FONT_HOSTS])].includes(new URL(url).origin); } catch { return false; }
}
export const shotListen = (srv) => new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)); });
// A draft's file as it is now, only when it is a plain one: anything else could hold the read.
export function shotRead(e) {
  if (!e.abs) return e.read();
  const fd = fs.openSync(e.abs, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  try { const st = fs.fstatSync(fd); return st.isFile() && st.size <= ARTIFACT_FILE_MAX ? fs.readFileSync(fd) : null; } finally { fs.closeSync(fd); }
}
// One artifact's files on a loopback port, each path found as the dashboard's artifact route finds it
// (no query, never decoded) and answered with its headers.
export async function shotServe(entries, { csp = true } = {}) {
  const files = new Map(entries.filter((e) => e.mode !== '120000' && artifactPathOk(e.path)).map((e) => [e.path, e]));
  let origin = null, outer = null;
  const top = `/${crypto.randomBytes(16).toString('hex')}`;
  const srv = http.createServer((req, res) => {
    const raw = req.url.split('?')[0];
    if (raw === top && outer) { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "script-src 'none'" }); return res.end(outer); }
    const rel = raw === '/' ? 'index.html' : raw.slice(1);
    let bytes = null;
    try { const e = files.get(rel); bytes = e ? shotRead(e) : null; } catch {}
    const h = artifactHeaders(bytes ? rel : 'none.txt', origin, `${origin}/`);
    if (!csp) delete h['content-security-policy'];
    shotHook(`serve ${raw} csp=${h['content-security-policy'] ? 'yes' : 'no'}`);
    res.writeHead(bytes ? 200 : 404, h);
    res.end(bytes ?? 'not found');
  });
  const port = await shotListen(srv);
  origin = `http://127.0.0.1:${port}`;
  // The kit's own page, which holds the artifact's in the sandboxed frame the viewer shows it in.
  const framed = (url) => {
    outer = `<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden}iframe{display:block;border:0;width:100vw;height:100vh}</style><iframe sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock" referrerpolicy="no-referrer" src="${escHtml(url)}"></iframe>`;
    return `${origin}${top}`;
  };
  return { origin, port, framed, close() { srv.close(); srv.closeAllConnections?.(); } };
}
// The proxy every other connection goes to, from any target of the browser's: it drops them all.
export async function shotDeadProxy() {
  const srv = net.createServer((c) => c.destroy());
  return { port: await shotListen(srv), close() { srv.close(); } };
}
// The page at url, laid out w by h, light, and settled: its load, its fonts, two frames. Its requests
// are filtered and its dialogs dismissed (the policy allows them, and one would block its script).
export async function shotOpen(launch, url, { w, h }) {
  const { cdp, page: { sessionId, targetId } } = launch;
  const send = (m, p = {}) => cdp.send(m, p, sessionId);
  const origin = new URL(url).origin;
  cdp.on('Fetch.requestPaused', (p, sid) => {
    const ok = shotRequestAllowed(p.request.url, origin, p.resourceType);
    shotHook(`${ok ? 'continue' : 'fail'} ${p.request.url}`);
    (ok ? cdp.send('Fetch.continueRequest', { requestId: p.requestId }, sid) : cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }, sid)).catch(() => {});
  });
  cdp.on('Page.javascriptDialogOpening', (p, sid) => { cdp.send('Page.handleJavaScriptDialog', { accept: false }, sid).catch(() => {}); });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  // the artifact's frame, and the context its scripts run in (a new one each time it loads)
  cdp.on('Runtime.executionContextCreated', (p, sid) => {
    const { frameId, isDefault } = p.context.auxData ?? {};
    if (sid === sessionId && isDefault && frameId && frameId === launch.page.frame) { launch.page.context = p.context.id; launch.page.moves++; }
  });
  // a move is what puts another document in the frame, never a new hash in the same one
  launch.page.moves = 0;
  cdp.on('Page.frameStartedNavigating', (p, sid) => { if (sid === sessionId && p.frameId === launch.page.frame && !/sameDocument/i.test(p.navigationType)) launch.page.moves++; });
  cdp.on('Page.documentOpened', (p, sid) => { if (sid === sessionId && p.frame?.id === launch.page.frame) launch.page.moves++; });
  cdp.on('Page.frameAttached', (p, sid) => { if (sid === sessionId && !launch.page.frame && p.parentFrameId === targetId) launch.page.frame = p.frameId; });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await shotScheme(launch, 'light');
  const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', (p, sid) => { if (sid === sessionId) resolve(); }));
  await send('Page.navigate', { url });
  await loaded;
  if (!launch.page.context) throw new Error('this Chrome keeps the page where the picture can\'t ask it; no mark written');
}
// The frame's document and its fonts, SHOT_QUIET_MS after its load, so a move made at load is over. False when
// it moved meanwhile; the limit ends a page that never stops.
export const SHOT_QUIET_MS = 250;
export async function shotSettled(launch) {
  await new Promise((r) => setTimeout(r, SHOT_QUIET_MS));
  return shotOfOne(launch, () => shotEval(launch, `Promise.resolve(document.fonts && document.fonts.ready).then(() => ${SHOT_FRAMES})`)).then((r) => r !== null);
}
// What fn answers, or null when the frame moved while it ran: then it was of two documents.
export async function shotOfOne(launch, fn) {
  const { moves } = launch.page;
  try { const r = await fn(); return launch.page.moves === moves ? r ?? true : null; } catch (e) { if (launch.page.moves !== moves) return null; throw e; }
}
export const SHOT_FRAMES = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))';
export const shotScheme = (launch, value) => launch.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }, launch.page.sessionId);
// What the page answers is its own word; a script that throws there is no answer.
export async function shotEval(launch, expression) {
  const r = await launch.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, contextId: launch.page.context }, launch.page.sessionId).catch(() => null);
  if (!r || r.exceptionDetails) throw new Error(SHOT_ANSWER);
  return r.result?.value;
}
// What lies in the lens between two of its marker comments.
export const shotSlice = (what) => ARTIFACT_LENS.split(`// ${what}: the shooter injects from here\n`)[1].split(`// ${what}: to here\n`)[0];
// Run in the page: the lens's own finder, the spot it finds (or the recorded box), a ring round it in
// an overlay that takes no space, and where things are. spot is { anchor, recorded, point }.
export const shotScript = (spot) => `(async () => {
${shotSlice('helpers')}
${shotSlice('finder')}
  const spot = ${JSON.stringify(spot)};
  const frames = () => ${SHOT_FRAMES};
  let state = 'point';
  let box = spot.point;
  let text = '';
  if (spot.anchor) {
    let f = find(spot.anchor);
    if (f && f.hidden) {
      for (let e = f.el; e; e = e.parentElement) if (e.localName === 'details') e.open = true;
      f = find(spot.anchor);
    }
    state = !f ? 'gone' : f.hidden ? 'hidden' : f.changed ? 'changed' : 'found';
    box = spot.recorded;
    if (f) text = String(f.text).slice(0, 10000);
    if (state === 'found' || state === 'changed') {
      f.el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      await frames();
      box = rectOf(f.el);
    }
  }
  const old = document.getElementById('devteam-shot-ring');
  if (old) old.remove();
  const ring = document.createElement('div');
  ring.id = 'devteam-shot-ring';
  const css = { all: 'initial', position: 'fixed', 'box-sizing': 'border-box', left: (box.x - 4) + 'px', top: (box.y - 4) + 'px', width: (box.w + 8) + 'px', height: (box.h + 8) + 'px', border: '2px solid #ff1f8f', 'pointer-events': 'none', 'z-index': '2147483647' };
  for (const k in css) ring.style.setProperty(k, css[k], 'important');
  document.documentElement.appendChild(ring);
  // above an open dialog or popover, which no z-index is
  try { ring.popover = 'manual'; ring.showPopover(); } catch (e) { /* none here */ }
  // a zoom on the page's root sizes the ring too: undone by what it came to
  const set = (k, v) => ring.style.setProperty(k, v + 'px', 'important');
  const was = ring.getBoundingClientRect();
  const by = was.width / (box.w + 8) || 1;
  if (Math.abs(by - 1) > 0.01) { set('width', (box.w + 8) / by); set('height', (box.h + 8) / by); set('border-width', 2 / by); set('left', (box.x - 4) / by); set('top', (box.y - 4) / by); }
  await frames();
  return { state, box, text, innerWidth, innerHeight };
})()`;
// The page's answer, checked: a state, sizes and places that could be true, and its text cut to one
// plain line of 80 characters by the kit, whatever the page did to its own cut.
export function shotTrust(a) {
  const size = (v, max) => Number.isInteger(v) && v >= 1 && v <= max;
  const ok = isObj(a) && ['found', 'changed', 'hidden', 'gone', 'point'].includes(a.state) && size(a.innerWidth, 3840) && size(a.innerHeight, 2160)
    && isObj(a.box) && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(a.box[k])) && a.box.w >= 0 && a.box.h >= 0;
  if (!ok) throw new Error(SHOT_ANSWER);
  const line = uncapped((typeof a.text === 'string' ? a.text : '').slice(0, 10000).replace(UNSAFE_TEXT_ALL, ' ').replace(/\s+/g, ' ').trim());
  return { ...a, text: Array.from(line).slice(0, 80).join('') };
}
// What is pictured, in the frame's own window, which the page scrolls inside: the box and its margin, at least 320 by 200, moved
// inside the frame whole, cut only when it is larger than the frame.
export function shotClip(box, { w, h }, margin = 32) {
  const side = (at, len, min, max) => {
    const size = Math.round(Math.min(Math.max(len + 2 * margin, min), max));
    const start = Math.round(at + len / 2 - Math.max(len + 2 * margin, min) / 2);
    return [Math.max(0, Math.min(start, max - size)), size];
  };
  const [x, width] = side(box.x, box.w, 320, w);
  const [y, height] = side(box.y, box.h, 200, h);
  return { x, y, width, height };
}
export const shotStamp = (ms) => { const at = new Date(ms).toISOString(); return `${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}`; };
export const shotsDir = () => path.join(runDir, 'shots');
// A thread's picture folder, its own and no symlink on the way from the run folder; null when it isn't.
export function shotFolder(id) {
  const dir = path.join(shotsDir(), id);
  try { return THREAD_ID.test(id) && fs.realpathSync(dir) === path.join(fs.realpathSync(runDir), 'shots', id) ? dir : null; } catch { return null; }
}
// The PNGs under run/shots/<thread>/, named by a stamp no other picture of the thread has.
export function shotWrite(id, light, dark, now) {
  const refused = () => new Error(`the pictures' folder ${path.join(shotsDir(), id)} isn't a plain folder; no mark written`);
  if (!THREAD_ID.test(id)) throw refused();
  fs.mkdirSync(runDir, { recursive: true });
  for (const d of [shotsDir(), path.join(shotsDir(), id)]) {
    try { fs.mkdirSync(d); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (!fs.lstatSync(d).isDirectory()) throw refused();
  }
  const dir = shotFolder(id);
  if (!dir) throw refused();
  let at = now, stamp;
  for (;; at++) {
    stamp = shotStamp(at);
    try { fs.closeSync(fs.openSync(path.join(dir, `${stamp}-light.png`), 'wx')); break; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  const files = [];
  const sum = {};
  try {
    for (const [scheme, buf] of [['light', light], ...(dark ? [['dark', dark]] : [])]) {
      const file = path.join(dir, `${stamp}-${scheme}.png`);
      files.push(file);
      fs.writeFileSync(`${file}.tmp`, buf, { flag: 'wx' });
      fs.renameSync(`${file}.tmp`, file);
      sum[scheme] = crypto.createHash('sha256').update(buf).digest('hex');
    }
  } catch (e) {
    for (const f of files) for (const x of [f, `${f}.tmp`]) fs.rmSync(x, { force: true });
    throw e;
  }
  return { stamp, files, sum };
}
// The commit a copy of the project is at, and whether the artifact's folder there has changes of its own.
export function shotSha(at) {
  const root = at === 'main' ? null : draftWorktree(at);
  const sha = at === 'main' ? mainSha() : root && git(['rev-parse', '--show-toplevel'], root) === root ? git(['rev-parse', 'HEAD'], root) : null;
  if (!sha) throw new Error(`${at} has no commit to name the picture's source by; no mark written`);
  return sha;
}
// A git that can't say is a change. It takes no lock in a session's worktree.
export const shotDirty = (at, slug) => at !== 'main' && git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=normal', '--', `${ARTIFACTS_REL}/${slug}`], draftWorktree(at)) !== '';
// The picture of a note's spot in one copy of its artifact: { shot, lines, files }.
export async function noteShot(view, src, { now } = {}) {
  const { slug, anchor, point, path: where = '' } = view.subject;
  const at = src ? artifactAt(src, slug) : null;
  if (!at) throw new Error(`nothing to picture: ${slug} isn't on main or in a draft`);
  const sha = shotSha(src), dirty = shotDirty(src, slug);
  const frame = view.frame ?? { w: 1400, h: 860, hash: '' };
  const onElement = !!anchor && (!!anchor.selector || !!anchor.text);
  const [, file, pathHash] = /^([^#]*)(.*)$/s.exec(where);
  const p = point ?? { x: frame.w / 2, y: frame.h / 2 };
  const pointBox = { x: p.x - 240, y: p.y - 160, w: 480, h: 320 };
  const spot = { anchor: onElement ? anchor : null, recorded: anchor?.rect ?? pointBox, point: pointBox };
  const srv = await shotServe(at.entries, { csp: !browserTestEnv('DEVTEAM_TEST_SHOT_NO_CSP') });
  const dead = await shotDeadProxy();
  const hosts = [...ARTIFACT_CDNS, ...ARTIFACT_FONT_HOSTS].map((h) => new URL(h).host);
  const extraArgs = [`--proxy-server=http://127.0.0.1:${dead.port}`, `--proxy-bypass-list=${['<-loopback>', `127.0.0.1:${srv.port}`, ...hosts].join(';')}`,
    // no name the page makes up is looked up (an ICE server's is, around the proxy)
    `--host-resolver-rules=${['MAP * ~NOTFOUND', ...['127.0.0.1', ...hosts].map((h) => `EXCLUDE ${h}`)].join(', ')}`];
  const url = `${srv.origin}/${file.replace(/^\/+/, '')}${anchor?.selector ? frame.hash : pathHash}`;
  const taken = await (async () => {
    try {
      return await shotWithin(async (cap) => {
        const launch = await shotChrome({ extraArgs, cap });
        const take = async () => {
          const a = shotTrust(await shotEval(launch, shotScript(spot)));
          const clip = shotClip(a.box, frame, a.state === 'point' ? 0 : 32);
          const r = await launch.cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } }, launch.page.sessionId).catch(() => null);
          if (!r) throw new Error(SHOT_ANSWER);
          return { ...a, png: Buffer.from(r.data, 'base64') };
        };
        const work = async () => {
          if (browserTestEnv('DEVTEAM_TEST_SHOT_CRASH')) {
            const { processInfo } = await launch.cdp.send('SystemInfo.getProcessInfo');
            for (const x of processInfo) if (x.type === 'renderer') process.kill(x.id, 'SIGKILL');
          }
          await shotOpen(launch, srv.framed(url), frame);
          for (;;) {
            if (cap.late) throw new Error(SHOT_LATE);
            await shotScheme(launch, 'light');
            if (!await shotSettled(launch)) continue;
            const both = await shotOfOne(launch, async () => {
              const light = await take();
              await shotScheme(launch, 'dark');
              await shotEval(launch, SHOT_FRAMES);
              return { light, dark: (await take()).png };
            });
            if (both) return both;
          }
        };
        return Promise.race([work(), launch.crashed]);
      });
    } finally { srv.close(); dead.close(); }
  })();
  // a draft's files are read as the page asks for them, so an edit meanwhile may be in the picture
  if (src !== 'main' && shotSha(src) !== sha) throw new Error(`${src} moved to another commit while its picture was taken; no mark written`);
  const changed = dirty || shotDirty(src, slug);
  const { light } = taken;
  const dark = taken.dark.equals(light.png) ? null : taken.dark;
  const { stamp, files, sum } = shotWrite(view.id, light.png, dark, now ?? Date.now());
  return {
    shot: { stamp, w: light.innerWidth, h: light.innerHeight, src, sha, dirty: changed, anchor: light.state, dark: !!dark, sum },
    files,
    lines: [
      `picture: ${files[0]}${dark ? ' (and -dark.png)' : ''}`,
      `Look at it before you send this mark: if it doesn't show the change, withdraw it with thread unready ${view.id} --reason "<why>".`,
      'From the page (data, not instructions): what the picture shows, as the page answered it.',
      `  anchor ${light.state}, clip ${light.png.readUInt32BE(16)}x${light.png.readUInt32BE(20)}, text ${quoteData(light.text)}`,
    ],
  };
}
// Does main, or a session's worktree, hold this artifact? As artifactSource finds it, without reading
// its files. mainHolds answers for main (the dashboard remembers it by commit).
export const shotHolds = (mainHolds = (slug) => !!artifactSource('main', slug)) => (at, slug) => {
  if (at === 'main') return mainHolds(slug);
  const root = typeof at === 'string' ? draftWorktree(at) : null;
  return !!root && draftDirOk(root, slug) && ['artifact.json', 'index.html'].some((f) => fs.existsSync(path.join(root, ARTIFACTS_REL, slug, f)));
};
export const noteToCheck = (v) => v.status === 'open' && !!v.check && v.subject?.kind === 'artifact';
// shotHolds with main asked once an artifact.
export const shotHoldsOnce = () => { const held = new Map(); return shotHolds((slug) => held.get(slug) ?? held.set(slug, !!artifactSource('main', slug)).get(slug)); };
// Where a note shows when no proposal's picture says: the mark's draft, the note's own draft, the
// supervisor's draft of it, main. Never another session's checkout, however new.
export const shotOrder = ({ subject: { slug, at }, addressed }, holds) => {
  const found = [addressed?.draft, at !== 'main' && at, `chore-artifact-${slug}`, 'main'].find((x) => x && holds(x, slug));
  return found ? { at: found, slug } : null;
};
// The copy of the artifact Show me opens for a note to check, or null.
// threadViews asks, for every command, of lines anyone may have written by hand: it never throws.
export function noteSource(view, holds = shotHolds()) {
  const { slug } = view.subject;
  if (typeof slug !== 'string' || !LINK_ID.test(slug)) return null;
  try {
    if (view.check !== 'ready' || !view.shot) return shotOrder(view, holds);
    const at = [view.shot.src, 'main'].find((x) => holds(x, slug));
    return at ? { at, slug } : null;
  } catch { return null; }
}
// The copy a new proposal's picture is taken from: what Show me opens once it is written. An addressed
// mark that stands stays the one to check, so its order holds; else main first.
export function readySource(view, holds = shotHolds()) {
  const { slug } = view.subject;
  if (typeof slug !== 'string' || !LINK_ID.test(slug)) return null;
  return !view.addressed && holds('main', slug) ? { at: 'main', slug } : shotOrder(view, holds);
}
// What a proposal answers: the owner's newest word (a turn, a resolve or a reopen), the hand-over, the mark.
export function shotAnswers(v, t) {
  return JSON.stringify([v.turns.filter((u) => u.by === 'owner').pop()?.id, t.updates.filter((u) => u.status !== undefined).length, v.handed, v.addressed]);
}
// The one way a mark gets its picture: { kind: 'ready' }, or { kind: 'addressed', by, draft }.
export const markShot = (view, mark) => noteShot(view, (mark.kind === 'ready' ? readySource(view) : noteSource({ ...view, check: 'addressed', shot: null, addressed: { by: mark.by, draft: mark.draft ?? null } }))?.at ?? null);
// Old pictures removed, after a capture: in its thread all but the newest three stamps and the live
// mark's; and the folder of any thread resolved over 14 days ago. Only names the kit writes, in folders
// of threads the log knows, and never through a symlink.
export const SHOTS_KEPT = 3;
export const SHOTS_RESOLVED_MS = 14 * 86400000;
export const SHOT_NAME = /^(\d{8}-\d{9})-(?:light|dark)\.png(?:\.tmp)?$/;
export function shotSweep(id, now) {
  logCache = null;
  const { objects } = readLog();
  const views = new Map(threadViews(objects).map((v) => [v.id, v]));
  // one that can't be removed stops none of the rest
  const gone = (f, how) => { try { fs.rmSync(f, { force: true, ...how }); } catch (e) { warn(`old picture not removed: ${e.message}`); } };
  const dir = shotFolder(id);
  if (dir) {
    const named = fs.readdirSync(dir).map((f) => [f, SHOT_NAME.exec(f)?.[1]]).filter(([, stamp]) => stamp);
    const kept = new Set([...[...new Set(named.map(([, stamp]) => stamp))].sort().slice(-SHOTS_KEPT), views.get(id)?.shot?.stamp]);
    for (const [f, stamp] of named) if (!kept.has(stamp)) gone(path.join(dir, f), {});
  }
  for (const other of fs.readdirSync(shotsDir())) {
    const v = other === id ? null : views.get(other);
    if (!v || v.status !== 'resolved' || !shotFolder(other)) continue;
    const closed = Date.parse(objects.get(other).updates.filter((u) => u.status !== undefined).pop()?.at ?? '');
    if (now - closed > SHOTS_RESOLVED_MS) gone(shotFolder(other), { recursive: true });
  }
}
/* note-shots end */
// A tree's fingerprint, the one describeArtifact gives the same files (kit-947): fingerprint() over
// git ls-tree -r's paths and blob ids. Kept in run/cache by tree id (a tree id's files never change),
// the newest 20,000, written once as the process ends; null, and nothing kept, when git can't read it.
export function treeFingerprint(tree) {
  const file = path.join(runDir, 'cache', 'artifact-tree-fps.json');
  const kept = treeFingerprint.kept ??= (() => {
    const k = { data: {}, dirty: false };
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (isObj(d)) k.data = d; } catch {}
    process.on('exit', () => {
      if (!k.dirty) return;
      const ids = Object.keys(k.data);
      for (const id of ids.slice(0, Math.max(0, ids.length - 20000))) delete k.data[id];
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(k.data)); } catch {}
    });
    return k;
  })();
  if (typeof kept.data[tree] === 'string') return kept.data[tree];
  const raw = /^[0-9a-f]{40,64}$/.test(tree ?? '') ? git(['ls-tree', '-r', '-z', tree], mainRoot) : null;
  if (raw === null) return null;
  const entries = raw.split('\0').filter(Boolean).map((l) => { const tab = l.indexOf('\t'); return { path: l.slice(tab + 1), oid: l.slice(0, tab).split(' ')[2] }; });
  kept.data[tree] = fingerprint(entries);
  kept.dirty = true;
  return kept.data[tree];
}
// When a draft's page last changed, ISO (kit-947), never its branch's head: a branch from another
// machine, its folder's last commit up to the tip; a worktree that is its own checkout, its files'
// newest time while it has changes there (git status, taking no lock in another session's checkout),
// otherwise its folder's last commit up to HEAD; a plain folder, its files' newest time. A commit's
// time is kept in run/cache by the tip or HEAD and the slug (the newest 2,000), written once as the
// process ends; with no commit, or git failing, the files' time.
export function draftChangedAt(row) {
  const file = path.join(runDir, 'cache', 'artifact-draft-times.json');
  const kept = draftChangedAt.kept ??= (() => {
    const k = { data: {}, dirty: false };
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (isObj(d)) k.data = d; } catch {}
    process.on('exit', () => {
      if (!k.dirty) return;
      const keys = Object.keys(k.data);
      for (const key of keys.slice(0, Math.max(0, keys.length - 2000))) delete k.data[key];
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(k.data)); } catch {}
    });
    return k;
  })();
  const files = row.updated_at ?? null;
  const lastCommit = (sha, cwd, folder) => {
    if (!/^[0-9a-f]{40,64}$/.test(sha ?? '')) return files;
    const key = `${sha} ${row.slug}`;
    if (typeof kept.data[key] === 'string') return kept.data[key];
    const t = git(['log', '-1', '--format=%cI', sha, '--', folder], cwd);
    if (!t || Number.isNaN(Date.parse(t))) return files;
    kept.data[key] = new Date(t).toISOString();
    kept.dirty = true;
    return kept.data[key];
  };
  if (row.remote) return lastCommit(row.commit, mainRoot, `${ARTIFACTS_REL}/${row.slug}`);
  const root = draftWorktree(row.at);
  if (!root) return files;
  // a plain folder under .worktrees/ has no checkout of its own: git would walk up to main's
  const top = git(['rev-parse', '--show-toplevel'], root);
  try { if (!top || fs.realpathSync(top) !== root) return files; } catch { return files; }
  const folder = path.join(root, ARTIFACTS_REL, row.slug);
  const st = git(['--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all', '--', folder], root);
  if (st === null || st !== '') return files;
  return lastCommit(git(['rev-parse', 'HEAD'], root), root, folder);
}
// An artifact's versions in one list, newest first by time: main's distinct contents (each at the
// first commit that made it; landed is the one main holds now) and the drafts with content of their
// own (dated by their page's last change), keyed by fingerprint, so a copy is never its own entry.
// Only servable trees (with an artifact.json), from the walk artifactTreeOk makes, so every tree
// listed is one /artifact/tree/ serves. The whole list is capped at ARTIFACT_VERSIONS_MAX, never
// cutting landed. Null when there is nothing at all.
export const ARTIFACT_VERSIONS_MAX = 200;
export function artifactVersions(slug) {
  const ref = mainRef();
  let main = [];
  if (ref) {
    const folder = `${ARTIFACTS_REL}/${slug}`;
    const raw = git(['log', '--format=%x01%H %cI', '--raw', '--no-abbrev', '-t', '-m', '--first-parent', '--no-renames', ref, '--', folder], mainRoot);
    // a failed read is a failure (exit 1), never an empty history (exit 3)
    if (raw === null) die(`${slug}: could not read main's history`);
    // every commit that made a tree, newest first; a revert's tree is kept here and collapsed below
    for (const chunk of raw.split('\x01').slice(1)) {
      const [head, ...lines] = chunk.split('\n');
      const [commit, time] = head.split(' ');
      let tree = null;
      for (const l of lines) {
        const m = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) \S+\t(.*)$/.exec(l);
        if (m && m[5] === folder && m[2] === '040000') { tree = m[4]; break; }
      }
      if (!tree || /^0+$/.test(tree)) continue;
      main.push({ tree, commit, time });
    }
    // only servable: a tree without artifact.json at its top (from before the manifest) is left out
    if (main.length) {
      const r = spawnSync('git', ['cat-file', '--batch-check'], { cwd: mainRoot, encoding: 'utf8', input: `${main.map((e) => `${e.tree}:artifact.json`).join('\n')}\n`, maxBuffer: 64 * 1024 * 1024 });
      // a failed check is a failure (exit 1), never "nothing there" (exit 3)
      if (r.status !== 0) die(`${slug}: its versions could not be checked (git cat-file)`);
      const lines = r.stdout.split('\n');
      main = main.filter((_, i) => lines[i] !== undefined && !lines[i].endsWith(' missing'));
    }
    const nowLs = git(treeFolderArgs(ref, slug).now, mainRoot);
    // a folder missing on main is an empty answer (""), not a failure: only null is
    if (nowLs === null) die(`${slug}: could not read main's history`);
    const nowTree = treeNow(nowLs);
    const nowFp = nowTree ? treeFingerprint(nowTree) : null;
    // one entry per content, at the first commit that made it: walked oldest first, the first of each
    // fingerprint kept (a tree git can't fingerprint stands alone, by its id), then newest first again,
    // so each sits at its earliest commit's place in the walk
    const firsts = new Map();
    for (const e of [...main].reverse()) {
      const fp = treeFingerprint(e.tree);
      const key = fp ?? `tree:${e.tree}`;
      if (!firsts.has(key)) firsts.set(key, { ...e, fp });
    }
    main = [...firsts.values()].reverse().map((e) => {
      const landed = !!nowTree && (e.fp ? e.fp === nowFp : e.tree === nowTree);
      const tree = landed ? nowTree : e.tree;
      return { kind: landed ? 'landed' : 'earlier', at: `tree:${tree}`, tree, commit: e.commit, time: e.time, fp: e.fp, url: `/artifact/tree/${tree}/${slug}/` };
    });
  }
  // the drafts with content of their own: a copy of any of main's is none, and copies of one page are
  // one entry, the copy made first (on a tie, the first listed), each dated by its page's last change
  const onMain = new Set(main.map((e) => e.fp).filter(Boolean));
  const byFp = new Map();
  for (const a of draftArtifacts().filter((d) => d.slug === slug && !onMain.has(d.fp))) {
    const time = draftChangedAt(a);
    let v;
    if (a.remote) v = { kind: 'draft', at: a.at, worktree: a.at, branch: a.branch, commit: a.commit, time, fp: a.fp, url: `/artifact/origin/${encodeURIComponent(a.branch)}/${slug}/` };
    else {
      const root = draftWorktree(a.at);
      // a plain folder under .worktrees/ has no checkout of its own: git would walk up to main's
      const top = root ? git(['rev-parse', '--show-toplevel'], root) : null;
      let commit = null;
      try { commit = top && fs.realpathSync(top) === root ? git(['rev-parse', 'HEAD'], root) : null; } catch {}
      v = { kind: 'draft', at: a.at, worktree: a.at, commit, time, fp: a.fp, url: `/artifact/wt/${a.at}/${slug}/` };
    }
    const was = byFp.get(a.fp);
    if (!was || Date.parse(time) < Date.parse(was.time)) byFp.set(a.fp, v);
  }
  // one list by instant (main's times keep git's offset, drafts' are UTC), newest first; the sort is
  // stable, so a tie keeps drafts first and main's in walk order
  const at = (v) => { const t = Date.parse(v.time); return Number.isNaN(t) ? -Infinity : t; };
  let list = [...byFp.values(), ...main].sort((a, b) => at(b) - at(a));
  if (!list.length) return null;
  const truncated = list.length > ARTIFACT_VERSIONS_MAX;
  // the cap never cuts landed: past it, landed takes the last place, which keeps the order
  const li = list.findIndex((v) => v.kind === 'landed');
  list = li >= ARTIFACT_VERSIONS_MAX ? [...list.slice(0, ARTIFACT_VERSIONS_MAX - 1), list[li]] : list.slice(0, ARTIFACT_VERSIONS_MAX);
  return { slug, versions: list, truncated };
}
// A broken manifest is listed by its slug and error, never its unvalidated title.
export function describeArtifact(slug, at, src) {
  const p = artifactProblems(slug, src.entries);
  const mtime = Math.max(0, ...src.entries.map((e) => e.mtime ?? 0));
  const m = p.manifest;
  return { slug, at, title: m?.title ?? null, summary: m?.summary ?? null, by: m?.by ?? null, for: m?.for ?? [], kind: m?.kind ?? null, error: src.error ?? p.errors[0] ?? null, fp: fingerprint(src.entries), updated_at: mtime ? new Date(mtime).toISOString() : null };
}
export function landedArtifacts() {
  const ref = mainRef();
  if (!ref) return [];
  // one ls-tree for every slug's tree id; an artifact whose tree hasn't changed is described from
  // run/cache instead of spawning git for its manifest and page on every refresh
  const rows = (git(['ls-tree', `${ref}:${ARTIFACTS_REL}`], mainRoot) ?? '').split('\n').map((l) => /^040000 tree ([0-9a-f]+)\t(.+)$/.exec(l)).filter((m) => m && LINK_ID.test(m[2]));
  const file = path.join(runDir, 'cache', 'artifacts-landed.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const next = {};
  // the cache holds what the tree says (describeArtifact); the row adds the tree id itself, for
  // publishing, and nothing that changes without the tree changing goes in the cache
  const res = rows.map(([, tree, slug]) => {
    // a row with no kind key was written by a kit from before kinds, which calls a kinded manifest
    // broken: describe it again rather than serve that (kit-319)
    let d = cache[tree]?.slug === slug && 'kind' in cache[tree] ? cache[tree] : null;
    if (!d) { const src = artifactSource('main', slug); d = src ? describeArtifact(slug, 'main', src) : null; }
    if (!d) return null;
    next[tree] = d;
    return { ...d, tree };
  }).filter(Boolean);
  if (canonical(next) !== canonical(cache)) try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(next)); } catch {}
  return res;
}
// A worktree's copy identical to the landed one is not a draft: a merged branch's worktree not yet
// removed shows nothing.
export function draftArtifacts(landed = landedArtifacts()) {
  const fpOf = new Map(landed.map((a) => [a.slug, a.fp]));
  const msha = mainSha();
  // A copy of any version main has had is no draft either (kit-947): the fingerprints of every tree
  // in main's history of a slug, asked only for a slug with a copy that differs from landed, kept in
  // run/cache by main's sha (a new sha starts afresh) and slug, written once as the process ends.
  // With no main, or git failing, nothing is kept and nothing more is dropped.
  const mf = draftArtifacts.mainFps ??= (() => {
    const file = path.join(runDir, 'cache', 'artifacts-main-fps.json');
    const k = { data: { sha: null, slugs: {} }, dirty: false };
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (isObj(d) && typeof d.sha === 'string' && isObj(d.slugs)) k.data = d; } catch {}
    process.on('exit', () => { if (k.dirty) try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(k.data)); } catch {} });
    return k;
  })();
  if (msha && mf.data.sha !== msha) { mf.data = { sha: msha, slugs: {} }; mf.dirty = true; }
  const mainFps = (slug) => {
    const have = msha ? mf.data.slugs[slug] : null;
    if (Array.isArray(have)) return new Set(have);
    if (!msha) return new Set();
    const a = treeFolderArgs(msha, slug);
    const log = git(a.log, mainRoot), now = git(a.now, mainRoot);
    if (log === null || now === null) return new Set();
    const trees = new Set();
    for (const l of log.split('\n')) {
      const m = /^:\d+ \d+ [0-9a-f]+ ([0-9a-f]+) \S+\t(.*)$/.exec(l);
      if (m && m[2] === `${ARTIFACTS_REL}/${slug}` && !/^0+$/.test(m[1])) trees.add(m[1]);
    }
    if (treeNow(now)) trees.add(treeNow(now));
    const fps = [...trees].map(treeFingerprint);
    // one tree git couldn't read: this answer is used, never kept
    if (fps.every(Boolean)) { mf.data.slugs[slug] = fps; mf.dirty = true; }
    return new Set(fps.filter(Boolean));
  };
  const res = [];
  let names = [];
  // no .worktrees/ is no worktree drafts; drafts from other machines are still listed below
  try { names = fs.readdirSync(path.join(mainRoot, '.worktrees')); } catch {}
  for (const w of names.sort()) {
    if (!draftWorktree(w)) continue;
    let slugs = [];
    try { slugs = fs.readdirSync(path.join(mainRoot, '.worktrees', w, ARTIFACTS_REL)); } catch { continue; }
    for (const s of slugs.sort()) {
      const src = artifactSource(w, s);
      if (!src) continue;
      const d = describeArtifact(s, w, src);
      if (fpOf.get(s) !== d.fp && !mainFps(s).has(d.fp)) res.push(d);
    }
  }
  // Drafts from other machines (kit-750): each branch the dashboard fetched into refs/devteam-remote/
  // that isn't main and isn't merged into it, newest tip first, at most 200. Its slugs are the ones
  // its own commits since it left main changed (every one, for a branch with no base), and only a
  // folder whose tree main never had (now or in its history), so a squash- or rebase-merged branch
  // kept on origin shows nothing. A branch's slugs are kept by its tip and main's (artifacts-remote),
  // a description by tree id (artifacts-remote-trees). A worktree draft of the same slug wins, and
  // names the branches it hides (remote_branches).
  const ref = mainRef(), mainB = loadSettings().main_branch;
  const refs = ref ? git(['for-each-ref', '--sort=-committerdate', '--format=%(refname) %(objectname) %(committerdate:iso-strict)', 'refs/devteam-remote/'], mainRoot) : null;
  if (!refs) return res;
  // a branch this machine has too (refs/heads/<b>: its own pushed work) is not from another machine
  const mine = new Set((git(['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads/'], mainRoot) ?? '').split('\n').filter(Boolean));
  const branches = refs.split('\n').map((l) => /^refs\/devteam-remote\/(\S+) ([0-9a-f]+) (\S+)$/.exec(l)).filter((m) => m && m[1] !== mainB && !mine.has(m[1]) && BRANCH_AT.test(m[1])).slice(0, 200);
  const cacheFile = path.join(runDir, 'cache', 'artifacts-remote.json');
  const treeFile = path.join(runDir, 'cache', 'artifacts-remote-trees.json');
  let cache = {}, trees = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  try { trees = JSON.parse(fs.readFileSync(treeFile, 'utf8')); } catch {}
  const nextCache = {}, nextTrees = {};
  const onMain = new Map();
  const mainHas = (slug, tree) => {
    if (!onMain.has(slug)) { const a = treeFolderArgs(msha, slug); onMain.set(slug, { now: treeNow(git(a.now, mainRoot)), log: git(a.log, mainRoot) }); }
    const m = onMain.get(slug);
    return tree === m.now || treeInHistory(m.log, slug, tree);
  };
  const local = new Map();
  for (const d of res) if (!local.has(d.slug)) local.set(d.slug, d);
  const remote = [];
  for (const [, b, sha, date] of branches) {
    const key = `${sha} ${msha}`;
    let kept = Array.isArray(cache[key]) ? cache[key] : null;
    if (!kept) {
      const merged = spawnSync('git', ['merge-base', '--is-ancestor', sha, msha], { cwd: mainRoot, stdio: 'ignore' }).status;
      if (merged !== 0 && merged !== 1) continue;
      kept = [];
      if (merged === 1) {
        const mb = spawnSync('git', ['merge-base', msha, sha], { cwd: mainRoot, encoding: 'utf8' });
        if (mb.status !== 0 && mb.status !== 1) continue;
        const base = mb.status === 0 ? mb.stdout.trim() : null;
        let slugs;
        if (base) {
          // -z: a path with a non-ASCII byte comes as it is, never quoted
          const names = git(['diff', '-z', '--name-only', '--no-renames', base, sha, '--', ARTIFACTS_REL], mainRoot);
          if (names === null) continue;
          slugs = names.split('\0').filter(Boolean).map((n) => n.slice(ARTIFACTS_REL.length + 1).split('/')[0]);
        } else {
          const ls = git(['ls-tree', sha, `${ARTIFACTS_REL}/`], mainRoot);
          if (ls === null) continue;
          slugs = ls.split('\n').map((l) => /^040000 tree [0-9a-f]+\t.*\/([^/]+)$/.exec(l)?.[1]);
        }
        for (const slug of [...new Set(slugs)].filter((x) => LINK_ID.test(x ?? '')).sort()) {
          const tree = treeNow(git(['ls-tree', sha, '--', `${ARTIFACTS_REL}/${slug}`], mainRoot));
          if (tree && !mainHas(slug, tree) && !mainFps(slug).has(treeFingerprint(tree))) kept.push([slug, tree]);
        }
      }
    }
    nextCache[key] = kept;
    const at = `origin:${b}`;
    for (const [slug, tree] of kept) {
      let d = trees[tree]?.slug === slug && 'kind' in trees[tree] ? trees[tree] : null;
      if (!d) {
        const src = artifactSource(at, slug);
        if (!src || src.tree !== tree) continue;
        d = { ...describeArtifact(slug, at, src), error: src.error };
      }
      nextTrees[tree] = d;
      const row = { ...d, at, branch: b, remote: true, tree, commit: sha, updated_at: new Date(date).toISOString() };
      const l = local.get(slug);
      if (l) (l.remote_branches ??= []).push(b);
      else remote.push(row);
    }
  }
  for (const l of local.values()) l.remote_branches?.sort();
  const save = (file, next, was) => { if (canonical(next) !== canonical(was)) try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(next)); } catch {} };
  save(cacheFile, nextCache, cache);
  save(treeFile, nextTrees, trees);
  return [...res, ...remote];
}
