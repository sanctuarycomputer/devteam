// apps-src@1 view stub: canvas-presence
// Its port replaces this folder. Until then every function another part of the canvas calls from it, and every binding it shares (on `shared`), throws "not ported: canvas-presence".

export function connectPresence(..._args: unknown[]): never {
  throw new Error('not ported: canvas-presence');
}

export function markEdit(..._args: unknown[]): never {
  throw new Error('not ported: canvas-presence');
}

export function onVisibility(..._args: unknown[]): never {
  throw new Error('not ported: canvas-presence');
}

export function placeOthers(..._args: unknown[]): never {
  throw new Error('not ported: canvas-presence');
}

export function sendHere(..._args: unknown[]): never {
  throw new Error('not ported: canvas-presence');
}

export function takeSelections(..._args: unknown[]): never {
  throw new Error('not ported: canvas-presence');
}

export function unit(..._args: unknown[]): never {
  throw new Error('not ported: canvas-presence');
}

export const shared = {
  get seen(): any { throw new Error('not ported: canvas-presence'); },
  set seen(_v: any) { throw new Error('not ported: canvas-presence'); },
};

// Its load-time setup (listeners), run once by the page mount before start().
export function init(): void {}
