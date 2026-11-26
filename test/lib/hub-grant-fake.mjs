// hub-grant@1's fake (test/contracts/hub-grant.md §16): an in-process authorization server that
// follows the contract, for the tests of devteam login and the hub's grants list, and the contract's
// rules as functions a consumer may test its own code against. Node built-ins only.
//
// Not the gateway: no passkeys, no consent page (authorize answers at once as if the person allowed
// it), no network fetch (a test hands it each client's metadata answer), and served over http on
// loopback, so its issuer is its own origin, http://127.0.0.1:<port>, where the gateway's is
// https://<box>. The hub's revoke form and the list take the person from the header
// x-hub-grant-fake-person in place of a passkey session.
import http from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';

export const SCOPES = ['hub:read', 'threads:write', 'mcp', 'bridge', 'owner:act'];
export const LIMITS = {
  labelBytes: 40, codeMs: 60 * 1000, accessMs: 3600 * 1000, refreshIdleMs: 30 * 86400 * 1000, refreshMaxMs: 90 * 86400 * 1000,
  liveGrants: 20, spentKept: 100, metadataBytes: 5120, metadataMs: 5000, metadataCacheMs: 3600 * 1000, redirectUris: 10,
  clientNameBytes: 200, stateChars: 512, lastUsedMs: 60 * 1000, queryBytes: 8 * 1024, formBytes: 16 * 1024, mcpBytes: 1024 * 1024, fetchesAtOnce: 4,
};
export const NO_DETAILS = "couldn't read this app's details";
export const TOO_MANY = 'revoke one on your People page';
export const MCP_LATER = 'the tools come with the MCP goal';
export const MCP_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25', '2026-07-28'];
export const DEFAULT_PROTOCOL = '2026-07-28';

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const hash = (s) => b64u(crypto.createHash('sha256').update(s).digest());
const token = () => b64u(crypto.randomBytes(32));
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The two audiences of an origin (§2): '<origin>/' and '<origin>/mcp'.
export const audiences = (origin) => ({ root: `${origin}/`, mcp: `${origin}/mcp` });
// Which audience a scope belongs to (§7's first table); owner:act belongs to either.
const scopeAudience = { 'hub:read': 'root', 'threads:write': 'root', mcp: 'mcp', bridge: 'root', 'owner:act': 'either' };

// §3: the two metadata documents, for an origin.
export function asMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/auth/grant/authorize`,
    token_endpoint: `${origin}/auth/grant/token`,
    revocation_endpoint: `${origin}/auth/grant/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...SCOPES],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}
export function prmMcp(origin) {
  return { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['mcp'], bearer_methods_supported: ['header'] };
}

// §5: why a label is bad, or null when it is good. Given decoded.
const LABEL_BANNED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}[\];%]/u;
export function labelProblem(label) {
  if (typeof label !== 'string') return 'no label';
  if (label === '') return 'the label is empty';
  if (/\p{Cs}/u.test(label)) return 'the label is not valid UTF-8';
  if (Buffer.byteLength(label) > LIMITS.labelBytes) return `the label is over ${LIMITS.labelBytes} bytes`;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(label)) return 'the label holds a control, format or separator character';
  if (/[[\];%]/.test(label)) return 'the label holds [, ], ; or %';
  if (/^\p{Zs}|\p{Zs}$/u.test(label)) return 'the label starts or ends with a space';
  return null;
}
// §5: a metadata-document client's label from its client_name.
export function labelFromClientName(name) {
  if (typeof name !== 'string') return 'an app';
  let out = '';
  for (const ch of name.replace(new RegExp(LABEL_BANNED.source, 'gu'), '')) {
    if (Buffer.byteLength(out + ch) > LIMITS.labelBytes) break;
    out += ch;
  }
  out = out.replace(/^\p{Zs}+|\p{Zs}+$/gu, '');
  return out === '' ? 'an app' : out;
}
// A query or form value, decoded ('+' a space); null when its encoding isn't valid UTF-8.
function decodeValue(raw) {
  try { return decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { return null; }
}
// A query or form string as [name, value] pairs, in order; a value that won't decode is null.
export function parsePairs(s) {
  if (!s) return [];
  return s.split('&').filter((x) => x !== '').map((part) => {
    const i = part.indexOf('=');
    const k = decodeValue(i < 0 ? part : part.slice(0, i));
    return [k, i < 0 ? '' : decodeValue(part.slice(i + 1))];
  });
}

// §11: the grant mark. rawHeaders is Node's flat [name, value, ...] list. Returns null with no mark,
// { error } when it is refused, else { id, ownerAct, label }.
const MARK = /^(g-[A-Za-z0-9_-]{1,64});owner-act=([01]);label=((?:[A-Za-z0-9\-_.!~*'()]|%[0-9A-Fa-f]{2})+)$/;
export function parseGrantMark(rawHeaders) {
  const values = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) if (String(rawHeaders[i]).toLowerCase() === 'x-devteam-grant') values.push(String(rawHeaders[i + 1]));
  if (!values.length) return null;
  if (values.length > 1) return { error: 'x-devteam-grant appears more than once' };
  const m = MARK.exec(values[0]);
  if (!m) return { error: 'x-devteam-grant is not <grant id>;owner-act=<0|1>;label=<percent-encoded>' };
  let label;
  try { label = decodeURIComponent(m[3]); } catch { return { error: 'the label is not valid UTF-8' }; }
  const bad = labelProblem(label);
  if (bad) return { error: bad };
  return { id: m[1], ownerAct: m[2] === '1', label };
}
export const formatGrantMark = ({ id, ownerAct, label }) => `${id};owner-act=${ownerAct ? 1 : 0};label=${encodeURIComponent(label)}`;

// §7: a raw path's problem before matching, or null.
export function pathProblem(target) {
  const raw = String(target).split('?')[0];
  if (!raw.startsWith('/')) return 'not a path';
  if (raw.includes('//')) return 'a doubled slash';
  if (/%2e/i.test(raw)) return 'an encoded dot';
  if (/%2f|%5c|\\/i.test(raw)) return 'an encoded slash or a backslash';
  if (raw.split('/').slice(1).some((s) => s === '.' || s === '..')) return 'a dot segment';
  return null;
}
// §7's second table. host: 'box' (<box>), 'project' (<project>.<box>), or anything else (the
// terminal, a preview, a published page), which no token opens.
export const ROUTES = [
  ['GET', '/box.json', 'box', 'hub:read'],
  ['GET', '/instances.json', 'box', 'hub:read'],
  ['GET', '/memory.json', 'box', 'hub:read'],
  ['GET', '/api/data', 'project', 'hub:read'],
  ['GET', '/api/threads', 'project', 'hub:read'],
  ['POST', '/api/thread-new', 'project', 'threads:write'],
  ['POST', '/api/thread-say', 'project', 'threads:write'],
  ['POST', '/upload', 'project', 'threads:write'],
  ['POST', '/mcp', 'box', 'mcp'],
];
// { refused: <why> } for a bad path, null for a route no scope opens, else { scope, audience }.
export function routeFor(method, host, target) {
  const bad = pathProblem(target);
  if (bad) return { refused: bad };
  const p = String(target).split('?')[0];
  const r = ROUTES.find(([m, path, h]) => m === method && path === p && h === host);
  return r ? { scope: r[3], audience: scopeAudience[r[3]] } : null;
}

// §4: the kit's loopback redirect form.
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})([/?][^#]*)?$/;
const loopback = (uri) => {
  const m = LOOPBACK.exec(uri);
  return m && Number(m[2]) <= 65535 ? { host: m[1], port: m[2], rest: m[3] ?? '' } : null;
};
const httpsUri = (uri) => {
  if (typeof uri !== 'string' || uri.includes('#') || !/^https:\/\//.test(uri)) return false;
  try { const u = new URL(uri); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
};
// §6: a loopback redirect a metadata document may list: 127.0.0.1, localhost or [::1], with or
// without a port, then a path. Compared with the port left out (§4).
const AUTHORIZE_PARAMS = new Set(['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource', 'label']);
const TOKEN_PARAMS = new Set(['grant_type', 'code', 'redirect_uri', 'client_id', 'code_verifier', 'resource', 'refresh_token', 'scope']);
const LISTED_LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::([1-9][0-9]{0,4}))?(\/[^#]*)$/;
const listedLoopback = (uri) => {
  const m = typeof uri === 'string' ? LISTED_LOOPBACK.exec(uri) : null;
  return m && (m[2] === undefined || Number(m[2]) <= 65535) ? { host: m[1], rest: m[3] ?? '' } : null;
};
// client: 'devteam', or a metadata document ({ redirect_uris }).
export function redirectAllowed(client, uri) {
  if (typeof uri !== 'string' || uri.includes('#')) return false;
  if (client === 'devteam') return Boolean(loopback(uri));
  if (!isObj(client) || !Array.isArray(client.redirect_uris)) return false;
  if (client.redirect_uris.includes(uri) && (httpsUri(uri) || listedLoopback(uri))) return true;
  const asked = listedLoopback(uri);
  return Boolean(asked && client.redirect_uris.some((l) => { const x = listedLoopback(l); return x && x.host === asked.host && x.rest === asked.rest; }));
}

// §6: whether an address the metadata host resolved to may be fetched.
const v4int = (ip) => ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
const V4_REFUSED = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]];
const inV4 = (n, [base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(v4int(base) / 2 ** (32 - bits));
function v6big(ip) {
  let s = ip;
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) { const n = v4int(tail[1]); s = s.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`; }
  const [head, rest] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const parts = rest === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  return parts.reduce((x, h) => (x << 16n) + BigInt(parseInt(h, 16)), 0n);
}
const V6_REFUSED = [['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['3fff::', 20], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]];
const inV6 = (n, [base, bits]) => (n >> BigInt(128 - bits)) === (v6big(base) >> BigInt(128 - bits));
export function addressAllowed(ip) {
  const kind = net.isIP(String(ip));
  if (kind === 4) return !V4_REFUSED.some((r) => inV4(v4int(ip), r)) && ip !== '255.255.255.255';
  if (kind === 6) {
    const n = v6big(String(ip).toLowerCase().replace(/%.*$/, ''));
    return inV6(n, ['2000::', 3]) && !V6_REFUSED.some((r) => inV6(n, r));
  }
  return false;
}

// §6: why a client_id URL can't be fetched, or null.
export function clientIdUrlProblem(url) {
  if (typeof url !== 'string' || !url.startsWith('https://') || url.includes('#')) return 'not an https URL without a fragment';
  if (/\\|%5c/i.test(url)) return 'a backslash';
  if (/[^\x21-\x7e]/.test(url)) return 'a space, control or non-ASCII character';
  let u;
  try { u = new URL(url); } catch { return 'not a URL'; }
  if (u.username || u.password) return 'user info';
  if (u.pathname === '/' || u.pathname === '') return 'no path';
  if (url.includes('?')) return 'a query';
  const rawPath = url.replace(/^https:\/\/[^/]*/, '');
  if (pathProblem(rawPath)) return `its path holds ${pathProblem(rawPath)}`;
  return null;
}
// §6: why a fetched answer is refused, or null. answer: { status, body (string or Buffer), ms }.
export function metadataProblem(url, answer) {
  const bad = clientIdUrlProblem(url);
  if (bad) return bad;
  if (!isObj(answer)) return 'no answer';
  if (answer.status >= 300 && answer.status < 400) return 'a redirect';
  if (answer.status !== 200) return `status ${answer.status}`;
  if (typeof answer.ms === 'number' && answer.ms > LIMITS.metadataMs) return 'slower than 5 s';
  const bytes = Buffer.from(answer.body ?? '');
  if (bytes.length > LIMITS.metadataBytes) return 'over 5 KB';
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch { return 'not JSON'; }
  if (!isObj(doc)) return 'not a JSON object';
  if (doc.client_id !== url) return 'client_id differs from the URL';
  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length < 1 || doc.redirect_uris.length > LIMITS.redirectUris) return 'redirect_uris is not 1 to 10 URIs';
  if (!doc.redirect_uris.every((u) => typeof u === 'string' && (httpsUri(u) || listedLoopback(u)))) return 'a redirect URI is neither https nor loopback';
  if (doc.client_name !== undefined && (typeof doc.client_name !== 'string' || Buffer.byteLength(doc.client_name) > LIMITS.clientNameBytes)) return 'client_name is not a string of at most 200 bytes';
  return null;
}

// §10: may a person hold a scope now?
export function mayHold(person, scope) {
  if (!person) return false;
  if (scope === 'hub:read' || scope === 'mcp') return true;
  if (scope === 'threads:write') return person.level !== 'view';
  return person.role === 'owner';
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function startHubGrantFake(opts = {}) {
  let people = (opts.people ?? [{ id: 'p-owner', name: 'Owner', role: 'owner', level: 'full' }]).map((p) => ({ ...p }));
  let as = opts.as ?? people[0].id;
  let stamp = opts.stamp ?? 'stamp-1';
  const metadata = new Map(Object.entries(opts.metadata ?? {}));
  let t = opts.start ?? Date.now();
  const manual = opts.clock === 'manual';
  const now = () => (manual ? t : Date.now());
  const grants = [];
  const codes = new Map();
  const access = new Map();
  let origin = null;
  let serial = 0;

  const personOf = (id) => people.find((p) => p.id === id) ?? null;
  const end = (g, reason) => { if (!g.ended) g.ended = { at: now(), reason }; };
  // a grant alive now, ending it when its person is gone or its refresh has expired
  const alive = (g) => {
    if (g.ended || g.stamp !== stamp) return false;
    if (!personOf(g.person)) { end(g, 'person removed'); return false; }
    if (g.refresh_expires <= now()) { end(g, 'expired'); return false; }
    return true;
  };
  const liveCount = (pid) => grants.filter((g) => g.person === pid && alive(g)).length;
  const aud = () => audiences(origin);
  const audienceKey = (r) => (r === aud().root ? 'root' : r === aud().mcp ? 'mcp' : null);
  const scopesFor = (g, resource, narrow = null) => {
    const k = audienceKey(resource);
    const p = personOf(g.person);
    return SCOPES.filter((s) => g.scopes.includes(s) && (scopeAudience[s] === k || scopeAudience[s] === 'either') && mayHold(p, s) && (!narrow || narrow.includes(s)));
  };
  const touch = (g) => { if (now() - (g.last_used ?? 0) >= LIMITS.lastUsedMs) g.last_used = now(); };

  const send = (res, status, type, body, extra = {}) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra });
    res.end(body);
  };
  const json = (res, status, obj, extra) => send(res, status, 'application/json', JSON.stringify(obj), extra);
  const errorPage = (res, words) => send(res, 400, 'text/html; charset=utf-8', `<!doctype html><title>Can't sign in</title><p>${esc(words)}</p>`);
  const oauthError = (res, error, description) => json(res, 400, { error, error_description: description });
  // a body, or null once it is over max bytes (read to its end, so a 413 can be answered)
  const readBody = (req, max) => new Promise((resolve, reject) => {
    const parts = [];
    let n = 0;
    req.on('data', (c) => { n += c.length; if (n <= max) parts.push(c); });
    req.on('end', () => resolve(n > max ? null : Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
  // a parameter list as a map of name to values; null names (bad encoding) kept as such
  const group = (pairs) => {
    const m = new Map();
    for (const [k, v] of pairs) m.set(k, [...(m.get(k) ?? []), v]);
    return m;
  };

  function clientOf(clientId) {
    if (clientId === 'devteam') return { id: 'devteam', name: 'devteam', doc: 'devteam' };
    if (clientIdUrlProblem(clientId)) return null;
    const answer = metadata.get(clientId);
    if (!answer || metadataProblem(clientId, answer)) return null;
    const doc = JSON.parse(Buffer.from(answer.body).toString('utf8'));
    return { id: clientId, name: typeof doc.client_name === 'string' ? doc.client_name : null, doc };
  }

  function authorize(req, res, query) {
    if (Buffer.byteLength(query) > LIMITS.queryBytes) return errorPage(res, 'This sign-in request is too long.');
    const q = group(parsePairs(query));
    const one = (k) => (q.get(k)?.length === 1 ? q.get(k)[0] : undefined);
    // never redirected: the client, its redirect, the label, the person's grant count
    const clientId = one('client_id');
    if (typeof clientId !== 'string') return errorPage(res, 'This sign-in names no app, or more than one.');
    const client = clientOf(clientId);
    if (!client) return errorPage(res, NO_DETAILS);
    const redirect = one('redirect_uri');
    if (typeof redirect !== 'string' || !redirectAllowed(client.doc, redirect)) return errorPage(res, 'This app may not send you back to that address.');
    let label = null;
    if (q.has('label')) {
      if (q.get('label').length !== 1) return errorPage(res, 'The computer\'s label is given more than once.');
      label = one('label');
      const bad = label === null ? 'the label is not valid UTF-8' : labelProblem(label);
      if (bad) return errorPage(res, `The computer's label can't be used: ${bad}.`);
    } else if (client.id === 'devteam') return errorPage(res, 'devteam login sends the computer\'s label; this sign-in has none.');
    else label = labelFromClientName(client.name);
    if (liveCount(as) >= LIMITS.liveGrants) return errorPage(res, `You have ${LIMITS.liveGrants} computers and apps signed in: ${TOO_MANY}.`);
    // from here every error goes back to the redirect
    const state = one('state');
    const back = (params) => {
      const u = new URL(redirect);
      for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.append(k, v);
      res.writeHead(302, { location: u.toString(), 'cache-control': 'no-store' });
      res.end();
    };
    const fail = (error, description) => back({ error, error_description: description, state: typeof state === 'string' && state.length >= 1 && state.length <= LIMITS.stateChars ? state : undefined, iss: origin });
    for (const [k, v] of q) if (k === null || v.includes(null)) return fail('invalid_request', 'a parameter is not valid UTF-8');
    for (const [k, v] of q) if (k !== 'resource' && AUTHORIZE_PARAMS.has(k) && v.length > 1) return fail('invalid_request', `${k} is given more than once`);
    if (one('response_type') !== 'code') return fail('unsupported_response_type', 'only response_type=code');
    if (one('code_challenge_method') !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256');
    if (!/^[A-Za-z0-9_-]{43}$/.test(one('code_challenge') ?? '')) return fail('invalid_request', 'code_challenge must be a base64url SHA-256');
    if (state !== undefined && (state.length < 1 || state.length > LIMITS.stateChars)) return fail('invalid_request', 'state must be 1 to 512 characters');
    const resources = q.get('resource') ?? [];
    if (!resources.length) return fail('invalid_request', 'at least one resource is required');
    if (new Set(resources).size !== resources.length || !resources.every(audienceKey)) return fail('invalid_target', 'an unknown or repeated resource');
    if (client.id !== 'devteam' && resources.some((r) => audienceKey(r) !== 'mcp')) return fail('invalid_target', 'an app signs in for the MCP server alone');
    const keys = resources.map(audienceKey);
    let scopes;
    const asked = one('scope');
    if (asked === undefined) scopes = [...(keys.includes('root') ? ['hub:read'] : []), ...(keys.includes('mcp') ? ['mcp'] : [])];
    else {
      scopes = asked.split(' ');
      if (scopes.some((s) => !SCOPES.includes(s)) || new Set(scopes).size !== scopes.length) return fail('invalid_scope', 'an unknown or repeated scope');
      if (scopes.some((s) => scopeAudience[s] !== 'either' && !keys.includes(scopeAudience[s]))) return fail('invalid_scope', 'a scope whose audience was not asked for');
      if (client.id !== 'devteam' && scopes.some((s) => s !== 'mcp')) return fail('invalid_scope', 'an app may ask only for mcp');
    }
    const person = personOf(as);
    if (!person || scopes.some((s) => (s === 'bridge' || s === 'owner:act') && !mayHold(person, s))) return fail('access_denied', 'only the owner may allow bridge or owner:act');
    // threads:write for a View person is left out, never refused (§4)
    scopes = scopes.filter((s) => mayHold(person, s));
    if (!scopes.length) return fail('access_denied', 'nothing you asked for is yours to allow');
    const code = token();
    codes.set(hash(code), { client_id: client.id, client_name: client.name, redirect, challenge: one('code_challenge'), resources, scopes, label, person: person.id, stamp, expires: now() + LIMITS.codeMs, used: false });
    return back({ code, state, iss: origin });
  }

  function issue(res, g, resource, narrow) {
    const scopes = scopesFor(g, resource, narrow);
    const a = token();
    g.access = [...g.access.filter((x) => x.expires > now()), { hash: hash(a), resource, expires: now() + LIMITS.accessMs }];
    access.set(hash(a), { grant: g, resource, scopes: g.scopes.filter((s) => !narrow || narrow.includes(s)), expires: now() + LIMITS.accessMs });
    const r = token();
    g.refresh_hash = hash(r);
    g.refresh_expires = Math.min(now() + LIMITS.refreshIdleMs, g.created_at + LIMITS.refreshMaxMs);
    touch(g);
    const p = personOf(g.person);
    return json(res, 200, { access_token: a, token_type: 'Bearer', expires_in: LIMITS.accessMs / 1000, refresh_token: r, scope: scopes.join(' '), person: { id: p.id, name: p.name } });
  }

  async function tokenRoute(req, res) {
    const body = await readBody(req, LIMITS.formBytes);
    if (body === null) return json(res, 413, { error: 'invalid_request', error_description: 'the request is over 16 KB' });
    const f = group(parsePairs(body));
    for (const [k, v] of f) if (k === null || v.includes(null) || (TOKEN_PARAMS.has(k) && v.length > 1)) return oauthError(res, 'invalid_request', 'a parameter is repeated or not valid UTF-8');
    const one = (k) => f.get(k)?.[0];
    const pickResource = (g) => {
      const r = one('resource');
      if (r === undefined) return g.resources.length === 1 ? { r: g.resources[0] } : { error: ['invalid_request', 'name the resource: this grant has two'] };
      return g.resources.includes(r) ? { r } : { error: ['invalid_target', 'not a resource of this grant'] };
    };
    if (one('grant_type') === 'authorization_code') {
      const c = codes.get(hash(one('code') ?? ''));
      if (!c) return oauthError(res, 'invalid_grant', 'that code is unknown');
      const used = c.used;
      c.used = true;
      if (used) {
        const made = grants.find((x) => x.id === c.grant);
        if (made) end(made, 'code reused');
        return oauthError(res, 'invalid_grant', 'that code was used before');
      }
      if (c.expires <= now()) return oauthError(res, 'invalid_grant', 'that code has expired');
      if (c.stamp !== stamp) return oauthError(res, 'invalid_grant', 'the passkeys changed since this code was made: sign in again');
      if (!personOf(c.person)) return oauthError(res, 'invalid_grant', 'this person is no longer on the hub');
      const verifier = one('code_verifier');
      if (verifier === undefined || !/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return oauthError(res, 'invalid_request', 'code_verifier is missing or malformed');
      if (one('client_id') !== c.client_id || one('redirect_uri') !== c.redirect) return oauthError(res, 'invalid_grant', 'the client or redirect differs from the authorize request');
      if (b64u(crypto.createHash('sha256').update(verifier).digest()) !== c.challenge) return oauthError(res, 'invalid_grant', 'the verifier does not match');
      if (liveCount(c.person) >= LIMITS.liveGrants) return oauthError(res, 'invalid_grant', `${TOO_MANY}: this person has ${LIMITS.liveGrants} computers and apps signed in`);
      const pick = pickResource({ resources: c.resources });
      if (pick.error) return oauthError(res, ...pick.error);
      const g = { id: `g-${b64u(crypto.randomBytes(12))}${(serial++).toString(36)}`, person: c.person, client_id: c.client_id, client_name: c.client_name, label: c.label, scopes: c.scopes, resources: c.resources, stamp, refresh_hash: null, refresh_expires: 0, refresh_spent: [], access: [], created_at: now(), last_used: null, ended: null };
      grants.push(g);
      c.grant = g.id;
      return issue(res, g, pick.r, null);
    }
    if (one('grant_type') === 'refresh_token') {
      const h = hash(one('refresh_token') ?? '');
      const g = grants.find((x) => x.refresh_hash === h);
      if (!g) {
        const reused = grants.find((x) => x.refresh_spent.includes(h));
        if (reused) end(reused, 'refresh reused');
        return oauthError(res, 'invalid_grant', reused ? 'that refresh token was used before: the sign-in has ended' : 'that refresh token is unknown');
      }
      if (!alive(g)) return oauthError(res, 'invalid_grant', 'this sign-in has ended or expired');
      if (one('client_id') !== g.client_id) return oauthError(res, 'invalid_grant', 'another client\'s refresh token');
      const pick = pickResource(g);
      if (pick.error) return oauthError(res, ...pick.error);
      let narrow = null;
      if (one('scope') !== undefined) {
        narrow = one('scope').split(' ');
        if (narrow.some((s) => !g.scopes.includes(s))) return oauthError(res, 'invalid_scope', 'a refresh never widens the sign-in');
        if (!scopesFor(g, pick.r, narrow).length) return oauthError(res, 'invalid_scope', 'nothing in that scope is for the resource named');
      }
      g.refresh_spent = [...g.refresh_spent, g.refresh_hash].slice(-LIMITS.spentKept);
      return issue(res, g, pick.r, narrow);
    }
    return oauthError(res, 'unsupported_grant_type', 'authorization_code or refresh_token');
  }

  async function revokeRoute(req, res) {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json' && type !== 'application/x-www-form-urlencoded') return send(res, 415, 'text/plain', 'a form (RFC 7009) or JSON (the hub)');
    const body = await readBody(req, LIMITS.formBytes);
    if (body === null) return json(res, 413, { error: 'invalid_request', error_description: 'the request is over 16 KB' });
    if (type === 'application/json') {
      const pid = req.headers['x-hub-grant-fake-person'];
      const viewer = personOf(pid);
      if (!viewer || req.headers.origin !== origin) return send(res, 403, 'text/plain', 'only from the hub, signed in');
      let id;
      try { id = JSON.parse(body)?.id; } catch {}
      const g = grants.find((x) => x.id === id && (viewer.role === 'owner' || x.person === viewer.id));
      if (!g) return json(res, 404, { error: 'no such sign-in' });
      end(g, 'revoked');
      return json(res, 200, { ok: true });
    }
    const f = group(parsePairs(body));
    const tok = f.get('token')?.[0];
    if (typeof tok !== 'string') return oauthError(res, 'invalid_request', 'token is required');
    const h = hash(tok);
    const g = grants.find((x) => x.refresh_hash === h || x.refresh_spent.includes(h)) ?? access.get(h)?.grant;
    if (g) end(g, 'revoked');
    return send(res, 200, 'text/plain', '');
  }

  function listRoute(req, res) {
    const viewer = personOf(req.headers['x-hub-grant-fake-person']);
    if (!viewer) return send(res, 401, 'text/plain', 'sign in with your passkey');
    const rows = grants.filter((g) => viewer.role === 'owner' || g.person === viewer.id).map((g) => {
      alive(g);
      const p = personOf(g.person);
      const ended = g.ended ?? (g.stamp !== stamp ? { at: now(), reason: 'passkeys changed' } : null);
      return { id: g.id, person: { id: g.person, name: p?.name ?? null }, client_id: g.client_id, client_name: g.client_name, label: g.label, scopes: g.scopes, resources: g.resources, created_at: g.created_at, last_used: g.last_used, ended };
    }).reverse();
    return json(res, 200, { grants: rows });
  }

  // §8 and §13
  async function mcpRoute(req, res, url) {
    const rm = `${origin}/.well-known/oauth-protected-resource/mcp`;
    const challenge = (status, error, scope = 'mcp') => send(res, status, 'text/plain', '', { 'www-authenticate': status === 403 ? `Bearer error="insufficient_scope", scope="${scope}"` : `Bearer ${error ? `error="${error}", ` : ''}resource_metadata="${rm}", scope="mcp"` });
    const auth = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'authorization') auth.push(req.rawHeaders[i + 1]);
    if (auth.length > 1 || url.searchParams.has('access_token')) return send(res, 400, 'text/plain', 'one Authorization header, and no token in the query');
    if (auth.length && req.headers.cookie) return send(res, 400, 'text/plain', 'a session or a sign-in, never both');
    if (!auth.length) return challenge(401, null);
    const m = /^bearer (\S+)$/i.exec(auth[0]);
    if (!m) return send(res, 400, 'text/plain', 'Authorization: Bearer <token>');
    if (!/^[A-Za-z0-9_-]{43}$/.test(m[1])) return challenge(401, 'invalid_token');
    const a = access.get(hash(m[1]));
    if (!a || a.expires <= now() || !alive(a.grant)) return challenge(401, 'invalid_token');
    if (a.resource !== aud().mcp || !scopesFor(a.grant, a.resource, a.scopes).includes('mcp')) return challenge(403, null);
    if (req.method !== 'POST') return send(res, 405, 'text/plain', 'POST only', { allow: 'POST' });
    touch(a.grant);
    const raw = await readBody(req, LIMITS.mcpBytes);
    if (raw === null) return send(res, 413, 'text/plain', 'over 1 MB');
    let msg;
    try { msg = JSON.parse(raw); } catch { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'not JSON' } }); }
    if (!isObj(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not one JSON-RPC request object' } });
    if (!('id' in msg)) { res.writeHead(202); return res.end(); }
    const ok = (result) => json(res, 200, { jsonrpc: '2.0', id: msg.id, result });
    if (msg.method === 'initialize') {
      const v = msg.params?.protocolVersion;
      return ok({ protocolVersion: MCP_VERSIONS.includes(v) ? v : DEFAULT_PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'devteam', version: opts.version ?? '0.0.0' } });
    }
    if (msg.method === 'tools/list') return ok({ tools: [] });
    if (msg.method === 'ping') return ok({});
    return json(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: MCP_LATER } });
  }

  async function handle(req, res) {
    try {
      const target = req.url;
      const url = new URL(target, origin);
      const p = target.split('?')[0];
      const query = target.includes('?') ? target.slice(target.indexOf('?') + 1) : '';
      if (p === '/.well-known/oauth-authorization-server' && req.method === 'GET') return json(res, 200, asMetadata(origin));
      if (p === '/.well-known/oauth-protected-resource/mcp' && req.method === 'GET') return json(res, 200, prmMcp(origin));
      if (p === '/auth/grant/authorize' && req.method === 'GET') return authorize(req, res, query);
      if (p === '/auth/grant/token' && req.method === 'POST') return await tokenRoute(req, res);
      if (p === '/auth/grant/revoke' && req.method === 'POST') return await revokeRoute(req, res);
      if (p === '/auth/grant/list' && req.method === 'GET') return listRoute(req, res);
      if (p === '/mcp') return await mcpRoute(req, res, url);
      if (opts.serve) return opts.serve(req, res);
      return send(res, 404, 'text/plain', 'not found');
    } catch (e) {
      if (!res.headersSent) send(res, 500, 'text/plain', 'the fake failed');
      else res.destroy();
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = opts.origin ?? `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    url: (path) => `http://127.0.0.1:${server.address().port}${path}`,
    audiences: aud(),
    handle,
    // a copy of the grants record (§14), as the gateway would keep it
    grants: () => JSON.parse(JSON.stringify(grants)),
    // §11: the x-devteam-grant value a request with this access token would carry, or null when the token opens nothing.
    markFor: (tokenValue) => {
      const a = access.get(hash(String(tokenValue)));
      if (!a || a.expires <= now() || !alive(a.grant)) return null;
      const p = personOf(a.grant.person);
      return formatGrantMark({ id: a.grant.id, ownerAct: a.scopes.includes('owner:act') && mayHold(p, 'owner:act'), label: a.grant.label });
    },
    setPeople: (list) => { people = list.map((p) => ({ ...p })); },
    actAs: (id) => { as = id; },
    setStamp: (s) => { stamp = s; },
    setMetadata: (url, answer) => metadata.set(url, answer),
    advance: (ms) => { if (!manual) throw new Error('advance needs clock: manual'); t += ms; },
    now,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
