// kit-989: words's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, words's own port too, reads and
// writes wordsState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const wordsState = {
  // index.html:3130
  PHASE_WORDS: { starting: 'starting', spec: 'writing the spec', plan: 'planning', contract: 'agreeing contracts', build: 'building', verify: 'verifying', 'final-review': 'final review', 'awaiting-word': 'waiting for the go-ahead', merging: 'merging', blocked: 'blocked', parked: 'parked', done: 'done' },
  // index.html:3131
  RUNG_WORDS: { 1: 'asks you first', 2: 'asks, with a default', 3: 'decides, then tells you' },
  // index.html:3132
  KIND_WORDS: { 'owner-decision': 'Decision', 'one-way-door': 'Hard to undo', clarification: 'Clarification', proposal: 'Proposal', trust: 'More trust?', 'goal-definition': 'Defining a goal', 'owner-action': 'Needs you to do something', review: 'Review' },
  // index.html:3133
  CHANNEL_WORDS: { dashboard: 'on the dashboard', cli: 'in your terminal', chat: 'to the supervisor in chat', thread: 'in a thread' },
  // index.html:3222
  FIELD_WORDS: { depends_on: 'what it waits on', touches: 'which files it may change', done_when: 'what “done” means', title: 'its title', held: 'whether it is on hold', superseded_by: 'what replaces it', serves: 'which stories it serves', risk: 'its risk', size: 'its size', kind: 'its kind', contracts: 'its contracts', one_way_doors: 'its hard-to-undo parts', notes: 'its notes' },
  // index.html:3272
  GOAL_VERDICTS: { Approve: 'approve', Refine: 'refine', 'Let go': 'let-go' },
  // index.html:3314
  OA_SET: new Map(),
  // index.html:3315
  OA_CONFIRM: new Map(),
  // index.html:3316
  OA_PEEKS: new Set<Loose>(),
  // index.html:3317
  NOT_DONE: new Map(),
  // index.html:3389
  picks: {} as { [k: string]: Loose },
  // index.html:3406
  SECRET_DRAFTS: new Map(),
  // index.html:3525
  KIND_ICON: { 'owner-decision': 'scale', 'one-way-door': 'triangle-alert', clarification: 'circle-help', proposal: 'lightbulb', trust: 'users', 'goal-definition': 'target', 'goal-approval': 'flag', 'owner-action': 'zap', review: 'list-checks' },
};
