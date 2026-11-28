'use client';
// kit-997: peeks' client code. Its top level runs once when its chunk loads in the browser. It wires the peeks cache
// (./wire), registers peeks' 9 COMPAT globals and the 7 drawer functions the kit's tests call in the page (spec, The
// globals), each the binding peeks' own modules use, and designBlock. It defines DRAWER, PEEKS, LAST_HTML and TYPE_META
// on window as accessors over peeksState (compat.ts: a test reads and sets the value, the view reads the state). It also
// puts the bundled libraries for index.html's guarded markdown on the page: DOMPurify (exposed) and marked (a plain
// value, since expose() takes only functions). expose() registers nothing on the server, and the guarded block doesn't
// run there. Peeks starts no work of its own: a click opens the drawer. PeeksClient renders nothing.
import './wire';
import DOMPurify from 'dompurify';
import * as marked from 'marked';
import { expose } from '../../shared/compat';
import { peekKey } from '../../lib/peeks-cache';
import { closeDrawer, drawerFor, focusKey, OPENERS, peekFor, peekHide, peekIsOpen, redraw, refreshDrawer, showDrawer } from './drawer';
import { historySection } from './history';
import { designBlock, notFound } from './pieces';
import { attrs, list, storedRows } from './props';
import { peeksState } from './state';
// `Loose` is `any`: index.html's values have no declared types.
type Loose = any;

expose('focusKey', focusKey);
expose('list', list);
expose('OPENERS', OPENERS);
expose('peekFor', peekFor);
expose('peekIsOpen', peekIsOpen);
expose('peekKey', peekKey);
expose('redraw', redraw);
expose('refreshDrawer', refreshDrawer);
expose('storedRows', storedRows);
expose('drawerFor', drawerFor);
expose('showDrawer', showDrawer);
expose('peekHide', peekHide);
expose('closeDrawer', closeDrawer);
expose('notFound', notFound);
expose('historySection', historySection);
expose('attrs', attrs);
expose('designBlock', designBlock);
expose('DOMPurify', DOMPurify);

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'marked', { value: marked, writable: true, configurable: true });
  Object.defineProperty(window, 'DRAWER', { get: () => peeksState.DRAWER, set: (v: Loose) => { peeksState.DRAWER = v; }, configurable: false });
  Object.defineProperty(window, 'PEEKS', { get: () => peeksState.PEEKS, set: (v: Loose) => { peeksState.PEEKS = v; }, configurable: false });
  Object.defineProperty(window, 'LAST_HTML', { get: () => peeksState.LAST_HTML, set: (v: Loose) => { peeksState.LAST_HTML = v; }, configurable: false });
  Object.defineProperty(window, 'TYPE_META', { get: () => peeksState.TYPE_META, set: (v: Loose) => { peeksState.TYPE_META = v; }, configurable: false });
}

export default function PeeksClient(): null {
  return null;
}
