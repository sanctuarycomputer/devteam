'use client';
// kit-993: board's client code. Its top level runs once when its chunk loads in the browser and registers board's 6
// COMPAT globals and ticketPills (which test/dashboard-board-progress.test.mjs calls in the page; COMPAT's scan missed
// it, spec S13): each the binding board's own modules use. expose() registers nothing on the server. Board starts no
// work of its own: data's render draws it. BoardClient renders nothing.
import { expose } from '../../shared/compat';
import { burnup, PROGRESS_CHART } from './burnup';
import { pillsOf, renderBoard, ticketPills } from './cards';
import { forecast, renderProgress } from './progress';

expose('burnup', burnup);
expose('forecast', forecast);
expose('pillsOf', pillsOf);
expose('PROGRESS_CHART', PROGRESS_CHART);
expose('renderBoard', renderBoard);
expose('renderProgress', renderProgress);
expose('ticketPills', ticketPills);

export default function BoardClient(): null {
  return null;
}
