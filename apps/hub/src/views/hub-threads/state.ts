// kit-1008 ruling 2: hub-threads' top-level state that another view of hub.html reads (compat-scan's
// cross-view state rule). The view's port reads and writes it here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
export const hubThreadsState = {
  TL: { avail: null, why: '', op: null, threads: [], raw: [], pend: [], open: null, draft: null, hit: null, pin: false, via: null, swallowUntil: 0, said: {}, seq: 0, have: 0, openAt: -1, polled: false, polling: null, pressed: null, chain: new Map(), turnsSig: '', listSig: '', opNote: '' } as Loose,
};
