// kit-1008 ruling 2: the hub shell's top-level state that another view of hub.html reads (compat-scan's
// cross-view state rule, S13). The glue reads and writes hubShellState.<name> wherever hub.html reads the
// variable. Two differences the server render forces (spec, The cycle and the state): the three elements
// start null and bootHub() looks them up; NOTIFY_OK starts null and notifyOk() (boot.ts) computes it at
// boot step 2, before any other code reads it.
import { escHtml } from '@shared/shell/shell';
import { labelWhy } from '../../lib/hub-shell-box';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

// A project's address, or null when it has none: on box: 2 a name that can't be a host, or that two
// listed projects share, gets none (the gateway serves no dashboard there). urlOf.why says which.
const urlOf = Object.assign((x: Loose): string | null => (!hubShellState.box ? `http://127.0.0.1:${Number(x.port)}/` : hubShellState.box.v === 1 ? hubShellState.box.instance.replace('{port}', String(Number(x.port))) : urlOf.why(x) ? null : hubShellState.box.project.replace('{project}', x.name)), {
  // project-hosts@1's label rule (cloud/gateway.mjs), copied (lib/hub-shell-box.ts); the gateway counts
  // only listed projects: a gone one shares nothing
  why(x: Loose): string | null {
    return labelWhy(x.name, hubShellState.box?.v, [...hubShellState.items.values()].some((o: Loose) => o.x.root !== x.root && !o.goneAt && o.x.name === x.name));
  },
  // each reason, short (a card's error) and in full (the tab's panel)
  words: {
    'not-a-label': ['its name isn\'t a host name', () => 'only lowercase letters, digits and dashes, 1–63 long, not starting or ending with a dash'],
    'all-digits': ['its name is all digits', () => 'an all-digit name is a port\'s shape on a box'],
    reserved: ['its name is reserved', () => '<code>term</code>, <code>public</code> and <code>www</code> are the box\'s own'],
    shared: ['its name is shared', (n: unknown) => `two projects on this box are named ${escHtml(n)}, so neither has a host`],
  } as Record<string, [string, (n: unknown) => string]>,
});

export const hubShellState = {
  items: new Map<string, Loose>(), // root -> { x, tab, frame, goneAt }
  selected: null as string | null,
  NOTIFY_OK: null as boolean | null,
  // { v, terminal, instance (v 1) or project (v 2), push, image, previews, passkeys, role, people, level } when the gateway answers box.json
  box: null as Loose,
  hubSeen: null as Loose, // the last list instances.json gave, or null when it gave none (the box line)
  urlOf,
  OVERVIEW: '\u0000overview',
  ovEl: null as Loose,
  ovBody: null as Loose,
  ovTab: null as Loose,
  // the hub's Settings: a view with no tab, opened from the Overview's link (#settings)
  SETTINGS: '\u0000settings',
  setEl: null as Loose,
  fleetBusy: new Map<string, Loose>(), // root -> what is being asked, or the last error
  // root -> the mode its dashboard just said it set: a hello is up to 10 s old, and until it agrees
  // (or 30 s pass) the card shows what was done, not what the old hello says
  fleetSet: new Map<string, Loose>(),
};
