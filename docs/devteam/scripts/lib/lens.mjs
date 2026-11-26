/* imports start */
import crypto from 'node:crypto';
import path from 'node:path';
import { ARTIFACT_CDNS } from './artifacts.mjs';
import { ARTIFACT_FONT_HOSTS } from './artifacts.mjs';
import { HOME_CWD } from './base.mjs';
import { HUB_PORT } from './orient.mjs';
import { SCHEMA } from './log.mjs';
import { die } from './base.mjs';
import { execFileSync } from 'node:child_process';
import { git } from './base.mjs';
import { json } from './base.mjs';
import { projectInRepo } from './settings.mjs';
import { projectRel } from './settings.mjs';
import { runDir } from './state.mjs';
/* imports end */
export const REVIEW_MAX = 4 * 1024 * 1024;
export const REVIEW_ROWS_MAX = 5000;
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const REPO_PATH = new RegExp(SCHEMA.$defs.types.question.properties.links.items.properties.path.pattern);
export const reviewDir = (qid) => {
  if (!/^[a-z0-9-]+$/.test(qid)) die(`${qid} is not a question id`);
  return path.join(runDir, 'questions', qid);
};
// The policy a review page is served under, as a header (a document can't remove a header; markup
// before a <meta> could). No network at all: the only loads are the kit's two helper files and
// committed images through /api/file, all from the dashboard itself, so even those never leave the
// machine. No CDN either: source matching ignores query strings, so any allowed outside origin
// would carry bytes out in a URL. `sandbox allow-scripts` makes the origin opaque even if the page
// is opened top-level, and frame-ancestors lets only the dashboard frame it.
export const reviewPageCsp = (origin) => [
  "default-src 'none'", `script-src 'unsafe-inline' ${origin}/review/`, `style-src 'unsafe-inline' ${origin}/review/`, `img-src data: blob: ${origin}/api/file`,
  "connect-src 'none'", "font-src 'none'", "media-src 'none'", "object-src 'none'", "frame-src 'none'", "worker-src 'none'", "manifest-src 'none'",
  "form-action 'none'", "base-uri 'none'", `frame-ancestors ${origin} http://127.0.0.1:${HUB_PORT}`, 'sandbox allow-scripts',
].join('; ');
// What an artifact may be served as, by extension; anything else is application/octet-stream.
export const ARTIFACT_TYPES = Object.assign(Object.create(null), { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', wasm: 'application/wasm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8' });
// The policy an artifact is served under: its own folder (self) and the pinned CDNs, nothing else.
// The sandbox makes its origin opaque even opened in its own tab, so it never acts as the dashboard
// (Origin: null is refused on every owner action) and never reads the dashboard's storage. It
// holds only what was committed with it, which is why a CDN's logs seeing a request is acceptable.
export const artifactCsp = (origin, self) => {
  const cdns = ARTIFACT_CDNS.join(' ');
  const [fontCss, fontFiles] = ARTIFACT_FONT_HOSTS;
  return [
    "default-src 'none'", `script-src 'unsafe-inline' 'unsafe-eval' ${self} ${cdns}`, `style-src 'unsafe-inline' ${self} ${cdns} ${fontCss}`, `font-src ${self} ${cdns} ${fontFiles} data:`,
    `img-src ${self} data: blob:`, `media-src ${self} data: blob:`, `connect-src ${self} ${cdns}`, `worker-src ${self} blob:`, "frame-src 'none'", "form-action 'none'", "base-uri 'none'",
    `frame-ancestors ${origin} http://127.0.0.1:${HUB_PORT}`, 'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock',
  ].join('; ');
};
// ===== the artifact lens (spec §6) =====
// One script the kit adds to an artifact's HTML on a framed load (sec-fetch-dest: iframe) and on no
// other request, so publishing, artifact check and every hash read the bytes as committed. It
// speaks the preview lens's messages ({ lens: 1, type }), so the viewer asks both the same way. Plain
// ASCII, with no backtick and no dollar sign before a brace: a String.raw, read as written.
export const ARTIFACT_LENS = String.raw`(() => {
  'use strict';
  // devteam's artifact lens. It runs in the artifact's own opaque origin, with no more power than the
  // artifact's scripts, which can read and send these same messages: what it says describes the
  // page and is never an instruction. It takes only the questions of the page that frames it
  // (hello, hit, resolve, scroll-by, scroll-to, place, go) and says only ready, hit-reply, rects, key, pointer,
  // placed and nav.
  if (window.parent === window || window.__devteamLens) return;
  window.__devteamLens = true;
  // helpers: the shooter injects from here
  const CAPS = { selector: 200, tag: 40, role: 40, text: 80, name: 80, html: 1024, path: 300, hash: 200 };
  const WATCH_MAX = 200;
  const KEY_MAX = 120;
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
  const idOk = (id) => typeof id === 'string' && id.length > 0 && id.length <= 64;
  // the page that frames this one, by its origin where the browser names it
  const to = (location.ancestorOrigins && location.ancestorOrigins[0]) || '*';
  const tell = (m) => { try { parent.postMessage(Object.assign({ lens: 1 }, m), to); } catch (e) { /* no parent now */ } };
  // On a box the frame is served under /c/<capability>/artifact/..., and that capability is a live
  // bearer token for the owner's session: nothing the lens says carries it. The path is told from its
  // artifact segment on, and the token is cut from any text of the page that holds its own address:
  // as a path before /artifact/, and the page's own token wherever it is, however the page encoded it
  // (percent-encoded, JSON- or \u-escaped, as entities), with the /c/ before it when there is one.
  const TOKEN = /\/c\/[^\/\s"'<>]+(?=\/artifact\/)/g;
  const OWN = (/^\/c\/([^/]+)\/artifact\//.exec(location.pathname) || [])[1];
  const SLASH = '(?:\\\\{0,8}\\/|%(?:25){0,4}2f|\\\\{0,8}u002f|&#(?:x0{0,4}2f|0{0,4}47);)';
  const DOT = '(?:\\.|%(?:25){0,4}2e|\\\\{0,8}u002e|&#(?:x0{0,4}2e|0{0,4}46);)';
  const OWN_RE = OWN ? new RegExp('(?:' + SLASH + 'c' + SLASH + ')?' + OWN.split('.').map((p) => p.replace(/[^\w-]/g, (c) => '\\' + c)).join(DOT), 'gi') : null;
  const unCap = (s) => { const t = String(s == null ? '' : s).replace(TOKEN, ''); return OWN_RE ? t.replace(OWN_RE, '') : t; };
  // helpers: to here

  // --- what is where ------------------------------------------------------------------------------
  // an id or a class a person wrote, not one a build made (digit runs, hashes, React's :r1:)
  const plain = (s) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s) && !/[0-9]{3,}/.test(s) && !s.split(/[-_]/).some((p) => p.length >= 5 && /[0-9]/.test(p) && /[A-Za-z]/.test(p));
  const only = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  const quoted = (v) => '"' + String(v).replace(/["\\]/g, '\\$&') + '"';
  const selectorOf = (el) => {
    const tag = el.localName;
    if (el.id && plain(el.id) && only('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    for (const [n, ok] of [['data-testid', true], ['name', /^(input|select|textarea|button|form)$/.test(tag)], ['aria-label', true]]) {
      const v = el.getAttribute(n);
      const sel = v ? tag + '[' + n + '=' + quoted(v) + ']' : '';
      if (ok && v && v === unCap(v) && size(sel) <= CAPS.selector && only(sel)) return sel;
    }
    const steps = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement && steps.length < 6; e = e.parentElement) {
      if (e !== el && e.id && plain(e.id) && only('#' + CSS.escape(e.id))) { steps.unshift('#' + CSS.escape(e.id)); break; }
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
  const nameOf = (el) => {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    const by = el.getAttribute('aria-labelledby');
    const named = by ? by.split(/\s+/).map((id) => { const x = document.getElementById(id); return x ? x.textContent : ''; }).join(' ') : '';
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
      if (++k > 50) { top.appendChild(document.createTextNode('\u2026')); break; }
      if (c.nodeType === 3) top.appendChild(c.cloneNode(false));
      else if (c.nodeType === 1) { const d = c.cloneNode(false); if (c.firstChild) d.textContent = '\u2026'; top.appendChild(d); }
    }
    return capDots(unCap(top.outerHTML), CAPS.html);
  };
  // finder: the shooter injects from here
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  const textOf = (el) => cap(oneLine(unCap(el.textContent)), CAPS.text);
  const anchorOf = (el, x, y) => {
    const rect = rectOf(el);
    return { selector: selectorOf(el), tag: cap(el.localName, CAPS.tag), role: cap(roleOf(el), CAPS.role), text: textOf(el), name: cap(oneLine(unCap(nameOf(el))), CAPS.name), html: htmlOf(el), rect, point: { x: Math.round(x - rect.x), y: Math.round(y - rect.y) } };
  };
  // not shown: display:none, visibility hidden or collapse (itself or an ancestor), or a box with no
  // size at all (a wide box with no height is a collapsed container, still shown); a check that
  // throws counts as shown, so an odd element keeps its pin
  const hiddenEl = (el) => {
    try {
      // (checkVisibilityCSS: the same option's name in Chrome 105-120 and Firefox 106-121)
      if (el.checkVisibility) { if (!el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) return true; }
      else if (!el.getClientRects().length || /^(hidden|collapse)$/.test(window.getComputedStyle(el).visibility)) return true;
      const r = el.getBoundingClientRect();
      return r.width === 0 && r.height === 0;
    } catch (e) { return false; }
  };
  // where an anchor is now: by its selector (changed: with other text now), else an element of its
  // tag with its text, the nearest shown one to where it was, or the nearest hidden one when none is
  // shown; hidden marks a match that is there but not shown, which the viewer counts as not found
  const find = (a) => {
    let el = null;
    try { el = document.querySelector(a.selector); } catch (e) { el = null; }
    if (el) { const t = textOf(el); return { el, changed: typeof a.text === 'string' && t !== a.text, text: t, hidden: hiddenEl(el) }; }
    if (typeof a.text !== 'string' || !a.text || typeof a.tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(a.tag)) return null;
    const was = a.rect && num(a.rect.x) && num(a.rect.y) ? a.rect : { x: 0, y: 0 };
    const all = document.getElementsByTagName(a.tag);
    let best = null;
    let far = Infinity;
    let bestHidden = null;
    let farHidden = Infinity;
    for (let i = 0; i < all.length && i < 5000; i++) {
      if (textOf(all[i]) !== a.text) continue;
      const r = all[i].getBoundingClientRect();
      const d = Math.hypot(r.left - was.x, r.top - was.y);
      if (hiddenEl(all[i])) { if (d < farHidden) { farHidden = d; bestHidden = all[i]; } }
      else if (d < far) { far = d; best = all[i]; }
    }
    if (best) return { el: best, changed: false, text: a.text, hidden: false };
    return bestHidden ? { el: bestHidden, changed: false, text: a.text, hidden: true } : null;
  };
  // finder: to here

  // --- what the viewer watches: sent when it moves -------------------------------------------------
  let watched = [];
  let sent = '';
  const sendRects = (id) => {
    // a hidden match is told apart from no match, for a reader that needs to know which
    const rects = watched.map((x) => { const f = find(x.anchor); return !f ? { key: x.key, rect: null } : f.hidden ? { key: x.key, rect: null, hidden: true } : { key: x.key, rect: rectOf(f.el), changed: f.changed, text: f.text }; });
    const now = JSON.stringify(rects);
    if (id === undefined && now === sent) return;
    sent = now;
    tell(id === undefined ? { type: 'rects', rects } : { type: 'rects', id, rects });
  };
  let framePending = false;
  const soon = () => { if (framePending || !watched.length) return; framePending = true; requestAnimationFrame(() => { framePending = false; sendRects(); }); };
  let settle = 0;
  const later = () => { if (!watched.length) return; clearTimeout(settle); settle = setTimeout(() => sendRects(), 100); };

  // --- Shift and Escape, seen with the focus in the page ---------------------------------------------
  let shiftDown = false;
  // no key is told before the page that frames it has said hello, as the preview lens tells nothing first
  let heard = false;
  // A Shift pressed while typing in one of the page's own fields is a capital letter, not a point: it
  // is never told, as the viewer never raises its overlay for a Shift typed in its own fields. Told,
  // it raised the overlay over a page being typed in, and only the pointer moving lowered it again,
  // so a click made without moving the pointer was the overlay's, never the page's.
  const NOT_TYPED = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'];
  const typingIn = (el) => {
    // the field itself, inside any open shadow roots
    for (let n = 0; el && el.shadowRoot && el.shadowRoot.activeElement && n < 32; n++) el = el.shadowRoot.activeElement;
    if (!el || el.nodeType !== 1) return false;
    const tag = String(el.localName || '').toLowerCase();
    return !!el.isContentEditable || tag === 'textarea' || (tag === 'input' && !NOT_TYPED.includes(String(el.type || 'text').toLowerCase()));
  };
  const onKey = (e) => {
    if (!heard || (e.key !== 'Shift' && e.key !== 'Escape')) return;
    if (e.type === 'keydown' && e.key === 'Shift' && typingIn(e.target && e.target.nodeType === 1 ? e.target : document.activeElement)) return;
    shiftDown = e.type === 'keydown' ? e.key === 'Shift' || e.shiftKey : e.key !== 'Shift' && e.shiftKey;
    tell({ type: 'key', key: e.key, shift: shiftDown, ...(e.type === 'keyup' ? { up: true } : {}) });
  };
  // ArrowLeft and ArrowRight step the dashboard's notes (kit-145): told only with nothing of the page focused,
  // and only for a key the page let pass, so it is decided once the event has run (a page's own handler may
  // take it, and the capture listener below comes before those)
  const onArrow = (e) => {
    if (!heard || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.repeat || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    setTimeout(() => {
      const on = document.activeElement;
      if (!e.defaultPrevented && (!on || ((on === document.body || on === document.documentElement) && !typingIn(on)))) tell({ type: 'key', key: e.key, shift: false });
    }, 0);
  };
  const onBlur = () => { if (heard && shiftDown) { shiftDown = false; tell({ type: 'key', key: 'Shift', shift: false }); } };

  // --- where the pointer is, told after hello: a selector alone, and how far across it --------------
  const POINTER_GAP = 67;
  const across = (v, from, n) => (n > 0 ? Math.round(Math.max(0, Math.min(1, (v - from) / n)) * 1e4) / 1e4 : 0);
  // what the gate held (an element and a point, or el: null for a leave) as the message, made only when
  // it is sent; the page itself (html or body) is no thing to point at, as hit says
  const pointerOf = (p) => {
    let el = p.el;
    // the page replaced it while the gate held it: what is at that point now
    if (el && el.isConnected === false) el = document.elementFromPoint(p.cx, p.cy);
    if (!el || el.nodeType !== 1 || el === document.documentElement || el === document.body) return { k: null };
    // the rect read now, when it is sent, against the point of the move
    const r = el.getBoundingClientRect();
    return { k: selectorOf(el), x: across(p.cx, r.left, r.width), y: across(p.cy, r.top, r.height) };
  };
  // one gate for every pointer, nulls too: at most one per gap, the newest input replacing what waits
  // (one timer, nothing queued, so the last word arrives), and never the same message twice running
  let pointerPending = null;
  let pointerTimer = 0;
  let pointerAt = 0;
  let pointerSent = '';
  const flushPointer = () => {
    const p = pointerPending;
    pointerPending = null;
    if (!p) return;
    const m = pointerOf(p);
    const s = JSON.stringify(m);
    if (s === pointerSent) return;
    pointerSent = s;
    pointerAt = Date.now();
    tell(Object.assign({ type: 'pointer' }, m));
  };
  const sayPointer = (p) => {
    pointerPending = p;
    if (pointerTimer) return;
    // never longer than one gap, whatever the wall clock did since the last send
    const wait = Math.min(POINTER_GAP, POINTER_GAP - (Date.now() - pointerAt));
    if (wait <= 0) flushPointer();
    else pointerTimer = setTimeout(() => { pointerTimer = 0; flushPointer(); }, wait);
  };

  // --- where others' pointers are: by selector alone, apart from the pins' watch list ----------------
  const PLACE_MAX = 8;
  // querySelector only, never find's text search; null for nothing there, a bad selector, or not shown
  const shownRect = (k) => {
    let el = null;
    try { el = document.querySelector(k); } catch (e) { el = null; }
    if (!el) return null;
    const hidden = el.checkVisibility ? !el.checkVisibility({ visibilityProperty: true }) : (!el.getClientRects().length || /^(hidden|collapse)$/.test(window.getComputedStyle(el).visibility));
    return hidden ? null : rectOf(el);
  };
  let placing = [];
  let placedSent = '';
  let placeLoop = false;
  const placedNow = () => placing.map((x) => ({ id: x.id, rect: shownRect(x.k) }));
  // once a frame while there is a list, sent only when a rect changed; an empty list ends it
  const placeFrame = () => {
    if (!placing.length) { placeLoop = false; return; }
    // the next frame is asked for whatever this one's measuring did
    try {
      const rects = placedNow();
      const now = JSON.stringify(rects);
      if (now !== placedSent) { placedSent = now; tell({ type: 'placed', rects }); }
    } finally { requestAnimationFrame(placeFrame); }
  };

  // --- the viewer's questions ------------------------------------------------------------------------
  // the page's path from its artifact segment on: what is before it (a box's capability) is gone, and
  // the prefix to the slug kept whole, before the cap, so the cap is the page's own path's
  const pathOf = () => {
    const p = unCap(location.pathname);
    const m = /\/artifact\/(?:main|wt\/[^\/]+|tree\/[0-9a-f]+)\/[^\/]+\//.exec(p);
    return m ? m[0] + cap(p.slice(m.index + m[0].length), CAPS.path) : cap(p, CAPS.path);
  };
  // the view within the page: its hash, the token cut as from the path; '' when there is none. A browser
  // gives the hash percent-encoded, so a cut that ends inside an escape (%C or %) drops what's left of it.
  const hashOf = () => cap(unCap(location.hash || ''), CAPS.hash).replace(/%[0-9A-Fa-f]?$/, '');
  // --- each move of the page (a #hash, pushState, replaceState, Back), told as nav once a frame ---------
  // the last path and hash told, by ready or nav: a move is told only when one of them changed
  let navAt = null;
  let navPending = false;
  const navSoon = () => {
    if (!heard || navPending) return;
    navPending = true;
    requestAnimationFrame(() => {
      navPending = false;
      const now = { path: pathOf(), hash: hashOf() };
      if (navAt && now.path === navAt.path && now.hash === navAt.hash) return;
      navAt = now;
      tell({ type: 'nav', path: now.path, hash: now.hash });
    });
  };
  let last = { x: 0, y: 0 };
  const ORDERS = {
    // hash only when there is one, so a page with none says exactly what it always said
    hello: () => {
      heard = true;
      const m = { type: 'ready', path: pathOf(), title: cap(oneLine(unCap(document.title)), CAPS.text), viewport: { w: window.innerWidth, h: window.innerHeight } };
      const h = hashOf();
      if (h) m.hash = h;
      navAt = { path: m.path, hash: h };
      tell(m);
    },
    hit: (m) => {
      if (!idOk(m.id) || !num(m.x) || !num(m.y)) return;
      let el = document.elementFromPoint(m.x, m.y);
      // the page itself is no thing to point at: the viewer pins the point instead
      if (el && (el === document.documentElement || el === document.body)) el = null;
      last = { x: m.x, y: m.y };
      const anchor = el ? anchorOf(el, m.x, m.y) : null;
      tell({ type: 'hit-reply', id: m.id, anchor, rect: anchor ? anchor.rect : null });
    },
    resolve: (m) => {
      if (!idOk(m.id) || !Array.isArray(m.anchors)) return;
      watched = m.anchors.slice(0, WATCH_MAX).filter((x) => x && typeof x.key === 'string' && size(x.key) <= KEY_MAX && x.anchor && typeof x.anchor === 'object' && typeof x.anchor.selector === 'string' && size(x.anchor.selector) <= CAPS.selector).map((x) => ({ key: x.key, anchor: x.anchor }));
      sendRects(m.id);
    },
    'scroll-by': (m) => {
      const step = (v) => (num(v) ? Math.max(-10000, Math.min(10000, v)) : 0);
      const at = num(m.x) && num(m.y) ? { x: m.x, y: m.y } : last;
      // the box under the pointer that scrolls, else the page
      for (let el = document.elementFromPoint(at.x, at.y); el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
        const s = window.getComputedStyle(el);
        if (/(auto|scroll|overlay)/.test(s.overflowY + ' ' + s.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) { el.scrollBy(step(m.dx), step(m.dy)); return; }
      }
      window.scrollBy(step(m.dx), step(m.dy));
    },
    'scroll-to': (m) => {
      const a = m.anchor;
      if (!a || typeof a !== 'object' || typeof a.selector !== 'string' || size(a.selector) > CAPS.selector) return;
      const f = find(a);
      if (f) f.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    },
    // the newest list stands until the next; one that is no list is ignored
    place: (m) => {
      if (!Array.isArray(m.anchors)) return;
      placing = m.anchors.slice(0, PLACE_MAX).filter((x) => x && idOk(x.id) && typeof x.k === 'string' && x.k.length > 0 && size(x.k) <= CAPS.selector).map((x) => ({ id: x.id, k: x.k }));
      const rects = placedNow();
      placedSent = JSON.stringify(rects);
      tell({ type: 'placed', rects });
      if (placing.length && !placeLoop) { placeLoop = true; requestAnimationFrame(placeFrame); }
    },
    // a view of this page by its #hash; anything else (no #, too long, no string) is ignored
    go: (m) => { if (typeof m.hash === 'string' && m.hash[0] === '#' && size(m.hash) <= CAPS.hash) location.hash = m.hash; },
  };
  addEventListener('message', (e) => {
    if (!e.isTrusted || e.source !== parent) return;
    // from the parent's own origin where the browser names it, as the preview lens checks
    if (location.ancestorOrigins && location.ancestorOrigins.length && e.origin !== location.ancestorOrigins[0]) return;
    const m = e.data;
    if (!m || typeof m !== 'object' || m.lens !== 1 || typeof m.type !== 'string' || !Object.prototype.hasOwnProperty.call(ORDERS, m.type)) return;
    try { ORDERS[m.type](m); } catch (err) { /* one bad question costs only itself */ }
  });
  addEventListener('keydown', onArrow);
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKey, true);
  addEventListener('blur', onBlur);
  addEventListener('mousemove', (e) => { if (heard) sayPointer({ el: e.target, cx: e.clientX, cy: e.clientY }); }, true);
  // no relatedTarget: the pointer left the frame
  addEventListener('mouseout', (e) => { if (heard && !e.relatedTarget) sayPointer({ el: null }); }, true);
  addEventListener('scroll', soon, true);
  addEventListener('resize', soon);
  try { new MutationObserver(later).observe(document, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (e) { /* a page that can't be watched is still pointed at */ }
  setInterval(() => { if (watched.length) sendRects(); }, 1000);
  addEventListener('hashchange', navSoon);
  addEventListener('popstate', navSoon);
  // pushState and replaceState fire no event: the page's own calls go through these, which still do
  // what it asked. A page with no history, or one whose methods can't be replaced, keeps the check.
  try {
    for (const k of ['pushState', 'replaceState']) {
      const was = history[k];
      if (typeof was !== 'function') continue;
      history[k] = function () { const r = was.apply(this, arguments); navSoon(); return r; };
    }
  } catch (e) { /* no history to wrap */ }
  // a page that replaced pushState itself, before the lens or after, is still seen
  setInterval(navSoon, 500);
})();`;
// The page with the lens after it, at the very end: the parser takes a script there into the body
// and runs it, and every byte before it is the committed one. A page that ends inside an unclosed
// <script>, <style>, <textarea>, <title> or comment swallows it as text: then no lens answers, and
// the viewer pins the point alone (decision 3). Its policy needs nothing more: the
// artifact policy's script-src already has 'unsafe-inline', and a hash there would turn that off
// for the artifact's own inline scripts.
export const withArtifactLens = (bytes) => Buffer.concat([bytes, Buffer.from(`<script>${ARTIFACT_LENS}</script>`)]);
export const reviewResultFile = (qid) => path.join(reviewDir(qid), 'result.json');
export const reviewDraftFile = (qid) => path.join(reviewDir(qid), 'draft.json');
// The permanent copy of the owner's result, in the PR that asked: project/questions/<qid>/, or
// the ticket's own folder on a ticket branch (a ticket PR changes nothing else of project/).
export const reviewResultRel = (qid, ticket) => `${projectRel}/${ticket ? `tickets/${ticket}/` : ''}questions/${qid}/result.json`;
export const reReserved = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const reviewResultPath = (f) => (projectInRepo ? new RegExp(`^${reReserved(projectRel)}/(?:tickets/[^/]+/)?questions/([^/]+)/result\\.json$`).exec(f)?.[1] ?? null : null);

// A blob's exact bytes at a commit (git() decodes and trims; a hash needs the bytes).
export function gitBlob(commit, p) {
  try {
    return execFileSync('git', ['cat-file', 'blob', `${commit}:${p}`], { cwd: HOME_CWD, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}
// A commit no branch or tag contains is lost at the next prune, with the page the owner answered on.
export const reachMemo = new Map();
export function commitReachable(commit) {
  if (!reachMemo.has(commit)) reachMemo.set(commit, !!git(['for-each-ref', '--count=1', '--format=%(refname)', '--contains', commit]));
  return reachMemo.get(commit);
}

