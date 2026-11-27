// kit-989: thread's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, thread's own port too, reads and
// writes threadState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const threadState = {
  // index.html:10809
  ASK: { q: null as Loose, since: 0, sent: null as Loose, sentAt: 0, note: '', busy: false, err: '' },
  // index.html:10814
  ASK_ARM_MS: 1000,
  // index.html:11170
  TH: { th: null as Loose, t: null as Loose, tabs: null as Loose, pane: null as Loose, focus: null as Loose, focusRow: null as Loose, opened: null as Loose, adopt: null as Loose, ask: null as Loose, front: false },
  // index.html:11171
  TH_LISTS: ['open', 'resolved', 'inbox', 'supervisor', 'shell'],
  // index.html:11172
  TH_TITLES: { supervisor: "The supervisor's own terminal", shell: "A shell at the project's root, in its own window" },
};
