// canvas-panels' holders (kit-1014). `shared`: the section's bindings other sections read or assign
// (kit-1013's rule: other sections use `panels.shared.<name>`), each starting as the page's own
// (canvas.html 1311, 1314, 1315, 1530, 2244, 2252). `held`: the section's own lets two of its modules
// share (1312, 1313). No DOM at import.
import type { Json } from '../core/page';

/** A pan under way: the pointer, where it pressed, the view then, and whether it is a touch. */
export type Pan = { id: number; cx: number; cy: number; x: number; y: number; touch?: boolean };
/** The view: #surface moved by translate(x, y) scale(z). */
export type View = { x: number; y: number; z: number };
export type Shared = { DEFAULT: Record<string, Json>; pan: Pan | null; PX: number; shown: number; spaceHeld: boolean; view: View };

export const shared: Shared = {
  // the view: #surface moved by translate(x, y) scale(z), origin top-left, x and y in stage px
  view: { x: 0, y: 0, z: 1 },
  pan: null,
  spaceHeld: false,
  // the count of showPage calls: a slower one finishing after a newer one doesn't mark it ready
  shown: 0,
  PX: 100000,
  // each field's default (canvas-doc@1 §2 Properties), shown when the node doesn't store it
  DEFAULT: {
    visible: true, opacity: 1, x: 0, y: 0, 'size.w': 'hug', 'size.h': 'hug', fill: null, stroke: null, strokeWidth: 0,
    radius: 0, clip: false, 'layout.mode': 'none', 'layout.gap': 0, 'layout.padding': [0, 0, 0, 0], 'layout.align': 'start',
    'layout.justify': 'start', 'layout.wrap': false, 'layout.columns': [], 'layout.rows': [], text: '',
    font: { family: 'sans', size: 16, weight: 400, lineHeight: 1.4 }, color: '#000000', align: 'left', fit: 'cover', variant: null,
    name: '',
  },
};

export const held = {
  moved: false, // the person has zoomed or panned since the page was shown
  panned: false, // the pointer press now ending was a pan
};
