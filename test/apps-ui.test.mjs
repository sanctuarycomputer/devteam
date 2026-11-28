// kit-1041: the shared UI components of apps/dashboard/src/shared/ui/ (apps-src@2, apps/dashboard/APPS.md).
// Each renders exactly the DOM today's markup has for the same input, so a port that renders one keeps every
// COMPAT.md item it covers. EXPECT holds, for every specimen of every component, the markup it must render:
// a shared helper's output (U2 runs the helper from index.html, in node:vm, and compares), or a template's
// (its `from` is the template in index.html, and the html must match it with each ${…} as a wildcard).
// Always (main's CI too, nothing built): the components are the 30, each specimens file's titles are its
// EXPECT keys (U1); every entry is its helper's output or matches its template (U2); each component keeps the
// conventions: typed props, react imports only, no data, no API, no effect (U3); every class-like word it
// holds is styled by kit-988's shell CSS or by no CSS at all (U4). In the tree, with Chrome (U5): the tree's
// built dashboard at /#design-system, where each specimen's DOM equals its EXPECT markup, parsed in the same
// page, node by node, and every class on it is kit-988's, an icon, a word of a component's source, or its
// specimen's.
// When index.html changes on main after kit-1041's base, an entry whose helper or template changed is a todo
// that names it (the sweeps, kit-1042/1043, reconcile), never a failure, and the file always loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canDrive, cleanup, openChrome } from './lib/chrome.mjs';
import { PORTS, bareProject } from './lib/kit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const DASH = path.join(ROOT, 'apps', 'dashboard');
const UI = path.join(DASH, 'src', 'shared', 'ui');
const INDEX = path.join(ROOT, 'docs', 'devteam', 'dashboard', 'index.html');
const HUB = path.join(ROOT, 'docs', 'devteam', 'dashboard', 'hub.html');
const read = (f) => fs.readFileSync(f, 'utf8');

export const NAMES = ['badge', 'banner', 'button', 'card', 'card-head', 'card-menu', 'context', 'dot', 'empty', 'fleet-switch', 'gate-dot', 'heartbeat', 'hold-bar', 'loading', 'peek-section', 'pill', 'props-table', 'row-inline', 'row-line', 'rows', 'section', 'segmented', 'select', 'stat', 'table', 'tab-bar', 'text-area', 'text-field', 'timeline', 'title-link'].sort();

// [component, specimen title, { html, helper?, args?, from?, prefix?, show?, fill? }]
// A template entry: `from` is the template, a substring of index.html. The html must match it whole, with each
// ${…} a wildcard; `prefix`: the html starts with it (the template goes on into the view's own content);
// `show`: the template's `hidden` dropped (the view shows it); `fill`: its empty content is a wildcard (the view
// fills it).
const ROWS = [
  ['badge', 'Default', { html: '<span class="badge" id="av-kind">Mock</span>', from: '<span class="badge" id="av-kind">Mock</span>' }],
  ['badge', 'Good', { html: '<span class="badge good" title="Enough answers went with its recommendation to ask you to raise it">ready to ask for more</span>', from: '<span class="badge good" title="Enough answers went with its recommendation to ask you to raise it">ready to ask for more</span>' }],
  ['badge', 'Low', { html: '<span class="badge low">now</span>', from: '<span class="badge low">now</span>' }],
  ['badge', 'High', { html: '<span class="badge high">flaky</span>', from: '<span class="badge high">flaky</span>' }],
  ['badge', 'Medium', { html: '<span class="badge medium">often fails</span>', from: '<span class="badge medium">often fails</span>' }],
  ['badge', 'Critical', { html: '<span class="badge critical">critical</span>', from: '<span class="badge ${esc(f.severity)}">${esc(f.severity)}</span>' }],
  ['badge', 'Hidden, with its own class', { html: '<span class="badge kit" id="kit" hidden></span>', from: '<span class="badge kit" id="kit" hidden></span>' }],
  ['banner', 'Default', { html: '<div class="banner"><b>The page or data changed since the supervisor asked.</b> Nothing can be answered here. Tell the supervisor to ask again.</div>', from: '<div class="banner"><b>The page or data changed since the supervisor asked.</b> Nothing can be answered here. Tell the supervisor to ask again.</div>' }],
  ['banner', 'Alert', { html: '<div class="banner" id="banner" role="alert">The kit refused the last change: this machine is not the host.</div>', from: '<div class="banner" id="banner" role="alert" hidden></div>', show: true, fill: true }],
  ['banner', 'Updated', { html: '<div class="banner updated" id="updated" role="status">The dashboard was updated since this tab opened, so some of what you see may be out of date. <button id="reload-page">Reload</button></div>', from: '<div class="banner updated" id="updated" role="status" hidden>The dashboard was updated since this tab opened, so some of what you see may be out of date. <button id="reload-page">Reload</button></div>', show: true }],
  ['banner', 'Stale, with its own class', { html: '<div id="rv-link" class="banner stale rv-link" role="alert">The review page moved on since this question was asked.</div>', from: '<div id="rv-link" class="banner stale rv-link" role="alert" hidden></div>', show: true, fill: true }],
  ['button', 'Solid', { html: '<button data-post-secrets="q-1">Post</button>', from: '<button data-post-secrets="${esc(q.id)}">Post</button>' }],
  ['button', 'Ghost', { html: '<button class="ghost" data-dismiss-refused="q-1">Dismiss</button>', from: '<button class="ghost" data-dismiss-refused="${esc(q.id)}">Dismiss</button>' }],
  ['button', 'Icon', { html: '<button class="ghost icon-btn" id="drawer-close" aria-label="Close"><i class="icon-x" aria-hidden="true"></i></button>', from: '<button class="ghost icon-btn" id="drawer-close" aria-label="Close"><i class="icon-x" aria-hidden="true"></i></button>' }],
  ['button', 'Icon, pressed state and title', { html: '<button type="button" class="ghost icon-btn" id="tl-pinbtn" aria-pressed="false" aria-label="Pin" title="Point at something to start a thread: for a phone, or for a long look around"><i class="icon-map-pin" aria-hidden="true"></i></button>', from: '<button type="button" class="ghost icon-btn" id="tl-pinbtn" aria-pressed="false" aria-label="Pin" title="Point at something to start a thread: for a phone, or for a long look around"><i class="icon-map-pin" aria-hidden="true"></i></button>' }],
  ['button', 'Pressed', { html: '<button type="button" aria-pressed="true" data-limit-none="workers">No limit</button>', from: '<button type="button" aria-pressed="${v === null}" data-limit-none="${key}"${dis}>No limit</button>' }],
  ['button', 'Disabled', { html: '<button type="button" aria-pressed="false" data-limit-none="workers" disabled>No limit</button>', from: '<button type="button" aria-pressed="${v === null}" data-limit-none="${key}"${dis}>No limit</button>' }],
  ['button', 'A static tab', { html: '<button type="button" role="tab" data-tab="observe">Observe<span class="n" id="n-observe"></span></button>', from: '<button type="button" role="tab" data-tab="observe">Observe<span class="n" id="n-observe"></span></button>' }],
  ['button', 'Hidden, with its own class', { html: '<button type="button" class="mini" data-limit-save="workers" hidden>Save</button>', from: '<button type="button" class="mini" data-limit-save="${key}"${v === limitAsked(key) ? \' hidden\' : \'\'}${dis}>Save</button>' }],
  ['button', 'Out of the tab order', { html: '<button class="held" id="held" type="button" tabindex="-1">New data. Click to refresh</button>', from: '<button class="held" id="held" type="button" tabindex="-1" hidden>New data. Click to refresh</button>', show: true }],
  ['card', 'Default', { html: '<div class="card"><div class="card-head"><i class="icon-book-open" aria-hidden="true"></i><span class="grow">Stories</span></div><div id="w-stories"></div></div>', from: '<div class="card"><div class="card-head"><i class="icon-book-open" aria-hidden="true"></i><span class="grow">Stories</span></div><div id="w-stories"></div></div>' }],
  ['card', 'Flush', { html: '<div class="card flush"><div class="card-head"><i class="icon-eye" aria-hidden="true"></i>Observations<span class="grow" id="c-observe"></span></div><div id="observations"></div></div>', from: '<div class="card flush"><div class="card-head"><i class="icon-eye" aria-hidden="true"></i>Observations<span class="grow" id="c-observe"></span></div><div id="observations"></div></div>' }],
  ['card', 'Small', { html: '<div class="card small"><span class="badge high">sev 3</span> <a class="linkish" href="#problem/p-7">Disk fills up</a> <span class="muted">· open · a risk</span></div>', from: '<div class="card small"><span class="badge ${sevBadge(x.severity)}">sev ${esc(x.severity)}</span> <a class="linkish" href="#problem/${encodeURIComponent(x.id)}">${esc(x.title)}</a> <span class="muted">', prefix: true }],
  ['card', 'Opens a record', { html: '<div class="card c6 sensor-card" data-open="sensor/disk" tabindex="0" role="button" aria-label="Open the sensor disk"><div class="card-head"><i class="icon-activity" aria-hidden="true"></i>disk<span class="grow"><span class="badge good">ok</span></span></div><div class="sensor-src">every 5 minutes</div></div>', from: '<div class="card c6 sensor-card" data-open="sensor/${esc(encodeURIComponent(m.name))}" tabindex="0" role="button" aria-label="Open the sensor ${esc(m.name)}">${cardHead(\'activity\', esc(m.name), { extra: `<span class="badge ${tone}">${esc(label)}</span>` })}', prefix: true }],
  ['card-head', 'Title in the grow', { html: '<div class="card-head"><i class="icon-chart-line" aria-hidden="true"></i><span class="grow">Burn-up</span><span class="end" id="forecast"></span></div>', from: '<div class="card-head"><i class="icon-chart-line" aria-hidden="true"></i><span class="grow">Burn-up</span><span class="end" id="forecast"></span></div>' }],
  ['card-head', 'A grow with its id', { html: '<div class="card-head"><i class="icon-eye" aria-hidden="true"></i>Observations<span class="grow" id="c-observe"></span></div>', from: '<div class="card-head"><i class="icon-eye" aria-hidden="true"></i>Observations<span class="grow" id="c-observe"></span></div>' }],
  ['context', 'Default', { html: '<div class="ctx"><p>Asked after the v0.106 release failed its smoke test.</p></div>', from: '<div class="ctx">${qblock(q.context, q.links)}</div>' }],
  ['dot', 'Default', { html: '<span class="dot"></span>', from: '<span class="dot"></span>' }],
  ['dot', 'Green', { html: '<span class="dot green"></span>', from: '<span class="dot green"></span>' }],
  ['dot', 'Amber', { html: '<span class="dot amber"></span>', from: '<span class="dot amber"></span>' }],
  ['dot', 'Red', { html: '<span class="dot red"></span>', from: '<span class="dot ${SENSOR_LEVEL_DOT[l] || \'blue\'}"></span>' }],
  ['dot', 'Blue', { html: '<span class="dot blue"></span>', from: '<span class="dot ${SENSOR_LEVEL_DOT[l] || \'blue\'}"></span>' }],
  ['gate-dot', 'Passed', { html: '<span class="gate-dot ok">✓</span>', from: '<span class="gate-dot ${ok && bad ? \'flaky\' : last.ok ? \'ok\' : \'fail\'}">${ok && bad ? \'≈\' : last.ok ? \'✓\' : \'✗\'}</span>' }],
  ['gate-dot', 'Failed', { html: '<span class="gate-dot fail">✗</span>', from: '<span class="gate-dot ${ok && bad ? \'flaky\' : last.ok ? \'ok\' : \'fail\'}">${ok && bad ? \'≈\' : last.ok ? \'✓\' : \'✗\'}</span>' }],
  ['gate-dot', 'Flaky', { html: '<span class="gate-dot flaky">≈</span>', from: '<span class="gate-dot ${ok && bad ? \'flaky\' : last.ok ? \'ok\' : \'fail\'}">${ok && bad ? \'≈\' : last.ok ? \'✓\' : \'✗\'}</span>' }],
  ['loading', 'Default', { html: '<p class="loading">Loading…</p>', from: '<p class="loading">Loading…</p>' }],
  ['loading', 'With its id', { html: '<p class="loading" id="loading">Loading…</p>', from: '<p class="loading" id="loading">Loading…</p>' }],
  ['loading', 'Other words', { html: '<p class="loading">Loading the review…</p>', from: '<p class="loading">Loading the review…</p>' }],
  ['pill', 'A card\'s pill, with a title', { html: '<span class="badge pill medium" title="Waiting on the owner since Nov 26">waiting</span>', from: '<span class="badge pill${tone ? ` ${tone}` : \'\'}" title="${esc(tip || label)}">${icon ? `<i class="icon-${icon}" aria-hidden="true"></i>` : \'\'}${esc(label)}</span>' }],
  ['pill', 'A card\'s pill, with an icon', { html: '<span class="badge pill good" title="Verified on Nov 27"><i class="icon-check" aria-hidden="true"></i>verified</span>', from: '<span class="badge pill${tone ? ` ${tone}` : \'\'}" title="${esc(tip || label)}">${icon ? `<i class="icon-${icon}" aria-hidden="true"></i>` : \'\'}${esc(label)}</span>' }],
  ['pill', 'A card\'s pill, no tone', { html: '<span class="badge pill">merged, not yet verified</span>', from: '<span class="badge pill">merged, not yet verified</span>' }],
  ['pill', 'A card\'s pill, regressed', { html: '<span class="badge pill high">regressed</span>', from: '<span class="badge pill high">regressed</span>' }],
  ['hold-bar', 'Hold', { html: '<div class="holdbar"><span class="seg2" role="group" aria-label="Hold"><button type="button" data-hold-id="g-1" data-mode="run" aria-pressed="true">Run</button><button type="button" data-hold-id="g-1" data-mode="drain" aria-pressed="false">Drain</button><button type="button" data-hold-id="g-1" data-mode="park" aria-pressed="false">Park</button></span><span class="err" id="e-hold-g-1"></span></div>', from: '<div class="holdbar"><span class="seg2" role="group" aria-label="Hold">${btn(\'run\', \'Run\')}${btn(\'drain\', \'Drain\')}${btn(\'park\', \'Park\')}${letGo ? btn(\'let-go\', sure ? \'Confirm let go\' : \'Let go\', sure ? \'confirm\' : \'\') : \'\'}</span>${fleet}<span class="err" id="e-hold-${esc(id)}"></span></div>' }],
  ['hold-bar', 'Restoring', { html: '<div class="holdbar"><span class="muted small">Restoring: it comes back parked…</span><span class="err" id="e-hold-g-1"></span></div>', from: '<div class="holdbar"><span class="muted small">Restoring: it comes back parked…</span><span class="err" id="e-hold-${esc(id)}"></span></div>' }],
  ['hold-bar', 'Mark met', { html: '<div class="holdbar"><button type="button" data-met-id="g-1">Mark met</button><span class="muted small">your yes marks it met</span><span class="err" id="e-met-g-1"></span></div>', from: '<div class="holdbar"><button type="button" data-met-id="${esc(g.id)}">Mark met</button><span class="muted small">${[\'repo\', \'prod\'].includes(g.measure?.source) ? \'its check runs again first\' : \'your yes marks it met\'}</span><span class="err" id="e-met-${esc(g.id)}"></span></div>' }],
  ['row-inline', 'Default', { html: '<div class="row-inline"><input type="text" data-overrule="q-1" placeholder="Your answer instead"><button class="ghost" data-overrule-send="q-1">Overrule</button><span class="err" id="e-q-1"></span></div>', from: '<div class="row-inline"><input type="text" data-overrule="${esc(q.id)}" placeholder="Your answer instead"><button class="ghost" data-overrule-send="${esc(q.id)}">Overrule</button><span class="err" id="e-${esc(q.id)}"></span></div>' }],
  ['row-line', 'Default', { html: '<div class="rowline"><span class="dot amber"></span><span class="t" title="Retried 3 times">Retried 3 times</span><span class="r">retries</span></div>', from: '<div class="rowline"${open}><span class="dot amber"></span><span class="t" title="${esc(w.detail)}">${linkify(w.detail)}</span><span class="r">${esc(k)}</span></div>' }],
  ['row-line', 'Opens a record', { html: '<div class="rowline" data-open="observation/o-1" tabindex="0" role="link"><span class="dot red"></span><span class="t">Disk at 91%</span><span class="r">Nov 27</span></div>', from: '<div class="rowline" data-open="${esc(open)}" tabindex="0" role="link"><span class="dot ${dot}"></span><span class="t">${esc(t)}</span><span class="r">${esc(r)}</span></div>' }],
  ['row-line', 'With its own class', { html: '<div class="rowline set-row" data-setting="workers"><span class="t"><span class="set-name">Workers</span> <code class="set-key">workers</code></span></div>', from: '<div class="rowline set-row${e.key === SET_MARK ? \' tl-marked\' : \'\'}" data-setting="${esc(e.key)}"><span class="t"><span class="set-name">${esc(e.name)}</span> <code class="set-key">${esc(e.key)}</code></span>', prefix: true }],
  ['rows', 'Default', { html: '<div class="rows"><div class="rowline"><span class="dot green"></span><span class="t">Nothing waiting</span></div></div>', from: '<div class="rows">', prefix: true }],
  ['rows', 'With its own class', { html: '<div class="rows sensor-rows"><div class="rowline"><span class="dot blue"></span><span class="t">Load is normal</span></div></div>', from: '<div class="rows sensor-rows">', prefix: true }],
  ['section', 'Default', { html: '<section class="sec"><div class="lbl">Score</div><div class="sec-b"><p class="empty">None</p></div></section>', from: '<section class="sec"><div class="lbl">${esc(label)}</div><div class="sec-b">${body}</div></section>' }],
  ['section', 'A group', { html: '<div class="sec"><div class="lbl">Workers</div><div class="rows"><div class="rowline"><span class="t">Limit</span></div></div></div>', from: '<div class="sec"><div class="lbl">${esc(g)}</div><div class="rows">${rows.map(settingRowHtml).join(\'\')}</div></div>' }],
  ['segmented', 'Default', { html: '<span class="seg" role="group" aria-label="Which threads"><button type="button" data-thf="open" aria-pressed="true">Open <span class="n">3</span></button><button type="button" data-thf="resolved" aria-pressed="false">Resolved <span class="n">12</span></button></span>', from: '<span class="seg" role="group" aria-label="Which threads">${[[\'open\', \'Open\', open.length], [\'resolved\', \'Resolved\', resolved.length]].map(([k, w, n]) => `<button type="button" data-thf="${k}" aria-pressed="${k === which}">${w} <span class="n">${n}</span></button>`).join(\'\')}</span>' }],
  ['segmented', 'Compact', { html: '<span class="seg2" role="group" aria-label="View"><button type="button" data-mdview="rendered" aria-pressed="true">Rendered</button><button type="button" data-mdview="raw" aria-pressed="false">Raw</button></span>', from: '<span class="seg2" role="group" aria-label="View"><button type="button" data-mdview="rendered" aria-pressed="${mode === \'rendered\'}">Rendered</button><button type="button" data-mdview="raw" aria-pressed="${mode === \'raw\'}">Raw</button></span>' }],
  ['segmented', 'One button', { html: '<span class="seg2" role="group" aria-label="Hold"><button type="button" data-hold-id="g-12" data-mode="restore">Restore (parked)</button></span>', from: '<span class="seg2" role="group" aria-label="Hold"><button type="button" data-hold-id="${esc(id)}" data-mode="restore">Restore (parked)</button></span>' }],
  ['select', 'Default', { html: '<select data-f="kind" aria-label="Kind"><option value="">Any kind</option><option value="bug">Bug</option><option value="feature">Feature</option></select>', from: '<select data-f="${k}" aria-label="${label}">${inner}</select>' }],
  ['select', 'A chosen option', { html: '<select data-impact="k-1" aria-label="What it is"><option value="4">4: it changed the outcome</option><option value="3">3: it saved real time</option><option value="2" selected>2: it helped a little</option><option value="1">1: no effect</option></select>', from: '<select data-impact="${esc(key)}" aria-label="What it is">', prefix: true }],
  ['stat', 'Default', { html: '<div class="stat"><span>calls since Nov 2</span><b>14</b></div>', from: '<div class="stat"><span>${esc(`${k} since ${since}`)}</span><b>${esc(v ?? 0)}</b></div>' }],
  ['stat', 'With a line under it', { html: '<div class="stat" title="What a point of work cost"><span class="k">Cost</span><b>$4.10</b><span class="dim">per point</span></div>', from: '<div class="stat"${tip(t)}><span class="k">${k}</span><b>${v}</b><span class="dim">${esc(s)}</span></div>' }],
  ['table', 'Numbers', { html: '<div class="scroll"><table class="nums"><tr><th></th><th>This retro</th><th>The one before</th></tr><tr><td>Tickets merged</td><td>12</td><td>9</td></tr><tr><td>Hours</td><td>31</td><td>40</td></tr></table></div>', from: '<div class="scroll"><table class="nums"><tr><th></th><th>This retro</th><th>The one before</th></tr>', prefix: true }],
  ['table', 'Gate runs', { html: '<div class="scroll"><table class="gates-table"><tr><th>Commit</th><th>test</th><th>lint</th></tr><tr><td><code>a1f984fc0fc5</code></td><td title="test at a1f984fc0fc5: passed, 41.2s"><span class="gate-dot ok">✓</span></td><td class="muted">–</td></tr></table></div>', from: '<div class="scroll"><table class="gates-table"><tr><th>Commit</th>', prefix: true }],
  ['table', 'With a data attribute', { html: '<div class="scroll"><table class="nums" data-learning-figures><tr><th></th><th>Figure</th><th>Count</th><th>What it counted</th></tr><tr><td>1</td><td>Lessons kept</td><td>14</td><td>lessons an agent read and followed</td></tr></table></div>', from: '<div class="scroll"><table class="nums" data-learning-figures><tr><th></th><th>Figure</th><th>Count</th><th>What it counted</th></tr>', prefix: true }],
  ['text-area', 'Default', { html: '<textarea data-q="q-1" placeholder="Add a note (optional)"></textarea>', from: '<textarea data-q="${esc(q.id)}" placeholder="Add a note (optional)">${esc(drafts[q.id] || \'\')}</textarea>' }],
  ['text-area', 'With a draft', { html: '<textarea data-q="q-1" placeholder="Add a note (optional)">Ship it on Friday, after the release.</textarea>', from: '<textarea data-q="${esc(q.id)}" placeholder="Add a note (optional)">${esc(drafts[q.id] || \'\')}</textarea>' }],
  ['text-area', 'Rows and a limit', { html: '<textarea data-know-note="k-1" rows="1" maxlength="600" placeholder="Add a note to refine it (optional): it goes with the lesson into every prompt"></textarea>', from: '<textarea data-know-note="${esc(k.id)}" rows="1" maxlength="600" placeholder="Add a note to refine it (optional): it goes with the lesson into every prompt">', prefix: true }],
  ['text-area', 'With an id', { html: '<textarea id="tl-c-text" rows="2" placeholder="Message"></textarea>', from: '<textarea id="tl-c-text" rows="2" placeholder="Message"></textarea>' }],
  ['text-field', 'Default', { html: '<input type="text" data-overrule="q-1" placeholder="Your answer instead">', from: '<input type="text" data-overrule="${esc(q.id)}" placeholder="Your answer instead">' }],
  ['text-field', 'With an id and a limit', { html: '<input type="text" id="tl-outcome" maxlength="300" placeholder="How it ended, in a line (optional)">', from: '<input type="text" id="tl-outcome" maxlength="300" placeholder="How it ended, in a line (optional)">' }],
  ['timeline', 'Default', { html: '<ol class="tl"><li class="q"><time>Nov 26</time>Asked which release to cut</li><li class="act"><time>Nov 27</time>Released v0.107.0</li></ol>', from: '<ol class="tl">${items.map(([l, [c, h]]) => `<li class="${c}"><time>${when(l.at)}</time>${h}</li>`).join(\'\')}</ol>' }],
  ['timeline', 'Commits', { html: '<ol class="tl"><li><time>Nov 27</time>Merge kit-1040 <span class="muted">· reviewer · <code>a1f984fc0fc5</code></span></li></ol>', from: '<ol class="tl">${cs.map((c) => `<li><time>${esc(when(c.at))}</time>${esc(c.subject)} <span class="muted">· ${esc(c.author)} · <code>${esc(c.sha.slice(0, 12))}</code></span></li>`).join(\'\')}</ol>' }],
  ['title-link', 'Default', { html: '<a class="title-link" href="#goal/upkeep">Upkeep</a>', from: '<a class="title-link" href="#goal/upkeep">Upkeep</a>' }],
  ['title-link', 'A bold title', { html: '<a class="title-link" href="#ticket/kit-1041"><b>The first shared components</b></a>', from: '<a class="title-link" href="${esc(peekFor(\'ticket\', t.id))}"><b>${esc(t.title)}</b></a>' }],
  // the shared helpers' output (checks/helper-html.mjs wrote these; U2 checks each against its helper)
  ['card-head', 'Default', { helper: 'cardHead', args: ['target', 'Ship the hub', {}], html: '<div class="card-head"><i class="icon-target" aria-hidden="true"></i>Ship the hub<span class="grow"></span></div>' }],
  ['card-head', 'With extra', { helper: 'cardHead', args: ['activity', 'disk', { extra: '<span class="badge good">ok</span>' }], html: '<div class="card-head"><i class="icon-activity" aria-hidden="true"></i>disk<span class="grow"><span class="badge good">ok</span></span></div>' }],
  ['card-head', 'With its menu', { helper: 'cardHead', args: ['flag', 'Ship the hub', { id: 'g-12', open: 'goal/g-12' }], html: '<div class="card-head"><i class="icon-flag" aria-hidden="true"></i>Ship the hub<span class="grow"></span><details class="menu"><summary aria-label="Details"><i class="icon-ellipsis" aria-hidden="true"></i></summary><div class="pop"><div class="kv"><span>ID</span><code>g-12</code></div><button class="ghost" data-copy="g-12">Copy ID</button><button type="button" class="ghost" data-menu-open="goal/g-12">Open in side peek</button></div></details></div>' }],
  ['card-head', 'With a lead', { helper: 'cardHead', args: ['target', 'Ship the hub', { lead: '<button type="button" class="goal-grip" data-goal-grip="g-12" aria-label="Reorder Ship the hub" title="Drag to reorder; or ↑ and ↓"><i class="icon-grip-vertical" aria-hidden="true"></i></button>' }], html: '<div class="card-head"><button type="button" class="goal-grip" data-goal-grip="g-12" aria-label="Reorder Ship the hub" title="Drag to reorder; or ↑ and ↓"><i class="icon-grip-vertical" aria-hidden="true"></i></button><i class="icon-target" aria-hidden="true"></i>Ship the hub<span class="grow"></span></div>' }],
  ['card-menu', 'Default', { helper: 'menuOf', args: ['t-20261127-1', [], null], html: '<details class="menu"><summary aria-label="Details"><i class="icon-ellipsis" aria-hidden="true"></i></summary><div class="pop"><div class="kv"><span>ID</span><code>t-20261127-1</code></div><button class="ghost" data-copy="t-20261127-1">Copy ID</button></div></details>' }],
  ['card-menu', 'Rows and a peek', { helper: 'menuOf', args: ['g-12', [['Created', 'Nov 2'], ['By', 'owner']], 'goal/g-12'], html: '<details class="menu"><summary aria-label="Details"><i class="icon-ellipsis" aria-hidden="true"></i></summary><div class="pop"><div class="kv"><span>ID</span><code>g-12</code><span>Created</span><span>Nov 2</span><span>By</span><span>owner</span></div><button class="ghost" data-copy="g-12">Copy ID</button><button type="button" class="ghost" data-menu-open="goal/g-12">Open in side peek</button></div></details>' }],
  ['card-menu', 'A record card', { helper: 'cardMenu', args: ['ticket', 'kit-1041', [['Phase', 'build']]], html: '<details class="menu"><summary aria-label="Details"><i class="icon-ellipsis" aria-hidden="true"></i></summary><div class="pop"><div class="kv"><span>ID</span><code>kit-1041</code><span>Phase</span><span>build</span></div><button class="ghost" data-copy="kit-1041">Copy ID</button><button type="button" class="ghost" data-menu-open="ticket/kit-1041">Open in side peek</button></div></details>' }],
  ['card-menu', 'Extra actions', { helper: 'menuOf', args: [null, [['Moved', 'by the owner']], null, '<button type="button" class="ghost" data-move="up">Move up</button>'], html: '<details class="menu"><summary aria-label="Details"><i class="icon-ellipsis" aria-hidden="true"></i></summary><div class="pop"><div class="kv"><span>Moved</span><span>by the owner</span></div><button type="button" class="ghost" data-move="up">Move up</button></div></details>' }],
  ['empty', 'Default', { helper: 'empty', args: ['None'], html: '<p class="empty">None</p>' }],
  ['empty', 'With code', { helper: 'empty', args: ['No sensors yet: add one with <code>devteam sensor add</code>.'], html: '<p class="empty">No sensors yet: add one with <code>devteam sensor add</code>.</p>' }],
  ['empty', 'Long text', { helper: 'empty', args: ['Nothing has been learned yet. Lessons appear here once the supervisor turns repeated observations into a rule the next sessions read, and you accept it.'], html: '<p class="empty">Nothing has been learned yet. Lessons appear here once the supervisor turns repeated observations into a rule the next sessions read, and you accept it.</p>' }],
  ['fleet-switch', 'Run', { helper: 'fleetSwitch', args: [{ scope: 'project', mode: 'run' }], html: '<div class="fleet-switch" data-scope="project" data-mode="run"><span class="k"><span class="dot green"></span>Fleet</span><span class="seg" role="group" aria-label="The whole fleet: run, drain or park"><button type="button" data-fleet="run" title="Workers start and continue tickets" aria-pressed="true">Run</button><button type="button" data-fleet="drain" title="Workers finish what they have; nothing new starts" aria-pressed="false">Drain</button><button type="button" data-fleet="park" title="Every session stops where it is" aria-pressed="false">Park</button></span></div>' }],
  ['fleet-switch', 'Drain', { helper: 'fleetSwitch', args: [{ scope: 'project', mode: 'drain' }], html: '<div class="fleet-switch" data-scope="project" data-mode="drain"><span class="k"><span class="dot amber"></span>Fleet</span><span class="seg" role="group" aria-label="The whole fleet: run, drain or park"><button type="button" data-fleet="run" title="Workers start and continue tickets" aria-pressed="false">Run</button><button type="button" data-fleet="drain" title="Workers finish what they have; nothing new starts" aria-pressed="true">Drain</button><button type="button" data-fleet="park" title="Every session stops where it is" aria-pressed="false">Park</button></span></div>' }],
  ['fleet-switch', 'Park, confirming', { helper: 'fleetSwitch', args: [{ scope: 'project', mode: 'run', confirming: true }], html: '<div class="fleet-switch" data-scope="project" data-mode="run" data-confirming="1"><span class="k"><span class="dot green"></span>Fleet</span><span class="seg" role="group" aria-label="The whole fleet: run, drain or park"><button type="button" data-fleet="run" title="Workers start and continue tickets" aria-pressed="true">Run</button><button type="button" data-fleet="drain" title="Workers finish what they have; nothing new starts" aria-pressed="false">Drain</button><button type="button" data-fleet="park" class="confirm" data-confirm="1" title="Every session stops where it is" aria-pressed="false">Confirm park</button></span></div>' }],
  ['fleet-switch', 'Machine, mixed', { helper: 'fleetSwitch', args: [{ scope: 'machine', mode: 'mixed', counts: { running: 2, draining: 1, parked: 1 }, confirming: true }], html: '<div class="fleet-switch" data-scope="machine" data-mode="mixed" data-confirming="1"><span class="k"><span class="dot amber"></span>Mixed: 2 running, 1 draining, 1 parked</span><span class="seg" role="group" aria-label="Every fleet on this machine: run, drain or park"><button type="button" data-fleet="run" title="Workers start and continue tickets" aria-pressed="false">Run</button><button type="button" data-fleet="drain" title="Workers finish what they have; nothing new starts" aria-pressed="false">Drain</button><button type="button" data-fleet="park" class="confirm" data-confirm="1" title="Every session stops where it is" aria-pressed="false">Park 3 projects?</button></span></div>' }],
  ['fleet-switch', 'A hub row', { helper: 'fleetSwitch', args: [{ scope: 'row', mode: 'park' }], html: '<div class="fleet-switch" data-scope="row" data-mode="park"><span class="k"><span class="dot "></span></span><span class="seg" role="group" aria-label="This project: run, drain or park"><button type="button" data-fleet="run" title="Workers start and continue tickets" aria-pressed="false">Run</button><button type="button" data-fleet="drain" title="Workers finish what they have; nothing new starts" aria-pressed="false">Drain</button><button type="button" data-fleet="park" title="Every session stops where it is" aria-pressed="true">Park</button></span></div>' }],
  ['fleet-switch', 'Busy', { helper: 'fleetSwitch', args: [{ scope: 'project', mode: 'drain', busy: 'Draining…' }], html: '<div class="fleet-switch" data-scope="project" data-mode="drain"><span class="k"><span class="dot amber"></span>Fleet</span><span class="seg" role="group" aria-label="The whole fleet: run, drain or park"><button type="button" data-fleet="run" title="Workers start and continue tickets" aria-pressed="false" disabled>Run</button><button type="button" data-fleet="drain" title="Workers finish what they have; nothing new starts" aria-pressed="true" disabled>Drain</button><button type="button" data-fleet="park" title="Every session stops where it is" aria-pressed="false" disabled>Park</button></span><span class="msg">Draining…</span></div>' }],
  ['fleet-switch', 'Error', { helper: 'fleetSwitch', args: [{ scope: 'project', mode: 'run', error: 'The kit refused: not the host' }], html: '<div class="fleet-switch" data-scope="project" data-mode="run"><span class="k"><span class="dot green"></span>Fleet</span><span class="seg" role="group" aria-label="The whole fleet: run, drain or park"><button type="button" data-fleet="run" title="Workers start and continue tickets" aria-pressed="true">Run</button><button type="button" data-fleet="drain" title="Workers finish what they have; nothing new starts" aria-pressed="false">Drain</button><button type="button" data-fleet="park" title="Every session stops where it is" aria-pressed="false">Park</button></span><span class="err">The kit refused: not the host</span></div>' }],
  ['heartbeat', 'Two weeks', { helper: 'heartbeat', args: [[{ day: '2026-11-14' }, { day: '2026-11-15', items: ['metrics'] }, { day: '2026-11-16', items: ['metrics', 'lessons'] }, { day: '2026-11-17' }, { day: '2026-11-18', items: ['a', 'b', 'c'] }, { day: '2026-11-19', items: ['a', 'b', 'c', 'd', 'e'] }, { day: '2026-11-20', failed: true, items: ['metrics'] }, { day: '2026-11-21' }, { day: '2026-11-22', items: ['metrics'] }, { day: '2026-11-23' }, { day: '2026-11-24', items: ['release'] }, { day: '2026-11-25' }, { day: '2026-11-26', items: ['metrics', 'lessons'] }, { day: '2026-11-27', items: ['metrics'] }]], html: '<div class="heartbeat" role="img" aria-label="Upkeep, the last 14 days" style="--hb-n:14"><i class="" title="Nov 14: quiet"></i><i class="l1" title="Nov 15: metrics"></i><i class="l2" title="Nov 16: metrics, lessons"></i><i class="" title="Nov 17: quiet"></i><i class="l3" title="Nov 18: a, b, c"></i><i class="l4" title="Nov 19: a, b, c, d, e"></i><i class="bad" title="Nov 20: metrics"></i><i class="" title="Nov 21: quiet"></i><i class="l1" title="Nov 22: metrics"></i><i class="" title="Nov 23: quiet"></i><i class="l1" title="Nov 24: release"></i><i class="" title="Nov 25: quiet"></i><i class="l2" title="Nov 26: metrics, lessons"></i><i class="l1" title="Nov 27 (today): metrics"></i></div><div class="hb-labels"><span>Nov 14</span><span>today</span></div>' }],
  ['heartbeat', 'A failed day', { helper: 'heartbeat', args: [[{ day: '2026-11-26' }, { day: '2026-11-27', failed: true }]], html: '<div class="heartbeat" role="img" aria-label="Upkeep, the last 2 days" style="--hb-n:2"><i class="" title="Nov 26: quiet"></i><i class="bad" title="Nov 27 (today): quiet"></i></div><div class="hb-labels"><span>Nov 26</span><span>today</span></div>' }],
  ['heartbeat', 'No days', { helper: 'heartbeat', args: [[]], html: '<div class="heartbeat" role="img" aria-label="Upkeep, the last 0 days" style="--hb-n:1"></div><div class="hb-labels"><span></span><span>today</span></div>' }],
  ['peek-section', 'Default', { helper: 'psect', args: ['Observations it made', '<p class="empty">None</p>'], html: '<div class="card psect"><div class="card-head"><span class="grow">Observations it made</span></div><div class="psect-body"><p class="empty">None</p></div></div>' }],
  ['peek-section', 'With rows', { helper: 'psect', args: ['Incidents', '<div class="rows sensor-rows"><div class="rowline" data-open="problem/p-7" tabindex="0" role="link"><span class="dot amber"></span><span class="t">Disk fills up</span><span class="r">Nov 27</span></div></div>'], html: '<div class="card psect"><div class="card-head"><span class="grow">Incidents</span></div><div class="psect-body"><div class="rows sensor-rows"><div class="rowline" data-open="problem/p-7" tabindex="0" role="link"><span class="dot amber"></span><span class="t">Disk fills up</span><span class="r">Nov 27</span></div></div></div></div>' }],
  ['pill', 'Building', { helper: 'statusPill', args: ['building'], html: '<span class="pill green">Building</span>' }],
  ['pill', 'Moving', { helper: 'statusPill', args: ['moving'], html: '<span class="pill blue">Moving</span>' }],
  ['pill', 'Waiting on you', { helper: 'statusPill', args: ['waiting'], html: '<span class="pill amber">Waiting on you</span>' }],
  ['pill', 'Fully blocked', { helper: 'statusPill', args: ['blocked'], html: '<span class="pill red">Fully blocked</span>' }],
  ['pill', 'Idle', { helper: 'statusPill', args: ['idle'], html: '<span class="pill">Idle</span>' }],
  ['props-table', 'Default', { helper: 'props', args: [[['Ticket', 'kit-1041'], ['Phase', 'spec']]], html: '<dl class="props"><dt>Ticket</dt><dd>kit-1041</dd><dt>Phase</dt><dd>spec</dd></dl>' }],
  ['props-table', 'With tips', { helper: 'props', args: [[['Risk', 'normal', 'How likely the change breaks something'], ['Size', 'M']]], html: '<dl class="props"><dt title="How likely the change breaks something" tabindex="0">Risk</dt><dd>normal</dd><dt>Size</dt><dd>M</dd></dl>' }],
  ['props-table', 'An empty value', { helper: 'props', args: [[['Owner', null]]], html: '<dl class="props"><dt>Owner</dt><dd></dd></dl>' }],
  ['props-table', 'No rows', { helper: 'props', args: [[]], html: '<dl class="props"></dl>' }],
  ['tab-bar', 'Default', { helper: 'tabBar', args: [{ tabs: [{ id: 'open', label: 'Open', count: 3 }, { id: 'resolved', label: 'Resolved', count: 12 }], selected: 'open', panel: 'th-list' }], html: '<div class="tabbar" role="tablist"><button type="button" role="tab" data-tab="open" id="tab-th-list-open" aria-controls="th-list" aria-selected="true" tabindex="0">Open <span class="n">3</span></button><button type="button" role="tab" data-tab="resolved" id="tab-th-list-resolved" aria-controls="th-list" aria-selected="false" tabindex="-1">Resolved <span class="n">12</span></button></div>' }],
  ['tab-bar', 'A count waiting', { helper: 'tabBar', args: [{ tabs: [{ id: 'inbox', label: 'Inbox', count: 2, waiting: true }, { id: 'all', label: 'All' }], selected: 'all' }], html: '<div class="tabbar" role="tablist"><button type="button" role="tab" data-tab="inbox" aria-selected="false" tabindex="-1">Inbox <span class="n blue">2</span></button><button type="button" role="tab" data-tab="all" aria-selected="true" tabindex="0">All</button></div>' }],
  ['tab-bar', 'A disabled tab', { helper: 'tabBar', args: [{ tabs: [{ id: 'active', label: 'Active' }, { id: 'blocked', label: 'Blocked', disabled: true }], selected: 'blocked' }], html: '<div class="tabbar" role="tablist"><button type="button" role="tab" data-tab="active" aria-selected="true" tabindex="0">Active</button><button type="button" role="tab" data-tab="blocked" aria-selected="false" tabindex="-1" aria-disabled="true">Blocked</button></div>' }],
  ['tab-bar', 'Sub', { helper: 'tabBar', args: [{ tabs: [{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }], selected: 'week', size: 'sub' }], html: '<div class="tabbar sub" role="tablist"><button type="button" role="tab" data-tab="day" aria-selected="false" tabindex="-1">Day</button><button type="button" role="tab" data-tab="week" aria-selected="true" tabindex="0">Week</button></div>' }],
  ['tab-bar', 'No tabs', { helper: 'tabBar', args: [{ tabs: [] }], html: '<div class="tabbar" role="tablist"></div>' }],
];
export const EXPECT = {};
for (const [c, t, e] of ROWS) (EXPECT[c] ??= {})[t] = e;

// ---- always ----

const componentsIn = (ui) => (fs.existsSync(ui) ? fs.readdirSync(ui).filter((f) => f.endsWith('.tsx') && !f.endsWith('.specimens.tsx')).map((f) => f.slice(0, -4)).sort() : []);
// a specimens file's titles
const titlesIn = (file) => [...read(file).matchAll(/\btitle:\s*(['"])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2].replace(/\\(.)/g, '$1'));
const pascal = (n) => n.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');

test(`U1 the components in src/shared/ui/ are the ${NAMES.length}, each with its specimens file, whose titles are its EXPECT entries`, () => {
  const got = componentsIn(UI);
  assert.deepEqual({ missing: NAMES.filter((n) => !got.includes(n)), extra: got.filter((n) => !NAMES.includes(n)) }, { missing: [], extra: [] }, `the components in src/shared/ui/ are the ${NAMES.length}`);
  for (const n of NAMES) {
    const s = path.join(UI, `${n}.specimens.tsx`);
    assert.ok(fs.existsSync(s), `${n}.tsx has ${n}.specimens.tsx beside it`);
    assert.deepEqual([...titlesIn(s)].sort(), Object.keys(EXPECT[n] ?? {}).sort(), `${n}.specimens.tsx's titles are EXPECT's ${n} entries`);
  }
});

// A template, as a pattern: its literal text exact, each ${…} (braces balanced) a lazy wildcard. Inside an
// attribute's quoted value the wildcard holds no quote and no angle bracket, so it can't add an attribute or a
// tag (spec-2 F2-5); elsewhere in a tag (a template's `${dis}>`, which adds its own attributes) it holds no angle
// bracket; in text it holds anything (a view's content is markup).
export const templateRe = (from, { prefix = false, show = false, fill = false } = {}) => {
  let f = from;
  if (show) f = f.replace(/ hidden(?=[ >])/, '');
  if (fill) f = f.replace(/><\//, '>${…}</');
  let re = '', inTag = false, inQuote = false;
  for (let i = 0; i < f.length;) {
    if (f.startsWith('${', i)) {
      let depth = 0, j = i + 1;
      for (; j < f.length; j++) { if (f[j] === '{') depth++; else if (f[j] === '}' && --depth === 0) break; }
      re += inQuote ? '[^"<>]*?' : inTag ? '[^<>]*?' : '[\\s\\S]*?';
      i = j + 1;
    } else {
      const ch = f[i];
      if (inTag && ch === '"') inQuote = !inQuote;
      else if (!inQuote && ch === '<') inTag = true;
      else if (!inQuote && ch === '>') inTag = false;
      re += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); i++;
    }
  }
  return new RegExp(`^${re}${prefix ? '' : '$'}`);
};

// index.html's shared helpers, as U2 runs them: the devteam-shell-js block, and esc, empty, menuOf, cardMenu,
// psect, cardHead by name. Each helper, with what it reaches, is pinned at kit-1041's base by its hash: when it
// has changed since, or is gone, that helper's entries are a todo (the sweeps reconcile), not a failure.
const BASE = 'a1f984fc';
const HELPERS = ['tabBar', 'props', 'heartbeat', 'statusPill', 'fleetSwitch', 'empty', 'menuOf', 'cardMenu', 'psect', 'cardHead'];
export const helperSources = (src) => {
  const block = (name) => { const a = src.indexOf(`/* ${name} start */`), b = src.indexOf(`/* ${name} end */`); return a >= 0 && b > a ? src.slice(a, b) : null; };
  const line = (re) => src.match(re)?.[0] ?? null;
  const fn = (name) => { const a = src.search(new RegExp(`^function ${name}\\(`, 'm')); return a < 0 ? null : src.slice(a, src.indexOf('\n}\n', a) + 3); };
  const shell = block('devteam-shell-js');
  const pick = (re) => (shell ? (shell.match(re)?.[0] ?? null) : null);
  return {
    code: [shell, line(/^const esc = .*$/m), line(/^const empty = .*$/m), line(/^const menuOf = .*$/m), line(/^const cardMenu = .*$/m), line(/^const psect = .*$/m), fn('cardHead')],
    own: {
      tabBar: pick(/^function tabBar\([\s\S]*?\n\}\n/m), props: pick(/^const props = .*$/m), heartbeat: pick(/^function heartbeat\([\s\S]*?\n\}\n/m),
      statusPill: pick(/^const PULSE_STATES = [\s\S]*?^const statusPill = .*$/m), fleetSwitch: pick(/^const FLEET_MODES = [\s\S]*?^function fleetSwitch\([\s\S]*?\n\}\n/m),
      empty: line(/^const empty = .*$/m), menuOf: line(/^const menuOf = .*$/m), cardMenu: line(/^const cardMenu = .*$/m), psect: line(/^const psect = .*$/m), cardHead: fn('cardHead'),
    },
  };
};
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
// A helper with everything it reaches: the code U2 runs, cut into its top-level declarations (a declaration runs
// to the next one; comment lines dropped), and from the helper's own, each declaration whose name it holds, and so
// on. Its pin is the hash of those declarations' texts, so a change to what a helper calls (tabSelected, TAB_ID,
// escHtml, …) makes its entries a todo too (spec-2 F2-2).
const DECL = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
const declsOf = (code) => {
  const d = new Map();
  for (const chunk of code.filter((x) => x !== null)) {
    let name = null, body = [];
    const flush = () => { if (name) d.set(name, body.filter((l) => !/^\s*\/\//.test(l)).join('\n').trimEnd()); };
    for (const l of chunk.split('\n')) {
      const m = l.match(DECL);
      if (m) { flush(); name = m[1] ?? m[2]; body = [l]; } else if (name) body.push(l);
    }
    flush();
  }
  return d;
};
export const reach = (H, helper) => {
  const d = declsOf(H.code);
  if (!d.has(helper)) return null;
  const seen = new Set([helper]), todo = [helper];
  while (todo.length) {
    const text = d.get(todo.pop());
    for (const w of new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? [])) if (d.has(w) && !seen.has(w)) { seen.add(w); todo.push(w); }
  }
  return [...seen].sort().map((n) => `${n}\n${d.get(n)}`).join('\n\n');
};
// each helper with what it reaches (reach), at the base, by hash (checks/pin.mjs)
export const PINNED = { tabBar: '4f34a0daca4605e2', props: '157001bb2111398c', heartbeat: '3e59745a34475233', statusPill: '43b0fc9bb0048b17', fleetSwitch: '0872d013524b093f', empty: '1604d441f8ca5936', menuOf: '649881e9615d4211', cardMenu: '408ef3d8926ef3d0', psect: '5598f6273097f702', cardHead: 'a209ccd2d151a81f' };
const hasIndex = fs.existsSync(INDEX);
// The helpers, run in a context of their own; null where one can't be had (its source gone, or the code no
// longer runs on its own): never a throw at load.
const loadHelpers = (H) => {
  try {
    const c = vm.createContext({ URLSearchParams, location: { pathname: '/', search: '' } });
    vm.runInContext(`${H.code.filter((x) => x !== null).join('\n')}\n;globalThis.H = { ${HELPERS.map((h) => `${h}: typeof ${h} === 'function' ? ${h} : null`).join(', ')} };`, c, { timeout: 5000 });
    return c.H;
  } catch (e) { return { error: e }; }
};

test('U2 each helper entry is its helper\'s output, and each template entry matches its template in index.html (a changed one a todo)', { skip: hasIndex ? false : 'no docs/devteam/dashboard/index.html here' }, async (t) => {
  const src = read(INDEX);
  const H = helperSources(src);
  const helpers = loadHelpers(H);
  for (const [c, title, e] of ROWS) {
    if (e.helper) {
      const fn = helpers[e.helper];
      const reached = H.own[e.helper] === null ? null : reach(H, e.helper);
      const why = reached === null ? 'is gone' : sha(reached) !== PINNED[e.helper] ? 'or what it calls changed' : typeof fn !== 'function' ? `no longer runs on its own (${helpers.error?.message ?? 'not defined'})` : null;
      await t.test(`${c} · ${title}: ${e.helper}`, { todo: why ? `index.html's ${e.helper} ${why} since ${BASE}: the sweeps reconcile ${c}` : false }, () => {
        assert.equal(fn?.(...e.args), e.html, `${c} · ${title}: the html is ${e.helper}'s output`);
      });
    } else {
      const there = typeof e.from === 'string' && src.includes(e.from);
      await t.test(`${c} · ${title}: its template`, { todo: there ? false : `index.html no longer holds this template, as it did at ${BASE}: the sweeps reconcile ${c} (${String(e.from).slice(0, 60)}…)` }, () => {
        assert.match(e.html, templateRe(e.from, e), `${c} · ${title}: the html matches its template`);
      });
    }
  }
});

// a component's code with comments blanked, and the bodies of strings and templates blanked (for U3)
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const code = (src) => noComments(src).replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, (q) => `${q[0]}${q.slice(1, -1).replace(/./g, ' ')}${q[0]}`);
const FORBIDDEN = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'setInterval', 'setTimeout', 'localStorage', 'sessionStorage', 'document', 'window', 'location', 'useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useState', 'useReducer', 'useSyncExternalStore', 'useTransition', 'useOptimistic', 'useActionState', 'requestAnimationFrame', 'requestIdleCallback', 'queueMicrotask', 'navigator', 'self', 'globalThis'];

test('U3 every component: its props type exported and its default export typed by it, imports from react (or a sibling component) alone, no any, no data, no API, no effect', () => {
  for (const n of componentsIn(UI)) {
    const f = path.join(UI, `${n}.tsx`), src = read(f), c = code(src), P = `${pascal(n)}Props`;
    assert.match(src, new RegExp(`^export (?:type ${P} = \\{|interface ${P} \\{)`, 'm'), `${n}.tsx: export type ${P} = { … }`);
    assert.match(src, new RegExp(`^export default function ${pascal(n)}\\(\\{[^)]*\\}: ${P}\\)`, 'm'), `${n}.tsx: export default function ${pascal(n)}({ … }: ${P})`);
    for (const m of src.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) assert.ok(m[1] === 'react' || (/^\.\/[a-z][a-z0-9-]*$/.test(m[1]) && NAMES.includes(m[1].slice(2))), `${n}.tsx imports from react or a sibling component only: ${m[1]}`);
    assert.doesNotMatch(c, /\bany\b/, `${n}.tsx: no any`);
    for (const w of FORBIDDEN) assert.doesNotMatch(c, new RegExp(`\\b${w}\\b`), `${n}.tsx uses ${w}`);
    assert.doesNotMatch(c, /\buse[A-Z]\w*\s*\(/, `${n}.tsx calls a hook (a component holds no state and no effect)`);
    assert.doesNotMatch(c, /\bimport\s*\(/, `${n}.tsx imports at run time (import())`);
    assert.doesNotMatch(c, /\brequire\s*\(/, `${n}.tsx calls require()`);
    assert.doesNotMatch(src, /\/api\//, `${n}.tsx names /api/`);
  }
});

// The classes CSS names: a stylesheet's selectors, comments and `:not(…)` dropped (a class named only inside
// :not() isn't styled by that rule).
const SHARED_REGIONS = ['css-base', 'css-common', 'css-chrome', 'css-misc', 'css-view-only'];
const selectorClasses = (css) => {
  const sel = [...css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '').matchAll(/([^{}]+)\{/g)].map((m) => m[1]).join(' ');
  return new Set([...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
};
// kit-988's shell CSS (ruling m-20261127-202634922): layout.css, and shell.css's shared regions
export const sharedClasses = () => {
  const shellCss = read(path.join(DASH, 'src', 'views', 'shell', 'shell.css'));
  const parts = [read(path.join(DASH, 'src', 'shared', 'layout', 'layout.css'))];
  for (const r of SHARED_REGIONS) {
    const a = shellCss.indexOf(`/* ${r} start */`), b = shellCss.indexOf(`/* ${r} end */`);
    assert.ok(a >= 0 && b > a, `shell.css holds its ${r} region`);
    parts.push(shellCss.slice(a, b));
  }
  return selectorClasses(parts.join('\n'));
};
// every class any CSS names: index.html's and hub.html's <style> blocks, and every .css of both apps' src/
export const anyCssClasses = () => {
  const out = new Set();
  const styles = (f) => (fs.existsSync(f) ? [...read(f).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') : '');
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.css') ? [path.join(d, e.name)] : [])) : []);
  for (const css of [styles(INDEX), styles(HUB), ...[...walk(path.join(DASH, 'src')), ...walk(path.join(ROOT, 'apps', 'hub', 'src'))].map(read)]) for (const c of selectorClasses(css)) out.add(c);
  return out;
};
// The classes a base rule of another region styles (spec-3 F3-3): a rule of one class alone (`:where()` and
// pseudos dropped; no combinator, no id, no second class) in a region of index.html's <style> blocks that isn't
// kit-988's (devteam-layout and the five), or in a .css of the dashboard's views but shell.css's shared regions
// (and but the browser and canvas views, out of the sweeps).
// Such a class (`.dropbox`, `.qcard`) belongs to its view's sweep even where kit-988's CSS names it in passing.
// (The hub's own <style> isn't read: the hub renders neither of the two it restyles, `.badge` and `a.pill`, S14.)
const OURS = new Set(['devteam-layout', ...SHARED_REGIONS]);
const baseRuleClasses = (css) => {
  const out = new Set();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '').matchAll(/([^{}]+)\{/g)) for (const one of m[1].split(',')) {
    // a :where(…) that stands alone is an ancestor (`:where(.no-shell) .seg` styles a .seg outside the shell, not
    // every .seg); one attached to a compound only lowers its weight
    const bare = one.trim().replace(/(^|\s):where\((?:[^()]|\([^()]*\))*\)(?=\s)/g, '$1W').replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '').replace(/::?[a-z-]+(\([^()]*\))?/g, '').trim();
    if (!bare || /^@/.test(bare) || /[\s>+~#]/.test(bare) || (bare.match(/\./g) || []).length !== 1) continue;
    for (const c of bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(c[1]);
  }
  return out;
};
const regionsOfCss = (text) => {
  const out = [], stack = [];
  let buf = [];
  const flush = () => { if (buf.length) out.push([stack[stack.length - 1] ?? null, buf.join('\n')]); buf = []; };
  for (const l of text.split('\n')) {
    const st = l.match(/\/\* ([a-z0-9-]+) start \*\//), en = l.match(/\/\* ([a-z0-9-]+) end \*\//);
    if (st) { flush(); stack.push(st[1]); continue; }
    if (en && stack[stack.length - 1] === en[1]) { flush(); stack.pop(); continue; }
    buf.push(l);
  }
  flush();
  return out;
};
export const foreignClasses = () => {
  const out = new Set();
  const add = (css) => { for (const c of baseRuleClasses(css)) out.add(c); };
  if (fs.existsSync(INDEX)) for (const [r, css] of regionsOfCss([...read(INDEX).matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'))) if (r !== null && !OURS.has(r)) add(css);
  const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.css') ? [path.join(d, e.name)] : [])) : []);
  const shellCss = path.join(DASH, 'src', 'views', 'shell', 'shell.css'), layoutCss = path.join(DASH, 'src', 'shared', 'layout', 'layout.css');
  for (const f of walk(path.join(DASH, 'src', 'views'))) {
    if (f === shellCss) { for (const [r, css] of regionsOfCss(read(f))) if (r !== null && !OURS.has(r)) add(css); continue; }
    // the browser and canvas views are their own routes with their own stylesheets, out of the sweeps (the design)
    if (/[\\/]views[\\/](?:browser|canvas)[\\/]/.test(f)) continue;
    if (f !== layoutCss) add(read(f));
  }
  return out;
};
// the class-like words of a component: every word of every string literal (and template literal's text) whose
// words are all lowercase names, type unions included
// (a JSX attribute's value other than className's, role="group", and a typeof's type are not); NOT_CLASS: the few literals a
// component compares or types that aren't classes, each with why
export const NOT_CLASS = { 'fleet-switch': { row: 'its scope (a hub row): FleetSwitch writes no class from it' } };
export const literalWords = (src) => {
  const s = noComments(src).replace(/\b(?!className=)[a-zA-Z-]+=(["'])[^"'\n]*\1/g, ' ').replace(/\btypeof\s+[\w.]+\s*[!=]==?\s*(['"])\w+\1/g, ' ');
  const lits = [...s.matchAll(/'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g)].map((m) => (m[1] ?? m[2] ?? m[3].replace(/\$\{[^}]*\}/g, ' ')));
  return [...new Set(lits.filter((l) => /^\s*[a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*)*\s*$/.test(l)).flatMap((l) => l.trim().split(/\s+/)))];
};

test('U4 every class-like word a component holds is styled by kit-988\'s shell CSS (layout.css and shell.css\'s shared regions), or by no CSS at all, and by no base rule of another region', () => {
  const known = sharedClasses(), any = anyCssClasses(), foreign = foreignClasses();
  for (const n of componentsIn(UI)) {
    const words = literalWords(read(path.join(UI, `${n}.tsx`))).filter((w) => !Object.hasOwn(NOT_CLASS[n] ?? {}, w));
    const bad = words.filter((w) => !known.has(w) && any.has(w));
    assert.deepEqual(bad, [], `${n}.tsx holds ${bad.map((w) => `.${w}`).join(', ')}, which a CSS other than kit-988's styles`);
    const theirs = words.filter((w) => foreign.has(w));
    assert.deepEqual(theirs, [], `${n}.tsx holds ${theirs.map((w) => `.${w}`).join(', ')}, which a base rule of another region styles (its view's sweep moves it)`);
  }
});

// ---- in the tree, in Chrome ----

const KIT = path.join(ROOT, 'docs', 'devteam');
const inTree = fs.existsSync(path.join(KIT, 'scripts', 'cli.mjs')) && fs.existsSync(path.join(KIT, 'apps', 'dashboard', 'csp-hashes.json'));
const skipChrome = !inTree ? 'not in the tree: its CLI serves the built dashboard (node test/split/apps-try.mjs test/apps-ui.test.mjs)' : !canDrive ? 'no Chrome here' : false;
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const until = async (f, what, ms = 30000) => {
  const end = Date.now() + ms;
  for (;;) {
    let v = null, err = null;
    try { v = await f(); } catch (e) { err = e; }
    if (v) return v;
    if (Date.now() > end) assert.fail(`timed out: ${what}${err ? ` (${err.message})` : ''}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

// In the page: each node of a specimen's stage, against its expected markup parsed by a <template>, node by
// node, after normalize() joins adjacent text nodes. An element by its name and attributes (class as a set,
// style by declaration, and value, checked and selected by property on a form control); a text node exactly,
// whitespace too; only whitespace-only text at the stage's own edge is dropped. And every class on the stage's
// elements is kit-988's, an icon, a class-like word of a component's own source (which U4 vets where index.html
// is: the tree has no index.html, so no CSS of the views), or one the specimen passed in (args.ok).
// Returns, per entry, null or the first difference with its path.
const COMPARE = `((expect, ok) => {
  const FORM = new Set(['value', 'checked', 'selected']);
  const kids = (n) => { n.normalize(); return [...n.childNodes].filter((k) => k.nodeType === 1 || k.nodeType === 3); };
  const edge = (ks) => ks.filter((k, i) => !(k.nodeType === 3 && k.data.trim() === '' && (i === 0 || i === ks.length - 1)));
  const name = (e) => e.localName + (e.classList && e.classList.length ? '.' + [...e.classList].join('.') : '');
  const attrs = (e) => {
    const out = {};
    for (const a of e.attributes) {
      if (FORM.has(a.name) && /^(input|textarea|select|option)$/.test(e.localName)) continue;
      out[a.name] = a.name === 'class' ? [...e.classList].sort().join(' ') : a.name === 'style' ? [...e.style].map((p) => p + ':' + e.style.getPropertyValue(p).trim()).sort().join(';') : a.value;
    }
    for (const p of FORM) if (/^(input|textarea|select|option)$/.test(e.localName) && p in e) out['.' + p] = String(e[p]);
    return out;
  };
  const diff = (a, b, at) => {
    if (a.nodeType !== b.nodeType) return at + ': a ' + (a.nodeType === 1 ? 'element' : 'text ' + JSON.stringify(a.data)) + ' where ' + (b.nodeType === 1 ? 'an element' : 'text ' + JSON.stringify(b.data)) + ' is';
    if (a.nodeType === 3) return a.data === b.data ? null : at + ': text ' + JSON.stringify(a.data) + ', not ' + JSON.stringify(b.data);
    if (a.localName !== b.localName) return at + ': <' + a.localName + '>, not <' + b.localName + '>';
    const x = attrs(a), y = attrs(b);
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (x[k] !== y[k]) return at + ' ' + name(b) + ': ' + k + ' ' + JSON.stringify(x[k] ?? null) + ', not ' + JSON.stringify(y[k] ?? null);
    return list(kids(a), kids(b), at + (at ? ' > ' : '') + name(b));
  };
  const list = (as, bs, at) => {
    for (let i = 0; i < Math.max(as.length, bs.length); i++) {
      if (!as[i]) return at + ': missing ' + (bs[i].nodeType === 1 ? '<' + name(bs[i]) + '>' : 'text ' + JSON.stringify(bs[i].data));
      if (!bs[i]) return at + ': an extra ' + (as[i].nodeType === 1 ? '<' + name(as[i]) + '>' : 'text ' + JSON.stringify(as[i].data));
      const d = diff(as[i], bs[i], at);
      if (d) return d;
    }
    return null;
  };
  const out = {}, classes = {};
  for (const [c, specimens] of Object.entries(expect)) for (const [title, html] of Object.entries(specimens)) {
    const stage = document.querySelector('[data-ds-component="' + c + '"] [data-ds-specimen="' + CSS.escape(title) + '"] .ds-stage');
    if (!stage) { out[c + ' · ' + title] = 'no specimen on the page'; continue; }
    const t = document.createElement('template');
    t.innerHTML = html;
    out[c + ' · ' + title] = list(edge(kids(stage)), edge(kids(t.content)), '');
    const bad = [...new Set([...stage.querySelectorAll('[class]')].flatMap((e) => [...e.classList]))].filter((w) => !/^icon-/.test(w) && !ok.shared.includes(w) && !ok.words.includes(w) && !(ok.passed[c] || []).includes(w));
    if (bad.length) classes[c + ' · ' + title] = bad;
  }
  out.__classes = classes;
  out.__unexpected = [...document.querySelectorAll('[data-ds-component]')].flatMap((e) => [...e.querySelectorAll('[data-ds-specimen]')].map((f) => e.dataset.dsComponent + ' · ' + f.dataset.dsSpecimen)).filter((k) => { const [c, ...t] = k.split(' · '); return !(expect[c] && Object.hasOwn(expect[c], t.join(' · '))); });
  return out;
})`;
// the classes a specimens file passes in (its className literals): a view's own, on the elements it gives
const passedClasses = (n) => {
  const f = path.join(UI, `${n}.specimens.tsx`);
  const s = fs.existsSync(f) ? read(f) : '';
  return [...new Set([...s.matchAll(/className=(?:\{)?(["'`])([^"'`]*)\1/g)].flatMap((m) => m[2].split(/\s+/)).filter(Boolean))];
};

// The file's time, under test.yml's 300 s watchdog for a file: U5's bound and its teardown's.
const WATCHDOG = 300000, U5_TIMEOUT = 150000, TEARDOWN_MAX = 15000;

test('U5 in the tree: on /#design-system every specimen renders exactly its EXPECT markup, every class on it kit-988\'s, an icon, a word of a component\'s source or its specimen\'s, and every specimen has an entry', { skip: skipChrome, timeout: U5_TIMEOUT }, async (t) => {
  assert.ok(U5_TIMEOUT + TEARDOWN_MAX < WATCHDOG, 'U5 and its teardown fit the file watchdog');
  const later = cleanup(t);
  const live = (what) => { if (t.signal.aborted) throw new Error(`U5 is out of time: not starting ${what}`); };
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-ui-u5-'));
  later(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DEVTEAM_') && !['TMUX', 'TMUX_PANE'].includes(k)));
  const env = { ...clean, HOME: base, DEVTEAM_OWN_KIT: '1', DEVTEAM_HUB_PORT: String(PORTS + 6), DEVTEAM_PORT_BASE: String(PORTS + 7), CLAUDE_CONFIG_DIR: path.join(base, 'claude'), CODEX_HOME: path.join(base, 'codex') };
  // the tree's kit, in a project of its own, serving the tree's own built dashboard
  const root = bareProject(base, 'ui');
  assert.ok(fs.existsSync(path.join(root, 'docs', 'devteam', 'apps', 'dashboard', 'csp-hashes.json')), 'the project serves the tree\'s built dashboard');
  const port = await freePort();
  live('the dashboard server');
  const dash = spawn(process.execPath, [path.join(root, 'docs', 'devteam', 'scripts', 'cli.mjs'), 'dashboard', '--port', String(port)], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let said = '';
  dash.stdout.on('data', (d) => { said += d; });
  dash.stderr.on('data', (d) => { said += d; });
  // its whole process group, by the PID it started, and waited for
  later(() => new Promise((r) => {
    if (dash.exitCode !== null || dash.signalCode !== null) { try { process.kill(-dash.pid, 'SIGKILL'); } catch {} return r(); }
    const hard = setTimeout(() => { try { process.kill(-dash.pid, 'SIGKILL'); } catch {} }, 3000);
    dash.once('exit', () => { clearTimeout(hard); try { process.kill(-dash.pid, 'SIGKILL'); } catch {} r(); });
    try { process.kill(-dash.pid, 'SIGTERM'); } catch { r(); }
  }));
  await until(() => /dashboard on http/.test(said) || dash.exitCode !== null, 'the dashboard server', 60000);
  assert.match(said, /dashboard on http/, `the dashboard server started: ${said.slice(-600)}`);
  live('Chrome');
  const chrome = await openChrome();
  later(() => chrome.close());
  const p = await chrome.newPage();
  later(() => p.close());
  await p.send('Page.enable');
  await p.send('Runtime.enable');
  await p.send('Page.navigate', { url: `http://127.0.0.1:${port}/#design-system` });
  await until(() => p.ev("document.querySelectorAll('[data-view=\"design-system\"] [data-ds-component]').length > 0"), 'the design-system view drawn with its components');
  const expect = Object.fromEntries(Object.entries(EXPECT).map(([c, s]) => [c, Object.fromEntries(Object.entries(s).map(([title, e]) => [title, e.html]))]));
  const ok = { shared: [...sharedClasses()], words: [...new Set(componentsIn(UI).flatMap((n) => literalWords(read(path.join(UI, `${n}.tsx`)))))], passed: Object.fromEntries(NAMES.map((n) => [n, passedClasses(n)])) };
  const got = await p.ev(`${COMPARE}(${JSON.stringify(expect)}, ${JSON.stringify(ok)})`);
  assert.deepEqual(got.__unexpected, [], 'every specimen on the page has an EXPECT entry');
  assert.deepEqual(got.__classes, {}, 'every class on a specimen is kit-988\'s, an icon, a word of a component\'s source, or its specimen\'s');
  delete got.__unexpected;
  delete got.__classes;
  const differ = Object.entries(got).filter(([, d]) => d !== null).map(([k, d]) => `${k}: ${d}`);
  assert.deepEqual(differ, [], 'every specimen renders exactly its expected markup');
});
