// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;

// kit-1006: the terminal tabs' fixed values (index.html's term-js lines): the library's address and hashes, the two
// tabs, the poll's timings, the size limits, the Wide key, a page's id and a refusal's words. Imports nothing.

// ---- the Supervisor and Shell tabs (kit-614; terminal@1, test/contracts/terminal.md) ----
// A snapshot relay: the screen is read from GET /api/term/<which>/screen while its tab is on screen, drawn with
// xterm.js (pinned, integrity-checked, loaded on the first open), and the keys go to POST …/keys, one post in
// flight per tab, never retried. TERM: the page's token and why the tabs are off (a refusal's why), this page's
// id (terminal@1 §8), whether the hub said its frame is hidden, and each tab's state (termTab).
export const TERM_LIB = {
  js: 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js', jsSri: 'sha384-M169f14mRZOXm3hD/v2Ti0ThIT/RnAQagXA9nlE15yHAtrW19gdePJh/HaTzUOe/',
  css: 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css', cssSri: 'sha384-8Xk9wy/gzEDUKrXtrmCFa2bBuK3BpjpDuL/p0SeKQX19Khl/M+lHOgD/CyYf7efP',
};
export const TERM_IDS = ['supervisor', 'shell'];
export const isTermTab = (id: Loose) => TERM_IDS.includes(id);
// The poll (design, Polling): 150 ms; a read over 300 ms doubles it up to 2 s, a fast one brings it back; 5 s while
// the supervisor isn't running. A key post carries at most 4096 bytes; a body over 100 KB is refused here.
export const TERM_MS = { every: 150, slow: 300, most: 2000, gone: 5000 };
export const TERM_DATA_MAX = 4096, TERM_BODY_MAX = 102400;
export const TERM_WIDE_KEY = 'devteam.threads.wide';
export const termPageId = () => { const a = new Uint8Array(18); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_'); };
// The words for a refusal's why (terminal@1 §4, §5); the code itself is never shown.
export const TERM_WHY_WORDS = {
  'not-loopback': "The terminal tabs only work on this machine's own address.",
  'cross-site': "This browser can't use the terminal tabs: it doesn't say which page a request comes from. A current Chrome, Firefox or Safari does.",
  host: "The terminal tabs only work on the dashboard's own page.",
  relay: "The terminal tabs only work on the dashboard's own page.",
};
