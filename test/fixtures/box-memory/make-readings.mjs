// Makes readings.jsonl: one day (2026-11-17, UTC) of machine-memory@1 readings, a minute apart, with a
// restart gap 03:10 to 03:50, a quiet night, a busy afternoon whose working set crosses 80% of max, two
// projects, all six kinds and seven devteam subcommands. Deterministic (fixed-seed mulberry32, built-ins
// only): change the shape here and run `node test/fixtures/box-memory/make-readings.mjs` to remake the file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAX = 51539607552;
const DAY = Date.UTC(2026, 10, 17);
const GAP_FROM = 3 * 60 + 10, GAP_TO = 3 * 60 + 50; // minutes of the day: no lines from 03:10 up to 03:50
const SUBS = ['dashboard', 'dashboard-data', 'hello', 'accounts-tick', 'wait', 'gate', 'metrics'];
const KIND_SHARE = { agent: 0.6, browser: 0.07, install: 0.01, devteam: 0.15, node: 0.1, other: 0.07 };
const KIND_PER_SESSION = { agent: 1.2, browser: 0.5, install: 0.06, devteam: 1.4, node: 0.25, other: 5 };

const mulberry32 = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Sessions by minute of the day: night 1-4, a morning ramp, an afternoon plateau of 30-33 (the peak), an evening down.
const sessionsAt = (min, rnd) => {
  const h = min / 60;
  let base;
  if (h < 6) base = 2.5 + 1.2 * Math.sin(h * 1.7);
  else if (h < 12) base = 5 + ((h - 6) / 6) * 15;
  else if (h < 13) base = 20 + (h - 12) * 8;
  else if (h < 17) base = 28 + 4 * Math.sin(((h - 13) / 4) * Math.PI) ;
  else if (h < 18) base = 28 - (h - 17) * 8;
  else if (h < 22) base = 20 - ((h - 18) / 4) * 14;
  else base = 5 - (h - 22) * 1.5;
  const noise = h < 6 ? (rnd() - 0.5) * 1.4 : (rnd() - 0.5) * 3;
  let s = Math.round(base + noise);
  if (h < 6) s = Math.min(4, Math.max(1, s));
  else if (h >= 12 && h < 18) s = Math.min(33, Math.max(20, s));
  else s = Math.max(2, s);
  if (h >= 13.5 && h < 16.5 && s < 31) s = 31 + Math.floor(rnd() * 3); // the stretch that crosses the ceiling
  return s;
};

export function makeReadings() {
  const rnd = mulberry32(590);
  const out = [];
  let n = 0;
  for (let min = 0; min < 1440; min++) {
    if (min >= GAP_FROM && min < GAP_TO) continue;
    const sessions = sessionsAt(min, rnd);
    const ws = Math.round(6e9 + sessions * 1.15e9 + (rnd() - 0.5) * 0.8e9);
    const kinds = {};
    for (const [k, share] of Object.entries(KIND_SHARE)) {
      kinds[k] = { n: Math.max(1, Math.round(sessions * KIND_PER_SESSION[k] + rnd() * 2)), rss: Math.max(1, Math.round(ws * share * (0.95 + rnd() * 0.1))) };
    }
    // The devteam split divides the devteam kind: the subcommands' n and rss sum to at most kinds.devteam's.
    kinds.devteam.n = Math.max(kinds.devteam.n, 8);
    const picks = ['dashboard', 'wait', 'hello'];
    if (rnd() < 0.5) picks.push('gate');
    if (rnd() < 0.3) picks.push('metrics');
    if (rnd() < 0.2) picks.push('accounts-tick');
    if (rnd() < 0.4) picks.push('dashboard-data');
    if (min === 600) picks.push(...SUBS); // a minute with all seven, whatever the dice said
    const subs = [...new Set(picks)];
    const weights = subs.map(() => 0.5 + rnd());
    const wsum = weights.reduce((x, y) => x + y, 0);
    let spare = Math.floor((kinds.devteam.n - subs.length) / 2);
    const devteam = {};
    subs.forEach((sub, i) => {
      const extra = Math.floor(rnd() * (spare + 1));
      spare -= extra;
      devteam[sub] = { n: 1 + extra, rss: Math.max(1, Math.floor(kinds.devteam.rss * 0.9 * weights[i] / wsum)) };
    });
    // Sessions split between the projects, never summing above the line's; one session goes to one project.
    const mine = sessions >= 2 ? Math.min(sessions - 1, Math.max(1, Math.round(sessions * (0.35 + rnd() * 0.1)))) : (rnd() < 0.5 ? 1 : 0);
    const kindsRss = Object.values(kinds).reduce((x, k) => x + k.rss, 0);
    const dev = Math.round(kindsRss * 0.2), mship = Math.round(kindsRss * 0.28);
    // Each project's share of a subcommand is a part of the machine-wide figure: 0-40% each, so both sum to at most 80%.
    const part = () => { const o = {}; for (const sub of subs) if (rnd() < 0.8) o[sub] = Math.floor(devteam[sub].rss * rnd() * 0.4); return o; };
    const projects = {
      'devteam-dev': { rss: dev, sessions: mine, devteam: part() },
      mothership: { rss: mship, sessions: sessions - mine, devteam: part() },
    };
    const line = { v: 1, at: new Date(DAY + min * 60000).toISOString().replace('.000Z', 'Z'), working_set: ws, max: MAX, ceiling: 0.8, source: 'cgroup', sessions, kinds, devteam, projects };
    if (n % 311 === 150) line.partial = true;
    out.push(JSON.stringify(line));
    n++;
  }
  return `${out.join('\n')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'readings.jsonl'), makeReadings());
}
