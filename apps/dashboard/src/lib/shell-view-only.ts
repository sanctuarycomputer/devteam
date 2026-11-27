// kit-988: view only's pure part (index.html's viewOnly block, kit-250): the writes a view-only person is stopped
// from making, the toast's words, and viewStop's decision whether an event is one of those writes. The DOM side
// (the view-only class, the toast, the listeners) stays in src/views/shell/page.ts. No imports and no DOM at import:
// compiled to lib-dist/lib/shell-view-only.js.

// What a view-only press would change: every write the page draws. Navigation (tabs, filters, links, Back,
// peeks, copy) is left alone.
export const VIEW_WRITES = "[data-answer], [data-cant], [data-reply], [data-dontuse], [data-post-secrets], [data-overrule-send], [data-correct-send], [data-rv-answer], [data-decline], [data-rv-decline], [data-know], [data-oa-know], [data-oa-goal], [data-hold-id], [data-met-id], [data-goal-move], [data-preview-start], [data-preview-stop], [data-forget], [data-limit-save], [data-limit-none], [data-limit-step], .fleet-switch [data-fleet], [data-checknow], [data-tl-send], [data-tl-accept], [data-tl-notyet], [data-tl-resolve-go], [data-tl-reopen], [data-goal-grip], [data-ask-option], [data-ask-esc], #av-handover, a[href*=\"/public/\"], .dropbox[data-drop] textarea, .dropbox[data-drop] input, #tl-c-text";
export const VIEW_TOAST = 'View only: you can look, but not change anything';

/** The part of an element writes() reads. An Element is one. */
export type ElLike = { closest(s: string): ElLike | null; querySelector(s: string): unknown; matches(s: string): boolean };

/**
 * Whether the event at el writes: viewStop's stop decision, branch for branch. el is the event's target when it is
 * an Element and null otherwise (the caller decides that), and null gives false. The caller checks the
 * view-only class first, and does the stopping.
 */
export function writes(e: { type: string; key?: string; keyCode?: number; isComposing?: boolean; submitter?: ElLike | null }, el: ElLike | null): boolean {
  if (!el) return false;
  const write = el.closest(VIEW_WRITES);
  let stop = false;
  if (e.type === 'click') stop = Boolean(write);
  else if (e.type === 'submit') stop = Boolean(e.submitter?.closest(VIEW_WRITES) || el.querySelector(VIEW_WRITES));
  else if (e.type === 'drop') stop = Boolean(write || el.closest('.dropbox[data-drop]'));
  else if (e.type === 'pointerdown') stop = Boolean(el.closest('[data-goal-grip]'));
  else if (e.type === 'keydown') {
    if (e.isComposing || e.keyCode === 229) return false;
    const typing = write && write.matches('textarea, input:not([type=checkbox], [type=radio], [type=button], [type=submit])');
    stop = Boolean(write) && (e.key === 'Enter' || (e.key === ' ' && !typing)) || ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && Boolean(el.closest('[data-goal-grip]')));
  }
  return stop;
}
