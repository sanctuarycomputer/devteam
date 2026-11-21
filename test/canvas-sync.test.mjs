// The canvas editor keeps edits safe across drops (kit-668, docs/devteam/dashboard/canvas.html): its
// own edits resent after a restart, a reconnect, a reload or a refusal, in headless Chrome against the
// kit-651 fake (test/lib/canvas-fake.mjs), which serves the page through its `serve` option. The
// harness is kit-662's (test/canvas-editing.test.mjs): the recorder watches the page on a second
// DevTools connection of its own: its requests (Fetch), its dialogs and exceptions, and its WebSocket
// frames (Network), each parsed, both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { canDrive } from './lib/chrome.mjs';
import { EVERY, EVERY_IMAGES, SAY, ackOf, afterWelcome, allSaved, ana, body, closePageSocket, count, docNow, docRequests, edits, enter, fieldSet, focusField, framesWithSeq, gotOf, holdDocs, kept, leavePanel, live, nameSet, nextEdit, noDialogs, noExceptions, open, refusedFrames, releaseAll, rename, rowName, selectRow, sentFrom, shownText, waitOps, waitSaved, waitSeq, welcomeCount, within } from './lib/canvas-fixture.mjs';

// ---- S1: resend and reload ----

test('S1.1 a restart resends every own edit above the last saved', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const e1 = await rename(p, rec, 'title', 'One');
  await ackOf(rec, e1);
  await waitSaved(p);
  // S1.6: an acked edit and its saved: nothing kept
  await within(async () => (await kept(p)) === '0', 'data-kept 0 after the saved', async () => `kept ${await kept(p)}`);
  fake.pause('every');
  const e2 = await rename(p, rec, 'dot', 'Two');
  await ackOf(rec, e2);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once E2 is acked', async () => `kept ${await kept(p)}`);
  assert.ok(Number(await body(p, 'saved')) < Number(await body(p, 'rev')), 'data-saved below data-rev');
  // E3: typed before the restart, Enter pressed while down
  await selectRow(p, 'badge');
  assert.equal(await focusField(p, 'name'), true, "badge's Name field focused");
  await p.type('Three');
  fake.restart('every');
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  await enter(p);
  await leavePanel(p);
  assert.equal(await rowName(p, 'badge'), 'Three', 'E3 drawn at once, while down');
  await live(p);
  await within(async () => docRequests(rec, 'every').length === 2, 'a second doc request', async () => rec.requests.join(' '));
  await within(async () => welcomeCount(rec) >= 2, 'a second welcome');
  const from = afterWelcome(rec, 2);
  await waitSeq(rec, e2, from, 'E2 resent after the second welcome');
  const e3 = await waitOps(rec, nameSet('badge', 'Three'), from, 'E3 sent after the second welcome');
  assert.ok(e3.seq > e2.seq, 'E3 a seq of its own');
  assert.deepEqual(framesWithSeq(rec, e1.seq, from), [], 'E1 (saved) never resent');
  fake.resume('every');
  await allSaved(p);
  const d = fake.doc('every');
  assert.equal(d.nodes.title.name, 'One');
  assert.equal(d.nodes.dot.name, 'Two');
  assert.equal(d.nodes.badge.name, 'Three');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S1.2 a new session at a rev not lower still resends', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  fake.pause('every');
  const e4 = await rename(p, rec, 'dot', 'Four');
  await ackOf(rec, e4);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once E4 is acked', async () => `kept ${await kept(p)}`);
  const highest = Math.max(...rec.got.filter((m) => m && (m.t === 'ops' || m.t === 'welcome')).map((m) => m.rev));
  const w1 = gotOf(rec, 'welcome')[0].m;
  fake.restart('every');
  const a = await ana(fake, later);
  for (const n of ['Ana 1', 'Ana 2', 'Ana 3']) await a.edit(nameSet('title', n));
  const anaDone = Date.now();
  await within(async () => welcomeCount(rec) >= 2, 'a second welcome');
  await live(p);
  const w2 = gotOf(rec, 'welcome')[1];
  assert.ok(anaDone <= w2.at, "Ana's last ack came before the page's second welcome");
  assert.ok(w2.m.rev >= highest, `the second welcome's rev ${w2.m.rev} is at or above the highest seen ${highest}`);
  assert.notEqual(w2.m.session, w1.session, 'a new session');
  await waitSeq(rec, e4, afterWelcome(rec, 2), 'E4 resent to the new session');
  fake.resume('every');
  await allSaved(p);
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'Four');
  assert.equal(d.nodes.title.name, 'Ana 3');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S1.3 a same-session reconnect resends only the unacked', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await ana(fake, later); // Ana keeps the session open
  fake.pause('every');
  const e5 = await rename(p, rec, 'dot', 'Five');
  await ackOf(rec, e5);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once E5 is acked', async () => `kept ${await kept(p)}`);
  await selectRow(p, 'title');
  assert.equal(await focusField(p, 'name'), true, "title's Name field focused");
  await p.type('Six');
  assert.equal(await closePageSocket(rec), 1, "the page's one socket closed");
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  await enter(p);
  await leavePanel(p);
  await live(p);
  await within(async () => welcomeCount(rec) >= 2, 'a second welcome');
  const [w1, w2] = gotOf(rec, 'welcome');
  assert.equal(w2.m.session, w1.m.session, 'the same session');
  const from = afterWelcome(rec, 2);
  const e6 = await waitOps(rec, nameSet('title', 'Six'), from, 'E6 sent after the second welcome');
  await ackOf(rec, e6);
  // E5 is still kept (not saved), beside E6, and never resent on the same session
  assert.equal(await kept(p), '2', 'E5 still kept, with E6');
  await sleep(500);
  assert.deepEqual(framesWithSeq(rec, e5.seq, from), [], 'E5 not resent on the same session');
  assert.equal(await kept(p), '2', 'nothing dropped from kept before the saved');
  fake.resume('every');
  await allSaved(p);
  assert.deepEqual(framesWithSeq(rec, e5.seq, from), [], 'E5 never resent');
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'Five');
  assert.equal(d.nodes.title.name, 'Six');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S1.4 a refused edit reloads and keeps the other unacked edits', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), path: '/view/canvas/every#page=p-parts' });
  await live(p);
  // one acked edit kept (saving paused): the refusal's fetch is on the same session, so it stays kept
  fake.pause('every');
  const k0 = await rename(p, rec, 'button-bg', 'Bg');
  await ackOf(rec, k0);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once K0 is acked', async () => `kept ${await kept(p)}`);
  holdDocs(rec);
  await selectRow(p, 'button-label');
  const n0 = edits(rec).length;
  await p.key('Delete');
  const del = await nextEdit(rec, n0);
  assert.deepEqual(del.ops, [{ op: 'del', id: 'button-label' }], 'one del of button-label');
  await within(async () => refusedFrames(rec).some((m) => m.seq === del.seq && m.why === 'ref'), 'the del refused ref', async () => JSON.stringify(rec.got.slice(-3)));
  await within(async () => docRequests(rec, 'every').length === 2 && rec.held.length === 1, 'a second doc request, held', async () => rec.requests.join(' '), 5000);
  await within(async () => (await shownText(p, '#toast')) === SAY.ref, 'the refusal said', async () => shownText(p, '#toast'));
  // R2, made while the fetch is held: drawn at once, waiting unsent
  await selectRow(p, 'button');
  const n1 = edits(rec).length;
  await fieldSet(p, 'name', 'Kept');
  assert.equal(await rowName(p, 'button'), 'Kept', 'R2 drawn at once');
  assert.equal(await body(p, 'pending'), '1', 'R2 waits in pending');
  await sleep(300);
  assert.equal(edits(rec).length, n1, 'nothing sent while the fetch runs');
  assert.equal(await kept(p), '1', 'K0 still kept during the fetch');
  const from = rec.sent.length;
  rec.hold = null;
  rec.release();
  const r2 = await waitOps(rec, nameSet('button', 'Kept'), from, 'R2 sent after the fetch');
  await ackOf(rec, r2);
  assert.equal(await count(p, '#surface [data-id="button-label"]'), 1, 'button-label drawn again');
  // K0 stays kept beside R2 (both acked, not saved) and is never resent on the same session
  assert.equal(await kept(p), '2', 'K0 still kept, with R2');
  await sleep(500);
  assert.deepEqual(framesWithSeq(rec, k0.seq, from), [], 'K0 not resent after the same-session fetch');
  assert.equal(await kept(p), '2', 'nothing dropped from kept before the saved');
  fake.resume('every');
  await allSaved(p);
  assert.deepEqual(framesWithSeq(rec, k0.seq, from), [], 'K0 never resent');
  assert.equal(fake.doc('every').nodes['button-bg'].name, 'Bg');
  assert.equal(fake.doc('every').nodes.button.name, 'Kept');
  assert.ok(fake.doc('every').nodes['button-label'], 'button-label kept on the server');
  assert.equal(refusedFrames(rec).length, 1, 'only the del refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S1.5 a reload resends above the last saved and keeps the unacked', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  fake.pause('every');
  const k1 = await rename(p, rec, 'dot', 'K one');
  await ackOf(rec, k1);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once K1 is acked', async () => `kept ${await kept(p)}`);
  holdDocs(rec);
  fake.replace('every', EVERY);
  await within(async () => gotOf(rec, 'reload').length === 1, 'the reload frame');
  await within(async () => rec.held.length === 1, 'the doc request held', async () => rec.requests.join(' '), 5000);
  const reloadAt = gotOf(rec, 'reload')[0].at;
  // K2, made while the fetch is held
  await selectRow(p, 'title');
  const n1 = edits(rec).length;
  await fieldSet(p, 'name', 'K two');
  assert.equal(await rowName(p, 'title'), 'K two', 'K2 drawn at once');
  assert.equal(edits(rec).length, n1, 'K2 not sent while the fetch runs');
  await releaseAll(rec);
  rec.hold = null;
  const from = sentFrom(rec, reloadAt);
  await waitSeq(rec, k1, from, 'K1 resent to the new session');
  await waitOps(rec, nameSet('title', 'K two'), from, 'K2 sent to the new session');
  fake.resume('every');
  await allSaved(p);
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'K one');
  assert.equal(d.nodes.title.name, 'K two');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test("S1.7 a new session's saved during the fetch drops nothing of the old session's", { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const e7 = await rename(p, rec, 'dot', 'Seven');
  const a7 = await ackOf(rec, e7);
  holdDocs(rec);
  assert.ok(!gotOf(rec, 'saved').some((x) => x.m.rev >= a7.rev), "restarted before E7's saved");
  fake.restart('every');
  assert.ok(Number(await body(p, 'saved') || -1) < a7.rev, "data-saved below E7's ack rev");
  await within(async () => welcomeCount(rec) >= 2 && rec.held.length === 1, 'the second welcome and its doc request held', async () => `${welcomeCount(rec)} welcomes, ${rec.held.length} held`);
  const w2At = gotOf(rec, 'welcome')[1].at;
  const a = await ana(fake, later);
  const anaAck = await a.edit(nameSet('title', 'Ana'));
  assert.equal(anaAck.rev, a7.rev, "the new session reuses E7's ack rev");
  await within(async () => gotOf(rec, 'saved').some((x) => x.at >= w2At && x.m.rev >= a7.rev), "the new session's saved at E7's ack rev, received", async () => JSON.stringify(rec.got.slice(-3)), 5000);
  assert.equal(rec.held.length, 1, 'the fetch still held');
  await releaseAll(rec);
  rec.hold = null;
  await waitSeq(rec, e7, afterWelcome(rec, 2), 'E7 resent to the new session');
  await allSaved(p);
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'Seven');
  assert.equal(d.nodes.title.name, 'Ana');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('S1.8 a reload during a fetch', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, origin, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  fake.pause('every');
  const k3 = await rename(p, rec, 'dot', 'K three');
  await ackOf(rec, k3);
  await within(async () => (await kept(p)) === '1', 'data-kept 1 once K3 is acked', async () => `kept ${await kept(p)}`);
  await ana(fake, later); // Ana keeps the session open
  await p.click('#pages a[data-page="p-parts"]');
  await within(async () => (await count(p, '#surface [data-id="button"]')) === 1, 'Parts shown');
  holdDocs(rec);
  await selectRow(p, 'button-label');
  const session = fake.session('every');
  // the socket closed; inside the 1 s reconnect delay, the del and R4 queued unsent
  assert.equal(await closePageSocket(rec), 1, "the page's one socket closed");
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  const n0 = edits(rec).length;
  await p.key('Delete');
  await selectRow(p, 'button');
  await fieldSet(p, 'name', 'Held');
  assert.equal(welcomeCount(rec), 1, 'both queued before the reconnect');
  assert.equal(await body(p, 'pending'), '2', 'the del and R4 wait');
  assert.equal(edits(rec).length, n0, 'neither sent while down');
  // on reconnect (same session, same rev: no fetch) both go; the del is refused, R4 acked while the
  // fetch the refusal started is held
  await within(async () => welcomeCount(rec) >= 2, 'a second welcome');
  assert.equal(gotOf(rec, 'welcome')[1].m.session, session, 'the same session');
  const del = await waitOps(rec, [{ op: 'del', id: 'button-label' }], n0, 'the del sent');
  const r4 = await waitOps(rec, nameSet('button', 'Held'), n0, 'R4 sent');
  assert.ok(r4.seq > del.seq, 'R4 after the del');
  await within(async () => refusedFrames(rec).some((m) => m.seq === del.seq), 'the del refused', async () => JSON.stringify(rec.got.slice(-3)));
  const ack4 = await ackOf(rec, r4);
  const refusedAt = rec.got.findIndex((m) => m && m.t === 'refused' && m.seq === del.seq);
  assert.ok(refusedAt < rec.got.indexOf(ack4), "the refused frame came before R4's ack");
  await within(async () => rec.held.length === 1, 'the refusal\'s doc request held', async () => rec.requests.join(' '), 5000);
  const old = await docNow(origin);
  assert.equal(old.session, session, "the doc response read is the old session's");
  const R = structuredClone(EVERY);
  R.nodes.title.name = 'Replaced';
  fake.replace('every', R);
  await within(async () => gotOf(rec, 'reload').length === 1, 'the reload frame');
  const reloadAt = gotOf(rec, 'reload')[0].at;
  // the held pre-reload request answered with the old response; the next one held only until it is
  // seen, so the page is checked not to have taken the old answer (its rev, R4's ack rev, above base's
  // since R4's held ack went with the reload), then released as they come
  const revBefore = await body(p, 'rev');
  assert.equal(old.rev, Number(revBefore) + 1, "the old response holds R4's ack rev");
  const nReq = docRequests(rec, 'every').length;
  await rec.fulfill(rec.held[0], old);
  await within(async () => docRequests(rec, 'every').length > nReq && rec.held.length === 1, 'a doc request after the reload, held', async () => rec.requests.join(' '));
  assert.equal(await body(p, 'rev'), revBefore, 'the pre-reload answer was not taken as the document');
  await releaseAll(rec);
  rec.hold = null;
  const from = sentFrom(rec, reloadAt);
  await waitSeq(rec, k3, from, 'K3 resent to the new session');
  await waitSeq(rec, r4, from, 'R4 resent to the new session');
  fake.resume('every');
  await allSaved(p);
  assert.equal(await body(p, 'rev'), String(fake.rev('every')), 'data-rev is the fake rev');
  await p.click('#pages a[data-page="p-main"]');
  await within(async () => (await rowName(p, 'title')) === 'Replaced', "title drawn as Replaced", async () => rowName(p, 'title'));
  const d = fake.doc('every');
  assert.equal(d.nodes.dot.name, 'K three');
  assert.equal(d.nodes.button.name, 'Held');
  assert.equal(d.nodes.title.name, 'Replaced');
  assert.equal(refusedFrames(rec).length, 1, 'only the del refused');
  noDialogs(rec);
  noExceptions(rec);
});

test('a saved that comes before its held ack keeps nothing', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  // review T1-1: on the same session a saved covering an own edit can arrive while that edit's ack is
  // held by a fetch (here the fetch a refusal starts); once applied, the edit is on disk, not kept
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  await ana(fake, later); // Ana keeps the session open
  await p.click('#pages a[data-page="p-parts"]');
  await within(async () => (await count(p, '#surface [data-id="button"]')) === 1, 'Parts shown');
  holdDocs(rec);
  await selectRow(p, 'button-label');
  const session = fake.session('every');
  // the del and E queued while down, sent back to back on the same-session reconnect
  assert.equal(await closePageSocket(rec), 1, "the page's one socket closed");
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  const n0 = edits(rec).length;
  await p.key('Delete');
  await selectRow(p, 'button');
  await fieldSet(p, 'name', 'Saved');
  assert.equal(welcomeCount(rec), 1, 'both queued before the reconnect');
  assert.equal(await body(p, 'pending'), '2', 'the del and E wait');
  await within(async () => welcomeCount(rec) >= 2, 'a second welcome');
  assert.equal(gotOf(rec, 'welcome')[1].m.session, session, 'the same session');
  const del = await waitOps(rec, [{ op: 'del', id: 'button-label' }], n0, 'the del sent');
  const e = await waitOps(rec, nameSet('button', 'Saved'), n0, 'E sent');
  await within(async () => refusedFrames(rec).some((m) => m.seq === del.seq), 'the del refused', async () => JSON.stringify(rec.got.slice(-3)));
  const ack = await ackOf(rec, e);
  await within(async () => rec.held.length === 1, "the refusal's doc request held", async () => rec.requests.join(' '), 5000);
  // the fake's saved (500 ms after E applied) reaches the page while E's ack is still held
  await within(async () => gotOf(rec, 'saved').some((x) => x.m.rev >= ack.rev), "the saved covering E's ack", async () => JSON.stringify(rec.got.slice(-3)), 5000);
  assert.equal(rec.held.length, 1, 'the fetch still held when the saved came');
  await releaseAll(rec);
  rec.hold = null;
  await within(async () => (await body(p, 'pending')) === '0', 'pending 0 after the fetch', async () => body(p, 'pending'));
  assert.equal(await kept(p), '0', 'E not kept: the saved already covered it');
  // a restart then resends nothing of E
  fake.restart('every');
  await within(async () => welcomeCount(rec) >= 3, 'a third welcome');
  await live(p);
  await within(async () => docRequests(rec, 'every').length >= 3, 'the new session fetched', async () => rec.requests.join(' '));
  await sleep(1000);
  assert.deepEqual(framesWithSeq(rec, e.seq, afterWelcome(rec, 3)), [], 'E not resent after the restart');
  assert.equal(await body(p, 'pending'), '0');
  assert.equal(await kept(p), '0');
  assert.equal(fake.doc('every').nodes.button.name, 'Saved');
  assert.equal(refusedFrames(rec).length, 1, 'only the del refused');
  noDialogs(rec);
  noExceptions(rec);
});
