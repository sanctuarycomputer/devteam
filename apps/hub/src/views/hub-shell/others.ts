// kit-1008 ruling 3: the shell's every call into another hub view, through ported(). Until a view's port, a
// stub's throw gives the fallback (spec, The wrappers) and one warning per name. kit-1012 deletes this file
// and renames each _<name> back to <name>, imported from its view.
import { ported } from '../../lib/hub-shell-guard';
import { boxAlertNow, ownAlert, tlActive, tlLeave, tlOpen, tlRefresh } from '../hub-threads';
import { closeMenu, countsEl, el, hubKey, memoryStart, openAt, paintOverview, stateOf } from '../hub-overview';
import { oaToast, paintSettings } from '../hub-settings';
import { hubOverviewState } from '../hub-overview/state';

export const _el = (...a: Parameters<typeof el>) => ported('el', () => el(...a), () => { const e: HTMLElement = document.createElement(String(a[0])); if (a[1]) e.className = String(a[1]); if (a[2] !== undefined) e.textContent = String(a[2]); return e; });
export const _hubKey = (...a: Parameters<typeof hubKey>) => ported('hubKey', () => hubKey(...a), () => (Boolean(a[1]) || hubOverviewState.HUB_VIEWS.includes(String(a[0])) ? `${a[0]}-${a[2]}` : String(a[0])) as string);
export const _stateOf = (...a: Parameters<typeof stateOf>) => ported('stateOf', () => stateOf(...a), () => ((a[0] as { goneAt?: unknown } | undefined)?.goneAt ? 'gone' : 'unknown') as string);
export const _countsEl = (...a: Parameters<typeof countsEl>) => ported('countsEl', () => countsEl(...a), () => null as HTMLElement | null);
export const _ownAlert = (...a: Parameters<typeof ownAlert>) => ported('ownAlert', () => ownAlert(...a), () => null as string | null);
export const _boxAlertNow = (...a: Parameters<typeof boxAlertNow>) => ported('boxAlertNow', () => boxAlertNow(...a), () => null as string | null);
export const _closeMenu = (...a: Parameters<typeof closeMenu>) => ported('closeMenu', () => closeMenu(...a));
export const _tlLeave = (...a: Parameters<typeof tlLeave>) => ported('tlLeave', () => tlLeave(...a));
export const _paintOverview = (...a: Parameters<typeof paintOverview>) => ported('paintOverview', () => paintOverview(...a));
export const _tlRefresh = (...a: Parameters<typeof tlRefresh>) => ported('tlRefresh', () => tlRefresh(...a));
export const _paintSettings = (...a: Parameters<typeof paintSettings>) => ported('paintSettings', () => paintSettings(...a));
export const _memoryStart = (...a: Parameters<typeof memoryStart>) => ported('memoryStart', () => memoryStart(...a));
export const _oaToast = (...a: Parameters<typeof oaToast>) => ported('oaToast', () => oaToast(...a));
export const _openAt = (...a: Parameters<typeof openAt>) => ported('openAt', () => openAt(...a));
export const _tlOpen = (...a: Parameters<typeof tlOpen>) => ported('tlOpen', () => tlOpen(...a), () => Promise.resolve() as Promise<unknown>);
export const _tlActive = (...a: Parameters<typeof tlActive>) => ported('tlActive', () => tlActive(...a), () => false as boolean);
