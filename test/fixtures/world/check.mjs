// The reference checker for self@1 and exterior@1 (log.schema.json's $defs.self and $defs.exterior).
// kit-139 and kit-135 build their checks in devteam.mjs against it, and refuse the same
// invalid/ cases. It runs the kit's own schemaErrors, cut from devteam.mjs (a CLI, so not
// importable), so the two can't disagree on the schema; the rules the schema's keyword subset can't
// say are here. It reads nothing but the text it is given: strategy quotes against strategy_blob,
// blobs against the head and part paths on disk are the consumers' checks at the draft.
import fs from 'node:fs';

const at = (rel) => new URL(rel, import.meta.url);
export const schema = JSON.parse(fs.readFileSync(at('../../../docs/devteam/schema/log.schema.json'), 'utf8'));
export const defs = { self: schema.$defs.self, exterior: schema.$defs.exterior };

const src = fs.readFileSync(at('../../../docs/devteam/scripts/devteam.mjs'), 'utf8');
const fn = /\nfunction schemaErrors\(schema, value, where\) \{[\s\S]*?\n\}\n/.exec(src)?.[0];
const list = /\nconst asList = .*\n/.exec(src)?.[0];
export const cut = { schemaErrors: Boolean(fn), asList: Boolean(list) };
if (!fn || !list) throw new Error('schemaErrors or asList not found in devteam.mjs');
export const schemaErrors = new Function(`${list}${fn}; return schemaErrors;`)();

// The fenced blocks of a markdown file. A fence is a line at column 0 of three or more backticks;
// one opens a block when none is open, its info string the rest of the line, trimmed (possibly
// empty). The block closes at the next line of at least as many backticks and nothing else but
// whitespace. Indented and ~~~ fences are prose. Returns the blocks, the text outside every block
// (prose), and the line of a block that never closes (or null).
export function blocks(text) {
  const out = [];
  const prose = [];
  let open = null;
  text.split('\n').forEach((line, i) => {
    const m = /^(`{3,})(.*)$/.exec(line);
    if (!open) {
      if (m) open = { ticks: m[1].length, info: m[2].trim(), line: i + 1, body: [] };
      else prose.push(line);
    } else if (m && m[1].length >= open.ticks && /^\s*$/.test(m[2])) {
      out.push({ info: open.info, line: open.line, body: open.body.join('\n') });
      open = null;
    } else open.body.push(line);
  });
  return { blocks: out, prose: prose.join('\n'), unclosed: open ? open.line : null };
}

export const prose = (text) => blocks(text).prose;

// Whether text names name: as whole words (no letter or digit just before or after), ignoring case.
export function namesWhole(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

const HOME = { self: 'self.md', exterior: 'exterior.md' };
const OTHER = { self: 'exterior', exterior: 'self' };
const article = (w) => (/^[aeiou]/.test(w) ? 'an' : 'a');

// Rules 1 to 3 stop at their first error; rule 4 gives every schema error; rules 5 to 7 run only
// once the schema holds.
function check(text, doc) {
  const b = blocks(text);
  if (b.unclosed) return [`a fenced block opened at line ${b.unclosed} never closes`];
  const other = OTHER[doc];
  if (b.blocks.some((x) => x.info === other)) return [`${article(other)} ${other} block belongs in ${HOME[other]}, not ${HOME[doc]}`];
  const mine = b.blocks.filter((x) => x.info === doc);
  if (mine.length === 0) return [`no ${doc} block`];
  if (mine.length > 1) return [`more than one ${doc} block`];
  let v;
  try {
    v = JSON.parse(mine[0].body);
  } catch (e) {
    return [`the ${doc} block is not JSON: ${e.message}`];
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return [`the ${doc} block is not a JSON object`];
  if (Number.isInteger(v[doc]) && v[doc] > 1) return [`${doc}: ${v[doc]} needs a newer kit`];
  const errs = schemaErrors(defs[doc].block, v, doc);
  if (errs.length) return errs;
  const ids = doc === 'self'
    ? v.parts.map((p, i) => [`self.parts[${i}].id`, p.id])
    : v.entities.flatMap((e, i) => [[`exterior.entities[${i}].id`, e.id], ...e.signals.map((s, j) => [`exterior.entities[${i}].signals[${j}].id`, s.id])]);
  const seen = new Set();
  for (const [where, id] of ids) {
    if (seen.has(id)) errs.push(`${where} "${id}" is shared`);
    seen.add(id);
  }
  if (doc === 'exterior') {
    v.entities.forEach((e, i) => {
      if (e.relation === 'other' && e.relation_word === undefined) errs.push(`exterior.entities[${i}].relation_word is required when relation is other`);
      if (e.relation !== 'other' && e.relation_word !== undefined) errs.push(`exterior.entities[${i}].relation_word is only for relation other`);
      if (!namesWhole(b.prose, e.name)) errs.push(`exterior.entities[${i}] "${e.name}": the prose outside the block never names it`);
    });
  }
  return errs;
}

// A file's text in, its errors out (empty when it holds).
export const checkSelf = (text) => check(text, 'self');
export const checkExterior = (text) => check(text, 'exterior');

// The dashboard-data blocks, from a block that checks.
export const dashboardSelf = (b) => ({
  what: b.what,
  makes: b.makes,
  parts: b.parts.map((p) => ({ id: p.id, name: p.name, what: p.what, code: p.code })),
  controls: b.controls,
  not: b.not,
});
export const dashboardExterior = (b) => ({
  entities: b.entities.map((e) => ({
    entity: e.id,
    relation: e.relation,
    relation_word: e.relation_word ?? null,
    kind: e.kind,
    name: e.name,
    matters: e.matters,
    weight: e.weight,
    signals: e.signals.map((s) => ({ signal: s.id, what: s.what, value: s.value, score: e.weight * s.value })),
  })),
});
