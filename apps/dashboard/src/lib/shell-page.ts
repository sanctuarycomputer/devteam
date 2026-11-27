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
