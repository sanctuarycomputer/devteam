// kit-990: wires words's lib once (spec, The view): the real state objects, so the lib and every other view read
// one value, and the 16 functions words's lines call from outside them. Wiring is assignment, not work: no fetch,
// poll, socket or listener. Another view's function is passed as an arrow that looks it up at call time, so an
// import cycle can't hand the lib a binding not yet set; until that view is ported its stub throws
// `not ported: <view>`. index.tsx and client.tsx both import this module, so the lib is wired on the server's
// prerender and in the browser before any view calls it.
import { wireWords } from '../../lib/words-plain';
import { shell } from '../shell/state';
import { wordsState } from './state';
import { attachmentsState } from '../attachments/state';
import { dataState } from '../data/state';
import { esc, subj } from '../../lib/shell-page';
import { ownerLesson } from '../../lib/data-inbox';
import { chipsHtml, dropBox, isFilled, qcardOf } from '../attachments';
import { previewHere, previewLinkHtml } from '../library';
import { focusBack, focusMark, peekOf } from '../peeks';
import { reviewCard } from '../review';
import { NEXT_ID } from '../overview';
import { artViewer, pvViewer } from '../viewer';

// `Loose` is `any`: the stubs take unknown[] and the ported views' own types differ; the lib's seams are untyped
type Loose = any;

wireWords({
  shell,
  wordsState,
  attachmentsState,
  dataState,
  esc,
  subj,
  ownerLesson,
  dropBox: (...a: Loose[]) => dropBox(...a),
  chipsHtml: (...a: Loose[]) => chipsHtml(...a),
  isFilled: (...a: Loose[]) => isFilled(...a),
  qcardOf: (...a: Loose[]) => qcardOf(...a),
  previewHere: (...a: Loose[]) => previewHere(...a),
  previewLinkHtml: (...a: Loose[]) => previewLinkHtml(...a),
  focusMark: (...a: Loose[]) => focusMark(...a),
  focusBack: (...a: Loose[]) => focusBack(...a),
  peekOf: (...a: Loose[]) => peekOf(...a),
  reviewCard: (...a: Loose[]) => reviewCard(...a),
  NEXT_ID: (...a: Loose[]) => NEXT_ID(...a),
  artViewer: (...a: Loose[]) => artViewer(...a),
  pvViewer: (...a: Loose[]) => pvViewer(...a),
});
