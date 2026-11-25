// The reference checker for self@2 and exterior@2 (log.schema.json's $defs.self2 and $defs.exterior2):
// two plain documents, so every rule is read from the text. kit-862 and kit-863 build theirs in
// devteam.mjs against it and give the same result for each case in cases.json. It reads nothing but
// what it is given: what exists, the day, the visibility and the allowed text are arguments.
import path from 'node:path';

// A line ends at LF, CR or CRLF, as markdown reads it.
const lines = (text) => String(text).replace(/^﻿/, '').split(/\r\n?|\n/);
// s without the spaces and tabs at its start and end, in one pass.
const trimST = (s) => { let a = 0; let b = s.length; while (a < b && (s[a] === ' ' || s[a] === '\t')) a += 1; while (b > a && (s[b - 1] === ' ' || s[b - 1] === '\t')) b -= 1; return s.slice(a, b); };
// How many columns a line's leading spaces and tabs fill, a tab to the next multiple of four.
const indent = (s) => { let n = 0; for (const c of s) { if (c === ' ') n += 1; else if (c === '\t') n += 4 - (n % 4); else break; } return n; };

// Each reading step keeps its last answer, as a checker reads one text several times.
function last(f) { let k = null; let v; return (t) => { const x = String(t); if (x !== k) { v = f(x); k = x; } return v; }; }
// Whether the line after the line break at i holds only spaces and tabs, and another break follows.
const blankAfter = (t, i) => { let j = i + 1; while (t[j] === ' ' || t[j] === '\t') j += 1; return t[j] === '\n'; };

// A thematic break (three or more *, - or _, spaces and tabs between): not a list item, and it ends one.
const BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

// A document's lines, each { text, code }: code is true on a fence's own lines and inside it. A fence
// is three or more backticks or tildes, at most three spaces in, or after a list item's markers on
// its own line; a backtick fence's info string holds no backtick. Inside a list item (on the item's
// line, or on a later line indented at least as far as the item's text) the fence belongs to the
// item: it closes at a line of at least as many of the same mark and nothing else but spaces or
// tabs, at most three columns past the item's text, and ends before a line that is not blank and is
// indented less than the item's text. Outside a list it closes the same way at most three spaces in.
// One never closed runs to the end. The item is the last list item seen, until a line that is not
// blank, is indented less than its text and follows a blank line. Also the fences: [{ info, line }].
const MARKER = / {0,3}([-*+]|\d{1,9}[.)])/y;
const MARK = /^( {0,3})(`{3,}|~{3,})(.*)$/s;
// A fence line: [line, its list markers with the spaces after each, up to three spaces, the mark,
// the info string], or null. The markers are read left to right, each with a tab or up to four of
// the spaces after it, so the time is linear in the line. Also the first marker, as marks[0].
function FENCEOF(line) {
  let i = 0;
  const marks = [];
  for (;;) {
    MARKER.lastIndex = i;
    const k = MARKER.exec(line);
    if (!k) break;
    let j = i + k[0].length;
    if (line[j] === '\t') j += 1;
    else { let n = 0; while (line[j + n] === ' ') n += 1; if (!n) break; j += Math.min(n, 4); }
    marks.push(k[1]);
    i = j;
  }
  const f = MARK.exec(i ? line.slice(i) : line);
  if (!f) return null;
  const m = [line, line.slice(0, i), f[1], f[2], f[3]];
  m.marks = marks;
  return m;
}
const FENCE = { exec: FENCEOF };
const ITEM = /^(?: {0,3}(?:[-*+]|\d{1,9}[.)])(?: {1,4}|\t|$))+/;
// The column where a list item's text starts, its markers read as spaces.
// The text column of each list item a line's markers open, outermost first: an empty item's is one
// past its marker.
const itemCols = (prefix) => {
  const cols = [];
  let col = 0;
  for (const x of prefix.matchAll(/ {0,3}(?:[-*+]|\d{1,9}[.)])(?: {1,4}|\t|$)/g)) {
    for (const c of x[0]) col += c === '\t' ? 4 - (col % 4) : 1;
    cols.push(col + (/[-*+.)]$/.test(x[0]) ? 1 : 0));
  }
  return cols;
};
const itemCol = (prefix) => indent(prefix.replace(/[-*+]|\d{1,9}[.)]/g, (x) => ' '.repeat(x.length)));
export const scan = last(function scanText(text) {
  const out = [];
  const fences = [];
  let open = null;
  let items = []; // the text columns of the list items this line may be in, outermost first
  let item = 0; // the innermost one's, or 0
  let blank = false;
  let para = false; // the line before is paragraph text outside any list item
  lines(text).forEach((line, i) => {
    let m = FENCE.exec(line);
    if (open && open.base && line.trim() && indent(line) < open.base) open = null;
    if (!open) {
      let li = !BREAK.test(line) && ITEM.exec(line);
      // An ordered list that starts at a number other than 1, or an empty item, cannot interrupt a
      // paragraph: the line is the paragraph's text.
      if (li && para && !item && ((/^ *\d/.test(li[0]) && !/^ *0*1[.)]/.test(li[0])) || !line.slice(li[0].length).trim())) { li = null; if (m && m[1]) m = null; }
      if (li) { const d = indent(line); while (items.length && items[items.length - 1] > d) items.pop(); for (const c of itemCols(li[0])) items.push(c); }
      else if (line.trim() && blank) while (items.length && items[items.length - 1] > indent(line)) items.pop();
      item = items.length ? items[items.length - 1] : 0;
      blank = !line.trim();
    }
    if (open) {
      out.push({ text: line, code: true });
      const rest = open.base ? line.slice(line.length - line.replace(/^[ \t]*/, '').length) : null;
      const close = open.base
        ? indent(line) - open.base <= 3 && /^(`{3,}|~{3,})[ \t]*$/.exec(rest)
        : m && !m[1] && /^(`{3,}|~{3,})[ \t]*$/.exec(m[3] + m[4]);
      if (close && close[1][0] === open.mark && close[1].length >= open.size) open = null;
      return;
    }
    const fence = (x) => x && !(x[3][0] === '`' && x[4].includes('`'));
    let f = fence(m) ? m : null;
    let base = f ? (f[1] ? itemCol(f[1]) : item && indent(line) >= item ? item : 0) : 0;
    if (!f && item > 3 && /^ */.exec(line)[0].length >= item) {
      const r = FENCE.exec(line.slice(item)); // in an item's text: up to three spaces past its column
      if (fence(r) && !r[1]) { f = r; base = item; }
    }
    if (f) {
      open = { mark: f[3][0], size: f[3].length, base };
      fences.push({ info: trimST(f[4]), line: i + 1 });
      out.push({ text: line, code: true, opens: true });
      para = false;
    } else {
      out.push({ text: line, code: false });
      // A paragraph goes on through any indent; a new one starts at most three spaces in.
      para = !!line.trim() && !item && (para || indent(line) < 4) && !HEAD.test(line) && !BREAK.test(line);
    }
  });
  return { lines: out, fences };
});

// 1 when a fence's info string is exactly self or exterior, else 2.
export const version = (text) => (scan(text).fences.some((f) => f.info === 'self' || f.info === 'exterior') ? 1 : 2);

const LIST = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]/;
const HEAD = /^ {0,3}#{1,6}(?:[ \t]|$)/;
// Each line's text, or null where it is not read: on a fence, in indented code (four spaces or a tab
// in, after a blank line or more of the same, outside a list), or in a comment that opens a line.
const readable = last((text) => {
  let prev = 'blank';
  let list = false;
  let comment = false;
  return scan(text).lines.map(({ text: l, code, opens }) => {
    if (code) { if (opens && LIST.test(l)) list = true; prev = 'blank'; return null; }
    if (comment || /^ {0,3}<!--/.test(l)) { comment = !l.includes('-->'); prev = 'blank'; return null; }
    if (!l.trim()) { if (prev !== 'code') prev = 'blank'; return l; }
    if (/^(?: {4}| {0,3}\t)/.test(l) && !list && prev !== 'text') { prev = 'code'; return null; }
    if (BREAK.test(l)) { if (/^\S/.test(l)) list = false; prev = 'blank'; return l; }
    if (LIST.test(l)) list = true;
    else if (/^\S/.test(l) && prev === 'blank') list = false;
    prev = HEAD.test(l) ? 'blank' : 'text';
    return l;
  });
});
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
  let done = '';
  at = 0;
  for (let i = out.indexOf('<!--'); i >= 0; i = out.indexOf('<!--', at)) {
    const end = out.indexOf('-->', i);
    if (end < 0) break;
    done += out.slice(at, i) + out.slice(i, end + 3).replace(/[^\n]/g, ' ');
    at = end + 3;
  }
  return done + out.slice(at);
}
// The text outside code and comments, line for line. A block (what a span or link stays inside) ends
// at a blank or unread line, a heading, a list item or a table row.
export const plain = last((text) => {
  const out = [];
  let block = [];
  const flush = () => { if (block.length) for (const x of mask(block.join('\n')).split('\n')) out.push(x); block = []; };
  for (const l of readable(text)) {
    if (l === null || !l.trim()) { flush(); out.push(''); continue; }
    const alone = HEAD.test(l) || BREAK.test(l) || /^ {0,3}\|/.test(l);
    if (alone || LIST.test(l)) flush();
    block.push(l);
    if (alone) flush();
  }
  flush();
  return out.join('\n');
});

// The headings, outside code and comments, that hold words: [{ level, text, line }]. At most three spaces in, one to six #, a space
// or tab; closing #s dropped; links, code marks and emphasis marks read as their words.
export const headings = last((text) => {
  const out = [];
  readable(text).forEach((l, i) => {
    const m = l === null ? null : /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/s.exec(l);
    const t = m && words(trimST(m[2] ?? '').replace(/(?:^|[ \t])#+$/, ''));
    if (t) out.push({ level: m[1].length, text: t, line: i + 1 });
  });
  return out;
});
// [words](target) read as its words, where dest reads the rest as a link's end and it is outside a
// code span (a span's text is kept as written); else kept as written.
function unlink(s) {
  const masked = mask(s);
  let out = '';
  let at = 0;
  for (const m of masked.matchAll(/!?\[([^[\]]*)\]\(/g)) {
    if (m.index < at) continue;
    const from = m.index + m[0].length;
    const d = dest(s, from, true);
    if (!d) continue; // read as written: a code span in its tail is no title, so no link
    out += s.slice(at, m.index) + s.slice(m.index + m[0].length - m[1].length - 2, m.index + m[0].length - 2);
    at = from + d.size;
  }
  return out + s.slice(at);
}
const words = (s) => unlink(s).replace(/[*`]|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '').replace(/\s+/g, ' ').trim();

// The inline links of text outside code: [{ target, index }]. [words](target "title"), brackets in the
// words and parentheses in the target balanced, the target with no space; what follows ]( is at most
// 500 characters. An image, an escaped [, a reference-style or an angle-bracket link is none, though
// a link's words may hold an image.
export function links(text) {
  const t = plain(text);
  const out = [];
  let stack = [];
  let dead = 0; // stack[0 .. dead - 1] can no longer open a link
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (c === '\\') i += 1;
    else if (c === '\n' && blankAfter(t, i)) { stack = []; dead = 0; }
    else if (c === '[') {
      let k = i - 1;
      let image = t[k] === '!';
      if (image) { let n = 0; while (t[k - 1] === '\\') { n += 1; k -= 1; } image = n % 2 === 0; }
      stack.push({ i, image });
    } else if (c === ']') {
      const o = stack.pop();
      const gone = stack.length < dead;
      if (gone) dead = stack.length;
      const d = o && t[i + 1] === '(' ? dest(t, i + 2) : null;
      if (!d) continue;
      i += 1 + d.size;
      if (o.image) while (out.length && out[out.length - 1].index > o.i) out.pop();
      else if (!gone) { out.push({ target: d.target, index: o.i }); dead = stack.length; }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
// What follows ](: its target and how many characters to its closing parenthesis, or null.
// Whether the character code k is ASCII punctuation (what a backslash escapes).
const punct = (k) => (k >= 33 && k <= 47) || (k >= 58 && k <= 64) || (k >= 91 && k <= 96) || (k >= 123 && k <= 126);
// What follows ]( in t from at (its first 501 characters, so a link's tail is at most 500 before its closing parenthesis): its target and how many characters to
// its closing parenthesis, or null.
function dest(t, at, angle = false) {
  const n = Math.min(t.length, at + 501);
  let i = at;
  const space = () => { const from = i; while (i < n && (t[i] === ' ' || t[i] === '\t' || t[i] === '\n')) i += 1; return i > from && !/\n[ \t]*\n/.test(t.slice(from, i)); };
  space();
  let from = i;
  let depth = 0;
  // <target>: with angle (a heading's words) read as CommonMark does, no line break or unescaped < >
  // inside; else none, as kit-861 has it for parts.
  if (t[i] === '<') {
    if (!angle) return null;
    for (i += 1; i < n && t[i] !== '>'; i += 1) {
      if (t[i] === '\n' || t[i] === '<') return null;
      if (t[i] === '\\' && i + 1 < n) i += 1;
    }
    if (i >= n) return null;
    from = i + 1;
    i += 1;
    const target = t.slice(from, i - 1);
    return tailOf(t, at, i, n, target);
  }
  for (; i < n; i += 1) {
    const k = t.charCodeAt(i);
    if (k === 60 || k === 62 || k === 32 || (k >= 9 && k <= 13)) break; // < > ASCII white space
    if (k === 92 && i + 1 < n && punct(t.charCodeAt(i + 1))) i += 1;
    else if (k === 40) depth += 1;
    else if (k === 41) { if (!depth) break; depth -= 1; }
  }
  if (depth) return null;
  return tailOf(t, at, i, n, t.slice(from, i).replace(/\\([!-/:-@[-`{-~])/g, '$1'));
}
// The rest of a link after its target at i: an optional title, then ).
function tailOf(t, at, i0, n, target) {
  let i = i0;
  const space = () => { const from = i; while (i < n && (t[i] === ' ' || t[i] === '\t' || t[i] === '\n')) i += 1; return i > from && !/\n[ \t]*\n/.test(t.slice(from, i)); };
  if (space() && i < n && t[i] in { '"': 1, "'": 1, '(': 1 }) {
    const end = t[i] === '(' ? ')' : t[i];
    i += 1;
    while (i < n && t[i] !== end) {
      if (end === ')' && t[i] === '(') return null;
      i += t[i] === '\\' ? 2 : 1;
    }
    i += 1;
    space();
  }
  return i < n && t[i] === ')' ? { target, size: i + 1 - at } : null;
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

// Whether text names name: as whole words (no letter or digit just before or after), ignoring case
// as a regular expression's i and u flags do (each code point by its simple case folding). The text
// is indexed once: each of its code points stands for the class of those equal to it ignoring case,
// so a name is a plain search and its two ends a look at the code points beside it.
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LN = /[\p{L}\p{N}]/iu;
// The classes of a text's code points: each new code point's class is looked for first among those
// of its case bucket (its upper case's lower case, which almost always holds its class), then by one
// search of every class's first code point; none, and it starts one.
function classes() {
  const reps = [];
  let all = '';
  const at = new Map(); // a class's offset in all to the class
  const bucket = new Map();
  const id = new Map();
  const find = (c, add) => {
    if (id.has(c)) return id.get(c);
    const re = new RegExp(esc(c), 'iu');
    const b = c.toUpperCase().toLowerCase();
    let k = (bucket.get(b) ?? []).find((x) => re.test(reps[x]));
    if (k === undefined) { const o = all.search(re); k = o < 0 ? -1 : at.get(o); }
    if (k < 0 && add) { k = reps.length; reps.push(c); at.set(all.length, k); all += c; }
    if (k >= 0) { if (!bucket.has(b)) bucket.set(b, []); if (!bucket.get(b).includes(k)) bucket.get(b).push(k); }
    id.set(c, k);
    return k;
  };
  return { find, count: () => reps.length };
}
const indexes = [];
function indexed(text) {
  const had = indexes.find((x) => x.text === text);
  if (had) return had;
  const cps = Array.from(text);
  const cl = classes();
  for (const c of new Set(cps)) cl.find(c, true);
  if (cl.count() >= 0xd700) return null; // more classes than keys: the caller asks the regular expression
  const key = (k) => String.fromCharCode(0x100 + k);
  const x = { text, cps, key, classOf: (c) => cl.find(c, false), keys: cps.map((c) => key(cl.find(c, false))).join('') };
  indexes.unshift(x);
  indexes.length = Math.min(indexes.length, 4);
  return x;
}
export function namesWhole(text, name) {
  if (name.length > 500) return false;
  if (!name) return new RegExp('(?<![\\p{L}\\p{N}])(?![\\p{L}\\p{N}])', 'iu').test(text);
  const x = indexed(String(text));
  if (!x) return new RegExp(`(?<![\\p{L}\\p{N}])${esc(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
  let want = '';
  for (const c of name) { const k = x.classOf(c); if (k < 0) return false; want += x.key(k); }
  const n = want.length;
  for (let i = x.keys.indexOf(want); i >= 0; i = x.keys.indexOf(want, i + 1)) {
    if (!(i > 0 && LN.test(x.cps[i - 1])) && !(i + n < x.cps.length && LN.test(x.cps[i + n]))) return true;
  }
  return false;
}

// The index of the first line holding more than white space, as lines() splits them, or -1.
const firstLine = (text) => { const t = String(text).replace(/^\uFEFF/, ''); const i = t.search(/\S/); return i < 0 ? -1 : (t.slice(0, i).match(/\r\n?|\n/g) || []).length; };
function docErrors(text, doc) {
  const blocks = scan(text).fences.filter((f) => f.info === 'self' || f.info === 'exterior');
  if (blocks.length) return blocks.map((b) => `${doc}.md holds a fenced ${b.info} block at line ${b.line}: a plain document has none`);
  const h = headings(text);
  const first = firstLine(text);
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
    const c = m[0].codePointAt(0);
    if (c < 128 ? c < 65 || c > 90 : !/^\p{Lu}/u.test(m[0])) continue; // upper case first, or no word
    let w = m[0].replace(/['’]s$/, '');
    let end = w.length;
    while (end && "'’-".includes(w[end - 1])) end -= 1;
    w = w.slice(0, end);
    if (/^\p{Lu}/u.test(w) && [...w].length >= 2) out.add(w);
  }
  return [...out];
}
// Character references as markdown and HTML read them, once: numeric ones, and the named ones whose
// value is one ASCII character. Any other is left as written.
const NAMED = { AMP: '&', DiacriticalGrave: '`', GT: '>', Hat: '^', LT: '<', NewLine: '\n', QUOT: '"', Tab: '\t', UnderBar: '_', VerticalLine: '|', amp: '&', apos: "'", ast: '*', bsol: '\\', colon: ':', comma: ',', commat: '@', dollar: '$', equals: '=', excl: '!', grave: '`', gt: '>', lbrace: '{', lbrack: '[', lcub: '{', lowbar: '_', lpar: '(', lsqb: '[', lt: '<', midast: '*', num: '#', percnt: '%', period: '.', plus: '+', quest: '?', quot: '"', rbrace: '}', rbrack: ']', rcub: '}', rpar: ')', rsqb: ']', semi: ';', sol: '/', verbar: '|', vert: '|' };
const numeric = (d, x) => { const c = d ? Number(d) : parseInt(x, 16); return String.fromCodePoint(c === 0 || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff) ? 0xfffd : c); };
// As markdown reads text: each backslash escape of ASCII punctuation and each character reference
// (with its ;) decoded, once.
const decode = (t, squeeze = false) => t.replace(/\\([!-/:-@[-`{-~])|&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (all, p, d, x, n) => {
  if (p) return squeeze && (p === '<' || p === '>') ? '' : p;
  const v = n ? (Object.hasOwn(NAMED, n) ? NAMED[n] : all) : numeric(d, x);
  return squeeze && /^[\s<>]$/u.test(v) ? '' : v;
});
// As a browser reads an HTML attribute's value (quoted or not, after = and any white space): its
// character references decoded, numeric ones and &amp; &lt; &gt; &quot; with or without the ;, then
// its tabs and line breaks taken out, as a URL is read.
const LEGACY = { amp: '&', AMP: '&', lt: '<', LT: '<', gt: '>', GT: '>', quot: '"', QUOT: '"' };
const attrs = (t, squeeze = false) => t.replace(/(=\s*)("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g, (all, eq, v) => eq + v
  .replace(/&(?:#(\d{1,7});?|#[xX]([0-9a-fA-F]{1,6});?|([A-Za-z][A-Za-z0-9]{1,31});|(amp|AMP|lt|LT|gt|GT|quot|QUOT)(?![A-Za-z0-9]))/g, (r, d, x, n, l) => (l ? LEGACY[l] : n ? (Object.hasOwn(NAMED, n) ? NAMED[n] : r) : numeric(d, x)))
  .replace(squeeze ? /[\s<>]/gu : /[\t\r\n]/g, ''));
// The text with the white space inside each angle-bracket destination taken out ([x](<…>), [x]: <…>).
const angles = (t) => {
  let out = '';
  let at = 0;
  for (let i = t.indexOf(']'); i >= 0; i = t.indexOf(']', i + 1)) {
    if (i < at || (t[i + 1] !== '(' && t[i + 1] !== ':')) continue;
    let j = i + 2;
    while (t[j] === ' ' || t[j] === '\t') j += 1;
    if (t[j] === '\n') { j += 1; while (t[j] === ' ' || t[j] === '\t' || t[j] === '>') j += 1; } // a quote's > markers too
    if (t[j] !== '<') continue;
    let k = j + 1;
    while (k < t.length && t[k] !== '<' && t[k] !== '>' && t[k] !== '\n') k += 1;
    if (t[k] !== '>') continue;
    out += t.slice(at, j + 1) + t.slice(j + 1, k).replace(/\s/gu, '');
    at = k;
    i = k;
  }
  return out + t.slice(at);
};
// What follows a host to drop: anything not a letter or digit, from the end back.
const tail = (h) => { const c = Array.from(h); while (c.length && !/[\p{L}\p{N}]/u.test(c[c.length - 1])) c.pop(); return c.join(''); };
// One address's host from its authority: past the last @ (a user), else up to what ends a sentence
// or a link in prose (, ; ' " ` ( ) [ ] |); less a port and what follows the host.
const host = (a) => { const at = a.lastIndexOf('@'); const h = at >= 0 ? a.slice(at + 1) : a.replace(/[,;'"`()[\]|].*$/s, ''); return tail(h.replace(/:\d*$/, '')).toLowerCase(); };
// Every host in the whole text, lower case, each once: read as markdown decodes the text, then again
// with each HTML attribute's value read as a browser does. The authority after http: or https: and
// any slashes or backslashes, another scheme's //, or two or more slashes or backslashes not inside a
// word or path, up to a slash, backslash, ?, #, white space, < or >; and where it holds ]( (a link's
// words ending in an address), each part of it on either side as well. Each address of a mailto:; an
// e-mail autolink <local@domain> (CommonMark's local-part characters); an e-mail address's host, as
// GitHub links a bare one (a letter, digit, . _ + or - before the @, a dot in the host); and a bare
// www. name.
const HOST = /<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@([\p{L}\p{N}.-]+)>|(?:https?:[/\\]*|[a-z][a-z0-9+.-]{0,30}:\/\/|(?<![\p{L}\p{N}/\\._-])[/\\]{2,})([^\s/\\?#<>]+)|mailto:([^\s/\\?#<>"`()[\]|]+)|(?<=[\p{L}\p{N}._+-])@([\p{L}\p{N}_-][\p{L}\p{N}._-]*)|(?<![\p{L}\p{N}/.@-])(www\.[\p{L}\p{N}.-]+)/giu;
// The third reading: the second, with the white space a URL keeps inside its user taken out, where
// markdown or HTML lets it stand inside an address (angle-bracket destinations, attribute values,
// references), the < and > a user may hold there too, and every white space but the ASCII ones.
// A plain link destination ([x](…), [x]: …, not <…>; after form feeds and vertical tabs, one line break and a quote's > markers
// too, as pandoc reads them), up to white space, with
// its < and > taken out: a browser encodes them inside a user.
const dests = (t) => t.replace(/(\]\(|\]:)([ \t\f\v]*(?:\n[ \t\f\v]*(?:>[ \t\f\v]*)*)?)(\S*)/g, (all, o, sp, v) => (v[0] === '<' ? all : o + sp + v.replace(/\\?[<>]/g, '')));
const third = (t) => decode(attrs(angles(dests(t)), true), true).replace(/[^\S\t\n\v\f\r ]/gu, '');
export function hosts(text) {
  const out = new Set();
  const add = (h) => { if (h) out.add(h); };
  const t = String(text).replace(/\r\n?/g, '\n'); // a line ends at LF, CR or CRLF
  // A URL keeps white space inside its user (a browser encodes it), so a third reading takes out the
  // white space inside angle-bracket destinations, attribute values, and what references decode to.
  for (const each of new Set([decode(t), decode(attrs(t)), third(t)])) { // each distinct reading once
    for (const m of each.matchAll(HOST)) {
      if (m[1] !== undefined) add(tail(m[1]).toLowerCase());
      else if (m[2] !== undefined) { add(host(m[2])); if (m[2].includes('](')) for (const a of m[2].split('](')) add(host(a)); }
      else if (m[3] !== undefined) { for (const a of m[3].split(/[,;]/)) if (a.includes('@')) add(host(a)); }
      else if (m[4] !== undefined) { const h = tail(m[4]).toLowerCase(); if (h.includes('.')) add(h); }
      else add(tail(m[5]).toLowerCase());
    }
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
