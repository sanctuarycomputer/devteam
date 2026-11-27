'use client';
// kit-988: the shell's client code (spec, Server and client). Its top level runs once when its chunk loads in the
// browser and registers the shell's 14 COMPAT globals (expose() registers nothing on the server). ShellClient
// renders nothing; its one effect boots the glue once the markup is in the DOM.
import { useEffect } from 'react';
import { expose } from '../../shared/compat';
import { bindDbTable, dbTable, fleetSwitch, goalSteps, heartbeat, props, shellPages, statusPill, tabBar } from '../../shared/shell/shell';
import { empty, esc, fmtDate } from '../../lib/shell-page';
import { bootShell, viewOnly, viewToast } from './page';

expose('bindDbTable', bindDbTable);
expose('dbTable', dbTable);
expose('empty', empty);
expose('esc', esc);
expose('fleetSwitch', fleetSwitch);
expose('fmtDate', fmtDate);
expose('goalSteps', goalSteps);
expose('heartbeat', heartbeat);
expose('props', props);
expose('shellPages', shellPages);
expose('statusPill', statusPill);
expose('tabBar', tabBar);
expose('viewOnly', viewOnly);
expose('viewToast', viewToast);

export default function ShellClient(): null {
  useEffect(() => bootShell(), []);
  return null;
}
