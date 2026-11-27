// kit-989: threads-panel's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, threads-panel's own port too, reads and
// writes threadsPanelState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const threadsPanelState = {
  // index.html:10092
  TL: { threads: [] as Loose[], raw: [] as Loose[], pend: [] as Loose[], pane: false, open: null as Loose, draft: null as Loose, hit: null as Loose, pin: false, via: null as Loose, swallowUntil: 0, typed: {} as { [k: string]: Loose }, sig: '', polling: null as Loose, seq: 0, have: 0, openAt: -1, polled: false, busy: false, resolving: false, readyKey: '', acts: '', pressed: null as Loose, route: null as Loose, prompts: [] as Loose[] },
  // index.html:10953
  tlFresh: 0,
};
