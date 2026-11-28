// kit-995: the Settings page (index.html's settings lines): the limits, the owner settings, the fleet's ready card, drawSettings, saveLimit, and bootSettings.
import { LIMIT_NAMES, LIMITS, SET_SAVED_LABEL, settingText } from '../../lib/settings-text';
import { press, redrawNow } from '../data';
import { drawFleet, fleetStateLine } from '../goals';
import { goalsState } from '../goals/state';
import { bindFleetSwitch, esc } from '../shell';
import { $ } from '../shell/page';
import { shell } from '../shell/state';
import { threadsPanelState } from '../threads-panel/state';
import { linkify, when } from '../words';
import { loadFleet, postFleet } from './fleet';
import { settingsState } from './state';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` or a `!` is a type only (SWC
// strips it; spec A4). Many are there because another view's stub returns `never`: the compiler reads the code
// after a call into one as unreachable and types its names `never`. That view's port makes them unneeded.
type Loose = any;


// each limit's control across redraws: pending (undefined: as asked; null: No limit; else 1..20), busy, error
export const SET_UI = Object.fromEntries(LIMITS.map((k: Loose) => [k, { pending: undefined, busy: false, error: null }]));
// the value a limit stands at: the one the owner asked for while it waits to land, else the one in force
export function limitAsked(key: Loose) {
  const a = (shell.DATA as Loose)?.asked_settings?.[key];
  if (!a) return null;
  return a.act && String(a.label ?? '').toLowerCase() === SET_SAVED_LABEL ? a.asked ?? null : a.value ?? null;
}
export const limitShown = (key: Loose) => (SET_UI[key].pending !== undefined ? SET_UI[key].pending : limitAsked(key));
// ui-candidate: stepper
// the No limit / number control, then Save while the value differs from the one asked for (the mock's limitControl)
export function limitControl(key: Loose) {
  const u = SET_UI[key], v = limitShown(key), dis = u.busy ? ' disabled' : '';
  return `<span class="limit" data-limit="${key}"><span class="seg" role="group" aria-label="Limit"><button type="button" aria-pressed="${v === null}" data-limit-none="${key}"${dis}>No limit</button><span class="stepper"><button type="button" class="ghost" data-limit-step="-1" data-k="${key}" aria-label="Fewer"${dis}>−</button><b>${v ?? '–'}</b><button type="button" class="ghost" data-limit-step="1" data-k="${key}" aria-label="More"${dis}>+</button></span></span><button type="button" class="mini" data-limit-save="${key}"${v === limitAsked(key) ? ' hidden' : ''}${dis}>Save</button>${u.busy ? '<span class="msg dim">saving…</span>' : ''}${u.error ? `<span class="err" role="alert">${esc(u.error)}</span>` : ''}</span>`;
}
// One setting's row (data-setting: a thread target, marked while its thread's card is open), and its
// description under it. A limit's description adds the value in force and the server's label for it.
export function settingRowHtml(e: Loose) {
  const limit = LIMITS.includes(e.key);
  const a = limit ? (shell.DATA as Loose)?.asked_settings?.[e.key] : null;
  const desc = [e.description ? esc(e.description) : '', a ? `in force: ${esc(a.shown ?? '')}` : '', a?.label ? `<span class="set-label">${esc(a.label)}</span>` : ''].filter(Boolean).join(' · ');
  return `<div class="rowline set-row${e.key === settingsState.SET_MARK ? ' tl-marked' : ''}" data-setting="${esc(e.key)}"><span class="t"><span class="set-name">${esc(e.name)}</span> <code class="set-key">${esc(e.key)}</code></span><span class="r">${limit ? limitControl(e.key) : `<span class="set-val">${esc(settingText(e))}</span>`}${e.owner_only ? ` <span class="badge amber" title="${esc(e.owner_only)}">yours to change</span>` : ''}</span></div><div class="set-desc dim" data-setting-desc="${esc(e.key)}">${desc}</div>`;
}
// ui-candidate: card
// Ready to move? (fleet status), at all times (ruling m-20261116-095757248): ready or not, each blocker,
// the parity, and Check now (fetch from origin and check again), disabled while a read is out. On a
// running fleet with nothing checked yet, the words are today's strip's. Until the first answer the
// card holds a line for what is left and one for the parity, so the rows below don't jump when it comes
// (the common answer: one blocker or none, and the parity). After a failed check the last good answer
// stays, marked old: the badge goes neutral and says when that check was.
export function readyCard(d: Loose) {
  const f = d.fleet || {};
  const held = !!(f.mode || f.op);
  const st = goalsState.FLEET.data;
  const old = !!(st && (goalsState.FLEET as Loose).error);
  const badge = old ? `<span class="badge">last check failed; this is from ${esc(when(goalsState.FLEET.at))}</span>` : st ? (st.ready ? '<span class="badge good">ready to move</span>' : `<span class="badge${held ? ' medium' : ''}">not ready to move</span>`) : held || goalsState.FLEET.busy ? '<span class="dim">checking…</span>' : '';
  const rows = [`<div class="rowline"><span class="t">${held ? 'Held' : 'Fleet'}</span><span class="r">${fleetStateLine(f, st)}</span></div>`];
  if ((goalsState.FLEET as Loose).error) rows.push(`<div class="rowline"><span class="err" role="alert">Couldn't check: ${esc((goalsState.FLEET as Loose).error)}</span></div>`);
  if (!st) {
    rows.push(`<div class="rowline ready-pending"><span class="t dim">${held || goalsState.FLEET.busy ? 'checking what a move needs…' : 'A move is fleet park --move (or drain --move) from the supervisor; Park and Drain here pause the fleet on this machine. Check now says what a move needs'}</span></div>`);
    rows.push('<div class="rowline ready-pending"><span class="t">Parity</span><span class="r dim">–</span></div>');
  }
  if (st) {
    for (const b of st.blockers || []) rows.push(`<div class="rowline ready-blocker"><span class="dot amber"></span><span class="t">${linkify(b)}</span></div>`);
    if (!(st.blockers || []).length) rows.push(`<div class="rowline"><span class="dot green"></span><span class="t">Nothing left before a move</span></div>`);
    if (st.parity) rows.push(`<div class="rowline"><span class="t">Parity</span><span class="r"><code>${esc(st.parity.hash)}</code></span></div>`);
  }
  return `<div class="card ready-card"><div class="card-head"><i class="icon-truck" aria-hidden="true"></i>Ready to move?<span class="grow">${badge}</span><button type="button" class="ghost mini" data-checknow title="Fetch from origin and check again"${goalsState.FLEET.busy ? ' disabled' : ''}>Check now</button></div><div class="rows">${rows.join('')}</div></div>`;
}
// The page, drawn from DATA on every render, on arriving and when fleet status comes back. It is
// written only when its HTML changed, and focus goes back to the same control.
export let SET_DRAWN: Loose = null;
// Check now was pressed and its read is out
export let CHECK_PRESSED = false;
export function drawSettings() {
  const el = $('settings');
  if (!el || !shell.DATA) return;
  // a pending value back at the one asked for is no change
  for (const k of LIMITS) if (SET_UI[k].pending !== undefined && !SET_UI[k].busy && SET_UI[k].pending === limitAsked(k)) SET_UI[k].pending = undefined;
  const all = Array.isArray((shell.DATA as Loose).settings_all) ? (shell.DATA as Loose).settings_all : null;
  const groups = new Map();
  for (const e of all ?? LIMITS.map((key: Loose) => ({ key, group: 'Fleet and capacity', name: (LIMIT_NAMES as Loose)[key], description: '', owner_only: null }))) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  const html = readyCard(shell.DATA)
    + (all ? '' : `<p class="dim set-unread">The settings list can't be read from this dashboard's server; only the two worker limits show.</p>`)
    + [...groups].map(([g, rows]: Loose) => `<div class="sec"><div class="lbl">${esc(g)}</div><div class="rows">${rows.map(settingRowHtml).join('')}</div></div>`).join('');
  if (html === SET_DRAWN) return;
  const ae = document.activeElement;
  const at = ae && el.contains(ae) ? (['limitNone', 'limitSave'].map((n: Loose) => (ae as Loose).dataset[n] && `[data-${n === 'limitNone' ? 'limit-none' : 'limit-save'}="${CSS.escape((ae as Loose).dataset[n])}"]`).find(Boolean) || ((ae as Loose).dataset.limitStep && `[data-limit-step="${CSS.escape((ae as Loose).dataset.limitStep)}"][data-k="${CSS.escape((ae as Loose).dataset.k)}"]`)) : null;
  el.innerHTML = html;
  SET_DRAWN = html;
  if (at) el.querySelector(at)?.focus({ preventScroll: true });
  // Check now is disabled while its read is out, so focus falls to the page: give it back once it ends
  if (CHECK_PRESSED && !goalsState.FLEET.busy) {
    CHECK_PRESSED = false;
    const now = document.activeElement;
    // only if the owner hasn't moved on meanwhile (focus still on the page, or on Check now)
    if (!now || now === document.body || now.matches?.('[data-checknow]')) (el.querySelector('[data-checknow]') as Loose)?.focus({ preventScroll: true });
  }
}
// Save: POST /api/owner-setting { key, value } through press(). The overlay shows the value asked for
// until the server's data says so; a refusal keeps the owner's value and shows the reason by the control.
export function saveLimit(key: Loose, value: Loose) {
  const u = SET_UI[key];
  const prevAct = (shell.DATA as Loose)?.asked_settings?.[key]?.act ?? null;
  return press(`owner-setting:${key}`, {
    build: () => ({ action: 'owner-setting', body: { key, value } }),
    overlay: {
      data: (d: Loose) => ({ ...d, asked_settings: { ...(d.asked_settings || {}), [key]: { ...(d.asked_settings?.[key] || {}), asked: value, act: 'saving', label: `${SET_SAVED_LABEL.charAt(0).toUpperCase()}${SET_SAVED_LABEL.slice(1)}` } } }),
      agrees: (raw: Loose) => { const a = raw.asked_settings?.[key]; return !!a && !!a.act && a.act !== prevAct && a.asked === value; },
    },
    apply: () => { Object.assign(u, { busy: true, error: null, pending: undefined }); redrawNow(); drawSettings(); },
    onOk: () => { u.busy = false; drawSettings(); },
    onError: (error: Loose) => { Object.assign(u, { busy: false, pending: value, error: `Not saved: ${error}` }); },
    errId: `set-${key}`,
  });
}
// the page's two load-time statements (index.html:4436-4452, 4608-4623), run once by client.tsx's effect
export function bootSettings() {
  bindFleetSwitch((document.querySelector('.app') as Loose), {
    // Park asks first, in place; any other press cancels a pending confirm. A press for the mode already
    // in force posts nothing (Run while running, Drain while draining, Park while parked); Drain on a
    // parked fleet posts nothing either (the server's drain changes only running goals) and says why.
    onPress: (m: Loose) => {
      const f = (shell.DATA as Loose)?.fleet || {};
      goalsState.FLEET_UI.error = null;
      if (m === 'park') { goalsState.FLEET_UI.confirming = f.mode !== 'park'; drawFleet(); return; }
      goalsState.FLEET_UI.confirming = false;
      if (m === 'drain' && f.mode === 'park') goalsState.FLEET_UI.error = 'Parked: Run first, then Drain';
      else if (m === 'drain' && f.mode !== 'drain') return postFleet('drain');
      else if (m === 'run' && (f.mode || f.op)) return postFleet('resume');
      drawFleet();
    },
    onConfirm: () => { if (((shell.DATA as Loose)?.fleet || {}).mode === 'park') { goalsState.FLEET_UI.confirming = false; drawFleet(); return; } postFleet('park'); },
    onCancel: () => { goalsState.FLEET_UI.confirming = false; drawFleet(); },
  });
  $('settings')!.addEventListener('click', (e: Loose) => {
    if (e.shiftKey || threadsPanelState.TL.pin) return; // a thread's point, not a press
    const c = e.target.closest('[data-checknow]');
    if (c) { if (!c.disabled && !goalsState.FLEET.busy) { CHECK_PRESSED = true; loadFleet(true); } return; }
    const b = e.target.closest('[data-limit-none], [data-limit-step], [data-limit-save]');
    if (!b || b.disabled) return;
    const key = b.dataset.limitNone ?? b.dataset.k ?? b.dataset.limitSave;
    if (!LIMITS.includes(key)) return;
    const u = SET_UI[key];
    if (b.dataset.limitSave) { saveLimit(key, limitShown(key)); return; }
    u.error = null;
    if (b.dataset.limitNone) u.pending = null;
    // 1 to 20; + or − from No limit gives 1
    else u.pending = Math.min(20, Math.max(1, (limitShown(key) ?? 0) + Number(b.dataset.limitStep)));
    drawSettings();
  });
}
