#!/usr/bin/env node
// The dev links chain in a real browser: Chrome over the DevTools protocol against a real dashboard,
// a real Vite app and (the second half) a real gateway on *.localhost, by hand (needs Chrome and
// npm's network once; not in CI). Node 22+.
//   node test/browser/dev-links.mjs
// A synthetic test can't show what a popup, the hub's sandboxed frame, a clipboard or an HMR socket
// does: this drives them with real input events.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.resolve(here, '..', '..', 'docs', 'devteam');
const CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'google-chrome', 'chromium'];
const chromeBin = CHROMES.find((c) => { try { return spawnSync(c, ['--version'], { stdio: 'ignore', timeout: 30000 }).status === 0; } catch { return false; } });
if (!chromeBin) { console.log('no Chrome here; skipped'); process.exit(0); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(f, what, ms = 45000) {
  const end = Date.now() + ms;
  let last;
  for (;;) {
    try { last = await f(); if (last) return last; } catch (e) { last = e; }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
    await sleep(150);
  }
}
const say = (s) => console.log(s);
const stepOk = (s) => say(`ok   ${s}`);
const freePort = () => new Promise((resolve, reject) => { const v = net.createServer(); v.on('error', reject); v.listen(0, '127.0.0.1', () => { const { port } = v.address(); v.close(() => resolve(port)); }); });
// A block of ports nothing holds, away from the machine's real hub and instance block.
async function portBlock(n) {
  for (let i = 0; i < 40; i++) {
    const base = 26000 + Math.floor(Math.random() * 4000);
    const free = await Promise.all(Array.from({ length: n }, (_, k) => new Promise((resolve) => { const v = net.createServer(); v.once('error', () => resolve(false)); v.listen(base + k, '127.0.0.1', () => v.close(() => resolve(true))); })));
    if (free.every(Boolean)) return base;
  }
  throw new Error('no free block of ports');
}

// ===== the DevTools protocol, over Node's global WebSocket =====
class Cdp {
  constructor(url) { this.url = url; this.seq = 0; this.waits = new Map(); this.sessions = new Map(); this.urls = new Map(); this.listeners = []; }
  open() { return new Promise((resolve, reject) => { const ws = new WebSocket(this.url); ws.onopen = () => { this.ws = ws; resolve(this); }; ws.onerror = (e) => reject(e.error ?? new Error('cdp socket')); ws.onmessage = (m) => this.incoming(JSON.parse(m.data)); }); }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const msg = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise((resolve, reject) => {
      this.waits.set(id, { resolve, reject, method });
      this.ws.send(msg);
    });
  }
  incoming(m) {
    if (m.id && this.waits.has(m.id)) {
      const w = this.waits.get(m.id);
      this.waits.delete(m.id);
      return m.error ? w.reject(new Error(`${w.method}: ${m.error.message}`)) : w.resolve(m.result);
    }
    for (const l of this.listeners) l(m);
    return undefined;
  }
  on(fn) { this.listeners.push(fn); }
}

class Browser {
  async start(userDir) {
    this.proc = spawn(chromeBin, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const wsUrl = await new Promise((resolve, reject) => {
      this.proc.stderr.on('data', (b) => { err += b; const m = /DevTools listening on (ws:\S+)/.exec(err); if (m) resolve(m[1]); });
      this.proc.on('exit', (c) => reject(new Error(`chrome exited ${c}: ${err}`)));
    });
    this.cdp = await new Cdp(wsUrl).open();
    this.sessions = new Map(); // sessionId -> { targetId, type, sockets: [] }
    this.cdp.on((m) => this.event(m));
    await this.cdp.send('Target.setDiscoverTargets', { discover: true });
    await this.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    return this;
  }
  event(m) {
    if (m.method === 'Target.attachedToTarget') return this.attached(m.params);
    if (m.method === 'Target.targetInfoChanged' || m.method === 'Target.targetCreated') { for (const s of this.sessions.values()) if (s.targetId === m.params.targetInfo.targetId) s.url = m.params.targetInfo.url; return undefined; }
    if (m.method === 'Target.detachedFromTarget') { this.sessions.delete(m.params.sessionId); return undefined; }
    const s = m.sessionId ? this.sessions.get(m.sessionId) : null;
    if (!s) return undefined;
    if (m.method === 'Network.webSocketCreated') s.sockets.push({ url: m.params.url, requestId: m.params.requestId, status: null, frames: [] });
    if (m.method === 'Network.webSocketHandshakeResponseReceived') { const w = s.sockets.find((x) => x.requestId === m.params.requestId); if (w) w.status = m.params.response.status; }
    if (m.method === 'Network.webSocketFrameReceived') { const w = s.sockets.find((x) => x.requestId === m.params.requestId); if (w) w.frames.push(m.params.response.payloadData); }
    if (m.method === 'Network.requestWillBeSent') s.requests.push(m.params.request.url);
    if (m.method === 'Network.loadingFinished') s.bytes += m.params.encodedDataLength;
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) { s.url = m.params.frame.url; s.navigations += 1; }
    return undefined;
  }
  async attached({ sessionId, targetInfo, waitingForDebugger }) {
    const s = { sessionId, targetId: targetInfo.targetId, type: targetInfo.type, url: targetInfo.url, sockets: [], requests: [], navigations: 0, bytes: 0 };
    this.sessions.set(sessionId, s);
    const c = this.cdp;
    if (['page', 'iframe'].includes(targetInfo.type)) {
      // sent in order and not awaited: a target waiting for the debugger answers some only once it runs
      for (const [m, p] of [['Network.enable', {}], ['Page.enable', {}], ['Runtime.enable', {}], ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }]]) c.send(m, p, sessionId).catch(() => {});
    }
    if (waitingForDebugger) c.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
  }
  pages() { return [...this.sessions.values()].filter((s) => s.type === 'page'); }
  async newPage(url) {
    const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
    const s = await until(() => [...this.sessions.values()].find((x) => x.targetId === targetId), 'a session for the new tab');
    await this.cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, s.sessionId).catch(() => {});
    if (url) await this.navigate(s, url);
    return s;
  }
  async navigate(s, url) {
    const before = s.navigations;
    await this.cdp.send('Page.navigate', { url }, s.sessionId);
    await until(() => s.navigations > before, `the tab to navigate to ${url}`);
  }
  // The frame (in any session) whose URL starts with prefix, or the session's main frame.
  async frameWhere(prefix) {
    const walk = (t, out) => { out.push(t.frame); for (const c of t.childFrames ?? []) walk(c, out); return out; };
    for (const s of this.sessions.values()) {
      if (!['page', 'iframe'].includes(s.type)) continue;
      let tree;
      try { tree = await this.cdp.send('Page.getFrameTree', {}, s.sessionId); } catch { continue; }
      const f = walk(tree.frameTree, []).find((x) => x.url.startsWith(prefix));
      if (f) return { session: s, frameId: f.id, url: f.url };
    }
    return null;
  }
  async evalIn(prefix, expression) {
    const f = await this.frameWhere(prefix);
    if (!f) throw new Error(`no frame ${prefix}`);
    return this.evalFrame(f, expression);
  }
  async evalFrame(f, expression) {
    const { executionContextId } = await this.cdp.send('Page.createIsolatedWorld', { frameId: f.frameId, worldName: 'dt', grantUniveralAccess: true }, f.session.sessionId);
    const r = await this.cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true }, f.session.sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  // A real click at a real place on the screen, so a popup and a clipboard write count as the user's.
  async click(pagePrefix, framePrefix, selector) {
    const page = this.pages().find((s) => (s.url ?? '').startsWith(pagePrefix));
    assert.ok(page, `a tab at ${pagePrefix}`);
    await this.cdp.send('Page.bringToFront', {}, page.sessionId).catch(() => {});
    const rect = await this.evalIn(framePrefix, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('no ' + ${JSON.stringify(selector)}); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    let ox = 0; let oy = 0;
    if (framePrefix !== pagePrefix) {
      const off = await this.evalIn(pagePrefix, `(() => { const f = [...document.querySelectorAll('iframe')].find((x) => !x.hidden && x.src.startsWith(${JSON.stringify(framePrefix)})); if (!f) throw new Error('no iframe'); const r = f.getBoundingClientRect(); return { x: r.left, y: r.top }; })()`);
      ox = off.x; oy = off.y;
    }
    const x = rect.x + ox;
    const y = rect.y + oy;
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await this.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }, page.sessionId);
  }
  // What is on the clipboard: read from a tab of its own at url, top level (the hub's frame allows
  // writing only), with the permission granted to that origin.
  async readClipboard(url) {
    await this.cdp.send('Browser.grantPermissions', { origin: new URL(url).origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    const tab = await this.newPage(url);
    await this.cdp.send('Page.bringToFront', {}, tab.sessionId).catch(() => {});
    const f = { session: tab, frameId: (await this.cdp.send('Page.getFrameTree', {}, tab.sessionId)).frameTree.frame.id };
    const text = await this.evalFrame(f, 'navigator.clipboard.readText()');
    await this.cdp.send('Target.closeTarget', { targetId: tab.targetId });
    return text;
  }
  async kill() { try { this.proc?.kill('SIGKILL'); } catch {} }
}

// ===== the throwaway project =====
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-dev-links-'));
// tmux's socket path has a length limit a long TMPDIR can pass
const tmuxDir = fs.mkdtempSync(path.join(fs.existsSync('/tmp') ? '/tmp' : os.tmpdir(), 'dt-tmux-'));
const repo = path.join(base, 'repo');
const DT = path.join(repo, 'docs/devteam/scripts/devteam.mjs');
const nodeBin = path.dirname(process.execPath);
const procs = [];
let browser;
let env;

function git(args, cwd = repo) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function dt(args, role = {}, cwd = repo) {
  const r = spawnSync(process.execPath, [DT, ...args], { cwd, env: { ...env, ...role }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`devteam ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
function makeRepo() {
  fs.mkdirSync(repo);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  fs.cpSync(kit, path.join(repo, 'docs', 'devteam'), { recursive: true, filter: (p) => !/[\\/](project|run)([\\/]|$)/.test(p.slice(kit.length)) });
  dt(['init', '--name', 'demo']);
  const sf = path.join(repo, 'docs/devteam/project/settings.md');
  fs.writeFileSync(sf, fs.readFileSync(sf, 'utf8').replace('"gates": {}', '"gates": {}, "agent_command": "true", "resume_command": "true"'));
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
}
const WORKER = { DEVTEAM_ROLE: 'worker', DEVTEAM_TICKET: 'demo-01-page' };
function makeApp() {
  const app = path.join(repo, '.worktrees', 'demo-01-page');
  git(['worktree', 'add', '-q', '-b', 'ticket/demo-01-page', app, 'HEAD']);
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'dev-links-app', private: true, type: 'module' }));
  fs.writeFileSync(path.join(app, 'index.html'), '<!doctype html><title>Vite page</title><div id="app"></div><script>document.documentElement.dataset.boot = String(performance.timeOrigin)</script><script type="module" src="/main.js"></script>\n');
  writeMain(app, 'hello one');
  say('installing vite (npm, the one network step)');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', 'vite@5'], { cwd: app, stdio: 'inherit', env: { ...process.env, PATH: `${nodeBin}${path.delimiter}${process.env.PATH}`, TMUX_TMPDIR: tmuxDir } });
  return app;
}
function writeMain(app, text) {
  fs.writeFileSync(path.join(app, 'main.js'), `document.getElementById('app').textContent = ${JSON.stringify(text)};\nif (import.meta.hot) import.meta.hot.accept();\n`);
}
function startDashboard(port) {
  const p = spawn(process.execPath, [DT, 'dashboard', '--port', String(port)], { cwd: repo, env, stdio: 'ignore' });
  procs.push(p);
}

// ===== the card, the same on a laptop and through the gateway =====
// The framed Library shows the card live; Copy and Open from it; the page, its HMR socket, an edit.
async function throughCard({ hubUrl, dashUrl, name, previewUrl, socketPrefix, app }) {
  await browser.evalIn(dashUrl, `location.hash = '#library'`);
  const card = `[data-preview="${name}"]`;
  await until(() => browser.evalIn(dashUrl, `!!document.querySelector('${card} .badge.good')`), 'the Previews card to read live', 60000);
  stepOk('the framed Library shows the card as live');
  await browser.click(hubUrl, dashUrl, `${card} [data-copy]`);
  await until(() => browser.evalIn(dashUrl, `document.querySelector('${card} [data-copy]').textContent === 'Copied'`), 'Copy link to say Copied');
  const clip = await browser.readClipboard(dashUrl);
  assert.equal(clip, previewUrl);
  stepOk(`Copy link put ${clip} on the clipboard, from the hub's frame`);
  const before = new Set(browser.pages().map((s) => s.targetId));
  await browser.click(hubUrl, dashUrl, `${card} a[target=_blank]`);
  const tab = await until(() => browser.pages().find((s) => !before.has(s.targetId) && (s.url ?? '').startsWith(previewUrl)), 'Open to make a new tab at the preview');
  stepOk(`Open made a new tab at ${tab.url}`);
  await until(() => browser.evalIn(previewUrl, `document.getElementById('app')?.textContent === 'hello one'`), 'the Vite page to render');
  stepOk('the new tab shows the Vite page');
  const hmr = await until(() => tab.sockets.find((w) => w.url.startsWith(socketPrefix) && w.status === 101), 'the HMR socket to open');
  stepOk(`the HMR socket opened: ${hmr.url.split('?')[0]} (101)`);
  const boot = await browser.evalIn(previewUrl, 'document.documentElement.dataset.boot');
  writeMain(app, 'hello two');
  await until(() => hmr.frames.some((f) => /"type":"update"/.test(f)), 'an update frame on the socket');
  await until(() => browser.evalIn(previewUrl, `document.getElementById('app').textContent === 'hello two'`), 'the page to change');
  assert.equal(await browser.evalIn(previewUrl, 'document.documentElement.dataset.boot'), boot, 'no navigation');
  stepOk('an edit hot-reloaded: update frame, the DOM changed, no navigation');
  return tab;
}

// ===== the laptop half =====
async function laptop({ HUB, DASH, app }) {
  const hubUrl = `http://127.0.0.1:${HUB}/`;
  const dashUrl = `http://127.0.0.1:${DASH}/`;
  await until(() => fetch(`${hubUrl}instances.json`, { headers: { 'sec-fetch-site': 'same-origin' } }).then((r) => r.json()).then((j) => j.instances.some((i) => i.port === DASH)), 'the hub to list the dashboard');
  const said = dt(['preview', '--run', 'node_modules/.bin/vite --port {port} --strictPort --host 127.0.0.1'], WORKER, app);
  const name = /preview (\S+) /.exec(said)[1];
  const previewPort = Number(/127\.0\.0\.1:(\d+)/.exec(said)[1]);
  stepOk(`preview --run started Vite as ${name} on port ${previewPort}`);
  const previewUrl = `http://127.0.0.1:${previewPort}/`;

  const hub = await browser.newPage(hubUrl);
  await until(() => browser.frameWhere(dashUrl), 'the dashboard frame inside the hub');
  stepOk('the hub frames the dashboard');
  await browser.cdp.send('Browser.grantPermissions', { origin: `http://127.0.0.1:${DASH}`, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await throughCard({ hubUrl, dashUrl, name, previewUrl, socketPrefix: `ws://127.0.0.1:${previewPort}/?token=`, app });
  return { name, previewPort, hub };
}

// ===== the gateway half: a real gateway on box.localhost, a real passkey (a virtual authenticator) =====
async function viaGateway({ DASH, HUB, app, G }) {
  const pub = `http://box.localhost:${G}`;
  const hubUrl = `${pub}/`;
  const dashUrl = `http://${DASH}.box.localhost:${G}/`;
  const gwEnv = { ...env, DEVTEAM_PUBLIC_URL: pub, PORT: String(G), DEVTEAM_GATEWAY_DIR: path.join(base, 'gateway'), DEVTEAM_TTYD_PORT: String(G + 2) };
  const gwProc = spawn(process.execPath, [path.resolve(here, '..', '..', 'cloud', 'gateway.mjs'), 'serve'], { cwd: base, env: gwEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(gwProc);
  let logs = '';
  gwProc.stdout.on('data', (b) => { logs += b; });
  gwProc.stderr.on('data', (b) => { logs += b; });
  const claim = await until(() => /(http:\/\/box\.localhost:\d+\/auth\/claim#\S+)/.exec(logs)?.[1], `the claim link (gateway said: ${logs})`, 15000);
  stepOk(`the gateway is up on ${pub}, unclaimed`);

  // offered again, now as the box's: same name, a link through the gateway
  writeMain(app, 'hello one');
  const said = dt(['preview', '--run', 'node_modules/.bin/vite --port {port} --strictPort --host 127.0.0.1'], { ...WORKER, DEVTEAM_PUBLIC_URL: pub, DEVTEAM_PREVIEWS: '1' }, app);
  const name = /preview (\S+) /.exec(said)[1];
  const previewUrl = `http://${name}.box.localhost:${G}/`;
  assert.ok(said.includes(`is live at http://${name}.box.localhost:${G}`), said);
  stepOk(`preview printed the link through the gateway: ${previewUrl}`);

  const tab = await browser.newPage();
  await browser.cdp.send('WebAuthn.enable', { enableUI: false }, tab.sessionId);
  await browser.cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } }, tab.sessionId);
  await browser.navigate(tab, claim);
  await until(() => browser.evalIn(`${pub}/auth/claim`, `!!document.getElementById('go')`), 'the claim page');
  await browser.click(`${pub}/auth/claim`, `${pub}/auth/claim`, '#go');
  await until(() => (tab.url ?? '').startsWith(hubUrl) && !(tab.url ?? '').includes('/auth/'), 'the claim to finish and land on the hub');
  stepOk('claimed the box with a passkey (Chrome\'s virtual authenticator)');
  await until(() => browser.evalIn(hubUrl, `[...document.querySelectorAll('[role=tab]')].some((t) => t.textContent.includes('Terminal')) && [...document.querySelectorAll('[role=tab]')].some((t) => t.textContent.includes('demo'))`), 'the Terminal tab and the dashboard tab');
  await browser.evalIn(hubUrl, `[...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.includes('demo')).click()`);
  await until(() => browser.frameWhere(dashUrl), 'the dashboard frame inside the hub');
  stepOk('the hub shows the Terminal tab and the framed dashboard, on the gateway');
  await browser.cdp.send('Browser.grantPermissions', { origin: `http://${DASH}.box.localhost:${G}`, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  const appTab = await throughCard({ hubUrl, dashUrl, name, previewUrl, socketPrefix: `ws://${name}.box.localhost:${G}/?token=`, app });
  void appTab;

  // the hub's Previews link, and the box's list page
  await browser.click(hubUrl, hubUrl, '#box-links a');
  await until(() => (tab.url ?? '').startsWith(`${pub}/dev/`), 'the Previews link to open /dev/');
  await until(() => browser.evalIn(`${pub}/dev/`, `document.body.textContent.includes(${JSON.stringify(name)}) && document.body.textContent.includes('answers')`), 'the list page to show the preview');
  stepOk('the hub\'s Previews link opens /dev/, which lists the preview as answering');

  // signing out, then signing in, lands back on the preview
  await browser.navigate(tab, hubUrl);
  const status = await until(() => browser.evalIn(hubUrl, `fetch('/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.status)`), 'sign-out');
  assert.equal(status, 200, 'sign-out');
  await browser.navigate(tab, previewUrl);
  await until(() => (tab.url ?? '').startsWith(`${pub}/auth/login`), 'the preview to send a signed-out owner to sign-in');
  assert.ok(tab.url.includes(encodeURIComponent(previewUrl.slice(0, -1))), `sign-in remembers the preview: ${tab.url}`);
  stepOk(`signed out: the preview sends the owner to sign-in (${tab.url.split('?')[0]})`);
  await browser.click(`${pub}/auth/login`, `${pub}/auth/login`, '#go');
  await until(() => (tab.url ?? '').startsWith(previewUrl), 'sign-in to land back on the preview');
  await until(() => browser.evalIn(previewUrl, `document.getElementById('app')?.textContent === 'hello two'`), 'the preview after sign-in');
  stepOk('signed in with the passkey again: landed back on the preview');

  // what no-store costs: a second load through the gateway, against one straight to the server
  // in this tab's own frame: another tab can sit at the same address
  const inTab = async (expression) => browser.evalFrame({ session: tab, frameId: (await browser.cdp.send('Page.getFrameTree', {}, tab.sessionId)).frameTree.frame.id }, expression);
  const loadTwice = async (url) => {
    await browser.navigate(tab, url);
    await until(() => inTab(`document.getElementById('app')?.textContent === 'hello two'`), `the page at ${url}`);
    await sleep(800);
    tab.bytes = 0;
    await browser.navigate(tab, url);
    await until(() => inTab(`document.getElementById('app')?.textContent === 'hello two'`), `the page at ${url}`);
    await sleep(800);
    const ms = await inTab(`(() => { const n = performance.getEntriesByType('navigation')[0]; return Math.round(n.loadEventEnd - n.startTime); })()`);
    return { bytes: tab.bytes, ms };
  };
  const direct = `http://127.0.0.1:${JSON.parse(dt(['preview', 'list', '--json'], WORKER, app))[0].port}/`;
  const viaGw = await loadTwice(previewUrl);
  const straight = await loadTwice(direct);
  say(`measure  no-store: second load through the gateway ${viaGw.bytes} bytes in ${viaGw.ms} ms; straight to the server ${straight.bytes} bytes in ${straight.ms} ms`);
}

async function main() {
  const block = await portBlock(34);
  const HUB = block;
  const DASH = block + 1;
  env = { ...process.env, TMUX_TMPDIR: tmuxDir, DEVTEAM_HUB_PORT: String(HUB), DEVTEAM_PORT_BASE: String(block + 1), DEVTEAM_CSWAP: 'off', PATH: `${nodeBin}${path.delimiter}${process.env.PATH}`, DEVTEAM_PREVIEW_TICK_MS: '1000', DEVTEAM_OWN_KIT: '1' };
  for (const k of ['DEVTEAM_ROLE', 'DEVTEAM_TICKET', 'DEVTEAM_FEATURE', 'DEVTEAM_HOME', 'TMUX', 'TMUX_PANE', 'DEVTEAM_PUBLIC_URL', 'DEVTEAM_PREVIEWS', 'PORT']) delete env[k];
  makeRepo();
  const app = makeApp();
  startDashboard(DASH);
  browser = await new Browser().start(path.join(base, 'chrome'));
  await laptop({ HUB, DASH, app });
  await viaGateway({ HUB, DASH, app, G: block + 30 });
  say('all steps passed');
}

let failed = false;
try { await main(); } catch (e) { failed = true; console.error(`FAIL ${e.stack ?? e}`); }
try { await browser?.kill(); } catch {}
for (const p of procs) { try { p.kill(); } catch {} }
spawnSync('tmux', ['kill-server'], { env: { ...process.env, TMUX_TMPDIR: tmuxDir } });
await sleep(500);
if (!process.env.DEVTEAM_TEST_KEEP) { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(tmuxDir, { recursive: true, force: true }); } else console.log(`kept ${base}`);
process.exit(failed ? 1 : 0);
