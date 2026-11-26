/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BIG_FILE_LINES } from './graph.mjs';
import { CHORES } from './settings.mjs';
import { EXTERIOR_REL } from './world-model.mjs';
import { LINK_KINDS } from './links.mjs';
import { PANE_CODE } from './graph.mjs';
import { PANE_TRUST } from './graph.mjs';
import { PANE_WAITS } from './graph.mjs';
import { PART_NAME } from './graph.mjs';
import { RESERVED_LINKS } from './links.mjs';
import { SHELLS } from './sessions.mjs';
import { TMUX_TIMEOUT_MS } from './base.mjs';
import { WORKTREE } from './repos.mjs';
import { activeWorker } from './graph.mjs';
import { appendLog } from './log-sync.mjs';
import { byTime } from './log-sync.mjs';
import { clientActiveOn } from './accounts.mjs';
import { closures } from './graph.mjs';
import { commonDir } from './state.mjs';
import { componentLink } from './links.mjs';
import { componentsOn } from './links.mjs';
import { coverageAt } from './reviews.mjs';
import { coverageGaps } from './reviews.mjs';
import { coverageReport } from './lineage.mjs';
import { criticalPath } from './graph.mjs';
import { currentMilestone } from './goals.mjs';
import { currentTicketId } from './log.mjs';
import { cwdGit } from './base.mjs';
import { devteamLine } from './links.mjs';
import { execFileSync } from 'node:child_process';
import { exteriorValidateLines } from './world-model.mjs';
import { featureReviews } from './reviews.mjs';
import { features } from './graph.mjs';
import { findCycle } from './graph.mjs';
import { flags } from './base.mjs';
import { gb } from './hub/operator.mjs';
import { git } from './base.mjs';
import { gitTooOld } from './reviews.mjs';
import { handledMessages } from './log-sync.mjs';
import { hasPathAt } from './repos.mjs';
import { hasWild } from './graph.mjs';
import { idBlockFor } from './sessions.mjs';
import { isActive } from './graph.mjs';
import { isHeld } from './graph.mjs';
import { isObj } from './artifact-notes.mjs';
import { isSplitFile } from './graph.mjs';
import { ladder } from './links.mjs';
import { landingTree } from './check-ticket.mjs';
import { lastPhaseOf } from './fleet.mjs';
import { latestPerTrack } from './reviews.mjs';
import { linesDeclared } from './links.mjs';
import { loadSettings } from './settings.mjs';
import { logGet } from './log-sync.mjs';
import { logObjects } from './log-sync.mjs';
import { logWriter } from './log.mjs';
import { mainLog } from './repos.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { mainSettings } from './reviews.mjs';
import { memo } from './graph.mjs';
import { memoryCeilingProblem } from './hub/operator.mjs';
import { mergeShaFor } from './repos.mjs';
import { nowIso } from './base.mjs';
import { out } from './base.mjs';
import { ownEntry } from './artifact-notes.mjs';
import { ownerLineOpen } from './recover.mjs';
import { padNN } from './sessions.mjs';
import { paneWaits } from './graph.mjs';
import { partsAtMain } from './graph.mjs';
import { pidAlive } from './sensors.mjs';
import { planFeature } from './log.mjs';
import { plannerLaunchGoals } from './holds.mjs';
import { prefixOwners } from './graph.mjs';
import { projectDir } from './state.mjs';
import { projectFileText } from './repos.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { projectRelOf } from './fleet.mjs';
import { questionRewrites } from './log-sync.mjs';
import { questions } from './log-sync.mjs';
import { readCoverage } from './reviews.mjs';
import { readJson } from './base.mjs';
import { readLog } from './log-sync.mjs';
import { readText } from './base.mjs';
import { recordsHomeSetting } from './repos.mjs';
import { recordsInHome } from './repos.mjs';
import { recurringEntryProblems } from './recurring.mjs';
import { recurringRegistry } from './recurring.mjs';
import { registryProblems } from './links.mjs';
import { releaseMayBeOnMerge } from './world-model.mjs';
import { releaseOf } from './repos.mjs';
import { releaseProblem } from './world-model.mjs';
import { releasedIn } from './repos.mjs';
import { repo } from './repos.mjs';
import { repoOfTicketLink } from './repos.mjs';
import { repoReadable } from './repos.mjs';
import { resolveCommit } from './log-sync.mjs';
import { resolvePane } from './sessions.mjs';
import { reviewRecordsIn } from './reviews.mjs';
import { runDir } from './state.mjs';
import { selfDoc } from './self-model.mjs';
import { sensorProblems } from './sensors.mjs';
import { settingsInForce } from './reviews.mjs';
import { sh } from './base.mjs';
import { slug } from './base.mjs';
import { stoppedLaunch } from './graph.mjs';
import { supervisorTarget } from './sessions.mjs';
import { testsOutsideTouches } from './graph.mjs';
import { ticketBranchRef } from './repos.mjs';
import { ticketNumber } from './sessions.mjs';
import { ticketReviews } from './reviews.mjs';
import { tickets } from './graph.mjs';
import { tldrGap } from './questions.mjs';
import { tmux } from './sessions.mjs';
import { tmuxSession } from './base.mjs';
import { tmuxTarget } from './base.mjs';
import { touchPart } from './graph.mjs';
import { touchPath } from './graph.mjs';
import { touchesOverlap } from './graph.mjs';
import { treePathsMemo } from './lineage.mjs';
import { trimSlash } from './graph.mjs';
import { typeLock } from './log.mjs';
import { typeNow } from './sessions.mjs';
import { unbalanced } from './graph.mjs';
import { verdictHolds } from './reviews.mjs';
import { withLock } from './log.mjs';
import { workerState } from './graph.mjs';
import { writeJson } from './base.mjs';
/* imports end */
export const paneTails = new Map();
// Why a window has no agent to talk to: its pane exited, or it is back at a shell prompt (the
// agent quit). Null when it has one, or when tmux, the session or the window isn't there.
export const paneGone = new Map();
export const agentExited = (window) => paneGone.get(window) ?? null;
// An agent idle at its prompt while its own background shell still runs: after a compaction it can
// lose the shell's result and wait for nothing. Only read, never acted on: the supervisor nudges.
export const PANE_SHELL = /\b\d+ (background )?shells? (still )?running\b|·\s*\d+ (background )?shells?\s*(·|$)/i;
// An agent whose last turn ended on an API or network error (a DNS or connection drop, an
// overloaded API): it stops and waits; a nudge resumes it. Harness-agnostic wording.
export const PANE_API_ERROR = /\bAPI Error\b|Can't reach the API|\bENOTFOUND\b|\bECONNRESET\b|\bETIMEDOUT\b|overloaded_error|\bstream (error|disconnected)\b|\b(429|5\d\d) (Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable)\b/i;
export const idleOnApiError = (window) => { const l = paneTails.get(window) ?? []; const last = l.slice(-8); return last.some((x) => PANE_API_ERROR.test(x)) && !l.some((x) => PANE_BUSY.test(x)); };
export const idleWithShell = (window) => { const l = paneTails.get(window) ?? []; return l.some((x) => PANE_SHELL.test(x)) && !l.some((x) => PANE_BUSY.test(x)); };
export function paneWaitingIn(window) {
  if (paneWaits.has(window)) return paneWaits.get(window);
  let found = null;
  const { target, problem } = resolvePane(tmuxTarget(window));
  paneGone.set(window, problem && /no agent is running|has exited/.test(problem) ? problem : null);
  const lines = target ? (sh('tmux', ['capture-pane', '-p', '-t', target]) ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-15) : [];
  // a busy agent is working, not stopped at a limit; what it shows (code, diffs) is never its banner
  const busy = lines.some((l) => PANE_BUSY.test(l));
  for (const [kind, re] of PANE_WAITS) {
    if (kind === 'limit' && busy) continue;
    const hit = lines.find((l) => !PANE_CODE.test(l) && re.test(l));
    if (hit) { found = { kind, line: hit.slice(0, 200) }; break; }
  }
  if (!found && !busy) { const hit = lines.find((l) => !PANE_CODE.test(l) && PANE_TRUST.test(l)); if (hit) found = { kind: 'prompt', line: hit.slice(0, 200) }; }
  // Only the supervisor acts on a pane (its own tick); the dashboard, status and the owner only look.
  // keyed as recordSent wrote it: tmux's own #S:#W, without the exact-match =
  if (target && !found && process.env.DEVTEAM_ROLE === 'supervisor') { resendLostEnter(`${tmuxSession()}:${window}`, target, lines); if (heldPending(`${tmuxSession()}:${window}`)) flushHeld(`${tmuxSession()}:${window}`); }
  paneWaits.set(window, found);
  paneTails.set(window, lines);
  return found;
}

// A lost Enter: text the kit typed still sits unsubmitted in an idle agent's input (an agent that
// compacts or redraws as the keys arrive can drop the Enter). typeInto records each delivery per
// window; when the pane's body (its lines above the harness footer, its chrome left out: paneBody)
// still holds that text's tail, nothing on the pane says the agent is busy, no prompt is up (the
// caller checked), nobody is at the pane (a tmux client on it that pressed a key lately) and the
// text is LOST_ENTER_SECONDS old, press Enter and log it. That Enter can be lost the same way (seen
// on a loaded machine), so the text still sitting there LOST_ENTER_SECONDS after a press gets
// another, up to LOST_ENTER_TRIES in all, but only while the body is as it was at the last press: a
// lost Enter on an idle pane changes nothing there (the footer, the agent list and shell counts
// change on their own, so they're left out), while a reply, a submission or someone typing does.
// The text is never retyped. The record is claimed (moved aside) and read again before each key, so
// however many passes or processes look, and however stale their first read, one press happens per
// claim, and they stop once the text is gone.
export const LOST_ENTER_SECONDS = 30;
export const LOST_ENTER_TRIES = 3;
export const PANE_BUSY = /esc to interrupt|(?<!Enter to confirm · )esc to cancel|ctrl\+c to (interrupt|cancel)|press esc to stop/i;
export const sentFile = (key) => path.join(runDir, 'sent', `${encodeURIComponent(key)}.json`);
// Agent-agnostic: no prompt glyphs. Whitespace (wrapping, padding) and box-drawing borders drop out.
export const squash = (t) => t.replace(/[\s─-╿]+/g, '');
// The harness's own chrome, not the pane's content: a box-drawing rule (the input box's border), a
// running-shell count, a token counter (an agent's list line or spinner). They change on an idle
// pane, so the lost-Enter rescue doesn't digest them. The body is the last 8 lines above the last
// rule that aren't chrome, shell counts taken out; the text is looked for in the raw lines.
export const PANE_RULE = /^[─-╿]{8,}$/;
export const PANE_TOKENS = /[↑↓]\s*[\d.,]+\s*[km]?\s+tokens\b/i;
export const PANE_SHELLS = new RegExp(PANE_SHELL.source, 'gi');
export const paneNorm = (l) => l.replace(PANE_SHELLS, ' ').replace(/[\s·]+/g, ' ').trim();
export function paneBody(lines, tail) {
  let end = lines.length;
  for (let i = end - 1; i >= 0; i--) if (PANE_RULE.test(lines[i].replace(/\s+/g, ''))) { end = i + 1; break; }
  // text below the last rule: no box under the input, so nothing below it is a footer
  if (end < lines.length && squash(lines.slice(end).join('')).includes(tail)) end = lines.length;
  const kept = [];
  for (let i = end - 1; i >= 0 && kept.length < 8; i--) if (!PANE_TOKENS.test(lines[i]) && paneNorm(lines[i])) kept.unshift(i);
  return { text: squash(lines.slice(kept[0] ?? end, end).join('')), digest: crypto.createHash('sha1').update(kept.map((i) => paneNorm(lines[i])).join('\n')).digest('hex') };
}
export function recordSent(target, text) {
  const key = sh('tmux', ['display-message', '-p', '-t', target, '#S:#W']);
  if (!key) return;
  try { writeJson(sentFile(key), { text, at: nowIso() }); } catch {}
}
// A claim left by a process that died between its claim and its writeback: dropped, so the
// sent directory doesn't collect them (that delivery's rescue ends with it).
export function dropDeadClaims(file) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.claim-`;
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.startsWith(prefix)); } catch { return; }
  for (const n of names) {
    const pid = /^\d+$/.test(n.slice(prefix.length)) ? Number(n.slice(prefix.length)) : 0; // not a writeback's .tmp
    if (!pid || pid === process.pid) continue;
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') { try { fs.unlinkSync(path.join(dir, n)); } catch {} } }
  }
}
export function resendLostEnter(key, target, lines) {
  const file = sentFile(key);
  dropDeadClaims(file);
  const ripe = (r) => typeof r?.text === 'string' && (Date.now() - Date.parse(r.at)) / 1000 >= LOST_ENTER_SECONDS;
  let rec;
  try { rec = readJson(file); } catch { return; }
  const tail = squash(rec.text ?? '').slice(-40);
  if (!tail || !ripe(rec)) return;
  const body = paneBody(lines, tail);
  const digest = body.digest;
  const claimed = `${file}.claim-${process.pid}`;
  const drop = () => { try { fs.unlinkSync(claimed); } catch {} };
  // Put the claim back where it was, never over a newer delivery that landed meanwhile (a link
  // fails if the name is taken, where a rename would replace it): then the claim is just dropped.
  const putBack = () => { try { fs.linkSync(claimed, file); } catch {} drop(); };
  // Claimed, and read again: a pass whose first read is stale (another process pressed and wrote
  // the record back since) finds a fresh time, or another text, and leaves it as it was.
  const claim = () => {
    try { fs.renameSync(file, claimed); } catch { return null; }
    let now = null;
    try { now = readJson(claimed); } catch {}
    if (now?.text === rec.text && ripe(now)) return now;
    putBack();
    return null;
  };
  if (!body.text.includes(tail)) { if (claim()) drop(); return; } // submitted: nothing left to press
  // every line captured, chrome and all: a footer's or a spinner's busy marker counts
  if (lines.some((l) => PANE_BUSY.test(l) || /Enter to confirm/i.test(l)) || paneAsking(target)) return; // a menu takes that Enter as its answer
  if (clientActiveOn(target)) return; // someone at the pane: their next key or Enter is theirs
  // tests only: the pause a loaded machine can put between the first read and the claim
  const pause = Number(process.env.DEVTEAM_LOST_ENTER_CLAIM_DELAY_MS ?? 0);
  if (pause > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pause);
  // the claim and the press under the pane's typing lock (kit-618): while the owner's floor holds, or
  // the lock stays busy, nothing is claimed and the record stays as it was for a later look
  const held = typeLock.run(target, (outer) => {
    if (outer && ownerLineOpen(target)) return null;
    const cur = claim();
    if (!cur) return null;
    const done = Math.max(0, Number(cur.tries) || 0);
    // after a press, only an untouched pane: a reply, a submission or a line being typed ends the rescue
    if (done >= LOST_ENTER_TRIES || (done > 0 && cur.bottom !== digest)) return void drop();
    const pressed = tmux(['send-keys', '-t', target, 'Enter']);
    const tries = done + 1;
    const typedAt = cur.typed_at ?? cur.at;
    // another try later, unless that was the last or the key failed; a newer delivery keeps the slot
    if (pressed && tries < LOST_ENTER_TRIES) { try { writeJson(claimed, { ...cur, tries, bottom: digest, at: nowIso(), typed_at: typedAt }); putBack(); } catch { drop(); } } else drop();
    return pressed ? { cur, tries, typedAt } : null;
  });
  if (!held.value) return;
  const { cur, tries, typedAt } = held.value;
  const hash = crypto.createHash('sha1').update(cur.text).digest('hex').slice(0, 12);
  appendLog({ type: 'observation', source: 'pane', kind: 'resent-enter', subject: key.slice(key.indexOf(':') + 1), detail: `pressed Enter (try ${tries} of ${LOST_ENTER_TRIES}): text typed ${Math.round((Date.now() - Date.parse(typedAt)) / 1000)}s ago was still unsubmitted in an idle pane ("${cur.text.slice(0, 60)}${cur.text.length > 60 ? '…' : ''}", sha1 ${hash})`, detector: 'pane', source_key: `resent-enter ${key} ${hash} ${typedAt}`, measure: { value: Math.round((Date.now() - Date.parse(cur.at)) / 1000), unit: 's' } });
}
// The supervisor's own pane: answers, threads and workers' messages are typed into it too, and its
// tick only looks at the windows it runs, so an Enter lost there waited for the owner to press it.
// accounts-tick (the dashboard's, as the supervisor) covers it, with the same rules as a worker's.
export function resendSupervisorLostEnter() {
  const { target } = resolvePane(supervisorTarget());
  const key = target ? sh('tmux', ['display-message', '-p', '-t', target, '#S:#W']) : null;
  if (!key) return;
  const lines = (sh('tmux', ['capture-pane', '-p', '-t', target]) ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-15);
  if (lines.some((l) => !PANE_CODE.test(l) && PANE_WAITS.some(([, re]) => re.test(l)))) return;
  resendLostEnter(key, target, lines);
}
export const paneWaiting = (id) => (activeWorker(id) ? paneWaitingIn(id) : null);

// A question in a pane: a dialog the agent's CLI put up and is waiting on (a tool that wants a
// person's yes, a permission prompt), read from what the pane shows, never from colors.
//
// Two readings, for two uses. Whether to type into the pane is the wide one (paneAskingIn): a
// numbered menu, a dialog whose last lines say Enter confirms it, or any line under the cursor mark
// near the bottom with a choice beside it and no input box under it. Holding a line too long costs a
// wait; typing one into a menu answers it. Whether the owner may answer from the dashboard is the
// narrow one (paneQuestionIn): the agent's own frame from its top rule (a rule from the pane's first
// column) to its hint lines, with options numbered from 1 in one column, exactly one under the
// cursor, and nothing under it but hints. The whole dialog is kept as the pane has it: no line
// dropped, no space collapsed, nothing cut. One too tall for the pane, or too long to send, is not
// offered at all, so the card never shows less than the owner is agreeing to. The digest is of that
// whole dialog, rule to last hint, with only the cursor mark taken out: any other change to it is
// another question.
/* pane question start */
export const MENU_OPTION = /^(\s*)(?:([❯›▶→>])\s*)?(\d{1,2})\.\s+(\S.*)$/;
export const CURSOR_LINE = /^(\s*)([❯›▶→])(\s+)(\S.*)$/;
export const PANE_WORKING = /esc to interrupt|ctrl\+c to interrupt|press esc to stop/i;
export const PANE_INPUT = /^[❯›>](\s|$)/;
export const SHELL_PROMPT = /^[$%#]$/;
export const BOX_ONLY = /^[\s─-╿]+$/;
export const TOP_RULE = /^[╭┌─━═][─━═]{19,}[╮┐]?\s*$/;
export const ANY_RULE = /^[\s╭╮╰╯┌┐└┘├┤]*[─━═]{8,}[\s╭╮╰╯┌┐└┘├┤─━═]*$/;
export const ENTER_CONFIRMS = /\bEnter to (confirm|select|continue)\b|\bPress Enter to continue\b/i;
export const LIMIT_OPTION = /^\s*(?:[❯›▶→>]\s*)?\d+\.\s*Stop and wait for limit to reset\s*$/;
export const DIALOG_MAX = 6000;
export const HINT_LINES_MAX = 8;
// a dialog drawn in a box: its sides drop out, the columns stay
export const unboxed = (rawLines) => rawLines.map((l) => String(l).replace(/^(\s*)[│┃]/, '$1 ').replace(/[│┃]\s*$/, '').trimEnd());
export function paneQuestionIn(rawLines) {
  const raw = rawLines.map((l) => String(l).trimEnd());
  const lines = unboxed(raw);
  let at = -1;
  for (let i = lines.length - 1; i >= 0 && at === -1; i--) if (MENU_OPTION.exec(lines[i])?.[2]) at = i;
  if (at === -1) return null;
  const col = (l) => (MENU_OPTION.test(l) ? l.search(/\d/) : -1);
  const num = (l) => Number(MENU_OPTION.exec(l)[3]);
  const c = col(lines[at]);
  const option = (l) => col(l) === c;
  // a wrapped label's next line, or a line describing the option: indented to the numbers or past them
  const more = (l) => !!l.trim() && !option(l) && l.search(/\S/) >= c;
  // up to option 1, through options, their extra lines and blank lines only
  let start = at;
  while (num(lines[start]) !== 1) {
    let i = start - 1;
    while (i >= 0 && (more(lines[i]) || !lines[i].trim())) i--;
    if (i < 0 || !option(lines[i]) || num(lines[i]) !== num(lines[start]) - 1) return null;
    start = i;
  }
  // down through the rest: a blank line stays inside only when the next option follows it
  let end = at;
  for (let last = num(lines[at]); end < lines.length - 1;) {
    let i = end + 1;
    while (i < lines.length && !lines[i].trim()) i++;
    if (i >= lines.length) break;
    if (option(lines[i]) && num(lines[i]) === last + 1) { last++; end = i; continue; }
    if (i === end + 1 && more(lines[i])) { end = i; continue; }
    break;
  }
  const options = [];
  let selected = null;
  for (let i = start; i <= end; i++) {
    if (!lines[i].trim()) continue;
    const m = option(lines[i]) ? MENU_OPTION.exec(lines[i]) : null;
    if (!m) { options[options.length - 1].label += `\n${lines[i].trim()}`; continue; }
    options.push({ n: Number(m[3]), label: m[4].trimEnd() });
    if (m[2]) { if (selected !== null) return null; selected = Number(m[3]); }
  }
  if (options.length < 2 || selected === null || options.some((o, i) => o.n !== i + 1)) return null;
  const hints = lines.slice(end + 1).map((l) => l.trim()).filter((l) => l && !BOX_ONLY.test(l));
  if (hints.length > HINT_LINES_MAX || hints.some((l) => PANE_WORKING.test(l) || PANE_INPUT.test(l) || SHELL_PROMPT.test(l))) return null;
  // the agent's own frame: its top rule, from the pane's first column. A rule inside the dialog (a
  // command's own text) is indented with the rest of it, and is not the top.
  let top = -1;
  for (let i = start - 1; i >= 0 && top === -1; i--) if (TOP_RULE.test(raw[i])) top = i;
  if (top === -1) return null;
  let bottom = raw.length - 1;
  while (bottom > end && !raw[bottom].trim()) bottom--;
  // the whole dialog, as the pane has it, with only the cursor mark taken out
  const whole = raw.slice(top, bottom + 1).map((l, k) => { const i = top + k; return i >= start && i <= end && option(lines[i]) ? l.replace(/[❯›▶→>](\s*\d)/, ' $1') : l; }).join('\n');
  if (whole.length > DIALOG_MAX) return null;
  const body = lines.slice(top + 1, start);
  while (body.length && !body[0].trim()) body.shift();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  // the dialog's own margin goes (a rule across the pane has none); every other space stays
  const worded = (l) => !!l.trim() && !BOX_ONLY.test(l);
  const indent = Math.min(...body.filter(worded).map((l) => l.search(/\S/)), 99);
  const question = body.map((l) => (worded(l) ? l.slice(indent) : l)).join('\n');
  const first = (body.find((l) => l.trim() && !BOX_ONLY.test(l)) ?? '').trim();
  const artifact = /claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9-]{6,64})/.exec(whole)?.[1] ?? null;
  return { question, options, selected, hint: hints.join('\n'), first, artifact, digest: crypto.createHash('sha1').update(whole).digest('hex') };
}
// The agent's input box, from the line with its prompt mark: a rule right above it, and a rule under
// it and whatever of a long draft wrapped onto more lines. What is typed in it, or null when that
// line is not an input box.
export function inputBoxAt(lines, i) {
  let a = i - 1;
  while (a >= 0 && !lines[a].trim()) a--;
  if (a < 0 || !ANY_RULE.test(lines[a])) return null;
  const words = [lines[i].trim().slice(1).trim()];
  for (let b = i + 1; b < lines.length && b <= i + 12; b++) {
    if (ANY_RULE.test(lines[b])) return words.join('');
    if (lines[b].trim()) words.push(lines[b].trim());
  }
  return null;
}
// The agent's input box, if the pane's last lines show one: what is typed in it ('' when empty), else null.
export function paneDraftIn(rawLines) {
  const lines = unboxed(rawLines);
  const idx = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0).slice(-16);
  for (const i of idx.reverse()) {
    if (!PANE_INPUT.test(lines[i].trim())) continue;
    const box = inputBoxAt(lines, i);
    // an agent that draws no rules round its prompt: the bare mark, or a line that is no menu's
    return box ?? (MENU_OPTION.exec(lines[i])?.[2] ? null : lines[i].trim().slice(1).trim());
  }
  return null;
}
// Whether a line typed into the pane now, with its Enter, would answer something instead of being
// read. { kind: 'menu', … } is one the owner can answer from the dashboard; 'limit' the usage-limit
// menu (accounts-tick's to clear); 'dialog' anything else that is up, answered in the terminal: text
// is the pane's last lines as they are. Only what the pane's own shape says: a question the agent
// wrote in a reply, above its input box, holds nothing.
export function paneAskingIn(rawLines) {
  const raw = rawLines.map((l) => String(l).trimEnd());
  const lines = unboxed(raw);
  const limit = lines.some((l) => LIMIT_OPTION.test(l));
  const q = paneQuestionIn(raw);
  if (q && !limit) return { kind: 'menu', ...q };
  const shown = () => { const t = raw.slice(-25); while (t.length && !t[0].trim()) t.shift(); while (t.length && !t[t.length - 1].trim()) t.pop(); return t.join('\n'); };
  const dialog = () => ({ kind: limit ? 'limit' : 'dialog', text: shown(), digest: crypto.createHash('sha1').update(shown()).digest('hex') });
  if (q) return dialog();
  const idx = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  // its last lines say Enter confirms it, and none of them is the input box with those words typed in it
  const tail = idx.filter((i) => !BOX_ONLY.test(lines[i])).slice(-4).map((i) => lines[i].trim());
  const e = tail.findIndex((l) => ENTER_CONFIRMS.test(l));
  if (e !== -1 && !tail.some((l) => PANE_WORKING.test(l)) && !tail.slice(e).some((l) => PANE_INPUT.test(l))) return dialog();
  // a line under the cursor mark near the bottom, a choice beside it, and no input box under it
  const near = idx.slice(-15);
  for (let k = near.length - 1; k >= 0; k--) {
    const i = near[k];
    const m = CURSOR_LINE.exec(lines[i]) ?? (MENU_OPTION.exec(lines[i])?.[2] ? /^(\s*)(>)(\s*)(\S.*)$/.exec(lines[i]) : null);
    if (!m) continue;
    const after = idx.filter((j) => j > i).map((j) => lines[j].trim());
    if (after.some((l) => PANE_WORKING.test(l) || PANE_INPUT.test(l) || SHELL_PROMPT.test(l))) return null;
    if (inputBoxAt(lines, i) !== null) continue;
    const at = m[1].length + m[2].length + m[3].length;
    // the nearest line above or below it (a blank line between them or not) starts where its words do
    const near2 = [idx[idx.indexOf(i) - 1], idx[idx.indexOf(i) + 1]].filter((j) => j !== undefined && Math.abs(j - i) <= 2);
    if (near2.some((j) => !BOX_ONLY.test(lines[j]) && lines[j].search(/\S/) === at)) return dialog();
  }
  return null;
}
// Ready for a line: nothing asked, and the agent's input box is showing.
export const paneReadyIn = (rawLines) => !paneAskingIn(rawLines) && paneDraftIn(rawLines) !== null;
/* pane question end */
// What a pane shows now, bottom 60 lines, columns kept (not sh(): it trims). -u: under a locale that
// isn't UTF-8 tmux prints the cursor mark as an underscore, and the menu would go unseen.
export const screenLines = (text) => String(text ?? '').replace(/\s+$/, '').split('\n').slice(-60);
export function paneScreen(target) {
  let text = '';
  try { text = execFileSync('tmux', ['-u', 'capture-pane', '-p', '-t', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: TMUX_TIMEOUT_MS }); } catch {}
  return screenLines(text);
}
export const paneAsking = (target) => paneAskingIn(paneScreen(target));
// Why a pane is not taken for the supervisor's, for an answer from the dashboard (null when it is):
// the record of its pane (run/supervisor-pane) is a file any session here can write, and an owner's
// click must not land in a worker's menu. The supervisor runs in the main checkout, never in a
// worktree, and its window is not one of the fleet's. Anything that runs as this user can still
// type into any pane itself; this only keeps the kit's own click where the card said it would go.
export function notSupervisorPane(target) {
  const [cwd, win] = (sh('tmux', ['-u', 'display-message', '-p', '-t', target, '#{pane_current_path}\n#{window_name}']) ?? '').split('\n');
  if (!cwd) return `cannot inspect ${target}`;
  let real = cwd;
  try { real = fs.realpathSync(cwd); } catch {}
  const root = fs.realpathSync(mainRoot);
  if (real !== root && !real.startsWith(root + path.sep)) return `the pane recorded as the supervisor's (${target}) runs in ${cwd}, not in this checkout`;
  if (real.startsWith(path.join(root, '.worktrees') + path.sep)) return `the pane recorded as the supervisor's (${target}) runs in a worktree (${cwd}): that is a worker's or a planner's`;
  if (win && (tickets().has(win) || win.startsWith('plan-'))) return `the pane recorded as the supervisor's (${target}) is the window of ${win}`;
  return null;
}
// What the supervisor's terminal is asking, for the dashboard: { target, ask, problem }.
export function supervisorAsk() {
  const { target, problem } = resolvePane(supervisorTarget());
  if (!target) return { target: null, ask: null, problem };
  const ask = paneAsking(target);
  const not = ask ? notSupervisorPane(target) : null;
  // not answered from the dashboard, but still shown: the owner goes to the terminal
  return { target, ask: ask && not && ask.kind === 'menu' ? { kind: 'dialog', text: paneScreen(target).slice(-25).join('\n').trim(), digest: ask.digest } : ask, problem: not };
}

// Pane text shown to the owner as it is: no control or bidi-control characters (a line that reads
// backwards, or redraws itself), cut to n.
export const paneShown = (t, n) => String(t ?? '').replace(/[\p{Cc}\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
// The fleet's sessions stopped at a permission prompt or another dialog, for hello's Inbox count:
// [{ window, line }]. Only this checkout's windows, read by the pane ids that the one list-panes
// matched by start path (never by name: a session can be shared, a name repeated), and only those the
// blocked-prompt finding watches: an active worker's, a planner's that isn't parked. A window may be
// split or its panes swapped, so each of its panes that isn't a shell is read, and the window counts
// once if any shows a dialog (start path alone doesn't prove which pane is the agent's). Read by the dialog's shape (paneAskingIn)
// while the agent's input box and working line aren't showing, as the supervisor's terminal is: an
// agent's reply or a tool's output on its normal screen is no prompt, nor a busy pane or a usage-limit
// stop; a full-screen view someone opened (a transcript, a pager) can still read as one. Its own
// budget (budgetMs in all, at most 2 s a pane): a stalled capture leaves the rest unread rather than
// losing the whole hello. Only reads: active is decided from the log, never workerState, whose spend
// parses transcripts and writes run/cache/usage.json.
export function fleetPrompts(budgetMs = 4000) {
  const end = Date.now() + budgetMs;
  const session = tmuxSession();
  const left = () => end - Date.now();
  if (sh('tmux', ['has-session', '-t', `=${session}`], { timeout: Math.max(1, Math.min(2000, left())) }) === null) return [];
  const root = `${path.join(fs.realpathSync(mainRoot), '.worktrees')}${path.sep}`;
  const listed = left() > 0 ? sh('tmux', ['list-panes', '-s', '-t', `=${session}`, '-F', '#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{window_id}\t#W\t#{pane_start_path}'], { timeout: Math.max(1, Math.min(2000, left())) }) : null;
  const rows = (listed ?? '').split('\n').filter(Boolean).map((l) => { const [id, dead, cmd, win, name, ...p] = l.split('\t'); let start = p.join('\t'); try { start = fs.realpathSync(start); } catch {} return { id, dead, cmd, win, name, start: `${start}${path.sep}` }; });
  const watched = (name) => (name.startsWith('plan-') ? lastPhaseOf(name)?.to !== 'parked' && git(['rev-parse', '--verify', '--quiet', `refs/heads/plan/${name.slice(5)}`]) !== null : tickets().has(name) && !!lastPhaseOf(name)?.to && !['done', 'parked'].includes(lastPhaseOf(name).to) && !mergeShaFor(name));
  const found = [];
  const counted = new Set();
  for (const r of rows) {
    if (left() <= 0) break;
    if (counted.has(r.win)) continue;
    if (!/^%\d+$/.test(r.id) || r.dead === '1' || SHELLS.has(r.cmd.replace(/^-/, '')) || r.name.startsWith('dev~') || !r.start.startsWith(root) || !watched(r.name)) continue;
    let text = '';
    try { text = execFileSync('tmux', ['-u', 'capture-pane', '-p', '-t', r.id], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: Math.max(1, Math.min(2000, left())) }); } catch { continue; }
    const lines = screenLines(text);
    if (lines.filter((l) => l.trim()).slice(-15).some((l) => PANE_WORKING.test(l))) continue;
    const ask = paneAskingIn(lines);
    if (!ask || ask.kind === 'limit') continue;
    const said = ask.kind === 'menu' ? ask.first || String(ask.question ?? '').split('\n').find((l) => l.trim()) : [...String(ask.text ?? '').split('\n')].reverse().find((l) => /\?\s*$/.test(l)) ?? String(ask.text ?? '').split('\n').filter((l) => l.trim()).pop();
    counted.add(r.win);
    found.push({ window: paneShown(r.name, 60), line: paneShown(said, 200) });
  }
  return found;
}

// Deliveries held while a pane asks: a message typed into a menu, with its Enter, answers the menu
// (an owner's "Approved here" in a thread once answered No to a tool's consent prompt). So typeInto
// types nothing while the pane asks; the line (already in the log, which is the record) waits in
// run/held/<window>/, one file a line, named so that sorting them is the order they came in. They
// are typed in that order once the pane shows the agent's input box again (not merely no question:
// between two prompts a pane shows neither), or, for an agent whose input box the kit can't
// recognise, once it has asked nothing and the oldest line has waited two minutes. Who looks: the
// next delivery to that pane, the supervisor's tick for its workers' panes, accounts-tick for every
// pane, and the owner's answer on the dashboard. One process types a window's lines at a time: it
// claims the whole folder by renaming it (a rename only one can win) to a name with its pid and the
// time, touches it as it goes, and puts back what it could not type; lines held meanwhile land in a
// fresh folder, which it takes next. A claim whose process is gone, or that has not been touched for
// a minute (a pid can be someone else's by then), goes back as it was: a line is typed twice only if
// its process stopped between its keys and its unlink, and is never lost. A line a day old, or one
// whose pane has been gone ten minutes, is let go and the supervisor's log says so: its recipient
// reads it in the log.
export const HELD_MAX_MS = 24 * 3600 * 1000;
export const HELD_GONE_MS = 10 * 60 * 1000;
export const HELD_NO_INPUT_MS = 2 * 60 * 1000;
export const HELD_CLAIM_STALE_MS = 60 * 1000;
export const heldRoot = () => path.join(runDir, 'held');
export const heldDir = (key) => path.join(heldRoot(), encodeURIComponent(key));
export const paneKey = (target) => sh('tmux', ['display-message', '-p', '-t', target, '#S:#W']) || null;
export const heldFiles = (dir) => { try { return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort(); } catch { return []; } };
// when a held line's file says it was held: its name begins with the time
export const heldAge = (name) => Date.now() - Number(name.slice(0, 15));
export const heldClaims = (key) => {
  const pre = `${encodeURIComponent(key)}.claim-`;
  let names = [];
  try { names = fs.readdirSync(heldRoot()); } catch {}
  return names.filter((n) => n.startsWith(pre) && /^\d+(-\d+)?$/.test(n.slice(pre.length))).map((n) => {
    // a claim with no time in its name counts from when it was last touched
    const [pid, at = 0] = n.slice(pre.length).split('-').map(Number);
    let touched = at;
    try { touched = Math.max(at, fs.statSync(path.join(heldRoot(), n)).mtimeMs); } catch {}
    return { dir: path.join(heldRoot(), n), pid, stale: !pidAlive(pid) || Date.now() - touched > HELD_CLAIM_STALE_MS };
  });
};
// The supervisor's held lines, for the screen route's held (terminal@1 §6, kit-618): the lines in its
// window's folder and in the live claim folders a flusher is typing from, and the oldest one's age by
// its name (0 when none is held). A folder that can't be read counts 0: it never fails the read.
export function supervisorHeld(key) {
  try {
    const names = [heldDir(key), ...heldClaims(key).filter((c) => !c.stale).map((c) => c.dir)].flatMap(heldFiles);
    // a loop, not a spread: a backlog of any size never overflows the call's arguments
    let oldest = Infinity;
    for (const n of names) { const at = Number(n.slice(0, 15)); if (Number.isFinite(at) && at < oldest) oldest = at; }
    return { count: names.length, oldest_ms: Number.isFinite(oldest) ? Math.max(0, Date.now() - oldest) : 0 };
  } catch { return { count: 0, oldest_ms: 0 }; }
}
export let heldSeq = 0;
export function holdLine(key, target, line, paste = null) {
  const dir = heldDir(key);
  const name = `${String(Date.now()).padStart(15, '0')}-${String(process.pid).padStart(8, '0')}-${String(++heldSeq).padStart(5, '0')}`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    // written whole, then named: a flush never reads half a line
    fs.writeFileSync(path.join(dir, `${name}.tmp`), JSON.stringify({ line, target, at: nowIso(), ...(paste ? { paste } : {}) }));
    fs.renameSync(path.join(dir, `${name}.tmp`), path.join(dir, `${name}.json`));
    return path.join(dir, `${name}.json`);
  } catch { return null; }
}
// A window's own short lock, for the steps a late line could slip between: a sender's look at what
// is held and its hold, a flusher's claim, a put-back. Only renames and reads run under it: nothing typed.
export function heldLock(key, fn) {
  fs.mkdirSync(path.join(runDir, 'held-locks'), { recursive: true });
  return withLock(path.join(runDir, 'held-locks', encodeURIComponent(key)), fn);
}
// Lines back into the window's folder, under their own names: older than anything held since.
export function unclaimHeld(key, claimed, dir) {
  heldLock(key, () => {
    const names = heldFiles(claimed);
    if (names.length) { try { fs.mkdirSync(dir, { recursive: true }); } catch {} }
    for (const n of names) { try { fs.renameSync(path.join(claimed, n), path.join(dir, n)); } catch {} }
    try { fs.rmSync(claimed, { recursive: true, force: true }); } catch {}
  });
}
// A line let go, said in the log by whoever writes as the supervisor (its tick, accounts-tick): any
// other process leaves it for them.
export const heldLogs = () => process.env.DEVTEAM_ROLE === 'supervisor' && logWriter() === 'supervisor';
export function dropHeld(key, file, why) {
  if (!heldLogs()) return false;
  let rec = null;
  try { rec = readJson(file); } catch {}
  try { fs.unlinkSync(file); } catch { return false; }
  const text = typeof rec?.line === 'string' ? rec.line : '';
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);
  try { appendLog({ type: 'observation', source: 'pane', kind: 'held-dropped', subject: key.slice(key.indexOf(':') + 1), detail: `a line held for this pane since ${rec?.at ?? 'an unknown time'} was never typed and is let go (${why}): "${text.slice(0, 120)}${text.length > 120 ? '…' : ''}" (sha1 ${hash}); its recipient reads it in the log`, detector: 'pane', source_key: `held-dropped ${key} ${path.basename(file)}` }); } catch {}
  return true;
}
// Stale claims back, and what is a day old let go: whoever looks, whatever else holds the window.
export function tidyHeld(key) {
  const dir = heldDir(key);
  for (const c of heldClaims(key)) if (c.stale && c.pid !== process.pid) unclaimHeld(key, c.dir, dir);
  for (const n of heldFiles(dir)) if (!(heldAge(n) < HELD_MAX_MS)) dropHeld(key, path.join(dir, n), 'held for over a day');
}
// a line still worth typing waits, or someone is typing them now. Tests only
// (DEVTEAM_HELD_CHECK_DELAY_MS): held open between the two reads, with a held-locks/<k>.checking
// marker, so a put-back can be tried inside that window.
export function heldPending(key) {
  const files = heldFiles(heldDir(key));
  const delay = Number(process.env.DEVTEAM_HELD_CHECK_DELAY_MS ?? 0);
  if (!(delay > 0)) return files.some((n) => heldAge(n) < HELD_MAX_MS) || heldClaims(key).some((c) => !c.stale);
  const marker = path.join(runDir, 'held-locks', `${encodeURIComponent(key)}.checking`);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, '');
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
    return files.some((n) => heldAge(n) < HELD_MAX_MS) || heldClaims(key).some((c) => !c.stale);
  } finally {
    fs.rmSync(marker, { force: true });
  }
}
// Types a window's held lines, oldest first, each only into a pane that is ready for it. The number typed.
export function flushHeld(key) {
  const dir = heldDir(key);
  let typed = 0;
  tidyHeld(key);
  // someone is typing them now, in order: what is held meanwhile is theirs to take next
  if (heldClaims(key).length) return 0;
  for (let stopped = false; !stopped && heldFiles(dir).length;) {
    const claimed = `${dir}.claim-${process.pid}-${Date.now()}`;
    // taken only while nobody else holds a claim: another flusher's lines go first, in order
    let took = false;
    try { took = heldLock(key, () => { if (heldClaims(key).length) return false; fs.renameSync(dir, claimed); return true; }); } catch {}
    if (!took) break;
    const names = heldFiles(claimed);
    const live = names.filter((n) => heldAge(n) < HELD_MAX_MS);
    // only lines nobody here may let go: left where they are for the supervisor's next look
    if (!live.length && !heldLogs()) { unclaimHeld(key, claimed, dir); break; }
    for (const n of names) {
      const f = path.join(claimed, n);
      if (!(heldAge(n) < HELD_MAX_MS)) { dropHeld(key, f, 'held for over a day'); continue; }
      let rec = null;
      try { rec = readJson(f); } catch {}
      if (typeof rec?.line !== 'string') { try { fs.unlinkSync(f); } catch {} continue; }
      // the pane it was for, if that is still this window's; else the window's pane as it is now
      let pane = typeof rec.target === 'string' ? resolvePane(rec.target) : { problem: 'no pane recorded' };
      if (pane.problem || paneKey(pane.target) !== key) pane = resolvePane(key);
      if (pane.problem) { if (heldAge(n) > HELD_GONE_MS && dropHeld(key, f, `its pane is gone: ${pane.problem}`)) continue; stopped = true; break; }
      // a paste only as typeNow takes one, paths as text: anything else in the file is typed as a line alone
      const paste = Array.isArray(rec.paste) && rec.paste.length && rec.paste.every((p) => typeof p === 'string') ? rec.paste : null;
      // under the pane's typing lock (kit-618): the owner's floor first, so it holds the line even past
      // HELD_NO_INPUT_MS; the floor or a busy lock stops the flush here, this line and those after it held
      const done = typeLock.run(pane.target, (outer) => {
        if (outer && ownerLineOpen(pane.target)) return false;
        const screen = paneScreen(pane.target);
        const ready = paneReadyIn(screen) || (!paneAskingIn(screen) && heldAge(live[0]) > HELD_NO_INPUT_MS);
        return ready && typeNow(pane.target, rec.line, paste);
      });
      if (done.busy || !done.value) { stopped = true; break; }
      try { fs.unlinkSync(f); } catch {}
      try { const now = new Date(); fs.utimesSync(claimed, now, now); } catch {}
      typed++;
    }
    unclaimHeld(key, claimed, dir);
  }
  return typed;
}
// Every window with lines held, by whoever looks next; not the ones in skip (a session this same
// look just restarted: its input box comes first).
export function flushAllHeld(skip = []) {
  let names = [];
  try { names = fs.readdirSync(heldRoot()); } catch { return 0; }
  const keys = new Set(names.map((n) => n.replace(/\.claim-\d+(-\d+)?$/, '')));
  let typed = 0;
  for (const k of keys) { try { const key = decodeURIComponent(k); if (skip.includes(key)) tidyHeld(key); else typed += flushHeld(key); } catch {} }
  return typed;
}

// Planners in flight: a plan/<feature> branch whose plan file hasn't landed on main. They write no phase lines, so their
// last sign of life is the newest of: a live log line (messages, observations), a commit on the
// branch, their plan file, an uncommitted edit in their worktree. Their pane says if they're stuck.
export function planners() { return memo('planners', plannersNow); }
export function plannersNow() {
  const s = loadSettings();
  const main = mainRef();
  const lines = readLog().lines;
  const branches = (git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/plan/']) ?? '').split('\n').filter(Boolean);
  return branches.map((b) => {
    const feature = b.slice('plan/'.length);
    const by = `plan-${feature}`;
    // landed once its plan file is on main (a fresh planner's branch sits at main's tip, uncommitted)
    if (main && hasPathAt(main, `${projectRel}/log/${by}.jsonl`)) return null;
    // or once its branch came into main by a merge (its tip in main, off main's own first-parent
    // line): a design-change planner that wrote into another plan's file and merged through it.
    // A fresh planner's branch sits on a first-parent commit of main, so it still shows.
    const tip = git(['rev-parse', b]);
    if (main && tip && git(['merge-base', '--is-ancestor', tip, main]) !== null && !mainLog().some((c) => c.sha === tip)) return null;
    const wt = path.join(mainRoot, '.worktrees', by);
    const planFile = path.join(wt, projectRel, 'log', `${by}.jsonl`);
    const graph = readText(planFile) ?? git(['show', `${b}:${projectRel}/log/${by}.jsonl`]) ?? '';
    const fl = graph.split('\n').filter(Boolean).map((t) => { try { return JSON.parse(t); } catch { return null; } }).filter((o) => o?.type === 'feature');
    const feat = fl.reduce((a, o) => ({ ...a, ...o }), {});
    const stamps = [...lines.filter((l) => l.by === by).map((l) => l.at), git(['log', '-1', '--format=%cI', b])];
    for (const p of [planFile, ...(fs.existsSync(wt) ? (git(['status', '--porcelain'], wt) ?? '').split('\n').filter(Boolean).map((l) => path.join(wt, l.slice(3).replace(/^"|"$/g, ''))) : [])]) {
      try { stamps.push(fs.statSync(p).mtime.toISOString()); } catch {}
    }
    const last = stamps.filter(Boolean).map((x) => new Date(x).toISOString()).sort().pop() ?? null;
    const { target, problem } = resolvePane(tmuxTarget(by));
    const msgs = lines.filter((l) => l.type === 'message');
    const replied = handledMessages();
    const asking = msgs.filter((m) => m.by === by && !['info', 'ruling', 'answer', 'addressed'].includes(m.kind) && !replied.has(m.id));
    // Before its feature line exists (while designing), a planner's goal is the one its questions
    // name: a question whose links point at this plan branch.
    const refQs = questions().filter((q) => (q.links ?? []).some((l) => l.ref === b || l.ref === `refs/heads/${b}`));
    const goals = [...new Set([...(feat.goals ?? []), ...refQs.map((q) => q.goal).filter(Boolean), ...plannerLaunchGoals(feature)])];
    return {
      feature, title: feat.title ?? feature, goals, tickets: graph.split('\n').filter((t) => t.includes('"type":"ticket"') && t.includes('"op":"new"')).length,
      branch: b, window: !!target, problem: target ? null : problem, waiting: target ? paneWaitingIn(by) : null,
      parked: lines.filter((l) => l.by === by && l.type === 'phase').sort((x, y) => x.at.localeCompare(y.at)).pop()?.to === 'parked',
      last_seen: last, minutes_silent: last ? Math.round((Date.now() - Date.parse(last)) / 60000) : null,
      waiting_on_supervisor: asking.map((m) => ({ id: m.id, kind: m.kind, text: m.text })),
      // a planner whose design waits on the owner's answers is waiting, not stale
      waiting_on_owner: [...new Set([...questions().filter((q) => q.status === 'open' && goals.includes(q.goal)), ...refQs.filter((q) => q.status === 'open')].map((q) => q.id))],
    };
  }).filter(Boolean);
}

// The supervisor's approval of a ticket's spec or plan is an act that refers to the ticket.
export const approvalOf = (id, cls) => logObjects('act').filter((a) => a.class === cls && (a.refs ?? []).includes(id)).sort(byTime).pop() ?? null;

// Computed stage of every ticket: git says merged and released; approval acts say spec'd and
// planned; the branch's committed review records say in review; phase lines say what the worker
// is doing right now.
// An active records-in-home ticket whose records are on home's main while it isn't merged in its
// repo: merge landed the records and then the code didn't land (merge <id> again finishes it).
export function recordsLandedOnly(t) {
  if (!isActive(t) || !recordsInHome(t) || mergeShaFor(t.id)) return false;
  const main = mainRef();
  return !!main && hasPathAt(main, `${projectRel}/tickets/${t.id}/spec.md`);
}
export const RECORDS_ONLY_FIX = (id) => `records in home, code not merged: run merge ${id} again`;
export function deriveStatus() {
  const ts = tickets();
  return [...ts.values()].map((t) => {
    const mergeSha = mergeShaFor(t.id);
    const branch = ticketBranchRef(t.id);
    const src = branch && !mergeSha ? { ref: branch } : WORKTREE;
    const spec = approvalOf(t.id, 'approve-spec') ? 'approved' : null;
    const plan = approvalOf(t.id, 'approve-plan') ? 'approved' : null;
    const reviews = ticketReviews(t.id, src);
    const depsMerged = (t.depends_on ?? []).every((d) => mergeShaFor(d));
    let stage = 'planned';
    if (t.superseded_by) stage = 'superseded';
    else if (mergeSha) stage = releasedIn(mergeSha, releaseOf(t)) ? 'released' : 'merged';
    else if (reviews.some((r) => r.stage === 'final')) stage = 'in-review';
    else if (branch && plan === 'approved' && depsMerged) stage = 'building';
    else if (plan === 'approved') stage = 'planned-in-detail';
    else if (spec === 'approved') stage = "spec'd";
    else if (depsMerged) stage = 'ready';
    const w = workerState(t.id);
    return {
      id: t.id, title: t.title, feature: t.feature, component: t.component, kind: t.kind, size: t.size, risk: t.risk, serves: t.serves ?? [], depends_on: t.depends_on ?? [],
      stage, merge_sha: mergeSha, branch, deps_merged: depsMerged, held: isHeld(t) ? t.held : null,
      phase: w?.phase ?? null, task: w?.task ?? null, note: w?.note ?? null, minutes_silent: w?.minutes_silent ?? null, usd: w?.usd ?? null,
      waiting: paneWaiting(t.id),
      // a launch stopped before it ran (stoppedLaunch): the key only on its row
      ...(w?.phase === 'starting' && stoppedLaunch(t.id) ? { not_started: true } : {}),
      // a half-done merge: its records landed in home, its code didn't (merge again lands it)
      ...(!mergeSha && recordsLandedOnly(t) ? { records_landed: true } : {}),
    };
  });
}

// A mostly serial graph (D4, D11): the longest chain of unmerged tickets is SERIAL_DEPTH or more
// deep and at least SERIAL_RATIO times the ready width (unmerged tickets whose dependencies have
// all merged). Every check passes on such a graph, yet only one or two tickets can ever run. When
// most of the chain's links join tickets that share nothing but a whole-file touch of a file
// split_files lists, the dependency only serializes: naming parts (path#name) lets them run at once.
export const SERIAL_DEPTH = 8, SERIAL_RATIO = 4;
export function serialGraphWarning(live, s = loadSettings()) {
  const U = new Map(live.map((t) => [t.id, t]));
  if (U.size < SERIAL_DEPTH) return null;
  const chain = criticalPath(U, () => 1).path;
  const depth = chain.length;
  const width = live.filter((t) => !(t.depends_on ?? []).some((d) => U.has(d))).length;
  if (depth < SERIAL_DEPTH || depth < SERIAL_RATIO * width) return null;
  const msg = `the unmerged ticket graph is mostly serial: its longest dependency chain is ${depth} tickets deep (${chain[0]} … ${chain[depth - 1]}) while ${width} of ${U.size} are ready (no unmerged dependency) (D4, D11)`;
  // a link that only serializes: every footprint the two share is a whole-file touch of a split file
  const wholeSplit = (a, b) => {
    const repo = repoOfTicketLink(a);
    if (repo !== repoOfTicketLink(b)) return null;
    const files = new Set();
    for (const ga of a.touches ?? []) for (const gb of b.touches ?? []) {
      if (!touchesOverlap(ga, gb, repo, s)) continue;
      const pa = trimSlash(touchPath(ga)), pb = trimSlash(touchPath(gb));
      if (pa !== pb || hasWild(pa) || !isSplitFile(pa, s) || (touchPart(ga) && touchPart(gb))) return null;
      files.add(pa);
    }
    return files.size ? [...files] : null;
  };
  const links = [];
  for (let i = 1; i < depth; i++) { const f = wholeSplit(U.get(chain[i - 1]), U.get(chain[i])); if (f) links.push(`${chain[i]} on ${chain[i - 1]} (${f.join(', ')})`); }
  if (links.length * 2 <= depth - 1) return `${msg}; find dependencies a contract ticket or a split could break`;
  return `${msg}; ${links.length} of its ${depth - 1} links only serialize whole-file touches of a file split_files lists, e.g. ${links.slice(0, 2).join('; ')}: name the parts each changes (path#name) and drop the dependencies that only serialize`;
}

export const onPlanBranch = () => (cwdGit(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').startsWith('plan/');

export function cmdValidate() {
  const ts = tickets();
  const fs_ = features();
  const errors = [];
  const warnings = [];
  const err = (id, m) => errors.push(`${id}: ${m}`);
  const STORY_RE = /^[A-Z][A-Z0-9]*-S[0-9]+$/;
  // Ticket-level planning checks read the lines as the planner or supervisor has them now (the
  // working tree), so a component declared in a draft can be planned against before it lands.
  // They are advice for the graph, not one of the four enforcement points: check-ticket's footprint
  // and check-pr's coverage judge the same tickets by committed settings (settingsInForce) at merge.
  // Each ticket against its own repo's lines; another repo's kit line is its project folder, read
  // from settings alone (no checkout needed, so a missing one never stops validate).
  const S0 = loadSettings(); const lined = linesDeclared(S0);
  let validateClosures = null;
  const linesOf = (link) => ({ comps: componentsOn(S0, link), dev: link === 'home' ? devteamLine() : [`${projectRelOf(link)}/**`] });
  for (const [id, t] of ts) {
    if (isActive(t) && !id.startsWith(`${t.component}-`)) err(id, `id must start with its component "${t.component}-"`);
    for (const g of t.touches ?? []) if (unbalanced(touchPath(g))) err(id, `touches entry "${g}" has unbalanced braces`);
    // Component lines: the component is declared, and every touches entry lies in its
    // line (or a touches_components member's) and no other, so a ticket's footprint is one line.
    if (lined && isActive(t)) {
      const decl = ownEntry(S0.components, t.component);
      if (!decl) err(id, `component "${t.component}" is not declared in settings.components (declare it with its owns, or plan the ticket under a declared one)`);
      const tc = t.touches_components ?? [];
      if (tc.length && !['contract', 'integration'].includes(t.kind)) err(id, 'touches_components is for contract and integration tickets (planning.md D2, D7)');
      for (const c of tc) if (!ownEntry(S0.components, c)) err(id, `touches_components "${c}" is not a declared component`);
      else if (componentLink(c, S0) !== componentLink(t.component, S0)) err(id, `touches_components "${c}" is in another repo; a ticket changes one repo (split it per repo)`);
      const mine = new Set([t.component, ...tc]);
      const L0 = linesOf(componentLink(t.component, S0));
      // The ticket's own folder (or a file under it) is its to write, when its records are in its
      // own repo (check-pr's `own`); matched on text, so no empty, . or .. segment may walk out.
      const ownDir = `${projectRelOf(componentLink(t.component, S0))}/tickets/${id}`;
      const ownFolder = !recordsHomeSetting(t);
      for (const entry of t.touches ?? []) {
        const p = trimSlash(touchPath(entry));
        if (ownFolder && p.split('/').every((x) => x && x !== '.' && x !== '..') && (p === ownDir || p.startsWith(`${ownDir}/`))) continue;
        const owners = prefixOwners(touchPath(entry), L0.comps, L0.dev);
        if (owners === null) err(id, `touches "${entry}" has no static prefix, so it could be in any line; start it with a folder`);
        else if (owners.includes('devteam')) err(id, `touches "${entry}" lies in the kit's own line; only the ticket's own ${ownDir}/ may be named from it, and kit upgrades are chores`);
        else if (!owners.length) err(id, `touches "${entry}" lies in no component's line`);
        else if (owners.some((o) => !mine.has(o))) err(id, `touches "${entry}" lies in ${owners.filter((o) => !mine.has(o)).join(' and ')}'s line, not ${t.component}'s (list ${owners.filter((o) => !mine.has(o)).join(', ')} in touches_components on a contract or integration ticket, or split the ticket)`);
      }
    }
    if (isActive(t) && !mergeShaFor(id)) for (const l of t.links ?? []) if (!ownEntry(loadSettings().links, l)) err(id, `links "${l}" is not in settings links`);
    // Parts (path#name): of any file, named as main has them, or added (path#+name)
    // by this ticket or one it depends on. Written "<id>: …", so another ticket's gate only warns.
    if (isActive(t) && !mergeShaFor(id)) for (const entry of t.touches ?? []) {
      const x = touchPart(entry);
      if (!x) continue;
      const f = trimSlash(touchPath(entry));
      const rn = repoOfTicketLink(t);
      if (hasWild(f)) err(id, `touches "${entry}": a part names one file, not a glob`);
      else if (!x.name || !PART_NAME.test(x.name)) err(id, `touches "${entry}": a part's name is letters, digits and _ $ . - (path#name, or path#+name for a part the ticket adds)`);
      else if (!repoReadable(rn)) warnings.push(`${id}: touches "${entry}": its part is not checked, since repo ${rn} can't be read here`);
      else {
        const P = partsAtMain(rn, f);
        const added = () => [...(validateClosures ??= closures(ts)).get(id) ?? []].some((d) => { const o = ts.get(d); return o && isActive(o) && !mergeShaFor(d) && (o.touches ?? []).some((e) => { const y = touchPart(e); return y?.added && y.name === x.name && trimSlash(touchPath(e)) === f; }); });
        if (!P) err(id, `touches "${entry}": ${f} is not a file on main; a ticket that creates a file names it whole`);
        else if (x.added && P.places.has(x.name)) err(id, `touches "${entry}": ${f} already has a part ${x.name} at main; name it without +`);
        else if (!x.added && !P.places.has(x.name) && !added()) err(id, `touches "${entry}": ${f} has no part ${x.name} at main (a part is a top-level function, const, let, var, class, interface, type or enum, a Markdown heading's slug, or a marked region: /* name start */ … /* name end */, <!-- -->, or a # // -- line comment); one this ticket adds is #+${x.name}`);
      }
    }
    for (const d of t.depends_on ?? []) {
      if (d === id) err(id, 'depends on itself');
      else if (!ts.has(d)) err(id, `depends_on "${d}" does not exist (D3)`);
      else if (!isActive(ts.get(d)) && isActive(t)) err(id, `depends_on "${d}" is superseded; depend on its replacement`);
    }
    if (t.superseded_by && !ts.has(t.superseded_by)) err(id, `superseded_by "${t.superseded_by}" does not exist`);
    if (t.superseded_by === id) err(id, 'a ticket is not superseded by itself');
    if ((t.one_way_doors ?? []).length && t.risk !== 'high') err(id, 'lists a one-way door, so risk must be high (D8)');
    if (t.feature === CHORES && !['chore', 'spike', 'fix'].includes(t.kind)) err(id, `only chore, spike and fix tickets may use the reserved feature "${CHORES}"`);
    if (t.kind === 'fix' && t.feature !== CHORES) err(id, `a fix ticket is in "${CHORES}" (Upkeep's)`);
    if (isActive(t) && ['chore', 'spike', 'fix'].includes(t.kind) && !(t.serves ?? []).length && !t.notes) err(id, `${t.kind} ticket serving no story must say why in notes (D6)`);
    if (isActive(t) && !['chore', 'spike', 'fix'].includes(t.kind) && !(t.serves ?? []).length) err(id, 'must serve at least one story (D6)');
    if (t.kind === 'contract' && !(t.contracts?.provides ?? []).length) err(id, 'contract ticket must list contracts.provides (D2)');
    if (isActive(t) && t.feature !== CHORES && !fs_.has(t.feature)) err(id, `feature "${t.feature}" is not in the log (devteam.mjs feature add)`);
  }
  // The feature this checkout's plan/<feature> branch plans, or re-plans; check-pr validates a plan
  // PR's head detached, so it names the feature with --plan.
  const branchFeature = onPlanBranch() ? (cwdGit(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').slice('plan/'.length) : null;
  const planFeature = typeof flags.plan === 'string' ? flags.plan : branchFeature;
  // On a plan branch, the feature's tickets number from its reserved block (a planner made before
  // blocks has none and is not checked).
  {
    const pf = branchFeature;
    const b = pf ? idBlockFor(pf) : null;
    if (b) for (const t of ts.values()) {
      if (t.created_by !== `plan-${pf}`) continue;
      const n = ticketNumber(t.id, t.component);
      if (n === null || n < b.from || n > b.to) warnings.push(`${t.id}: its number is outside the block reserved for ${pf} (${padNN(b.from)}-${padNN(b.to)}); another planner may take it`);
    }
  }
  const cycle = findCycle(ts);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')} (D3)`);

  // Features: every story defined is served and every story served is defined (D6); a story across
  // components has an integration ticket (D7); an approved feature has reviews and ready goals.
  for (const [fid, f] of fs_) {
    for (const l of f.links ?? []) if (!ownEntry(loadSettings().links, l)) errors.push(`feature ${fid}: links "${l}" is not in settings links`);
    const stories = new Set((f.stories ?? []).map((s) => s.id));
    const mine = [...ts.values()].filter((t) => isActive(t) && t.feature === fid);
    const served = new Set();
    for (const t of mine) for (const s of t.serves ?? []) { if (!stories.has(s)) err(t.id, `serves "${s}", which feature ${fid} does not define`); served.add(s); }
    for (const s of stories) if (!served.has(s)) errors.push(`feature ${fid}: story ${s} is served by no ticket (D6)`);
    for (const s of stories) {
      const servers = mine.filter((t) => (t.serves ?? []).includes(s));
      const comps = new Set(servers.filter((t) => t.kind !== 'contract').map((t) => t.component));
      if (comps.size > 1 && !servers.some((t) => t.kind === 'integration')) warnings.push(`feature ${fid}: story ${s} spans ${[...comps].join(', ')} but has no integration ticket (D7)`);
      // Across repos there are no multi-repo tickets: a story served in two repos is
      // split per repo, with its end-to-end check in the ticket that lands last, one that depends
      // (transitively) on every other ticket serving it.
      if (flags.strict) {
        const repos = [...new Set(servers.map(repoOfTicketLink))];
        const clos = closures(ts);
        if (repos.length > 1 && !servers.some((t) => servers.every((o) => o === t || clos.get(t.id)?.has(o.id)))) errors.push(`feature ${fid}: story ${s} is served in ${[...new Set(servers.map((t) => t.component))].join(', ')} (${repos.join(', ')}) and no ticket serving it depends on all the others; add the end-to-end ticket that lands last (planning.md D2, D7)`);
      }
    }
    // A feature that has reached this checkout is landed (or being planned here): its design and
    // graph reviews must say APPROVE. On a plan/<feature> branch that is a warning until review.
    // A feature all of whose tickets are superseded has no work left for a review to approve.
    const own = [...ts.values()].filter((t) => t.feature === fid);
    if (!own.length || own.some(isActive)) {
      const sink = onPlanBranch() && !flags.strict ? warnings : errors;
      const reviews = featureReviews(fid);
      const designSlug = f.design ? path.basename(f.design, '.md') : null;
      const designReviews = designSlug ? reviewRecordsIn(WORKTREE, `reviews/${designSlug}`) : [];
      for (const r of [...reviews, ...designReviews]) {
        if (r.verdict && !r.reviewer) errors.push(`feature ${fid}: review ${r.file} has no "- Reviewer:" line`);
        if (r.verdict && !r.shaValid) errors.push(`feature ${fid}: review ${r.file} needs the full 40-character SHA`);
      }
      // In strict mode (a plan PR) each verdict must also hold at this head: nothing but review
      // records added since the commit it names (quality.md §3). A feature already landed on main is
      // history, unless this branch is re-planning it: then its latest reviews are this PR's.
      const landed = mainRef() && git(['rev-parse', '--verify', '--quiet', `${mainRef()}:${projectRel}/log/plan-${fid}.jsonl`]) !== null;
      const head = flags.strict && commonDir && (!landed || fid === planFeature) ? resolveCommit('HEAD') : null;
      const holds = (r) => !head || verdictHolds(r.sha, head, `${projectRel}/reviews/`);
      const lg = latestPerTrack(reviews, 'graph');
      if (!lg.length) sink.push(`feature ${fid}: no graph review in project/reviews/${fid}/graph-<n>.md`);
      else if (lg.some((r) => r.verdict !== 'APPROVE')) sink.push(`feature ${fid}: the latest graph review is not APPROVE`);
      else for (const r of lg.filter((x) => !holds(x))) errors.push(`feature ${fid}: graph review ${r.file} is at ${(r.sha ?? '').slice(0, 12)}, which does not hold at HEAD (something other than review records changed since); review again`);
      if (!f.design) errors.push(`feature ${fid} names no design (project/designs/<slug>.md)`);
      else if (!projectFileText(f.design.replace(/^project\//, ''))) errors.push(`feature ${fid}: design ${f.design} does not exist`);
      else {
        // A design being planned here opens with its TL;DR; landed designs are history.
        const dt = landed ? null : tldrGap(projectFileText(f.design.replace(/^project\//, '')));
        if (dt) sink.push(`feature ${fid}: design ${f.design} ${dt} (quality.md §6)`);
        const ld = latestPerTrack(designReviews, 'design');
        if (!ld.length) sink.push(`feature ${fid}: design ${f.design} has no review in project/reviews/${designSlug}/design-<n>.md`);
        else if (ld.some((r) => r.verdict !== 'APPROVE')) sink.push(`feature ${fid}: the latest design review is not APPROVE`);
        else for (const r of ld.filter((x) => !holds(x))) errors.push(`feature ${fid}: design review ${r.file} is at ${(r.sha ?? '').slice(0, 12)}, which does not hold at HEAD; review again`);
      }
      if (!(f.goals ?? []).length) errors.push(`feature ${fid} names no goal`);
      for (const g of f.goals ?? []) {
        const o = logGet(g);
        if (o?.type !== 'goal') errors.push(`feature ${fid} names goal ${g}, which is not in the log`);
        else if (o.kind === 'upkeep') errors.push(`feature ${fid} names the Upkeep goal; upkeep is the chores feature's, and a feature serves the goals it plans for`);
        else if (o.status === 'abandoned') warnings.push(`feature ${fid} names goal ${g}, which the owner let go: its work waits unless another goal it serves runs (goal decide ${g} restore brings it back)`);
        else if (!['ready', 'met'].includes(o.status)) errors.push(`feature ${fid} names goal ${g}, which is ${o.status ?? 'draft'}; the owner approves a goal before features are planned from it`);
        else {
          // A feature's own design builds on its goal's design, the spine, and says so (planning.md §2).
          const spine = `designs/${slug(o.title ?? o.id)}.md`;
          const own = f.design?.replace(/^project\//, '');
          if (own && own !== spine && projectFileText(own) && !projectFileText(own).includes(spine)) errors.push(`feature ${fid}: its design ${f.design} does not cite its goal's design (${spine}); a feature design builds on the spine and links it`);
          // Planning rolls a milestone at a time: a feature only for later milestones is planning ahead.
          const cur = (o.milestones ?? []).length ? currentMilestone(o) : null;
          const mine = (f.preconditions ?? []).filter((p) => p.startsWith(`${g}#`)).map((p) => Number(p.split('#')[1]));
          const at = (n) => o.milestones.findIndex((m) => m.preconditions.includes(n)) + 1;
          if (cur && mine.length && mine.every((n) => at(n) > cur.n)) warnings.push(`feature ${fid} serves only milestone ${Math.min(...mine.map(at))} of ${g}, but milestone ${cur.n} is current; plan it once milestone ${cur.n} is met unless it is on the current milestone's critical path`);
        }
      }
    }
  }

  // D4: tickets that can run at the same time must have disjoint footprints. Merged ones are history.
  // Checking one ticket (its merge gate, or in its worktree), an overlap between two other tickets
  // is a warning: it comes from the live graph, not this branch, and the supervisor resolves it.
  const scope = process.env.DEVTEAM_GATE_TICKET || currentTicketId();
  if (!cycle) {
    const clos = closures(ts);
    const live = [...ts.values()].filter((t) => isActive(t) && !mergeShaFor(t.id));
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j];
      if (clos.get(a.id)?.has(b.id) || clos.get(b.id)?.has(a.id)) continue;
      // the same path in two repos is two files (by name: validate never needs a checkout)
      if (repoOfTicketLink(a) !== repoOfTicketLink(b)) continue;
      outer: for (const ga of a.touches ?? []) for (const gb of b.touches ?? []) if (touchesOverlap(ga, gb, repoOfTicketLink(a))) { const m = `${a.id} and ${b.id} can run concurrently but both touch "${ga}" / "${gb}" (D4)`; if (scope && a.id !== scope && b.id !== scope) warnings.push(`${m}; not ${scope}'s to fix`); else errors.push(m); break outer; }
    }
    // A dependency whose only shared footprint is a big file (BIG_FILE_LINES at main, or one
    // split_files lists) that one of them claims whole: if the edge is only there for D4, naming
    // the parts each changes would let them run at once. A warning: the edge may be real.
    const ordered = [];
    for (const a of live) for (const d of a.depends_on ?? []) {
      const b = ts.get(d);
      if (!b || !isActive(b) || mergeShaFor(b.id) || repoOfTicketLink(a) !== repoOfTicketLink(b)) continue;
      const rn = repoOfTicketLink(a);
      let big = null;
      for (const ga of a.touches ?? []) for (const gb of b.touches ?? []) {
        if (big === false || !touchesOverlap(ga, gb, rn)) continue;
        const f = trimSlash(touchPath(ga));
        const P = !hasWild(ga) && !hasWild(gb) && f === trimSlash(touchPath(gb)) && (!touchPart(ga) || !touchPart(gb)) && repoReadable(rn) ? partsAtMain(rn, f) : null;
        big = P && (P.n >= BIG_FILE_LINES || isSplitFile(f, S0)) ? (big ?? new Map()).set(f, P.n) : false;
      }
      if (big) ordered.push(`${a.id} depends on ${b.id}, and they share only ${[...big].map(([f, n]) => `${f} (${n} lines)`).join(', ')}, claimed whole`);
    }
    if (ordered.length) warnings.push(`a whole-file claim on a big file orders ${ordered.length} pair(s) of tickets: ${ordered.slice(0, 5).join('; ')}${ordered.length > 5 ? ` (+${ordered.length - 5} more)` : ''}. If a dependency is only there for D4, name the parts each changes (path#name; planning.md D4) so they can run at once`);
    // D4's commonest miss in graph reviews: a done-when quotes text the ticket changes, and a test
    // at main asserts that text, but the test isn't in the ticket's touches, so the build breaks a
    // file it may not change. Checked for the feature being planned (its plan branch, or --plan),
    // in a repo this machine reads: a warning, since the test may only mention the text.
    if (planFeature) for (const t of live) {
      if (t.feature !== planFeature) continue;
      const missed = testsOutsideTouches(t);
      if (missed.length) warnings.push(`${t.id}: its done-whens quote text that tests at main assert, in files its touches don't cover: ${missed.slice(0, 4).map(([q, fs_]) => `"${q}" in ${fs_.slice(0, 3).join(', ')}${fs_.length > 3 ? ` (+${fs_.length - 3})` : ''}`).join('; ')}${missed.length > 4 ? ` (+${missed.length - 4} more)` : ''}. If the ticket changes that text, add those tests to its touches (D4)`);
    }
    const w = serialGraphWarning(live);
    if (w) warnings.push(scope ? `${w}; not ${scope}'s to fix` : w);
  }

  // The registry and the lines. Labels-only components and an empty registry print nothing.
  {
    const s = loadSettings();
    const reg = registryProblems(s);
    errors.push(...reg.errors, ...sensorProblems(s));
    // The jobs (kit-162) as this checkout's recurring.json holds them, not main's: a branch's edit
    // to the jobs is what must be checked. settings.md holds no jobs, and a recurring key there is
    // refused (loadSettings copies every key, so a leftover one would still show, read by nothing).
    {
      const R = recurringRegistry;
      let own;
      try { own = JSON.parse(readText(path.join(projectDir, 'settings.md'))?.match(/```json devteam\s*\n([\s\S]*?)\n```/)?.[1] ?? 'null'); } catch { own = null; }
      if (isObj(own) && Object.hasOwn(own, 'recurring')) errors.push(R.inSettings());
      if (!projectInRepo) {
        // git holds no jobs file for a project dir outside the repo, so one there would never be read
        let there = false;
        try { fs.lstatSync(path.join(projectDir, 'recurring.json')); there = true; } catch { there = false; }
        if (there) errors.push('the project dir is outside this repo: its recurring.json is never read');
      } else {
        const w = R.readWorking();
        if (w.problem) errors.push(w.problem);
        else {
          for (const [n, e] of Object.entries(w.jobs)) errors.push(...recurringEntryProblems(n, e));
          const over = R.capProblem(w.jobs, 'a check every n hours runs 24/n times, anything daily or slower once');
          if (over) errors.push(over);
        }
      }
    }
    { const p = memoryCeilingProblem(s.machine_memory_ceiling); if (p) errors.push(p); }
    warnings.push(...reg.warnings);
    // With lines, check-pr and merge judge the tree a PR would land, which takes git 2.38; say so
    // here, in the words merge refuses with, before the first PR meets it.
    if (!['ask', 'adopt'].includes(s.upstream_sync)) warnings.push(`settings.upstream_sync is ${JSON.stringify(s.upstream_sync)}; only "ask" and "adopt" are valid, so it is read as "ask"`);
    if (linesDeclared(s) && gitTooOld()) warnings.push(`components: ${gitTooOld()}; coverage fails closed until it can`);
    // A reserved slug as a component prefix: the one G1 exception, only for a project already using it.
    // Only live tickets: a superseded or merged one is history, so the prescribed fix clears it.
    const reserved = [...ts.values()].filter((t) => isActive(t) && !mergeShaFor(t.id) && RESERVED_LINKS.includes(t.component)).map((t) => t.id);
    if (reserved.length) errors.push(`tickets ${reserved.join(', ')}: component "${[...new Set(reserved.map((id) => ts.get(id).component))].join('" and "')}" is reserved (home is the repo that holds the kit, devteam the kit's own files); rename the component: supersede each ticket with one under another component (ticket add <new-id>, ticket set <old-id> --json '{"superseded_by": "<new-id>"}')`);
    // Which tree and which settings, by the rule coverageFails applies at check-pr and
    // merge: main's tree under main's committed settings, except in a chore context (a chore-
    // <slug> branch checked out here) whose head changes settings.md, where it is the tree that
    // chore would land under the settings it would land. A plan's validate --strict runs on a
    // detached head, so main's. Checked for one ticket, a gap on main is not that ticket's to fix:
    // a warning, as for D4.
    const main = mainRef();
    if (main && projectInRepo) {
      const head = (git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').startsWith('chore-') ? resolveCommit('HEAD') : null;
      const S = head ? settingsInForce(git(['merge-base', main, head]), head) : null;
      let ref = main, sIn = mainSettings(), problem = null;
      if (S?.fromHead && (linesDeclared(S.head ?? {}) || linesDeclared(S.sMain))) {
        const land = landingTree(head);
        const J = land.problem ? land : S.landed();
        if (J.problem) problem = J.problem; else { ref = land.tree; sIn = J.settings; }
      }
      const read = problem ? { error: problem.replace(/^components: /, '') } : readCoverage(() => coverageAt(ref, sIn));
      if (read.error) (scope ? warnings : errors).push(`components: ${read.error}`);
      const cov = read.value;
      if (cov) for (const l of coverageReport({ ...coverageGaps(cov, sIn), ref }, sIn)) (scope || l.startsWith('line-empty:') ? warnings : errors).push(`components: ${l}${scope ? `; not ${scope}'s to fix` : ''}`);
      // Every repo link with components: its main's tree under the same lines (settings live in
      // home). A repo this machine can't read is skipped with a warning; link-unreachable says how
      // to fix it at tick time. Its project folder holds only tickets/.
      for (const [id, l] of Object.entries(sIn.links ?? {})) {
        if (!LINK_KINDS[l?.kind]?.hostsComponents || !componentsOn(sIn, id).length) continue;
        if (!repoReadable(id)) { warnings.push(`components (${id}): not checked, ${LINK_KINDS[l.kind].reachable(l, id)}`); continue; }
        const R = repo(id);
        const rm = R.mainRef();
        if (!rm) { warnings.push(`components (${id}): not checked, its checkout has no ${R.settings.main_branch} (fetch it)`); continue; }
        const rd = readCoverage(() => coverageAt(rm, sIn, R));
        if (rd.error) (scope ? warnings : errors).push(`components (${id}): ${rd.error}`);
        if (rd.value) for (const x of coverageReport({ ...coverageGaps(rd.value, sIn), ref: rm }, sIn, R)) (scope || x.startsWith('line-empty:') ? warnings : errors).push(`components (${id}): ${x}${scope ? `; not ${scope}'s to fix` : ''}`);
        for (const p of readCoverage(() => treePathsMemo(rm, R)).value ?? []) if (p.startsWith(`${R.projectRel}/`) && !p.startsWith(`${R.projectRel}/tickets/`)) errors.push(`${id}: ${p} is in ${R.projectRel}, which holds only tickets/ (settings, the log and designs live in home)`);
      }
    }
    // Designs cite links as link:<id>; checked only while the registry has links.
    if (Object.keys(s.links ?? {}).length) {
      const dd = path.join(projectDir, 'designs');
      for (const f of fs.existsSync(dd) ? fs.readdirSync(dd).filter((x) => x.endsWith('.md')) : []) {
        for (const m of (readText(path.join(dd, f)) ?? '').matchAll(/(?:^|[\s(`[])link:([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g)) if (!ownEntry(s.links, m[1])) errors.push(`designs/${f} cites link:${m[1]}, which is not in settings links`);
      }
    }
  }

  for (const e of readLog().errors) warnings.push(`log ${e}`);
  for (const u of readLog().unknown) warnings.push(`log: a newer kit's line, or a mistyped name: upgrade, or check ${u}`);
  { const r = questionRewrites(); errors.push(...r.errors); warnings.push(...r.warnings); }
  for (const i of readLog().ignored) if (['ticket', 'feature'].includes(i.line.type) && i.why === 'duplicate id') errors.push(`${i.line.id}: a second ${i.line.type} line with this id (${i.line.__file}:${i.line.__line}) was ignored; use ${i.line.type} set`);
  const raw = ladder().raw_ceilings;
  for (const [c, v] of Object.entries(loadSettings().autonomy_ceilings ?? {})) {
    if (raw[c] === undefined) errors.push(`settings autonomy_ceilings: "${c}" is not a ladder class in constitution.md`);
    else if (v > raw[c]) errors.push(`settings autonomy_ceilings: ${c} ${v} is above the constitution's ceiling ${raw[c]}; a project may only lower it`);
  }
  {
    const s = loadSettings();
    // one that could mean deploy-on-merge is an error (merge fails closed on it); any other a warning
    const rs = [[s.release, 'settings release'], ...Object.entries(s.links ?? {}).filter(([, l]) => isObj(l) && l.release !== undefined).map(([lid, l]) => [l.release, `settings links.${lid}.release`])];
    for (const [r, at] of rs) { const bad = releaseProblem(r, at); if (bad) (releaseMayBeOnMerge(r) ? errors : warnings).push(releaseMayBeOnMerge(r) ? bad : `${bad}; read as not deploying on merge`); }
  }
  const td = path.join(projectDir, 'tickets');
  // project/self.md, when there is one, against self@1 (its paths and names are the draft's checks: self check, check-pr)
  { const t = readText(path.join(projectDir, 'self.md')); if (t !== null) for (const e of selfDoc(t).errors) errors.push(`${projectRel}/self.md: ${e}`); }
  // project/exterior.md against exterior@1 (and its blobs, at the draft only): kit-135
  { const x = exteriorValidateLines(); errors.push(...x.errors.map((e) => `${EXTERIOR_REL()}: ${e}`)); warnings.push(...x.warnings.map((w) => `${EXTERIOR_REL()}: ${w}`)); }
  if (fs.existsSync(td)) for (const f of fs.readdirSync(td)) if (!f.startsWith('.') && !ts.has(f)) errors.push(`project/tickets/${f}/ has no ticket; if the supervisor added it since the log last landed, land the log first (log-sync, then merge --chore log) and run the check again`);
  // Checking one ticket, another ticket's own errors (D3 and the rest, written "<id>: …") come
  // from the live graph, not this branch: e.g. a dependency on a plan that reached main after the
  // branch did. They warn; the supervisor's own validate still fails on them.
  if (scope) for (let i = errors.length - 1; i >= 0; i--) {
    const owner = /^([a-z0-9-]+): /.exec(errors[i])?.[1];
    if (owner && owner !== scope && ts.has(owner)) warnings.push(`${errors.splice(i, 1)[0]}; not ${scope}'s to fix`);
  }

  for (const w of warnings) out(`warning: ${w}`);
  for (const e of errors) out(`error: ${e}`);
  out(`${ts.size} ticket(s), ${fs_.size} feature(s), ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}

// Why a ticket with no worker isn't waiting for one, or null if it is: the supervisor parked its
// last worker (a ruling stopped it), or its branch already carries a final review (it waits for
// the merge, not for a new worker).
// ===== holds: run, drain, park, let go (planning.md §1, holds) =====
//
// A goal's hold says what the fleet may do for it: run; drain (nothing new starts, in-flight work
// finishes and merges); park (sessions commit WIP, push, write a handoff and stop; ticket merges
// wait). Let go is the goal abandoned: parked, and reversible (goal decide <id> restore). Every
// piece of work belongs to a goal: a ticket to its feature's goals, a chore to Upkeep, a planner to
// the goal it plans. A fleet op (fleet drain, fleet park) sets every goal's hold at once and records
// what each was, so fleet undrain or unpark puts back what it changed.
export const HOLD_RANK = { run: 0, drain: 1, park: 2, 'let-go': 3 };
