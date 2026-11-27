// The page's start (canvas.html 5471-5501, kit-1013, ruling a-20261127-085009030 D4): the slug, read
// through appPath() (so it holds under a base path), the doc fetch, and the hand-off to the sections.
// Its one change from the page: `location.pathname` is `appPath()`. mount() runs it.
import { appPath } from '../../../shared/paths';
import { $, SLUG_RE, TEXT, fail, frameOk, renderPageSel, renderPages, setState, showRepo, state, type Json } from './page';
import { connect, syncBody, takeDoc } from '../sync';
import { hashPage, showPage } from '../panels';
import { connectPresence, onVisibility } from '../presence';

export async function start(): Promise<void> {
  setState('loading');
  const m = /^\/view\/canvas\/([^/]*)$/.exec(appPath());
  const slug = m ? m[1] : '';
  if (!SLUG_RE.test(slug)) return fail(TEXT.notAddress);
  state.slug = slug;
  $('title').textContent = slug;
  document.title = `${slug} · canvas`;
  let res: Response;
  try {
    res = await fetch(`/api/canvas/doc?slug=${encodeURIComponent(slug)}`, { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return fail(TEXT.notLoaded);
  }
  if (res.status === 404) return fail(TEXT.notOpen);
  const withStatus = `${TEXT.notLoaded} (${res.status})`;
  if (res.status !== 200) return fail(withStatus);
  let body: Json;
  try { body = await res.json(); } catch { return fail(withStatus); }
  if (!frameOk(body)) return fail(withStatus);
  takeDoc(body);
  state.doc = state.base;
  showRepo(body.repo);
  renderPages();
  renderPageSel();
  showPage(hashPage());
  syncBody();
  // main's copy (session null) is read-only: no socket, no editing
  if (state.session !== null) { connect(); connectPresence(); if (document.visibilityState !== 'visible') onVisibility(); }
}
