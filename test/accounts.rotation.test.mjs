// Account rotation: the tick, cswap auto, the claim between ticks, the dashboard's share, and what the accounts say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { autos, claimFile, findings, fixture, FULL, MINUTE, ROOM } from './lib/accounts-fixture.mjs';
import { json, PORTS, startDashboard, until, write } from './lib/kit.mjs';

const row = (usage, more = {}) => ({ number: 1, email: 'a@x', usageStatus: 'ok', usage, ...more });

test('accounts-tick: off, or no cswap, touches nothing; a tick under tmux leaves the supervisor pane alone', () => {
  const F = fixture('off');
  try {
    const r = F.run(['accounts-tick', '--rotate'], { DEVTEAM_CSWAP: 'off', TMUX: 'x', TMUX_PANE: '%99' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(F.called(), [], 'off calls nothing');
    assert.equal(F.state().cswap, false);
    assert.ok(!fs.existsSync(path.join(F.root, 'docs/devteam/run/supervisor-pane')), "the dashboard's pane isn't taken for the supervisor's");
    // unset, on a fixture's own hub port: the machine's real cswap is never found, even on PATH
    const bin = path.dirname(F.env().DEVTEAM_CSWAP);
    const e = F.env({ PATH: `${bin}${path.delimiter}${process.env.PATH}`, DEVTEAM_HUB_PORT: String(PORTS) });
    delete e.DEVTEAM_CSWAP;
    const un = spawnSync(process.execPath, [path.join(F.root, 'docs/devteam/scripts/devteam.mjs'), 'accounts-tick', '--rotate'], { cwd: F.root, encoding: 'utf8', env: e });
    assert.equal(un.status, 0, un.stderr);
    assert.deepEqual(F.called(), []);
    assert.match(F.run(['accounts-tick'], { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'x-01-a' }).stderr, /the supervisor does this/);
  } finally { F.done(); }
});

test('rotation: runs cswap auto --once with no strategy of its own, reads its events whatever the exit code, and raises findings', () => {
  const F = fixture('rotate');
  try {
    F.set(ROOM, `${JSON.stringify({ schemaVersion: 1, event: 'poll' })}\n${JSON.stringify({ schemaVersion: 1, event: 'switch', from: { number: 1, email: 'a@x' }, to: { number: 2, email: 'b@x' } })}\nnot json\n`, 0);
    assert.match(F.tick('--rotate'), /cswap switched account: a@x -> b@x/);
    assert.deepEqual(F.called().filter((c) => c.startsWith('auto')), ['auto --once --json']);
    F.set(FULL, `${JSON.stringify({ event: 'all-exhausted' })}\n`, 3);
    assert.equal(F.tick('--rotate'), '', 'exit 3 is not a failure');
    assert.equal(F.state().exhausted, true);
    assert.ok(findings(F).some((f) => f.kind === 'accounts-exhausted' && f.severity === 'high'));
    // a dead login, every tick (cswap reports a quarantine only once)
    F.set({ accounts: [...ROOM.accounts, { number: 2, email: 'b@x', usageStatus: 'relogin_required', usage: null }] });
    F.tick();
    assert.ok(findings(F).some((f) => f.kind === 'account-needs-login' && f.subject === 'b@x'));
    assert.ok(!findings(F).some((f) => f.kind === 'accounts-exhausted'));
    // old news isn't reported
    const file = path.join(F.root, 'docs/devteam/run/accounts.json');
    fs.writeFileSync(file, JSON.stringify({ ...F.state(), at: new Date(Date.now() - 3600000).toISOString(), exhausted: true }));
    assert.ok(!findings(F).some((f) => f.kind === 'accounts-exhausted'));
    write(path.join(F.base, 'auto.out'), 'garbage');
    write(path.join(F.base, 'auto.status'), '1');
    assert.match(F.tick('--rotate'), /cswap auto: exit 1/);
    write(path.join(F.base, 'auto.out'), `${JSON.stringify({ event: 'error', message: 'keychain locked' })}\n`);
    assert.match(F.tick('--rotate'), /cswap auto: exit 1: keychain locked/, 'an error event is still a failure');
  } finally { F.done(); }
});

test('what the accounts say: only known-full accounts are exhausted, and room means every window it has', () => {
  const F = fixture('rows');
  const exhausted = (accounts) => { F.set({ accounts }); F.tick(); return F.state().exhausted; };
  try {
    assert.equal(exhausted([row({ fiveHour: { pct: 100 }, sevenDay: { pct: 1 } })]), true);
    assert.equal(exhausted([row({ sevenDay: { pct: 100 } })]), true, 'an account with no 5-hour window');
    assert.equal(exhausted([row({ sevenDay: { pct: 50 } })]), false);
    assert.equal(exhausted([row({ fiveHour: { pct: null }, sevenDay: { pct: null } })]), false, 'unmeasured is not full');
    for (const usageStatus of ['unavailable', 'token_expired', 'api_key']) assert.equal(exhausted([row(null, { usageStatus })]), false, usageStatus);
    assert.equal(exhausted([row({ sevenDay: { pct: 50 }, scoped: [{ name: 'x', pct: 100 }] })]), false, 'one full model is not a full account');
    assert.equal(exhausted([row({ fiveHour: { pct: 100 } }), row({ fiveHour: { pct: 2 } }, { disabled: true })]), true, 'a disabled account is no way out');
  } finally { F.done(); }
});

test('capacity: the tick records how many accounts have room and whether that room lasts to the first reset', () => {
  const F = fixture('capacity');
  try {
    const OUT = '2026-11-16T05:00:00Z';
    const RESET = '2026-11-16T21:00:00Z';
    const full = { number: 2, email: 'b@x', usageStatus: 'ok', usage: { fiveHour: { pct: 10 }, sevenDay: { pct: 100, resetsAt: RESET } } };
    const left = (lasts) => ({ number: 1, email: 'a@x', active: true, usageStatus: 'ok', usage: { fiveHour: { pct: 31.4, willLastToReset: true }, sevenDay: { pct: 9, projectedExhaustionAt: OUT, willLastToReset: lasts } } });
    F.set({ schemaVersion: 1, accounts: [left(false), full] });
    F.tick();
    assert.deepEqual(F.state().capacity, { accounts: 2, room: 1, active_week_pct: 9, active_5h_pct: 31, runs_out_at: OUT, next_reset_at: RESET, gap: true });
    const gap = findings(F).find((f) => f.kind === 'accounts-capacity-gap');
    assert.ok(gap && gap.severity === 'medium', 'room that runs out before a reset is a finding');
    F.set({ schemaVersion: 1, accounts: [left(true), full] });
    F.tick();
    assert.equal(F.state().capacity.gap, false);
    assert.equal(F.state().capacity.runs_out_at, null, 'room that lasts to its own reset has no end');
    assert.ok(!findings(F).some((f) => f.kind === 'accounts-capacity-gap'));
    F.set(FULL);
    F.tick();
    assert.equal(F.state().capacity.room, 0);
    assert.ok(!findings(F).some((f) => f.kind === 'accounts-capacity-gap'), 'no room at all is accounts-exhausted, not a gap');
  } finally { F.done(); }
});

test('the claim: of several ticks at once only one rotates, and the rest of the interval stays quiet', async () => {
  const F = fixture('claim');
  try {
    const ticks = await Promise.all([1, 2, 3, 4].map(() => F.tickAsync(MINUTE)));
    for (const t of ticks) assert.equal(t.err, null, String(t.err));
    assert.deepEqual(autos(F), ['auto --once --json'], 'one rotation between them');
    assert.equal(F.called().filter((c) => c.startsWith('list')).length, 4, 'every tick still reads the accounts');
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 1, 'still inside the interval');
    assert.equal(fs.existsSync(`${claimFile()}.lock`), false, 'the lock is let go');
  } finally { F.done(); }
});

test('the claim: a stale, a future-dated or a mangled one holds nothing, and a live one does', () => {
  const F = fixture('claim-stale');
  try {
    const claimed = (text) => { fs.mkdirSync(path.dirname(claimFile()), { recursive: true }); fs.writeFileSync(claimFile(), text); };
    claimed(JSON.stringify({ at: Date.now() - 90000, by: 1 }));
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 1, 'stale: taken over');
    claimed(JSON.stringify({ at: Date.now() + 3600000, by: 1 }));
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 2, 'future-dated: taken over');
    claimed('not json');
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 3, 'mangled: taken over');
    fs.rmSync(claimFile());
    fs.mkdirSync(claimFile());
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 4, 'a directory in its place: taken over');
    assert.ok(fs.statSync(claimFile()).isFile());
    claimed(JSON.stringify({ at: Date.now() - 1000, by: 1 }));
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 4, 'a live claim holds');
  } finally { F.done(); }
});

test('the dashboard: rotation needs no hub, one dashboard does it per interval, and another picks it up; every one looks after its own panes', async () => {
  const A = fixture('rotator');
  const B = fixture('other');
  const HUB = PORTS + 70;
  const P = PORTS + 71;
  const env = (F) => { const e = { ...F.env({ DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(P), DEVTEAM_ACCOUNTS_MS: '200', DEVTEAM_HUB_RETRY_MS: '60000' }) }; delete e.DEVTEAM_ROLE; return e; };
  // a hub neither of them holds: a dashboard on a kit older than rotation
  const oldHub = http.createServer((req, res) => { res.end(JSON.stringify({ hub: 1 })); });
  await new Promise((r) => oldHub.listen(HUB, '127.0.0.1', r));
  const began = Date.now();
  const a = startDashboard(A.root, env(A));
  let b;
  try {
    await until(() => autos(A).length > 0, 'rotation with the hub held elsewhere');
    b = startDashboard(B.root, env(B));
    await until(() => B.called().some((c) => c.startsWith('list')), 'the other dashboard ticking');
    assert.ok(autos(A).length + autos(B).length <= Math.ceil((Date.now() - began) / 180) + 1, 'one rotation per interval between them');
    await until(() => fs.existsSync(path.join(A.root, 'docs/devteam/run/accounts.json')), "the first dashboard's state");
    assert.ok(!json(A.run(['log', '--json']).stdout).some((o) => o.by === 'owner'), 'nothing is written as the owner');
    await a.stop();
    const n = autos(B).length;
    await until(() => autos(B).length > n, 'the other dashboard rotating once the first is gone');
  } finally { await a.stop(); await b?.stop(); await new Promise((r) => { oldHub.close(r); oldHub.closeAllConnections?.(); }); A.done(); B.done(); }
});
