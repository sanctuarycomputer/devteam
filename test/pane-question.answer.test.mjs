// The owner answers a pane's question from the dashboard's card: the route, the key, the box, the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paneSignature } from '../cloud/gateway.mjs';
import { canDrive, openChrome } from './lib/chrome.mjs';
import { freePort, hasTmux, startDashboard, threadsFixture, until } from './lib/kit.mjs';
import { cleanup, heldFor, logLines, menuPane } from './lib/pane-question-fixture.mjs';

const acts = (F) => logLines(F).filter((l) => l.type === 'act' && l.class === 'pane-answer');

// A dashboard for a fixture whose supervisor is that pane; requests as the page's own (a browser
// sends Origin and Sec-Fetch-Site on every fetch POST, and Sec-Fetch-Site on its reads).
async function dash(later, F, pane, env = {}) {
  const port = await freePort();
  const B = `http://127.0.0.1:${port}`;
  const d = startDashboard(F.old, F.env({ DEVTEAM_SUPERVISOR: pane.target, ...env }), ['--port', String(port)]);
  later(() => d.stop());
  await until(() => new RegExp(`dashboard on http://127\\.0\\.0\\.1:${port}\\b`).test(d.out()), 'the dashboard');
  const own = { origin: B, 'sec-fetch-site': 'same-origin' };
  const asked = (headers = { 'sec-fetch-site': 'same-origin' }) => fetch(`${B}/api/threads`, { headers }).then((r) => r.json()).then((j) => j.supervisor.question);
  const post = (body, headers = own) => fetch(`${B}/api/pane-answer`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  // the question now showing, once the dashboard's own look has it (another than `not`)
  const question = (not = null) => until(async () => { const q = await asked(); return q && q.kind === 'menu' && q.digest !== not ? q : null; }, 'the question, from the hello child');
  return { B, port, own, asked, post, question, out: d.out };
}

test("the dashboard: an answer only from its own page, with that page's token for that question, only a digit, only to the question showing", { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-route');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F);
  const D = await dash(later, F, pane);
  const q = await D.question();
  assert.deepEqual([q.options, q.selected, q.hint], [[{ n: 1, label: 'Yes' }, { n: 2, label: 'No' }], 1, 'Esc to cancel']);
  assert.match(q.question, /someone else's artifact/);
  assert.match(q.token, /^[0-9a-f]{64}$/);
  assert.match((await (await fetch(`${D.B}/api/hello`)).json()).pulse.attention[0], /terminal is asking you a question/);
  // the token goes only to the page's own read
  assert.equal((await D.asked({})).token, undefined, 'a plain request sees the question, never the token');
  for (const f of [path.join(F.old, 'docs/devteam/run'), F.logDir]) assert.equal(spawnSync('grep', ['-r', q.token, f]).status, 1, `the token is nowhere under ${f}`);
  const good = { digest: q.digest, option: 2, token: q.token };
  // not this page: a plain request (no Origin, no Sec-Fetch-Site), either one alone, another origin or site, a form
  assert.equal((await D.post(good, {})).status, 403, 'a plain POST, as curl sends it');
  assert.equal((await D.post(good, { origin: D.B })).status, 403, 'Origin alone');
  assert.equal((await D.post(good, { 'sec-fetch-site': 'same-origin' })).status, 403, 'Sec-Fetch-Site alone');
  assert.equal((await D.post(good, { origin: 'http://evil.example', 'sec-fetch-site': 'same-origin' })).status, 403);
  assert.equal((await D.post(good, { origin: D.B, 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await D.post(good, { ...D.own, 'content-type': 'text/plain' })).status, 403);
  // this page's headers, but not its token
  assert.equal((await D.post({ digest: q.digest, option: 2 })).status, 400, 'no token');
  let r = await D.post({ ...good, token: 'f'.repeat(64) });
  assert.equal(r.status, 403, 'not the token');
  assert.match((await r.json()).error, /not this page's card for the question/);
  assert.equal((await D.post({ ...good, digest: 'a'.repeat(40) })).status, 403, "a token is one question's");
  // not an option's number, too big
  for (const bad of [{ ...good, option: 0 }, { ...good, option: 10 }, { ...good, option: '2' }, { ...good, option: 1.5 }, { ...good, digest: 'nope' }]) assert.equal((await D.post(bad)).status, 400, JSON.stringify(bad));
  assert.notEqual(await D.post(JSON.stringify({ ...good, pad: 'x'.repeat(30000) })).then((x) => x.status, () => 'cut off'), 200, 'a body over the cap is not an answer');
  assert.equal(pane.typed(), '', 'nothing reached the terminal');
  // the question changes under the card: the answer to the old one is refused, and says why
  pane.press('c');
  await until(() => /0f1e2d3c1/.test(pane.shows()), 'another artifact');
  r = await D.post(good);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /has changed since the page showed it/);
  assert.equal(pane.typed(), 'c', 'and no key was sent');
  // the owner's words meanwhile, from the page: held
  r = await fetch(`${D.B}/api/thread-new`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Import it', text: 'Approved here' }) });
  assert.equal(r.status, 200);
  assert.match((await r.json()).out, /recorded and held: the supervisor's terminal is asking a question/);
  // the answer, to the question showing now
  const q2 = await D.question(q.digest);
  r = await D.post({ digest: q2.digest, option: 2, token: q2.token });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual(await r.json(), { ok: true, out: 'answered: 2. No' });
  await until(() => /Approved here[^\r]*\r/.test(pane.typed()), 'the held words, after the answer');
  assert.match(pane.typed(), /^c2\[devteam thread \S+ from owner\] Approved here — [^\r]*\r$/, 'the digit alone, then the held line');
  const [act] = acts(F);
  assert.deepEqual([acts(F).length, act.by, act.channel, act.proof], [1, 'owner', 'dashboard', undefined]);
  assert.equal(act.what, `answered the supervisor's terminal: "Artifact" (artifact 0f1e2d3c1) with 2. No (keys: 2; question ${q2.digest})`, "the dialog's first line, the artifact's id and not its link, what was chosen");
  assert.equal(F.run(F.old, ['log-check']).status, 0, "the owner's act passes the log's checks");
  await until(async () => (await D.asked()) === null, 'the question gone from /api/threads');
  r = await D.post({ digest: q2.digest, option: 2, token: q2.token });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /not asking anything now/);
});

test('a menu whose digit only moves the cursor gets the Enter; one that takes no digit, or whose cursor is on it already, is left as it is, and said so; a dialog with no numbers is never answered from here', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-keys');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F, 'menu:move,menu2:deaf,trust,input');
  const D = await dash(later, F, pane);
  const q = await D.question();
  let r = await D.post({ digest: q.digest, option: 2, token: q.token });
  assert.deepEqual([r.status, await r.json()], [200, { ok: true, out: 'answered: 2. No' }]);
  assert.equal(pane.typed(), '2\r');
  assert.match(acts(F)[0].what, /with 2\. No \(keys: 2, Enter;/);
  const q2 = await D.question(q.digest);
  assert.match(q2.question, /rm -rf {2}build/, "the command's own spaces");
  r = await D.post({ digest: q2.digest, option: 2, token: q2.token });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /did not take the key 2 .*answer it in the terminal/);
  assert.equal(pane.typed(), '2\r2', 'no Enter: it would have taken option 1');
  assert.equal(acts(F).length, 1, 'nothing answered, nothing logged');
  // the option the cursor is on already: the digit changes nothing, which looks just like the same
  // question asked again, so no Enter; the owner answers it in the terminal
  r = await D.post({ digest: q2.digest, option: 1, token: q2.token });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /no Enter was sent/);
  assert.equal(pane.typed(), '2\r21');
  assert.match(acts(F)[1].what, /may not have landed/);
  pane.press('Enter');
  // no numbers: shown, with no token, and a token made up for it answers nothing
  const d = await until(async () => { const x = await D.asked(); return x?.kind === 'dialog' ? x : null; }, 'the dialog');
  assert.deepEqual([d.token, d.options], [undefined, undefined]);
  assert.match(d.text, /❯ Yes/);
  assert.equal((await D.post({ digest: d.digest, option: 1, token: 'f'.repeat(64) })).status, 403);
  assert.equal(pane.typed(), '2\r21\r');
});

test("one click is one answer: the same question asked again at once (a retry, two calls in parallel) gets no Enter", { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-again');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F, 'menu,menu,input');
  const D = await dash(later, F, pane);
  const q = await D.question();
  const r = await D.post({ digest: q.digest, option: 1, token: q.token });
  assert.equal(r.status, 409, await r.clone().text());
  assert.match((await r.json()).error, /no Enter was sent/);
  assert.match(acts(F)[0].what, /^sent 1 to the supervisor's terminal .* may not have landed/);
  assert.equal(pane.typed(), '1', 'the digit, and no Enter into the question asked again');
  assert.match(pane.shows(), /❯ 1\. Yes/);
});

// A tmux for one dashboard (on its PATH, ahead of the real one) that holds the first digit it is
// asked to type, between the dashboard's last look at the pane and the key, until the test says go:
// the moment a question can go, made as long as the test needs. Every other call goes straight through.
function tmuxGate(F) {
  const dir = path.join(F.base, `gate-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir);
  const real = spawnSync('sh', ['-c', 'command -v tmux'], { env: F.env(), encoding: 'utf8' }).stdout.trim();
  assert.ok(real, 'a tmux to pass the calls to');
  // waits under 8 s: the dashboard gives a tmux call 10 s; a gate that gives up says so in gave-up
  fs.writeFileSync(path.join(dir, 'tmux'), `#!/bin/sh
keys=0; lit=0
for a in "$@"; do [ "$a" = send-keys ] && keys=1; [ "$a" = -l ] && lit=1; done
if [ $keys = 1 ] && [ $lit = 1 ] && rm "$GATE/armed" 2>/dev/null; then
  : > "$GATE/waiting"
  i=0
  while [ ! -e "$GATE/go" ]; do
    i=$((i + 1)); if [ $i -gt 160 ]; then : > "$GATE/gave-up"; break; fi
    sleep 0.05
  done
fi
exec "$REAL" "$@"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'armed'), '');
  const at = (f) => fs.existsSync(path.join(dir, f));
  return { env: { PATH: `${dir}${path.delimiter}${F.env().PATH}`, GATE: dir, REAL: real }, held: () => at('waiting'), gaveUp: () => at('gave-up'), go: () => fs.writeFileSync(path.join(dir, 'go'), '') };
}

test('a question that goes as the key is sent: the digit in the input box is not an answer; it is logged as one that may not have landed, and nothing held is typed', { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-vanish');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F);
  const gate = tmuxGate(F);
  later(() => gate.go()); // never left holding a call
  const D = await dash(later, F, pane, gate.env);
  const q = await D.question();
  F.run(F.old, ['send', 'supervisor', 'held meanwhile', '--owner'], { DEVTEAM_SUPERVISOR: pane.target });
  const answering = D.post({ digest: q.digest, option: 1, token: q.token });
  // held between its last look and the key
  await until(() => gate.held(), 'the answer at the key');
  // a second click while that one is on its way is refused, not sent after it
  const second = await D.post({ digest: q.digest, option: 2, token: q.token });
  assert.equal(second.status, 409);
  assert.match((await second.json()).error, /another answer is on its way/);
  // someone at the terminal dismisses it before the key
  assert.equal(pane.typed(), '', 'the key is still to come');
  pane.press('Escape');
  await until(() => /\? for shortcuts/.test(pane.shows()), 'the question gone, the input box showing');
  gate.go();
  const r = await answering;
  assert.equal(gate.gaveUp(), false, 'the gate gave up before the test let the key go');
  assert.equal(r.status, 409, await r.clone().text());
  assert.match((await r.json()).error, /may not have landed: the question went as the key was sent, and "1" is now in the terminal's input box/);
  assert.equal(pane.typed(), '\x1b1', 'the digit went into the input box, with no Enter');
  const [act] = acts(F);
  assert.equal(acts(F).length, 1);
  assert.match(act.what, /^sent 1 to the supervisor's terminal for "Artifact" \(artifact 0f1e2d3c0\), option 1\. Yes, and it may not have landed: /);
  assert.equal(heldFor(F, pane).length, 1, 'nothing held was typed after it');
});

test("on a box an answer needs the gateway's signature for that press, once: every agent there can send the dashboard any header", { skip: hasTmux ? false : 'no tmux' }, async (t) => {
  const F = threadsFixture('pane-box');
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
  const body = JSON.stringify({ digest: q.digest, option: 1, token: q.token });
  // the page's own headers and token, as any agent on the box can send them: not enough
  let r = await D.post(body);
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /on a box the owner answers only through the box's gateway/);
  // signed by another key, for another port, for another body
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  for (const [why, sig] of [['another key', paneSignature(other, D.port, Buffer.from(body))], ['another port', paneSignature(priv, D.port + 1, Buffer.from(body))], ['another body', paneSignature(priv, D.port, Buffer.from(body.replace('"option":1', '"option":2')))], ['too old', paneSignature(priv, D.port, Buffer.from(body), Date.now() - 10 * 60000)]]) {
    r = await D.post(body, { ...D.own, ...sig });
    assert.equal(r.status, 403, why);
  }
  assert.equal(pane.typed(), '');
  // the command the dashboard runs after takes nothing without it either
  const rec = F.run(F.old, ['pane', 'answered', '--owner'], { DEVTEAM_SUPERVISOR: pane.target, ...box }, JSON.stringify({ digest: q.digest, option: 1, label: 'Yes', first: 'Artifact', keys: '1', taken: true }));
  assert.notEqual(rec.status, 0);
  assert.match(rec.err, /on a box the owner answers only on the dashboard through the box's gateway/);
  assert.equal(acts(F).length, 0);
  // the gateway's
  const sig = paneSignature(priv, D.port, Buffer.from(body));
  r = await D.post(body, { ...D.own, ...sig });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal(pane.typed(), '1');
  const [act] = acts(F);
  assert.deepEqual([act.by, act.proof.nonce, act.proof.port], ['owner', sig['x-devteam-gateway-nonce'], D.port]);
  // and only once
  r = await D.post(body, { ...D.own, ...sig });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /signature was used already/);
  const again = F.run(F.old, ['pane', 'answered', '--owner'], { DEVTEAM_SUPERVISOR: pane.target, ...box }, JSON.stringify({ digest: q.digest, option: 1, label: 'Yes', first: 'Artifact', keys: '1', taken: true, proof: act.proof }));
  assert.match(again.err, /that press was taken already/);
  assert.equal(F.run(F.old, ['log-check'], box).status, 0);
});

test("the dashboard page: the card at the top of the Inbox and in the dock, the terminal's words as text, at phone width; its buttons wait a second; a click answers; a dialog with no numbers has no buttons", { skip: !hasTmux ? 'no tmux' : canDrive ? false : 'no Chrome to drive' }, async (t) => {
  const F = threadsFixture('pane-page');
  const later = cleanup(t);
  later(() => F.done());
  const pane = menuPane(F, 'menu,trust,input');
  const D = await dash(later, F, pane);
  await D.question();
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  await p.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true });
  await p.send('Page.navigate', { url: `${D.B}/#inbox` });
  const soon = async (expr, what) => until(() => p.ev(expr).catch(() => false), what);
  // drawn with its buttons off, so a card that swaps in under the pointer takes no click: on a second later
  await soon(`!!document.querySelector('#ask-inbox [data-ask-option]')`, 'the card in the Inbox');
  assert.equal(await p.ev(`document.querySelector('#ask-inbox [data-ask-option="1"]').disabled`), true, 'its buttons wait');
  await p.click('#ask-inbox [data-ask-option="1"]');
  await new Promise((w) => setTimeout(w, 300));
  assert.equal(pane.typed(), '', 'a click in that second answers nothing');
  await soon(`!!document.querySelector('#ask-inbox [data-ask-option]:not([disabled])')`, 'its buttons live');
  const card = await p.ev(`(() => { const c = document.querySelector('#ask-inbox .ask'); const r = c.getBoundingClientRect(); return { text: c.innerText, imgs: c.querySelectorAll('img').length, pwned: window.__pwned === 1, left: r.left, right: r.right, vw: innerWidth, page: document.documentElement.scrollWidth, buttons: [...c.querySelectorAll('[data-ask-option]')].map((b) => b.innerText.trim()), first: c.parentElement.previousElementSibling.tagName === 'H2' }; })()`);
  assert.match(card.text, /The supervisor's terminal is asking/);
  assert.match(card.text, /Claude wants to read someone else's artifact at/);
  assert.match(card.text, /<img src=x onerror=window\.__pwned=1>/, "the terminal's words, as text");
  assert.deepEqual([card.imgs, card.pwned], [0, false], 'never markup');
  assert.deepEqual(card.buttons, ['1. Yes', '2. No']);
  assert.ok(card.first, 'above the questions');
  assert.ok(card.left >= 0 && card.right <= card.vw && card.page <= card.vw, `inside a phone's width: ${JSON.stringify(card)}`);
  // in the dock too, where the owner was talking
  assert.match(await p.ev(`document.getElementById('tl-pill').innerText`), /terminal asking/);
  await p.click('#tl-pill');
  await soon(`!!document.querySelector('#ask-dock [data-ask-option]')`, 'the card in the dock');
  await p.click('#tl-pill');
  await p.click('#ask-inbox [data-ask-option="1"]');
  await until(() => pane.typed() === '1', 'the digit in the terminal');
  await soon(`/Sent to the supervisor's terminal: 1\\. Yes/.test(document.getElementById('ask-inbox').innerText) || !!document.querySelector('#ask-inbox [data-ask-kind]')`, 'what was sent');
  assert.equal(acts(F)[0].channel, 'dashboard');
  // what comes next has no numbers: shown as the terminal has it, with nothing to click
  await soon(`!!document.querySelector('#ask-inbox [data-ask-kind="dialog"]')`, 'the dialog with no numbers');
  const d = await p.ev(`(() => { const c = document.querySelector('#ask-inbox .ask'); return { text: c.innerText, buttons: c.querySelectorAll('button').length }; })()`);
  assert.equal(d.buttons, 0);
  assert.match(d.text, /The supervisor's terminal needs you/);
  assert.match(d.text, /❯ Yes/);
  assert.match(d.text, /answer it in the terminal/);
  assert.equal(pane.typed(), '1');
});
