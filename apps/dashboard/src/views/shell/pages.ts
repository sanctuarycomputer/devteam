// kit-988: the registry (spec, Where each part goes). index.html's 14 registerPage calls, in its order, from
// PAGES. Imported by index.tsx (the server, for the nav) and by page.ts (the browser, for showPage): each
// environment registers once, when it evaluates this module, before any view's module runs. Imports no view.
import { registerPage } from '../../shared/shell/shell';
import { PAGES } from '../../lib/shell-page';

let registered = false;
if (!registered) {
  registered = true;
  for (const p of PAGES) registerPage({ ...p, count: () => null, render: () => {} });
}
