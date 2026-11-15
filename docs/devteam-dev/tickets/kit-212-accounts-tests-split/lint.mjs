// kit-211 (copied for kit-212): eslint's no-undef and no-unused-vars over source text, for split.mjs's imports and as a
// check of the split files. ESLINT names an eslint 9 package folder (the kit has no dependencies;
// any checkout of eslint 9 works).
//   node lint.mjs <file>…      prints each problem; exits 1 on any
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Linter } = require(process.env.ESLINT ?? '/data/home/code/website/cms/node_modules/eslint');
const GLOBALS = Object.fromEntries('process console Buffer setTimeout setInterval setImmediate clearTimeout clearInterval clearImmediate URL URLSearchParams fetch WebSocket Atomics SharedArrayBuffer AbortController AbortSignal TextEncoder TextDecoder structuredClone queueMicrotask globalThis performance Response Request Headers Blob FormData'.split(' ').map((g) => [g, 'readonly']));
export function lint(text, { unused = true } = {}) {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(text, [{ languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: GLOBALS }, rules: { 'no-undef': 'error', ...(unused ? { 'no-unused-vars': ['error', { vars: 'all', args: 'none', caughtErrors: 'none' }] } : {}) } }]);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  let bad = 0;
  for (const f of process.argv.slice(2)) for (const m of lint(fs.readFileSync(f, 'utf8'))) { bad++; console.log(`${f}:${m.line}:${m.column} ${m.ruleId}: ${m.message}`); }
  process.exit(bad ? 1 : 0);
}
