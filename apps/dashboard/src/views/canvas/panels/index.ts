// canvas-panels (kit-1014): the Layers tree and selection, the Properties panel and its fields, zoom and
// pan, the Pages and page edits (canvas.html 1059-1658, 2238-2629), as modules. Every declaration of each
// is exported from here, for core and the other sections; `shared` holds the bindings other sections
// read or assign (kit-1013's rule: `panels.shared.<name>`).
import { initLayers } from './layers';
import { initZoom } from './zoom';
import { initPages } from './pages';

export * from './held';
export * from './layers';
export * from './zoom';
export * from './pages';
export * from './fields';

// Its load-time setup: the page's listeners of these lines, in its order. mount() runs it once, before
// the other sections' and start().
export function init(): void {
  initLayers();
  initZoom();
  initPages();
}
