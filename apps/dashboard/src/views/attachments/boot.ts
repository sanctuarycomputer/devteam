// kit-1001: attachments' listeners, the statements index.html runs as its attachments lines load, here in one
// function, in index.html's order. client.tsx's effect calls it once, after the markup exists (APPS.md, apps-src@2: a
// view's module starts no work at its top level). Nothing else here: every declaration is in its module.
import { hasFiles } from '../../lib/attachments-files';
import { tsRaise } from '../thread';
import { tlHide, tlPinMode, tlShowing } from '../threads-panel';
import { threadsPanelState } from '../threads-panel/state';
import { viewerState } from '../viewer/state';
import { chipsGone, FILES_GONE } from './chips';
import { showUpload, uploadClose, uploadRouted } from './image';
import { addFiles, ATTACH, drawPills, dropOf } from './pills';
// `Loose` is `any`: events and elements as the listeners take them, untyped in index.html. A cast is a type only.
type Loose = any;

export function bootAttachments() {
  for (const kind of ['dragenter', 'dragover']) {
    document.addEventListener(kind, (e: Loose) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const b = dropOf(e);
      if (b) { b.classList.add('drop-over'); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } else if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
    });
  }
  document.addEventListener('dragleave', (e) => { const b = dropOf(e); if (b && !b.contains(e.relatedTarget)) b.classList.remove('drop-over'); });
  document.addEventListener('dragend', () => { for (const b of document.querySelectorAll('.dropbox.drop-over')) b.classList.remove('drop-over'); });
  document.addEventListener('drop', (e: Loose) => {
    for (const b of document.querySelectorAll('.dropbox.drop-over')) b.classList.remove('drop-over');
    if (!hasFiles(e)) return;
    // a file dropped anywhere is held, so the browser never opens it in place of the dashboard
    e.preventDefault();
    const b = dropOf(e);
    if (b && b.dataset.drop) addFiles(b.dataset.drop, [...(e.dataTransfer.files || [])]);
  });
  document.addEventListener('click', (e: Loose) => {
    const x = e.target.closest?.('[data-pill-remove]');
    if (!x) return;
    const key = x.closest('.dropbox[data-drop]')?.dataset.drop;
    const id = x.closest('.att-pill')?.dataset.pillId;
    if (!key || !ATTACH.has(key)) return;
    const left = ATTACH.get(key)!.filter((p: Loose) => p.id !== id);
    if (left.length) ATTACH.set(key, left); else ATTACH.delete(key);
    drawPills(key);
  });
  // An image chip opens it; a download chip asks the server first, so a swept file says gone and nothing downloads.
  document.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    const b = t?.closest('button[data-file-open]') as Loose;
    if (b) { e.preventDefault(); return void showUpload(b.dataset.fileOpen, b.dataset.fileName ?? ''); }
    const a = t?.closest('a.file-chip[download]') as Loose;
    // the fresh link this listener clicks below goes through
    if (!a || a.dataset.fileGo) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (FILES_GONE.has(href)) return void chipsGone(href);
    fetch(href, { method: 'HEAD' }).then((r) => r.status, () => 0).then((status) => {
      if (status === 404) return void chipsGone(href);
      const go = document.createElement('a');
      go.href = href;
      go.download = a.getAttribute('download') ?? '';
      go.dataset.fileGo = '1';
      go.click();
    });
  });
  // The ways out of an image, only while one is up, each taken whole before any other listener (window, capture):
  // the page's own (leaveArtifact) would move the hash or go back in history, and the image never routed.
  window.addEventListener('click', (e) => {
    if (!viewerState.AV?.upload) return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t?.closest('#av-close, #scrim')) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    uploadClose();
  }, true);
  // Escape: the aiming cursor, pin mode or the raised overlay ends first, as the threads layer's Escape does, and the
  // image stays; else the image closes (the page it covered back), and a floating thread card stays open (spec-2 F2-2).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !viewerState.AV?.upload) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (tlShowing() || threadsPanelState.TL.pin || viewerState.TS.raised) { tlHide() as Loose; tsRaise(false) as Loose; if (threadsPanelState.TL.pin) tlPinMode(false) as Loose; return; }
    uploadClose();
  }, true);
  window.addEventListener('popstate', uploadRouted, true);
  window.addEventListener('hashchange', uploadRouted, true);
}
