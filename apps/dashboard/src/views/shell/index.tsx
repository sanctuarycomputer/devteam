// The shell, the root view of the dashboard's / route (kit-988), ported from index.html. A server module:
// its markup is rendered once into the export and never redrawn. Below it, typed, is every function another
// view of the page calls from it (APPS.md, The view stubs).
import '../../shared/layout/layout.css';
import './shell.css';
import { PAGES, PAGE_COUNT_ID } from '../../lib/shell-page';
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
      {PAGES.filter((pg) => pg.group === group).map((pg) => (
        <a key={pg.id} href={`#${pg.id}`}>
          <span className="nl"><i className={`icon-${pg.icon}`} aria-hidden="true"></i>{pg.title}</span>
          {PAGE_COUNT_ID[pg.id] ? <>{' '}<span className="count" id={PAGE_COUNT_ID[pg.id]}></span></> : null}
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
    </>
  );
}

// ---- called by other views (compat-scan --stubs) ----
export function bindDbTable(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function bindFleetSwitch(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function bindTabBar(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function closeTarget(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function dbTable(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function decSubject(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function dur(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function empty(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function esc(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function fleetSwitch(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function fmtDate(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function goalSteps(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function headFor(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function heartbeat(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function isDone(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function nextSort(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function parseHead(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function pct(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function props(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function rememberedFilters(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function saveFilters(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function sectionPage(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function shellPages(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function shellText(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function showPage(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function stampFor(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function statusPill(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function storedFilters(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function subj(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function tabBar(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function ttPeekPlace(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function viewOnly(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function viewToast(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}

export function withPage(..._args: unknown[]): never {
  throw new Error('not ported: shell');
}
