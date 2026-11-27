// kit-989: data's cross-view state (APPS.md, Cross-view state). index.html's top-level names that another view's
// lines read or assign, as one object: an import can't be assigned, so every view, data's own port too, reads and
// writes dataState.<name>. Each value is index.html's, as it has it; this file imports no view.
// `Loose` is `any`: a null or empty value index.html later fills with data has no fixed shape there.
type Loose = any;

export const dataState = {
  // index.html:8014
  ROUTED: false,
  // index.html:8017
  HERE: null as Loose,
  // index.html:8026
  LOOP_TABS: ['observe', 'orient', 'decide', 'act'],
  // index.html:8053
  TH_CARRY: null as Loose,
  // index.html:8053
  TH_CARRY_FROM: null as Loose,
  // index.html:8053
  TH_FRESH: null as Loose,
  // index.html:8053
  TH_MADE: null as Loose,
  // index.html:8142
  TAB: 'observe',
  // index.html:8160
  RAW: null as Loose,
  // index.html:8163
  PRESSES: new Map(),
  // index.html:12268
  HELD: null as Loose,
};
