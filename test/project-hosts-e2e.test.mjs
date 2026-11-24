// Project hosts end to end (project-hosts@1, PL-S7..S10): headless Chrome against a real gateway on
// *.box.localhost, the image's hub (`devteam.mjs hub`, with dashboards leaving the port to it), two
// real dashboards and a stand-in project with a reserved name. The owner claims the box and signs in
// with a real WebAuthn ceremony, on Chrome's virtual authenticator.
//
// Two things a reader needs. The session cookie is put in production's shape (SameSite=None; Secure)
// after the claim, because on plain http the gateway sets Lax, which a browser would hold back from a
// sandboxed page and so hide whether the gateway refuses it. And Chrome's Local Network Access refuses
// an opaque origin's request to loopback here, which no real box has: so "the fetch threw" proves
// nothing. C10 asserts no request left the frame (the policy held), and C11 replays the request Chrome
// would send, Origin: null with the owner's cookie, to show the gateway's own refusal.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PORTS, bareProject, kit, startDashboard } from './lib/kit.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';

// The gateway reads the hub's port and the block once, at import. lib/kit.mjs has already claimed
// this file a block of 100 ports under a lock (lib/ports.mjs) and set DEVTEAM_HUB_PORT and
// DEVTEAM_PORT_BASE from it: the hub is its first port, the block the 25 after.
const HUB = PORTS;
const P = PORTS + 1;
assert.equal(process.env.DEVTEAM_HUB_PORT, String(HUB));
assert.equal(process.env.DEVTEAM_PORT_BASE, String(P));
process.env.DEVTEAM_HUB_RETRY_MS = '500';
const G = await import('../cloud/gateway.mjs');

const CHROME = { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((ok, no) => { const v = net.createServer(); v.on('error', no); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => ok(port)); }); });
async function poll(f, what, ms = 60000) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try { last = await f(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) assert.fail(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
    await sleep(120);
  }
}
const waitFor = (page, expr, what, ms) => poll(() => page.ev(expr), what, ms);
const waitIn = (page, origin, expr, what, ms) => poll(() => page.evIn(origin, expr), what, ms);
const VIRTUAL = { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };

// The published page tries what a page must not be able to do, and says what happened.
const DOT = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const ARTIFACT = `<!doctype html><title>hello</title><p id="hi">hello from the artifact</p><img src="dot.png" alt=""><script>
window.tryAll = async () => {
  const out = {};
  try { const r = await fetch('/api/data', { credentials: 'include' }); out.data = r.status + ':' + (await r.text()).slice(0, 30); } catch (e) { out.data = 'threw'; }
  try { const r = await fetch('/api/pane-answer', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' }); out.answer = String(r.status); } catch (e) { out.answer = 'threw'; }
  try { out.storage = String(localStorage.length); } catch (e) { out.storage = e.name; }
  try { out.parentStorage = String(parent.localStorage.length); } catch (e) { out.parentStorage = e.name; }
  return out;
};
tryAll().then((probe) => { try { top.postMessage({ probe }, '*'); } catch {} });
</script>`;
const ARTIFACT_JSON = JSON.stringify({ v: 1, title: 'hello', summary: 'a page that tries the dashboard', by: 'supervisor', for: [] });

// A browser-level DevTools connection to a Chrome from openChrome, for what its pages don't offer:
// events, and targets that aren't pages (a sandboxed frame's process, the service worker).
async function devtools(chrome) {
  const profile = chrome.proc.spawnargs.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
  const [port, wsPath] = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('no DevTools socket')); });
  let seq = 0;
  const waits = new Map();
  const handlers = [];
  ws.onmessage = (m) => {
    const o = JSON.parse(m.data);
    if (o.id && waits.has(o.id)) { const w = waits.get(o.id); waits.delete(o.id); return o.error ? w.no(new Error(o.error.message)) : w.ok(o.result); }
    for (const h of handlers) h(o);
    return undefined;
  };
  const call = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const id = ++seq;
    const timer = setTimeout(() => { waits.delete(id); no(new Error(`${method}: no answer in 30 s`)); }, 30000);
    timer.unref();
    waits.set(id, { ok: (v) => { clearTimeout(timer); ok(v); }, no: (e) => { clearTimeout(timer); no(e); } });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const attach = async (pick) => {
    const { targetInfos } = await call('Target.getTargets');
    const t = targetInfos.find(pick);
    if (!t) return null;
    const { sessionId } = await call('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    return {
      send: (method, params) => call(method, params, sessionId),
      on: (h) => handlers.push((o) => { if (o.sessionId === sessionId) h(o); }),
      ev: async (expression) => {
        const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
    };
  };
  return { attach, close: () => ws.close() };
}

async function signedIn(page) {
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return page;
}

// a listen that loses its port fails the rig, instead of leaving it pending with nothing to stop it
const listening = (server, port) => new Promise((ok, no) => {
  const failed = (e) => no(e);
  server.once('error', failed);
  server.listen(port, '127.0.0.1', () => { server.removeListener('error', failed); ok(); });
});

let built = null;
after(async () => { const r = await built?.catch(() => null); await r?.close(); });
const rig = () => (built ??= (async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-hosts-e2e-'));
  const stops = [];
  const r = { tmp };
  r.close = async () => {
    for (const f of stops.reverse()) { try { await f(); } catch {} }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const env = { ...process.env, HOME: home, DEVTEAM_IMAGE_HUB: String(HUB) };
    // the image's hub, as the box's boot starts it
    const hub = spawn(process.execPath, [path.join(kit, 'scripts', 'devteam.mjs'), 'hub'], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let hubOut = '';
    hub.stdout.on('data', (b) => { hubOut += b; });
    hub.stderr.on('data', (b) => { hubOut += b; });
    const killHub = () => { try { process.kill(-hub.pid, 'SIGKILL'); } catch {} };
    process.once('exit', killHub);
    stops.push(async () => {
      process.off('exit', killHub);
      killHub();
      if (hub.exitCode === null && hub.signalCode === null) await new Promise((ok) => { hub.once('exit', ok); setTimeout(ok, 5000).unref(); });
      hub.stdout.destroy();
      hub.stderr.destroy();
    });
    // two projects; alpha has a page committed, so the viewer can open it at its tree
    r.alpha = bareProject(tmp, 'alpha');
    r.beta = bareProject(tmp, 'beta');
    const art = path.join(r.alpha, 'docs/devteam/project/artifacts/hello');
    fs.mkdirSync(art, { recursive: true });
    fs.writeFileSync(path.join(art, 'artifact.json'), ARTIFACT_JSON);
    fs.writeFileSync(path.join(art, 'index.html'), ARTIFACT);
    fs.writeFileSync(path.join(art, 'dot.png'), DOT);
    const git = (...a) => execFileSync('git', ['-c', 'user.email=o@o', '-c', 'user.name=o', ...a], { cwd: r.alpha, encoding: 'utf8' });
    git('add', '-A');
    git('commit', '-qm', 'a page');
    r.tree = git('rev-parse', 'HEAD:docs/devteam/project/artifacts/hello').trim();
    const dashA = startDashboard(r.alpha, env, ['--port', String(P)]);
    stops.push(() => dashA.stop());
    const dashB = startDashboard(r.beta, env, ['--port', String(P + 1)]);
    stops.push(() => dashB.stop());
    // a project whose name can't be a host
    r.wwwHits = [];
    const www = http.createServer((q, s) => {
      if (q.url === '/api/hello') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify({ devteam: 1, name: 'www', root: '/srv/www', port: P + 2 })); }
      r.wwwHits.push(`${q.method} ${q.url}`);
      return s.end('www');
    });
    await listening(www, P + 2);
    stops.push(() => new Promise((ok) => { www.closeAllConnections?.(); www.close(ok); }));
    // two projects that share a name: what reaches either, but the hub's hello
    r.twinHits = [];
    for (const [port, root] of [[P + 3, '/srv/twin'], [P + 4, '/srv/twin2']]) {
      const twin = http.createServer((q, s) => {
        if (q.url === '/api/hello') { s.writeHead(200, { 'content-type': 'application/json' }); return s.end(JSON.stringify({ devteam: 1, name: 'twin', root, port })); }
        r.twinHits.push(`${port} ${q.method} ${q.url}`);
        return s.end('twin');
      });
      await listening(twin, port);
      stops.push(() => new Promise((ok) => { twin.closeAllConnections?.(); twin.close(ok); }));
    }
    await poll(() => /dashboard on http/.test(dashA.out()) && /dashboard on http/.test(dashB.out()), `the dashboards: ${dashA.out().slice(-300)} ${dashB.out().slice(-300)}`, 120000);
    r.list = await poll(async () => {
      const l = await (await fetch(`http://127.0.0.1:${HUB}/instances.json`, { signal: AbortSignal.timeout(5000) })).json();
      return l.instances?.length === 5 && l.instances.every((x) => x.name) ? l.instances : null;
    }, `the hub's list (${hubOut.slice(-300)})`, 90000);
    // the gateway
    const logs = [];
    const ttydPage = path.join(tmp, 'ttyd.html');
    fs.writeFileSync(ttydPage, 'ttyd');
    const uploadsDir = path.join(tmp, 'uploads');
    fs.mkdirSync(uploadsDir, { mode: 0o750 });
    // freePort's port can be taken before the gateway binds it (as lib/kit.mjs's dashboardOnFreePort
    // retries): the address is in the gateway's config, so a lost port means a new gateway
    for (let i = 0; ; i++) {
      r.port = await freePort();
      r.box = `http://box.localhost:${r.port}`;
      r.dir = path.join(tmp, `gw-${i}`);
      logs.length = 0;
      r.g = G.createGateway({ publicUrl: r.box, dir: r.dir, ttydPort: await freePort(), ttydPage, uploadsDir, log: (m) => logs.push(m) });
      try { await listening(r.g.server, r.port); break; } catch (e) { if (e.code !== 'EADDRINUSE' || i >= 4) throw e; }
    }
    r.at = (label) => `http://${label}.box.localhost:${r.port}`;
    stops.push(() => new Promise((ok) => { r.g.server.closeAllConnections?.(); r.g.server.close(ok); }));
    r.reqs = [];
    r.g.server.prependListener('request', (q, s) => {
      const at = { host: q.headers.host, method: q.method, url: q.url, origin: q.headers.origin, site: q.headers['sec-fetch-site'], status: null };
      r.reqs.push(at);
      const end = s.end;
      s.end = function (chunk, ...rest) { if (typeof chunk === 'string' && chunk.length < 200) at.said = chunk; return end.call(this, chunk, ...rest); };
      s.on('finish', () => { at.status = s.statusCode; });
    });
    const token = /claim#([A-Za-z0-9_-]+)/.exec(logs.join('\n'))?.[1];
    assert.ok(token, 'the gateway printed a claim link');
    // the owner claims the box in Chrome
    r.chrome = await openChrome();
    stops.push(() => r.chrome.close());
    const p = await signedIn(await r.chrome.newPage());
    r.page = p;
    stops.push(() => p.close());
    await p.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await p.send('WebAuthn.addVirtualAuthenticator', { options: VIRTUAL });
    await go(p, `${r.box}/auth/claim#${token}`);
    await waitFor(p, `document.readyState === 'complete' && !!document.getElementById('go')?.onclick`, 'the claim page');
    await p.click('#go');
    await waitFor(p, `location.origin + location.pathname === ${JSON.stringify(`${r.box}/`)}`, 'the hub, after the claim');
    r.credentials = (await p.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
    assert.equal(r.credentials.length, 1, 'one passkey');
    // production's cookie (see the top of this file)
    const { cookies } = await p.send('Network.getCookies', { urls: [`${r.box}/`] });
    r.session = cookies.find((c) => c.name === 'devteam_session').value;
    await p.send('Network.setCookie', { name: 'devteam_session', value: r.session, domain: '.box.localhost', path: '/', secure: true, httpOnly: true, sameSite: 'None' });
    // the owner publishes alpha's page on the gateway's own confirm page, as the Library's Publish opens it
    await r.g.pollPush().catch(() => {});
    await go(p, `${r.box}/public/publish?project=alpha&slug=hello`);
    await waitFor(p, `document.readyState === 'complete' && !!document.querySelector('input[data-slug="hello"]') && !!document.getElementById('go')?.onclick`, 'the publish page');
    await p.ev(`(() => { const x = document.querySelector('input[data-slug="hello"]'); if (!x.checked) x.click(); return x.checked; })()`);
    await p.click('#go');
    await poll(() => (JSON.parse(fs.readFileSync(path.join(r.dir, 'state.json'), 'utf8')).public?.alpha?.artifacts?.hello?.tree === r.tree), `the gateway's copy of hello at ${r.tree}`);
    r.dt = await devtools(r.chrome);
    stops.push(() => r.dt.close());
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "if (window === top) { window.__probe = []; addEventListener('message', (e) => { if (e.data && e.data.probe) window.__probe.push(e.data.probe); }); }" });
    return r;
  } catch (e) { await r.close(); throw e; }
})());
// built once, before any test, under its own bound: no single test's timeout pays for it.
// 240 s, under the 300 s CI gives a whole file (test/run.mjs), so the hook fails first and says so.
if (canDrive) before(() => rig(), { timeout: 240000 });

// Page.navigate answers only once the response has come, and the helper fails any call Chrome
// hasn't answered in 30 s: a dashboard's first page on a loaded machine can take longer. So a
// navigation is sent, not awaited, and what is waited for is the page, under poll's bound. It goes by
// about:blank first, so it is always a new document (a change of hash alone would keep the old one),
// and no wait after it can be met by the page it left.
const blank = async (p) => {
  await p.send('Page.navigate', { url: 'about:blank' });
  await poll(() => p.ev("location.href === 'about:blank'"), 'a blank page');
};
const go = async (p, url) => {
  await blank(p);
  p.send('Page.navigate', { url }).catch(() => {});
  await poll(() => p.ev("location.href !== 'about:blank'"), `a page at ${url}`);
};
// a reload, as the browser's own (always a new document): the old one is marked, and gone after
const reload = async (p) => {
  await p.ev('window.__left = true');
  p.send('Page.reload').catch(() => {});
  await poll(() => p.ev('window.__left !== true'), 'the page, reloaded');
};
const onHub = async (r, hash = '#overview') => {
  await go(r.page, `${r.box}/${hash}`);
  // its tabs, not the Overview's cards: a hub opened on a project doesn't draw those
  await waitFor(r.page, `typeof select === 'function' && ['alpha', 'beta', 'www', 'twin'].every((n) => [...document.querySelectorAll('#tabs [role=tab]')].some((x) => x.textContent === n))`, 'the hub with its projects');
};
const shownFrame = `(() => { const f = [...document.querySelectorAll('#frames iframe')].filter((x) => !x.hidden); return f.length === 1 ? f[0].getAttribute('src') : null; })()`;
const dashboardOf = async (r, name) => {
  await go(r.page, `${r.at(name)}/`);
  await waitFor(r.page, `location.host === ${JSON.stringify(`${name}.box.localhost:${r.port}`)} && document.title === ${JSON.stringify(`devteam · ${name}`)}`, `${name}'s dashboard`);
};
// A second browser, nothing shared with the first. With the session it is another device of the owner's.
async function otherBrowser(t, r, { session = false, passkey = false } = {}) {
  const chrome = await openChrome();
  t.after(() => chrome.close());
  const q = await signedIn(await chrome.newPage());
  if (session) await q.send('Network.setCookie', { name: 'devteam_session', value: r.session, domain: '.box.localhost', path: '/', secure: true, httpOnly: true, sameSite: 'None' });
  if (passkey) {
    await q.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await q.send('WebAuthn.addVirtualAuthenticator', { options: VIRTUAL });
    for (const credential of r.credentials) await q.send('WebAuthn.addCredential', { authenticatorId, credential });
  }
  return q;
}
// Every address a page's elements carry (a Copy link's too), and its own.
const ADDRESSES = `[location.href, ...[...document.querySelectorAll('[href],[src],[action],[data-copy]')].flatMap((e) => ['href', 'src', 'action', 'data-copy'].map((a) => e.getAttribute(a)).filter(Boolean).map((v) => { try { return new URL(v, location.href).href; } catch { return v; } }))]`;
// An address "names a port" when it reaches a project or the hub by its port. The gateway's own port
// is in every address here only because a test can't listen on 80, so it is allowed.
// reserved names no address here should be on (cloud/gateway.mjs RESERVED_LABELS), written out so a
// change to the gateway's list can't change what this scan looks for. Not term: term.<box> is the box's
// own terminal, which the hub frames (hub.html, box.terminal).
const RESERVED = ['public', 'www'];
function namingPorts(r, addresses) {
  const block = new Set([HUB, ...Array.from({ length: 25 }, (_, i) => P + i)].map(String));
  return addresses.filter((a) => {
    let u;
    try { u = new URL(a); } catch { return false; }
    if (!/^https?:$/.test(u.protocol)) return false;
    if (block.has(u.port) || ['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname)) return true;
    if (!u.hostname.endsWith('.localhost')) return false;
    if (RESERVED.includes(u.hostname.split('.')[0])) return true;
    return u.port !== String(r.port) || /^\d+\./.test(u.hostname);
  });
}
const raw = (r, host, route, { method = 'GET', headers = {}, body } = {}) => new Promise((ok, no) => {
  const q = http.request({ host: '127.0.0.1', port: r.port, method, path: route, agent: false, headers: { host, ...headers } }, (s) => { let b = ''; s.on('data', (c) => { b += c; }); s.on('end', () => ok({ status: s.statusCode, headers: s.headers, body: b })); });
  q.on('error', no);
  q.end(body);
});

test('C1 PL-S7: each project shows its own dashboard at its own host', CHROME, async () => {
  const r = await rig();
  for (const name of ['alpha', 'beta']) {
    await dashboardOf(r, name);
    assert.equal(await r.page.ev(`fetch('/api/hello').then((x) => x.json()).then((j) => j.name)`), name, `${name}'s host reaches ${name}`);
  }
});

test("C2 PL-S7: the hub frames each project at its host, and the frame shows that project", CHROME, async () => {
  const r = await rig();
  await onHub(r);
  for (const name of ['alpha', 'beta']) {
    const root = r.list.find((x) => x.name === name).root;
    await r.page.ev(`select(${JSON.stringify(root)})`);
    await waitFor(r.page, `${shownFrame} === ${JSON.stringify(`${r.at(name)}/`)}`, `${name}'s frame at its host`);
    assert.equal(await waitIn(r.page, r.at(name), `document.title === ${JSON.stringify(`devteam · ${name}`)} && fetch('/api/hello').then((x) => x.json()).then((j) => j.name)`, `${name}'s dashboard in the frame`), name);
  }
});

test('C3 PL-S7: a reload, and a second browser with the session, show the same project', CHROME, async (t) => {
  const r = await rig();
  await onHub(r, '#beta');
  await waitFor(r.page, `${shownFrame} === ${JSON.stringify(`${r.at('beta')}/`)}`, "the hub on beta's address");
  await reload(r.page);
  await waitFor(r.page, `typeof select === 'function' && location.hash === '#beta' && ${shownFrame} === ${JSON.stringify(`${r.at('beta')}/`)}`, 'the hub still on beta after a reload');
  await dashboardOf(r, 'alpha');
  await reload(r.page);
  await waitFor(r.page, `document.readyState === 'complete' && location.host.startsWith('alpha.') && document.title === 'devteam · alpha'`, 'alpha after a reload');
  const q = await otherBrowser(t, r, { session: true });
  await go(q, `${r.at('beta')}/`);
  await waitFor(q, `location.host.startsWith('beta.') && document.title === 'devteam · beta'`, 'beta in a second browser');
  await go(q, `${r.box}/#alpha`);
  await waitFor(q, `typeof select === 'function' && ${shownFrame} === ${JSON.stringify(`${r.at('alpha')}/`)}`, "the hub's address for alpha in a second browser");
});

test('C4 PL-S7: no address in the bar, a link, a Copy link or Open in a new tab names a port', CHROME, async () => {
  const r = await rig();
  const seen = [];
  // the hub's Overview, its cards drawn, and each card's Open in a new tab
  await onHub(r);
  await waitFor(r.page, `document.querySelectorAll('.ov-card').length === 5`, "the Overview's cards");
  await r.page.ev(`window.__opened = []; window.open = (...a) => { window.__opened.push(String(a[0])); return null; }`);
  for (const name of ['alpha', 'beta']) {
    await r.page.ev(`[...document.querySelectorAll('.ov-card')].find((c) => c.querySelector('.ov-name')?.textContent === ${JSON.stringify(name)}).querySelector('.menu-btn').click()`);
    await r.page.ev(`[...document.querySelectorAll('.menu-pop button')].find((b) => b.textContent === 'Open in a new tab').click()`);
  }
  const opened = await r.page.ev('window.__opened');
  assert.deepEqual(opened, [`${r.at('alpha')}/`, `${r.at('beta')}/`], 'Open in a new tab opens each project host');
  // the three cards with no host: their menus open, and offer no new tab
  const noHost = await r.page.ev(`[...document.querySelectorAll('.ov-card')]
    .filter((c) => ['www', 'twin'].includes(c.querySelector('.ov-name')?.textContent))
    .map((c) => { c.querySelector('.menu-btn').click(); const m = [...document.querySelectorAll('.menu-pop button')].map((b) => b.textContent); closeMenu(); return m; })`);
  assert.deepEqual(noHost, [['Open its dashboard'], ['Open its dashboard'], ['Open its dashboard']], 'a card with no host offers no new tab');
  seen.push(...opened, ...await r.page.ev(ADDRESSES));
  // a project in the hub's frame
  await r.page.ev(`select(${JSON.stringify(r.list.find((x) => x.name === 'alpha').root)})`);
  await waitFor(r.page, `${shownFrame} === ${JSON.stringify(`${r.at('alpha')}/`)}`, "alpha's frame");
  await waitIn(r.page, r.at('alpha'), `document.title === 'devteam · alpha' && document.querySelectorAll('a[href]').length > 3`, "alpha's links, in the frame");
  seen.push(...await r.page.ev(ADDRESSES), ...await r.page.evIn(r.at('alpha'), ADDRESSES));
  // the dashboard on its own: its Library, with the published page's Publish and Copy public link
  await go(r.page, `${r.at('alpha')}/#library`);
  const copy = await waitFor(r.page, `location.hash.startsWith('#library') && [...document.querySelectorAll('[data-copy]')].map((e) => e.getAttribute('data-copy')).find((v) => v.endsWith('/hello/'))`, "alpha's Library, with Copy public link");
  assert.equal(copy, `${r.at('alpha')}/hello/`, 'the public link is the project host');
  seen.push(...await r.page.ev(ADDRESSES));
  assert.ok(seen.some((a) => a.startsWith(`${r.at('alpha')}/`)), 'the scan saw the project host');
  assert.deepEqual(namingPorts(r, seen), []);
});

test('C5 PL-S8: signed out, a project address signs in on the box and lands back on it, hash included', CHROME, async (t) => {
  const r = await rig();
  const q = await otherBrowser(t, r, { passkey: true });
  const want = `${r.at('alpha')}/#board?goal=g-1`;
  await go(q, want);
  await waitFor(q, `location.origin + location.pathname === ${JSON.stringify(`${r.box}/auth/login`)} && !!document.getElementById('go')?.onclick`, 'the sign-in page on the box');
  assert.equal(new URL(await q.ev('location.href')).searchParams.get('next'), want, 'sign-in carries the whole address');
  await q.click('#go');
  await waitFor(q, `location.host.startsWith('alpha.') && document.title.includes('alpha')`, 'the dashboard after sign-in');
  assert.equal(await q.ev('location.href'), want);
});

test('C5b PL-S8: signed out, a project host answers 401 to its API, and a made-up name answers as a real one', CHROME, async () => {
  const r = await rig();
  const own = r.at('alpha');
  // each request tagged, so the owner's open dashboard polling the gateway meanwhile isn't counted
  const tag = `c5b=${Date.now()}`;
  const fetchHeaders = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };
  const read = await raw(r, `alpha.box.localhost:${r.port}`, `/api/data?${tag}`, { headers: fetchHeaders });
  assert.deepEqual([read.status, read.body], [401, 'sign in with your passkey'], 'GET /api/data, signed out');
  const act = await raw(r, `alpha.box.localhost:${r.port}`, `/api/pane-answer?${tag}`, { method: 'POST', headers: { origin: own, ...fetchHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ pane: 'x', answer: 'y' }) });
  assert.deepEqual([act.status, act.body], [401, 'sign in with your passkey'], 'POST /api/pane-answer, signed out');
  // not only /api/: the dashboard's own pages of a committed artifact, and its viewer, need the session too
  for (const route of ['/artifact/main/hello/index.html', '/view/artifact/hello']) {
    const a = await raw(r, `alpha.box.localhost:${r.port}`, `${route}?${tag}`, { headers: fetchHeaders });
    assert.deepEqual([a.status, a.body], [401, 'sign in with your passkey'], `GET ${route}, signed out`);
  }
  assert.equal(r.reqs.filter((x) => x.url.includes(tag)).length, 4, 'all four reached the gateway');
  // a navigation: the same answer for a real name and a made-up one
  const nav = { 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' };
  const [real, made] = await Promise.all(['alpha', 'nosuchname'].map((n) => raw(r, `${n}.box.localhost:${r.port}`, '/', { headers: nav })));
  assert.equal(real.status, 401);
  assert.deepEqual([made.status, made.headers['content-type'], made.body], [real.status, real.headers['content-type'], real.body], 'a made-up name answers as a real one, signed out');
});

test("C6 PL-S8: the hub, its Your sign-in and the Passkeys page work on the box's name", CHROME, async () => {
  const r = await rig();
  await onHub(r);
  assert.equal(await r.page.ev('location.host'), `box.localhost:${r.port}`);
  await r.page.ev(`location.hash = '#settings'`);
  // the owner's passkey is listed under Your sign-in (kit-249), which took the Manage link's place
  await waitFor(r.page, `document.querySelectorAll('#hub-settings .set-row.method').length === 1 && document.querySelector('#hub-settings .set-row.method')?.textContent.startsWith('Passkey')`, "Your sign-in, listing the passkey");
  const href = `${r.box}/auth/passkeys`;
  await go(r.page, href);
  await waitFor(r.page, `location.href === ${JSON.stringify(href)} && document.querySelector('h1')?.textContent === 'Passkeys' && document.querySelectorAll('li').length === 1`, 'the Passkeys page, listing the passkey');
});

test("C7 PL-S8: a push's notificationclick selects that project in the open hub", CHROME, async () => {
  const r = await rig();
  await onHub(r);
  await r.page.ev(`navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then((x) => { x.active.postMessage({ wake: 1 }); return 1; })`);
  const sw = await poll(() => r.dt.attach((x) => x.type === 'service_worker' && x.url === `${r.box}/sw.js`), "the hub's service worker");
  // Chrome can't click a notification headless: the worker's own handler, given one
  const said = await sw.ev(`(() => { const e = new Event('notificationclick'); e.notification = { close() {}, data: { url: '/#beta' } }; e.waitUntil = (x) => { self.__click = x; }; self.dispatchEvent(e); return Promise.resolve(self.__click).then(() => 'clicked'); })()`);
  assert.equal(said, 'clicked');
  await waitFor(r.page, `location.hash === '#beta' && ${shownFrame} === ${JSON.stringify(`${r.at('beta')}/`)}`, 'the hub on beta');
});

test('C8 PL-S9: a published page opens with no session', CHROME, async (t) => {
  const r = await rig();
  const q = await otherBrowser(t, r);
  await go(q, `${r.at('alpha')}/hello/`);
  await waitFor(q, `document.getElementById('hi')?.textContent === 'hello from the artifact'`, 'the page, signed out');
  assert.equal(await q.ev('location.href'), `${r.at('alpha')}/hello/`);
});

test("C9 PL-S9: signed in, the page as a document is the owner's wrapper, with the viewer at the published version", CHROME, async () => {
  const r = await rig();
  await go(r.page, `${r.at('alpha')}/hello/`);
  await waitFor(r.page, `location.href === ${JSON.stringify(`${r.box}/w/alpha/hello/`)}`, "the owner's wrapper");
  const viewer = await waitIn(r.page, r.at('alpha'), `location.pathname === '/view/artifact/hello' && document.body.innerText.includes('the published version') && location.href`, 'the viewer at the published version');
  assert.equal(new URL(viewer).searchParams.get('at'), `tree:${r.tree}`);
  await waitFor(r.page, 'window.__probe.length > 0', "the page's script ran in the viewer");
});

test("C10 PL-S9: signed in, the page's script reaches neither /api nor the dashboard's storage", CHROME, async () => {
  const r = await rig();
  await go(r.page, `${r.at('alpha')}/`);
  await waitFor(r.page, `document.title === 'devteam · alpha'`, "alpha's dashboard");
  await r.page.ev(`localStorage.setItem('e2e-secret', 'the owner')`);
  r.reqs.length = 0;
  await go(r.page, `${r.at('alpha')}/hello/`);
  // what the page's script said of its own first run, read before anything else can fail
  const first = await waitFor(r.page, `location.pathname.startsWith('/w/') && window.__probe?.[0]`, "the page's script, in the viewer");
  assert.deepEqual([first.storage, first.parentStorage], ['SecurityError', 'SecurityError'], "it can't read the dashboard's localStorage");
  const frame = await poll(() => r.dt.attach((x) => x.type === 'iframe' && x.url.includes('/artifact/tree/') && x.url.includes('/hello/')), "the page's own frame");
  const sent = [];
  frame.on((o) => { if (o.method === 'Network.requestWillBeSent') sent.push(o.params.request.url); });
  await frame.send('Network.enable');
  const out = await poll(() => frame.ev(`typeof tryAll === 'function' && tryAll()`), "the page's script");
  await sleep(300);
  assert.deepEqual([out.data, out.answer], ['threw', 'threw'], 'neither request gave it an answer');
  assert.deepEqual(sent.filter((u) => new URL(u).pathname.startsWith('/api/')), [], 'its policy kept the requests in the browser');
  assert.deepEqual(r.reqs.filter((x) => x.url.startsWith('/api/') && x.site !== 'same-origin'), [], 'and none reached the gateway');
});

test("C10b PL-S9: signed in, the gateway's public copy (?plain) is sandboxed: it can't read the dashboard's storage", CHROME, async () => {
  const r = await rig();
  await go(r.page, `${r.at('alpha')}/`);
  await waitFor(r.page, `document.title === 'devteam · alpha'`, "alpha's dashboard");
  await r.page.ev(`localStorage.setItem('e2e-secret', 'the owner')`);
  await go(r.page, `${r.at('alpha')}/hello/?plain`);
  const first = await waitFor(r.page, `location.search === '?plain' && window.__probe?.[0]`, "the page's script, as the public sees it");
  assert.equal(await r.page.ev('location.href'), `${r.at('alpha')}/hello/?plain`, 'not sent to the wrapper');
  assert.deepEqual([first.storage, first.parentStorage], ['SecurityError', 'SecurityError'], "it can't read the dashboard's localStorage");
  assert.equal(await r.page.ev('self.origin'), 'null', 'its origin is opaque');
});

test("C11 PL-S9: what such a page would send (Origin: null, the owner's cookie) the gateway refuses", CHROME, async () => {
  const r = await rig();
  // what Chrome sends for the page in the viewer: its own image, a cross-site request though on the same host
  r.reqs.length = 0;
  await go(r.page, `${r.at('alpha')}/hello/`);
  const dot = await poll(() => r.reqs.find((x) => x.url.endsWith('/hello/dot.png') && x.status !== null), "the page's image, at the gateway");
  assert.equal(dot.site, 'cross-site', 'Chrome sends an opaque origin\'s requests as cross-site');
  const host = `alpha.box.localhost:${r.port}`;
  const cookie = `devteam_session=${r.session}`;
  const same = await raw(r, host, '/api/data', { headers: { cookie, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' } });
  assert.equal(same.status, 200, 'the session is good: the same read from the dashboard answers');
  const cross = { cookie, origin: 'null', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' };
  const read = await raw(r, host, '/api/data', { headers: cross });
  // each by the gateway's own words: the kit behind it refuses Origin null too, and would hide a gateway that stopped
  assert.deepEqual([read.status, read.body], [403, "not for another site's page"], 'GET /api/data from Origin null');
  assert.equal(read.headers['access-control-allow-origin'], undefined);
  const write = await raw(r, host, '/api/pane-answer', { method: 'POST', headers: { ...cross, 'content-type': 'application/json' }, body: '{}' });
  assert.deepEqual([write.status, write.body], [403, "only from this box's own pages"], 'POST /api/pane-answer from Origin null');
});

test('C12 PL-S9: public.<box> answers 421', CHROME, async () => {
  const r = await rig();
  assert.equal((await raw(r, `public.box.localhost:${r.port}`, '/alpha/hello/')).status, 421);
});

test('C12b PL-S10: <port>.<box> answers 421', CHROME, async () => {
  const r = await rig();
  assert.equal((await raw(r, `${P}.box.localhost:${r.port}`, '/', { headers: { cookie: `devteam_session=${r.session}` } })).status, 421);
});

test("C13 PL-S10: a page on one project's host reads nothing of another's, and acts on nothing", CHROME, async () => {
  const r = await rig();
  await dashboardOf(r, 'beta');
  r.reqs.length = 0;
  const url = JSON.stringify(`${r.at('alpha')}/api/data`);
  const got = await r.page.ev(`Promise.all([
    fetch(${url}, { credentials: 'include' }).then(async (x) => 'read ' + (await x.text()).length, () => 'threw'),
    fetch(${url}, { credentials: 'include', mode: 'no-cors' }).then(async (x) => x.type + ' ' + (await x.text()).length, () => 'threw'),
  ])`);
  assert.deepEqual(got, ['threw', 'opaque 0']);
  const asked = r.reqs.filter((x) => x.host === `alpha.box.localhost:${r.port}` && x.url === '/api/data');
  assert.deepEqual(asked.map((x) => [x.site, x.status, x.said]), [['same-site', 403, "not for another site's page"], ['same-site', 403, "not for another site's page"]], 'the gateway refused both');
  // an act: a simple POST (no preflight), with the owner's cookie
  r.reqs.length = 0;
  const act = await r.page.ev(`fetch(${JSON.stringify(`${r.at('alpha')}/api/pane-answer`)}, { method: 'POST', credentials: 'include', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: '{}' }).then((x) => x.type, () => 'threw')`);
  assert.equal(act, 'opaque');
  const posted = await poll(() => r.reqs.find((x) => x.url === '/api/pane-answer' && x.status !== null), 'the POST at the gateway');
  assert.deepEqual([posted.origin, posted.status, posted.said], [r.at('beta'), 403, "only from this box's own pages"], "the gateway refused beta's POST to alpha");
});

test('C14 PL-S10: a project with a reserved name gets no host, and its tab says why', CHROME, async () => {
  const r = await rig();
  await onHub(r);
  await r.page.ev(`select('/srv/www')`);
  await waitFor(r.page, `document.body.innerText.includes('This project has no address on this box: its name is reserved')`, "the tab's reason");
  assert.equal(await r.page.ev(shownFrame), null, 'no frame for it');
  assert.equal(await r.page.ev(`[...document.querySelectorAll('#frames iframe')].some((f) => (f.getAttribute('src') ?? '').includes('www.box.localhost'))`), false);
  // and at the gateway, signed in: no host, and the project behind the name is never asked
  r.wwwHits.length = 0;
  for (const route of ['/', '/api/data']) {
    const a = await raw(r, `www.box.localhost:${r.port}`, route, { headers: { cookie: `devteam_session=${r.session}`, 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
    assert.equal(a.status, 421, `${route} on a reserved name`);
  }
  assert.deepEqual(r.wwwHits, [], 'the www project was asked nothing but its hello');
});

test('C14b PL-S10: two projects sharing a name get no host: the tab says why, and the gateway reaches neither', CHROME, async () => {
  const r = await rig();
  await onHub(r);
  const twins = r.list.filter((x) => x.name === 'twin').map((x) => x.root).sort();
  assert.deepEqual(twins, ['/srv/twin', '/srv/twin2']);
  await r.page.ev(`select('/srv/twin')`);
  await waitFor(r.page, `document.body.innerText.includes('This project has no address on this box: its name is shared')`, "the twin tab's reason");
  assert.equal(await r.page.ev(shownFrame), null, 'no frame for it');
  r.twinHits.length = 0;
  for (const route of ['/', '/api/data']) {
    const a = await raw(r, `twin.box.localhost:${r.port}`, route, { headers: { cookie: `devteam_session=${r.session}`, 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
    assert.equal(a.status, 503, `${route} on a shared name`);
    assert.match(a.body, /Two projects are named twin/, `${route}: the gateway's own page for a shared name`);
  }
  assert.deepEqual(r.twinHits, [], 'neither twin was asked');
});
