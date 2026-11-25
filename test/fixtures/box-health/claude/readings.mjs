// accounts.json records as accounts-tick writes them (capacity.list, kit-839's rows), in a project root
// of a scratch folder, for the hub's claude part (kit-840). Every name and number is made up.
import fs from 'node:fs';
import path from 'node:path';

export const T0 = Date.parse('2026-11-25T12:00:00.000Z');
export const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export const iso = (ms) => new Date(ms).toISOString();

// a project root with a run folder
export function projectRoot(dir) {
  fs.mkdirSync(path.join(dir, 'docs', 'devteam', 'run'), { recursive: true });
  return dir;
}
export const accountsFile = (root) => path.join(root, 'docs', 'devteam', 'run', 'accounts.json');
// one capacity.list row
export const row = (n, o = {}) => ({ n, label: `Account ${n}`, active: false, disabled: false, status: 'ok', five_pct: 0, models_full: [], ...o });
// the record accounts-tick writes, stamped at (ms); list undefined is an older kit's record, with none
export function record(at, list, more = {}) {
  const capacity = { accounts: list?.length ?? 0, room: 0, unknown: 0, gap: false };
  if (list) capacity.list = list;
  return { at: iso(at), cswap: true, active: 1, capacity, ...more };
}
export function write(root, at, list, more) {
  fs.writeFileSync(accountsFile(root), JSON.stringify(record(at, list, more)));
}
// cswap's reset times move by a fraction of a second at each fetch: these cross a minute and an hour
export const JITTER = ['2026-11-28T09:59:59.800Z', '2026-11-28T10:00:00.300Z', '2026-11-28T09:59:59.950Z', '2026-11-28T10:00:00.050Z'];
export const JITTER_MINUTE = ['2026-11-28T10:00:59.900Z', '2026-11-28T10:01:00.200Z'];
// the projection's cases: { now, rate, list }, read from the JSON beside this file
export const projectionCase = (name) => JSON.parse(fs.readFileSync(new URL(`./${name}.json`, import.meta.url), 'utf8'));
