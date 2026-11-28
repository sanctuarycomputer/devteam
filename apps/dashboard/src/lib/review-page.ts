// kit-999: review's lines of index.html (3662-4195 at 0dd991bb) but the review-bridge block, as index.html has them,
// with types: the Inbox's review card, the review panel (open, close, head, frame, answer bar, preview, drafts,
// links), the answer and send-back presses' review side, and holdState. No imports but reviewState's type, and no
// DOM at import: compiled to lib-dist/lib/review-page.js (a lib module that imports code fails in Turbopack or on
// Node, spec S7, S8). What these lines use from outside them comes through wireReview(), which
// src/views/review/wire.ts calls once with the real objects: six state objects (each rewritten name is shell.X,
// reviewState.X, peeksState.X, viewerState.X, goalsState.X or wordsState.X) and 26 functions of other views and
// modules, each a delegator below that throws until it is wired. index.html's colour-scheme and pagehide listeners'
// handlers are themeChange and pageHide; src/views/review/client.tsx registers them.
// `Loose` is `any`: the page's data has no fixed shape in index.html.
import type { reviewState as ReviewState } from '../views/review/state';
type Loose = any;
type Fn = (...a: Loose[]) => Loose;
// index.html loads marked and DOMPurify as page globals (I:23-24); kit-997 puts both on window (ruling 2)
declare const marked: Loose, DOMPurify: Loose;
let shell: Loose, reviewState: typeof ReviewState, peeksState: Loose, viewerState: Loose, goalsState: Loose, wordsState: Loose;
const wired: { [k: string]: Fn } = {};
const SEAMS = ["$","esc","subj","empty","cardHead","nextChip","nextTime","rankWhy","tlink","when","who","words","qplain","qinline","qblock","linkOf","rankRow","press","cardFields","putBackCard","answerPress","markAnswered","seenHash","peekHide","openFile","sha256Js"] as const;
export type ReviewWire = { shell: Loose; reviewState: typeof ReviewState; peeksState: Loose; viewerState: Loose; goalsState: Loose; wordsState: Loose } & { [k in (typeof SEAMS)[number]]: Fn };
// each key given replaces that key; the rest keep theirs
export function wireReview(w: Partial<ReviewWire>): void {
  if (w.shell) shell = w.shell;
  if (w.reviewState) reviewState = w.reviewState;
  if (w.peeksState) peeksState = w.peeksState;
  if (w.viewerState) viewerState = w.viewerState;
  if (w.goalsState) goalsState = w.goalsState;
  if (w.wordsState) wordsState = w.wordsState;
  for (const k of SEAMS) { const f = w[k]; if (typeof f === 'function') wired[k] = f; }
}
const need = (n: string): Fn => {
  const f = wired[n];
  if (typeof f !== 'function') throw new Error(`review: ${n} is not wired`);
  return f;
};
const $ = (...a: Loose[]) => need('$')(...a);
const esc = (...a: Loose[]) => need('esc')(...a);
const subj = (...a: Loose[]) => need('subj')(...a);
const empty = (...a: Loose[]) => need('empty')(...a);
const cardHead = (...a: Loose[]) => need('cardHead')(...a);
const nextChip = (...a: Loose[]) => need('nextChip')(...a);
const nextTime = (...a: Loose[]) => need('nextTime')(...a);
const rankWhy = (...a: Loose[]) => need('rankWhy')(...a);
const tlink = (...a: Loose[]) => need('tlink')(...a);
const when = (...a: Loose[]) => need('when')(...a);
const who = (...a: Loose[]) => need('who')(...a);
const words = (...a: Loose[]) => need('words')(...a);
const qplain = (...a: Loose[]) => need('qplain')(...a);
const qinline = (...a: Loose[]) => need('qinline')(...a);
const qblock = (...a: Loose[]) => need('qblock')(...a);
const linkOf = (...a: Loose[]) => need('linkOf')(...a);
const rankRow = (...a: Loose[]) => need('rankRow')(...a);
const press = (...a: Loose[]) => need('press')(...a);
const cardFields = (...a: Loose[]) => need('cardFields')(...a);
const putBackCard = (...a: Loose[]) => need('putBackCard')(...a);
const answerPress = (...a: Loose[]) => need('answerPress')(...a);
const markAnswered = (...a: Loose[]) => need('markAnswered')(...a);
const seenHash = (...a: Loose[]) => need('seenHash')(...a);
const peekHide = (...a: Loose[]) => need('peekHide')(...a);
const openFile = (...a: Loose[]) => need('openFile')(...a);
const sha256Js = (...a: Loose[]) => need('sha256Js')(...a);

// ---- review questions: the agent's page in a sandboxed frame; the answer in the dashboard's own panel ----
// The page may only propose a result. The panel below it shows that exact result, drawn by this
// code and not the page's, and posts those same bytes when the owner clicks Answer.
export const sha256Hex = async (bytes?: Loose) => {
  if (!window.crypto?.subtle) return sha256Js(bytes);
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b?: Loose) => b.toString(16).padStart(2, '0')).join('');
};

export const RV_MAX = 4 * 1024 * 1024;

// Drafts in this browser are keyed on the page's hash, so a page asked again never inherits one.
export const rvKey = (qid?: Loose, sha?: Loose) => `devteam.review.${qid}.${String(sha ?? '').slice(0, 12)}`;

export const lsGet = (k?: Loose) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };

export const lsSet = (k?: Loose, v?: Loose) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const lsDel = (k?: Loose) => { try { localStorage.removeItem(k); } catch {} };

export const isPlainObj = (x?: Loose) => !!x && typeof x === 'object' && !Array.isArray(x);

export const emptyVal = (x?: Loose) => x === null || x === undefined || x === '' || (Array.isArray(x) ? !x.length : typeof x === 'object' && !Object.keys(x).length);

// the owner's process compares values with proposals in this form: sorted keys, no whitespace
export const canonical = (v?: Loose): Loose => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k?: Loose): Loose => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v));

// verified at the pinned commit, or on main once a squash merge landed the files and deleted the branch
export const pinsVerified = (info?: Loose) => !!info && (info.reachable || info.landed) && (info.files || []).length > 0 && info.files.every((f?: Loose) => f.status === 'verified');

export const PIN_WORDS = { page: 'page', data: 'data', result_schema: 'schema' };

// ui-candidate: review-card (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function reviewCard(q?: Loose, o?: Loose, reasonText?: Loose) {
  const rv = q.review || {};
  const cls = q.class && o.classes[q.class];
  const local = lsGet(rvKey(q.id, rv.page?.sha256));
  const pr = local?.progress;
  const ok = q.result_status === 'verified';
  const why = q.why_asked?.reasons?.length ? `Why you: ${q.why_asked.reasons.map((r?: Loose) => esc(reasonText[r] || r)).join('; ')}.` : '';
  const declineOpen = !!shell.drafts[q.id];
  return `
    <div class="card qcard review${q.rank?.top ? ' top' : ''}" id="q-${esc(q.id)}" data-qcard="${esc(q.id)}"${subj('question', q.id, qplain(q.question, q.links))}>
      ${cardHead(wordsState.KIND_ICON.review, `${nextChip(q)}<span class="badge low">Review</span>`, { extra: (q.blocks || []).length ? `holds up ${q.blocks.map(tlink).join(', ')}` : q.ticket ? `about ${tlink(q.ticket)}` : '', id: q.id, rows: [['Asked', esc(when(q.asked_at))], ...(q.class ? [['Kind', esc(q.class)]] : []), ...rankRow(q)] })}
      ${rankWhy(q)}
      ${q.thread ? `<div class="meta from-thread">From a thread: <a class="linkish" href="#talk/${encodeURIComponent(q.thread)}">${esc(q.thread_title || 'a conversation with the supervisor')}</a></div>` : ''}
      ${q.rewritten ? '<p class="rewritten">This question changed after you answered it, so that answer no longer counts. Read it again before you answer: the supervisor\'s log was rewritten, which it should never do.</p>' : ''}
      ${q.new_because ? `<p class="again"><b>Asked again because:</b> ${esc(q.new_because)}</p>` : ''}
      <h4>${qinline(q.question, q.links)}</h4>
      ${q.context ? `<div class="ctx">${qblock(q.context, q.links)}</div>` : ''}
      <div class="meta rv-pins">${rv.data ? `${esc(rv.data.rows)} rows${rv.data.proposals ? `, ${esc(rv.data.proposals)} with a proposal` : ''} · ` : ''}page <code>${esc(String(rv.page?.sha256 ?? '').slice(0, 12))}</code> ${ok ? '<span class="badge good">verified</span>' : `<span class="badge high">${esc(q.result_status || 'missing')}</span>`}${rv.allow_partial ? ' · partial answers allowed' : ''}${pr && pr.total ? ` · <span class="badge ${pr.done >= pr.total ? 'good' : 'medium'}">${esc(pr.done)} of ${esc(pr.total)} decided</span>` : ''}</div>
      ${ok ? '' : '<p class="err">The page or data changed since the supervisor asked, so it can’t be answered. Send it back, or tell the supervisor to ask again.</p>'}
      ${(q.links || []).length ? `<div class="links"><span class="muted small">Look at:</span>${q.links.map(linkOf).join('')}</div>` : ''}
      ${nextTime(q, cls)}
      <div class="row-inline"><button data-open-review="${esc(q.id)}" ${ok ? '' : 'disabled'}>Open the review</button><button class="ghost" data-decline-open="${esc(q.id)}">Send it back</button><span class="err" id="e-${esc(q.id)}"></span></div>
      <div data-decline-form="${esc(q.id)}" ${declineOpen ? '' : 'hidden'}><textarea data-q="${esc(q.id)}" placeholder="What should change?">${esc(shell.drafts[q.id] || '')}</textarea><div class="row-inline"><button class="ghost" data-decline="${esc(q.id)}">Send it back</button></div></div>
      ${why ? `<div class="meta">${why}</div>` : ''}
    </div>`;
}

// A JSON value as a tree: an object or a list folds; a list says how many items it has.
// ui-candidate: json-tree (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function jsonTree(v?: Loose, key?: Loose, depth: Loose = 0): Loose {
  const k = key === undefined ? '' : `<span class="jk">${esc(key)}</span>: `;
  if (v === null || typeof v !== 'object') return `<div class="jl">${k}<span class="jv ${typeof v}">${esc(JSON.stringify(v))}</span></div>`;
  const arr = Array.isArray(v);
  const entries = arr ? v.map((x?: Loose, i?: Loose) => [i, x]) : Object.entries(v);
  if (!entries.length) return `<div class="jl">${k}<span class="jv">${arr ? '[]' : '{}'}</span></div>`;
  const sum = arr ? `${entries.length} item${entries.length === 1 ? '' : 's'}` : `{ ${entries.slice(0, 6).map(([x]: Loose) => esc(x)).join(', ')}${entries.length > 6 ? ', …' : ''} }`;
  if (depth > 40) return `<div class="jl">${k}<span class="dim">${sum} (nested too deep to show; see the raw JSON)</span></div>`;
  const cap = 300;
  return `<details ${depth < 1 ? 'open' : ''}><summary>${k}<span class="dim">${sum}</span></summary>${entries.slice(0, cap).map(([kk, x]: Loose) => jsonTree(x, kk, depth + 1)).join('')}${entries.length > cap ? `<div class="jl dim">… ${entries.length - cap} more (see the raw JSON)</div>` : ''}</details>`;
}

// The state of one row, by the rule the owner's process applies.
export function rowState(dataRow?: Loose, r?: Loose) {
  if (!r || r.decided !== true) return 'undecided';
  const values = isPlainObj(r.values) ? r.values : {};
  if (isPlainObj(dataRow.proposal) && canonical(values) === canonical(dataRow.proposal)) return 'kept';
  return Object.values(values).every(emptyVal) ? 'none' : 'changed';
}

export function optionLabeler(data?: Loose) {
  const maps = Object.fromEntries(Object.entries(isPlainObj(data?.options) ? data.options : {}).map(([k, list]: Loose) => [k, new Map((Array.isArray(list) ? list : []).map((o?: Loose) => (isPlainObj(o) ? [String(o.id), o.label ?? String(o.id)] : [String(o), String(o)])))]));
  const one = (key?: Loose, x?: Loose) => (maps[key]?.get(String(x)) ?? (typeof x === 'object' ? JSON.stringify(x) : String(x)));
  return (key?: Loose, v?: Loose) => (Array.isArray(v) ? (v.length ? v.map((x?: Loose) => one(key, x)).join(', ') : 'none') : emptyVal(v) ? 'none' : one(key, v));
}

// The trusted preview: the standard shape (data rows with proposals, result rows) as a table of
// what changes, changed rows first; anything else as a JSON tree.
// ui-candidate: result-table (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function resultPreview(result?: Loose, data?: Loose, fold: Loose = false) {
  const META = ['v', 'question', 'review_sha256', 'data_sha256', 'answered_at', 'channel', 'summary'];
  const rest = Object.fromEntries(Object.entries(result).filter(([k]: Loose) => !META.includes(k) && k !== 'rows'));
  if (!(Array.isArray(data?.rows) && Array.isArray(result.rows))) return `<div class="jtree">${jsonTree(Object.fromEntries(Object.entries(result).filter(([k]: Loose) => !['v', 'question', 'review_sha256', 'data_sha256'].includes(k))))}</div>`;
  const label = optionLabeler(data);
  const got = new Map(result.rows.filter(isPlainObj).map((r?: Loose) => [r.id, r]));
  const ORDER = { changed: 0, none: 1, undecided: 2, kept: 3 };
  const rows = data.rows.map((d?: Loose) => ({ d, r: got.get(d.id), state: rowState(d, got.get(d.id)) })).sort((a?: Loose, b?: Loose) => (ORDER as Loose)[a.state] - (ORDER as Loose)[b.state]);
  const n = (s?: Loose) => rows.filter((x?: Loose) => x.state === s).length;
  const strange = result.rows.filter((r?: Loose) => !isPlainObj(r) || !data.rows.some((d?: Loose) => d.id === r.id));
  const show = (key?: Loose, v?: Loose) => esc(label(key, v));
  const valuesCell = ({ d, r, state }: Loose) => {
    if (state === 'undecided') return '<span class="dim">not decided</span>';
    const values = isPlainObj(r.values) ? r.values : {};
    const prop = isPlainObj(d.proposal) ? d.proposal : {};
    const keys = [...new Set([...Object.keys(prop), ...Object.keys(values)])];
    return keys.map((k?: Loose) => {
      const now = values[k], was = prop[k];
      const lead = keys.length > 1 ? `<span class="dim">${esc(k)}:</span> ` : '';
      return state === 'kept' || canonical(now ?? null) === canonical(was ?? null) ? `<div>${lead}${show(k, now)}</div>` : `<div>${lead}<span class="dim">${k in prop ? show(k, was) : 'none'}</span><span class="arrow">→</span><b>${show(k, now)}</b></div>`;
    }).join('') + (r.note ? `<div class="rv-note">Note: ${esc(r.note)}</div>` : '');
  };
  const tr = (x?: Loose) => `<tr><td><code>${esc(x.d.id)}</code></td><td>${esc(x.d.title ?? '')}</td><td>${valuesCell(x)}</td><td><span class="rv-st ${x.state}">${x.state}</span></td></tr>`;
  const head = '<tr><th>Id</th><th>Title</th><th>Proposal → answer</th><th>State</th></tr>';
  const first = rows.slice(0, 20), more = rows.slice(20);
  const counts = `<b>${n('kept')}</b> kept · <b>${n('changed')}</b> changed · <b>${n('none')}</b> none · <b>${n('undecided')}</b> undecided`;
  const table = `<div class="scroll"><table class="rv-table">${head}${first.map(tr).join('')}</table></div>
    ${more.length ? `<details><summary>${more.length} more row${more.length === 1 ? '' : 's'}</summary><div class="scroll"><table class="rv-table">${head}${more.map(tr).join('')}</table></div></details>` : ''}`;
  // folded (the review panel's answer bar): the counts are the summary and the rows open on demand
  return `${fold ? `<details class="rv-rows" data-rv-rows ${reviewState.RV?.rowsOpen ? 'open' : ''}><summary class="rv-counts">${counts} · <span class="linkish">${reviewState.RV?.rowsOpen ? 'hide' : 'show'} every row</span></summary>${table}</details>` : `<div class="rv-counts">${counts}</div>${table}`}
    ${strange.length ? `<p class="err">${strange.length} row${strange.length === 1 ? '' : 's'} in the result ${strange.length === 1 ? 'is' : 'are'} not in the data: ${strange.slice(0, 5).map((r?: Loose) => `<code>${esc(isPlainObj(r) ? r.id : JSON.stringify(r))}</code>`).join(', ')}</p>` : ''}
    ${Object.keys(rest).length ? `<h3 style="margin-top:10px">Also in the result</h3><div class="jtree">${jsonTree(rest)}</div>` : ''}`;
}

// Why Answer is off, if it is: the checks the owner's process runs, so the button says so first.
export function proposalProblems(p?: Loose, info?: Loose) {
  const r = p.obj, rv = info.review, out = [];
  if (p.bytes > RV_MAX) out.push(`The result is ${p.bytes} bytes; at most 4 MB.`);
  if (r.v !== 1) out.push('The result does not say "v": 1.');
  if (r.question !== info.id) out.push('The result names another question.');
  if (r.review_sha256 !== rv.page.sha256) out.push('The result does not name this page’s hash.');
  if (rv.data ? r.data_sha256 !== rv.data.sha256 : r.data_sha256 !== undefined) out.push('The result does not name this data’s hash.');
  if (Array.isArray(info.data?.rows) && r.rows !== undefined) {
    if (!Array.isArray(r.rows)) return [...out, 'Its rows are not a list.'];
    const known = new Set(info.data.rows.map((x?: Loose) => x.id));
    const seen = new Set();
    let undecided = 0;
    for (const x of r.rows) {
      if (!isPlainObj(x) || !known.has(x.id)) { out.push('A row in the result is not in the data.'); break; }
      if (seen.has(x.id)) { out.push(`Row ${x.id} is answered twice.`); break; }
      if (typeof x.decided !== 'boolean') { out.push(`Row ${x.id} says neither decided nor undecided.`); break; }
      seen.add(x.id);
      if (!x.decided) undecided++;
    }
    undecided += info.data.rows.filter((x?: Loose) => !seen.has(x.id)).length;
    if (undecided && !rv.allow_partial) out.push(`${undecided} row${undecided === 1 ? ' is' : 's are'} still undecided, and this review needs every row decided.`);
  }
  return out;
}

export const reviewInfo = () => reviewState.RV?.info;

export const tellFrame = (msg?: Loose) => { try { reviewState.RV?.frame?.contentWindow?.postMessage(msg, '*'); } catch {} };

export const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

export async function openReview(raw?: Loose) {
  const preview = raw.startsWith('review-preview');
  const params: Loose = preview ? new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '') : null;
  const qid: Loose = preview ? null : decodeURIComponent(raw.slice('review/'.length));
  const key = preview ? `preview?${params}` : `q:${qid}`;
  if (reviewState.RV && reviewState.RV.key === key) return;
  closeReview();
  if (!$('drawer').hidden) { peekHide({ now: true }); peeksState.DRAWER = { kind: null, id: null }; }
  const me: Loose = reviewState.RV = { key, qid, preview, info: null, frame: null, proposal: null, progress: null, dropped: 0, saveTimer: null, pending: null, saved: null, seq: 0, readonly: false };
  document.querySelector('main')!.classList.add('reviewing');
  $('review-view').hidden = false;
  $('scrim').hidden = false;
  document.body.classList.add('overlay-open');
  document.body.style.overflow = 'hidden';
  $('rv-head').innerHTML = '<p class="loading">Loading the review…</p>';
  $('rv-frame-wrap').innerHTML = '';
  $('rv-panel').hidden = true;
  $('rv-link').hidden = true;
  if (preview) {
    const path = params.get('path') || '', ref = params.get('ref') || '', dataPath = params.get('data') || '';
    let data = null, note = '';
    if (dataPath) {
      try {
        const r = await fetch(`/api/file?${new URLSearchParams({ path: dataPath, ...(ref ? { ref } : {}) })}`);
        const t = await r.text();
        if (!r.ok) throw new Error(t);
        data = JSON.parse(t);
      } catch (e: Loose) { note = `The data didn’t load: ${e.message}`; }
    }
    if (reviewState.RV !== me) return;
    me.info = { preview: true, path, ref, dataPath, data };
    renderReviewHead(note);
    if (path) mountFrame(`/review/preview/?${new URLSearchParams({ path, ...(ref ? { ref } : {}) })}`, path);
    renderReviewActions();
    renderReviewPreview();
    return;
  }
  let info;
  try {
    const r = await fetch(`/api/review?id=${encodeURIComponent(qid)}`);
    info = await r.json();
    if (!r.ok) throw new Error(info.error || `HTTP ${r.status}`);
  } catch (e: Loose) {
    if (reviewState.RV === me) $('rv-head').innerHTML = `<div class="card"><p class="err">${esc(e.message)}</p></div>`;
    return;
  }
  if (reviewState.RV !== me) return;
  me.info = info;
  me.readonly = info.status !== 'open';
  renderReviewHead();
  if (pinsVerified(info)) mountFrame(`/review/${encodeURIComponent(qid)}/`, info.review.title || info.question);
  renderReviewActions();
  renderReviewPreview();
}

export function closeReview() {
  if (!reviewState.RV) return false;
  if (reviewState.RV.pending) pushDraft(reviewState.RV);
  reviewState.RV = null;
  document.querySelector('main')!.classList.remove('reviewing');
  $('review-view').hidden = true;
  $('scrim').hidden = true;
  if (!viewerState.AV) document.body.classList.remove('overlay-open');
  document.body.style.overflow = '';
  $('rv-frame-wrap').innerHTML = '';
  $('rv-panel').hidden = true;
  $('rv-link').hidden = true;
  return true;
}

// ui-candidate: sandboxed-frame (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function mountFrame(src?: Loose, title?: Loose) {
  const f = document.createElement('iframe');
  // allow-scripts and nothing else: no same-origin, forms, popups, modals, downloads or top navigation
  f.setAttribute('sandbox', 'allow-scripts');
  f.className = 'rv-frame';
  f.title = `The agent’s page: ${title}`;
  f.src = src;
  reviewState.RV.frame = f;
  const label = document.createElement('div');
  label.className = 'rv-frame-label';
  label.innerHTML = '<i class="icon-shield" aria-hidden="true"></i><span>The agent’s page: sandboxed, no network, no access to this dashboard. It can only propose; check the bar below before you answer.</span>';
  $('rv-frame-wrap').replaceChildren(label, f);
}

// ui-candidate: icon-button (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export const RV_CLOSE = '<button class="ghost icon-btn" data-rv-close aria-label="Close the review"><i class="icon-x" aria-hidden="true"></i></button>';

// ui-candidate: review-head (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function renderReviewHead(note: Loose = '') {
  const info = reviewState.RV.info;
  const CLOSE = RV_CLOSE;
  if (reviewState.RV.preview) {
    $('rv-head').innerHTML = `<div class="rv-top"><span class="rv-preview-banner">PREVIEW, not asked</span><h4>${esc(info.path || 'No page given')}</h4><button class="ghost icon-btn" data-rv-close aria-label="Close the review"><i class="icon-x" aria-hidden="true"></i></button></div>
      <div class="rv-sub"><span><code>${esc(info.path)}</code>${info.ref ? ` at <code>${esc(info.ref)}</code>` : ' on main'}${info.dataPath ? ` · data <code>${esc(info.dataPath)}</code>${info.data ? '' : ' (not loaded)'}` : ' · no data (add &amp;data=&lt;path&gt;)'}</span>
      <span>This is how the owner will see the page. Nothing here is a question yet, so nothing can be answered or saved.</span></div>
      ${note ? `<p class="err">${esc(note)}</p>` : ''}${info.path ? '' : '<p class="err">Open it as #review-preview?path=&lt;repo path&gt;&amp;ref=&lt;branch&gt;&amp;data=&lt;repo path&gt;.</p>'}`;
    return;
  }
  const rv = info.review;
  const ok = pinsVerified(info);
  const pins = info.files.map((f?: Loose) => `${(PIN_WORDS as Loose)[f.role] || f.role} <code>${esc(f.sha256.slice(0, 12))}</code>`).join(' · ');
  const state = info.declined ? '<span class="badge medium">sent back</span>' : info.status === 'answered' ? '<span class="badge good">answered</span>' : info.status !== 'open' ? `<span class="badge">${esc(info.status)}</span>` : '';
  // the server resolves an open question's artifact links in the dashboard data, so use those when there
  const links = (shell.DATA?.questions || []).find((q?: Loose) => q.id === reviewState.RV.qid)?.links || info.links || [];
  // one line for the question, one for the facts; the rest folds away so the agent's page gets the height
  const more = [rv.title && rv.title !== info.question ? `<div class="rv-title">${esc(rv.title)}</div>` : '',
    `<div>${qinline(info.question, links)}</div>`,
    info.context ? `<div class="ctx">${qblock(info.context, links)}</div>` : '',
    links.length ? `<div class="links"><span class="muted small">Look at:</span>${links.map(linkOf).join('')}</div>` : '',
    `<div class="meta rv-pins">Asked by ${esc(who(info.asked_by))} · ${esc(when(info.asked_at))} · ${pins} · pinned at <code>${esc(String(rv.commit).slice(0, 12))}</code> (${esc(rv.ref)})${rv.allow_partial ? ' · partial answers allowed' : ''}</div>`].join('');
  $('rv-head').innerHTML = `<div class="rv-top"><i class="icon-${wordsState.KIND_ICON.review}" aria-hidden="true"></i><span class="badge low">Review</span>${state}<h4 title="${esc(qplain(info.question, links))}">${esc(rv.title || qplain(info.question, links))}</h4>${CLOSE}</div>
    <div class="rv-sub">${(info.blocks || []).length ? `<span>holds up ${info.blocks.map(tlink).join(', ')}</span>` : info.ticket ? `<span>about ${tlink(info.ticket)}</span>` : ''}${rv.data ? `<span>${esc(rv.data.rows)} rows</span>` : ''}${ok ? '<span class="badge good">verified</span>' : `<span class="badge high">${esc(info.result_status)}</span>`}<span id="rv-progress"></span>
      <details><summary>The question in full</summary><div>${more}</div></details></div>
    ${ok ? '' : '<div class="banner"><b>The page or data changed since the supervisor asked.</b> Nothing can be answered here. Tell the supervisor to ask again.</div>'}`;
  showProgress();
}

export function showProgress() {
  const el = $('rv-progress');
  const p = reviewState.RV?.progress;
  if (el) el.innerHTML = p && p.total ? `<span class="badge ${p.done >= p.total ? 'good' : 'medium'}">${esc(p.done)} of ${esc(p.total)} decided</span>` : '';
}

// The panel's right side, drawn once per view: autosave status, Answer, Send it back.
// ui-candidate: review-actions (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function renderReviewActions() {
  const info = reviewState.RV.info;
  $('rv-panel').hidden = false;
  if (!reviewState.RV.preview && reviewState.RV.readonly) { $('rv-actions').innerHTML = answeredActions(info); return; }
  const cls = !reviewState.RV.preview && info.class && shell.DATA?.ooda?.classes?.[info.class];
  $('rv-actions').innerHTML = `
    <span class="small dim" id="rv-saved">${reviewState.RV.preview ? 'Preview: nothing is saved.' : 'Your progress saves as you go, in this browser and on disk.'}</span>
    ${cls ? nextTime({ id: info.id, class: info.class }, cls, 'data-rv-auto') : ''}
    <button data-rv-answer disabled>Answer</button>
    <span class="rv-why" id="rv-why"></span>
    <button class="ghost" data-rv-decline-open ${reviewState.RV.preview ? 'disabled' : ''}>Send it back</button>
    <div id="rv-decline-form" hidden><textarea id="rv-decline-note" placeholder="What should change?"></textarea><button class="ghost" data-rv-decline style="margin-top:6px">Send it back with this note</button></div>
    <span class="err" id="e-rv"></span>`;
  updateAnswerButton();
}

// ui-candidate: answered-actions (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function answeredActions(info?: Loose) {
  const how = info.declined ? 'You sent it back' : info.status === 'answered' ? `You answered ${wordsState.CHANNEL_WORDS[info.channel] || ''}` : info.status === 'withdrawn' ? 'The supervisor withdrew it' : words(info.status);
  const res = info.result;
  return `<div class="small"><b>${esc(how)}</b>${info.answered_at ? ` · ${esc(when(info.answered_at))}` : ''}</div>
    ${info.answer ? `<div>${esc(info.answer)}</div>` : ''}
    ${res ? `<div class="small muted">Recorded result: ${esc(res.bytes)} bytes, sha256 <code>${esc(res.sha256.slice(0, 12))}</code> ${info.result_status === 'verified' ? '<span class="badge good">verified</span>' : `<span class="badge high">${esc(info.result_status)}</span>`}</div>` : ''}
    ${res && info.result_status === 'verified' && Array.isArray(info.result_doc?.rows) ? `<a class="linkish small" href="/api/review?${new URLSearchParams({ id: info.id, format: 'tsv' })}" target="_blank" rel="noopener noreferrer">The result as TSV</a>` : ''}
    <p class="meta">The page above is read-only: it shows the answer as recorded.</p>`;
}

export function updateAnswerButton() {
  const btn: Loose = document.querySelector('[data-rv-answer]');
  if (!btn || !reviewState.RV) return;
  const info = reviewState.RV.info;
  let why = '';
  if (reviewState.RV.preview) why = 'Preview: there is no question to answer.';
  else if (!pinsVerified(info)) why = 'The page changed since it was asked.';
  else if (!reviewState.RV.proposal) why = 'The page has not proposed an answer yet.';
  else why = proposalProblems(reviewState.RV.proposal, info)[0] || '';
  btn.disabled = !!why;
  $('rv-why').textContent = why;
}

// The panel's left side: the proposal (or the recorded result), drawn here, never by the page.
export function renderReviewPreview() {
  const info = reviewState.RV.info;
  const el = $('rv-preview');
  const raw = (text?: Loose, bytes?: Loose, sha?: Loose, what?: Loose) => `<p class="meta">${what}: <b>${Number(bytes).toLocaleString()}</b> bytes, sha256 <code>${esc(sha.slice(0, 12))}</code>. <a class="linkish" data-rv-raw>${reviewState.RV.rawOpen ? 'Hide' : 'Show'} raw JSON</a></p><pre class="rv-raw" ${reviewState.RV.rawOpen ? '' : 'hidden'}>${esc(text)}</pre>`;
  if (!reviewState.RV.preview && reviewState.RV.readonly) {
    const doc = info.result_doc;
    el.innerHTML = doc ? `<h3>Your answer, as recorded</h3>${resultPreview(doc, info.data, true)}${raw(JSON.stringify(doc, null, 2), info.result.bytes, info.result.sha256, 'The stored result')}` : `<h3>${info.declined ? 'Sent back, with no result' : 'No result recorded'}</h3>`;
    return;
  }
  const p = reviewState.RV.proposal;
  el.innerHTML = `<h3>What you’re answering</h3>
    ${p ? resultPreview(p.obj, info.data, true) + raw(p.text, p.bytes, p.sha256, reviewState.RV.preview ? 'What the page proposes (in a real question, what the agent would receive)' : 'This is exactly what the agent will receive') : empty('None')}
    ${reviewState.RV.dropped ? `<p class="meta">${reviewState.RV.dropped} message${reviewState.RV.dropped === 1 ? '' : 's'} from the page ${reviewState.RV.dropped === 1 ? 'was' : 'were'} refused.</p>` : ''}`;
}

export async function setProposal(result?: Loose) {
  const me = reviewState.RV;
  const seq = ++me.seq;
  const text = JSON.stringify(result);
  const bytes = new TextEncoder().encode(text);
  const sha = await sha256Hex(bytes);
  if (reviewState.RV !== me || seq !== me.seq) return;
  // a copy made from the very text that was hashed: the object posted is the object shown
  me.proposal = { obj: JSON.parse(text), text, bytes: bytes.length, sha256: sha };
  renderReviewPreview();
  updateAnswerButton();
}

export function showSaved() {
  const el = $('rv-saved');
  const s = reviewState.RV?.saved;
  if (!el || !s) return;
  const t = new Date(s.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  el.textContent = `Saved ${t} · ${s.local ? 'this browser' : 'not in this browser'}${s.server === 'ok' ? ' + on disk' : s.server === 'pending' ? ', on disk shortly' : `; not on disk: ${s.server}`}`;
}

export function saveDraft(state?: Loose) {
  const me = reviewState.RV;
  const savedAt = new Date().toISOString();
  const local = lsSet(rvKey(me.qid, me.info.review.page.sha256), { state, saved_at: savedAt, progress: me.progress });
  me.saved = { at: savedAt, local, server: 'pending' };
  me.pending = { state, saved_at: savedAt };
  clearTimeout(me.saveTimer);
  me.saveTimer = setTimeout(() => pushDraft(me), 2000);
  showSaved();
}

export async function pushDraft(me?: Loose) {
  const d = me.pending;
  clearTimeout(me.saveTimer);
  me.saveTimer = null;
  me.pending = null;
  if (!d) return;
  try {
    const r = await fetch('/api/review-draft', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: me.qid, ...d }), keepalive: JSON.stringify(d).length < 60000 });
    const out = await r.json();
    if (me.saved) me.saved.server = r.ok ? 'ok' : out.error || 'failed';
  } catch (e: Loose) { if (me.saved) me.saved.server = e.message; }
  if (reviewState.RV === me) showSaved();
}

// A web link from the page opens only from the owner's own click on the dashboard's bar, the first
// time per site per question; after that, at once (the owner's click in the page lets it open).
export const sitesKey = () => `devteam.review.${reviewState.RV?.qid ?? 'preview'}.sites`;

// ui-candidate: link-bar (apps-src@2: src/shared/ui/ has no component yet, so the port keeps index.html's markup)
export function openFromReview(m?: Loose) {
  if (m.href) {
    let u;
    try { u = new URL(m.href); } catch { return; }
    const bar = $('rv-link');
    const known = new Set(lsGet(sitesKey()) || []).has(u.host);
    if (known) window.open(u.href, '_blank', 'noopener,noreferrer');
    bar.innerHTML = known
      ? `<span>Opened <code>${esc(u.href)}</code> in a new tab.</span><a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">Open it again</a><button class="ghost" data-rv-link-close>Close</button>`
      : `<span>The page wants to open a link on <b>${esc(u.host)}</b>: <code>${esc(u.href)}</code></span><a class="go" href="${esc(u.href)}" target="_blank" rel="noopener noreferrer" data-rv-link-ok="${esc(u.host)}">Open it</a><button class="ghost" data-rv-link-close>Don’t open</button><span class="small dim">Opening it lets this question’s page open ${esc(u.host)} links without asking.</span>`;
    bar.hidden = false;
    return;
  }
  // a committed file opens in the file view, over the review, at the pinned commit by default
  const ref = m.ref || (reviewState.RV.preview ? reviewState.RV.info.ref : reviewState.RV.info.review.commit);
  openFile(new URLSearchParams({ path: m.path, ...(ref ? { ref } : {}), title: m.path }));
}

export function onBridge(m?: Loose) {
  const info = reviewInfo();
  if (!info) return;
  const live = !reviewState.RV.preview && !reviewState.RV.readonly;
  if (m.type === 'ready') {
    let draft = null;
    if (live) {
      const local = lsGet(rvKey(reviewState.RV.qid, info.review.page.sha256));
      const pick = [local, info.draft].filter((x?: Loose) => x && x.state !== undefined && x.state !== null).sort((a?: Loose, b?: Loose) => String(b.saved_at || '').localeCompare(String(a.saved_at || '')))[0];
      draft = pick ? pick.state : null;
    }
    const question = reviewState.RV.preview ? { id: null, preview: true } : { id: info.id, question: info.question, context: info.context, title: info.review.title ?? null, review_sha256: info.review.page.sha256, data_sha256: info.review.data?.sha256 ?? null, allow_partial: !!info.review.allow_partial };
    return tellFrame({ type: 'init', question, data: info.data ?? null, draft, result: !reviewState.RV.preview && reviewState.RV.readonly ? info.result_doc ?? null : null, readonly: !reviewState.RV.preview && reviewState.RV.readonly, preview: reviewState.RV.preview, theme: { dark: isDark() } });
  }
  if (m.type === 'progress') {
    reviewState.RV.progress = { done: m.done, total: m.total };
    showProgress();
    if (live) { const k = rvKey(reviewState.RV.qid, info.review.page.sha256); lsSet(k, { ...(lsGet(k) || {}), progress: reviewState.RV.progress }); }
    return;
  }
  if (m.type === 'draft') return void (live && saveDraft(m.state));
  if (m.type === 'propose') return void (!reviewState.RV.readonly && setProposal(m.result));
  if (m.type === 'markdown') {
    const html = (window as Loose).marked && (window as Loose).DOMPurify ? DOMPurify.sanitize(marked.parse(m.text, { gfm: true }), { FORBID_TAGS: ['style', 'form', 'input'], FORBID_ATTR: ['style'] }) : `<p>${esc(m.text)}</p>`;
    return tellFrame({ type: 'markdown-result', id: m.id, html });
  }
  if (m.type === 'open') return openFromReview(m);
  // resize: the frame fills the panel's height, so a page's reported height needs no action
}

export const themeChange = () => tellFrame({ type: 'theme', dark: isDark() });

export const pageHide = () => { if (reviewState.RV?.pending) pushDraft(reviewState.RV); };

export async function reviewAnswer(btn?: Loose) {
  const me = reviewState.RV;
  const p = me?.proposal;
  if (!p || me.preview) return;
  const err = $('e-rv');
  err.textContent = '';
  const auto = (document.querySelector('#rv-actions input[data-rv-auto]:checked') as Loose)?.value;
  const body = { id: me.qid, result: p.obj, sha256: p.sha256, autonomy: auto ? Number(auto) : undefined };
  const card = document.querySelector(`[data-qcard="${CSS.escape(me.qid)}"]`);
  const f = cardFields(me.qid, card);
  await press(`q:${me.qid}`, {
    build: () => ({ action: 'review-answer', body }),
    // at once: the panel says it is answered and takes no second press; the Inbox card likewise
    apply: () => { $('rv-actions').innerHTML = '<div class="small"><b>Answered</b> · saving…</div><span class="err" id="e-rv"></span>'; markAnswered(me.qid, 'Answered'); },
    undo: () => putBackCard(me.qid, f),
    restore: () => { if (reviewState.RV === me) renderReviewActions(); },
    onOk: (out?: Loose) => {
      clearTimeout(me.saveTimer);
      me.pending = null;
      lsDel(rvKey(me.qid, me.info.review.page.sha256));
      markAnswered(me.qid, String(out.out || '').replace(/^answered \S+: /, '') || 'Answered');
      // the record: the same page, read-only, with the result as stored
      if (reviewState.RV === me) { reviewState.RV = null; openReview(location.hash.slice(1)); }
    },
    errId: 'rv',
  });
}

export async function reviewDecline(id?: Loose, note?: Loose, errId?: Loose, btn?: Loose) {
  if (!note) { const e = $(`e-${errId}`); if (e) e.textContent = 'Say what should change, so the supervisor can redraw it.'; return; }
  const auto = (document.querySelector(errId === 'rv' ? '#rv-actions input[data-rv-auto]:checked' : `input[data-auto="${CSS.escape(id)}"]:checked`) as Loose)?.value;
  const seen = seenHash(id);
  const me = errId === 'rv' && reviewState.RV?.qid === id ? reviewState.RV : null;
  // in the panel, at once: it says it was sent back and takes no second press
  if (me) $('rv-actions').innerHTML = '<div class="small"><b>Sent back</b> · saving…</div><span class="err" id="e-rv"></span>';
  const ok = await answerPress(id, document.querySelector(`[data-qcard="${CSS.escape(id)}"]`), errId, `Sent back: ${note}`, () => ({ action: 'answer', body: { id, answer: note, decline: true, autonomy: auto ? Number(auto) : undefined, seen } }), { stays: false });
  if (!me || reviewState.RV !== me) return;
  if (!ok) {
    const e = $('e-rv')?.textContent;
    renderReviewActions();
    $('rv-decline-form').hidden = false;
    $('rv-decline-note').value = note;
    if (e) $('e-rv').textContent = e;
    return;
  }
  clearTimeout(me.saveTimer); me.pending = null; reviewState.RV = null; openReview(location.hash.slice(1));
}

export const fleetMoveReady = () => !!(goalsState.FLEET.data && goalsState.FLEET.data.ready);

// A hold's state in words. Parking and draining are transitions, shown until that goal's own sessions
// have settled. A goal whose sessions all have is Parked (or Drained) even while the fleet as a whole
// isn't ready to move yet: what is still left for the move (the log landing, a session of another goal)
// is the fleet line's to say, with what it is, not every goal card's (one unsettled session used to
// turn every card into Parking… for days).
export function holdState(h?: Loose) {
  if (!h) return 'running';
  return h.state;
}
