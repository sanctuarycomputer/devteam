'use client';
// kit-1003: threads-core's client code (spec, The view). Its top level runs once when its chunk loads in the
// browser and registers threads-core's 9 COMPAT globals, each the lib's own function. expose() registers nothing
// on the server. ThreadsCoreClient renders nothing: threads-core has no markup of its own in index.html.
import { expose } from '../../shared/compat';
import * as C from '../../lib/threads-core-rules';
import './wire';

expose('tCardState', C.tCardState);
expose('tFrameOn', C.tFrameOn);
expose('tKey', C.tKey);
expose('tLensMessage', C.tLensMessage);
expose('tOverlay', C.tOverlay);
expose('tPendingThread', C.tPendingThread);
expose('tPlace', C.tPlace);
expose('tSubjectAt', C.tSubjectAt);
expose('tWhere', C.tWhere);

export default function ThreadsCoreClient(): null {
  return null;
}
