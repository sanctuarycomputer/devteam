// canvas-sync's holder (canvas.html 1659-1711, kit-1015): the section's bindings other sections read,
// as `sync.shared.<name>` (kit-1013's rule), each starting as the page's initializer; and the random
// base-36 strings CLIENT is made of, here so this module imports nothing (CLIENT is made at import).
// Each declaration is the page's own, with types added; checks/faithful.mjs holds it to the page's tokens.

/** canvas-sync's bindings other sections read. */
export type Shared = {
  CLIENT: string;
  OPS_BYTES: number;
  REFUSED: Record<string, string>;
  SAY: { tooBig: string; notSaved: string; instancesFirst: string };
  SELECT_IDS: number;
};

// Who this page is: `client` (16 of [0-9a-z]) and the new-id prefix (6 of base 36), each chosen once
// per page load; new ids are <prefix>-<n>, n counting from 1 (canvas-doc@1 §2's convention).
export const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
export function randomB36(n: number): string {
  let out = '';
  const buf = new Uint8Array(n * 2);
  while (out.length < n) {
    crypto.getRandomValues(buf);
    // 252 is 7 × 36: bytes from it up are dropped, so every character is equally likely
    for (const x of buf) if (x < 252 && out.length < n) out += B36[x % 36];
  }
  return out;
}

export const shared: Shared = {
  // What the page says when an edit is refused (by refused.why), and its other plain words.
  REFUSED: {
    missing: 'That layer was deleted by someone else.',
    parent: "That layer can't go there.",
    cycle: "A layer can't go inside itself.",
    exists: 'That layer is already on the canvas.',
    ref: "That is still used by a component, an instance or a token, so it wasn't changed.",
    limit: "The canvas is at its size limit, so that wasn't added.",
    view: 'You can watch this canvas but not change it.',
  },
  SAY: {
    tooBig: 'That change is too big to send.',
    notSaved: 'Some of your edits may not have been saved.',
    instancesFirst: "Delete this component's instances first.",
  },
  OPS_BYTES: 65536, // an edit's ops as JSON (canvas@1 §7 editOpsBytes)
  CLIENT: randomB36(16),
  SELECT_IDS: 100,
};
