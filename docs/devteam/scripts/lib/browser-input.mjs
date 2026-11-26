/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BROWSER_DIR } from './browser.mjs';
import { BROWSER_TAB_CAP } from './browser.mjs';
import { BROWSER_USAGE } from './browser.mjs';
import { browserAlive } from './browser.mjs';
import { browserCast } from './browser-view.mjs';
import { browserDeleteSession } from './browser.mjs';
import { browserDirMade } from './browser.mjs';
import { browserGone } from './browser.mjs';
import { browserHandled } from './browser.mjs';
import { browserHandovers } from './browser.mjs';
import { browserHeld } from './browser.mjs';
import { browserHeldLine } from './browser.mjs';
import { browserHome } from './browser.mjs';
import { browserHttp } from './browser.mjs';
import { browserKey } from './browser.mjs';
import { browserLanded } from './browser.mjs';
import { browserLedger } from './browser.mjs';
import { browserLoad } from './browser.mjs';
import { browserMainSeen } from './browser.mjs';
import { browserMask } from './browser.mjs';
import { browserOwnerDialogsEnd } from './browser.mjs';
import { browserPrepareProfile } from './browser.mjs';
import { browserProcsOn } from './browser.mjs';
import { browserProfile } from './browser.mjs';
import { browserProofPid } from './browser.mjs';
import { browserRawState } from './browser.mjs';
import { browserRecordCloses } from './browser.mjs';
import { browserSessionFiles } from './browser.mjs';
import { browserSleep } from './browser.mjs';
import { browserSnapshot } from './browser.mjs';
import { browserStateFile } from './browser.mjs';
import { browserTestEnv } from './browser.mjs';
import { browserTitle } from './browser.mjs';
import { browserUnhandled } from './browser.mjs';
import { browserViewClose } from './browser-view.mjs';
import { browserViewFrame } from './browser-view.mjs';
import { browserViewTick } from './browser-view.mjs';
import { browserWatchTabs } from './browser.mjs';
import { browserWriteState } from './browser.mjs';
import { cdpBrowser } from './browser.mjs';
import { commonDir } from './state.mjs';
import { fileURLToPath } from 'node:url';
import { json } from './base.mjs';
import { loadSettings } from './settings.mjs';
import { mainRef } from './log.mjs';
import { mainRefCache } from './log.mjs';
import { mainSha } from './log.mjs';
import { out } from './base.mjs';
import { report } from './log-sync.mjs';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { unreachable } from './box-pins.mjs';
/* imports end */
// An input (a click, a key), then what it caused: a load the main frame starts within 500 ms waited
// for as open's is (an error page's for 3 s), or a tab it opened (waited for, up to 10 s, to load).
// The verb then prints said, plus where the page went or the guard's refusal.
export async function browserInput(ctx, tab, act, said) {
  let started = false, loaded = false, inDocAt = 0, pending = 0, fresh = false;
  const had = new Set(ctx.tabs);
  tab.started = () => { started = true; loaded = false; pending++; fresh = true; tab.unreachable = null; tab.refs = new Map(); };
  tab.loaded = () => { loaded = true; };
  // A same-document navigation (a fragment link, a history call) fires a load's start, then itself, and no
  // load: it takes the start just before it off the count (while a real load is pending, the page's
  // history calls after the first come with no start of their own and take nothing). The wait ends 500 ms after the
  // first (as an input's own load is given 500 ms to start) when no start is left pending, before and
  // after the document reads complete. So a history call the page being left makes before it navigates
  // (an onclick saving its state), or while its load is pending (a timer), leaves that load's start
  // pending until its load; one the new page makes as it boots reads loading; and a page that keeps
  // calling (a scroll-spy) holds nothing. Each read is bounded.
  tab.within = () => { inDocAt ||= Date.now(); if (fresh) pending--; fresh = false; };
  const docLoaded = () => Promise.race([
    ctx.cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, tab.sessionId).then((r) => r.result?.value === 'complete', () => false),
    browserSleep(1000).then(() => false),
  ]);
  try {
    await act();
    for (const t = Date.now(); !started && had.has(ctx.active) && Date.now() - t < 500;) await browserSleep(25);
    for (const t = Date.now(); started && !loaded && Date.now() - t < (tab.unreachable ? 3000 : 30000);) {
      if (inDocAt && !pending && Date.now() - inDocAt >= 500 && await docLoaded() && !pending) break;
      await browserSleep(50);
    }
  } finally { tab.started = tab.loaded = tab.within = null; }
  const pop = ctx.active && !had.has(ctx.active) ? ctx.active : null;
  if (pop) {
    for (const t = Date.now(); Date.now() - t < 10000; await browserSleep(100)) {
      if (!pop.sessionId || !browserHttp(pop.url)) continue;
      try { if ((await ctx.cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, pop.sessionId)).result?.value === 'complete') break; } catch {}
    }
    return browserLanded(ctx, pop, {}, pop.url, (u, title) => `${said}; it opened tab ${ctx.tabs.indexOf(pop) + 1}: ${u} (${title})`);
  }
  if (!started) return { code: 0, out: said };
  return browserLanded(ctx, tab, { errorText: tab.unreachable ? 'the page did not load' : undefined }, tab.frameUrl, (u, title) => `${said}; now at ${u} (${title})`);
}
// press: the named keys (Windows key codes), or one printable character.
export const BROWSER_KEYS = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, PageUp: 33, PageDown: 34, Home: 36, End: 35 };
export const browserKeyOk = (k) => typeof k === 'string' && (Object.hasOwn(BROWSER_KEYS, k) || /^[^\p{C}\s]$/u.test(k));
export const BROWSER_KEY_LIST = `browser press takes ${Object.keys(BROWSER_KEYS).join(', ')}, or one printable character`;
export function browserKeyEvents(k) {
  const named = Object.hasOwn(BROWSER_KEYS, k);
  const key = k === 'Space' ? ' ' : k, text = k === 'Enter' ? '\r' : k === 'Space' ? ' ' : named ? undefined : k;
  const vk = named ? BROWSER_KEYS[k] : /^[a-z0-9]$/i.test(k) ? k.toUpperCase().charCodeAt(0) : undefined;
  const common = { key, ...(named ? { code: k } : {}), ...(vk ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {}) };
  return [{ type: text ? 'keyDown' : 'rawKeyDown', ...common, ...(text ? { text, unmodifiedText: text } : {}) }, { type: 'keyUp', ...common }];
}
// screenshot, failing closed (rulings on T5-1 and T5b-1): every password field and every field whose
// autocomplete names a code or a password, in every frame and shadow root (DOM.getDocument, pierce), is
// made to draw no glyphs by an inspector edit of its inline style (CSS.setStyleTexts). That edit is
// exempt from the page's CSP, where an injected <style> isn't, and it reaches into shadow roots, where a
// document's sheet doesn't. Each field's computed style is checked before the capture, and the whole
// walk runs again after it: a field added, removed or no longer hidden, or a frame whose document can't
// be reached (another site's, in another process: iframe, frame, object, embed, fencedframe), refuses
// and writes nothing. The inline styles are put back in a finally. Shots older than a day go first; the
// file is written 0600 from its first byte (a tmp file, renamed over any existing one).
export const BROWSER_HIDE = { color: 'transparent', '-webkit-text-fill-color': 'transparent', 'caret-color': 'transparent', 'text-shadow': 'none', '-webkit-text-stroke': '0', 'background-clip': 'border-box', '-webkit-background-clip': 'border-box' };
export const BROWSER_HIDDEN = { color: 'rgba(0, 0, 0, 0)', '-webkit-text-fill-color': 'rgba(0, 0, 0, 0)', 'caret-color': 'rgba(0, 0, 0, 0)', 'text-shadow': 'none', '-webkit-text-stroke-width': '0px', 'background-clip': 'border-box' };
export const BROWSER_SECRET_FIELD = /one-time-code|current-password|new-password/i;
export const BROWSER_FRAMES = new Set(['IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'FENCEDFRAME']);
// The page's secret fields (backendNodeId → nodeId) and whether a frame's document is out of reach.
export async function browserScan(send) {
  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });
  const fields = new Map();
  let unreachable = false;
  const walk = (n) => {
    const a = n.attributes ?? [], at = (k) => { for (let i = 0; i < a.length; i += 2) if (String(a[i]).toLowerCase() === k) return String(a[i + 1]); return ''; };
    if ((n.nodeName === 'INPUT' && at('type').toLowerCase() === 'password') || BROWSER_SECRET_FIELD.test(at('autocomplete'))) fields.set(n.backendNodeId, n.nodeId);
    if (BROWSER_FRAMES.has(n.nodeName) && !n.contentDocument) unreachable = true;
    for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? []), ...(n.contentDocument ? [n.contentDocument] : [])]) walk(c);
  };
  walk(root);
  return { fields, unreachable };
}
export async function browserShot(ctx, tab, to) {
  const dir = path.join(BROWSER_DIR(), 'shots');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const n of fs.readdirSync(dir)) { try { const f = path.join(dir, n); if (Date.now() - fs.statSync(f).mtimeMs > 86400000) fs.rmSync(f, { force: true }); } catch {} }
  const send = (m, p) => ctx.cdp.send(m, p, tab.sessionId);
  const refuse = (why) => { throw Object.assign(new Error(`refused: ${why}; nothing captured`), { refusal: true }); };
  const hidden = async (nodeId) => { const cs = Object.fromEntries((await send('CSS.getComputedStyleForNode', { nodeId })).computedStyle.map((p) => [p.name, p.value])); return Object.entries(BROWSER_HIDDEN).every(([k, v]) => cs[k] === v); };
  await send('DOM.enable');
  await send('CSS.enable');
  let scan = await browserScan(send);
  if (scan.unreachable) refuse("the page holds a frame from another site, which can't be checked for password fields");
  const undo = new Map(), was = new Set(scan.fields.keys());
  let data;
  try {
    for (const [id, nodeId] of scan.fields) {
      const st = (await send('CSS.getInlineStylesForNode', { nodeId })).inlineStyle;
      await send('CSS.setStyleTexts', { edits: [{ styleSheetId: st.styleSheetId, range: st.range, text: `${st.cssText};${Object.entries(BROWSER_HIDE).map(([k, v]) => `${k}:${v}!important`).join(';')}` }] });
      undo.set(id, st.cssText);
      if (!(await hidden(nodeId))) refuse("a password or code field on the page couldn't be hidden");
    }
    const wait = Number(browserTestEnv('DEVTEAM_TEST_BROWSER_SHOT_DELAY_MS'));
    if (wait > 0) await browserSleep(wait); // test hook: the page gets time to change between check and capture
    ({ data } = await send('Page.captureScreenshot', { format: 'png' }));
    // the same check again, on what the capture saw: the same fields, every one still hidden
    scan = await browserScan(send);
    const same = !scan.unreachable && scan.fields.size === was.size && [...scan.fields.keys()].every((id) => was.has(id));
    if (!same || !(await Promise.all([...scan.fields.values()].map(hidden))).every(Boolean)) { data = null; refuse('the page changed its password or code fields while it was captured'); }
  } catch (e) {
    data = null;
    if (e.refusal) throw e;
    refuse("a password or code field on the page couldn't be hidden");
  } finally {
    for (const [id, text] of undo) { try { const nodeId = scan.fields.get(id); const st = (await send('CSS.getInlineStylesForNode', { nodeId })).inlineStyle; await send('CSS.setStyleTexts', { edits: [{ styleSheetId: st.styleSheetId, range: st.range, text }] }); } catch {} }
  }
  const file = to ?? path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, Buffer.from(data, 'base64'), { mode: 0o600, flag: 'wx' }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
  return file;
}
// An ordinary desktop Chrome user agent from `<chrome> --version` (dev-62), or null.
export function browserUserAgent(bin) {
  const v = /(\d+\.\d+\.\d+\.\d+)/.exec(spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] }).stdout ?? '')?.[1];
  return v ? `Mozilla/5.0 (${process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36` : null;
}
// Chrome, detached in its own group, its DevTools on a pipe (fds 3 and 4, kit-316 S2: no port, and no
// DevToolsActivePort), up once it answers Browser.getVersion there within 30 s. No usable sandbox: once
// more with --no-sandbox, and a note. Its stderr is kept (the last 64 KiB) only until then, for the
// sandbox check; after, it is drained and dropped: Chrome's log lines can carry page URLs.
export const chromeTmpFor = (profile, base = os.tmpdir()) => path.join(base, `dc${crypto.createHash('sha1').update(profile).digest('hex').slice(0, 6)}`);
// Chrome's TMPDIR for a profile (kit-777), in base (the daemon's temp folder: /tmp, as it runs under
// env -i): { tmpdir, own, note }. own is the folder made for it, removed at stop; null when none was
// made. Chrome's singleton socket is <TMPDIR>/org.chromium.Chromium.XXXXXX/SingletonSocket, 45 bytes
// after TMPDIR, and a socket's path is at most 107 bytes on Linux (103 on macOS): when the dc… folder
// would pass that, Chrome runs in base as it is and a note says so; when base would too, it throws,
// naming the length. A folder already at the name is emptied only when it is this user's own folder,
// closed to others (a killed daemon's); anything else throws and is left as it is. The mkdir is a
// plain one: it fails if another process made the folder meanwhile.
export function browserChromeTmp(profile, { base = os.tmpdir(), uid = process.getuid(), platform = process.platform } = {}) {
  const max = platform === 'linux' ? 107 : 103, socket = (d) => Buffer.byteLength(d) + 45;
  const tmp = chromeTmpFor(profile, base);
  if (socket(tmp) > max) {
    if (socket(base) > max) throw new Error(`browser: Chrome's socket path would be ${socket(base)} bytes in ${base} (${max} at most here); Chrome can't start with that temp folder`);
    return { tmpdir: base, own: null, note: `Chrome's temp folders are loose in ${base}: a folder of their own there would make its socket path too long.` };
  }
  const st = fs.lstatSync(tmp, { throwIfNoEntry: false });
  if (st) {
    const kind = st.isSymbolicLink() ? 'a symlink' : st.isDirectory() ? 'a folder' : 'a file';
    if (!st.isDirectory() || st.uid !== uid || (st.mode & 0o077)) throw new Error(`browser: Chrome's temp folder ${tmp} is already there and isn't this user's own (${kind}, owner ${st.uid}, mode ${(st.mode & 0o777).toString(8)}); remove it and start again`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  try { fs.mkdirSync(tmp, { mode: 0o700 }); } catch (e) { throw e.code === 'EEXIST' ? new Error(`browser: Chrome's temp folder ${tmp} was made by another process as this one made it; start again`) : e; }
  return { tmpdir: tmp, own: tmp, note: null };
}
export async function browserLaunchChrome(ctx, { headed }) {
  // read once per daemon (a spawn of Chrome, most of a second): a close or a forget relaunches the same binary
  if (ctx.ua === undefined) ctx.ua = browserUserAgent(ctx.bin);
  const ua = ctx.ua;
  const args = [
    ...(headed && !process.env.DEVTEAM_PUBLIC_URL ? [] : ['--headless=new']), `--user-data-dir=${ctx.profile}`, '--remote-debugging-pipe',
    `--proxy-server=127.0.0.1:${ctx.guard.port}`, '--proxy-bypass-list=<-loopback>', '--disable-quic',
    // WebRTC is kept to the proxy (kit-805): its policy under both its names (Chromium 156 reads the first),
    // every name left to the guard to look up, and no mDNS. The policy leaves no address for mDNS to hide.
    ...['', 'force-'].map((f) => `--${f}webrtc-ip-handling-policy=disable_non_proxied_udp`), '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--disable-features=WebRtcHideLocalIpsWithMdns',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-component-update', '--disable-background-networking', '--disable-sync',
    ...(process.platform === 'linux' ? ['--password-store=basic'] : []), ...(ua ? [`--user-agent=${ua}`] : []),
  ];
  // Chrome's own temp folders (org.chromium.Chromium.*, its singleton socket among them) go in one short
  // folder per profile (browserChromeTmp), made afresh at each launch and removed at stop: a Chrome that
  // is killed leaves them behind, and loose in the machine's temp folder they piled up by the thousand.
  // Short, beside the others, because a socket's path is capped and a folder inside the profile would
  // pass it. The folder the last try or launch made is this daemon's own, so it goes first, and the
  // check in browserChromeTmp meets only what someone else made. Any exit of the daemon removes the
  // folder too (a start that fails after Chrome is up, a stop that came while this ran): a sync rm.
  if (!ctx.chromeTmpOnExit) {
    ctx.chromeTmpOnExit = true;
    process.on('exit', () => { if (ctx.chromeTmp) { try { fs.rmSync(ctx.chromeTmp, { recursive: true, force: true }); } catch {} } });
  }
  for (let tries = 0; ; tries++) {
    if (ctx.chromeTmp) { fs.rmSync(ctx.chromeTmp, { recursive: true, force: true }); ctx.chromeTmp = null; }
    const t = browserChromeTmp(ctx.profile);
    ctx.chromeTmp = t.own;
    if (t.note && !ctx.notes.includes(t.note)) ctx.notes.push(t.note);
    const chrome = spawn(ctx.bin, [...args, ...(tries ? ['--no-sandbox'] : []), 'about:blank'], { detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env: { ...process.env, TMPDIR: t.tmpdir } });
    ctx.chrome = chrome;
    const r = await new Promise((resolve) => {
      let buf = '', over = false;
      const timer = setTimeout(() => done({ late: true }), 30000);
      const read = (c) => { buf = (buf + c).slice(-65536); };
      function done(v) {
        if (over) return;
        over = true;
        clearTimeout(timer);
        chrome.stderr.removeListener('data', read);
        chrome.stderr.on('data', () => {});
        resolve(v);
      }
      chrome.stderr.setEncoding('utf8');
      chrome.stderr.on('data', read);
      chrome.once('error', () => done({ exited: true, buf: '' }));
      chrome.once('exit', () => done({ exited: true, buf }));
      // a pipe that fails before Chrome exits is left to the exit (its stderr says why) or the timer
      cdpBrowser(chrome).then((cdp) => done({ cdp }), () => {});
    });
    if (r.cdp) return { cdp: r.cdp };
    try { process.kill(-chrome.pid, 'SIGKILL'); } catch {}
    if (r.exited && !tries && /No usable sandbox|setuid sandbox/.test(r.buf)) {
      const note = "Chrome's sandbox isn't available on this machine; it runs without it.";
      if (!ctx.notes.includes(note)) ctx.notes.push(note); // a forget's relaunch says it once
      // a stop came meanwhile: no second Chrome (detached, it would outlive the daemon); the caller's
      // own ctx.stopping check after the launch kills ctx.chrome and returns
      if (ctx.stopping) return { cdp: null };
      continue;
    }
    throw new Error(r.late ? "browser: Chrome didn't open its DevTools pipe in 30 s" : 'browser: Chrome exited before its DevTools pipe opened');
  }
}
// One Chrome ended: Browser.close on its pipe, then (not gone in 5 s) its group SIGTERM, SIGKILL 2 s
// later; its helpers killed with the group; its pipe closed. The stop path's and a forget's.
export async function browserEndChrome(cdp, pid) {
  if (pid && browserAlive(pid)) {
    await Promise.race([cdp?.send('Browser.close').catch(() => {}), browserSleep(5000)]);
    if (!(await browserGone(pid, 5000))) {
      try { process.kill(-pid, 'SIGTERM'); } catch {}
      if (!(await browserGone(pid, 2000))) { try { process.kill(-pid, 'SIGKILL'); } catch {} await browserGone(pid, 3000); }
    }
  }
  if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} } // its helpers, if any outlived it
  cdp?.close();
}
// kit-877: a close ends Chrome by a deadline, so its cookies are carried across in memory. The jar:
// Storage.getCookies on the browser target, raced against 500 ms of its own; the cookies or null, an
// error dropped. Never written, logged or printed.
export async function browserCookieJar(cdp) {
  if (!cdp) return null;
  let t;
  const r = await Promise.race([cdp.send('Storage.getCookies').then((x) => x?.cookies ?? null, () => null), new Promise((res) => { t = setTimeout(() => res(null), 500); })]);
  clearTimeout(t);
  return Array.isArray(r) ? r : null;
}
// A Cookie as the CookieParam that sets it again: a host-only cookie by url (its scheme from secure),
// a domain cookie (leading dot) by domain; expires only for a cookie that isn't a session one.
export function browserCookieParam(c) {
  const p = { name: c.name, value: c.value, path: c.path, secure: !!c.secure, httpOnly: !!c.httpOnly };
  if (typeof c.domain === 'string' && c.domain.startsWith('.')) p.domain = c.domain;
  else p.url = `${c.secure ? 'https' : 'http'}://${c.domain}${c.path || '/'}`;
  if (!c.session && typeof c.expires === 'number' && c.expires > 0) p.expires = c.expires;
  for (const k of ['sameSite', 'priority', 'sourceScheme', 'sourcePort', 'partitionKey']) if (c[k] !== undefined) p[k] = c[k];
  return p;
}
// The jar set on the fresh Chrome: one Storage.setCookies with all of it; refused, one call per cookie,
// skipping the refused ones. Nothing cleared first; every error dropped (never in last-error). The
// hook DEVTEAM_TEST_BROWSER_COOKIES_BULK_FAILS=1 (tests) treats the one call as refused.
export async function browserCookiesBack(cdp, jar) {
  if (!cdp || !jar?.length) return;
  let cookies;
  try { cookies = jar.map(browserCookieParam); } catch { return; } // a malformed jar sets nothing
  try {
    if (browserTestEnv('DEVTEAM_TEST_BROWSER_COOKIES_BULK_FAILS') === '1') throw new Error('refused (the test hook)');
    await cdp.send('Storage.setCookies', { cookies });
    return;
  } catch {}
  for (const c of cookies) { try { await cdp.send('Storage.setCookies', { cookies: [c] }); } catch {} }
}
// A close's kill: SIGKILL to Chrome's group, then to each process proven on the profile (this uid,
// --user-data-dir the profile); up to 2 s for Chrome gone; its pipe closed. (browserKillChrome is
// the start and stop path's.)
export async function browserKillProfile(ctx, cdp, pid) {
  if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
  for (const p of browserProcsOn(ctx.profile) ?? []) { try { process.kill(p, 'SIGKILL'); } catch {} }
  if (pid) await browserGone(pid, 2000);
  cdp?.close();
}
// A Chrome and its pipe watched: its exit or its pipe closing stops the daemon only while it is the
// current Chrome and not retired by a forget (whose old Chrome's end is expected). The view's
// screencast frames are taken on this pipe.
export function browserWatchChrome(ctx, chrome, cdp) {
  const gone = () => { if (chrome === ctx.chrome && !chrome.retired) browserShutdown(ctx, 'chrome exited'); };
  chrome.once('exit', gone);
  cdp.on('close', gone);
  cdp.on('Page.screencastFrame', (p, sid) => browserViewFrame(ctx, p, sid));
}
// The clean restart a forget and a close share, on the verbs' queue, with ctx.ready already false:
// the current Chrome retired and ended, then up to 5 s until no process carries the profile; with
// wipe, the profile folder (ctx.profile, the one the daemon runs on) removed and made again empty
// with this checkout's root.json; its start steps (the session files deleted, a failed delete
// throwing; the prefs), a fresh Chrome on about:blank, the tabs watched again and state.json
// rewritten with the new chrome_pid. The daemon, guard, control port and preview stay. A stop
// meanwhile wins: after each await, ctx.stopping ends it (browserShutdown kills ctx.chrome, whichever
// it is). Processes that can't be listed, or one left, and any failure stop the daemon (the next start
// cleans up). True once the fresh Chrome is up; false when it ended.
export async function browserRelaunch(ctx, { wipe, deadline }) {
  try {
    const old = ctx.chrome;
    old.retired = true; // before Browser.close: its exit and pipe close never stop the daemon
    let jar = null;
    if (wipe) await browserEndChrome(ctx.cdp, old.pid);
    else {
      // a close (kit-877): the cookies read first, then Chrome's own close until the deadline, then a kill
      jar = await browserCookieJar(ctx.cdp);
      if (old.pid && browserAlive(old.pid)) {
        ctx.cdp?.send('Browser.close').catch(() => {});
        await browserGone(old.pid, Math.max(0, (deadline ?? Date.now() + 1000) - Date.now()));
      }
      await browserKillProfile(ctx, ctx.cdp, old.pid);
    }
    if (ctx.stopping) return false;
    const killLeft = (pids) => { if (!wipe) for (const p of pids ?? []) { try { process.kill(p, 'SIGKILL'); } catch {} } }; // a close's wait kills what it still sees
    let procs = browserProcsOn(ctx.profile);
    for (const end = Date.now() + 5000; procs?.length && Date.now() < end && !ctx.stopping; procs = browserProcsOn(ctx.profile)) { killLeft(procs); await browserSleep(25); }
    if (ctx.stopping) return false;
    if (procs === null || procs.length) { browserShutdown(ctx, 'error', procs === null ? "couldn't list this machine's processes after stopping Chrome" : `a process (pid ${procs[0]}) still carried the profile 5 s after Chrome's stop`); return false; } // nothing removed on a guess
    // the session files go the moment no process holds the profile (a close's secrets leave the disk
    // here; a failed delete throws to the catch); a forget's wipe removes them with the rest
    if (!wipe) browserDeleteSession(ctx.profile);
    if (wipe) {
      fs.rmSync(ctx.profile, { recursive: true, force: true });
      ctx.profile = browserProfile({ fail: (m) => { throw new Error(m); } }); // to the catch: browserShutdown, not die
    }
    await browserPrepareProfile(ctx.profile, [], { procs }); // procs: [] just read, nothing on the profile since
    if (ctx.stopping) return false;
    const { cdp } = await browserLaunchChrome(ctx, { headed: process.env.DEVTEAM_BROWSER_HEADED === '1' });
    if (ctx.stopping) { try { process.kill(-ctx.chrome.pid, 'SIGKILL'); } catch {} return false; } // launched while it stopped
    ctx.cdp = cdp;
    browserWatchChrome(ctx, ctx.chrome, cdp);
    if (jar) { await browserCookiesBack(cdp, jar); jar = null; } // before any page is reopened
    if (ctx.stopping) return false;
    ctx.tabs = [];
    ctx.active = null;
    await browserWatchTabs(ctx);
    for (let i = 0; i < 100 && !ctx.stopping && !ctx.tabs.some((t) => t.sessionId); i++) await browserSleep(100);
    if (ctx.stopping) return false;
    ctx.state = { ...ctx.state, chrome_pid: ctx.chrome.pid };
    browserWriteState(ctx.state);
    return true;
  } catch (e) { browserShutdown(ctx, 'error', e?.message); return false; }
}
// Sign out of everything (the view's forget), on the verbs' queue: the screencast stopped, then the
// clean restart with the profile wiped (browserRelaunch), and the screencast started again on the same
// viewer (its seq goes on).
export async function browserForgetRestart(ctx) {
  if (ctx.stopping || !ctx.ready) return;
  try {
    ctx.ready = false; // the view's input dropped, its tick idle, a new socket 503
    browserOwnerDialogsEnd(ctx);
    const v = ctx.viewer;
    if (v) { browserCast(ctx, v.tab, false); v.tab = null; }
    const hold = Number(browserTestEnv('DEVTEAM_TEST_BROWSER_FORGET_DELAY_MS')); // tests: a long forget
    if (hold > 0) { await browserSleep(hold); if (ctx.stopping) return; }
    if (!(await browserRelaunch(ctx, { wipe: true }))) return;
    ctx.ready = true;
    if (ctx.viewer) browserViewTick(ctx, ctx.viewer); // the screencast again, on the same socket
  } catch { browserShutdown(ctx, 'error'); }
}
// --- the gate on a close (kit-67): the handovers this daemon hasn't handled since they closed, all in
// one clean restart, on the verbs' queue. In order: (1) the owner cut off, before Chrome is touched:
// ctx.ready false (the view drops all input) and the viewer sent bye, its socket closed; (2) the pages
// to reopen, only when the batch is one done (browserNotePages); (3, 4) Chrome stopped and started
// fresh on a clean session (browserRelaunch, no wipe); (5) on done, those pages reopened by plain GET
// (browserReopen); (6) one ledger entry per close, each recorded in memory too; then ctx.ready.
// A stop meanwhile ends it at its next check, with no entry: the next start handles the close.
export const BROWSER_BACK = 'The supervisor has the browser again.';
export async function browserCloseRestart(ctx, closes) {
  if (ctx.stopping || !closes.length) return;
  // kit-877: Chrome gets until 1 s after the earliest close (its answer's time; none parsing reads as
  // now), held to between now and now + 1 s, fixed here, before the test hold, so a late close is cut short
  const now = Date.now(), at = closes.map((h) => Date.parse(h.closeAt)).filter(Number.isFinite);
  const deadline = Math.min(now + 1000, Math.max(now, (at.length ? Math.min(...at) : now) + 1000));
  try {
    ctx.closing = true; // until it ends: a socket opened meanwhile is refused with bye
    ctx.ready = false;
    const v = ctx.viewer;
    if (v) {
      try { v.ws.send({ t: 'bye', why: BROWSER_BACK }); v.ws.close(1000); } catch {}
      browserViewClose(ctx, v);
    }
    browserOwnerDialogsEnd(ctx);
    const hold = Number(browserTestEnv('DEVTEAM_TEST_BROWSER_CLOSE_DELAY_MS')); // tests: a close held open
    if (hold > 0) { await browserSleep(hold); if (ctx.stopping) return; }
    const reopen = closes.length === 1 && closes[0].outcome === 'done' ? browserNotePages(ctx) : []; // only one done reopens
    if (!(await browserRelaunch(ctx, { wipe: false, deadline }))) return;
    const reopened = reopen.length ? await browserReopen(ctx, reopen) : [];
    if (ctx.stopping) return;
    browserRecordCloses(ctx, closes, reopened);
    ctx.ready = true;
  } catch (e) { browserShutdown(ctx, 'error', e?.message); } finally { ctx.closing = false; }
}
// The pages a done reopens: each tab's last GET (browserWatchTabs), in tab order; a tab with none, or
// one that isn't http(s) (about:blank), adds nothing. Raw URLs, in memory only.
export function browserNotePages(ctx) {
  return ctx.tabs.map((t) => t.lastGet).filter((u) => typeof u === 'string' && browserHttp(u));
}
// The noted pages opened again on the fresh Chrome, within the 5-tab cap: the first in the first tab,
// each other in a tab Target.createTarget opens on about:blank (navigated once its Page and Network
// are on, so its own last GET is tracked too). Each is a plain Page.navigate GET; the loads are waited
// on together, 15 s in all, and a load still running then is left to finish on its own. Back: the
// URLs navigated, masked.
export const BROWSER_REOPEN_MS = 15000;
export async function browserReopen(ctx, urls) {
  const end = Date.now() + BROWSER_REOPEN_MS, left = () => Math.max(0, end - Date.now());
  const waits = [], opened = [];
  // as browserLoad: done on the load event once Page.navigate answered, or on its error
  const go = (tab, url) => {
    let finish, nav = false, loaded = false;
    const onLoad = () => { loaded = true; if (nav) finish(); };
    const p = new Promise((resolve) => {
      finish = () => { if (tab.loaded === onLoad) tab.loaded = null; resolve(); };
      Object.assign(tab, { opening: url, frameUrl: null, unreachable: null, refs: new Map(), loaded: onLoad });
      ctx.cdp.send('Page.navigate', { url }, tab.sessionId).then((r) => { nav = true; if (r?.errorText || !r?.loaderId || loaded) finish(); }, () => finish());
    });
    p.finish = () => finish();
    waits.push(p);
    opened.push(url);
  };
  for (const [i, url] of urls.slice(0, BROWSER_TAB_CAP).entries()) {
    if (ctx.stopping || !left()) break;
    let tab = null;
    if (i === 0) tab = ctx.active?.sessionId ? ctx.active : ctx.tabs.find((t) => t.sessionId) ?? null;
    else {
      // no new tab in the last 2 s; a tab made too late to navigate is closed when it comes, never
      // left open on about:blank
      if (left() < 2000) break;
      const shut = (targetId) => { if (targetId) ctx.cdp.send('Target.closeTarget', { targetId }).catch(() => {}); };
      const made = ctx.cdp.send('Target.createTarget', { url: 'about:blank' });
      const r = await Promise.race([made, browserSleep(left()).then(() => null)]).catch(() => null);
      if (!r) { made.then((x) => shut(x?.targetId), () => {}); break; }
      while (!ctx.stopping && left() && !(tab = ctx.tabs.find((t) => t.targetId === r.targetId))) await browserSleep(50);
      if (!tab) { shut(r.targetId); break; }
    }
    if (tab) await Promise.race([tab.ready, browserSleep(left())]); // its Page and Network on: the load seen, its GET tracked
    if (tab?.sessionId && !ctx.stopping && left()) go(tab, url);
    else if (i > 0 && tab) { ctx.cdp.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => {}); break; } // made, never navigated
  }
  await Promise.race([Promise.all(waits), browserSleep(left())]);
  for (const w of waits) w.finish(); // any load still running: its wait let go, its tab.loaded freed
  return opened.map((u) => browserMask(u));
}
// A fold just read, kept: ctx.held, the fold, whether a close is still unhandled (ctx.pending; one that
// can't be worked out counts as pending) and the fold's time (the view's input check reads them), and
// the open viewer told when the hold changed.
export function browserKeepHeld(ctx, hs) {
  ctx.readFailedAt = 0;
  ctx.held = browserHeld(hs);
  ctx.folded = hs;
  try { ctx.pending = browserUnhandled(ctx, hs).length > 0; } catch { ctx.pending = true; }
  ctx.foldAt = Date.now();
  if (ctx.viewer) browserViewHeld(ctx, ctx.viewer);
}
// The viewer's side of the hold: {t:"held",qid} sent when it differs from what this socket was last
// sent (the first time on connect). v.handover is the handover this socket was sent, or null. It
// follows the hold only while its own handover is open: once that one has closed it stays, so the
// socket's input stays dropped until the close's bye, even if another handover holds the browser now.
export function browserViewHeld(ctx, v) {
  if (v.ws.closed) return;
  const held = ctx.held ?? null;
  if (held !== v.heldSent) { v.heldSent = held; try { v.ws.send({ t: 'held', qid: held }); } catch {} } // never throws into the watch's timer
  if (held && (!v.handover || ctx.folded.some((h) => h.qid === v.handover && h.status === 'open'))) v.handover = held;
}
// A fold read for the view. The hook (tests): while its file exists, the read fails.
export function browserViewRead(ctx) {
  try {
    const fails = browserTestEnv('DEVTEAM_TEST_BROWSER_VIEW_READ_FAILS');
    if (fails && fs.existsSync(fails)) throw new Error('the log could not be read');
    browserKeepHeld(ctx, browserHandovers());
  } catch (e) { browserReadFailed(ctx); throw e; }
}
// A failed read while a handover is held or a close is pending. Held for BROWSER_READ_FAIL_MS, the
// daemon can no longer tell whether the owner's session should end, so it ends it: the viewer told
// why, then browserShutdown (Chrome stopped, session files gone, the reason in last-error). With no
// handover known a failed read changes nothing.
export const BROWSER_READ_FAIL_MS = 10000;
export const BROWSER_UNREADABLE = "The browser can't read its log, so it shut down and ended this session.";
// a new socket refused while reads fail inside the limit: the handover may still be open
export const BROWSER_UNREADABLE_NOW = "The browser can't read its log right now; if that lasts, it ends this session.";
export function browserReadFailed(ctx) {
  if (ctx.stopping || (!ctx.held && !ctx.pending)) { ctx.readFailedAt = 0; return; }
  const now = Date.now();
  ctx.readFailedAt ||= now;
  if (now - ctx.readFailedAt < (Number(browserTestEnv('DEVTEAM_TEST_BROWSER_READ_FAIL_MS')) || BROWSER_READ_FAIL_MS)) return;
  const v = ctx.viewer;
  if (v && !v.ws.closed) { try { v.ws.send({ t: 'bye', why: BROWSER_UNREADABLE }); v.ws.close(1000); } catch {} }
  browserShutdown(ctx, 'error', "browser: couldn't read the log during a handover, so the session was ended");
}
// Whether a close is pending for the view, by a fold no more than 500 ms old (read here when the
// watch's is older, so this doesn't rest on the watch; fresh: read now). While it is, the page still
// holds the owner's session: no socket is sent a frame, none has its input forwarded, and a new one is
// refused. A fold that can't be read counts as pending only while a handover is known; with none the
// view carries on as in kit-66. A connect's read (fresh) also looks at main again, so a close that came
// only through main is seen.
export function browserViewPending(ctx, fresh = false) {
  if (fresh || Date.now() - ctx.foldAt > 500) {
    if (fresh) browserMainSeen = { ...browserMainSeen, at: 0 };
    try { browserViewRead(ctx); } catch { return !!ctx.held || ctx.pending; }
  }
  return ctx.pending;
}
// Main as the files say, with no git call: inode, size and mtime in ns of main's loose ref and of
// packed-refs in the common git dir. A ref named by origin/<main> counts even while <main> is in use,
// since it would take over. A file that's absent is a state (a packed ref has no loose file); any other
// error throws.
export const browserMainHook = () => { const p = browserTestEnv('DEVTEAM_TEST_BROWSER_MAIN_CHECK_FAILS'); try { return p ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } };
export function browserMainRefKey(ref) {
  if (browserMainHook() === 'stat') throw new Error("main's refs could not be read");
  const b = loadSettings().main_branch;
  const names = [`refs/remotes/origin/${b}`, ...(ref === b ? [`refs/heads/${b}`] : []), 'packed-refs'];
  return names.map((n) => {
    try {
      const st = fs.statSync(path.join(commonDir, n), { bigint: true });
      return `${n} ${st.ino} ${st.size} ${st.mtimeNs}`;
    } catch (e) {
      if (e.code === 'ENOENT') return `${n} absent`;
      throw e;
    }
  }).join('\n');
}
// Before an input during a handover: main's sha read again if its files moved, so the fold that follows
// sees a close that came only through main. Throws when the stat or that read fails, and the input is
// dropped. With no main ref at all there is nothing to watch: the fold is the live log's, as it always
// was, and browserFresh keeps looking for main every 5 s.
export let browserMainRefs = null;
export function browserMainCheck() {
  if (!commonDir) return;
  const ref = browserMainRefs?.ref ?? mainRef();
  if (!ref) return;
  const key = browserMainRefKey(ref); // before the read: a move during it is seen next time
  if (key === browserMainRefs?.key && mainRefCache) return;
  browserMainRefs = { ref, key: null }; // until the read below succeeds
  mainRefCache = undefined;
  const sha = browserMainHook() === 'read' ? null : mainSha();
  if (!sha) { mainRefCache = undefined; throw new Error("main's sha could not be read"); }
  browserMainSeen = { at: Date.now(), part: `main ${sha}` };
  browserMainRefs = { ref: mainRefCache, key: mainRefCache === ref ? key : null };
}
// Whether this socket's input is cut off: while a close is pending, and on a socket whose own handover
// has closed. With no close pending, a socket never sent a handover is kit-66's.
export function browserViewClosed(ctx, v) {
  if (!v.handover && !ctx.held && !ctx.pending) { // no handover known: kit-66's, whatever the log does
    try { if (Date.now() - ctx.foldAt > 500) browserViewRead(ctx); } catch { return false; }
    return ctx.pending;
  }
  try { browserMainCheck(); browserViewRead(ctx); } catch { return true; }
  if (ctx.pending) return true;
  return !!v.handover && !ctx.folded.some((h) => h.qid === v.handover && h.status === 'open');
}
// The gate, run only from a job already on the verbs' queue (a verb's run, or the watch's job): it
// folds afresh, keeps ctx.held, and runs one restart for every close not yet handled. It never queues
// itself and never skips, so a later queued job finds nothing left.
export async function browserGate(ctx) {
  if (ctx.stopping) return;
  const hs = browserHandovers();
  browserKeepHeld(ctx, hs);
  const closes = browserUnhandled(ctx, hs);
  if (closes.length) await browserCloseRestart(ctx, closes);
}
// At start, once the fresh Chrome is up and before the control server takes verbs: an entry for each
// close not yet handled, with no reopen (a dead daemon's notes are gone: R1), so done gets reopened []
// and no tab comes back. Chrome needs no restart: every start already deleted the session files.
export function browserStartGate(ctx) {
  const hs = browserHandovers();
  browserKeepHeld(ctx, hs);
  const closes = browserUnhandled(ctx, hs);
  if (closes.length) browserRecordCloses(ctx, closes, []);
}
// The watch, from start to stop: every 250 ms (kit-877) a fresh fold (browserFresh keys it cheaply), ctx.held
// kept, and a close not yet handled queued once on the verbs' queue (ctx.gateQueued, set when queued
// and cleared when the job ends, so a close queued or running isn't queued again); the owner's dialogs
// (kit-770) end as that close is seen, off the queue. With
// DEVTEAM_TEST_BROWSER_WATCH_HANDLE=0 (tests) it keeps ctx.held only: a close is then handled by a
// verb's pre-verb read or wait's settle alone.
export function browserWatch(ctx) {
  const t = setInterval(() => {
    if (ctx.stopping) return;
    try { browserViewRead(ctx); } catch { return; }
    if (browserTestEnv('DEVTEAM_TEST_BROWSER_WATCH_HANDLE') === '0' || ctx.gateQueued) return;
    if (!ctx.pending) return;
    browserOwnerDialogsEnd(ctx); // off the queue: a verb waiting behind one never holds the close up
    ctx.gateQueued = true;
    ctx.serial(() => browserGate(ctx)).finally(() => { ctx.gateQueued = false; });
  }, Number(browserTestEnv('DEVTEAM_TEST_BROWSER_WATCH_MS')) || 250); // the hook: tests, a slowed watch (kit-877: 250, so a close starts soon after Done)
  t.unref();
  return t;
}
// run/browser/last-error (0600): why the last daemon shut itself down on a failed close or forget
// restart, one line, for the offline status's plain text (browser@1's status JSON is unchanged). A
// daemon that comes up removes it. Control characters dropped, 300 characters at most.
export const browserErrorFile = () => path.join(BROWSER_DIR(), 'last-error');
export function browserLastError(detail, { make = true } = {}) {
  try {
    if (make) browserDirMade(); // the reaper's: none made (kit-877), a folder gone meanwhile fails the write
    const tmp = path.join(BROWSER_DIR(), `last-error.${process.pid}.tmp`);
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(tmp, `${new Date().toISOString()} ${String(detail).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 300)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, browserErrorFile());
  } catch {}
}
export const browserReadLastError = () => { try { return fs.readFileSync(browserErrorFile(), 'utf8').split('\n')[0].replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 330) || null; } catch { return null; } };
// kit-877: a failed delete of the session files said, never swallowed, by one rule for the shutdown and
// the reaper. reason: why the daemon ended, as last-error already says it (or null). No reason: msg
// alone. A reason that already says the delete failed: nothing added. Else the reason, cut to fit, and
// the delete's message whole, within last-error's 300 characters; a message too long to leave the
// reason 20 of them goes alone (cut at 300 only if it is longer itself). opts: browserLastError's.
export function browserReportDelete(reason, msg, opts) {
  if (!reason) return browserLastError(msg, opts);
  if (reason.includes("couldn't delete")) return;
  const join = "; the session files stay: ", room = 300 - join.length - msg.length;
  browserLastError(room < 20 ? msg : `${reason.slice(0, room)}${join}${msg}`, opts);
}
// kit-877, the reaper: once Chrome is up the daemon starts sh blocked reading a pipe only the daemon
// holds; when the daemon ends, however it ends (kill -9 too), the pipe closes and sh runs browser reap,
// unless the daemon's own shutdown deleted the session files, with no process left on the profile,
// and said "done" on the pipe first (a clean stop leaves the reaper nothing to do, and a start right
// after it nothing to race). Detached, so it outlives the daemon's window. DEVTEAM_TEST_BROWSER_REAP=0 (tests) starts none.
export function browserReaper(ctx) {
  if (browserTestEnv('DEVTEAM_TEST_BROWSER_REAP') === '0') return;
  try {
    const r = spawn('sh', ['-c', 'read -r x; [ "$x" = done ] || exec "$0" "$1" browser reap', process.execPath, fileURLToPath(import.meta.url)], { stdio: ['pipe', 'ignore', 'ignore'], detached: true, cwd: process.cwd(), env: process.env });
    r.on('error', () => {});
    r.stdin.on('error', () => {});
    r.unref();
    r.stdin.unref?.();
    ctx.reaper = r; // written to once, "done", by a shutdown that deleted the session files itself; else only its close matters
  } catch {}
}
export const browserCmdlineOf = (pid) => {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' '); } catch {}
  if (fs.existsSync('/proc/self/cmdline')) return '';
  const r = spawnSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
};
export const browserPgidOf = (pid) => {
  try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[2]); } catch {}
  if (fs.existsSync('/proc/self/stat')) return null;
  const r = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 ? Number(r.stdout.trim()) || null : null;
};
// browser reap (internal): the dead daemon's Chrome given 3 s to end, then killed (its group, and each
// process on the profile in that group); the session files deleted once no process holds the profile,
// or the failure said in last-error; once no session file is left, a last-error line that says they
// stay is made true (kit-917): a shutdown's reason, or a failed delete's own words, kept and ended with
// "the session files were deleted after the daemon ended"; a report of its own about them removed. It stands down, on any pass, when the profile is gone, a live
// daemon runs (state.json's daemon_pid, a browser serve), or a start holds the start lock. It makes no
// folder. DEVTEAM_TEST_BROWSER_REAP_DONE=<file> (tests): "done <exit code>" appended as it ends.
export async function browserReap() {
  let code = 1;
  try { code = await browserReapRun(); } catch {}
  const done = browserTestEnv('DEVTEAM_TEST_BROWSER_REAP_DONE');
  if (done) { try { fs.appendFileSync(done, `done ${code}\n`); } catch {} }
  process.exit(code);
}
export async function browserReapRun() {
  const profile = path.join(browserHome(), browserKey());
  const owner = path.join(BROWSER_DIR(), 'start.lock', 'owner');
  const standDown = () => {
    if (!fs.existsSync(profile)) return true;
    const st = browserRawState();
    if (st && browserAlive(st.daemon_pid) && browserCmdlineOf(st.daemon_pid).includes('browser serve')) return true;
    let t = null;
    try { t = fs.readFileSync(owner, 'utf8'); } catch {}
    const p = /^([1-9]\d*)-/.exec(t ?? '')?.[1];
    return !!p && browserAlive(Number(p));
  };
  // a file that can't even be looked at (EACCES, EIO) counts as left, so its failed delete is still said
  const left = () => browserSessionFiles(profile).some((f) => { try { return !!fs.lstatSync(f, { throwIfNoEntry: false }); } catch { return true; } });
  const gone = () => {
    if (standDown()) return 0;
    const text = browserReadLastError()?.replace(/^\S+ /, '') ?? '';
    const i = text.indexOf('; the session files stay: '), done = '; the session files were deleted after the daemon ended';
    const keep = i > 0 ? text.slice(0, i) : text.startsWith("browser: couldn't delete ") ? text : null; // a reason, or a failed delete's own words
    if (keep !== null) browserLastError(`${keep.slice(0, 300 - done.length)}${done}`, { make: false });
    else if (text.includes('session files stay')) { try { fs.rmSync(browserErrorFile(), { force: true }); } catch {} } // the reaper's own report
    return 0;
  };
  const report = (msg) => {
    if (standDown()) return 0;
    if (!left()) return gone(); // kit-917: nothing stays, so nothing says it does
    if (!fs.existsSync(BROWSER_DIR())) return 1;
    browserReportDelete(browserReadLastError()?.replace(/^\S+ /, '') ?? null, msg, { make: false });
    return 1;
  };
  if (standDown()) return 0;
  const cp = browserRawState()?.chrome_pid;
  if (Number.isInteger(cp) && cp > 0) {
    if (browserAlive(cp) && browserProofPid(cp, profile)) {
      await browserGone(cp, 3000);
      if (standDown()) return 0;
      if (browserAlive(cp) && browserProofPid(cp, profile)) { try { process.kill(-cp, 'SIGKILL'); } catch {} }
    }
    for (const p of browserProcsOn(profile) ?? []) if (browserPgidOf(p) === cp) { try { process.kill(p, 'SIGKILL'); } catch {} }
  }
  for (const end = Date.now() + 5000; ; await browserSleep(50)) {
    if (standDown()) return 0;
    const procs = browserProcsOn(profile);
    if (procs === null) return report("browser: couldn't list this machine's processes after the daemon ended, so the session files stay");
    if (!procs.length) {
      try { browserDeleteSession(profile); return gone(); } catch (e) { return report(String(e?.message ?? e)); }
    }
    if (Date.now() > end) return report(`browser: the daemon ended and a process (pid ${procs[0]}) still had the profile 5 s later; its session files stay until browser stop or the next start`);
  }
}
// The stop path: Browser.close, then the group signalled (SIGTERM, SIGKILL 2 s later) if Chrome
// hasn't gone in 5 s; the session files deleted (a failure said in last-error by browserReportDelete;
// once they are gone and no process is on the profile, within 500 ms, the reaper told done); state.json removed when it is this daemon's; the
// guard and servers closed; exit. Once a signal came, a dead pty can't end it early.
export function browserShutdown(ctx, why, detail) {
  if (ctx.stopping) return ctx.stopping;
  if (why === 'error' && detail) browserLastError(detail);
  if (why === 'signal') for (const s of [process.stdout, process.stderr]) { s.on('error', () => {}); }
  ctx.stopping = (async () => {
    clearTimeout(ctx.idle);
    clearInterval(ctx.renew);
    clearInterval(ctx.watch);
    browserOwnerDialogsEnd(ctx);
    try { ctx.viewer?.ws.close(1001); } catch {} // the view's socket closes with the daemon (no bye)
    await browserEndChrome(ctx.cdp, ctx.chrome?.pid);
    let deleted = false;
    try { browserDeleteSession(ctx.profile); deleted = true; } catch (e) { browserReportDelete(why === 'error' && detail ? String(detail) : null, String(e?.message ?? e)); } // kit-877: said, never swallowed
    let free = false;
    if (deleted && ctx.reaper) { try { for (const end = Date.now() + 500; !(free = browserProcsOn(ctx.profile)?.length === 0) && Date.now() < end; ) await browserSleep(25); } catch {} }
    if (free) await Promise.race([new Promise((r) => { try { ctx.reaper.stdin.write('done\n', () => r()); } catch { r(); } }), browserSleep(500)]); // kit-877: the reaper stands down
    if (browserRawState()?.daemon_pid === process.pid) fs.rmSync(browserStateFile(), { force: true });
    for (const s of [ctx.control, ctx.view]) { try { s?.closeAllConnections?.(); s?.close(); } catch {} }
    await Promise.race([ctx.guard?.close(), browserSleep(2000)]).catch(() => {});
    process.exit(0);
  })();
  return ctx.stopping;
}
// The verbs the daemon serves, each async (args) → { code, out }. Nothing a verb says holds a typed
// value or a key pressed: type prints only the ref.
export function browserVerbs(ctx) {
  const send = (method, params, tab = ctx.active) => ctx.cdp.send(method, params, tab.sessionId);
  // The active tab and the node a ref names on it (refs from its last snapshot), or a refusal.
  const at = (ref) => {
    const tab = ctx.active, id = tab?.refs?.get(String(ref));
    return tab?.sessionId && id !== undefined && /^e\d+$/.test(ref) ? { tab, id } : { no: { code: 1, out: `no ${/^e\d{1,6}$/.test(ref) ? ref : 'such ref'} on this page; take a snapshot` } };
  };
  const tabbed = (fn) => async (args) => (ctx.active?.sessionId ? fn(ctx.active, args) : { code: 1, out: 'browser: no tab to act on' });
  return {
    ping: async () => ({ code: 0, out: 'pong' }),
    status: async (args) => {
      const s = { browser: 1, instance: browserKey(), running: true, held: browserHeld(browserHandovers()), preview: ctx.preview, url: browserMask(ctx.active?.url ?? 'about:blank', ctx.active?.opening), tabs: ctx.tabs.length, restarted: ctx.restarted, notes: ctx.notes };
      if (args?.json) return { code: 0, out: JSON.stringify(s) };
      return { code: 0, out: [`browser running (preview ${s.preview}, profile ${s.instance})`, `url: ${s.url}`, `tabs: ${s.tabs}`, `restarted: ${s.restarted ? 'yes' : 'no'}`, browserHeldLine(s.held), ...s.notes.map((n) => `note: ${n}`)].join('\n') };
    },
    stop: async () => { ctx.after = () => browserShutdown(ctx, 'stop'); return { code: 0, out: 'browser stopped' }; },
    // internal (browser wait's): the gate, then every close of this scope that is handled, by this
    // daemon's record or by the ledger, with reopened from that record
    settle: async () => {
      await browserGate(ctx);
      if (ctx.stopping) return { code: 1, out: 'browser: stopping' };
      const ledger = browserLedger(), now = Date.now();
      const handled = [];
      for (const h of browserHandovers()) {
        if (h.status === 'open' || !h.outcome) continue;
        const r = browserHandled(ctx, h, ledger, now);
        if (r) handled.push({ qid: h.qid, outcome: h.outcome, ...(Array.isArray(r.reopened) ? { reopened: r.reopened } : {}) });
      }
      return { code: 0, out: JSON.stringify({ handled }) };
    },
    open: async ({ url }) => {
      if (!browserHttp(url)) return { code: 1, out: 'browser open takes an http: or https: URL' };
      const tab = ctx.active;
      if (!tab?.sessionId) return { code: 1, out: 'browser open: no tab to open it in' };
      Object.assign(tab, { opening: url, frameUrl: null, unreachable: null, refs: new Map() });
      const r = await browserLoad(tab, () => ctx.cdp.send('Page.navigate', { url }, tab.sessionId));
      const hold = Number(browserTestEnv('DEVTEAM_TEST_BROWSER_OPEN_DELAY_MS')); // tests: a long open, landed
      if (hold > 0) await browserSleep(hold);
      return browserLanded(ctx, tab, r, url, (u, title) => `opened ${u} (${title})`);
    },
    snapshot: async ({ json }) => ({ code: 0, out: await browserSnapshot(ctx, ctx.active, !!json) }),
    click: async ({ ref }) => {
      const { tab, id, no } = at(ref);
      if (no) return no;
      await send('DOM.scrollIntoViewIfNeeded', { backendNodeId: id });
      const q = (await send('DOM.getBoxModel', { backendNodeId: id })).model.content;
      const p = { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4, button: 'left', clickCount: 1 };
      return browserInput(ctx, tab, async () => {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, buttons: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, buttons: 0 });
      }, `clicked ${ref}`);
    },
    type: async ({ ref, text }) => {
      const { id, no } = at(ref);
      if (no) return no;
      if (typeof text !== 'string') return { code: 1, out: `usage: ${BROWSER_USAGE}` };
      await send('DOM.focus', { backendNodeId: id });
      await send('Input.insertText', { text });
      return { code: 0, out: `typed into ${ref}` };
    },
    press: tabbed(async (tab, { key }) => {
      if (!browserKeyOk(key)) return { code: 1, out: BROWSER_KEY_LIST };
      return browserInput(ctx, tab, async () => { for (const e of browserKeyEvents(key)) await send('Input.dispatchKeyEvent', e, tab); }, `pressed ${Object.hasOwn(BROWSER_KEYS, key) ? key : 'a key'}`);
    }),
    scroll: tabbed(async (tab, { dir }) => {
      if (!['up', 'down'].includes(dir)) return { code: 1, out: `usage: ${BROWSER_USAGE}` };
      const v = (await send('Page.getLayoutMetrics', {}, tab)).cssLayoutViewport;
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: v.clientWidth / 2, y: v.clientHeight / 2, deltaX: 0, deltaY: (dir === 'down' ? 0.8 : -0.8) * v.clientHeight }, tab);
      return { code: 0, out: `scrolled ${dir}` };
    }),
    back: tabbed(async (tab) => {
      const { currentIndex: i, entries } = await send('Page.getNavigationHistory', {}, tab);
      const to = i > 0 ? entries[i - 1] : null;
      if (!to) return { code: 1, out: 'nothing to go back to' };
      Object.assign(tab, { opening: to.url, frameUrl: null, unreachable: null, refs: new Map() });
      const r = await browserLoad(tab, async () => { tab.within = tab.loaded; await send('Page.navigateToHistoryEntry', { entryId: to.id }, tab); return { loaderId: 'history' }; }).finally(() => { tab.within = null; });
      return browserLanded(ctx, tab, r, to.url, (u, title) => `back at ${u} (${title})`);
    }),
    tabs: async () => {
      const tabs = [];
      for (const [i, t] of ctx.tabs.entries()) tabs.push({ n: i + 1, url: browserMask(t.url ?? 'about:blank', t.opening), title: await browserTitle(ctx, t), active: t === ctx.active });
      return { code: 0, out: JSON.stringify({ browser: 1, tabs }) };
    },
    tab: async ({ n }) => {
      const t = Number.isInteger(n) ? ctx.tabs[n - 1] : null;
      if (!t) return { code: 1, out: `browser tab: there is no tab ${Number.isInteger(n) ? n : ''} (${ctx.tabs.length} open; browser tabs lists them)` };
      await ctx.cdp.send('Target.activateTarget', { targetId: t.targetId });
      ctx.active = t;
      return { code: 0, out: `tab ${n} is active: ${browserMask(t.url ?? 'about:blank', t.opening)}` };
    },
    screenshot: tabbed(async (tab, { out: to }) => {
      if (to !== undefined && (typeof to !== 'string' || !path.isAbsolute(to))) return { code: 1, out: `usage: ${BROWSER_USAGE}` };
      return { code: 0, out: await browserShot(ctx, tab, to) };
    }),
  };
}
