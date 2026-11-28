// kit-990: words's lines of index.html (3124-3661 at f98e01ac), as index.html has them, with types: `when` and the
// plain words, the question cards, choicesOf and the answer flow's card side. No imports but wordsState's type,
// and no DOM at import: compiled to lib-dist/lib/words-plain.js (a lib module that imports code fails in Turbopack
// or on Node, spec S7, S8). What index.html's words lines use from outside them comes through wireWords(), which
// src/views/words/wire.ts calls once with the real objects: the four state objects (each rewritten name is
// `shell.X`, `attachmentsState.X`, `dataState.X` or `wordsState.X`) and 16 functions of other views and modules,
// each a delegator below that throws until it is wired. qtext, qinline and qblock are built by wordsText(), so a
// test can build them with its own links (plain-questions).
// `Loose` is `any`: the page's data has no fixed shape in index.html.
import type { wordsState as WordsState } from '../views/words/state';
type Loose = any;
type Fn = (...a: Loose[]) => Loose;

const SEAMS = ['esc', 'subj', 'ownerLesson', 'dropBox', 'chipsHtml', 'isFilled', 'qcardOf', 'previewHere', 'previewLinkHtml', 'focusMark', 'focusBack', 'peekOf', 'reviewCard', 'NEXT_ID', 'artViewer', 'pvViewer'] as const;
export type WordsWire = {
  shell: { DATA: Loose; drafts: Loose; PREVIEWS: Loose };
  wordsState: typeof WordsState;
  attachmentsState: { REFUSED: Map<Loose, Loose> };
  dataState: { PRESSES: Map<Loose, Loose> };
} & { [k in (typeof SEAMS)[number]]: Fn };

let shell: WordsWire['shell'];
let wordsState: Loose; // typed loosely here: index.html indexes its tables by any key
let attachmentsState: WordsWire['attachmentsState'];
let dataState: WordsWire['dataState'];
const wired: { [k: string]: Fn } = {};

// Each key given replaces that one seam or state object; a key left out keeps what it had (spec, The lib module).
export function wireWords(w: Partial<WordsWire>): void {
  if (w.shell) shell = w.shell;
  if (w.wordsState) wordsState = w.wordsState;
  if (w.attachmentsState) attachmentsState = w.attachmentsState;
  if (w.dataState) dataState = w.dataState;
  for (const k of SEAMS) if (typeof w[k] === 'function') wired[k] = w[k];
}
const need = (n: string): Fn => {
  const f = wired[n];
  if (typeof f !== 'function') throw new Error(`words: ${n} is not wired`);
  return f;
};
// the seams: shell's (lib/shell-page), data's (lib/data-inbox), attachments', library's, peeks', review's,
// overview's and viewer's functions, by the names index.html's words lines call
const esc = (...a: Loose[]) => need('esc')(...a);
const subj = (...a: Loose[]) => need('subj')(...a);
const ownerLesson = (...a: Loose[]) => need('ownerLesson')(...a);
const dropBox = (...a: Loose[]) => need('dropBox')(...a);
const chipsHtml = (...a: Loose[]) => need('chipsHtml')(...a);
const isFilled = (...a: Loose[]) => need('isFilled')(...a);
const qcardOf = (...a: Loose[]) => need('qcardOf')(...a);
const previewHere = (...a: Loose[]) => need('previewHere')(...a);
const previewLinkHtml = (...a: Loose[]) => need('previewLinkHtml')(...a);
const focusMark = (...a: Loose[]) => need('focusMark')(...a);
const focusBack = (...a: Loose[]) => need('focusBack')(...a);
const peekOf = (...a: Loose[]) => need('peekOf')(...a);
const reviewCard = (...a: Loose[]) => need('reviewCard')(...a);
const NEXT_ID = (...a: Loose[]) => need('NEXT_ID')(...a);
const artViewer = (...a: Loose[]) => need('artViewer')(...a);
const pvViewer = (...a: Loose[]) => need('pvViewer')(...a);

// ---- index.html's words lines ----
export const when = (iso?: Loose) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const cap = (x?: Loose) => { const t = String(x ?? ''); return t.charAt(0).toUpperCase() + t.slice(1); };

export const words = (x?: Loose) => cap(String(x ?? '').replace(/[-_]+/g, ' '));

export const ticketMap = (): Map<Loose, Loose> => new Map((shell.DATA?.tickets || []).map((t?: Loose) => [t.id, t]));

export const allQuestions = () => [...(shell.DATA?.questions || []), ...(shell.DATA?.ooda?.answered || [])];

export const who = (w?: Loose) => (w === 'owner' ? 'you' : w === 'supervisor' ? 'the supervisor' : ticketMap().has(w) ? `the agent on ${ticketMap().get(w).title}` : w?.startsWith('plan-') ? `the planner for ${w.slice(5)}` : w || '');

export const tlink = (id?: Loose) => { const t = ticketMap().get(id); return t ? `<a class="linkish" href="#ticket/${encodeURIComponent(id)}">${esc(t.title)}</a>` : `<code>${esc(id)}</code>`; };

export const qlink = (id?: Loose, text?: Loose) => { const q = allQuestions().find((x?: Loose) => x.id === id); return `<a class="linkish" href="#q/${encodeURIComponent(id)}">${esc(text || (q ? q.question.slice(0, 90) + (q.question.length > 90 ? '…' : '') : 'a question'))}</a>`; };

export const featureTitle = (f?: Loose) => shell.DATA?.ooda?.roadmap?.features?.[f]?.title || f;

export const flink = (f?: Loose) => `<a class="linkish" href="#feature/${encodeURIComponent(f)}">${esc(featureTitle(f))}</a>`;

export const slink = (sid?: Loose) => `<a class="linkish" href="#story/${encodeURIComponent(sid)}"><code>${esc(sid)}</code></a>`;

export const rlink = (r?: Loose) => `<a class="linkish" href="#release/${encodeURIComponent(r)}"><code>${esc(r)}</code></a>`;

export const wlink = (w?: Loose) => `<a class="linkish" href="#wave/${encodeURIComponent(w)}">Wave ${esc(w)}</a>`;

export const goalOf = (gid?: Loose) => (shell.DATA?.ooda?.goals || []).find((g?: Loose) => g.id === gid);

export const milestonesOf = (g?: Loose) => g?.forecast?.milestones || [];

export const glink = (gid?: Loose) => { const g = goalOf(gid); return g ? `<a class="linkish" href="#goal/${encodeURIComponent(gid)}">${esc(g.title)}</a>` : `<code>${esc(gid)}</code>`; };

export const mlink = (gid?: Loose, n?: Loose, title?: Loose) => `<a class="linkish" href="#milestone/${encodeURIComponent(`${gid}:${n}`)}">${esc(title ?? milestonesOf(goalOf(gid)).find((m?: Loose) => m.n === Number(n))?.title ?? `milestone ${n}`)}</a>`;

export function idLink(k?: Loose, id?: Loose) {
  const href = { g: 'goal', k: 'lesson', a: 'act', d: 'decision', p: 'problem', m: 'thread', t: 'talk', o: 'observation', q: 'q' }[k as 'g'];
  if (!href) return `<code>${esc(id.slice(0, 22))}…</code>`;
  if (k === 'g' && goalOf(id)) return glink(id);
  return `<a class="linkish" href="#${href}/${encodeURIComponent(id)}"><code>${esc(id.slice(0, 22))}…</code></a>`;
}

export const subjectLink = (subj?: Loose) => (/^thread:t-/.test(subj ?? '') ? linkify(subj.slice(7)) : ticketMap().has(subj) ? tlink(subj) : /^[a-z]-\d{8}-\d{9}-/.test(subj ?? '') || /^plan-/.test(subj ?? '') || /^sensor:/.test(subj ?? '') ? linkify(subj) : subj ? `<code>${esc(subj)}</code>` : '');

export const scopeWords = (sc?: Loose) => (!sc || sc === 'project' ? 'the whole project' : sc.replace(/^component:/, 'component ').replace(/^feature:/, 'feature ').replace(/^class:/, 'decisions of kind ').replace(/^chore:devteam-sync/, 'devteam upgrades').replace(/^chore:/, 'chore '));

export function authorityWords(u?: Loose) {
  if (!u) return '';
  const rung = u.rung ? ` (${esc(wordsState.RUNG_WORDS[u.rung])}${u.ceiling && u.ceiling !== u.rung ? `, at most ${esc(wordsState.RUNG_WORDS[u.ceiling])}` : ''})` : '';
  switch (u.authority) {
    case 'rung': return `within its trust${rung}`;
    case 'answer': return u.approved_by ? `with your answer to ${qlink(u.approved_by)}` : 'with your answer';
    case 'default': return u.approved_by ? `with the default on ${qlink(u.approved_by)}${rung}` : 'with a default';
    case 'standing-rule': return u.approved_by ? `under <a class="linkish" href="#lesson/${encodeURIComponent(u.approved_by)}">a standing rule you gave</a>` : 'under a standing rule you gave';
    default: return u.approved_by ? approvedBy(u.approved_by) : 'under the constitution';
  }
}

export const dlink = (id?: Loose, text?: Loose) => `<a class="linkish" href="#decision/${encodeURIComponent(id)}">${text ? esc(text) : 'a decision'}</a>`;

export function actUnder(a?: Loose) {
  const u = a.under;
  if (!u) return a.approved_by ? approvedBy(a.approved_by) : 'its own call';
  if (u.decision) return `under ${dlink(u.decision, u.what ? `“${u.what.length > 70 ? `${u.what.slice(0, 70)}…` : u.what}”` : null)}${u.corrected ? ' <span class="badge high">decision corrected</span>' : ''}`;
  if (u.approved_by) return approvedBy(u.approved_by);
  return u.authority === 'rung' ? 'its own call, within its trust' : 'its own call';
}

export const approvedBy = (id?: Loose) => (id?.startsWith('q-') ? `with your answer to ${qlink(id)}` : id?.startsWith('k-') ? 'under a standing rule you gave' : `approved by ${esc(id)}`);

export function linkify(text?: Loose) {
  // One pass over the escaped text: each id becomes a link once, and nothing inside a link (its
  // href, its text) is scanned again, so an id holding a planner's name (m-…-plan-x) stays whole.
  // A doc path, with the branch or commit written after it: one link to the file, the " on <ref>"
  // left as text after it (kit-327). A ticket id only where it stands alone, never inside a path, a
  // branch or a filename (ticket/<id>, <id>/x.md, docs/<id>.md).
  const h = esc(text ?? '');
  const ids = [...ticketMap().keys()].sort((a?: Loose, b?: Loose) => b.length - a.length);
  const DOC = String.raw`(?<![^\s(\[\x7b,;>])(?<!&amp;|\w&#39;)(?:\.\.\/)?[A-Za-z_.][\w.-]*(?:\/[\w.-]+)*\/[\w.-]*\.[A-Za-z][A-Za-z0-9]*(?![\w\/-]|\.\w)(?: (?:on (?:(?:ticket|plan)\/[\w.-]*[A-Za-z0-9]|main)|at [0-9a-f]{40})(?![\w\/-]|\.\w))?`;
  const parts = [
    String.raw`\bq-\d{8}-\d{9}-[a-z0-9-]+`,
    String.raw`\b[gkapmodt]-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*`,
    ...(ids.length ? [String.raw`(?<![\w./-])(?:${ids.map((x?: Loose) => x.replace(/[-.]/g, '\\$&')).join('|')})(?![\w\/-]|\.[A-Za-z0-9])`] : []),
    String.raw`\bsensor:[A-Za-z0-9][A-Za-z0-9_.-]*`,
    String.raw`\bplan-[a-z0-9]+(?:-[a-z0-9]+)*\b`,
    String.raw`\b[0-9a-f]{40}\b`,
    String.raw`\bsanctuarycomputer\/devteam#\d+`,
  ];
  const rest = new RegExp(parts.join('|'), 'g');
  const doc = (m?: Loose) => {
    const [, p, sep, ref] = /^(\S+?)(?:( (?:on|at) )(\S+))?$/.exec(m)!;
    const repoHref = repoDocHref(p, ref);
    // a home path keeps its ref, a merged home ticket's its merge commit; any other .. is no doc
    const t = !repoHref && ref?.startsWith('ticket/') ? ticketMap().get(ref.slice('ticket/'.length)) : null;
    const at = t?.merge_sha && t.repo === 'home' ? t.merge_sha : ref;
    if (!repoHref && (!ref || p.split('/').includes('..'))) return m.replace(rest, one);
    const href = repoHref || fileHref({ path: p, ref: at, title: p });
    const after = sep ? `${sep}${ref}` : '';
    return /^https:/.test(href) ? `<a class="linkish" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${p}</a>${after}` : `<a class="linkish" href="${esc(href)}">${p}</a>${after}`;
  };
  const one = (m?: Loose) => {
    if (/^q-\d{8}-\d{9}-/.test(m)) return qlink(m);
    if (/^[gkapmodt]-\d{8}-\d{9}-/.test(m)) return idLink(m[0], m);
    if (ticketMap().has(m)) return tlink(m);
    if (m.startsWith('sensor:')) { const n = m.slice('sensor:'.length); return (shell.DATA?.sensors || []).some((x?: Loose) => x.name === n) ? `<a class="linkish" href="#sensor/${encodeURIComponent(n)}">${esc(n)}</a>` : m; }
    if (m.startsWith('plan-')) { const f = m.slice('plan-'.length); return (shell.DATA?.planners || []).some((x?: Loose) => x.feature === f) ? `<a class="linkish" href="#planner/${encodeURIComponent(f)}">${m}</a>` : m; }
    if (/^[0-9a-f]{40}$/.test(m)) return `<code>${m.slice(0, 12)}</code>`;
    const pr = m.split('#')[1];
    return `<a class="linkish" href="https://github.com/sanctuarycomputer/devteam/pull/${pr}" target="_blank" rel="noopener noreferrer">devteam #${pr}</a>`;
  };
  return h.replace(new RegExp(`(${DOC})|${rest.source}`, 'g'), (m?: Loose, d?: Loose) => (d !== undefined ? doc(m) : one(m)));
}

export const syncTag = (x?: Loose) => x.replace(/^(v\d+)-(\d+)-(\d+)/, '$1.$2.$3');

export function actView(a?: Loose) {
  const ref = (a.refs || []).find((r?: Loose) => ticketMap().has(r));
  const t = ref ? tlink(ref) : '';
  const strip = (re?: Loose) => linkify(String(a.what || '').replace(re, ''));
  switch (a.class) {
    case 'add-ticket': return { head: `Added a ticket: ${t || linkify(a.what)}` };
    case 'replan-within-feature': {
      const fields = (String(a.what).match(/\(([^)]*)\)\s*$/)?.[1] || '').split(',').map((x?: Loose) => x.trim()).filter(Boolean);
      if (fields.length === 1 && fields[0] === 'held') return a.change?.held ? { head: `Put ${t} on hold`, detail: linkify(a.change.held) } : { head: `Took ${t} off hold` };
      return { head: `Changed ${t || 'a ticket'}: ${fields.map((f?: Loose) => wordsState.FIELD_WORDS[f] || f).join(', ') || 'its details'}` };
    }
    case 'worker-slots': {
      const rm = String(a.what).match(/^removed worktree \.worktrees\/(\S+?)(?: \(a worktree of \S+\))?: (.*)$/);
      if (rm) return { head: `Tidied away the finished checkout ${esc(rm[1])}`, detail: linkify(rm[2]) };
      const m = String(a.what).match(/^(made|resumed) (worker|planner) (\S+)/);
      if (m?.[2] === 'planner') return { head: `${m[1] === 'made' ? 'Started' : 'Restarted'} planning feature ${esc(m[3])}` };
      return { head: `${m?.[1] === 'resumed' ? 'Restarted the agent on' : 'Put an agent to work on'} ${t || linkify(a.what)}` };
    }
    case 'approve-spec': return { head: `Approved the spec for ${t}`, detail: strip(/^(approved?\s+)?(rescoped\s+)?spec at [0-9a-f]+[^:]*:?\s*/i) };
    case 'approve-plan': return { head: `Approved the build plan for ${t}`, detail: strip(/^plan at [0-9a-f]+:?\s*/i) };
    case 'approve-design-change': return { head: `Approved a change to how ${t || 'a ticket'} is built`, detail: linkify(a.what) };
    case 'merge-word': return { head: `Merged ${t || linkify(a.what)}` };
    case 'merge-chore': {
      const c = String(a.what).match(/merged chore-(\S+) at/)?.[1] || '';
      const head = c === 'log' ? 'Saved the decision log to the repo' : c.startsWith('devteam-sync-') ? `Upgraded devteam to ${esc(syncTag(c.slice(13)))}` : c.startsWith('retro-') ? `Saved the retro for ${esc(c.slice(6))}` : `Merged a housekeeping change (${esc(c)})`;
      return { head };
    }
    case 'approve-feature-plan': return { head: `Approved the plan for feature ${esc((a.refs || [])[0] || '')}` };
    case 'carry-answer': { const q = (a.refs || []).find((r?: Loose) => r.startsWith('q-')); const g = (a.refs || []).find((r?: Loose) => r.startsWith('g-')); const goal = (shell.DATA.ooda.goals || []).find((x?: Loose) => x.id === g); return { head: `Carried your earlier answer forward${q ? ` (${qlink(q)})` : ''}${goal ? ` to <a class="linkish" href="#goal/${encodeURIComponent(g)}">${esc(goal.title)}</a>` : ''}`, detail: linkify(String(a.what).replace(/^applied your earlier answer to \S+ /, '')) }; }
    case 'withdraw-question': { const m = String(a.what).match(/withdrew (q-\S+?):?\s+(.*)$/); return { head: `Withdrew a question: ${m ? qlink(m[1]) : linkify(a.what)}`, detail: m ? linkify(m[2]) : '' }; }
    case 'apply-default': { const id = (a.refs || [])[0]; return { head: `Went with the default for ${id ? qlink(id) : 'a question'}, unanswered in time`, detail: strip(/^applied the default to \S+:\s*/) }; }
    case 'upstream-pr': return { head: 'Proposed an improvement to devteam itself', detail: linkify(a.what) };
    case 'contract-ruling': return { head: 'Settled how two parts of the code talk to each other', detail: linkify(a.what) };
    case 'improvement-trial': return { head: 'Started a trial to improve how the team works', detail: linkify(a.what) };
    case 'release-staging': return { head: 'Staged a release', detail: linkify(a.what) };
    case 'goal-readiness': return { head: 'Marked a goal ready to plan', detail: linkify(a.what) };
    case 'recovery': return { head: `Recovered a stuck agent${t ? ` on ${t}` : ''}`, detail: linkify(a.what) };
    case 'new-feature': return { head: 'Started planning a feature you hadn’t asked for', detail: linkify(a.what) };
    case 'priority-change': return { head: 'Changed what gets worked on first', detail: linkify(a.what) };
    case 'release-scope': return { head: 'Moved work to a later release', detail: linkify(a.what) };
    default: return { head: esc(words(a.class)), detail: linkify(a.what) };
  }
}

export const norm = (x?: Loose) => String(x ?? '').trim().toLowerCase();

export function choicesOf(q?: Loose) {
  let list = (q.choices || []).length ? q.choices.map((c?: Loose) => ({ ...c })) : (q.options || []).map((label?: Loose) => ({ label }));
  if (q.kind === 'goal-approval') list = [
    { label: 'Approve', detail: 'The goal is approved, built the way the design describes.', then: 'Planning starts: the supervisor breaks it into features and tickets, taking your notes into account.' },
    { label: 'Refine', detail: 'Something in the approach should change. Say what in the notes.', then: 'The design is reworked with your notes and comes back here for approval.' },
    { label: 'Let go', detail: 'Drop this goal.', then: 'Nothing is planned or built for it; any planning stops.' },
  ];
  const doneCant = [{ label: 'Done', detail: 'I did it; carry on.' }, { label: 'Can’t right now', detail: 'Say why in the note, and what would help.' }];
  // an open owner-action: its answers are always Done and Can't right now; a recommendation (or the
  // question's own choices) is a line of text (oaSuggest), never a button that reads as doing the job
  if (isOa(q)) return doneCant.map((c?: Loose) => ({ ...c, rec: false }));
  if (q.kind === 'owner-action' && !list.length && !(q.secrets || []).length) list = doneCant;
  // a goal's approval takes only Approve, Refine or Let go (goal decide): a recommendation in other
  // words ("Yes") marks Approve rather than adding a choice the press can't send; only words that say
  // just yes do ("Yes, but refine the measure" marks nothing)
  const rec = q.kind === 'goal-approval' && /^(yes|approve[ds]?|go ahead)[\s.!]*$/i.test(String(q.recommendation ?? '').trim()) ? 'Approve' : q.recommendation;
  if (rec && !list.some((c?: Loose) => norm(c.label) === norm(rec)) && q.kind !== 'goal-approval') list.unshift({ label: rec });
  return list.map((c?: Loose) => ({ ...c, rec: !!rec && norm(c.label) === norm(rec) }));
}

export const goalSuggest = (q?: Loose, list?: Loose) => (q.kind === 'goal-approval' && String(q.recommendation ?? '').trim() && !list.some((c?: Loose) => c.rec) ? `<p class="meta" data-goal-suggest>Suggested: ${esc(q.recommendation)}</p>` : '');

export const isOa = (q?: Loose) => !!q && q.kind === 'owner-action' && !(q.secrets || []).length && q.status === 'open';

export function oaSuggest(q?: Loose) {
  const ways = (q.choices || []).length ? q.choices.map((c?: Loose) => c.label) : q.options || [];
  return (q.recommendation ? `<p class="meta" data-oa-suggest>Suggested: ${esc(q.recommendation)}</p>` : '')
    + (ways.length ? `<p class="meta" data-oa-ways>Ways to do it: ${ways.map(esc).join('; ')}</p>` : '');
}

export const OA_ID = /\b[kg]-\d{8}-\d{9}-[a-z0-9]+(?:-[a-z0-9]+)*/g;

export const oaRecords = (q?: Loose) => (isOa(q) ? [...new Set(String(q.context || '').match(OA_ID) || [])] : []);

export const oaConfirming = (id?: Loose) => (wordsState.OA_CONFIRM.get(id) || 0) > Date.now();

export function oaState(q?: Loose, id?: Loose) {
  const set = wordsState.OA_SET.get(id);
  if (id.startsWith('g-')) {
    const g = (shell.DATA?.ooda?.goals || []).find((x?: Loose) => x.id === id);
    if (!g) return { kind: 'goal', missing: true };
    if (set && g.status === set.status) wordsState.OA_SET.delete(id);
    const status = wordsState.OA_SET.has(id) ? set.status : g.status;
    return { kind: 'goal', words: g.title || id, href: `#goal/${encodeURIComponent(id)}`, done: status === 'abandoned' ? 'Done: let go' : status === 'met' ? 'Done: met' : null };
  }
  const k = (shell.DATA?.ooda?.knowledge || []).find((x?: Loose) => x.id === id);
  let r;
  if (k) {
    const u = [...(k.updates || [])].reverse().find((x?: Loose) => x.status);
    r = { status: k.status, at: u ? u.at : k.created_at, by: u ? u.by : k.created_by, words: k.plain || k.statement, owner: ownerLesson(k) };
  } else {
    wordsState.OA_PEEKS.add(id);
    const pk = peekOf('lesson', id);
    if (pk?.missing) return { kind: 'knowledge', missing: true };
    const rec = pk?.record;
    if (!rec && !set) return { kind: 'knowledge', loading: true };
    const f = rec?.fields || {};
    r = rec ? { status: f.status, at: rec.set_by?.status?.at ?? rec.created_at, by: rec.set_by?.status?.by ?? rec.created_by, words: f.plain || f.statement || id, owner: f.status === 'candidate' && f.for_owner === true } : { words: set.words || id };
  }
  if (set && r.status === set.status) wordsState.OA_SET.delete(id);
  // a status the owner set here counts at once; else the record's own, kept only when the owner set it after the ask
  const here = wordsState.OA_SET.has(id);
  const mine = here ? { status: set.status } : r;
  const kept = mine.status === 'accepted' && (here || (r.by === 'owner' && String(r.at || '') > String(q.asked_at || '')));
  return { kind: 'knowledge', words: r.words, href: `#lesson/${encodeURIComponent(id)}`, owner: r.owner, done: mine.status === 'retired' ? 'Done: retired' : kept ? 'Done: kept' : null };
}

export const oaOpen = (q?: Loose) => oaRecords(q).filter((id?: Loose) => { const s = oaState(q, id); return !s.missing && (!s.done || dataState.PRESSES.has(`${id.startsWith('g-') ? 'g' : 'k'}:${id}`)); });

// ui-candidate: oa-records (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function oaRows(q?: Loose, pre: Loose = '') {
  const marks = wordsState.NOT_DONE.get(q.id) || [];
  const rows = oaRecords(q).map((id?: Loose) => {
    const s = oaState(q, id);
    const qa = `data-oa-q="${esc(q.id)}"`;
    const ctl = s.done ? `<span class="badge good" data-oa-done>${esc(s.done)}</span>`
      : s.missing ? '<span class="muted small">no such record</span>'
      : s.loading ? '<span class="muted small">checking…</span>'
      : s.kind === 'goal' ? `<button class="ghost${oaConfirming(id) ? ' confirm' : ''}" data-oa-goal="${esc(id)}" ${qa}>${oaConfirming(id) ? 'Confirm let go' : 'Let go'}</button>`
      : `${s.owner ? `<button class="ghost" data-oa-know="${esc(id)}" data-status="accepted" ${qa}>Keep it</button>` : ''}<button class="ghost" data-oa-know="${esc(id)}" data-status="retired" ${qa}>Retire it</button>`;
    const what = s.href ? `<a class="linkish" href="${s.href}">${esc(s.words)}</a>` : `<code>${esc(id)}</code>`;
    return `<div class="oa-rec" data-oa-rec="${esc(id)}"><span class="oa-what"><b>${s.kind === 'goal' ? 'Goal' : 'Rule'}:</b> ${what}</span>${ctl}${!s.done && !s.missing && marks.includes(id) ? '<span class="err" data-oa-notdone>not done yet</span>' : ''}<span class="err" id="e-${pre}oa-${esc(q.id)}-${esc(id)}"></span></div>`;
  }).join('');
  return `<div class="oa-recs" data-oa-recs>${rows}</div>`;
}

export const oaAnyway = (q?: Loose) => (wordsState.NOT_DONE.has(q.id) && oaOpen(q).length
  ? '<p class="err" data-oa-anyway>Not done yet. Change them above, or pick Can’t right now and say in the note why you’re leaving them.</p>'
  : '<p data-oa-anyway hidden></p>');

export function oaPaint() {
  if (!shell.DATA) return;
  const m = focusMark();
  for (const card of document.querySelectorAll<HTMLElement>('[data-qcard]')) {
    const q = shell.DATA.questions.find((x?: Loose) => x.id === card.dataset.qcard);
    if (!isOa(q)) continue;
    const { pre } = qcardOf(card);
    const recs = card.querySelector('[data-oa-recs]');
    if (recs) recs.outerHTML = oaRows(q, pre);
    const any = card.querySelector('[data-oa-anyway]');
    if (any) any.outerHTML = oaAnyway(q);
  }
  focusBack(m);
}

export const oaSig = (q?: Loose) => (isOa(q) ? [oaRecords(q).map((id?: Loose) => { const s = oaState(q, id); return [id, s.done, !!s.missing, !!s.loading, oaConfirming(id), dataState.PRESSES.has(`${id.startsWith('g-') ? 'g' : 'k'}:${id}`)]; }), wordsState.NOT_DONE.get(q.id) ?? null] : null);

export function movedText(q?: Loose) {
  if (!q?.links_moved) return '';
  const pinned = (q.links || []).filter((l?: Loose) => l && l.artifact !== undefined && l.sha256);
  const changed = pinned.filter((l?: Loose) => l.changed).map((l?: Loose) => l.title || l.artifact);
  const gone = pinned.filter((l?: Loose) => l.gone).map((l?: Loose) => l.title || l.artifact);
  if (changed.length) return `${changed.join(', ')} changed since this was asked; the supervisor will ask again`;
  if (gone.length) return `${gone.join(', ')} is no longer available; the supervisor will ask again`;
  return String(q.links_moved);
}

export const movedOff = (q?: Loose) => { const m = movedText(q); return m ? ` disabled title="${esc(m)}"` : ''; };

export const sopsStore = (x?: Loose) => x.sink_type === 'sops' ? ` data-sops-store="${esc(String(x.sink).slice(5, String(x.sink).lastIndexOf(':')))}"` : '';

// ui-candidate: secrets (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function secretsForm(q?: Loose) {
  const posted = new Map((q.secrets_posted || []).map((p?: Loose) => [p.name, p]));
  return `<div class="secrets">${q.secrets.map((x?: Loose) => {
    const p = posted.get(x.name);
    const key = `${q.id}:${x.name}`;
    const where = x.sink_type === 'stdin' ? `<div class="sink-cmd">Runs as you, with the value on its input:<pre>${esc(x.sink.slice('stdin:'.length))}</pre></div>` : `<span class="muted small">goes to ${esc(x.to || x.sink)}</span>`;
    return `<div class="secret"><span class="sname"><code>${esc(x.name)}</code> ${x.sink_type === 'stdin' ? '' : where}</span>${x.sink_type === 'stdin' ? where : ''}${x.warning && !p ? `<span class="err small" role="note">${esc(x.warning)}</span>` : ''}${p ? '<span class="badge good">posted</span>' : x.kind === 'file' ? `<input type="file" data-secret="${esc(key)}"${sopsStore(x)} aria-label="${esc(x.name)}">` : `<textarea class="masked" rows="2" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true" data-form-type="other" data-secret="${esc(key)}"${sopsStore(x)} aria-label="${esc(x.name)}" placeholder="Paste the value (several lines are fine)"></textarea>`}</div>`;
  }).join('')}<p class="meta">devteam doesn’t save what you post or show it to an agent: it goes from this page through your own process to the place named, and the log records only the name. Check where each one goes before you post.</p></div>`;
}

export function keepSecretDrafts() {
  document.querySelectorAll('[data-secret]').forEach((el?: Loose) => {
    const v = el.type === 'file' ? el.files?.[0] : el.value;
    if (v) wordsState.SECRET_DRAFTS.set(el.dataset.secret, v); else wordsState.SECRET_DRAFTS.delete(el.dataset.secret);
  });
}

export function restoreSecretDrafts() {
  document.querySelectorAll('[data-secret]').forEach((el?: Loose) => {
    const v = wordsState.SECRET_DRAFTS.get(el.dataset.secret);
    if (!v) return;
    if (el.type === 'file') { try { const t = new DataTransfer(); t.items.add(v); el.files = t.files; } catch {} }
    else el.value = v;
  });
}

export const toB64 = async (file?: Loose) => { const bytes = new Uint8Array(await file.arrayBuffer()); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };

// ui-candidate: next-time (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export const nextTime = (q?: Loose, cls?: Loose, attr: Loose = 'data-auto', pre: Loose = '') => (cls ? `<fieldset class="next"><legend>Next time, for decisions like this (${esc(cls.about || words(q.class))}), the supervisor…</legend>${[1, 2, 3].filter((r?: Loose) => r <= cls.ceiling).map((r?: Loose) => `<label class="seg"><input type="radio" name="${pre}${attr === 'data-auto' ? '' : 'rv-'}auto-${esc(q.id)}" value="${r === cls.rung ? '' : r}" ${attr}="${esc(q.id)}" ${r === cls.rung ? 'checked' : ''}>${esc(wordsState.RUNG_WORDS[r])}${r === cls.rung ? ' <span class="muted">(now)</span>' : ''}</label>`).join('')}</fieldset>` : '');

export function rankWhy(q?: Loose) {
  const r = q.rank;
  if (!r) return '';
  const by = (r.parts.settled_by || []).map((id?: Loose) => `<span>may be settled by ${qlink(id)}</span>`).join('');
  if (r.top) return `<p class="top-why"><b>Next best step.</b>${r.chips.length ? ` ${esc(cap(r.chips.join('; ')))}.` : ''}</p>${by ? `<div class="why">${by}</div>` : ''}`;
  const chips = r.chips.slice(0, 3).map((c?: Loose) => `<span>${esc(c)}</span>`).join('') + by + (r.parts.rated ? '' : '<span class="muted" title="The supervisor has not rated this question, so it is ordered as a middling one.">not rated</span>');
  return chips ? `<div class="why">${chips}</div>` : '';
}

export const rankRow = (q?: Loose) => [
  ...(q.rank ? [['Order', esc(`${q.rank.position} of ${q.rank.of}. ${cap(q.rank.sum)}${q.rank.floor ? `. Above the ordinary questions: ${q.rank.floor}` : ''}`)]] : []),
  // every rating it has carried, so a question quietly rated down leaves a trail
  ...((q.rating_history || []).length ? [['Rated', q.rating_history.map((h?: Loose) => esc(`${h.asked ? 'When asked' : `${when(h.at)}, ${who(h.by)}`}: ${[h.stake ? `stake ${h.stake}` : '', h.urgency ? `urgency ${h.urgency}` : '', h.settles !== undefined ? `settles ${h.settles}` : ''].filter(Boolean).join(', ')}`)).join('<br>')]] : []),
];

export const nextChip = (q?: Loose) => (q.id === NEXT_ID() ? '<span class="chip-next">Next</span>' : '');

// ui-candidate: question-card (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function questionCard(q?: Loose, o?: Loose, reasonText?: Loose, copy: Loose = false) {
  if (q.kind === 'review') return reviewCard(q, o, reasonText);
  // copy: the same card in a thread (true, t-q-<id>) or a side peek ('peek', p-q-<id>): its own radio groups
  // and error line, so no copy answers for another; the controls find their card from themselves.
  const pre = copy === 'peek' ? 'p-' : copy ? 't-' : '';
  const cls = q.class && o.classes[q.class];
  const kindCls = q.kind === 'one-way-door' ? 'door' : q.kind === 'trust' ? 'trust' : '';
  const list = choicesOf(q);
  const name = `${pre}pick-${q.id}`;
  const sure = q.confidence != null ? ` · ${Math.round(q.confidence * 100)}% sure` : '';
  // the answer the supervisor said would settle other open questions: say which, on that choice
  const closes = (q.rank?.parts.settles || []).length ? `<div class="closes">Would close ${q.rank.parts.settles.length} other question${q.rank.parts.settles.length > 1 ? 's' : ''}: ${q.rank.parts.settles.map((id?: Loose) => qlink(id)).join('; ')}</div>` : '';
  // ui-candidate: choices (the choice list's markup; apps-src@2: src/shared/ui/ has no component yet)
  const choiceHtml = list.map((c?: Loose) => `
      <label class="choice${c.rec ? ' rec' : ''}${wordsState.picks[q.id] === c.label ? ' picked' : ''}">
        <input type="radio" name="${esc(name)}" value="${esc(c.label)}" data-pick="${esc(q.id)}" ${wordsState.picks[q.id] === c.label ? 'checked' : ''}>
        <span><b>${esc(c.label)}</b>${c.rec ? `<span class="tag">Recommended${sure}</span>` : ''}${c.detail ? `<div class="d">${qblock(c.detail, q.links)}</div>` : ''}${c.effect ? `<div class="e">${qblock(c.effect, q.links)}</div>` : ''}${c.then ? `<div class="d">${esc(c.then)}</div>` : ''}${c.approves === true && !c.rec && (q.kind === 'one-way-door' || q.class === 'one-way-door') ? '<div class="d approves">Picked with no note, this also approves the plan built on it: the supervisor replans to it and won\u2019t ask this again.</div>' : ''}${closes && c.label === q.settles_label ? closes : ''}</span>
      </label>`).join('') + (list.length && !['owner-action', 'goal-approval'].includes(q.kind) ? `
      <label class="choice${wordsState.picks[q.id] === '__other' ? ' picked' : ''}"><input type="radio" name="${esc(name)}" value="__other" data-pick="${esc(q.id)}" ${wordsState.picks[q.id] === '__other' ? 'checked' : ''}><span><b>Something else</b><div class="d">Write your own answer in the box below.</div></span></label>` : '');
  const why = q.why_asked?.reasons?.length ? `Why you: ${q.why_asked.reasons.map((r?: Loose) => esc(reasonText[r] || r)).join('; ')}.` : '';
  const next = nextTime(q, cls, 'data-auto', pre);
  const goalAsk = q.kind === 'goal-approval';
  const notePh = goalAsk ? 'Notes for the planner: taken into account whatever you choose (needed to refine)' : list.length ? 'Add a note (optional), or your own answer' : 'Your answer';
  // the note takes dropped files on a card whose button posts an answer (not a goal approval; a secrets card
  // keeps its own note, below)
  const note = `<textarea data-q="${esc(q.id)}" placeholder="${esc(notePh)}">${esc(shell.drafts[q.id] || '')}</textarea>`;
  const noteBox = goalAsk ? note : dropBox(`q:${q.id}`, note);
  return `
    <div class="card qcard ${kindCls}${q.rank?.top ? ' top' : ''}" id="${pre}q-${esc(q.id)}" data-qcard="${esc(q.id)}"${copy ? '' : subj('question', q.id, qplain(q.question, q.links))}>
      ${cardHead(wordsState.KIND_ICON[q.kind] || 'circle-help', `${copy ? '' : nextChip(q)}<span class="badge ${q.kind === 'one-way-door' ? 'high' : q.kind === 'trust' ? 'good' : q.kind === 'owner-action' ? 'low' : 'medium'}">${esc(wordsState.KIND_WORDS[q.kind] || words(q.kind))}</span>${q.goal_hold === 'park' ? '<span class="badge">its goal is parked</span>' : ''}`, { extra: (q.blocks || []).length ? `${q.class === 'incident-fix' ? 'about the incident' : 'holds up'} ${q.blocks.map((b?: Loose) => (/^p-/.test(b) ? linkify(b) : tlink(b))).join(', ')}` : q.ticket ? `about ${tlink(q.ticket)}` : '', id: q.id, rows: [['Asked', esc(when(q.asked_at))], ...(q.class ? [['Kind', esc(q.class)]] : []), ...rankRow(q)] })}
      ${movedText(q) ? `<p class="moved" data-links-moved><i class="icon-triangle-alert" aria-hidden="true"></i> ${esc(movedText(q))}</p>` : ''}
      ${rankWhy(q)}
      ${q.thread && copy !== true ? `<div class="meta from-thread">From a thread: <a class="linkish" href="#talk/${encodeURIComponent(q.thread)}">${esc(q.thread_title || 'a conversation with the supervisor')}</a></div>` : ''}
      ${q.rewritten ? '<p class="rewritten">This question changed after you answered it, so that answer no longer counts. Read it again before you answer: the supervisor\'s log was rewritten, which it should never do.</p>' : ''}
      ${q.new_because ? `<p class="again"><b>Asked again because:</b> ${esc(q.new_because)}</p>` : ''}
      <h4>${qinline(q.question, q.links)}</h4>
      ${q.context ? `<div class="ctx">${qblock(q.context, q.links)}</div>` : ''}
      ${q.no_default ? `<div class="meta"><b>No default, because:</b> ${esc(q.no_default)}</div>` : ''}
      ${(q.links || []).length ? `<div class="links"><span class="muted small">Look at:</span>${q.links.map(linkOf).join('')}</div>` : ''}
      ${(q.approves || []).length ? `<div class="meta">Your answer approves each of these, once: ${q.approves.map((a?: Loose) => !/^(chore|plan)-/.test(a) ? tlink(a) : `<code>${esc(a)}</code>`).join(', ')}</div>` : ''}
      ${q.change ? `<div class="meta">Approving sets on <a class="linkish" href="#goal/${encodeURIComponent(q.goal)}">${esc((shell.DATA.ooda.goals.find((g?: Loose) => g.id === q.goal) || {}).title || q.goal)}</a>:<ul>${Object.entries(q.change).map(([k, v]: Loose) => `<li><b>${esc(words(k))}</b>: ${Array.isArray(v) && v.length && typeof v[0] === 'object' ? `<ol>${v.map((m?: Loose) => `<li>${esc(m.title || JSON.stringify(m))}${m.target != null ? ` → ${esc(m.target)}` : ''}</li>`).join('')}</ol>` : esc(typeof v === 'object' ? JSON.stringify(v) : v)}</li>`).join('')}</ul></div>` : ''}
      ${goalAsk ? (() => { const settled = (shell.DATA.ooda.answered || []).filter((a?: Loose) => a.goal === q.goal && a.kind !== 'goal-approval' && a.status === 'answered'); return settled.length ? `<div class="meta">Rests on your answers to: ${settled.map((a?: Loose) => `${qlink(a.id, a.question)} (<b>${esc(a.answer)}</b>)`).join('; ')}</div>` : ''; })() : ''}
      ${isOa(q) ? oaSuggest(q) + oaRows(q, pre) : ''}
      ${(q.secrets || []).length ? `${secretsForm(q)}
      <textarea data-q="${esc(q.id)}" placeholder="Add a note (optional)">${esc(shell.drafts[q.id] || '')}</textarea>` : `${goalSuggest(q, list)}${list.length ? `<div class="choices" role="radiogroup" aria-label="Choices">${choiceHtml}</div>` : ''}
      ${noteBox}`}
      ${goalAsk || ['owner-action', 'goal-definition'].includes(q.kind) ? '' : `<label class="rulebox"><input type="checkbox" data-rulebox="${esc(q.id)}"> Keep this answer as a standing rule for ${esc(scopeWords(q.rule_scope))}</label>`}
      ${next}
      ${q.default ? `<p class="meta">If you don’t answer${q.deadline ? ` by ${when(q.deadline)}` : ''}, the supervisor goes with: <b>${esc(q.default)}</b></p>` : ''}
      ${attachmentsState.REFUSED.has(q.id) ? `<p class="err refused" data-refused="${esc(q.id)}"><span>Not saved: ${esc(attachmentsState.REFUSED.get(q.id).reason)}</span><button class="ghost" data-dismiss-refused="${esc(q.id)}">Dismiss</button></p>` : ''}
      ${isOa(q) ? oaAnyway(q) : ''}
      <div class="row-inline">${(q.secrets || []).length ? `<button data-post-secrets="${esc(q.id)}">Post</button>${q.sensor ? `<button class="ghost" data-dontuse="${esc(q.id)}">Don’t use this sensor</button>` : `<button class="ghost" data-reply="${esc(q.id)}">Reply</button><button class="ghost" data-cant="${esc(q.id)}">Can’t right now</button>`}` : `<button data-answer="${esc(q.id)}" ${goalAsk ? `data-goal-ask="${esc(q.goal)}"` : ''}${movedOff(q)}>${q.kind === 'owner-action' || goalAsk ? 'Send' : 'Answer'}</button>`}<span class="err" id="e-${pre}${esc(q.id)}"></span></div>
      ${why ? `<div class="meta">${why}</div>` : ''}
    </div>`;
}

// ui-candidate: menu (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export const menuOf = (id?: Loose, rows: Loose = [], open: Loose = null, extra: Loose = '') => `<details class="menu"><summary aria-label="Details"><i class="icon-ellipsis" aria-hidden="true"></i></summary><div class="pop"><div class="kv">${id ? `<span>ID</span><code>${esc(id)}</code>` : ''}${rows.map(([k, v]: Loose) => `<span>${esc(k)}</span><span>${v}</span>`).join('')}</div>${id ? `<button class="ghost" data-copy="${esc(id)}">Copy ID</button>` : ''}${open ? `<button type="button" class="ghost" data-menu-open="${esc(open)}">Open in side peek</button>` : ''}${extra}</div></details>`;

export const cardMenu = (kind?: Loose, id?: Loose, rows: Loose = []) => menuOf(id, rows, `${kind}/${id}`);

export const titled = (href?: Loose, html?: Loose) => String(html).split(/(<a\b[^>]*>[\s\S]*?<\/a>)/).map((x?: Loose, i?: Loose) => (i % 2 || !x.trim() ? x : `<a class="title-link" href="${esc(href)}">${x}</a>`)).join('');

// ui-candidate: card-head (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function cardHead(icon?: Loose, label?: Loose, { extra = '', id = null, rows = [], open = null, lead = '', menuExtra = '' }: Loose = {}) {
  const menu = id || rows.length || open || menuExtra ? menuOf(id, rows, open, menuExtra) : '';
  return `<div class="card-head">${lead}<i class="icon-${icon}" aria-hidden="true"></i>${label}<span class="grow">${extra}</span>${menu}</div>`;
}

export const fileHref = (l?: Loose) => (!l.repo && repoDocHref(l.path, l.ref)) || `#file?${new URLSearchParams({ path: l.path, ...(l.ref ? { ref: l.ref } : {}), ...(l.repo ? { repo: l.repo } : {}), title: l.title || l.path })}`;

export function repoDocHref(path?: Loose, ref?: Loose) {
  if (typeof path !== 'string') return null;
  const segs = path.split('/');
  if (segs[0] === '..') segs.shift();
  const [dir, ...rest] = segs;
  if (!dir || !rest.length || rest.some((s?: Loose) => !s || s === '.' || s === '..')) return null;
  const name = (r?: Loose) => String(r ?? '').replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop()!.toLowerCase();
  const link = (shell.DATA?.library?.links || []).find((x?: Loose) => x?.kind === 'repo' && (String(x.id).toLowerCase() === dir.toLowerCase() || (x.remote && name(x.remote) === dir.toLowerCase())));
  if (!link) return null;
  if (ref != null && (typeof ref !== 'string' || ref.split('/').some((s?: Loose) => !s || s === '.' || s === '..'))) return null;
  const tid = /^ticket\/(.+)$/.exec(ref ?? '')?.[1];
  const t = tid ? ticketMap().get(tid) : null;
  const at = t?.merge_sha && t.repo === link.id ? t.merge_sha : ref || null;
  const remote = String(link.remote ?? '').trim();
  const gh = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(remote) ? remote.replace(/\.git$/, '').split('/')
    : (/^(?:https?:\/\/|ssh:\/\/(?:[^@/\s]+@)?|[^@/\s]+@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(remote) || []).slice(1);
  const inner = rest.join('/');
  if (gh.length === 2) return `https://github.com/${gh.map(encodeURIComponent).join('/')}/blob/${at ? at.split('/').map(encodeURIComponent).join('/') : 'HEAD'}/${rest.map(encodeURIComponent).join('/')}`;
  return `#file?${new URLSearchParams({ path: inner, ...(at ? { ref: at } : {}), repo: link.id, title: inner })}`;
}

export const artHref = (slug?: Loose, at?: Loose) => `#artifact/${at === 'main' ? 'main' : `wt/${encodeURIComponent(at)}`}/${encodeURIComponent(slug)}`;

export const AV_CHANGED = 'Changed since this question was asked';

export const artLinkOf = (l?: Loose, inline: Loose = false) => {
  const href = l.href ?? (l.gone || !l.at ? null : artHref(l.artifact, l.at));
  if (!href) return `<span>${esc(l.title)} <span class="muted">(no longer available)</span></span>`;
  return `<a href="${esc(href)}" data-av-note="${l.changed ? AV_CHANGED : ''}"${l.changed ? ` title="${AV_CHANGED}"` : ''}>${esc(l.title)}</a>${l.changed && !inline ? ' <span class="badge high">changed since asked</span>' : ''}`;
};

export const linkOf = (l?: Loose) => (l.preview ? previewLinkHtml(l, previewHere(location, shell.PREVIEWS), esc) : l.artifact ? artLinkOf(l) : l.url ? `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a>` : l.path ? ((h?: Loose) => (/^https:/.test(h) ? `<a href="${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a>` : `<a href="${esc(h)}">${esc(l.title)}</a>`))(fileHref(l)) : `<span>${esc(l.title)}${l.remote ? ` <span class="muted">(${esc(l.remote)})</span>` : ''}</span>`);

export const NAME_REF = /\[\[([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\]\]/;

export function artNameLink(l?: Loose) {
  const h = l.href ?? (l.gone || !l.at ? null : artHref(l.artifact, l.at));
  const m = h && /^#artifact\/(?:main|wt\/([^/]+))\/([^/]+)$/.exec(h);
  if (!m) return artLinkOf(l, true);
  let v;
  try { v = artViewer(decodeURIComponent(m[2]), m[1] ? decodeURIComponent(m[1]) : 'main'); } catch { return artLinkOf(l, true); }
  return `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer"${l.changed ? ` title="${AV_CHANGED}"` : ''}>${esc(l.title)}</a>`;
}

export const pvNameLink = (l?: Loose) => (l.state === 'gone' ? previewLinkHtml(l, previewHere(location, shell.PREVIEWS), esc) : `<a href="${esc(pvViewer(l.preview))}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a>`);

// qtext, qinline and qblock, verbatim, over the links they are given: the module's own below, a test's with its stubs
export function wordsText({ linkify, linkOf, artNameLink, pvNameLink }: { linkify: Fn; linkOf: Fn; artNameLink: Fn; pvNameLink: Fn }) {
  function qtext(text?: Loose, links?: Loose) {
    return String(text ?? '').split(new RegExp(NAME_REF.source, 'g')).map((part?: Loose, i?: Loose) => {
      if (i % 2 === 0) return linkify(part);
      const l = (links || []).find((x?: Loose) => x.name === part);
      // in the sentence the link alone; a changed artifact is flagged in the list below
      return l ? `<span class="qref">${l.artifact ? artNameLink(l) : l.preview ? pvNameLink(l) : linkOf(l)}</span>` : esc(`[[${part}]]`);
    }).join('');
  }
  function qinline(text?: Loose, links?: Loose): string {
    return String(text ?? '').split(/(`[^`\n]+`|(?<![\w*])\*\*(?=\S)[^*\n]+?(?<=\S)\*\*(?![\w*]))/).map((seg?: Loose, i?: Loose) => (i % 2 === 0 ? qtext(seg, links) : seg[0] === '`' ? `<code>${qtext(seg.slice(1, -1), links)}</code>` : `<b>${qinline(seg.slice(2, -2), links)}</b>`)).join('');
  }
  function qblock(text?: Loose, links?: Loose) {
    const out = [];
    let para: Loose[] = [], list: Loose = null;
    const flushPara = () => { if (para.length) out.push(`<p>${para.map((l?: Loose) => qinline(l, links)).join('<br>')}</p>`); para = []; };
    // a list that starts at 3 says 3: the owner may be told "do step 3"
    const flushList = () => { if (list) out.push(`<${list.tag}${list.start > 1 ? ` start="${list.start}"` : ''}>${list.items.map((i?: Loose) => `<li>${qinline(i, links)}</li>`).join('')}</${list.tag}>`); list = null; };
    const item = (tag?: Loose, t?: Loose, n: Loose = 1) => { flushPara(); if (list?.tag !== tag) flushList(); list = list ?? { tag, items: [], start: n }; list.items.push(t); };
    const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
    for (let k = 0; k < lines.length; k++) {
      const raw = lines[k], line = raw.trim();
      let m;
      if (!line) { flushPara(); flushList(); continue; }
      if ((m = line.match(/^[-*•]\s+(.*)$/))) { item('ul', m[1]); continue; }
      if ((m = line.match(NUMBERED))) {
        // one line holding the whole list ("1) a 2) b") is split; a line of a list written one per
        // line is one item, whatever numbers its own words hold
        const alone = list?.tag !== 'ol' && !NUMBERED.test((lines[k + 1] ?? '').trim());
        const il = alone ? inlineList(line) : null;
        if (il && !il.lead) for (const t of il.items) item('ol', t); else item('ol', m[2], Number(m[1]));
        continue;
      }
      if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += ` ${line}`; continue; }
      flushList();
      const il = inlineList(line);
      if (il) { if (il.lead) para.push(il.lead); flushPara(); out.push(`<ol>${il.items.map((i?: Loose) => `<li>${qinline(i, links)}</li>`).join('')}</ol>`); continue; }
      para.push(line);
    }
    flushPara(); flushList();
    return out.join('');
  }
  return { qtext, qinline, qblock };
}

export const { qtext, qinline, qblock } = wordsText({ linkify, linkOf, artNameLink, pvNameLink });

export function inlineList(line?: Loose) {
  const ms = [...line.matchAll(/(^|[\s:])(\()?(\d{1,2})([.)])\s+/g)];
  let run = [];
  for (const m of ms) {
    const n = Number(m[3]);
    const before = line.slice(0, m.index + m[1].length);
    if (m[4] === ')' && !m[2] && before.split('(').length > before.split(')').length) continue;
    if (n === 1) run = m[4] === ')' || !before.trim() || before.trimEnd().endsWith(':') ? [m] : [];
    else if (run.length && n === run.length + 1 && m[4] === run[0][4] && !m[2] === !run[0][2]) run.push(m);
  }
  if (run.length < 2) return null;
  const at = (m?: Loose) => m.index + m[1].length;
  const items = run.map((m?: Loose, i?: Loose) => line.slice(m.index + m[0].length, i + 1 < run.length ? at(run[i + 1]) : undefined).trim().replace(/[;,]\s*(and|or)?$/i, '').trim());
  return { lead: line.slice(0, at(run[0])).trim(), items };
}

export const NUMBERED = /^\(?(\d{1,2})[.)]\s+(.*)$/;

export const qplain = (text?: Loose, links?: Loose) => String(text ?? '').replace(new RegExp(NAME_REF.source, 'g'), (all?: Loose, n?: Loose) => (links || []).find((x?: Loose) => x.name === n)?.title ?? all);

// ui-candidate: answered-card (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function answeredCard(q?: Loose, { inPeek = false }: Loose = {}) {
  // who answered, when one of the box's people did (kit-252): how is escaped where it is drawn
  const how = q.status === 'defaulted' ? 'went with the default; you didn’t answer in time' : q.status === 'withdrawn' ? 'withdrawn by the supervisor' : `${q.answered_person ? `${q.answered_person.name} answered` : 'answered'} ${wordsState.CHANNEL_WORDS[q.channel] || ''}`;
  return `<div class="card small"${inPeek ? '' : ` id="a-${esc(q.id)}"`}${subj('question', q.id, qplain(q.question, q.links))}>
    <div>${qlink(q.id, q.question)}</div>
    ${q.answer && !isFilled(q.answer, q.files) ? `<div><b>${esc(q.answer)}</b></div>` : ''}
    ${chipsHtml(q.files ?? [])}
    ${q.said ? `<div class="muted">You said: “${esc(q.said)}”</div>` : ''}
    ${q.autonomy ? `<div class="muted">From then on, for ${esc(words(q.autonomy.class))}: the supervisor ${esc(wordsState.RUNG_WORDS[q.autonomy.rung])}.</div>` : ''}
    ${q.standing_rule ? `<div class="muted">Standing rule: ${esc(q.standing_rule)}</div>` : ''}
    ${q.kind === 'review' ? `<div class="meta"><a class="linkish" href="#review/${encodeURIComponent(q.id)}">See the review as you answered it</a>${q.result_status && !['verified', 'declined'].includes(q.result_status) ? ` <span class="badge high">${esc(q.result_status)}</span>` : ''}</div>` : ''}
    <div class="meta${q.channel === 'thread' && q.turn_thread ? ' from-thread' : ''}">${esc(how)}${q.channel === 'thread' && q.turn_thread ? `: <a class="linkish" href="#talk/${encodeURIComponent(q.turn_thread)}">${esc(q.turn_thread_title || 'a conversation with the supervisor')}</a>` : ''}${q.answered_at ? ` · ${when(q.answered_at)}` : ''}</div>
    ${q.status === 'defaulted' && !inPeek ? `<div class="row-inline"><input type="text" data-overrule="${esc(q.id)}" placeholder="Your answer instead"><button class="ghost" data-overrule-send="${esc(q.id)}">Overrule</button><span class="err" id="e-${esc(q.id)}"></span></div>` : ''}
  </div>`;
}
