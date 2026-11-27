// The page's mount (kit-1013): what the old page's script did at load, once per page load. The body's
// loading state, #pageAdd (now markup) into live.pageAdd, each section's load-time setup in the page's
// order, then start(), the old script's last statement (canvas.html 5502).
import { $, TEXT, fail, live, setState } from './page';
import { start } from './start';
import * as panels from '../panels';
import * as sync from '../sync';
import * as editing from '../editing';
import * as history from '../history';
import * as presence from '../presence';

export let mounted = false;

export function mount(): void {
  if (mounted) return;
  mounted = true;
  setState('loading');
  live.pageAdd = $('pageAdd') as HTMLButtonElement;
  panels.init();
  sync.init();
  editing.init();
  history.init();
  presence.init();
  start().catch(() => fail(TEXT.notLoaded));
}
