// kit-999: wires review's two libs once (spec, The view): the real state objects, so the libs and every other view
// read one value, and the 26 functions review's lines call from outside them. Wiring is assignment, not work: no
// fetch, poll, socket or listener (client.tsx adds the listeners, in an effect). Another view's function is passed
// as an arrow that looks it up at call time, so an import cycle can't hand a lib a binding not yet set; until that
// view is ported its stub throws `not ported: <view>`. index.tsx and client.tsx both import this module, so the
// libs are wired on the server's prerender and in the browser before any view calls them.
import { sha256Js, wireBridge } from '../../lib/review-bridge';
import { onBridge, renderReviewPreview, wireReview } from '../../lib/review-page';
import { shell } from '../shell/state';
import { reviewState } from './state';
import { peeksState } from '../peeks/state';
import { viewerState } from '../viewer/state';
import { goalsState } from '../goals/state';
import { wordsState } from '../words/state';
import { $ } from '../shell/page';
import { empty, esc, subj } from '../../lib/shell-page';
import { rankRow } from '../../lib/words-plain';
import { cardHead, linkOf, nextChip, nextTime, qblock, qinline, qplain, rankWhy, tlink, when, who, words } from '../words';
import { answerPress, cardFields, press, putBackCard } from '../data';
import { markAnswered, seenHash } from '../attachments';
import { peekHide } from '../peeks';
import { openFile } from '../peek-kinds';

// each other view's function is typed by its own signature, so wireReview's typed seams check the arrows

wireBridge({ reviewState, renderReviewPreview, onBridge });

wireReview({
  shell,
  reviewState,
  peeksState,
  viewerState,
  goalsState,
  wordsState,
  $: (...a: Parameters<typeof $>) => $(...a),
  esc,
  subj,
  empty,
  cardHead: (...a: Parameters<typeof cardHead>) => cardHead(...a),
  nextChip: (...a: Parameters<typeof nextChip>) => nextChip(...a),
  nextTime: (...a: Parameters<typeof nextTime>) => nextTime(...a),
  rankWhy: (...a: Parameters<typeof rankWhy>) => rankWhy(...a),
  tlink: (...a: Parameters<typeof tlink>) => tlink(...a),
  when: (...a: Parameters<typeof when>) => when(...a),
  who: (...a: Parameters<typeof who>) => who(...a),
  words: (...a: Parameters<typeof words>) => words(...a),
  qplain: (...a: Parameters<typeof qplain>) => qplain(...a),
  qinline: (...a: Parameters<typeof qinline>) => qinline(...a),
  qblock: (...a: Parameters<typeof qblock>) => qblock(...a),
  linkOf: (...a: Parameters<typeof linkOf>) => linkOf(...a),
  rankRow,
  press: (...a: Parameters<typeof press>) => press(...a),
  cardFields: (...a: Parameters<typeof cardFields>) => cardFields(...a),
  putBackCard: (...a: Parameters<typeof putBackCard>) => putBackCard(...a),
  answerPress: (...a: Parameters<typeof answerPress>) => answerPress(...a),
  markAnswered: (...a: Parameters<typeof markAnswered>) => markAnswered(...a),
  seenHash: (...a: Parameters<typeof seenHash>) => seenHash(...a),
  peekHide: (...a: Parameters<typeof peekHide>) => peekHide(...a),
  openFile: (...a: Parameters<typeof openFile>) => openFile(...a),
  sha256Js,
});
