// kit-989: peek-kinds's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, peek-kinds's own port too, reads and
// writes peekKindsState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const peekKindsState = {
  // index.html:5947
  REC_SIGNAL_WORDS: { flapping: 'flapping', erroring: 'erroring', slow: 'slow', 'failing-long': 'failing a long time', idle: 'nothing to do', overdue: 'often late', quiet: 'never fails' },
  // index.html:5974
  REC_BUILTIN: { retro: 'Retro', research: 'Research', 'kit-sync': 'Kit sync', sensors: 'Sensors' },
  // index.html:5975
  REC_PROPOSAL: { open: 'waiting on you', registering: 'you said Yes · being registered', stopping: 'you said Yes · being stopped' },
  // index.html:6520
  LINEAGE_SVG: new Map(),
};
