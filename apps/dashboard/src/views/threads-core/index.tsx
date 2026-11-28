// kit-1003: the threads-core view of the dashboard's / route, ported from index.html (threads-core's lines: the
// thread layer's rules, what the pointer is on, a subject that fits the log, a card's state line, where a card
// opens, the pins, the dock's words, the lens messages). Its logic is the lib's, src/lib/threads-core-rules.ts,
// which ./wire wires once. Threads-core has no markup of its own in index.html: the view renders ThreadsCoreClient,
// which registers its COMPAT globals. Below, every function another view calls from it (APPS.md, The view stubs'
// exports), each a hoisted function that calls the lib at call time.
import './wire';
import * as C from '../../lib/threads-core-rules';
import ThreadsCoreClient from './client';
export default function View() {
  return <ThreadsCoreClient />;
}

export function parseSettingView(...a: Parameters<typeof C.parseSettingView>): ReturnType<typeof C.parseSettingView> {
  return C.parseSettingView(...a);
}

export function parseSuggView(...a: Parameters<typeof C.parseSuggView>): ReturnType<typeof C.parseSuggView> {
  return C.parseSuggView(...a);
}

export function suggView(...a: Parameters<typeof C.suggView>): ReturnType<typeof C.suggView> {
  return C.suggView(...a);
}

export function tArtPath(...a: Parameters<typeof C.tArtPath>): ReturnType<typeof C.tArtPath> {
  return C.tArtPath(...a);
}

export function tBytes(...a: Parameters<typeof C.tBytes>): ReturnType<typeof C.tBytes> {
  return C.tBytes(...a);
}

export function tCardState(...a: Parameters<typeof C.tCardState>): ReturnType<typeof C.tCardState> {
  return C.tCardState(...a);
}

export function tCut(...a: Parameters<typeof C.tCut>): ReturnType<typeof C.tCut> {
  return C.tCut(...a);
}

export function tFit(...a: Parameters<typeof C.tFit>): ReturnType<typeof C.tFit> {
  return C.tFit(...a);
}

export function tFrameOn(...a: Parameters<typeof C.tFrameOn>): ReturnType<typeof C.tFrameOn> {
  return C.tFrameOn(...a);
}

export function tFrameTitle(...a: Parameters<typeof C.tFrameTitle>): ReturnType<typeof C.tFrameTitle> {
  return C.tFrameTitle(...a);
}

export function tGoRoute(...a: Parameters<typeof C.tGoRoute>): ReturnType<typeof C.tGoRoute> {
  return C.tGoRoute(...a);
}

export function tKey(...a: Parameters<typeof C.tKey>): ReturnType<typeof C.tKey> {
  return C.tKey(...a);
}

export function tLanded(...a: Parameters<typeof C.tLanded>): ReturnType<typeof C.tLanded> {
  return C.tLanded(...a);
}

export function tLensMessage(...a: Parameters<typeof C.tLensMessage>): ReturnType<typeof C.tLensMessage> {
  return C.tLensMessage(...a);
}

export function tLine(...a: Parameters<typeof C.tLine>): ReturnType<typeof C.tLine> {
  return C.tLine(...a);
}

export function tOverlay(...a: Parameters<typeof C.tOverlay>): ReturnType<typeof C.tOverlay> {
  return C.tOverlay(...a);
}

export function tPendId(...a: Parameters<typeof C.tPendId>): ReturnType<typeof C.tPendId> {
  return C.tPendId(...a);
}

export function tPendingTurn(...a: Parameters<typeof C.tPendingTurn>): ReturnType<typeof C.tPendingTurn> {
  return C.tPendingTurn(...a);
}

export function tPins(...a: Parameters<typeof C.tPins>): ReturnType<typeof C.tPins> {
  return C.tPins(...a);
}

export function tPlace(...a: Parameters<typeof C.tPlace>): ReturnType<typeof C.tPlace> {
  return C.tPlace(...a);
}

export function tSubjectAt(...a: Parameters<typeof C.tSubjectAt>): ReturnType<typeof C.tSubjectAt> {
  return C.tSubjectAt(...a);
}

export function tWhere(...a: Parameters<typeof C.tWhere>): ReturnType<typeof C.tWhere> {
  return C.tWhere(...a);
}
