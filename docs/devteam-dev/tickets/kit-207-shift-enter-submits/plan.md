# kit-207 Shift+Enter submits: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, with test-driven-development). Steps use checkbox (`- [ ]`) syntax.

## TL;DR

- One `document` keydown listener in `index.html` replaces today's Enter-sends listener (~4983): Shift+Enter (no Ctrl/Alt/Meta, not composing, `keyCode` ≠ 229) in a box that has a submit prevents the newline and, unless `e.repeat`, submits.
- `submitOf(el)` finds the submit: `#tl-c-text` → `tlSend`; a question card's `textarea[data-q]` → a click on its decline form's `[data-decline]`, else its card's `[data-answer]`, else `[data-reply]`; anything else → `null`, and the key is left alone, repeats included (spec-3 R1).
- Plain Enter is a newline everywhere; the thread box no longer sends on Enter. Placeholder: "Write to the supervisor. Shift+Enter sends; Enter is a new line."
- The ten existing `p.key('Enter')` sends from `#tl-c-text` become `p.key('Enter', 8)`; the test "Enter sends the first words…" is renamed.
- Two new subtests in the threads browser test (`test/dashboard.test.mjs`): the thread box, then the question boxes (Inbox and thread copy). Every must-not-post keyDown goes through CDP with `text: '\r'` and is recorded on arrival.
- Risk: the reversal of Enter in the thread box (ruled in m-20261115-033958803: one rule everywhere); hub.html's operator box still says Enter sends (a PR note; the supervisor files the chore). Two tasks, only `index.html` and the test change.

**Goal:** Shift+Enter submits the thread box and every question card's note box; Enter is a new line.

**Architecture:** `submitOf(el)` maps a focused box to its submit (a function, or `null`); one keydown listener applies the key rules and calls it. Question boxes submit by clicking their own button, so the existing click handler does the which-choice step and every refusal.

**Tech stack:** the dashboard's single-file vanilla JS; `node:test` with the kit's CDP Chrome driver (`test/lib/chrome.mjs`, unchanged).

**Spec:** `docs/devteam-dev/tickets/kit-207-shift-enter-submits/spec.md` (approved by spec-3 at 3cf1a9b).

## Global constraints

- Files: `docs/devteam/dashboard/index.html`, `test/dashboard.test.mjs`, and this ticket's folder. No file added outside it.
- Key rule, exact: `e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing && e.keyCode !== 229`.
- Placeholder, exact: `Write to the supervisor. Shift+Enter sends; Enter is a new line.`
- Box run alone, at `--test-concurrency=2`, never the full suite: `/usr/local/bin/node --test --test-concurrency=2 --test-name-pattern='threads on the dashboard page' test/dashboard.test.mjs` (Node 22; the default Node 18 skips browser tests). Gates go through `devteam.mjs gate test -- <that command>`.
- A must-not-post keyDown in a new check: `p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', modifiers, autoRepeat })` and a matching `keyUp`; IME by a dispatched `new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, isComposing: true, bubbles: true, cancelable: true })`; 229 by CDP `windowsVirtualKeyCode: 229`. A test-local helper `enter({ shift, ctrl, repeat, code })` wraps it.
- Arrival and posts: Task 1's subtest installs, once per page via `p.ev` (the threads test never reloads the page; plan-1 P9), a capture keydown listener on `window` that pushes `{ key, shiftKey, ctrlKey, keyCode, isComposing, repeat }` to `window.__keys`. Posts are counted from the fixture's own `window.__posts` (POLL_FAST, test:~350, records every POST to `/api/` as `{ url, body }`; no second wrapper, plan-2 Q1): `posts()` = the number of its entries whose `url` ends in `/api/answer`, `/api/thread-say`, `/api/thread-new` or `/api/thread-reopen`. Each must-not-post check asserts its event is the last in `__keys` (spec-2 N2) and that `posts()` did not grow; each submit check asserts `posts()` grew by exactly one and, after 2.5 s, no more (plan-1 P5).
- Reading questions: `JSON.parse(F.owner(['questions', '--id', id, '--json']))[0]` (plan-1 P4).

## Review focus

1. A sensor's secret card (no Reply, no Answer): Shift+Enter is a plain newline, repeats included. Covered by `submitOf` returning `null`; reviewer reads it.
2. A review card's note box presses Send it back, and a secret card's presses Reply: same `.click()` path, not driven by a test (spec Edge cases); reviewer reads the lookup.
3. The which-choice ask already up: a second Shift+Enter keeps the ask and posts nothing. Pinned in Task 2.
4. Focus left on a radio after a pick: Shift+Enter there does nothing (not a box). Task 2 refocuses the box (spec-1 F7).
5. The other boxes (the review panel's note, a lesson note, a secret value, the resolve outcome): unchanged. `submitOf` returns `null`; reviewer reads it.

---

### Task 1: the thread box

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`tlCardFrame` ~4664 placeholder; the keydown listener ~4983)
- Test: `test/dashboard.test.mjs` (the threads test, ~3070-3460, and the ten `p.key('Enter')` sends at 540, 544, 2266, 2395, 3187, 3228, 3241, 3293, 3768, 3925)

**Interfaces:**
- Produces: `submitOf(el: Element | null) => (() => void) | null`, defined next to the listener; Task 2 extends it with the question-box branch. In this task it handles `#tl-c-text` only.

- [ ] **Step 1: Write the failing test.** In the threads test, after "reads of the threads slower than the 2 s poll…", add a subtest `'Shift+Enter in the thread box sends once; Enter, a repeat, composition and Ctrl+Shift+Enter add nothing'`. With thread `T` open and `#tl-c-text` focused, typed "kept line one", and `n = turns of T in threads()`:
  - `enter({})` → value `'kept line one\n'`, `turns === n`.
  - `enter({ shift: true, repeat: true })` → the arrival is `{ shiftKey: true, repeat: true }`; value unchanged (no second `\n`), `turns === n`.
  - the IME `KeyboardEvent` → arrival `isComposing: true`; `turns === n`.
  - `enter({ shift: true, code: 229 })` → arrival `keyCode: 229`; `turns === n`. The value is not asserted: the listener leaves this key alone, so Chrome may insert its `\r` (plan-1 P3); reset the box to "kept line one\n" (set `value`, dispatch `input`) after it.
  - `enter({ shift: true, ctrl: true })` → arrival `ctrlKey: true`; `turns === n`.
  - Wait 2.5 s (more than one fast poll) then assert `turns === n` again, so a late post would show.
  - `enter({ shift: true })` then `enter({ shift: true, repeat: true })` → `posts()` grew by one; `until` the log has exactly `n + 1` turns of T, the last `'kept line one'` (trimmed); after 2.5 s still `n + 1` and `posts()` unchanged; the box is empty.
  - In the dock test's New thread (~3283) the send is already Shift+Enter after Step 3, which covers the new-thread box (done-when 2).
- [ ] **Step 2: Run it; expect FAIL** (plain Enter sends today, so the first check sees `n + 1`).
- [ ] **Step 3: Implement.** Replace the keydown listener at ~4983 with the key rule in Global constraints plus `const go = submitOf(e.target); if (!go) return; e.preventDefault(); if (!e.repeat) go();`, and add `submitOf` (comment: Shift+Enter submits the box being edited; Enter is a new line). Change the placeholder. Change the ten `p.key('Enter')` to `p.key('Enter', 8)`; rename the subtest at ~3182 to "Shift+Enter sends the first words…".
- [ ] **Step 4: Run the four tests holding the migrated sends, each alone** with the command in Global constraints and `--test-name-pattern` set to: `threads on the dashboard page`, `^presses: the page answers before the server`, `^Shift over an artifact`, `^Shift over a preview, through the relay` (plan-1 P6); expect PASS.
- [ ] **Step 5: Commit** `kit-207: task 1: Shift+Enter sends in the thread box; Enter is a new line`. Review record `reviews/task-1.md` by a fresh subagent.

### Task 2: the question boxes

**Files:**
- Modify: `docs/devteam/dashboard/index.html` (`submitOf`)
- Test: `test/dashboard.test.mjs` (the threads test)

**Interfaces:**
- Consumes: `submitOf` and the listener from Task 1.
- Produces: `submitOf` returns, for a `textarea[data-q]`, `() => btn.click()` where `btn` is `el.closest('[data-decline-form]')?.querySelector('[data-decline]') ?? card?.querySelector('[data-answer]') ?? card?.querySelector('[data-reply]')` with `card = el.closest('[data-qcard]')`; `null` when there is no `btn`.

- [ ] **Step 1: Write the failing test.** After the subtest "a question asked in the thread…" (~3356; thread `T` open), add `'Shift+Enter in a question box presses its Answer: the which-choice step, once, in the Inbox and in the thread'`. Use fresh questions, never `Q0`:
  - **Inbox copy.** `Qa = F.sup(['ask', '--question', 'Ship on Friday?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--recommendation', 'Yes', '--goal', F.goal, '--stake', '1', '--urgency', '1'])` (the which-choice step needs a recommendation, `needsWhich` ~1237; plan-1 P1); show the Inbox (`location.hash = '#inbox'`, and `soon` the card shown); focus `#q-${Qa} textarea[data-q]`, type "after the demo".
    - `enter({ shift: true })` → a `#q-${Qa} [data-which-for]` ask appears; the question is still open (`F.owner(['questions', '--id', Qa, '--json'])[0].status === 'open'`); no `\n` in the box.
    - `enter({ shift: true })` again → still one ask, still open.
    - Pick "Yes" by a script click on `#q-${Qa} input[data-pick][value="Yes"]` (T's docked card may cover the Inbox card; plan-1 P8); the pick drops the ask, so the ask count is now 0. Focus the box again (spec-1 F7). Now a Shift+Enter would post; on this card run each must-not-post check, asserting arrival, then: still open, the count of `#q-${Qa} [data-which-for]` the same as just before the check (so a missing guard shows as a new ask or a post), the card's error line `#e-${Qa}` empty, the value unchanged except plain Enter's `\n`: `enter({})` (gains `\n`), `enter({ shift: true, repeat: true })`, the IME event, `enter({ shift: true, code: 229 })` (its value not asserted, plan-1 P3). After 2.5 s still open and `posts()` unchanged (spec-2 N1).
    - `enter({ shift: true })` then `enter({ shift: true, repeat: true })` → `until` answered, `answer === 'Yes — after the demo'`, `channel === 'dashboard'`; `posts()` grew by exactly one (an `/api/answer`), and after 2.5 s no more.
  - **Put the page back** before the thread copy: `location.hash = '#goals'`, `soon` the goal card and T's pin shown; `click` T's pin (`[data-tl-pin="${T}"]`) and `soon` its card (plan-1 P2, plan-2 Q2).
  - **Thread copy.** `Qt = F.sup(['thread', 'ask', T, '--question', 'Tell the team?', '--choices', '[{"label":"Yes"},{"label":"No"}]', '--goal', F.goal, '--stake', '1', '--urgency', '1'])`; with T's card shown, click "No" in `#t-q-${Qt}`, focus `#t-q-${Qt} textarea[data-q]`, type "next week", `enter({ shift: true })` → `until` answered with `'No — next week'`. The page ends on `#goals` with T's card open, as the subtest before it left it.
- [ ] **Step 2: Run it; expect FAIL** (no ask appears on the first Shift+Enter).
- [ ] **Step 3: Implement** the question-box branch of `submitOf` as the Interfaces block says.
- [ ] **Step 4: Run the threads test alone; expect PASS.** Then the kit-203 which-choice test alone, `--test-name-pattern='^a typed answer on a question with choices asks which choice'` (plan-2 Q3); expect PASS.
- [ ] **Step 5: Commit** `kit-207: task 2: Shift+Enter presses a question card's Answer`. Review record `reviews/task-2.md` by a fresh subagent.

### After the tasks: verification (done-when 4)

- [ ] `git diff --name-only --diff-filter=A origin/main` lists only files under `docs/devteam-dev/tickets/kit-207-shift-enter-submits/`; push; test.yml green on every job at the head (`gh run list --branch ticket/kit-207-shift-enter-submits`), recorded through `devteam.mjs gate ci -- gh run watch <id> --exit-status`; `verification.md` with a row per done-when (plan-1 P7).

## Rulings

- m-20261115-033958803-supervisor (re m-20261115-033938006): spec approved as written. Shift+Enter submits and Enter is a newline in every box, the thread box included (one rule everywhere); the supervisor tells the owner, who may object. The hub.html operator-box follow-up is a note in the PR body; the supervisor files it as a chore.
- m-20261115-041857004-supervisor (re m-20261115-041843198, final-1 F1): `test/browser/dev-links.mjs` added to touches; its `enter()` sends Shift+Enter (`modifiers: 8`), since its three sends are from `#tl-c-text`.
