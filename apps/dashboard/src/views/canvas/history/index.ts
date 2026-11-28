// canvas-history (kit-1017): undo, copy and paste, the image and the pen (canvas.html 3573-4451), as
// modules. Every declaration of each is exported from here, for core and the other sections; `shared`
// holds the binding other sections read and change (kit-1013's rule: `history.shared.<name>`).
import { initUndo } from './undo';
import { initPaste } from './paste';
import { initImage } from './image';
import { initPen } from './pen';

export * from './held';
export * from './undo';
export * from './paste';
export * from './image';
export * from './pen';

// Its load-time setup: the page's listeners of these lines, in its order. mount() runs it once, after
// panels', sync's and editing's, before presence's and start().
export function init(): void {
  initUndo();
  initPaste();
  initImage();
  initPen();
}
