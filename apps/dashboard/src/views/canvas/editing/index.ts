// canvas-editing (kit-1016): components, variants and instances, the tools, Move and the resize handles
// (canvas.html 2630-3572), as modules. Every declaration of each is exported from here, for core and
// the other sections; `shared` holds the bindings other sections read or assign (kit-1013's rule:
// `editing.shared.<name>`).
import { initComponents } from './components';
import { initTools } from './tools';
import { initResize } from './resize';
import { initMove } from './move';

export * from './held';
export * from './components';
export * from './tools';
export * from './resize';
export * from './move';

// Its load-time setup: the page's listeners of these lines, in its order. mount() runs it once, after
// panels' and sync's, before history's, presence's and start().
export function init(): void {
  initComponents();
  initTools();
  initResize();
  initMove();
}
