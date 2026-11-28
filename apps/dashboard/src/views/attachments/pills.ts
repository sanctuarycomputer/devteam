// kit-1001: the boxes that take dropped files and their pills (index.html's attachments lines), as index.html has
// them, with types and exports.
// Files dropped into a box that sends to the supervisor (kit-171): an Inbox answer's note (q:<qid>, shared by
// the Inbox's card and its copy in a thread) and the thread composer (tl:<the card's key>). Each file uploads at
// once through POST /upload and is a pill inside the box. The pills live here, per key, and every box with that
// key is drawn from it, so the Inbox's redraw and the card's rebuild keep them; the textarea is never redrawn.
import { ATT_CUT, ATT_TOO_MANY, FILES_MAX, fileIcon, fileSize } from '../../lib/attachments-files';
import { esc } from '../shell';
import { tLine } from '../threads-core';
// `Loose` is `any`: index.html's values have no declared types. A cast `(x as Loose)` is a type only (SWC strips
// it). Some are there because threads-core's tLine is a stub returning `never` until its port.
type Loose = any;

// key -> [{ id, name, sendName, size, type, state: 'up'|'ok'|'refused', why, path, bytes }]
export const ATTACH = new Map<Loose, Loose[]>();
let ATTACH_N = 0;
export const attPlainHttp = () => `This browser doesn't say which page an upload comes from over plain http, so the dashboard refuses it. On the machine running the dashboard, open it at http://127.0.0.1${location.port ? `:${location.port}` : ''} (start it without --host if that doesn't answer); from another device, files can't be dropped over plain http.`;
// A file's name as it is sent and shown: the dropped name made one plain line (control and bidi characters to
// spaces, cut to the 200 characters the server's attachedFiles takes), else the stored file's name (the raw
// name until the upload answers).
export const attName = (p: Loose) => (tLine(p.name, 200) as Loose) || (p.path ? String(p.path).split('/').pop() : String(p.name ?? ''));
// ui-candidate: pill (the pills are page markup strings; a sweep may take them)
export function pillsHtml(key: Loose) {
  return (ATTACH.get(key) || []).map((p: Loose) => {
    const name = attName(p);
    return `<span class="att-pill${p.state === 'refused' ? ' refused' : ''}" data-pill-state="${esc(p.state)}" data-pill-id="${esc(p.id)}"><i class="${fileIcon(p.name)}" aria-hidden="true"></i><span class="pill-name" title="${esc(name)}">${esc(name)}</span><span class="pill-size">${esc(fileSize(p.size))}</span>${p.state === 'up' ? '<span class="pill-up">uploading…</span>' : ''}<button type="button" data-pill-remove aria-label="Remove ${esc(name)}">×</button>${p.state === 'refused' ? `<span class="pill-why">${esc(p.why)}</span>` : ''}</span>`;
  }).join('');
}
// A box: the textarea, then its pills under it, inside one border.
// ui-candidate: text-field (the drop box wraps a text area in page markup strings; a sweep may take it)
export const dropBox = (key: Loose, textareaHtml: Loose) => `<div class="dropbox" data-drop="${esc(key)}">${textareaHtml}<div class="pills">${pillsHtml(key)}</div></div>`;
export function drawPills(key: Loose) {
  const html = pillsHtml(key);
  for (const b of document.querySelectorAll('.dropbox[data-drop]') as Loose) {
    if (b.dataset.drop !== key) continue;
    const ps = b.querySelector(':scope > .pills');
    if (ps && ps.innerHTML !== html) ps.innerHTML = html;
  }
}
// The composer's key moves with its draft (new:… to pending-…, then to the thread's id): its pills and its box go too.
export function moveAttach(from: Loose, to: Loose) {
  if (from === to) return;
  if (ATTACH.has(from)) { ATTACH.set(to, [...(ATTACH.get(to) || []), ...ATTACH.get(from)!]); ATTACH.delete(from); }
  for (const b of document.querySelectorAll('.dropbox[data-drop]') as Loose) if (b.dataset.drop === from) b.dataset.drop = to;
  drawPills(to);
}
// What a box sends: its taken files as the actions take them, or why it can't send yet (nothing is sent until
// every file has uploaded and the refused ones are removed).
export function sendable(key: Loose) {
  const list = ATTACH.get(key) || [];
  const why = list.some((p: Loose) => p.state === 'up') ? 'Wait for the files to finish uploading.' : list.some((p: Loose) => p.state === 'refused') ? "Remove the files that weren't taken first." : '';
  return { why, files: list.filter((p: Loose) => p.state === 'ok').map((p: Loose) => ({ name: p.sendName || attName(p), path: p.path, bytes: p.bytes })) };
}
// A press's apply takes the box's pills with the words; its undo puts them back ahead of any dropped since.
export function takeAttach(key: Loose) {
  const list = ATTACH.get(key) || [];
  ATTACH.delete(key);
  drawPills(key);
  return list;
}
export function putAttach(key: Loose, list: Loose) {
  if (!list?.length) return;
  ATTACH.set(key, [...list, ...(ATTACH.get(key) || [])]);
  drawPills(key);
}
// What a refused upload says: the route's own JSON error, else its text, else the status; a 403 on a page that
// isn't a secure context (plain http on a --host name, no Sec-Fetch-Site) in plain words.
export async function reasonOf(res: Loose) {
  if (res.status === 403 && !window.isSecureContext) return attPlainHttp();
  let text = '';
  try { text = await res.text(); } catch {}
  try { const j = JSON.parse(text); if (j && typeof j.error === 'string' && j.error.trim()) return j.error; } catch {}
  return text.trim() || `HTTP ${res.status}`;
}
export async function upload(p: Loose, file: Loose) {
  // the pill wherever it sits now: the composer's key may have moved while it uploaded (moveAttach); a pill
  // removed meanwhile is gone, and its answer changes nothing
  const set = (o: Loose) => {
    for (const [key, list] of ATTACH) {
      const q = list.find((x: Loose) => x.id === p.id);
      if (!q) continue;
      Object.assign(q, o);
      if (q.path) q.sendName = attName(q);
      return void drawPills(key);
    }
  };
  try {
    const res = await fetch(`/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    if (res.ok) {
      let j: Loose = null;
      try { j = await res.json(); } catch {}
      if (j && typeof j.path === 'string') set({ state: 'ok', path: j.path, bytes: typeof j.size === 'number' ? j.size : file.size });
      else set({ state: 'refused', why: `HTTP ${res.status}` });
    } else set({ state: 'refused', why: await reasonOf(res) });
  } catch { set({ state: 'refused', why: ATT_CUT }); }
}
export function addFiles(key: Loose, files: Loose) {
  if (!ATTACH.has(key)) ATTACH.set(key, []);
  const list = ATTACH.get(key)!;
  for (const file of files) {
    // name: as dropped; sendName (once taken): attName, the name the pill shows
    const p = { id: String(++ATTACH_N), name: file.name, sendName: '', size: file.size, type: file.type, state: 'up', why: '', path: null, bytes: null };
    if (list.filter((x: Loose) => x.state !== 'refused').length >= FILES_MAX) { list.push({ ...p, state: 'refused', why: ATT_TOO_MANY }); continue; }
    list.push(p);
    upload(p, file);
  }
  drawPills(key);
}
export const dropOf = (e: Loose) => e.target?.closest?.('.dropbox[data-drop]') ?? null;
