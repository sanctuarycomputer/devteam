// kit-989: review's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, review's own port too, reads and
// writes reviewState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const reviewState = {
  // index.html:3864
  RV: null as Loose,
  // index.html:4190
  HOLD_STATE_WORDS: { running: 'Running', draining: 'Draining…', drained: 'Drained', parking: 'Parking…', parked: 'Parked', 'let go': 'Let go' },
};
