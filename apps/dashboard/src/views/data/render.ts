// kit-989: data's draw (index.html:9597-9713): every view's part of the page drawn from one /api/data read.
import { ownerLesson } from '../../lib/data-inbox';
import { later } from '../../lib/data-later';
import { attachmentsState } from '../attachments/state';
import { loadGovernance, navCounts, renderAwareness, renderEfficiency, renderGovernance, renderMonitoring, renderTrust, retroCards } from '../autonomy';
import { drawFilters, renderBoard, renderProgress } from '../board';
import { drawFleet } from '../goals';
import { goalsState } from '../goals/state';
import { renderLibrary } from '../library';
import { renderOoda } from '../loop';
import { loopState } from '../loop/state';
import { renderOverview } from '../overview';
import { fetchPeek, focusBack, focusMark, peekKey, refreshDrawer } from '../peeks';
import { peeksState } from '../peeks/state';
import { drawSettings, loadFleet, renderJobs } from '../settings';
import { empty, esc, subj, viewOnly } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { tlOwn as layerField } from '../threads-panel';
import { threadsPanelState } from '../threads-panel/state';
import { answeredCard, cap, cardHead, keepSecretDrafts, linkify, questionCard, restoreSecretDrafts, scopeWords, when, who } from '../words';
import { wordsState } from '../words/state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A5). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


export function render(d: Loose) {
  shell.DATA = d;
  const focus = focusMark();
  $('title')!.textContent = d.project && !String(d.project).startsWith('<') ? String(d.project) : 'devteam';
  const kit = $('kit'), local = /\+local$/.test(d.kit ?? '');
  kit!.hidden = !d.kit;
  kit!.textContent = d.kit ?? '';
  kit!.classList.toggle('local', local);
  kit!.title = d.kit ? `devteam ${d.kit}${local ? ': this checkout\'s kit differs from the one on main' : ''}` : '';
  $('when')!.textContent = `updated ${new Date(d.generated_at).toLocaleTimeString()}`;
  const o = d.ooda;
  $('logline')!.textContent = `log ${o.log.lines} lines${o.log.errors || o.log.ignored ? ` · ${o.log.errors} invalid · ${o.log.ignored} ignored` : ''}${o.log.unknown ? ` · ${o.log.unknown} written by a newer kit: upgrade this instance` : ''}`;
  // A worker is active until its ticket merges, as the kit counts slots (activeWorker): a worker
  // that never logged done (it stopped at awaiting-word or final-review) isn't working any more.
  const active = d.tickets.filter((t: Loose) => t.phase && !['done', 'parked'].includes(t.phase) && !['merged', 'released'].includes(t.stage)).length;
  const count = (id: Loose, n: Loose, hot: Loose = false) => { const el = $(id); el!.textContent = n || ''; el!.classList.toggle('hot', hot && n > 0); };
  count('n-goals', o.goals.length);
  count('n-active', active);
  {
    const rt = (shell.DATA as Loose).ooda.retro || {};
    const all = rt.all || [];
    count('n-retros', all.length);
    if (rt.due) { $('n-retros')!.textContent = 'due'; $('n-retros')!.classList.add('hot'); }
    const rEl = $('retros'), rHtml = retroCards(rt);
    if (rEl && (rEl as Loose).__html !== rHtml) { (rEl as Loose).__html = rHtml; rEl.innerHTML = rHtml; }
  }
  renderLibrary(d.library);
  count('n-knowledge', o.knowledge.filter(ownerLesson).length);
  // Self Improvement's tab counts are the rows each table draws (loopDraw sets each again, the same count): Orient's
  // its rows under the header's filter, as its table and card head count them
  $('n-orient')!.textContent = (loopState.LOOP_ROWS!.orient(o).length || '' as Loose);
  navCounts(d);
  renderOverview();

  // Keep anything half-typed or half-open across refreshes.
  document.querySelectorAll('textarea[data-q]').forEach((t: Loose) => { if (!layerField(t)) shell.drafts[t.dataset.q] = t.value; });
  document.querySelectorAll('textarea[data-know-note]').forEach((t: Loose) => { shell.drafts[`know:${t.dataset.knowNote}`] = t.value; });
  keepSecretDrafts();
  const kept = [...document.querySelectorAll('input[data-reason], input[data-overrule]')].filter((el: Loose) => !layerField(el)).map((el: Loose) => [el.dataset.reason ? `input[data-reason="${el.dataset.reason}"]` : `input[data-overrule="${el.dataset.overrule}"]`, el.value]);
  const keptChecks = [...document.querySelectorAll('input[data-rulebox]:checked, input[data-auto]:checked')].filter((el: Loose) => !layerField(el) && !el.closest('#drawer')).map((el: Loose) => el.dataset.rulebox ? `input[data-rulebox="${el.dataset.rulebox}"]` : `input[data-auto="${el.dataset.auto}"][value="${el.value}"]`);
  const openForms = [...document.querySelectorAll('[data-correct-form]')].filter((f: Loose) => !f.hidden).map((f: Loose) => f.dataset.correctForm);
  const reasonText = Object.fromEntries((o.reasons || []).map((r: Loose) => [r.id, r.means]));
  // only the lessons the supervisor sent you: the rest are about how the agents work, and its own to keep
  const cands = o.knowledge.filter(ownerLesson);
  const goalCards = cands.map((k: Loose) => `
    <div class="card qcard trust"${subj('lesson', k.id, k.plain || k.statement)}>
      ${cardHead('lightbulb', '<span class="badge good">Lesson to keep?</span>', { extra: `applies to ${esc(scopeWords(k.scope))}`, id: k.id, rows: [['Proposed', esc(when(k.created_at))], ['By', esc(who(k.created_by))]] })}
      <h4 data-plain>${k.plain ? esc(k.plain) : linkify(k.statement)}</h4>
      ${k.plain ? `<details data-technical><summary>The technical wording</summary><p>${linkify(k.statement)}</p></details>` : ''}
      <p class="ctx">${esc(cap(who(k.created_by)))} proposes this as a ${esc(k.kind)}${k.confidence != null ? `, ${Math.round(k.confidence * 100)}% sure` : ''}, ${(k.evidence || []).length ? `based on ${k.evidence.map((e: Loose) => linkify(e)).join(', ')}` : 'with no evidence recorded'}. Kept, it goes into the instructions of every agent it applies to.</p>
      <textarea data-know-note="${esc(k.id)}" rows="1" maxlength="600" placeholder="Add a note to refine it (optional): it goes with the lesson into every prompt">${esc(shell.drafts[`know:${k.id}`] || '')}</textarea>
      <div class="row-inline"><button data-know="${esc(k.id)}" data-status="accepted">Keep it</button><button class="ghost" data-know="${esc(k.id)}" data-status="retired">Retire it</button><span class="err" id="e-${esc(k.id)}"></span></div>
    </div>`).join('');
  // kept while a thread's copy still says open: a read of the threads begun before the answer can land after this
  for (const qid of [...attachmentsState.ANSWERED.keys()]) if (!(d as Loose).questions.some((q: Loose) => q.id === qid) && !(threadsPanelState as Loose).TL.threads.some((t: Loose) => t.questions?.some((q: Loose) => q.id === qid && q.status === 'open'))) (attachmentsState as Loose).ANSWERED.delete(qid);
  // a refusal goes with its question: once it is open in neither the Inbox nor a thread
  (wordsState as Loose).OA_PEEKS.clear();
  for (const qid of [...(wordsState as Loose).NOT_DONE.keys()]) if (!(d as Loose).questions.some((q: Loose) => q.id === qid)) (wordsState as Loose).NOT_DONE.delete(qid);
  for (const qid of [...(attachmentsState as Loose).REFUSED.keys()]) if (!(d as Loose).questions.some((q: Loose) => q.id === qid) && !(threadsPanelState as Loose).TL.threads.some((t: Loose) => t.questions?.some((q: Loose) => q.id === qid && q.status === 'open'))) (attachmentsState as Loose).REFUSED.delete(qid);
  d = { ...(d as Loose), questions: (d as Loose).questions.filter((q: Loose) => !attachmentsState.ANSWERED.has(q.id)) };
  // questions first, in the kit's order (the first is the next best step); lessons to keep after them
  ($ as Loose)('questions').innerHTML = (d.questions.length ? d.questions.map((q: Loose) => questionCard(q, o, reasonText)).join('') : (cands as Loose).length ? '' : (empty as Loose)('None')) + goalCards;
  ($ as Loose)('answered-sum').textContent = `Answered (${(o as Loose).answered.length})`;
  ($ as Loose)('answered').innerHTML = (o as Loose).answered.length ? (o as Loose).answered.map((q: Loose) => answeredCard(q)).join('') : (empty as Loose)('None');

  (renderOoda as Loose)(o);
  (renderMonitoring as Loose)(d);
  (renderJobs as Loose)();
  // readiness is costly (git, gh, harness logs): asked for only while the fleet is held, or on Settings
  (drawFleet as Loose)();
  (drawSettings as Loose)();
  if ((d.fleet?.mode || d.fleet?.op) && Date.now() - (goalsState as Loose).FLEET.at > ((goalsState as Loose).FLEET.data && (goalsState as Loose).FLEET.data.ready ? 600000 : 120000)) later(loadFleet);
  for (const id of (openForms as Loose)) { const f = (document as Loose).querySelector(`[data-correct-form="${id}"]`); if (f) f.hidden = false; }
  (renderBoard as Loose)();
  (renderProgress as Loose)();
  (drawFilters as Loose)((shell as Loose).PAGE_NOW);

  // Health's findings, checks and tests are Sensors › Fleet's now (kit-93: renderMonitoring above)
  // Hours by phase, USD by phase, USD by model and Tokens are Efficiency's now (kit-174): Where it goes
  (renderEfficiency as Loose)(d);
  (renderTrust as Loose)(d);
  renderAwareness(d);
  // Governance's listing is its own read (kit-93): read again at most once a minute while the page is shown
  renderGovernance();
  if (shell.PAGE_NOW === 'governance') later(loadGovernance);

  refreshDrawer();
  // the records owner-action cards read by peek: again, so one changed elsewhere shows (a retired one stays retired)
  for (const id of [...wordsState.OA_PEEKS]) { const pk = (peeksState as Loose).PEEKS.get((peekKey as Loose)('lesson', id)); if (pk && !pk.missing && pk.record?.fields?.status !== 'retired') later(fetchPeek, 'lesson', id); }
  // last, so every section that holds an input is drawn before its half-typed value comes back
  // into the page's copy (the Inbox tab's), never the layer's (a thread's card, kit-89)
  // A tick goes back to the Inbox's card only: a peek's card keeps its own (kit-766). A typed value
  // goes back wherever it was, the goal peek's Wrong? form included.
  const pageField = (sel: Loose) => [...document.querySelectorAll(sel)].find((el: Loose) => !layerField(el));
  for (const [sel, v] of (kept as Loose)) { const el = (pageField as Loose)(sel); if (el) el.value = v; }
  for (const sel of (keptChecks as Loose)) { const el = [...(document as Loose).querySelectorAll(sel)].find((c: Loose) => !layerField(c) && !c.closest('#drawer')); if (el) el.checked = true; }
  (restoreSecretDrafts as Loose)();
  (viewOnly as Loose)((d as Loose).viewer?.level ?? null);
  (focusBack as Loose)(focus);
}

export function showFailure(message: Loose) {
  const b = $('banner');
  $('stale')!.hidden = true; // the banner says what is shown, and why
  $('loading')!.hidden = true;
  const first = !shell.DATA;
  const fix = /needs Node 18|is not a function|SyntaxError|Unexpected token/.test(message)
    ? 'The script may be running on a Node too old for it: the dashboard uses the Node it was started with, which is often the version the project pins (.tool-versions, .nvmrc). devteam needs Node 18+.'
    : /Failed to fetch|NetworkError|Load failed/.test(message) ? 'The dashboard server is not answering. Restart it: <code>node docs/devteam/scripts/devteam.mjs dashboard</code>.' : '';
  b!.className = first ? 'banner' : 'banner stale';
  b!.innerHTML = first
    ? `<b>Could not load the dashboard data.</b> Every section below needs it. ${fix}<pre>${esc(message)}</pre>`
    : `<b>Showing data from ${esc(new Date((shell.DATA as Loose).generated_at).toLocaleTimeString())}; refreshing failed.</b> ${fix}<pre>${esc(message)}</pre>`;
  b!.hidden = false;
}
