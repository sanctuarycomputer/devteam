// kit-1006: the terminal view of the dashboard's / route (the side panel's Supervisor and Shell tabs), ported from
// index.html's term-css and term-js. Terminal has no markup in index.html: its boxes are made when threads-panel
// draws a tab (termRender). The view loads terminal.css and renders TerminalClient, which boots it once. Below, every
// function another view calls from it (APPS.md, The view stubs' exports), each a hoisted function that calls
// terminal's module at call time: call these from a function another view runs later, never at its top level.
import './terminal.css';
import * as Defs from '../../lib/terminal-defs';
import * as Term from './term';
import TerminalClient from './client';

export default function View() {
  return <TerminalClient />;
}

export function isTermTab(...a: Parameters<typeof Defs.isTermTab>): ReturnType<typeof Defs.isTermTab> {
  return Defs.isTermTab(...a);
}

export function termRender(...a: Parameters<typeof Term.termRender>): ReturnType<typeof Term.termRender> {
  return Term.termRender(...a);
}

export function termSync(...a: Parameters<typeof Term.termSync>): ReturnType<typeof Term.termSync> {
  return Term.termSync(...a);
}

export function termTabsOff(...a: Parameters<typeof Term.termTabsOff>): ReturnType<typeof Term.termTabsOff> {
  return Term.termTabsOff(...a);
}
