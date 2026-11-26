// The ask before a close (kit-937, spec §Acceptance checks A1-A7): closing the viewer by a way it owns (X, a
// click on the scrim, Escape from the dashboard or from the frame) while the bar's Hand over (N) names notes
// nobody handed over keeps the viewer up and asks first (#av-ask). Headless Chrome against a real dashboard
// on kit-141's harness (fixtures/artifact-viewer/harness.mjs), skipped where Chrome can't be driven.
//
// A1 is the owner's own path (u-20261126-001926632-owner): the dashboard inside hub.html's project frame, a
// two-page artifact landed on main with open notes, in-frame link moves and a link back, then each close. The
// hub frames only dashboards on the ports it scans (its page's frame-src), so a second dashboard of the
// fixture runs on one of them, and the hub the first one serves (the block's hub port) frames it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canDrive } from './lib/chrome.mjs';
import { harness, J, FRAMES, VIEWER_UP, CLOSED } from './fixtures/artifact-viewer/harness.mjs';
import { oneHarness } from './lib/browser-fixture.mjs';
import { PORTS, startDashboard, until } from './lib/kit.mjs';

const SKIP = canDrive ? false : 'needs Chrome and a Node with WebSocket';
const H = oneHarness(harness, 'artifact-close-ask', SKIP);

// A page of the two-page artifact: a link to the other page, and its own word of where the link is (as
// the harness's fixtures say it), so V.frameClick can press it.
const PAGE = (me, other, title) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body { margin: 0; font: 16px/1.4 sans-serif; } #to-${other} { position: absolute; display: block; box-sizing: border-box; left: 40px; top: 160px; width: 160px; height: 32px; }</style></head>
<body><h1>${title}</h1><a id="to-${other}" href="${other === 'a' ? 'index.html' : 'b.html'}">To ${other}</a>
<script>
const rects = () => { const r = document.getElementById('to-${other}').getBoundingClientRect(); return { 'to-${other}': { x: r.left, y: r.top, w: r.width, h: r.height } }; };
const say = () => parent.postMessage({ own: 'at', page: 'two-pages/${me === 'a' ? 'index' : 'b'}.html', hash: location.hash, rects: rects() }, '*');
addEventListener('load', () => { say(); requestAnimationFrame(() => requestAnimationFrame(say)); });
addEventListener('resize', say);
</script></body></html>`;

// The ask: up (drawn, not hidden), and what it says
const ASK = "(() => { const d = document.getElementById('av-ask'); return !!d && !d.hidden && d.getBoundingClientRect().height > 0; })()";
const ASKS = `(() => { const d = document.getElementById('av-ask'); if (!d) return null; return {
  shown: ${ASK}, role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'),
  head: document.getElementById('av-ask-h')?.textContent ?? null, tx: document.getElementById('av-ask-tx')?.textContent ?? null,
  buttons: [...d.querySelectorAll('button')].map((b) => b.textContent), err: document.getElementById('e-ava')?.textContent ?? '',
  focus: document.activeElement?.id ?? null, focusIn: d.contains(document.activeElement), up: ${VIEWER_UP} }; })()`;
// kit-148's card, and its words
const REMIND = "(() => { const r = document.getElementById('av-remind'); return !!r && !r.hidden && r.getBoundingClientRect().height > 0; })()";
const CARD = "(() => { const r = document.getElementById('av-remind'); return { shown: " + REMIND + ", tx: r?.querySelector('.tx')?.textContent ?? null, later: document.getElementById('av-remind-later')?.textContent ?? null, err: document.getElementById('e-avr')?.textContent ?? '' }; })()";
const POSTS = "window.__posts.filter((p) => p.action === 'artifact-handoff').map((p) => p.body)";
const HELD = "(() => { const e = document.getElementById('av-held'); return !!e && !e.hidden && e.textContent === 'That moved just now. Press again in a second.'; })()";
const BUTTONS = ['Keep annotating', "I'll come back", 'Hand over and close'];

test('the ask before a close', { skip: SKIP, timeout: 1500000 }, async (t) => {
  const { F, PV, visit, sub } = await H(t);

  // two-pages landed on main, with three open notes (two on index.html, one on b.html)
  const art = (root) => {
    const dir = path.join(root, 'docs/devteam/project/artifacts/two-pages');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'artifact.json'), J({ v: 1, title: 'Two pages', summary: 'Two pages that link to each other', by: 'supervisor', for: [] }));
    fs.writeFileSync(path.join(dir, 'index.html'), PAGE('a', 'b', 'Page A'));
    fs.writeFileSync(path.join(dir, 'b.html'), PAGE('b', 'a', 'Page B'));
    return dir;
  };
  art(F.old);
  F.g(['add', '-A', 'docs'], F.old);
  F.g(['commit', '-qm', 'artifact two-pages'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  let spot = 0;
  const note = (at, p = 'index.html', title = 'A note') => {
    spot++;
    return F.owner(['thread', 'new', title, '--subject', J({ kind: 'artifact', slug: 'two-pages', at, path: p, point: { x: 20 + (spot % 40) * 9, y: 20 + Math.floor(spot / 40) * 9 } })]).split('\n')[0].trim();
  };
  const MAIN = [note('main'), note('main'), note('main', 'b.html')];
  // a draft of two-pages in the fixture's worktree w (one byte of its own, so the Library lists it) and n notes on it
  const version = (w, n) => {
    const dir = art(path.join(F.old, '.worktrees', w));
    fs.appendFileSync(path.join(dir, 'index.html'), `\n<!-- the draft in ${w} -->\n`);
    return Array.from({ length: n }, () => note(w));
  };
  const V_PLAN = version('plan-ask', 2);
  version('ask-one', 1);
  version('ask-guard', 2);
  version('ask-refuse', 2);
  const V_HOLD = version('ask-hold', 2);
  const V_HOLD2 = version('ask-hold2', 2);
  version('ask-keep', 2);
  version('ask-vo', 2);
  version('ask-narrow', 2);
  version('ask-moved', 2);

  // The viewer opened on two-pages at w (main, or a draft), up, its lens ready and its notes read.
  const openAt = async (V, w, ids = []) => {
    await V.p.ev(`location.hash = ${J(w === 'main' ? '#artifact/main/two-pages' : `#artifact/wt/${w}/two-pages`)}; void 0`);
    await V.soon(`${VIEWER_UP} && TS.kind === 'artifact' && TS.slug === 'two-pages' && TS.at === ${J(w)} && TS.ready && TL.have > 0`, `setup: the viewer up on two-pages@${w}`);
    if (ids.length) { await V.p.ev('tlRefresh(); void 0'); await V.soon(`${J(ids)}.every((id) => TL.threads.some((t) => t.id === id))`, `setup: the page has read ${ids.join(', ')}`); }
    await V.soon("!document.getElementById('av-handover').hidden", 'setup: the bar shows Hand over');
    await V.p.ev(FRAMES);
  };
  // Every fetch through a wrapper: POST bodies in __posts; a stub per action (window.__stub[action] = {status, body, ms}).
  const wrap = (V) => V.p.ev(`(() => {
    if (window.__wrapped) return true;
    window.__wrapped = true; window.__posts = []; window.__stub = {};
    const f = window.fetch.bind(window);
    window.fetch = async (u, o = {}) => {
      if ((o.method || 'GET').toUpperCase() !== 'POST') return f(u, o);
      let body = null; try { body = JSON.parse(o.body); } catch {}
      const action = String(u).replace(/^.*\\/api\\//, '').split('?')[0];
      window.__posts.push({ action, body });
      const s = window.__stub[action];
      if (!s) return f(u, o);
      if (s.ms) await new Promise((r) => setTimeout(r, s.ms));
      return new Response(JSON.stringify(s.body), { status: s.status || 200, headers: { 'content-type': 'application/json' } });
    };
    return true;
  })()`);
  // a real press on the dashboard's element #id, at its centre, uncovered
  const centre = (V, id) => V.p.ev(`(() => { const b = document.getElementById(${J(id)}); if (!b) return null; const r = b.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2; return { x, y, top: !!document.elementFromPoint(x, y)?.closest('#' + ${J(id)}) }; })()`);
  const pressId = async (V, id) => {
    const at = await centre(V, id);
    assert.ok(at, `setup: #${id} is not in the page`);
    assert.ok(at.top, `setup: #${id} is covered`);
    await V.press(at.x, at.y, id);
  };
  // a press on a control kit-145's guard holds, once the guard says it has settled (as kit-148's R4b does)
  const ARMED = (id) => `(() => { const el = document.getElementById(${J(id)}); return !!el && performance.now() - avStep.press.last <= 250 && [...avStep.press.seen.values()].some((r) => r.el === el && avStep.settled(r)); })()`;
  const pressArmed = async (V, id) => {
    for (let k = 0; k < 6; k++) {
      await V.soon(ARMED(id), `setup: #${id} settled, by kit-145's press guard`);
      const at = await centre(V, id);
      assert.ok(at.top, `setup: #${id} is covered`);
      const n = await V.p.ev('window.__clicks.length');
      await V.p.move(at.x, at.y);
      await V.p.clickAt(at.x, at.y);
      if (await V.settle(`window.__clicks.slice(${n}).includes(${J(id)})`, 1500)) return;
      t.diagnostic(`the press on #${id} once settled never reached the page: pressed again once it settles`);
    }
    assert.fail(`setup: six presses on #${id}, each once it had settled, never reached the page`);
  };
  // A close the viewer owns, as the owner makes it; then the ask, up within 3 s, read
  const askedBy = async (V, kind, what) => {
    await V.close(kind);
    await V.settle(ASK, 3000);
    const s = await V.p.ev(ASKS);
    assert.ok(s?.shown, `${what}: #av-ask is not shown after ${kind} (the viewer ${(await V.p.ev(CLOSED)) ? 'closed' : 'is up'})`);
    return s;
  };
  const noAsk = async (V, what) => { await V.settle(ASK, 1000); assert.equal(await V.p.ev(ASK), false, `${what}: #av-ask is shown`); };
  const noCard = async (V, what) => { await V.settle(REMIND, 1000); assert.equal(await V.p.ev(REMIND), false, `${what}: kit-148's card is shown`); };
  const MAIN_TX = "3 notes on Two pages aren't handed over yet. The supervisor won't start on them until you do.";

  // ---- A1: the owner's path, in the hub's frame ----
  // a second dashboard on a port of the block the hub scans, so the hub frames it
  let hd = null, hport = 0;
  for (let k = 1; k <= 25 && !hd; k++) {
    const d = startDashboard(F.old, F.env({}), ['--port', String(PORTS + k)]);
    await until(() => /dashboard on http/.test(d.out()) || d.p.exitCode !== null || d.p.signalCode !== null, 'a dashboard in the hub block');
    if (/dashboard on http/.test(d.out())) { hd = d; hport = PORTS + k; } else await d.stop();
  }
  assert.ok(hd, 'setup: a dashboard on a port the hub scans');
  t.after(() => hd.stop());
  const IN_HUB = `http://127.0.0.1:${hport}`, HUB = `http://127.0.0.1:${PORTS}`;
  const name = await until(async () => {
    const l = await fetch(`${HUB}/instances.json`, { headers: { 'sec-fetch-site': 'same-origin' } }).then((r) => r.json()).catch(() => null);
    return l?.instances?.find((x) => Number(x.port) === hport)?.name ?? null;
  }, 'the hub listing the second dashboard');
  const inHub = (w = 1534, h = 740) => visit('#library', { hub: `${HUB}/#${encodeURIComponent(name)}/library`, inHub: IN_HUB, width: w, height: h });
  // in the frame: index -> b -> index -> b -> index, by the pages' own links (two moves out, and the link back, twice)
  const moves = async (V) => {
    for (const [id, to] of [['to-b', 'b.html'], ['to-a', 'index.html'], ['to-b', 'b.html'], ['to-a', 'index.html']]) await V.frameClick(id, `two-pages/${to}`);
  };

  for (const kind of ['x', 'scrim', 'escape-dash', 'escape-frame']) {
    await sub(`A1: in the hub's frame, ${kind} after in-frame moves asks first`, async () => {
      const V = await inHub();
      assert.equal(await V.p.ev('window !== top'), true, "setup: the dashboard is in the hub's frame");
      await openAt(V, 'main', MAIN);
      await moves(V);
      const s = await askedBy(V, kind, `A1 ${kind}`);
      assert.equal(s.up, true, `A1 ${kind}: the viewer stays open`);
      assert.deepEqual([s.role, s.modal], ['alertdialog', 'true'], `A1 ${kind}: role alertdialog, aria-modal`);
      assert.equal(s.head, 'Close without handing over?', `A1 ${kind}: its heading`);
      assert.equal(s.tx, MAIN_TX, `A1 ${kind}: its words`);
      assert.deepEqual(s.buttons, BUTTONS, `A1 ${kind}: its buttons`);
      assert.equal(s.focus, 'av-ask-keep', `A1 ${kind}: the focus on its first button`);
      // Tab and Shift+Tab go round inside it
      const seen = [];
      for (let i = 0; i < 4; i++) { await V.p.key('Tab'); seen.push(await V.p.ev('document.activeElement?.id ?? null')); }
      await V.p.key('Tab', 8);
      seen.push(await V.p.ev('document.activeElement?.id ?? null'));
      assert.deepEqual(seen, ['av-ask-later', 'av-ask-hand', 'av-ask-keep', 'av-ask-later', 'av-ask-keep'], `A1 ${kind}: the focus kept inside`);
    });
  }
  await sub("A1: in the hub's frame, Back with no move closes and shows kit-148's card", async () => {
    const V = await inHub();
    await openAt(V, 'main', MAIN);
    await V.p.ev('history.back(); void 0');
    await V.settle(CLOSED, 3000);
    assert.equal(await V.p.ev(CLOSED), true, 'A1 back: the viewer closed');
    await V.settle(REMIND, 3000);
    const c = await V.p.ev(CARD);
    assert.ok(c.shown, "A1 back: kit-148's card is shown");
    assert.equal(c.later, "I'll come back", "A1 back: the card's I'll come back");
    await noAsk(V, 'A1 back');
  });

  // ---- A2: the words, by count and recipient ----
  await sub('A2: one note and the supervisor; two and a planner', async () => {
    const V = await visit('#library');
    await openAt(V, 'ask-one');
    let s = await askedBy(V, 'x', 'A2 one');
    assert.equal(s.tx, "1 note on Two pages isn't handed over yet. The supervisor won't start on it until you do.", 'A2: one note, the supervisor');
    await pressId(V, 'av-ask-keep');
    await openAt(V, 'plan-ask', V_PLAN);
    s = await askedBy(V, 'x', 'A2 planner');
    assert.equal(s.tx, "2 notes on Two pages aren't handed over yet. plan-ask, the session drawing it, won't start on them until you do.", 'A2: two notes, the draft\'s planner');
  });

  // ---- A3: Hand over and close ----
  await sub('A3: Hand over and close hands over, then closes as the X does, and the closed page says With <session>', async () => {
    // after a move: the close replaces the entry (kit-141); with none: it steps back
    for (const moved of [false, true]) {
      const V = await visit('#library');
      await openAt(V, moved ? 'ask-moved' : 'plan-ask', moved ? [] : V_PLAN);
      if (moved) await V.frameClick('to-b', 'two-pages/b.html');
      await wrap(V);
      await askedBy(V, 'x', `A3 ${moved ? 'moved' : 'plain'}`);
      const len = await V.before();
      await pressArmed(V, 'av-ask-hand');
      const s = await V.closedOn('#library', `A3 ${moved ? 'after a move' : 'unmoved'}`);
      assert.deepEqual(await V.p.ev(POSTS), [{ slug: 'two-pages', at: moved ? 'ask-moved' : 'plan-ask' }], `A3 ${moved ? 'moved' : 'plain'}: one post, the bar's {slug, at}`);
      assert.deepEqual([s.backs, s.leaveReplaces, s.length], moved ? [0, 1, len] : [1, 0, len], `A3 ${moved ? 'moved' : 'plain'}: kit-141's close (${moved ? 'the entry replaced' : 'one step back'}), the history as before`);
      await V.settle(`${REMIND} && document.querySelector('#av-remind .tx').textContent.startsWith('With ')`, 3000);
      const c = await V.p.ev(CARD);
      assert.equal(c.tx, moved ? 'With supervisor' : 'With plan-ask', `A3 ${moved ? 'moved' : 'plain'}: the closed page says With <session>`);
      await noAsk(V, `A3 ${moved ? 'moved' : 'plain'}`);
    }
    for (const id of V_PLAN) assert.equal(JSON.parse(F.owner(['thread', 'show', id, '--json'])).handed?.to, 'plan-ask', `A3: ${id} handed to plan-ask`);
  });
  await sub('A3: a refused hand-over shows its error in the ask; the viewer stays and the frame Escape asks again', async () => {
    const V = await visit('#library');
    await openAt(V, 'ask-refuse');
    await wrap(V);
    await V.p.ev("window.__stub['artifact-handoff'] = { status: 400, body: { error: 'the log is busy' } }; void 0");
    await V.close('escape-frame');
    await V.settle(ASK, 3000);
    assert.equal(await V.p.ev('AV_FRAME_ESC'), true, 'setup: A3 the frame Escape set AV_FRAME_ESC');
    await pressArmed(V, 'av-ask-hand');
    await V.settle("document.getElementById('e-ava')?.textContent === 'Not saved: the log is busy'", 3000);
    const s = await V.p.ev(ASKS);
    assert.equal(s.err, 'Not saved: the log is busy', 'A3: the refusal in the ask');
    assert.equal(s.up, true, 'A3: the viewer stays open');
    assert.equal(await V.p.ev('AV_FRAME_ESC'), false, 'A3: AV_FRAME_ESC cleared');
  });

  // ---- A4: Hand over and close under kit-145's press guard ----
  await sub('A4: a press as a frame Escape raises the ask hands nothing over; once settled it does', async () => {
    const V = await visit('#library');
    await openAt(V, 'ask-guard');
    await wrap(V);
    await V.p.ev("window.__stub['artifact-handoff'] = { status: 200, body: { to: 'supervisor', typed: true, count: 2 } }; void 0");
    await V.frameEscape();
    await V.settle(ASK, 2000);
    const since = await V.p.ev('performance.now()');
    const at = await centre(V, 'av-ask-hand');
    assert.ok(at?.top, 'setup: A4 #av-ask-hand is up and uncovered');
    await V.p.clickAt(at.x, at.y);
    assert.ok((await V.p.ev('performance.now()')) - since < await V.p.ev('ASK_ARM_MS'), 'setup: A4 the press came within the settle time');
    await V.settle(HELD, 2000);
    await V.p.ev(FRAMES);
    assert.deepEqual(await V.p.ev(POSTS), [], 'A4: a press at once hands nothing over');
    assert.equal(await V.p.ev(HELD), true, "A4: it says the guard's words");
    assert.equal(await V.p.ev(ASK), true, 'A4: the ask stays');
    await pressArmed(V, 'av-ask-hand');
    await V.soon("window.__posts.some((p) => p.action === 'artifact-handoff')", 'A4: the settled press posted');
    assert.deepEqual(await V.p.ev(POSTS), [{ slug: 'two-pages', at: 'ask-guard' }], 'A4: once settled, one post');
  });

  // ---- A5: I'll come back and the hold; Keep annotating, Escape and a click outside ----
  await sub("A5: I'll come back closes and holds; a new note or one sent back asks again", async () => {
    const V = await visit('#library');
    await wrap(V);
    await openAt(V, 'ask-hold', V_HOLD);
    await askedBy(V, 'x', 'A5 first');
    await pressId(V, 'av-ask-later');
    await V.closedOn('#library', "A5 I'll come back");
    await noCard(V, "A5 I'll come back");
    await openAt(V, 'ask-hold');
    await V.close('x');
    await V.closedOn('#library', 'A5 held');
    await noAsk(V, 'A5 held');
    // a new note
    const C = note('ask-hold');
    await openAt(V, 'ask-hold', [C]);
    let s = await askedBy(V, 'x', 'A5 a new note');
    assert.match(s.tx, /^3 notes on Two pages aren't handed over yet\./, 'A5: a new note asks again');
    await pressId(V, 'av-ask-later');
    await V.closedOn('#library', "A5 I'll come back again");
    // handed from the bar, then a reply sends one back
    await openAt(V, 'ask-hold');
    await pressArmed(V, 'av-handover');
    await V.soon(`${J([...V_HOLD, C])}.every((id) => TL.threads.find((t) => t.id === id)?.handed)`, 'setup: A5 handed from the bar');
    F.owner(['thread', 'say', V_HOLD[0], 'Not quite: bigger still']);
    await V.p.ev('tlRefresh(); void 0');
    await V.soon(`TL.threads.find((t) => t.id === ${J(V_HOLD[0])})?.handed == null`, 'setup: A5 the reply sent it back');
    s = await askedBy(V, 'x', 'A5 sent back');
    assert.match(s.tx, /^1 note on Two pages isn't handed over yet\./, 'A5: a note sent back asks again');
    assert.deepEqual(await V.p.ev("[...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => /remind|ask/i.test(k))"), [], 'A5: nothing stored');
  });
  await sub("A5: Hand over and close ends the hold; a close the owner answered goes ahead though a note came meanwhile", async () => {
    const V = await visit('#library');
    await wrap(V);
    await openAt(V, 'ask-hold2', V_HOLD2);
    await askedBy(V, 'x', 'A5b first');
    await pressId(V, 'av-ask-later');
    await V.closedOn('#library', "A5b I'll come back");
    // a new note: asked again, and handed over from the ask
    const C = note('ask-hold2');
    await openAt(V, 'ask-hold2', [C]);
    await askedBy(V, 'x', 'A5b a new note');
    await pressArmed(V, 'av-ask-hand');
    await V.closedOn('#library', 'A5b Hand over and close');
    await V.soon(`${J([...V_HOLD2, C])}.every((id) => TL.threads.find((t) => t.id === id)?.handed)`, 'setup: A5b handed from the ask');
    // a reply sends one back: the hold ended with the hand-over, so it is asked about
    F.owner(['thread', 'say', V_HOLD2[0], 'Not quite: smaller']);
    await openAt(V, 'ask-hold2');
    await V.p.ev('tlRefresh(); void 0');
    await V.soon(`TL.threads.find((t) => t.id === ${J(V_HOLD2[0])})?.handed == null`, 'setup: A5b the reply sent it back');
    const s = await askedBy(V, 'x', 'A5b sent back after Hand over and close');
    assert.match(s.tx, /^1 note on Two pages isn't handed over yet\./, 'A5b: a note sent back after Hand over and close asks again');
    // a note added while the ask is up: I'll come back still closes
    const D = note('ask-hold2');
    await V.p.ev('tlRefresh(); void 0');
    await V.soon(`TL.threads.some((t) => t.id === ${J(D)})`, 'setup: A5b the page read a note added while the ask is up');
    await pressId(V, 'av-ask-later');
    await V.closedOn('#library', "A5b I'll come back with a note added meanwhile");
    await noAsk(V, 'A5b answered');
  });
  await sub('A5: Keep annotating, Escape on the ask and a click outside it take it away; the viewer stays, and the frame Escape asks again', async () => {
    const V = await visit('#library');
    await wrap(V);
    await openAt(V, 'ask-keep');
    const away = async (how) => {
      await V.before();
      if (how === 'keep') await pressId(V, 'av-ask-keep');
      else if (how === 'escape') await V.p.key('Escape');
      else if (how === 'veil') {
        const p = await V.p.ev("(() => { const d = document.getElementById('av-ask').getBoundingClientRect(), i = document.querySelector('.av-ask-in').getBoundingClientRect(); return { x: d.left + 8, y: (d.top + i.top) / 2 }; })()");
        await V.press(p.x, p.y, 'av-ask');
      } else if (how === 'scrim') await V.press(6, 400, 'scrim');
      await V.settle(`!${ASK}`, 2000);
      const s = await V.state();
      assert.equal(await V.p.ev(ASK), false, `A5 ${how}: the ask is gone`);
      assert.equal(s.open, true, `A5 ${how}: the viewer stays open`);
      assert.deepEqual([s.backs, s.leaveReplaces, s.hash], [0, 0, '#artifact/wt/ask-keep/two-pages'], `A5 ${how}: nothing closed it`);
      assert.equal(await V.p.ev('AV_FRAME_ESC'), false, `A5 ${how}: AV_FRAME_ESC cleared`);
      assert.deepEqual(await V.p.ev(POSTS), [], `A5 ${how}: nothing handed over`);
      await noCard(V, `A5 ${how}`);
    };
    for (const how of ['keep', 'escape', 'veil', 'scrim']) {
      // raised by the frame's Escape each time: a later one asks again
      await V.frameEscape();
      assert.ok(await V.settle(ASK, 2000), `A5 before ${how}: the frame Escape asks`);
      await away(how);
    }
    // raised by the dashboard's own Escape, Escape again takes it away
    await V.focusBody();
    await V.p.key('Escape');
    assert.ok(await V.settle(ASK, 2000), "A5: the dashboard's Escape asks");
    await away('escape');
  });

  // ---- A6: a close the page can't stop, and a viewer replaced ----
  await sub("A6: a link closes at once and shows kit-148's card with I'll come back, which holds; another artifact or a preview asks nothing", async () => {
    const V = await visit('#library');
    await openAt(V, 'main', MAIN);
    await V.p.ev("location.hash = '#board'; void 0");
    await V.settle(CLOSED, 3000);
    assert.equal(await V.p.ev(CLOSED), true, 'A6 link: the viewer closed');
    await V.settle(REMIND, 3000);
    const c = await V.p.ev(CARD);
    assert.ok(c.shown, "A6 link: kit-148's card");
    assert.equal(c.later, "I'll come back", "A6 link: its I'll come back");
    await pressId(V, 'av-remind-later');
    await openAt(V, 'main');
    await V.close('x');
    await V.closedOn('#board', "A6: held by the card's I'll come back");
    await noAsk(V, 'A6 held');
    const W = await visit('#library');
    await openAt(W, 'ask-narrow');
    await W.open('#artifact/main/viewer-b');
    await noAsk(W, 'A6 another artifact');
    await noCard(W, 'A6 another artifact');
    await W.open(PV);
    await noAsk(W, 'A6 a preview');
    await noCard(W, 'A6 a preview');
  });

  // ---- A7: nothing to ask about, view only, and 375 px ----
  await sub('A7: no open notes, all handed or a preview: no ask, the viewer closes', async () => {
    const V = await visit('#library');
    // viewer-b has no notes; viewer-a's two are handed over (the harness)
    for (const head of ['#artifact/main/viewer-b', '#artifact/main/viewer-a', PV]) {
      await V.open(head);
      await V.close('x');
      await V.closedOn('#library', `A7 ${head}`);
      await noAsk(V, `A7 ${head}`);
    }
  });
  await sub("A7: view only gets the ask; Hand over and close says View only's words and hands nothing over; the other two work", async () => {
    const V = await visit('#library');
    await wrap(V);
    // (kept at view through the page's polls, as kit-145's A24 does)
    await V.p.ev("window.__vo = viewOnly; viewOnly = () => window.__vo('view'); viewOnly(); void 0");
    await V.soon("document.body.classList.contains('view-only')", 'setup: A7 view only');
    await openAt(V, 'ask-vo');
    await askedBy(V, 'x', 'A7 view only');
    await pressArmed(V, 'av-ask-hand');
    await V.settle("document.getElementById('view-only-toast')?.textContent === 'View only: you can look, but not change anything'", 2000);
    assert.equal(await V.p.ev("document.getElementById('view-only-toast')?.hidden === false && document.getElementById('view-only-toast').textContent"), 'View only: you can look, but not change anything', "A7: View only's words");
    assert.deepEqual(await V.p.ev(POSTS), [], 'A7: view only hands nothing over');
    assert.equal(await V.p.ev(`${ASK} && ${VIEWER_UP}`), true, 'A7: the ask and the viewer stay');
    await pressId(V, 'av-ask-keep');
    await V.settle(`!${ASK}`, 2000);
    assert.equal(await V.p.ev(`!${ASK} && ${VIEWER_UP}`), true, 'A7 view only: Keep annotating works');
    await askedBy(V, 'x', 'A7 view only again');
    await pressId(V, 'av-ask-later');
    await V.closedOn('#library', "A7 view only: I'll come back closes");
  });
  await sub('A7: at 375 px the ask fits, with no horizontal scroll', async () => {
    const V = await visit('#library', { width: 375, height: 700 });
    await openAt(V, 'ask-narrow');
    await askedBy(V, 'x', 'A7 375');
    const box = await V.p.ev("(() => { const r = document.querySelector('#av-ask .av-ask-in').getBoundingClientRect(); const b = [...document.querySelectorAll('#av-ask button')].map((x) => x.getBoundingClientRect()); return { l: r.left, r: r.right, w: innerWidth, sw: document.scrollingElement.scrollWidth, bl: Math.min(...b.map((x) => x.left)), br: Math.max(...b.map((x) => x.right)) }; })()");
    assert.ok(box.l >= 0 && box.r <= box.w && box.bl >= box.l && box.br <= box.r, `A7: the ask ${J(box)} inside the window`);
    assert.ok(box.sw <= box.w, `A7: no horizontal scroll (${J(box)})`);
  });
});
