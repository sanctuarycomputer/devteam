// kit-1001: a dropped image on the artifact viewer's stage, and the page it covers (index.html's attachments
// lines), as index.html has them, with types and exports. The viewer's state is viewer's (viewerState: AV, avFocus,
// TS), read and written through its object.
import { avKindDraw, avPopsClose, avPubDraw, avRunDraw, avRunErr } from '../library';
import { $ } from '../shell/page';
import { tsPins } from '../threads-panel';
import { avFreshFrame, avHint, closeArtifact, tsForget, tsSet } from '../viewer';
import { viewerState } from '../viewer/state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it). Some are there because library's, viewer's and threads-panel's functions are stubs returning `never`
// until their ports: the compiler reads the code after a call into one as unreachable.
type Loose = any;

// The page an image covers (spec §6, task-4 T4-1): the artifact or preview on the stage when it opened, kept
// loaded under it (its frame only hidden), with what the stage knew of it (AV, the lens's state, the bar), so every
// way out of the image gives it back as it was. null: the image opened over nothing.
let AV_UNDER: Loose = null;
export function avUnderTake() {
  const { minted, waiters, rects, keyOf, watching, raised, ...ts } = viewerState.TS;
  const err = document.querySelector('.av-run-err') as Loose;
  return {
    av: viewerState.AV, ts, rects: new Map(rects), keyOf: new Map(keyOf), watching: new Set(watching),
    frames: ['av-frame', 'pv-frame'].map((id) => ($(id) as Loose).hidden),
    // the page around the stage, as showUpload changes it (a viewer tab has none of these on: TR4-1)
    page: { cls: ['av-open', 'overlay-open', 'th-under-av'].filter((c) => document.body.classList.contains(c)), scrim: ($('scrim') as Loose).hidden, overflow: document.body.style.overflow },
    bar: { title: ($('av-title') as Loose).textContent, icon: (document.querySelector('.av-bar > i.av-kind') as Loose).className, kind: ($('av-kind') as Loose).textContent, kindHidden: ($('av-kind') as Loose).hidden, note: ($('av-note') as Loose).textContent, noteHidden: ($('av-note') as Loose).hidden, tab: ($('av-tab') as Loose).getAttribute('href'), reload: ($('av-reload') as Loose).hidden, hint: ($('av-hint') as Loose).hidden, errId: err.id, err: err.textContent },
  };
}
export function avUnderGive() {
  const u = AV_UNDER;
  viewerState.AV = u.av;
  // the image gone, AV_UNDER with it, the bar's version pill and Public wrap back
  avUploadOff();
  tsForget() as Loose;
  Object.assign(viewerState.TS, u.ts);
  for (const [m, from] of [[viewerState.TS.rects, u.rects], [viewerState.TS.keyOf, u.keyOf]] as Loose) { m.clear(); for (const [k, v] of from) m.set(k, v); }
  viewerState.TS.watching.clear();
  for (const v of u.watching) viewerState.TS.watching.add(v);
  ['av-frame', 'pv-frame'].forEach((id, i) => { ($(id) as Loose).hidden = u.frames[i]; });
  for (const c of ['av-open', 'overlay-open', 'th-under-av']) document.body.classList.toggle(c, u.page.cls.includes(c));
  ($('scrim') as Loose).hidden = u.page.scrim;
  document.body.style.overflow = u.page.overflow;
  const b = u.bar, err = document.querySelector('.av-run-err') as Loose;
  ($('av-title') as Loose).textContent = b.title;
  (document.querySelector('.av-bar > i.av-kind') as Loose).className = b.icon;
  ($('av-kind') as Loose).textContent = b.kind;
  ($('av-kind') as Loose).hidden = b.kindHidden;
  ($('av-note') as Loose).textContent = b.note;
  ($('av-note') as Loose).hidden = b.noteHidden;
  if (b.tab === null) ($('av-tab') as Loose).removeAttribute('href'); else ($('av-tab') as Loose).setAttribute('href', b.tab);
  if (b.errId) err.id = b.errId; else err.removeAttribute('id');
  err.textContent = b.err;
  avRunDraw() as Loose;
  avPubDraw() as Loose;
  avHint() as Loose;
  ($('av-reload') as Loose).hidden = b.reload;
  ($('av-hint') as Loose).hidden = b.hint;
  tsPins() as Loose;
}
// Every way out of an image: the page it covered back on the stage, else the viewer closed (nothing routed either way).
export function uploadClose() {
  if (!viewerState.AV?.upload) return;
  if (AV_UNDER) avUnderGive(); else closeArtifact() as Loose;
}
// An image, in the artifact viewer's stage as an <img> of the dashboard's own page (never in the sandboxed frame,
// whose loads would read as cross-site). Nothing routes: the hash stays, so AV_FROM and AV_RET are left as they
// are, and every way out closes it in place (the listeners below).
export function showUpload(url: Loose, name: Loose) {
  if (!viewerState.AV) viewerState.avFocus = document.activeElement;
  // over a page on the stage, that page is kept under the image (an image over an image keeps what the first covered)
  if (viewerState.AV && !viewerState.AV.upload) AV_UNDER = avUnderTake();
  viewerState.AV = { upload: url };
  avPopsClose() as Loose;
  avRunDraw() as Loose;
  avRunErr(null) as Loose;
  tsSet(null) as Loose;
  // the covered page's pins go with it
  tsPins() as Loose;
  ($('av-title') as Loose).textContent = name;
  avKindDraw(null) as Loose;
  (document.querySelector('.av-bar > i.av-kind') as Loose).className = 'av-kind icon-image';
  ($('av-kind') as Loose).textContent = 'Image';
  ($('av-kind') as Loose).hidden = false;
  // no versions, nothing to reload, nothing to publish
  (document.querySelector('.av-ver-wrap') as Loose).hidden = true;
  ($('av-reload') as Loose).hidden = true;
  avPubDraw() as Loose;
  (document.querySelector('.av-pub-wrap') as Loose).hidden = true;
  ($('av-note') as Loose).hidden = true;
  ($('av-note') as Loose).textContent = '';
  ($('av-tab') as Loose).href = url;
  // a covered page's frame only hidden, never emptied (it is shown again as it was); over nothing, both let go of
  if (AV_UNDER) { ($('av-frame') as Loose).hidden = true; ($('pv-frame') as Loose).hidden = true; } else { (avFreshFrame('av-frame') as Loose).hidden = true; (avFreshFrame('pv-frame') as Loose).hidden = true; }
  $('av-img')?.remove();
  const img = document.createElement('img');
  img.id = 'av-img';
  img.alt = name;
  // swept since it was sent (kit-170 keeps dropped files 7 days): the <img> fails to load; and since a page reuses an
  // image it has already shown without asking again, the server is asked too, as a download chip asks it
  const gone = () => {
    if ($('av-img') !== img) return;
    // a copy the page kept is not shown as if the file were there
    img.hidden = true;
    ($('av-note') as Loose).hidden = false;
    ($('av-note') as Loose).textContent = 'This file is gone: dropped files are kept 7 days';
  };
  img.addEventListener('error', gone);
  fetch(url, { method: 'HEAD' }).then((r) => { if (r.status === 404) gone(); }, () => {});
  img.src = url;
  ($('av-stage') as Loose).prepend(img);
  // while an image is up: a viewer tab shows its × (it has none of its own: no way out without a keyboard otherwise)
  document.documentElement.classList.add('av-upload');
  ($('artifact-view') as Loose).hidden = false;
  ($('scrim') as Loose).hidden = false;
  document.body.classList.add('overlay-open');
  // opened over the open panel, it is on top of it at 900px and below, as an artifact is
  if (!document.body.classList.contains('av-open')) document.body.classList.toggle('th-under-av', document.body.classList.contains('threads-open'));
  document.body.classList.add('av-open');
  document.body.style.overflow = 'hidden';
  ($('av-close') as Loose).focus();
}
// The stage given back to an artifact or a preview (showArtifact, showPreview) or closed (closeArtifact): the image
// gone, the bar's controls back.
export function avUploadOff() {
  AV_UNDER = null;
  document.documentElement.classList.remove('av-upload');
  $('av-img')?.remove();
  (document.querySelector('.av-ver-wrap') as Loose).hidden = false;
  (document.querySelector('.av-pub-wrap') as Loose).hidden = false;
}
// A route taken while an image is up (a link, Back) closes the image first, the same way, before the router runs, so
// the router sees the viewer as it was under the image: empty (its reset of AV_RET, AV_NAVS, AV_FRAME_ESC, AV_FROM
// runs) or the page the image covered (task-4 T4-2). On popstate, which a fragment navigation fires before its
// hashchange: the router's hashchange listener is registered earlier and runs first at the window, capture or not
// (final-1 F1); the hashchange one stays for a navigation that fires no popstate.
export const uploadRouted = () => { if (viewerState.AV?.upload) uploadClose(); };
