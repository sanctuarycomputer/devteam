'use client';
// kit-994: autonomy's client code. Its top level runs once when its chunk loads in the browser and registers
// autonomy's 4 COMPAT globals, each the binding autonomy's own modules use. expose() registers nothing on the server.
// AutonomyClient renders nothing; its one effect runs bootAutonomy() once, behind this module's flag, so a remount
// (development's double effect) adds no second listener, and a page that never hydrates (#design-system) adds none.
import { useEffect } from 'react';
import { expose } from '../../shared/compat';
import { bootAutonomy } from './boot';
import { spark } from './efficiency';
import { govListed, loadGovernance } from './governance';
import { openSensor } from './sensors';

expose('govListed', govListed);
expose('loadGovernance', loadGovernance);
expose('openSensor', openSensor);
expose('spark', spark);

let booted = false; // bootAutonomy() has run

export default function AutonomyClient(): null {
  useEffect(() => {
    if (booted) return;
    booted = true;
    bootAutonomy();
  }, []);
  return null;
}
