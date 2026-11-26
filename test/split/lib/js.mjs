// A small JavaScript scanner for the split tool: no parser, only what a split needs. It blanks
// comments, strings, template text and regex literals (keeping every newline and every ${} code), and
// records each line's state at its start: the bracket depth, and whether the line starts inside a
// comment, string or template, and if so where on the line its code resumes (resume: { col, depth }).
// The regex-or-division guess is the one test/devteam-mjs-regions uses.
const REGEX_AFTER = '(,=:[!&|?{};+-*%<>~^';
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new', 'else', 'do', 'yield', 'await', 'instanceof']);

// { code, lines: [{ depth, inside, resume? }] } with lines[0] for line 1.
export function scan(src) {
  const o = src.split('');
  const n = src.length;
  const sp = (a, b) => { for (let k = a; k < b && k < n; k++) if (o[k] !== '\n') o[k] = ' '; };
  const lines = [{ depth: 0, inside: false }];
  const lineAt = []; // offset of each newline handled as code
  const resumes = []; // [offset, depth] where code resumes after a comment or template text over a newline
  const template = (start) => {
    for (let k = start; k < n;) {
      if (src[k] === '\\') { k += 2; continue; }
      if (src[k] === '`') { sp(start, k); return { end: k + 1, open: false }; }
      if (src[k] === '$' && src[k + 1] === '{') { sp(start, k); return { end: k + 2, open: true }; }
      k++;
    }
    sp(start, n);
    return { end: n, open: false };
  };
  const tpl = [];
  let depth = 0, other = 0, last = '', word = '', i = 0;
  const afterTemplate = (r) => {
    const over = src.slice(i, r.end).includes('\n');
    i = r.end; if (r.open) { tpl.push(depth); depth++; last = '{'; } else last = 'x'; word = '';
    if (over) resumes.push([i, depth + other]);
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; sp(i, end); i = end; continue; }
    if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2;
      if (src.slice(i, end).includes('\n')) resumes.push([end, depth + other]);
      sp(i, end); i = end; continue;
    }
    if (c === "'" || c === '"') {
      let k = i + 1;
      while (k < n && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      sp(i + 1, k);
      i = k + 1; last = 'x'; word = '';
      continue;
    }
    if (c === '`') { afterTemplate(template(i + 1)); continue; }
    if (c === '{') { depth++; last = c; word = ''; i++; continue; }
    if (c === '}') {
      depth--;
      if (tpl.length && depth === tpl[tpl.length - 1]) { tpl.pop(); afterTemplate(template(i + 1)); continue; }
      last = c; word = ''; i++;
      continue;
    }
    if (c === '(' || c === '[') other++;
    if (c === ')' || c === ']') other--;
    if (c === '/' && (last === '' || REGEX_AFTER.includes(last) || REGEX_WORDS.has(word))) {
      let k = i + 1, cls = false;
      while (k < n && src[k] !== '\n') {
        if (src[k] === '\\') { k += 2; continue; }
        if (cls) { if (src[k] === ']') cls = false; } else if (src[k] === '[') cls = true; else if (src[k] === '/') break;
        k++;
      }
      sp(i + 1, k);
      k++;
      while (k < n && /[a-z]/i.test(src[k])) k++;
      i = k; last = 'x'; word = '';
      continue;
    }
    if (c === '\n') lineAt.push([i, depth + other]);
    if (/[\w$]/.test(c)) { let k = i; while (k < n && /[\w$]/.test(src[k])) k++; word = src.slice(i, k); last = 'x'; i = k; continue; }
    if (!/\s/.test(c)) { last = c; word = ''; }
    i++;
  }
  // every line starts inside something unless its newline was read as code
  const code = o.join('');
  const starts = new Map(lineAt.map(([at, dp]) => [at, dp]));
  let at = src.indexOf('\n'), r = 0;
  while (at !== -1) {
    const next = src.indexOf('\n', at + 1), end = next < 0 ? n : next;
    if (starts.has(at)) lines.push({ depth: starts.get(at), inside: false });
    else {
      while (r < resumes.length && resumes[r][0] <= at) r++;
      const line = { depth: null, inside: true };
      if (r < resumes.length && resumes[r][0] <= end) line.resume = { col: resumes[r][0] - at - 1, depth: resumes[r][1] };
      lines.push(line);
    }
    at = next;
  }
  return { code, lines };
}

// A top-level declaration's line: function, async function, generator, class, const, let or var,
// with or without export: { kind, names, exported, keyword } (names for a function or class only;
// a const, let or var's names come from bindingNames over its whole statement).
const DECL = /^(export\s+)?(?:(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|(const|let|var)(?=[\s{[]))/;
export function declOf(codeLine) {
  const m = codeLine.match(DECL);
  if (!m) return null;
  const exported = !!m[1];
  if (m[2] || m[3]) return { kind: m[2] ? 'function' : 'class', names: [m[2] ?? m[3]], exported, keyword: m[0].length };
  return { kind: m[4], names: null, exported, keyword: m[0].length };
}

// The names a const, let or var statement binds, from its blanked code after the keyword (it may
// span lines): every declarator's identifier, and every binding inside an object or array pattern,
// nested, with rest and defaults. { names, unread }: unread when a declarator has a form this
// doesn't read (a computed or quoted key), so a caller reports it rather than miss a name.
export function bindingNames(code) {
  let i = 0;
  const names = [];
  const ws = () => { while (i < code.length && /\s/.test(code[i])) i++; };
  const ident = () => { ws(); const m = /^[A-Za-z_$][\w$]*/.exec(code.slice(i, i + 200)); if (!m) return null; i += m[0].length; return m[0]; };
  // an initializer or default: to the next , or ; at its own depth, or the closer of the pattern
  const skip = () => { let d = 0; for (; i < code.length; i++) { const c = code[i]; if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) { if (!d) return; d--; } else if (!d && (c === ',' || c === ';')) return; } };
  const pattern = () => {
    ws();
    const open = code[i];
    if (open !== '{' && open !== '[') { const n = ident(); if (!n) return false; names.push(n); return true; }
    const close = open === '{' ? '}' : ']';
    i++;
    for (;;) {
      ws();
      if (code[i] === close) { i++; return true; }
      if (open === '[' && code[i] === ',') { i++; continue; }
      if (code.startsWith('...', i)) { i += 3; if (!pattern()) return false; }
      else if (open === '[') { if (!pattern()) return false; }
      else {
        const k = ident();
        if (!k) return false; // a computed or quoted key
        ws();
        if (code[i] === ':') { i++; if (!pattern()) return false; } else names.push(k);
      }
      ws();
      if (code[i] === '=') { i++; skip(); ws(); }
      if (code[i] === ',') { i++; continue; }
      if (code[i] === close) { i++; return true; }
      return false;
    }
  };
  for (;;) {
    if (!pattern()) return { names, unread: true };
    ws();
    if (code[i] === '=') { i++; skip(); }
    if (code[i] === ',') { i++; continue; }
    return { names, unread: false };
  }
}

// Whether a line's blanked code, from depth d, comes back to depth 0 (after a ; or a closing
// bracket) and then begins another declaration on the same line.
const NEXT_DECL = /^\s*(?:export\s+)?(?:async\s+function|function|class|const|let|var)(?=[\s{[*(])/;
function secondDecl(c, d) {
  for (let k = 0; k < c.length; k++) {
    const ch = c[k];
    if ('([{'.includes(ch)) d++;
    else if (')]}'.includes(ch)) { d--; if (d === 0 && NEXT_DECL.test(c.slice(k + 1))) return true; }
    else if (ch === ';' && d === 0 && NEXT_DECL.test(c.slice(k + 1))) return true;
  }
  return false;
}

const COMMENT = /^(?:\/\/|\/\*| ?\*)/;
const MARK0 = /^(?:\/\*\s*([A-Za-z0-9_$.-]+)\s+(start|end)\s*\*\/|\/\/\s*([A-Za-z0-9_$.-]+)\s+(start|end))\s*$/;

// The file's top-level items, in order, partitioning its lines: { kind: 'head'|'decl'|'mark'|'import',
// names, from, to, line } (1-based, inclusive). A declaration starts at the comment lines directly
// above it and runs to the line before the next item; a top-level statement that is no declaration
// stays inside the item before it, and is listed in statements. A column-0 region marker is its own
// item, as fileParts ends a declaration there.
export function items(src) {
  const { code, lines: info } = scan(src);
  const lines = src.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); // a final newline ends the last line
  const codeLines = code.split('\n');
  const n = lines.length;
  const starts = [];
  const statements = [];
  for (let i = 1; i <= n; i++) {
    const st = info[i - 1];
    if (!st || st.inside || st.depth !== 0) continue;
    const l = lines[i - 1];
    if (!l || /^\s/.test(l)) continue;
    const mk = l.match(MARK0);
    if (mk) { starts.push({ kind: 'mark', names: [`${mk[1] ?? mk[3]} ${mk[2] ?? mk[4]}`], line: i, from: i }); continue; }
    if (COMMENT.test(l)) continue;
    if (/^import[\s{*'"]/.test(l)) { starts.push({ kind: 'import', names: [], line: i, from: i }); continue; }
    const d = declOf(codeLines[i - 1]);
    if (d) { starts.push({ kind: 'decl', decl: d.kind, names: d.names, keyword: d.keyword, exported: d.exported, line: i, from: i }); continue; }
    if (/^[}\])]/.test(codeLines[i - 1])) continue;
    statements.push({ line: i, text: l });
  }
  // a declaration takes the comment lines directly above it, as fileParts does: lines starting //,
  // /* or * (a block comment's), not across a marker, a blank line or the item above
  for (let j = 0; j < starts.length; j++) {
    const s = starts[j];
    if (s.kind !== 'decl') continue;
    const floor = j ? starts[j - 1].line + 1 : 1;
    while (s.from > floor && COMMENT.test(lines[s.from - 2]) && !MARK0.test(lines[s.from - 2])) s.from--;
  }
  const out = [];
  if (!starts.length || starts[0].from > 1) out.push({ kind: 'head', names: ['(head)'], from: 1, line: 1 });
  out.push(...starts);
  for (let j = 0; j < out.length; j++) out[j].to = j + 1 < out.length ? out[j + 1].from - 1 : n;
  for (const it of out) {
    if (it.kind !== 'decl' || it.names) continue;
    const r = bindingNames(`${codeLines[it.line - 1].slice(it.keyword)}\n${codeLines.slice(it.line, it.to).join('\n')}`);
    it.names = r.names.length ? r.names : ['(unnamed)'];
    it.unread = r.unread;
  }
  // a declaration after another statement on the same line (let p = 1; let q = 2;) starts no item,
  // so its names would be read by no one: its item is unread, and the caller refuses it
  // and so does a top-level declaration not at column 0: indented, after a comment, or after a comment
  // or template that ends mid-line. One rule: wherever a line's code starts (column 0, or where what it
  // starts inside ends), that code at depth 0 begins no declaration, except a declaration item's own line
  for (const it of out) for (let i = it.from; i <= it.to; i++) {
    const st = info[i - 1];
    const at = !st ? null : !st.inside ? { col: 0, depth: st.depth } : st.resume;
    if (!at) continue;
    const c = codeLines[i - 1].slice(at.col);
    const own = it.kind === 'decl' && i === it.line;
    if (secondDecl(c, at.depth) || (!own && at.depth === 0 && NEXT_DECL.test(c))) it.unread = true;
  }
  for (const s of statements) s.item = out.findLast((x) => x.from <= s.line) ?? null;
  return { items: out, statements, lines, code, codeLines, info };
}
