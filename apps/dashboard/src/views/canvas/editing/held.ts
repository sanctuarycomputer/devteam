// canvas-editing's holder (kit-1016). `shared`: the section's bindings other sections read or assign
// (kit-1013's rule: other sections use `editing.shared.<name>`), each starting as the page's own
// (canvas.html 2808, 2813, 2815, 2820-2823). No DOM at import.
import type { Json } from '../core/page';

export type Shared = {
  IMAGE_SAY: { tooBig: string; types: string; failed: string };
  IMAGE_BYTES: number;
  tool: string;
  gesture: Json;
  toolPress: boolean;
  pen: Json;
  placing: Json;
};

export const shared: Shared = {
  IMAGE_SAY: {
    tooBig: 'That image is too big (at most 4 MB).',
    types: 'Only PNG, JPEG, WebP or GIF images can be added.',
    failed: "The image couldn't be added.",
  },
  IMAGE_BYTES: 4 * 1024 * 1024, // canvas@1 §7 imageBytes
  tool: 'move',
  // gesture: the press a tool is following ({ id, tool, sx, sy, cx, cy, dragged, draft }, and for
  // Move the node, its element and where the press was: see pressMove), or null;
  // toolPress: the click that ends such a press is the tool's, not a selection; pen: the path being
  // drawn ({ pts in page px, el, line }), or null; placing: where the image being chosen goes, or null.
  gesture: null,
  toolPress: false,
  pen: null,
  placing: null,
};
