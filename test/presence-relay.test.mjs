// The presence relay (kit-631, presence@1): the /presence WebSocket on a real dashboard and on its
// real hub, driven by the contract's own test client (test/lib/presence-fake.mjs's openPresence) and
// held to its shapes (shapeErrors). The clock is real: every wait is a `next` or a `closed` with a
// deadline, and every "never" is bounded by a sentinel people on the same socket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPresenceFake, openPresence, shapeErrors } from './lib/presence-fake.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = () => fs.readFileSync(path.join(here, 'contracts', 'presence.md'), 'utf8');

// ---- the file's people: every id, name and at word starts zq7, so A8(d) can look for them on disk ----
const SPOT = Object.freeze({ page: 'zq7-board', tab: null, peek: 'zq7-kit-1', art: null, thread: null });
const hereMsg = (at = {}, visible = true) => ({ t: 'here', at: { ...SPOT, ...at }, visible });
const P = (id, name = 'zq7 Ann') => ({ 'x-devteam-person': `${id};name=${encodeURIComponent(name)}` });

async function until(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out after ${ms} ms: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

// ---- A8 (e): the contract and the fake say present is visible people only (the ruling) ----

test('presence A8: (e) the fake and the contract list only people with a visible connection', async () => {
  const s = contract();
  assert.ok(s.includes('whose connection said here and is visible'), "§11 says present is visible people only");
  const fake = await startPresenceFake({ clock: 'manual' });
  try {
    const open = (id) => openPresence(fake.url, { headers: P(id) });
    const said = async (c, m) => { const n = fake.stats().find((x) => x.conn === c.you.conn).messages; c.send(m); await until(() => fake.stats().find((x) => x.conn === c.you.conn).messages > n, 'taken'); };
    const A1 = await open('zq7-a'); const A2 = await open('zq7-a');
    const F1 = await open('zq7-f'); const F2 = await open('zq7-f');
    const B = await open('zq7-b'); const V = await open('zq7-v'); const H = await open('zq7-h');
    await open('zq7-s'); // silent: never says here
    await said(A1, hereMsg()); await said(A2, hereMsg({ tab: 'zq7-2' }));
    await said(F1, hereMsg({}, false)); await said(B, hereMsg());
    await said(V, hereMsg()); await said(H, hereMsg({}, false));
    await said(F2, hereMsg({ tab: 'zq7-2' }));
    await said(V, hereMsg({}, false));
    const who = (id) => ({ id, name: 'zq7 Ann', level: 'full' });
    assert.deepEqual(fake.present(), { present: [who('zq7-a'), who('zq7-f'), who('zq7-b')], present_more: 0 },
      'A (two visible tabs) once, F (first tab hidden, a later one visible) at its first here, B; not V (now hidden), H (hidden) or S (silent)');
    assert.deepEqual(shapeErrors('hello', fake.present()), []);
  } finally {
    await fake.close();
  }
});
