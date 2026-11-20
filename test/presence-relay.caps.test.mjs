// The presence relay (presence@1), A7 part 2: ten seconds over but not in a row, the caps, and the ping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardOnFreePort, fleetFixture, PORTS } from './lib/kit.mjs';
import { LIMITS, openPresence } from './lib/presence-fake.mjs';
import { check, clients, closedWithin, closeEvery, dashboard, fill200, hereMsg, json, nothingKept, onlyProbe, open, P, sentinel, until } from './lib/presence-relay-fixture.mjs';

test('presence A7: the rate, the per-person and per-server caps, and the ping, each closing as the contract says (2 of 2: (a2), (c), (d), (d2), (e))', check(async (t) => {
  const { url } = await dashboard();
  await t.test('(a2) ten seconds over, but not in a row, is not closed', async () => {
    const R = await open(url, { headers: P('zq7-rows') });
    R.send(hereMsg({ page: 'zq7-rows' }));
    await R.next((m) => m.t === 'people', 5000);
    let closed = false;
    R.closed.then(() => { closed = true; });
    const burst = () => R.raw(Buffer.concat(Array.from({ length: 40 }, () => R.build(json({ t: 'zz' })))));
    const flood = async (ms) => { const end = Date.now() + ms; while (Date.now() < end && !closed) { burst(); await new Promise((r) => setTimeout(r, 250)); } };
    await flood(7000);
    await new Promise((r) => setTimeout(r, 2500)); // at least one whole server second under 30
    await flood(7000);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(closed, false, 'fourteen seconds over in two runs of seven is not closed');
    await sentinel(R, { page: 'zq7-rows' }, [R]);
  });
  await closeEvery();
  await t.test('(c) the 9th connection of one person is closed 1008 before welcome', async () => {
    for (let i = 0; i < LIMITS.perPerson; i++) assert.ok((await open(url, { headers: P('zq7-p8') })).you, `connection ${i + 1} welcomed`);
    const ninth = await open(url, { headers: P('zq7-p8') });
    assert.equal(ninth.status, 101, 'accepted');
    assert.equal(ninth.you, undefined, 'no welcome');
    assert.equal(await closedWithin(ninth), 1008);
    assert.ok((await open(url, { headers: P('zq7-p9') })).you, 'another person is still welcome');
  });
  await closeEvery();
  await t.test('(d) 200 at the field limits fit; a new person\'s 201st is closed 1008 before welcome', async () => {
    await onlyProbe(url);
    const { cs } = await fill200(url);
    await until(() => cs.every((c) => c.sizes.length >= 2), 'each of the 200 has a people', 30000);
    for (const [i, c] of cs.entries()) assert.ok(c.sizes.every((n) => n < LIMITS.serverMsg), `client ${i}: every frame under 262144`);
    const over = await open(url, { headers: P('zq7-p201') });
    assert.equal(over.status, 101);
    assert.equal(over.you, undefined, 'the 201st gets no welcome');
    assert.equal(await closedWithin(over), 1008);
  });
  await closeEvery();
  await t.test('(d2) the per-server cap counts connections: 25 people with 8 each fill it', async () => {
    await onlyProbe(url);
    for (let p = 0; p < 25; p++) {
      for (let i = 0; i < LIMITS.perPerson; i++) assert.ok((await open(url, { headers: P(`zq7-m${p}`), keep: false })).you, `person ${p} connection ${i + 1} welcomed`);
    }
    const over = await open(url, { headers: P('zq7-m-new') });
    assert.equal(over.status, 101);
    assert.equal(over.you, undefined, "a new person's 201st connection gets no welcome");
    assert.equal(await closedWithin(over), 1008);
  });
  await closeEvery();
  await t.test('(e) two unanswered pings close 1001; a connection that pongs stays', async () => {
    const F = fleetFixture('presence-ping');
    const env = F.env({ DEVTEAM_HUB_PORT: String(PORTS + 2), DEVTEAM_PRESENCE_PING_MS: '1000' });
    const { dash, port } = await dashboardOnFreePort(F.old, env);
    try {
      const u = `http://127.0.0.1:${port}`;
      const Pn = await openPresence(u, { headers: P('zq7-never') });
      clients.add(Pn);
      const t0 = Date.now();
      // Q answers each ping with its pong at the end of a burst over the rate: a pong is never dropped
      const Q = await openPresence(u, { headers: P('zq7-pongs') });
      clients.add(Q);
      let answered = 0;
      const answer = setInterval(() => {
        const pings = Q.messages.filter((m) => m.t === 'ping').length;
        for (; answered < pings; answered++) Q.raw(Buffer.concat([...Array.from({ length: 40 }, () => Q.build(json({ t: 'zz' }))), Q.build(json({ t: 'pong' }))]));
      }, 100);
      answer.unref();
      let qClosed = false;
      Q.closed.then(() => { qClosed = true; clearInterval(answer); });
      assert.equal(await closedWithin(Pn, 8000), 1001, 'two unanswered pings close 1001');
      assert.equal(Pn.messages.filter((m) => m.t === 'ping').length, 2, 'closed after exactly two pings, at the third');
      const took = Date.now() - t0;
      assert.ok(took >= 2500 && took <= 6000, `at the third ping, not the second (${took} ms)`);
      const seen = Q.messages.filter((m) => m.t === 'ping').length;
      await until(() => Q.messages.filter((m) => m.t === 'ping').length > seen, 'a ping after Pn closed', 5000);
      assert.equal(qClosed, false, 'the connection that pongs, over the rate each time, is still open');
      clearInterval(answer);
    } finally {
      await closeEvery();
      await dash.stop();
      F.done();
    }
  });
  await nothingKept();
}));
