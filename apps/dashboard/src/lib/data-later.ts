// kit-989: later(f, ...args), data's call of another view's async function (spec, The calls into stubs). It calls f
// and gives its result as a promise; a synchronous throw (a stub's "not ported: <view>") becomes a rejected promise,
// as an async function's own throw is, so the caller goes on as index.html's does. No imports and no DOM at import:
// compiled to lib-dist/lib/data-later.js.
export async function later<A extends unknown[], R>(f: (...a: A) => R, ...args: A): Promise<Awaited<R>> {
  return await f(...args);
}
