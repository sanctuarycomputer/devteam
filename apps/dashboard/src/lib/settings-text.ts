// kit-995: the Settings page's pure names (index.html:4491, 4495-4510), as index.html has them, with types and exports.
// No imports and no DOM at import: compiled to lib-dist/lib/settings-text.js.
// `Loose` is `any`: a setting as /api/data's settings_all serves it.
type Loose = any;

export const LIMITS = ['max_active_tickets', 'max_active_per_component'];
// the limits' names (the server's) for a server whose settings_all can't be read
export const LIMIT_NAMES = { max_active_tickets: 'Workers at once, in all', max_active_per_component: 'Workers at once, per component' };
export const SET_SAVED_LABEL = 'saved; applies once the supervisor lands it';
export const settingList = (a: Loose) => (a.length ? `${a.length}: ${a.join(', ')}` : 'none');
// a setting's value in words, by what of it the server shows
export function settingText(e: Loose) {
  if (e.withheld) return 'withheld';
  if (e.shown === 'hidden') return 'not shown here';
  if (e.shown === 'names') return settingList(Array.isArray(e.value) ? e.value.map(String) : []);
  if (e.shown === 'count') return e.value ? String(e.value) : 'none';
  const v = e.value;
  if (v === null || v === undefined) return 'not set';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return settingList(v.map(String));
  if (typeof v === 'object') return settingList(Object.keys(v));
  return String(v);
}
