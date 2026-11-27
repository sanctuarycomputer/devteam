// kit-989: loop's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, loop's own port too, reads and
// writes loopState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const loopState = {
  // index.html:4992
  ORIENT_KINDS: ['lesson', 'fact', 'preference', 'constraint', 'pointer', 'problem', 'incident', 'recurring signal'],
  // index.html:4995
  LOOP_DEC: { corrected: false, routine: false },
  // index.html:5074
  LOOP_ROWS: null as { [tab: string]: (o: Loose) => Loose[] } | null,
};
