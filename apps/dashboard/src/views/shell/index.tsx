// The shell, the root view of the dashboard's / route (kit-988), ported from index.html. A server module:
// its markup is rendered once into the export and never redrawn. Below it, typed, is every function another
// view of the page calls from it (APPS.md, The view stubs).
import '../../shared/layout/layout.css';
import './shell.css';
import * as ShellJs from '../../shared/shell/shell';
import '../../lib/shell-routes';
import * as Page from '../../lib/shell-page';
import '../../lib/shell-view-only';
import './state';
import './pages';
import * as Glue from './page';
import ShellClient from './client';
import Overview from '../overview';
import Goals from '../goals';
import Board from '../board';
import Library from '../library';
import Loop from '../loop';
import Autonomy from '../autonomy';
import Settings from '../settings';
import Review from '../review';
import Peeks from '../peeks';
import Viewer from '../viewer';
import ThreadsPanel from '../threads-panel';
import Data from '../data';
import Words from '../words';
import PeekKinds from '../peek-kinds';
import Attachments from '../attachments';
import ThreadsCore from '../threads-core';
import Thread from '../thread';
import Terminal from '../terminal';

// index.html's viewport meta (re-exported by app/page.tsx: Next writes it in place of its default).
export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

// index.html's frame guard, as is, first in <body>: it runs before Next's runtime scripts, so when a page of
// this origin frames the dashboard, window.stop() leaves nothing below it to run. Then .shell goes on <body>
// before the content paints (layout.tsx isn't the shell's).
const FRAME_GUARD = `
// Framed by a page of its own origin (frameElement is null under any other parent, so the hub and the
// owner's wrapper are untouched): a preview's app or an artifact's page that sent its frame here. The
// owner's pointer is under it and this page has the owner's powers, so it draws one line and stops:
// window.stop ends the parser, so nothing below runs, and nothing is fetched.
try {
  if (window.frameElement) {
    window.stop();
    document.documentElement.innerHTML = '<head><meta charset="utf-8"><title>devteam</title></head><body style="font:16px system-ui,sans-serif;padding:24px">Open the dashboard in its own tab</body>';
  }
} catch {}
document.body.classList.add('shell');
`;

// The side bar's nav for one group, drawn from the registry's table as the old script drew it at load.
function Nav({ group }: { group: string }) {
  return (
    <nav className="nav" data-group={group}>
      {Page.PAGES.filter((pg) => pg.group === group).map((pg) => (
        <a key={pg.id} href={`#${pg.id}`}>
          <span className="nl"><i className={`icon-${pg.icon}`} aria-hidden="true"></i>{pg.title}</span>
          {Page.PAGE_COUNT_ID[pg.id] ? <>{' '}<span className="count" id={Page.PAGE_COUNT_ID[pg.id]}></span></> : null}
        </a>
      ))}
    </nav>
  );
}

export default function Shell() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" precedence="default" />
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lucide-static@0.460.0/font/lucide.css" precedence="default" />
      <script dangerouslySetInnerHTML={{ __html: FRAME_GUARD }} />
      <div className="app" data-view="shell">
        {/* html-side start */}
        <aside className="side" aria-label="Navigation">
          <div className="brand"><span className="dot"></span><b id="title">devteam</b><span className="badge kit" id="kit" hidden></span></div>
          <div className="eyebrow">Project</div>
          <Nav group="project" />
          <div className="eyebrow">Autonomy</div>
          <Nav group="autonomy" />
          <div className="settings" role="group" aria-label="Fleet settings">
            <div id="side-fleet" data-fleet-slot="switch"></div>
            <div id="side-state" className="fleet-state" data-fleet-slot="state"></div>
            <a className="set" href="#settings"><i className="icon-settings" aria-hidden="true"></i>Settings</a>
            <div className="foot"><span id="when"></span>{' '}<span id="saving" className="muted" role="status" hidden>· saving…</span><br /><span id="logline"></span><br /><span className="err" id="err"></span></div>
          </div>
        </aside>
        {/* html-side end */}
        <div className="main">
          {/* html-pagebar start */}
          <header className="pagebar"><h1 id="page-title">Overview</h1><span className="extra"></span><button className="ghost tt" id="inbox-btn" type="button" title="Open questions"><i className="icon-inbox" aria-hidden="true"></i>Inbox{' '}<span className="n q" id="inbox-btn-n"></span></button></header>
          {/* html-pagebar end */}
          <main className="page waiting">
            <div className="banner" id="banner" role="alert" hidden></div>
            <div className="banner updated" id="updated" role="status" hidden>The dashboard was updated since this tab opened, so some of what you see may be out of date.{' '}<button id="reload-page">Reload</button></div>
            <button className="held" id="held" type="button" tabIndex={-1} hidden>New data. Click to refresh</button>
            <div className="stale-note" id="stale" role="status" hidden></div>
            <p className="loading" id="loading">Loading…</p>
            <Overview />
            <Goals />
            <Board />
            <Library />
            <Loop />
            <Autonomy />
            <Settings />
            <Review />
          </main>
        </div>
      </div>
      <Peeks />
      <Viewer />
      <ThreadsPanel />
      <Data />
      <Words />
      <PeekKinds />
      <Attachments />
      <ThreadsCore />
      <Thread />
      <Terminal />
      <ShellClient />
    </>
  );
}

// ---- called by other views (APPS.md): hoisted function declarations, bound before any module body runs, so a
// view in the cycle (spec, The cycle) may call them at its top level; each delegates to a module importing no view
// (or, for page.ts, calling views only inside its functions) ----
export function bindDbTable(...a: Parameters<typeof ShellJs.bindDbTable>): ReturnType<typeof ShellJs.bindDbTable> {
  return ShellJs.bindDbTable(...a);
}

export function bindFleetSwitch(...a: Parameters<typeof ShellJs.bindFleetSwitch>): ReturnType<typeof ShellJs.bindFleetSwitch> {
  return ShellJs.bindFleetSwitch(...a);
}

export function bindTabBar(...a: Parameters<typeof ShellJs.bindTabBar>): ReturnType<typeof ShellJs.bindTabBar> {
  return ShellJs.bindTabBar(...a);
}

export function closeTarget(...a: Parameters<typeof ShellJs.closeTarget>): ReturnType<typeof ShellJs.closeTarget> {
  return ShellJs.closeTarget(...a);
}

export function dbTable(...a: Parameters<typeof ShellJs.dbTable>): ReturnType<typeof ShellJs.dbTable> {
  return ShellJs.dbTable(...a);
}

export function decSubject(...a: Parameters<typeof Page.decSubject>): ReturnType<typeof Page.decSubject> {
  return Page.decSubject(...a);
}

export function dur(...a: Parameters<typeof Page.dur>): ReturnType<typeof Page.dur> {
  return Page.dur(...a);
}

export function empty(...a: Parameters<typeof Page.empty>): ReturnType<typeof Page.empty> {
  return Page.empty(...a);
}

export function esc(...a: Parameters<typeof Page.esc>): ReturnType<typeof Page.esc> {
  return Page.esc(...a);
}

export function fleetSwitch(...a: Parameters<typeof ShellJs.fleetSwitch>): ReturnType<typeof ShellJs.fleetSwitch> {
  return ShellJs.fleetSwitch(...a);
}

export function fmtDate(...a: Parameters<typeof Page.fmtDate>): ReturnType<typeof Page.fmtDate> {
  return Page.fmtDate(...a);
}

export function goalSteps(...a: Parameters<typeof ShellJs.goalSteps>): ReturnType<typeof ShellJs.goalSteps> {
  return ShellJs.goalSteps(...a);
}

export function headFor(...a: Parameters<typeof ShellJs.headFor>): ReturnType<typeof ShellJs.headFor> {
  return ShellJs.headFor(...a);
}

export function heartbeat(...a: Parameters<typeof ShellJs.heartbeat>): ReturnType<typeof ShellJs.heartbeat> {
  return ShellJs.heartbeat(...a);
}

export function isDone(...a: Parameters<typeof Page.isDone>): ReturnType<typeof Page.isDone> {
  return Page.isDone(...a);
}

export function nextSort(...a: Parameters<typeof ShellJs.nextSort>): ReturnType<typeof ShellJs.nextSort> {
  return ShellJs.nextSort(...a);
}

export function parseHead(...a: Parameters<typeof ShellJs.parseHead>): ReturnType<typeof ShellJs.parseHead> {
  return ShellJs.parseHead(...a);
}

export function pct(...a: Parameters<typeof Page.pct>): ReturnType<typeof Page.pct> {
  return Page.pct(...a);
}

export function props(...a: Parameters<typeof ShellJs.props>): ReturnType<typeof ShellJs.props> {
  return ShellJs.props(...a);
}

export function rememberedFilters(...a: Parameters<typeof ShellJs.rememberedFilters>): ReturnType<typeof ShellJs.rememberedFilters> {
  return ShellJs.rememberedFilters(...a);
}

export function saveFilters(...a: Parameters<typeof ShellJs.saveFilters>): ReturnType<typeof ShellJs.saveFilters> {
  return ShellJs.saveFilters(...a);
}

export function sectionPage(...a: Parameters<typeof Glue.sectionPage>): ReturnType<typeof Glue.sectionPage> {
  return Glue.sectionPage(...a);
}

export function shellPages(...a: Parameters<typeof ShellJs.shellPages>): ReturnType<typeof ShellJs.shellPages> {
  return ShellJs.shellPages(...a);
}

export function shellText(...a: Parameters<typeof ShellJs.shellText>): ReturnType<typeof ShellJs.shellText> {
  return ShellJs.shellText(...a);
}

export function showPage(...a: Parameters<typeof Glue.showPage>): ReturnType<typeof Glue.showPage> {
  return Glue.showPage(...a);
}

export function stampFor(...a: Parameters<typeof ShellJs.stampFor>): ReturnType<typeof ShellJs.stampFor> {
  return ShellJs.stampFor(...a);
}

export function statusPill(...a: Parameters<typeof ShellJs.statusPill>): ReturnType<typeof ShellJs.statusPill> {
  return ShellJs.statusPill(...a);
}

export function storedFilters(...a: Parameters<typeof ShellJs.storedFilters>): ReturnType<typeof ShellJs.storedFilters> {
  return ShellJs.storedFilters(...a);
}

export function subj(...a: Parameters<typeof Page.subj>): ReturnType<typeof Page.subj> {
  return Page.subj(...a);
}

export function tabBar(...a: Parameters<typeof ShellJs.tabBar>): ReturnType<typeof ShellJs.tabBar> {
  return ShellJs.tabBar(...a);
}

export function ttPeekPlace(...a: Parameters<typeof Glue.ttPeekPlace>): ReturnType<typeof Glue.ttPeekPlace> {
  return Glue.ttPeekPlace(...a);
}

export function viewOnly(...a: Parameters<typeof Glue.viewOnly>): ReturnType<typeof Glue.viewOnly> {
  return Glue.viewOnly(...a);
}

export function viewToast(...a: Parameters<typeof Glue.viewToast>): ReturnType<typeof Glue.viewToast> {
  return Glue.viewToast(...a);
}

export function withPage(...a: Parameters<typeof ShellJs.withPage>): ReturnType<typeof ShellJs.withPage> {
  return ShellJs.withPage(...a);
}
