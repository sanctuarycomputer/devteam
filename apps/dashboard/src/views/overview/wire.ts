// kit-991: wires overview's hello lib once: the real state objects, so the lib and every other view read one value
// (shell.DATA, shell.PAGE_NOW, overviewState.HELLO), and the three functions its block calls from outside it.
// Wiring is assignment, not work: no fetch, poll or listener. Another view's function is passed as an arrow that
// looks it up at call time, so an import cycle can't hand the lib a binding not yet set; until library is ported
// its stub throws `not ported: library`. index.tsx and client.tsx both import this module, so the lib is wired on
// the server's prerender and in the browser before any view calls it.
import { wireHello } from '../../lib/overview-hello';
import { esc } from '../../lib/shell-page';
import { renderLibrary } from '../library';
import { shell } from '../shell/state';
import { renderOverview } from './render';
import { overviewState } from './state';

// `Loose` is `any`: the stubs take unknown[]; the lib's seams are untyped
type Loose = any;

wireHello({
  shell,
  overviewState,
  esc,
  renderOverview: (...a: Loose[]) => (renderOverview as Loose)(...a),
  renderLibrary: (...a: Loose[]) => renderLibrary(...a),
});
