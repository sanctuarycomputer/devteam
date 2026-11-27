// kit-989: data's presses (index.html:8159-8286): an action shown at once, sent, and undone if the server refuses it.
import { PLAIN_REFUSAL, TERSE_REFUSAL } from '../../lib/data-press';
import { markAnswered, putAttach, takeAttach } from '../attachments';
import { attachmentsState } from '../attachments/state';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { wordsState } from '../words/state';
import { STALE, drawOrHold, load, sending } from './boot';
import { dataState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A5). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export const OVERLAYS = new Map();

export let SAVING = 0;

export function overlaid(raw: Loose) {
  let d = raw;
  for (const [k, o] of [...OVERLAYS]) {
    // confirmed and either agreed with, or the data (fresh, not a stale copy) is the record by now
    if (o.confirmedAt && (o.agrees?.(raw) || (!STALE && Date.now() - o.confirmedAt > 120000))) { OVERLAYS.delete(k); continue; }
    try { d = o.data(d); } catch (e) { console.error(e); }
  }
  return d;
}

export const redrawNow = () => { if (dataState.RAW) drawOrHold(dataState.HELD ?? dataState.RAW, true); };

export const savingNote = () => { const el = $('saving'); if (el) el.hidden = SAVING === 0; };

export function press(key: Loose, { build, apply, overlay, undo, restore, errId, onOk, onError, plain }: Loose) {
  SAVING++;
  savingNote();
  const ov = overlay ? { ...overlay, confirmedAt: 0 } : null;
  if (ov) OVERLAYS.set(key, ov);
  try { apply?.(); } catch (e) { console.error(e); }
  const prev = dataState.PRESSES.get(key) ?? Promise.resolve();
  const run = prev.then(async () => {
    let out: Loose = null;
    let error: Loose = null;
    try {
      const { action, body } = build();
      const r = await sending(() => fetch(`/api/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
      try { out = await r.json(); } catch { out = null; }
      if (!r.ok || !out) error = TERSE_REFUSAL.test(out?.error ?? '') ? plain || PLAIN_REFUSAL : [out?.error || `the server answered ${r.status}`, out?.out].filter(Boolean).join(' · ');
    } catch (e) { error = `could not send: ${(e as Loose).message || e}`; }
    if (error) {
      // what the server did before it refused (a partly posted set of secrets) shows on the next read
      load({ force: true });
      if (ov && OVERLAYS.get(key) === ov) OVERLAYS.delete(key);
      try { undo?.(); } catch (e) { console.error(e); }
      // a caller that keeps the refusal itself (a question card's, drawn on every redraw) says so here
      try { onError?.(error); } catch (e) { console.error(e); }
      redrawNow();
      try { restore?.(); } catch (e) { console.error(e); }
      const el = !onError && errId && $(`e-${errId}`);
      if (el) el.textContent = `Not saved: ${error}`;
      return false;
    }
    if (ov) ov.confirmedAt = Date.now();
    try { onOk?.(out); } catch (e) { console.error(e); }
    load({ force: true });
    return true;
  }).finally(() => { SAVING--; savingNote(); if (dataState.PRESSES.get(key) === run) dataState.PRESSES.delete(key); });
  dataState.PRESSES.set(key, run);
  return run;
}

export function cardFields(id: Loose, card: Loose) {
  return { note: card?.querySelector('textarea[data-q]')?.value ?? shell.drafts[id], pick: wordsState.picks[id], boxes: [...document.querySelectorAll(`[data-qcard="${CSS.escape(id)}"]`)].map((c: Loose) => ({ at: c.id, auto: c.querySelector('input[data-auto]:checked')?.value ?? null, rule: !!c.querySelector('input[data-rulebox]')?.checked })) };
}

export function putBackCard(id: Loose, f: Loose) {
  attachmentsState.ANSWERED.delete(id);
  if (f.note !== undefined) shell.drafts[id] = f.note;
  if (f.pick !== undefined) wordsState.picks[id] = f.pick;
}

export function putBackBoxes(id: Loose, f: Loose) {
  // each copy gets back its own: the Inbox's, a thread's and a peek's boxes are separate answers
  for (const b of f.boxes) {
    const card = document.getElementById(b.at);
    if (!card) continue;
    if (b.auto !== null) { const r = [...card.querySelectorAll('input[data-auto]')].find((x: Loose) => x.value === b.auto); if (r) (r as Loose).checked = true; }
    const rb = card.querySelector('input[data-rulebox]');
    if (rb) (rb as Loose).checked = b.rule;
  }
}

export function answerPress(id: Loose, card: Loose, errId: Loose, text: Loose, build: Loose, { stays = true, plain, files }: Loose = {}) {
  const f = cardFields(id, card);
  let taken: Loose = null;
  return press(`q:${id}`, {
    build,
    apply: () => { attachmentsState.REFUSED.delete(id); if (files?.length) taken = takeAttach(`q:${id}`); markAnswered(id, text); },
    undo: () => { putBackCard(id, f); putAttach(`q:${id}`, taken); taken = null; },
    restore: () => putBackBoxes(id, f),
    onOk: () => { taken = null; attachmentsState.REFUSED.delete(id); delete shell.drafts[id]; delete wordsState.picks[id]; [...wordsState.SECRET_DRAFTS.keys()].filter((k: Loose) => k.startsWith(`${id}:`)).forEach((k: Loose) => wordsState.SECRET_DRAFTS.delete(k)); },
    ...(stays ? { onError: (e: Loose) => attachmentsState.REFUSED.set(id, { reason: e, n: ++attachmentsState.REFUSALS }) } : {}),
    errId,
    plain,
  });
}
