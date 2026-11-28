// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;

// kit-994: Sensors' pure parts (index.html's autonomy lines): a sensor's state words, the levels' tones, a
// fingerprint's words, the incident columns, the finding ranks. No imports and no DOM at import.

// today's events by level (a probe's output, an error tracker's errors, C7), a dot and a count each; '' with none
export const SENSOR_LEVEL_DOT = { fatal: 'red', error: 'red', warning: 'amber', warn: 'amber' };
// The hash of the record a finding's subject names, else null (R2), as linkify links them: a ticket, a sensor or a
// planner only when /api/data lists it, a thread, a goal or another logged id by its prefix; a commit, a check or
// anything else names none
export const SUBJ_KINDS = { g: 'goal', k: 'lesson', a: 'act', d: 'decision', p: 'problem', m: 'thread', t: 'talk', o: 'observation', q: 'q' };
export const SEV_RANK = { low: 1, medium: 2, high: 3, critical: 4 };
// ---- monitoring ----
export const MON_STATE = { up: ['good', 'up'], down: ['high', 'down'], ok: ['good', 'reading'], failing: ['high', 'failing'], unknown: ['', 'not run yet'] };
export const monState = (m: Loose) => (m.state === 'up' && m.slow ? ['medium', 'slow'] : m.kind === 'stream' && m.state !== 'unknown' && m.listening === false ? ['medium', 'not listening'] : m.kind !== 'http' && m.state === 'ok' && m.fails ? ['medium', `${m.fails} failed`] : (MON_STATE as Loose)[m.state] || ['', m.state]);
export const LEVEL_TONE = { fatal: 'high', error: 'high', warning: 'medium', info: '', debug: '' };
export const fpWhat = (f: Loose) => f.kind === 'exception' ? `${f.class || 'exception'}${f.title ? `: ${f.title}` : ''}` : f.kind === 'platform' ? `${f.code || ''} platform error` : f.template || f.title || f.key;
export const pctOr = (x: Loose) => (x == null ? '–' : `${x}%`);
// Incidents as a board in the design's five columns, each fed from incidentView's stages (kit-93 C1): Open
// (new, and regressed in red), Investigating (triaged), Fixing (fixing, and merged: not yet verified),
// Watching (verifying), Resolved (the last five).
export const INC_COLS = [['open', 'Open', ['new', 'regressed']], ['investigating', 'Investigating', ['triaged']], ['fixing', 'Fixing', ['fixing', 'merged']], ['watching', 'Watching', ['verifying']], ['resolved', 'Resolved', ['resolved']]];
