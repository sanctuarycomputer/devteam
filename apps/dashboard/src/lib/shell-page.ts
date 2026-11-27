// kit-988: the shell's pure page helpers (spec, Where each part goes). No DOM at import and no
// relative imports: compiled to lib-dist/lib/shell-page.js, which Node imports as it is.

// A page's nav count is the element render() fills (PAGE_COUNT_ID: the count each nav item carries).
export const PAGE_COUNT_ID: Record<string, string> = { goals: 'n-goals', progress: 'n-progress', board: 'n-active', library: 'n-library', trust: 'n-trust', efficiency: 'n-efficiency', awareness: 'n-awareness', sensors: 'n-sensors', jobs: 'n-jobs', retros: 'n-retros', loop: 'n-knowledge' };

// The 14 pages, in index.html's order: each is a section (its data-page), drawn in the nav of its group.
export const PAGES: readonly { id: string; title: string; group: string; icon: string }[] = [
  { id: 'overview', title: 'Overview', group: 'project', icon: 'layout-dashboard' },
  { id: 'goals', title: 'Goals', group: 'project', icon: 'target' },
  { id: 'progress', title: 'Progress', group: 'project', icon: 'chart-line' },
  { id: 'board', title: 'Board', group: 'project', icon: 'kanban' },
  { id: 'library', title: 'Library', group: 'project', icon: 'library' },
  { id: 'trust', title: 'Trust', group: 'autonomy', icon: 'shield-check' },
  { id: 'efficiency', title: 'Efficiency', group: 'autonomy', icon: 'zap' },
  { id: 'awareness', title: 'Awareness', group: 'autonomy', icon: 'eye' },
  { id: 'governance', title: 'Governance', group: 'autonomy', icon: 'scale' },
  { id: 'sensors', title: 'Sensors', group: 'autonomy', icon: 'activity' },
  { id: 'jobs', title: 'Jobs', group: 'autonomy', icon: 'calendar-clock' },
  { id: 'retros', title: 'Retros', group: 'autonomy', icon: 'history' },
  { id: 'loop', title: 'Self Improvement', group: 'autonomy', icon: 'repeat' },
  { id: 'settings', title: 'Settings', group: 'settings', icon: 'settings' },
];

// ---- index.html's page helpers (1953-2054), their bodies as they are, with types ----
// @ts-expect-error -- the body as it is: strict TypeScript reads the lookup by the matched character as string | undefined
export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Every item the dashboard draws says what it is (data-subject="<type>:<id>") and what it is called
// (data-title), so the thread layer can point at it, name it, and find it again after a redraw.
export const subj = (type: string, id: unknown, title?: unknown): string => ` data-subject="${esc(`${type}:${id}`)}" data-title="${esc(String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120))}"`;
// The Decide feed's rows are calls of several kinds; each points at its own record.
export const decSubject = (r: { kind: string; id?: unknown }): string => ({ decision: 'decision', act: 'act', answer: 'question', goal: 'goal', rule: 'lesson' }[r.kind] ?? (String(r.id).startsWith('d-') ? 'decision' : 'act'));
export const DAY: number = 864e5;
export const dur = (s: number): string => (s < 60 ? `${s}s` : `${(s / 60).toFixed(1)} min`);
export const fmtDate = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const isDone = (t: { merged_at?: unknown }): boolean => !!t.merged_at;
export const pct = (a: number, b: number): number => (b ? Math.round((100 * a) / b) : 0);
// Every empty state says what would fill it, so an empty section reads as "nothing yet", not "broken".
export const empty = (html: string): string => `<p class="empty">${html}</p>`;

// The viewer (spec §7): this page at /view/artifact/<slug>[?at=main|<worktree>|tree:<id>] or
// /view/preview/<name>, one artifact or preview on the stage. index.html's VIEWER, as a function of the
// two things it read: the path within the app (appPath(), so /next/view/... is /view/...) and location.search.
export function viewerOf(pathname: string, search: string): { kind: 'artifact' | 'preview'; name: string; at: string } | null {
  const m = /^\/view\/(artifact|preview)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/.exec(pathname);
  // m[1] is one of the regex's two kinds
  return m ? { kind: m[1] as 'artifact' | 'preview', name: m[2], at: new URLSearchParams(search).get('at') || 'main' } : null;
}
