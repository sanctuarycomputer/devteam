// The side panel's Supervisor and Shell tabs (kit-614; terminal@1, test/contracts/terminal.md): headless Chrome
// on a real dashboard of a project of its own (threadsFixture), its /api/term/* routes answered by the contract's
// fake (test/fixtures/term-fake.mjs). One origin serves both: a small front server here sends /api/term/* to the
// fake and everything else to the dashboard, logs every terminal request, and can slow or rewrite an answer, or
// drop a header, as a test asks. Skipped where Chrome can't be driven, as the kit's other Chrome tests are.
import { test, after } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { threadsFixture, dashboardOnFreePort } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { measureAt } from './lib/measure.mjs';
import { startTermFake } from './fixtures/term-fake.mjs';

const XTERM = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js';
// The panel open and done sliding; the measure's options as dashboard-measure.test.mjs gives them for the panel
// (THREADS_OPTS: the panel is an overlay the page's own checks leave out; its own text is judged)
const PANEL_AT_REST = "document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The front: one origin for the page (the dashboard's) and the terminal routes (the fake's). Host and Origin are
// rewritten to the server each request goes to, so the fake's own guards see a same-origin request; Sec-Fetch-Site
// is passed as the browser sent it (or dropped, with hooks.noFetchSite). log: every /api/term/* request with its
// start and end times and its body; hooks.delay(path) holds an answer that many ms; hooks.rewrite(path, json) changes
// a JSON answer; hooks.answer(path) gives { status, json, ms? } to answer in the fake's place (held ms first). /__hub (on localhost, another origin) is a page that frames the dashboard, as the hub does.
async function front(dashPort, fake) {
  const log = [];
  const hooks = { delay: () => 0, rewrite: null, noFetchSite: false, answer: () => null };
  let port = 0;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__hub') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(`<!doctype html><iframe id="f" src="http://127.0.0.1:${port}/${decodeURIComponent(u.searchParams.get('h') || '')}" style="width:1400px;height:860px;border:0"></iframe>`);
    }
    const term = u.pathname.startsWith('/api/term/');
    const to = term ? fake.port : dashPort;
    const headers = { ...req.headers, host: `127.0.0.1:${to}` };
    if (headers.origin === `http://127.0.0.1:${port}`) headers.origin = `http://127.0.0.1:${to}`;
    if (term && hooks.noFetchSite) delete headers['sec-fetch-site'];
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const entry = term ? { method: req.method, path: u.pathname, start: Date.now(), end: null, status: null, body: body.length ? body.toString('utf8') : null } : null;
      if (entry) log.push(entry);
      const own = term ? hooks.answer(u.pathname) : null;
      if (own?.ms) await sleep(own.ms);
      if (own) { entry.end = Date.now(); entry.status = own.status; res.writeHead(own.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify(own.json)); }
      const up = http.request({ host: '127.0.0.1', port: to, path: req.url, method: req.method, headers }, async (r) => {
        const got = [];
        r.on('data', (c) => got.push(c));
        r.on('end', async () => {
          let out = Buffer.concat(got);
          const h = { ...r.headers };
          delete h['content-length'];
          delete h['transfer-encoding'];
          // the page's own policy lets only itself and the machine's hub frame it: the test's hub is neither
          if (!term && h['content-security-policy']) h['content-security-policy'] = String(h['content-security-policy']).replace(/frame-ancestors[^;]*/, `frame-ancestors 'self' http://localhost:${port}`);
          if (term && hooks.rewrite && /json/.test(h['content-type'] || '') && out.length) {
            try { out = Buffer.from(JSON.stringify(hooks.rewrite(u.pathname, JSON.parse(out.toString('utf8'))))); } catch {}
          }
          const wait = term ? hooks.delay(u.pathname) : 0;
          if (wait) await sleep(wait);
          if (entry) { entry.end = Date.now(); entry.status = r.statusCode; }
          res.writeHead(r.statusCode, h);
          res.end(out);
        });
      });
      up.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end(); } });
      up.end(body);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  return { port, url: `http://127.0.0.1:${port}`, log, hooks, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); }) };
}

// A wait on a condition in the page: an evaluation that throws is "not yet".
const soonIn = (p, ms = 20000) => async (expr, what) => {
  const end = Date.now() + ms;
  let err = null;
  for (;;) {
    let v;
    try { v = await p.ev(expr); err = null; } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? `; last: ${err.message}` : ''}`);
    await sleep(50);
  }
};

// One fixture's dashboard and one Chrome for the file (each test reads only; a test's own front is its own origin,
// so its storage is its own); each test gets its own fake, front and tab.
let shared = null;
const base = () => (shared ??= (async () => {
  const F = threadsFixture('term');
  // two threads for the router's checks: one shown in the panel (no subject), one on its subject's page (a goal)
  F.owner(['thread', 'new', 'Where do we start?']);
  F.owner(['thread', 'new', 'About this goal', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  const chrome = await openChrome();
  return { F, dash, port, chrome };
})());
after(async () => { if (!shared) return; const s = await shared; await s.chrome.close(); await s.dash.stop(); s.F.done(); });

// The fake, the front, and a Chrome tab at 1440x900 on hash (or a path), its page and threads read, and an open
// panel done sliding (a click on a moving panel misses).
async function open(t, { fake: fo = {}, hash = '#overview', path = '/', setup = null, size = [1440, 900], ready = true } = {}) {
  const later = cleanup(t);
  const { port, chrome } = await base();
  const fake = await startTermFake(fo);
  later(() => fake.close());
  const fr = await front(port, fake);
  later(() => fr.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Network.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
  // a port the OS gives out again is the same origin: a last test's remembered panel (thRemember) or Wide would carry over
  await p.send('Storage.clearDataForOrigin', { origin: new URL(fr.url).origin, storageTypes: 'local_storage' });
  if (setup) await setup(p, fr, fake);
  await p.send('Page.navigate', { url: `${fr.url}${path}${hash}` });
  const soon = soonIn(p);
  if (ready) await soon('document.readyState === "complete" && typeof DATA === "object" && DATA !== null && TL.have > 0', 'the page and its threads read');
  if (ready && /[?&]th=/.test(hash)) await soon(PANEL_AT_REST, 'the panel open and at rest');
  const term = (re) => fr.log.filter((e) => re.test(e.path));
  const posts = (w = 'supervisor') => fr.log.filter((e) => e.method === 'POST' && e.path === `/api/term/${w}/keys`).map((e) => JSON.parse(e.body));
  return { p, fake, fr, soon, term, posts, url: fr.url };
}
// The tab's screen focused (a click in it), so keys go to xterm.
async function focusScreen(R, w = 'supervisor') {
  await R.soon(`!!document.querySelector('.term-box[data-term="${w}"] .xterm-helper-textarea')`, 'xterm drawn');
  await R.p.click(`.term-box[data-term="${w}"] .term-screen`);
  await R.soon(`document.activeElement?.classList.contains('xterm-helper-textarea')`, 'the screen focused');
}
const screenText = (w = 'supervisor') => `[...document.querySelectorAll('.term-box[data-term="${w}"] .xterm-rows > div')].map((d) => d.textContent).join('\\n')`;
// A paste into the focused screen, as the browser fires it.
const pasteIn = (text) => `(() => { const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(text)}); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`;
const hex = (s) => Buffer.from(s, 'latin1').toString('hex');
// ArrowUp, as a keyboard sends it (chrome.mjs's key() knows only a few named keys)
const arrowUp = async (p) => { for (const type of ['rawKeyDown', 'keyUp']) await p.send('Input.dispatchKeyEvent', { type, key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 }); };

// The router (dashboard-shell@3, th): th=supervisor and th=shell exclude t and u; opening a thread from a terminal tab
// gives th=open. The fixture's own threads: one shown in the panel, one on its subject's page.
const threadIds = (R) => R.p.ev(`(() => { const open = TL.threads.filter((t) => t.status === 'open'); const inPanel = open.find((t) => tlInPanel(t)); const onPage = open.find((t) => !tlInPanel(t) && !tlInboxHome(t) && t.subject?.kind !== 'artifact' && t.subject?.kind !== 'preview'); return { inPanel: inPanel?.id ?? null, onPage: onPage?.id ?? null }; })()`);
test('terminal routing: th=supervisor and th=shell drop t and u from the address (dashboard-shell@3)', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R0 = await open(t, { hash: '#overview' });
  const { inPanel } = await threadIds(R0);
  assert.ok(inPanel, 'the fixture has a thread shown in the panel');
  for (const w of ['supervisor', 'shell']) {
    const R = await open(t, { hash: `#overview?th=${w}&t=${inPanel}&u=u-20261101-000000000-owner` });
    await R.soon(`location.hash.includes('th=${w}') && !/[?&][tu]=/.test(location.hash)`, `th=${w}: t and u dropped, th kept (${w})`);
  }
});

test('terminal routing: a thread opened from a terminal tab opens on Threads (th=open), never beside th=supervisor', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  const { inPanel, onPage } = await threadIds(R);
  assert.ok(inPanel && onPage, `the fixture has a thread in the panel and one on its subject's page: ${inPanel}, ${onPage}`);
  for (const id of [inPanel, onPage]) {
    await R.p.ev(`thGo({ th: 'supervisor' }); true`);
    await R.soon(`TH.th === 'supervisor'`, 'back on Supervisor');
    // a thread's link, as a card or a mention gives it (#talk/<id>, the router's tlRoute)
    await R.p.ev(`location.hash = ${JSON.stringify(`#talk/${id}`)}; true`);
    await R.soon(`TH.th === 'open' && TH.t === ${JSON.stringify(id)}`, `${id === inPanel ? 'in the panel' : "on its subject's page"}: th=open with t (${id})`);
  }
});

test("terminal A11: th=supervisor draws the fake's screen with xterm.js, loaded with its integrity hash only on the first open", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { fake: { lines: ['hello from the fake', '\x1b[32mgreen\x1b[0m line'] } });
  // not loaded before a terminal tab is open
  assert.equal(await R.p.ev(`performance.getEntriesByType('resource').filter((e) => e.name.includes('@xterm/xterm')).length + document.querySelectorAll('script[src*="@xterm/xterm"]').length`), 0, 'xterm.js is not asked for before a terminal tab opens');
  await R.p.ev(`location.hash = '#overview?th=supervisor'`);
  await R.soon(`${screenText()}.includes('hello from the fake')`, "the fake's screen drawn by xterm");
  assert.ok(await R.p.ev(`${screenText()}.includes('green line')`), 'an SGR line drawn as its text');
  const s = await R.p.ev(`(() => { const e = document.querySelector('script[src="${XTERM}"]'); return e && { integrity: e.integrity, cross: e.crossOrigin }; })()`);
  assert.ok(s, 'xterm.js is loaded from jsdelivr at 5.5.0');
  assert.match(s.integrity, /^sha384-[A-Za-z0-9+/]{64}$/, 'with an integrity hash');
  assert.equal(s.cross, 'anonymous');
  assert.equal(await R.p.ev(`document.querySelector('#th-tabs [data-tab="supervisor"]').getAttribute('aria-selected')`), 'true', 'the Supervisor tab is selected');
  assert.equal(await R.p.ev(`document.querySelector('#th-tabs [data-tab="supervisor"]').hasAttribute('aria-disabled')`), false, 'and enabled');
});

test("terminal A11: typing 'echo hi' and Enter posts the bytes, in order, and the echo shows", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  await focusScreen(R);
  await R.p.type('echo hi');
  await R.p.key('Enter');
  await R.soon(`${screenText()}.includes('echo hi')`, 'the echo on the screen');
  const typed = R.fake.typed('supervisor').join('');
  assert.equal(typed, 'echo hi\r', 'exactly the keys, in order, once each');
  const ps = R.posts();
  assert.ok(ps.every((b, i) => b.seq === i + 1 && b.which === 'supervisor' && b.pane === '%1' && /^[A-Za-z0-9_-]{16,64}$/.test(b.page)), `seq counts up from 1 with the pane and page: ${JSON.stringify(ps)}`);
});

test('terminal A11: at most one key post is in flight; queued keys merge up to 4096 bytes; a failed post is not retried', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor', fake: { sendMs: 400 } });
  await focusScreen(R);
  await R.p.type('abcd');
  await sleep(2000);
  const ks = R.term(/\/keys$/);
  // never two at once: each post starts after the one before has been answered
  for (let i = 1; i < ks.length; i++) assert.ok(ks[i].start >= ks[i - 1].end, `post ${i + 1} started before post ${i} was answered`);
  assert.equal(R.fake.typed('supervisor').join(''), 'abcd');
  assert.ok(ks.length < 4, `the keys queued behind the first were merged: ${ks.length} posts`);
  // 5000 bytes typed at once while a post is in flight: merged into posts of at most 4096 bytes
  await R.p.type('x');
  await R.p.send('Input.insertText', { text: 'y'.repeat(5000) });
  await sleep(3000);
  const sizes = R.posts().map((b) => (b.data ? b.data.length / 2 : 0));
  assert.ok(sizes.every((n) => n <= 4096), `no post over 4096 bytes: ${sizes}`);
  assert.equal(R.fake.typed('supervisor').join(''), `abcdx${'y'.repeat(5000)}`, 'every byte once, in order');
  // a failure: the fake's supervisor busy (503); one post, its error shown, the queue dropped, nothing resent
  R.fake.set({ busy: true, sendMs: 0 });
  const before = R.posts().length;
  await R.p.type('q');
  await R.soon(`/busy/.test(document.querySelector('.term-box[data-term="supervisor"] .term-hint').textContent)`, 'the busy words');
  await sleep(1500);
  assert.equal(R.posts().length, before + 1, 'the refused post is sent once and never retried');
  R.fake.set({ busy: false });
  await R.p.type('s');
  for (const end = Date.now() + 20000; !R.fake.typed('supervisor').join('').endsWith('s'); await sleep(100)) if (Date.now() > end) assert.fail('timed out: a post taken again');
  const seqs = R.posts().map((b) => b.seq);
  assert.ok(seqs.every((q, i) => i === 0 || q === seqs[i - 1] + 1), `seq counts up by one and a refused one is never reused: ${seqs}`);
  assert.equal(new Set(R.posts().map((b) => b.page)).size, 1, 'one page id for every post of a page load');
  // a 423 (the pane moved): the screen read again at once, not at the next poll
  R.fr.hooks.delay = (p) => (p.endsWith('/screen') ? 400 : 0);
  await sleep(3500);
  R.fr.hooks.answer = (path) => (path.endsWith('/keys') ? { status: 423, json: { error: 'the pane moved' } } : null);
  await R.p.type('m');
  await R.soon(`/pane moved/i.test(document.querySelector('.term-box[data-term="supervisor"] .term-hint').textContent)`, 'a 423: its words');
  const posted = R.term(/\/keys$/).at(-1).end;
  const after = () => R.term(/\/supervisor\/screen$/).find((e) => e.start >= posted);
  for (const end = Date.now() + 3000; !after() && Date.now() < end; ) await sleep(50);
  const next = after();
  // a read out when the 423 came (400 ms each here) is followed by a new one as soon as it ends
  assert.ok(next && next.start - posted < 700, `a 423 reads the screen at once (${next ? next.start - posted : 'none'} ms after; the poll was 2 s)`);
  R.fr.hooks.answer = () => null;
  R.fr.hooks.delay = () => 0;
  // a 500 carrying an exception's text: fixed words, the text never shown
  R.fake.set({ busy: false });
  R.fr.hooks.answer = (path) => (path.endsWith('/keys') ? { status: 500, json: { error: 'EACCES: permission denied, open /home/owner/.devteam/secret' } } : null);
  await R.p.type('r');
  await R.soon(`document.querySelector('.term-box[data-term="supervisor"] .term-hint').textContent.includes('had a problem')`, 'a 500: fixed words');
  assert.ok(!(await R.p.ev(`document.querySelector('.term-box[data-term="supervisor"]').textContent.includes('EACCES')`)), "a 500's own text is never shown");
});

test('terminal A11: a failed read shows its words until a read succeeds again, and failed reads back off', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  const hint = `document.querySelector('.term-box[data-term="supervisor"] .term-hint').textContent`;
  await R.soon(`!!document.querySelector('.term-box[data-term="supervisor"] .xterm')`, 'drawn');
  const reads = () => R.term(/\/supervisor\/screen$/).length;
  R.fr.hooks.answer = (p) => (p.endsWith('/screen') ? { status: 502, json: {} } : null);
  await R.soon(`/couldn't be read just now/.test(${hint})`, 'a failed read: its words');
  const a = reads();
  await sleep(3000);
  assert.ok(reads() - a <= 8, `failed reads back off: ${reads() - a} reads in 3 s`);
  R.fr.hooks.answer = () => null;
  R.fake.set({ lines: ['back again'] });
  await R.soon(`${screenText()}.includes('back again')`, 'a good read draws');
  await R.soon(`!/couldn't be read|didn't answer/.test(${hint}) && /Click the screen to type/.test(${hint})`, "a good read takes the read's words away");
});

test('terminal A11: the screen polls only while the document is visible and its box is seen', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  const reads = () => R.term(/\/supervisor\/screen$/).length;
  const polling = async (what) => { const a = reads(); await sleep(800); assert.ok(reads() - a >= 3, `${what}: polling (${reads() - a} reads in 800 ms)`); };
  const still = async (what) => { await sleep(400); const a = reads(); await sleep(1200); assert.equal(reads() - a, 0, `${what}: no reads`); };
  await R.soon(`!!document.querySelector('.term-box[data-term="supervisor"] .xterm')`, 'drawn');
  await polling('the tab shown');
  // the document hidden
  await R.p.ev(`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); true`);
  await still('the document hidden');
  await R.p.ev(`delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); true`);
  await polling('visible again');
  // the box off screen: the IntersectionObserver no longer sees it
  await R.p.ev(`document.querySelector('.term-box[data-term="supervisor"]').style.cssText = 'position: fixed; left: -5000px; top: 0; width: 300px; height: 300px'; true`);
  await still('the box off screen');
  await R.p.ev(`document.querySelector('.term-box[data-term="supervisor"]').style.cssText = ''; true`);
  await polling('the box back');
});

const pollRig = (R) => {
  const reads = () => R.term(/\/supervisor\/screen$/).length;
  return {
    polling: async (what) => { const a = reads(); await sleep(800); assert.ok(reads() - a >= 3, `${what}: polling (${reads() - a} reads in 800 ms)`); },
    still: async (what) => { await sleep(400); const a = reads(); await sleep(1200); assert.equal(reads() - a, 0, `${what}: no reads`); },
  };
};
test('terminal A11: the poll stops when the panel closes', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  const { polling, still } = pollRig(R);
  await R.soon(`!!document.querySelector('.term-box[data-term="supervisor"] .xterm')`, 'drawn');
  await polling('the tab shown');
  await R.p.click('#th-close');
  await still('the panel closed');
});
test('terminal A11: the poll stops when another tab is chosen', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  const reads = () => R.term(/\/supervisor\/screen$/).length;
  const polling = async (what) => { const a = reads(); await sleep(800); assert.ok(reads() - a >= 3, `${what}: polling (${reads() - a} reads in 800 ms)`); };
  const still = async (what) => { await sleep(400); const a = reads(); await sleep(1200); assert.equal(reads() - a, 0, `${what}: no reads`); };
  await R.soon(`!!document.querySelector('.term-box[data-term="supervisor"] .xterm')`, 'drawn');
  await polling('the tab shown');
  // another tab
  await R.p.click('#th-tabs [data-tab="threads"]');
  await still('the Threads tab chosen');
  await R.p.click('#th-tabs [data-tab="supervisor"]');
  await polling('Supervisor again');
});

test("terminal A11: in the hub's frame, hub-visible false stops the poll and true starts it again; before a hub-base it is ignored", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { ready: false, hash: '' });
  const reads = () => R.term(/\/supervisor\/screen$/).length;
  const port = R.fr.port;
  await R.p.send('Page.navigate', { url: `http://localhost:${port}/__hub?h=${encodeURIComponent('#overview?th=supervisor')}` });
  await R.soon(`(() => { try { return document.getElementById('f').contentWindow.length >= 0; } catch { return false; } })()`, 'the hub page');
  const until = async (f, what) => { const end = Date.now() + 20000; while (!f()) { if (Date.now() > end) assert.fail(what); await sleep(100); } };
  await until(() => reads() >= 3, 'the framed tab polls');
  const post = (v) => R.p.ev(`document.getElementById('f').contentWindow.postMessage({ devteam: 'hub-visible', visible: ${v} }, 'http://127.0.0.1:${port}'); true`);
  // before any hub-base (dashboard-shell@3): ignored, the tab keeps polling
  await post(false);
  await sleep(500);
  const b0 = reads();
  await sleep(1200);
  assert.ok(reads() - b0 >= 3, `hub-visible before a hub-base is ignored (${reads() - b0} reads)`);
  // a hub-base whose base isn't an http(s) address without credentials, of at most 2048 characters (@3): no origin kept
  for (const [what, base] of [['javascript:', 'javascript:alert(1)'], ['credentials', `http://u:p@localhost:${port}/#proj/`], ['2049 characters', `http://localhost:${port}/#${'a'.repeat(2049 - `http://localhost:${port}/#`.length)}`]]) {
    await R.p.ev(`document.getElementById('f').contentWindow.postMessage({ devteam: 'hub-base', base: ${JSON.stringify(base)} }, 'http://127.0.0.1:${port}'); true`);
    await sleep(200);
    await post(false);
    await sleep(500);
    const b = reads();
    await sleep(1200);
    assert.ok(reads() - b >= 3, `a hub-base with a bad base (${what}) keeps no origin: hub-visible still ignored (${reads() - b} reads)`);
  }
  // the hub's base, as the hub sends it on the frame's load (laptop form)
  await R.p.ev(`document.getElementById('f').contentWindow.postMessage({ devteam: 'hub-base', base: 'http://localhost:${port}/#proj/' }, 'http://127.0.0.1:${port}'); true`);
  await sleep(200);
  await post(false);
  await sleep(500);
  const a = reads();
  await sleep(1200);
  assert.equal(reads() - a, 0, 'no reads after hub-visible false');
  await post(true);
  await until(() => reads() - a >= 3, 'polling again after hub-visible true');
});

test('terminal A11: a screen line carrying a query (DSR, a focus-report mode, an 8-bit CSI) types nothing back', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor', fake: { lines: ['ask \x1b[6n me', '\x1b[?1004h\x1b[c\u009b6n done'] } });
  await focusScreen(R);
  await R.soon(`${screenText()}.includes('done')`, 'drawn');
  await sleep(1500);
  assert.equal(R.posts().length, 0, 'no post without a key press');
});

test("terminal A11b: a multi-line paste asks 'Paste N lines?'; confirmed, one paste post; cancelled, nothing", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  await focusScreen(R);
  await R.p.ev(pasteIn('one\ntwo\nthree'));
  await R.soon(`document.querySelector('.term-box[data-term="supervisor"] .term-ask:not([hidden])')?.textContent.includes('Paste 3 lines?')`, 'the question');
  assert.equal(R.posts().length, 0, 'nothing sent while it asks');
  await R.p.click('.term-box[data-term="supervisor"] [data-term-paste="no"]');
  await sleep(800);
  assert.equal(R.posts().length, 0, 'cancelled: nothing sent');
  await R.p.ev(pasteIn('one\ntwo\nthree'));
  await R.soon(`!!document.querySelector('.term-box[data-term="supervisor"] .term-ask:not([hidden])')`, 'asked again');
  await R.p.click('.term-box[data-term="supervisor"] [data-term-paste="yes"]');
  await sleep(800);
  const ps = R.posts();
  assert.equal(ps.length, 1, 'confirmed: one post');
  assert.deepEqual(Object.keys(ps[0]).sort(), ['page', 'pane', 'paste', 'seq', 'token', 'which'], 'a paste post, not keys');
  assert.equal(ps[0].paste, 'one\ntwo\nthree', 'the text whole');
  // a one-line paste goes without asking; its bracket markers are left to the server to drop (kit-612 F1)
  await R.p.ev(pasteIn('a\x1b[201~b'));
  await sleep(800);
  assert.equal(R.posts().length, 2, 'a one-line paste is sent without a question');
  assert.equal(R.posts()[1].paste, 'a\x1b[201~b', 'as it was pasted: the server drops bracket markers (terminal@1 §8)');
  // the cap counts UTF-8 bytes: 60,000 characters of é are 120,000 bytes
  await R.p.ev(pasteIn('é'.repeat(60000)));
  await R.soon(`/too large/.test(document.querySelector('.term-box[data-term="supervisor"] .term-hint').textContent)`, 'too large in bytes');
  assert.equal(R.posts().length, 2, 'nothing of it sent: the cap is in bytes');
  // too large for one post: refused here, whole
  await R.p.ev(pasteIn('"'.repeat(60000)));
  await R.soon(`/too large/.test(document.querySelector('.term-box[data-term="supervisor"] .term-hint').textContent)`, 'too large');
  assert.equal(R.posts().length, 2, 'nothing of it sent');
  // keys never merge into a queued paste, nor a paste into keys: a key in flight, a paste and a key behind it
  R.fake.set({ sendMs: 600 });
  await R.p.type('k');
  await sleep(100);
  await R.p.ev(pasteIn('p1'));
  await R.p.type('q');
  for (const end = Date.now() + 10000; R.posts().length < 5 && Date.now() < end; ) await sleep(100);
  R.fake.set({ sendMs: 0 });
  const tail = R.posts().slice(2).map((b) => (b.paste !== undefined ? `paste:${b.paste}` : `data:${Buffer.from(b.data, 'hex')}`));
  assert.deepEqual(tail, ['data:k', 'paste:p1', 'data:q'], 'three posts, in order, a paste never merged with keys');
});

test("terminal A12: th=shell posts shell/open once and draws the shell; an ended shell shows 'The shell ended.' with Open a new shell", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=shell', fake: { shell: false, lines: ['SUPERVISOR-PANE-ONLY'] } });
  await R.soon(`!!document.querySelector('.term-box[data-term="shell"] .xterm')`, 'the shell drawn');
  await sleep(400);
  assert.ok(!(await R.p.ev(`${screenText('shell')}.includes('SUPERVISOR-PANE-ONLY')`)), "the Shell tab draws the shell's screen, never the supervisor's");
  await focusScreen(R, 'shell');
  await R.p.type('ls');
  await R.soon(`${screenText('shell')}.includes('ls')`, 'typed into the shell');
  assert.deepEqual(R.fake.typed('supervisor'), [], "nothing typed into the supervisor's pane");
  // another tab and back: no second open
  await R.p.click('#th-tabs [data-tab="supervisor"]');
  await R.p.click('#th-tabs [data-tab="shell"]');
  await sleep(600);
  const opens = R.term(/\/shell\/open$/);
  assert.equal(opens.length, 1, 'shell/open posted once');
  const b = JSON.parse(opens[0].body);
  assert.ok(b.which === 'shell' && b.cols >= 20 && b.cols <= 500 && b.rows >= 5 && b.rows <= 200, `the panel's size: ${opens[0].body}`);
  // the shell exits
  R.fake.set({ shell: false });
  await R.soon(`document.querySelector('.term-box[data-term="shell"] .term-state:not([hidden])')?.textContent.includes('The shell ended.')`, 'The shell ended.');
  // a read of the ended shell still out when Open a new shell is pressed: its gone answer, held 1.5 s, comes after the
  // new shell's screen and is dropped (final-1b 1b-1)
  const before = R.term(/\/shell\/screen$/).length;
  let once = true;
  R.fr.hooks.answer = (p) => (p.endsWith('/shell/screen') && once ? ((once = false), { status: 200, ms: 1500, json: { v: 1, which: 'shell', state: 'gone', pane: null, cols: 0, rows: 0, lines: [], cursor: { x: 0, y: 0, visible: false }, modes: { app_cursor: false, app_keypad: false }, history_size: 0, held: { count: 0, oldest_ms: 0, prompt: 'readable' }, etag: 'stale' } }) : null);
  for (const end = Date.now() + 8000; R.term(/\/shell\/screen$/).length === before; await sleep(50)) if (Date.now() > end) assert.fail('timed out: a read of the ended shell out');
  await R.p.click('.term-box[data-term="shell"] [data-term-newshell]');
  await R.soon(`!!document.querySelector('.term-box[data-term="shell"] .term-state[hidden]')`, 'a new shell drawn');
  assert.equal(R.term(/\/shell\/open$/).length, 2, 'Open a new shell posts shell/open again');
  await sleep(2000);
  R.fr.hooks.answer = () => null;
  assert.ok(await R.p.ev(`document.querySelector('.term-box[data-term="shell"] .term-state').hidden`), "a read from before the new shell's open is dropped: no 'The shell ended.' on the new shell");
});

test("terminal A13: state gone shows 'The supervisor isn't running.' with the recover command and polls every 5 s", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor', fake: { supervisor: 'gone' } });
  const st = `document.querySelector('.term-box[data-term="supervisor"] .term-state:not([hidden])')`;
  await R.soon(`${st}?.textContent.includes("The supervisor isn't running.")`, 'the words');
  assert.ok(await R.p.ev(`${st}.querySelector('code').textContent === 'node docs/devteam/scripts/devteam.mjs recover'`), 'the recover command');
  assert.equal(await R.p.ev(`!!${st}.querySelector('[data-term-terminal]')`), false, 'no Terminal page link on a laptop');
  const at = R.term(/\/supervisor\/screen$/).length;
  await sleep(6000);
  const n = R.term(/\/supervisor\/screen$/).length - at;
  assert.ok(n >= 1 && n <= 2, `every 5 s while it is gone: ${n} reads in 6 s`);
  // on a box, the Terminal page's link: the same draw with this page's address as a box's
  const html = await R.p.ev(`(() => { const h = hostHere({ host: '4321.box.example', protocol: 'https:' }, null); return h && h.box; })()`);
  assert.equal(html, 'box.example');
  R.fake.set({ supervisor: 'live' });
  await R.soon(`!!document.querySelector('.term-box[data-term="supervisor"] .term-state[hidden]')`, 'back once it runs');
});

test('terminal A13: on a box the not-running state links the Terminal page', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor', fake: { supervisor: 'gone' } });
  await R.soon(`!!document.querySelector('.term-box[data-term="supervisor"] .term-state:not([hidden])')`, 'gone');
  // where the page is: a box's <port>.<name> (hostHere's own rule); the same draw then carries the link
  const href = await R.p.ev(`(() => { const real = window.hostHere; window.hostHere = () => ({ box: 'box.example' }); try { termPaint('supervisor'); return document.querySelector('.term-box[data-term="supervisor"] [data-term-terminal]')?.getAttribute('href'); } finally { window.hostHere = real; } })()`);
  assert.equal(href, 'http://box.example/#terminal');
});

test('terminal A13: with the xterm.js script blocked the tab shows the plain screen and sends no keys', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor', fake: { lines: ['plain \x1b[1mbold\x1b[0m'] }, setup: (p) => p.send('Network.setBlockedURLs', { urls: ['*@xterm/xterm*'] }) });
  const box = `document.querySelector('.term-box[data-term="supervisor"]')`;
  try { await R.soon(`${box}?.querySelector('.term-plain:not([hidden])')?.textContent.trimEnd() === 'plain bold'`, 'the plain screen'); } catch (e) { throw new Error(`${e.message}: ${await R.p.ev(`JSON.stringify({ lib: String(TERM.lib), html: ${box}?.innerHTML.slice(0, 900) })`).catch((x) => x.message)}`); }
  assert.match(await R.p.ev(`${box}.querySelector('.term-hint').textContent`), /typing is off/);
  await R.p.click('.term-box[data-term="supervisor"] .term-plain');
  await R.p.type('x');
  await R.p.key('Enter');
  await sleep(800);
  assert.equal(R.posts().length, 0, 'no keys sent');
});

for (const [why, words, how] of [
  ['not-loopback', "only work on this machine's own address", { fake: { refuse: 'not-loopback' } }],
  ['cross-site', "This browser can't use the terminal tabs", { noFetchSite: true }],
]) {
  test(`terminal A13: a ${why} refusal shows its note and stops asking`, { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
    const R = await open(t, { hash: '#overview?th=supervisor', fake: how.fake ?? {}, setup: (p, fr) => { if (how.noFetchSite) fr.hooks.noFetchSite = true; } });
    await R.soon(`document.querySelector('.term-box[data-term="supervisor"] .term-state:not([hidden])')?.textContent.includes(${JSON.stringify(words)})`, 'the note');
    await sleep(1500);
    const tokens = R.term(/\/token$/).length;
    assert.equal(tokens, why === 'cross-site' ? 2 : 1, `asked ${why === 'cross-site' ? 'twice' : 'once'}`);
    assert.equal(R.term(/\/screen$/).length, 0, 'and no screen read');
    assert.equal(await R.p.ev(`document.querySelector('.term-box[data-term="supervisor"] .term-state').textContent.includes(${JSON.stringify(why)})`), false, 'the code is never shown');
  });
}

test('terminal A13: the /view/ page keeps both slots disabled', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { path: '/view/artifact/nothing-here', hash: '', ready: false });
  await R.soon(`!!document.querySelector('#th-tabs [data-tab="shell"]') || (typeof thDraw === 'function' && (thGo({ th: 'open' }), false))`, 'the panel drawn');
  assert.deepEqual(await R.p.ev(`['supervisor', 'shell'].map((id) => document.querySelector('#th-tabs [data-tab="' + id + '"]').getAttribute('aria-disabled'))`), ['true', 'true']);
  assert.equal(R.term(/./).length, 0, 'the /view/ page asks nothing of the terminal routes');
});

test('terminal A13: a refused shell/open shows its words with Try again, which stays and opens the shell', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=shell', fake: { shell: false, openFails: true } });
  const again = `!!document.querySelector('.term-box[data-term="shell"] .term-state:not([hidden]) [data-term-newshell]')?.textContent.includes('Try again')`;
  await R.soon(again, 'the refusal with Try again');
  await sleep(1200);
  assert.ok(await R.p.ev(again), 'Try again stays: no read takes the refusal away');
  assert.equal(R.term(/\/shell\/screen$/).length, 0, 'a refused open reads no screen');
  R.fake.set({ openFails: false });
  await R.p.click('.term-box[data-term="shell"] [data-term-newshell]');
  await R.soon(`!!document.querySelector('.term-box[data-term="shell"] .xterm') && document.querySelector('.term-box[data-term="shell"] .term-state').hidden`, 'Try again opens the shell');
  assert.equal(R.term(/\/shell\/open$/).length, 2, 'Try again posts shell/open again');
});

test('terminal A13: held kit messages behind an open owner line show the waiting note', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  const hint = `document.querySelector('.term-box[data-term="supervisor"] .term-hint').textContent`;
  await focusScreen(R);
  // held lines alone (a question on the pane held them): no note
  R.fake.set({ held: { count: 2, oldest_ms: 130000, prompt: 'readable' } });
  await sleep(800);
  assert.doesNotMatch(await R.p.ev(hint), /waiting until/, 'the count alone never shows the note');
  await R.p.type('half a line');
  await R.soon(`/Messages for the supervisor are waiting until you send or clear your line\\./.test(${hint})`, 'the note, behind the open line');
  assert.doesNotMatch(await R.p.ev(hint), /Answer it here/, 'a readable prompt: no answer-it-here sentence');
  await R.p.key('Enter');
  await R.soon(`!/waiting until/.test(${hint})`, 'a line sent: no note');
  // a paste leaves the line open (it never submits); Ctrl+C ends it
  await R.p.ev(pasteIn('pasted'));
  await R.soon(`/waiting until/.test(${hint})`, 'a paste leaves the line open: the note');
  for (const type of ['keyDown', 'keyUp']) await R.p.send('Input.dispatchKeyEvent', { type, key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67 });
  await R.soon(`!/waiting until/.test(${hint})`, 'Ctrl+C ends the line: no note');
  // a post the server didn't take changes nothing
  R.fr.hooks.rewrite = (p, j) => (p.endsWith('/keys') ? { ...j, taken: false } : j);
  await R.p.type('z');
  await sleep(800);
  assert.doesNotMatch(await R.p.ev(hint), /waiting until/, 'a post not taken leaves the line as it was');
  R.fr.hooks.rewrite = null;
  // exactly 2 minutes is over the threshold
  R.fake.set({ held: { count: 1, oldest_ms: 120000, prompt: 'readable' } });
  await sleep(800);
  await R.p.type('y');
  await R.soon(`/waiting until/.test(${hint})`, 'held exactly 2 minutes: the note');
});

test('terminal A14: the font scales down to fit the columns, to a 9 px floor, then the screen scrolls sideways', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor', fake: { cols: 40, rows: 10, lines: ['x'.repeat(40)] } });
  const font = `termTab('supervisor').term?.options.fontSize`;
  const fits = `(() => { const w = document.querySelector('.term-box[data-term="supervisor"] .term-wrap'); return w.scrollWidth <= w.clientWidth; })()`;
  await R.soon(`${font} > 0`, 'drawn');
  assert.equal(await R.p.ev(font), 12, '40 columns fit at 12 px');
  R.fake.set({ cols: 52, lines: ['x'.repeat(52)] });
  await R.soon(`${font} < 12 && ${font} > 9`, 'scaled down');
  assert.ok(await R.p.ev(fits), 'and fits without scrolling');
  R.fake.set({ cols: 120, lines: ['x'.repeat(120)] });
  await R.soon(`${font} === 9`, 'the floor');
  assert.equal(await R.p.ev(fits), false, 'wider than the box');
  assert.match(await R.p.ev(`getComputedStyle(document.querySelector('.term-box[data-term="supervisor"] .term-wrap')).overflowX`), /^(auto|scroll)$/, 'the screen scrolls sideways, not clipped');
});

test('terminal A14: Wide widens the panel to half the window on a terminal tab, is remembered, and moves a side peek with it', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  const w = `document.getElementById('threads').getBoundingClientRect().width`;
  await R.soon(`!!document.getElementById('th-wide') && !document.getElementById('th-wide').hidden`, 'Wide shown');
  assert.equal(Math.round(await R.p.ev(w)), 380);
  await R.p.click('#th-wide');
  await R.soon(`Math.round(${w}) === 720`, 'half the 1440 px window');
  assert.equal(await R.p.ev(`localStorage.getItem('devteam.threads.wide')`), '1', 'remembered');
  assert.equal(await R.p.ev(`document.getElementById('th-wide').getAttribute('aria-pressed')`), 'true');
  // the page reads the panel's width back in pixels (a new card is placed left of it, never under it)
  assert.equal(Math.round(await R.p.ev(`thWidth()`)), 720, 'thWidth() is the wide panel in pixels');
  // pressed looks pressed: its inset line, which has no transition (the background eases over 0.12 s, and a hover
  // gives the same well), so one read is the settled look
  const look = `getComputedStyle(document.getElementById('th-wide')).boxShadow`;
  const pressed = await R.p.ev(look);
  const unpressed = await R.p.ev(`(() => { const b = document.getElementById('th-wide'); b.setAttribute('aria-pressed', 'false'); const v = ${look}; b.setAttribute('aria-pressed', 'true'); return v; })()`);
  assert.notEqual(pressed, unpressed, 'pressed looks pressed');
  // a side peek's right edge meets the panel's left edge
  await R.p.ev(`location.hash = '#file?path=docs%2Fdevteam%2Fgovernance%2Fquality.md'`);
  await R.soon(`document.body.classList.contains('peek-open') || document.querySelector('.shell.peek-open')`, 'a peek');
  await R.p.ev(`thGo({ th: 'supervisor' })`);
  await R.soon(`Math.round(document.querySelector('.drawer').getBoundingClientRect().right) === 720`, "the peek's right edge at the wide panel's left");
  // not on Threads: back to 380, Wide hidden
  await R.p.click('#th-tabs [data-tab="threads"]');
  await R.soon(`Math.round(${w}) === 380 && document.getElementById('th-wide').hidden`, 'Threads is the panel’s own width');
  // remembered across a reload
  await R.p.ev(`location.hash = '#overview?th=supervisor'; location.reload()`);
  await R.soon(`typeof TERM === 'object' && Math.round(${w}) === 720`, 'wide again after a reload');
});

test('terminal A14: Ctrl+] releases focus; Escape goes to the pane; the + button hides on terminal tabs', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  const plus = `getComputedStyle(document.querySelector('.threads-head [data-tl-new]')).display`;
  await focusScreen(R);
  assert.equal(await R.p.ev(plus), 'none', 'the + hidden on Supervisor');
  await R.p.key('Escape');
  await sleep(500);
  assert.equal(R.fake.typed('supervisor').join(''), '\x1b', 'Escape is typed into the pane');
  assert.equal(await R.p.ev(`document.body.classList.contains('threads-open') || !!document.querySelector('.shell.threads-open')`), true, 'and the panel stays open');
  await R.p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ']', code: 'BracketRight', modifiers: 2, windowsVirtualKeyCode: 221 });
  await R.p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ']', code: 'BracketRight', modifiers: 2, windowsVirtualKeyCode: 221 });
  await R.soon(`!document.activeElement?.classList.contains('xterm-helper-textarea')`, 'released');
  assert.equal(await R.p.ev(`document.activeElement?.dataset.tab`), 'supervisor', 'focus goes to the selected tab');
  await sleep(300);
  assert.equal(R.fake.typed('supervisor').join(''), '\x1b', 'Ctrl+] is not typed');
  assert.ok(await R.p.ev(`document.querySelector('.term-box[data-term="supervisor"] .term-hint').textContent.includes('to leave it')`), 'the hint says so');
  await R.p.click('#th-tabs [data-tab="threads"]');
  await R.soon(`${plus} !== 'none'`, 'the + back on Threads');
});

test('terminal measure: the measure check passes at 1440, 720 and 390 px with a terminal tab open', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor', fake: { lines: ['a line of the supervisor\'s screen, wider than half the grid would ever let running text be, as code is'] } });
  const o = { view: '#no-such-view', inbox: '#no-such-inbox', ignore: '.term-screen' };
  // each size is the same address, so a hash change, not a load: the page keeps easing its margin from the size
  // before (Wide's 720 px at 1440 down to 0 at 720), and is measured only once nothing is moving
  const settled = `!document.getAnimations().some((a) => a.playState === 'running')`;
  const res = await measureAt(R.p, `${R.url}/#overview?th=supervisor`, { ready: `${PANEL_AT_REST} && !!document.querySelector('.term-box[data-term="supervisor"] .xterm-rows') && ${settled}`, ...o });
  for (const [size, fails] of Object.entries(res)) assert.deepEqual(fails, [], `the screen, ${size}: ${fails.join('; ')}`);
  // the tab's running text at its widest: Wide on, the supervisor not running
  await R.p.ev(`localStorage.setItem('devteam.threads.wide', '1'); true`);
  R.fake.set({ supervisor: 'gone' });
  const gone = await measureAt(R.p, `${R.url}/#overview?th=supervisor`, { ready: `${PANEL_AT_REST} && !!document.querySelector('.term-box[data-term="supervisor"] .term-state:not([hidden]) code') && ${settled}`, ...o });
  for (const [size, fails] of Object.entries(gone)) assert.deepEqual(fails, [], `not running, Wide, ${size}: ${fails.join('; ')}`);
});

test("terminal A14b: the page asks GET /api/term/token once on load, before any tab is pressed; why view hides both tabs", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview' });
  await sleep(800);
  assert.equal(R.term(/\/token$/).length, 1, 'one token request on load');
  assert.equal(R.term(/\/screen$/).length, 0, 'and nothing else before a tab is pressed');
  for (const fo of [{ refuse: 'view' }, { gatewayView: true }]) {
    // the token's answer held 2 s: no terminal tab is ever drawn, before or after
    const V = await open(t, { hash: '#overview?th=open', fake: fo, setup: (p, fr) => { fr.hooks.delay = (path) => (path.endsWith('/token') ? 2000 : 0); } });
    await V.soon(`!!document.querySelector('#th-tabs [data-tab="threads"]')`, 'the bar drawn');
    assert.deepEqual(await V.p.ev(`[...document.querySelectorAll('#th-tabs [role="tab"]')].map((b) => b.dataset.tab)`), ['inbox', 'threads'], `${JSON.stringify(fo)}: no terminal tab while the token is asked`);
    await V.soon(`!!document.querySelector('#th-tabs [data-tab="threads"]') && TERM.why === 'view'`, 'refused');
    assert.deepEqual(await V.p.ev(`[...document.querySelectorAll('#th-tabs [role="tab"]')].map((b) => b.dataset.tab)`), ['inbox', 'threads'], `${JSON.stringify(fo)}: both terminal tabs hidden`);
  }
});

test('terminal A14b: held over 2 minutes on an unknown prompt adds the answer-it-here sentence; app_cursor makes ArrowUp ESC O A', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  const hint = `document.querySelector('.term-box[data-term="supervisor"] .term-hint').textContent`;
  await focusScreen(R);
  await R.p.type('x');
  R.fake.set({ held: { count: 1, oldest_ms: 119000, prompt: 'unknown' } });
  await sleep(800);
  assert.doesNotMatch(await R.p.ev(hint), /waiting until/, 'under 2 minutes: no note');
  R.fake.set({ held: { count: 1, oldest_ms: 121000, prompt: 'unknown' } });
  await R.soon(`/waiting until you send or clear your line\\. Answer it here to let them through\\./.test(${hint})`, 'the note with the answer-it-here sentence');
  // cursor keys: as the program asked
  await arrowUp(R.p);
  await sleep(400);
  assert.equal(R.posts().at(-1).data, hex('\x1b[A'), 'normal mode: ESC [ A');
  R.fr.hooks.rewrite = (p, j) => (p.endsWith('/screen') || p.endsWith('/keys') ? { ...j, modes: { app_cursor: true, app_keypad: false } } : j);
  // a new screen (a 304 has no body to rewrite)
  R.fake.set({ lines: ['a program in cursor-key mode'] });
  await R.soon(`${screenText()}.includes('cursor-key mode')`, 'the new screen');
  await arrowUp(R.p);
  await sleep(600);
  assert.equal(R.posts().at(-1).data, hex('\x1bOA'), 'app_cursor: ESC O A');
});

test('terminal A14b: a slow read backs off to 2 s and a fast one comes back', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { hash: '#overview?th=supervisor' });
  await R.soon(`!!document.querySelector('.term-box[data-term="supervisor"] .xterm')`, 'drawn');
  // back-off: reads held 400 ms each; the gap after each grows to 2 s
  const reads = () => R.term(/\/supervisor\/screen$/);
  R.fr.hooks.delay = (p) => (p.endsWith('/screen') ? 400 : 0);
  const from = reads().length;
  await sleep(11000);
  const slow = reads().slice(from);
  const gaps = slow.slice(1).map((e, i) => e.start - slow[i].end);
  // 150 ms doubled after each slow read (300, 600, 1200), then held at 2 s
  assert.ok(gaps.some((g) => g >= 500 && g <= 1400), `slow reads: the gap doubles (${gaps})`);
  assert.ok(gaps.slice(-2).every((g) => g >= 1800 && g <= 2600), `slow reads: up to 2 s (${gaps})`);
  R.fr.hooks.delay = () => 0;
  await sleep(3500);
  const fast = reads().slice(-5);
  const gf = fast.slice(1).map((e, i) => e.start - fast[i].end);
  assert.ok(gf.every((g) => g < 400), `fast reads: back to 150 ms (${gf})`);
});
