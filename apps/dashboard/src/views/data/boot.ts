// kit-989: data's hold guard, read and Inbox counts (index.html:12258-12416), and bootData(): the statements
// index.html ran at load, in its order (8115-12898), which DataClient's effect runs once.
import { HINT_AFTER, PICK_HOLD, PRESS_HOLD, typingIn } from '../../lib/data-hold';
import { ownerLesson } from '../../lib/data-inbox';
import { later } from '../../lib/data-later';
import { READ_GIVE_UP_MS } from '../../lib/data-load';
import { GOAL_REFUSAL, holdOverlay } from '../../lib/data-press';
import { POLL_MS } from '../../shared/poll';
import { filesWords, markAnswered, qcardOf, seenHash, sendable } from '../attachments';
import { attachmentsState } from '../attachments/state';
import { activeGoalOrder, holdConfirming, moveGoal } from '../goals';
import { goalsState } from '../goals/state';
import { helloLoad } from '../overview';
import { closeDrawer, loadSchemaDocs, peekIsOpen, peekKey, redraw } from '../peeks';
import { peeksState } from '../peeks/state';
import { lsGet, lsSet, renderReviewPreview, reviewAnswer, reviewDecline, sitesKey } from '../review';
import { reviewState } from '../review/state';
import { loadFleet } from '../settings';
import { esc } from '../shell';
import { $ } from '../shell/page';
import { shell, viewer } from '../shell/state';
import { askShown, tlCard, tlPins } from '../thread';
import { threadState } from '../thread/state';
import { inboxAt, inboxGo, inboxTyping, thDraw, thEscapePage, thFreshness, tlClose, tlFloating, tlOwn as layerField, tlRefresh } from '../threads-panel';
import { threadsPanelState } from '../threads-panel/state';
import { avFpSeen, leaveArtifact } from '../viewer';
import { viewerState } from '../viewer/state';
import { choicesOf, isOa, oaConfirming, oaOpen, oaPaint, oaState, toB64 } from '../words';
import { wordsState } from '../words/state';
import { installHubFleet } from './hub-fleet';
import { SAVING, answerPress, overlaid, press, redrawNow } from './press';
import { render, showFailure } from './render';
import { ROUTE_COLD, leaveReview, loopTab, route, showTab, stampEntry } from './router';
import { dataState } from './state';
import { viewerBoot } from './viewer';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A5). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export let STALE = false;

export let HELD_SINCE = 0, COMPOSING = false, PRESSED = 0, PICKING = 0, SENDING = 0;

// A field in the thread layer or the Threads panel holds nothing: both are outside what a redraw rebuilds, so the page refreshes (and the counts move) under a half-written turn.
// The panel's Inbox tab (#th-inbox) is the exception: render() rebuilds it, so its fields hold as a page's do (layerField, kit-100 spec §2.7).
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

// The server answers a slow read with the last data it had, marked stale: say so where it shows on
// any screen, with the time of what is drawn (not of a read held while the owner types), until a
// fresh read lands. A banner at the top says more, and the note gives way to it.
export function staleNote() {
  const n = $('stale');
  n!.hidden = !STALE || !shell.DATA || !$('banner')!.hidden || !$('updated')!.hidden;
  if (n!.hidden) return;
  const at = new Date((shell.DATA as Loose).generated_at);
  const t = `Showing data from ${at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString() : at.toLocaleString()}. Newer data is taking a while to load; this page will update by itself.`;
  if (n!.textContent !== t) n!.textContent = t; // unchanged, a screen reader isn't told again
  n!.style.top = matchMedia('(max-width: 900px)').matches ? `${Math.max(0, document.querySelector('.side')!.getBoundingClientRect().bottom) + 8}px` : '';
}

// The Inbox's number (kit-100 spec §2.2): the open questions not answered on this page yet (ANSWERED), the
// lessons sent to the owner, and the sessions at a permission prompt (promptCount). Counted from the data inboxTitle last counted (newer data held back from a redraw
// included), else the data drawn, so the tab, the button and the tab title always agree; the /view/ tab has no
// data: hello's number, in the button.
export function inboxCount(d: Loose = shell.INBOX_D ?? shell.DATA) {
  if (!d) return parseInt((document.getElementById('inbox-btn-n')?.textContent as Loose), 10) || 0;
  return (d.questions || []).filter((q: Loose) => !attachmentsState.ANSWERED.has(q.id)).length + (d.ooda?.knowledge ?? []).filter(ownerLesson).length + promptCount();
}

// The permission prompts and other dialogs at the top of the Inbox (askHtml), one red question each: the
// supervisor's terminal's (not a usage-limit stop, and not one just answered here) and each session's
// (hello's prompt_sessions), as hello counts them into the hub's number.
export function promptCount() {
  const q = typeof threadState.ASK !== 'undefined' ? askShown() : null;
  return (q && (q as Loose).kind !== 'limit' ? 1 : 0) + (typeof threadsPanelState.TL !== 'undefined' ? (threadsPanelState.TL.prompts ?? []).length : 0);
}

// The tab title and the Inbox button's red count carry the Inbox's number. Notifications are the hub's, for every instance.
export function inboxTitle(d: Loose) {
  shell.INBOX_D = d;
  const n = inboxCount(d);
  document.title = n ? `(${n}) devteam · ${d.project}` : `devteam · ${d.project}`;
  $('inbox-btn-n')!.textContent = n || '';
}

export function bootData() {
  window.addEventListener('hashchange', () => { if (shell.DATA) route(); else dataState.TH_CARRY = null; });
  window.addEventListener('popstate', () => { thFreshness(); if (dataState.TH_CARRY && location.hash === dataState.TH_CARRY_FROM) dataState.TH_CARRY = null; });
  window.addEventListener('popstate', () => { if (!ROUTE_COLD) stampEntry(); });
  $('drawer-close')?.addEventListener('click', closeDrawer);
  $('scrim')?.addEventListener('click', () => (viewerState.AV ? leaveArtifact() : reviewState.RV ? leaveReview() : closeDrawer()));
  document.addEventListener('keydown', (e: Loose) => {
    if (e.key !== 'Escape') return;
    // Escape on a property's key closes its tooltip, not the drawer
    if (document.activeElement?.matches?.('.props dt[title]')) return void (document.activeElement as Loose).blur();
    // a half-typed answer in the Inbox tab isn't hidden by a stray key: no peek closes under it (kit-100 spec §2.7)
    if (!viewerState.AV && !reviewState.RV && inboxTyping(document.activeElement)) return;
    // a floating card over the viewer closes first; the next Escape closes the viewer (kit-141 spec §Approach 7)
    if (viewerState.AV && tlFloating()) return void tlClose();
    if (viewerState.AV) leaveArtifact(); else if (reviewState.RV) leaveReview(); else if (peekIsOpen()) closeDrawer(); else thEscapePage();
  });
  document.addEventListener('click', (e: Loose) => { if (e.target.closest('[data-rv-close]')) leaveReview(); });
  $('loop-tabs')?.addEventListener('click', (e: Loose) => { const b = e.target.closest('[data-tab]'); if (b) loopTab(b.dataset.tab); });
  showTab(dataState.TAB);
  addEventListener('beforeunload', (e: Loose) => { if (SAVING) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pointerdown', (e: Loose) => { PRESSED = Date.now(); if (picker(e)) PICKING = Date.now(); }, true);
  for (const up of ['pointerup', 'pointercancel']) window.addEventListener(up, () => setTimeout(() => { PRESSED = 0; drawHeld(); }, 0), true);
  document.addEventListener('keydown', (e: Loose) => { if (picker(e)) PICKING = Date.now(); }, true);
  document.addEventListener('change', () => { PICKING = 0; letGo(); }, true);
  document.addEventListener('focusout', letGo, true);
  document.addEventListener('compositionstart', () => { COMPOSING = true; }, true);
  document.addEventListener('compositionend', () => { COMPOSING = false; letGo(); }, true);
  $('held')!.addEventListener('mousedown', (e: Loose) => e.preventDefault());
  $('held')!.addEventListener('click', () => { if (dataState.HELD) drawOrHold(dataState.HELD, true); });
  $('reload-page')!.addEventListener('click', () => location.reload());
  document.addEventListener('input', (e: Loose) => {
    const t = e.target;
    if (!t.matches?.('textarea[data-q]') || layerField(t)) return;
    shell.drafts[t.dataset.q] = t.value;
    for (const o of document.querySelectorAll(`textarea[data-q="${CSS.escape(t.dataset.q)}"]`)) if (o !== t && !layerField(o)) (o as Loose).value = t.value;
  });
  document.addEventListener('click', async (ev: Loose) => {
    const hb = ev.target.closest('[data-hold-id]');
    if (hb) {
      const id = hb.dataset.holdId, mode = hb.dataset.mode;
      const errId = `hold-${id}`;
      // Let go, then Confirm let go: the confirm in page memory (HOLD_CONFIRM), so a redraw keeps it
      if (mode === 'let-go' && !holdConfirming(id)) {
        goalsState.HOLD_CONFIRM.set(id, Date.now() + 6000);
        hb.classList.add('confirm'); hb.textContent = 'Confirm let go';
        setTimeout(() => {
          if (holdConfirming(id)) return; // confirmed again since: that one's timer resets it
          goalsState.HOLD_CONFIRM.delete(id);
          for (const b of document.querySelectorAll(`[data-hold-id="${CSS.escape(id)}"][data-mode="let-go"]`)) { b.classList.remove('confirm'); b.textContent = 'Let go'; }
          redraw();
        }, 6050);
        return;
      }
      goalsState.HOLD_CONFIRM.delete(id);
      hb.classList.remove('confirm');
      press(`g:${id}`, {
        build: () => (['let-go', 'restore'].includes(mode) ? { action: 'goal-decide', body: { id, verdict: mode } } : { action: 'goal-hold', body: { id, mode } }),
        overlay: holdOverlay(id, mode),
        apply: () => { redrawNow(); redraw(); },
        onOk: () => { later(loadFleet); },
        errId,
      });
      return;
    }
    // Mark met: confirm in place, then goal status met (a repo or prod check runs again first)
    const mb = ev.target.closest('[data-met-id]');
    if (mb) {
      const id = mb.dataset.metId;
      if (!mb.classList.contains('confirm')) { mb.classList.add('confirm'); mb.textContent = 'Confirm: mark it met'; setTimeout(() => { mb.classList.remove('confirm'); mb.textContent = 'Mark met'; }, 6000); return; }
      mb.classList.remove('confirm');
      // the button says so at once; the goal shows met only once the server has checked it and agreed
      press(`g:${id}`, {
        build: () => ({ action: 'goal-met', body: { id } }),
        apply: () => { mb.disabled = true; mb.textContent = 'Marking met…'; },
        restore: () => { const b = document.querySelector(`[data-met-id="${CSS.escape(id)}"]`); if (b) { (b as Loose).disabled = false; b.textContent = 'Mark met'; } },
        onOk: () => { redraw(); },
        errId: `met-${id}`,
      });
      return;
    }
    // Move up / Move down in a goal's ⋯: the menu closes, the goal moves one place and the order is saved
    const gm = ev.target.closest('[data-goal-move]');
    if (gm) {
      if (gm.disabled) return;
      const id = gm.dataset.goalId;
      gm.closest('details')?.removeAttribute('open');
      const at = (activeGoalOrder() as Loose).indexOf(id);
      if (at >= 0) moveGoal(id, gm.dataset.goalMove === 'up' ? at - 1 : at + 1, 'menu');
      return;
    }
    const mv = ev.target.closest('[data-mdview]');
    if (mv) {
      const v = mv.dataset.mdview;
      try { localStorage.setItem('devteam.mdview', v); } catch {}
      document.querySelectorAll('[data-mdview]').forEach((b: Loose) => b.setAttribute('aria-pressed', String(b.dataset.mdview === v)));
      document.querySelectorAll('#drawer-body [data-md]').forEach((el: Loose) => { el.hidden = el.dataset.md !== v; });
      return;
    }
    // a planner card opens its peek through the record cards' data-open handlers (kit-91), which leave its question link alone
    // Stop and Start on a preview: the kit's own actions, as an owner action
    const pvb = ev.target.closest('[data-preview-stop],[data-preview-start]');
    if (pvb) {
      const stop = pvb.dataset.previewStop !== undefined;
      const name = stop ? pvb.dataset.previewStop : pvb.dataset.previewStart;
      const label = pvb.textContent;
      // the row says so at once; the next refresh draws it as the server has it
      press(`preview:${name}`, {
        build: () => ({ action: stop ? 'preview-stop' : 'preview-start', body: { name } }),
        apply: () => { pvb.disabled = true; pvb.textContent = stop ? 'Stopping…' : 'Starting…'; },
        restore: () => { const b = document.querySelector(`[data-preview-${stop ? 'stop' : 'start'}="${CSS.escape(name)}"]`); if (b) { (b as Loose).disabled = false; b.textContent = label; } },
        errId: `preview-${name}`,
      });
      return;
    }
    const cp = ev.target.closest('[data-copy]');
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); cp.textContent = 'Copied'; } catch { cp.textContent = 'Select and copy'; } return; }
    // Forget: record an unpublish through the kit's own action, for a publish line the owner won't
    // restore (the page is already not live; nothing on the box changes). Twice, as Let go is.
    const fg = ev.target.closest('[data-forget]');
    if (fg) {
      const slug = fg.dataset.forget;
      if (!fg.classList.contains('confirm')) { fg.classList.add('confirm'); fg.textContent = 'Confirm forget'; setTimeout(() => { fg.classList.remove('confirm'); fg.textContent = 'Forget'; }, 6000); return; }
      fg.classList.remove('confirm');
      press(`pub:${slug}`, {
        build: () => ({ action: 'artifact-publish', body: { op: 'unpublish', slug } }),
        apply: () => { fg.disabled = true; fg.textContent = 'Forgotten'; },
        restore: () => { const b = document.querySelector(`[data-forget="${CSS.escape(slug)}"]`); if (b) { (b as Loose).disabled = false; b.textContent = 'Forget'; } },
        errId: `pub-${slug}`,
      });
      return;
    }
    // a question the peek can't answer: the Inbox tab at its card (the #inbox listener has run; this target replaces its none)
    const qin = ev.target.closest('[data-q-inbox]');
    if (qin && !ev.button && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey) { ev.preventDefault(); return void inboxGo({ scrollTo: `#q-${CSS.escape(qin.dataset.qInbox)}` }); }
    const pick = ev.target.closest('input[data-pick]');
    if (pick) {
      wordsState.picks[pick.dataset.pick] = pick.value;
      // one pick per question, made in whichever copy: the Inbox's card and the thread's show it alike
      for (const el of document.querySelectorAll(`input[data-pick="${CSS.escape(pick.dataset.pick)}"]`)) { (el as Loose).checked = (el as Loose).value === pick.value; el.closest('.choice')?.classList.toggle('picked', (el as Loose).checked); }
      if (pick.value === '__other') pick.closest('[data-qcard]')?.querySelector('textarea[data-q]')?.focus();
      // another answer than Done: the not-done marks go, on every copy
      if (pick.value !== 'Done' && wordsState.NOT_DONE.delete(pick.dataset.pick)) oaPaint();
      return;
    }
    const ps = ev.target.closest('[data-post-secrets]');
    if (ps) {
      const id = ps.dataset.postSecrets;
      const err = $(`e-${id}`);
      const inputs = [...document.querySelectorAll(`#q-${CSS.escape(id)} [data-secret]`)];
      const values = {};
      for (const el of inputs) {
        const name = (el as Loose).dataset.secret.slice(id.length + 1);
        if ((el as Loose).type === 'file') { const f = (el as Loose).files?.[0]; if (f) (values as Loose)[name] = { b64: await later(toB64, f) }; }
        else if ((el as Loose).value) (values as Loose)[name] = (el as Loose).value;
      }
      if (!Object.keys(values).length) { if (err) err.textContent = 'Paste a value or choose a file first.'; return; }
      // a store started is a store finished: name what's missing before anything is cleared or sent
      const stores = new Map();
      for (const el of inputs) if ((el as Loose).dataset.sopsStore) stores.set((el as Loose).dataset.sopsStore, [...(stores.get((el as Loose).dataset.sopsStore) || []), (el as Loose).dataset.secret.slice(id.length + 1)]);
      for (const [file, names] of stores) {
        const missing = names.filter((n: Loose) => !(n in values));
        if (missing.length && missing.length < names.length) { if (err) err.textContent = `${file} takes these together: add ${missing.join(', ')} too, or post none of them yet.`; return; }
      }
      if (err) err.textContent = '';
      // at once: the card says it is posting and takes no second press. It stays in the Inbox until the
      // server says the question is answered (every secret posted). The values never stay in the page:
      // wiped from the fields now, and from memory once the post returns, whatever it says.
      ps.disabled = true; ps.textContent = 'Posting…';
      inputs.forEach((el: Loose) => { el.value = ''; });
      press(`q:${id}`, {
        build: () => ({ action: 'secret', body: { id, values } }),
        onOk: (out: Loose) => { if (/is answered/.test(out.out || '')) markAnswered(id, 'Posted'); },
        restore: () => { const b = document.querySelector(`[data-post-secrets="${CSS.escape(id)}"]`); if (b) { (b as Loose).disabled = false; b.textContent = 'Post'; } },
        errId: id,
      }).finally(() => { for (const k of Object.keys(values)) { wordsState.SECRET_DRAFTS.delete(`${id}:${k}`); delete (values as Loose)[k]; } });
      return;
    }
    const orv = ev.target.closest('[data-open-review]');
    if (orv) { location.hash = `review/${orv.dataset.openReview}`; return; }
    const dopen = ev.target.closest('[data-decline-open]');
    if (dopen) {
      const f = document.querySelector(`[data-decline-form="${CSS.escape(dopen.dataset.declineOpen)}"]`);
      if (f) { (f as Loose).hidden = !(f as Loose).hidden; if (!(f as Loose).hidden) f.querySelector('textarea')?.focus(); }
      return;
    }
    const dsend = ev.target.closest('[data-decline]');
    if (dsend) {
      const id = dsend.dataset.decline;
      return void later(reviewDecline, id, (document.querySelector(`textarea[data-q="${CSS.escape(id)}"]`) as Loose)?.value.trim() ?? '', id, dsend);
    }
    if (ev.target.closest('[data-rv-rows] > summary')) {
      ev.preventDefault();
      reviewState.RV.rowsOpen = !reviewState.RV.rowsOpen;
      return void renderReviewPreview();
    }
    if (ev.target.closest('[data-rv-raw]')) {
      const pre = ev.target.closest('p')?.nextElementSibling;
      if (pre?.classList.contains('rv-raw')) { pre.hidden = !pre.hidden; ev.target.textContent = pre.hidden ? 'Show raw JSON' : 'Hide raw JSON'; if (reviewState.RV) reviewState.RV.rawOpen = !pre.hidden; }
      return;
    }
    const lok = ev.target.closest('[data-rv-link-ok]');
    if (lok) { lsSet(sitesKey(), [...new Set([...(lsGet(sitesKey()) || []), lok.dataset.rvLinkOk])]); $('rv-link')!.hidden = true; return; }
    if (ev.target.closest('[data-rv-link-close]')) { $('rv-link')!.hidden = true; return; }
    const rva = ev.target.closest('[data-rv-answer]');
    if (rva) return void later(reviewAnswer, rva);
    if (ev.target.closest('[data-rv-decline-open]')) {
      const f = $('rv-decline-form');
      f!.hidden = !f!.hidden;
      if (!f!.hidden) $('rv-decline-note')!.focus();
      return;
    }
    const rvd = ev.target.closest('[data-rv-decline]');
    if (rvd && reviewState.RV?.qid) return void later(reviewDecline, reviewState.RV.qid, ($('rv-decline-note') as Loose)!.value.trim(), 'rv', rvd);
    // A secret's card can be answered without posting anything: a note (Reply), or Can't right now
    // with the note if there is one. Either is an answer the supervisor reads; no value moves.
    const cant = ev.target.closest('[data-cant], [data-reply], [data-dontuse]');
    if (cant) {
      const id = cant.dataset.cant ?? cant.dataset.reply ?? cant.dataset.dontuse;
      const { card, errId } = qcardOf(cant);
      const note = ((card as Loose)?.querySelector('textarea[data-q]')?.value ?? '').trim();
      if (cant.dataset.reply !== undefined && !note) { const e = $(`e-${errId}`); if (e) e.textContent = 'Write the note first.'; return; }
      const answer = cant.dataset.dontuse !== undefined ? "Don't use this sensor" : cant.dataset.reply !== undefined ? note : note ? `Can’t right now: ${note}` : 'Can’t right now';
      const seen = seenHash(id);
      answerPress(id, card, errId, answer, () => ({ action: 'answer', body: { id, answer, seen } }));
      return;
    }
    // a refused answer's line, dismissed: from every copy of the card at once (a focused button in a
    // thread's turns would hold that copy's redraw)
    const dis = ev.target.closest('[data-dismiss-refused]');
    if (dis) {
      const id = dis.dataset.dismissRefused;
      attachmentsState.REFUSED.delete(id);
      for (const el of document.querySelectorAll(`[data-refused="${CSS.escape(id)}"]`)) el.remove();
      redrawNow();
      return;
    }
    // A named record's own control on an owner-action card: what the Knowledge page and the goal's hold
    // bar post. The row shows the press at once on every copy (oaPaint), and comes back if refused.
    const oak = ev.target.closest('[data-oa-know]');
    if (oak) {
      const id = oak.dataset.oaKnow, status = oak.dataset.status, qid = oak.dataset.oaQ;
      const { pre } = qcardOf(oak);
      press(`k:${id}`, {
        build: () => ({ action: 'knowledge', body: { id, status } }),
        apply: () => { const qv = (shell.DATA as Loose).questions.find((x: Loose) => x.id === qid); wordsState.OA_SET.set(id, { status, at: new Date().toISOString(), words: qv ? (oaState(qv, id) as Loose).words : undefined }); oaPaint(); },
        undo: () => { wordsState.OA_SET.delete(id); oaPaint(); },
        onOk: () => { peeksState.PEEKS.delete(peekKey('lesson', id)); },
        errId: `${pre}oa-${qid}-${id}`,
      });
      return;
    }
    // Let go, then Confirm let go: the confirm in page memory, so a refresh doesn't take it back
    const oag = ev.target.closest('[data-oa-goal]');
    if (oag) {
      const id = oag.dataset.oaGoal, qid = oag.dataset.oaQ;
      const { pre } = qcardOf(oag);
      if (!oaConfirming(id)) { wordsState.OA_CONFIRM.set(id, Date.now() + 6000); setTimeout(oaPaint, 6050); oaPaint(); return; }
      wordsState.OA_CONFIRM.delete(id);
      press(`g:${id}`, {
        build: () => ({ action: 'goal-decide', body: { id, verdict: 'let-go' } }),
        overlay: holdOverlay(id, 'let-go'),
        apply: () => { wordsState.OA_SET.set(id, { status: 'abandoned', at: new Date().toISOString() }); oaPaint(); redrawNow(); redraw(); },
        undo: () => { wordsState.OA_SET.delete(id); oaPaint(); },
        onOk: () => { later(loadFleet); },
        errId: `${pre}oa-${qid}-${id}`,
      });
      return;
    }
    // Answer: the pick and the words, posted on the first press (kit-313)
    const btn = ev.target.closest('[data-answer]');
    if (btn) {
      const id = btn.dataset.answer;
      const { card, errId } = qcardOf(btn);
      const note = ((card as Loose)?.querySelector('textarea[data-q]')?.value ?? '').trim();
      // "Something else" is no pick: the words alone
      const picked = wordsState.picks[id] && wordsState.picks[id] !== '__other' ? wordsState.picks[id] : '';
      const answer = picked ? (note ? `${picked} — ${note}` : picked) : note;
      const err = $(`e-${errId}`);
      // the files dropped into the note go with it, or alone; none while one is uploading or refused
      const s = sendable(`q:${id}`);
      if ((s as Loose).why) { if (err) err.textContent = (s as Loose).why; return; }
      const files = (s as Loose).files;
      if (!answer && !files.length) { if (err) err.textContent = 'Pick a choice or write an answer.'; return; }
      if (err) err.textContent = '';
      const goalId = btn.dataset.goalAsk;
      const qv = (shell.DATA as Loose).questions.find((x: Loose) => x.id === id);
      // a card with choices sends the owner's words and their pick apart, the pick null for words alone, so
      // the kit never reads words as a choice; a goal approval and an owner-action keep their own answers
      const apart = !!qv && (choicesOf(qv) as Loose).length > 0 && !['goal-approval', 'owner-action', 'review'].includes(qv.kind) && !(qv.secrets || []).length;
      // Done on an owner-action whose named records aren't all done: never an answer, however often it is
      // pressed. Each unchanged record says so, and the line above Send says what to do instead.
      if (isOa(qv) && picked === 'Done') {
        const open = oaOpen(qv);
        if ((open as Loose).length) { wordsState.NOT_DONE.set(id, open); oaPaint(); return; }
      }
      if (wordsState.NOT_DONE.delete(id)) oaPaint();
      if (goalId && !Object.hasOwn(wordsState.GOAL_VERDICTS, picked)) { if (err) err.textContent = 'Choose Approve, Refine or Let go.'; return; }
      if (goalId && picked === 'Refine' && !note) { if (err) err.textContent = 'Say in the notes what should change.'; return; }
      const auto = (card as Loose)?.querySelector('input[data-auto]:checked')?.value;
      const asRule = (card as Loose)?.querySelector('input[data-rulebox]')?.checked;
      if (asRule && !note && !picked) { if (err) err.textContent = 'Pick an answer or write the rule in the note to keep it as a standing rule.'; return; }
      // the note is the rule's wording; without one, the chosen answer is the standing answer to questions like this
      const qText = qv?.question || '';
      const rule = asRule ? (note || `${picked}: the standing answer to questions like “${qText}”`) : undefined;
      const seen = seenHash(id);
      // files alone: the card says what the server records (no pick, and no words of the owner's)
      answerPress(id, card, errId, goalId ? picked + (note ? ` — ${note}` : '') : answer || filesWords(files.length), () => (goalId
        ? { action: 'goal-decide', body: { id: goalId, verdict: (wordsState.GOAL_VERDICTS as Loose)[picked], notes: note || undefined } }
        : { action: 'answer', body: { id, answer: apart ? note : answer, ...(apart ? { choice: picked || null } : {}), autonomy: auto ? Number(auto) : undefined, rule: rule || undefined, seen, ...(files.length ? { files } : {}) } }), goalId ? { plain: GOAL_REFUSAL } : { files });
      return;
    }
    // Keep it / Retire it on the Inbox's lesson card (a peek's Retire it starts a thread: kit-88 spec §2.3)
    const know = ev.target.closest('[data-know]');
    if (know) {
      const kid = know.dataset.know, status = know.dataset.status;
      const noteEl = document.querySelector(`textarea[data-know-note="${CSS.escape(kid)}"]`);
      const typed = (noteEl as Loose)?.value ?? '';
      const note = status === 'accepted' ? typed.replace(/\s+/g, ' ').trim() : '';
      // the lesson leaves the Inbox at once, and stays out until the data says it is kept or retired
      const pending = (k: Loose) => k.id === kid && k.status === 'candidate';
      press(`k:${kid}`, {
        build: () => ({ action: 'knowledge', body: { id: kid, status, ...(note ? { note } : {}) } }),
        overlay: { data: (d: Loose) => ({ ...d, ooda: { ...d.ooda, knowledge: d.ooda.knowledge.filter((k: Loose) => !pending(k)) } }), agrees: (raw: Loose) => !raw.ooda.knowledge.some(pending) },
        apply: () => { shell.drafts[`know:${kid}`] = typed; know.closest('.card')?.remove(); },
        onOk: () => { delete shell.drafts[`know:${kid}`]; },
        errId: kid,
      });
      return;
    }
    const corr = ev.target.closest('[data-correct]');
    if (corr) {
      const form = document.querySelector(`[data-correct-form="${corr.dataset.correct}"]`);
      (form as Loose)!.hidden = !(form as Loose)!.hidden;
      if (!(form as Loose)!.hidden) form!.querySelector('input')!.focus();
      return;
    }
    const over = ev.target.closest('[data-overrule-send]');
    if (over) {
      const id = over.dataset.overruleSend;
      const field = document.querySelector(`input[data-overrule="${CSS.escape(id)}"]`);
      const answer = (field as Loose)?.value ?? '';
      // bound to the question as this page showed it, like every answer
      const seen = ((shell.DATA as Loose)?.ooda?.answered || []).find((x: Loose) => x.id === id)?.hash ?? seenHash(id);
      const row = over.closest('.row-inline');
      const was = row?.innerHTML;
      // the answered card keeps its place; the row says what was sent, and comes back if refused
      press(`q:${id}`, {
        // typed text with no picker: the owner's words alone, never read as a choice
        build: () => ({ action: 'answer', body: { id, answer, choice: null, ...(seen ? { seen } : {}) } }),
        apply: () => { if (row) row.innerHTML = `<span class="answered-note"><i class="icon-circle-check" aria-hidden="true"></i> Overruled: <b>${esc(answer)}</b></span><span class="err" id="e-${esc(id)}"></span>`; },
        restore: () => { const f = document.querySelector(`input[data-overrule="${CSS.escape(id)}"]`); if (f) (f as Loose).value = answer; else if (row && was) row.innerHTML = was; },
        errId: id,
      });
      return;
    }
    const send = ev.target.closest('[data-correct-send]');
    if (send) {
      const id = send.dataset.correctSend;
      const reason = (document.querySelector(`input[data-reason="${id}"]`) as Loose)!.value;
      // the Decide feed's forms are keyed dec:<id>, so a call listed in both feeds has two
      // a goal's impact (keyed imp:<id>) goes with the value the owner gives it
      const level = (document.querySelector(`select[data-impact="${id}"]`) as Loose)?.value;
      const form = send.closest(`[data-correct-form]`) ?? document.querySelector(`[data-correct-form="${CSS.escape(id)}"]`);
      press(`correct:${id}`, {
        build: () => ({ action: 'correct', body: { id: id.replace(/^(dec|imp):/, ''), reason, ...(level ? { impact: Number(level) } : {}) } }),
        apply: () => { if (form) { form.hidden = true; form.insertAdjacentHTML('afterend', `<p class="small answered-note" data-correct-sent="${esc(id)}"><i class="icon-circle-check" aria-hidden="true"></i> Correction sent</p>`); } },
        restore: () => {
          document.querySelectorAll(`[data-correct-sent="${CSS.escape(id)}"]`).forEach((el: Loose) => el.remove());
          const f = document.querySelector(`[data-correct-form="${CSS.escape(id)}"]`);
          if (f) { (f as Loose).hidden = false; const r = f.querySelector(`input[data-reason="${CSS.escape(id)}"]`); if (r) (r as Loose).value = reason; }
        },
        errId: id,
      });
      return;
    }
  });
  document.addEventListener('click', (e: Loose) => {
    const a = viewer() && e.target.closest?.('a[href^="#"]:not([href^="#talk/"])');
    if (!a) return;
    e.preventDefault();
    const h = a.getAttribute('href');
    window.open(`/${h}`, '_blank', 'noopener,noreferrer');
  });
  if (viewer()) viewerBoot();
  else { later(loadSchemaDocs); load(); setInterval(load, POLL_MS); }
  installHubFleet();
}
