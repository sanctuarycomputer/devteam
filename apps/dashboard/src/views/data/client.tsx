'use client';
// kit-989: data's client code (spec, The boot). Its top level runs once when its chunk loads in the browser and
// registers data's 10 COMPAT globals: each the binding data's own modules use (window.load is the function the poll
// passes to setInterval). expose() registers nothing on the server. DataClient renders nothing; its one effect runs
// bootData() once, behind this module's flag, so a remount (development's double effect) adds no second listener.
import { useEffect } from 'react';
import { expose } from '../../shared/compat';
import { bootData, drawHeld, inboxCount, load } from './boot';
import { press, redrawNow } from './press';
import { render } from './render';
import { hideDrawer, route, showTab } from './router';
import { viewerBoot } from './viewer';

expose('drawHeld', drawHeld);
expose('hideDrawer', hideDrawer);
expose('inboxCount', inboxCount);
expose('load', load);
expose('press', press);
expose('redrawNow', redrawNow);
expose('render', render);
expose('route', route);
expose('showTab', showTab);
expose('viewerBoot', viewerBoot);

let booted = false; // bootData() has run

export default function DataClient(): null {
  useEffect(() => {
    if (booted) return;
    booted = true;
    bootData();
  }, []);
  return null;
}
