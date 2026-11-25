// The reference checker for self@2 and exterior@2 (log.schema.json's $defs.self2 and $defs.exterior2):
// two plain documents, so every rule is read from the text. kit-862 and kit-863 build theirs in
// devteam.mjs against it and give the same result for each case in cases.json. It reads nothing but
// what it is given: what exists, the day, the visibility and the allowed text are arguments.
import path from 'node:path';

const lines = (text) => String(text).replace(/^﻿/, '').split(/\r?\n/);

// A document's lines, each { text, code }: code is true on a fence's own lines and inside it. A fence
// is three or more backticks or tildes, at most three spaces in; a backtick fence's info string holds
// no backtick. It closes at a line of at least as many of the same mark and nothing else but spaces
// or tabs; one never closed runs to the end. Also the fences: [{ info, line }].
export function scan(text) {
  const out = [];
  const fences = [];
  let open = null;
  lines(text).forEach((line, i) => {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      out.push({ text: line, code: true });
      if (m && m[1][0] === open.mark && m[1].length >= open.size && /^[ \t]*$/.test(m[2])) open = null;
      return;
    }
    if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      open = { mark: m[1][0], size: m[1].length };
      fences.push({ info: m[2].replace(/^[ \t]+|[ \t]+$/g, ''), line: i + 1 });
      out.push({ text: line, code: true });
    } else out.push({ text: line, code: false });
  });
  return { lines: out, fences };
}

// 1 when a fence's info string is exactly self or exterior, else 2.
export const version = (text) => (scan(text).fences.some((f) => f.info === 'self' || f.info === 'exterior') ? 1 : 2);

const LIST = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/;
const HEAD = /^ {0,3}#{1,6}(?:[ \t]|$)/;
// Each line's text, or null where it is not read: on a fence, in indented code (four spaces or a tab
// in, after a blank line or more of the same, outside a list), or in a comment that opens a line.
function readable(text) {
  let prev = 'blank';
  let list = false;
  let comment = false;
  return scan(text).lines.map(({ text: l, code }) => {
    if (code) { prev = 'blank'; return null; }
    if (comment || /^ {0,3}<!--/.test(l)) { comment = !l.includes('-->'); prev = 'blank'; return null; }
    if (!l.trim()) { if (prev !== 'code') prev = 'blank'; return l; }
    if (/^(?: {4}| {0,3}\t)/.test(l) && !list && prev !== 'text') { prev = 'code'; return null; }
    if (LIST.test(l)) list = true;
    else if (/^\S/.test(l) && prev === 'blank') list = false;
    prev = HEAD.test(l) ? 'blank' : 'text';
    return l;
  });
}
// Code spans and inline comments of one block, masked by as many spaces. A span is a run of backticks
// to the next run of the same length; \` opens none.
function mask(block) {
  const runs = [...block.matchAll(/`+/g)].map((m) => ({ i: m.index, n: m[0].length }));
  const later = new Map(); // a run's size to the nearest later run of it, from the end back
  for (let k = runs.length - 1; k >= 0; k -= 1) { runs[k].close = later.get(runs[k].n); later.set(runs[k].n, k); }
  let out = '';
  let at = 0;
  for (let k = 0; k < runs.length; k += 1) {
    const { i, n } = runs[k];
    if (i < at) continue;
    let slashes = 0;
    while (block[i - 1 - slashes] === '\\') slashes += 1;
    if (slashes % 2) continue;
    const { close } = runs[k];
    if (close === undefined) continue;
    const end = runs[close].i + n;
    out += block.slice(at, i) + block.slice(i, end).replace(/[^\n]/g, ' ');
    at = end;
  }
  out += block.slice(at);
  for (let i = out.indexOf('<!--'); i >= 0; i = out.indexOf('<!--', i)) {
    const end = out.indexOf('-->', i);
    if (end < 0) break;
    out = out.slice(0, i) + out.slice(i, end + 3).replace(/[^\n]/g, ' ') + out.slice(end + 3);
  }
  return out;
}
// The text outside code and comments, line for line. A block (what a span or link stays inside) ends
// at a blank or unread line, a heading, a list item or a table row.
export function plain(text) {
  const out = [];
  let block = [];
  const flush = () => { if (block.length) out.push(...mask(block.join('\n')).split('\n')); block = []; };
  for (const l of readable(text)) {
    if (l === null || !l.trim()) { flush(); out.push(''); continue; }
    const alone = HEAD.test(l) || /^ {0,3}\|/.test(l);
    if (alone || LIST.test(l)) flush();
    block.push(l);
    if (alone) flush();
  }
  flush();
  return out.join('\n');
}

// The headings, outside code and comments, that hold words: [{ level, text, line }]. At most three spaces in, one to six #, a space
// or tab; closing #s dropped; links, code marks and emphasis marks read as their words.
export function headings(text) {
  const out = [];
  readable(text).forEach((l, i) => {
    const m = l === null ? null : /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/.exec(l);
    const t = m && words((m[2] ?? '').replace(/[ \t]+$/, '').replace(/(?:^|[ \t])#+$/, ''));
    if (t) out.push({ level: m[1].length, text: t, line: i + 1 });
  });
  return out;
}
const words = (s) => s.replace(/!?\[([^[\]]*)\]\([^()]*\)/g, '$1').replace(/[*`]|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '').replace(/\s+/g, ' ').trim();

// The inline links of text outside code: [{ target, index }]. [words](target "title"), brackets in the
// words and parentheses in the target balanced, the target with no space; what follows ]( is at most
// 500 characters. An image, an escaped [, a reference-style or an angle-bracket link is none, though
// a link's words may hold an image.
export function links(text) {
  const t = plain(text);
  const out = [];
  let stack = [];
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (c === '\\') i += 1;
    else if (c === '\n' && /^\n[ \t]*\n/.test(t.slice(i, i + 200))) stack = [];
    else if (c === '[') {
      let k = i - 1;
      let image = t[k] === '!';
      if (image) { let n = 0; while (t[k - 1] === '\\') { n += 1; k -= 1; } image = n % 2 === 0; }
      stack.push({ i, image });
    } else if (c === ']') {
      const o = stack.pop();
      const d = o && t[i + 1] === '(' ? dest(t.slice(i + 2, i + 503)) : null;
      if (!d) continue;
      i += 1 + d.size;
      if (!o.image && !o.dead) { out.push({ target: d.target, index: o.i }); for (const x of stack) if (!x.image) x.dead = true; }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
// What follows ](: its target and how many characters to its closing parenthesis, or null.
function dest(s) {
  let i = 0;
  const space = () => { const from = i; while (i < s.length && /[ \t\n]/.test(s[i])) i += 1; return i > from && !/\n[ \t]*\n/.test(s.slice(from, i)); };
  space();
  if (s[i] === '<') return null;
  const from = i;
  let depth = 0;
  for (; i < s.length && !/[\s<>]/.test(s[i]); i += 1) {
    if (s[i] === '\\') i += 1;
    else if (s[i] === '(') depth += 1;
    else if (s[i] === ')') { if (!depth) break; depth -= 1; }
  }
  if (depth) return null;
  const target = s.slice(from, i).replace(/\\([!-/:-@[-`{-~])/g, '$1');
  if (space() && s[i] in { '"': 1, "'": 1, '(': 1 }) {
    const end = s[i] === '(' ? ')' : s[i];
    i += 1;
    while (i < s.length && s[i] !== end) i += s[i] === '\\' ? 2 : 1;
    i += 1;
    space();
  }
  return s[i] === ')' ? { target, size: i + 1 } : null;
}

// A self.md's part links, in order, each path once: [{ target, path }], path from the repo root ('' is
// the root), or null when it leaves the repo or can't be decoded. root is the file's folder.
export function parts(text, root) {
  const out = [];
  const seen = new Set();
  for (const { target } of links(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
    const cut = target.replace(/[#?].*$/, '');
    if (!cut) continue;
    let p;
    try { p = decodeURIComponent(cut); } catch { out.push({ target, path: null, why: 'bad escape' }); continue; }
    const full = path.posix.join(root, p).replace(/\/+$/, '').replace(/^\.$/, '');
    if (full === '..' || full.startsWith('../')) { out.push({ target, path: null, why: 'outside' }); continue; }
    if (/\.md$/i.test(full) && path.posix.dirname(full) === path.posix.normalize(root)) continue;
    if (seen.has(full)) continue;
    seen.add(full);
    out.push({ target, path: full });
  }
  return out;
}

// Whether text names name: as whole words (no letter or digit just before or after), ignoring case.
export function namesWhole(text, name) {
  if (name.length > 500) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}

function docErrors(text, doc) {
  const blocks = scan(text).fences.filter((f) => f.info === 'self' || f.info === 'exterior');
  if (blocks.length) return blocks.map((b) => `${doc}.md holds a fenced ${b.info} block at line ${b.line}: a plain document has none`);
  const h = headings(text);
  const first = lines(text).findIndex((l) => l.trim() !== '');
  const errs = [];
  if (!h.some((x) => x.level === 1 && x.text && x.line === first + 1)) errs.push('it does not open with a # title');
  else if (h.filter((x) => x.level === 1).length > 1) errs.push('more than one # title');
  return errs;
}

// self.md: { errors, parts } (parts the paths its links name, there or not). has(path) says whether a path is in the repo.
export function checkSelf(text, { root, has }) {
  const errors = docErrors(text, 'self');
  const all = parts(text, root);
  if (!errors.length) {
    if (!all.length) errors.push('no part: link each part to its folder or file');
    for (const p of all) {
      if (p.why === 'outside') errors.push(`part link ${p.target} leaves the repo`);
      else if (p.why || !has(p.path)) errors.push(`part link ${p.target} points to nothing`);
    }
  }
  return { errors, parts: all.filter((p) => p.path !== null).map((p) => p.path) };
}

// The ### entries: [{ name, body }], body up to the next heading of level 3 or less.
export function entries(text) {
  const h = headings(text).filter((x) => x.level <= 3);
  const all = plain(text).split('\n');
  return h.flatMap((x, i) => (x.level === 3 ? [{ name: x.text, body: all.slice(x.line, (h[i + 1]?.line ?? all.length + 1) - 1).join('\n') }] : []));
}
const realDay = (d) => { const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; };
// A source is a web address, or a reference link whose definition (anywhere in the file) is one.
function entryWarnings({ name, body }, today, refs) {
  const days = [...body.matchAll(/(?<![\p{L}\p{N}])read\s+(\d{4}-\d{2}-\d{2})(?!\d)/giu)].map((m) => m[1]).filter(realDay);
  const web = /https?:\/\/[^\s/]/i.test(body) || [...body.matchAll(/\[([^[\]]+)\](?:\[([^[\]]*)\])?/g)].some((m) => refs.has((m[2] || m[1]).toLowerCase()));
  const w = days.filter((d) => d > today).map((d) => `"${name}": read date ${d} is in the future`);
  if (!web || !days.length) w.push(`"${name}" has no dated source`);
  return w;
}
const webRefs = (text) => new Set([...plain(text).matchAll(/^ {0,3}\[([^[\]\n]+)\]:[ \t]*<?https?:\/\//gim)].map((m) => m[1].toLowerCase()));

// Every capitalised word of the whole text, no place skipped, each once in order: letters, digits,
// ' ’ and -, starting with a letter, a trailing 's dropped, upper-case first, two letters or more.
export function capitalised(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\p{L}[\p{L}\p{N}'’-]*/gu)) {
    const w = m[0].replace(/['’]s$/, '').replace(/['’-]+$/, '');
    if (/^\p{Lu}/u.test(w) && [...w].length >= 2) out.add(w);
  }
  return [...out];
}
// Every host in the whole text, lower case, each once: after http: or https: and any slashes, another
// scheme's //, a bare // not inside a word or path, mailto:'s @, and a bare www. name; any user and
// port dropped, and what punctuation ends a sentence.
export function hosts(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/(?:https?:[/\\]*|[a-z][a-z0-9+.-]{0,30}:\/\/|(?<![\p{L}\p{N}:/._-])\/\/|mailto:(?=[^\s@]{1,100}@))([^\s<>"'`()[\]\\/?#|,;]{1,500})|(?<![\p{L}\p{N}/.@-])(www\.[\p{L}\p{N}.-]{1,250})/giu)) {
    const h = (m[1] ?? m[2]).replace(/^.*@/, '').replace(/:\d*$/, '').replace(/[^\p{L}\p{N}]+$/u, '').toLowerCase();
    if (h) out.add(h);
  }
  return [...out];
}

// exterior.md: { errors, warnings, refused, held, hosts }. On a repo known private nothing is refused
// or held; visibility 'public' or 'unknown' keeps the names rule. A ### heading is judged by
// allowed.names (origin main's strategy and dependency names); a word or host by allowed.words (the
// strategy and the dependency files whole).
export function checkExterior(text, { today, visibility, allowed }) {
  const errors = docErrors(text, 'exterior');
  const all = errors.length ? [] : entries(text);
  const open = visibility === 'private';
  const unknown = (list, by) => (open ? [] : list.filter((w) => !namesWhole(by, w)));
  const refs = webRefs(text);
  return {
    errors,
    warnings: all.flatMap((e) => entryWarnings(e, today, refs)),
    refused: unknown(headings(text).filter((h) => h.level === 3).map((h) => h.text), allowed.names),
    held: unknown(capitalised(text), allowed.words),
    hosts: unknown(hosts(text), allowed.words),
  };
}
