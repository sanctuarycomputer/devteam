/* imports start */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { appendLog } from './log-sync.mjs';
import { commonDir } from './state.mjs';
import { die } from './base.mjs';
import { draining } from './fleet.mjs';
import { firstLine } from './reviews.mjs';
import { flags } from './base.mjs';
import { fleetMode } from './holds.mjs';
import { git } from './base.mjs';
import { json } from './base.mjs';
import { lastPhaseOf } from './fleet.mjs';
import { liveSessions } from './holds.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRoot } from './state.mjs';
import { movingFleet } from './holds.mjs';
import { nowIso } from './base.mjs';
import { out } from './base.mjs';
import { ownerWriter } from './log.mjs';
import { readJson } from './base.mjs';
import { readText } from './base.mjs';
import { runPath } from './settings.mjs';
import { spawnSync } from 'node:child_process';
import { warn } from './base.mjs';
import { writeJson } from './base.mjs';
import { writeText } from './recover.mjs';
/* imports end */
// ===== the host claim: one machine supervises a repo at a time =====
//
// Two supervisors on two machines write the same log: their lines interleave once they land, their
// ids collide, and one can make the other's tickets wait on work that isn't on main. A small ref on
// origin, refs/devteam/host, says which machine supervises this repo now: a commit with no files
// whose message is one JSON line (the machine's id, its hostname for people, the heartbeat, and
// whether its fleet is parked or drained for a move). It never touches main's history, and a
// compare-and-swap push (--force-with-lease on that one ref) means two machines taking it at once
// can't both win. The supervisor's start (prompt supervisor, recover, fleet unpark|undrain) and its
// tick (observe-metrics, and wait every 10 minutes) read it, and refresh it while they hold it;
// fleet park|drain --move marks it released for a move (a pause keeps it); fleet status and fleet host show it. Nothing else
// touches the network for it.
//
// The claim grants nothing. It is coordination between machines, not trust: no check anywhere reads
// it as approval, and no command does more because this machine holds it. Anyone who can push to
// origin can write it, so a hand-written claim can only make a supervisor refuse to start (or stop
// at its tick) until it goes stale; it can never let one start that would otherwise be refused,
// nor approve, merge or answer anything.
export const HOST_REF = 'refs/devteam/host';
// origin's claim as last fetched: a local ref, so the claim's commit isn't collected meanwhile
export const HOST_SEEN_REF = 'refs/devteam/host-origin';
// A heartbeat older than this is a machine that's gone (a dead laptop, a box being rebuilt).
export const HOST_FRESH_MS = 45 * 60000;
// How often a holder writes its heartbeat, and how often wait reads the claim.
export const HOST_REFRESH_MS = 10 * 60000;
// A heartbeat this far in the future is a wrong clock or a hand edit: it holds nothing.
export const HOST_SKEW_MS = 10 * 60000;
export const HOST_NET_MS = 15000;
// This checkout's own record: the claim it last wrote, when it last read origin's, and whether it
// has said it couldn't reach origin. Machine-local, like the rest of run/.
export const HOST_FILE = runPath('host-claim.json');
// This machine's id: made once and kept in ~/.devteam (a box keeps its home across restarts and
// redeploys, so its id stays whatever its pod or hostname is called), never derived from the boot,
// the container or the hostname, which change. DEVTEAM_MACHINE_ID sets it instead (an image that
// rebuilds its home each deploy, or a test's stand-in for a second machine).
// keep false (a view: fleet status, fleet host) never makes one: with none yet it is null, which no
// claim's machine matches (this machine has written no claim under an id it never kept).
export function hostMachineId({ keep = true } = {}) {
  const set = hostToken(process.env.DEVTEAM_MACHINE_ID);
  if (set) return set;
  const f = path.join(os.homedir(), '.devteam', 'machine-id');
  const had = readText(f)?.trim();
  if (/^[A-Za-z0-9._-]{8,80}$/.test(had ?? '')) return had;
  if (!keep) return null;
  const id = `m-${crypto.randomBytes(8).toString('hex')}`;
  try { writeText(f, `${id}\n`); } catch {}
  return id;
}
// The machine's name for people (DEVTEAM_MACHINE_NAME, else its hostname). Never used to decide.
// One token, as a claim's reader insists (parseHostClaim).
export const hostToken = (s) => String(s ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 80);
export const hostName = () => hostToken(process.env.DEVTEAM_MACHINE_NAME) || hostToken(os.hostname()) || 'this-machine';
export const hostState = () => { try { const r = readJson(HOST_FILE); return r && typeof r === 'object' ? r : {}; } catch { return {}; } };
export const hostSave = (patch) => { try { writeJson(HOST_FILE, { ...hostState(), ...patch }); } catch {} };
// git against origin with no prompt and a deadline: a laptop offline or a hung ssh never wedges a start.
export function hostNet(args) {
  const ssh = process.env.GIT_SSH_COMMAND || git(['config', '--get', 'core.sshCommand'], mainRoot) ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };
  // LC_ALL=C: its messages are read (a missing ref, a lost race), so never translated
  const r = spawnSync('git', args, { cwd: mainRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: HOST_NET_MS, env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', ...ssh } });
  return { status: r.error ? null : r.status, err: (r.stderr || r.error?.message || '').trim() };
}
// A claim's commit read as data: only the fields the kit writes, each checked. Anything else reads
// as unreadable, which the next start takes over: it would hold nothing anyway.
export function parseHostClaim(sha) {
  const raw = sha ? git(['cat-file', 'commit', sha], mainRoot) : null;
  if (raw === null) return null;
  let c;
  try { c = JSON.parse(raw.slice(raw.indexOf('\n\n') + 2).trim()); } catch { return { sha, unreadable: true }; }
  // one name-like token each: the refusal is a supervisor's whole prompt and the owner reads the
  // question, so a hand-written claim can't put words (or escape codes) in either
  const word = (v) => (typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v) ? v : null);
  const at = Date.parse(c?.at);
  if (c?.devteam_host !== 1 || !word(c.machine) || !Number.isFinite(at)) return { sha, unreadable: true };
  const since = Date.parse(c.since);
  return { sha, machine: c.machine, hostname: word(c.hostname) ?? 'a machine with an unreadable name', at: new Date(at).toISOString(), since: Number.isFinite(since) ? new Date(since).toISOString() : null, fleet: ['park', 'drain'].includes(c.fleet) ? c.fleet : null };
}
// origin's claim now: { claim, sha } with claim null when there is none, or { offline: why }.
// fetch false reads the copy last fetched, touching no network.
export function readHostClaim({ fetch = true } = {}) {
  if (!commonDir) return { offline: 'this is not a git checkout' };
  if (!git(['config', '--get', 'remote.origin.url'], mainRoot)) return { offline: 'this checkout has no origin remote' };
  if (fetch) {
    const r = hostNet(['fetch', '--quiet', '--no-tags', '--no-write-fetch-head', 'origin', `+${HOST_REF}:${HOST_SEEN_REF}`]);
    if (r.status !== 0) {
      if (r.status !== null && /couldn't find remote ref|no such ref|not our ref/i.test(r.err)) { git(['update-ref', '-d', HOST_SEEN_REF], mainRoot); return { claim: null, sha: null }; }
      return { offline: `could not reach origin (${firstLine(r.err) || 'timed out'})` };
    }
  }
  const sha = git(['rev-parse', '--verify', '--quiet', HOST_SEEN_REF], mainRoot);
  return { claim: sha ? parseHostClaim(sha) : null, sha: sha || null };
}
// What a claim means for this machine: mine; free (none, unreadable, stale, dated in the future, or
// released by a park or drain for a move); or held by another machine that is live.
export function hostVerdict(claim, me = hostMachineId(), now = Date.now()) {
  if (!claim || claim.unreadable) return { free: true, why: claim ? 'unreadable' : 'none' };
  // mine: this machine's id, or the very claim this checkout last wrote (a machine whose home was
  // rebuilt, and its id with it, keeps its checkout's run/ and isn't locked out by its own heartbeat)
  if (claim.machine === me || (claim.sha && hostState().sha === claim.sha)) return { mine: true };
  const age = now - Date.parse(claim.at);
  if (age < -HOST_SKEW_MS) return { free: true, why: 'dated in the future' };
  if (age > HOST_FRESH_MS) return { free: true, why: 'stale' };
  if (claim.fleet) return { free: true, released: true, why: claim.fleet === 'park' ? 'parked for a move' : 'drained for a move' };
  return { held: true, age: Math.max(0, age) };
}
export const minutesAgo = (ms) => { const m = Math.round(ms / 60000); return m < 1 ? 'less than a minute ago' : m === 1 ? 'a minute ago' : `${m} minutes ago`; };
// The refusal, in plain words: who holds the repo, when it was last seen, and how to hand over.
export function hostRefusal(claim, age) {
  const lapses = new Date(Date.parse(claim.at) + HOST_FRESH_MS).toISOString();
  return `${claim.hostname} is supervising this repo (machine ${claim.machine}), last seen ${minutesAgo(age)} (${claim.at}). One machine supervises a repo at a time, so a second supervisor here would write over its work: this machine (${hostName()}) won't supervise it. To move it here: on ${claim.hostname}, mark the fleet a move (fleet park --move or fleet drain --move, supervisor.md §12; a park or drain without --move is a pause and keeps the claim there), then start the supervisor here again. If ${claim.hostname} is gone (dead, or rebuilt without its disk), its claim lapses 45 minutes after it was last seen (at ${lapses}) and the next start anywhere takes over; the owner, sure it is gone, can free it now from any terminal of theirs (node docs/devteam/scripts/devteam.mjs fleet host --release), or take it for the machine they run that on (fleet host --take).`;
}
// The claim this machine would write now: its heartbeat, and the fleet's hold as this log has it.
export function hostClaimBody(prev) {
  // A drain releases the claim only once it has drained: until then this supervisor still merges
  // what is in flight, and a second one starting elsewhere would be the very collision this prevents.
  let fleet = null;
  try {
    fleet = draining() ? 'park' : fleetMode();
    if (fleet && !movingFleet()) fleet = null;
    if (fleet === 'drain' && liveSessions().some((s) => lastPhaseOf(s.name)?.to !== 'parked')) fleet = null;
  } catch {}
  const me = hostMachineId();
  const since = prev && !prev.unreadable && prev.machine === me && prev.since ? prev.since : nowIso();
  return { devteam_host: 1, machine: me, hostname: hostName(), at: nowIso(), since, fleet };
}
// Write this machine's claim over expect (origin's sha as read, or null for none) as one
// compare-and-swap: a claim someone else wrote meanwhile makes it fail, and is never overwritten.
export function writeHostClaim(expect, prev) {
  const tree = spawnSync('git', ['mktree'], { cwd: mainRoot, input: '', encoding: 'utf8' }).stdout?.trim();
  if (!tree) return { failed: 'could not make the claim commit' };
  const who = { GIT_AUTHOR_NAME: 'devteam', GIT_AUTHOR_EMAIL: 'devteam@localhost', GIT_COMMITTER_NAME: 'devteam', GIT_COMMITTER_EMAIL: 'devteam@localhost' };
  const body = hostClaimBody(prev);
  const c = spawnSync('git', ['commit-tree', tree, '-m', JSON.stringify(body)], { cwd: mainRoot, encoding: 'utf8', env: { ...process.env, ...who } });
  const sha = c.status === 0 ? c.stdout.trim() : null;
  if (!sha) return { failed: 'could not make the claim commit' };
  const r = hostNet(['push', '--quiet', '--no-verify', `--force-with-lease=${HOST_REF}:${expect ?? ''}`, 'origin', `${sha}:${HOST_REF}`]);
  // only a lost compare-and-swap is a race (the client's lease, or receive-pack's own check); a
  // remote that declines the ref (a hook, a ruleset, a read-only key) is one we can't write: offline
  if (r.status !== 0) return r.status !== null && /stale info|cannot lock ref|is at \S+ but expected|failed to update ref/i.test(r.err) && !/remote rejected.*(hook|denied|protected|permission|forbidden)/i.test(r.err) ? { raced: true } : { offline: `could not write the claim to origin (${firstLine(r.err) || 'timed out'})` };
  git(['update-ref', HOST_SEEN_REF, sha], mainRoot);
  hostSave({ sha, at: body.at, machine: body.machine });
  return { wrote: true, claim: { ...body, sha } };
}
// Say once that the claim can't be checked, then carry on: a laptop with no network still works.
export function hostOffline(why) {
  if (hostState().offline !== why) warn(`could not check which machine supervises this repo: ${why}. Carrying on; it is checked again on the next tick`);
  hostSave({ offline: why, checked: Date.now() });
  return { ok: true, offline: why };
}
// The one check, for a start or a tick: read origin's claim; held by another live machine, refuse;
// else take or refresh it. A start always writes, taking over a claim that is free; a tick writes
// only its own heartbeat once it is HOST_REFRESH_MS old (or when the fleet's hold changed), and
// takes over only a claim no live machine holds, never one another machine released for a move
// (that is the new machine's, taking over). write false reads only (recover --dry-run).
// Returns { ok } or { refused: text, claim }.
export function hostCheck({ start = false, write = true } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = readHostClaim();
    if (r.offline) return hostOffline(r.offline);
    const v = hostVerdict(r.claim);
    // a refusal is remembered, so wait checks again at once rather than in 10 minutes
    hostSave({ offline: null, checked: Date.now(), refused: !!v.held });
    if (v.held) return { refused: hostRefusal(r.claim, v.age), claim: r.claim };
    const st = hostState();
    const due = v.mine ? start || !(Date.now() - (Date.parse(st.at) || 0) < HOST_REFRESH_MS) || hostClaimBody(r.claim).fleet !== r.claim.fleet : start || !v.released;
    if (!write || !due) return { ok: true, claim: r.claim };
    const w = writeHostClaim(r.sha, r.claim);
    if (w.raced) continue;
    if (!w.wrote) return hostOffline(w.offline ?? w.failed);
    if (v.free && r.claim && !r.claim.unreadable) process.stderr.write(`devteam: took over supervising this repo from ${r.claim.hostname} (its claim was ${v.why}; last seen ${r.claim.at})\n`);
    return { ok: true, claim: w.claim };
  }
  // raced twice: someone keeps writing it, which is not yet a live machine holding it; carry on, and
  // the next tick reads who won
  return hostOffline('another machine wrote the claim at the same moment, twice');
}
// A refusal while the supervisor runs (its tick): one owner-action for the owner, in plain words,
// once per holder's stint (never again on the next tick), and the supervisor told to stop.
export function hostRefusedWhileRunning(res) {
  const c = res.claim;
  if (c) {
    const key = `host-claimed ${c.machine} ${c.since ?? c.at}`;
    if (!logObjects('observation').some((o) => o.source_key === key)) {
      const o = appendLog({ type: 'observation', source: 'kit', kind: 'host-claimed', subject: 'supervisor', detail: `${c.hostname} (machine ${c.machine}) holds this repo's supervisor claim, last seen ${c.at}; this machine (${hostName()}, machine ${hostMachineId()}) stopped supervising`, severity: 3, valence: -1, detector: 'kit', source_key: key }, 'supervisor');
      appendLog({
        type: 'question', kind: 'owner-action',
        question: `${hostName()} stopped supervising this project, because ${c.hostname} is supervising it`,
        context: `${c.hostname} was last seen working on it at ${c.at}. Only one machine runs a project at a time, so the two don't write over each other's work.\n\n- If ${c.hostname} should keep it: close the supervisor on ${hostName()}.\n- If you meant to move the project to ${hostName()}: ask the supervisor on ${c.hostname} to pause the fleet for a move first, then start the supervisor on ${hostName()} again.\n- If ${c.hostname} is gone for good: ${hostName()} can take over 45 minutes after it was last seen.`,
        stake: 2, urgency: 2, evidence: [o.id], why_asked: { reasons: ['owner-only'] },
      }, 'supervisor');
    }
  }
  die(`stop supervising here. ${res.refused}`);
}
// Who holds the claim, for fleet status and fleet host: a view, so offline is a line, never a stop.
export function hostHolder({ fetch = true } = {}) {
  const r = readHostClaim({ fetch });
  if (r.offline) return { known: false, holder: null, words: `supervising machine: unknown (${r.offline})` };
  const c = r.claim;
  if (!c) return { known: true, holder: null, words: 'supervising machine: none (no machine has claimed this repo yet)' };
  if (c.unreadable) return { known: true, holder: null, words: 'supervising machine: none (origin\'s claim is unreadable; the next start takes it over)' };
  const v = hostVerdict(c, hostMachineId({ keep: false }));
  const state = v.mine ? 'this machine' : v.held ? 'live' : v.why;
  return {
    known: true, holder: { machine: c.machine, hostname: c.hostname, at: c.at, since: c.since, fleet: c.fleet, mine: !!v.mine, state },
    words: `supervising machine: ${c.hostname} (machine ${c.machine}${v.mine ? ', this machine' : ''}), last seen ${minutesAgo(Math.max(0, Date.now() - Date.parse(c.at)))} (${c.at})${c.fleet ? `, its fleet ${c.fleet === 'park' ? 'parked' : 'drained'} for a move` : ''}${!v.mine && !v.held ? `: ${v.why}, so the next start on another machine takes it over` : ''}`,
  };
}
// fleet host: who holds the claim (origin's, fetched). The owner's alone, for a machine they know
// is gone: --release deletes the claim (the next start anywhere takes it), --take writes this
// machine's over it (run it on the machine that should supervise). Neither grants anything.
export function fleetHost() {
  if (!flags.take && !flags.release) { const h = hostHolder({ fetch: !flags['no-fetch'] }); return flags.json ? json(h) : out(h.words); }
  ownerWriter('the owner frees or takes the claim in their own terminal');
  const r = readHostClaim();
  if (r.offline) die(`could not ${flags.release ? 'free' : 'take'} the claim: ${r.offline}`);
  if (flags.release) {
    if (!r.sha) return out('no machine holds this repo; nothing to free');
    const d = hostNet(['push', '--quiet', '--no-verify', `--force-with-lease=${HOST_REF}:${r.sha}`, 'origin', `:${HOST_REF}`]);
    if (d.status !== 0) die(`could not free the claim: ${firstLine(d.err) || 'timed out'}`);
    git(['update-ref', '-d', HOST_SEEN_REF], mainRoot);
    const was = r.claim && !r.claim.unreadable ? r.claim : null;
    return out(`freed: ${was ? `${was.hostname} no longer holds this repo` : 'the claim is gone'}; the next supervisor to start, on any machine, takes it${was ? ` (if ${was.hostname}'s supervisor is in fact still running, its next tick takes it back)` : ''}`);
  }
  const w = writeHostClaim(r.sha, null);
  if (!w.wrote) die(`could not take the claim: ${w.offline ?? w.failed ?? 'another machine wrote it at the same moment; try again'}`);
  const from = r.claim && !r.claim.unreadable && r.claim.machine !== hostMachineId() ? r.claim : null;
  out(`${hostName()} now supervises this repo${from ? ` (taken from ${from.hostname}, last seen ${from.at}; if its supervisor is still running, it stops at its next tick)` : ''}`);
}

// A job under Upkeep (project/recurring.json, keyed by name): a check, a command run on a schedule in a
// throwaway checkout of main and failing by its rule, or a chore, instructions the supervisor or a
// worker carries out on a schedule. Contract RECURRING_ENTRY_SHAPE@1: the rules and defaults every
// reader takes from here (validate, and the registry, the runner, merge and ask that build on it).
// fields: which kinds carry each field (by: only a chore with that by), whether it must be set, its
// default when unset, and its ceiling. A check runs at most hourly, a chore at most daily, neither
// less often than 90 days, 12 weeks or 3 months; on is a weekday with w and a day 1..28 with mo
// (every month has it); at is HH:MM UTC, never with h. A run command carries no credential: no word
// with one (as a sensor URL or a link), and nothing the scrubber would hide but a host, a phone
// number or an email, after each whole environment reference ($NAME, ${NAME}, after any Bearer,
// Basic or token) is read as one, since a check runs in the supervisor's environment as a gate does.
export const RECURRING_ENTRY_SHAPE = Object.freeze({
  version: 1,
  name: /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
  name_length: Object.freeze([2, 40]),
  kinds: Object.freeze(['check', 'chore']),
  every: /^([1-9][0-9]{0,3})(h|d|w|mo)$/,
  every_min: Object.freeze({ check: 'h', chore: 'd' }),
  every_max: Object.freeze({ h: 2160, d: 90, w: 12, mo: 3 }),
  weekdays: Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  month_day_max: 28,
  at: /^([01][0-9]|2[0-3]):[0-5][0-9]$/,
  last_line_rules: Object.freeze(['above', 'below', 'is_not']),
  by: Object.freeze(['supervisor', 'worker']),
  fields: Object.freeze({
    kind: Object.freeze({ kinds: Object.freeze(['check', 'chore']), required: true }),
    title: Object.freeze({ kinds: Object.freeze(['check', 'chore']), required: true, max: 80 }),
    what: Object.freeze({ kinds: Object.freeze(['check', 'chore']), required: true, max: 160 }),
    every: Object.freeze({ kinds: Object.freeze(['check', 'chore']), required: true }),
    on: Object.freeze({ kinds: Object.freeze(['check', 'chore']) }),
    at: Object.freeze({ kinds: Object.freeze(['check', 'chore']) }),
    run: Object.freeze({ kinds: Object.freeze(['check']), required: true, max: 500 }),
    timeout_s: Object.freeze({ kinds: Object.freeze(['check']), default: 120, max: 1800 }),
    fail: Object.freeze({ kinds: Object.freeze(['check']), default: Object.freeze({ exit: 'nonzero' }) }),
    fail_after: Object.freeze({ kinds: Object.freeze(['check']), default: 1, max: 10 }),
    severity: Object.freeze({ kinds: Object.freeze(['check']), default: 2, max: 3 }),
    by: Object.freeze({ kinds: Object.freeze(['chore']), required: true }),
    prompt: Object.freeze({ kinds: Object.freeze(['chore']), required: true, max: 2000 }),
    component: Object.freeze({ kinds: Object.freeze(['chore']), by: 'worker', required: true }),
    touches: Object.freeze({ kinds: Object.freeze(['chore']), by: 'worker', required: true }),
    done_when: Object.freeze({ kinds: Object.freeze(['chore']), by: 'worker', required: true }),
    grace_days: Object.freeze({ kinds: Object.freeze(['chore']), default: Object.freeze({ supervisor: 1, worker: 3 }), max: 30 }),
  }),
});
