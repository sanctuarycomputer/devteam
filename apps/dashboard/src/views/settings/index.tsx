// kit-995: the settings view of the dashboard's / route, ported from index.html (settings' lines: the Retros, Jobs and
// Settings pages, the fleet switch's posts and reads, the owner settings and the limits). Its markup is index.html's
// three empty sections, which the page's draws fill; SettingsClient boots it once. Below, every function another view
// calls from it (APPS.md, The view stubs' exports), each a hoisted function that calls settings' module at call time.
// Settings' modules import other views, so a call made while the cycle is still loading can find its target unbound:
// call these from a function another view runs later, never at its top level.
import './settings.css';
import * as Fleet from './fleet';
import * as Jobs from './jobs';
import * as Page from './page';
import SettingsClient from './client';

export default function View() {
  return (
    <>
      <section id="retros" data-page="retros"></section>
      <section id="jobs" data-page="jobs"></section>
      <section id="settings" data-page="settings"></section>
      <SettingsClient />
    </>
  );
}

export function drawSettings(...a: Parameters<typeof Page.drawSettings>): ReturnType<typeof Page.drawSettings> {
  return Page.drawSettings(...a);
}

export function loadFleet(...a: Parameters<typeof Fleet.loadFleet>): ReturnType<typeof Fleet.loadFleet> {
  return Fleet.loadFleet(...a);
}

export function renderJobs(...a: Parameters<typeof Jobs.renderJobs>): ReturnType<typeof Jobs.renderJobs> {
  return Jobs.renderJobs(...a);
}
