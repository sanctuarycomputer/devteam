// The image (canvas.html 4362-4400, kit-1017): posted, then added under the src the server answers.
// Each declaration is the page's own, with types added; the page's load-time statements run, in its
// order, from initImage(). No DOM at import.
import { SRC_RE } from '../core/checkers';
import { $, isObj, state, type Json } from '../core/page';
import { addNode } from '../editing';
import { editable, freeText, say } from '../sync';
import * as editing from '../editing';

// ---- the image: posted, then added under the src the server answers ----
export function initImage(): void {
  $('imageFile').addEventListener('cancel', () => { editing.shared.placing = null; });
  $('imageFile').addEventListener('change', () => {
    const f = $<HTMLInputElement>('imageFile').files;
    const file = f && f.length ? f[0] : null;
    const place = editing.shared.placing;
    editing.shared.placing = null;
    $<HTMLInputElement>('imageFile').value = '';
    if (file && place && editable()) uploadImage(file, place);
  });
}
// The upload's name: the file's, cut to 200 characters, or "image" when that isn't free text.
export function uploadName(s: Json) {
  const cut = [...(typeof s === 'string' ? s : '')].slice(0, 200).join('');
  return cut.trim() && freeText(cut) ? cut : 'image';
}
export async function uploadImage(file: Json, place: Json) {
  if (file.size > editing.shared.IMAGE_BYTES) { say(editing.shared.IMAGE_SAY.tooBig); return; }
  let status = 0;
  let src = null;
  try {
    // base64 by btoa over the bytes as a binary string, built 32 KB at a time
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768) as Json);
    const body = JSON.stringify({ name: uploadName(file.name), data: btoa(bin) });
    const res = await fetch(`/api/canvas/image?slug=${encodeURIComponent(state.slug!)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'same-origin', cache: 'no-store' });
    status = res.status;
    if (status === 200) {
      const j = await res.json();
      if (isObj(j) && typeof j.src === 'string' && SRC_RE.test(j.src)) src = j.src;
    }
  } catch { src = null; }
  if (src === null) {
    say(status === 413 ? editing.shared.IMAGE_SAY.tooBig : status === 415 ? editing.shared.IMAGE_SAY.types : editing.shared.IMAGE_SAY.failed);
    return;
  }
  addNode('image', place.at, { size: place.size, src });
}
