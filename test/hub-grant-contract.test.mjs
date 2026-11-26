// hub-grant@1: test/contracts/hub-grant.md, its fixtures (test/fixtures/hub-grant/) and its fake
// (test/lib/hub-grant-fake.mjs), held to one another. The C tests read the document a section at a
// time (from a "## n." heading to the next) for literal phrases; the F tests hold the fixtures to what
// the contract names; the A tests run the fake against every fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  startHubGrantFake, asMetadata, prmMcp, labelProblem, labelFromClientName, parseGrantMark, formatGrantMark,
  pathProblem, routeFor, redirectAllowed, addressAllowed, metadataProblem, NO_DETAILS, TOO_MANY, MCP_LATER, SCOPES,
} from './lib/hub-grant-fake.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = fs.readFileSync(path.join(root, 'test', 'contracts', 'hub-grant.md'), 'utf8');
const FIX = path.join(root, 'test', 'fixtures', 'hub-grant');
const raw = (name) => fs.readFileSync(path.join(FIX, name));
const fx = (name) => JSON.parse(raw(name).toString('utf8'));
const BOX = 'https://box.example.dev';

// §n's text, from its "## n." heading to the next "## ".
function section(n) {
  const start = DOC.search(new RegExp(`^## ${n}\\. `, 'm'));
  assert.ok(start >= 0, `the document has a section ${n}`);
  const rest = DOC.slice(start + 3);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}
const states = (n, phrases) => {
  const s = section(n);
  for (const p of phrases) assert.ok(s.includes(p), `§${n} says ${JSON.stringify(p)}`);
};

// ---------- the document ----------

test('C1: the endpoints and the two audiences', () => {
  assert.match(DOC.split('\n')[0], /^# .*hub-grant@1/, 'the first heading names hub-grant@1');
  states(1, ['Version 1']);
  states(2, ['**`https://<box>/`**', '**`https://<box>/mcp`**', 'exactly one', 'never the terminal\'s host, never a preview\'s host']);
  states(3, ['**`GET /.well-known/oauth-authorization-server`** (RFC 8414)', '`authorization_response_iss_parameter_supported: true`', '`client_id_metadata_document_supported: true`',
    '**`GET /.well-known/oauth-protected-resource/mcp`** (RFC 9728)', '**`GET /auth/grant/authorize`**', '**`POST /auth/grant/token`**', '**`POST /auth/grant/revoke`**', '**`GET /auth/grant/list`**',
    'There is no `registration_endpoint`', '`code_challenge_methods_supported` `["S256"]`',
    '**`POST /auth/grant/consent/options`** and **`POST /auth/grant/consent`**', '**The guards each new route runs**',
    '| `POST /auth/grant/token` | never read | absent, or `https://<box>`; any other is 403 | n/a | ignored |',
    '| §7\'s routes, with `Authorization` | a cookie too is 400 | absent, or the host\'s own origin (`https://<box>` or the project\'s); any other is 403 | by scope (§10), never by the session rule | the token (§8) |']);
  states(4, ['0. **No live session**', 'a signed-out request never makes the box fetch anything', 'A metadata-document client may name only `https://<box>/mcp`', 'A metadata-document client may ask only for `mcp`',
    'Allow needs a fresh assertion: of that challenge, from a passkey of the consent\'s person', 'Nothing in the request can change what the consent record grants', '`threads:write` asked for by a person at level View is left out, never refused']);
});

test('C2: the five scopes, who may hold them, and the exact routes each opens', () => {
  states(7, ['| `hub:read` | read the hub as the person | `https://<box>/` | anyone |', '| `threads:write` |', '| a person at level Full |', '| `mcp` | reach the MCP server as the person | `https://<box>/mcp` | anyone |',
    '| `bridge` |', '| `owner:act` | have its turns count as the owner\'s own words | either | the owner |',
    '| `threads:write` | `POST /api/thread-new` | `<project>.<box>` |', '| `threads:write` | `POST /api/thread-say` | `<project>.<box>` |', '| `threads:write` | `POST /upload` | `<project>.<box>` |',
    '| `mcp` | `POST /mcp` | `<box>` |', '| `hub:read` | `GET /box.json` | `<box>` |',
    'never the hub\'s operator posts', '`owner:act` opens no route in this version. It is only the mark\'s bit', 'No signed press is reachable with a token, whatever its scopes', '`/api/pane-answer`, `/api/owner-setting`']);
  // the route table in the document is the fake's, row for row
  const rows = [...section(7).matchAll(/^\| `([a-z:]+)` \| `(GET|POST) ([^`]+)` \| `(<box>|<project>\.<box>)` \|$/gm)].map((m) => [m[2], m[3], m[4] === '<box>' ? 'box' : 'project', m[1]]);
  assert.equal(rows.length, 9, 'nine routes');
  for (const [method, p, host, scope] of rows) assert.equal(routeFor(method, host, p)?.scope, scope, `${method} ${p} opens ${scope} in the fake`);
});

test('C3: the token lifetimes, the grants record and its stamp', () => {
  states(9, ['An access token lives 1 hour', '30 days from its last use (idle)', 'never past 90 days from the grant (absolute)', 'Every refresh rotates it', '**Reuse ends the grant**', '`refresh reused`', 'never widen it']);
  states(14, ['grants: [{ id, person, client_id, client_name, label, scopes, resources, stamp, refresh_hash, refresh_expires, refresh_spent, access: [{ hash, resource, expires }], created_at, last_used, ended }]',
    '**`stamp`** is the `peopleStamp` the grant was issued under', 'A grant whose stamp isn\'t the current `peopleStamp` is dead', '`people@1` doesn\'t change', 'hashes never included']);
});

test('C4: the x-devteam-grant header form', () => {
  states(11, ['x-devteam-grant: <grant id>;owner-act=<0|1>;label=<percent-encoded>', 'Decoded, it must be valid UTF-8 and meet §5\'s rule', 'Only the gateway sets it, and it is in no signature', 'more than once (counted in `rawHeaders`)']);
  states(8, ['strips any `x-devteam-grant` a client sent', 'On a preview\'s host and the terminal\'s host `Authorization` is never read as a token', 'A WebSocket upgrade carrying `Authorization` on the box\'s host or a project\'s host is refused', 'It strips `Authorization` from every request it forwards from the box\'s host or a project\'s host', 'a `Bearer` value that is one of this gateway\'s tokens (its hash matches an access or refresh hash a grant\'s record holds, §14, live or ended) is never forwarded anywhere', 'every `Authorization` header is checked, the scheme\'s case ignored', 'and on a preview\'s host when the request has a live session; without a session the next paragraph decides', 'a `<label>.<box>` is a preview\'s host when, at that request, it is the name of a preview the gateway serves, and otherwise a project\'s host', 'The label is looked up only after a live session or a good token', 'no answer before a session or a good token tells one label from another', 'the label is looked up once per request, and a request classed a project\'s host is never forwarded to a preview']);
});

test('C5: the role and level checked at each use', () => {
  states(10, ['read at each use', 'never as they were at issue', 'a person moved to View loses `threads:write`', '`owner:act` and `bridge` work only while the grant\'s person is the owner', 'At most 20 live grants per person']);
});

test('C6: the client-metadata fetch rules', () => {
  states(6, ['it happens only for a request with a live session', 'TLS is verified for the URL\'s host name', 'at most 4 fetches at once', 'with or without a port', 'public unicast', 'with no second lookup', '`3fff::/20`', 'no redirects: a `3xx` is a failure', '5 seconds for the whole fetch', 'at most 5 KB (5120 bytes)', '`client_id` equal to the URL exactly', '"couldn\'t read this app\'s details"', '`::ffff:0:0/96` (IPv4-mapped']);
  assert.ok(section(6).includes(NO_DETAILS), 'the fake\'s fixed reason is the document\'s');
});

test('C7: /mcp before the MCP goal', () => {
  states(13, ['`initialize`', '"serverInfo": { "name": "devteam"', '`tools/list`: `{ "tools": [] }`', `\`${MCP_LATER}\``, '-32601', 'The MCP goal puts its server behind exactly this token check']);
  states(8, ['resource_metadata="https://<box>/.well-known/oauth-protected-resource/mcp", scope="mcp"', 'or malformed (not 43 base64url characters): 401']);
});

test('C8: the MCP rule: nothing through mcp decides without owner:act on the same grant', () => {
  states(12, ['**The MCP rule** (binding the MCP goal): nothing reached through the `mcp` scope answers a question, presses an owner button or writes an owner line without `owner:act` on the same grant']);
});

test('C9: the recording rule', () => {
  states(12, ['carries `via: "grant:<grant id>"`, `via_label: "<the decoded label>"` and `owner_act: true|false`',
    '`answer --from-turn`, `goal decide --from-turn`, `thread ask --turn <id> --owner-said` and `correct --from-turn` refuse a turn with `owner_act` false, by its id',
    '`answer --from-chat`, `goal decide --from-chat` and `correct --from-chat` refuse when the quoted words, whitespace collapsed, are contained in any turn with `owner_act` false from the last 7 days']);
});

test('C10: the label rule', () => {
  states(5, ['the authorize parameter `label`', 'It is 1 to 40 bytes of UTF-8, measured decoded: never as encoded in a URL or a header', 'Unicode general categories Cc, Cf, Zl or Zp', 'no `[`, `]`, `;` or `%`',
    'refused at authorize with words, never cut', 'on a character boundary', 'the words `an app`', 'sends the computer\'s hostname by default', 'It neither starts nor ends with a space']);
});

test('C12: owner-act and the MCP rule read the token; a code keeps its stamp; hosts exact; client_id ASCII', () => {
  states(11, ['`owner-act` is `1` exactly when the access token used for the request holds `owner:act`', 'A token narrowed to leave out `owner:act` carries `0`, though its grant holds it']);
  states(12, ['in the scope of the access token that request used']);
  states(9, ['A narrowed `scope` must hold at least one scope of the resource named, else `invalid_scope`', 'a request needing a scope the token dropped is 403 `insufficient_scope`', 'A code whose person is no longer listed is `invalid_grant`']);
  states(14, ['A code and a consent record carry the `peopleStamp` they were made under']);
  states(8, ['Hosts are compared exactly as written, as today']);
  states(6, ['of printable ASCII, with no space or control character']);
  states(4, ['in its ASCII (punycode) form', 'or nothing they asked for is theirs to allow (a View person asking only for `threads:write`)']);
  states(14, ['A code traded under another is `invalid_grant`', 'a consent allowed under another is refused as §4\'s are (400, words) and redirects nowhere']);
  assert.ok(!section(14).includes('or a consent allowed, under another is `invalid_grant`'), '§14 no longer makes a consent under another stamp invalid_grant');
  states(9, ['Narrowing binds that access token only', 'a process that must not rule is given only the access token, never the refresh token']);
  states(10, ['and so do their codes not yet traded: re-adding the person revives neither, and such a code traded later is `invalid_grant`']);
});

test('C11: exact routes, raw paths refused before matching, and /upload\'s Origin rule', () => {
  states(7, ['by exact method and exact path', '**Paths are judged raw, before matching.**', 'a dot segment', '`%2e` or `%2E`', 'an encoded slash (`%2f`, `%2F`)', 'a doubled slash (`//`)',
    'A `threads:write` token passes that route\'s Origin rule for that route alone']);
});

// ---------- the fixtures ----------

const named = (file, names) => {
  const have = fx(file).cases.map((c) => c.name);
  for (const n of names) assert.ok(have.includes(n), `${file} holds the case ${JSON.stringify(n)}`);
};

test('F1: the fixtures hold every valid and hostile case the contract names', () => {
  for (const f of ['as-metadata.json', 'prm-mcp.json', 'labels.json', 'redirects.json', 'metadata.json', 'addresses.json', 'headers.json', 'routes.json', 'paths.json', 'token-requests.json', 'mcp.json', 'grant-list.json']) {
    assert.doesNotThrow(() => fx(f), `${f} is JSON`);
    assert.ok(section(16).includes(`\`${f}\``), `§16 names ${f}`);
  }
  named('metadata.json', ['good', 'client_id mismatch', 'a redirect to loopback not listed', '6 KB']);
  const six = raw('metadata/6kb.json').length;
  assert.ok(six > 5120 && six <= 6144, `the 6 KB document is over 5 KB (${six} bytes)`);
  assert.doesNotThrow(() => JSON.parse(raw('metadata/6kb.json')), 'the 6 KB document is otherwise good JSON');
  named('redirects.json', ['loopback any port for the kit\'s client', 'https listed', 'javascript:', 'a host differing by case']);
  named('headers.json', ['good', 'a second header', 'owner-act=2', 'a bad id']);
  named('token-requests.json', ['no verifier', 'a reused code', 'a widened scope on refresh']);
  named('labels.json', ['good', '41 bytes', 'a newline', 'U+202E, a bidi override', '40 bytes whose percent-encoding is longer than 40', 'a ]', 'missing, for a metadata-document client']);
  const l = fx('labels.json').cases;
  assert.equal(Buffer.byteLength(l.find((c) => c.name === '41 bytes').label), 41);
  const long = l.find((c) => c.name === '40 bytes whose percent-encoding is longer than 40').label;
  assert.ok(Buffer.byteLength(long) === 40 && encodeURIComponent(long).length > 40, 'the long-encoding label is 40 bytes, longer encoded');
  assert.ok(l.find((c) => c.name === 'U+202E, a bidi override').label.includes('‮'));
  assert.ok(l.find((c) => c.name === 'a newline').label.includes('\n'));
});

test('F2: the metadata fixtures are the contract\'s documents for box.example.dev', () => {
  assert.deepEqual(fx('as-metadata.json'), asMetadata(BOX));
  assert.deepEqual(fx('prm-mcp.json'), prmMcp(BOX));
  assert.equal(fx('as-metadata.json').registration_endpoint, undefined);
  assert.deepEqual(fx('as-metadata.json').scopes_supported, SCOPES);
});

// ---------- the fake against every fixture ----------

const tr = fx('token-requests.json');
function req(fake, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(fake.url(p), { method, headers, agent: false }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
    });
    r.on('error', reject);
    r.end(body);
  });
}
const form = (pairs) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const sub = (v, vars) => (typeof v === 'string' && v.startsWith('$') ? (assert.ok(v.slice(1) in vars, `${v} is known`), vars[v.slice(1)]) : v);
function query(spec, vars) {
  let pairs = spec.use === 'kit' ? tr.kit.map((x) => [...x]) : [];
  for (const k of spec.drop ?? []) pairs = pairs.filter(([n]) => n !== k);
  for (const [k, v] of Object.entries(spec.set ?? {})) pairs = pairs.some(([n]) => n === k) ? pairs.map(([n, x]) => [n, n === k ? v : x]) : [...pairs, [k, v]];
  pairs.push(...(spec.add ?? []));
  return form(pairs.map(([k, v]) => [k, sub(v, vars)]));
}
async function authorize(fake, q) {
  const r = await req(fake, 'GET', `/auth/grant/authorize?${q}`);
  return { ...r, location: r.headers.location ? new URL(r.headers.location) : null };
}
async function bearer(fake, tokenValue, { method = 'POST', body, rawBody, extra = {}, scheme = 'Bearer', twice = false, q = '' } = {}) {
  const headers = { 'content-type': 'application/json', ...extra };
  if (tokenValue) headers.authorization = twice ? [`${scheme} ${tokenValue}`, `${scheme} ${tokenValue}`] : `${scheme} ${tokenValue}`;
  return req(fake, method, `/mcp${q}`, { headers, body: method === 'GET' ? undefined : rawBody ?? JSON.stringify(body) });
}
// a subset match: every key of want is in got, deeply
function like(got, want, where) {
  if (want === null || typeof want !== 'object') return assert.deepEqual(got, want, where);
  if (Array.isArray(want)) return assert.deepEqual(got, want, where);
  assert.ok(got && typeof got === 'object', `${where}: an object`);
  for (const [k, v] of Object.entries(want)) like(got[k], v, `${where}.${k}`);
}
const LIST_ROW = ['id', 'person', 'client_id', 'client_name', 'label', 'scopes', 'resources', 'created_at', 'last_used', 'ended'];
function listShape(answer) {
  assert.ok(Array.isArray(answer.grants), 'grants is a list');
  for (const g of answer.grants) {
    assert.deepEqual(Object.keys(g).sort(), [...LIST_ROW].sort(), 'a row has exactly the list\'s fields');
    assert.match(g.id, /^g-[A-Za-z0-9_-]{1,64}$/);
    assert.ok(g.person && typeof g.person.id === 'string' && 'name' in g.person);
    assert.equal(labelProblem(g.label), null, `${g.label} meets the label rule`);
    assert.ok(g.scopes.every((s) => SCOPES.includes(s)));
    assert.ok(g.ended === null || (typeof g.ended.at === 'number' && ['revoked', 'refresh reused', 'code reused', 'person removed', 'passkeys changed', 'expired'].includes(g.ended.reason)));
    assert.ok(!JSON.stringify(g).includes('hash'), 'no hash in a row');
  }
}

async function runSteps(fake, steps, vars) {
  for (const [i, step] of steps.entries()) {
    const at = `step ${i}`;
    if (step.repeat) { for (let n = 0; n < step.repeat; n++) await runSteps(fake, step.steps, vars); continue; }
    if ('advance' in step) { fake.advance(step.advance); continue; }
    if (step.people) { fake.setPeople(step.people); continue; }
    if (step.as) { fake.actAs(step.as); continue; }
    if (step.stamp) { fake.setStamp(step.stamp); continue; }
    if (step.metadata) { const body = raw(step.metadata); fake.setMetadata(JSON.parse(body).client_id, { status: 200, body }); continue; }
    if (step.grants) {
      const g = fake.grants();
      assert.equal(g.length, step.grants.count, `${at}: grants`);
      const text = JSON.stringify(g);
      for (const v of Object.values(vars)) if (typeof v === 'string' && v.length === 43) assert.ok(!text.includes(v), `${at}: the record holds no token, only hashes`);
      continue;
    }
    if (step.list) {
      const r = await req(fake, 'GET', '/auth/grant/list', { headers: { 'x-hub-grant-fake-person': step.list } });
      assert.equal(r.status, 200);
      const answer = JSON.parse(r.text);
      listShape(answer);
      assert.deepEqual(answer.grants.map((g) => g.ended?.reason ?? null).filter(Boolean), step.expect.ended, `${at}: ended reasons`);
      continue;
    }
    if (step.authorize) {
      const r = await authorize(fake, query(step.authorize, vars));
      const e = step.expect;
      if (e.page) {
        assert.equal(r.status, 400, `${at}: an error page`);
        assert.equal(r.location, null, `${at}: never a redirect`);
        if (typeof e.page === 'string') assert.ok(r.text.includes(e.page.replace(/'/g, '&#39;')), `${at}: the page says ${e.page}`);
      } else {
        assert.equal(r.status, 302, `${at}: a redirect (${r.text})`);
        const sp = r.location.searchParams;
        assert.equal(`${r.location.origin}${r.location.pathname}`, sub('$redirect', vars).split('?')[0], `${at}: to the redirect`);
        const w = e.redirect;
        if (w.code) assert.match(sp.get('code') ?? '', /^[A-Za-z0-9_-]{43}$/, `${at}: a code`);
        if (w.error) assert.equal(sp.get('error'), w.error, `${at}: ${sp.get('error_description')}`);
        if (w.error) assert.equal(sp.get('code'), null, `${at}: no code with an error`);
        if (w.state) assert.equal(sp.get('state'), w.state);
        if (w.no_state) assert.equal(sp.get('state'), null, `${at}: a bad state is not sent back`);
        if (w.iss || w.code) assert.equal(sp.get('iss'), fake.origin, `${at}: iss`);
        if (step.save) vars[step.save] = sp.get('code');
      }
      continue;
    }
    if (step.token || step.revoke) {
      const p = step.token ? '/auth/grant/token' : '/auth/grant/revoke';
      const r = await req(fake, 'POST', p, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form((step.token ?? step.revoke).map(([k, v]) => [k, sub(v, vars)])) });
      assert.equal(r.status, step.expect.status, `${at}: ${r.text}`);
      if (step.revoke) continue;
      const j = JSON.parse(r.text);
      assert.equal(r.headers['cache-control'], 'no-store');
      if (r.status === 200) {
        assert.equal(j.token_type, 'Bearer');
        assert.match(j.access_token, /^[A-Za-z0-9_-]{43}$/);
        assert.match(j.refresh_token, /^[A-Za-z0-9_-]{43}$/);
      }
      like(j, Object.fromEntries(Object.entries(step.expect).filter(([k]) => k !== 'status')), at);
      for (const [k, name] of Object.entries(step.save ?? {})) vars[name] = j[k];
      continue;
    }
    if (step.mark) {
      const m = parseGrantMark(['x-devteam-grant', fake.markFor(sub(step.mark, vars))]);
      assert.equal(m.ownerAct, step.expect.ownerAct, `${at}: owner-act`);
      continue;
    }
    if (step.mcp) {
      const r = await bearer(fake, sub(step.mcp.token, vars), { body: step.mcp.body });
      assert.equal(r.status, step.expect.status, `${at}: /mcp`);
      if (step.expect.result) like(JSON.parse(r.text).result, step.expect.result, at);
      continue;
    }
    assert.fail(`${at}: an unknown step ${JSON.stringify(step)}`);
  }
}
const newFake = (extra = {}) => startHubGrantFake({ clock: 'manual', start: Date.UTC(2026, 10, 26), people: tr.people, version: '0.0.0-test', ...extra });
const varsFor = (fake) => ({ verifier: tr.verifier, challenge: tr.challenge, redirect: tr.redirect, root: fake.audiences.root, mcp: fake.audiences.mcp, origin: fake.origin });

test('A1: token-requests.json, each case run against the fake', async (t) => {
  assert.equal(crypto.createHash('sha256').update(tr.verifier).digest('base64url'), tr.challenge, 'the fixture\'s challenge is its verifier\'s S256');
  for (const c of tr.cases) {
    await t.test(c.name, async () => {
      const fake = await newFake();
      try { await runSteps(fake, c.steps, { ...varsFor(fake), ...(c.redirect ? { redirect: c.redirect } : {}) }); } finally { await fake.close(); }
    });
  }
});

test('A2: labels.json, by the rule and at the fake\'s authorize', async (t) => {
  const APP = 'https://app.example.com/oauth/client.json';
  const good = fx('metadata/good.json');
  for (const c of fx('labels.json').cases) {
    await t.test(c.name, async () => {
      const fake = await newFake();
      try {
        const vars = varsFor(fake);
        if (c.label !== null) {
          assert.equal(labelProblem(c.label) === null, c.ok, `labelProblem(${JSON.stringify(c.label)})`);
          const r = await authorize(fake, query({ use: 'kit', set: { label: c.label } }, vars));
          if (c.ok) assert.equal(r.status, 302, 'allowed');
          else { assert.equal(r.status, 400, 'refused on the error page'); assert.equal(r.location, null, 'never redirected'); }
          return;
        }
        assert.equal(labelFromClientName(c.client_name), c.expect);
        const doc = { ...good, client_name: c.client_name ?? undefined };
        fake.setMetadata(APP, { status: 200, body: JSON.stringify(doc) });
        const q = form([['response_type', 'code'], ['client_id', APP], ['redirect_uri', good.redirect_uris[0]], ['code_challenge', tr.challenge], ['code_challenge_method', 'S256'], ['resource', fake.audiences.mcp], ['scope', 'mcp']]);
        const r = await authorize(fake, q);
        assert.equal(r.status, 302, r.text);
        const tok = await req(fake, 'POST', '/auth/grant/token', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form([['grant_type', 'authorization_code'], ['code', r.location.searchParams.get('code')], ['code_verifier', tr.verifier], ['client_id', APP], ['redirect_uri', good.redirect_uris[0]]]) });
        assert.equal(tok.status, 200, tok.text);
        assert.equal(fake.grants()[0].label, c.expect, 'the grant is labelled from client_name');
      } finally { await fake.close(); }
    });
  }
});

test('A3: redirects.json, by the rule and at the fake\'s authorize', async (t) => {
  for (const c of fx('redirects.json').cases) {
    await t.test(c.name, async () => {
      const doc = c.client === 'devteam' ? 'devteam' : fx(c.client);
      assert.equal(redirectAllowed(doc, c.uri), c.ok, `redirectAllowed(${c.uri})`);
      const fake = await newFake();
      try {
        const vars = varsFor(fake);
        if (doc !== 'devteam') fake.setMetadata(doc.client_id, { status: 200, body: JSON.stringify(doc) });
        const set = doc === 'devteam' ? { redirect_uri: c.uri } : { redirect_uri: c.uri, client_id: doc.client_id, scope: 'mcp' };
        const r = await authorize(fake, query({ use: 'kit', set, ...(doc === 'devteam' ? {} : { drop: ['resource', 'label'], add: [['resource', '$mcp']] }) }, vars));
        if (c.ok) { assert.equal(r.status, 302, r.text); assert.equal(r.headers.location.split('?')[0], c.uri.split('?')[0]); }
        else { assert.equal(r.status, 400); assert.equal(r.location, null, 'never redirected'); }
      } finally { await fake.close(); }
    });
  }
});

test('A4: metadata.json, by the fetch rules and at the fake\'s authorize', async (t) => {
  for (const c of fx('metadata.json').cases) {
    await t.test(c.name, async () => {
      const answer = { status: c.answer.status, body: c.answer.file ? raw(c.answer.file) : c.answer.body, ms: c.answer.ms };
      assert.equal(metadataProblem(c.url, answer) === null, c.ok, `metadataProblem: ${metadataProblem(c.url, answer)}`);
      const fake = await newFake();
      try {
        fake.setMetadata(c.url, answer);
        const redirect = c.redirect_uri ?? 'https://app.example.com/oauth/cb';
        const q = form([['response_type', 'code'], ['client_id', c.url], ['redirect_uri', redirect], ['code_challenge', tr.challenge], ['code_challenge_method', 'S256'], ['resource', fake.audiences.mcp], ['scope', 'mcp']]);
        const r = await authorize(fake, q);
        if (c.ok && c.redirect_ok !== false) assert.equal(r.status, 302, r.text);
        else {
          assert.equal(r.status, 400);
          assert.equal(r.location, null, 'never redirected');
          if (!c.ok) {
            assert.ok(r.text.includes(NO_DETAILS.replace(/'/g, '&#39;')), 'the fixed reason');
            if (answer.body && String(answer.body).length > 8) assert.ok(!r.text.includes(String(answer.body).slice(0, 40)), 'never what came back');
          }
        }
      } finally { await fake.close(); }
    });
  }
});

test('A5: addresses.json: only public unicast may be fetched', () => {
  for (const c of fx('addresses.json').cases) assert.equal(addressAllowed(c.ip), c.ok, c.ip);
});

test('A6: headers.json: the grant mark parsed, or refused', () => {
  for (const c of fx('headers.json').cases) {
    const got = parseGrantMark(c.raw);
    if (c.expect === 'refused') assert.ok(got && typeof got.error === 'string', `${c.name}: refused`);
    else if (c.expect === null) assert.equal(got, null, `${c.name}: no mark`);
    else {
      assert.deepEqual(got, c.expect, c.name);
      assert.deepEqual(parseGrantMark(['x-devteam-grant', formatGrantMark(got)]), got, `${c.name}: formats back`);
    }
  }
});

test('A7: routes.json and paths.json: exact method, path and host; raw paths refused first', () => {
  for (const c of fx('routes.json').cases) {
    const got = routeFor(c.method, c.host, c.path);
    if (c.expect === 'refused') assert.ok(got?.refused, `${c.name}: refused before matching`);
    else assert.deepEqual(got, c.expect, c.name);
  }
  for (const c of fx('paths.json').cases) assert.equal(pathProblem(c.path) === null, c.ok, c.path);
});

test('A8: mcp.json, against the fake\'s /mcp', async (t) => {
  const fake = await newFake();
  try {
    const vars = varsFor(fake);
    await runSteps(fake, [
      { authorize: { use: 'kit' }, expect: { redirect: { code: true } }, save: 'c1' },
      { token: [['grant_type', 'authorization_code'], ['code', '$c1'], ['code_verifier', '$verifier'], ['client_id', 'devteam'], ['redirect_uri', '$redirect'], ['resource', '$root']], expect: { status: 200 }, save: { refresh_token: 'r1', access_token: 'root_token' } },
      { token: [['grant_type', 'refresh_token'], ['refresh_token', '$r1'], ['client_id', 'devteam'], ['resource', '$mcp']], expect: { status: 200 }, save: { access_token: 'mcp_token' } },
    ], vars);
    for (const c of fx('mcp.json').cases) {
      await t.test(c.name, async () => {
        const tok = { none: null, bad: 'x'.repeat(43), short: 'x'.repeat(20), root: vars.root_token, mcp: vars.mcp_token }[c.token];
        const r = await bearer(fake, tok, { method: c.method ?? 'POST', body: c.body, rawBody: c.pad ? JSON.stringify({ ...c.body, padding: 'x'.repeat(c.pad) }) : c.raw, scheme: c.scheme, twice: c.twice, extra: c.cookie ? { cookie: c.cookie } : {}, q: (c.query ?? '').replace('$mcp_token', vars.mcp_token) });
        assert.equal(r.status, c.expect.status, r.text);
        for (const s of c.expect.authenticate ?? []) assert.ok((r.headers['www-authenticate'] ?? '').includes(s.replace('$origin', fake.origin)), `WWW-Authenticate holds ${s}`);
        for (const s of c.expect.authenticate_not ?? []) assert.ok(!(r.headers['www-authenticate'] ?? '').includes(s), `WWW-Authenticate holds no ${s}`);
        if (c.expect.json) like(JSON.parse(r.text), c.expect.json, c.name);
        if (c.expect.serverName) assert.equal(JSON.parse(r.text).result.serverInfo.name, c.expect.serverName);
        if (c.expect.empty) assert.equal(r.text, '');
      });
    }
  } finally { await fake.close(); }
});

test('A9: grant-list.json and the fake\'s list have the list\'s shape; the metadata it serves is the contract\'s', async () => {
  listShape(fx('grant-list.json'));
  const fake = await newFake();
  try {
    const vars = varsFor(fake);
    await runSteps(fake, [
      { authorize: { use: 'kit' }, expect: { redirect: { code: true } }, save: 'c1' },
      { token: [['grant_type', 'authorization_code'], ['code', '$c1'], ['code_verifier', '$verifier'], ['client_id', 'devteam'], ['redirect_uri', '$redirect'], ['resource', '$root']], expect: { status: 200 } },
      { as: 'p-sam' },
      { authorize: { use: 'kit' }, expect: { redirect: { code: true } }, save: 'c1' },
      { token: [['grant_type', 'authorization_code'], ['code', '$c1'], ['code_verifier', '$verifier'], ['client_id', 'devteam'], ['redirect_uri', '$redirect'], ['resource', '$root']], expect: { status: 200 } },
    ], vars);
    const owner = JSON.parse((await req(fake, 'GET', '/auth/grant/list', { headers: { 'x-hub-grant-fake-person': 'p-owner' } })).text);
    const sam = JSON.parse((await req(fake, 'GET', '/auth/grant/list', { headers: { 'x-hub-grant-fake-person': 'p-sam' } })).text);
    listShape(owner);
    assert.equal(owner.grants.length, 2, 'the owner sees everyone\'s');
    assert.deepEqual(sam.grants.map((g) => g.person.id), ['p-sam'], 'a member sees their own');
    const other = owner.grants.find((g) => g.person.id === 'p-owner').id;
    const no = await req(fake, 'POST', '/auth/grant/revoke', { headers: { 'content-type': 'application/json', origin: fake.origin, 'x-hub-grant-fake-person': 'p-sam' }, body: JSON.stringify({ id: other }) });
    assert.equal(no.status, 404, 'a member can\'t revoke another\'s grant');
    const yes = await req(fake, 'POST', '/auth/grant/revoke', { headers: { 'content-type': 'application/json', origin: fake.origin, 'x-hub-grant-fake-person': 'p-owner' }, body: JSON.stringify({ id: other }) });
    assert.equal(yes.status, 200);
    assert.deepEqual(JSON.parse((await req(fake, 'GET', '/auth/grant/list', { headers: { 'x-hub-grant-fake-person': 'p-owner' } })).text).grants.find((g) => g.id === other).ended.reason, 'revoked');
    const odd = await req(fake, 'POST', '/auth/grant/revoke', { headers: { 'content-type': 'text/plain' }, body: 'token=x' });
    assert.equal(odd.status, 415, 'revoke is a form or JSON, nothing else');
    assert.deepEqual(JSON.parse((await req(fake, 'GET', '/.well-known/oauth-authorization-server')).text), asMetadata(fake.origin));
    assert.deepEqual(JSON.parse((await req(fake, 'GET', '/.well-known/oauth-protected-resource/mcp')).text), prmMcp(fake.origin));
    assert.ok(TOO_MANY && section(10).includes(TOO_MANY));
  } finally { await fake.close(); }
});
