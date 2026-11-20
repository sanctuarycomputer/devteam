// Previews in Chrome, through the relay: Shift over a preview, and the Library's preview card.
// Ports: +0/+1..25 lib/kit.mjs's; +62..79 the laptop's relays (DEVTEAM_RELAY_PORTS)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PORTS, dashboardOnFreePort, until, threadsFixture } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { soonIn, POLL_FAST, LIE_CAP, OWN_MESSAGES, fakeApp } from './lib/dashboard-page.mjs';

// The laptop's relays, in a range of this file's own block of ports (lib/ports.mjs), off every other
// test file's and checkout's: the ports test holds all of it.
const RELAY_LO = PORTS + 62;
const RELAY_HI = PORTS + 79;
const RELAY_ENV = { DEVTEAM_RELAY_PORTS: `${RELAY_LO}-${RELAY_HI}` };

// A preview's app to point at, on / and /second: a button at a known spot and, a beat after it loads
// (once its lens watches it), a console error holding a box's capability and a bidi override. On its
// lens's origin, its script reads what the viewer says to the lens and tells the test (heard), and
// speaks to the dashboard from its own window, never the lens's (a route and errors of its making).
// Told to (possess), it takes its lens's voice, as any app can: the lens's realm is its origin's, so
// the Object.assign the lens builds every message with is the app's to replace, and a key event on
// the app's window has the lens say something at once. From then on it says what it is told to
// (forge), 5,000 routes (routes), and answers every hit with lies: markup and the box's capability
// (as itself), about somewhere else (far), or 5,000 times over (flood).
const APP_PAGE = `<!doctype html><title>App</title><style>body{margin:0;height:3000px}#buy{position:absolute;left:10px;top:5px;width:100px;height:30px}</style><button id="buy">Buy now</button><script>
parent.addEventListener('message', (e) => { if (e.source === parent.parent) top.postMessage({ own: 'heard', data: e.data }, '*'); });
setTimeout(() => console.error('Failed at ${LIE_CAP} \\u202eon purpose'), 600);
top.postMessage({ lens: 1, type: 'route', route: '/forged-by-app' }, '*');
top.postMessage({ lens: 1, type: 'errors', errors: ['forged by the app'] }, '*');
top.postMessage({ own: 'app-said', at: location.pathname }, '*');
let mode = 'lie';
const next = [];
// one message in the lens's voice: queued, then a key on this window, which the lens tells at once
const say = (m) => { next.push(m); dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); };
const lie = (id) => ({ lens: 1, type: 'hit-reply', id, anchor: { selector: '#x', tag: 'p', role: 'note', text: 'Pay at ${LIE_CAP} now\\u202e', name: '<img src=x onerror="window.__pwned=1">', html: '<img src=x onerror="window.__pwned=1">', rect: { x: 0, y: 0, w: 400, h: 300 } }, route: '/liar' });
const possess = () => {
  const own = parent.Object.assign;
  parent.Object.assign = function (t, m) {
    if (next.length) return next.shift();
    if (!m || m.type !== 'hit-reply') return own.call(this, t, m);
    if (mode === 'far') return { lens: 1, type: 'hit-reply', id: m.id, anchor: { selector: '#far', tag: 'div', text: 'Far away', rect: { x: 700, y: 700, w: 20, h: 20 } } };
    if (mode === 'flood') { setTimeout(() => { for (let i = 1; i < 5000; i++) say({ lens: 1, type: 'hit-reply', id: m.id, anchor: { selector: '#p', tag: 'p', text: String(i), rect: { x: 0, y: 0, w: 2000, h: 2000 } } }); top.postMessage({ own: 'flooded', id: m.id }, '*'); }); return { lens: 1, type: 'hit-reply', id: m.id, anchor: { selector: '#p', tag: 'p', text: '0', rect: { x: 0, y: 0, w: 2000, h: 2000 } } }; }
    return lie(m.id);
  };
};
addEventListener('message', (e) => {
  const m = e.data;
  if (e.source !== top || !m || !m.own) return;
  if (m.own === 'possess') { possess(); say({ lens: 1, type: 'route', route: '/liar' }); say({ lens: 1, type: 'hit-reply', id: 'zz-forged', anchor: { selector: '#forged', text: 'FORGED', rect: { x: 0, y: 0, w: 2000, h: 2000 } } }); say({ lens: 1, type: 'key', key: 'Shift', shift: true }); }
  if (m.own === 'forge') for (const x of m.say) say(x);
  if (m.own === 'mode') mode = m.mode;
  if (m.own === 'routes') { for (let i = 0; i < 5000; i++) say({ lens: 1, type: 'route', route: i % 2 ? '/a' : '/b' }); say({ lens: 1, type: 'route', route: '/liar' }); }
  top.postMessage({ own: m.own + '-done', n: m.n }, '*');
});
</script>`;
test('Shift over a preview, through the relay: what the app has under the pointer, a thread on it, its pin, and go', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 300000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('preview-stage');
  later(() => F.done());
  // an app that refuses every frame, as many do: only its lens's own loads may hold it
  const app = await fakeApp({ 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" }, { '/': APP_PAGE, '/second': APP_PAGE });
  later(() => app.close());
  const name = /preview (\S+) /.exec(F.sup(['preview', String(app.port), '--label', 'Checkout']))[1];
  const { dash, port } = await dashboardOnFreePort(F.old, F.env(RELAY_ENV));
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
  // how often the tab's own page has loaded (a viewer reloads once for a relay its own ask opened)
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: "if (window === top) try { sessionStorage.__loads = String(Number(sessionStorage.__loads || 0) + 1); } catch {}" });
  const soon = soonIn(p);
  const frameAt = async (x, y) => { const r = await p.ev(`(() => { const r = document.getElementById('pv-frame').getBoundingClientRect(); return { x: r.left, y: r.top }; })()`); return { x: r.x + x, y: r.y + y }; };
  const keysHere = () => p.ev(`(() => { document.activeElement?.blur?.(); window.focus(); return document.activeElement === document.body; })()`);
  const threads = () => JSON.parse(F.owner(['thread', 'list', '--all', '--json']));
  // a word to the app inside the lens, and its answer once it has done it
  let said = 0;
  const tell = async (m) => { const n = ++said; await p.ev(`document.getElementById('pv-frame').contentWindow.frames[0].postMessage(${JSON.stringify({ ...m, n })}, '*'), true`); return soon(`window.__own.find((x) => x.own === ${JSON.stringify(`${m.own}-done`)} && x.n === ${n})`, m.own); };
  const patient = (ms) => p.ev(`TS.waitMs = ${ms}`);
  const heard = () => p.ev(`window.__own.filter((m) => m.own === 'heard').map((m) => m.data)`);
  const aFrame = () => p.ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
  const frameMs = () => p.ev('new Promise((r) => { const t = performance.now(); requestAnimationFrame(() => r(performance.now() - t)); })');

  await t.test('the first look opens the relay, which the page loaded without: the stage says to reload', async () => {
    await p.send('Page.navigate', { url: `${B}/#preview/${name}` });
    await soon(`document.getElementById('av-note').textContent === 'Reload to view this preview' && !document.getElementById('av-note').hidden`, 'the note');
    assert.equal(await p.ev('TS.ready'), false, 'the lens is outside this page\'s policy');
    // only the lens's own refusal says to reload: another frame's is not this note's to say
    await p.ev(`(() => { const n = document.getElementById('av-note'); n.hidden = true; n.textContent = ''; document.dispatchEvent(new SecurityPolicyViolationEvent('securitypolicyviolation', { violatedDirective: 'frame-src', blockedURI: 'http://127.0.0.1:1/other', originalPolicy: '' })); return true; })()`);
    assert.equal(await p.ev(`document.getElementById('av-note').hidden`), true, 'a refusal of another address says nothing');
    // the lens's address with a longer port after it is another address, not the lens
    await p.ev(`(() => { document.dispatchEvent(new SecurityPolicyViolationEvent('securitypolicyviolation', { violatedDirective: 'frame-src', blockedURI: new URL(document.getElementById('pv-frame').src).origin + '9/.devteam/lens', originalPolicy: '' })); return true; })()`);
    assert.equal(await p.ev(`document.getElementById('av-note').hidden`), true, 'a refusal of a longer port says nothing');
    await p.ev(`(() => { document.dispatchEvent(new SecurityPolicyViolationEvent('securitypolicyviolation', { violatedDirective: 'frame-src', blockedURI: new URL(document.getElementById('pv-frame').src).origin + '/.devteam/lens', originalPolicy: '' })); return true; })()`);
    assert.equal(await p.ev(`document.getElementById('av-note').textContent`), 'Reload to view this preview', 'the lens\'s own does');
    assert.equal(await p.ev(`document.getElementById('av-title').textContent`), 'Checkout');
  });

  await t.test('the stage here frames the lens on the relay, sandboxed with no top navigation, and the lens frames the app', async () => {
    await p.send('Page.reload');
    await soon(`TS.kind === 'preview' && TS.ready && TS.route === '/'`, 'the lens to say ready');
    assert.equal(await p.ev(`document.getElementById('av-note').hidden`), true, 'no note once the page names the relay');
    const f = await p.ev(`(() => { const f = document.getElementById('pv-frame'); return [f.hidden, f.getAttribute('sandbox'), new URL(f.src).pathname, document.getElementById('av-frame').hidden, document.getElementById('av-frame').hasAttribute('src')]; })()`);
    assert.deepEqual(f, [false, 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-pointer-lock allow-downloads', '/.devteam/lens', true, false]);
    assert.doesNotMatch(f[1], /top-navigation/);
    const relay = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(await p.ev('TS.origin'));
    assert.ok(relay && Number(relay[1]) >= RELAY_LO && Number(relay[1]) <= RELAY_HI, 'the relay, in its range');
    assert.equal(await p.ev('TS.target'), relay[0], 'what goes to the lens goes to its origin only');
    assert.deepEqual(await p.ev(`[document.getElementById('av-title').textContent, document.getElementById('av-tab').getAttribute('href')]`), ['Checkout', `/view/preview/${name}`]);
    assert.match(await p.ev(`document.getElementById('av-where').textContent`), /^from \S+ · \/( · (live|not answering))?$/);
  });

  await t.test("the app's own window can say what it likes: it is not the stage's frame, so it is taken for nothing", async () => {
    await soon(`window.__own.some((m) => m.own === 'app-said' && m.at === '/')`, 'the app has spoken');
    assert.equal(await p.ev('TS.route'), '/', 'its route is its lens\'s word, not its own');
    assert.equal(await p.ev(`TS.errors.includes('forged by the app')`), false);
  });

  await t.test("a Shift+click on the app's button starts a thread on it: its name, route, viewport, errors and anchor", async () => {
    await patient(2000);
    await soon(`TS.errors.length === 1`, "the app's error, from its lens");
    const at = await frameAt(30, 15);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.move(at.x, at.y, 8);
    await soon(`document.getElementById('tl-chip').textContent === 'button "Buy now"'`, 'the chip');
    await soon(`TS.hit?.anchor?.selector === '#buy'`, "the lens's answer for the hover");
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.kind === 'preview'`, 'a thread about to start');
    const s = await p.ev('TL.draft.subject');
    assert.deepEqual([s.name, s.route, s.anchor.selector, s.anchor.text, typeof s.viewport.w, typeof s.viewport.h, s.point], [name, '/', '#buy', 'Buy now', 'number', 'number', { x: 30, y: 15 }]);
    // the app's own words, as its lens passed them on: the capability cut, the bidi override gone
    assert.deepEqual(s.errors, ['Failed at [link removed] on purpose']);
    await p.type('Make it green');
    await p.key('Enter', 8);
    const th = await until(() => threads().find((x) => x.subject?.kind === 'preview'), 'the thread');
    assert.deepEqual([th.title, th.subject.name, th.subject.route, th.subject.anchor.selector, th.subject.errors], ['button "Buy now"', name, '/', '#buy', ['Failed at [link removed] on purpose']]);
    await soon(`!!document.querySelector('#av-pins .tl-pin')`, 'its pin');
    await p.ev('tlClose()');
    await patient(150);
    await keysHere();
  });

  await t.test('with the keyboard in the app, its lens tells Shift, and that raises the overlay', async () => {
    const blank = await frameAt(600, 500);
    await p.clickAt(blank.x, blank.y);
    await soon(`document.activeElement === document.getElementById('pv-frame')`, 'the frame has the keyboard');
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden && TS.raised`, 'raised by what the lens said');
    await p.hold('Shift', false);
    await p.move(blank.x + 5, blank.y + 5);
    await soon(`document.getElementById('av-over').hidden && !TS.raised`, 'lowered by the pointer, Shift up');
    await keysHere();
  });

  await t.test('another route: the pin goes; the thread from the dock goes back to its route, by go, and go goes nowhere else', async () => {
    const T = threads().find((x) => x.subject?.kind === 'preview').id;
    await p.ev(`tsPost({ type: 'go', route: '/second' })`);
    await soon(`TS.route === '/second' && !document.querySelector('#av-pins .tl-pin')`, 'no pin on another route');
    // a route from the log is the log's: only one of the app's own paths is ever asked for
    const bad = ['//evil.example/x', 'https://evil.example/', '/\\evil.example', '/\t/evil.example', 'javascript:alert(1)', '/.devteam/lens', 'second', ''];
    for (const r of bad) await p.ev(`tlGoTo(${JSON.stringify({ kind: 'preview', name, route: r })}), true`);
    await p.ev(`tlOpen('${T}')`);
    await soon(`TS.route === '/' && !!document.querySelector('#av-pins .tl-pin')`, 'back on its route, its pin with it');
    const gone = (await heard()).filter((m) => m.type === 'go').map((m) => m.route);
    assert.deepEqual([...new Set(gone)].sort(), ['/', '/second'], 'only the app\'s own paths');
    await p.ev('tlClose()');
  });

  await t.test("messages from the preview's frame are taken only from the lens's own origin", async () => {
    const say = (origin, data) => p.ev(`window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify({ lens: 1, ...data })}, origin: ${JSON.stringify(origin)}, source: document.getElementById('pv-frame').contentWindow })), true`);
    await say('http://evil.example', { type: 'route', route: '/evil' });
    await say('http://evil.example', { type: 'errors', errors: ['evil'] });
    await say('null', { type: 'route', route: '/opaque' });
    await aFrame();
    assert.deepEqual(await p.ev(`[TS.route, TS.errors.includes('evil')]`), ['/', false], 'another origin: nothing taken');
    // the same word from the lens's origin is taken, so it is the origin that kept the others out
    const own = await p.ev('TS.origin');
    await say(own, { type: 'route', route: '/from-its-origin' });
    assert.equal(await p.ev('TS.route'), '/from-its-origin');
    await say(own, { type: 'route', route: '/' });
    await soon(`TS.route === '/' && !!document.querySelector('#av-pins .tl-pin')`, 'its route again');
  });

  await t.test("the app can take its lens's voice: what it says is still the page's", async () => {
    await keysHere();
    await tell({ own: 'possess' });
    await soon(`TS.ready && TS.route === '/liar'`, 'its route, in its lens\'s voice');
    assert.equal(await p.ev('TS.hit'), null, 'a reply to an id the page never minted is kept nowhere');
    assert.deepEqual(await p.ev(`[document.getElementById('av-over').hidden, TS.raised]`), [true, false], 'its Shift, with the keyboard on the dashboard, raises nothing');
    await soon(`!document.querySelector('#av-pins .tl-pin')`, 'no pin on its route, once it is drawn');
  });

  await t.test('with the keyboard in the frame, its say-so raises the overlay, which only the owner lowers', async () => {
    const blank = await frameAt(600, 500);
    await p.clickAt(blank.x, blank.y);
    await soon(`document.activeElement === document.getElementById('pv-frame')`, 'the frame has the keyboard');
    const raise = { own: 'forge', say: [{ lens: 1, type: 'key', key: 'Shift', shift: true }] };
    await tell(raise);
    await soon('TS.raised', 'its say-so, believed while it has the keyboard');
    await p.move(blank.x + 5, blank.y + 5);
    await soon(`document.getElementById('av-over').hidden && !TS.raised`, 'gone once the pointer moves without Shift');
    await p.hold('Shift', true);
    await tell(raise);
    await soon('TS.raised', 'raised');
    await tell({ own: 'forge', say: [{ lens: 1, type: 'key', key: 'Shift', shift: false }, { lens: 1, type: 'key', key: 'Escape', shift: false }] });
    assert.deepEqual(await p.ev(`[TS.raised, document.getElementById('av-over').hidden]`), [true, false], 'its "Shift up" lowers nothing while the owner holds it');
    await p.hold('Shift', false);
    await p.move(blank.x, blank.y);
    await soon('!TS.raised', 'lowered');
    await keysHere();
  });

  await t.test("an answer about somewhere else isn't believed: the point alone", async () => {
    await patient(2000);
    await tell({ own: 'mode', mode: 'far' });
    const at = await frameAt(100, 140);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.move(at.x, at.y, 8);
    await soon(`TS.hit && TS.hit.anchor === null`, 'its answer, dropped to the point');
    await soon(`document.getElementById('tl-chip').textContent === ${JSON.stringify(`${name} · /liar`)}`, 'the chip names the page');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.point?.x === 100`, 'the point');
    assert.deepEqual(await p.ev(`[TL.draft.subject.anchor ?? null, TL.draft.subject.point, TL.draft.subject.route]`), [null, { x: 100, y: 140 }, '/liar']);
    await p.key('Escape');
    await tell({ own: 'mode', mode: 'lie' });
    await patient(150);
    await keysHere();
  });

  await t.test('a question answered 5,000 times is answered once, 5,000 routes are drawn once, and the page keeps up', async () => {
    await tell({ own: 'mode', mode: 'flood' });
    const at = await frameAt(100, 140);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.move(at.x, at.y, 8);
    const { id } = await soon(`window.__own.find((x) => x.own === 'flooded')`, 'the flood');
    assert.deepEqual(await p.ev(`[TS.hit?.anchor?.text, TS.minted.has(${JSON.stringify(id)})]`), ['0', false], 'its first answer, and the question let go of');
    let ms = await frameMs();
    assert.ok(ms < 2000, `a frame drawn in ${ms} ms`);
    await p.hold('Shift', false);
    await tell({ own: 'mode', mode: 'lie' });
    await p.ev(`(() => { window.__draws = 0; const d = tlDraw; tlDraw = () => { window.__draws++; d(); }; return true; })()`);
    await tell({ own: 'routes' });
    ms = await frameMs();
    assert.ok(ms < 2000, `a frame drawn in ${ms} ms`);
    await aFrame();
    assert.equal(await p.ev('TS.route'), '/liar', 'its last word');
    assert.ok(await p.ev('window.__draws') < 200, 'drawn once a frame, not once a route');
    // the same, saying ready (a route each) rather than route: the page it ends on is the one with a thread
    const resolves = `window.__own.filter((m) => m.own === 'heard' && m.data.type === 'resolve').length`;
    await p.ev('window.__draws = 0');
    await tell({ own: 'forge', say: [...Array.from({ length: 5000 }, (_, i) => ({ lens: 1, type: 'ready', path: '/', route: i % 2 ? '/a' : '/b', viewport: { w: 10, h: 10 } })), { lens: 1, type: 'route', route: '/' }] });
    ms = await frameMs();
    assert.ok(ms < 2000, `a frame drawn in ${ms} ms`);
    await aFrame();
    assert.equal(await p.ev('TS.route'), '/', 'its last word');
    assert.ok(await p.ev('window.__draws') < 200, 'drawn once a frame, not once a ready');
    await soon(`document.querySelector('#av-pins .tl-pin')`, 'the pin on the route it ended on');
    // a ready about the route it is on, once its watch was asked for, is heard no more: a load is heard once
    await new Promise((r) => setTimeout(r, 300));
    const settled = await p.ev(resolves);
    await tell({ own: 'forge', say: Array.from({ length: 50 }, () => ({ lens: 1, type: 'ready', path: '/', route: '/', viewport: { w: 10, h: 10 } })) });
    await aFrame();
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await p.ev(resolves), settled, 'nothing asked of the lens again');
    await tell({ own: 'forge', say: [{ lens: 1, type: 'route', route: '/liar' }] });
    await soon(`TS.route === '/liar'`, 'back on its last word');
    await keysHere();
  });

  await t.test("its lies are its words: shown as text, cut of the box's capability and of bidi, and never markup", async () => {
    await patient(2000);
    const at = await frameAt(60, 60);
    await p.hold('Shift', true);
    await soon(`!document.getElementById('av-over').hidden`, 'the overlay');
    await p.move(at.x, at.y, 8);
    await soon(`TS.hit?.anchor?.role === 'note'`, 'its answer');
    const chip = 'note "<img src=x onerror="window.__pwned=1">"';
    await soon(`document.getElementById('tl-chip').textContent === ${JSON.stringify(chip)}`, 'the chip, drawn as text');
    await p.clickAt(at.x, at.y, 8);
    await p.hold('Shift', false);
    await soon(`TL.draft?.subject?.route === '/liar'`, 'a thread about to start');
    const s = await p.ev('TL.draft.subject');
    assert.equal(s.anchor.text, 'Pay at [link removed] now');
    assert.doesNotMatch(JSON.stringify(s), /1767225600000/, 'no capability in the subject');
    await p.ev(`document.querySelector('#tl-card details')?.setAttribute('open', ''); true`);
    assert.deepEqual(await p.ev(`[document.querySelectorAll('#tl img').length, window.__pwned ?? null]`), [0, null], "its markup never became the page's");
    await p.type('Who wrote this');
    await p.key('Enter', 8);
    const th = await until(() => threads().find((x) => x.subject?.route === '/liar'), 'the thread');
    assert.doesNotMatch(JSON.stringify(th), /1767225600000/, 'nothing written carries it');
    assert.equal(th.subject.anchor.text, 'Pay at [link removed] now');
    await p.ev('tlClose()');
    await patient(150);
    await keysHere();
  });

  await t.test("nothing sent to the preview's frame carries the owner's words: questions only, by ids the page minted", async () => {
    const all = await heard();
    assert.ok(all.some((m) => m.type === 'hello') && all.some((m) => m.type === 'hit') && all.some((m) => m.type === 'resolve') && all.some((m) => m.type === 'go'), JSON.stringify([...new Set(all.map((m) => m.type))]));
    assert.deepEqual([...new Set(all.map((m) => m.type))].filter((k) => !['hello', 'hit', 'resolve', 'scroll-by', 'go'].includes(k)), [], 'only questions');
    assert.deepEqual(all.filter((m) => m.id !== undefined && !(typeof m.id === 'string' && /^[hr]\d+$/.test(m.id))), [], 'string ids only');
    for (const w of ['Make it green', 'Who wrote this']) assert.ok(all.every((m) => !JSON.stringify(m).includes(w)), `never the owner's words: ${w}`);
  });

  await t.test('closed, the stage lets go of the lens', async () => {
    await p.ev(`location.hash = '#library'`);
    await soon(`document.getElementById('artifact-view').hidden && !document.getElementById('pv-frame').hasAttribute('src') && document.getElementById('pv-frame').hidden && TS.kind === null && TS.name === null && TS.route === null`, 'closed');
  });

  await t.test('the viewer tab for a preview: the same stage, the whole tab, its state from hello', async () => {
    await p.ev(`sessionStorage.__loads = '0'`);
    await p.send('Page.navigate', { url: `${B}/view/preview/${name}` });
    await soon(`TS.kind === 'preview' && TS.ready && !!document.querySelector('#av-pins .tl-pin')`, 'the viewer, the lens, the pin');
    assert.equal(await p.ev(`document.documentElement.classList.contains('viewer')`), true);
    await soon(`/ · live$/.test(document.getElementById('av-where').textContent)`, 'its state, from hello');
    assert.equal(await p.ev('sessionStorage.__loads'), '1', 'its relay was open: no reload');
  });

  await t.test("a viewer whose own ask opened the relay loads once more, and then shows it", async () => {
    const app2 = await fakeApp({}, { '/': APP_PAGE });
    later(() => app2.close());
    const name2 = /preview (\S+) /.exec(F.sup(['preview', String(app2.port), '--label', 'Other']))[1];
    await p.ev(`sessionStorage.__loads = '0'`);
    await p.send('Page.navigate', { url: `${B}/view/preview/${name2}` });
    await soon(`TS.kind === 'preview' && TS.name === ${JSON.stringify(name2)} && TS.ready && TS.route === '/'`, 'the second preview, through its own relay');
    assert.equal(await p.ev('sessionStorage.__loads'), '2', 'once more, and only once');
    assert.equal(await p.ev(`sessionStorage.getItem(${JSON.stringify(`devteam.preview.reloaded.${name2}`)})`), null, 'and ready to again, the next time one opens');
    assert.equal(await p.ev(`document.getElementById('av-note').hidden`), true);
  });

  await t.test("an artifact's viewer never shows a preview: not by its route, not by a preview's thread", async () => {
    const T = threads().find((x) => x.subject?.kind === 'preview' && x.subject.route === '/').id;
    await p.send('Page.navigate', { url: `${B}/view/artifact/some-mock#preview/${name}` });
    await soon(`TS.kind === 'artifact' && TL.threads.some((x) => x.id === ${JSON.stringify(T)})`, 'the artifact viewer, with the threads');
    await p.ev(`tlOpen(${JSON.stringify(T)})`);
    await aFrame();
    assert.deepEqual(await p.ev(`[TS.kind, document.getElementById('pv-frame').hasAttribute('src'), document.getElementById('pv-frame').hidden, location.hash]`), ['artifact', false, true, `#preview/${name}`]);
  });
});

test("the Library's preview card opens the stage here and the viewer in a tab; a question's [[name]] opens the viewer", { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 180000 }, async (t) => {
  const later = cleanup(t);
  const F = threadsFixture('preview-links');
  later(() => F.done());
  const app = await fakeApp();
  later(() => app.close());
  const name = /preview (\S+) /.exec(F.sup(['preview', String(app.port), '--label', 'Checkout']))[1];
  F.sup(['ask', '--question', 'Does [[flow]] feel right?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--links', JSON.stringify([{ name: 'flow', title: 'The flow', preview: name }]), '--stake', '1', '--urgency', '1']);
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#library` });
  const soon = async (expr, what) => { const end = Date.now() + 30000; for (;;) { const v = await p.ev(expr); if (v) return v; if (Date.now() > end) assert.fail(`timed out: ${what}`); await new Promise((r) => setTimeout(r, 50)); } };
  const link = (sel) => p.ev(`(() => { const a = document.querySelector(${JSON.stringify(sel)}); return a && [a.getAttribute('href'), a.target, a.rel, a.textContent]; })()`);
  // kit-92: the card is a .lib-card; its state a badge in its head, its Open the head's ↗ (.lib-tab, named by its aria-label)
  const card = `.lib-card[data-preview="${name}"]`;
  const tab = (sel) => p.ev(`(() => { const a = document.querySelector(${JSON.stringify(sel)}); return a && [a.getAttribute('href'), a.target, a.rel, a.getAttribute('aria-label')]; })()`);
  await soon(`!!document.querySelector('${card} a.lib-tab.av-open')`, 'the card');
  const said = await soon(`(() => { const b = document.querySelector('${card} .card-head .badge'); return !!b && b.textContent !== 'checking' && b.textContent; })()`, "the card's first probe");
  assert.equal(said, 'live', `an app answering on 127.0.0.1 reads live from the dashboard's first probe: ${said}`);
  assert.deepEqual(await tab(`${card} a.lib-tab.av-open`), [`/view/preview/${name}`, '_blank', 'noopener noreferrer', 'Open in a new tab']);
  assert.deepEqual(await link(`${card} a.lib-title`), [`#preview/${name}`, '', '', 'Checkout']);
  assert.equal(await p.ev(`document.querySelector('${card} [data-copy]').dataset.copy`), `http://127.0.0.1:${app.port}/`, 'Copy link is still its own link');
  // where the stage was opened from is taken once the preview is known, and not at all for an ask the owner left
  await p.ev(`(() => { const f = window.fetch; window.fetch = (u, ...a) => (String(u).includes('/api/view') ? new Promise((r) => setTimeout(r, 400)).then(() => f(u, ...a)) : f(u, ...a)); return true; })()`);
  await p.ev(`location.hash = '#preview/${name}'`);
  await p.ev(`location.hash = '#library'`);
  await new Promise((r) => setTimeout(r, 900));
  assert.deepEqual(await p.ev('[AV_FROM, avFocus, document.getElementById("artifact-view").hidden]'), [false, null, true], 'an ask the owner left behind records nothing and opens nothing');
  await p.ev(`location.hash = '#inbox'`);
  await soon(`!!document.querySelector('.qref a')`, 'the [[flow]]');
  assert.deepEqual(await link('.qref a'), [`/view/preview/${name}`, '_blank', 'noopener noreferrer', 'The flow']);
});
