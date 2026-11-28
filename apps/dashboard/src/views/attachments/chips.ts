// kit-1001: the chips of the files sent, under a turn's words or an answer (index.html's attachments lines), as
// index.html has them, with types and exports.
import { fileIcon, fileSize, fileUrl, isImageName } from '../../lib/attachments-files';
import { esc } from '../shell';
// `Loose` is `any`: a file row as the server sends it, untyped in index.html.
type Loose = any;

// a download chip found swept (HEAD 404), by its URL, so a redraw of the turn keeps it saying so
export const FILES_GONE = new Set<Loose>();
// ui-candidate: pill (the chips are page markup strings; a sweep may take them)
export function chipsHtml(files: Loose) {
  if (!Array.isArray(files) || !files.length) return '';
  return `<div class="file-chips">${files.map((f) => {
    const name = String(f?.name ?? ''), url = fileUrl(f?.path), stored = String(f?.path ?? '').split('/').pop();
    const image = !!url && isImageName(stored);
    const inner = `<i class="${image ? 'icon-image' : fileIcon(name)}" aria-hidden="true"></i><span class="chip-name">${esc(name)}</span><span class="chip-size">${esc(fileSize(Number.isFinite(f?.bytes) ? f.bytes : 0))}</span>`;
    if (!url) return `<span class="file-chip" title="${esc(name)}">${inner}</span>`;
    if (image) return `<button type="button" class="file-chip" data-file-open="${esc(url)}" data-file-name="${esc(name)}" title="${esc(name)}">${inner}</button>`;
    const gone = FILES_GONE.has(url);
    return `<a class="file-chip${gone ? ' gone' : ''}" href="${esc(url)}" download="${esc(name)}" title="${esc(name)}">${inner}${gone ? '<span class="chip-gone">gone</span>' : ''}</a>`;
  }).join('')}</div>`;
}
export const chipsGone = (href: Loose) => {
  FILES_GONE.add(href);
  for (const a of document.querySelectorAll('a.file-chip') as Loose) {
    if (a.getAttribute('href') !== href || a.classList.contains('gone')) continue;
    a.classList.add('gone');
    a.insertAdjacentHTML('beforeend', '<span class="chip-gone">gone</span>');
  }
};
