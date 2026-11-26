/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { LINKS_LOCAL } from './settings.mjs';
import { REPO_PATH } from './lens.mjs';
import { asList } from './base.mjs';
import { canonical } from './settings.mjs';
import { devteamDir } from './state.mjs';
import { die } from './base.mjs';
import { features } from './graph.mjs';
import { flagStr } from './base.mjs';
import { git } from './base.mjs';
import { isObj } from './artifact-notes.mjs';
import { kitDir } from './state.mjs';
import { loadSettings } from './settings.mjs';
import { mainRoot } from './state.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { projectRoot } from './settings.mjs';
import { readJson } from './base.mjs';
import { readText } from './base.mjs';
import { realOrSelf } from './spend.mjs';
import { remoteKeyAt } from './state.mjs';
import { repo } from './repos.mjs';
import { sha256 } from './lens.mjs';
import { tickets } from './graph.mjs';
import { unbalanced } from './graph.mjs';
/* imports end */
// ===== 2b. links and component lines (the registry) =====
//
// A link is a named resource the fleet uses; a repo link is one devteam can also operate on; a
// component is a line drawn over a repo link: the files it owns. home is the repo that holds the
// kit and project/, never declared; devteam is the kit's own line, computed.
export const RESERVED_LINKS = ['home', 'devteam'];
export const LINK_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// A git tree (or blob) id: sha1, or sha256 in a repo that uses it.
export const TREE_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
// The only acts the owner writes: records of what the owner did, never calls.
export const OWNER_ACTS = ['artifact-publish', 'pane-answer', 'goal-order', 'owner-setting'];
// The settings a repo link may carry for itself. The first four default to the
// project's; every other key is never inherited, so a repo with no gates is refused by merge like
// home with none, and a per-repo key added later gets the no-inherit rule by default.
export const REPO_KEYS = ['main_branch', 'forge', 'merge_method', 'release', 'gates', 'worktree_setup', 'worktree_files', 'ignored_checks', 'project', 'records', 'worktree_copy', 'worktree_setup_always'];
export const REPO_INHERITED = ['main_branch', 'forge', 'merge_method', 'release'];
// what a repo link's maintain may turn on; linkMaintains(l, 'prs')
export const LINK_DUTIES = ['prs', 'releases'];
// maintain.reviews: another name its review records may go under, run/reviews/<reviews>-pr-<n>/, besides the link's id
export const REVIEWS_PREFIX = /^[a-z0-9][a-z0-9_.-]{0,63}$/i;
export const linkMaintains = (l, duty) => !!l && typeof l === 'object' && !!l.maintain && typeof l.maintain === 'object' && l.maintain[duty] === true;
export const REPO_OWN = REPO_KEYS.filter((k) => !REPO_INHERITED.includes(k));
// records: where a ticket of this repo keeps its records (spec, plan, verification, reviews):
// "repo", in its own project folder, landing with its code; or "home", on home's ticket/<id> in
// home's project folder, so nothing of the project lands in the linked repo (recordsInHome).
export const REPO_OWN_DEFAULTS = { gates: {}, worktree_setup: '', worktree_files: [], ignored_checks: [], project: 'docs/devteam/project', records: 'repo', worktree_copy: [], worktree_setup_always: false };
export const RECORDS_WHERE = ['repo', 'home'];
// what a gate run sees is the owner's gate-change, as for home's own keys (OWNER_SETTINGS)
export const REPO_GATE_KEYS = ['gates', 'worktree_setup', 'worktree_files', 'ignored_checks'];
export const LINK_COMMON = ['kind', 'title', 'notes', 'for', 'source'];
// A link's title and notes reach every prompt its for matches, so each is one line of plain text
// under a cap: a line break, a tab, or a control or bidi character would let one writer's text pass
// for the kit's own instructions to every worker. registryProblems (validate, link add|set, and the
// settings at landing), observe-link and the log schema hold the same rule; prompts also quote the
// text (quoteData), so a hand edit that hasn't been validated yet still reads as data.
export const LINK_TEXT_MAX = Object.assign(Object.create(null), { title: 120, notes: 500 });
export const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
export const UNSAFE_TEXT_ALL = new RegExp(UNSAFE_TEXT.source, 'g');
export const linkTextProblem = (field, v) => (typeof v !== 'string' ? null : UNSAFE_TEXT.test(v) ? `${field} is one line of plain text (no line breaks, tabs, or control or bidi characters)` : v.length > LINK_TEXT_MAX[field] ? `${field} is at most ${LINK_TEXT_MAX[field]} characters` : null);
// A url or remote is one token: no whitespace, no control or bidi characters.
export const unsafeLocator = (v) => typeof v === 'string' && (/\s/.test(v) || UNSAFE_TEXT.test(v));
// Text shown to an agent as data: a JSON string, with the characters JSON leaves raw (DEL, C1,
// U+2028/2029, bidi controls) escaped too, so it stays one quoted line whatever it holds.
export const quoteData = (v) => JSON.stringify(String(v ?? '')).replace(UNSAFE_TEXT_ALL, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
export const locatorForPrompt = (v) => redactUrl(v).replace(/\s/g, encodeURIComponent).replace(UNSAFE_TEXT_ALL, encodeURIComponent);
// The type of every link field: link add|set parse a value by it, and validate checks it, so a
// title typed 2024 is the string "2024" and nothing downstream meets a number where text belongs.
export const LINK_TYPES = Object.assign(Object.create(null), {
  kind: 'string', title: 'string', notes: 'string', for: 'list', source: 'string', url: 'string', check: 'boolean',
  remote: 'string', path: 'string', main_branch: 'string', forge: 'string', merge_method: 'string', release: 'any',
  gates: 'object', worktree_setup: 'string', worktree_files: 'list', ignored_checks: 'list', project: 'string', records: 'string',
  worktree_copy: 'any', worktree_setup_always: 'boolean', maintain: 'object',
});
export const TYPE_WORDS = Object.assign(Object.create(null), { string: 'a string', boolean: 'true or false', list: 'a list of strings', object: 'an object' });
export const typeOk = (t, v) => t === 'any' || (t === 'string' ? typeof v === 'string' : t === 'boolean' ? typeof v === 'boolean' : t === 'list' ? Array.isArray(v) && v.every((x) => typeof x === 'string') : t === 'object' ? isObj(v) : true);
// A value from the command line, as its field's type: a list is separate values or one JSON array
// of strings; a boolean is true or false (anything else stays text, for validate to refuse); an
// object is JSON; everything else is the text as typed.
export function linkValue(field, vals) {
  const t = LINK_TYPES[field] ?? 'string';
  const one = vals.join(' ');
  if (t === 'list') { if (vals.length === 1 && one.trim().startsWith('[')) { try { const v = JSON.parse(one); if (Array.isArray(v)) return v; } catch {} } return vals; }
  if (t === 'boolean') return one === 'true' ? true : one === 'false' ? false : one;
  if (t === 'object') { try { return JSON.parse(one); } catch { return one; } }
  return one;
}
// Whether a repo checkout is where its link says and of its remote, once per process per location.
export const linkReachMemo = new Map();
// The url probe: a child node does one HEAD request with a 10 s deadline and prints the status.
export const PROBE_JS = "fetch(process.argv[1],{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(10000)}).then((r)=>console.log(r.status)).catch(()=>console.log(0))";
// Credentials in a URL or remote: on http(s) any userinfo (a user:pass or a bare token), on any
// other scheme a password (ssh://git@host/… names the ssh user, not a secret); on any scheme a
// query or fragment parameter named like a secret (?token=, #access_token=, an S3 presigned
// X-Amz-Signature); and an scp-style user:password@host:path (git@host:path names the ssh user).
// settings.md, the log and every prompt are shared and permanent, so a credential never goes in them.
export const CREDENTIAL_PARAM = /^(token|access_token|api_key|apikey|key|secret|client_secret|signature|sig|password|passwd|pw|auth|x-amz-.*)$/i;
export const SCP_PASSWORD = /^[^\s/:@]+:[^\s/]*@[^\s/:@]+:/;
export const paramNames = (part) => String(part ?? '').replace(/^[?#]/, '').split(/[&;]/).map((kv) => { try { return decodeURIComponent(kv.split('=')[0].replace(/\+/g, ' ')); } catch { return kv.split('=')[0]; } });
export function hasCredentials(u) {
  const t = String(u ?? '');
  if (SCP_PASSWORD.test(t)) return true;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false;
  const q = t.search(/[?#]/);
  if (q >= 0 && t.slice(q).split('#').some((part) => paramNames(part).some((n) => CREDENTIAL_PARAM.test(n)))) return true;
  let x;
  try { x = new URL(t); } catch { return /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(t); }
  return /^https?:$/i.test(x.protocol) ? !!(x.username || x.password) : !!x.password;
}
export const CREDENTIALS_REFUSED = 'credentials never go in settings or the log; use git\'s credential helper, or "check": false for a page behind auth';
// A URL or remote as it may be echoed into a message, a log line or a prompt: credentials stripped.
// Userinfo runs to the LAST @ before the host, as URL parsers and git split it, so a password
// holding a raw @ goes too; it never runs past the first / ? or #. A secret-named query or
// fragment parameter keeps its name and loses its value (token=REDACTED); an scp-style
// user:password@host: keeps the user.
export const redactUrl = (text) => String(text ?? '')
  .replace(/\b(https?:\/\/)[^/?#\s]*@/gi, '$1')
  .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^/?#\s:@]+):[^/?#\s]*@/gi, '$1@')
  .replace(/(^|[\s'"(=])([^\s/:@'"(=]+):[^\s/'"]*@([^\s/:@'"]+:)/g, '$1$2@$3')
  .replace(/([?#&;])([^=&#;\s]+)=([^&#;\s]*)/g, (m, sep, name, value) => (CREDENTIAL_PARAM.test(name) && value !== 'REDACTED' ? `${sep}${name}=REDACTED` : m));
// A link entry as it may be shown (links, settings, a question's links): url and remote redacted.
export const redactLink = (l) => (isObj(l) ? { ...l, ...(typeof l.url === 'string' ? { url: redactUrl(l.url) } : {}), ...(typeof l.remote === 'string' ? { remote: redactUrl(l.remote) } : {}) } : l);
// A local remote is a path, written so nobody mistakes it for owner/name: ./, ../ or absolute.
export const localRemote = (r) => !/^[a-z][a-z0-9+.-]*:\/\//i.test(r) && !/^[\w.-]+@[\w.-]+:/.test(r) && !/^[\w.-]+\/[\w.-]+$/.test(r);
// Every per-kind behaviour of a link. A new kind (doc, dataset, mcp) is one entry here;
// nothing outside this table branches on a kind. Null-prototype, as every table a user's word
// looks up: kind "constructor" is unknown, not Object's.
export const LINK_KINDS = Object.assign(Object.create(null), {
  repo: {
    // maintain: { prs, releases }, duties the supervisor keeps for a repo it doesn't only merge
    // tickets into (linkDutyFindings): the owner's, a governance-edit like the rest
    fields: { required: ['remote'], optional: ['path', 'maintain', ...REPO_KEYS] },
    // where the checkout is on this machine is never the owner's; what a gate run sees is
    // gate-change; anything else about a repo devteam merges into is governance-edit
    ownerClass: (field) => (field === 'path' ? null : REPO_GATE_KEYS.includes(field) ? 'gate-change' : 'governance-edit'),
    localOverrides: ['path'],
    hostsComponents: true,
    effectiveSettings: (link, project) => ({ ...Object.fromEntries(REPO_INHERITED.map((k) => [k, link[k] ?? project[k]])), ...Object.fromEntries(REPO_OWN.map((k) => [k, link[k] ?? REPO_OWN_DEFAULTS[k]])) }),
    // shape problems of one entry; ctx carries what spans entries (home's origin, remotes seen)
    validate: (l, at, ctx) => {
      const errs = [];
      if (typeof l.remote !== 'string') return errs;
      if (hasCredentials(l.remote)) return [`${at}: its remote carries credentials; ${CREDENTIALS_REFUSED}`];
      if (unsafeLocator(l.remote)) return [`${at}: remote is one token, with no spaces or control characters`];
      if (localRemote(l.remote) && !/^(\.{1,2}\/|\/)/.test(l.remote)) errs.push(`${at}: remote "${redactUrl(l.remote)}" is neither owner/name nor a URL; a local remote is a path starting ./, ../ or /`);
      const k = remoteKey(l.remote);
      if (ctx.homeOrigin && k === remoteKey(ctx.homeOrigin)) errs.push(`${at}: the repo that holds the kit (home) is never a link`);
      else if (fs.existsSync(linkLocation(ctx.id)) && realOrSelf(linkLocation(ctx.id)) === realOrSelf(mainRoot)) errs.push(`${at}: its path is the repo that holds the kit (home)`);
      if (ctx.remotes.has(k)) errs.push(`${at}: the same remote as links.${ctx.remotes.get(k)}`);
      else ctx.remotes.set(k, ctx.id);
      if (l.project !== undefined && (typeof l.project !== 'string' || !REPO_PATH.test(l.project))) errs.push(`${at}: project is a path inside that repo`);
      if (l.records !== undefined && !RECORDS_WHERE.includes(l.records)) errs.push(`${at}: records is "repo" or "home"`);
      if (l.maintain !== undefined && (!isObj(l.maintain) || Object.entries(l.maintain).some(([k, v]) => (k === 'reviews' ? typeof v !== 'string' || !REVIEWS_PREFIX.test(v) : !LINK_DUTIES.includes(k) || typeof v !== 'boolean')))) errs.push(`${at}: maintain is { "prs": true|false, "releases": true|false, "reviews": "<records prefix>" }`);
      return errs;
    },
    // local and cheap: metrics asks it live
    reachable: (link, id) => {
      const at = linkLocation(id);
      const key = `${id}\0${at}\0${link.remote}`;
      if (linkReachMemo.has(key)) return linkReachMemo.get(key);
      let why = null;
      if (!fs.existsSync(at)) why = `its checkout ${at} is missing (set path, or run/links.local.json on this machine)`;
      else {
        const origin = git(['config', '--get', 'remote.origin.url'], at);
        if (origin === null) why = `${at} is not a git checkout with an origin`;
        else if (remoteKey(origin) !== remoteKey(link.remote)) why = `${at} is a checkout of ${redactUrl(origin)}, not ${redactUrl(link.remote)}`;
      }
      linkReachMemo.set(key, why);
      return why;
    },
    // over the network, once a day (probeLinks): the remote still answers. Only asked once the
    // checkout is there, through its own origin, so a test's local bare repo is all it contacts.
    // Never a prompt: no terminal prompt, no askpass, and ssh in batch mode unless this
    // machine already says how to run ssh.
    probe: (link, id) => {
      if (LINK_KINDS.repo.reachable(link, id)) return null;
      const at = linkLocation(id);
      const ssh = process.env.GIT_SSH_COMMAND || git(['config', '--get', 'core.sshCommand'], at) ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };
      return { cmd: 'git', args: ['ls-remote', '--exit-code', '-q', 'origin', 'HEAD'], cwd: at, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', ...ssh }, judge: (code) => (code === 0 ? {} : { problem: `its remote ${redactUrl(link.remote)} does not resolve` }) };
    },
    fixHint: (link, id) => `clone ${redactUrl(link.remote)} at ${linkLocation(id)}, or set its path (run/links.local.json on this machine)`,
    // where it is, for a person, a question and the dashboard
    locator: (link, id) => ({ text: `repo ${redactUrl(link.remote)} at ${linkLocation(id)} (${fs.existsSync(linkLocation(id)) ? 'found' : 'missing'})`, remote: redactUrl(link.remote) }),
    promptLine: (link, id) => `- ${quoteData(link.title)} (repo ${locatorForPrompt(link.remote)}, checked out at ${linkLocation(id)}; read it for reference, change it only through a ticket in it)${link.notes ? `, notes: ${quoteData(link.notes)}` : ''} [link:${id}]`,
  },
  url: {
    fields: { required: ['url'], optional: ['check'] },
    // a url link is the supervisor's: every change to one is a registry-edit, which merge ties to
    // the act that made it
    ownerClass: () => 'registry-edit',
    localOverrides: [],
    hostsComponents: false,
    effectiveSettings: () => null,
    validate: (l, at) => [
      ...(typeof l.url === 'string' && !l.url.startsWith('https://') ? [`${at}: url must start with https://`] : []),
      ...(unsafeLocator(l.url) ? [`${at}: url is one token, with no spaces or control characters`] : []),
      ...(hasCredentials(l.url) ? [`${at}: its url carries credentials; ${CREDENTIALS_REFUSED}`] : []),
    ],
    reachable: () => null,
    // one HEAD request, 10 s, no body read; DEVTEAM_URL_PROBE stands in for it in tests.
    // 401, 403 and 405 mean the page is there behind auth (or refuses HEAD): a note, not a finding
    // that wakes wait.
    probe: (link) => {
      if (link.check === false) return null;
      const stub = process.env.DEVTEAM_URL_PROBE;
      return {
        cmd: stub ?? process.execPath, args: stub ? [link.url] : ['-e', PROBE_JS, link.url],
        judge: (_, out) => {
          const code = Number(out.trim());
          if (!code) return { problem: 'no answer to a HEAD request in 10 s' };
          if ([401, 403, 405].includes(code)) return { note: `HEAD returned ${code}: the page is there, behind auth the fleet can't pass` };
          return code >= 400 ? { problem: `HEAD returned ${code}` } : {};
        },
      };
    },
    fixHint: () => 'fix or remove the link (link set|rm), or "check": false for a page behind auth',
    locator: (link) => ({ text: redactUrl(link.url), url: redactUrl(link.url) }),
    promptLine: (link, id) => `- ${quoteData(link.title)} (${locatorForPrompt(link.url)})${link.notes ? `, notes: ${quoteData(link.notes)}` : ''} [link:${id}]`,
  },
});
// What a registry-edit act records of the entry it wrote: sha256 of its canonical JSON, or null
// when it removed the link. merge lands a url link only as an act wrote it (registryActFails).
export const linkEntryHash = (e) => (e === undefined || e === null ? null : `sha256:${sha256(canonical(e))}`);
// The classes a link change can be that are the supervisor's: a logged act, never an owner answer.
export const SUPERVISOR_LINK_CLASSES = ['registry-edit'];
// A kind is the owner's when any of its fields is an owner's class (repo); otherwise the
// supervisor's (url). Derived, so a new kind's entry says it once, in ownerClass.
for (const K of Object.values(LINK_KINDS)) K.ownedByOwner = [...LINK_COMMON.filter((f) => f !== 'kind'), ...K.fields.required, ...K.fields.optional].some((f) => { const c = K.ownerClass(f); return !!c && !SUPERVISOR_LINK_CLASSES.includes(c); });
export const linkFields = (kind) => (LINK_KINDS[kind] ? [...LINK_COMMON, ...LINK_KINDS[kind].fields.required, ...LINK_KINDS[kind].fields.optional] : LINK_COMMON);
// A remote's identity (remoteKeyAt), a path resolved from home's main checkout.
export const remoteKey = (r) => remoteKeyAt(r, mainRoot);
// Where a link's checkout is on this machine: run/links.local.json (untracked), the committed path,
// or ../<id>, relative to home's main checkout; --path on a command about that repo first.
export function linkLocation(id) {
  // --path <dir> on a command about this repo (--repo <id>): the checkout CI or a one-off run uses
  if (flagStr('path') && flagStr('repo') === id) return path.resolve(flagStr('path'));
  let local = {};
  try { local = readJson(LINKS_LOCAL); } catch {}
  const at = ownEntry(local, id)?.path ?? ownEntry(loadSettings().links, id)?.path ?? `../${id}`;
  return path.resolve(mainRoot, at);
}
// A component map draws lines only once an entry says so: before that its entries
// are labels a project wrote before lines existed, and nothing here applies to them.
export const COMPONENT_FIELDS = ['link', 'owns', 'shared', 'release'];
export const linesDeclared = (s) => Object.values(s?.components ?? {}).some((c) => isObj(c) && COMPONENT_FIELDS.some((k) => k in c));
export const componentLink = (name, s = loadSettings()) => (linesDeclared(s) ? ownEntry(s.components, name)?.link ?? 'home' : 'home');
export const componentsOn = (s, link = 'home') => (linesDeclared(s) ? Object.entries(s.components).filter(([, c]) => (c?.link ?? 'home') === link).map(([name, c]) => ({ name, owns: Array.isArray(c.owns) ? c.owns.filter((g) => typeof g === 'string') : undefined, shared: !!c.shared })) : []);
// The kit's own files: the kit folder and the project folder, wherever --project moved it.
// (upstreamSyncApproval reads this one too, rather than computing its own.) init also writes into
// .gitignore, AGENTS.md and CLAUDE.md, but each holds the project's own content beside the kit's,
// so they are the project's files and a component owns them (the README says so); the workers'
// harness policy is written per launch under run/, untracked. Relative to the checkout that holds
// the project (home's, from a sibling's worktree), like projectRel.
export const kitRel = path.relative(projectRoot, devteamDir).split(path.sep).join('/');
export const devteamLine = () => [...(kitRel && !kitRel.startsWith('..') ? [`${kitRel}/**`] : []), ...(projectInRepo ? [`${projectRel}/**`] : [])];
// The project's .gitleaks.toml as init writes it: it only extends the kit's gitleaks.toml (gitleaks'
// default rules, plus the allowlist for the log's source_key). gitleaks reads an extend path from the
// folder it runs in, the repository root. isGitleaksStub: a file that does only that, comments and
// blank lines aside, so a sync PR may add it where main has none (upstreamSyncCheck).
export const GITLEAKS_FILE = '.gitleaks.toml';
export const KIT_GITLEAKS = `${kitRel ? `${kitRel}/` : ''}gitleaks.toml`;
export const gitleaksExtend = () => `[extend]\npath = "${KIT_GITLEAKS}"`;
export const gitleaksStub = () => `# gitleaks reads this file. It extends devteam's config: gitleaks' default rules, plus an allowlist
# for one field of the kit's own log (${KIT_GITLEAKS} says which, and why). Add this project's
# own rules and allowlists below it (governance/quality.md, Secrets).
${gitleaksExtend()}
`;
export const isGitleaksStub = (text) => typeof text === 'string' && text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).join('\n') === gitleaksExtend();
// A real kit file: under the kit's own path, other than project/ and run/ (a project's own files, and
// its machine state). Everything else a chore changes is the project's.
export const isKitFile = (f) => { if (kitRel.startsWith('..')) return false; const rel = kitRel ? (f.startsWith(`${kitRel}/`) ? f.slice(kitRel.length + 1) : null) : f; return rel !== null && !/^(project|run)\//.test(rel); };

// One scope grammar for knowledge scopes and link `for` scopes: <kind> or <kind>:<id>.
// all and project mean the whole project, and both stay accepted. A later scope kind is one entry.
export const SCOPES = Object.assign(Object.create(null), {
  all: () => true,
  project: () => true,
  component: (v, c) => c.component === v,
  feature: (v, c) => c.feature === v,
  goal: (v, c) => (c.goals ?? []).includes(v),
  class: (v, c) => c.class === v,
  chore: (v, c) => c.chore === v,
  link: (v, c) => (c.links ?? []).includes(v),
  ticket: (v, c) => c.ticket === v,
});
// artifact: an artifact's for (artifact.json), which may also name the one ticket it was drawn for
export const SCOPE_WHERE = { for: ['all', 'project', 'component', 'feature', 'goal', 'link'], knowledge: ['all', 'project', 'component', 'feature', 'class', 'chore', 'link'], artifact: ['all', 'project', 'component', 'feature', 'goal', 'link', 'ticket'] };
export const SCOPE_HELP = Object.fromEntries(Object.entries(SCOPE_WHERE).map(([w, ks]) => [w, ks.map((k) => (['all', 'project'].includes(k) ? k : `${k}:<id>`)).join(', ')]));
export function scopeParts(scope) {
  const m = /^([a-z]+)(?::([a-z0-9][a-z0-9-]*))?$/.exec(String(scope ?? ''));
  return m && SCOPES[m[1]] && (['all', 'project'].includes(m[1]) ? !m[2] : !!m[2]) ? { kind: m[1], value: m[2] } : null;
}
export const scopeValid = (scope, where = 'for') => { const p = scopeParts(scope); return !!p && SCOPE_WHERE[where].includes(p.kind); };
export const scopeMatches = (scope, ctx) => { const p = scopeParts(scope); return !!p && SCOPES[p.kind](p.value, ctx ?? {}); };
// What a prompt is about, for both grammars: a ticket's component, feature, goals and links; a
// feature's; or a class. links: the registry ids its Links block lists, plus the component's repo
// link, so a link:<id> lesson reaches every prompt whose links or component include it.
export function scopeContext(target) {
  const t = tickets().get(target);
  const f = t ? features().get(t.feature) : features().get(target);
  const ctx = t ? { ticket: target, component: t.component, feature: t.feature, goals: f?.goals ?? [] } : f ? { feature: target, goals: f.goals ?? [] } : target ? { class: target } : {};
  const reg = loadSettings().links ?? {};
  const own = [...(t?.links ?? []), ...(f?.links ?? [])];
  const shown = Object.keys(reg).filter((id) => own.includes(id) || asList(reg[id].for).some((sc) => scopeMatches(sc, ctx)));
  return { ...ctx, shown, links: [...new Set([...shown, ...(t ? [componentLink(t.component)] : [])])] };
}
// Every problem with the registry and the lines, worded for validate. Shape only: coverage of a
// tree is coverage()'s, and runs on committed settings. Per-kind checks are LINK_KINDS[k].validate.
export function registryProblems(s) {
  const errors = [];
  const warnings = [];
  const links = s.links ?? {};
  if (!isObj(links)) return { errors: ['settings links: an object of { "<id>": { kind, title, … } }'], warnings };
  const ctx = { homeOrigin: git(['config', '--get', 'remote.origin.url']), remotes: new Map() };
  for (const [id, l] of Object.entries(links)) {
    const at = `links.${id}`;
    if (RESERVED_LINKS.includes(id)) { errors.push(`${at}: "${id}" is reserved (home is the repo that holds the kit; devteam is the kit's own line)`); continue; }
    if (!LINK_ID.test(id)) { errors.push(`${at}: an id is lowercase words joined by hyphens`); continue; }
    if (!isObj(l)) { errors.push(`${at}: an object`); continue; }
    const K = LINK_KINDS[l.kind];
    if (!K) { errors.push(`${at}: unknown kind "${l.kind ?? ''}" (known: ${Object.keys(LINK_KINDS).join(', ')})`); continue; }
    for (const f of ['title', ...K.fields.required]) if (l[f] === undefined || l[f] === '') errors.push(`${at}: ${f} is required`);
    const known = new Set(linkFields(l.kind));
    for (const f of Object.keys(l)) if (!known.has(f)) errors.push(`${at}: "${f}" is not a field of a ${l.kind} link (fields: ${[...known].join(', ')})`);
      else if (f !== 'kind' && l[f] !== undefined && !typeOk(LINK_TYPES[f] ?? 'string', l[f])) errors.push(`${at}: ${f} is ${TYPE_WORDS[LINK_TYPES[f] ?? 'string']}`);
    for (const f of ['title', 'notes']) { const why = linkTextProblem(f, l[f]); if (why) errors.push(`${at}: ${why}`); }
    for (const sc of asList(l.for)) if (!scopeValid(sc, 'for')) errors.push(`${at}: for "${sc}" is not a scope (${SCOPE_HELP.for})`);
    errors.push(...K.validate(l, at, { ...ctx, id }));
  }
  if (!linesDeclared(s)) return { errors, warnings };
  const byLink = new Map();
  for (const [name, c] of Object.entries(s.components)) {
    const at = `components.${name}`;
    if (RESERVED_LINKS.includes(name)) { errors.push(`${at}: "${name}" is reserved`); continue; }
    if (!LINK_ID.test(name)) { errors.push(`${at}: a component id is lowercase words joined by hyphens`); continue; }
    if (!isObj(c)) { errors.push(`${at}: an object ({ "link": …, "owns": [globs], "shared": true })`); continue; }
    for (const f of Object.keys(c)) if (!COMPONENT_FIELDS.includes(f)) errors.push(`${at}: "${f}" is not a component field (${COMPONENT_FIELDS.join(', ')})`);
    const link = c.link ?? 'home';
    if (link !== 'home') {
      if (!ownEntry(links, link)) errors.push(`${at}: link "${link}" is not in links`);
      else if (!LINK_KINDS[links[link].kind]?.hostsComponents) errors.push(`${at}: link "${link}" is a ${links[link].kind} link, which holds no files`);
    }
    if (c.owns !== undefined && !Array.isArray(c.owns)) errors.push(`${at}.owns: a list of globs`);
    // an empty list is a line around nothing; leave owns out for the sole-component ** default
    else if (Array.isArray(c.owns) && !c.owns.length) errors.push(`${at}.owns: an empty list owns nothing (leave owns out for a sole component that owns everything)`);
    asList(c.owns).forEach((g, i) => {
      if (isObj(g)) errors.push(`${at}.owns[${i}]: an object entry is reserved for a later release (a component spanning repos)`);
      else if (typeof g !== 'string' || !g) errors.push(`${at}.owns[${i}]: a glob`);
      else if (g.startsWith('!')) errors.push(`${at}.owns[${i}]: negation patterns are refused; draw the line with what it owns`);
      else if (unbalanced(g)) errors.push(`${at}.owns[${i}]: "${g}" has unbalanced braces`);
    });
    if (c.shared !== undefined && typeof c.shared !== 'boolean') errors.push(`${at}.shared: true or false`);
    if (c.release !== undefined && !(isObj(c.release) && typeof c.release.tag === 'string' && Object.keys(c.release).length === 1)) errors.push(`${at}.release: { "tag": "<glob>" }, e.g. { "tag": "web/v*" }`);
    (byLink.get(link) ?? byLink.set(link, []).get(link)).push([name, c]);
  }
  for (const [link, cs] of byLink) {
    const bare = cs.filter(([, c]) => c?.owns === undefined).map(([n]) => n);
    if (bare.length && cs.length > 1) errors.push(`components ${bare.join(' and ')} ${bare.length > 1 ? 'both have' : 'has'} no owns on ${link}: a component without owns owns everything only while it is the only one there`);
  }
  return { errors, warnings };
}

// The trust ladder and its tables live in governance/constitution.md, in a ```json devteam block.
export let ladderCache;
export function ladder() {
  if (ladderCache) return ladderCache;
  const m = readText(path.join(kitDir, 'governance', 'constitution.md'))?.match(/```json devteam\s*\n([\s\S]*?)\n```/);
  let a = { classes: {}, constitutional: [], owner_only: [], reasons: [], promotion: {} };
  if (m) {
    try {
      a = { ...a, ...JSON.parse(m[1]) };
    } catch (e) {
      die(`constitution.md: the json devteam block is not valid JSON: ${e.message}`);
    }
  }
  a.raw_ceilings = Object.fromEntries(Object.entries(a.classes).map(([k, v]) => [k, v.ceiling]));
  for (const [c, v] of Object.entries(loadSettings().autonomy_ceilings ?? {})) {
    if (a.classes[c] && typeof v === 'number' && v < a.classes[c].ceiling) a.classes[c] = { ...a.classes[c], ceiling: v };
  }
  a.promotion = { agreement: 0.9, agreement_window: 10, ...a.promotion };
  return (ladderCache = a);
}
export const RUNG = { 1: 'ask', 2: 'ask with a default', 3: 'act and report' };
// The rungs as the dashboard says them.
export const RUNG_PLAIN = { 1: 'asks you first', 2: 'asks, goes ahead at a deadline', 3: 'decides and tells you' };
// Every kind of decision in plain words, for display: the constitution's classes, constitutional and
// owner-only lists, every class the kit writes itself (OWNER_ACTS, the fleet's, the goal's), and
// kit-85's settings acts. A name never contains a class id (the one-word ones included), so no id
// ever shows. One entry per line: test/dashboard-data.test.mjs takes one out to check it is missed.
export const CLASS_WORDS = Object.freeze({
  'new-feature': "Starting a feature you haven't asked for",
  'priority-change': 'Changing what gets worked on first',
  'release-scope': 'Moving a story to a later release',
  'upstream-pr': 'Proposing an improvement to the kit itself',
  'release-production': 'Shipping a release to production',
  'production-migration': 'Changing production data',
  'incident-fix': 'Fixing a production incident',
  'production-remediation': 'Restarting, scaling or rolling back production',
  'merge-word': 'Merging a ticket',
  'approve-feature-plan': "Approving a feature's plan",
  'merge-chore': 'Merging a chore',
  'chore-start': 'Starting a chore',
  'chore-drop': 'Dropping a chore',
  'worker-slots': 'Starting and stopping workers',
  'replan-within-feature': 'Replanning the tickets of a feature',
  'add-ticket': 'Adding a ticket',
  'approve-spec': "Approving a ticket's spec",
  'approve-plan': "Approving a ticket's plan",
  'approve-design-change': 'Approving a change to a design',
  'contract-ruling': 'Ruling on a contract between pieces of work',
  'improvement-trial': 'Trying out a process improvement',
  'release-staging': 'Shipping a release to staging',
  'goal-readiness': 'Saying a goal is ready to start',
  'apply-default': "Going ahead with a question's default",
  'withdraw-question': 'Taking back a question',
  recovery: 'Getting stuck work going again',
  'carry-answer': 'Applying an earlier answer of yours',
  drain: 'Letting running work finish and starting nothing new',
  undrain: 'Starting new work again after a wind-down',
  'goal-hold': 'Holding a goal or letting it go',
  'fleet-drain': 'Winding down the whole fleet',
  'fleet-park': 'Parking the whole fleet',
  'fleet-undrain': 'Starting the whole fleet again after a wind-down',
  'fleet-unpark': 'Unparking the whole fleet',
  'registry-edit': 'Changing a registry entry',
  'goal-impact': 'Judging how much a goal matters',
  'orient-noise': 'Ruling some signals to be noise',
  'gate-add': 'Adding a check',
  'one-way-door': "A change that can't be undone",
  'check-override': 'Overriding a failing check',
  'governance-edit': 'Changing the rules',
  'process-edit': 'Changing how the team works',
  'gate-change': 'Changing a check',
  'goal-change': 'Changing a goal',
  'strategy-change': 'Changing the strategy',
  'self-change': 'Changing what the project is',
  'names-checked': 'Checking the names in a draft before it is public',
  'exterior-change': 'Changing what the project relates to',
  'goal-met': 'Saying a goal is met',
  'registry-attest': 'Confirming the registry is complete',
  'new-dependency': 'Adding a new dependency',
  'artifact-publish': 'Publishing a page',
  'recurring-edit': 'Adding, changing or stopping a job',
  'pane-answer': "Answering the supervisor's terminal",
  'goal-order': 'Putting the goals in order',
  'goal-approval': 'Approving a goal',
  'owner-setting': 'Asking for a setting',
  'settings-edit': 'Changing one of its own settings',
  'browser-handover': 'Handing the browser to you for a login',
});
// A class in plain words; one the supervisor made up (decide --class, ask --class) shows as unnamed,
// in its own words, so the gap is visible and the bare id never is. No class, no name.
// A known id in another case (decide --class DRAIN) reads as the known class.
export const className = (c) => {
  if (c == null) return null;
  const k = String(c).toLowerCase();
  return Object.hasOwn(CLASS_WORDS, k) ? CLASS_WORDS[k] : `Unnamed kind (${k.replace(/-/g, ' ')})`;
};
export const withClassName = (row) => ({ ...row, class_name: className(row.class) });

// ===== 3. the schema and the log =====

