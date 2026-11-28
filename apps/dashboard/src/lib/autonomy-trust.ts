// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;

// kit-994: Trust's pure parts (index.html's autonomy lines): the levels in words, a call's hash, a kind's evidence.
// No imports and no DOM at import: compiled to lib-dist/lib/autonomy-trust.js.

// ---- Trust (kit-93): the Trust Score card, the kinds of decision by plain name, How the levels moved ----
// The levels in the design's words (the kit's RUNG_PLAIN; RUNG_WORDS stays for the pages that use it). A kind
// is named by its class_name, never its class id (which sits only in a row's hash).
export const TRUST_LEVELS = { 1: 'Asks you first', 2: 'Asks, goes ahead at a deadline', 3: 'Decides and tells you' };
export const trustLevel = (r: Loose) => (TRUST_LEVELS as Loose)[r] ?? '–';
export const trustCorrected = (t: Loose) => (t.corrections ? `${t.corrections} time${t.corrections > 1 ? 's' : ''}` : 'never');
// the hash of a call by its id's kind: an act, a decision or a question; null for any other
export const callHash = (id: Loose) => { const s = String(id ?? ''); const k = /^a-/.test(s) ? 'act' : /^d-/.test(s) ? 'decision' : /^q-/.test(s) ? 'q' : null; return k ? `${k}/${encodeURIComponent(s)}` : null; };
// A kind's evidence since it last moved (its newest history entry; all of it when it never moved): the answered
// questions its agreement counts and its calls since its last correction, each looked up in what /api/data holds
// (answered, acts, decisions). An id none of them holds is kept, as "a question" or "a call" with no date.
export function classEvidence(t: Loose, ooda: Loose) {
  const since = (t?.history || []).reduce((m: Loose, e: Loose) => (e.at && e.at > m ? e.at : m), '');
  const answered = new Map((ooda?.answered || []).map((q: Loose) => [q.id, q]));
  const acts = new Map((ooda?.acts || []).map((a: Loose) => [a.id, a]));
  const calls = new Map((ooda?.decisions || []).filter((r: Loose) => r.kind === 'decision' || r.kind === 'act').map((r: Loose) => [r.id, r]));
  const qs = (t?.agreement_questions || []).map((id: Loose) => {
    const q = answered.get(id);
    return { what: (q as Loose)?.question || 'a question', kind: q ? ((q as Loose).agreed_by_owner ? 'Agreed' : 'Not agreed') : null, at: (q as Loose)?.answered_at ?? null, open: `q/${encodeURIComponent(id)}` };
  });
  const cs = (t?.uncorrected_acts || []).map((id: Loose) => {
    const a = acts.get(id), r = calls.get(id);
    return { what: (a as Loose)?.what || (r as Loose)?.what || 'a call', kind: 'Call', at: (a as Loose)?.created_at ?? (r as Loose)?.at ?? null, open: a ? `act/${encodeURIComponent(id)}` : r ? `${(r as Loose).kind}/${encodeURIComponent(id)}` : callHash(id) };
  });
  return [...qs, ...cs].filter((x: Loose) => !x.at || !since || x.at > since).sort((a: Loose, b: Loose) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}
export const TRUST_SPLIT = [['alone', 'decided alone'], ['asked', 'asked you'], ['corrected', 'corrected']];
