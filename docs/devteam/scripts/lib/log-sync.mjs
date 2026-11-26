/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ENVELOPE } from './log.mjs';
import { FINDING_ID } from './reviews.mjs';
import { HOME_CWD } from './base.mjs';
import { LINE_MAX } from './log.mjs';
import { LINK_KINDS } from './links.mjs';
import { MONTHLY } from './log.mjs';
import { RESPONDER_GIT } from './responder.mjs';
import { RESPONDER_GROUP_RUN } from './responder.mjs';
import { SCHEMA } from './log.mjs';
import { SINK_RE } from './secrets.mjs';
import { TYPES } from './log.mjs';
import { artifactSource } from './artifacts.mjs';
import { canonical } from './settings.mjs';
import { checkLine } from './log.mjs';
import { choreWorktree } from './goals.mjs';
import { commonDir } from './state.mjs';
import { dateOnly } from './base.mjs';
import { defaultGap } from './questions.mjs';
import { die } from './base.mjs';
import { disposed } from './reviews.mjs';
import { durableLogDir } from './log.mjs';
import { envPerson } from './orient.mjs';
import { fetchPastHalfMade } from './pr-checks.mjs';
import { fingerprint } from './artifacts.mjs';
import { firstLine } from './reviews.mjs';
import { flagStr } from './base.mjs';
import { flags } from './base.mjs';
import { fold } from './log.mjs';
import { git } from './base.mjs';
import { gitBlob } from './lens.mjs';
import { gitOrDie } from './base.mjs';
import { gitReadCache } from './base.mjs';
import { gitRun } from './reviews.mjs';
import { goalOrderText } from './decide.mjs';
import { isObj } from './artifact-notes.mjs';
import { isPlanFile } from './log.mjs';
import { json } from './base.mjs';
import { linkChangedCache } from './check-ticket.mjs';
import { liveLogDir } from './log.mjs';
import { loadSettings } from './settings.mjs';
import { logFileFor } from './log.mjs';
import { logWriter } from './log.mjs';
import { mainLogCache } from './repos.mjs';
import { mainRef } from './log.mjs';
import { mainRefCache } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mainSha } from './log.mjs';
import { memo } from './graph.mjs';
import { mergeShaCache } from './repos.mjs';
import { nearlySameQuestion } from './decide.mjs';
import { newer } from './box-pins.mjs';
import { nowIso } from './base.mjs';
import { openPr } from './goals.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { ownerChannel } from './log.mjs';
import { parseLines } from './log.mjs';
import { personOk } from './orient.mjs';
import { planFeature } from './log.mjs';
import { positional } from './base.mjs';
import { prefetchAt } from './base.mjs';
import { previewUpHere } from './previews.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { questionHold } from './secrets.mjs';
import { readPreviews } from './previews.mjs';
import { readText } from './base.mjs';
import { redactLink } from './links.mjs';
import { redactUrl } from './links.mjs';
import { repo } from './repos.mjs';
import { repoRoot } from './state.mjs';
import { responderGit } from './responder.mjs';
import { rest } from './base.mjs';
import { reviewResultPath } from './lens.mjs';
import { reviewStatus } from './artifact-notes.mjs';
import { sameAnswer } from './questions.mjs';
import { seedOwnerCursor } from './sessions.mjs';
import { settingsCache } from './settings.mjs';
import { sha256 } from './lens.mjs';
import { showAt } from './base.mjs';
import { sinkWarning } from './secrets.mjs';
import { sinkWords } from './secrets.mjs';
import { spawnSync } from 'node:child_process';
import { supervisorOnly } from './log.mjs';
import { tableCells } from './reviews.mjs';
import { warn } from './base.mjs';
import { withLock } from './log.mjs';
import { withOoda } from './questions.mjs';
import { writerClass } from './log.mjs';
import { writerOfFile } from './log.mjs';
/* imports end */
// Before judging a PR (check-pr, merge): main as origin has it now, and nothing read from the old
// one kept. A push to main from another clone since this checkout last fetched would otherwise be
// left out of the landing tree, the settings in force and the registry acts.
// Settings, the log's memos (landing, coverage), main's log and merge shas are all re-read.
// A fetch that fails refuses the run, dry runs included: judging the last-fetched main would pass
// a PR against a main that may have moved. A checkout with no origin remote has nowhere to fetch
// from, so its own main is the one in force and nothing is fetched.
// A PR in another repo (R) also needs that repo's main as its origin has it now: home's main
// holds the settings and lines that judge it, R's the tree it lands on. Either fetch failing refuses.
export function fetchMain(R = null) {
  if (!commonDir) return;
  if (git(['config', '--get', 'remote.origin.url']) !== null) {
    const b = loadSettings().main_branch;
    const f = gitRun(['fetch', '--quiet', 'origin', b]);
    if (f.status !== 0) die(`could not fetch origin ${b}: ${redactUrl(firstLine(f.err)) || `exit ${f.status}`}; refusing to judge against a stale main`);
    mainRefCache = undefined;
    settingsCache = undefined;
    logCache = null;
    mainLogCache = undefined;
    mergeShaCache.clear();
    linkChangedCache.clear();
  }
  if (R && R.name !== 'home') fetchLinkMain(R);
}
// Another repo's main, fetched into its checkout by the same rule as home's: skipped when the
// checkout has no origin, refused when the fetch fails, so nothing is judged, read or started on a
// stale main. (repo() matches a checkout to its link by origin, so the skip is home's rule kept.)
// The refspec is named: the checkout's remote.origin.fetch is any session's to blank, and the fetch
// would then leave a moved origin/<main> in place.
// start (kit-790): a branch a session's new worktree is for, in home or another repo. Main and that
// branch are read from origin by sha, and the shas returned ({ main, branch: null when origin has
// none }): a start never takes a local ref's word for either. With no origin to read, it refuses.
export function fetchLinkMain(R, refusing = 'refusing to judge against a stale main', { start = null } = {}) {
  const rb = R.settings.main_branch;
  const no = (why) => die(`could not fetch origin ${rb} in ${R.name}: ${why}; ${refusing}`);
  if (R.git(['config', '--get', 'remote.origin.url'], R.root) === null) {
    if (start) no('it has no origin url');
    return;
  }
  // git fetches from the first of several urls, and repo() checks the last
  const urls = start && R.git(['config', '-z', '--get-all', 'remote.origin.url'], R.root)?.split('\0').filter(Boolean);
  if (start && !urls) no('git could not read its origin urls');
  if (start && urls.length > 1) no(`its origin has ${urls.length} urls (git config --get-all remote.origin.url), and only one can be the repo checked; keep one`);
  if (!start) {
    const fr = gitRun(['fetch', '--quiet', 'origin', `+refs/heads/${rb}:refs/remotes/origin/${rb}`], R.root);
    if (fr.status !== 0) no(redactUrl(firstLine(fr.err)) || `exit ${fr.status}`);
    R.resetCaches();
    return;
  }
  // in its own process group, so a hung transport goes with it at the deadline
  const toOrigin = (args) => {
    const r = spawnSync(process.execPath, ['-e', RESPONDER_GROUP_RUN, '--', '120000', 'git', ...RESPONDER_GIT, ...args], { cwd: R.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 130000 });
    if (r.status !== 0) no(r.status === 124 ? 'it did not answer in time' : redactUrl(firstLine(r.stderr).replace(/^fatal: /, '')) || `exit ${r.status}`);
    return String(r.stdout ?? '');
  };
  // by its exact name: rev-parse would fall back to a branch called refs/remotes/origin/<b>
  const tracked = (b) => { const r = responderGit(['show-ref', '--verify', '--hash', `refs/remotes/origin/${b}`], R.root); return r.status === 0 ? r.stdout.trim() : null; };
  for (let tries = 1; ; tries += 1) {
    // Read before origin is: a session here that pushes meanwhile moves its tracking ref after that,
    // so setting it from this value refuses, and origin is read again (kit-856).
    const was = { [rb]: tracked(rb), [start]: tracked(start) };
    const at = {};
    // ls-remote matches a pattern against the end of a ref's name, so only an exact name counts
    for (const [sha, ref] of toOrigin(['ls-remote', 'origin', `refs/heads/${rb}`, `refs/heads/${start}`]).split('\n').map((l) => l.split('\t'))) {
      for (const b of [rb, start]) if (/^[0-9a-f]{40,64}$/.test(sha) && ref === `refs/heads/${b}`) at[b] = sha;
    }
    if (!at[rb]) no(`origin has no ${rb}`);
    const held = [rb, start].filter((b) => at[b]);
    // Into no ref: a fetch writes through a symbolic tracking ref, moving the branch it names. The
    // tracking refs are set below, by sha, without following one.
    toOrigin(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', '--refmap=', 'origin', ...held.map((b) => `refs/heads/${b}`)]);
    for (const b of held) if (responderGit(['cat-file', '-e', `${at[b]}^{commit}`], R.root, { GIT_NO_LAZY_FETCH: '1' }).status !== 0) no(`${at[b].slice(0, 8)} did not arrive`);
    const moved = held.find((b) => {
      const set = responderGit(['update-ref', '--no-deref', `refs/remotes/origin/${b}`, at[b], was[b] ?? '0'.repeat(at[b].length)], R.root);
      if (set.status !== 0 && tracked(b) === was[b]) no(redactUrl(firstLine(set.stderr).replace(/^fatal: /, '')) || `exit ${set.status}`);
      return set.status !== 0;
    });
    if (!moved) {
      R.resetCaches();
      return { main: at[rb], branch: at[start] ?? null };
    }
    if (tries === 3) no(`origin/${moved} here kept moving while it was read`);
  }
}
// In a read-only command, full ref names resolve from one for-each-ref listing (a dashboard
// refresh asked git about each ticket branch separately: ~90 processes). Anything else, and every
// command that writes, asks git directly.
export let refCommits = null;
export function resolveCommit(ref, cwd = HOME_CWD) {
  // only an exact ref name is in the listing: main~1 or x^{} is rev-parse's to answer
  if (gitReadCache && ref.startsWith('refs/') && !/[~^@:]/.test(ref)) {
    if (!refCommits || refCommits.cache !== gitReadCache) refCommits = { cache: gitReadCache, byRepo: new Map() };
    const k = cwd ?? '';
    if (!refCommits.byRepo.has(k)) {
      const listing = git(['for-each-ref', '--format=%(refname)%00%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)'], cwd);
      // a listing that failed says nothing about any ref: ask for each one instead of calling them all gone
      let map = null;
      if (listing !== null) {
        map = new Map();
        for (const line of listing.split('\n')) {
          const [name, type, sha, ptype, psha] = line.split('\0');
          if (name) map.set(name, type === 'commit' ? sha : ptype === 'commit' ? psha : undefined);
        }
      }
      refCommits.byRepo.set(k, map);
    }
    const map = refCommits.byRepo.get(k);
    if (map) {
      if (!map.has(ref)) return null;
      const sha = map.get(ref);
      if (sha !== undefined) return sha;
    }
  }
  return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd);
}

// The durable copy of a file: main's committed version or this checkout's, whichever extends the
// other (this checkout may not have pulled yet, or may be a plan branch that is ahead).
export function durableText(file) {
  const local = readText(path.join(durableLogDir(), file));
  const shown = projectInRepo && mainRef() ? showAt(mainSha(), `${projectRel}/log/${file}`) : null;
  const main = shown === null ? null : `${shown}\n`;
  if (main === null) return local;
  if (local === null || main.startsWith(local)) return main;
  return local;
}

// The line appendLog writes for these fields, with every field it adds: the envelope (id, op, at,
// by, the owner's channel) and, on the owner's answer, the hash of the question as it stands
// (questionView). A command checking a line's size before it writes builds it here too (lineFits),
// so the check and the write never disagree.
export function logLineFor(fields, by, id, at = nowIso()) {
  const type = fields.type;
  if (type === 'question' && fields.op === 'set' && writerClass(by) === 'owner' && fields.answer !== undefined) {
    const q = logGet(fields.id);
    if (q?.type === 'question') fields = { ...fields, question_hash: questionHash(q) };
  }
  const line = { v: 1, id: fields.id ?? id, type, op: fields.op ?? 'new', at, by, ...(by === 'owner' ? { channel: fields.channel ?? ownerChannel() } : {}) };
  for (const [k, val] of Object.entries(fields)) if (!ENVELOPE.includes(k) && val !== undefined) line[k] = val;
  // which of the box's people gave it (kit-252, personHeader): the owner's lines alone, of a type
  // that has person, and here so that lineFits counts it as appendLog writes it
  const person = by === 'owner' && SCHEMA.$defs.types[type]?.properties?.person ? envPerson() : null;
  if (person) line.person = person;
  return line;
}
// Whether these fields' line fits LINE_MAX, built as appendLog will, with a placeholder id of the
// real shape (u-00000000-000000000-owner) where the log would mint one.
export const lineFits = (fields, by) => Buffer.byteLength(`${JSON.stringify(logLineFor(fields, by, `${SCHEMA['x-id'].prefix[fields.type]}-00000000-000000000-${by}`))}\n`) <= LINE_MAX;

// A box's claim and invite links carry their token after the fragment (/auth/claim#<token>): one
// pasted into a turn, an answer or a pane answer would sit in the log, in threads.jsonl and in a
// pane for anyone on the box to reuse. The token goes, the link's shape stays (/auth/claim#…). The
// rule covers every form the gateway would still route with the token intact: a query before the
// fragment, %23 for #, and the whole link percent-encoded. It is cloud/gateway.mjs's CLAIM_LINK
// byte for byte (test/org-access.invites.test.mjs compares them). A redacted link doesn't match, so
// it is idempotent. Strings anywhere in an object or array, keys kept.
export function redactClaimLinks(v, depth = 0) {
  const CLAIM_LINK = /((?:\/|%2F)auth(?:\/|%2F)claim(?:\?[^\s#"'<>`]*)?(?:#|%23))(?!…)[^\s"'<>`)\]}…]+/gi;
  if (typeof v === 'string') return v.replace(CLAIM_LINK, '$1…');
  if (!v || typeof v !== 'object' || depth >= 8) return v;
  if (Array.isArray(v)) return v.map((x) => redactClaimLinks(x, depth + 1));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactClaimLinks(x, depth + 1)]));
}

// Append one object. Under the file's lock: catch a live file up with the durable copy if that is
// ahead, drop a half-written last line, stamp a time after the file's last line (ids unique, lines
// ordered even if the clock steps back), validate exactly what will be read back, write one line.
export function appendLog(fields, by = logWriter()) {
  fields = redactClaimLinks(fields);
  const type = fields.type;
  // the supervisor's first line on a machine with no owner cursor would move the no-cursor floor past
  // what the owner wrote before it: pin the floor first (seedOwnerCursor)
  if (by === 'supervisor') seedOwnerCursor();
  if (!TYPES.includes(type)) die(`unknown log type ${type}`);
  const f = planFeature(by);
  if (f && fields.op === 'set' && ['feature', 'ticket'].includes(type)) {
    const cur = logGet(fields.id);
    if (cur && (type === 'feature' ? cur.id : cur.feature) !== f) die(`${by} may only change the feature "${f}" and its tickets`);
  }
  const file = logFileFor(by, type);
  const prefix = SCHEMA['x-id'].prefix[type];
  const build = (at) => {
    // the owner's answer binds to the question as it stands (logLineFor adds its hash)
    const line = logLineFor(fields, by, `${prefix}-${at.slice(0, 10).replace(/-/g, '')}-${at.slice(11, 23).replace(/[:.]/g, '')}-${by}`, at);
    const text = `${JSON.stringify(line)}\n`;
    const parsed = JSON.parse(text);
    const errs = checkLine(parsed, file);
    if (errs.length) die(`log line refused: ${errs.join('; ')}`);
    if (Buffer.byteLength(text) > LINE_MAX) die(`log line is over ${LINE_MAX} bytes; put detail in a file and reference its path`);
    return { parsed, text };
  };
  build(nowIso());
  const planner = isPlanFile(file);
  const dir = planner ? durableLogDir() : liveLogDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file);
  let result;
  withLock(target, () => {
    let cur = readText(target) ?? '';
    if (!planner) {
      const durable = durableText(file);
      if (durable && durable.length > cur.length && durable.startsWith(cur)) {
        fs.writeFileSync(target, durable);
        cur = durable;
      }
    }
    if (cur && !cur.endsWith('\n')) {
      cur = cur.slice(0, cur.lastIndexOf('\n') + 1);
      fs.writeFileSync(target, cur);
    }
    let lastAt = '';
    try {
      const tail = cur.trimEnd().split('\n').pop();
      lastAt = tail ? JSON.parse(tail).at ?? '' : '';
    } catch {
      lastAt = '';
    }
    let t = Date.now();
    if (lastAt && Date.parse(lastAt) >= t) t = Date.parse(lastAt) + 1;
    result = build(new Date(t).toISOString());
    fs.appendFileSync(target, result.text);
  });
  logCache = null;
  return result.parsed;
}

// The live file and the durable copy of one log file as one text: whichever extends the other, else
// the durable one with the live lines it lacks.
export function mergeLogText(live, durable) {
  if (live === null) return durable ?? '';
  if (durable === null || live.startsWith(durable)) return live;
  if (durable.startsWith(live)) return durable;
  const have = new Set(durable.split('\n'));
  return durable + live.split('\n').filter((l) => l && !have.has(l)).map((l) => `${l}\n`).join('');
}

export function logFileText(file) {
  return mergeLogText(isPlanFile(file) ? null : readText(path.join(liveLogDir(), file)), durableText(file));
}

export let logCache = null;
export function readLog() {
  if (logCache) return logCache;
  // folds, not calls: wait's trace counts them (kit-594)
  readLog.reads = (readLog.reads ?? 0) + 1;
  const names = new Set();
  for (const d of [liveLogDir(), durableLogDir()]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl')) names.add(f);
  const lines = [];
  const errors = [];
  const unknown = [];
  // main's copy of every file in one git call, not one each
  if (projectInRepo && mainRef()) prefetchAt(mainSha(), [...names].map((f) => `${projectRel}/log/${f}`));
  for (const f of [...names].sort()) {
    const r = parseLines(logFileText(f), f, { validate: false });
    lines.push(...r.lines);
    errors.push(...r.errors);
    unknown.push(...r.unknown);
  }
  const { objects, ignored } = fold(lines);
  // each type's objects in the fold's order, so a lookup by type doesn't scan every object
  const byType = new Map();
  for (const o of objects.values()) { if (!byType.has(o.type)) byType.set(o.type, []); byType.get(o.type).push(o); }
  return (logCache = { lines, objects, errors, ignored, unknown, byType });
}
// What readLog folds, as one string: main's sha (the durable log is read at it, so a merge or a fetch
// that moves main changes it with no file in the checkout changed) and each log file's name, size and
// mtime under run/log and project/log. Equal means a fold would read the same lines.
export function logKey() {
  mainRefCache = undefined;
  const parts = [`main ${mainSha() ?? '-'}`];
  for (const [tag, d] of [['run', liveLogDir()], ['project', durableLogDir()]]) {
    let names = [];
    try { names = fs.readdirSync(d).filter((f) => f.endsWith('.jsonl')).sort(); } catch {}
    for (const f of names) { try { const st = fs.statSync(path.join(d, f)); parts.push(`${tag}/${f} ${st.size} ${st.mtimeMs}`); } catch {} }
  }
  return parts.join('\n');
}
export const logObjects = (type) => (readLog().byType.get(type) ?? []).filter((o) => !(type === 'goal' && o.kind === 'upkeep'));
// The built-in Upkeep goal (planning.md §7), or null while it has no line yet (then it runs).
export const upkeepGoal = () => (readLog().byType.get('goal') ?? []).find((o) => o.kind === 'upkeep') ?? null;
export const logGet = (id) => readLog().objects.get(id) ?? null;
export const byTime = (a, b) => a.created_at.localeCompare(b.created_at);
// A message is handled when a reply cites it (--re), or when the supervisor routed it to the owner
// as a question that cites it (ask --re): then it waits on the owner, which the question shows.
// A handoff is closed only by the supervisor's re (kit-109, ruling a-20261123-051656528): a session's
// hand-written line naming its own handoff closes nothing. From the log, or from a fold's objects
// (openHandoffs), by one rule.
export const handledMessages = (objects = null) => {
  const xs = objects ? [...objects.values()].filter((o) => o.type === 'message' || o.type === 'question') : [...logObjects('message'), ...logObjects('question')];
  const handoffs = new Set(xs.filter((m) => m.type === 'message' && m.kind === 'handoff').map((m) => m.id));
  return new Set(xs.filter((x) => x.re && (!handoffs.has(x.re) || x.created_by === 'supervisor')).map((x) => x.re));
};

// What the owner saw: the question with every field it was asked with (later lines may only add
// the supervisor's status, reason and rating, and the owner's own fields). The rating (stake,
// urgency, settles, settles_if) orders the Inbox and is no part of what the owner decides, so the
// supervisor may rate again without reopening an answered question. The owner's answer records this
// hash, and an answer whose question no longer hashes the same answers nothing: the question was
// rewritten after the owner answered it (its line edited, or a backdated duplicate taking its
// place), so it is open again, and the owner answers what it says now.
export const QUESTION_RATING = ['stake', 'urgency', 'settles', 'settles_if'];
// A rating as the views and the order count it: 1, 2 or 3, else not rated. The log is checked in
// full only on write and in log-check, so a line written by hand could carry any number here, and
// the order multiplies what it reads: a stake of 99 would take the top of the Inbox.
export const ratingOf = (x) => ([1, 2, 3].includes(x) ? x : null);
// Every rating the question has carried: as asked, then each later rate. The fold keeps only the
// latest, and a rate can lower a question, so the card's ⋯ menu shows the trail.
export function ratingHistory(q) {
  const asked = Object.fromEntries(QUESTION_RATING.slice(0, 3).map((k) => [k, q.__asked && k in q.__asked ? q.__asked[k] : q[k]]));
  const entry = (at, by, r) => ({ at, by, ...(ratingOf(r.stake) ? { stake: r.stake } : {}), ...(ratingOf(r.urgency) ? { urgency: r.urgency } : {}), ...(Array.isArray(r.settles) ? { settles: r.settles.length } : {}) });
  const has = (e) => e.stake || e.urgency || e.settles !== undefined;
  return [{ ...entry(q.created_at, q.created_by, asked), asked: true }, ...q.updates.map((u) => entry(u.at, u.by, u))].filter(has);
}
// about_turn, seen, owner_said_turn and owner_said_at are written only when a question is asked and
// nobody may set them after (x-authority), so they're left out too: an older kit, which drops them
// as unknown, then hashes the question as this one does, and the owner's answer stands there. The
// owner's pick and the supervisor's reading of words (and its void) come after the answer.
export const QUESTION_LATER = ['status', 'reason', ...QUESTION_RATING, 'answer', 'said', 'turn', 'autonomy', 'standing_rule', 'secrets_posted', 'result', 'declined', 'question_hash', 'files', 'about_turn', 'seen', 'owner_said_turn', 'owner_said_at', 'said_at', 'answer_seen', 'choice', 'reading', 'reading_void', 'reading_withdrawn'];
export const questionHash = (q) => crypto.createHash('sha256').update(canonical(Object.fromEntries(Object.entries(q).filter(([k]) => !k.startsWith('__') && !['updates', 'created_at', 'created_by', 'channel', ...QUESTION_LATER].includes(k))))).digest('hex').slice(0, 16);

// A one-way-door question: asked --kind one-way-door, or asked in the owner-only class one-way-door
// whatever its kind (ask now records those as kind one-way-door; older lines may not). Only the
// question is classified here: what it approves is still the owner's own answer on the fold
// (questionView's status "answered", bound to the question's hash), never a default or a line the
// supervisor wrote, and the class is hashed, so setting it after the answer reopens the question.
export const isDoorQuestion = (v) => v?.kind === 'one-way-door' || v?.class === 'one-way-door';
// A door answer approves the plan built on the recommendation only as recommended: an owner who
// chose otherwise said no to that plan (their pick of a marked alternative approves the plan built on
// it instead: doorPick). A door asked with no recommendation is the owner's open choice.
export const doorAgreed = (v) => !v.recommendation || v.matched === true;
// The owner's own pick of another listed choice on a door, one the question marked "approves": true
// when it was asked: the label, or null. Only the owner's own pick counts: their choice on the card
// or answer --choice (a keyed choice, cli or dashboard, with no words beside it that could take it
// back), never an answer the supervisor recorded from chat or a turn, nor words it read. Picking a
// marked choice is the owner's yes to that choice, not a no to the plan; it approves the plan built
// on it once the plan and its approving review name it (DOOR_PICK_LINE).
export const doorPick = (v) => {
  if (v?.status !== 'answered' || doorAgreed(v)) return null;
  if (v.in_words !== false || typeof v.choice !== 'string' || String(v.words ?? '').trim()) return null;
  if (v.answered_by !== 'owner' || ['chat', 'thread'].includes(v.channel)) return null;
  const c = (v.choices ?? []).find((x) => isObj(x) && String(x.label ?? '').trim().toLowerCase() === v.choice.trim().toLowerCase());
  return c?.approves === true && !DECLINING_LABEL.test(String(c.label)) ? c.label : null;
};
// Only the owner's latest word on a door counts: a pick is undone once the same door was asked again
// (the same ticket and goal, nearly the same question, as ask's re-ask check reads it), while that
// re-ask is open, and once it is answered, whatever the answer; the re-ask is then the one to cite.
export const doorPickUndone = (v, all) => all.some((q) => q.id !== v.id && isDoorQuestion(q) && (q.ticket ?? null) === (v.ticket ?? null) && (q.goal ?? null) === (v.goal ?? null) && nearlySameQuestion(q.question, v.question) && String(q.asked_at ?? '') > String(v.asked_at ?? '') && (q.status === 'open' || q.status === 'answered'));
// The line a plan, and the plan review that approves it, carry for a pick: exactly
// "- One-way door <qid>: <choice>", the choice as labelled (case aside).
export const DOOR_PICK_LINE = /^-[ \t]*One-way door[ \t]+(q-\S+?):[ \t]*(.+?)[ \t]*$/gm;
export const doorPickNamed = (text, qid, pick) => [...String(text ?? '').matchAll(DOOR_PICK_LINE)].some((m) => m[1] === qid && m[2].trim().toLowerCase() === pick.trim().toLowerCase());
// A choice that declines reads as one: never marked "approves".
// A word list is never complete, so the plan reviewer checks too (quality.md §3); this catches the plain ones.
export const DECLINING_LABEL = /^\s*(no|nope|nah|not( now| yet)?|none|neither|don['’]?t|do not|do nothing|never|hold( off)?|wait|later|maybe( later)?|skip|decline|reject|cancel|stop|abort|revert|undo|pause|park( it)?|postpone|defer|delay|status quo|(keep|leave|stay)\b.*\b(as (it|they|things) (is|are|was|were|stand)|as is|unchanged|the same)|leave it)\b/i;

// Folded questions in the shape the inbox uses.
export function questionView(q) {
  const hash = questionHash(q);
  const last = q.updates.filter((u) => u.answer !== undefined && writerClass(u.by) === 'owner').pop();
  // An answer from before answers carried the hash (no question_hash) still counts, unless a
  // second line for the question exists: then nothing shows which one the owner saw.
  const rewritten = !!last && (last.question_hash ? last.question_hash !== hash : !!q.__duplicate);
  const ans = rewritten ? null : last;
  const st = q.updates.filter((u) => u.status !== undefined).pop();
  let status = 'open';
  let answer = null;
  let answeredBy = null;
  let answeredAt = null;
  if (ans) [status, answer, answeredBy, answeredAt] = ['answered', ans.answer, 'owner', ans.at];
  else if (st?.status === 'defaulted') [status, answer, answeredBy, answeredAt] = ['defaulted', q.default, 'supervisor (default)', st.at];
  else if (st?.status === 'withdrawn') [status, answeredAt] = ['withdrawn', st.at];
  const norm = (x) => String(x ?? '').trim().toLowerCase();
  // The labels an answer may pick, as the dashboard draws them: the choices, else the options, and
  // the recommendation when no label is it.
  const drawn = (q.choices ?? []).length ? q.choices.map((c) => c?.label) : q.options ?? [];
  const named = drawn.filter((l) => typeof l === 'string');
  const labels = q.recommendation && !named.some((l) => norm(l) === norm(q.recommendation)) ? [q.recommendation, ...named] : named;
  const inLabels = (x) => labels.find((l) => norm(l) === norm(x)) ?? null;
  // An answer line with a choice key says what the owner picked (null: words alone); a line
  // without one (older, or the terminal, chat or a turn) is read by its leading label.
  const keyed = !!ans && Object.hasOwn(ans, 'choice');
  const choice = keyed ? ans.choice : null;
  const words = !keyed ? null : choice === null ? ans.answer : ans.answer.startsWith(`${choice} — `) ? ans.answer.slice(choice.length + 3) : '';
  // Words alone count as a choice only through the supervisor's reading, which is checked here
  // rather than trusted: of this answer, in the question's class, of a label in the set, resting on
  // the owner's own words, and not voided by the owner or withdrawn by the supervisor. Only the
  // question's own lines are read (this runs inside the fold), so a void takes effect from its time on.
  const collapse = (x) => String(x).replace(/\s+/g, ' ').trim();
  const wordChar = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
  const wholeWords = (cite, text) => {
    const c = collapse(cite);
    const t = collapse(text);
    if (!c || [...c].length > 600) return false;
    for (let i = t.indexOf(c); i >= 0; i = t.indexOf(c, i + 1)) if (!wordChar(t.slice(0, i).match(/.$/su)?.[0]) && !wordChar(t.slice(i + c.length).match(/^./su)?.[0])) return true;
    return false;
  };
  const cancelled = (act) => q.updates.some((u) => (writerClass(u.by) === 'owner' && u.reading_void === act) || (writerClass(u.by) === 'supervisor' && u.reading_withdrawn === act));
  const counts = (r) => isObj(r) && ['choice', 'cite', 'class', 'of', 'act'].every((k) => typeof r[k] === 'string') && r.of === ans.at && !!inLabels(r.choice) && wholeWords(r.cite, ans.answer) && r.class === (q.class ?? q.kind) && !cancelled(r.act);
  const reading = keyed && choice === null ? q.updates.filter((u) => writerClass(u.by) === 'supervisor').map((u) => u.reading).find(counts) ?? null : null;
  // The answer's label as the label-reading checks take it: the pick, else a reading that counts.
  const label = keyed ? choice ?? (reading ? inLabels(reading.choice) : null) : answer === null ? null : String(answer).split(' — ')[0];
  // An answer agrees with the recommendation when it is that choice, with or without a note after
  // " — " (the dashboard sends "<label> — <note>"); a line with a choice key, when its label is.
  // Words alone never match until read, even when they say the recommendation.
  const agrees = (l) => !!q.recommendation && l !== null && norm(l) === norm(q.recommendation);
  let matched = !ans ? null : keyed ? agrees(label) : !!q.recommendation && [norm(ans.answer), norm(ans.answer.split(' — ')[0])].includes(norm(q.recommendation));
  // A review's recommendation is its proposals: it agrees only when the owner kept every one of
  // them, decided every row, and the result still verifies. Only the owner's lines count here.
  let review = null;
  if (q.kind === 'review' && q.review) {
    const own = q.updates.filter((u) => writerClass(u.by) === 'owner');
    const result = own.filter((u) => u.result !== undefined).pop()?.result ?? null;
    const declined = own.some((u) => u.declined === true);
    const resultStatus = reviewStatus(q, ans ? result : null, ans ? declined : false);
    review = { review: q.review, result: ans ? result : null, declined: ans ? declined : false, allow_partial: !!q.review.allow_partial, result_status: resultStatus };
    if (ans) matched = !review.declined && resultStatus === 'verified' && (result?.proposed ?? 0) > 0 && result.kept === result.proposed && result.undecided === 0;
  }
  // the owner's own agreement, for trust: a reading is the supervisor's, never the owner's
  const agreedByOwner = !ans ? null : keyed ? agrees(choice) : matched;
  return {
    id: q.id, kind: q.kind, class: q.class ?? null, scope: q.scope ?? null, ticket: q.ticket ?? null, re: q.re ?? null, sensor: q.sensor ?? null, thread: q.thread ?? null, asked_at: q.created_at,
    question: q.question, context: q.context ?? '', options: q.options ?? [], choices: q.choices ?? [], links: q.links ?? [], goal: q.goal ?? null, change: isObj(q.change) && Array.isArray(q.change.order) ? null : q.change ?? null, ...(isObj(q.change) && Array.isArray(q.change.order) ? { order: q.change.order } : {}), met: q.met ?? null, rule_scope: q.rule_scope ?? null, recommendation: q.recommendation ?? '', confidence: q.confidence ?? null,
    default: q.default ?? null, deadline: q.deadline ?? null, blocks: q.blocks ?? [], stake: ratingOf(q.stake), urgency: ratingOf(q.urgency), settles: Array.isArray(q.settles) ? q.settles.filter((x) => typeof x === 'string') : [], settles_if: typeof q.settles_if === 'string' ? q.settles_if : null, settles_label: [...(q.choices ?? []).map((c) => c?.label), ...(q.options ?? [])].find((l) => sameAnswer(l, q.settles_if)) ?? null, rating_history: ratingHistory(q), approves: q.approves ?? [], evidence: q.evidence ?? [], note: q.note ?? null, new_because: q.new_because ?? null, no_default: q.no_default ?? null, why_asked: q.why_asked ?? null,
    secrets: (q.secrets ?? []).map((x) => ({ ...x, to: sinkWords(x.sink), sink_type: SINK_RE.exec(x.sink ?? '')?.[1] ?? null, warning: sinkWarning(x.sink) })), secrets_posted: q.updates.filter((u) => u.secrets_posted !== undefined && writerClass(u.by) === 'owner').pop()?.secrets_posted ?? [],
    status, answer, answered_by: answeredBy, answered_at: answeredAt, matched, hash, rewritten,
    // which of the box's people answered (kit-252): only a well-formed one (personOk), else nobody named
    answered_person: ans && personOk(ans.person) ? { id: ans.person.id, name: ans.person.name } : null,
    labels, choice, words, in_words: keyed ? choice === null : null, label, reading, read_by: reading ? 'supervisor' : null, agreed_by_owner: agreedByOwner,
    autonomy: ans ? (q.autonomy ?? null) : null, standing_rule: ans ? (q.standing_rule ?? null) : null, channel: ans?.channel ?? null, files: ans && Array.isArray(ans.files) ? ans.files.filter(isObj).map((f) => ({ name: String(f.name ?? ''), path: String(f.path ?? ''), bytes: Number.isInteger(f.bytes) ? f.bytes : 0 })) : [], said: ans?.said ?? null, turn: ans?.turn ?? null, said_at: ans?.said_at ?? null, answer_seen: ans?.answer_seen ?? null,
    about_turn: q.about_turn ?? null, seen: q.seen ?? null, owner_said_turn: q.owner_said_turn ?? null, owner_said_at: q.owner_said_at ?? null,
    review: review?.review ?? null, result: review?.result ?? null, declined: review ? review.declined : null, allow_partial: review ? review.allow_partial : null, result_status: review?.result_status ?? null,
  };
}
// The inbox's view: each question with its goal's hold (never inside questionView, which the fold uses).
// A link item that names a registry link shows its kind's locator: a url link's url, a repo link's remote.
// An artifact link says where it opens now (an open question's only: each costs reads). Always on
// a copy, never the folded question's own link: its hash covers the links as asked.
export const resolveQuestionLinks = (ls, open = false) => { const reg = loadSettings().links ?? {}; return (ls ?? []).map((l) => { if (isObj(l) && l.preview !== undefined) return previewLinkNow(l); if (isObj(l) && l.artifact !== undefined) return open ? artifactLinkNow(l) : { ...l, href: null, changed: false, gone: false }; const r = l?.link ? ownEntry(reg, l.link) : null; const K = r ? LINK_KINDS[r.kind] : null; if (!K) return redactLink(l); const { text, ...where } = K.locator(r, l.link); return redactLink({ ...l, ...where }); }); };
// A preview link as this machine has it now: its port and state, never stored in the question.
export function previewLinkNow(l) {
  const r = readPreviews().find((x) => x.name === l.preview);
  if (!r) return { ...l, port: null, state: 'gone' };
  const up = previewUpHere()[r.name] ?? null;
  return { ...l, port: r.port, state: up === null ? 'checking' : up ? 'live' : 'down' };
}
// Where it was asked, while that source is there; else main, once it landed (with no notice if it
// landed as asked); else gone. changed: its files no longer hash to what the owner was asked about.
export function artifactLinkNow(l) {
  const src = artifactSource(l.at, l.artifact);
  const landed = !src && l.at !== 'main' ? artifactSource('main', l.artifact) : null;
  const at = src ? l.at : landed ? 'main' : null;
  const fp = src ? fingerprint(src.entries) : landed ? fingerprint(landed.entries) : null;
  const href = at === 'main' ? `#artifact/main/${l.artifact}` : at ? `#artifact/wt/${at}/${l.artifact}` : null;
  return { ...l, href, changed: !!at && !!l.sha256 && fp !== l.sha256, gone: !at };
}
// Why an answer to q can't bind to the artifacts it links (null when it can): a page that changed
// since it was asked, or that is no longer there, is not what the owner was asked about, so the
// owner's answer would approve something they didn't see. Checked when the owner answers and again
// when an answer is used to approve something. A caller that already resolved v's links
// (artifactLinkNow) passes them as now, so they are read once.
export const pinnedArtifact = (l) => isObj(l) && l.artifact !== undefined && l.sha256;
export function artifactLinksMoved(v, now = (v.links ?? []).filter(pinnedArtifact).map(artifactLinkNow)) {
  now = now.filter(pinnedArtifact);
  const changed = now.filter((l) => l.changed).map((l) => l.artifact);
  const gone = now.filter((l) => l.gone).map((l) => l.artifact);
  if (changed.length) return `${v.id} links the artifact ${changed.join(', ')}, which changed since it was asked; ask again about the page as it is now`;
  if (gone.length) return `${v.id} links the artifact ${gone.join(', ')}, which is no longer available; ask again`;
  return null;
}
// Once per read of the log (memo): a refresh asked for every question's view dozens of times. A new
// array each call, so a caller's sort never reorders another's. links_moved: why answer would refuse
// an open question (null otherwise, or when nothing moved), from the links resolved here.
export const questions = () => [...memo('questions', () => questionsNow())];
export const questionsNow = () => logObjects('question').map((q) => { const v = questionView(q); const links = resolveQuestionLinks(v.links, v.status === 'open'); return { ...v, links, links_moved: v.status === 'open' ? artifactLinksMoved(v, links) : null, goal_hold: questionHold(q), ...(v.thread ? { thread_title: logGet(v.thread)?.title ?? null } : {}), ...turnThread(v.turn) }; });
// Where an answer from a thread was said: the cited turn's thread, which for an Inbox question is
// none of its own, so the answered card can link the owner to the words it used.
export function turnThread(uid) {
  const u = typeof uid === 'string' ? logGet(uid) : null;
  if (u?.type !== 'turn' || typeof u.thread !== 'string') return {};
  return { turn_thread: u.thread, turn_thread_title: logGet(u.thread)?.title ?? null };
}

// Why question q does not authorise the supervisor to change goal goalId (null when it does): it
// is a goal-change question about that goal, answered by the owner with its recommendation (an
// answer other than the recommendation declines or alters the change, so the supervisor asks again).
// The goal fields a goal-change question may propose, and that its answer then authorises exactly.
export const GOAL_CHANGE_FIELDS = ['title', 'outcome', 'measure', 'horizon', 'non_goals', 'preconditions', 'registry_precondition', 'priority', 'milestones', 'plan_after'];
export const goalFieldsOf = (l) => Object.fromEntries(Object.entries(l).filter(([k]) => GOAL_CHANGE_FIELDS.includes(k)));
export function goalChangeProblem(q, goalId, qid, l = null) {
  const v = q?.type === 'question' ? questionView(q) : null;
  if (!v) return `${qid} is not a question`;
  if (v.class !== 'goal-change') return `${v.id} was asked in class ${v.class ?? '(none)'}, not goal-change`;
  if (v.goal !== goalId) return `${v.id} is about ${v.goal ?? 'no goal'}, not ${goalId} (ask with --goal ${goalId})`;
  // A question asked before the exact-change rule (ask has required --change on these since) is
  // an earlier answer: the supervisor carries it forward with the change it says the owner chose,
  // logged as a carry-answer act the owner can correct, rather than asking the same thing again.
  const legacy = !v.change || !Object.keys(v.change).length;
  if (legacy && !(l && l.carried)) return `${v.id} carries no change; carry the owner's earlier answer forward with goal set --approved ${v.id} --change '{…}'`;
  if (v.status !== 'answered') return `${v.id} is not answered by the owner (${v.status})`;
  if (!v.matched) return `${v.id} was answered "${v.answer}", not its recommendation${v.recommendation ? ` ("${v.recommendation}")` : ''}; ask again for the change the owner wants`;
  // the owner approved this change and no other: the set must be exactly it
  if (l && !legacy && canonical(goalFieldsOf(l)) !== canonical(v.change)) return `the set (${Object.keys(goalFieldsOf(l)).join(', ') || 'nothing'}) is not the change ${v.id} proposed`;
  return null;
}

// The goal order (planning.md §1, priority is the owner's): the goals named take priority 1..n in
// that order, and the live goals left out keep their relative place after them. goals: the goal
// objects as they stand (the log's, or the fold's at one line), Upkeep among them or not.
export const orderableGoal = (g) => g?.type === 'goal' && g.kind !== 'upkeep' && !['met', 'abandoned'].includes(g.status ?? 'draft');
// Why ids can't be ordered (null when they can): each a goal, named once, live, not Upkeep.
export function goalOrderRefusal(ids, goals) {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const seen = new Set();
  for (const id of ids) {
    const g = byId.get(id);
    if (seen.has(id)) return `${id} is named more than once`;
    seen.add(id);
    if (!g || g.type !== 'goal') return `no goal ${id}`;
    if (g.kind === 'upkeep') return 'Upkeep has no place in the goal order';
    if (g.status === 'met') return `${id} is met`;
    if (g.status === 'abandoned') return `${id} is let go`;
  }
  return null;
}
// The lines an order writes: every goal named, at its place; then each live goal left out that has
// a priority, numbered after them in its current order, only where its number changes.
export function goalOrderPlan(ids, goals) {
  const plan = ids.map((id, i) => ({ id, priority: i + 1 }));
  const rest = goals.filter((g) => orderableGoal(g) && !ids.includes(g.id) && typeof g.priority === 'number').sort((a, b) => a.priority - b.priority || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  rest.forEach((g, j) => { if (g.priority !== ids.length + j + 1) plan.push({ id: g.id, priority: ids.length + j + 1 }); });
  return plan;
}
// Why the supervisor's line l on goal obj is not the owner's answer to order question q (null when
// it is): q is a goal-change question proposing an order, answered by the owner with its
// recommendation; l sets only priority, to the goal's place in that order's plan, once. The plan is
// made once per answer, at its first line, from the goals as they stood then (made by that time, not
// the fold's later ones); plans keeps it, and the goals already set under it.
export function goalOrderProblem(q, obj, l, plans, objects, appliedAt) {
  const v = questionView(q);
  if (v.class !== 'goal-change' || !v.order || v.order.length < 2) return `${v.id} proposes no goal order`;
  if (v.status !== 'answered') return `${v.id} is not answered by the owner (${v.status})`;
  if (!v.matched) return `${v.id} was answered "${v.answer}", not its recommendation ("${v.recommendation}")`;
  const shown = orderContextProblem(v, [...objects.values()].filter((o) => o.type === 'goal'));
  if (shown) return shown;
  // the answer is used once its act is written: a line after that is not part of applying it
  if (appliedAt.has(v.id) && appliedAt.get(v.id) < l.at) return `${v.id} was applied already`;
  const set = Object.keys(l).filter((k) => !ENVELOPE.includes(k) && !k.startsWith('__') && k !== 'approved');
  if (set.length !== 1 || set[0] !== 'priority') return `an order sets priority and nothing else (this sets ${set.join(', ') || 'nothing'})`;
  if (!plans.has(v.id)) {
    const goals = [...objects.values()].filter((o) => o.type === 'goal' && o.created_at <= l.at);
    const why = goalOrderRefusal(v.order, goals);
    plans.set(v.id, { why, plan: why ? null : new Map(goalOrderPlan(v.order, goals).map((p) => [p.id, p.priority])), done: new Set() });
  }
  const p = plans.get(v.id);
  if (p.why) return p.why;
  if (!orderableGoal(obj)) return obj.kind === 'upkeep' ? 'Upkeep has no place in the goal order' : `${obj.id} is ${obj.status === 'met' ? 'met' : 'let go'}`;
  if (!p.plan.has(obj.id)) return `the order leaves ${obj.id} where it is`;
  if (p.done.has(obj.id)) return `${v.id} already set ${obj.id}'s place`;
  if (l.priority !== p.plan.get(obj.id)) return `${obj.id}'s place in that order is ${p.plan.get(obj.id)}, not ${l.priority}`;
  p.done.add(obj.id);
  return null;
}
// Why order question v doesn't show the owner the order it proposes (null when it does): its context
// ends with exactly the list the kit writes for change.order (goalOrderText), each goal titled as it
// was when the question was asked. The owner's Yes is to what they read; a question whose list and
// order differ in an id, a title, a line or a word after it (a line written by hand) approves nothing.
export function orderContextProblem(v, goals) {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const shown = goalOrderText(v.order, (id) => goalTitleAt(byId.get(id), v.asked_at) ?? id);
  const ctx = String(v.context ?? '');
  // one list only: another before the kit's would show the owner two orders
  if (ctx.slice(0, Math.max(0, ctx.length - shown.length)).includes('The order proposed:')) return `${v.id}'s context shows another list before the kit's`;
  return ctx === shown || ctx.endsWith(`\n\n${shown}`) ? null : `${v.id}'s context doesn't end with the kit's list of the order it proposes (${v.order.join(' ')}), titled as the goals were when it was asked`;
}
// A goal's title at time at: its latest title set by then, else the title it was made with.
export function goalTitleAt(g, at) {
  if (!g) return null;
  const u = g.updates.filter((x) => x.title !== undefined && x.at <= at).pop();
  return u ? u.title : (g.__bornTitle ?? g.title);
}
// The supervisor applying the owner's answer to a goal-change --order question: exactly the order
// it proposed (ids, when given, must be it), once, on goals still live.
export function goalOrderApproved(qid, ids) {
  supervisorOnly('goal order --approved');
  const q = logGet(qid);
  if (q?.type !== 'question') die(`goal order --approved: ${qid} is not a question`);
  const v = questionView(q);
  if (v.class !== 'goal-change' || !v.order || v.order.length < 2) die(`goal order --approved: ${qid} proposes no order (a one-goal change is goal set <g-id> --approved ${qid})`);
  if (v.status !== 'answered') die(`goal order --approved: ${qid} is not answered by the owner (${v.status})`);
  if (!v.matched) die(`goal order --approved: ${qid} was answered "${v.answer}", not its recommendation ("${v.recommendation}"); ask again for the order the owner wants`);
  const shown = orderContextProblem(v, readLog().byType.get('goal') ?? []);
  if (shown) die(`goal order --approved: ${shown}; ask again`);
  if ((readLog().byType.get('goal') ?? []).some((g) => g.updates.some((u) => u.approved === qid)) || calls().some((a) => a.approved_by === qid)) die(`goal order --approved: ${qid} already authorised a change; ask again for another`);
  if (ids.length && canonical(ids) !== canonical(v.order)) die(`goal order --approved: ${ids.join(' ')} is not the order ${qid} proposed (${v.order.join(' ')}); give none to apply it`);
  const why = goalOrderRefusal(v.order, readLog().byType.get('goal') ?? []);
  if (why) die(`goal order --approved: ${why}, so the order ${qid} proposed can't be applied as approved; ask again`);
  return out(applyGoalOrder(v.order, 'supervisor', qid));
}
// The order written: one goal line per planned goal, then one act: the owner's own record of it
// (goal-order, never a call), or the supervisor's applying the owner's answer (goal-change, the
// owner-only class the answer was asked in, with approved_by).
export function applyGoalOrder(ids, by, approved = null) {
  const goals = [...(readLog().byType.get('goal') ?? [])];
  const plan = goalOrderPlan(ids, goals);
  for (const p of plan) appendLog({ type: 'goal', op: 'set', id: p.id, priority: p.priority, ...(approved ? { approved } : {}) }, by);
  const title = (id) => goals.find((g) => g.id === id)?.title ?? id;
  appendLog({ type: 'act', class: by === 'owner' ? 'goal-order' : 'goal-change', what: `${approved ? `applied ${approved}: ` : ''}put the goals in order: ${ids.map((id, i) => `${i + 1}. ${title(id)}`).join(', ')}${plan.length > ids.length ? '; the rest after them, in their order' : ''}`, refs: plan.map((p) => p.id), reversible: true, ...(approved ? { approved_by: approved } : {}) }, by);
  logCache = null;
  return ids.map((id, i) => `${i + 1} ${id} ${title(id)}`).join('\n');
}

// The owner's own standing rule for a class (scope class:<cls>, accepted, written by the owner):
// the latest one, from the Inbox, a terminal or chat alike (answer --from-chat --rule).
export const ownerRuleFor = (cls) => logObjects('knowledge').filter((k) => writerClass(k.created_by) === 'owner' && k.scope === `class:${cls}` && k.status === 'accepted').sort(byTime).pop() ?? null;
// The correction on an act, with who made it and when.
// The supervisor's calls: its decisions, and the acts that are their own decision (no decision
// field: mechanical acts, and acts logged before decisions existed). Trust is earned and lost on
// these. An owner's act (artifact-publish) is a record of what the owner did, never a call, and
// nor is the tick's tidy of a finished worktree (tidyFinishedWorktrees), which only follows a merge.
export const isTidyAct = (a) => a.class === 'worker-slots' && String(a.what ?? '').startsWith('removed worktree ');
export const calls = () => [...logObjects('decision'), ...logObjects('act').filter((a) => !a.decision && a.created_by !== 'owner' && !isTidyAct(a))];
export const correctionOf = (a) => {
  const u = a.updates.filter((x) => x.corrected !== undefined).pop();
  // a repair answers the correction before it: one newer than the latest repair is unrepaired
  const r = a.updates.filter((x) => x.repaired !== undefined).pop();
  return u ? { ...u.corrected, by: u.by, at: u.at, channel: u.channel ?? null, repaired: r && r.at >= u.at ? a.repaired ?? null : null } : null;
};
// How much a goal matters to the project, 1 to 4: the supervisor's judgment against
// project/strategy.md (a goal-impact decision whose first ref is the goal; the latest one), or the
// value the owner gave when correcting one, which stands until the owner gives another. Computed
// here, never stored on the goal. A decision corrected with no value (a retro's) keeps its level
// until the supervisor judges again: a correction never drops a goal back to the unjudged 2.
export const IMPACT_WORDS = { 4: 'the project depends on it', 3: 'moves a number the project watches', 2: 'worth having', 1: 'housekeeping' };
// 1 to 4, else no impact: a line written by hand could carry any value, and "constructor" is a key of every object.
export const impactOf = (x) => ([1, 2, 3, 4].includes(x) ? x : null);
export const goalImpacts = () => memo('goalImpacts', () => {
  const by = new Map();
  for (const d of logObjects('decision').filter((x) => x.class === 'goal-impact' && impactOf(x.impact) && x.refs?.[0]).sort(byTime)) (by.get(d.refs[0]) ?? by.set(d.refs[0], []).get(d.refs[0])).push(d);
  const res = new Map();
  for (const [goal, ds] of by) {
    const o = ds.map((d) => ({ d, c: correctionOf(d) })).filter((x) => x.c && writerClass(x.c.by) === 'owner' && impactOf(x.c.impact)).sort((a, b) => a.c.at.localeCompare(b.c.at)).pop();
    const last = ds[ds.length - 1];
    const c = correctionOf(last);
    res.set(goal, o
      ? { level: o.c.impact, words: IMPACT_WORDS[o.c.impact], by: 'owner', rationale: o.c.reason, decision: o.d.id, at: o.c.at, rejudge: false }
      : { level: last.impact, words: IMPACT_WORDS[last.impact], by: 'supervisor', rationale: last.rationale ?? null, decision: last.id, at: last.created_at, rejudge: !!c, ...(c ? { correction: c.reason } : {}) });
  }
  return res;
});
export const goalImpact = (id) => goalImpacts().get(id) ?? null;

// --- the log rule for a PR: which log files it may touch, and only by appending valid lines ---
// base..sha may change project/log/<X>.jsonl only if X is the branch's own planner file (plan/<f>)
// or the branch is chore-log (any file but plan-*). Existing lines never change; new lines are
// valid, in time order, in their month, and not in the future.
export function logRule(headRef, sha, R = repo('home')) {
  if (!commonDir) return [];
  // another repo has no log: its project folder holds only tickets/ (the log lives in home)
  if (R.name !== 'home') {
    const base = R.mainRef() ? R.git(['merge-base', R.mainRef(), sha]) : null;
    if (!base) return [`cannot resolve the merge base with ${R.name}'s main; its project folder not checked`];
    return R.changedFiles(base, sha).filter((f) => f.startsWith(`${R.projectRel}/`) && !f.startsWith(`${R.projectRel}/tickets/`)).map((f) => `${f}: ${R.projectRel} in another repo holds only tickets/ (the log, settings and designs live in home)`);
  }
  if (!projectInRepo) return [];
  const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
  if (!base) return ['cannot resolve the merge base with main; log changes not checked'];
  const prefix = `${projectRel}/log/`;
  const changed = (git(['diff', '--name-only', '--no-renames', base, sha]) ?? '').split('\n').filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
  const fails = [];
  const branch = headRef.replace(/^refs\/heads\//, '');
  const allowed = (name) => (branch === LOG_BRANCH ? !isPlanFile(name) : branch.startsWith('plan/') ? name === `plan-${branch.slice('plan/'.length)}.jsonl` : false);
  for (const name of changed) {
    if (name.includes('/') || !name.endsWith('.jsonl')) { fails.push(`project/log/${name}: the log holds only <writer>.jsonl files`); continue; }
    if (!allowed(name)) { fails.push(`project/log/${name}: this PR may not change it (only chore-log, or a plan/<feature> PR for its own plan-<feature>.jsonl)`); continue; }
    const before = git(['show', `${base}:${prefix}${name}`]);
    const after = git(['show', `${sha}:${prefix}${name}`]);
    if (after === null) { fails.push(`project/log/${name}: log files are never deleted`); continue; }
    const prev = before === null ? '' : `${before}\n`;
    const next = `${after}\n`;
    if (!next.startsWith(prev)) { fails.push(`project/log/${name}: existing lines were changed or removed`); continue; }
    const added = parseLines(next.slice(prev.length), name, { firstLine: prev.split('\n').filter(Boolean).length + 1 });
    fails.push(...added.errors.map((e) => `added ${e}`));
    const lastAt = (t) => t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l).at ?? ''; } catch { return ''; } }).pop() ?? '';
    let prevAt = lastAt(prev);
    const month = name.match(/-(\d{4}-\d{2})\.jsonl$/)?.[1] && MONTHLY.test(name.replace(/\.jsonl$/, '')) ? name.match(/-(\d{4}-\d{2})\.jsonl$/)[1] : undefined;
    if (before === null) {
      // Siblings are the same writer's earlier files of the same stream: a planner writes its plan
      // file (graph lines, landed by its plan PR) and its monthly files (the rest, by log-sync) at
      // the same time, so one is never ordered after the other.
      const siblings = (git(['ls-tree', '--name-only', `${base}:${prefix.slice(0, -1)}`]) ?? '').split('\n').filter((x) => x && x !== name && writerOfFile(x) === writerOfFile(name) && isPlanFile(x) === isPlanFile(name));
      for (const sib of siblings) prevAt = [prevAt, lastAt(`${git(['show', `${base}:${prefix}${sib}`]) ?? ''}\n`)].sort().pop();
    }
    const committedAt = Date.parse(git(['show', '-s', '--format=%cI', sha]) ?? '');
    // every added line's time, a newer kit's included (parseLines leaves those out of lines): one
    // in the future would fail every later sync of this append-only file
    const start = prev.split('\n').filter(Boolean).length + 1;
    const stamped = next.slice(prev.length).split('\n').filter(Boolean).map((raw, i) => { try { const at = JSON.parse(raw)?.at; return typeof at === 'string' ? { at, __line: start + i } : null; } catch { return null; } }).filter(Boolean);
    for (const l of stamped) {
      if (month && !l.at.startsWith(month)) fails.push(`project/log/${name}:${l.__line}: ${l.at} is not in ${month}`);
      if (l.at < prevAt) fails.push(`project/log/${name}:${l.__line}: ${l.at} is earlier than the line before it`);
      if (!Number.isNaN(committedAt) && Date.parse(l.at) > committedAt + 5 * 60000) fails.push(`project/log/${name}:${l.__line}: ${l.at} is after the commit time`);
      prevAt = l.at;
    }
  }
  return fails;
}

// --- the review rule for a PR: the owner's results and the files they answered on never change ---
// A result.json the PR adds or changes (project/questions/<qid>/, or a ticket's questions/<qid>/)
// hashes to result.sha256 on the owner's answer line for <qid>. A file a review question pins
// (page, data, result schema) that the PR changes either is absent at the head or still hashes to
// its question line, while that question is open or answered (a page sent back or withdrawn may be
// redrawn in place before it lands). Once a pinned file or a result is on main, as the merge base
// holds it, it never changes and is never deleted, whatever its question's status.
export function reviewRule(sha, { forge = false, repo: R = repo('home') } = {}) {
  // review questions are home's: another repo's PR carries no review result
  if (!commonDir || !projectInRepo || R.name !== 'home') return [];
  const base = mainRef() ? git(['merge-base', mainRef(), sha]) : null;
  if (!base) return []; // logRule says so
  const changed = (git(['diff', '--name-status', '--no-renames', base, sha]) ?? '').split('\n').filter(Boolean).map((l) => l.split('\t'));
  const touched = new Set(changed.map(([, f]) => f));
  const fails = [];
  const reviews = logObjects('question').filter((q) => q.kind === 'review' && q.review);
  const byId = new Map(reviews.map((q) => [q.id, q]));
  const how = `Copy it with \`review result <qid> --commit\` in the worktree of the PR that asked, never by hand`;
  for (const [st, f] of changed) {
    const qid = reviewResultPath(f);
    if (!qid) continue;
    if (st === 'D') { fails.push(`${f}: the owner's answer to ${qid} is on main; a landed review file is never deleted`); continue; }
    const q = byId.get(qid);
    const v = q ? questionView(q) : null;
    const buf = gitBlob(sha, f);
    const logHint = forge ? '; if the owner has answered since, land the log (log-sync, then merge --chore log) and run the check again' : '';
    const why = !v ? `${qid} is not a review question in the log${logHint}`
      : v.declined ? `${qid} was sent back, so it has no result`
      : v.status !== 'answered' || !v.result?.sha256 ? `${qid} is ${v.status}, with no owner result${logHint}`
      : buf === null || sha256(buf) !== v.result.sha256 ? `it hashes to ${buf === null ? 'nothing' : sha256(buf).slice(0, 12)}, and the owner's answer line names ${v.result.sha256.slice(0, 12)}`
      : null;
    if (why) fails.push(`${f} is not the owner's answer to ${qid}: ${why}. ${how.replace('<qid>', qid)}`);
  }
  // one message per pinned path, naming every question it breaks
  const broken = new Map();
  for (const q of reviews) {
    const v = questionView(q);
    const live = (v.status === 'open' || v.status === 'answered') && !v.declined;
    for (const [role, f] of [['page', q.review.page], ['data', q.review.data], ['result schema', q.review.result_schema]]) {
      if (!f?.path || !f.sha256 || !touched.has(f.path)) continue;
      const before = gitBlob(base, f.path);
      const after = gitBlob(sha, f.path);
      const landed = before !== null && sha256(before) === f.sha256;
      if (landed ? after !== null && sha256(after) === f.sha256 : !live || after === null || sha256(after) === f.sha256) continue;
      const k = `${f.path}\0${role}`;
      if (!broken.has(k)) broken.set(k, { path: f.path, role, landed, deleted: after === null, qs: [] });
      broken.get(k).qs.push(`${q.id} (${v.declined ? 'sent back' : v.status})`);
    }
  }
  for (const b of broken.values()) fails.push(`${b.path} is pinned as the ${b.role} of ${b.qs.join(', ')}${b.landed ? ', and is on main' : ''}; it ${b.deleted ? 'is never deleted' : 'never changes'}. Put a new ${b.role} at a new path and ask a new question`);
  return fails;
}

export const LOG_BRANCH = 'chore-log';

// Mirror run/log into project/log on branch chore-log, in its own worktree, and open or update the
// log-only PR. Run it every tick (it pushes); merge it daily with `merge --chore log`.
export function cmdLogSync() {
  supervisorOnly('log-sync');
  if (!commonDir || !projectInRepo) die('log-sync needs a git checkout with the project folder inside it');
  if (repoRoot !== mainRoot) die(`run log-sync from the main checkout (${mainRoot})`);
  const live = liveLogDir();
  const files = fs.existsSync(live) ? fs.readdirSync(live).filter((f) => f.endsWith('.jsonl') && !isPlanFile(f)).sort() : [];
  if (!files.length) return out('nothing in run/log to sync');
  const wt = choreWorktree('log', { reset: true });
  // An existing chore-log is extended, never rebuilt, so every push fast-forwards: forges that
  // refuse non-fast-forward pushes or branch deletion (branch rulesets, protected branches) accept
  // it, whether its PR is still open or was squash-merged and the branch kept. The extended branch
  // takes main in by a merge (still a fast-forward for the branch), so its PR is never behind and
  // carries only lines main doesn't have. A branch deleted on the forge leaves a stale
  // origin/chore-log, dropped here, and the sync starts from main. Only origin saying so drops it
  // (kit-884): a fetch that fails for any other reason (origin refused, a sibling's half-made
  // worktree entry past fetchPastHalfMade's wait) keeps it, and the sync goes on from it while
  // origin's chore-log is still that commit, or stops: started from main, its push would be refused.
  const main = loadSettings().main_branch;
  if (!flags['dry-run']) {
    const remote = `refs/remotes/origin/${LOG_BRANCH}`;
    const f = fetchPastHalfMade(['fetch', '--quiet', 'origin', `+refs/heads/${LOG_BRANCH}:${remote}`]);
    if (f.status !== 0) {
      const why = firstLine(f.err) || `exit ${f.status}`;
      // ls-remote matches a pattern against the end of a ref's name, so only the exact name counts
      const ls = gitRun(['ls-remote', '--exit-code', 'origin', `refs/heads/${LOG_BRANCH}`]);
      const theirs = ls.status === 0 ? ls.out.split('\n').map((l) => l.split('\t')).find(([, name]) => name === `refs/heads/${LOG_BRANCH}`)?.[0] ?? null : null;
      const kept = resolveCommit(remote);
      // origin answered without the branch (exit 2, or only a ref whose name ends in it): gone
      if (ls.status === 2 || (ls.status === 0 && !theirs)) git(['update-ref', '-d', remote]);
      else if (ls.status !== 0) die(`couldn't fetch ${LOG_BRANCH} from origin (${why}) or ask origin for it (${firstLine(ls.err) || `exit ${ls.status}`}): kept origin/${LOG_BRANCH} and synced nothing; run log-sync again`);
      else if (theirs !== kept) die(`couldn't fetch ${LOG_BRANCH} from origin (${why}), and origin's is at ${theirs.slice(0, 12)}, ${kept ? `not ${kept.slice(0, 12)}` : 'with no copy here'}: kept origin/${LOG_BRANCH} and synced nothing; run log-sync again`);
      else warn(`couldn't fetch ${LOG_BRANCH} from origin (${why}); origin's is still at ${kept.slice(0, 12)}, so this sync goes on from it`);
    }
  }
  // each checkout, merge and abort with -c core.useReplaceRefs=false (kit-778): a replace ref or core.useReplaceRefs any session can set would otherwise swap the tree checked out
  if (resolveCommit(`origin/${LOG_BRANCH}`)) {
    gitOrDie(['-c', 'core.useReplaceRefs=false', 'checkout', '--quiet', '-B', LOG_BRANCH, `origin/${LOG_BRANCH}`], wt);
    const base = resolveCommit(`origin/${main}`) ? `origin/${main}` : main;
    if (git(['-c', 'core.useReplaceRefs=false', 'merge', '--quiet', '--no-edit', '-m', `chore-log: merge ${main}`, base], wt) === null) {
      git(['-c', 'core.useReplaceRefs=false', 'merge', '--abort'], wt);
      gitOrDie(['-c', 'core.useReplaceRefs=false', 'checkout', '--quiet', '-B', LOG_BRANCH, base], wt);
      warn(`${LOG_BRANCH} could not take in ${main}; rebuilt from ${main}, so this push needs the forge to allow replacing ${LOG_BRANCH}`);
    }
  }
  const dest = path.join(wt, projectRel, 'log');
  fs.mkdirSync(dest, { recursive: true });
  let changed = 0;
  const notable = [];
  for (const f of files) {
    let liveText = withLock(path.join(live, f), () => fs.readFileSync(path.join(live, f), 'utf8'));
    liveText = liveText.slice(0, liveText.lastIndexOf('\n') + 1);
    const target = path.join(dest, f);
    const cur = readText(target) ?? '';
    if (cur === liveText || cur.startsWith(liveText)) continue;
    let next = liveText;
    if (!liveText.startsWith(cur)) {
      const have = new Set(cur.split('\n'));
      const extra = liveText.split('\n').filter((l) => l && !have.has(l));
      if (!extra.length) continue;
      warn(`run/log/${f} and main diverged; appending ${extra.length} live line(s) after main's`);
      next = cur + extra.map((l) => `${l}\n`).join('');
    }
    // A file with an invalid line stays behind (the fold already ignores the line; check-pr would
    // refuse the whole sync); the rest still land.
    const added = parseLines(next.slice(cur.length), f, { firstLine: cur.split('\n').filter(Boolean).length + 1 });
    if (added.errors.length) { warn(`run/log/${f} not synced: ${added.errors[0]}${added.errors.length > 1 ? ` (+${added.errors.length - 1} more; devteam.mjs log-check)` : ''}`); continue; }
    for (const l of added.lines) {
      if (l.op === 'set' && ['ticket', 'feature', 'goal', 'question'].includes(l.type) && l.by !== 'owner') notable.push(`${l.by} set ${l.type} ${l.id}: ${Object.keys(l).filter((k) => !ENVELOPE.includes(k) && !k.startsWith('__')).join(', ')}`);
      if (l.op === 'new' && ['ticket', 'feature'].includes(l.type)) notable.push(`${l.by} added ${l.type} ${l.id}`);
    }
    fs.writeFileSync(target, next);
    changed++;
  }
  if (!changed) return out('project/log is up to date');
  if (flags['dry-run']) return out(`${changed} file(s) would be synced`);
  const stamp = nowIso();
  gitOrDie(['add', path.join(projectRel, 'log')], wt);
  gitOrDie(['commit', '--quiet', '-m', `chore-log: log through ${stamp}`], wt);
  gitOrDie(['push', '--quiet', 'origin', `${LOG_BRANCH}:${LOG_BRANCH}`], wt);
  const body = `Mirrors run/log into project/log. Append-only; \`devteam.mjs check-pr\` verifies every added line.${notable.length ? `\n\nChanges to plans, goals and questions by non-owners in this sync:\n${notable.slice(0, 40).map((n) => `- ${n}`).join('\n')}` : ''}`;
  const pr = openPr(wt, LOG_BRANCH, `chore-log: log through ${dateOnly(stamp)}`, body);
  out(`synced ${changed} file(s) to ${LOG_BRANCH}${pr ? `: ${pr}` : ''}`);
}

// Validate every line (live and durable) and list what the fold ignored.
// A second line for a question replaces it if backdated, and a question changed after the owner
// answered it has lost that answer (questionView): both are the log being rewritten.
// The rewritten question fails until the owner answers what it says now; the leftover line then
// warns (the log is append-only, so it can't be removed).
export function questionRewrites() {
  const errors = [];
  const warnings = [];
  for (const q of logObjects('question')) if (questionView(q).rewritten) errors.push(`${q.id}: the question changed after the owner answered it, so that answer no longer counts and it is open again`);
  for (const i of readLog().ignored) if (i.line.type === 'question' && i.why === 'duplicate id') warnings.push(`${i.line.id}: a second question line with this id (${i.line.__file}:${i.line.__line}); a question is asked once`);
  return { errors, warnings };
}
// Fill a finding's Disposition cell in a review record, keeping the row the header's width: the
// author's way to answer a finding without hand-editing the table (a hand-added cell makes a row a
// reviewer reads as malformed). Only a cell that holds no disposition yet can be filled, as
// fillInOnly allows, so a filled record still holds the verdicts after it. A row that isn't its
// header's width (an unescaped "|" in a cell splits it; a cell left out narrows it) is refused,
// nothing written: which cell is the Disposition can't be told, and filling by index wrote over
// another (kit-162's final-4b B4-1 lost its Fix). tableCells reads "\|" as no break.
export function cmdDispose() {
  const [id, file, fid, ...rest] = positional;
  const text = rest.join(' ').trim();
  if (!id || !file || !FINDING_ID.test(fid ?? '') || !text) die('usage: dispose <ticket> <record.md> <finding id, e.g. F1, R2 or F4-1> "fixed | wont-fix <reason> | wrong <reason>"');
  if (!disposed(text)) die(`"${text}" isn't a disposition: start it with fixed, wont-fix <reason> or wrong <reason>`);
  if (/[|\n]/.test(text)) die('a disposition is one line with no "|"');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || !/^[a-z0-9][a-z0-9-]*\.md$/.test(file)) die('dispose <ticket> <record.md>: a ticket id and a record file name');
  const rel = path.join(projectRel, 'tickets', id, 'reviews', file);
  const abs = path.join(repoRoot, rel);
  const before = readText(abs);
  if (before === null) die(`no review record ${rel} in this checkout`);
  const lines = before.split('\n');
  let disp = -1, width = 0, done = false;
  for (let k = 0; k < lines.length; k++) {
    if (!lines[k].trim().startsWith('|')) continue;
    const cells = tableCells(lines[k]);
    const lower = cells.map((c) => c.toLowerCase());
    if (lower.includes('disposition')) { disp = lower.indexOf('disposition'); width = cells.length; continue; }
    if (cells[0] !== fid || disp < 0) continue;
    if (cells.length !== width) die(`${file} line ${k + 1}: finding ${fid}'s row has ${cells.length} cells where its table's header has ${width}, so dispose can't tell which is the Disposition: ${cells.length > width ? 'a "|" inside a cell (a code span too) splits it; escape each as "\\|" (or remove a stray cell)' : 'a cell is missing (an empty Disposition is a cell too, "| |"); add it'}, then dispose again`);
    const cur = cells[disp] ?? '';
    if (disposed(cur)) die(`${file} ${fid} already has a disposition ("${cur}"); a disposition given doesn't change`);
    const row = Array.from({ length: width }, (_, j) => (j === disp ? text : (cells[j] ?? '')));
    lines[k] = `| ${row.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
    done = true;
    break;
  }
  if (!done) die(`${file} has no finding ${fid} under a table with a Disposition column`);
  fs.writeFileSync(abs, lines.join('\n'));
  out(`${rel} ${fid}: ${text}`);
}
export function cmdLogCheck() {
  const names = new Set();
  for (const d of [liveLogDir(), durableLogDir()]) if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (f.endsWith('.jsonl')) names.add(f);
  const fails = [];
  const newer = [];
  let n = 0;
  for (const f of [...names].sort()) {
    const r = parseLines(logFileText(f), f);
    fails.push(...r.errors);
    newer.push(...r.unknown);
    n += r.lines.length;
  }
  for (const u of newer) out(`a newer kit's line, or a mistyped name: upgrade, or check ${u}`);
  for (const i of readLog().ignored) out(`ignored: ${i.line.__file}:${i.line.__line} ${i.line.id}: ${i.why}`);
  const rw = questionRewrites();
  // an answered order question showed the owner its order: its context ends with the kit's list of change.order
  for (const q of logObjects('question')) { const v = questionView(q); const p = v.order && v.status === 'answered' ? orderContextProblem(v, readLog().byType.get('goal') ?? []) : null; if (p) fails.push(p); }
  for (const w of rw.warnings) out(`warn: ${w}`);
  fails.push(...rw.errors);
  // An applied default that approves nothing (defaultGap): applied before its deadline, or asked on
  // rung 1, however its lines were written. A call that stands on one fails; the default alone warns.
  const voidDefaults = new Map();
  for (const q of logObjects('question')) { const v = questionView(q); const why = v.status === 'defaulted' ? defaultGap(v) : null; if (why) voidDefaults.set(v.id, why); }
  const standing = new Set();
  for (const c of calls()) if (voidDefaults.has(c.approved_by)) { standing.add(c.approved_by); fails.push(`${c.id} stands on ${c.approved_by}'s default, which approves nothing: ${voidDefaults.get(c.approved_by)}`); }
  for (const [id, why] of voidDefaults) if (!standing.has(id)) out(`warn: ${id}'s default approves nothing: ${why}`);
  report(fails, `${n} log line(s)`);
}

export function cmdLog() {
  let objs = [...readLog().objects.values()];
  if (flagStr('type')) objs = objs.filter((o) => o.type === flagStr('type'));
  if (flagStr('by')) objs = objs.filter((o) => o.created_by === flagStr('by'));
  if (flagStr('id')) objs = objs.filter((o) => o.id === flagStr('id'));
  objs.sort(byTime);
  objs = objs.slice(-Number(flagStr('tail') ?? 50));
  // each record's stage in the loop, and an observation's provenance (computed: x-ooda)
  if (flags.json) return json(objs.map(withOoda));
  for (const o of objs) {
    const what = o.question ?? o.statement ?? o.title ?? o.what ?? o.detail ?? o.text ?? (o.type === 'phase' ? `${o.from ?? '-'} -> ${o.to}` : o.type === 'gate' ? `${o.gate} ${o.ok ? 'ok' : 'FAIL'} ${o.ms}ms` : '');
    out(`${o.created_at} ${o.id} [${o.type}${o.kind ? ` ${o.kind}` : ''}${o.status ? ` ${o.status}` : ''}] ${String(what).slice(0, 160)}`);
  }
}

export function report(fails, okMsg) {
  for (const f of fails) out(`fail: ${f}`);
  if (fails.length) process.exit(1);
  out(`ok: ${okMsg}`);
}
// ===== 4. facts from git =====

