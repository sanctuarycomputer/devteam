// kit-1001: an answered question's card (index.html's attachments lines, after the attachments region): its hash,
// the card a control is on, and the card marked answered, as index.html has them, with types and exports.
// ANSWERED, REFUSED and REFUSALS are attachmentsState's (kit-989), read and written through it.
import { esc } from '../shell';
import { shell } from '../shell/state';
import { attachmentsState } from './state';
// `Loose` is `any`: the page's data and elements, untyped in index.html.
type Loose = any;

export const seenHash = (id: Loose) => ((shell.DATA as Loose)?.questions || []).find((x: Loose) => x.id === id)?.hash;
// The card a control is on, and its error line: the Inbox's copy of a question (q-<id>) or a thread
// card's (t-q-<id>), found from the control itself, so the two copies never answer for each other.
export const qcardOf = (el: Loose) => { const card = el.closest('[data-qcard]'); const pre = /^[tp]-/.exec(card?.id ?? '')?.[0] ?? ''; return { card, pre, errId: `${pre}${card?.dataset.qcard ?? ''}` }; };
export function markAnswered(id: Loose, text: Loose) {
  attachmentsState.ANSWERED.set(id, text);
  // both copies: the Inbox's and a thread card's
  for (const card of document.querySelectorAll(`[data-qcard="${CSS.escape(id)}"]`)) { card.classList.add('done'); card.innerHTML = `<div class="answered-note"><i class="icon-circle-check" aria-hidden="true"></i> Answered: <b>${esc(text)}</b></div>`; }
}
