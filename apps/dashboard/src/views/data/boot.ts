// kit-989: data's hold guard, read and Inbox counts (index.html:12258-12416), and bootData(): the statements
// index.html ran at load, in its order (12122-12880), which DataClient's effect runs once.
import { HINT_AFTER, PICK_HOLD, PRESS_HOLD, typingIn } from '../../lib/data-hold';
import { ownerLesson } from '../../lib/data-inbox';
import { later } from '../../lib/data-later';
import { READ_GIVE_UP_MS } from '../../lib/data-load';
import { attachmentsState } from '../attachments/state';
import { helloLoad } from '../overview';
import { redraw } from '../peeks';
import { esc } from '../shell';
import { $ } from '../shell/page';
import { shell, viewer } from '../shell/state';
import { askShown, tlCard, tlPins } from '../thread';
import { threadState } from '../thread/state';
import { inboxAt, thDraw, tlOwn as layerField, tlRefresh } from '../threads-panel';
import { threadsPanelState } from '../threads-panel/state';
import { avFpSeen } from '../viewer';
import { viewerState } from '../viewer/state';
import { overlaid, press } from './press';
import { render, showFailure } from './render';
import { route } from './router';
import { dataState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A5). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export let STALE = false;

export let HELD_SINCE = 0, COMPOSING = false, PRESSED = 0, PICKING = 0, SENDING = 0;

export function holding() {
  const ae = document.activeElement;
  return COMPOSING || SENDING > 0 || (typingIn(ae) && !layerField(ae)) || Date.now() - PRESSED < PRESS_HOLD
    || (!!ae?.matches?.('select, input[type=file]') && Date.now() - PICKING < PICK_HOLD);
}

export async function sending(f: Loose) { SENDING++; try { return await f(); } finally { SENDING--; } }

export const drawHeld = () => { if (dataState.HELD && !holding()) drawOrHold(dataState.HELD); };

export const letGo = () => setTimeout(drawHeld, 0);

export const picker = (e: Loose) => e.target.matches?.('select, input[type=file]');

export function drawOrHold(d: Loose, force: Loose = false) {
  const first = !shell.DATA;
  dataState.RAW = d;
  try {
    if (!first && !force && holding()) {
      dataState.HELD = d;
      HELD_SINCE ||= Date.now();
      inboxTitle(overlaid(d));
      thDraw();
      if (Date.now() - HELD_SINCE > HINT_AFTER) $('held')!.hidden = false;
      return;
    }
    dataState.HELD = null;
    HELD_SINCE = 0;
    $('held')!.hidden = true;
    const shown = overlaid(d);
    render(shown);
    if (first) route();
    inboxTitle(shown);
    thDraw();
    // an Inbox road's target, now drawn, or given up (kit-100 spec §2.4)
    inboxAt({ rendered: true });
    // the thread layer, which the redraw doesn't touch: the open card as this data has its questions
    // (one answered elsewhere shows answered now, not at the next read), its pins on what was just
    // drawn, then its threads again
    tlCard();
    tlPins();
    later(tlRefresh);
  } catch (e) {
    $('err')!.textContent = 'could not draw (see the top of the page)';
    const b = $('banner');
    b!.className = 'banner';
    b!.innerHTML = `<b>The data loaded but the page failed to draw it.</b> Some sections may be blank or out of date. Please report this upstream with the error below.<pre>${esc((e as Loose).stack || (e as Loose).message || e)}</pre>`;
    b!.hidden = false;
  }
}

export let loading: Loose = null;

export async function load({ force = false }: Loose = {}) {
  // a viewer tab has no dashboard to read for: press() reads after every send (the layer's Send and
  // Resolve go through it), and drawing the hidden page would put its title over the viewer's
  if (viewer()) return;
  // one refresh at a time; a forced one waits for the one in flight, then runs
  if (loading) { if (!force) return; await loading.catch(() => {}); }
  loading = loadNow();
  try { return await loading; } finally { loading = null; }
}

export async function loadNow() {
  later(helloLoad);
  let d: Loose;
  const stop = new AbortController();
  const late = shell.DATA ? setTimeout(() => stop.abort(), READ_GIVE_UP_MS) : null;
  try {
    const r = await fetch('/api/data', { signal: stop.signal });
    // the body first: a read given up on mid-body leaves none of what its headers say applied
    const body = await r.text();
    const pv = r.headers.get('x-devteam-page');
    if (pv) { if (!shell.PAGE_VERSION) shell.PAGE_VERSION = pv; else if (pv !== shell.PAGE_VERSION) $('updated')!.hidden = false; }
    // what the cloud box serves; absent on a laptop, and a header that doesn't parse counts as absent
    shell.PUBLIC = null;
    try { if (r.headers.get('x-devteam-public')) shell.PUBLIC = JSON.parse((r.headers.get('x-devteam-public') as Loose)); } catch {}
    shell.PREVIEWS = r.headers.get('x-devteam-previews') === '1';
    STALE = r.headers.get('x-devteam-stale') === 'true';
    try { d = JSON.parse(body); } catch { throw new Error(r.ok ? 'the server sent something that is not JSON' : `${r.status} ${body.slice(0, 400)}`); }
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  } catch (e) {
    $('err')!.textContent = 'could not load (see the top of the page)';
    return showFailure(stop.signal.aborted ? `the server did not answer in ${READ_GIVE_UP_MS / 1000} s; trying again` : (e as Loose).message || String(e));
  } finally { clearTimeout((late as Loose)); }
  $('err')!.textContent = '';
  $('banner')!.hidden = true;
  $('loading')!.hidden = true;
  document.querySelector('main')!.classList.remove('waiting');
  drawOrHold(d);
  staleNote();
  // the stage's artifact as this read lists it, held from the page or drawn (a missing row says nothing)
  if (viewerState.TS.kind === 'artifact') {
    const row = (at: Loose) => (d.library?.artifacts ?? []).find((a: Loose) => a.slug === viewerState.TS.slug && a.at === at)?.fp ?? null;
    avFpSeen(row(viewerState.TS.at), row('main'), viewerState.TS.slug, viewerState.TS.at);
  }
}

export function staleNote() {
  const n = $('stale');
  n!.hidden = !STALE || !shell.DATA || !$('banner')!.hidden || !$('updated')!.hidden;
  if (n!.hidden) return;
  const at = new Date((shell.DATA as Loose).generated_at);
  const t = `Showing data from ${at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString() : at.toLocaleString()}. Newer data is taking a while to load; this page will update by itself.`;
  if (n!.textContent !== t) n!.textContent = t; // unchanged, a screen reader isn't told again
  n!.style.top = matchMedia('(max-width: 900px)').matches ? `${Math.max(0, document.querySelector('.side')!.getBoundingClientRect().bottom) + 8}px` : '';
}

export function inboxCount(d: Loose = shell.INBOX_D ?? shell.DATA) {
  if (!d) return parseInt((document.getElementById('inbox-btn-n')?.textContent as Loose), 10) || 0;
  return (d.questions || []).filter((q: Loose) => !attachmentsState.ANSWERED.has(q.id)).length + (d.ooda?.knowledge ?? []).filter(ownerLesson).length + promptCount();
}

export function promptCount() {
  const q = typeof threadState.ASK !== 'undefined' ? askShown() : null;
  return (q && (q as Loose).kind !== 'limit' ? 1 : 0) + (typeof threadsPanelState.TL !== 'undefined' ? (threadsPanelState.TL.prompts ?? []).length : 0);
}

export function inboxTitle(d: Loose) {
  shell.INBOX_D = d;
  const n = inboxCount(d);
  document.title = n ? `(${n}) devteam · ${d.project}` : `devteam · ${d.project}`;
  $('inbox-btn-n')!.textContent = n || '';
}
