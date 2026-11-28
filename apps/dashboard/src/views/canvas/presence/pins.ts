// ---- pins (kit-664): a thread on a layer (canvas@1 §10) (canvas.html 5093-5470, kit-1018) ----
// Each declaration is the page's own, with types added. The Comment layer and the card's elements, which
// the page made at load, are module lets that initPins() makes, in the page's order with its listeners
// and its read timer. No DOM at import.
import { $, isObj, live, state, type Json } from '../core/page';
import { nodeOf } from '../core/nodes';
import { ready, typing } from '../panels';
import { othersLayer } from './cursors';

export type Card = { id: string; node: Json; until: number };
export type Turn = { who: string; text: string };
export type Pin = { id: string; node: string; at: string; turns: Turn[]; n?: number };
export type Pins = {
  level: string | null; list: Pin[]; mode: boolean; card: Card | null; reading: boolean; again: boolean;
  sending: boolean; turnsKey: string | null; lastRead: number;
};

// A pin is an open thread of the dashboard's whose subject is an artifact note on this canvas
// anchored to a node, { kind: 'artifact', slug, at, anchor: { node } }. The threads are read from
// /api/threads once presence has said who this person is (pins.level, from their own entry in
// `people`), then at once on presence's `changed` (the log grew), every 2 s while a card is open
// and every 10 s otherwise; before that, and on main's copy (no presence), no pins and no Comment
// tool. Only a Full person gets the Comment tool and a box to write in; a View person reads. Posts
// go to the dashboard's own /api/thread-new and /api/thread-say. Every text is set by textContent;
// a node is found by id in `drawn` and `nodeOf`, never by a selector built from the log's id.
export const PIN_MS = 2000; // with a card open
export const PIN_IDLE_MS = 10000; // with none
export const PIN_READ_MS = 10000; // a read that hangs gives up
export const PIN_TITLE_MAX = 120; // the dashboard's THREAD_TITLE_MAX
export const PIN_WAIT_MS = 10000; // a new thread's card waits this long for the read that lists it
export const PIN_UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
export const PIN_TEXT = {
  hint: 'Say what should change. The supervisor reads it and can make the edit here, live.',
  notSent: "That wasn't sent. Try again in a moment.",
  taken: 'Someone pinned this layer first. Your words are still here: Send puts them in that thread.',
  deleted: "That wasn't sent: the layer was deleted.",
  gone: 'on a deleted layer',
  owner: 'Owner',
  supervisor: 'The supervisor',
};
// level: 'full', 'view' or null (not known); list: this canvas's pins, numbered by when they began;
// mode: the Comment tool on; card: the card open ({ id: <thread> | 'new', node, until }) or null;
// lastRead: when the last read began (Date.now()).
export const pins: Pins = { level: null, list: [], mode: false, card: null, reading: false, again: false, sending: false, turnsKey: null, lastRead: 0 };
export let pinLayer: HTMLDivElement;
export const pinEls = new Map<string, HTMLButtonElement>(); // thread id -> its pin, kept so a press on it survives a placement
// The card: one dialog in <body>, beside its pin, its parts kept so a read never clears what is typed.
export let pinCard: HTMLDivElement;
export let cardHead: HTMLHeadingElement;
export let cardTurns: HTMLDivElement;
export let cardForm: HTMLDivElement;
export let pinText: HTMLTextAreaElement;
export let cardErr: HTMLParagraphElement;
export let cardActs: HTMLDivElement;
export let cardClose: HTMLButtonElement;
export let pinSend: HTMLButtonElement;
// Our level, from presence: anything but full or view is not known.
export function setLevel(l: Json): void {
  const v = l === 'full' || l === 'view' ? l : null;
  if (pins.level === v) return;
  pins.level = v;
  document.body.dataset.level = v === null ? '' : v;
  if (v !== 'full') setPinMode(false);
  syncPinBar();
  renderCard();
  readPins();
}
export const canPin = (): boolean => pins.level === 'full' && ready();
export function syncPinBar(): void {
  $('pinBar').hidden = !canPin();
  if (!canPin() && pins.mode) setPinMode(false);
}
export function setPinMode(on: Json): void {
  pins.mode = !!on && canPin();
  $('pinTool').setAttribute('aria-pressed', String(pins.mode));
  $('stage').classList.toggle('pinning', pins.mode);
}
// With the Comment tool on, a press on the stage is the tool's: taken before the stage's own
// listeners (they bubble), and its click pins the drawn node under it (inside an instance, the
// instance); a click on empty stage only ends the tool.
export const pinPress = (e: MouseEvent): e is MouseEvent & { target: Element } => pins.mode && e.button === 0 && e.target instanceof Element && !e.target.closest('.zoom, .stage-top, #tools, #pinBar, #pins');
// A layer's name, for a card or a title: its name, else its type.
export function nodeName(id: Json): string {
  const n = nodeOf(id);
  if (!n) return '';
  return typeof n.name === 'string' && n.name.trim() ? n.name : String(n.type);
}
// A thread's title for a pin: On "<name>", the name on one line with no control or bidi character
// (the dashboard refuses a title holding one), cut to fit the dashboard's 120.
export function pinTitle(id: Json): string {
  let name = nodeName(id).replace(PIN_UNSAFE, ' ').replace(/\s+/g, ' ').trim() || 'a layer';
  const room = PIN_TITLE_MAX - 'On ""'.length;
  if (name.length > room) {
    name = name.slice(0, room - 1);
    if (/[\ud800-\udbff]$/.test(name)) name = name.slice(0, -1);
    name += '…';
  }
  return `On "${name}"`;
}
export const pinOf = (id: Json): Pin | null => pins.list.find((p) => p.id === id) || null;
// A node's open pin opens; else a draft on it (a subject has one open thread: the dashboard refuses a second).
export function pinOn(node: Json): void {
  const had = pins.list.find((p) => p.node === node);
  if (had) openCard(had.id);
  else if (canPin()) { pins.card = { id: 'new', node, until: 0 }; pinText.value = ''; pins.turnsKey = null; renderCard(); pinText.focus(); }
}
export function openCard(id: string): void {
  if (pins.card?.id !== id) { pinText.value = ''; pins.turnsKey = null; }
  pins.card = { id, node: pinOf(id)?.node ?? null, until: 0 };
  renderCard();
}
export function closeCard(): void {
  pins.card = null;
  pins.turnsKey = null;
  pinText.value = '';
  renderCard();
}
export function cardSays(text: string): void { cardErr.textContent = text; cardErr.hidden = !text; }
// The card as pins.card and the last read say: its title, its turns (redrawn only when they
// changed, so a reply shows while it is open), and for a Full person the box and Send.
export function renderCard(): void {
  const c = pins.card;
  if (c === null) { pinCard.hidden = true; delete pinCard.dataset.thread; cardSays(''); return; }
  const p = c.id === 'new' ? null : pinOf(c.id);
  // a thread no longer listed (resolved, or another canvas's now) closes its card, but a new one
  // waits for the read that lists it
  if (c.id !== 'new' && p === null && Date.now() > c.until) { closeCard(); return; }
  pinCard.dataset.thread = c.id;
  const gone = c.node !== null && nodeOf(c.node) === null;
  cardHead.textContent = c.id === 'new' ? (gone ? 'New thread on a deleted layer' : `New thread on "${nodeName(c.node)}"`) : gone || c.node === null ? `Thread ${p?.n ?? ''} on a deleted layer` : `Thread ${p?.n ?? ''} on "${nodeName(c.node)}"`;
  pinCard.setAttribute('aria-label', cardHead.textContent);
  const turns = p ? p.turns : [];
  const key = JSON.stringify([c.id, turns]);
  if (key !== pins.turnsKey) {
    pins.turnsKey = key;
    const els: HTMLElement[] = [];
    if (c.id === 'new') {
      const h = document.createElement('p');
      h.className = 'hint';
      h.textContent = PIN_TEXT.hint;
      els.push(h);
    }
    for (const u of turns) {
      const t = document.createElement('div');
      t.className = 'turn';
      const w = document.createElement('span');
      w.className = 'who';
      w.textContent = u.who;
      const x = document.createElement('p');
      x.className = 'text';
      x.textContent = u.text;
      t.append(w, x);
      els.push(t);
    }
    cardTurns.replaceChildren(...els);
  }
  const write = pins.level === 'full';
  cardForm.hidden = !write;
  pinSend.hidden = !write;
  pinCard.hidden = false;
  placeCard();
}
// Beside its pin (a draft: beside its node), inside the window.
export function placeCard(): void {
  if (pinCard.hidden || pins.card === null) return;
  const c = pins.card;
  const at = c.id === 'new' ? live.drawn.get(c.node) : pinEls.get(c.id);
  const r = at && at.isConnected ? at.getBoundingClientRect() : $('stage').getBoundingClientRect();
  const w = pinCard.offsetWidth;
  const h = pinCard.offsetHeight;
  const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right + 8));
  const top = Math.max(12, Math.min(window.innerHeight - h - 12, r.top));
  pinCard.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
// The threads read again (one at a time; a read asked for during one runs after it). A failed read
// keeps the pins drawn.
export async function readPins(): Promise<void> {
  if (pins.level === null || !ready()) return;
  if (pins.reading) { pins.again = true; return; }
  pins.reading = true;
  pins.again = false;
  pins.lastRead = Date.now();
  let list: Json[] | null = null;
  try {
    const res = await fetch('/api/threads', { credentials: 'same-origin', cache: 'no-cache', signal: AbortSignal.timeout(PIN_READ_MS) });
    if (res.status === 200) {
      const j = await res.json();
      if (isObj(j) && Array.isArray(j.threads)) list = j.threads;
    }
  } catch { list = null; }
  pins.reading = false;
  if (list !== null) takePins(list);
  if (pins.again) readPins();
}
// This canvas's pins from the threads: open, an artifact subject naming this slug, anchored to a node.
export function takePins(threads: Json[]): void {
  const mine: Pin[] = [];
  for (const t of threads) {
    if (!isObj(t) || typeof t.id !== 'string' || t.status !== 'open' || !isObj(t.subject)) continue;
    const s = t.subject;
    if (s.kind !== 'artifact' || s.slug !== state.slug || !isObj(s.anchor) || typeof s.anchor.node !== 'string') continue;
    // a turn on the owner's channel is any person's (threads keep no name): "Owner"
    const turns = Array.isArray(t.turns) ? t.turns.filter(isObj).map((u: Json) => ({ who: u.by === 'owner' ? PIN_TEXT.owner : PIN_TEXT.supervisor, text: typeof u.text === 'string' ? u.text : '' })) : [];
    mine.push({ id: t.id, node: s.anchor.node, at: typeof t.created_at === 'string' ? t.created_at : '', turns });
  }
  mine.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  mine.forEach((p, i) => { p.n = i + 1; });
  pins.list = mine;
  if (pins.card !== null && pins.card.id !== 'new') { const p = pinOf(pins.card.id); if (p) pins.card.node = p.node; }
  // a draft on a layer someone else has pinned since becomes that pin's card, the words kept
  if (pins.card !== null && pins.card.id === 'new') {
    const had = mine.find((p) => p.node === pins.card!.node);
    if (had) { pins.card = { id: had.id, node: had.node, until: 0 }; pins.turnsKey = null; }
  }
  placePins();
  renderCard();
}
// One pin's element, kept by thread id; its content set again only when it changed.
export function pinEl(p: Pin, gone: boolean, name: string): HTMLButtonElement {
  let el = pinEls.get(p.id);
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.className = 'pin';
    el.dataset.thread = p.id;
    el.addEventListener('click', () => openCard(p.id));
    pinEls.set(p.id, el);
  }
  const key = JSON.stringify([p.n, gone, name, p.node]);
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.dataset.node = p.node;
    el.classList.toggle('gone', gone);
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = String(p.n);
    const parts = [n];
    if (gone) {
      const g = document.createElement('span');
      g.className = 'gone-note';
      g.textContent = PIN_TEXT.gone;
      parts.push(g);
    }
    el.replaceChildren(...parts);
    el.setAttribute('aria-label', gone ? `Thread ${p.n}, ${PIN_TEXT.gone}` : `Thread ${p.n} on ${name}`);
    el.title = gone ? 'On a deleted layer' : `Thread ${p.n}`;
  }
  return el;
}
// Every pin placed again: on its node's drawn top-right corner (the shown page's nodes only); a pin
// whose node is in no page of the document, down the stage's top-left on every page.
export function placePins(st: DOMRect = $('stage').getBoundingClientRect()): void {
  syncPinBar();
  const keep = new Set<Element>();
  let below = 0;
  // a deleted layer's pins start under the stage's own notes when they show at its top (12 px else)
  const tr = document.querySelector('.stage-top')!.getBoundingClientRect();
  const first = tr.height > 0 && tr.top - st.top < 40 ? Math.round(tr.bottom - st.top) + 6 : 12;
  if (ready()) {
    for (const p of pins.list) {
      if (nodeOf(p.node) === null) {
        const el = pinEl(p, true, '');
        el.style.transform = `translate(12px, ${first + 28 * below++}px)`;
        keep.add(el);
        continue;
      }
      const d = live.drawn.get(p.node);
      if (!d || !d.isConnected || d.getClientRects().length === 0) continue;
      const r = d.getBoundingClientRect();
      const el = pinEl(p, false, nodeName(p.node));
      el.style.transform = `translate(${Math.round(r.right - st.left - 11)}px, ${Math.round(r.top - st.top - 11)}px)`;
      keep.add(el);
    }
  }
  for (const el of [...pinLayer.children]) if (!keep.has(el)) el.remove();
  for (const el of keep) if (el.parentNode !== pinLayer) pinLayer.append(el);
  for (const [id, el] of pinEls) if (!keep.has(el)) pinEls.delete(id);
  placeCard();
}
// Send: a draft's words open its thread (/api/thread-new), an open card's are a turn in it
// (/api/thread-say). The words stay in the box until the dashboard says it took them.
export async function sendPin(): Promise<void> {
  const c = pins.card;
  const words = pinText.value.trim();
  if (c === null || !words || pins.sending || !canPin()) return;
  let action: string;
  let body: Json;
  if (c.id === 'new') {
    if (nodeOf(c.node) === null) { cardSays(PIN_TEXT.deleted); return; }
    action = 'thread-new';
    // the version pinned: the canvas being edited is its chore-canvas-<slug> worktree's; main's copy is main's
    const at = state.session !== null ? `chore-canvas-${state.slug}` : 'main';
    body = { title: pinTitle(c.node), subject: { kind: 'artifact', slug: state.slug, at, anchor: { node: c.node } }, text: words };
  } else {
    action = 'thread-say';
    body = { id: c.id, text: words };
  }
  pins.sending = true;
  pinSend.disabled = true;
  cardSays('');
  let j: Json = null;
  let ok = false;
  try {
    const res = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
    try { j = await res.json(); } catch { j = null; }
    ok = res.ok && isObj(j) && j.ok === true;
  } catch { ok = false; }
  pins.sending = false;
  pinSend.disabled = false;
  if (!ok) {
    // never the command's own words (they name commands): someone's open thread on this layer is
    // said as that, and read so the draft becomes its card (takePins), the words kept; else one plain line
    const taken = c.id === 'new' && isObj(j) && typeof j.error === 'string' && j.error.includes('is already open on this subject');
    if (pins.card === c) cardSays(taken ? PIN_TEXT.taken : PIN_TEXT.notSent);
    readPins();
    return;
  }
  if (pins.card === c) {
    pinText.value = '';
    if (c.id === 'new') {
      const id = isObj(j) && typeof j.out === 'string' ? j.out.split('\n')[0].trim() : '';
      if (/^t-[A-Za-z0-9-]{1,100}$/.test(id)) { pins.card = { id, node: c.node, until: Date.now() + PIN_WAIT_MS }; pins.turnsKey = null; renderCard(); } else closeCard();
    }
  }
  readPins();
}

// The page's load-time lines of this part (5121-5159, 5182-5217, 5334-5337), in its order: the Comment
// layer in #stage, the card in <body>, their listeners, and the read every 2 s. mount() runs it once.
export function initPins(): void {
  pinLayer = document.createElement('div');
  pinLayer.id = 'pins';
  $('stage').insertBefore(pinLayer, othersLayer.nextSibling);
  // a press on a pin or the Comment bar is theirs, never the stage's (a select, a move, a pan)
  for (const el of [pinLayer, $('pinBar')]) for (const k of ['pointerdown', 'click', 'dblclick']) el.addEventListener(k, (e) => e.stopPropagation());
  pinCard = document.createElement('div');
  pinCard.id = 'pinCard';
  pinCard.setAttribute('role', 'dialog');
  pinCard.hidden = true;
  cardHead = document.createElement('h2');
  cardTurns = document.createElement('div');
  cardForm = document.createElement('div');
  pinText = document.createElement('textarea');
  pinText.id = 'pinText';
  pinText.rows = 2;
  pinText.placeholder = 'Write to the supervisor…';
  pinText.setAttribute('aria-label', 'Your words');
  cardErr = document.createElement('p');
  cardErr.className = 'err';
  cardErr.setAttribute('role', 'status');
  cardErr.hidden = true;
  cardForm.append(pinText, cardErr);
  cardActs = document.createElement('div');
  cardActs.className = 'acts';
  cardClose = document.createElement('button');
  cardClose.type = 'button';
  cardClose.textContent = 'Close';
  pinSend = document.createElement('button');
  pinSend.type = 'button';
  pinSend.id = 'pinSend';
  pinSend.textContent = 'Send';
  cardActs.append(cardClose, pinSend);
  pinCard.append(cardHead, cardTurns, cardForm, cardActs);
  document.body.append(pinCard);
  cardClose.addEventListener('click', () => closeCard());
  pinSend.addEventListener('click', () => { sendPin(); });
  $('pinTool').addEventListener('click', () => setPinMode(!pins.mode));
  // C turns the Comment tool on and off (a Full person, no field focused); Escape ends it and closes a card.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (pins.mode) setPinMode(false); if (pins.card) closeCard(); return; }
    if (!canPin() || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); setPinMode(!pins.mode); }
  });
  // Escape inside the card is the card's: it closes it (and ends the tool) and goes no further, so the
  // page's own Escape (a listener on document, which clears the selection) never sees it (plan-1 F7)
  pinCard.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (pins.mode) setPinMode(false);
    closeCard();
  });
  $('stage').addEventListener('pointerdown', (e) => {
    if (!pinPress(e)) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  $('stage').addEventListener('click', (e) => {
    if (!pinPress(e)) return;
    e.stopPropagation();
    const hit = e.target.closest<HTMLElement>('#surface [data-id]');
    setPinMode(false);
    if (hit && nodeOf(hit.dataset.id)) pinOn(hit.dataset.id);
  }, true);
  // A press anywhere but the card, a pin or the bar closes the card.
  document.addEventListener('pointerdown', (e) => {
    if (!pins.card || !(e.target instanceof Element) || e.target.closest('#pinCard, #pins, #pinBar')) return;
    closeCard();
  }, true);
  // every 2 s with a card open, every 10 s with none, only while the page is shown
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (pins.card !== null || Date.now() - pins.lastRead >= PIN_IDLE_MS) readPins();
  }, PIN_MS);
}
