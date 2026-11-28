// kit-989: later(f, ...args), data's call of another view's async function (spec, The calls into stubs). It calls f
// and gives its result as a promise; a synchronous throw (a stub's "not ported: <view>") becomes a rejected promise,
// as an async function's own throw is, so the caller goes on as index.html's does. No imports and no DOM at import:
// compiled to lib-dist/lib/data-later.js.
// kit-1061: a stub's "not ported: …" throw is a rejection already handled (a no-op catch on it), so a call nobody
// awaits leaves no unhandled rejection while a caller that awaits still gets the error. Any other throw is left
// unhandled, as before, so a real fault is still seen.
export function later<A extends unknown[], R>(f: (...a: A) => R, ...args: A): Promise<Awaited<R>> {
  let r: R;
  try {
    r = f(...args);
  } catch (e) {
    const p: Promise<Awaited<R>> = Promise.reject(e);
    if (e instanceof Error && e.message.startsWith('not ported: ')) p.catch(() => {});
    return p;
  }
  return (async (): Promise<Awaited<R>> => await r)();
}
