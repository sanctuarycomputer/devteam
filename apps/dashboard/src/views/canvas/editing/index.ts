// apps-src@1 view stub: canvas-editing
// Its port replaces this folder. Until then every function another part of the canvas calls from it, and every binding it shares (on `shared`), throws "not ported: canvas-editing".

export function addNode(..._args: unknown[]): never {
  throw new Error('not ported: canvas-editing');
}

export function dragWaiting(..._args: unknown[]): never {
  throw new Error('not ported: canvas-editing');
}

export function drawHandles(..._args: unknown[]): never {
  throw new Error('not ported: canvas-editing');
}

export function editFields(..._args: unknown[]): never {
  throw new Error('not ported: canvas-editing');
}

export function hasBox(..._args: unknown[]): never {
  throw new Error('not ported: canvas-editing');
}

export function keepDrag(..._args: unknown[]): never {
  throw new Error('not ported: canvas-editing');
}

export function placeAt(..._args: unknown[]): never {
  throw new Error('not ported: canvas-editing');
}

export function setTool(..._args: unknown[]): never {
  throw new Error('not ported: canvas-editing');
}

export function toolsOn(..._args: unknown[]): never {
  throw new Error('not ported: canvas-editing');
}

export const shared = {
  get gesture(): any { throw new Error('not ported: canvas-editing'); },
  set gesture(_v: any) { throw new Error('not ported: canvas-editing'); },
  get IMAGE_BYTES(): any { throw new Error('not ported: canvas-editing'); },
  set IMAGE_BYTES(_v: any) { throw new Error('not ported: canvas-editing'); },
  get IMAGE_SAY(): any { throw new Error('not ported: canvas-editing'); },
  set IMAGE_SAY(_v: any) { throw new Error('not ported: canvas-editing'); },
  get pen(): any { throw new Error('not ported: canvas-editing'); },
  set pen(_v: any) { throw new Error('not ported: canvas-editing'); },
  get placing(): any { throw new Error('not ported: canvas-editing'); },
  set placing(_v: any) { throw new Error('not ported: canvas-editing'); },
  get tool(): any { throw new Error('not ported: canvas-editing'); },
  set tool(_v: any) { throw new Error('not ported: canvas-editing'); },
  get toolPress(): any { throw new Error('not ported: canvas-editing'); },
  set toolPress(_v: any) { throw new Error('not ported: canvas-editing'); },
};

// Its load-time setup (listeners), run once by the page mount before start().
export function init(): void {}
