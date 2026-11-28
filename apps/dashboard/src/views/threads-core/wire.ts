// kit-1003: wires threads-core's lib once (spec, The view): the real state objects, so the lib reads what the
// views that own them hold (peeks reassigns peeksState.DRAWER; the lib reads it at call time), and the 4 functions
// threads-core's lines call from outside them. Wiring is assignment, not work: no fetch, poll, socket or listener.
// Another view's function is passed as an arrow that looks it up at call time, so an import cycle can't hand the
// lib a binding not yet set; until that view is ported its stub throws `not ported: <view>`. index.tsx and
// client.tsx both import this module, so the lib is wired on the server's prerender and in the browser before any
// view calls it.
import { wireThreadsCore } from '../../lib/threads-core-rules';
import { threadsCoreState } from './state';
import { threadsPanelState } from '../threads-panel/state';
import { peeksState } from '../peeks/state';
import { autonomyState } from '../autonomy/state';
import { govBlockAt } from '../autonomy';
import { who } from '../words';
import { avRecipient, tNoteState } from '../viewer';

// `Loose` is `any`: the stubs take unknown[] and the ported views' own types differ; the lib's seams are untyped
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

wireThreadsCore({
  threadsCoreState,
  threadsPanelState,
  peeksState,
  autonomyState,
  govBlockAt: (...a: Loose[]) => govBlockAt(...a),
  who: (...a: Loose[]) => (who as Loose)(...a),
  tNoteState: (...a: Loose[]) => tNoteState(...a),
  avRecipient: (...a: Loose[]) => avRecipient(...a),
});
