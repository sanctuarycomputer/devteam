// The hub shell, the root view of the hub's / route (kit-1008), ported from hub.html. A server module: its
// markup (hub.html 484-505) is rendered once into the export and never redrawn; client.tsx boots the glue.
// Below it, typed, is every function another view of the page calls from it (APPS.md, The view stubs).
import '@shared/layout/layout.css';
import './hub-shell.css';
import * as S from '@shared/shell/shell';
import HubShellClient from './client';
import * as Panes from './panes';
import * as Fleet from './fleet';
import * as Route from './route';
import HubOverview from '../hub-overview';
import HubSettings from '../hub-settings';
import HubThreads from '../hub-threads';

// hub.html's title and viewport meta (re-exported by app/page.tsx: Next writes them in place of its own)
export const metadata = { title: 'devteam' };
export const viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

// .shell on <body> before the content paints (layout.tsx isn't the shell's), as hub.html's <body class="shell">
const SHELL_CLASS = "document.body.classList.add('shell');";

export default function HubShell() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SHELL_CLASS }} />
      {/* hub.html's head (1-12), its two links root-absolute: the hub is served at / and under /next */}
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="apple-touch-icon" href="/icon-180.png" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="devteam" />
      <header data-view="hub-shell">
        <nav id="tabs" role="tablist" aria-label="devteam instances"></nav>
      </header>
      {/* the notifications control: kept here, shown in the hub's Settings (its New Inbox items row) */}
      <div id="hub-later" hidden><span id="notify"></span></div>
      <main id="frames"><p id="empty">Looking for devteam dashboards on this machine…</p><section id="overview" hidden aria-label="Overview of every project"><div id="ov-body" className="page"></div><div id="tl-pins" className="tl-pins"></div></section><section id="settings-view" hidden aria-label="This machine's settings"><div id="hub-settings" className="page"></div></section></main>
      <div id="drop-hint" hidden></div>
      {/* the thread layer: outside what the Overview redraws every 10 s (the pins are in its box, beside it) */}
      <div id="tl" className="no-shell" hidden>
        <div id="tl-hl" className="tl-hl" hidden></div>
        <div id="tl-chip" className="tl-chip" hidden></div>
        <div id="tl-cursor" className="tl-cursor" hidden aria-hidden="true"><svg viewBox="0 0 28 36" width="28" height="36"><path d="M14 35C14 35 2 21 2 13a12 12 0 0 1 24 0c0 8-12 22-12 22z" /><circle cx="14" cy="13" r="4.5" /></svg></div>
        <div id="tl-card" className="tl-card" role="dialog" aria-label="A thread with the operator" hidden></div>
        <div id="tl-dock" className="tl-dock">
          <div id="tl-panel" className="tl-panel" hidden>
            {/* ui-candidate: button */}
            <div className="tl-dock-head"><b>Threads</b><span className="grow"></span><button type="button" className="btn ghost" id="tl-pinbtn" aria-pressed="false" title="Point at something on the Overview to start a thread about it: for a phone, or for a long look around">Pin</button><button type="button" className="btn ghost" id="tl-new">New thread</button></div>
            <div id="tl-op" className="tl-op" hidden></div>
            <div id="tl-list"></div>
          </div>
          {/* ui-candidate: button */}
          <button type="button" id="tl-pill" className="btn ghost tl-pill" aria-expanded="false"></button>
        </div>
      </div>
      {/* the hub's other views, mounted once and kept out of the layout until each is ported (kit-1008 A16) */}
      <div className="hub-views" hidden><HubOverview /><HubSettings /><HubThreads /></div>
      <HubShellClient />
    </>
  );
}

// ---- called by other views (APPS.md, the hub-shell section) ----
export function bindFleetSwitch(...a: Parameters<typeof S.bindFleetSwitch>): ReturnType<typeof S.bindFleetSwitch> { return S.bindFleetSwitch(...a); }

export function fleetSwitch(...a: Parameters<typeof S.fleetSwitch>): ReturnType<typeof S.fleetSwitch> { return S.fleetSwitch(...a); }

export function frameFor(...a: Parameters<typeof Panes.frameFor>): ReturnType<typeof Panes.frameFor> {
  return Panes.frameFor(...a);
}

export function hubAddr(...a: Parameters<typeof Route.hubAddr>): ReturnType<typeof Route.hubAddr> {
  return Route.hubAddr(...a);
}

export function select(...a: Parameters<typeof Panes.select>): ReturnType<typeof Panes.select> {
  return Panes.select(...a);
}

export function setFleet(...a: Parameters<typeof Fleet.setFleet>): ReturnType<typeof Fleet.setFleet> {
  return Fleet.setFleet(...a);
}

export function tlHash(...a: Parameters<typeof Route.tlHash>): ReturnType<typeof Route.tlHash> {
  return Route.tlHash(...a);
}
