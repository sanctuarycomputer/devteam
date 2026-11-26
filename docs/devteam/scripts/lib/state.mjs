/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { HOME_CWD } from './base.mjs';
import { command } from './base.mjs';
import { commonDirs } from './base.mjs';
import { die } from './base.mjs';
import { fileURLToPath } from 'node:url';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { git } from './base.mjs';
import { positional } from './base.mjs';
import { readText } from './base.mjs';
import { rest } from './base.mjs';
/* imports end */
export const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = git(['rev-parse', '--show-toplevel'], process.cwd()) ?? process.cwd();
export const commonOf = (dir) => git(['rev-parse', '--path-format=absolute', '--git-common-dir'], dir);
// Paths compared as the filesystem has them (macOS's /var is /private/var; a symlinked checkout).
export const realPath = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
// A remote's identity: owner/name for GitHub, however written; anything else is a URL or a path
// (resolved from base, the checkout that names it). Read a checkout's origin with `git config
// --get remote.origin.url`, the URL as configured: `git remote get-url` expands
// url.<base>.insteadOf, which would make a mirror look like another repo.
export function remoteKeyAt(r, base) {
  const s = String(r ?? '').trim().replace(/\/+$/, '');
  const gh = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(s);
  if (gh && !/^[./]/.test(s)) return gh[1].toLowerCase();
  return /^[a-z]+:\/\//i.test(s) ? s.replace(/\.git$/, '') : realPath(path.resolve(base, s)).replace(/\.git$/, '');
}
// Home is the repo that holds the kit, project/ and the live log. It comes from DEVTEAM_HOME, or
// from the script that runs (the re-exec above makes that the main checkout's kit), never from the
// cwd: a worker in another repo's worktree runs home's kit by absolute path. Anything
// that isn't a home is refused loudly, never followed, so nothing runs against the wrong live log:
// a DEVTEAM_HOME that is no checkout, has no project settings, or is a repo link's checkout; another
// repo's copy of the kit run with DEVTEAM_HOME; and a kit whose project folder has no settings.md
// (a sibling's own copy, with or without tickets/, or a repo not adopted yet), for every command but
// init (which adopts) and help, and, in the kit's own repo, its views (KIT_VIEWS).
export const cwdCommon = commonOf(process.cwd());
// The kit's own repo (a remote of it is the kit's upstream) has no project of its own, but its
// views run there, over no tickets: nothing in them writes but `box-pins bump`, which rewrites only
// the pin ARGs of the Dockerfile it is given (cloud/Dockerfile unless --dockerfile names another).
export const KIT_UPSTREAM = 'sanctuarycomputer/devteam';
export const KIT_VIEWS = ['status', 'whoami', 'validate', 'links', 'box-pins'];
export const kitsOwnRepoAt = (root) => (git(['config', '--get-regexp', '^remote\\..*\\.url$'], root) ?? '').split('\n').some((l) => l && remoteKeyAt(l.slice(l.indexOf(' ') + 1), root) === KIT_UPSTREAM);
export const projectIn = (root) => path.resolve(flagStr('project') ?? process.env.DEVTEAM_PROJECT ?? path.join(root, 'docs', 'devteam', 'project'));
// The repo links a settings.md names, as { id: remote } (read raw: settings aren't loaded yet).
export const repoLinksIn = (file) => { try { const m = readText(file)?.match(/```json devteam\s*\n([\s\S]*?)\n```/); return Object.entries(JSON.parse(m[1]).links ?? {}).filter(([, l]) => l?.kind === 'repo' && typeof l.remote === 'string'); } catch { return []; } };
// { common, proj }: home's git common dir, and its project folder when DEVTEAM_HOME named it.
export const homeAt = (() => {
  const env = process.env.DEVTEAM_HOME;
  const scriptCommon = commonOf(here);
  if (!env) {
    const common = scriptCommon ?? cwdCommon;
    const root = common ? path.dirname(common) : null;
    const proj = root && path.join(root, 'docs', 'devteam', 'project');
    // the machine's commands look after every project from anywhere, a folder that is no project included
    const machineWide = ['machine', 'operator-thread', 'hub'].includes(command) || (command === 'recover' && flags.machine) || (command === 'box-pins' && positional[0] === 'installed');
    if (proj && command && !machineWide && !['help', '--help', 'init'].includes(command) && !process.env.DEVTEAM_PROJECT && !flagStr('project') && !fs.existsSync(path.join(proj, 'settings.md')) && !(KIT_VIEWS.includes(command) && kitsOwnRepoAt(root))) die(`no ${path.relative(root, proj).split(path.sep).join('/')}/settings.md here (${root}): run init to adopt devteam in this repo, or run home's kit with DEVTEAM_HOME=<home>`);
    return { common, proj: null };
  }
  const notHome = `DEVTEAM_HOME=${env} is not a devteam home (a checkout whose project folder has settings.md); unset it, or point it at home's main checkout`;
  const c = fs.existsSync(env) ? commonOf(env) : null;
  if (!c) die(notHome);
  const root = path.dirname(c);
  const proj = projectIn(root);
  if (!fs.existsSync(path.join(proj, 'settings.md'))) die(notHome);
  // a sibling with a stray settings.md is still a sibling: the running kit's home names it a link
  const origin = git(['config', '--get', 'remote.origin.url'], root);
  const sibling = scriptCommon && origin ? repoLinksIn(path.join(projectIn(path.dirname(scriptCommon)), 'settings.md')).find(([, l]) => remoteKeyAt(l.remote, path.dirname(scriptCommon)) === remoteKeyAt(origin, root)) : null;
  if (sibling) die(`DEVTEAM_HOME=${env} is the checkout of repo link ${sibling[0]}, not a devteam home; point it at home's main checkout`);
  // home's own kit runs against home; another repo's copy (a sibling's) would fold by other rules
  if (scriptCommon && realPath(scriptCommon) !== realPath(c) && !process.env.DEVTEAM_OWN_KIT) die(`DEVTEAM_HOME=${env}, but this kit is ${fileURLToPath(import.meta.url)} (another repo's copy): run home's kit, node '${path.join(root, 'docs', 'devteam', 'scripts', 'devteam.mjs')}'`);
  return { common: c, proj };
})();
export const commonDir = homeAt.common;
export const mainRoot = commonDir ? path.dirname(commonDir) : repoRoot;
// Whether this command runs in one of home's checkouts (its main checkout or a worktree of it).
export const cwdIsHome = !!cwdCommon && !!commonDir && realPath(cwdCommon) === realPath(commonDir);
HOME_CWD = cwdIsHome || !commonDir ? undefined : mainRoot;
// home's common dir is known already: reads at a commit key on it without asking git again
if (commonDir) for (const k of [HOME_CWD ?? process.cwd(), mainRoot]) commonDirs.set(k, commonDir);
// The kit folder of the checkout you are in when it is home's (a worktree has its own copy): its
// project/ is the branch's tickets and plans. Elsewhere, home's main checkout's, so mainRoot and
// projectDir both follow home (never the cwd's repo).
export const devteamDir = !cwdIsHome && commonDir ? path.join(mainRoot, 'docs', 'devteam') : fs.existsSync(path.join(repoRoot, 'docs', 'devteam', 'scripts', 'devteam.mjs')) ? path.join(repoRoot, 'docs', 'devteam') : path.resolve(here, '..');
// The rules (schema, constitution) and the dashboard come from the kit that is running: in a
// project that is the main checkout's (the re-exec above), so every session folds by the same rules.
export const kitDir = path.resolve(here, '..');
export const projectDir = path.resolve(flagStr('project') ?? process.env.DEVTEAM_PROJECT ?? path.join(devteamDir, 'project'));
export const runDir = path.resolve(process.env.DEVTEAM_RUN || path.join(mainRoot, 'docs', 'devteam', 'run'));
// DEVTEAM_RUN is home's run folder, given to each session by the kit that starts it. One that isn't
// inside the home this kit resolved is a session's, leaked into another repo's kit (a test's fixture,
// a sibling): refused by name, never followed into that session's live log. The machine's commands
// (machine, operator-thread, recover --machine, the hub) run from anywhere and keep no run folder. Not defended (the agents are trusted not to forge): a
// DEVTEAM_RUN that names some other folder inside home on purpose.
export const realPathMade = (p) => { let a = p; const rest = []; while (!fs.existsSync(a) && path.dirname(a) !== a) { rest.unshift(path.basename(a)); a = path.dirname(a); } return path.join(realPath(a), ...rest); };
if (process.env.DEVTEAM_RUN && command && !['help', '--help', 'machine', 'operator-thread', 'hub'].includes(command) && !(command === 'recover' && flags.machine) && !(command === 'box-pins' && positional[0] === 'installed')) {
  const r = realPathMade(runDir), root = realPath(mainRoot);
  if (r !== realPathMade(path.join(mainRoot, 'docs', 'devteam', 'run')) && r !== root && !r.startsWith(`${root}${path.sep}`)) die(`DEVTEAM_RUN=${runDir} is not inside this kit's home (${mainRoot}): a session's run folder leaked into another repo's kit; unset DEVTEAM_RUN, or run home's kit from home`);
}
