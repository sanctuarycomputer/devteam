// kit-988: the dashboard's router table (dashboard-shell@1, test/contracts/shell.md §6). The block below is
// index.html's shell-routes, moved with its markers: its only changes are `export ` before each top-level
// declaration and the types. Pure, no imports: compiled to lib-dist/lib/shell-routes.js, which
// test/dashboard-shell.test.mjs imports.
/* shell-routes start */
// The router's table (dashboard-shell@1, test/contracts/shell.md §6): the page ids, each link kind's home page (what a
// link opens over on a cold load), file homes by path, and the redirects. The page's own, outside the
// shared block, so the tickets that change it never touch the block.
// kit-93: Health folds into Sensors (its head redirects) and Governance is a page, so a governance file opens over it
export const SHELL_ROUTES_PAGES: string[] = ['overview', 'goals', 'progress', 'board', 'library', 'trust', 'efficiency', 'awareness', 'governance', 'sensors', 'jobs', 'retros', 'loop', 'settings'];
export const SHELL_ROUTES: { pages: string[]; peeks: string[]; links: Record<string, string>; files: [RegExp, string][]; redirects: Record<string, string> } = {
  pages: SHELL_ROUTES_PAGES,
  // dashboard-shell@2: what p may open, each a peek kind (TYPE_META's) or one of the two viewers
  peeks: ['ticket', 'goal', 'feature', 'story', 'release', 'wave', 'milestone', 'act', 'decision', 'retro', 'lesson', 'problem', 'thread', 'planner', 'q', 'file', 'sensor', 'observation', 'signal', 'learning', 'lib', 'class', 'recurring', 'builtin', 'artifact', 'preview'],
  links: {
    ticket: 'board', feature: 'board', story: 'board', release: 'board', wave: 'board', milestone: 'board', planner: 'board', thread: 'board',
    goal: 'goals', q: 'overview', talk: 'overview',
    act: 'loop', decision: 'loop', lesson: 'loop', problem: 'loop', signal: 'loop', learning: 'loop', observation: 'loop',
    sensor: 'sensors', retro: 'retros', class: 'trust',
    // kit-166: a job's and a built-in job's peek open over Goals, where Upkeep's card is
    recurring: 'goals', builtin: 'goals',
    artifact: 'library', preview: 'library', review: 'library', 'review-preview': 'library', file: 'library', lib: 'library',
  },
  files: [[/(^|\/)docs\/devteam\/(governance|process)\//, 'governance'], [/(^|\/)strategy\.md$/, 'governance']],
  redirects: {
    monitoring: 'sensors', health: 'sensors?st=fleet',
    // permanent: the old Loop tab subjects open the Loop page (and its tab)
    'loop/observe': 'loop', 'loop/orient': 'loop?lt=orient', 'loop/decide': 'loop?lt=decide', 'loop/act': 'loop?lt=act',
    // the Inbox is the Threads panel's first tab (kit-100): its old heads open it over Overview
    inbox: 'overview?th=inbox', questions: 'overview?th=inbox',
  },
};
/* shell-routes end */
