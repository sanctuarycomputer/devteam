// The live browser view page (docs/devteam/dashboard/browser.html) in real Chrome, against a fake
// socket server that speaks browser@1's view messages: the server replays fixture frames and
// records every message the page sends, each checked against its from_page shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { canDrive } from './lib/chrome.mjs';
import { PAGE, FROM_SERVER, SMALL, BIG, sleep, until, startServer, open, shut, canvasState, drawn, text, noHandBack, ready, pt, sent, mouse, keyEvent, clip, ctrlV, go, viewPageFile } from './lib/browser-view-page-fixture.mjs';

const QID = FROM_SERVER.find((m) => m.t === 'held' && m.qid).qid;

// CI's Node 22 and 24 jobs have Chrome: there the test must run, never skip.
const mustRun = !!process.env.CI && Number(process.versions.node.split('.')[0]) >= 22;
const skip = canDrive ? false : 'needs Chrome and a Node with WebSocket';
viewPageFile();

if (mustRun && !canDrive) test('Chrome is needed on CI\'s Node 22+', () => assert.fail('Chrome is needed on CI\'s Node 22+: this test must run there, not skip'));

// ----- Task 1: the screen and the connection's basics -----------------------------------------
test('the page draws each frame at its size, shows the url, and the held line', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    const c = srv.last();
    assert.equal(await text(p, 'foot'), '', 'no held line before held');
    assert.equal(await p.ev(`document.getElementById('waiting').hidden`), false);
    assert.equal(await text(p, 'waiting'), 'Connecting to the supervisor\'s browser…', 'before the first frame');
    for (const m of FROM_SERVER.filter((m) => m.t !== 'bye')) {
      c.send(m);
      if (m.t === 'frame') await drawn(p, m.w, m.h);
      if (m.t === 'url') await until(async () => (await p.ev(`document.getElementById('addr').value`)) === m.url, `the address bar to show ${m.url}`);
      if (m.t === 'held') {
        const want = m.qid ? 'When you\'re done, press Done on the card.' : 'The supervisor has the browser. You can watch.';
        await until(async () => (await text(p, 'foot')) === want, `the foot line "${want}"`);
      }
    }
    assert.equal(await p.ev(`document.getElementById('addr').value`), 'https://shop.example/account');
  } finally { await shut(p); await srv.close(); }
});

test('the address bar shows the url exactly as sent, masked', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    srv.last().send({ t: 'url', url: 'https://shop.example/account/login?next=•••' });
    await until(async () => (await p.ev(`document.getElementById('addr').value`)) === 'https://shop.example/account/login?next=•••', 'the masked url');
    srv.last().send({ t: 'held', qid: QID });
    await until(async () => (await text(p, 'foot')) === 'When you\'re done, press Done on the card.', 'the held line');
  } finally { await shut(p); await srv.close(); }
});

test('the address bar shows only a masked url: the page holds the contract\'s mask', { skip, timeout: 60000 }, async () => {
  const schema = JSON.parse(fs.readFileSync(new URL('./contracts/browser.schema.json', import.meta.url), 'utf8'));
  const html = fs.readFileSync(PAGE, 'utf8');
  const src = /const MASKED = new RegExp\(String\.raw`(.*)`\);\n/.exec(html);
  assert.ok(src, 'the page has its MASKED pattern');
  assert.equal(src[1], schema['x-masked-url'], 'the page\'s mask is x-masked-url, exactly');
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    const c = srv.last();
    c.send({ t: 'url', url: 'https://shop.example/account' });
    await until(async () => (await p.ev(`document.getElementById('addr').value`)) === 'https://shop.example/account', 'a masked url');
    for (const url of ['https://shop.example/login?code=abc123', 'https://shop.example/a#token=1', 'https://u:p@shop.example/', 'https://shop.example/reset/12345678', 'file:///etc/passwd']) c.send({ t: 'url', url });
    c.send({ t: 'url', url: 'https://shop.example/ok', extra: 1 });
    c.send({ t: 'held', qid: QID }); // a marker: everything before it has been read
    await until(async () => (await text(p, 'foot')) !== '', 'the held line');
    assert.equal(await p.ev(`document.getElementById('addr').value`), 'https://shop.example/account', 'an unmasked url, or one with another field, is never shown');
  } finally { await shut(p); await srv.close(); }
});

test('the page has no Done or hand-back control', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    srv.last().send({ t: 'held', qid: QID });
    srv.last().send(BIG);
    await drawn(p, 320, 200);
    await noHandBack(p);
  } finally { await shut(p); await srv.close(); }
});

test('the canvas fits the window, up and down', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  let p;
  try {
    p = await open(srv, { width: 700, height: 700 });
    await srv.waitConn(1);
    srv.last().send(BIG);
    let s = await drawn(p, 320, 200);
    assert.ok(s.width > 320, `a 320 px frame is scaled up in a 700 px window (shown ${s.width} px)`);
    assert.ok(Math.abs(s.width / s.height - 1.6) < 0.016, 'aspect kept');
    await shut(p);
    p = await open(srv, { width: 1200, height: 500 });
    await srv.waitConn(2);
    srv.last().send(BIG);
    s = await drawn(p, 320, 200);
    assert.ok(s.bottom <= s.vh, `the whole frame is on screen in a wide, short window (bottom ${s.bottom} of ${s.vh})`);
    assert.ok(Math.abs(s.width / s.height - 1.6) < 0.016, 'aspect kept');
    const foot = await p.ev(`document.getElementById('foot').getBoundingClientRect().bottom`);
    assert.ok(foot <= s.vh, 'and the foot line too');
  } finally { if (p) await shut(p); await srv.close(); }
});

test('the page\'s CSP hashes its own script and style, and it loads nothing from elsewhere', { skip, timeout: 60000 }, async () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  const head = /<head>\s*<meta charset="utf-8">\s*<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(head, 'the head opens with the charset, then the CSP');
  const one = (tag) => { const all = [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))]; assert.equal(all.length, 1, `one <${tag}>`); return all[0][1]; };
  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');
  assert.equal(head[1], `default-src 'none'; script-src 'sha256-${sha(one('script'))}'; style-src 'sha256-${sha(one('style'))}'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'`);
  const markup = html.replace(/<script>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, '');
  assert.doesNotMatch(markup, /\s(?:src|href)\s*=/i, 'no src or href attribute');
  assert.doesNotMatch(markup, /<script[^>]*\ssrc|<link\b|<iframe|<object|<embed|<img/i);
  assert.doesNotMatch(markup, /\sstyle\s*=|\son[a-z]+\s*=/i, 'no style attribute and no inline handler (the CSP would refuse them)');
  const srv = await startServer();
  let hits = 0;
  const other = http.createServer((q, s) => { hits++; s.end(''); });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    const at = `http://127.0.0.1:${other.address().port}`;
    await p.ev(`(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => __csp.push(e.effectiveDirective));
      const s = document.createElement('script'); s.src = '${at}/x.js'; document.head.append(s);
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '${at}/x.css'; document.head.append(l); })()`);
    const v = await until(async () => { const v = await p.ev('window.__csp'); return v.length >= 2 && v; }, 'two CSP violations');
    assert.ok(v.some((d) => d.startsWith('script-src')) && v.some((d) => d.startsWith('style-src')), JSON.stringify(v));
    await sleep(300);
    assert.equal(hits, 0, 'the other origin got no request');
    assert.equal(srv.others, 0, 'and the page asked its own server for nothing but itself');
  } finally { await shut(p); other.close(); await srv.close(); }
});

test('the page reconnects by itself after the server closes the socket', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    await until(async () => (await text(p, 'chip')) === 'Live', 'the chip to say Live');
    srv.last().send({ ...BIG, seq: 5 });
    await drawn(p, 320, 200);
    srv.last().close();
    await until(async () => (await text(p, 'chip')) === 'Reconnecting…', 'the chip to say Reconnecting…');
    assert.equal(await p.ev(`document.getElementById('area').classList.contains('down')`), true, 'the last frame dimmed while it is down');
    await srv.waitConn(2, 3000);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live again');
    srv.last().send({ ...SMALL, seq: 0 });
    await drawn(p, 160, 100); // the count starts again on a new socket
    assert.equal(await p.ev(`document.getElementById('area').classList.contains('down')`), false);
  } finally { await shut(p); await srv.close(); }
});

test('the page waits 0.5 s, then doubling up to 5 s, between tries, and 0.5 s again once one opens', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const p = await open(srv);
  try {
    await srv.waitConn(1);
    srv.refuse(true);
    const from = srv.attempts.length;
    const closedAt = Date.now();
    srv.last().close();
    await until(() => srv.attempts.length >= from + 4, 'four refused tries', 12000);
    const at = [closedAt, ...srv.attempts.slice(from, from + 4)];
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    for (const [i, want] of [500, 1000, 2000, 4000].entries()) assert.ok(gaps[i] >= want * 0.8 && gaps[i] <= want * 1.3 + 300, `try ${i + 1} after ~${want} ms (gaps ${gaps})`);
    assert.equal(await text(p, 'chip'), 'Reconnecting…');
    srv.refuse(false);
    await srv.waitConn(2, 9000);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live');
    await sleep(200);
    const t = Date.now();
    srv.last().close();
    await srv.waitConn(3, 3000);
    assert.ok(Date.now() - t < 1400, `after a socket opened, the next try is back to 0.5 s (${Date.now() - t} ms)`);
  } finally { await shut(p); await srv.close(); }
});

test('a page whose first socket never opens still says Connecting…', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  srv.refuse(true);
  const p = await open(srv);
  try {
    await until(() => srv.attempts.length >= 2, 'two refused tries', 5000);
    assert.equal(await text(p, 'chip'), 'Connecting…', 'nothing dropped: it never connected');
    srv.refuse(false);
    await srv.waitConn(1, 6000);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live');
  } finally { await shut(p); await srv.close(); }
});

// ----- Task 4: the connection's edges, and what typing may never reach ---------------------------
test('bye shows its reason in words, closes the socket, and nothing reconnects until Show it again', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  try {
    c.send({ t: 'bye', why: 'The supervisor has the browser again.' });
    await until(async () => !(await p.ev(`document.getElementById('bye').hidden`)), 'the bye panel');
    assert.equal(await text(p, 'bye-why'), 'The supervisor has the browser again.');
    await until(() => !c.open, 'the page to close its socket');
    assert.equal(c.closedByPage, true, 'the page closed it');
    await noHandBack(p);
    assert.equal(await p.ev(`document.getElementById('chip').hidden`), true, 'no Live or Reconnecting… once it has ended');
    await sleep(3000);
    assert.equal(srv.conns.length, 1, 'no new socket by itself');
    await p.click('#again');
    await srv.waitConn(2);
    await until(async () => (await p.ev(`document.getElementById('bye').hidden`)), 'the panel gone');
    await until(async () => !(await p.ev(`document.getElementById('chip').hidden`)) && (await text(p, 'chip')) === 'Live', 'the chip back, Live');
    // why is 1 to 200 characters (code points, as the schema counts them): 200 emoji is a bye, 201 letters isn't
    srv.last().send({ t: 'bye', why: 'x'.repeat(201) });
    await sleep(400);
    assert.equal(await p.ev(`document.getElementById('bye').hidden`), true, 'a why of 201 is no bye');
    srv.last().send({ t: 'bye', why: '' });
    await sleep(400);
    assert.equal(await p.ev(`document.getElementById('bye').hidden`), true, 'nor an empty one');
    srv.last().send({ t: 'bye', why: '😀'.repeat(200) });
    await until(async () => !(await p.ev(`document.getElementById('bye').hidden`)), 'a why of 200 emoji is a bye');
    await p.click('#again');
    await srv.waitConn(3);
    srv.last().send({ t: 'bye', why: '<b>x</b><img src=x>' });
    await until(async () => (await text(p, 'bye-why')) === '<b>x</b><img src=x>', 'the reason, as text');
    assert.equal(await p.ev(`document.querySelectorAll('b, img').length`), 0, 'no element made of it');
  } finally { await shut(p); await srv.close(); }
});

test('a message that isn\'t in the contract is ignored, and frames keep their order', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  try {
    c.send({ ...BIG, seq: 5 });
    await sleep(300);
    for (const m of ['not json', '[1]', 'null', { t: 'nope' }, { ...SMALL, seq: 6, w: 0 }, { ...SMALL, seq: 7, data: '/9j/AAAA' }, { ...SMALL, seq: 8, extra: 1 }, { t: 'held', qid: 'not-a-qid' }, { t: 'bye' }]) c.send(m);
    await sleep(500);
    assert.deepEqual([(await canvasState(p)).w, (await canvasState(p)).h], [320, 200], 'the last good frame stays');
    assert.equal(await p.ev(`document.getElementById('bye').hidden`), true, 'a bye with no why is no bye');
    assert.deepEqual(await p.ev('window.__seen'), [], 'no error');
    c.send({ ...SMALL, seq: 9 });
    await drawn(p, 160, 100);
    c.send({ ...BIG, seq: 4 });
    await sleep(500);
    assert.equal((await canvasState(p)).w, 160, 'an older seq is dropped');
  } finally { await shut(p); await srv.close(); }
});

test('a key or a button held across a reconnect sends no up to the new socket', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c, s } = await ready(srv, { width: 700, height: 700 });
  try {
    await keyEvent(p, 'rawKeyDown', 'Backspace', 'Backspace', { windowsVirtualKeyCode: 8 });
    const a = pt(s, 0.2, 0.2), b = pt(s, 0.6, 0.6);
    await mouse(p, 'mouseMoved', a);
    await mouse(p, 'mousePressed', a, { button: 'left', buttons: 1, clickCount: 1 });
    await mouse(p, 'mouseMoved', b, { button: 'left', buttons: 1 });
    await until(() => c.got.some((m) => m.type === 'down' && m.t === 'mouse') && c.got.some((m) => m.type === 'down' && m.t === 'key'), 'both downs');
    c.close();
    await srv.waitConn(2);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live');
    const c2 = srv.last();
    await mouse(p, 'mouseReleased', b, { button: 'left', buttons: 0, clickCount: 1 });
    await keyEvent(p, 'keyUp', 'Backspace', 'Backspace', { windowsVirtualKeyCode: 8 });
    await sleep(400);
    assert.deepEqual(c2.got.filter((m) => m.type === 'up'), [], 'no up for a down the new socket never saw');
  } finally { await shut(p); await srv.close(); }
});

test('what the owner types goes nowhere else: not queued while down, not logged, stored or in the page', { skip, timeout: 90000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  // While the socket is down the owner types Ю and Я and pastes one text; once it is back they
  // type and paste others. A key goes one character a message, so each is looked for by itself.
  const down = (m) => (m.t === 'key' && /[ЮЯ]/.test(`${m.key}${m.text ?? ''}`)) || (m.t === 'paste' && m.text.includes('down-pasted'));
  try {
    await clip(p, srv, 'down-pasted-Ф');
    srv.refuse(true);
    c.close();
    await until(async () => (await text(p, 'chip')) === 'Reconnecting…', 'Reconnecting…');
    await p.ev(`document.getElementById('screen').focus()`);
    await p.type('ЮЯ');
    await ctrlV(p);
    srv.refuse(false);
    await srv.waitConn(2, 8000);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live');
    // all later input, so a queue flushed ahead of the next message would show
    await clip(p, srv, 'live-pasted-Ц');
    await p.ev(`document.getElementById('screen').focus()`);
    await p.type('kБ');
    await ctrlV(p);
    await mouse(p, 'mouseWheel', pt(await canvasState(p), 0.5, 0.5), { deltaX: 0, deltaY: 40 });
    await until(() => srv.last().got.some((m) => m.t === 'paste' && m.text === 'live-pasted-Ц') && srv.last().got.some((m) => m.t === 'wheel'), 'the later input sent');
    await sleep(500);
    assert.deepEqual(srv.conns.flatMap((k) => k.got.filter(down)), [], 'nothing typed or pasted while down ever reached a socket, after all later input');
    assert.ok(srv.last().got.some((m) => m.t === 'key' && m.text === 'Б'), 'while the later typing did');
    const seen = JSON.stringify(await p.ev('window.__seen'));
    assert.ok(!/pasted|[ЮЯБ]/.test(seen), `nothing logged: ${seen}`);
    assert.deepEqual(await p.ev(`(async () => [localStorage.length, sessionStorage.length, (await indexedDB.databases()).length, document.cookie, window.name])()`), [0, 0, 0, '', '']);
    assert.equal(await p.ev(`/pasted|[ЮЯБ]/.test([document.documentElement.outerHTML, ...[...document.querySelectorAll('input')].map((i) => i.value)].join(' '))`), false, 'nothing in the DOM');
  } finally { await shut(p); await srv.close(); }
});

// Every string the page's own listeners can reach through their closures: a typed character kept in
// a variable, a Set or a Map shows here (ruling m-20261115-034535632-supervisor).
async function pageMemory(p) {
  const strings = [];
  const props = async (objectId) => (await p.send('Runtime.getProperties', { objectId, ownProperties: true }));
  const fns = new Set(); // each function's closure is walked once, by where it is in the source
  const scopes = async (fn, depth) => {
    const internal = (await props(fn.objectId)).internalProperties ?? [];
    const at = internal.find((d) => d.name === '[[FunctionLocation]]')?.value?.value;
    const key = at ? `${at.scriptId}:${at.lineNumber}:${at.columnNumber}` : null;
    if (!key || fns.has(key)) return;
    fns.add(key);
    const list = internal.find((d) => d.name === '[[Scopes]]');
    if (!list?.value?.objectId) return;
    for (const sc of (await props(list.value.objectId)).result ?? []) {
      if (!sc.value?.objectId || /^Global/.test(sc.value.description ?? '')) continue;
      for (const v of (await props(sc.value.objectId)).result ?? []) if (v.value) { if (v.value.type === 'string') strings.push(v.value.value); await walk(v.value, depth + 1); }
    }
  };
  const walk = async (obj, depth) => {
    if (!obj || depth > 6) return;
    if (obj.type === 'string') return void strings.push(obj.value);
    if (obj.type === 'function' && obj.objectId) return scopes(obj, depth);
    if (obj.type !== 'object' || !obj.objectId || obj.subtype === 'node' || obj.subtype === 'null' || obj.className === 'Window') return;
    // an event kept after its handler returned keeps what was typed in its getters
    if (/Event$/.test(obj.className ?? '')) return void strings.push(`a kept ${obj.className}`);
    const r = await props(obj.objectId);
    const members = [];
    for (const d of r.result ?? []) if (d.value) { if (d.value.type === 'string') members.push(d.value.value); await walk(d.value, depth + 1); }
    for (const d of r.internalProperties ?? []) {
      // what a Promise resolved to, or a WeakRef still holds
      if (d.name === '[[PromiseResult]]' || d.name === '[[WeakRefTarget]]') { if (d.value?.type === 'string') members.push(d.value.value); await walk(d.value, depth + 1); continue; }
      if (d.name !== '[[Entries]]' || !d.value?.objectId) continue;
      for (const e of (await props(d.value.objectId)).result ?? []) {
        if (!e.value?.objectId) continue;
        for (const kv of (await props(e.value.objectId)).result ?? []) { if (kv.value?.type === 'string') members.push(kv.value.value); await walk(kv.value, depth + 1); }
      }
    }
    if (members.length) strings.push(members.join(''));
  };
  const { root } = await p.send('DOM.getDocument', { depth: -1 });
  const nodes = [];
  const collect = (n) => { if (n.nodeType === 1 || n.nodeType === 9) nodes.push(n.nodeId); for (const k of n.children ?? []) collect(k); };
  collect(root);
  const targets = [(await p.send('Runtime.evaluate', { expression: 'window', objectGroup: 'walk' })).result.objectId];
  for (const nodeId of nodes) targets.push((await p.send('DOM.resolveNode', { nodeId, objectGroup: 'walk' })).object.objectId);
  const listeners = [];
  for (const objectId of targets) listeners.push(...(await p.send('DOMDebugger.getEventListeners', { objectId })).listeners);
  // the page's own script is the one that listens on the canvas; the test's recorder is another
  const canvasId = (await p.send('DOM.resolveNode', { nodeId: (await p.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#screen' })).nodeId, objectGroup: 'walk' })).object.objectId;
  const pageScript = (await p.send('DOMDebugger.getEventListeners', { objectId: canvasId })).listeners[0].scriptId;
  const own = listeners.filter((l) => l.scriptId === pageScript && l.handler?.objectId);
  assert.ok(own.length >= 10, `the page's listeners are found (${own.length})`);
  for (const l of own) await scopes(l.handler, 0);
  await p.send('Runtime.releaseObjectGroup', { objectGroup: 'walk' });
  return strings;
}

test('nothing typed is kept in page memory after it is sent', { skip, timeout: 120000 }, async () => {
  const srv = await startServer();
  const { p, c: first } = await ready(srv);
  try {
    // typed while the socket is down: dropped, and kept nowhere either
    srv.refuse(true);
    first.close();
    await until(async () => (await text(p, 'chip')) === 'Reconnecting…', 'Reconnecting…');
    await p.ev(`document.getElementById('screen').focus()`);
    await p.type('Ю');
    srv.refuse(false);
    await srv.waitConn(2, 8000);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live');
    const c = srv.last();
    await clip(p, srv, 'pasted-Щ');
    await ctrlV(p);
    await p.ev(`document.getElementById('screen').focus()`);
    await p.type('kЖ'); // last, so no later key can overwrite what a page kept
    await until(() => c.got.some((m) => m.t === 'paste' && m.text === 'pasted-Щ') && c.got.some((m) => m.t === 'key' && m.text === 'Ж'), 'both sent');
    assert.deepEqual((await p.send('Runtime.globalLexicalScopeNames', {})).names, [], 'no top-level let, const or class');
    const strings = await pageMemory(p);
    assert.ok(strings.length > 0, 'the walk read something');
    assert.deepEqual(srv.conns.flatMap((k) => k.got.filter((m) => m.t === 'key' && /Ю/.test(`${m.key}${m.text ?? ''}`))), [], 'the key typed while down reached no socket, after all later input');
    const kept = strings.filter((x) => /[ЖЩЮ]/.test(x) || x.startsWith('a kept '));
    assert.deepEqual(kept, [], 'no marker, and no event, in any variable, closure, Set, Map or array the page\'s listeners reach');
    // nor on the window or any element, as a property of its own
    assert.deepEqual(await p.ev(`[window, ...document.querySelectorAll('*')].flatMap((o) => Object.keys(o).map((k) => {
      try { const v = o[k]; return typeof v === 'string' ? v : v && typeof v === 'object' && !(v instanceof Node) && v !== window ? JSON.stringify(v) : ''; } catch { return ''; }
    })).concat(JSON.stringify(history.state) ?? '', location.hash).filter((v) => /[ЖЩЮ]/.test(v))`), [], 'no marker on the window, an element, history.state or the URL');
  } finally { await shut(p); await srv.close(); }
});

test('nothing on the page is reachable from another origin', { skip, timeout: 60000 }, async () => {
  const html = fs.readFileSync(PAGE, 'utf8');
  for (const word of ['postMessage', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'window.name', 'document.domain', 'history.', 'location.hash']) assert.ok(!html.includes(word), `the page never uses ${word}`);
  const srv = await startServer();
  const framer = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end(`<!doctype html><iframe src="${srv.origin}/"></iframe>`); });
  await new Promise((r) => framer.listen(0, '127.0.0.1', r));
  let p = await open(srv, { url: `${srv.origin}/blank` });
  try {
    const blank = await p.ev('Object.keys(window)');
    await shut(p);
    p = await open(srv);
    await srv.waitConn(1);
    const added = (await p.ev('Object.keys(window)')).filter((k) => !blank.includes(k));
    assert.deepEqual(added, [], 'the page adds no global');
    const win = (await p.send('Runtime.evaluate', { expression: 'window', objectGroup: 'w' })).result.objectId;
    const types = (await p.send('DOMDebugger.getEventListeners', { objectId: win })).listeners.map((l) => l.type);
    assert.ok(!types.includes('message'), `no message listener (${types})`);
    await shut(p);
    p = await open(srv, { url: `http://127.0.0.1:${framer.address().port}/` });
    await srv.waitConn(2);
    assert.equal(await p.ev(`(() => { try { frames[0].document; return 'read'; } catch (e) { return e.name; } })()`), 'SecurityError', 'another origin that frames the page can\'t read it');
  } finally { await shut(p); framer.close(); await srv.close(); }
});

// Ruling on final review F2: Sign out never fails silently. With no open socket the button is
// off; pressed in a race (the socket drops with the confirm open), the page says nothing was done.
test('Sign out of everything is off while there is no socket, and a confirm that races a drop says nothing was signed out', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  const disabled = () => p.ev(`document.getElementById('signout').disabled`);
  try {
    assert.equal(await disabled(), false, 'on while connected');
    srv.refuse(true);
    c.close();
    await until(async () => (await text(p, 'chip')) === 'Reconnecting…', 'Reconnecting…');
    assert.equal(await disabled(), true, 'off while reconnecting');
    srv.refuse(false);
    await srv.waitConn(2, 8000);
    await until(async () => (await disabled()) === false, 'on again once connected');
    await p.click('#signout');
    assert.equal(await p.ev(`document.getElementById('confirm').open`), true);
    srv.refuse(true);
    srv.last().close();
    await until(async () => (await text(p, 'chip')) === 'Reconnecting…', 'the drop, with the confirm still open');
    await p.click('#forget');
    await sleep(300);
    assert.deepEqual(srv.conns.flatMap((k) => k.got.filter((m) => m.t === 'forget')), [], 'no forget anywhere');
    assert.equal(await text(p, 'note'), 'Not connected: nothing was signed out.');
    assert.equal(await p.ev(`document.getElementById('confirm').open`), false);
    srv.refuse(false);
    await srv.waitConn(3, 8000);
    srv.last().send({ t: 'bye', why: 'The supervisor has the browser again.' });
    await until(async () => !(await p.ev(`document.getElementById('bye').hidden`)), 'bye');
    await until(async () => (await disabled()) === true, 'off after bye');
  } finally { await shut(p); await srv.close(); }
});

// Ruling on final review FB4: an address or Back with no socket isn't dropped silently.
test('an address or Back with no socket says it wasn\'t sent', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  const { p, c } = await ready(srv);
  try {
    srv.refuse(true);
    c.close();
    await until(async () => (await text(p, 'chip')) === 'Reconnecting…', 'Reconnecting…');
    await go(p, 'https://shop.example/account');
    assert.equal(await text(p, 'note'), 'Not connected: not sent.');
    await p.ev(`document.getElementById('note').textContent = ''`);
    await p.click('#back');
    assert.equal(await text(p, 'note'), 'Not connected: not sent.', 'Back too');
    srv.refuse(false);
    await srv.waitConn(2, 8000);
    await until(async () => (await text(p, 'chip')) === 'Live', 'Live');
    const got = await sent(srv.last(), () => go(p, 'https://shop.example/account'), 300);
    assert.deepEqual(got, [{ t: 'nav', url: 'https://shop.example/account' }], 'sent once connected');
    assert.equal(await text(p, 'note'), '');
    assert.deepEqual(srv.conns.flatMap((k) => k.got.filter((m) => m.t === 'nav' || m.t === 'back')), [{ t: 'nav', url: 'https://shop.example/account' }], 'nothing from while it was down');
  } finally { await shut(p); await srv.close(); }
});

// ----- a page's dialog, the owner's to answer (kit-770) -----------------------------------------
const ASK = { t: 'dialog', id: 'd-0123456789abcdef', kind: 'confirm', url: 'https://shop.example/pay', text: 'Pay <b id="x">now</b>?' };
const askBox = (p, id) => p.ev(`(() => { const b = document.getElementById('${id}').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
const press = async (p, at) => { for (const type of ['mousePressed', 'mouseReleased']) await mouse(p, type, at, { button: 'left', clickCount: 1 }); };
const askOpen = (p) => p.ev(`document.getElementById('ask').open`);
const armed = (p) => until(() => p.ev(`!document.getElementById('ask-yes').disabled`), 'the answers armed');

test('a page\'s dialog: who asks, its words as text, and each answer names it once', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  let p;
  try {
    let c;
    ({ p, c } = await ready(srv));
    c.send(ASK);
    await until(() => askOpen(p), 'the dialog');
    assert.equal(await text(p, 'ask-said'), ASK.text);
    assert.equal(await p.ev(`document.getElementById('x')`), null, 'never markup');
    assert.match(await text(p, 'ask-from'), /shop\.example/);
    assert.deepEqual([await text(p, 'ask-no'), await text(p, 'ask-yes')], ['Cancel', 'OK']);
    await noHandBack(p);
    const at = await askBox(p, 'ask-yes');
    // just appeared: neither a press nor Enter or Escape answers it
    assert.deepEqual(await sent(c, async () => { await press(p, at); await keyEvent(p, 'keyDown', 'Enter', 'Enter', { text: '\r', windowsVirtualKeyCode: 13 }); await keyEvent(p, 'rawKeyDown', 'Escape', 'Escape', { windowsVirtualKeyCode: 27 }); }, 100), []);
    assert.equal(await askOpen(p), true);
    await armed(p);
    // a double press sends one answer, and its second press reaches nothing under it
    assert.deepEqual(await sent(c, async () => { await press(p, at); await press(p, at); }), [{ t: 'dialog', id: ASK.id, accept: true }]);
    assert.equal(await askOpen(p), true, 'up until the daemon says it ended');
    await armed(p); // a dropped answer can be pressed again
    assert.deepEqual(await sent(c, async () => press(p, at)), [{ t: 'dialog', id: ASK.id, accept: true }]);
    const end = async (id) => { c.send({ t: 'dialog_end', id }); await until(async () => !(await askOpen(p)), `${id} down`); };
    // once it goes, for a second nothing but an up reaches the page in Chrome: press, wheel, move, key, Back
    const quietly = await sent(c, async () => {
      await end(ASK.id);
      await press(p, at);
      await mouse(p, 'mouseWheel', at, { deltaX: 0, deltaY: 50 });
      await p.ev(`document.getElementById('screen').focus()`);
      await keyEvent(p, 'keyDown', 'a', 'KeyA', { text: 'a', windowsVirtualKeyCode: 65 });
      await p.ev(`document.getElementById('back').click()`);
    }, 200, { all: true });
    assert.deepEqual(quietly.filter((m) => m.type !== 'up'), [], 'the quiet second');
    assert.match(await text(p, 'note'), /not sent/, 'Back is said not to be sent');
    c.send({ ...ASK, id: 'd-4444444444444444', frame: true });
    await until(() => askOpen(p), 'a frame\'s');
    assert.match(await text(p, 'ask-from'), /^A frame in the page at shop\.example/);
    // shown again: off for another second
    await armed(p);
    assert.deepEqual(await sent(c, async () => { await p.ev(`document.dispatchEvent(new Event('visibilitychange'))`); await press(p, at); }, 200), [], 'shown again');
    // a browser that closes the modal has it opened again, off for another second
    await armed(p);
    assert.deepEqual(await sent(c, async () => { await p.ev(`document.getElementById('ask').close()`); await until(() => askOpen(p), 'opened again'); await press(p, at); }, 200), [], 'opened again');
    // a key held from before doesn't answer, a fresh one does
    await armed(p);
    await p.ev(`document.getElementById('ask-yes').focus()`);
    assert.deepEqual(await sent(c, () => keyEvent(p, 'keyDown', 'Enter', 'Enter', { text: '\r', windowsVirtualKeyCode: 13, autoRepeat: true }), 200), [], 'a repeating key');
    assert.deepEqual(await sent(c, () => keyEvent(p, 'keyDown', 'Enter', 'Enter', { text: '\r', windowsVirtualKeyCode: 13 }), 200), [{ t: 'dialog', id: 'd-4444444444444444', accept: true }]);
    await end('d-4444444444444444');
    // a prompt: its default, the text typed, Cancel without it
    for (const [id, kind, accept] of [['d-1111111111111111', 'prompt', true], ['d-2222222222222222', 'prompt', false], ['d-3333333333333333', 'beforeunload', true]]) {
      c.send({ ...ASK, id, kind, text: 'Name?', ...(kind === 'prompt' ? { default: 'Sam' } : {}) });
      await until(() => askOpen(p), id);
      await armed(p);
      if (kind === 'prompt') {
        assert.equal(await p.ev(`document.getElementById('ask-text').value`), 'Sam');
        await p.ev(`(() => { const i = document.getElementById('ask-text'); i.focus(); i.select(); })()`);
        await p.send('Input.insertText', { text: 'Ann' });
      }
      const want = { t: 'dialog', id, accept, ...(kind === 'prompt' && accept ? { text: 'Ann' } : {}) };
      if (kind === 'beforeunload') assert.deepEqual([await text(p, 'ask-no'), await text(p, 'ask-yes')], ['Stay', 'Leave']);
      if (kind === 'beforeunload') assert.equal(await text(p, 'ask-from'), 'The page at shop.example asks before leaving. What you entered may be lost.');
      assert.equal(await p.ev(`document.activeElement.id`), kind === 'prompt' ? 'ask-text' : 'ask-from', 'focus on neither answer');
      assert.deepEqual(await sent(c, async () => press(p, await askBox(p, accept ? 'ask-yes' : 'ask-no'))), [want]);
      await end(id);
    }
  } finally { if (p) await shut(p); await srv.close(); }
});

test('a page\'s dialog that swaps under the pointer arms again; one that ends is taken down; a malformed one is not shown', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  let p;
  try {
    let c;
    ({ p, c } = await ready(srv));
    for (const bad of [{ ...ASK, id: 'nope' }, { ...ASK, kind: 'alert' }, { ...ASK, url: 'javascript:1' }, { ...ASK, text: 'x'.repeat(2001) }, { ...ASK, extra: 1 }, { ...ASK, default: 'x' }, { ...ASK, kind: 'constructor' }, { ...ASK, id: [ASK.id] }, { ...ASK, url: 'https://a:99999/' }, { ...ASK, frame: false }]) c.send(bad);
    await sleep(300);
    assert.equal(await askOpen(p), false);
    c.send(ASK);
    await until(() => askOpen(p), 'a good one after them');
    assert.deepEqual(await sent(c, async () => press(p, await askBox(p, 'ask-yes')), 200), [], 'armed as ever after them');
    c.send({ ...ASK, id: 'd-1111111111111111', text: 'second' });
    await until(() => askOpen(p), 'the first');
    await armed(p);
    const at = await askBox(p, 'ask-yes');
    await p.ev(`document.getElementById('ask-yes').focus()`);
    let focus = null;
    const got = await sent(c, async () => { c.send({ t: 'dialog_end', id: ASK.id }); await until(async () => (await text(p, 'ask-said')) === 'second', 'the second'); focus = await p.ev(`document.activeElement.id`); await press(p, at); }, 200);
    assert.equal(focus, 'ask-from', 'the second starts on neither answer');
    assert.deepEqual(got, [], 'the swap is not answered by a press meant for the first');
    // a press begun before the answers armed, and let go after, is no answer
    const early = await sent(c, async () => {
      await p.ev(`dispatchEvent(new Event('resize'))`);
      await mouse(p, 'mousePressed', at, { button: 'left', clickCount: 1 });
      await armed(p);
      await mouse(p, 'mouseReleased', at, { button: 'left', clickCount: 1 });
    }, 200);
    assert.deepEqual(early, [], 'a press begun before they armed');
    c.send({ t: 'dialog_end', id: 'd-1111111111111111' });
    await until(async () => !(await askOpen(p)), 'taken down');
    c.send({ ...ASK, id: 'd-2222222222222222' });
    await until(() => askOpen(p), 'the third');
    c.close();
    await until(async () => !(await askOpen(p)), 'down with its socket');
  } finally { if (p) await shut(p); await srv.close(); }
});

test('a press or key held across a page\'s dialog never reaches Chrome; Sign out still can, and its own question goes when one arrives', { skip, timeout: 60000 }, async () => {
  const srv = await startServer();
  let p;
  try {
    let c;
    ({ p, c } = await ready(srv));
    const at = await askBox(p, 'screen');
    const down = (id) => { c.send({ t: 'dialog_end', id }); return until(async () => !(await askOpen(p)), 'down'); };
    // a press on the canvas, let go well after the dialog has come and gone
    await mouse(p, 'mousePressed', at, { button: 'left', clickCount: 1 });
    const press1 = await sent(c, async () => {
      c.send(ASK);
      await until(() => askOpen(p), 'the dialog');
      await down(ASK.id);
      await sleep(1200);
      await mouse(p, 'mouseReleased', at, { button: 'left', clickCount: 1 });
    }, 300, { all: true });
    assert.deepEqual(press1.filter((m) => m.t === 'mouse' && m.type !== 'move'), [], 'a held press');
    // a drag in progress ends with an up, where it was
    const drag = await sent(c, async () => {
      await mouse(p, 'mousePressed', at, { button: 'left', clickCount: 1 });
      await mouse(p, 'mouseMoved', { x: at.x + 30, y: at.y }, { button: 'left', buttons: 1 });
      c.send({ ...ASK, id: 'd-1111111111111111' });
      await until(() => askOpen(p), 'the dialog');
      await mouse(p, 'mouseReleased', at, { button: 'left', clickCount: 1 });
      await down('d-1111111111111111');
      await sleep(1200);
    }, 300, { all: true });
    assert.deepEqual(drag.filter((m) => m.t === 'mouse' && m.type !== 'move').map((m) => m.type), ['down', 'up'], 'the drag ends');
    // Enter pressed while one was up and still held when it goes: its repeats reach nothing
    const keys = await sent(c, async () => {
      c.send({ ...ASK, id: 'd-2222222222222222' });
      await until(() => askOpen(p), 'the dialog');
      await down('d-2222222222222222');
      await sleep(1200);
      await p.ev(`document.getElementById('screen').focus()`);
      await keyEvent(p, 'keyDown', 'Enter', 'Enter', { text: '\r', windowsVirtualKeyCode: 13, autoRepeat: true });
    }, 300, { all: true });
    assert.deepEqual(keys.filter((m) => m.t === 'key'), [], 'a held key');
    const fresh = await sent(c, () => keyEvent(p, 'keyDown', 'Enter', 'Enter', { text: '\r', windowsVirtualKeyCode: 13 }), 300);
    assert.deepEqual(fresh.map((m) => m.t), ['key'], 'a fresh press');
    // Sign out's question goes when one arrives, and Sign out is sent even in the quiet second
    await p.click('#signout');
    await until(() => p.ev(`document.getElementById('confirm').open`), 'the question');
    c.send({ ...ASK, id: 'd-3333333333333333' });
    await until(() => askOpen(p), 'the dialog');
    assert.equal(await p.ev(`document.getElementById('confirm').open`), false, 'its question is gone');
    const out = await sent(c, async () => {
      await down('d-3333333333333333');
      await p.ev(`document.getElementById('signout').click(); document.getElementById('forget').click()`);
    }, 300, { all: true });
    assert.deepEqual(out.filter((m) => m.t === 'forget'), [{ t: 'forget' }], 'Sign out in the quiet second');
  } finally { if (p) await shut(p); await srv.close(); }
});
