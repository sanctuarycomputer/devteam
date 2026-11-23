// Pins on a canvas (kit-664, docs/devteam/dashboard/canvas.html; canvas@1 §10, artifact-notes@1's
// node anchor): a pin placed on a layer with the Comment tool is an ordinary thread whose subject is
// { kind: 'artifact', slug: <the canvas>, at: `chore-canvas-<slug>`, anchor: { node: <id> } }; it sits on its layer's
// top-right corner and follows it, its card shows the thread's turns (a supervisor's reply too), and a
// pin whose layer is deleted keeps its thread and shows at the stage's top-left, marked "on a deleted
// layer". A View person sees pins and their threads, with no Comment tool and no reply box.
// At 390 px the bar covers none of the stage's own controls (N1), and Escape in a card closes it and
// nothing else (N2).
//
// Headless Chrome against the canvas and presence fakes (test/lib/canvas-fake.mjs,
// test/lib/presence-fake.mjs) for the canvas, and a real dashboard (threadsFixture) for the threads:
// each person's front stands in for the gateway, sending /api/thread… to the dashboard, /presence
// upgrades to the presence fake and everything else to the canvas fake, Host and Origin rewritten to
// the target's and the person's headers set (Vic's with x-devteam-level: view).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { request, startCanvasFake } from './lib/canvas-fake.mjs';
import { startPresenceFake } from './lib/presence-fake.mjs';
import { CANVAS, devtools, pageClient, serve } from './lib/canvas-cursors-fixture.mjs';
import { threadsFixture, dashboardOnFreePort, until } from './lib/kit.mjs';

const SLUGS = ['pins-place', 'pins-follow', 'pins-gone', 'pins-view'];
// N1's canvas: too many components to draw (test/canvas-editor.test.mjs's fanDoc: 20 components each
// holding 3 instances of the next), so the page shows its cap note, the stage-top's longest line
const NARROW = 'pins-narrow';
function narrowCanvas() {
  const nodes = {};
  const comps = [];
  for (let k = 0; k < 20; k++) {
    comps.push(`c${k}`);
    const kids = k < 19 ? [0, 1, 2].map((j) => `i${k + 1}-${j}`) : ['leaf'];
    nodes[`c${k}`] = { type: 'component', parent: 'p-comps', name: `C${k}`, x: 0, y: k * 100, layout: { mode: 'row', gap: 1 }, children: kids };
    if (k < 19) for (const id of kids) nodes[id] = { type: 'instance', parent: `c${k}`, name: `I${k + 1}`, component: `c${k + 1}` };
  }
  nodes.leaf = { type: 'rect', parent: 'c19', name: 'Leaf', size: { w: 1, h: 1 }, fill: '#ff0000' };
  nodes.i0 = { type: 'instance', parent: 'p-main', name: 'I0', component: 'c0' };
  return { canvas: 1, rev: 0, tokens: {}, pages: [{ id: 'p-main', name: 'Main', children: ['i0'] }, { id: 'p-comps', name: 'Components', children: comps }], nodes };
}

// A front for one person: /api/thread… to the dashboard, /presence upgrades to the presence fake,
// every other request and upgrade to the canvas fake; Host and Origin the target's, any person or
// level header the browser sent dropped and this person's set.
async function front({ canvasPort, presencePort, dashPort }, person, level = null) {
  const headersFor = (raw, port) => {
    const out = [];
    for (let i = 0; i < raw.length; i += 2) {
      const k = raw[i].toLowerCase();
      if (k === 'host' || k === 'x-devteam-person' || k === 'x-devteam-level') continue;
      out.push([raw[i], k === 'origin' ? `http://127.0.0.1:${port}` : raw[i + 1]]);
    }
    return [['Host', `127.0.0.1:${port}`], ...out, ['x-devteam-person', person], ...(level ? [['x-devteam-level', level]] : [])];
  };
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const port = req.url.startsWith('/api/thread') ? dashPort : canvasPort;
    const headers = {};
    for (const [k, v] of headersFor(req.rawHeaders, port)) headers[k] = v;
    const up = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* gone */ } });
    req.pipe(up);
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('upgrade', (req, socket, head) => {
    const port = req.url.split('?')[0] === '/presence' ? presencePort : canvasPort;
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...headersFor(req.rawHeaders, port).map(([k, v]) => `${k}: ${v}`), '', ''];
    const up = net.connect({ host: '127.0.0.1', port }, () => {
      up.write(lines.join('\r\n'));
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const end = () => { socket.destroy(); up.destroy(); };
    up.on('error', end);
    socket.on('error', end);
    up.on('close', end);
    socket.on('close', end);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

// Everything once for the file: the threads project and its dashboard, both fakes (one canvas per
// test, so a deletion in one leaves the others alone), Ana's (Full) and Vic's (View) fronts and one
// Chrome. Torn down after the last test, last made first.
const downs = [];
let shared = null;
after(async () => { for (const f of downs.reverse()) { try { await f(); } catch { /* the rest still go */ } } });
async function setup() {
  if (shared) return shared;
  const F = threadsFixture('canvas-pins');
  downs.push(() => F.done());
  const { dash, port: dashPort } = await dashboardOnFreePort(F.old, F.env({}));
  downs.push(() => dash.stop());
  const fake = await startCanvasFake({ canvases: { ...Object.fromEntries(SLUGS.map((s) => [s, CANVAS])), [NARROW]: narrowCanvas() }, serve });
  downs.push(() => fake.close());
  const pfake = await startPresenceFake();
  downs.push(() => pfake.close());
  const ports = { canvasPort: fake.port, presencePort: pfake.port, dashPort };
  const ana = await front(ports, 'ana;name=Ana');
  downs.push(() => ana.close());
  const vic = await front(ports, 'vic;name=Vic', 'view');
  downs.push(() => vic.close());
  const chrome = await openChrome();
  downs.push(() => chrome.close());
  const dir = chrome.proc.spawnargs.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  const portFile = path.join(dir, 'DevToolsActivePort');
  await until(() => fs.existsSync(portFile) && /^\d+\n/.test(fs.readFileSync(portFile, 'utf8')), 'DevToolsActivePort');
  const dport = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const version = await (await fetch(`http://127.0.0.1:${dport}/json/version`)).json();
  const browser = await devtools(version.webSocketDebuggerUrl);
  downs.push(() => browser.close());
  shared = { F, dashPort, fake, ana, vic, browser, dport };
  return shared;
}

// A page for a person's front, in a window of its own (so it is visible), 1440 x 900, closed after the test.
async function pageFor(t, s, fr) {
  const { targetId } = await s.browser.send('Target.createTarget', { url: 'about:blank', newWindow: true });
  const list = await (await fetch(`http://127.0.0.1:${s.dport}/json/list`)).json();
  const target = list.find((x) => x.id === targetId);
  assert.ok(target, 'the new window in /json/list');
  const dt = await devtools(target.webSocketDebuggerUrl);
  t.after(async () => { dt.close(); await s.browser.send('Target.closeTarget', { targetId }).catch(() => {}); });
  const p = await pageClient(dt, fr.url);
  await p.send('Emulation.setScrollbarsHidden', { hidden: true });
  await p.size(1440, 900);
  return p;
}

async function within(f, what, why = async () => '', ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    let v = false;
    try { v = await f(); } catch { v = false; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out waiting for ${what} (${await why()})`);
    await sleep(50);
  }
}
const noExceptions = (p, what) => assert.deepEqual(p.rec.exceptions.map((e) => e.exception?.description ?? e.text), [], `${what}: no exception`);

// The dashboard's threads, as the page reads them (a plain GET: no Sec-Fetch-Site, so allowed).
async function threads(s) {
  const r = await fetch(`http://127.0.0.1:${s.dashPort}/api/threads`);
  assert.equal(r.status, 200, 'GET /api/threads');
  return (await r.json()).threads;
}
// A pin's subject: an artifact note on the canvas as it is being edited, in its chore-canvas-<slug>
// worktree (the version a page with a session shows), anchored to a node.
const subjectOf = (slug, node) => ({ kind: 'artifact', slug, at: `chore-canvas-${slug}`, anchor: { node } });
// A pin opened by the owner from the command line, with its first turn; its thread id.
const openPin = (s, slug, node, words) => s.F.owner(['thread', 'new', `--title=On ${node}`, `--subject=${JSON.stringify(subjectOf(slug, node))}`, '--', words]).split('\n')[0].trim();
// The supervisor's edit, as `canvas apply` makes it (the canvas fake's local route).
async function apply(s, slug, ops) {
  const r = await request(`${s.fake.url}/api/canvas/local?slug=${slug}`, {
    method: 'POST', headers: { 'x-devteam-canvas-token': s.fake.token, 'Content-Type': 'application/json' },
    body: { by: 'supervisor', via: 'apply', ops },
  });
  assert.equal(r.status, 200, `the supervisor's edit ${JSON.stringify(ops)}`);
}

// A drawn node's box and the stage's, in viewport px.
const boxOf = (p, sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.getClientRects().length === 0) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; })()`);
const nodeBox = (p, id) => boxOf(p, `#surface [data-id="${id}"]`);
const pinSel = (id) => `#pins .pin[data-thread="${id}"]`;
const pinBox = (p, id) => boxOf(p, pinSel(id));
// The pin's centre on its layer's top-right corner, within 2 px.
async function pinOnCorner(p, thread, node) {
  const [b, n] = [await pinBox(p, thread), await nodeBox(p, node)];
  if (!b || !n) return false;
  return Math.abs((b.l + b.r) / 2 - n.r) <= 2 && Math.abs((b.t + b.b) / 2 - n.t) <= 2;
}
const show = async (p, thread, node) => JSON.stringify({ pin: await pinBox(p, thread), node: await nodeBox(p, node), pins: await p.ev("[...document.querySelectorAll('#pins .pin')].map((e) => e.dataset.thread + ' ' + e.dataset.node).join(', ')").catch(() => null) });
// The open card's turns, as shown: [{ who, text }].
const cardTurns = (p) => p.ev("[...document.querySelectorAll('#pinCard .turn')].map((e) => ({ who: e.querySelector('.who')?.textContent ?? '', text: e.querySelector('.text')?.textContent ?? '' }))");
const visible = (p, sel) => p.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`);
async function load(p, slug) {
  await p.load(`/view/canvas/${slug}`);
  await within(async () => (await p.ev('document.body.dataset.live')) === 'on', `${slug} live`);
}

test('canvas pins: a pin placed on a layer with the Comment tool is an artifact note with a node anchor, naming the canvas (DW1: P1)', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 280000 }, async (t) => {
  const s = await setup();
  const slug = 'pins-place';
  const A = await pageFor(t, s, s.ana);
  await load(A, slug);
  // P1a: Ana, a Full person, has the Comment tool
  await within(() => visible(A, '#pinTool'), "Ana's Comment tool (#pinTool)", async () => `data-level ${await A.ev('document.body.dataset.level ?? null')}`);
  await A.click('#pinTool');
  await A.click('#surface [data-id="n-card"]');
  await within(() => visible(A, '#pinCard[data-thread="new"] #pinText'), 'the new pin\'s card, with a box to write in');
  await A.ev("document.getElementById('pinText').focus()");
  await A.send('Input.insertText', { text: 'Can the card say the total?' });
  await A.click('#pinSend');
  // P1b: the thread the dashboard now has is an artifact note on n-card, naming the canvas, with Ana's words
  // (with its first turn: a read between the thread's opening and its turn shows it with none)
  const mine = await within(async () => (await threads(s)).find((x) => x.subject?.slug === slug && x.turns?.length > 0), 'the new thread in the dashboard', async () => JSON.stringify((await threads(s)).map((x) => x.subject)));
  assert.deepEqual(mine.subject, subjectOf(slug, 'n-card'), "the thread's subject: an artifact note anchored to n-card on this canvas");
  assert.equal(mine.status, 'open');
  assert.deepEqual(mine.turns.map((u) => u.text), ['Can the card say the total?'], 'its first turn is what Ana wrote');
  // and its pin is drawn on n-card's corner
  await within(() => pinOnCorner(A, mine.id, 'n-card'), "the new pin on n-card's top-right corner", () => show(A, mine.id, 'n-card'));
  noExceptions(A, 'Ana');
});

test('canvas pins: a pin follows its layer, and a supervisor\'s reply shows on it (DW1: P2, P3)', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 280000 }, async (t) => {
  const s = await setup();
  const slug = 'pins-follow';
  const id = openPin(s, slug, 'n-card', 'Make the card wider?');
  const A = await pageFor(t, s, s.ana);
  await load(A, slug);
  // P2a: the pin on n-card's top-right corner
  await within(() => pinOnCorner(A, id, 'n-card'), "the pin on n-card's top-right corner", () => show(A, id, 'n-card'));
  // P2b: the supervisor moves n-card; the pin follows it
  const before = await pinBox(A, id);
  await apply(s, slug, [{ op: 'set', id: 'n-card', prop: 'x', value: 120 }]);
  await within(async () => (await A.ev("document.querySelector('#surface [data-id=\"n-card\"]').style.left")) === '120px', 'n-card moved on the page');
  await within(() => pinOnCorner(A, id, 'n-card'), 'the pin back on the moved corner', () => show(A, id, 'n-card'), 2000);
  assert.ok((await pinBox(A, id)).l > before.l + 50, 'the pin moved right with n-card');
  // P3: its card shows the thread, and the supervisor's reply shows in it while it is open
  await A.click(pinSel(id));
  await within(async () => (await cardTurns(A)).some((u) => u.text === 'Make the card wider?'), 'the card with the first turn', async () => JSON.stringify(await cardTurns(A)));
  s.F.sup(['thread', 'reply', id, 'Done: the card is 400 px wide now.']);
  await within(async () => (await cardTurns(A)).some((u) => u.who === 'The supervisor' && u.text === 'Done: the card is 400 px wide now.'), "the supervisor's reply in the open card", async () => JSON.stringify(await cardTurns(A)), 15000);
  // P3b: Ana, Full, answers in the card: her words are the thread's next turn, and show in it
  assert.equal(await visible(A, '#pinCard #pinText'), true, "Ana's card has a box to write in");
  assert.equal(await visible(A, '#pinCard #pinSend'), true, "Ana's card has Send");
  await A.ev("document.getElementById('pinText').focus()");
  await A.send('Input.insertText', { text: 'Thanks, that works.' });
  await A.click('#pinSend');
  await within(async () => (await threads(s)).find((x) => x.id === id)?.turns.at(-1)?.text === 'Thanks, that works.', "Ana's reply as the thread's last turn", async () => JSON.stringify((await threads(s)).find((x) => x.id === id)?.turns.map((u) => u.text)));
  await within(async () => (await cardTurns(A)).at(-1)?.text === 'Thanks, that works.', "Ana's reply in the card", async () => JSON.stringify(await cardTurns(A)));
  noExceptions(A, 'Ana');
});

test('canvas pins: a pin whose layer is deleted keeps its thread and shows at the top-left, marked "on a deleted layer" (DW2: P4)', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 280000 }, async (t) => {
  const s = await setup();
  const slug = 'pins-gone';
  const id = openPin(s, slug, 'n-side', 'Is this panel needed?');
  // n-side deleted before any page opens the canvas: the document replaced without it (the local
  // route answers 503 while no session is open)
  const doc = s.fake.doc(slug);
  delete doc.nodes['n-side'];
  for (const pg of doc.pages) pg.children = pg.children.filter((c) => c !== 'n-side');
  s.fake.replace(slug, doc);
  const A = await pageFor(t, s, s.ana);
  await load(A, slug);
  const gone = async (thread) => {
    const [b, st] = [await pinBox(A, thread), await boxOf(A, '#stage')];
    // marked both ways: in what it says aloud and in what it shows
    const { label, text } = await A.ev(`(() => { const e = document.querySelector(${JSON.stringify(pinSel(thread))}); return { label: e?.getAttribute('aria-label') ?? '', text: e?.textContent ?? '' }; })()`);
    return !!b && !!st && b.l - st.l < 60 && b.t - st.t < 160 && label.includes('on a deleted layer') && text.includes('on a deleted layer');
  };
  const why = async (thread) => JSON.stringify({ pin: await pinBox(A, thread), stage: await boxOf(A, '#stage'), label: await A.ev(`document.querySelector(${JSON.stringify(pinSel(thread))})?.getAttribute('aria-label') ?? null`).catch(() => null) });
  // P4a: deleted before the page loaded: at the stage's top-left, marked
  await within(() => gone(id), 'the pin at the top-left, marked "on a deleted layer"', () => why(id));
  // its thread is kept, open, and its card shows its turn
  assert.equal((await threads(s)).find((x) => x.id === id)?.status, 'open', 'the thread is still open');
  await A.click(pinSel(id));
  await within(async () => (await cardTurns(A)).some((u) => u.text === 'Is this panel needed?'), "the deleted layer's card with its turn", async () => JSON.stringify(await cardTurns(A)));
  // P4b: deleted while shown: the pin on n-foot moves to the top-left
  const id2 = openPin(s, slug, 'n-foot', 'Shorter footer?');
  await within(() => pinOnCorner(A, id2, 'n-foot'), "the pin on n-foot's corner", () => show(A, id2, 'n-foot'));
  await apply(s, slug, [{ op: 'del', id: 'n-foot' }]);
  await within(() => gone(id2), "n-foot's pin at the top-left once n-foot is deleted", () => why(id2), 5000);
  noExceptions(A, 'Ana');
});

test('canvas pins: a View person sees pins and their threads, with no Comment tool and no reply box (DW2: P5)', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 280000 }, async (t) => {
  const s = await setup();
  const slug = 'pins-view';
  const id = openPin(s, slug, 'n-card', 'Bigger title?');
  s.F.sup(['thread', 'reply', id, 'Done.']);
  const V = await pageFor(t, s, s.vic);
  await load(V, slug);
  // P5a: Vic sees the pin and its thread's turns
  await within(() => pinOnCorner(V, id, 'n-card'), "Vic's pin on n-card's corner", () => show(V, id, 'n-card'));
  await V.click(pinSel(id));
  await within(async () => JSON.stringify((await cardTurns(V)).map((u) => u.text)) === JSON.stringify(['Bigger title?', 'Done.']), "Vic's card with both turns", async () => JSON.stringify(await cardTurns(V)));
  // P5b: once the page knows Vic is View: no Comment tool, no box to write in, no Send
  await within(async () => (await V.ev('document.body.dataset.level ?? null')) === 'view', "Vic's page knows Vic is View (data-level)", async () => `data-level ${await V.ev('document.body.dataset.level ?? null')}`);
  assert.equal(await visible(V, '#pinTool'), false, 'no Comment tool for a View person');
  assert.equal(await visible(V, '#pinCard #pinText'), false, 'no box to write in');
  assert.equal(await visible(V, '#pinCard #pinSend'), false, 'no Send');
  // the key does nothing either: C, then a click on a layer opens no new pin
  await V.key('c');
  await V.click('#surface [data-id="n-side"]');
  await sleep(300);
  assert.equal(await V.ev("!!document.querySelector('#pinCard[data-thread=\"new\"]')"), false, 'no new pin from the key');
  // and Ana, Full, on the same canvas has the tool (the control)
  const A = await pageFor(t, s, s.ana);
  await load(A, slug);
  await within(() => visible(A, '#pinTool'), "Ana's Comment tool on the same canvas");
  // P5c: and for Ana, C then a click on a layer opens a new pin's card with a box to write in
  await A.key('c');
  await A.click('#surface [data-id="n-side"]');
  await within(() => visible(A, '#pinCard[data-thread="new"] #pinText'), "Ana's draft on n-side from the key");
  noExceptions(V, 'Vic');
  noExceptions(A, 'Ana');
});

test('canvas pins: at 390 px the Comment tool covers none of the stage\'s own controls (N1)', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 280000 }, async (t) => {
  const s = await setup();
  const A = await pageFor(t, s, s.ana);
  await A.size(390, 844);
  await load(A, NARROW);
  await within(() => visible(A, '#pinTool'), "Ana's Comment tool at 390");
  // every shown control of the stage's own (the page select, the notes, the zoom) clear of the bar
  const hits = await A.ev(`(() => {
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const bar = box(document.getElementById('pinBar'));
    const meet = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    return [...document.querySelectorAll('.stage-top > *, .zoom')].filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')
      .filter((e) => meet(box(e), bar)).map((e) => e.id || e.className);
  })()`);
  assert.deepEqual(hits, [], 'no stage control under the Comment bar');
  assert.equal(await visible(A, '#capNote'), true, 'the cap note shows, so the check means something');
  noExceptions(A, 'Ana');
});

test('canvas pins: Escape in a pin\'s card closes it and leaves the selection alone (N2)', { skip: canDrive ? false : 'needs Chrome and WebSocket', timeout: 280000 }, async (t) => {
  const s = await setup();
  const slug = 'pins-place';
  const A = await pageFor(t, s, s.ana);
  await load(A, slug);
  await within(() => visible(A, '#pinTool'), "Ana's Comment tool");
  const selected = (id) => A.ev(`document.querySelector('#layers .layer[data-node=${JSON.stringify(id)}]')?.getAttribute('aria-selected') ?? null`);
  // n-card selected with Move, then a draft card on n-side from the Comment tool
  await A.click('#surface [data-id="n-card"]');
  await within(async () => (await selected('n-card')) === 'true', 'n-card selected');
  await A.key('c');
  await A.click('#surface [data-id="n-side"]');
  await within(() => visible(A, '#pinCard[data-thread="new"] #pinText'), "Ana's draft on n-side");
  assert.equal(await selected('n-card'), 'true', 'n-card still selected with the card open');
  await A.ev("document.getElementById('pinText').focus()");
  await A.key('Escape');
  await within(async () => !(await visible(A, '#pinCard')), 'the card closed by Escape');
  assert.equal(await selected('n-card'), 'true', "Escape in the card's box leaves n-card selected");
  noExceptions(A, 'Ana');
});
