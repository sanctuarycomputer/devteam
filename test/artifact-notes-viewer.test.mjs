// kit-145: the viewer's Hand over, the note stepper, to-check cards, the picture and Show me. The
// viewer reads kit-143's note fields from /api/threads and draws them; it computes no state and no
// version of its own. Checked in headless Chrome on the kit-141 harness
// (fixtures/artifact-viewer/harness.mjs) with an artifact of this file's own, `pricing`, written by the
// test (on main and in three worktrees); /api/threads and the two new actions stubbed in the page from
// kit-143's fixture rows (the view block of test/fixtures/artifact-notes/<case>/expected.json: what
// /api/threads gives once kit-144 folds the marks); the pictures planted where kit-147's /api/shot/ route
// reads them. The lens's arrow keys are checked in vm. Skipped where Chrome can't be driven, as the kit's
// other Chrome tests are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { kit } from './lib/kit.mjs';
import { canDrive } from './lib/chrome.mjs';
import { J, FRAMES, VIEWER_UP, CLOSED } from './fixtures/artifact-viewer/harness.mjs';
import { notes, HTML, AT, SHOT, ADDR, ROW, READY_AT, withFrame, V_C11, V_C12, NEWER } from './fixtures/artifact-notes-viewer/kit.mjs';

const SRC = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
const LENS = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(SRC)[1];
const ANCESTOR = 'http://127.0.0.1:4321';

// --- the lens in vm (kit-142's stand-in page, cut to what the keys need) -----------------------------
function lens() {
  const listeners = {};
  const posted = [];
  const timers = [];
  const parent = { postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) };
  const location = { pathname: '/artifact/main/pricing/index.html', hash: '', ancestorOrigins: [ANCESTOR] };
  const body = { nodeType: 1, localName: 'body' };
  const doc = { title: 'A mock', documentElement: {}, body, activeElement: body, elementFromPoint: () => null, querySelectorAll: () => [], querySelector: () => null, getElementsByTagName: () => [], getElementById: () => null };
  const win = {
    document: doc, parent, location, innerWidth: 800, innerHeight: 600,
    history: { pushState() {}, replaceState() {} },
    addEventListener: (type, f) => { (listeners[type] ??= []).push(f); },
    setInterval: () => 0, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {}, requestAnimationFrame: () => 0,
    getComputedStyle: () => ({ visibility: 'visible', overflowX: '', overflowY: '' }),
    MutationObserver: class { observe() {} }, TextEncoder, CSS: { escape: (s) => s },
  };
  win.window = win;
  vm.runInNewContext(LENS, win);
  // one event through every listener (capture and bubble alike, in the order they were added); the event
  // is returned, so a test can mark it taken (as a page's own handler would) before the timers run
  const fire = (type, ev = {}) => { const e = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...ev }; for (const f of listeners[type] ?? []) f(e); return e; };
  const run = () => { for (const f of timers.splice(0)) f(); };
  const hear = (m) => fire('message', { data: { lens: 1, ...m }, source: parent, isTrusted: true, origin: ANCESTOR });
  const keys = () => posted.filter((m) => m.type === 'key');
  return { doc, body, fire, hear, keys, run };
}

test('A7b: the lens tells ArrowLeft and ArrowRight with nothing of the page focused, once the page has not taken the key', () => {
  const L = lens();
  const press = (key, { focus = L.body, taken = false } = {}) => { L.doc.activeElement = focus; const e = L.fire('keydown', { key, shiftKey: false, target: focus ?? L.body }); if (taken) e.preventDefault(); L.run(); };
  press('ArrowRight');
  assert.equal(L.keys().length, 0, 'nothing before hello');
  L.hear({ type: 'hello' });
  press('ArrowRight');
  assert.deepEqual(L.keys().map((m) => [m.key, m.shift]), [['ArrowRight', false]], 'the lens tells ArrowRight after hello');
  press('ArrowLeft', { focus: null });
  for (const focus of [{ nodeType: 1, localName: 'input', type: 'text' }, { nodeType: 1, localName: 'input', type: 'radio' }, { nodeType: 1, localName: 'select' }, { nodeType: 1, localName: 'button' }]) press('ArrowRight', { focus });
  press('ArrowRight', { taken: true });
  assert.deepEqual(L.keys().map((m) => m.key), ['ArrowRight', 'ArrowLeft'], 'one more for ArrowLeft; none with a control of the page focused or for a key the page took');
});

test('A7b: tLensMessage keeps the arrows and maps any other key as today', () => {
  const src = /\nfunction tLensMessage\(e, frameWin, minted\) \{[\s\S]*?\n\}\n/.exec(HTML)[0];
  const ctx = { T_LENS_SAYS: ['ready', 'route', 'hit-reply', 'rects', 'key', 'errors', 'nav'], T_UNSAFE: /[\u0000-\u001f\u202a-\u202e]/g, tCut: (s) => s, tUncap: (s) => s, tLine: (s) => s, tBox: () => null, tAnchor: () => null, T_CAPS: { path: 300, route: 300 }, T_ERRORS: 5, T_ERROR_MAX: 300 };
  vm.runInNewContext(`${src}; this.f = tLensMessage;`, ctx);
  const w = {};
  const of = (key) => ctx.f({ source: w, data: { lens: 1, type: 'key', key, shift: false } }, w, new Set())?.key;
  assert.deepEqual([of('ArrowRight'), of('ArrowLeft')], ['ArrowRight', 'ArrowLeft'], 'the arrows pass');
  assert.deepEqual([of('Escape'), of('Shift'), of('Enter')], ['Escape', 'Shift', 'Shift'], 'any other key as today');
});

test('A21: --av-measure in css-viewer; no ch width in css-viewer or css-threads', () => {
  const part = (n) => new RegExp(`/\\* ${n} start \\*/([\\s\\S]*?)/\\* ${n} end \\*/`).exec(HTML)?.[1] ?? '';
  assert.match(part('css-viewer'), /--av-measure:\s*calc\(\(var\(--page-max, 1200px\) - 2 \* var\(--page-pad, 32px\) - 11 \* var\(--gap, 16px\)\) \/ 2 \+ 5 \* var\(--gap, 16px\)\)/, '--av-measure defined in css-viewer');
  for (const n of ['css-viewer', 'css-threads']) assert.doesNotMatch(part(n), /\b\d+(\.\d+)?ch\b/, `no ch width in ${n}`);
});

// --- the viewer, in Chrome ---------------------------------------------------------------------------
test('the viewer: Hand over, the stepper, the cards, the picture and Show me', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const X = await notes(t, 'artifact-notes-viewer');
  const { sub } = X;
  const { N, AV_WT, plant, openAt, shown, text, has, tabOf, cardOf, holdPoll, ARMED, at, press, settled, spot, AV_MAIN } = X;
  await sub('A1: Hand over (N) counts the open notes and is absent at 0', async () => {
    const V = await tabOf({ [N.trial]: ROW.C20(), [N.plans]: ROW.C20(), [N.annual]: ROW.C1() });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-handover', 'two open, one handed');
    assert.equal(await V.p.ev(text('#av-handover')), 'Hand over (2)', 'the pill counts the open notes only');
    await V.rows({ [N.trial]: ROW.C1(), [N.plans]: ROW.C1(), [N.annual]: ROW.C1() });
    assert.ok(await V.settle(`!${shown('#av-handover')}`, 4000), 'with none open the pill is hidden');
  });

  await sub('A2: pressing Hand over posts artifact-handoff {slug, at} once, and the bar says With plan-pricing', async () => {
    const V = await tabOf({ [N.trial]: ROW.C20(), [N.plans]: ROW.C20() });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-handover', 'the pill');
    await V.p.ev(`(window.__replies['artifact-handoff'] = { body: { to: 'plan-pricing', typed: true, count: 2 }, wait: 1500 }, true)`);
    await V.p.click('#av-handover');
    await V.p.ev(`(addEventListener('click', (e) => { if (e.target.id === 'av-handover') window.__again = true; }, true), 0)`);
    // (a click with no pointer, so the in-flight guard is what stops it, not the press rule)
    await V.p.ev(`(document.getElementById('av-handover').click(), true)`);
    assert.equal(await V.p.ev('window.__again === true'), true, 'setup: the second press reached the pill');
    await V.soon(`window.__posts.some((x) => x.action === 'artifact-handoff')`, 'the press posted');
    assert.ok(await V.settle(`${text('#av-with')} === 'With plan-pricing'`, 4000), 'the first answer');
    assert.equal(await V.p.ev(`document.getElementById('av-with').title`), 'With plan-pricing', 'its whole words in its title, where the bar cuts them');
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(await V.p.ev(`window.__posts.filter((x) => x.action === 'artifact-handoff')`), [{ action: 'artifact-handoff', body: { slug: 'pricing', at: 'plan-pricing' } }], 'one post, {slug, at}');
    assert.ok(await V.settle(`${text('#av-with')} === 'With plan-pricing' && !${shown('#av-handover')}`, 4000), `the bar says With plan-pricing (it says ${J(await V.p.ev(text('#av-with')))})`);
    await V.rows({ [N.trial]: ROW.C20(), [N.plans]: ROW.C1() });
    await V.p.ev(`(window.__replies['artifact-handoff'] = { body: { to: 'plan-pricing', typed: false, count: 0 } }, true)`);
    await V.p.click('#av-handover');
    assert.ok(await V.settle(`${text('#av-with')} === 'Nothing to hand over'`, 4000), 'count 0: Nothing to hand over');
    await V.rows({ [N.trial]: ROW.C20(), [N.plans]: ROW.C1() });
    await V.p.ev(`(window.__replies['artifact-handoff'] = { status: 400, body: { error: 'x' } }, true)`);
    await V.p.click('#av-handover');
    assert.ok(await V.settle(`${text('#e-avn')} === 'Not saved: x'`, 4000), 'a refusal shows Not saved');
    assert.equal(await V.p.ev(`document.getElementById('e-avn').title`), 'Not saved: x', 'a refusal whole in its title');
    // a refusal that comes once another version is shown is not said there
    await V.rows({ [N.trial]: ROW.C20(), [N.onMain]: ROW.C20() });
    await V.p.ev(`(window.__replies['artifact-handoff'] = { status: 400, body: { error: 'late' }, wait: 800 }, true)`);
    await V.p.click('#av-handover');
    await V.p.ev(`showArtifact('pricing', 'main', { picked: true }); void 0`);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await V.p.ev(`window.__posts.filter((x) => x.action === 'artifact-handoff').length`), 4, 'setup: it was posted');
    assert.deepEqual(await V.p.ev(`[AV.at, ${text('#e-avn')}]`), ['main', ''], "another version's refusal");
  });

  await sub('A3: the filter starts on To check once any exist, Open and All on choice, kept in localStorage', async () => {
    const V = await tabOf({ [N.trial]: ROW.C12(), [N.plans]: ROW.C20(), [N.cancel]: ROW.C20() });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-filter', 'the stepper');
    assert.equal(await V.p.ev(`document.getElementById('av-filter').value`), 'check', 'To check by default once any exist');
    assert.equal(await V.p.ev(text('#av-stepn')), '– / 1', 'one note to check, none current');
    await V.p.ev(`(() => { const s = document.getElementById('av-filter'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    assert.equal(await V.p.ev(`localStorage.getItem('devteam.notes.filter')`), '"all"', 'the choice kept');
    assert.equal(await V.p.ev(text('#av-stepn')), '– / 3', 'All: every open note');
    await V.p.ev(`(() => { const s = document.getElementById('av-filter'); s.value = 'open'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    assert.equal(await V.p.ev(text('#av-stepn')), '– / 2', 'Open: the open and handed notes');
    await V.p.ev(`(() => { const s = document.getElementById('av-filter'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await V.reload();
    await V.rows({ [N.trial]: ROW.C12(), [N.plans]: ROW.C20(), [N.cancel]: ROW.C20() });
    await openAt(V, AV_WT, 'plan-pricing');
    assert.equal(await V.p.ev(`document.getElementById('av-filter').value`), 'all', 'a reload keeps All');
    const W = await tabOf({ [N.trial]: ROW.C20() });
    await openAt(W, AV_WT, 'plan-pricing');
    assert.equal(await W.p.ev(`document.getElementById('av-filter')?.value`), 'open', 'with none to check, Open');
  });

  await sub('A3b: the version Show me opened holds the note whose change is there', async () => {
    const V = await tabOf({ [N.onMain]: withFrame(ROW.C9(), '') }, '#library?th=open');
    await V.soon(`!!document.querySelector('[data-tl-show="${N.onMain}"]')`, 'the row has Show me');
    await V.p.click(`[data-tl-show="${N.onMain}"]`);
    await V.soon(`location.hash === '#artifact/wt/chore-artifact-pricing/pricing' && TS.ready`, 'Show me opened the chore draft');
    await has(V, '#av-step', 'the stepper on the chore draft');
    assert.deepEqual(await V.p.ev(`[document.getElementById('av-filter').value, ${text('#av-stepn')}]`), ['check', '1 / 1'], 'the note to check, current');
  });

  // the stepper on All, the list in pin order; the step to id, by › presses
  async function stepTo(V, id) {
    await V.p.ev(`(() => { const s = document.getElementById('av-filter'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    for (let i = 0; i < 12; i++) {
      if (await V.p.ev(`TL.open === ${J(id)}`)) return;
      const was = await V.p.ev('TL.open');
      await V.p.click('#av-next');
      await V.settle(`TL.open !== ${J(was)}`, 6000);
    }
    assert.fail(`setup: never stepped to ${id}`);
  }

  await sub('A4: a step to a note on another file sets the frame\'s src, posts scroll-to and opens the card', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.cancel]: withFrame(ROW.C12({ addressed: ADDR({ note: 'The cancel answer is one line', sha: null, draft: null }) }), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-next', 'the stepper');
    await V.p.click('#av-next');
    await V.soon(`TL.open === ${J(N.trial)}`, 'the first step opens the first note');
    const before = await V.p.ev('window.__tsPosts.length');
    await V.p.click('#av-next');
    await V.soon(`(tsFrame().getAttribute('src') || '').endsWith('/pricing/faq.html')`, "the frame's src is faq.html");
    await V.soon(`TS.ready && TS.path === 'faq.html' && window.__tsPosts.slice(${before}).some((m) => m.type === 'scroll-to' && m.anchor && m.anchor.selector === '#q-cancel')`, 'scroll-to the note\'s anchor');
    assert.ok(await V.settle(`TL.open === ${J(N.cancel)} && !document.getElementById('tl-card').hidden`, 4000), 'its card open');
    // another file with a view hash: back on index.html, then the step to faq.html carries #x
    const W = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.cancel]: withFrame(ROW.C12(), '#x') });
    await openAt(W, AV_WT, 'plan-pricing');
    await stepTo(W, N.cancel);
    await W.soon(`(tsFrame().getAttribute('src') || '').endsWith('/pricing/faq.html#x')`, 'src ends /faq.html#x');
  });

  await sub('A5: a step on the same file to another view posts go, with no load', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.annual]: withFrame(ROW.C12(), '#annual'), [N.pointAnnual]: ROW.C12() });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-next', 'the stepper');
    await V.p.click('#av-next');
    await V.soon(`TL.open === ${J(N.trial)}`, 'on the trial note');
    const loads = await V.p.ev('window.__loads.length'), k = await V.p.ev('window.__tsPosts.length');
    await V.p.click('#av-next');
    await V.soon(`window.__tsPosts.slice(${k}).some((m) => m.type === 'go' && m.hash === '#annual')`, 'go #annual posted');
    await V.soon(`TS.hash === '#annual'`, 'the frame on #annual');
    assert.equal(await V.p.ev('window.__loads.length'), loads, 'no load');
    // back to the default view (the trial note, frame.hash ''), then the point-only note on index.html#annual
    await stepTo(V, N.trial);
    await V.soon(`TS.hash === ''`, 'setup: back on the default view');
    const k2 = await V.p.ev('window.__tsPosts.length');
    // straight to it, past the annual price's own #annual
    await V.p.ev(`(avStep.to(TL.threads.find((t) => t.id === ${J(N.pointAnnual)})), true)`);
    await V.soon(`window.__tsPosts.slice(${k2}).some((m) => m.type === 'go' && m.hash === '#annual')`, "the point note's hash, read from its path: go #annual");
  });

  await sub('A6: an empty view hash resets to the plain file; an element note with no frame never moves the hash', async () => {
    const V = await tabOf({ [N.annual]: withFrame(ROW.C12(), '#annual'), [N.trial]: withFrame(ROW.C12(), ''), [N.monthly]: ROW.C12() });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-next', 'the stepper');
    await stepTo(V, N.annual);
    await V.soon(`TS.hash === '#annual'`, 'setup: on #annual');
    await stepTo(V, N.trial);
    await V.soon(`/\\/pricing\\/index\\.html$/.test(tsFrame().getAttribute('src') || '')`, 'the plain file loaded');
    await stepTo(V, N.annual);
    await V.soon(`TS.hash === '#annual' && TS.ready`, 'setup: on #annual again');
    const k = await V.p.ev('window.__tsPosts.length'), loads = await V.p.ev('window.__loads.length');
    await stepTo(V, N.monthly);
    await V.p.ev(FRAMES);
    assert.deepEqual(await V.p.ev(`[window.__tsPosts.slice(${k}).filter((m) => m.type === 'go').length, window.__loads.length - ${loads}, TS.hash]`), [0, 0, '#annual'], 'no go, no load, the hash kept for a note with no frame');
  });

  await sub('A7: the arrow keys step with the viewer focused, not from the composer', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.plans]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await V.focusBody();
    await V.p.key('ArrowRight');
    assert.ok(await V.settle(`TL.open !== null`, 3000), 'ArrowRight stepped');
    const first = await V.p.ev('TL.open');
    await V.p.key('ArrowRight');
    await V.soon(`TL.open !== ${J(first)}`, 'ArrowRight again');
    await V.p.key('ArrowLeft');
    await V.soon(`TL.open === ${J(first)}`, 'ArrowLeft back');
    await V.p.ev(`document.getElementById('tl-c-text').focus(); void 0`);
    await V.p.key('ArrowRight');
    await V.p.ev(FRAMES);
    assert.equal(await V.p.ev('TL.open'), first, 'nothing from the composer');
    await V.focusFrame();
    await V.p.key('ArrowRight');
    assert.ok(await V.settle(`TL.open !== ${J(first)}`, 3000), 'ArrowRight from the frame stepped');
    // the page's own field and radio keep their arrows (a real click focuses each, in the frame)
    for (const id of ['field', 'plan-annual']) {
      // no card over the stage; the element pressed is the frame's, and the page says it has the focus
      await V.p.ev('tlClose(); void 0');
      const at = await V.p.ev(`(() => { const m = window.__own.filter((m) => m.own === 'at' && m.rects && m.rects[${J(id)}]).pop(), f = tsFrame(), r = f.getBoundingClientRect(), e = m.rects[${J(id)}]; const x = r.left + f.clientLeft + e.x + e.w / 2, y = r.top + f.clientTop + e.y + e.h / 2; return { x, y, hit: document.elementFromPoint(x, y) === f }; })()`);
      assert.ok(at.hit, `setup: #${id} is not covered`);
      await V.p.clickAt(at.x, at.y);
      await V.soon(`window.__own.filter((m) => m.own === 'focus').pop()?.id === ${J(id)}`, `setup: the page's #${id} has the focus`);
      const now = await V.p.ev('TL.open');
      assert.equal(now, null, 'setup: no card open');
      await V.p.key('ArrowRight');
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(await V.p.ev('TL.open'), now, `nothing with the page's #${id} focused`);
    }
  });

  await sub('A7: a page that takes the arrow keys keeps them', async () => {
    const V = await tabOf({ [N.cancel]: withFrame(ROW.C12(), ''), [N.hiddenQ]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await V.p.ev(`(tsFrame().setAttribute('src', artSrc('pricing', 'plan-pricing') + 'faq.html'), true)`);
    await V.soon(`TS.ready && TS.path === 'faq.html'`, 'setup: faq.html, a page that takes the arrows');
    await V.focusFrame();
    const now = await V.p.ev('TL.open');
    await V.p.key('ArrowRight');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await V.p.ev('TL.open'), now, 'a key the page took steps nothing');
    assert.equal(await V.p.ev(`window.__lensKeys.filter((k) => k.key === 'ArrowRight').length`), 0, 'the lens told nothing');
  });

  await sub('A8: a step to a note on the same file and view hash does not reload the frame', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.plans]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-next', 'the stepper');
    await V.p.click('#av-next');
    await V.soon('TL.open !== null', 'setup: first step');
    const loads = await V.p.ev('[window.__loads.length, AV_LOADS.get(tsFrame())]'), one = await V.p.ev('TL.open');
    await V.p.click('#av-next');
    await V.soon(`TL.open !== null && TL.open !== ${J(one)}`, 'second step');
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(await V.p.ev('[window.__loads.length, AV_LOADS.get(tsFrame())]'), loads, 'no load');
  });

  await sub('A9: X closes to the pre-open hash after a step that loaded and after Show me on another version', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.cancel]: withFrame(ROW.C12(), ''), [N.onMain]: withFrame(ROW.C11(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-next', 'the stepper');
    await stepTo(V, N.cancel);
    await V.soon(`TS.path === 'faq.html' && AV_NAVS === 1`, 'the step loaded faq.html, counted');
    const len = await V.p.ev('history.length');
    await V.close('x');
    await V.closedOn('#library', 'after a step');
    assert.equal(await V.p.ev('history.length'), len, 'no entry added');
    // Show me from an open viewer's card onto another version (main)
    const W = await tabOf({ [N.onMain]: withFrame(ROW.C11(), '') });
    await openAt(W, AV_WT, 'plan-pricing');
    await W.p.ev(`tlOpen(${J(N.onMain)}, false); void 0`);
    await W.soon(`!!document.querySelector('#tl-card [data-tl-show]')`, 'the card has Show me');
    // the picture isn't there: its words are in, so nothing moves under the press
    await W.soon(`/Picture not on this machine/.test(${text('#tl-card')})`, 'the card at rest');
    const navs = await W.p.ev('AV_NAVS');
    await W.p.click('#tl-card [data-tl-show]');
    await W.soon(`TS.at === 'main' && TS.ready`, 'Show me opened main in the open viewer');
    assert.deepEqual(await W.p.ev('[AV_RET, AV_NAVS]'), ['#library', navs + 1], 'AV_RET kept, the version change counted');
    await W.close('x');
    await W.closedOn('#library', 'after Show me on another version');
  });

  await sub('A10: Show me from the closed viewer is a plain open', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), '') }, '#library?th=open');
    await V.soon(`!!document.querySelector('[data-tl-show="${N.trial}"]')`, 'the row has Show me');
    await V.p.click(`[data-tl-show="${N.trial}"]`);
    await V.soon(`${VIEWER_UP} && TS.ready && TS.at === 'plan-pricing'`, 'up');
    await V.soon(`TL.open === ${J(N.trial)}`, 'its card');
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(await V.p.ev('[AV_NAVS, AV_RET]'), [0, '#library?th=open'], 'the first load not counted');
    await V.p.ev('window.__backs = 0, 0');
    await V.close('x');
    await V.closedOn('#library?th=open', 'after Show me');
    assert.equal(await V.p.ev('window.__backs'), 1, 'one step back');
  });

  await sub('A11: a step to a note whose anchor is hidden opens its card at the stage\'s top right, Not on this view', async () => {
    const V = await tabOf({ [N.hiddenQ]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-next', 'the stepper');
    await V.p.click('#av-next');
    await V.soon(`TL.open === ${J(N.hiddenQ)} && TS.path === 'faq.html' && !document.getElementById('tl-card').hidden`, 'its card open');
    // the lens says where the anchor is a frame or two after the page is ready: the words come with it, then the place
    assert.ok(await V.settle(`/Not on this view/.test(${text('#tl-card .tl-nview')})`, 4000), 'the words');
    await V.p.ev(FRAMES);
    const box = await V.p.ev(`(() => { const c = document.getElementById('tl-card').getBoundingClientRect(), s = document.getElementById('av-stage').getBoundingClientRect(); return { right: s.right - c.right, top: c.top - s.top }; })()`);
    assert.ok(Math.abs(box.right - 8) <= 2 && Math.abs(box.top - 8) <= 2, `at the stage's top right, 8px in (${J(box)})`);
  });

  await sub('A8b: steps while one is under way: the last wins; the owner moving on drops it', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.cancel]: withFrame(ROW.C12(), ''), [N.plans]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-next', 'the stepper');
    const ids = await V.p.ev('avStep.list().map((t) => t.id)');
    const i = ids.indexOf(N.cancel), next = ids[(i + 1) % 3], prev = ids[(i + 2) % 3];
    // from the note before: faq.html's, and at once the one after, on index.html
    await V.p.ev(`tlOpen(${J(prev)}, false); void 0`);
    await V.p.ev('(avStep(1), avStep(1), true)');
    assert.notEqual(await V.p.ev('TL.open'), next, 'not landed on the page being left');
    await V.soon(`TL.open === ${J(next)} && TS.ready && TS.path === 'index.html'`, 'the last step landed on its own page');
    await new Promise((r) => setTimeout(r, 600));
    assert.deepEqual(await V.p.ev('[TL.open, TS.path]'), [next, 'index.html'], 'the frame stays under its card');
    // under way to faq.html, the owner opens another note
    await V.p.ev(`(tlOpen(${J(prev)}, false), avStep(1), tlOpen(${J(next)}, false), true)`);
    await V.soon(`TS.ready && TS.path === 'faq.html'`, 'the frame came');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await V.p.ev('TL.open'), next, "the owner's own card kept");
  });
  await sub('A8c: a step under way is dropped by a new note, pin mode, or words in the card', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.cancel]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-next', 'the stepper');
    // a new note with no card open: the draft alone says so
    await V.p.ev(`(avStep.sent = null, tlClose(), avStep.want = { id: ${J(N.cancel)}, av: AV, open: null, draft: null }, tlStart({ subject: tsSubject(null, 700, 500), title: 'x', x: 700, y: 500 }), document.activeElement?.blur?.(), avStep.land('late'), true)`);
    assert.deepEqual(await V.p.ev('[TL.open, !!TL.draft, avStep.want]'), [null, true, null], 'dropped by a draft alone');
    await V.p.ev('(tlClose(), true)');
    for (const [what, act, undo] of [
      ['a new note', `tlStart({ subject: tsSubject(null, 700, 500), title: 'x', x: 700, y: 500 })`, 'tlClose()'],
      ['pin mode', 'tlPinMode(true)', 'tlPinMode(false)'],
      ['words in the card', `document.getElementById('tl-c-text').focus()`, 'document.activeElement.blur()'],
      ['the picture', `document.getElementById('av-stage').insertAdjacentHTML('beforeend', '<div id="av-shot"></div>')`, `document.getElementById('av-shot')?.remove()`],
    ]) {
      await V.p.ev(`(avStep.sent = null, avStep.want = null, tlOpen(${J(N.trial)}, false), document.activeElement?.blur?.(), true)`);
      await V.soon(`TL.open === ${J(N.trial)} && !document.getElementById('tl-card').hidden`, `setup: the card (${what})`);
      await V.p.ev(`(avStep.want = { id: ${J(N.cancel)}, av: AV, open: TL.open, draft: TL.draft }, ${act}, avStep.land('late'), true)`);
      assert.equal(await V.p.ev(`TL.open === ${J(N.cancel)}`), false, `dropped by ${what}`);
      assert.equal(await V.p.ev('avStep.want'), null, `nothing left of it (${what})`);
      await V.p.ev(`(${undo}, true)`);
    }
    // and not dropped with none of them
    await V.p.ev(`(avStep.sent = null, tlOpen(${J(N.trial)}, false), document.activeElement?.blur?.(), avStep.want = { id: ${J(N.cancel)}, av: AV, open: TL.open, draft: TL.draft }, avStep.land('late'), true)`);
    await V.soon(`TL.open === ${J(N.cancel)}`, 'the late landing opens its card');
  });
  await sub('A8d: a page that is slow or changes its own view is loaded once; nothing of the step outlives its card', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.cancel]: withFrame(ROW.C12(), '#own') });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-next', 'the stepper');
    // a lens that says nothing for the while: the step goes late
    await V.p.ev(`(window.__sets = 0, new MutationObserver((l) => { window.__sets += l.length; }).observe(tsFrame(), { attributes: true, attributeFilter: ['src'] }), tlOpen(${J(N.trial)}, false), avStep(1), TS.ready = false, true)`);
    await V.p.ev(`(avStep.land('late'), true)`);
    await V.soon(`TL.open === ${J(N.cancel)}`, 'late: its card');
    await V.p.ev(`(avStep.land('late'), avStep.land('late'), true)`);
    assert.deepEqual(await V.p.ev('[window.__sets, avStep.want]'), [1, null], 'sent once, the step over');
    // the owner opens another: next steps from it
    await V.soon(`TS.ready && TS.path === 'faq.html'`, 'the page came');
    await V.p.ev(`(tlOpen(${J(N.trial)}, false), avStep(1), true)`);
    await V.soon(`TL.open === ${J(N.cancel)}`, 'the next step goes from the open card');
    assert.equal(await V.p.ev('window.__sets'), 1, 'no load: it is on that page');
    // the owner opens another card while a step is under way: the next goes from that card, at once
    await V.p.ev(`(avStep.sent = null, avStep.want = { id: ${J(N.cancel)}, av: AV, open: ${J(N.cancel)}, draft: TL.draft }, TL.open = ${J(N.trial)}, true)`);
    assert.equal(await V.p.ev(`(() => { let to = null; const was = avStep.to; avStep.to = (t) => { to = t.id; }; avStep(1); avStep.to = was; return to; })()`), N.cancel, 'from the open card, not the step');
  });
  await sub('A8e: late never sends again; a late page is scrolled to when it comes; a forgotten move holds nothing', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), ''), [N.cancel]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-next', 'the stepper');
    const cancel = `TL.threads.find((t) => t.id === ${J(N.cancel)})`;
    // sent, and the stage is ready elsewhere (a link the owner followed): late opens the card and sends nothing
    await V.p.ev(`(window.__sets = 0, new MutationObserver((l) => { window.__sets += l.length; }).observe(tsFrame(), { attributes: true, attributeFilter: ['src'] }), tlOpen(${J(N.trial)}, false), document.activeElement?.blur?.(), avStep.sent = { av: AV, file: 'faq.html', vh: '', load: true, until: Date.now() - 1 }, avStep.want = { id: ${J(N.cancel)}, av: AV, open: TL.open, draft: TL.draft }, window.__k = window.__tsPosts.length, avStep.land('late'), window.__left = avStep.want, true)`);
    await V.p.ev(FRAMES);
    assert.deepEqual(await V.p.ev(`[window.__sets, TL.open, avStep.sent?.scroll, window.__left]`), [0, N.cancel, N.cancel, null], 'nothing sent again, the step over');
    // the page comes: scrolled to
    await V.p.ev(`(TS.path = 'faq.html', avStep.land('ready'), true)`);
    assert.equal(await V.p.ev(`window.__tsPosts.slice(window.__k).filter((m) => m.type === 'scroll-to' && m.anchor.selector === '#q-cancel').length`), 1, 'scrolled when it came');
    // a move that never said so, and a note on the page that is there: landed at once, no load
    await V.p.ev(`(TS.path = 'index.html', TS.hash = '', TS.ready = true, tlOpen(${J(N.cancel)}, false), document.activeElement?.blur?.(), window.__sets = 0, avStep.sent = { av: AV, file: 'x.html', vh: '', load: true, until: Date.now() - 1 }, avStep.to(TL.threads.find((t) => t.id === ${J(N.trial)})), true)`);
    await V.p.ev(FRAMES);
    assert.deepEqual(await V.p.ev('[window.__sets, TL.open, avStep.sent]'), [0, N.trial, null], 'a forgotten move holds nothing');
    // a page not ready that is this file already is never loaded again
    await V.p.ev(`(avStep.sent = null, avStep.want = null, TS.ready = false, tsFrame().setAttribute('src', artSrc(AV.slug, AV.at)), true)`);
    await V.p.ev(FRAMES);
    await V.p.ev(`(window.__sets = 0, tlOpen(${J(N.cancel)}, false), document.activeElement?.blur?.(), avStep.want = { id: ${J(N.trial)}, av: AV, open: TL.open, draft: TL.draft }, TS.ready = false, avStep.land('late'), true)`);
    await V.p.ev(FRAMES);
    assert.equal(await V.p.ev('window.__sets'), 0, 'the plain address is index.html');
    // Show me's own load is on its way from the start
    assert.equal(await V.p.ev(`(avStep.sent = null, avStep.to(${cancel}, { opening: true }), avStep.sent?.file)`), 'faq.html', "Show me's page is on its way");
  });
  await sub('A6b: where a note is: a path with no view and no frame, or a bare #, says nothing of the view', async () => {
    const V = await tabOf({});
    const vh = (t) => V.p.ev(`avStep.where(${J(t)}).vh`);
    assert.equal(await vh({ subject: { path: 'index.html', point: { x: 1, y: 1 } } }), null, 'an old point note');
    assert.equal(await vh({ subject: { path: 'index.html#', point: { x: 1, y: 1 } } }), null, 'a bare #');
    assert.equal(await vh({ subject: { path: 'index.html', point: { x: 1, y: 1 } }, frame: { hash: '' } }), '', 'a framed one with no view');
    assert.equal(await vh({ subject: { path: 'index.html#a', point: { x: 1, y: 1 } } }), '#a', "its path's");
  });
  await sub('A12c: Resolve waits its second again when its block comes back', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await settled(V);
    for (const [off, on] of [['TL.resolving = true', 'TL.resolving = false'], ['tlClose()', `tlOpen(${J(N.trial)}, false)`]]) {
      await V.p.ev(`(${off}, tlDraw(), true)`);
      await V.p.ev(FRAMES);
      await V.p.ev(`(${on}, tlDraw(), true)`);
      await V.p.ev(FRAMES);
      assert.equal(await V.p.ev(`document.querySelector('#tl-card .tl-addr [data-tl-accept]').classList.contains('waiting')`), true, `waiting again after ${off}`);
      await settled(V);
    }
  });
  await sub('A12: an addressed card says who and what; Resolve sends the at as drawn; a changed note is refused and redrawn', async () => {
    const V = await tabOf({ [N.trial]: ROW.C12() });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await has(V, '#tl-card .tl-addr .tl-words', 'the addressed block');
    await holdPoll(V);
    assert.equal(await V.p.ev(text('#tl-card .tl-addr .by')), 'Addressed by plan-pricing · 3f7c2a9', 'who, and the commit');
    assert.equal(await V.p.ev(text('#tl-card .tl-addr .tx')), V_C12.addressed.note, 'the note');
    const changed = ROW.C12({ addressed: ADDR({ at: NEWER, note: 'Now the button is green too', sha: null }) });
    await V.p.ev(`(window.__replies['thread-accept-addressed'] = { status: 400, body: { error: 'The note changed; read it again' }, notes: { [${J(N.trial)}]: ${J(changed)} } }, true)`);
    await new Promise((r) => setTimeout(r, ARMED));
    // the panel's own poll reads the threads too: the refusal's read is told by its caller
    await V.p.ev(`(window.__reread = 0, window.__real = tlRefresh, tlRefresh = (...a) => { if (/restore/.test(new Error().stack)) window.__reread++; return window.__real(...a); }, true)`);
    await V.p.click('#tl-card [data-tl-accept]');
    await V.soon(`window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'Resolve posted');
    assert.deepEqual(await V.p.ev(`window.__posts.filter((x) => x.action === 'thread-accept-addressed').map((x) => x.body)`), [{ id: N.trial, at: AT }], 'the at as drawn');
    assert.ok(await V.settle(`${text('#e-tl')} === 'Not saved: The note changed; read it again'`, 4000), 'the refusal shown');
    assert.ok(await V.settle(`${text('#tl-card .tl-addr .tx')} === 'Now the button is green too'`, 3000), 'the card re-read and redrawn with the new note');
    assert.equal(await V.p.ev('window.__reread'), 1, 'the card re-read and redrawn: the refusal reads the threads');
  });

  await sub('A12b: Resolve is armed only once the note has sat still', async () => {
    const V = await tabOf({ [N.trial]: ROW.C12() });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await has(V, '#tl-card .tl-addr .tl-words', 'the addressed block');
    await holdPoll(V);
    await new Promise((r) => setTimeout(r, ARMED));
    await V.rows({ [N.trial]: ROW.C12({ addressed: ADDR({ at: NEWER, note: 'Swapped in', sha: null }) }) });
    await V.soon(`${text('#tl-card .tl-addr .tx')} === 'Swapped in'`, 'the new note drawn');
    await V.p.ev(`(window.__replies['thread-accept-addressed'] = { body: { ok: true, out: '' } }, true)`);
    assert.deepEqual(await V.p.ev(`(({ className, title, disabled }) => [/waiting/.test(className), title, disabled])(document.querySelector('#tl-card [data-tl-accept]'))`), [true, 'Read it first', false], 'says it waits, without being disabled');
    await press(V, '#tl-card [data-tl-accept]');
    await V.p.ev(FRAMES);
    assert.equal(await V.p.ev(`window.__posts.filter((x) => x.action === 'thread-accept-addressed').length`), 0, 'a click within the arm time posts nothing');
    await settled(V);
    await V.p.click('#tl-card [data-tl-accept]');
    await V.soon(`window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'armed: Resolve posts');
    assert.deepEqual(await V.p.ev(`window.__posts.filter((x) => x.action === 'thread-accept-addressed').map((x) => x.body)`), [{ id: N.trial, at: NEWER }], 'the note shown');
  });

  await sub('A12b: Resolve is armed again after a step opens the card', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await holdPoll(V);
    await V.p.ev(`(window.__replies['thread-accept-addressed'] = { body: { ok: true, out: '' } }, true)`);
    const posts = () => V.p.ev(`window.__posts.filter((x) => x.action === 'thread-accept-addressed').map((x) => x.body.id)`);
    // armed, then opened again by a step (the list's only note)
    await settled(V);
    const k = await V.p.ev('window.__tsPosts.length');
    await V.p.click('#av-next');
    await V.soon(`window.__tsPosts.slice(${k}).some((m) => m.type === 'scroll-to')`, 'setup: stepped');
    await press(V, '#tl-card [data-tl-accept]');
    await V.p.ev(FRAMES);
    assert.deepEqual(await posts(), [], 'a click right after a step posts nothing');
    await settled(V);
    await V.p.click('#tl-card [data-tl-accept]');
    await V.soon(`window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'armed: Resolve posts');
    assert.deepEqual(await posts(), [N.trial], 'the note shown');
  });

  await sub('A23: an open note whose newest turn is the owner\'s is kept with it, whatever the send said; the rest as today', async () => {
    const KEPT = 'Not handed over yet. Hand over sends it to the supervisor.';
    const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
    const own = (m, o = {}) => ({ id: 'u-20261120-100000000-owner', by: 'owner', at: ago(m), text: 'Make it primary', refs: [], question: null, files: [], ...o });
    const sup = (m) => ({ ...own(m), id: 'u-20261120-110000000-supervisor', by: 'supervisor', text: 'Why?' });
    const V = await tabOf({ [N.trial]: { ...ROW.C20(), turns: [own(1)] } });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    const line = () => V.p.ev(text('#tl-c-state'));
    const says = async (row, typed) => {
      await V.rows({ [N.trial]: row });
      await V.p.ev(`(TL.typed[${J(N.trial)}] = ${J(typed ?? null)}, TL.polled = true, tlRefresh(), true)`);
      await V.p.ev(FRAMES);
      await new Promise((r) => setTimeout(r, 400));
      return line();
    };
    assert.equal(await says({ ...ROW.C20(), turns: [own(1)] }, false), KEPT, 'a send no terminal took');
    assert.equal(await says({ ...ROW.C20(), turns: [own(30)] }), KEPT, 'after a reload, 30 minutes on');
    assert.equal(await says({ ...ROW.C20(), turns: [own(30, { routed_to: 'supervisor' })] }), KEPT, 'a turn from before, routed to the supervisor');
    const before = [];
    for (const [what, row] of [
      ['a note handed over', { ...ROW.C1(), turns: [own(30)] }],
      ['a note to check', { ...ROW.C17(), turns: [own(30)] }],
      ['a turn a session has', { ...ROW.C20(), turns: [own(1, { routed_to: 'session', routed_session: 'kit-9-x' })] }],
      ["the supervisor's reply", { ...ROW.C20(), turns: [own(30), sup(5)] }],
      ['a resolved note', { ...ROW.C20(), status: 'resolved', outcome: 'done', turns: [own(30)] }],
      ['a turn on its way', { ...ROW.C20(), turns: [own(0, { id: null, pending: true })] }],
      ['a turn the responder has', { ...ROW.C20(), turns: [own(1, { routed_to: 'responder', delivered: 'typed' })] }],
    ]) before.push([what, await says(row)]);
    for (const [what, said] of before) assert.notEqual(said, KEPT, what);
    const of = Object.fromEntries(before);
    assert.equal(of['a note handed over'], 'With plan-pricing.', 'handed over: With plan-pricing.');
    assert.equal(of['a note to check'], '', 'to check: no line');
    assert.match(of['a turn a session has'], /the agent on|kit-9-x/i, "a session's: as today");
    assert.equal(of["the supervisor's reply"], '', 'a reply: nothing, as today');
    assert.match(of['a resolved note'], /^Resolved/, 'resolved: as today');
    assert.equal(of['a turn on its way'], 'Sending…', 'on its way: as today');
    assert.match(of['a turn the responder has'], /responder/, "the responder's: as today");
    // a session whose record has it says so first; a thread on anything but an artifact is as today
    const drawn = (over, stage) => V.p.ev(`(() => { const was = TL.working; TL.working = ${stage ? `{ [${J(N.trial)}]: { turn: ${J(own(1).id)}, stage: ${J(stage)}, by: 'supervisor', at: new Date().toISOString() } }` : 'null'}; tlCardBody({ ...TL.threads.find((x) => x.id === ${J(N.trial)}), turns: [${J(own(1))}], status: 'open', check: null, handed: null, ...${J(over)} }); TL.working = was; return document.getElementById('tl-c-state').textContent; })()`);
    assert.equal(await drawn({}), KEPT, 'setup: kept');
    assert.match(await drawn({}, 'responding'), / is responding…$/, 'a working session first');
    assert.match(await drawn({}, 'picked-up'), / picked it up\.$/, 'one that picked it up too');
    for (const subject of [null, { kind: 'page', page: 'library' }, { kind: 'preview', name: 'p', route: '/' }]) assert.notEqual(await drawn({ subject }), KEPT, `not on an artifact: ${J(subject)}`);
  });
  await sub('A13: a ready artifact card shows the outcome; Resolve sends thread-accept with its at', async () => {
    const V = await tabOf({ [N.onMain]: ROW.C11() });
    await openAt(V, AV_MAIN, 'main');
    await cardOf(V, N.onMain);
    assert.ok(await V.settle(`${text('#tl-card .tl-addr .by')} === 'Proposed by the supervisor'`, 3000), 'Proposed by the supervisor');
    assert.equal(await V.p.ev(text('#tl-card .tl-addr .tx')), V_C11.ready.outcome, 'the outcome');
    await V.p.ev(`(window.__replies['thread-accept'] = { body: { ok: true, out: '' } }, true)`);
    await new Promise((r) => setTimeout(r, ARMED));
    await V.p.click('#tl-card [data-tl-accept]');
    await V.soon(`window.__posts.some((x) => x.action === 'thread-accept')`, 'Resolve posted');
    assert.deepEqual(await V.p.ev(`window.__posts.filter((x) => x.action === 'thread-accept').map((x) => x.body)`), [{ id: N.onMain, at: READY_AT }], 'thread-accept {id, at}');
  });

  await sub('A14b: Show me works when the head stands already, and says nothing of another artifact', async () => {
    const V = await tabOf({ [N.onMain]: withFrame(ROW.C11(), '') });
    await openAt(V, AV_MAIN, 'main');
    // another version shown in place, the head unchanged
    await V.p.ev(`showArtifact('pricing', 'plan-pricing', { picked: true }); void 0`);
    await V.soon(`TS.at === 'plan-pricing' && TS.ready`, 'setup: another version in place');
    await V.p.ev(`(avShowMe(${J(N.onMain)}), true)`);
    await V.soon(`TS.at === 'main' && TS.ready && TL.open === ${J(N.onMain)}`, 'main shown, its card open');
    assert.equal(await V.p.ev('SHOW_NOTE'), null, 'nothing left for the next open');
    // a leftover says nothing of another artifact
    await V.close('x');
    await V.closedOn('#library', 'closed');
    await V.p.ev(`(tlClose(), SHOW_NOTE = { id: ${J(N.onMain)}, gone: false, head: ${J(AV_MAIN)} }, location.hash = '#artifact/main/viewer-a', true)`);
    await V.soon(`${VIEWER_UP} && TS.slug === 'viewer-a' && TS.ready`, 'another artifact');
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(await V.p.ev(`[SHOW_NOTE, TL.open, AV_NAVS, /\\/viewer-a\\/$/.test(tsFrame().getAttribute('src'))]`), [null, null, 0, true], 'plainly opened');
  });
  await sub('A14: Show me from the Threads panel opens the source, the note\'s own file first, its card open', async () => {
    const cases = [
      [N.trial, { at: 'plan-pricing', slug: 'pricing' }, '#artifact/wt/plan-pricing/pricing', 'index.html', 'Draft · live in plan-pricing'],
      [N.cancel, { at: 'kit-9-x', slug: 'pricing' }, '#artifact/wt/kit-9-x/pricing', 'faq.html', 'Draft · live in kit-9-x'],
      [N.plans, { at: 'chore-artifact-pricing', slug: 'pricing' }, '#artifact/wt/chore-artifact-pricing/pricing', 'index.html', 'Draft · live in chore-artifact-pricing'],
      [N.onMain, { at: 'main', slug: 'pricing' }, '#artifact/main/pricing', 'index.html', 'Landed on main'],
    ];
    for (const [id, source, head, file, where] of cases) {
      const V = await tabOf({ [id]: withFrame(ROW.C12({ source }), '') }, '#library?th=open');
      await V.soon(`!!document.querySelector('[data-tl-show="${id}"]')`, `the row of ${file} has Show me`);
      const len = await V.p.ev('history.length');
      await V.p.click(`[data-tl-show="${id}"]`);
      await V.soon(`location.hash === ${J(head)} && ${VIEWER_UP} && TS.ready`, `Show me lands on ${head}`);
      assert.equal(await V.p.ev(`window.__loads.filter((l) => l.id === 'av-frame' && l.src).length`), 1, 'one load');
      assert.ok((await V.p.ev(`window.__loads.filter((l) => l.id === 'av-frame' && l.src)[0].src`)).endsWith(`/pricing/${file}`), `the first load is ${file}`);
      assert.equal(await V.p.ev('history.length'), len + 1, 'one entry');
      await V.soon(`TL.open === ${J(id)}`, 'its card open');
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(await V.p.ev(`window.__loads.filter((l) => l.id === 'av-frame' && l.src).length`), 1, 'still one load');
      assert.ok((await V.p.ev(text('#av-where'))).startsWith(where), `the version pill names ${where}`);
    }
    const V = await tabOf({ [N.annual]: withFrame(ROW.C12(), '#annual') }, '#library?th=open');
    await V.p.click(`[data-tl-show="${N.annual}"]`);
    await V.soon(`${VIEWER_UP} && TS.ready && TS.hash === '#annual'`, 'a frame.hash #annual note lands on #annual');
    const W = await tabOf({ [N.trial]: withFrame(ROW.C12({ source: null }), '') }, '#library?th=open');
    await W.p.click(`[data-tl-show="${N.trial}"]`);
    await W.soon(`location.hash === ${J(AV_MAIN)} && ${VIEWER_UP} && TS.ready`, 'source null: main');
    assert.ok(await W.settle(`/Showing main: the version with the change is gone\\./.test(${text('#tl-card')})`, 4000), 'the card says so');
    await W.p.ev(`(tlClose(), tlOpen(${J(N.trial)}, false), true)`);
    await W.p.ev(FRAMES);
    assert.doesNotMatch(await W.p.ev(text('#tl-card')), /Showing main/, 'opened again, it does not');
    // the panel's thread route open on another thread: Show me still lands its card
    const X = await tabOf({ [N.trial]: withFrame(ROW.C12(), '') , [N.plans]: withFrame(ROW.C12(), '') }, '#library?th=open');
    await X.soon(`!!document.querySelector('[data-tl-show="${N.trial}"]')`, 'the rows');
    // (the head's thread is put back by the route as it ends: no move of the owner's)
    await X.p.ev(`(thGo({ th: 'open', t: ${J(N.plans)} }), true)`);
    await X.soon(`TH.t === ${J(N.plans)} && TL.open === ${J(N.plans)}`, 'setup: the head names a thread');
    await X.p.ev(`(tlOpen(${J(N.trial)}, false), avShowMe(${J(N.trial)}), true)`);
    await X.soon(`TL.open === ${J(N.trial)} && TS.ready && TS.at === 'plan-pricing'`, "another card open: Show me's own card lands");
  });

  await sub('A15: the picture: a 160px thumbnail from /api/shot/, its caption, full size with Light and Dark', async () => {
    plant(N.trial, V_C11.shot.stamp, ['light', 'dark']);
    const V = await tabOf({ [N.trial]: ROW.C12({ shot: SHOT({ dirty: true, dark: true, sum: V_C11.shot.sum }) }) });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await has(V, '#tl-card .tl-shot img', 'the thumbnail');
    const img = await V.p.ev(`(() => { const i = document.querySelector('#tl-card .tl-shot img'); return { w: i.getBoundingClientRect().width, src: i.getAttribute('src'), n: i.naturalWidth }; })()`);
    assert.deepEqual([img.w, img.src], [160, `/api/shot/${N.trial}/${V_C11.shot.stamp}-light.png`], 'width and URL');
    assert.equal(await V.p.ev(text('#tl-card .tl-shot-cap')), "From plan-pricing's draft · 3f7c2a9 + uncommitted changes · 1400px wide", 'the caption');
    await V.p.click('#tl-card .tl-shot');
    await has(V, '#av-shot', 'the full-size view');
    assert.ok((await V.p.ev(`document.querySelector('#av-shot img').getAttribute('src')`)).endsWith('-light.png'), 'light first');
    await V.p.click('#av-shot [data-shot="dark"]');
    assert.ok((await V.p.ev(`document.querySelector('#av-shot img').getAttribute('src')`)).endsWith('-dark.png'), 'Dark');
    await V.p.key('Escape');
    assert.ok(await V.settle(`!${shown('#av-shot')} && !document.getElementById('tl-card').hidden`, 3000), 'Escape closes the picture, the card stays');
    await V.p.click('#tl-card .tl-shot');
    await has(V, '#av-shot', 'the full-size view again');
    await V.frameEscape();
    assert.ok(await V.settle(`!${shown('#av-shot')} && !document.getElementById('tl-card').hidden && ${VIEWER_UP}`, 3000), "the frame's Escape closes the picture only");
    // X; a press outside (the stage's corner); neither closes the card
    for (const how of ['x', 'outside']) {
      await V.p.click('#tl-card .tl-shot');
      await has(V, '#av-shot', `the view (${how})`);
      if (how === 'x') await V.p.click('#av-shot [data-shot-close]');
      else { const at = await V.p.ev(`(() => { const r = document.getElementById('av-shot').getBoundingClientRect(); return { x: r.left + 5, y: r.bottom - 5 }; })()`); await V.p.clickAt(at.x, at.y); }
      assert.ok(await V.settle(`!document.getElementById('av-shot') && !document.getElementById('tl-card').hidden && ${VIEWER_UP}`, 3000), `${how} closes the picture only`);
    }
    // the viewer closed under the picture: nothing of it is left to take a key
    await V.p.click('#tl-card .tl-shot');
    await has(V, '#av-shot', 'the view, then Back');
    await V.p.ev('history.back(); void 0');
    await V.soon(CLOSED, 'Back closed the viewer');
    assert.ok(await V.settle(`!document.getElementById('av-shot')`, 3000), 'the picture went with it');
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await V.rows({ [N.trial]: ROW.C12({ shot: SHOT({ src: 'main' }) }) });
    await V.p.click('#tl-card .tl-shot');
    await has(V, '#av-shot', 'a picture with no dark one');
    assert.equal(await V.p.ev(`document.querySelectorAll('#av-shot [data-shot]').length`), 0, 'no switch');
    await V.p.key('Escape');
    assert.ok(await V.settle(`${text('#tl-card .tl-shot-cap')} === 'From main · 3f7c2a9 · 1400px wide'`, 3000), 'From main');
  });

  await sub('A16: the picture\'s words: gone, hidden, changed, no-change, none, a missing file; the row\'s thumbnail', async () => {
    const words = {
      gone: 'The noted element is gone; this is where it was.',
      hidden: 'The noted element is on the page but hidden on this view; this is where it was.',
      changed: 'Its text has changed since the note.',
    };
    plant(N.trial, V_C11.shot.stamp);
    const V = await tabOf({ [N.trial]: ROW.C12({ shot: SHOT({ anchor: 'gone' }) }) });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    assert.match(await V.p.ev(text('#tl-card')), new RegExp(words.gone.replace(/[.;]/g, '\\$&')), 'gone');
    for (const [a, w] of Object.entries(words).slice(1)) {
      await V.rows({ [N.trial]: ROW.C12({ shot: SHOT({ anchor: a }) }) });
      assert.ok(await V.settle(`${text('#tl-card')}.includes(${J(w)})`, 3000), a);
    }
    await V.rows({ [N.trial]: ROW.C17() });
    assert.ok(await V.settle(`${text('#tl-card')}.includes('Nothing to picture: proposed with no change')`, 3000), 'noshot');
    await V.rows({ [N.trial]: ROW.C12({ shot: null }) });
    assert.ok(await V.settle(`${text('#tl-card')}.includes('No picture (marked before pictures)')`, 3000), 'no picture');
    await V.rows({ [N.trial]: ROW.C12({ shot: SHOT({ stamp: '20261120-100900000' }) }) });
    assert.ok(await V.settle(`${text('#tl-card')}.includes('Picture not on this machine') && ${text('#tl-card')}.includes('The mark stands; Show me still opens the spot.')`, 4000), 'a missing file');
    assert.equal(await V.p.ev(`document.querySelectorAll('#tl-card img').length`), 0, 'no broken image left');
    const W = await tabOf({ [N.trial]: ROW.C12() }, '#library?th=open');
    assert.ok(await W.settle(`!!document.querySelector('[data-tl-show="${N.trial}"]')?.closest('li')?.querySelector('.th-shot img')`, 4000), "the row's thumbnail beside its Show me");
  });

  await sub('A17: a withdrawn mark shows its reason', async () => {
    const V = await tabOf({ [N.trial]: ROW.C13() });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    assert.ok(await V.settle(`${text('#tl-card')}.includes('The supervisor withdrew a mark: The mark no longer matches the page.')`, 3000), 'the reason');
  });

  await sub('A18: a new note posts frame {w, h, hash}: the frame element\'s own size, clamped', async () => {
    const frameOf = async (V) => {
      // a note on empty page, where no note is yet (a Shift+click there starts one by tlStart)
      await V.p.ev(`(TS.viewport = { w: 999, h: 999 }, tlStart({ subject: tsSubject(null, 700, 500), title: 'Empty page', x: 700, y: 500 }), true)`);
      await V.p.ev(`(window.__replies['thread-new'] = { body: { ok: true, out: 't-20261120-100000000-owner\\n' } }, true)`);
      await V.soon(`!!document.getElementById('tl-c-text')`, 'setup: the composer');
      await V.p.ev(`(document.getElementById('tl-c-text').value = 'Make it primary', document.getElementById('tl-c-text').dispatchEvent(new Event('input', { bubbles: true })), true)`);
      await V.p.ev('tlSend(); void 0');
      await V.soon(`window.__posts.some((x) => x.action === 'thread-new')`, 'setup: the note posted');
      return V.p.ev(`window.__posts.filter((x) => x.action === 'thread-new').pop().body.frame ?? null`);
    };
    const V = await tabOf({}, '#library', { width: 1280, height: 800 });
    await openAt(V, AV_MAIN, 'main');
    const want = await V.p.ev(`({ w: tsFrame().clientWidth, h: tsFrame().clientHeight, hash: TS.hash })`);
    assert.deepEqual(await frameOf(V), want, "the frame element's own size and TS.hash");
    const W = await tabOf({}, '#library', { width: 320, height: 800 });
    await openAt(W, AV_MAIN, 'main');
    assert.equal((await frameOf(W))?.w, 320, '304 wide posts 320');
    const X = await tabOf({}, '#library', { width: 4100, height: 900 });
    await openAt(X, AV_MAIN, 'main');
    assert.equal((await frameOf(X))?.w, 3840, '4000 posts 3840');
    // a window whose frame is under 240 tall (the bar and the margins take the rest)
    const Y = await tabOf({}, '#library', { width: 1280, height: 300 });
    await openAt(Y, AV_MAIN, 'main');
    assert.ok(await Y.p.ev('tsFrame().clientHeight < 240'), 'setup: the frame under 240 tall');
    assert.equal((await frameOf(Y))?.h, 240, 'under 240 tall posts 240');
  });

  await sub('A19: pins show a ring when handed and a check to check; the row says to check and counts as ready', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C1(), ''), [N.plans]: withFrame(ROW.C12(), '') }, '#library?th=open');
    await openAt(V, AV_WT, 'plan-pricing');
    await V.soon(`!!document.querySelector('#av-pins [data-tl-pin="${N.trial}"]') && !!document.querySelector('#av-pins [data-tl-pin="${N.plans}"]')`, 'setup: both pins');
    assert.deepEqual(await V.p.ev(`[document.querySelector('#av-pins [data-tl-pin="${N.trial}"]').classList.contains('handed'), document.querySelector('#av-pins [data-tl-pin="${N.plans}"]').classList.contains('check')]`), [true, true], 'ring and check');
    const look = await V.p.ev(`(() => { const p = (id) => document.querySelector('#av-pins [data-tl-pin="' + id + '"]'), h = getComputedStyle(p(${J(N.trial)})); return [h.backgroundColor, h.borderTopStyle, h.borderTopWidth, getComputedStyle(p(${J(N.plans)}), '::after').content]; })()`);
    assert.deepEqual(look.slice(0, 3), ['rgba(0, 0, 0, 0)', 'solid', '2px'], 'handed: a hollow ring');
    assert.match(look[3], /[^\s"]/, 'check: a mark');
    assert.deepEqual(await V.p.ev(`tButton(tCounts(TL.threads)).cls`), 'ok', 'the button counts it ready');
    assert.equal(await V.p.ev(`!!document.querySelector('[data-tl-open="${N.plans}"] .th-st.ok.icon-check') && document.querySelector('[data-tl-open="${N.plans}"]').closest('li').querySelector('.badge')?.textContent === 'to check'`), true, 'the green mark and the badge');
    assert.equal(await V.p.ev(`tState(TL.threads.find((t) => t.id === ${J(N.plans)}))`), 'ready', 'to check counts as ready');
    assert.match(await V.p.ev(`document.querySelector('[data-tl-open="${N.plans}"]')?.closest('li')?.textContent ?? ''`), /to check/, 'the row says to check');
  });

  await sub('A20: Hand over, With and the stepper are 20px pills between the version pill and Reload', async () => {
    const V = await tabOf({ [N.trial]: ROW.C20(), [N.plans]: ROW.C1() });
    await openAt(V, AV_WT, 'plan-pricing');
    await has(V, '#av-handover', 'Hand over');
    const g = await V.p.ev(`(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); return { h: [r('av-handover').height, r('av-with').height, r('av-next').height], ver: r('av-ver').right, reload: r('av-reload').left, left: Math.min(r('av-handover').left, r('av-step').left), right: Math.max(r('av-handover').right, r('av-with').right, r('av-step').right) }; })()`);
    assert.deepEqual(g.h, [20, 20, 20], '20px');
    assert.deepEqual(await V.p.ev(`['av-prev', 'av-step', 'av-filter'].map((id) => document.getElementById(id).getBoundingClientRect().height)`), [20, 20, 20], '20px, the stepper');
    assert.ok(g.left >= g.ver && g.right <= g.reload, `between the version pill and Reload (${J(g)})`);
  });

  await sub('A21: at 1440x900 the card\'s running text is at most 560px; the bar and the rest uncapped', async () => {
    const V = await tabOf({ [N.trial]: ROW.C12(), [N.hiddenQ]: ROW.C13() }, '#library', { width: 1440, height: 900 });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await has(V, '#tl-card .tl-addr .tx', 'the note');
    const mw = (sel) => `getComputedStyle(document.querySelector(${J(sel)})).maxWidth`;
    assert.deepEqual(await V.p.ev(`[${mw('#tl-card .tl-addr .tx')}, ${mw('#tl-card .tl-turn .tl-text')}]`), ['560px', '560px'], 'the note and the turns');
    // (the withdrawn mark's card, opened by a step onto a note this view doesn't show)
    await V.p.ev(`tlOpen(${J(N.hiddenQ)}, false); void 0`);
    await has(V, '#tl-card .tl-wd .tx', 'the withdrawn mark');
    await V.p.ev(`document.querySelector('#tl-c-note').firstElementChild.insertAdjacentHTML('beforeend', '<div class="tl-nview">x</div><span class="badge">x</span>'); void 0`);
    assert.deepEqual(await V.p.ev(`[${mw('#tl-card .tl-wd .tx')}, ${mw('#tl-card .tl-nview')}]`), ['560px', '560px'], 'the withdrawn mark and the view line');
    assert.deepEqual(await V.p.ev(`['#av-step', '#av-next', '#tl-card .badge', '.tl-pin'].map((q) => getComputedStyle(document.querySelector(q)).maxWidth)`), ['none', 'none', 'none', 'none'], 'the controls uncapped');
    assert.deepEqual(await V.p.ev(`[${mw('#av-notes')}, ${mw('#av-handover')}, ${mw('#tl-c-title')}, ${mw('#artifact-view')}]`), ['none', 'none', 'none', 'none'], 'the bar and the viewer uncapped');
  });
});

test('the viewer: the to-check card in a short window (kit-882)', { skip: canDrive ? false : 'needs Chrome and a Node with WebSocket', timeout: 240000 }, async (t) => {
  const X = await notes(t, 'artifact-notes-short');
  const { sub, N, plant, tabOf, cardOf, holdPoll, openAt, spot, AV_MAIN } = X;
  // kit-882: a to-check card in a short window. One tab, the note on main, its poll held; each case drawn as A26 draws
  // it in three places: hung from the stage's corner (a step onto a note this view doesn't show), beside its spot on
  // screen (tPlace; the page says where the spot is), and with no spot on screen (the dock; the sheet under 640 wide)
  let SHORT = null;
  const shortCard = async () => (SHORT ??= await shortTab());
  async function shortTab() {
    const long = 'The trial button says what it does now, and the price under it reads as the plan page has it. '.repeat(4).slice(0, 300);
    const said = (n) => Array.from({ length: n }, (_, i) => ({ id: `u-${i}`, by: i % 2 ? 'supervisor' : 'owner', at: V_C12.addressed.at, refs: [], text: 'What is said here of the note is about as long as people write, some hundred and sixty characters of it, over a few lines of the card at its width, or so.' }));
    plant(N.onMain, V_C11.shot.stamp);
    const note = (turns, o = {}) => ({ ...ROW.C12({ addressed: ADDR({ note: long }), shot: SHOT({ anchor: 'hidden' }), ...o }), turns: said(turns) });
    const short = { addressed: ADDR({ note: 'Done.' }), shot: null, noshot: 'no-change' };
    const V = await tabOf({ [N.onMain]: note(2) });
    await openAt(V, AV_MAIN, 'main');
    await cardOf(V, N.onMain);
    await holdPoll(V);
    // the terminal's ask as a read of the threads gives it: window.__ask, whatever the stubbed read says
    await V.p.ev(`(window.__ask = null, window.__askSet = askSet, askSet = () => window.__askSet(window.__ask), true)`);
    // a session at work on the note as a read gives it (TL.working): window.__working, whatever the stubbed read says
    await V.p.ev(`(window.__working = null, Object.defineProperty(TL, 'working', { get: () => window.__working ?? {}, set() {}, configurable: true }), true)`);
    const Q = { kind: 'menu', digest: 'd-28', token: 'tok', question: 'Which of the three should it be, with the words the terminal shows over several lines of it?', options: [1, 2, 3].map((n) => ({ n, label: `Option ${n}, said at some length` })), hint: 'Enter to confirm' };
    // [its name, its row, { the terminal's ask, the context open, the tall picture, the box focused when the ask comes,
    //   who is responding on its newest owner turn (the state line: one line for the supervisor, two for a session) }]
    const CASES = [
      ['all of it', note(2), { ask: true, ctx: true, pic: true }],
      ['a conversation', note(16), { ask: true, ctx: true, pic: true }],
      ['a conversation alone', note(16), { pic: true }],
      ['a short mark, one turn, the ask', note(1, short), { ask: true }],
      ['all of it, the ask coming while the box has the focus', note(2), { ask: true, ctx: true, pic: true, focus: true }],
      ['a short mark, the ask coming while the box has the focus', note(1, short), { ask: true, focus: true }],
      ['a short mark, sixteen turns', note(16, short), {}],
      ['the mark, two turns', note(2), {}],
      ['all of it, the supervisor responding', note(2), { ask: true, ctx: true, pic: true, work: 'supervisor' }],
      ['all of it, a session responding', note(2), { ask: true, ctx: true, pic: true, work: 'kit-882-to-check-card-short-window' }],
      ['a short mark, the ask, a session responding', note(1, short), { ask: true, work: 'kit-882-to-check-card-short-window' }],
      ['all of it, the ask coming while the box has the focus, a session responding', note(2), { ask: true, ctx: true, pic: true, focus: true, work: 'kit-882-to-check-card-short-window' }],
    ];
    // each case at w x h, in each place; what each gives back, by its name
    const PLACES = { corner: 'the corner', spot: 'beside its spot', none: 'no spot on screen' };
    const each = async (w, h, look) => {
      await V.size(w, h);
      const out = [];
      for (const where of Object.keys(PLACES)) for (const [name, row, o] of CASES) {
        const corner = where === 'corner';
        // (no focus left from the case before: the card would stay where that one put it)
        await V.p.ev('(window.__ask = null, document.activeElement?.blur?.(), true)');
        // the session's record: for the newest owner turn, begun after every turn (or none)
        const lo = row.turns.findLast((x) => x.by === 'owner')?.id;
        await V.p.ev(`(window.__working = ${o.work ? J({ [N.onMain]: { stage: 'responding', by: o.work, turn: lo, at: new Date(Date.now() + 3600e3).toISOString() } }) : 'null'}, true)`);
        await V.rows({ [N.onMain]: row });
        await V.p.ev(`(() => {
          avStep.unseen = () => ${corner}; avStep.off = ${corner ? '{ id: TL.open, av: AV, gone: true }' : 'null'};
          tlDraw();
          const d = document.querySelector('#tl-c-ctx details'); if (d) d.open = ${!!o.ctx};
          document.getElementById('zz-ctx')?.remove();
          if (d && ${!!o.ctx}) d.insertAdjacentHTML('beforeend', '<div id="zz-ctx" style="height:220px">long</div>');
          const i = document.querySelector('#tl-card .tl-shot img');
          if (i) i.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="700"><rect width="390" height="700" fill="red"/></svg>');
          return true; })()`);
        if (o.pic) await V.soon(`document.querySelector('#tl-card .tl-shot img')?.naturalHeight === 700`, `setup: a tall picture (${name})`);
        // the spot at the stage's top left as the page says it; or none, as when the lens can't find it on this view
        if (where === 'spot') await spot(V, N.onMain, { x: 24, y: 12, w: 80, h: 20 });
        else await V.p.ev(`(TS.rects.delete(TS.keyOf.get(tKey(TL.threads.find((t) => t.id === ${J(N.onMain)}).subject))), tlDraw(), true)`);
        await V.p.ev(FRAMES);
        await V.p.ev(FRAMES);
        // the terminal's ask comes once the card is placed, drawn as the page draws it (tlDraw: the card placed, then the ask),
        // with the box focused first in the focus cases; looked at once the frames after it have run
        if (o.focus) await V.p.ev(`(document.getElementById('tl-c-text').focus(), document.activeElement.id)`);
        if (o.ask) { await V.p.ev(`(window.__ask = ${J(Q)}, true)`); await V.rows({ [N.onMain]: row }); }
        await V.p.ev(FRAMES);
        await V.p.ev(FRAMES);
        const ask = `if (${!!o.focus} && document.activeElement?.id !== 'tl-c-text') return ['setup: the box lost the focus'];`;
        // (each place as it should be: hung for the corner and the spot, the dock or the sheet for none)
        const placed = `(() => { const c = document.getElementById('tl-card').classList, m = c.contains('sheet') ? 'sheet' : c.contains('in-dock') ? 'dock' : 'hung';
          const want = innerWidth < 640 ? 'sheet' : ${J(where)} === 'none' ? 'dock' : 'hung'; return m === want ? [] : ['setup: the card is ' + m + ', not ' + want]; })()`;
        for (const x of await V.p.ev(`(() => { ${ask} return [...${placed}, ...${look(corner, o)}]; })()`)) out.push(`${w}x${h}, ${PLACES[where]}, ${name}: ${x}`);
      }
      return out;
    };
    return { V, each };
  }

  for (const [w, h] of [[844, 390], [667, 375], [430, 360], [1280, 360]]) await sub(`A28: at ${w}x${h} every control of the to-check card is inside the window and under nothing`, async () => {
    const { each } = await shortCard();
    const bad = [];
    {
      bad.push(...await each(w, h, (corner, o) => `(() => {
        const card = document.getElementById('tl-card'), out = [], $ = (s) => card.querySelector(s);
        if (card.querySelectorAll('[data-ask-option]').length !== ${o.ask ? 3 : 0}) out.push('setup: the ask');
        if (!!$('#tl-c-ctx details')?.open !== ${!!o.ctx}) out.push('setup: the context');
        // (a held Resolve is see-through: asked as it is once settled)
        $('[data-tl-accept]')?.classList.remove('waiting');
        for (const s of ['.tl-addr [data-tl-show]', '.tl-addr [data-tl-accept]', '#tl-c-text', '[data-tl-send]']) {
          const e = $(s), r = e?.getBoundingClientRect();
          if (!r || !(r.width > 10 && r.height > 10) || r.top < 0 || r.left < 0 || r.right > innerWidth || r.bottom > innerHeight) { out.push(s + ' is at ' + (r ? [r.left, r.top, r.right, r.bottom].map(Math.round) : 'none') + ' in ' + innerWidth + 'x' + innerHeight); continue; }
          for (const f of [0.15, 0.5, 0.85]) { const hit = document.elementFromPoint(r.left + r.width * f, r.top + r.height * f); if (!e.contains(hit)) { out.push(s + ' is under ' + (hit ? hit.id || hit.className || hit.tagName : 'nothing')); break; } }
        }
        // the state line as the case means it: '… is responding…' over one line (the supervisor) or two (a session; one
        // in the sheet, as wide as the window), its height against one line's, measured with one word in it
        if (${!!o.work}) {
          const st = document.getElementById('tl-c-state'), box = st.parentElement, words = st.textContent, lines = ${o.work === 'supervisor' ? 1 : 2} === 2 && !card.classList.contains('sheet') ? 2 : 1;
          const h = box.getBoundingClientRect().height; st.textContent = 'x'; const one = box.getBoundingClientRect().height; st.textContent = words;
          if (!/ is responding…$/.test(words) || Math.abs(h - lines * one) > 1) out.push('setup: the state line ' + JSON.stringify(words) + ' is ' + Math.round(h) + 'px, ' + lines + ' line(s) of ' + Math.round(one) + 'px');
        }
        return out; })()`));
    }
    assert.deepEqual(bad, [], 'every control in reach');
  });

  await sub('A29: at 1280x800 the card keeps its place, its cap and its floors, and the bar is its own', async () => {
    const { each } = await shortCard();
    const bad = await each(1280, 800, (corner) => `(() => {
      const card = document.getElementById('tl-card'), c = card.getBoundingClientRect(), out = [], $ = (s) => card.querySelector(s);
      if (card.style.maxHeight !== '' || getComputedStyle(card).maxHeight !== '560px') out.push('the cap is ' + (card.style.maxHeight || getComputedStyle(card).maxHeight));
      // where its rule puts it: the stage's corner, or tPlace beside its subject (the dock when it has none on screen)
      const st = document.getElementById('av-stage').getBoundingClientRect(), r = tlTargetRect(TL.threads.find((x) => x.id === TL.open).subject);
      const want = ${corner} ? st.top + 8 : r ? tPlace(r, card.offsetWidth, card.offsetHeight, innerWidth, innerHeight).top : innerHeight - 16 - c.height;
      if (Math.abs(c.top - want) > 0.5) out.push('its top is ' + c.top + ', its rule says ' + want);
      if ($('#tl-c-text').getBoundingClientRect().height !== 56 || getComputedStyle($('.tl-words')).minHeight !== '61px') out.push('the floors: the box ' + $('#tl-c-text').getBoundingClientRect().height + ', the words ' + getComputedStyle($('.tl-words')).minHeight);
      for (const id of ['av-prev', 'av-next', 'av-filter', 'av-ver', 'av-reload', 'av-tab', 'av-close']) {
        const e = document.getElementById(id), b = e?.getBoundingClientRect();
        if (!b || !b.width) continue;
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        if (!e.contains(hit)) out.push(id + ' is under ' + (hit ? hit.id || hit.className || hit.tagName : 'nothing'));
      }
      return out; })()`);
    assert.deepEqual(bad, [], 'nothing moves at 1280x800');
  });
});
