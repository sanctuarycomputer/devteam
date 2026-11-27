// canvas-sync (kit-1015): canvas.html 1659-2237 and 4452-4724 as TypeScript modules. The socket and
// the two copies (base and pending), ops applied to a document, edits and their split over 64 KB, and
// the `select` sender. Every declaration is exported (other sections import what they use); the
// bindings they read are on `shared` (`sync.shared.<name>`). The page ran none of this section's code
// at load, so init() does nothing.
export * from './shared';
export * from './ids';
export * from './ops';
export * from './copies';
export * from './split';
export * from './socket';

// Its load-time setup, run once by the page mount before start(): the page had none in these lines.
export function init(): void {}
