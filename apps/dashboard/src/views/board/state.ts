// kit-989: board's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, board's own port too, reads and
// writes boardState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const boardState = {
  // index.html:2922
  PHASE_SHORT: { starting: 'Starting', spec: 'Spec', plan: 'Plan', contract: 'Contracts', build: 'Building', verify: 'Verifying', 'final-review': 'Final review', 'awaiting-word': 'Waiting', merging: 'Merging', parked: 'Parked' },
  // index.html:2967
  FILTER_PAGES: ['board', 'progress', 'library', 'loop'],
};
