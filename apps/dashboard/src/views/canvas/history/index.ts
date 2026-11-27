// apps-src@1 view stub: canvas-history
// Its port replaces this folder. Until then every function another part of the canvas calls from it, and every binding it shares (on `shared`), throws "not ported: canvas-history".

export function coalesceEntry(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function copy(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function dragEntry(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function drawPen(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function dropPen(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function finishPen(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function makeEntry(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function penPoint(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function pushEntry(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function same(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function stored(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function subtreeIds(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export function undo(..._args: unknown[]): never {
  throw new Error('not ported: canvas-history');
}

export const shared = {
  get undos(): any { throw new Error('not ported: canvas-history'); },
  set undos(_v: any) { throw new Error('not ported: canvas-history'); },
};

// Its load-time setup (listeners), run once by the page mount before start().
export function init(): void {}
