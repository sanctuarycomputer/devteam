// Leaving a full account for the one with the most room, and the warning when a session starts on one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { autos, claimFile, findings, fixture, FULL, HOME, MINUTE, MOVED, ROOM } from './lib/accounts-fixture.mjs';
import { hasTmux, write } from './lib/kit.mjs';

const switchCalls = (F) => F.called().filter((c) => c.startsWith('switch'));
const SOON = new Date(Date.now() + 3600000).toISOString();
const PAST = new Date(Date.now() - 3600000).toISOString();
const expired = (over) => ({ number: 1, email: 'a@x', active: true, usageStatus: 'token_expired', usage: null, ...over });
const FULL_READING = { lastGoodUsage: { fiveHour: { pct: 40 }, sevenDay: { pct: 100, resetsAt: SOON } }, lastGoodAgeSeconds: 7200 };
const OTHER = { number: 2, email: 'b@x', usageStatus: 'ok', usage: { fiveHour: { pct: 10 }, sevenDay: { pct: 20 } } };
const OTHER_FULL = { ...OTHER, usage: { fiveHour: { pct: 100 }, sevenDay: { pct: 20 } } };
const ROOMIEST = { ...OTHER, number: 3, email: 'c@x', usage: { fiveHour: { pct: 5 }, sevenDay: { pct: 6 } } };
// cswap's own state, where cswap keeps it in this test file's home (paths.py; env() clears XDG_DATA_HOME)
const CSWAP_STATE = path.join(HOME, ...(process.platform === 'linux' ? ['.local', 'share', 'claude-swap'] : ['.claude-swap-backup']), 'autoswitch_state.json');
const quarantine = (slot, file = CSWAP_STATE) => write(file, JSON.stringify({ schemaVersion: 1, quarantine: { [slot]: { email: 'c@x', reason: 'invalid_grant', at: '2026-11-01T00:00:00+00:00', refreshTokenFingerprint: null } } }));

test('leaving a full account: on an expired token with a full last reading, and on a plain full one', () => {
  const F = fixture('fallback');
  try {
    F.set({ accounts: [expired(FULL_READING), OTHER] });
    assert.match(F.tick('--rotate'), /cswap switched account: a@x -> b@x/);
    assert.deepEqual(switchCalls(F), ['switch 2 --json'], 'by number, once');
    assert.equal(F.state().active, 'b@x');
    assert.equal(F.state().active_no_room, false);
    assert.equal(F.state().exhausted, false);
    F.set({ accounts: [{ ...FULL.accounts[0] }, OTHER] });
    assert.match(F.tick('--rotate'), /cswap switched account: a@x -> b@x/);
    assert.equal(switchCalls(F).length, 2, 'a plain full account too');
  } finally { F.done(); }
});

test('leaving a full account: the enabled account with the most room is named, and staying put is reported', () => {
  const F = fixture('fallback-named');
  try {
    F.switches({ ...MOVED, to: { number: 3, email: 'c@x' } });
    F.set({ accounts: [expired(FULL_READING), OTHER, ROOMIEST, { ...OTHER, number: 4, email: 'd@x', disabled: true, usage: { fiveHour: { pct: 1 }, sevenDay: { pct: 1 } } }] });
    assert.match(F.tick('--rotate'), /cswap switched account: a@x -> c@x/);
    assert.deepEqual(switchCalls(F), ['switch 3 --json']);
    assert.equal(F.state().active, 'c@x');
    F.switches({ schemaVersion: 1, switched: false, reason: 'already-active' });
    F.set({ accounts: [{ ...FULL.accounts[0] }, OTHER] });
    assert.match(F.tick('--rotate'), /cswap stayed on a@x: already-active/);
    assert.equal(switchCalls(F).length, 2, 'one switch a tick');
  } finally { F.done(); }
});

test('leaving a full account: never onto a slot auto has quarantined, and a state file that makes no sense quarantines nothing', () => {
  const F = fixture('fallback-quarantine');
  const lastSwitch = () => switchCalls(F).at(-1);
  try {
    quarantine('3');
    F.set({ accounts: [expired(FULL_READING), OTHER, ROOMIEST] });
    F.tick('--rotate');
    assert.deepEqual(switchCalls(F), ['switch 2 --json'], 'the most room that is not quarantined');
    F.set({ accounts: [expired(FULL_READING), ROOMIEST] });
    F.tick('--rotate');
    assert.equal(switchCalls(F).length, 1, 'the only room is quarantined');
    F.set({ accounts: [expired(FULL_READING), OTHER, ROOMIEST] });
    for (const text of ['not json', 'null', '[]', '{}', '{"quarantine":null}', '{"quarantine":"abcd"}', '{"quarantine":["a","b","c","d"]}']) {
      write(CSWAP_STATE, text);
      const n = switchCalls(F).length;
      F.tick('--rotate');
      assert.equal(switchCalls(F).length, n + 1, text);
      assert.equal(lastSwitch(), 'switch 3 --json', text);
    }
    fs.rmSync(CSWAP_STATE);
    fs.mkdirSync(CSWAP_STATE);
    F.tick('--rotate');
    assert.equal(lastSwitch(), 'switch 3 --json', 'a directory');
    fs.rmSync(CSWAP_STATE, { recursive: true });
    F.tick('--rotate');
    assert.equal(lastSwitch(), 'switch 3 --json', 'no file');
  } finally { fs.rmSync(CSWAP_STATE, { recursive: true, force: true }); F.done(); }
});

test("leaving a full account: cswap's state is read from where cswap keeps it on this platform", () => {
  const F = fixture('fallback-xdg');
  const pick = (XDG_DATA_HOME) => { const r = F.run(['accounts-tick', '--rotate'], { XDG_DATA_HOME }); assert.equal(r.status, 0, r.stderr); return switchCalls(F).at(-1); };
  const inXdg = path.join(F.base, 'xdg', 'claude-swap', 'autoswitch_state.json');
  const inHome = path.join(HOME, 'xdg-tilde', 'claude-swap', 'autoswitch_state.json');
  try {
    F.set({ accounts: [expired(FULL_READING), OTHER, ROOMIEST] });
    quarantine('3', inXdg);
    quarantine('3', inHome);
    // Linux follows XDG_DATA_HOME, expanding a leading ~; macOS never looks at it
    assert.equal(pick(path.join(F.base, 'xdg')), process.platform === 'linux' ? 'switch 2 --json' : 'switch 3 --json');
    assert.equal(pick('~/xdg-tilde'), process.platform === 'linux' ? 'switch 2 --json' : 'switch 3 --json');
    // not absolute: ignored, as cswap ignores it, so the default place is the one that counts
    quarantine('3');
    assert.equal(pick('relative/xdg'), 'switch 2 --json');
  } finally { fs.rmSync(path.join(HOME, 'xdg-tilde'), { recursive: true, force: true }); fs.rmSync(CSWAP_STATE, { force: true }); F.done(); }
});

test('leaving a full account: not on unknown usage, an old reading, no room, no claim, or after cswap moved', () => {
  const F = fixture('fallback-not');
  try {
    F.set({ accounts: [expired(), OTHER] });
    assert.equal(F.tick('--rotate'), '', 'unknown usage');
    F.set({ accounts: [{ number: 1, email: 'a@x', active: true, usageStatus: 'unavailable', usage: null, lastGoodUsage: { sevenDay: { pct: 100, resetsAt: SOON } }, lastGoodAgeSeconds: 60 }, OTHER] });
    F.tick('--rotate');
    F.set({ accounts: [expired({ lastGoodUsage: { sevenDay: { pct: 100, resetsAt: PAST } }, lastGoodAgeSeconds: 7200 }), OTHER] });
    F.tick('--rotate');
    F.set({ accounts: [expired({ lastGoodUsage: { fiveHour: { pct: 100 } }, lastGoodAgeSeconds: 6 * 3600 }), OTHER] });
    F.tick('--rotate');
    F.set({ accounts: [expired({ lastGoodUsage: { sevenDay: { pct: 100 } } }), OTHER] });
    F.tick('--rotate');
    assert.deepEqual(switchCalls(F), [], 'an unknown or out-of-date reading is not a full account');
    assert.equal(F.state().active_no_room, false);
    // no account has room: left for accounts-exhausted to say, a last-known-full account counted
    F.set({ accounts: [expired(FULL_READING), OTHER_FULL] });
    F.tick('--rotate');
    assert.deepEqual(switchCalls(F), [], 'nothing has room');
    assert.equal(F.state().exhausted, true);
    assert.equal(F.state().active_no_room, true);
    assert.ok(findings(F).some((f) => f.kind === 'accounts-exhausted'));
    F.set({ accounts: [expired(FULL_READING), { ...OTHER, disabled: true }] });
    F.tick('--rotate');
    assert.deepEqual(switchCalls(F), [], 'a disabled account is not room');
    F.set({ accounts: [expired(FULL_READING), OTHER] });
    F.tick();
    assert.deepEqual(switchCalls(F), [], 'without --rotate');
    F.run(['accounts-tick', '--rotate'], MINUTE);
    const n = switchCalls(F).length;
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(switchCalls(F).length, n, 'another dashboard holds the claim');
    F.set({ accounts: [expired(FULL_READING), OTHER] }, `${JSON.stringify({ event: 'switch', from: { email: 'a@x' }, to: { email: 'b@x' } })}\n`, 0);
    const before = switchCalls(F).length;
    F.tick('--rotate');
    assert.equal(switchCalls(F).length, before, 'cswap moved it itself');
  } finally { F.done(); }
});

test('leaving a full account: not once another dashboard has taken the claim over', () => {
  const F = fixture('fallback-lost');
  try {
    F.set({ accounts: [expired(FULL_READING), OTHER] });
    // between auto and the switch, the way a slow list lets the claim lapse and another dashboard take it
    write(path.join(F.base, 'list.hook'), `printf '%s' '${JSON.stringify({ at: Date.now(), by: 1 })}' > ${JSON.stringify(claimFile())}\n`);
    F.run(['accounts-tick', '--rotate'], MINUTE);
    assert.equal(autos(F).length, 1);
    assert.deepEqual(switchCalls(F), [], 'the claim is no longer this tick\'s');
  } finally { F.done(); }
});

test('starting a session: a warning on a full active account, never a refusal, and only on fresh news', { skip: !hasTmux }, async () => {
  const F = fixture('prelaunch');
  try {
    F.worker('x-01-a', ['> ']);
    // its agent has exited, so the window is back at a shell and --resume starts it
    execFileSync('tmux', ['respawn-pane', '-k', '-t', `=${F.session}:x-01-a`, 'sh']);
    const accounts = path.join(F.root, 'docs/devteam/run/accounts.json');
    const start = () => F.run(['worker', 'x-01-a', '--resume']);
    F.set(FULL);
    F.tick();
    assert.equal(F.state().active_no_room, true);
    const warned = start();
    assert.equal(warned.status, 0, warned.stderr);
    assert.match(warned.stderr, /warning: the active Claude account \(a@x\) has no room left/);
    const stale = { ...F.state(), at: new Date(Date.now() - 3600000).toISOString() };
    write(accounts, JSON.stringify(stale));
    assert.doesNotMatch(start().stderr, /no room left/, 'old news');
    write(accounts, JSON.stringify({ ...stale, at: new Date(Date.now() + 3600000).toISOString() }));
    assert.doesNotMatch(start().stderr, /no room left/, 'dated in the future');
    write(accounts, JSON.stringify({ ...stale, at: new Date().toISOString(), active_no_room: 'yes' }));
    assert.doesNotMatch(start().stderr, /no room left/, 'not a true');
    write(accounts, JSON.stringify({ ...stale, at: new Date().toISOString(), active: 'x'.repeat(200) }));
    assert.match(start().stderr, /account \(x{80}\) has no room left/, 'a long name is cut short');
    F.set(ROOM);
    F.tick();
    assert.doesNotMatch(start().stderr, /no room left/, 'room');
  } finally { F.done(); }
});
