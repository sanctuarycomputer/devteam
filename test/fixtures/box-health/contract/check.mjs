// The two checks, cut from a devteam.mjs's source and run alone (the box-memory region holds the
// small helpers they share): nothing else of devteam.mjs is in scope, so a check that reaches
// outside the two throws.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCRIPT = fileURLToPath(new URL('../../../../docs/devteam/scripts/devteam.mjs', import.meta.url));
export function regionOf(name, src = fs.readFileSync(SCRIPT, 'utf8')) {
  const from = src.indexOf(`/* ${name} start */`), to = src.indexOf(`/* ${name} end */`);
  if (from < 0 || to < from) throw new Error(`/* ${name} start */ … /* ${name} end */ marks no region`);
  return src.slice(from, to);
}
export function checks(src = fs.readFileSync(SCRIPT, 'utf8')) {
  return new Function(`'use strict';\n${regionOf('box-memory', src)}\n${regionOf('box-health-contract', src)}\nreturn { boxHealthProblem, poolProblem, memoryAtOk };`)();
}
