// canvas-sync's words, bounds and new ids (canvas.html 1659-1711, kit-1015). REFUSED, SAY, OPS_BYTES
// and CLIENT are on `shared` (./shared). Each declaration is the page's own, with types added;
// checks/faithful.mjs holds it to the page's tokens.
import { isObj, own, state, type Json } from '../core/page';
import { randomB36 } from './shared';

export const NOT_VALID = "That change wasn't valid, so it wasn't kept.";
export const BANNER = {
  paused: "Saving paused: the canvas's branch changed. Your edits are kept here.",
  landed: 'This canvas has landed. It is read-only until it is opened for editing again.',
  removed: 'This canvas was closed for editing.',
  down: 'Reconnecting… your edits are kept here.',
};
export const KEPT_MAX = 2000; // kept edits at most (canvas@1 refusedMemory's bound); the oldest go past it
export const RATE = 20; // edits sent a second at most (canvas@1 §7 allows 30 messages, pongs included)

export const ID_PREFIX = randomB36(6);
let idCount = 0;
export const idTaken = (d: Json, id: string): boolean => !!d && (own(d.nodes, id) || d.pages.some((pg: Json) => isObj(pg) && pg.id === id));
// A new node id, skipping any id the document (as the server has it, or as drawn) already has.
export function newId(): string {
  for (;;) {
    const id = `${ID_PREFIX}-${++idCount}`;
    if (!idTaken(state.base, id) && !idTaken(state.doc, id)) return id;
  }
}
