// The canvas editor edits (kit-662, docs/devteam/dashboard/canvas.html): edits sent live over the
// /canvas socket and everyone else's applied, in headless Chrome against the kit-651 fake
// (test/lib/canvas-fake.mjs), which serves the page through its `serve` option. Every test watches the
// page on a second DevTools connection of its own (the recorder, kit-661's): its requests (Fetch), its
// dialogs and exceptions, and here also its WebSocket frames (Network), each parsed, both ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { canDrive } from './lib/chrome.mjs';
import { BANNER, EVERY, EVERY_IMAGES, SAY, ackOf, ana, body, closePageSocket, count, docRequests, edits, enter, fieldSet, focusField, leavePanel, live, nextEdit, noExceptions, open, propControls, refusedFrames, selectRow, shownText, text, titleRowName, waitSaved, within } from './lib/canvas-fixture.mjs';

// ---- C3: sent live, both ways ----

test('sent live, both ways', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  assert.equal(await body(p, 'rev'), String(EVERY.rev), 'data-rev is the loaded rev');
  assert.equal(await body(p, 'pending'), '0');
  const welcome = rec.got.find((m) => m.t === 'welcome');
  assert.ok(welcome, 'the page got welcome');
  const a = await ana(fake, later);

  // C3.1: the page's edit (title's name, by the Name field) reaches Ana as ops within 1 s of its frame
  await selectRow(p, 'title');
  const n0 = edits(rec).length;
  await fieldSet(p, 'name', 'Page title');
  const e = await nextEdit(rec, n0);
  const sentAt = rec.sentAt[rec.sent.indexOf(e)];
  assert.match(e.client, /^[0-9a-z]{16}$/, 'client: 16 of [0-9a-z]');
  assert.ok(Number.isSafeInteger(e.seq) && e.seq >= 1, `seq a positive integer (${e.seq})`);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'title', prop: 'name', value: 'Page title' }], 'one set of name');
  assert.equal(edits(rec).length, n0 + 1, 'exactly one edit frame');
  const theirs = await a.next((m) => m.t === 'ops' && m.ack && m.ack.client === e.client && m.ack.seq === e.seq, 5000);
  const gotAt = Date.now();
  assert.ok(gotAt - sentAt < 1000, `Ana got the page's edit ${gotAt - sentAt} ms after its frame`);
  assert.deepEqual(theirs.ops, e.ops, 'Ana got the same ops');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.equal(fake.doc('every').nodes.title.name, 'Page title', "the fake's document holds it");
  assert.equal(await titleRowName(p), 'Page title', 'the Layers row shows it');
  assert.equal(await text(p, '#props [data-field="name"]'), 'Page title', 'the read-only Name row shows it');

  // C3.2: Ana's edit is drawn by the page within 1 s, without a reload (no new doc request)
  const docs = docRequests(rec, 'every').length;
  assert.equal(docs, 1, 'one doc request so far');
  const t0 = Date.now();
  await a.edit([{ op: 'set', id: 'title', prop: 'text', value: 'From Ana' }]);
  await within(async () => (await text(p, '#surface [data-id="title"]')) === 'From Ana', "Ana's text drawn", async () => text(p, '#surface [data-id="title"]'), 5000);
  assert.ok(Date.now() - t0 < 1000, `drawn ${Date.now() - t0} ms after Ana sent it`);
  assert.equal(docRequests(rec, 'every').length, docs, 'no new doc request');
  assert.equal(await body(p, 'rev'), String(fake.rev('every')), "data-rev follows the server's rev");
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('a refused edit is undone and said', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every'), path: '/view/canvas/every#page=p-parts' });
  await live(p);
  await selectRow(p, 'button-label');
  const n0 = edits(rec).length;
  await p.key('Delete');
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'button-label' }], 'one del of button-label');
  await within(async () => refusedFrames(rec).some((m) => m.seq === e.seq), 'the refused frame', async () => JSON.stringify(rec.got.slice(-3)));
  assert.equal(refusedFrames(rec).find((m) => m.seq === e.seq).why, 'ref', 'refused ref (variant primary overrides it)');
  await within(async () => (await shownText(p, '#toast')) === SAY.ref, 'the refusal said', async () => shownText(p, '#toast'));
  await within(async () => (await body(p, 'pending')) === '0', 'data-pending back to 0', async () => body(p, 'pending'));
  assert.equal(await count(p, '#surface [data-id="button-label"]'), 1, 'button-label drawn again');
  assert.equal(await count(p, '#layers .layer[data-node="button-label"]'), 1, "button-label's row back");
  noExceptions(rec);
});

test('reconnects and sends what waited', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  assert.equal(docRequests(rec, 'every').length, 1);
  const session = fake.session('every');
  await selectRow(p, 'title');
  // the new name typed before the socket goes; Enter (the change) pressed while it is down
  assert.equal(await focusField(p, 'name'), true, 'the Name field focused');
  await p.type('While down');
  const n0 = edits(rec).length;
  fake.restart('every');
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  await within(async () => (await shownText(p, '#banner')) === BANNER.down, 'the reconnecting banner', async () => shownText(p, '#banner'), 5000);
  await enter(p);
  assert.equal(await titleRowName(p), 'While down', 'the edit shows at once, while down');
  await leavePanel(p);
  // back: a new session, so the document fetched again, then the edit sent
  await live(p);
  assert.notEqual(fake.session('every'), session, 'a new session');
  await within(async () => docRequests(rec, 'every').length === 2, 'a second doc request', async () => rec.requests.join(' '));
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'title', prop: 'name', value: 'While down' }]);
  const welcomes = rec.got.map((m, i) => [m, rec.gotAt[i]]).filter(([m]) => m.t === 'welcome');
  assert.equal(welcomes.length, 2, 'two welcomes');
  assert.ok(rec.sentAt[rec.sent.indexOf(e)] >= welcomes[1][1], 'the edit was sent after the second welcome');
  await ackOf(rec, e);
  await waitSaved(p);
  assert.equal(fake.doc('every').nodes.title.name, 'While down', 'applied once it was back');
  assert.equal(await shownText(p, '#banner'), null, 'no banner once back');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

test('a same-session reconnect fetches what it missed', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later); // Ana keeps the session open
  const session = fake.session('every');
  assert.equal(await closePageSocket(rec), 1, "the page's one socket closed");
  await a.edit([{ op: 'set', id: 'title', prop: 'name', value: "Ana's name" }]);
  await within(async () => (await titleRowName(p)) === "Ana's name", "Ana's name drawn after the reconnect", async () => titleRowName(p), 10000);
  await live(p);
  const welcomes = rec.got.filter((m) => m.t === 'welcome');
  assert.equal(welcomes.length, 2, 'two welcomes');
  assert.equal(welcomes[1].session, session, 'the same session');
  assert.ok(welcomes[1].rev > welcomes[0].rev, 'a higher rev');
  assert.equal(docRequests(rec, 'every').length, 2, 'the document fetched again');
  assert.equal(fake.session('every'), session);
  assert.equal(await body(p, 'rev'), String(fake.rev('every')));
  noExceptions(rec);
});

test('paused, resumed and landed', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  assert.equal(await shownText(p, '#banner'), null, 'no banner at first');
  await selectRow(p, 'title');
  fake.pause('every');
  await within(async () => (await shownText(p, '#banner')) === BANNER.paused, 'the paused banner', async () => shownText(p, '#banner'), 5000);
  assert.equal(await p.ev("document.getElementById('banner').getAttribute('role')"), 'status');
  fake.resume('every');
  await within(async () => (await shownText(p, '#banner')) === null, 'the banner gone on resume', async () => shownText(p, '#banner'), 5000);
  fake.land('every');
  await within(async () => (await shownText(p, '#banner')) === BANNER.landed, 'the landed banner', async () => shownText(p, '#banner'), 5000);
  await within(async () => (await body(p, 'live')) === 'off', 'data-live off', async () => body(p, 'live'), 5000);
  // with a node selected, every property control of the panel is disabled (fields later tasks add
  // are covered by the same walk), and so is Delete layer
  const ctl = await propControls(p);
  assert.ok(ctl.length > 0, 'the panel has property controls');
  for (const c of ctl) assert.equal(c.off, true, `${c.prop} disabled after landed`);
  assert.equal(await p.ev("document.querySelector('#props [data-action=\"delete\"]')?.disabled ?? null"), true, 'Delete layer disabled');
  // the tools bar's buttons too: at least one, and each disabled (plan-2 F2-1)
  const tools = await p.ev("[...document.querySelectorAll('#tools button')].map((b) => b.disabled)");
  assert.ok(tools.length > 0, 'the tools bar has buttons');
  assert.ok(tools.every((d) => d === true), `every tool disabled after landed (${JSON.stringify(tools)})`);
  await p.key('F');
  assert.equal(await p.ev("document.querySelector('#tools button[aria-pressed=\"true\"]')?.dataset.tool ?? null"), 'move', 'F changes no tool after landed');
  // no edit goes out, and no reconnect is tried
  const n0 = edits(rec).length;
  await p.click('#layers .layer[data-node="title"]');
  await p.key('Delete');
  await sleep(2500);
  assert.equal(edits(rec).length, n0, 'Delete sends nothing after landed');
  assert.equal(await count(p, '#surface [data-id="title"]'), 1, 'title still drawn');
  assert.equal(rec.got.filter((m) => m.t === 'welcome').length, 1, 'no reconnect after closed');
  assert.equal(await shownText(p, '#banner'), BANNER.landed, 'the landed banner stays');
  noExceptions(rec);
});

// ---- C4.5: Delete, and the component guard ----

test('delete and the component guard', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  // Delete on the selected rule: one del
  await selectRow(p, 'rule');
  let n0 = edits(rec).length;
  await p.key('Delete');
  let e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'rule' }], 'one del of rule');
  await ackOf(rec, e);
  assert.equal(await count(p, '#surface [data-id="rule"]'), 0, 'rule no longer drawn');
  assert.equal(await count(p, '#layers .layer[data-node="rule"]'), 0, "rule's row gone");
  assert.equal(await count(p, '#props [data-field]'), 0, 'the selection cleared');
  // Backspace on dot, and Delete layer on icon
  await selectRow(p, 'dot');
  n0 = edits(rec).length;
  await p.key('Backspace');
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'dot' }], 'Backspace: one del of dot');
  await selectRow(p, 'icon');
  n0 = edits(rec).length;
  await p.click('#props [data-action="delete"]');
  e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'del', id: 'icon' }], 'Delete layer: one del of icon');
  await ackOf(rec, e);
  await waitSaved(p);
  for (const id of ['rule', 'dot', 'icon']) assert.equal(fake.doc('every').nodes[id], undefined, `${id} gone from the fake's document`);

  // the component button, which buy uses: neither Delete nor Delete layer sends anything
  await p.click('#pages a[data-page="p-parts"]');
  await within(async () => (await count(p, '#surface [data-id="button"]')) === 1, 'Parts shown');
  await selectRow(p, 'button');
  n0 = edits(rec).length;
  await p.key('Delete');
  await within(async () => (await shownText(p, '#toast')) === SAY.instancesFirst, 'the guard said', async () => shownText(p, '#toast'));
  await p.ev("document.getElementById('toast').hidden = true");
  await p.click('#props [data-action="delete"]');
  await within(async () => (await shownText(p, '#toast')) === SAY.instancesFirst, 'the guard said again', async () => shownText(p, '#toast'));
  await sleep(500);
  assert.equal(edits(rec).length, n0, 'nothing sent for the component');
  assert.equal(await count(p, '#surface [data-id="button"]'), 1, 'button still drawn');
  assert.ok(fake.doc('every').nodes.button, 'button kept');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});

// ---- the review focus: the own edit wins until acked ----

test('the own edit wins until acked', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 180000 }, async (t) => {
  const { p, fake, rec, later } = await open(t, { canvases: { every: EVERY }, images: EVERY_IMAGES('every') });
  await live(p);
  const a = await ana(fake, later);
  await selectRow(p, 'title');
  assert.equal(await focusField(p, 'name'), true);
  await p.type('Mine');
  const n0 = edits(rec).length;
  // Ana's rename sent, then the page's at once
  const theirs = a.edit([{ op: 'set', id: 'title', prop: 'name', value: 'Theirs' }]);
  await enter(p);
  const e = await nextEdit(rec, n0);
  assert.deepEqual(e.ops, [{ op: 'set', id: 'title', prop: 'name', value: 'Mine' }]);
  await theirs;
  await ackOf(rec, e);
  await leavePanel(p);
  await waitSaved(p);
  assert.ok(rec.got.some((m) => m.t === 'ops' && m.by && m.by.id === 'ana'), "the page got Ana's ops");
  const final = fake.doc('every').nodes.title.name;
  // the drawing ends on the server's order: the fake's final value
  await within(async () => (await titleRowName(p)) === final, `the Layers row on the fake's final name (${final})`, async () => titleRowName(p), 5000);
  assert.equal(await text(p, '#props [data-field="name"]'), final, "the read-only Name row on the fake's final name");
  assert.equal(await p.ev("document.querySelector('#props [data-prop=\"name\"]').value"), final, "the Name field on the fake's final name");
  assert.equal(await body(p, 'pending'), '0');
  assert.deepEqual(refusedFrames(rec), [], 'nothing refused');
  noExceptions(rec);
});
