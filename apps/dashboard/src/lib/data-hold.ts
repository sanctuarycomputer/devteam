// kit-989: what holds data's redraw while the owner types or picks (index.html:12263-12267), as index.html has it,
// with types. No imports and no DOM at import: compiled to lib-dist/lib/data-hold.js.
// `Loose` is `any`: an element, or nothing, as the page's events give it.
type Loose = any;

// Not under someone mid-action: a redraw replaces the controls it draws, so typing, an IME
// composition, an open select or file picker, a press not yet released (the click would land on
// nothing) or an answer on its way would be lost. The data still comes in: the tab title and the
// Inbox count stay fresh, and the page draws the latest as soon as nothing holds it.
export const NOT_TYPED = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'];
export const typingIn = (el: Loose) => !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && !NOT_TYPED.includes(el.type)));
// Nothing says a select's list closed without a choice, so a pick holds for this long at most.
export const PICK_HOLD = 60000, PRESS_HOLD = 3000;
export const HINT_AFTER = 30000;
