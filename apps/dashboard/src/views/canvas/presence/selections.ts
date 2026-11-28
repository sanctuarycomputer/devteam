// ---- others' selections and last edits (kit-663 §4, §5; canvas@1 §5) (canvas.html 4955-4988, kit-1018) ----
// Each declaration is the page's own, with types added. The page's `seen` is `shared.seen` (held.ts):
// sync reads and assigns it too. No load-time code, no DOM at import.
import { isObj, type Json } from '../core/page';
import * as sync from '../sync';
import { shared } from './held';
import { placeOthers } from './drawing';

export const MARK_MS = 3000;
export const BOXES_MAX = 1000;
export function takeSelections(m: Json): void {
  if (!Array.isArray(m.people)) return;
  shared.seen.sels = m.people
    .filter((p: Json) => isObj(p) && typeof p.id === 'string' && p.id !== shared.seen.you && Array.isArray(p.ids))
    .map((p: Json) => ({ id: p.id, name: typeof p.name === 'string' && p.name ? p.name : p.id, ids: p.ids.filter((x: Json) => typeof x === 'string').slice(0, sync.shared.SELECT_IDS) }));
  placeOthers();
}
// An ops frame that isn't ours (its ack names another client or none) by another person: the nodes
// its set, move and add ops name become the mark, replacing any earlier one, for 3 s from now.
export function markEdit(m: Json): void {
  if (isObj(m.ack) && m.ack.client === sync.shared.CLIENT) return;
  const by = isObj(m.by) ? m.by : {};
  const person = typeof by.id === 'string' && by.id ? by.id : null;
  if (person !== null && person === shared.seen.you) return;
  const ids = new Set<string>();
  for (const op of Array.isArray(m.ops) ? m.ops : []) {
    if (!isObj(op)) continue;
    if ((op.op === 'set' || op.op === 'move') && typeof op.id === 'string') ids.add(op.id);
    else if (op.op === 'add' && isObj(op.node) && typeof op.node.id === 'string') ids.add(op.node.id);
  }
  if (ids.size === 0) return;
  shared.seen.mark = { ids: [...ids].slice(0, BOXES_MAX), name: typeof by.name === 'string' && by.name ? by.name : 'Someone', person: person ?? 'someone' };
  clearTimeout(shared.seen.markTimer!);
  shared.seen.markTimer = setTimeout(() => { shared.seen.markTimer = null; shared.seen.mark = null; placeOthers(); }, MARK_MS);
  placeOthers();
}
