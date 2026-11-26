/* imports start */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { PUSH_BURST } from './base.mjs';
import { PUSH_SEEN_MAX } from './base.mjs';
import { PUSH_URL_MAX } from './base.mjs';
import { listedByRoot } from './base.mjs';
import { wellFormed } from './base.mjs';
/* imports end */
// --- the preview lens: the gateway's own page on a preview's name, framing the app -------------
// The kit's viewer frames it at /.devteam/lens. On the app's own origin, it reads the app's page for
// the viewer over postMessage (spec §7). The kit's laptop relay serves the same bytes, so its
// source is in devteam.mjs too, and a test holds the two equal. It is a String.raw, so its regular
// expressions read as written, and so it may hold no backtick and no dollar sign before a brace.
export const PREVIEW_LENS = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Preview</title><style>html{touch-action:manipulation}html,body{margin:0;height:100%;overflow:hidden;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style></head>
<body><!-- The sandbox is advisory: the same-origin app can lift it. frame-src 'self' is what keeps the app's frame on its own origin. -->
<iframe id="app" title="The app" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-pointer-lock allow-downloads"></iframe><script>
(() => {
  'use strict';
  // devteam's preview lens. It is on the app's own origin, so it can read the app's page. It frames
  // the app, and answers the viewer that frames it, over postMessage, about what is where. It takes
  // only the viewer's questions (hello, hit, resolve, scroll-by, scroll-to, go), tells it only about
  // the app (ready, route, hit-reply, rects, key, errors), and holds nothing of the owner's.
  const CAPS = { selector: 200, tag: 40, role: 40, text: 80, name: 80, html: 1024, route: 300, error: 200, errors: 3 };
  const WATCH_MAX = 200;
  const KEY_MAX = 120;
  const frame = document.getElementById('app');
  const enc = new TextEncoder();
  const size = (s) => enc.encode(s).length;
  // at most n bytes of UTF-8, never half a character
  const cap = (s, n) => {
    const str = String(s == null ? '' : s);
    if (size(str) <= n) return str;
    let out = '';
    let b = 0;
    for (const c of str) { const k = size(c); if (b + k > n) break; out += c; b += k; }
    return out;
  };
  const capDots = (s, n) => (size(s) <= n ? s : cap(s, n - 3) + '\u2026');
  const oneLine = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const num = (v) => typeof v === 'number' && isFinite(v);
  const idOk = (id) => (typeof id === 'string' && id.length > 0 && id.length <= 64) || (Number.isInteger(id) && id >= 0);

  // --- the viewer: the page that frames this one, and only it ----------------------------------
  // This page's frame-ancestors says who that may be. Here: a message must come from that frame
  // (never the app, which shares this origin), and from the origin first heard.
  let viewer = null;
  const tell = (m) => { if (viewer) parent.postMessage(Object.assign({ lens: 1 }, m), viewer); };

  // --- the app ----------------------------------------------------------------------------------
  const appWindow = () => { try { const w = frame.contentWindow; return w && w.document && w.location.href !== 'about:blank' ? w : null; } catch (e) { return null; } };
  const routeOf = (w) => { try { return w.location.origin === location.origin ? cap(w.location.pathname + w.location.search + w.location.hash, CAPS.route) : null; } catch (e) { return null; } };
  // a path on this origin, and never the lens's own
  const safeRoute = (r) => {
    if (typeof r !== 'string' || r[0] !== '/' || r[1] === '/' || r.indexOf('\\') >= 0 || size(r) > 2048) return null;
    try { const u = new URL(r, location.origin); return u.origin === location.origin && u.pathname.indexOf('/.devteam/') !== 0 ? u.pathname + u.search + u.hash : null; } catch (e) { return null; }
  };

  // --- what is where ------------------------------------------------------------------------------
  // an id or a class a person wrote, not one a build made (digit runs, hashes, React's :r1:)
  const plain = (s) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s) && !/[0-9]{3,}/.test(s) && !s.split(/[-_]/).some((p) => p.length >= 5 && /[0-9]/.test(p) && /[A-Za-z]/.test(p));
  const only = (doc, sel) => { try { return doc.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  const quoted = (v) => '"' + String(v).replace(/["\\]/g, '\\$&') + '"';
  const selectorOf = (el, doc) => {
    const tag = el.localName;
    if (el.id && plain(el.id) && only(doc, '#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    for (const [n, ok] of [['data-testid', true], ['name', /^(input|select|textarea|button|form)$/.test(tag)], ['aria-label', true]]) {
      const v = el.getAttribute(n);
      const sel = v ? tag + '[' + n + '=' + quoted(v) + ']' : '';
      if (ok && v && size(sel) <= CAPS.selector && only(doc, sel)) return sel;
    }
    const steps = [];
    for (let e = el; e && e.nodeType === 1 && e !== doc.documentElement && steps.length < 6; e = e.parentElement) {
      if (e !== el && e.id && plain(e.id) && only(doc, '#' + CSS.escape(e.id))) { steps.unshift('#' + CSS.escape(e.id)); break; }
      let n = 1;
      for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === e.localName) n += 1;
      steps.unshift(e.localName + Array.prototype.filter.call(e.classList, plain).slice(0, 2).map((c) => '.' + CSS.escape(c)).join('') + ':nth-of-type(' + n + ')');
    }
    while (steps.length > 1 && size(steps.join(' > ')) > CAPS.selector) steps.shift();
    return cap(steps.join(' > '), CAPS.selector);
  };
  const ROLES = { button: 'button', select: 'combobox', textarea: 'textbox', img: 'img', nav: 'navigation', main: 'main', header: 'banner', footer: 'contentinfo', form: 'form', table: 'table', ul: 'list', ol: 'list', li: 'listitem', dialog: 'dialog', aside: 'complementary', section: 'region', option: 'option', summary: 'button' };
  const INPUTS = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', search: 'searchbox' };
  const roleOf = (el) => {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.localName;
    if (t === 'a') return el.hasAttribute('href') ? 'link' : '';
    if (t === 'input') return INPUTS[(el.getAttribute('type') || 'text').toLowerCase()] || 'textbox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    return ROLES[t] || '';
  };
  const nameOf = (el, doc) => {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    const by = el.getAttribute('aria-labelledby');
    const named = by ? by.split(/\s+/).map((id) => { const x = doc.getElementById(id); return x ? x.textContent : ''; }).join(' ') : '';
    if (oneLine(named)) return named;
    if (el.labels && el.labels.length) return el.labels[0].textContent;
    for (const n of ['alt', 'title', 'placeholder']) { const v = el.getAttribute(n); if (v) return v; }
    return el.textContent;
  };
  // the element with its own children, each child's contents collapsed to an ellipsis
  const htmlOf = (el) => {
    const top = el.cloneNode(false);
    let k = 0;
    for (const c of el.childNodes) {
      if (++k > 50) { top.appendChild(el.ownerDocument.createTextNode('\u2026')); break; }
      if (c.nodeType === 3) top.appendChild(c.cloneNode(false));
      else if (c.nodeType === 1) { const d = c.cloneNode(false); if (c.firstChild) d.textContent = '\u2026'; top.appendChild(d); }
    }
    return capDots(top.outerHTML, CAPS.html);
  };
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const textOf = (el) => cap(oneLine(el.textContent), CAPS.text);
  const anchorOf = (el, doc, x, y) => {
    const rect = rectOf(el);
    return { selector: selectorOf(el, doc), tag: cap(el.localName, CAPS.tag), role: cap(roleOf(el), CAPS.role), text: textOf(el), name: cap(oneLine(nameOf(el, doc)), CAPS.name), html: htmlOf(el), rect, point: { x: Math.round(x - rect.x), y: Math.round(y - rect.y) } };
  };
  // Where an anchor is now: by its selector (changed: with other text now), else an element of its
  // tag with its text, the nearest to where it was.
  const find = (doc, a) => {
    let el = null;
    try { el = doc.querySelector(a.selector); } catch (e) { el = null; }
    if (el) { const t = textOf(el); return { el, changed: typeof a.text === 'string' && t !== a.text, text: t }; }
    if (typeof a.text !== 'string' || !a.text || typeof a.tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(a.tag)) return null;
    const was = a.rect && num(a.rect.x) && num(a.rect.y) ? a.rect : { x: 0, y: 0 };
    const all = doc.getElementsByTagName(a.tag);
    let best = null;
    let far = Infinity;
    for (let i = 0; i < all.length && i < 5000; i++) {
      if (textOf(all[i]) !== a.text) continue;
      const r = all[i].getBoundingClientRect();
      const d = Math.hypot(r.left - was.x, r.top - was.y);
      if (d < far) { far = d; best = all[i]; }
    }
    return best ? { el: best, changed: false, text: a.text } : null;
  };

  // --- what the viewer watches: sent when it moves --------------------------------------------
  let watched = [];
  let sent = '';
  const sendRects = (id) => {
    const w = appWindow();
    const rects = watched.map((x) => { const f = w ? find(w.document, x.anchor) : null; return f ? { key: x.key, rect: rectOf(f.el), changed: f.changed, text: f.text } : { key: x.key, rect: null }; });
    const now = JSON.stringify(rects);
    if (id === undefined && now === sent) return;
    sent = now;
    tell(id === undefined ? { type: 'rects', rects } : { type: 'rects', id, rects });
  };
  let framePending = false;
  const soon = () => { if (framePending || !watched.length) return; framePending = true; requestAnimationFrame(() => { framePending = false; sendRects(); }); };
  let settle = 0;
  const later = () => { if (!watched.length) return; clearTimeout(settle); settle = setTimeout(() => sendRects(), 100); };

  // --- what the app does: its route, its keys, its errors ----------------------------------------
  let route = null;
  const checkRoute = () => { const w = appWindow(); const r = w ? routeOf(w) : null; if (r === route) return; route = r; tell({ type: 'route', route: r }); soon(); };
  let errors = [];
  const describe = (x) => { try { return x && typeof x === 'object' && 'message' in x ? String(x.message) : String(x); } catch (e) { return 'an error'; } };
  const noteError = (text) => { const one = cap(oneLine(text), CAPS.error); if (!one) return; errors = errors.concat(one).slice(-CAPS.errors); tell({ type: 'errors', errors }); };
  let shiftDown = false;
  const onKey = (e) => {
    if (e.key !== 'Shift' && e.key !== 'Escape') return;
    shiftDown = e.type === 'keydown' ? e.key === 'Shift' || e.shiftKey : e.key !== 'Shift' && e.shiftKey;
    tell({ type: 'key', key: e.key, shift: shiftDown, ...(e.type === 'keyup' ? { up: true } : {}) });
  };
  const onBlur = () => { if (shiftDown) { shiftDown = false; tell({ type: 'key', key: 'Shift', shift: false }); } };
  const readyOf = (w) => (w ? { type: 'ready', route: routeOf(w), title: cap(oneLine(w.document.title), CAPS.text), viewport: { w: w.innerWidth, h: w.innerHeight } } : { type: 'ready', route: null, title: '', viewport: null });
  // Each page the app loads is a new window: listen on it, in the capture phase so the app can't stop
  // a key reaching here, and note the errors it logs from then on.
  let attached = null;
  const attach = () => {
    const w = appWindow();
    if (!w || w.document === attached) return;
    attached = w.document;
    errors = [];
    try {
      w.addEventListener('keydown', onKey, true);
      w.addEventListener('keyup', onKey, true);
      w.addEventListener('blur', onBlur);
      w.addEventListener('error', (e) => { if (e && e.message) noteError(e.message); }, true);
      w.addEventListener('unhandledrejection', (e) => noteError('Unhandled rejection: ' + describe(e.reason)));
      const own = w.console && w.console.error;
      if (typeof own === 'function') w.console.error = function () { noteError(Array.prototype.map.call(arguments, describe).join(' ')); return own.apply(this, arguments); };
      w.addEventListener('scroll', soon, true);
      w.addEventListener('resize', soon);
      w.addEventListener('popstate', checkRoute);
      w.addEventListener('hashchange', checkRoute);
      new w.MutationObserver(later).observe(w.document, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (e) { /* a page that can't be watched is still framed */ }
    route = routeOf(w);
    tell(readyOf(w));
    sendRects();
  };

  // --- the viewer's questions ----------------------------------------------------------------------
  let last = { x: 0, y: 0 };
  const ORDERS = {
    hello: () => { tell(readyOf(appWindow())); if (errors.length) tell({ type: 'errors', errors }); },
    hit: (m) => {
      if (!idOk(m.id) || !num(m.x) || !num(m.y)) return;
      const w = appWindow();
      const doc = w && w.document;
      let el = doc ? doc.elementFromPoint(m.x, m.y) : null;
      // the page itself is no thing to point at: the viewer pins the point instead
      if (el && (el === doc.documentElement || el === doc.body)) el = null;
      last = { x: m.x, y: m.y };
      const anchor = el ? anchorOf(el, doc, m.x, m.y) : null;
      tell({ type: 'hit-reply', id: m.id, anchor, rect: anchor ? anchor.rect : null, route: w ? routeOf(w) : null });
    },
    resolve: (m) => {
      if (!idOk(m.id) || !Array.isArray(m.anchors)) return;
      watched = m.anchors.slice(0, WATCH_MAX).filter((x) => x && typeof x.key === 'string' && size(x.key) <= KEY_MAX && x.anchor && typeof x.anchor === 'object' && typeof x.anchor.selector === 'string' && size(x.anchor.selector) <= CAPS.selector).map((x) => ({ key: x.key, anchor: x.anchor }));
      sendRects(m.id);
    },
    'scroll-by': (m) => {
      const w = appWindow();
      if (!w) return;
      const step = (v) => (num(v) ? Math.max(-10000, Math.min(10000, v)) : 0);
      const at = num(m.x) && num(m.y) ? { x: m.x, y: m.y } : last;
      // the box under the pointer that scrolls, else the page
      for (let el = w.document.elementFromPoint(at.x, at.y); el && el !== w.document.body && el !== w.document.documentElement; el = el.parentElement) {
        const s = w.getComputedStyle(el);
        if (/(auto|scroll|overlay)/.test(s.overflowY + ' ' + s.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) { el.scrollBy(step(m.dx), step(m.dy)); return; }
      }
      w.scrollBy(step(m.dx), step(m.dy));
    },
    'scroll-to': (m) => {
      const w = appWindow();
      const a = m.anchor;
      if (!w || !a || typeof a !== 'object' || typeof a.selector !== 'string' || size(a.selector) > CAPS.selector) return;
      const f = find(w.document, a);
      if (f) f.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    },
    go: (m) => { const r = safeRoute(m.route); if (r) frame.src = r; },
  };
  addEventListener('message', (e) => {
    if (!e.isTrusted) return;
    if (e.source !== parent || parent === window) return;
    if (e.origin === location.origin || e.origin === 'null') return;
    const ancestors = location.ancestorOrigins;
    if (ancestors && ancestors.length && ancestors[0] !== e.origin) return;
    if (viewer && e.origin !== viewer) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || m.lens !== 1 || typeof m.type !== 'string' || !Object.prototype.hasOwnProperty.call(ORDERS, m.type)) return;
    viewer = e.origin;
    try { ORDERS[m.type](m); } catch (err) { /* one bad question costs only itself */ }
  });
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKey, true);
  // the poll can find a page mid-parse (no title yet): its load says ready again, whatever attach did
  frame.addEventListener('load', () => { attach(); const w = appWindow(); if (w) tell(readyOf(w)); checkRoute(); });
  // an SPA's pushState can't be seen without touching its code: the route is polled
  setInterval(() => { attach(); checkRoute(); }, 250);
  setInterval(() => { if (watched.length) sendRects(); }, 1000);
  frame.src = safeRoute(new URLSearchParams(location.search).get('route')) || '/';
})();
</script></body></html>
`;
// The lens's policy: its one script and its one style by hash, its own origin to frame, and who may hold it.
export const lensPart = (tag) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(PREVIEW_LENS)[1];
export const lensHash = (tag) => `'sha256-${crypto.createHash('sha256').update(lensPart(tag)).digest('base64')}'`;
export const previewLensCsp = (ancestors) => `default-src 'none'; script-src ${lensHash('script')}; style-src ${lensHash('style')}; frame-src 'self'; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'none'`;
// What the hub page marks with "!" (a supervisor at a usage limit, the operator's box-alert), pushed
// when it turns up or changes, so it needs no page open. The list is checked as the Inbox counts are,
// and capped; one alert on every repo's tab is one push.
export const ALERT_MAX = 200;
export const BOX_KEY = '\u0000box';
// an earlier box text still folded on a lagging older kit's alert (each dashboard refreshes on its
// own timer, so an older kit can drop the box's copy a poll after this kit drops box_alert)
export const BOX_WAS = '\u0000box-was';
// the box's text folded at the end (every kit folds it, for older readers): matched whole or as a
// " · " suffix against the untouched text, never split, so one holding " · " still comes off
export const lessBox = (a, b) => (!a || !b ? a : a === b ? '' : a.endsWith(` · ${b}`) ? a.slice(0, -(b.length + 3)).trim() : a);
export function alertNews(seen, instances, ports, resting = new Set()) {
  const list = listedByRoot(instances, ports);
  const next = {};
  const fresh = new Map();
  // the box's own alert (box_alert, the same on every hello) is one push named for the box; a
  // project's alert is its own, less the box's, which every kit folds in at its end for older readers
  const boxRaw = list.map((x) => (typeof x.box_alert === 'string' ? x.box_alert.trim() : '')).find(Boolean) || '';
  const boxText = boxRaw ? wellFormed(boxRaw.slice(0, ALERT_MAX)) : '';
  // a gateway from before box_alert stored each project's whole alert, the box's folded in: that
  // copy was pushed already, so it counts as the box's seen and comes off each project's
  if (boxText && !Object.hasOwn(seen, BOX_KEY) && Object.entries(seen).some(([k, v]) => k !== BOX_WAS && typeof v === 'string' && lessBox(v, boxText) !== v)) {
    seen = Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, typeof v === 'string' ? lessBox(v, boxText) : v]));
    seen[BOX_KEY] = boxText;
  }
  if (boxText) {
    next[BOX_KEY] = boxText;
    if (seen[BOX_KEY] !== boxText && !resting.has(`alert:${boxText}`)) fresh.set(boxText, ['the box']);
  }
  // the box texts this gateway knew before this poll, other than the current one
  const was = [seen[BOX_KEY], seen[BOX_WAS]].filter((t) => typeof t === 'string' && t && t !== boxText);
  for (const x of list) {
    const a = typeof x.alert === 'string' ? x.alert.trim() : '';
    const b = typeof x.box_alert === 'string' && x.box_alert.trim() ? x.box_alert.trim() : boxRaw;
    let own = lessBox(a, b);
    // an older kit still folding a box text that has since cleared or changed: it comes off too, and
    // is remembered while any project still carries it
    for (const t of was) {
      const less = lessBox(own, t);
      if (less !== own) { next[BOX_WAS] = t; own = less; }
    }
    if (!own) continue;
    const text = wellFormed(own.slice(0, ALERT_MAX));
    if (!text) continue;
    next[x.root] = text;
    if (seen[x.root] !== text && !resting.has(`alert:${text}`)) (fresh.get(text) ?? fresh.set(text, []).get(text)).push(wellFormed(String(x.name ?? x.root).slice(0, 80)));
  }
  let messages = [...fresh.entries()].map(([text, names]) => ({ title: names.length === 1 && names[0] === 'the box' ? 'Box alert' : `Alert (${names.join(', ').slice(0, 80)})`, body: text, tag: wellFormed(`devteam-alert-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)}`), url: '/' }));
  const keys = [...fresh.keys()].map((t) => `alert:${t}`);
  if (messages.length > PUSH_BURST) messages = [{ title: `${messages.length} alerts on this box`, body: [...fresh.keys()].join(' · ').slice(0, ALERT_MAX), tag: 'devteam-alerts', url: '/' }];
  return { seen: next, messages, keys };
}

// What the hub page would notify about, from two reads of the list: an Inbox that went up (an
// instance not seen before counts from nothing). Whatever holds the hub's port wrote this list, so
// it is checked as the page checks it, and kept short.
export function inboxNews(seen, instances, ports, resting = new Set()) {
  const list = listedByRoot(instances, ports);
  const named = new Map();
  for (const x of list) named.set(x.name, (named.get(x.name) ?? 0) + 1);
  const next = { ...seen };
  let messages = [];
  const roots = [];
  const names = [];
  for (const x of list) {
    try {
      // a root that just notified is left as it was, rises and falls alike, until it has rested
      if (!Number.isInteger(x.inbox) || x.inbox < 0 || resting.has(x.root)) continue;
      const before = Object.hasOwn(seen, x.root) ? seen[x.root] : 0;
      next[x.root] = x.inbox;
      if (x.inbox <= before) continue;
      const name = wellFormed(String(x.name ?? x.root).slice(0, 80));
      // the hub page's address for this tab (its keyOf): two of one name are told apart by their root
      const key = named.get(x.name) > 1 ? `${String(x.name)}-${crypto.createHash('sha1').update(x.root).digest('hex').slice(0, 6)}` : String(x.name);
      const url = `/#${encodeURIComponent(wellFormed(key))}`;
      messages.push({ title: `${name}: ${x.inbox - before} new in the Inbox`, body: wellFormed(x.root.slice(0, 200)), tag: wellFormed(`devteam-${x.root}`.slice(0, 256)), url: url.length > PUSH_URL_MAX ? '/' : url });
      roots.push(x.root);
      names.push(name);
    } catch {}
  }
  if (messages.length > PUSH_BURST) messages = [{ title: `${messages.length} instances have new Inbox items`, body: wellFormed(names.join(', ').slice(0, 200)), tag: 'devteam-inbox', url: '/' }];
  // only what's no longer listed is forgotten, oldest first: a live root forgotten would be all news again
  const live = new Set(list.map((x) => x.root));
  let over = Object.keys(next).length - PUSH_SEEN_MAX;
  for (const k of Object.keys(next)) {
    if (over <= 0) break;
    if (!live.has(k)) { delete next[k]; over -= 1; }
  }
  return { seen: next, messages, roots };
}

// --- installing the hub: its manifest, icons and service worker ----------------------------------
export const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
// A white "d" on black: drawn here so the image needs no file of its own.
export function iconPng(size) {
  const lit = (x, y) => { const d = Math.hypot(x - 0.46, y - 0.6); return (d <= 0.22 && d >= 0.12) || (x >= 0.58 && x <= 0.68 && y >= 0.2 && y <= 0.8); };
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let on = 0;
    for (const i of [1, 3, 5]) for (const j of [1, 3, 5]) if (lit((x + i / 6) / size, (y + j / 6) / size)) on++;
    raw.fill(Math.round((on / 9) * 255), y * (size * 3 + 1) + 1 + x * 3, y * (size * 3 + 1) + 4 + x * 3);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export const ICON_SIZES = [180, 192, 512];
export const MANIFEST = JSON.stringify({ name: 'devteam', short_name: 'devteam', start_url: '/', scope: '/', display: 'standalone', background_color: '#000000', theme_color: '#000000', icons: ICON_SIZES.map((n) => ({ src: `/icon-${n}.png`, sizes: `${n}x${n}`, type: 'image/png' })) });
// It shows every push (iOS ends a subscription that pushes without showing) and opens the tab the
// notification names. It has no fetch handler, so it never stands between a page and the box.
export const SERVICE_WORKER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'devteam: new in the Inbox', { body: d.body, tag: d.tag, data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data.url, self.location.origin);
  e.waitUntil((async () => {
    const hub = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).find((c) => ['/', '/index.html'].includes(new URL(c.url).pathname));
    if (!hub) return self.clients.openWindow(url.href);
    try { await hub.focus(); } catch {}
    hub.postMessage({ hash: url.hash });
  })());
});
`;
export const iconCache = new Map();
export const INSTALL = Object.assign(Object.create(null), {
  '/manifest.webmanifest': { type: 'application/manifest+json', body: () => MANIFEST },
  '/sw.js': { type: 'text/javascript; charset=utf-8', body: () => SERVICE_WORKER },
  ...Object.fromEntries(ICON_SIZES.map((n) => [`/icon-${n}.png`, { type: 'image/png', body: () => { if (!iconCache.has(n)) iconCache.set(n, iconPng(n)); return iconCache.get(n); } }])),
});

// --- public artifacts: what the owner published, served to anyone from the gateway's own copy ---
// The kit's rules for serving an artifact, kept here because the gateway runs apart from any
// checkout: its type map, its CDN list, its path rule and its policy. A test compares each with the
// kit's, so a change there fails until it is made here too (and the box deploys with it).
export const PUBLIC_TYPES = Object.assign(Object.create(null), { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8' });
export const PUBLIC_CDNS = ['https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com'];
export const publicPathOk = (p) => /^[A-Za-z0-9._/-]+$/.test(p) && p.split('/').every((s) => s && !s.startsWith('.'));
// The kit's artifact policy, its own folder as self, framed by nothing. The sandbox (no
// allow-same-origin) makes the page an opaque origin, so it can't read or write the box's cookies.
// frame-src 'none' is load-bearing too: a published page is served on its project's own host, whose
// dashboard pages accept 'self' as a frame ancestor, and frame-ancestors matches by URL, not origin,
// so a published page that could frame would satisfy it, sandbox or not. A test pins both.
export const publicCsp = (self) => {
  const cdns = PUBLIC_CDNS.join(' ');
  return [
    "default-src 'none'", `script-src 'unsafe-inline' 'unsafe-eval' ${self} ${cdns}`, `style-src 'unsafe-inline' ${self} ${cdns} https://fonts.googleapis.com`, `font-src ${self} ${cdns} https://fonts.gstatic.com data:`,
    `img-src ${self} data: blob:`, `media-src ${self} data: blob:`, `connect-src ${self} ${cdns}`, `worker-src ${self} blob:`, "frame-src 'none'", "form-action 'none'", "base-uri 'none'",
    "frame-ancestors 'none'", 'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock',
  ].join('; ');
};
// The frame-ancestors directive of each policy in a header (several arrive joined by ", "), with
// what precedes it and the list it names.
export const FRAME_ANCESTORS = /(^|[;,])(\s*)frame-ancestors(?=[\s;,]|$)([^;,]*)/gi;
// Who may frame the page, replaced in every policy that says. A policy that doesn't say gets nothing.
export const replaceFrameAncestors = (csp, sources) => csp.replace(FRAME_ANCESTORS, (all, sep, sp, list) => `${sep}${sp}frame-ancestors ${sources}${/\s$/.test(list) ? ' ' : ''}`);
export const LINK_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// a project's name, as the kit requires it for publishing: part of every public URL
export const PROJECT = /^[a-z0-9][a-z0-9._-]{0,62}$/;
export const TREE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
export const FILE_MAX = 8 * 1024 * 1024;
export const ARTIFACT_MAX = 25 * 1024 * 1024;
export const MANIFEST_KEYS = ['public', 'project', 'slug', 'title', 'summary', 'root', 'tree', 'files', 'recorded'];
export const hex256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
// at most n of fn at a time, the answers in the items' order
export async function mapPool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
// The kit's canonical JSON: the owner confirms a manifest by its sha256, so both sides hash one text.
export const canonicalJson = (v) => (Array.isArray(v) ? `[${v.map(canonicalJson).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}` : JSON.stringify(v));
// Whatever holds an instance's port wrote this, so it is checked as untrusted data, and only then
// shown (escaped) or followed: every path the kit would serve, every size within the kit's limits.
export function manifestProblem(m, slug) {
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.public !== 1) return 'not a manifest';
  const extra = Object.keys(m).find((k) => !MANIFEST_KEYS.includes(k));
  if (extra) return `unknown key "${extra.slice(0, 40)}"`;
  if (typeof m.project !== 'string' || !PROJECT.test(m.project)) return 'the project name is not one a public link can carry';
  if (typeof m.root !== 'string' || !m.root.startsWith('/') || m.root.length > 1024 || /[\u0000-\u001f\u007f]/.test(m.root)) return 'root is not an absolute path';
  if (m.slug !== slug) return `the manifest is for ${String(m.slug).slice(0, 80)}, not ${slug}`;
  if (typeof m.tree !== 'string' || !TREE.test(m.tree)) return 'tree is not a git tree id';
  // what the instance's log says was last published: shown as that, and never relied on
  if (m.recorded !== undefined && (!m.recorded || typeof m.recorded !== 'object' || Array.isArray(m.recorded) || typeof m.recorded.tree !== 'string' || !TREE.test(m.recorded.tree) || typeof m.recorded.at !== 'string' || m.recorded.at.length > 40)) return 'recorded is not a tree and a date';
  if (typeof m.title !== 'string' || m.title.length > 120 || typeof m.summary !== 'string' || m.summary.length > 500) return 'title or summary is not the kit\'s one line of text';
  const files = m.files && typeof m.files === 'object' && !Array.isArray(m.files) ? Object.entries(m.files) : [];
  if (!files.length || files.length > 2000) return 'a manifest lists 1 to 2000 files';
  let total = 0;
  for (const [rel, f] of files) {
    if (!publicPathOk(rel)) return `${rel.slice(0, 120)}: not a path the kit serves`;
    if (!f || typeof f !== 'object' || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isInteger(f.size) || f.size < 0 || f.size > FILE_MAX || !['100644', '100755'].includes(f.mode)) return `${rel}: a bad entry (sha256, a size up to 8 MB, mode 100644 or 100755)`;
    total += f.size;
  }
  if (total > ARTIFACT_MAX) return 'over 25 MB in all';
  if (!Object.hasOwn(m.files, 'index.html')) return 'no index.html';
  return null;
}
// git's own object ids, from the bytes: the record then names a tree git can check against main.
export const gitBlobId = (buf, algo = 'sha1') => crypto.createHash(algo).update(`blob ${buf.length}\0`).update(buf).digest('hex');
export function gitTreeId(files, algo = 'sha1') {
  const root = new Map();
  for (const [rel, f] of Object.entries(files)) {
    const parts = rel.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.has(parts[i])) node.set(parts[i], new Map());
      node = node.get(parts[i]);
      if (!(node instanceof Map)) throw new Error(`${parts.slice(0, i + 1).join('/')} is both a file and a folder`);
    }
    if (node.get(parts.at(-1)) instanceof Map) throw new Error(`${rel} is both a file and a folder`);
    node.set(parts.at(-1), f);
  }
  // git sorts a tree's entries by name, a folder's name as if it ended in "/"
  const write = (node) => {
    const entries = [...node].map(([name, v]) => (v instanceof Map ? { name, key: `${name}/`, mode: '40000', oid: write(v) } : { name, key: name, mode: v.mode, oid: v.oid }));
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
    const body = Buffer.concat(entries.flatMap((e) => [Buffer.from(`${e.mode} ${e.name}\0`), Buffer.from(e.oid, 'hex')]));
    return crypto.createHash(algo).update(`tree ${body.length}\0`).update(body).digest('hex');
  };
  return write(root);
}
// The published bytes, content-addressed under the gateway's own directory (no agent can write
// there), and the one queue every change to them and to state.json's public map runs through.
export function publicStore(dir) {
  const blobs = path.join(dir, 'public', 'blobs');
  const blobPath = (sha) => path.join(blobs, sha);
  let queue = Promise.resolve();
  const referenced = (pub) => {
    const m = new Map();
    for (const p of Object.values(pub ?? {})) for (const a of Object.values(p?.artifacts ?? {})) for (const f of Object.values(a?.files ?? {})) m.set(f.sha256, f.size);
    return m;
  };
  return {
    blobs,
    blobPath,
    serial: (fn) => { const run = queue.then(() => fn()); queue = run.catch(() => {}); return run; },
    referenced,
    write: (sha, buf) => {
      if (fs.existsSync(blobPath(sha))) return false;
      fs.mkdirSync(blobs, { recursive: true, mode: 0o700 });
      const tmpFile = `${blobPath(sha)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      fs.writeFileSync(tmpFile, buf, { mode: 0o600 });
      fs.renameSync(tmpFile, blobPath(sha));
      return true;
    },
    // only ever inside the queue, so no temp file is still being written
    sweep: (pub) => {
      const keep = referenced(pub);
      let names = [];
      try { names = fs.readdirSync(blobs); } catch { return; }
      for (const n of names) if (!keep.has(n)) fs.rmSync(path.join(blobs, n), { force: true });
    },
  };
}

// --- files dropped on the terminal ---------------------------------------------------------------
export const UPLOAD_MAX = 512 * 1024 * 1024; // a file, and so a request: each file is a request of its own
export const UPLOAD_TOTAL = 4 * 1024 * 1024 * 1024;
export const UPLOAD_FREE = 1024 * 1024 * 1024; // left on the disk for the agents, whatever is dropped
export const UPLOAD_KEEP_MS = 7 * 24 * 3600 * 1000;
export const UPLOAD_STALL_MS = 60 * 1000;
export const UPLOAD_SWEEP_MS = 3600 * 1000;
export const UPLOAD_NAME = 200;
export const UPLOAD_PART = '.part';
export const UPLOAD_FOLDER = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{24}$/;
// Node's limit on a whole request is five minutes, too short for a big file on a slow line, and it
// is one setting for the server. So the server's is the upload's, and every other body keeps those
// five minutes by a timer of its own (BODY_MS). A stalled upload goes sooner (UPLOAD_STALL_MS).
export const REQUEST_MS = 3600 * 1000;
export const BODY_MS = 5 * 60 * 1000;
// What the kit's own upload routes (devteam.mjs) share with this gateway; a test holds the two copies equal.
export const UPLOAD_RULES = { max: UPLOAD_MAX, total: UPLOAD_TOTAL, free: UPLOAD_FREE, keepMs: UPLOAD_KEEP_MS, stallMs: UPLOAD_STALL_MS, name: UPLOAD_NAME, part: UPLOAD_PART, folder: UPLOAD_FOLDER };
// The name a dropped file is stored under: its own, reduced to letters, digits, '.', '-' and '_',
// so its path needs no quoting wherever it's pasted, and a program that recognises an image by its
// path (Claude Code, which attaches it) sees a plain one. It can't leave its folder, or be hidden.
export function safeUploadName(raw) {
  const base = String(raw ?? '').split(/[/\\]/).pop().normalize('NFD').replace(/[\p{M}\p{Cc}\p{Cf}]/gu, '');
  const plain = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+|[.-]+$/g, '');
  const dot = plain.lastIndexOf('.');
  const ext = dot >= 0 && plain.length - dot <= 17 ? plain.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : '';
  // the extension first: a name that's all replaced characters still comes out an image
  const stem = (ext ? plain.slice(0, dot) : plain).replace(/^[._-]+/, '').slice(0, UPLOAD_NAME).replace(/[.-]+$/, '');
  const name = `${stem || 'file'}${ext.length > 1 ? ext : ''}`;
  // again until it settles, so a stored name is always the rule's own (x.Z._ gives x.Z, which gives x.z);
  // each further pass only shortens or lower-cases it
  return name === raw ? name : safeUploadName(name);
}
// These run in the terminal's page too (TERM_DROP has their source), and are tested here.
// A stored path never needs the quotes; they're for whatever else this is ever handed.
export function shellQuote(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
export function dropPaste(paths) {
  return paths.map(shellQuote).join(' ');
}
// What follows the paste: a space, so what the owner types next doesn't run into a path. Not after
// images alone: Claude Code turns those into attachments, and it has no path left to separate.
export function isDropImage(p) {
  return /\.(png|jpe?g|gif|webp)$/i.test(p);
}
export function dropSpace(paths) {
  return paths.some((p) => !isDropImage(p));
}
// How a stored file is served back: these four as images, every other file (HTML and SVG among
// them) as bytes to save, never to render. A .jpeg is saved too: the list is the design's.
export const UPLOAD_IMAGES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
export function uploadType(name) {
  const ext = path.extname(name);
  return Object.hasOwn(UPLOAD_IMAGES, ext) ? { type: UPLOAD_IMAGES[ext], attachment: false } : { type: 'application/octet-stream', attachment: true };
}
// What the owner is told after a drop, or ("Pasted") a paste. The paths stay on screen: a paste can still go astray.
export function dropNote(paths, verb = 'Sent') {
  const images = paths.filter(isDropImage).length;
  const how = images === paths.length ? 'images arrive as attachments' : images ? 'images arrive as attachments, PDFs and other files as a path' : 'PDFs and other files arrive as a path';
  return `${verb} to the focused pane. In Claude Code, ${how}.\n${paths.join('\n')}`;
}

