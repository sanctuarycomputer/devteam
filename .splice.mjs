import fs from 'node:fs';
const f = 'docs/devteam/dashboard/index.html';
let s = fs.readFileSync(f, 'utf8');
const put = (name, file) => {
  const re = new RegExp(`(/\\* ${name} start \\*/\\n)[\\s\\S]*?(/\\* ${name} end \\*/)`);
  if (!re.test(s)) throw new Error(name);
  const body = fs.readFileSync(file, 'utf8').replace(/\n?$/, '\n');
  s = s.replace(re, (m, a, b) => a + body + b);
};
put('term-js', '.term-js.txt');
put('term-css', '.term-css.txt');
fs.writeFileSync(f, s);
