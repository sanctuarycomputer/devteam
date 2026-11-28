'use client';
// kit-1008: the hub shell's client code (spec, Server and client). Its top level runs once when its chunk
// loads in the browser and registers the shell's 15 COMPAT functions and its values on window (expose()
// registers nothing on the server). HubShellClient renders nothing; its one effect boots the glue once the
// markup is in the DOM (bootHub() runs once, behind its own flag).
import { useEffect } from 'react';
import { expose } from '@shared/compat';
import { dbTable, fleetSwitch, goalSteps, heartbeat, props, statusPill, tabBar } from '@shared/shell/shell';
import { hubShellState } from './state';
import { getTerm, keyOf, select, setTerm } from './panes';
import { fleetAsk } from './fleet';
import { bootHub, draw, findBox, paintOvTab, paintTab, viewOnly } from './boot';

expose('dbTable', dbTable);
expose('fleetSwitch', fleetSwitch);
expose('goalSteps', goalSteps);
expose('heartbeat', heartbeat);
expose('props', props);
expose('statusPill', statusPill);
expose('tabBar', tabBar);
expose('draw', draw);
expose('findBox', findBox);
expose('fleetAsk', fleetAsk);
expose('keyOf', keyOf);
expose('paintOvTab', paintOvTab);
expose('paintTab', paintTab);
expose('select', select);
expose('viewOnly', viewOnly);

// hub.html's top-level box and term, read and written by the ported tests as the page's own (COMPAT values);
// items, urlOf and selected too, carry-overs outside COMPAT that kit-1012 folds in (rulings 9, m-20261128-113317215)
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'box', { get: () => hubShellState.box, set: (v) => { hubShellState.box = v; }, configurable: false });
  Object.defineProperty(window, 'items', { get: () => hubShellState.items, set: (v) => { hubShellState.items = v; }, configurable: false });
  Object.defineProperty(window, 'selected', { get: () => hubShellState.selected, set: (v) => { hubShellState.selected = v; }, configurable: false });
  Object.defineProperty(window, 'urlOf', { get: () => hubShellState.urlOf, set: (v) => { hubShellState.urlOf = v; }, configurable: false });
  Object.defineProperty(window, 'term', { get: getTerm, set: setTerm, configurable: false });
}

export default function HubShellClient(): null {
  useEffect(() => bootHub(), []);
  return null;
}
