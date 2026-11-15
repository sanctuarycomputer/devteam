// kit-211 done-when 6: each pane-question / operator-threads test with after hooks, run alone under
// probe.mjs with its folder removal made to throw, at the base (the file before the split) and at the
// head (its part). Each run has its own TMPDIR, and DEVTEAM_* unset. After each run, every process the
// probe reported left is killed with its process group, the run's TMPDIR is searched again, and a
// second look must find nothing (else the run says so and this exits 1).
//   node probe-run.mjs <base-sha> <out-dir>     (from the repo root, with Node 22 or later)
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [base, outDir] = process.argv.slice(2);
if (!base || !outDir) { console.error('usage: node probe-run.mjs <base-sha> <out-dir>'); process.exit(2); }
const here = path.dirname(new URL(import.meta.url).pathname);
const PROBE = path.join(here, 'probe.mjs');
const THROW = 'devteam-(pane-[a-z]+|image-kit)-';
fs.mkdirSync(outDir, { recursive: true });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// [file, part, test name, expect leftovers at the base]
const CASES = [
  ['pane-question', 'held', 'a message for a pane that is asking is held', false],
  ['pane-question', 'held', 'held lines are typed once each', false],
  ['pane-question', 'held', 'a claim nobody is working goes back as it was', true],
  ['pane-question', 'held', 'held lines wait for the input box', false],
  ['pane-question', 'answer', 'the dashboard: an answer only from its own page', true],
  ['pane-question', 'answer', 'a menu whose digit only moves the cursor', true],
  ['pane-question', 'answer', 'one click is one answer', true],
  ['pane-question', 'answer', 'a question that goes as the key is sent', true],
  ['pane-question', 'answer', 'on a box an answer needs the gateway', true],
  ['pane-question', 'answer', 'the dashboard page:', true],
  ['operator-threads', 'hub', "the hub takes the owner's turns", false],
  ['operator-threads', 'hub', 'on a box the hub takes a press only', false],
  ['operator-threads', 'hub', 'the Overview in Chrome', false],
  ['operator-threads', 'hub', 'on a box the standalone hub', true],
];
const env0 = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DEVTEAM_|TMUX)/.test(k)));
// never this runner's own process group: a child a test started without detached shares it (plan review I4)
const ownGroup = Number(fs.readFileSync('/proc/self/stat', 'utf8').split(') ')[1].split(' ')[2]);
const killAll = (left) => { for (const p of left) { if (p.pgid && p.pgid !== ownGroup) { try { process.kill(-p.pgid, 'SIGKILL'); } catch {} } try { process.kill(p.pid, 'SIGKILL'); } catch {} } };
const look = (dirs) => { // a second look, by the run's own dirs
  const hits = [];
  for (const p of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(p)) continue;
    let a = '', e = '';
    try { a = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); e = fs.readFileSync(`/proc/${p}/environ`, 'utf8'); } catch { continue; }
    if (dirs.some((d) => a.includes(d) || e.includes(d))) hits.push(Number(p));
  }
  return hits;
};
let bad = false;
const rows = [];
const bases = new Map();
// the base copies never outlive the run, on an error or a signal (plan reviews M7, n2)
const dropBases = () => { for (const b of bases.values()) fs.rmSync(b, { force: true }); };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { dropBases(); process.exit(130); });
try {
for (const [name, part, title, expectBase] of CASES) {
  if (!bases.has(name)) { const b = `test/zz-probe-base-${name}.test.mjs`; fs.writeFileSync(b, execFileSync('git', ['show', `${base}:test/${name}.test.mjs`])); bases.set(name, b); }
  const row = { test: title, expectBase };
  for (const [side, file] of [['base', bases.get(name)], ['head', `test/${name}.${part}.test.mjs`]]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit211-probe-'));
    const out = path.join(outDir, `${name}-${CASES.findIndex((c) => c[2] === title)}-${side}.jsonl`);
    fs.writeFileSync(out, '');
    const r = spawnSync(process.execPath, ['--import', PROBE, '--test-name-pattern', `^${esc(title)}`, file], { env: { ...env0, TMPDIR: tmp, PROBE_THROW: THROW, PROBE_OUT: out }, encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL' });
    fs.writeFileSync(out.replace(/\.jsonl$/, '.log'), `${r.stdout}\n${r.stderr}`);
    const lines = fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const sum = lines.at(-1) ?? { left: null, note: 'no exit line (timed out)' };
    const left = lines.slice(0, -1);
    // the one test's own result line (the summary may never come from a process that hangs)
    const ran = /^(not )?ok 1 - /m.test(r.stdout) || /^[✔✖] /m.test(r.stdout);
    killAll(left);
    spawnSync('sleep', ['1']);
    const again = look([...(sum.dirs ?? []), tmp]);
    if (again.length) { for (const p of again) { try { process.kill(p, 'SIGKILL'); } catch {} } bad = true; }
    row[side] = `${ran ? '' : 'NOT RUN '}children ${sum.children ?? '?'} (pool ${sum.pool ?? '?'}) left ${sum.left ?? '?'}${left.length ? ` (${left.map((x) => x.args.split(' ').slice(0, 2).map((s) => path.basename(s)).join(' ')).join('; ')})` : ''}${again.length ? ` STILL ${again.length} after the kill` : ''}`;
    if (!ran) bad = true;
    if (side === 'head' && sum.left !== 0) bad = true;
    if (side === 'base' && expectBase && !sum.left) bad = true;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
  rows.push(row);
  console.log(`| ${row.test} | ${row.expectBase ? 'yes' : 'no'} | ${row.base} | ${row.head} |`);
}
} finally {
  dropBases();
}
process.exit(bad ? 1 : 0);
