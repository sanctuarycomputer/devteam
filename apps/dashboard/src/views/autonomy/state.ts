// kit-989: autonomy's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, autonomy's own port too, reads and
// writes autonomyState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const autonomyState = {
  // index.html:2525
  GOV: { at: 0, files: null as Loose, error: null as Loose, pending: false },
  // index.html:2579
  SENSOR_TAB: 'production',
};
