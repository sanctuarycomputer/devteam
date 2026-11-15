# Task 4 review, pass 2

- Reviewer: Lovelace (fresh subagent, claude-opus-5-5)
- Reviewed: 42879244c9844535a3f941703b9771eb6fe5435f (Task 4 fixes, diff from 6db74de)

| Id | Severity | Rule | Where | Finding | Disposition |
|---|---|---|---|---|---|
| T4-2-1 | Minor | ruling m-20261115-034535632-supervisor ("kept in page memory"); plan Global constraints; `L-TEST-1` | `pageMemory()` in the test | Three ways to keep a typed key still pass the memory test: a `WeakRef` to an object holding it (`ref = new WeakRef({ k: e.key })`; the target is not an own property), a class instance's private field (`box.set(e.key)` into `#x`; private fields come back in `privateProperties`, which the walk never reads), and an array nested seven deep (the walk stops at depth 6). The walk also follows each closure once by its source location, so a second instance of the same function is never read. None of these is a plausible thing for this page to do by mistake, so this does not block. Reading `privateProperties` and `[[WeakRefTarget]]` would close the first two cheaply. | |
| T4-2-2 | Minor | plan Task 4 ("on every close `press` and `held` are cleared"); `L-TEST-1` | `connect()` in `browser.html`, the T4-5 fix | No test pins the new `press = null; held.clear()` at the top of `connect()`. With those three lines removed, all 30 tests still pass. The race (Show it again clicked before the old socket's closing handshake ends) is narrow, so this stays a Minor, as T4-5 was. A test could hold a key, send bye, click `#again` while the fake server delays its close, and assert that no `up` reaches the new socket. | |

## Checks of pass 1's fixes

- T4-1: fixed. The walk now follows function `[[Scopes]]`, deduplicated by `[[FunctionLocation]]`, and flags any reachable `*Event`. A page-world check reads the own properties of the window and of every element. All four survivors now fail (below).
- T4-2: fixed. The memory test types `Ю` while `refuse(true)` holds the socket down and waits for "Reconnecting…" first. A buffer that is never sent now fails.
- T4-3: fixed. `int([...m.why].length, 1, 200)` counts code points, which matches the contract's `$defs.view.from_server.bye.why` (minLength 1, maxLength 200). `int` is the page's own integer range check. The test sends 201 letters and an empty `why` (neither is a bye) and 200 emoji (a bye).
- T4-4: fixed. The test asserts that the chip is hidden after bye, and that it is shown and reads "Live" after Show it again.
- T4-5: fixed in the code. `connect()` runs last in the IIFE, after `press` and `held` are declared, so the new lines hit no TDZ. The fix has no test (T4-2-2).
- Nothing new in the diff is Critical or Important. The fixes keep to the ruling's three parts (logged, kept, reachable) and add no global, no storage and no buffer.

## Mutations re-run

Each mutation went into a scratch copy of the page with both CSP hashes recomputed. It ran against a copy of the test with PAGE as a `file://` URL to that copy and every relative import and URL made absolute to the worktree, under Node 22.23.4 with `--test-concurrency=2`. First, the unchanged copy passed the CSP, bye, goes-nowhere and memory tests (4 of 4).

- (a) `last = e` (with `let last = null;` at the top of the IIFE): caught. The memory test fails at the walk assertion (line 933, "no marker, and no event, in any variable, closure, ..."), and `kept` lists `'a kept KeyboardEvent'`.
- (b) `{ const k = e.key; keep = () => k; }`: caught at line 933, and `kept` lists `'Ж'`, read from the closure's scope.
- (c) `window.lastKey = e.key`: caught at line 935 ("no marker on the window or an element"), which gives `['Ж']`.
- (d) `canvas.lastKey = e.key`: caught at line 935, which gives `['Ж']`.
- (e) `send()` pushes into `buf` when the socket isn't open, and `buf` is never sent: caught at line 933, and `kept` lists `'{"t":"key","type":"press","key":"Ю","text":"Ю"}'` (the down-time marker).
- (f) The `why` length check removed: the bye test fails with "a why of 201 is no bye".
- (g) The chip left shown after bye: the bye test fails with "no Live or Reconnecting… once it has ended".
- Own, caught: `seen.set(e.key, 1)` into a Map (as a key) fails at line 933 with `'Ю'` and `'Ж'`. Each typed key appended to `pendingUrl` fails at line 933 with `'ЮControlvkЖ'`.
- Own, survived (T4-2-1): a `WeakRef`, a private field `#x`, and an array nested seven deep.
- Own, survived (T4-2-2): the T4-5 lines in `connect()` removed, with the whole file at 30 of 30.

Verdict: APPROVE 42879244c9844535a3f941703b9771eb6fe5435f
