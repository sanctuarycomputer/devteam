/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LINK_ID } from './links.mjs';
import { OWNER_ACTS } from './links.mjs';
import { QUESTION_RATING } from './log-sync.mjs';
import { SET_ASIDE_KINDS } from './lineage.mjs';
import { TREE_ID } from './links.mjs';
import { asList } from './base.mjs';
import { askableValue } from './settings.mjs';
import { canonical } from './settings.mjs';
import { commonDir } from './state.mjs';
import { die } from './base.mjs';
import { firstLine } from './reviews.mjs';
import { goalChangeProblem } from './log-sync.mjs';
import { goalOrderProblem } from './log-sync.mjs';
import { holdLine } from './panes.mjs';
import { inResponderWorktree } from './responder.mjs';
import { isObj } from './artifact-notes.mjs';
import { kitDir } from './state.mjs';
import { loadSettings } from './settings.mjs';
import { mainRoot } from './state.mjs';
import { noteSupervisorSelf } from './recover.mjs';
import { nowIso } from './base.mjs';
import { out } from './base.mjs';
import { ownerScoped } from './observe.mjs';
import { projectDir } from './state.mjs';
import { readJson } from './base.mjs';
import { readText } from './base.mjs';
import { realPath } from './state.mjs';
import { resolveCommit } from './log-sync.mjs';
import { runDir } from './state.mjs';
import { sh } from './base.mjs';
import { spawnSync } from 'node:child_process';
import { threadLineProblems } from './threads.mjs';
import { tmuxAsync } from './previews.mjs';
/* imports end */
export const SCHEMA = readJson(path.join(kitDir, 'schema', 'log.schema.json'));
export const ENVELOPE = ['v', 'id', 'type', 'op', 'at', 'by', 'channel'];
export const LINE_MAX = 4096;
// The most knowledge ids a decision (--on) or a start (the lessons its prompt carried) records, so its
// line stays under LINE_MAX.
export const KNOWLEDGE_IDS_MAX = 60;
export const TYPES = Object.keys(SCHEMA.$defs.types);
export const RANK = SCHEMA['x-authority'].rank;

// A JSON Schema checker for the subset the log schema uses. Returns a list of problems.
export function schemaErrors(schema, value, where) {
  const errs = [];
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (schema.const !== undefined && value !== schema.const) errs.push(`${where} must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${where} must be one of ${schema.enum.join(', ')}`);
  if (schema.type) {
    const want = asList(schema.type);
    const got = typeOf(value);
    if (!want.includes(got) && !(got === 'integer' && want.includes('number'))) errs.push(`${where} must be ${want.join(' or ')}`);
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${where} "${value.slice(0, 40)}" does not match ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${where} must be at least ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${where} must be at most ${schema.maxLength} characters`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${where} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${where} must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${where} needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${where} has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...schemaErrors(schema.items, v, `${where}[${i}]`)));
    if (schema.uniqueItems && new Set(value.map((v) => canonical(v))).size !== value.length) errs.push(`${where} names an item more than once`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${where}.${k} is required`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) errs.push(...schemaErrors(sub, v, `${where}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${where}.${k} is not a field here`);
    }
  }
  return errs;
}

// The writer a log file belongs to, from its name alone: owner-<yyyy-mm>, supervisor-<yyyy-mm>,
// plan-<feature> (a planner's graph, landed by its plan PR), plan-<feature>-<yyyy-mm> (the same
// planner's messages and observations, live), or a ticket id. Anything else counts for nothing.
export const MONTHLY = /^(owner|supervisor|plan-[a-z0-9]+(?:-[a-z0-9]+)*?)-\d{4}-\d{2}$/;
// responder.jsonl is the responder's (responder-1): it falls to the last rule, and no ticket id can be
// "responder", since a keyed ticket id carries a -NN- number.
export function writerOfFile(name) {
  const base = name.replace(/\.jsonl$/, '');
  const m = MONTHLY.exec(base);
  if (m) return m[1];
  if (/^(owner|supervisor)(-|$)/.test(base)) return null;
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(base) ? base : null;
}
export const writerClass = (by) => (by === 'owner' || by === 'supervisor' || by === 'responder' ? by : /^plan-[a-z0-9-]+$/.test(by) ? 'planner' : 'ticket');
export const planFeature = (by) => (writerClass(by) === 'planner' ? by.slice('plan-'.length) : null);

// The cheap checks every reader runs, so a line never grants more than its file's writer has: the
// line says who wrote it and the file agrees; a new id names its writer; the authority table lets
// this class create the type or set these fields; a planner stays inside its own feature.
export function integrity(o, file) {
  if (file && writerOfFile(file) !== o.by) return `by "${o.by}" does not match the file's writer "${writerOfFile(file) ?? '(not a log file)'}"`;
  const cls = writerClass(o.by);
  const auth = SCHEMA['x-authority'];
  const ids = SCHEMA['x-id'];
  const body = Object.keys(o).filter((k) => !ENVELOPE.includes(k) && !k.startsWith('__'));
  // The kit-lesson tag is the supervisor's suggestion to the box's operator, on its own knowledge:
  // nobody else's line carries it, new or set, whatever the authority table says about the type.
  if (o.type === 'knowledge' && 'kit_lesson' in o && cls !== 'supervisor') return "kit_lesson is the supervisor's tag on its own knowledge";
  // And the owner's note is the owner's, on a new line as on a set: no other line passes one off as theirs.
  if (o.type === 'knowledge' && 'owner_note' in o && cls !== 'owner') return "owner_note is the owner's";
  // Sending a lesson to the owner, and its plain line, are the supervisor's: the owner's own knowledge is kept as written.
  if (o.type === 'knowledge' && ('for_owner' in o || 'plain' in o) && cls !== 'supervisor') return "for_owner and plain are the supervisor's, on a lesson it sends the owner";
  // kit-252: who of the box's people gave it (from the gateway) is said on the owner's lines alone,
  // new or set: no other writer's line passes itself off as a person's.
  if ('person' in o && cls !== 'owner') return "person is on the owner's lines only";
  if (o.type === 'knowledge' && o.op === 'new' && cls !== 'owner' && o.for_owner !== true && ownerScoped(o.scope)) return 'a lesson about a kind of call only the owner makes is sent to the owner (for_owner)';
  if (o.op === 'new') {
    if (ids.keyed[o.type]) {
      if (!new RegExp(ids.keyed[o.type]).test(o.id)) return `a ${o.type} id must match ${ids.keyed[o.type]}`;
    } else {
      if (!new RegExp(ids.pattern).test(o.id) || !o.id.startsWith(`${ids.prefix[o.type]}-`)) return `a ${o.type} id looks like ${ids.prefix[o.type]}-<yyyymmdd>-<hhmmssmmm>-<writer>`;
      if (!o.id.endsWith(`-${o.by}`)) return `a new id ends with its writer, "-${o.by}"`;
    }
    if (!auth.new[cls].includes(o.type)) return `${cls} may not create ${o.type} lines`;
    // responder-1: the responder answers the owner's turns and hands work over, and no more. It asks
    // nothing, replies to no message (a reply's re closes what it names, in every reader of open
    // messages), and its observations are its own and of no kind readers honour by kind alone.
    if (cls === 'responder') {
      if (o.type === 'turn' && o.question !== undefined) return "the responder's turns ask nothing";
      if (o.type === 'message' && !['handoff', 'info'].includes(o.kind)) return 'the responder sends handoff and info messages only';
      if (o.type === 'message' && o.re !== undefined && o.re !== null) return 'the responder replies to no message (re)';
      if (o.type === 'observation' && o.source !== 'responder') return "the responder's observations have source responder";
      if (o.type === 'observation' && [...SET_ASIDE_KINDS, 'outcome', 'escaped-defect', 'discovery', 'footprint-refusal'].includes(o.kind)) return `the responder doesn't write ${o.kind} observations`;
      // a detector line is the kit's own (sensor, findings), which readers act on by detector alone
      if (o.type === 'observation' && o.detector !== undefined && o.detector !== null) return "the responder's observations name no detector";
    }
    // responder-1, from anyone: the fields that decide who owes a reply, so no reader keeps a line that breaks them
    if (o.type === 'message' && o.kind === 'handoff' && typeof o.thread !== 'string') return 'a handoff names its thread';
    if (o.type === 'message' && o.kind === 'handoff' && o.to !== 'supervisor') return 'a handoff goes to the supervisor';
    // artifact-notes-1, from anyone: a session's mark on an artifact note goes to the owner and names
    // the note, and only a session marks (the owner hands over, the responder hands off); its draft and
    // picture are on it and nothing else; a frame is the size the owner saw an artifact at
    if (o.type === 'message' && o.kind === 'addressed' && (typeof o.thread !== 'string' || o.to !== 'owner' || !['supervisor', 'planner', 'ticket'].includes(cls))) return "an addressed message goes to the owner, names its thread, and is a session's";
    if (o.type === 'message' && o.kind !== 'addressed' && (o.draft !== undefined || o.shot !== undefined)) return 'draft and shot are on an addressed message';
    if (o.type === 'thread' && o.frame !== undefined && !(isObj(o.subject) && o.subject.kind === 'artifact')) return "frame is on an artifact note's first line";
    if (o.type === 'turn' && o.routed_session !== undefined && cls !== 'owner') return "routed_session is on the owner's turns, with routed_to session";
    if (o.type === 'turn' && (o.routed_to !== undefined || o.delivered !== undefined) && cls !== 'owner') return "routed_to and delivered are on the owner's turns";
    if (o.type === 'turn' && o.delivered !== undefined && o.routed_to !== 'responder') return 'delivered goes with routed_to responder';
    // responder-2: a turn routed to a session names it, and only such a turn does; it names a ticket
    // or a planner, never the supervisor, the responder or the owner (the session owes the reply)
    if (o.type === 'turn' && (o.routed_to === 'session') !== (o.routed_session !== undefined)) return 'routed_session goes with routed_to session';
    if (o.type === 'turn' && o.routed_session !== undefined && (!['ticket', 'planner'].includes(writerClass(o.routed_session)) || writerOfFile(`${o.routed_session}.jsonl`) !== o.routed_session || !/^[a-z]/.test(o.routed_session))) return 'routed_session is a ticket or planner';
    // responder-2: a session's turn (a ticket's or a planner's, in a thread bound to it) answers and
    // asks nothing, and a planner's lives in its monthly file with its other non-graph lines
    if (o.type === 'turn' && (cls === 'ticket' || cls === 'planner') && o.question !== undefined) return "a session's turns ask nothing";
    if (o.type === 'turn' && cls === 'planner' && file && !MONTHLY.test(file.replace(/\.jsonl$/, ''))) return `a planner's turns belong in its monthly file, ${o.by}-<yyyy-mm>.jsonl`;
    if (o.type === 'turn' && o.pending !== undefined && cls === 'owner') return "pending is on a reply, never the owner's turn";
    // The owner's only acts are records: of publishing an artifact (artifact publish|unpublish), of
    // answering what the supervisor's terminal asked (pane answer), and of putting the goals in order
    // (goal order), and of asking for one of the supervisor's settings (owner-setting). Nobody else
    // writes those classes: an agent can't make the log say the owner published, gave a tool their
    // yes, ordered the goals or asked for a setting.
    if (o.type === 'act' && (cls === 'owner') !== OWNER_ACTS.includes(o.class)) return cls === 'owner' ? `the owner\'s acts are ${OWNER_ACTS.join(', ')} only` : `${o.class} is the owner\'s`;
    if (o.type === 'act' && cls === 'owner' && o.class === 'pane-answer' && (o.artifact !== undefined || o.tree !== undefined)) return 'a pane-answer act says what was answered and names no artifact';
    if (o.type === 'act' && 'proof' in o && !(cls === 'owner' && ['pane-answer', 'owner-setting'].includes(o.class) && isObj(o.proof))) return 'proof is the gateway\'s signature on the owner\'s pane-answer or owner-setting act, and nothing else carries one';
    // its shape, not today's allowlist: narrowing OWNER_ASKABLE later never breaks an old act
    if (o.type === 'act' && cls === 'owner' && o.class === 'owner-setting' && (typeof o.key !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(o.key) || !askableValue(o.value) || o.artifact !== undefined || o.tree !== undefined)) return 'an owner-setting act names a setting (key) and its value, a whole number from 1 to 20 or null (no limit), and no artifact';
    if (o.type === 'act' && cls === 'owner' && o.class === 'artifact-publish' && (!['publish', 'unpublish'].includes(o.what) || typeof o.artifact !== 'string' || !LINK_ID.test(o.artifact) || (o.what === 'publish' ? !(typeof o.tree === 'string' && TREE_ID.test(o.tree)) : o.tree !== undefined))) return 'an artifact-publish act names its artifact, and is what: publish with its tree or unpublish without one';
    if (cls === 'planner' && file && ['feature', 'ticket'].includes(o.type) && !isPlanFile(file)) return `a planner's ${o.type} lines belong in its plan file, ${o.by}.jsonl`;
    if (o.type === 'goal' && o.status && o.status !== 'draft' && cls !== 'owner') return 'only the owner creates a goal past draft';
    const f = planFeature(o.by);
    if (f && o.type === 'feature' && o.id !== f) return `${o.by} may only create the feature "${f}"`;
    if (f && o.type === 'ticket' && o.feature !== f) return `${o.by} may only create tickets of the feature "${f}"`;
    return null;
  }
  // artifact-notes-1: a picture (or why there is none) goes with the proposal it shows, and a
  // withdrawal with the ready it clears, so no reader keeps one without the other
  if (o.type === 'thread' && (o.shot !== undefined || o.noshot !== undefined) && !isObj(o.ready)) return 'shot and noshot go on a line that writes ready';
  if (o.type === 'thread' && o.unready !== undefined && o.ready !== null) return 'unready goes on a line that writes ready: null';
  if (o.type === 'thread' && o.shot !== undefined && o.noshot !== undefined) return 'shot and noshot never go together';
  const allowed = auth.set[o.type]?.[cls];
  if (!allowed) return `${cls} may not change ${o.type} lines`;
  if (!body.length) return 'a set line changes at least one field';
  const bad = body.filter((k) => !allowed.includes(k));
  if (bad.length) return `${cls} may not set ${o.type}.${bad.join(', ')}`;
  return null;
}

// Validate one parsed line in full: envelope, body against its type, required and set-only fields,
// then the integrity checks above.
// The envelope on its own, for a line parseLines sets aside (a newer kit's): its fields, the
// channel rule, and that its writer is its file's, so nothing admitted there fails these later in a
// kit that knows the rest. checkLine and integrity hold every other line to the same.
export function envelopeErrors(o, file) {
  const envelope = Object.fromEntries(ENVELOPE.filter((k) => k in o).map((k) => [k, o[k]]));
  const errs = schemaErrors({ ...SCHEMA, $defs: undefined, properties: { ...SCHEMA.properties, type: { type: 'string' } } }, envelope, 'line').map((e) => e.replace(/^line\./, ''));
  if (errs.length) return errs;
  if ((o.channel !== undefined) !== (o.by === 'owner')) errs.push('channel is on every owner line and no other');
  if (file && writerOfFile(file) !== o.by) errs.push(`by "${o.by}" does not match the file's writer "${writerOfFile(file) ?? '(not a log file)'}"`);
  return errs;
}
export function checkLine(o, file) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['not a JSON object'];
  const envelope = Object.fromEntries(ENVELOPE.filter((k) => k in o).map((k) => [k, o[k]]));
  const errs = schemaErrors({ ...SCHEMA, $defs: undefined }, envelope, 'line').map((e) => e.replace(/^line\./, ''));
  if (errs.length) return errs;
  if ((o.channel !== undefined) !== (o.by === 'owner')) errs.push('channel is on every owner line and no other');
  // A chat or thread line is an answer, with the owner's words in said, or what that answer
  // carried: its standing rule (knowledge citing the question), or its verdict on a goal (goal
  // decide). A thread answer names the owner's turn its words come from (answer --from-turn).
  // A correction the supervisor recorded from the owner's words (correct --from-turn|--from-chat --said) is one too.
  if (['chat', 'thread'].includes(o.channel) && !((o.type === 'question' && o.op === 'set' && typeof o.answer === 'string' && typeof o.said === 'string') || (o.type === 'knowledge' && o.op === 'new' && o.evidence?.length) || (o.type === 'goal' && o.op === 'set' && o.decision) || (['decision', 'act'].includes(o.type) && o.op === 'set' && isObj(o.corrected) && typeof o.corrected.said === 'string'))) errs.push(`a ${o.channel} line is an answer to a question with the owner's words in said, the standing rule or goal verdict that answer carried, or a correction with the owner's words in corrected.said`);
  // turn-authority-1: what a clause binding carries, and only where it can be
  const offsetsBad = (x) => Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]) && !(x[0] < x[1]);
  if (['decision', 'act'].includes(o.type) && isObj(o.corrected)) {
    const c = o.corrected;
    const bound = c.said !== undefined || c.said_at !== undefined || c.turn !== undefined;
    if (bound && (o.by !== 'owner' || !['chat', 'thread'].includes(o.channel))) errs.push("corrected.said, said_at and turn are on the owner's correction recorded from a thread or chat only");
    else if (o.channel === 'chat' && (c.said_at !== undefined || c.turn !== undefined)) errs.push('a correction recorded from chat has no turn or said_at');
    else if (o.channel === 'thread' && (c.turn === undefined || c.said_at === undefined)) errs.push("a correction recorded from a thread names the owner's turn and where in it the words are (corrected.turn, corrected.said_at)");
    if (['chat', 'thread'].includes(o.channel) && typeof c.said === 'string') {
      if (c.reason !== c.said) errs.push("a correction recorded from the owner's words gives them as its reason (corrected.reason is corrected.said)");
      if (c.severity !== undefined || c.impact !== undefined) errs.push("a correction recorded from the owner's words carries no severity or impact");
    }
    if (offsetsBad(c.said_at)) errs.push('corrected.said_at is [start, end] with start before end');
  }
  if (o.type === 'question') {
    if ((o.said_at !== undefined || o.answer_seen !== undefined) && !(o.channel === 'thread' && o.said_at !== undefined && o.answer_seen !== undefined)) errs.push('said_at and answer_seen go together, on an answer recorded from a clause of a thread turn (channel thread)');
    if ((o.owner_said_turn !== undefined || o.owner_said_at !== undefined) && !(o.owner_said_turn !== undefined && o.owner_said_at !== undefined && typeof o.owner_said === 'string')) errs.push('owner_said_turn and owner_said_at go together, with owner_said');
    if (o.seen !== undefined && o.about_turn === undefined) errs.push('seen goes with about_turn');
    if (o.about_turn !== undefined && o.thread === undefined) errs.push('about_turn is on a question asked in a thread (thread ask --turn)');
    if (offsetsBad(o.said_at)) errs.push('said_at is [start, end] with start before end');
    if (offsetsBad(o.owner_said_at)) errs.push('owner_said_at is [start, end] with start before end');
  }
  // dropped files go with the owner's own answer, never words the supervisor recorded for them
  if (o.type === 'question' && ['chat', 'thread'].includes(o.channel) && o.files !== undefined) errs.push(`files are on the owner's own answer, never one recorded from ${o.channel}`);
  if (o.type === 'question' && (o.channel === 'thread') !== (o.turn !== undefined)) errs.push(o.turn === undefined ? "a thread answer names the owner's turn its words come from (turn)" : 'turn is on an answer recorded from a thread (channel thread) only');
  const t = SCHEMA.$defs.types[o.type];
  const body = Object.fromEntries(Object.entries(o).filter(([k]) => !ENVELOPE.includes(k)));
  errs.push(...schemaErrors(t, body, o.type));
  if (o.type === 'thread' || o.type === 'turn' || o.type === 'message') errs.push(...threadLineProblems(o));
  if (o.op === 'new') {
    for (const k of t['x-required-new'] ?? []) if (!(k in body)) errs.push(`${o.type}.${k} is required`);
    for (const k of t['x-set-only'] ?? []) if (k in body) errs.push(`${o.type}.${k} is set later, not at creation`);
    if (o.type === 'question' && o.kind === 'one-way-door' && o.default) errs.push('a one-way door never has a default');
  }
  const i = integrity(o, file);
  if (i) errs.push(i);
  return errs;
}

// Parse a file's lines. Full validation is on by default (log-check, merge); readers skip the
// schema walk for speed but never the integrity checks. A type or a field a newer kit wrote goes to
// unknown instead (log-check says upgrade), never to errors: it grants nothing, since nothing here
// reads it. Writers stay strict: appendLog runs checkLine on the line as given.
export function parseLines(text, file, { firstLine = 1, validate = true } = {}) {
  const lines = [];
  const errors = [];
  const unknown = [];
  (text ?? '').split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    const n = i + firstLine;
    if (raw.length > LINE_MAX) return void errors.push(`${file}:${n}: longer than ${LINE_MAX} bytes`);
    let o;
    try {
      o = JSON.parse(raw);
    } catch {
      return void errors.push(`${file}:${n}: not valid JSON`);
    }
    if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o.type !== 'string' || !['new', 'set'].includes(o.op) || typeof o.id !== 'string' || typeof o.at !== 'string' || typeof o.by !== 'string') return void errors.push(`${file}:${n}: not a log line`);
    // a line this kit sets aside still has the envelope every kit checks (its writer is its file's,
    // v, at, channel), so nothing admitted here fails later in a kit that knows the rest
    const aside = (what) => { const e = envelopeErrors(o, file); if (e.length) errors.push(`${file}:${n}: ${e.join('; ')}`); else unknown.push(`${file}:${n}: ${what}`); };
    if (!TYPES.includes(o.type)) return void aside(`type "${o.type}"`);
    const props = SCHEMA.$defs.types[o.type].properties ?? {};
    const extra = Object.keys(o).filter((k) => !ENVELOPE.includes(k) && !Object.hasOwn(props, k));
    if (extra.length) {
      for (const k of extra) delete o[k];
      // a set line that carried only fields this kit doesn't know changes nothing it knows
      if (o.op === 'set' && !Object.keys(o).some((k) => !ENVELOPE.includes(k))) return void aside(`${o.type}.${extra.join(', ')}`);
      unknown.push(`${file}:${n}: ${o.type}.${extra.join(', ')}`);
    }
    const errs = validate ? checkLine(o, file) : [integrity(o, file)].filter(Boolean);
    if (errs.length) errors.push(`${file}:${n}: ${errs.join('; ')}`);
    else lines.push({ ...o, __file: file, __line: n });
  });
  // The cost: a field mistyped in a hand-written line is dropped here rather than refused (log-check
  // still names it), and a hand-written set like {status, foo} lands with foo set aside; a later kit
  // where foo is a field another writer owns refuses the whole line, so the fold of that record can
  // differ between kits.
  return { lines, errors, unknown };
}

// Build current state from every line. A `new` creates an object (a repeated id is ignored); a
// `set` changes fields, but a field keeps the rank of whoever last set it (the creator's rank at
// creation), and a lower-ranked writer can't change it: the owner's answer beats a later default.
// The three state rules a schema can't express are here too (see the schema's description).
export function fold(all) {
  const lines = [...all].sort((a, b) => a.at.localeCompare(b.at) || a.__file.localeCompare(b.__file) || a.__line - b.__line);
  const objects = new Map();
  const ignored = [];
  const goalApprovals = new Set();
  const orderPlans = new Map();
  // when each order answer was applied: its first act (approved_by), made in the pass above
  const orderApplied = new Map();
  let orderAppliedRead = false;
  const aliases = new Map();
  for (const l of lines) {
    if (l.op !== 'new') continue;
    if (objects.has(l.id)) {
      ignored.push({ line: l, why: 'duplicate id' });
      if (l.type === 'question') Object.defineProperty(objects.get(l.id), '__duplicate', { value: true }); // not copied into views or JSON
      continue;
    }
    const { v, op, __file, __line, at, by, ...body } = l;
    // kit-108: a thread the supervisor started is born open, with no outcome and no proposal, as
    // thread new writes it. A hand-written line carrying them (log-check refuses it: x-set-only, but
    // a reader runs integrity alone) must not have the supervisor resolve its own thread.
    if (body.type === 'thread' && by !== 'owner') {
      // and one not about a question or a goal is no thread of the supervisor's: readers drop it, as log-check refuses it
      if (!(isObj(body.subject) && body.subject.kind === 'item' && typeof body.subject.ref === 'string' && /^(question|goal):/.test(body.subject.ref))) { ignored.push({ line: l, why: "a supervisor's thread is about a question or a goal" }); continue; }
      delete body.status; delete body.outcome; delete body.ready;
    }
    const kept = body.type === 'goal' && body.kind === 'upkeep' ? [...objects.values()].find((o) => o.type === 'goal' && o.kind === 'upkeep') : null;
    if (kept) {
      // two writers made Upkeep at once: the earliest is the one, and the other's holds apply to it
      aliases.set(l.id, kept.id);
      ignored.push({ line: l, why: `a second upkeep goal; its changes apply to ${kept.id}` });
      continue;
    }
    const rank = RANK[writerClass(by)];
    objects.set(l.id, { ...body, created_at: at, created_by: by, updates: [], __rank: Object.fromEntries(Object.keys(body).map((k) => [k, rank])) });
    // a goal's title as made, for its title at a given time (goalTitleAt); not copied into views or JSON
    if (body.type === 'goal') Object.defineProperty(objects.get(l.id), '__bornTitle', { value: body.title });
  }
  for (const l of lines) {
    if (l.op !== 'set') continue;
    const obj = objects.get(aliases.get(l.id) ?? l.id);
    if (!obj) {
      ignored.push({ line: l, why: 'set on an unknown id' });
      continue;
    }
    if (obj.type !== l.type) {
      ignored.push({ line: l, why: `set says ${l.type} but ${l.id} is a ${obj.type}` });
      continue;
    }
    const cls = writerClass(l.by);
    const f = planFeature(l.by);
    if (f && (obj.type === 'feature' ? obj.id : obj.feature) !== f) {
      ignored.push({ line: l, why: `${l.by} may only change the feature "${f}" and its tickets` });
      continue;
    }
    // A goal's hold has its own rule (planning.md §1, holds): the owner's line always counts; the
    // supervisor's counts as a fleet op, the undo of a fleet op still in force on this goal, a drain
    // of a running goal, or the release of a drain it set itself. Anything else is ignored, with why.
    // hold_for and hold_until (what the hold waits on, and when to look again) are part of the hold
    // line: they apply with its hold, are refused with it, and a hold line without them leaves the
    // hold with no cause. A line carrying them with no hold changes neither.
    const holdKey = (k) => k === 'hold' || k === 'hold_for' || k === 'hold_until';
    const onlyHold = () => Object.keys(l).every((k) => ENVELOPE.includes(k) || k.startsWith('__') || holdKey(k));
    const holdWith = (h) => {
      obj.hold = h;
      obj.__holdBy = cls;
      for (const k of ['hold_for', 'hold_until']) if (l[k] !== undefined && l[k] !== null) obj[k] = l[k]; else delete obj[k];
      return { hold: h, ...(l.hold_for !== undefined ? { hold_for: l.hold_for } : {}), ...(l.hold_until !== undefined ? { hold_until: l.hold_until } : {}) };
    };
    let holdLine = null;
    if (obj.type === 'goal' && !l.hold && (l.hold_for !== undefined || l.hold_until !== undefined)) {
      ignored.push({ line: l, why: 'hold_for and hold_until go with a hold' });
      if (onlyHold()) continue;
    }
    if (obj.type === 'goal' && l.hold) {
      const cur = obj.hold ?? { mode: 'run' };
      const why = holdRefusal(l.hold, cur, obj.__holdBy ?? null, cls);
      if (why) {
        ignored.push({ line: l, why });
        if (onlyHold()) continue;
      } else holdLine = l.hold;
    }
    const holdOnly = obj.type === 'goal' && onlyHold();
    if (holdOnly) {
      if (holdLine) obj.updates.push({ at: l.at, by: l.by, ...(l.channel ? { channel: l.channel } : {}), ...holdWith(holdLine) });
      continue;
    }
    // A supervisor's line under an answer to a goal-change --order question is that answer applied, on
    // any goal, a draft too: exactly the goal's place in the order, once, set at the owner's rank (the
    // owner's own word, which an earlier priority of theirs must not outrank).
    const orderQ = obj.type === 'goal' && cls === 'supervisor' && typeof l.approved === 'string' ? objects.get(l.approved) : null;
    const byOrder = orderQ?.type === 'question' && isObj(orderQ.change) && Array.isArray(orderQ.change.order);
    if (byOrder) {
      if (!orderAppliedRead) {
        orderAppliedRead = true;
        for (const o of objects.values()) if (o.type === 'act' && typeof o.approved_by === 'string' && !(orderApplied.get(o.approved_by) <= o.created_at)) orderApplied.set(o.approved_by, o.created_at);
      }
      const problem = goalOrderProblem(orderQ, obj, l, orderPlans, objects, orderApplied);
      if (problem) {
        ignored.push({ line: l, why: `the supervisor sets a goal's place only as the owner's answer to ${l.approved} gave it: ${problem}` });
        continue;
      }
    } else if (obj.type === 'goal' && cls === 'supervisor' && (obj.status ?? 'draft') !== 'draft' && obj.kind !== 'upkeep') {
      const problem = !l.approved ? null : goalApprovals.has(l.approved) ? `${l.approved} already authorised a goal set` : goalChangeProblem(objects.get(l.approved), obj.id, l.approved, l);
      if (!l.approved || problem) {
        ignored.push({ line: l, why: l.approved ? `the supervisor edits a ${obj.status} goal only with an answered goal-change question: ${problem}` : 'the supervisor edits a goal only while it is a draft' });
        continue;
      }
    }
    // The supervisor tags only knowledge it wrote: on anyone else's (the owner's rule), the tag counts for nothing.
    const notOwnTag = obj.type === 'knowledge' && 'kit_lesson' in l && obj.created_by !== 'supervisor';
    if (notOwnTag) {
      ignored.push({ line: l, why: "kit_lesson is the supervisor's tag on knowledge it wrote" });
      if (Object.keys(l).every((k) => ENVELOPE.includes(k) || k.startsWith('__') || k === 'kit_lesson')) continue;
    }
    // A lesson sent to the owner is theirs as it was sent: the supervisor may only retire it, never
    // keep it or change its words or scope (the owner's Keep is of what they read). And one about a
    // kind of call only the owner makes is theirs, however it was filed (supervisor.md §4).
    if (obj.type === 'knowledge' && cls === 'supervisor') {
      const why = obj.for_owner === true ? (l.status === 'accepted' || ['statement', 'scope', 'plain'].some((k) => k in l) || ('for_owner' in l && l.for_owner !== true) ? 'a lesson sent to the owner is theirs to keep: the supervisor may only retire it' : null)
        : l.for_owner === true ? null
        : ownerScoped(l.scope) || (l.status === 'accepted' && ownerScoped(obj.scope)) ? 'a lesson about a kind of call only the owner makes is theirs to keep: the supervisor sends it to them' : null;
      if (why) { ignored.push({ line: l, why }); continue; }
    }
    if (obj.type === 'question' && l.status === 'defaulted' && !obj.default) {
      ignored.push({ line: l, why: 'the question has no default' });
      continue;
    }
    const rank = RANK[cls];
    const changed = holdLine ? holdWith(holdLine) : {};
    for (const [k, val] of Object.entries(l)) {
      // person (kit-252) says who gave this one line: it goes on its update, below, never on the
      // object, so an answered question's hash (questionHash) is the one the answer was given to
      if (ENVELOPE.includes(k) || k.startsWith('__') || k === 'hold' || k === 'person' || (obj.type === 'goal' && holdKey(k)) || (notOwnTag && k === 'kit_lesson')) continue;
      // an order line's priority is the owner's answer, at the owner's rank; its approved stays the
      // supervisor's, so a later answer's approved still lands and is seen as used
      const r = byOrder && k === 'priority' ? RANK.owner : rank;
      if ((obj.__rank[k] ?? -1) > r) continue;
      // a question's rating as first asked, so its history can show what a later rate replaced
      if (obj.type === 'question' && QUESTION_RATING.includes(k) && !(k in (obj.__asked ??= {}))) obj.__asked[k] = obj[k];
      obj[k] = val;
      obj.__rank[k] = r;
      changed[k] = val;
    }
    if (Object.keys(changed).length) obj.updates.push({ at: l.at, by: l.by, ...(l.channel ? { channel: l.channel } : {}), ...changed, ...(l.person !== undefined ? { person: l.person } : {}) });
    else ignored.push({ line: l, why: 'overridden by a higher-ranked writer' });
    if (obj.type === 'goal' && changed.approved) goalApprovals.add(changed.approved);
  }
  for (const o of objects.values()) {
    delete o.__rank;
    if (o.__holdBy !== undefined) { o.hold_by = o.__holdBy; delete o.__holdBy; }
  }
  return { objects, ignored };
}
// Why the fold ignores a hold line, or null when it counts. cur is the hold in force (run when
// none), curBy who set it. A supervisor never parks a single goal or releases the owner's hold.
export function holdRefusal(h, cur, curBy, cls) {
  if (cls === 'owner') return null;
  if (cls !== 'supervisor') return `${cls} may not change a goal's hold`;
  // An undo puts back exactly the hold the fleet op recorded as prior, nothing else.
  if (h.undoes) {
    if (cur.fleet !== h.undoes) return `this goal's hold is no longer the one ${h.undoes} set, so that fleet op doesn't undo it`;
    const p = cur.prior ?? { mode: 'run' };
    return h.mode === p.mode && (h.fleet ?? null) === (p.fleet ?? null) ? null : `undoing ${h.undoes} puts back ${p.mode}${p.fleet ? ` (${p.fleet})` : ''}, not ${h.mode}`;
  }
  // A fleet op in force marked a move (fleet park|drain --move on a held fleet): the same hold with move
  // added, nothing else changed. It only releases the claim, which unpark then park --move could too.
  if (h.fleet && h.move && cur.fleet === h.fleet && !cur.move) {
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    return h.mode === cur.mode && same(h.prior, cur.prior) && (h.reason ?? null) === (cur.reason ?? null) ? null : 'marking a fleet op a move changes nothing else in its hold';
  }
  // A fleet op only tightens (drain a running goal, park one not parked) and records what it replaced.
  if (h.fleet) {
    if (!['drain', 'park'].includes(h.mode)) return 'a fleet op drains or parks';
    if (h.mode === 'drain' ? cur.mode !== 'run' : cur.mode === 'park') return `a fleet ${h.mode} doesn't change a goal on ${cur.mode}`;
    return h.prior?.mode === cur.mode && (h.prior?.fleet ?? null) === (cur.fleet ?? null) ? null : `a fleet op records the hold it replaces (${cur.mode}) as prior`;
  }
  if (h.mode === 'drain') return cur.mode === 'run' ? null : `the supervisor drains only a running goal (this one is on ${cur.mode})`;
  if (h.mode === 'run') return cur.mode === 'drain' && curBy === 'supervisor' && !cur.fleet ? null : 'the supervisor releases only a drain it set';
  return 'only the owner parks a single goal (the supervisor may fleet park)';
}

// --- where the log lives ---
//
// A planner writes project/log/plan-<feature>.jsonl in its own worktree; the lines land with the
// plan PR, so a plan is reviewed before anyone can schedule from it. Everyone else writes
// run/log/<writer>.jsonl the moment something happens (gitignored, shared by every worktree) and
// the supervisor mirrors those files into project/log with the chore-log PR.

export const liveLogDir = () => path.join(runDir, 'log');
export const durableLogDir = () => path.join(projectDir, 'log');
// A planner's graph (feature and ticket lines) goes in plan-<feature>.jsonl in its worktree and
// lands with the plan PR; everything else it writes is live, like everyone else's.
export const GRAPH_TYPES = ['feature', 'ticket'];
export const logFileFor = (by, type) => (by === 'owner' || by === 'supervisor' || (writerClass(by) === 'planner' && !GRAPH_TYPES.includes(type)) ? `${by}-${nowIso().slice(0, 7)}.jsonl` : `${by}.jsonl`);
export const isPlanFile = (name) => name.startsWith('plan-') && !MONTHLY.test(name.replace(/\.jsonl$/, ''));

// The ticket/ or plan/ branch of the cwd's own checkout, as the caller can't steer it: every GIT_*
// variable of theirs is dropped, so GIT_DIR can't make a ticket/ checkout read as home's main, and no
// system or global config is read (a HOME or GIT_CONFIG_* of theirs with a bad value would make git
// fail, and a failed read finds no branch); any owner's checkout reads (safe.directory=*). That lets
// git read a checkout another user owns, whose own config could name programs (core.fsmonitor and
// the like); rev-parse and symbolic-ref run none, and every session runs as the same user as the
// owner, so this opens nothing new. The full ref: a short name gains a prefix when another ref has
// it too, and a branch with no commit yet has none (a HEAD set on refs/ticket/… or
// refs/tags/ticket/… by hand counts too). The name may hold any character and is kept whole:
// branch is kind/name; kind is null on any other branch, detached, or where there is no checkout.
// failed: git could not read a checkout that is there (a .git, up to the file system's edge, as git
// looks for one), which is not the same as no branch. own: git in that same environment.
export function sessionBranch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull });
  const cwd = process.cwd();
  const run = (args) => spawnSync('git', ['-c', 'safe.directory=*', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const own = (args) => { const r = run(args); return r.status === 0 ? r.stdout.replace(/\n$/, '') : null; };
  const r = run(['symbolic-ref', '-q', 'HEAD']);
  const ref = r.status === 0 ? r.stdout.replace(/\n$/, '') : '';
  // ticket first, for a ref set by hand that holds both
  const [, kind = null, name = null] = ref.match(/^refs\/(?:[^/]+\/)?(ticket)\/(.+)$/s) ?? ref.match(/^refs\/(?:[^/]+\/)?(plan)\/(.+)$/s) ?? [];
  // 1 is git's answer for a detached HEAD
  const failed = ![0, 1].includes(r.status) && (() => {
    try {
      for (let d = realPath(cwd), dev = fs.statSync(d).dev; fs.statSync(d).dev === dev; d = path.dirname(d)) {
        if (fs.existsSync(path.join(d, '.git'))) return true;
        if (path.dirname(d) === d) return false;
      }
    } catch {}
    return false;
  })();
  return { kind, name, branch: kind && `${kind}/${name}`, failed, own };
}
export function currentTicketId() {
  const { kind, name } = process.env.DEVTEAM_TICKET ? { kind: 'ticket', name: process.env.DEVTEAM_TICKET } : sessionBranch();
  if (kind !== 'ticket') return null;
  // a ticket of this name would write as someone it is not
  if (['supervisor', 'owner', 'responder', 'operator'].includes(name)) die(`"${name}" is no ticket: the name is reserved, so nothing is written as it; ${process.env.DEVTEAM_TICKET ? 'unset DEVTEAM_TICKET' : 'rename this checkout\'s branch'}`);
  return name;
}
// Who this process writes the log as: the responder (its role wins over a ticket, a feature or a
// branch), a ticket id, plan-<feature>, or supervisor. Never the owner.
export function logWriter() {
  if (process.env.DEVTEAM_ROLE === 'responder' || inResponderWorktree()) return 'responder';
  const t = currentTicketId();
  if (t) return t;
  if (process.env.DEVTEAM_FEATURE) return `plan-${process.env.DEVTEAM_FEATURE}`;
  const { kind, name } = sessionBranch();
  if (kind === 'plan' && ['supervisor', 'owner', 'responder', 'operator'].includes(name)) die(`"${name}" is no feature: the name is reserved, so nothing is written from branch plan/${name}; rename this checkout's branch`);
  // a failed read counts as no branch here: recover and the like run from a damaged checkout
  if (kind === 'plan') return `plan-${name}`;
  return 'supervisor';
}
// Owner commands run from the owner's terminal or the dashboard, never an agent session. A
// visibility measure, not a wall: appendLog stamps every owner line with its channel. The supervisor
// with no DEVTEAM_ROLE set on a command is caught by its pane: the one its own commands as the
// supervisor recorded (rememberSupervisorPane), or the one DEVTEAM_SUPERVISOR names. The dashboard's
// children run with no TMUX_PANE, wherever it was started. hint: what the supervisor does instead,
// for the command at hand. heard: the supervisor records the owner's words (answer, goal decide and
// correct with --from-chat or --from-turn): its role is needed there, and the session check below is
// the same.
export function ownerWriter(hint, { heard = false } = {}) {
  if (heard && (process.env.DEVTEAM_ROLE !== 'supervisor' || logWriter() !== 'supervisor')) die('the supervisor records what the owner said in a thread or in its session; in your own terminal, run the command without --from-chat or --from-turn; the supervisor runs it from home\'s main checkout');
  if (!heard && process.env.DEVTEAM_ROLE) die(`owner commands don't run in an agent session (DEVTEAM_ROLE=${process.env.DEVTEAM_ROLE})`);
  if (inResponderWorktree()) die("owner commands don't run in the responder's worktree");
  // A worker's or planner's session, whatever DEVTEAM_ROLE says: DEVTEAM_TICKET or DEVTEAM_FEATURE
  // set at all (a session that blanks one is still one), a checkout on a ticket/ or plan/ branch, a
  // folder under a .worktrees folder (every session's worktree, a detached one or another repo's
  // included; home's .worktrees by its real path too, for one that is a link), even with every
  // variable cleared, or DEVTEAM_HOME set (every worker, planner and responder has it) in a folder
  // that is no checkout of home's. git reads the cwd's own checkout (sessionBranch); where a checkout
  // is there and git can't read it, nothing says it is no session's.
  const session = (() => {
    for (const k of ['DEVTEAM_TICKET', 'DEVTEAM_FEATURE']) if (process.env[k] !== undefined) return `${k}=${JSON.stringify(process.env[k])}`;
    const { branch: b, failed, own } = sessionBranch();
    if (b) return `this checkout is on ${b}`;
    const cwd = realPath(process.cwd());
    const homeWt = realPath(path.join(mainRoot, '.worktrees'));
    if (cwd.split(path.sep).includes('.worktrees') || cwd.startsWith(`${homeWt}${path.sep}`)) return `${cwd} is under a .worktrees folder, where sessions work`;
    if (failed) return `git can't read the checkout at ${cwd}, so its branch isn't known; run git status there to see why`;
    if (process.env.DEVTEAM_HOME === undefined) return null;
    const common = own(['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return common && commonDir && realPath(common) === realPath(commonDir) ? null : `DEVTEAM_HOME is set, and ${cwd} is no checkout of home's; in your own terminal, unset DEVTEAM_HOME or run this from home's main checkout`;
  })();
  if (session) die(`owner commands don't run in a worker's or planner's session (${session}); ${heard ? "the supervisor records the owner's words from home's main checkout: run this there, with no DEVTEAM_TICKET or DEVTEAM_FEATURE set" : "the owner runs them in their own terminal from home's main checkout, or on the dashboard"}, and a session sends the supervisor what it needs`);
  if (heard) return { by: 'owner' };
  const pane = process.env.TMUX_PANE;
  if (!pane || !process.env.TMUX) return { by: 'owner' };
  const how = process.env.DEVTEAM_SUPERVISOR === pane ? 'DEVTEAM_SUPERVISOR in this environment names this pane as the supervisor\'s. If this is your own terminal, open this terminal without DEVTEAM_SUPERVISOR set'
    : markedPane(runDir) === pane ? `This pane was recorded as the supervisor's by a command it ran as the supervisor; it is the supervisor's if its agent runs here. If this is your own terminal, delete ${supervisorPaneMark(runDir)}: the supervisor records its own pane again with its next command`
    : null;
  if (how) die(`this is the supervisor's session${hint ? `: ${hint}` : ''}; the owner's commands run in their own terminal or on the dashboard. (${how}.)`);
  return { by: 'owner' };
}
export const ownerChannel = () => (process.env.DEVTEAM_CHANNEL === 'dashboard' ? 'dashboard' : 'cli');
// What the responder is told when it runs a supervisor's command: who does it, and how to hand it over.
export const responderRefusal = (what) => `${what}: the supervisor does this; hand it over: send supervisor "…" --kind handoff --thread <t-id>`;
export const supervisorOnly = (what) => {
  if (process.env.DEVTEAM_ROLE === 'responder' || logWriter() === 'responder') die(responderRefusal(what));
  if (logWriter() !== 'supervisor' || ['worker', 'planner'].includes(process.env.DEVTEAM_ROLE)) die(`${what}: the supervisor does this`);
  rememberSupervisorPane();
  noteSupervisorSelf();
};
// The supervisor is the owner's foreground agent session. When it runs inside tmux, its pane is
// recorded so workers' messages and the owner's answers can be typed into it; otherwise they wait
// in the log for its next tick.
export const supervisorPaneFile = (run) => path.join(run, 'supervisor-pane');
// supervisor-pane keeps the bare pane id, as older kits and the box's up-list read it, so its form
// never changes. supervisor-pane-role, beside it, holds the same id and is written only with a record
// made for the supervisor (rememberSupervisorPane, recover). A pane counts only when the two agree:
// an older kit took a role-less command's pane, perhaps the owner's own, and that bare record reads
// as no pane here, in this repo and in any other (machine status and tell), so nothing is typed into
// it and ownerWriter doesn't refuse the owner there. A repo on a kit from before recover is the
// exception (notedPaneOf): nothing there ever marks a pane, legacyRecover included, so its bare
// record is the only one it has. The cost: a supervisor on an older kit has no
// pane this kit uses until its kit is upgraded and it runs a command as the supervisor.
export const supervisorPaneMark = (run) => path.join(run, 'supervisor-pane-role');
export function markedPane(run) {
  const p = readText(supervisorPaneFile(run))?.trim();
  return p && readText(supervisorPaneMark(run))?.trim() === p ? p : null;
}
export function recordSupervisorPane(run, pane) {
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(supervisorPaneFile(run), pane);
  fs.writeFileSync(supervisorPaneMark(run), pane);
  // a new agent in it: no line of the owner's, nor a reading of its prompt, carries over (terminal@1 §11)
  sh('tmux', ['set-option', '-p', '-u', '-t', pane, '@devteam-owner-floor', ';', 'set-option', '-p', '-u', '-t', pane, '@devteam-prompt-readable']);
}
// Only a command run as the supervisor (DEVTEAM_ROLE=supervisor, as recover and the README start it)
// records its pane. A role-less command is the supervisor's too (supervisorOnly), but the owner's own
// terminal runs role-less, and taking its pane would have ownerWriter refuse the owner there.
export function rememberSupervisorPane() {
  const pane = process.env.TMUX_PANE;
  if (!pane || !process.env.TMUX || process.env.DEVTEAM_ROLE !== 'supervisor') return;
  if (markedPane(runDir) === pane) return;
  recordSupervisorPane(runDir, pane);
}

export function withLock(file, fn, { staleMs = 10000, waitMs = 15000 } = {}) {
  const lock = `${file}.lock`;
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock, { recursive: false });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const age = Date.now() - (fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      // either way: a lock dated in the future (the clock moved back) must not hold forever
      if (Math.abs(age) > staleMs) {
        fs.rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - start > waitMs) die(`timed out waiting for ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
// withLock's lock, for a caller that must never wait (the dashboard's tick): a lock held and fresh
// is undefined back, and fn never runs; a stale one (either way) is taken, once.
export function tryLock(file, fn, { staleMs = 10000 } = {}) {
  const lock = `${file}.lock`;
  for (let tries = 0; ; tries++) {
    try {
      fs.mkdirSync(lock, { recursive: false });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const at = fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs;
      if (tries || (at !== undefined && Math.abs(Date.now() - at) <= staleMs)) return undefined;
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
// The typing lock (kit-618, terminal@1 §11): every kit write into a pane holds <run>/type-lock-<pane
// id> for the whole write, so two writers, or a writer and the owner's key post, never interleave.
// The file holds its holder's pid and a token of that take's own; its mtime is the stamp, refreshed
// after each tmux call (touch). It is written whole beside the lock and linked into place, so a lock
// is never seen empty or half written. A waiter takes it over when the pid is dead, or when the stamp
// is 60 s old (either way: a clock moved back must not hold it forever), by renaming it to a name of
// its own and checking it renamed the lock it judged, by its inode and its text (another waiter's
// fresh lock is linked back). The text, not the inode alone, because a filesystem gives a file made
// after an unlink the freed inode again (ext4 does, every time). A holder unlinks, or stamps, only a
// lock whose inode and text are still its own, never the lock of someone who took over.
// Re-entrant along a call chain: in a CLI process, by the files this process holds (a nested take
// runs at once, and fn(outer) says whether it is the outermost, the hold that reads the floor). A
// target that doesn't resolve to a pane takes no lock, and its write goes on as before (tmux would
// refuse it anyway). Back: { value } (fn's), or { busy: true } when the wait ran out, nothing done.
export const typeLock = {
  // a stamp this old (or this far ahead: a clock moved back) is a holder gone
  STALE_MS: 60000,
  // lock file → its hold ({ ino, text }): the locks this process's synchronous chain holds (its
  // re-entrance), and those the dashboard's chains hold (typeLockAsync's, for touch only)
  held: new Map(),
  heldAsync: new Map(),
  seq: 0,
  file: (pane, run = runDir) => path.join(run, `type-lock-${pane}`),
  // the lock as it is now, or null: its inode and its text, read from one open file
  read(file) {
    let fd;
    try { fd = fs.openSync(file, 'r'); } catch { return null; }
    try { return { ino: fs.fstatSync(fd).ino, mtimeMs: fs.fstatSync(fd).mtimeMs, text: fs.readFileSync(fd, 'utf8') }; } catch { return null; } finally { fs.closeSync(fd); }
  },
  // still this hold's: the same inode and the same text (its token)
  ours: (file, hold) => { const now = typeLock.read(file); return !!now && now.ino === hold.ino && now.text === hold.text; },
  // one try: the hold taken ({ ino, text }), or null (someone else holds it); throws on anything but a held lock
  take(file) {
    const create = () => {
      const token = `${process.pid}-${++typeLock.seq}-${crypto.randomBytes(6).toString('hex')}`;
      const text = JSON.stringify({ pid: process.pid, at: Date.now(), token });
      const tmp = `${file}.new-${token}`;
      try {
        fs.writeFileSync(tmp, text, { flag: 'wx' });
        try { fs.linkSync(tmp, file); } catch (e) { if (e.code === 'EEXIST') return null; throw e; }
        return { ino: fs.statSync(tmp).ino, text };
      } finally { try { fs.unlinkSync(tmp); } catch {} }
    };
    const got = create();
    if (got !== null) return got;
    const was = typeLock.read(file);
    if (!was) return null; // let go meanwhile: the next try takes it
    let pid = null;
    try { pid = JSON.parse(was.text)?.pid; } catch {}
    let dead = false;
    if (Number.isInteger(pid) && pid > 0) { try { process.kill(pid, 0); } catch (e) { dead = e.code === 'ESRCH'; } }
    // unreadable, or no pid: dead once it is 60 s old, which the stamp's rule already says
    if (!dead && Math.abs(Date.now() - was.mtimeMs) < typeLock.STALE_MS) return null;
    const aside = `${file}.taken-${process.pid}-${++typeLock.seq}`;
    try { fs.renameSync(file, aside); } catch { return null; }
    const moved = typeLock.read(aside);
    if (moved?.ino !== was.ino || moved?.text !== was.text) {
      // another waiter took it over first, and this renamed its fresh lock: back where it was
      try { fs.linkSync(aside, file); } catch {}
      try { fs.unlinkSync(aside); } catch {}
      return null;
    }
    try { fs.unlinkSync(aside); } catch {}
    return create();
  },
  release(file, hold) {
    try { if (typeLock.ours(file, hold)) fs.unlinkSync(file); } catch {}
  },
  // the stamp of every lock this process holds (a holder has one pane's, or, in flushHeld, the same
  // window's pane's too), after each tmux call of a write
  touch() {
    const now = new Date();
    for (const [file, hold] of [...typeLock.held, ...typeLock.heldAsync]) { try { if (typeLock.ours(file, hold)) fs.utimesSync(file, now, now); } catch {} }
  },
  // the pane id a target names, or null
  pane: (out) => (/^%\d+$/.test(out?.trim() ?? '') ? out.trim() : null),
  run(target, fn, { run = runDir, waitMs = 10000 } = {}) {
    const pane = typeLock.pane(sh('tmux', ['display', '-p', '-t', target, '#{pane_id}']));
    if (!pane) return { value: fn(true) };
    const file = typeLock.file(pane, run);
    if (typeLock.held.has(file)) return { value: fn(false) };
    let hold = null;
    try {
      fs.mkdirSync(run, { recursive: true });
      for (const start = Date.now(); (hold = typeLock.take(file)) === null;) {
        if (Date.now() - start >= waitMs) return { busy: true };
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    } catch { return { value: fn(true) }; } // a run folder that can't hold a lock: written as before
    typeLock.held.set(file, hold);
    try { return { value: fn(true) }; } finally { typeLock.held.delete(file); typeLock.release(file, hold); }
  },
};
// The dashboard's typing lock: typeLock's file and rules, never blocking the server. The pane id comes
// from tmuxAsync, the wait polls with a timer, and the locks a chain holds are in an AsyncLocalStorage
// (loaded here, once), so one request's hold is never entered by another request's.
export async function typeLockAsync(target, fn, { run = runDir, waitMs = 10000 } = {}) {
  const { AsyncLocalStorage } = await (typeLockAsync.hooks ??= import('node:async_hooks'));
  const store = (typeLockAsync.store ??= new AsyncLocalStorage());
  const pane = typeLock.pane(await tmuxAsync(['display', '-p', '-t', target, '#{pane_id}']));
  if (!pane) return { value: await fn(true) };
  const file = typeLock.file(pane, run);
  const mine = store.getStore();
  if (mine?.has(file)) return { value: await fn(false) };
  let hold = null;
  try {
    fs.mkdirSync(run, { recursive: true });
    for (const start = Date.now(); (hold = typeLock.take(file)) === null;) {
      if (Date.now() - start >= waitMs) return { busy: true };
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } catch { return { value: await fn(true) }; }
  typeLock.heldAsync.set(file, hold);
  try { return { value: await store.run(new Set([...(mine ?? []), file]), () => fn(true)) }; } finally { typeLock.heldAsync.delete(file); typeLock.release(file, hold); }
}

export let mainRefCache;
export let mainShaCache;
export function mainRef() {
  if (mainRefCache !== undefined) return mainRefCache;
  const b = loadSettings().main_branch;
  for (const r of [`origin/${b}`, b]) { const sha = resolveCommit(r); if (sha) { mainShaCache = sha; return (mainRefCache = r); } }
  mainShaCache = null;
  return (mainRefCache = null);
}
// The commit mainRef() named when it was resolved: found with it, and dropped whenever it is.
export const mainSha = () => (mainRef(), mainShaCache);
