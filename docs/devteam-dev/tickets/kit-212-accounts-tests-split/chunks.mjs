// kit-211 (copied for kit-212): a test file as top-level chunks: its imports, each test (with the comment lines right
// above it), and the code between tests. Used by split.mjs; run alone it lists them.
import fs from 'node:fs';

export function chunks(src) {
  const lines = src.split('\n');
  const out = [];
  let cur = null;
  const push = () => { if (cur && cur.lines.length) out.push(cur); cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^test\(/.test(l)) {
      // take the comment lines right above it into the test's chunk
      const pre = [];
      while (cur && cur.kind === 'code' && cur.lines.length && /^\/\//.test(cur.lines.at(-1))) pre.unshift(cur.lines.pop());
      push();
      const name = /^test\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/.exec(l);
      cur = { kind: 'test', name: name ? Function(`return ${name[1]}`)() : null, start: i + 1, lines: [...pre, l] };
      // a one-line test ends here; else at the next line that closes it at column 0
      if (/\);\s*$/.test(l) && /^test\(.*\}\);\s*$/.test(l)) { push(); continue; }
      while (++i < lines.length) { cur.lines.push(lines[i]); if (/^\}\)?;?\s*$|^\}, \{.*\);?\s*$|^\}\);\s*$/.test(lines[i]) && /^\}/.test(lines[i])) break; }
      push();
      continue;
    }
    if (!cur) cur = { kind: /^import /.test(l) ? 'import' : 'code', start: i + 1, lines: [] };
    else if (cur.kind === 'import' && !/^import /.test(l) && !/^\s/.test(l)) { push(); cur = { kind: 'code', start: i + 1, lines: [] }; }
    cur.lines.push(l);
  }
  push();
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cs = chunks(fs.readFileSync(process.argv[2], 'utf8'));
  cs.forEach((c, i) => console.log(`${String(i).padStart(3)} ${c.kind.padEnd(6)} L${c.start}+${c.lines.length} ${c.kind === 'test' ? c.name.slice(0, 80) : c.lines.find((x) => x.trim() && !x.startsWith('//'))?.slice(0, 90) ?? ''}`));
}
