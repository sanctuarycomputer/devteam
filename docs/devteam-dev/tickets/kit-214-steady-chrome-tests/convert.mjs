// node convert.mjs <file…>: moves each top-level test's teardown onto cleanup(t) (test/lib/chrome.mjs).
// A test with two or more `t.after(` steps, or a hand-made `undo` stack, gets `const later = cleanup(t);`
// where its first step was, and every step becomes `later(`, in the same order (the helper runs them
// last first). A test with one step is left as it is. Prints every test it changed; refuses (exit 1)
// on a shape it doesn't know, which is then done by hand.
import fs from 'node:fs';

const UNDO_DECL = /^(\s*)const undo = \[\];\s*$/;
const UNDO_RUN = /^\s*t\.after\(async \(\) => \{ let err = null; for \(const f of undo\.reverse\(\)\) \{ try \{ await f\(\); \} catch \(e\) \{ err \?\?= e; \} \} if \(err\) throw err; \}\);\s*$/;
let bad = 0;
for (const file of process.argv.slice(2)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let changed = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^test\(/.test(lines[i])) { out.push(lines[i]); continue; }
    let j = i;
    while (j < lines.length && !/^\}\);\s*$/.test(lines[j])) j++;
    const body = lines.slice(i, j + 1);
    const name = (lines[i].match(/^test\((['"`])(.*?)\1/) || [])[2] ?? lines[i].slice(0, 80);
    const param = (lines[i].match(/async \((\w+)\) => \{\s*$/) || lines[i].match(/\((\w+)\) => \{\s*$/) || [])[1];
    const steps = body.map((l, k) => [l, k]).filter(([l]) => /\bt\.after\(/.test(l) && !UNDO_RUN.test(l));
    const undo = body.findIndex((l) => UNDO_DECL.test(l));
    const others = body.filter((l) => /\b(\w+)\.after\(/.test(l) && !/\bt\.after\(/.test(l));
    if (others.length) { console.error(`refused: ${file}: ${name}: an after hook on another context: ${others[0].trim()}`); bad = 1; out.push(...body); i = j; continue; }
    if (undo < 0 && steps.length < 2) { out.push(...body); i = j; continue; }
    if (param !== 't') { console.error(`refused: ${file}: ${name}: its context isn't named t`); bad = 1; out.push(...body); i = j; continue; }
    if (undo >= 0) {
      if (steps.length) { console.error(`refused: ${file}: ${name}: an undo stack and bare t.after steps`); bad = 1; out.push(...body); i = j; continue; }
      if (!body.some((l) => UNDO_RUN.test(l))) { console.error(`refused: ${file}: ${name}: an undo stack without the usual runner`); bad = 1; out.push(...body); i = j; continue; }
      const ind = body[undo].match(UNDO_DECL)[1];
      out.push(...body.flatMap((l, k) => (k === undo ? [`${ind}const later = cleanup(t);`] : UNDO_RUN.test(l) ? [] : [l.replace(/\bundo\.push\(/g, 'later(')])));
      if (body.some((l) => /\bundo\b/.test(l) && !UNDO_DECL.test(l) && !UNDO_RUN.test(l) && !/\bundo\.push\(/.test(l))) { console.error(`refused: ${file}: ${name}: undo used another way`); bad = 1; }
    } else {
      const [first, at] = steps[0];
      const ind = first.match(/^(\s*)/)[1];
      if (ind !== '  ' || steps.some(([l]) => !/^\s*(\w|\/\/)/.test(l))) { console.error(`refused: ${file}: ${name}: its first step isn't at the function's top level`); bad = 1; out.push(...body); i = j; continue; }
      out.push(...body.flatMap((l, k) => [...(k === at ? [`${ind}const later = cleanup(t);`] : []), l.replace(/\bt\.after\(/g, 'later(')]));
    }
    changed++;
    console.log(`changed: ${file}: ${name}`);
    i = j;
  }
  if (changed) fs.writeFileSync(file, out.join('\n'));
}
process.exit(bad);
