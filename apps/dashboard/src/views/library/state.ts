// kit-989: library's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, library's own port too, reads and
// writes libraryState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const libraryState = {
  // index.html:8730
  LIB_KINDS: [['mock', 'Mock', 'layout-dashboard'], ['diagram', 'Diagram', 'workflow'], ['docs', 'Docs', 'book-open'], ['review', 'Review page', 'list-checks'], ['preview', 'Preview', 'monitor-play'], ['link', 'Link', 'link'], ['archived', 'Archived', 'archive']],
};
