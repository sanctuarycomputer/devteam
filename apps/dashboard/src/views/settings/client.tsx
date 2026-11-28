'use client';
// kit-995: settings' client code (spec, The boot). Its top level runs once when its chunk loads in the browser and
// registers settings' 4 COMPAT globals: each the binding settings' own modules use. expose() registers nothing on the
// server. SettingsClient renders nothing; its one effect runs bootSettings() once (index.html's two load-time
// statements: the fleet switch's binding and #settings' click listener), behind this module's flag, so a remount
// (development's double effect) binds nothing twice.
import { useEffect } from 'react';
import { expose } from '../../shared/compat';
import { loadFleet } from './fleet';
import { renderJobs } from './jobs';
import { bootSettings, drawSettings, saveLimit } from './page';

expose('drawSettings', drawSettings);
expose('loadFleet', loadFleet);
expose('renderJobs', renderJobs);
expose('saveLimit', saveLimit);

let booted = false; // bootSettings() has run

export default function SettingsClient(): null {
  useEffect(() => {
    if (booted) return;
    booted = true;
    bootSettings();
  }, []);
  return null;
}
