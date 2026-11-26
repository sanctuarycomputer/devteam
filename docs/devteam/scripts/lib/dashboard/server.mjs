/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { DASHBOARD_ROUTES } from './routes.mjs';
import { DASH_NEXT } from './routes.mjs';
import { DATA_REUSE_MS } from '../accounts.mjs';
import { FRAME_ANCESTORS } from '../previews.mjs';
import { HUB_PORT } from '../orient.mjs';
import { PORT_RANGE } from '../orient.mjs';
import { PREVIEW_FRAMED } from '../previews.mjs';
import { PREVIEW_LENS } from '../previews.mjs';
import { PREVIEW_MAX } from '../previews.mjs';
import { RELAY_PORTS } from '../previews.mjs';
import { UPLOAD_REQUEST_MS } from '../hub/operator.mjs';
import { accountsEveryMs } from '../accounts.mjs';
import { artifactRemoteRefs } from './hub.mjs';
import { dashContext } from './routes.mjs';
import { dashboardActions } from './routes.mjs';
import { dashboardData } from '../orient.mjs';
import { dashboardHub } from './hub.mjs';
import { dashboardLogger } from '../orient.mjs';
import { draining } from '../fleet.mjs';
import { durableLogDir } from '../log.mjs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { flagStr } from '../base.mjs';
import { fold } from '../log.mjs';
import { hubRecordOff } from '../recover.mjs';
import { inFlight } from '../orient.mjs';
import { isObj } from '../artifact-notes.mjs';
import { isPlanFile } from '../log.mjs';
import { keepAlive } from '../orient.mjs';
import { kitAt } from '../recover.mjs';
import { kitDir } from '../state.mjs';
import { kitHandOver } from '../hub/image.mjs';
import { kitPrint } from '../hub/image.mjs';
import { kitPrintDiff } from '../hub/image.mjs';
import { kitPrintKey } from '../hub/image.mjs';
import { liveChildren } from '../orient.mjs';
import { liveLogDir } from '../log.mjs';
import { loadSettings } from '../settings.mjs';
import { mainRef } from '../log.mjs';
import { mainRoot } from '../state.mjs';
import { mergeLogText } from '../log-sync.mjs';
import { out } from '../base.mjs';
import { ownerActionEnv } from '../orient.mjs';
import { paneAskingIn } from '../panes.mjs';
import { paneDraftIn } from '../panes.mjs';
import { paneEscCancels } from '../sessions.mjs';
import { parseLines } from '../log.mjs';
import { personEnv } from '../orient.mjs';
import { pickDashboardPort } from '../orient.mjs';
import { pipeline } from 'node:stream';
import { portFree } from '../orient.mjs';
import { presenceChanged } from '../presence.mjs';
import { presenceRelay } from '../presence.mjs';
import { previewBad } from '../previews.mjs';
import { previewBox } from '../previews.mjs';
import { previewHelloRow } from '../previews.mjs';
import { previewLensCsp } from '../previews.mjs';
import { previewLink } from '../previews.mjs';
import { previewPortIsDashboard } from '../previews.mjs';
import { previewServed } from '../previews.mjs';
import { previewTick } from '../previews.mjs';
import { previewUp } from '../previews.mjs';
import { processLog } from '../hub/health-pool.mjs';
import { readPreviews } from '../previews.mjs';
import { readText } from '../base.mjs';
import { replaceFrameAncestors } from '../previews.mjs';
import { rest } from '../base.mjs';
import { runOwnerAction } from '../orient.mjs';
import { screenLines } from '../panes.mjs';
import { sessionRun } from '../recover.mjs';
import { termDrain } from '../hub/image.mjs';
import { termRoutes } from '../hub/image.mjs';
import { threadViews } from '../threads.mjs';
import { tmuxAsync } from '../previews.mjs';
import { trackChild } from '../orient.mjs';
import { trackRequests } from '../orient.mjs';
import { typeLock } from '../log.mjs';
import { typeLockAsync } from '../log.mjs';
import { uploadLimits } from '../hub/operator.mjs';
/* imports end */
export async function cmdDashboard() {
  // the kit as this process loaded it, printed first, before any wait (kit-288): a sync landing
  // while it starts is then a change it sees
  const startPrint = kitPrint(fileURLToPath(import.meta.url));
  const picked = await pickDashboardPort();
  let port = picked.port;
  const host = flagStr('host') ?? '127.0.0.1';
  const log = dashboardLogger();
  if (picked.warn) { log(picked.warn); process.stderr.write(`devteam dashboard: ${picked.warn}\n`); }
  processLog(log, 'dashboard');
  // the terminal's routes (terminal@1): the port as a getter, since it is re-picked when taken
  const term = termRoutes({ port: () => port, host, log });
  const page = path.join(kitDir, 'dashboard', 'index.html');
  // The page's policy, at / and at /view/: its frames are its own pages and, where a preview's lens
  // is shown, exactly the origins that serve it (stageFrames, previewStage); only it and the hub frame it.
  const pageCsp = (frames = []) => `frame-src ${['\'self\'', ...frames].join(' ')}; frame-ancestors 'self' http://127.0.0.1:${HUB_PORT}`;
  const self = fileURLToPath(import.meta.url);
  // Its timers, kept so a hand-over to a new kit stops each (nothing new starts while it drains) and
  // a respawn that failed starts them again.
  const timers = [];
  const every = (f, ms) => { const t = { f, ms, id: setInterval(f, ms) }; t.id.unref(); timers.push(t); };
  const stopTimers = () => { for (const t of timers) clearInterval(t.id); };
  const startTimers = () => { for (const t of timers) { clearInterval(t.id); t.id = setInterval(t.f, t.ms); t.id.unref(); } };
  const ownerEnv = ownerActionEnv('dashboard');
  // A child run as the owner. timeout (ms) is for a caller that can't wait (the gateway's 15 s);
  // code is the exit code, so a route can tell "not there" from "fix a setting" (2).
  // An argument execFile refuses (a NUL in it) throws as it is called, not to the callback: that is a
  // failed run too, never a rejection, which would end the dashboard.
  const run = (args, { timeout = 0 } = {}) => new Promise((resolve) => {
    try {
      execFile(process.execPath, [self, ...args], { cwd: mainRoot, maxBuffer: 64 * 1024 * 1024, env: ownerEnv, timeout, killSignal: 'SIGKILL' }, (err, stdout, stderr) => resolve({ ok: !err, code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr: err?.killed ? `devteam: ${args.slice(0, 2).join(' ')} took over ${timeout / 1000} s and was stopped` : stderr }));
    } catch (e) { resolve({ ok: false, code: 1, stdout: '', stderr: `devteam: ${args.slice(0, 2).join(' ')} could not start: ${e.code ?? e.message}` }); }
  });
  // /api/view's describe runs in flight, by slug|at: one child process however many ask at once
  const describing = new Map();
  // /api/artifact-versions runs in flight, by slug: one child process however many ask at once
  const versioning = new Map();
  // person: the request's (kit-252), on this child's env alone
  const runAction = (args, { person = null, ...o } = {}) => runOwnerAction(args, { ...o, env: personEnv(ownerEnv, person), log });
  const { ID, text, autonomyArgs, turnOk, lineOk, filesArgs, ACTIONS, ACTION_MS, ACTION_JSON } = dashboardActions();
  const send = (res, code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(body); };
  // /api/hello answers at once from the last `hello` run, which the dashboard refreshes every 30 s
  // (kit-595; it was 10 s: each run is a child holding about 140 MB, so the hub's pulse is at most
  // about 40 s old, the beat plus a run) and after an owner action
  // in the background: the hub probes every port with a 300 ms budget, and /api/data takes far longer.
  // One run at a time, each given 20 s; the kit's version is read once, on the first run.
  // viewer: 1 says this kit has /view/ and /artifact/tree/: the gateway's owner wrapper waits for it (spec §8).
  let hello = null;
  let kit = null;
  // the kit's version as this process started on it, from its first hello: the restart's "from"
  let startKit = null;
  let kitAt = { main: null, at: 0 };
  let helloRunning = false;
  const refreshHello = () => {
    if (helloRunning) return;
    helloRunning = true;
    // The kit's version is checked again when main moves (an adoption landing) and every 10 min.
    // main's sha is asked without holding the server's loop.
    execFile('git', ['rev-parse', '--verify', '--quiet', mainRef() ?? 'HEAD'], { cwd: mainRoot, encoding: 'utf8', timeout: 10000 }, (gerr, gout) => {
      const main = mainRef() && !gerr ? gout.trim() || null : null;
      const fresh = !kit || main !== kitAt.main || Date.now() - kitAt.at > 600000;
      execFile(process.execPath, [self, 'hello', '--json', '--pane', ...(fresh ? [] : ['--no-kit'])], { cwd: mainRoot, env: ownerEnv, timeout: 20000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        helloRunning = false;
        if (err) return;
        try { hello = JSON.parse(stdout); if (fresh && hello.kit) { kit = hello.kit; kitAt = { main, at: Date.now() }; startKit ??= hello.kit; } } catch {}
      });
    });
  };
  refreshHello();
  // How often the dashboard looks again through the hello child (kit-595: 30 s). DEVTEAM_HELLO_MS is for
  // tests only, not a setting: test/lib/pane-question-fixture.mjs sets 1000, so a question change shows
  // in a second (kit-223). Anything that isn't a number of at least 0 is the default.
  const HELLO_MS = ((n) => (process.env.DEVTEAM_HELLO_MS?.trim() && Number.isFinite(n) && n >= 0 ? n : 30000))(Number(process.env.DEVTEAM_HELLO_MS));
  every(refreshHello, HELLO_MS);
  const helloBody = () => JSON.stringify({ devteam: 1, root: fs.realpathSync(mainRoot), name: loadSettings().project ?? path.basename(mainRoot), port, kit, viewer: 1, inbox: hello?.inbox ?? null, prompts: hello?.prompts ?? null, threads: hello?.threads ?? null, fleet: hello?.fleet ?? null, ...(hello?.alert ? { alert: hello.alert } : {}), ...(hello?.box_alert ? { box_alert: hello.box_alert } : {}), pulse: hello?.pulse ?? null, previews: readPreviews().slice(0, PREVIEW_MAX).map((r) => previewHelloRow(r, previewUp.get(r.name) ?? null)), ...presence.present() });
  // Previews: the tick's probes feed hello and the Library, one run at a time so a tmux that has
  // stalled never stacks them up. A file in run/previews that isn't a preview is named once.
  const previewsNamedBad = new Set();
  previewBad = (f, e) => { if (!previewsNamedBad.has(f)) { previewsNamedBad.add(f); log(`previews: skipped ${f}: ${e?.message ?? e}`); } };
  let previewTicking = false;
  // What the last tick saw of the previews: each record and whether it was up. A tick that sees
  // anything else moves dataEpoch (kit-595), so a kept dashboard-data build never shows the previews
  // from before it; none at the start is no change.
  let previewsSeen = '[]';
  const previewsMoved = () => {
    const seen = JSON.stringify(readPreviews().map((r) => [r, previewUp.get(r.name) ?? null]));
    if (seen !== previewsSeen) dataEpoch += 1;
    previewsSeen = seen;
  };
  const runPreviewTick = () => {
    if (previewTicking) return;
    previewTicking = true;
    previewTick().catch((e) => log(`previews: tick failed: ${e?.stack ?? e}`)).finally(() => { previewTicking = false; relaysTidy(); previewsMoved(); });
  };
  runPreviewTick();
  every(runPreviewTick, Number(process.env.DEVTEAM_PREVIEW_TICK_MS ?? 10000));
  // ----- the laptop's preview relay (spec §7): a loopback listener per preview, opened when its viewer
  // is first asked for and closed with its record. It serves the lens on GET /.devteam/lens and
  // forwards everything else to the app as the box's gateway does (proxyPreview, downstreamHeaders):
  // localhost as Host and Origin, the app's loopback origin mapped to the relay's, and its framing
  // headers given way for one load only, the app framed from its own origin, which is how its lens
  // holds it. No session (it is loopback, like the dev server) and no cookie rules (no cookie of the
  // owner's to protect): decision 1. Where it differs from the gateway, knowingly: it forwards a
  // non-GET with a foreign Origin as it is (the app refuses it, or doesn't) and cross-site
  // non-navigate fetches, which the gateway refuses; it passes clear-site-data on; and it answers a
  // plain 502 when the app is down, where the gateway serves an HTML 503.
  const relays = new Map();
  // who may hold the lens here: the hub, every instance in the block, and this dashboard (its port may
  // be pinned outside the block), each once (decision 4)
  const relayLensCsp = () => previewLensCsp([...new Set([`http://127.0.0.1:${HUB_PORT}`, ...PORT_RANGE.map((p) => `http://127.0.0.1:${p}`), `http://127.0.0.1:${port}`, `http://localhost:${port}`])].join(' '));
  const RELAY_MARK = 'x-devteam-relay';
  const RELAY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'referer', 'forwarded']);
  const RELAY_LOOP = /\b(http|ws):\/\/(?:127\.0\.0\.1|localhost):(\d+)/g;
  // Every route answers only on the relay's own address: a page elsewhere that points its own name at
  // 127.0.0.1 (DNS rebinding) sends its own Host, and reaches neither the lens nor the app.
  const relayOwnHost = (R, req) => [`127.0.0.1:${R.port}`, `localhost:${R.port}`].includes(req.headers.host ?? '');
  const relayUpHeaders = (req, R) => {
    const h = {};
    for (const [k, v] of Object.entries(req.headers)) if (!RELAY_HOP.has(k) && !k.startsWith('x-forwarded-') && k !== RELAY_MARK) h[k] = v;
    // set fresh on everything forwarded: a dashboard that ends up on the target refuses it everywhere
    h[RELAY_MARK] = '1';
    h.host = `localhost:${R.app}`;
    // the relay's own origin, by either of its names, is the app's; any other passes as it is, for the app to refuse
    if (req.headers.origin === `http://${req.headers.host}`) h.origin = `http://localhost:${R.app}`;
    return h;
  };
  const relayDownHeaders = (h, R, framedBySelf) => {
    const out = {};
    for (const [k, v] of Object.entries(h)) {
      if (['connection', 'keep-alive', 'transfer-encoding'].includes(k)) continue;
      out[k] = k !== 'content-security-policy' && k !== 'location' ? v : String(v).replace(RELAY_LOOP, (all, scheme, p) => (Number(p) !== R.app ? all : scheme === 'ws' ? R.own.replace(/^http/, 'ws') : R.own));
    }
    if (framedBySelf) {
      // the lens, the hub and this dashboard, which frames the lens: no other instance's page holds the app
      const ancestors = `'self' http://127.0.0.1:${HUB_PORT} http://127.0.0.1:${port} http://localhost:${port}`;
      delete out['x-frame-options'];
      const csp = out['content-security-policy'] ? String(out['content-security-policy']) : '';
      if (csp.search(FRAME_ANCESTORS) >= 0) out['content-security-policy'] = replaceFrameAncestors(csp, ancestors);
      // The app said nothing of frames by policy: by X-Frame-Options alone, or not at all (a dev
      // server's default). Either way a policy of its own keeps every other instance's page out.
      else out['content-security-policy'] = `${csp ? `${csp}, ` : ''}frame-ancestors ${ancestors}`;
    }
    return out;
  };
  const relayRequest = (R) => (req, res) => {
    const say = (code, text) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end(text); };
    if (!relayOwnHost(R, req)) return say(421, 'this relay answers only on its own address');
    // origin-form only, as the gateway takes it
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return say(400, 'bad request');
    let url;
    try { url = new URL(req.url, R.own); } catch { return say(400, 'bad request'); }
    // A service worker registered here would outlive this preview, and answer for the next one given its port.
    if (req.headers['service-worker'] || req.headers['sec-fetch-dest'] === 'serviceworker') return say(403, 'no service workers on a preview');
    // framed only by a page of this machine, the lens too, so no other site lays the app under its own page
    if (PREVIEW_FRAMED.includes(req.headers['sec-fetch-dest']) && !['same-origin', 'same-site'].includes(req.headers['sec-fetch-site'])) return say(403, 'not in another site\'s frame');
    // the lens: static, the gateway's bytes, and never the app's; any other method or path is the app's
    if (req.method === 'GET' && url.pathname === '/.devteam/lens') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': relayLensCsp(), 'referrer-policy': 'no-referrer' });
      return res.end(PREVIEW_LENS);
    }
    const framedBySelf = req.headers['sec-fetch-dest'] === 'iframe' && req.headers['sec-fetch-site'] === 'same-origin';
    let current = null;
    res.on('close', () => { if (!res.writableFinished) current?.destroy(); });
    // 127.0.0.1, then ::1 when that is refused; the body starts only once a connection is up, so a
    // refused attempt has taken none of it. agent: false, a fresh connection each time, as the gateway's.
    const attempt = (hosts) => {
      let connected = false;
      const up = http.request({ host: hosts[0], port: R.app, agent: false, method: req.method, path: req.url, headers: relayUpHeaders(req, R) }, (ur) => {
        res.writeHead(ur.statusCode, { ...relayDownHeaders(ur.headers, R, framedBySelf), 'cache-control': 'no-store' });
        pipeline(ur, res, () => {});
      });
      current = up;
      up.on('socket', (s) => { const go = () => { connected = true; pipeline(req, up, () => {}); }; if (s.connecting) s.once('connect', go); else go(); });
      up.on('error', (e) => {
        if (!connected && e.code === 'ECONNREFUSED' && hosts.length > 1) return attempt(hosts.slice(1));
        if (res.headersSent) return res.destroy();
        if (res.destroyed) return undefined;
        return say(502, `Nothing answers on port ${R.app}.`);
      });
    };
    return attempt(['127.0.0.1', '::1']);
  };
  // A preview's sockets (HMR, mostly), as previewUpgrade carries them on a box: on the relay's own
  // address, from a page of its own origin under that name (a page elsewhere can't open the app's
  // socket through it), a cap per preview so a client's reconnect loop can't exhaust the dashboard,
  // and the bytes relayed raw after a 101, both ways. No cookie rules here (decision 1), so the app's
  // 101 passes as it is; any other answer is relayed, then both sides end.
  const RELAY_SOCKETS = 32;
  const RELAY_LINGER_MS = 2000;
  // ended, then closed shortly after whether or not the page ends its side: a page that holds on keeps nothing here
  const relayEnd = (socket) => { socket.end(); setTimeout(() => socket.destroy(), RELAY_LINGER_MS).unref(); };
  const relayUpgrade = (R, req, socket, head) => {
    const refuse = (code, msg) => { socket.write(`HTTP/1.1 ${code} ${msg}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`); relayEnd(socket); };
    socket.on('error', () => {});
    if (!relayOwnHost(R, req)) return refuse(421, 'Misdirected Request');
    if (req.headers.origin !== `http://${req.headers.host}`) return refuse(403, 'Forbidden');
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return refuse(400, 'Bad Request');
    if (R.sockets.size >= RELAY_SOCKETS) return refuse(429, 'Too Many Requests');
    R.sockets.add(socket);
    socket.once('close', () => R.sockets.delete(socket));
    // 127.0.0.1, then ::1 when that is refused, as a request's
    const connect = (hosts) => {
      const up = net.connect(R.app, hosts[0]);
      let open = false;
      let next = false;
      // answered without an upgrade: the page's side ends on its own once the answer is written
      let answered = false;
      up.on('error', (e) => { if (!open && e.code === 'ECONNREFUSED' && hosts.length > 1) next = true; else if (!answered) socket.destroy(); });
      up.once('close', () => { if (next && !socket.destroyed) connect(hosts.slice(1)); else if (!answered) socket.destroy(); });
      up.once('connect', () => {
        open = true;
        if (socket.destroyed) return up.destroy();
        socket.on('close', () => up.destroy());
        const h = relayUpHeaders(req, R);
        h.connection = 'Upgrade';
        h.upgrade = req.headers.upgrade;
        up.write(`GET ${req.url} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\r\n')}\r\n\r\n`);
        if (head?.length) up.write(head);
        // The answer's head, held until it is whole: a 101 is relayed as it is, then the bytes both
        // ways; anything else is the answer to one request, so it and its body (by content-length,
        // else until the app ends it) are all the page gets, and both sides end after it.
        let held = Buffer.alloc(0);
        // an app that takes the socket and never answers holds two sockets for nothing: both go after 10 s without a head
        const noHead = setTimeout(() => { up.destroy(); socket.destroy(); }, Number(process.env.DEVTEAM_RELAY_HEAD_MS) || 10000);
        up.once('close', () => clearTimeout(noHead));
        socket.once('close', () => clearTimeout(noHead));
        const onHead = (chunk) => {
          held = Buffer.concat([held, chunk]);
          const end = held.indexOf('\r\n\r\n');
          if (end < 0) { if (held.length > 64 * 1024) { up.destroy(); socket.destroy(); } return; }
          clearTimeout(noHead);
          up.off('data', onHead);
          const top = held.subarray(0, end).toString('latin1');
          const rest = held.subarray(end + 4);
          if (/^HTTP\/1\.[01] 101\b/.test(top)) {
            socket.write(held);
            pipeline(up, socket, () => {});
            pipeline(socket, up, () => {});
            return;
          }
          answered = true;
          const rows = top.split('\r\n').filter((row, i) => i === 0 || !/^(connection|keep-alive)[ \t]*:/i.test(row));
          socket.write(`${rows.join('\r\n')}\r\nconnection: close\r\n\r\n`, 'latin1');
          const len = /\r\ncontent-length:[ \t]*(\d+)[ \t]*(?:\r\n|$)/i.exec(top);
          let left = len ? Number(len[1]) : Infinity;
          let done = false;
          const finish = () => { if (done) return; done = true; clearTimeout(cap); up.destroy(); relayEnd(socket); };
          const body = (b) => { const part = b.subarray(0, Math.min(b.length, left)); if (part.length) socket.write(part); left -= part.length; if (left <= 0) finish(); };
          const cap = setTimeout(finish, 5000);
          up.on('data', body);
          up.once('end', finish);
          up.once('close', finish);
          body(rest);
        };
        up.on('data', onHead);
        return undefined;
      });
    };
    return connect(['127.0.0.1', '::1']);
  };
  const relayCloseOne = (R) => { for (const s of R.sockets) s.destroy(); R.server?.closeAllConnections?.(); R.server?.close(); };
  const relayClose = (name) => { const R = relays.get(name); if (!R) return; relays.delete(name); relayCloseOne(R); };
  // A relay for this preview, on the first port of the range nothing holds; null when none is free.
  const relayFor = (rec) => {
    const had = relays.get(rec.name);
    if (had?.app === rec.port) return had.ready;
    if (had) relayClose(rec.name);
    // a record (written by hand, or before this rule) naming this dashboard: never relayed
    if (rec.port === port) return Promise.resolve(null);
    const R = { name: rec.name, app: rec.port, port: null, own: null, server: null, sockets: new Set() };
    R.ready = (async () => {
      // any dashboard answering there (this one's own port aside, another checkout's, or a record that names one): not an app
      if (await previewPortIsDashboard(rec.port)) { log(`previews: ${rec.name}: port ${rec.port} answers as a devteam dashboard, not relayed`); if (relays.get(rec.name) === R) relays.delete(rec.name); return null; }
      const held = new Set(readPreviews().map((r) => r.port));
      for (const p of RELAY_PORTS) {
        // nothing answering there on either family (a dev server on ::1 would take localhost), and no record's
        if (held.has(p) || [...relays.values()].some((x) => x !== R && x.port === p) || !(await portFree(p))) continue;
        const srv = keepAlive(http.createServer());
        if (!(await new Promise((resolve) => { srv.once('error', () => resolve(false)); srv.listen(p, '127.0.0.1', () => resolve(true)); }))) continue;
        Object.assign(R, { port: p, own: `http://127.0.0.1:${p}`, server: srv });
        srv.on('request', relayRequest(R));
        srv.on('upgrade', (req, socket, head) => relayUpgrade(R, req, socket, head));
        srv.on('error', (e) => log(`previews: relay for ${R.name} on ${p}: ${e?.message ?? e}`));
        // closed before it was up (its record gone meanwhile): not kept
        if (relays.get(rec.name) !== R) { relayCloseOne(R); return null; }
        return p;
      }
      // none free: nothing kept, so the next ask tries again
      if (relays.get(rec.name) === R) relays.delete(rec.name);
      return null;
    })();
    relays.set(rec.name, R);
    return R.ready;
  };
  // a relay for a record gone, or one now on another port, closes on the tick after
  // and one whose target now answers as a dashboard (one that came up there after the relay did)
  const relaysTidy = () => {
    const live = new Map(readPreviews().map((r) => [r.name, r.port]));
    for (const [n, R] of [...relays]) {
      if (live.get(n) !== R.app) relayClose(n);
      else if (R.port) previewPortIsDashboard(R.app).then((is) => { if (is && relays.get(n) === R) { log(`previews: ${n}: port ${R.app} now answers as a devteam dashboard, relay closed`); relayClose(n); } });
    }
  };
  // Where a preview's lens is, for its viewer (spec §7): its own name through the box's gateway, which
  // serves the lens there; else this laptop's relay, opened only when open is set (/api/view's ask);
  // null on a box whose gateway doesn't serve previews, where the loopback is out of the browser's
  // reach (decision 7). opened: this ask opened the relay, so a page loaded before it lacks it in its
  // policy (decision 6).
  const previewStage = async (rec, { open = false } = {}) => {
    if (previewServed()) return { origin: previewLink(rec), opened: false };
    if (previewBox()) return { origin: null, opened: false };
    const had = relays.get(rec.name);
    if (had?.app === rec.port && had.port) return { origin: had.own, opened: false };
    if (!open) return { origin: null, opened: false };
    // one still opening was another ask's: this one waits for it, but didn't open it
    const mine = had?.app !== rec.port;
    const p = await relayFor(rec);
    return p ? { origin: `http://127.0.0.1:${p}`, opened: mine } : { origin: null, opened: false };
  };
  // Where the dashboard's own stage may frame a preview's lens, as of this request (decision 5): each
  // preview's own name through the box's gateway, or this laptop's relays open now, each as
  // previewStage gives it. Never a wildcard: an agent can answer on any instance name. With none,
  // 'self' alone, as before. A relay counts only while its record is there and names its app's port:
  // one whose preview has stopped or moved, and which the tick hasn't closed yet, is framed no more.
  const stageFrames = () => {
    if (previewBox()) return previewServed() ? readPreviews().map(previewLink) : [];
    const live = new Map(readPreviews().map((r) => [r.name, r.port]));
    return [...relays].filter(([n, R]) => R.port && live.get(n) === R.app).map(([, R]) => R.own);
  };
  // Account rotation and limit stops (accounts-tick), one run at a time, as the supervisor; a line
  // it prints goes to the log once, however many ticks repeat it. Every dashboard asks to rotate,
  // and the claim decides which one does.
  let accountsRunning = false;
  let accountsSaid = '';
  const accountsTick = () => {
    if (accountsRunning) return;
    accountsRunning = true;
    const env = { ...process.env, DEVTEAM_ROLE: 'supervisor' };
    for (const k of ['DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_CHANNEL']) delete env[k];
    // its tick runs as the supervisor, so a session's dashboard says here that it isn't the project's own
    if (sessionRun() || hubRecordOff()) env.DEVTEAM_HUB_RECORD = 'off';
    trackChild(execFile(process.execPath, [self, 'accounts-tick', '--rotate'], { cwd: mainRoot, env, timeout: 120000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      accountsRunning = false;
      const said = `${stdout}${err ? ` ${stderr || err.message}` : ''}`.trim();
      if (said && said !== accountsSaid) log(`accounts: ${said}`);
      accountsSaid = said;
    }));
  };
  // One dashboard-data run at a time, shared by every page waiting on it, with no time limit by default (DEVTEAM_DASHBOARD_DATA_TIMEOUT_MS) (a page
  // with data already waits DATA_WAIT_MS for it, then has that data, marked stale): each
  // refresh used to start its own, and on a slow machine they piled up (one ran for an hour).
  // And at most one start every 3 s, whatever the pages ask (live presence, kit-633): a build is
  // served while it runs, and once finished while it is young (DATA_REUSE_MS, 20 s since it finished
  // (kit-595; it was 3 s): a page's 10 s poll then starts a child every other poll at most, and gets
  // previews, settings and git at most 20 s plus one run old) and current (dataEpoch, which the log's
  // changes, every POST action and a preview tick that saw a change move, is what it was when the build *started*: a change during a
  // build makes it stale when it ends). A read that finds none waits for the next build, which starts
  // once the running one has ended and 3 s have passed since the last start; every read waiting then
  // shares it. A failed build is never kept.
  const DATA_EVERY_MS = 3000;
  // No time limit on a build by default: a big project's build can take minutes, and stopping it at a
  // fixed limit left its dashboard with no data at all. Builds run one at a time, so a slow one never
  // piles up; DEVTEAM_DASHBOARD_DATA_TIMEOUT_MS sets a limit in ms when wanted (0 or unset: none).
  const DASHBOARD_DATA_TIMEOUT_MS = Math.max(0, Number(process.env.DEVTEAM_DASHBOARD_DATA_TIMEOUT_MS) || 0);
  let dataEpoch = 0;
  let build = null;
  let nextBuild = null;
  let lastStart = -Infinity;
  let lastData = null;
  const startBuild = () => {
    lastStart = Date.now();
    const b = { epoch: dataEpoch, finished: null, r: null };
    b.done = new Promise((resolve) => b.child = execFile(process.execPath, [self, 'dashboard-data'], { cwd: mainRoot, maxBuffer: 64 * 1024 * 1024, env: { ...ownerEnv, DEVTEAM_PREVIEW_UP: JSON.stringify(Object.fromEntries(previewUp)) }, timeout: DASHBOARD_DATA_TIMEOUT_MS, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      if (!err && stdout) lastData = stdout;
      b.r = { ok: !err, stdout, stderr: err?.killed ? `dashboard-data took over ${DASHBOARD_DATA_TIMEOUT_MS < 120000 ? `${Math.round(DASHBOARD_DATA_TIMEOUT_MS / 1000)} s` : `${Math.round(DASHBOARD_DATA_TIMEOUT_MS / 60000)} minutes`} and was stopped (DEVTEAM_DASHBOARD_DATA_TIMEOUT_MS)` : String(stderr ?? '') };
      b.finished = Date.now();
      resolve(b.r);
    }));
    build = b;
    return b.done;
  };
  // a build still running when the dashboard exits (processLog's signal handlers exit it) is killed
  // with it, not left writing run/cache: the warm start (kit-595) runs one with no read waiting
  process.on('exit', () => { if (build?.finished === null) try { build.child?.kill('SIGKILL'); } catch {} });
  // the Library's fetch of origin (kit-750): a fetch that moved a ref makes the kept build stale, so
  // the next /api/data shows it; stopped only as the process ends, so a hand-over that fails serves on
  const remote = artifactRemoteRefs({ root: mainRoot, main: loadSettings().main_branch, onMoved: () => { dataEpoch += 1; } });
  process.on('exit', () => remote.stop());
  const usable = (b) => !!b && b.epoch === dataEpoch && (b.finished === null || (b.r.ok && Date.now() - b.finished < DATA_REUSE_MS));
  const dashboardData = () => {
    if (usable(build)) return build.done;
    nextBuild ??= (async () => {
      if (build && build.finished === null) await build.done;
      await new Promise((w) => setTimeout(w, Math.max(0, lastStart + DATA_EVERY_MS - Date.now())));
      nextBuild = null;
      return startBuild();
    })();
    return nextBuild;
  };
  // /api/threads: every thread, its turns and the questions asked in it, for the open card's 2 s poll
  // and the dock. dashboard-data is a slow child, and readLog() can't serve here: its cache is cleared
  // only by appendLog, which this process never calls, and it reads main's log through git. So this
  // reads each log file itself, run/log's and the checkout's project/log copy (after a move run/log
  // is empty until a file's next write), merged as logFileText merges them, parsed with the
  // integrity checks, and kept by each file's size and mtime: a read with nothing changed is a stat
  // per file. Planners write no threads, so their plan files are left out.
  const threadFiles = new Map();
  let threadsMemo = { key: null, body: null };
  const threadsRead = () => {
    const names = new Set();
    for (const dir of [liveLogDir(), durableLogDir()]) { try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl') && !isPlanFile(f)) names.add(f); } catch {} }
    const stat = (p) => { try { const s = fs.statSync(p); return `${s.size}:${s.mtimeMs}`; } catch { return '-'; } };
    const keyed = [...names].sort().map((f) => [f, `${stat(path.join(liveLogDir(), f))}/${stat(path.join(durableLogDir(), f))}`]);
    const key = keyed.map(([f, k]) => `${f}=${k}`).join('|');
    if (threadsMemo.key === key) return { body: threadsMemo.body, cached: true, key, views: threadsMemo.views };
    for (const f of [...threadFiles.keys()]) if (!names.has(f)) threadFiles.delete(f);
    for (const [f, k] of keyed) {
      if (threadFiles.get(f)?.k === k) continue;
      const live = readText(path.join(liveLogDir(), f));
      const durable = readText(path.join(durableLogDir(), f));
      const text = mergeLogText(live, durable);
      threadFiles.set(f, { k, lines: parseLines(text, f, { validate: false }).lines.filter((l) => ['thread', 'turn', 'question'].includes(l.type) || (l.type === 'message' && l.kind === 'addressed')) });
    }
    const all = [...threadFiles.values()].flatMap((x) => x.lines);
    const asked = new Set(all.filter((l) => l.type === 'question' && l.op === 'new' && typeof l.thread === 'string').map((l) => l.id));
    const views = threadViews(fold(all.filter((l) => l.type !== 'question' || asked.has(l.id))).objects);
    const body = JSON.stringify(views);
    threadsMemo = { key, body, views };
    return { body, cached: false, key, views };
  };
  // Whether the supervisor has a pane the kit can type into, for the card's "hasn't replied yet": what
  // the 10 s hello child found (hello --pane), so a read never waits on tmux.
  const supervisorPane = () => hello?.supervisor_pane === true;
  // What the supervisor's terminal is asking the owner, as that same run found it (pane text: the page escapes it).
  const supervisorAsks = () => {
    const q = hello?.supervisor_question;
    if (!isObj(q) || typeof q.digest !== 'string' || !/^[0-9a-f]{40}$/.test(q.digest)) return null;
    if (q.kind === 'menu' && Array.isArray(q.options)) return { kind: 'menu', question: String(q.question ?? ''), options: q.options.slice(0, 40).map((o) => ({ n: Number(o?.n), label: String(o?.label ?? '') })), selected: Number(q.selected) || null, hint: String(q.hint ?? ''), digest: q.digest };
    return { kind: q.kind === 'limit' ? 'limit' : 'dialog', text: String(q.text ?? ''), digest: q.digest };
  };
  // The workers' and planners' sessions stopped at a permission prompt, as that same run found them:
  // red questions in the Inbox, answered in their terminals (pane text: the page escapes it).
  const sessionPrompts = () => (Array.isArray(hello?.prompt_sessions) ? hello.prompt_sessions.slice(0, 40).map((x) => ({ window: String(x?.window ?? '').slice(0, 120), line: String(x?.line ?? '').slice(0, 200) })) : []);
  // The owner's answer to it. Who may send one: this page, by the browser's own headers (Origin and
  // Sec-Fetch-Site, both), carrying the token this process made for that question and gave only to a
  // same-origin read of /api/threads (kept in memory: not in run/, not in the log, not in any
  // command's arguments). On a laptop that is as far as it goes: whatever runs as this user can ask
  // this server for the token as the page does, and can type into the terminal itself; the point is
  // that nothing answers by accident, or by a plain request, or from the command line. On a box the
  // owner is never local, so a press also carries the gateway's signature, each nonce taken once
  // (paneProofProblem), and pane answered checks it again.
  // The key is sent from here, not by a command: the terminal is read again (pane question), the
  // digest must be the one the card showed, the pane is read once more right before the key, and
  // after it the pane must show that the menu took it: gone, and the digit not sitting in the
  // agent's input box. Then the act is recorded and the held lines typed (pane answered). A key
  // that may not have landed is recorded as that, and nothing held is typed.
  const paneSecret = crypto.randomBytes(32);
  const paneToken = (digest) => crypto.createHmac('sha256', paneSecret).update(String(digest)).digest('hex');
  const paneTokenOk = (digest, token) => { const want = Buffer.from(paneToken(digest)); const got = Buffer.from(String(token ?? '')); return got.length === want.length && crypto.timingSafeEqual(got, want); };
  const paneNonces = new Map();
  const ownerSettingNonces = new Map();
  let paneAnswering = false;
  const tmuxAsync = (args) => new Promise((resolve) => { try { execFile('tmux', args, { encoding: 'utf8', timeout: 10000 }, (err, so) => resolve(err ? null : so)); } catch { resolve(null); } });
  const PANE_SETTLE_MS = 1500;
  async function paneAnswer({ digest, option, escape = false, proof, person = null }) {
    const no = (error, status = 400) => ({ status, body: { error } });
    const r = await run(['pane', 'question', '--json', '--pane'], { timeout: 20000 });
    let st = null;
    try { st = r.ok ? JSON.parse(r.stdout) : null; } catch {}
    if (!isObj(st)) return no("nothing was answered: the supervisor's terminal could not be read", 500);
    if (!st.ask) return no(`nothing was answered: the supervisor's terminal is not asking anything now (the question is gone)${st.problem ? `; ${st.problem}` : ''}`);
    if (st.ask.kind !== 'menu' || typeof st.target !== 'string') return no(`nothing was answered: what the supervisor's terminal shows now is answered in the terminal, not here${st.problem ? ` (${st.problem})` : ''}`);
    if (st.ask.digest !== digest) return no("nothing was answered: the question in the supervisor's terminal has changed since the page showed it; read the one showing now and answer that");
    const opt = escape ? null : st.ask.options.find((o) => o.n === option);
    if (!escape && !opt) return no(`nothing was answered: that question has no option ${option}`);
    // Esc only where the menu itself says it cancels: on a menu whose Esc exits (a folder-trust form) it ends the session
    const notCancel = `nothing was answered: Esc here may not cancel (the terminal says: ${String(st.ask.hint ?? '').replace(/\s+/g, ' ').trim() || 'nothing about Esc'}); answer it in the terminal`;
    if (escape && !paneEscCancels(st.ask.hint)) return no(notCancel);
    // look and keyed run only inside the typing lock's hold below, so each refreshes its stamp after its tmux call
    const look = async () => { const t = await tmuxAsync(['-u', 'capture-pane', '-p', '-t', st.target]); typeLock.touch(); return t === null ? null : screenLines(t); };
    const keyed = async (args) => { const r = await tmuxAsync(args); typeLock.touch(); return r; };
    const menuIn = (lines) => { const a = lines ? paneAskingIn(lines) : null; return a?.kind === 'menu' && a.digest === digest ? a : null; };
    // until the question is gone or changed, or its cursor has moved
    const settle = async (was) => { let lines = null; for (let t = 0; t < PANE_SETTLE_MS; t += 100) { await new Promise((w) => setTimeout(w, 100)); lines = await look(); const m = menuIn(lines); if (!lines || !m || m.selected !== was) break; } return lines; };
    const record = (fields, why) => runAction(['pane', 'answered', '--owner'], { timeout: 30000, person, input: JSON.stringify({ digest, ...fields, first: String(st.ask.first ?? ''), artifact: st.ask.artifact ?? undefined, taken: !why, ...(why ? { why } : {}), ...(proof ? { proof } : {}) }) });
    const finish = async (rec, keys, why, after) => {
      // the prompt it was is answered: out of the Inbox's count now, not at the next look
      if (hello) { if (hello.supervisor_question && hello.supervisor_question.kind !== 'limit' && hello.prompts > 0 && hello.inbox > 0) { hello.prompts--; hello.inbox--; } hello.supervisor_question = null; }
      refreshHello();
      const said = rec.ok ? rec.stdout.trim() : rec.stderr.split('\n').filter((l) => l && !l.startsWith('devteam: warning:')).join(' ').replace(/^devteam: /, '');
      if (!rec.ok) return no(`the key was sent (${keys}), but the answer could not be recorded: ${said || 'the command failed'}`, 500);
      if (why) return no(`The key was sent, but it may not have landed: ${why}. Look at the terminal${after}.`, 409);
      return { status: 200, body: { ok: true, out: said } };
    };
    // From the last look through the last settle under the pane's typing lock (kit-618, terminal@1
    // §11), so no key post or kit writer lands between the look and the key, or between the digit and
    // its Enter. The owner's floor isn't read: this is the owner's own press on a card. The lock is let
    // go before record runs pane answered, whose flush takes it afresh. Back: { answer } (a refusal),
    // or what was sent, for record.
    const pressed = await typeLockAsync(st.target, async () => {
      // once more, right before the key
      const last = menuIn(await look());
      if (!last) return { answer: no("nothing was answered: the question in the supervisor's terminal changed or went as you clicked; read what it shows now") };
      if (escape && !paneEscCancels(last.hint)) return { answer: no(notCancel) };
      // tests only: the moment between that look and the key, in which a question can go
      const pause = Number(process.env.DEVTEAM_PANE_ANSWER_DELAY_MS ?? 0);
      if (pause > 0) await new Promise((w) => setTimeout(w, pause));
      // the Escape key, by name, alone: no digit, no Enter. The menu gone is the answer; the same menu
      // still up is reported as a key that may not have landed, as a digit's is, with no second key.
      if (escape) {
        if ((await keyed(['send-keys', '-t', st.target, 'Escape'])) === null) return { answer: no(`nothing was answered: the key could not be sent to ${st.target}`, 500) };
        const lines = await settle(st.ask.selected);
        const why = menuIn(lines) ? 'the same question still shows after Esc' : !lines ? 'the terminal could not be read after the key' : null;
        return { fields: { escape: true, keys: 'Escape' }, keys: 'Escape', why, after: '' };
      }
      if ((await keyed(['send-keys', '-t', st.target, '-l', String(option)])) === null) return { answer: no(`nothing was answered: the key could not be sent to ${st.target}`, 500) };
      let lines = await settle(st.ask.selected);
      let keys = String(option);
      let still = menuIn(lines);
      // the same question showing with the cursor where it was: a menu that took the digit and was asked
      // again at once (a retry, two calls in parallel) looks just like one that ignored it, so no Enter,
      // which would answer a question the owner never saw; the digit is logged as one that may not have landed
      const again = !!still && still.selected === st.ask.selected && st.ask.selected === option;
      if (still && !again) {
        // still up, and the digit moved the cursor onto the option: Enter takes it
        if (still.selected !== option) return { answer: no(`not answered: the terminal did not take the key ${option} (the question is still up, on option ${still.selected}); answer it in the terminal`) };
        if ((await keyed(['send-keys', '-t', st.target, 'Enter'])) === null) return { answer: no(`not answered: option ${option} is selected but Enter could not be sent; answer it in the terminal`, 500) };
        keys = `${option}, Enter`;
        lines = await settle(option);
        still = menuIn(lines);
        if (still) return { answer: no(`not answered: the question is still up with option ${option} selected, after ${keys}; answer it in the terminal`) };
      }
      // what the pane shows after: the menu took the key unless the digit is sitting in the input box
      const draft = lines ? paneDraftIn(lines) : null;
      const why = again ? `the same question still shows after the key, with the cursor where it was (it ignored the digit, or took it and was asked again), so no Enter was sent; answer what shows now in the terminal or on the card` : !lines ? 'the terminal could not be read after the key' : draft !== null && draft.endsWith(String(option)) ? `the question went as the key was sent, and "${option}" is now in the terminal's input box` : null;
      return { fields: { option, label: opt.label, keys }, keys, why, after: ', and clear its input box if the digit is there' };
    }, { waitMs: 10000 });
    if (pressed.busy) return no('nothing was answered: the terminal is busy; try again', 503);
    const p = pressed.value;
    if (p.answer) return p.answer;
    return finish(await record(p.fields, p.why), p.keys, p.why, p.after);
  }
  const bodyMs = uploadLimits().bodyMs;
  // set while it hands over to a new kit (kit-288): what it still answers closes its connection
  let draining = false;
  // live presence (presence@1): its /presence socket, on the same Host check as every route here
  const presence = presenceRelay({ okHost: (h) => [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${host}:${port}`].includes(h ?? ''), ownerCwd: mainRoot, draining: () => draining });
  // the log changed (presenceChanged): every page that said here is told (changed, at most each 500
  // ms), and the kept /api/data build is stale (dataEpoch)
  const logWatch = presenceChanged(liveLogDir(), () => { dataEpoch += 1; presence.changed(); });
  every(logWatch.tick, 1000);
  const D = dashContext({ log, page, pageCsp, run, describing, versioning, remote, runAction, ID, autonomyArgs, ACTIONS, ACTION_MS, ACTION_JSON, send, refreshHello, helloBody, previewStage, stageFrames, dashboardData, threadsRead, supervisorPane, supervisorAsks, sessionPrompts, paneToken, paneTokenOk, paneNonces, ownerSettingNonces, paneAnswer, logWatch, get port() { return port; }, get lastData() { return lastData; }, get dataEpoch() { return dataEpoch; }, set dataEpoch(v) { dataEpoch = v; }, get paneAnswering() { return paneAnswering; }, set paneAnswering(v) { paneAnswering = v; } });
  const server = http.createServer(async (req, res) => {
    if (draining) res.setHeader('connection', 'close');
    // Node's five minutes for a body, for all but an upload (UPLOAD_REQUEST_MS, and its stall timer)
    const bodyTimer = setTimeout(() => { if (!req.complete) req.destroy(); }, bodyMs);
    bodyTimer.unref();
    req.once('close', () => clearTimeout(bodyTimer));
    // Every route answers only on the dashboard's own address: a page elsewhere that points its own
    // name at 127.0.0.1 (DNS rebinding) sends its own Host, and gets nothing, not even a read.
    const okHost = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `${host}:${port}`].includes(req.headers.host ?? '');
    // the terminal's routes read these two refusals as JSON, with their why (terminal@1 §2)
    const isTerm = req.url.startsWith('/api/term/');
    const termNo = (why) => { log(`refused ${req.url.split('?')[0]}: ${why}`); termDrain(req); return send(res, 403, 'application/json', JSON.stringify(req.method === 'POST' ? { error: 'the terminal answers only on this page', why } : { why })); };
    if (!okHost) return isTerm ? termNo('host') : send(res, 403, 'text/plain; charset=utf-8', 'the dashboard answers only on its own address');
    // a request a preview's relay forwarded (it sends localhost as Host and Origin, which the owner checks accept): never the owner's
    if (req.headers[RELAY_MARK] !== undefined) return isTerm ? termNo('relay') : send(res, 403, 'text/plain; charset=utf-8', 'not through a preview relay');
    // /presence is a socket: a plain request gets its guard's status (presence@1 §2)
    if (req.url === '/presence' || req.url.startsWith('/presence?')) return presence.refuse(req, res);
    // the terminal: right after the global guards, before any other route
    if (isTerm) return await term.handle(req, res, new URL(req.url, 'http://x'));
    const q = { okHost, bodyTimer, get u() { return this._u ??= new URL(req.url, 'http://x'); } };
    for (const route of DASHBOARD_ROUTES) if (await route(D, req, res, q) !== DASH_NEXT) return;
  });
  // Two dashboards starting at once can pick the same free port: the one that loses picks again.
  const tried = [];
  server.on('error', async (e) => {
    if (e.code === 'EADDRINUSE' && !picked.pinned && tried.length < PORT_RANGE.length) {
      tried.push(port);
      port = (await pickDashboardPort({ skip: tried })).port;
      return server.listen(port, host);
    }
    log(`server error: ${e?.stack ?? e}`); process.stderr.write(`devteam dashboard: ${e.message}\n`); process.exit(1);
  });
  server.on('upgrade', (req, socket, head) => presence.upgrade(req, socket, head));
  keepAlive(server);
  server.requestTimeout = UPLOAD_REQUEST_MS;
  trackRequests(server);
  // the hub, unless the box's image serves it; again after a respawn that failed
  let hubHandle = null;
  const startHubOnce = () => { hubHandle = dashboardHub(log); };
  server.once('listening', () => { log(`started on http://${host}:${port} (node ${process.version})`); out(`devteam dashboard on http://${host}:${port}`); startHubOnce(); every(accountsTick, accountsEveryMs());
    // warm (kit-595, from kit PR #305): one build as it starts listening, so a tab first opened within
    // DATA_REUSE_MS of its end is answered from it at once; one opened during it shares it
    void dashboardData();
  });
  // ----- the kit watch (kit-288): a dashboard runs the kit it serves. Its kit's files are printed
  // every DEVTEAM_KIT_WATCH_MS; a print unlike the start's and the same two polls running (a sync
  // writes its files over a few seconds) whose script parses is a new kit, and the dashboard hands
  // over to it (kitHandOver). One that doesn't parse, or with nothing to start it again, is said
  // once per print and served on.
  const watchMs = Number(process.env.DEVTEAM_KIT_WATCH_MS) || 10000;
  let lastPrint = startPrint;
  let pending = null;
  let checking = false;
  let restarting = false;
  const said = new Set();
  const sayOnce = (key, msg) => { if (!said.has(key)) { said.add(key); log(msg); } };
  // the version on disk now, from the new script's own hello: this process's settings are cached
  const newKit = () => new Promise((resolve) => execFile(process.execPath, [self, 'hello', '--json'], { cwd: mainRoot, env: ownerEnv, timeout: 20000, maxBuffer: 1024 * 1024 }, (err, stdout) => { try { resolve((!err && JSON.parse(stdout).kit) || 'unknown'); } catch { resolve('unknown'); } }));
  // The hand-over: nothing new starts (timers, the port, the hub, the relays), what is in flight is
  // waited for (every request answered, every acting child gone: inFlight, liveChildren), and only
  // then the new code starts: an exit for the loop around it, or its own pane respawned. A request
  // may take as long as the server allows one (an upload); children have no limit of their own, so a
  // hung one is waited for 5 minutes. A request answered meanwhile closes its connection.
  const CHILDREN_WAIT_MS = 5 * 60000;
  const drained = () => new Promise((resolve) => {
    const since = Date.now();
    const look = () => {
      server.closeIdleConnections?.();
      const waited = Date.now() - since;
      if (!inFlight.size && !liveChildren.size) return resolve(true);
      if ((inFlight.size && waited > UPLOAD_REQUEST_MS) || (!inFlight.size && waited > CHILDREN_WAIT_MS)) {
        log(`handing over with ${inFlight.size} open requests and ${liveChildren.size} running commands still open`);
        return resolve(false);
      }
      setTimeout(look, 100);
    };
    look();
  });
  const restart = async (files, key) => {
    const how = kitHandOver();
    const to = await newKit();
    const changed = `kit files changed (${files.join(', ')}) from ${startKit ?? 'unknown'} to ${to}`;
    if (how.how === 'stay') return sayOnce(key, `${changed}: this dashboard runs older code than its files; restart it to run them (${how.why})`);
    restarting = true;
    draining = true;
    log(`restarting: ${changed}; waiting for ${inFlight.size} open requests and ${liveChildren.size} running commands`);
    stopTimers();
    hubHandle?.close();
    hubHandle = null;
    presence.closeAll(1001);
    // stopTimers stops its tick, not its fs.watch handle; a failed respawn's first tick starts it again
    logWatch.close();
    for (const name of [...relays.keys()]) relayClose(name);
    server.close();
    await drained();
    if (how.how === 'exit') process.exit(0);
    // its own pane: tmux runs the pane's command again (and hangs this process up as it does). A
    // respawn that fails leaves it serving its old code, said once, tried again on a new print.
    const failed = await new Promise((resolve) => execFile('tmux', ['respawn-pane', '-k', '-t', how.pane], { timeout: 10000 }, (err, _o, se) => resolve(err ? String(se || err.message).trim().split('\n')[0] : null)));
    if (failed === null) process.exit(0);
    log(`could not respawn its tmux pane ${how.pane}: ${failed}; staying on ${startKit ?? 'unknown'}`);
    said.add(key);
    draining = false;
    restarting = false;
    server.listen(port, host);
    startTimers();
    startHubOnce();
  };
  const watchTick = () => {
    if (checking || restarting) return;
    const print = kitPrint(self, lastPrint);
    const key = kitPrintKey(print);
    const same = key === kitPrintKey(lastPrint);
    lastPrint = print;
    if (key === kitPrintKey(startPrint)) { pending = null; return; }
    // settled: the same print two polls running
    if (!same || pending !== key) { pending = key; if (!same) return; }
    if (said.has(key)) return;
    checking = true;
    execFile(process.execPath, ['--check', self], { timeout: 20000, maxBuffer: 1024 * 1024 }, (err, _o, stderr) => {
      if (err) { checking = false; return sayOnce(key, `kit files changed but scripts/devteam.mjs does not parse: ${String(stderr || err.message).split('\n').find((l) => l.trim()) ?? ''}; staying on ${startKit ?? 'unknown'}`); }
      restart(kitPrintDiff(startPrint, print), key).catch((e) => log(`kit watch: ${e?.stack ?? e}`)).finally(() => { checking = false; });
    });
  };
  every(watchTick, watchMs);
  server.listen(port, host);
}

// ===== 11. sessions: workers, planners, messages, phases, gates =====

