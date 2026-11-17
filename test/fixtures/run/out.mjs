// The run fixtures' one helper: put(name, obj) writes JSON into DTR_FIXTURE_OUT, whole (a temp
// name, then a rename), so the test never reads half a file.
import fs from 'node:fs';
import path from 'node:path';

export const outDir = process.env.DTR_FIXTURE_OUT;
export function put(name, obj) {
  const f = path.join(outDir, name);
  fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(obj));
  fs.renameSync(`${f}.${process.pid}.tmp`, f);
}
