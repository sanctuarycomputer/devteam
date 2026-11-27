// apps-src@1 Paths: every read of location.pathname goes through appPath(), which strips the
// build's base path, so a path check holds under /next and at the root alike.
// No DOM at import: compiled to lib-dist/shared/paths.js and unit-tested there.

/** The base path this build was made with ('' at the root, '/next' for the alpha). */
export const BASE_PATH: string = process.env.DEVTEAM_BASE_PATH ?? '';

/**
 * The path within the app: `pathname` (by default the page's own) without `base`.
 * `/next/view/canvas/x` with base `/next` is `/view/canvas/x`; `/next` and `/next/` are `/`.
 * A path outside the base (`/nextish`, `/other`) comes back as it is.
 */
export function appPath(pathname?: string, base: string = BASE_PATH): string {
  const p = pathname ?? (globalThis as { location?: { pathname?: string } }).location?.pathname ?? '/';
  const path = p === '' ? '/' : p;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  if (!b) return path;
  if (path === b) return '/';
  if (path.startsWith(`${b}/`)) return path.slice(b.length);
  return path;
}
