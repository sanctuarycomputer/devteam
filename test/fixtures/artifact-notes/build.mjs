// Writes the artifact-notes-1 fake (kit-143): one folder per case, each a log/ of hand-written lines
// and the expected.json its view must equal, and refused.json. Every expected value is written out
// here by hand from the contract's rules (docs/devteam/process/supervisor.md, ### Artifact notes),
// never read back from the kit's own view. Run it after changing a case, and commit what it writes:
//   node test/fixtures/artifact-notes/build.mjs
// Times are fixed (2026-11-20, 10:MM:NN, NN the case number), so every id is unique across folders
// and folders can be combined into one log.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHA = '3f7c2a9e1b0d4c5f6a7b8c9d0e1f2a3b4c5d6e7f';
const SUM_L = 'a1'.repeat(32);
const SUM_D = 'd4'.repeat(32);
const SHOT = { stamp: '20261120-100500000', w: 480, h: 320, src: 'plan-pricing', sha: SHA, dirty: false, anchor: 'found', dark: true, sum: { light: SUM_L, dark: SUM_D } };
const SHOT_LIGHT = { stamp: '20261120-100600000', w: 1400, h: 860, src: 'main', sha: SHA, dirty: true, anchor: 'point', dark: false, sum: { light: SUM_L } };
const ART = { kind: 'artifact', slug: 'pricing-mock', at: 'plan-pricing', path: 'index.html', anchor: { selector: '#trial', text: 'Start trial' } };
const FILE = { owner: 'owner-2026-11.jsonl', supervisor: 'supervisor-2026-11.jsonl', 'plan-pricing': 'plan-pricing-2026-11.jsonl', 'kit-9-x': 'kit-9-x.jsonl' };
const PREFIX = { thread: 't', turn: 'u', message: 'm' };

const two = (n) => String(n).padStart(2, '0');
const at = (n, mm) => `2026-11-20T10:${two(mm)}:${two(n)}.000Z`;
const idAt = (type, n, mm, by) => `${PREFIX[type]}-20261120-10${two(mm)}${two(n)}000-${by}`;
const tid = (n) => idAt('thread', n, 0, 'owner');

// One case: its lines in order, each made by a step helper; NN is the case number.
function lines(n, { subject = ART, frame } = {}) {
  const T = tid(n);
  const out = [];
  const env = (by, mm, o) => ({ v: 1, ...o, at: at(n, mm), by, ...(by === 'owner' ? { channel: 'cli' } : {}) });
  const s = {
    T,
    out,
    // the owner's thread new: the thread line and its first turn, at minute 0
    open(words = 'The trial button should say Start free trial.') {
      out.push(env('owner', 0, { id: T, type: 'thread', op: 'new', title: 'Start trial', ...(subject ? { subject } : {}), ...(frame ? { frame } : {}) }));
      out.push(env('owner', 0, { id: idAt('turn', n, 0, 'owner'), type: 'turn', op: 'new', thread: T, text: words }));
      return s;
    },
    turn(by, mm, text = by === 'owner' ? 'Not quite: make it green too.' : 'On it.') { out.push(env(by, mm, { id: idAt('turn', n, mm, by), type: 'turn', op: 'new', thread: T, text })); return s; },
    set(by, mm, fields) { out.push(env(by, mm, { id: T, type: 'thread', op: 'set', ...fields })); return s; },
    hand(mm, to) { return s.set('owner', mm, { handed: { to, at: at(n, mm) } }); },
    addressed(by, mm, extra = {}) {
      const m = env(by, mm, { id: idAt('message', n, mm, by), type: 'message', op: 'new', to: 'owner', kind: 'addressed', thread: T, text: 'Trial button now says Start free trial.', sha: SHA, draft: by, ...extra });
      out.push(m);
      return s;
    },
    ready(mm, extra = {}) { return s.set('supervisor', mm, { ready: { outcome: 'The trial button reads Start free trial.', at: at(n, mm) }, ...extra }); },
    unready(mm, reason = 'The mark no longer matches the page.') { return s.set('supervisor', mm, { ready: null, unready: { at: at(n, mm), reason } }); },
  };
  return s;
}
const mark = (n, by, mm, extra = {}) => ({ by, at: at(n, mm), note: 'Trial button now says Start free trial.', sha: SHA, draft: by, ...extra });
const readyOf = (n, mm) => ({ outcome: 'The trial button reads Start free trial.', at: at(n, mm) });
const handedOf = (n, mm, to) => ({ to, at: at(n, mm) });
// The view's note fields, null unless a case says otherwise; with is left out unless given.
const view = (o = {}) => ({ handed: null, addressed: null, check: null, shot: null, noshot: null, unready: null, frame: null, waiting: 'owner', ...o });

const CASES = [];
const add = (n, name, about, s, v, api) => CASES.push({ n, name, about, s, v, api });

{ const s = lines(1).open().hand(1, 'plan-pricing'); add(1, 'c01-handed', 'handed to a planner', s, view({ handed: handedOf(1, 1, 'plan-pricing'), waiting: 'session', with: 'plan-pricing' })); }
{ const s = lines(2).open().hand(1, 'plan-pricing').addressed('plan-pricing', 2); add(2, 'c02-handed-then-addressed', 'handed, then addressed by that session', s, view({ handed: handedOf(2, 1, 'plan-pricing'), addressed: mark(2, 'plan-pricing', 2), check: 'addressed' }), view({ handed: handedOf(2, 1, 'plan-pricing'), waiting: 'session', with: 'plan-pricing' })); }
{ const s = lines(3).open().hand(1, 'plan-pricing').addressed('plan-pricing', 2).turn('owner', 3); add(3, 'c03-owner-reply-after-addressed', 'the owner replies after the mark: handed and the mark clear', s, view()); }
{ const s = lines(4).open().hand(1, 'plan-pricing').addressed('plan-pricing', 2).set('owner', 3, { status: 'resolved' }).set('owner', 4, { status: 'open' }); add(4, 'c04-reopen-no-words-after-addressed', 'resolved then reopened with no words after the mark', s, view()); }
{ const s = lines(5).open().ready(1); add(5, 'c05-ready-on-artifact', 'the supervisor proposes resolving an artifact note', s, view({ check: 'ready', ready: readyOf(5, 1) })); }
{ const s = lines(6).open().hand(1, 'plan-pricing').addressed('kit-9-x', 2); add(6, 'c06-addressed-by-other-session', 'a mark from a session the note was not handed to', s, view({ handed: handedOf(6, 1, 'plan-pricing'), waiting: 'session', with: 'plan-pricing' })); }
{ const s = lines(7).open().hand(1, 'supervisor').addressed('supervisor', 2).turn('owner', 3); add(7, 'c07-addressed-older-than-owner-word', "a supervisor's mark older than the owner's last word", s, view()); }
{ const s = lines(8).open().hand(1, 'plan-pricing').addressed('plan-pricing', 2).addressed('kit-9-x', 3); add(8, 'c08-valid-then-other-session', 'a valid mark, then one from a session not handed to: the valid one stands', s, view({ handed: handedOf(8, 1, 'plan-pricing'), addressed: mark(8, 'plan-pricing', 2), check: 'addressed' }), view({ handed: handedOf(8, 1, 'plan-pricing'), waiting: 'session', with: 'plan-pricing' })); }
{ const s = lines(9, { subject: { ...ART, at: 'main' } }).open().hand(1, 'supervisor').addressed('supervisor', 2, { draft: 'chore-artifact-pricing-mock' }); add(9, 'c09-main-note-supervisor-chore', "a main note handed to the supervisor, addressed in its chore's worktree", s, view({ handed: handedOf(9, 1, 'supervisor'), addressed: mark(9, 'supervisor', 2, { draft: 'chore-artifact-pricing-mock' }), check: 'addressed' }), view({ handed: handedOf(9, 1, 'supervisor'), waiting: 'supervisor', with: 'supervisor' })); }
{ const s = lines(10, { subject: { kind: 'item', ref: 'ticket:checkout-04' } }).open().turn('supervisor', 1).ready(2); add(10, 'c10-ready-on-non-artifact', 'a ready on a thread that is not an artifact note: check stays null', s, view({ ready: readyOf(10, 2) })); }
{ const s = lines(11).open().ready(1, { shot: SHOT }); add(11, 'c11-ready-with-shot', "a ready carrying the supervisor's picture", s, view({ check: 'ready', ready: readyOf(11, 1), shot: SHOT })); }
{ const s = lines(12).open().hand(1, 'plan-pricing').addressed('plan-pricing', 2, { shot: SHOT_LIGHT }); add(12, 'c12-addressed-with-shot', "a mark carrying its picture", s, view({ handed: handedOf(12, 1, 'plan-pricing'), addressed: mark(12, 'plan-pricing', 2), check: 'addressed', shot: SHOT_LIGHT }), view({ handed: handedOf(12, 1, 'plan-pricing'), waiting: 'session', with: 'plan-pricing' })); }
{ const s = lines(13).open().hand(1, 'plan-pricing').addressed('plan-pricing', 2).unready(3); add(13, 'c13-unready-after-addressed', 'the supervisor withdraws the mark: back with the session', s, view({ handed: handedOf(13, 1, 'plan-pricing'), unready: { at: at(13, 3), reason: 'The mark no longer matches the page.' }, waiting: 'session', with: 'plan-pricing' })); }
{ const s = lines(14).open().hand(1, 'plan-pricing').addressed('plan-pricing', 2).unready(3).addressed('plan-pricing', 4); add(14, 'c14-addressed-after-unready', 'a new mark after the withdrawal, to check again', s, view({ handed: handedOf(14, 1, 'plan-pricing'), addressed: mark(14, 'plan-pricing', 4), check: 'addressed' }), view({ handed: handedOf(14, 1, 'plan-pricing'), unready: { at: at(14, 3), reason: 'The mark no longer matches the page.' }, waiting: 'session', with: 'plan-pricing' })); }
{ const s = lines(15).open().hand(1, 'plan-pricing').addressed('plan-pricing', 2).unready(3).turn('owner', 4); add(15, 'c15-owner-turn-after-unready', "an owner turn after the withdrawal clears it and leaves the note open", s, view()); }
{ const s = lines(16, { frame: { w: 1400, h: 860, hash: '#annual' } }).open(); add(16, 'c16-frame', 'the frame the owner saw, carried as frame', s, view({ frame: { w: 1400, h: 860, hash: '#annual' } })); }
{ const s = lines(17).open().ready(1, { noshot: 'no-change' }); add(17, 'c17-ready-noshot', 'a ready --no-change: no picture, and noshot says why', s, view({ check: 'ready', ready: readyOf(17, 1), noshot: 'no-change' })); }
{ const s = lines(18).open().hand(1, 'supervisor'); add(18, 'c18-handed-to-supervisor', 'handed to the supervisor, which has not written since', s, view({ handed: handedOf(18, 1, 'supervisor'), waiting: 'supervisor', with: 'supervisor' })); }
{ const s = lines(19).open().hand(1, 'supervisor').turn('supervisor', 2); add(19, 'c19-supervisor-turn-after-handed', "handed to the supervisor, then its first turn: it is at work", s, view({ handed: handedOf(19, 1, 'supervisor'), waiting: 'session', with: 'supervisor' })); }
{ const s = lines(20).open(); add(20, 'c20-open-never-handed', 'an open note with an owner turn, never handed over', s, view()); }
{ const s = lines(21).open().hand(1, 'plan-pricing').hand(2, 'kit-9-x').addressed('plan-pricing', 3); add(21, 'c21-handed-twice', 'handed to one session, then another: the newer wins, the first session marks for nothing', s, view({ handed: handedOf(21, 2, 'kit-9-x'), waiting: 'session', with: 'kit-9-x' })); }
{ const s = lines(22).open().ready(1).unready(2).turn('owner', 3); add(22, 'c22-ready-unready-owner-turn', 'a ready, its withdrawal, then an owner turn: nothing proposed, nothing withdrawn', s, view({ ready: null })); }
{ const s = lines(23).open().hand(1, 'plan-pricing').addressed('plan-pricing', 2).set('owner', 3, { status: 'resolved', outcome: 'Done.' }); add(23, 'c23-resolved', 'a resolved note that was handed and addressed', s, view()); }
// read-only: each holds a line log-check refuses, read as a reader finds it
{ const s = lines(24).open().hand(1, 'owner'); add(24, 'r1-handed-to-owner', 'a hand-written handed naming the owner: no hand-over', s, view()); }
{ const s = lines(25).open().hand(1, 'plan-pricing').addressed('plan-pricing', 2).addressed('plan-pricing', 3, { text: 42 }); add(25, 'r2-addressed-text-not-string', 'a newer mark whose text is not a string is skipped, and hides nothing', s, view({ handed: handedOf(25, 1, 'plan-pricing'), addressed: mark(25, 'plan-pricing', 2), check: 'addressed' }), view({ handed: handedOf(25, 1, 'plan-pricing'), waiting: 'session', with: 'plan-pricing' })); }
{ const s = lines(26).open().set('owner', 1, { handed: { at: at(26, 1) } }); add(26, 'r3-handed-without-to', 'a hand-written handed with no to: no hand-over', s, view()); }
const READ_ONLY = ['r1-handed-to-owner', 'r2-addressed-text-not-string', 'r3-handed-without-to'];

// The refused lines, each alone beside c01's log (its thread, at minutes 30 and on). task: the plan
// task whose change refuses it (1: the schema and its authority table; 2: integrity and the byte
// rules). readDropped: integrity refuses it, so every reader drops it, not only log-check.
const T1 = tid(1);
// their own hours (12:00 on), a second past each minute, so they sort after every case line
const rat = (k) => `2026-11-20T${12 + Math.floor(k / 60)}:${two(k % 60)}:01.000Z`;
const rid = (type, k, by) => `${PREFIX[type]}-20261120-${12 + Math.floor(k / 60)}${two(k % 60)}01000-${by}`;
const r = (mm, by, o) => ({ v: 1, ...o, at: rat(mm), by, ...(by === 'owner' ? { channel: 'cli' } : {}) });
const setT = (mm, by, fields) => r(mm, by, { id: T1, type: 'thread', op: 'set', ...fields });
const newT = (mm, fields) => r(mm, 'owner', { id: rid('thread', mm, 'owner'), type: 'thread', op: 'new', title: 'Start trial', subject: ART, ...fields });
const msg = (mm, by, fields) => r(mm, by, { id: rid('message', mm, by), type: 'message', op: 'new', to: 'owner', kind: 'addressed', thread: T1, text: 'Trial button now says Start free trial.', ...fields });
const READY = (mm) => ({ outcome: 'Done.', at: rat(mm) });
const UNREADY = (mm) => ({ at: rat(mm), reason: 'The mark no longer matches the page.' });
const refused = {};
const no = (name, task, by, line, why, readDropped) => { refused[name] = { task, by, file: FILE[by], line, why, readDropped }; };
let m = 0;
// task 1: the authority table (integrity's allowlist, on every read)
for (const [by, cls] of [['plan-pricing', 'planner'], ['kit-9-x', 'ticket']]) {
  no(`${cls} handed`, 1, by, setT(m, by, { handed: { to: by, at: rat(m) } }), `${cls} may not change thread lines`, true); m++;
  no(`${cls} unready`, 1, by, setT(m, by, { ready: null, unready: UNREADY(m) }), `${cls} may not change thread lines`, true); m++;
  no(`${cls} shot`, 1, by, setT(m, by, { ready: READY(m), shot: SHOT }), `${cls} may not change thread lines`, true); m++;
  no(`${cls} noshot`, 1, by, setT(m, by, { ready: READY(m), noshot: 'no-change' }), `${cls} may not change thread lines`, true); m++;
}
no('supervisor handed', 1, 'supervisor', setT(m, 'supervisor', { handed: { to: 'supervisor', at: rat(m) } }), 'supervisor may not set thread\\.handed', true); m++;
no('owner unready', 1, 'owner', setT(m, 'owner', { ready: null, unready: UNREADY(m) }), 'owner may not set thread\\.ready, unready', true); m++;
no('owner shot', 1, 'owner', setT(m, 'owner', { ready: READY(m), shot: SHOT }), 'owner may not set thread\\.ready, shot', true); m++;
no('owner noshot', 1, 'owner', setT(m, 'owner', { ready: READY(m), noshot: 'no-change' }), 'owner may not set thread\\.ready, noshot', true); m++;
no('owner frame on a set line', 1, 'owner', setT(m, 'owner', { frame: { w: 1400, h: 860, hash: '' } }), 'owner may not set thread\\.frame', true); m++;
// task 1: the schema walk (write and log-check only)
for (const [w, h, why] of [[319, 860, 'thread\\.frame\\.w must be at least 320'], [3841, 860, 'thread\\.frame\\.w must be at most 3840'], [400.5, 860, 'thread\\.frame\\.w must be integer'], [1400, 239, 'thread\\.frame\\.h must be at least 240'], [1400, 2161, 'thread\\.frame\\.h must be at most 2160']]) { no(`frame ${w}x${h}`, 1, 'owner', newT(m, { frame: { w, h, hash: '' } }), why, false); m++; }
no('frame hash without #', 1, 'owner', newT(m, { frame: { w: 1400, h: 860, hash: 'annual' } }), 'thread\\.frame\\.hash "annual" does not match', false); m++;
no('frame without hash', 1, 'owner', newT(m, { frame: { w: 1400, h: 860 } }), 'thread\\.frame\\.hash is required', false); m++;
no('noshot other', 1, 'supervisor', setT(m, 'supervisor', { ready: READY(m), noshot: 'other' }), 'thread\\.noshot must be one of no-change', false); m++;
no('shot anchor moved', 1, 'supervisor', setT(m, 'supervisor', { ready: READY(m), shot: { ...SHOT, anchor: 'moved' } }), 'thread\\.shot\\.anchor must be one of found, changed, hidden, gone, point', false); m++;
no('shot sum not hex', 1, 'supervisor', setT(m, 'supervisor', { ready: READY(m), shot: { ...SHOT, sum: { light: 'z'.repeat(64), dark: SUM_D } } }), 'thread\\.shot\\.sum\\.light "z+" does not match', false); m++;
no('shot w over 3840', 1, 'supervisor', setT(m, 'supervisor', { ready: READY(m), shot: { ...SHOT, w: 3841 } }), 'thread\\.shot\\.w must be at most 3840', false); m++;
no('shot src origin', 1, 'supervisor', setT(m, 'supervisor', { ready: READY(m), shot: { ...SHOT, src: 'origin:main' } }), 'thread\\.shot\\.src "origin:main" does not match', false); m++;
no('shot missing stamp', 1, 'supervisor', setT(m, 'supervisor', { ready: READY(m), shot: (({ stamp, ...x }) => x)(SHOT) }), 'thread\\.shot\\.stamp is required', false); m++;
no('handed without to', 1, 'owner', setT(m, 'owner', { handed: { at: rat(m) } }), 'thread\\.handed\\.to is required', false); m++;
no('handed extra key', 1, 'owner', setT(m, 'owner', { handed: { to: 'plan-pricing', at: rat(m), by: 'owner' } }), 'thread\\.handed\\.by is not a field here', false); m++;
no('unready without reason', 1, 'supervisor', setT(m, 'supervisor', { ready: null, unready: { at: rat(m) } }), 'thread\\.unready\\.reason is required', false); m++;
no('addressed thread x-1', 1, 'plan-pricing', msg(m, 'plan-pricing', { thread: 'x-1' }), 'message\\.thread "x-1" does not match', false); m++;
no('addressed draft main', 1, 'plan-pricing', msg(m, 'plan-pricing', { draft: 'main' }), 'message\\.draft "main" does not match', false); m++;
no('addressed draft a/b', 1, 'plan-pricing', msg(m, 'plan-pricing', { draft: 'a/b' }), 'message\\.draft "a/b" does not match', false); m++;
no('addressed shot anchor moved', 1, 'plan-pricing', msg(m, 'plan-pricing', { shot: { ...SHOT, anchor: 'moved' } }), 'message\\.shot\\.anchor must be one of', false); m++;
// task 2: integrity's pairings (on every read: readDropped)
no('shot without ready', 2, 'supervisor', setT(m, 'supervisor', { shot: SHOT }), 'shot and noshot go on a line that writes ready', true); m++;
no('noshot without ready', 2, 'supervisor', setT(m, 'supervisor', { noshot: 'no-change' }), 'shot and noshot go on a line that writes ready', true); m++;
no('shot with ready null', 2, 'supervisor', setT(m, 'supervisor', { ready: null, shot: SHOT }), 'shot and noshot go on a line that writes ready', true); m++;
no('unready without ready', 2, 'supervisor', setT(m, 'supervisor', { unready: UNREADY(m) }), 'unready goes on a line that writes ready: null', true); m++;
no('unready with a ready', 2, 'supervisor', setT(m, 'supervisor', { ready: READY(m), unready: UNREADY(m) }), 'unready goes on a line that writes ready: null', true); m++;
no('shot and noshot', 2, 'supervisor', setT(m, 'supervisor', { ready: READY(m), shot: SHOT, noshot: 'no-change' }), 'shot and noshot never go together', true); m++;
no('frame on an item subject', 2, 'owner', newT(m, { subject: { kind: 'item', ref: 'ticket:checkout-04' }, frame: { w: 1400, h: 860, hash: '' } }), "frame is on an artifact note's first line", true); m++;
no('frame with no subject', 2, 'owner', r(m, 'owner', { id: rid('thread', m, 'owner'), type: 'thread', op: 'new', title: 'Start trial', frame: { w: 1400, h: 860, hash: '' } }), "frame is on an artifact note's first line", true); m++;
no('addressed to the supervisor', 2, 'plan-pricing', msg(m, 'plan-pricing', { to: 'supervisor' }), "an addressed message goes to the owner, names its thread, and is a session's", true); m++;
no('addressed by the owner', 2, 'owner', msg(m, 'owner', {}), "an addressed message goes to the owner, names its thread, and is a session's", true); m++;
no('addressed with no thread', 2, 'plan-pricing', (({ thread, ...x }) => x)(msg(m, 'plan-pricing', {})), "an addressed message goes to the owner, names its thread, and is a session's", true); m++;
no('draft on an info', 2, 'plan-pricing', msg(m, 'plan-pricing', { to: 'supervisor', kind: 'info', thread: undefined, draft: 'plan-pricing' }), 'draft and shot are on an addressed message', true); m++;
no('shot on an info', 2, 'kit-9-x', msg(m, 'kit-9-x', { to: 'supervisor', kind: 'info', thread: undefined, shot: SHOT }), 'draft and shot are on an addressed message', true); m++;
// task 2: the byte and format rules (write and log-check only)
no('handed to the owner', 2, 'owner', setT(m, 'owner', { handed: { to: 'owner', at: rat(m) } }), 'thread\\.handed\\.to is a session \\(supervisor, plan-<feature> or a ticket\\)', false); m++;
no('handed to the responder', 2, 'owner', setT(m, 'owner', { handed: { to: 'responder', at: rat(m) } }), 'thread\\.handed\\.to is a session \\(supervisor, plan-<feature> or a ticket\\)', false); m++;
no('handed at not ISO', 2, 'owner', setT(m, 'owner', { handed: { to: 'plan-pricing', at: 'yesterday' } }), 'thread\\.handed\\.at is an ISO timestamp', false); m++;
no('unready at not ISO', 2, 'supervisor', setT(m, 'supervisor', { ready: null, unready: { at: '2026-11-20', reason: 'The mark no longer matches the page.' } }), 'thread\\.unready\\.at is an ISO timestamp', false); m++;
no('unready reason 11 bytes', 2, 'supervisor', setT(m, 'supervisor', { ready: null, unready: { at: rat(m), reason: 'Not the page' .slice(0, 11) } }), 'thread\\.unready\\.reason is one line of 12 to 300 bytes', false); m++;
no('unready reason two lines', 2, 'supervisor', setT(m, 'supervisor', { ready: null, unready: { at: rat(m), reason: 'The mark moved.\nLook again.' } }), 'thread\\.unready\\.reason is one line of 12 to 300 bytes', false); m++;
no('unready reason 301 bytes', 2, 'supervisor', setT(m, 'supervisor', { ready: null, unready: { at: rat(m), reason: 'é'.repeat(150) + 'x' } }), 'thread\\.unready\\.reason is one line of 12 to 300 bytes', false); m++;
no('frame hash 201 bytes', 2, 'owner', newT(m, { frame: { w: 1400, h: 860, hash: `#${'é'.repeat(100)}` } }), 'thread\\.frame\\.hash is one line of at most 200 bytes', false); m++;
no('frame hash control', 2, 'owner', newT(m, { frame: { w: 1400, h: 860, hash: '#a\u0007b' } }), 'thread\\.frame\\.hash is one line of at most 200 bytes', false); m++;
no('addressed text two lines', 2, 'plan-pricing', msg(m, 'plan-pricing', { text: 'Done.\nLook again.' }), "an addressed message's text is one line of at most 300 bytes", false); m++;
no('addressed text 301 bytes', 2, 'plan-pricing', msg(m, 'plan-pricing', { text: 'x'.repeat(301) }), "an addressed message's text is one line of at most 300 bytes", false); m++;
no('thread shot dark without sum.dark', 2, 'supervisor', setT(m, 'supervisor', { ready: READY(m), shot: { ...SHOT, sum: { light: SUM_L } } }), 'thread\\.shot\\.dark goes with sum\\.dark', false); m++;
no('thread shot sum.dark without dark', 2, 'supervisor', setT(m, 'supervisor', { ready: READY(m), shot: { ...SHOT_LIGHT, sum: { light: SUM_L, dark: SUM_D } } }), 'thread\\.shot\\.dark goes with sum\\.dark', false); m++;
no('message shot dark without sum.dark', 2, 'plan-pricing', msg(m, 'plan-pricing', { shot: { ...SHOT, sum: { light: SUM_L } } }), 'message\\.shot\\.dark goes with sum\\.dark', false); m++;
if (m > 119) throw new Error(`too many refused lines for two hours of minutes: ${m}`);

// The valid shapes DW3 names, each alone beside c01's log, which log-check accepts.
const valid = {};
let v = 0;
const ok = (name, by, line) => { valid[name] = { by, file: FILE[by], line }; };
const vat = (k) => `2026-11-20T11:${two(k)}:01.000Z`;
const vid = (type, k, by) => `${PREFIX[type]}-20261120-11${two(k)}01000-${by}`;
const vr = (k, by, o) => ({ v: 1, ...o, at: vat(k), by, ...(by === 'owner' ? { channel: 'cli' } : {}) });
const vmsg = (k, by, f) => vr(k, by, { id: vid('message', k, by), type: 'message', op: 'new', to: 'owner', kind: 'addressed', thread: T1, text: 'Trial button now says Start free trial.', draft: 'plan-pricing', ...f });
const vnew = (k, f) => vr(k, 'owner', { id: vid('thread', k, 'owner'), type: 'thread', op: 'new', title: 'Start trial', subject: ART, ...f });
ok('addressed without shot', 'plan-pricing', vmsg(v++, 'plan-pricing', {}));
ok('addressed with shot, dark', 'plan-pricing', vmsg(v++, 'plan-pricing', { shot: SHOT }));
ok('addressed with shot, light only', 'kit-9-x', vmsg(v++, 'kit-9-x', { shot: SHOT_LIGHT, draft: 'kit-9-x' }));
ok('addressed by the supervisor, no draft', 'supervisor', (({ draft, ...x }) => x)(vmsg(v++, 'supervisor', {})));
for (const [w, h, hash] of [[320, 240, ''], [3840, 2160, '#annual'], [320, 2160, '#'], [3840, 240, `#${'a'.repeat(199)}`]]) ok(`frame ${w}x${h} hash ${hash.length}`, 'owner', vnew(v++, { frame: { w, h, hash } }));
ok('unready with ready null', 'supervisor', vr(v, 'supervisor', { id: T1, type: 'thread', op: 'set', ready: null, unready: { at: vat(v++), reason: 'The mark no longer matches the page.' } }));
ok('ready with noshot', 'supervisor', vr(v, 'supervisor', { id: T1, type: 'thread', op: 'set', ready: { outcome: 'Done.', at: vat(v) }, noshot: 'no-change' })); v++;
ok('ready with shot', 'supervisor', vr(v, 'supervisor', { id: T1, type: 'thread', op: 'set', ready: { outcome: 'Done.', at: vat(v) }, shot: SHOT_LIGHT })); v++;
ok('owner handed to a ticket', 'owner', vr(v, 'owner', { id: T1, type: 'thread', op: 'set', handed: { to: 'kit-9-x', at: vat(v) } })); v++;
ok('unready reason 12 bytes', 'supervisor', vr(v, 'supervisor', { id: T1, type: 'thread', op: 'set', ready: null, unready: { at: vat(v), reason: 'Look again: ' } })); v++;
ok('unready reason 300 bytes', 'supervisor', vr(v, 'supervisor', { id: T1, type: 'thread', op: 'set', ready: null, unready: { at: vat(v), reason: 'é'.repeat(150) } })); v++;
ok('addressed text 300 bytes', 'plan-pricing', vmsg(v++, 'plan-pricing', { text: 'x'.repeat(300) }));

// write it all
for (const e of fs.readdirSync(HERE, { withFileTypes: true })) if (e.isDirectory() && /^(c|r)\d\d-/.test(e.name)) fs.rmSync(path.join(HERE, e.name), { recursive: true, force: true });
for (const c of CASES) {
  const dir = path.join(HERE, c.name);
  const byFile = new Map();
  for (const l of c.s.out) {
    const f = FILE[l.by];
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(JSON.stringify(l));
  }
  fs.mkdirSync(path.join(dir, 'log'), { recursive: true });
  for (const [f, ls] of byFile) fs.writeFileSync(path.join(dir, 'log', f), `${ls.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'expected.json'), `${JSON.stringify({ about: c.about, thread: c.s.T, view: c.v, ...(c.api ? { api: c.api } : {}) }, null, 1)}\n`);
}
fs.writeFileSync(path.join(HERE, 'refused.json'), `${JSON.stringify({ about: "artifact-notes-1's refused lines (kit-143). Each case is one hand-written line, placed alone beside c01-handed's log in its writer's file, that log-check refuses with words matching why (a regex). task: the change that refuses it (1 the schema and its authority table, 2 integrity and the byte rules). readDropped: integrity refuses it, so every reader drops it too. valid: the shapes log-check accepts, each alone beside the same log. readOnly: fixture folders holding a line log-check refuses on purpose, read as a reader finds them.", cases: refused, valid, readOnly: READ_ONLY }, null, 1)}\n`);
console.log(`${CASES.length} cases, ${Object.keys(refused).length} refused, ${Object.keys(valid).length} valid`);
