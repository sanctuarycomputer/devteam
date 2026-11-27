// apps-src@1 The compatibility surface: every window global a test calls (COMPAT.md) is
// registered once, by the view that owns it, through expose(), at the top level of the view's module:
// evaluated once per page load, before any test can call it, and never again on a remount. No DOM at
// import: compiled to lib-dist/shared/compat.js and unit-tested there with a plain object as the window.
//
// A global COMPAT.md lists as a value (top-level state the page reassigns, such as the hub's box and term)
// is not exposed: its view defines it at module top level with
// Object.defineProperty(window, name, { get, set, configurable: false }) over its own variable (APPS.md,
// Shared code). Like expose(), it does that only when a window exists: guard it with
// typeof window !== 'undefined', or the build's prerender on Node throws a ReferenceError.

type Fn = (...args: never[]) => unknown;

const NAME = /^[A-Za-z_$][\w$]*$/;

/**
 * Sets `target[name] = fn` (target: the page's window). Throws, changing nothing, when the name
 * isn't an identifier, fn isn't a function, or the target already holds the name itself: an earlier
 * expose(), or one of the window's own properties (`open`, `close`). A second registration is a bug.
 * With no window (the build prerendering the page on Node) it registers nothing.
 */
export function expose(name: string, fn: Fn, target: object | undefined = (globalThis as { window?: object }).window): void {
  if (typeof name !== 'string' || !NAME.test(name)) throw new TypeError(`expose: ${JSON.stringify(name)} is not a global name`);
  if (typeof fn !== 'function') throw new TypeError(`expose: ${name} needs a function`);
  if (target === undefined) return;
  // Only a name the window itself already holds is refused. One it only inherits is shadowed: Chrome's
  // EventTarget.prototype.when, under the pages' own top-level `const when` that tests call.
  if (Object.prototype.hasOwnProperty.call(target, name)) throw new Error(`expose: ${name} is already registered`);
  // writable, as a page's top-level function is today: a test may still wrap one
  (target as Record<string, unknown>)[name] = fn;
}
