// The terminal (terminal@1): a key post types, every guard on it refuses in order, and a box's proof.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { JSON_TYPE, keysBody, keysTo, nothingTyped, openBody, refusedWith, SAME, screenUntil, shellWindows, termFixture, tokenOf, typedState, W } from './lib/terminal-server-fixture.mjs';

const JT = { 'content-type': 'application/json' };
// The gateway's proof for a terminal POST (§3), as cloud/gateway.mjs signs an owner setting's
const termSig = (priv, domain, port, which, body, { ts = Date.now(), nonce = crypto.randomBytes(24).toString('base64url') } = {}) => {
  const msg = Buffer.from(`${domain}\n${port}\n${which}\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(body).digest('hex')}`);
  return { 'x-devteam-gateway-ts': String(ts), 'x-devteam-gateway-nonce': nonce, 'x-devteam-gateway-sig': crypto.sign(null, msg, crypto.createPrivateKey(priv)).toString('base64url') };
};

test('terminal A4: a supervisor key post types with -H and answers the screen after its change', async () => {
  const T = termFixture('term-a4');
  after(() => T.done());
  const s = T.standIn({ lines: ['A4 stand-in'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  const r = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 1, { data: '6563686f2068690d' }));
  assert.equal(r.status, 200, r.text);
  assert.match(r.headers['content-type'] ?? '', JSON_TYPE);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.json.taken, true);
  assert.equal(r.json.state, 'live');
  assert.equal(r.json.pane, s.pane);
  assert.match(r.json.etag, /^[0-9a-f]{20}$/);
  assert.ok(r.json.lines.includes('echo hi'), `the answer is the screen after the change: ${JSON.stringify(r.json.lines)}`);
  assert.equal(String(await s.received()), 'echo hi\r');
  assert.equal(T.callSpans('send-keys').length, 1, 'one send-keys');
  // application/json with a parameter, in any case, is the type (§3)
  const p = await keysTo(T, port, 'supervisor', keysBody(tok, s.pane, 2, { data: '78' }), { 'content-type': 'Application/JSON; charset=utf-8' });
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json.taken, true);
  assert.equal(String(await s.received()), 'echo hi\rx');
  s.kill();
});

test('terminal A5: every guard on a key post refuses, in terminal@1 §3 order, and nothing is typed', async () => {
  const T = termFixture('term-a5k');
  after(() => T.done());
  const s = T.standIn({ lines: ['A5 stand-in'] });
  const { port } = await T.dashboard();
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  const base = await typedState(T, port, s);
  const origin = `http://127.0.0.1:${port}`;
  const own = { ...SAME, origin, ...JT };
  const good = (more) => JSON.stringify(keysBody(tok, s.pane, 1, more));
  const raw = (p, headers, body) => T.req(port, 'POST', p, { headers, body });
  const big = (n, c = ' ') => c.repeat(n);
  const cases = [
    // step 1: the global guards, then step 3: view, not-loopback, cross-site
    ['another host', { ...own, host: `evil.test:${port}` }, good(), 403, W.page, 'host'],
    ['the relay mark', { ...own, 'x-devteam-relay': '1' }, good(), 403, W.page, 'relay'],
    ['View', { ...own, 'x-devteam-level': 'view' }, good(), 403, W.page, 'view'],
    ['relay before view', { ...own, 'x-devteam-relay': '1', 'x-devteam-level': 'view' }, good(), 403, W.page, 'relay'],
    ['view before cross-site', { ...own, 'sec-fetch-site': 'cross-site', 'x-devteam-level': 'view' }, good(), 403, W.page, 'view'],
    ['no Sec-Fetch-Site', { origin, ...JT }, good(), 403, W.page, 'cross-site'],
    ['a cross-site one', { ...own, 'sec-fetch-site': 'cross-site' }, good(), 403, W.page, 'cross-site'],
    ['a same-site one', { ...own, 'sec-fetch-site': 'same-site' }, good(), 403, W.page, 'cross-site'],
    ['a wrong Origin', { ...own, origin: `http://evil.test:${port}` }, good(), 403, W.page, 'cross-site'],
    ['another loopback name as Origin', { ...own, origin: `http://localhost:${port}` }, good(), 403, W.page, 'cross-site'],
    ['no Origin', { ...SAME, ...JT }, good(), 403, W.page, 'cross-site'],
    // step 3 before 4: cross-site and the wrong type read cross-site
    ['cross-site before the content type', { ...own, 'sec-fetch-site': 'cross-site', 'content-type': 'text/plain' }, good(), 403, W.page, 'cross-site'],
    // step 4: the content type, no why
    ['text/plain', { ...own, 'content-type': 'text/plain' }, good(), 403, W.page],
    ['a form post', { ...own, 'content-type': 'application/x-www-form-urlencoded' }, good(), 403, W.page],
    ['application/json-patch+json', { ...own, 'content-type': 'application/json-patch+json' }, good(), 403, W.page],
    ['no content type', { ...SAME, origin }, good(), 403, W.page],
    ['the content type before the body cap', { ...own, 'content-type': 'text/plain' }, big(102401), 403, W.page],
    // step 5: the body cap; its edge is JSON's business
    ['a body over the cap', own, big(102401), 413, W.big],
    ['a body over the cap before bad JSON', own, big(102401, 'x'), 413, W.big],
    ['a body at the cap, not JSON', own, big(102400, 'x'), 400, W.shape],
    // step 6: JSON, an object
    ['not JSON', own, `{"token":"${tok}",`, 400, W.shape],
    ['null', own, 'null', 400, W.shape],
    ['a string', own, '"x"', 400, W.shape],
    ['an array', own, '[]', 400, W.shape],
    ['a number', own, '7', 400, W.shape],
    // step 7: the token, before the shape
    ['a missing token', own, JSON.stringify({ ...keysBody(tok, s.pane, 1), token: undefined }), 403, W.token],
    ['a wrong token', own, JSON.stringify(keysBody('0'.repeat(64), s.pane, 1)), 403, W.token],
    ['a short token', own, JSON.stringify(keysBody(tok.slice(1), s.pane, 1)), 403, W.token],
    ['a token not a string', own, JSON.stringify(keysBody(7, s.pane, 1)), 403, W.token],
    ['a wrong token before the shape', own, JSON.stringify({ token: '0'.repeat(64), x: 1 }), 403, W.token],
    ['a missing token before the shape', own, JSON.stringify({ x: 1 }), 403, W.token],
    // step 8 before 9: the shape before the caps
    ['data over its cap, with an extra key', own, JSON.stringify({ ...keysBody(tok, s.pane, 1, { data: '61'.repeat(4097) }), x: 1 }), 400, W.shape],
    ['a paste over its cap, with another which', own, JSON.stringify(keysBody(tok, s.pane, 1, { paste: 'a'.repeat(65537) }, 'shell')), 400, W.shape],
    // step 9: the caps, before the pane (step 11)
    ['data of 4097 bytes', own, good({ data: '61'.repeat(4097) }), 413, W.big],
    ['data over its cap, to a stale pane', own, JSON.stringify(keysBody(tok, '%9999', 1, { data: '61'.repeat(4097) })), 413, W.big],
  ];
  for (const [what, headers, body, status, error, why] of cases) {
    refusedWith(await raw('/api/term/supervisor/keys', headers, body), status, error, what, why);
    await nothingTyped(T, port, s, base, what);
  }
  // the same guards on shell/open: refused, and no shell window (S5)
  const ob = JSON.stringify(openBody(tok));
  for (const [what, headers, body, why, error = W.page] of [
    ['no Sec-Fetch-Site', { origin, ...JT }, ob, 'cross-site'],
    ['a wrong Origin', { ...own, origin: `http://evil.test:${port}` }, ob, 'cross-site'],
    ['View', { ...own, 'x-devteam-level': 'view' }, ob, 'view'],
    ['the relay mark', { ...own, 'x-devteam-relay': '1' }, ob, 'relay'],
    ['a wrong token', own, JSON.stringify(openBody('0'.repeat(64))), undefined, W.token],
    ['the content type', { ...own, 'content-type': 'text/plain' }, ob, undefined],
  ]) {
    refusedWith(await raw('/api/term/shell/open', headers, body), 403, error, `shell/open: ${what}`, why);
    assert.equal(shellWindows(T), 0, `shell/open: ${what}: no shell window`);
  }
  await nothingTyped(T, port, s, base, 'after shell/open');
  // a dashboard bound beyond loopback: not-loopback, after view (127.0.0.2, never every interface)
  const wide = await T.dashboard(['--host', '127.0.0.2']);
  const at2 = `http://127.0.0.2:${wide.port}`;
  refusedWith(await T.req(wide.port, 'POST', '/api/term/supervisor/keys', { to: '127.0.0.2', headers: { ...SAME, origin: at2, ...JT }, body: good() }), 403, W.page, 'keys on 127.0.0.2', 'not-loopback');
  refusedWith(await T.req(wide.port, 'POST', '/api/term/supervisor/keys', { to: '127.0.0.2', headers: { ...SAME, origin: at2, ...JT, 'x-devteam-level': 'view' }, body: good() }), 403, W.page, 'view on 127.0.0.2', 'view');
  await nothingTyped(T, port, s, base, 'the wide dashboard');
  // and the guarded post itself, sent right, types
  const ok = await raw('/api/term/supervisor/keys', own, good());
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.taken, true);
  assert.equal(String(await s.received(1)), 'a');
  s.kill();
});

test("terminal A5: on a box a post needs the gateway's proof, bound to its route, which, port and body, each nonce once", async () => {
  const T = termFixture('term-a5-box');
  after(() => T.done());
  const pair = crypto.generateKeyPairSync('ed25519');
  const priv = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = path.join(T.F.base, 'thread-key.pub');
  fs.writeFileSync(pub, pair.publicKey.export({ type: 'spki', format: 'pem' }));
  const s = T.standIn({ lines: ['A5 box stand-in'] });
  const { port } = await T.dashboard([], { DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_GATEWAY_THREAD_KEY: pub });
  await screenUntil(T, port, (j) => j.state === 'live' && j.pane === s.pane, 'live');
  const tok = await tokenOf(T, port);
  const base = await typedState(T, port, s);
  const K = 'devteam-term-keys-v1', O = 'devteam-term-open-v1';
  const body = JSON.stringify(keysBody(tok, s.pane, 1));
  const send = (sig, b = body) => keysTo(T, port, 'supervisor', b, sig);
  const sig = (b = body, o = {}) => termSig(priv, K, port, 'supervisor', b, o);
  const { 'x-devteam-gateway-sig': _, ...noSig } = sig();
  for (const [what, headers, b = body, status = 403, error = W.page] of [
    ['no proof', {}],
    ['a proof without its signature', noSig],
    ['a proof for the other which', termSig(priv, K, port, 'shell', body)],
    ['a proof for the other domain', termSig(priv, O, port, 'supervisor', body)],
    ['a proof for another port', termSig(priv, K, port + 1, 'supervisor', body)],
    ['a proof over a different body', sig(JSON.stringify(keysBody(tok, s.pane, 2)))],
    ['a proof by another key', termSig(other, K, port, 'supervisor', body)],
    ['a proof too old', sig(body, { ts: Date.now() - 10 * 60000 })],
    // the caps before the proof (§3 steps 9, 10), the proof before the pane (10, 11)
    ['data over its cap, no proof', {}, JSON.stringify(keysBody(tok, s.pane, 1, { data: '61'.repeat(4097) })), 413, W.big],
    ['a stale pane, no proof', {}, JSON.stringify(keysBody(tok, '%9999', 1))],
    ['a wrong token, no proof', {}, JSON.stringify(keysBody('0'.repeat(64), s.pane, 1)), 403, W.token],
  ]) {
    refusedWith(await send(headers, b), status, error, what);
    await nothingTyped(T, port, s, base, what);
  }
  // the valid proof types once; its nonce again is refused, before the repeat drop
  const good = sig();
  const r = await send(good);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.taken, true);
  assert.equal(String(await s.received(1)), 'a', 'typed once');
  const after1 = await typedState(T, port, s);
  refusedWith(await send(good), 403, W.page, 'the nonce a second time');
  await nothingTyped(T, port, s, after1, 'the nonce a second time');
  // a fresh proof for the same seq: a repeat, which types nothing
  const again = await send(sig());
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.taken, false);
  await nothingTyped(T, port, s, after1, 'a repeat');
  // shell/open: no proof, and a keys-domain proof, are refused, and no shell window (S5)
  const ob = JSON.stringify(openBody(tok));
  for (const [what, headers] of [['no proof', {}], ['a keys-domain proof', termSig(priv, K, port, 'shell', ob)], ['an open proof for another port', termSig(priv, O, port + 1, 'shell', ob)]]) {
    refusedWith(await T.post(port, '/api/term/shell/open', ob, { ...SAME, ...headers }), 403, W.page, `shell/open: ${what}`);
    assert.equal(shellWindows(T), 0, `shell/open: ${what}: no shell window`);
  }
  await nothingTyped(T, port, s, after1, 'after shell/open');
  s.kill();
});
