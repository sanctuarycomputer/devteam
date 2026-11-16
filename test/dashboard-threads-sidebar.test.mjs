// The Threads panel (kit-89): a full-height side panel with real tabs, opened from the top-right Inbox
// button, which carries the threads' counts. Headless Chrome against a real dashboard on a project of
// its own (threadsFixture), skipped where Chrome can't be driven, as the kit's other Chrome tests are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadsFixture, dashboardOnFreePort, until } from './lib/kit.mjs';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';

// A wait on a condition in the page (this file's own copy of dashboard.test.mjs's soonIn): an
// evaluation that throws is "not yet"; timed out, it says where the tab is and the last error.
const soonIn = (p, ms = 30000, server = null) => async (expr, what) => {
  const end = Date.now() + ms;
  for (;;) {
    let v, err = null;
    try { v = await p.ev(expr); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) {
      const at = await p.ev('[location.href, document.title, document.readyState]').catch((e) => e.message);
      assert.fail(`timed out: ${what}; the tab is at ${JSON.stringify(at)}${err ? `; last: ${err.message}` : ''}${server ? `; the server said, last: ${JSON.stringify(String(server()).slice(-600))}` : ''}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
};
// The page polls every 10 s; here every 300 ms. A test can hold back every /api/threads answer, read
// now, until it lets each go (__threadsQueue, as dashboard.test.mjs's POLL_FAST has it).
const POLL_FAST = `(() => {
  const si = window.setInterval;
  window.setInterval = (f, ms, ...a) => si(f, ms === 10000 ? 300 : ms, ...a);
  const rf = window.fetch;
  window.fetch = async (u, o) => {
    if (String(u).startsWith('/api/threads') && window.__threadsQueue) { const r = await rf(u, { ...o, signal: undefined }); await new Promise((go) => window.__threadsQueue.push(go)); return r; }
    return rf(u, o);
  };
})()`;
// Resolves after two frames: whatever an event handler set has been drawn.
const FRAMES = 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))';
const goalArgs = (title, priority) => ['goal', 'add', '--title', title, '--outcome', 'admins pay alone', '--measure', 'self-serve share', '--target', '80', '--unit', '%', '--direction', 'up', '--source', 'prod', '--check', 'echo 5', '--horizon', '2027-03-31', '--non-goals', 'enterprise invoicing', '--preconditions', 'cards work', 'prices defined', '--priority', String(priority)];
const idOf = (out) => out.split('\n')[0].trim();

// A fixture's dashboard and a Chrome tab on it at 1440x900.
async function open(t, F, hash) {
  const later = cleanup(t);
  later(() => F.done());
  const { dash, port } = await dashboardOnFreePort(F.old, F.env({}));
  later(() => dash.stop());
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  const size = (width, height) => p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await size(1440, 900);
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: POLL_FAST });
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/${hash}` });
  const soon = soonIn(p, 30000, () => dash.out());
  await soon('typeof DATA === "object" && DATA !== null && TL.have > 0', 'the page and its threads read');
  return { p, soon, size };
}

test('the panel and its button', { skip: SKIP, timeout: 300000 }, async (t) => {
  const F = threadsFixture('threads-sidebar');
  F.sup(goalArgs('Self-serve billing', 2));
  F.sup(['ask', '--question', 'Which way?', '--choices', '[{"label":"Left"},{"label":"Right"}]', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  // A: no subject, the supervisor spoke last and asked a question in it (your move)
  const A = idOf(F.owner(['thread', 'new', 'Where do we start?']));
  F.sup(['thread', 'reply', A, 'Here, I think.']);
  F.sup(['thread', 'ask', A, '--question', 'Which colour?', '--goal', F.goal, '--stake', '1', '--urgency', '1']);
  // B: the owner's only (waiting on the supervisor)
  const B = idOf(F.owner(['thread', 'new', 'Is the build green?']));
  // C: proposed resolved (ready to accept)
  const C = idOf(F.owner(['thread', 'new', 'Tidy the readme']));
  F.sup(['thread', 'reply', C, 'Tidied.']);
  F.sup(['thread', 'ready', C, '--outcome', 'done']);
  // G: on the first goal, pinned on Goals (your move)
  const G = idOf(F.owner(['thread', 'new', 'About this goal', '--subject', JSON.stringify({ kind: 'item', ref: `goal:${F.goal}` })]));
  F.sup(['thread', 'reply', G, 'On it.']);
  // X: on a ticket the project doesn't have (waiting; its subject gone)
  const X = idOf(F.owner(['thread', 'new', 'About a ticket', '--subject', JSON.stringify({ kind: 'item', ref: 'ticket:kit-gone' })]));
  const R = [];
  for (const w of ['First done thing', 'Second done thing']) { const r = idOf(F.owner(['thread', 'new', w])); F.owner(['thread', 'resolve', r, '--outcome', 'ok']); R.push(r); }
  const { p, soon, size } = await open(t, F, '#overview');
  const tt = "document.querySelector('.pagebar .tt')";
  const isOpen = "document.body.classList.contains('threads-open')";
  const row = (id) => `document.querySelector('#tl-list [data-tl-open="${id}"]')`;

  // the button: Inbox, the red count, the thread count in green with its words
  await soon(`${tt}.querySelector('.n.th')?.textContent === '3'`, 'the thread count');
  const b = await p.ev(`(() => { const b = ${tt}; return { text: b.textContent, q: b.querySelector('.n.q').textContent, th: b.querySelector('.n.th').className, title: b.getAttribute('title'), label: b.getAttribute('aria-label') }; })()`);
  assert.match(b.text, /^\s*Inbox/, 'it reads Inbox');
  assert.equal(b.q, '2', 'the red count: two open questions');
  assert.equal(b.th, 'n th ok', 'green: one ready plus two your move');
  assert.equal(b.title, '1 ready to accept, 2 your move');
  assert.match(b.label, /2 open questions/);
  assert.match(b.label, /1 ready to accept, 2 your move/);

  // opening it from the button: the page moves left by --threads-w, the button hides
  assert.equal(await p.ev(isOpen), false, 'closed at first');
  const closedRight = await p.ev("document.querySelector('.main').getBoundingClientRect().right");
  await p.click('.pagebar .tt');
  await soon(`location.hash === '#overview?th=open' && ${isOpen}`, 'the panel open on #overview?th=open');
  // at rest: the margin's slide (--dur) has ended
  await soon("getComputedStyle(document.querySelector('.main')).marginRight === '380px'", ".main's right margin is --threads-w");
  const openRight = await p.ev("document.querySelector('.main').getBoundingClientRect().right");
  assert.ok(Math.abs(closedRight - openRight - 380) <= 1, `.main's right edge moved left by 380px: ${closedRight} to ${openRight}`);
  assert.deepEqual(await p.ev(`[getComputedStyle(${tt}).visibility, getComputedStyle(document.getElementById('tt-peek')).visibility]`), ['hidden', 'hidden'], '.tt and #tt-peek hidden');
  await soon("getComputedStyle(document.getElementById('threads')).transform === 'none'", 'slid in');
  assert.equal(await p.ev("document.activeElement?.closest('#th-tabs [role=\"tab\"]')?.dataset.tab"), 'threads', 'the focus on the selected tab');

  // its head: --bar-h tall, level with the page bar
  const head = await p.ev("(() => { const h = document.querySelector('#threads .threads-head').getBoundingClientRect(), b = document.querySelector('.pagebar').getBoundingClientRect(); return { h: h.height, hb: h.bottom, bb: b.bottom }; })()");
  assert.equal(head.h, 49, '.threads-head is 49px');
  assert.ok(Math.abs(head.hb - head.bb) <= 1, `level with .pagebar: ${JSON.stringify(head)}`);

  // the tabs: Threads, then two disabled slots, with their titles
  assert.deepEqual(await p.ev('threadsTabs.list().map((t) => [t.id, t.disabled])'), [['threads', false], ['supervisor', true], ['shell', true]]);
  const tabs = await p.ev("[...document.querySelectorAll('#th-tabs [role=\"tab\"]')].map((b) => ({ id: b.dataset.tab, sel: b.getAttribute('aria-selected'), dis: b.getAttribute('aria-disabled'), title: b.getAttribute('title'), n: b.querySelector('.n')?.className ?? null, nt: b.querySelector('.n')?.textContent ?? null, text: b.textContent }))");
  assert.deepEqual(tabs.map((x) => [x.id, x.sel, x.dis]), [['threads', 'true', null], ['supervisor', 'false', 'true'], ['shell', 'false', 'true']]);
  assert.equal(tabs[1].title, "The supervisor's terminal: the follow-on goal");
  assert.equal(tabs[2].title, 'A plain shell at the repo root: the follow-on goal');
  assert.deepEqual([tabs[0].n, tabs[0].nt], ['n blue', '2'], 'Threads counts the two your-move threads, in blue');
  assert.match(tabs[0].text, /^Threads/);

  // the split: Open 5 pressed, Resolved 2
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#th-pane [data-thf]')].map((b) => [b.dataset.thf, b.textContent.replace(/\\s+/g, ' ').trim(), b.getAttribute('aria-pressed')])"), [['open', 'Open 5', 'true'], ['resolved', 'Resolved 2', 'false']]);
  assert.equal(await p.ev("document.querySelector('#th-pane .seg').getAttribute('role') + '|' + document.querySelector('#th-pane .seg').getAttribute('aria-label')"), 'group|Which threads');

  // the five rows, each with one mark
  assert.equal(await p.ev("document.querySelectorAll('#tl-list > li > button.th-row[data-tl-open]').length"), 5, 'five rows');
  const rows = JSON.parse(await p.ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('#tl-list button.th-row')].map((r) => { const m = r.querySelectorAll('.th-st'); return [r.dataset.tlOpen, { marks: m.length, cls: m[0]?.className ?? '', role: m[0]?.getAttribute('role'), title: m[0]?.getAttribute('title'), label: m[0]?.getAttribute('aria-label'), pin: r.querySelector('.pinchip')?.textContent ?? null, s: r.querySelector('.th-s')?.textContent ?? '', w: getComputedStyle(r.querySelector('.th-w')).fontWeight, parts: [...r.children].map((c) => c.classList[0]) }]; })))`));
  const want = { [A]: ['you', 'Your move'], [B]: ['wait', 'Waiting on the supervisor'], [C]: ['ok', 'Ready to accept'], [G]: ['you', 'Your move'], [X]: ['wait', 'Waiting on the supervisor'] };
  for (const [id, [cls, words]] of Object.entries(want)) {
    const r = rows[id];
    assert.ok(r, `a row for ${id}`);
    assert.equal(r.marks, 1, `${id}: one mark`);
    assert.ok(r.cls.split(' ').includes(cls), `${id}: .th-st.${cls} (${r.cls})`);
    assert.deepEqual([r.role, r.title, r.label], ['img', words, words], `${id}: the mark says ${words}`);
    assert.deepEqual(r.parts, ['th-st', 'th-s', 'th-tm', 'th-w'], `${id}: no third line`);
  }
  assert.ok(Number(rows[A].w) >= 600, `your move: a bold headline (${rows[A].w})`);
  assert.ok(Number(rows[B].w) < 600, `waiting: a regular headline (${rows[B].w})`);
  assert.equal(rows[A].s, '', 'no "no subject" line for a subjectless thread');
  const gPin = await p.ev(`String(tPins(TL.threads).find((g) => g.ids.includes('${G}')).n)`);
  assert.equal(rows[G].pin, gPin, "G's pin number");
  assert.match(rows[G].s, /Goals/);
  assert.match(rows[X].s, / · subject gone$/);
  assert.equal(rows[X].pin, null, 'a subject gone has no pin');

  // Resolved: its two rows, the focus on the button pressed
  await p.click('#th-pane [data-thf="resolved"]');
  await soon(`location.hash === '#overview?th=resolved' && document.querySelectorAll('#tl-list button.th-row').length === 2`, 'the resolved rows');
  assert.deepEqual(await p.ev("[...document.querySelectorAll('#tl-list button.th-row')].map((r) => r.dataset.tlOpen).sort()"), [...R].sort());
  assert.equal(await p.ev("document.querySelectorAll('#tl-list .th-st, #tl-list .pinchip').length"), 0, 'no mark, no pin on a resolved row');
  await soon("document.activeElement?.matches('[data-thf=\"resolved\"]') && document.activeElement.getAttribute('aria-pressed') === 'true'", 'the focus on Resolved');
  await p.click('#th-pane [data-thf="open"]');
  await soon(`location.hash === '#overview?th=open' && !!${row(A)}`, 'Open again');

  // × closes it
  await p.click('#th-close');
  await soon(`location.hash === '#overview' && !${isOpen} && getComputedStyle(${tt}).visibility === 'visible'`, 'closed, the button back');
  await soon(`document.activeElement === ${tt}`, 'the focus back on the button');
  // the Inbox page by its redirect
  await p.ev("location.hash = '#overview?th=inbox'");
  await soon("location.hash === '#inbox' && document.querySelector('main.page > section[data-page=\"inbox\"]').classList.contains('on')", 'the Inbox page');
  await p.ev("location.hash = '#overview'");
  await soon("document.querySelector('main.page > section[data-page=\"overview\"]').classList.contains('on')", 'Overview');

  // the dock is gone
  assert.deepEqual(await p.ev("['tl-pill', 'tl-panel', 'tl-dock', 'ask-dock'].filter((id) => document.getElementById(id))"), []);

  // narrow: the panel covers the page, Shift over it shows no pin
  await size(720, 800);
  await p.click('.pagebar .tt');
  await soon(`${isOpen} && getComputedStyle(document.getElementById('threads')).transform === 'none'`, 'open at 720');
  const mid = await p.ev("(() => { const r = document.getElementById('threads').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()");
  await p.hold('Shift', true);
  await p.move(mid.x, mid.y, 8);
  await p.move(mid.x + 5, mid.y + 5, 8);
  await p.ev(FRAMES);
  assert.equal(await p.ev("document.getElementById('tl-cursor').hidden"), true, 'no pin over the panel');
  assert.equal(await p.ev(`tlHitAt(${mid.x}, ${mid.y})`), null, 'the panel is not a thread target');
  await p.hold('Shift', false);
  // a phone: the panel is the window, its × inside it, nothing sideways
  await size(390, 844);
  await soon("innerWidth === 390 && (() => { const r = document.getElementById('threads').getBoundingClientRect(); return r.left === 0 && r.top === 0 && r.width === innerWidth && r.height === innerHeight; })()", 'the panel is the window');
  assert.equal(await p.ev("(() => { const r = document.getElementById('th-close').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()"), true, '× inside it');
  assert.ok(await p.ev('document.documentElement.scrollWidth <= innerWidth'), 'no horizontal scroll');
  await size(1440, 900);

  // a count that changes doesn't take the focus off a tab
  await soon("innerWidth === 1440 && !!document.querySelector('#th-tabs [data-tab=\"threads\"]')", 'wide again');
  await p.ev("window.__tab = document.querySelector('#th-tabs [data-tab=\"threads\"]'); window.__tab.focus(); void 0");
  F.sup(['thread', 'reply', B, 'Green.']);
  await soon(`TL.threads.find((x) => x.id === '${B}').waiting === 'owner' && ${tt}.querySelector('.n.th')?.textContent === '4'`, 'the reply read, the button counting it');
  await p.ev(FRAMES);
  assert.ok(await p.ev('document.activeElement === window.__tab && window.__tab.isConnected'), 'the focus still on the same tab');
  await p.ev('window.__tab.blur()');
  await soon("document.querySelector('#th-tabs [data-tab=\"threads\"] .n')?.textContent === '3'", 'drawn once the focus left');
  await p.click('#th-close');
  await soon(`!${isOpen}`, 'closed');
});

test('the counts as threads move', { skip: SKIP, timeout: 300000 }, async (t) => {
  const F = threadsFixture('threads-counts');
  const C2 = idOf(F.owner(['thread', 'new', 'Ready one']));
  F.sup(['thread', 'reply', C2, 'Done.']);
  F.sup(['thread', 'ready', C2, '--outcome', 'done']);
  const Y1 = idOf(F.owner(['thread', 'new', 'Your move one']));
  F.sup(['thread', 'reply', Y1, 'Over to you.']);
  const Y2 = idOf(F.owner(['thread', 'new', 'Your move two']));
  F.sup(['thread', 'reply', Y2, 'Over to you too.']);
  const W = idOf(F.owner(['thread', 'new', 'Waiting one']));
  const { p, soon } = await open(t, F, '#overview');
  const n = (cls) => `document.querySelector('.pagebar .tt .n.th${cls}')?.textContent`;
  await soon(`${n('.ok')} === '3'`, 'green 3');

  // a reply sent from the composer counts at once, before any read of the threads lands
  await p.ev(`tlOpen('${Y1}')`);
  await soon(`document.getElementById('tl-card').dataset.key === '${Y1}' && !!document.getElementById('tl-c-text')`, "Y1's card");
  await p.ev('window.__threadsQueue = []; void 0');
  await p.ev("document.getElementById('tl-c-text').focus()");
  await p.type('my answer');
  await p.key('Enter', 8);
  await soon(`${n('.ok')} === '2'`, 'green 2 with the reads held');
  assert.ok(await p.ev('window.__threadsQueue.length >= 0 && TL.pend.length > 0'), 'the send still pending on the page');
  await p.ev('const q = window.__threadsQueue; window.__threadsQueue = null; q.forEach((go) => go()); void 0');
  await until(() => JSON.parse(F.owner(['thread', 'show', Y1, '--json'])).turns.some((u) => u.text === 'my answer'), 'the turn on the server');
  await p.ev('tlClose()');

  // the ready one accepted: blue, counting the your-move ones
  F.owner(['thread', 'resolve', C2, '--accept']);
  await soon(`${n('.you')} === '1'`, 'blue 1');
  // that one answered: grey, counting the open threads; Threads' tab has no number
  F.owner(['thread', 'say', Y2, 'Noted.']);
  await soon(`${n('.wait')} === '3'`, 'grey 3');
  await p.click('.pagebar .tt');
  await soon("document.body.classList.contains('threads-open') && !!document.querySelector('#th-tabs [data-tab=\"threads\"]')", 'the panel');
  assert.equal(await p.ev("document.querySelector('#th-tabs [data-tab=\"threads\"] .n')"), null, 'no number on Threads');
  assert.equal(await p.ev("document.querySelector('.pagebar .tt').getAttribute('title')"), '3 waiting on the supervisor');
  // none open: no thread count
  for (const id of [Y1, Y2, W]) F.owner(['thread', 'resolve', id]);
  await soon("!document.querySelector('.pagebar .tt .n.th') && /No open threads\\. Hold Shift and click anything on the page, or start one with \\+\\./.test(document.getElementById('th-pane').textContent)", 'no thread count, the empty line');
  await p.click('#th-close');
  await soon("!document.body.classList.contains('threads-open')", 'closed');
});
