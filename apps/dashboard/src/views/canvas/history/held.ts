// canvas-history's holder (kit-1017). `shared`: the section's binding other sections read and change
// (kit-1013's rule: other sections use `history.shared.<name>`), starting as the page's own
// (canvas.html 3586). No DOM at import.
import type { Json } from '../core/page';

export type Shared = {
  undos: Json[];
};

export const shared: Shared = {
  undos: [],
};
