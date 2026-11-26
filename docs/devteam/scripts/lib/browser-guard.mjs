/* imports start */
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { HUB_PORT } from './orient.mjs';
import { PORT_RANGE } from './orient.mjs';
import { TTYD_PORT } from './previews.mjs';
import { die } from './base.mjs';
import { flagStr } from './base.mjs';
import { out } from './base.mjs';
import { rest } from './base.mjs';
/* imports end */
/* browser-guard start */
// The browser's egress guard (browser@1, refusal; design supervisors-can-use-a-browser-with-the-o,
// Components 1). Chrome reaches the network only through it: a loopback forward proxy for
// absolute-form HTTP and CONNECT that refuses every destination on this machine's own network.
// Each dashboard takes owner presses from any same-origin page on its loopback port, so a browser
// that could load one could press them; this is what stops it. The rules, in the contract's order:
// own-name and gateway on the name, before resolving; then own-interface and special-purpose on
// every address the name resolved to (once), and the first that refuses is reported. It dials the
// address it checked, never the name, so DNS rebinding can't get past it. An answer it can't read
// is refused: it fails closed.
//
// The refused ranges, exactly the contract's range enum: every IANA special-purpose block, and for
// IPv6 everything outside 2000::/3 (::/3, 4000::/2, 8000::/1 when nothing narrower names it). An
// address embedding a refused IPv4 one (mapped, NAT64, 6to4, Teredo) falls in a refused IPv6
// range and is refused whole. The longest matching prefix is the range reported.
export const GUARD_RANGES = [
  '127.0.0.0/8', '0.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10', '192.0.0.0/24',
  '198.18.0.0/15', '224.0.0.0/4', '::/128', '::1/128', 'fc00::/7', 'fe80::/10', '64:ff9b::/96', '::ffff:0:0/96', '192.0.2.0/24',
  '192.31.196.0/24', '192.52.193.0/24', '192.88.99.0/24', '192.175.48.0/24', '198.51.100.0/24', '203.0.113.0/24', '240.0.0.0/4',
  '255.255.255.255/32', '64:ff9b:1::/48', '100::/64', '2001::/23', '2001::/32', '2001:db8::/32', '2002::/16', '2620:4f:8000::/48',
  '3fff::/20', '5f00::/16', 'ff00::/8', '::/3', '4000::/2', '8000::/1',
];
// An address as a number: { v, n, text }, text its normal form (what a refusal reports), or null
// for anything that isn't exactly an IPv4 dotted quad or an IPv6 address. IPv6 goes through WHATWG
// URL first, which writes a dotted tail (::ffff:127.0.0.1, as libuv may answer) as hex.
export function guardAddr(s) {
  const raw = String(s ?? '').split('%')[0];
  if (net.isIPv4(raw)) return { v: 4, n: raw.split('.').reduce((a, x) => (a << 8n) + BigInt(x), 0n), text: raw };
  if (!net.isIPv6(raw)) return null;
  let text;
  try { text = new URL(`http://[${raw}]/`).hostname.replace(/^\[|\]$/g, ''); } catch { return null; }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return { v: 6, n: groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g, 16)), 0n), text };
}
export let guardTable = null;
// The most specific refused range holding a parsed address, or null.
export function guardRange(a) {
  guardTable ??= GUARD_RANGES.map((cidr) => { const [base, p] = cidr.split('/'); return { cidr, ...guardAddr(base), prefix: Number(p) }; });
  const bits = a.v === 4 ? 32 : 128;
  let best = null;
  for (const r of guardTable) {
    if (r.v !== a.v) continue;
    const shift = BigInt(bits - r.prefix);
    if ((a.n >> shift) === (r.n >> shift) && (!best || r.prefix > best.prefix)) best = r;
  }
  return best?.cidr ?? null;
}
// Whether a parsed address is one of this machine's own, read on every call (a VPN, Tailscale).
export function guardOwn(a) {
  return Object.values(os.networkInterfaces() ?? {}).flat().some((e) => { const b = guardAddr(e?.address); return b && b.v === a.v && b.n === a.n; });
}
export const guardBare = (h) => String(h ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
export const GUARD_HOST = /^[A-Za-z0-9._:\[\]-]{1,255}$/;
// A host as the refusal may name it (browser@1 host's pattern): every other character a -, at most
// 255. URL lets a name keep characters the contract doesn't (a_b.localhost).
export const guardFit = (h) => (GUARD_HOST.test(h) ? h : String(h).replace(/[^A-Za-z0-9._:\[\]-]/g, '-').slice(0, 255) || '-');
// What a request asks for: { name, asked, port, connect, hostHeader?, path? }, or null (400). An
// absolute-form http: URL, or a CONNECT authority of exactly <host>:<port>, with the port read from
// the authority itself (URL drops a default one, and a ws: page's CONNECT names :80).
export function guardTarget(method, target) {
  let u;
  let asked;
  let port;
  if (method === 'CONNECT') {
    const m = /^(\[[0-9A-Fa-f:.]+\]|[^\[\]:/\\@?#\s]+):(\d{1,5})$/.exec(target ?? '');
    if (!m) return null;
    port = Number(m[2]);
    try { u = new URL(`http://${m[1]}`); } catch { return null; }
    if (u.pathname !== '/' || u.search || u.hash || u.username || u.password) return null;
    asked = target;
  } else {
    if (!/^http:\/\//i.test(target ?? '')) return null;
    try { u = new URL(target); } catch { return null; }
    if (u.protocol !== 'http:') return null;
    asked = target.slice(7).split(/[/?#]/)[0];
    port = Number(u.port || 80);
  }
  const name = guardBare(u.hostname);
  if (!name || port < 1 || port > 65535) return null;
  asked = guardFit(GUARD_HOST.test(asked) ? asked : u.host);
  if (method === 'CONNECT') return { name, asked, port, connect: true };
  const rest = target.slice(7 + target.slice(7).split(/[/?#]/)[0].length).split('#')[0];
  return { name, asked, port, connect: false, hostHeader: u.host, path: rest.startsWith('/') ? rest : `/${rest}` };
}
// own-name or gateway, decided on the name before anything resolves it.
export function guardNameRule(name) {
  const own = guardBare(os.hostname());
  if (name === 'localhost' || name.endsWith('.localhost') || (own && name === own)) return 'own-name';
  let gw = '';
  try { gw = process.env.DEVTEAM_PUBLIC_URL ? guardBare(new URL(process.env.DEVTEAM_PUBLIC_URL).hostname) : ''; } catch {}
  if (gw && (name === gw || name.endsWith(`.${gw}`))) return 'gateway';
  return null;
}
// The ports no test exception ever opens: the hub, the dashboards' block, ttyd and the gateway, at
// their defaults and wherever the environment moved them.
export function guardNeverPorts() {
  const own = process.env.DEVTEAM_PUBLIC_URL && Number(process.env.PORT) > 0 ? [Number(process.env.PORT)] : [];
  return new Set([4320, ...Array.from({ length: 25 }, (_, i) => 4321 + i), 7681, 8080, HUB_PORT, ...PORT_RANGE, TTYD_PORT, ...own]);
}
// The tests' one way out (DEVTEAM_TEST set and non-empty): a loopback port DEVTEAM_TEST_BROWSER_ALLOW
// lists, for the fixture site, when every address is loopback (127.0.0.0/8, or ::1 exactly).
export function guardAllowed(port, addrs) {
  if (!process.env.DEVTEAM_TEST) return false;
  const listed = String(process.env.DEVTEAM_TEST_BROWSER_ALLOW ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d{1,5}$/.test(s)).map(Number);
  if (!listed.includes(port) || guardNeverPorts().has(port)) return false;
  return addrs.length > 0 && addrs.every((a) => (a.v === 4 && a.n >> 24n === 127n) || (a.v === 6 && a.n === 1n));
}
// A socket to the address it checked (never a name: no second lookup), connected, or an error.
export function guardDial(address, port) {
  return new Promise((resolve, reject) => {
    let s;
    try { s = net.connect({ host: address, port }); } catch (e) { return reject(e); }
    const timer = setTimeout(() => { s.destroy(); reject(Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' })); }, 30000);
    const failed = (e) => { clearTimeout(timer); reject(e); };
    s.once('error', failed);
    s.once('connect', () => { clearTimeout(timer); s.off('error', failed); s.on('error', () => {}); resolve(s); });
  });
}
// Headers that end at the guard, either way: the hop-by-hop ones and those Connection names.
export const GUARD_HOP = ['connection', 'proxy-connection', 'keep-alive', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'upgrade', 'transfer-encoding'];
export function guardEndToEnd(headers) {
  const drop = new Set([...GUARD_HOP, ...String(headers.connection ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)]);
  return Object.fromEntries(Object.entries(headers).filter(([k]) => !drop.has(k.toLowerCase())));
}
// A plain request, sent on the socket it dialled (createConnection, no agent: with agent: false Node
// would ignore it and dial the host itself), its answer streamed back.
export function guardForward(req, res, t, sock, fail) {
  // the client may have left while the name resolved or the socket dialled: nothing to send it
  if (req.socket?.destroyed || res.destroyed) return void sock.destroy();
  const headers = { ...guardEndToEnd(req.headers), host: t.hostHeader };
  // the body's framing goes out as it came, whatever Connection names (Node frames no body itself
  // for GET, HEAD, DELETE, OPTIONS; its parser has already refused a request with both or neither)
  if (req.headers['transfer-encoding']) headers['transfer-encoding'] = req.headers['transfer-encoding'];
  else if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
  const up = http.request({ host: sock.remoteAddress, port: t.port, method: req.method, path: t.path, headers, createConnection: () => sock });
  up.on('response', (ur) => {
    // a status line Node reads but won't write (a control character, a code under 100) is the
    // site's fault: a 502, never a throw out of this listener
    try { res.writeHead(ur.statusCode, guardEndToEnd(ur.headers)); } catch {
      ur.destroy();
      up.destroy();
      return void fail('the site sent an answer the guard could not pass on');
    }
    ur.on('error', () => res.destroy());
    ur.pipe(res);
  });
  up.on('error', (e) => { if (res.headersSent) res.destroy(); else fail(e?.code ?? 'the site closed the connection'); });
  res.on('close', () => { if (!res.writableFinished) { up.destroy(); sock.destroy(); } });
  req.pipe(up);
}
// A CONNECT tunnel on the socket it dialled.
export function guardTunnel(client, head, sock) {
  if (client.destroyed) return void sock.destroy();
  client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  if (head?.length) sock.write(head);
  for (const [a, b] of [[client, sock], [sock, client]]) { a.on('error', () => b.destroy()); a.on('close', () => b.destroy()); a.pipe(b); }
}
// { refuse: { rule, address?, range? } }, { fail: why } (a 502) or { address } to dial. lookup is
// dns.lookup, called once for a name.
export async function guardDecide(t, lookup) {
  const named = guardNameRule(t.name);
  if (named) return { refuse: { rule: named } };
  const literal = guardAddr(t.name);
  let addrs = literal ? [literal] : null;
  if (!addrs) {
    let list;
    try { list = await new Promise((resolve, reject) => lookup(t.name, { all: true, verbatim: true }, (e, l) => (e ? reject(e) : resolve(l)))); } catch (e) { return { fail: `no address for it (${e?.code ?? 'lookup failed'})` }; }
    // before any rule or the test exception: none, or one it can't read, never reaches a dial
    if (!Array.isArray(list) || !list.length) return { fail: 'no address for it' };
    addrs = [];
    for (const x of list) {
      const a = guardAddr(x?.address);
      if (!a) return { refuse: { rule: 'special-purpose', address: String(x?.address) } };
      addrs.push(a);
    }
  }
  if (guardAllowed(t.port, addrs)) return { address: addrs[0].text };
  for (const a of addrs) if (guardOwn(a)) return { refuse: { rule: 'own-interface', address: a.text } };
  for (const a of addrs) { const range = guardRange(a); if (range) return { refuse: { rule: 'special-purpose', address: a.text, range } }; }
  return { address: addrs[0].text };
}
export const guardEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// The refusal page: plain words, and the browser@1 refusal object as JSON with every < escaped.
export function guardRefusal(rule, { asked, address, range } = {}) {
  // an address as given (a resolver answer that couldn't be read) is 2 to 64 characters there
  if (address !== undefined) address = String(address).slice(0, 64).padEnd(2, '?');
  const at = address ? `${asked} (${address})` : asked;
  const why = {
    'own-name': `The supervisor's browser can't open ${asked}: it is this machine's own name.`,
    gateway: `The supervisor's browser can't open ${asked}: it is this box's gateway, where the owner's controls are.`,
    'own-interface': `The supervisor's browser can't open ${at}: it is an address of this machine.`,
    'special-purpose': range ? `The supervisor's browser can't open ${at}: ${range} is not on the public internet.` : `The supervisor's browser can't open ${asked}: its address (${address}) could not be read, so it is refused.`,
    'not-a-proxy-request': "This is the browser's proxy; it answers only proxy requests.",
  }[rule].slice(0, 500);
  const o = { browser: 1, rule, why };
  if (rule !== 'not-a-proxy-request') o.host = asked;
  if (address) o.address = address;
  if (range) o.range = range;
  const title = rule === 'not-a-proxy-request' ? 'Not a proxy request' : 'This page is blocked';
  const body = `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${title}</title></head>\n<body>\n<h1>${title}</h1>\n<p>${guardEsc(why)}</p>\n<script type="application/json" id="devteam-refusal">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>\n</body>\n</html>\n`;
  return { status: rule === 'not-a-proxy-request' ? 400 : 403, body };
}
export const guardHead = (status, type, length) => `HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\ncontent-type: ${type}\r\ncontent-length: ${length}\r\nconnection: close\r\n\r\n`;
// An answer on a raw socket (a CONNECT's), then the socket closes.
export function guardSocketAnswer(sock, status, body, type = 'text/html; charset=utf-8') {
  if (sock.destroyed) return;
  sock.end(guardHead(status, type, Buffer.byteLength(body)) + body);
}
export function guardAnswer(res, status, body, type = 'text/html; charset=utf-8') {
  if (res.headersSent) return void res.destroy();
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body), connection: 'close' });
  res.end(body);
}
// The guard on 127.0.0.1: { port, close() }. browser serve starts it in-process; `browser-guard`
// runs it alone.
export async function startBrowserGuard({ port = 0 } = {}) {
  const dns = (await import('node:dns')).default;
  const lookup = (...a) => dns.lookup(...a);
  const server = http.createServer();
  server.on('connection', (s) => s.on('error', () => {}));
  // a head Node's own parser refuses (a backslash in a CONNECT authority, say) is no proxy request either
  server.on('clientError', (e, s) => { if (!s.writable) return void s.destroy(); const r = guardRefusal('not-a-proxy-request'); guardSocketAnswer(s, r.status, r.body); });
  // One request or CONNECT: decided, then refused, failed (502) or passed on. answer(status, body,
  // type) writes the guard's own answer; pass(t, address) dials. Nothing it throws ends the guard:
  // whatever goes wrong is a 502, never a pass.
  const serve = async (method, target, answer, pass) => {
    const t = guardTarget(method, target);
    if (!t) { const r = guardRefusal('not-a-proxy-request'); return answer(r.status, r.body); }
    const fail = (why) => answer(502, `The supervisor's browser couldn't reach ${t.asked}: ${why}\n`, 'text/plain; charset=utf-8');
    try {
      const d = await guardDecide(t, lookup);
      if (d.refuse) { const r = guardRefusal(d.refuse.rule, { asked: t.asked, ...d.refuse }); return answer(r.status, r.body); }
      if (d.fail) return fail(d.fail);
      return await pass(t, d.address, fail);
    } catch (e) { return fail(e?.code ?? 'the guard failed'); }
  };
  server.on('request', (req, res) => {
    req.on('error', () => {});
    res.on('error', () => {});
    serve(req.method, req.url, (status, body, type) => guardAnswer(res, status, body, type), async (t, address, fail) => guardForward(req, res, t, await guardDial(address, t.port), fail)).catch(() => res.destroy());
  });
  server.on('connect', (req, sock, head) => {
    sock.on('error', () => {});
    // once the tunnel is open, a fault closes it: no answer is ever written into it
    let open = false;
    const answer = (status, body, type) => (open ? sock.destroy() : guardSocketAnswer(sock, status, body, type));
    serve('CONNECT', req.url, answer, async (t, address) => { const up = await guardDial(address, t.port); open = true; guardTunnel(sock, head, up); }).catch(() => sock.destroy());
  });
  // Chrome tunnels ws: and wss: through CONNECT, so an Upgrade in absolute form is none of its own
  server.on('upgrade', (req, sock) => {
    sock.on('error', () => {});
    if (!guardTarget(req.method, req.url)) { const r = guardRefusal('not-a-proxy-request'); return guardSocketAnswer(sock, r.status, r.body); }
    guardSocketAnswer(sock, 501, "The supervisor's browser proxy tunnels WebSockets through CONNECT; it doesn't upgrade a request.\n", 'text/plain; charset=utf-8');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  return { port: server.address().port, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }) };
}
export async function cmdBrowserGuard() {
  const p = flagStr('port');
  const port = p === undefined ? 0 : Number(p);
  if (!Number.isInteger(port) || port < 0 || port > 65535) die('--port is a port number, 0 to 65535 (0: any free one)');
  const g = await startBrowserGuard({ port });
  out(JSON.stringify({ browser: 1, port: g.port }));
}
/* browser-guard end */

