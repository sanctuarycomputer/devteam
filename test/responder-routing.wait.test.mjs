// Responder routing (kit-104), done-when 4: wait doesn't wake on owner turns routed to the responder,
// and still wakes on turns routed to the supervisor, on handoffs and on responder-overdue. Its own file:
// a passing case waits its full 90 s (ruling a-20261123-052625366-supervisor).
// Run: node --test test/responder-routing.wait.test.mjs (tmux, on a private TMUX_TMPDIR)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MIN, SUP, RESPONDER, NO_TMUX, sleep, fixture, helpers } from './lib/responder-routing.mjs';

test('responder routing: wait (kit-104)', { skip: NO_TMUX, timeout: 280000 }, async (t) => {
  const F = fixture('responder-routing-wait');
  t.after(() => F.done());
  F.up();
  const { only, ask, oldThread, after } = helpers(F, t);
  const since = () => fs.writeFileSync(path.join(F.old, 'docs/devteam/run/wait-since'), `${Date.now()}\n`);
  const waitFor = (ms) => new Promise((resolve) => {
    // its own process group, so a wait stopped at the deadline takes its metrics children with it
    const c = spawn(process.execPath, [F.DT, 'wait', '--minutes', '2'], { cwd: F.old, detached: true, env: F.env(F.withSup({ ...SUP, DEVTEAM_TEST_WAIT_CYCLE_MS: '1000' })) });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { try { process.kill(-c.pid, 'SIGKILL'); } catch {} sleep(500); resolve({ returned: false, out }); }, ms);
    c.on('exit', () => { clearTimeout(timer); resolve({ returned: true, out }); });
  });
  const waitCase = (name, fn) => t.test(name, only && !only.test(name) ? { skip: true } : {}, async () => { const snap = F.snapLog(); try { await fn(); } finally { F.restoreLog(snap); } });
  await waitCase('A1a wait does not return within 90 s on owner turns routed to the responder: a thread new, and a reopen with words', async () => {
    const { T } = F.thread('For wait, to reopen');
    after(() => F.writerTurn('responder', T, 0));
    F.owner(['thread', 'resolve', T]);
    since();
    F.thread('For wait');
    F.owner(['thread', 'reopen', T, '--', 'one more thing']);
    const r = await waitFor(90000);
    assert.equal(r.returned, false, `wait returned: ${r.out}`);
  });
  await waitCase('A1b wait returns on a turn routed to the supervisor', async () => {
    since();
    const { T } = F.thread('For wait, asked');
    ask(T);
    since();
    F.say(T, 'my answer');
    assert.equal((await waitFor(60000)).returned, true);
  });
  await waitCase('A1c wait returns on a handoff', async () => {
    const { T } = F.thread('For wait, handed over');
    after(() => F.writerTurn('responder', T, 0));
    since();
    F.run(['send', 'supervisor', 'a ticket, please', '--kind', 'handoff', '--thread', T], RESPONDER);
    assert.equal((await waitFor(60000)).returned, true);
  });
  await waitCase('A1d wait returns on responder-overdue', async () => {
    const T = oldThread(30 * MIN);
    since();
    F.ownerTurn(T, 4 * MIN);
    const r = await waitFor(60000);
    assert.equal(r.returned, true);
    assert.match(r.out, /responder-overdue/);
  });

});
