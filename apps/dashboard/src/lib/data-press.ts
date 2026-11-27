// kit-989: data's press words and the hold overlay (index.html:8178-8182, 8243-8269), as index.html has them, with
// types. No imports and no DOM at import: compiled to lib-dist/lib/data-press.js.
// `Loose` is `any`: the page's data has no fixed shape in index.html.
type Loose = any;

// The servers' (the dashboard's, the hub's, the gateway's) terse refusal of a body they couldn't
// read says nothing the owner can act on: it is said in plain words, the press's own (plain) if it
// has some. Any other refusal is the server's own words.
export const TERSE_REFUSAL = /^(missing or invalid fields\b|bad json$)/;
export const PLAIN_REFUSAL = 'the server didn\'t take what this page sent, and nothing was recorded. Reload the page and try again.';
export const GOAL_REFUSAL = 'the server didn\'t take this approval as sent, and nothing was recorded. Reload the page and press Approve, Refine or Let go again.';
// A goal's hold as the server will show it right after the press: a drain or park is a transition
// (draining…, parking…) until the server says it has finished; never shown done ahead of it. Let go
// and restore change the goal's status; restore brings it back parked.
export function holdOverlay(id: string, mode: string): { data: (d: Loose) => Loose; agrees: (raw: Loose) => boolean } {
  const now = new Date().toISOString();
  const view = (h: Loose) => {
    const m = mode === 'let-go' ? 'let-go' : mode === 'restore' ? 'park' : mode;
    const state = m === 'drain' ? 'draining' : m === 'park' ? 'parking' : m === 'let-go' ? 'let go' : 'running';
    return { ...(h || {}), mode: m, state, by: 'owner', since: now, reason: m === 'run' ? null : h?.reason ?? null };
  };
  // as questionHold has it: parked, or nothing (a let-go goal's questions leave the Inbox)
  const goalHold = mode === 'park' || mode === 'restore' ? 'park' : null;
  const status = mode === 'let-go' ? 'abandoned' : null;
  return {
    data: (d) => {
      // restore's status is the goal's own from before it was let go, which the server works out
      const ooda = { ...d.ooda, goals: (d.ooda?.goals || []).map((g: Loose) => (g.id !== id ? g : { ...g, hold_view: view(g.hold_view), ...(status ? { status } : mode === 'restore' ? { restoring: true } : {}) })) };
      const questions = mode === 'let-go' ? d.questions.filter((q: Loose) => q.goal !== id) : d.questions.map((q: Loose) => (q.goal === id ? { ...q, goal_hold: goalHold } : q));
      return { ...d, ooda, questions, ...(id === 'upkeep' && d.upkeep ? { upkeep: view(d.upkeep) } : {}) };
    },
    agrees: (raw) => {
      const h = id === 'upkeep' ? raw.upkeep : (raw.ooda?.goals || []).find((g: Loose) => g.id === id)?.hold_view;
      if (mode === 'let-go') return (raw.ooda?.goals || []).find((g: Loose) => g.id === id)?.status === 'abandoned';
      if (mode === 'restore') return (raw.ooda?.goals || []).find((g: Loose) => g.id === id)?.status !== 'abandoned';
      return (h?.mode ?? 'run') === mode;
    },
  };
}
