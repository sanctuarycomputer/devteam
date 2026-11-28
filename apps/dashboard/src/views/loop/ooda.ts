// kit-996: the Loop's draw (index.html's loop lines): renderOoda, which draws its four tabs, and the Decide tab's
// words (matchedWords, decisionUnder, decideRows, renderDecisions).
// `Loose` is `any`: the page's data has no fixed shape in index.html.
import { renderGoals } from '../goals';
import { esc } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { authorityWords, words } from '../words';
import { wordsState } from '../words/state';
import { loopDraw, mayCorrect } from './tables';
type Loose = any;

export function renderOoda(o: Loose) {
  // Retro and roadmap
  const R = o.roadmap;
  const week = (d: Loose) => { if (!d) return 'no date'; const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return `week of ${x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}`; };
  $('unassigned')!.innerHTML = o.goals.length || R.unassigned.length ? `${R.unassigned.length ? `No goal: ${R.unassigned.map(esc).join(', ')} · ` : ''}${R.rate_points_per_day} pts/day` : '';
  const roadmapOf = (gid: Loose) => {
    const r = R.goals.find((x: Loose) => x.id === gid);
    if (!r) return '';
    const feats = r.features.map((f: Loose) => R.features[f]);
    return `<div class="small"><b>Roadmap</b> <span class="muted">→ ${r.eta === 'done' ? 'done' : r.eta ? esc(week(r.eta)) : 'ETA –'}</span>
      ${r.unplanned.map((u: Loose) => `<div>• <span class="badge medium">unplanned</span>precondition ${u.n}: ${esc(u.text)}</div>`).join('')}
      ${feats.map((v: Loose) => `<div>• <b>${esc(v.feature)}</b> <span class="muted">${esc(v.status)}</span> · ${v.points_total - v.points_left}/${v.points_total} pts · stories ${v.stories.done}/${v.stories.total} · ${v.waves_left} waves left${v.releases.length ? ` · ${v.releases.map(esc).join(' ')}` : ''} → ${v.done ? 'done' : esc(week(v.eta))}${v.blocked_by_questions.length ? ` <span class="badge high">waiting on ${v.blocked_by_questions.length} answer${v.blocked_by_questions.length > 1 ? 's' : ''}</span>` : ''}</div>`).join('')}
</div>`;
  };

  // Goals: where each stands, how the work and the measure are trending, what it waits on
  renderGoals();

  /* ooda-learning start */
  // The learning charts are Awareness's (learningSection): Self Improvement keeps its tables only

  /* ooda-learning end */
  /* ooda-observe start */
  // Observe: its table (loop-tables)
  loopDraw('observe', o);

  /* ooda-observe end */
  /* ooda-orient start */
  // Orient: its Knowledge table (loop-tables), filtered by the header's Kind and Needs orienting
  loopDraw('orient', o);

  /* ooda-orient end */
  /* ooda-trust start */
  // Trust is its own page now (kit-93): renderTrust draws it from render, so the loop draws nothing here

  /* ooda-trust end */
  /* ooda-decide start */
  // Decide: every call, the supervisor's and yours
  renderDecisions(o);

  /* ooda-decide end */
  /* ooda-act start */
  // Act: its table (loop-tables)
  loopDraw('act', o);
}
  /* ooda-act end */
// A Decide row's Kind when its record has no kind of decision (class_name): the record's own kind, in words
export const DEC_KIND = { decision: 'decision', act: 'act', answer: 'answer', goal: 'goal call', rule: 'standing rule', correction: 'correction' };
// The question's Matched row in words (kit-313): the owner's own pick, the supervisor's reading of
// their words, or words not yet read; a reading matches, but it is not the owner's agreement
export function matchedWords(q: Loose) {
  if (q.matched == null) return '';
  if (q.read_by) return `${q.matched ? 'yes' : 'no'}: the supervisor read your words as “${esc(q.label)}”; not counted as your agreement`;
  if (q.in_words) return 'not yet: you answered in your own words, which the supervisor reads';
  return q.matched ? 'yes: you went with its recommendation' : 'no: you chose otherwise';
}
export function decisionUnder(r: Loose) {
  if (r.who === 'supervisor' && ['decision', 'act'].includes(r.kind)) return authorityWords(r.under);
  const u = r.under || {};
  // in the owner's own words (kit-313): the supervisor's reading, or none yet, never "went with" it
  const aq = r.kind === 'answer' ? ((shell.DATA as Loose).questions || []).find((x: Loose) => x.id === r.id) : null;
  if (r.kind === 'answer') return [aq?.read_by ? `in your own words, read by the supervisor as “${esc(aq.label)}”` : aq?.in_words ? 'in your own words, not yet read' : '', !aq?.in_words && u.recommendation ? (u.matched ? 'went with its recommendation' : `its recommendation was “${esc(u.recommendation)}”`) : '', u.autonomy ? `moved ${esc(words(u.autonomy.class))} to ${esc((wordsState.RUNG_WORDS as Loose)[u.autonomy.rung])}` : '', u.standing_rule ? `and gave a standing rule: “${esc(u.standing_rule)}”` : '', u.channel === 'chat' ? 'said in the supervisor chat' : u.channel === 'thread' ? 'said in a thread' : ''].filter(Boolean).join(' · ');
  if (r.kind === 'correction') return [u.severity != null ? `severity ${esc(u.severity)}` : '', u.repaired ? `repaired: ${esc(u.repaired)}` : 'not repaired yet'].filter(Boolean).join(' · ');
  if (r.kind === 'rule') return u.status === 'accepted' ? '' : esc(u.status);
  return '';
}
// A routine act (a merge the gates passed, a worker started, a default applied) is its own call under
// the constitution; it is in the Act tab, and here only on request, so judgment calls stay in view.
export const routine = (r: Loose) => r.kind === 'act' && r.under?.authority === 'constitution';
// The Decide tab draws at most this many rows; with its filters as they start (no routine acts, any
// writer, any class), the rows it draws are decideRows(o): a call has its Correct only there.
export const DECIDE_SHOWN = 80;
// the calls that have a Correct (on Decide, on Act and in their peeks): the supervisor's own, not yet corrected
export const decideRows = (o: Loose) => (o?.decisions || []).filter(mayCorrect);
// A decision that is complete in itself: a noise ruling explains a signal, and no act carries it out.
export const NO_ACT_CLASSES = ['orient-noise'];
export function renderDecisions(o: Loose) {
  // Decide: every call the data gives but routine acts (Include routine acts shows them), as a table (loop-tables)
  loopDraw('decide', o);
}
