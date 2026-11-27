// kit-989: settings's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, settings's own port too, reads and
// writes settingsState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const settingsState = {
  // index.html:4562
  SET_MARK: null as Loose,
};
