'use client';
// kit-991: overview's client code. Its top level runs once when its chunk loads in the browser: it registers
// overview's COMPAT global NEXT_ID, and window.pullRefresh, which test/pull-refresh.test.mjs reads in the page
// though COMPAT's scan missed it: a value, so a getter over boot's binding (src/shared/compat.ts), null until
// bootOverview() has run and in a viewer tab. expose() and the getter register nothing on the server.
// OverviewClient renders nothing; its one effect runs bootOverview() once, behind this module's flag, so a remount
// (development's double effect) adds no second listener or spinner.
import { useEffect } from 'react';
import { expose } from '../../shared/compat';
import { bootOverview, pull } from './boot';
import { NEXT_ID } from './render';
import './wire';

expose('NEXT_ID', NEXT_ID);
if (typeof window !== 'undefined') Object.defineProperty(window, 'pullRefresh', { get: () => pull, configurable: false });

let booted = false; // bootOverview() has run

export default function OverviewClient(): null {
  useEffect(() => {
    if (booted) return;
    booted = true;
    bootOverview();
  }, []);
  return null;
}
