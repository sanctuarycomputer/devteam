// canvas-presence (kit-1018): others on the canvas (presence@1 cursors), others' selections and last
// edits, drawing others, and pins (canvas.html 4725-5470), as modules. Every declaration of each is
// exported from here, for core and the other sections; `shared` holds the binding other sections read
// or assign (kit-1013's rule: `presence.shared.<name>`).
import { initCursors } from './cursors';
import { initDrawing } from './drawing';
import { initPins } from './pins';

export * from './held';
export * from './cursors';
export * from './selections';
export * from './drawing';
export * from './pins';

// Its load-time setup: the page's DOM and listeners of these lines, in its order. mount() runs it once,
// last of the sections' inits, before start().
export function init(): void {
  initCursors();
  initDrawing();
  initPins();
}
