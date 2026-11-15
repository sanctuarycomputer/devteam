# Task 2 review, pass 2

- Reviewer: Hopper (fresh subagent, claude-opus-5-5)
- Reviewed: f3666d937d912984c94dff1461aa3caf390cf3d5 (Task 2 fixes, diff from 6fedb8f)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T2-2-1 | Minor | `L-TEST-1`; spec, click row (a release past 4 px is a drag, so its `up` is where it was released) | `test/browser-view-page.test.mjs`, the 4 px rule test, `near(got.at(-1), { fx: got.at(-1).x, fy: got.at(-1).y }, 'the up')` | This assertion compares the `up` with itself, so it can never fail. The `up` of a press released 10 px off with no move between is never checked against the release point. Mutation M30 sends that `up` at the press point only on the new path, and all 9 input tests still pass. Compare it with `pt` at the release point (`off(10)` scaled to the frame). | fixed in the T3 commit: the far-release up is compared with its release point in frame px |
| T2-2-2 | Minor | spec, any-other-key row (`up` on keyup); pass 1's T2-7 ("and on canvas blur") | `browser.html`, `held` / keyup | The Cmd-up release fixes the macOS case. A key held when the canvas loses focus still never gets its `up`. Cmd+Tab away is the common case: Tab is sent as `down` with mods 4, and the Meta keyup goes to another window. The remote key stays down, and `held` keeps the entry until the socket closes. Sending the `up` for each entry in `held` on the canvas's `blur` would end these presses, as spec line 125 already does for a press of the mouse. | fixed in the T3 commit: on canvas blur every held key gets its up and held empties; a test blurs with Backspace down |
| T2-2-3 | Suggestion | none (test margin) | the 4 px rule test, the 3 px click | M25 is caught by a thin margin. At 700×700, 3 CSS px is 1.42 frame px, against `near`'s 1 px tolerance (failure: "(97.42, 60) is (96, 60)"). Any layout change that grows the canvas would let a click sent at the release point pass. Assert an exact match with the press's frame point, or test at a smaller window. | |

T2-1 to T2-9 are fixed as their dispositions say. T2-1: a 3 px move is a click at the press; a 6 px move, or a release 10 px off with no move, is a drag. T2-2 and T2-3: the recorder can hold `requestAnimationFrame`. Five moves in one frame send one, the newest. A Shift hover move carries mods 8. A move still waiting when the button comes up goes before the `up`, and nothing goes after it. T2-4: line ×16, page × frame height, ±100 000 clamp. T2-5: an `up` released off the canvas is clamped to (320, 0). T2-6: `code === 'KeyV'` also counts as the paste chord. T2-7: Cmd's keyup ends every key downed with Cmd, and the plan now names what `held` keeps. T2-8: `pointerup` checks the 4 px rule itself. T2-9: a paste that goes clears the note.

The diff adds nothing Critical or Important. Against the contract (`$defs.view.from_page`): the new `down` and `up` messages carry only fields the schema lists, with `clicks: 1`. The Meta-path `up` sends `key` and `code` with no `mods`. Every message in the new tests passes `valid()`. Against ruling m-20261115-034535632-supervisor: `held` keeps a key's name and code, and only for keys sent as `down` (named keys, and the key of a Ctrl or Cmd chord). These are never a `press`'s text or a paste. Each entry is deleted on its own `up` or on Cmd's. The note-clearing call holds no paste text. The CSP script hash matches the script (recomputing it on an unchanged copy gives the same file).

Mutations re-run. Each ran on a scratch copy of the page with its script and style hashes recomputed, against a scratch copy of the test whose `PAGE`, imports, fixture and schema reads are absolute paths into the worktree. Node 22, `nice /usr/local/bin/node --test --test-concurrency=2 --test-name-pattern=<the 9 input tests>`. M0 (no change) passes 9 of 9. One full-file run of the copy passed 20 of 21 under load. A second full run timed out in `ready()` in the four new tests while other agents' Chromes loaded the box. That is load, not the page: the same four tests pass on their own.

- M1: the 4 px rule removed (`hypot > 4` set to `true`). Caught (4 px rule test).
- M3: no `flush()` before the drag's `up`. Caught (animation-frame test).
- M4: moves sent unthrottled. Caught (animation-frame test).
- M5: wheel line mode ×1. Caught (wheel-scaling test).
- M6: wheel deltas not clamped. Caught (wheel-scaling test).
- M21: `toFrame` not clamped. Caught (wheel-scaling test, the off-canvas `up`).
- M23: no `mods` on hover moves. Caught (animation-frame test).
- M25: the click at the release point. Caught (4 px rule test), by a thin margin (T2-2-3).
- M25b: the new far-release check in `pointerup` removed. Caught (4 px rule test).
- M27: no Cmd-up release of held keys. Caught (non-Latin/Cmd test).
- M28: no `code === 'KeyV'` in the paste chord. Caught (non-Latin/Cmd test).
- M29: no `note('')` on a paste that goes. Caught (paste test).
- M30: the far-release `up` at the press point. **Not caught** (T2-2-1).

Verdict: APPROVE f3666d937d912984c94dff1461aa3caf390cf3d5
