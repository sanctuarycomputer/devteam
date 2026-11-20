// The presence relay (presence@1), A7 part 1: the rate over ten seconds, what counts, and moves dropped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { between, check, dashboard, hereMsg, json, kinds, open, P, peopleIds, sentinel } from './lib/presence-relay-fixture.mjs';

test('presence A7: the rate, the per-person and per-server caps, and the ping, each closing as the contract says (1 of 2: (a), (a3), (b))', check(async (t) => {
  const { url } = await dashboard();
  await t.test('(a) over 30 a second for 10 s is closed 1008; one second over is not', async () => {
    const O = await open(url, { headers: P('zq7-once') });
    O.send(hereMsg({ page: 'zq7-once' }));
    await O.next((m) => m.t === 'people', 5000);
    const G = await open(url, { headers: P('zq7-flood') });
    const tG = Date.now(); // G's server seconds roll at tG − (a few ms) + n s
    const burst = (c) => c.raw(Buffer.concat(Array.from({ length: 40 }, () => c.build(json({ t: 'zz' })))));
    await new Promise((r) => setTimeout(r, 1100));
    burst(O); // one second over, then nothing
    await new Promise((r) => setTimeout(r, Math.max(0, tG + 2150 - Date.now()))); // 150 ms into G's third second
    const start = Date.now();
    let code = null;
    G.closed.then((x) => { code = x; });
    while (code === null && Date.now() - start < 15000) { burst(G); await new Promise((r) => setTimeout(r, 250)); }
    const took = Date.now() - start;
    assert.equal(code, 1008, 'the flood is closed 1008');
    // over in each of the ten seconds from the one it began in: closed at that tenth second's roll, about 9.85 s
    // (eleven would be 10.85 s)
    assert.ok(took >= 9000 && took <= 10400, `closed after ten seconds over, not before and not eleven (${took} ms)`);
    await sentinel(O, { page: 'zq7-once' }, [O]);
    assert.equal(O.status, 101, 'the one-second burst is still open');
  });
  await t.test('(a3) heres, ping and pong frames and pongs count; a here and a pong over the rate are never dropped', async () => {
    const A = await open(url, { headers: P('zq7-ca') });
    const B = await open(url, { headers: P('zq7-cb') });
    const at = { page: 'zq7-count' };
    A.send(hereMsg(at)); B.send(hereMsg(at));
    await B.next((m) => m.t === 'people' && ['zq7-ca', 'zq7-cb'].every((id) => peopleIds(m).includes(id)), 5000);
    const mark = B.messages.length;
    const move = (k) => A.build(json({ t: 'move', a: { k, x: 0, y: 0 } }));
    const wait = () => new Promise((r) => setTimeout(r, 1100));
    // each write: 30 counted messages of one kind, then a move, which is the 31st and dropped
    await wait();
    A.raw(Buffer.concat([...Array.from({ length: 30 }, (_, i) => A.build(json(hereMsg({ ...at, thread: `zq7-h${i % 2}` })))), move('zq7-after-heres')]));
    await wait();
    A.raw(Buffer.concat([...Array.from({ length: 30 }, () => A.build(Buffer.from('p'), { opcode: 9 })), move('zq7-after-pings')]));
    await wait();
    A.raw(Buffer.concat([...Array.from({ length: 30 }, () => A.build(json({ t: 'pong' }))), move('zq7-after-pongs')]));
    await wait();
    A.raw(Buffer.concat([...Array.from({ length: 30 }, () => A.build(Buffer.from('p'), { opcode: 10 })), move('zq7-after-pong-frames')]));
    // over the rate already, a here still lands
    await wait();
    A.raw(Buffer.concat([...Array.from({ length: 40 }, () => A.build(json({ t: 'zz' }))), A.build(json(hereMsg({ ...at, thread: 'zq7-late' })))]));
    await B.next((m) => m.t === 'people' && m.people.some((p) => p.id === 'zq7-ca' && p.conns[0].at.thread === 'zq7-late'), 5000);
    await wait();
    A.send({ t: 'move', a: { k: 'zq7-end', x: 0, y: 0 } });
    const end = await B.next((m) => m.t === 'move' && m.a?.k === 'zq7-end', 5000);
    assert.deepEqual(kinds(between(B, mark, end), 'move').map((m) => m.a.k), [], 'the move after 30 heres, 30 ping frames, 30 pongs or 30 pong frames is the 31st and dropped');
  });
  await t.test('(b) moves over 30 in a second are dropped', async () => {
    const A = await open(url, { headers: P('zq7-ra') });
    const B = await open(url, { headers: P('zq7-rb') });
    A.send(hereMsg({ page: 'zq7-rate' })); B.send(hereMsg({ page: 'zq7-rate' }));
    await B.next((m) => m.t === 'people' && ['zq7-ra', 'zq7-rb'].every((id) => peopleIds(m).includes(id)), 5000);
    await new Promise((r) => setTimeout(r, 1100));
    const mark = B.messages.length;
    A.raw(Buffer.concat(Array.from({ length: 200 }, (_, i) => A.build(json({ t: 'move', a: { k: 'zq7-kit-1', x: i / 1000, y: 0 } })))));
    await new Promise((r) => setTimeout(r, 2100));
    A.send({ t: 'move', a: { k: 'zq7-end', x: 0, y: 0 } });
    const end = await B.next((m) => m.t === 'move' && m.a?.k === 'zq7-end', 5000);
    const xs = kinds(between(B, mark, end), 'move').map((m) => m.a.x);
    assert.ok(xs.length >= 30 && xs.length <= 60, `30 to 60 of 200 moves in one write arrive (${xs.length})`);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b), 'in their order');
  });
}));
