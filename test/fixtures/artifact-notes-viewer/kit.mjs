// What the artifact-notes tests share (kit-145): the pricing artifact and its notes, kit-143's rows, the page's stubs, and the
// tab, press and forge helpers over the kit-141 harness. test/artifact-notes-viewer.test.mjs and -press.test.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { kit } from '../../lib/kit.mjs';
import { harness, J, FRAMES, VIEWER_UP } from '../artifact-viewer/harness.mjs';

export const HTML = fs.readFileSync(path.join(kit, 'dashboard/index.html'), 'utf8');

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
addEventListener('message', (e) => { if (e.data && e.data.forge) parent.postMessage({ lens: 1, ...e.data.forge }, '*'); });
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
const view = (name) => JSON.parse(fs.readFileSync(new URL(`../artifact-notes/${name}/expected.json`, import.meta.url), 'utf8')).view;
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

export { SAY, STYLE, PRICING, WTS, writePricing, landPricing, V_C1, HERE, AT, SHOT, ADDR, ROW, READY_AT, withFrame, STUB, V_C11, V_C12, V_C13, V_C17, V_C20, V_C9, MAIN, NEWER };

// The whole setup of one parent test t: the harness on a fixture of its own name, the notes N, and the helpers.
export async function notes(t, name) {
  const { F, visit, sub } = await harness(t, name);
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
  // the control has settled, by the page's own frames: avStep.ready would take the sample itself, and hide a page that takes none
  const LIVE = (el) => `(() => { const el = ${el}; return !!el && performance.now() - avStep.press.last <= 250 && [...avStep.press.seen.values()].some((r) => r.el === el && avStep.settled(r)); })()`;
  const pressAt = (V) => async (sel) => {
    await V.soon(`!!document.querySelector(${J(sel)})`, `setup: ${sel} is there`);
    const rect = `(() => { const e = document.querySelector(${J(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`;
    let was = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 60));
      const at = await V.p.ev(rect);
      if (at && was && at.x === was.x && at.y === was.y && await V.p.ev(`(() => { const e = document.querySelector(${J(sel)}); return !window.avStep?.held?.(e) || ${LIVE('e')}; })()`)) { await V.p.clickAt(at.x, at.y); return; }
      was = at;
    }
    throw new Error(`${sel} never came to rest`);
  };


  async function cardOf(V, id) {
    await V.p.ev(`tlOpen(${J(id)}, false); void 0`);
    await V.soon(`TL.open === ${J(id)} && !document.getElementById('tl-card').hidden`, 'setup: the card open');
  }

  // the card's own 2 s poll held, so the card changes only when the test reads the threads (spec-1 F6)
  const holdPoll = (V) => V.p.ev('(TL.polled = true, true)');
  const ARMED = 1100;
  // a real press where the element is now, without waiting for it to rest
  const at = (V, sel) => V.p.ev(`(() => { const r = document.querySelector(${J(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const press = async (V, sel) => { const { x, y } = await at(V, sel); await V.p.clickAt(x, y); };
  // the to-check block's Resolve has waited its second
  const settled = (V) => V.soon(`(() => { const b = document.querySelector('#tl-card .tl-addr [data-tl-accept]'); return !!b && !b.classList.contains('waiting'); })()`, 'setup: Resolve has settled', 6000);
  // Enter as a keyboard sends it: with its text, so a button takes it
  const enter = async (V) => { const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }; await V.p.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, text: '\r' }); await V.p.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k }); };
  // the page posts what its lens could
  const forge = (V, m) => V.p.ev(`(tsFrame().contentWindow.postMessage({ forge: ${J(m)} }, '*'), true)`);
  // where the page says the note's spot is
  const spot = (V, id, rect) => V.p.ev(`(() => { const key = TS.keyOf.get(tKey(TL.threads.find((t) => t.id === ${J(id)}).subject)); tsFrame().contentWindow.postMessage({ forge: { type: 'rects', rects: [{ key, rect: ${J(rect)} }] } }, '*'); return key; })()`);
  const SETTLE = (sel) => `(() => { const e = document.querySelector(${J(sel)}); if (!e) return 'none'; const r = e.getBoundingClientRect(); return [r.left, r.top].join(); })()`;
  const acts = (V, action) => V.p.ev(`window.__posts.filter((x) => x.action === ${J(action)}).map((x) => x.body)`);
  const HELD = 'That moved just now. Press again in a second.';
  const heldShown = `(() => { const e = document.getElementById('av-held'); return !!e && !e.hidden && e.textContent === ${J(HELD)}; })()`;
  // the card open on its note by the page's own arrow, Resolve settled
  async function byArrow(size) {
    const V = await tabOf({ [N.trial]: withFrame(ROW.C12(), '') }, '#library', size);
    await openAt(V, AV_WT, 'plan-pricing');
    await holdPoll(V);
    await V.p.ev(`(window.__replies['thread-accept-addressed'] = { body: { ok: true, out: '' } }, window.__replies['artifact-handoff'] = { body: { to: 'plan-pricing', typed: true, count: 1 } }, true)`);
    await V.focusFrame();
    await forge(V, { type: 'key', key: 'ArrowRight' });
    await V.soon(`TL.open === ${J(N.trial)} && !document.getElementById('tl-card').hidden`, 'setup: the page opened the card');
    await settled(V);
    return V;
  }
  const tapOn = async (V, sel) => { const { x, y } = await at(V, sel); await V.p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await V.p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  return { sub, F, N, AV_WT, SHOTS, PNG, plant, rowsIn, openAt, shown, text, has, tabOf, pressAt, cardOf, holdPoll, LIVE, ARMED, at, press, settled, enter, forge, spot, SETTLE, acts, HELD, heldShown, byArrow, tapOn, AV_MAIN };
}
