// kit-989: viewer's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, viewer's own port too, reads and
// writes viewerState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const viewerState = {
  // index.html:6884
  AV: null as Loose,
  // index.html:6889
  avFocus: null as Loose,
  // index.html:6893
  AV_RET: null as Loose,
  // index.html:6893
  AV_NAVS: 0,
  // index.html:6898
  AV_FRAME_ESC: false,
  // index.html:6899
  AV_LOADS: new WeakMap(),
  // index.html:6930
  TS: { kind: null as Loose, slug: null as Loose, at: null as Loose, fp: null as Loose, mainFp: null as Loose, fpNow: null as Loose, mainFpNow: null as Loose, path: null as Loose, hash: '', draws: 0, name: null as Loose, route: null as Loose, viewport: null as Loose, errors: [] as Loose[], origin: null as Loose, session: null as Loose, up: null as Loose, target: '*', ready: false, raised: false, seq: 0, minted: new Map(), hit: null as Loose, waiters: new Map(), rects: new Map(), keyOf: new Map(), watching: new Set<Loose>(), watch: '', last: null as Loose, rafPending: false, via: null as Loose, waitMs: 150, drawPending: false, pinsPending: false },
};
