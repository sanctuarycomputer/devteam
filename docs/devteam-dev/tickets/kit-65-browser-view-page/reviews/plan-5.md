# Plan review, pass 5

- Reviewer: Ostrom (fresh subagent, claude-opus-5-5)
- Reviewed: 306a43656d961929f0bc242395f99ffdd134eb4a (plan.md, diff from f8c62bf)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|

P4-1 is fixed. The memory test now pastes `pasted-Щ` first and types `kЖ` last. The paste chord's keydowns (`Control`, then `v`) come before the typed keys, so the last keydown the page sees is `Ж`. `type()` in `test/lib/chrome.mjs` sends each character as its own `keyDown` with `key: Ж`, `text: Ж` and `modifiers: 0`, so a Control left held by the paste can't change `e.key`. The mutation's `last = e.key;` is now pinned as the first line of the canvas keydown handler, before any early return, so it runs on `Ж` and `last` ends holding it. The walk finds it through the handler's `[[Scopes]]` closure and the test fails as the plan claims. A real page that records the key in keyup is caught the same way, because the last keyup is also `Ж`. P4-2 is fixed. `window` gets its handle from `Runtime.evaluate('window', { objectGroup: 'walk' })`, and `DOM.resolveNode` is used only for `document` and elements, so a listener on `window` is no longer skipped. It sits in the same group the walk releases. Nothing else in the diff is Critical or Important.

Verdict: APPROVE 306a43656d961929f0bc242395f99ffdd134eb4a
