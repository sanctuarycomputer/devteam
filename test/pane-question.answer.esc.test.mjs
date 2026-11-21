// The owner answers a pane's question from the dashboard's card: Esc, the other answer, and its log
// (split from test/pane-question.answer.test.mjs, kit-223, so each file stays inside CI's watchdog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paneSignature } from '../cloud/gateway.mjs';
import { hasTmux, threadsFixture, until } from './lib/kit.mjs';
import { acts, cleanup, dash, esc, heldFor, menuPane } from './lib/pane-question-fixture.mjs';

// Esc (kit-241): the owner's other answer to a numbered menu that says "Esc to cancel".
const escWhat = (first, digest) => `answered the supervisor's terminal: ${first} with Esc (keys: Escape; question ${digest})`;

test('Esc: only exactly { digest, escape: true, token }, through every wall an option goes through; it sends the Escape key alone and is the owner\'s act', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-esc');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F);
  const D = await dash(later, F, pane);
  const q = await D.question();
  const { digest, token } = q;
  // any other shape, with this question's digest and token: refused, nothing sent
  for (const bad of [{ digest, token, escape: 'Escape' }, { digest, token, escape: 1 }, { digest, token, escape: false }, { digest, token, option: 1, escape: true }, { digest, token, escape: true, keys: 'C-c' }, { digest, token, option: 1, keys: 'C-c' }, { digest, token, key: 'Escape' }, { digest, token, keys: 'Escape' }, { digest, token, escape: true, label: 'Esc' }]) {
    const r = await D.post(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  // not this page, not its token, not this question's token
  assert.equal((await D.post(esc(q), {})).status, 403, 'a plain POST');
  assert.equal((await D.post({ ...esc(q), token: 'f'.repeat(64) })).status, 403, 'not the token');
  assert.equal((await D.post({ ...esc(q), digest: 'a'.repeat(40) })).status, 403, "a token is one question's");
  assert.equal(pane.typed(), '', 'nothing reached the terminal');
  // a stale card: the question changed under it
  pane.press('c');
  await until(() => /0f1e2d3c1/.test(pane.shows()), 'another artifact');
  let r = await D.post(esc(q));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has changed since the page showed it/);
  assert.equal(pane.typed(), 'c', 'and no key was sent');
  // the owner's words meanwhile: held until the menu goes
  F.run(F.old, ['send', 'supervisor', 'held meanwhile', '--owner'], { DEVTEAM_SUPERVISOR: pane.target });
  const q2 = await D.question(q.digest);
  r = await D.post(esc(q2));
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { ok: true, out: 'answered: Esc' });
  await until(() => /held meanwhile[^\r]*\r/.test(pane.typed()), 'the held words, after the Esc');
  assert.match(pane.typed(), /^c\x1b\[devteam /, 'the Escape key alone: no digit, no Enter');
  const [act] = acts(F);
  assert.deepEqual([acts(F).length, act.by, act.channel, act.proof], [1, 'owner', 'dashboard', undefined]);
  assert.equal(act.what, escWhat('"Artifact" (artifact 0f1e2d3c1)', q2.digest));
  assert.equal(F.run(F.old, ['log-check']).status, 0, "the owner's act passes the log's checks");
});

test('an Esc the menu does not clear is reported as an option that may not have landed: logged so, nothing held typed, no second key', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-esc-again');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F, 'menu,menu,input');
  const D = await dash(later, F, pane);
  const q = await D.question();
  F.run(F.old, ['send', 'supervisor', 'held meanwhile', '--owner'], { DEVTEAM_SUPERVISOR: pane.target });
  const r = await D.post(esc(q));
  assert.equal(r.status, 409, await r.clone().text());
  assert.match((await r.json()).error, /may not have landed: the same question still shows after Esc/);
  assert.equal(pane.typed(), '\x1b', 'one Escape, nothing after it');
  assert.equal(acts(F).length, 1);
  assert.match(acts(F)[0].what, /^sent Escape to the supervisor's terminal for "Artifact" \(artifact 0f1e2d3c0\), and it may not have landed: the same question still shows after Esc/);
  assert.equal(heldFor(F, pane).length, 1, 'nothing held was typed after it');
});

test('pane answered --owner takes an Esc only from the owner, only in its own shape', () => {
  const F = threadsFixture('pane-esc-cmd');
  try {
    const digest = 'b'.repeat(40);
    const good = { digest, escape: true, first: 'Artifact', keys: 'Escape', taken: true };
    const run = (body, env = {}) => F.run(F.old, ['pane', 'answered', '--owner'], env, JSON.stringify(body));
    let r = run(good, { DEVTEAM_ROLE: 'worker' });
    assert.notEqual(r.status, 0);
    assert.match(r.err, /don't run in an agent session/);
    r = run(good, { TMUX: '/x/default,1,0', TMUX_PANE: '%9', DEVTEAM_SUPERVISOR: '%9' });
    assert.notEqual(r.status, 0);
    assert.match(r.err, /this is the supervisor's session/);
    for (const bad of [{ ...good, keys: 'Enter' }, { ...good, keys: 'C-c' }, { ...good, label: 'Esc' }, { ...good, option: 1 }, { ...good, escape: 'yes' }, { ...good, keys: '1' }]) {
      r = run(bad);
      assert.notEqual(r.status, 0, JSON.stringify(bad));
      assert.match(r.err, /nothing was recorded/);
    }
    assert.equal(acts(F).length, 0);
    r = run(good);
    assert.equal(r.status, 0, r.err);
    assert.equal(r.out, 'answered: Esc');
    assert.equal(acts(F)[0].what, escWhat('"Artifact"', digest));
    assert.equal(F.run(F.old, ['log-check']).status, 0);
  } finally { F.done(); }
});

test("on a box an Esc needs the gateway's signature for that press, once, and a signed Esc never stands for an option, nor the reverse", { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-esc-box');
  const later = cleanup(t);
  later(() => F.done());
  const pair = crypto.generateKeyPairSync('ed25519');
  const priv = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const pub = path.join(F.base, 'thread-key.pub');
  fs.writeFileSync(pub, pair.publicKey.export({ type: 'spki', format: 'pem' }));
  const box = { DEVTEAM_PUBLIC_URL: 'https://box.example.com', DEVTEAM_GATEWAY_THREAD_KEY: pub };
  const pane = menuPane(F);
  const D = await dash(later, F, pane, box);
  const q = await D.question();
  const body = JSON.stringify(esc(q));
  let r = await D.post(body);
  assert.equal(r.status, 403, 'unsigned');
  assert.match((await r.json()).error, /on a box the owner answers only through the box's gateway/);
  assert.equal(pane.typed(), '');
  // the command, given a real signature for another press than its stdin says
  const proofOf = (b) => { const h = paneSignature(priv, D.port, Buffer.from(b)); return { port: D.port, ts: h['x-devteam-gateway-ts'], nonce: h['x-devteam-gateway-nonce'], sig: h['x-devteam-gateway-sig'], body: Buffer.from(b).toString('base64') }; };
  const cmd = (stdin) => F.run(F.old, ['pane', 'answered', '--owner'], { DEVTEAM_SUPERVISOR: pane.target, ...box }, JSON.stringify(stdin));
  const asOption = { digest: q.digest, option: 1, label: 'Yes', first: 'Artifact', keys: '1', taken: true };
  const asEsc = { digest: q.digest, escape: true, first: 'Artifact', keys: 'Escape', taken: true };
  r = cmd({ ...asOption, proof: proofOf(body) });
  assert.match(r.err, /signed another press/, 'a signed Esc recorded as option 1');
  r = cmd({ ...asEsc, proof: proofOf(JSON.stringify({ digest: q.digest, option: 1, token: q.token })) });
  assert.match(r.err, /signed another press/, 'a signed option 1 recorded as Esc');
  r = cmd({ ...asEsc, proof: proofOf(JSON.stringify({ digest: q.digest, escape: true, token: q.token, keys: 'C-c' })) });
  assert.match(r.err, /signed another press/, 'a signed body the route would refuse');
  assert.equal(acts(F).length, 0);
  // the gateway's, for this press
  const sig = paneSignature(priv, D.port, Buffer.from(body));
  r = await D.post(body, { ...D.own, ...sig });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(pane.typed(), '\x1b');
  const [act] = acts(F);
  assert.deepEqual([acts(F).length, act.by, act.proof.nonce], [1, 'owner', sig['x-devteam-gateway-nonce']]);
  assert.match(act.what, /with Esc \(keys: Escape;/);
  r = await D.post(body, { ...D.own, ...sig });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /signature was used already/);
  assert.equal(F.run(F.old, ['log-check'], box).status, 0);
});

test("log.schema.json says the pane-answer act and its proof hold the option chosen, or Escape", () => {
  const S = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../docs/devteam/schema/log.schema.json'), 'utf8'));
  const descs = [];
  const walk = (o) => { if (o && typeof o === 'object') { if (typeof o.description === 'string' && /pane-answer/.test(o.description)) descs.push(o.description); Object.values(o).forEach(walk); } };
  walk(S);
  const act = descs.find((d) => /The owner writes acts of/.test(d));
  const proof = descs.find((d) => /^On the owner's pane-answer/.test(d));
  assert.ok(act && proof, 'both descriptions');
  for (const d of [act, proof]) assert.match(d, /the option chosen, or Escape/);
  assert.match(act, /clicks an option, or Esc, on the dashboard's card/);
});
