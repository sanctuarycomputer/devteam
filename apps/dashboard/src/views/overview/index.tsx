// kit-991: the Overview page of the dashboard's / route, ported from index.html (overview's lines: the css-overview
// region, the html-overview markup, the score-of and hello-pulse blocks with NEXT_ID and renderOverview, the header
// filters' listeners and pull to refresh). A server module: its markup is exported once into the page, and the
// script writes into it, as index.html's does. The blocks are the lib's (src/lib/overview-score.ts,
// src/lib/overview-hello.ts), wired by ./wire. Below, every function another view calls from it (APPS.md, The view
// stubs' exports), each a hoisted function with the stub's call shape (any arguments, which index.html's
// functions ignore) that calls overview's module at call time. Overview's modules import
// other views, so call these from a function another view runs later, never at its top level.
import './overview.css';
import './wire';
import * as Hello from '../../lib/overview-hello';
import * as Render from './render';
import OverviewClient from './client';

export default function View() {
  return (
    <>
      <section id="overview" data-page="overview">
        <div id="ov-head" className="ov-head"></div>
        {/* ui-candidate: banner (shared/ui's Banner renders class="banner …", this one is class="down-banner") */}
        <div id="down-banner" className="down-banner" role="alert" hidden></div>
        <div id="ov-secs"></div>
      </section>
      <OverviewClient />
    </>
  );
}

export function helloLoad(..._args: unknown[]): ReturnType<typeof Hello.helloLoad> {
  return Hello.helloLoad();
}

export function NEXT_ID(..._args: unknown[]): ReturnType<typeof Render.NEXT_ID> {
  return Render.NEXT_ID();
}

export function renderOverview(..._args: unknown[]): ReturnType<typeof Render.renderOverview> {
  return Render.renderOverview();
}
