// canvas-presence's holder (kit-1018). `shared`: the section's one binding other sections read or
// assign (kit-1013's rule: other sections use `presence.shared.<name>`), starting as the page's own
// (canvas.html 4961). No DOM at import.
import type { Json } from '../core/page';

export type Seen = { you: string | null; sels: Json[]; mark: Json; markTimer: ReturnType<typeof setTimeout> | null };
export type Shared = { seen: Seen };

export const shared: Shared = {
  // you: our person id on the canvas socket (its welcome); sels: [{ id, name, ids }] of other people;
  // mark: the nodes another person's last edit changed { ids, name, person }, for 3 s.
  seen: { you: null, sels: [], mark: null, markTimer: null },
};
