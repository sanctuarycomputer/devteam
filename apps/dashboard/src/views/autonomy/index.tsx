// kit-994: the Efficiency, Trust, Awareness, Governance and Sensors pages of the dashboard's / route, ported from
// index.html (autonomy's lines: the css-efficiency and css-autonomy-pages regions, the html-trust, html-efficiency,
// html-awareness, html-governance, html-health and html-sensors markup, and the script's Efficiency, Autonomy pages and
// monitoring code). A server module: its markup is exported once into the page, and the script writes into it, as
// index.html's does. Below, every function another view calls from it (APPS.md, The view stubs' exports): each a
// hoisted function that calls autonomy's module at call time. Autonomy's modules import other views, so call these
// from a function another view runs later, never at its top level.
import './autonomy.css';
import * as Awareness from './awareness';
import * as Efficiency from './efficiency';
import * as Governance from './governance';
import * as Pages from './pages';
import * as Sensors from './sensors';
import * as Trust from './trust';
import * as Charts from '../../lib/autonomy-charts';
import AutonomyClient from './client';

export default function View() {
  return (
    <>
      <section id="trust" data-page="trust"></section>
      {/* kit-174: the Efficiency Score card, beside Trust, on the shell (render() draws it: renderEfficiency) */}
      <section id="efficiency" data-page="efficiency"></section>
      <section id="awareness" data-page="awareness"></section>
      <section id="governance" data-page="governance"></section>
      {/* html-health: empty in index.html; #health redirects to #sensors (SHELL_ROUTES, the shell's) */}
      <section id="monitoring" data-page="sensors"></section>
      <AutonomyClient />
    </>
  );
}

export function bindPageTables(...a: Parameters<typeof Pages.bindPageTables>): ReturnType<typeof Pages.bindPageTables> {
  return Pages.bindPageTables(...a);
}

export function effNum(...a: Parameters<typeof Charts.effNum>): ReturnType<typeof Charts.effNum> {
  return Charts.effNum(...a);
}

export function fpRow(...a: Parameters<typeof Sensors.fpRow>): ReturnType<typeof Sensors.fpRow> {
  return Sensors.fpRow(...a);
}

export function govBlockAt(...a: Parameters<typeof Governance.govBlockAt>): ReturnType<typeof Governance.govBlockAt> {
  return Governance.govBlockAt(...a);
}

export function loadGovernance(...a: Parameters<typeof Governance.loadGovernance>): ReturnType<typeof Governance.loadGovernance> {
  return Governance.loadGovernance(...a);
}

export function navCounts(...a: Parameters<typeof Pages.navCounts>): ReturnType<typeof Pages.navCounts> {
  return Pages.navCounts(...a);
}

export function openClass(...a: Parameters<typeof Trust.openClass>): ReturnType<typeof Trust.openClass> {
  return Trust.openClass(...a);
}

export function openSensor(...a: Parameters<typeof Sensors.openSensor>): ReturnType<typeof Sensors.openSensor> {
  return Sensors.openSensor(...a);
}

export function pageTable(...a: Parameters<typeof Pages.pageTable>): ReturnType<typeof Pages.pageTable> {
  return Pages.pageTable(...a);
}

export function renderAwareness(...a: Parameters<typeof Awareness.renderAwareness>): ReturnType<typeof Awareness.renderAwareness> {
  return Awareness.renderAwareness(...a);
}

export function renderEfficiency(...a: Parameters<typeof Efficiency.renderEfficiency>): ReturnType<typeof Efficiency.renderEfficiency> {
  return Efficiency.renderEfficiency(...a);
}

export function renderGovernance(...a: Parameters<typeof Governance.renderGovernance>): ReturnType<typeof Governance.renderGovernance> {
  return Governance.renderGovernance(...a);
}

export function renderMonitoring(...a: Parameters<typeof Sensors.renderMonitoring>): ReturnType<typeof Sensors.renderMonitoring> {
  return Sensors.renderMonitoring(...a);
}

export function renderTrust(...a: Parameters<typeof Trust.renderTrust>): ReturnType<typeof Trust.renderTrust> {
  return Trust.renderTrust(...a);
}

export function retroCards(...a: Parameters<typeof Pages.retroCards>): ReturnType<typeof Pages.retroCards> {
  return Pages.retroCards(...a);
}

export function spark(...a: Parameters<typeof Efficiency.spark>): ReturnType<typeof Efficiency.spark> {
  return Efficiency.spark(...a);
}

export function suggPageOf(...a: Parameters<typeof Awareness.suggPageOf>): ReturnType<typeof Awareness.suggPageOf> {
  return Awareness.suggPageOf(...a);
}
