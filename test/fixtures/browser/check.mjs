// The browser@1 checker every browser test imports: exactly the JSON Schema subset the kit's own
// schemaErrors (devteam.mjs) reads, with its messages, so a fixture or an output that passes here
// passes there. devteam.mjs is a CLI and can't be imported; keep the two in step.
import fs from 'node:fs';

export const schema = JSON.parse(fs.readFileSync(new URL('../../../docs/devteam/schema/browser.schema.json', import.meta.url), 'utf8'));

const asList = (x) => (Array.isArray(x) ? x : [x]);

export function check(s, value, where) {
  const errs = [];
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (s.const !== undefined && value !== s.const) errs.push(`${where} must be ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(value)) errs.push(`${where} must be one of ${s.enum.join(', ')}`);
  if (s.type) {
    const want = asList(s.type);
    const got = typeOf(value);
    if (!want.includes(got) && !(got === 'integer' && want.includes('number'))) errs.push(`${where} must be ${want.join(' or ')}`);
  }
  if (typeof value === 'string') {
    if (s.pattern && !new RegExp(s.pattern).test(value)) errs.push(`${where} "${value.slice(0, 40)}" does not match ${s.pattern}`);
    if (s.minLength !== undefined && value.length < s.minLength) errs.push(`${where} must be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && value.length > s.maxLength) errs.push(`${where} must be at most ${s.maxLength} characters`);
  }
  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum) errs.push(`${where} must be at least ${s.minimum}`);
    if (s.maximum !== undefined && value > s.maximum) errs.push(`${where} must be at most ${s.maximum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) errs.push(`${where} needs at least ${s.minItems} item(s)`);
    if (s.maxItems !== undefined && value.length > s.maxItems) errs.push(`${where} has more than ${s.maxItems} items`);
    if (s.items) value.forEach((v, i) => errs.push(...check(s.items, v, `${where}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const k of s.required ?? []) if (!(k in value)) errs.push(`${where}.${k} is required`);
    for (const [k, v] of Object.entries(value)) {
      const sub = s.properties?.[k];
      if (sub) errs.push(...check(sub, v, `${where}.${k}`));
      else if (s.additionalProperties === false) errs.push(`${where}.${k} is not a field here`);
    }
  }
  return errs;
}

// One of the eight shapes: status, snapshot, tabs, profiles, wait, state, resets, refusal.
export function validate(shape, value) {
  const s = schema.$defs.shapes[shape];
  if (!s) throw new Error(`browser@1 has no shape ${shape}`);
  return check(s, value, shape);
}

// A live-view message, by its t; dir is from_server or from_page. A t outside the list is not in
// the contract.
export function message(dir, m) {
  const defs = schema.$defs.view[dir];
  if (!defs) throw new Error(`browser@1 has no message direction ${dir}`);
  const t = m && typeof m === 'object' ? m.t : undefined;
  if (typeof t !== 'string' || !Object.hasOwn(defs, t)) return [`${dir}.t ${JSON.stringify(t)} is not a message ${dir}`];
  return check(defs[t], m, dir);
}

// The refusal object the egress guard's page carries, or null when the page has none.
export function refusalOf(html) {
  const m = /<script type="application\/json" id="devteam-refusal">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
