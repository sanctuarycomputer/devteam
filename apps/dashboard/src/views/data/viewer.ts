// kit-989: the artifact viewer's data side (index.html:12855-12877): its read, its boot and its talk.
import { later } from '../../lib/data-later';
import { ttPeekPlace } from '../shell';
import { $ } from '../shell/page';
import { viewer } from '../shell/state';
import { thButton, tlOpen, tlRefresh } from '../threads-panel';
import { avFpSeen, previewInfo, showArtifact, showPreview, tsBar } from '../viewer';
import { viewerState } from '../viewer/state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A5). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export async function viewerArtifact() {
  const info = async (slug: Loose, at: Loose) => { try { const r = await fetch(`/api/view?${new URLSearchParams({ kind: 'artifact', slug, at })}`); return { status: r.status, d: r.ok ? await r.json() : null }; } catch { return { status: 0, d: null }; } };
  let at = viewer()!.at;
  let got = await info(viewer()!.name, at);
  let note: Loose = null;
  // a published tree this checkout lacks, or a draft gone (a 404, and only that): main's, said so
  // (spec §8), shown in place. A describe that failed says so, and shows the version asked for.
  // Nothing here navigates or rewrites the URL: inside the owner wrapper it carries the gateway's
  // grant (w=), which a reload needs, and which nothing passes on to the frame.
  // Framed (the owner wrapper), it stays on the version asked for: the gateway lets a frame show
  // only the published tree it granted, so main's would be an empty frame under a note saying it is main.
  let held: Loose = null;
  if (got.status === 404 && at !== 'main') {
    if (window.parent !== window) held = String(at).startsWith('tree:') ? "The published version isn't in this checkout; open it from the Library." : "This draft isn't here any more; open it from the Library.";
    else { note = String(at).startsWith('tree:') ? 'Not the published version: this is the one on main' : 'Not the draft: this is the one on main'; at = 'main'; got = await info(viewer()!.name, at); }
  }
  const d = got.d;
  // the tab's own hash, when it isn't a thread's (#talk/), is where the page is framed (kit-106): as the
  // browser gives it (percent-encoded), at most 200 characters, no whitespace
  const h = location.hash;
  const anchor = /^#[^\s]{1,200}$/.test(h) && !h.startsWith('#talk/') ? h : '';
  showArtifact(viewer()!.name, at, { title: d?.title || viewer()!.name, note: held ?? (d ? note : got.status === 404 ? 'This artifact is not here' : 'This artifact could not be read'), fp: d?.fp ?? null, mainFp: d?.main_fp ?? null, anchor });
}

export async function viewerBoot() {
  document.documentElement.classList.add('viewer');
  // the Inbox button, above the stage: placed by the page's CSS now that .tt isn't drawn (kit-89 spec §2.8)
  ttPeekPlace();
  if (viewer()!.kind === 'preview') { if (showPreview(viewer()!.name, await later(previewInfo, viewer()!.name)) === 'reload') return; }
  else await viewerArtifact();
  document.title = `${$('av-title')!.textContent} · devteam`;
  // the instance's name, the Inbox's red count (the button's; #tt-peek copies it), and for a preview whether it
  // answers, as the dashboard's tick last found it
  const hello = async () => { try { const r = await fetch('/api/hello'); if (!r.ok) return; const h = await r.json(); $('av-project')!.textContent = h.name ?? ''; $('inbox-btn-n')!.textContent = Number.isInteger(h.inbox) && h.inbox > 0 ? String(h.inbox) : ''; if (typeof thButton === 'function') thButton(); if (viewerState.TS.kind === 'preview') { const row = Array.isArray(h.previews) ? h.previews.find((x: Loose) => x?.name === viewerState.TS.name) : null; viewerState.TS.up = typeof row?.up === 'boolean' ? row.up : null; tsBar(); } } catch {} };
  hello();
  setInterval(hello, 30000);
  // framed (the owner wrapper) without the keyboard, Shift reaches nobody here: say so until it comes (decision 16)
  const hint = () => { $('av-hint')!.hidden = window.parent === window || document.hasFocus(); };
  // again whenever the keyboard may have moved: into this page or a frame in it (focusin), the tab
  // shown again, and a tick after a blur, once the focus has landed wherever it went
  hint();
  addEventListener('focus', hint);
  addEventListener('focusin', hint);
  document.addEventListener('visibilitychange', hint);
  addEventListener('blur', () => setTimeout(hint, 0));
  // and twice a second: a click straight into the artifact from the page around this one moves the
  // keyboard into this page's frame without an event here (Chrome sends none), and hasFocus is cheap
  setInterval(hint, 500);
  await later(tlRefresh);
  // a #talk/<id> link opens its card here: route() never runs in a viewer (decision 22)
  viewerTalk();
  addEventListener('hashchange', viewerTalk);
  setInterval(() => { if (document.visibilityState === 'visible') later(tlRefresh); }, 5000);
  // one ask at a time (a describe can take 12 s), for the stage as it is when asked; main only (a draft has its 2 s poll)
  let asking = false;
  setInterval(async () => {
    if (asking || document.visibilityState !== 'visible' || viewerState.TS.kind !== 'artifact' || viewerState.TS.at !== 'main') return;
    const { slug, at } = viewerState.TS;
    asking = true;
    const stop = new AbortController();
    const late = setTimeout(() => stop.abort(), 15000);
    try {
      const r = await fetch(`/api/view?${new URLSearchParams({ kind: 'artifact', slug, at })}`, { signal: stop.signal });
      if (r.ok) { const j = await r.json(); avFpSeen(j.fp ?? null, j.main_fp ?? null, slug, at); }
    } catch {} finally { clearTimeout(late); asking = false; }
  }, 10000);
}

export function viewerTalk() {
  if (!location.hash.startsWith('#talk/')) return;
  let id = '';
  try { id = decodeURIComponent(location.hash.slice(6)); } catch {}
  if (/^t-\d{8}-\d{9}-[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) later(tlOpen, id);
}
