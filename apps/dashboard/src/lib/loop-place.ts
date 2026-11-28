// kit-996: the loop-place block of index.html (fromWords, recordHref, loopPlace, lineageList), as index.html has it,
// with types. No imports and no DOM at import: compiled to lib-dist/lib/loop-place.js, which
// test/ooda-lineage.test.mjs imports. What the block uses from outside it comes through wireLoopPlace(), which
// src/views/loop/wire.ts calls once with the shell's state object and esc, and words' linkify, qlink, who, words
// and when; a seam not wired throws, and DATA is read as shell.DATA.
// `Loose` is `any`: the page's data has no fixed shape in index.html.
type Loose = any;
type Fn = (...a: Loose[]) => Loose;

const SEAMS = ['esc', 'linkify', 'qlink', 'when', 'who', 'words'] as const;
export type LoopPlaceWire = { shell: { DATA: Loose }; } & { [k in (typeof SEAMS)[number]]: Fn };

let shell: { DATA: Loose };
const wired: { [k: string]: Fn } = {};

// Each key given replaces that one seam or value; a key left out keeps what it had (as words-plain's wireWords).
export function wireLoopPlace(w: Partial<LoopPlaceWire>): void {
  if (w.shell) shell = w.shell;
  for (const k of SEAMS) if (typeof w[k] === 'function') wired[k] = w[k];
}
const need = (n: string): Fn => {
  const f = wired[n];
  if (typeof f !== 'function') throw new Error(`loop: ${n} is not wired`);
  return f;
};
const esc = (...a: Loose[]) => need('esc')(...a);
const linkify = (...a: Loose[]) => need('linkify')(...a);
const qlink = (...a: Loose[]) => need('qlink')(...a);
const when = (...a: Loose[]) => need('when')(...a);
const who = (...a: Loose[]) => need('who')(...a);
const words = (...a: Loose[]) => need('words')(...a);

// ---- index.html's lines ----
/* loop-place start */
// Where an observation came from, in your words (its provenance, which the kit computes).
export function fromWords(pv: Loose, o: Loose) {
  const r = pv?.ref;
  switch (pv?.from) {
    case 'sensor': return r === 'goal-measure' ? 'From a goal\'s measure, read by the kit' : `From the ${(shell.DATA?.sensors || []).some((x: Loose) => x.name === r) ? `<a class="linkish" href="#sensor/${encodeURIComponent(r)}">${esc(r)}</a>` : esc(r ?? 'kit\'s')} sensor`;
    case 'metrics': return r === 'pane' ? 'From the kit\'s check on the agents\' panes' : `From the kit's own checks (${esc(words(r ?? 'a finding').toLowerCase())})`;
    case 'spend': return 'From the spend meter';
    case 'owner': return 'From you';
    case 'owner-answer': return r ? `From your answer to ${qlink(r)}` : 'From your answer';
    case 'owner-thread': return r ? `From a thread with you (${linkify(r)})` : 'From a thread with you';
    case 'owner-chat': return 'From what you said in the supervisor chat';
    case 'retro': return 'From a retro';
    case 'worker': case 'planner': return `From ${esc(who(o?.created_by))}`;
    case 'supervisor': return 'From the supervisor';
    default: return pv?.from ? `From ${esc(pv.from)}` : '';
  }
}
// A record's sidepeek, from its id (a correction opens the call it corrects).
export const recordHref = (id: Loose) => { const x = String(id ?? '').replace(/^correction:/, ''); const k = { k: 'lesson', p: 'problem', d: 'decision', a: 'act', o: 'observation', q: 'q' }[x[0]]; return k && x[1] === '-' ? `#${k}/${encodeURIComponent(x)}` : null; };
export const aWord = (w: Loose) => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;
// Where an observation sits in the loop, one line: the kit's place for it (collectOoda, peek).
export function loopPlace(pl: Loose) {
  if (!pl) return '';
  const to = (h: Loose, t: Loose) => (h ? `<a class="linkish" href="${esc(h)}">${t}</a>` : t);
  const sig = (t: Loose) => to(`#signal/${encodeURIComponent(pl.ref ?? '')}`, t);
  const why = pl.why ? `: ${linkify(pl.why)}` : '';
  switch (pl.state) {
    case 'new': return 'Not oriented yet';
    case 'signal': return pl.recurring ? `Part of a ${sig('recurring signal')} (seen ${esc(pl.n)} times)` : pl.n >= 3 ? `Seen ${esc(pl.n)} times, by one writer on one day: ${sig('not a recurring signal yet')}` : `Part of a ${sig('recurring signal')} (${esc(pl.n)} of 3)`;
    case 'explained': return `Explained: became ${to(recordHref(pl.ref), esc(aWord(pl.why || 'lesson')))}`;
    case 'noise': return `Ruled ${to(recordHref(pl.ref), 'noise')}${why}`;
    case 'ignored': return `${to(recordHref(pl.ref), 'Ignored at triage')}${why}`;
    case 'set-aside': return `${to(recordHref(pl.ref), 'Set aside')} until ${esc(when(pl.until))}${why}`;
    case 'carried': return `Carried on: ${esc(pl.why)} ${to(recordHref(pl.ref), '(the furthest step)')}`;
    default: return '';
  }
}
// The lineage as a list, when its graph can't be drawn (Mermaid didn't load, or failed): by stage
// in the loop's order, then what it is about; every record that has a sidepeek a link to it.
export const LINEAGE_STAGES = [['observe', 'Observe'], ['orient', 'Orient'], ['decide', 'Decide'], ['act', 'Act'], ['learn', 'Learn'], ['inbox', 'Asked you'], ['measurement', 'Measured'], [null, 'What it is about']];
export function lineageList(L: Loose) {
  const inLoop = LINEAGE_STAGES.map(([s]: Loose) => s).filter(Boolean);
  const item = (n: Loose) => `<li>${n.href ? `<a class="linkish" href="${esc(n.href)}"${n === L.nodes[0] ? ' aria-current="page"' : ''}>${esc(n.label)}</a>` : esc(n.label)} <span class="muted">${esc(words(n.kind ?? n.type))}</span></li>`;
  return `<div class="lineage-list">${LINEAGE_STAGES.map(([s, title]: Loose) => { const xs = L.nodes.filter((n: Loose) => (s ? n.stage === s : !inLoop.includes(n.stage))); return xs.length ? `<h4>${title}</h4><ul>${xs.map(item).join('')}</ul>` : ''; }).join('')}</div>`;
}
/* loop-place end */
