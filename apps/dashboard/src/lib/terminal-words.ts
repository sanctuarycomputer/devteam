// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;

// kit-1006: a refused post's words (index.html's term-js lines). Imports nothing.

// A refused post's words: the server's plain words (terminal@1 §4), else what happened.
export function termWords(r: Loose, j: Loose) {
  if (!r) return "The dashboard didn't answer, so nothing more was sent.";
  if (r.status === 503) return 'The terminal is busy. Try again in a moment.';
  if (r.status === 413) return 'That is too large to send, so nothing was sent.';
  // the server's own words only for a refusal the contract names (4xx); a 5xx's text may be an exception's
  if (r.status >= 500) return 'The dashboard had a problem, so nothing more was sent.';
  return typeof j?.error === 'string' && j.error ? `${j.error[0].toUpperCase()}${j.error.slice(1)}.`.replace(/\.\.$/, '.') : 'The dashboard refused that, so nothing more was sent.';
}
