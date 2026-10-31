// devteam log: the append-only record of observe, orient, decide and act (process/log.md).
// Pure functions only: line validation, the authority table, and the fold. No I/O, no git.
//
// One JSON object per line. One file per writer:
//   owner-YYYY-MM.jsonl, supervisor-YYYY-MM.jsonl, <ticket-id>.jsonl, plan-<feature>.jsonl
// Every line carries an envelope: { v, id, type, op, at, by }. `op: "new"` creates an object;
// `op: "set"` with the same id changes fields on it. Nothing is ever edited or deleted.

export const LOG_VERSION = 1;
export const LINE_MAX = 4096;
export const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Shared id pattern: <prefix>-<yyyymmdd>-<hhmmss>[mmm]-<writer>. The old question ids
// (q-yyyymmdd-hhmmss-slug) match too, so links in old PR bodies keep working.
export const ID_RE = /^[a-z]-\d{8}-\d{6}(\d{3})?-[a-z0-9]+(-[a-z0-9]+)*$/;
export const ID_IN_TEXT_RE = /\b[a-z]-\d{8}-\d{6}(\d{3})?-[a-z0-9]+(-[a-z0-9]+)*\b/;

export const TYPES = {
  question: 'q',
  observation: 'o',
  knowledge: 'k',
  problem: 'p',
  act: 'a',
  correction: 'c',
  goal: 'g',
  phase: 'h',
  seen: 's',
};

export const QUESTION_KINDS = ['owner-decision', 'one-way-door', 'clarification', 'proposal', 'trust', 'goal-definition'];
export const KNOWLEDGE_KINDS = ['fact', 'lesson', 'preference', 'constraint', 'pointer'];
export const KNOWLEDGE_STATUS = ['candidate', 'accepted', 'stale', 'retired'];
export const PROBLEM_STATUS = ['open', 'owned', 'mitigating', 'resolved'];
export const GOAL_STATUS = ['draft', 'ready', 'met', 'abandoned'];
export const REPAIRS = ['undo', 'fix-ticket', 'none'];

// Who wrote a file: owner, supervisor, a ticket id, or plan-<feature>.
export function writerOfFile(name) {
  const base = name.replace(/\.jsonl$/, '');
  const m = base.match(/^(owner|supervisor)-\d{4}-\d{2}$/);
  return m ? m[1] : base;
}

export function writerClass(by) {
  if (by === 'owner') return 'owner';
  if (by === 'supervisor') return 'supervisor';
  if (/^plan-[a-z0-9-]+$/.test(by)) return 'planner';
  return 'ticket';
}

// Higher wins when two writers set the same field: the owner over the supervisor, and so on.
export const RANK = { ticket: 0, planner: 1, supervisor: 2, owner: 3 };

// ---------- authority: which writer may create which types and set which fields ----------

const ANY = '*';
export const AUTHORITY = {
  new: {
    owner: ['goal', 'correction', 'knowledge', 'observation', 'seen'],
    supervisor: ['question', 'observation', 'knowledge', 'problem', 'act', 'correction', 'goal', 'phase'],
    planner: ['observation'],
    ticket: ['phase', 'observation'],
  },
  // set[type][writerClass] = fields that writer may set (on anyone's object of that type)
  set: {
    question: {
      supervisor: ['status', 'recorded_in', 'reason'], // status: withdrawn or defaulted only (checked below)
      owner: ['answer', 'matched', 'autonomy', 'standing_rule', 'channel'],
    },
    knowledge: {
      supervisor: ['status', 'confidence', 'statement', 'scope'],
      owner: ['status', 'confidence', 'statement', 'scope'],
    },
    problem: {
      supervisor: ['status', 'severity', 'realized', 'assigned_to', 'detail', 'threatens'],
      owner: ['status', 'severity', 'realized', 'assigned_to', 'detail', 'threatens'],
    },
    goal: {
      // The supervisor drafts; only the owner moves a goal out of draft (checked below).
      supervisor: ['title', 'outcome', 'measure', 'horizon', 'non_goals', 'constraints', 'priority', 'preconditions'],
      owner: ['title', 'outcome', 'measure', 'horizon', 'non_goals', 'constraints', 'priority', 'preconditions', 'status', 'channel'],
    },
  },
};

// ---------- field checks per type ----------

const isStr = (x) => typeof x === 'string' && x.length > 0;
const isOptStr = (x) => x === undefined || x === null || typeof x === 'string';
const isStrArr = (x) => Array.isArray(x) && x.every((s) => typeof s === 'string');
const isOptStrArr = (x) => x === undefined || isStrArr(x);
const inRange = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const isOptRange = (x, lo, hi) => x === undefined || x === null || inRange(x, lo, hi);
const isBool = (x) => typeof x === 'boolean';

function checkFields(type, o, errs, isNew) {
  const need = (k, ok, what) => {
    if (!ok) errs.push(`${type}.${k} ${what}`);
  };
  const has = (k) => Object.prototype.hasOwnProperty.call(o, k);
  const req = (k) => isNew || has(k);
  switch (type) {
    case 'question':
      if (req('kind')) need('kind', QUESTION_KINDS.includes(o.kind), `must be one of ${QUESTION_KINDS.join(', ')}`);
      if (req('question')) need('question', isStr(o.question), 'must be a non-empty string');
      need('options', isOptStrArr(o.options), 'must be a list of strings');
      need('scope', isOptStr(o.scope), 'must be a string');
      need('blocks', isOptStrArr(o.blocks), 'must be a list of ticket ids');
      need('evidence', isOptStrArr(o.evidence), 'must be a list of ids');
      need('default', isOptStr(o.default), 'must be a string or null');
      need('confidence', isOptRange(o.confidence, 0, 1), 'must be a number from 0 to 1');
      if (has('why_asked') && o.why_asked !== null) {
        const w = o.why_asked;
        need('why_asked', typeof w === 'object' && isOptStrArr(w.reasons) && isOptRange(w.rung, 1, 3) && isOptRange(w.ceiling, 1, 3), 'must be { rung, ceiling, reasons[] }');
      }
      if (o.kind === 'one-way-door' && o.default) errs.push('question: one-way doors never have a default');
      if (has('status')) need('status', ['withdrawn', 'defaulted'].includes(o.status), 'may only be set to withdrawn or defaulted (answers set "answer")');
      if (has('answer')) need('answer', isStr(o.answer), 'must be a non-empty string');
      if (has('matched')) need('matched', isBool(o.matched), 'must be true or false');
      if (has('autonomy') && o.autonomy !== null) {
        const a = o.autonomy;
        need('autonomy', typeof a === 'object' && isStr(a.class) && inRange(a.rung, 1, 3) && isOptStr(a.scope), 'must be { class, rung 1-3, scope? }');
      }
      break;
    case 'observation':
      if (req('subject')) need('subject', isStr(o.subject), 'must name what was observed');
      if (req('kind')) need('kind', isStr(o.kind), 'must be a slug');
      if (req('detail')) need('detail', isStr(o.detail), 'must be a non-empty string');
      need('severity', isOptRange(o.severity, 0, 4), 'must be 0-4');
      need('valence', isOptRange(o.valence, -2, 2), 'must be -2..2');
      need('refs', isOptStrArr(o.refs), 'must be a list of ids');
      if (o.measure !== undefined && o.measure !== null) need('measure', typeof o.measure === 'object' && typeof o.measure.value === 'number', 'must be { value: number, unit? }');
      break;
    case 'knowledge':
      if (req('kind')) need('kind', KNOWLEDGE_KINDS.includes(o.kind), `must be one of ${KNOWLEDGE_KINDS.join(', ')}`);
      if (req('statement')) need('statement', isStr(o.statement), 'must be a non-empty string');
      if (req('scope')) need('scope', isStr(o.scope) && /^(project|component:[a-z0-9-]+|feature:[a-z0-9-]+|class:[a-z0-9-]+)$/.test(o.scope), 'must be project, component:<c>, feature:<f> or class:<decision-class>');
      if (req('status')) need('status', KNOWLEDGE_STATUS.includes(o.status), `must be one of ${KNOWLEDGE_STATUS.join(', ')}`);
      need('confidence', isOptRange(o.confidence, 0, 1), 'must be 0..1');
      need('valence', isOptRange(o.valence, -2, 2), 'must be -2..2');
      need('evidence', isOptStrArr(o.evidence), 'must be a list of ids');
      break;
    case 'problem':
      if (req('title')) need('title', isStr(o.title), 'must be a non-empty string');
      if (req('severity')) need('severity', inRange(o.severity, 0, 4), 'must be 0-4');
      if (req('realized')) need('realized', isBool(o.realized), 'must be true (an issue) or false (a risk)');
      if (req('status')) need('status', PROBLEM_STATUS.includes(o.status), `must be one of ${PROBLEM_STATUS.join(', ')}`);
      need('threatens', isOptStrArr(o.threatens), 'must be a list of goal ids');
      need('assigned_to', isOptStr(o.assigned_to), 'must be a string');
      break;
    case 'act':
      if (req('class')) need('class', isStr(o.class), 'must be a decision class slug');
      if (req('what')) need('what', isStr(o.what), 'must say what was done');
      need('rung', isOptRange(o.rung, 1, 3), 'must be 1-3');
      need('refs', isOptStrArr(o.refs), 'must be a list of ids');
      need('reversible', o.reversible === undefined || isBool(o.reversible), 'must be true or false');
      need('approved_by', isOptStr(o.approved_by), 'must be a question id');
      break;
    case 'correction':
      if (req('act')) need('act', isStr(o.act), 'must be the corrected act id');
      if (req('reason')) need('reason', isStr(o.reason), 'must be a non-empty string');
      need('severity', isOptRange(o.severity, 0, 4), 'must be 0-4');
      need('repair', o.repair === undefined || REPAIRS.includes(o.repair), `must be one of ${REPAIRS.join(', ')}`);
      break;
    case 'goal':
      if (req('title')) need('title', isStr(o.title), 'must be a non-empty string');
      need('outcome', isOptStr(o.outcome), 'must be a string');
      if (o.measure !== undefined && o.measure !== null) {
        const m = o.measure;
        need('measure', typeof m === 'object' && isOptStr(m.description) && (m.target === undefined || m.target === null || typeof m.target === 'number') && isOptStr(m.unit) && (m.direction === undefined || m.direction === null || ['up', 'down'].includes(m.direction)), 'must be { description, target: number, unit, direction: up|down }');
      }
      need('horizon', isOptStr(o.horizon), 'must be a date');
      need('non_goals', isOptStrArr(o.non_goals), 'must be a list of strings');
      need('constraints', isOptStrArr(o.constraints), 'must be a list of strings');
      need('preconditions', isOptStrArr(o.preconditions), 'must be a list of strings');
      need('priority', isOptRange(o.priority, 1, 99), 'must be a rank 1-99');
      if (has('status')) need('status', GOAL_STATUS.includes(o.status), `must be one of ${GOAL_STATUS.join(', ')}`);
      break;
    case 'phase':
      if (req('to')) need('to', isStr(o.to), 'must be a phase');
      need('from', isOptStr(o.from), 'must be a phase or null');
      for (const k of ['usd', 'input_tokens', 'output_tokens']) need(k, o[k] === undefined || o[k] === null || (typeof o[k] === 'number' && o[k] >= 0), 'must be a number ≥ 0');
      break;
    case 'seen':
      if (req('upto')) need('upto', isStr(o.upto) && !Number.isNaN(Date.parse(o.upto)), 'must be a timestamp');
      break;
    default:
      break;
  }
}

// Validate one parsed line against the envelope, its type and the authority table.
// `file` is the file name it lives in (its writer must match `by`).
export function checkLine(o, file) {
  const errs = [];
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['not a JSON object'];
  if (o.v !== LOG_VERSION) errs.push(`v must be ${LOG_VERSION}`);
  if (!TYPES[o.type]) errs.push(`unknown type "${o.type}"`);
  if (!['new', 'set'].includes(o.op)) errs.push('op must be "new" or "set"');
  // Times are compared as strings everywhere, so only one exact shape is allowed.
  if (!isStr(o.at) || !AT_RE.test(o.at) || Number.isNaN(Date.parse(o.at))) errs.push('at must be a UTC timestamp like 2026-10-31T14:15:02.123Z');
  if (!isStr(o.by)) errs.push('by is required');
  if (!isStr(o.id) || !ID_RE.test(o.id)) errs.push(`id "${o.id}" is not a log id`);
  if (errs.length) return errs;
  if (file && writerOfFile(file) !== o.by) errs.push(`by "${o.by}" does not match the file's writer "${writerOfFile(file)}"`);
  const cls = writerClass(o.by);
  if (o.op === 'new') {
    if (!o.id.startsWith(`${TYPES[o.type]}-`)) errs.push(`a ${o.type} id starts with "${TYPES[o.type]}-"`);
    if (!o.id.endsWith(`-${o.by}`)) errs.push(`a new id must end with "-${o.by}" (its writer)`);
    if (!AUTHORITY.new[cls].includes(o.type)) errs.push(`${cls} may not create ${o.type} lines`);
    if (o.type === 'goal' && o.status && o.status !== 'draft' && cls !== 'owner') errs.push('only the owner creates a goal past draft');
    if (o.type === 'knowledge' && o.status && o.status !== 'candidate' && !['owner', 'supervisor'].includes(cls)) errs.push('only the supervisor or owner accepts knowledge');
    if (o.type === 'phase' && cls === 'supervisor' && o.to !== 'supervisor') errs.push('the supervisor records its own cost as phase "supervisor"');
    checkFields(o.type, o, errs, true);
  } else {
    const allowed = AUTHORITY.set[o.type]?.[cls];
    if (!allowed) errs.push(`${cls} may not change ${o.type} objects`);
    else {
      const fields = Object.keys(o).filter((k) => !['v', 'id', 'type', 'op', 'at', 'by'].includes(k));
      if (!fields.length) errs.push('a set line changes at least one field');
      const bad = fields.filter((k) => !allowed.includes(k));
      if (bad.length) errs.push(`${cls} may not set ${o.type}.${bad.join(', ')}`);
    }
    checkFields(o.type, o, errs, false);
  }
  return errs;
}

export function parseLines(text, file, firstLine = 1) {
  const out = [];
  const errors = [];
  (text ?? '').split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    if (raw.length > LINE_MAX) {
      errors.push(`${file}:${i + firstLine}: longer than ${LINE_MAX} bytes`);
      return;
    }
    let o;
    try {
      o = JSON.parse(raw);
    } catch {
      errors.push(`${file}:${i + firstLine}: not valid JSON`);
      return;
    }
    const errs = checkLine(o, file);
    if (errs.length) errors.push(`${file}:${i + firstLine}: ${errs.join('; ')}`);
    else out.push({ ...o, __file: file, __line: i + firstLine });
  });
  return { lines: out, errors };
}

// ---------- fold ----------

// Build current state from every line. New lines create objects (first one wins; a repeated
// id is ignored). Set lines apply field by field, and a field set by a higher-ranked writer can
// only be changed by a writer of the same or higher rank: the owner's answer beats a later
// supervisor default no matter what the timestamps say.
export function fold(allLines) {
  const lines = [...allLines].sort((a, b) => a.at.localeCompare(b.at) || a.__file.localeCompare(b.__file) || a.__line - b.__line);
  const objects = new Map();
  const ignored = [];
  for (const l of lines.filter((x) => x.op === 'new')) {
    if (objects.has(l.id)) {
      ignored.push({ line: l, why: 'duplicate id' });
      continue;
    }
    const { v, op, __file, __line, ...rest } = l;
    // The creator's fields carry the creator's rank: the supervisor can't rewrite what the owner wrote.
    const rank = RANK[writerClass(l.by)];
    const ranks = Object.fromEntries(Object.keys(rest).map((k) => [k, rank]));
    objects.set(l.id, { ...rest, created_at: l.at, created_by: l.by, updates: [], __rank: ranks });
  }
  // When each goal first left draft (an owner line): supervisor edits from then on are ignored.
  const leftDraft = new Map();
  for (const l of lines) if (l.type === 'goal' && writerClass(l.by) === 'owner' && l.status && l.status !== 'draft' && !leftDraft.has(l.id)) leftDraft.set(l.id, l.at);
  for (const l of lines.filter((x) => x.op === 'set')) {
    const obj = objects.get(l.id);
    if (!obj) {
      ignored.push({ line: l, why: 'set on an unknown id' });
      continue;
    }
    if (obj.type !== l.type) {
      ignored.push({ line: l, why: `set says ${l.type} but ${l.id} is a ${obj.type}` });
      continue;
    }
    const rank = RANK[writerClass(l.by)];
    // Rules that depend on the object's state, not just the writer.
    if (obj.type === 'goal' && writerClass(l.by) === 'supervisor' && ((obj.status ?? 'draft') !== 'draft' || (leftDraft.get(obj.id) && l.at >= leftDraft.get(obj.id)))) {
      ignored.push({ line: l, why: 'the supervisor edits a goal only while it is a draft' });
      continue;
    }
    if (obj.type === 'question' && l.status === 'defaulted' && !obj.default) {
      ignored.push({ line: l, why: 'question has no default' });
      continue;
    }
    const changed = {};
    for (const [k, val] of Object.entries(l)) {
      if (['v', 'id', 'type', 'op', 'at', 'by', '__file', '__line'].includes(k)) continue;
      if ((obj.__rank[k] ?? -1) > rank) continue;
      obj[k] = val;
      obj.__rank[k] = rank;
      changed[k] = val;
    }
    if (Object.keys(changed).length) obj.updates.push({ at: l.at, by: l.by, ...changed });
    else ignored.push({ line: l, why: 'overridden by a higher-ranked writer' });
  }
  for (const o of objects.values()) delete o.__rank;
  return { objects, ignored };
}

// ---------- questions: the fold's view in the shape the rest of the tooling uses ----------

export function questionView(q) {
  const ans = q.updates.filter((u) => u.answer !== undefined && writerClass(u.by) === 'owner').pop();
  const st = q.updates.filter((u) => u.status !== undefined).pop();
  let status = 'open';
  let answer = null;
  let answeredBy = null;
  let answeredAt = null;
  if (ans) {
    status = 'answered';
    answer = ans.answer;
    answeredBy = 'owner';
    answeredAt = ans.at;
  } else if (st?.status === 'defaulted') {
    status = 'defaulted';
    answer = q.default;
    answeredBy = 'supervisor (default)';
    answeredAt = st.at;
  } else if (st?.status === 'withdrawn') {
    status = 'withdrawn';
    answeredAt = st.at;
  }
  const matched = ans ? (q.matched ?? (!!q.recommendation && ans.answer.trim().toLowerCase() === q.recommendation.trim().toLowerCase())) : null;
  return {
    id: q.id,
    kind: q.kind,
    class: q.class ?? null,
    scope: q.scope ?? null,
    ticket: q.ticket ?? null,
    asked_at: q.created_at,
    question: q.question,
    context: q.context ?? '',
    options: q.options ?? [],
    recommendation: q.recommendation ?? '',
    confidence: q.confidence ?? null,
    default: q.default ?? null,
    deadline: q.deadline ?? null,
    blocks: q.blocks ?? [],
    evidence: q.evidence ?? [],
    note: q.note ?? null,
    why_asked: q.why_asked ?? null,
    status,
    answer,
    answered_by: answeredBy,
    answered_at: answeredAt,
    matched,
    autonomy: ans ? (q.autonomy ?? null) : null,
    standing_rule: ans ? (q.standing_rule ?? null) : null,
    channel: ans ? (q.channel ?? null) : null,
    recorded_in: q.recorded_in ?? null,
  };
}

// ---------- append-only check for a file between two versions ----------

// The new version must start with the old one byte for byte, and the old must end in a newline.
export function appendOnly(before, after) {
  if (before === null || before === undefined || before === '') return { ok: true, added: after ?? '' };
  if (!before.endsWith('\n')) return { ok: false, why: 'the existing file does not end in a newline' };
  if (after === null || after === undefined || !after.startsWith(before)) return { ok: false, why: 'existing lines were changed or removed' };
  return { ok: true, added: after.slice(before.length) };
}
