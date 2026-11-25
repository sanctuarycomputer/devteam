// node write-cases.mjs: writes the projection's JSON cases beside it (run once by hand; the JSON is
// what the test reads). now is T0, 2026-11-25T12:00:00Z; rate is in points of an account-week an hour.
import fs from 'node:fs';
import { T0, HOUR, DAY, iso, row } from './readings.mjs';

const at = (ms) => iso(T0 + ms);
const cases = {
  // the active one to 90, then the most room, the last tenth of each only once none is under 90
  'best-order': { rate: 4, list: [row(1, { active: true, week_pct: 85, week_resets_at: at(3 * DAY) }), row(2, { week_pct: 40, week_resets_at: at(3 * DAY) }), row(3, { week_pct: 60, week_resets_at: at(3 * DAY) })] },
  // account 2 has the most room but a full per-model window until +2 h
  'model-full': { rate: 4, list: [row(1, { active: true, week_pct: 89, week_resets_at: at(3 * DAY) }), row(2, { week_pct: 10, week_resets_at: at(3 * DAY), models_full: [{ resets_at: at(2 * HOUR) }] }), row(3, { week_pct: 50, week_resets_at: at(3 * DAY) })] },
  // account 2 has the most room but its five-hour window is full until +3 h
  'five-full': { rate: 4, list: [row(1, { active: true, week_pct: 89, week_resets_at: at(3 * DAY) }), row(2, { week_pct: 10, week_resets_at: at(3 * DAY), five_pct: 100, five_resets_at: at(3 * HOUR) }), row(3, { week_pct: 50, week_resets_at: at(3 * DAY) })] },
  // every account full now; account 1 resets at +2 h
  reset: { rate: 10, list: [row(1, { active: true, week_pct: 100, week_resets_at: at(2 * HOUR) }), row(2, { week_pct: 100, week_resets_at: at(DAY) }), row(3, { week_pct: 100, week_resets_at: at(3 * DAY) })] },
  // room runs out at +12 h 30 m, and comes back at the resets, +2 days
  stall: { rate: 2, list: [row(1, { active: true, week_pct: 80, week_resets_at: at(2 * DAY) }), row(2, { week_pct: 95, week_resets_at: at(2 * DAY) })] },
  // 2 can't be read (an expired token), 3 has no weekly figure
  unreadable: { rate: 4, list: [row(1, { active: true, week_pct: 50, week_resets_at: at(3 * DAY) }), row(2, { status: 'token_expired', five_pct: undefined }), row(3, { five_pct: undefined, week_resets_at: at(3 * DAY) })] },
  // a 20x and a 5x account: weighed 1.6 and 0.4, the room runs out at +30 h; weighed equally it lasts
  tiers: { rate: 4, list: [row(1, { active: true, week_pct: 50, week_resets_at: at(35 * HOUR), tier: 20 }), row(2, { week_pct: 0, week_resets_at: at(35 * HOUR), tier: 5 })] },
  // seven days of steps, with resets at +1 d and +3 d along the way
  long: { rate: 3, list: [row(1, { active: true, week_pct: 50, week_resets_at: at(DAY) }), row(2, { week_pct: 60, week_resets_at: at(3 * DAY) }), row(3, { week_pct: 70, week_resets_at: at(7 * DAY - HOUR) })] },
};
for (const [name, c] of Object.entries(cases)) fs.writeFileSync(new URL(`./${name}.json`, import.meta.url), `${JSON.stringify({ now: iso(T0), ...c }, null, 1)}\n`);
