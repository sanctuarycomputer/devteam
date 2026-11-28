// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;

// kit-1006: what a screen line may carry into xterm, and bytes (index.html's term-js lines). Imports nothing.

// Hex of bytes, and UTF-8 bytes of a string.
export const termHex = (b: Loose) => Array.from(b, (x: Loose) => x.toString(16).padStart(2, '0')).join('');
export const termBytes = (s: Loose) => new TextEncoder().encode(s);
// What the screen may carry into xterm: SGR only. The server strips the rest (terminal@1 §6); this strips again, C1
// controls too (U+0080-U+009F, the 8-bit CSI among them), so no line can make xterm answer a query (DSR, a mode
// report) and type that answer into the pane without a key press.
export const TERM_ESC = /\x1b(?:\[([0-9;:]*)m|\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|[\]PX^_](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\|$)|[\x20-\x2f]*[\s\S]?)/g;
export const termSafe = (l: Loose) => String(l ?? '').replace(TERM_ESC, (m: Loose, sgr: Loose) => (sgr === undefined ? '' : m)).replace(/[\x00-\x1a\x1c-\x1f\x7f-\x9f]/g, '');
export const termText = (l: Loose) => termSafe(l).replace(/\x1b\[[0-9;:]*m/g, '');
