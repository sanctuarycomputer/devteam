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
// a JSON answer; hooks.answer(path) gives { status, json } to answer in the fake's place. /__hub (on localhost, another origin) is a page that frames the dashboard, as the hub does.
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

test('terminal A13: the /view/ page keeps both slots disabled', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket' }, async (t) => {
  const R = await open(t, { path: '/view/artifact/nothing-here', hash: '', ready: false });
  await R.soon(`!!document.querySelector('#th-tabs [data-tab="shell"]') || (typeof thDraw === 'function' && (thGo({ th: 'open' }), false))`, 'the panel drawn');
  assert.deepEqual(await R.p.ev(`['supervisor', 'shell'].map((id) => document.querySelector('#th-tabs [data-tab="' + id + '"]').getAttribute('aria-disabled'))`), ['true', 'true']);
  assert.equal(R.term(/./).length, 0, 'the /view/ page asks nothing of the terminal routes');
});
