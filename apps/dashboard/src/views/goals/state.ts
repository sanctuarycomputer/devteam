// kit-989: goals's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, goals's own port too, reads and
// writes goalsState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const goalsState = {
  // index.html:4306
  HOLD_CONFIRM: new Map(),
  // index.html:4332
  FLEET: { at: 0, data: null as Loose, busy: false },
  // index.html:4335
  FLEET_UI: { confirming: false, busy: null as Loose, error: null as Loose },
  // index.html:4387
  FLEET_DRAWN: new WeakMap(),
  // index.html:4663
  GOALS_TABS: ['active', 'met', 'letgo'],
  // index.html:4664
  GOALS_TAB: 'active',
};
