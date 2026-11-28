// kit-994: the Governance page (index.html's autonomy lines): /api/governance's files in three sections, and the
// governance file peek's blocks.
import { fmtDay } from '../peeks';
import { peeksState } from '../peeks/state';
import { esc } from '../shell';
import { $ } from '../shell/page';
import { cardHead } from '../words';
import { effSection } from './efficiency';
import { bindPageTables, pageTable } from './pages';
import { autonomyState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// ---- Governance (kit-93): /api/governance's files in three ruled sections, each opening the read-only file peek ----
// GOV: the last listing's files (kept through a failed read: C8's "the last listing"), when it was read, its error,
// and a read in flight. Read when the page is shown, again at most once a minute while it is (render, showHead).
export async function loadGovernance(force: Loose = false) {
  if (autonomyState.GOV.pending || (!force && autonomyState.GOV.at && Date.now() - autonomyState.GOV.at < 60000)) return;
  autonomyState.GOV.pending = true;
  try {
    const r = await fetch('/api/governance');
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error || `${r.status} ${r.statusText}`.trim());
    if (!Array.isArray(j?.files)) throw new Error('the reply was not a list of files');
    autonomyState.GOV.files = j.files;
    autonomyState.GOV.error = null;
  } catch (e) { autonomyState.GOV.error = String((e as Loose)?.message ?? e); }
  finally { autonomyState.GOV.at = Date.now(); autonomyState.GOV.pending = false; }
  renderGovernance();
}
export const GOV_GROUPS = [['governance', 'Governance'], ['process', 'Process'], ['project', 'Project']];
// A group's rows: File (its title, a badge from its state), Path, Last change (a date, else "—"); a written
// file opens its peek, a not-written one nothing (C4)
export const GOV_BADGE = { 'changed here': 'amber', 'not written yet': 'low' };
export function governanceRows(files: Loose, group: Loose) {
  return (files || []).filter((f: Loose) => f?.group === group).map((f: Loose) => {
    const at = typeof f.last_change === 'string' && !Number.isNaN(Date.parse(f.last_change)) ? f.last_change : null;
    const title = f.title || f.path || '';
    return {
      cells: [`${esc(title)}${f.state ? ` <span class="badge ${(GOV_BADGE as Loose)[f.state] || 'low'}">${esc(f.state)}</span>` : ''}`, `<code>${esc(f.path ?? '')}</code>`, at ? esc(fmtDay(at)) : '—'],
      sort: [title, f.path ?? '', at],
      open: f.written && f.path ? `#file?path=${encodeURIComponent(f.path)}&title=${encodeURIComponent(title)}` : null,
    };
  });
}
// The page, written into #governance only when its HTML changed, so a redraw keeps focus and a pin's element
export function renderGovernance() {
  // a failed read's error, above the last listing when there is one (its paragraphs stay pinnable)
  const err = autonomyState.GOV.error ? `<p class="err">The governance files didn't load: ${esc(autonomyState.GOV.error)}</p>` : '';
  const body = err + (autonomyState.GOV.files ? GOV_GROUPS.map(([g, l]: Loose) => effSection(l, pageTable(`gov:${g}`, ['File', 'Path', 'Last change'], governanceRows(autonomyState.GOV.files, g)))).join('')
    : err ? '' : '<p class="loading">Loading…</p>');
  const html = `<div class="card flush gov-card">${cardHead('scale', 'Files')}${body}</div>`;
  const el = $('governance');
  if (!el || (el as Loose).__html === html) return;
  (el as Loose).__html = html;
  el.innerHTML = html;
  bindPageTables(el, renderGovernance);
}
// A file peek is about a governance file when the last listing named its path (C8: any group; none before a listing)
export const govListed = (path: Loose) => typeof path === 'string' && !!autonomyState.GOV.files?.some((f: Loose) => f?.path === path);
// The block of a governance file's rendered Markdown under el (a paragraph, an item, a heading, a quote, code), else
// null; a file of another repo (its peek's repo) is not this project's governance file
export function govBlockAt(el: Loose) {
  if (peeksState.DRAWER.kind !== 'file' || !govListed(peeksState.DRAWER.id) || (peeksState.DRAWER as Loose).arg?.get?.('repo')) return null;
  const b = el?.closest?.('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre');
  return b && b.closest('#drawer-body .md') ? b : null;
}
