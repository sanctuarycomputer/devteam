// kit-995: the Jobs page (index.html's settings lines): renderJobs.
import { bindPageTables, pageTable } from '../autonomy';
import { recEvery, recKind, recLast, recList, recNext, recProposals, recWord } from '../peek-kinds';
import { peekKindsState } from '../peek-kinds/state';
import { esc } from '../shell';
import { $ } from '../shell/page';
import { cardHead, when } from '../words';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// ui-candidate: card
export function renderJobs() {
  // kit-169: the Jobs page under Autonomy (#jobs): every job, what the loop noticed (a row per signal), the kit's
  // built-ins and the proposed jobs, four section cards whose record tables' rows open their peek. It reads only
  // /api/data's upkeep.recurring, through kit-166's recList and recProposals. Its nav count is the jobs failing
  // now, in the danger colour, else the number of jobs. The page is written only when its HTML changed, so a poll
  // keeps focus and sort; each write binds its tables again (a header sorts and redraws, a row opens its record).
  const el = $('jobs');
  if (!el) return;
  const es = recList('entries'), bs = recList('builtin'), ps = recProposals();
  const failing = (es as Loose).filter((e: Loose) => e.state === 'failing').length;
  const nav = $('n-jobs');
  if (nav) { nav.textContent = failing ? String(failing) : (es as Loose).length ? String((es as Loose).length) : ''; nav.classList.toggle('hot', failing > 0); }
  const sigs = (e: Loose) => (Array.isArray(e.signals) ? e.signals.filter((s: Loose) => s && typeof s === 'object') : []);
  const sigBadge = (s: Loose) => `<span class="badge medium">${esc(recWord(peekKindsState.REC_SIGNAL_WORDS, s.kind) ?? String(s.kind ?? ''))}</span>`;
  const jobOpen = (e: Loose) => `recurring/${encodeURIComponent(e.name)}`;
  const card = (jp: Loose, icon: Loose, label: Loose, body: Loose, extra: Loose = '') => `<div class="card flush c12" data-jp="${jp}">${cardHead(icon, label, { extra })}${body}</div>`;
  const jobsBody = pageTable('jobs:jobs', ['Job', 'Kind', 'Every', 'Last run', 'Next', 'Fails in a row', 'Noticed'], (es as Loose).map((e: Loose) => ({
    cells: [esc(e.title || e.name), esc(recKind(e)), esc(recEvery(e, true)), recLast(e.last), esc(recNext(e)), esc(Number.isFinite(e.fails_in_a_row) ? e.fails_in_a_row : ''), sigs(e).length ? sigs(e).map(sigBadge).join(' ') : '—'],
    sort: [undefined, undefined, undefined, e.last?.at ?? null, e.kind === 'chore' && e.state === 'held' ? null : e.next_at ?? null, undefined, undefined],
    open: jobOpen(e),
  })));
  const noticed = (es as Loose).flatMap((e: Loose) => sigs(e).map((s: Loose) => ({ e, s })));
  const noticedBody = pageTable('jobs:noticed', ['Job', 'Signal', 'What it saw', 'What it may propose'], noticed.map(({ e, s }: Loose) => ({
    cells: [esc(e.title || e.name), sigBadge(s), esc(s.text ?? ''), esc(s.may ?? '')],
    open: jobOpen(e),
  })));
  const builtinBody = pageTable('jobs:builtin', ['Job', 'Every', 'Last', 'Next'], (bs as Loose).map((b: Loose) => ({
    cells: [esc(recWord(peekKindsState.REC_BUILTIN, b.name) ?? b.name), esc(recEvery({ every: b.every }, true)), esc(b.last_at ? when(b.last_at) : ''), esc(b.next_at ? when(b.next_at) : '')],
    sort: [undefined, undefined, b.last_at ?? null, b.next_at ?? null],
    open: `builtin/${encodeURIComponent(b.name)}`,
  })));
  const proposalsBody = pageTable('jobs:proposals', ['Proposed job', 'Status', 'Asked'], (ps as Loose).map((x: Loose) => ({
    cells: [esc(x.title || x.name), `<span class="badge${x.status === 'open' ? ' medium' : ''}">${esc((peekKindsState.REC_PROPOSAL as Loose)[x.status])}</span>`, esc(x.asked_at ? when(x.asked_at) : '')],
    sort: [undefined, undefined, x.asked_at ?? null],
    open: x.qid ? `q/${encodeURIComponent(x.qid)}` : null,
  })));
  const waiting = (ps as Loose).filter((x: Loose) => x.status === 'open').length;
  const html = `<div class="g12">${card('jobs', 'calendar-clock', 'Jobs', jobsBody, (es as Loose).length ? esc(`${(es as Loose).length} · ${failing} failing`) : '')}${
    card('noticed', 'radar', 'What the loop noticed', noticedBody)}${card('builtin', 'box', 'Built in', builtinBody)}${
    card('proposals', 'lightbulb', 'Proposed jobs', proposalsBody, waiting ? esc(`${waiting} waiting on you`) : '')}</div>`;
  if ((el as Loose).__html === html) return;
  (el as Loose).__html = html;
  el.innerHTML = html;
  bindPageTables(el, renderJobs);
}
