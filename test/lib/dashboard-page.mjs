// What the test/dashboard.<subject>.test.mjs files share: waits on a page, the fast polls, artifacts and
// their mocks, a dev server of the test's own. Nothing here drives a browser or reads a port block.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { write } from './kit.mjs';

// A wait on a condition in a page. Page.navigate answers before the new page is parsed, so an
// evaluation that throws (the last page still there, or the new one half parsed) is "not yet"; timed
// out, it says where the tab is and the last error, so a page that never became the one expected
// reads as that. server, if given, adds the end of what the dashboard's server has said.
// Resolves once window.scrollY has stayed the same for 10 frames running (3 s at most): a smooth
// scroll moves on every frame until it ends, so one under way never reads as at rest.
export const AT_REST = `new Promise((resolve) => { const end = performance.now() + 3000; let last = scrollY, same = 0; const f = () => { if (scrollY === last) same++; else { same = 0; last = scrollY; } if (same >= 10 || performance.now() > end) resolve(true); else requestAnimationFrame(f); }; requestAnimationFrame(f); })`;
// Resolves after two frames: whatever an event handler set has been drawn.
export const FRAMES = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';
export const soonIn = (p, ms = 30000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) {
      const at = await p.ev('[location.href, document.title, document.readyState]').catch((e) => e.message);
      // with the fixture's fetch hook: the page's last /api/data reads, a stuck one with its age so far
      const reads = await p.ev('(window.__reads ?? []).slice(-5).map((x) => x.ms === null ? `in flight ${Date.now() - x.at} ms` : `${x.status} in ${x.ms} ms`)').catch(() => []);
      assert.fail(`timed out: ${what}; the tab is at ${JSON.stringify(at)}${err ? `; last: ${err.message}` : ''}${reads.length ? `; its last data reads: ${reads.join(', ')}` : ''}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
};

// The page polls every 10s here; the fixture polls every 300ms, and a test can stop /api/data
// answering to catch a refresh in flight (the fetch outlasts the moment focus arrives).
// DEVTEAM_TEST_READ_DELAY_MS=600 makes each /api/data and /api/threads read take 0.5 to 1.5 times
// that, as a loaded CI runner's do: how a race between a read and a step shows on a fast machine.
export const READ_DELAY_MS = Number(process.env.DEVTEAM_TEST_READ_DELAY_MS) || 0;
export const POLL_FAST = `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  const rf0 = window.fetch;
  const rf = async (u, o) => { if (${READ_DELAY_MS} && /^\\/api\\/(data|threads)/.test(String(u))) await new Promise((r) => setTimeout(r, ${READ_DELAY_MS} * (0.5 + Math.random()))); return rf0(u, o); };
  window.__polls = 0;
  window.__gate = null;
  window.__answerHold = null;
  const inner = async (u, o) => {
    // each read's start and end (a held one starts when the gate opens), so a wait that times out can
    // say whether a read was stuck on the server, and for how long. The page gives up on a read after
    // 30 s from its fetch, gate included: a gate held that long reads as a read given up at 0 ms.
    if (String(u).startsWith('/api/data')) {
      window.__polls++;
      // how many reads wait at the gate: a refresh in flight, as the page sees it, held
      if (window.__gate) { window.__gated = (window.__gated ?? 0) + 1; try { await window.__gate; } finally { window.__gated--; } }
      const x = { at: Date.now(), ms: null, status: null };
      (window.__reads ??= []).push(x);
      if (window.__reads.length > 20) window.__reads.shift();
      try { const r = await rf(u, o); x.status = r.status; return r; } catch (e) { x.status = String(e.message || e); throw e; } finally { x.ms = Date.now() - x.at; }
    }
    if (String(u).startsWith('/api/answer') && window.__answerHold) await window.__answerHold;
    // every owner action recorded as sent, and held on the wire, as a slow server would hold it
    if (o?.method === 'POST' && String(u).startsWith('/api/')) { (window.__posts ??= []).push({ url: String(u), body: o.body }); if (window.__postHold) await window.__postHold; }
    // a test can let the next /api/threads read through but hold its answer back: read now, landing later
    // and can slow every /api/threads answer, as a loaded box would
    if (String(u).startsWith('/api/threads') && window.__threadsDelay) await new Promise((r) => setTimeout(r, window.__threadsDelay));
    // or hold back every /api/threads answer, read now, until the test lets each go (the page's own
    // timeout let go of, so a held read can't be given up while it waits)
    if (String(u).startsWith('/api/threads') && window.__threadsQueue) { const r = await rf(u, { ...o, signal: undefined }); await new Promise((go) => window.__threadsQueue.push(go)); return r; }
    if (String(u).startsWith('/api/threads') && window.__threadsHold) { const h = window.__threadsHold; window.__threadsHold = null; const r = await rf(u, o); window.__threadsRead = true; await h; setTimeout(() => { window.__threadsLanded = true; }, 0); return r; }
    return rf(u, o);
  };
  // A test can hold the page still for a step (finding a button and pressing it): while __still() holds,
  // no answer to the page's poll or the card's lands, and it resolves once any answer already handed
  // back has been drawn (a read draws as soon as its body is in, before the next task). __stir() lets
  // the held answers land.
  window.__landing = 0;
  window.__hush = null;
  window.__still = async () => {
    if (!window.__hush) { let go; window.__hush = new Promise((r) => { go = r; }); window.__hush.go = go; }
    while (window.__landing) await new Promise((r) => setTimeout(r, 10));
  };
  window.__stir = () => { const h = window.__hush; window.__hush = null; h?.go(); };
  // The gate stops reads not yet begun; one already past it (a poll, or the forced read after a press)
  // can still land, seconds later on a loaded runner, and redraw the cards under a click. __quiet()
  // says none is left: every read past the gate has answered and its answer has been drawn (a read
  // draws as soon as its body is in, before __landing goes back down).
  window.__quiet = () => !(window.__reads ?? []).some((x) => x.ms === null) && !window.__landing;
  window.fetch = async (u, o) => {
    const r = await inner(u, o);
    if (!['/api/data', '/api/threads'].some((x) => String(u).startsWith(x))) return r;
    while (window.__hush) await window.__hush;
    window.__landing++;
    let done = false;
    const settle = () => { if (!done) { done = true; setTimeout(() => { window.__landing--; }, 0); } };
    for (const m of ['json', 'text']) { const f = r[m].bind(r); r[m] = () => f().finally(settle); }
    if (!r.ok) settle(); // the card's read gives up on an error without reading the body
    return r;
  };
})()`;

// An artifact landed on main in a threads fixture, as a merged PR puts it there: its tree id.
export function landArtifact(F, slug, files) {
  const dir = path.join(F.old, 'docs/devteam/project/artifacts', slug);
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
  F.g(['add', '-A', dir], F.old);
  F.g(['commit', '-qm', `artifact: ${slug}`], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  return F.g(['rev-parse', `HEAD:docs/devteam/project/artifacts/${slug}`], F.old);
}
export const VIEWER_MOCK = {
  'artifact.json': JSON.stringify({ v: 1, title: 'Viewer mock', summary: 'A page to point at', by: 'supervisor', for: [] }),
  'index.html': '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><p id="art">the mock</p></body></html>',
  'style.css': '#art { color: rgb(1, 2, 3) }',
};

// Every fetch the page makes, in order, for a test to read (the viewer polls nothing else).
export const COUNT_FETCH = '(() => { window.__asked = []; const f = window.fetch; window.fetch = (u, o) => { window.__asked.push(String(u)); return f(u, o); }; })();';

export const LIE_CAP = '/c/1767225600000.abcdefghijklmnop.abcdefghijklmnopqrstuv';

// What an artifact's own scripts post to the page, kept for a test.
export const OWN_MESSAGES = "(() => { window.__own = []; addEventListener('message', (e) => { if (e.data && e.data.own) window.__own.push(e.data); }); })();";
// A dev server of the test's own: what it was asked (method, url, Host, Origin) is kept; its framing
// headers are the test's (none, as dev servers send by default); it redirects /go to its own origin,
// and answers a WebSocket upgrade with one line, then echoes what it is sent until the other end
// ends (on /no-ws it answers 400 instead and holds its side open: what it is sent after is kept as
// after, and noWsEnded says the other end ended). sockets: those open now.
// pages: a page of the test's own for a path (its query aside), in place of that one.
export async function fakeApp(headers = {}, pages = {}) {
  const A = { seen: [], marks: [], headers, sockets: new Set() };
  A.srv = http.createServer((q, s) => {
    // the relay's own looks (once on opening, then each tick) to know the target isn't a dashboard are not the page's traffic
    if (q.url === '/api/hello' && !Object.hasOwn(pages, '/api/hello')) { s.writeHead(404); return s.end(); }
    A.seen.push({ method: q.method, url: q.url, host: q.headers.host, origin: q.headers.origin ?? null });
    A.marks.push(q.headers['x-devteam-relay'] ?? null);
    if (q.url === '/go') { s.writeHead(302, { location: `http://localhost:${A.port}/there` }); return s.end(); }
    s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...A.headers });
    const own = q.url.split('?')[0];
    s.end(Object.hasOwn(pages, own) ? pages[own] : `<!doctype html><title>App</title><button id="buy">Buy now</button><p id="url">${q.url}</p>`);
  });
  A.srv.on('upgrade', (q, socket) => {
    A.seen.push({ method: 'UPGRADE', url: q.url, host: q.headers.host, origin: q.headers.origin ?? null });
    A.sockets.add(socket);
    socket.on('close', () => A.sockets.delete(socket));
    socket.on('error', () => {});
    // /silent: it takes the connection and never says a word, as a hung app would, ending its own side when the other goes
    if (q.url.startsWith('/silent')) { socket.on('end', () => socket.end()); return socket.resume(); }
    // /no-ws: it won't upgrade, says why, and keeps its side open (as a keep-alive server would)
    if (q.url.startsWith('/no-ws')) { socket.on('data', (d) => { A.after = (A.after ?? '') + d; }); socket.on('end', () => { A.noWsEnded = true; }); return socket.write('HTTP/1.1 400 Bad Request\r\ncontent-type: text/plain\r\ncontent-length: 7\r\nconnection: keep-alive\r\n\r\nno, ws\nand then more bytes the relay never sends\n'); }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\n\r\nhello from the app\n');
    socket.on('data', (d) => socket.write(d));
    // as a WebSocket server does: the other end gone, it ends its own
    socket.on('end', () => socket.end());
  });
  await new Promise((r) => A.srv.listen(0, '127.0.0.1', r));
  A.port = A.srv.address().port;
  A.close = () => { for (const s of A.sockets) s.destroy(); A.srv.closeAllConnections?.(); A.srv.close(); };
  return A;
}

// A test's teardown, run last-registered first, each step on its own: a folder's removal registered
// first runs after every stop, and one step that throws skips none of the others (node runs t.after
// hooks in the order they were registered, and stops at the first that throws). The first error is
// thrown once every step has run. const later = cleanup(t); later(() => dash.stop());
export function cleanup(t) {
  const fns = [];
  t.after(async () => {
    let first = null;
    for (const f of fns.reverse()) { try { await f(); } catch (e) { first ??= e; } }
    if (first) throw first;
  });
  return (f) => { fns.push(f); };
}
