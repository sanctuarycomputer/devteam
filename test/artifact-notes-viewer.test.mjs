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
import { harness, J, FRAMES, VIEWER_UP, CLOSED } from './fixtures/artifact-viewer/harness.mjs';

const SRC = fs.readFileSync(path.join(kit, 'scripts/devteam.mjs'), 'utf8');
const LENS = /const ARTIFACT_LENS = String\.raw`([^`]*)`;/.exec(SRC)[1];
const HTML = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');
const ANCESTOR = 'http://127.0.0.1:4321';

// --- the artifact: two pages, the first with a default view and #annual -----------------------------
const SAY = (page) => `<script>
const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
const rects = () => Object.fromEntries(ids.map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [id, { x: r.left, y: r.top, w: r.width, h: r.height }]; }));
const view = () => { document.body.dataset.view = location.hash === '#annual' ? 'annual' : 'monthly'; };
view();
const say = () => parent.postMessage({ own: 'at', page: ${J(page)}, hash: location.hash, rects: rects() }, '*');
addEventListener('focusin', (e) => parent.postMessage({ own: 'focus', id: e.target.id }, '*'));
addEventListener('load', () => { say(); requestAnimationFrame(() => requestAnimationFrame(say)); });
addEventListener('resize', say);
addEventListener('hashchange', () => { view(); say(); });
</script>`;
const STYLE = `<style>body { margin: 0; font: 16px/1.4 sans-serif; height: 1400px; }
[id] { position: absolute; display: block; box-sizing: border-box; height: 40px; left: 40px; width: 220px; margin: 0; }
#plans-h { top: 40px; } #trial { top: 120px; } #monthly-price { top: 200px; } #annual-price { top: 280px; } #field { top: 360px; } #plan-annual { top: 440px; width: 20px; height: 20px; }
#q-cancel { top: 40px; } #hidden-q { top: 120px; display: none !important; }
body[data-view="annual"] .monthly { display: none !important; } body:not([data-view="annual"]) .annual { display: none !important; }</style>`;
const PRICING = {
  'artifact.json': J({ v: 1, title: 'Pricing mock', summary: 'Plans, a trial, an FAQ', by: 'plan-pricing', for: [] }),
  'index.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pricing</title>${STYLE}</head><body>
<h2 id="plans-h">Plans</h2><button id="trial" type="button">Start trial</button>
<p id="monthly-price" class="monthly">$10 a month</p><p id="annual-price" class="annual">$100 a year</p>
<input id="field" type="text" aria-label="A field"><input id="plan-annual" type="radio" name="plan" aria-label="Annual">
${SAY('pricing/index.html')}</body></html>`,
  'faq.html': `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FAQ</title>${STYLE}</head><body>
<h3 id="q-cancel">Can I cancel?</h3><p id="hidden-q">A hidden answer</p>
<script>document.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault(); });</script>
${SAY('pricing/faq.html')}</body></html>`,
};
const WTS = ['plan-pricing', 'kit-9-x', 'chore-artifact-pricing'];
function writePricing(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, s] of Object.entries(PRICING)) fs.writeFileSync(path.join(dir, f), s);
}
function landPricing(F) {
  writePricing(path.join(F.old, 'docs/devteam/project/artifacts/pricing'));
  F.g(['add', '-A', 'docs'], F.old);
  F.g(['commit', '-qm', 'artifacts: pricing'], F.old);
  F.g(['push', '-q', 'origin', 'main'], F.old);
  for (const w of WTS) writePricing(path.join(F.old, `.worktrees/${w}/docs/devteam/project/artifacts/pricing`));
  const at = 'plan-pricing';
  const el = (selector, tag, text) => ({ selector, tag, text, point: { x: 20, y: 10 } });
  const note = (title, subject, a = at) => F.owner(['thread', 'new', title, '--subject', J({ kind: 'artifact', slug: 'pricing', at: a, ...subject })]).split('\n')[0].trim();
  return {
    trial: note('The trial button', { path: 'index.html', anchor: el('#trial', 'button', 'Start trial'), point: { x: 60, y: 130 } }),
    plans: note('The plans heading', { path: 'index.html', anchor: el('#plans-h', 'h2', 'Plans'), point: { x: 60, y: 50 } }),
    annual: note('The annual price', { path: 'index.html', anchor: el('#annual-price', 'p', '$100 a year'), point: { x: 60, y: 290 } }),
    pointAnnual: note('Empty, on annual', { path: 'index.html#annual', point: { x: 600, y: 300 } }),
    monthly: note('The monthly price', { path: 'index.html', anchor: el('#monthly-price', 'p', '$10 a month'), point: { x: 60, y: 210 } }),
    cancel: note('The cancel question', { path: 'faq.html', anchor: el('#q-cancel', 'h3', 'Can I cancel?'), point: { x: 60, y: 50 } }),
    hiddenQ: note('The hidden answer', { path: 'faq.html', anchor: el('#hidden-q', 'p', 'A hidden answer'), point: { x: 60, y: 130 } }),
    // (a subject's key is its slug, path and spot, not its version: another spot than the trial note's)
    onMain: note('On main', { path: 'index.html', anchor: el('#field', 'input', ''), point: { x: 60, y: 370 } }, 'main'),
  };
}

// --- kit-143's fixture rows (the note fields of a /api/threads row), by case ------------------------
const view = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/artifact-notes/${name}/expected.json`, import.meta.url), 'utf8')).view;
const V_C1 = view('c01-handed'), V_C11 = view('c11-ready-with-shot'), V_C12 = view('c12-addressed-with-shot'), V_C13 = view('c13-unready-after-addressed'), V_C17 = view('c17-ready-noshot'), V_C20 = view('c20-open-never-handed'), V_C9 = view('c09-main-note-supervisor-chore');
// where Show me opens (kit-147's noteSource, which the cases hold no checkout for): set by the case
const HERE = { at: 'plan-pricing', slug: 'pricing' }, MAIN = { at: 'main', slug: 'pricing' };
const AT = V_C12.addressed.at, NEWER = '2026-11-20T10:09:12.000Z';
const SHOT = (o = {}) => ({ ...V_C11.shot, w: 1400, h: 860, dark: false, sum: { light: V_C11.shot.sum.light }, ...o });
const ADDR = (o = {}) => ({ ...V_C12.addressed, ...o });
const ROW = {
  C20: () => ({ ...V_C20 }),
  C1: () => ({ ...V_C1 }),
  C9: (o = {}) => ({ ...V_C9, source: { at: 'chore-artifact-pricing', slug: 'pricing' }, ...o }),
  C12: (o = {}) => ({ ...V_C12, shot: SHOT(), source: HERE, ...o }),
  C11: (o = {}) => ({ ...V_C11, source: MAIN, ...o }),
  C13: () => ({ ...V_C13 }),
  C17: () => ({ ...V_C17, source: MAIN }),
};
const READY_AT = V_C11.ready.at;
const withFrame = (r, hash) => ({ ...r, frame: { w: 1248, h: 700, hash } });

// --- the page's stubs ---------------------------------------------------------------------------------
// /api/threads: each row whose id window.__notes names, with those fields laid over it; POST /api/<action>
// recorded in window.__posts, and answered from window.__replies[action] when the case set one; every
// lens order the dashboard posts, in window.__tsPosts.
const STUB = `(() => {
  if (window !== top || window.__stubbed) return;
  window.__stubbed = true; window.__posts = []; window.__notes = window.__notes || {}; window.__replies = window.__replies || {};
  const real = window.fetch.bind(window);
  window.fetch = async (u, o = {}) => {
    const s = u instanceof Request ? u.url : String(u), p = new URL(s, location.href).pathname;
    if (String(o.method || 'GET').toUpperCase() === 'POST' && p.startsWith('/api/')) {
      const action = p.slice(5); let body = null; try { body = JSON.parse(o.body); } catch {}
      window.__posts.push({ action, body });
      const r = window.__replies[action];
      if (r) { if (r.wait) await new Promise((z) => setTimeout(z, r.wait)); if (r.notes) Object.assign(window.__notes, r.notes); return new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { 'content-type': 'application/json' } }); }
    }
    const res = await real(u, o);
    if (p === '/api/threads' && res.ok) {
      const j = await res.json();
      // the artifact's other notes are left out, so a case is only the rows it names
      j.threads = (j.threads || []).filter((t) => window.__notes[t.id] || t.subject?.slug !== 'pricing').map((t) => (window.__notes[t.id] ? { ...t, ...window.__notes[t.id] } : t));
      return new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return res;
  };
  window.__tsPosts = [];
  const wrap = () => { if (typeof tsPost !== 'function' || tsPost.__w) return; const f = tsPost; window.tsPost = function (m) { window.__tsPosts.push(JSON.parse(JSON.stringify(m))); return f.apply(this, arguments); }; window.tsPost.__w = true; };
  addEventListener('DOMContentLoaded', wrap); wrap();
})()`;

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
  const { F, visit, sub } = await harness(t, 'artifact-notes-viewer');
  const N = landPricing(F);
  const AV_WT = '#artifact/wt/plan-pricing/pricing', AV_MAIN = '#artifact/main/pricing';
  const SHOTS = path.join(F.old, 'docs/devteam/run/shots');
  // a 1x1 PNG, light and dark
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
  const plant = (id, stamp, kinds = ['light']) => { for (const k of kinds) { fs.mkdirSync(path.join(SHOTS, id), { recursive: true }); fs.writeFileSync(path.join(SHOTS, id, `${stamp}-${k}.png`), PNG); } };

  async function rowsIn(V, rows) {
    await V.p.ev(`(window.__notes = ${J(rows)}, true)`);
    const n = await V.p.ev('TL.seq');
    await V.p.ev('tlRefresh()');
    await V.soon(`TL.have > ${n}`, 'setup: the stubbed rows read');
  }
  // up on head (a worktree's or main's), its lens ready
  async function openAt(V, head, at) {
    await V.p.ev(`location.hash = ${J(head)}; void 0`);
    await V.soon(`${VIEWER_UP} && TS.kind === 'artifact' && TS.slug === 'pricing' && TS.at === ${J(at)} && TS.ready`, `setup: the viewer up on pricing at ${at}`);
  }
  const shown = (sel) => `(() => { const e = document.querySelector(${J(sel)}); return !!e && !e.hidden && e.getClientRects().length > 0; })()`;
  const text = (sel) => `(document.querySelector(${J(sel)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`;
  const has = async (V, sel, what) => assert.ok(await V.settle(shown(sel), 4000), `${what}: ${sel} is not shown`);

  // every tab gets V.rows
  // a tab with the stubs in (for this page and every reload), these rows laid over the threads, read once
  const tabOf = async (rows, hash = '#library', size = {}) => { const V = await visit(hash, size); V.rows = (r) => rowsIn(V, r); await V.p.send('Page.addScriptToEvaluateOnNewDocument', { source: STUB }); await V.p.ev(STUB); await V.rows(rows); V.p.click = pressAt(V); return V; };
  // a real press once the element is shown and at rest: a fixed card moves after a scroll or its picture's answer,
  // and p.click's own scrollIntoView would move the card itself
  const pressAt = (V) => async (sel) => {
    await V.soon(`!!document.querySelector(${J(sel)})`, `setup: ${sel} is there`);
    const rect = `(() => { const e = document.querySelector(${J(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`;
    let was = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 60));
      const at = await V.p.ev(rect);
      if (at && was && at.x === was.x && at.y === was.y) { await V.p.clickAt(at.x, at.y); return; }
      was = at;
    }
    throw new Error(`${sel} never came to rest`);
  };


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
    await V.p.click('#av-handover');
    assert.equal(await V.p.ev('window.__again === true'), true, 'setup: the second press reached the pill');
    await V.soon(`window.__posts.some((x) => x.action === 'artifact-handoff')`, 'the press posted');
    assert.ok(await V.settle(`${text('#av-with')} === 'With plan-pricing'`, 4000), 'the first answer');
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
    await stepTo(V, N.pointAnnual);
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

  async function cardOf(V, id) {
    await V.p.ev(`tlOpen(${J(id)}, false); void 0`);
    await V.soon(`TL.open === ${J(id)} && !document.getElementById('tl-card').hidden`, 'setup: the card open');
  }

  // the card's own 2 s poll held, so the card changes only when the test reads the threads (spec-1 F6)
  const holdPoll = (V) => V.p.ev('(TL.polled = true, true)');
  const ARMED = 1100;
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
  await sub('A12c: Resolve waits its second again when its block comes back', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await V.soon(`document.querySelector('#tl-card .tl-addr [data-tl-accept]')?.disabled === false`, 'setup: armed');
    for (const [off, on] of [['TL.resolving = true', 'TL.resolving = false'], ['tlClose()', `tlOpen(${J(N.trial)}, false)`]]) {
      await V.p.ev(`(${off}, tlDraw(), ${on}, tlDraw(), true)`);
      assert.equal(await V.p.ev(`document.querySelector('#tl-card .tl-addr [data-tl-accept]').disabled`), true, `waiting again after ${off}`);
      await V.soon(`document.querySelector('#tl-card .tl-addr [data-tl-accept]')?.disabled === false`, 'armed again');
    }
  });
  await sub('A12: an addressed card says who and what; Resolve sends the at as drawn; a changed note is refused and redrawn', async () => {
    const V = await tabOf({ [N.trial]: ROW.C12() });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await has(V, '#tl-card .tl-addr', 'the addressed block');
    await holdPoll(V);
    assert.equal(await V.p.ev(text('#tl-card .tl-addr .by')), 'Addressed by plan-pricing · 3f7c2a9', 'who, and the commit');
    assert.equal(await V.p.ev(text('#tl-card .tl-addr .tx')), V_C12.addressed.note, 'the note');
    const changed = ROW.C12({ addressed: ADDR({ at: NEWER, note: 'Now the button is green too', sha: null }) });
    await V.p.ev(`(window.__replies['thread-accept-addressed'] = { status: 400, body: { error: 'The note changed; read it again' }, notes: { [${J(N.trial)}]: ${J(changed)} } }, true)`);
    await new Promise((r) => setTimeout(r, ARMED));
    await V.p.click('#tl-card [data-tl-accept]');
    await V.soon(`window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'Resolve posted');
    assert.deepEqual(await V.p.ev(`window.__posts.filter((x) => x.action === 'thread-accept-addressed').map((x) => x.body)`), [{ id: N.trial, at: AT }], 'the at as drawn');
    assert.ok(await V.settle(`${text('#e-tl')} === 'Not saved: The note changed; read it again'`, 4000), 'the refusal shown');
    assert.ok(await V.settle(`${text('#tl-card .tl-addr .tx')} === 'Now the button is green too'`, 3000), 'the card re-read and redrawn with the new note');
  });

  await sub('A12b: Resolve is armed only once the note has sat still', async () => {
    const V = await tabOf({ [N.trial]: ROW.C12() });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await has(V, '#tl-card .tl-addr', 'the addressed block');
    await holdPoll(V);
    await new Promise((r) => setTimeout(r, ARMED));
    await V.rows({ [N.trial]: ROW.C12({ addressed: ADDR({ at: NEWER, note: 'Swapped in', sha: null }) }) });
    await V.soon(`${text('#tl-card .tl-addr .tx')} === 'Swapped in'`, 'the new note drawn');
    await V.p.ev(`(window.__replies['thread-accept-addressed'] = { body: { ok: true, out: '' } }, true)`);
    await V.p.click('#tl-card [data-tl-accept]');
    await V.p.ev(FRAMES);
    assert.equal(await V.p.ev(`window.__posts.filter((x) => x.action === 'thread-accept-addressed').length`), 0, 'a click within the arm time posts nothing');
    await new Promise((r) => setTimeout(r, ARMED));
    await V.p.click('#tl-card [data-tl-accept]');
    await V.soon(`window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'armed: Resolve posts');
    assert.deepEqual(await V.p.ev(`window.__posts.filter((x) => x.action === 'thread-accept-addressed').map((x) => x.body)`), [{ id: N.trial, at: NEWER }], 'the note shown');
  });

  await sub('A12b: Resolve is armed again after a step opens the card', async () => {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), '') });
    await openAt(V, AV_WT, 'plan-pricing');
    await cardOf(V, N.trial);
    await holdPoll(V);
    await new Promise((r) => setTimeout(r, ARMED));
    await V.p.ev(`(window.__replies['thread-accept-addressed'] = { body: { ok: true, out: '' } }, true)`);
    const posts = () => V.p.ev(`window.__posts.filter((x) => x.action === 'thread-accept-addressed').map((x) => x.body.id)`);
    // armed, then opened again by a step (the list's only note)
    assert.ok(await V.settle(`document.querySelector('#tl-card [data-tl-accept]').disabled === false`, 3000), 'setup: armed');
    const k = await V.p.ev('window.__tsPosts.length');
    await V.p.click('#av-next');
    await V.soon(`window.__tsPosts.slice(${k}).some((m) => m.type === 'scroll-to')`, 'setup: stepped');
    // the click itself, however the button looks
    await V.p.ev(`(document.querySelector('#tl-card [data-tl-accept]').disabled = false, document.querySelector('#tl-card [data-tl-accept]').click(), true)`);
    await V.p.ev(FRAMES);
    assert.deepEqual(await posts(), [], 'a click right after a step posts nothing');
    await new Promise((r) => setTimeout(r, ARMED));
    await V.p.click('#tl-card [data-tl-accept]');
    await V.soon(`window.__posts.some((x) => x.action === 'thread-accept-addressed')`, 'armed: Resolve posts');
    assert.deepEqual(await posts(), [N.trial], 'the note shown');
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
    assert.match(await W.p.ev(text('#tl-card')), /Showing main: the version with the change is gone\./, 'the card says so');
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
