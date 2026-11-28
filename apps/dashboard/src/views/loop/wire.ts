// kit-996: wires loop's two lib modules once (spec, The view): the shell's state object, so the lib reads the one
// DATA every view reads, and the functions their lines call from outside them. Wiring is assignment, not work: no
// fetch, poll, socket or listener. A view's function is passed as an arrow that looks it up at call time, so an
// import cycle can't hand the lib a binding not yet set. index.tsx and client.tsx both import this module, so the
// libs are wired on the server's prerender and in the browser before any view calls them.
import { wireLoopLearning } from '../../lib/loop-learning';
import { wireLoopPlace } from '../../lib/loop-place';
import { DAY, esc, fmtDate } from '../../lib/shell-page';
import { shell } from '../shell/state';
import { linkify, qlink, when, who, words } from '../words';

// `Loose` is `any`: the lib's seams are untyped, as index.html's functions are
type Loose = any;

wireLoopLearning({ DAY, esc, fmtDate });
wireLoopPlace({ shell, esc, linkify: (...a: Loose[]) => linkify(...a), qlink: (...a: Loose[]) => qlink(...a), who: (...a: Loose[]) => who(...a), words: (...a: Loose[]) => words(...a), when: (...a: Loose[]) => when(...a) });
