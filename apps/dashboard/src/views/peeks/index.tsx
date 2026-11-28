// kit-997: the drawer, and the peeks that fill it, of the dashboard's / route, ported from index.html (peeks' lines:
// the css-peek region, the html-drawer markup, and the script's peek and drawer code). A server module: its markup is
// exported once into the page, and the script writes into it, as index.html's does. Below, every function another view
// calls from it (APPS.md, The view stubs' exports): each a hoisted function that calls peeks' module at call time.
// Peeks' modules import other views, so call these from a function another view runs later, never at its top level.
import './peeks.css';
import './wire';
import * as Drawer from './drawer';
import * as Props from './props';
import * as Pieces from './pieces';
import * as History from './history';
import * as Cache from '../../lib/peeks-cache';
import PeeksClient from './client';
// `Loose` is `any`: index.html's values have no declared types.
type Loose = any;

export default function View() {
  return (
    <>
      <div className="scrim" id="scrim" hidden></div>
      <aside className="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-bar-title" hidden>
        {/* ui-candidate: card (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup) */}
        <div className="drawer-head"><h2 id="drawer-bar-title"></h2><span className="end">{/* ui-candidate: button (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup) */}<button className="ghost icon-btn" id="drawer-close" aria-label="Close"><i className="icon-x" aria-hidden="true"></i></button></span></div>
        <div className="drawer-body" id="drawer-body"></div>
      </aside>
      {/* the page bar's top-right button, mirrored above the scrim beside an open peek (kit-88 spec §2.1) */}
      <button className="ghost tt" id="tt-peek" type="button"></button>
      <PeeksClient />
    </>
  );
}

export function attrRow(...a: Parameters<typeof Props.attrRow>): ReturnType<typeof Props.attrRow> {
  return Props.attrRow(...a);
}

export function attrs(...a: Parameters<typeof Props.attrs>): ReturnType<typeof Props.attrs> {
  return Props.attrs(...a);
}

export function closeDrawer(...a: Parameters<typeof Drawer.closeDrawer>): ReturnType<typeof Drawer.closeDrawer> {
  return Drawer.closeDrawer(...a);
}

export function decisionTitle(...a: Parameters<typeof Props.decisionTitle>): ReturnType<typeof Props.decisionTitle> {
  return Props.decisionTitle(...a);
}

export function depGraph(...a: Parameters<typeof Pieces.depGraph>): ReturnType<typeof Pieces.depGraph> {
  return Pieces.depGraph(...a);
}

export function designBlock(...a: Parameters<typeof Pieces.designBlock>): ReturnType<typeof Pieces.designBlock> {
  return Pieces.designBlock(...a);
}

export function diagram(...a: Parameters<typeof Pieces.diagram>): ReturnType<typeof Pieces.diagram> {
  return Pieces.diagram(...a);
}

export function drawerFor(...a: Parameters<typeof Drawer.drawerFor>): ReturnType<typeof Drawer.drawerFor> {
  return Drawer.drawerFor(...a);
}

export function fetchPeek(...a: Parameters<typeof Cache.fetchPeek>): ReturnType<typeof Cache.fetchPeek> {
  return Cache.fetchPeek(...a);
}

export function fmtDay(...a: Parameters<typeof Props.fmtDay>): ReturnType<typeof Props.fmtDay> {
  return Props.fmtDay(...a);
}

export function fmtObj(...a: Parameters<typeof Props.fmtObj>): ReturnType<typeof Props.fmtObj> {
  return Props.fmtObj(...a);
}

// words/wire.ts:38-40 spreads a Loose[] into it: TS2556 with Parameters<> (ruling m-20261128-054038815)
export function focusBack(...a: Loose[]): ReturnType<typeof Drawer.focusBack> {
  return (Drawer.focusBack as Loose)(...a);
}

// words/wire.ts:38-40 spreads a Loose[] into it: TS2556 with Parameters<> (ruling m-20261128-054038815)
export function focusMark(...a: Loose[]): ReturnType<typeof Drawer.focusMark> {
  return (Drawer.focusMark as Loose)(...a);
}

export function gateTable(...a: Parameters<typeof Pieces.gateTable>): ReturnType<typeof Pieces.gateTable> {
  return Pieces.gateTable(...a);
}

export function historySection(...a: Parameters<typeof History.historySection>): ReturnType<typeof History.historySection> {
  return History.historySection(...a);
}

export function howItChanges(...a: Parameters<typeof Props.howItChanges>): ReturnType<typeof Props.howItChanges> {
  return Props.howItChanges(...a);
}

export function list(...a: Parameters<typeof Props.list>): ReturnType<typeof Props.list> {
  return Props.list(...a);
}

export function loadSchemaDocs(...a: Parameters<typeof Props.loadSchemaDocs>): ReturnType<typeof Props.loadSchemaDocs> {
  return Props.loadSchemaDocs(...a);
}

export function notFound(...a: Parameters<typeof Pieces.notFound>): ReturnType<typeof Pieces.notFound> {
  return Pieces.notFound(...a);
}

export function peekFor(...a: Parameters<typeof Drawer.peekFor>): ReturnType<typeof Drawer.peekFor> {
  return Drawer.peekFor(...a);
}

export function peekHide(...a: Parameters<typeof Drawer.peekHide>): ReturnType<typeof Drawer.peekHide> {
  return Drawer.peekHide(...a);
}

export function peekIsOpen(...a: Parameters<typeof Drawer.peekIsOpen>): ReturnType<typeof Drawer.peekIsOpen> {
  return Drawer.peekIsOpen(...a);
}

export function peekKey(...a: Parameters<typeof Cache.peekKey>): ReturnType<typeof Cache.peekKey> {
  return Cache.peekKey(...a);
}

// words/wire.ts:38-40 spreads a Loose[] into it: TS2556 with Parameters<> (ruling m-20261128-054038815)
export function peekOf(...a: Loose[]): ReturnType<typeof Cache.peekOf> {
  return (Cache.peekOf as Loose)(...a);
}

export function phaseStrip(...a: Parameters<typeof Pieces.phaseStrip>): ReturnType<typeof Pieces.phaseStrip> {
  return Pieces.phaseStrip(...a);
}

export function progressBlock(...a: Parameters<typeof Pieces.progressBlock>): ReturnType<typeof Pieces.progressBlock> {
  return Pieces.progressBlock(...a);
}

export function psect(...a: Parameters<typeof Props.psect>): ReturnType<typeof Props.psect> {
  return Props.psect(...a);
}

export function redraw(...a: Parameters<typeof Drawer.redraw>): ReturnType<typeof Drawer.redraw> {
  return Drawer.redraw(...a);
}

export function refreshDrawer(...a: Parameters<typeof Drawer.refreshDrawer>): ReturnType<typeof Drawer.refreshDrawer> {
  return Drawer.refreshDrawer(...a);
}

export function reviewList(...a: Parameters<typeof Pieces.reviewList>): ReturnType<typeof Pieces.reviewList> {
  return Pieces.reviewList(...a);
}

export function share(...a: Parameters<typeof Props.share>): ReturnType<typeof Props.share> {
  return Props.share(...a);
}

export function showDrawer(...a: Parameters<typeof Drawer.showDrawer>): ReturnType<typeof Drawer.showDrawer> {
  return Drawer.showDrawer(...a);
}

export function spendChart(...a: Parameters<typeof Pieces.spendChart>): ReturnType<typeof Pieces.spendChart> {
  return Pieces.spendChart(...a);
}

export function threadOn(...a: Parameters<typeof Props.threadOn>): ReturnType<typeof Props.threadOn> {
  return Props.threadOn(...a);
}

export function uniq(...a: Parameters<typeof Pieces.uniq>): ReturnType<typeof Pieces.uniq> {
  return Pieces.uniq(...a);
}

export function unitOf(...a: Parameters<typeof Props.unitOf>): ReturnType<typeof Props.unitOf> {
  return Props.unitOf(...a);
}
