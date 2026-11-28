// kit-997: wires the peeks cache (src/lib/peeks-cache.ts, which imports no code) once, at load: the two state objects
// it reads, and the two functions it calls, each wrapped in an arrow so an import cycle can't hand it an unset binding
// (cast: their parameters are fixed, and a spread into them is TS2556, as in ruling m-20261128-054038815).
// index.tsx and client.tsx import this file.
import { wirePeeksCache } from '../../lib/peeks-cache';
import { oaPaint } from '../words';
import { wordsState } from '../words/state';
import { redraw } from './drawer';
import { peeksState } from './state';
// `Loose` is `any`: index.html's values have no declared types.
type Loose = any;

wirePeeksCache({
  peeksState,
  wordsState,
  redraw: (...a: Loose[]) => (redraw as Loose)(...a),
  oaPaint: (...a: Loose[]) => (oaPaint as Loose)(...a),
});
