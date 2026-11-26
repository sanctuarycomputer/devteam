/* imports start */
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './log.mjs';
import { appendLog } from './log-sync.mjs';
import { die } from './base.mjs';
import { firstLine } from './reviews.mjs';
import { flags } from './base.mjs';
import { ghSpec } from './repos.mjs';
import { git } from './base.mjs';
import { gitReadCache } from './base.mjs';
import { json } from './base.mjs';
import { logObjects } from './log-sync.mjs';
import { mainRef } from './log.mjs';
import { mainRoot } from './state.mjs';
import { out } from './base.mjs';
import { positional } from './base.mjs';
import { projectDir } from './state.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { projectRoot } from './settings.mjs';
import { questions } from './log-sync.mjs';
import { readJson } from './base.mjs';
import { readText } from './base.mjs';
import { repo } from './repos.mjs';
import { rest } from './base.mjs';
import { runPath } from './settings.mjs';
import { schemaErrors } from './log.mjs';
import { slug } from './base.mjs';
import { strategyRel } from './pr-checks.mjs';
import { strategyState } from './pr-checks.mjs';
import { warn } from './base.mjs';
import { worldFileFails } from './pr-checks.mjs';
import { writeJson } from './base.mjs';
import { writerClass } from './log.mjs';
/* imports end */
/* self-model start */
// project/self.md, what the project is: since kit-862 a plain document (log.schema.json#self2),
// read by the self-plain region below; a draft must be one. Version 1 (log.schema.json#self@1, one
// fenced `self` block holding the contract) still validates on main, read by fencedBlocks and
// worldDocErrors, which follow test/fixtures/world/check.mjs rule for rule; kit-135 reuses them for
// exterior.md.

/* self-plain start */
// self@2's and exterior@2's reader (log.schema.json#self2, #exterior): test/fixtures/world2/check.mjs's
// rules, rule for rule (its reading of lines, fences, code, comments and links; parts; the title;
// checkSelf; selfHeld, the names rule's words; and, since kit-863, namesWhole, entries, capitalised,
// hosts and checkExterior, exterior.md's contract and names rule, which since kit-933 reads every
// heading form, headed), so the kit gives every case of
// test/fixtures/world2/cases.json the result it lists. One closure, so none of its names meets
// another of this file's; it reads nothing but its arguments, path and URL (a test runs this region
// alone).
export const selfPlain = (() => {
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
  const scan = last(function scanText(text) {
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
  const version = (text) => (scan(text).fences.some((f) => f.info === 'self' || f.info === 'exterior') ? 1 : 2);

  const LIST = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]|^ {0,3}\[\^[^\]\s]{1,999}\]:/; // a list item, or a footnote definition
  const HEAD = /^ {0,3}#{1,6}(?:[ \t]|$)/;
  // Each line's text, or null where it is not read: on a fence, in indented code (four spaces or a tab
  // in, after a blank line or more of the same, outside a list or a footnote), or in a comment that
  // opens a line.
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
  // Code spans and inline comments of one block, masked by as many spaces (code spans only, comments
  // false). A span is a run of backticks to the next run of the same length; \` opens none.
  function mask(block, comments = true) {
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
    if (!comments) return out;
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
  // One block's text with what a page keeps as text masked, read left to right as a page reads it: each
  // code span (md, a markdown block) by spaces, each comment by \0. It stops at anything else that could
  // open HTML or an autolink (a < then anything but a space), a comment holding -- or never ended, or an
  // escaped run of backticks, so a span or comment counts only where nothing before it could take in its
  // opener.
  function kept(s, md) {
    const runs = md ? [...s.matchAll(/`+/g)].map((m) => ({ i: m.index, n: m[0].length })) : [];
    const later = new Map();
    for (let k = runs.length - 1; k >= 0; k -= 1) { runs[k].close = later.get(runs[k].n); later.set(runs[k].n, k); }
    const escaped = (i) => { let n = 0; while (s[i - 1 - n] === '\\') n += 1; return md && n % 2 === 1; };
    let out = '';
    let at = 0;
    let r = 0;
    const hide = (i, end, by) => { out += s.slice(at, i) + s.slice(i, end).replace(/[^\n]/g, by); at = end; return end; };
    for (let i = 0; i < s.length;) {
      if (s[i] === '`' && md) {
        while (runs[r].i < i) r += 1;
        if (escaped(i)) break;
        const { n, close } = runs[r];
        i = close === undefined ? i + n : hide(i, runs[close].i + n, ' ');
      } else if (s[i] !== '<') i += 1;
      else if (escaped(i) || [undefined, ' ', '\t', '\n'].includes(s[i + 1])) i += 1;
      else if (!s.startsWith('<!--', i)) break;
      else if (s[i + 4] === '>') i = hide(i, i + 5, '\0');
      else if (s.startsWith('->', i + 4)) i = hide(i, i + 6, '\0');
      else {
        const k = s.indexOf('--', i + 4);
        if (k < 0 || s[k + 2] !== '>') break;
        i = hide(i, k + 3, '\0');
      }
    }
    return out + s.slice(at);
  }
  // A line with each table cell (between |s not escaped) read by kept on its own.
  function cells(s) {
    let out = '';
    let at = 0;
    for (let i = 0; i <= s.length; i += 1) {
      if (i < s.length && s[i] !== '|') continue;
      let n = 0;
      while (s[i - 1 - n] === '\\') n += 1;
      if (i < s.length && n % 2) continue;
      out += kept(s.slice(at, i), true) + (i < s.length ? '|' : '');
      at = i + 1;
    }
    return out;
  }
  // An HTML block's first line (CommonMark's kinds 1 to 6), and what ends it: a blank line where none.
  const HTMLBLOCK = [
    [/^<(?:pre|script|style|textarea)(?=[\s>]|$)/i, /<\/(?:pre|script|style|textarea)>/i],
    [/^<!--/, /-->/],
    [/^<\?/, /\?>/],
    [/^<![A-Za-z]/, />/],
    [/^<!\[CDATA\[/, /\]\]>/],
    [/^<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[\s/>]|$)/i, null],
  ];
  // The text outside code and comments, line for line. A block (what a span or link stays inside) ends
  // at a blank or unread line, a heading, a list item or a table row.
  const plain = last((text) => {
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
  const headings = last((text) => {
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

  // The inline links of text outside code: [{ target, index, close }] (index its [, close its ]). [words](target "title"), brackets in the
  // words and parentheses in the target balanced, the target with no space; what follows ]( is at most
  // 500 characters. An image, an escaped [, a reference-style or an angle-bracket link is none, though
  // a link's words may hold an image.
  function links(text) {
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
        const close = i;
        i += 1 + d.size;
        if (o.image) while (out.length && out[out.length - 1].index > o.i) out.pop();
        else if (!gone) { out.push({ target: d.target, index: o.i, close }); dead = stack.length; }
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
  function parts(text, root) {
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
  function checkSelf(text, { root, has }) {
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

  // A word: letters, digits, ' ’ and -, starting with a letter. A word as the names rule reads it: a
  // trailing 's dropped (then any trailing ' ’ or -), upper-case first, two letters or more; else null.
  const WORD = /\p{L}[\p{L}\p{N}'’-]*/gu;
  function capWord(m) {
    const c = m.codePointAt(0);
    if (c < 128 ? c < 65 || c > 90 : !/^\p{Lu}/u.test(m)) return null; // upper case first, or no word
    let w = m.replace(/['’]s$/, '');
    let end = w.length;
    while (end && "'’-".includes(w[end - 1])) end -= 1;
    w = w.slice(0, end);
    return /^\p{Lu}/u.test(w) && [...w].length >= 2 ? w : null;
  }
  // self.md's capitalised words for the names rule, each once in order (kit-862). Every word counts but
  // a prose sentence's first: prose is a paragraph's text outside code, comments and a link's words; a
  // sentence starts a paragraph or follows . ! or ? and a space. A heading, a list item (its lines up to
  // a blank one), a table row (a line holding | outside code), code (a fence, indented code, a span), a
  // comment and a link's words count whole, their first word too: a part's name stands there.
  function selfHeld(text) {
    const src = lines(text);
    const read = readable(text);
    const pl = plain(text).split('\n');
    const at = [];
    pl.reduce((o, l, i) => { at[i] = o; return o + l.length + 1; }, 0);
    // the links' words, [ to ], sorted and apart (a link inside another's words is none), read by a
    // pointer that only moves on, as the words come in order: each word one look
    const spans = links(text).map((k) => [k.index, k.close]);
    let k = 0;
    const inLink = (o) => { while (k < spans.length && spans[k][1] <= o) k += 1; return k < spans.length && o > spans[k][0]; };
    const out = new Set();
    const add = (w) => { const c = capWord(w); if (c) out.add(c); };
    let item = false; // in a list item, until a blank line
    let start = true; // the next prose word starts a sentence
    let gap = '';
    src.forEach((s, i) => {
      const l = read[i];
      if (l === null || !l.trim() || HEAD.test(l) || BREAK.test(l) || LIST.test(l) || item || pl[i].includes('|')) {
        if (l !== null && !l.trim()) item = false;
        else if (l !== null && LIST.test(l)) item = true;
        else if (l !== null && (HEAD.test(l) || BREAK.test(l))) item = false;
        for (const m of s.matchAll(WORD)) add(m[0]);
        start = true;
        gap = '';
        return;
      }
      const p = pl[i];
      let prev = 0;
      for (const m of s.matchAll(WORD)) {
        gap += p.slice(prev, m.index);
        prev = m.index + m[0].length;
        const o = at[i] + m.index;
        const whole = p.slice(m.index, prev) !== m[0] || inLink(o);
        if (whole || !(start || /[.!?]\s/.test(gap))) add(m[0]);
        start = false;
        gap = '';
      }
      gap += `${p.slice(prev)}\n`;
    });
    return [...out];
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
  function namesWhole(text, name) {
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

  // The ### entries: [{ name, body }], body up to the next heading of level 3 or less.
  function entries(text) {
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
  function capitalised(text) {
    const out = new Set();
    for (const m of String(text).matchAll(WORD)) {
      const w = capWord(m[0]);
      if (w) out.add(w);
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
  // With no @, the authority whole as well, up to what a host may not hold ([ ] | ^ % :): a browser keeps
  // , ; ' " ` ( ) in a host, so prose's ends are read both ways.
  const whole = (a) => (a.includes('@') ? '' : tail(a.replace(/[[\]|^%:].*$/s, '')).toLowerCase());
  // Every host in the whole text, lower case, each once: read as markdown decodes the text, then again
  // with each HTML attribute's value read as a browser does. The authority after http: or https: and
  // any slashes or backslashes (or ftp:, ws:, wss:, the browser's other schemes that read a host so),
  // two or more slashes or backslashes not inside a word or path, up to a slash, backslash, ?, #,
  // white space, < or >; another scheme's // up to a slash, ?, #, white space, < or > (a backslash
  // is part of its authority); and where it holds ]( (a link's
  // words ending in an address), each part of it on either side as well. Each address of a mailto:; an
  // e-mail autolink <local@domain> (CommonMark's local-part characters); an e-mail address's host, as
  // GitHub links a bare one (a letter, digit, . _ + or - before the @, a dot in the host); and a bare
  // www. name.
  const HOST = /<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@([\p{L}\p{N}.-]+)>|(?:(?:https?|ftp|wss?):[/\\]*|(?<![\p{L}\p{N}/\\._-])[/\\]{2,})([^\s/\\?#<>]+)|mailto:([^\s/\\?#<>"`()[\]|]+)|(?<=[\p{L}\p{N}._+-])@([\p{L}\p{N}_-][\p{L}\p{N}._-]*)|(?<![\p{L}\p{N}/.@-])(www\.[^\s/\\?#<>]+)|(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/([^\s/?#<>]+)/giu;
  // The third reading: the second, with the white space a URL keeps inside its user taken out, where
  // markdown or HTML lets it stand inside an address (angle-bracket destinations, attribute values,
  // references), the < and > a user may hold there too, and every white space but the ASCII ones.
  // A plain link destination ([x](…), [x]: …, not <…>; after form feeds and vertical tabs, one line break and a quote's > markers
  // too, as pandoc reads them), up to white space, with
  // its < and > taken out: a browser encodes them inside a user.
  const dests = (t) => t.replace(/(\]\(|\]:)([ \t\f\v]*(?:\n[ \t\f\v]*(?:>[ \t\f\v]*)*)?)(\S*)/g, (all, o, sp, v) => (v[0] === '<' ? all : o + sp + v.replace(/\\?[<>]/g, '')));
  // Each quoted value after an = (and any white space), read on its own as ="…" or ='…', so a stray
  // quote elsewhere cannot pair with an attribute's own and leave its value unread. Each value ends at
  // the next quote of its kind, so the values of one kind do not overlap: linear.
  const values = (t) => {
    const out = [];
    for (let i = t.indexOf('='); i >= 0; i = t.indexOf('=', i + 1)) {
      let j = i + 1;
      while (j < t.length && (t[j] === ' ' || t[j] === '\t' || t[j] === '\n' || t[j] === '\f' || t[j] === '\r')) j += 1;
      const q = t[j];
      if (q !== '"' && q !== "'") continue;
      const k = t.indexOf(q, j + 1);
      if (k > 0) out.push(`=${t.slice(j, k + 1)}`);
    }
    return out.join(' ');
  };
  // Every address as a browser reads it: a scheme (at a word's start, any length), a colon, and what
  // follows up to white space, < or >, read by node's URL. Its host, percent-decoded (URL decodes a
  // special scheme's; another's is decoded here); for mailto:, each address of its path and of its
  // to, cc and bcc fields, decoded, past the last @. This closes the class the rules above spell out
  // form by form: a host percent-encoded, behind punctuation a host keeps, or after a long scheme.
  const ADDRESS = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:[^\s<>]*/giu;
  // Each run of %xx decoded on its own, as a browser or a mail client does; a malformed one kept as written.
  const pct = (s) => s.replace(/(?:%[0-9a-f]{2})+/gi, (r) => { try { return decodeURIComponent(r); } catch { return r.replace(/%([0-9a-f]{2})/gi, (x, h) => (parseInt(h, 16) < 128 ? String.fromCharCode(parseInt(h, 16)) : x)); } });
  // An authority read again percent-decoded: whole, past its @, and by node's URL with an https base
  // (so a scheme-relative //host, /\host or www. host is read as a browser on a web page reads it).
  function decoded(a) {
    if (!a.includes('%') && /^[\x20-\x7e]*$/.test(a)) return []; // nothing to decode: the readings above hold it
    const d = pct(a);
    const cut = a.replace(/[[\]|^"'`].*$/s, '');
    const u = URL.canParse(`https://${cut}/`) ? new URL(`https://${cut}/`).hostname : '';
    return [whole(d), host(d), tail(pct(u)).toLowerCase()];
  }
  // A mailto value's addresses: its path and its to, cc and bcc fields, each run of %xx decoded on its
  // own, split at , and ;, the domain past each address's last @ up to what ends it in prose.
  function mailHosts(v) {
    const q = v.indexOf('?');
    const fields = [q < 0 ? v : v.slice(0, q)];
    if (q >= 0) for (const p of v.slice(q + 1).split('&')) { const e = p.indexOf('='); if (e > 0 && /^(?:to|cc|bcc)$/i.test(p.slice(0, e))) fields.push(p.slice(e + 1)); }
    const out = [];
    for (const f of fields) for (const a of pct(f).split(/[,;]/)) { const at = a.lastIndexOf('@'); if (at >= 0) out.push(a.slice(at + 1).replace(/[\s()[\]|^"'`<>].*$/s, '')); }
    return out;
  }
  const MAILTO = /mailto:([^\s<>]*)/gi;
  function urlHosts(s) {
    if (/^mailto:/i.test(s)) return mailHosts(s.slice(7));
    if (!URL.canParse(s)) return [];
    const h = new URL(s).hostname;
    return h ? [pct(h)] : [];
  }
  const third = (t) => decode(attrs(angles(dests(t)), true), true).replace(/[^\S\t\n\v\f\r ]/gu, '');
  function hosts(text) {
    const out = new Set();
    const add = (h) => { if (h) out.add(h); };
    const t = String(text).replace(/\r\n?/g, '\n'); // a line ends at LF, CR or CRLF
    // A URL keeps white space inside its user (a browser encodes it), so a third reading takes out the
    // white space inside angle-bracket destinations, attribute values, and what references decode to.
    const v = values(t);
    for (const each of new Set([decode(t), decode(attrs(t)), third(t), decode(attrs(v)), decode(attrs(v, true), true)])) { // each distinct reading once
      for (const m of each.matchAll(HOST)) {
        if (m[1] !== undefined) add(tail(m[1]).toLowerCase());
        else if (m[2] !== undefined || m[6] !== undefined) {
          const a = m[2] ?? m[6];
          add(host(a)); add(whole(a));
          for (const h of decoded(a)) add(h);
          if (a.includes('](')) for (const b of a.split('](')) { add(host(b)); add(whole(b)); for (const h of decoded(b)) add(h); }
        }
        else if (m[3] !== undefined) { for (const a of m[3].split(/[,;]/)) if (a.includes('@')) add(host(a)); }
        else if (m[4] !== undefined) { const h = tail(m[4]).toLowerCase(); if (h.includes('.')) add(h); }
        else if (m[5] !== undefined) { add(host(m[5])); add(whole(m[5])); for (const h of decoded(m[5])) add(h); }
      }
      for (const m of each.matchAll(MAILTO)) for (const h of mailHosts(m[1])) add(tail(h).toLowerCase());
      for (const u of each.matchAll(ADDRESS)) for (const h of urlHosts(u[0])) add(tail(h).toLowerCase());
    }
    return [...out];
  }

  // Every heading a page shows, in document order: [{ level, text, line }]. Outside code and comments,
  // an ATX heading of any level, at any indent a readable line has (one too deep for a heading reads as
  // one: refusing errs that way), and a setext one, the paragraph's lines above a line of = (level 1)
  // or of - (level 2); each also inside a block quote or a list item, their markers read away (a quote's
  // line goes on the paragraph above, a list item's or a footnote's starts its own). And an HTML <h1>-<h6>
  // tag wherever it stands, in code or a comment too, since an HTML block, a stray backtick or a
  // comment's tail can show one the reading above takes for code: its text up to the next heading tag
  // (HTMLHEAD). Each text is read as a heading's words; a # or ## one's also as a page shows them (seen),
  // with its link hosts, when unnamedHeading asks.
  // Linear in the text: each marker, line and tag read once.
  // The block-quote, list-item and footnote-definition markers that open a line (none matches empty).
  const OPENERS = /^(?:[ \t]*>[ \t]?|[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)|[ \t]*\[\^[^\]\s]{1,999}\]:[ \t]*)*/;
  const UNDER = /^[ \t]*(=+|-+)[ \t]*$/;
  // An HTML heading tag and what follows it up to the next heading tag or the end; its own attributes
  // are dropped up to their first >, so a < in a value can't hide it (one > in a value leaves some in,
  // which only refuses more). Each tag inside reads as its alt text, as a page shows an image's.
  const HTMLHEAD = /<h([1-6])(?=[\s/>])([\s\S]*?)(?=<\/?h[1-6][\s/>]|$)/gi;
  const ALT = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+))/i;
  // A # or ## heading's words as a page shows them (seen), judged beside its text as written: a comment
  // and a processing instruction dropped (each read to its end), an autolink as its address, each tag a
  // line break or a block (BLOCK) as a space, each other tag as its alt text (an image's; none else
  // has one) with no space, as inline tags show; then each character reference decoded and each
  // default-ignorable character (a soft hyphen, a zero-width space or joiner, a word joiner), shown as
  // nothing, dropped. A tag's quoted value is read whole, up to the next <, so linearly. Its text as
  // written stays what is refused.
  const SHOWN = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>|<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/](?:"[^"<]*"|'[^'<]*'|[^<>"'])*)?>/g;
  const BLOCK = /^<\/?(?:br|p|div|hr|li|ul|ol|dl|dt|dd|table|thead|tbody|tfoot|tr|td|th|blockquote|pre|section|article|header|footer|nav|aside|figure|figcaption|details|summary|address|h[1-6])(?![A-Za-z0-9-])/i;
  const INVISIBLE = /\p{Default_Ignorable_Code_Point}|&(?:shy|zwj|zwnj|lrm|rlm|ZeroWidthSpace|Negative(?:VeryThin|Thin|Medium|Thick)Space|NoBreak|it|InvisibleTimes|ic|InvisibleComma|af|ApplyFunction);/gu;
  const alt = (tag) => { const a = ALT.exec(tag); return a ? (a[1] ?? a[2] ?? a[3]) : ''; };
  const shown = (tag) => ` ${alt(tag)} `;
  // s with each run from open to the next close taken out (an unclosed one kept), read once.
  const cut = (s, open, close) => { let out = ''; let at = 0; for (let i = s.indexOf(open); i >= 0; i = s.indexOf(open, at)) { const j = s.indexOf(close, i + open.length); if (j < 0) break; out += s.slice(at, i); at = j + close.length; } return out + s.slice(at); };
  const seen = (s) => decode(cut(cut(words(s), '<!--', '-->'), '<?', '?>').replace(INVISIBLE, '').replace(SHOWN, (t, url) => (url ?? (BLOCK.test(t) ? ' ' : alt(t))))).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  const headed = last((text) => {
    const out = [];
    const add = (level, s, line, text = words(s), kind = {}) => out.push({ level, text, line, raw: s, ...kind });
    let para = []; // the paragraph's lines so far: [line, its text past its markers]
    readable(text).forEach((l, i) => {
      if (l === null || !l.trim()) { para = []; return; }
      const at = OPENERS.exec(l)[0].length;
      const inner = l.slice(at);
      const atx = /^[ \t]*(#{1,6})(?:[ \t]+(.*))?$/s.exec(inner);
      if (atx) { add(atx[1].length, trimST(atx[2] ?? '').replace(/(?:^|[ \t])#+$/, ''), i + 1); para = []; return; }
      const under = para.length && (UNDER.exec(l) ?? UNDER.exec(inner));
      if (under) { add(under[1][0] === '=' ? 1 : 2, para.map((p) => p[1]).join(' '), para[0][0]); para = []; return; }
      if (!inner.trim() || BREAK.test(inner)) { para = []; return; }
      if (/[^> \t]/.test(l.slice(0, at))) para = []; // a list item's line starts its own paragraph
      para.push([i + 1, inner]);
    });
    const raw = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const starts = [0];
    for (let i = raw.indexOf('\n'); i >= 0; i = raw.indexOf('\n', i + 1)) starts.push(i + 1);
    const lineOf = (o) => { let a = 0; let b = starts.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (starts[m] <= o) a = m; else b = m - 1; } return a + 1; };
    // Where a page keeps an HTML heading tag as text (code), so the names rule judges it as before: in a
    // fence or indented code outside an HTML block, or wholly inside a comment, or in a code span whose
    // two marks its line and cell hold (ruling m-20261126-121428851). The lines are cut into blocks as a
    // page cuts them: an HTML block (CommonMark's seven kinds; a fence that opens in one is read as HTML
    // to its end), and a paragraph, which a blank line, a heading, a rule, an underline, a list item, a
    // table row or an HTML block ends. Each block is read by kept, once.
    const ls = lines(text);
    const sc = scan(text).lines;
    const rd = readable(text);
    const kind = []; // each line's: code, html or md
    const blocks = []; // { a, b, md, alone }: first and last line
    let end = null; // what ends the open HTML block: its pattern, or '' for a blank line
    let taken = false; // in a fence that opened in an HTML block
    let rc = false; // readable's comment, to tell its unread lines from indented code
    for (let l = 0; l < ls.length; l += 1) {
      const s = ls[l];
      let comment = false;
      if (!sc[l].code) { comment = rc || /^ {0,3}<!--/.test(s); if (comment) rc = !s.includes('-->'); }
      if (end === '' && !s.trim()) end = null;
      taken = sc[l].code && (sc[l].opens ? end !== null : taken);
      const code = sc[l].code || (rd[l] === null && !comment);
      const last = blocks[blocks.length - 1];
      const para = kind[l - 1] === 'md' && !!ls[l - 1].trim() && !last.alone;
      let k = -1;
      let seven = false;
      if (end === null && !code) {
        const xs = [s.replace(/^ {0,3}/, ''), s.slice(OPENERS.exec(s)[0].length).replace(/^[ \t]*/, '')];
        k = HTMLBLOCK.findIndex(([o]) => xs.some((x) => o.test(x)));
        seven = k < 0 && !para && xs.some((x) => /^<\/?[A-Za-z]/.test(x) && trimST(x).endsWith('>'));
      }
      if (k >= 0 || seven) {
        kind.push('html');
        blocks.push({ a: l, b: l, md: false });
        end = k >= 0 && HTMLBLOCK[k][1] ? HTMLBLOCK[k][1] : '';
      } else if (end !== null || taken) {
        kind.push('html');
        if (kind[l - 1] === 'html') last.b = l; else blocks.push({ a: l, b: l, md: false });
      } else if (code) kind.push('code');
      else {
        kind.push('md');
        const alone = HEAD.test(s) || BREAK.test(s) || UNDER.test(s) || /^ {0,3}\|/.test(s);
        if (!s.trim()) continue;
        if (para && !alone && !LIST.test(s)) last.b = l;
        else blocks.push({ a: l, b: l, md: true, alone });
      }
      if (end && kind[l] === 'html' && end.test(s)) end = null;
    }
    const km = []; // each line as kept reads its block
    const from = []; // where the comment a line's first character is in opened, when on a line before
    const dirty = [0]; // how many lines before each hold a list, quote or footnote marker or a |, or are more than three spaces in
    for (const { a, b, md } of blocks) { let l = a; for (const t of kept(ls.slice(a, b + 1).join('\n'), md).split('\n')) { km[l] = t; if (l > a && (t === '' || t[0] === '\0') && (km[l - 1] === '' ? from[l - 1] !== undefined : km[l - 1].endsWith('\0'))) from[l] = from[l - 1] !== undefined && !/[^\0]/.test(km[l - 1]) ? from[l - 1] : l - 1; l += 1; } }
    for (let l = 0; l < ls.length; l += 1) dirty.push(dirty[l] + (OPENERS.exec(ls[l])[0].length || ls[l].includes('|') || indent(ls[l]) > 3 ? 1 : 0));
    const own = new Map(); // each line read alone: an HTML block's by kept, a markdown one's cell by cell
    // A tag is code where its block's reading and its own line's (and cell's) both keep it as text; or in
    // a comment from a line before, when every line from the one it opened on is at most three spaces in
    // and holds no marker or |, so no quote, table row, list item, heading, rule or code the cut above
    // misses (one in a list item is more than three spaces in) can end the comment or hold its opener.
    const inCode = (o) => {
      const l = lineOf(o) - 1;
      const c = o - starts[l];
      if (kind[l] === 'code') return true;
      const ch = km[l]?.[c];
      if (ch !== ' ' && ch !== '\0') return false;
      if (!own.has(l)) own.set(l, kind[l] === 'html' ? kept(ls[l], false) : cells(ls[l]));
      if (own.get(l)[c] !== '<') return true;
      const f = from[l];
      return ch === '\0' && f !== undefined && dirty[l + 1] === dirty[f];
    };
    for (const m of raw.matchAll(HTMLHEAD)) { const body = m[2].replace(/^[^>]*>/, ''); add(Number(m[1]), body, lineOf(m.index), words(body.replace(/<[^<>]*>/g, shown)), (inCode(m.index) ? { code: true } : { html: true })); }
    return out.filter((h) => h.text).sort((a, b) => a.line - b.line);
  });
  // A top-level heading must be plain text (ruling a-20261126-080419596): a # or ## heading, in any form,
  // and an HTML <h1> to <h6> one, is refused when its text as written (a markdown one's code spans aside)
  // holds raw HTML (< then a letter, /, ! or ?), a character reference (& then # or a letter), a
  // character in \p{C} but a tab or a line's end, a mark left after NFC, a default-ignorable character,
  // ~~, or a [ or ]. Plain text, code spans and * _ emphasis stay, read by the readings below. An HTML
  // heading tag in code or a comment (code) is shown as text: the names rule judges it, as before.
  const NOT_PLAIN = /<[A-Za-z\/!?]|&[#A-Za-z]|[^\P{C}\t\n]|\p{M}|\p{Default_Ignorable_Code_Point}|~~|[\[\]]/u;
  const plainHeading = (h) => h.code || (h.level > 2 && !h.html) || !NOT_PLAIN.test((h.html ? h.raw : mask(h.raw, false)).normalize('NFC'));
  // Whether the names rule refuses a heading: one that is not plain text; one of level 3 to 6 unless names holds it whole; a # or ##
  // one (the title and the sections, in plain words) when it holds a capitalised word, Exterior aside
  // (the document's own name), or a link host, that names doesn't hold whole, read as written, as
  // shown or joined. Each later reading is made only when the one before finds nothing, so a refused heading
  // costs one.
  // A # or ## heading's joined reading, judged beside the two above: its markup taken out with no
  // separator and the spaces typed kept, as a page joins a word a tag or a mark splits. Its spans are
  // cut two ways (joined, joinedAtGt); only a line break or a paragraph (<br>, <p> and their end tags)
  // reads as a space. What is left is squeezed (squeeze). Linear: a span ends at its quote or its >.
  // SPAN: a tag (a quoted value read to its quote), end tag, declaration or autolink, as CommonMark reads it.
  const SPAN = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<![A-Za-z][^<>]*>|<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/g;
  const BREAKS = /^<\/?(?:br|p)(?![A-Za-z0-9-])/i;
  // The text joined after its cuts: each character reference decoded, NFKC-normalised, each format,
  // default-ignorable and combining mark left over dropped, read as words, a reference link's label after
  // its ] taken out, and each ~ * _ ` [ ] mark taken out.
  const squeeze = (t) => words(decode(t).normalize('NFKC').replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}\p{Mn}]/gu, '')).replace(/\]\[[^[\]]{0,999}\]/g, ']').replace(/[~*_`[\]]/g, '');
  // s with each span cut where a page ends it, at its first > (quotes ignored), read once; a comment at
  // -->, --!> or at once; <br>, <p> and their end tags a space. An unclosed span stays as text. Each end
  // looked for is kept until passed, so each is found once.
  const atGt = (s) => {
    let out = '';
    let at = 0;
    const next = {};
    const find = (t, from) => { if (next[t] === undefined || (next[t] >= 0 && next[t] < from)) next[t] = s.indexOf(t, from); return next[t]; };
    for (let i = s.indexOf('<'); i >= 0; i = s.indexOf('<', at)) {
      out += s.slice(at, i);
      if (s.startsWith('<!--', i)) { // a comment ends at once (<!-->, <!--->), or at --> or --!>
        if (s[i + 4] === '>' || s.startsWith('->', i + 4)) { at = i + (s[i + 4] === '>' ? 5 : 6); continue; }
        const ends = [['-->', 3], ['--!>', 4]].map(([t, n]) => [find(t, i + 4), n]).filter(([e]) => e >= 0);
        if (!ends.length) { at = i; break; }
        const [e, n] = ends.reduce((a, b) => (b[0] < a[0] ? b : a));
        at = e + n;
        continue;
      }
      if (!/[A-Za-z/!?]/.test(s[i + 1] ?? '')) { out += '<'; at = i + 1; continue; }
      const e = find('>', i + 1);
      if (e < 0) { at = i; break; }
      if (BREAKS.test(s.slice(i, Math.min(e + 1, i + 6)))) out += ' ';
      at = e + 1;
    }
    return out + s.slice(at);
  };
  // The joined reading, cut two ways (ruling m-20261126-071801827): as CommonMark reads its spans
  // (SPAN, a quoted value to its quote), and as a page ends them (atGt). The invisible characters and
  // their named references go first, before decode. The CDATA cut can't change a verdict (CDATA is
  // upper case, so the reading as written refuses it): kept for the reading's sake.
  const joined = (s) => squeeze(cut(cut(cut(s.replace(INVISIBLE, ''), '<!--', '-->'), '<?', '?>'), '<![CDATA[', ']]>').replace(SPAN, (t) => (BREAKS.test(t) ? ' ' : '')));
  const joinedAtGt = (s) => squeeze(atGt(s.replace(INVISIBLE, '')));
  const unnamedWord = (t, names) => [...t.matchAll(WORD)].some((m) => { const w = capWord(m[0]); return w !== null && w.toLowerCase() !== 'exterior' && !namesWhole(names, w); });
  const unnamedHeading = (h, names) => !plainHeading(h) || (h.level > 2
    ? !namesWhole(names, h.text)
    : unnamedWord(h.text, names) || unnamedWord(seen(h.raw), names) || unnamedWord(joined(h.raw), names)
      || unnamedWord(joinedAtGt(h.raw), names) || hosts(h.raw).some((x) => !namesWhole(names, x)));

  // The text of each heading that is not plain text, in document order.
  const notPlain = (text) => headed(text).filter((h) => !plainHeading(h)).map((h) => h.text);
  // exterior.md: { errors, warnings, refused, held, hosts }. On a repo known private nothing is refused
  // or held; visibility 'public' or 'unknown' keeps the names rule. Every heading, in any form (headed),
  // is judged by allowed.names (origin main's strategy and dependency names) and refused as
  // unnamedHeading says; a word or host by allowed.words (the strategy and the dependency files whole).
  function checkExterior(text, { today, visibility, allowed }) {
    const errors = docErrors(text, 'exterior');
    const all = errors.length ? [] : entries(text);
    const open = visibility === 'private';
    const unknown = (list, by) => (open ? [] : list.filter((w) => !namesWhole(by, w)));
    const refs = webRefs(text);
    return {
      errors,
      warnings: all.flatMap((e) => entryWarnings(e, today, refs)),
      refused: open ? [] : headed(text).filter((h) => unnamedHeading(h, allowed.names)).map((h) => h.text),
      held: unknown(capitalised(text), allowed.words),
      hosts: unknown(hosts(text), allowed.words),
    };
  }

  return { version, checkSelf, selfHeld, scan, plain, headings, links, parts, namesWhole, checkExterior, notPlain };
})();
// 1 when a fence's info string is exactly self or exterior (version 1), else 2.
export const selfPlainVersion = selfPlain.version;
// self.md's errors and part paths: { errors, parts }. root is the file's folder from the repo root
// ('' the root); has(path) says whether a path is in the repo, by exact case.
export const selfPlainCheck = selfPlain.checkSelf;
/* self-plain end */

// The fenced blocks of a markdown file. A fence is a line at column 0 of three or more backticks;
// one opens a block when none is open, its info string the rest of the line, its spaces and tabs
// trimmed (possibly empty). The block closes at the next line of at least as many backticks and
// nothing else but spaces or tabs. Indented and ~~~ fences are prose. Lines split on \r?\n, so a
// file saved with CRLF reads alike. Returns the blocks, the text outside every block (prose), and
// the line of a block that never closes (or null).
export function fencedBlocks(text) {
  const blocks = [];
  const prose = [];
  let open = null;
  String(text).split(/\r?\n/).forEach((line, i) => {
    const m = /^(`{3,})(.*)$/.exec(line);
    if (!open) {
      if (m) open = { ticks: m[1].length, info: m[2].replace(/^[ \t]+|[ \t]+$/g, ''), line: i + 1, body: [] };
      else prose.push(line);
    } else if (m && m[1].length >= open.ticks && /^[ \t]*$/.test(m[2])) {
      blocks.push({ info: open.info, line: open.line, body: open.body.join('\n') });
      open = null;
    } else open.body.push(line);
  });
  return { blocks, prose: prose.join('\n'), unclosed: open ? open.line : null };
}
// Whether text names name: as whole words (no letter or digit just before or after), ignoring case.
export function namesWhole(text, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}
// A self.md's or exterior.md's contract errors (doc 'self' or 'exterior'), empty when it holds.
// The fence, the other doc's block, one block, JSON, an object and the version stop at their first
// error; the schema ($defs[doc].block) gives every error; self's part ids are unique once the schema
// holds. Exterior's own rules past the schema are kit-135's.
export function worldDocErrors(text, doc) {
  const home = { self: 'self.md', exterior: 'exterior.md' };
  const other = doc === 'self' ? 'exterior' : 'self';
  const article = (w) => (/^[aeiou]/.test(w) ? 'an' : 'a');
  const b = fencedBlocks(text);
  if (b.unclosed) return [`a fenced block opened at line ${b.unclosed} never closes`];
  if (b.blocks.some((x) => x.info === other)) return [`${article(other)} ${other} block belongs in ${home[other]}, not ${home[doc]}`];
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
  const errs = schemaErrors(SCHEMA.$defs[doc].block, v, doc);
  if (errs.length) return errs;
  if (doc === 'self') {
    const seen = new Set();
    v.parts.forEach((p, i) => {
      if (seen.has(p.id)) errs.push(`self.parts[${i}].id "${p.id}" is shared`);
      seen.add(p.id);
    });
  }
  return errs;
}
// The folder a self.md's part links resolve from, from the repo root: the project folder's. A project
// outside its repo has no repo for a part to be in, so its own folder stands in for one ('').
export const selfRoot = () => (projectInRepo ? projectRel : '');
// A self.md's text in, as validate reads it: { version, block, errors }. Version 1 (a fenced self or
// exterior block, selfPlainVersion) against self@1, its block parsed when it holds; one whose block
// self@1's reader can't find (a ~~~ fence, one indented or in a list item) gets self@2's block error,
// so validate and self check say the same. Version 2 against self@2's form, no repo needed: the
// title, at least one part, none leaving the repo or with a bad escape. Whether each part is there
// is the draft's check (selfDraftErrors); on main a part gone is self-drift.
export function selfDoc(text) {
  const version = selfPlainVersion(text);
  const plain = () => ({ version, block: null, errors: selfPlainCheck(text, { root: selfRoot(), has: () => true }).errors });
  if (version === 2) return plain();
  const b = fencedBlocks(text);
  if (!b.unclosed && !b.blocks.some((x) => x.info === 'self' || x.info === 'exterior')) return plain();
  const errors = worldDocErrors(text, 'self');
  if (errors.length) return { version, block: null, errors };
  return { version, block: JSON.parse(b.blocks.find((x) => x.info === 'self').body), errors };
}
// A draft self.md's errors (self@2, log.schema.json#self2): the one judgment self check, chore pr and
// check-pr make. A version 1 block is refused, alone; else the title, then the parts, each part link
// resolved from selfRoot() and looked for with has(path) (the disk, or a commit's tree).
export function selfDraftErrors(text, has) {
  return selfPlainCheck(text, { root: selfRoot(), has }).errors;
}
// A part's code path as the disk and git checks both read it: split on /, empty and . segments
// dropped, joined. '' is the repo root. (The schema refuses a leading / and any .. segment.)
export function partPath(p) {
  return String(p).split('/').filter((s) => s !== '' && s !== '.').join('/');
}
// Whether a normalised path is on disk under the repo root (the project folder, for a project outside
// its repo: selfRoot), each segment matched by its exact case (as git reads it), so App/ is missing
// beside app/ on a disk that folds case too.
export function hasOnDisk(n) {
  let dir = projectInRepo ? projectRoot : projectDir;
  for (const seg of n === '' ? [] : n.split('/')) {
    let names;
    try { names = fs.readdirSync(dir); } catch { return false; }
    if (!names.includes(seg)) return false;
    dir = path.join(dir, seg);
  }
  return true;
}
// Whether a normalised path is in a commit's tree.
export const hasAt = (commit) => (n) => n === '' || git(['cat-file', '-e', `${commit}:${n}`]) !== null;
export const selfRel = () => `${projectRel}/self.md`;
// main's self.md, or null when main has none; with no main, or the project outside the repo, the
// working tree's (as strategyState reads the strategy).
export function selfMainText() {
  return projectInRepo && mainRef() ? git(['show', `${mainRef()}:${selfRel()}`]) : readText(path.join(projectDir, 'self.md'));
}
// dashboard-data's self block (log.schema.json#self@1 dashboard): main's self.md as check.mjs's
// dashboardSelf gives it, or null when main has none, breaks the contract or is plain (self@2: the
// page reads the document; kit-868 drops the key).
export function selfDashboard() {
  const text = selfMainText();
  const b = text === null ? null : selfDoc(text).block;
  return b && { what: b.what, makes: b.makes, parts: b.parts.map((p) => ({ id: p.id, name: p.name, what: p.what, code: p.code })), controls: b.controls, not: b.not };
}
// The names rule. A draft is pushed, and on a repo not known to be private it is public, so a
// capitalised word main's strategy and dependency files don't contain is one to check before then:
// a name of someone the project may not want named in public. A heuristic: a lowercase name is
// never caught, and a one-word name that starts a sentence is skipped (spec §6).
//
// The capitalised words of pieces ([{ where, text, sentences }]): [{ word, where }], each word once,
// at its first piece. A word is a run of letters, digits, ' ’ and - that starts with a letter, a
// trailing 's or ’s (and then any trailing ' ’ or -) dropped; capitalised when its first letter is
// upper case and it is two letters or more. With sentences, a sentence's first word is skipped: at
// the start of the text, after a blank line, on a line that starts a markdown block (#, -, *, +,
// >, | or 1.), after a | table cell, and after . ! or ? and a space. A newline inside a paragraph
// (a wrapped line) starts nothing. Everything else counts, inline code, links and comments too.
export function capitalisedWords(pieces) {
  const found = [];
  const seen = new Set();
  for (const { where, text, sentences } of pieces) {
    const s = String(text);
    let prevEnd = null;
    for (const m of s.matchAll(/[\p{L}][\p{L}\p{N}'’-]*/gu)) {
      const gap = s.slice(prevEnd ?? 0, m.index);
      const starts = prevEnd === null || /[.!?]\s/.test(gap) || /\n[ \t]*\r?\n/.test(gap) || /\n[ \t]*(?:[#*+>|-]|\d+\.)/.test(gap) || gap.includes('|');
      prevEnd = m.index + m[0].length;
      if (sentences && starts) continue;
      const word = m[0].replace(/['’]s$/, '').replace(/['’-]+$/, '');
      if (!/^\p{Lu}/u.test(word) || [...word].length < 2 || seen.has(word)) continue;
      seen.add(word);
      found.push({ word, where });
    }
  }
  return found;
}
// The text the names rule reads, at ref: the project's strategy.md and the repo root's
// package.json, Gemfile and requirements.txt, joined; a missing file reads as ''. With no ref, or
// the project outside the repo, the working tree's.
export function namesAllowedText(ref = mainRef()) {
  const at = (rel) => (projectInRepo && ref ? git(['show', `${ref}:${rel}`]) : readText(path.join(projectRoot, rel))) ?? '';
  return [strategyRel, 'package.json', 'Gemfile', 'requirements.txt'].map(at).join('\n');
}
// The capitalised words of pieces that allowed doesn't name (as a whole word, ignoring case): self
// check, chore pr and check-pr read a version 1 block's pieces with it (selfWords; a plain self.md's
// words come from the self-plain region's selfHeld), and kit-135 exterior.md's.
export function unknownNames(pieces, allowed) {
  return capitalisedWords(pieces).filter((w) => !namesWhole(allowed, w.word));
}
// A self.md's pieces for the names rule. The text outside the self block ('prose', with sentences;
// every other fenced block is in it), then the block's what, makes and each part's what (with
// sentences), each part's name, controls[i] and not[i] (every word). The ids are left out, and so is
// each code path has(partPath(p)) finds: it names a file already in the repo. One it doesn't (an
// earlier blob's) is read like any text.
export function selfPieces(text, block, has) {
  const lines = String(text).split(/\r?\n/);
  const b = fencedBlocks(text).blocks.find((x) => x.info === 'self');
  // the block's lines, opening fence to closing, become one blank line
  lines.splice(b.line - 1, b.body.split('\n').length + 2, '');
  const pieces = [{ where: 'prose', text: lines.join('\n'), sentences: true }];
  const add = (where, t, sentences) => pieces.push({ where, text: t, sentences });
  add('what', block.what, true);
  add('makes', block.makes, true);
  block.parts.forEach((p, i) => {
    add(`parts[${i}].name`, p.name, false);
    add(`parts[${i}].what`, p.what, true);
    p.code.forEach((c, j) => { if (!has(partPath(c))) add(`parts[${i}].code[${j}]`, c, false); });
  });
  block.controls.forEach((c, i) => add(`controls[${i}]`, c, false));
  block.not.forEach((c, i) => add(`not[${i}]`, c, false));
  return pieces;
}
// One self.md blob's unknown words, less what allowed names: a version 1 block's pieces, or with no
// parsed block (a plain document, or a draft whose contract fails, so its words still count) the
// self-plain region's selfHeld, each word at 'prose': a heading, a list item, a table row, a link's
// words, code and a comment read whole, a prose sentence's first word skipped (kit-862 final-1b F1).
export function selfWords(text, has, allowed) {
  const { block } = selfDoc(text);
  if (!block) return selfPlain.selfHeld(text).filter((word) => !namesWhole(allowed, word)).map((word) => ({ word, where: 'prose' }));
  return unknownNames(selfPieces(text, block, has), allowed);
}
// Whether a strategy links self.md: in its prose (outside every fenced block), an inline link to
// self.md or ./self.md (an optional #anchor and "title"), or a reference definition naming it.
export function linksSelf(strategyText) {
  const prose = fencedBlocks(strategyText ?? '').prose;
  return /\]\(\s*(?:\.\/)?self\.md(?:#[^\s)]*)?(?:\s+"[^"]*")?\s*\)/.test(prose) || /^\s*\[[^\]]+\]:\s*(?:\.\/)?self\.md(?:#\S*)?\s*$/m.test(prose);
}
// main's strategy.md, as strategyState reads it, or null when missing.
export const strategyMainText = () => (projectInRepo && mainRef() ? git(['show', `${mainRef()}:${strategyRel}`]) : readText(path.join(projectDir, 'strategy.md')));
// How loud a missing Self or exterior is (kit-814): high, so wait keeps bringing it back, until the
// owner has a draft of the next step it names; medium while a question of that step's class (cls) is
// open. An answered one, approved or refined, counts for nothing: it is high again until the draft
// lands or is asked again, as strategy-unwritten is.
export function worldMissingSeverity(cls) {
  return questions().some((q) => q.status === 'open' && q.class === cls) ? 'medium' : 'high';
}
// metrics' self findings, read from main (none with no main, or the project outside the repo), each
// keyed so observeFindings keeps one observation per path or strategy blob: self-drift once while
// main's self.md is version 1 (key self@1, asking for the plain version, and none per path), else
// once per part link whose path main lacks (key the path from the repo root); self-unlinked while main has a self.md its
// strategy doesn't link; both low. self-missing while the strategy is written and main has no
// self.md, its next step the strategy-change link first when the strategy doesn't link it, then
// self-change: high until that step is asked, medium while it is (worldMissingSeverity).
export function selfFindings(add) {
  const main = projectInRepo ? mainRef() : null;
  if (!main) return;
  const text = selfMainText();
  const strategy = strategyMainText();
  const strategyKey = git(['rev-parse', '--verify', '--quiet', `${main}:${strategyRel}`]) ?? undefined;
  const linked = linksSelf(strategy);
  if (text !== null) {
    if (selfPlainVersion(text) === 1) add('low', 'self-drift', 'self', "main's self.md is version 1 (a fenced self block)", 'draft self.md as a plain document in a chore, each part a link to its folder or file (self check, then chore pr and ask self-change; supervisor.md, Monitoring)', { key: 'self@1' });
    else {
      const has = hasAt(main);
      for (const p of selfPlain.parts(text, selfRoot())) if (p.path !== null && !has(p.path)) add('low', 'self-drift', 'self', `part link ${p.target} points to nothing on main`, 'the code moved: draft a new self.md in a chore (self check, then chore pr and ask self-change; supervisor.md, Monitoring)', { key: p.path });
    }
    if (!linked) add('low', 'self-unlinked', 'self', 'main has self.md and its strategy.md does not link it', 'propose a strategy-change linking [self.md](./self.md) in place of any lines restating what the project is, in its own PR', { key: strategyKey });
  } else if (strategyState() === 'written') {
    const draft = 'draft self.md from the code and the strategy in a chore, run self check, and ask self-change (supervisor.md, Monitoring)';
    add(worldMissingSeverity(linked ? 'self-change' : 'strategy-change'), 'self-missing', 'self', 'the strategy is written and main has no self.md', linked ? draft : `first propose a strategy-change linking [self.md](./self.md), in its own PR; then ${draft}`, { key: strategyKey });
  }
}
// The draft's history. Every self.md blob the branch carries since its merge base is pushed with it
// and lands with merge --no-ff, so the names rule reads each, not only the head's.
//
// Every distinct blob of rel that a commit in base..head introduces, oldest first: [{ commit, blob }].
// A commit's entry is kept only when it is a plain file (mode 100644 or 100755: a folder, link or
// submodule is the owner's-files gate's to refuse), and only when its blob is neither base's nor any
// parent's at rel (a merge bringing main's blob in introduces nothing). A commit with no file is
// skipped. With no base, head's whole history is read. kit-135 reuses it for exterior.md.
export function draftBlobs(base, head, rel) {
  const blobAt = (c) => {
    const m = /^(\d{6}) (\w+) ([0-9a-f]+)\t/.exec(git(['ls-tree', c, '--', rel], mainRoot) ?? '');
    return m && m[2] === 'blob' && (m[1] === '100644' || m[1] === '100755') ? m[3] : null;
  };
  const listed = git(['rev-list', '--reverse', '--full-history', '--parents', head, ...(base ? [`^${base}`] : []), '--', rel], mainRoot);
  const known = new Set();
  if (base) known.add(git(['rev-parse', '--verify', '--quiet', `${base}:${rel}`], mainRoot));
  const found = [];
  for (const line of (listed ?? '').split('\n').filter(Boolean)) {
    const [commit, ...parents] = line.split(' ');
    const blob = blobAt(commit);
    if (!blob || known.has(blob) || parents.some((p) => git(['rev-parse', '--verify', '--quiet', `${p}:${rel}`], mainRoot) === blob)) continue;
    known.add(blob);
    found.push({ commit, blob });
  }
  return found;
}
// The words of every draft blob of rel in base..head, as wordsOf(text, has) gives them, with has the
// head's tree (a path the head has names the project's own file; one it lacks is read as text):
// [{ word, where, commit }]. The head's own blob first, its words carrying commit null; then each
// earlier blob, oldest first, a word only it holds carrying its commit. Each word once, at its first place.
export function draftWords(base, head, rel, wordsOf) {
  const has = hasAt(head);
  const headBlob = git(['rev-parse', '--verify', '--quiet', `${head}:${rel}`], mainRoot);
  const blobs = draftBlobs(base, head, rel);
  const order = [...blobs.filter((b) => b.blob === headBlob).map((b) => ({ ...b, commit: null })), ...blobs.filter((b) => b.blob !== headBlob)];
  const words = [];
  const seen = new Set();
  for (const { commit, blob } of order) {
    for (const w of wordsOf(git(['cat-file', 'blob', blob], mainRoot) ?? '', has)) {
      if (seen.has(w.word)) continue;
      seen.add(w.word);
      words.push({ word: w.word, where: w.where, commit });
    }
  }
  return words;
}
// The repo's visibility as GitHub says, for the names hold: origin's repo by name (never gh's own
// default), PUBLIC public, PRIVATE or INTERNAL private, anything else (no owner/repo for origin, gh
// missing, logged out, offline, or past its timeout: 15 s, DEVTEAM_GH_TIMEOUT_MS for tests) unknown,
// which holds like public. Each answer is recorded, whole, in run/repo-visibility.json for metrics
// (lastRepoVisibility), which makes no network call.
export const REPO_VISIBILITY = runPath('repo-visibility.json');
export function repoVisibility() {
  const spec = ghSpec(git(['config', '--get', 'remote.origin.url']));
  const said = spec ? repo('home').gh(['repo', 'view', spec, '--json', 'visibility', '--jq', '.visibility'], { cwd: mainRoot, timeout: Number(process.env.DEVTEAM_GH_TIMEOUT_MS) || 15000, killSignal: 'SIGKILL' }) : null;
  const visibility = said === 'PUBLIC' ? 'public' : said === 'PRIVATE' || said === 'INTERNAL' ? 'private' : 'unknown';
  try { writeJson(REPO_VISIBILITY, { visibility, at: new Date().toISOString() }); } catch {}
  return visibility;
}
export function lastRepoVisibility() {
  try {
    const v = readJson(REPO_VISIBILITY).visibility;
    return ['public', 'private', 'unknown'].includes(v) ? v : 'unknown';
  } catch {
    return 'unknown';
  }
}
// The words the supervisor has checked for act's draft of scope ('self', or kit-135's 'exterior'):
// those its names-checked acts name (each a name:<word> ref, matched exactly) whose refs include act,
// logged at or after since (the branch's merge base's committer time, in ms, as Date.parse reads the
// log's created_at; not a finite number: nothing counts, failing closed). Only a chore's act clears
// anything: a plan or ticket PR has no chore to name it on.
export function namesChecked(act, scope, since) {
  const words = new Set();
  if (!String(act).startsWith('chore-')) return words;
  const from = Number.isFinite(since) ? since : Infinity;
  for (const a of logObjects('act')) {
    if (a.class !== 'names-checked' || a.scope !== scope || writerClass(a.created_by) !== 'supervisor') continue;
    const refs = Array.isArray(a.refs) ? a.refs : [];
    if (!refs.includes(act) || !(Date.parse(a.created_at) >= from)) continue;
    for (const r of refs) if (typeof r === 'string' && r.startsWith('name:')) words.add(r.slice(5));
  }
  return words;
}
// check-pr's names rule for a draft: each word of words ([{ word, where, commit }]) not in checked
// is a fail on a public repo and a warning on an unknown one; a private repo holds nothing.
// visibility is called only when a word is unchecked, so a PR without one makes no gh call.
export function namesHoldLines({ rel, words, act, checked, visibility }) {
  const open = words.filter((w) => !checked.has(w.word));
  if (!open.length) return { fails: [], warns: [] };
  const v = visibility();
  if (v === 'private') return { fails: [], warns: [] };
  const chore = String(act).startsWith('chore-');
  const tail = chore
    ? `; check it and name it on the chore (chore pr ${String(act).slice(6)} --names-checked …), or reword it; if you named it with chore pr --names-checked and this check runs where the live log isn't (a forge's CI), land the log (log-sync, then merge --chore log) and run the check again`
    : `; a plan or ticket PR has no chore to name it on, so reword it (a change to ${path.basename(rel)} belongs in a chore)`;
  const lines = open.map((w) => `${rel} names "${w.word}" (${w.where})${w.commit ? ` in ${w.commit.slice(0, 12)}` : ''}, which main's strategy.md and dependency files don't, on a public repo${tail}`);
  return v === 'public' ? { fails: lines, warns: [] } : { fails: [], warns: lines };
}
// The names-checked act chore pr logs once every word is named: the words, the draft's blob, the chore.
export function logNamesChecked(slug, rel, blob, words) {
  const scope = path.basename(rel, '.md');
  return appendLog({ type: 'act', class: 'names-checked', scope, what: `checked the names ${words.join(', ')} in ${rel} (blob ${String(blob).slice(0, 12)}) before pushing chore-${slug}`, refs: [`chore-${slug}`, ...words.map((w) => `name:${w}`)], reversible: false }, 'supervisor');
}
// chore pr's hold on a self.md draft (spec §3.3), run after its commit and before its push: the
// contract and each part's path at head, then the names of every draft blob. Returns null to push
// (any warnings printed), or the refusal. named: the --names-checked words, or null.
export function choreSelfHold(slug, base, head, named, exteriorChanged = false) {
  const rel = selfRel();
  if (!projectInRepo || !draftBlobs(base, head, rel).length) return named && !exteriorChanged ? 'chore pr: --names-checked is for a chore changing self.md or exterior.md' : null;
  if (git(['cat-file', '-e', `${head}:${rel}`], mainRoot) !== null) {
    const errors = selfDraftErrors(git(['show', `${head}:${rel}`], mainRoot) ?? '', hasAt(head));
    if (errors.length) return [...errors.map((e) => `chore pr: self.md: ${e}`), `chore pr: self.md breaks self@2 at ${head.slice(0, 12)}; run self check`].join('\n');
  }
  const allowed = namesAllowedText();
  const words = draftWords(base, head, rel, (text, has) => selfWords(text, has, allowed));
  const shown = (w) => `"${w.word}" (${w.where})${w.commit ? ` in ${w.commit.slice(0, 12)}` : ''}`;
  const open = words.filter((w) => !named?.has(w.word));
  if (open.length) {
    const v = repoVisibility();
    if (v === 'private') {
      for (const w of open) warn(`self.md: ${shown(w)} is in neither main's strategy.md nor its package.json, Gemfile or requirements.txt: the repo is private, so it may be pushed`);
      return null;
    }
    const lines = [`chore pr: self.md names words main's strategy.md and dependency files don't, and ${v === 'public' ? 'this repo is public' : 'this repo\'s visibility is unknown'}, so the draft is public once pushed: ${open.map(shown).join(', ')}; reword them, or check each and name it: --names-checked ${words.map((w) => w.word).join(',')}`];
    const theirs = git(['ls-remote', 'origin', `refs/heads/chore-${slug}`], mainRoot)?.split('\t')[0] || null;
    for (const c of [...new Set(open.map((w) => w.commit).filter(Boolean))]) {
      const pushed = theirs && git(['merge-base', '--is-ancestor', c, theirs], mainRoot) !== null;
      lines.push(`${c.slice(0, 12)}: ${pushed ? `that commit is pushed already, so the word is public on chore-${slug}: name it once checked, or start the chore again from main (chore drop ${slug} --reason "…", then chore start ${slug} --fresh)` : `that commit is not pushed yet: drop it from the branch (git -C .worktrees/chore-${slug} rebase or reset) and run chore pr again, or check and name the word`}`);
    }
    return lines.join('\n');
  }
  if (named && words.length) logNamesChecked(slug, rel, git(['rev-parse', '--verify', '--quiet', `${head}:${rel}`], mainRoot) ?? draftBlobs(base, head, rel).pop().blob, words.map((w) => w.word));
  return null;
}
// check-pr's hold on a PR changing self.md (spec §3.3), for checkPr in home: when a commit in
// merge-base..sha changes it, the contract at sha and each part's path there (both only while sha
// holds the file: a deletion is kit-138's gate), then namesHoldLines over every draft blob, whether
// or not the contract holds. { fails, warns }.
export function selfDraftLines(base, sha, branch) {
  const rel = selfRel();
  if (!projectInRepo || !draftBlobs(base, sha, rel).length) return { fails: [], warns: [] };
  const fails = [];
  if (git(['cat-file', '-e', `${sha}:${rel}`], mainRoot) !== null) {
    const errors = selfDraftErrors(git(['show', `${sha}:${rel}`], mainRoot) ?? '', hasAt(sha));
    fails.push(...errors.map((e) => `${rel} breaks self@2 at ${sha.slice(0, 12)}: ${e}`));
  }
  const allowed = namesAllowedText();
  const words = draftWords(base, sha, rel, (text, has) => selfWords(text, has, allowed));
  const act = worldFileFails.actOf(branch);
  const ct = base ? git(['show', '-s', '--format=%ct', base], mainRoot) : null;
  const since = ct && /^\d+$/.test(ct) ? Number(ct) * 1000 : NaN;
  const names = namesHoldLines({ rel, words, act, checked: namesChecked(act, 'self', since), visibility: repoVisibility });
  return { fails: [...fails, ...names.fails], warns: names.warns };
}
export const SELF_NOT_DRAFTED = 'self.md is not drafted yet: the supervisor drafts it from the code and the strategy (supervisor.md, Monitoring)';
// self show [--json]: main's self.md, printed as it is, either version (--json: selfDashboard, a
// version 1 block or null). self check: the working tree's, the draft, against self@2 with each part
// link on disk (selfDraftErrors: errors, exit 1), then the names rule and whether main's strategy
// links self.md (warnings, the exit unchanged).
export function cmdSelf() {
  const sub = positional[0];
  if (sub === 'show') {
    gitReadCache = new Map();
    const text = selfMainText();
    if (text === null) return flags.json ? json(null) : out(SELF_NOT_DRAFTED);
    if (flags.json) return json(selfDashboard());
    out(`Self: ${selfRel()} ${projectInRepo && mainRef() ? 'on main' : 'in the working tree'}`);
    out('');
    out(String(text).replace(/\s+$/, ''));
    return;
  }
  if (sub === 'check') {
    const text = readText(path.join(projectDir, 'self.md'));
    if (text === null) return out(SELF_NOT_DRAFTED);
    const errors = selfDraftErrors(text, hasOnDisk);
    for (const e of errors) out(`error: self.md: ${e}`);
    gitReadCache = new Map();
    for (const w of selfWords(text, hasOnDisk, namesAllowedText())) out(`warning: self.md: "${w.word}" (${w.where}) is in neither main's strategy.md nor its package.json, Gemfile or requirements.txt: on a repo not known to be private, the draft is public once its branch is pushed`);
    if (selfMainText() !== null && !linksSelf(strategyMainText())) out('warning: main\'s strategy.md does not link self.md: propose a strategy-change adding [self.md](./self.md), in its own PR');
    process.exit(errors.length ? 1 : 0);
  }
  die('usage: self show [--json] | self check');
}
/* self-model end */
