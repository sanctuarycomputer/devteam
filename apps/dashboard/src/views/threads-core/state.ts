// kit-989: threads-core's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, threads-core's own port too, reads and
// writes threadsCoreState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;
// T_REF's value reads T_TYPES, as index.html's does; the object can't read itself while it is built
const T_TYPES: string[] = ['goal', 'observation', 'question', 'ticket', 'planner', 'decision', 'lesson', 'problem', 'act', 'preview', 'artifact', 'suggestion'];

export const threadsCoreState = {
  // index.html:9720
  T_TYPES: T_TYPES,
  // index.html:9723
  T_REF: new RegExp(`^(${T_TYPES.join('|')}):[a-z0-9][a-z0-9-]{0,110}$`),
  // index.html:9723
  T_REF_MAX: 120,
  // index.html:9725
  T_KIND: { goal: 'a goal', observation: 'an observation', question: 'a question', ticket: 'a ticket', planner: 'a planning session', decision: 'a decision', lesson: 'a lesson', problem: 'a problem', act: 'an action', preview: 'a preview', artifact: 'an artifact', suggestion: 'a suggestion' },
  // index.html:9729
  T_HOME: { goal: 'goals', question: 'inbox', ticket: 'board', planner: 'board', observation: 'loop', problem: 'loop', lesson: 'loop', decision: 'loop', act: 'loop', preview: 'library', artifact: 'library', suggestion: 'trust' },
  // index.html:9731
  T_SECTIONS: { overview: 'Overview', goals: 'Goals', inbox: 'Inbox', progress: 'Progress', board: 'Board', library: 'Library', loop: 'Loop', trust: 'Trust', awareness: 'Awareness', governance: 'Governance', efficiency: 'Efficiency', retros: 'Retros', health: 'Sensors', monitoring: 'Sensors' },
  // index.html:9734
  T_TITLE_MAX: 120,
  // index.html:9734
  T_TURN_MAX: 2000,
  // index.html:9734
  T_ENCODED_MAX: 3800,
  // index.html:9750
  T_SUGG_VIEW: /^#(efficiency|awareness)\?suggestion=([^&#?]{1,177})$/,
  // index.html:9798
  T_CAPS: { ref: 120, quote: 300, view: 200, slug: 63, fp: 64, path: 300, name: 63, route: 300 },
};
