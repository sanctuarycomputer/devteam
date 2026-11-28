// kit-990: the words view of the dashboard's / route, ported from index.html (words's lines: `when` and the plain
// words, the question cards, choicesOf and the answer flow's card side). Its logic is the lib's,
// src/lib/words-plain.ts, which ./wire wires once. Words has no markup of its own in index.html: the view renders
// WordsClient, which registers its COMPAT globals. Below, every function another view calls from it (APPS.md, The
// view stubs' exports), each a hoisted function that calls the lib at call time.
import './words.css';
import './wire';
import * as W from '../../lib/words-plain';
import WordsClient from './client';
export default function View() {
  return <WordsClient />;
}

export function actUnder(...a: Parameters<typeof W.actUnder>): ReturnType<typeof W.actUnder> {
  return W.actUnder(...a);
}

export function actView(...a: Parameters<typeof W.actView>): ReturnType<typeof W.actView> {
  return W.actView(...a);
}

export function allQuestions(...a: Parameters<typeof W.allQuestions>): ReturnType<typeof W.allQuestions> {
  return W.allQuestions(...a);
}

export function answeredCard(...a: Parameters<typeof W.answeredCard>): ReturnType<typeof W.answeredCard> {
  return W.answeredCard(...a);
}

export function approvedBy(...a: Parameters<typeof W.approvedBy>): ReturnType<typeof W.approvedBy> {
  return W.approvedBy(...a);
}

export function artHref(...a: Parameters<typeof W.artHref>): ReturnType<typeof W.artHref> {
  return W.artHref(...a);
}

export function authorityWords(...a: Parameters<typeof W.authorityWords>): ReturnType<typeof W.authorityWords> {
  return W.authorityWords(...a);
}

export function cap(...a: Parameters<typeof W.cap>): ReturnType<typeof W.cap> {
  return W.cap(...a);
}

export function cardHead(...a: Parameters<typeof W.cardHead>): ReturnType<typeof W.cardHead> {
  return W.cardHead(...a);
}

export function cardMenu(...a: Parameters<typeof W.cardMenu>): ReturnType<typeof W.cardMenu> {
  return W.cardMenu(...a);
}

export function choicesOf(...a: Parameters<typeof W.choicesOf>): ReturnType<typeof W.choicesOf> {
  return W.choicesOf(...a);
}

export function dlink(...a: Parameters<typeof W.dlink>): ReturnType<typeof W.dlink> {
  return W.dlink(...a);
}

export function featureTitle(...a: Parameters<typeof W.featureTitle>): ReturnType<typeof W.featureTitle> {
  return W.featureTitle(...a);
}

export function fileHref(...a: Parameters<typeof W.fileHref>): ReturnType<typeof W.fileHref> {
  return W.fileHref(...a);
}

export function flink(...a: Parameters<typeof W.flink>): ReturnType<typeof W.flink> {
  return W.flink(...a);
}

export function glink(...a: Parameters<typeof W.glink>): ReturnType<typeof W.glink> {
  return W.glink(...a);
}

export function goalOf(...a: Parameters<typeof W.goalOf>): ReturnType<typeof W.goalOf> {
  return W.goalOf(...a);
}

export function isOa(...a: Parameters<typeof W.isOa>): ReturnType<typeof W.isOa> {
  return W.isOa(...a);
}

export function keepSecretDrafts(...a: Parameters<typeof W.keepSecretDrafts>): ReturnType<typeof W.keepSecretDrafts> {
  return W.keepSecretDrafts(...a);
}

export function linkify(...a: Parameters<typeof W.linkify>): ReturnType<typeof W.linkify> {
  return W.linkify(...a);
}

export function linkOf(...a: Parameters<typeof W.linkOf>): ReturnType<typeof W.linkOf> {
  return W.linkOf(...a);
}

export function menuOf(...a: Parameters<typeof W.menuOf>): ReturnType<typeof W.menuOf> {
  return W.menuOf(...a);
}

export function milestonesOf(...a: Parameters<typeof W.milestonesOf>): ReturnType<typeof W.milestonesOf> {
  return W.milestonesOf(...a);
}

export function mlink(...a: Parameters<typeof W.mlink>): ReturnType<typeof W.mlink> {
  return W.mlink(...a);
}

export function nextChip(...a: Parameters<typeof W.nextChip>): ReturnType<typeof W.nextChip> {
  return W.nextChip(...a);
}

export function nextTime(...a: Parameters<typeof W.nextTime>): ReturnType<typeof W.nextTime> {
  return W.nextTime(...a);
}

export function oaConfirming(...a: Parameters<typeof W.oaConfirming>): ReturnType<typeof W.oaConfirming> {
  return W.oaConfirming(...a);
}

export function oaOpen(...a: Parameters<typeof W.oaOpen>): ReturnType<typeof W.oaOpen> {
  return W.oaOpen(...a);
}

export function oaPaint(...a: Parameters<typeof W.oaPaint>): ReturnType<typeof W.oaPaint> {
  return W.oaPaint(...a);
}

export function oaSig(...a: Parameters<typeof W.oaSig>): ReturnType<typeof W.oaSig> {
  return W.oaSig(...a);
}

export function oaState(...a: Parameters<typeof W.oaState>): ReturnType<typeof W.oaState> {
  return W.oaState(...a);
}

export function qblock(...a: Parameters<typeof W.qblock>): ReturnType<typeof W.qblock> {
  return W.qblock(...a);
}

export function qinline(...a: Parameters<typeof W.qinline>): ReturnType<typeof W.qinline> {
  return W.qinline(...a);
}

export function qlink(...a: Parameters<typeof W.qlink>): ReturnType<typeof W.qlink> {
  return W.qlink(...a);
}

export function qplain(...a: Parameters<typeof W.qplain>): ReturnType<typeof W.qplain> {
  return W.qplain(...a);
}

export function questionCard(...a: Parameters<typeof W.questionCard>): ReturnType<typeof W.questionCard> {
  return W.questionCard(...a);
}

export function rankWhy(...a: Parameters<typeof W.rankWhy>): ReturnType<typeof W.rankWhy> {
  return W.rankWhy(...a);
}

export function restoreSecretDrafts(...a: Parameters<typeof W.restoreSecretDrafts>): ReturnType<typeof W.restoreSecretDrafts> {
  return W.restoreSecretDrafts(...a);
}

export function rlink(...a: Parameters<typeof W.rlink>): ReturnType<typeof W.rlink> {
  return W.rlink(...a);
}

export function scopeWords(...a: Parameters<typeof W.scopeWords>): ReturnType<typeof W.scopeWords> {
  return W.scopeWords(...a);
}

export function slink(...a: Parameters<typeof W.slink>): ReturnType<typeof W.slink> {
  return W.slink(...a);
}

export function subjectLink(...a: Parameters<typeof W.subjectLink>): ReturnType<typeof W.subjectLink> {
  return W.subjectLink(...a);
}

export function ticketMap(...a: Parameters<typeof W.ticketMap>): ReturnType<typeof W.ticketMap> {
  return W.ticketMap(...a);
}

export function tlink(...a: Parameters<typeof W.tlink>): ReturnType<typeof W.tlink> {
  return W.tlink(...a);
}

export function toB64(...a: Parameters<typeof W.toB64>): ReturnType<typeof W.toB64> {
  return W.toB64(...a);
}

export function when(...a: Parameters<typeof W.when>): ReturnType<typeof W.when> {
  return W.when(...a);
}

export function who(...a: Parameters<typeof W.who>): ReturnType<typeof W.who> {
  return W.who(...a);
}

export function wlink(...a: Parameters<typeof W.wlink>): ReturnType<typeof W.wlink> {
  return W.wlink(...a);
}

export function words(...a: Parameters<typeof W.words>): ReturnType<typeof W.words> {
  return W.words(...a);
}
