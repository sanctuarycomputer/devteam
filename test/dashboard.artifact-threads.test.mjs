// Threads on artifacts in Chrome: every item says what it is, Shift over an artifact, its pins, the Library's Open.
// Ports: none of its own (lib/kit.mjs's +0 hub, +1..25)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { kit, dashboardOnFreePort, until, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { soonIn, POLL_FAST, landArtifact, VIEWER_MOCK, LIE_CAP, OWN_MESSAGES } from './lib/dashboard-page.mjs';

// An artifact to point at: a button at a known spot on a tall page, and scripts of its own that run
// beside the lens, say they ran, repeat what the viewer sends it, lie about a hit, say Shift is down,
// and try to write. Told by a test (its own messages, which no lens takes), it takes the keyboard,
// says what it is told to as its lens, or answers hits in its lens's place: about somewhere else
// (far), or 5,000 times over (flood). A second page in it, for the page its lens names.
const PIN_MOCK = {
  'artifact.json': JSON.stringify({ v: 1, title: 'Pin mock', summary: 'A button to pin', by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><head><style>body{margin:0;height:3000px}#buy{position:absolute;left:40px;top:120px;width:120px;height:40px}</style></head><body><button id="buy">Buy now</button><script>
parent.postMessage({ own: 'ran' }, '*');
let mode = '';
addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const m = e.data;
  if (m && m.own === 'focus') { window.focus(); document.getElementById('buy').focus(); return void parent.postMessage({ own: 'focused', has: document.hasFocus() }, '*'); }
  if (m && m.own === 'forge') { for (const x of m.say) parent.postMessage(x, '*'); return void parent.postMessage({ own: 'forged', n: m.n }, '*'); }
  if (m && m.own === 'mode') { mode = m.mode; return void parent.postMessage({ own: 'moded', mode }, '*'); }
  parent.postMessage({ own: 'heard', data: m }, '*');
  if (!(m && m.type === 'hit' && mode)) return;
  e.stopImmediatePropagation();
  if (mode === 'far') parent.postMessage({ lens: 1, type: 'hit-reply', id: m.id, anchor: { selector: '#far', tag: 'div', text: 'Far away', rect: { x: 700, y: 700, w: 20, h: 20 } } }, '*');
  if (mode === 'flood') { for (let i = 0; i < 5000; i++) parent.postMessage({ lens: 1, type: 'hit-reply', id: m.id, anchor: { selector: '#buy', tag: 'button', text: String(i), rect: { x: 0, y: 0, w: 2000, h: 2000 } } }, '*'); parent.postMessage({ own: 'flooded', id: m.id }, '*'); }
});
document.getElementById('buy').addEventListener('click', () => parent.postMessage({ own: 'clicked' }, '*'));
parent.postMessage({ lens: 1, type: 'hit-reply', id: 'zz-forged', anchor: { selector: '#forged', text: 'FORGED' }, rect: { x: 0, y: 0, w: 10, h: 10 } }, '*');
setTimeout(() => { parent.postMessage({ lens: 1, type: 'key', key: 'Shift', shift: true }, '*'); parent.postMessage({ own: 'keyed' }, '*'); }, 500);
fetch('/api/thread-new', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'forged', text: 'from the artifact' }) }).then((r) => parent.postMessage({ own: 'wrote', status: r.status }, '*'), () => parent.postMessage({ own: 'wrote', status: 'refused' }, '*'));
</script></body></html>`,
  'more/page.html': '<!doctype html><html><body><p id="more">another page</p></body></html>',
};
// An artifact whose own script answers every hit in its lens's place (its listener, first, keeps the
// question from the lens), with words a page might use to get into the dashboard: markup, and the
// box's capability.
const LIAR_MOCK = {
  'artifact.json': JSON.stringify({ v: 1, title: 'Liar mock', summary: 'A page that lies', by: 'supervisor', for: [] }),
  'index.html': `<!doctype html><html><body style="margin:0"><p style="margin:0;padding:40px">Point here</p><script>
addEventListener('message', (e) => { const m = e.data; if (e.source === parent && m && m.type === 'hit') { e.stopImmediatePropagation(); parent.postMessage({ lens: 1, type: 'hit-reply', id: m.id, anchor: { selector: '#x', tag: 'p', role: 'note', text: 'Pay at ${LIE_CAP} now', name: '<img src=x onerror="window.__pwned=1">', html: '<img src=x onerror="window.__pwned=1">', rect: { x: 0, y: 0, w: 200, h: 120 } } }, '*'); } });
</script></body></html>`,
};

test('every item the dashboard draws says what it is; a question asked in a thread links to it; an answer from a thread says so', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const html = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
  for (const type of ['goal', 'question', 'ticket', 'planner', 'observation', 'problem', 'lesson', 'act', 'preview', 'artifact']) assert.match(html, new RegExp(`subj\\('${type}'`), `the ${type} renderer marks its item`);
  // kit-96: the Decide table's rows (decRows) mark their kind through decSubject
  assert.match(html, /const kind = decSubject\(r\);[\s\S]{0,300}subj\(kind, r\.id/, 'and the Decide table, by kind');
  const F = threadsFixture('threads-items');
  const later = cleanup(t);
  later(() => F.done());
  const T = F.owner(['thread', 'new', 'Narrow this to the EU launch', '--title', 'Launch checkout', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]).split('\n')[0];
  const Q = F.sup(['thread', 'ask', T, '--question', 'Narrow the goal to EU orders?', '--goal', F.goal, '--stake', '2', '--urgency', '1']);
  const Qa = F.sup(['thread', 'ask', T, '--question', 'Keep the US for later?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  const U = F.owner(['thread', 'say', T, 'yes, keep the US for later']).split('\n')[0];
  F.sup(['answer', Qa, 'yes', '--from-turn', U]);
  // an Inbox question settled in a thread: the card quotes the turn and links to its thread
  const Qi = F.sup(['ask', '--question', 'Ship the EU banner?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  F.sup(['thread', 'reply', T, 'From the Inbox: ship the EU banner?', '--refs', `question:${Qi}`]);
  const Ui = F.owner(['thread', 'say', T, 'ship it <b>now</b>']).split('\n')[0];
  F.sup(['answer', Qi, 'yes', '--from-turn', Ui]);
  const O = F.sup(['observe', '--subject', F.goal, '--kind', 'slow-test', '--detail', 'the checkout test is slow']);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#inbox` });
  const soon = soonIn(p, 20000);
  await soon(`!!document.querySelector('#questions [data-subject="question:${Q}"]')`, 'the Inbox card');
  const titleOf = (sel) => p.ev(`document.querySelector(${JSON.stringify(sel)})?.dataset.title ?? null`);
  assert.equal(await titleOf(`#goals-list [data-subject="goal:${F.goal}"]`), 'Launch checkout');
  assert.equal(await titleOf(`#questions [data-subject="question:${Q}"]`), 'Narrow the goal to EU orders?');
  assert.equal(await titleOf(`#answered [data-subject="question:${Qa}"]`), 'Keep the US for later?');
  assert.ok(await titleOf(`#observations [data-subject="observation:${O}"]`));
  assert.equal(await p.ev(`document.querySelector('#questions [data-subject="question:${Q}"]').id`), `q-${Q}`, 'the Inbox copy keeps its id');
  assert.equal(await p.ev(`document.querySelector('#q-${Q}').dataset.qcard`), Q);
  assert.deepEqual(await p.ev(`(() => { const a = document.querySelector('#q-${Q} .from-thread a'); return a && [a.getAttribute('href'), a.textContent]; })()`), [`#talk/${T}`, 'Launch checkout']);
  assert.match(await p.ev(`document.querySelector('#answered [data-subject="question:${Qa}"]').textContent`), /You said: “yes, keep the US for later”[\s\S]*answered in a thread/);
  const card = (id) => `document.querySelector('#answered [data-subject="question:${id}"]')`;
  assert.deepEqual(await p.ev(`(() => { const a = ${card(Qi)}.querySelector('.from-thread a'); return a && [a.getAttribute('href'), a.textContent]; })()`), [`#talk/${T}`, 'Launch checkout'], 'the thread the turn was said in');
  assert.match(await p.ev(`${card(Qi)}.textContent`), /You said: “ship it <b>now<\/b>”[\s\S]*answered in a thread: Launch checkout/);
  assert.equal(await p.ev(`!!${card(Qi)}.querySelector('.muted b')`), false, 'the words escaped');
});

test('Shift over an artifact: the overlay, what the lens says is under the pointer, a thread on that spot', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('stage-pins');
  later(() => F.done());
  landArtifact(F, 'pin-mock', PIN_MOCK);
  landArtifact(F, 'liar-mock', LIAR_MOCK);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  const B = `http://127.0.0.1:${port}`;
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: OWN_MESSAGES });
  await p.send('Page.navigate', { url: `${B}/#artifact/main/pin-mock` });
  const soon = soonIn(p);
  const threads = () => JSON.parse(F.owner(['thread', 'list', '--all', '--json']));
  // the frame's own spot on the page, and a point inside it
  const frameAt = async (x, y) => { const r = await p.ev(`(() => { const r = document.getElementById('av-frame').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`); return { x: r.x + x, y: r.y + y }; };
  // the keyboard back on the dashboard's own page, out of any field and the frame
  const keysHere = () => p.ev(`(() => { document.activeElement?.blur?.(); window.focus(); return document.activeElement === document.body; })()`);
  // a word to the artifact's own script (never its lens's), and its answer
  let said = 0;
  const tell = async (m, answer) => { const n = ++said; await p.ev(`(() => { window.__own = window.__own.filter((x) => x.own !== ${JSON.stringify(answer)}); document.getElementById('av-frame').contentWindow.postMessage(${JSON.stringify({ ...m, n })}, '*'); return true; })()`); return soon(`window.__own.find((x) => x.own === ${JSON.stringify(answer)})`, answer); };
  // the lens given longer than a click's 150 ms where what is checked is its answer, not its speed
  const patient = (ms) => p.ev(`TS.waitMs = ${ms}`);
  await soon(`typeof TS === 'object' && TS.ready`, 'the lens to say ready');

  await t.test("the artifact's own inline script runs beside the lens; the page is the one its lens names", async () => {
    await soon(`window.__own.some((m) => m.own === 'ran')`, 'its own script');
    assert.equal(await p.ev(`[TS.kind, TS.slug, TS.at, TS.path].join()`), 'artifact,pin-mock,main,index.html');
  });

  await t.test("the artifact's own made-up Shift, with the keyboard on the dashboard, raises nothing", async () => {
    await soon(`window.__own.some((m) => m.own === 'keyed')`, 'its made-up key');
    assert.notEqual(await p.ev(`document.activeElement === document.getElementById('av-frame')`), true, 'the frame never had the keyboard');
    assert.deepEqual(await p.ev(`[document.getElementById('av-over').hidden, TS.raised]`), [true, false]);
    // and its made-up reply, said before it, to an id the page never minted, was kept nowhere
    assert.equal(await p.ev('TS.hit'), null, 'no hit from a reply nobody asked for');
  });

  await t.test('Shift raises the overlay; over the button the lens names it, and the layer outlines it', async () => {
    const at = await frameAt(100, 140);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.move(at.x, at.y, 8);
    await soon(`document.getElementById('tl-chip').textContent === 'button "Buy now"' && !document.getElementById('tl-hl').hidden`, 'the chip and the outline');
    const hl = await p.ev(`(() => { const a = document.getElementById('tl-hl').getBoundingClientRect(), f = document.getElementById('av-frame').getBoundingClientRect(); return [Math.round(a.left - f.left), Math.round(a.top - f.top)]; })()`);
    assert.deepEqual(hl, [37, 117], 'around the button, in the frame');
    await p.hold('Shift', false);
    await soon(`document.getElementById('av-over').hidden && document.getElementById('tl-cursor').hidden`, 'Shift up: lowered');
  });

  await t.test('with the keyboard in the frame, its lens tells Shift, and that raises the overlay', async () => {
    // a real click on the page in the frame gives it the keyboard
    const blank = await frameAt(600, 500);
    await p.clickAt(blank.x, blank.y);
    await soon(`document.activeElement === document.getElementById('av-frame')`, 'the frame has the keyboard');
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden && TS.raised`, 'raised by what the lens said');
    await p.hold('Shift', false);
    // the lens's "Shift up" lowers nothing (a page can say it too): the pointer moving without it does
    await p.move(blank.x + 5, blank.y + 5);
    await soon(`document.getElementById('av-over').hidden && !TS.raised`, 'lowered by the pointer, Shift up');
    await keysHere();
  });

  await t.test('a page with the keyboard can say Shift is down: that lasts until the pointer moves, and pins nothing', async () => {
    const f = await tell({ own: 'focus' }, 'focused');
    // a page can't always take the keyboard by itself: a click on it gives it
    if (!f.has || !(await p.ev(`document.activeElement === document.getElementById('av-frame')`))) { const b = await frameAt(600, 500); await p.clickAt(b.x, b.y); }
    await soon(`document.activeElement === document.getElementById('av-frame')`, 'the frame has the keyboard');
    const raise = { own: 'forge', say: [{ lens: 1, type: 'key', key: 'Shift', shift: true }] };
    await tell(raise, 'forged');
    await soon('TS.raised', 'its say-so, believed while it has the keyboard');
    const at = await frameAt(100, 140);
    await p.move(at.x, at.y);
    await soon(`document.getElementById('av-over').hidden && !TS.raised`, 'gone once the pointer moves without Shift');
    // raised again, then a click without Shift: no thread, and the overlay goes
    await tell(raise, 'forged');
    await soon('TS.raised', 'raised again');
    await p.clickAt(at.x, at.y);
    await soon(`document.getElementById('av-over').hidden`, 'gone at a click without Shift');
    assert.equal(await p.ev('TL.draft'), null, 'nothing about to start');
    await p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    assert.equal(await p.ev('TL.draft'), null, 'nor a frame later');
    await keysHere();
  });

  await t.test('raised by a page, the overlay goes when the pointer moves anywhere without Shift, off the stage too', async () => {
    const blank = await frameAt(600, 500);
    await p.clickAt(blank.x, blank.y);
    await soon(`document.activeElement === document.getElementById('av-frame')`, 'the frame has the keyboard');
    // the pointer off the stage first: from here it moves on the dashboard around it, never over the overlay
    await p.move(5, 5);
    await tell({ own: 'forge', say: [{ lens: 1, type: 'key', key: 'Shift', shift: true }] }, 'forged');
    await soon('TS.raised', 'its say-so, believed while it has the keyboard');
    await p.move(12, 12);
    await soon(`document.getElementById('av-over').hidden && !TS.raised`, 'gone, though the pointer never crossed the overlay');
    await keysHere();
  });

  await t.test("a page's \"Shift up\" or Esc while the owner holds Shift lowers nothing: the click is a pin, never the page's", async () => {
    await patient(2000);
    const blank = await frameAt(600, 500);
    await p.clickAt(blank.x, blank.y);
    await soon(`document.activeElement === document.getElementById('av-frame')`, 'the frame has the keyboard');
    await p.hold('Shift', true);
    await soon('TS.raised', 'raised: the owner holds Shift');
    await tell({ own: 'forge', say: [{ lens: 1, type: 'key', key: 'Shift', shift: false }, { lens: 1, type: 'key', key: 'Escape', shift: false }] }, 'forged');
    assert.deepEqual(await p.ev(`[TS.raised, document.getElementById('av-over').hidden]`), [true, false], 'still up');
    await p.ev(`window.__own = window.__own.filter((x) => x.own !== 'clicked'); true`);
    const at = await frameAt(100, 140);
    await p.move(at.x, at.y, 8);
    await soon(`TS.hit?.anchor?.selector === '#buy'`, 'the lens\'s answer for the hover');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.anchor?.selector === '#buy'`, 'a pin on the button');
    assert.equal(await p.ev(`window.__own.some((x) => x.own === 'clicked')`), false, 'the button never saw the click');
    await p.ev('tlClose()');
    await patient(150);
    await keysHere();
  });

  await t.test('a Shift+click starts a thread on the button: its anchor, where it was clicked, the page and its fingerprint', async () => {
    await patient(2000);
    const at = await frameAt(100, 140);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.move(at.x, at.y, 8);
    await soon(`TS.hit?.anchor?.selector === '#buy'`, 'the lens\'s answer for the hover');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.kind === 'artifact'`, 'a thread about to start');
    const s = await p.ev('TL.draft.subject');
    const fp = JSON.parse(F.owner(['artifacts', '--json'])).find((a) => a.slug === 'pin-mock' && a.at === 'main').fp;
    assert.deepEqual([s.slug, s.at, s.path, s.fp, s.anchor.selector, s.anchor.tag, s.anchor.text, s.anchor.point.x, s.anchor.point.y, s.point], ['pin-mock', 'main', 'index.html', fp, '#buy', 'button', 'Buy now', 60, 20, { x: 100, y: 140 }]);
    assert.equal(await p.ev('TL.draft.title'), 'button "Buy now"');
    await p.type('Make it green');
    await p.key('Enter', 8);
    const th = await until(() => threads().find((x) => x.subject?.kind === 'artifact'), 'the thread');
    assert.deepEqual([th.title, th.subject.anchor.selector, th.turns[0].text], ['button "Buy now"', '#buy', 'Make it green']);
    await p.ev('tlClose()');
    await patient(150);
    await keysHere();
  });

  await t.test('a click on the page with no answer from a lens in time starts a thread on the point alone', async () => {
    await p.ev(`TS.target = 'http://nowhere.invalid'`); // nothing the lens can hear: no reply comes
    const at = await frameAt(500, 400);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.point?.x === 500`, 'the point');
    assert.equal(await p.ev('JSON.stringify(TL.draft.subject.anchor)'), undefined);
    assert.equal(await p.ev('TL.draft.title'), 'pin-mock · /index.html');
    await p.ev(`TS.target = '*'`);
    await p.key('Escape');
    await keysHere();
  });

  await t.test('a click still waiting on its answer when the page changes starts nothing', async () => {
    await patient(10000);
    await p.ev(`TS.target = 'http://nowhere.invalid'`);
    const at = await frameAt(100, 140);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon('TS.waiters.size === 1', 'the click, waiting on the lens');
    await p.ev(`(() => { TS.target = '*'; document.getElementById('av-frame').src = '/artifact/main/pin-mock/more/page.html'; return true; })()`);
    await soon(`TS.ready && TS.path === 'more/page.html' && TS.waiters.size === 0`, 'the next page, and the question let go of');
    await p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    assert.equal(await p.ev('TL.draft'), null, 'no thread about to start, on either page');
    await p.ev(`document.getElementById('av-frame').src = '/artifact/main/pin-mock/'; true`);
    await soon(`TS.ready && TS.path === 'index.html'`, 'back on the index');
    await patient(150);
    await keysHere();
  });

  await t.test("an answer about somewhere else isn't believed: the point alone", async () => {
    await patient(2000);
    await tell({ own: 'mode', mode: 'far' }, 'moded');
    const at = await frameAt(100, 140);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.move(at.x, at.y, 8);
    await soon(`TS.hit && TS.hit.anchor === null`, 'its answer, dropped to the point');
    await soon(`document.getElementById('tl-chip').textContent === 'pin-mock · /index.html'`, 'the chip names the page');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.point?.x === 100`, 'the point');
    assert.deepEqual(await p.ev(`[TL.draft.subject.anchor ?? null, TL.draft.subject.point]`), [null, { x: 100, y: 140 }]);
    await p.key('Escape');
    await tell({ own: 'mode', mode: '' }, 'moded');
    await patient(150);
    await keysHere();
  });

  await t.test('a question answered 5,000 times is answered once, and the page keeps up', async () => {
    await tell({ own: 'mode', mode: 'flood' }, 'moded');
    const at = await frameAt(100, 140);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.move(at.x, at.y, 8);
    const { id } = await soon(`window.__own.find((x) => x.own === 'flooded')`, 'the flood');
    assert.deepEqual(await p.ev(`[TS.hit?.anchor?.text, TS.minted.has(${JSON.stringify(id)})]`), ['0', false], 'its first answer, and the question let go of');
    const frame = await p.ev('new Promise((r) => { const t = performance.now(); requestAnimationFrame(() => r(performance.now() - t)); })');
    assert.ok(frame < 1000, `a frame drawn in ${frame} ms`);
    await p.hold('Shift', false);
    await tell({ own: 'mode', mode: '' }, 'moded');
    await keysHere();
  });

  await t.test("what the artifact says can't start, write or answer anything, and nothing sent to it carries the owner's words", async () => {
    await soon(`window.__own.some((m) => m.own === 'wrote')`, 'its try at writing');
    assert.equal(await p.ev(`window.__own.find((m) => m.own === 'wrote').status`), 'refused', 'its own fetch to an owner route never left the sandbox');
    assert.equal(threads().filter((x) => x.title === 'forged').length, 0);
    assert.equal(await p.ev(`TS.hit?.anchor?.text === 'FORGED'`), false, 'a hit-reply to an id the page never minted is dropped');
    const heard = await p.ev(`window.__own.filter((m) => m.own === 'heard').map((m) => m.data)`);
    assert.ok(heard.some((m) => m.type === 'hello'), 'it heard hello');
    assert.ok(heard.some((m) => m.type === 'hit'), 'it heard the hits');
    // every question's id is a string the page minted, and nothing of the owner's words is in any
    assert.deepEqual(heard.filter((m) => m.id !== undefined && !(typeof m.id === 'string' && /^[hr]\d+$/.test(m.id))), [], 'string ids only');
    assert.deepEqual([...new Set(heard.map((m) => m.type))].filter((k) => !['hello', 'hit', 'resolve', 'scroll-by'].includes(k)), [], 'only questions');
    assert.ok(heard.every((m) => !JSON.stringify(m).includes('Make it green')), 'never the owner\'s words');
  });

  await t.test('a page further in the artifact: its lens names it, and a thread there is on that page', async () => {
    await patient(2000);
    await p.ev(`document.getElementById('av-frame').src = '/artifact/main/pin-mock/more/page.html'; true`);
    await soon(`TS.ready && TS.path === 'more/page.html'`, 'ready, from the page its lens names');
    const at = await frameAt(20, 20);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.move(at.x, at.y, 8);
    await soon(`TS.hit?.anchor?.selector === '#more'`, 'its lens\'s answer');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.path === 'more/page.html'`, 'a thread on that page');
    await p.key('Escape');
    await patient(150);
    await keysHere();
  });

  await t.test("a page's lies about what is there are its words: shown as text, cut of the box's capability, and never markup", async () => {
    await p.ev(`location.hash = '#artifact/main/liar-mock'`);
    await soon(`TS.slug === 'liar-mock' && TS.ready`, 'the liar on the stage');
    await patient(2000);
    const at = await frameAt(60, 60);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.move(at.x, at.y, 8);
    await soon(`TS.hit?.anchor?.role === 'note'`, 'its answer');
    // the chip is drawn on the next animation frame after the answer is taken
    const chip = 'note "<img src=x onerror="window.__pwned=1">"';
    await soon(`document.getElementById('tl-chip').textContent === ${JSON.stringify(chip)}`, 'the chip, drawn');
    assert.equal(await p.ev(`document.getElementById('tl-chip').textContent`), chip, 'the chip shows its words as text');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.slug === 'liar-mock'`, 'a thread about to start');
    const s = await p.ev('TL.draft.subject');
    assert.equal(s.anchor.text, 'Pay at [link removed] now');
    assert.doesNotMatch(JSON.stringify(s), /1767225600000/, 'no capability in the subject');
    await p.ev(`document.querySelector('#tl-card details')?.setAttribute('open', ''); true`);
    assert.deepEqual(await p.ev(`[document.querySelectorAll('#tl img').length, window.__pwned ?? null]`), [0, null], 'its markup never became the page\'s');
    await p.type('Who wrote this');
    await p.key('Enter', 8);
    const th = await until(() => threads().find((x) => x.subject?.slug === 'liar-mock'), 'the thread');
    assert.doesNotMatch(JSON.stringify(th), /1767225600000/, 'nothing written carries it');
    assert.equal(th.subject.anchor.text, 'Pay at [link removed] now');
  });
});
test('pins on an artifact: where its lens says, following its scroll, the card beside them, and nothing of the owner\'s to a lens', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('stage-pins-only');
  later(() => F.done());
  landArtifact(F, 'pin-mock', PIN_MOCK);
  landArtifact(F, 'liar-mock', LIAR_MOCK);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  const B = `http://127.0.0.1:${port}`;
  later(() => dash.stop());
  const threads = () => JSON.parse(F.owner(['thread', 'list', '--all', '--json']));
  // two threads as the Shift test starts them: one on the button (where it was clicked, inside it), one
  // on the liar's page to be resolved with an outcome
  const fps = Object.fromEntries(JSON.parse(F.owner(['artifacts', '--json'])).map((a) => [a.slug, a.fp]));
  const start = async (title, subject, text) => {
    const r = await fetch(`${B}/api/thread-new`, { method: 'POST', headers: { 'content-type': 'application/json', origin: B, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ title, subject, text }) });
    assert.equal(r.status, 200, await r.clone().text());
  };
  await start('button "Buy now"', { kind: 'artifact', slug: 'pin-mock', at: 'main', path: 'index.html', fp: fps['pin-mock'], anchor: { selector: '#buy', tag: 'button', text: 'Buy now', point: { x: 60, y: 20 }, rect: { x: 40, y: 120, w: 120, h: 40 } }, point: { x: 100, y: 140 } }, 'Make it green');
  await start('note', { kind: 'artifact', slug: 'liar-mock', at: 'main', path: 'index.html', fp: fps['liar-mock'], point: { x: 60, y: 60 } }, 'Who wrote this');
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: OWN_MESSAGES });
  await p.send('Page.navigate', { url: `${B}/#artifact/main/pin-mock` });
  const soon = soonIn(p);
  const frameAt = async (x, y) => { const r = await p.ev(`(() => { const r = document.getElementById('av-frame').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`); return { x: r.x + x, y: r.y + y }; };
  const keysHere = () => p.ev(`(() => { document.activeElement?.blur?.(); window.focus(); return document.activeElement === document.body; })()`);
  let said = 0;
  const tell = async (m, answer) => { const n = ++said; await p.ev(`(() => { window.__own = window.__own.filter((x) => x.own !== ${JSON.stringify(answer)}); document.getElementById('av-frame').contentWindow.postMessage(${JSON.stringify({ ...m, n })}, '*'); return true; })()`); return soon(`window.__own.find((x) => x.own === ${JSON.stringify(answer)})`, answer); };
  await soon(`typeof TS === 'object' && TS.ready`, 'the lens to say ready');
  // a round trip through the artifact: a probe posted to its frame, back as what it heard
  let probes = 0;
  const probe = async () => { const n = ++probes; await p.ev(`(() => { document.getElementById('av-frame').contentWindow.postMessage({ probe: ${n} }, '*'); return true; })()`); await soon(`window.__own.some((x) => x.own === 'heard' && x.data?.probe === ${n})`, `probe ${n} heard`); };

  const pinAt = () => p.ev(`(() => { const b = document.querySelector('#av-pins .tl-pin'); return b ? [parseInt(b.style.left, 10), parseInt(b.style.top, 10)] : null; })()`);
  // nothing the owner wrote (a turn, a title, an outcome) in anything posted to a lens, and every
  // anchor it is asked to watch named by an open thread's id
  const toLensClean = async () => {
    const heard = await p.ev(`window.__own.filter((m) => m.own === 'heard').map((m) => m.data)`);
    const all = threads();
    const words = all.flatMap((x) => [...x.turns.filter((u) => u.by === 'owner').map((u) => u.text), x.outcome].filter(Boolean));
    assert.ok(words.length >= 2, `the owner's words to look for: ${JSON.stringify(words)}`);
    for (const w of words) assert.ok(heard.every((m) => !JSON.stringify(m).includes(w)), `never the owner's words: ${w}`);
    const resolves = heard.filter((m) => m.type === 'resolve');
    assert.ok(resolves.length, 'it was asked to watch');
    const ids = new Set(all.map((x) => x.id));
    for (const r of resolves) for (const a of r.anchors) {
      assert.match(a.key, /^t-\d{8}-\d{9}-owner$/);
      assert.ok(ids.has(a.key), `a thread's id: ${a.key}`);
      assert.deepEqual(Object.keys(a).sort(), ['anchor', 'key'], 'a key and an anchor, nothing else');
      assert.deepEqual(Object.keys(a.anchor).filter((k) => a.anchor[k] !== undefined).sort(), ['rect', 'selector', 'tag', 'text'], 'what the lens finds it by');
    }
    return heard;
  };

  await t.test('a numbered pin on the button, where it was clicked, inside the frame', async () => {
    await p.ev(`location.hash = '#artifact/main/pin-mock'`);
    await soon(`TS.slug === 'pin-mock' && TS.ready && TS.path === 'index.html'`, 'the pin mock on the stage');
    await soon(`!!document.querySelector('#av-pins .tl-pin')`, 'the pin');
    assert.deepEqual(await pinAt(), [100 - 11, 140 - 11], 'the button at 40,120 and the click 60,20 inside it');
    assert.equal(await p.ev(`document.querySelectorAll('#tl-pins .tl-pin').length`), 0, 'none of it in the page\'s own pins');
    const heard = await p.ev(`window.__own.filter((m) => m.own === 'heard' && m.data.type === 'resolve').map((m) => m.data.anchors.map((a) => a.key))`);
    assert.ok(heard.length && heard.at(-1).every((k) => /^t-\d{8}-\d{9}-owner$/.test(k)), `the lens is asked by thread ids: ${JSON.stringify(heard)}`);
  });

  await t.test("a page's word on where things are moves only the pins it was asked about, and a flood is one redraw a frame", async () => {
    const key = await p.ev('[...TS.watching][0]');
    await p.ev(`(() => { window.__draws = 0; window.__draw = tlDraw; window.tlDraw = () => { window.__draws++; window.__draw(); }; return true; })()`);
    const to = { x: 240, y: 300, w: 120, h: 40 };
    const flood = Array.from({ length: 5000 }, () => ({ lens: 1, type: 'rects', rects: [{ key, rect: to }] }));
    const odd = { lens: 1, type: 'rects', rects: [{ key: 'constructor', rect: to }, { key: '__proto__', rect: to }, { key: 'hasOwnProperty', rect: to }, { key: 't-20260101-000000000-owner', rect: to }, { key, rect: { x: 1, y: 1, w: -5, h: 4 } }, { key, rect: { x: 1, y: 1, w: 5, h: 'tall' } }] };
    await tell({ own: 'forge', say: [...flood, odd] }, 'forged');
    await soon(`(() => { const b = document.querySelector('#av-pins .tl-pin'); return b && b.style.left === '289px' && b.style.top === '309px'; })()`, 'the pin where the page says');
    await p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    const draws = await p.ev('window.__draws');
    assert.ok(draws < 100, `5,000 moves drawn ${draws} times`);
    assert.deepEqual(await p.ev('[...TS.rects.keys()]'), [key], 'only what it was asked about');
    assert.deepEqual(await pinAt(), [289, 309], 'a rect that is no box moves nothing');
    await p.ev(`(() => { window.tlDraw = window.__draw; TS.watch = ''; tsWatch(); return true; })()`);
    await soon(`(() => { const b = document.querySelector('#av-pins .tl-pin'); return b && b.style.left === '89px' && b.style.top === '129px'; })()`, 'back where the lens says');
  });

  await t.test("a page that says ready 5,000 times is heard once a load: a redraw or none, no resolve again, and the tab answers", async () => {
    const resolves = `window.__own.filter((m) => m.own === 'heard' && m.data.type === 'resolve').length`;
    await p.ev(`(() => { window.__draws = 0; window.__draw = tlDraw; window.tlDraw = () => { window.__draws++; window.__draw(); }; return true; })()`);
    const before = await p.ev(resolves);
    const flood = Array.from({ length: 5000 }, (_, i) => ({ lens: 1, type: 'ready', path: 'more/page.html', title: `ready ${i}`, viewport: { w: 10, h: 10 } }));
    // the page's polls held still across the count: only the readies can draw in it
    await p.ev('window.__still()');
    let draws;
    try {
      const t0 = Date.now();
      await tell({ own: 'forge', say: flood }, 'forged');
      await p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
      assert.ok(Date.now() - t0 < 5000, `the tab answered in ${Date.now() - t0} ms`);
      // anything the page posted the lens before this probe is heard before its echo (messages keep their order)
      await probe();
      draws = await p.ev('window.__draws');
    } finally { await p.ev('window.__stir()'); }
    assert.ok(draws <= 2, `5,000 readies drawn ${draws} times`);
    assert.equal(await p.ev(resolves), before, 'nothing asked of the lens again');
    assert.equal(await p.ev('TS.path'), 'index.html', 'the page its lens named first, this load');
    // the next load is heard again, once: one resolve for it
    await p.ev(`(() => { window.tlDraw = window.__draw; const f = document.getElementById('av-frame'); f.src = f.getAttribute('src'); return true; })()`);
    await soon(`${resolves} > ${before}`, 'asked to watch on the new load');
    await probe();
    assert.equal(await p.ev(resolves), before + 1, 'once for that load');
    await soon(`(() => { const b = document.querySelector('#av-pins .tl-pin'); return b && b.style.left === '89px' && b.style.top === '129px'; })()`, 'its pin');
  });

  await t.test('a stage pin pressed or focused stays through a redraw that drops it; let go, it goes', async () => {
    await p.ev(`document.querySelector('#av-pins .tl-pin').focus()`);
    await p.ev('TS.rects.clear(); tsPins(); true');
    assert.equal(await p.ev(`document.activeElement === document.querySelector('#av-pins .tl-pin')`), true, 'kept, with the focus');
    await keysHere();
    await soon(`!document.querySelector('#av-pins .tl-pin')`, 'gone once the focus is');
    await p.ev(`TS.watch = ''; tsWatch(); true`);
    await soon(`!!document.querySelector('#av-pins .tl-pin')`, 'the pin again');
    const at = await p.ev(`(() => { const r = document.querySelector('#av-pins .tl-pin').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await p.move(at.x, at.y);
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 });
    // the press alone: Chrome gives a pressed button the focus, which would hold it too
    await p.ev('document.activeElement?.blur(); TS.rects.clear(); tsPins(); true');
    assert.equal(await p.ev(`!!document.querySelector('#av-pins .tl-pin') && document.activeElement === document.body`), true, 'kept under the press');
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 });
    await soon('!!TL.open', 'the click landed on it');
    await p.ev('tlClose()');
    await keysHere();
    await soon(`!document.querySelector('#av-pins .tl-pin')`, 'then it went');
    await p.ev(`TS.watch = ''; tsWatch(); true`);
    await soon(`!!document.querySelector('#av-pins .tl-pin')`, 'the pin again');
  });

  await t.test('in pin mode the wheel scrolls the artifact, and the pin follows', async () => {
    await p.ev('document.activeElement?.blur()');
    // the panel's Pin, with the viewer up: #tt-peek above the viewer opens the panel, then Pin
    await soon(`getComputedStyle(document.getElementById('tt-peek')).opacity === '1'`, '#tt-peek above the viewer');
    await p.click('#tt-peek');
    await soon(`document.body.classList.contains('threads-open') && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'the panel over the viewer');
    await p.click('#tl-pinbtn');
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay in pin mode');
    const at = await frameAt(300, 300);
    await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: 100 });
    await soon(`(() => { const b = document.querySelector('#av-pins .tl-pin'); return b && parseInt(b.style.top, 10) === 140 - 100 - 11; })()`, 'the pin, 100 px up');
    await p.key('Escape');
    await soon(`document.getElementById('av-over').hidden && document.getElementById('tl-pinbtn').getAttribute('aria-pressed') === 'false'`, 'out of pin mode');
    await p.click('#th-close');
    await soon(`!document.body.classList.contains('threads-open') && !document.getElementById('artifact-view').hidden`, 'the panel closed, the viewer still up');
  });

  await t.test('the pin opens its card beside it, and the card says when the artifact changed since', async () => {
    await p.ev('TL.open = null; TL.draft = null; tlDraw()');
    await p.click('#av-pins .tl-pin');
    await soon(`!document.getElementById('tl-card').hidden && document.getElementById('tl-c-title').textContent === 'button "Buy now"'`, 'its card');
    assert.equal(await p.ev(`document.getElementById('tl-card').classList.contains('in-dock')`), false, 'beside the pin, not in the dock');
    const beside = await p.ev(`(() => { const c = document.getElementById('tl-card').getBoundingClientRect(), b = document.querySelector('#av-pins .tl-pin').getBoundingClientRect(); return Math.round(c.left - b.right); })()`);
    assert.ok(beside > 0 && beside < 30, `just right of the pin: ${beside} px`);
    assert.doesNotMatch(await p.ev(`document.getElementById('tl-c-ctx').textContent`), /changed since/);
    await p.ev(`TS.fp = 'f'.repeat(64); TL.sig = ''; tlDraw()`);
    await soon(`/changed since/.test(document.getElementById('tl-c-ctx').textContent)`, 'changed since');
    await p.ev(`TS.fp = TS.mainFp; TL.sig = ''; tlDraw()`);
  });

  await t.test('from the dock, a thread on the artifact opens the stage on it; the stage closed, its pins go', async () => {
    const T = threads().find((x) => x.subject?.kind === 'artifact' && x.subject.slug === 'pin-mock' && x.subject.anchor).id;
    await p.ev('tlClose()');
    await p.key('Escape'); // the stage: back to the Library
    // its notes aren't handed over, so the stage asks first (kit-937); I'll come back closes it
    await soon(`(() => { const d = document.getElementById('av-ask'); return !!d && !d.hidden && !document.getElementById('artifact-view').hidden; })()`, 'the ask, the stage still up');
    await p.click('#av-ask-later');
    await soon(`document.getElementById('artifact-view').hidden && !document.querySelector('#av-pins .tl-pin')`, 'closed, no pins');
    await p.ev(`location.hash = '#talk/${T}'`);
    await soon(`!document.getElementById('artifact-view').hidden && !!document.querySelector('#av-pins .tl-pin')`, 'the stage, its pin');
    await soon(`TL.open === ${JSON.stringify(T)} && !document.getElementById('tl-card').hidden && !document.getElementById('tl-card').classList.contains('in-dock')`, 'its card, beside its pin');
  });

  await t.test("nothing the owner wrote is ever posted to a lens, and it is asked about anchors by threads' ids", async () => {
    F.owner(['thread', 'say', threads().find((x) => x.subject?.slug === 'pin-mock').id, 'Owner words zq9 for the record']);
    F.owner(['thread', 'resolve', threads().find((x) => x.subject?.slug === 'liar-mock').id, '--outcome', 'Outcome zq9 as the owner put it']);
    await soon(`TL.threads.some((x) => x.turns.some((u) => u.text === 'Owner words zq9 for the record')) && TL.threads.some((x) => x.outcome === 'Outcome zq9 as the owner put it')`, 'the new turn and the outcome on the page');
    await p.ev(`TS.watch = ''; tsWatch(); true`);
    await soon(`window.__own.filter((m) => m.own === 'heard' && m.data.type === 'resolve').length >= 2`, 'asked again');
    await toLensClean();
  });

  await t.test('in a viewer tab, the same pin on the same spot', async () => {
    await p.send('Page.navigate', { url: `${B}/view/artifact/pin-mock` });
    await soon(`!!document.querySelector('#av-pins .tl-pin')`, 'the pin in the viewer');
    assert.deepEqual(await pinAt(), [89, 129]);
    await toLensClean();
  });
  await t.test('an anchor with no selector pins where it was clicked; one the lens says is gone pins nowhere; no point pins before the page is ready', async () => {
    await p.ev(`location.hash = '#artifact/main/pin-mock'`);
    await soon(`TS.slug === 'pin-mock' && TS.ready && !!document.querySelector('#av-pins .tl-pin')`, 'the pin');
    const sub = { kind: 'artifact', slug: 'pin-mock', at: 'main', path: 'index.html', anchor: { tag: 'p', text: 'no selector', point: { x: 5, y: 5 } }, point: { x: 300, y: 400 } };
    assert.deepEqual(await p.ev(`(() => { const r = tsRect(${JSON.stringify(sub)}); return r && [r.fx, r.fy]; })()`), [300, 400], 'its click, with no selector for the lens to find it by');
    assert.equal(await p.ev(`tsRect(${JSON.stringify({ ...sub, point: undefined })})`), null, 'and nothing at all with no point either');
    const key = await p.ev('[...TS.watching][0]');
    await p.ev(`TS.rects.set(${JSON.stringify(key)}, { key: ${JSON.stringify(key)}, rect: null }); tlDraw(); true`);
    await soon(`!document.querySelector('#av-pins .tl-pin')`, 'the pin gone, the lens saying it is not found');
    await p.ev(`TS.watch = ''; TS.rects.clear(); tsWatch(); true`);
    await soon(`!!document.querySelector('#av-pins .tl-pin')`, 'the pin again');
    // a page whose lens isn't ready: nothing, not the last page's points
    assert.equal(await p.ev(`(() => { TS.ready = false; tsPins(); const n = document.querySelectorAll('#av-pins .tl-pin').length; TS.ready = true; return n; })()`), 0, 'none while it is not ready');
    await soon(`(() => { tlDraw(); return !!document.querySelector('#av-pins .tl-pin'); })()`, 'back when it is');
  });

  await t.test("a rect of a thread no longer watched is dropped when the watch changes", async () => {
    const key = await p.ev('[...TS.watching][0]');
    await p.ev(`(() => { TS.rects.set('t-20260101-000000000-owner', { key: 't-20260101-000000000-owner', rect: { x: 1, y: 1, w: 2, h: 2 } }); TS.watch = ''; tsWatch(); return true; })()`);
    assert.deepEqual(await p.ev('[...TS.rects.keys()]'), [key], 'only what is watched is kept');
  });
});

test('the Library\'s Open and a question\'s [[name]] open the artifact\'s viewer in a tab of its own', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('viewer-links');
  later(() => F.done());
  landArtifact(F, 'viewer-mock', VIEWER_MOCK);
  F.sup(['ask', '--question', 'Does [[mock]] read right?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--links', JSON.stringify([{ name: 'mock', title: 'The mock', artifact: 'viewer-mock' }]), '--stake', '1', '--urgency', '1']);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#library` });
  const soon = soonIn(p);
  const link = (sel) => p.ev(`(() => { const a = document.querySelector(${JSON.stringify(sel)}); return a && [a.getAttribute('href'), a.target, a.rel, a.textContent]; })()`);
  // kit-92: the card's Open is its head's ↗ (.lib-tab), an icon named by its aria-label
  const tab = (sel) => p.ev(`(() => { const a = document.querySelector(${JSON.stringify(sel)}); return a && [a.getAttribute('href'), a.target, a.rel, a.getAttribute('aria-label')]; })()`);
  await soon(`!!document.querySelector('.lib-card[data-lib-id="artifact:viewer-mock"] a.lib-tab.av-open')`, 'the card\'s Open');
  assert.deepEqual(await tab('.lib-card[data-lib-id="artifact:viewer-mock"] a.lib-tab.av-open'), ['/view/artifact/viewer-mock', '_blank', 'noopener noreferrer', 'Open in a new tab']);
  assert.match((await link('.lib-card[data-lib-id="artifact:viewer-mock"] a.lib-title'))[0], /^#artifact\/main\/viewer-mock$/, 'its title still opens the stage here');
  await p.ev(`location.hash = '#inbox'`);
  await soon(`!!document.querySelector('.qref a')`, 'the question\'s [[mock]]');
  assert.deepEqual(await link('.qref a'), ['/view/artifact/viewer-mock', '_blank', 'noopener noreferrer', 'The mock']);
  // a malformed escape in a link's href falls back to the plain stage link, not a throw
  assert.match(await p.ev(`artNameLink({ title: 'Bad', artifact: 'x', href: '#artifact/wt/%E0%A4%A/x' })`), /^<a href="#artifact\/wt\/%E0%A4%A\/x"/);
  await p.ev(`location.hash = '#artifact/main/viewer-mock'`);
  await soon(`!document.getElementById('artifact-view').hidden`, 'the stage');
  assert.deepEqual(await link('#av-tab'), ['/view/artifact/viewer-mock', '_blank', 'noopener noreferrer', 'Open in new tab']);
});
