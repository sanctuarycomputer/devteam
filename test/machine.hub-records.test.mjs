// The records a project leaves for the machine's hub: never from a scratch kit or a session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { until, write } from './lib/kit.mjs';
import { baseEnv, dtIn, home, machine, repo, tmp } from './lib/machine-fixture.mjs';

// A kit run that isn't a project's own never records itself for the machine (a
// probe dashboard in a session's scratchpad showed on the owner's Overview). These run as the box
// does, with no DEVTEAM_HUB_PORT, so the record is ~/.devteam/repos-4320, under a HOME of their own;
// and with a TMPDIR of their own, beside that HOME and never holding it, so the HOME's code folder
// is a real project's place and that TMPDIR is the temp folder.
const realHome = () => fs.mkdtempSync(path.join(tmp, 'hubrec-home-'));
const boxEnv = (h, more = {}) => ({ HOME: h, TMPDIR: fs.mkdtempSync(path.join(tmp, 'hubrec-tmpdir-')), DEVTEAM_HUB_PORT: undefined, DEVTEAM_CSWAP: 'off', DEVTEAM_ROLE: '', ...more });
const recordsIn = (h, port = 4320) => { const d = path.join(h, '.devteam', `repos-${port}`); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) })) : []; };
const clearRecords = (h, port = 4320) => fs.rmSync(path.join(h, '.devteam', `repos-${port}`), { recursive: true, force: true });

// accounts-tick is how a dashboard's minute tick records its project (noteSupervisorFromTick). It
// refuses a worker's, planner's or ticket's env outright (the supervisor's command), so no case
// here runs one: registerOnMachine's own check of a session's env is a guard for later callers, and
// a session reaches it through its dashboard, which the next test covers.
test('a scratch or session-run kit never registers with the machine\'s hub; a real project root still does', () => {
  const h = realHome();
  const env = boxEnv(h);
  const tick = (r, more = {}) => { const x = dtIn(r, ['accounts-tick'], { ...env, ...more }); assert.equal(x.status, 0, x.stdout + x.stderr); };
  const inTemp = repo('hubrec-temp', { dir: env.TMPDIR });
  tick(inTemp);
  assert.deepEqual(recordsIn(h), [], 'a root under the temp folder records nothing');
  const inScratch = repo('probe', { dir: path.join(tmp, 'session', 'scratchpad') });
  tick(inScratch);
  assert.deepEqual(recordsIn(h), [], 'a root in a scratchpad records nothing');
  const real = repo('hubrec-real', { dir: path.join(h, 'code') });
  tick(real, { DEVTEAM_HUB_RECORD: 'off' });
  assert.deepEqual(recordsIn(h), [], 'DEVTEAM_HUB_RECORD=off records nothing, even a real root');
  tick(real);
  assert.deepEqual(recordsIn(h).map((x) => x.root), [fs.realpathSync(real)], 'a real project under the home code folder records itself, as before');
  // a TMPDIR that holds the home folder is no temp folder: every project would be a stray
  clearRecords(h);
  tick(real, { TMPDIR: tmp });
  assert.deepEqual(recordsIn(h).map((x) => x.root), [fs.realpathSync(real)], 'a TMPDIR above home doesn\'t make home temp');
  // under is by whole segments: <tmpdir>x is not under <tmpdir>
  clearRecords(h);
  const beside = repo('hubrec-beside', { dir: `${env.TMPDIR}x` });
  tick(beside);
  assert.deepEqual(recordsIn(h).map((x) => x.root), [fs.realpathSync(beside)], 'a folder whose name only starts with the temp folder\'s is not under it');
});

// A dashboard started in a session (a worker's or a planner's env, inherited by whatever it runs)
// tells its tick not to record, whatever the port; the supervisor's own dashboard still records.
test('a session\'s dashboard doesn\'t record its project; a plain one and the supervisor\'s do', { timeout: 300000 }, async () => {
  const port = Number(process.env.DEVTEAM_HUB_PORT);
  const dashboard = async (r, env) => {
    const accounts = path.join(r, 'docs/devteam/run/accounts.json');
    fs.rmSync(accounts, { force: true });
    const d = spawn(process.execPath, [path.join(r, 'docs/devteam/scripts/devteam.mjs'), 'dashboard'], { cwd: r, env: { ...baseEnv, DEVTEAM_ACCOUNTS_MS: '200', DEVTEAM_CSWAP: 'off', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let said = '';
    d.stdout.on('data', (c) => { said += c; });
    d.stderr.on('data', (c) => { said += c; });
    const exited = new Promise((res) => d.once('exit', res));
    const at = () => { try { return JSON.parse(fs.readFileSync(accounts, 'utf8')).at; } catch { return null; } };
    try {
      // a tick's child writes accounts.json after it records, so one file means one record; two
      // ticks, so the record isn't only a slow first tick's
      const first = await until(() => at() ?? (d.exitCode !== null ? assert.fail(`the dashboard exited: ${said}`) : null), 'the dashboard\'s first accounts tick');
      await until(() => at() !== first, 'its next tick');
    } finally {
      d.kill();
      await exited;
      // a tick child started just before the stop finishes on its own: wait until none runs
      const tick = `${path.join(r, 'docs/devteam/scripts/devteam.mjs')} accounts-tick`;
      await until(() => !spawnSync('ps', ['-A', '-ww', '-o', 'args='], { encoding: 'utf8' }).stdout.split('\n').some((l) => l.includes(tick)), 'its last tick child to finish');
    }
  };
  const onPort = { DEVTEAM_IMAGE_HUB: String(port) }; // leaves the hub to "the image": nothing binds the hub port
  const mine = (h, r, p) => recordsIn(h, p).filter((x) => x.root === fs.realpathSync(r));
  const w = repo('hubrec-dash-worker');
  const pl = repo('hubrec-dash-planner');
  const plain = repo('hubrec-dash-plain');
  try {
    await dashboard(w, { ...onPort, DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-1' });
    assert.deepEqual(mine(home, w, port), [], 'a worker\'s dashboard records nothing');
    await dashboard(pl, { ...onPort, DEVTEAM_ROLE: 'planner', DEVTEAM_FEATURE: 'x' });
    assert.deepEqual(mine(home, pl, port), [], 'a planner\'s dashboard records nothing');
    // each mark of a session alone is enough
    for (const [what, only] of [['a ticket alone', { DEVTEAM_TICKET: 'x-1' }], ['a feature alone', { DEVTEAM_FEATURE: 'x' }], ['a worker\'s role alone', { DEVTEAM_ROLE: 'worker' }], ['a planner\'s role alone', { DEVTEAM_ROLE: 'planner' }]]) {
      await dashboard(w, { ...onPort, ...only });
      assert.deepEqual(mine(home, w, port), [], `${what}: its dashboard records nothing`);
    }
    await dashboard(plain, onPort);
    assert.equal(mine(home, plain, port).length, 1, 'a dashboard with no session records its project');
  } finally {
    for (const x of recordsIn(home, port)) if ([w, pl, plain].map((r) => fs.realpathSync(r)).includes(x.root)) fs.rmSync(path.join(home, '.devteam', `repos-${port}`, x.file));
  }
  // The supervisor's own, as on a box: the default port, so ~/.devteam/repos-4320 under a HOME of
  // its own. DEVTEAM_IMAGE_HUB=4320 leaves the hub to the image, so nothing binds 4320, and the
  // dashboard's own port stays in this file's block (DEVTEAM_PORT_BASE). DEVTEAM_CSWAP=off is set
  // here, not only by the harness: at 4320 nothing else keeps the machine's own cswap out.
  const h2 = realHome();
  const env2 = boxEnv(h2, { DEVTEAM_IMAGE_HUB: '4320', DEVTEAM_CSWAP: 'off' });
  const sup = repo('hubrec-dash-sup', { dir: path.join(h2, 'code') });
  await dashboard(sup, { ...env2, DEVTEAM_ROLE: 'supervisor' });
  assert.deepEqual(recordsIn(h2).map((x) => x.root), [fs.realpathSync(sup)], 'the supervisor\'s dashboard records its real project');
  const rec = machine(['recover', '--machine', '--dry-run'], env2);
  assert.equal(rec.status, 0, rec.stdout + rec.stderr);
  assert.match(rec.stdout, /^hubrec-dash-sup\b/m, 'recover --machine finds it');
});

test('stray hub records under a temp or scratchpad root are ignored, and status names each once', () => {
  const h = realHome();
  const env = boxEnv(h);
  const dir = path.join(h, '.devteam', 'repos-4320');
  const strayTemp = repo('hubrec-stray-temp', { dir: env.TMPDIR });
  const strayPad = repo('hubrec-stray-pad', { dir: path.join(tmp, 'other-session', 'scratchpad') });
  const real = repo('hubrec-kept', { dir: path.join(h, 'code') });
  const at = new Date().toISOString();
  write(path.join(dir, 'aaaa000000000001.json'), JSON.stringify({ root: strayTemp, at }));
  write(path.join(dir, 'aaaa000000000002.json'), JSON.stringify({ root: strayPad, at }));
  write(path.join(dir, 'aaaa000000000003.json'), JSON.stringify({ root: real, at }));
  const rec = machine(['recover', '--machine', '--dry-run'], env);
  assert.equal(rec.status, 0, rec.stdout + rec.stderr);
  assert.match(rec.stdout, /^hubrec-kept\b/m);
  assert.doesNotMatch(rec.stdout, /hubrec-stray/, 'recover never sees a stray');
  const empty = fs.mkdtempSync(path.join(tmp, 'no-repos-'));
  const st = machine(['machine', 'status', '--in', empty], env);
  const said = st.stdout.split('\n');
  for (const f of ['aaaa000000000001.json', 'aaaa000000000002.json']) assert.equal(said.filter((l) => l.startsWith(`machine: stray hub record ${f} (`)).length, 1, `${f} named once\n${st.stdout}`);
  assert.match(st.stdout, /^machine: stray hub record aaaa000000000001\.json \(under the temp folder; ignored, remove it\)$/m);
  assert.match(st.stdout, /^machine: stray hub record aaaa000000000002\.json \(in a scratchpad; ignored, remove it\)$/m);
  assert.ok(!said.some((l) => l.includes('aaaa000000000003')), 'the real record is no stray');
  assert.match(st.stdout, /^hubrec-kept /m, 'the real project still listed');
  assert.ok(!said.some((l) => /^hubrec-stray/.test(l)), 'no stray listed as a project');
  assert.equal(fs.readdirSync(dir).length, 3, 'status removes nothing');
});
